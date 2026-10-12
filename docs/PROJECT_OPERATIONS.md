# 项目协作与 GitHub Project

## 工作真相来源

- GitHub Issues：问题、目标、验收条件、执行记录。
- GitHub Project：状态、优先级与工作流视图；不在 `ROADMAP.md` 复制当前 issue 状态。
- `docs/decisions/`：长期产品/架构选择及其被替代历史。
- 产品和架构文档：当前契约与边界，不用于记录日常进度。

## 看板规则

- 只有有实质交付、需要跨会话跟踪或改变长期方向的工作才需要 issue；小型机械修订不制造流程。
- `Inbox` 尚未整理；`Todo` 已有目标和验收；`In Progress` 正在进行；`Review` 等待验证/用户判断；`Blocked` 有明确阻塞；`Done` 达成验收。
- 优先级只用来排序，不代表估时：P0 当前阻塞或基础关键，P1 下一阶段，P2 有价值但不挡路，P3 暂缓。
- 大任务拆成可独立验收的 issue。Epic 只做分组和目标说明，实际工作必须落到可交付子项。
- issue 完成后填入实际检查结果和文档/决策记录链接，再移动到 Done。

## Codex 工作流程

对长期、多文件或架构工作：从看板选取/创建 issue → 读对应产品/架构/ADR → 实施 → 针对性验证 → 更新 issue 与 Project。涉及产品承诺或外部副作用时，在 issue 里记录用户可见结果和边界。

Codex 项目指令放在根 `AGENTS.md`；特定流程放在 `.agents/skills/`，避免复制全局用户指令或把每项技术细节变成常驻 prompt。项目的 `.codex/config.toml` 只放这项仓库确实需要的设置，不覆盖用户模型、凭据或全局权限。

## 初始 GitHub Project

看板地址：创建后填入。

建议字段：Status、Priority、Workstream。不要建立相同含义的第二套状态/标签体系。Issues 和 PR 使用少量一致 labels；workflow 后续由真实痛点驱动添加。
