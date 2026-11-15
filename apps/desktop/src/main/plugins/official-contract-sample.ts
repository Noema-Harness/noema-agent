/** Minimal official consumer used by the host acceptance suite, not a product feature. */
export const officialContractSample = Object.freeze({
  manifest: Object.freeze({
    id: 'noema.sample.contract',
    version: '1.0.0',
    hostApiVersion: 1,
    stateVersion: 1,
    capabilities: Object.freeze(['state', 'diagnostics']),
    enabledByDefault: true,
  }),
  migrations: Object.freeze([
    Object.freeze({
      fromVersion: 0,
      toVersion: 1,
      up(state: { set: (key: string, value: unknown) => void }) {
        state.set('sampleReady', true);
      },
    }),
  ]),
  start(context: {
    diagnostics?: {
      record: (event: { operation: string; status: string }) => void;
    };
  }) {
    context.diagnostics?.record({
      operation: 'plugin.runtime',
      status: 'completed',
    });
    return { stop() {} };
  },
});
