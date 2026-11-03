const SAFE_CODE = /^[a-z0-9_-]{1,96}$/u;

/** Build the renderer-safe Windows runner status from main-process evidence. */
/** @param {{platform: string, support: any, backendReadiness?: any, setupReadiness?: any, protocolVersion?: number|null}} options */
export function createWindowsRunnerCapabilityReport({
  platform,
  support,
  backendReadiness = null,
  setupReadiness = null,
  protocolVersion = null,
}) {
  if (platform !== 'win32') {
    return Object.freeze({
      platform: 'not_applicable',
      supported: false,
      backendReady: false,
      status: 'not_applicable',
      reasonCode: null,
      backendId: null,
      backendVersion: null,
      protocolVersion: null,
      setupStatus: 'not_applicable',
    });
  }

  const supported = support?.supported === true;
  const candidateCode = [
    support?.reason,
    backendReadiness?.code,
    setupReadiness?.reason,
  ].find((value) => typeof value === 'string' && SAFE_CODE.test(value));
  const reasonCode = supported
    ? null
    : candidateCode
      ? candidateCode
      : 'runner_unavailable';
  const backend = backendReadiness?.backend;
  return Object.freeze({
    platform: 'win32',
    supported,
    backendReady: backendReadiness?.ready === true,
    status: supported ? 'ready' : 'unavailable',
    reasonCode,
    backendId:
      typeof backend?.id === 'string' && SAFE_CODE.test(backend.id)
        ? backend.id
        : null,
    backendVersion:
      typeof backend?.version === 'string' &&
      /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(backend.version)
        ? backend.version
        : null,
    protocolVersion:
      Number.isSafeInteger(protocolVersion) && protocolVersion > 0
        ? protocolVersion
        : null,
    setupStatus: setupReadiness?.ready === true ? 'ready' : 'unavailable',
  });
}
