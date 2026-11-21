// Mosquito: a dim bedroom at night, and a few mosquitos buzzing about. Point your phone at the screen and swat:
// a swat covers a small circle round your pointer. A mosquito is a point, the golden big one three. Swat thin air
// and you've slapped yourself: "ow", and a second to recover. They get quicker as the night goes on.
//
// Positions are on the play wall: x across (-halfW..halfW), y up (-halfH..halfH). A pointer (-1..1) covers exactly
// that area. Every mosquito flies a path that is a fixed function of time, so a swat can be judged against where
// it was when the player pressed (the phone's lag taken off).
import type { Rng } from '../rng.js';

export const MOSQ = {
  duration: 30, // seconds
  halfW: 6.4,
  halfH: 2.6,
  swat: 0.7, // radius a swat covers
  body: 0.2, // a mosquito's own radius
  bigBody: 0.32, // the golden one's
  stun: 1, // seconds after a miss
  gap: 0.2, // shortest time between two swats
  start: 3, // mosquitos at the start …
  max: 5, // … growing to this many …
  every: 9, // … one more every this many seconds
  life: [6, 9] as const, // seconds one hangs about before it flies off
  enter: 0.8,
  leave: 1.0,
  speedUp: 1 / 30, // how fast the pace grows: 1 at the start, 2 after 30 seconds
  goldChance: 0.13,
  goldPace: 1.25,
  maxLag: 0.25, // a swat is judged at most this far back in time
  lastSpawn: 1.5, // no new mosquitos in the last seconds
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (k: number) => k * k * (3 - 2 * k);

export function fromPointer(x: number, y: number): { x: number; y: number } {
  return { x: x * MOSQ.halfW, y: y * MOSQ.halfH };
}
export function toPointer(x: number, y: number): { x: number; y: number } {
  return { x: x / MOSQ.halfW, y: y / MOSQ.halfH };
}

export interface Mosquito {
  id: number;
  /** When it appeared. */
  at: number;
  gold: boolean;
  /** The middle of where it wanders, and how far. */
  cx: number;
  cy: number;
  ax: number;
  ay: number;
  w: [number, number, number, number];
  p: [number, number, number, number, number, number];
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Seconds before it gets bored and flies off. */
  life: number;
  swattedAt: number | null;
  by: number | null;
}

/** The path's clock: runs faster as the game goes on (pace 1 at the start, 2 after 30 s). */
export function pace(t: number): number {
  return t + (MOSQ.speedUp * t * t) / 2;
}

/** A point just off one edge of the wall. */
function offEdge(rng: Rng): { x: number; y: number } {
  const side = rng();
  if (side < 0.4) return { x: -MOSQ.halfW - 1.4, y: (rng() * 2 - 1) * MOSQ.halfH };
  if (side < 0.8) return { x: MOSQ.halfW + 1.4, y: (rng() * 2 - 1) * MOSQ.halfH };
  return { x: (rng() * 2 - 1) * MOSQ.halfW, y: MOSQ.halfH + 1.2 };
}

export function spawnMosquito(rng: Rng, id: number, t: number): Mosquito {
  const gold = rng() < MOSQ.goldChance;
  const ax = 1.4 + rng() * 2.2;
  const ay = 0.7 + rng() * 0.9;
  const cx = (rng() * 2 - 1) * Math.max(0, MOSQ.halfW - 0.3 - ax);
  const cy = (rng() * 2 - 1) * Math.max(0, MOSQ.halfH - 0.2 - ay);
  const f = () => 0.55 + rng() * 0.55;
  const ph = () => rng() * Math.PI * 2;
  const from = offEdge(rng);
  const to = offEdge(rng);
  return {
    id,
    at: t,
    gold,
    cx,
    cy,
    ax,
    ay,
    w: [f(), f() * 1.7, f(), f() * 1.9],
    p: [ph(), ph(), ph(), ph(), ph(), ph()],
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
    life: MOSQ.life[0] + rng() * (MOSQ.life[1] - MOSQ.life[0]),
    swattedAt: null,
    by: null,
  };
}

/** Where a mosquito is at time t (flying in, buzzing about, flying off). */
export function mosquitoAt(m: Mosquito, t: number): { x: number; y: number } {
  const tau = t - m.at;
  const k = (pace(t) - pace(m.at)) * (m.gold ? MOSQ.goldPace : 1);
  const [w0, w1, w2, w3] = m.w;
  const [p0, p1, p2, p3, p4, p5] = m.p;
  // Lazy loops, a little zigzag, and now and then a quick dart to one side.
  let x = m.cx + m.ax * (0.65 * Math.sin(w0 * k + p0) + 0.35 * Math.sin(w1 * k + p1)) + 0.12 * Math.sin(9 * k + p4) + 0.7 * Math.tanh(4 * Math.sin(0.8 * w1 * k + p5));
  let y = m.cy + m.ay * (0.65 * Math.sin(w2 * k + p2) + 0.35 * Math.sin(w3 * k + p3)) + 0.1 * Math.sin(11 * k + p5) + 0.35 * Math.tanh(4 * Math.sin(0.7 * w3 * k + p4));
  x = clamp(x, -MOSQ.halfW + 0.15, MOSQ.halfW - 0.15);
  y = clamp(y, -MOSQ.halfH + 0.15, MOSQ.halfH - 0.15);
  if (tau < MOSQ.enter) {
    const e = smooth(clamp(tau / MOSQ.enter, 0, 1));
    x = m.fromX + (x - m.fromX) * e;
    y = m.fromY + (y - m.fromY) * e;
  } else if (tau > m.life) {
    const l = smooth(clamp((tau - m.life) / MOSQ.leave, 0, 1));
    x += (m.toX - x) * l;
    y += (m.toY - y) * l;
  }
  return { x, y };
}

/** Whether it is in the room (not swatted yet, not gone) at time t. */
export function flyingAt(m: Mosquito, t: number): boolean {
  return t >= m.at && t <= m.at + m.life + MOSQ.leave && (m.swattedAt === null || m.swattedAt > t);
}

/** Like flyingAt, but one swatted at exactly t still counts (two swats in the same moment). */
function reachableAt(m: Mosquito, t: number): boolean {
  return t >= m.at && t <= m.at + m.life + MOSQ.leave && (m.swattedAt === null || m.swattedAt >= t);
}

export function radius(m: Mosquito): number {
  return m.gold ? MOSQ.bigBody : MOSQ.body;
}

// ------------------------------------------------------------------ the swarm

export interface Swarm {
  list: Mosquito[];
  nextId: number;
  nextSpawn: number;
}

export function newSwarm(): Swarm {
  return { list: [], nextId: 0, nextSpawn: 0.3 };
}

/** How many mosquitos there should be at time t. */
export function wanted(t: number): number {
  return Math.min(MOSQ.max, MOSQ.start + Math.floor(t / MOSQ.every));
}

export function flying(sw: Swarm, t: number): Mosquito[] {
  return sw.list.filter((m) => flyingAt(m, t));
}

/** Lets new mosquitos in (and forgets old ones). Returns the new ones. */
export function stepSwarm(sw: Swarm, rng: Rng, t: number): Mosquito[] {
  sw.list = sw.list.filter((m) => (m.swattedAt === null ? t <= m.at + m.life + MOSQ.leave + 0.5 : t - m.swattedAt < 2));
  const born: Mosquito[] = [];
  if (t < MOSQ.duration - MOSQ.lastSpawn && t >= sw.nextSpawn && flying(sw, t).length < wanted(t)) {
    const m = spawnMosquito(rng, sw.nextId++, t);
    sw.list.push(m);
    born.push(m);
    sw.nextSpawn = t + 0.35 + rng() * 0.6;
  }
  return born;
}

export type SwatResult = { kind: 'hit'; hits: Mosquito[]; points: number } | { kind: 'late' } | { kind: 'miss' };

/**
 * A swat at (x, y), judged at time `judged` (when the player pressed, as seen on the TV) and happening `now`.
 * Hits everything inside the swat circle; a swat at one someone else just got is "late", not a miss.
 */
export function swat(sw: Swarm, x: number, y: number, judged: number, now: number, seat: number): SwatResult {
  const at = Math.max(judged, now - MOSQ.maxLag);
  const reach = sw.list.filter((m) => {
    if (!reachableAt(m, at)) return false;
    const p = mosquitoAt(m, at);
    return Math.hypot(p.x - x, p.y - y) <= MOSQ.swat + radius(m);
  });
  const hits = reach.filter((m) => m.swattedAt === null);
  if (hits.length) {
    for (const m of hits) {
      m.swattedAt = now;
      m.by = seat;
    }
    return { kind: 'hit', hits, points: hits.reduce((s, m) => s + (m.gold ? 3 : 1), 0) };
  }
  return reach.length ? { kind: 'late' } : { kind: 'miss' };
}

// ------------------------------------------------------------------ a player

export interface Swatter {
  points: number;
  hits: number;
  golds: number;
  misses: number;
  stunUntil: number;
  lastSwat: number;
}

export function newSwatter(): Swatter {
  return { points: 0, hits: 0, golds: 0, misses: 0, stunUntil: 0, lastSwat: -9 };
}

export function canSwat(p: Swatter, now: number): boolean {
  return now >= p.stunUntil && now - p.lastSwat >= MOSQ.gap;
}

/** Books a swat's result. A miss means you slapped yourself: a second to recover. */
export function applySwat(p: Swatter, r: SwatResult, now: number): void {
  p.lastSwat = now;
  if (r.kind === 'hit') {
    p.points += r.points;
    p.hits += r.hits.length;
    p.golds += r.hits.filter((m) => m.gold).length;
  } else if (r.kind === 'miss') {
    p.misses += 1;
    p.stunUntil = now + MOSQ.stun;
  }
}

export function mosquitoScores(players: readonly Swatter[]): number[] {
  return players.map((p) => p.points);
}

// ------------------------------------------------------------------ computer players

/**
 * A computer player's hand: it picks a mosquito (the nearest, golden ones look closer to sharp players), follows
 * where it saw it a moment ago, and swats once it feels lined up. Sleepier ones see later, line up worse and are
 * more impatient, so they slap themselves more.
 */
export interface SwatCpu {
  x: number;
  y: number;
  vx: number;
  vy: number;
  target: number | null;
  nextThink: number;
  offX: number;
  offY: number;
  nextSwat: number;
}

export function newSwatCpu(x: number, y: number): SwatCpu {
  return { x, y, vx: 0, vy: 0, target: null, nextThink: 0, offX: 0, offY: 0, nextSwat: 0 };
}

/** One step: where the CPU's pointer is (wall position) and whether it swats now. */
export function cpuSwat(c: SwatCpu, sw: Swarm, t: number, dt: number, skill: number, rng: Rng, ready: boolean): { x: number; y: number; swat: boolean } {
  const lag = 0.14 + (1 - skill) * 0.24;
  const seen = t - lag;
  const inView = (m: Mosquito) => {
    // It sees a splat straight away, even if it is slow to follow where they fly.
    if (!flyingAt(m, seen) || m.swattedAt !== null) return false;
    const p = mosquitoAt(m, seen);
    return Math.abs(p.x) <= MOSQ.halfW && Math.abs(p.y) <= MOSQ.halfH;
  };
  let target = c.target === null ? undefined : sw.list.find((m) => m.id === c.target && inView(m));
  if (t >= c.nextThink || !target) {
    c.nextThink = t + 0.25 + (1 - skill) * 0.4 * (0.5 + rng());
    const options = sw.list.filter(inView);
    if (options.length) {
      const score = (m: Mosquito) => {
        const p = mosquitoAt(m, seen);
        return Math.hypot(p.x - c.x, p.y - c.y) / (m.gold ? 1 + skill * 1.5 : 1);
      };
      const best = rng() < 0.15 * (1 - skill) ? options[Math.floor(rng() * options.length)] : options.reduce((a, b) => (score(b) < score(a) ? b : a));
      if (best && best !== target) {
        target = best;
        const sloppy = 0.1 + (1 - skill) * 0.35;
        c.offX = (rng() - 0.5) * 2 * sloppy;
        c.offY = (rng() - 0.5) * 2 * sloppy;
      }
    }
    c.target = target ? target.id : null;
  }
  let aimX = c.x;
  let aimY = c.y;
  if (target) {
    const p = mosquitoAt(target, seen);
    aimX = p.x + c.offX;
    aimY = p.y + c.offY;
  }
  // A springy hand.
  const k = 28 + 40 * skill;
  const damp = 2 * Math.sqrt(k) * 0.85;
  c.vx += ((aimX - c.x) * k - c.vx * damp) * dt;
  c.vy += ((aimY - c.y) * k - c.vy * damp) * dt;
  const v = Math.hypot(c.vx, c.vy);
  const vmax = 5 + 6 * skill;
  if (v > vmax) {
    c.vx *= vmax / v;
    c.vy *= vmax / v;
  }
  c.x = clamp(c.x + c.vx * dt, -MOSQ.halfW, MOSQ.halfW);
  c.y = clamp(c.y + c.vy * dt, -MOSQ.halfH, MOSQ.halfH);
  let go = false;
  if (ready && t >= c.nextSwat) {
    const lined = target !== undefined && Math.hypot(aimX - c.x, aimY - c.y) < MOSQ.swat * (0.3 + 0.45 * (1 - skill));
    const impatient = rng() < (1 - skill) * 0.08 * dt;
    if (lined || impatient) {
      go = true;
      c.nextSwat = t + 0.3 + (1 - skill) * 0.5 + rng() * 0.3;
    }
  }
  return { x: c.x, y: c.y, swat: go };
}
