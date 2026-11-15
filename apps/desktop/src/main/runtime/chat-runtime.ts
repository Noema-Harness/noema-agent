/**
 * The chat loop depends on a small streaming contract, not on the provider
 * implementation. Keeping that seam explicit lets the DSH runtime replace the
 * native OpenAI-compatible loop without changing call sites again.
 */
export interface ChatRuntime {
  kind: 'native' | 'dsh';
  streamChat: (options: object) => AsyncIterable<string>;
}

export function createNativeChatRuntime({
  provider,
}: {
  provider: { streamChat: (options: object) => AsyncIterable<string> };
}): ChatRuntime {
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
 */
export function resolveChatRuntime({
  runtime = null,
  provider,
}: {
  runtime?: ChatRuntime | null;
  provider: { streamChat: (options: object) => AsyncIterable<string> };
}): ChatRuntime {
  if (runtime) {
    if (typeof runtime.streamChat !== 'function') {
      throw new TypeError('Chat runtime must expose streamChat');
    }
    return runtime;
  }
  return createNativeChatRuntime({ provider });
}
