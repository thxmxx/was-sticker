import { createHash } from 'node:crypto';
import JSZip from 'jszip';

/**
 * Decode the payload of a JWT trust_token (no signature verification — that's
 * the WhatsApp client's job; we only inspect the claims).
 */
function decodeTrustToken(token) {
  if (typeof token !== 'string') return null;
  const [headerB64, payloadB64, sigB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) return null;
  const fromB64 = (s) => Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
  const header  = JSON.parse(fromB64(headerB64).toString('utf8'));
  const payload = JSON.parse(fromB64(payloadB64).toString('utf8'));
  // payload.sticker_file_sha256 is base64url-encoded SHA-256
  const claimedShaHex = payload.sticker_file_sha256
    ? fromB64(payload.sticker_file_sha256).toString('hex')
    : null;
  return { header, payload, claimedShaHex, raw: token };
}

/**
 * Parse a `.was` archive.
 *
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<{
 *   files: Record<string, Buffer>,
 *   jsonPath: string,
 *   animation: object,
 *   trustToken: ReturnType<typeof decodeTrustToken> | null,
 *   trustTokenPath: string | null,
 *   metadata: object | null,
 *   metadataPath: string | null,
 * }>}
 */
export async function extractFromWAS(buffer) {
  if (!buffer || (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array))) {
    throw new Error('extractFromWAS: buffer is required.');
  }
  const zip = await JSZip.loadAsync(buffer);

  const files = {};
  await Promise.all(
    Object.values(zip.files)
      .filter((f) => !f.dir)
      .map(async (f) => { files[f.name] = await f.async('nodebuffer'); }),
  );

  // Pick the primary Lottie JSON: prefer `animation.json`, else first non-metadata JSON.
  const jsonNames = Object.keys(files).filter(
    (n) => n.toLowerCase().endsWith('.json') &&
           !n.endsWith('.overridden_metadata') &&
           !n.endsWith('.trust_token'),
  );
  if (jsonNames.length === 0) {
    throw new Error('No Lottie JSON found in archive.');
  }
  const jsonPath = jsonNames.find((n) => n.endsWith('animation.json')) ?? jsonNames[0];

  let animation;
  try {
    animation = JSON.parse(files[jsonPath].toString('utf8'));
  } catch (err) {
    throw new Error(`Could not parse "${jsonPath}" as JSON: ${err.message}`);
  }

  const trustTokenPath = `${jsonPath}.trust_token`;
  const trustToken = files[trustTokenPath]
    ? decodeTrustToken(files[trustTokenPath].toString('utf8').trim())
    : null;

  const metadataPath = `${jsonPath}.overridden_metadata`;
  let metadata = null;
  if (files[metadataPath]) {
    try { metadata = JSON.parse(files[metadataPath].toString('utf8')); }
    catch { /* leave metadata null if it's not parseable */ }
  }

  return { files, jsonPath, animation, trustToken, trustTokenPath, metadata, metadataPath };
}

/**
 * Human-friendly summary of a `.was` — useful for CLI inspection.
 */
export async function inspectWAS(buffer) {
  const { jsonPath, animation, trustToken, metadata, files } = await extractFromWAS(buffer);

  const jsonBytes = files[jsonPath];
  const actualSha = createHash('sha256').update(jsonBytes).digest('hex');
  const claimedSha = trustToken?.claimedShaHex ?? null;

  return {
    jsonPath,
    animation: {
      nm: animation.nm ?? null,
      version: animation.v ?? null,
      width: animation.w ?? null,
      height: animation.h ?? null,
      fps: animation.fr ?? null,
      durationFrames: (animation.op ?? 0) - (animation.ip ?? 0),
      layers: Array.isArray(animation.layers) ? animation.layers.length : 0,
      assets: Array.isArray(animation.assets) ? animation.assets.length : 0,
    },
    metadata,
    trustToken: trustToken && {
      kid: trustToken.header?.kid ?? null,
      alg: trustToken.header?.alg ?? null,
      stickerFileType: trustToken.payload?.sticker_file_type ?? null,
      trustedOrigin: trustToken.payload?.sticker_file_trusted_origin ?? null,
      claimedSha,
    },
    sha256: actualSha,
    shaMatches: claimedSha !== null && claimedSha === actualSha,
    size: jsonBytes.length,
    fileNames: Object.keys(files),
  };
}
