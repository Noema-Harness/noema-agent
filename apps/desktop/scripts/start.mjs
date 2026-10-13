import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureElectronRuntime } from './electron-runtime.mjs';

configureElectronRuntime();

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forgeCli = path.join(
  appDir,
  'node_modules',
  '@electron-forge',
  'cli',
  'dist',
  'electron-forge.js',
);
const child = spawn(process.execPath, [forgeCli, 'start'], {
  cwd: appDir,
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Could not launch the Noema desktop app:', error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
