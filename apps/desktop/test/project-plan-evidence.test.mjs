import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';

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

test('private, absent, unfinished and duplicated sources cannot become public evidence', () => {
  const f = fixture();
  try {
    for (const messageId of ['private', 'absent'])
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
    f.update('submitted', { evidence: '旧文字说明。' });
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
