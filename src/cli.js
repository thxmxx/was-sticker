#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

import { buildLottieSticker } from './index.js';

const USAGE = `was-sticker — build WhatsApp animated stickers from a Lottie template.

Usage:
  was-sticker --image <path> --template <path> [--out sticker.was]
              [--selector <id|index>] [--json-entry <path-in-archive>]

Options:
  -i, --image     Image file (PNG, JPG, WEBP).                    [required]
  -t, --template  Lottie folder, JSON file, or pre-parsed JSON.   [required]
  -o, --out       Output .was path. Default: ./sticker.was
  -s, --selector  Asset id (string) or 0-based index.
      --json-entry  Path of the Lottie JSON inside the .was.
  -h, --help      Show this help.

Examples:
  was-sticker -i face.png -t ./templates/heart -o heart.was
  was-sticker -i face.png -t lottie.json -s image_0
`;

function fail(msg, code = 1) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    image:      { type: 'string', short: 'i' },
    template:   { type: 'string', short: 't' },
    out:        { type: 'string', short: 'o' },
    selector:   { type: 'string', short: 's' },
    'json-entry': { type: 'string' },
    help:       { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

if (!values.image || !values.template) {
  process.stderr.write(USAGE);
  fail('\nMissing required --image or --template.');
}

const output = resolve(values.out ?? './sticker.was');

const selector =
  values.selector == null
    ? undefined
    : /^\d+$/.test(values.selector)
      ? Number(values.selector)
      : values.selector;

try {
  const { output: written, buffer } = await buildLottieSticker({
    image: values.image,
    template: values.template,
    output,
    assetSelector: selector,
    jsonEntryName: values['json-entry'],
  });
  process.stdout.write(`${written}  (${buffer.length.toLocaleString()} bytes)\n`);
} catch (err) {
  fail(`Error: ${err.message}`);
}
