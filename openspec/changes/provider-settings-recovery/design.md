# Design

## Context

`RootAgent.configureProvider()` 已在主进程保存密钥并检查模型目录；`RootAgent.refreshModels()` 已能用加密存储中的现有密钥重查。renderer 当前无独立重查操作，并且无论检查结果如何都会关闭设置。具体需求见 `specs/model-provider-settings/spec.md`。

## Goals / Non-Goals

**Goals:**

- 将连接检查的进行中、成功和失败反馈留在设置中。
- 配置无效时保留输入；配置已保存但服务不可用时允许不重输密钥重查或更改配置。
- 让已有凭据完全留在主进程，替换字段不预填。
- 在 420px 宽度下保持状态文案和检查/修改按钮可见、可操作。

**Non-Goals:**

- 不改变密钥加密、provider API、模型选择语义、请求预算或诊断数据结构。
- 不自动轮询或在应用启动时发起额外连接请求。

## Decisions

- controller 增加独立的 refresh busy 与设置反馈状态；`refreshProviderModels` 只响应显式按钮操作，并通过既有 model-state event/`refreshState` 同步设置视图。
- 保存配置后如返回错误、连接未建立或模型目录为空，保留设置打开并切换到已配置状态，显示当前错误以及重新检查、更改配置操作；只有有可用模型的连接检查成功才按原流程关闭。
- 配置校验抛错时保留编辑状态与输入值，仅显示错误。用户修改地址或密钥后清除旧错误；关闭设置时清除临时反馈。
- 密钥字段仅在编辑状态创建，初始值为空且始终为 `type=password`；重新检查直接调用主进程，不把已有密钥传入 renderer。
- 状态信息使用无左侧色条的普通行内文本和语义状态标记；窄窗下状态与操作按需换行，不缩小密钥或地址字段。

## Risks / Trade-offs

- `[Risk]` 网络检查可能较慢 → 复用 provider 现有 deadline，在按钮上显示进行中状态并阻止重复点击。
- `[Risk]` provider 返回的自由文本错误可能较长 → 使用已有脱敏错误文本并允许行内换行；不得把 API 密钥写入状态或诊断。

## Migration Plan

无需数据迁移。回滚时移除 renderer 重试入口和临时反馈状态即可；已保存的凭据格式保持不变。
