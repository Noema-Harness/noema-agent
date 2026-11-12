export const OFFICIAL_PLUGIN_HOST_API_VERSION = 1 as const;

export type OfficialPluginCapability = 'state' | 'diagnostics';
export type OfficialPluginStatus =
  | 'registered'
  | 'disabled'
  | 'starting'
  | 'active'
  | 'stopping'
  | 'unavailable'
  | 'failed';

export type OfficialPluginReasonCode =
  | 'duplicate_plugin_id'
  | 'invalid_manifest'
  | 'unsupported_host_api'
  | 'unknown_capability'
  | 'missing_dependency'
  | 'dependency_version_mismatch'
  | 'dependency_cycle'
  | 'dependency_unavailable'
  | 'disabled'
  | 'plugin_state_unavailable'
  | 'migration_failed'
  | 'start_failed'
  | 'start_timeout'
  | 'stop_failed'
  | 'stop_timeout';

export type OfficialPluginDependency = {
  id: string;
  minVersion?: string;
};

export type OfficialPluginManifest = {
  id: string;
  version: string;
  hostApiVersion: number;
  stateVersion: number;
  dependencies?: readonly OfficialPluginDependency[];
  capabilities: readonly OfficialPluginCapability[];
  enabledByDefault?: boolean;
};

export type OfficialPluginState = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): boolean;
  entries(): Array<[string, unknown]>;
};

export type OfficialPluginDiagnostic = {
  operation:
    | 'plugin.migrate'
    | 'plugin.start'
    | 'plugin.stop'
    | 'plugin.runtime';
  status: 'started' | 'completed' | 'failed' | 'timeout';
  errorCode?: OfficialPluginReasonCode;
  details?: Record<string, string | number | boolean>;
};

export type OfficialPluginContext = {
  pluginId: string;
  hostApiVersion: typeof OFFICIAL_PLUGIN_HOST_API_VERSION;
  state?: OfficialPluginState;
  diagnostics?: {
    record(event: OfficialPluginDiagnostic): void;
  };
};

export type OfficialPluginDefinition = {
  manifest: OfficialPluginManifest;
  migrations?: readonly {
    fromVersion: number;
    toVersion: number;
    up(state: OfficialPluginState): void;
  }[];
  start(
    context: OfficialPluginContext,
  ):
    | void
    | { stop?: () => void | Promise<void> }
    | Promise<void | { stop?: () => void | Promise<void> }>;
};

export type OfficialPluginStatusRecord = {
  id: string;
  version: string | null;
  status: OfficialPluginStatus;
  reasonCode: OfficialPluginReasonCode | null;
};
