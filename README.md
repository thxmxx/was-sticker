# was-sticker

[![CI](https://github.com/thxmxx/was-sticker/actions/workflows/ci.yml/badge.svg)](https://github.com/thxmxx/was-sticker/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/was-sticker.svg)](https://www.npmjs.com/package/was-sticker)

Re-brand WhatsApp Lottie stickers (`.was`) and send them through Baileys as a proper `lottieStickerMessage` — so they actually render on mobile.

> ⚠️ **What this is and isn't.** WhatsApp signs every animated Lottie sticker with an ES256 JWT (`trust_token`) carrying the SHA-256 of the animation JSON. Any change to the animation invalidates the token and the client silently drops the sticker. This library does **not** let you put your own image inside a Lottie animation. What it lets you do is **re-brand** a genuine WhatsApp Lottie sticker (change the pack name, publisher, emojis, group link) without breaking the signature. The animation itself stays a Meta-original sticker.
>
> If you want a sticker with your own artwork, you need WebP animated, not Lottie `.was`. That is not what this package does.

## How it actually works

1. **Source** a `.was` whose `trust_token` is genuine. The library ships a Baileys helper, `captureNextLottieSticker`, that listens for the next animated sticker delivered to your account and saves the encrypted `.was` to disk.
2. **Customize** only the `overridden_metadata` inside the archive. The animation JSON and the trust_token are preserved byte-for-byte, so the client-side SHA check still passes.
3. **Send** via `sendLottieSticker`, which wraps your sticker in a `lottieStickerMessage` (FutureProofMessage at field 74). Baileys' regular `sock.sendMessage({ sticker, mimetype })` emits `stickerMessage` (field 26) — Web tolerates it, mobile does not.

## Install

```bash
npm install was-sticker
npm install @whiskeysockets/baileys      # peer dep, only needed for send/capture
```

Requires Node.js ≥ 20 (Baileys' postinstall enforces this).

## Quick start

```js
import { readFile, writeFile } from 'node:fs/promises';
import {
  inspectWAS,
  customizeMetadata,
  sendLottieSticker,
  captureNextLottieSticker,
} from 'was-sticker';

// 1. Source a .was by waiting for one to arrive.
const { buffer } = await captureNextLottieSticker(sock, { timeoutMs: 120_000 });
await writeFile('./pumpkin.was', buffer);

// 2. Inspect it (sanity check).
console.log(await inspectWAS(buffer));
// → { animation: { nm: 'WA_Harvest_…', w: 512, h: 512, fps: 60, ... },
//     trustToken: { kid: '196', alg: 'ES256', claimedSha: '...' },
//     shaMatches: true, ... }

// 3. Re-brand it.
const rebranded = await customizeMetadata(buffer, {
  packId: 'my-bot-pack-v1',
  packName: 'My Bot Pack',
  publisher: 'Bot\nMade with was-sticker',
  accessibilityText: 'A custom animated sticker',
  emojis: ['💎', '✨'],
});

// 4. Send it on Baileys with the right wrapper.
await sendLottieSticker(sock, '5511…@s.whatsapp.net', rebranded);
```

## API

### `extractFromWAS(buffer)`

Parses the ZIP archive. Returns `{ files, jsonPath, animation, trustToken, trustTokenPath, metadata, metadataPath }`.

### `inspectWAS(buffer)`

Higher-level summary intended for CLI / debugging output:

```ts
{
  jsonPath: string,
  animation: { nm, version, width, height, fps, durationFrames, layers, assets },
  metadata: object | null,
  trustToken: { kid, alg, stickerFileType, trustedOrigin, claimedSha } | null,
  sha256: string,
  shaMatches: boolean,   // <-- this is the only field that ultimately matters
  size: number,
  fileNames: string[],
}
```

If `shaMatches` is `false`, the WhatsApp client will reject the sticker.

### `customizeMetadata(buffer, patch, { merge = true })`

Returns a new `.was` buffer with `overridden_metadata` rewritten. Allowed `patch` fields:

| Camel-case input    | Underlying WhatsApp field         |
| ------------------- | --------------------------------- |
| `packId`            | `sticker-pack-id`                 |
| `packName`          | `sticker-pack-name`               |
| `publisher`         | `sticker-pack-publisher` (newlines OK — the second line typically holds a group link) |
| `accessibilityText` | `accessibility-text`              |
| `emojis`            | `emojis` (array of glyphs)        |
| `isFromUserCreatedPack` | `is-from-user-created-pack` (default `1`) |

`merge: false` rewrites the metadata from scratch instead of merging with what's already there.

The animation JSON and the trust_token are not touched.

### `sendLottieSticker(sock, jid, buffer, opts?)`

Uploads `buffer` via Baileys' `prepareWAMessageMedia`, then relays it as a `lottieStickerMessage`.

```ts
opts?: {
  width?: number,
  height?: number,
  accessibilityLabel?: string,
  messageId?: string,
  quoted?: WAMessage,
}
```

Returns `{ messageId, fileLength }`.

### `captureNextLottieSticker(sock, opts?)`

Resolves with the next incoming Lottie sticker, downloaded and decrypted.

```ts
opts?: {
  timeoutMs?: number,   // default 60_000; 0 = no timeout
  from?: string,        // restrict to one JID
  filter?: (stk, key) => boolean,
  includeNonLottie?: boolean,  // default false
}
```

Returns `{ buffer, stickerMessage, key, mimetype, isLottie, isAnimated, width, height }`.

## CLI

```bash
was-sticker inspect <in.was>
was-sticker customize <in.was> -o <out.was> \
    --pack-name "My Pack" \
    --publisher "Me\nGrupo: https://example.com" \
    --emoji 🎃 --emoji 💎
```

`inspect` prints the JSON summary above. `customize` writes the rebranded archive.

Sending and capturing are intentionally not in the CLI — both require a connected Baileys socket; do them from a script (see `examples/`).

## Examples

- [`examples/capture.js`](./examples/capture.js) — wait for a forwarded sticker and save it.
- [`examples/customize-and-send.js`](./examples/customize-and-send.js) — rebrand and send.

## Notes / gotchas

- **Mobile vs Web parity.** Mobile WhatsApp will silently drop Lottie payloads that arrive as plain `stickerMessage`. Web will render them. Use `sendLottieSticker`, not `sock.sendMessage({ sticker, mimetype: 'application/was' })`.
- **The pack info shown in Web** comes from WhatsApp's official catalog keyed by the animation's identity, not from your `overridden_metadata`. Mobile reads your metadata. This is a WhatsApp quirk, not a bug.
- **Use at your own risk.** Sending modified `.was` files through unofficial clients (Baileys is one) violates WhatsApp's Terms of Service and can result in your number being banned. Test on a throwaway account.

## License

MIT — see [LICENSE](./LICENSE).
