import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostPlatform } from '../src/main/platform/host-platform.ts';

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const destination = path.join(appRoot, 'runtime', 'dsh-runtime');
const host = hostPlatform();
const windows = host.family === 'windows';
// NOEMA_DSH_SOURCE is an npm prefix that has @deepseek-ai/dsh installed
// globally; NOEMA_DSH_NODE_SOURCE is the Node 24.21+ binary to ship with it.
// On macOS both default to the Node running this script and its global prefix.
const dshSource = path.resolve(
  process.env.NOEMA_DSH_SOURCE ??
    (windows
      ? 'C:\\Users\\NUC\\AppData\\Local\\NoemaTools\\dsh'
      : execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8' }).trim()),
);
const nodeSource = path.resolve(
  process.env.NOEMA_DSH_NODE_SOURCE ??
    (windows
      ? 'C:\\Users\\NUC\\AppData\\Local\\NoemaTools\\node-v24.21.0-win-x64\\node.exe'
      : process.execPath),
);
const packageSource = path.join(
  host.npmGlobalModules(dshSource),
  '@deepseek-ai',
  'dsh',
);
const nodeName = host.executable('node');

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
  await cp(nodeSource, path.join(destination, nodeName));
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
