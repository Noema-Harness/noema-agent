import assert from 'node:assert/strict';
import test from 'node:test';
import { startupFailureDiagnostic } from '../../../src/main/diagnostics/startup-failure-diagnostic.mjs';

test('startup failures keep only allowlisted error codes and a finite phase', () => {
  const event = startupFailureDiagnostic({
    code: 'SQLITE_CORRUPT',
    message: 'C:\\PRIVATE_PATH\\database.sqlite has PRIVATE_DATABASE_CONTENT',
    stack: 'PRIVATE_STACK_SENTINEL',
  });
  assert.deepEqual(event, {
    operation: 'application.startup_failed',
    status: 'failed',
    errorCode: 'SQLITE_CORRUPT',
    details: { phase: 'initialization' },
  });
  assert.doesNotMatch(JSON.stringify(event), /PRIVATE_|database\.sqlite/u);
});

test('unknown startup errors use a fixed category rather than raw text', () => {
  const event = startupFailureDiagnostic(
    new Error('arbitrary private failure C:\\Users\\test'),
  );
  assert.equal(event.errorCode, 'application_startup_failed');
  assert.deepEqual(event.details, { phase: 'initialization' });
  assert.doesNotMatch(JSON.stringify(event), /private failure|Users\\test/u);
});
