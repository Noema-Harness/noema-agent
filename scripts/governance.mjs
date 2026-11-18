// 治理入口：一份规则登记表 + 三个运行频率。
// 规则从哪来：每条都对应一次真实失败（或成本高且静默的架构腐化，标注「观察期」）。
// 规则怎么退：没有任何触发证据的规则降级为提醒；连续两个里程碑无触发的拦截规则进入降级候选。
// 三个频率：
// - commit：提交前只跑文档与计划（约 0.3s）
// - milestone：一个切口收口时跑全部本地检查（约 40s，含全量测试）
// - ci：远端里程碑验证，与 milestone 同源；不在每轮跑
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

const nodeStep = (script, args = []) => ({ kind: "node", script, args });
const npmStep = (name) => ({ kind: "npm", name });

export const PROFILES = {
  commit: [nodeStep("scripts/maintenance.mjs", ["precommit"])],
  milestone: [
    nodeStep("scripts/workspace.mjs", ["check"]),
    nodeStep("scripts/branches.mjs", ["check"]),
    nodeStep("scripts/maintenance.mjs", ["docs"]),
    nodeStep("scripts/figure.mjs", ["check"]),
    nodeStep("scripts/maintenance.mjs", ["plan"]),
    nodeStep("scripts/source-structure.mjs"),
    npmStep("lint"),
    npmStep("typecheck"),
    npmStep("tools:test"),
    nodeStep("scripts/interface.mjs", ["audit"]),
    npmStep("test"),
  ],
};

// CI 跑的就是里程碑，不另起一套；两条路径同源，避免“本地过、CI 不过”。
PROFILES.ci = PROFILES.milestone;

// 五条不变量：任何规则必须支撑其中一条，支撑不上就删。
export const INVARIANTS = ["意图可追", "变更可逆", "结果可验", "事实唯一", "成本受控"];

const PROVISIONAL = "观察期";

// 规则登记表。字段说明：
// - id：稳定名字，报错与决定里可以引用
// - invariant：支撑哪条不变量
// - prevents：不拦会出什么错（写失败现象，不写实现）
// - evidence：真实触发记录；没触发过的写「观察期」（便宜但不该发生的结构护栏写「预防：<它会防住的失败>」），在里程碑审计里复看
// - level：block 拦截 / notice 提醒
// - where：在哪个检查里执行
// 规则登记：id | 支撑的不变量 | 防的失败 | 触发证据 | 级别 | 执行位置
const RULE_TABLE = `
version-sync|事实唯一|根包与桌面包版本号漂移，STATUS 说的版本和代码不是一回事|2026-11-15 STATUS 写 0.7.3，package.json 是 0.7.6|block|docs:check
doc-heads|事实唯一|权威文档没有职责边界，同一事实被写进两份|0.7.x 期间 DECISIONS/OPERATIONS 缺 Authority 头|block|docs:check
docs-registered|事实唯一|docs/ 里长出未登记文档，事实分流到没人维护的地方|CURRENT_CONTEXT、HARNESS_ALIGNMENT 等旧文档残留|block|docs:check
status-facts|事实唯一|STATUS 的版本、基线、最后更新与仓库实际不符|基线 f592a9b 不是 HEAD 祖先（CI 两次失败）|block|docs:check
hooks-installed|成本受控|本机提交门没装，门槛形同虚设|CI 报 core.hooksPath 未设置；CI 下降级为提示|block|docs:check
config-doc-refs|事实唯一|配置或计划引用已删除的文档|openspec/config.yaml 引用 docs/CURRENT_CONTEXT.md|block|docs:check
documented-scripts|事实唯一|文档或 CI 引用已删除的 npm 脚本|CI 失败：Missing script "workspace:test"|block|docs:check
decision-shape|意图可追|决定没有状态、悬而不决，或编号互相踩踏|同一决定因并行分支改号九次（D-025→D-039）|block|docs:check
one-active-change|意图可追|多个变更并行，范围与意图同时漂移|2026-11-15 同时挂着 11 个活动变更|block|plan:check
change-files|意图可追|变更缺 proposal/design/tasks，归档时没有设计可查|旧变更归档时没有可回看的取舍记录|block|plan:check
tasks-alive|意图可追|任务全完成却不归档，计划停在半空|C6 切片完成后 plan:check 提示先归档|block|plan:check
plan-link|意图可追|变更不指向看板卡片，执行与规划脱钩|proposal 缺 Plan:（拦截过一次）|block|plan:check
user-acceptance-date|结果可验|用户验收没确认就勾选成已完成|治理变更的 [用户] 项曾被自动勾选|block|plan:check
observable-sections|结果可验|交付说不清用户能看到什么、怎么手测|观察期：没有这两节用户只能靠问才知道改了什么；2026-11-16 起模板已要求，尚无独立触发记录|block|plan:check
milestone-tasks|结果可验|任务没做完就归档，把半成品当交付|治理变更归档前被拦|block|milestone:check
milestone-card-body|事实唯一|交付后卡片正文还是旧状态，用户看不到现在能做什么|C6 收尾时卡片正文落后于交付（2026-11-15）|block|milestone:check
spec-delta|结果可验|行为变更没有规格增量，回归没有合同|skip_specs 曾被用于行为变更|block|milestone:check
status-today|事实唯一|STATUS 不是当天更新，交付与事实脱节|STATUS 曾连续三个版本未更新|block|milestone:check
figure-sync|事实唯一|ARCHITECTURE 改了架构图没重出，入口图与结构不一致|figure:check 两次拦到哈希漂移|block|milestone:check
plan-before-code|意图可追|先写代码后补计划，计划变成实现清单|2026-11-15 C6 与 delivery-observability 两次|block|pre-commit
code-needs-plan|意图可追|代码提交不带计划或状态更新|提交门建立后拦到过|block|pre-commit
referenced-decision-confirmed|结果可验|变更引用了未确认的决议，却当作已定实现|里程碑曾全局阻塞无关议题（2026-11-16 已收窄为只查本变更引用的决议）|block|milestone
governance-no-product|意图可追|治理变更夹带产品代码，绕过卡片与规格|观察期：尚无真实触发；夹带一次就会绕过卡片与规格|block|pre-commit
skip-specs-product|结果可验|行为变更标 skip_specs，跳过规格与回归合同|观察期：尚无真实触发；行为变更没有回归合同，下次改动就没有验收基线|block|pre-commit
workspace-root-dirs|事实唯一|仓库根出现未分类目录，过程材料混进版本库|新增 .githooks/.archify 时拦到过|block|workspace:check
source-boundary|变更可逆|生产代码导入 test-support，交付物带着测试依赖|观察期：尚无真实触发；一条测试依赖就会让交付物与测试环境绑死|block|source:check
decision-advance-approval|意图可追|阶段推进没有用户原话，agent 自己给自己盖章|观察期：decision advance 刚落地，尚无真实触发；此门拦的是「把自己的候选写成已定」|notice|decision:advance
round-changes-line|意图可追|轮次记录不写待裁变化，待裁清单醒来就过期|观察期：round 命令刚落地，尚无真实触发；缺了变化行，下一轮就不知道哪项已解除|notice|decision:round
entry-history-monotonic|变更可逆|条目历史被删，已发生的批次、决定与验收消失，事后无法追溯|不可逆：删掉的历史行无法恢复，用户 m109573 要求机制防再犯|block|docs:check
transition-doc-singleton|事实唯一|同类过渡文档越开越多，回工时找不到唯一一份|观察期：本轮反复新建设计稿，用户三次指出；先提醒两个里程碑|notice|transition:write
rule-net-zero|成本受控|新增规则/门没有写清净额，治理越堆越重、正常一轮的附着动作越来越多|用户 m110151 指出接口细分要求 agent 记住更多；audit 基线只允许显式净增|notice|governance audit
branches-cleanup|成本受控|已合并分支残留在远端，仓库越来越难读|PR #131 合并后 ts-migration 分支残留|notice|branches:check
inbox-per-round|成本受控|每轮同步等 CI 或靠用户提醒才发现远端红|用户批评每轮等 CI 几十分钟|notice|流程
`.trim();

