import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_ENTRIES = 200;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_FILES = 400;
const MAX_SEARCH_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 256 * 1024;
const MAX_SEARCH_RESULTS = 60;
const MAX_MATCHES_PER_FILE = 3;
const SEARCH_SKIP_DIRECTORIES = new Set([
  '.git',
  '.svn',
  'node_modules',
  'dist',
  'build',
]);
const IMAGE_MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

function relativeInside(root, target) {
  const relative = path.relative(root, target);
  if (relative === '') return '';
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('文件不在当前工作区内。'), {
      code: 'workspace_file_outside',
    });
  }
  return relative;
}

function publicEntry(root, dirent) {
  return {
    name: dirent.name,
    kind: dirent.isDirectory() ? 'directory' : 'file',
    relativePath: path
      .relative(root, path.join(dirent.parentPath, dirent.name))
      .split(path.sep)
      .join('/'),
  };
}

export class WorkspaceFileService {
  /**
   * @param {{
   *   isKnownWorkspace:(workspacePath:string)=>boolean,
   *   openPath?:(target:string)=>Promise<string>
   * }} options
   */
  constructor({ isKnownWorkspace, openPath = null }) {
    this.isKnownWorkspace = isKnownWorkspace;
    this.openPath = openPath;
  }

  async resolveRoot(workspacePath) {
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      throw Object.assign(new Error('工作区路径无效。'), {
        code: 'workspace_file_invalid_root',
      });
    }
    const resolved = path.resolve(workspacePath);
    if (!this.isKnownWorkspace(resolved)) {
      throw Object.assign(new Error('只能查看已执行工单使用的工作区。'), {
        code: 'workspace_file_unknown_root',
      });
    }
    const root = await fs.realpath(resolved);
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      throw Object.assign(new Error('工作区不是文件夹。'), {
        code: 'workspace_file_invalid_root',
      });
    }
    return root;
  }

  async resolveTarget(root, relativePath = '') {
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
      throw Object.assign(new Error('相对路径无效。'), {
        code: 'workspace_file_invalid_path',
      });
    }
    const target = path.resolve(root, relativePath);
    relativeInside(root, target);
    const canonical = await fs.realpath(target);
    relativeInside(root, canonical);
    return canonical;
  }

  async list({ workspacePath, relativePath = '' }) {
    const root = await this.resolveRoot(workspacePath);
    const target = await this.resolveTarget(root, relativePath);
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      throw Object.assign(new Error('目标不是文件夹。'), {
        code: 'workspace_file_not_directory',
      });
    }
    const dirents = await fs.readdir(target, { withFileTypes: true });
    const entries = [];
    for (const dirent of dirents.slice(0, MAX_ENTRIES)) {
      if (dirent.isSymbolicLink()) continue;
      if (!dirent.isDirectory() && !dirent.isFile()) continue;
      entries.push(publicEntry(root, dirent));
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    return {
      root,
      relativePath: relativeInside(root, target).split(path.sep).join('/'),
      entries,
      truncated: dirents.length > MAX_ENTRIES,
    };
  }

  async search({ workspacePath, query }) {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    if (normalizedQuery.length === 0 || normalizedQuery.length > 100) {
      throw Object.assign(new Error('搜索内容需要 1–100 个字符。'), {
        code: 'workspace_file_invalid_query',
      });
    }
    const root = await this.resolveRoot(workspacePath);
    const needle = normalizedQuery.toLocaleLowerCase('zh-CN');
    const matches = [];
    const directories = [{ dir: root, relative: '' }];
    let scannedFiles = 0;
    let scannedBytes = 0;
    let truncated = false;

    while (directories.length > 0 && !truncated) {
      const current = directories.shift();
      let dirents;
      try {
        dirents = await fs.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      dirents.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      for (const dirent of dirents) {
        if (dirent.isSymbolicLink()) continue;
        const fullPath = path.join(current.dir, dirent.name);
        const relativePath = path
          .relative(root, fullPath)
          .split(path.sep)
          .join('/');
        if (dirent.isDirectory()) {
          if (SEARCH_SKIP_DIRECTORIES.has(dirent.name)) continue;
          directories.push({ dir: fullPath, relative: relativePath });
          continue;
        }
        if (!dirent.isFile()) continue;
        scannedFiles += 1;
        if (scannedFiles > MAX_SEARCH_FILES) {
          truncated = true;
          break;
        }
        if (dirent.name.toLocaleLowerCase('zh-CN').includes(needle)) {
          matches.push({
            relativePath,
            kind: 'name',
            line: 0,
            excerpt: relativePath,
          });
          if (matches.length >= MAX_SEARCH_RESULTS) {
            truncated = true;
            break;
          }
        }
        let stat;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          continue;
        }
        if (!stat.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) continue;
        if (scannedBytes + stat.size > MAX_SEARCH_BYTES) {
          truncated = true;
          break;
        }
        let buffer;
        try {
          buffer = await fs.readFile(fullPath);
        } catch {
          continue;
        }
        if (buffer.includes(0)) continue;
        scannedBytes += buffer.length;
        const lines = buffer.toString('utf8').split(/\r?\n/u);
        let fileMatches = 0;
        for (let index = 0; index < lines.length; index += 1) {
          if (!lines[index].toLocaleLowerCase('zh-CN').includes(needle))
            continue;
          const excerpt = lines[index].trim().slice(0, 160);
          matches.push({
            relativePath,
            kind: 'content',
            line: index + 1,
            excerpt,
          });
          fileMatches += 1;
          if (matches.length >= MAX_SEARCH_RESULTS) {
            truncated = true;
            break;
          }
          if (fileMatches >= MAX_MATCHES_PER_FILE) break;
        }
        if (truncated) break;
      }
    }

    return {
      root,
      query: normalizedQuery,
      matches,
      truncated,
      scannedFiles,
    };
  }

  async read({ workspacePath, relativePath }) {
    const root = await this.resolveRoot(workspacePath);
    const target = await this.resolveTarget(root, relativePath);
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      throw Object.assign(new Error('目标不是文件。'), {
        code: 'workspace_file_not_file',
      });
    }
    if (stat.size > MAX_FILE_BYTES) {
      throw Object.assign(new Error('文件超过 64 KB，暂不预览。'), {
        code: 'workspace_file_too_large',
      });
    }
    const buffer = await fs.readFile(target);
    if (buffer.includes(0)) {
      throw Object.assign(new Error('二进制文件暂不预览。'), {
        code: 'workspace_file_binary',
      });
    }
    return {
      relativePath: relativeInside(root, target).split(path.sep).join('/'),
      size: buffer.length,
      content: buffer.toString('utf8'),
    };
  }

  async readImage({ workspacePath, relativePath }) {
    const root = await this.resolveRoot(workspacePath);
    const target = await this.resolveTarget(root, relativePath);
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      throw Object.assign(new Error('目标不是文件。'), {
        code: 'workspace_file_not_file',
      });
    }
    const mime = IMAGE_MIME_TYPES.get(path.extname(target).toLowerCase());
    if (!mime) {
      throw Object.assign(new Error('这个文件不是支持的图片格式。'), {
        code: 'workspace_file_image_unsupported',
      });
    }
    if (stat.size > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error('图片超过 8 MB，暂不预览。'), {
        code: 'workspace_file_too_large',
      });
    }
    const buffer = await fs.readFile(target);
    return {
      relativePath: relativeInside(root, target).split(path.sep).join('/'),
      size: buffer.length,
      mime,
      dataBase64: buffer.toString('base64'),
    };
  }

  async openFolder({ workspacePath }) {
    const root = await this.resolveRoot(workspacePath);
    if (!this.openPath) {
      throw Object.assign(new Error('当前环境不能打开文件夹。'), {
        code: 'workspace_file_open_unavailable',
      });
    }
    const error = await this.openPath(root);
    if (error) {
      throw Object.assign(new Error(`打开文件夹失败：${error}`), {
        code: 'workspace_file_open_failed',
      });
    }
    return { root };
  }
}
