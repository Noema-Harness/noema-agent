import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const destination = path.join(appRoot, 'runtime', 'dsh-runtime');
const dshSource = path.resolve(
  process.env.NOEMA_DSH_SOURCE ??
    'C:\\Users\\NUC\\AppData\\Local\\NoemaTools\\dsh',
);
const nodeSource = path.resolve(
  process.env.NOEMA_DSH_NODE_SOURCE ??
    'C:\\Users\\NUC\\AppData\\Local\\NoemaTools\\node-v24.21.0-win-x64\\node.exe',
);
const packageSource = path.join(
  dshSource,
  'node_modules',
  '@deepseek-ai',
  'dsh',
);

async function main() {
  const packageJson = JSON.parse(
    await readFile(path.join(packageSource, 'package.json'), 'utf8'),
  );
  const nodeVersion = execFileSync(nodeSource, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  console.log(`Staging DSH ${packageJson.version} with Node ${nodeVersion}`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, 'node_modules', '@deepseek-ai'), {
    recursive: true,
  });
  await cp(nodeSource, path.join(destination, 'node.exe'));
  await cp(
    packageSource,
    path.join(destination, 'node_modules', '@deepseek-ai', 'dsh'),
    {
      recursive: true,
      force: true,
    },
  );
  const size = await directorySize(destination);
  console.log(
    `Staged runtime at ${destination} (${(size / 1024 / 1024).toFixed(1)} MB)`,
  );
}

async function directorySize(directory) {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
