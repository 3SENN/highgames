// Laundry Fold: two partners fold a giant fitted sheet together. The TV shows the next fold as an arrow; both
// partners swipe that way within a moment of each other and the sheet folds neatly. Out of step, or the wrong way,
// and it balls up in a tangle for a bit. Four folds make a neat square, then a fresh sheet comes out of the basket.
// The most folds when time runs out wins.
import { type Rng, shuffle } from '../rng.js';

export type FoldDir = 'up' | 'down' | 'left' | 'right';

export const FOLD = {
  duration: 30, // seconds
  window: 0.6, // seconds between the partners' swipes that still counts as together
  tangle: 1.2, // seconds the sheet stays balled up
  settle: 0.35, // seconds a fold takes before the next arrow shows (swipes in between are ignored)
  square: 0.55, // extra seconds while a finished square goes on the pile and a fresh sheet comes out
  perSheet: 4, // folds that make a neat square: two across, two lengthways
} as const;

export interface Sheet {
  /** All folds so far: the score. */
  folds: number;
  /** Finished squares on the pile. */
  squares: number;
  tangles: number;
  /** Folds in a row without a tangle. */
  streak: number;
  /** Folds done on the sheet in hand (0 until perSheet - 1). */
  onSheet: number;
  /** The folds this sheet needs, in order. */
  plan: FoldDir[];
  /** The first partner's swipe, waiting for the other's. */
  pending: { member: number; at: number } | null;
  /** When the next arrow shows (after a fold or a tangle). */
  readyAt: number;
  /** The sheet is balled up until then. */
  tangledUntil: number;
}

/**
 * What a swipe did:
 *  - ignored   the sheet is busy folding or tangled (or the swipe came before the arrow)
 *  - wait      the first partner pulled; now the other one
 *  - fold      both pulled the right way together
 *  - square    that fold finished the sheet
 *  - wrong     a swipe the wrong way: tangle
 *  - mismatch  the partners pulled different ways: tangle
 *  - late      the second pull came too long after the first: tangle
 */
export type SwipeResult = 'ignored' | 'wait' | 'fold' | 'square' | 'wrong' | 'mismatch' | 'late';

export const TANGLES: readonly SwipeResult[] = ['wrong', 'mismatch', 'late'];

/** A sheet's folds: two across (left or right) and two lengthways (up or down), in any order. */
export function sheetPlan(rng: Rng): FoldDir[] {
  const across: FoldDir[] = [rng() < 0.5 ? 'left' : 'right', rng() < 0.5 ? 'left' : 'right'];
  const along: FoldDir[] = [rng() < 0.5 ? 'up' : 'down', rng() < 0.5 ? 'up' : 'down'];
  return shuffle(rng, [...across, ...along]);
}

export function newSheet(rng: Rng): Sheet {
  return { folds: 0, squares: 0, tangles: 0, streak: 0, onSheet: 0, plan: sheetPlan(rng), pending: null, readyAt: 0, tangledUntil: 0 };
}

/** The fold the arrow shows now. */
export function nextFold(s: Sheet): FoldDir {
  return s.plan[s.onSheet] ?? 'up';
}

/** True while the sheet shows an arrow and takes swipes. */
export function isReady(s: Sheet, now: number): boolean {
  return now >= s.readyAt && now >= s.tangledUntil;
}

function tangle(s: Sheet, now: number): void {
  s.tangles += 1;
  s.streak = 0;
  s.pending = null;
  s.tangledUntil = now + FOLD.tangle;
  s.readyAt = s.tangledUntil;
}

/**
 * Partner `member` swiped `dir`. `at` is when the finger moved (already corrected for the phone's delay), `now` is
 * the game's time. A team of one (`solo`) pulls both corners itself: two swipes the same way, quickly.
 */
export function swipeSheet(s: Sheet, member: number, dir: FoldDir, at: number, now: number, rng: Rng, solo = false): SwipeResult {
  if (at < s.readyAt || now < s.tangledUntil) return 'ignored';
  const p = s.pending;
  if (dir !== nextFold(s)) {
    const result = p && p.member !== member ? 'mismatch' : 'wrong';
    tangle(s, now);
    return result;
  }
  if (!p) {
    s.pending = { member, at };
    return 'wait';
  }
  if (p.member === member && !solo) {
    // The same partner pulling again: they are just keen. It counts from the latest pull.
    p.at = at;
    return 'wait';
  }
  if (Math.abs(at - p.at) > FOLD.window) {
    tangle(s, now);
    return 'late';
  }
  s.pending = null;
  s.folds += 1;
  s.streak += 1;
  s.onSheet += 1;
  s.readyAt = now + FOLD.settle;
  if (s.onSheet < FOLD.perSheet) return 'fold';
  s.squares += 1;
  s.onSheet = 0;
  s.plan = sheetPlan(rng);
  s.readyAt += FOLD.square;
  return 'square';
}

/**
 * One partner pulled and the other never did: once the window (plus `grace` for a swipe still on its way from the
 * phone) has passed, the sheet tangles. Returns true when that happened.
 */
export function expireSheet(s: Sheet, now: number, grace = 0): boolean {
  if (!s.pending || now - s.pending.at <= FOLD.window + grace) return false;
  tangle(s, now);
  return true;
}

/** A team's score: its folds, and on equal folds the tidier team (fewer tangles) wins. */
export function foldScore(s: Sheet): number {
  return s.folds * 100 - Math.min(99, s.tangles);
}

/** Scores per seat: both partners get their sheet's score. `teams` holds seat positions. */
export function foldScores(sheets: readonly Sheet[], teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    const s = sheets[i];
    if (!s) return;
    for (const m of members) if (m >= 0 && m < seats) scores[m] = foldScore(s);
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Seconds after the arrow shows before a computer player pulls on its own. */
export function cpuLead(rng: Rng, skill: number): number {
  const s = clamp01(skill);
  return 0.5 + (1 - s) * 0.6 + rng() * (0.3 + (1 - s) * 0.3);
}

/** Seconds after its partner's pull before a computer player pulls too. Sleepy ones are now and then too late. */
export function cpuFollow(rng: Rng, skill: number): number {
  const s = clamp01(skill);
  return 0.16 + (1 - s) * 0.26 + rng() * (0.18 + (1 - s) * 0.36);
}

/** Whether a computer player misreads the arrow this time. */
export function cpuMisreads(rng: Rng, skill: number): boolean {
  return rng() < 0.03 + (1 - clamp01(skill)) * 0.08;
}

/** A direction other than `dir`, for a misread arrow. */
export function otherDir(rng: Rng, dir: FoldDir): FoldDir {
  const all: FoldDir[] = ['up', 'down', 'left', 'right'];
  const rest = all.filter((d) => d !== dir);
  return rest[Math.floor(rng() * rest.length)] ?? 'up';
}
