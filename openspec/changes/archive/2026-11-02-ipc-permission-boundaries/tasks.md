# Tasks

## 1. 固定 IPC 来源边界

- [x] 1.1 为 root IPC wrapper 和 window-control 加入 sender main-frame 校验；缺少 frame 身份 fail closed。
- [x] 1.2 增加主框架/iframe/缺少 frame 身份拒绝用例，确认拒绝时不调用受保护 handler。
- [x] 1.3 对照 preload 暴露面、所有 main handlers、workspace/dialog、secret 和 diagnostics CLI 建立 action/授权/敏感字段矩阵，见 `design.md`。
- [x] 1.4 记录工作区与导入对话授权的 requested/granted/denied/revoked 事件；日志不含路径/prompt/key；console error 的已知凭据脱敏并限长。
- [x] 1.5 root IPC/window security/secret store 定向测试 13/13、typecheck、source:check、strict OpenSpec 和 synthetic SQLite diagnostics privacy notice 检查通过。

## Workflow follow-up

- [x] 归档已完成 change 并核对主规格和 archive 状态。
