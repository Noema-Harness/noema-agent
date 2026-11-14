# project-execution Specification

## ADDED Requirements

### Requirement: 项目执行只使用 DSH 运行时
项目成员与任务卡的本机执行 SHALL 通过 `SocialWorkService` 调用 DSH Headless。生产启动 MUST NOT 构造 `NoemaProjectExecutor` 或命令镜像执行器作为回退；DSH 不可用时 MUST 明确失败，不得改用旧执行器。

#### Scenario: 启动项目任务
- **WHEN** 用户或 Noema 为已绑定工作区的项目启动文件任务
- **THEN** 系统创建一个 DSH run，工作区身份、权限和验收仍由项目任务记录持有

#### Scenario: DSH 启动失败
- **WHEN** DSH runtime 或隔离设置不可用
- **THEN** 任务保持未启动或失败状态并给出有限原因，不调用旧 Noema 执行器

#### Scenario: 旧执行器导入
- **WHEN** 生产代码尝试从 `main/legacy/` 导入旧执行器
- **THEN** 源码边界检查失败，项目执行不能依赖该路径
