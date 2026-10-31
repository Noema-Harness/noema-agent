import type { ReactNode } from 'react';
import type { NoemaSocialWorkTask } from '../../shared/contracts/noema-bridge.d.ts';
import { ProjectPlanPanel } from '../projects/project-plan-panel';
import {
  projectHasFinalizationIssue,
  projectFinalizationIssueNames,
  projectStatusLabel,
  Icon,
  AgentMark,
} from './presentation';
import { GroupMessage } from './messages';
import type { SocialChatController } from './use-social-chat-controller';

type WorkspacePanelsModel = Pick<
  SocialChatController,
  | 'messageAgent'
  | 'projects'
  | 'openProjectMemberSession'
  | 'rooms'
  | 'selectRoom'
  | 'setRoomDraft'
  | 'projectWorkspace'
  | 'agentWorkspace'
  | 'archivedProjectsOpen'
  | 'providerReady'
  | 'currentRoom'
  | 'draft'
  | 'noemaRoom'
  | 'conversationRef'
  | 'shouldFollowRef'
  | 'messages'
  | 'handleRetry'
  | 'activeReply'
  | 'handleSend'
  | 'notice'
  | 'setNotice'
  | 'providerWarning'
  | 'setSettingsOpen'
  | 'state'
  | 'currentQueuePaused'
  | 'currentRoomQueue'
  | 'resumeCurrentQueue'
  | 'handleStop'
  | 'setQueuedMessagesByRoom'
  | 'groupDraftRef'
  | 'setDraft'
  | 'openProject'
  | 'setAgentWorkspaceId'
  | 'archivedProjects'
  | 'setProjectTab'
  | 'setPendingScrollMessageId'
  | 'projectTab'
  | 'agents'
  | 'projectStatusBusy'
  | 'retryProjectGrowthMember'
  | 'openProjectEvidenceMessage'
  | 'projectSessionTasks'
  | 'projectSessionState'
  | 'loadProjectSessions'
  | 'restoreCurrentProject'
  | 'archiveCurrentProject'
  | 'agentWorkspaceProject'
  | 'updatingAgentId'
  | 'handleToggleAgentProjectWork'
  | 'openAgentProfileEditor'
  | 'handleToggleAgentArchive'
