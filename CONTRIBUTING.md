# 参与 Noema 开发

## 先选对工作入口

- 尚未形成行动项的方向、疑虑和开放问题放在 [GitHub Discussions](https://github.com/c3115644151/noema-agent/discussions)。
- 已决定推进且有可验收结果的工作使用 [Issue / Project](https://github.com/users/c3115644151/projects/6)。
- 自动纳入规则会将新开放 Issue/PR 放入 Inbox；经 API/连接器创建后仍需核对是否入板，缺失时手动添加。分诊后再放入 Backlog、Todo 或 Blocked。
- M1 “核心使用闭环”完成前，不开始聊天、记忆或外部集成等产品功能实现。

## 开工和交付

1. Todo Issue 才满足开工条件：问题、用户结果、范围、依赖、风险与验收条件齐全。
2. 有实质的多文件/架构工作优先使用分支和 PR；小型机械文档改动可直接提交。
3. PR 要关联 Issue，并记录用户可见结果、实际运行的验证和未验证项。
4. 只有验收通过后才能将 Issue 设为 Done；此动作会自动关闭 Issue。已取消工作先标为 Canceled，再以 `not planned` 关闭。
5. CI 在 Windows runner 上执行：`npm ci`、lint、typecheck、测试、桌面 smoke 和 Electron package。

本仓库为 GitHub Free 下的私有仓库，平台目前不允许 branch protection/rulesets。因此 PR 和检查策略目前由协作流程执行，而非服务端强制；不要把 CI 绿灯或直接 push 当成用户验收。

## 本地运行

查看根 [README](README.md) 的 Node/npm 版本与命令。不要提交密钥、本地模型数据、用户导出内容或未脱敏日志。
