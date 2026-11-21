// Couch Lock: everyone is sunk deep into a giant squishy beanbag. Pump your phone to wiggle your way up while
// the beanbag slowly swallows you back down. First to pop out and stand up wins; the rest rank by how far out
// they are when the time runs out.

export const COUCH = {
  duration: 25, // seconds
  goal: 100, // fully out of the beanbag
  perPump: 5, // progress per full-strength wiggle
  fullSwing: 0.25, // seconds since the last wiggle for a full one: frantic mashing counts for less
  sink: 3, // swallowed back per second, even at the bottom
  pull: 9, // extra swallow per second when nearly out: the last bit is the hardest
  comfyAfter: 1.2, // seconds without a wiggle before you get too comfy
  comfySink: 10, // extra sink per second while too comfy
} as const;

export interface Sinker {
  /** 0 (buried up to the ears) to COUCH.goal (popped out). */
  out: number;
  /** Game time of the last wiggle. */
  lastWiggle: number;
  finishedAt: number | null;
  wiggles: number;
}

export function newSinker(): Sinker {
  return { out: 0, lastWiggle: 0, finishedAt: null, wiggles: 0 };
}

/** One wiggle of the given strength (0..1) at game time `time`. Returns the progress it gained. */
export function wiggle(s: Sinker, power: number, time: number): number {
  if (s.finishedAt !== null) return 0;
  const swing = Math.min(1, Math.max(0.2, (time - s.lastWiggle) / COUCH.fullSwing));
  const gain = COUCH.perPump * Math.min(1, Math.max(0.25, power)) * swing;
  s.lastWiggle = time;
  s.wiggles += 1;
  s.out = Math.min(COUCH.goal, s.out + gain);
  if (s.out >= COUCH.goal) s.finishedAt = time;
  return gain;
}

/** True when this sinker has stopped wiggling long enough to get too comfy (and sinks faster). */
export function isComfy(s: Sinker, time: number): boolean {
  return s.finishedAt === null && time - s.lastWiggle > COUCH.comfyAfter;
}

export function stepSinker(s: Sinker, dt: number, time: number): void {
  if (s.finishedAt !== null) return;
  const sink = COUCH.sink + COUCH.pull * (s.out / COUCH.goal) + (isComfy(s, time) ? COUCH.comfySink : 0);
  s.out = Math.max(0, s.out - sink * dt);
}

/** Who popped out ranks by time, ahead of everyone still stuck; they rank by how far out they are. */
export function couchScores(sinkers: readonly Sinker[]): number[] {
  return sinkers.map((s) => (s.finishedAt !== null ? 10_000 - s.finishedAt * 100 : s.out));
}

/** A friendly word for how far out someone got. */
export function couchDetail(s: Sinker): string {
  if (s.finishedAt !== null) return `Popped out in ${s.finishedAt.toFixed(1)} s`;
  const pct = Math.round((s.out / COUCH.goal) * 100);
  if (pct >= 75) return `Almost up (${pct}%)`;
  if (pct >= 40) return `Halfway out (${pct}%)`;
  return `Fully sunk in (${pct}%)`;
}
