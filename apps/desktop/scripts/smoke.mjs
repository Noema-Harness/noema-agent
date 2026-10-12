import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forgeCli = path.join(
  appDir,
  'node_modules',
  '@electron-forge',
  'cli',
  'dist',
  'electron-forge.js',
);
const timeoutMs = 90_000;
const child = spawn(process.execPath, [forgeCli, 'start'], {
  cwd: appDir,
  env: { ...process.env, NOEMA_SMOKE_TEST: '1' },
  stdio: 'inherit',
});

const timeout = setTimeout(() => {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  } else {
    child.kill('SIGTERM');
  }
  console.error(
    `Desktop startup smoke test timed out after ${timeoutMs / 1000}s.`,
  );
  process.exitCode = 1;
}, timeoutMs);

child.on('error', (error) => {
  clearTimeout(timeout);
  console.error('Could not launch Electron Forge:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  clearTimeout(timeout);
  if (code === 0) {
    console.log(
      'Desktop startup smoke test passed: renderer finished loading.',
    );
    return;
  }
  console.error(
    `Desktop startup smoke test failed (exit=${code}, signal=${signal}).`,
  );
  process.exitCode = 1;
});
