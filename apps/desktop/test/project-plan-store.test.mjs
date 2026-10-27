import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';

function setup(filename = ':memory:') {
  const db = new Database(filename);
  new RootStore(db);
  const chat = new SocialChatStore(db);
  const a = chat.createAgent({
    name: '研究员',
    headline: '研究',
    description: '核对资料。',
    projectWork: false,
  }).members[0].id;
  const b = chat.createAgent({
    name: '预算员',
    headline: '预算',
    description: '核算成本。',
    projectWork: false,
  }).members[0].id;
  const projects = new SocialProjectStore({ db, socialChatStore: chat });
  const project = projects.createProject({
    title: '摄影试办',
    brief: '先判断可行性。',
    agentIds: ['noema', a, b],
  });
  const plan = {
    stage: '预研究',
    objective: '判断是否值得试办。',
    items: [
      {
        id: 'research',
        title: '需求证据',
        ownerAgentId: a,
        acceptance: '提供来源和未核实项。',
        dependsOn: [],
        status: 'pending',
      },
      {
        id: 'budget',
        title: '预算草案',
        ownerAgentId: b,
        acceptance: '依据研究成果列出成本。',
        dependsOn: ['research'],
        status: 'pending',
      },
    ],
  };
  return { db, chat, projects, project, a, b, plan };
}

test('only accepted deliveries advance progress and unlock dependent work across restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noema-plan-'));
  const filename = path.join(directory, 'plan.sqlite3');
  const { db, projects, project, a, b, plan } = setup(filename);
  let reopened;
  try {
    assert.equal(projects.plans.get(project.id).progress.percentage, null);
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '建立阶段范围。',
      plan,
    });
    const update = (itemId, status, actorAgentId, extra = {}) =>
      projects.plans.updateItem({
        projectId: project.id,
        expectedRevision: projects.plans.get(project.id).revision,
        itemId,
        status,
        actorAgentId,
        reason: '推进阶段交付。',
        ...extra,
      });
    assert.throws(() => update('budget', 'in_progress', b), /前置交付/u);
    update('research', 'in_progress', a);
    assert.throws(() => update('research', 'submitted', a), /成果依据/u);
    const submitted = update('research', 'submitted', a, {
      evidence: '调研记录与两份原始来源，价格尚待核实。',
    });
    assert.equal(submitted.progress.percentage, 0);
    assert.equal(submitted.progress.submitted, 1);
    assert.throws(() => update('research', 'done', a), /不能自行验收/u);
    const accepted = update('research', 'done', 'noema');
    assert.equal(accepted.progress.percentage, 50);
    assert.equal(
      accepted.items.find((item) => item.id === 'budget').ready,
      true,
    );
    const started = update('budget', 'in_progress', b);
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: 1,
          itemId: 'budget',
          status: 'blocked',
          blocker: '旧版本覆盖。',
          reason: '并发更新。',
          actorAgentId: b,
        }),
      /计划已被更新/u,
    );
    db.close();
    reopened = new Database(filename);
    const reloaded = new SocialProjectStore({
      db: reopened,
      socialChatStore: new SocialChatStore(reopened),
    });
    assert.deepEqual(reloaded.plans.get(project.id), started);
    assert.equal(reloaded.plans.history(project.id).length, 5);
    assert.equal(
      reloaded.plans.history(project.id).find((row) => row.revision === 4)
        .actorAgentId,
      'noema',
    );
  } finally {
    if (db.open) db.close();
    reopened?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('phases form explicit delivery gates and project progress aggregates accepted phases', () => {
  const { db, projects, project, a, b } = setup();
  try {
    const initial = projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '把项目分成预研究和试办两个结果阶段。',
      plan: {
        objective: '判断摄影工作坊是否值得试办，并形成可执行方案。',
        phases: [
          {
            id: 'research',
            title: '预研究',
            outcome: '形成有来源依据的需求与成本判断。',
            exitCriteria: '研究结论可复核，关键未知明确标出。',
            dependsOn: [],
            status: 'pending',
            evidence: '',
            workItems: [
              {
                id: 'market',
                title: '核对需求证据',
                ownerAgentId: a,
                acceptance: '记录来源、发现和未核实项。',
                dependsOn: [],
                status: 'pending',
                evidence: '',
                blocker: '',
              },
            ],
          },
          {
            id: 'pilot',
            title: '小规模试办',
            outcome: '在限定预算下完成一次试办。',
            exitCriteria: '交付现场结果、成本记录和复盘。',
            dependsOn: ['research'],
            status: 'pending',
            evidence: '',
            workItems: [
              {
                id: 'budget',
                title: '制定试办预算',
                ownerAgentId: b,
                acceptance: '预算与需求证据相互对应。',
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
    assert.equal(initial.phaseProgress.percentage, 0);
    assert.equal(initial.phaseProgress.total, 2);
    assert.equal(initial.phases[1].workItems[0].ready, false);
    assert.deepEqual(initial.phases[1].workItems[0].waitingForPhases, [
      'research',
    ]);
    assert.throws(
      () =>
        projects.plans.updatePhase({
          projectId: project.id,
          expectedRevision: initial.revision,
          phaseId: 'research',
          actorAgentId: 'noema',
          status: 'done',
          evidence: '研究结果已复核。',
          reason: '尝试越过未验收工作项。',
        }),
      /工作项未全部验收/u,
    );
    const startedResearch = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: initial.revision,
      itemId: 'market',
      actorAgentId: a,
      status: 'in_progress',
      reason: '开始核对市场需求。',
    });
    const submittedResearch = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: startedResearch.revision,
      itemId: 'market',
      actorAgentId: a,
      status: 'submitted',
      evidence: '两份原始来源与采访记录。',
      reason: '提交需求证据。',
    });
    const acceptedWork = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: submittedResearch.revision,
      itemId: 'market',
      actorAgentId: 'noema',
      status: 'done',
      reason: '核验需求证据。',
    });
    const acceptedResearch = projects.plans.updatePhase({
      projectId: project.id,
      expectedRevision: acceptedWork.revision,
      phaseId: 'research',
      actorAgentId: 'noema',
      status: 'done',
      evidence: '研究结论和未核实项已复核。',
      reason: '验收预研究阶段。',
    });
    assert.equal(acceptedResearch.phaseProgress.percentage, 50);
    assert.equal(acceptedResearch.phases[1].workItems[0].ready, true);
    assert.equal(acceptedResearch.progress.percentage, 50);
    const next = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: acceptedResearch.revision,
      itemId: 'budget',
      actorAgentId: b,
      status: 'in_progress',
      reason: '进入试办阶段。',
    });
    assert.equal(next.phaseProgress.percentage, 50);
    assert.equal(next.phases[1].state, 'in_progress');
    const done = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: next.revision,
      itemId: 'budget',
      actorAgentId: b,
      status: 'submitted',
      evidence: '预算与研究结果逐项对应。',
      reason: '提交预算草案。',
    });
    const acceptedBudget = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: done.revision,
      itemId: 'budget',
      actorAgentId: 'noema',
      status: 'done',
      reason: '核验预算交付。',
    });
    const final = projects.plans.updatePhase({
      projectId: project.id,
      expectedRevision: acceptedBudget.revision,
      phaseId: 'pilot',
      actorAgentId: 'noema',
      status: 'done',
      evidence: '预算已通过核验，试办条件齐备。',
      reason: '验收试办阶段计划成果。',
    });
    assert.deepEqual(final.phaseProgress, {
      done: 2,
      total: 2,
      percentage: 100,
      canceled: 0,
    });
  } finally {
    db.close();
  }
});

