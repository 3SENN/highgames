// The companion editor on the phone, laid out and styled like Atelier's look editor (atelier
// src/renderer/src/companion-card: LookInPlace, LookTools, LookRing, AdjustSliders) in its narrow layout:
// the companion in a tinted hero with a hairline tools pill (undo, redo, the four shuffle styles, presets),
// the eight category bubbles in a row under it, and the option card a bubble opens, with the fine-tuning
// card below it. Atelier's own rules decide what fits (vendor/atelier-look). Every pick applies at once.
import { LOOK_ADJUST_GROUPS, LOOK_ADJUST_LIMIT, LOOK_ADJUST_STEP, type LookAdjustKey } from '../../vendor/atelier-look/companion';
import { adjustOf, fitsWithHat, isPartAllowed, lookKey, normalizeLook } from '../../vendor/atelier-look/companionLogic';
import { type CompanionConfig, faceLabel, partLabel } from '../companion/config';
import { companionBase } from '../companion/kit-base';
import { SHUFFLE_STYLES, shuffleLook } from '../companion/shuffle';
import { type Framing, companionThumb } from '../companion/thumb';
import {
  type CompanionLook,
  FACE_IDS,
  type FaceLayer,
  PART_IDS,
  PART_SLOTS,
  type PartSlot,
  RIGS,
  type RigId,
  TINTS,
  type Tint,
  rigName,
} from '../shared/look';
import { type Layout, type PhoneMsg, ROUND_CHOICES } from '../shared/protocol';
import { saveLook } from './look-store';
import { Preview } from './preview';
import './editor.css';

type Lobby = Extract<Layout, { kind: 'lobby' }>;
type CategoryId = 'colours' | 'shape' | 'eyes' | 'mouth' | 'brows' | 'hat' | 'hair' | 'accessories';
type AdjustGroup = (typeof LOOK_ADJUST_GROUPS)[number]['id'];

/** Atelier's eight look categories, in its tab order, with the slider group each one shows. */
const CATEGORIES: { id: CategoryId; label: string; adjust: AdjustGroup | null }[] = [
  { id: 'colours', label: 'Colours', adjust: null },
  { id: 'shape', label: 'Shape', adjust: 'head' },
  { id: 'eyes', label: 'Eyes', adjust: 'eyes' },
  { id: 'mouth', label: 'Mouth', adjust: 'mouth' },
  { id: 'brows', label: 'Brows', adjust: 'brows' },
  { id: 'hat', label: 'Hat', adjust: null },
  { id: 'hair', label: 'Hair', adjust: null },
  { id: 'accessories', label: 'Accessories', adjust: 'accessory' },
];

type Section =
  | { kind: 'rig'; title: string }
  | { kind: 'part'; title: string; slot: PartSlot; options: (string | null)[] }
  | { kind: 'face'; title: string; layer: FaceLayer; options: readonly string[] }
  | { kind: 'colours'; title: string };

const part = (title: string, slot: PartSlot): Section => ({ kind: 'part', title, slot, options: slot === 'head' ? [...PART_IDS.head] : [null, ...PART_IDS[slot]] });
const face = (title: string, layer: FaceLayer): Section => ({ kind: 'face', title, layer, options: FACE_IDS[layer] });

/** What each category's card holds (Atelier's panelSections). */
function sections(id: CategoryId): Section[] {
  switch (id) {
    case 'colours':
      return [{ kind: 'colours', title: 'Colours' }];
    case 'shape':
      return [{ kind: 'rig', title: 'Body' }, part('Head', 'head'), part('Ears', 'ears')];
    case 'eyes':
      return [face('Eyes', 'eyes')];
    case 'mouth':
      return [face('Mouth', 'mouth')];
    case 'brows':
      return [face('Brows', 'brows')];
    case 'hat':
      return [part('Hat', 'hat')];
    case 'hair':
      return [part('Hair', 'hair')];
    case 'accessories':
      return [part('Glasses', 'eyeAccessory'), part('Earwear', 'earAccessory'), part('Prop', 'prop')];
  }
}

