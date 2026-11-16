#!/usr/bin/env node
/**
 * 用户向架构图的同步门槛与重出图工具。
 *
 * 事实源：`docs/assets/noema-architecture.source.json`
 *   - `candidate`：Archify 的架构图 IR（渲染输入）
 *   - `source.sha256`：生成这张图时的 `docs/ARCHITECTURE.md` 摘要
 *   - `assets.*`：已提交产物的摘要与字节数
 *
 * `check`：产物与源文件是否一致、README 是否引用（挂在 `npm run check`）。
 * `build`：用 Archify 重新 finalize，再用 Edge headless 截 PNG，最后回写摘要。
 *   `build` 依赖本机 Archify 技能与 Edge，只在维护者本机运行；CI 只跑 `check`。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * 两张图，各自的读者不同：
 * - architecture：用户向，入口是 README，源是 docs/ARCHITECTURE.md（产品结构）。
 * - governance：维护者向，入口是 AGENTS.md，源是 AGENTS.md（治理结构）。
 * 每张图都必须有它的入口引用，否则图会被忘掉。
 */
export const FIGURES = {
  architecture: {
    key: "architecture",
    label: "架构图",
    source: "docs/assets/noema-architecture.source.json",
    html: "docs/assets/noema-architecture.html",
    png: "docs/assets/noema-architecture.png",
    doc: "docs/ARCHITECTURE.md",
    anchors: ["README.md"],
  },
  governance: {
    key: "governance",
    label: "治理全景图",
    source: "docs/assets/noema-governance.source.json",
    html: "docs/assets/noema-governance.html",
    png: "docs/assets/noema-governance.png",
    doc: "AGENTS.md",
    anchors: ["AGENTS.md"],
  },
};

export const FIGURE = FIGURES.architecture;

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const sha256File = (file) => sha256(fs.readFileSync(file));
const sizeOf = (file) => fs.statSync(file).size;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function checkOne(root, figure) {
  const errors = [];
  const notices = [];
  const at = (relative) => path.join(root, relative);
  const sourcePath = at(figure.source);

  if (!fs.existsSync(sourcePath)) {
    return {
      errors: [`缺少${figure.label}源文件 ${figure.source}：用 npm run figure:build 生成一次`],
      notices,
    };
  }

  let source;
  try {
    source = readJson(sourcePath);
  } catch (error) {
    return { errors: [`${figure.source} 不是合法 JSON：${error.message}`], notices };
  }

  if (source?.source?.doc !== figure.doc) {
    errors.push(
      `${figure.source} 的 source.doc 应为 ${figure.doc}，实际是 ${source?.source?.doc ?? "(缺失)"}`,
    );
  } else if (!fs.existsSync(at(figure.doc))) {
    errors.push(`缺少 ${figure.doc}`);
  } else {
    const actual = sha256File(at(figure.doc));
    if (actual !== source.source.sha256) {
      errors.push(
        `${figure.doc} 在出图后已变化（${actual.slice(0, 12)} ≠ ${String(source.source.sha256).slice(0, 12)}）：先更新图，再改它的源文档；运行 npm run figure:build`,
      );
    }
  }

  for (const key of ["html", "png"]) {
    const expected = source?.assets?.[key];
    const file = at(figure[key]);
    if (!expected) {
      errors.push(`${figure.source} 缺少 assets.${key}`);
      continue;
    }
    if (!fs.existsSync(file)) {
      errors.push(`缺少${figure.label}产物 ${figure[key]}：运行 npm run figure:build`);
      continue;
    }
    const actual = sha256File(file);
    if (actual !== expected.sha256) {
      errors.push(
        `${figure[key]} 与源文件记录不一致：运行 npm run figure:build 重出图，不要手改产物`,
      );
    } else if (sizeOf(file) !== expected.bytes) {
      errors.push(`${figure[key]} 字节数与源文件记录不一致：运行 npm run figure:build`);
    }
    notices.push(`${figure[key]} 与记录一致（${expected.bytes} 字节）`);
  }

  for (const anchor of figure.anchors) {
    const anchorPath = at(anchor);
    if (!fs.existsSync(anchorPath)) {
      errors.push(`缺少${figure.label}的入口文件 ${anchor}`);
      continue;
    }
    const anchorText = fs.readFileSync(anchorPath, "utf8");
    for (const key of ["png", "html"]) {
      if (!anchorText.includes(figure[key])) {
        errors.push(
          `${anchor} 没有引用 ${figure[key]}：${figure.label}是入口，${anchor} 必须指向它`,
        );
      }
    }
  }

  return { errors, notices };
}

