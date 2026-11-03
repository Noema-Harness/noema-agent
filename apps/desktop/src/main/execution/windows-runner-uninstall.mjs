const SAFE_REASON = /^[a-z0-9_]{1,96}$/u;

/**
 * Remove Noema-owned machine WFP state before Squirrel removes the app.
 * A declined or failed UAC cleanup is surfaced without blocking uninstall.
 */
export async function removeWindowsRunnerStateOnUninstall({
  platform,
  isPackaged,
  isUninstallEvent,
  createHelper,
  operationId,
  onFailure,
}) {
  if (
    platform !== 'win32' ||
    isPackaged !== true ||
    isUninstallEvent !== true
  ) {
    return { status: 'skipped' };
  }
  if (
    typeof createHelper !== 'function' ||
    typeof operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(operationId) ||
    typeof onFailure !== 'function'
  ) {
    throw cleanupError('runner_uninstall_cleanup_configuration_invalid');
  }

  try {
    await createHelper().removeSandboxSetup({ operationId });
    return { status: 'removed' };
  } catch (error) {
    const code =
      typeof error?.code === 'string' && SAFE_REASON.test(error.code)
        ? error.code
        : 'runner_uninstall_cleanup_failed';
    try {
      await onFailure(code);
    } catch {}
    return { status: 'warning', code };
  }
}

function cleanupError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
