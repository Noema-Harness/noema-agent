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

README 维护安装与导航，不维护开发进度；行为约定用 OpenSpec，代码导航用 ARCHITECTURE，产品边界用 PRODUCT_CHARTER，逻辑用核心流程图。它们承载跨变更仍有效的当前依据，不与 OpenSpec 冲突：具体变更期间的范围、方案、任务和验证写在 change；其中被验证且仍需长期成立的结果，再回写到对应的长期入口。不要把 change 原文复制进 docs。

`docs/decisions/README.md` 是 ADR 的使用规则，`TEMPLATE.md` 是新增决策的格式，两者属于维护入口；各编号 ADR 是只读决策历史，不代表当前源码必然仍按其实现。需要引用 ADR 时，先检查后续 ADR、当前 OpenSpec、产品章程、架构和代码；当前依据优先，过时结论通过新 ADR 明确取代，不批量翻修历史正文。新 ADR 仅记录跨变更持久的取舍；单次实现方案留在 OpenSpec。

过程文件进入 `.work/<主题>/`，运行产物进入 `.work/runs/`；结论被采用后进入正式代码或文档，余下材料可清理。保留的历史有明确只读标记。用户数据库、凭据、依赖和必要 fixture 不作为普通过程材料处理。

## 可执行入口

- `npm run check`：结构、格式、类型和服务测试的交付检查入口；日常改动先做相关验证。
- `npm run source:check`：检查源码环境边界、循环和导入，避免恢复成平铺结构。
- `npm run workspace:test`：检查清理预览、链接边界与历史保留。
- `npm run workspace:check`：检查目录、文档分类、当前文档链接及误提交的过程材料；已加入 CI。
- `npm run workspace:clean`：预览 runs/scratch；追加 `-- --apply` 才执行。`-- --generated` 可包含标准构建产物，执行前停止使用这些产物的开发进程。归档和依赖不在清理集合中。
- `scripts/gh-direct.ps1` / `scripts/git-direct.ps1`：GitHub 与 Git 入口。源码发布后核对远端 SHA，当前 Actions 账户阻断与源码同步分开处理。

批量整理先保存清单并核对备份，操作使用明确来源与目标。若宿主在启动命令前返回 blocked by policy，应与 Windows ACL/文件占用区分，检查拒绝理由及可缩小的操作范围，不盲目提权或通过其他执行器重复被拒绝的动作。

并行工作使用独立 worktree，先约定共享边界。实际工具、截图与打包说明按需见 [运行资料](../.codex/skills/noema-project-work/references/runtime.md)。
