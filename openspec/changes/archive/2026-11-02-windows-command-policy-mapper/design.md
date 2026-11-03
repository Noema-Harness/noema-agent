# Design

## Context

`project-command-sandbox.mjs` 当前在 Windows 上先通过 support gate（目前一律拒绝），然后把 workspace、经用户同意的外部路径与少数运行时路径组成 SRT filesystem config；网络则由 SRT callback 按命令中的 `host:port` 询问。这个配置对象本身不是 Windows enforcement 证明。D1 已确定后续 runner 为 Noema 自有的 Codex-source-derived bridge；Codex profile/compiler、sandbox identity、ACL/WFP 与 helper setup 需拆开维护，且普通 WFP provisioning 失败不满足 Noema 的 fail-closed 要求。

## Goals / Non-Goals

**Goals:**

- 形成纯、可单测的授权编译边界：输入是已获用户同意的结构化 grant 与 backend 能力证明，输出是 backend 可消费的最小 policy，或明确拒绝。
- 将“路径文本已规范化”与“backend 可证明 OS 对象身份并限制该对象”区分开；编译器不把路径字符串检查当安全证明。
- 保持 Windows gate 关闭，直至后续 runner 集成、setup 和打包阶段满足完整能力门槛。

**Non-Goals:**

- 本 change 不接入 Codex Rust 源码、不安装账号/ACL/WFP、不生成 setup helper，也不运行 Windows runner。
- 不改变 Linux/macOS 沙箱，不开放交互式 stdin/TTY，不设计 UI 授权流程。

## Decisions

1. **采用独立的纯 policy compiler，而不是把新映射直接塞进 SRT config。** 输入由 workspace grant、逐项外部 read/write grant、可信 backend runtime read roots、cwd、network mode/destinations 和 request identity 组成；输出为明确版本的 policy。选择该边界是因为当前 SRT policy 不携带 Codex runner 所需的 identity、对象句柄及 WFP setup 结果。替代方案是继续扩展 SRT `filesystem/network` 配置；由于 D1 已记录的 SRT Windows enforcement 缺口，这无法建立可信的跨 backend 契约。

2. **能力采用显式、默认缺失的声明。** compiler 仅在 backend identity、policy version、filesystem read/write confinement、path object validation、cwd/env confinement、network default-deny 与 identity-bound network control 等必需 capability 均明确为 supported 时接受请求；unknown 与 false 均拒绝。替代方案是以 OS 版本或 backend 名称推断支持；这些只能说明环境候选，不能证明本次 setup 完整。

3. **文件权限采用 allow-root 的最小投影。** workspace 是 read/write root；外部 read grant 仅进入 read roots，write grant 同时进入 read 与 write roots；backend 提供的受信任 runtime roots 只读。拒绝磁盘根、UNC、越出授权边界的 cwd、重复冲突 scope、无效权限和未通过 backend object-identity preflight 的路径。路径比较采用 Windows 规则只辅助拒绝，不宣称取代 handle-based identity/reparse/ACL enforcement。替代方案是复制 Codex broad default roots（含整类 ProgramData/Profile 路径）；这会超出 Noema 明确授权范围。

4. **网络模型保留当前“按目的地询问”的授权语义，但输出为 command-scoped policy。** 无网络请求映射为 identity-bound deny-all；需要联网时映射为 identity-bound broker/prompt policy，只能由负责该 request identity 的 broker 放行用户批准的 `host:port`。无 proxy identity、broker/default-deny capability 或可验证 setup 结果时拒绝。替代方案是将批准写成全局域名 allowlist；这会让一个命令的同意泄露给其它命令，且不能满足现有按命令缓存语义。

5. **拒绝结果结构化并保持业务入口关闭。** compiler 返回稳定的拒绝 code 与有限字段（policy version、backend id、capability/reason code）；不得附带 command text、环境值或路径进诊断事件。当前执行入口仍在授权提示与 runner 初始化前拒绝所有 Windows host；映射被测通过不能改变此 gate。Linux/macOS 继续使用现有 SRT 路径。

## Risks / Trade-offs

- [compiler 输入的 capability 声明可能与实际 runner 行为不符] → 后续 runner 只允许由启动探测/setup 状态生成 capability，不接受 UI 或 command 请求自报；D3/D4 对照固定 Codex 源码与目标机行为核验。
- [Windows 路径规范化存在大小写、reparse、hardlink、短名及卷映射等别名] → compiler 只做语法/范围过滤；必须要求 backend 的 handle-based 对象验证和 ACL 投影 capability，无法确认时拒绝。
- [网络 broker 与 child identity 绑定尚未实现] → compiler 仅描述所需 policy；不以 SRT callback 或静态配置冒充 OS 边界，Windows gate 保持关闭。
- [实现者可能将未来 policy compiler 误用于当前 SRT 启动] → API 使用 backend-neutral grant 输入与 Codex policy 输出版本；当前 SRT 调用点不接收该输出，且支持检查明确拒绝 Windows。

## Migration Plan

1. 新增 policy compiler 与纯单元测试，不改变现有 command runtime。
2. 在同一 change 内确认 mapper 输出覆盖 project-execution delta 的拒绝与最小授权场景；正常 Windows host invocation 仍由旧 support gate 阻断。
3. 后续 runner change 显式消费 policy v1 并实现能力探测、OS setup 与诊断；在后续验收达标前不开放 Windows 执行。
4. 若 mapper 发现未覆盖 grant 类型，拒绝该类型并扩展版本化契约；不回退到 SRT 或宿主执行。
