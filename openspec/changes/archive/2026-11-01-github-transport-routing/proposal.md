# Proposal

## Why

GitHub 同步多次因 TLS 握手失败中断。现场证据显示本机 VPN 将 `github.com` 解析到 fake-IP，脚本却固定绕过代理直连；启用本机代理并用 Git OpenSSL 后端时，`ls-remote` 和推送均成功。每次人工临时覆盖环境会重复消耗开发时间，也容易让本地提交误以为已经同步。

## What Changes

- GitHub 入口先探测已配置 HTTP(S) 代理；可用时不绕过 GitHub，并让 Git 使用该代理与 OpenSSL TLS 后端。
- 仅在没有可达代理时保留 GitHub 直连路径。
- 同步仓库运行说明，明确该入口的传输选择与验证方式。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。仅调整本地维护脚本与运行约定，不改变 Noema 产品行为；本 change 使用 `skip_specs: true`。

## Impact

影响 `scripts/github-env.ps1`、`scripts/git-direct.ps1`、GitHub CLI 包装入口及相关本地运行文档；不修改全局代理或 Git 配置。
