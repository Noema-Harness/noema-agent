import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const testProfile =
  process.env.NOEMA_SMOKE_TEST === '1'
    ? process.env.NOEMA_SMOKE_USER_DATA_DIR
    : undefined;

// https://vitejs.dev/config
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: 'noema-development-hmr-csp',
      transformIndexHtml(html) {
        if (command !== 'serve') return html;
        return html.replace(
          "style-src 'self';",
          "style-src 'self' 'unsafe-inline';",
        );
      },
    },
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  // Main/preload builds write runtime assets under .vite; they are not
  // renderer sources and must not trigger the renderer dev server's watcher.
  server: {
    // Windows can reserve 5173 inside a dynamic port block, which makes the
    // default dev server fail with EACCES. Set this to 0 to take another port.
    ...(process.env.NOEMA_DEV_RENDERER_PORT
      ? { port: Number(process.env.NOEMA_DEV_RENDERER_PORT), strictPort: true }
      : {}),
    // Electron smoke/E2E runs validate the renderer's real bootstrap, not HMR.
    // Disabling HMR also avoids injecting React Refresh's deferred module
    // preamble into the cold-start path under test.
    hmr:
      testProfile && process.env.NOEMA_SMOKE_ENABLE_HMR !== '1'
        ? false
        : undefined,
    watch: {
      ignored: ['**/.vite/**'],
    },
  },
  // Electron can request the renderer while Vite's cold-start scanner is still
  // discovering this graph. Pre-bundle its direct dependencies up front so
  // the first page load uses a stable optimized module graph.
  optimizeDeps: {
    include: [
      '@blueprintjs/core',
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
}));
