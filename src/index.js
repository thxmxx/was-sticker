import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

import {
  SUPPORTED_MIMES,
  detectMimeFromBuffer,
  detectMimeFromExtension,
} from './mime.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));
const BUNDLED_TEMPLATE_NAMES = Object.freeze(['pulse']);

/**
 * Resolve the absolute path of a Lottie template bundled with this package.
 * @param {'pulse'} [name='pulse']
 * @returns {string} absolute path to the template's JSON file
 */
export function bundledTemplate(name = 'pulse') {
  if (!BUNDLED_TEMPLATE_NAMES.includes(name)) {
    throw new Error(
      `Unknown bundled template "${name}". Available: ${BUNDLED_TEMPLATE_NAMES.join(', ')}.`,
    );
  }
  return join(TEMPLATES_DIR, name, 'animation.json');
}

const DEFAULT_JSON_ENTRY = 'animation/animation.json';

const toDataUri = (buffer, mime) =>
  `data:${mime};base64,${buffer.toString('base64')}`;

async function resolveImage(image) {
  if (image == null) throw new Error('image is required.');

  let buffer;
  let mime;
  let path;

  if (typeof image === 'string') {
    path = image;
  } else if (Buffer.isBuffer(image)) {
    buffer = image;
  } else if (typeof image === 'object') {
    ({ buffer, mime, path } = image);
  } else {
    throw new Error('image must be a string path, Buffer, or { buffer | path, mime? }.');
  }

  if (!buffer) {
    if (!path) throw new Error('image must include `buffer` or `path`.');
    buffer = await readFile(path);
  }

  mime ??= detectMimeFromExtension(path) ?? detectMimeFromBuffer(buffer);
  if (!mime) {
    throw new Error(
      `Unable to detect image mime. Supported: ${SUPPORTED_MIMES.join(', ')}.`,
    );
  }
  if (!SUPPORTED_MIMES.includes(mime)) {
    throw new Error(`Unsupported mime "${mime}". Use one of: ${SUPPORTED_MIMES.join(', ')}.`);
  }

  return { buffer, mime };
}

async function walkFiles(root) {
  const out = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await visit(root);
  return out.map((abs) => ({ abs, rel: relative(root, abs).split(sep).join('/') }));
}

async function resolveTemplate(template, jsonEntryName) {
  if (template == null) {
    throw new Error('template is required (folder path, JSON file path, Buffer, or parsed object).');
  }

  if (typeof template === 'string') {
    const info = await stat(template);
    if (info.isDirectory()) {
      const files = await walkFiles(template);
      const candidate =
        files.find((f) => f.rel === jsonEntryName) ??
        files.find((f) => f.rel.toLowerCase().endsWith('.json'));
      if (!candidate) {
        throw new Error(`No JSON file found in template folder "${template}".`);
      }
      const lottie = JSON.parse(await readFile(candidate.abs, 'utf8'));
      const extras = await Promise.all(
        files
          .filter((f) => f.abs !== candidate.abs)
          .map(async (f) => [f.rel, await readFile(f.abs)]),
      );
      return {
        lottie,
        jsonEntryName: candidate.rel,
        extraFiles: Object.fromEntries(extras),
      };
    }
    return {
      lottie: JSON.parse(await readFile(template, 'utf8')),
      jsonEntryName: jsonEntryName ?? DEFAULT_JSON_ENTRY,
      extraFiles: {},
    };
  }

  if (Buffer.isBuffer(template)) {
    return {
      lottie: JSON.parse(template.toString('utf8')),
      jsonEntryName: jsonEntryName ?? DEFAULT_JSON_ENTRY,
      extraFiles: {},
    };
  }

  if (typeof template === 'object') {
    return {
      lottie: structuredClone(template),
      jsonEntryName: jsonEntryName ?? DEFAULT_JSON_ENTRY,
      extraFiles: {},
    };
  }

  throw new Error('template must be a path, Buffer, or parsed Lottie object.');
}

function findImageAsset(lottie, selector) {
  if (!lottie || !Array.isArray(lottie.assets) || lottie.assets.length === 0) {
    throw new Error('Lottie template has no `assets` array.');
  }

  const isImageAsset = (a) => typeof a?.p === 'string' && a.p.startsWith('data:image/');

  if (selector == null) {
    const found = lottie.assets.find(isImageAsset);
    if (!found) {
      throw new Error(
        'No embedded base64 image asset found. Pass assetSelector to target a specific asset.',
      );
    }
    return found;
  }

  if (typeof selector === 'number') {
    const found = lottie.assets[selector];
    if (!found) throw new Error(`No asset at index ${selector}.`);
    return found;
  }

  if (typeof selector === 'string') {
    const found = lottie.assets.find((a) => a?.id === selector);
    if (!found) throw new Error(`No asset with id "${selector}".`);
    return found;
  }

  if (typeof selector === 'function') {
    const found = lottie.assets.find(selector);
    if (!found) throw new Error('assetSelector did not match any asset.');
    return found;
  }

  throw new Error('assetSelector must be a number, string, function, or undefined.');
}

/**
 * Build a WhatsApp animated sticker (`.was`) from an image and a Lottie template.
 *
 * @param {object} options
 * @param {string | Buffer | { buffer?: Buffer, path?: string, mime?: string }} options.image
 *   Image source. Either a file path, a raw Buffer, or an object with `buffer`/`path` and optional `mime`.
 * @param {string | Buffer | object} options.template
 *   Template source: a folder path, a JSON file path, a raw Buffer, or a parsed Lottie object.
 * @param {string} [options.output]
 *   If provided, the built `.was` is written here. The directory is created if missing.
 * @param {number | string | ((asset: object) => boolean)} [options.assetSelector]
 *   Which asset to swap. By default, the first asset with an embedded base64 image.
 * @param {string} [options.jsonEntryName]
 *   Path of the Lottie JSON inside the resulting archive. Defaults to the template's own path,
 *   or "animation/animation.json" when the template is a single JSON.
 * @param {Record<string, Buffer | string>} [options.extraFiles]
 *   Additional files to include in the archive (merged on top of folder-template files).
 * @returns {Promise<{ buffer: Buffer, output?: string, mime: 'application/was' }>}
 */
export async function buildLottieSticker({
  image,
  template,
  output,
  assetSelector,
  jsonEntryName,
  extraFiles,
} = {}) {
  const [{ buffer: imageBuffer, mime }, resolved] = await Promise.all([
    resolveImage(image),
    resolveTemplate(template, jsonEntryName),
  ]);

  const asset = findImageAsset(resolved.lottie, assetSelector);
  asset.p = toDataUri(imageBuffer, mime);
  asset.e = 1; // mark as embedded — required by Lottie players to decode the data: URI
  if ('u' in asset) asset.u = '';

  const zip = new JSZip();
  for (const [name, contents] of Object.entries(resolved.extraFiles)) {
    zip.file(name, contents);
  }
  zip.file(resolved.jsonEntryName, JSON.stringify(resolved.lottie));
  if (extraFiles) {
    for (const [name, contents] of Object.entries(extraFiles)) {
      zip.file(name, contents);
    }
  }

  const wasBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  if (output) {
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(output, wasBuffer);
  }

  return { buffer: wasBuffer, output, mime: 'application/was' };
}

export { SUPPORTED_MIMES, detectMimeFromBuffer, detectMimeFromExtension };
export { BUNDLED_TEMPLATE_NAMES };
