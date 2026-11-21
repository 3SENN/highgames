// Game messages between the phones and the TV, with validators for the receiving side.
// Atelier carries them (atelier.server, see join.ts); the TV runs the game and treats every phone message as untrusted.
import { type CloudFeatures, isCloudFeatures } from './cloud.js';
import { type ItemId, isItemId } from './items.js';
import { type CompanionLook, parseLook } from './look.js';

export * from './join.js';

export const MAX_SEATS = 4;
export const ROUND_CHOICES = [3, 5, 8, 12] as const;

/** A minigame's id (its file name in src/tv/minigames/games/). */
export type MinigameId = string;
/** How the phone is used in a minigame. Each one feels different in the hand. */
export type ControllerKind =
  | 'tap'
  | 'pump'
  | 'tilt'
  | 'secret'
  | 'still'
  | 'hold'
  | 'stick'
  | 'buttons'
  | 'rhythm'
  /** Flick a finger across the screen (direction and speed). */
  | 'swipe'
  /** Point the phone at the TV like a remote: a pointer from how the phone is turned, plus a button. */
  | 'aim'
  /** Move the phone round in circles (stirring, rolling, winding up). */
  | 'spin'
  /** A big fader, 0 to 1, with an optional confirm button. */
  | 'slider'
  /** Draw with a finger; strokes go to the TV. */
  | 'draw'
  /** A number pad for a guess. */
  | 'number'
  /** The phone screen is the playfield (phones lie on the table): the TV streams what to draw, touches go back. */
  | 'table';
/** The movement a rhythm minigame listens for. `pads`: 2–4 drum pads (the beat says which); `hold`: press and release. */
export type RhythmMotion = 'tap' | 'nod' | 'strum' | 'swipe' | 'wave' | 'shake' | 'sway' | 'pads' | 'hold';
export type SwipeDir = 'up' | 'down' | 'left' | 'right';

const CONTROLLERS: readonly ControllerKind[] = ['tap', 'pump', 'tilt', 'secret', 'still', 'hold', 'stick', 'buttons', 'rhythm', 'swipe', 'aim', 'spin', 'slider', 'draw', 'number', 'table'];
export function isControllerKind(v: unknown): v is ControllerKind {
  return typeof v === 'string' && (CONTROLLERS as readonly string[]).includes(v);
}
const SWIPE_DIRS: readonly SwipeDir[] = ['up', 'down', 'left', 'right'];
const isSwipeDir = (v: unknown): v is SwipeDir => typeof v === 'string' && (SWIPE_DIRS as readonly string[]).includes(v);
/** Most points one draw message may carry (x, y pairs). */
export const MAX_DRAW_POINTS = 48;

// ---------------------------------------------------------------- phone -> TV

export type PhoneMsg =
  | { t: 'look'; look: CompanionLook }
  | { t: 'ready'; ready: boolean }
  | { t: 'rounds'; rounds: number }
  | { t: 'start' }
  | { t: 'roll' }
  | { t: 'use'; item: ItemId }
  | { t: 'choose'; index: number }
  | { t: 'buy'; item: ItemId | null }
  | { t: 'parcel'; priority: boolean }
  | { t: 'tap' }
  | { t: 'pump'; power: number }
  | { t: 'tilt'; x: number; y: number }
  | { t: 'answer'; index: number }
  /** How much the phone is moving, 0 (perfectly still) to 1, about ten times a second. */
  | { t: 'still'; wobble: number }
  /** The big button went down or up. */
  | { t: 'hold'; down: boolean }
  /** The joystick (-1..1, y up) and whether the action button is down. */
  | { t: 'stick'; x: number; y: number; a: boolean }
  /** One of the big buttons was pressed. */
  | { t: 'press'; index: number }
  /** A rhythm move happened now; the TV judges its timing. `pad`: which drum pad; `up`: a held note was let go. */
  | { t: 'beat'; pad?: number; up?: boolean }
  /** A flick across the screen; speed 0 (lazy) to 1 (very fast). */
  | { t: 'swipe'; dir: SwipeDir; speed: number }
  /** Where the phone points (-1..1, y up), about 20 times a second, and whether the button is down. */
  | { t: 'aim'; x: number; y: number; fire: boolean }
  /** How fast the phone goes round in circles: 0 (not) to 1 (very fast), about ten times a second. */
  | { t: 'spin'; speed: number }
  /** The fader (0..1); `done` when the confirm button was pressed. */
  | { t: 'slider'; value: number; done: boolean }
  /** Part of a stroke: points as x, y pairs (0..1 of the pad). `start` begins a new stroke. */
  | { t: 'draw'; pts: number[]; start: boolean }
  /** A number entered on the pad. */
  | { t: 'number'; value: number }
  /** A finger on the playfield (table games): x, y as 0..1 of the canvas. */
  | { t: 'touch'; id: number; x: number; y: number; phase: 'down' | 'move' | 'up' }
  | { t: 'pong'; n: number }
  | { t: 'again' };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIndex = (v: unknown, max = 32): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < max;

