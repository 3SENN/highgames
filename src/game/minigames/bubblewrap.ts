// Bubble Wrap: everyone holds a sheet of bubble wrap (their phone screen) and pops as many bubbles as they can.
// Plain bubbles are 1 point, golden ones 3; grumpy bubbles (the ones with a frown) need two presses. A sheet
// that's fully popped is swapped for a fresh one. Everyone gets the very same sheets in the same order.
import { type Rng, createRng } from '../rng';

export const BUBBLE = {
  duration: 25, // seconds
  cols: 6,
  rows: 10,
  golden: 3, // golden bubbles per sheet
  grumpy: 4, // grumpy bubbles per sheet
  grumpyTaps: 2,
  slide: 0.45, // seconds a fresh sheet takes to slide in (presses meanwhile don't count)
  // Where the bubbles sit on the phone's 9:16 playfield: x and sizes as fractions of its width, y of its height.
  pitch: 0.145, // between bubble centres across a row
  rowPitch: 0.88, // rows are this share of `pitch` apart (every other row is shifted half a bubble, like real wrap)
  r: 0.06, // bubble radius
  top: 0.215, // centre of the first row
  reach: 1.22, // a press this many radii from a bubble's centre still counts
} as const;

export type BubbleKind = 'plain' | 'golden' | 'grumpy';

export const BUBBLE_POINTS: Record<BubbleKind, number> = { plain: 1, golden: 3, grumpy: 1 };

export const BUBBLES = BUBBLE.cols * BUBBLE.rows;

/** Width over height of the playfield: y fractions times 1/ASPECT are in width units. */
const ASPECT = 9 / 16;

/** A bubble's centre on the playfield (x as a fraction of the width, y of the height). */
export function bubbleXY(i: number): { x: number; y: number } {
  const row = Math.floor(i / BUBBLE.cols);
  const col = i % BUBBLE.cols;
  const x0 = (1 - (BUBBLE.cols - 0.5) * BUBBLE.pitch) / 2;
  return {
    x: x0 + col * BUBBLE.pitch + (row % 2 ? BUBBLE.pitch / 2 : 0),
    y: BUBBLE.top + row * BUBBLE.pitch * BUBBLE.rowPitch * ASPECT,
  };
}

