import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';
import { SocialChatService } from '../src/social-chat-service.mjs';

function setup(provider) {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = new SocialChatStore(db);
  const a = store.createAgent({
    name: '研究员',
    headline: '研究',
    description: '核对证据。',
    projectWork: false,
  }).members[0].id;
  const b = store.createAgent({
    name: '预算员',
    headline: '预算',
    description: '依据证据核算。',
    projectWork: false,
  }).members[0].id;
  const projects = new SocialProjectStore({ db, socialChatStore: store });
  const project = projects.createProject({
    title: '摄影试办',
    brief: '现有场地，预算 3000 元；先研究再决定。',
    agentIds: ['noema', a, b],
  });
  const service = new SocialChatService({
    store,
    projectStore: projects,
    provider,
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'fixture',
    getRootState: async () => ({
      providerConfigured: true,
      selectedModel: 'fixture',
    }),
    getProjectSessionContext: (roomId, agentId) =>
      projects.getProjectSessionContext(roomId, agentId),
  });
  return { db, store, projects, project, service, a, b };
}
async function settle(service) {
  for (let i = 0; i < 300; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    if (
      !service.active.size &&
      !service.projectGroupInboxDrains.size &&
      !service.projectReportDrain
    )
      return;
  }
  throw Error('Collaboration did not reach an idle boundary');
}
const tool = (input, name, args, id = 'fixture-call') =>
  input.onToolCalls?.([
    {
      id,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    },
  ]);
function event(input) {
  const row = input.messages.find((message) =>
    message.content?.includes('"type":"noema_project_session"'),
  );
  return row ? JSON.parse(row.content).event : null;
}

