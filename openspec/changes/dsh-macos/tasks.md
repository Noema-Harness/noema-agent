# 任务

## 1. 规格与设计

- [x] 1.1 能力卡 C15 #148；`openspec/changes/dsh-macos/specs/project-execution/spec.md` 写规格增量
- [x] 1.2 `npm run plan:check` 通过，计划单独提交

## 2. 适配器

- [x] 2.1 `resolveDshHeadlessRuntime` 支持 macOS：打包目录 `dsh-runtime/node`、PATH 上的 `dsh` 与 `node`，路径按目标平台拼接
- [x] 2.2 worker 补丁按平台开启 `tool-bash` / `tool-pwsh`
- [x] 2.3 worker 环境白名单补 POSIX 变量
- [x] 2.4 `scripts/stage-dsh-runtime.mjs` 支持 macOS
- [x] 2.5 平台事实集中到 `src/main/platform/host-platform.ts`（路径规则、可执行文件名、npm 全局目录、DSH shell 工具、worker 环境白名单），适配器与暂存脚本只查它；`test/main/platform/host-platform.test.mjs`

## 3. 测试

- [x] 3.1 `test/main/integrations/dsh-headless-adapter.test.mjs`：macOS 查找、补丁、环境；Windows 用例显式指定平台
- [x] 3.2 本机实测：Noema 补丁下 `dsh --dump-config` 显示 `tool-bash` 启用

## 4. 收口

- [x] 4.1 `npm run typecheck` 与受影响测试
- [ ] 4.2 `npm run check`（本机 lint 缺 oxlint 的 macOS 原生二进制，由 Windows CI 跑；本机用单独安装的原生 oxlint 通过）
- [x] 4.3 更新 STATUS
- [x] 4.4 更新卡片正文（现在能做什么 + 手测步骤 / 还没做）
- [x] 4.5 macOS 上用真实 DSH 跑命令：`npm run e2e:dsh-fake-model`（`scripts/dsh-fake-model-e2e.mjs`，本地假模型驱动 DSH 0.2.2-rc.1 的 bash 工具）4 项全过——可写模式 `ls` 返回工作区清单、`touch` 写入工作区、只读模式拒绝写入、可写模式拒绝写到家目录。原列为 `[用户]`，但“执行轨迹里有 bash 步骤并返回结果”机器可判，改为自动验证（维护者判断，2026-11-16）；在真实模型下派发项目任务的界面手测仍留给用户，见卡片正文。
