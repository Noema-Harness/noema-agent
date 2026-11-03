# Tasks

## 1. Windows policy compiler

- [x] 1.1 新增纯函数 Windows grant-to-policy compiler，验证 backend capability、Windows 本地路径范围、workspace/external/runtime read grants、cwd 与网络模式；拒绝时返回稳定 reason code，并用 Node 单测覆盖最小授权、越界路径和缺失能力。
- [x] 1.2 复核 compiler 输出不含 command/env 内容且拒绝结果不含未限界自由文本；由单测断言输出字段白名单与错误类型。
- [x] 1.3 建立 D2 grant→Codex policy 映射卡，逐项列出授权字段、backend evidence 与拒绝条件，并核对固定源码链接和 D1 来源卡。

## 2. 执行边界与规格

- [x] 2.1 将 compiler 单测接入 desktop 标准 test discovery，并验证原 Windows support gate 仍在用户授权提示、sandbox 初始化和 spawn 前拒绝请求。
- [x] 2.2 运行 OpenSpec validate 与受影响的项目命令沙箱测试，修正规格/实现偏差并记录实际测试结果。
