# Tasks

## 1. 项目工具准入与证据合同

- [x] 1.1 扩展主聊项目动作准入词表，确保核验/核对/评审意图暴露项目工具；用 collaboration、review 和 plan chat 定向回归验证。
- [x] 1.2 隐藏 project-bound plan tool 的 project_id 字段，同时补充 coordinator/member 的项目绑定、截断读取与不可信证据说明；用绑定项目与 evidence inspection 测试验证。
- [x] 1.3 将提示词测试更新到当前稳定指导语义，并运行相关三个测试文件；44/44 通过。
- [x] 1.4 运行 `openspec.exe validate project-tool-admission --strict --no-interactive` 与 `git diff --check`。

## Workflow follow-up

- 归档 change 并将本地提交推送到当前 GitHub 分支；核对远端分支 SHA。
