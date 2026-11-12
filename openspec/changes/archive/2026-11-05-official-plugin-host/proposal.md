# Proposal

## Why

Noema 一期需要为未来独立的官方学习插件留出可维护的宿主边界，但当前显式 main composition 尚无业务插件契约。现在补齐最小生命周期、隔离状态和诊断接口，避免学习系统开发时直接耦合主应用内部实现。

## What Changes

- 建立随 Noema 应用发布的官方插件清单与版本化宿主契约。
- 为每个官方插件提供独立启停状态、命名空间数据与迁移边界。
- 将插件启动、停止、迁移与兼容性失败隔离在插件自身，并连接全局诊断。
- 只向插件提供显式声明且宿主认可的 capability；不引入第三方代码安装或任意动态加载。

## Capabilities

### New Capabilities

- `official-plugin-host`: 官方插件声明、兼容性、capability 授权、启停、隔离存储迁移和诊断生命周期。

### Modified Capabilities

无。

## Impact

- 影响 main composition、共享契约、SQLite 插件状态表和全局诊断事件。
- 不修改 Social、Root/Legacy、执行 agent 或 team 的现有 owner；不引入插件市场、第三方安装器、运行中任意代码加载或安全沙箱声明。
