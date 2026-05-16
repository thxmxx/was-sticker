# was-sticker

[![CI](https://github.com/thxmxx/was-sticker/actions/workflows/ci.yml/badge.svg)](https://github.com/thxmxx/was-sticker/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/was-sticker.svg)](https://www.npmjs.com/package/was-sticker)

Build WhatsApp animated stickers (`.was`) from an image plus a Lottie template — pure JS, no shell `zip` binary required.

- ✅ **Zero shell dependencies** — uses [JSZip](https://stuk.github.io/jszip/); works on Linux, macOS, Windows, Termux.
- ✅ **Async everywhere** — non-blocking I/O.
- ✅ **Flexible inputs** — template as folder, JSON file, `Buffer`, or parsed object.
- ✅ **Flexible asset selection** — by index, asset id, or a predicate.
- ✅ **Returns a `Buffer`** — feed it straight to Baileys without touching disk.
- ✅ **MIME sniffing** — from extension *and* magic bytes.
- ✅ **CLI included** — `npx was-sticker -i face.png -t ./tpl -o sticker.was`.
- ✅ **Ships with a default template** — `bundledTemplate('pulse')` so you don't need to source a Lottie.

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
// → `buffer` is a ready-to-send .was sticker
```

A full runnable example lives in [`examples/build.js`](./examples/build.js).

## WhatsApp sticker constraints

WhatsApp will silently reject animated stickers that violate these rules. The library does not enforce them — you stay in control of the inputs:

| Rule                 | Limit                                     |
| -------------------- | ----------------------------------------- |
| Dimensions           | 512 × 512 pixels                          |
| File size            | ≤ 500 KB                                  |
| Duration             | ≤ 6 seconds                               |
| Frame rate           | typically 30 fps                          |
| Background           | Transparent recommended (PNG/WebP alpha)  |

If your animated sticker isn't showing on the client, it almost always means one of the above failed. Resize your image first (e.g. with [`sharp`](https://sharp.pixelplumbing.com/)) before passing it in.

## API

### `buildLottieSticker(options)`

```js
const { buffer, output, mime } = await buildLottieSticker({
  image,           // required
  template,        // required
  output,          // optional — write to this path if set
  assetSelector,   // optional — which asset to swap
  jsonEntryName,   // optional — path inside the .was for the Lottie JSON
  extraFiles,      // optional — additional files to bundle in the archive
});
```

Returns `{ buffer: Buffer, output?: string, mime: 'application/was' }`.

**`image`** — the picture to embed.

| Form                                 | Behavior                                       |
| ------------------------------------ | ---------------------------------------------- |
| `'face.png'` (string path)           | Reads file; sniffs MIME from extension *and* magic bytes. |
| `Buffer`                             | Sniffs MIME from magic bytes only.             |
| `{ buffer, mime }`                   | Trust the caller-provided MIME.                |
| `{ path, mime? }`                    | Reads file; mime override optional.            |

Supported: `image/png`, `image/jpeg`, `image/webp`.

**`template`** — the Lottie scaffold to inject the image into.

| Form                                  | Behavior                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `bundledTemplate('pulse')`            | Use the shipped `pulse` template (1-second scale pulse, 30 fps).                      |
| `'./folder'` (directory path)         | Walks the folder; uses the first `.json` as the Lottie, bundles everything else.      |
| `'./lottie.json'` (file path)         | Reads and parses the JSON.                                                            |
| `Buffer`                              | Parses as UTF-8 JSON.                                                                 |
| `object` (parsed Lottie)              | Deep-cloned before patching — your input is never mutated.                            |

**`assetSelector`** — which `assets[]` entry to overwrite. Default: first asset whose `p` starts with `data:image/`.

```js
// Default — find the first embedded base64 image
buildLottieSticker({ image, template });

// By array index
buildLottieSticker({ image, template, assetSelector: 0 });

// By asset id
buildLottieSticker({ image, template, assetSelector: 'image_0' });

// By predicate
buildLottieSticker({ image, template, assetSelector: a => a.w === 512 });
```

**`jsonEntryName`** — where the Lottie JSON ends up inside the `.was` archive. Defaults: the original path when `template` is a folder, otherwise `animation/animation.json`.

**`extraFiles`** — extra files to bundle, keyed by archive path:

```js
buildLottieSticker({
  image, template,
  extraFiles: { 'meta.json': JSON.stringify({ pack: 'mine' }) },
});
```

### `bundledTemplate(name)`

Returns the absolute path of a Lottie template shipped with the package. Currently the only template is `'pulse'` (the default).

```js
import { bundledTemplate } from 'was-sticker';
bundledTemplate();        // → /…/templates/pulse/animation.json
bundledTemplate('pulse'); // → same
```

### MIME helpers

```js
import {
  SUPPORTED_MIMES,            // ['image/png', 'image/jpeg', 'image/webp']
  detectMimeFromExtension,    // (path: string) => string | null
  detectMimeFromBuffer,       // (buffer: Buffer) => string | null
} from 'was-sticker';
```

## CLI

```bash
was-sticker --image face.png --template <folder-or-json> --out sticker.was
was-sticker -i face.png -t lottie.json -s image_0
was-sticker --help
```

| Flag                   | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `-i, --image`          | Image file (PNG / JPG / WebP). **Required.**                 |
| `-t, --template`       | Lottie folder, JSON file, or parsed JSON. **Required.**      |
| `-o, --out`            | Output `.was` path. Default `./sticker.was`.                 |
| `-s, --selector`       | Asset id (string) or 0-based index.                          |
| `    --json-entry`     | Path of the Lottie JSON inside the archive.                  |
| `-h, --help`           | Show help.                                                   |

## Baileys integration

```js
import { buildLottieSticker, bundledTemplate } from 'was-sticker';

const { buffer } = await buildLottieSticker({
  image: incomingPhotoBuffer,         // Buffer you already have in memory
  template: bundledTemplate('pulse'),
});

await sock.sendMessage(jid, {
  sticker: buffer,
  mimetype: 'application/was',
});
```

## Bring your own template

A `.was` is a ZIP archive containing a Lottie JSON (plus any sibling assets the animation references). The Lottie JSON must have at least one image asset embedded as a `data:` URI — that's the slot the library swaps your image into:

```json
{
  "v": "5.7.1",
  "fr": 30,
  "ip": 0,
  "op": 30,
  "w": 512, "h": 512,
  "assets": [
    {
      "id": "image_0",
      "w": 512, "h": 512,
      "u": "",
      "p": "data:image/png;base64,iVBORw0KGgo…"
    }
  ],
  "layers": [ /* layer referencing refId: 'image_0' */ ]
}
```

To use it:

1. Save the JSON (and any sibling files it references) anywhere on disk.
2. Pass the folder path — or the single JSON path — as `template`.

If you target the wrong asset, set `assetSelector` to the right id, index, or predicate.

## Troubleshooting

| Error                                            | Cause / fix                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `No embedded base64 image asset found.`          | Template has no `assets[].p` starting with `data:image/`. Add one, or pass `assetSelector`. |
| `Unable to detect image mime.`                   | Buffer wasn't PNG/JPG/WebP, or path has no extension. Pass `mime` explicitly.              |
| `Unsupported mime "image/gif".`                  | Only PNG, JPEG, WebP are supported.                                                        |
| Sticker doesn't render in WhatsApp               | Almost always a size/dimension issue — see [constraints](#whatsapp-sticker-constraints).   |
| `Lottie template has no \`assets\` array.`       | The JSON you passed isn't a valid Lottie file.                                             |

## Roadmap

Deliberately out of v0.1 to keep the surface small:

- **`sharp` preprocessing hook** — auto-resize to 512×512, enforce the 500 KB budget.
- **Template registry** — more shipped templates (heart, fire, sparkles, etc.).
- **Multi-frame stickers** — accept an array of images.
- **Validation pass** — warn when output violates WhatsApp constraints.
- **TypeScript declarations** — emit `.d.ts` alongside the JSDoc.
- **Streaming output** — stream the ZIP to disk for large bundles.

## License

MIT — see [LICENSE](./LICENSE).
