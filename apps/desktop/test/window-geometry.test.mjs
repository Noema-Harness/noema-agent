import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitsWithinWorkArea,
  resolveInitialWindowSize,
} from '../src/window-geometry.mjs';

test('initial Noema window respects a high-DPI display work area', () => {
  assert.deepEqual(resolveInitialWindowSize({ width: 827, height: 573 }), {
    width: 803,
    height: 549,
    minWidth: 680,
    minHeight: 549,
  });
});

test('initial Noema window keeps its preferred size when the display is large', () => {
  assert.deepEqual(resolveInitialWindowSize({ width: 1920, height: 1080 }), {
    width: 1240,
    height: 860,
    minWidth: 680,
    minHeight: 560,
  });
});

test('initial Noema window remains renderable on a compact display', () => {
  assert.deepEqual(resolveInitialWindowSize({ width: 640, height: 500 }), {
    width: 616,
    height: 476,
    minWidth: 616,
    minHeight: 476,
  });
});

test('work-area check rejects an out-of-bounds window', () => {
  const workArea = { x: 0, y: 0, width: 827, height: 573 };

  assert.equal(
    fitsWithinWorkArea({ x: 12, y: 12, width: 803, height: 549 }, workArea),
    true,
  );
  assert.equal(
    fitsWithinWorkArea({ x: 12, y: 12, width: 1240, height: 860 }, workArea),
    false,
  );
});
