# was-sticker

[![CI](https://github.com/thxmxx/was-sticker/actions/workflows/ci.yml/badge.svg)](https://github.com/thxmxx/was-sticker/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/was-sticker.svg)](https://www.npmjs.com/package/was-sticker)

Build WhatsApp animated stickers (`.was`) from an image plus a Lottie template — pure JS, no shell `zip` binary required.

- ✅ **Zero shell dependencies** — uses [JSZip](https://stuk.github.io/jszip/), works on Linux, macOS, Windows, Termux.
- ✅ **Async everywhere** — non-blocking I/O.
- ✅ **Flexible inputs** — template can be a folder, a JSON file, a `Buffer`, or a parsed object.
- ✅ **Flexible asset selection** — by index, asset id, or a predicate. Defaults to the first base64 image.
- ✅ **Returns a `Buffer`** — feed it directly to Baileys without touching disk.
- ✅ **MIME sniffing** — detects PNG/JPG/WEBP from extension *or* magic bytes.
- ✅ **CLI included** — `npx was-sticker -i face.png -t ./template -o out.was`.

## Install

```bash
npm install was-sticker
```

Requires Node.js ≥ 18.

## Quick start

```js
import { buildLottieSticker, bundledTemplate } from 'was-sticker';

const { buffer } = await buildLottieSticker({
  image: 'face.png',
  template: bundledTemplate('pulse'),
});
// → buffer is a ready-to-send `.was` sticker
```

The package ships with a `pulse` template (1-second scale pulse, 30 fps) so you can produce a sticker out of the box without sourcing a Lottie file.

## API

```js
import { buildLottieSticker } from 'was-sticker';

const { buffer, output, mime } = await buildLottieSticker({
  image:    'face.png',                  // path | Buffer | { buffer, path, mime }
  template: './templates/heart',         // folder | JSON path | Buffer | parsed object
  output:   './out/heart.was',           // optional — omit to keep it in-memory
  assetSelector: 0,                      // optional — number | string (id) | (asset) => boolean
  jsonEntryName: 'animation/anim.json',  // optional — path inside the .was for the JSON
  extraFiles: { 'meta.json': '{}' },     // optional — additional files to bundle
});
```

| Input form          | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `image: 'face.png'` | Reads file, sniffs MIME from extension and magic bytes.     |
| `image: buffer`     | Sniffs MIME from magic bytes.                               |
| `image: { buffer, mime }` | Trust caller-provided MIME.                           |
| `template: './folder'` | Walks folder; treats `*.json` as the Lottie, bundles the rest. |
| `template: './lottie.json'` | Reads and parses the single file.                   |
| `template: object`  | Uses the parsed Lottie (deep-cloned, not mutated).          |

The return value:

```ts
{ buffer: Buffer, output?: string, mime: 'application/was' }
```

## CLI

```bash
was-sticker --image face.png --template ./templates/heart --out heart.was
was-sticker -i face.png -t lottie.json -s image_0
```

## Baileys integration

```js
import { buildLottieSticker } from 'was-sticker';

const { buffer } = await buildLottieSticker({
  image: incomingPhotoBuffer,    // a Buffer you already have in memory
  template: './templates/heart',
});

await sock.sendMessage(jid, {
  sticker: buffer,
  mimetype: 'application/was',
});
```

## Bring your own template

A `.was` is just a ZIP archive containing a Lottie JSON (and any sibling assets the animation references). To use a custom template:

1. Find or design a Lottie animation that embeds the image you want to replace as a base64 `data:` URI inside its `assets[]` entry.
2. Drop it into a folder, e.g. `./templates/heart/animation/animation.json`.
3. Pass that folder as `template`.

If your Lottie file references external assets (sibling PNGs, fonts, etc.), keep them in the same folder — they are bundled into the `.was` automatically.

## Roadmap / suggested improvements

These are deliberately *not* in v0.1 to keep the surface area small, but each one would be a natural follow-up:

- **`sharp` preprocessing hook** — auto-resize to 512×512, convert to WebP, enforce WhatsApp's ~500 KB sticker budget. Keep it as an optional peer dep.
- **Template registry** — ship a few permissively-licensed Lottie templates (heart, fire, sparkles) so users don't have to source one.
- **Multi-frame stickers** — accept an array of images, write each into a separate animated layer.
- **Validation pass** — warn when the produced `.was` exceeds WhatsApp's recommended size, or when frame rate × duration looks off.
- **TypeScript declarations** — emit `.d.ts` alongside the JSDoc.
- **Streaming output** — for very large bundles, stream the ZIP to disk instead of buffering.

## License

MIT.
