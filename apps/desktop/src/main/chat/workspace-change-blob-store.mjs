import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_COMMAND_RECOVERY_BLOB_BYTES } from '../execution/workspace-command-quotas.ts';

const BLOB_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_BLOB_BYTES = MAX_COMMAND_RECOVERY_BLOB_BYTES;

function blobError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Durable content-addressed recovery data for SocialWork file changes. */
export class WorkspaceChangeBlobStore {
  constructor(directory, { maxBlobBytes = MAX_BLOB_BYTES } = {}) {
    if (
      typeof directory !== 'string' ||
      !directory ||
      !Number.isSafeInteger(maxBlobBytes) ||
      maxBlobBytes < 1
    ) {
      throw new TypeError('workspace_blob_store_configuration_invalid');
    }
    this.directory = path.resolve(directory);
    this.maxBlobBytes = maxBlobBytes;
  }

  put(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.byteLength > this.maxBlobBytes) {
      throw blobError(
        'workspace_change_blob_limit',
        '工作区恢复资料超过单个文件的存储上限。',
      );
    }
    const hash = hashBytes(bytes);
    const destination = this.#pathFor(hash);
    fs.mkdirSync(this.directory, { recursive: true });
    if (fs.existsSync(destination)) {
      this.#readVerified(hash, bytes.byteLength);
      return { hash, size: bytes.byteLength };
    }

    const temporaryPath = path.join(
      this.directory,
      `.pending-${randomUUID()}.tmp`,
    );
    let descriptor;
    try {
      descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      try {
        fs.renameSync(temporaryPath, destination);
      } catch (error) {
        if (!fs.existsSync(destination)) throw error;
        this.#readVerified(hash, bytes.byteLength);
      }
      this.#readVerified(hash, bytes.byteLength);
      return { hash, size: bytes.byteLength };
    } catch (error) {
      if (error?.code === 'workspace_change_blob_corrupt') throw error;
      throw blobError(
        'workspace_change_blob_write_failed',
        '工作区恢复资料无法安全保存。',
      );
    } finally {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // Preserve the original failure; the temp file remains recoverable.
        }
      }
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Startup recovery can collect an orphan temporary blob.
      }
    }
  }

  read(hash) {
    if (!BLOB_HASH_PATTERN.test(hash ?? '')) {
      throw blobError(
        'workspace_change_blob_hash_invalid',
        '工作区恢复资料索引无效。',
      );
    }
    return this.#readVerified(hash);
  }

  verify(hash, expectedSize = null) {
    if (!BLOB_HASH_PATTERN.test(hash ?? '')) {
      throw blobError(
        'workspace_change_blob_hash_invalid',
        '工作区恢复资料索引无效。',
      );
    }
    const filePath = this.#pathFor(hash);
    let descriptor;
    let size = 0;
    const digest = createHash('sha256');
    try {
      const pathInfo = fs.lstatSync(filePath);
      if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) {
        throw new Error('not_regular_file');
      }
      descriptor = fs.openSync(filePath, 'r');
      const fileInfo = fs.fstatSync(descriptor);
      if (!fileInfo.isFile() || fileInfo.size > this.maxBlobBytes) {
        throw new Error('invalid_blob_file');
      }
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let position = 0;
      while (position < fileInfo.size) {
        const count = fs.readSync(
          descriptor,
          buffer,
          0,
          Math.min(buffer.byteLength, fileInfo.size - position),
          position,
        );
        if (count <= 0) throw new Error('short_blob_read');
        digest.update(buffer.subarray(0, count));
        position += count;
      }
      size = position;
    } catch {
      throw blobError(
        'workspace_change_blob_missing',
        '工作区恢复资料缺失或不可读取。',
      );
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    if (
      digest.digest('hex') !== hash ||
      (expectedSize !== null && size !== expectedSize)
    ) {
      throw blobError(
        'workspace_change_blob_corrupt',
        '工作区恢复资料大小与记录不一致。',
      );
    }
    return { hash, size };
  }

  collectUnreferenced(referencedHashes) {
    if (!Array.isArray(referencedHashes)) {
      throw new TypeError('workspace_blob_references_invalid');
    }
    if (!fs.existsSync(this.directory)) return { removed: 0, retained: 0 };
    const referenced = new Set(
      referencedHashes.filter((hash) => BLOB_HASH_PATTERN.test(hash)),
    );
    let removed = 0;
    let retained = 0;
    for (const entry of fs.readdirSync(this.directory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.pending-') && entry.name.endsWith('.tmp')) {
        fs.rmSync(path.join(this.directory, entry.name), { force: true });
        removed += 1;
        continue;
      }
      if (!entry.name.endsWith('.blob')) continue;
      const hash = entry.name.slice(0, -'.blob'.length);
      if (!BLOB_HASH_PATTERN.test(hash)) continue;
      if (referenced.has(hash)) {
        this.verify(hash);
        retained += 1;
      } else {
        fs.rmSync(path.join(this.directory, entry.name), { force: true });
        removed += 1;
      }
    }
    return { removed, retained };
  }

  #pathFor(hash) {
    if (!BLOB_HASH_PATTERN.test(hash ?? '')) {
      throw blobError(
        'workspace_change_blob_hash_invalid',
        '工作区恢复资料索引无效。',
      );
    }
    return path.join(this.directory, `${hash}.blob`);
  }

  #readVerified(hash, expectedSize = null) {
    let bytes;
    try {
      const info = fs.lstatSync(this.#pathFor(hash));
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error('not_regular_file');
      }
      bytes = fs.readFileSync(this.#pathFor(hash));
    } catch {
      throw blobError(
        'workspace_change_blob_missing',
        '工作区恢复资料缺失或不可读取。',
      );
    }
    if (
      hashBytes(bytes) !== hash ||
      (expectedSize !== null && bytes.byteLength !== expectedSize)
    ) {
      throw blobError(
        'workspace_change_blob_corrupt',
        '工作区恢复资料校验失败。',
      );
    }
    return bytes;
  }
}

export { MAX_BLOB_BYTES as MAX_WORKSPACE_CHANGE_BLOB_BYTES };
