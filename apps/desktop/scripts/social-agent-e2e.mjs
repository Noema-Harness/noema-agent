// STATUS: RETIRED (2026-11-12). This harness targets the removed social
// navigation/room shell. It is not part of release verification; keep it only
// as a reference for restoring that surface with real tests.
import { developmentRoot } from '../test-support/development-workspace.mjs';
import { createSocialTestStore } from '../test-support/social-team.mjs';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RootStore } from '../src/main/storage/root-store.mjs';
import { DiagnosticsEventStore } from '../src/main/storage/diagnostics-event-store.mjs';
import { SocialProjectStore } from '../src/main/projects/social-project-store.mjs';
import { acceptAllProjectWorkItems } from '../test-support/project-plan-fixtures.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';

configureElectronRuntime();

if (process.platform !== 'win32') {
  throw new Error('Noema social-agent E2E currently requires Windows.');
}
const nodeVersion = /^v(\d+)\.(\d+)\.(\d+)/.exec(process.version);
if (
  !nodeVersion ||
  Number(nodeVersion[1]) !== 24 ||
  Number(nodeVersion[2]) < 21
) {
  throw new Error('Run this check with Node.js 24.21.x.');
}

const configuredE2eRoot = developmentRoot();
const liveProviderE2e = process.argv.includes('--live');
const attachmentsOnly = process.argv.includes('--attachments-only');
const liveModel = 'auto:noema-free';
if (!path.isAbsolute(configuredE2eRoot) || !existsSync(configuredE2eRoot)) {
  throw new Error('The isolated E2E root directory must already exist.');
}
const e2eRoot = path.resolve(configuredE2eRoot);
const runDirectory = mkdtempSync(path.join(e2eRoot, 'Noema-social-agents-'));
// Scenario data and Electron's profile must be siblings: the runtime rejects
// either directory containing the other to protect the user's application data.
const e2eDirectory = path.join(runDirectory, 'scenario');
mkdirSync(e2eDirectory);
const electronUserDataDirectory = mkdtempSync(
  path.join(runDirectory, 'Noema-social-agents-electron-home-'),
);
const databasePath = path.join(e2eDirectory, 'noema.sqlite3');
const dshUserDataPath = path.join(e2eDirectory, 'dsh-home');
const resultPath = path.join(e2eDirectory, 'result.json');
const smokeLogPath = path.join(e2eDirectory, 'smoke-log.json');
const screenshotTag = Date.now();
const desktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-agent-create-desktop-${screenshotTag}.png`,
);
const narrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-agent-create-narrow-${screenshotTag}.png`,
);
const contactDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-agent-capability-desktop-${screenshotTag}.png`,
);
const contactNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-agent-capability-narrow-${screenshotTag}.png`,
);
const forwardDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-cross-room-forward-desktop-${screenshotTag}.png`,
);
const forwardNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-cross-room-forward-narrow-${screenshotTag}.png`,
);
const delegationDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-specialist-delegation-desktop-${screenshotTag}.png`,
);
const delegationNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-specialist-delegation-narrow-${screenshotTag}.png`,
);
const messageSearchScreenshotPath = path.join(
  e2eDirectory,
  `Noema-message-search-${screenshotTag}.png`,
);
const historyRecallScreenshotPath = path.join(
  e2eDirectory,
  `Noema-history-recall-${screenshotTag}.png`,
);
const continuationDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-continuation-desktop-${screenshotTag}.png`,
);
const continuationNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-continuation-narrow-${screenshotTag}.png`,
);
const continuationRoomDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-continuation-room-desktop-${screenshotTag}.png`,
);
const continuationRoomNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-continuation-room-narrow-${screenshotTag}.png`,
);
const agentProfileDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-agent-profile-desktop-${screenshotTag}.png`,
);
const agentProfileNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-agent-profile-narrow-${screenshotTag}.png`,
);
const projectScreenshotPath = path.join(
  e2eDirectory,
  `Noema-project-space-${screenshotTag}.png`,
);
const attachmentDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-text-attachment-desktop-${screenshotTag}.png`,
);
const attachmentNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-text-attachment-narrow-${screenshotTag}.png`,
);
const messageLayoutDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-message-layout-desktop-${screenshotTag}.png`,
);
const messageLayoutNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-message-layout-narrow-${screenshotTag}.png`,
);
const projectResultDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-project-result-desktop-${screenshotTag}.png`,
);
const projectResultNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-project-result-narrow-${screenshotTag}.png`,
);
const socialFailureDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-message-failure-desktop-${screenshotTag}.png`,
);
const socialFailureNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-message-failure-narrow-${screenshotTag}.png`,
);
const socialComposerQueueDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-composer-queue-desktop-${screenshotTag}.png`,
);
const socialComposerQueueNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-composer-queue-narrow-${screenshotTag}.png`,
);
const socialProjectCloseoutDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-project-closeout-desktop-${screenshotTag}.png`,
);
const socialProjectCloseoutNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-project-closeout-narrow-${screenshotTag}.png`,
);
const socialProjectPlanDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-project-plan-desktop-${screenshotTag}.png`,
);
const socialProjectPlanNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-project-plan-narrow-${screenshotTag}.png`,
);
const socialProjectReviewDesktopScreenshotPath = path.join(
  e2eDirectory,
  `Noema-project-review-desktop-${screenshotTag}.png`,
);
const socialProjectReviewNarrowScreenshotPath = path.join(
  e2eDirectory,
  `Noema-project-review-narrow-${screenshotTag}.png`,
);
const diagnosticsWorkbenchScreenshotPath = path.join(
  e2eDirectory,
  `Noema-diagnostics-workbench-${screenshotTag}.png`,
);
mkdirSync(dshUserDataPath, { recursive: true });
const seedDatabase = new Database(databasePath);
const seedRoot = new RootStore(seedDatabase);
const diagnosticsFixtureStore = new DiagnosticsEventStore(seedDatabase);
const diagnosticsFixtureExecutionId = 'e2e-ui-diagnostics-workbench';
const diagnosticsFixtureEvents = [
  { module: 'social', operation: 'ui_fixture_start', status: 'started' },
  { module: 'provider', operation: 'ui_fixture_request', status: 'completed' },
  { module: 'project', operation: 'ui_fixture_check', status: 'failed' },
  { module: 'social', operation: 'ui_fixture_finish', status: 'completed' },
];
diagnosticsFixtureEvents.forEach((event, index) => {
  diagnosticsFixtureStore.record({
    eventId: `e2e-ui-diagnostics-${index + 1}`,
    applicationExecutionId: 'e2e-ui-diagnostics-app',
    executionId: diagnosticsFixtureExecutionId,
    occurredAt: new Date(
      Date.now() - (diagnosticsFixtureEvents.length - index) * 1000,
    ).toISOString(),
    ...event,
  });
});
if (liveProviderE2e) seedRoot.setSelectedModel(liveModel);
const seedSocial = createSocialTestStore(seedDatabase);
const seedProjects = new SocialProjectStore({
  db: seedDatabase,
  socialChatStore: seedSocial,
});
const closeoutFixtureProject = seedProjects.createProject({
  id: 'e2e-ui-project-closeout',
  title: 'UI 项目收尾布局验证',
  brief: '隔离界面夹具：覆盖项目交付完成、成员复盘失败与窄窗重试入口。',
  agentIds: ['noema', 'engineering-partner'],
});
seedProjects.plans.replace({
  projectId: closeoutFixtureProject.id,
  expectedRevision: 0,
  actorAgentId: 'noema',
  reason: '准备有界的项目 UI 状态夹具。',
  plan: {
    stage: '交付',
    objective: '显示项目交付完成后的成员收尾状态。',
    items: [
      {
        id: 'e2e-closeout-delivery',
        title: '保存已核验的交付',
        ownerAgentId: 'engineering-partner',
        acceptance: '阶段出口和交付记录已验证。',
        dependsOn: [],
        status: 'pending',
        evidence: 'fixture evidence',
        blocker: '',
      },
    ],
  },
});
const closeoutPlan = acceptAllProjectWorkItems(
  seedProjects.plans,
  closeoutFixtureProject.id,
);
seedProjects.plans.updatePhase({
  projectId: closeoutFixtureProject.id,
  expectedRevision: closeoutPlan.revision,
  phaseId: 'legacy-stage',
  actorAgentId: 'noema',
  status: 'done',
  evidence: 'fixture evidence',
  reason: '准备项目交付后收尾状态。',
});
const closeoutBatch = seedProjects.createProjectGrowthBatch(
  closeoutFixtureProject.id,
);
const closeoutMember = seedProjects.claimNextProjectGrowthMember(
  closeoutBatch.id,
);
if (!closeoutMember) throw new Error('项目收尾 UI 夹具成员未能启动');
seedProjects.failProjectGrowthMember(closeoutBatch.id, closeoutMember.agentId, {
  status: 'failed',
  code: 'e2e_fixture_member_review_failed',
  message: 'UI 夹具：成员复盘需要重试。',
});
const planFixtureProject = seedProjects.createProject({
  id: 'e2e-ui-project-plan',
  title: 'UI 项目计划全景验证',
  brief: '隔离界面夹具：覆盖多层依赖、大目标、阶段阻塞和窄窗布局。',
  agentIds: ['noema', 'engineering-partner'],
});
const planFixturePhases = [
  { id: 'ui-plan-01', title: '能力基线', dependsOn: [] },
  { id: 'ui-plan-02', title: '交互边界', dependsOn: ['ui-plan-01'] },
  { id: 'ui-plan-03', title: '数据责任', dependsOn: ['ui-plan-01'] },
  {
    id: 'ui-plan-04',
    title: '恢复与冲突',
    dependsOn: ['ui-plan-02', 'ui-plan-03'],
  },
  { id: 'ui-plan-05', title: '协作闭环', dependsOn: ['ui-plan-04'] },
  { id: 'ui-plan-06', title: '扩展接入', dependsOn: ['ui-plan-04'] },
  {
    id: 'ui-plan-07',
    title: '交付审阅',
    dependsOn: ['ui-plan-05', 'ui-plan-06'],
  },
  { id: 'ui-plan-08', title: '发布准备', dependsOn: ['ui-plan-07'] },
].map((phase, index) => ({
  ...phase,
  outcome: `阶段 ${String(index + 1).padStart(2, '0')} 需要留下可复核的交付结果，并明确其与前置阶段、负责人和后续工作之间的关系。该较长说明用于检查阶段摘要在桌面概览中可读，点选后详情仍完整换行显示。`,
  exitCriteria: `阶段 ${String(index + 1).padStart(2, '0')} 的退出条件需要有明确证据、完整复核路径和可恢复状态，不能只依赖任务已运行或界面显示完成。`,
  status: 'pending',
  evidence: '',
  workItems: [
    {
      id: `ui-plan-work-${String(index + 1).padStart(2, '0')}`,
      title:
        index === 0
          ? '解决来源修订冲突并完成基线核验'
          : `完成阶段 ${String(index + 1).padStart(2, '0')} 的可验证工作项`,
      ownerAgentId: 'engineering-partner',
      acceptance: '完成条件、来源和核验结果可在项目详情中检查。',
      dependsOn: [],
      relatedTo: [],
      status: 'pending',
      evidence: '',
      evidenceRefs: [],
      reviewerIds: [],
      blocker:
        index === 0
          ? 'UI 夹具：来源验收依据出现修订冲突，需先审阅最新版本再继续。'
          : '',
    },
  ],
}));
seedProjects.plans.replace({
  projectId: planFixtureProject.id,
  expectedRevision: 0,
  actorAgentId: 'noema',
  reason: '准备多阶段项目计划布局夹具。',
  plan: {
    objective: `完成一套覆盖 agent 执行、项目协作、持久状态、恢复、诊断和扩展边界的可交付系统。该目标刻意超过两行，用于验证计划目标完整呈现，不依赖鼠标悬停才能读取。${'每个阶段都必须说明成果、前置依赖、验收条件、当前进展及失败后的恢复责任。'.repeat(4)}UI-S06-OBJECTIVE-END`,
    phases: planFixturePhases,
  },
});
seedProjects.plans.updateItem({
  projectId: planFixtureProject.id,
  expectedRevision: seedProjects.plans.get(planFixtureProject.id).revision,
  itemId: 'ui-plan-work-01',
  actorAgentId: 'noema',
  status: 'blocked',
  blocker: 'UI 夹具：来源验收依据出现修订冲突，需先审阅最新版本再继续。',
  reason: '按正式工作项状态操作建立阻塞态测试夹具。',
});
const reviewFixtureProject = seedProjects.createProject({
  id: 'e2e-ui-project-review-card',
  title: 'UI 评审反馈卡验证',
  brief: '隔离界面夹具：检查主聊中的明确项目评审反馈入口。',
  agentIds: ['noema', 'engineering-partner'],
});
const reviewRequestTurn = seedSocial.beginTurn({
  roomId: 'room-noema',
  agentId: 'noema',
  text: '请查看 UI 评审反馈卡验证项目。',
  model: 'e2e-review-card-seed',
});
seedSocial.appendAssistantDelta(
  reviewRequestTurn.assistantMessageId,
  '请核对这份隔离交付说明是否完整，再通过下方的评审入口提交明确意见。',
);
seedSocial.completeReply(reviewRequestTurn.assistantMessageId);
seedProjects.requestReview({
  projectId: reviewFixtureProject.id,
  messageId: reviewRequestTurn.assistantMessageId,
  question: '请核对隔离交付说明是否完整，并说明需要补充的内容。',
});
const sourceTurn = seedSocial.beginTurn({
  roomId: 'room-engineering-partner',
  agentId: 'engineering-partner',
  text: '以后关注模型更新时先看 OpenAI 官方发布说明，不要先引用二手整理。',
  model: 'e2e-forward-seed',
});
seedSocial.appendAssistantDelta(
  sourceTurn.assistantMessageId,
  '收到：我会先核对 OpenAI 官方发布说明。',
);
seedSocial.completeReply(sourceTurn.assistantMessageId);
const unrelatedTurn = seedSocial.beginTurn({
  roomId: 'room-engineering-partner',
  agentId: 'engineering-partner',
  text: '另有一条无关私聊标记：紫水晶。',
  model: 'e2e-forward-seed',
});
seedSocial.appendAssistantDelta(
  unrelatedTurn.assistantMessageId,
  '记录了紫水晶。',
);
seedSocial.completeReply(unrelatedTurn.assistantMessageId);
const layoutFixtureText = [
  '## 项目结果排版夹具',
  '',
  '这段文字用于检查项目长结果在桌面与窄窗中的阅读宽度、层级和滚动行为。',
  '',
  '| 字段名称 | 当前值 | 说明 | 状态 | 来源标识 | 核对路径 | 恢复信息 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| project_workspace_identity | `workspace-fixture-2026` | 保持结果卡在窄屏内 | 已记录 | ui-layout-fixture | project/markdown | 无需恢复 |',
  '| long_unbroken_reference_identifier | `NOEMA_UI_LAYOUT_REFERENCE_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ` | 长标识应自然换行 | 待核对 | ui-layout-fixture | social/task/result | 状态来源保留 |',
  '',
  '```text',
  'fixture.output.path = C:\\Noema UI Fixture\\workspace\\reports\\very-long-result-file-name.md',
  'fixture.expected.behavior = horizontal table scroll remains inside this result region',
  '```',
].join('\n');
const layoutSourceTurn = seedSocial.beginTurn({
  roomId: 'room-engineering-collaboration',
  agentId: 'engineering-partner',
  text: 'UI_LAYOUT_FIXTURE：检查引用、转发与执行结果布局。',
  model: 'e2e-layout-fixture',
  replyTo: {
    id: 'ui-layout-reply-source',
    roomId: 'room-engineering-collaboration',
    role: 'assistant',
    sender: '工程搭档',
    createdAt: new Date().toISOString(),
    content: `LONG_REPLY_REFERENCE_${'无空格长引用标识'.repeat(24)}`,
  },
  forwardedSources: [
    {
      id: 'ui-layout-forward-source',
      roomId: 'room-engineering-partner',
      roomTitle: `工程协作来源标题_${'超长项目名称'.repeat(8)}`,
      role: 'assistant',
      sender: `工程搭档_${'非常长的成员名称'.repeat(4)}`,
      createdAt: new Date().toISOString(),
      content: `LONG_FORWARD_REFERENCE_${'窄屏换行检查'.repeat(28)}`,
    },
  ],
});
seedSocial.appendAssistantDelta(
  layoutSourceTurn.assistantMessageId,
  layoutFixtureText,
);
seedSocial.completeReply(layoutSourceTurn.assistantMessageId);
const layoutFailureTurn = seedSocial.beginTurn({
  roomId: 'room-engineering-collaboration',
  agentId: 'engineering-partner',
  text: 'UI_LAYOUT_FIXTURE：失败状态与重试按钮。',
  model: 'e2e-layout-fixture',
});
seedSocial.failReply(
  layoutFailureTurn.assistantMessageId,
  'provider_unavailable',
  `UI_LAYOUT_FIXTURE：模型连接中断，消息已保留，可以重试。${'诊断补充信息 '.repeat(12)}`,
);
const layoutWorkspacePath = path.join(e2eDirectory, 'ui-layout-workspace');
mkdirSync(layoutWorkspacePath, { recursive: true });
const layoutTaskId = `ui-layout-task-${screenshotTag}`;
seedSocial.createSocialWorkTask({
  id: layoutTaskId,
  roomId: 'room-engineering-collaboration',
  agentId: 'engineering-partner',
  workspacePath: layoutWorkspacePath,
  workspaceKey: `ui-layout-workspace-${screenshotTag}`,
  taskPrompt: 'UI_LAYOUT_FIXTURE：桌面与窄窗长 Markdown 结果排版。',
  sourceMessageId: layoutSourceTurn.userMessageId,
  model: 'e2e-layout-fixture',
});
seedSocial.finishSocialWorkTask(layoutTaskId, {
  status: 'completed',
  resultText: layoutFixtureText,
  verificationStatus: 'not_planned',
});
const interactionSource = seedSocial.beginTurn({
  roomId: 'room-noema',
  agentId: 'noema',
  text: '分享不愉快经历时，请先问我最在意的部分。',
  model: 'e2e-forward-seed',
});
seedSocial.appendAssistantDelta(
  interactionSource.assistantMessageId,
  '我会先听你说，再决定是否需要一起分析。',
);
seedSocial.completeReply(interactionSource.assistantMessageId);
const memorySource = seedSocial.beginTurn({
  roomId: 'room-noema',
  agentId: 'noema',
  text: '请记住这个 E2E 来源标记：晨雾松果。',
  model: 'e2e-memory-seed',
});
seedSocial.appendAssistantDelta(
  memorySource.assistantMessageId,
  '我会按你的要求保存这条来源。',
);
seedSocial.completeReply(memorySource.assistantMessageId);
seedSocial.personalMemories.add({
  content: 'E2E memory source: original value.',
  sourceRoomId: 'room-noema',
  sourceMessageId: memorySource.userMessageId,
});
seedSocial.personalMemories.add({
  content: 'E2E memory source: navigation item.',
  sourceRoomId: 'room-noema',
  sourceMessageId: memorySource.userMessageId,
});
seedSocial.userFollowups.add({
  title: 'E2E follow-up original title.',
  body: 'E2E follow-up original body.',
  dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  sourceRoomId: 'room-noema',
  sourceMessageId: memorySource.userMessageId,
});
const deletedSourceFollowup = seedSocial.userFollowups.add({
  title: 'E2E follow-up deleted source',
  body: 'E2E follow-up with an unavailable source message.',
  dueAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  sourceRoomId: 'room-noema',
  sourceMessageId: memorySource.userMessageId,
});
const retryFollowup = seedSocial.userFollowups.add({
  title: 'E2E follow-up retry state',
  body: 'E2E follow-up whose previous notification attempt failed.',
  dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
});
const overdueFollowup = seedSocial.userFollowups.add({
  title: 'E2E follow-up overdue state',
  body: 'E2E overdue reminder retained while notifications are paused.',
  dueAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
});
seedDatabase
  .prepare(
    'UPDATE social_user_followups SET source_message_id = NULL WHERE id = ?',
  )
  .run(deletedSourceFollowup.id);
