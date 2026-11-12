import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Node cannot spawn a `.cmd`/`.bat` shim without a shell, so the repository's
// Node tooling must resolve a real git executable itself. This keeps
// `npm run workspace:check` working in harnesses whose PATH exposes
// `NoemaTools\dsh\git.cmd` (a DSH shim) instead of `git.exe`.
export function resolveGitExecutable({ env = process.env, platform = process.platform } = {}) {
  const override = env.NOEMA_GIT;
  if (override && fs.existsSync(override)) return override;

  if (platform === "win32") {
    const candidates = [
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "NoemaTools", "git", "cmd", "git.exe"),
      env.ProgramFiles && path.join(env.ProgramFiles, "Git", "cmd", "git.exe"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Git", "cmd", "git.exe"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe"),
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    try {
      const listed = execFileSync("where.exe", ["git"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      });
      const executable = listed
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => /\.exe$/iu.test(line) && fs.existsSync(line));
      if (executable) return executable;
    } catch {
      // Fall through to the bare command below.
    }
  }

  return "git";
}

export function runGit(args, options = {}) {
  return execFileSync(resolveGitExecutable(), args, {
    windowsHide: true,
    ...options,
  });
}
