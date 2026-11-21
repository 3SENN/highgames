// Group Selfie: everyone squeezes onto one couch for a group photo on a timer camera standing on the coffee table.
// Six photos, each with a 3-2-1 countdown; at the click the camera exposes for 0.4 s, and anyone whose phone wobbles
// during that time comes out blurred. Between the counts a photobomber may turn up (a pigeon at the window, the cat
// walking across the table, a cushion falling off the back of the couch): it's only funny, but don't flinch.
// The group's result is the share of sharp faces over all the photos.
import { type Rng, shuffle } from '../rng';

export const SELFIE = {
  photos: 6,
  threshold: 0.15, // wobble at or above this during the exposure blurs you
  exposure: 0.4, // seconds the shutter is open
  firstSettle: 0.8, // seconds before the first countdown
  settle: [1.0, 1.4] as const, // seconds to wriggle between one photo and the next countdown
  count: [0.72, 0.9] as const, // seconds per number of the 3-2-1
  review: 1.9, // seconds the photo is on show after the exposure
  grace: 0.15, // the shot is judged this long after the exposure, for phone messages still on the way
  bombers: 4, // photos with a photobomber in them
} as const;

export type Bomber = 'pigeon' | 'cat' | 'cushion';
export const BOMBERS: readonly Bomber[] = ['pigeon', 'cat', 'cushion'];

export const BOMBER_INFO: Record<Bomber, { label: string }> = {
  pigeon: { label: 'A pigeon at the window!' },
  cat: { label: 'The cat is on the table…' },
  cushion: { label: 'A cushion is falling!' },
};

/** One photo's timeline, in game seconds from the start of the game. */
export interface Shot {
  index: number;
  /** The 3-2-1 starts. */
  countAt: number;
  /** Seconds per number. */
  beat: number;
  /** The click: the exposure runs from here for SELFIE.exposure. */
  clickAt: number;
  /** The photo is shown until here; the next one's wriggle time starts. */
  end: number;
  bomber: Bomber | null;
  /** When the photobomber makes its entrance (its noise: the moment to not flinch). */
  bomberAt: number;
  /** For the cushion: whose head it lands on (a position in the row). */
  victim: number;
}

export function planShoot(rng: Rng, players: number): Shot[] {
  const n = Math.max(1, players);
  // Photobombers on some photos (never the first), every kind at least once.
  const which = shuffle(rng, [1, 2, 3, 4, 5]).slice(0, SELFIE.bombers);
  const kinds = shuffle(rng, [...BOMBERS, BOMBERS[Math.floor(rng() * BOMBERS.length)] as Bomber]);
  const shots: Shot[] = [];
  let at: number = SELFIE.firstSettle;
  for (let i = 0; i < SELFIE.photos; i++) {
    if (i > 0) at += SELFIE.settle[0] + rng() * (SELFIE.settle[1] - SELFIE.settle[0]);
    const beat = SELFIE.count[0] + rng() * (SELFIE.count[1] - SELFIE.count[0]);
    const countAt = at;
    const clickAt = countAt + beat * 3;
    const k = which.indexOf(i);
    const bomber = k >= 0 ? (kinds[k] as Bomber) : null;
    const bomberAt = bomber ? clickAt - 1.3 + rng() * 1.05 : 0;
    shots.push({ index: i, countAt, beat, clickAt, end: clickAt + SELFIE.exposure + SELFIE.review, bomber, bomberAt, victim: Math.floor(rng() * n) });
    at = clickAt + SELFIE.exposure + SELFIE.review;
  }
  return shots;
}

/** How long the whole shoot takes. */
export function shootLength(shots: readonly Shot[]): number {
  return shots[shots.length - 1]?.end ?? 0;
}

/** Which part of a photo we're in at `t`: wriggling, counting down, exposing, or showing the photo. */
export type ShotPhase = 'wriggle' | 'count' | 'expose' | 'show';

export function phaseAt(shot: Shot, t: number): ShotPhase {
  if (t < shot.countAt) return 'wriggle';
  if (t < shot.clickAt) return 'count';
  if (t < shot.clickAt + SELFIE.exposure) return 'expose';
  return 'show';
}

/** The shot being taken (or shown) at `t`. */
export function shotAt(shots: readonly Shot[], t: number): Shot | null {
  return shots.find((s) => t < s.end) ?? null;
}

/** The number on the countdown at `t` (3, 2, 1), or 0 outside it. */
export function countdownAt(shot: Shot, t: number): number {
  if (t < shot.countAt || t >= shot.clickAt) return 0;
  return 3 - Math.floor((t - shot.countAt) / shot.beat);
}

export interface Sample {
  /** Game seconds when the phone measured it (half the round trip already taken off). */
  at: number;
  wobble: number;
}

export interface ShotJudgement {
  sharp: boolean;
  /** The most it wobbled while the shutter was open. */
  peak: number;
}

/**
 * Was this seat still for the exposure? Looks at its wobble right at the click (the latest sample before it) and
 * everything measured while the shutter was open. No samples at all counts as still.
 */
export function judgeShot(samples: readonly Sample[], clickAt: number): ShotJudgement {
  let peak = 0;
  let before: Sample | null = null;
  for (const s of samples) {
    if (s.at <= clickAt) {
      if (!before || s.at >= before.at) before = s;
    } else if (s.at <= clickAt + SELFIE.exposure) peak = Math.max(peak, s.wobble);
  }
  if (before) peak = Math.max(peak, before.wobble);
  return { sharp: peak < SELFIE.threshold, peak };
}

/** Sharp faces over every face in every photo. */
export function selfieCoop(results: readonly (readonly boolean[])[]): number {
  let sharp = 0;
  let total = 0;
  for (const photo of results) {
    for (const ok of photo) {
      total += 1;
      if (ok) sharp += 1;
    }
  }
  return total ? sharp / total : 0;
}

// ------------------------------------------------------------------ computer players

export interface SelfieCpu {
  fidget: number;
}

export function newSelfieCpu(): SelfieCpu {
  return { fidget: 0 };
}

/**
 * The wobble a computer player "sends". Between photos they wriggle about; in the countdown they settle and hold a
 * steady hand, with now and then a fidget, and a startle when a photobomber turns up. Sleepy ones (skill 0) settle
 * slower, hold less still, fidget more and startle more.
 */
export function cpuSelfieWobble(c: SelfieCpu, skill: number, rng: Rng, dt: number, phase: ShotPhase, startle: boolean): number {
  c.fidget *= Math.exp(-dt * (2.6 + skill * 1.4));
  if (phase === 'wriggle' || phase === 'show') {
    if (rng() < dt * 3) c.fidget = Math.max(c.fidget, 0.2 + rng() * 0.45);
    return Math.min(1, 0.12 + rng() * 0.1 + c.fidget);
  }
  if (rng() < dt * (0.04 + (1 - skill) * 0.45)) c.fidget += 0.1 + rng() * 0.25 * (1.4 - skill);
  if (startle) c.fidget += (0.04 + (1 - skill) * 0.4) * (0.5 + rng());
  const steady = 0.02 + (1 - skill) * 0.08;
  return Math.min(1, steady * (0.6 + rng() * 0.8) + c.fidget);
}
