# Proposal

## Why

阶段 3 要求 Windows shell 命令能够读取已授权 workspace、但不能修改它；当前编译器却始终把 workspace 放入 write roots，grant compiler 也拒绝空 write roots。需要补上明确的只读策略，并让 OS ACL 与 native admission 确认零写权限后才允许创建子进程。

## What Changes

- 为 Windows command filesystem policy 增加显式 `read-only` / `read-write` 模式；当前 Social command caller 固定请求 `read-only`。
- 只读模式只把 workspace、获准外部读取根和 runtime 根放入 read roots；write roots 必须为空，外部写授权在 spawn 前 typed deny。
- 保留明确 `read-write` 的 runner contract，供阶段 5 的隔离副本方案接入；不得由缺省值或 renderer 参数启用。
- 同步 JS compiler/grant、Rust native policy admission 和 policy version；无效模式、版本不匹配、越权 grant 均在 ACL/child side effect 前拒绝。
- 以真实 Windows AppContainer 子进程证明只读命令可读取 workspace，但写入被 OS 拒绝且目标文件未创建。

## Capabilities

### Modified Capabilities
- `project-execution`

## Impact

涉及 Windows command policy/compiler、capability grants、runner execution service、native helper 的 policy version parser、Rust policy validation 与 ACL-grant 核验、OpenSpec `project-execution` 契约及 Node/Rust/Windows live acceptance。Social file tools、文件修改 journal、Root/DSH 退役边界与 command writeback 不在本变更范围。
