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
    assert.throws(
      () =>
        update('research', 'submitted', 'noema', {
          evidence: '未经负责人提交。',
        }),
      /不能代替负责人提交/u,
    );
    const submitted = update('research', 'submitted', a, {
      evidence: '调研记录与两份原始来源，价格尚待核实。',
    });
    assert.equal(
      submitted.items.find((item) => item.id === 'research').submittedByAgentId,
      a,
    );
    assert.ok(
      submitted.items.find((item) => item.id === 'research').submittedAt,
    );
    assert.equal(
      submitted.items.find((item) => item.id === 'research').submissionRevision,
      submitted.revision,
    );
    assert.equal(submitted.progress.percentage, 0);
    assert.equal(submitted.progress.submitted, 1);
    assert.throws(
      () => update('research', 'done', a),
      /提交者不能验收自己的成果/u,
    );
    const accepted = update('research', 'done', 'noema');
    assert.equal(
      accepted.items.find((item) => item.id === 'research').submittedByAgentId,
      a,
    );
    assert.equal(
      accepted.items.find((item) => item.id === 'research').acceptanceRecorded,
      true,
    );
    assert.equal(
      accepted.items.find((item) => item.id === 'research').evidenceReview
        .submissionRevision,
      submitted.items.find((item) => item.id === 'research').submissionRevision,
    );
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

test('plan edits cannot skip submission, and legacy done without two-party records is not accepted', () => {
  const { db, projects, project, a, plan } = setup();
  try {
    const directDone = structuredClone(plan);
    directDone.items[0].status = 'done';
    directDone.items[0].evidence = '代码已检查。';
    assert.throws(
      () =>
        projects.plans.replace({
          projectId: project.id,
          expectedRevision: 0,
          reason: '尝试在计划编辑中直接验收。',
          plan: directDone,
        }),
      /不能跳过工作项提交\/验收/u,
    );

    const initial = projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '建立计划。',
      plan,
    });
    const started = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: initial.revision,
      itemId: 'research',
      status: 'in_progress',
      actorAgentId: a,
      reason: '开始取证。',
    });
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: started.revision,
          itemId: 'research',
          status: 'submitted',
          actorAgentId: 'noema',
          evidence: '替负责人提交。',
          reason: '测试不允许代提交。',
        }),
      /Noema 不能代替负责人提交/u,
    );
    const submitted = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: started.revision,
      itemId: 'research',
      status: 'submitted',
      actorAgentId: a,
      evidence: '带依据的交付。',
      reason: '负责人提交。',
    });
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: submitted.revision,
          itemId: 'research',
          status: 'done',
          actorAgentId: a,
          reason: '提交者尝试验收自己。',
        }),
      /提交者不能验收自己的成果/u,
    );

    const saved = db
      .prepare(
        'SELECT items_json FROM social_project_plan_revisions WHERE project_id = ? AND revision = ?',
      )
      .get(project.id, submitted.revision);
    const snapshot = JSON.parse(saved.items_json);
    const item = snapshot.phases[0].workItems.find(
      (entry) => entry.id === 'research',
    );
    item.status = 'done';
    item.submittedByAgentId = null;
    item.submittedAt = null;
    item.submissionRevision = null;
    item.evidenceReview = null;
    db.prepare(
      'UPDATE social_project_plan_revisions SET items_json = ? WHERE project_id = ? AND revision = ?',
    ).run(JSON.stringify(snapshot), project.id, submitted.revision);

    const legacy = projects.plans.get(project.id);
    const unverified = legacy.items.find((entry) => entry.id === 'research');
    assert.equal(unverified.status, 'done');
    assert.equal(unverified.acceptanceRecorded, false);
    assert.equal(legacy.progress.done, 0);
    assert.equal(legacy.progress.percentage, 0);
    assert.equal(legacy.phases[0].state, 'awaiting_review');
    assert.deepEqual(
      legacy.items.find((entry) => entry.id === 'budget').blockedBy,
      ['research'],
    );
    const reopened = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: legacy.revision,
      itemId: 'research',
      status: 'in_progress',
      actorAgentId: 'noema',
      reason: '旧记录缺少独立验收凭据，退回补交。',
    });
    assert.equal(reopened.items[0].status, 'in_progress');
    assert.equal(reopened.items[0].submittedByAgentId, null);
    const resubmitted = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: reopened.revision,
      itemId: 'research',
      status: 'submitted',
      actorAgentId: a,
      evidence: '重新提交的工作成果。',
      reason: '负责人重新提交。',
    });
    const reaccepted = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: resubmitted.revision,
      itemId: 'research',
      status: 'done',
      actorAgentId: 'noema',
      reason: '独立验收重新提交的成果。',
    });
    assert.equal(reaccepted.items[0].acceptanceRecorded, true);
    assert.equal(reaccepted.progress.percentage, 50);
  } finally {
    db.close();
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
    const scopedPhase = projects.plans.forAgent(project.id, a, null, 'pilot');
    assert.equal(scopedPhase.phase.id, 'pilot');
    assert.deepEqual(
      scopedPhase.prerequisitePhases.map((phase) => phase.id),
      ['research'],
    );
    assert.deepEqual(
      scopedPhase.phase.workItems.map((item) => item.id),
      ['budget'],
    );
    assert.throws(
      () => projects.plans.forAgent(project.id, a, 'budget', 'pilot'),
      /只能读取一个具体工作范围/u,
    );
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

test('related work links provide context without blocking readiness', () => {
  const { db, projects, project, plan } = setup();
  try {
    const relatedPlan = structuredClone(plan);
    relatedPlan.items[1].dependsOn = [];
    relatedPlan.items[1].relatedTo = ['research'];
    const result = projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '标记相关但不互相阻塞的工作。',
      plan: relatedPlan,
    });
    const budget = result.items.find((item) => item.id === 'budget');
    assert.equal(budget.ready, true);
    assert.deepEqual(budget.relatedItems, [
      { id: 'research', title: '需求证据', status: 'pending' },
    ]);
    assert.deepEqual(
      result.items.find((item) => item.id === 'research').relatedTo,
      ['budget'],
    );

    const missing = structuredClone(relatedPlan);
    missing.items[1].relatedTo = ['absent'];
    assert.throws(
      () =>
        projects.plans.replace({
          projectId: project.id,
          expectedRevision: 1,
          reason: '检查关系目标存在性。',
          plan: missing,
        }),
      /不存在的相关工作项/u,
    );
  } finally {
    db.close();
  }
});