const TINT_LABELS: Record<Tint, string> = { skin: 'Skin', hair: 'Hair', accent: 'Accent', outfit: 'Outfit' };

// ------------------------------------------------------------------ icons and glyphs

/** Lucide icons (ISC licence), the set Atelier's interface uses. */
const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pipette: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
  none: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
} as const;

function icon(name: keyof typeof ICONS, cls = ''): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** Atelier's small category glyphs, filled from the look's colours (--ring-*). */
const HEAD = '<circle cx="12" cy="11" r="6.5" fill="var(--ring-skin)"/>';
const GLYPHS: Record<Exclude<CategoryId, 'eyes' | 'mouth' | 'brows'>, string> = {
  colours:
    '<path d="M12 12V3.5A8.5 8.5 0 0 1 20.5 12z" fill="var(--ring-skin)"/><path d="M12 12h8.5A8.5 8.5 0 0 1 12 20.5z" fill="var(--ring-hair)"/><path d="M12 12v8.5A8.5 8.5 0 0 1 3.5 12z" fill="var(--ring-accent)"/><path d="M12 12H3.5A8.5 8.5 0 0 1 12 3.5z" fill="var(--ring-outfit)"/>',
  shape: '<path d="M4.5 22c0-4.2 3.4-6.8 7.5-6.8s7.5 2.6 7.5 6.8z" fill="var(--ring-outfit)"/><circle cx="12" cy="9" r="5.5" fill="var(--ring-skin)"/>',
  hat: '<circle cx="12" cy="15" r="5.5" fill="var(--ring-skin)"/><path d="M5.5 13a6.5 6.5 0 0 1 13 0z" fill="var(--ring-outfit)"/><rect x="5" y="12" width="14" height="2.6" rx="1.3" fill="var(--ring-accent)"/><circle cx="12" cy="5.2" r="1.7" fill="var(--ring-accent)"/>',
  hair: `${HEAD}<path d="M5.6 11.2a6.5 6.5 0 0 1 12.8 0c-2.3-1.4-4.6-1.8-7-1-2-.2-3.9.2-5.8 1z" fill="var(--ring-hair)"/><path d="M11 4.9c.4-1.8 1.8-2.8 3.4-2.9-.9 1-1.2 1.9-.9 3" stroke="var(--ring-hair)" stroke-width="1.4" stroke-linecap="round" fill="none"/>`,
  accessories: `${HEAD}<circle cx="9.3" cy="11" r="2.2" stroke="var(--ring-hair)" stroke-width="1.3" fill="none"/><circle cx="14.7" cy="11" r="2.2" stroke="var(--ring-hair)" stroke-width="1.3" fill="none"/><path d="M11.5 11h1" stroke="var(--ring-hair)" stroke-width="1.3"/>`,
};

// ------------------------------------------------------------------ helpers

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Markup from our own constants (icons, glyphs) only. */
function withSvg<T extends HTMLElement>(node: T, svg: string): T {
  node.insertAdjacentHTML('beforeend', svg);
  return node;
}

function button(label: string, cls: string, onPress: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onPress);
  return b;
}

/** A face piece on the skin colour (Atelier's FaceSwatch): the resting drawing, with pupils for eyes. */
function faceSwatch(cfg: CompanionConfig, layer: FaceLayer, id: string, skin: string): HTMLSpanElement {
  const s = el('span', `co-face-swatch co-face-swatch--${layer}`);
  const def = cfg.manifest.face[layer]?.[id] as { variants: Record<string, string>; pupils?: string } | undefined;
  const files = [def?.pupils, def?.variants.neutral].filter((f): f is string => Boolean(f));
  s.style.setProperty('--swatch-skin', skin);
  s.style.backgroundImage = files.map((f) => `url("${companionBase()}${f}")`).join(', ');
  return s;
}

/** Undo and redo; a slider drag or a colour drag is one step. */
class History {
  private past: CompanionLook[] = [];
  private future: CompanionLook[] = [];
  private group: string | null = null;

