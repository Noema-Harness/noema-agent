/**
 * Transport-neutral chat runtime selection.
 *
 * Noema product logic talks to a chat runtime, not to DSH directly. DSH is the
 * preferred runtime for the main Noema conversation, but it is one entry in the
 * registry rather than a required singleton.
 */

export const CHAT_RUNTIME_KINDS = ['native', 'dsh'];

/**
 * @typedef {{kind:'native'|'dsh',streamChat:(options:object)=>AsyncIterable<string>}} ChatRuntime
 * @typedef {{get:(kind:string)=>ChatRuntime,has:(kind:string)=>boolean,kinds:()=>string[],forMainChat:(input:{agentId:string,roomId:string,preferred?:string})=>ChatRuntime,readonly preferredKind:'native'|'dsh'}} ChatRuntimeRegistry
 */

/**
 * @param {{nativeRuntime: ChatRuntime, dshRuntime?: ChatRuntime | null}} input
 * @returns {ChatRuntimeRegistry}
 */
export function createChatRuntimeRegistry({
  nativeRuntime,
  dshRuntime = null,
}) {
  if (
    !nativeRuntime ||
    nativeRuntime.kind !== 'native' ||
    typeof nativeRuntime.streamChat !== 'function'
  ) {
    throw new TypeError('chat runtime registry requires a native runtime');
  }
  if (
    dshRuntime &&
    (dshRuntime.kind !== 'dsh' || typeof dshRuntime.streamChat !== 'function')
  ) {
    throw new TypeError(
      'chat runtime registry received an invalid dsh runtime',
    );
  }

  const runtimes = new Map([['native', nativeRuntime]]);
  if (dshRuntime) runtimes.set('dsh', dshRuntime);

  return {
    get(kind) {
      const runtime = runtimes.get(kind);
      if (!runtime) throw new Error(`chat runtime "${kind}" is not registered`);
      return runtime;
    },
    has(kind) {
      return runtimes.has(kind);
    },
    kinds() {
      return [...runtimes.keys()];
    },
    forMainChat({ agentId, roomId, preferred = 'dsh' }) {
      if (
        preferred === 'dsh' &&
        runtimes.has('dsh') &&
        agentId === 'noema' &&
        roomId === 'room-noema'
      ) {
        return runtimes.get('dsh');
      }
      return runtimes.get('native');
    },
    get preferredKind() {
      return runtimes.has('dsh') ? 'dsh' : 'native';
    },
  };
}
