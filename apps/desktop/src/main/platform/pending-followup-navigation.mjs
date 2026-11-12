/**
 * @param {(target: { roomId: string, messageId: string | null, followupExecutionId?: string }) => boolean} send
 * @param {(target: { roomId: string, messageId: string | null, followupExecutionId?: string }) => void} [onDispatched]
 */
export function createPendingFollowupNavigationDelivery(
  send,
  onDispatched = () => {},
) {
  let rendererReady = false;
  let pendingTarget = null;

  const dispatch = () => {
    if (!rendererReady || !pendingTarget || send(pendingTarget) !== true)
      return false;
    const dispatchedTarget = pendingTarget;
    pendingTarget = null;
    try {
      onDispatched(dispatchedTarget);
    } catch {
      // Navigation dispatch must not depend on diagnostic recording.
    }
    return true;
  };

  return {
    request(target) {
      pendingTarget = target;
      return dispatch();
    },
    markRendererReady() {
      rendererReady = true;
      return dispatch();
    },
    resetRenderer() {
      rendererReady = false;
    },
  };
}
