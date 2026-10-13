import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const packageJson = JSON.parse(
  readFileSync(path.join(appDir, 'package.json'), 'utf8'),
);

const verifiedWindowsRuntimes = new Map([
  [
    '44.7.0',
    '2529B494F4123F152BCE346051F7BD855EF95006424A561953CF17C49A3D1BA8',
  ],
]);

/**
 * Prefer an explicitly configured Electron runtime. On this Windows host, the
 * npm-installed copy crashes when launched from the workspace path, while the
 * byte-identical official archive under D:\NoemaTools runs correctly. Use that
 * local copy only when its executable matches the pinned SHA-256; everywhere
 * else Electron Forge continues to use its package-installed runtime.
 */
export function configureElectronRuntime(env = process.env) {
  if (env.ELECTRON_OVERRIDE_DIST_PATH || process.platform !== 'win32') return;

  const expectedHash = verifiedWindowsRuntimes.get(
    packageJson.devDependencies?.electron,
  );
  if (!expectedHash || process.arch !== 'x64') return;

  const candidate = path.join(
    'D:\\NoemaTools',
    `electron-v${packageJson.devDependencies.electron}-win32-x64`,
  );
  const executable = path.join(candidate, 'electron.exe');
  if (!existsSync(executable)) return;

  const actualHash = createHash('sha256')
    .update(readFileSync(executable))
    .digest('hex')
    .toUpperCase();
  if (actualHash === expectedHash) env.ELECTRON_OVERRIDE_DIST_PATH = candidate;
}
