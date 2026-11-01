# Noema 工作方式

## 开发与维护

正式开发交付产品能力；维护让当前成果可接手、可运行、可核查和可交付。用户级 `development-maintenance` 提供共同入口，OpenSpec 保持为变更工具；本页记录 Noema 的选择和实际命令，其他机器可直接依此工作。

维护随恢复、范围变化、可交付增量与交接发生，不为每次编辑建立管理记录。代码可用、提交、远端同步、合入与发行分别依据实际证据判断；change 归档不能代表源码已合入或应用已发布。

## 一个方向入口，一份变更记录

阶段方向与退出条件见 [ROADMAP](ROADMAP.md)；具体工作由 OpenSpec change 管理。GitHub 保留源码、PR、发行与外部 Issue；原 Project 已封存，不再建立卡片、同步状态或重复续接点。

续接时先检查 Git 状态和当前 change，沿 `.codex/workspace.json` 中的当前文档入口恢复相关背景。只追溯与当前问题有关的历史，不能把旧记录的详细程度当成可信度。

用户反馈改变范围时，修订当前 change；小修可直接完成。交付证据与任务记在 change，重要阶段变化才更新 ROADMAP。用户价值与关键审美由用户判断，常规工程选择自行承担。

## 文档生命周期管理

`.codex/workspace.json` 指定哪些文档承担当前职责、何时需要更新。新增正式文档先明确它替代或补足哪个入口；能在现有文档的一处表达就不另建目录。代码变化只更新受影响的内容，不为刷新日期改写整篇。

## 资料各自的权威范围

- `openspec/specs/` 是已实现且仍应成立的可观察行为契约。规格以当前源码和自动化验证为依据；产品方向与未定构想不能直接写成已实现行为。
- `openspec/changes/<name>/` 是正在发生的行为差异：proposal 说明原因和范围，spec delta 写变化后的契约，design 写实现选择，tasks 记录验证与交付。变更完成后归档；`changes/archive/` 只作历史，不覆盖当前 specs。
- `docs/PRODUCT_CHARTER.md` 记录长期方向和高层取舍；`docs/ROADMAP.md` 管阶段顺序和退出条件；`docs/ARCHITECTURE.md` 是代码导航；核心流程图解释角色和机制如何衔接，并标出已实现程度。这些文档不能替代细粒度行为规格，也不重复列 change 任务。
- 根 `AGENTS.md` 是自动加载的短协作契约和导航入口；根 README 面向安装和项目导航，CONTRIBUTING 面向外部贡献者。后两者不会因为位于根目录就自动成为当前开发上下文。按 `.codex/workspace.json` 选择本项相关材料，不把所有文档一并注入。

`workspace:check` 只检查文档是否登记、路径和链接是否存在，以及 OpenSpec 基线是否仍有规格文件；它不能判断语义是否过时。行为变化必须在对应 OpenSpec change 更新 delta，并由测试核对契约；稳定后归档应用到 specs。只改方向、阶段计划或代码导航时，按 manifest 的触发条件更新相应 docs，不复制行为规格正文。不要把 change 原文复制进 docs。

当前 OpenSpec 基线只覆盖已经有明确自动化证据的聊天、专业成员和项目协作核心切片，不代表 Noema 全部能力已经规格化；其他领域在对应功能发生实质变化时，根据当前代码与测试补入基线。

`docs/decisions/README.md` 是 ADR 的使用规则，`TEMPLATE.md` 是新增决策的格式，两者属于维护入口；各编号 ADR 是只读决策历史，不代表当前源码必然仍按其实现。需要引用 ADR 时，先检查后续 ADR、当前 OpenSpec、产品章程、架构和代码；当前依据优先，过时结论通过新 ADR 明确取代，不批量翻修历史正文。新 ADR 仅记录跨变更持久的取舍；单次实现方案留在 OpenSpec。

过程文件进入 `.work/<主题>/`，运行产物进入 `.work/runs/`；结论被采用后进入正式代码或文档，余下材料可清理。保留的历史有明确只读标记。用户数据库、凭据、依赖和必要 fixture 不作为普通过程材料处理。

## 可执行入口

- `npm run check`：结构、格式、类型和服务测试的交付检查入口；日常改动先做相关验证。
- `npm run source:check`：检查源码环境边界、循环和导入，避免恢复成平铺结构。
- `npm run workspace:test`：检查清理预览、链接边界与历史保留。
- `npm run workspace:check`：检查目录、文档分类、当前文档链接及误提交的过程材料；已加入 CI。
- `npm run workspace:clean`：预览 runs/scratch；追加 `-- --apply` 才执行。`-- --generated` 可包含标准构建产物，执行前停止使用这些产物的开发进程。归档和依赖不在清理集合中。
- `scripts/gh-direct.ps1` / `scripts/git-direct.ps1`：GitHub 与 Git 入口。入口先探测已配置代理：代理可用时让 GitHub 流量经过代理，Git 使用 OpenSSL 后端；否则才尝试直连。源码发布后核对远端 SHA，当前 Actions 账户阻断与源码同步分开处理。

批量整理先保存清单并核对备份，操作使用明确来源与目标。若宿主在启动命令前返回 blocked by policy，应与 Windows ACL/文件占用区分，检查拒绝理由及可缩小的操作范围，不盲目提权或通过其他执行器重复被拒绝的动作。

并行工作使用独立 worktree，先约定共享边界。实际工具、截图与打包说明按需见 [运行资料](../.codex/skills/noema-project-work/references/runtime.md)。
