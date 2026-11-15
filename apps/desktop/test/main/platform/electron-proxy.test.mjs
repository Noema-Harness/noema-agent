import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveElectronProxy } from '../../../src/main/platform/electron-proxy.ts';

test('Electron proxy follows explicit HTTP and HTTPS proxy environment settings', () => {
  assert.deepEqual(
    resolveElectronProxy({
      HTTP_PROXY: 'http://127.0.0.1:7888',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
    }),
    {
      config: {
        mode: 'fixed_servers',
        proxyRules: 'http=http://127.0.0.1:7888;https=http://127.0.0.1:7890',
      },
      invalid: false,
    },
  );
});

test('Electron proxy uses the configured scheme-specific proxy for both protocols', () => {
  assert.deepEqual(
    resolveElectronProxy({ https_proxy: 'https://proxy.example:8443' }),
    {
      config: {
        mode: 'fixed_servers',
        proxyRules:
          'http=https://proxy.example:8443;https=https://proxy.example:8443',
      },
      invalid: false,
    },
  );
});

test('Electron keeps the system network route when no proxy is configured', () => {
  assert.deepEqual(resolveElectronProxy({}), { config: null, invalid: false });
});

test('unsupported or credential-bearing proxy URLs do not break app startup', () => {
  assert.deepEqual(
    resolveElectronProxy({ HTTPS_PROXY: 'socks5://proxy.example:1080' }),
    { config: null, invalid: true },
  );
  assert.deepEqual(
    resolveElectronProxy({ HTTP_PROXY: 'http://user:secret@proxy.example:80' }),
    { config: null, invalid: true },
  );
});
