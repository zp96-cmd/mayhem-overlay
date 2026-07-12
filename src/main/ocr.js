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

// The augment cards occupy the middle of the screen. Crop generously: middle
// 76% of width, 22%..78% of height. Overridable via settings for odd layouts.
function cropBand(img, region) {
  const { width, height } = img.getSize();
  const r = region ?? { x: 0.12, y: 0.22, w: 0.76, h: 0.56 };
  return img.crop({
    x: Math.round(width * r.x),
    y: Math.round(height * r.y),
    width: Math.round(width * r.w),
    height: Math.round(height * r.h),
  });
}

const { matchAugments, normText } = require('./ocr-match');
const { preprocess } = require('./ocr-preprocess');

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
    const r = region ?? { x: 0.12, y: 0.22, w: 0.76, h: 0.56 };
    offset.x = Math.round(width * r.x);
    offset.y = Math.round(height * r.y);
    png = cropBand(shot, region).toPNG();
  }

  let debugPath = null;
  if (saveDebugImage) {
    debugPath = path.join(app.getPath('userData'), 'last-ocr-capture.png');
    fs.writeFileSync(debugPath, png);
  }

  const worker = await getWorker();
  const { data } = await worker.recognize(await preprocess(png), {}, { blocks: true, text: true });
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

  const matches = matchAugments(lines, augmentNames).map((m) => ({
    ...m,
    // screen position in DIPs (Electron window coordinates)
    screen: m.bbox ? {
      x: (offset.x + m.bbox.x0) / offset.scale,
      y: (offset.y + m.bbox.y0) / offset.scale,
      w: (m.bbox.x1 - m.bbox.x0) / offset.scale,
      h: (m.bbox.y1 - m.bbox.y0) / offset.scale,
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
