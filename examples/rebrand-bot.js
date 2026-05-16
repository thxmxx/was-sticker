/**
 * Self-bot that re-brands Lottie stickers on demand.
 *
 *   You: <send/forward a Lottie sticker to your own chat>
 *   Bot: 🎨 Sticker recebido (512×512)
 *        Responda com (use "skip" pra pular um campo):
 *
 *        Pack:
 *        Autor:
 *        Emojis: 🎃,💎
 *        Texto:
 *
 *        Ou "cancel" pra descartar.
 *   You: Pack: My Pack
 *        Autor: Lucas
 *        Emojis: 🎃,💎,🎉
 *   Bot: <rebranded sticker>
 *
 * Run (QR, default):
 *   cd test/sandbox && node ../../examples/rebrand-bot.js
 *
 * Run (pairing code instead of QR):
 *   cd test/sandbox && PHONE=5527996311988 PAIRING=1 node ../../examples/rebrand-bot.js
 */
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import sharp from 'sharp';
import { Boom } from '@hapi/boom';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  DisconnectReason,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';

import {
  subscribeLottieStickers,
  customizeMetadata,
  sendLottieSticker,
} from '../src/index.js';

// ---------- form ----------

const FORM_TIMEOUT_MS = 10 * 60_000;

const formPrompt = (info) => `🎨 Sticker recebido (${info.width}×${info.height}).

Responda neste formato (use "skip" pra pular um campo):

Pack:
Autor:
Emojis:
Texto:

Ou "cancel" pra descartar.`;

const FIELD_ALIASES = {
  pack:         'packName',
  name:         'packName',
  nome:         'packName',
  autor:        'publisher',
  author:       'publisher',
  publisher:    'publisher',
  emoji:        'emojis',
  emojis:       'emojis',
  texto:        'accessibilityText',
  text:         'accessibilityText',
  description:  'accessibilityText',
};

