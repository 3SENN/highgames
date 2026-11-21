// Mirror Mirror: in each team one partner leads a round. Their phone shows a secret run of three to five poses;
// they press them and their companion strikes each pose on the TV, one after the other. The partner watches and
// copies the run on their own phone. Every right copy scores, a quick one a little more. The roles swap every round,
// four rounds, both teams at the same time.
import type { Rng } from '../rng.js';

export const POSES = ['Arms up', 'Wave', 'Spin', 'Squat'] as const;

export const MIRROR = {
  rounds: 4,
  lengths: [3, 4, 4, 5] as readonly number[],
  pose: 0.7, // seconds a companion takes to strike one pose (poses pressed quicker wait their turn)
  base: 4, // a round lasts at most base + perPose × poses seconds
  perPose: 1.3,
  copy: 10, // points for a right copy
  quick: 5, // extra points for a copy straight away, fading to none
  quickIn: 0.8, // seconds after the pose showed that still get the full extra
  slowAt: 3, // ...and from here on none
  gap: 1.8, // seconds between rounds
} as const;

/** The most a round lasts. */
export function roundTime(len: number): number {
  return MIRROR.base + MIRROR.perPose * len;
}

/** A secret run of `len` poses, never the same pose twice in a row (so every move can be seen). */
export function makeRun(rng: Rng, len: number): number[] {
  const run: number[] = [];
  while (run.length < len) {
    const last = run[run.length - 1];
    const options = POSES.map((_, i) => i).filter((i) => i !== last);
    run.push(options[Math.floor(rng() * options.length)] ?? 0);
  }
  return run;
}

/** One team's round. */
export interface Mirror {
  run: number[];
  /** When each pose the leader has pressed shows on the TV. */
  shownAt: number[];
  /** For each pose copied so far: right or not. */
  copies: boolean[];
  points: number;
}

export function newMirror(run: number[]): Mirror {
  return { run, shownAt: [], copies: [], points: 0 };
}

/**
 * The leader pressed `pose` at `t`. Only the next pose of the run counts ('wrong' presses are not shown). A pose
 * shows as soon as the one before has finished.
 */
export function leadPose(m: Mirror, pose: number, t: number): 'shown' | 'wrong' | 'done' {
  const k = m.shownAt.length;
  if (k >= m.run.length) return 'done';
  if (pose !== m.run[k]) return 'wrong';
  const prev = m.shownAt[k - 1];
  m.shownAt.push(prev === undefined ? t : Math.max(t, prev + MIRROR.pose));
  return 'shown';
}

/** Points for a right copy made `delay` seconds after the pose showed. */
export function copyPoints(delay: number): number {
  const k = (MIRROR.slowAt - delay) / (MIRROR.slowAt - MIRROR.quickIn);
  return MIRROR.copy + Math.round(MIRROR.quick * Math.max(0, Math.min(1, k)));
}

/**
 * The follower pressed `pose` at `t` (corrected for the phone's delay). It copies the next pose of the run, which
 * must have shown already ('early' presses don't count).
 */
export function copyPose(m: Mirror, pose: number, t: number): { result: 'right' | 'wrong' | 'early' | 'done'; points: number } {
  const k = m.copies.length;
  if (k >= m.run.length) return { result: 'done', points: 0 };
  const shown = m.shownAt[k];
  if (shown === undefined || t < shown) return { result: 'early', points: 0 };
  const right = pose === m.run[k];
  const points = right ? copyPoints(t - shown) : 0;
  m.copies.push(right);
  m.points += points;
  return { result: right ? 'right' : 'wrong', points };
}

export function isCopied(m: Mirror): boolean {
  return m.copies.length >= m.run.length;
}

export function rightCopies(m: Mirror): number {
  return m.copies.filter(Boolean).length;
}

/** Who leads round `round` in a team (member index): partners take turns. A team of one always copies. */
export function leaderOf(round: number, members: number): number | null {
  return members < 2 ? null : round % 2;
}

/** Scores per seat: both partners get their team's points. `teams` holds seat positions. */
export function mirrorScores(points: readonly number[], teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    for (const m of members) if (m >= 0 && m < seats) scores[m] = points[i] ?? 0;
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Seconds before a computer leader presses its next pose (`first`: the first of the round, after reading the run). */
export function cpuLeadGap(rng: Rng, skill: number, first: boolean): number {
  const s = clamp01(skill);
  return first ? 0.6 + (1 - s) * 0.7 + rng() * 0.4 : 0.35 + (1 - s) * 0.5 + rng() * 0.3;
}

/** Seconds after a pose shows before a computer follower copies it. */
export function cpuCopyDelay(rng: Rng, skill: number): number {
  const s = clamp01(skill);
  return 0.6 + (1 - s) * 0.8 + rng() * (0.3 + (1 - s) * 0.5);
}

/** Whether a computer follower copies the wrong pose (`step` into the run: later ones are harder to keep track of). */
export function cpuSlips(rng: Rng, skill: number, step: number): boolean {
  return rng() < 0.03 + (1 - clamp01(skill)) * 0.16 + step * 0.015;
}

/** A pose other than `pose`, for a slip. */
export function otherPose(rng: Rng, pose: number): number {
  const rest = POSES.map((_, i) => i).filter((i) => i !== pose);
  return rest[Math.floor(rng() * rest.length)] ?? 0;
}
