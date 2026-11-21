// Takeout Tower: a takeout box swings on a little crane hook above each player's stack. Tap to drop it. Whatever
// hangs over the edge of the box below is cut off and tumbles away, so the boxes get narrower; a perfect drop
// keeps the box whole. The swing speeds up as the stack grows. Tallest stack after 30 seconds wins, and a box
// that misses the stack completely ends your tower.
import type { Rng } from '../rng';

export const TAKEOUT = {
  duration: 30, // seconds
  width: 1.3, // a whole box, side to side
  height: 0.42, // each box
  amp: 1.35, // how far the box swings either side of the top of the stack
  swing: 1.9, // swing speed at the start (radians a second)
  speedUp: 0.05, // the swing gets this much faster for every box on the stack…
  maxSpeed: 2.2, // …up to this many times the start speed
  perfect: 0.1, // a drop this close to the box below counts as perfect: nothing is cut
  minWidth: 0.1, // a box cut narrower than this doesn't stay up
  firstHook: 0.4, // seconds before the first box swings
  rehook: 0.65, // seconds from a drop until the next box swings
} as const;

export interface Placed {
  /** Centre, from the middle of the player's spot. */
  x: number;
  w: number;
  perfect: boolean;
}

export interface Stack {
  /** boxes[0] is the plate everything stands on. */
  boxes: Placed[];
  /** When the box on the hook started swinging (null while the crane fetches the next one). */
  hookedAt: number | null;
  /** The next box is on the hook from this time. */
  nextHook: number;
  /** The side the box on the hook started from (it alternates). */
  side: 1 | -1;
  done: boolean;
  doneAt: number | null;
  perfects: number;
  streak: number;
  bestStreak: number;
}

export function newStack(): Stack {
  return {
    boxes: [{ x: 0, w: TAKEOUT.width, perfect: true }],
    hookedAt: null,
    nextHook: TAKEOUT.firstHook,
    side: 1,
    done: false,
    doneAt: null,
    perfects: 0,
    streak: 0,
    bestStreak: 0,
  };
}

export function topOf(s: Stack): Placed {
  return s.boxes[s.boxes.length - 1] as Placed;
}

/** Boxes stacked (not counting the plate). */
export function stacked(s: Stack): number {
  return s.boxes.length - 1;
}

/** Swing speed (radians a second) for the box on the hook. */
export function swingSpeed(s: Stack): number {
  return TAKEOUT.swing * Math.min(TAKEOUT.maxSpeed, 1 + TAKEOUT.speedUp * stacked(s));
}

/** Where the box on the hook is at time t (the crane sits over the top of the stack). */
export function swingX(s: Stack, t: number): number {
  const top = topOf(s);
  if (s.hookedAt === null) return top.x + s.side * TAKEOUT.amp;
  return top.x + s.side * TAKEOUT.amp * Math.cos(swingSpeed(s) * Math.max(0, t - s.hookedAt));
}

/** Hangs the next box on the hook once the crane is back. Returns true when it did. */
export function stepStack(s: Stack, t: number): boolean {
  if (s.done || s.hookedAt !== null || t < s.nextHook) return false;
  s.hookedAt = s.nextHook;
  return true;
}

export type DropResult =
  | { kind: 'perfect'; box: Placed; from: number }
  /** `cut` is the piece that hung over the edge and falls away. */
  | { kind: 'cut'; box: Placed; cut: { x: number; w: number }; from: number }
  /** The box missed (or was cut to almost nothing): the tower is finished. */
  | { kind: 'miss'; fall: { x: number; w: number }; from: number };

/** Drops the box on the hook as it was at time t. Null when there's no box on the hook. */
export function drop(s: Stack, t: number): DropResult | null {
  if (s.done || s.hookedAt === null) return null;
  const when = Math.max(s.hookedAt, t);
  const top = topOf(s);
  const x = swingX(s, when);
  const off = x - top.x;
  s.hookedAt = null;
  s.nextHook = when + TAKEOUT.rehook;
  s.side = s.side === 1 ? -1 : 1;
  if (Math.abs(off) <= TAKEOUT.perfect) {
    const box = { x: top.x, w: top.w, perfect: true };
    s.boxes.push(box);
    s.perfects += 1;
    s.streak += 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    return { kind: 'perfect', box, from: x };
  }
  s.streak = 0;
  const w = top.w - Math.abs(off);
  if (w < TAKEOUT.minWidth) {
    s.done = true;
    s.doneAt = when;
    return { kind: 'miss', fall: { x, w: top.w }, from: x };
  }
  // What stays is the overlap with the box below; the rest is cut off on the side it overhung.
  const box = { x: top.x + off / 2, w, perfect: false };
  s.boxes.push(box);
  const side = Math.sign(off);
  return { kind: 'cut', box, cut: { x: box.x + side * (w / 2 + Math.abs(off) / 2), w: Math.abs(off) }, from: x };
}

/** Taller stacks rank first; perfect drops break ties. */
export function takeoutScores(stacks: readonly Stack[]): number[] {
  return stacks.map((s) => stacked(s) * 100 + s.perfects);
}

// ------------------------------------------------------------------ computer players

/** Roughly normal (mean 0, sd 1). */
function gauss(rng: Rng): number {
  return (rng() + rng() + rng() + rng() - 2) * Math.sqrt(3);
}

/**
 * When a computer player will drop the box that just went on the hook: as it swings through the middle, after
 * a moment to settle in (a sleepy one sometimes lets a swing go by), off by a timing error that shrinks with skill.
 */
export function cpuDropAt(s: Stack, skill: number, rng: Rng): number {
  const hooked = s.hookedAt ?? s.nextHook;
  const w = swingSpeed(s);
  const settle = 0.25 + (1 - skill) * 0.55 * rng();
  // The box passes over the stack every half swing, starting a quarter swing in.
  let k = Math.max(0, Math.ceil((settle * w - Math.PI / 2) / Math.PI));
  if (rng() < (1 - skill) * 0.25) k += 1;
  const cross = hooked + (Math.PI / 2 + k * Math.PI) / w;
  return cross + gauss(rng) * (0.016 + 0.07 * (1 - skill));
}
