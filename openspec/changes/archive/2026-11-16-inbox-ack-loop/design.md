## 事实影响

- 类别：结构
- 依据：只改收件箱协议的三处实现（投递抑制、状态时间戳、命令文案），不改变产品行为与系统分层；无规格增量，`skip_specs: true`。

## 开工声明

- 计划先于代码：本变更的提交信息含 change 名，tasks 记录每条验证。
- 事实影响：结构（收件箱三态推进的可靠性与命令文案）。

## 用户决策

- 无（用户在 2026-11-16 选择「把收件箱与门禁修好做成一个 PR」）。

## 实现选择

- **在插件里做抑制，而不是在脚本里改语义**：`scripts/inbox-bridge.mjs ack <key>` 只标 delivered 是文档承诺的行为，改它会让 `--all-delivered` 之类用法含义漂移；真正的失败是「ack 失败 → 下一轮重投」没有上界，所以抑制放在投递侧，按 key + `resurfaceMs`，与 state 文件里的 resurface 窗口同宽。
- **不把 `--done` 做成默认**：默认 done 会把「只是看到了，还没处理」挤掉，三种状态会退化成两种；改为在 stderr 显式提示，让降级可见。
- **文案与文档一起改**：注入文本是 agent 唯一会读到的指令，它错了，模型就会照错的命令执行；这是本次循环的直接入口。
- 不新增门：异常已经在 `plugins/` 与 `scripts/` 的测试里，没有新的失败类型需要常驻检查。
- **把工具整体移出仓库，而不是「留在仓库但改归属」**：它不是 Noema 的一种能力，而是一个通用 DSH 插件（换任何来源都能用）。留在 `scripts/` 的代价是每次维护都撞 `collaboration.mjs` 的维护者路径守卫，且它的测试跟着 Noema 的 `tools:test` 一起跑，两边都无法独立发布。移走后本仓库只留一个转发器，语义（`npm run inbox`）不变。
- **转发器不复制逻辑**：`scripts/inbox.mjs` 只解析 `INBOX_CLI` 或同级目录，转手调用真正的 CLI；找不到时打印克隆指路并以 2 退出——宁可失败可见，也不留一份会漂移的副本。

## 用户可观察的改变

- 一条已投递、未被标 done 的通知在 `resurfaceMs`（默认 6 小时）内不再重复进入同一轮对话；ack 命令失败也不再每 2 分钟重投一次。
- `npm run inbox` 与注入文案给出的收口命令是真能标 done 的那条；用错写法时终端会直接告诉你只标了 delivered。
- `docs/OPERATIONS.md` 的收件箱与 CI 两节与实现一致。
- 收件箱工具成为独立开源项目 `Noema-Harness/dsh-inbox-bridge`（MIT），任何人都能按 README 装到自己的 DSH 里；Noema 这边 `npm run inbox` 仍然可用，只是背后是那个项目。

## 手测步骤

1. `node --test scripts/inbox-bridge.test.mjs` → 状态推进与「重复投递刷新 at」两条用例通过（现在在 `dsh-inbox-bridge` 项目里跑）。
2. `node scripts/inbox-bridge.mjs ack probe:manual` → 输出 `{"marked":["probe:manual"],"status":"delivered"}` 并在 stderr 提示正确的 done 写法。
3. `npm run inbox:ack -- --done -- probe:manual` → 输出 `"status":"done"`，再跑一次仍为 done（不会退回 delivered）。
4. 拔掉 gh 或断网后等两轮（约 4 分钟）：`.work/inbox-bridge/plugin.log` 里应出现 `suppressed N event(s) already delivered; waiting for ack`，而不是同一批 key 被反复 `injected`。
5. `npm run inbox` 仍然列出三态（背后经 `scripts/inbox.mjs` 转到 `..\dsh-inbox-bridge`）；把该目录改名后重跑，应看到克隆指路且退出码 2。