test('nested groups organize leaf packages without inflating project progress', () => {
  const { db, projects, project, a, b } = setup();
  try {
    const result = projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '按可执行结果拆分近期工作。',
      plan: {
        objective: '交付可核验的试办判断。',
        phases: [
          {
            id: 'research',
            title: '预研究',
            outcome: '形成证据与结论。',
            exitCriteria: '结论可追溯且未知明确。',
            dependsOn: [],
            status: 'pending',
            evidence: '',
            workItems: [
              {
                id: 'research-group',
                kind: 'group',
                parentId: null,
                title: '需求与供给',
                status: 'pending',
              },
              {
                id: 'market-group',
                kind: 'group',
                parentId: 'research-group',
                title: '需求核验',
                status: 'pending',
              },
              {
                id: 'market',
                kind: 'work_package',
                parentId: 'market-group',
                title: '访谈目标用户',
                ownerAgentId: a,
                acceptance: '提交原始记录与来源。',
                dependsOn: [],
                relatedTo: ['supply'],
                status: 'pending',
                evidence: '',
                blocker: '',
              },
              {
                id: 'supply',
                kind: 'work_package',
                parentId: 'research-group',
                title: '核验场地供给',
                ownerAgentId: b,
                acceptance: '提交可联系的来源与价格范围。',
                dependsOn: [],
                relatedTo: [],
                status: 'pending',
                evidence: '',
                blocker: '',
              },
            ],
          },
        ],
      },
    });
    assert.equal(result.progress.total, 2);
    assert.equal(result.phases[0].progress.total, 2);
    assert.equal(
      result.items.find((item) => item.id === 'research-group').ready,
      false,
    );
    assert.deepEqual(
      result.items.find((item) => item.id === 'research-group').childProgress,
      {
        done: 0,
        total: 2,
        percentage: 0,
      },
    );
    assert.equal(result.items.find((item) => item.id === 'market').depth, 2);
    assert.equal(
      projects.plans.forAgent(project.id, a, 'research-group').descendants
        .length,
      3,
    );
    const started = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: result.revision,
      itemId: 'market',
      actorAgentId: a,
      status: 'in_progress',
      reason: '开始访谈。',
    });
    const submitted = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: started.revision,
      itemId: 'market',
      actorAgentId: a,
      status: 'submitted',
      evidence: '访谈记录。',
      reason: '提交访谈记录。',
    });
    const accepted = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: submitted.revision,
      itemId: 'market',
      actorAgentId: 'noema',
      status: 'done',
      reason: '核验访谈交付。',
    });
    assert.deepEqual(
      accepted.items.find((item) => item.id === 'research-group').childProgress,
      { done: 1, total: 2, percentage: 50 },
    );
    const revised = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: accepted.revision,
      itemId: 'market',
      actorAgentId: 'noema',
      patch: {
        title: '访谈用户并提交核验记录',
        parentId: 'research-group',
        relatedTo: [],
      },
      reason: '根据结构评审调整叶工作包名称与归属。',
    });
    assert.equal(
      revised.items.find((item) => item.id === 'market').title,
      '访谈用户并提交核验记录',
    );
    assert.equal(revised.items.find((item) => item.id === 'market').depth, 1);
    assert.deepEqual(
      revised.items.find((item) => item.id === 'supply').relatedTo,
      [],
    );
    assert.equal(revised.progress.total, 2);
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: revised.revision,
          itemId: 'research-group',
          actorAgentId: 'noema',
          status: 'done',
          reason: '分组不应作为执行项。',
        }),
      /结构分组不能推进状态/u,
    );
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: revised.revision,
          itemId: 'supply',
          actorAgentId: b,
          patch: { title: '越权修改' },
          reason: '成员不应重写计划结构。',
        }),
      /只有用户或 Noema/u,
    );
    const cyclic = structuredClone(result);
    cyclic.phases[0].workItems.find(
      (item) => item.id === 'research-group',
    ).parentId = 'market-group';
    assert.throws(
      () =>
        projects.plans.replace({
          projectId: project.id,
          expectedRevision: revised.revision,
          reason: '检查父子循环。',
          plan: cyclic,
        }),
      /父子层级不能形成循环/u,
    );
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

