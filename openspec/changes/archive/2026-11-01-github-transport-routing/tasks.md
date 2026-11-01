# Tasks

## 1. GitHub 代理选择与持续维护

- [x] 1.1 更新共享 PowerShell 传输入口，探测多个已配置 HTTP(S) 代理；可达时为 GitHub 去除 `NO_PROXY` 绕行，不可达时回到原直连策略。
- [x] 1.2 让 `git-direct.ps1` 在代理路径覆盖 Git 的代理与 OpenSSL TLS 后端；不改变全局配置，验证实际 `ls-remote` 与 push。
- [x] 1.3 更新项目运行说明并记录 fake-IP、Schannel 与代理成功路径的证据；验证本地提交 SHA 与 GitHub 目标分支一致。
