# Spec Delta

## ADDED Requirements

### Requirement: provider request lifecycle is locally traceable
每次通过凭据门槛的 provider request MUST 在本机记录 started 事件；首次收到非空模型文本或工具调用输出时 MUST 记录一次 first-output；结束时 MUST 记录一个 completed、failed 或 interrupted 终态。事件 MUST 共用 request ID 并关联可用的 execution、task、turn 与 operation identity。usage 缺失时 MUST 显示为 unknown 并记录明确的缺失状态；事件 MUST NOT 包含 prompt/response 正文、tool arguments/results、API credentials 或自由文本错误。

#### Scenario: provider request completes with output
- **WHEN** provider request 返回文本或工具调用并结束
- **THEN** 本机时间线按相同 request ID 显示 started、一次 first-output 和 completed 事件，且可用的任务/turn 关联保持一致

#### Scenario: request fails before first output
- **WHEN** provider request 在首个输出前遇到拒绝、传输错误或无效响应
- **THEN** 时间线显示 started 与 failed，且不会伪造 first-output 或已报告 usage

#### Scenario: request is interrupted after output
- **WHEN** 用户或上游取消已开始且已返回输出的 provider request
- **THEN** 时间线保留 started、first-output、interrupted 的顺序，并将缺少的最终 usage 保持 unknown

#### Scenario: a completed request has no usage metadata
- **WHEN** provider 正常结束但没有返回可识别的 usage
- **THEN** 时间线将请求显示为 completed，同时标出 usage missing，不将 token/cache 数显示为零

#### Scenario: diagnostics sink fails
- **WHEN** 本机生命周期事件回调或诊断存储失败
- **THEN** provider 请求继续按原 transport 结果完成或失败，不因诊断错误中断或重试模型请求
