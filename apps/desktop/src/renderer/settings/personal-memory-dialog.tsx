/**
 * DORMANT (2026-11-12): no current renderer entrypoint.
 * Retained intentionally for the future memory experience; do not delete as dead code.
 * Revive only together with a real product entrypoint and acceptance case.
 */
import { NoemaTextArea } from '../ui/noema-form-controls';
import { NoemaButton } from '../ui/noema-button';
import { NoemaOverlay } from '../ui/noema-overlay';
import { Icon } from '../chat/presentation';
import type { SocialChatController } from '../chat/use-social-chat-controller';

type PersonalMemoryDialogModel = Pick<
  SocialChatController,
  | 'personalMemoryOpen'
  | 'personalMemoryDialogRef'
  | 'closePersonalMemories'
  | 'personalMemoryList'
  | 'personalMemoryLoading'
  | 'refreshPersonalMemories'
  | 'personalMemoryBusy'
  | 'personalMemoryError'
  | 'setPersonalMemoryError'
  | 'personalMemoryDraft'
  | 'setPersonalMemoryDraft'
  | 'editingPersonalMemoryId'
  | 'setEditingPersonalMemoryId'
  | 'deletingPersonalMemoryId'
  | 'setDeletingPersonalMemoryId'
  | 'handlePersonalMemoryEnabled'
  | 'savePersonalMemory'
  | 'deletePersonalMemory'
  | 'openHistorySource'
