import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { buildLottieSticker } from '../src/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));

// 1) Buffer in, Buffer out (no disk write) — ready to feed Baileys directly.
const { buffer: stickerBuffer } = await buildLottieSticker({
  image: {
    buffer: await readFile(resolve(here, 'face.png')),
    mime: 'image/png',
  },
  template: resolve(here, '..', 'templates', 'heart'), // folder with the Lottie template
});

console.log(`Built sticker: ${stickerBuffer.length} bytes`);

// 2) Path in, file out — also returns the buffer if you need it.
const { output } = await buildLottieSticker({
  image: resolve(here, 'face.png'),
  template: resolve(here, '..', 'templates', 'heart'),
  output: resolve(here, 'out', 'heart.was'),
  assetSelector: 0, // pick by index instead of "first base64 asset"
});

console.log(`Wrote: ${output}`);

// 3) Baileys integration sketch:
// await sock.sendMessage(jid, {
//   sticker: stickerBuffer,
//   mimetype: 'application/was',
// });