export function checkFigure(root = process.cwd()) {
  return checkOne(root, FIGURES.architecture);
}

export function checkGovernanceFigure(root = process.cwd()) {
  return checkOne(root, FIGURES.governance);
}

export function checkFigures(root = process.cwd(), options = {}) {
  const soft = options.soft === true;
  const errors = [];
  const notices = [];
  for (const figure of Object.values(FIGURES)) {
    const result = checkOne(root, figure);
    errors.push(...result.errors.map((error) => `[${figure.label}] ${error}`));
    notices.push(...result.notices.map((notice) => `[${figure.label}] ${notice}`));
  }
  if (!soft) return { errors, notices };
  // PR 门只提示：架构图是维护者资产，协作者不该为了过门而声明或等待重出图。
  return {
    errors: [],
    notices: [
      ...notices,
      ...errors.map((error) => `${error}（PR 只提示：图由维护者在合并前后重出）`),
    ],
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findEdge() {
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/microsoft-edge",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function capturePng(root, htmlPath, pngPath, { scale = 1.4 } = {}) {
  const edge = findEdge();
  if (!edge) throw new Error("找不到 Edge：PNG 截图需要 msedge headless");
  const wsPath = path.join(root, "apps/desktop/node_modules/ws/wrapper.mjs");
  if (!fs.existsSync(wsPath)) throw new Error(`找不到 ${wsPath}（截图依赖 desktop 的 ws）`);
  const { WebSocket } = await import(pathToFileURL(wsPath).href);

  const port = 9411 + Math.floor(Math.random() * 400);
  const profile = path.join(os.tmpdir(), `noema-figure-${Date.now()}`);
  const child = spawn(
    edge,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    let wsUrl = null;
    for (let attempt = 0; attempt < 80 && !wsUrl; attempt += 1) {
      try {
        const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
          response.json(),
        );
        wsUrl = list.find((item) => item.type === "page")?.webSocketDebuggerUrl ?? null;
      } catch {
        // CDP 还没起来
      }
      if (!wsUrl) await sleep(250);
    }
    if (!wsUrl) throw new Error("CDP endpoint 未出现");

    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    let nextId = 1;
    const pending = new Map();
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });

    await send("Page.enable");
    await send("Page.navigate", {
      url: pathToFileURL(htmlPath).href,
    });
    await sleep(2600);

    const bounds = await send("Runtime.evaluate", {
      expression: `(() => {
        for (const element of document.querySelectorAll('body *')) {
          const position = getComputedStyle(element).position;
          if (position === 'fixed' || position === 'sticky') element.style.display = 'none';
        }
        for (const element of document.querySelectorAll('.no-print, .toolbar, .archify-toast, .node-index, .stage')) {
          element.style.display = 'none';
        }
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        const svg = document.querySelector('svg');
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        const cards = document.querySelector('.cards');
        const bottom = cards ? cards.getBoundingClientRect().bottom : rect.bottom;
        return {
          x: 0,
          y: rect.y,
          width: document.documentElement.clientWidth,
          height: Math.min(bottom, 4000) - rect.y,
        };
      })()`,
      returnByValue: true,
    });
    const clip = bounds?.result?.result?.value;
    if (!clip) throw new Error("页面里没有架构图 svg");

    const shot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { ...clip, scale },
    });
    fs.writeFileSync(pngPath, Buffer.from(shot.result.data, "base64"));
    socket.close();
  } finally {
    child.kill();
    await sleep(300);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // Windows 可能短暂占用临时 profile，交给系统回收
    }
  }
}

function archifyBin(root, source) {
  const configured = process.env.ARCHIFY_BIN;
  if (configured) return configured;
  const local = path.join(os.homedir(), ".dsh", "skills", "archify", "bin", "archify.mjs");
  if (fs.existsSync(local)) return local;
  throw new Error(
    `找不到 Archify（可设 ARCHIFY_BIN 指到 archify.mjs）；源文件 ${FIGURE.source} 里的 candidate 是渲染输入`,
  );
}