test('unmentioned messages are public without inference; members can directly hand off with visible @', async () => {
  const calls = [];
  const f = setup({
    async *streamChat(input) {
      calls.push(input);
      if (event(input)?.kind === 'unread')
        tool(input, 'project_group', {
          operation: 'quiet',
          project_id: f.project.id,
        });
      else if (input.messages[0].content.includes('研究员'))
        yield '@预算员 需求证据已核对，请据此给出预算。';
      else yield '已依据证据形成预算，场租仍需核实。';
    },
  });
  try {
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      agentId: f.b,
      text: '场地报价还没确认，先保留不确定性。',
    });
    await settle(f.service);
    assert.equal(calls.length, 0);
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      agentId: f.b,
      text: '@研究员 请核对需求依据。',
    });
    await settle(f.service);
    const messages = f.store.getRoomSnapshot(f.project.groupRoomId).messages;
    assert.ok(
      messages.some((m) => m.agentId === f.a && m.content.includes('@预算员')),
    );
    assert.ok(
      messages.some(
        (m) => m.agentId === f.b && m.content.includes('场租仍需核实'),
      ),
    );
    assert.equal(calls.length, 2);
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM social_project_reports').get().n,
      0,
      'ordinary replies do not bill Noema',
    );
    const bContext = calls[1].messages.map((m) => m.content).join('\n');
    assert.match(bContext, /摄影试办/u);
    assert.match(bContext, /3000/u);
    assert.match(bContext, /\[研究员\]/u);
    assert.equal(
      f.store
        .getRoomSnapshot(f.store.getAgentResidentRoomId(f.b))
        .messages.some((m) => m.content.includes('需求证据已核对')),
      false,
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('one broadcast record fans out durably; non-admin broadcasts fail; quiet does not post acknowledgments', async () => {
  let calls = 0;
  const f = setup({
    async *streamChat(input) {
      calls++;
      if (input.messages[0].content.startsWith('你是 Noema，'))
        yield '我会在主聊保持项目跟进。';
      else
        tool(input, 'project_group', {
          operation: 'quiet',
          project_id: f.project.id,
        });
    },
  });
  try {
    assert.throws(
      () =>
        f.service.collaboration.publish({
          projectId: f.project.id,
          senderAgentId: f.a,
          text: '@所有人 看这里',
        }),
      /只有用户或 Noema/u,
    );
    const sent = f.service.collaboration.publish({
      projectId: f.project.id,
      senderAgentId: 'noema',
      text: '@所有人 已知场地可用，预算 3000 元；先核对背景，暂不执行。',
      eventKey: 'kickoff-test',
    });
    const duplicate = f.service.collaboration.publish({
      projectId: f.project.id,
      senderAgentId: 'noema',
      text: '@所有人 不应重复',
      eventKey: 'kickoff-test',
    });
    assert.equal(duplicate.messageId, sent.messageId);
    assert.equal(f.store.listProjectGroupInbox().length, 2);
    assert.equal(
      new Set(f.store.listProjectGroupInbox().map((q) => q.userMessageId)).size,
      1,
    );
    f.service.schedulePendingProjectGroupInboxes();
    await settle(f.service);
    assert.equal(calls, 2);
    assert.equal(
      f.store
        .getRoomSnapshot(f.project.groupRoomId)
        .messages.filter((m) => m.role === 'assistant').length,
      1,
      'only the original kickoff remains public',
    );
    assert.equal(
      f.db
        .prepare('SELECT COUNT(*) AS n FROM social_project_dispatch_log')
        .get().n,
      2,
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('busy members finish first, later messages retain sender and failed deliveries require explicit retry', async () => {
  let release,
    calls = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = setup({
    async *streamChat() {
      calls++;
      if (calls === 1) {
        yield '正在核对。';
        await gate;
      } else if (calls === 2) throw Error('fixture outage');
      else yield '重试完成。';
    },
  });
  try {
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      text: '@研究员 第一条。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    const first = f.service.active.get(f.project.groupRoomId);
    assert.ok(first);
    f.service.collaboration.publish({
      projectId: f.project.id,
      senderAgentId: f.b,
      text: '@研究员 第二条，请保留来源。',
    });
    assert.equal(calls, 1);
    release();
    await first.done;
    await settle(f.service);
    const failed = f.store
      .getRoomSnapshot(f.project.groupRoomId)
      .messages.find((m) => m.status === 'failed');
    assert.ok(failed);
    assert.equal(calls, 2);
    const session = f.projects.getProjectSession(f.project.id, f.a);
    assert.ok(
      f.store
        .getRoomSnapshot(session.room.room.id)
        .messages.some((m) => m.senderAgentId === f.b),
    );
    f.service.retryReply(failed.id);
    await settle(f.service);
    assert.equal(f.store.getSocialMessage(failed.id).status, 'complete');
    assert.equal(calls, 3);
  } finally {
    release();
    await f.service.shutdown();
    f.db.close();
  }
});

test('finite delegation chains stop with a public explanation instead of unbounded @ loops', async () => {
  let calls = 0;
  const f = setup({
    async *streamChat(input) {
      calls++;
      yield input.messages[0].content.includes('研究员')
        ? '@预算员 请再核对。'
        : '@研究员 请再核对。';
    },
  });
  try {
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      text: '@研究员 开始核对。',
    });
    await settle(f.service);
    assert.ok(calls <= 9 && calls >= 2);
    assert.ok(
      f.store
        .getRoomSnapshot(f.project.groupRoomId)
        .messages.some(
          (m) => m.role === 'system' && m.content.includes('调用上限'),
        ),
    );
    assert.equal(f.store.listProjectGroupInbox().length, 0);
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('plan submission triggers Noema review; acceptance unlocks and dispatches the dependent member', async () => {
  const calls = [];
  const f = setup({
    async *streamChat(input) {
      calls.push(input);
      const last = input.messages.at(-1);
      if (last.role === 'tool') {
        yield '已按实际状态记录；不会将提交当作验收。';
        return;
      }
      if (event(input)?.kind === 'unread') {
        tool(input, 'project_group', {
          operation: 'quiet',
          project_id: f.project.id,
        });
        return;
      }
      const plan = f.projects.plans.get(f.project.id);
      const isNoema = input.messages[0].content.startsWith('你是 Noema，');
      const item = plan.items.find((i) =>
        isNoema
          ? i.status === 'submitted'
          : i.ownerAgentId ===
            (input.messages[0].content.includes('研究员') ? f.a : f.b),
      );
      if (!item) {
        yield '本阶段已验收，保留待核实事项。';
        return;
      }
      tool(
        input,
        'manage_project_plan',
        {
          operation: 'update_item',
          project_id: f.project.id,
          expected_revision: plan.revision,
          item_id: item.id,
          status: isNoema
            ? 'done'
            : item.status === 'pending'
              ? 'in_progress'
              : 'submitted',
          evidence: isNoema ? item.evidence : '合成成果与核验依据。',
          reason: isNoema ? '核验满足预定完成条件。' : '执行计划交付。',
        },
        `update-${calls.length}`,
      );
    },
  });
  try {
    f.projects.plans.replace({
      projectId: f.project.id,
      expectedRevision: 0,
      reason: '建立依赖阶段。',
      plan: {
        stage: '预研究',
        objective: '研究后再核算。',
        items: [
          {
            id: 'a',
            title: '需求证据',
            ownerAgentId: f.a,
            acceptance: '提供事实及未知项。',
            dependsOn: [],
            status: 'pending',
          },
          {
            id: 'b',
            title: '试办预算',
            ownerAgentId: f.b,
            acceptance: '依据研究完成预算。',
            dependsOn: ['a'],
            status: 'pending',
          },
        ],
      },
    });
    f.service.schedulePendingProjectGroupInboxes();
    await settle(f.service);
    const accepted = f.projects.plans.get(f.project.id);
    assert.equal(accepted.items[0].status, 'done');
    assert.equal(accepted.items[1].status, 'done');
    assert.equal(accepted.progress.percentage, 100);
    assert.ok(calls.some((c) => c.messages[0].content.includes('预算员')));
    const deliveries = f.db
      .prepare(
        'SELECT agent_id AS agentId,trigger_kind AS kind FROM social_project_dispatch_log',
      )
      .all();
    assert.equal(
      deliveries.filter((d) => d.agentId === f.b && d.kind === 'plan_ready')
        .length,
      1,
      'ready notifications are not repeated on unrelated revisions',
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM social_project_reports WHERE status='completed'",
        )
        .get().n,
      2,
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('forming a team publishes common background without sequential consultations and exposes follow-up tools', async () => {
  let calls = 0;
  const f = setup({
    async *streamChat(input) {
      calls++;
      if (calls === 1)
        tool(input, 'create_project_team', {
          title: '价格研究',
          brief: '预算有限，先研究两家平台的官方价格。',
          members: [
            { agent_id: f.a, task: '核对来源和计价口径。' },
            {
              new_agent: {
                name: '数据工程师',
                headline: '数据工具',
                description: '构建可维护的数据工具。',
              },
              task: '判断采集约束。',
            },
          ],
        });
      else {
        const result = JSON.parse(input.messages.at(-1).content);
        assert.equal(result.state, 'formed_not_executed');
        assert.ok(input.tools.some((t) => t.function.name === 'project_group'));
        yield '共同背景和职责已记录，工作尚未执行。';
      }
    },
  });
  try {
    const sent = f.service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请启动官方价格研究项目。',
    });
    await settle(f.service);
    assert.equal(calls, 2);
    const project = f.projects
      .listProjects()
      .find((p) => p.title === '价格研究');
    assert.ok(project);
    const kickoff = f.store
      .getRoomSnapshot(project.groupRoomId)
      .messages.find((m) => m.agentId === 'noema');
    assert.match(kickoff.content, /预算有限/u);
    assert.match(kickoff.content, /核对来源/u);
    assert.match(kickoff.content, /采集约束/u);
    assert.equal(f.store.getSocialMessage(sent.messageId).status, 'complete');
    assert.equal(f.store.listProjectGroupInbox().length, 0);
    assert.equal(
      f.store
        .getRoomSnapshot(project.members[0].sessionRoomId)
        .messages.filter((m) => m.role === 'user').length,
      0,
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('persisted fanout survives service replacement without repeating a completed recipient', async () => {
  let calls = 0;
  const provider = {
    async *streamChat(input) {
      calls++;
      tool(input, 'project_group', {
        operation: 'quiet',
        project_id: f.project.id,
      });
      yield* [];
    },
  };
  const f = setup(provider);
  try {
    f.service.collaboration.publish({
      projectId: f.project.id,
      senderAgentId: 'noema',
      text: '@所有人 核对共同背景即可。',
      eventKey: 'persisted-fanout',
    });
    const first = f.store.listProjectGroupInbox()[0];
    const turn = f.store.claimProjectGroupMessage(first.turnId, 'fixture');
    f.store.appendAssistantDelta(turn.assistantMessageId, '先前已完成。');
    f.store.appendAssistantDelta(turn.mirrorAssistantMessageId, '先前已完成。');
    f.store.completeReplies([
      turn.assistantMessageId,
      turn.mirrorAssistantMessageId,
    ]);
    await f.service.shutdown();
    const restarted = new SocialChatService({
      store: f.store,
      projectStore: f.projects,
      provider,
      secretStore: { isConfigured: () => true },
      getSelectedModel: () => 'fixture',
      getRootState: async () => ({
        providerConfigured: true,
        selectedModel: 'fixture',
      }),
      getProjectSessionContext: (roomId, agentId) =>
        f.projects.getProjectSessionContext(roomId, agentId),
    });
    f.service = restarted;
    await restarted.getUiState();
    await settle(restarted);
    assert.ok(
      calls >= 1 && calls <= 2,
      'only remaining recipient and a possible unread batch may run',
    );
    assert.equal(f.store.listProjectGroupInbox().length, 0);
    assert.equal(
      f.db
        .prepare(
          'SELECT COUNT(*) AS n FROM social_project_dispatch_log WHERE agent_id=? AND source_message_id=(SELECT message_id FROM social_project_publications WHERE event_key=?)',
        )
        .get(first.agentId, 'persisted-fanout').n,
      1,
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('a report may read the plan then request user judgment; queued execution stays paused until explicit feedback', async () => {
  let calls = 0;
  const f = setup({
    async *streamChat(input) {
      calls++;
      if (calls === 1)
        tool(input, 'manage_project_plan', {
          operation: 'read',
          project_id: f.project.id,
        });
      else if (calls === 2)
        tool(input, 'request_project_review', {
          project_id: f.project.id,
          question: '请查看实际成果：是否按当前预算继续试办？',
        });
      else yield '已收到明确反馈，继续按约束推进。';
    },
  });
  try {
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      text: '@Noema 当前成果需要我的判断。',
    });
    await settle(f.service);
    assert.equal(f.projects.getProject(f.project.id).status, 'awaiting_user');
    assert.throws(
      () =>
        f.service.sendMessage({
          roomId: f.project.groupRoomId,
          text: '@研究员 在反馈前不要执行。',
        }),
      /等待用户/u,
    );
    f.service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '我们先聊聊别的。',
    });
    await settle(f.service);
    assert.equal(f.projects.getProject(f.project.id).status, 'awaiting_user');
    const review = f.projects.getProject(f.project.id).pendingReview;
    f.service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '接受预算，继续。',
      reviewRequestId: review.id,
    });
    await settle(f.service);
    assert.equal(f.projects.getProject(f.project.id).status, 'active');
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('stopping a delivered turn interrupts both public and member records without automatically replaying it', async () => {
  const f = setup({
    async *streamChat({ signal }) {
      yield '部分成果。';
      await new Promise((resolve) =>
        signal.addEventListener('abort', resolve, { once: true }),
      );
      yield '停止后的内容不可写入。';
    },
  });
  try {
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      text: '@研究员 开始。',
    });
    for (let i = 0; i < 20 && !f.service.active.has(f.project.groupRoomId); i++)
      await new Promise((resolve) => setImmediate(resolve));
    const run = f.service.active.get(f.project.groupRoomId);
    assert.ok(run);
    assert.equal(f.service.stopReply(run.assistantMessageId), true);
    await settle(f.service);
    for (const id of [run.assistantMessageId, run.mirrorAssistantMessageId]) {
      const message = f.store.getSocialMessage(id);
      assert.equal(message.status, 'interrupted');
      assert.doesNotMatch(message.content, /停止后的内容/u);
    }
    assert.equal(f.store.listProjectGroupInbox().length, 0);
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('public peer speech stays external, the current event is last, and a batch can publish then submit without duplicate narration', async () => {
  const f = setup({
    async *streamChat(input) {
      if (input.messages[0].content.startsWith('你是 Noema，')) {
        yield '收到真实提交，仍需核验。';
        return;
      }
      if (input.messages.at(-1).role === 'tool') {
        yield '私有工作说明，不应重复群发。';
        return;
      }
      const latest = JSON.parse(input.messages.at(-1).content);
      assert.equal(latest.type, 'noema_current_project_event');
      assert.equal(latest.kind, 'plan_ready');
      assert.equal(
        input.messages.some(
          (m) =>
            m.role === 'assistant' &&
            m.content.includes('另一个成员的公开经历'),
        ),
        false,
      );
      const plan = f.projects.plans.get(f.project.id);
      input.onToolCalls([
        {
          id: 'publish',
          type: 'function',
          function: {
            name: 'project_group',
            arguments: JSON.stringify({
              operation: 'send',
              project_id: f.project.id,
              text: '需求证据：合成事实和未知项已核对。',
            }),
          },
        },
        {
          id: 'submit',
          type: 'function',
          function: {
            name: 'manage_project_plan',
            arguments: JSON.stringify({
              operation: 'update_item',
              project_id: f.project.id,
              expected_revision: plan.revision,
              item_id: 'a',
              status: 'submitted',
              evidence: '已公开交付合成事实和未知项。',
              reason: '提交本项成果。',
            }),
          },
        },
      ]);
    },
  });
  try {
    f.service.collaboration.publish({
      projectId: f.project.id,
      senderAgentId: f.b,
      text: '另一个成员的公开经历：不能当作研究员自己已完成。',
    });
    f.projects.plans.replace({
      projectId: f.project.id,
      expectedRevision: 0,
      reason: '核对输入归属。',
      plan: {
        stage: '研究',
        objective: '核对依据。',
        items: [
          {
            id: 'a',
            title: '事实资料',
            ownerAgentId: f.a,
            acceptance: '说明事实与未知。',
            dependsOn: [],
            status: 'pending',
          },
        ],
      },
    });
    f.service.schedulePendingProjectGroupInboxes();
    await settle(f.service);
    assert.equal(
      f.projects.plans.get(f.project.id).items[0].status,
      'submitted',
    );
    const publicMessages = f.store.getRoomSnapshot(
      f.project.groupRoomId,
    ).messages;
    assert.equal(
      publicMessages.filter((m) => m.agentId === f.a && m.role === 'assistant')
        .length,
      1,
    );
    assert.equal(
      publicMessages.some((m) => m.content.includes('私有工作说明')),
      false,
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});
