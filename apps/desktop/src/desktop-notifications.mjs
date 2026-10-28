const REPLY_NOTIFICATION = Object.freeze({
  title: 'Noema',
  body: '有一条回复等你查看。',
  groupId: 'noema-replies',
  silent: true,
});

export function createSocialReplyNotificationHandler({
  NotificationClass,
  getWindow,
  openMainWindow,
  disabled = false,
}) {
  const notifiedMessageIds = new Set();
  return (event) => {
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
      notification.once('click', openMainWindow);
      notification.show();
      if (event.messageId) {
        notifiedMessageIds.add(event.messageId);
        if (notifiedMessageIds.size > 120)
          notifiedMessageIds.delete(notifiedMessageIds.values().next().value);
      }
      return true;
    } catch {
      return false;
    }
  };
}
