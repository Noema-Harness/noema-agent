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
