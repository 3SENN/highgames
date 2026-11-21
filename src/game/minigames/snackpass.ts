// Snack Pass: partners toss a bowl of chips back and forth across the living room. The thrower holds to wind up
// while a meter sweeps up and down, and lets go in the sweet spot; the catcher presses just as the bowl lands.
// Good passes add chips to the team bowl, sloppy tosses spill a few, and a dropped bowl spills a handful.
// Most chips when time runs out wins.
import type { Rng } from '../rng.js';

export const SNACK = {
  duration: 30, // seconds
  sweet: 0.8, // the meter value of a perfect toss
  perfect: 0.06, // within this of the sweet spot: perfect
  good: 0.15, // within this: a decent toss; further off: sloppy
  sweep: 1.1, // meter units per second (0 to full in about 0.9 s)
  sweepUp: 0.08, // the meter gets this much faster per pass in a streak…
  sweepCap: 6, // …up to this streak
  flight: 1.0, // seconds in the air for a perfect toss
  clean: 0.09, // catch within this many seconds of the landing: a clean catch
  window: 0.24, // within this: still a catch
  sloppyWindow: 0.7, // a sloppy toss wobbles in the air: the catch windows shrink to this share
  pause: 0.5, // seconds between a catch and the next wind-up
  autoToss: 4.5, // a thrower who never presses lobs it anyway after this long (always sloppy)
  lob: 0.35, // the meter value of that lob
  maxHold: 3, // a thrower who never lets go tosses after this long
  spill: 4, // chips lost when the bowl is dropped
  streakCap: 3, // most bonus chips a streak adds to one pass
} as const;

export type Toss = 'perfect' | 'good' | 'sloppy';
export type Catch = 'clean' | 'good' | 'miss';

const TOSS_CHIPS: Record<Toss, number> = { perfect: 3, good: 2, sloppy: -1 };
const CATCH_CHIPS: Record<Catch, number> = { clean: 2, good: 1, miss: 0 };

/** How fast the meter sweeps: a little faster with every pass in a streak. */
export function sweepSpeed(streak: number): number {
  return SNACK.sweep * (1 + SNACK.sweepUp * Math.min(Math.max(0, streak), SNACK.sweepCap));
}

/** The toss meter after holding for `heldFor` seconds: up from 0 to 1, back down to 0, and again. */
export function meterAt(heldFor: number, streak: number): number {
  const x = (Math.max(0, heldFor) * sweepSpeed(streak)) % 2;
  return x <= 1 ? x : 2 - x;
}

export function judgeToss(value: number): Toss {
  const off = Math.abs(value - SNACK.sweet);
  return off <= SNACK.perfect + 1e-9 ? 'perfect' : off <= SNACK.good + 1e-9 ? 'good' : 'sloppy';
}

/** Seconds the bowl is in the air: soft lobs hang longer, hard throws arrive sooner. */
export function flightTime(value: number): number {
  return SNACK.flight * (1 + (SNACK.sweet - Math.max(0, Math.min(1, value))) * 0.45);
}

/** How long after the landing a catch still counts (and how early before it). */
export function catchWindow(toss: Toss): number {
  return SNACK.window * (toss === 'sloppy' ? SNACK.sloppyWindow : 1);
}

/** A catch press `offset` seconds after the landing (negative: before it); null when nobody pressed. */
export function judgeCatch(offset: number | null, toss: Toss): Catch {
  if (offset === null) return 'miss';
  const k = toss === 'sloppy' ? SNACK.sloppyWindow : 1;
  const off = Math.abs(offset);
  return off <= SNACK.clean * k + 1e-9 ? 'clean' : off <= SNACK.window * k + 1e-9 ? 'good' : 'miss';
}

export interface Bowl {
  chips: number;
  /** Good passes in a row. */
  streak: number;
  passes: number;
  drops: number;
  bestStreak: number;
}

export function newBowl(): Bowl {
  return { chips: 0, streak: 0, passes: 0, drops: 0, bestStreak: 0 };
}

/** Chips a caught pass adds before the bowl is applied (can be negative after a sloppy toss). */
export function passChips(toss: Toss, caught: Catch, streak: number): number {
  if (caught === 'miss') return -SNACK.spill;
  return TOSS_CHIPS[toss] + CATCH_CHIPS[caught] + Math.min(Math.max(0, streak), SNACK.streakCap);
}

/** Applies one pass to the team bowl. Returns the change in chips (the bowl never goes below zero). */
export function applyPass(b: Bowl, toss: Toss, caught: Catch): number {
  const delta = Math.max(b.chips > 0 ? -b.chips : 0, passChips(toss, caught, b.streak));
  b.chips += delta;
  if (caught === 'miss') {
    b.drops += 1;
    b.streak = 0;
  } else {
    b.passes += 1;
    b.streak = toss === 'sloppy' ? 0 : b.streak + 1;
    b.bestStreak = Math.max(b.bestStreak, b.streak);
  }
  return delta;
}

/** A bowl's score: its chips, and on equal chips the team with more passes wins. */
export function bowlScore(b: Bowl): number {
  return b.chips * 100 + Math.min(99, b.passes);
}

/** Scores per seat: both partners get their bowl's score. `teams` holds seat positions. */
export function snackScores(bowls: readonly Bowl[], teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    const b = bowls[i];
    if (!b) return;
    for (const m of members) if (m >= 0 && m < seats) scores[m] = bowlScore(b);
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

/** Roughly bell-shaped noise with a standard deviation of about 1. */
function wobble(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 2;
}

/** The meter value a computer thrower lets go at: sharp ones land near the sweet spot. */
export function cpuTossValue(rng: Rng, skill: number): number {
  const s = Math.max(0, Math.min(1, skill));
  return Math.max(0.02, Math.min(1, SNACK.sweet + wobble(rng) * (0.035 + (1 - s) * 0.13)));
}

/** When a computer catcher presses, in seconds after the landing (negative: before it). */
export function cpuCatchOffset(rng: Rng, skill: number, toss: Toss): number {
  const s = Math.max(0, Math.min(1, skill));
  return wobble(rng) * (0.035 + (1 - s) * 0.16) * (toss === 'sloppy' ? 1.3 : 1);
}
