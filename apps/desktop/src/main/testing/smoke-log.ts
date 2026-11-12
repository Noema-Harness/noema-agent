import fs from 'node:fs';

export function writeSmokeLog(
  step: string,
  details: Record<string, unknown> = {},
) {
  const logFile = process.env.NOEMA_SMOKE_LOG_FILE;
  const liveProviderTrace = process.env.NOEMA_E2E_SOCIAL_PROVIDER_LIVE === '1';
  if (
    (process.env.NOEMA_SMOKE_TEST !== '1' && !liveProviderTrace) ||
    !logFile
  ) {
    return;
  }
  fs.writeFileSync(logFile, JSON.stringify({ step, ...details }));
}
