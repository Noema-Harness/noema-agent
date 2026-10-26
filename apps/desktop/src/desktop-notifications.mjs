const REPLY_NOTIFICATION = Object.freeze({
  title: 'Noema',
  body: '有一条新回复，打开 Noema 查看。',
});

export function createSocialReplyNotificationHandler({
  NotificationClass,
  getWindow,
  openMainWindow,
}) {
  return (event) => {
    if (
      event?.type !== 'chat-turn-completed' ||
      event.empty ||
      !NotificationClass?.isSupported?.()
    ) {
      return false;
    }

    const window = getWindow();
    if (window && !window.isDestroyed() && window.isFocused()) return false;

    try {
      const notification = new NotificationClass(REPLY_NOTIFICATION);
      notification.once('click', openMainWindow);
      notification.show();
      return true;
    } catch {
      return false;
    }
  };
}
