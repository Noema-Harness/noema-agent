/**
 * DORMANT (2026-11-12): no current renderer entrypoint.
 * Retained intentionally for the future proactive-care surface; do not delete as dead code.
 * Revive only together with a real product entrypoint and acceptance case.
 */
import {
  NoemaCheckbox,
  NoemaInput,
  NoemaTextArea,
} from '../ui/noema-form-controls';
import { NoemaButton } from '../ui/noema-button';
import { NoemaOverlay } from '../ui/noema-overlay';
import { Icon } from '../chat/presentation';
import type { SocialChatController } from '../chat/use-social-chat-controller';

type UserFollowupsDialogModel = Pick<
  SocialChatController,
  | 'userFollowupsOpen'
  | 'userFollowupDialogRef'
  | 'closeUserFollowups'
  | 'userFollowupList'
  | 'userFollowupLoading'
  | 'refreshUserFollowups'
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
  | 'openHistorySource'
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

function dueStatus(item: {
  dueAt: string;
  status: keyof typeof statusLabel;
  lastError: string | null;
}) {
  const overdue =
    item.status === 'pending' && Date.parse(item.dueAt) <= Date.now();
  if (item.status === 'pending' && item.lastError) {
    return { label: '等待重试', state: 'retry' };
  }
  if (overdue) return { label: '已逾期，待发送', state: 'overdue' };
  return { label: statusLabel[item.status], state: item.status };
}

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
    refreshUserFollowups,
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
    openHistorySource,
  } = model;

  if (!userFollowupsOpen) return null;
  return (
    <NoemaOverlay isOpen onClose={closeUserFollowups}>
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
            <p>到点发一条本机通知，不会调用模型。</p>
          </div>
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="关闭回访提醒"
            onClick={closeUserFollowups}
          >
            <Icon name="close" />
          </NoemaButton>
        </div>

        <label className="personal-memory-toggle">
          <span>
            <strong>发送回访通知</strong>
            <small>关闭后保留安排，重新开启会补发。</small>
          </span>
          <NoemaCheckbox
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
            <span>{editingUserFollowupId ? '修改回访' : '新建回访'}</span>
            <NoemaInput
              data-dialog-initial-focus
              value={userFollowupTitle}
              maxLength={80}
              required
              placeholder="标题，例如：跟进场地报价"
              onChange={(event) => setUserFollowupTitle(event.target.value)}
            />
          </label>
          <label className="dialog-field">
            <span>内容</span>
            <NoemaTextArea
              value={userFollowupBody}
              maxLength={500}
              rows={2}
              required
              placeholder="要提醒什么"
              onChange={(event) => setUserFollowupBody(event.target.value)}
            />
          </label>
          <label className="dialog-field">
            <span>
              提醒时间（本机时间 ·{' '}
              {Intl.DateTimeFormat().resolvedOptions().timeZone || '本机时区'}）
            </span>
            <NoemaInput
              type="datetime-local"
              value={userFollowupDueAt}
              required
              onChange={(event) => setUserFollowupDueAt(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            {editingUserFollowupId ? (
              <NoemaButton
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
              </NoemaButton>
            ) : null}
            <NoemaButton
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
            </NoemaButton>
          </div>
          {userFollowupList && !userFollowupList.enabled ? (
            <p className="dialog-footnote">
              通知已暂停。已有回访会保留；重新开启后可继续发送。
            </p>
          ) : null}
        </form>

        <section
          className="personal-memory-list"
          aria-labelledby="user-followups-list-title"
          aria-busy={userFollowupLoading}
        >
          <div className="personal-memory-list-heading">
            <h3 id="user-followups-list-title">全部回访</h3>
            <span>
              {userFollowupList ? userFollowupList.items.length : '—'}
            </span>
          </div>
          {userFollowupLoading ? (
            <p className="personal-memory-empty">正在读取…</p>
          ) : !userFollowupList ? (
            <div className="personal-memory-load-error">
              <span>暂时无法显示回访。</span>
              <NoemaButton
                type="button"
                className="secondary-action"
                disabled={userFollowupBusy || userFollowupLoading}
                onClick={() => void refreshUserFollowups()}
              >
                重试
              </NoemaButton>
            </div>
          ) : userFollowupList?.items.length ? (
            <ul>
              {userFollowupList.items.map((item) => {
                const state = dueStatus(item);
                return (
                  <li className="personal-memory-item" key={item.id}>
                    <div className="user-followup-item-heading">
                      <strong>{item.title}</strong>
                      <span data-state={state.state}>{state.label}</span>
                    </div>
                    <p>{item.body}</p>
                    <div className="personal-memory-meta">
                      <span>{displayDate(item.dueAt)}</span>
                      <span>
                        {item.sourceMessageId
                          ? item.sourceMessageCreatedAt
                            ? `来自${item.sourceRoomTitle || 'Noema 主聊'} · ${displayDate(item.sourceMessageCreatedAt)}`
                            : item.sourceRoomTitle
                              ? `来自${item.sourceRoomTitle} · 原消息已删除`
                              : '来源聊天或消息已不可用'
                          : item.sourceRoomId
                            ? `${item.sourceRoomTitle || '来源聊天'} · 原消息已删除`
                            : '手动安排'}
                      </span>
                      {item.sourceMessageId &&
                      item.sourceRoomId &&
                      item.sourceMessageCreatedAt ? (
                        <NoemaButton
                          className="secondary-action personal-memory-source-link"
                          type="button"
                          onClick={() => {
                            closeUserFollowups();
                            openHistorySource({
                              id: item.sourceMessageId!,
                              roomId: item.sourceRoomId!,
                              roomTitle: item.sourceRoomTitle || 'Noema 主聊',
                              role: 'user',
                              createdAt: item.sourceMessageCreatedAt!,
                              snippet: '',
                              redacted: false,
                            });
                          }}
                        >
                          查看来源
                        </NoemaButton>
                      ) : null}
                    </div>
                    {item.lastError ? (
                      <p className="user-followup-error-note" role="status">
                        上次通知未成功，稍后会重试：
                        {item.lastError}
                      </p>
                    ) : null}
                    {item.status === 'pending' ? (
                      <div className="personal-memory-actions">
                        <NoemaButton
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
                        </NoemaButton>
                        <NoemaButton
                          type="button"
                          disabled={userFollowupBusy}
                          onClick={() => void cancelUserFollowup(item.id)}
                        >
                          取消
                        </NoemaButton>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="personal-memory-empty">还没有回访。</p>
          )}
        </section>
        {userFollowupError ? (
          <p className="dialog-error" role="alert">
            {userFollowupError}
          </p>
        ) : null}
      </section>
    </NoemaOverlay>
  );
}
