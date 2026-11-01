import { Icon } from '../chat/presentation';
import type { SocialChatController } from '../chat/use-social-chat-controller';

type PersonalMemoryDialogModel = Pick<
  SocialChatController,
  | 'personalMemoryOpen'
  | 'personalMemoryDialogRef'
  | 'closePersonalMemories'
  | 'personalMemoryList'
  | 'personalMemoryLoading'
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
  } = model;

  return personalMemoryOpen ? (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePersonalMemories();
      }}
    >
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
            <p>由你维护，只供 Noema 主聊按需参考。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭个人记忆"
            onClick={closePersonalMemories}
          >
            <Icon name="close" />
          </button>
        </div>

        <label className="personal-memory-toggle">
          <span>
            <strong>允许主聊使用</strong>
            <small>关闭后保留条目，但不检索或发送给模型。</small>
          </span>
          <input
            type="checkbox"
            checked={personalMemoryList?.enabled ?? false}
            disabled={personalMemoryBusy || personalMemoryLoading}
            onChange={(event) =>
              void handlePersonalMemoryEnabled(event.target.checked)
            }
          />
        </label>

        <form className="personal-memory-editor" onSubmit={savePersonalMemory}>
          <label className="dialog-field">
            <span>{editingPersonalMemoryId ? '修改记忆' : '添加一条记忆'}</span>
            <textarea
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
              <button
                className="secondary-action"
                type="button"
                disabled={personalMemoryBusy}
                onClick={() => {
                  setEditingPersonalMemoryId(null);
                  setPersonalMemoryDraft('');
                }}
              >
                取消修改
              </button>
            ) : null}
            <button
              className="primary-action"
              type="submit"
              disabled={personalMemoryBusy || !personalMemoryDraft.trim()}
            >
              {personalMemoryBusy
                ? '正在保存…'
                : editingPersonalMemoryId
                  ? '保存修改'
                  : '添加记忆'}
            </button>
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
            <span>{personalMemoryList?.items.length ?? 0}</span>
          </div>
          {personalMemoryLoading ? (
            <p className="personal-memory-empty">正在读取本机记忆…</p>
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
                      <button
                        type="button"
                        disabled={personalMemoryBusy}
                        onClick={() => void deletePersonalMemory(item.id)}
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        disabled={personalMemoryBusy}
                        onClick={() => setDeletingPersonalMemoryId(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="personal-memory-actions">
                      <button
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
                      </button>
                      <button
                        type="button"
                        disabled={personalMemoryBusy}
                        onClick={() => {
                          setPersonalMemoryError('');
                          setDeletingPersonalMemoryId(item.id);
                        }}
                      >
                        删除
                      </button>
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
    </div>
  ) : null;
}
