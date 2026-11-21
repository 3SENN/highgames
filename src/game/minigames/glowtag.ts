// Glow Tag: a dark back garden, everyone holding a glow stick in their team's colour. Each round one team is "it"
// and chases the other: get close and press Tag to tag a runner. A tagged runner's glow stick goes dim for a few
// seconds (they can't be tagged again meanwhile) and the chasing team scores. The teams swap every round, two
// rounds each; most tags wins.
import type { Rng } from '../rng.js';

export const TAG = {
  rounds: 4,
  round: 15, // seconds a round
  halfW: 6.6, // the garden: x from -halfW to halfW…
  halfD: 3.9, // …and z from -halfD to halfD
  body: 0.3, // everyone's radius
  chaser: 2.75, // top speeds (units a second): runners are a touch quicker, so catching takes teamwork
  runner: 3.0,
  accel: 12, // how quickly you get up to speed (a second)
  reach: 0.8, // a tag reaches this far (centre to centre)
  cooldown: 0.6, // seconds between tags
  dim: 3, // seconds a tagged runner's glow stick stays dim
  step: 1 / 120, // physics step (seconds)
  history: 0.3, // seconds of positions kept, to judge a tag where the phone saw it
  lagMax: 0.15, // the most a press is wound back
  startX: 4.7, // where the sides start, either side of the middle
} as const;

/** Things in the garden you have to go round: the table, two bushes, the apple tree and the barbecue. */
export const OBSTACLES = [
  { x: 0, z: 0.1, r: 0.72 },
  { x: -2.9, z: -1.8, r: 0.55 },
  { x: 2.8, z: 1.9, r: 0.55 },
  { x: -2.5, z: 2.2, r: 0.42 },
  { x: 3.1, z: -2.0, r: 0.42 },
] as const;

export interface Stick {
  x: number;
  y: number;
}

export interface Tagger {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Heading (rotation about y: 0 faces +z). */
  face: number;
  /** 0 or 1 (-1: not playing). */
  team: number;
  /** Seconds left with a dim glow stick (can't be tagged). */
  dim: number;
  /** Seconds before this chaser can tag again. */
  cool: number;
  tags: number;
  caught: number;
  whiffs: number;
}

export interface Yard {
  players: Tagger[];
  /** The team that chases in the first round. */
  first: number;
  round: number;
  chasing: number;
  /** Seconds into this round. */
  clock: number;
  /** Seconds of play, all rounds together. */
  time: number;
  score: [number, number];
  /** Recent positions (x, z per player), for judging a press where the phone saw it. */
  past: { t: number; at: number[] }[];
}

export type TagResult = { kind: 'tag'; runner: number } | { kind: 'whiff' } | { kind: 'cool' } | { kind: 'runner' };

/** A new garden. `teams` holds seat positions; `first` is the team that's "it" first. */
export function newYard(teams: readonly (readonly number[])[], seats: number, first = 0): Yard {
  const players: Tagger[] = Array.from({ length: seats }, () => ({ x: 0, z: 0, vx: 0, vz: 0, face: 0, team: -1, dim: 0, cool: 0, tags: 0, caught: 0, whiffs: 0 }));
  teams.slice(0, 2).forEach((members, k) => {
    for (const m of members) {
      const p = players[m];
      if (p) p.team = k;
    }
  });
  const y: Yard = { players, first: first === 1 ? 1 : 0, round: 0, chasing: 0, clock: 0, time: 0, score: [0, 0], past: [] };
  startRound(y, 0);
  return y;
}

/** Which team chases in round r: the teams take turns. */
export function chasingIn(first: number, round: number): number {
  return (first + round) % 2;
}