  record(before: CompanionLook, merge?: string): void {
    if (merge && merge === this.group) return;
    this.group = merge ?? null;
    this.past.push(before);
    if (this.past.length > 80) this.past.shift();
    this.future = [];
  }
  seal(): void {
    this.group = null;
  }
  undo(current: CompanionLook): CompanionLook | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    this.group = null;
    return prev;
  }
  redo(current: CompanionLook): CompanionLook | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    this.group = null;
    return next;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}

export interface CustomizerHost {
  send(msg: PhoneMsg): void;
  vibrate(pattern: number[]): void;
  /** Called (debounced) when the look changes, e.g. to update the header portrait. */
  changed(look: CompanionLook): void;
}

// ------------------------------------------------------------------ the editor

export class Customizer {
  readonly el = el('section', 'customizer');
  private readonly preview: Preview;
  private readonly hero = el('div', 'co-hero');
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly ring = el('div', 'co-ring');
  private readonly panel = el('div', 'co-ring-panel');
  private readonly footer = el('div', 'co-footer');
  private readonly history = new History();
  private open: CategoryId | null = null;
  private tint: Tint = 'skin';
  private previewTimer = 0;
  private sendTimer = 0;
  private menu: HTMLElement | null = null;
  private lobby: Lobby;

  constructor(
    private readonly cfg: CompanionConfig,
    private look: CompanionLook,
    lobby: Lobby,
    private readonly host: CustomizerHost,
  ) {
    this.lobby = lobby;
    const canvas = el('canvas', 'co-hero__figure');
    canvas.setAttribute('aria-label', 'Your companion. Drag to turn it.');
    const floor = el('div', 'co-hero__floor');

    // The tools pill: undo, redo, a divider, the four shuffle styles and the presets.
    const tools = el('div', 'co-look__tools');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', 'Look tools');
    this.undoBtn = withSvg(button('', 'co-look__tool', () => this.step(-1)), icon('undo'));
    this.undoBtn.setAttribute('aria-label', 'Undo');
    this.redoBtn = withSvg(button('', 'co-look__tool', () => this.step(1)), icon('redo'));
    this.redoBtn.setAttribute('aria-label', 'Redo');
    tools.append(this.undoBtn, this.redoBtn, el('span', 'co-look__divider'));
    for (const s of SHUFFLE_STYLES) {
      const b = button('', 'co-look__style', () => this.set(shuffleLook(this.cfg, s.id), { buzz: true }));
      b.title = `Shuffle: ${s.label.toLowerCase()}`;
      if (s.id === 'any') withSvg(b, icon('shuffle'));
      b.append(s.label);
      tools.append(b);
    }
    if (cfg.presets.length) {
      const presets = withSvg(button('Presets ', 'co-look__style', () => this.toggleMenu(presets)), icon('chevron'));
      presets.setAttribute('aria-haspopup', 'menu');
      tools.append(presets);
    }

    this.hero.append(floor, canvas, tools);
    this.ring.setAttribute('role', 'tablist');
    this.ring.setAttribute('aria-label', 'Look categories');
    this.el.append(this.hero, this.ring, this.panel, this.footer);
    this.preview = new Preview(canvas);
    void this.preview.show(look);
    this.paintColours();
    this.renderRing();
    this.renderPanel();
    this.renderFooter();
    this.updateHistoryButtons();
  }

  /** The TV sent a new lobby state (ready, host, rounds): only the footer changes. */
  update(lobby: Lobby): void {
    this.lobby = lobby;
    this.renderFooter();
  }

  destroy(): void {
    clearTimeout(this.previewTimer);
    clearTimeout(this.sendTimer);
    this.preview.dispose();
    this.el.remove();
  }

  // ------------------------------------------------------------ changing the look

