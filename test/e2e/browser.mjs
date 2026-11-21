// The browser the end-to-end tests drive: E2E_BROWSER, an installed Chrome or Edge, or the newest Chromium Playwright
// has downloaded on this computer (npx playwright install chromium).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

function playwrightChromium() {
  const expected = chromium.executablePath();
  if (fs.existsSync(expected)) return expected;
  const at = expected.indexOf('ms-playwright');
  if (at < 0) return null;
  const cache = expected.slice(0, at + 'ms-playwright'.length);
  const inside = path.relative(path.join(cache, expected.slice(cache.length + 1).split(/[\\/]/)[0]), expected);
  const builds = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)) : [];
  builds.sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  return builds.map((b) => path.join(cache, b, inside)).find((p) => fs.existsSync(p)) ?? null;
}

export function findBrowser() {
  const candidates = [
    process.env.E2E_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p)) ?? playwrightChromium();
  if (!found) throw new Error('No Chrome or Edge found. Set E2E_BROWSER to a browser executable, or run npx playwright install chromium.');
  return found;
}
