// Pure fuzzy-matching of OCR text lines against the known augment names.
// Kept free of Electron imports so it can be unit-tested with plain Node.

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const normText = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function similarity(a, b) {
  if (!a || !b) return 0;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

// Match OCR lines against augment names. Also tries joining adjacent lines in
// case a long name wraps across two lines on the card.
// Lines may be plain strings or { text, bbox } — bbox (if given) is carried
// onto matches so callers can position on-screen badges over the cards.
function matchAugments(ocrLines, augmentNames, threshold = 0.62) {
  const candidates = [];
  const lines = ocrLines
    .map((l) => (typeof l === 'string' ? { text: l, bbox: null } : l))
    .map((l) => ({ text: normText(l.text), bbox: l.bbox }))
    .filter((l) => l.text.length >= 3);
  const unionBox = (a, b) => (!a || !b) ? (a ?? b) : ({
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
  });
  const joined = lines
    .map((l, i) => (i + 1 < lines.length
      ? { text: `${l.text} ${lines[i + 1].text}`, bbox: unionBox(l.bbox, lines[i + 1].bbox) }
      : null))
    .filter(Boolean);
  const texts = [...lines, ...joined];

  const namesNorm = augmentNames.map((n) => ({ name: n, norm: normText(n) }));
  for (const { text, bbox } of texts) {
    for (const { name, norm } of namesNorm) {
      // compare against the text window of the same length as the name
      let best = similarity(text, norm);
      if (text.length > norm.length + 2) {
        const words = text.split(' ');
        const nWords = norm.split(' ').length;
        for (let i = 0; i + nWords <= words.length; i++) {
          best = Math.max(best, similarity(words.slice(i, i + nWords).join(' '), norm));
        }
      }
      if (best >= threshold) candidates.push({ name, score: best, bbox });
    }
  }
  // dedupe by name, keep best score, top 4
  const byName = new Map();
  for (const c of candidates) {
    if (!byName.has(c.name) || byName.get(c.name).score < c.score) byName.set(c.name, c);
  }
  const ranked = [...byName.values()].sort((a, b) => b.score - a.score).slice(0, 4);
  // an offer is 3 augments — with 3 confident hits, weaker ones are OCR noise
  const strong = ranked.filter((c) => c.score >= 0.85);
  return strong.length >= 3 ? strong.slice(0, 3) : ranked;
}

module.exports = { matchAugments, normText, similarity };
