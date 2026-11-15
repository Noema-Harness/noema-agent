# Tasks

## 1. 有界 renderer 房间契约

- [ ] 1.1 将 room page metadata 加入共享契约与 store snapshot，并让 renderer IPC 默认只取最近 200 条；验证调用方/返回结构静态一致且分页参数在 1–200 范围内。
- [ ] 1.2 让 room IPC 支持 beforeSequence 与 aroundMessageId 查询并返回 targetFound；验证错误输入在存储副作用前拒绝，内部非 renderer snapshot 调用维持既有语义。
- [ ] 1.3 增加按 room ID 隔离的全历史消息搜索，限制最多返回 50 条并保留现有全局搜索行为；验证同一关键词不会返回其它房间结果。

## 2. 对话历史 UI

- [ ] 2.1 在对话顶部提供“加载更早消息”及读取错误重试状态；验证首屏消息窗口不超过 200 条、连续分页无重复且出错保留已加载消息。
- [ ] 2.2 加载旧页后按新增内容高度修正 scrollTop；验证切房、请求乱序和组件卸载后迟到页不会覆盖当前房间。
- [ ] 2.3 当前聊天搜索改用 main 侧完整历史查询，提供 loading/empty/error/retry 状态；验证搜索词变化、切换房间和迟到结果不会混入当前结果。

## 3. 来源定位与失效反馈

- [ ] 3.1 全局搜索结果用 around-message 页面验证目标存在性并打开对应 project/room 上下文；验证目标失效时返回明确错误且不切换当前 room。
- [ ] 3.2 历史回忆来源直接读取 around-message 页面；验证房间/消息失效时显示 notice，且不会静默返回。

## 4. 阶段门输入

- [ ] 4.1 补充 store、IPC 和 renderer 测试及阶段2审计/进度证据；此工作包只准备验证覆盖，不运行测试，统一进入阶段2 gate 后执行。
