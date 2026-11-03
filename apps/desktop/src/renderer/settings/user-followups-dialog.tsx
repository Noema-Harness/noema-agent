import { Icon } from '../chat/presentation';
import type { SocialChatController } from '../chat/use-social-chat-controller';

type UserFollowupsDialogModel = Pick<
  SocialChatController,
  | 'userFollowupsOpen'
  | 'userFollowupDialogRef'
  | 'closeUserFollowups'
  | 'userFollowupList'
  | 'userFollowupLoading'
  | 'userFollowupBusy'
  | 'userFollowupError'
  | 'userFollowupTitle'
  | 'setUserFollowupTitle'
  | 'userFollowupBody'
  | 'setUserFollowupBody'
  | 'userFollowupDueAt'
  | 'setUserFollowupDueAt'
  | 'editingUserFollowupId'
  | 'setEditingUserFollowupId'
  | 'handleUserFollowupsEnabled'
  | 'saveUserFollowup'
  | 'cancelUserFollowup'
>;

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? '时间不可用'
    : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function localInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const statusLabel = {
  pending: '待提醒',
  delivering: '正在发送',
  delivered: '已发送',
  canceled: '已取消',
} as const;

export function UserFollowupsDialog({
  model,
}: {
  model: UserFollowupsDialogModel;
}) {
  const {
    userFollowupsOpen,
    userFollowupDialogRef,
    closeUserFollowups,
    userFollowupList,
    userFollowupLoading,
    userFollowupBusy,
    userFollowupError,
    userFollowupTitle,
    setUserFollowupTitle,
    userFollowupBody,
    setUserFollowupBody,
    userFollowupDueAt,
    setUserFollowupDueAt,
    editingUserFollowupId,
    setEditingUserFollowupId,
    handleUserFollowupsEnabled,
    saveUserFollowup,
    cancelUserFollowup,
  } = model;

  if (!userFollowupsOpen) return null;
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeUserFollowups();
      }}
    >
      <section
        ref={userFollowupDialogRef}
        className="social-dialog user-followups-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-followups-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="user-followups-title">回访提醒</h2>
            <p>一次性本机通知；到期不会调用模型或替你执行操作。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭回访提醒"
            onClick={closeUserFollowups}
          >
            <Icon name="close" />
          </button>
        </div>

        <label className="personal-memory-toggle">
          <span>
            <strong>允许发送回访通知</strong>
            <small>关闭后保留安排；重新开启或下次启动时补发到期项。</small>
          </span>
          <input
            type="checkbox"
            checked={userFollowupList?.enabled ?? false}
            disabled={userFollowupBusy || userFollowupLoading}
            onChange={(event) =>
              void handleUserFollowupsEnabled(event.target.checked)
            }
          />
        </label>

        <form className="personal-memory-editor" onSubmit={saveUserFollowup}>
          <label className="dialog-field">
            <span>{editingUserFollowupId ? '修改回访' : '安排一条回访'}</span>
            <input
              data-dialog-initial-focus
              value={userFollowupTitle}
              maxLength={80}
              required
              placeholder="标题，例如：跟进场地报价"
              onChange={(event) => setUserFollowupTitle(event.target.value)}
            />
          </label>
          <label className="dialog-field">
            <span>提醒内容</span>
            <textarea
              value={userFollowupBody}
              maxLength={500}
              rows={2}
              required
              placeholder="到时希望 Noema 提醒你的具体内容"
              onChange={(event) => setUserFollowupBody(event.target.value)}
            />
          </label>
          <label className="dialog-field">
            <span>提醒时间（本机时间）</span>
            <input
              type="datetime-local"
              value={userFollowupDueAt}
              required
              onChange={(event) => setUserFollowupDueAt(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            {editingUserFollowupId ? (
              <button
                className="secondary-action"
                type="button"
                disabled={userFollowupBusy}
                onClick={() => {
                  setEditingUserFollowupId(null);
                  setUserFollowupTitle('');
                  setUserFollowupBody('');
                  setUserFollowupDueAt('');
                }}
              >
                取消修改
              </button>
            ) : null}
            <button
              className="primary-action"
              type="submit"
              disabled={
                userFollowupBusy ||
                !userFollowupTitle.trim() ||
                !userFollowupBody.trim() ||
                !userFollowupDueAt
              }
            >
              {userFollowupBusy
                ? '正在保存…'
                : editingUserFollowupId
                  ? '保存修改'
                  : '安排回访'}
            </button>
          </div>
        </form>

        <section
          className="personal-memory-list"
          aria-labelledby="user-followups-list-title"
          aria-busy={userFollowupLoading}
        >
          <div className="personal-memory-list-heading">
            <h3 id="user-followups-list-title">最近安排</h3>
            <span>{userFollowupList?.items.length ?? 0}</span>
          </div>
          {userFollowupLoading ? (
            <p className="personal-memory-empty">正在读取本机回访…</p>
          ) : userFollowupList?.items.length ? (
            <ul>
              {userFollowupList.items.map((item) => (
                <li className="personal-memory-item" key={item.id}>
                  <div className="user-followup-item-heading">
                    <strong>{item.title}</strong>
                    <span data-state={item.status}>
                      {statusLabel[item.status]}
                    </span>
                  </div>
                  <p>{item.body}</p>
                  <div className="personal-memory-meta">
                    <span>{displayDate(item.dueAt)}</span>
                    <span>
                      {item.sourceMessageId
                        ? `来自${item.sourceRoomTitle || 'Noema 主聊'} · ${displayDate(item.sourceMessageCreatedAt || item.createdAt)}`
                        : '手动安排'}
                    </span>
                  </div>
                  {item.lastError ? (
                    <p className="user-followup-error-note" role="status">
                      {item.lastError}
                    </p>
                  ) : null}
                  {item.status === 'pending' ? (
                    <div className="personal-memory-actions">
                      <button
                        type="button"
                        disabled={userFollowupBusy}
                        onClick={() => {
                          setEditingUserFollowupId(item.id);
                          setUserFollowupTitle(item.title);
                          setUserFollowupBody(item.body);
                          setUserFollowupDueAt(localInputValue(item.dueAt));
                        }}
                      >
                        修改
                      </button>
                      <button
                        type="button"
                        disabled={userFollowupBusy}
                        onClick={() => void cancelUserFollowup(item.id)}
                      >
                        取消回访
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="personal-memory-empty">
              还没有回访。你可以在主聊中明确安排，也可以在这里手动添加。
            </p>
          )}
        </section>
        {userFollowupError ? (
          <p className="dialog-error" role="alert">
            {userFollowupError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
