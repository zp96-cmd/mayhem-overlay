// Screen OCR for augment offers: grab the screen, crop the central band where
// the augment cards sit, OCR it locally with tesseract.js, and fuzzy-match the
// text against the known augment names (closed vocabulary of ~222 strings).
const { desktopCapturer, screen, app } = require('electron');
const fs = require('fs');
const path = require('path');

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    workerPromise = createWorker('eng', 1, {
      cachePath: app.getPath('userData'), // caches eng.traineddata after first run
    }).then(async (w) => {
      await w.setParameters({ tessedit_pageseg_mode: '11' }); // sparse text (card layout)
      return w;
    });
  }
  return workerPromise;
}

async function captureScreen() {
  const display = screen.getPrimaryDisplay();
  const size = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0];
  return source.thumbnail; // NativeImage at full resolution
}

// The augment cards sit centered on screen. Crop TIGHT to that area: the
// kill feed / chat (bottom-left) announces other players' augment and item
// picks by name, and a generous crop reads those as offers. Overridable via
// settings.ocrRegion for odd layouts.
// Card NAMES sit around y 45-58% of the screen; the kill feed / chat lives
// below y~60%. Excluding vertically keeps wide card layouts intact while
// cutting every chat line out of the scan.
const DEFAULT_REGION = { x: 0.15, y: 0.28, w: 0.70, h: 0.32 };

function cropBand(img, region) {
  const { width, height } = img.getSize();
  const r = region ?? DEFAULT_REGION;
  return img.crop({
    x: Math.round(width * r.x),
    y: Math.round(height * r.y),
    width: Math.round(width * r.w),
    height: Math.round(height * r.h),
  });
}

const { matchAugments, normText } = require('./ocr-match');
const { preprocess } = require('./ocr-preprocess');

// Group matches by vertical proximity of their bbox centers; return the
// biggest group (ties broken by total match score). Matches without a bbox
// pass through untouched.
function filterToCardRow(matches, ocrData) {
  const withBox = matches.filter((m) => m.bbox);
  if (withBox.length < 2) return matches;
  const imgH = ocrData?.blocks?.length
    ? Math.max(...ocrData.blocks.map((b) => b.bbox?.y1 ?? 0), 1)
    : Math.max(...withBox.map((m) => m.bbox.y1), 1);
  const tol = Math.max(18, imgH * 0.05);
  const groups = [];
  for (const m of withBox) {
    const cy = (m.bbox.y0 + m.bbox.y1) / 2;
    const g = groups.find((grp) => Math.abs(grp.cy - cy) <= tol);
    if (g) {
      g.items.push(m);
      g.cy = g.items.reduce((s, x) => s + (x.bbox.y0 + x.bbox.y1) / 2, 0) / g.items.length;
    } else {
      groups.push({ cy, items: [m] });
    }
  }
  groups.sort((a, b) =>
    b.items.length - a.items.length ||
    b.items.reduce((s, x) => s + x.score, 0) - a.items.reduce((s, x) => s + x.score, 0));
  const best = groups[0]?.items ?? [];
  const noBox = matches.filter((m) => !m.bbox);
  return [...best, ...noBox];
}

async function scanForAugments(augmentNames, { saveDebugImage = true, region = null } = {}) {
  const t0 = Date.now();
  const display = screen.getPrimaryDisplay();
  let png;
  // crop offset in physical pixels, for mapping OCR bboxes back to screen coords
  let offset = { x: 0, y: 0, scale: display.scaleFactor };
  if (process.env.MAYHEM_OCR_TEST_IMAGE) {
    // test hook: OCR a file instead of the live screen
    png = fs.readFileSync(process.env.MAYHEM_OCR_TEST_IMAGE);
    offset.scale = 1;
  } else {
    const shot = await captureScreen();
    const { width, height } = shot.getSize();
    const r = region ?? DEFAULT_REGION;
    offset.x = Math.round(width * r.x);
    offset.y = Math.round(height * r.y);
    png = cropBand(shot, region).toPNG();
  }

  let debugPath = null;
  if (saveDebugImage) {
    debugPath = path.join(app.getPath('userData'), 'last-ocr-capture.png');
    fs.writeFileSync(debugPath, png);
  }

  const DOWNSCALE = 0.6; // large card text OCRs fine downscaled, ~3x faster
  const worker = await getWorker();
  const { data } = await worker.recognize(await preprocess(png, DOWNSCALE), {}, { blocks: true, text: true });
  // collect line-level text + bbox from the block tree; fall back to plain text
  const lines = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        lines.push({ text: line.text ?? '', bbox: line.bbox ?? null });
      }
    }
  }
  if (!lines.length) (data.text ?? '').split('\n').forEach((t) => lines.push({ text: t, bbox: null }));

  // Real offer cards sit on one horizontal row; chat/kill-feed hits stack
  // vertically. When 2+ matches exist, keep only the largest same-row group.
  const rowFiltered = filterToCardRow(matchAugments(lines, augmentNames), data);
  const matches = rowFiltered.map((m) => ({
    ...m,
    // screen position in DIPs: bboxes are in downscaled px, so scale back up
    screen: m.bbox ? {
      x: (offset.x + m.bbox.x0 / DOWNSCALE) / offset.scale,
      y: (offset.y + m.bbox.y0 / DOWNSCALE) / offset.scale,
      w: ((m.bbox.x1 - m.bbox.x0) / DOWNSCALE) / offset.scale,
      h: ((m.bbox.y1 - m.bbox.y0) / DOWNSCALE) / offset.scale,
    } : null,
  }));
  return {
    matches,
    durationMs: Date.now() - t0,
    rawLines: lines.map((l) => l.text.trim()).filter(Boolean).slice(0, 40),
    debugPath,
  };
}

module.exports = { scanForAugments, matchAugments, normText };
