// Late Night Radio: everyone has an old radio on the windowsill and a fader on their phone. Somewhere on the dial
// (the same spot for everyone, a new one each round) a little station is playing. The closer your fader gets,
// the clearer YOUR radio comes in on the TV. Hold it inside the station's band to lock in: first three score.
import { type Rng, shuffle } from '../rng.js';

export const RADIO = {
  rounds: 4,
  roundTime: 11, // seconds per station
  band: 0.03, // how close to the station counts as tuned in, either side (fader units)
  range: 0.2, // how far away the station starts to come through
  lockTime: 1.5, // seconds to hold inside the band
  points: [3, 2, 1],
  edge: 0.1, // stations stay this far from the ends of the dial
  minMove: 0.25, // each station is at least this far from the one before
  startGap: 0.3, // the fader starts at least this far from the station
  /** After this many lock in, nobody else can score: the round ends. */
  scorers: 3,
} as const;

export const STATION_NAMES = ['Night Owl FM', 'Sofa Sounds', 'Moonbeam Radio', 'Kettle FM', 'Slow Wave', 'Blanket Radio'] as const;

export interface Station {
  /** Where on the dial, 0..1 of the fader. */
  at: number;
  /** Where everyone's fader starts. */
  start: number;
  name: string;
  /** Which little tune it plays. */
  tune: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The dial's frequency for a fader value, 88.0 to 108.0. */
export function freqOf(value: number): string {
  return (88 + clamp01(value) * 20).toFixed(1);
}

/** One station per round: inside the dial, well apart from the last one, with a start far from it. */
export function planStations(rng: Rng, rounds: number = RADIO.rounds): Station[] {
  const names = shuffle(rng, STATION_NAMES);
  const out: Station[] = [];
  let last = -1;
  for (let r = 0; r < rounds; r++) {
    let at = RADIO.edge + rng() * (1 - 2 * RADIO.edge);
    for (let k = 0; k < 40 && last >= 0 && Math.abs(at - last) < RADIO.minMove; k++) at = RADIO.edge + rng() * (1 - 2 * RADIO.edge);
    if (last >= 0 && Math.abs(at - last) < RADIO.minMove) at = last < 0.5 ? Math.min(1 - RADIO.edge, last + RADIO.minMove) : Math.max(RADIO.edge, last - RADIO.minMove);
    let start = rng();
    for (let k = 0; k < 40 && Math.abs(start - at) < RADIO.startGap; k++) start = rng();
    if (Math.abs(start - at) < RADIO.startGap) start = at < 0.5 ? 1 : 0;
    start = Math.round(start * 1000) / 1000;
    out.push({ at, start, name: names[r % names.length] as string, tune: r % 4 });
    last = at;
  }
  return out;
}

/** How clearly the station comes through at fader value `value`: 0 (only static) to 1 (spot on). */
export function clarity(value: number, station: number): number {
  const d = Math.abs(value - station);
  if (d >= RADIO.range) return 0;
  return (1 - d / RADIO.range) ** 2;
}

export function inBand(value: number, station: number): boolean {
  return Math.abs(value - station) <= RADIO.band;
}

export interface Tuner {
  value: number;
  /** When the fader last came into the band (null: outside it). */
  since: number | null;
  /** When it locked in (null: not yet). */
  lockedAt: number | null;
}

export function newTuner(value: number): Tuner {
  return { value, since: null, lockedAt: null };
}

/**
 * The fader moved to `value` at time `at` (for a phone: when the message arrived, minus half its round trip).
 * Ignored once locked in.
 */
export function moveTuner(t: Tuner, value: number, at: number, station: number): void {
  if (t.lockedAt !== null) return;
  t.value = clamp01(value);
  if (!inBand(t.value, station)) t.since = null;
  else if (t.since === null) t.since = at;
}

/** Checks the hold at time `now`: true the moment it locks in. */
export function checkLock(t: Tuner, now: number): boolean {
  if (t.lockedAt !== null || t.since === null) return false;
  if (now - t.since < RADIO.lockTime) return false;
  t.lockedAt = t.since + RADIO.lockTime;
  return true;
}

/** How far through the hold a tuner is, 0..1. */
export function lockProgress(t: Tuner, now: number): number {
  if (t.lockedAt !== null) return 1;
  if (t.since === null) return 0;
  return clamp01((now - t.since) / RADIO.lockTime);
}

/** Points for one station from each seat's lock-in time (null: never): first 3, then 2, then 1. Ties share. */
export function lockPoints(lockedAt: readonly (number | null)[]): number[] {
  const sorted = lockedAt.filter((t): t is number => t !== null).sort((a, b) => a - b);
  return lockedAt.map((t) => (t === null ? 0 : (RADIO.points[sorted.findIndex((x) => Math.abs(x - t) < 1e-9)] ?? 0)));
}

/** Total points first; equal points are broken by the total time it took to lock in. */
export function radioScores(points: readonly number[], totalTime: readonly number[]): number[] {
  return points.map((p, i) => p * 1000 - Math.min(999, totalTime[i] ?? 0));
}

// ------------------------------------------------------------------ computer players

export interface CpuTuner {
  value: number;
  /** wait: hasn't started; sweep: looking for a signal; notice: heard something (still moving); home: closing in; settle: checking. */
  phase: 'wait' | 'sweep' | 'notice' | 'home' | 'settle';
  timer: number;
  dir: number;
  aim: number;
  speed: number;
  skill: number;
  tries: number;
}

/** A standard normal number (Box-Muller). */
function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function newCpuTuner(rng: Rng, start: number, skill: number): CpuTuner {
  const k = clamp01(skill);
  // Most head for the open side of the dial first; some go the other way and bounce back.
  const open = start < 0.5 ? 1 : -1;
  return {
    value: start,
    phase: 'wait',
    timer: 0.3 + (1 - k) * 0.7 + rng() * 0.9,
    dir: rng() < 0.45 + 0.35 * k ? open : -open,
    aim: start,
    speed: (0.18 + k * 0.18) * (0.7 + rng() * 0.6),
    skill: k,
    tries: rng() < 0.3 * (1 - k) ? -1 : 0, // -1: not paying attention, notices late
  };
}

/** Moves a computer player's fader like a person would: sweep, hear something, overshoot a bit, home in, hold. */
export function stepCpuTuner(c: CpuTuner, rng: Rng, station: number, dt: number): number {
  const STEP = 1 / 60;
  for (let left = dt; left > 1e-9; left -= STEP) {
    const h = Math.min(STEP, left);
    switch (c.phase) {
      case 'wait':
        c.timer -= h;
        if (c.timer <= 0) c.phase = 'sweep';
        break;
      case 'sweep':
      case 'notice':
        c.value += c.dir * c.speed * h;
        if (c.value >= 1 || c.value <= 0) {
          c.value = clamp01(c.value);
          c.dir = -c.dir;
        }
        if (c.phase === 'sweep' && clarity(c.value, station) > 0.04 + (1 - c.skill) * 0.12) {
          if (c.tries < 0) {
            if (inBand(c.value, station)) c.tries = 0; // only notices when it's right on it, and overshoots
            break;
          }
          c.phase = 'notice';
          c.timer = 0.12 + (1 - c.skill) * 0.3 + rng() * 0.2;
        } else if (c.phase === 'notice') {
          c.timer -= h;
          if (c.timer <= 0) aimAgain(c, rng, station);
        }
        break;
      case 'home': {
        // Quick while far, slowing down for the last bit, as a thumb would.
        const gap = c.aim - c.value;
        const vel = c.speed * 1.5 * Math.min(1, Math.max(0.15, Math.abs(gap) * 8));
        c.value = clamp01(c.value + Math.sign(gap) * Math.min(Math.abs(gap), vel * h));
        if (Math.abs(c.aim - c.value) < 0.002) {
          c.phase = 'settle';
          c.timer = 0.2 + (1 - c.skill) * 0.25 + rng() * 0.2;
        }
        break;
      }
      case 'settle':
        if (inBand(c.value, station)) break; // hold still and let it lock in
        c.timer -= h;
        if (c.timer <= 0) aimAgain(c, rng, station);
        break;
    }
  }
  return c.value;
}

function aimAgain(c: CpuTuner, rng: Rng, station: number): void {
  const spread = (0.015 + (1 - c.skill) * 0.045) * 0.65 ** c.tries;
  c.tries++;
  c.aim = clamp01(station + gauss(rng) * spread);
  c.phase = 'home';
}
