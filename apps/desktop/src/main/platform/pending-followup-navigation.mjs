export function createPendingFollowupNavigationDelivery(send) {
  let rendererReady = false;
  let pendingTarget = null;

  const dispatch = () => {
    if (!rendererReady || !pendingTarget || send(pendingTarget) !== true)
      return false;
    pendingTarget = null;
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