test('independent member updates retain both results and journal the actual read version', () => {
  const { db, projects, project, a, b, plan } = setup();
  try {
    plan.items[1].dependsOn = [];
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '两项可以独立推进。',
      plan,
    });
    projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: 1,
      itemId: 'research',
      actorAgentId: a,
      status: 'in_progress',
      reason: '开始研究。',
    });
    const result = projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: 1,
      itemId: 'budget',
      actorAgentId: b,
      sourceTurnId: null,
      status: 'in_progress',
      reason: '开始独立预算。',
    });
    assert.equal(result.revision, 3);
    assert.deepEqual(
      result.items.map((item) => item.status),
      ['in_progress', 'in_progress'],
    );
    const journal = projects.plans.revisionDetails(project.id, 3);
    assert.equal(journal.baseRevision, 1);
    assert.equal(journal.actorAgentId, b);
    assert.deepEqual(journal.changes, [
      {
        entity: 'item:budget',
        operation: 'updated',
        fields: ['status'],
        values: { status: { before: 'pending', after: 'in_progress' } },
      },
    ]);
    assert.equal(
      'values' in projects.plans.history(project.id)[0].changes[0],
      false,
    );
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: 1,
          itemId: 'budget',
          actorAgentId: b,
          status: 'blocked',
          blocker: '旧结果覆盖。',
          reason: '旧结果。',
        }),
      (error) =>
        error.code === 'PLAN_CONFLICT' &&
        error.conflicts.some(
          (change) =>
            change.entity === 'item:budget' && change.fields.includes('status'),
        ),
    );
    assert.equal(projects.plans.get(project.id).revision, 3);
  } finally {
    db.close();
  }
});

