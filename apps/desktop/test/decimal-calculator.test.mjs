import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateExpression } from '../src/decimal-calculator.mjs';

test('calculates decimal arithmetic without binary floating-point drift', () => {
  assert.equal(calculateExpression('0.1 + 0.2').value, '0.3');
  assert.equal(calculateExpression('(4 * 200) - (4 * 30) - 600').value, '80');
  assert.equal(calculateExpression('-(2 + 3) * .5').value, '-2.5');
  assert.equal(calculateExpression('  1.2500  ').value, '1.25');
});

test('bounds and rejects expression input without executing code', () => {
  for (const expression of [
    'process.exit()',
    '1 % 2',
    '1 / 0',
    '1e101',
    '1 +'.padEnd(513, ' '),
    `${'('.repeat(33)}1${')'.repeat(33)}`,
  ]) {
    assert.throws(() => calculateExpression(expression));
  }
  assert.equal(calculateExpression('1 / 3').precision, 50);
  assert.match(calculateExpression('1 / 3').value, /^0\.333/u);
  assert.equal(calculateExpression('8 / 4 / 2').value, '1');
  assert.equal(
    calculateExpression(Array(60).fill('1e-99').join(' * ')).value,
    '1e-5940',
  );
});
