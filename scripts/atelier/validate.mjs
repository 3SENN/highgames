#!/usr/bin/env node
// Checks a pack folder the way Atelier does at install. With the atelier repository next to this one (or ATELIER_DIR),
// it runs Atelier's own validatePack (src/main/packs/manifest.ts, see atelier.mjs); without it, it checks the rules
// Highgames depends on itself.
//
//   node scripts/atelier/validate.mjs [pack]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFromAtelier } from './atelier.mjs';
import { ROOT } from './kit.mjs';

/** What Atelier never reads into a pack (atelier/scripts/packs/pack.mjs › IGNORED). */
const IGNORED = new Set(['.DS_Store', 'Thumbs.db', '__MACOSX', '.git', '__atelier', '.npmrc']);

/** Every file of a pack: its /-separated path and bytes. */
export function readPack(dir) {
  const files = new Map();
  const walk = (at, prefix) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(at, entry.name), rel);
      else if (entry.isFile()) files.set(rel, readFileSync(join(at, entry.name)));
    }
  };
  walk(dir, '');
  return files;
}

export function packSize(dir) {
  let bytes = 0;
  const files = readPack(dir);
  for (const data of files.values()) bytes += data.length;
  return { files: files.size, bytes };
}

/** Atelier's validatePack, bundled from the atelier source; null without the repository. */
async function atelierValidator() {
  const loaded = await loadFromAtelier('validate-pack', "export { validatePack } from '{atelier}/src/main/packs/manifest.ts';");
  return loaded ? { validatePack: loaded.module.validatePack, version: loaded.version } : null;
}

/** The rules Highgames relies on, for when Atelier's own check isn't at hand. */
function localChecks(files) {
  const problems = [];
  const raw = files.get('atelier-pack.json');
  if (!raw) return ['atelier-pack.json: missing'];
  let m;
  try {
    m = JSON.parse(raw.toString('utf8'));
  } catch {
    return ['atelier-pack.json: not valid JSON'];
  }
  if (m.format !== 'atelier-pack' || m.manifestVersion !== 2) problems.push('atelier-pack.json: needs "format": "atelier-pack" and "manifestVersion": 2');
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(m.id ?? '')) problems.push('id: 2 to 32 lowercase letters, digits and dashes');
  if (!/^\d+\.\d+\.\d+$/.test(m.version ?? '')) problems.push('version: major.minor.patch');
  if (!m.description || m.description.length > 500) problems.push('description: 1 to 500 characters');
  const apps = m.contributes?.apps ?? [];
  if (apps.length !== 1) problems.push('contributes.apps: Highgames is one app');
  for (const app of apps) {
    if (!files.has(`${app.root}/${app.entry}`)) problems.push(`contributes.apps: ${app.root}/${app.entry} is not in the pack`);
    if (app.icon && (!files.has(app.icon) || files.get(app.icon).length > 64 * 1024)) problems.push(`contributes.apps.icon: ${app.icon} missing or over 64 KB`);
    if (app.cast && (app.cast.max < 1 || app.cast.max > 8 || app.cast.min > app.cast.max)) problems.push('contributes.apps.cast: min 0 to max, max 1 to 8');
  }
  if (!m.permissions?.server) problems.push('permissions.server: phones join through atelier.server');
  let bytes = 0;
  for (const [path, data] of files) {
    bytes += data.length;
    if (data.length > 50 * 1024 * 1024) problems.push(`${path}: over 50 MB`);
    if (/(^|\/)\.env(\..*)?$/i.test(path)) problems.push(`${path}: a .env file has no place in a pack`);
    if (!path.split('/').every((seg) => /^[A-Za-z0-9._\-+=,!@&'()[\]~ ]{1,120}$/.test(seg))) problems.push(`${path}: a name Atelier refuses`);
  }
  if (files.size > 5000) problems.push(`${files.size} files: at most 5,000`);
  if (bytes > 300 * 1024 * 1024) problems.push('the pack is over 300 MB');
  return problems;
}

/** { ok, problems, by: 'atelier' | 'local', atelierVersion, notes } for the pack in `dir`. */
export async function validatePack(dir) {
  const files = readPack(dir);
  const notes = [];
  const atelier = await atelierValidator().catch((err) => {
    notes.push(`Atelier's validatePack couldn't be loaded (${err.message.split('\n')[0]}); used Highgames' own checks.`);
    return null;
  });
  if (!atelier) {
    if (!notes.length) notes.push('atelier isn’t next to this repository (or ATELIER_DIR): used Highgames’ own checks, not Atelier’s.');
    const problems = localChecks(files);
    return { ok: problems.length === 0, problems, by: 'local', atelierVersion: null, notes };
  }
  const result = atelier.validatePack(files);
  const problems = result.problems ?? [];
  return { ok: result.ok === true && problems.length === 0, problems, by: 'atelier', atelierVersion: atelier.version, notes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? join(ROOT, 'pack'));
  if (!existsSync(join(dir, 'atelier-pack.json')) || !statSync(dir).isDirectory()) {
    console.error(`No pack at ${dir}: run npm run build first.`);
    process.exit(1);
  }
  const result = await validatePack(dir);
  for (const note of result.notes) console.info(note);
  if (!result.ok) {
    console.error(`Not a valid Atelier pack (${result.by}):\n${result.problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.info(`${dir} passes ${result.by === 'atelier' ? `Atelier's validatePack (atelier ${result.atelierVersion})` : 'Highgames’ checks'}.`);
}
