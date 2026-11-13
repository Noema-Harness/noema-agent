import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_PROFILE_IDS,
  getAgentProfile,
  isAgentProfileId,
  resolveAgentProfile,
} from '../../../src/main/runtime/agent-profiles.ts';

test('defines the four runtime profiles', () => {
  assert.deepEqual(AGENT_PROFILE_IDS, [
    'noema',
    'specialist',
    'executor',
    'group-lead',
  ]);
  for (const profile of AGENT_PROFILE_IDS)
    assert.equal(getAgentProfile(profile).id, profile);
});

test('Noema can orchestrate but cannot execute files or shell commands', () => {
  const profile = getAgentProfile('noema');
  assert.equal(profile.canUseSocial, true);
  assert.equal(profile.canCreateCards, true);
  assert.equal(profile.canExecuteCards, false);
  assert.equal(profile.canUseFilesystem, false);
  assert.equal(profile.canUseShell, false);
  assert.deepEqual(profile.memoryScopes, ['personal', 'project']);
});

test('specialists advise and cannot execute or write files', () => {
  const profile = getAgentProfile('specialist');
  assert.equal(profile.canUseSocial, true);
  assert.equal(profile.canCreateCards, false);
  assert.equal(profile.canExecuteCards, false);
  assert.equal(profile.canUseFilesystem, false);
  assert.equal(profile.canUseShell, false);
  assert.deepEqual(profile.memoryScopes, ['specialist', 'project']);
});

test('the executor is hidden, non-social and the only file/shell profile', () => {
  const profile = getAgentProfile('executor');
  assert.equal(profile.hiddenFromContacts, true);
  assert.equal(profile.visible, false);
  assert.equal(profile.canUseSocial, false);
  assert.equal(profile.canExecuteCards, true);
  assert.equal(profile.canUseFilesystem, true);
  assert.equal(profile.canUseShell, true);
  assert.deepEqual(profile.memoryScopes, []);
});

test('group leads coordinate but do not touch files', () => {
  const profile = getAgentProfile('group-lead');
  assert.equal(profile.canCreateCards, true);
  assert.equal(profile.canExecuteCards, false);
  assert.equal(profile.canUseFilesystem, false);
  assert.deepEqual(profile.memoryScopes, ['project']);
});

test('unknown profiles fail closed and identities map explicitly', () => {
  assert.equal(isAgentProfileId('noema'), true);
  assert.equal(isAgentProfileId('root'), false);
  assert.throws(() => getAgentProfile('root'), /Unknown agent profile/);
  assert.equal(resolveAgentProfile('noema').id, 'noema');
  assert.equal(resolveAgentProfile('noema-executor').id, 'executor');
  assert.equal(resolveAgentProfile('agent-unknown').id, 'specialist');
});
