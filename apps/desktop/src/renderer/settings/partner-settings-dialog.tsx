import { Icon } from '../chat/presentation';
import type { SocialChatController } from '../chat/use-social-chat-controller';

type PartnerSettingsDialogModel = Pick<
  SocialChatController,
  | 'setSettingsOpen'
  | 'state'
  | 'activeModel'
  | 'dialogRef'
  | 'setFirstMeetingReplay'
  | 'settingsOpen'
  | 'closeSettingsDialog'
  | 'openPersonalMemories'
  | 'openUserFollowups'
  | 'handleProviderSave'
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
    setFirstMeetingReplay,
    settingsOpen,
    closeSettingsDialog,
    openPersonalMemories,
    openUserFollowups,
    handleProviderSave,
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
  } = model;
  return settingsOpen ? (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSettingsDialog();
      }}
    >
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
            <h2 id="connection-settings-title">连接与模型</h2>
            <p>消息保存在本机，并发送到这里选择的模型服务。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={closeSettingsDialog}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="settings-administration">
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setFirstMeetingReplay(true);
            }}
          >
            重看初次相遇
          </button>
          <button
            type="button"
            ref={agentTriggerRef}
            onClick={() => {
              setSettingsOpen(false);
              setCreateAgentOpen(true);
            }}
          >
            创建联系人
          </button>
          <button
            type="button"
            ref={groupTriggerRef}
            onClick={() => {
              setSettingsOpen(false);
              setCreateGroupOpen(true);
            }}
          >
            新建群聊
          </button>
          <button
            type="button"
            ref={projectTriggerRef}
            onClick={() => {
              setSettingsOpen(false);
              setCreateProjectOpen(true);
            }}
          >
            新建项目
          </button>
        </div>
        {state?.providerConfigured && !editProviderConfig ? (
          <div className="connection-summary">
            <span>
              <i className={state.connected ? 'is-connected' : ''} />
              {state.connected
                ? `${state.providerName} 已连接`
                : `${state.providerName} 已配置，当前连接不可用`}
            </span>
            <button
              type="button"
              data-dialog-initial-focus={
                modelOptions.length === 0 ? true : undefined
              }
              onClick={beginProviderEdit}
            >
              更改配置
            </button>
          </div>
        ) : (
          <>
            <label className="dialog-field">
              <span>模型服务地址</span>
              <input
                autoFocus
                data-dialog-initial-focus
                value={providerBaseUrl}
                onChange={(event) => setProviderBaseUrl(event.target.value)}
                placeholder="https://api.deepseek.com/v1 或本机兼容接口"
                required
              />
            </label>
            <label className="dialog-field">
              <span>API Key</span>
              <input
                type="password"
                autoComplete="new-password"
                value={providerApiKey}
                onChange={(event) => setProviderApiKey(event.target.value)}
                placeholder={
                  state?.providerConfigured
                    ? '输入新 Key 以替换当前凭据'
                    : '粘贴服务商提供的 API Key'
                }
                required
              />
            </label>
          </>
        )}
        <label className="dialog-field">
          <span>当前对话模型</span>
          <select
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
          </select>
        </label>
        <p className="dialog-footnote">
          本机服务可使用 HTTP，远程服务必须使用
          HTTPS。模型服务会按各自政策处理请求内容。
        </p>
        <section
          className="settings-provider-section personal-memory-settings-entry"
          aria-labelledby="personal-memory-settings-title"
        >
          <div>
            <h3 id="personal-memory-settings-title">个人记忆</h3>
            <p>由你决定保存什么；Noema 主聊只在相关时检索。</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={openPersonalMemories}
          >
            管理个人记忆
          </button>
        </section>
        <section
          className="settings-provider-section personal-memory-settings-entry"
          aria-labelledby="user-followups-settings-title"
        >
          <div>
            <h3 id="user-followups-settings-title">回访提醒</h3>
            <p>只在你安排或接受后创建，到期通过本机通知提醒。</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={openUserFollowups}
          >
            管理回访
          </button>
        </section>
        <section
          className="settings-provider-section"
          aria-labelledby="web-search-settings-title"
        >
          <div>
            <h3 id="web-search-settings-title">网页搜索（Tavily）</h3>
            <p>
              只在你问到近期信息或明确要求查找来源时使用。搜索词会发送给
              Tavily；每轮最多一次，使用基础搜索，最多读取 3
              个候选网页。成功读取的正文来源会保存在对应答复中。具体额度与费用由你的
              Tavily 账户方案决定；Noema 不会自动升级或重试。
            </p>
          </div>
          {state?.webSearchConfigured ? (
            <div className="connection-summary">
              <span>
                <i />
                Tavily 密钥已加密保存在本机
              </span>
              <button
                type="button"
                disabled={savingWebSearch}
                onClick={() => void handleWebSearchClear()}
              >
                移除
              </button>
            </div>
          ) : null}
          <label className="dialog-field">
            <span>
              {state?.webSearchConfigured ? '替换 API Key' : 'Tavily API Key'}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={webSearchApiKey}
              onChange={(event) => setWebSearchApiKey(event.target.value)}
              placeholder={
                state?.webSearchConfigured
                  ? '输入新 Key 以替换'
                  : '配置后启用来源搜索'
              }
              disabled={savingWebSearch}
            />
          </label>
          <div className="dialog-actions">
            <button
              className="secondary-action"
              type="button"
              disabled={savingWebSearch || !webSearchApiKey.trim()}
              onClick={() => void handleWebSearchSave()}
            >
              {savingWebSearch ? '正在保存…' : '保存搜索密钥'}
            </button>
          </div>
        </section>
        {state?.error ? (
          <p className="dialog-error" role="status">
            {state.error}
          </p>
        ) : null}
        <div className="dialog-actions">
          {state?.providerConfigured && !editProviderConfig ? (
            <button
              className="primary-action"
              type="button"
              onClick={closeSettingsDialog}
            >
              完成
            </button>
          ) : (
            <>
              <button
                className="secondary-action"
                type="button"
                onClick={closeSettingsDialog}
              >
                取消
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={savingProvider || !providerApiKey.trim()}
              >
                {savingProvider ? '正在检查…' : '保存并检查模型'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  ) : null;
}