test('changed project scope and change-then-revert are never silently merged', () => {
  const { db, projects, project, a, plan } = setup();
  try {
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '建立范围。',
      plan,
    });
    projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: 1,
      itemId: 'research',
      patch: { title: '修改后的研究' },
      reason: '范围变化。',
    });
    projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: 2,
      itemId: 'research',
      patch: { title: '需求证据' },
      reason: '恢复原题目。',
    });
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: 1,
          itemId: 'research',
          actorAgentId: a,
          status: 'in_progress',
          reason: '基于旧版本执行。',
        }),
      (error) => error.code === 'PLAN_CONFLICT',
    );
    const next = projects.plans.get(project.id);
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 3,
      reason: '修改项目目标。',
      plan: { ...next, objective: '改成验证长期经营。' },
    });
    assert.throws(
      () =>
        projects.plans.updateItem({
          projectId: project.id,
          expectedRevision: 3,
          itemId: 'research',
          actorAgentId: a,
          status: 'in_progress',
          reason: '仍按旧目标执行。',
        }),
      (error) =>
        error.code === 'PLAN_CONFLICT' &&
        error.conflicts.some((change) => change.entity === 'project'),
    );
    assert.equal(projects.plans.get(project.id).revision, 4);
  } finally {
    db.close();
  }
});

test('relation journals include both endpoints and old snapshots remain readable', () => {
  const { db, projects, project, plan } = setup();
  try {
    plan.items[1].dependsOn = [];
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '建立范围。',
      plan,
    });
    const row = db
      .prepare(
        'SELECT items_json FROM social_project_plan_revisions WHERE project_id = ? AND revision = 1',
      )
      .get(project.id);
    const old = JSON.parse(row.items_json);
    delete old.changes;
    delete old.baseRevision;
    db.prepare(
      'UPDATE social_project_plan_revisions SET items_json = ? WHERE project_id = ? AND revision = 1',
    ).run(JSON.stringify(old), project.id);
    projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: 1,
      itemId: 'research',
      patch: { relatedTo: ['budget'] },
      reason: '两项资料互相参考，不形成新的阻塞。',
    });
    const detail = projects.plans.revisionDetails(project.id, 2);
    assert.deepEqual(
      detail.changes.map((change) => change.entity),
      ['item:research', 'item:budget'],
    );
    for (const change of detail.changes)
      assert.deepEqual(change.fields, ['relatedTo']);
    assert.equal(projects.plans.history(project.id)[1].baseRevision, 0);
    assert.throws(
      () => projects.plans.revisionDetails(project.id, 999),
      /不存在/u,
    );
  } finally {
    db.close();
  }
});

test('accepted work cannot replace its evidence without reopening and resubmitting', () => {
  const { db, projects, project, a, b, plan } = setup();
  try {
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '建立有依赖的交付。',
      plan,
    });
    const update = (expectedRevision, itemId, actorAgentId, status, evidence) =>
      projects.plans.updateItem({
        projectId: project.id,
        expectedRevision,
        itemId,
        actorAgentId,
        status,
        evidence,
        reason: '推进实际工作。',
      });
    update(1, 'research', a, 'submitted', '第一份来源。');
    update(2, 'research', 'noema', 'done');
    update(3, 'budget', b, 'in_progress');
    assert.throws(
      () => update(4, 'research', 'noema', 'done', '核查后更正的来源。'),
      /已验收成果的依据不能直接改写/u,
    );
    assert.equal(
      projects.plans
        .get(project.id)
        .items.find((item) => item.id === 'research').evidence,
      '第一份来源。',
    );
  } finally {
    db.close();
  }
});

test('plan summaries mark bounded text and item reads return the complete text', () => {
  const { db, projects, project, a, plan } = setup();
  try {
    const acceptance = '验收条件'.repeat(150);
    const evidence = '成果依据'.repeat(300);
    plan.items[0].acceptance = acceptance;
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '建立长文本交付项。',
      plan,
    });
    projects.plans.updateItem({
      projectId: project.id,
      expectedRevision: 1,
      itemId: 'research',
      actorAgentId: a,
      status: 'submitted',
      evidence,
      reason: '记录一份较长的成果依据。',
    });

    const summary = projects.plans.forAgent(project.id, a);
    const itemSummary = summary.items.find((item) => item.id === 'research');
    assert.equal(itemSummary.acceptance.length, 400);
    assert.equal(itemSummary.acceptanceTruncated, true);
    assert.equal(itemSummary.evidence.length, 500);
    assert.equal(itemSummary.evidenceTruncated, true);
    assert.equal(itemSummary.blockerTruncated, false);

    const detail = projects.plans.forAgent(project.id, a, 'research');
    assert.equal(detail.item.acceptance, acceptance);
    assert.equal(detail.item.evidence, evidence);
  } finally {
    db.close();
  }
});
