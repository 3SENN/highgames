// Paper Football: two phones lie top to top on the coffee table. Players take turns flicking a folded paper
// triangle from their own end with a swipe: it slides across their phone and onto the other one. Stop it with its
// tip hanging over the far edge for a touchdown (6) and a field goal kick through finger posts (1). Short of the
// edge, or off a side or the far end, and it's the other player's go. Most points after four flicks each.
import type { Rng } from '../rng.js';
import { PHONE_L, type Side, forwardOf } from './coasterhockey.js';

export const PAPER = {
  turns: 4, // flicks each
  shortTurns: 3, // three players play two matches in a row
  turnTime: 10, // seconds to flick before the go passes
  size: 0.32, // the triangle's side, in phone widths
  startGap: 0.45, // it starts this far from the flicker's own end
  decel: 2.6, // phone widths per second², sliding on glass
  refSpeed: 5, // a flick this fast (phone widths a second) slides exactly to the far edge
  spread: 0.6, // how much faster or slower flicks change the reach (on a log scale, so it stays controllable)
  minReach: 0.2,
  maxReach: 5.5,
  minStroke: 0.07, // shorter swipes are taps
  maxAngle: (55 * Math.PI) / 180, // flicks more sideways than this don't count
  window: 0.12, // seconds at the end of the stroke that set the flick
  grace: 0.04, // the middle may poke this far past the edge and still hang on
  touchdown: 6,
  fieldGoal: 1,
  postsFromEnd: 0.6, // the finger posts stand this far from the defender's end
  postGap: 0.24, // half the gap between them
  postShift: 0.12, // and they stand up to this far off the middle
  kickTime: 1.1, // seconds in the air
} as const;

/** From the triangle's middle to a corner. */
export const CORNER = PAPER.size / Math.sqrt(3);
/** Where a flick starts, along y, for `side`. */
export const startY = (side: Side) => -forwardOf(side) * (PHONE_L - PAPER.startGap);
/** How far the start is from the far edge. */
export const FIELD = 2 * PHONE_L - PAPER.startGap;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ------------------------------------------------------------------ reading a flick

export interface TouchSample {
  /** Field point. */
  x: number;
  y: number;
  /** Seconds. */
  t: number;
}

export type Flick = { ok: true; dx: number; dy: number; speed: number } | { ok: false; why: 'tap' | 'backwards' | 'sideways' };

/**
 * A swipe (touch down, moves, up; field points with times) as a flick for `side`: the direction of its last part
 * and how fast it went. Taps, backward and sideways swipes don't count.
 */
export function readFlick(samples: readonly TouchSample[], side: Side): Flick {
  const last = samples[samples.length - 1];
  const first = samples[0];
  if (!last || !first || samples.length < 2) return { ok: false, why: 'tap' };
  let from = first;
  for (const s of samples) {
    if (last.t - s.t <= PAPER.window) {
      from = s;
      break;
    }
  }
  if (from === last) from = samples[samples.length - 2] as TouchSample;
  const dx = last.x - from.x;
  const dy = last.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < PAPER.minStroke) return { ok: false, why: 'tap' };
  const ahead = (dy * forwardOf(side)) / len;
  if (ahead <= 0) return { ok: false, why: 'backwards' };
  if (Math.acos(clamp(ahead, -1, 1)) > PAPER.maxAngle) return { ok: false, why: 'sideways' };
  const dt = Math.max(0.05, last.t - from.t);
  return { ok: true, dx: dx / len, dy: dy / len, speed: len / dt };
}

/** How far a flick of this speed slides (or flies): `FIELD` at refSpeed, more or less on a log scale. */
export function reachOf(speed: number): number {
  const k = 1 + PAPER.spread * Math.log(Math.max(0.01, speed) / PAPER.refSpeed);
  return clamp(FIELD * k, PAPER.minReach, PAPER.maxReach);
}

/** The flick speed that slides `reach` far (the other way round, for computer players). */
export function speedFor(reach: number): number {
  return PAPER.refSpeed * Math.exp((reach / FIELD - 1) / PAPER.spread);
}

// ------------------------------------------------------------------ sliding

/**
 * touchdown: tip over the far edge, still on the phone; short: stopped on the other phone; own: never got across;
 * side: slid off a side; end: slid off the far end.
 */
export type SlideEnd = 'touchdown' | 'short' | 'own' | 'side' | 'end';

