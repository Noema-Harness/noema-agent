import { app, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';

export function createNoemaTray({
  onOpen,
  onQuit,
}: {
  onOpen: () => unknown;
  onQuit: () => void;
}) {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'noema-tray-icon.png')
    : path.join(app.getAppPath(), 'assets', 'noema-tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) throw new Error('tray_icon_unavailable');
  const tray = new Tray(icon);
  try {
    tray.setToolTip('Noema');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开 Noema', click: onOpen },
        { type: 'separator' },
        { label: '退出 Noema', click: onQuit },
      ]),
    );
    tray.on('click', onOpen);
    return tray;
  } catch (error) {
    tray.destroy();
    throw error;
  }
}
