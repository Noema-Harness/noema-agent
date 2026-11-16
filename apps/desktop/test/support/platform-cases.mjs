import process from 'node:process';

/**
 * Options for a `node:test` case whose assertions only hold on Windows.
 *
 * The case still runs on Windows (returned options are empty); elsewhere the
 * runner reports it as skipped with the given reason, so an Ubuntu failure in
 * CI is always a real regression rather than a known platform difference.
 * Keep the reason concrete — the skip line is the only explanation a reviewer
 * sees in the CI log.
 */
export function windowsOnly(reason, platform = process.platform) {
  if (platform === 'win32') return {};
  return { skip: `Windows-only: ${reason}` };
}
