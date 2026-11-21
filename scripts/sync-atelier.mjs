#!/usr/bin/env node
// Keeps Highgames in step with Atelier, from the atelier repository next to this one (or ATELIER_DIR / the first
// argument). Atelier itself serves the companions to the game at run time (the kit: three.js, atelier-kit/character.js and
// the companion art), so only the look contract is copied, for checking looks and the phone's companion editor:
//
//   src/shared/companion.ts        the look contract (parts, faces, tints…)  -> vendor/atelier-look/
//   src/shared/companionLogic.ts   look rules: normalise, randomise, compat  -> vendor/atelier-look/
//
// It also checks that kit 1 still serves every three.js add-on the build leaves to it (vite.kit.ts).
//   node scripts/sync-atelier.mjs [path/to/atelier]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, kitAddons } from './atelier/kit.mjs';

const args = process.argv.slice(2);
const atelier = resolve(args.find((a) => !a.startsWith('--')) ?? process.env.ATELIER_DIR ?? join(ROOT, '..', 'atelier'));
if (!existsSync(join(atelier, 'src', 'shared', 'companion.ts'))) {
  console.error(`No atelier repository at ${atelier}. Pass its path or set ATELIER_DIR.`);
  process.exit(1);
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', atelier, 'log', '-1', '--format=%h %cs'], { encoding: 'utf8' }).trim();
} catch {
  // Not a git checkout: the version note just says unknown.
}
const banner = (from) => `// Copied from atelier/${from} (${commit}) by scripts/sync-atelier.mjs. Don't edit: change it in Atelier and sync again.\n// Licensed under the Mozilla Public License 2.0, as all of Atelier's code: https://mozilla.org/MPL/2.0/\n`;

// ---- the kit's add-ons: everything the build leaves to the kit must be in kit 1
const kitBuild = readFileSync(join(atelier, 'scripts', 'kit', 'build.mjs'), 'utf8');
const served = [...(/const ADDONS = \[([^\]]*)\]/.exec(kitBuild)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
const missing = kitAddons().filter((a) => !served.includes(a));
if (missing.length) {
  console.error(`Kit 1 no longer lists ${missing.join(', ')}: bundle them (remove them from KIT_ADDONS in vite.kit.ts).`);
  process.exit(1);
}

// ---- the look contract and rules (pure TypeScript: no DOM, no three.js)
const lookOut = join(ROOT, 'vendor', 'atelier-look');
rmSync(lookOut, { recursive: true, force: true });
mkdirSync(lookOut, { recursive: true });
let contract = readFileSync(join(atelier, 'src', 'shared', 'companion.ts'), 'utf8');
// Presets carry starter skills and routines for Atelier's agent; Highgames only uses their looks.
contract = contract.replace(/\/\/ ── D:L7 preset imports ──[\s\S]*?\/\/ ── end D:L7 ──\n/, '');
contract = contract.replace(/SkillDraft\[\]/g, 'unknown[]').replace(/RoutineDraft\[\]/g, 'unknown[]');
// Companion files (import/export in Atelier) refer to routine schedules; Highgames never reads those files.
contract = contract.replace(/import\('\.\/(routines|skills)'\)\.\w+/g, 'unknown');
if (/from '\.\/(routines|skills)'|import\('\.\/(routines|skills)'\)/.test(contract)) {
  console.error('companion.ts imports more of Atelier than expected. Update scripts/sync-atelier.mjs.');
  process.exit(1);
}
writeFileSync(join(lookOut, 'companion.ts'), banner('src/shared/companion.ts') + contract);
writeFileSync(join(lookOut, 'companionLogic.ts'), banner('src/shared/companionLogic.ts') + readFileSync(join(atelier, 'src', 'shared', 'companionLogic.ts'), 'utf8'));

writeFileSync(join(ROOT, 'vendor', 'ATELIER_VERSION'), `${commit}\n`);
console.info(`Synced Atelier's look contract (${commit}) into vendor/atelier-look/. Kit 1 serves all ${served.length} add-ons the build expects.`);
