export function quickCaptureAccelerator(platform) {
  return platform === 'darwin' ? 'Command+Alt+N' : 'Control+Alt+N';
}

export function focusPrimaryWindow(window) {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return true;
}

export function activateQuickCaptureWindow(window) {
  const returnToPrevious = !window.isFocused();
  focusPrimaryWindow(window);
  return returnToPrevious;
}

export function finishQuickCaptureWindow(window, returnToPrevious) {
  if (!window || window.isDestroyed()) return false;
  if (returnToPrevious) window.minimize();
  return true;
}

export function registerQuickCaptureShortcut({
  shortcutApi,
  platform,
  onQuickCapture,
}) {
  const accelerator = quickCaptureAccelerator(platform);
  const registered = shortcutApi.register(accelerator, onQuickCapture);

  return {
    accelerator,
    registered,
    unregister() {
      if (registered) shortcutApi.unregister(accelerator);
    },
  };
}
