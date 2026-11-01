# Design

## Context

参见 proposal.md。当前聊天搜索结果按消息展示；点击结果后关闭弹窗会清空查询词，而时间线只接收消息 ID 并滚动定位。`ChatMessage` 使用 ReactMarkdown 渲染，直接重写消息节点以插入 `<mark>` 会与其 DOM 生命周期冲突。

## Goals / Non-Goals

**Goals:** 将当前聊天搜索的原词带到时间线，在选中消息的正文文本范围上标亮所有匹配位置；开始新搜索或切换房间时清除高亮。

**Non-Goals:** 不改变侧栏筛选、全局搜索、群聊消息投递、搜索排序、消息存储或历史加载方式；不改动气泡与 Markdown 排版；不引入新依赖。

## Decisions

- 导航状态使用 `{ messageId, query }`，与关闭弹窗时清空的输入状态分离。其他来源跳转继续使用现有纯消息 ID 状态，不混入搜索语义。
- 使用 Electron Chromium 的 CSS Custom Highlight API，在目标 `.message-content` 的文本节点中创建 Range。这样保留 ReactMarkdown 所有现有节点和链接行为，也能标亮跨不同 Markdown 元素渲染的命中。
- 只扫描命中消息的正文，不扫描作者、时间、引用来源和操作按钮；同一消息内的所有文字命中均标亮。
- 高亮作为临时导航状态：新开当前聊天搜索时先清除，房间切换和组件卸载时清除；仅关闭搜索弹窗不会清除，避免跳转后高亮立即消失。
- 沿用当前聊天搜索独立结果列表和消息级导航。OpenCode 的会话查找也将定位与消息时间线表现结合；Noema 只补这一处正文定位，不扩展成全局查找栏或额外消息控件。

## Risks / Trade-offs

- 若文本经过 Markdown 解析后不可见或跨节点分割，源码子串可能无法形成 DOM 范围；逐个文本节点搜索可以覆盖常规行内格式，但不跨元素拼接文字。验证加入带重复命中的长消息与 Markdown 行内分段样例。
- Electron 固定引擎支持 CSS Custom Highlight API；若运行环境缺少 API，将只保留滚动/聚焦行为，定向 E2E 会失败，促使支持边界显式暴露。

## Migration Plan

无持久状态或数据迁移。改动随 renderer 更新生效；回退时移除临时高亮及对应搜索跳转状态即可。
