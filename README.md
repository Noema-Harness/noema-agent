# Noema

Noema 是给一个账号的长期、可问责的个人 Agent。Noema 是唯一对结果负责的实体；执行者有可见的常驻私聊，专家、群聊、项目和团队按需出现，但不制造第二个人格或第二套组织架构。

两者共用同一套个体结构：Core、Policy、Competence、Tool Grants、Memory、Context；岗位、团队、项目是外部关系，不是内部模块。

当前可安装版本、已知问题和下一步，只看 [STATUS](docs/STATUS.md)。产品为什么存在、服务谁、不做什么，看 [PRODUCT](docs/PRODUCT.md)。

## 快速开始

要求 Node.js 24.21.x（`>=24.21 <25`）和 npm。

```powershell
npm ci
npm run dev
```

提交前运行：

```powershell
npm run check
```

`check` 依次执行文档路由、技能镜像、源码边界、lint、类型检查和测试。打包与安装见 [OPERATIONS](docs/OPERATIONS.md)。

## 文档

仓库只保留八份常驻文档，一份文档只回答一类问题：

| 文档 | 回答 |
| --- | --- |
| [AGENTS](AGENTS.md) | 项目维护约定与不可违反的产品不变量 |
| [PRODUCT](docs/PRODUCT.md) | 用户、问题、产品模型、边界、成功标准 |
| [SYSTEM](docs/SYSTEM.md) | 模块、数据、边界、依赖和代码地图 |
| [BEHAVIOR](docs/BEHAVIOR.md) | 用户可观察的行为、错误、恢复和验收 |
| [DECISIONS](docs/DECISIONS.md) | 已采用的长期决定及理由 |
| [OPERATIONS](docs/OPERATIONS.md) | 开发、检查、打包、安装、回滚、诊断 |
| [STATUS](docs/STATUS.md) | 当前版本、可用/损坏、下一步 |

用户级协作约定在 `C:\Users\NUC\.dsh\AGENTS.md`，不在仓库内。历史由 Git 保存；不再维护 ROADMAP、INDEX、架构历史、ADR 树或阶段性总结。

## 目录

```text
apps/desktop/     Electron 桌面应用（主进程、preload、renderer）
apps/             workspace 内的其他应用
docs/             八份固定文档中的六份
openspec/         临时变更材料，阶段结束后清理
scripts/          仓库级检查、打包和迁移脚本
.work/            临时运行数据与过程材料，不提交
```

用户数据库、凭据和下载的参考源码不进入仓库。`.work/` 只用于本机过程材料，不能作为产品文档或交付依据。

## 当前状态

0.7.1 是已安装的实验版本，0.6.9 是可回退版本；0.7.2 只有源码，没有可安装包。Phase 1 的连续时间线/检查点已实现，编辑语义已定：用户消息截断重发，助手回复原地修改并保留后续消息；实现尚未完成，分支 UI 不作为产品界面。详见 [STATUS](docs/STATUS.md)。