export const RULES = RULE_TABLE.split("\n").map((line) => {
  const [id, invariant, prevents, evidence, level, where] = line.split("|");
  return { id, invariant, prevents, evidence, level, where };
});

export function profileNames() {
  return Object.keys(PROFILES);
}

export function auditRules(rules = RULES) {
  const provisional = rules.filter((rule) => rule.evidence.startsWith(PROVISIONAL));
  const rest = rules.filter((rule) => !rule.evidence.startsWith(PROVISIONAL));
  return {
    blocks: rest.filter((rule) => rule.level === "block"),
    notices: rest.filter((rule) => rule.level === "notice"),
    provisional,
    unsupported: rules.filter((rule) => !INVARIANTS.includes(rule.invariant)),
  };
}

function label(step) {
  return step.kind === "node" ? step.script : `npm run ${step.name}`;
}

function run(step) {
  if (step.kind === "node") {
    execFileSync(process.execPath, [step.script, ...step.args], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    return;
  }
  execSync(`npm run ${step.name} --silent`, { cwd: root, stdio: "inherit", env: process.env });
}

export function profileScripts(name) {
  return (PROFILES[name] ?? []).filter((step) => step.kind === "node").map((step) => step.script);
}

function printAudit() {
  const { blocks, notices, provisional, unsupported } = auditRules();
  console.log(
    `governance audit: ${blocks.length} 条拦截 / ${notices.length} 条提醒 / ${provisional.length} 条观察期`,
  );
  const groups = [
    ["拦截（触发过真实失败）", blocks.filter((rule) => !provisional.includes(rule))],
    ["拦截（观察期，尚未触发；连续两个里程碑无触发就降级为提醒）", provisional],
    ["提醒", notices],
  ];
  for (const [title, rules] of groups) {
    if (!rules.length) continue;
    console.log(`\n${title}:`);
    for (const rule of rules) {
      console.log(`  - ${rule.id}（${rule.invariant}｜${rule.where}）：${rule.prevents}`);
      console.log(`    证据：${rule.evidence}`);
    }
  }
  if (unsupported.length) {
    console.log(
      `\n以下规则没有支撑五条不变量之一，应删除：${unsupported.map((r) => r.id).join("、")}`,
    );
  }
}

function main() {
  const name = process.argv[2] ?? "milestone";
  if (name === "audit") {
    printAudit();
    return 0;
  }
  const steps = PROFILES[name];
  if (!steps) {
    console.error(`governance: unknown profile ${name}; use ${profileNames().join("|")}|audit`);
    return 2;
  }
  for (const step of steps) {
    if (step.kind === "node" && !fs.existsSync(path.join(root, step.script))) {
      console.error(`governance: ${name} missing ${step.script}`);
      return 2;
    }
  }
  const started = Date.now();
  for (const step of steps) {
    try {
      run(step);
    } catch {
      console.error(`governance: ${name} failed at ${label(step)}`);
      return 1;
    }
  }
  console.log(`governance: ${name} OK (${Date.now() - started}ms)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
