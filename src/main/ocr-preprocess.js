// Image preprocessing for OCR: game UIs use light text on dark backgrounds,
// which tesseract's binarizer handles poorly. Grayscale, invert (-> dark text
// on light), and boost contrast. Pure jimp, no Electron imports.
const { Jimp } = require('jimp');

async function preprocess(pngBuffer) {
  const img = await Jimp.read(pngBuffer);
  img.greyscale().invert().contrast(0.4);
  return img.getBuffer('image/png');
}

module.exports = { preprocess };
