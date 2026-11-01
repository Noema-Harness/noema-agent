# specialist-agents Specification Delta

## MODIFIED Requirements

### Requirement: Noema 委派后仍向用户交付整合答复
系统 SHALL 允许 Noema 将适合的独立子任务交给专业成员，并把成员结果整合回用户当前请求；委派不得将成员回复伪装成用户发言。若 Noema 在成员结果已保存后、整合答复完成前失败，重试 MUST 复用已保存的成员结果，不得再次投递同一子任务。

#### Scenario: 专业成员完成子任务
- **WHEN** Noema 委派一项独立核查且成员返回结果
- **THEN** 用户在原请求下收到 Noema 的整合答复，成员身份和委派过程可辨认

#### Scenario: 成员结果已完成但 Noema 整合失败
- **WHEN** 专业成员的私聊回复已持久化为完成，而 Noema 的整合回复失败并由用户重试
- **THEN** 系统复用原成员结果并仅重新生成 Noema 的整合回复，不重复创建成员交办消息或调用成员模型

#### Scenario: 成员回复失败后重试主聊
- **WHEN** 成员交办消息已保存、成员回复失败或中断，而 Noema 主聊随后失败并被重试
- **THEN** 系统在原成员交办回合内重试成员回复，再由 Noema 生成整合答复
