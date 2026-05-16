import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';

import { buildLottieSticker, detectMimeFromBuffer } from '../src/index.js';

// 1×1 transparent PNG
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
  '890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
  'hex',
);

function fakeLottie() {
  return {
    v: '5.7.1',
    fr: 30,
    ip: 0,
    op: 60,
    w: 512,
    h: 512,
    nm: 'test',
    ddd: 0,
    assets: [
      { id: 'image_0', w: 512, h: 512, u: '', p: 'data:image/png;base64,AAAA' },
    ],
    layers: [],
  };
}

test('MIME sniffing detects PNG magic bytes', () => {
  assert.equal(detectMimeFromBuffer(PNG), 'image/png');
});

test('builds a .was buffer from parsed-object template', async () => {
  const { buffer, mime, output } = await buildLottieSticker({
    image: { buffer: PNG, mime: 'image/png' },
    template: fakeLottie(),
  });

  assert.equal(mime, 'application/was');
  assert.equal(output, undefined);
  assert.ok(buffer.length > 100, 'output too small to be a real zip');

  const zip = await JSZip.loadAsync(buffer);
  const jsonFile = zip.file('animation/animation.json');
  assert.ok(jsonFile, 'expected JSON entry to be present');
  const parsed = JSON.parse(await jsonFile.async('string'));
  assert.equal(parsed.assets[0].p, `data:image/png;base64,${PNG.toString('base64')}`);
});

test('builds from a folder template and writes to disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'was-test-'));
  await mkdir(join(dir, 'template', 'animation'), { recursive: true });
  await writeFile(
    join(dir, 'template', 'animation', 'animation_secondary.json'),
    JSON.stringify(fakeLottie()),
  );
  await writeFile(join(dir, 'template', 'README.txt'), 'sibling asset');

  const out = join(dir, 'sticker.was');
  await buildLottieSticker({
    image: { buffer: PNG, mime: 'image/png' },
    template: join(dir, 'template'),
    output: out,
  });

  const zip = await JSZip.loadAsync(await readFile(out));
  assert.ok(zip.file('animation/animation_secondary.json'), 'lottie JSON missing');
  assert.ok(zip.file('README.txt'), 'sibling asset missing');
});

test('does not mutate input template object', async () => {
  const tpl = fakeLottie();
  const before = tpl.assets[0].p;
  await buildLottieSticker({
    image: { buffer: PNG, mime: 'image/png' },
    template: tpl,
  });
  assert.equal(tpl.assets[0].p, before, 'caller template was mutated');
});

test('rejects unsupported MIME', async () => {
  await assert.rejects(
    buildLottieSticker({
      image: { buffer: Buffer.from('hello'), mime: 'image/gif' },
      template: fakeLottie(),
    }),
    /Unsupported mime/,
  );
});

test('rejects template with no base64 image asset and no selector', async () => {
  const tpl = fakeLottie();
  tpl.assets[0].p = 'external.png';
  await assert.rejects(
    buildLottieSticker({
      image: { buffer: PNG, mime: 'image/png' },
      template: tpl,
    }),
    /No embedded base64 image asset/,
  );
});

test('asset selector by index works', async () => {
  const tpl = fakeLottie();
  tpl.assets[0].p = 'external.png';
  const { buffer } = await buildLottieSticker({
    image: { buffer: PNG, mime: 'image/png' },
    template: tpl,
    assetSelector: 0,
  });
  const zip = await JSZip.loadAsync(buffer);
  const parsed = JSON.parse(await zip.file('animation/animation.json').async('string'));
  assert.ok(parsed.assets[0].p.startsWith('data:image/png;base64,'));
});
