# design

## 事实影响

- 类别：仅执行
- 依据：只改开发环境与提交门的实现，产品行为、系统结构与取舍都不变。

## 用户可观察的改变

- 无产品界面变化；macOS 上开发时提交门与 lint 可以直接使用。

## 手测步骤

1. 在 macOS 上检出仓库，`git config core.hooksPath .githooks`。
2. 提交一次改动，确认钩子被执行而不是被忽略。
3. 在 main 更新后 `git merge origin/main`，确认提交门只检查这次合并自己解决的路径。

## 用户决策

- 无
