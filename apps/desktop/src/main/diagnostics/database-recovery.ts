import path from 'node:path';

export function readDatabaseHealth(
  db: import('better-sqlite3').Database | null | undefined,
) {
  if (!db || db.open !== true) return 'unavailable';
  try {
    return db.pragma('quick_check', { simple: true }) === 'ok'
      ? 'healthy'
      : 'problem';
  } catch {
    return 'unavailable';
  }
}

export async function openNoemaDataDirectory({
  shell,
  userDataPath,
}: {
  shell: { openPath: (path: string) => Promise<string> };
  userDataPath: string;
}) {
  if (
    !shell ||
    typeof shell.openPath !== 'function' ||
    typeof userDataPath !== 'string' ||
    !path.isAbsolute(userDataPath)
  ) {
    return { opened: false, errorCode: 'data_directory_unavailable' };
  }
  try {
    const error = await shell.openPath(userDataPath);
    return error === ''
      ? { opened: true, errorCode: null }
      : { opened: false, errorCode: 'data_directory_open_failed' };
  } catch {
    return { opened: false, errorCode: 'data_directory_open_failed' };
  }
}

export async function showDatabaseStartupFailure({
  dialog,
  shell,
  userDataPath,
  message,
}: {
  dialog: {
    showMessageBox: (
      options: import('electron').MessageBoxOptions,
    ) => Promise<import('electron').MessageBoxReturnValue>;
  };
  shell: { openPath: (path: string) => Promise<string> };
  userDataPath: string;
  message: string;
}) {
  const selection = await dialog.showMessageBox({
    type: 'error',
    title: 'Noema 无法启动',
    message,
    detail:
      '可打开 Noema 数据目录查看数据库和迁移快照。手动复制或恢复文件前，请先退出 Noema。此入口不会自动更改文件。',
    buttons: ['打开数据目录', '退出'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (selection?.response !== 0) return { opened: false, errorCode: null };
  const result = await openNoemaDataDirectory({ shell, userDataPath });
  if (!result.opened) {
    await dialog.showMessageBox({
      type: 'error',
      title: '数据目录无法打开',
      message: '请检查 Noema 数据目录权限后重试。',
      buttons: ['确定'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
  }
  return result;
}
