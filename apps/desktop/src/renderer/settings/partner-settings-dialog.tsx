import { NoemaSelect, NoemaInput } from '../ui/noema-form-controls';
import { NoemaButton } from '../ui/noema-button';
import { NoemaOverlay } from '../ui/noema-overlay';
import { Icon } from '../chat/presentation';
import { AgentMemoryPanel } from './agent-memory-panel';
import type { SocialChatController } from '../chat/use-social-chat-controller';

type PartnerSettingsDialogModel = Pick<
  SocialChatController,
  | 'setSettingsOpen'
  | 'state'
  | 'activeModel'
  | 'dialogRef'
  | 'settingsOpen'
  | 'closeSettingsDialog'
  | 'handleProviderSave'
  | 'refreshProviderModels'
  | 'refreshingProvider'
  | 'providerFeedback'
  | 'setProviderFeedback'
  | 'agentTriggerRef'
  | 'setCreateAgentOpen'
  | 'groupTriggerRef'
  | 'setCreateGroupOpen'
  | 'projectTriggerRef'
  | 'setCreateProjectOpen'
  | 'editProviderConfig'
  | 'modelOptions'
  | 'beginProviderEdit'
  | 'providerBaseUrl'
  | 'setProviderBaseUrl'
  | 'providerApiKey'
  | 'setProviderApiKey'
  | 'switchingModel'
  | 'handleModelChange'
  | 'savingWebSearch'
  | 'handleWebSearchClear'
  | 'webSearchApiKey'
  | 'setWebSearchApiKey'
  | 'handleWebSearchSave'
  | 'savingProvider'
  | 'executionPermissions'
  | 'executionPermissionsBusy'
  | 'executionPermissionsError'
  | 'handleExecutionPermissionsChange'
