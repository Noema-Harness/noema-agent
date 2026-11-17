## 1. 技能

- [x] 1.1 新增 `skills/noema-governance/SKILL.md`：三种偏差分类 + 盘查六步（每步带产物）+ 反模式 + 真实案例信号 + 边界（验证：读目录，确认正常轮次不需要它）
- [x] 1.2 `skills/noema-development/SKILL.md` 定位不变，只在 description 保持“模板”（验证：文件未改定位段）

## 2. 同步机制

- [x] 2.1 `scripts/skill-sync.mjs` 改为 `SKILL_NAMES` 列表，`installSkills` 安装两份、`checkSkill` 逐份校验（验证：`node --test scripts/skill-sync.test.mjs`）
- [x] 2.2 补测试：两份安装、单份安装、一份漂移只在本地失败、缺源文件报错（验证：测试 5/5）
- [x] 2.3 `npm run skill:install` 实测两份都写到 `~/.dsh/skills`（验证：命令输出两行 `skill-install: OK`）

## 3. 文档

- [x] 3.1 `docs/OPERATIONS.md` 技能段说明两份技能各自何时加载（验证：读该段）
- [x] 3.2 更新卡片正文（现在能做什么 + 手测步骤 / 还没做）——本次为 `Plan: none` 的治理工具改动，卡片无需改；在提交信息与本变更里记明

## 4. 验证与收口

- [x] 4.1 `npm run docs:check`、`node --test scripts/skill-sync.test.mjs` 通过
- [x] 4.2 `npm run check` 全绿
- [ ] 4.3 用户读 `skills/noema-governance/SKILL.md`（含 `~/.dsh/skills` 已安装副本）并确认 `D-20261116-governance-extraction` 的验收项，然后收口条目与归档