>;
export function WorkspacePanels({
  model,
  composerDisabled,
  sendDisabled,
  renderProjectWorkCard,
}: {
  model: WorkspacePanelsModel;
  composerDisabled: boolean;
  sendDisabled: boolean;
  renderProjectWorkCard: (task: NoemaSocialWorkTask) => ReactNode;
}) {
  const {
    messageAgent,
    projects,
    openProjectMemberSession,
    rooms,
    selectRoom,
    setRoomDraft,
    projectWorkspace,
    agentWorkspace,
    archivedProjectsOpen,
    providerReady,
    currentRoom,
    draft,
    noemaRoom,
    conversationRef,
    shouldFollowRef,
    messages,
    handleRetry,
    activeReply,
    handleSend,
    notice,
    setNotice,
    providerWarning,
    setSettingsOpen,
    state,
    currentQueuePaused,
    currentRoomQueue,
    resumeCurrentQueue,
    handleStop,
    setQueuedMessagesByRoom,
    groupDraftRef,
    setDraft,
    openProject,
    setAgentWorkspaceId,
    archivedProjects,
    setProjectTab,
    setPendingScrollMessageId,
    projectTab,
    agents,
    projectStatusBusy,
    retryProjectGrowthMember,
    openProjectEvidenceMessage,
    projectSessionTasks,
    projectSessionState,
    loadProjectSessions,
    restoreCurrentProject,
    archiveCurrentProject,
    agentWorkspaceProject,
    updatingAgentId,
    handleToggleAgentProjectWork,
    openAgentProfileEditor,
    handleToggleAgentArchive,
  } = model;
  return projectWorkspace ? (
    <>
      <header className="work-head">
        <div className="work-title">
          <button
            className="icon-button"
            type="button"
            aria-label="返回 Noema 主聊"
            onClick={() => {
              if (noemaRoom) selectRoom(noemaRoom);
            }}
          >
            <Icon name="back" />
          </button>
          <div>
            <strong>{projectWorkspace.title}</strong>
            <small>
              {projectWorkspace.growthBatch &&
              projectWorkspace.status !== 'archived'
                ? '项目空间'
                : `项目空间 · ${projectStatusLabel(projectWorkspace)}`}
            </small>
          </div>
        </div>
      </header>
      <nav className="work-tabs" aria-label="项目视图">
        {(['delivery', 'group', 'members'] as const).map((tab, index) => (
          <button
            type="button"
            key={tab}
            className={projectTab === tab ? 'active' : ''}
            aria-pressed={projectTab === tab}
            onClick={() => setProjectTab(tab)}
          >
            {
              ['交付', '共同讨论', `成员 · ${projectWorkspace.members.length}`][
                index
              ]
            }
          </button>
        ))}
      </nav>
      {projectTab === 'group' ? (
        <div
          className="work-content"
          ref={conversationRef}
          data-room-id={currentRoom?.id}
          onScroll={(event) => {
            const scroll = event.currentTarget;
            shouldFollowRef.current =
              scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
          }}
        >
          <div className="discussion">
            <p className="lead">
              共同讨论与项目决定在这里；成员的完整执行过程在各自的工作会话中。
            </p>
            {messages.map((message) => (
              <GroupMessage
                key={message.id}
                message={message}
                queuedAgentName={
                  message.deliveryAgentIds?.length
                    ? message.deliveryAgentIds
                        .map((id) => messageAgent.get(id)?.name ?? '成员')
                        .join('、')
                    : message.deliveryAgentId
                      ? (messageAgent.get(message.deliveryAgentId)?.name ??
                        '成员')
                      : null
                }
                agent={
                  (message.senderAgentId ?? message.agentId)
                    ? (messageAgent.get(
                        message.senderAgentId ?? message.agentId ?? '',
                      ) ?? null)
                    : null
                }
                onRetry={handleRetry}
              />
            ))}
            {notice ? (
              <div className="note-row" role="status">
                {notice}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => setNotice('')}
                >
                  关闭
                </button>
              </div>
            ) : null}
            <div className="note-row">
              {projectWorkspace.status === 'archived'
                ? '归档历史仅供查看；恢复项目后可继续讨论。'
                : providerReady
                  ? '群消息对全体成员可见；@成员名指定回应，无 @ 的消息保留为未读背景。'
                  : providerWarning}
              {!providerReady ? (
                <button
                  className="quiet"
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                >
                  连接模型
                </button>
              ) : null}
            </div>
            {activeReply || currentQueuePaused ? (
              <div className="runtime-status" role="status">
                <span>
                  {currentQueuePaused
                    ? `队列已暂停 · ${currentRoomQueue.length} 条未发送`
                    : `正在回复 · ${messageAgent.get(activeReply?.agentId ?? '')?.name ?? 'Noema'}`}
                </span>
                {currentQueuePaused ? (
                  <button type="button" onClick={resumeCurrentQueue}>
                    继续队列
                  </button>
                ) : (
                  <button type="button" onClick={() => void handleStop()}>
                    停止回复
                  </button>
                )}
              </div>
            ) : null}
            {currentRoomQueue.length ? (
              <div className="queue-list" aria-label="当前对话的待发消息">
                {currentRoomQueue.map((queued) => (
                  <div className="queue-row" key={queued.id}>
                    <div className="queue-text">
                      {queued.text}
                      <small>
                        {queued.error
                          ? `发送失败：${queued.error}`
                          : '尚未发送 · 只属于当前对话'}
                      </small>
                    </div>
                    <div className="queue-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setRoomDraft(queued.roomId, queued.text);
                          setQueuedMessagesByRoom((current) => {
                            const remaining = (
                              current[queued.roomId] ?? []
                            ).filter((item) => item.id !== queued.id);
                            const next = { ...current };
                            if (remaining.length)
                              next[queued.roomId] = remaining;
                            else delete next[queued.roomId];
                            return next;
                          });
                          requestAnimationFrame(() =>
                            groupDraftRef.current?.focus(),
                          );
                        }}
                      >
                        撤回到输入框
                      </button>
                      {queued.error ? (
                        <button
                          type="button"
                          onClick={() => {
                            setQueuedMessagesByRoom((current) => ({
                              ...current,
                              [queued.roomId]: (
                                current[queued.roomId] ?? []
                              ).map((item) =>
                                item.id === queued.id
                                  ? { ...item, error: null }
                                  : item,
                              ),
                            }));
                            resumeCurrentQueue();
                          }}
                        >
                          重试
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <form
              className="group-form"
              onSubmit={(event) => void handleSend(event)}
            >
              <input
                ref={groupDraftRef}
                aria-label="在项目群中发消息"
                placeholder="发到项目群；输入 @成员名 指定回应"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={composerDisabled}
              />
              <button className="primary" type="submit" disabled={sendDisabled}>
                {activeReply ? '加入队列' : '发送'}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="work-content">
          {projectTab === 'members' ? (
            <>
              <h2>这次项目的成员</h2>
              <p className="lead">
                同一位持续存在的成员，在这里拥有独立的项目工作会话。
              </p>
              <div className="member-list">
                {projectWorkspace.members.map((member) => {
                  const agent = agents.find(
                    (candidate) => candidate.id === member.agentId,
                  );
                  return (
                    <button
                      type="button"
                      className="member-row"
                      key={member.agentId}
                      disabled={
                        member.status !== 'active' ||
                        Boolean(member.agentArchivedAt)
                      }
                      onClick={() => {
                        if (member.agentId === 'noema') {
                          if (noemaRoom) selectRoom(noemaRoom);
                        } else
                          void openProjectMemberSession(
                            projectWorkspace,
                            member.agentId,
                          );
                      }}
                    >
                      {agent ? (
                        <AgentMark agent={agent} />
                      ) : (
                        <span className="portrait">
                          {member.name.slice(0, 1)}
                        </span>
                      )}
                      <span className="member-name">
                        <strong>{member.name}</strong>
                        <small>
                          {member.agentId === 'noema'
                            ? '协调与阶段把关'
                            : agent?.headline || '项目成员'}
                        </small>
                      </span>
                      <span className="status">
                        {member.status === 'active' ? '打开工作会话' : '已退出'}
                      </span>
                      <Icon name="arrow" />
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {projectWorkspace.status !== 'archived' &&
              projectWorkspace.growthBatch ? (
                <section
                  className={`project-closeout ${projectHasFinalizationIssue(projectWorkspace) ? 'needs-attention' : ''}`}
                  aria-label="项目交付与归档状态"
                  aria-live="polite"
                >
                  <div className="project-closeout-track">
                    <div className="project-closeout-step complete">
                      <span aria-hidden="true">✓</span>
                      <div>
                        <strong>交付完成</strong>
                        <small>计划成果已验收</small>
                      </div>
                    </div>
                    <span
                      className="project-closeout-connector"
                      aria-hidden="true"
                    />
                    <div
                      className={`project-closeout-step ${projectHasFinalizationIssue(projectWorkspace) ? 'attention' : 'current'}`}
                    >
                      <span aria-hidden="true">
                        {projectHasFinalizationIssue(projectWorkspace)
                          ? '!'
                          : '…'}
                      </span>
                      <div>
                        <strong>项目归档</strong>
                        <small>
                          {projectHasFinalizationIssue(projectWorkspace)
                            ? '需要处理'
                            : '完成收尾后自动进行'}
                        </small>
                      </div>
                    </div>
                  </div>
                  <div className="project-closeout-detail">
                    <p>
                      {projectHasFinalizationIssue(projectWorkspace)
                        ? `${projectFinalizationIssueNames(projectWorkspace).join('、')}尚未完成收尾；项目记录和交付成果仍已保留。`
                        : '团队收尾正在进行。完成后项目会自动归档，群聊、计划与交付记录仍可恢复查看。'}
                    </p>
                    {projectHasFinalizationIssue(projectWorkspace) ? (
                      <div className="project-closeout-actions">
                        {projectWorkspace.growthBatch.members
                          .filter((member) =>
                            ['failed', 'interrupted'].includes(member.status),
                          )
                          .map((member) => {
                            const canRetry =
                              state?.providerConfigured &&
                              Boolean(state.selectedModel);
                            return (
                              <div
                                className="project-closeout-action"
                                key={member.agentId}
                              >
                                <button
                                  className="secondary"
                                  type="button"
                                  disabled={projectStatusBusy || !canRetry}
                                  onClick={() =>
                                    void retryProjectGrowthMember(
                                      projectWorkspace,
                                      member.agentId,
                                    )
                                  }
                                >
                                  继续收尾 · {member.agentName}
                                </button>
                                {!canRetry ? (
                                  <small>连接模型后可继续</small>
                                ) : null}
                              </div>
                            );
                          })}
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : projectWorkspace.status === 'awaiting_user' ? (
                <div className="project-stage">
                  <span className="state-mark" />
                  等待你的反馈
                </div>
              ) : null}
              {projectWorkspace.brief.trim() ? (
                <details className="project-brief">
                  <summary>项目背景与原始委托</summary>
                  <p>{projectWorkspace.brief}</p>
                </details>
              ) : null}
              <ProjectPlanPanel
                key={projectWorkspace.id}
                project={projectWorkspace}
                onOpenGroupMessage={openProjectEvidenceMessage}
              />
              {projectSessionTasks.length
                ? projectSessionTasks.map(renderProjectWorkCard)
                : null}
              {projectSessionState?.loading || projectSessionState?.error ? (
                <section className="project-output-empty" aria-live="polite">
                  <strong>
                    {projectSessionState?.loading
                      ? '正在读取成员工作记录…'
                      : projectSessionState?.error
                        ? projectSessionState.error
                        : '尚无文件任务记录。'}
                  </strong>
                  <p>
                    {projectSessionState?.loading
                      ? '读取各成员独立的项目会话。'
                      : '成员的交流记录可在各自的项目会话中查看。'}
                  </p>
                  {projectSessionState?.error && projectWorkspace ? (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => void loadProjectSessions(projectWorkspace)}
                    >
                      重试读取
                    </button>
                  ) : null}
                </section>
              ) : null}
              <div className="real-project-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setProjectTab('group')}
                >
                  查看共同讨论
                </button>
                {projectWorkspace.status === 'archived' ? (
                  <button
                    className="quiet"
                    type="button"
                    disabled={projectStatusBusy}
                    title="恢复后可继续项目工作"
                    onClick={() => void restoreCurrentProject(projectWorkspace)}
                  >
                    恢复项目
                  </button>
                ) : projectWorkspace.status !== 'awaiting_user' &&
                  projectWorkspace.growthBatch?.status !== 'running' ? (
                  <button
                    className="quiet"
                    type="button"
                    disabled={projectStatusBusy}
                    title="归档后保留项目和成员会话"
                    onClick={() => void archiveCurrentProject(projectWorkspace)}
                  >
                    {projectStatusBusy ? '正在归档…' : '归档项目'}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
      {projectWorkspace.status === 'awaiting_user' ? (
        <div className="review-dock">
          <div>
            Noema 正在等你的评审
            <small>请求保留在与 Noema 的对话中</small>
          </div>
          <div className="dock-actions">
            <button
              className="review-jump"
              type="button"
              onClick={() => {
                const pending = projectWorkspace.pendingReview;
                const room =
                  rooms.find((candidate) => candidate.id === pending?.roomId) ??
                  noemaRoom;
                if (room) {
                  selectRoom(room);
                  if (pending)
                    setPendingScrollMessageId(pending.requestMessageId);
                }
              }}
            >
              {projectWorkspace.pendingReview
                ? '回到评审请求'
                : '回到 Noema 主聊'}{' '}
              <Icon name="arrow" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  ) : agentWorkspace ? (
    <>
      <header className="work-head">
        <div className="work-title">
          <button
            className="icon-button"
            type="button"
            aria-label="返回成员会话"
            onClick={() => {
              const room = rooms.find(
                (candidate) =>
                  candidate.kind === 'direct' &&
                  !candidate.parentRoomId &&
                  candidate.memberIds.length === 1 &&
                  candidate.memberIds[0] === agentWorkspace.id,
              );
              if (room) selectRoom(room);
              else setAgentWorkspaceId(null);
            }}
          >
            <Icon name="back" />
          </button>
          <div>
            <strong>{agentWorkspace.name}</strong>
            <small>成员资料</small>
          </div>
        </div>
      </header>
      <div className="work-content">
        <div className="profile-hero">
          <AgentMark agent={agentWorkspace} />
          <div>
            <h2>{agentWorkspace.name}</h2>
            <p>{agentWorkspace.headline}</p>
          </div>
        </div>
        <div className="profile-detail">
          <p>{agentWorkspace.description}</p>
          <div className="profile-links">
            <button
              className="primary"
              type="button"
              onClick={() => {
                const room = rooms.find(
                  (candidate) =>
                    candidate.kind === 'direct' &&
                    !candidate.parentRoomId &&
                    candidate.memberIds.length === 1 &&
                    candidate.memberIds[0] === agentWorkspace.id,
                );
                if (room) selectRoom(room);
              }}
            >
              打开常驻私聊
            </button>
            <button
              className="secondary"
              type="button"
              disabled={!agentWorkspaceProject}
              title={
                agentWorkspaceProject
                  ? `打开${agentWorkspaceProject.title}中的工作会话`
                  : '该成员还没有加入项目'
              }
              onClick={() => {
                if (agentWorkspaceProject)
                  void openProjectMemberSession(
                    agentWorkspaceProject,
                    agentWorkspace.id,
                  );
              }}
            >
              打开项目工作会话
            </button>
          </div>
          <h3>参与过的工作</h3>
          {projects
            .filter((project) =>
              project.members.some(
                (member) => member.agentId === agentWorkspace.id,
              ),
            )
            .map((project) => (
              <button
                type="button"
                className="history-item"
                key={project.id}
                onClick={() => void openProject(project)}
              >
                <strong>{project.title}</strong>
                <small>
                  {project.status === 'archived' ? '已归档' : '进行中'}
                </small>
              </button>
            ))}
          {!projects.some((project) =>
            project.members.some(
              (member) => member.agentId === agentWorkspace.id,
            ),
          ) ? (
            <p>还没有项目经历。</p>
          ) : null}
          <h3>自己的能力与工作方式</h3>
          <p>{agentWorkspace.headline || '尚未填写专业方向'}</p>
          <div className="asset-row">
            <span>文件项目工作</span>
            <button
              className="quiet"
              type="button"
              disabled={updatingAgentId === agentWorkspace.id}
              onClick={() => void handleToggleAgentProjectWork(agentWorkspace)}
            >
              {agentWorkspace.capabilities.includes('project-work')
                ? '已启用 · 关闭'
                : '未启用 · 开启'}
            </button>
          </div>
          <div className="profile-links">
            <button
              className="quiet"
              type="button"
              onClick={() => openAgentProfileEditor(agentWorkspace)}
            >
              编辑资料
            </button>
            <button
              className="quiet"
              type="button"
              disabled={updatingAgentId === agentWorkspace.id}
              onClick={() => void handleToggleAgentArchive(agentWorkspace)}
            >
              {agentWorkspace.archivedAt ? '恢复联系人' : '归档联系人'}
            </button>
          </div>
        </div>
      </div>
    </>
  ) : archivedProjectsOpen ? (
    <>
      <header className="work-head">
        <div className="work-title">
          <button
            className="icon-button"
            type="button"
            aria-label="返回 Noema 主聊"
            onClick={() => {
              if (noemaRoom) selectRoom(noemaRoom);
            }}
          >
            <Icon name="back" />
          </button>
          <div>
            <strong>已归档项目</strong>
            <small>归档保留记录，恢复沿用原项目会话</small>
          </div>
        </div>
      </header>
      <div className="work-content">
        <h2>可以续接的工作</h2>
        <p className="lead">
          新的需求属于原项目时，从这里恢复；Noema 也可以在对话中替你找到它。
        </p>
        {archivedProjects.map((project) => (
          <button
            type="button"
            className="project-link"
            key={project.id}
            onClick={() => void openProject(project)}
          >
            <Icon name="archive" />
            <span className="link-copy">
              <strong>{project.title}</strong>
              <small>
                已归档 ·{' '}
                {
                  project.members.filter((member) => member.agentId !== 'noema')
                    .length
                }{' '}
                位成员的项目会话保留
              </small>
            </span>
            <Icon name="arrow" />
          </button>
        ))}
        {!archivedProjects.length ? (
          <p className="lead">还没有已归档项目。</p>
        ) : null}
      </div>
    </>
  ) : null;
}
