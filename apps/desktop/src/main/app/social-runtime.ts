import type { NoemaProviderState } from '../../shared/contracts/noema-bridge.d.ts';
import { dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { SocialWorkService } from '../execution/social-work-service.mjs';
import type { SocialChatStore } from '../chat/social-chat-store.mjs';
import type { SocialProjectStore } from '../projects/social-project-store.mjs';
import { captureWorkspaceIdentity } from '../platform/workspace-identity.ts';
import {
  conversationExportFileName,
  formatConversationMarkdown,
} from '../../shared/export/conversation-markdown.ts';
import {
  formatWorkTicketMarkdown,
  workTicketExportFileName,
} from '../../shared/export/work-ticket-markdown.ts';
import type { ProviderRuntime } from './provider-runtime';

type WorkspaceTarget = string;

interface WorkspaceIdentity {
  version: number;
  canonicalPath: string;
  device: string;
  fileIndex: string;
}

interface SocialChatStoreLike {
  getAgent(agentId: string): { name?: string } | null | undefined;
}

interface SocialProjectStoreLike {
  getWorkspaceBinding(
    projectId: string,
  ): { valid?: boolean; workspacePath?: string | null } | null | undefined;
}

interface PracticeCandidate {
  sourceTaskId: string;
  basisTaskId: string;
  basisRoomTitle: string;
  basisTaskPrompt: string;
  roomTitle: string;
  trigger: string;
  action: string;
  limits: string;
}

type PracticeDecision = 'trial' | 'case' | 'cancel';

export interface SocialWorkDialogsOptions {
  app: { isPackaged: boolean };
  getMainWindow: () => BrowserWindow | null;
  socialChatStore: SocialChatStoreLike | null;
  socialProjectStore: SocialProjectStoreLike | null;
  ensureAgentDirectory: (input: {
    agentId: string;
    name: string;
  }) => WorkspaceTarget;
  beginWorkspaceAuthorization: () => (
    outcome: 'granted' | 'denied',
    reason?: string,
  ) => void;
  recordProjectWorkspaceSelection: (
    status: 'completed' | 'canceled',
    source: string,
  ) => void;
  socialWorkE2eValid: boolean;
  socialAgentE2eValid: boolean;
  socialAgentE2eDirectory: string | null;
  socialWorkEntryE2eValid: boolean;
  testSocialWorkWorkspace: WorkspaceTarget | null;
  testSocialWorkPracticeDecision: PracticeDecision | null;
  testSocialWorkLiveEpisodes: boolean;
  practiceConfirmationEvidence: Array<Record<string, unknown>>;
}

export interface SocialWorkDialogs {
  chooseWorkspace: (input?: {
    reuseCase?: boolean;
    prompt?: string;
    projectId?: string | null;
    agentId?: string | null;
    roomId?: string | null;
  }) => Promise<WorkspaceTarget | null>;
  chooseProjectWorkspace: (input?: {
    source?: string;
  }) => Promise<{ workspacePath: string; identity: WorkspaceIdentity } | null>;
  confirmWorkspaceRebind: (input: {
    projectId: string;
    oldPath: string;
    newPath: string;
  }) => Promise<'rebind' | 'cancel'>;
  confirmPracticeCandidate: (input: {
    candidate: PracticeCandidate;
    taskPrompt: string;
    caseSnapshot: { taskId: string; taskPrompt: string } | null;
  }) => Promise<PracticeDecision>;
}

export function createSocialWorkDialogs(
  options: SocialWorkDialogsOptions,
): SocialWorkDialogs {
  const {
    app,
    getMainWindow,
    socialChatStore,
    socialProjectStore,
    ensureAgentDirectory,
    beginWorkspaceAuthorization,
    recordProjectWorkspaceSelection,
    socialWorkE2eValid,
    socialAgentE2eValid,
    socialAgentE2eDirectory,
    socialWorkEntryE2eValid,
    testSocialWorkWorkspace,
    testSocialWorkPracticeDecision,
    testSocialWorkLiveEpisodes,
    practiceConfirmationEvidence,
  } = options;

  const chooseWorkspace: SocialWorkDialogs['chooseWorkspace'] = async ({
    reuseCase = false,
    prompt = '',
    projectId = null,
    agentId = null,
  } = {}) => {
    const recordWorkspaceAuthorization = beginWorkspaceAuthorization();
    if (socialWorkE2eValid) {
      if (
        socialWorkEntryE2eValid &&
        prompt.includes('NOEMA_WORK_ENTRY_CANCEL')
      ) {
        return null;
      }
      recordWorkspaceAuthorization('granted');
      return testSocialWorkWorkspace;
    }
    if (!projectId && agentId && agentId !== 'noema') {
      const agent = socialChatStore?.getAgent(agentId);
      const directory = ensureAgentDirectory({
        agentId,
        name: agent?.name ?? agentId,
      });
      recordWorkspaceAuthorization('granted', 'agent_default');
      return directory;
    }
    const devWorkspaceOverride = !app.isPackaged
      ? process.env.NOEMA_DEV_PROJECT_WORKSPACE_PATH
      : null;
    if (projectId && socialProjectStore) {
      const binding = socialProjectStore.getWorkspaceBinding(projectId);
      if (
        binding?.valid &&
        binding.workspacePath &&
        fs.existsSync(binding.workspacePath)
      ) {
        recordWorkspaceAuthorization('granted', 'project_binding');
        return binding.workspacePath;
      }
    }
    if (devWorkspaceOverride) {
      const workspace = path.resolve(devWorkspaceOverride);
      if (
        !path.isAbsolute(devWorkspaceOverride) ||
        !fs.existsSync(workspace) ||
        !fs.statSync(workspace).isDirectory()
      ) {
        throw new Error(
          'NOEMA_DEV_PROJECT_WORKSPACE_PATH must point to an existing absolute directory.',
        );
      }
      recordWorkspaceAuthorization('granted', 'development_override');
      return workspace;
    }
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      recordWorkspaceAuthorization('denied', 'main_window_unavailable');
      return null;
    }
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '检查项目工作并选择文件夹',
      message: [
        `Noema 准备在你选择的工作区执行项目任务：\n${prompt}`,
        'Noema 会读取/修改项目文件，并在当前 Windows 用户的 AppContainer 沙箱中运行前台项目命令。首次启用时，Noema 会建立并核验当前用户的隔离配置，无需管理员权限，不创建 Windows 登录账号。命令默认没有网络访问，读写范围限于你选定的工作区；需要访问工作区外路径时会展示具体命令与目标，逐项询问是否仅对该命令开放。项目内容可能发送到当前配置的模型服务商，并按该服务商的数据处理条款处理。不要选择含不应发送的密钥或隐私资料的目录。停止任务不会自动撤销已经发生的项目改动。',
        reuseCase
          ? '本轮还会检查同一位工程搭档在同一项目的其他聊天中，是否有一项通过 Noema 文件条件核验的工作；若找到，会把一份过滤常见凭据样式的限长摘要随本任务发送给模型，不会发送原聊天记录。若本任务也通过 Noema 核验，Noema 还可能用当前模型服务对两项任务的摘要和核验结果做一次额外分析，提出一条候选做法；候选不会自动升级为技能，可在任务卡撤回。若已有候选，选定目录后还会先展示候选正文，供你决定本轮是否试用；普通经验复用勾选不会自动授权使用某条候选。过滤无法保证识别所有敏感信息。'
          : '本轮不会从其他聊天带入项目案例。',
      ].join('\n\n'),
      properties: ['openDirectory'],
      buttonLabel: '允许并继续',
    });
    if (selection.canceled || !selection.filePaths[0]) {
      recordWorkspaceAuthorization('denied', 'user_cancelled');
      return null;
    }
    recordWorkspaceAuthorization('granted');
    return selection.filePaths[0];
  };

  const confirmWorkspaceRebind: SocialWorkDialogs['confirmWorkspaceRebind'] =
    async ({ oldPath, newPath }) => {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return 'cancel';
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '更换工作文件夹',
        message: '这个项目已绑定到另一个文件夹。是否将项目绑定更换到新文件夹？',
        detail: `当前绑定：${oldPath}\n新选择：${newPath}\n\n更换后，新任务会在新文件夹中执行。已有任务记录与恢复检查点不会迁移。`,
        buttons: ['更换工作区', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      return confirmation.response === 0 ? 'rebind' : 'cancel';
    };

  const confirmPracticeCandidate: SocialWorkDialogs['confirmPracticeCandidate'] =
    async ({ candidate, taskPrompt, caseSnapshot }) => {
      const preview = {
        taskPrompt,
        trigger: candidate.trigger,
        action: candidate.action,
        limits: candidate.limits,
        sourceRoomTitle: candidate.roomTitle,
        sourceTaskId: candidate.sourceTaskId,
        basisTaskPrompt: candidate.basisTaskPrompt,
        fallbackCaseTaskId: caseSnapshot?.taskId ?? null,
      };
      if (socialWorkE2eValid) {
        const decision =
          testSocialWorkPracticeDecision ??
          (testSocialWorkLiveEpisodes ? 'case' : 'trial');
        practiceConfirmationEvidence.push({ ...preview, decision });
        return decision;
      }
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return 'cancel';
      const previewText = (value: string, limit: number) =>
        value.length <= limit
          ? value
          : `${value.slice(0, limit)}\n……（预览已截断）`;
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: '先审阅这条做法是否适合当前任务',
        message: '这是一条由过往已核验工作提炼的候选，不是已学会的能力。',
        detail: [
          `当前任务：\n${previewText(taskPrompt, 1_800)}`,
          `触发条件：\n${candidate.trigger}`,
          `候选做法：\n${candidate.action}`,
          `适用边界：\n${candidate.limits}`,
          `来源：${candidate.roomTitle}；基础案例：${previewText(candidate.basisTaskPrompt || candidate.basisTaskId, 1_200)}`,
          caseSnapshot
            ? `选择“只引用已核验案例”会带入「${caseSnapshot.taskPrompt || caseSnapshot.taskId}」，不发送候选做法。`
            : '当前没有可带入的原案例；选择“不试用候选”时只执行当前任务。',
          '选择“试用”会把这条候选和当前任务一并发送给当前配置的模型服务商。试用结果只表示 Noema 文件条件是否通过，不证明候选导致了结果。',
        ].join('\n\n'),
        buttons: [
          caseSnapshot ? '只引用已核验案例' : '不带入候选',
          '试用候选一次',
          '取消任务',
        ],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      const decision: PracticeDecision =
        confirmation.response === 1
          ? 'trial'
          : confirmation.response === 0
            ? 'case'
            : 'cancel';
      practiceConfirmationEvidence.push({ ...preview, decision });
      return decision;
    };

  const chooseProjectWorkspace: SocialWorkDialogs['chooseProjectWorkspace'] =
    async (input) => {
      const source = input?.source ?? 'project_create';
      const acceptWorkspace = (workspacePath: string) => {
        const identity = captureWorkspaceIdentity(workspacePath);
        if (!identity.ok || !identity.identity) {
          throw new Error('无法读取这个文件夹，请换一个目录。');
        }
        recordProjectWorkspaceSelection('completed', source);
        return { workspacePath, identity: identity.identity };
      };
      if (socialWorkE2eValid && testSocialWorkWorkspace) {
        return acceptWorkspace(testSocialWorkWorkspace);
      }
      if (socialAgentE2eValid && socialAgentE2eDirectory) {
        const workspacePath = path.join(
          socialAgentE2eDirectory,
          'project-workspace',
        );
        fs.mkdirSync(workspacePath, { recursive: true });
        return acceptWorkspace(workspacePath);
      }
      const devWorkspaceOverride = !app.isPackaged
        ? process.env.NOEMA_DEV_PROJECT_WORKSPACE_PATH
        : null;
      if (devWorkspaceOverride) {
        const workspacePath = path.resolve(devWorkspaceOverride);
        if (!path.isAbsolute(workspacePath) || !fs.existsSync(workspacePath)) {
          throw new Error(
            'NOEMA_DEV_PROJECT_WORKSPACE_PATH must point to an existing directory.',
          );
        }
        return acceptWorkspace(workspacePath);
      }
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      const selection = await dialog.showOpenDialog(mainWindow, {
        title: '选择工作文件夹',
        message:
          '项目成员会读取和修改这个文件夹中的文件，并在其中运行前台命令。请只选择允许 Noema 使用的目录。',
        buttonLabel: '使用此文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) {
        recordProjectWorkspaceSelection('canceled', source);
        return null;
      }
      return acceptWorkspace(selectedPath);
    };

  return {
    chooseWorkspace,
    chooseProjectWorkspace,
    confirmWorkspaceRebind,
    confirmPracticeCandidate,
  };
}

export interface SocialStateRuntimeOptions {
  app: { getPath(name: string): string };
  getRootAgentState: () => Promise<NoemaProviderState>;
  socialAgentE2eValid: boolean;
  socialWorkEntryE2eValid: boolean;
  testSocialAgentLiveE2e: boolean;
  e2eModel: string;
}

export function createSocialStateRuntime(options: SocialStateRuntimeOptions) {
  const {
    app,
    getRootAgentState,
    socialAgentE2eValid,
    socialWorkEntryE2eValid,
    testSocialAgentLiveE2e,
    e2eModel,
  } = options;

  const getSocialRootState = async () => {
    const state = await getRootAgentState();
    if (
      (!socialAgentE2eValid && !socialWorkEntryE2eValid) ||
      testSocialAgentLiveE2e
    ) {
      return state;
    }
    return {
      ...state,
      connected: true,
      checking: false,
      models: [
        {
          name: e2eModel,
          label: 'E2E 本机测试模型',
          routeKind: 'direct' as const,
          executionStatus: 'ready' as const,
        },
      ],
      selectedModel: e2eModel,
      error: null,
      providerConfigured: true,
    };
  };

  function ensureAgentDirectory({
    agentId,
    name,
  }: {
    agentId: string;
    name: string;
  }): string {
    const base =
      socialAgentE2eValid || socialWorkEntryE2eValid
        ? path.join(app.getPath('userData'), 'agent-workspaces')
        : path.join(app.getPath('documents'), 'Noema', 'Agents');
    const safeName =
      String(name)
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .trim()
        .slice(0, 60) || 'agent';
    const directory = path.join(base, `${safeName}-${agentId.slice(-6)}`);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  return { getSocialRootState, ensureAgentDirectory };
}

type SocialWorkServiceOptions = ConstructorParameters<
  typeof SocialWorkService
>[0];

export interface SocialWorkServiceRuntimeOptions {
  store: SocialChatStore;
  projectStore: SocialProjectStore;
  dialogs: SocialWorkDialogs;
  adapter: SocialWorkServiceOptions['adapter'];
  secretStore: SocialWorkServiceOptions['secretStore'];
  practiceProvider: SocialWorkServiceOptions['practiceProvider'];
  getSelectedModel: () => string | null;
  assertWorkAllowed: (roomId: string) => void;
  socialWorkE2eValid: boolean;
  testSocialWorkChecksJson: string | null;
  recordDiagnosticEvent: (event: Record<string, unknown>) => void;
  currentApplicationExecutionId: string | null;
  emit: (event: object) => void;
}

export function createSocialWorkServiceRuntime(
  options: SocialWorkServiceRuntimeOptions,
): SocialWorkService {
  const {
    store,
    projectStore,
    dialogs,
    adapter,
    secretStore,
    practiceProvider,
    getSelectedModel,
    assertWorkAllowed,
    socialWorkE2eValid,
    testSocialWorkChecksJson,
    recordDiagnosticEvent,
    currentApplicationExecutionId,
    emit,
  } = options;

  return new SocialWorkService({
    store,
    projectStore,
    getSelectedModel,
    assertWorkAllowed,
    adapter,
    secretStore,
    practiceProvider,
    recordDiagnosticEvent: (event) =>
      recordDiagnosticEvent({
        ...event,
        ...(event.operation === 'workspace.selection' &&
        event.status === 'canceled'
          ? { parentExecutionId: currentApplicationExecutionId }
          : {}),
      }),
    defaultVerificationChecks:
      socialWorkE2eValid && testSocialWorkChecksJson
        ? JSON.parse(testSocialWorkChecksJson)
        : [],
    chooseWorkspace: dialogs.chooseWorkspace,
    confirmWorkspaceRebind: dialogs.confirmWorkspaceRebind,
    confirmPracticeCandidate: dialogs.confirmPracticeCandidate,
    emit,
  });
}

export interface ChatExportRuntimeOptions {
  getMainWindow: () => BrowserWindow | null;
  socialChatStore: SocialChatStore | null;
  modelUsageStore: ProviderRuntime['modelUsageStore'];
}

export interface ChatExportResult {
  saved: boolean;
  path?: string;
  canceled?: boolean;
  errorCode?: string;
}

export interface ChatExportRuntime {
  exportConversation(roomId: string): Promise<ChatExportResult>;
  exportWorkTicket(taskId: string): Promise<ChatExportResult>;
}

function usableWindow(
  getMainWindow: () => BrowserWindow | null,
): BrowserWindow | null {
  const window = getMainWindow();
  return window && !window.isDestroyed() ? window : null;
}

export function createChatExportRuntime(
  options: ChatExportRuntimeOptions,
): ChatExportRuntime {
  return {
    async exportConversation(roomId: string): Promise<ChatExportResult> {
      const window = usableWindow(options.getMainWindow);
      if (!window || !options.socialChatStore) {
        return { saved: false, errorCode: 'window_unavailable' };
      }
      try {
        const snapshot = options.socialChatStore.getRoomSnapshot(roomId);
        const markdown = formatConversationMarkdown(snapshot);
        const selected = await dialog.showSaveDialog(window, {
          title: '导出对话',
          defaultPath: conversationExportFileName(snapshot.room),
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (selected.canceled || !selected.filePath) {
          return { saved: false, canceled: true };
        }
        await fs.promises.writeFile(selected.filePath, markdown, 'utf8');
        return { saved: true, path: selected.filePath };
      } catch (error) {
        return {
          saved: false,
          errorCode: error instanceof Error ? error.message : 'export_failed',
        };
      }
    },

    async exportWorkTicket(taskId: string): Promise<ChatExportResult> {
      const window = usableWindow(options.getMainWindow);
      if (!window || !options.socialChatStore) {
        return { saved: false, errorCode: 'window_unavailable' };
      }
      try {
        const task = options.socialChatStore.getSocialWorkTask(taskId);
        const usage = options.modelUsageStore.getTaskUsage(taskId);
        const markdown = formatWorkTicketMarkdown({ task, usage });
        const selected = await dialog.showSaveDialog(window, {
          title: '导出工单结果',
          defaultPath: workTicketExportFileName(task),
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (selected.canceled || !selected.filePath) {
          return { saved: false, canceled: true };
        }
        await fs.promises.writeFile(selected.filePath, markdown, 'utf8');
        return { saved: true, path: selected.filePath };
      } catch (error) {
        return {
          saved: false,
          errorCode: error instanceof Error ? error.message : 'export_failed',
        };
      }
    },
  };
}
