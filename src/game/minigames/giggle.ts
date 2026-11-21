// Giggle Fit: everyone sinks into the couch to watch a very serious documentary. Silly things keep happening on
// and around the TV. Keep your phone still to keep a straight face: wobble for a moment and you crack up.
// The last one still composed wins; everyone scores the seconds they kept it together.
import { type Rng, shuffle } from '../rng';

export const GIGGLE = {
  duration: 40, // seconds at most
  settle: 2, // seconds to get comfy before wobbling counts
  threshold: 0.42, // wobble that tickles you at the start of the show…
  thresholdEnd: 0.24, // …and by the end, when everyone is barely holding it together
  sillyFactor: 0.75, // during a silly moment the threshold drops by this factor: even a twitch counts
  rise: 2.2, // giggle per second just over the threshold (about half a second of wobbling cracks you)
  calm: 0.6, // giggle that fades per second while you're composed
  warn: 0.45, // giggle level where the phone buzzes a warning
  firstSilly: 3.5, // seconds into the show before the first silly moment
  sillyLength: 3, // seconds a silly moment lasts
  gap: [2.4, 4.4] as const, // seconds between one silly moment and the next
  lastOne: 3, // seconds the last composed player keeps sitting once everyone else cracked
} as const;

export const SILLIES = ['duck', 'puppet', 'cat', 'googly', 'antenna', 'vacuum'] as const;
export type Silly = (typeof SILLIES)[number];

export interface SillyMoment {
  at: number;
  kind: Silly;
}

/** When the silly moments happen and which ones: every kind once before any repeats, never the same twice in a row. */
export function sillySchedule(rng: Rng, duration: number = GIGGLE.duration): SillyMoment[] {
  const out: SillyMoment[] = [];
  let bag: Silly[] = [];
  let last: Silly | null = null;
  let at: number = GIGGLE.firstSilly;
  while (at < duration - 1) {
    if (bag.length === 0) {
      bag = shuffle(rng, SILLIES);
      if (bag[0] === last) bag.push(bag.shift() as Silly);
    }
    const kind = bag.shift() as Silly;
    out.push({ at, kind });
    last = kind;
    at += GIGGLE.sillyLength + GIGGLE.gap[0] + rng() * (GIGGLE.gap[1] - GIGGLE.gap[0]);
  }
  return out;
}

/** The silly moment going on at time t, if any. */
export function sillyAt(schedule: readonly SillyMoment[], t: number): SillyMoment | null {
  return schedule.find((m) => t >= m.at && t < m.at + GIGGLE.sillyLength) ?? null;
}

/** How much wobble a player can get away with: less and less as the show goes on, and less during a silly moment. */
export function threshold(t: number, silly: boolean): number {
  const k = Math.min(1, Math.max(0, t / GIGGLE.duration));
  const base = GIGGLE.threshold + (GIGGLE.thresholdEnd - GIGGLE.threshold) * k;
  return silly ? base * GIGGLE.sillyFactor : base;
}

export interface Sitter {
  /** 0 composed … 1 cracked up. */
  giggle: number;
  crackedAt: number | null;
}

export function newSitter(): Sitter {
  return { giggle: 0, crackedAt: null };
}

/** One step for one player. Returns true on the step they crack up. */
export function stepSitter(s: Sitter, wobble: number, dt: number, t: number, silly: boolean): boolean {
  if (s.crackedAt !== null) return false;
  if (t < GIGGLE.settle) {
    s.giggle = 0;
    return false;
  }
  const th = threshold(t, silly);
  if (wobble > th) s.giggle += GIGGLE.rise * (1 + 2 * (wobble - th)) * dt;
  else s.giggle = Math.max(0, s.giggle - GIGGLE.calm * dt);
  if (s.giggle >= 1) {
    s.giggle = 1;
    s.crackedAt = t;
    return true;
  }
  return false;
}

/** 1 perfectly composed … 0 cracked up (for the meter over each head). */
export function composure(s: Sitter): number {
  return s.crackedAt !== null ? 0 : Math.max(0, 1 - s.giggle);
}

/** Seconds each player kept a straight face (to a tenth); whoever never cracked counts until the end. */
export function giggleScores(sitters: readonly Sitter[], end: number): number[] {
  return sitters.map((s) => Math.round((s.crackedAt ?? end) * 10) / 10);
}

// ------------------------------------------------------------------ computer players

/** A computer player's face: mostly still, with the odd fit of giggles that silly moments make far more likely. */
export interface CpuSitter {
  /** Seconds left in the current fit of giggles. */
  fit: number;
  /** How hard the current fit shakes them. */
  level: number;
}

export function newCpuSitter(): CpuSitter {
  return { fit: 0, level: 0 };
}

/** The wobble a computer player "sends" this step. skill: 0 sleepy (giggly) … 1 sharp (stone-faced). */
export function cpuWobble(c: CpuSitter, rng: Rng, skill: number, dt: number, t: number, silly: boolean): number {
  if (c.fit > 0) {
    c.fit -= dt;
    return Math.max(0, c.level + (rng() - 0.5) * 0.1);
  }
  const pace = 0.008 + 0.045 * Math.min(1, t / GIGGLE.duration);
  const hazard = pace * (silly ? 6 : 1) * (1.7 - skill);
  if (rng() < hazard * dt) {
    c.fit = 0.2 + rng() * 0.45 * (1.4 - skill);
    c.level = 0.25 + rng() * (0.4 + 0.2 * (1 - skill));
    return c.level;
  }
  return 0.03 + rng() * 0.1 * (1.3 - skill);
}
