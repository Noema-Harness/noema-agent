import path from 'node:path';

/**
 * Allows isolated dev/E2E databases without copying or re-encrypting the user's
 * OS-protected FreeLLMAPI credential. Packaged apps always use their own data.
 * @param {{userDataPath:string,isPackaged:boolean,testDatabasePath?:string|null}} input
 */
export function resolveNoemaDatabasePath({
  userDataPath,
  isPackaged,
  testDatabasePath = null,
}) {
  if (typeof testDatabasePath === 'string' && testDatabasePath && !isPackaged) {
    return path.resolve(testDatabasePath);
  }
  return path.join(userDataPath, 'noema.sqlite3');
}

/**
 * Allows isolated DSH worker state for unpackaged end-to-end tests while keeping
 * OS-encrypted provider credentials in Electron's normal userData directory.
 * @param {{userDataPath:string,isPackaged:boolean,testDatabasePath?:string|null,testDshUserDataPath?:string|null}} input
 */
export function resolveNoemaDshUserDataPath({
  userDataPath,
  isPackaged,
  testDatabasePath = null,
  testDshUserDataPath = null,
}) {
  if (
    !isPackaged &&
    typeof testDatabasePath === 'string' &&
    testDatabasePath.trim() &&
    typeof testDshUserDataPath === 'string' &&
    path.isAbsolute(testDshUserDataPath)
  ) {
    return path.resolve(testDshUserDataPath);
  }
  return userDataPath;
}
