// Offline test of the OCR->fuzzy-match pipeline against a screenshot file.
// Usage: node scripts/test-ocr.mjs <image.png> [expected1,expected2,...]
import { createWorker } from 'tesseract.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { matchAugments } = require(path.join(ROOT, 'src', 'main', 'ocr-match.js'));

const [img, expectedArg] = process.argv.slice(2);
if (!img) { console.error('usage: node scripts/test-ocr.mjs <image.png> [expected,names]'); process.exit(1); }

const augments = JSON.parse(readFileSync(path.join(ROOT, 'data', 'augments.json'), 'utf8'))
  .augments.filter((a) => !a.disabled).map((a) => a.name);

const { preprocess } = require(path.join(ROOT, 'src', 'main', 'ocr-preprocess.js'));

const t0 = Date.now();
const pre = await preprocess(readFileSync(img));
const worker = await createWorker('eng');
await worker.setParameters({ tessedit_pageseg_mode: '11' }); // sparse text
const { data } = await worker.recognize(pre, {}, { blocks: true, text: true });
const lines = [];
for (const block of data.blocks ?? []) {
  for (const para of block.paragraphs ?? []) {
    for (const line of para.lines ?? []) lines.push({ text: line.text ?? '', bbox: line.bbox ?? null });
  }
}
if (!lines.length) (data.text ?? '').split('\n').forEach((t) => lines.push({ text: t, bbox: null }));
console.log('OCR lines:', lines.map((l) => l.text.trim()).filter(Boolean));
const matches = matchAugments(lines, augments);
console.log(`matches (${Date.now() - t0}ms total):`,
  matches.map((m) => ({ ...m, bbox: m.bbox ? `${m.bbox.x0},${m.bbox.y0}-${m.bbox.x1},${m.bbox.y1}` : null })));

if (expectedArg) {
  const expected = expectedArg.split(',');
  const found = expected.filter((e) => matches.some((m) => m.name.toLowerCase() === e.toLowerCase()));
  console.log(`expected ${expected.length}, found ${found.length}:`, found);
  process.exit(found.length === expected.length ? 0 : 1);
}
await worker.terminate();
process.exit(0);
