export function createWindowPreferences(
  preload: string,
  additionalArguments: string[] = [],
) {
  return {
    preload,
    ...(additionalArguments.length ? { additionalArguments } : {}),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

export function isMainFrameIpcEvent(
  event:
    | {
        senderFrame?: { parent: unknown } | null;
        sender?: { mainFrame?: unknown } | null;
      }
    | null
    | undefined,
) {
  return Boolean(
    event?.senderFrame &&
    event.senderFrame === event.sender?.mainFrame &&
    event.senderFrame.parent === null,
  );
}

export function isInternalNavigation(
  url: unknown,
  devServerUrl: unknown,
  packagedRendererEntryUrl: unknown,
) {
  if (typeof url !== 'string') return false;
  try {
    const destination = new URL(url);
    if (typeof devServerUrl === 'string' && devServerUrl) {
      const trusted = new URL(devServerUrl);
      return (
        destination.origin === trusted.origin &&
        destination.pathname === trusted.pathname &&
        destination.username === '' &&
        destination.password === '' &&
        trusted.username === '' &&
        trusted.password === ''
      );
    }
    if (typeof packagedRendererEntryUrl !== 'string') return false;
    const trustedEntry = new URL(packagedRendererEntryUrl);
    return (
      destination.protocol === 'file:' &&
      trustedEntry.protocol === 'file:' &&
      destination.host === trustedEntry.host &&
      destination.username === '' &&
      destination.password === '' &&
      destination.pathname === trustedEntry.pathname
    );
  } catch {
    return false;
  }
}

export function shouldOpenExternally(url: string) {
  return url.startsWith('https://');
}
