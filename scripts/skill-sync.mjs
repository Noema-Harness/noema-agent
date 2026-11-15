import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const SKILL_NAME = "noema-development";

export function repoSkillPath(root) {
  return path.join(root, "skills", SKILL_NAME, "SKILL.md");
}

export function profileSkillPath(home) {
  return path.join(home, ".dsh", "skills", SKILL_NAME, "SKILL.md");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function installSkill(root, home = os.homedir()) {
  const source = repoSkillPath(root);
  if (!fs.existsSync(source)) {
    throw new Error(`缺少仓库技能文件：${path.relative(root, source)}`);
  }
  const target = profileSkillPath(home);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return { source, target, hash: sha256(target) };
}

export function checkSkill(root, options = {}) {
  const home = options.home ?? process.env.NOEMA_SKILL_HOME ?? os.homedir();
  const inCi = options.ci ?? Boolean(process.env.CI);
  const errors = [];
  const notices = [];
  const source = repoSkillPath(root);
  if (!fs.existsSync(source)) {
    if (!fs.existsSync(path.join(root, "skills"))) {
      return { errors, notices };
    }
    errors.push("缺少 skills/noema-development/SKILL.md：开发运行手册没有源文件");
    return { errors, notices };
  }
  const target = profileSkillPath(home);
  if (!fs.existsSync(target)) {
    notices.push("项目治理技能未安装：npm run skill:install（AGENTS 仍是完整约束，不影响检查）");
    return { errors, notices };
  }
  if (sha256(source) !== sha256(target)) {
    const message =
      "已安装的项目治理技能与仓库不一致：npm run skill:install（仓库 skills/noema-development/SKILL.md 是源）";
    if (inCi) {
      notices.push(`CI 环境不比较本机技能副本：${message}`);
    } else {
      errors.push(message);
    }
  }
  return { errors, notices };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "check";
  const root = process.cwd();
  if (command === "install") {
    const { target, hash } = installSkill(root);
    console.log(`skill-install: OK ${target} (sha256 ${hash.slice(0, 12)})`);
  } else {
    const { errors, notices } = checkSkill(root);
    for (const notice of notices) console.log(`skill-check · ${notice}`);
    for (const error of errors) console.log(`skill-check: FAILED ${error}`);
    if (errors.length > 0) process.exit(1);
    console.log("skill-check: OK");
  }
}
