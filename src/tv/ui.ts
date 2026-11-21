// The TV's HTML layer over the 3D view: a late-night, cinematic game interface of our own. Dark translucent glass
// with a soft blur, warm lamp-coloured accents, compact pills in the corners, short centred titles and motion on
// everything that changes (titles slide in, numbers tick, scores pop).
// Player names are always set with textContent; companion pictures are image URLs from our own renderer.
import { type IslandId, islandEmblem, islandInfo } from '../shared/islands';
import { ITEMS, type ItemId } from '../shared/items';
import type { ControllerKind } from '../shared/protocol';
import type { Clock } from './anim';
import type { Sharing } from './net';

/** Who a row is about: name, seat colour and (once rendered) a portrait of their companion. */
export interface Who {
  name: string;
  color: string;
  thumb: string | null;
}

export interface HudPlayer extends Who {
  seat: number;
  /** A team: both members' heads show instead of one. */
  members?: Who[];
  coins: number;
  stamps: number;
  parcels: { to: IslandId; priority: boolean }[];
  items: ItemId[];
  cpu: boolean;
}

export interface LobbySeat extends Who {
  ready: boolean;
  host: boolean;
}

/** A key hint in the bottom bar: a round glyph and what it does. */
export interface Prompt {
  key: string;
  label: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Inline SVG from our own constants (icons, island emblems). */
function svg(markup: string, cls?: string): HTMLSpanElement {
  const s = el('span', cls);
  s.innerHTML = markup;
  return s;
}

/** A 24×24 line icon in the current text colour. */
const line = (body: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const dot = (x: number, y: number, r = 1.3) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const PHONE = '<rect x="7" y="2.5" width="10" height="19" rx="2.6"/><path d="M10.6 18.4h2.8"/>';

/** Our own icons. */
const ICON = {
  stamp:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#FFCB5C"/><circle cx="12" cy="12" r="10" fill="none" stroke="#C98A1B" stroke-width="1.2"/><circle cx="8.6" cy="10" r="1.45" fill="#4A2C12"/><circle cx="15.4" cy="10" r="1.45" fill="#4A2C12"/><path d="M7.7 14q4.3 4.2 8.6 0" fill="none" stroke="#4A2C12" stroke-width="1.9" stroke-linecap="round"/></svg>',
  coin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#E8B04A"/><circle cx="12" cy="12" r="10" fill="none" stroke="#A8721A" stroke-width="1.2"/><circle cx="12" cy="12" r="6.4" fill="#F4CC72" stroke="#B9822A" stroke-width="1.2"/><path d="M12 8.8v6.4" stroke="#96641A" stroke-width="2" stroke-linecap="round"/></svg>',
  check: line('<path d="M19.5 6.5 9.5 17l-5-5" stroke-width="3"/>'),
  phone: line(PHONE),
  clock: line('<circle cx="12" cy="13" r="8"/><path d="M12 8.6V13l2.8 1.8M9.5 2.6h5"/>'),
  crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5 7.6 12 12 5l4.4 7 4.1-3.5L19 18.5H5z" fill="currentColor"/><path d="M5.4 20.6h13.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  plus: line('<path d="M12 5.5v13M5.5 12h13"/>'),
  back: line('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  qr: line('<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><path d="M14 14h2.6v2.6M20.5 14v6.5H17M14 20.5v-1"/>'),
};

/** One picture per kind of controller, for the intro card. */
const CONTROLLER_ICONS: Record<ControllerKind, string> = {
  tap: line(`${PHONE}<circle cx="12" cy="11" r="2.4"/>`),
  pump: line('<rect x="4" y="3.5" width="9" height="17" rx="2.4"/><path d="M18 4.5v15M15.6 7 18 4.5 20.4 7M15.6 17l2.4 2.5 2.4-2.5"/>'),
  tilt: line('<rect x="7.4" y="3.5" width="9.2" height="17" rx="2.4" transform="rotate(-24 12 12)"/><path d="M2.8 15.5q1 3.6 4.2 5.4M21.2 8.5q-1-3.6-4.2-5.4"/>'),
  secret: line('<path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z"/><circle cx="12" cy="12" r="2.6"/><path d="M4.5 4.5l15 15"/>'),
  still: line(`${PHONE}<path d="M2.6 9.5v5M21.4 9.5v5"/>`),
  hold: line(`<circle cx="12" cy="12" r="8.6"/>${dot(12, 12, 3.6)}`),
  stick: line('<circle cx="12" cy="6.8" r="3.3"/><path d="M12 10.1V16"/><rect x="5" y="16" width="14" height="4.6" rx="2.2"/>'),
  buttons: line('<circle cx="7.8" cy="7.8" r="3"/><circle cx="16.2" cy="7.8" r="3"/><circle cx="7.8" cy="16.2" r="3"/><circle cx="16.2" cy="16.2" r="3"/>'),
  rhythm: line('<path d="M9 17.6V6.2l10-2.2v11.4"/><circle cx="6.5" cy="17.6" r="2.5"/><circle cx="16.5" cy="15.4" r="2.5"/>'),
  swipe: line('<path d="M4 17c3.6-7.6 9.4-9.6 16-8.6"/><path d="M15.8 4.6 20 8.4l-3.4 4.2"/>'),
  aim: line(`<circle cx="12" cy="12" r="6.8"/><path d="M12 2.6v4M12 17.4v4M2.6 12h4M17.4 12h4"/>${dot(12, 12, 1.4)}`),
  spin: line('<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20.2 3.6v4.6h-4.6"/>'),
  slider: line('<path d="M12 3v18"/><rect x="7.2" y="8" width="9.6" height="5.2" rx="1.8" fill="currentColor"/>'),
  draw: line('<path d="M4 20l1.1-4.6L16.6 3.9l3.5 3.5L8.6 18.9z"/><path d="M14.2 6.3l3.5 3.5"/>'),
  number: line([7, 12, 17].flatMap((y) => [7, 12, 17].map((x) => dot(x, y, 1.5))).join('')),
  table: line(`<rect x="2.8" y="6.5" width="18.4" height="11" rx="2.6"/><circle cx="12" cy="12" r="3.4"/>${dot(12, 12, 1.2)}`),
};

/** The menus' pictures. The modes name theirs with an emoji; we draw our own icon for each (unknown ones show as text). */
const MENU_ICONS: Record<string, string> = {
  '🍕': line(`<path d="M12 21 4 6.6c5-2.7 11-2.7 16 0z"/>${dot(9.8, 9.6)}${dot(14.2, 10.6)}${dot(12, 14.8)}`),
  '🛋': line('<path d="M5.5 11V8.2a2.6 2.6 0 0 1 2.6-2.6h7.8a2.6 2.6 0 0 1 2.6 2.6V11"/><path d="M3 13.2a2 2 0 0 1 4 0V15h10v-1.8a2 2 0 0 1 4 0v4.6H3z"/><path d="M6 17.8v2.4M18 17.8v2.4"/>'),
  '🌙': line('<path d="M20 14.6A8.6 8.6 0 1 1 9.4 4 7 7 0 0 0 20 14.6z"/>'),
  '🎧': line('<path d="M4.2 14v-2a7.8 7.8 0 0 1 15.6 0v2"/><rect x="3" y="13.5" width="4.6" height="7" rx="2.1"/><rect x="16.4" y="13.5" width="4.6" height="7" rx="2.1"/>'),
  '🏆': line('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.6H4.6a3.5 3.5 0 0 0 3.7 4M16 5.6h3.4a3.5 3.5 0 0 1-3.7 4"/><path d="M12 13v4M8.4 20.4h7.2M9.6 17h4.8v3.4H9.6z"/>'),
  '🟪': line(`<path d="M6 5c4 1 8 1 12 0 1 4.4 1 9.6 0 14-4-1-8-1-12 0-1-4.4-1-9.6 0-14z"/>${dot(12, 12, 1.2)}<path d="M8.6 8.6l1.6 1.6M15.4 8.6l-1.6 1.6M8.6 15.4l1.6-1.6M15.4 15.4l-1.6-1.6"/>`),
  '🦉': line(`<path d="M5 9.6a7 7 0 0 1 14 0v4.6a7 7 0 0 1-14 0z"/><circle cx="9.1" cy="10.4" r="2.3"/><circle cx="14.9" cy="10.4" r="2.3"/><path d="M12 13v1.8M5.6 6.4 5 3.2l3.2 1.4M18.4 6.4 19 3.2l-3.2 1.4"/>`),
  '🎲': line(`<rect x="4" y="4" width="16" height="16" rx="3.6"/>${dot(8.6, 8.6)}${dot(15.4, 15.4)}${dot(12, 12)}${dot(15.4, 8.6)}${dot(8.6, 15.4)}`),
  '📱': line(PHONE),
  '🌀': line('<path d="M12 12.4a1.7 1.7 0 1 0-1.7-1.7c0 2.7 2.1 4.5 4.7 4.5a5.7 5.7 0 0 0 0-11.4C9.9 3.8 5.5 7.7 5.5 13c0 4.1 3.2 7.3 7.5 7.3"/>'),
  '🍿': line('<path d="M6.6 10h10.8l-1.5 11H8.1z"/><path d="M10.1 10l.6 11M13.9 10l-.6 11"/><path d="M7 10a2.6 2.6 0 0 1 2-4.2 3 3 0 0 1 6 0A2.6 2.6 0 0 1 17 10"/>'),
  '🦸': line('<circle cx="7.2" cy="12" r="3.8"/><circle cx="17.4" cy="5.6" r="2.1"/><circle cx="17.4" cy="12" r="2.1"/><circle cx="17.4" cy="18.4" r="2.1"/>'),
  '🤝': line('<circle cx="9" cy="8.6" r="3.2"/><circle cx="16.6" cy="9.8" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M15.6 15a5 5 0 0 1 5.4 5"/>'),
  '↩': ICON.back,
};

/** Quiet fabric colours for the menu tiles, one after another. */
const TILE_HUES = ['#E0926E', '#E2B65C', '#C792B4', '#62B8AC', '#7FA0DC', '#8FC47E', '#E38D9F', '#A990DC'];

/** Callers pass a dark neutral for "nobody in particular": on dark glass that becomes the warm accent. */
function tone(color: string | undefined): string {
  return !color || /^#(2d2d2d|000000|000|111|222|333)$/i.test(color) ? 'var(--accent)' : color;
}

/** A player's picture: just their companion's head, no frame and no background (sizes in em: they scale with the screen). */
function avatar(who: Who, size: number): HTMLSpanElement {
  const a = el('span', 'avatar');
  a.style.setProperty('--c', who.color);
  a.style.width = a.style.height = `${size}em`;
  if (who.thumb) {
    const img = el('img');
    img.src = who.thumb;
    img.alt = '';
    a.append(img);
  }
  return a;
}

/** Several heads side by side, slightly overlapping (a team). */
function heads(members: Who[], size: number): HTMLSpanElement {
  const g = el('span', 'heads');
  for (const m of members) g.append(avatar(m, size));
  return g;
}

export interface MenuItem {
  title: string;
  sub?: string;
  tag?: string;
  icon?: string;
}

function stat(icon: 'stamp' | 'coin', value: number, label: string): HTMLSpanElement {
  const s = el('span', `stat stat--${icon}`);
  s.setAttribute('aria-label', `${value} ${label}`);
  s.append(svg(ICON[icon], 'stat__icon'), el('b', '', String(value)));
  return s;
}

/** A quick scale pop on something whose number just changed. */
function pop(node: Element, scale = 1.35): void {
  if (typeof node.animate !== 'function') return;
  node.animate([{ transform: `scale(${scale})` }, { transform: 'scale(0.96)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
}

/** Heading of a card or page: a small kicker over a title. */
function heading(kicker: string, title: string, sub?: string): HTMLElement {
  const head = el('header', 'head');
  head.append(el('p', 'kicker', kicker), el('h1', '', title));
  if (sub) head.append(el('p', 'head__sub', sub));
  return head;
}

const CONTROLLER_HINTS: Record<ControllerKind, string> = {
  tap: 'Watch the big screen, then tap your phone',
  pump: 'Pump your phone up and down, and watch its gauge',
  tilt: 'Hold your phone flat and tilt it to steer',
  secret: 'Look at your phone, and keep it secret',
  still: 'Hold your phone as still as you can',
  hold: 'Press and hold the big button on your phone',
  stick: 'Your phone is a joystick: drag to move',
  buttons: 'Tap the big buttons on your phone',
  rhythm: 'Move your phone with the beat',
  swipe: 'Flick your finger across your phone',
  aim: 'Point your phone at the big screen like a remote',
  spin: 'Move your phone round in circles',
  slider: 'Slide the big fader on your phone',
  draw: 'Draw with your finger on your phone',
  number: 'Type a number on your phone',
  table: 'Your phone screen is the playfield: touch it',
};

interface LiveRow {
  row: HTMLElement;
  pic: HTMLSpanElement;
  name: HTMLElement;
  value: HTMLElement;
  thumb: string | null;
  changed: number;
}

export class Ui {
  private root = $('ui');
  private hud = $('hud');
  private roundEl = $('round');
  private timerEl = $('timer');
  private timerNum = el('b');
  private liveEl = $('live');
  private diceEl = $('dice');
  private bannerEl = $('banner');
  private toasts = $('toasts');
  private captionEl = $('caption');
  private promptsEl = $('prompts');
  private clockEl = $('tb-clock');
  private panelEl = $('panel');
  readonly overlay = $('overlay');
  private startHandlers = new Set<(demo: boolean) => void>();
  private basePrompts: Prompt[] = [];
  private soundPrompt = true;
  private captionKey = '';
  private timerShown: number | null = null;
  private liveRows: LiveRow[] = [];
  private hudLast = new Map<number, { coins: number; stamps: number }>();
  /** What the panel shows now: re-renders of the same thing don't replay its entrance. */
  private panelKey = '';
  private seenReady = new Set<number>();
  private menuPick: (index: number) => void = () => {};
  private menuTiles: HTMLElement[] = [];
  private meterParts: { label: HTMLElement; pct: HTMLElement; fill: HTMLElement; sub: HTMLElement } | null = null;
  private bannerRun = 0;

  constructor(private readonly clock: Clock) {
    this.timerEl.replaceChildren(svg(ICON.clock, 'timer__icon'), this.timerNum);
    const tick = () => (this.clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    setInterval(tick, 15_000);
  }

  // ------------------------------------------------------------ bars

  /** Which part of the game is on screen: the player tiles show on the board only. */
  mode(m: 'lobby' | 'board' | 'minigame'): void {
    this.root.classList.remove('mode-lobby', 'mode-board', 'mode-minigame');
    this.root.classList.add(`mode-${m}`);
  }

  /** The key hints on the right of the bottom bar. */
  prompts(list: Prompt[]): void {
    this.basePrompts = list;
    this.renderPrompts();
  }

  /** Called once sound is on: the "click for sound" hint goes away. */
  soundOn(): void {
    this.soundPrompt = false;
    this.renderPrompts();
  }

  private renderPrompts(): void {
    const list = this.soundPrompt ? [{ key: 'Click', label: 'Sound on' }, ...this.basePrompts] : this.basePrompts;
    this.promptsEl.replaceChildren(
      ...list.map((p) => {
        const item = el('span', 'prompt');
        item.append(el('kbd', `prompt__key${p.key.length > 1 ? ' prompt__key--wide' : ''}`, p.key), el('span', '', p.label));
        return item;
      }),
    );
  }

  /** What to do right now, in a pill at the bottom: the dot is the colour of whoever it is about. */
  caption(text: string | null, color?: string): void {
    const key = text === null ? '' : `${color ?? ''}|${text}`;
    if (key === this.captionKey) return;
    this.captionKey = key;
    this.captionEl.replaceChildren();
    if (text === null) return;
    const pill = el('span', 'caption');
    pill.style.setProperty('--c', tone(color));
    pill.append(el('i', 'caption__dot'), svg(ICON.phone, 'caption__phone'), el('span', 'caption__text', text));
    this.captionEl.append(pill);
  }

  round(current: number | null, total = 0): void {
    this.roundEl.hidden = current === null;
    if (current === null) return;
    if (current === total) this.roundEl.replaceChildren(el('b', '', 'Final round'));
    else this.roundEl.replaceChildren(el('span', '', 'Round'), el('b', '', String(current)), el('span', '', `of ${total}`));
  }

  timer(seconds: number | null): void {
    this.timerEl.hidden = seconds === null;
    if (seconds === null) {
      this.timerShown = null;
      return;
    }
    const n = Math.max(0, Math.ceil(seconds));
    if (n === this.timerShown) return;
    this.timerShown = n;
    this.timerNum.textContent = String(n);
    const low = seconds <= 5;
    this.timerEl.classList.toggle('low', low);
    if (low) pop(this.timerEl, 1.18);
  }

  // ------------------------------------------------------------ player tiles

  renderHud(players: HudPlayer[], active: number | null): void {
    const last = this.hudLast;
    this.hud.replaceChildren(
      ...players.map((p) => {
        const tile = el('section', `ptile${p.seat === active ? ' ptile--active' : ''}`);
        tile.style.setProperty('--c', p.color);
        tile.setAttribute('aria-label', `${p.name}: ${p.stamps} smiles, ${p.coins} coins`);
        const info = el('div', 'ptile__info');
        const name = el('div', 'ptile__name');
        name.append(el('span', 'ptile__label', p.name));
        if (p.cpu) name.append(el('span', 'tag', 'CPU'));
        const stats = el('div', 'ptile__stats');
        const smiles = stat('stamp', p.stamps, 'smiles');
        const coins = stat('coin', p.coins, 'coins');
        stats.append(smiles, coins);
        const before = last.get(p.seat);
        if (before && before.stamps !== p.stamps) pop(smiles);
        if (before && before.coins !== p.coins) pop(coins);
        last.set(p.seat, { coins: p.coins, stamps: p.stamps });
        info.append(name, stats);
        const pic = el('div', 'ptile__pic');
        pic.append(p.members ? heads(p.members, 3) : avatar(p, 3.9));
        tile.append(pic, info);
        if (p.parcels.length || p.items.length) {
          const bag = el('div', 'ptile__bag');
          for (const parcel of p.parcels) {
            const chip = svg(islandEmblem(parcel.to, 18), `parcel${parcel.priority ? ' parcel--priority' : ''}`);
            chip.title = `Order for ${islandInfo(parcel.to).name}${parcel.priority ? ' (rush)' : ''}`;
            bag.append(chip);
          }
          for (const item of p.items) bag.append(el('span', 'item', ITEMS[item].name));
          tile.append(bag);
        }
        return tile;
      }),
    );
  }

  hideHud(): void {
    this.hud.replaceChildren();
    this.hudLast.clear();
  }

  // ------------------------------------------------------------ transient messages

  /** A title across the middle of the screen: it slides in, holds, and leaves. */
  async banner(title: string, sub = '', seconds = 1.8): Promise<void> {
    const run = ++this.bannerRun;
    const card = el('div', 'title');
    const text = el('div', 'title__text');
    text.append(el('h1', '', title), el('i', 'title__rule'), ...(sub ? [el('p', '', sub)] : []));
    card.append(text);
    this.bannerEl.replaceChildren(card);
    this.bannerEl.hidden = false;
    this.bannerEl.classList.remove('out');
    await this.clock.wait(seconds);
    if (run !== this.bannerRun) return;
    this.bannerEl.classList.add('out');
    await this.clock.wait(0.25);
    if (run !== this.bannerRun) return;
    this.bannerEl.hidden = true;
    this.bannerEl.classList.remove('out');
  }

  /** A notification pill under the status bar. */
  toast(text: string, color = '#2d2d2d', seconds = 3.2): void {
    const t = el('div', 'toast');
    t.style.setProperty('--c', tone(color));
    t.append(el('i', 'toast__dot'), el('span', '', text));
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    void this.clock.wait(seconds).then(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    });
  }

  /** The roll as numbers (the dice themselves tumble in the 3D scene). */
  async dice(values: number[], bonus: number): Promise<void> {
    const faces = values.map(() => el('div', 'die', '?'));
    const total = el('div', 'dice__total');
    this.diceEl.replaceChildren(...faces, ...(bonus ? [el('div', 'dice__bonus', `+${bonus}`)] : []), total);
    this.diceEl.hidden = false;
    this.diceEl.classList.add('rolling');
    await this.clock.tween(0.9, (k) => {
      if (k < 1) faces.forEach((f) => (f.textContent = String(1 + Math.floor(Math.random() * 6))));
    });
    this.diceEl.classList.remove('rolling');
    faces.forEach((f, i) => {
      f.textContent = String(values[i]);
      pop(f, 1.3);
    });
    if (values.length > 1 || bonus) {
      total.textContent = `= ${values.reduce((a, b) => a + b, 0) + bonus}`;
      pop(total, 1.3);
    }
    await this.clock.wait(0.7);
  }

  steps(left: number | null): void {
    if (left === null) {
      this.diceEl.hidden = true;
      return;
    }
    this.diceEl.hidden = false;
    const n = el('div', 'die die--steps', String(left));
    n.setAttribute('aria-label', `${left} spaces to go`);
    this.diceEl.replaceChildren(n, el('div', 'dice__label', left === 1 ? 'space to go' : 'spaces to go'));
    pop(n, 1.25);
  }

  /** The score list on the left during a minigame. Rows are kept and updated, so a changed score can pop. */
  live(entries: (Who & { value: string })[] | null): void {
    this.liveEl.hidden = entries === null;
    if (!entries) {
      if (this.liveRows.length) {
        this.liveRows = [];
        this.liveEl.replaceChildren();
      }
      return;
    }
    if (this.liveRows.length !== entries.length) {
      this.liveRows = entries.map((_, i) => {
        const row = el('div', 'live__row');
        row.style.setProperty('--i', String(i));
        const pic = el('span', 'live__pic');
        const name = el('span', 'live__name');
        const value = el('span', 'live__value');
        row.append(pic, name, value);
        return { row, pic, name, value, thumb: '', changed: 0 };
      });
      this.liveEl.replaceChildren(...this.liveRows.map((r) => r.row));
    }
    // Long values ("Cracked at 12.4 s") get a line of their own under the name.
    this.liveEl.classList.toggle('live--stack', entries.some((e) => e.value.length > 9));
    const now = performance.now();
    entries.forEach((e, i) => {
      const r = this.liveRows[i] as LiveRow;
      if (r.row.style.getPropertyValue('--c') !== e.color) r.row.style.setProperty('--c', e.color);
      if (r.name.textContent !== e.name) r.name.textContent = e.name;
      if (r.thumb !== e.thumb) {
        r.thumb = e.thumb;
        r.pic.replaceChildren(avatar(e, 2.3));
      }
      if (r.value.textContent !== e.value) {
        const first = r.value.textContent === '';
        r.value.textContent = e.value;
        // Scores that step now and then pop; values that run every frame (times, distances) just update.
        if (!first && now - r.changed > 500) pop(r.value);
        r.changed = now;
      }
    });
  }

  async countdown(): Promise<void> {
    this.bannerRun++;
    for (const n of ['3', '2', '1', 'Go!']) {
      const go = n === 'Go!';
      const count = el('div', `count${go ? ' count--go' : ''}`);
      count.append(el('i', 'count__ring'), el('b', '', n));
      this.bannerEl.replaceChildren(count);
      this.bannerEl.hidden = false;
      this.bannerEl.classList.remove('out');
      await this.clock.wait(go ? 0.5 : 0.7);
    }
    this.bannerEl.hidden = true;
  }

  // ------------------------------------------------------------ panels

  hidePanel(): void {
    this.panelEl.hidden = true;
    this.panelEl.className = '';
    this.panelEl.replaceChildren();
    this.panelKey = '';
    this.menuTiles = [];
  }

  /** Shows a page or card. `key` names what it is: showing the same thing again updates it without the entrance. */
  private showPanel(content: HTMLElement, mode: 'sheet' | 'side' | 'dialog', key: string): boolean {
    const fresh = this.panelEl.hidden || this.panelKey !== key;
    this.panelKey = key;
    if (fresh) content.classList.add('enter');
    this.panelEl.className = `panel--${mode}${fresh ? ' enter' : ''}`;
    this.panelEl.replaceChildren(content);
    this.panelEl.hidden = false;
    return fresh;
  }

  onStart(fn: (demo: boolean) => void): () => void {
    this.startHandlers.add(fn);
    return () => this.startHandlers.delete(fn);
  }

  /** A seat's card: the head, the name, a line of status and a tick once ready. */
  private seatCard(s: Who, sub: string, ready: boolean, size: number, popTick: boolean): HTMLElement {
    const tile = el('div', `seat${ready ? ' seat--ready' : ''}`);
    tile.style.setProperty('--c', s.color);
    const pic = el('div', 'seat__pic');
    pic.append(avatar(s, size));
    if (ready) pic.append(svg(ICON.check, `seat__ready${popTick ? ' seat__ready--pop' : ''}`));
    tile.append(pic, el('div', 'seat__name', s.name), el('div', 'seat__sub', sub));
    return tile;
  }

  /** The lobby sits on the left; the companions stand in the 3D scene to its right. */
  showLobby(opts: { sharing: Sharing; seats: LobbySeat[]; rounds: number; cast: readonly string[] }): void {
    const fresh = this.panelEl.hidden || this.panelKey !== 'lobby';
    if (fresh) this.seenReady.clear();
    const panel = el('div', 'lobby');
    panel.append(heading('Tonight on the big screen', 'Join the game', `${opts.rounds} round${opts.rounds === 1 ? '' : 's'} · up to 4 players · phones are the controllers`));
    panel.append(joinCard(opts.sharing));

    const label = el('h2', 'label');
    label.append(el('span', '', 'Players'), el('span', 'label__count', `${opts.seats.length} of 4`));
    panel.append(label);
    const grid = el('div', 'lobby__seats');
    for (let i = 0; i < 4; i++) {
      const s = opts.seats[i];
      if (s) {
        const isNew = !this.seenReady.has(i);
        this.seenReady.add(i);
        const tile = this.seatCard(s, s.host ? 'Host' : s.ready ? 'Ready' : 'Dressing up…', s.ready, 4.6, false);
        if (s.host) tile.classList.add('seat--host');
        if (isNew && !fresh) tile.classList.add('seat--join');
        grid.append(tile);
      } else {
        this.seenReady.delete(i);
        const tile = el('div', 'seat seat--open');
        tile.append(svg(ICON.plus, 'seat__plus'), el('div', 'seat__sub', 'Open seat'));
        grid.append(tile);
      }
    }
    panel.append(grid);

    const actions = el('div', 'lobby__actions');
    const start = el('button', 'btn btn--primary', opts.seats.length ? 'Start game' : 'Start with CPUs');
    start.type = 'button';
    start.addEventListener('click', () => this.startHandlers.forEach((fn) => fn(false)));
    const demo = el('button', 'btn', 'Watch a CPU game');
    demo.type = 'button';
    demo.addEventListener('click', () => this.startHandlers.forEach((fn) => fn(true)));
    actions.append(start, demo);
    const who = opts.cast.length ? `${listNames(opts.cast)}, then Atelier’s preset companions` : 'Atelier’s preset companions';
    panel.append(actions, el('p', 'muted small', `Open seats are played by ${who}. The host phone can start the game too.`));
    this.showPanel(panel, 'side', 'lobby');
  }

  /** `sides` (team games): each side's label and its members as positions in `seats`; they're shown grouped. */
  showIntro(game: { title: string; how: string; controller: ControllerKind }, seats: (Who & { ready: boolean })[], sides?: { label: string; members: number[] }[]): void {
    const key = `intro:${game.title}`;
    const fresh = this.panelEl.hidden || this.panelKey !== key;
    if (fresh) this.seenReady.clear();
    const sheet = el('div', 'intro');
    const about = el('div', 'intro__about');
    about.append(heading('Minigame', game.title), el('p', 'intro__how', game.how));
    const ctl = el('div', 'intro__controls');
    const hint = el('div', 'intro__hint');
    hint.append(el('span', 'intro__hint-label', 'Controls'), el('span', '', CONTROLLER_HINTS[game.controller]));
    ctl.append(svg(CONTROLLER_ICONS[game.controller], 'intro__icon'), hint);
    about.append(ctl);

    const seatTile = (s: Who & { ready: boolean }, i: number) => {
      const justReady = s.ready && !this.seenReady.has(i);
      if (s.ready) this.seenReady.add(i);
      else this.seenReady.delete(i);
      return this.seatCard(s, s.ready ? 'Ready' : 'Getting ready…', s.ready, 4, justReady && !fresh);
    };
    const side = el('div', 'intro__side-col');
    let players: HTMLElement;
    if (sides && sides.length > 1) {
      players = el('div', 'intro__players intro__players--sides');
      players.style.setProperty('--n', String(Math.max(...sides.map((sd) => sd.members.length))));
      sides.forEach((sd, k) => {
        if (k > 0) players.append(el('div', 'intro__vs', 'vs'));
        const tiles = el('div', 'intro__side-tiles');
        for (const m of sd.members) {
          const s = seats[m];
          if (s) tiles.append(seatTile(s, m));
        }
        const group = el('div', 'intro__side');
        group.append(el('div', 'intro__side-label', sd.label), tiles);
        players.append(group);
      });
    } else {
      players = el('div', 'intro__players');
      seats.forEach((s, i) => players.append(seatTile(s, i)));
    }
    const count = seats.filter((s) => s.ready).length;
    const status = el('div', 'intro__status');
    const pips = el('span', 'intro__pips');
    seats.forEach((s) => {
      const pip = el('i', s.ready ? 'on' : '');
      pip.style.setProperty('--c', s.color);
      pips.append(pip);
    });
    status.append(pips, el('span', '', count === seats.length ? 'Everyone is ready' : `${count} of ${seats.length} ready · press Ready on your phone`));
    side.append(players, status);
    sheet.append(about, side);
    this.showPanel(sheet, 'sheet', key);
  }

  showResults(title: string, rows: (Who & { place: number; detail: string; coins: number })[]): void {
    const sheet = el('div', 'results card');
    const list = el('ol', 'list');
    [...rows]
      .sort((a, b) => a.place - b.place)
      .forEach((r, i) => {
        const li = el('li', `list__row list__row--${Math.min(r.place, 4)}`);
        li.style.setProperty('--c', r.color);
        li.style.setProperty('--i', String(i));
        li.append(el('span', 'list__place', ordinal(r.place)), avatar(r, 3), el('span', 'list__name', r.name), el('span', 'list__detail', r.detail));
        const coins = el('span', 'list__coins');
        if (r.coins > 0) coins.append(el('b', '', `+${r.coins}`), svg(ICON.coin, 'stat__icon'));
        else coins.append(el('span', 'list__none', '—'));
        li.append(coins);
        list.append(li);
      });
    sheet.append(heading('Results', title), list);
    this.showPanel(sheet, 'dialog', `results:${title}`);
  }

  showBonus(title: string, text: string, winners: Who[]): void {
    const card = el('div', 'bonus card');
    const row = el('div', 'bonus__winners');
    for (const w of winners) {
      const tile = el('div', 'seat seat--win');
      tile.style.setProperty('--c', w.color);
      const pic = el('div', 'seat__pic');
      pic.append(avatar(w, 5));
      const plus = el('div', 'seat__sub seat__sub--smile');
      plus.append(el('b', '', '+1'), svg(ICON.stamp, 'stat__icon'));
      tile.append(pic, el('div', 'seat__name', w.name), plus);
      row.append(tile);
    }
    card.append(heading('Bonus smile', title, text), row);
    this.showPanel(card, 'dialog', `bonus:${title}`);
  }

  /** A menu of big tiles (modes, minigames). The selected tile is lit and lifted. */
  showMenu(opts: { kicker: string; title: string; items: MenuItem[]; selected: number; note?: string; onPick: (index: number) => void }): void {
    this.menuPick = opts.onPick;
    const key = `menu:${opts.kicker}|${opts.title}|${opts.items.map((it) => it.title).join('|')}`;
    if (!this.panelEl.hidden && this.panelKey === key && this.menuTiles.length === opts.items.length) {
      // The same menu with another tile selected: move the light, keep everything else (and the scroll position).
      this.menuTiles.forEach((tile, i) => tile.classList.toggle('focus', i === opts.selected));
      this.menuTiles[opts.selected]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    const pictured = opts.items.some((it) => it.icon);
    const sheet = el('div', `menu${pictured ? '' : ' menu--list'}`);
    const grid = el('div', 'menu__grid');
    // The host's arrow keys assume this many columns (see Host.menu).
    grid.style.setProperty('--cols', String(Math.max(1, Math.floor((window.innerWidth * 0.92) / 260))));
    this.menuTiles = opts.items.map((item, i) => {
      const tile = el('button', `menu__tile${i === opts.selected ? ' focus' : ''}`);
      tile.type = 'button';
      tile.style.setProperty('--i', String(Math.min(i, 14)));
      const key2 = item.icon?.replace(/️/g, '') ?? '';
      const back = key2 === '↩';
      tile.style.setProperty('--h', back ? '#B9AFC4' : (TILE_HUES[i % TILE_HUES.length] as string));
      if (back) tile.classList.add('menu__tile--back');
      if (item.icon) {
        const drawn = MENU_ICONS[key2];
        tile.append(drawn ? svg(drawn, 'menu__icon') : el('span', 'menu__icon menu__icon--text', item.icon));
      }
      tile.append(el('span', 'menu__title', item.title));
      if (item.sub) tile.append(el('span', 'menu__sub', item.sub));
      if (item.tag) tile.append(el('span', 'menu__tag', item.tag));
      tile.addEventListener('click', () => this.menuPick(i));
      return tile;
    });
    grid.append(...this.menuTiles);
    sheet.append(heading(opts.kicker, opts.title), grid);
    if (opts.note) sheet.append(el('p', 'menu__note', opts.note));
    this.showPanel(sheet, 'sheet', key);
    this.menuTiles[opts.selected]?.scrollIntoView({ block: 'nearest' });
  }

  /** A podium: each player on a block as high as their place, the winner crowned in the middle. */
  private podium(rows: (Who & { place: number; members?: Who[] })[], under: (row: number) => HTMLElement): HTMLElement {
    const podium = el('div', 'podium');
    rows.forEach((r, i) => {
      const place = Math.min(Math.max(1, r.place), 4);
      const col = el('div', `podium__col podium__col--${place}`);
      col.style.setProperty('--c', r.color);
      const who = el('div', 'podium__who');
      if (place === 1) who.append(svg(ICON.crown, 'podium__crown'));
      who.append(r.members ? heads(r.members, place === 1 ? 5.4 : 4.2) : avatar(r, place === 1 ? 7.6 : 5.8), el('div', 'podium__name', r.name), under(i));
      const block = el('div', 'podium__block');
      const num = el('div', 'podium__place');
      const ord = ordinal(r.place);
      num.append(el('b', '', ord.slice(0, -2)), el('span', '', ord.slice(-2)));
      block.append(num);
      col.append(who, block);
      podium.append(col);
    });
    return podium;
  }

  private finalPage(kicker: string, title: string, podium: HTMLElement, again: string, hint: string, onAgain: () => void): void {
    const sheet = el('div', 'final');
    const confetti = el('div', 'confetti');
    const colors = ['#F5A524', '#3B82F6', '#E2437A', '#22B573', '#FFE3BD', '#FFB877'];
    for (let i = 0; i < 36; i++) {
      const bit = el('i');
      bit.style.left = `${(i * 37 + 11) % 100}%`;
      bit.style.background = colors[i % colors.length] as string;
      bit.style.animationDelay = `${-((i * 0.37) % 5).toFixed(2)}s`;
      bit.style.animationDuration = `${(4.2 + ((i * 0.61) % 2.6)).toFixed(2)}s`;
      bit.style.setProperty('--r', `${(i * 47) % 360}deg`);
      confetti.append(bit);
    }
    const button = el('button', 'btn btn--primary', again);
    button.type = 'button';
    button.addEventListener('click', onAgain);
    const actions = el('div', 'final__actions');
    actions.append(button, el('p', 'muted small', hint));
    sheet.append(confetti, heading(kicker, title), podium, actions);
    this.showPanel(sheet, 'sheet', `final:${kicker}|${title}`);
  }

  /** The end of a mode: a podium with one result line each. */
  showRanking(opts: { kicker: string; title: string; rows: (Who & { place: number; value: string; members?: Who[] })[]; again: string; onAgain: () => void }): void {
    const podium = this.podium(opts.rows, (i) => el('div', 'podium__value', opts.rows[i]?.value ?? ''));
    this.finalPage(opts.kicker, opts.title, podium, opts.again, 'or press the button on the host phone', opts.onAgain);
  }

  /** A labelled meter under the status bar (the co-op vibe). Null hides it. */
  meter(m: { label: string; value: number; sub: string } | null): void {
    let box = document.getElementById('meter');
    if (!m) {
      box?.remove();
      this.meterParts = null;
      return;
    }
    if (!box || !this.meterParts) {
      box?.remove();
      box = el('div');
      box.id = 'meter';
      const head = el('div', 'meter__head');
      const label = el('span', 'meter__label');
      const pct = el('b', 'meter__pct');
      head.append(label, pct);
      const bar = el('div', 'meter__bar');
      const fill = el('div', 'meter__fill');
      bar.append(fill);
      const sub = el('div', 'meter__sub');
      box.append(head, bar, sub);
      this.root.append(box);
      this.meterParts = { label, pct, fill, sub };
    }
    const parts = this.meterParts;
    const v = Math.max(0, Math.min(1, m.value));
    const pct = `${Math.round(v * 100)}%`;
    parts.label.textContent = m.label;
    if (parts.pct.textContent !== pct) {
      const first = parts.pct.textContent === '';
      parts.pct.textContent = pct;
      if (!first) pop(parts.pct, 1.25);
    }
    parts.fill.style.width = `${v * 100}%`;
    box.classList.toggle('low', v < 0.25);
    parts.sub.textContent = m.sub;
  }

  showFinal(rows: (Who & { place: number; stamps: number; coins: number; members?: Who[] })[], onAgain: () => void): void {
    const winners = rows.filter((r) => r.place === 1);
    const title = winners.length > 1 ? `${winners.map((w) => w.name).join(' & ')} win!` : `${winners[0]?.name ?? ''} wins!`;
    const podium = this.podium(rows, (i) => {
      const r = rows[i];
      const stats = el('div', 'ptile__stats');
      if (r) stats.append(stat('stamp', r.stamps, 'smiles'), stat('coin', r.coins, 'coins'));
      return stats;
    });
    this.finalPage('Game over', title, podium, 'Back to the lobby', 'or press Play again on the host phone', onAgain);
  }
}

export function ordinal(n: number): string {
  return ['1st', '2nd', '3rd', '4th'][n - 1] ?? `${n}th`;
}

/** "Pip", "Pip and Mochi", "Pip, Mochi and Bolt". */
function listNames(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** How phones join: Atelier's QR code and address while the game shares, else what's wrong and what to do. */
function joinCard(sharing: Sharing): HTMLElement {
  const join = el('div', 'lobby__join');
  if (sharing.state === 'sharing') {
    if (sharing.qr) {
      const qr = el('img', 'lobby__qr');
      qr.src = sharing.qr; // a data: URL Atelier made of the address
      qr.alt = 'QR code to join the game';
      qr.width = 168;
      qr.height = 168;
      join.append(qr);
    }
    const how = el('div', 'lobby__how');
    const scan = el('h2', 'lobby__scan');
    scan.append(svg(ICON.qr, 'lobby__scan-icon'), el('span', '', sharing.lan ? 'Scan with your phone' : 'Join on this computer'));
    const url = el('p', 'lobby__url', sharing.url);
    url.dataset.url = sharing.url;
    how.append(scan, el('p', 'muted', sharing.lan ? 'or open this address' : 'Open this address in a browser here'), url);
    how.append(
      el(
        'p',
        'lobby__note',
        sharing.lan
          ? 'Phones join on the same Wi-Fi. The first time, a phone warns about Atelier’s certificate: choose to go on.'
          : `Phones can’t reach this computer: ${sharing.note ?? 'it isn’t on a Wi-Fi.'}`,
      ),
    );
    join.append(how);
    return join;
  }
  join.classList.add('lobby__join--wait');
  if (sharing.state === 'starting') {
    join.append(el('i', 'spinner'), el('p', 'muted', 'Starting the game’s server…'));
  } else {
    const how = el('div', 'lobby__how');
    how.append(el('h2', 'lobby__scan', sharing.state === 'stopped' ? 'Phones can’t join right now' : 'Phones can’t join here'));
    how.append(el('p', 'muted', sharing.reason));
    how.append(el('p', 'lobby__note', sharing.state === 'stopped' ? 'Press S to share again.' : 'Press D to watch a CPU game.'));
    join.append(how);
  }
  return join;
}
