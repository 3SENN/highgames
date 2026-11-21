#!/usr/bin/env node
// Builds the pack and makes the signed file people install: highgames-<version>.atelierapp (docs/packs.md › Sharing).
// Signing is Atelier's own script (atelier/scripts/packs/pack.mjs): the same hash and Ed25519 signature Atelier
// checks, with trust on first use, so keep the key private and out of every repository.
//
//   npm run package -- --key <key.pem> [--out dist/highgames.atelierapp] [--entry <https address it will be at>]
//   npm run package -- --new-key <key.pem>          make a signing key once
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PACK, buildPack } from './build.mjs';
import { ROOT } from './kit.mjs';
import { validatePack } from './validate.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const atelier = resolve(process.env.ATELIER_DIR ?? join(ROOT, '..', 'atelier'));
const packer = join(atelier, 'scripts', 'packs', 'pack.mjs');
if (!existsSync(packer)) {
  console.error(`Signing uses Atelier's pack script, and there's no atelier at ${atelier} (set ATELIER_DIR).`);
  process.exit(1);
}
const run = (...more) => execFileSync(process.execPath, [packer, ...more], { stdio: 'inherit' });

if (args.includes('--new-key')) {
  run('--new-key', resolve(flag('--new-key') ?? 'highgames-key.pem'));
  process.exit(0);
}

const key = flag('--key');
if (!key) {
  console.error('Usage: npm run package -- --key <key.pem> [--out <file.atelierapp>] [--entry <https url>]\n       npm run package -- --new-key <key.pem>');
  process.exit(1);
}
const manifest = await buildPack();
const check = await validatePack(PACK);
if (!check.ok) {
  console.error(`Not a valid Atelier pack:\n${check.problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
const out = resolve(flag('--out') ?? join(ROOT, 'dist', `${manifest.id}-${manifest.version}.atelierapp`));
mkdirSync(dirname(out), { recursive: true });
const entry = flag('--entry');
run(PACK, out, '--key', resolve(key), ...(entry ? ['--entry', entry, '--category', 'games'] : []));
