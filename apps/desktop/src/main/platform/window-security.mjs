export function createWindowPreferences(preload) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

export function isInternalNavigation(url, devServerUrl) {
  return url === devServerUrl || url.startsWith('file://');
}

export function shouldOpenExternally(url) {
  return url.startsWith('https://');
}
