# Inbox bridge

把**任意外部来源**的新事件送进 DSH 对话：CI 失败、issue 评论、邮件、脚本输出——只要一条命令能把事件打成约定 JSON。

## 它解决什么

普通通知插件是“出站”：任务结束响一声。这个插件是“入站”：外部世界发生的事，在你没有打扰它的前提下，变成下一次对话步骤里的一段上下文，并且带处理状态——**提醒过不等于处理过**。

- 默认每 **2 分钟**轮询（可配），空闲时几乎不耗资源；
- 注入用 `agent.inject()`：不唤醒空闲的 agent，只在下一个真实步骤前进入上下文；
- 注入后标记 `delivered`；超过 **6 小时**仍未处理会再提醒一次，直到 ack 为 `done`；
- 同一来源的“恢复”事件（例如后续 CI 通过）会自动把旧失败标 `done`；
- 无法靠改代码解决的基础设施错误（如额度导致的 `startup_failure`）只提醒一次并自动收口，不反复打扰；
- 只关注**当前仓库**：从工作区 `origin` 推断 `owner/name`，也支持显式 `repo`；工作区没连仓库时，最多每 12 小时提示一次“收件箱不可用”，由 agent 转告用户。

## 约定

poll 命令 stdout 必须是一行 JSON：

```json
{ "events": [
  { "key": "ci:43795229547", "kind": "ci", "ref": "run 43795229547",
    "title": "verify failed", "url": "https://github.com/..." }
] }
```

- `key` 必填且稳定，用于去重与 delivered/done 状态；
- `kind / ref / title / url / group` 可选；`group` 用于把同组事件自动收口（例如同 workflow+branch）；
- `kind: "infra"` 表示基础设施异常，投递一次即 `done`。

ack 命令会收到环境变量 `INBOX_BRIDGE_KEYS`（JSON 数组，刚注入的 key）与参数：默认标记 `delivered`；追加 `--done` 时标记 `done`。

## 配置

```yaml
- insert:
    - id: inbox-bridge
      name: dsh-inbox-bridge
      config:
        label: 外部收件箱
        cwd: C:/Users/NUC/Desktop/noema
        intervalMs: 120000        # 轮询间隔
        resurfaceMs: 21600000     # delivered 未处理后多久再提醒（6 小时）
        offlineReminderMs: 43200000 # 没连仓库时最多多久提示一次（12 小时）
        repo: null                # owner/name；null 时从 cwd 的 git origin 推断
        timeoutMs: 45000
        maxEvents: 6
        poll:
          command: node
          args: [scripts/inbox-bridge.mjs, poll]
        ack:
          command: node
          args: [scripts/inbox-bridge.mjs, ack]
```

`command: node` 会使用 DSH 自己的 Node（`ELECTRON_RUN_AS_NODE=1`），不要求系统 PATH 里有 node。

## 安装

```powershell
dsh plugin add <本目录>
# 或：Plugins 面板 → Add plugin → 选择本目录
```

改完插件代码需要重启 DSH（模块在新代加载）；本地目录安装是 link，不需要重新拷贝。

## 验证

1. 安装后重启 DSH；打开任意会话，等一个轮询周期。
2. 若有新事件，下一段上下文会出现「外部收件箱（后台轮询，不是用户提问）」。
3. `npm run inbox` 查看状态（pending / delivered / done）；处理完运行 `npm run inbox:ack --done -- <key>`。
4. 日志：`<cwd>/.work/inbox-bridge/plugin.log`。

## 边界

- 不负责抓取：来源由 poll 命令决定，插件不内置任何 API。
- 不负责调度持久化：插件随 DSH 运行；DSH 关闭时不轮询。
- 不负责“处理完”的判定：ack 由对应仓库脚本实现，插件只传 key；不会改动 GitHub 网页上的未读状态。
- 不替代测试与 CI 结论：它只是把外部事实带进对话。

## 发布

仓库里这一份是本地 link 版本（`private: true`）。发布到插件市场需要在 npm 发布同名包、把 `private` 改为 `false`，并保留 `dsh.bundle.patch` 声明。