/** The bubble under a press at (x, y), the closest one within reach, or null. */
export function bubbleAt(x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = (BUBBLE.r * BUBBLE.reach) ** 2;
  for (let i = 0; i < BUBBLES; i++) {
    const b = bubbleXY(i);
    const dx = x - b.x;
    const dy = (y - b.y) / ASPECT;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface Bubble {
  kind: BubbleKind;
  /** Presses still needed: 0 = popped. */
  left: number;
}

export interface Sheet {
  bubbles: Bubble[];
  /** Bubbles not yet popped. */
  left: number;
}

/** A fresh sheet: golden and grumpy bubbles scattered among the plain ones. */
export function newSheet(rng: Rng): Sheet {
  const bubbles: Bubble[] = Array.from({ length: BUBBLES }, () => ({ kind: 'plain', left: 1 }));
  const free = Array.from({ length: BUBBLES }, (_, i) => i);
  const take = (kind: BubbleKind, count: number) => {
    for (let k = 0; k < count && free.length; k++) {
      const [i] = free.splice(Math.floor(rng() * free.length), 1);
      if (i !== undefined) bubbles[i] = { kind, left: kind === 'grumpy' ? BUBBLE.grumpyTaps : 1 };
    }
  };
  take('golden', BUBBLE.golden);
  take('grumpy', BUBBLE.grumpy);
  return { bubbles, left: BUBBLES };
}

/** The n-th sheet of a game (everyone gets the same ones). */
export function sheetFor(seed: number, n: number): Sheet {
  return newSheet(createRng((seed + n * 7919) >>> 0));
}

export interface Popper {
  seed: number;
  sheet: Sheet;
  score: number;
  /** Bubbles popped in all. */
  popped: number;
  goldens: number;
  /** Sheets fully popped. */
  sheets: number;
  /** Presses before this time don't count (a fresh sheet is still sliding in). */
  readyAt: number;
}

export function newPopper(seed: number): Popper {
  return { seed, sheet: sheetFor(seed, 0), score: 0, popped: 0, goldens: 0, sheets: 0, readyAt: 0 };
}

export type PressResult =
  | { kind: 'pop'; index: number; bubble: BubbleKind; points: number; cleared: boolean }
  /** A grumpy bubble took the first press and is now cross. */
  | { kind: 'squeak'; index: number }
  /** Nothing there (between bubbles, or already popped). */
  | { kind: 'miss'; index: number | null }
  /** The sheet is still sliding in. */
  | { kind: 'wait' };

/** A press at (x, y) at time t. A popped-out sheet is swapped for the next one. */
export function press(p: Popper, x: number, y: number, t: number): PressResult {
  if (t < p.readyAt) return { kind: 'wait' };
  const index = bubbleAt(x, y);
  const b = index === null ? undefined : p.sheet.bubbles[index];
  if (index === null || !b || b.left <= 0) return { kind: 'miss', index };
  b.left -= 1;
  if (b.left > 0) return { kind: 'squeak', index };
  const points = BUBBLE_POINTS[b.kind];
  p.score += points;
  p.popped += 1;
  if (b.kind === 'golden') p.goldens += 1;
  p.sheet.left -= 1;
  const cleared = p.sheet.left <= 0;
  if (cleared) {
    p.sheets += 1;
    p.sheet = sheetFor(p.seed, p.sheets);
    p.readyAt = t + BUBBLE.slide;
  }
  return { kind: 'pop', index, bubble: b.kind, points, cleared };
}

export function bubbleScores(poppers: readonly Popper[]): number[] {
  return poppers.map((p) => p.score);
}

// ------------------------------------------------------------------ computer players

/** A computer player's thumb: when it presses next, and whether it's staring into space. */
export interface CpuThumb {
  nextAt: number;
  spaced: number;
}

export function newCpuThumb(): CpuThumb {
  return { nextAt: 0.4, spaced: 0 };
}

/** Presses a second at full attention. skill: 0 sleepy … 1 sharp. */
export function cpuRate(skill: number): number {
  return 2.4 + 4.0 * skill;
}

/**
 * Where a computer player presses this step, or null. It works through the sheet row by row (a sharp one goes
 * for the golden bubbles first), now and then misses, and sometimes zones out for a moment.
 */
export function cpuPress(c: CpuThumb, p: Popper, t: number, dt: number, skill: number, rng: Rng): { x: number; y: number } | null {
  if (c.spaced > 0) {
    c.spaced -= dt;
    if (c.spaced <= 0) c.nextAt = t + 0.2;
    return null;
  }
  if (rng() < (0.05 + (1 - skill) * 0.22) * dt) {
    c.spaced = 0.4 + rng() * (0.3 + (1 - skill) * 0.9);
    return null;
  }
  if (t < c.nextAt || t < p.readyAt) return null;
  c.nextAt = t + (1 / cpuRate(skill)) * (0.75 + rng() * 0.5);
  const open = p.sheet.bubbles.map((b, i) => (b.left > 0 ? i : -1)).filter((i) => i >= 0);
  if (!open.length) return null;
  const goldens = open.filter((i) => p.sheet.bubbles[i]?.kind === 'golden');
  const target = goldens.length && rng() < skill * 0.7 ? (goldens[0] as number) : (open[0] as number);
  // A slip: the thumb lands on wrap that's already flat.
  if (rng() < 0.03 + (1 - skill) * 0.1) return null;
  const at = bubbleXY(target);
  return { x: at.x + (rng() - 0.5) * BUBBLE.r * 0.6, y: at.y + (rng() - 0.5) * BUBBLE.r * 0.6 * ASPECT };
}