export interface Slide {
  side: Side;
  x0: number;
  y0: number;
  /** Unit direction. */
  ux: number;
  uy: number;
  v0: number;
  /** How far it goes before it stops or drops off. */
  reach: number;
  /** Seconds it moves. */
  time: number;
  end: SlideEnd;
  /** The tip's direction (radians, in field axes): the way it was flicked. */
  heading: number;
  /** How far towards the far edge its middle got (for breaking ties), or -Infinity when it fell off. */
  progress: number;
}

/** The three corners of the triangle with its middle at x, y and its tip towards `heading`. */
export function corners(x: number, y: number, heading: number): [number, number][] {
  return [0, 1, 2].map((k) => {
    const a = heading + (k * 2 * Math.PI) / 3;
    return [x + Math.cos(a) * CORNER, y + Math.sin(a) * CORNER] as [number, number];
  });
}

/** Time to cover `d` with constant braking from v0. */
function timeTo(d: number, v0: number): number {
  const a = PAPER.decel;
  return (v0 - Math.sqrt(Math.max(0, v0 * v0 - 2 * a * d))) / a;
}

/** Flicks the triangle from `side`'s start spot (or `from`) in direction (dx, dy) at `speed`. */
export function launchSlide(side: Side, dx: number, dy: number, speed: number, from?: { x: number; y: number }): Slide {
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  const x0 = from?.x ?? 0.5;
  const y0 = from?.y ?? startY(side);
  const full = reachOf(speed);
  const v0 = Math.sqrt(2 * PAPER.decel * full);
  const f = forwardOf(side);
  const heading = Math.atan2(uy, ux);
  // Where it leaves the table, if it does: the middle past a side, or past the far end (with a little grace).
  const toSide = ux > 1e-6 ? (1 - x0) / ux : ux < -1e-6 ? -x0 / ux : Infinity;
  const fwd = uy * f;
  const toEnd = fwd > 1e-6 ? (PHONE_L + PAPER.grace - y0 * f) / fwd : Infinity;
  let reach = full;
  let end: SlideEnd;
  if (toSide < full && toSide <= toEnd) {
    reach = toSide;
    end = 'side';
  } else if (toEnd < full) {
    reach = toEnd + 0.05;
    end = 'end';
  } else {
    const cy = (y0 + uy * full) * f;
    const tip = Math.max(...corners(x0 + ux * full, y0 + uy * full, heading).map(([, y]) => y * f));
    end = tip > PHONE_L ? 'touchdown' : cy > 0 ? 'short' : 'own';
  }
  const progress = end === 'side' || end === 'end' ? -Infinity : end === 'touchdown' ? PHONE_L : (y0 + uy * full) * f;
  return { side, x0, y0, ux, uy, v0, reach, time: timeTo(reach, v0), end, heading, progress };
}

/** Where the triangle is `t` seconds after the flick. */
export function slideAt(s: Slide, t: number): { x: number; y: number; moving: boolean } {
  const tt = clamp(t, 0, s.time);
  const d = Math.min(s.reach, s.v0 * tt - 0.5 * PAPER.decel * tt * tt);
  return { x: s.x0 + s.ux * d, y: s.y0 + s.uy * d, moving: t < s.time };
}

// ------------------------------------------------------------------ the field goal kick

export interface Posts {
  /** The middle between the uprights, and their line across the field. */
  x: number;
  y: number;
  gap: number;
}

/** The defender's finger posts, on the defender's phone (the kicker is `kicker`). */
export function makePosts(kicker: Side, rng: Rng): Posts {
  const y = forwardOf(kicker) * (PHONE_L - PAPER.postsFromEnd);
  return { x: 0.5 + (rng() * 2 - 1) * PAPER.postShift, y, gap: PAPER.postGap };
}

export interface Kick {
  side: Side;
  x0: number;
  y0: number;
  ux: number;
  uy: number;
  /** How far it flies before it lands. */
  reach: number;
  /** 0..1 of the flight when it passes the posts' line (Infinity: it lands short). */
  at: number;
  /** Where it crosses the posts' line. */
  crossX: number;
  result: 'good' | 'wide' | 'short';
}

