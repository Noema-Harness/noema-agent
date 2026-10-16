import type { ForgeConfig } from '@electron-forge/shared-types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    afterCopy: [
      async ({ buildPath }) => {
        const sourceCandidates = [
          path.join(appRoot, 'node_modules', 'better-sqlite3'),
          path.resolve(appRoot, '..', '..', 'node_modules', 'better-sqlite3'),
        ];
        let source: string | undefined;
        for (const candidate of sourceCandidates) {
          try {
            await fs.access(path.join(candidate, 'package.json'));
            source = candidate;
            break;
          } catch {
            // Try the next workspace installation location.
          }
        }
        const target = path.join(buildPath, 'node_modules', 'better-sqlite3');
        if (!source) {
          throw new Error(
            'better-sqlite3 is not installed in either the desktop workspace or repository root. Run npm ci before packaging.',
          );
        }
        await fs.cp(source, target, { recursive: true, force: true });
      },
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
