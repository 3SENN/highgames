// The phone controller. Atelier's web server for the game serves this page (the QR code on the big screen points at
// it): join with a name, then show whatever the TV asks for.
import { loadCompanionConfig } from '../companion/config';
import { type CompanionLook, SEAT_COLORS } from '../shared/look';
import { type Layout, MAX_NAME, TOKEN, type TvMsg } from '../shared/protocol';
import { type Ctx, identity, render } from './controllers';
import type { Customizer } from './customizer';
import { routeKitRequests } from './kit-paths';
import { startingLook } from './look-store';
import { PhoneNet } from './net';
import { Sensors } from './sensors';

// Companions are drawn by the Atelier kit, which this page loads from below the server's base.
if (window.atelierServer) routeKitRequests(window.atelierServer.base);

const app = document.getElementById('app') as HTMLElement;
const bar = document.getElementById('bar') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const flash = document.getElementById('flash') as HTMLElement;
const sensors = new Sensors();

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode: fine, we just won't remember.
    }
  },
};

function token(): string {
  let t = store.get('skypost-token');
  if (!t || !TOKEN.test(t)) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    t = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store.set('skypost-token', t);
  }
  return t;
}

// ------------------------------------------------------------------ screens

let cleanup: () => void = () => {};
const tvListeners = new Set<(m: TvMsg) => void>();
let currentLayout: Layout | null = null;

const ctx: Ctx = {
  send: (msg) => net.send(msg),
  sensors,
  onTv(fn) {
    tvListeners.add(fn);
    return () => tvListeners.delete(fn);
  },
  vibrate(pattern) {
    navigator.vibrate?.(pattern);
  },
};

// The lobby is the companion editor. It loads three.js and Atelier's runtime on demand (the join page stays light)
// and stays mounted while lobby updates arrive, so the open tab and the 3D preview never reset.
let customizer: Customizer | null = null;
let mounting: Promise<void> | null = null;
let pendingLobby: Extract<Layout, { kind: 'lobby' }> | null = null;

function show(layout: Layout): void {
  if (layout.kind === 'lobby') {
    currentLayout = layout;
    pendingLobby = layout;
    if (customizer) {
      customizer.update(layout);
      return;
    }
    if (!mounting) {
      cleanup();
      tvListeners.clear();
      cleanup = render(app, layout, ctx); // "Getting your companion ready…"
      mounting = mountCustomizer().finally(() => (mounting = null));
    }
    return;
  }
  // The TV resends the screen when anything changes; the same screen again is left alone, so a tap that is
  // already on its way isn't lost to a redraw (and nothing flickers).
  if (currentLayout && currentLayout.kind !== 'lobby' && JSON.stringify(currentLayout) === JSON.stringify(layout)) return;
  customizer?.destroy();
  customizer = null;
  pendingLobby = null;
  cleanup();
  tvListeners.clear();
  currentLayout = layout;
  cleanup = render(app, layout, ctx);
}

async function mountCustomizer(): Promise<void> {
  try {
    const [{ Customizer: Editor }, config, look] = await Promise.all([import('./customizer'), loadCompanionConfig(), startingLook()]);
    if (!pendingLobby || currentLayout?.kind !== 'lobby') return;
    customizer = new Editor(config, look, pendingLobby, {
      send: (msg) => net.send(msg),
      vibrate: (pattern) => navigator.vibrate?.(pattern),
      changed: (next) => void showPortrait(next),
    });
    cleanup();
    cleanup = () => {};
    app.replaceChildren(customizer.el);
    app.dataset.kind = 'lobby';
  } catch (err) {
    console.error(err);
    app.replaceChildren(Object.assign(document.createElement('p'), { className: 'error', textContent: 'Could not load the companion editor. Reload the page to try again.' }));
  }
}

/** Your companion's portrait in the header. */
async function showPortrait(look: CompanionLook): Promise<void> {
  try {
    const { companionThumb } = await import('../companion/thumb');
    const url = await companionThumb(look, 96, 'head');
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    (document.getElementById('me-portrait') as HTMLElement).replaceChildren(img);
  } catch {
    // The colour dot stays.
  }
}

