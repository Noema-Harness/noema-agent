# DSH 技能镜像

本目录是 DeepSeek Harness 的项目级技能根（`<项目根>/.dsh/skills`）。技能内容由 `.codex/skills` 生成，不要在这里直接编辑。

```powershell
npm run skills:sync   # 从 .codex/skills 逐字节镜像
npm run skills:check  # 校验镜像；已纳入 npm run check
```

编写或评审技能请在 `.codex/skills` 完成，然后同步。两套 harness 的完整对照、用户级导入和工具链说明见 [harness 对齐说明](../docs/HARNESS_ALIGNMENT.md)。

为什么提交镜像而不是使用链接：Windows 下链接在干净检出、Git 配置和不同文件系统间不稳定；镜像加上校验能在任何 DSH 会话中直接发现，也能在评审中看到实际内容。
