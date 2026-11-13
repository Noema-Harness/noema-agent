import fs from 'node:fs';
import path from 'node:path';

export class EncryptedSecretStore {
  declare safeStorage: {
    isEncryptionAvailable: () => boolean;
    encryptString: (value: string) => Buffer;
    decryptString: (value: Buffer) => string;
  };
  declare filePath: string;
  declare fallbackStores: EncryptedSecretStore[];

  constructor({
    safeStorage,
    filePath,
    fallbackStores = [],
  }: {
    safeStorage: EncryptedSecretStore['safeStorage'];
    filePath: string;
    fallbackStores?: EncryptedSecretStore[];
  }) {
    this.safeStorage = safeStorage;
    this.filePath = filePath;
    this.fallbackStores = fallbackStores;
  }

  isConfigured(): boolean {
    return (
      fs.existsSync(this.filePath) ||
      this.fallbackStores.some((store) => store.isConfigured())
    );
  }

  get(): string | null {
    if (!fs.existsSync(this.filePath)) {
      return (
        this.fallbackStores.find((store) => store.isConfigured())?.get() ?? null
      );
    }
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

  getBaseUrl(): string | null {
    if (!fs.existsSync(this.filePath)) {
      return (
        this.fallbackStores
          .find((store) => store.isConfigured())
          ?.getBaseUrl() ?? null
      );
    }
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

  set(value: unknown) {
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

  setConfiguration({ apiKey, baseUrl }: { apiKey: unknown; baseUrl: unknown }) {
    if (
      typeof apiKey !== 'string' ||
      !apiKey.trim() ||
      apiKey.length > 4096 ||
      typeof baseUrl !== 'string' ||
      !baseUrl.trim() ||
      baseUrl.length > 2_000
    ) {
      throw new TypeError('模型服务凭据配置无效。');
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

  writeEncrypted(tempPath: string, encrypted: Buffer) {
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
