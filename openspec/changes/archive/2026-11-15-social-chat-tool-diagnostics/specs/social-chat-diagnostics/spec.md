# Spec Delta

## Purpose

为 Social 聊天中的模型工具调用提供可关联、有限且不暴露对话内容的本机诊断记录，使用户能够从模型请求追踪到工具执行的真实结果。

## ADDED Requirements

### Requirement: Social 聊天工具调用可按请求追踪
Social 聊天执行模型工具调用时，系统 MUST 记录关联同一 provider request ID、turn ID 和 tool call ID 的开始及终态事件。事件 MUST 表达工具名称、有限类别、执行状态、耗时及可用的安全错误码；MUST NOT 记录工具参数、工具结果正文、对话正文或凭据。

#### Scenario: 工具调用成功并继续生成
- **WHEN** Social provider 返回工具调用且主进程完成授权和执行
- **THEN** 本机诊断时间线以相同 request ID 和 tool call ID 显示开始及 completed 终态，且随后模型请求仍作为独立 request 记录

#### Scenario: 工具被拒绝或返回失败
- **WHEN** Social 主进程拒绝工具调用，或工具结果表明执行失败
- **THEN** 时间线为该 tool call 显示 failed 或 denied 终态及有限错误码，不把 provider request completed 误作工具成功

#### Scenario: 工具返回来源不可读
- **WHEN** 网页来源读取工具返回 `status=unreadable`
- **THEN** 时间线将该 tool call 记录为 failed/returned_error，且不记录来源 URL、错误说明或网页正文

#### Scenario: 工具执行被取消或失败
- **WHEN** 工具未返回结果便因用户取消或执行异常结束
- **THEN** 时间线为该 tool call 显示 interrupted 或 failed 终态，并保留已记录的请求关联

#### Scenario: 诊断存储不可用
- **WHEN** Social 工具的诊断事件无法写入
- **THEN** Social 既有授权、工具副作用和业务结果保持不变，且不重放工具调用

### Requirement: Provider 请求有界并记录安全终态
Social 主聊的模型请求 MUST 为连接与响应体读取设置有界总时限。诊断 MUST 区分用户取消与请求 deadline 超时，并将 request 与 usage 关联到一致的终态和安全错误码；MUST NOT 保存自由形式错误文本、响应正文或凭据。

#### Scenario: Provider 连接停滞
- **WHEN** Provider fetch 在连接期间超过总时限
- **THEN** 请求终止并记录 failed/request_timeout，usage 状态为 failed，且保留同一 request ID

#### Scenario: Provider 流停滞
- **WHEN** SSE 响应体在收到结束标记前超过总时限
- **THEN** 请求终止并记录 failed/request_timeout，不将部分响应标为 completed

#### Scenario: 用户取消模型请求
- **WHEN** 用户在 deadline 前取消正在进行的请求
- **THEN** 请求与 usage 记录 interrupted/request_cancelled，不将用户取消误记为 timeout
