/**
 * Host platform facts, in one place.
 *
 * Owns: the per-OS rules that other modules need to start local tools —
 * path joining, executable names, npm's global package layout, which DSH shell
 * tool exists, and which environment variables a worker may inherit.
 * Entry: `hostPlatform(id)`; `id` defaults to the running host, and tests pass
 * another one to check a different OS's behaviour on any machine.
 * Invariant: callers ask this module instead of comparing `process.platform`
 * for these facts, so supporting another OS means adding one profile here.
 */
import path from 'node:path';

export type HostPlatformFamily = 'windows' | 'posix';

export interface HostPlatform {
  readonly id: NodeJS.Platform;
  readonly family: HostPlatformFamily;
  /** Path rules of the target OS, not of the machine running this code. */
  readonly paths: typeof path.posix;
  /** Executable file name for a program, e.g. `node` → `node.exe` on Windows. */
  executable(name: string): string;
  /** Directory that holds globally installed npm packages under a prefix. */
  npmGlobalModules(prefix: string): string;
  /** The sandboxed shell tool DSH ships for this OS. */
  readonly dshShellTool: 'tool-pwsh' | 'tool-bash';
  /**
   * Variables a local worker inherits: what the shell and Node need to find
   * home, temp and locale. Credentials and proxy settings stay out.
   */
  readonly workerEnvironment: readonly string[];
}

const windows: Omit<HostPlatform, 'id'> = {
  family: 'windows',
  paths: path.win32,
  executable: (name) => `${name}.exe`,
  npmGlobalModules: (prefix) => path.win32.join(prefix, 'node_modules'),
  dshShellTool: 'tool-pwsh',
  workerEnvironment: [
    'APPDATA',
    'COMSPEC',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'OS',
    'PATH',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'USERDOMAIN',
    'USERNAME',
    'USERPROFILE',
    'WINDIR',
  ],
};

const posix: Omit<HostPlatform, 'id'> = {
  family: 'posix',
  paths: path.posix,
  executable: (name) => name,
  npmGlobalModules: (prefix) => path.posix.join(prefix, 'lib', 'node_modules'),
  dshShellTool: 'tool-bash',
  workerEnvironment: [
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LOGNAME',
    'PATH',
    'SHELL',
    'TMPDIR',
    'USER',
  ],
};

export function hostPlatform(
  id: NodeJS.Platform = process.platform,
): HostPlatform {
  return { id, ...(id === 'win32' ? windows : posix) };
}
