import type { ForgeConfig } from '@electron-forge/shared-types';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { stageWindowsRunnerResource } from './scripts/windows-runner-resource.mjs';
import {
  WINDOWS_RUNNER_BACKEND_ID,
  WINDOWS_RUNNER_BACKEND_VERSION,
  WINDOWS_RUNNER_POLICY_VERSION,
  WINDOWS_RUNNER_PROTOCOL_VERSION,
} from './src/main/execution/windows-runner-package-contract.mjs';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronChecksums = require('electron/checksums.json');
const extraResources = [path.join(appRoot, 'assets', 'noema-tray-icon.png')];
const jsdomStylesheet = path.resolve(
  path.dirname(require.resolve('jsdom')),
  'jsdom/browser/default-stylesheet.css',
);

const config: ForgeConfig = {
  packagerConfig: {
    ignore: (file) =>
      Boolean(file) &&
      (!file.startsWith('/.vite') ||
        file.startsWith('/native/windows-runner/target/')),
    prune: false,
    extraResource: extraResources,
    asar: {
      unpack: '**/node_modules/@vscode/ripgrep-*/bin/**',
    },
    download: { checksums: electronChecksums },
    afterCopy: [
      async ({ buildPath, platform, arch }) => {
        const browserResourceDirectory = path.resolve(
          buildPath,
          '..',
          'browser',
        );
        await fs.mkdir(browserResourceDirectory, { recursive: true });
        await fs.copyFile(
          jsdomStylesheet,
          path.join(browserResourceDirectory, 'default-stylesheet.css'),
        );

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

        const repositoryModules = path.resolve(
          appRoot,
          '..',
          '..',
          'node_modules',
        );
        const desktopModules = path.join(appRoot, 'node_modules');
        const runtimePackages = [
          '@anthropic-ai/sandbox-runtime',
          '@pondwader/socks5-server',
          'commander',
          'node-forge',
          'zod',
          '@vscode/ripgrep',
          `@vscode/ripgrep-${platform}-${arch}`,
        ];
        const packagedRuntimePackages =
          platform === 'win32'
            ? runtimePackages.filter(
                (name) =>
                  ![
                    '@anthropic-ai/sandbox-runtime',
                    '@pondwader/socks5-server',
                    'commander',
                    'node-forge',
                  ].includes(name),
              )
            : runtimePackages;
        for (const packageName of packagedRuntimePackages) {
          const candidates =
            packageName === 'zod'
              ? [desktopModules, repositoryModules]
              : [repositoryModules, desktopModules];
          let packageSource: string | undefined;
          for (const base of candidates) {
            const candidate = path.join(base, packageName);
            try {
              await fs.access(path.join(candidate, 'package.json'));
              packageSource = candidate;
              break;
            } catch {
              // Continue to the next workspace installation location.
            }
          }
          if (!packageSource) {
            throw new Error(
              `${packageName} is required to package the project command sandbox. Run npm ci before packaging.`,
            );
          }
          const packageTarget = path.join(
            buildPath,
            'node_modules',
            packageName,
          );
          await fs.cp(packageSource, packageTarget, {
            recursive: true,
            force: true,
          });
        }

        if (platform === 'win32') {
          if (arch !== 'x64') {
            throw new Error(
              `Noema Windows runner 仅支持 x64 安装包，当前目标架构为 ${arch}。`,
            );
          }
          const targetTriple = 'x86_64-pc-windows-msvc';
          const nativeRunnerRoot = path.join(
            appRoot,
            'native',
            'windows-runner',
          );
          const [cargoManifest, protocolSource] = await Promise.all([
            fs.readFile(path.join(nativeRunnerRoot, 'Cargo.toml'), 'utf8'),
            fs.readFile(
              path.join(nativeRunnerRoot, 'src', 'protocol.rs'),
              'utf8',
            ),
          ]);
          const sourceMatchesPackage =
            new RegExp(
              `^version\\s*=\\s*"${WINDOWS_RUNNER_BACKEND_VERSION}"\\s*$`,
              'mu',
            ).test(cargoManifest) &&
            new RegExp(
              `^pub const PROTOCOL_VERSION: u16 = ${WINDOWS_RUNNER_PROTOCOL_VERSION};$`,
              'mu',
            ).test(protocolSource) &&
            new RegExp(
              `^pub const POLICY_VERSION: u16 = ${WINDOWS_RUNNER_POLICY_VERSION};$`,
              'mu',
            ).test(protocolSource) &&
            protocolSource.includes(
              `pub const BACKEND_ID: &str = "${WINDOWS_RUNNER_BACKEND_ID}";`,
            );
          if (!sourceMatchesPackage) {
            throw new Error(
              'Windows runner source version/protocol/backend identity does not match the desktop package contract.',
            );
          }
          execFileSync(
            'cargo',
            [
              'build',
              '--manifest-path',
              path.join(nativeRunnerRoot, 'Cargo.toml'),
              '--release',
              '--target',
              targetTriple,
            ],
            { cwd: appRoot, stdio: 'inherit' },
          );
          const sourceExecutable = path.join(
            nativeRunnerRoot,
            'target',
            targetTriple,
            'release',
            'noema-windows-runner.exe',
          );
          const resourcesDirectory = path.resolve(buildPath, '..');
          const destinationDirectory = path.join(
            resourcesDirectory,
            'windows-runner',
          );
          if (
            path.resolve(path.dirname(destinationDirectory)) !==
            resourcesDirectory
          ) {
            throw new Error('Windows runner package destination is invalid.');
          }
          await fs.rm(destinationDirectory, { recursive: true, force: true });
          await stageWindowsRunnerResource({
            sourceExecutable,
            destinationDirectory,
            platform,
            arch,
          });
        }
      },
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      vendorDirectory: process.env.NOEMA_SQUIRREL_VENDOR,
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      hotRestart: true,
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
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