/** Where everyone starts a round: the chasers on one side, the runners on the other (sides swap every round). */
export function startSpot(y: Yard, p: number): { x: number; z: number } {
  const me = y.players[p];
  const side = y.round % 2 === 0 ? -1 : 1;
  const chaser = me?.team === y.chasing;
  const mates = y.players.map((q, i) => ({ q, i })).filter(({ q }) => q.team === me?.team);
  const k = mates.findIndex(({ i }) => i === p);
  const spread = mates.length > 1 ? (k === 0 ? -1 : 1) * (chaser ? 1.1 : 1.9) : 0;
  return { x: (chaser ? side : -side) * TAG.startX, z: spread };
}

export function startRound(y: Yard, round: number): void {
  y.round = round;
  y.chasing = chasingIn(y.first, round);
  y.clock = 0;
  y.past = [];
  y.players.forEach((p, i) => {
    const s = startSpot(y, i);
    p.x = s.x;
    p.z = s.z;
    p.vx = p.vz = 0;
    p.face = s.x < 0 ? Math.PI / 2 : -Math.PI / 2; // facing across the garden
    p.dim = 0;
    p.cool = 0;
  });
}

export const roundOver = (y: Yard) => y.clock >= TAG.round - 1e-9;
export const isChaser = (y: Yard, p: number) => y.players[p]?.team === y.chasing;

function collide(y: Yard): void {
  const r = TAG.body;
  for (const p of y.players) {
    if (p.team < 0) continue;
    for (const o of OBSTACLES) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + r;
      if (d < min) {
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        p.x = o.x + nx * min;
        p.z = o.z + nz * min;
        const vn = p.vx * nx + p.vz * nz;
        if (vn < 0) {
          p.vx -= vn * nx;
          p.vz -= vn * nz;
        }
      }
    }
    const wx = TAG.halfW - r;
    const wz = TAG.halfD - r;
    if (Math.abs(p.x) > wx) {
      p.x = Math.sign(p.x) * wx;
      p.vx = 0;
    }
    if (Math.abs(p.z) > wz) {
      p.z = Math.sign(p.z) * wz;
      p.vz = 0;
    }
  }
  // People bump softly off each other.
  for (let i = 0; i < y.players.length; i++) {
    for (let j = i + 1; j < y.players.length; j++) {
      const a = y.players[i] as Tagger;
      const b = y.players[j] as Tagger;
      if (a.team < 0 || b.team < 0) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = 2 * r;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
    }
  }
}

/** Moves everyone for dt seconds (fixed steps). Sticks: x right, y away from the camera (up on the phone). */
export function stepYard(y: Yard, sticks: readonly Stick[], dt: number): number[] {
  const lit: number[] = [];
  let left = Math.max(0, dt);
  while (left > 1e-9) {
    const h = Math.min(TAG.step, left);
    left -= h;
    y.clock += h;
    y.time += h;
    y.players.forEach((p, i) => {
      if (p.team < 0) return;
      const s = sticks[i] ?? { x: 0, y: 0 };
      let sx = s.x;
      let sy = s.y;
      const len = Math.hypot(sx, sy);
      if (len > 1) {
        sx /= len;
        sy /= len;
      }
      const top = p.team === y.chasing ? TAG.chaser : TAG.runner;
      const k = 1 - Math.exp(-TAG.accel * h);
      p.vx += (sx * top - p.vx) * k;
      p.vz += (-sy * top - p.vz) * k;
      p.x += p.vx * h;
      p.z += p.vz * h;
      if (Math.hypot(p.vx, p.vz) > 0.4) p.face = Math.atan2(p.vx, p.vz);
      if (p.dim > 0) {
        p.dim = Math.max(0, p.dim - h);
        if (p.dim === 0) lit.push(i);
      }
      p.cool = Math.max(0, p.cool - h);
    });
    collide(y);
    y.past.push({ t: y.time, at: y.players.flatMap((p) => [p.x, p.z]) });
    while ((y.past[0]?.t ?? Infinity) < y.time - TAG.history) y.past.shift();
  }
  return lit;
}

