import { timeLabel, Icon } from '../presentation';
import type { SocialChatController } from '../use-social-chat-controller';

type ConversationSearchDialogModel = Pick<
  SocialChatController,
  | 'messageAgent'
  | 'currentRoom'
  | 'setPendingScrollMessageId'
  | 'dialogRef'
  | 'conversationSearchOpen'
  | 'closeConversationSearch'
  | 'conversationSearchRef'
  | 'conversationSearchQuery'
  | 'setConversationSearchQuery'
  | 'conversationSearchResults'
>;
export function ConversationSearchDialog({
  model,
}: {
  model: ConversationSearchDialogModel;
}) {
  const {
    messageAgent,
    currentRoom,
    setPendingScrollMessageId,
    dialogRef,
    conversationSearchOpen,
    closeConversationSearch,
    conversationSearchRef,
    conversationSearchQuery,
    setConversationSearchQuery,
    conversationSearchResults,
  } = model;
  return conversationSearchOpen ? (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeConversationSearch();
      }}
    >
      <form
        ref={dialogRef}
        className="social-dialog conversation-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-search-title"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="conversation-search-title">查找当前对话</h2>
            <p>
              仅搜索「{currentRoom?.title ?? '当前聊天'}
              」，不会搜索其他聊天。
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭搜索"
            onClick={closeConversationSearch}
          >
            <Icon name="close" />
          </button>
        </div>
        <label className="dialog-field conversation-search-field">
          <span>关键词</span>
          <input
            ref={conversationSearchRef}
            data-dialog-initial-focus
            type="search"
            aria-label="搜索当前聊天"
            placeholder="输入要查找的内容"
            value={conversationSearchQuery}
            onChange={(event) => setConversationSearchQuery(event.target.value)}
          />
        </label>
        <div
          className="conversation-search-results"
          aria-live="polite"
          aria-label="当前对话搜索结果"
        >
          {!conversationSearchQuery.trim() ? (
            <p>仅搜索当前聊天，不会把其他私聊交给 Noema。</p>
          ) : conversationSearchResults.length ? (
            conversationSearchResults.map((message) => (
              <button
                className="conversation-search-result"
                type="button"
                key={message.id}
                onClick={() => {
                  setPendingScrollMessageId(message.id);
                  closeConversationSearch();
                }}
              >
                <strong>
                  {message.senderAgentId
                    ? (messageAgent.get(message.senderAgentId)?.name ?? 'Noema')
                    : message.role === 'user'
                      ? '你'
                      : (messageAgent.get(message.agentId ?? '')?.name ??
                        '联系人')}
                </strong>
                <time dateTime={message.createdAt}>
                  {timeLabel(message.createdAt)}
                </time>
                <span>
                  {message.content.replace(/\s+/gu, ' ').slice(0, 220)}
                </span>
              </button>
            ))
          ) : (
            <p>当前对话中没有找到匹配消息。</p>
          )}
        </div>
      </form>
    </div>
  ) : null;
}

type ForwardMessageDialogModel = Pick<
  SocialChatController,
  | 'messageAgent'
  | 'cancelForward'
  | 'currentRoom'
  | 'dialogRef'
  | 'forwardDialogOpen'
  | 'handleForward'
  | 'selectedForwardMessages'
  | 'forwardTargetRoomId'
  | 'chooseForwardRoom'
  | 'forwardableRooms'
  | 'forwardBusy'
  | 'forwardTargetRoom'
>;
export function ForwardMessageDialog({
  model,
}: {
  model: ForwardMessageDialogModel;
}) {
  const {
    messageAgent,
    cancelForward,
    currentRoom,
    dialogRef,
    forwardDialogOpen,
    handleForward,
    selectedForwardMessages,
    forwardTargetRoomId,
    chooseForwardRoom,
    forwardableRooms,
    forwardBusy,
    forwardTargetRoom,
  } = model;
  return forwardDialogOpen ? (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancelForward();
      }}
    >
      <form
        ref={dialogRef}
        className="social-dialog forward-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forward-dialog-title"
        onSubmit={(event) => void handleForward(event)}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="forward-dialog-title">转发到聊天</h2>
            <p>
              {selectedForwardMessages.length} 条消息 · 来自「
              {currentRoom?.title ?? '当前聊天'}」
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="取消转发"
            onClick={cancelForward}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="forward-dialog-preview">
          {selectedForwardMessages.map((message) => (
            <article key={message.id}>
              <strong>
                {message.senderAgentId
                  ? (messageAgent.get(message.senderAgentId)?.name ?? 'Noema')
                  : message.role === 'user'
                    ? '你'
                    : (messageAgent.get(message.agentId ?? '')?.name ??
                      '联系人')}
              </strong>
              <time dateTime={message.createdAt}>
                {timeLabel(message.createdAt)}
              </time>
              <p>
                {message.forwardedSources.length
                  ? `已转发 ${message.forwardedSources.length} 条消息`
                  : message.content}
              </p>
            </article>
          ))}
        </div>
        <label className="dialog-field">
          <span>转发到</span>
          <select
            value={forwardTargetRoomId}
            onChange={(event) => chooseForwardRoom(event.target.value)}
            required
            data-dialog-initial-focus
          >
            {forwardableRooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.title} ·{' '}
                {room.memberIds
                  .map((id) => messageAgent.get(id)?.name ?? '')
                  .filter(Boolean)
                  .join('、')}
              </option>
            ))}
          </select>
        </label>
        <p className="dialog-footnote">
          转发只会把消息送到目标聊天，不会自动触发回复。需要讨论时，再像平常一样发送一条消息。
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={cancelForward}
            disabled={forwardBusy}
          >
            取消
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={
              forwardBusy ||
              !forwardTargetRoom ||
              selectedForwardMessages.length === 0
            }
          >
            {forwardBusy ? '正在转发…' : '转发'}
          </button>
        </div>
      </form>
    </div>
  ) : null;
}
