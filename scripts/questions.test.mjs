import test from "node:test";
import assert from "node:assert/strict";
import { parseLedger, summarize } from "./questions.mjs";

const LEDGER = `# 讨论台账

| id | 主题 | 状态 | 一句话问题 | 我的建议 | 更新 |
| --- | --- | --- | --- | --- | --- |
| Q-001 | 成长机制 | open | 写哪一层 | L1 自动 | 2026-11-01 |
| Q-002 | 技术债 | parked | A/B/C | B | 2026-11-15 |
| Q-003 | 复核 | open | 确认三项 | 确认 | 2026-11-14 |
| Q-004 | 方向 | done | 是否冻结 | 继续重建 | 2026-11-10 |
`;

test("ledger rows parse and the summary keeps the oldest open question in front", () => {
  const items = parseLedger(LEDGER);
  assert.deepEqual(
    items.map((item) => item.id),
    ["Q-001", "Q-002", "Q-003", "Q-004"],
  );
  const result = summarize(items, { today: new Date("2026-11-15T00:00:00Z") });
  assert.deepEqual(result.counts, { open: 2, parked: 1, done: 1, dropped: 0, other: 0 });
  assert.equal(result.oldest.id, "Q-001");
  assert.deepEqual(
    result.stale.map((item) => item.id),
    ["Q-001"],
  );
});

test("a crowded ledger asks for convergence instead of more questions", () => {
  const items = Array.from({ length: 13 }, (_, index) => ({
    id: `Q-0${String(index + 1).padStart(2, "0")}`,
    topic: "t",
    status: "open",
    question: "q",
    advice: "a",
    updated: "2026-11-15",
  }));
  const result = summarize(items, { today: new Date("2026-11-15T00:00:00Z"), openLimit: 12 });
  assert(result.notices.some((notice) => notice.includes("先收敛再开新问题")));
});
