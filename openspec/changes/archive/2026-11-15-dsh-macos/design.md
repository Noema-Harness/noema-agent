# DSH 执行内核支持 macOS：设计

改动落点：`integrations/dsh-headless-adapter.mjs`（运行时查找、worker 补丁、worker 环境）与 `scripts/stage-dsh-runtime.mjs`。
共享逻辑不移动：查找、补丁、环境仍在适配器一个文件里，只按平台分支。
新增一个平台事实模块 `platform/host-platform.ts`，不新增兼容层：Windows 的查找顺序与产物保持不变，macOS 是并列的另一组候选。

## Context

- 工单默认走 DSH（`work-runtime-registry.ts` 的 `forTicket({ preferred: 'dsh' })`），DSH 不可用时退回原生执行器；常驻私聊也有 DSH 运行时。
- 适配器调用方式：`spawn(nodeExecutable, [dshBin, '--profile', 'headless', '--patch', <patch>, '--json'])`，`DSH_HOME` 指向 Noema 自己的 `userData/dsh-home`，不碰用户的 `~/.dsh`。
- DSH headless 默认配置里 `tool-bash`/`bash-sandbox` 在非 Windows 启用，`tool-pwsh`/`pwsh-sandbox` 只在 Windows 启用；Noema 的补丁写死了 `tool-pwsh: disabled: false`。
- worker 环境白名单只有 Windows 变量，macOS 上 `HOME`、`TMPDIR` 等会被丢掉。

## 实现选择（维护者判断，用户可推翻）

- **macOS 的 DSH 来源**：PATH 上的 `dsh`（`npm i -g @deepseek-ai/dsh`），解析符号链接得到 `@deepseek-ai/dsh/lib/bin.js`；Node 取 `NOEMA_DSH_NODE`，再取 PATH 上的 `node`，要求 24.21+。打包目录 `resources/dsh-runtime/node` 优先，和 Windows 一致。
- **不复用 DeepSeek Harness.app 的命令行**：它要用 Harness 自己的 Electron 以 `ELECTRON_RUN_AS_NODE` 启动 `dsh-desktop-host/lib/cli.js`，依赖桌面版内部结构，升级时容易断。
- **平台事实集中在 `src/main/platform/host-platform.ts`**：路径规则（按目标平台而不是宿主平台）、可执行文件名、npm 全局目录、DSH shell 工具、worker 环境白名单都由 `hostPlatform(id)` 给出，适配器与暂存脚本不再比较 `process.platform`。这是用户 2026-11-15 提出“与 Windows 解耦、便于扩展到 Linux/移动端”后的第一步；整体解耦另行出方案。
- **Linux**：查找走 POSIX 分支，但本轮只在 macOS 上实测；规格只承诺 macOS。

## 用户可观察的改变

- macOS 上装了 `@deepseek-ai/dsh`（npm 全局）和 Node 24.21+ 后，Noema 的项目任务改由 DSH 执行，可以在工作区里跑命令（如 `ls`、`npm test`），受 DSH 的 bash 沙箱与 Noema 执行权限约束。
- 没装 DSH 时，诊断里报“没有找到 DSH”而不是“只支持 Windows”，任务仍退回原生执行器。
- Windows 行为不变。

## 手测步骤

1. macOS 上执行 `npm i -g @deepseek-ai/dsh`，确认 `dsh --version` 可用、`node --version` ≥ 24.21。
2. `npm start` 启动 Noema，配置模型 provider。
3. 新建项目并选一个测试文件夹，派发任务“在工作区里运行 ls 并告诉我有哪些文件”。
4. 预期：任务详情的执行轨迹里出现 bash 命令步骤并返回文件列表；诊断里 DSH 运行时状态为 ready。
5. 把执行权限设为只读，再派发“新建一个 a.txt”，预期被拒绝或要求授权，工作区里没有新文件。

## 验证

- 单测：macOS 打包目录、macOS PATH 查找（含符号链接与 Node 版本筛选）、找不到时的错误码；Windows 现有用例显式传 `platform: 'win32'` 后在任意主机通过。
- 单测：补丁在 `darwin` 开启 `tool-bash`、在 `win32` 开启 `tool-pwsh`；环境白名单在 macOS 保留 `HOME`/`TMPDIR`。
- 实机：本机用临时 `DSH_HOME` 与 Noema 生成的补丁执行 `dsh --profile headless --patch <patch> --dump-config`，确认 `tool-bash` 启用、`tool-pwsh` 关闭。
- `npm run typecheck`、受影响测试；收口跑 `npm run check`。

## 待用户决定
