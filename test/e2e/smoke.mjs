// End-to-end smoke test: runs the built Atelier pack in the Atelier emulator (scripts/atelier/emulator.mjs), opens the big
// screen and one simulated phone in the locally installed Chrome or Edge, joins the way a player does (the address
// Atelier's web server gives the lobby), plays a whole one-round game and saves screenshots.
//   npm run build && npm run e2e
// Set E2E_BROWSER to a browser executable to override the search (browser.mjs), and ATELIER_SERVER=1 to serve the
// phone with Atelier's own server code (see scripts/atelier/emulator.mjs). test/e2e/in-atelier.mjs runs it in Atelier itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startEmulator } from '../../scripts/atelier/emulator.mjs';
import { findBrowser } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MINIGAME = process.env.E2E_GAME ?? '';
const MODE = Number(process.env.E2E_MODE ?? 0);
const OUT = path.join(ROOT, 'test-results', 'e2e', process.env.E2E_OUT ?? (MINIGAME || `mode-${MODE}`));
const PORT = Number(process.env.E2E_PORT ?? 8555);

const executablePath = findBrowser();

fs.mkdirSync(OUT, { recursive: true });
// E2E_PACK: test a pack built in another folder, so several runs can go at once.
// ATELIER_SERVER=1: phones are served by Atelier's own LocalServer and client.js (from atelier), not the stand-in.
const emulator = await startEmulator({ pack: process.env.E2E_PACK ?? 'pack', port: PORT, phonePort: PORT + 1, quiet: true, atelierServer: process.env.ATELIER_SERVER === '1' });
const BASE = emulator.url;

const errors = [];
// E2E_GPU=1 renders on the real graphics card (much faster, and the real look); the default is SwiftShader (software).
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
const gpuArgs = process.env.E2E_GPU ? [`--use-angle=${angle}`, '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath, headless: true, args: [...gpuArgs, '--autoplay-policy=no-user-gesture-required'] });
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`[${who}] ${e.message}`));
  page.on('console', (m) => {
    // Errors (CSP refusals among them), and the kit's own reports of companion art it couldn't load.
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[companion]'))) errors.push(`[${who}] console: ${m.text()}`);
  });
  // Anything the pack, the kit or Atelier's server couldn't serve.
  page.on('response', (r) => r.status() >= 400 && errors.push(`[${who}] ${r.status()} ${r.url()}`));
};

