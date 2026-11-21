// Three-Legged Race: partners are tied together at the ankle and each one moves one leg. Steps have to alternate
// (A, B, A, B…). The same partner twice in a row, both at once, or a step hard on the heels of the last one makes
// the pair stumble and land on the grass for a moment. A quicker (but not frantic) rhythm runs faster.
// The first pair across the ribbon wins; if nobody makes it in time, the pair that got furthest.
import type { Rng } from '../rng.js';

export const LEGS = {
  duration: 40, // seconds before the race is called
  course: 56, // steps from the start line to the ribbon
  together: 0.12, // both partners within this many seconds: they trip over each other
  rush: 0.2, // a step this soon after the last one: too frantic, they trip
  fall: 1.0, // seconds on the grass after a stumble (steps are ignored meanwhile)
} as const;

export interface Pair {
  /** Good steps so far (LEGS.course reaches the ribbon). */
  steps: number;
  /** The partner (0 or 1) who took the last step, or null when either may go. */
  last: number | null;
  /** When the last step (or stumble) happened. */
  lastAt: number;
  /** Seconds left on the grass after a stumble. */
  down: number;
  stumbles: number;
  finishedAt: number | null;
}

/**
 * What a press of the Step button did: a step (or the step over the line), a stumble (same partner twice, both at
 * once, or rushing), or nothing (still on the grass, or already finished).
 */
export type StepResult = 'step' | 'finish' | 'same' | 'together' | 'rush' | 'down' | 'done';

export function newPair(): Pair {
  return { steps: 0, last: null, lastAt: -Infinity, down: 0, stumbles: 0, finishedAt: null };
}

export function isStumble(r: StepResult): boolean {
  return r === 'same' || r === 'together' || r === 'rush';
}

/** Whose step it is: the partner who didn't take the last one (null: either may go). */
export function whoseStep(p: Pair, solo = false): number | null {
  if (solo || p.last === null || p.down > 0 || p.finishedAt !== null) return null;
  return p.last === 0 ? 1 : 0;
}

/**
 * Partner `member` (0 or 1) presses Step at `time` seconds. A pair of one (`solo`) moves both legs itself, so only
 * rushing trips it up. Times may arrive slightly out of order (phones have different delays), so gaps are measured
 * either way.
 */
export function pressStep(p: Pair, member: number, time: number, solo = false): StepResult {
  if (p.finishedAt !== null) return 'done';
  if (p.down > 0) return 'down';
  const gap = Math.abs(time - p.lastAt);
  let trip: StepResult | null = null;
  if (!solo && p.last === member) trip = 'same';
  else if (!solo && p.last !== null && gap < LEGS.together) trip = 'together';
  else if (gap < LEGS.rush) trip = 'rush';
  if (trip) {
    p.stumbles += 1;
    p.down = LEGS.fall;
    p.last = null;
    p.lastAt = Math.max(p.lastAt, time);
    return trip;
  }
  p.steps += 1;
  p.last = member;
  p.lastAt = Math.max(p.lastAt, time);
  if (p.steps >= LEGS.course) {
    p.finishedAt = time;
    return 'finish';
  }
  return 'step';
}

/** Time passes: a stumbled pair gets back on its feet. */
export function stepPair(p: Pair, dt: number): void {
  p.down = Math.max(0, p.down - dt);
}

/** How far along the course, 0 (start line) to 1 (the ribbon). */
export function progress(p: Pair): number {
  return Math.min(1, p.steps / LEGS.course);
}

/** Finishers rank by time, ahead of everyone still running; they rank by how far they got. */
export function raceScore(p: Pair): number {
  if (p.finishedAt !== null) return 10_000 - Math.round(p.finishedAt * 100);
  return p.steps;
}

/** Scores per seat: both partners get their pair's score. `teams` holds seat positions. */
export function raceScores(pairs: readonly Pair[], teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    const p = pairs[i];
    if (!p) return;
    for (const m of members) if (m >= 0 && m < seats) scores[m] = raceScore(p);
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

/**
 * Seconds a computer player waits after its partner's step before taking its own. Sharp ones keep a quick, steady
 * rhythm just clear of the rush limit; sleepy ones plod, and now and then rush in and trip.
 */
export function cpuStepGap(rng: Rng, skill: number): number {
  const s = Math.max(0, Math.min(1, skill));
  if (rng() < 0.015 + (1 - s) * 0.05) return 0.06 + rng() * (LEGS.rush - 0.07);
  return LEGS.rush + 0.065 + (1 - s) * 0.16 + rng() * (0.06 + (1 - s) * 0.1);
}

/** Whether a computer player absent-mindedly steps again right after its own step. */
export function cpuDoubles(rng: Rng, skill: number): boolean {
  const s = Math.max(0, Math.min(1, skill));
  return rng() < 0.004 + (1 - s) * 0.02;
}
