/**
 * Listen for the next incoming Lottie sticker and return its decrypted buffer.
 * Useful for sourcing genuine `.was` files (with Meta-signed trust_tokens) that
 * you can then customize with `customizeMetadata`.
 *
 * WhatsApp routes Lottie stickers via `lottieStickerMessage` (FutureProofMessage
 * at field 74) — Baileys' default `downloadMediaMessage` doesn't handle that
 * variant. This helper walks the message tree, finds the inner stickerMessage,
 * and uses the lower-level `downloadContentFromMessage` to decrypt.
 */

async function loadBaileys() {
  try {
    return await import('@whiskeysockets/baileys');
  } catch {
    throw new Error(
      'captureNextLottieSticker requires "@whiskeysockets/baileys" — install it as a peer dependency.',
    );
  }
}

function findStickerMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.stickerMessage) return msg.stickerMessage;
  for (const v of Object.values(msg)) {
    if (v && typeof v === 'object') {
      const inner = findStickerMessage(v);
      if (inner) return inner;
    }
  }
  return null;
}

async function downloadSticker(stk) {
  const { downloadContentFromMessage } = await loadBaileys();
  const stream = await downloadContentFromMessage(stk, 'sticker');
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

function buildResult(buffer, stk, key) {
  return {
    buffer,
    stickerMessage: stk,
    key,
    mimetype: stk.mimetype ?? null,
    isLottie: !!stk.isLottie,
    isAnimated: !!stk.isAnimated,
    width: stk.width ?? 0,
    height: stk.height ?? 0,
  };
}

/**
 * Resolve when the next sticker (Lottie or otherwise) matching `filter` arrives.
 *
 * @param {object} sock — connected Baileys socket
 * @param {{
 *   timeoutMs?: number,                       // default 60_000; 0 = no timeout
 *   from?: string,                            // restrict to a specific JID
 *   filter?: (stickerMessage, key) => boolean // custom predicate
 *   includeNonLottie?: boolean,               // default false — only Lottie/.was
 * }} [opts]
 * @returns {Promise<{
 *   buffer: Buffer,
 *   stickerMessage: object,
 *   key: { remoteJid: string, id: string, fromMe: boolean },
 *   mimetype: string,
 *   isLottie: boolean,
 *   isAnimated: boolean,
 *   width: number,
 *   height: number,
 * }>}
 */
export function captureNextLottieSticker(sock, opts = {}) {
  if (!sock || typeof sock.ev?.on !== 'function') {
    throw new Error('captureNextLottieSticker: first argument must be a Baileys socket.');
  }
  const { timeoutMs = 60_000, from, filter, includeNonLottie = false } = opts;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const onUpsert = async ({ messages }) => {
      if (settled) return;
      for (const m of messages) {
        if (settled) break;
        if (!m.message) continue;
        if (from && m.key.remoteJid !== from) continue;

        const stk = findStickerMessage(m.message);
        if (!stk) continue;
        if (!includeNonLottie && !stk.isLottie) continue;
        if (filter && !filter(stk, m.key)) continue;

        try {
          const buffer = await downloadSticker(stk);
          settled = true;
          if (timer) clearTimeout(timer);
          sock.ev.off('messages.upsert', onUpsert);
          resolve(buildResult(buffer, stk, m.key));
        } catch (err) {
          settled = true;
          if (timer) clearTimeout(timer);
          sock.ev.off('messages.upsert', onUpsert);
          reject(err);
        }
        return;
      }
    };

    sock.ev.on('messages.upsert', onUpsert);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.ev.off('messages.upsert', onUpsert);
        reject(new Error(`captureNextLottieSticker: timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }
  });
}

/**
 * Continuous version of `captureNextLottieSticker`: invokes `handler` for every
 * incoming Lottie sticker until you call the returned unsubscribe function.
 *
 * The handler may be async; downloads run concurrently if multiple stickers
 * arrive at once. Errors from the handler are swallowed (logged to console) so
 * a bad reply doesn't kill the subscription.
 *
 * @param {object} sock — connected Baileys socket
 * @param {(sticker: {
 *   buffer: Buffer, stickerMessage: object, key: object,
 *   mimetype: string|null, isLottie: boolean, isAnimated: boolean,
 *   width: number, height: number,
 * }) => void | Promise<void>} handler
 * @param {{
 *   from?: string,
 *   filter?: (stickerMessage, key) => boolean,
 *   includeNonLottie?: boolean,
 *   includeFromMe?: boolean,   // default true (so it works on self-bots)
 * }} [opts]
 * @returns {() => void} unsubscribe
 */
export function subscribeLottieStickers(sock, handler, opts = {}) {
  if (!sock || typeof sock.ev?.on !== 'function') {
    throw new Error('subscribeLottieStickers: first argument must be a Baileys socket.');
  }
  if (typeof handler !== 'function') {
    throw new Error('subscribeLottieStickers: handler must be a function.');
  }
  const { from, filter, includeNonLottie = false, includeFromMe = true } = opts;

  const onUpsert = async ({ messages }) => {
    for (const m of messages) {
      if (!m.message) continue;
      if (from && m.key.remoteJid !== from) continue;
      if (!includeFromMe && m.key.fromMe) continue;

      const stk = findStickerMessage(m.message);
      if (!stk) continue;
      if (!includeNonLottie && !stk.isLottie) continue;
      if (filter && !filter(stk, m.key)) continue;

      try {
        const buffer = await downloadSticker(stk);
        await handler(buildResult(buffer, stk, m.key));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('subscribeLottieStickers handler error:', err.message);
      }
    }
  };

  sock.ev.on('messages.upsert', onUpsert);
  return () => sock.ev.off('messages.upsert', onUpsert);
}
