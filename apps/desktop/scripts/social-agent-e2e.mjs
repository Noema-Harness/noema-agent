import { createSocialTestStore } from '../test-support/social-team.mjs';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RootStore } from '../src/root-store.mjs';
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

const configuredE2eRoot = process.env.NOEMA_E2E_ROOT_DIR ?? tmpdir();
const liveProviderE2e = process.argv.includes('--live');
const liveModel = 'auto:noema-free';
if (!path.isAbsolute(configuredE2eRoot) || !existsSync(configuredE2eRoot)) {
  throw new Error('The isolated E2E root directory must already exist.');
}
const e2eRoot = path.resolve(configuredE2eRoot);
const e2eDirectory = mkdtempSync(path.join(e2eRoot, 'Noema-social-agents-'));
const databasePath = path.join(e2eDirectory, 'noema.sqlite3');
const dshUserDataPath = path.join(e2eDirectory, 'dsh-home');
const resultPath = path.join(e2eDirectory, 'result.json');
const smokeLogPath = path.join(e2eDirectory, 'smoke-log.json');
const screenshotTag = Date.now();
const desktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-agent-create-desktop-${screenshotTag}.png`,
);
const narrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-agent-create-narrow-${screenshotTag}.png`,
);
const contactDesktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-agent-capability-desktop-${screenshotTag}.png`,
);
const contactNarrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-agent-capability-narrow-${screenshotTag}.png`,
);
const forwardDesktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-cross-room-forward-desktop-${screenshotTag}.png`,
);
const forwardNarrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-cross-room-forward-narrow-${screenshotTag}.png`,
);
const delegationDesktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-specialist-delegation-desktop-${screenshotTag}.png`,
);
const delegationNarrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-specialist-delegation-narrow-${screenshotTag}.png`,
);
const messageSearchScreenshotPath = path.join(
  e2eRoot,
  `Noema-message-search-${screenshotTag}.png`,
);
const historyRecallScreenshotPath = path.join(
  e2eRoot,
  `Noema-history-recall-${screenshotTag}.png`,
);
const continuationDesktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-continuation-desktop-${screenshotTag}.png`,
);
const continuationNarrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-continuation-narrow-${screenshotTag}.png`,
);
const continuationRoomDesktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-continuation-room-desktop-${screenshotTag}.png`,
);
const continuationRoomNarrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-continuation-room-narrow-${screenshotTag}.png`,
);
const interactionDesktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-interaction-adjustment-desktop-${screenshotTag}.png`,
);
const interactionNarrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-interaction-adjustment-narrow-${screenshotTag}.png`,
);
const agentProfileDesktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-agent-profile-desktop-${screenshotTag}.png`,
);
const agentProfileNarrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-agent-profile-narrow-${screenshotTag}.png`,
);
const projectScreenshotPath = path.join(
  e2eRoot,
  `Noema-project-space-${screenshotTag}.png`,
);
mkdirSync(dshUserDataPath, { recursive: true });
const seedDatabase = new Database(databasePath);
const seedRoot = new RootStore(seedDatabase);
if (liveProviderE2e) seedRoot.setSelectedModel(liveModel);
const seedSocial = createSocialTestStore(seedDatabase);
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
seedDatabase.close();

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptDirectory, '..');
const child = spawn(process.execPath, ['scripts/start.mjs'], {
  cwd: appDirectory,
  env: {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
    NOEMA_SMOKE_TEST: '1',
    NOEMA_E2E_DATABASE_PATH: databasePath,
    NOEMA_E2E_DSH_USER_DATA_PATH: dshUserDataPath,
    NOEMA_E2E_SOCIAL_AGENT_WORKFLOW: '1',
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
    NOEMA_SMOKE_SOCIAL_ADJUSTMENT_DESKTOP_PATH:
      interactionDesktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_ADJUSTMENT_NARROW_PATH: interactionNarrowScreenshotPath,
    NOEMA_SMOKE_SOCIAL_AGENT_PROFILE_PATH: agentProfileDesktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_AGENT_PROFILE_NARROW_PATH:
      agentProfileNarrowScreenshotPath,
    NOEMA_SMOKE_SOCIAL_PROJECT_PATH: projectScreenshotPath,
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
const summary = {
  ...result,
  liveProviderE2e,
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
  interactionDesktopScreenshotPath,
  interactionNarrowScreenshotPath,
  agentProfileDesktopScreenshotPath,
  agentProfileNarrowScreenshotPath,
  projectScreenshotPath,
};
console.log(JSON.stringify(summary, null, 2));

if (
  result.outcome !== 'passed' ||
  !result.workflow?.cancelReturnedFocus ||
  !result.workflow?.initialDirectIsEmpty ||
  !result.workflow?.roomDraftIsolation?.partnerStartedEmpty ||
  !result.workflow?.roomDraftIsolation?.noemaDraftRestored ||
  !result.workflow?.roomDraftIsolation?.partnerDraftRestored ||
  !result.workflow?.interactionAdjustments?.created ||
  !result.workflow?.interactionAdjustments?.sourceValidated ||
  !result.workflow?.interactionAdjustments?.usedOnNoemaReply ||
  !result.workflow?.interactionAdjustments?.updated ||
  !result.workflow?.interactionAdjustments?.usedUpdatedBehavior ||
  !result.workflow?.interactionAdjustments?.withdrawn ||
  !result.workflow?.interactionAdjustments?.notUsedAfterWithdrawal ||
  !result.workflow?.projectWorkDefaultedOff ||
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
  result.workflow?.forwarding?.selectedBeforeCancel !== 2 ||
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
  (!liveProviderE2e &&
    (!existsSync(delegationDesktopScreenshotPath) ||
      !existsSync(delegationNarrowScreenshotPath))) ||
  !existsSync(interactionDesktopScreenshotPath) ||
  !existsSync(interactionNarrowScreenshotPath) ||
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
  exit.code !== 0
) {
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  rmSync(e2eDirectory, { recursive: true, force: true });
}
