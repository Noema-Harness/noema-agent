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
  // Concurrent live and test clients must not rewrite each other's prebundles.
  cacheDir: testProfile ? path.join(testProfile, 'vite-cache') : undefined,
});
