# 运行手册技能：从模板清单改成偏离盘查工具

## Why

`skills/noema-development` 现在只有填写模板，遇到“某次执行偏离了治理预期”时没有可用的盘查方法：agent 容易只改提示层、把现象当结论，或者把自己的判断写成用户已确认。用户 2026-11-16 重开了这条议题（m74626），说明技能不该是常规轮次的清单，而应是发现偏离时的梳理工具；2026-11-17 确认形态（m102771）与六步结构（m102774）后开工。

## What Changes

- 新增 `skills/noema-governance/SKILL.md`：三种偏差分类（执行偏差 / 机制缺陷 / 规则缺失）+ 盘查六步（停手登记 → 还原预期路径 → 采样证据 → 偏差分类 → 归因分层 → 修法候选登记待定），每步带产物；正常开发轮不加载。
- `scripts/skill-sync.mjs`：从单技能改成 `SKILL_NAMES` 列表，`npm run skill:install` 安装两份、`docs:check` 校验两份已安装副本。
- `skills/noema-development/SKILL.md` 定位不变（模板）；`docs/OPERATIONS.md` 技能段说明两份技能各自何时加载。
- `docs/DECISIONS.md` 的 `D-20261116-governance-extraction` 记录决定与执行、进入待验收。

## Impact

治理层面的加载与同步机制；产品行为、数据与 CI 门槛不变。维护者多一份按需加载的技能，`skill:install` 与 `docs:check` 覆盖两份副本。

Plan: none