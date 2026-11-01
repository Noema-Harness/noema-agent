# Design

## Context

当前脚本把 GitHub 域名始终加入 `NO_PROXY`。在本机 VPN fake-IP 路由下，直连到 `198.18.0.61` 的 Schannel 握手失败；设置 `http.proxy=http://127.0.0.1:7888` 后仍需覆盖仓库/全局的 Schannel 选择为 OpenSSL。代理路径已实测通过远端读取与推送。

## Goals / Non-Goals

**Goals:** Git 与 GitHub CLI 复用当前已配置且可达的 HTTP(S) 代理；在代理不可用时仍保留直连路径；不改系统和全局 Git 设置。

**Non-Goals:** 探测或切换 VPN 节点、修改用户网络代理、对任意网络故障盲目重试、将凭据写入仓库或命令日志。

## Decisions

- 逐一探测进程及用户环境中配置的 HTTP(S) 代理，选择首个 TCP 可达者；选择代理时移除 GitHub 域名的 `NO_PROXY` 绕行，并将环境代理导出给 `gh`。
- `git-direct.ps1` 仅在探测到代理时，对单次 Git 进程传入代理和 `http.sslBackend=openssl`；不更改持久 Git 配置。无可达代理时才加入 GitHub `NO_PROXY` 并直连。
- 不自动重试写操作。传输失败后先核对远端 ref，避免把结果不明误判为未提交。
- 入口通过实际 `ls-remote`、推送与远端 SHA 核对验证；`gh` 使用相同代理环境，不增加另一套传输脚本。

## Risks / Trade-offs

- 代理 TCP 端口可达不代表上游一定可用 → 仍需由原 Git/gh 操作报告真实结果；失败时保留可见错误。
- 代理不可用时直连仍可能因 VPN fake-IP 失败 → 此时保留明确的连接错误，不掩盖为认证或权限问题。
- 代理地址可能含认证信息 → 不打印完整代理 URL，不将其保存到文件或 Git 配置。

## Migration Plan

无需迁移。仓库包装脚本即时生效；回滚时恢复脚本和对应运行说明。未修改全局/系统网络设置。