/** Returns a clean message, or null for anything malformed. Numbers are clamped to their ranges. */
export function parsePhoneMsg(raw: unknown): PhoneMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'look': {
      const look = parseLook(m.look);
      return look ? { t: 'look', look } : null;
    }
    case 'ready':
      return typeof m.ready === 'boolean' ? { t: 'ready', ready: m.ready } : null;
    case 'rounds':
      return (ROUND_CHOICES as readonly unknown[]).includes(m.rounds) ? { t: 'rounds', rounds: m.rounds as number } : null;
    case 'start':
    case 'roll':
    case 'tap':
    case 'again':
      return { t: m.t };
    case 'use':
      return isItemId(m.item) ? { t: 'use', item: m.item } : null;
    case 'choose':
      return isIndex(m.index) ? { t: 'choose', index: m.index } : null;
    case 'buy':
      return m.item === null || isItemId(m.item) ? { t: 'buy', item: m.item } : null;
    case 'parcel':
      return typeof m.priority === 'boolean' ? { t: 'parcel', priority: m.priority } : null;
    case 'pump':
      return isNum(m.power) ? { t: 'pump', power: clamp(m.power, 0, 1) } : null;
    case 'tilt':
      return isNum(m.x) && isNum(m.y) ? { t: 'tilt', x: clamp(m.x, -1, 1), y: clamp(m.y, -1, 1) } : null;
    case 'answer':
      return isIndex(m.index) ? { t: 'answer', index: m.index } : null;
    case 'still':
      return isNum(m.wobble) ? { t: 'still', wobble: clamp(m.wobble, 0, 1) } : null;
    case 'hold':
      return typeof m.down === 'boolean' ? { t: 'hold', down: m.down } : null;
    case 'stick':
      return isNum(m.x) && isNum(m.y) ? { t: 'stick', x: clamp(m.x, -1, 1), y: clamp(m.y, -1, 1), a: m.a === true } : null;
    case 'press':
      return isIndex(m.index, 8) ? { t: 'press', index: m.index } : null;
    case 'beat': {
      const out: Extract<PhoneMsg, { t: 'beat' }> = { t: 'beat' };
      if (isIndex(m.pad, 4)) out.pad = m.pad;
      if (m.up === true) out.up = true;
      return out;
    }
    case 'swipe':
      return isSwipeDir(m.dir) && isNum(m.speed) ? { t: 'swipe', dir: m.dir, speed: clamp(m.speed, 0, 1) } : null;
    case 'aim':
      return isNum(m.x) && isNum(m.y) ? { t: 'aim', x: clamp(m.x, -1, 1), y: clamp(m.y, -1, 1), fire: m.fire === true } : null;
    case 'spin':
      return isNum(m.speed) ? { t: 'spin', speed: clamp(m.speed, 0, 1) } : null;
    case 'slider':
      return isNum(m.value) ? { t: 'slider', value: clamp(m.value, 0, 1), done: m.done === true } : null;
    case 'draw': {
      if (!Array.isArray(m.pts) || m.pts.length % 2 !== 0 || m.pts.length > MAX_DRAW_POINTS * 2 || !m.pts.every(isNum)) return null;
      return { t: 'draw', pts: (m.pts as number[]).map((v) => clamp(v, 0, 1)), start: m.start === true };
    }
    case 'number':
      return isNum(m.value) ? { t: 'number', value: Math.round(clamp(m.value, -99_999, 999_999)) } : null;
    case 'touch':
      return isIndex(m.id, 5) && isNum(m.x) && isNum(m.y) && (m.phase === 'down' || m.phase === 'move' || m.phase === 'up')
        ? { t: 'touch', id: m.id, x: clamp(m.x, 0, 1), y: clamp(m.y, 0, 1), phase: m.phase }
        : null;
    case 'pong':
      return Number.isInteger(m.n) ? { t: 'pong', n: m.n as number } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- TV -> phone

