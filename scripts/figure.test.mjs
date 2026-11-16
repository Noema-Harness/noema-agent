import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkFigure, checkFigures, checkGovernanceFigure } from './figure.mjs';

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function makeRoot({ withReadmeLinks = true } = {}) {
  const root = path.join('.work', 'runs', `figure-${process.pid}-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(path.join(root, 'docs', 'assets'), { recursive: true });
  const arch = '# ARCHITECTURE\n\n结构。\n';
  const html = Buffer.from('<html>figure</html>');
  const png = Buffer.from('PNGDATA-0123456789');
  fs.writeFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), arch);
  fs.writeFileSync(path.join(root, 'docs', 'assets', 'noema-architecture.html'), html);
  fs.writeFileSync(path.join(root, 'docs', 'assets', 'noema-architecture.png'), png);
  const record = {
    version: 1,
    source: { doc: 'docs/ARCHITECTURE.md', sha256: sha256(Buffer.from(arch)) },
    assets: {
      html: {
        path: 'docs/assets/noema-architecture.html',
        sha256: sha256(html),
        bytes: html.length,
      },
      png: {
        path: 'docs/assets/noema-architecture.png',
        sha256: sha256(png),
        bytes: png.length,
      },
    },
    updatedAt: '2026-11-15T00:00:00.000Z',
    candidate: { diagram_type: 'architecture', meta: { title: 'fixture' } },
  };
  fs.writeFileSync(
    path.join(root, 'docs', 'assets', 'noema-architecture.source.json'),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(root, 'README.md'),
    withReadmeLinks
      ? '![架构](docs/assets/noema-architecture.png)\n\n[交互版](docs/assets/noema-architecture.html)\n'
      : '# README\n',
  );
  return root;
}

test('figure gate passes on a consistent record and catches each drift', () => {
  const root = makeRoot();
  try {
    assert.deepEqual(checkFigure(root).errors, []);

    fs.writeFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), '# ARCHITECTURE\n\n结构变了。\n');
    const staleDoc = checkFigure(root).errors;
    assert.ok(staleDoc.some((error) => /已变化.*figure:build/u.test(error)), staleDoc.join('\n'));

    const untouched = makeRoot();
    try {
      fs.writeFileSync(
        path.join(untouched, 'docs', 'assets', 'noema-architecture.png'),
        'tampered',
      );
      const stalePng = checkFigure(untouched).errors;
      assert.ok(
        stalePng.some((error) => /noema-architecture\.png 与源文件记录不一致/u.test(error)),
        stalePng.join('\n'),
      );
    } finally {
      fs.rmSync(untouched, { recursive: true, force: true });
    }

    const noLinks = makeRoot({ withReadmeLinks: false });
    try {
      const missing = checkFigure(noLinks).errors;
      assert.ok(
        missing.some((error) => /README\.md 没有引用 docs\/assets\/noema-architecture\.png/u.test(error)),
        missing.join('\n'),
      );
    } finally {
      fs.rmSync(noLinks, { recursive: true, force: true });
    }

    const noSource = makeRoot();
    try {
      fs.rmSync(path.join(noSource, 'docs', 'assets', 'noema-architecture.source.json'));
      const missingSource = checkFigure(noSource).errors;
      assert.ok(
        missingSource.some((error) => /缺少架构图源文件/u.test(error)),
        missingSource.join('\n'),
      );
    } finally {
      fs.rmSync(noSource, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the governance figure has its own source, anchors and check', () => {
  const root = makeRoot();
  try {
    const missing = checkGovernanceFigure(root).errors;
    assert.ok(
      missing.some((error) => /缺少治理全景图源文件/u.test(error)),
      missing.join('\n'),
    );

    const combined = checkFigures(root).errors;
    assert.ok(
      combined.some((error) => /\[治理全景图\] 缺少治理全景图源文件/u.test(error)),
      combined.join('\n'),
    );

    const governanceHtml = Buffer.from('<html>governance</html>');
    const png = Buffer.from('GOVPNG-0123456789');
    const agents = '# AGENTS\n\n![治理](docs/assets/noema-governance.png)\n\n[交互版](docs/assets/noema-governance.html)\n';
    fs.writeFileSync(path.join(root, 'AGENTS.md'), agents);
    fs.writeFileSync(path.join(root, 'docs', 'assets', 'noema-governance.html'), governanceHtml);
    fs.writeFileSync(path.join(root, 'docs', 'assets', 'noema-governance.png'), png);
    fs.writeFileSync(
      path.join(root, 'docs', 'assets', 'noema-governance.source.json'),
      JSON.stringify(
        {
          version: 1,
          source: { doc: 'AGENTS.md', sha256: sha256(Buffer.from(agents)) },
          assets: {
            html: {
              path: 'docs/assets/noema-governance.html',
              sha256: sha256(governanceHtml),
              bytes: governanceHtml.length,
            },
            png: {
              path: 'docs/assets/noema-governance.png',
              sha256: sha256(png),
              bytes: png.length,
            },
          },
          updatedAt: '2026-11-16T00:00:00.000Z',
          candidate: { diagram_type: 'architecture', meta: { title: 'fixture' } },
        },
        null,
        2,
      ),
    );

    assert.deepEqual(checkGovernanceFigure(root).errors, []);
    assert.deepEqual(checkFigures(root).errors, []);

    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# AGENTS\n\n治理结构变了。\n');
    const stale = checkGovernanceFigure(root).errors;
    assert.ok(
      stale.some((error) => /AGENTS\.md 在出图后已变化/u.test(error)),
      stale.join('\n'),
    );
    fs.writeFileSync(path.join(root, 'AGENTS.md'), agents);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