/** Where player p was `ago` seconds back (as close as the history goes). */
export function pastSpot(y: Yard, p: number, ago: number): { x: number; z: number } {
  const me = y.players[p];
  const when = y.time - Math.max(0, ago);
  let best: { t: number; at: number[] } | undefined;
  for (const s of y.past) if (s.t <= when + 1e-9) best = s;
  best ??= y.past[0];
  if (!best || !me) return { x: me?.x ?? 0, z: me?.z ?? 0 };
  return { x: best.at[p * 2] ?? me.x, z: best.at[p * 2 + 1] ?? me.z };
}

/**
 * Chaser p presses Tag; `lag` is how long the press took to arrive (half the phone's round trip). It counts
 * where the phone's player saw it: a runner in reach then or now is tagged (the nearest one).
 */
export function pressTag(y: Yard, p: number, lag = 0): TagResult {
  const me = y.players[p];
  if (!me || me.team !== y.chasing) return { kind: 'runner' };
  if (me.cool > 0) return { kind: 'cool' };
  me.cool = TAG.cooldown;
  const ago = Math.min(TAG.lagMax, Math.max(0, lag));
  const then = pastSpot(y, p, ago);
  let best = -1;
  let bestD = Infinity;
  y.players.forEach((r, i) => {
    if (r.team < 0 || r.team === y.chasing || r.dim > 0) return;
    const was = pastSpot(y, i, ago);
    const d = Math.min(Math.hypot(r.x - me.x, r.z - me.z), Math.hypot(was.x - then.x, was.z - then.z));
    if (d <= TAG.reach && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  if (best < 0) {
    me.whiffs += 1;
    return { kind: 'whiff' };
  }
  const r = y.players[best] as Tagger;
  r.dim = TAG.dim;
  r.caught += 1;
  me.tags += 1;
  y.score[y.chasing === 0 ? 0 : 1] += 1;
  return { kind: 'tag', runner: best };
}

/** Scores per seat: both partners get their team's tags. */
export function tagScores(y: Yard): number[] {
  return y.players.map((p) => (p.team === 0 ? y.score[0] : p.team === 1 ? y.score[1] : 0));
}

export function tagDetail(y: Yard, p: number): string {
  const me = y.players[p];
  if (!me || me.team < 0) return '';
  const team = y.score[me.team === 0 ? 0 : 1];
  const parts = [`${team} team tag${team === 1 ? '' : 's'}`, `${me.tags} by you`];
  parts.push(me.caught ? `tagged ${me.caught === 1 ? 'once' : `${me.caught} times`}` : 'never tagged');
  return parts.join(' · ');
}

// ------------------------------------------------------------------ computer players

export interface CpuTagger {
  skill: number;
  next: number;
  dir: Stick;
  target: number;
  /** When it'll press Tag (scheduled after seeing a runner in reach). */
  pressAt: number | null;
  wobble: number;
  /** Seconds left of not paying attention. */
  dozy: number;
}

export function newCpuTagger(skill: number, rng: Rng): CpuTagger {
  return { skill: Math.max(0, Math.min(1, skill)), next: 0, dir: { x: 0, y: 0 }, target: -1, pressAt: null, wobble: rng() * 10, dozy: 0 };
}

const inside = (x: number, z: number) => ({ x: Math.max(-TAG.halfW + 0.4, Math.min(TAG.halfW - 0.4, x)), z: Math.max(-TAG.halfD + 0.4, Math.min(TAG.halfD - 0.4, z)) });

/** A direction towards (tx, tz), bent round any obstacle in the way. World x/z. */
function steer(me: Tagger, tx: number, tz: number): { x: number; z: number } {
  let dx = tx - me.x;
  let dz = tz - me.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  let bx = 0;
  let bz = 0;
  for (const o of OBSTACLES) {
    const ox = o.x - me.x;
    const oz = o.z - me.z;
    const along = ox * dx + oz * dz;
    if (along <= 0 || along > d + o.r) continue;
    // The obstacle's offset from the straight path: step away from it, more the closer it is.
    const px = ox - along * dx;
    const pz = oz - along * dz;
    const off = Math.hypot(px, pz);
    const clear = o.r + TAG.body + 0.25;
    if (off >= clear) continue;
    const k = (1 - off / clear) * Math.min(1, 1.6 / Math.max(0.3, along)) * 1.4;
    bx += (off > 1e-3 ? -px / off : -dz) * k;
    bz += (off > 1e-3 ? -pz / off : dx) * k;
  }
  dx += bx;
  dz += bz;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

function blocked(x: number, z: number): number {
  let pen = 0;
  for (const o of OBSTACLES) {
    const d = Math.hypot(x - o.x, z - o.z) - o.r - TAG.body;
    if (d < 0.25) pen += 2 + (0.25 - d) * 3;
  }
  const wall = Math.min(TAG.halfW - Math.abs(x), TAG.halfD - Math.abs(z));
  if (wall < 1.1) pen += (1.1 - wall) * 2.2;
  return pen;
}

function chase(c: CpuTagger, y: Yard, p: number, rng: Rng): void {
  const me = y.players[p] as Tagger;
  const s = c.skill;
  const runners = y.players.map((r, i) => ({ r, i })).filter(({ r }) => r.team >= 0 && r.team !== y.chasing);
  const live = runners.filter(({ r }) => r.dim === 0);
  // Where the partner is headed: the runner nearest to them.
  const mate = y.players.findIndex((q, i) => i !== p && q.team === y.chasing);
  const mateAt = y.players[mate];
  const theirs = mateAt && live.length > 1 ? live.reduce((a, b) => (Math.hypot(a.r.x - mateAt.x, a.r.z - mateAt.z) <= Math.hypot(b.r.x - mateAt.x, b.r.z - mateAt.z) ? a : b)).i : -1;
  let pick: { r: Tagger; i: number } | undefined;
  let bestCost = Infinity;
  for (const x of live.length ? live : runners) {
    let cost = Math.hypot(x.r.x - me.x, x.r.z - me.z) + (x.r.dim > 0 ? x.r.dim * 2 : 0);
    if (x.i === theirs) cost += s * 2.2; // sharp pairs split up (or cut off); sleepy ones both chase the nearest
    if (x.i === c.target) cost -= 0.6; // don't keep switching
    if (cost < bestCost) {
      bestCost = cost;
      pick = x;
    }
  }
  if (!pick) {
    c.dir = { x: 0, y: 0 };
    return;
  }
  c.target = pick.i;
  const lead = 0.1 + s * 0.4 + (rng() - 0.5) * 0.2;
  let aim = inside(pick.r.x + pick.r.vx * lead, pick.r.z + pick.r.vz * lead);
  // A runner still glowing dim: wait nearby rather than on top of them.
  if (pick.r.dim > 0.6) {
    const dx = me.x - pick.r.x;
    const dz = me.z - pick.r.z;
    const d = Math.hypot(dx, dz) || 1;
    aim = inside(pick.r.x + (dx / d) * 1.4, pick.r.z + (dz / d) * 1.4);
  }
  const dir = steer(me, aim.x, aim.z);
  const near = Math.hypot(aim.x - me.x, aim.z - me.z);
  const push = (0.8 + 0.2 * s) * Math.min(1, near / 0.3);
  c.dir = { x: dir.x * push, y: -dir.z * push };
}

function flee(c: CpuTagger, y: Yard, p: number, rng: Rng): void {
  const me = y.players[p] as Tagger;
  const s = c.skill;
  const chasers = y.players.filter((q) => q.team >= 0 && q.team === y.chasing);
  const nearest = Math.min(...chasers.map((q) => Math.hypot(q.x - me.x, q.z - me.z)));
  const alert = 3.5 + s * 5;
  // No one close: amble about, keeping clear. (While dim, a sharp runner uses the time to get away.)
  const relaxed = nearest > alert || (me.dim > 0.5 && rng() < 1 - s);
  const dirs = 8 + Math.round(s * 8);
  const look = 0.45 + s * 0.35;
  let best = { x: 0, z: 0 };
  let bestScore = -Infinity;
  const cur = Math.hypot(me.vx, me.vz) > 0.3 ? { x: me.vx / Math.hypot(me.vx, me.vz), z: me.vz / Math.hypot(me.vx, me.vz) } : { x: 0, z: 0 };
  for (let k = 0; k < dirs; k++) {
    const a = (k / dirs) * Math.PI * 2 + c.wobble * 0.1;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const nx = me.x + dx * TAG.runner * look;
    const nz = me.z + dz * TAG.runner * look;
    // Away from the nearest chaser, and not into the other one's arms.
    let first = Infinity;
    let second = Infinity;
    for (const q of chasers) {
      const d = Math.hypot(nx - (q.x + q.vx * look * 0.8), nz - (q.z + q.vz * look * 0.8));
      if (d < first) {
        second = first;
        first = d;
      } else second = Math.min(second, d);
    }
    let score = first + (Number.isFinite(second) ? second * 0.3 * s : 0);
    score -= blocked(nx, nz) * (0.6 + s * 0.6);
    score += (dx * cur.x + dz * cur.z) * (0.3 + s * 0.4); // keep going the same way
    score += (rng() - 0.5) * (1 - s) * 1.6;
    if (score > bestScore) {
      bestScore = score;
      best = { x: dx, z: dz };
    }
  }
  const push = relaxed ? 0.35 : 0.8 + 0.2 * s;
  c.dir = { x: best.x * push, y: -best.z * push };
}

/**
 * What a computer player does this frame: its stick, and whether it presses Tag. Sharp chasers lead their target
 * and split up; sharp runners keep away from the walls and use the table. Sleepy ones notice late and wander.
 */
export function cpuTag(c: CpuTagger, y: Yard, p: number, rng: Rng, dt: number): { x: number; y: number; a: boolean } {
  const me = y.players[p];
  if (!me || me.team < 0) return { x: 0, y: 0, a: false };
  const s = c.skill;
  c.wobble += dt * (0.8 + rng() * 0.4);
  if (c.dozy > 0) {
    c.dozy -= dt;
    return { x: c.dir.x * 0.4, y: c.dir.y * 0.4, a: false };
  }
  if (rng() < (0.01 + (1 - s) * 0.08) * dt) c.dozy = 0.3 + rng() * (0.3 + (1 - s) * 0.9);
  const chaser = me.team === y.chasing;
  if (y.time >= c.next) {
    if (chaser) chase(c, y, p, rng);
    else flee(c, y, p, rng);
    c.next = y.time + 0.06 + (1 - s) * 0.26 + rng() * 0.06;
  }
  let a = false;
  if (chaser) {
    let near = Infinity;
    for (const r of y.players) if (r.team >= 0 && r.team !== y.chasing && r.dim === 0) near = Math.min(near, Math.hypot(r.x - me.x, r.z - me.z));
    // Sharp ones wait until it's sure to reach; sleepy ones sometimes swing too soon.
    const eager = 0.75 + 0.15 * s + (rng() < (1 - s) * 0.02 ? 0.6 : 0);
    if (c.pressAt === null && me.cool === 0 && near <= TAG.reach * eager) c.pressAt = y.time + 0.04 + (1 - s) * 0.22 + rng() * 0.08;
    if (c.pressAt !== null && y.time >= c.pressAt) {
      c.pressAt = null;
      a = true;
    }
  } else c.pressAt = null;
  const wob = (1 - s) * 0.15;
  return { x: c.dir.x + Math.sin(c.wobble * 3) * wob, y: c.dir.y + Math.cos(c.wobble * 2.3) * wob, a };
}