export interface ChoiceOption {
  label: string;
  hint?: string;
  island?: string;
}

/** What the phone shows. The TV decides; the phone only renders it and sends input back. */
export type Layout =
  | { kind: 'lobby'; ready: boolean; host: boolean; rounds: number; canStart: boolean }
  | { kind: 'wait'; title: string; text?: string }
  | { kind: 'turn'; items: ItemId[]; motion: boolean }
  | { kind: 'rolled'; values: number[]; bonus: number }
  | { kind: 'choice'; title: string; options: ChoiceOption[] }
  | { kind: 'shop'; coins: number; offers: { id: ItemId; cost: number }[]; full: boolean }
  | { kind: 'parcel'; coins: number; cost: number; standard: string; priority: string }
  | { kind: 'intro'; game: MinigameId; title: string; how: string; controller: ControllerKind; ready: boolean; team?: string }
  /** A list to pick from (the mode menu, Free Play, a vote). Only `canPick` phones can choose. */
  | { kind: 'menu'; title: string; options: { label: string; hint?: string }[]; canPick: boolean; note?: string }
  /** `title` replaces the "Stay still" heading (e.g. "Dance!"). */
  | { kind: 'still'; note: string; title?: string }
  /** `zone`: a band of the meter (0..1) drawn in gold on the ring: where to let go. */
  | { kind: 'hold'; label: string; note: string; zone?: [number, number] }
  | { kind: 'stick'; button: string | null; note: string }
  /** Two to six big buttons; `secret` is shown only on this phone (a role, a clue). */
  | { kind: 'buttons'; title: string; buttons: { label: string; color?: string }[]; note?: string; secret?: string }
  /** `pads`: how many drum pads for motion 'pads' (2–4, default 2), with optional labels and colours. */
  | { kind: 'rhythm'; motion: RhythmMotion; note: string; pads?: number; padLabels?: string[]; padColors?: string[] }
  /** Swipe pad; `dirs` limits which flicks count (default all four), `labels` names them on screen. */
  | { kind: 'swipe'; note: string; dirs?: SwipeDir[]; labels?: Partial<Record<SwipeDir, string>> }
  /** Point the phone at the TV; `button` labels the fire button (null: none). */
  | { kind: 'aim'; note: string; button: string | null }
  | { kind: 'spin'; note: string }
  /** `low`/`high` label the ends; `done` labels a confirm button (null: none); `value` is where it starts. */
  | { kind: 'slider'; note: string; low?: string; high?: string; done: string | null; value?: number }
  /** `prompt` is what to draw, under `promptLabel` (default "Draw this"); `done` labels a finish button (null: none). */
  | { kind: 'draw'; note: string; prompt?: string; promptLabel?: string; done: string | null; ink?: string }
  | { kind: 'number'; note: string; min: number; max: number; unit?: string }
  /** The phone screen is the playfield; the TV sends `scene` messages. `hint` shows until the first scene. */
  | { kind: 'table'; hint?: string }
  /** `label` is the button's word (default "SNAP"). */
  | { kind: 'tap'; locked: boolean; note: string; label?: string }
  /** `label` above the gauge (default "Balloon pressure"); `redline: false` hides the danger zone. */
  | { kind: 'pump'; label?: string; redline?: boolean; note?: string }
  /** `title` (default "Glider"), `note` (the steering hint) and `icon` (the thing on the pad, default a plane). */
  | { kind: 'tilt'; title?: string; note?: string; icon?: string }
  | { kind: 'secret'; cloud: CloudFeatures; labels: string[]; round: number; rounds: number }
  | { kind: 'result'; place: number; title: string; text: string }
  | { kind: 'final'; place: number; stamps: number; coins: number; winner: string; host: boolean };