export function launchKick(side: Side, dx: number, dy: number, speed: number, posts: Posts): Kick {
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  const x0 = 0.5;
  const y0 = startY(side);
  const reach = reachOf(speed);
  const f = forwardOf(side);
  const along = (posts.y - y0) * f; // forward distance to the posts' line
  const fwd = uy * f;
  const d = fwd > 1e-6 ? along / fwd : Infinity;
  const crossX = x0 + ux * (Number.isFinite(d) ? d : 0);
  const result = d > reach ? 'short' : Math.abs(crossX - posts.x) <= posts.gap ? 'good' : 'wide';
  return { side, x0, y0, ux, uy, reach, at: d > reach ? Infinity : d / reach, crossX, result };
}

/** Where the kicked triangle is at 0..1 of its flight, and how high (field units). */
export function kickAt(k: Kick, u: number): { x: number; y: number; h: number } {
  const v = clamp(u, 0, 1);
  return { x: k.x0 + k.ux * k.reach * v, y: k.y0 + k.uy * k.reach * v, h: 4 * 0.7 * v * (1 - v) };
}

// ------------------------------------------------------------------ a match

export interface PaperMatch {
  /** Who flicks each go, in order. */
  order: Side[];
  /** Index into `order` of the go being played. */
  turn: number;
  points: [number, number];
  touchdowns: [number, number];
  fieldGoals: [number, number];
  /** Furthest a flick got (for breaking ties). */
  best: [number, number];
}

export function newPaperMatch(first: Side, turnsEach: number = PAPER.turns): PaperMatch {
  const order: Side[] = [];
  for (let i = 0; i < turnsEach * 2; i++) order.push((i % 2 === 0 ? first : 1 - first) as Side);
  return { order, turn: 0, points: [0, 0], touchdowns: [0, 0], fieldGoals: [0, 0], best: [-Infinity, -Infinity] };
}

/** Whose go it is, or null when every go has been played. */
export function whoseGo(m: PaperMatch): Side | null {
  return m.order[m.turn] ?? null;
}

/** Counts a flick by `side`. */
export function scoreSlide(m: PaperMatch, side: Side, s: Slide): void {
  if (s.end === 'touchdown') {
    m.points[side] += PAPER.touchdown;
    m.touchdowns[side] += 1;
  }
  m.best[side] = Math.max(m.best[side], s.progress);
}

export function scoreKick(m: PaperMatch, side: Side, k: Kick): void {
  if (k.result !== 'good') return;
  m.points[side] += PAPER.fieldGoal;
  m.fieldGoals[side] += 1;
}

/** On to the next go. */
export function nextGo(m: PaperMatch): void {
  m.turn += 1;
}

/** The winner: most points, then the furthest flick, then a coin toss. */
export function paperWinner(m: PaperMatch, rng: Rng): Side {
  if (m.points[0] !== m.points[1]) return m.points[0] > m.points[1] ? 0 : 1;
  if (m.best[0] !== m.best[1]) return m.best[0] > m.best[1] ? 0 : 1;
  return rng() < 0.5 ? 0 : 1;
}

// ------------------------------------------------------------------ computer players

function gauss(rng: Rng): number {
  return (rng() + rng() + rng() + rng() - 2) * Math.sqrt(3);
}

/**
 * A computer player's flick: aimed at the middle of the touchdown window, straight down the field, with errors in
 * strength and direction that shrink as it gets sharper.
 */
export function cpuFlick(side: Side, skill: number, rng: Rng): { dx: number; dy: number; speed: number } {
  const s = clamp(skill, 0, 1);
  const f = forwardOf(side);
  const target = PHONE_L - (CORNER - PAPER.grace) / 2; // the middle's sweet spot
  const angle = gauss(rng) * (0.02 + 0.08 * (1 - s));
  const reach = (target - startY(side) * f) * (1 + gauss(rng) * (0.05 + 0.1 * (1 - s)));
  return { dx: Math.sin(angle), dy: Math.cos(angle) * f, speed: speedFor(reach / Math.cos(angle)) };
}

/** A computer player's field goal kick: through the middle of the posts, with plenty of leg. */
export function cpuKick(side: Side, posts: Posts, skill: number, rng: Rng): { dx: number; dy: number; speed: number } {
  const s = clamp(skill, 0, 1);
  const f = forwardOf(side);
  const along = (posts.y - startY(side)) * f;
  const angle = Math.atan2(posts.x - 0.5, along) + gauss(rng) * (0.02 + 0.08 * (1 - s));
  const reach = along * (1.35 + gauss(rng) * (0.05 + 0.15 * (1 - s)));
  return { dx: Math.sin(angle), dy: Math.cos(angle) * f, speed: speedFor(reach) };
}
