// Pivot!: moving day. Two partners carry one couch down a narrow hallway with two corners and a doorway at the
// end, one partner on each end. Each stick moves its own end and the couch is rigid, so a corner takes teamwork:
// one end pivots while the other walks it round. Bumping a wall too hard scuffs the couch and stuns the team for
// a moment. The first couch through the door wins; at the time limit, the couch that got furthest.
//
// Everything here is in the hallway's own flat coordinates: x to the right, y forward (away from the TV).
import type { Rng } from '../rng.js';

export const CARRY = {
  duration: 40, // seconds
  step: 1 / 120, // physics step
  hall: 1.8, // hallway width
  door: 1.3, // the doorway, between the jambs
  span: 2.0, // the couch: distance between its two ends (where the partners hold it)
  radius: 0.4, // the couch: half its depth (it is a capsule: rounded arms)
  speed: 1.8, // an end at full stick, units a second
  follow: 9, // how quickly the couch picks up what the sticks ask (1/s)
  scuff: 1.05, // speed into a wall that scuffs it
  stun: 0.6, // seconds the team is stunned after a scuff
  cooldown: 0.8, // no second scuff this soon after one
  recoil: 0.5, // the bounce off the wall
} as const;

/** Where the corners and the door are. */
export const LAYOUT = {
  back: -1.3, // the wall behind the couch at the start
  turn1: 6, // the first corner (turning right) is at y = turn1
  turn2: 4, // the second corner (turning forward again) is at x = turn2
  doorY: 10, // the hallway side of the wall with the doorway
  wall: 0.22, // wall thickness
  room: { half: 2.6, depth: 3.6 }, // the new flat beyond the door
  start: 0.4, // the couch's centre starts here, pointing forward
} as const;

