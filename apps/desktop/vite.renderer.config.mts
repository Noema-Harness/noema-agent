import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const testProfile =
  process.env.NOEMA_SMOKE_TEST === '1'
    ? process.env.NOEMA_SMOKE_USER_DATA_DIR
    : undefined;

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
  // Main/preload builds write runtime assets under .vite; they are not
  // renderer sources and must not trigger the renderer dev server's watcher.
  server: {
    watch: {
      ignored: ['**/.vite/**'],
    },
  },
  // Electron can request the renderer while Vite's cold-start scanner is still
  // discovering this graph. Pre-bundle its direct dependencies up front so
  // the first page load uses a stable optimized module graph.
  optimizeDeps: {
    include: [
      'cmdk',
      'pdfjs-dist',
      'react',
      'react-dom/client',
      'react-markdown',
      'remark-gfm',
    ],
  },
  // Concurrent live and test clients must not rewrite each other's prebundles.
  cacheDir: testProfile ? path.join(testProfile, 'vite-cache') : undefined,
});
