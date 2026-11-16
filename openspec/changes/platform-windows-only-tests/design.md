## 事实影响

- 类别：仅执行
- 依据：只把既有平台耦合在测试与 CI 里显式化，不改产品行为、不改架构边界；判据来自 `D-20261116-platform-layers` 第③刀与 run 43931274245 的失败清单。

## 用户决策

- 无（第③刀由 `D-20261116-platform-layers` 用户确认的切法授权，本变更不再单独请示）。

## 目标

- PR 上的 `portable` 从“报告期”转为真实门：Ubuntu 上只剩 0 失败，失败就红。
- 12 条 Windows-only 用例各自的跳过原因写在用例旁，跳过逻辑本身有单测；未来新增平台耦合会立刻在 Ubuntu 上暴露，而不是被静默 skip。

## 非目标

- 不把这 12 条改写成“在 Linux 上模拟 Windows”的假跨平台测试：它们验证的正是 Windows 语义（盘符、`\`、`cmd.exe`、`taskkill.exe`、`path.win32`），用 `path.win32` 造数据只能测夹具，测不到宿主行为。
- 不做 CI 三平台矩阵（第②刀），不改 Windows 主线 `verify`。
- 不动其余测试：Ubuntu 上本来就能过的用例保持原样。

## 取舍

- 为什么用显式 skip 而不是把测试文件整体排除：文件级排除会连带跳过其中能跨平台的用例（例如 `noema-project-executor.test.mjs` 有几十条在 Ubuntu 上通过），也会让“哪条平台专属”重新只存在于 CI 日志里。
- 为什么辅助只写一个函数：标记是行内判断，不引入测试框架层；`{ skip: "Windows-only: …" }` 在 CI 日志里直接给出原因，替代翻页找 job。
- 为什么 `portable` 不在 `main` 推送上也跑：main 上 `verify`（Windows 全量）已经是严格门，PR 才是协作者提交面；`main` 再跑一遍 Ubuntu 只会增加排队时间，不增加判定力。

## 用户可观察的改变

- PR 的 `Desktop checks` 里 `portable` 变绿才可合并；它不再是“红着也能过”的报告。
- 打开 Ubuntu 失败的本地复现时，`node --test` 输出会写明 `Windows-only: <原因>`，而不是一条裸失败。
- Windows 上跑 `npm run check` 的用例数与结果不变。

## 手测步骤

1. 在 Windows 上 `npm test`：12 条用例仍然执行并通过（skip 只在非 Windows 生效）。
2. 用 `node -e` 调 `windowsOnly('证据', 'linux')`：返回 `{ skip: 'Windows-only: 证据' }`。
3. 开一个 PR 看 `portable` job：12 条显示 skipped，其余全过，job 绿。
4. 临时把一条非平台用例改成必失败，`portable` 应变红（验证它不是靠 skip 变绿）。

## 验收

- `.github/workflows/desktop-checks.yml` 的 `portable` 不含 `continue-on-error`，PR 上与 `verify` 一起构成合并门。
- 12 条用例在非 Windows 上带原因 skip，在 Windows 上照常执行。
- `npm run check` 全绿，`tools:test`/`npm test` 计数与归档记录一致。
