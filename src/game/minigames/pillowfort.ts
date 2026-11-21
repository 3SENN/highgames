// Pillow Fort: two partners stack pillows into one tower, taking turns (A, B, A, B…). The same partner twice in
// a row, or rushing before the last pillow has settled, makes the fort wobble; wobble too much and the top pillow
// tumbles off. The tallest fort when time runs out wins.
import type { Rng } from '../rng.js';

export const PILLOW = {
  duration: 25, // seconds
  minGap: 0.32, // seconds a pillow needs to settle before the next one goes on
  sameWobble: 0.55, // wobble from the same partner pressing twice in a row
  fastWobble: 0.35, // wobble from rushing
  tallness: 40, // taller forts are touchier: wobble grows by (1 + pillows / tallness)
  calm: 0.3, // wobble that settles per second
  topple: 1, // wobble at which the top pillow tumbles off
  afterTumble: 0.35, // wobble left right after a tumble
  fluff: 0.5, // seconds after a tumble when the team is busy re-fluffing (presses are ignored)
} as const;

export interface Fort {
  pillows: number;
  wobble: number;
  /** The partner (0 or 1) who placed the last pillow, or null when either may go. */
  last: number | null;
  /** When the last pillow went on. */
  lastAt: number;
  /** Seconds of re-fluffing left after a tumble. */
  fluff: number;
  tumbles: number;
  /** Presses that wobbled the fort instead of adding a pillow. */
  slips: number;
}

export type PillowResult = 'stacked' | 'same' | 'fast' | 'tumble' | 'ignored';

export function newFort(): Fort {
  return { pillows: 0, wobble: 0, last: null, lastAt: -Infinity, fluff: 0, tumbles: 0, slips: 0 };
}

/** Whose go it is: the partner who didn't place the last pillow (null: either may start). */
export function whoseTurn(f: Fort, solo = false): number | null {
  if (solo || f.last === null) return null;
  return f.last === 0 ? 1 : 0;
}

/**
 * One press of the Pillow! button by partner `member` (0 or 1) at `time` seconds. A team of one (`solo`) has no
 * partner to wait for, so only rushing counts against it.
 */
export function pressPillow(f: Fort, member: number, time: number, solo = false): PillowResult {
  if (f.fluff > 0) return 'ignored';
  const same = !solo && f.last === member;
  const fast = !same && time - f.lastAt < PILLOW.minGap;
  if (!same && !fast) {
    f.pillows += 1;
    f.last = member;
    f.lastAt = time;
    return 'stacked';
  }
  f.slips += 1;
  // An empty floor can't wobble.
  if (f.pillows === 0) return same ? 'same' : 'fast';
  f.wobble += (same ? PILLOW.sameWobble : PILLOW.fastWobble) * (1 + f.pillows / PILLOW.tallness);
  if (f.wobble >= PILLOW.topple) {
    f.pillows -= 1;
    f.tumbles += 1;
    f.wobble = PILLOW.afterTumble;
    f.fluff = PILLOW.fluff;
    return 'tumble';
  }
  return same ? 'same' : 'fast';
}

/** The fort settles a little every second. */
export function stepFort(f: Fort, dt: number): void {
  f.wobble = Math.max(0, f.wobble - PILLOW.calm * dt);
  f.fluff = Math.max(0, f.fluff - dt);
}

/** A fort's score: its height, and on equal heights the steadier fort (fewer tumbles) wins. */
export function fortScore(f: Fort): number {
  return f.pillows * 100 - Math.min(99, f.tumbles);
}

/** Scores per seat: both partners get their fort's score. `teams` holds seat positions. */
export function pillowScores(forts: readonly Fort[], teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    const f = forts[i];
    if (!f) return;
    for (const m of members) if (m >= 0 && m < seats) scores[m] = fortScore(f);
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

/**
 * Seconds a computer player waits after its partner's pillow before adding its own. Sharp ones keep a steady
 * rhythm just above the settle time; sleepy ones are slower and now and then rush in too early.
 */
export function cpuPillowGap(rng: Rng, skill: number): number {
  const s = Math.max(0, Math.min(1, skill));
  if (rng() < 0.03 + (1 - s) * 0.1) return PILLOW.minGap * (0.3 + rng() * 0.55);
  return PILLOW.minGap + 0.08 + (1 - s) * 0.4 + rng() * (0.12 + (1 - s) * 0.25);
}

/** Whether a computer player absent-mindedly goes again right after its own pillow. */
export function cpuDoubles(rng: Rng, skill: number): boolean {
  const s = Math.max(0, Math.min(1, skill));
  return rng() < 0.015 + (1 - s) * 0.07;
}
