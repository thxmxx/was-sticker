import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

import {
  extractFromWAS,
  inspectWAS,
  customizeMetadata,
} from '../src/index.js';

// --- helpers -------------------------------------------------------------

const FAKE_LOTTIE = {
  v: '5.12.1', fr: 30, ip: 0, op: 90, w: 512, h: 512,
  nm: 'TEST_animation', ddd: 0,
  assets: [], layers: [], markers: [],
};

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function makeFakeTrustToken(jsonBytes) {
  // We don't sign anything — the consumer (was-sticker) only inspects the
  // claim and computes the SHA itself. The "signature" segment is irrelevant
  // to our tests (signature verification happens client-side in WhatsApp).
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'test' }));
  const sha = createHash('sha256').update(jsonBytes).digest();
  const payload = b64url(JSON.stringify({
    sticker_file_type: 'lottie_json',
    sticker_file_trusted_origin: 'whatsapp',
    sticker_file_sha256: b64url(sha),
  }));
  return `${header}.${payload}.AAAA`;
}

async function buildFakeWAS({ metadata = null } = {}) {
  const jsonBytes = Buffer.from(JSON.stringify(FAKE_LOTTIE), 'utf8');
  const token = makeFakeTrustToken(jsonBytes);
  const zip = new JSZip();
  zip.file('animation/animation.json', jsonBytes);
  zip.file('animation/animation.json.trust_token', token);
  if (metadata) {
    zip.file('animation/animation.json.overridden_metadata', JSON.stringify(metadata));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

// --- tests ---------------------------------------------------------------

test('extractFromWAS parses animation, trust_token, metadata', async () => {
  const buf = await buildFakeWAS({
    metadata: { 'sticker-pack-name': 'orig', 'sticker-pack-publisher': 'A', emojis: ['🎃'] },
  });
  const { animation, trustToken, metadata, jsonPath } = await extractFromWAS(buf);

  assert.equal(jsonPath, 'animation/animation.json');
  assert.equal(animation.w, 512);
  assert.equal(animation.nm, 'TEST_animation');
  assert.equal(trustToken.payload.sticker_file_type, 'lottie_json');
  assert.ok(/^[0-9a-f]{64}$/.test(trustToken.claimedShaHex));
  assert.equal(metadata['sticker-pack-name'], 'orig');
});

test('inspectWAS reports shaMatches when token claim equals JSON SHA', async () => {
  const buf = await buildFakeWAS();
  const info = await inspectWAS(buf);
  assert.equal(info.shaMatches, true);
  assert.equal(info.trustToken.claimedSha, info.sha256);
});

test('customizeMetadata preserves the animation SHA', async () => {
  const buf = await buildFakeWAS({
    metadata: { 'sticker-pack-name': 'orig', 'sticker-pack-publisher': 'A' },
  });
  const beforeFiles = (await extractFromWAS(buf)).files;
  const beforeSha = createHash('sha256').update(beforeFiles['animation/animation.json']).digest('hex');

  const rebranded = await customizeMetadata(buf, {
    packName: 'new', publisher: 'B', emojis: ['✅'],
  });
  const after = await inspectWAS(rebranded);
  const afterFiles = (await extractFromWAS(rebranded)).files;
  const afterSha = createHash('sha256').update(afterFiles['animation/animation.json']).digest('hex');

  assert.equal(afterSha, beforeSha, 'animation.json must be byte-identical');
  assert.equal(after.shaMatches, true);
  assert.equal(after.metadata['sticker-pack-name'], 'new');
  assert.equal(after.metadata['sticker-pack-publisher'], 'B');
  assert.deepEqual(after.metadata.emojis, ['✅']);
});

test('customizeMetadata merges by default, replaces when {merge: false}', async () => {
  const buf = await buildFakeWAS({
    metadata: { 'sticker-pack-name': 'orig', 'sticker-pack-publisher': 'A' },
  });

  const merged = await inspectWAS(await customizeMetadata(buf, { packName: 'only name' }));
  assert.equal(merged.metadata['sticker-pack-name'], 'only name');
  assert.equal(merged.metadata['sticker-pack-publisher'], 'A');

  const replaced = await inspectWAS(
    await customizeMetadata(buf, { packName: 'only name' }, { merge: false }),
  );
  assert.equal(replaced.metadata['sticker-pack-name'], 'only name');
  assert.equal(replaced.metadata['sticker-pack-publisher'], undefined);
});

test('customizeMetadata defaults is-from-user-created-pack to 1', async () => {
  const buf = await buildFakeWAS();
  const out = await inspectWAS(
    await customizeMetadata(buf, { packName: 'x' }, { merge: false }),
  );
  assert.equal(out.metadata['is-from-user-created-pack'], 1);
});

test('extractFromWAS rejects an empty/invalid buffer', async () => {
  await assert.rejects(extractFromWAS(null), /buffer is required/);
});

test('extractFromWAS picks animation.json over other JSONs', async () => {
  const jsonBytes = Buffer.from(JSON.stringify(FAKE_LOTTIE), 'utf8');
  const zip = new JSZip();
  zip.file('animation/animation_secondary.json', jsonBytes);
  zip.file('animation/animation.json', jsonBytes);
  zip.file('animation/animation.json.trust_token', makeFakeTrustToken(jsonBytes));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const { jsonPath } = await extractFromWAS(buf);
  assert.equal(jsonPath, 'animation/animation.json');
});