test('pre-hierarchy plan rows upgrade into one preserved legacy phase', () => {
  const { db, projects, project, a, plan } = setup();
  try {
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '建立旧版扁平计划。',
      plan,
    });
    db.prepare(
      'UPDATE social_project_plan_revisions SET items_json = ? WHERE project_id = ?',
    ).run(JSON.stringify(plan.items), project.id);
    const upgraded = projects.plans.get(project.id);
    assert.equal(upgraded.phases.length, 1);
    assert.equal(upgraded.phases[0].id, 'legacy-stage');
    assert.equal(upgraded.phases[0].title, plan.stage);
    assert.equal(upgraded.phases[0].workItems[0].ownerAgentId, a);
    assert.equal(upgraded.phases[0].workItems.length, plan.items.length);
    assert.equal(upgraded.phaseProgress.percentage, 0);
  } finally {
    db.close();
  }
});

test('invalid shared plans and unauthorized writes leave the prior revision unchanged', () => {
  const { db, projects, project, a, b, plan } = setup();
  try {
    const replace = (input) =>
      projects.plans.replace({
        projectId: project.id,
        expectedRevision: 0,
        reason: '草拟阶段计划。',
        plan: input,
      });
    const cycle = structuredClone(plan);
    cycle.items[0].dependsOn = ['budget'];
    assert.throws(() => replace(cycle), /循环/u);
    const missing = structuredClone(plan);
    missing.items[1].dependsOn = ['missing'];
    assert.throws(() => replace(missing), /不存在的依赖/u);
    const outsider = structuredClone(plan);
    outsider.items[0].ownerAgentId = 'noema';
    assert.throws(() => replace(outsider), /活跃执行成员/u);
    assert.throws(
      () =>
        projects.plans.replace({
          projectId: project.id,
          expectedRevision: 0,
          actorAgentId: a,
          reason: '越权改范围。',
          plan,
        }),
      /共享范围/u,
    );
    assert.equal(projects.plans.get(project.id).revision, 0);
    replace(plan);
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: 1,
          actorAgentId: b,
          itemId: 'research',
          status: 'in_progress',
          reason: '修改他人工作。',
        }),
      /自己负责/u,
    );
    assert.equal(projects.plans.get(project.id).revision, 1);
    projects.setAwaitingUser(project.id, true);
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: 1,
          actorAgentId: a,
          itemId: 'research',
          status: 'in_progress',
          reason: '等待时继续。',
        }),
      /等待用户反馈/u,
    );
    assert.equal(projects.plans.get(project.id).revision, 1);
  } finally {
    db.close();
  }
});

test('scope cancellation is explicit and traceable, and empty scope has no invented completion', () => {
  const { db, projects, project, plan } = setup();
  try {
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '建立初始范围。',
      plan,
    });
    const canceled = structuredClone(plan);
    canceled.items.forEach((item) => (item.status = 'canceled'));
    const result = projects.plans.replace({
      projectId: project.id,
      expectedRevision: 1,
      reason: '用户决定终止本次调研。',
      plan: canceled,
    });
    assert.deepEqual(result.progress, {
      done: 0,
      total: 0,
      percentage: null,
      submitted: 0,
      canceled: 2,
    });
    assert.equal(
      projects.plans.history(project.id)[0].reason,
      '用户决定终止本次调研。',
    );
    assert.equal(projects.plans.history(project.id).length, 2);
  } finally {
    db.close();
  }
});
