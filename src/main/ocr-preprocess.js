// Image preprocessing for OCR: game UIs use light text on dark backgrounds,
// which tesseract's binarizer handles poorly. Grayscale, invert (-> dark text
// on light), and boost contrast. Pure jimp, no Electron imports.
const { Jimp } = require('jimp');

async function preprocess(pngBuffer, downscale = 1) {
  const img = await Jimp.read(pngBuffer);
  img.greyscale().invert().contrast(0.4);
  // augment card names are large type — half resolution OCRs ~4x faster
  // with no accuracy loss
  if (downscale < 1) img.resize({ w: Math.max(1, Math.round(img.width * downscale)) });
  return img.getBuffer('image/png');
}

module.exports = { preprocess };
