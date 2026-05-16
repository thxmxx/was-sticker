/**
 * Source a `.was` from WhatsApp: connect Baileys, wait for someone to forward
 * you an animated Lottie sticker, save it to disk.
 *
 * After running:
 *   open WhatsApp → forward an animated sticker to your own chat
 *   → the script writes ./captured-<id>.was and exits.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';

import { captureNextLottieSticker } from 'was-sticker';

const { state, saveCreds } = await useMultiFileAuthState('./auth');
const { version } = await fetchLatestBaileysVersion();
const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'warn' }), printQRInTerminal: true });
sock.ev.on('creds.update', saveCreds);

const { buffer, key, mimetype, width, height } = await captureNextLottieSticker(sock, { timeoutMs: 120_000 });
const out = join(process.cwd(), `captured-${key.id}.was`);
await writeFile(out, buffer);
console.log(`Saved ${out} — ${buffer.length} bytes, ${width}x${height}, ${mimetype}`);
process.exit(0);
