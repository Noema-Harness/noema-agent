import { Icon, AgentMark } from '../presentation';
import type { SocialChatController } from '../use-social-chat-controller';

type AgentEditorDialogModel = Pick<
  SocialChatController,
  | 'dialogRef'
  | 'createAgentOpen'
  | 'editingAgentId'
  | 'closeAgentDialog'
  | 'handleUpdateAgentProfile'
  | 'handleCreateAgent'
  | 'editingAgent'
  | 'agentName'
  | 'setAgentName'
  | 'creatingAgent'
  | 'updatingAgentProfile'
  | 'agentHeadline'
  | 'setAgentHeadline'
  | 'agentDescription'
  | 'setAgentDescription'
  | 'agentProjectWork'
  | 'setAgentProjectWork'
>;
export function AgentEditorDialog({
  model,
}: {
  model: AgentEditorDialogModel;
}) {
  const {
    dialogRef,
    createAgentOpen,
    editingAgentId,
    closeAgentDialog,
    handleUpdateAgentProfile,
    handleCreateAgent,
    editingAgent,
    agentName,
    setAgentName,
    creatingAgent,
    updatingAgentProfile,
    agentHeadline,
    setAgentHeadline,
    agentDescription,
    setAgentDescription,
    agentProjectWork,
    setAgentProjectWork,
  } = model;
  return createAgentOpen || editingAgentId ? (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAgentDialog();
      }}
    >
      <form
        ref={dialogRef}
        className="social-dialog agent-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-title"
        onSubmit={(event) =>
          void (editingAgentId
            ? handleUpdateAgentProfile(event)
            : handleCreateAgent(event))
        }
      >
        <div className="dialog-heading">
          <div>
            <h2 id="create-agent-title">
              {editingAgentId ? '编辑联系人资料' : '创建专业联系人'}
            </h2>
            <p>
              {editingAgentId
                ? `正在编辑${editingAgent?.name ?? '联系人'}。身份和聊天记录会保留。`
                : '给它一个可以长期实践的领域，而不是一次任务。'}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={closeAgentDialog}
          >
            <Icon name="close" />
          </button>
        </div>
        <label className="dialog-field">
          <span>联系人名称</span>
          <input
            autoFocus
            data-dialog-initial-focus
            id="social-agent-name"
            value={agentName}
            maxLength={60}
            placeholder="例如：林间观察员"
            onChange={(event) => setAgentName(event.target.value)}
            required
            disabled={creatingAgent || updatingAgentProfile}
          />
        </label>
        <label className="dialog-field">
          <span>长期专业范围</span>
          <input
            id="social-agent-headline"
            value={agentHeadline}
            maxLength={140}
            placeholder="例如：长期研究 Godot 游戏开发与项目迭代"
            onChange={(event) => setAgentHeadline(event.target.value)}
            required
            disabled={creatingAgent || updatingAgentProfile}
          />
          <small>尽量写一类可持续积累的实践，不写单次待办。</small>
        </label>
        <label className="dialog-field">
          <span>你希望它如何与你合作</span>
          <textarea
            id="social-agent-description"
            value={agentDescription}
            maxLength={800}
            rows={3}
            placeholder="例如：先和我厘清目标，再拆成可以验证的小步；发现方案有风险时直接指出。"
            onChange={(event) => setAgentDescription(event.target.value)}
            required
            disabled={creatingAgent || updatingAgentProfile}
          />
        </label>
        {!editingAgentId ? (
          <label className="agent-capability-choice">
            <input
              type="checkbox"
              checked={agentProjectWork}
              onChange={(event) => setAgentProjectWork(event.target.checked)}
              disabled={creatingAgent}
            />
            <span>
              <strong>允许它承接项目文件任务</strong>
              <small>
                默认关闭。开启后，你可以在对话中委托文件任务，启动前会请你选择工作目录。
              </small>
            </span>
          </label>
        ) : null}
        <p className="dialog-footnote">
          {editingAgentId
            ? '资料保存在本机，不会调用模型。更新会影响之后在该联系人的各个聊天中开始的新回复；历史消息不变。专业范围是你的设定，不代表其能力已经验证。'
            : '创建时资料只保存在本机，不调用模型。以后在这里聊天时，专业范围与合作方式会随消息发送给当前模型。专业范围是你的设定，不代表其能力已经验证。'}
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={closeAgentDialog}
            disabled={creatingAgent || updatingAgentProfile}
          >
            取消
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={
              creatingAgent ||
              updatingAgentProfile ||
              !agentName.trim() ||
              !agentHeadline.trim() ||
              !agentDescription.trim()
            }
          >
            {creatingAgent
              ? '正在创建…'
              : updatingAgentProfile
                ? '正在保存…'
                : editingAgentId
                  ? '保存资料'
                  : '创建联系人并开始私聊'}
          </button>
        </div>
      </form>
    </div>
  ) : null;
}

type GroupEditorDialogModel = Pick<
  SocialChatController,
  | 'busy'
  | 'agents'
  | 'dialogRef'
  | 'createGroupOpen'
  | 'closeGroupDialog'
  | 'handleCreateGroup'
  | 'groupTitle'
  | 'setGroupTitle'
  | 'activeAgents'
  | 'groupAgentIds'
  | 'toggleGroupAgent'
