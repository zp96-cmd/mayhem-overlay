// Positions use fractions of the primary display, matching the existing overlays.
const DEFAULT_POSITIONS = {
  combosPos: { x: 0.012, y: 0.15 },
  prioPos: { x: 0.80, y: 0.18 },
  buildStripPos: { x: 0.245, y: 0.895 },
  scanBtnPos: { x: 0.335, y: 0.002 },
};

function validatePositions(input) {
  if (!input || typeof input !== 'object') throw new Error('Missing layout');
  const result = {};
  for (const key of Object.keys(DEFAULT_POSITIONS)) {
    const pos = input[key];
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) ||
        pos.x < 0 || pos.x > 1 || pos.y < 0 || pos.y > 1) {
      throw new Error('Invalid overlay position');
    }
    result[key] = { x: pos.x, y: pos.y };
  }
  return result;
}

function positionInDisplay(pos, size, bounds) {
  return {
    x: bounds.x + Math.round(Math.max(0, Math.min(bounds.width - size.width, bounds.width * pos.x))),
    y: bounds.y + Math.round(Math.max(0, Math.min(bounds.height - size.height, bounds.height * pos.y))),
  };
}

module.exports = { DEFAULT_POSITIONS, validatePositions, positionInDisplay };
