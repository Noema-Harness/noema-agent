import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDeliverables,
  normalizeProjectPlan,
} from '../../../src/renderer/projects/project-detail-model.mjs';

test('normalizeProjectPlan keeps an absent plan absent and an empty plan renderable', () => {
  assert.equal(normalizeProjectPlan(null), null);

  const plan = normalizeProjectPlan({ projectId: 'p1' });
  assert.equal(plan.revision, 0);
  assert.deepEqual(plan.phases, []);
  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.phaseProgress, {
    done: 0,
    total: 0,
    percentage: null,
    submitted: 0,
    canceled: 0,
  });
});

test('normalizeProjectPlan fills array and evidence defaults', () => {
  const plan = normalizeProjectPlan({
    projectId: 'p1',
    revision: 3,
    phases: [
      {
        id: 'phase-1',
        title: '收尾',
        workItems: [
          {
            id: 'item-1',
            kind: 'work_package',
            title: '补齐验收记录',
            evidence: '已核对',
            evidenceRefs: [{ source: { kind: 'file', path: 'docs/plan.md' } }],
          },
          { id: 'group-1', kind: 'group', title: '分组' },
        ],
      },
    ],
    items: [{ id: 'item-1', kind: 'work_package', title: '补齐验收记录' }],
  });

  assert.equal(plan.revision, 3);
  const [phase] = plan.phases;
  assert.deepEqual(phase.waitingForPhases, []);
  assert.equal(phase.workItems.length, 2);
  assert.deepEqual(phase.workItems[0].evidenceRefs[0].source, {
    kind: 'file',
    path: 'docs/plan.md',
  });
  assert.deepEqual(phase.workItems[0].reviewerIds, []);
  assert.equal(phase.workItems[1].kind, 'group');
  assert.equal(plan.items[0].evidence, '');
});

test('collectDeliverables gathers growth assets and work-package evidence', () => {
  const project = {
    growthBatch: {
      status: 'completed',
      members: [
        {
          agentName: '林',
          status: 'completed',
          assets: [
            { path: 'notes/plan.md', revision: 2, isDeleted: false },
            {
              path: 'notes/old.md',
              revision: 1,
              isDeleted: true,
              reason: '已合并',
            },
            { path: '', revision: 1 },
          ],
        },
      ],
    },
  };
  const plan = {
    items: [
      {
        id: 'item-1',
        kind: 'work_package',
        title: '补齐验收记录',
        status: 'submitted',
        phaseTitle: '收尾',
        evidence: '已核对计划与交付物。',
        evidenceRefs: [
          { source: { kind: 'file', path: 'docs/plan.md' } },
          { label: '团队评审', source: { kind: 'message', messageId: 'm1' } },
        ],
      },
      {
        id: 'item-empty',
        kind: 'work_package',
        title: '无证据',
        evidence: '   ',
        evidenceRefs: [],
      },
      {
        id: 'group-1',
        kind: 'group',
        title: '分组',
        evidence: '不应计入',
      },
    ],
  };

  const result = collectDeliverables(project, plan);
  assert.equal(result.assets.length, 2);
  assert.deepEqual(result.assets[0], {
    path: 'notes/plan.md',
    revision: 2,
    isDeleted: false,
    reason: '',
    agentName: '林',
    memberStatus: 'completed',
    batchStatus: 'completed',
  });
  assert.equal(result.assets[1].isDeleted, true);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].itemId, 'item-1');
  assert.equal(result.evidence[0].phaseTitle, '收尾');
  assert.deepEqual(
    result.evidence[0].refs.map((ref) => ref.label),
    ['docs/plan.md', '团队评审'],
  );
});

test('collectDeliverables tolerates missing project and plan data', () => {
  assert.deepEqual(collectDeliverables(null, null), {
    assets: [],
    evidence: [],
  });
  assert.deepEqual(collectDeliverables({}, { items: [] }), {
    assets: [],
    evidence: [],
  });
});