/** Tells the TV which companion this phone plays as (on every join and rejoin). */
async function sendLook(): Promise<void> {
  const look = await startingLook();
  net.send({ t: 'look', look });
  void showPortrait(look);
}

function toast(text: string, good = true): void {
  flash.textContent = text;
  flash.className = good ? 'good' : 'bad';
  flash.hidden = false;
  // Restart the pop-in, so a second message in a row is noticed too.
  flash.style.animation = 'none';
  void flash.offsetWidth;
  flash.style.animation = '';
  clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => (flash.hidden = true), 1800);
}

const net = new PhoneNet({
  tv(msg) {
    switch (msg.t) {
      case 'layout':
        show(msg.layout);
        break;
      case 'you':
        identity(document.getElementById('me-name') as HTMLElement, msg);
        void sendLook().catch((err: unknown) => console.error('Could not send the companion', err));
        break;
      case 'ping':
        net.send({ t: 'pong', n: msg.n });
        break;
      case 'buzz':
        navigator.vibrate?.(msg.pattern);
        break;
      case 'feedback':
        toast(msg.text, msg.good);
        for (const fn of tvListeners) fn(msg);
        break;
      case 'meter':
      case 'pulse':
      case 'scene':
        for (const fn of tvListeners) fn(msg);
        break;
    }
  },
  status(status, detail) {
    statusEl.dataset.state = status;
    statusEl.textContent = status === 'online' ? '' : status === 'connecting' ? 'Connecting…' : status === 'offline' ? 'Reconnecting…' : 'Waiting for the screen…';
    if (detail && status === 'offline') joinForm(detail);
    else if (detail && status === 'waiting-tv') show({ kind: 'wait', title: 'Hang on', text: detail });
    else if (status === 'online' && !currentLayout) show({ kind: 'wait', title: 'Connected!', text: 'Look at the big screen.' });
  },
});

// ------------------------------------------------------------------ joining

function joinForm(error?: string): void {
  cleanup();
  bar.hidden = true;
  const form = document.createElement('form');
  form.className = 'join';
  form.autocomplete = 'off';
  form.innerHTML = `
    <div class="join__mark" aria-hidden="true">${SEAT_COLORS.map((c, i) => `<i style="--c:${c};--i:${i}"></i>`).join('')}</div>
    <h1>Highgames</h1>
    <p class="join__tag">Grab a seat. Your phone is the controller.</p>
    <label>Your name<input name="name" maxlength="${MAX_NAME}" required autocorrect="off" spellcheck="false" enterkeyhint="go"></label>
    <p class="error" role="alert" hidden></p>
    <button class="primary" type="submit">Join</button>
    <p class="muted">Joining turns on motion controls: some minigames are played by moving your phone.</p>`;
  const name = form.elements.namedItem('name') as HTMLInputElement;
  name.value = store.get('skypost-name') ?? '';
  const err = form.querySelector('.error') as HTMLElement;
  if (error) {
    err.textContent = error;
    err.hidden = false;
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const who = name.value.trim();
    if (!who) return;
    store.set('skypost-name', who);
    // This tap is where iOS lets us ask for motion and keep the screen awake.
    void sensors.enable();
    void keepAwake();
    bar.hidden = false;
    (document.getElementById('me-name') as HTMLElement).textContent = who;
    show({ kind: 'wait', title: 'Joining…' });
    net.start(who, token());
  });
  app.replaceChildren(form);
  app.dataset.kind = 'join';
  name.focus();
}

let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: string, f: () => void): void }> } };
    if (nav.wakeLock && !wakeLock) {
      const lock = await nav.wakeLock.request('screen');
      wakeLock = lock;
      lock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    // Not supported or refused: the game still works, the screen may just dim.
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !bar.hidden) void keepAwake();
});

joinForm();
