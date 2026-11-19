# 任务

## 1. 分类提示

- [ ] 1.1 `scripts/maintenance.mjs` 新增 `changeScope(staged)`，按路径分四类并给出路径与要求（验证：`node --test scripts/maintenance.test.mjs` 31/31；`precommit` 第一行输出分类）
- [ ] 1.2 `checkPrecommit` 把分类提示放在 notices 最前（验证：同上）
- [ ] 1.3 测试补三条分支（自由/行为/条目数据）（验证：`scripts/maintenance.test.mjs` 新增用例通过）

## 2. 文档与视图

- [ ] 2.1 `governance/README.md` 边界一节补「机器管到哪、人管到哪」表（验证：`node scripts/maintenance.mjs docs` OK）
- [ ] 2.2 `scripts/decisions-view.mjs` 旧格式条目单列、标注只读与重生成方式（验证：`npm run decisions:view` 输出「3 个开放条目 · 21 个已收口 · 34 个旧格式条目」）
- [ ] 2.3 治理图按章节判断重出（验证：`npm run figure:check` OK，source `2fb1f8f6ee10`）

## 3. 收口

- [ ] 3.1 `npm run check` 全绿（验证：901/901，milestone OK）