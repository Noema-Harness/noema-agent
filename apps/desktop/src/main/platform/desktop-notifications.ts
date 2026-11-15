const REPLY_NOTIFICATION = Object.freeze({
  title: 'Noema',
  body: '有一条回复等你查看。',
  groupId: 'noema-replies',
  silent: true,
});

type NotificationLike = {
  once: (event: 'click', listener: () => void) => unknown;
  show: () => void;
};
type NotificationClassLike = {
  new (options: {
    title: string;
    body: string;
    groupId?: string;
    silent?: boolean;
  }): NotificationLike;
  isSupported?: () => boolean;
};
type NotificationEvent = {
  type?: unknown;
  notifyUser?: boolean;
  empty?: boolean;
  roomId?: unknown;
  messageId?: string | null;
  id?: unknown;
  title?: unknown;
  body?: unknown;
  sourceRoomId?: string | null;
  sourceMessageId?: string | null;
};
export type FollowupSourceTarget = {
  followupId: string;
  sourceRoomId: string | null;
  sourceMessageId: string | null;
};

export function createSocialReplyNotificationHandler({
  NotificationClass,
  getWindow,
  openMainWindow,
  disabled = false,
}: {
  NotificationClass: NotificationClassLike | null | undefined;
  getWindow: () => {
    isDestroyed: () => boolean;
    isFocused: () => boolean;
  } | null;
  openMainWindow: (target: {
    roomId: string | null;
    messageId: string | null;
  }) => unknown;
  disabled?: boolean;
}) {
  const notifiedMessageIds = new Set<string>();
  return (event: NotificationEvent | null | undefined) => {
    if (
      disabled ||
      event?.type !== 'chat-turn-completed' ||
      event.notifyUser !== true ||
      event.empty ||
      !NotificationClass?.isSupported?.()
    ) {
      return false;
    }

    if (event.messageId && notifiedMessageIds.has(event.messageId))
      return false;

    const window = getWindow();
    if (window && !window.isDestroyed() && window.isFocused()) return false;

    try {
      const notification = new NotificationClass(REPLY_NOTIFICATION);
      notification.once('click', () =>
        openMainWindow({
          roomId: typeof event.roomId === 'string' ? event.roomId : null,
          messageId:
            typeof event.messageId === 'string' ? event.messageId : null,
        }),
      );
      notification.show();
      if (event.messageId) {
        notifiedMessageIds.add(event.messageId);
        if (notifiedMessageIds.size > 120)
          notifiedMessageIds.delete(
            notifiedMessageIds.values().next().value as string,
          );
      }
      return true;
    } catch {
      return false;
    }
  };
}

export function createUserFollowupNotificationHandler({
  NotificationClass,
  openMainWindow,
  openFollowupSource = openMainWindow,
  disabled = false,
}: {
  NotificationClass: NotificationClassLike | null | undefined;
  openMainWindow: (target?: FollowupSourceTarget) => void;
  openFollowupSource?: (target: FollowupSourceTarget) => void;
  disabled?: boolean;
}) {
  return (event: NotificationEvent | null | undefined) => {
    if (
      disabled ||
      event?.type !== 'user-followup-due' ||
      typeof event.id !== 'string' ||
      typeof event.title !== 'string' ||
      typeof event.body !== 'string' ||
      !NotificationClass?.isSupported?.()
    )
      return false;
    try {
      const notification = new NotificationClass({
        title: event.title,
        body: event.body,
        groupId: 'noema-followups',
        silent: true,
      });
      notification.once('click', () =>
        openFollowupSource({
          followupId: event.id as string,
          sourceRoomId: event.sourceRoomId ?? null,
          sourceMessageId: event.sourceMessageId ?? null,
        }),
      );
      notification.show();
      return true;
    } catch {
      return false;
    }
  };
}