>;
export function GroupEditorDialog({
  model,
}: {
  model: GroupEditorDialogModel;
}) {
  const {
    busy,
    agents,
    dialogRef,
    createGroupOpen,
    closeGroupDialog,
    handleCreateGroup,
    groupTitle,
    setGroupTitle,
    activeAgents,
    groupAgentIds,
    toggleGroupAgent,
  } = model;
  return createGroupOpen ? (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeGroupDialog();
      }}
    >
      <form
        ref={dialogRef}
        className="social-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        onSubmit={(event) => void handleCreateGroup(event)}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="create-group-title">新建群聊</h2>
            <p>把同一位联系人带进新的聊天空间。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={closeGroupDialog}
          >
            <Icon name="close" />
          </button>
        </div>
        <label className="dialog-field">
          <span>群聊名称</span>
          <input
            autoFocus
            data-dialog-initial-focus
            id="social-group-title"
            value={groupTitle}
            maxLength={80}
            placeholder="例如：Noema 产品讨论"
            onChange={(event) => setGroupTitle(event.target.value)}
            required
          />
        </label>
        <fieldset className="group-agent-picker">
          <legend>邀请联系人</legend>
          {activeAgents.map((agent) => (
            <label key={agent.id} className="group-agent-option">
              <input
                type="checkbox"
                checked={groupAgentIds.includes(agent.id)}
                onChange={() => toggleGroupAgent(agent.id)}
              />
              <AgentMark agent={agent} small />
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.headline}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {activeAgents.length < agents.length ? (
          <p className="dialog-footnote">
            已归档联系人保留在原有聊天记录中；恢复后才能加入新的群聊。
          </p>
        ) : null}
        <p className="dialog-footnote">
          群聊会有独立记录；不会把各自私聊的历史带进来。
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={closeGroupDialog}
          >
            取消
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={
              !groupTitle.trim() ||
              !groupAgentIds.some((agentId) =>
                activeAgents.some((agent) => agent.id === agentId),
              ) ||
              busy
            }
          >
            {busy ? '正在创建…' : '创建群聊'}
          </button>
        </div>
      </form>
    </div>
  ) : null;
}

type ProjectEditorDialogModel = Pick<
  SocialChatController,
  | 'dialogRef'
  | 'activeAgents'
  | 'createProjectOpen'
  | 'closeProjectDialog'
  | 'handleCreateProject'
  | 'projectTitle'
  | 'setProjectTitle'
  | 'projectBrief'
  | 'setProjectBrief'
  | 'projectAgentIds'
  | 'setProjectAgentIds'
  | 'projectBusy'
>;
export function ProjectEditorDialog({
  model,
}: {
  model: ProjectEditorDialogModel;
}) {
  const {
    dialogRef,
    activeAgents,
    createProjectOpen,
    closeProjectDialog,
    handleCreateProject,
    projectTitle,
    setProjectTitle,
    projectBrief,
    setProjectBrief,
    projectAgentIds,
    setProjectAgentIds,
    projectBusy,
  } = model;
  return createProjectOpen ? (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeProjectDialog();
      }}
    >
      <form
        ref={dialogRef}
        className="social-dialog project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        onSubmit={(event) => void handleCreateProject(event)}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="create-project-title">建立项目空间</h2>
            <p>项目群聊与成员各自的项目会话会分开保存。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={closeProjectDialog}
          >
            <Icon name="close" />
          </button>
        </div>
        <label className="dialog-field">
          <span>项目名称</span>
          <input
            autoFocus
            data-dialog-initial-focus
            value={projectTitle}
            maxLength={120}
            placeholder="这次要一起完成什么？"
            onChange={(event) => setProjectTitle(event.target.value)}
            required
          />
        </label>
        <label className="dialog-field">
          <span>目标与背景</span>
          <textarea
            value={projectBrief}
            maxLength={40000}
            rows={4}
            placeholder="说明预期结果、已知背景或需要遵守的边界。"
            onChange={(event) => setProjectBrief(event.target.value)}
            required
          />
        </label>
        <fieldset className="group-agent-picker">
          <legend>初始成员</legend>
          {activeAgents
            .filter((agent) => agent.id !== 'noema')
            .map((agent) => (
              <label key={agent.id} className="group-agent-option">
                <input
                  type="checkbox"
                  checked={projectAgentIds.includes(agent.id)}
                  onChange={() =>
                    setProjectAgentIds((selected) =>
                      selected.includes(agent.id)
                        ? selected.filter((id) => id !== agent.id)
                        : [...selected, agent.id],
                    )
                  }
                />
                <AgentMark agent={agent} small />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.headline}</small>
                </span>
              </label>
            ))}
          {activeAgents.filter((agent) => agent.id !== 'noema').length === 0 ? (
            <p className="project-list-empty">
              还没有专业联系人。先创建联系人，再为项目组队。
            </p>
          ) : null}
        </fieldset>
        <p className="dialog-footnote">
          Noema 会加入项目群；每位成员的项目上下文与常驻私聊相互独立。
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={closeProjectDialog}
          >
            取消
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={
              projectBusy ||
              !projectTitle.trim() ||
              !projectBrief.trim() ||
              projectAgentIds.length === 0
            }
          >
            {projectBusy ? '正在建立…' : '建立项目'}
          </button>
        </div>
      </form>
    </div>
  ) : null;
}
