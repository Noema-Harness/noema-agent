import type { WorkRuntime } from './work-runtime.ts';

export const WORK_RUNTIME_KINDS = ['dsh', 'native'];

function assertRuntime(kind: string, runtime: WorkRuntime | undefined) {
  if (!runtime || typeof runtime.startTask !== 'function') {
    throw new Error(`Work runtime "${kind}" must expose startTask.`);
  }
}

export function createWorkRuntimeRegistry({
  dshRuntime = null,
  nativeRuntime = null,
}: {
  dshRuntime?: WorkRuntime | null;
  nativeRuntime?: WorkRuntime | null;
} = {}) {
  const runtimes = new Map<string, WorkRuntime>();
  if (dshRuntime) runtimes.set('dsh', dshRuntime);
  if (nativeRuntime) runtimes.set('native', nativeRuntime);

  return {
    has(kind: string) {
      return runtimes.has(kind);
    },
    get(kind: string) {
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
