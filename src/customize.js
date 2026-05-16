import JSZip from 'jszip';
import { extractFromWAS } from './extract.js';

const ALLOWED_FIELDS = Object.freeze({
  packId:               'sticker-pack-id',
  packName:             'sticker-pack-name',
  publisher:            'sticker-pack-publisher',
  accessibilityText:    'accessibility-text',
  emojis:               'emojis',
  isFromUserCreatedPack: 'is-from-user-created-pack',
});

function patchToWaMetadata(patch) {
  if (patch == null || typeof patch !== 'object') {
    throw new Error('customizeMetadata: patch must be an object.');
  }
  const out = {};
  for (const [camelKey, waKey] of Object.entries(ALLOWED_FIELDS)) {
    if (patch[camelKey] !== undefined) out[waKey] = patch[camelKey];
  }
  // Pass through any "wa-style" keys verbatim (escape hatch for advanced users).
  for (const k of Object.keys(patch)) {
    if (Object.values(ALLOWED_FIELDS).includes(k)) out[k] = patch[k];
  }
  return out;
}

/**
 * Returns a new `.was` buffer with the overridden_metadata replaced or merged.
 *
 * The animation JSON and its trust_token are preserved byte-for-byte so the
 * client-side SHA check still passes.
 *
 * @param {Buffer|Uint8Array} buffer
 * @param {{
 *   packId?: string,
 *   packName?: string,
 *   publisher?: string,
 *   accessibilityText?: string,
 *   emojis?: string[],
 *   isFromUserCreatedPack?: 0 | 1,
 * }} patch
 * @param {{ merge?: boolean }} [opts] — when true (default), unspecified fields
 *   are kept from the existing metadata; when false, the metadata is rewritten
 *   from scratch using only the patch.
 * @returns {Promise<Buffer>}
 */
export async function customizeMetadata(buffer, patch, opts = {}) {
  const { merge = true } = opts;
  const { files, jsonPath, metadata } = await extractFromWAS(buffer);

  const waPatch = patchToWaMetadata(patch);
  const next = merge ? { ...(metadata ?? {}), ...waPatch } : { ...waPatch };

  // is-from-user-created-pack is expected by WhatsApp on custom packs — default to 1.
  if (next['is-from-user-created-pack'] === undefined) {
    next['is-from-user-created-pack'] = 1;
  }

  const metadataPath = `${jsonPath}.overridden_metadata`;
  files[metadataPath] = Buffer.from(JSON.stringify(next), 'utf8');

  const zip = new JSZip();
  for (const [name, contents] of Object.entries(files)) {
    zip.file(name, contents);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
