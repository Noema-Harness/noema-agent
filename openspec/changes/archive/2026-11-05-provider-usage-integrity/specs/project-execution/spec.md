# Spec Delta

## ADDED Requirements

### Requirement: Provider usage 将未知值与零值区分
Provider token usage MUST 仅在返回至少一个可识别的有效非负 token/cache 计量时标记为已收到。每个缺失、无效或互相矛盾的 token/cache 计量 MUST 保持 unknown；真实零值 MUST 保留为零，诊断界面不得将 unknown 显示为零。Provider cost 独立保留，不代表 token 计量已收到；cache-write 字段只从所适配协议明确规定的响应路径读取。

#### Scenario: 空或不可识别的 usage 对象
- **WHEN** provider 响应包含空 usage、仅有未知字段或所有已知字段均无效
- **THEN** 本机请求保持 usage missing，token/cache 数值均为 unknown，不显示为零

#### Scenario: Provider 明确报告零 token
- **WHEN** provider 对有效 usage 字段明确报告数值 0
- **THEN** 系统将该字段记录为零并标记 usage 已收到

#### Scenario: Provider 只报告部分计量
- **WHEN** provider 返回输入或输出 token 的部分有效字段而缺少其它字段
- **THEN** 有效字段照常展示，缺失字段显示 unknown 而不是零

#### Scenario: Provider 报告或省略 cache-write 计量
- **WHEN** 响应包含受支持协议的 cache-write 数值，或没有该字段
- **THEN** 明确返回的数值（包括零）显示在时间线和本地报告中；缺失字段保持 unknown

#### Scenario: 缓存分解与输入总量矛盾
- **WHEN** provider 报告的缓存命中与未命中合计不等于输入 token 总量，或单项大于总量
- **THEN** 有矛盾的缓存分解保持 unknown，不静默修正为零或推算命中
