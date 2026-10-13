import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EncryptedSecretStore } from '../src/encrypted-secret-store.mjs';

test('stores only encrypted credentials and can replace or clear them', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-secret-store-'));
  const filePath = path.join(directory, 'credentials', 'freellmapi.key');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`).toString('base64'),
    decryptString: (value) =>
      Buffer.from(value.toString(), 'base64')
        .toString()
        .replace(/^sealed:/, ''),
  };
  const store = new EncryptedSecretStore({ safeStorage, filePath });
  try {
    assert.equal(store.isConfigured(), false);
    store.set('free-key-test-value');
    assert.equal(store.isConfigured(), true);
    assert.equal(store.get(), 'free-key-test-value');
    assert.equal(
      readFileSync(filePath, 'utf8').includes('free-key-test-value'),
      false,
    );
    store.setConfiguration({
      apiKey: 'rotated-test-value',
      baseUrl: 'http://127.0.0.1:31415/v1',
    });
    assert.equal(store.get(), 'rotated-test-value');
    assert.equal(store.getBaseUrl(), 'http://127.0.0.1:31415/v1');
    const encrypted = readFileSync(filePath, 'utf8');
    assert.equal(encrypted.includes('rotated-test-value'), false);
    assert.equal(encrypted.includes('127.0.0.1:31415'), false);
    store.clear();
    assert.equal(store.isConfigured(), false);
    assert.equal(store.get(), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refuses to persist a key when operating-system encryption is unavailable', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-secret-store-'));
  const store = new EncryptedSecretStore({
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    },
    filePath: path.join(directory, 'key'),
  });
  try {
    assert.throws(() => store.set('free-key-test-value'), /安全凭据存储/);
    assert.equal(store.isConfigured(), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
