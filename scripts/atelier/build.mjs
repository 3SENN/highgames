#!/usr/bin/env node
// Builds Highgames as an Atelier pack in pack/ (docs/apps.md › Bringing a web project in):
//   pack/atelier-pack.json   the manifest: atelier-pack.json with package.json's version
//   pack/icon.svg         the app's icon
//   pack/app/             the big screen (vite.config.ts): the app's root, the page Atelier opens in a tab
//   pack/app/phone/       the controller page (vite.phone.config.ts), served to phones by atelier.server
// then checks the pack with Atelier's own rules (validate.mjs).
//
//   node scripts/atelier/build.mjs            build and check (npm run build)
//   node scripts/atelier/build.mjs --watch    build again whenever a file changes (npm run dev runs this)
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { ROOT } from './kit.mjs';
import { packSize, validatePack } from './validate.mjs';

export const PACK = join(ROOT, 'pack');

/** pack/atelier-pack.json and pack/icon.svg. The version lives in package.json only. */
export function writeManifest(dir = PACK) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'atelier-pack.json'), 'utf8'));
  manifest.version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'atelier-pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  copyFileSync(join(ROOT, 'src', 'assets', 'icon.svg'), join(dir, 'icon.svg'));
  return manifest;
}

/** Builds the pack once, or keeps building it (resolves once the first builds are done). */
export async function buildPack({ watch = false, quiet = false } = {}) {
  rmSync(PACK, { recursive: true, force: true });
  const manifest = writeManifest();
  const logLevel = quiet ? 'warn' : 'info';
  const configs = ['vite.config.ts', 'vite.phone.config.ts'];
  if (!watch) {
    for (const configFile of configs) await build({ configFile: join(ROOT, configFile), logLevel });
    return manifest;
  }
  // Watch mode: wait for each first build, so callers start from a complete pack.
  for (const configFile of configs) {
    const watcher = await build({ configFile: join(ROOT, configFile), logLevel, build: { watch: {} } });
    await new Promise((ok, fail) =>
      watcher.on('event', (e) => {
        if (e.code === 'END') ok();
        if (e.code === 'ERROR') {
          e.result?.close();
          fail(e.error);
        }
      }),
    );
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const watch = process.argv.includes('--watch');
  const manifest = await buildPack({ watch });
  if (!watch) {
    const result = await validatePack(PACK);
    const { files, bytes } = packSize(PACK);
    if (!result.ok) {
      console.error(`\n${relative(process.cwd(), PACK)}/ is not a valid Atelier pack (${result.by}):\n${result.problems.map((p) => `  - ${p}`).join('\n')}`);
      process.exit(1);
    }
    console.info(`\n  ${manifest.name} ${manifest.version} built as an Atelier pack in ${relative(process.cwd(), PACK) || '.'}/: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
    console.info(`  ${result.by === 'atelier' ? 'Atelier’s own validatePack' : 'Highgames’ checks'} found nothing wrong${result.by === 'atelier' ? ` (atelier ${result.atelierVersion})` : ''}.`);
    for (const note of result.notes) console.info(`  ${note}`);
    console.info('\n  Try it: npm start (the Atelier emulator), or in Atelier: Packs › Add › Load a folder… › pack/\n');
  }
}