seedDatabase
  .prepare('UPDATE social_user_followups SET last_error = ? WHERE id = ?')
  .run('E2E notification failure.', retryFollowup.id);
seedDatabase
  .prepare('UPDATE social_user_followups SET due_at = ? WHERE id = ?')
  .run(new Date(Date.now() - 60_000).toISOString(), overdueFollowup.id);
seedDatabase
  .prepare(
    "UPDATE app_settings SET value = 'false' WHERE key = 'user_followups_enabled'",
  )
  .run();
seedDatabase.exec(`
  CREATE TRIGGER reject_personal_memory_e2e_failure
  BEFORE INSERT ON social_user_memories
  WHEN NEW.content = 'E2E memory failure trigger'
  BEGIN
    SELECT RAISE(ABORT, 'personal_memory_e2e_store_failure');
  END;
  CREATE TRIGGER reject_user_followup_e2e_failure
  BEFORE INSERT ON social_user_followups
  WHEN NEW.title = 'E2E follow-up failure trigger'
  BEGIN
    SELECT RAISE(ABORT, 'user_followup_e2e_store_failure');
  END;
`);
seedDatabase.close();

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const retainedUiReviewDirectory = path.join(
  repositoryRoot,
  '.work',
  'ux-redesign',
  `message-layout-review-${screenshotTag}`,
);
const child = spawn(process.execPath, ['scripts/start.mjs'], {
  cwd: appDirectory,
  env: {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
    NOEMA_SMOKE_TEST: '1',
    NOEMA_SMOKE_USER_DATA_DIR: electronUserDataDirectory,
    NOEMA_E2E_DATABASE_PATH: databasePath,
    NOEMA_E2E_DSH_USER_DATA_PATH: dshUserDataPath,
    NOEMA_E2E_SOCIAL_AGENT_WORKFLOW: '1',
    NOEMA_E2E_PERSONAL_MEMORY_LIFECYCLE:
      !attachmentsOnly && !liveProviderE2e ? '1' : '0',
    NOEMA_E2E_USER_FOLLOWUP_LIFECYCLE:
      !attachmentsOnly && !liveProviderE2e ? '1' : '0',
    NOEMA_E2E_SOCIAL_ATTACHMENTS_ONLY: attachmentsOnly ? '1' : '0',
    NOEMA_E2E_SOCIAL_AGENT_LIVE: liveProviderE2e ? '1' : '0',
    NOEMA_E2E_SOCIAL_AGENT_LIVE_MODEL: liveProviderE2e ? liveModel : '',
    NOEMA_SMOKE_REFRESH_MODELS: liveProviderE2e ? '1' : '0',
    NOEMA_E2E_SOCIAL_AGENT_RESULT_PATH: resultPath,
    NOEMA_SMOKE_LOG_FILE: smokeLogPath,
    NOEMA_SMOKE_SOCIAL_AGENT_CREATE_PATH: desktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_AGENT_CREATE_NARROW_PATH: narrowScreenshotPath,
    NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_PATH: contactDesktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_NARROW_PATH: contactNarrowScreenshotPath,
    NOEMA_SMOKE_SOCIAL_FORWARD_DESKTOP_PATH: forwardDesktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_FORWARD_NARROW_PATH: forwardNarrowScreenshotPath,
    NOEMA_SMOKE_SOCIAL_DELEGATION_DESKTOP_PATH: delegationDesktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_DELEGATION_NARROW_PATH: delegationNarrowScreenshotPath,
    NOEMA_SMOKE_SOCIAL_SEARCH_PATH: messageSearchScreenshotPath,
    NOEMA_SMOKE_SOCIAL_HISTORY_RECALL_PATH: historyRecallScreenshotPath,
    NOEMA_SMOKE_SOCIAL_CONTINUATION_DESKTOP_PATH:
      continuationDesktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_CONTINUATION_NARROW_PATH:
      continuationNarrowScreenshotPath,
    NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_DESKTOP_PATH:
      continuationRoomDesktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_NARROW_PATH:
      continuationRoomNarrowScreenshotPath,
    NOEMA_SMOKE_SOCIAL_AGENT_PROFILE_PATH: agentProfileDesktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_AGENT_PROFILE_NARROW_PATH:
      agentProfileNarrowScreenshotPath,
    NOEMA_SMOKE_SOCIAL_PROJECT_PATH: projectScreenshotPath,
    NOEMA_SMOKE_SOCIAL_ATTACHMENTS_DESKTOP_PATH:
      attachmentDesktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_ATTACHMENTS_NARROW_PATH: attachmentNarrowScreenshotPath,
    ...(attachmentsOnly
      ? {}
      : {
          NOEMA_SMOKE_DIAGNOSTICS_REVIEW_PATH:
            diagnosticsWorkbenchScreenshotPath,
          NOEMA_SMOKE_SOCIAL_MESSAGE_LAYOUT_DESKTOP_PATH:
            messageLayoutDesktopScreenshotPath,
          NOEMA_SMOKE_SOCIAL_MESSAGE_LAYOUT_NARROW_PATH:
            messageLayoutNarrowScreenshotPath,
          NOEMA_SMOKE_SOCIAL_PROJECT_RESULT_DESKTOP_PATH:
            projectResultDesktopScreenshotPath,
          NOEMA_SMOKE_SOCIAL_PROJECT_RESULT_NARROW_PATH:
            projectResultNarrowScreenshotPath,
          NOEMA_SMOKE_SOCIAL_FAILURE_DESKTOP_PATH:
            socialFailureDesktopScreenshotPath,
          NOEMA_SMOKE_SOCIAL_FAILURE_NARROW_PATH:
            socialFailureNarrowScreenshotPath,
          NOEMA_SMOKE_SOCIAL_COMPOSER_QUEUE_DESKTOP_PATH:
            socialComposerQueueDesktopScreenshotPath,
          NOEMA_SMOKE_SOCIAL_COMPOSER_QUEUE_NARROW_PATH:
            socialComposerQueueNarrowScreenshotPath,
          NOEMA_SMOKE_SOCIAL_PROJECT_CLOSEOUT_DESKTOP_PATH:
            socialProjectCloseoutDesktopScreenshotPath,
          NOEMA_SMOKE_SOCIAL_PROJECT_CLOSEOUT_NARROW_PATH:
            socialProjectCloseoutNarrowScreenshotPath,
          NOEMA_SMOKE_SOCIAL_PROJECT_PLAN_DESKTOP_PATH:
            socialProjectPlanDesktopScreenshotPath,
          NOEMA_SMOKE_SOCIAL_PROJECT_PLAN_NARROW_PATH:
            socialProjectPlanNarrowScreenshotPath,
          NOEMA_SMOKE_SOCIAL_PROJECT_REVIEW_DESKTOP_PATH:
            socialProjectReviewDesktopScreenshotPath,
          NOEMA_SMOKE_SOCIAL_PROJECT_REVIEW_NARROW_PATH:
            socialProjectReviewNarrowScreenshotPath,
        }),
  },
  stdio: 'inherit',
  windowsHide: true,
});

