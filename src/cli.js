#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { inspectWAS } from './extract.js';
import { customizeMetadata } from './customize.js';

const USAGE = `was-sticker — inspect and re-brand WhatsApp Lottie stickers (.was).

Usage:
  was-sticker inspect <in.was>
  was-sticker customize <in.was> -o <out.was>
                                 [--pack-id ID] [--pack-name NAME]
                                 [--publisher PUBLISHER] [--accessibility-text TEXT]
                                 [--emoji EMOJI ... | --emojis "🎃,🎉,💎"]
                                 [--no-merge]

Subcommands:
  inspect      Show the Lottie metadata, trust-token claims, and SHA match.
  customize    Rewrite only the overridden_metadata; emits a new .was.

For sending and capturing .was files, use the JS API:
    import { sendLottieSticker, captureNextLottieSticker } from 'was-sticker';
`;

function fail(msg, code = 1) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

const [, , sub, ...rest] = process.argv;

if (!sub || sub === '-h' || sub === '--help') {
  process.stdout.write(USAGE);
  process.exit(sub ? 0 : 1);
}

async function readInput(positional) {
  if (!positional) fail('Missing <in.was>.');
  return readFile(resolve(positional));
}

async function writeOutput(path, buffer) {
  const abs = resolve(path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buffer);
  return abs;
}

if (sub === 'inspect') {
  const buffer = await readInput(rest[0]);
  const info = await inspectWAS(buffer);
  process.stdout.write(JSON.stringify(info, null, 2) + '\n');
  process.exit(0);
}

if (sub === 'customize') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      'pack-id':            { type: 'string' },
      'pack-name':          { type: 'string' },
      publisher:            { type: 'string' },
      'accessibility-text': { type: 'string' },
      emoji:                { type: 'string', multiple: true },
      emojis:               { type: 'string' },
      'no-merge':           { type: 'boolean' },
      help:                 { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (!positionals[0]) fail('Missing <in.was>.');
  if (!values.out)     fail('Missing --out / -o.');

  const buffer = await readInput(positionals[0]);

  const emojis = values.emoji?.length
    ? values.emoji
    : values.emojis?.split(',').map((s) => s.trim()).filter(Boolean);

  const patch = {
    ...(values['pack-id']            && { packId:            values['pack-id'] }),
    ...(values['pack-name']          && { packName:          values['pack-name'] }),
    ...(values.publisher             && { publisher:         values.publisher }),
    ...(values['accessibility-text'] && { accessibilityText: values['accessibility-text'] }),
    ...(emojis                       && { emojis }),
  };

  const out = await customizeMetadata(buffer, patch, { merge: !values['no-merge'] });
  const path = await writeOutput(values.out, out);
  process.stdout.write(`${path}  (${out.length.toLocaleString()} bytes)\n`);
  process.exit(0);
}

fail(`Unknown subcommand "${sub}".\n\n${USAGE}`);
