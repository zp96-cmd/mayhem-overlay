const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_POSITIONS, validatePositions, positionInDisplay } = require('../src/main/layout');

test('rejects malformed positions before persistence', () => {
  for (const bad of [null, {}, { ...DEFAULT_POSITIONS, prioPos: { x: NaN, y: 0 } },
    { ...DEFAULT_POSITIONS, prioPos: { x: 0, y: 1.01 } },
    { ...DEFAULT_POSITIONS, prioPos: { x: '0.5', y: 0 } }]) {
    assert.throws(() => validatePositions(bad));
  }
});
test('copies only the supported positions', () => {
  const result = validatePositions({ ...DEFAULT_POSITIONS, bounds: 'untrusted' });
  assert.deepEqual(result, DEFAULT_POSITIONS);
  assert.notEqual(result.prioPos, DEFAULT_POSITIONS.prioPos);
});
test('keeps a panel visible at the edge of an offset display', () => {
  assert.deepEqual(positionInDisplay({ x: 1, y: 1 }, { width: 320, height: 420 },
    { x: -1920, y: 100, width: 1920, height: 1080 }), { x: -320, y: 760 });
});
test('oversized panels anchor to the display origin', () => {
  assert.deepEqual(positionInDisplay({ x: .8, y: .8 }, { width: 2000, height: 1500 },
    { x: 100, y: -900, width: 1280, height: 720 }), { x: 100, y: -900 });
});
