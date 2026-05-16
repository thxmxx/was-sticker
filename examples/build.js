import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

import { buildLottieSticker, bundledTemplate } from '../src/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));

// Demo image: a 1×1 transparent PNG. Replace `imageBuffer` with your real image.
const imageBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);

// 1) Buffer in, Buffer out — ready to hand to Baileys without touching disk.
const { buffer: stickerBuffer } = await buildLottieSticker({
  image: { buffer: imageBuffer, mime: 'image/png' },
  template: bundledTemplate('pulse'),
});
console.log(`In-memory sticker: ${stickerBuffer.length} bytes`);

// 2) Write to disk and select the asset by index instead of the default.
const outPath = resolve(here, 'out', 'pulse.was');
const { output } = await buildLottieSticker({
  image: { buffer: imageBuffer, mime: 'image/png' },
  template: bundledTemplate('pulse'),
  assetSelector: 0,
  output: outPath,
});
console.log(`Wrote: ${output}`);

// 3) Sketch of the Baileys send call:
// await sock.sendMessage(jid, {
//   sticker: stickerBuffer,
//   mimetype: 'application/was',
// });
