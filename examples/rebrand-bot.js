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
 * Run:
 *   cd test/sandbox && node ../../examples/rebrand-bot.js
 */
import pino from 'pino';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
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
const sock = makeWASocket({ version, auth: state, logger, printQRInTerminal: false });
sock.ev.on('creds.update', saveCreds);

const sentIds = new Set();
const pending = new Map();   // jid -> { buffer, deadline }

let myJid = null;            // resolved on connection 'open'

function isSelfChat(remoteJid) {
  return !!myJid && remoteJid === myJid;
}

async function reply(jid, text) {
  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) sentIds.add(sent.key.id);
}

function gcPending() {
  const now = Date.now();
  for (const [jid, st] of pending) if (st.deadline < now) pending.delete(jid);
}

// 1) Catch every incoming Lottie sticker — but only in the Me-Yourself chat.
subscribeLottieStickers(sock, async ({ buffer, key, width, height }) => {
  if (!isSelfChat(key.remoteJid)) return;
  if (sentIds.has(key.id)) return;     // ignore our own outbound stickers
  if (pending.has(key.remoteJid)) {
    // user sent another sticker before answering — replace the pending one
    pending.delete(key.remoteJid);
  }
  pending.set(key.remoteJid, { buffer, deadline: Date.now() + FORM_TIMEOUT_MS });
  await reply(key.remoteJid, formPrompt({ width, height }));
});

// 2) Watch text replies in the same self chat to satisfy the pending form.
sock.ev.on('messages.upsert', async ({ messages }) => {
  gcPending();
  for (const m of messages) {
    if (!m.message) continue;
    if (!isSelfChat(m.key.remoteJid)) continue;
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

sock.ev.on('connection.update', ({ connection }) => {
  if (connection === 'open') {
    myJid = jidNormalizedUser(sock.user.id);
    console.log(`Bot pronto. Escutando apenas em ${myJid} (Me-Yourself).`);
    console.log('Mande um sticker pra si mesmo pra começar.');
  }
});

// graceful shutdown
const shutdown = () => { sock.end(undefined); setTimeout(() => process.exit(0), 500).unref(); };
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