try {
  const tvCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } });
  const tv = await tvCtx.newPage();
  watch(tv, 'tv');
  await tv.goto(`${BASE}?speed=5&rounds=1${MINIGAME ? `&game=${MINIGAME}` : ''}`);
  // The lobby shows the address Atelier's web server gives phones (on the Wi-Fi, or this computer without one).
  await tv.waitForSelector('.lobby__url[data-url]', { timeout: 60000 });
  const joinUrl = await tv.getAttribute('.lobby__url', 'data-url');
  console.info(`phones join at ${joinUrl}`);
  const lobbyState = emulator.state();
  if (lobbyState.test?.screen !== 'lobby' || lobbyState.test?.sharing !== 'sharing') errors.push(`atelier.test.ready said ${JSON.stringify(lobbyState.test)} in the lobby`);
  if (!lobbyState.status?.startsWith('Lobby')) errors.push(`atelier.status said ${JSON.stringify(lobbyState.status)} in the lobby`);

  const phoneCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  watch(phone, 'phone');
  await phone.goto(joinUrl);
  await phone.fill('input[name=name]', 'Tester');
  await phone.click('button[type=submit]');
  // The lobby is the Atelier companion editor: dress up like a player would, then start as the host.
  await phone.waitForSelector('.customizer', { timeout: 30000 });
  await phone.waitForTimeout(2000); // the 3D preview builds
  await phone.screenshot({ path: path.join(OUT, '02-phone-lobby.png') });
  await phone.click('.co-ring__bubble[aria-label=Hat]');
  await phone.click('.co-ring-grid .co-ring-tile:nth-child(3)');
  await phone.waitForTimeout(1500); // the tiles' stills render
  await phone.screenshot({ path: path.join(OUT, '02b-phone-hats.png') });
  await phone.click('.co-ring__bubble[aria-label=Colours]');
  await phone.click('.co-ring-tile--palette:nth-child(5)');
  await phone.waitForTimeout(2500); // the TV rebuilds the companion in the lineup
  await phone.screenshot({ path: path.join(OUT, '03-phone-dressed.png') });
  await tv.screenshot({ path: path.join(OUT, '01-tv-lobby.png') });
  await phone.click('.co-footer .co-btn--primary'); // host starts

  // Play: answer whatever the TV asks for, and photograph the first time each screen appears.
  const seen = new Set();
  const deadline = Date.now() + Number(process.env.E2E_SECONDS ?? 240) * 1000;
  let finished = false;
  let pickedMode = false;
  let sawGame = false;
  while (Date.now() < deadline && !finished) {
    const kind = await phone.getAttribute('#app', 'data-kind');
    if (pickedMode && kind && !['menu', 'lobby', 'wait'].includes(kind)) sawGame = true;
    if (kind && !seen.has(kind)) {
      seen.add(kind);
      await phone.screenshot({ path: path.join(OUT, `phone-${kind}.png`) });
      await tv.screenshot({ path: path.join(OUT, `tv-during-${kind}.png`) });
      console.info(`phone shows: ${kind}`);
    }
    const tryClick = async (sel) => {
      const el = await phone.$(`${sel}:not([disabled])`);
      if (el) await el.click({ timeout: 1000 }).catch(() => {});
    };
    /** Drags a finger through points given as fractions of the element's box. */
    const drag = async (sel, points) => {
      const box = await (await phone.$(sel))?.boundingBox();
      if (!box || !points.length) return;
      const at = ([fx, fy]) => [box.x + box.width * fx, box.y + box.height * fy];
      await phone.mouse.move(...at(points[0]));
      await phone.mouse.down();
      for (const p of points.slice(1)) await phone.mouse.move(...at(p), { steps: 4 });
      await phone.mouse.up();
    };
    switch (kind) {
      case 'turn':
        await tryClick('.roll');
        break;
      case 'choice':
      case 'parcel':
        await tryClick('.option');
        break;
      case 'shop':
        await tryClick('.option');
        await tryClick('button.secondary');
        break;
      case 'intro':
        await tryClick('button.primary');
        break;
      case 'tap':
        await phone.waitForTimeout(300);
        await tryClick('.snap');
        break;
      case 'pump':
        for (let i = 0; i < 4; i++) await tryClick('.pump-btn');
        break;
      case 'secret': {
        const letters = await phone.$$('.letter:not([disabled])');
        if (letters.length) await letters[Math.floor(Math.random() * letters.length)].click().catch(() => {});
        break;
      }
      case 'menu': {
        // The mode menu: pick E2E_MODE (default the first, Snack Run). Seeing it again means the mode is over.
        const title = (await phone.textContent('#app h1').catch(() => '')) ?? '';
        // The mode menu: its title, or (if the title isn't readable mid-render) its "Back to the lobby" option.
        const labels = await phone.$eval('.option', (els) => els.map((e) => e.textContent ?? '')).catch(() => []);
        if (title.includes('What are we playing') || labels.some((l) => l.includes('Back to the lobby'))) {
          if (sawGame) {
            await tv.screenshot({ path: path.join(OUT, '99-tv-final.png') });
            finished = true;
            break;
          }
          // Keep tapping the mode until the game starts (the menu goes away then).
          const options = await phone.$$('.option:not([disabled])');
          await options[MODE]?.click().catch(() => {});
          pickedMode = true;
        } else if (sawGame) {
          // A mode's own menu (Free Play, Challenges, votes, "Back to the menu") after a game: take the last
          // option, which is the way back where there is one.
          const options = await phone.$$('.option:not([disabled])');
          if (options.length) await tv.screenshot({ path: path.join(OUT, '98-tv-before-back.png') });
          await options.at(-1)?.click().catch(() => {});
        } else {
          await tryClick('.option');
        }
        break;
      }
      case 'hold': {
        const btn = await phone.$('.hold-btn');
        if (btn) {
          const box = await btn.boundingBox();
          if (box) {
            await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await phone.mouse.down();
            await phone.waitForTimeout(250 + Math.random() * 400);
            await phone.mouse.up();
          }
        }
        break;
      }
      case 'buttons': {
        const buttons = await phone.$$('.big-button:not([disabled])');
        if (buttons.length) await buttons[Math.floor(Math.random() * buttons.length)].click().catch(() => {});
        break;
      }
      case 'rhythm': {
        const pads = await phone.$$('.beat-pad');
        if (pads.length) await pads[Math.floor(Math.random() * pads.length)].click().catch(() => {});
        else await tryClick('.beat-ring');
        break;
      }
      case 'swipe':
        await drag('.swipe-pad', [[0.5, 0.75], [0.5, 0.2]]);
        break;
      case 'aim': {
        // No motion sensor in the test browser: drag on the square, and press the button if there is one.
        const x = Math.random();
        const y = Math.random();
        await drag('.aim-pad', [[0.5, 0.5], [x, y]]);
        await tryClick('.aim-fire');
        break;
      }
      case 'spin':
        await drag('.spin-ring', Array.from({ length: 13 }, (_, i) => [0.5 + 0.4 * Math.cos(i * 0.52), 0.5 + 0.4 * Math.sin(i * 0.52)]));
        break;
      case 'slider':
        await drag('.fader', [[0.5, 0.9], [0.5, Math.random()]]);
        await tryClick('button.primary');
        break;
      case 'draw':
        await drag('.draw-pad', [[0.2, 0.2], [0.8, 0.3], [0.5, 0.8], [0.2, 0.2]]);
        await tryClick('button.primary');
        break;
      case 'number': {
        const keys = await phone.$$('.numpad__key:not(.numpad__ok)');
        for (let i = 0; i < 2 && keys.length; i++) await keys[Math.floor(Math.random() * 9)]?.click().catch(() => {});
        await tryClick('.numpad__ok');
        break;
      }
      case 'table': {
        // The phone's screen is the playfield: tap a few spots on it.
        const canvas = await phone.$('.table-canvas');
        const box = await canvas?.boundingBox();
        if (box) for (let i = 0; i < 3; i++) await phone.mouse.click(box.x + box.width * (0.1 + Math.random() * 0.8), box.y + box.height * (0.2 + Math.random() * 0.6));
        break;
      }
      case 'final':
        await tv.screenshot({ path: path.join(OUT, '99-tv-final.png') });
        finished = true;
        break;
      default:
        break;
    }
    await phone.waitForTimeout(150);
  }
  if (!finished) errors.push('The game did not reach the final screen in time.');
  // What the game told Atelier along the way (atelier.test.ready), as Atelier's playtests read it.
  const screens = emulator.state().screens;
  for (const screen of ['lobby', 'menu', 'game']) if (!screens.includes(screen)) errors.push(`atelier.test.ready never reported the ${screen} screen (${screens.join(' → ')})`);
  console.info(`screens reported to Atelier: ${screens.join(' → ')}`);
  console.info(`screens seen on the phone: ${[...seen].join(', ')}`);
} catch (err) {
  errors.push(`test step failed: ${err.message.split('\n')[0]}`);
  for (const page of browser.contexts().flatMap((c) => c.pages())) {
    await page.screenshot({ path: path.join(OUT, `failure-${page.viewportSize()?.width}.png`) }).catch(() => {});
  }
} finally {
  await browser.close();
  await emulator.close();
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.info(`\nSmoke test passed. Screenshots in ${path.relative(ROOT, OUT)}`);
