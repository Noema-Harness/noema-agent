# 图门：章节级判断与“内容未变”拒绝

## Why

架构图的内容自 2026-11-15 的 `e47d4aa` 之后没有变过：`figure:check` 只比对源文档的 sha256，`figure:build` 只是把同一个 `candidate` 重跑渲染并回写摘要。门能发现“文档变了”，却无法发现“图落后了”，维护者因此可以反复“重出图”而内容原地不动。用户指出这个机制缺口（m102266）并要求图与机制一起修（m102317）。

## What Changes

- `scripts/figure.mjs`：`source.json` 记录图依赖章节的摘要（`source.sections`）与 `candidate` 的内容摘要（`source.candidateSha256`）；章节变了而 `candidate` 未变时，`build` 直接拒绝，除非用 `--sections-changed "<理由>"` 显式记录“图无需改”的判断。
- `figure:check` 增加章节漂移、`candidate` 手改两类失败。
- 重画两张图的内容：架构图补 bridge 传输、执行后端可换、当前只发布 Windows、伴侣客户端，去掉已不可考的“@Noema 跨房间”；治理图补“提示层”“事实流”两块区域标注。
- `docs/OPERATIONS.md` 更新图维护说明与三类失败修法。

## Impact

维护者的出图流程：改到图依赖章节后必须真的看图或留下判断记录，不再能只更新摘要。产品运行行为、数据与用户可见功能不变；CI 只是多了明确的失败提示。

Plan: none
