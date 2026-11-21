// Slice It Fair: everyone has a pizza of their own, and the same order comes in for all ("A third, please").
// The fader swings your knife round clockwise from the 12 o'clock line (0..1 of the fader = 0..360 degrees);
// press Cut! to serve the slice between 12 o'clock and your knife. Closest to the order scores most.
import { type Rng, shuffle } from '../rng.js';

export const SLICE = {
  rounds: 4,
  cutTime: 9, // seconds to cut each round; whoever hasn't cut by then is cut where their knife is
  points: [3, 2, 1, 0],
  /** Orders in one game differ by at least this much of a pizza. */
  minGap: 0.05,
} as const;

export interface Order {
  /** What the TV says. */
  text: string;
  /** The share of the whole pizza asked for, 0..1. */
  share: number;
  /** The fraction, for the reveal ("1/3"). */
  label: string;
}

export const ORDERS: readonly Order[] = [
  { text: 'A third, please', share: 1 / 3, label: '1/3' },
  { text: 'Just a quarter', share: 1 / 4, label: '1/4' },
  { text: 'Two fifths for me', share: 2 / 5, label: '2/5' },
  { text: "Half. I'm starving", share: 1 / 2, label: '1/2' },
  { text: 'Three eighths, ta', share: 3 / 8, label: '3/8' },
  { text: "A sixth. I'm being good", share: 1 / 6, label: '1/6' },
  { text: 'Two thirds, go on then', share: 2 / 3, label: '2/3' },
  { text: 'Three quarters, cheers', share: 3 / 4, label: '3/4' },
  { text: 'Just a fifth', share: 1 / 5, label: '1/5' },
  { text: 'Five eighths, please', share: 5 / 8, label: '5/8' },
  { text: 'A tenth. Just a nibble', share: 1 / 10, label: '1/10' },
];

/**
 * The orders for one game: all different (at least SLICE.minGap apart), with at least one big one (more than
 * half) and at least two small ones, in a random order.
 */
export function planOrders(rng: Rng, rounds: number = SLICE.rounds): Order[] {
  const pool = shuffle(rng, ORDERS);
  const out: Order[] = [];
  const fits = (o: Order) => out.every((p) => Math.abs(p.share - o.share) >= SLICE.minGap);
  const big = pool.find((o) => o.share > 0.5);
  if (big && rounds > 0) out.push(big);
  for (const o of pool.filter((x) => x.share <= 0.5)) if (out.length < Math.min(rounds, 3) && fits(o)) out.push(o);
  for (const o of pool) if (out.length < rounds && !out.includes(o) && fits(o)) out.push(o);
  return shuffle(rng, out).slice(0, rounds);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The share of the pizza between 12 o'clock and a knife at fader value `value`. */
export function sliceShare(value: number): number {
  return clamp01(value);
}

/** The knife's angle, clockwise from 12 o'clock, in radians. */
export function knifeAngle(value: number): number {
  return clamp01(value) * Math.PI * 2;
}

/** How far a cut is from the order, as a share of the whole pizza. */
export function cutError(value: number, share: number): number {
  return Math.abs(sliceShare(value) - share);
}

/** Points for one round from each seat's error: closest 3, then 2, 1, 0. Equal errors share the better points. */
export function cutPoints(errors: readonly number[]): number[] {
  const sorted = [...errors].sort((a, b) => a - b);
  return errors.map((e) => SLICE.points[sorted.findIndex((x) => Math.abs(x - e) < 1e-9)] ?? 0);
}

/** Total points first; equal points are broken by the smaller total error. */
export function sliceScores(points: readonly number[], totalError: readonly number[]): number[] {
  return points.map((p, i) => p * 1000 - Math.min(999, (totalError[i] ?? 0) * 100));
}

/** A standard normal number (Box-Muller). */
export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** How wobbly a computer player's eye is, as a share of the pizza (one standard deviation). */
export function cpuSpread(skill: number): number {
  return 0.075 - 0.06 * clamp01(skill);
}

/**
 * A computer player's cut: the fader value it settles on (sharp ones are within a few percent, sleepy ones can be
 * well off) and when it presses Cut!, in seconds into the round.
 */
export function cpuCut(rng: Rng, share: number, skill: number): { value: number; at: number } {
  const k = clamp01(skill);
  const value = clamp01(share + gauss(rng) * cpuSpread(k));
  const at = Math.min(SLICE.cutTime - 0.6, 2 + (1 - k) * 2.6 + rng() * 2.4);
  return { value: Math.round(value * 1000) / 1000, at };
}
