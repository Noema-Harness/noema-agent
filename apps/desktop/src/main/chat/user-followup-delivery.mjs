import { randomUUID } from 'node:crypto';

export class UserFollowupDelivery {
  constructor({ store, emit, recordEvent, isShuttingDown }) {
    this.store = store;
    this.emit = emit;
    this.recordEvent = recordEvent;
    this.isShuttingDown = isShuttingDown;
    this.drain = null;
  }

  schedule() {
    if (this.isShuttingDown() || this.drain || !this.store.userFollowups)
      return;
    const drain = Promise.resolve()
      .then(() => this.store.userFollowups.claimDue())
      .then((items) => {
        for (const item of items) {
          this.recordEvent({
            executionId: item.id,
            operation: 'followup.delivery.claimed',
            status: 'claimed',
          });
          try {
            const shown = this.emit({
              type: 'user-followup-due',
              id: item.id,
              title: item.title,
              body: item.body,
              dueAt: item.dueAt,
              sourceRoomId: item.sourceRoomId,
              sourceMessageId: item.sourceMessageId,
            });
            if (shown === true) {
              this.recordEvent({
                executionId: item.id,
                operation: 'followup.notification.api',
                status: 'accepted',
              });
              const delivered = this.store.userFollowups.markDelivered(item.id);
              this.recordEvent({
                executionId: item.id,
                operation: 'followup.delivery.terminal',
                status: delivered ? 'delivered' : 'failed',
                errorCode: delivered ? null : 'delivery_state_update_failed',
              });
            } else {
              this.recordEvent({
                executionId: item.id,
                operation: 'followup.notification.api',
                status: 'rejected',
                errorCode: 'notification_unavailable',
              });
              const released = this.store.userFollowups.release(
                item.id,
                '桌面通知当前不可用；到下次检查时重试。',
              );
              this.recordEvent({
                executionId: item.id,
                operation: 'followup.delivery.retry',
                status: released ? 'scheduled' : 'failed',
                errorCode: released ? null : 'delivery_release_failed',
              });
            }
          } catch (error) {
            this.recordEvent({
              executionId: item.id,
              operation: 'followup.notification.api',
              status: 'failed',
              errorCode: 'notification_emit_failed',
            });
            const released = this.store.userFollowups.release(
              item.id,
              error?.message ?? '桌面通知发送失败。',
            );
            this.recordEvent({
              executionId: item.id,
              operation: 'followup.delivery.retry',
              status: released ? 'scheduled' : 'failed',
              errorCode: released ? null : 'delivery_release_failed',
            });
          }
        }
      })
      .catch((error) => {
        this.recordEvent({
          executionId: randomUUID(),
          operation: 'followup.delivery.claim',
          status: 'failed',
          errorCode: 'delivery_claim_failed',
        });
        console.error(
          'User follow-up delivery failed:',
          error?.message ?? error,
        );
      })
      .finally(() => {
        if (this.drain === drain) this.drain = null;
      });
    this.drain = drain;
  }

  async stop() {
    await this.drain;
  }
}