function parseForm(text) {
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([a-zA-ZÀ-ÿ]+)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    const field = FIELD_ALIASES[match[1].toLowerCase()];
    if (!field) continue;
    const value = match[2].trim();
    if (!value || value.toLowerCase() === 'skip') continue;
    if (field === 'emojis') {
      out.emojis = value.split(/[,\s]+/).filter(Boolean);
    } else {
      out[field] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

// ---------- bot ----------

const logger = pino({ level: 'warn' });
const { state, saveCreds } = await useMultiFileAuthState('./auth');
const { version } = await fetchLatestBaileysVersion();

const PHONE = (process.env.PHONE ?? '').replace(/\D/g, '');
const USE_PAIRING = process.env.PAIRING === '1';

let sock;                       // current socket (replaced on reconnect)
let myJid = null;               // 5511…@s.whatsapp.net
let myLid = null;               // 29…@lid (Linked Identity — used for Me-Yourself in modern WA)
let pairingRequested = false;
let qrPrinted = false;

const sentIds = new Set();
const pending = new Map();      // jid -> { buffer, deadline }

const isSelfChat = (remoteJid) =>
  (myJid && remoteJid === myJid) || (myLid && remoteJid === myLid);

async function reply(jid, text) {
  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) sentIds.add(sent.key.id);
}

function gcPending() {
  const now = Date.now();
  for (const [jid, st] of pending) if (st.deadline < now) pending.delete(jid);
}

function connect() {
  sock = makeWASocket({ version, auth: state, logger, printQRInTerminal: false });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (qr && !sock.authState.creds.registered) {
      if (USE_PAIRING) {
        if (!pairingRequested) {
          pairingRequested = true;
          if (!PHONE) {
            console.error('PAIRING=1 requires PHONE=<digits>.');
            process.exit(1);
          }
          try {
            const code = await sock.requestPairingCode(PHONE);
            const pretty = code.match(/.{1,4}/g)?.join('-') ?? code;
            console.log('\n  Pairing code:', pretty);
            console.log('  WhatsApp → Aparelhos conectados → "Conectar com número de telefone" → digite o código.\n');
          } catch (err) {
            console.error('Pairing code request failed:', err.message);
            process.exit(1);
          }
        }
      } else if (!qrPrinted) {
        qrPrinted = true;
        console.log('\nScan this QR with WhatsApp → Aparelhos conectados:\n');
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'open') {
      myJid = jidNormalizedUser(sock.user.id);
      myLid = sock.user.lid ? jidNormalizedUser(sock.user.lid) : null;
      console.log(`\nBot pronto. Escutando em:`);
      console.log(`  - ${myJid}`);
      if (myLid) console.log(`  - ${myLid} (LID — usado pra Me-Yourself)`);
      console.log('Mande um sticker pra si mesmo pra começar.');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode : null;
      if (code === DisconnectReason.loggedOut) {
        console.error('Logged out. Delete ./auth to re-pair.');
        process.exit(1);
      }
      const reason =
        code === DisconnectReason.restartRequired ? 'restart required (post-pairing)' :
        code === DisconnectReason.connectionLost ? 'connection lost' :
        code === DisconnectReason.timedOut ? 'timed out' :
        `code ${code}`;
      console.log(`Reconnecting (${reason})...`);
      setTimeout(connect, 1_000);
    }
  });

  // (Re-)attach the sticker listener and the text-reply handler. The old
  // socket's listeners are dropped when its event emitter is GC'd, so it's
  // safe to bind anew on each `connect()` call.
  subscribeLottieStickers(sock, async ({ buffer, key, width, height }) => {
    if (!isSelfChat(key.remoteJid)) return;
    if (sentIds.has(key.id)) return;
    if (pending.has(key.remoteJid)) pending.delete(key.remoteJid);
    pending.set(key.remoteJid, { buffer, deadline: Date.now() + FORM_TIMEOUT_MS });
    await reply(key.remoteJid, formPrompt({ width, height }));
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    gcPending();
    for (const m of messages) {
      if (!m.message) {
        console.log(`[msg] type=${type} from=${m.key.remoteJid} fromMe=${m.key.fromMe} (no decrypted content)`);
        continue;
      }
      const kinds = Object.keys(m.message).join(',');
      console.log(`[msg] type=${type} from=${m.key.remoteJid} fromMe=${m.key.fromMe} kinds=[${kinds}]`);
      if (!isSelfChat(m.key.remoteJid)) continue;
      if (sentIds.has(m.key.id)) continue;

      // ── photo → static WebP sticker (no border, 512×512, centered) ──
      if (m.message.imageMessage) {
        try {
          const original = await downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          const webp = await sharp(original)
            .resize(512, 512, {
              fit: 'contain',
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .webp({ quality: 85, effort: 4 })
            .toBuffer();
          const sent = await sock.sendMessage(m.key.remoteJid, {
            sticker: webp,
            mimetype: 'image/webp',
          });
          if (sent?.key?.id) sentIds.add(sent.key.id);
          console.log(`[sticker out] ${webp.length}B → ${m.key.remoteJid}`);
        } catch (err) {
          console.error('photo→sticker failed:', err.message);
          await reply(m.key.remoteJid, `Erro ao converter foto: ${err.message}`);
        }
        continue;
      }
      // ────────────────────────────────────────────────────────────────
      if (sentIds.has(m.key.id)) continue;

      const text = m.message.conversation
                ?? m.message.extendedTextMessage?.text
                ?? null;
      if (!text) continue;

      const state = pending.get(m.key.remoteJid);
      if (!state) continue;

      const trimmed = text.trim().toLowerCase();
      if (trimmed === 'cancel' || trimmed === 'cancelar') {
        pending.delete(m.key.remoteJid);
        await reply(m.key.remoteJid, 'Cancelado. Manda outro sticker quando quiser.');
        continue;
      }

      const patch = parseForm(text);
      if (!patch) {
        await reply(m.key.remoteJid,
          'Não entendi. Use:\n\nPack: ...\nAutor: ...\nEmojis: 🎃,💎\nTexto: ...\n\nOu "cancel".');
        continue;
      }

      try {
        const rebranded = await customizeMetadata(state.buffer, patch);
        const { messageId } = await sendLottieSticker(sock, m.key.remoteJid, rebranded);
        sentIds.add(messageId);
        pending.delete(m.key.remoteJid);
      } catch (err) {
        await reply(m.key.remoteJid, `Erro no rebrand: ${err.message}`);
      }
    }
  });
}

connect();

const shutdown = () => { try { sock?.end?.(undefined); } catch {} setTimeout(() => process.exit(0), 500).unref(); };
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
