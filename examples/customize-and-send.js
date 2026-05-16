/**
 * Take a captured `.was`, rebrand it, send it.
 *
 *   node examples/customize-and-send.js ./captured-3EB0...was 5511…@s.whatsapp.net
 */
import { readFile } from 'node:fs/promises';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';

import { customizeMetadata, sendLottieSticker } from 'was-sticker';

const [, , inPath, jid] = process.argv;
if (!inPath || !jid) {
  console.error('Usage: node examples/customize-and-send.js <in.was> <jid>');
  process.exit(1);
}

const original = await readFile(inPath);

const branded = await customizeMetadata(original, {
  packId: 'my-bot-pack-v1',
  packName: 'My Bot Pack',
  publisher: 'Bot\nMade with was-sticker',
  accessibilityText: 'A custom animated sticker',
  emojis: ['💎', '✨'],
});

const { state, saveCreds } = await useMultiFileAuthState('./auth');
const { version } = await fetchLatestBaileysVersion();
const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'warn' }), printQRInTerminal: true });
sock.ev.on('creds.update', saveCreds);

await new Promise((r) => sock.ev.on('connection.update', (u) => u.connection === 'open' && r()));

const { messageId, fileLength } = await sendLottieSticker(sock, jid, branded);
console.log(`Sent ${fileLength} bytes as ${messageId}`);
process.exit(0);
