import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../../../src/main/chat/social-chat-store.mjs';
import { SocialProjectStore } from '../../../src/main/projects/social-project-store.mjs';
import { SocialChatService } from '../../../src/main/chat/social-chat-service.mjs';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noema-evidence-'));
  const db = new Database(':memory:');
  new RootStore(db);
  const chat = new SocialChatStore(db);
  const agent = chat.createAgent({
    name: '核查员',
    headline: '成果核对',
    description: '核查来源。',
    projectWork: true,
  }).members[0].id;
  const projects = new SocialProjectStore({ db, socialChatStore: chat });
  const project = projects.createProject({
    title: '成果闭环',
    brief: '使用真实记录核对版本。',
    agentIds: ['noema', agent],
  });
  projects.plans.onChange = null;
  const roomId = projects
    .getProject(project.id)
    .members.find((member) => member.agentId === agent).sessionRoomId;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO social_messages (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at)
    VALUES ('public',?,'turn','assistant',?,'原始成果','complete','local',?,?)`).run(
    project.groupRoomId,
    agent,
    now,
    now,
  );
  db.prepare(`INSERT INTO social_messages (id,room_id,turn_id,role,content,status,runtime,created_at,updated_at)
    VALUES ('system-notice',?,'notice','system','自动催办：请提交工作项成果。','complete','local',?,?)`).run(
    project.groupRoomId,
    now,
    now,
  );
  db.prepare(`INSERT INTO social_messages (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at)
    VALUES ('private',?,'private-turn','assistant',?,'私聊内容','complete','local',?,?)`).run(
    roomId,
    agent,
    now,
    now,
  );
  db.prepare(`INSERT INTO social_work_tasks (id,room_id,agent_id,workspace_path,workspace_key,task_prompt,model,runtime,status,result_text,verification_status,created_at,updated_at)
    VALUES ('task',?,?,?,?,'核对','fixture','dsh','completed','真实执行结果','verified',?,?)`).run(
    roomId,
    agent,
    directory,
    directory,
    now,
    now,
  );
  fs.writeFileSync(path.join(directory, 'result.txt'), '第一版');
  projects.plans.replace({
    projectId: project.id,
    expectedRevision: 0,
    reason: '建立工作包。',
    plan: {
      objective: '交付可核对成果。',
      items: [
        {
          id: 'produce',
          title: '生成成果',
          ownerAgentId: agent,
          acceptance: '结果与依据一致。',
          status: 'pending',
          dependsOn: [],
        },
        {
          id: 'consume',
          title: '接手成果',
          ownerAgentId: agent,
          acceptance: '核查上游版本。',
          status: 'pending',
          dependsOn: ['produce'],
        },
      ],
    },
  });
  const update = (status, extra = {}, actorAgentId = agent) =>
    projects.plans.updateItem({
      projectId: project.id,
      itemId: 'produce',
      expectedRevision: projects.plans.get(project.id).revision,
      actorAgentId,
      status,
      reason: '核对成果版本。',
      ...extra,
    });
  return {
    db,
    projects,
    project,
    agent,
    directory,
    update,
    close() {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('runtime captures public message identity and version; changed source blocks acceptance without refreshing it', () => {
  const f = fixture();
  try {
    const submitted = f.update('submitted', {
      evidence: '公开成果。',
      evidenceSources: [{ kind: 'message', messageId: 'public' }],
    });
    const item = submitted.items.find((entry) => entry.id === 'produce');
    assert.equal(item.evidenceRefs[0].sourceAuthorId, f.agent);
    assert.match(item.evidenceRefs[0].fingerprint, /^[a-f0-9]{64}$/u);
    assert.equal(
      f.projects.plans.inspectEvidence(f.project.id, 'produce').state,
      'unchanged',
    );
    f.db
      .prepare(
        "UPDATE social_messages SET content='更正后的成果' WHERE id='public'",
      )
      .run();
    const checked = f.projects.plans.inspectEvidence(f.project.id, 'produce');
    assert.equal(checked.state, 'needs_review');
    assert.deepEqual(
      checked.affectedItems.map((entry) => entry.id),
      ['produce', 'consume'],
    );
    assert.equal(checked.sources[0].excerpt, '更正后的成果');
    assert.throws(() => f.update('done', {}, 'noema'), /来源已变化/u);
    assert.equal(
      f.projects.plans.get(f.project.id).revision,
      submitted.revision,
    );
    assert.throws(
      () =>
        f.update(
          'done',
          { evidenceSources: [{ kind: 'message', messageId: 'public' }] },
          'noema',
        ),
      /不能替换/u,
    );
    f.update('submitted', {
      evidence: '更正后重交。',
      evidenceSources: [{ kind: 'message', messageId: 'public' }],
    });
    const accepted = f.update('done', {}, 'noema');
    const result = accepted.items.find((entry) => entry.id === 'produce');
    assert.equal(result.evidenceReview.actorId, 'noema');
    assert.equal(
      result.evidenceReview.submissionRevision,
      accepted.revision - 1,
    );
    assert.notEqual(
      result.evidenceRefs[0].fingerprint,
      item.evidenceRefs[0].fingerprint,
    );
  } finally {
    f.close();
  }
});

test('changed accepted dependency evidence blocks downstream work from starting', () => {
  const f = fixture();
  try {
    f.update('submitted', {
      evidence: '公开成果。',
      evidenceSources: [{ kind: 'message', messageId: 'public' }],
    });
    f.update('done', {}, 'noema');
    f.db
      .prepare(
        "UPDATE social_messages SET content='更正后的成果' WHERE id='public'",
      )
      .run();

    assert.throws(
      () =>
        f.projects.plans.updateItem({
          projectId: f.project.id,
          itemId: 'consume',
          expectedRevision: f.projects.plans.get(f.project.id).revision,
          actorAgentId: f.agent,
          status: 'in_progress',
          reason: '开始依赖前置成果的工作。',
        }),
      /前置成果来源已变化或不可用：生成成果/u,
    );
    const plan = f.projects.plans.get(f.project.id);
    assert.throws(
      () =>
        f.projects.plans.replace({
          projectId: f.project.id,
          expectedRevision: plan.revision,
          actorAgentId: 'noema',
          reason: '尝试通过计划修订绕过前置来源核验。',
          plan: {
            objective: plan.objective,
            phases: plan.phases.map((phase) => ({
              ...phase,
              workItems: phase.workItems.map((item) =>
                item.id === 'consume'
                  ? { ...item, status: 'in_progress' }
                  : item,
              ),
            })),
          },
        }),
      /前置成果来源已变化或不可用：生成成果/u,
    );
    assert.equal(
      f.projects.plans
        .get(f.project.id)
        .items.find((item) => item.id === 'consume').status,
      'pending',
    );
  } finally {
    f.close();
  }
});

test('changed evidence in a completed prerequisite phase blocks the next phase', () => {
  const f = fixture();
  try {
    f.projects.plans.replace({
      projectId: f.project.id,
      expectedRevision: f.projects.plans.get(f.project.id).revision,
      reason: '建立有阶段门槛的交付链。',
      plan: {
        objective: '只有研究成果仍然有效时才启动后续交付。',
        phases: [
          {
            id: 'research',
            title: '研究',
            outcome: '确认依据。',
            exitCriteria: '成果经独立核验。',
            status: 'pending',
            workItems: [
              {
                id: 'produce',
                title: '生成成果',
                ownerAgentId: f.agent,
                acceptance: '来源版本一致。',
                status: 'pending',
              },
            ],
          },
          {
            id: 'delivery',
            title: '后续交付',
            outcome: '基于研究推进。',
            exitCriteria: '交付完成。',
            dependsOn: ['research'],
            status: 'pending',
            workItems: [
              {
                id: 'consume',
                title: '接手成果',
                ownerAgentId: f.agent,
                acceptance: '使用已核验成果。',
                status: 'pending',
              },
            ],
          },
        ],
      },
    });
    f.update('submitted', {
      evidence: '研究成果。',
      evidenceSources: [{ kind: 'message', messageId: 'public' }],
    });
    let plan = f.update('done', {}, 'noema');
    plan = f.projects.plans.updatePhase({
      projectId: f.project.id,
      phaseId: 'research',
      expectedRevision: plan.revision,
      actorAgentId: 'noema',
      status: 'done',
      evidence: '研究通过核验。',
      reason: '验收研究阶段。',
    });
    f.db
      .prepare(
        "UPDATE social_messages SET content='已更正的研究成果' WHERE id='public'",
      )
      .run();

    assert.throws(
      () =>
        f.projects.plans.updateItem({
          projectId: f.project.id,
          itemId: 'consume',
          expectedRevision: plan.revision,
          actorAgentId: f.agent,
          status: 'in_progress',
          reason: '开始下一阶段工作。',
        }),
      /前置成果来源已变化或不可用：生成成果/u,
    );
  } finally {
    f.close();
  }
});

test('changed evidence can reopen its accepted dependency chain without erasing history', () => {
  const f = fixture();
  try {
    f.projects.plans.replace({
      projectId: f.project.id,
      expectedRevision: 1,
      reason: '把成果交接拆成有前置阶段的两个交付。',
      plan: {
        objective: '验证依据变化后项目阶段能够安全重核。',
        phases: [
          {
            id: 'research',
            title: '研究',
            outcome: '提交一份有来源的成果。',
            exitCriteria: '成果与来源版本一致。',
            dependsOn: [],
            status: 'pending',
            evidence: '',
            workItems: [
              {
                id: 'produce',
                title: '产出成果',
                ownerAgentId: f.agent,
                acceptance: '来源与成果匹配。',
                dependsOn: [],
                status: 'pending',
                evidence: '',
              },
            ],
          },
          {
            id: 'delivery',
            title: '交接',
            outcome: '基于已验收成果完成交接。',
            exitCriteria: '交接成果独立验收。',
            dependsOn: ['research'],
            status: 'pending',
            evidence: '',
            workItems: [
              {
                id: 'consume',
                title: '接手成果',
                ownerAgentId: f.agent,
                acceptance: '基于研究阶段结果完成交接。',
                dependsOn: [],
                status: 'pending',
                evidence: '',
              },
            ],
          },
        ],
      },
    });
    const update = (itemId, status, actorAgentId, extra = {}) =>
      f.projects.plans.updateItem({
        projectId: f.project.id,
        itemId,
        expectedRevision: f.projects.plans.get(f.project.id).revision,
        actorAgentId,
        status,
        reason: '完成测试工作项。',
        ...extra,
      });
    const submitAndAccept = (itemId, evidence, extra = {}) => {
      update(itemId, 'in_progress', f.agent);
      update(itemId, 'submitted', f.agent, {
        evidence,
        evidenceSources: [{ kind: 'message', messageId: 'public' }],
        ...extra,
      });
      update(itemId, 'done', 'noema');
    };
    submitAndAccept('produce', '原始成果', {
      evidenceSources: [{ kind: 'message', messageId: 'public' }],
    });
    let plan = f.projects.plans.get(f.project.id);
    plan = f.projects.plans.updatePhase({
      projectId: f.project.id,
      expectedRevision: plan.revision,
      phaseId: 'research',
      status: 'done',
      evidence: '研究成果通过独立核验。',
      actorAgentId: 'noema',
      reason: '验收研究阶段。',
    });
    submitAndAccept('consume', '按研究成果完成交接');
    plan = f.projects.plans.get(f.project.id);
    plan = f.projects.plans.updatePhase({
      projectId: f.project.id,
      expectedRevision: plan.revision,
      phaseId: 'delivery',
      status: 'done',
      evidence: '交接成果通过独立核验。',
      actorAgentId: 'noema',
      reason: '验收交接阶段。',
    });
    assert.equal(plan.phaseProgress.percentage, 100);

    f.db
      .prepare(
        "UPDATE social_messages SET content='修订后的成果' WHERE id='public'",
      )
      .run();
    const check = f.projects.plans.inspectEvidence(f.project.id, 'produce');
    assert.deepEqual(
      check.affectedItems.map((entry) => entry.id),
      ['produce', 'consume'],
    );
    const reopened = f.projects.plans.reopenEvidenceImpact({
      projectId: f.project.id,
      itemId: 'produce',
      expectedRevision: plan.revision,
      actorAgentId: null,
    });
    assert.deepEqual(
      reopened.items.map((entry) => [entry.id, entry.status]),
      [
        ['produce', 'pending'],
        ['consume', 'pending'],
      ],
    );
    assert.deepEqual(
      reopened.phases.map((phase) => [phase.id, phase.status, phase.evidence]),
      [
        ['research', 'pending', ''],
        ['delivery', 'pending', ''],
      ],
    );
    assert.equal(reopened.phaseProgress.percentage, 0);
    assert.equal(
      reopened.items.find((entry) => entry.id === 'produce').evidenceRefs
        .length,
      0,
    );
    const priorRevision = f.db
      .prepare(
        'SELECT items_json FROM social_project_plan_revisions WHERE project_id = ? AND revision = ?',
      )
      .get(f.project.id, plan.revision);
    const priorSnapshot = JSON.parse(priorRevision.items_json);
    assert.equal(priorSnapshot.phases[0].status, 'done');
    assert.equal(
      priorSnapshot.phases[0].workItems[0].evidenceReview.actorId,
      'noema',
    );
  } finally {
    f.close();
  }
});

test('evidence impact cannot reopen while any affected member is working', () => {
  const f = fixture();
  try {
    f.update('submitted', {
      evidence: '成果依据。',
      evidenceSources: [{ kind: 'message', messageId: 'public' }],
    });
    f.update('done', {}, 'noema');
    f.projects.plans.updateItem({
      projectId: f.project.id,
      itemId: 'consume',
      expectedRevision: f.projects.plans.get(f.project.id).revision,
      actorAgentId: f.agent,
      status: 'in_progress',
      reason: '开始依赖该成果工作。',
    });
    f.db
      .prepare(
        "UPDATE social_messages SET content='修订后的成果' WHERE id='public'",
      )
      .run();
    const check = f.projects.plans.inspectEvidence(f.project.id, 'produce');
    assert.deepEqual(
      check.reopenBlockedItems.map((entry) => entry.id),
      ['consume'],
    );
    const revision = f.projects.plans.get(f.project.id).revision;
    assert.throws(
      () =>
        f.projects.plans.reopenEvidenceImpact({
          projectId: f.project.id,
          itemId: 'produce',
          expectedRevision: revision,
          actorAgentId: null,
        }),
      /仍在进行/u,
    );
    assert.equal(f.projects.plans.get(f.project.id).revision, revision);
    assert.equal(
      f.projects.plans
        .get(f.project.id)
        .items.find((item) => item.id === 'produce').status,
      'done',
    );
  } finally {
    f.close();
  }
});

test('private, absent, unfinished and duplicated sources cannot become public evidence', () => {
  const f = fixture();
  try {
    for (const messageId of ['private', 'absent', 'system-notice'])
      assert.throws(
        () =>
          f.update('submitted', {
            evidence: '来源',
            evidenceSources: [{ kind: 'message', messageId }],
          }),
        /公开群消息/u,
      );
    assert.throws(
      () =>
        f.update('submitted', {
          evidence: '来源',
          evidenceSources: [
            { kind: 'message', messageId: 'public' },
            { kind: 'message', messageId: 'public' },
          ],
        }),
      /重复/u,
    );
    f.db
      .prepare(
        "UPDATE social_messages SET status='streaming' WHERE id='public'",
      )
      .run();
    assert.throws(
      () =>
        f.update('submitted', {
          evidence: '来源',
          evidenceSources: [{ kind: 'message', messageId: 'public' }],
        }),
      /仍在生成/u,
    );
    f.db
      .prepare("UPDATE social_work_tasks SET status='running' WHERE id='task'")
      .run();
    assert.throws(
      () =>
        f.update('submitted', {
          evidence: '来源',
          evidenceSources: [{ kind: 'execution', taskId: 'task' }],
        }),
      /尚未结束/u,
    );
    assert.equal(f.projects.plans.get(f.project.id).revision, 1);
  } finally {
    f.close();
  }
});

test('execution errors remain failures; files inherit task workspace and detect changed or missing contents', () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        "UPDATE social_work_tasks SET status='failed',result_text='',error_message='构建失败' WHERE id='task'",
      )
      .run();
    f.update('submitted', {
      evidence: '失败记录与输出文件。',
      evidenceSources: [
        { kind: 'execution', taskId: 'task' },
        { kind: 'file', taskId: 'task', path: 'result.txt' },
      ],
    });
    let checked = f.projects.plans.inspectEvidence(f.project.id, 'produce');
    assert.equal(checked.state, 'unchanged');
    assert.equal(checked.sources[0].sourceStatus, 'failed');
    assert.equal(checked.sources[0].excerpt, '构建失败');
    fs.writeFileSync(path.join(f.directory, 'result.txt'), '第二版');
    checked = f.projects.plans.inspectEvidence(f.project.id, 'produce');
    assert.equal(checked.sources[1].state, 'changed');
    assert.throws(() => f.update('done', {}, 'noema'), /来源已变化/u);
    fs.unlinkSync(path.join(f.directory, 'result.txt'));
    assert.equal(
      f.projects.plans.inspectEvidence(f.project.id, 'produce').sources[1]
        .state,
      'unavailable',
    );
    assert.throws(() =>
      f.update('submitted', {
        evidenceSources: [{ kind: 'file', taskId: 'task', path: '../outside' }],
      }),
    );
    assert.throws(
      () =>
        f.update('submitted', {
          evidenceSources: [
            { kind: 'file', taskId: 'task', path: f.directory },
          ],
        }),
      /相对路径/u,
    );
  } finally {
    f.close();
  }
});

test('plan replacements cannot forge or erase runtime references; phase acceptance rechecks source versions', () => {
  const f = fixture();
  try {
    f.update('submitted', {
      evidence: '原始成果',
      evidenceSources: [{ kind: 'message', messageId: 'public' }],
    });
    const accepted = f.update('done', {}, 'noema');
    const stored = accepted.items[0];
    const plan = {
      objective: accepted.objective,
      phases: accepted.phases.map((phase) => ({
        ...phase,
        workItems: phase.workItems.map((item) => ({
          ...item,
          evidenceRefs: [],
          evidenceReview: {
            actorId: 'forged',
            reviewedAt: 'fake',
            submissionRevision: 1,
          },
        })),
      })),
    };
    const replaced = f.projects.plans.replace({
      projectId: f.project.id,
      expectedRevision: accepted.revision,
      reason: '整理计划。',
      plan,
    });
    assert.deepEqual(replaced.items[0].evidenceRefs, stored.evidenceRefs);
    assert.deepEqual(replaced.items[0].evidenceReview, stored.evidenceReview);
    const canceled = f.projects.plans.updateItem({
      projectId: f.project.id,
      itemId: 'consume',
      expectedRevision: replaced.revision,
      actorAgentId: 'noema',
      status: 'canceled',
      reason: '无需接手。',
    });
    f.db
      .prepare(
        "UPDATE social_messages SET content='验收后又改动' WHERE id='public'",
      )
      .run();
    assert.throws(
      () =>
        f.projects.plans.updatePhase({
          projectId: f.project.id,
          phaseId: 'legacy-stage',
          expectedRevision: canceled.revision,
          status: 'done',
          actorAgentId: 'noema',
          evidence: '整体核对。',
          reason: '核查阶段。',
        }),
      /阶段成果来源已变化/u,
    );
  } finally {
    f.close();
  }
});

test('legacy text is explicitly unlinked, and deleted sources are never reported unchanged', () => {
  const f = fixture();
  try {
    const current = f.projects.plans.get(f.project.id);
    const row = f.db
      .prepare(
        'SELECT items_json FROM social_project_plan_revisions WHERE project_id = ? AND revision = ?',
      )
      .get(f.project.id, current.revision);
    const legacySnapshot = JSON.parse(row.items_json);
    const legacyItem = legacySnapshot.phases
      .flatMap((phase) => phase.workItems)
      .find((item) => item.id === 'produce');
    Object.assign(legacyItem, {
      status: 'submitted',
      evidence: '旧文字说明。',
      evidenceRefs: [],
      evidenceReview: null,
      submittedByAgentId: f.agent,
      submittedAt: new Date().toISOString(),
      submissionRevision: current.revision,
    });
    f.db
      .prepare(
        'UPDATE social_project_plan_revisions SET items_json = ? WHERE project_id = ? AND revision = ?',
      )
      .run(JSON.stringify(legacySnapshot), f.project.id, current.revision);
    assert.equal(
      f.projects.plans.inspectEvidence(f.project.id, 'produce').state,
      'unlinked',
    );
    f.update('submitted', {
      evidenceSources: [{ kind: 'message', messageId: 'public' }],
    });
    f.db.prepare("DELETE FROM social_messages WHERE id='public'").run();
    assert.equal(
      f.projects.plans.inspectEvidence(f.project.id, 'produce').sources[0]
        .state,
      'unavailable',
    );
  } finally {
    f.close();
  }
});

test('file capture rejects symlink escapes and oversized sources without weakening the workspace boundary', () => {
  const f = fixture();
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-evidence-outside-'),
  );
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), '不应读取');
    fs.symlinkSync(
      outside,
      path.join(f.directory, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(
      () =>
        f.update('submitted', {
          evidence: '越界来源',
          evidenceSources: [
            { kind: 'file', taskId: 'task', path: 'escape/secret.txt' },
          ],
        }),
      /超出任务工作区/u,
    );
    const large = path.join(f.directory, 'large.bin');
    fs.writeFileSync(large, '');
    fs.truncateSync(large, 16 * 1024 * 1024 + 1);
    assert.throws(
      () =>
        f.update('submitted', {
          evidence: '大文件',
          evidenceSources: [
            { kind: 'file', taskId: 'task', path: 'large.bin' },
          ],
        }),
      /16 MiB/u,
    );
    assert.equal(f.projects.plans.get(f.project.id).revision, 1);
  } finally {
    f.close();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('project execution results survive waiting, publish once, and do not replay old tasks or wake on interruption', async () => {
  const f = fixture();
  const service = new SocialChatService({
    store: new SocialChatStore(f.db),
    projectStore: f.projects,
    provider: {
      async *streamChat() {
        yield* [];
        throw Error('This boundary check must not call a model.');
      },
    },
    secretStore: { isConfigured: () => false },
    getSelectedModel: () => null,
    getRootState: async () => ({ providerConfigured: false }),
  });
  try {
    service.syncProjectWorkResults();
    assert.equal(
      f.db
        .prepare('SELECT COUNT(*) AS n FROM social_project_publications')
        .get().n,
      0,
      'old tasks are not replayed',
    );
    f.update('in_progress');
    const task = f.db
      .prepare(
        "SELECT room_id AS roomId FROM social_work_tasks WHERE id='task'",
      )
      .get();
    service.trackProjectWorkResult(
      {
        agentId: f.agent,
        projectContext: { projectId: f.project.id, roomId: task.roomId },
        planItemId: 'produce',
      },
      'task',
    );
    f.db
      .prepare("UPDATE social_projects SET status='awaiting_user' WHERE id=?")
      .run(f.project.id);
    service.syncProjectWorkResults();
    assert.equal(
      f.db
        .prepare(
          "SELECT project_result_pending AS pending FROM social_work_tasks WHERE id='task'",
        )
        .get().pending,
      1,
    );
    f.db
      .prepare("UPDATE social_projects SET status='active' WHERE id=?")
      .run(f.project.id);
    service.syncProjectWorkResults();
    service.syncProjectWorkResults();
    const publications = f.db
      .prepare('SELECT * FROM social_project_publications')
      .all();
    assert.equal(publications.length, 1);
    const message = f.db
      .prepare('SELECT content FROM social_messages WHERE id=?')
      .get(publications[0].message_id);
    assert.match(message.content, /@核查员/u);
    assert.match(message.content, /"taskId":"task"/u);
    assert.doesNotMatch(
      message.content,
      /project_id="/u,
      'a member-bound project session omits project_id',
    );
    assert.doesNotMatch(
      message.content,
      /真实执行结果/u,
      'raw tool output cannot introduce extra mentions',
    );
    assert.equal(
      f.db
        .prepare('SELECT agent_id AS agentId FROM social_project_group_inbox')
        .get().agentId,
      f.agent,
    );
    f.db
      .prepare(
        "UPDATE social_work_tasks SET status='interrupted',project_result_pending=1 WHERE id='task'",
      )
      .run();
    service.syncProjectWorkResults();
    assert.equal(
      f.db
        .prepare(
          "SELECT project_result_pending AS pending FROM social_work_tasks WHERE id='task'",
        )
        .get().pending,
      0,
    );
    assert.equal(
      f.db
        .prepare('SELECT COUNT(*) AS n FROM social_project_publications')
        .get().n,
      1,
    );
    f.db
      .prepare(
        "UPDATE social_work_tasks SET status='failed',error_message='@所有人 不可信输出',project_result_pending=1 WHERE id='task'",
      )
      .run();
    service.syncProjectWorkResults();
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM social_project_reports WHERE status='pending'")
        .get(),
    );
    const failure = f.db
      .prepare(
        "SELECT content FROM social_messages WHERE role='system' AND content LIKE '@Noema 项目执行任务%'",
      )
      .get();
    assert.doesNotMatch(failure.content, /@所有人/u);
    assert.match(failure.content, /不能盲目自动重试/u);
    assert.match(
      failure.content,
      new RegExp(`project_id="${f.project.id}"`, 'u'),
    );
  } finally {
    await service.shutdown();
    f.close();
  }
});

test('schema upgrade refreshes obsolete app-owned file instructions and preserves custom text', () => {
  const f = fixture();
  try {
    const obsolete =
      '用户已开启 Noema 的项目文件任务能力。只有当用户明确切换到项目工作并选择目录后，才在该任务中通过现有 DSH 流程操作文件。普通聊天不授权文件操作；每项任务的具体范围以 Noema 显示的目录与数据确认步骤为准。';
    f.db
      .prepare('UPDATE social_agents SET system_prompt=? WHERE id=?')
      .run(`保留自定义前文\n${obsolete}\n保留自定义后文`, f.agent);
    f.db.exec(
      'ALTER TABLE social_project_group_inbox DROP COLUMN plan_submission_revision; ALTER TABLE social_work_tasks DROP COLUMN project_plan_item_id; ALTER TABLE social_work_tasks DROP COLUMN project_result_pending; DELETE FROM social_schema_migrations WHERE version>=25',
    );
    new SocialChatStore(f.db);
    const prompt = f.db
      .prepare('SELECT system_prompt AS text FROM social_agents WHERE id=?')
      .get(f.agent).text;
    assert.match(prompt, /保留自定义前文/u);
    assert.match(prompt, /保留自定义后文/u);
    assert.match(prompt, /start_project_work/u);
    assert.doesNotMatch(prompt, /切换到项目工作|DSH/u);
    assert.equal(
      f.db
        .prepare(
          'SELECT project_result_pending AS pending FROM social_work_tasks',
        )
        .get().pending,
      0,
    );
  } finally {
    f.close();
  }
});

test('failed execution retains bounded step evidence without changing legacy result fingerprints', () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        "UPDATE social_work_tasks SET status='failed',result_text='',error_message='预算耗尽' WHERE id='task'",
      )
      .run();
    const evidence = f.projects.plans.evidence;
    const before = evidence.readSources(f.project.id, [
      { kind: 'execution', taskId: 'task' },
    ])[0];
    const syntheticCredential = `sk-${'a'.repeat(32)}`;
    f.db
      .prepare(`INSERT INTO social_work_execution_steps
      (id,task_id,ordinal,tool_name,category,has_side_effect,status,effect_status,started_at,arguments_json,result_json)
      VALUES ('step','task',1,'read_file','read',0,'succeeded','none',?,'{"path":"result.txt"}',?)`)
      .run(
        new Date().toISOString(),
        JSON.stringify({
          result: `已读取结果。测试凭据 ${syntheticCredential}`,
        }),
      );
    const task = evidence.readSources(f.project.id, [
      { kind: 'execution', taskId: 'task' },
    ])[0];
    assert.equal(task.fingerprint, before.fingerprint);
    assert.equal(task.executionSteps[0].path, 'result.txt');
    assert.equal(task.executionSteps[0].hasOutput, true);
    const step = evidence.readSources(f.project.id, [
      { kind: 'execution', taskId: 'task', stepId: 'step' },
    ])[0];
    assert.equal(step.sourceStatus, 'succeeded');
    assert.match(step.excerpt, /已隐藏疑似凭据/u);
    assert.equal(step.excerpt.includes(syntheticCredential), false);
    assert.throws(
      () =>
        evidence.readSources(f.project.id, [
          { kind: 'execution', taskId: 'task', stepId: 'other-task-step' },
        ]),
      /不属于此任务/u,
    );
    assert.throws(
      () => evidence.readSources(f.project.id, undefined),
      /evidence_sources 数组/u,
    );
  } finally {
    f.close();
  }
});
