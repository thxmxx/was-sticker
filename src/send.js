/**
 * Send a `.was` Lottie sticker as a real `lottieStickerMessage` (FutureProofMessage
 * at field 74). Required for mobile WhatsApp clients to render it — they silently
 * drop Lottie payloads sent inside a plain `stickerMessage` (field 26), which is
 * what Baileys' `sock.sendMessage({ sticker, mimetype })` emits.
 */

async function loadBaileys() {
  // Imported lazily so the lib doesn't hard-require Baileys for users who only
  // do extract/customize. Baileys is declared as an optional peer dependency.
  try {
    return await import('@whiskeysockets/baileys');
  } catch (err) {
    throw new Error(
      'sendLottieSticker requires "@whiskeysockets/baileys" — install it as a peer dependency.',
    );
  }
}

/**
 * Relay a `.was` buffer as a Lottie sticker on the given Baileys socket.
 *
 * @param {object} sock — a connected Baileys socket
 * @param {string} jid — recipient JID (e.g. `5511…@s.whatsapp.net` or `…@g.us`)
 * @param {Buffer|Uint8Array} buffer — `.was` archive bytes
 * @param {{
 *   width?: number,
 *   height?: number,
 *   accessibilityLabel?: string,
 *   messageId?: string,
 *   quoted?: object,
 * }} [opts]
 * @returns {Promise<{ messageId: string, fileLength: number }>}
 */
export async function sendLottieSticker(sock, jid, buffer, opts = {}) {
  if (!sock || typeof sock.relayMessage !== 'function') {
    throw new Error('sendLottieSticker: first argument must be a Baileys socket.');
  }
  if (typeof jid !== 'string' || !jid.includes('@')) {
    throw new Error('sendLottieSticker: jid must be a JID string.');
  }

  const baileys = await loadBaileys();
  const { prepareWAMessageMedia, generateWAMessageFromContent, generateMessageIDV2 } = baileys;

  // 1. Upload — gives us url/directPath/mediaKey/fileSha256/etc.
  const prepared = await prepareWAMessageMedia(
    { sticker: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), mimetype: 'application/was' },
    { upload: sock.waUploadToServer, mediaTypeOverride: 'sticker' },
  );
  const inner = prepared.stickerMessage;
  if (!inner) throw new Error('prepareWAMessageMedia did not return a stickerMessage.');

  inner.mimetype = 'application/was';
  inner.isAnimated = true;
  inner.isLottie = true;
  if (opts.width)               inner.width = opts.width;
  if (opts.height)              inner.height = opts.height;
  if (opts.accessibilityLabel)  inner.accessibilityLabel = opts.accessibilityLabel;

  // 2. Wrap in lottieStickerMessage (FutureProofMessage → Message → stickerMessage).
  const content = {
    lottieStickerMessage: { message: { stickerMessage: inner } },
  };

  // 3. Build the WAMessage and relay it.
  const messageId = opts.messageId ?? generateMessageIDV2();
  const waMsg = generateWAMessageFromContent(jid, content, {
    userJid: sock.user?.id,
    messageId,
    quoted: opts.quoted,
  });
  await sock.relayMessage(jid, waMsg.message, { messageId });

  return { messageId, fileLength: Number(inner.fileLength ?? buffer.length ?? 0) };
}
