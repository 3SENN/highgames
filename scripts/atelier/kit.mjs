// The Atelier kit for running the game outside Atelier (the emulator, the browser test). Atelier serves kit 1 to the game
// itself; here we need the same files, found in this order:
//   ATELIER_KIT_DIR                    a kit folder (the one with importmap.json)
//   ATELIER_DIR or ../atelier      its build output, out/kit/1 (node scripts/kit/build.mjs there)
//   the installed Atelier app          the kit inside its app.asar, copied once into .atelier/kit/1
// Then it checks the kit has what the game imports from it, and the same three.js the game is built with.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KIT_MAJOR = 1;
const CACHE = join(ROOT, '.atelier', 'kit', String(KIT_MAJOR));

/** The installed Atelier app's archive on this computer, if there is one. */
function installedAsar() {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Atelier.app/Contents/Resources/app.asar', join(homedir(), 'Applications', 'Atelier.app', 'Contents', 'Resources', 'app.asar')]
      : process.platform === 'win32'
        ? [join(local, 'Programs', 'Atelier', 'resources', 'app.asar'), 'C:/Program Files/Atelier/resources/app.asar']
        : ['/opt/Atelier/resources/app.asar', '/usr/lib/atelier/resources/app.asar'];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Reads an Electron app.asar: its JSON header, and a file's bytes. */
function openAsar(file) {
  const fd = openSync(file, 'r');
  const size = Buffer.alloc(8);
  readSync(fd, size, 0, 8, 0);
  const headerSize = size.readUInt32LE(4);
  const raw = Buffer.alloc(headerSize);
  readSync(fd, raw, 0, headerSize, 8);
  const header = JSON.parse(raw.toString('utf8', 8, 8 + raw.readInt32LE(4)));
  return {
    header,
    read(entry) {
      const out = Buffer.alloc(entry.size);
      readSync(fd, out, 0, entry.size, 8 + headerSize + Number(entry.offset));
      return out;
    },
    close: () => closeSync(fd),
  };
}

/** Copies out/kit/<major> from an app.asar into the cache, unless the cached copy came from this same archive. */
function fromAsar(asar) {
  const stamp = `${asar} ${statSync(asar).size} ${statSync(asar).mtimeMs}`;
  const stampFile = join(CACHE, '.from');
  if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) return CACHE;
  const archive = openAsar(asar);
  try {
    let dir = archive.header;
    for (const part of ['out', 'kit', String(KIT_MAJOR)]) dir = dir?.files?.[part];
    if (!dir?.files) return null;
    rmSync(CACHE, { recursive: true, force: true });
    const copy = (node, to) => {
      for (const [name, entry] of Object.entries(node.files)) {
        const target = join(to, name);
        if (entry.files) copy(entry, target);
        else if (!entry.unpacked) {
          mkdirSync(to, { recursive: true });
          writeFileSync(target, archive.read(entry));
        }
      }
    };
    copy(dir, CACHE);
    writeFileSync(stampFile, stamp);
    return CACHE;
  } finally {
    archive.close();
  }
}

/** Where the kit is, or throws with what to do. */
export function findKit() {
  const tried = [];
  const folder = (dir) => {
    tried.push(dir);
    return existsSync(join(dir, 'importmap.json')) ? dir : null;
  };
  if (process.env.ATELIER_KIT_DIR) {
    const dir = folder(resolve(process.env.ATELIER_KIT_DIR));
    if (dir) return dir;
  }
  const atelierDir = resolve(process.env.ATELIER_DIR ?? join(ROOT, '..', 'atelier'));
  const built = folder(join(atelierDir, 'out', 'kit', String(KIT_MAJOR)));
  if (built) return built;
  const asar = installedAsar();
  if (asar) {
    tried.push(asar);
    const dir = fromAsar(asar);
    if (dir) return dir;
  }
  throw new Error(
    `The Atelier kit ${KIT_MAJOR} wasn't found (looked in ${tried.join(', ') || 'nothing'}). Install Atelier, build the kit in atelier ` +
      '(node scripts/kit/build.mjs), or set ATELIER_KIT_DIR to a kit folder.',
  );
}

/** Problems with a kit for this game: files it imports that are missing, or another three.js. */
export function checkKit(dir, addons) {
  const problems = [];
  for (const file of ['importmap.json', 'atelier-kit/character.js', 'three/build/three.module.js', 'companion/manifest.json', ...addons.map((a) => `three/examples/jsm/${a}`)]) {
    if (!existsSync(join(dir, file))) problems.push(`the kit has no ${file}`);
  }
  const core = join(dir, 'three', 'build', 'three.core.js');
  const revision = existsSync(core) ? /REVISION\s*=\s*['"](\d+)/.exec(readFileSync(core, 'utf8'))?.[1] : null;
  const ours = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'three', 'package.json'), 'utf8')).version;
  if (revision && !ours.startsWith(`0.${revision}.`)) problems.push(`the kit has three.js r${revision} and the game is built with ${ours}: pin three to the kit's version`);
  return problems;
}

/** A short fingerprint of the kit (its import map and companion runtime), for logs. */
export function kitVersion(dir) {
  const hash = createHash('sha256');
  for (const file of ['importmap.json', 'atelier-kit/character.js']) hash.update(readFileSync(join(dir, file)));
  return hash.digest('hex').slice(0, 12);
}

/** The addons the build leaves to the kit (vite.kit.ts), read without TypeScript. */
export function kitAddons() {
  const source = readFileSync(join(ROOT, 'vite.kit.ts'), 'utf8');
  const list = /KIT_ADDONS[^=]*=\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
