/**
 * was-sticker — re-brand a Meta WhatsApp Lottie sticker (`.was`) and ship it
 * through Baileys as a real `lottieStickerMessage` so it renders on mobile.
 *
 * Tech notes captured during the v2 rewrite:
 *
 *  - The animation JSON inside a `.was` is signed by Meta. A JWT ES256
 *    `trust_token` (kid=196) carries the SHA-256 of the JSON. Any byte change
 *    to the JSON invalidates the token → the WhatsApp client silently drops
 *    the sticker. We never touch the animation; only `overridden_metadata`
 *    (pack name, publisher, emojis, group link) is fair game.
 *  - Baileys' `sock.sendMessage({ sticker, mimetype: 'application/was' })`
 *    emits `stickerMessage` (proto field 26). WhatsApp Web renders that;
 *    mobile WhatsApp does NOT. Mobile requires `lottieStickerMessage`
 *    (FutureProofMessage at field 74) wrapping a `stickerMessage`. The
 *    `sendLottieSticker` helper does that for you.
 */

export { extractFromWAS, inspectWAS } from './extract.js';
export { customizeMetadata } from './customize.js';
export { sendLottieSticker } from './send.js';
export { captureNextLottieSticker, subscribeLottieStickers } from './capture.js';
