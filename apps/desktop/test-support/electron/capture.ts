import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
export function writeSmokeScreenshot(
  targetPath: string,
  image: Electron.NativeImage,
) {
  if (
    app.isPackaged ||
    process.env.NOEMA_SMOKE_TEST !== '1' ||
    !path.isAbsolute(targetPath)
  ) {
    throw new Error('截图只允许由未打包的 smoke 测试写入绝对路径。');
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, image.toPNG(), { flag: 'wx' });
}