async function buildOne(root, figure, { log }) {
  const at = (relative) => path.join(root, relative);
  const sourcePath = at(figure.source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`缺少 ${figure.source}：先按 docs/OPERATIONS.md 生成一次图源`);
  }
  const record = readJson(sourcePath);
  const candidate = record?.candidate;
  if (!candidate) throw new Error(`${figure.source} 缺少 candidate`);

  const candidateDir = at(".archify/figure-build");
  fs.mkdirSync(candidateDir, { recursive: true });
  const candidatePath = path.join(candidateDir, "candidate.json");
  candidate.meta = { ...candidate.meta, output: figure.html };
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");

  const assetsDir = at("docs/assets");
  const figureStem = path.basename(figure.html, ".html");
  const sidecarPattern = new RegExp(`^${figureStem}\\..*\\.json$`, "u");
  for (const name of fs.readdirSync(assetsDir)) {
    if (sidecarPattern.test(name) && !name.endsWith(".source.json")) {
      fs.rmSync(path.join(assetsDir, name), { force: true });
    }
  }

  const bin = archifyBin(root);
  const quality = candidate.meta?.quality_profile ?? "showcase";
  log(`figure: archify finalize → ${figure.html}`);
  const finalized = spawnSync(
    process.execPath,
    [
      bin,
      "finalize",
      "architecture",
      candidatePath,
      figure.html,
      "--repo-root",
      root,
      "--quality",
      quality,
      "--json",
    ],
    { cwd: root, encoding: "utf8", timeout: 180_000 },
  );
  const output = `${finalized.stdout ?? ""}${finalized.stderr ?? ""}`.trim();
  if (finalized.status !== 0) throw new Error(`archify finalize 失败：${output.slice(-800)}`);
  let result = null;
  for (const line of output.split(/\r?\n/u).reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      result = JSON.parse(line);
      break;
    } catch {
      // 继续找上一条 JSON
    }
  }
  if (!result?.ok) throw new Error(`archify finalize 未通过：${output.slice(-800)}`);

  const sidecars = fs
    .readdirSync(assetsDir)
    .filter((name) => sidecarPattern.test(name) && !name.endsWith(".source.json"));
  if (sidecars.length > 0) {
    const runDir = at(".work/archify-run");
    fs.mkdirSync(runDir, { recursive: true });
    for (const name of sidecars) {
      fs.rmSync(path.join(runDir, name), { force: true });
      fs.renameSync(path.join(assetsDir, name), path.join(runDir, name));
    }
  }

  log(`figure: capture ${figure.png}`);
  await capturePng(root, at(figure.html), at(figure.png));

  record.source = { doc: figure.doc, sha256: sha256File(at(figure.doc)) };
  record.assets = {
    html: {
      path: figure.html,
      sha256: sha256File(at(figure.html)),
      bytes: sizeOf(at(figure.html)),
    },
    png: {
      path: figure.png,
      sha256: sha256File(at(figure.png)),
      bytes: sizeOf(at(figure.png)),
    },
  };
  record.updatedAt = new Date().toISOString();
  fs.writeFileSync(sourcePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  log(
    `figure: done ${figure.key} html ${record.assets.html.bytes} bytes, png ${record.assets.png.bytes} bytes, source ${record.source.sha256.slice(0, 12)}`,
  );
  return record;
}

export async function buildFigure(
  root = process.cwd(),
  { log = console.log, figure = "architecture" } = {},
) {
  const target = FIGURES[figure];
  if (!target) throw new Error(`未知的图：${figure}`);
  return buildOne(root, target, { log });
}

export async function buildFigures(root = process.cwd(), { log = console.log } = {}) {
  const records = {};
  for (const figure of Object.values(FIGURES)) {
    records[figure.key] = await buildOne(root, figure, { log });
  }
  return records;
}

function report(label, { errors, notices }) {
  for (const notice of notices ?? []) console.log(`  · ${notice}`);
  if (errors.length === 0) {
    console.log(`${label}: OK`);
    return 0;
  }
  console.error(`${label}: FAILED (${errors.length})`);
  for (const error of errors) console.error(`  - ${error}`);
  return 1;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const command = process.argv[2] ?? "check";
  if (command === "check") {
    process.exitCode = report(
      "figure-check",
      checkFigures(process.cwd(), {
        soft: process.argv.includes("--soft") || process.env.NOEMA_FIGURE_SOFT === "1",
      }),
    );
  } else if (command === "build") {
    const name = process.argv[3] ?? "architecture";
    try {
      await (name === "all"
        ? buildFigures(process.cwd())
        : buildFigure(process.cwd(), { figure: name }));
    } catch (error) {
      console.error(`figure-build: FAILED\n  - ${error.message}`);
      process.exitCode = 1;
    }
  } else {
    console.error(`用法：node scripts/figure.mjs <check|build [architecture|governance|all]>`);
    process.exitCode = 2;
  }
}
