# 任务

## 1. 规格与设计

- [x] 1.1 能力卡 C15 #148；`openspec/changes/dsh-macos/specs/project-execution/spec.md` 写规格增量
- [x] 1.2 `npm run plan:check` 通过，计划单独提交

## 2. 适配器

- [ ] 2.1 `resolveDshHeadlessRuntime` 支持 macOS：打包目录 `dsh-runtime/node`、PATH 上的 `dsh` 与 `node`，路径按目标平台拼接
- [ ] 2.2 worker 补丁按平台开启 `tool-bash` / `tool-pwsh`
- [ ] 2.3 worker 环境白名单补 POSIX 变量
- [ ] 2.4 `scripts/stage-dsh-runtime.mjs` 支持 macOS

## 3. 测试

- [ ] 3.1 `test/main/integrations/dsh-headless-adapter.test.mjs`：macOS 查找、补丁、环境；Windows 用例显式指定平台
- [ ] 3.2 本机实测：Noema 补丁下 `dsh --dump-config` 显示 `tool-bash` 启用

## 4. 收口

- [ ] 4.1 `npm run typecheck` 与受影响测试
- [ ] 4.2 `npm run check`
- [ ] 4.3 更新 STATUS
- [ ] 4.4 更新卡片正文（现在能做什么 + 手测步骤 / 还没做）
- [ ] 4.5 [用户] macOS 上装 DSH 后派发一个跑命令的项目任务 → 执行轨迹里有 bash 步骤并返回结果
