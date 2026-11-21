// Runs the built pack in Atelier itself: atelier's build (next to this repository, or ATELIER_DIR, after `npm run
// build` there) with a throwaway profile, so your own Atelier and its data are never touched. It loads pack/ the way
// Packs › Add › Load a folder… does, through Atelier's own review and install, opens the game in its tab, and joins it
// with a phone browser at the address Atelier's web server gives the lobby. Then it plays into the first minigame.
//   npm run build && npm run e2e:atelier
// A window of Atelier opens while it runs. Screenshots land in test-results/e2e/in-atelier/.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium } from 'playwright-core';
import { findBrowser } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'test-results', 'e2e', process.env.E2E_OUT ?? 'in-atelier');
const PACK = path.resolve(ROOT, process.env.E2E_PACK ?? 'pack');
const ATELIER = path.resolve(process.env.ATELIER_DIR ?? path.join(ROOT, '..', 'atelier'));
const SECONDS = Number(process.env.E2E_SECONDS ?? 180);

if (!fs.existsSync(path.join(ATELIER, 'out', 'main', 'index.js'))) throw new Error(`No built atelier at ${ATELIER} (run npm run build there, or set ATELIER_DIR).`);
if (!fs.existsSync(path.join(PACK, 'atelier-pack.json'))) throw new Error(`No pack at ${PACK}: run npm run build first.`);
fs.mkdirSync(OUT, { recursive: true });

