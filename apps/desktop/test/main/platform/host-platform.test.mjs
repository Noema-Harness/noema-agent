import assert from 'node:assert/strict';
import test from 'node:test';
import { hostPlatform } from '../../../src/main/platform/host-platform.ts';

test('each host platform carries its own path rules and tool names', () => {
  const windows = hostPlatform('win32');
  assert.equal(windows.family, 'windows');
  assert.equal(windows.executable('node'), 'node.exe');
  assert.equal(windows.paths.join('C:\\npm', 'x'), 'C:\\npm\\x');
  assert.equal(windows.npmGlobalModules('C:\\npm'), 'C:\\npm\\node_modules');
  assert.equal(windows.dshShellTool, 'tool-pwsh');
  assert.ok(windows.workerEnvironment.includes('USERPROFILE'));

  for (const id of ['darwin', 'linux']) {
    const host = hostPlatform(id);
    assert.equal(host.id, id);
    assert.equal(host.family, 'posix');
    assert.equal(host.executable('node'), 'node');
    assert.equal(host.paths.join('/opt/homebrew', 'x'), '/opt/homebrew/x');
    assert.equal(
      host.npmGlobalModules('/opt/homebrew'),
      '/opt/homebrew/lib/node_modules',
    );
    assert.equal(host.dshShellTool, 'tool-bash');
    assert.ok(host.workerEnvironment.includes('HOME'));
    assert.ok(!host.workerEnvironment.includes('USERPROFILE'));
  }
});

test('the default host is the running platform', () => {
  assert.equal(hostPlatform().id, process.platform);
});
