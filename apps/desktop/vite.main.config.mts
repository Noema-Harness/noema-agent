import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const jsdomStylesheet = path.resolve(
  path.dirname(require.resolve('jsdom')),
  'jsdom/browser/default-stylesheet.css',
);
const jsdomSyncWorker = path.resolve(
  path.dirname(require.resolve('jsdom')),
  'jsdom/living/xhr/xhr-sync-worker.js',
);

function jsdomRuntimeAssets() {
  return {
    name: 'noema-jsdom-runtime-assets',
    closeBundle() {
      const developmentAsset = path.resolve(
        appRoot,
        '..',
        'browser',
        'default-stylesheet.css',
      );
      mkdirSync(path.dirname(developmentAsset), { recursive: true });
      copyFileSync(jsdomStylesheet, developmentAsset);

      // jsdom resolves this worker relative to the bundled main entry at runtime.
      const workerAsset = path.join(
        appRoot,
        '.vite',
        'build',
        'xhr-sync-worker.js',
      );
      mkdirSync(path.dirname(workerAsset), { recursive: true });
      copyFileSync(jsdomSyncWorker, workerAsset);
    },
  };
}

// https://vitejs.dev/config
export default defineConfig({
  plugins: [jsdomRuntimeAssets()],
  build: {
    rollupOptions: {
      external: [
        'better-sqlite3',
        '@anthropic-ai/sandbox-runtime',
        '@vscode/ripgrep',
      ],
    },
  },
});
