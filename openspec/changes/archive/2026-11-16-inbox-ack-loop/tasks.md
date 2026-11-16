- [x] 1.1 插件侧按 key + `resurfaceMs` 抑制重复注入，并清理过期条目（验证：`node --test index.test.mjs` → 38/38，随源码移到新项目）
- [x] 1.2 `transition()` 重复投递刷新 `at`，补用例（验证：同上，`a repeated delivery refreshes the timestamp`）
- [x] 1.3 `ack` 只标 delivered 时向 stderr 提示正确命令（验证：`node scripts/inbox-bridge.mjs ack <key>` 输出 delivered + 提示）
- [x] 1.4 注入文案、`list` 提示、usage 三处命令式统一，且不再是 npm 吞参数的写法（验证：默认 `ackHint` 由配置给出；Noema 侧配 `npm run inbox:ack -- --done -- <key>`）
- [x] 1.5 `docs/OPERATIONS.md` 收件箱命令块与 CI 一节改成与实现一致（验证：读文件 + `npm run docs:check`）
- [x] 2.1 工具源码移出本仓库：新建公开仓库 `Noema-Harness/dsh-inbox-bridge`（MIT，v1.4.0），插件、CLI、抓取、测试全在那边（验证：`gh repo view` 为 PUBLIC + `npm test` 38/38）
- [x] 2.2 本仓库只留转发器 `scripts/inbox.mjs`，`npm run inbox` / `npm run inbox:ack` 语义不变（验证：`npm run inbox` 列出三态）
- [x] 2.3 `package.json` 去掉已移走的测试入口，`tools:test` 不再引用不存在的文件（验证：`npm run check` 全绿）
- [x] 2.4 `docs/OPERATIONS.md`、`docs/STATUS.md` 指向新项目并写明安装方式（验证：`npm run docs:check`）

用户侧验收（通知是否真的不再循环、收口命令是否真的能停）不在这里，写进 `docs/DECISIONS.md` 该条目的第 3 节——待验收阶段由用户勾选，那才是「已收口」的门。
