import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../../../src/main/chat/social-chat-store.mjs';
import { migrateSocialChatSchema } from '../../../src/main/chat/migrations.ts';
import { AgentMemoryStore } from '../../../src/main/chat/agent-memory-store.ts';

const AGENT = 'agent-memory-probe';

function makeStore() {
  const db = new Database(':memory:');
  new RootStore(db);
  migrateSocialChatSchema(db);
  db.prepare(`
    INSERT INTO social_agents
      (id, name, kind, headline, description, system_prompt, created_at, updated_at)
    VALUES (?, '记忆探针', 'specialist', '核验', '核验交付。', '你是记忆探针。',
            '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z')
  `).run(AGENT);
  return { db, memories: new AgentMemoryStore(db) };
}

test('a Chinese sentence finds the memory that shares its fragments', () => {
  const { memories } = makeStore();
  const item = memories.create({
    agentId: AGENT,
    kind: 'preference',
    content: '用户每周五下班后推进价格追踪项目，喜欢先看历史曲线。',
  });
  assert.equal(item.status, 'active');
  assert.deepEqual(
    memories.search('价格追踪怎么做', { agentId: AGENT }).map((hit) => hit.id),
    [item.id],
  );
  assert.deepEqual(
    memories.search('历史曲线偏好', { agentId: AGENT }).length,
    1,
  );
  assert.deepEqual(memories.search('短', { agentId: AGENT }), []);
});

test('facts stay candidates until the user confirms them', () => {
  const { memories } = makeStore();
  const fact = memories.create({
    agentId: AGENT,
    kind: 'fact',
    content: '用户的名字是林安。',
  });
  assert.equal(fact.status, 'candidate');
  assert.deepEqual(memories.search('用户的名字', { agentId: AGENT }), []);
  assert.equal(
    memories.list({ agentId: AGENT, status: 'candidate' }).length,
    1,
  );

  const confirmed = memories.confirm(fact.id);
  assert.equal(confirmed.status, 'active');
  assert.ok(confirmed.confirmedAt);
  assert.equal(
    memories.search('用户的名字', { agentId: AGENT })[0].id,
    fact.id,
  );
});

test('episodes take effect immediately and stay revocable', () => {
  const { memories } = makeStore();
  const episode = memories.create({
    agentId: AGENT,
    kind: 'episode',
    content: '今天用户在处理离线任务看板的需求。',
  });
  assert.equal(episode.status, 'active');
  assert.equal(memories.search('离线任务看板', { agentId: AGENT }).length, 1);

  const retracted = memories.retract({ id: episode.id, reason: '记错了日子' });
  assert.equal(retracted.status, 'retracted');
  assert.deepEqual(memories.search('离线任务看板', { agentId: AGENT }), []);
  const events = memories.audit(episode.id).map((entry) => entry.event);
  assert.deepEqual(events, ['created', 'retracted']);
  assert.equal(memories.audit(episode.id)[1].detail, '记错了日子');
});

test('superseding a fact hides the stale statement but keeps it auditable', () => {
  const { memories } = makeStore();
  const stale = memories.create({
    agentId: AGENT,
    kind: 'preference',
    content: '项目复盘固定在每周五晚上。',
  });
  const fresh = memories.supersede({
    id: stale.id,
    content: '项目复盘固定在每周六上午。',
  });
  assert.equal(fresh.status, 'active');
  const old = memories.get(stale.id);
  assert.equal(old.status, 'superseded');
  assert.equal(old.supersededBy, fresh.id);
  assert.ok(old.validTo);

  const hits = memories.search('项目复盘时间', { agentId: AGENT });
  assert.deepEqual(
    hits.map((hit) => hit.id),
    [fresh.id],
    'only the current statement may be retrieved',
  );
  assert.deepEqual(
    memories
      .list({ agentId: AGENT })
      .map((item) => item.status)
      .sort(),
    ['active', 'superseded'],
  );
});

test('memories of another agent never leak into retrieval', () => {
  const { memories } = makeStore();
  memories.create({
    agentId: 'agent-other',
    kind: 'preference',
    content: '价格追踪项目每周一更新。',
  });
  assert.deepEqual(memories.search('价格追踪', { agentId: AGENT }), []);
});

test('invalid kinds and missing sources are rejected', () => {
  const { memories } = makeStore();
  assert.throws(
    () => memories.create({ agentId: AGENT, kind: 'gossip', content: 'x' }),
    /记忆类型/u,
  );
  assert.throws(
    () =>
      memories.create({
        agentId: AGENT,
        kind: 'fact',
        content: '用户住在杭州。',
        sourceKind: 'telepathy',
      }),
    /记忆来源类型/u,
  );
  assert.throws(() => memories.confirm('memory-missing'), /找不到这条记忆/u);
});
