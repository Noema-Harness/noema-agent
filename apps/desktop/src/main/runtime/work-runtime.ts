/**
 * Execution backend port: what core asks of whatever runs a project ticket.
 *
 * Owns: the contract between `SocialWorkService` (core) and the backends the
 * host wires in — DSH headless (`integrations/dsh-headless-adapter.mjs`) and
 * the native executor (`execution/noema-project-executor.mjs`).
 * Entry: `WorkRuntime.startTask(input)`; backends are registered through
 * `createWorkRuntimeRegistry` in `work-runtime-registry.ts`.
 * Invariant: this module is platform-free — no Electron, no child processes,
 * no `process.platform`. Fields describe what core reads today, nothing more;
 * a backend may send extra fields, core ignores them.
 */
import type { WorkspaceIdentity } from '../platform/workspace-identity.ts';

/** Store hooks a backend calls around each workspace file write. */
export interface WorkFileChangeJournal {
  prepare(input: Record<string, unknown>): unknown;
  complete(input: Record<string, unknown>): unknown;
}

export type WorkRuntimeEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'status'; phase: string }
  | {
      type: 'tool-call';
      stepId?: string;
      externalCallId?: string;
      tool?: string;
      category?: string;
      arguments?: unknown;
      hasSideEffect?: boolean;
      count?: number;
    }
  | {
      type: 'tool-result';
      stepId?: string;
      externalCallId?: string;
      tool?: string;
      status?: string;
      effectStatus?: string;
      reasonCode?: string;
      resultContent?: unknown;
      checkpoint?: unknown;
    }
  | {
      type: 'runtime-checkpoint';
      messages?: unknown;
      round?: number;
      toolCallCount?: number;
      phase?: string;
    };

export interface WorkTaskInput {
  workspacePath: string;
  workspaceIdentity: WorkspaceIdentity;
  task: string;
  model: string;
  executionId: string;
  taskId: string;
  usageInteractionId?: string;
  usageExecutionId?: string;
  usageTurnId?: string | null;
  sessionId?: string | null;
  checkpoint?: unknown;
  fileChangeJournal?: WorkFileChangeJournal;
  onEvent?: (event: WorkRuntimeEvent) => void;
}

export interface WorkTaskOutcome {
  status: string;
  sessionId?: string | null;
  result?: string;
  toolCallCount?: number;
  errorCode?: string;
  retryAfterSeconds?: number;
}

export interface WorkTaskHandle {
  started: Promise<{ sessionId: string | null }>;
  done: Promise<WorkTaskOutcome>;
  stop(): void;
}

export interface WorkRuntime {
  /** `dsh` for DSH headless; absent means the native executor (`noema`). */
  readonly executionEngine?: string;
  startTask(input: WorkTaskInput): Promise<WorkTaskHandle> | WorkTaskHandle;
}