>;
export function PartnerSettingsDialog({
  model,
}: {
  model: PartnerSettingsDialogModel;
}) {
  const {
    setSettingsOpen,
    state,
    activeModel,
    dialogRef,
    settingsOpen,
    closeSettingsDialog,
    handleProviderSave,
    refreshProviderModels,
    refreshingProvider,
    providerFeedback,
    setProviderFeedback,
    agentTriggerRef,
    setCreateAgentOpen,
    groupTriggerRef,
    setCreateGroupOpen,
    projectTriggerRef,
    setCreateProjectOpen,
    editProviderConfig,
    modelOptions,
    beginProviderEdit,
    providerBaseUrl,
    setProviderBaseUrl,
    providerApiKey,
    setProviderApiKey,
    switchingModel,
    handleModelChange,
    savingWebSearch,
    handleWebSearchClear,
    webSearchApiKey,
    setWebSearchApiKey,
    handleWebSearchSave,
    savingProvider,
    executionPermissions,
    executionPermissionsBusy,
    executionPermissionsError,
    handleExecutionPermissionsChange,
  } = model;
  const settingsFeedback =
    providerFeedback ??
    (state?.error ? { kind: 'error' as const, message: state.error } : null);
  return settingsOpen ? (
    <NoemaOverlay isOpen={settingsOpen} onClose={closeSettingsDialog}>
      <form
        ref={dialogRef}
        className="social-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-settings-title"
        onSubmit={(event) => void handleProviderSave(event)}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="connection-settings-title">设置</h2>
            <p>模型、记忆、提醒和搜索。</p>
          </div>
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={closeSettingsDialog}
          >
            <Icon name="close" />
          </NoemaButton>
        </div>
        <div className="settings-dialog-scroll">
          <div className="settings-administration">
            <NoemaButton
              type="button"
              ref={agentTriggerRef}
              onClick={() => {
                setSettingsOpen(false);
                setCreateAgentOpen(true);
              }}
            >
              <Icon name="user-add" />
              新建伙伴
            </NoemaButton>
            <NoemaButton
              type="button"
              ref={groupTriggerRef}
              onClick={() => {
                setSettingsOpen(false);
                setCreateGroupOpen(true);
              }}
            >
              <Icon name="users" />
              新建群聊
            </NoemaButton>
            <NoemaButton
              type="button"
              ref={projectTriggerRef}
              onClick={() => {
                setSettingsOpen(false);
                setCreateProjectOpen(true);
              }}
            >
              <Icon name="project" />
              新建项目
            </NoemaButton>
          </div>
          <AgentMemoryPanel />
          {state?.providerConfigured && !editProviderConfig ? (
            <div className="connection-summary">
              <span role="status" aria-live="polite">
                <i
                  className={state.connected ? 'is-connected' : ''}
                  aria-hidden="true"
                />
                {state.connected
                  ? `${state.providerName} 已连接`
                  : `${state.providerName} 已配置，当前连接不可用`}
              </span>
              <div className="connection-summary-actions">
                <NoemaButton
                  type="button"
                  data-dialog-initial-focus={
                    modelOptions.length === 0 ? true : undefined
                  }
                  disabled={refreshingProvider || state.checking}
                  onClick={() => void refreshProviderModels()}
                >
                  {refreshingProvider || state.checking
                    ? '正在检查…'
                    : '重新检查'}
                </NoemaButton>
                <NoemaButton type="button" onClick={beginProviderEdit}>
                  更改配置
                </NoemaButton>
              </div>
            </div>
          ) : (
            <>
              <label className="dialog-field">
                <span>服务地址</span>
                <NoemaInput
                  autoFocus
                  data-dialog-initial-focus
                  value={providerBaseUrl}
                  onChange={(event) => {
                    setProviderFeedback(null);
                    setProviderBaseUrl(event.target.value);
                  }}
                  placeholder="https://api.deepseek.com/v1 或本机兼容接口"
                  required
                />
              </label>
              <label className="dialog-field">
                <span>API 密钥</span>
                <NoemaInput
                  type="password"
                  autoComplete="new-password"
                  value={providerApiKey}
                  onChange={(event) => {
                    setProviderFeedback(null);
                    setProviderApiKey(event.target.value);
                  }}
                  placeholder={
                    state?.providerConfigured
                      ? '输入新密钥以替换'
                      : '粘贴服务商提供的 API 密钥'
                  }
                  required
                  disabled={savingProvider}
                />
                {state?.providerConfigured ? (
                  <small>已保存的密钥不会显示；输入新密钥会替换。</small>
                ) : null}
              </label>
            </>
          )}
          <label className="dialog-field">
            <span>对话模型</span>
            <NoemaSelect
              aria-label="在设置中选择对话模型"
              data-dialog-initial-focus={
                state?.providerConfigured && !editProviderConfig
                  ? modelOptions.length > 0
                  : undefined
              }
              value={activeModel}
              disabled={modelOptions.length === 0 || switchingModel}
              onChange={(event) => void handleModelChange(event.target.value)}
            >
              {modelOptions.length === 0 && !activeModel ? (
                <option value="" disabled>
                  连接后显示可用模型
                </option>
              ) : null}
              {activeModel &&
              !modelOptions.some((model) => model.name === activeModel) ? (
                <option value={activeModel} disabled>
                  {activeModel} · 当前目录未列出
                </option>
              ) : null}
              {modelOptions.map((model) => (
                <option
                  key={model.name}
                  value={model.name}
                  disabled={
                    model.executionStatus === 'exhausted' ||
                    model.executionStatus === 'needsKey'
                  }
                >
                  {model.label}
                  {model.executionStatus === 'ready'
                    ? ' · 最近可用'
                    : model.executionStatus === 'exhausted'
                      ? ' · 暂不可用'
                      : model.executionStatus === 'needsKey'
                        ? ' · 需密钥'
                        : ' · 状态未知'}
                </option>
              ))}
            </NoemaSelect>
          </label>
          <p className="dialog-footnote">
            远程服务请使用 HTTPS。发送内容由模型服务商处理。
          </p>
          <section
            className="settings-provider-section"
            aria-labelledby="web-search-settings-title"
          >
            <div>
              <h3 id="web-search-settings-title">网页搜索</h3>
              <p>需要最新信息时使用。搜索词会发送给 Tavily。</p>
            </div>
            {state?.webSearchConfigured ? (
              <div className="connection-summary">
                <span>
                  <i />
                  Tavily 密钥已加密保存在本机
                </span>
                <NoemaButton
                  type="button"
                  disabled={savingWebSearch}
                  onClick={() => void handleWebSearchClear()}
                >
                  移除
                </NoemaButton>
              </div>
            ) : null}
            <label className="dialog-field">
              <span>
                {state?.webSearchConfigured
                  ? '替换 API 密钥'
                  : 'Tavily API 密钥'}
              </span>
              <NoemaInput
                type="password"
                autoComplete="new-password"
                value={webSearchApiKey}
                onChange={(event) => setWebSearchApiKey(event.target.value)}
                placeholder={
                  state?.webSearchConfigured
                    ? '输入新密钥以替换'
                    : '配置后启用来源搜索'
                }
                disabled={savingWebSearch}
              />
            </label>
            <div className="dialog-actions">
              <NoemaButton
                className="secondary-action"
                type="button"
                disabled={savingWebSearch || !webSearchApiKey.trim()}
                onClick={() => void handleWebSearchSave()}
              >
                {savingWebSearch ? '正在保存…' : '保存搜索密钥'}
              </NoemaButton>
            </div>
          </section>
          <section
            className="settings-provider-section"
            aria-labelledby="execution-permissions-title"
          >
            <div>
              <h3 id="execution-permissions-title">执行权限</h3>
              <p>决定 Noema 命令和 DSH 执行器能访问什么。</p>
            </div>
            <div className="permission-row">
              <div>
                <strong>项目文件夹</strong>
                <small>
                  {executionPermissions.externalFiles === 'read-only'
                    ? '执行器只读取项目文件，不能写入。'
                    : '成员可读写自己项目里的文件。'}
                </small>
              </div>
              <span className="permission-fixed">
                {executionPermissions.externalFiles === 'read-only'
                  ? '只读'
                  : '允许'}
              </span>
            </div>
            <label className="dialog-field">
              <span>文件访问</span>
              <NoemaSelect
                aria-label="选择文件访问权限"
                value={executionPermissions.externalFiles}
                disabled={executionPermissionsBusy}
                onChange={(event) =>
                  void handleExecutionPermissionsChange({
                    externalFiles:
                      event.target.value === 'allow' ||
                      event.target.value === 'read-only'
                        ? event.target.value
                        : 'ask',
                  })
                }
              >
                <option value="read-only">只读</option>
                <option value="ask">工作区读写（外部确认）</option>
                <option value="allow">完全访问</option>
              </NoemaSelect>
            </label>
            <div className="permission-row">
              <div>
                <strong>网络</strong>
                <small>项目命令暂时不能联网。</small>
              </div>
              <span className="permission-fixed">禁止</span>
            </div>
            {executionPermissionsError ? (
              <p className="settings-form-feedback is-error" role="alert">
                {executionPermissionsError}
              </p>
            ) : (
              <p className="dialog-footnote">
                {executionPermissions.externalFiles === 'allow'
                  ? 'Noema 和 DSH 执行器都不再逐条确认工作区外文件；网络仍禁止。'
                  : executionPermissions.externalFiles === 'read-only'
                    ? 'Noema 和 DSH 执行器只能读取文件，不能写入；网络仍禁止。'
                    : 'Noema 和 DSH 执行器可写项目文件夹，访问外部文件时请求确认。'}
              </p>
            )}
          </section>
        </div>
        <div className="settings-dialog-footer">
          {settingsFeedback ? (
            <p
              className={`settings-form-feedback is-${settingsFeedback.kind}`}
              role={settingsFeedback.kind === 'error' ? 'alert' : 'status'}
              aria-live={
                settingsFeedback.kind === 'error' ? 'assertive' : 'polite'
              }
            >
              {settingsFeedback.message}
            </p>
          ) : null}
          <div className="dialog-actions settings-dialog-actions">
            {state?.providerConfigured && !editProviderConfig ? (
              <NoemaButton
                className="primary-action"
                type="button"
                onClick={closeSettingsDialog}
              >
                完成
              </NoemaButton>
            ) : (
              <>
                <NoemaButton
                  className="secondary-action"
                  type="button"
                  onClick={closeSettingsDialog}
                >
                  取消
                </NoemaButton>
                <NoemaButton
                  className="primary-action"
                  type="submit"
                  disabled={savingProvider || !providerApiKey.trim()}
                >
                  {savingProvider ? '正在检查…' : '保存并检查模型'}
                </NoemaButton>
              </>
            )}
          </div>
        </div>
      </form>
    </NoemaOverlay>
  ) : null;
}