/** A solid, axis-aligned block of wall. */
export interface Block {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Vec {
  x: number;
  y: number;
}

export interface Seg {
  a: Vec;
  b: Vec;
}

export interface Pose {
  x: number;
  y: number;
  /** Direction from the back end to the front end, radians (0 = +x, π/2 = forward). */
  angle: number;
}

/** A polyline with the distance along it at every point. */
export interface Track {
  pts: Vec[];
  at: number[];
}

export interface Hall {
  /** The walls as solid blocks (for drawing) and as their edges (for the physics). */
  blocks: Block[];
  walls: Seg[];
  /** The open floor: the three stretches of hallway, the doorway and the new flat. */
  floors: Block[];
  /** The middle of the hallway with the corners rounded off: progress is measured along it. */
  track: Track;
  /** The line a careful carrier steers the couch's middle along, cutting the corners a little. */
  race: Track;
  start: Pose;
  /** Progress at the start, and when the couch is all the way through the door. */
  from: number;
  goal: number;
  /** The doorway: its middle, the hallway side (y), its width and how deep the wall is. */
  door: { x: number; y: number; width: number; depth: number };
  corners: { inner: Vec; outer: Vec }[];
}

export interface Couch extends Pose {
  vx: number;
  vy: number;
  spin: number;
  /** Seconds left of a stun (the sticks do nothing). */
  stun: number;
  cooldown: number;
  scuffs: number;
  /** Distance along the hallway's middle. */
  progress: number;
  finishedAt: number | null;
  /** Leaning on a wall this step. */
  touching: boolean;
}

export type CarryEvent =
  /** `at` is where on the wall, `normal` points from the wall into the hallway, `end` is the nearer end. */
  { kind: 'scuff'; at: Vec; normal: Vec; end: 0 | 1 } | { kind: 'through' };

// ------------------------------------------------------------------ small vector helpers

const v = (x: number, y: number): Vec => ({ x, y });
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const clamp01 = (n: number) => clamp(n, 0, 1);
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const sub = (a: Vec, b: Vec): Vec => v(a.x - b.x, a.y - b.y);
const len = (a: Vec) => Math.hypot(a.x, a.y);

export function track(pts: Vec[]): Track {
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push((at[i - 1] ?? 0) + len(sub(pts[i] as Vec, pts[i - 1] as Vec)));
  return { pts, at };
}

/** The point `s` along a track (clamped to its ends). */
export function pointAt(tr: Track, s: number): Vec {
  const n = tr.pts.length;
  if (s <= 0) return { ...(tr.pts[0] as Vec) };
  for (let i = 1; i < n; i++) {
    const s1 = tr.at[i] as number;
    if (s <= s1 || i === n - 1) {
      const s0 = tr.at[i - 1] as number;
      const a = tr.pts[i - 1] as Vec;
      const b = tr.pts[i] as Vec;
      const k = s1 > s0 ? clamp01((s - s0) / (s1 - s0)) : 0;
      return v(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    }
  }
  return { ...(tr.pts[n - 1] as Vec) };
}

/**
 * How far along the track `p` is (its nearest point). With `near`, only the stretch within `window` of it is
 * searched, so a point by a corner doesn't jump between the two legs.
 */
export function project(tr: Track, p: Vec, near?: number, window = 0.8): number {
  let best = Infinity;
  let out = near ?? 0;
  for (let i = 1; i < tr.pts.length; i++) {
    const s0 = tr.at[i - 1] as number;
    const s1 = tr.at[i] as number;
    const l = s1 - s0;
    if (l <= 0) continue;
    let lo = 0;
    let hi = 1;
    if (near !== undefined) {
      if (s1 < near - window || s0 > near + window) continue;
      lo = clamp01((near - window - s0) / l);
      hi = clamp01((near + window - s0) / l);
    }
    const a = tr.pts[i - 1] as Vec;
    const b = tr.pts[i] as Vec;
    const k = clamp(dot(sub(p, a), sub(b, a)) / (l * l), lo, hi);
    const d = Math.hypot(p.x - (a.x + (b.x - a.x) * k), p.y - (a.y + (b.y - a.y) * k));
    if (d < best) {
      best = d;
      out = s0 + k * l;
    }
  }
  return out;
}

/** Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
function closest(p1: Vec, q1: Vec, p2: Vec, q2: Vec): { s: number; c1: Vec; c2: Vec } {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0;
  } else if (a <= 1e-9) {
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-9) {
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  return { s, c1: v(p1.x + d1.x * s, p1.y + d1.y * s), c2: v(p2.x + d2.x * t, p2.y + d2.y * t) };
}

// ------------------------------------------------------------------ the hallway

/** A quarter circle from angle a0 to a1 round `c`, as points (without the first). */
function arc(c: Vec, r: number, a0: number, a1: number, pieces = 16): Vec[] {
  const out: Vec[] = [];
  for (let i = 1; i <= pieces; i++) {
    const a = a0 + ((a1 - a0) * i) / pieces;
    out.push(v(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));
  }
  return out;
}

/** Both ends this far past the doorway (beyond its depth) and the couch is through. */
const PAST = CARRY.radius + 0.05;

/**
 * The hallway: forward from the start, a corner to the right, a corner forward again, then the doorway into the
 * new flat. `cut` is how far a careful carrier's line cuts each corner.
 */
export function makeHall(cut = 0.81): Hall {
  const h = CARRY.hall / 2;
  const { back, turn1: y1, turn2: x2, doorY, room, wall: t } = LAYOUT;
  const dw = CARRY.door / 2;
  const inner = doorY + t; // the new flat's side of the wall with the doorway
  const top = inner + room.depth;
  const b = (x0: number, y0: number, x1: number, y1_: number): Block => ({ x0, y0, x1, y1: y1_ });
  const blocks: Block[] = [
    b(-h - t, back - t, h + t, back), // behind the couch
    // The left wall: up, along the top of the middle stretch, up to the door.
    b(-h - t, back - t, -h, y1 + h + t),
    b(-h - t, y1 + h, x2 - h, y1 + h + t),
    b(x2 - h - t, y1 + h, x2 - h, doorY),
    // The right wall.
    b(h, back - t, h + t, y1 - h),
    b(h, y1 - h - t, x2 + h + t, y1 - h),
    b(x2 + h, y1 - h - t, x2 + h + t, doorY),
    // The wall with the doorway, and the new flat beyond it.
    b(x2 - room.half - t, doorY, x2 - dw, inner),
    b(x2 + dw, doorY, x2 + room.half + t, inner),
    b(x2 - room.half - t, inner, x2 - room.half, top),
    b(x2 + room.half, inner, x2 + room.half + t, top),
    b(x2 - room.half - t, top, x2 + room.half + t, top + t),
  ];
  const walls: Seg[] = blocks.flatMap((k) => [
    { a: v(k.x0, k.y0), b: v(k.x1, k.y0) },
    { a: v(k.x1, k.y0), b: v(k.x1, k.y1) },
    { a: v(k.x1, k.y1), b: v(k.x0, k.y1) },
    { a: v(k.x0, k.y1), b: v(k.x0, k.y0) },
  ]);
  const floors: Block[] = [
    b(-h, back, h, y1 - h),
    b(-h, y1 - h, x2 + h, y1 + h),
    b(x2 - h, y1 + h, x2 + h, doorY),
    b(x2 - dw, doorY, x2 + dw, inner),
    b(x2 - room.half, inner, x2 + room.half, top),
  ];
  const corners = [
    { inner: v(h, y1 - h), outer: v(-h, y1 + h) },
    { inner: v(x2 - h, y1 + h), outer: v(x2 + h, y1 - h) },
  ];
  // The middle of the hallway, each corner rounded round its inner corner (so progress never jumps).
  const c1 = corners[0]?.inner as Vec;
  const c2 = corners[1]?.inner as Vec;
  const tr = track([v(0, back), v(0, y1 - h), ...arc(c1, h, Math.PI, Math.PI / 2), v(x2 - h, y1), ...arc(c2, h, -Math.PI / 2, 0), v(x2, top)]);
  const race = track([v(0, back), v(0, y1 - cut), v(cut, y1), v(x2 - cut, y1), v(x2, y1 + cut), v(x2, top)]);
  const start: Pose = { x: 0, y: LAYOUT.start, angle: Math.PI / 2 };
  const from = project(tr, start);
  const goal = project(tr, v(x2, inner + PAST + CARRY.span / 2));
  return { blocks, walls, floors, track: tr, race, start, from, goal, door: { x: x2, y: doorY, width: CARRY.door, depth: t }, corners };
}

/** Whether `p` is on the open floor (not inside a wall or outside the flat). */
export function inHall(hall: Hall, p: Vec): boolean {
  return hall.floors.some((f) => p.x >= f.x0 - 1e-6 && p.x <= f.x1 + 1e-6 && p.y >= f.y0 - 1e-6 && p.y <= f.y1 + 1e-6);
}

/** Moves a round thing of radius `r` at `p` out of the walls (the carriers, so they never stand in one). */
export function keepClear(hall: Hall, p: Vec, r: number): Vec {
  const out = { ...p };
  for (let pass = 0; pass < 2; pass++) {
    for (const w of hall.walls) {
      const { c2 } = closest(out, out, w.a, w.b);
      const dx = out.x - c2.x;
      const dy = out.y - c2.y;
      const d = Math.hypot(dx, dy);
      if (d >= r || d < 1e-6) continue;
      out.x += (dx / d) * (r - d);
      out.y += (dy / d) * (r - d);
    }
  }
  return out;
}

// ------------------------------------------------------------------ the couch

export function newCouch(hall: Hall): Couch {
  const { x, y, angle } = hall.start;
  return { x, y, angle, vx: 0, vy: 0, spin: 0, stun: 0, cooldown: 0, scuffs: 0, progress: hall.from, finishedAt: null, touching: false };
}

/** The front end (held by partner 0) and the back end (partner 1). */
export function couchEnds(p: Pose): [Vec, Vec] {
  const ax = Math.cos(p.angle) * (CARRY.span / 2);
  const ay = Math.sin(p.angle) * (CARRY.span / 2);
  return [v(p.x + ax, p.y + ay), v(p.x - ax, p.y - ay)];
}

/** How far along the hallway the couch is, 0 at the start to 1 all the way through the door. */
export function carryFraction(c: Couch, hall: Hall): number {
  if (c.finishedAt !== null) return 1;
  return clamp01((c.progress - hall.from) / (hall.goal - hall.from));
}

const INERTIA = ((CARRY.span + 2 * CARRY.radius) ** 2 + (2 * CARRY.radius) ** 2) / 12; // mass 1

/**
 * One physics step (CARRY.step seconds). `sticks` are the front and back partners' sticks (x right, y forward,
 * length up to 1); `t` is the game time, for the finish.
 */
export function stepCouch(c: Couch, hall: Hall, sticks: readonly [Vec, Vec], t: number): CarryEvent[] {
  const dt = CARRY.step;
  const events: CarryEvent[] = [];
  c.stun = Math.max(0, c.stun - dt);
  c.cooldown = Math.max(0, c.cooldown - dt);
  const ax = Math.cos(c.angle);
  const ay = Math.sin(c.angle);
  // What the two ends ask for, fitted to a rigid couch: the middle moves at their average, and it turns by how
  // much they disagree sideways (one end still and the other moving sideways pivots round the still one).
  let wantX = 0;
  let wantY = 0;
  let wantSpin = 0;
  if (c.stun <= 0 && c.finishedAt === null) {
    const [f, b] = sticks.map((s) => {
      const l = Math.hypot(s.x, s.y);
      const k = (l > 1 ? 1 / l : 1) * CARRY.speed;
      return v(s.x * k, s.y * k);
    }) as [Vec, Vec];
    wantX = (f.x + b.x) / 2;
    wantY = (f.y + b.y) / 2;
    wantSpin = ((f.x - b.x) * -ay + (f.y - b.y) * ax) / CARRY.span;
  }
  const k = 1 - Math.exp(-CARRY.follow * dt);
  c.vx += (wantX - c.vx) * k;
  c.vy += (wantY - c.vy) * k;
  c.spin += (wantSpin - c.spin) * k;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.angle += c.spin * dt;

  // Walls: push the couch out and stop it moving into them. The hardest knock this step may scuff.
  let knock = 0;
  let hit: { at: Vec; normal: Vec; end: 0 | 1 } | null = null;
  c.touching = false;
  for (let pass = 0; pass < 3; pass++) {
    for (const w of hall.walls) {
      const [front, back] = couchEnds(c);
      const { s, c1, c2 } = closest(back, front, w.a, w.b);
      let nx = c1.x - c2.x;
      let ny = c1.y - c2.y;
      const d = Math.hypot(nx, ny);
      if (d >= CARRY.radius) continue;
      if (d > 1e-6) {
        nx /= d;
        ny /= d;
      } else {
        // Right on the wall's line: push towards the side the couch's middle is on.
        const wx = w.b.x - w.a.x;
        const wy = w.b.y - w.a.y;
        const wl = Math.hypot(wx, wy) || 1;
        nx = -wy / wl;
        ny = wx / wl;
        if ((c.x - w.a.x) * nx + (c.y - w.a.y) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
      }
      c.touching = true;
      const rx = c1.x - c.x;
      const ry = c1.y - c.y;
      const cross = rx * ny - ry * nx;
      const inv = 1 + (cross * cross) / INERTIA;
      const depth = CARRY.radius - d;
      c.x += (nx * depth) / inv;
      c.y += (ny * depth) / inv;
      c.angle += (cross * depth) / (INERTIA * inv);
      const vn = (c.vx - c.spin * ry) * nx + (c.vy + c.spin * rx) * ny;
      if (vn < 0) {
        const j = -vn / inv;
        c.vx += nx * j;
        c.vy += ny * j;
        c.spin += (cross * j) / INERTIA;
        if (-vn > knock) {
          knock = -vn;
          hit = { at: c2, normal: v(nx, ny), end: s >= 0.5 ? 0 : 1 };
        }
      }
    }
  }
  if (hit && knock > CARRY.scuff && c.cooldown <= 0 && c.finishedAt === null) {
    c.scuffs += 1;
    c.stun = CARRY.stun;
    c.cooldown = CARRY.cooldown;
    c.vx += hit.normal.x * CARRY.recoil;
    c.vy += hit.normal.y * CARRY.recoil;
    events.push({ kind: 'scuff', ...hit });
  }

  c.progress = project(hall.track, c, c.progress, 0.6);
  if (c.finishedAt === null) {
    const [front, back] = couchEnds(c);
    const past = hall.door.y + hall.door.depth + PAST;
    if (front.y >= past && back.y >= past) {
      c.finishedAt = t;
      events.push({ kind: 'through' });
    }
  }
  return events;
}

// ------------------------------------------------------------------ scores

/** Through the door: the sooner the better, always ahead of anyone still in the hallway. Otherwise how far. */
export function carryScore(c: Couch, hall: Hall): number {
  if (c.finishedAt !== null) return 1000 + Math.round(Math.max(0, CARRY.duration - c.finishedAt) * 10);
  return Math.round(carryFraction(c, hall) * 900);
}

/** Scores per seat: both partners get their couch's score. `teams` holds seat positions. */
export function carryScores(couches: readonly Couch[], hall: Hall, teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    const c = couches[i];
    if (!c) return;
    for (const m of members) if (m >= 0 && m < seats) scores[m] = carryScore(c, hall);
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

/** How a computer carrier behaves at skill s (0 sleepy … 1 sharp). */
export const CPU = {
  /** Fraction of full speed on the straights. */
  pace: (s: number) => 0.4 + 0.32 * s,
  /** Chance per second of staring into space for a moment. */
  zone: (s: number) => 0.04 + (1 - s) * 0.22,
  /** Chance per second of an over-keen shove sideways. */
  shove: (s: number) => 0.015 + (1 - s) * 0.11,
} as const;

export interface CpuCarrier {
  /** How far along the careful line the couch's middle is. */
  sigma: number;
  next: number;
  stick: Vec;
  /** Seconds left of staring into space. */
  zone: number;
  /** Seconds left of an over-keen shove the wrong way. */
  shove: number;
  shoveDir: Vec;
}

export function newCpuCarrier(hall: Hall): CpuCarrier {
  return { sigma: project(hall.race, hall.start), next: 0, stick: v(0, 0), zone: 0, shove: 0, shoveDir: v(0, 0) };
}

/** The pose a careful pair would have the couch in a little further along the line (`sigma` along it). */
export function planPose(hall: Hall, sigma: number): Pose {
  const mid = pointAt(hall.race, sigma);
  const f = pointAt(hall.race, sigma + CARRY.span / 2);
  const b = pointAt(hall.race, sigma - CARRY.span / 2);
  return { x: mid.x, y: mid.y, angle: Math.atan2(f.y - b.y, f.x - b.x) };
}

/**
 * The stick a computer player holding `end` (0 front, 1 back) pushes this frame. Both ends follow the same plan,
 * so two computers work together, and one carries its share alongside a person. skill: 0 sleepy … 1 sharp.
 */
export function cpuStick(cpu: CpuCarrier, hall: Hall, c: Couch, end: 0 | 1, skill: number, rng: Rng, t: number, dt: number): Vec {
  const s = clamp01(skill);
  if (cpu.zone > 0) {
    cpu.zone -= dt;
    return v(0, 0);
  }
  if (cpu.shove > 0) {
    cpu.shove -= dt;
    return cpu.shoveDir;
  }
  if (rng() < CPU.zone(s) * dt) {
    cpu.zone = 0.4 + rng() * (0.3 + (1 - s) * 1.0);
    return v(0, 0);
  }
  if (rng() < CPU.shove(s) * dt) {
    // Over-keen: a hard push sideways, which usually ends in the wall.
    const [front, back] = couchEnds(c);
    const side = rng() < 0.5 ? 1 : -1;
    const ax = (front.x - back.x) / CARRY.span;
    const ay = (front.y - back.y) / CARRY.span;
    cpu.shove = 0.35 + rng() * 0.25;
    cpu.shoveDir = v(-ay * side, ax * side);
    return cpu.shoveDir;
  }
  if (t >= cpu.next) {
    cpu.next = t + 0.08 + (1 - s) * 0.3 * (0.5 + rng());
    cpu.sigma = project(hall.race, c, cpu.sigma, 0.8);
    const goal = planPose(hall, cpu.sigma + 0.55);
    const mine = couchEnds(c)[end];
    const want = couchEnds(goal)[end];
    // Easy does it round the corners.
    const corner = Math.min(...hall.corners.map((k) => Math.hypot(c.x - (k.inner.x + k.outer.x) / 2, c.y - (k.inner.y + k.outer.y) / 2)));
    const pace = CPU.pace(s) * (corner < 1.9 ? 0.55 + 0.35 * s : 1);
    let x = (want.x - mine.x) * 3.2;
    let y = (want.y - mine.y) * 3.2;
    const l = Math.hypot(x, y);
    const top = pace * CARRY.speed;
    if (l > top) {
      x *= top / l;
      y *= top / l;
    }
    // A sleepy hand wanders.
    const wobble = 0.08 + (1 - s) * 0.55;
    cpu.stick = v(clamp(x / CARRY.speed + (rng() - 0.5) * wobble, -1, 1), clamp(y / CARRY.speed + (rng() - 0.5) * wobble, -1, 1));
  }
  return cpu.stick;
}
