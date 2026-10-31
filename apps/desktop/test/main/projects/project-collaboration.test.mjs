import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../../../src/main/chat/social-chat-store.mjs';
import { SocialProjectStore } from '../../../src/main/projects/social-project-store.mjs';
import { SocialChatService } from '../../../src/main/chat/social-chat-service.mjs';

function setup(
  provider,
  { projectWorkReady = false, onProjectWorkStart = null } = {},
) {
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
    getProjectWorkReadiness: () => ({
      available: projectWorkReady,
      reason: projectWorkReady ? null : 'fixture unavailable',
    }),
    startProjectWork: projectWorkReady
      ? async (input) => {
          onProjectWorkStart?.(input);
          return { accepted: true, taskId: 'fixture-project-work' };
        }
      : null,
  });
  return { db, store, projects, project, service, a, b };
}
function installSingleWorkItem(
  f,
  {
    projectId = f.project.id,
    itemId,
    ownerAgentId = f.b,
    status = 'pending',
    blocker = '',
  },
) {
  f.projects.plans.onChange = null;
  let plan = f.projects.plans.replace({
    projectId,
    expectedRevision: 0,
    reason: '建立项目执行续接测试计划。',
    plan: {
      objective: '按已授权项目范围完成可验收成果。',
      phases: [
        {
          id: 'implementation',
          title: '项目实现',
          outcome: '工作包成果可核验。',
          exitCriteria: '工作包按验收条件独立通过。',
          dependsOn: [],
          status: 'pending',
          evidence: '',
          workItems: [
            {
              id: itemId,
              title: '实现项目工作包',
              ownerAgentId,
              reviewerIds: [f.a],
              acceptance: '实现并验证计划中的交付。',
              dependsOn: [],
              status: 'pending',
              evidence: '',
              blocker: '',
            },
          ],
        },
      ],
    },
  });
  if (status !== 'pending') {
    plan = f.projects.plans.updateItem({
      projectId,
      expectedRevision: plan.revision,
      itemId,
      status,
      blocker,
      actorAgentId: ownerAgentId,
      reason: blocker || '工作包进入当前测试状态。',
    });
  }
  return plan;
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

test('submitted work publicly wakes only its named active agent reviewers', async () => {
  const f = setup({ async *streamChat() {} });
  f.projects.plans.onChange = null;
  try {
    f.projects.plans.replace({
      projectId: f.project.id,
      expectedRevision: 0,
      reason: '建立需要独立核验的团队工作包。',
      plan: {
        objective: '根据真实需求形成可核验的试办方案。',
        phases: [
          {
            id: 'research',
            title: '需求核实',
            outcome: '需求与来源可复核。',
            exitCriteria: '工作成果通过独立核验。',
            dependsOn: [],
            status: 'pending',
            evidence: '',
            workItems: [
              {
                id: 'source-review',
                title: '核验来源与结论',
                ownerAgentId: f.b,
                reviewerIds: [f.a, 'user'],
                acceptance: '引用来源支持结论，未知项清楚列出。',
                dependsOn: [],
                status: 'pending',
                evidence: '',
                blocker: '',
              },
            ],
          },
        ],
      },
    });
    let plan = f.projects.plans.get(f.project.id);
    plan = f.projects.plans.updateItem({
      projectId: f.project.id,
      expectedRevision: plan.revision,
      itemId: 'source-review',
      status: 'in_progress',
      actorAgentId: f.b,
      reason: '责任成员开始核对来源。',
    });
    const now = new Date().toISOString();
    f.db
      .prepare(`INSERT INTO social_messages
      (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at)
      VALUES ('review-source',?,'review-source','assistant',?,'来源记录：用户访谈与公开报价已保存。','complete','local',?,?)`)
      .run(f.project.groupRoomId, f.b, now, now);
    plan = f.projects.plans.updateItem({
      projectId: f.project.id,
      expectedRevision: plan.revision,
      itemId: 'source-review',
      status: 'submitted',
      evidence: '访谈与报价来源均已归档，未核实项已列出。',
      evidenceSources: [{ kind: 'message', messageId: 'review-source' }],
      actorAgentId: f.b,
      reason: '责任成员提交来源核验成果。',
    });

    f.service.collaboration.planChanged(f.project.id, {
      rootId: 'review-root',
    });
    f.service.collaboration.planChanged(f.project.id, {
      rootId: 'review-root',
    });

    const notice = f.db
      .prepare(
        "SELECT content FROM social_messages WHERE room_id=? AND content LIKE '%本轮核验意见%'",
      )
      .get(f.project.groupRoomId);
    assert.ok(notice);
    assert.match(notice.content, /@研究员/u);
    assert.doesNotMatch(notice.content, /@Noema|@预算员/u);
    assert.match(
      notice.content,
      new RegExp(`提交版本 ${plan.items[0].submissionRevision}`),
    );

    const reviewerDelivery = f.db
      .prepare(
        'SELECT agent_id AS agentId,trigger_kind AS triggerKind FROM social_project_group_inbox WHERE project_id=?',
      )
      .all(f.project.id);
    assert.deepEqual(reviewerDelivery, [
      { agentId: f.a, triggerKind: 'plan_review' },
    ]);
    const oldDelivery = f.store.listProjectGroupInbox()[0];
    assert.equal(oldDelivery.planItemId, 'source-review');
    assert.equal(
      oldDelivery.planSubmissionRevision,
      plan.items[0].submissionRevision,
    );
    assert.equal(f.service.collaboration.prepareDelivery(oldDelivery), true);
    plan = f.projects.plans.updateItem({
      projectId: f.project.id,
      expectedRevision: plan.revision,
      itemId: 'source-review',
      status: 'submitted',
      reviewDecision: 'request_changes',
      reviewReason: '报价来源还缺少有效期。',
      actorAgentId: f.a,
      reason: '独立核验后要求补充报价有效期。',
    });
    assert.equal(plan.items[0].status, 'in_progress');
    plan = f.projects.plans.updateItem({
      projectId: f.project.id,
      expectedRevision: plan.revision,
      itemId: 'source-review',
      status: 'submitted',
      evidence: '补充报价有效期，访谈与报价来源均已归档。',
      evidenceSources: [{ kind: 'message', messageId: 'review-source' }],
      actorAgentId: f.b,
      reason: '根据核验意见补齐报价有效期后重新提交。',
    });
    f.service.collaboration.planChanged(f.project.id, {
      rootId: 'resubmitted-root',
    });
    const deliveries = f.store.listProjectGroupInbox();
    assert.equal(deliveries.length, 2);
    assert.equal(
      f.service.collaboration.prepareDelivery(oldDelivery),
      false,
      'a stale queued review is discarded before model invocation',
    );
    const currentDelivery = deliveries.find(
      (delivery) =>
        delivery.planSubmissionRevision === plan.items[0].submissionRevision,
    );
    assert.ok(currentDelivery);
    assert.equal(
      f.service.collaboration.prepareDelivery(currentDelivery),
      true,
    );
    assert.equal(
      f.db
        .prepare(
          'SELECT COUNT(*) AS n FROM social_project_reports WHERE project_id=?',
        )
        .get(f.project.id).n,
      2,
      'each submission revision gives Noema its separate checkpoint',
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM social_messages WHERE room_id=? AND content LIKE '%本轮核验意见%'",
        )
        .get(f.project.groupRoomId).n,
      2,
      'one review request is published per submission revision',
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

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

test('project group sends the public summary but never publishes a member analysis block', async () => {
  const f = setup({
    async *streamChat(input) {
      if (event(input)?.kind === 'unread') {
        tool(input, 'project_group', {
          operation: 'quiet',
          project_id: f.project.id,
        });
        return;
      }
      tool(input, 'project_group', {
        operation: 'send',
        project_id: f.project.id,
        text: '我先核对来源。<analysis>私有推演不得进入共享记录。</analysis>\n<summary>@预算员 需求证据已核对，场地报价仍待确认。</summary>',
      });
    },
  });
  try {
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      agentId: f.a,
      text: '@研究员 请核对需求来源。',
    });
    await settle(f.service);

    const messages = f.store.getRoomSnapshot(f.project.groupRoomId).messages;
    const publicMessage = messages.find(
      (message) =>
        message.agentId === f.a && message.content.includes('需求证据已核对'),
    );
    assert.ok(publicMessage);
    assert.equal(
      publicMessage.content,
      '@预算员 需求证据已核对，场地报价仍待确认。',
    );
    assert.doesNotMatch(
      publicMessage.content,
      /私有推演|<analysis>|<summary>/u,
    );
    const stored = f.db
      .prepare('SELECT id, content FROM social_messages WHERE id=?')
      .get(publicMessage.id);
    assert.equal(stored.content, publicMessage.content);

    f.db
      .prepare('UPDATE social_messages SET content=? WHERE id=?')
      .run(
        '旧记录<analysis>不得展示</analysis><summary>可见结论</summary>',
        publicMessage.id,
      );
    const legacy = f.store
      .getRoomSnapshot(f.project.groupRoomId)
      .messages.find((message) => message.id === publicMessage.id);
    assert.equal(legacy.content, '可见结论');
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
  const events = [];
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
          ...(!isNoema && item.status !== 'pending'
            ? {
                evidence_sources: [
                  { kind: 'message', messageId: 'collab-a-evidence' },
                ],
              }
            : {}),
          reason: isNoema ? '核验满足预定完成条件。' : '执行计划交付。',
        },
        `update-${calls.length}`,
      );
    },
  });
  f.service.emit = (event) => events.push(event);
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
    const evidenceTime = new Date().toISOString();
    f.db
      .prepare(`INSERT INTO social_messages
      (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at)
      VALUES ('collab-a-evidence',?,'collab-a-evidence','user',NULL,'需求证据：合成事实和未知项已核对。','complete','local',?,?)`)
      .run(f.project.groupRoomId, evidenceTime, evidenceTime);
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
    assert.equal(
      f.db
        .prepare(`
          SELECT COUNT(*) AS n FROM social_messages
          WHERE room_id='room-noema' AND role='assistant'
            AND turn_id IN (
              SELECT id FROM social_project_reports WHERE project_id=?
            )
        `)
        .get(f.project.id).n,
      0,
      'ordinary internal report handling is not left as a visible Noema reply',
    );
    assert.equal(
      events.filter(
        (entry) =>
          entry.type === 'chat-turn-completed' &&
          entry.roomId === 'room-noema' &&
          entry.notifyUser === true,
      ).length,
      0,
      'internal reports do not trigger user notifications',
    );
    const report = f.db
      .prepare(
        'SELECT id FROM social_project_reports WHERE project_id=? LIMIT 1',
      )
      .get(f.project.id);
    const oldAssistantId = 'legacy-internal-report-reply';
    const now = new Date().toISOString();
    f.db
      .prepare(`
        INSERT INTO social_messages
          (id, room_id, turn_id, role, agent_id, content, status, runtime,
           created_at, updated_at)
        VALUES (?, 'room-noema', ?, 'assistant', 'noema', ?, 'complete',
                'freellmapi', ?, ?)
      `)
      .run(
        oldAssistantId,
        report.id,
        '历史内部报告，不应作为主聊消息显示或进入后续上下文。',
        now,
        now,
      );
    f.db
      .prepare(
        'UPDATE social_project_reports SET noema_assistant_message_id=? WHERE id=?',
      )
      .run(oldAssistantId, report.id);
    assert.equal(
      f.store
        .getRoomSnapshot('room-noema')
        .messages.some((message) => message.id === oldAssistantId),
      false,
      'legacy internal report replies are hidden from main chat history',
    );
    assert.equal(
      f.store
        .getContext('room-noema')
        .some((message) => message.id === oldAssistantId),
      false,
      'legacy internal report replies are excluded from future model context',
    );
    assert.equal(
      f.store
        .searchMessages('历史内部报告')
        .some((message) => message.id === oldAssistantId),
      false,
      'legacy internal report replies are not returned as chat search results',
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('a user @Noema request in a project group receives its visible reply there', async () => {
  let request;
  const f = setup({
    async *streamChat(input) {
      request = input;
      yield '我会先核对当前计划与阻塞，再告诉你实际能推进的部分。';
    },
  });
  const events = [];
  f.service.emit = (entry) => events.push(entry);
  try {
    const sent = f.service.sendMessage({
      roomId: f.project.groupRoomId,
      text: '@Noema 请核对目前的阻塞并继续可执行的工作。',
    });
    await settle(f.service);

    const group = f.store.getRoomSnapshot(f.project.groupRoomId);
    const reply = group.messages.find(
      (message) => message.agentId === 'noema' && message.role === 'assistant',
    );
    assert.equal(reply?.agentId, 'noema');
    assert.equal(reply?.status, 'complete');
    assert.match(reply?.content ?? '', /核对当前计划/u);
    assert.ok(
      request.messages.some((message) =>
        message.content?.includes('noema_user_group_request'),
      ),
      'the model receives the user-authored group request as a public request',
    );
    assert.deepEqual(
      request.tools.map((entry) => entry.function.name).sort(),
      [
        'calculate_expression',
        'create_project_team',
        'manage_project_plan',
        'project_group',
      ],
      'Noema receives only the tools scoped to this existing project',
    );
    const teamTool = request.tools.find(
      (entry) => entry.function.name === 'create_project_team',
    );
    assert.deepEqual(
      teamTool.function.parameters.properties.existing_project_id.enum,
      [f.project.id],
      'team continuation can only affect the project where the user called Noema',
    );
    assert.equal(
      f.store
        .getRoomSnapshot('room-noema')
        .messages.some(
          (message) =>
            message.id ===
            f.db
              .prepare(
                'SELECT noema_assistant_message_id AS id FROM social_project_reports WHERE source_user_message_id=?',
              )
              .get(sent.messageId)?.id,
        ),
      false,
      'the reply is not misrouted into Noema main chat',
    );
    assert.ok(
      events.some(
        (entry) =>
          entry.type === 'chat-turn-completed' &&
          entry.roomId === f.project.groupRoomId &&
          entry.notifyUser === true,
      ),
      'the public group reply emits completion for the originating room',
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('an explicit blocked-project recovery provisions an execution member through the real tool path', async () => {
  let calls = 0;
  let readinessInstruction = false;
  let projectWorkFieldAvailable = false;
  const startedWork = [];
  const f = setup(
    {
      async *streamChat(input) {
        calls++;
        if (calls === 1) {
          assert.deepEqual(input.toolChoice, {
            type: 'function',
            function: { name: 'create_project_team' },
          });
          const team = input.tools.find(
            (entry) => entry.function.name === 'create_project_team',
          );
          projectWorkFieldAvailable = Boolean(
            team.function.parameters.properties.members.items.properties
              .new_agent.properties.project_work,
          );
          readinessInstruction = input.messages.some(
            (message) =>
              message.role === 'system' &&
              message.content.includes('先调用 create_project_team') &&
              message.content.includes('项目执行器当前可用'),
          );
          tool(input, 'create_project_team', {
            title: f.project.title,
            brief: f.project.brief,
            existing_project_id: f.project.id,
            members: [
              {
                new_agent: {
                  name: '应用实施工程师',
                  headline: '产品实现与验证',
                  description: '负责追踪应用的数据与界面实现。',
                  project_work: true,
                },
                task: '接手价格追踪项目中已明确的实现工作。',
              },
            ],
          });
        } else if (calls === 2) {
          const planTool = input.tools.find(
            (entry) => entry.function.name === 'manage_project_plan',
          );
          const added = f.projects
            .getProject(f.project.id)
            .members.find((member) => member.name === '应用实施工程师');
          assert.ok(planTool, 'Noema can reassign the blocked work package');
          const plan = f.projects.plans.get(f.project.id);
          tool(input, 'manage_project_plan', {
            operation: 'update_item',
            project_id: f.project.id,
            expected_revision: plan.revision,
            reason:
              '原阻塞仅因原负责人没有项目文件执行能力；新成员已补足该能力。',
            item_id: 'w3-implementation',
            item_patch: { ownerAgentId: added.agentId },
            status: 'in_progress',
          });
        } else if (calls === 3) {
          const startTool = input.tools.find(
            (entry) => entry.function.name === 'start_project_work',
          );
          const added = f.projects
            .getProject(f.project.id)
            .members.find((member) => member.name === '应用实施工程师');
          assert.ok(
            startTool,
            'the new project executor is available in this group',
          );
          assert.ok(
            startTool.function.parameters.properties.agent_id.enum.includes(
              added.agentId,
            ),
          );
          assert.deepEqual(input.toolChoice, {
            type: 'function',
            function: { name: 'start_project_work' },
          });
          tool(input, 'start_project_work', {
            project_id: f.project.id,
            plan_item_id: 'w3-implementation',
            agent_id: added.agentId,
            task: '从当前项目工作区继续 w3 的价格快照与变化检测实现。',
          });
        } else {
          yield '本机项目工作已接受，后续由执行卡展示实际结果。';
        }
      },
    },
    {
      projectWorkReady: true,
      onProjectWorkStart: (input) => startedWork.push(input),
    },
  );
  f.projects.plans.onChange = null;
  const initialPlan = f.projects.plans.replace({
    projectId: f.project.id,
    expectedRevision: 0,
    reason: '建立一个仅因执行能力缺失而阻塞的真实工作包。',
    plan: {
      objective: '完成价格追踪应用的首版实现。',
      phases: [
        {
          id: 'implementation',
          title: '实现与验证',
          outcome: '价格快照与变化可用。',
          exitCriteria: '实现可运行并有验证证据。',
          dependsOn: [],
          status: 'pending',
          evidence: '',
          workItems: [
            {
              id: 'w3-implementation',
              title: '实现价格快照与变化检测',
              ownerAgentId: f.b,
              reviewerIds: [f.a],
              acceptance: '实现并验证价格快照与变化检测。',
              dependsOn: [],
              status: 'pending',
              evidence: '',
              blocker: '',
            },
          ],
        },
      ],
    },
  });
  f.projects.plans.updateItem({
    projectId: f.project.id,
    expectedRevision: initialPlan.revision,
    itemId: 'w3-implementation',
    status: 'blocked',
    blocker: '原负责人没有项目文件执行能力。',
    actorAgentId: 'noema',
    reason: '将能力缺口与其他阻塞区分开。',
  });
  try {
    const sent = f.service.sendMessage({
      roomId: f.project.groupRoomId,
      text: '@Noema 继续这条委托，优先解决目前 w3/w4 的阻塞。先检查是否能使用现有项目执行器；若可以，给实际负责实现的成员配置能力并启动工作；若不可以，报告具体运行错误。不要重复已完成的规格。',
    });
    await settle(f.service);

    assert.equal(calls, 4);
    assert.equal(projectWorkFieldAvailable, true);
    assert.equal(readinessInstruction, true);
    const project = f.projects.getProject(f.project.id);
    const added = project.members.find(
      (member) => member.name === '应用实施工程师',
    );
    assert.ok(added);
    assert.ok(
      f.store.getAgent(added.agentId).capabilities.includes('project-work'),
    );
    const recoveredItem = f.projects.plans
      .get(f.project.id)
      .items.find((item) => item.id === 'w3-implementation');
    assert.equal(recoveredItem.status, 'in_progress');
    assert.equal(recoveredItem.ownerAgentId, added.agentId);
    assert.deepEqual(startedWork, [
      {
        roomId: f.project.groupRoomId,
        projectId: f.project.id,
        agentId: added.agentId,
        dispatchFromNoema: true,
        prompt: '从当前项目工作区继续 w3 的价格快照与变化检测实现。',
        sourceMessageId: sent.messageId,
      },
    ]);
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('an explicit project continuation uses an existing execution member without tool jargon', async () => {
  let calls = 0;
  const startedWork = [];
  const f = setup(
    {
      async *streamChat(input) {
        calls++;
        if (calls === 1) {
          assert.deepEqual(input.toolChoice, {
            type: 'function',
            function: { name: 'start_project_work' },
          });
          tool(input, 'start_project_work', {
            agent_id: implementerId,
            task: '检查失败任务留下的项目产物，从当前计划继续完成未交付工作。',
          });
        } else {
          yield '已将续接任务交给项目实施成员。';
        }
      },
    },
    {
      projectWorkReady: true,
      onProjectWorkStart: (input) => startedWork.push(input),
    },
  );
  const implementerId = f.store.createAgent({
    name: '应用实施工程师',
    headline: '项目文件实现与验证',
    description: '检查项目工作区并推进已委托的实现。',
    projectWork: true,
  }).members[0].id;
  f.projects.addProjectMember(f.project.id, implementerId);
  try {
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      text: '@Noema 这个项目现在是什么状态？请查看失败记录和已有产物，自己判断下一步并继续推进。',
    });
    await settle(f.service);

    assert.equal(calls, 1);
    assert.equal(startedWork.length, 1);
    assert.equal(startedWork[0].agentId, implementerId);
    assert.match(startedWork[0].prompt, /继续完成未交付工作/u);
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('a project work startup error is visible instead of collapsing to a generic chat error', async () => {
  let calls = 0;
  const f = setup(
    {
      async *streamChat(input) {
        calls++;
        tool(input, 'start_project_work', {
          agent_id: implementerId,
          task: '检查现有产物并继续未交付工作。',
        });
      },
    },
    {
      projectWorkReady: true,
      onProjectWorkStart: () => {
        throw new Error('所选项目文件夹已不存在或不可访问。');
      },
    },
  );
  const implementerId = f.store.createAgent({
    name: '应用实施工程师',
    headline: '项目文件实现与验证',
    description: '检查项目工作区并推进已委托的实现。',
    projectWork: true,
  }).members[0].id;
  f.projects.addProjectMember(f.project.id, implementerId);
  try {
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      text: '@Noema 请查看失败任务并继续推进。',
    });
    await settle(f.service);

    const reply = f.store
      .getRoomSnapshot(f.project.groupRoomId)
      .messages.findLast((message) => message.role === 'assistant');
    assert.equal(calls, 1);
    assert.equal(reply.status, 'failed');
    assert.equal(reply.errorCode, 'project_work_start_failed');
    assert.match(reply.errorMessage, /所选项目文件夹已不存在或不可访问/u);
    assert.doesNotMatch(reply.errorMessage, /本轮回复没有完成/u);
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('a project status question alone does not start file execution', async () => {
  let calls = 0;
  const startedWork = [];
  const f = setup(
    {
      async *streamChat(input) {
        calls++;
        assert.equal(input.toolChoice, undefined);
        yield '项目仍有工作项等待处理。';
      },
    },
    {
      projectWorkReady: true,
      onProjectWorkStart: (input) => startedWork.push(input),
    },
  );
  const implementerId = f.store.createAgent({
    name: '应用实施工程师',
    headline: '项目文件实现与验证',
    description: '检查项目工作区并推进已委托的实现。',
    projectWork: true,
  }).members[0].id;
  f.projects.addProjectMember(f.project.id, implementerId);
  try {
    f.service.sendMessage({
      roomId: f.project.groupRoomId,
      text: '@Noema 这个项目现在是什么状态？',
    });
    await settle(f.service);

    assert.equal(calls, 1);
    assert.deepEqual(startedWork, []);
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('first launch exposes team creation despite having no specialists', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = new SocialChatStore(db);
  const projects = new SocialProjectStore({ db, socialChatStore: store });
  let observed = false;
  const service = new SocialChatService({
    store,
    projectStore: projects,
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'fixture',
    getRootState: async () => ({
      providerConfigured: true,
      selectedModel: 'fixture',
    }),
    provider: {
      async *streamChat(input) {
        observed = true;
        const team = input.tools.find(
          (entry) => entry.function.name === 'create_project_team',
        );
        assert.ok(team);
        assert.match(team.function.description, /独立专业分工.*工作流/u);
        assert.match(team.function.description, /共同、可跟踪的交付物/u);
        assert.match(team.function.description, /决策型研究或实施计划/u);
        assert.match(team.function.description, /用户已允许带假设推进/u);
        assert.ok(
          team.function.parameters.properties.members.items.properties
            .new_agent,
        );
        assert.equal(
          input.tools.some(
            (entry) => entry.function.name === 'delegate_to_specialist',
          ),
          false,
        );
        const instructions = input.messages
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
          .join('\n');
        assert.match(instructions, /这不妨碍.*create_project_team/u);
        assert.match(instructions, /已允许按假设继续/u);
        yield '先确认影响范围。';
      },
    },
  });
  try {
    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '我想规划一个跨多个专业的项目。',
    });
    await settle(service);
    assert.equal(observed, true);
  } finally {
    await service.shutdown();
    db.close();
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

test('continuing a blocked project can add one project-work member and start its work', async () => {
  let calls = 0;
  let addedAgentId;
  let exposedExecutorCalls = 0;
  let addedMemberState;
  let teamSchemaAccepted = false;
  const startedWork = [];
  const f = setup(
    {
      async *streamChat(input) {
        calls++;
        if (calls === 1) {
          const team = input.tools.find(
            (entry) => entry.function.name === 'create_project_team',
          );
          teamSchemaAccepted = Boolean(
            team?.function.parameters.properties.members.minItems === 1 &&
            /续接已有项目时可只增补一位/u.test(team.function.description),
          );
          tool(input, 'create_project_team', {
            existing_project_id: f.project.id,
            title: f.project.title,
            brief: f.project.brief,
            members: [
              {
                new_agent: {
                  name: '实施工程师',
                  headline: '价格追踪应用实现与验证',
                  description: '负责可运行实现，并验证数据链路。',
                  project_work: true,
                },
                task: '接手受阻的应用实现工作项，形成可运行交付。',
              },
            ],
          });
        } else if (calls === 2) {
          const result = input.messages.findLast(
            (message) => message.role === 'tool',
          );
          if (result?.content) {
            try {
              addedMemberState = JSON.parse(result.content).state;
            } catch {}
          }
          const planTool = input.tools.find(
            (entry) => entry.function.name === 'manage_project_plan',
          );
          assert.ok(planTool, 'the existing project plan remains available');
          addedAgentId = f.projects
            .getProject(f.project.id)
            .members.at(-1).agentId;
          tool(input, 'manage_project_plan', {
            operation: 'update_item',
            project_id: f.project.id,
            expected_revision: 2,
            item_id: 'build-app',
            item_patch: { ownerAgentId: addedAgentId },
            status: 'in_progress',
            reason: '原阻塞是缺少执行能力；新增的项目执行成员已补足该条件。',
          });
        } else {
          if (
            input.messages.some(
              (message) =>
                message.role === 'tool' &&
                message.name === 'start_project_work',
            )
          ) {
            yield '项目执行任务已建立，正在等待工作区选择。';
            return;
          }
          const result = input.messages.findLast(
            (message) => message.role === 'tool',
          );
          if (result?.content) {
            try {
              const state = JSON.parse(result.content).state;
              if (state === 'members_added') addedMemberState = state;
            } catch {}
          }
          const executor = input.tools.find(
            (entry) => entry.function.name === 'start_project_work',
          );
          if (executor) {
            assert.deepEqual(input.toolChoice, {
              type: 'function',
              function: { name: 'start_project_work' },
            });
            exposedExecutorCalls++;
            if (
              executor.function.parameters.properties.agent_id.enum.includes(
                addedAgentId,
              ) &&
              executor.function.parameters.properties.plan_item_id.enum.includes(
                'build-app',
              )
            ) {
              tool(input, 'start_project_work', {
                project_id: f.project.id,
                agent_id: addedAgentId,
                plan_item_id: 'build-app',
                task: '实现价格追踪应用，并返回可运行交付及验证结果。',
              });
            } else {
              yield '新增成员不在项目执行名单中。';
            }
          } else {
            yield '已收到团队调整，继续检查当前可执行工作。';
          }
        }
      },
    },
    {
      projectWorkReady: true,
      onProjectWorkStart: (input) => startedWork.push(input),
    },
  );
  f.service.collaboration.planChanged = () => ({
    delivered: 0,
    limited: false,
  });
  try {
    let plan = f.projects.plans.replace({
      projectId: f.project.id,
      expectedRevision: 0,
      reason: '模拟价格追踪委托的受阻实现阶段。',
      plan: {
        objective: '交付可运行的价格追踪应用。',
        phases: [
          {
            id: 'implementation',
            title: '应用实现',
            outcome: '有可运行的价格追踪界面与数据链路。',
            exitCriteria: '至少一项真实价格来源完成端到端验证。',
            dependsOn: [],
            status: 'pending',
            evidence: '',
            workItems: [
              {
                id: 'build-app',
                title: '实现价格追踪应用',
                ownerAgentId: f.a,
                reviewerIds: ['user'],
                acceptance: '应用可运行并显示有来源依据的价格。',
                dependsOn: [],
                status: 'pending',
                evidence: '',
                blocker: '',
              },
            ],
          },
        ],
      },
    });
    plan = f.projects.plans.updateItem({
      projectId: f.project.id,
      expectedRevision: plan.revision,
      itemId: 'build-app',
      status: 'blocked',
      actorAgentId: f.a,
      blocker: '当前成员没有项目文件执行能力。',
      reason: '当前成员没有项目文件执行能力。',
    });
    assert.equal(plan.items[0].status, 'blocked');
    f.service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '继续推进价格追踪应用，处理团队当前的实现阻塞。',
    });
    await settle(f.service);
    assert.ok(calls >= 2);
    assert.equal(teamSchemaAccepted, true);
    assert.equal(addedMemberState, 'members_added');
    assert.ok(exposedExecutorCalls >= 1);
    const reboundItem = f.projects.plans
      .get(f.project.id)
      .items.find((item) => item.id === 'build-app');
    assert.equal(reboundItem.status, 'in_progress');
    assert.equal(reboundItem.ownerAgentId, addedAgentId);
    assert.equal(startedWork.length, 1);
    assert.equal(startedWork[0].agentId, addedAgentId);
    const current = f.projects.getProject(f.project.id);
    assert.equal(current.id, f.project.id);
    assert.equal(current.groupRoomId, f.project.groupRoomId);
    assert.deepEqual(
      current.members.slice(0, 2).map((member) => member.agentId),
      [f.a, f.b],
    );
    assert.ok(
      f.store.getAgent(addedAgentId).capabilities.includes('project-work'),
    );
    const groupMessages = f.store
      .getRoomSnapshot(f.project.groupRoomId)
      .messages.filter((message) => message.agentId === 'noema');
    assert.equal(groupMessages.length, 1);
    assert.match(groupMessages[0].content, /项目增补成员/u);
    assert.doesNotMatch(groupMessages[0].content, /项目启动/u);
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('team formation takes precedence over duplicate parallel specialist handoffs', async () => {
  let calls = 0;
  const f = setup({
    async *streamChat(input) {
      calls++;
      if (calls === 1) {
        const team = input.tools.find(
          (entry) => entry.function.name === 'create_project_team',
        );
        const delegation = input.tools.find(
          (entry) => entry.function.name === 'delegate_to_specialist',
        );
        assert.ok(team);
        assert.ok(delegation);
        input.onToolCalls([
          {
            id: 'call-team',
            type: 'function',
            function: {
              name: 'create_project_team',
              arguments: JSON.stringify({
                title: '平台价格追踪方案',
                brief: '比较价格数据来源、产品范围和维护方案。',
                members: [
                  { agent_id: f.a, task: '研究数据来源与更新约束。' },
                  {
                    new_agent: {
                      name: '成本分析员',
                      headline: '产品成本与用量分析',
                      description: '拆解成本模型并明确未核实的假设。',
                    },
                    task: '设计价格历史和月成本估算模型。',
                  },
                ],
              }),
            },
          },
          {
            id: 'call-duplicate-handoff',
            type: 'function',
            function: {
              name: 'delegate_to_specialist',
              arguments: JSON.stringify({
                agent_id: f.a,
                task: '研究数据来源与更新约束。',
              }),
            },
          },
        ]);
      } else {
        const assistantCall = input.messages.findLast(
          (message) => message.role === 'assistant' && message.tool_calls,
        );
        assert.deepEqual(
          assistantCall.tool_calls.map((call) => call.function.name),
          ['create_project_team'],
        );
        yield '团队已建立，尚未开始执行。';
      }
    },
  });
  try {
    const sent = f.service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请分析平台价格追踪方案。',
    });
    await settle(f.service);
    assert.equal(calls, 2);
    const project = f.projects
      .listProjects()
      .find((item) => item.title === '平台价格追踪方案');
    assert.ok(project);
    assert.equal(project.members.length, 2);
    assert.equal(f.store.getSocialMessage(sent.messageId).status, 'complete');
    assert.equal(
      f.store
        .getRoomSnapshot(f.store.getAgentResidentRoomId(f.a))
        .messages.some(
          (message) =>
            message.role === 'user' &&
            message.content.includes('研究数据来源与更新约束'),
        ),
      false,
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

test('an internal project report can continue only its assigned in-progress work package', async () => {
  let calls = 0;
  let reportGuidance = '';
  const started = [];
  const f = setup(
    {
      async *streamChat(input) {
        calls++;
        const report = input.messages.find((message) =>
          message.content?.includes('"type":"noema_project_member_report"'),
        );
        if (report) {
          if (
            input.messages.some(
              (message) =>
                message.role === 'tool' &&
                message.name === 'start_project_work',
            )
          ) {
            yield '已提交给工作包负责人；等待你在工作区选择器中确认目录。';
            return;
          }
          reportGuidance = input.messages.find(
            (message) =>
              message.role === 'system' &&
              message.content.includes('由系统交付的项目成员边界报告'),
          )?.content;
          assert.match(reportGuidance, /in_progress/u);
          assert.match(reportGuidance, /不要求用户重复授权/u);
          const startTool = input.tools.find(
            (entry) => entry.function.name === 'start_project_work',
          );
          assert.ok(startTool);
          assert.match(
            startTool.function.description,
            /existing active project mandate/u,
          );
          tool(input, 'start_project_work', {
            project_id: f.project.id,
            agent_id: f.b,
            plan_item_id: 'implement-store',
            task: '按 w3 验收条件实现报价存储与变化记录。',
          });
        } else {
          yield '已提交给工作包负责人；等待你在工作区选择器中确认目录。';
        }
      },
    },
    {
      projectWorkReady: true,
      onProjectWorkStart: (input) => started.push(input),
    },
  );
  f.store.setAgentProjectWork(f.b, true);
  installSingleWorkItem(f, {
    itemId: 'implement-store',
    status: 'in_progress',
  });
  try {
    f.service.collaboration.publish({
      projectId: f.project.id,
      senderAgentId: f.a,
      text: '@Noema 调研结论已提交，可以按计划进入实现。',
    });
    f.service.schedulePendingProjectReports();
    await settle(f.service);

    assert.ok(reportGuidance);
    assert.equal(calls, 1, 'one report decision starts the bounded work item');
    assert.equal(started.length, 1, JSON.stringify(started));
    assert.deepEqual(
      {
        roomId: started[0].roomId,
        projectId: started[0].projectId,
        agentId: started[0].agentId,
        dispatchFromNoema: started[0].dispatchFromNoema,
        prompt: started[0].prompt,
      },
      {
        roomId: 'room-noema',
        projectId: f.project.id,
        agentId: f.b,
        dispatchFromNoema: true,
        prompt: '按 w3 验收条件实现报价存储与变化记录。',
      },
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('an internal project report cannot start a blocked plan item', async () => {
  const started = [];
  const f = setup(
    {
      async *streamChat(input) {
        const report = input.messages.find((message) =>
          message.content?.includes('"type":"noema_project_member_report"'),
        );
        if (!report) return;
        tool(input, 'start_project_work', {
          project_id: f.project.id,
          agent_id: f.b,
          plan_item_id: 'blocked-store',
          task: '绕过计划阻塞开始实现。',
        });
      },
    },
    {
      projectWorkReady: true,
      onProjectWorkStart: (input) => started.push(input),
    },
  );
  f.store.setAgentProjectWork(f.b, true);
  f.projects.plans.onChange = null;
  f.projects.plans.replace({
    projectId: f.project.id,
    expectedRevision: 0,
    reason: '建立受阻工作包的安全边界。',
    plan: {
      objective: '实现受阻的应用工作。',
      phases: [
        {
          id: 'implementation',
          title: '应用实现',
          outcome: '实现工作可验收。',
          exitCriteria: '阻塞解决且工作通过验收。',
          dependsOn: [],
          status: 'pending',
          evidence: '',
          workItems: [
            {
              id: 'blocked-store',
              title: '实现报价存储',
              ownerAgentId: f.b,
              reviewerIds: [f.a],
              acceptance: '实现报价持久化。',
              dependsOn: [],
              status: 'pending',
              evidence: '',
              blocker: '',
            },
          ],
        },
      ],
    },
  });
  f.projects.plans.updateItem({
    projectId: f.project.id,
    expectedRevision: 1,
    itemId: 'blocked-store',
    status: 'blocked',
    blocker: '等待用户选择实现范围。',
    actorAgentId: f.b,
    reason: '保留计划设定的用户决策门。',
  });
  try {
    f.service.collaboration.publish({
      projectId: f.project.id,
      senderAgentId: f.a,
      text: '@Noema 目前仍受阻。',
    });
    f.service.schedulePendingProjectReports();
    await settle(f.service);

    assert.equal(started.length, 0);
    const failed = f.db
      .prepare(
        'SELECT status,error_code FROM social_project_reports WHERE project_id=? ORDER BY created_at DESC LIMIT 1',
      )
      .get(f.project.id);
    assert.equal(failed.status, 'failed', JSON.stringify(failed));
    assert.equal(
      failed.error_code,
      'social_tool_invalid',
      JSON.stringify(failed),
    );
  } finally {
    await f.service.shutdown();
    f.db.close();
  }
});

test('an internal project report rejects missing or mismatched work package bindings', async () => {
  for (const invalidBinding of [
    'missing-item',
    'wrong-project',
    'wrong-owner',
  ]) {
    const started = [];
    let f;
    let otherProject = null;
    const provider = {
      async *streamChat(input) {
        if (
          !input.messages.some((message) =>
            message.content?.includes('"type":"noema_project_member_report"'),
          )
        )
          return;
        const args = {
          project_id:
            invalidBinding === 'wrong-project' ? otherProject.id : f.project.id,
          agent_id: invalidBinding === 'wrong-owner' ? f.a : f.b,
          task: '尝试越过项目报告授权边界。',
        };
        if (invalidBinding !== 'missing-item')
          args.plan_item_id = 'implementation';
        tool(input, 'start_project_work', args);
      },
    };
    f = setup(provider, {
      projectWorkReady: true,
      onProjectWorkStart: (input) => started.push(input),
    });
    f.projects.plans.onChange = null;
    f.store.setAgentProjectWork(f.b, true);
    if (invalidBinding === 'wrong-owner')
      f.store.setAgentProjectWork(f.a, true);
    f.projects.plans.replace({
      projectId: f.project.id,
      expectedRevision: 0,
      reason: '建立报告续接边界测试。',
      plan: {
        objective: '按已授权范围完成报价追踪应用。',
        phases: [
          {
            id: 'implementation',
            title: '实现',
            outcome: '功能可运行。',
            exitCriteria: '工作包通过核验。',
            dependsOn: [],
            status: 'pending',
            evidence: '',
            workItems: [
              {
                id: 'implementation',
                title: '实现存储',
                ownerAgentId: f.b,
                reviewerIds: [f.a],
                acceptance: '实现报价持久化。',
                dependsOn: [],
                status: 'pending',
                evidence: '',
                blocker: '',
              },
            ],
          },
        ],
      },
    });
    f.projects.plans.updateItem({
      projectId: f.project.id,
      expectedRevision: 1,
      itemId: 'implementation',
      status: 'in_progress',
      actorAgentId: f.b,
      reason: '工作包进入执行。',
    });
    if (invalidBinding === 'wrong-project') {
      otherProject = f.projects.createProject({
        title: '其他项目',
        brief: '独立项目。',
        agentIds: ['noema', f.a, f.b],
      });
      f.projects.plans.replace({
        projectId: otherProject.id,
        expectedRevision: 0,
        reason: '建立另一个有效但无关的项目工作包。',
        plan: {
          objective: '另一个项目目标。',
          phases: [
            {
              id: 'other',
              title: '其他实现',
              outcome: '其他项目成果。',
              exitCriteria: '其他工作包通过核验。',
              dependsOn: [],
              status: 'pending',
              evidence: '',
              workItems: [
                {
                  id: 'implementation',
                  title: '其他项目实现',
                  ownerAgentId: f.b,
                  reviewerIds: [f.a],
                  acceptance: '其他项目的报价持久化。',
                  dependsOn: [],
                  status: 'pending',
                  evidence: '',
                  blocker: '',
                },
              ],
            },
          ],
        },
      });
      f.projects.plans.updateItem({
        projectId: otherProject.id,
        expectedRevision: 1,
        itemId: 'implementation',
        status: 'in_progress',
        actorAgentId: f.b,
        reason: '其他项目工作包进入执行。',
      });
    }
    try {
      f.service.collaboration.publish({
        projectId: f.project.id,
        senderAgentId: f.a,
        text: '@Noema 请检查本阶段进展。',
      });
      f.service.schedulePendingProjectReports();
      await settle(f.service);

      const failed = f.db
        .prepare(
          'SELECT status,error_code FROM social_project_reports WHERE project_id=? ORDER BY created_at DESC LIMIT 1',
        )
        .get(f.project.id);
      assert.equal(started.length, 0, invalidBinding);
      assert.equal(failed.status, 'failed', invalidBinding);
      assert.equal(failed.error_code, 'social_tool_invalid', invalidBinding);
    } finally {
      await f.service.shutdown();
      f.db.close();
    }
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
      else {
        const projectToolNames = input.tools
          .map((entry) => entry.function.name)
          .filter((name) =>
            ['manage_project_plan', 'project_group'].includes(name),
          );
        if (calls === 3) assert.deepEqual(projectToolNames, []);
        else
          assert.deepEqual(projectToolNames.sort(), [
            'manage_project_plan',
            'project_group',
          ]);
        yield '已收到明确反馈，继续按约束推进。';
      }
    },
  });
  try {
    f.service.collaboration.publish({
      projectId: f.project.id,
      senderAgentId: f.a,
      text: '@Noema 当前成果需要用户判断。',
    });
    f.service.schedulePendingProjectReports();
    await settle(f.service);
    assert.equal(f.projects.getProject(f.project.id).status, 'awaiting_user');
    assert.ok(
      f.store
        .getRoomSnapshot('room-noema')
        .messages.some((message) =>
          message.content.includes('请评审「摄影试办」'),
        ),
      'an explicit review request is visible in Noema main chat',
    );
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
              evidence_sources: [
                { kind: 'message', messageId: 'collab-a-evidence' },
              ],
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
    const evidenceTime = new Date().toISOString();
    f.db
      .prepare(`INSERT INTO social_messages
      (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at)
      VALUES ('collab-a-evidence',?,'collab-a-evidence','user',NULL,'需求证据：合成事实和未知项已核对。','complete','local',?,?)`)
      .run(f.project.groupRoomId, evidenceTime, evidenceTime);
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
      publicMessages.filter(
        (m) => m.agentId === f.a && m.role === 'assistant' && m.content.trim(),
      ).length,
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