const timeout = setTimeout(() => {
  if (child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
}, 90_000);
const exit = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
clearTimeout(timeout);

if (!existsSync(resultPath)) {
  const smokeLog = existsSync(smokeLogPath)
    ? readFileSync(smokeLogPath, 'utf8')
    : '(no smoke log)';
  throw new Error(
    `No social-agent E2E result was written in ${e2eDirectory}. ${smokeLog}`,
  );
}
const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const retainedUiReviewScreenshots = {};
if (!attachmentsOnly && exit.code === 0 && result.outcome === 'passed') {
  const screenshotPairs = [
    ['messageLayoutDesktop', messageLayoutDesktopScreenshotPath],
    ['messageLayoutNarrow', messageLayoutNarrowScreenshotPath],
    ['projectResultDesktop', projectResultDesktopScreenshotPath],
    ['projectResultNarrow', projectResultNarrowScreenshotPath],
    ['failureDesktop', socialFailureDesktopScreenshotPath],
    ['failureNarrow', socialFailureNarrowScreenshotPath],
    ['composerQueueDesktop', socialComposerQueueDesktopScreenshotPath],
    ['composerQueueNarrow', socialComposerQueueNarrowScreenshotPath],
    ['projectCloseoutDesktop', socialProjectCloseoutDesktopScreenshotPath],
    ['projectCloseoutNarrow', socialProjectCloseoutNarrowScreenshotPath],
    ['projectPlanDesktop', socialProjectPlanDesktopScreenshotPath],
    ['projectPlanNarrow', socialProjectPlanNarrowScreenshotPath],
    ['projectReviewDesktop', socialProjectReviewDesktopScreenshotPath],
    ['projectReviewNarrow', socialProjectReviewNarrowScreenshotPath],
  ];
  if (screenshotPairs.every(([, source]) => existsSync(source))) {
    mkdirSync(retainedUiReviewDirectory, { recursive: true });
    for (const [name, source] of screenshotPairs) {
      const destination = path.join(retainedUiReviewDirectory, `${name}.png`);
      copyFileSync(source, destination);
      retainedUiReviewScreenshots[name] = destination;
    }
  }
}
const summary = {
  ...result,
  liveProviderE2e,
  attachmentsOnly,
  childExitCode: exit.code,
  childSignal: exit.signal,
  scratchDirectory: e2eDirectory,
  desktopScreenshotPath,
  narrowScreenshotPath,
  contactDesktopScreenshotPath,
  contactNarrowScreenshotPath,
  forwardDesktopScreenshotPath,
  forwardNarrowScreenshotPath,
  delegationDesktopScreenshotPath,
  delegationNarrowScreenshotPath,
  messageSearchScreenshotPath,
  historyRecallScreenshotPath,
  continuationDesktopScreenshotPath,
  continuationNarrowScreenshotPath,
  continuationRoomDesktopScreenshotPath,
  continuationRoomNarrowScreenshotPath,
  agentProfileDesktopScreenshotPath,
  agentProfileNarrowScreenshotPath,
  projectScreenshotPath,
  attachmentDesktopScreenshotPath,
  attachmentNarrowScreenshotPath,
  messageLayoutDesktopScreenshotPath,
  messageLayoutNarrowScreenshotPath,
  projectResultDesktopScreenshotPath,
  projectResultNarrowScreenshotPath,
  socialFailureDesktopScreenshotPath,
  socialFailureNarrowScreenshotPath,
  socialComposerQueueDesktopScreenshotPath,
  socialComposerQueueNarrowScreenshotPath,
  socialProjectCloseoutDesktopScreenshotPath,
  socialProjectCloseoutNarrowScreenshotPath,
  socialProjectPlanDesktopScreenshotPath,
  socialProjectPlanNarrowScreenshotPath,
  socialProjectReviewDesktopScreenshotPath,
  socialProjectReviewNarrowScreenshotPath,
  retainedUiReviewDirectory:
    Object.keys(retainedUiReviewScreenshots).length > 0
      ? retainedUiReviewDirectory
      : null,
  retainedUiReviewScreenshots,
};
console.log(JSON.stringify(summary, null, 2));

if (attachmentsOnly) {
  if (
    result.outcome !== 'passed' ||
    !result.workflow?.textAttachments?.draftPreservedAfterRemoval ||
    !result.workflow?.textAttachments?.messagePersisted ||
    !result.workflow?.textAttachments?.modelReceivedAttachment ||
    !result.workflow?.textAttachments?.singleModelRequest ||
    !result.workflow?.textAttachments?.attachmentDraftCleared ||
    result.workflow?.textAttachments?.desktop?.width < 700 ||
    result.workflow?.textAttachments?.narrow?.width > 700 ||
    !result.workflow?.textAttachments?.narrow?.documentNoOverflow ||
    !existsSync(attachmentDesktopScreenshotPath) ||
    !existsSync(attachmentNarrowScreenshotPath) ||
    exit.code !== 0
  ) {
    process.exitCode = 1;
  }
} else if (
  result.outcome !== 'passed' ||
  !result.workflow?.cancelReturnedFocus ||
  !result.workflow?.initialDirectIsEmpty ||
  !result.workflow?.roomDraftIsolation?.partnerStartedEmpty ||
  !result.workflow?.roomDraftIsolation?.noemaDraftRestored ||
  !result.workflow?.roomDraftIsolation?.partnerDraftRestored ||
  !result.workflow?.projectWorkDefaultedOn ||
  !result.workflow?.capabilityWasExplicitlyGranted ||
  !result.workflow?.projectWorkOptInAndReversible ||
  result.workflow?.compactRoomLayout?.width > 700 ||
  !result.workflow?.compactRoomLayout?.actionsVisible ||
  !result.workflow?.compactRoomLayout?.headerNoOverflow ||
  !result.workflow?.archived ||
  !result.workflow?.archivedInviteExcluded ||
  !result.workflow?.restored ||
  !result.workflow?.sameIdentityJoined ||
  !result.workflow?.groupDidNotImportDm ||
  !result.workflow?.forwarding?.bundlePersisted ||
  result.workflow?.forwarding?.selectedBeforeCancel !== 1 ||
  !result.workflow?.forwarding?.forwardCardVisible ||
  !result.workflow?.forwarding?.modelInputVerified ||
  !result.workflow?.forwarding?.forwardingDidNotTriggerResponse ||
  (!liveProviderE2e &&
    !result.workflow?.forwarding?.followUpTriggeredOneResponse) ||
  (liveProviderE2e &&
    !result.workflow?.forwarding?.liveProviderReplyComplete) ||
  !result.workflow?.forwarding?.cancelHadNoSend ||
  (!liveProviderE2e && !result.workflow?.specialistDelegation?.passed) ||
  (!liveProviderE2e &&
    (!result.workflow?.historySearch?.earlierResultReached ||
      !result.workflow?.historySearch?.crossRoomResultReached ||
      !result.workflow?.historySearch?.searchClearedAfterOpen ||
      !existsSync(messageSearchScreenshotPath) ||
      !result.workflow?.historySearch?.recall?.sourceVisible ||
      !result.workflow?.historySearch?.recall?.sourceJumped ||
      result.workflow?.historySearch?.recall?.modelCalls !== 1 ||
      !existsSync(historyRecallScreenshotPath))) ||
  (!liveProviderE2e &&
    !result.workflow?.forwarding?.currentRoomReplyAttached) ||
  result.workflow?.forwarding?.narrow?.width > 700 ||
  !result.workflow?.forwarding?.narrow?.documentNoOverflow ||
  !result.workflow?.forwarding?.narrow?.dialogNoOverflow ||
  (liveProviderE2e && !result.workflow?.forwarding?.liveProviderUsed) ||
  !existsSync(forwardDesktopScreenshotPath) ||
  !existsSync(forwardNarrowScreenshotPath) ||
  !existsSync(messageLayoutDesktopScreenshotPath) ||
  !existsSync(messageLayoutNarrowScreenshotPath) ||
  !existsSync(projectResultDesktopScreenshotPath) ||
  !existsSync(projectResultNarrowScreenshotPath) ||
  !existsSync(socialFailureDesktopScreenshotPath) ||
  !existsSync(socialFailureNarrowScreenshotPath) ||
  !existsSync(socialComposerQueueDesktopScreenshotPath) ||
  !existsSync(socialComposerQueueNarrowScreenshotPath) ||
  !existsSync(socialProjectCloseoutDesktopScreenshotPath) ||
  !existsSync(socialProjectCloseoutNarrowScreenshotPath) ||
  !existsSync(socialProjectPlanDesktopScreenshotPath) ||
  !existsSync(socialProjectPlanNarrowScreenshotPath) ||
  !result.workflow?.projectPlanReview?.desktop?.objectiveComplete ||
  !result.workflow?.projectPlanReview?.desktop?.flowScrollable ||
  !result.workflow?.projectPlanReview?.narrow?.objectiveComplete ||
  !result.workflow?.projectPlanReview?.narrow?.flowStacked ||
  !result.workflow?.projectPlanReview?.conflict?.conflictVisible ||
  !result.workflow?.projectPlanReview?.conflict?.reloadLatestVisible ||
  !existsSync(socialProjectReviewDesktopScreenshotPath) ||
  !existsSync(socialProjectReviewNarrowScreenshotPath) ||
  !result.workflow?.projectReviewCard?.desktop?.pendingContext ||
  !result.workflow?.projectReviewCard?.narrow?.explicitFeedbackBoundary ||
  !result.workflow?.projectCloseoutReview?.desktop?.retryVisible ||
  !result.workflow?.projectCloseoutReview?.desktop?.stepsHorizontal ||
  !result.workflow?.projectCloseoutReview?.narrow?.retryVisible ||
  !result.workflow?.projectCloseoutReview?.narrow?.stepsStacked ||
  !result.workflow?.projectCloseoutReview?.narrow?.trackNoOverflow ||
  (!liveProviderE2e &&
    (!existsSync(delegationDesktopScreenshotPath) ||
      !existsSync(delegationNarrowScreenshotPath))) ||
  !existsSync(agentProfileDesktopScreenshotPath) ||
  !existsSync(agentProfileNarrowScreenshotPath) ||
  !result.workflow?.agentProfileEdit?.identityPreserved ||
  !result.workflow?.agentProfileEdit?.updatedForFutureReplies ||
  !result.workflow?.agentProfileEdit?.capabilityPreserved ||
  !result.workflow?.agentProfileEdit?.historyPreserved ||
  !existsSync(desktopScreenshotPath) ||
  !existsSync(narrowScreenshotPath) ||
  !existsSync(contactDesktopScreenshotPath) ||
  !existsSync(contactNarrowScreenshotPath) ||
  !existsSync(projectScreenshotPath) ||
  !result.workflow?.contactDesktop?.actionsVisible ||
  !result.workflow?.contactNarrow?.actionsVisible ||
  !result.workflow?.messageLayoutReview?.messageNarrow?.quoteVisible ||
  !result.workflow?.messageLayoutReview?.messageNarrow?.forwardedVisible ||
  !result.workflow?.messageLayoutReview?.resultNarrow
    ?.tableKeyboardScrollable ||
  !result.workflow?.messageLayoutReview?.resultNarrow
    ?.tableHasHorizontalOverflow ||
  !result.workflow?.messageLayoutReview?.failureNarrow?.failureControlFits ||
  !result.workflow?.composerQueueReview?.desktop?.stopVisible ||
  !result.workflow?.composerQueueReview?.desktop?.queueVisible ||
  !result.workflow?.composerQueueReview?.narrow?.stopVisible ||
  !result.workflow?.composerQueueReview?.narrow?.queueActionsBelowText ||
  !result.workflow?.composerQueueReview?.narrow?.queueActionsDoNotOverlapText ||
  !result.workflow?.composerQueueReview?.completed ||
  !result.workflow?.textAttachments?.messagePersisted ||
  !result.workflow?.textAttachments?.modelReceivedAttachment ||
  !result.workflow?.textAttachments?.singleModelRequest ||
  !result.workflow?.textAttachments?.attachmentDraftCleared ||
  result.workflow?.textAttachments?.desktop?.width < 700 ||
  result.workflow?.textAttachments?.narrow?.width > 700 ||
  !result.workflow?.textAttachments?.narrow?.documentNoOverflow ||
  (!liveProviderE2e && !result.workflow?.personalMemoryLifecycle?.passed) ||
  (!liveProviderE2e && !result.workflow?.userFollowupLifecycle?.passed) ||
  !existsSync(attachmentDesktopScreenshotPath) ||
  !existsSync(attachmentNarrowScreenshotPath) ||
  exit.code !== 0
) {
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  rmSync(e2eDirectory, { recursive: true, force: true });
  rmSync(electronUserDataDirectory, { recursive: true, force: true });
}
