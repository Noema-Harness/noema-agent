import {
  NoemaCheckbox,
  NoemaInput,
  NoemaTextArea,
} from '../../ui/noema-form-controls';
import { NoemaButton } from '../../ui/noema-button';
import { NoemaOverlay } from '../../ui/noema-overlay';
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
  | 'agentNameError'
  | 'handleAgentNameChange'
  | 'creatingAgent'
  | 'updatingAgentProfile'
  | 'agentHeadline'
  | 'setAgentHeadline'
  | 'agentDescription'
  | 'setAgentDescription'
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
    agentNameError,
    handleAgentNameChange,
    creatingAgent,
    updatingAgentProfile,
    agentHeadline,
    setAgentHeadline,
    agentDescription,
    setAgentDescription,
  } = model;
  return (
    <NoemaOverlay
      isOpen={createAgentOpen || Boolean(editingAgentId)}
      onClose={closeAgentDialog}
      canEscapeKeyClose
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
              {editingAgentId ? '编辑联系人' : '新建联系人'}
            </h2>
            <p>
              {editingAgentId
                ? `修改${editingAgent?.name ?? '联系人'}的资料，聊天记录不变。`
                : '让它在某个领域长期协助你。'}
            </p>
          </div>
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={closeAgentDialog}
          >
            <Icon name="close" />
          </NoemaButton>
        </div>
        <label className="dialog-field">
          <span>联系人名称</span>
          <NoemaInput
            autoFocus
            data-dialog-initial-focus
            id="social-agent-name"
            value={agentName}
            maxLength={60}
            placeholder="例如：前端工程师"
            onChange={(event) => handleAgentNameChange(event.target.value)}
            aria-invalid={Boolean(agentNameError)}
            aria-describedby={
              agentNameError ? 'social-agent-name-error' : undefined
            }
            required
            disabled={creatingAgent || updatingAgentProfile}
          />
          <small>用通用职业或头衔命名，能跨项目复用。</small>
          {agentNameError ? (
            <small
              className="dialog-error"
              id="social-agent-name-error"
              role="alert"
            >
              {agentNameError}
            </small>
          ) : null}
        </label>
        <label className="dialog-field">
          <span>职业 / 专业领域</span>
          <NoemaInput
            id="social-agent-headline"
            value={agentHeadline}
            maxLength={140}
            placeholder="例如：Web 前端、3D 交互与可视化"
            onChange={(event) => setAgentHeadline(event.target.value)}
            required
            disabled={creatingAgent || updatingAgentProfile}
          />
          <small>可在不同项目中复用的专业方向。</small>
        </label>
        <label className="dialog-field">
          <span>协作方式</span>
          <NoemaTextArea
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
        <p className="dialog-footnote">
          {editingAgentId
            ? '资料只保存在本机，修改后对新回复生效。'
            : '资料只保存在本机。创建后会开始私聊；项目任务会使用项目选定的文件夹。'}
        </p>
        <div className="dialog-actions">
          <NoemaButton
            className="secondary-action"
            type="button"
            onClick={closeAgentDialog}
            disabled={creatingAgent || updatingAgentProfile}
          >
            取消
          </NoemaButton>
          <NoemaButton
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
                  : '创建并开始聊天'}
          </NoemaButton>
        </div>
      </form>
    </NoemaOverlay>
  );
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
    <NoemaOverlay isOpen onClose={closeGroupDialog}>
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
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={closeGroupDialog}
          >
            <Icon name="close" />
          </NoemaButton>
        </div>
        <label className="dialog-field">
          <span>群聊名称</span>
          <NoemaInput
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
              <NoemaCheckbox
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
          <NoemaButton
            className="secondary-action"
            type="button"
            onClick={closeGroupDialog}
          >
            取消
          </NoemaButton>
          <NoemaButton
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
          </NoemaButton>
        </div>
      </form>
    </NoemaOverlay>
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
  | 'newProjectWorkspace'
  | 'chooseProjectWorkspace'
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
    newProjectWorkspace,
    chooseProjectWorkspace,
    projectAgentIds,
    setProjectAgentIds,
    projectBusy,
  } = model;
  return createProjectOpen ? (
    <NoemaOverlay isOpen onClose={closeProjectDialog}>
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
            <h2 id="create-project-title">新建项目</h2>
            <p>群聊讨论，成员在各自的项目会话中执行。</p>
          </div>
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={closeProjectDialog}
          >
            <Icon name="close" />
          </NoemaButton>
        </div>
        <label className="dialog-field">
          <span>项目名称</span>
          <NoemaInput
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
          <span>目标</span>
          <NoemaTextArea
            value={projectBrief}
            maxLength={40000}
            rows={4}
            placeholder="要完成什么，有哪些限制。"
            onChange={(event) => setProjectBrief(event.target.value)}
            required
          />
        </label>
        <div className="dialog-field">
          <span>工作文件夹</span>
          <NoemaButton
            type="button"
            className="project-workspace-picker"
            onClick={() => void chooseProjectWorkspace()}
            disabled={projectBusy}
          >
            <Icon name="folder-open" />
            <span>{newProjectWorkspace?.workspacePath ?? '选择文件夹'}</span>
          </NoemaButton>
          <small>成员可在这里读写文件。</small>
        </div>
        <fieldset className="group-agent-picker">
          <legend>初始成员</legend>
          {activeAgents
            .filter((agent) => agent.id !== 'noema')
            .map((agent) => (
              <label key={agent.id} className="group-agent-option">
                <NoemaCheckbox
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
          <NoemaButton
            className="secondary-action"
            type="button"
            onClick={closeProjectDialog}
          >
            取消
          </NoemaButton>
          <NoemaButton
            className="primary-action"
            type="submit"
            disabled={
              projectBusy ||
              !projectTitle.trim() ||
              !projectBrief.trim() ||
              !newProjectWorkspace ||
              projectAgentIds.length === 0
            }
          >
            {projectBusy ? '正在建立…' : '建立项目'}
          </NoemaButton>
        </div>
      </form>
    </NoemaOverlay>
  ) : null;
}
