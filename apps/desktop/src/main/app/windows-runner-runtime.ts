import type { App, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { WindowsRunnerAclJournalStore } from '../execution/windows-runner-acl-journal.mjs';
import { WindowsRunnerAclTransactionService } from '../execution/windows-runner-acl-transaction.ts';
import { WindowsRunnerCapabilityNameStore } from '../execution/windows-runner-capability-name-store.ts';
import { WindowsRunnerExecutionService } from '../execution/windows-runner-execution-service.mjs';
import { WindowsRunnerNativeHelper } from '../execution/windows-runner-native-helper.mjs';
import { resolveWindowsRunnerNativeHelper } from '../execution/windows-runner-resource.ts';
import { resolveWindowsRunnerCommandSupport } from '../execution/windows-runner-command-support.ts';
import { createWindowsRunnerCapabilityReport } from '../execution/windows-runner-capability.ts';
import { WINDOWS_RUNNER_PROTOCOL_VERSION } from '../execution/windows-runner-native-helper.mjs';
import { WindowsRunnerSetupService } from '../execution/windows-runner-setup-service.ts';
import { WindowsRunnerSetupStateStore } from '../execution/windows-runner-setup-state.mjs';

type WindowsRunnerCapability = ReturnType<
  typeof createWindowsRunnerCapabilityReport
>;
type WindowsRunnerSupport = ReturnType<
  typeof resolveWindowsRunnerCommandSupport
>;

export interface WindowsRunnerSetupResult {
  supported: boolean;
  canceled: boolean;
  reasonCode: string | null;
}

export interface WindowsRunnerRuntimeOptions {
  app: Pick<App, 'getPath' | 'isPackaged' | 'getAppPath'>;
  getMainWindow: () => BrowserWindow | null;
  recordDiagnosticEvent: (event: Record<string, unknown>) => boolean | void;
  getDiagnosticsWriteFailureCount: () => number;
}

export interface WindowsRunnerRuntime {
  readonly execution: WindowsRunnerExecutionService | null;
  getCapability(): WindowsRunnerCapability;
  refresh(identity?: Record<string, unknown>): Promise<WindowsRunnerCapability>;
  setup(): Promise<WindowsRunnerSetupResult>;
  markDiagnosticsUnavailable(): void;
}

export async function createWindowsRunnerRuntime(
  options: WindowsRunnerRuntimeOptions,
): Promise<WindowsRunnerRuntime> {
  let execution: WindowsRunnerExecutionService | null = null;
  let support: WindowsRunnerSupport = resolveWindowsRunnerCommandSupport({
    unavailableCode: 'runner_startup_not_checked',
  });
  let capability = createWindowsRunnerCapabilityReport({
    platform: process.platform,
    support,
  });
  let commandSupportGate: WindowsRunnerSupport | null = null;
  let lastCapabilitySignature = '';

  const applySupport = (next: WindowsRunnerSupport) => {
    support = next;
    if (commandSupportGate) {
      Object.assign(commandSupportGate, next);
    } else {
      commandSupportGate = { ...next };
    }
  };

  let refresh = async (
    _identity?: Record<string, unknown>,
  ): Promise<WindowsRunnerCapability> => capability;
  let setup = async (): Promise<WindowsRunnerSetupResult> => ({
    supported: false,
    canceled: false,
    reasonCode: 'runner_unavailable',
  });

  if (process.platform === 'win32') {
    try {
      const userDataPath = options.app.getPath('userData');
      const helperPath = resolveWindowsRunnerNativeHelper({
        platform: process.platform,
        arch: process.arch,
        isPackaged: options.app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: options.app.getAppPath(),
      });
      const helper = new WindowsRunnerNativeHelper({
        executablePath: helperPath,
      });
      const setupStateStore = new WindowsRunnerSetupStateStore({
        userDataPath,
      });
      const setupService = new WindowsRunnerSetupService({
        stateStore: setupStateStore,
        helper,
        onEvent: (event) => {
          options.recordDiagnosticEvent({
            executionId: event.operationId,
            module: 'windows_runner',
            operation: event.type ?? 'setup_event',
            status: event.type?.endsWith('_failed') ? 'error' : 'observed',
            errorCode: event.code,
            details: { phase: event.stage },
          });
        },
      });

      refresh = async (identity) => {
        let backendReadiness;
        let setupReadiness;
        try {
          [backendReadiness, setupReadiness] = await Promise.all([
            helper.probeCommandBackend({ requestId: randomUUID() }),
            setupService.verifyReady(),
          ]);
          applySupport(
            resolveWindowsRunnerCommandSupport({
              backendReadiness,
              setupReadiness,
              diagnosticsReady: options.getDiagnosticsWriteFailureCount() === 0,
            }),
          );
          capability = createWindowsRunnerCapabilityReport({
            platform: process.platform,
            support,
            backendReadiness,
            setupReadiness,
            protocolVersion: WINDOWS_RUNNER_PROTOCOL_VERSION,
          });
        } catch (error) {
          const code =
            typeof (error as { code?: unknown })?.code === 'string'
              ? (error as { code: string }).code
              : 'runner_runtime_unavailable';
          applySupport(
            resolveWindowsRunnerCommandSupport({
              unavailableCode: code,
            }),
          );
          capability = createWindowsRunnerCapabilityReport({
            platform: process.platform,
            support,
          });
        }
        const signature = JSON.stringify(capability);
        if (signature !== lastCapabilitySignature) {
          options.recordDiagnosticEvent({
            executionId:
              typeof identity?.executionId === 'string'
                ? identity.executionId
                : undefined,
            taskId:
              typeof identity?.taskId === 'string'
                ? identity.taskId
                : undefined,
            requestId:
              typeof identity?.requestId === 'string'
                ? identity.requestId
                : undefined,
            toolCallId:
              typeof identity?.toolCallId === 'string'
                ? identity.toolCallId
                : undefined,
            module: 'windows_runner',
            operation:
              lastCapabilitySignature === ''
                ? 'capability.initialized'
                : 'capability.changed',
            status: capability.status,
            errorCode: capability.reasonCode ?? undefined,
            details: {
              backendId: capability.backendId ?? undefined,
              backendVersion: capability.backendVersion ?? undefined,
              policyVersion: capability.policyVersion ?? undefined,
              protocolVersion: capability.protocolVersion ?? undefined,
              backendReady: capability.backendReady,
              capabilityStatus: capability.status,
            },
          });
          lastCapabilitySignature = signature;
          const window = options.getMainWindow();
          if (window && !window.isDestroyed()) {
            window.webContents.send(
              'noema:windows-runner-capability-changed',
              capability,
            );
          }
        }
        return capability;
      };

      setup = async () => {
        const window = options.getMainWindow();
        if (!window || window.isDestroyed()) {
          return {
            supported: false,
            canceled: false,
            reasonCode: 'main_window_unavailable',
          };
        }
        const currentCapability = await refresh();
        if (!currentCapability.setupActionAvailable) {
          return {
            supported: currentCapability.supported,
            canceled: false,
            reasonCode:
              currentCapability.reasonCodes[0] ??
              currentCapability.reasonCode ??
              'runner_setup_not_actionable',
          };
        }
        try {
          await setupService.reconcile();
          const report = await refresh();
          return {
            supported: report.supported,
            canceled: false,
            reasonCode: report.reasonCode,
          };
        } catch (error) {
          await refresh();
          const code =
            typeof (error as { code?: unknown })?.code === 'string' &&
            /^[a-z0-9_]{1,96}$/u.test((error as { code: string }).code)
              ? (error as { code: string }).code
              : 'setup_failed';
          return {
            supported: false,
            canceled: false,
            reasonCode: code,
          };
        }
      };

      const aclJournalStore = new WindowsRunnerAclJournalStore({
        userDataPath,
      });
      const aclTransaction = new WindowsRunnerAclTransactionService({
        journalStore: aclJournalStore,
        helper,
        recordEvent: (event) => {
          options.recordDiagnosticEvent({
            executionId: event.executionId,
            taskId: event.taskId,
            requestId: event.requestId,
            toolCallId: event.toolCallId,
            module: 'windows_runner',
            operation: event.operation,
            status: event.reasonCode ? 'error' : event.stage,
            errorCode: event.reasonCode,
            details: { phase: event.stage },
          });
        },
      });
      const capabilityNameStore = new WindowsRunnerCapabilityNameStore({
        userDataPath,
      });
      execution = new WindowsRunnerExecutionService({
        helper,
        setupService,
        aclTransaction,
        capabilityNameStore,
        userDataPath,
        recordEvent: (event) => {
          options.recordDiagnosticEvent(event);
          const backendStateChanged =
            event.operation === 'backend_probe' &&
            capability.backendReady !== (event.status === 'ready');
          const setupStateChanged =
            event.operation === 'setup_verify' &&
            (capability.setupStatus === 'ready') !== (event.status === 'ready');
          if (backendStateChanged || setupStateChanged) {
            void refresh(event);
          }
        },
      });

      // Read-only checks only. Startup never mutates the current user's
      // AppContainer profile or durable setup state.
      const report = await refresh();
      options.recordDiagnosticEvent({
        module: 'windows_runner',
        operation: 'startup_readiness',
        status: report.supported ? 'ready' : 'unavailable',
        errorCode: report.reasonCode ?? undefined,
        details: { phase: 'startup' },
      });
    } catch (error) {
      const code =
        typeof (error as { code?: unknown })?.code === 'string'
          ? (error as { code: string }).code
          : 'runner_runtime_unavailable';
      applySupport(
        resolveWindowsRunnerCommandSupport({
          unavailableCode: code,
        }),
      );
      capability = createWindowsRunnerCapabilityReport({
        platform: process.platform,
        support,
      });
      options.recordDiagnosticEvent({
        module: 'windows_runner',
        operation: 'startup_readiness',
        status: 'error',
        errorCode: code,
        details: { phase: 'startup' },
      });
    }
  }

  return {
    execution,
    getCapability: () => capability,
    refresh,
    setup,
    markDiagnosticsUnavailable: () => {
      if (!commandSupportGate) {
        return;
      }
      commandSupportGate.supported = false;
      commandSupportGate.reason =
        'Noema 诊断记录不可用；为保留执行链路，命令未启动。';
    },
  };
}