>;

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? '时间不可用'
    : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function PersonalMemoryDialog({
  model,
}: {
  model: PersonalMemoryDialogModel;
}) {
  const {
    personalMemoryOpen,
    personalMemoryDialogRef,
    closePersonalMemories,
    personalMemoryList,
    personalMemoryLoading,
    refreshPersonalMemories,
    personalMemoryBusy,
    personalMemoryError,
    setPersonalMemoryError,
    personalMemoryDraft,
    setPersonalMemoryDraft,
    editingPersonalMemoryId,
    setEditingPersonalMemoryId,
    deletingPersonalMemoryId,
    setDeletingPersonalMemoryId,
    handlePersonalMemoryEnabled,
    savePersonalMemory,
    deletePersonalMemory,
    openHistorySource,
  } = model;

  return personalMemoryOpen ? (
    <NoemaOverlay isOpen onClose={closePersonalMemories}>
      <section
        ref={personalMemoryDialogRef}
        className="social-dialog personal-memory-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-memory-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="personal-memory-title">个人记忆</h2>
            <p>只在 Noema 主聊中使用。</p>
          </div>
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="关闭个人记忆"
            onClick={closePersonalMemories}
          >
            <Icon name="close" />
          </NoemaButton>
        </div>

        <div className="personal-memory-toggle">
          <span>
            <strong>在对话中参考记忆</strong>
            <small>关闭后仍保留条目，但不会用于新的回复。</small>
          </span>
          <button
            className="permission-switch"
            type="button"
            role="switch"
            aria-checked={personalMemoryList?.enabled ?? false}
            aria-label="在对话中参考记忆"
            disabled={personalMemoryBusy || personalMemoryLoading}
            onClick={() =>
              void handlePersonalMemoryEnabled(!personalMemoryList?.enabled)
            }
          >
            <span className="permission-switch-thumb" />
          </button>
        </div>

        <form className="personal-memory-editor" onSubmit={savePersonalMemory}>
          <label className="dialog-field">
            <span>{editingPersonalMemoryId ? '修改记忆' : '添加一条记忆'}</span>
            <NoemaTextArea
              autoFocus
              data-dialog-initial-focus
              value={personalMemoryDraft}
              maxLength={2_000}
              rows={3}
              placeholder="例如：我通常希望先看到结论，再看依据。"
              onChange={(event) => setPersonalMemoryDraft(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            {editingPersonalMemoryId ? (
              <NoemaButton
                className="secondary-action"
                type="button"
                disabled={personalMemoryBusy}
                onClick={() => {
                  setEditingPersonalMemoryId(null);
                  setPersonalMemoryDraft('');
                }}
              >
                取消修改
              </NoemaButton>
            ) : null}
            <NoemaButton
              className="primary-action"
              type="submit"
              disabled={personalMemoryBusy || !personalMemoryDraft.trim()}
            >
              {personalMemoryBusy
                ? '正在保存…'
                : editingPersonalMemoryId
                  ? '保存修改'
                  : '添加记忆'}
            </NoemaButton>
          </div>
          {!personalMemoryList?.enabled ? (
            <p className="dialog-footnote">
              使用已暂停。仍可维护条目；Noema 不会检索或使用它们。
            </p>
          ) : null}
        </form>

        <section
          className="personal-memory-list"
          aria-labelledby="personal-memory-list-title"
          aria-busy={personalMemoryLoading}
        >
          <div className="personal-memory-list-heading">
            <h3 id="personal-memory-list-title">已保存</h3>
            <span>
              {personalMemoryList ? personalMemoryList.items.length : '—'}
            </span>
          </div>
          {personalMemoryLoading ? (
            <p className="personal-memory-empty">正在读取本机记忆…</p>
          ) : !personalMemoryList ? (
            <div className="personal-memory-load-error">
              <span>暂时无法显示个人记忆。</span>
              <NoemaButton
                type="button"
                className="secondary-action"
                disabled={personalMemoryBusy || personalMemoryLoading}
                onClick={() => void refreshPersonalMemories()}
              >
                重试
              </NoemaButton>
            </div>
          ) : personalMemoryList?.items.length ? (
            <ul>
              {personalMemoryList.items.map((item) => (
                <li className="personal-memory-item" key={item.id}>
                  <p>{item.content}</p>
                  <div className="personal-memory-meta">
                    <span>
                      {item.sourceKind === 'manual'
                        ? '手动维护'
                        : item.sourceMessageId
                          ? `来自${item.sourceRoomTitle || 'Noema 主聊'} · ${displayDate(item.sourceMessageCreatedAt || item.updatedAt)}`
                          : '来源消息已不可用'}
                    </span>
                    {item.sourceKind === 'message' &&
                    item.sourceRoomId &&
                    item.sourceMessageId ? (
                      <NoemaButton
                        className="secondary-action personal-memory-source-link"
                        type="button"
                        onClick={() => {
                          closePersonalMemories();
                          openHistorySource({
                            id: item.sourceMessageId!,
                            roomId: item.sourceRoomId!,
                            roomTitle: item.sourceRoomTitle || 'Noema 主聊',
                            role: 'user',
                            createdAt:
                              item.sourceMessageCreatedAt || item.updatedAt,
                            snippet: '',
                            redacted: false,
                          });
                        }}
                      >
                        查看来源
                      </NoemaButton>
                    ) : null}
                    {item.sourceKind === 'manual' ? (
                      <span>更新于 {displayDate(item.updatedAt)}</span>
                    ) : null}
                  </div>
                  {deletingPersonalMemoryId === item.id ? (
                    <div
                      className="personal-memory-delete-confirm"
                      role="group"
                    >
                      <span>删除这条记忆？原聊天仍会保留。</span>
                      <NoemaButton
                        type="button"
                        disabled={personalMemoryBusy}
                        onClick={() => void deletePersonalMemory(item.id)}
                      >
                        确认删除
                      </NoemaButton>
                      <NoemaButton
                        type="button"
                        disabled={personalMemoryBusy}
                        onClick={() => setDeletingPersonalMemoryId(null)}
                      >
                        取消
                      </NoemaButton>
                    </div>
                  ) : (
                    <div className="personal-memory-actions">
                      <NoemaButton
                        type="button"
                        disabled={personalMemoryBusy}
                        onClick={() => {
                          setPersonalMemoryError('');
                          setDeletingPersonalMemoryId(null);
                          setEditingPersonalMemoryId(item.id);
                          setPersonalMemoryDraft(item.content);
                        }}
                      >
                        修改
                      </NoemaButton>
                      <NoemaButton
                        type="button"
                        disabled={personalMemoryBusy}
                        onClick={() => {
                          setPersonalMemoryError('');
                          setDeletingPersonalMemoryId(item.id);
                        }}
                      >
                        删除
                      </NoemaButton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="personal-memory-empty">
              还没有保存的内容。你可以在这里添加，也可以在主聊中明确告诉 Noema
              记住某件事。
            </p>
          )}
        </section>
        {personalMemoryError ? (
          <p className="dialog-error" role="alert">
            {personalMemoryError}
          </p>
        ) : null}
      </section>
    </NoemaOverlay>
  ) : null;
}
