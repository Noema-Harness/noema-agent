import path from 'node:path';
import { WINDOWS_RUNNER_POLICY_VERSION } from './windows-runner-package-contract.mjs';

const REQUIRED_CAPABILITIES = [
  'filesystemDefaultDeny',
  'filesystemReadAllowlist',
  'filesystemWriteAllowlist',
  'pathIdentityValidation',
  'workingDirectoryConfinement',
  'environmentConfinement',
  'networkDefaultDeny',
];
const WINDOWS_ENVIRONMENT_ALLOW_NAMES = [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'LOCALAPPDATA',
];

function denial(code) {
  return { ok: false, code };
}

function normalizedLocalPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_000 ||
    !path.win32.isAbsolute(value) ||
    value.startsWith('\\\\') ||
    value.startsWith('//')
  ) {
    return undefined;
  }
  if (hasAmbiguousWin32Component(value)) return undefined;
  const normalized = path.win32.normalize(value);
  const root = path.win32.parse(normalized).root;
  if (
    normalized.toLowerCase() === root.toLowerCase() ||
    normalized.startsWith('\\\\?\\') ||
    normalized.startsWith('\\\\.\\')
  ) {
    return undefined;
  }
  return normalized;
}

function hasAmbiguousWin32Component(value) {
  const components = value.replaceAll('/', '\\').slice(3).split('\\');
  return components.some((component) => {
    if (
      component === '.' ||
      component === '..' ||
      component.endsWith('.') ||
      component.endsWith(' ') ||
      /[<>:"|?*\u0000-\u001f]/u.test(component)
    ) {
      return true;
    }
    const deviceStem = component
      .split('.', 1)[0]
      .replace(/[ .]+$/gu, '')
      .toUpperCase();
    return /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/u.test(deviceStem);
  });
}

function pathKey(value) {
  return path.win32.normalize(value).toLowerCase();
}

function isWithin(root, candidate) {
  const relative = path.win32.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.win32.sep}`) &&
      !path.win32.isAbsolute(relative))
  );
}

function validatedRoot(root) {
  if (!root || typeof root !== 'object') {
    return undefined;
  }
  const normalized = normalizedLocalPath(root.path);
  const identity = root.fileIdentity;
  if (
    !normalized ||
    !identity ||
    typeof identity.volumeSerialNumber !== 'string' ||
    typeof identity.fileIndex !== 'string' ||
    !validIdentityInteger(identity.volumeSerialNumber, 4_294_967_295n) ||
    !validIdentityInteger(identity.fileIndex, 18_446_744_073_709_551_615n)
  ) {
    return undefined;
  }
  return {
    path: normalized,
    fileIdentity: {
      volumeSerialNumber: identity.volumeSerialNumber,
      fileIndex: identity.fileIndex,
    },
  };
}

function validIdentityInteger(value, maximum) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= maximum;
  } catch {
    return false;
  }
}

function pathRoot(root) {
  return { path: root.path, fileIdentity: root.fileIdentity };
}

/**
 * Compile already-authorized Windows command grants into a minimal backend
 * policy. This function does not establish OS enforcement or enable execution.
 */
export function compileWindowsCommandPolicy(input) {
  if (!input || typeof input !== 'object') {
    return denial('invalid_request');
  }
  const {
    backend,
    requestId,
    workspace,
    externalAccess,
    runtimeReadRoots,
    cwd,
    filesystemMode,
  } = input;
  if (
    !backend ||
    typeof backend.id !== 'string' ||
    !backend.id.trim() ||
    typeof backend.version !== 'string' ||
    !backend.version.trim() ||
    backend.policyVersion !== WINDOWS_RUNNER_POLICY_VERSION
  ) {
    return denial('backend_identity_unavailable');
  }
  if (!['read-only', 'read-write'].includes(filesystemMode)) {
    return denial('invalid_filesystem_mode');
  }
  if (
    typeof requestId !== 'string' ||
    requestId.length < 16 ||
    requestId.length > 128 ||
    !/^[A-Za-z0-9_-]+$/u.test(requestId)
  ) {
    return denial('invalid_request_identity');
  }
  const capabilities = backend.capabilities;
  if (
    !capabilities ||
    REQUIRED_CAPABILITIES.some((name) => capabilities[name] !== true)
  ) {
    return denial('required_backend_capability_missing');
  }

  const workspaceRoot = validatedRoot(workspace);
  const workingDirectory = validatedRoot(cwd);
  if (!workspaceRoot || !workingDirectory) {
    return denial('path_identity_unverified');
  }
  if (!isWithin(workspaceRoot.path, workingDirectory.path)) {
    return denial('working_directory_outside_workspace');
  }
  if (!Array.isArray(externalAccess) || externalAccess.length > 4) {
    return denial('invalid_external_grants');
  }
  if (!Array.isArray(runtimeReadRoots) || runtimeReadRoots.length > 32) {
    return denial('invalid_runtime_roots');
  }

  const readRoots = new Map([[pathKey(workspaceRoot.path), workspaceRoot]]);
  const writeRoots = new Map(
    filesystemMode === 'read-write'
      ? [[pathKey(workspaceRoot.path), workspaceRoot]]
      : [],
  );
  const externalRoots = [];
  for (const grant of externalAccess) {
    if (
      !grant ||
      typeof grant !== 'object' ||
      !['read', 'write'].includes(grant.access)
    ) {
      return denial('invalid_external_grants');
    }
    const root = validatedRoot(grant);
    if (!root) return denial('path_identity_unverified');
    if (filesystemMode === 'read-only' && grant.access === 'write') {
      return denial('write_access_unavailable');
    }
    if (isWithin(workspaceRoot.path, root.path)) continue;
    if (isWithin(root.path, workspaceRoot.path)) {
      return denial('external_grant_contains_workspace');
    }
    const key = pathKey(root.path);
    externalRoots.push(root);
    readRoots.set(key, root);
    if (grant.access === 'write') writeRoots.set(key, root);
  }
  for (const runtimeRootInput of runtimeReadRoots) {
    const root = validatedRoot(runtimeRootInput);
    if (!root) return denial('path_identity_unverified');
    const key = pathKey(root.path);
    if (readRoots.has(key)) continue;
    if (
      isWithin(root.path, workspaceRoot.path) ||
      externalRoots.some((externalRoot) =>
        isWithin(root.path, externalRoot.path),
      )
    ) {
      return denial('runtime_root_widens_read_access');
    }
    readRoots.set(key, root);
  }

  const networkMode = input.network?.mode;
  if (!['deny', 'prompt-per-destination'].includes(networkMode)) {
    return denial('invalid_network_mode');
  }
  if (
    networkMode === 'prompt-per-destination' &&
    capabilities.identityBoundNetworkBroker !== true
  ) {
    return denial('identity_bound_network_unavailable');
  }

  return {
    ok: true,
    policy: {
      version: WINDOWS_RUNNER_POLICY_VERSION,
      backend: { id: backend.id, version: backend.version },
      requestId,
      workspaceRoot: pathRoot(workspaceRoot),
      filesystem: {
        mode: filesystemMode,
        readRoots: [...readRoots.values()]
          .sort((a, b) => pathKey(a.path).localeCompare(pathKey(b.path)))
          .map(pathRoot),
        writeRoots: [...writeRoots.values()]
          .sort((a, b) => pathKey(a.path).localeCompare(pathKey(b.path)))
          .map(pathRoot),
        defaultDeny: true,
      },
      workingDirectory: pathRoot(workingDirectory),
      environment: {
        inherit: false,
        allowNames: WINDOWS_ENVIRONMENT_ALLOW_NAMES,
      },
      network: {
        mode: networkMode,
        identity: requestId,
      },
    },
  };
}
