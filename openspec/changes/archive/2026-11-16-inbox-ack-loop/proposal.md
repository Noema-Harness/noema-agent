Plan: none

## 为什么

同一条收件箱通知被重复注入了 15 次。三处失败叠加：注入文案与 `docs/OPERATIONS.md` 教的收口命令是 `npm run inbox:ack --done -- <key>`，而 npm 把 `--done` 当成自己的参数吞掉，实际只标 delivered（实测 `{"status":"delivered"}`，正确写法 `npm run inbox:ack -- --done -- <key>` 返回 `{"status":"done"}`）；`transition()` 对重复投递只 `continue`，state 里的 `at` 不前进；插件在 ack 失败时 `throw`，下一轮照旧重投。三者合起来就是「每 6 小时必然再提醒一次」，而人看到的只是循环。

收件箱工具本身与该问题无关地留在 Noema 仓库里：它是 DSH 插件 + 一套通用 CLI，换任何来源都能用，却被 Noema 的 `scripts/`、`docs/`、测试入口一起绑住——只有维护者能碰那些目录，工具因此无法独立演进，也与产品代码混在同一条时间轴上。

## 改什么

- 修掉循环，三处一起改：插件按 key 在 `resurfaceMs` 窗口内抑制重复注入（ack 失败也不会变成循环，过期条目清理）；`transition()` 重复投递刷新 `at`；`ack` 只标 delivered 时向 stderr 打一行提示（沉默降级才是循环的入口）。
- 把工具整体移出本仓库，成为独立项目 `Noema-Harness/dsh-inbox-bridge`（MIT，公开）：插件、CLI、GitHub 抓取与它们的测试一起走。
- 本仓库只留 `scripts/inbox.mjs` 转发器：先看 `INBOX_CLI`，再看同级目录 `..\dsh-inbox-bridge`；找不到时打印克隆指路并以 2 退出。
- `docs/OPERATIONS.md`、`docs/STATUS.md` 改成指向新项目；`npm run inbox` / `npm run inbox:ack` 语义不变。

## 影响

删除 `plugins/inbox-bridge/`、`scripts/{inbox-bridge,github-inbox}.mjs` 及其测试；新增 `scripts/inbox.mjs`；改 `package.json` 的 `inbox`/`inbox:ack`/`tools:test`。不涉及 `apps/desktop/src/`，不改产品可观察行为。
