import { writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createSocialTestStore } from './social-team.mjs';
import { DiagnosticsEventStore } from '../src/main/storage/diagnostics-event-store.mjs';
import { NoemaProjectExecutor } from '../src/main/execution/noema-project-executor.mjs';
import { SocialWorkService } from '../src/main/execution/social-work-service.mjs';
import { RootStore } from '../src/main/storage/root-store.mjs';

const [, , mode, databasePath, workspacePath, taskId, resultPath] =
  process.argv;
if (!['fail', 'complete'].includes(mode)) {
  throw new TypeError('Unsupported resume child mode.');
}

const db = new Database(databasePath);
new RootStore(db);
const store = createSocialTestStore(db);
const diagnostics = new DiagnosticsEventStore(db);
let requestIdentity = null;
let resumeMessages = null;
const adapter = new NoemaProjectExecutor({
  provider: {
    async *streamChat(input) {
      requestIdentity = {
        usageExecutionId: input.usageExecutionId,
        usageInteractionId: input.usageInteractionId,
        usageTurnId: input.usageTurnId,
      };
      resumeMessages = input.messages;
      if (mode === 'fail') {
        const error = new Error('private transient provider detail');
        error.code = 'provider_unavailable';
        throw error;
      }
      yield '已从已保存的模型边界继续，未重复工具。';
    },
  },
});
const service = new SocialWorkService({
  store,
  adapter,
  secretStore: { isConfigured: () => true },
  getSelectedModel: () => 'test-model',
  chooseWorkspace: async () => workspacePath,
  recordDiagnosticEvent: (event) =>
    diagnostics.record({
      applicationExecutionId: 'multi-reopen-app',
      ...event,
    }),
});

try {
  const started = await service.resumeTask(taskId);
  if (!started.accepted) throw new Error('Resume was not accepted.');
  const task = await service.waitForTask(taskId);
  const result = {
    taskId: task.id,
    status: task.status,
    canResume: task.canResume,
    toolCallCount: task.toolCallCount,
    requestIdentity,
    lastMessageRole: resumeMessages?.at(-1)?.role ?? null,
    lastToolCallId: resumeMessages?.at(-1)?.tool_call_id ?? null,
  };
  writeFileSync(resultPath, JSON.stringify(result), {
    encoding: 'utf8',
    flag: 'wx',
  });
  if (mode === 'fail' && task.status !== 'failed') process.exitCode = 1;
  if (mode === 'complete' && task.status !== 'completed') process.exitCode = 1;
} catch (error) {
  writeFileSync(
    resultPath,
    JSON.stringify({
      errorCode:
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : 'resume_child_failed',
      message: error instanceof Error ? error.message.slice(0, 300) : null,
    }),
    { encoding: 'utf8', flag: 'wx' },
  );
  process.exitCode = 1;
} finally {
  await service.shutdown();
  db.close();
}