const electron = createRequire(path.join(ATELIER, 'package.json'))('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'highgames-atelier-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set inside editors that run on Electron; Atelier has to start as an app
const errors = [];
const say = (...a) => console.info(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await _electron.launch({ executablePath: electron, args: [ATELIER, `--user-data-dir=${profile}`, '--use-mock-keychain'], env, timeout: 60_000 });
let phoneBrowser = null;
try {
  // Pick pack/ in Atelier's folder dialog, and keep what the game's pages print.
  await app.evaluate(({ dialog, app: electronApp }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    globalThis.__highgames = [];
    electronApp.on('web-contents-created', (_e, wc) =>
      wc.on('console-message', (details) => {
        if (wc.getURL().startsWith('atelier-pack://')) globalThis.__highgames.push({ level: details.level, text: details.message });
      }),
    );
  }, PACK);

  let ui = null;
  for (let i = 0; i < 120 && !ui; i++) {
    ui = app.windows().find((w) => w.url() === 'app://atelier/index.html') ?? null;
    if (!ui) await wait(500);
  }
  if (!ui) throw new Error('Atelier opened no window');
  await ui.waitForFunction(() => typeof window.atelier?.invoke === 'function', null, { timeout: 30_000 });

  // Install it the way a person does: review, then Add.
  const review = await ui.evaluate(() => window.atelier.invoke('packs', 'loadFolder'));
  if (!review) throw new Error('Atelier didn’t review the folder');
  say(`review: ${review.name} ${review.version}, ${review.permissions.map((p) => `${p.level} ${p.kind}`).join(', ')}`);
  if (review.problems.length) throw new Error(`Atelier found problems: ${review.problems.join('; ')}`);
  const installed = await ui.evaluate((token) => window.atelier.invoke('packs', 'confirmInstall', token), review.token);
  if (!installed.enabled || installed.problems?.length) throw new Error(`installed but not running: ${JSON.stringify(installed.problems)}`);
  await ui.evaluate(() => window.atelier.invoke('packs', 'openApp', 'highgames', 'main'));

  // The game's tab.
  let tab = null;
  for (let i = 0; i < 60 && !tab; i++) {
    tab = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().startsWith('atelier-pack://highgames/'))?.id ?? null);
    if (!tab) await wait(500);
  }
  if (!tab) throw new Error('the game’s tab never opened');
  const inTab = (code) => app.evaluate(({ webContents }, [id, js]) => webContents.fromId(id).executeJavaScript(js), [tab, code]);
  const shot = async (name) => {
    const png = await app.evaluate(async ({ webContents }, id) => (await webContents.fromId(id).capturePage()).toPNG().toString('base64'), tab);
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png, 'base64'));
  };
  // A line printed on purpose proves the console is heard, so silence below means no errors.
  await inTab(`console.info('highgames: console check')`);

  let joinUrl = null;
  for (let i = 0; i < 120 && !joinUrl; i++) {
    joinUrl = await inTab(`document.querySelector('.lobby__url')?.dataset.url ?? null`).catch(() => null);
    if (!joinUrl) await wait(500);
  }
  await shot('01-tv-lobby');
  if (!joinUrl) throw new Error(`no join address: ${await inTab(`document.querySelector('.lobby__join')?.textContent ?? 'no lobby'`)}`);
  say(`phones join at ${joinUrl}`);

  // A phone on the Wi-Fi.
  phoneBrowser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const phone = await (await phoneBrowser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  phone.on('pageerror', (e) => errors.push(`[phone] ${e.message}`));
  phone.on('console', (m) => (m.type() === 'error' || m.text().startsWith('[companion]')) && errors.push(`[phone] ${m.text()}`));
  phone.on('response', (r) => r.status() >= 400 && errors.push(`[phone] ${r.status()} ${r.url()}`));
  await phone.goto(joinUrl);
  await phone.fill('input[name=name]', 'Tester');
  await phone.click('button[type=submit]');
  await phone.waitForSelector('.customizer', { timeout: 30_000 });
  await phone.waitForTimeout(2500); // the 3D preview builds
  await phone.click('.co-ring__bubble[aria-label=Hat]');
  await phone.click('.co-ring-grid .co-ring-tile:nth-child(3)');
  await phone.waitForTimeout(2500); // the stills render, and the big screen dresses the companion
  await phone.screenshot({ path: path.join(OUT, '02-phone-editor.png') });
  await shot('03-tv-lobby-joined');
  const seats = await inTab(`[...document.querySelectorAll('.lobby__seats .seat__name')].map((e) => e.textContent)`);
  if (!seats.includes('Tester')) errors.push(`the lobby shows ${JSON.stringify(seats)}, not the phone`);

  // Start Snack Run from the phone and play into the first minigame.
  await phone.click('.co-footer .co-btn--primary');
  const seen = new Set();
  const deadline = Date.now() + SECONDS * 1000;
  while (Date.now() < deadline && !seen.has('intro')) {
    const kind = await phone.getAttribute('#app', 'data-kind').catch(() => null);
    if (kind && !seen.has(kind)) seen.add(kind);
    const tap = async (sel) => (await phone.$(`${sel}:not([disabled])`))?.click({ timeout: 1000 }).catch(() => {});
    if (kind === 'menu') await (await phone.$('.option:not([disabled])'))?.click().catch(() => {});
    else if (kind === 'turn') await tap('.roll');
    else if (kind === 'choice' || kind === 'parcel' || kind === 'shop') await tap('.option');
    await phone.waitForTimeout(300);
  }
  await shot('04-tv-in-game');
  await phone.screenshot({ path: path.join(OUT, '05-phone-in-game.png') });
  say(`screens on the phone: ${[...seen].join(', ')}`);
  if (!seen.has('intro')) errors.push('the game never reached a minigame');
} catch (err) {
  errors.push(`step failed: ${err.message.split('\n')[0]}`);
} finally {
  const lines = await app.evaluate(() => globalThis.__highgames ?? []).catch(() => []);
  if (!lines.some((l) => l.text === 'highgames: console check')) errors.push('the game’s console was never heard');
  for (const l of lines) if (l.level === 'error' || (l.level === 'warning' && !l.text.startsWith('highgames:'))) errors.push(`[tv] ${l.level}: ${l.text}`);
  await phoneBrowser?.close();
  await app.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s) in Atelier:\n${errors.join('\n')}`);
  process.exit(1);
}
console.info(`\nHighgames runs in Atelier. Screenshots in ${path.relative(ROOT, OUT)}`);
