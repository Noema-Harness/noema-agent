export function workspaceFileChangeError(code: string, message: string) {
  const error: Error & { code?: string } = new Error(message);
  error.code = code;
  return error;
}
