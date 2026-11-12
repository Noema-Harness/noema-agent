export const WORK_RUNTIME_KINDS = ['dsh', 'native'];

function assertRuntime(kind, runtime) {
  if (!runtime || typeof runtime.startTask !== 'function') {
    throw new Error(`Work runtime "${kind}" must expose startTask.`);
  }
}

/**
 * @param {{
 *   dshRuntime?: {startTask: (input: any) => any}|null,
 *   nativeRuntime?: {startTask: (input: any) => any}|null,
 * }} [options]
 */
export function createWorkRuntimeRegistry({
  dshRuntime = null,
  nativeRuntime = null,
} = {}) {
  const runtimes = new Map();
  if (dshRuntime) runtimes.set('dsh', dshRuntime);
  if (nativeRuntime) runtimes.set('native', nativeRuntime);

  return {
    has(kind) {
      return runtimes.has(kind);
    },
    get(kind) {
      const runtime = runtimes.get(kind);
      if (!runtime) throw new Error(`Unknown work runtime: ${String(kind)}`);
      assertRuntime(kind, runtime);
      return runtime;
    },
    kinds() {
      return [...runtimes.keys()];
    },
    forTicket({ preferred = 'dsh' } = {}) {
      if (runtimes.has(preferred)) return this.get(preferred);
      if (preferred === 'dsh' && runtimes.has('native')) {
        return this.get('native');
      }
      return null;
    },
    preferredKind() {
      if (runtimes.has('dsh')) return 'dsh';
      if (runtimes.has('native')) return 'native';
      return null;
    },
  };
}
