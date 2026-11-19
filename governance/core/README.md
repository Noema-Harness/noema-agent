# 治理内核

Authority: 通用层能力（状态机、数据校验、规则包装配）的契约。
Update when: 内核模块、数据结构或校验规则变化。
Does not own: 项目路径、命令、门的具体实现（这些在 `scripts/` 与 `governance/noema/`）。

内核不出现项目专名或仓库路径（`docs:check` 会报错）；它只认「状态、范围、单元、任务、验收项、会话、日志」这些概念。

## 模块

| 模块 | 职责 | 不做什么 |
| --- | --- | --- |
| `state.mjs` | 状态机（讨论/执行/验收）、范围、验收单元、任务、D/C/R/H 验收与发现处置、讨论会话、切换日志、数据校验与 v1→v2 升级 | 不读盘、不知路径、不打印 |
| `packs.mjs` | 规则包 gate id 提取与缺失校验、恢复卡文本装配 | 不知规则包放哪、不知门从哪来 |

## 数据模型

```json
{
  "version": 2,
  "current": { "state": "讨论", "since": "2026-11-20", "threadId": "thread-20261119-1" },
  "work": {
    "scope": { "text": "一句话/设计稿/里程碑", "since": "…", "signed": { "text": "用户原话", "date": "…" } },
    "phases": [
      {
        "id": "P1", "name": "…", "goal": "…", "status": "进行中",
        "tasks": [{ "id": "P1-T1", "text": "…", "status": "未完成", "evidence": [] }],
        "acceptance": [{ "id": "P1-A1", "text": "…", "layer": "D", "status": "未验", "evidence": [], "resolution": null }],
        "review": { "what": "…", "gap": "…", "split": "…" }
      }
    ]
  },
  "threads": [{ "id": "thread-…", "title": "…", "status": "活动", "ending": null, "rounds": [], "waits": [] }],
  "log": [{ "from": "讨论", "to": "执行", "date": "…", "reason": "…", "obligation": "挂起", "threadId": "…" }]
}
```

- 阶段 2–5 个；任务 id `P<n>-T<m>`；验收项 id `P<n>-A<m>`；层只有 `D/C/R/H`。
- 进执行必须有 `work.scope`；进验收必须所有阶段已完成；签收必须有用户原话、D/C/H 全绿、R 全部处置。
- 离开讨论会自动归档会话（有设计稿+范围记「定案」，否则记「归档」）；回到讨论恢复最近归档会话并续编号。

## 违反内核边界

`governance/core/*.mjs` 出现 `noema`、`apps/desktop`、`docs/`、`.work/` 会被 `npm run docs:check` 拒绝；
这类内容放 `scripts/`（适配）或 `governance/noema/`（项目说明）。