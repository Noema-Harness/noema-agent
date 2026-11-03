import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function developmentRoot() {
  const root =
    process.env.NOEMA_E2E_ROOT_DIR ??
    path.join(repositoryRoot, '.work', 'runs');
  if (!path.isAbsolute(root))
    throw new Error('Development artifact root must be absolute.');
  fs.mkdirSync(root, { recursive: true });
  return path.resolve(root);
}

export function createDevelopmentDirectory(prefix) {
  if (!/^[\w-]+$/u.test(prefix))
    throw new Error('Invalid development directory prefix.');
  return fs.mkdtempSync(path.join(developmentRoot(), prefix));
}

export function removeDevelopmentDirectory(directory) {
  const root = fs.realpathSync(developmentRoot());
  const target = path.resolve(directory);
  if (!fs.existsSync(target)) return;
  if (fs.lstatSync(target).isSymbolicLink())
    throw new Error('Refusing linked development directory.');
  const realTarget = fs.realpathSync(target);
  const relative = path.relative(root, realTarget);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `Refusing to remove data outside the development root: ${target}`,
    );
  }
  fs.rmSync(realTarget, { recursive: true, force: true });
}
