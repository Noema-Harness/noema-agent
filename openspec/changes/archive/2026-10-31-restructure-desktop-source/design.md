## Context
Electron 官方进程模型与 Goose 桌面源码提供运行边界参照，OpenCode 以 session/tool/provider 等能力组织业务。本次复用这些边界和现有实现，不移植其完整框架。开始时有 9 份业务源码/测试及流程图未提交，已保存完整差异与源码副本。
## Decisions
保持模块化单体；顶层 main/preload/renderer/shared 区分 Node/Electron 与浏览器，main 内按 agents/chat/projects/providers/execution/platform/storage 等实际职责组织，renderer 按已有用户功能组织。共享区仅放跨进程契约和无平台依赖的逻辑。明确入口与直接依赖，不引入容器、微服务、通用插件框架或层层 barrel。
优先拆开职责混杂的大文件：测试探针退出生产启动主体，旧界面退出默认渲染入口，聊天工具协议与消息呈现独立。数据库及运行状态所有权保持，重构不趁机重新设计产品。
## AI maintainability
模块名对应问题和用户能力；主入口只组装，测试/fixture 有独立归属。用实际依赖检查限制环境反向依赖及循环，不靠提示词、目录树或硬性行数保证结构。架构导航直接链接代码，不另建维护台账。
## Migration and verification
先取得基线、处理已知验证失配并单独 checkpoint，再机械迁移导入、分离职责。复用 TypeScript AST 解析现有依赖，无新运行时依赖。类型、现有服务测试与真实 Electron 启动/打包分别验证；结构性回归纳入检查。保留当前视觉与已有测试覆盖，不以修改测试掩盖行为退化。
## Exit conditions
源码不再根部平铺，构建与测试能从新入口运行；主入口不再承载大段 E2E 场景，默认渲染不展开旧界面主体；至少关键混合职责已拆开，环境边界有可执行检查；旧路径无兼容空壳堆叠，当前架构/阶段入口与源码同步。
