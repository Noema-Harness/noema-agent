import fs from 'node:fs';
import path from 'node:path';

export class EncryptedSecretStore {
  /** @param {{safeStorage:{isEncryptionAvailable:()=>boolean,encryptString:(value:string)=>Buffer,decryptString:(value:Buffer)=>string},filePath:string}} options */
  constructor({ safeStorage, filePath }) {
    this.safeStorage = safeStorage;
    this.filePath = filePath;
  }

  isConfigured() {
    return fs.existsSync(this.filePath);
  }

  get() {
    if (!this.isConfigured()) return null;
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统没有可用的安全凭据存储。');
    }
    const decrypted = this.safeStorage.decryptString(
      fs.readFileSync(this.filePath),
    );
    try {
      const record = JSON.parse(decrypted);
      if (record?.version === 1 && typeof record.apiKey === 'string') {
        return record.apiKey;
      }
    } catch {
      // Read the first encrypted-key format for forward-compatible migration.
    }
    return decrypted;
  }

  getBaseUrl() {
    if (!this.isConfigured()) return null;
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统没有可用的安全凭据存储。');
    }
    const decrypted = this.safeStorage.decryptString(
      fs.readFileSync(this.filePath),
    );
    try {
      const record = JSON.parse(decrypted);
      return record?.version === 1 && typeof record.baseUrl === 'string'
        ? record.baseUrl
        : null;
    } catch {
      return null;
    }
  }

  set(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
      throw new TypeError('API Key 必须是 1-4096 个字符。');
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统没有可用的安全凭据存储，未保存 API Key。');
    }
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const encrypted = this.safeStorage.encryptString(
      JSON.stringify({ version: 1, apiKey: value.trim() }),
    );
    this.writeEncrypted(tempPath, encrypted);
  }

  setConfiguration({ apiKey, baseUrl }) {
    if (
      typeof apiKey !== 'string' ||
      !apiKey.trim() ||
      apiKey.length > 4096 ||
      typeof baseUrl !== 'string' ||
      !baseUrl.trim() ||
      baseUrl.length > 2_000
    ) {
      throw new TypeError('FreeLLMAPI 凭据配置无效。');
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统没有可用的安全凭据存储，未保存 API Key。');
    }
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const encrypted = this.safeStorage.encryptString(
      JSON.stringify({ version: 1, apiKey: apiKey.trim(), baseUrl }),
    );
    this.writeEncrypted(tempPath, encrypted);
  }

  writeEncrypted(tempPath, encrypted) {
    try {
      fs.writeFileSync(tempPath, encrypted, { flag: 'wx', mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  clear() {
    fs.rmSync(this.filePath, { force: true });
  }
}