  /** Every change goes through here: normalised by Atelier's rules, saved, previewed and sent to the TV. */
  private set(next: CompanionLook, opts: { merge?: string; buzz?: boolean; redraw?: boolean; record?: boolean } = {}): void {
    const look = normalizeLook(next, this.cfg.compatibility);
    if (lookKey(look) === lookKey(this.look)) return;
    if (opts.record !== false) this.history.record(this.look, opts.merge);
    this.look = look;
    saveLook(look);
    if (opts.buzz) this.host.vibrate([12]);
    clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => void this.preview.show(this.look), 90);
    clearTimeout(this.sendTimer);
    this.sendTimer = window.setTimeout(() => {
      this.host.send({ t: 'look', look: this.look });
      this.host.changed(this.look);
    }, 220);
    this.paintColours();
    this.renderRing();
    if (opts.redraw !== false) this.renderPanel();
    this.updateHistoryButtons();
  }

  private step(dir: -1 | 1): void {
    const next = dir < 0 ? this.history.undo(this.look) : this.history.redo(this.look);
    if (next) this.set(next, { record: false });
    this.updateHistoryButtons();
  }

  private updateHistoryButtons(): void {
    this.undoBtn.disabled = !this.history.canUndo;
    this.redoBtn.disabled = !this.history.canRedo;
  }

  /** The look's colours feed the bubbles' glyphs and the hero's wash. */
  private paintColours(): void {
    const c = this.look.colors;
    for (const [k, v] of [
      ['--ring-skin', c.skin],
      ['--ring-hair', c.hair],
      ['--ring-accent', c.accent],
      ['--ring-outfit', c.outfit],
      ['--hero-tint', c.accent],
    ] as const) {
      this.el.style.setProperty(k, v);
    }
  }

  // ------------------------------------------------------------ the presets menu

  private toggleMenu(anchor: HTMLElement): void {
    if (this.menu) {
      this.closeMenu();
      return;
    }
    const menu = el('div', 'co-menu');
    menu.setAttribute('role', 'menu');
    for (const p of this.cfg.presets) {
      const item = button('', 'co-menu__item', () => {
        this.closeMenu();
        this.set({ ...p.look }, { buzz: true });
      });
      item.setAttribute('role', 'menuitem');
      item.append(el('strong', '', p.name), el('small', '', p.tagline));
      menu.append(item);
    }
    const r = anchor.getBoundingClientRect();
    const h = this.hero.getBoundingClientRect();
    menu.style.top = `${r.bottom - h.top + 6}px`;
    this.hero.append(menu);
    this.menu = menu;
    setTimeout(() => document.addEventListener('pointerdown', this.outside, { once: true }), 0);
  }

  private outside = (e: PointerEvent): void => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
    else if (this.menu) document.addEventListener('pointerdown', this.outside, { once: true });
  };

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  // ------------------------------------------------------------ the ring of bubbles

  private renderRing(): void {
    const bubbles = CATEGORIES.map((c) => {
      const selected = this.open === c.id;
      const b = el('button', `co-ring__bubble${selected ? ' co-ring__bubble--selected' : ''}`);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', c.label);
      b.setAttribute('aria-selected', String(selected));
      if (c.id === 'eyes' || c.id === 'mouth' || c.id === 'brows') {
        const art = el('span', 'co-ring__art co-ring__art--face');
        art.append(faceSwatch(this.cfg, c.id, this.look.face[c.id], this.look.colors.skin));
        b.append(art);
      } else {
        withSvg(b, `<svg class="co-ring__art" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[c.id]}</svg>`);
      }
      b.append(el('span', 'co-ring__chip', c.label));
      b.addEventListener('click', () => {
        this.open = selected ? null : c.id;
        this.renderRing();
        this.renderPanel();
        if (this.open) this.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      return b;
    });
    this.ring.replaceChildren(...bubbles);
  }

  // ------------------------------------------------------------ the option card

  private renderPanel(): void {
    const category = CATEGORIES.find((c) => c.id === this.open);
    if (!category) {
      this.panel.replaceChildren(el('p', 'co-ring-hint', 'Tap a bubble to change your companion.'));
      return;
    }
    const card = el('section', 'co-ring-card');
    card.setAttribute('role', 'tabpanel');
    card.setAttribute('aria-label', category.label);
    const head = el('header', 'co-ring-card__head');
    const close = withSvg(
      button('', 'co-ring-card__close', () => {
        this.open = null;
        this.renderRing();
        this.renderPanel();
      }),
      icon('close'),
    );
    close.setAttribute('aria-label', `Close ${category.label.toLowerCase()}`);
    head.append(el('h4', '', category.label), close);
    const body = el('div', 'co-ring-card__body');
    const all = sections(category.id);
    for (const s of all) body.append(...this.section(s, all.length > 1));
    card.append(head, body);
    const parts: HTMLElement[] = [card];
    if (category.adjust) parts.push(this.sliders(category.adjust));
    this.panel.replaceChildren(...parts);
  }

  private section(section: Section, headed: boolean): HTMLElement[] {
    if (section.kind === 'colours') return this.colours();
    const wrap = el('div', 'co-ring-section');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', section.title);
    if (headed) wrap.append(el('h5', '', section.title));
    const grid = el('div', 'co-ring-grid');
    const options: (string | null)[] = section.kind === 'rig' ? [...RIGS] : [...section.options];
    const head = this.look.parts.head ?? PART_IDS.head[0];
    for (const option of options) {
      const current = this.isCurrent(section, option);
      let allowed = true;
      let note: string | null = null;
      if (section.kind === 'part' && section.slot !== 'head') {
        allowed = isPartAllowed(this.cfg.compatibility, head, section.slot, option);
        if (!allowed) note = `Doesn't fit the ${partLabel(this.cfg, head).toLowerCase()}`;
        else if (section.slot === 'hat' && option) {
          const replaced = PART_SLOTS.flatMap((other) => {
            const worn = this.look.parts[other];
            return worn !== null && !fitsWithHat(this.cfg.compatibility, option, other, worn) ? [partLabel(this.cfg, worn).toLowerCase()] : [];
          });
          if (replaced.length) note = `Replaces the ${replaced.join(' and ')}`;
        }
      }
      const name = this.optionLabel(section, option);
      const tile = el('button', `co-ring-tile${current ? ' co-ring-tile--current' : ''}`);
      tile.type = 'button';
      tile.disabled = !allowed;
      tile.setAttribute('aria-pressed', String(current));
      tile.setAttribute('aria-label', note ? `${name}: ${note}` : name);
      tile.title = note ? `${name}. ${note}` : name;
      this.tileArt(tile, section, option);
      if (current) withSvg(tile.appendChild(el('span', 'co-ring-tile__check')), icon('check'));
      tile.addEventListener('click', () => this.set(this.withOption(section, option), { buzz: true }));
      grid.append(tile);
    }
    wrap.append(grid);
    return [wrap];
  }

  private isCurrent(section: Exclude<Section, { kind: 'colours' }>, option: string | null): boolean {
    if (section.kind === 'rig') return this.look.rig === option;
    if (section.kind === 'part') return this.look.parts[section.slot] === option;
    return this.look.face[section.layer] === option;
  }

  /** A pick (Atelier's withOption): a part that doesn't go with the hat takes the hat off; the latest pick wins. */
  private withOption(section: Exclude<Section, { kind: 'colours' }>, option: string | null): CompanionLook {
    if (section.kind === 'rig') return { ...this.look, rig: option as RigId };
    if (section.kind === 'face') return option ? { ...this.look, face: { ...this.look.face, [section.layer]: option } } : this.look;
    const parts = { ...this.look.parts, [section.slot]: option };
    if (!fitsWithHat(this.cfg.compatibility, parts.hat, section.slot, option)) parts.hat = null;
    return { ...this.look, parts };
  }

  private optionLabel(section: Exclude<Section, { kind: 'colours' }>, option: string | null): string {
    if (option === null) return 'None';
    if (section.kind === 'rig') return this.cfg.manifest.rigs[option as RigId]?.label ?? rigName(option as RigId);
    if (section.kind === 'face') return faceLabel(this.cfg, section.layer, option);
    return partLabel(this.cfg, option);
  }

  /** What a tile shows: the face piece, a "none" sign, or a still of the companion wearing the option. */
  private tileArt(tile: HTMLButtonElement, section: Exclude<Section, { kind: 'colours' }>, option: string | null): void {
    if (option === null) {
      withSvg(tile, icon('none', 'co-ring-tile__none'));
      return;
    }
    if (section.kind === 'face') {
      const art = el('span', 'co-ring-tile__face');
      art.append(faceSwatch(this.cfg, section.layer, option, this.look.colors.skin));
      tile.append(art);
      return;
    }
    const still = el('span', 'co-ring-tile__still');
    tile.append(still);
    const framing: Framing = section.kind === 'rig' || (section.kind === 'part' && section.slot === 'prop') ? 'full' : 'bust';
    const look = normalizeLook(this.withOption(section, option), this.cfg.compatibility);
    void companionThumb(look, 96, framing).then((url) => (still.style.backgroundImage = `url("${url}")`));
  }

  // ------------------------------------------------------------ colours

  private colours(): HTMLElement[] {
    const tints = el('div', 'co-ring-tints');
    tints.setAttribute('role', 'group');
    tints.setAttribute('aria-label', 'Colour to change');
    for (const t of TINTS) {
      const b = button('', 'co-ring-tints__tint', () => {
        this.tint = t;
        this.history.seal();
        this.renderPanel();
      });
      b.setAttribute('aria-pressed', String(this.tint === t));
      const dot = el('i');
      dot.style.setProperty('--dot', this.look.colors[t]);
      b.append(dot, TINT_LABELS[t]);
      tints.append(b);
    }

    const tint = this.tint;
    const own = this.look.colors[tint].toLowerCase();
    const palettes = this.cfg.randomization.palettes;
    const swatches: string[] = [];
    for (const p of palettes) {
      const c = p.colors[tint]?.toLowerCase();
      if (c && !swatches.includes(c)) swatches.push(c);
    }
    const grid = el('div', 'co-ring-grid');
    for (const colour of swatches) {
      const current = colour === own;
      const b = button('', `co-ring-tile co-ring-tile--swatch${current ? ' co-ring-tile--current' : ''}`, () =>
        this.set({ ...this.look, colors: { ...this.look.colors, [tint]: colour } }, { buzz: true }),
      );
      b.style.setProperty('--swatch', colour);
      b.setAttribute('aria-pressed', String(current));
      b.setAttribute('aria-label', colour);
      if (current) withSvg(b.appendChild(el('span', 'co-ring-tile__check')), icon('check'));
      grid.append(b);
    }
    // A colour no palette has shows on the last tile, the free colour picker.
    const custom = !swatches.includes(own);
    const picker = el('label', `co-ring-tile co-ring-tile--custom${custom ? ' co-ring-tile--current' : ''}`);
    picker.title = 'Any colour';
    if (custom) picker.style.setProperty('--swatch', this.look.colors[tint]);
    const input = el('input');
    input.type = 'color';
    input.value = this.look.colors[tint];
    input.setAttribute('aria-label', `Any ${TINT_LABELS[tint].toLowerCase()} colour`);
    input.addEventListener('input', () => this.set({ ...this.look, colors: { ...this.look.colors, [tint]: input.value.toLowerCase() } }, { merge: `color:${tint}`, redraw: false }));
    input.addEventListener('change', () => {
      this.history.seal();
      this.renderPanel();
    });
    picker.append(input);
    if (custom) withSvg(picker.appendChild(el('span', 'co-ring-tile__check')), icon('check'));
    else withSvg(picker, icon('pipette'));
    grid.append(picker);
    const swatchSection = el('div', 'co-ring-section');
    swatchSection.append(grid);

    const out: HTMLElement[] = [tints, swatchSection];
    if (palettes.length) {
      const section = el('div', 'co-ring-section');
      section.append(el('h5', '', 'Palettes'));
      const row = el('div', 'co-ring-palettes');
      for (const p of palettes) {
        const current = TINTS.every((t) => p.colors[t].toLowerCase() === this.look.colors[t].toLowerCase());
        const quarters = TINTS.map((t, i) => `${p.colors[t]} ${i * 25}% ${(i + 1) * 25}%`).join(', ');
        const b = button('', `co-ring-tile co-ring-tile--palette${current ? ' co-ring-tile--current' : ''}`, () => this.set({ ...this.look, colors: { ...p.colors } }, { buzz: true }));
        b.style.setProperty('--palette', `conic-gradient(${quarters})`);
        b.setAttribute('aria-pressed', String(current));
        b.setAttribute('aria-label', p.name);
        b.title = p.name;
        if (current) withSvg(b.appendChild(el('span', 'co-ring-tile__check')), icon('check'));
        row.append(b);
      }
      section.append(row);
      out.push(section);
    }
    return out;
  }

  // ------------------------------------------------------------ fine-tuning

  private sliders(group: AdjustGroup): HTMLElement {
    const def = LOOK_ADJUST_GROUPS.find((g) => g.id === group);
    const keys = (def?.keys ?? []).map((k) => k.key);
    const card = el('div', 'co-ring-sliders');
    const box = el('div', 'co-adjust');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Fine-tune');
    const rows = el('div', 'co-adjust__group');
    const reset = withSvg(button('', 'co-adjust__reset', () => {}), icon('reset'));
    reset.append(' Reset adjustments');
    const touched = () => keys.some((k) => adjustOf(this.look, k) !== 0);
    for (const { key, label } of def?.keys ?? []) {
      const row = el('div', 'co-adjust__row');
      const id = `adjust-${key}`;
      const lab = el('label', 'co-adjust__label', label);
      lab.htmlFor = id;
      const input = el('input', 'co-adjust__slider');
      input.id = id;
      input.type = 'range';
      input.min = String(-LOOK_ADJUST_LIMIT);
      input.max = String(LOOK_ADJUST_LIMIT);
      input.step = String(LOOK_ADJUST_STEP);
      const paint = (v: number) => input.style.setProperty('--fill', `${((v + LOOK_ADJUST_LIMIT) / (LOOK_ADJUST_LIMIT * 2)) * 100}%`);
      input.value = String(adjustOf(this.look, key));
      paint(Number(input.value));
      input.addEventListener('input', () => {
        paint(Number(input.value));
        this.setAdjust(key, Number(input.value));
        reset.disabled = !touched();
      });
      const seal = () => this.history.seal();
      input.addEventListener('pointerup', seal);
      input.addEventListener('change', seal);
      input.addEventListener('dblclick', () => {
        input.value = '0';
        paint(0);
        this.setAdjust(key, 0);
        seal();
        reset.disabled = !touched();
      });
      row.append(lab, input);
      rows.append(row);
    }
    reset.disabled = !touched();
    reset.addEventListener('click', () => {
      const adjust = { ...(this.look.adjust ?? {}) };
      for (const k of keys) delete adjust[k];
      this.set({ ...this.look, adjust });
    });
    box.append(rows, reset);
    card.append(box);
    return card;
  }

  private setAdjust(key: LookAdjustKey, value: number): void {
    // A drag is one undo step, and the card keeps the finger (no redraw while sliding).
    this.set({ ...this.look, adjust: { ...(this.look.adjust ?? {}), [key]: value } }, { merge: `adjust:${key}`, redraw: false });
  }

  // ------------------------------------------------------------ ready and start

  private renderFooter(): void {
    const l = this.lobby;
    const ready = button(l.ready ? 'Ready' : "I'm ready", `co-btn${l.ready ? ' co-btn--done' : ''}`, () => this.host.send({ t: 'ready', ready: !l.ready }));
    if (l.ready) withSvg(ready, icon('check'));
    const parts: HTMLElement[] = [];
    if (l.host) {
      const rounds = el('div', 'co-segmented');
      rounds.setAttribute('role', 'group');
      rounds.setAttribute('aria-label', 'Rounds');
      for (const r of ROUND_CHOICES) {
        const b = button(`${r}`, r === l.rounds ? 'on' : '', () => this.host.send({ t: 'rounds', rounds: r }));
        b.setAttribute('aria-pressed', String(r === l.rounds));
        rounds.append(b);
      }
      const row = el('div', 'co-footer__rounds');
      row.append(el('span', '', 'Rounds'), rounds);
      parts.push(row, ready, button('Start game', 'co-btn co-btn--primary', () => this.host.send({ t: 'start' })));
    } else {
      parts.push(ready, el('p', 'co-footer__note', 'The host starts the game.'));
    }
    this.footer.replaceChildren(...parts);
  }
}
