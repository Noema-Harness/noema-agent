import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';
import { SocialChatService } from '../src/social-chat-service.mjs';
import { createSocialTestStore } from '../test-support/social-team.mjs';

test('plan tools return actionable conflict fields and on-demand revision values', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const projects = new SocialProjectStore({ db, socialChatStore: store });
  const project = projects.createProject({
    title: '局部计划修改',
    brief: '核查版本冲突。',
    agentIds: ['noema', 'engineering-partner'],
  });
  projects.plans.onChange = null;
  projects.plans.replace({
    projectId: project.id,
    expectedRevision: 0,
    reason: '建立计划。',
    plan: {
      objective: '验证局部修改。',
      items: [
        {
          id: 'sources',
          title: '资料',
          ownerAgentId: 'engineering-partner',
          acceptance: '提供来源。',
          status: 'pending',
          dependsOn: [],
        },
      ],
    },
  });
  projects.plans.updateItem({
    projectId: project.id,
    expectedRevision: 1,
    itemId: 'sources',
    patch: { title: '原始资料' },
    reason: '明确资料要求。',
    actorAgentId: 'noema',
  });
  let calls = 0;
  const service = new SocialChatService({
    store,
    projectStore: projects,
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    provider: {
      async *streamChat(input) {
        calls += 1;
        if (calls === 2) {
          const conflict = JSON.parse(input.messages.at(-1).content);
          assert.equal(conflict.code, 'PLAN_CONFLICT');
          assert.equal(conflict.currentRevision, 2);
          assert.ok(
            conflict.conflicts.some(
              (entry) =>
                entry.entity === 'item:sources' &&
                entry.fields.includes('title'),
            ),
          );
        }
        if (calls <= 2)
          input.onToolCalls?.([
            {
              id: `plan-${calls}`,
              type: 'function',
              function: {
                name: 'manage_project_plan',
                arguments: JSON.stringify(
                  calls === 1
                    ? {
                        operation: 'update_item',
                        project_id: project.id,
                        expected_revision: 1,
                        item_id: 'sources',
                        item_patch: { title: '旧资料' },
                        reason: '基于过期版本。',
                      }
                    : {
                        operation: 'history',
                        project_id: project.id,
                        revision: 2,
                        item_id: 'sources',
                        reason: '核对变更字段。',
                      },
                ),
              },
            },
          ]);
        else {
          const detail = JSON.parse(input.messages.at(-1).content);
          assert.equal(detail.revision, 2);
          assert.deepEqual(detail.changes[0].values.title, {
            before: '资料',
            after: '原始资料',
          });
          yield '已找到题目变更，旧写入没有覆盖它。';
        }
      },
    },
  });
  service.onProjectPlanChanged = () => {};
  try {
    const turn = service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '查看这个项目计划的最近修改。',
    });
    await service.active.get('room-noema')?.done;
    assert.equal(store.getSocialMessage(turn.messageId).status, 'complete');
    assert.equal(calls, 3);
    assert.equal(projects.plans.get(project.id).revision, 2);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('Noema reads then writes a versioned plan in one turn; members cannot forge an accepting actor', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const projects = new SocialProjectStore({ db, socialChatStore: store });
  const project = projects.createProject({
    title: '阶段规划',
    brief: '计划不等于已经执行。',
    agentIds: ['noema', 'engineering-partner'],
  });
  const requests = [];
  const invoke = (input, id, args) =>
    input.onToolCalls?.([
      {
        id,
        type: 'function',
        function: {
          name: 'manage_project_plan',
          arguments: JSON.stringify(args),
        },
      },
    ]);
  const service = new SocialChatService({
    store,
    projectStore: projects,
    getProjectSessionContext: (roomId, agentId) =>
      projects.getProjectSessionContext(roomId, agentId),
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    provider: {
      async *streamChat(input) {
        requests.push(input);
        if (requests.length === 1)
          invoke(input, 'read-plan', {
            operation: 'read',
            project_id: project.id,
            reason: '读取当前计划以确定初始版本。',
          });
        else if (requests.length === 2) {
          const read = JSON.parse(input.messages.at(-1).content);
          assert.equal(read.revision, 0);
          assert.deepEqual(
            read.activeMembers.map((member) => member.agentId),
            ['engineering-partner'],
          );
          invoke(input, 'write-plan', {
            operation: 'replace',
            project_id: project.id,
            expected_revision: read.revision,
            reason: '用户委托后形成首轮工作范围。',
            plan: {
              stage: '预研究',
              objective: '找到需要继续核实的工程问题。',
              items: [
                {
                  id: 'sources',
                  title: '原始资料',
                  ownerAgentId: 'engineering-partner',
                  acceptance: '列出原始来源及未知项。',
                  dependsOn: [],
                  status: 'pending',
                },
              ],
            },
          });
        } else if (requests.length === 3)
          yield '阶段计划已建立，工作尚未开始。';
        else if (requests.length === 4) {
          const context = JSON.parse(
            input.messages.find((message) =>
              message.content.includes('"type":"noema_project_session"'),
            ).content,
          );
          assert.equal(context.plan.revision, 1);
          invoke(input, 'bad-accept', {
            operation: 'update_item',
            project_id: project.id,
            expected_revision: 1,
            item_id: 'sources',
            status: 'done',
            evidence: '自称完成',
            reason: '尝试自行验收。',
            actorAgentId: 'noema',
          });
        } else if (requests.length === 5) {
          assert.match(
            JSON.parse(input.messages.at(-1).content).error,
            /不能自行验收/u,
          );
          yield '我还不能自行验收自己的工作。';
        } else {
          const tool = input.tools.find(
            (entry) => entry.function.name === 'manage_project_plan',
          );
          assert.deepEqual(
            tool.function.parameters.properties.project_id.enum,
            [project.id],
          );
          assert.deepEqual(tool.function.parameters.required, [
            'operation',
            'project_id',
            'reason',
          ]);
          assert.match(
            tool.function.description,
            /工程搭档 \(engineering-partner\)/u,
          );
          assert.match(tool.function.description, /Noema is the coordinator/u);
          assert.deepEqual(
            tool.function.parameters.properties.plan.properties.phases.items
              .properties.workItems.items.properties.ownerAgentId.enum,
            ['engineering-partner'],
          );
          yield '可以在项目群里查看和维护当前计划。';
        }
      },
    },
  });
  // Isolate plan-tool authorization; automatic delivery is covered by project-collaboration tests.
  projects.plans.onChange = null;
  service.onProjectPlanChanged = () => {};
  try {
    const root = service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请为这个受托项目建立阶段计划。',
    });
    await service.active.get('room-noema')?.done;
    assert.equal(store.getSocialMessage(root.messageId).status, 'complete');
    assert.equal(projects.plans.get(project.id).revision, 1);
    const session = projects.getProjectSession(
      project.id,
      'engineering-partner',
    );
    const member = service.sendMessage({
      roomId: session.room.room.id,
      agentId: 'engineering-partner',
      text: '查看并处理自己的计划事项。',
    });
    await service.active.get(session.room.room.id)?.done;
    assert.equal(store.getSocialMessage(member.messageId).status, 'complete');
    assert.equal(projects.plans.get(project.id).revision, 1);
    assert.equal(projects.plans.get(project.id).items[0].status, 'pending');
    assert.equal(requests.length, 5);
    const group = service.sendMessage({
      roomId: project.groupRoomId,
      agentId: 'noema',
      text: '@Noema 查看项目计划。',
    });
    for (
      let i = 0;
      i < 30 &&
      (service.active.size ||
        service.projectReportDrain ||
        service.projectGroupInboxDrains.size);
      i++
    )
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(store.getSocialMessage(group.messageId).status, 'complete');
    assert.equal(requests.length, 6);
  } finally {
    await service.shutdown();
    db.close();
  }
});
