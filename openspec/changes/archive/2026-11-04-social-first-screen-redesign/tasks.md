# Tasks

## 1. 首屏与输入区

- [x] 1.1 以真实连接状态显示简洁主聊空状态，提供可用的连接、开始聊天和项目动作；用 Electron 原生截图确认状态文案与输入区构图。
- [x] 1.2 移除首屏创作者引介及设置里的重播入口，保留未改动的数据/提示兼容；确认 renderer 无剩余引用。
- [x] 1.3 将模型状态提示改成无色条的内联状态行并避免空聊重复；Electron smoke 检查无模型和已有内容布局。

## 2. 导航与搜索

- [x] 2.1 给成员/项目空分类添加就地新建动作，个人区直达现有记忆/回访/设置功能；检查按钮可访问名称及关闭后的焦点返回。
- [x] 2.2 重新命名设置入口，修正归档行图文对齐并以文字标识当前聊天查找范围；Electron 截图检查侧栏与搜索作用域。

## 3. 视觉系统和集成

- [x] 3.1 整理主聊、侧栏、composer 和设置表面的色彩、间距、边界与交互状态；截图检查长文本、窄窗和焦点反馈。
- [x] 3.2 完成 typecheck、受影响文件 lint 和 `npm run smoke`，检查 Electron 原生 before/after 首屏截图与 `git diff --check`。
- [x] 3.3 复核 OpenSpec strict、测试状态并检查最终 diff 未碰诊断/角色命名等既有未提交改动。

## Workflow follow-up

- Archive the change after implementation and validation are complete.