export type TvMsg =
  | { t: 'layout'; layout: Layout }
  | { t: 'you'; seat: number; name: string; color: string }
  | { t: 'meter'; value: number; danger: boolean }
  | { t: 'feedback'; good: boolean; text: string }
  | { t: 'buzz'; pattern: number[] }
  /** A beat of the music, so rhythm controllers can pulse in time. `pad`: which pad the next note is on. */
  | { t: 'pulse'; pad?: number }
  /** What a table-game phone draws now (replaces the previous scene). */
  | { t: 'scene'; items: SceneItem[]; bg?: string }
  | { t: 'ping'; n: number };

/**
 * One shape on a table-game phone. Positions and sizes are fractions of the canvas width (x, w, r, size, lw)
 * and height (y, h), so the same scene fits every phone. Colours are CSS colours.
 */
export type SceneItem =
  | { s: 'circle'; x: number; y: number; r: number; fill?: string; stroke?: string; lw?: number; alpha?: number }
  | { s: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lw?: number; radius?: number; rot?: number; alpha?: number }
  | { s: 'text'; x: number; y: number; text: string; size: number; fill?: string; align?: 'left' | 'center' | 'right'; bold?: boolean; alpha?: number }
  | { s: 'line'; pts: number[]; stroke: string; lw: number; alpha?: number };
export const MAX_SCENE_ITEMS = 160;

const isColor = (v: unknown): boolean => v === undefined || (typeof v === 'string' && v.length <= 40);
function isSceneItem(v: unknown): v is SceneItem {
  if (!v || typeof v !== 'object') return false;
  const i = v as Record<string, unknown>;
  if (!isColor(i.fill) || !isColor(i.stroke)) return false;
  switch (i.s) {
    case 'circle':
      return isNum(i.x) && isNum(i.y) && isNum(i.r);
    case 'rect':
      return isNum(i.x) && isNum(i.y) && isNum(i.w) && isNum(i.h);
    case 'text':
      return isNum(i.x) && isNum(i.y) && isNum(i.size) && typeof i.text === 'string' && i.text.length <= 80;
    case 'line':
      return Array.isArray(i.pts) && i.pts.length <= 200 && i.pts.every(isNum) && isNum(i.lw) && typeof i.stroke === 'string';
    default:
      return false;
  }
}

/** The phone trusts its TV, but still checks the shape so a bad message can't break the page. */
export function parseTvMsg(raw: unknown): TvMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'layout':
      return m.layout && typeof m.layout === 'object' && typeof (m.layout as { kind?: unknown }).kind === 'string'
        ? (m as unknown as TvMsg)
        : null;
    case 'you':
      return Number.isInteger(m.seat) && typeof m.name === 'string' && typeof m.color === 'string' ? (m as unknown as TvMsg) : null;
    case 'meter':
      return isNum(m.value) ? { t: 'meter', value: clamp(m.value, 0, 1.5), danger: m.danger === true } : null;
    case 'feedback':
      return typeof m.text === 'string' ? { t: 'feedback', good: m.good === true, text: m.text } : null;
    case 'buzz':
      return Array.isArray(m.pattern) && m.pattern.every(isNum) ? { t: 'buzz', pattern: m.pattern.slice(0, 8) } : null;
    case 'ping':
      return Number.isInteger(m.n) ? { t: 'ping', n: m.n as number } : null;
    case 'pulse':
      return isIndex(m.pad, 4) ? { t: 'pulse', pad: m.pad } : { t: 'pulse' };
    case 'scene':
      return Array.isArray(m.items) && m.items.length <= MAX_SCENE_ITEMS && m.items.every(isSceneItem) && isColor(m.bg)
        ? { t: 'scene', items: m.items, ...(typeof m.bg === 'string' ? { bg: m.bg } : {}) }
        : null;
    default:
      return null;
  }
}

export function isSecretCloudLayout(l: Layout): l is Extract<Layout, { kind: 'secret' }> {
  return l.kind === 'secret' && isCloudFeatures(l.cloud);
}
