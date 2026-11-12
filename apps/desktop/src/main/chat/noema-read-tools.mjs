import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_READ_BYTES = 256 * 1024;
const MAX_SEARCH_FILES = 200;
const MAX_SEARCH_MATCHES = 80;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.vite',
]);

function tool(name, description, properties, handler) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      additionalProperties: false,
    },
    handler,
  };
}

function resolveTarget(home, requested, { allowHome = false } = {}) {
  const candidate =
    typeof requested === 'string' && requested.trim()
      ? path.isAbsolute(requested)
        ? path.normalize(requested)
        : path.resolve(home, requested)
      : home;
  const target = realpathSync(candidate);
  if (!allowHome && target === home) {
    throw new Error('请指定要读取的文件或目录。');
  }
  return target;
}

/**
 * Read-only machine inspection tools for the visible Noema profile.
 * Noema is a local personal agent: its scope is the machine, not a project
 * workspace. Relative paths resolve from the user's home directory; absolute
 * paths are allowed. There is no write, shell, or process execution surface.
 */
export function createNoemaReadTools({ home = homedir() } = {}) {
  const root = realpathSync(path.resolve(home));

  return [
    tool(
      'read_file',
      'Read a UTF-8 text file on this machine. Use an absolute path or a path relative to the user home. Read-only; never modifies files.',
      {
        path: {
          type: 'string',
          description: 'Absolute path, or path relative to the user home.',
        },
      },
      async ({ path: requested }) => {
        const target = resolveTarget(root, requested);
        const info = await stat(target);
        if (!info.isFile()) throw new Error('目标不是文件。');
        if (info.size > MAX_READ_BYTES)
          throw new Error('文件超过 256 KiB，未读取。');
        const content = await readFile(target, 'utf8');
        return {
          path: target.replaceAll('\\', '/'),
          bytes: info.size,
          content,
        };
      },
    ),
    tool(
      'list_files',
      'List files and folders on this machine. Use an absolute path or a path relative to the user home. Read-only.',
      {
        path: {
          type: 'string',
          description:
            'Optional absolute directory, or directory relative to the user home. Defaults to the user home.',
        },
      },
      async ({ path: requested } = {}) => {
        const target = resolveTarget(root, requested, { allowHome: true });
        const info = await stat(target);
        if (!info.isDirectory()) throw new Error('目标不是目录。');
        const entries = await readdir(target, { withFileTypes: true });
        return {
          path: target.replaceAll('\\', '/'),
          entries: entries
            .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
            .slice(0, 200)
            .map((entry) => ({
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
            })),
        };
      },
    ),
    tool(
      'search_text',
      'Search UTF-8 text files on this machine. Use an absolute path or a path relative to the user home. Read-only; returns matching lines.',
      {
        query: { type: 'string', description: 'Literal text to find.' },
        path: {
          type: 'string',
          description:
            'Optional absolute directory, or directory relative to the user home. Defaults to the user home.',
        },
      },
      async ({ query, path: requested } = {}) => {
        const needle = typeof query === 'string' ? query.trim() : '';
        if (!needle) throw new Error('搜索词不能为空。');
        if (needle.length > 200) throw new Error('搜索词过长。');
        const start = resolveTarget(root, requested, { allowHome: true });
        const matches = [];
        let visited = 0;
        const walk = async (directory) => {
          if (
            visited >= MAX_SEARCH_FILES ||
            matches.length >= MAX_SEARCH_MATCHES
          )
            return;
          const entries = await readdir(directory, { withFileTypes: true });
          for (const entry of entries) {
            if (
              visited >= MAX_SEARCH_FILES ||
              matches.length >= MAX_SEARCH_MATCHES
            )
              return;
            if (entry.isDirectory()) {
              if (!IGNORED_DIRECTORIES.has(entry.name))
                await walk(path.join(directory, entry.name));
              continue;
            }
            if (!entry.isFile()) continue;
            visited += 1;
            const file = path.join(directory, entry.name);
            let text;
            try {
              if ((await stat(file)).size > MAX_READ_BYTES) continue;
              text = await readFile(file, 'utf8');
            } catch {
              continue;
            }
            if (text.includes('\u0000')) continue;
            const lines = text.split(/\r?\n/u);
            for (let index = 0; index < lines.length; index += 1) {
              if (!lines[index].includes(needle)) continue;
              matches.push({
                path: file.replaceAll('\\', '/'),
                line: index + 1,
                text: lines[index].slice(0, 300),
              });
              if (matches.length >= MAX_SEARCH_MATCHES) return;
            }
          }
        };
        await walk(start);
        return {
          path: start.replaceAll('\\', '/'),
          visited,
          matches,
        };
      },
    ),
  ];
}

export async function resolveWorkspaceRealPath(workspacePath) {
  return realpath(path.resolve(workspacePath));
}
