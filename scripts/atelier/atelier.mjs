// Atelier's own code, from the atelier repository next to this one (or ATELIER_DIR), for checking Highgames against
// the real thing: its pack validator (validate.mjs) and the web server it runs for apps (emulator.mjs --atelier-server).
// Main-process modules are bundled on the fly with the esbuild Vite ships, with Electron stubbed out: these parts
// never call into it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './kit.mjs';

/** The atelier checkout, or null. */
export function atelierDir() {
  const dir = resolve(process.env.ATELIER_DIR ?? join(ROOT, '..', 'atelier'));
  return existsSync(join(dir, 'src', 'main', 'packs', 'manifest.ts')) ? dir : null;
}

/** Its commit, for messages. */
export function atelierVersion(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'log', '-1', '--format=%h %cs'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const ELECTRON_STUB = `// Stands in for electron while parts of Atelier's main process run in plain Node.
const handler = { get: (_t, p) => (p === '__esModule' ? false : new Proxy(function () {}, handler)), apply: () => undefined };
const stub = new Proxy(function () {}, handler);
export default stub;
export const app = stub, safeStorage = stub, ipcMain = stub, ipcRenderer = stub, BrowserWindow = stub, BaseWindow = stub, WebContentsView = stub, shell = stub, net = stub, session = stub, webContents = stub, dialog = stub, nativeImage = stub, nativeTheme = stub, Notification = stub, clipboard = stub, protocol = stub, powerMonitor = stub, systemPreferences = stub, screen = stub, Menu = stub, MenuItem = stub, Tray = stub, utilityProcess = stub, crashReporter = stub, autoUpdater = stub, globalShortcut = stub, contentTracing = stub, desktopCapturer = stub, contextBridge = stub, webFrame = stub;
`;

/**
 * Bundles `source` (an ES module that re-exports from Atelier's files; `{atelier}` stands for the checkout) into
 * .atelier/<name>.mjs and imports it.
 */
export async function loadFromAtelier(name, source) {
  const atelier = atelierDir();
  if (!atelier) return null;
  const require = createRequire(import.meta.url);
  const esbuild = await import(pathToFileURL(require.resolve('esbuild', { paths: [dirname(require.resolve('vite'))] })).href);
  const out = join(ROOT, '.atelier', 'from-atelier');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'electron.mjs'), ELECTRON_STUB);
  const file = join(out, `${name}.mjs`);
  await esbuild.build({
    stdin: { contents: source.replaceAll('{atelier}', atelier.replaceAll('\\', '/')), resolveDir: atelier, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: file,
    logLevel: 'error',
    alias: { '@shared': join(atelier, 'src', 'shared'), '@engines': join(atelier, 'src', 'engines'), electron: join(out, 'electron.mjs') },
    nodePaths: [join(atelier, 'node_modules')],
    banner: { js: "import { createRequire as __atelierRequire } from 'node:module'; const require = __atelierRequire(import.meta.url);" },
    plugins: [
      {
        // Vite's ?raw imports (Atelier's built-in skills) as text.
        name: 'raw',
        setup(b) {
          b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
          b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
        },
      },
    ],
  });
  return { module: await import(`${pathToFileURL(file).href}?t=${Date.now()}`), version: atelierVersion(atelier) };
}
