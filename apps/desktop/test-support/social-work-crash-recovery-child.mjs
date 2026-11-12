import { writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { SocialChatStore } from '../src/main/chat/social-chat-store.mjs';
import { DiagnosticsEventStore } from '../src/main/storage/diagnostics-event-store.mjs';
import { RootStore } from '../src/main/storage/root-store.mjs';

const [, , databasePath, resultPath] = process.argv;
const db = new Database(databasePath);
new RootStore(db);
const socialStore = new SocialChatStore(db);
const eventStore = new DiagnosticsEventStore(db);
const recoveryReason =
  socialStore.recoveredSocialWorkTaskErrorCode ?? 'app_restarted';
for (const taskId of socialStore.recoveredSocialWorkTaskIds) {
  eventStore.record({
    applicationExecutionId: 'process-after-crash',
    executionId: taskId,
    taskId,
    module: 'social.store',
    operation: 'task.recovered',
    status: 'interrupted',
    errorCode: recoveryReason,
    details: { recoveryReason },
  });
}
const task = socialStore.getSocialWorkTask('task-process-crash');
writeFileSync(
  resultPath,
  JSON.stringify({
    recoveredTaskIds: socialStore.recoveredSocialWorkTaskIds,
    taskId: task.id,
    status: task.status,
    errorCode: task.errorCode,
    canResume: task.canResume,
    executionSteps: task.executionSteps.map(({ status, effectStatus }) => ({
      status,
      effectStatus,
    })),
  }),
  { encoding: 'utf8', flag: 'wx' },
);
db.close();
