# Inbox bridge

把**任意外部来源**的新事件送进 DSH 对话：CI 失败、issue 评论、邮件、脚本输出——只要一条命令能把事件打印成约定 JSON。

## 它解决什么

普通通知插件是“出站”：任务结束时响一声。这个插件是“入站”：外部世界发生的事，在没有打扰你的前提下，变成下一次对话步骤里的一段上下文。

- 轮询间隔默认 **2 分钟**（可改），空闲时几乎不耗资源；
- 注入用 `agent.inject()`，不会唤醒空闲的 agent，只在下一个真实步骤前进入上下文；
- 送过的通知会被标记 `delivered`，不会重复注入；处理完由 ack 命令标记 `done`，两边状态一致。

## 约定

poll 命令 stdout 必须是一行 JSON：

```json
{ "events": [
  { "key": "ci:43795229547", "kind": "ci", "ref": "run 43795229547",
    "title": "verify failed", "url": "https://github.com/..." }
] }
```

- `key` 必填且稳定，用于去重与 delivered/done 状态；
- `kind / ref / title / url` 可选，用来在注入文本里描述事件。

ack 命令会收到环境变量 `INBOX_BRIDGE_KEYS`（JSON 数组，刚注入的 key），用来标记 `delivered`。

## 配置

```yaml
- insert:
    - id: inbox-bridge
      name: dsh-inbox-bridge
      config:
        label: 外部收件箱
        cwd: C:/Users/NUC/Desktop/noema
        intervalMs: 120000
        timeoutMs: 45000
        maxEvents: 6
        poll:
          command: node
          args: [scripts/inbox-bridge.mjs, poll]
        ack:
          command: node
          args: [scripts/inbox-bridge.mjs, ack]
```

`command: node` 会使用 DSH 自己的 Node（`ELECTRON_RUN_AS_NODE=1`），不需要系统 PATH 里有 node。

## 安装

```powershell
dsh plugin add <本目录>
# 或：Plugins 面板 → Add plugin → 选择本目录
```

## 验证

1. 安装后重启 DSH（插件模块在新代加载）。
2. 打开任意会话，等一个轮询周期；若有新事件，下一段上下文会出现“外部收件箱（后台轮询，不是用户提问）”。
3. `npm run inbox` 查看事件状态（pending / delivered / done），`npm run inbox:ack -- <key>` 标记完成。
4. 日志：`<cwd>/.work/inbox-bridge/plugin.log`。

## 边界

- 不负责抓取：来源由 poll 命令决定，插件不内置任何 API。
- 不负责调度持久化：插件随 DSH 运行；DSH 关闭时不轮询。
- 不负责“处理完”的判定：ack 由对应仓库脚本实现，插件只传 key。
