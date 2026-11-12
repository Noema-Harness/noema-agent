# Design

## Context

参见 proposal。当前 `main.ts` 显式装配 core services，没有 Noema 业务插件注册表；`RootStore` 持有 SQLite 连接；诊断事件由 main 的全局 owner 写入。参考比较见 `.work/planning/research/noema/PLUGIN_BOUNDARY_COMPARISON.md`。

## Goals / Non-Goals

**Goals:** 为后续官方业务插件提供稳定 ID/API 版本、可关闭生命周期、命名空间状态迁移和全局诊断；插件故障不影响 core 启动。

**Non-Goals:** 不把 core feature 改成插件；不装载下载/工作区代码；不做第三方市场、安装器、热更新、独立插件进程或 OS 沙箱；不在此变更实现学习系统，也不授予模型、工具、文件系统或执行权限。

## Decisions

1. **应用代码注册，不做外部运行时发现。** Main composition 持有编译期官方注册表，manifest 校验是 API/兼容性检查而不是代码信任根。独立启停是运行状态，不表示本期提供插件包下载器。相较 DSH 的 package/profile manager，这避免为单一未来官方消费者引入 build script 审批、动态代码和更新回滚系统。
2. **只开放 `state` 与 `diagnostics` 两类初始 capability。** 宿主按已校验 capability 构造窄 context，不传 `RootStore.db`、IPC、credential、provider、runner 或通用 service locator。UI route、模型调用与工具注册需等未来消费者形成确切契约后再扩展，不预授权。
3. **使用 core SQLite 中按 plugin ID 分区的 KV 表。** Host-owned facade 限制插件读写自身 namespace；JSON 值和 key 均有长度/类型边界。Migrations 在单个 SQLite transaction 中运行，记录 namespace schema version；不暴露 raw database。禁用时保留数据，删除策略留待有具体官方卸载体验时决定。
4. **主进程宿主处理依赖拓扑与错误隔离。** 启动顺序按依赖先后，停止按相反顺序；缺依赖、循环、API mismatch、迁移/start/stop 异常均投影成稳定状态，失败插件及依赖者不可用，不抛出到 core startup。
5. **诊断接现有事件 owner。** 插件仅能发有限字段、稳定 plugin ID 和错误分类；宿主分配公共 action identity 并保护 diagnostic sink 故障。可信官方插件仍在主进程内运行，能力列表不是对恶意代码的沙箱。

## Risks / Trade-offs

- [同进程插件抛出不可恢复错误或卡死仍可能影响 main] → 当前只加载随应用发布的官方代码；生命周期回调必须有界并隔离普通异常。任意/第三方代码要另行设计进程边界。
- [KV 状态不足以表达未来学习数据关系] → 先把契约限制为 namespaced storage facade；具体学习 schema 到插件自身阶段再决定是否需独立数据库 owner，不向插件暴露 core SQL。
- [当前没有用户设置页面管理插件] → 本变更交付宿主 API、持久启停状态和内部 consumer fixture；面向用户的插件管理入口只在存在可安装官方插件时加入。

## Migration Plan

通过 `RootStore` schema migration 增加插件状态/键值/版本表；迁移只建新表，不改现有用户记录。插件尚未注册时默认无新增行为。回滚代码时保留新表和数据；不得在回滚中删除用户插件数据。
