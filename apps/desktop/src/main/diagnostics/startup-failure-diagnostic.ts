const STARTUP_ERROR_CODES = new Set([
  'SQLITE_CORRUPT',
  'SQLITE_NOTADB',
  'SQLITE_CANTOPEN',
  'SQLITE_READONLY',
  'EACCES',
  'EPERM',
  'ENOENT',
  'ERR_MODULE_NOT_FOUND',
]);

export function startupFailureDiagnostic(error: unknown) {
  const suppliedCode =
    error && typeof error === 'object' && 'code' in error ? error.code : null;
  const errorCode =
    typeof suppliedCode === 'string' && STARTUP_ERROR_CODES.has(suppliedCode)
      ? suppliedCode
      : 'application_startup_failed';
  return {
    operation: 'application.startup_failed',
    status: 'failed',
    errorCode,
    details: { phase: 'initialization' },
  };
}
