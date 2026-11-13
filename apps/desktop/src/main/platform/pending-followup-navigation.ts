export type FollowupNavigationTarget = {
  roomId: string;
  messageId: string | null;
  followupExecutionId?: string;
};

export function createPendingFollowupNavigationDelivery(
  send: (target: FollowupNavigationTarget) => boolean,
  onDispatched: (target: FollowupNavigationTarget) => void = () => {},
) {
  let rendererReady = false;
  let pendingTarget: FollowupNavigationTarget | null = null;

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
    request(target: FollowupNavigationTarget) {
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
