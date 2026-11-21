// Coaster Hockey: two phones lie top to top on the coffee table and make one air-hockey table; a drink coaster is
// the puck. Each player drags a mallet round their own phone, and the goal slots are at each phone's bottom edge.
// First to five, or the most goals when time is up.
//
// The first part of this file is what every table game shares (the field made of two phones, who plays whom, and
// the scores); paperfootball.ts builds on it.
import { type Rng, shuffle } from '../rng.js';

// ------------------------------------------------------------------ the field: two phones top to top

/** A phone's length in phone widths: the playfield is a 9:16 portrait canvas. */
export const PHONE_L = 16 / 9;

/** Which phone of a pair: side 0 lies with its bottom edge at y = -PHONE_L, side 1 at y = +PHONE_L. */
export type Side = 0 | 1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Two phones top to top make one field, measured in phone widths: x runs 0..1 across (side 0's left to right) and
 * y from -PHONE_L (side 0's bottom edge) through 0 (where the tops touch) to +PHONE_L (side 1's bottom edge).
 * This turns a field point into a point on `side`'s canvas (0..1 of its width and height). Side 1 lies the other
 * way round, so its canvas is turned half a circle.
 */
export function toPhone(side: Side, x: number, y: number): { x: number; y: number } {
  return side === 0 ? { x, y: -y / PHONE_L } : { x: 1 - x, y: y / PHONE_L };
}

/** The other way: a point on `side`'s canvas (0..1) as a field point. */
export function fromPhone(side: Side, px: number, py: number): { x: number; y: number } {
  return side === 0 ? { x: px, y: -py * PHONE_L } : { x: 1 - px, y: py * PHONE_L };
}

/** The direction along y that `side` plays towards (its opponent's phone). */
export function forwardOf(side: Side): 1 | -1 {
  return side === 0 ? 1 : -1;
}

// ------------------------------------------------------------------ who plays whom

export interface TablePlan {
  /** The matches of the first round, played side by side: pairs of player positions (side 0, side 1). */
  first: [number, number][];
  /** With three players: who plays the winner of the first match afterwards. */
  waiting: number | null;
  /** Players who watch from the sofa (computer players nobody needs). */
  sofa: number[];
  /** The position of a computer opponent without a seat (one person and no computer seat), or null. */
  phantom: number | null;
}

/**
 * Who plays whom. `humans` and `cpus` are player positions (0..n-1). People play each other; a lone person plays a
 * computer player (a made-up one when there is no computer seat, at position n); computer players only play each
 * other when nobody is at the table (a demo). Two players: one match; three: a match, then the third plays the
 * winner; four: two matches side by side.
 */
export function planTable(humans: readonly number[], cpus: readonly number[], rng: Rng): TablePlan {
  const n = humans.length + cpus.length;
  let players: number[];
  let phantom: number | null = null;
  if (humans.length >= 2) {
    players = shuffle(rng, humans).slice(0, 4);
  } else if (humans.length === 1) {
    const rival = cpus.length ? cpus[Math.floor(rng() * cpus.length)] : undefined;
    players = [humans[0] as number, rival ?? n];
    if (rival === undefined) phantom = n;
  } else {
    players = shuffle(rng, cpus).slice(0, 4);
    if (players.length === 1) {
      players.push(n);
      phantom = n;
    }
  }
  const first: [number, number][] = [];
  if (players.length >= 2) first.push([players[0] as number, players[1] as number]);
  if (players.length >= 4) first.push([players[2] as number, players[3] as number]);
  const waiting = players.length === 3 ? (players[2] as number) : null;
  const sofa = Array.from({ length: n }, (_, i) => i).filter((p) => !players.includes(p));
  return { first, waiting, sofa, phantom };
}

export interface MatchOutcome {
  /** Player positions on side 0 and side 1. */
  players: [number, number];
  points: [number, number];
  /** The side that won, or null for a draw. */
  winner: Side | null;
  /** 1: the first round; 2: the final against the player who waited. */
  round: 1 | 2;
}

/**
 * Scores per seat (positions 0..seats-1; a made-up opponent past the end is left out). The final ranks above the
 * first round, a win above a draw above a loss, then the margin, then the points. The sofa scores 0.
 */
export function tableScores(seats: number, outcomes: readonly MatchOutcome[]): number[] {
  const scores = new Array<number>(seats).fill(0);
  for (const o of outcomes) {
    for (const side of [0, 1] as const) {
      const p = o.players[side];
      if (p < 0 || p >= seats) continue;
      const mine = o.points[side];
      const theirs = o.points[side === 0 ? 1 : 0];
      const base = o.winner === null ? 1 : o.winner === side ? 2 : 0;
      const score = (o.round - 1) * 10_000 + base * 1000 + 500 + clamp(mine - theirs, -45, 45) * 10 + Math.min(9, mine);
      scores[p] = Math.max(scores[p] ?? 0, score);
    }
  }
  return scores;
}

/** Who goes through to the final: the winner, or on a draw whoever wins the coin toss. */
export function advancer(o: MatchOutcome, rng: Rng): number {
  const side = o.winner ?? (rng() < 0.5 ? 0 : 1);
  return o.players[side];
}

// ------------------------------------------------------------------ coaster hockey

export const HOCKEY = {
  duration: 60, // seconds, or first to `target`
  target: 5,
  /** Three players play two matches in a row, so each one is shorter. */
  shortDuration: 35,
  shortTarget: 3,
  overtime: 15, // level when time is up: the next goal wins, for at most this long
  step: 1 / 120,
  puckR: 0.075, // in phone widths
  malletR: 0.095,
  goalHalf: 0.3, // half the goal slot's width
  serveY: 0.6, // the puck comes back this far from the middle, in the half that conceded
  puckMax: 4.4, // phone widths a second
  malletMax: 5,
  friction: 0.2, // per second
  wallBounce: 0.85,
  hitBounce: 0.9,
  goalPause: 1.4, // seconds before the puck comes back
} as const;

export interface Disc {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Mallet extends Disc {
  /** Where it is heading (the finger, or the computer's plan). */
  tx: number;
  ty: number;
  /** Top speed: a finger is quick, a sleepy computer less so. */
  max: number;
}

export interface Rink {
  puck: Disc;
  mallets: [Mallet, Mallet];
  score: [number, number];
  /** False while the puck is in a goal slot. */
  live: boolean;
  /** Seconds until the puck comes back after a goal. */
  pause: number;
  /** The half the puck comes back to (the side that conceded). */
  serveTo: Side;
}

export type RinkEvent = { t: 'hit'; side: Side; speed: number } | { t: 'wall'; speed: number } | { t: 'goal'; side: Side } | { t: 'serve'; side: Side };

function serveSpot(side: Side): { x: number; y: number } {
  return { x: 0.5, y: -forwardOf(side) * HOCKEY.serveY };
}

export function newRink(serveTo: Side): Rink {
  const home = (side: Side): Mallet => {
    const y = -forwardOf(side) * (PHONE_L - 0.35);
    return { x: 0.5, y, vx: 0, vy: 0, tx: 0.5, ty: y, max: HOCKEY.malletMax };
  };
  const s = serveSpot(serveTo);
  return { puck: { ...s, vx: 0, vy: 0 }, mallets: [home(0), home(1)], score: [0, 0], live: true, pause: 0, serveTo };
}

/** Points `side`'s mallet at a field point, kept inside its own phone. */
export function aimMallet(r: Rink, side: Side, x: number, y: number): void {
  const R = HOCKEY.malletR;
  const m = r.mallets[side];
  m.tx = clamp(x, R, 1 - R);
  m.ty = side === 0 ? clamp(y, -PHONE_L + R, -R) : clamp(y, R, PHONE_L - R);
}

/** One fixed step of the table. Returns what happened (hits, bounces, goals, a new serve). */
export function stepRink(r: Rink, dt: number): RinkEvent[] {
  const events: RinkEvent[] = [];
  const { puckR: pr, malletR: mr, goalHalf } = HOCKEY;
  for (const m of r.mallets) {
    const dx = m.tx - m.x;
    const dy = m.ty - m.y;
    const d = Math.hypot(dx, dy);
    const k = d > m.max * dt ? (m.max * dt) / d : 1;
    m.vx = (dx * k) / dt;
    m.vy = (dy * k) / dt;
    m.x += dx * k;
    m.y += dy * k;
  }
  if (!r.live) {
    r.pause -= dt;
    if (r.pause <= 0) {
      const s = serveSpot(r.serveTo);
      r.puck = { ...s, vx: 0, vy: 0 };
      r.live = true;
      r.pause = 0;
      events.push({ t: 'serve', side: r.serveTo });
    }
    return events;
  }
  const p = r.puck;
  const slow = Math.exp(-HOCKEY.friction * dt);
  p.vx *= slow;
  p.vy *= slow;
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // Mallets: the puck bounces off them, picking up their speed.
  r.mallets.forEach((m, i) => {
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    const d = Math.hypot(dx, dy);
    const min = pr + mr;
    if (d >= min) return;
    const nx = d > 1e-6 ? dx / d : 0;
    const ny = d > 1e-6 ? dy / d : forwardOf(i as Side);
    p.x = m.x + nx * min;
    p.y = m.y + ny * min;
    const rel = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
    if (rel < 0) {
      p.vx -= (1 + HOCKEY.hitBounce) * rel * nx;
      p.vy -= (1 + HOCKEY.hitBounce) * rel * ny;
      events.push({ t: 'hit', side: i as Side, speed: -rel });
    }
  });
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > HOCKEY.puckMax) {
    p.vx *= HOCKEY.puckMax / speed;
    p.vy *= HOCKEY.puckMax / speed;
  }

  // The rails along the sides.
  const e = HOCKEY.wallBounce;
  if (p.x < pr) {
    if (p.vx < -0.25) events.push({ t: 'wall', speed: -p.vx });
    p.x = pr;
    p.vx = Math.abs(p.vx) * e;
  } else if (p.x > 1 - pr) {
    if (p.vx > 0.25) events.push({ t: 'wall', speed: p.vx });
    p.x = 1 - pr;
    p.vx = -Math.abs(p.vx) * e;
  }
  // The ends, except for the goal slots, and the slot's corners.
  const inMouth = Math.abs(p.x - 0.5) < goalHalf;
  if (!inMouth && p.y < -PHONE_L + pr) {
    if (p.vy < -0.25) events.push({ t: 'wall', speed: -p.vy });
    p.y = -PHONE_L + pr;
    p.vy = Math.abs(p.vy) * e;
  } else if (!inMouth && p.y > PHONE_L - pr) {
    if (p.vy > 0.25) events.push({ t: 'wall', speed: p.vy });
    p.y = PHONE_L - pr;
    p.vy = -Math.abs(p.vy) * e;
  }
  for (const py of [-PHONE_L, PHONE_L]) {
    for (const px of [0.5 - goalHalf, 0.5 + goalHalf]) {
      const dx = p.x - px;
      const dy = p.y - py;
      const d = Math.hypot(dx, dy);
      if (d >= pr || d < 1e-6) continue;
      const nx = dx / d;
      const ny = dy / d;
      p.x = px + nx * pr;
      p.y = py + ny * pr;
      const rel = p.vx * nx + p.vy * ny;
      if (rel < 0) {
        p.vx -= (1 + e) * rel * nx;
        p.vy -= (1 + e) * rel * ny;
      }
    }
  }

  // In a slot: a goal for the other side.
  if (p.y < -PHONE_L || p.y > PHONE_L) {
    const scorer: Side = p.y < 0 ? 1 : 0;
    r.score[scorer] += 1;
    r.live = false;
    r.pause = HOCKEY.goalPause;
    r.serveTo = scorer === 0 ? 1 : 0;
    p.vx = 0;
    p.vy = 0;
    events.push({ t: 'goal', side: scorer });
  }
  return events;
}

// ------------------------------------------------------------------ computer players

export interface HockeyCpu {
  skill: number;
  /** Seconds until it looks again. */
  wait: number;
  /** Seconds before it reacts to the puck's new path (after a hit or a bounce). */
  react: number;
  /** How far off its read of the puck's path is this time. */
  misread: number;
  /** Seconds left of a strike (driving through the puck). */
  strike: number;
  /** Where it aims on the far goal line, picked once per attack (outside 0..1: off a rail). */
  aim: number;
  picked: boolean;
  /** The puck's velocity when it last looked, to notice hits and bounces. */
  seen: { vx: number; vy: number };
}

export function newHockeyCpu(skill: number): HockeyCpu {
  return { skill: clamp(skill, 0, 1), wait: 0, react: 0, misread: 0, strike: 0, aim: 0.5, picked: false, seen: { vx: 0, vy: 0 } };
}

/** The computer's top mallet speed: a sleepy one is slow to get across. */
export function cpuMalletMax(skill: number): number {
  return 1.9 + 2.6 * clamp(skill, 0, 1);
}

/** Bounces a coordinate back into lo..hi as the rails would. */
function reflectInto(v: number, lo: number, hi: number): number {
  const span = hi - lo;
  let u = (v - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  return lo + (u > span ? 2 * span - u : u);
}

function gauss(rng: Rng): number {
  return (rng() + rng() + rng() + rng() - 2) * Math.sqrt(3);
}

/**
 * Where a computer player aims at the far end (an x on the far goal line; outside 0..1 for a bank shot off a rail):
 * the corner away from the other mallet, or, more often for a sharp player, off the nearer rail.
 */
function pickShot(r: Rink, side: Side, puckX: number, s: number, rng: Rng): number {
  const { goalHalf, puckR } = HOCKEY;
  const other = r.mallets[side === 0 ? 1 : 0];
  const open = other.x < 0.5 ? 1 : -1;
  let gx = 0.5 + open * goalHalf * (0.35 + 0.45 * rng());
  if (rng() < 0.2 + 0.35 * s) gx = puckX < 0.5 ? 2 * puckR - gx : 2 * (1 - puckR) - gx;
  return gx + gauss(rng) * (0.05 + 0.25 * (1 - s));
}

/**
 * A computer player's mallet: guard the goal while the puck is on the other phone, get in the way of a fast puck,
 * and otherwise line up behind the puck and drive it at the far slot. After every hit or bounce it takes a moment
 * to react and reads the new path a little wrong; sharper players react sooner, read better, move faster and aim
 * better.
 */
export function cpuHockey(r: Rink, side: Side, cpu: HockeyCpu, dt: number, rng: Rng): void {
  const m = r.mallets[side];
  const s = cpu.skill;
  m.max = cpuMalletMax(s);
  cpu.wait -= dt;
  cpu.strike -= dt;
  cpu.react -= dt;
  const p = r.puck;
  if (Math.hypot(p.vx - cpu.seen.vx, p.vy - cpu.seen.vy) > 0.5) {
    cpu.react = 0.12 + 0.28 * (1 - s) + rng() * 0.08;
    cpu.misread = gauss(rng) * (0.07 + 0.2 * (1 - s));
  }
  cpu.seen.vx = p.vx;
  cpu.seen.vy = p.vy;
  if (cpu.wait > 0 || (cpu.react > 0 && cpu.strike <= 0)) return;
  cpu.wait = 0.12 - 0.08 * s + rng() * 0.03;
  const { puckR: pr, malletR: mr } = HOCKEY;
  const f = forwardOf(side);
  const L = PHONE_L;
  // Work as if this side plays upwards (+y), its own goal at -L.
  const px = p.x;
  const py = p.y * f;
  const vx = p.vx;
  const vy = p.vy * f;
  const my = m.y * f;
  const guardY = -L + 0.3;
  let tx = 0.5;
  let ty = guardY;
  if (r.live) {
    const lead = 0.04 + 0.1 * s;
    const ax = reflectInto(px + vx * lead, pr, 1 - pr);
    const ay = py + vy * lead;
    /** Where the puck will cross the line y (as this player reads it). */
    const crossing = (y: number) => reflectInto(px + vx * ((y - py) / vy) + cpu.misread, pr, 1 - pr);
    if (ay > 0.02) {
      // On their phone: stand between the puck and the slot; a sharp player reads where it will arrive.
      tx = 0.5 + (ax - 0.5) * 0.45;
      if (vy < -0.3) tx += (crossing(guardY) - tx) * (0.3 + 0.6 * s);
      cpu.strike = 0;
      cpu.picked = false;
    } else if (vy < -0.9 && py > my + 0.05 && cpu.strike <= 0) {
      // Coming at us fast: get in its way, where it will cross the mallet's line.
      const lineY = clamp(my, guardY, py - 0.1);
      const shadow = 0.5 + (px - 0.5) * 0.45;
      tx = shadow + (crossing(lineY) - shadow) * (0.3 + 0.65 * s);
      ty = lineY;
    } else if (ay < my - 0.02 && cpu.strike <= 0) {
      // Behind the mallet: go round it (on the side the mallet is already on) without knocking it in.
      const round = m.x < ax ? -1 : 1;
      const sideX = ax + round * (pr + mr + 0.05);
      tx = sideX < mr || sideX > 1 - mr ? ax - round * (pr + mr + 0.05) : sideX;
      ty = ay - (pr + mr) * 0.8;
    } else {
      // Line up behind the puck towards the far slot, then drive through it.
      if (!cpu.picked && cpu.strike <= 0) {
        cpu.picked = true;
        cpu.aim = pickShot(r, side, ax, s, rng);
      }
      let dx = cpu.aim - ax;
      let dy = L + 0.15 - ay;
      const n = Math.hypot(dx, dy) || 1;
      dx /= n;
      dy /= n;
      const bx = ax - dx * (pr + mr + 0.03);
      const by = ay - dy * (pr + mr + 0.03);
      if (cpu.strike <= 0 && Math.hypot(m.x - bx, my - by) < 0.05 + 0.05 * s) {
        cpu.strike = 0.16 + 0.06 * s;
        cpu.picked = false;
      }
      if (cpu.strike > 0) {
        tx = ax + dx * 0.25;
        ty = ay + dy * 0.25;
      } else {
        tx = bx;
        ty = by;
      }
    }
  }
  aimMallet(r, side, tx, ty * f);
}
