/**
 * The chat loop depends on a small streaming contract, not on the provider
 * implementation. Keeping that seam explicit lets the DSH runtime replace the
 * native OpenAI-compatible loop without changing call sites again.
 *
 * @typedef {object} ChatRuntime
 * @property {'native'|'dsh'} kind
 * @property {(options:object)=>AsyncIterable<string>} streamChat
 */

/**
 * @param {{provider:{streamChat:(options:object)=>AsyncIterable<string>}}} input
 * @returns {ChatRuntime}
 */
export function createNativeChatRuntime({ provider }) {
  if (!provider || typeof provider.streamChat !== 'function') {
    throw new TypeError('Native chat runtime requires a provider stream');
  }
  return {
    kind: 'native',
    streamChat(options) {
      return provider.streamChat(options);
    },
  };
}

/**
 * Resolve the explicit runtime first. The provider fallback keeps existing
 * tests and embedders working while the runtime is migrated incrementally.
 *
 * @param {{runtime?:ChatRuntime|null,provider:{streamChat:(options:object)=>AsyncIterable<string>}}} input
 * @returns {ChatRuntime}
 */
export function resolveChatRuntime({ runtime = null, provider }) {
  if (runtime) {
    if (typeof runtime.streamChat !== 'function') {
      throw new TypeError('Chat runtime must expose streamChat');
    }
    return runtime;
  }
  return createNativeChatRuntime({ provider });
}
