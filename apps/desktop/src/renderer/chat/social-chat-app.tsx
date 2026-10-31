import React from 'react';
import {
  MAX_CHAT_ATTACHMENT_CHARACTERS,
  MAX_CHAT_PDF_ATTACHMENT_BYTES,
} from '../../shared/chat/chat-text-attachments.mjs';
import { ProjectReviewCard } from '../projects/project-review-card';
import { GlobalSearchDialog } from '../search/global-search-dialog';
import { FirstMeeting } from '../onboarding/first-meeting-screen';
import type { NoemaSocialWorkTask } from '../../shared/contracts/noema-bridge.d.ts';
import { dayLabel, projectStatusLabel, Icon, AgentMark } from './presentation';
import { ChatMessage, ProjectWorkCard } from './messages';
import { useSocialChatController } from './use-social-chat-controller';
import { WorkspacePanels } from './workspaces';
import {
  ConversationSearchDialog,
  ForwardMessageDialog,
} from './dialogs/message-dialogs';
import {
  AgentEditorDialog,
  GroupEditorDialog,
  ProjectEditorDialog,
} from './dialogs/team-dialogs';
import { PartnerSettingsDialog } from '../settings/partner-settings-dialog';

export function SocialChatApp() {
  const controller = useSocialChatController();
  const {
    messageAgent,
    handleStopProjectWork,
    handleResumeProjectWork,
    handleDisableCaseReuse,
    handleWithdrawPracticeCandidate,
    projects,
    openProjectMemberSession,
    rooms,
    selectRoom,
    setReplyTarget,
    cancelForward,
    setRoomDraft,
    draftRef,
    conversationTurns,
    navigation,
    showRoomList,
    projectWorkspace,
    agentWorkspace,
    archivedProjectsOpen,
    providerReady,
    activeProject,
    activeProjectSession,
    currentRoom,
    forwardSelectionActive,
    currentRecipient,
    currentRecipientArchived,
    draft,
    draftAttachments,
    busy,
    roomState,
    noemaRoom,
    conversationRef,
    shouldFollowRef,
    setShowJumpToLatest,
    members,
    viewingProjectSession,
    messages,
    workTasks,
    firstMeetingEntryVisible,
    setState,
    handleRetry,
    openHistorySource,
    selectedForwardMessageIds,
    beginForwardSelection,
    childThreads,
    toggleForwardMessage,
    draftsByRoom,
    submitProjectReview,
    activeReply,
    showJumpToLatest,
    handleSend,
    notice,
    setNotice,
    providerWarning,
    setSettingsOpen,
    state,
    threadTriggerRef,
    openThreadDialog,
    openForwardDialog,
    replyTarget,
    currentQueuePaused,
    currentRoomQueue,
    resumeCurrentQueue,
    handleStop,
    setQueuedMessagesByRoom,
    groupDraftRef,
    removeDraftAttachment,
    setDraft,
    handleComposerKeyDown,
    attachmentInputRef,
    addDraftAttachments,
    activeRoute,
    activeModel,
    shellRef,
    setShowRoomList,
    globalSearchTriggerRef,
    openGlobalSearch,
    windowMaximized,
    setWindowMaximized,
    searchRef,
    navigationSearch,
    setNavigationSearch,
    renderRoomListItem,
    memberRooms,
    otherConversationRooms,
    activeProjects,
    projectWorkspaceId,
    openProject,
    setArchivedProjectsOpen,
    setProjectWorkspaceId,
    setAgentWorkspaceId,
    archivedProjects,
    settingsTriggerRef,
    setProjectTab,
    searchTriggerRef,
    openConversationSearch,
    openAgentWorkspace,
    setPendingScrollMessageId,
    handleThreadStatus,
    threadStatusBusy,
    handleDeleteThread,
    agents,
    globalSearchOpen,
    dialogRef,
    closeGlobalSearch,
    openGlobalSearchSource,
    firstMeetingReplay,
    setFirstMeetingReplay,
    threadDialogOpen,
    threadBusy,
    closeThreadDialog,
    handleCreateThread,
    threadTitle,
    setThreadTitle,
  } = controller;
  const renderProjectWorkCard = (task: NoemaSocialWorkTask) => (
    <ProjectWorkCard
      key={task.id}
      task={task}
      agent={messageAgent.get(task.agentId) ?? null}
      onStop={() => void handleStopProjectWork(task)}
      onResume={() => void handleResumeProjectWork(task)}
      onDisableCase={() => void handleDisableCaseReuse(task)}
      onWithdrawPractice={() => void handleWithdrawPracticeCandidate(task)}
      onRepeat={() => {
        const project = projects.find((candidate) =>
          candidate.members.some(
            (member) => member.sessionRoomId === task.roomId,
          ),
        );
        if (project) void openProjectMemberSession(project, task.agentId);
        else {
          const sourceRoom = rooms.find((room) => room.id === task.roomId);
          if (sourceRoom) selectRoom(sourceRoom);
        }
        setReplyTarget(null);
        cancelForward();
        setRoomDraft(task.roomId, task.taskPrompt);
        requestAnimationFrame(() => draftRef.current?.focus());
      }}
    />
  );
  const turnDate = (turn: (typeof conversationTurns)[number] | undefined) => {
    const first = turn?.items[0];
    return first
      ? first.kind === 'message'
        ? first.message.createdAt
        : first.task.createdAt
      : '';
  };
  const navigationHidden = navigation.narrow
    ? !showRoomList
    : navigation.collapsed;
  const workspaceOpen = Boolean(
    projectWorkspace || agentWorkspace || archivedProjectsOpen,
  );
  const composerDisabled =
    !providerReady ||
    Boolean(
      activeProject &&
      (activeProject.status === 'archived' ||
        (activeProjectSession &&
          activeProject.members.find(
            (member) => member.agentId === activeProjectSession.agentId,
          )?.status !== 'active')),
    ) ||
    Boolean(currentRoom?.closedAt) ||
    forwardSelectionActive ||
    !currentRecipient ||
    currentRecipientArchived;
  const sendDisabled =
    composerDisabled ||
    (!draft.trim() && draftAttachments.length === 0) ||
    busy;
  const conversationContent =
    currentRoom && roomState?.room.id === currentRoom.id ? (
      <>
        <div
          className={`${currentRoom.id === noemaRoom?.id ? 'chat-scroll' : 'session-scroll'} message-thread`}
          data-room-id={currentRoom.id}
          ref={conversationRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            shouldFollowRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              60;
            setShowJumpToLatest(!shouldFollowRef.current);
          }}
          aria-live="polite"
          aria-relevant="additions text"
        >
          {currentRoom.id !== noemaRoom?.id &&
          members[0]?.kind === 'specialist' ? (
            <div className="session-label">
              {viewingProjectSession
                ? `${activeProject?.title ?? '项目'} / 此成员的项目工作会话`
                : '日常私聊 / 与项目工作会话分开'}
            </div>
          ) : null}
          {!messages.some((message) => message.role !== 'system') &&
          workTasks.length === 0 ? (
            <div
              className={`empty-chat${currentRoom.id === noemaRoom?.id ? ' noema-start-message' : ''}`}
              aria-label="空对话"
            >
              {currentRoom.id === noemaRoom?.id ? (
                firstMeetingEntryVisible ? (
                  <FirstMeeting
                    onRead={async () => {
                      const progress =
                        await window.noema.advanceFirstMeeting('read');
                      setState((current) =>
                        current
                          ? { ...current, firstMeeting: progress }
                          : current,
                      );
                    }}
                  />
                ) : (
                  <p>你与 Noema 的对话</p>
                )
              ) : (
                <span>
                  {currentRoom.kind === 'group'
                    ? '群聊记录从这里开始'
                    : `${currentRoom.title} · 新对话`}
                </span>
              )}
            </div>
          ) : (
            <div
              className={`${currentRoom.id === noemaRoom?.id ? 'chat-body' : 'session-body'} message-sequence`}
              data-room-kind={currentRoom.kind}
            >
              {conversationTurns.map((turn, turnIndex) => (
                <section
                  className="conversation-turn"
                  data-conversation-turn={turn.id}
                  key={turn.id}
                >
                  {dayLabel(turnDate(turn)) !==
                  dayLabel(turnDate(conversationTurns[turnIndex - 1])) ? (
                    <div className="dayline">{dayLabel(turnDate(turn))}</div>
                  ) : null}
                  {turn.items.map((item) =>
                    item.kind === 'message' ? (
                      <React.Fragment key={item.id}>
                        <ChatMessage
                          message={item.message}
                          showNoemaMark={currentRoom.id === noemaRoom?.id}
                          continuationOrigin={Boolean(
                            currentRoom.parentRoomId &&
                            item.message.forwardedSources.some(
                              (source) =>
                                source.id === currentRoom.originMessageId,
                            ),
                          )}
                          roomClosed={Boolean(currentRoom.closedAt)}
                          agent={
                            item.message.agentId
                              ? (messageAgent.get(item.message.agentId) ?? null)
                              : null
                          }
                          onRetry={handleRetry}
                          onOpenHistorySource={openHistorySource}
                          forwardSelectionActive={forwardSelectionActive}
                          forwardSelected={selectedForwardMessageIds.includes(
                            item.message.id,
                          )}
                          onReply={() => {
                            const forwardedText = item.message.forwardedSources
                              .map(
                                (source) =>
                                  `${source.sender}：${source.content}`,
                              )
                              .join('\n');
                            setReplyTarget({
                              id: item.message.id,
                              roomId: currentRoom.id,
                              role: item.message.role as 'user' | 'assistant',
                              sender: item.message.senderAgentId
                                ? (messageAgent.get(item.message.senderAgentId)
                                    ?.name ?? 'Noema')
                                : item.message.role === 'user'
                                  ? '你'
                                  : (messageAgent.get(
                                      item.message.agentId ?? '',
                                    )?.name ?? '联系人'),
                              createdAt: item.message.createdAt,
                              content: forwardedText || item.message.content,
                            });
                            draftRef.current?.focus();
                          }}
                          onForward={() => beginForwardSelection(item.message)}
                          continuationThreads={childThreads.filter(
                            (thread) =>
                              thread.originMessageId === item.message.id,
                          )}
                          onOpenContinuation={(thread) => selectRoom(thread)}
                          onToggleForward={() =>
                            toggleForwardMessage(item.message)
                          }
                        />
                        {(roomState.projectReviews ?? [])
                          .filter(
                            (review) =>
                              review.requestMessageId === item.message.id,
                          )
                          .map((review) => (
                            <ProjectReviewCard
                              key={review.id}
                              review={review}
                              draft={draftsByRoom[`review:${review.id}`] ?? ''}
                              onDraftChange={(value) =>
                                setRoomDraft(`review:${review.id}`, value)
                              }
                              onSubmit={() => submitProjectReview(review)}
                              disabled={
                                !providerReady || busy || Boolean(activeReply)
                              }
                            />
                          ))}
                        {item.tasks.map(renderProjectWorkCard)}
                      </React.Fragment>
                    ) : (
                      renderProjectWorkCard(item.task)
                    ),
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
        <button
          className="jump-latest"
          type="button"
          hidden={!showJumpToLatest}
          onClick={() => {
            const scroll = conversationRef.current;
            if (scroll) {
              shouldFollowRef.current = true;
              scroll.scrollTop = scroll.scrollHeight;
            }
            setShowJumpToLatest(false);
          }}
        >
          回到最新消息 ↓
        </button>
        <form
          className="composer message-composer"
          onSubmit={(event) => void handleSend(event)}
        >
          <div className="composer-inner">
            {notice ? (
              <div className="inline-notice" role="status">
                <span>{notice}</span>
                <button
                  type="button"
                  onClick={() => setNotice('')}
                  aria-label="关闭提示"
                >
                  <Icon name="close" />
                </button>
              </div>
            ) : null}

            {currentRoom.kind === 'direct' && members[0]?.archivedAt ? (
              <div className="archived-agent-notice" role="status">
                <span>
                  {members[0].name}
                  已归档。历史记录仍可查看；恢复后才能继续聊天。
                </span>
              </div>
            ) : null}

            {!providerReady ? (
              <div className="provider-warning" role="status">
                <span>{providerWarning}</span>
                <button type="button" onClick={() => setSettingsOpen(true)}>
                  {state?.providerConfigured ? '检查设置' : '连接模型'}
                </button>
              </div>
            ) : null}

            {forwardSelectionActive ? (
              <div className="forward-selection-toolbar" role="status">
                <span>
                  已选 {selectedForwardMessageIds.length} 条消息
                  <small>按时间顺序合并转发</small>
                </span>
                <button type="button" onClick={cancelForward}>
                  取消
                </button>
                <button
                  type="button"
                  ref={threadTriggerRef}
                  className="secondary-action"
                  onClick={openThreadDialog}
                  disabled={
                    !selectedForwardMessageIds.length ||
                    currentRoom.kind !== 'direct' ||
                    currentRoom.memberIds[0] !== 'noema' ||
                    Boolean(currentRoom.parentRoomId)
                  }
                  title="把选中的消息作为来源，在 Noema 私聊下开一条主题聊天"
                >
                  开主题
                </button>
                <button
                  type="button"
                  className="primary-action"
                  onClick={openForwardDialog}
                  disabled={!selectedForwardMessageIds.length}
                >
                  选择目标聊天
                </button>
              </div>
            ) : null}

            {replyTarget ? (
              <div className="draft-quote">
                <span>
                  引用 {replyTarget.sender}：
                  {replyTarget.content.replace(/\s+/gu, ' ').slice(0, 150)}
                </span>
                <button
                  type="button"
                  aria-label="取消引用"
                  onClick={() => {
                    setReplyTarget(null);
                    requestAnimationFrame(() => draftRef.current?.focus());
                  }}
                >
                  ×
                </button>
              </div>
            ) : null}

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
                          setRoomDraft(currentRoom!.id, queued.text);
                          setReplyTarget(null);
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
                            (currentRoom?.kind === 'group'
                              ? groupDraftRef.current
                              : draftRef.current
                            )?.focus(),
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

            {draftAttachments.length ? (
              <div className="composer-files" aria-label="待发送文字附件">
                {draftAttachments.map((file, index) => (
                  <span
                    className="attachment-chip"
                    key={`${file.name}-${file.lastModified}-${index}`}
                  >
                    <span className="file-name" title={file.name}>
                      {file.name}
                    </span>
                    <button
                      type="button"
                      aria-label={`移除附件 ${file.name}`}
                      onClick={() => removeDraftAttachment(index)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="composer-field">
              <label className="visually-hidden" htmlFor="social-message-input">
                {currentRoom.kind === 'group'
                  ? '在群聊中发送消息'
                  : `给${currentRecipient?.name ?? '联系人'}发送消息`}
              </label>
              <textarea
                id="social-message-input"
                ref={draftRef}
                value={draft}
                rows={2}
                placeholder={
                  currentRoom.kind === 'group'
                    ? `发到群聊；输入 @成员名 指定回应`
                    : currentRoom.id === noemaRoom?.id
                      ? '说说你正在想的事…'
                      : `发给${currentRecipient?.name ?? '联系人'}…`
                }
                onChange={(event) => {
                  setDraft(event.target.value);
                  event.currentTarget.style.height = 'auto';
                  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px`;
                }}
                onKeyDown={handleComposerKeyDown}
                disabled={composerDisabled}
              />
              <input
                ref={attachmentInputRef}
                className="visually-hidden"
                type="file"
                multiple
                accept=".txt,.md,.csv,.pdf,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,text/csv,application/pdf,image/png,image/jpeg,image/webp"
                aria-label="选择附件"
                onChange={(event) => {
                  addDraftAttachments(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
              />
              <button
                className="icon-button attach-button"
                type="button"
                aria-label="添加附件"
                title={`发送 TXT、Markdown 或 CSV（每个 256 KiB 内），或文字 PDF（${Math.round(MAX_CHAT_PDF_ATTACHMENT_BYTES / 1024 / 1024)} MiB、40 页、提取文字不超过 ${MAX_CHAT_ATTACHMENT_CHARACTERS.toLocaleString('zh-CN')} 字）；扫描件和图片暂不支持。每条最多 5 个。`}
                disabled={composerDisabled}
                onClick={() => attachmentInputRef.current?.click()}
              >
                <Icon name="attach" />
              </button>
              <button
                className="send send-message-button"
                type="submit"
                aria-label={activeReply ? '加入发送队列' : '发送消息'}
                title={activeReply ? '加入当前对话的发送队列' : '发送消息'}
                disabled={sendDisabled}
              >
                <Icon name="send" />
              </button>
            </div>
            <div className="composer-hint">
              <span>
                {draftAttachments.length
                  ? `${draftAttachments.length} 个文字附件会随本条消息进入模型上下文`
                  : 'Enter 发送 · Shift + Enter 换行'}
              </span>
              <span>{activeRoute?.label || activeModel || '尚未连接模型'}</span>
            </div>
          </div>
        </form>
      </>
    ) : (
      <div className="empty-chat" role="status">
        正在打开聊天…
      </div>
    );
  return (
    <main
      className={`social-shell app layout-c${workspaceOpen ? ' has-workspace' : ''}${navigationHidden ? ' index-closed' : ''}${navigation.narrow ? ' narrow-shell' : ''}${navigation.dragging ? ' resizing' : ''}`}
      ref={shellRef}
    >
      <header className="window-head social-topbar" aria-label="应用导航">
        <div className="wordmark">
          <button
            className="index-toggle navigation-reveal"
            type="button"
            aria-controls="conversation-navigation"
            aria-label={navigationHidden ? '展开导航' : '收起导航'}
            aria-expanded={!navigationHidden}
            onClick={() => {
              if (navigation.narrow) setShowRoomList((open) => !open);
              else if (navigation.collapsed) navigation.reveal();
              else navigation.collapse();
            }}
          >
            <Icon name="menu" />
          </button>
          <span className="logo">
            <Icon name="noema" />
          </span>
          <span>noema</span>
        </div>
        <div className="window-tools">
          <button
            ref={globalSearchTriggerRef}
            type="button"
            className="icon-button global-search-trigger"
            title="全局搜索 · Ctrl+K"
            aria-label="全局搜索（Ctrl+K）"
            onClick={openGlobalSearch}
          >
            <Icon name="search" />
          </button>
          <div className="window-controls" aria-label="窗口控件">
            <button
              className="window-control"
              type="button"
              title="最小化"
              aria-label="最小化"
              onClick={() => void window.noema.controlWindow('minimize')}
            >
              <svg viewBox="0 0 16 16">
                <path d="M3 8h10" />
              </svg>
            </button>
            <button
              className="window-control"
              type="button"
              title={windowMaximized ? '还原窗口' : '最大化'}
              aria-label={windowMaximized ? '还原窗口' : '最大化'}
              onClick={() =>
                void window.noema
                  .controlWindow('maximize')
                  .then(setWindowMaximized)
              }
            >
              <svg viewBox="0 0 16 16">
                {windowMaximized ? (
                  <path d="M5 3h8v8M3 5h8v8H3Z" />
                ) : (
                  <rect x="3" y="3" width="10" height="10" />
                )}
              </svg>
            </button>
            <button
              className="window-control close-control"
              type="button"
              title="关闭窗口"
              aria-label="关闭窗口"
              onClick={() => void window.noema.controlWindow('close')}
            >
              <svg viewBox="0 0 16 16">
                <path d="m3 3 10 10M13 3 3 13" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <div
        ref={navigation.containerRef}
        className={`shell social-body${navigation.collapsed ? ' navigation-collapsed' : ''}${navigation.dragging ? ' navigation-resizing' : ''}`}
        style={
          {
            ...navigation.style,
            '--index-width': `${navigation.width}px`,
          } as React.CSSProperties
        }
      >
        <button
          className="index-shade"
          type="button"
          aria-label="收起导航"
          onClick={() => setShowRoomList(false)}
        />
        <aside
          className="index conversation-sidebar"
          id="conversation-navigation"
          aria-label="成员和项目索引"
          inert={navigationHidden}
        >
          <label className="index-search chat-search">
            <Icon name="search" />
            <input
              ref={searchRef}
              type="search"
              value={navigationSearch}
              aria-label="搜索成员或项目"
              placeholder="搜索成员或项目"
              onChange={(event) => setNavigationSearch(event.target.value)}
            />
          </label>
          <div className="section-title">与你对话</div>
          {noemaRoom ? renderRoomListItem(noemaRoom) : null}
          <div className="section-title">
            <span>成员</span>
            <span>{memberRooms.length}</span>
          </div>
          <nav aria-label="成员">
            {memberRooms.map((room) => renderRoomListItem(room))}
          </nav>
          {otherConversationRooms.length ? (
            <>
              <div className="section-title">
                <span>其他聊天</span>
              </div>
              <nav aria-label="其他聊天">
                {otherConversationRooms.map((room) => renderRoomListItem(room))}
              </nav>
            </>
          ) : null}
          <div className="section-title">
            <span>项目</span>
            <span>{activeProjects.length}</span>
          </div>
          <nav aria-label="项目">
            {activeProjects.map((project) => (
              <button
                type="button"
                className={`index-item project-list-item ${projectWorkspaceId === project.id ? 'selected' : ''}`}
                key={project.id}
                aria-current={
                  projectWorkspaceId === project.id ? 'page' : undefined
                }
                onClick={() => void openProject(project)}
              >
                <span className="project-icon">
                  <Icon name="project" />
                </span>
                <span>
                  <span className="item-title">{project.title}</span>
                  <small>{projectStatusLabel(project)}</small>
                </span>
              </button>
            ))}
          </nav>
          {!activeProjects.length ? (
            <div className="index-empty-state">当前没有活跃项目</div>
          ) : null}
          <button
            type="button"
            className="bottom-link"
            onClick={() => {
              setArchivedProjectsOpen(true);
              setProjectWorkspaceId(null);
              setAgentWorkspaceId(null);
              setShowRoomList(false);
            }}
          >
            <Icon name="archive" />{' '}
            <span>已归档项目 · {archivedProjects.length}</span>
          </button>
          <div className="section-title">个人</div>
          <button
            className="bottom-link sidebar-settings-button"
            ref={settingsTriggerRef}
            type="button"
            aria-label="连接与模型设置"
            onClick={() => setSettingsOpen(true)}
          >
            伙伴设置
          </button>
        </aside>
        <div
          className="index-resizer navigation-resize-handle"
          role="separator"
          tabIndex={navigation.narrow || navigation.collapsed ? -1 : 0}
          aria-label="调整导航宽度"
          aria-controls="conversation-navigation"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={navigation.widthLimit}
          aria-valuenow={
            navigation.collapsed ? 0 : Math.round(navigation.width)
          }
          {...navigation.separatorProps}
        />
        <section
          className="chat conversation-panel"
          aria-label="当前聊天"
          inert={navigation.narrow && showRoomList}
        >
          <header
            className={`${currentRoom?.id === noemaRoom?.id ? 'pane-head' : 'work-head'} room-header`}
          >
            <div
              className={
                currentRoom?.id === noemaRoom?.id ? 'identity' : 'work-title'
              }
            >
              {currentRoom?.id !== noemaRoom?.id ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={
                    viewingProjectSession ? '返回项目空间' : '返回 Noema 主聊'
                  }
                  onClick={() => {
                    if (viewingProjectSession && activeProject) {
                      void openProject(activeProject).then(() =>
                        setProjectTab('members'),
                      );
                    } else if (noemaRoom) selectRoom(noemaRoom);
                  }}
                >
                  <Icon name="back" />
                </button>
              ) : null}
              {members[0] && currentRoom?.id === noemaRoom?.id ? (
                <AgentMark agent={members[0]} />
              ) : null}
              <div className="chat-header-title">
                <strong>
                  {viewingProjectSession
                    ? members[0]?.name
                    : currentRoom?.title || 'Noema'}
                </strong>
                <small>
                  {viewingProjectSession
                    ? `${activeProject?.title ?? '项目'} · 项目会话`
                    : currentRoom?.kind === 'group'
                      ? `${members.map((member) => member.name).join(' · ')} 与你`
                      : currentRoom?.id === noemaRoom?.id
                        ? '与你的持续对话'
                        : '常驻私聊'}
                </small>
              </div>
            </div>
            <div className="pane-actions">
              <button
                className="icon-button"
                type="button"
                ref={searchTriggerRef}
                aria-label="查找当前对话"
                title="查找当前对话"
                onClick={openConversationSearch}
              >
                <Icon name="search" />
              </button>
              {members[0]?.kind === 'specialist' ? (
                <button
                  className="quiet"
                  type="button"
                  aria-label="成员资料"
                  title="成员资料"
                  onClick={() => openAgentWorkspace(members[0].id)}
                >
                  资料
                </button>
              ) : null}
            </div>
          </header>
          {currentRoom?.parentRoomId ? (
            <div className="note-row">
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  const parent = rooms.find(
                    (room) => room.id === currentRoom.parentRoomId,
                  );
                  if (parent) {
                    selectRoom(parent);
                    setPendingScrollMessageId(currentRoom.originMessageId);
                  }
                }}
              >
                回到来源消息
              </button>{' '}
              · {currentRoom.closedAt ? '已结束' : '持续主题'}{' '}
              <button
                type="button"
                className="quiet"
                onClick={() => void handleThreadStatus(!currentRoom.closedAt)}
                disabled={threadStatusBusy}
              >
                {currentRoom.closedAt ? '重新打开' : '结束主题'}
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => void handleDeleteThread()}
                disabled={threadStatusBusy}
              >
                删除
              </button>
            </div>
          ) : null}
          {!workspaceOpen ? (
            currentRoom?.id === noemaRoom?.id ? (
              conversationContent
            ) : (
              <div className="session-content">{conversationContent}</div>
            )
          ) : null}
        </section>
        <section
          className="workspace"
          aria-label="当前工作内容"
          inert={navigation.narrow && showRoomList}
        >
          <WorkspacePanels
            model={controller}
            composerDisabled={composerDisabled}
            sendDisabled={sendDisabled}
            renderProjectWorkCard={renderProjectWorkCard}
          />
        </section>
      </div>
      {globalSearchOpen ? (
        <GlobalSearchDialog
          dialogRef={dialogRef}
          agents={agents}
          projects={projects}
          onClose={closeGlobalSearch}
          onAgent={async (agent) => {
            const room = rooms.find(
              (room) =>
                room.kind === 'direct' &&
                !room.parentRoomId &&
                room.memberIds.includes(agent.id),
            );
            if (!room) throw new Error('联系人聊天暂不可用。');
            await openGlobalSearchSource(room.id);
          }}
          onProject={async (project) => {
            await openGlobalSearchSource(project.groupRoomId);
            setProjectTab('delivery');
          }}
          onMessage={async (message) => {
            await openGlobalSearchSource(message.roomId, message);
          }}
        />
      ) : null}
      <ConversationSearchDialog model={controller} />
      {firstMeetingReplay ? (
        <FirstMeeting
          mode="replay"
          onRead={async () => {
            const progress = await window.noema.advanceFirstMeeting('read');
            setState((current) =>
              current ? { ...current, firstMeeting: progress } : current,
            );
          }}
          onClose={() => setFirstMeetingReplay(false)}
        />
      ) : null}
      <ForwardMessageDialog model={controller} />

      {threadDialogOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !threadBusy)
              closeThreadDialog();
          }}
        >
          <form
            ref={dialogRef}
            className="social-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="continuation-title"
            onSubmit={(event) => void handleCreateThread(event)}
          >
            <div className="dialog-heading">
              <div>
                <h2 id="continuation-title">另开一条主题聊天</h2>
                <p>选中的原话会作为可见来源放在新聊天开头。</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭"
                onClick={closeThreadDialog}
                disabled={threadBusy}
              >
                <Icon name="close" />
              </button>
            </div>
            <label className="dialog-field">
              <span>主题名称</span>
              <input
                value={threadTitle}
                onChange={(event) => setThreadTitle(event.target.value)}
                maxLength={80}
                required
                data-dialog-initial-focus
              />
            </label>
            <p className="dialog-footnote">
              这是同一个 Noema
              的独立聊天。创建不会调用模型，也不会带入来源聊天的其他记录。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={closeThreadDialog}
                disabled={threadBusy}
              >
                取消
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={threadBusy || !threadTitle.trim()}
              >
                {threadBusy ? '正在创建…' : '创建主题'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <AgentEditorDialog model={controller} />

      <GroupEditorDialog model={controller} />

      <ProjectEditorDialog model={controller} />

      <PartnerSettingsDialog model={controller} />
    </main>
  );
}
