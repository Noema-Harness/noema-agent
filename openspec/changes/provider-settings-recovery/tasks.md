# Tasks

## 1. 设置交互与恢复

- [ ] 1.1 在 SocialChat controller 增加设置内的连接检查 busy/feedback 状态；连接失败保留设置并提供重试/更改，校验异常保留空白/掩码编辑表单。通过源码检查确认已保存 API 密钥不进入 renderer state。
- [ ] 1.2 更新模型设置层级、短文案、状态反馈及窄窗排布；用 Electron renderer 检查已配置/未连接/正在重查状态、空白密码输入、错误恢复操作和 420px 可见区域。

## 2. 阶段集成验证

- [ ] 2.1 扩展现有隔离 model-availability probe，验证重查仅由用户触发、失败后仍能更改配置、密钥值不回显、420px 状态与操作可用；随 S2-07 全组 gate 运行并复核桌面/窄窗截图。

## Workflow follow-up

- 阶段 2 gate 通过后验证 OpenSpec change，并归档到主规格。
