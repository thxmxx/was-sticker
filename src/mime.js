import { extname } from 'node:path';

const MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
});

const MAGIC = [
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], suffixAt: 8, suffix: [0x57, 0x45, 0x42, 0x50] },
];

export const SUPPORTED_MIMES = Object.freeze([...new Set(Object.values(MIME_BY_EXT))]);

export function detectMimeFromExtension(filePath) {
  if (!filePath) return null;
  return MIME_BY_EXT[extname(String(filePath)).toLowerCase()] ?? null;
}

export function detectMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  for (const { mime, bytes, suffixAt, suffix } of MAGIC) {
    const headOk = bytes.every((b, i) => buffer[i] === b);
    if (!headOk) continue;
    if (suffix && !suffix.every((b, i) => buffer[suffixAt + i] === b)) continue;
    return mime;
  }
  return null;
}
