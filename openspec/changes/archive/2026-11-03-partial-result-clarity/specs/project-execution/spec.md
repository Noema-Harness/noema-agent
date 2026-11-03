## ADDED Requirements

### Requirement: 未完成任务的已保存文本明确标记为阶段内容
项目任务界面 MUST 区分成功完成的执行结果与 failed、interrupted 或仍活动任务中的已保存文本。未完成任务 MUST 显示其未完成状态及现有恢复/检查提示，且 MUST NOT 将阶段文本称为成功交付。

#### Scenario: 完成任务显示执行结果
- **WHEN** task status 为 completed 且存在结果文本
- **THEN** task card 将文本标为执行结果，并保留独立核验状态说明

#### Scenario: 用户停止任务后有部分文本
- **WHEN** task status 为 interrupted 且存在已保存文本
- **THEN** task card 将其标为停止前保存的部分内容，并说明任务未完成

#### Scenario: 失败任务保留部分输出
- **WHEN** task status 为 failed 且存在已保存文本
- **THEN** task card 将其标为未完成任务的已保存内容，并同时呈现失败原因和恢复提示

#### Scenario: 续接期间仍保留前序文本
- **WHEN** task 正在安全 checkpoint 续接且已有前序已保存文本
- **THEN** task card 明确说明当前任务尚未完成，文本为已有阶段内容，当前执行阶段由 task status 展示
