# 设计：决策记录存储分离

## 事实影响

- 类别：仅执行
- 依据：只改治理工具与治理文档的存储方式，不改产品行为、数据或对外承诺。`DECISIONS.md` 的渲染结果对协作者与 PR 复核保持等价。

## 用户决策

- 用户 2026-11-19 原话：「好的。这一次就不跑决策项的流程了，你直接开始执行阶段的流程吧」；同轮确认方向：条目变成可控数据、`DECISIONS.md` 退为视图，先做仓库侧，插件后置。

## 目标

1. 数据文件是唯一条目真相；markdown 是渲染产物。
2. 迁移可验证：迁移前后渲染出的文件逐字节等价。
3. 命令不再解析 markdown 正文；格式与命令解耦。
4. 用户只需要看两块：这次讨论了什么、有什么待裁决。

## 非目标

- 不改条目的语义（四态、四块、待裁/已定、验收项）。
- 不删除既有门与规则；本批只把它们改读数据文件。
- 不做 DSH 插件与浏览器 UI。

## 取舍

- **JSON 单文件 vs JSONL**：选单文件。条目会被频繁改写，JSONL 的单行超长会让 diff 与合并更难；单文件按 2 空格缩进，diff 定位到字段。
- **保存结构 vs 保存渲染文本**：保存结构（字段 + 三段正文文本 + 轮次）。三段正文保持文本形态，既让渲染逐字节等价，又不再由命令解析全文。
- **双写 vs 单写**：单写。只写数据文件，markdown 每次由渲染生成；手改 markdown 由写盘印记发现。
- **迁移一次性 vs 长期兼容旧格式**：一次性迁移，不保留旧格式解析路径。

## 数据模型（v1）

```json
{
  "version": 1,
  "entries": [
    {
      "id": "D-20261119-example",
      "title": "示例条目",
      "number": 42,
      "emoji": "⏳",
      "stage": "决策中",
      "fields": { "structure": "…", "source": "…", "blocker": "…" },
      "sections": { "decision": "…", "execution": "…", "acceptance": "…" }
    }
  ]
}
```

`sections` 保留 markdown 小节原文（标题行之后、下一个小节标题之前），渲染器按固定模板拼回，保证与迁移前逐字节一致。

## 命令与门

- `record`/`move`/`check`：读 store → 修改 entry → `saveStore` → 重渲染 → 校验（结构、历史只增、覆盖）。
- 写盘印记：记录 `governance/data/decisions.json` 与渲染后 `docs/DECISIONS.md` 的 sha256；`precommit` 比对，不一致提示「只走 npm run governance -- record|move」。
- `docs:check`：结构校验改读 store；`DECISIONS.md` 增加「渲染产物」头（不能手改）。
- 历史只增门：对 store 的 entry 比对上一版（git HEAD 的 JSON），而不是比对 markdown。

## 用户可观察的改变

- `docs/DECISIONS.md` 顶部出现「本文件由数据渲染，勿手改」的说明。
- 新增 `npm run decisions -- view`：生成 `.work/review/decisions-view.html`，两栏——讨论经过（按轮次折叠）、待裁决。
- 条目操作更快：不再因格式微调而失败。

## 手测步骤

1. `node scripts/migrate-decisions.mjs --check`：打印迁移前后文件等价结论。
2. `npm run governance -- record round --entry <D-…> --number N --conclusion "…" --changes "…"`：数据文件与 markdown 同步变化，`git diff` 可读。
3. `npm run decisions -- view`：生成 HTML，含讨论经过与待裁决两栏。

## 验收

- [ ] 迁移前后 `docs/DECISIONS.md` 逐字节等价（`migrate --check` 输出等价）。
- [ ] 命令只写数据文件并渲染；手改 markdown 被 `precommit` 拒绝。
- [ ] `npm run kernel:test`、`tools:test`、`docs:check`、`npm run check` 全绿。
- [ ] `npm run decisions -- view` 生成含「讨论经过」「待裁决」两栏的 HTML。
- [ ] 24 个条目、13 个轮次块在数据与渲染产物中数量一致。