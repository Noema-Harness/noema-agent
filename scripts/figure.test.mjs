import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  FIGURES,
  candidateHash,
  checkFigure,
  checkFigures,
  checkGovernanceFigure,
  collectSectionHashes,
  evaluateFigureFreshness,
  parseDocumentSections,
  sectionDigest,
} from "./figure.mjs";

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function architectureDoc({ topology = "拓扑。", execution = "路径。", map = "地图。" } = {}) {
  return [
    "# ARCHITECTURE",
    "",
    "## 2. 进程与依赖方向",
    "",
    "结构。",
    "",
    "## 3. 组织对象与会话拓扑",
    "",
    "### 3.1 AgentRuntime 核心",
    "",
    topology,
    "",
    "### 3.2 当前实现",
    "",
    "实现。",
    "",
    "## 5. 一次执行的路径",
    "",
    execution,
    "",
    "## 6. 代码地图",
    "",
    map,
    "",
  ].join("\n");
}

function makeRoot({ withReadmeLinks = true, archDoc = architectureDoc() } = {}) {
  const root = path.join(".work", "runs", `figure-${process.pid}-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(path.join(root, "docs", "assets"), { recursive: true });
  const html = Buffer.from("<html>figure</html>");
  const png = Buffer.from("PNGDATA-0123456789");
  fs.writeFileSync(path.join(root, "docs", "ARCHITECTURE.md"), archDoc);
  fs.writeFileSync(path.join(root, "docs", "assets", "noema-architecture.html"), html);
  fs.writeFileSync(path.join(root, "docs", "assets", "noema-architecture.png"), png);
  const candidate = {
    diagram_type: "architecture",
    meta: { title: "fixture", output: "docs/assets/noema-architecture.html" },
  };
  const record = {
    version: 1,
    source: {
      doc: "docs/ARCHITECTURE.md",
      sha256: sha256(Buffer.from(archDoc)),
      sections: collectSectionHashes(archDoc, FIGURES.architecture.sections),
      candidateSha256: candidateHash(candidate),
    },
    assets: {
      html: {
        path: "docs/assets/noema-architecture.html",
        sha256: sha256(html),
        bytes: html.length,
      },
      png: {
        path: "docs/assets/noema-architecture.png",
        sha256: sha256(png),
        bytes: png.length,
      },
    },
    updatedAt: "2026-11-15T00:00:00.000Z",
    candidate,
  };
  fs.writeFileSync(
    path.join(root, "docs", "assets", "noema-architecture.source.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(root, "README.md"),
    withReadmeLinks
      ? "![架构](docs/assets/noema-architecture.png)\n\n[交互版](docs/assets/noema-architecture.html)\n"
      : "# README\n",
  );
  return root;
}

function readRecord(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, "docs", "assets", file), "utf8"));
}

test("figure gate passes on a consistent record and catches each drift", () => {
  const root = makeRoot();
  try {
    assert.deepEqual(checkFigure(root).errors, []);

    fs.writeFileSync(path.join(root, "docs", "ARCHITECTURE.md"), "# ARCHITECTURE\n\n结构变了。\n");
    const staleDoc = checkFigure(root).errors;
    assert.ok(
      staleDoc.some((error) => /已变化.*figure:build/u.test(error)),
      staleDoc.join("\n"),
    );

    const untouched = makeRoot();
    try {
      fs.writeFileSync(
        path.join(untouched, "docs", "assets", "noema-architecture.png"),
        "tampered",
      );
      const stalePng = checkFigure(untouched).errors;
      assert.ok(
        stalePng.some((error) => /noema-architecture\.png 与源文件记录不一致/u.test(error)),
        stalePng.join("\n"),
      );
    } finally {
      fs.rmSync(untouched, { recursive: true, force: true });
    }

    const noLinks = makeRoot({ withReadmeLinks: false });
    try {
      const missing = checkFigure(noLinks).errors;
      assert.ok(
        missing.some((error) =>
          /README\.md 没有引用 docs\/assets\/noema-architecture\.png/u.test(error),
        ),
        missing.join("\n"),
      );
    } finally {
      fs.rmSync(noLinks, { recursive: true, force: true });
    }

    const noSource = makeRoot();
    try {
      fs.rmSync(path.join(noSource, "docs", "assets", "noema-architecture.source.json"));
      const missingSource = checkFigure(noSource).errors;
      assert.ok(
        missingSource.some((error) => /缺少架构图源文件/u.test(error)),
        missingSource.join("\n"),
      );
    } finally {
      fs.rmSync(noSource, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("changing a section the figure depends on asks for a judgement, not a silent rebuild", () => {
  const root = makeRoot();
  try {
    const docPath = path.join(root, "docs", "ARCHITECTURE.md");
    fs.writeFileSync(docPath, architectureDoc({ execution: "路径变了。" }));

    const errors = checkFigure(root).errors;
    assert.ok(
      errors.some((error) => /图依赖章节在出图后变化（5\. 一次执行的路径）/u.test(error)),
      errors.join("\n"),
    );

    const record = readRecord(root, "noema-architecture.source.json");
    const sectionsNow = collectSectionHashes(
      fs.readFileSync(docPath, "utf8"),
      FIGURES.architecture.sections,
    );
    const unchangedCandidate = candidateHash(record.candidate);

    const blocked = evaluateFigureFreshness({
      source: record.source,
      sectionsNow,
      candidateSha256Now: unchangedCandidate,
    });
    assert.equal(blocked.needsJudgement, true);
    assert.deepEqual(blocked.driftedTitles, ["5. 一次执行的路径"]);

    const redrawn = evaluateFigureFreshness({
      source: record.source,
      sectionsNow,
      candidateSha256Now: "different-candidate",
    });
    assert.equal(redrawn.needsJudgement, false);

    const judged = evaluateFigureFreshness({
      source: {
        ...record.source,
        rationale: { text: "只改了措辞，图不需要改。", sectionsDigest: sectionDigest(sectionsNow) },
      },
      sectionsNow,
      candidateSha256Now: unchangedCandidate,
    });
    assert.equal(judged.needsJudgement, false);
    assert.equal(judged.rationaleCovers, true);

    // 章节再次变化时，旧理由不再覆盖新的状态，必须重新判断。
    const laterSections = collectSectionHashes(
      architectureDoc({ execution: "路径又变了。" }),
      FIGURES.architecture.sections,
    );
    const stale = evaluateFigureFreshness({
      source: {
        ...record.source,
        rationale: { text: "只改了措辞，图不需要改。", sectionsDigest: sectionDigest(sectionsNow) },
      },
      sectionsNow: laterSections,
      candidateSha256Now: unchangedCandidate,
    });
    assert.equal(stale.needsJudgement, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hand-editing the candidate without rebuilding fails the gate", () => {
  const root = makeRoot();
  try {
    const sourcePath = path.join(root, "docs", "assets", "noema-architecture.source.json");
    const record = readRecord(root, "noema-architecture.source.json");
    record.candidate.meta.title = "手改的标题";
    fs.writeFileSync(sourcePath, `${JSON.stringify(record, null, 2)}\n`);

    const errors = checkFigure(root).errors;
    assert.ok(
      errors.some((error) => /candidate 与出图记录不一致/u.test(error)),
      errors.join("\n"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sections are cut by heading level and hashed by body", () => {
  const doc = [
    "# T",
    "",
    "## A",
    "",
    "父。",
    "",
    "### A1",
    "",
    "子。",
    "",
    "## B",
    "",
    "另一节。",
    "",
  ].join("\n");
  const sections = parseDocumentSections(doc);
  assert.ok(sections.get("A").includes("### A1"));
  assert.equal(sections.get("A1"), "子。");
  assert.equal(sections.get("B"), "另一节。");

  const hashes = collectSectionHashes(doc, ["A", "missing"]);
  assert.equal(hashes[0].sha256, sha256(Buffer.from(sections.get("A"))));
  assert.equal(hashes[1].sha256, null);
});

test("the governance figure has its own source, anchors and check", () => {
  const root = makeRoot();
  try {
    const missing = checkGovernanceFigure(root).errors;
    assert.ok(
      missing.some((error) => /缺少治理全景图源文件/u.test(error)),
      missing.join("\n"),
    );

    const combined = checkFigures(root).errors;
    assert.ok(
      combined.some((error) => /\[治理全景图\] 缺少治理全景图源文件/u.test(error)),
      combined.join("\n"),
    );

    const governanceHtml = Buffer.from("<html>governance</html>");
    const png = Buffer.from("GOVPNG-0123456789");
    const readme = [
      "# Governance",
      "",
      "![治理全景](governance/assets/governance-map.png)",
      "",
      "[交互版](governance/assets/governance-map.html)",
      "",
      "## 三层结构",
      "",
      "三层。",
      "",
      "## 四道门",
      "",
      "四道。",
      "",
      "## 三阶段规则包",
      "",
      "规则包。",
      "",
      "## 条目生命周期",
      "",
      "生命周期。",
      "",
    ].join("\n");
    const agents = [
      "# AGENTS",
      "",
      "![治理](governance/assets/governance-map.png)",
      "",
      "[交互版](governance/assets/governance-map.html)",
      "",
      "## 阶段地图",
      "",
      "地图。",
      "",
    ].join("\n");
    const candidate = {
      diagram_type: "architecture",
      meta: { title: "governance", output: "governance/assets/governance-map.html" },
    };
    fs.mkdirSync(path.join(root, "governance", "assets"), { recursive: true });
    fs.writeFileSync(path.join(root, "governance", "README.md"), readme);
    fs.writeFileSync(path.join(root, "AGENTS.md"), agents);
    fs.writeFileSync(
      path.join(root, "governance", "assets", "governance-map.html"),
      governanceHtml,
    );
    fs.writeFileSync(path.join(root, "governance", "assets", "governance-map.png"), png);
    fs.writeFileSync(
      path.join(root, "governance", "assets", "governance-map.source.json"),
      JSON.stringify(
        {
          version: 1,
          source: {
            doc: "governance/README.md",
            sha256: sha256(Buffer.from(readme)),
            sections: collectSectionHashes(readme, FIGURES.governance.sections),
            candidateSha256: candidateHash(candidate),
          },
          assets: {
            html: {
              path: "governance/assets/governance-map.html",
              sha256: sha256(governanceHtml),
              bytes: governanceHtml.length,
            },
            png: {
              path: "governance/assets/governance-map.png",
              sha256: sha256(png),
              bytes: png.length,
            },
          },
          updatedAt: "2026-11-16T00:00:00.000Z",
          candidate,
        },
        null,
        2,
      ),
    );

    assert.deepEqual(checkGovernanceFigure(root).errors, []);
    assert.deepEqual(checkFigures(root).errors, []);

    fs.writeFileSync(
      path.join(root, "governance", "README.md"),
      "# Governance\n\n治理结构变了。\n",
    );
    const stale = checkGovernanceFigure(root).errors;
    assert.ok(
      stale.some((error) => /governance\/README\.md 在出图后已变化/u.test(error)),
      stale.join("\n"),
    );
    fs.writeFileSync(path.join(root, "governance", "README.md"), readme);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PR mode turns figure drift into a notice instead of a failure", () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, "docs", "ARCHITECTURE.md"), "# ARCHITECTURE\n\n结构变了。\n");
    const soft = checkFigures(root, { soft: true });
    assert.deepEqual(soft.errors, []);
    assert.ok(
      soft.notices.some((notice) => /PR 只提示/u.test(notice)),
      soft.notices.join("\n"),
    );
    assert.ok(checkFigures(root).errors.length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
