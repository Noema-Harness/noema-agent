import { NoemaSelect, NoemaInput } from '../../ui/noema-form-controls';
import { NoemaButton } from '../../ui/noema-button';
import { NoemaOverlay } from '../../ui/noema-overlay';
import { timeLabel, Icon } from '../presentation';
import type { SocialChatController } from '../use-social-chat-controller';
import type {
  NoemaSocialAgent,
  NoemaSocialMessage,
} from '../../../shared/contracts/noema-bridge.d.ts';

export function MessageSourcePreview({
  messages,
  messageAgent,
  label,
}: {
  messages: NoemaSocialMessage[];
  messageAgent: Map<string, NoemaSocialAgent>;
  label: string;
}) {
  return (
    <div className="forward-dialog-preview" role="list" aria-label={label}>
      {messages.map((message) => (
        <article key={message.id} role="listitem">
          <strong>
            {message.senderAgentId
              ? (messageAgent.get(message.senderAgentId)?.name ?? 'Noema')
              : message.role === 'user'
                ? '你'
                : (messageAgent.get(message.agentId ?? '')?.name ?? '联系人')}
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
  );
}

type ConversationSearchDialogModel = Pick<
  SocialChatController,
  | 'currentRoom'
  | 'navigateToConversationSearchResult'
  | 'dialogRef'
  | 'conversationSearchOpen'
  | 'closeConversationSearch'
  | 'conversationSearchRef'
  | 'conversationSearchQuery'
  | 'setConversationSearchQuery'
  | 'conversationSearchResults'
  | 'conversationSearchLoading'
  | 'conversationSearchError'
  | 'retryConversationSearch'
>;
export function ConversationSearchDialog({
  model,
}: {
  model: ConversationSearchDialogModel;
}) {
  const {
    currentRoom,
    navigateToConversationSearchResult,
    dialogRef,
    conversationSearchOpen,
    closeConversationSearch,
    conversationSearchRef,
    conversationSearchQuery,
    setConversationSearchQuery,
    conversationSearchResults,
    conversationSearchLoading,
    conversationSearchError,
    retryConversationSearch,
  } = model;
  return conversationSearchOpen ? (
    <NoemaOverlay isOpen onClose={closeConversationSearch}>
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
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="关闭搜索"
            onClick={closeConversationSearch}
          >
            <Icon name="close" />
          </NoemaButton>
        </div>
        <label className="dialog-field conversation-search-field">
          <span>关键词</span>
          <NoemaInput
            inputRef={conversationSearchRef}
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
          ) : conversationSearchLoading ? (
            <p role="status">正在搜索当前聊天…</p>
          ) : conversationSearchError ? (
            <p role="alert">
              {conversationSearchError}{' '}
              <NoemaButton type="button" onClick={retryConversationSearch}>
                重试
              </NoemaButton>
            </p>
          ) : conversationSearchResults.length ? (
            conversationSearchResults.map((message) => (
              <NoemaButton
                className="conversation-search-result"
                type="button"
                key={message.id}
                onClick={() => {
                  navigateToConversationSearchResult(message.id);
                }}
              >
                <strong>{message.sender}</strong>
                <time dateTime={message.createdAt}>
                  {timeLabel(message.createdAt)}
                </time>
                <span>
                  {message.content.replace(/\s+/gu, ' ').slice(0, 220)}
                </span>
              </NoemaButton>
            ))
          ) : (
            <p>当前对话中没有找到匹配消息。</p>
          )}
        </div>
      </form>
    </NoemaOverlay>
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
    <NoemaOverlay isOpen onClose={cancelForward}>
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
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="取消转发"
            onClick={cancelForward}
          >
            <Icon name="close" />
          </NoemaButton>
        </div>
        <MessageSourcePreview
          messages={selectedForwardMessages}
          messageAgent={messageAgent}
          label="转发消息预览"
        />
        <label className="dialog-field">
          <span>转发到</span>
          <NoemaSelect
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
          </NoemaSelect>
        </label>
        <p className="dialog-footnote">转发后不会自动回复。</p>
        <div className="dialog-actions">
          <NoemaButton
            className="secondary-action"
            type="button"
            onClick={cancelForward}
            disabled={forwardBusy}
          >
            取消
          </NoemaButton>
          <NoemaButton
            className="primary-action"
            type="submit"
            disabled={
              forwardBusy ||
              !forwardTargetRoom ||
              selectedForwardMessages.length === 0
            }
          >
            {forwardBusy ? '正在转发…' : '转发'}
          </NoemaButton>
        </div>
      </form>
    </NoemaOverlay>
  ) : null;
}
