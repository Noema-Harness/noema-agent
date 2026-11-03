export const SOCIAL_WORK_PHASES = Object.freeze([
  'starting',
  'running',
  'model_request',
  'model_response',
  'tool_requested',
  'tool_call',
  'awaiting_authorization',
  'retry_waiting_rate_limit',
  'verifying',
  'completed',
  'failed',
  'interrupted',
  'unknown',
]);

const socialWorkPhaseSet = new Set(SOCIAL_WORK_PHASES);

export function normalizeSocialWorkPhase(value) {
  if (value === 'working') return 'running';
  return socialWorkPhaseSet.has(value) ? value : 'unknown';
}
