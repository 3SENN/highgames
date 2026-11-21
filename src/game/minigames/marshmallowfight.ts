// Marshmallow Fight: two pairs in a backyard at night, a campfire in the middle and a row of lawn chairs on each
// side for cover. Run about with the stick and throw marshmallows across at the other pair: a hit sticks to them
// and scores a point for your team. Chairs stop marshmallows (you can lob one over the chair you're crouched
// behind). Most hits in 30 seconds wins.
//
// Everything happens in the yard's x/z plane: the fire sits at the origin, team 0 holds the left half (x < 0) and
// team 1 the right, +z points at the TV audience. A stick's y (up on the phone) runs away from the audience (-z).
import type { Rng } from '../rng.js';

export const MALLOW = {
  duration: 30, // seconds
  half: { x: 7.2, z: 3.3 }, // half-size of the yard
  middle: 1.5, // nobody goes nearer the middle line than this (the fire's there)
  bodyR: 0.42,
  speed: 4.4, // running speed at full stick
  response: 12, // how quickly running follows the stick
  deadzone: 0.18,
  reload: 0.6, // seconds between throws
  queue: 0.2, // a press this close to the end of the reload still throws when it's done
  fly: 10.5, // marshmallow speed, units a second
  range: 14, // it lands on the grass after this far
  maxAngle: 0.9, // radians off straight across that a throw can go
  assist: 0.2, // a throw within this many radians of someone bends towards them
  mallowR: 0.13,
  over: 1.3, // within this of the throw, a marshmallow sails over chairs (you lob it over your own cover)
  dazed: 0.6, // seconds after a hit when the same camper can't be hit again
  chairX: 3.4, // each side's row of chairs stands this far from the middle
  chairZ: [-2.2, 0, 2.2] as readonly number[],
  chairHalf: { x: 0.32, z: 0.62 },
  step: 1 / 120, // physics sub-step
} as const;

export interface Stick {
  x: number;
  y: number;
  a: boolean;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

export interface Camper {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing direction in the x/z plane (unit length). */
  fx: number;
  fz: number;
  reload: number;
  /** Seconds a press is kept waiting for the reload. */
  queued: number;
  dazed: number;
  /** The button was down last step (a throw needs a fresh press). */
  pressed: boolean;
  throws: number;
  /** Marshmallows this camper landed on the other pair. */
  hits: number;
  /** Marshmallows stuck on this camper. */
  splats: number;
}

export interface Mallow {
  id: number;
  team: number;
  /** Seat position of the thrower. */
  owner: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  travelled: number;
  /** Passed close over the fire (a toasted one, purely for show). */
  toasted: boolean;
}

export interface Chair {
  x: number;
  z: number;
  team: number;
}

export interface Yard {
  /** Team (0 or 1) per seat position; -1 for a seat that isn't playing. */
  teamOf: number[];
  campers: Camper[];
  mallows: Mallow[];
  chairs: Chair[];
  /** Hits per team. */
  score: [number, number];
  time: number;
  nextId: number;
}

export interface YardEvents {
  thrown: Mallow[];
  hits: { mallow: Mallow; target: number }[];
  blocked: { mallow: Mallow; chair: number }[];
  dropped: Mallow[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** +1 for team 0 (throws to the right), -1 for team 1. */
export function sideOf(team: number): number {
  return team === 0 ? 1 : -1;
}

export function makeChairs(): Chair[] {
  const out: Chair[] = [];
  for (const team of [0, 1]) for (const z of MALLOW.chairZ) out.push({ x: -sideOf(team) * MALLOW.chairX, z, team });
  return out;
}

function camper(x: number, z: number, team: number): Camper {
  return { x, z, vx: 0, vz: 0, fx: sideOf(team), fz: 0, reload: 0.3, queued: 0, dazed: 0, pressed: false, throws: 0, hits: 0, splats: 0 };
}

/** A yard for `seats` seat positions split into `teams` (two lists of positions). */
export function newYard(teams: readonly (readonly number[])[], seats: number): Yard {
  const teamOf = new Array<number>(seats).fill(-1);
  const campers: Camper[] = [];
  for (let p = 0; p < seats; p++) campers.push(camper(0, 0, 0));
  teams.slice(0, 2).forEach((members, team) => {
    members.forEach((p, m) => {
      if (p < 0 || p >= seats) return;
      teamOf[p] = team;
      const z = members.length > 1 ? (m === 0 ? -1.1 : 1.1) : 0;
      campers[p] = camper(-sideOf(team) * 5.3, z, team);
    });
  });
  return { teamOf, campers, mallows: [], chairs: makeChairs(), score: [0, 0], time: 0, nextId: 1 };
}

export function isOver(y: Yard): boolean {
  return y.time >= MALLOW.duration;
}

/** Whether a point is inside a chair (grown by `r`). */
function inChair(c: Chair, x: number, z: number, r: number): boolean {
  return Math.abs(x - c.x) < MALLOW.chairHalf.x + r && Math.abs(z - c.z) < MALLOW.chairHalf.z + r;
}

/**
 * Whether a throw from (ax, az) to (bx, bz) gets there without hitting a chair (the first `over` units sail over).
 */
export function clearShot(y: Yard, ax: number, az: number, bx: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-6) return true;
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  for (let s = MALLOW.over; s < len; s += 0.08) {
    const x = ax + ux * s;
    const z = az + uz * s;
    if (y.chairs.some((c) => inChair(c, x, z, MALLOW.mallowR))) return false;
  }
  return true;
}

/**
 * The angle of a throw (radians from straight across, positive towards +z): where the camper faces, kept to the
 * forward arc, and bent onto someone on the other side who's nearly in line.
 */
export function throwAngle(y: Yard, p: number): number {
  const c = y.campers[p];
  const team = y.teamOf[p] ?? -1;
  if (!c || team < 0) return 0;
  const side = sideOf(team);
  const a = clamp(Math.atan2(c.fz, Math.max(0.35, c.fx * side)), -MALLOW.maxAngle, MALLOW.maxAngle);
  let best: number = MALLOW.assist;
  let pick = a;
  y.campers.forEach((e, q) => {
    const t = y.teamOf[q] ?? -1;
    if (t < 0 || t === team) return;
    const ea = Math.atan2(e.z - c.z, (e.x - c.x) * side);
    if (Math.abs(ea) > MALLOW.maxAngle) return;
    const off = Math.abs(ea - a);
    if (off < best) {
      best = off;
      pick = ea;
    }
  });
  return pick;
}

function throwFrom(y: Yard, p: number): Mallow | null {
  const c = y.campers[p];
  const team = y.teamOf[p] ?? -1;
  if (!c || team < 0) return null;
  const a = throwAngle(y, p);
  const side = sideOf(team);
  const dx = side * Math.cos(a);
  const dz = Math.sin(a);
  const start = MALLOW.bodyR + 0.12;
  const m: Mallow = { id: y.nextId++, team, owner: p, x: c.x + dx * start, z: c.z + dz * start, dx, dz, travelled: start, toasted: false };
  y.mallows.push(m);
  c.reload = MALLOW.reload;
  c.queued = 0;
  c.throws += 1;
  return m;
}

/** Keeps campers in their half of the yard, out of the chairs and out of each other. */
function separate(y: Yard): void {
  const cs = y.campers;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      if ((y.teamOf[i] ?? -1) < 0 || (y.teamOf[j] ?? -1) < 0) continue;
      const a = cs[i] as Camper;
      const b = cs[j] as Camper;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = MALLOW.bodyR * 2;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 0;
      const nz = d > 1e-6 ? dz / d : 1;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
    }
  }
  cs.forEach((c, p) => {
    const team = y.teamOf[p] ?? -1;
    if (team < 0) return;
    for (const ch of y.chairs) {
      if (!inChair(ch, c.x, c.z, MALLOW.bodyR)) continue;
      const ox = MALLOW.chairHalf.x + MALLOW.bodyR - Math.abs(c.x - ch.x);
      const oz = MALLOW.chairHalf.z + MALLOW.bodyR - Math.abs(c.z - ch.z);
      if (ox < oz) {
        c.x += (c.x >= ch.x ? 1 : -1) * ox;
        c.vx = 0;
      } else {
        c.z += (c.z >= ch.z ? 1 : -1) * oz;
        c.vz = 0;
      }
    }
    const side = sideOf(team);
    const lo = side > 0 ? -MALLOW.half.x : MALLOW.middle;
    const hi = side > 0 ? -MALLOW.middle : MALLOW.half.x;
    if (c.x < lo || c.x > hi) {
      c.x = clamp(c.x, lo, hi);
      c.vx = 0;
    }
    if (Math.abs(c.z) > MALLOW.half.z) {
      c.z = clamp(c.z, -MALLOW.half.z, MALLOW.half.z);
      c.vz = 0;
    }
  });
}

function subStep(y: Yard, inputs: readonly Stick[], h: number, ev: YardEvents): void {
  y.time += h;
  const follow = Math.min(1, MALLOW.response * h);
  y.campers.forEach((c, p) => {
    if ((y.teamOf[p] ?? -1) < 0) return;
    const input = inputs[p] ?? IDLE;
    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    if (len < MALLOW.deadzone) {
      ix = 0;
      iy = 0;
    } else {
      c.fx = input.x / len;
      c.fz = -input.y / len;
    }
    c.vx += (ix * MALLOW.speed - c.vx) * follow;
    c.vz += (-iy * MALLOW.speed - c.vz) * follow;
    c.x += c.vx * h;
    c.z += c.vz * h;
    c.reload = Math.max(0, c.reload - h);
    c.dazed = Math.max(0, c.dazed - h);
    c.queued = Math.max(0, c.queued - h);
    if (input.a && !c.pressed) c.queued = c.reload <= MALLOW.queue ? MALLOW.queue + 1e-6 : 0;
    c.pressed = input.a;
    if (c.queued > 0 && c.reload <= 0) {
      const m = throwFrom(y, p);
      if (m) ev.thrown.push(m);
    }
  });
  separate(y);

  const move = MALLOW.fly * h;
  y.mallows = y.mallows.filter((m) => {
    m.x += m.dx * move;
    m.z += m.dz * move;
    m.travelled += move;
    if (Math.hypot(m.x, m.z) < 0.9) m.toasted = true;
    if (m.travelled > MALLOW.over) {
      const chair = y.chairs.findIndex((c) => inChair(c, m.x, m.z, MALLOW.mallowR));
      if (chair >= 0) {
        ev.blocked.push({ mallow: m, chair });
        return false;
      }
    }
    let target = -1;
    let nearest = MALLOW.bodyR + MALLOW.mallowR;
    y.campers.forEach((c, q) => {
      const team = y.teamOf[q] ?? -1;
      if (team < 0 || team === m.team || c.dazed > 0) return;
      const d = Math.hypot(c.x - m.x, c.z - m.z);
      if (d < nearest) {
        nearest = d;
        target = q;
      }
    });
    if (target >= 0) {
      const c = y.campers[target] as Camper;
      c.splats += 1;
      c.dazed = MALLOW.dazed;
      const thrower = y.campers[m.owner];
      if (thrower) thrower.hits += 1;
      y.score[m.team === 0 ? 0 : 1] += 1;
      ev.hits.push({ mallow: m, target });
      return false;
    }
    if (m.travelled >= MALLOW.range || Math.abs(m.x) > MALLOW.half.x + 1.5 || Math.abs(m.z) > MALLOW.half.z + 1.5) {
      ev.dropped.push(m);
      return false;
    }
    return true;
  });
}

/** Advances the yard by dt seconds (in small sub-steps) with one stick per seat position. */
export function stepYard(y: Yard, inputs: readonly Stick[], dt: number): YardEvents {
  const ev: YardEvents = { thrown: [], hits: [], blocked: [], dropped: [] };
  let left = Math.min(dt, MALLOW.duration - y.time);
  while (left > 1e-9) {
    const h = Math.min(MALLOW.step, left);
    subStep(y, inputs, h, ev);
    left -= h;
  }
  // Rounding never leaves the clock a hair short of the end.
  if (MALLOW.duration - y.time < 1e-6) y.time = MALLOW.duration;
  return ev;
}

/** Scores per seat: both partners get their team's hits. `teams` holds seat positions. */
export function mallowScores(y: Yard, teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.slice(0, 2).forEach((members, team) => {
    for (const m of members) if (m >= 0 && m < seats) scores[m] = y.score[team === 0 ? 0 : 1];
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

export interface CpuCamper {
  spotX: number;
  spotZ: number;
  /** When it picks a new spot. */
  rethink: number;
  /** Not before this time does it throw again. */
  throwAt: number;
  /** Sidestepping an incoming marshmallow until then, in this direction. */
  dodgeUntil: number;
  dodgeX: number;
  dodgeZ: number;
  /** Marshmallows it already decided about. */
  seen: Set<number>;
  /** Seconds left staring at the fire. */
  spaced: number;
  /** It pressed last call (a throw needs a fresh press). */
  pressed: boolean;
}

export function newCpuCamper(): CpuCamper {
  return { spotX: 0, spotZ: 0, rethink: 0, throwAt: 0.4, dodgeUntil: 0, dodgeX: 0, dodgeZ: 0, seen: new Set(), spaced: 0, pressed: false };
}

/** Places worth standing on a side: up front, in the gaps between chairs, and crouched behind them. */
function spots(team: number): { x: number; z: number; cover: boolean }[] {
  const s = -sideOf(team);
  const out: { x: number; z: number; cover: boolean }[] = [];
  for (const z of [-2.6, -1.1, 0, 1.1, 2.6]) out.push({ x: s * 2.2, z, cover: false });
  for (const z of [-1.1, 1.1, 3.0, -3.0]) out.push({ x: s * MALLOW.chairX, z, cover: false });
  for (const z of MALLOW.chairZ) out.push({ x: s * (MALLOW.chairX + MALLOW.chairHalf.x + MALLOW.bodyR + 0.05), z, cover: true });
  return out;
}

/** Roughly bell-shaped noise with a standard deviation of about 1. */
function bell(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 2;
}

/** The stick a computer camper pushes this step. skill: 0 sleepy … 1 sharp. */
export function cpuStick(c: CpuCamper, y: Yard, p: number, dt: number, skill: number, rng: Rng): Stick {
  const me = y.campers[p];
  const team = y.teamOf[p] ?? -1;
  if (!me || team < 0) return IDLE;
  const s = Math.max(0, Math.min(1, skill));
  const side = sideOf(team);
  const t = y.time;
  const release = (stick: Stick): Stick => {
    c.pressed = stick.a;
    return stick;
  };

  // Zoning out by the fire now and then.
  if (c.spaced > 0) {
    c.spaced -= dt;
    return release(IDLE);
  }
  if (rng() < (0.02 + (1 - s) * 0.16) * dt) c.spaced = 0.4 + rng() * (0.4 + (1 - s) * 0.9);

  // Incoming! Sharp campers often sidestep; sleepy ones mostly don't notice.
  for (const m of y.mallows) {
    if (m.team === team || c.seen.has(m.id)) continue;
    const px = me.x - m.x;
    const pz = me.z - m.z;
    const along = px * m.dx + pz * m.dz;
    if (along <= 0) continue;
    const when = along / MALLOW.fly;
    if (when > 0.55) continue;
    c.seen.add(m.id);
    const cross = px * m.dz - pz * m.dx;
    const miss = Math.abs(cross);
    if (miss > MALLOW.bodyR + 0.4) continue;
    if (rng() < 0.08 + 0.5 * s) {
      const away = cross >= 0 ? 1 : -1;
      c.dodgeX = m.dz * away;
      c.dodgeZ = -m.dx * away;
      if (Math.abs(me.z + c.dodgeZ * 0.8) > MALLOW.half.z - 0.2) {
        c.dodgeX = -c.dodgeX;
        c.dodgeZ = -c.dodgeZ;
      }
      c.dodgeUntil = t + 0.12 + (1 - s) * 0.15 + 0.3;
    }
  }
  if (t < c.dodgeUntil) return release({ x: c.dodgeX, y: -c.dodgeZ, a: false });

  // Pick a spot now and then: sharp campers prefer spots with a clear shot at someone.
  if (t >= c.rethink) {
    const enemies = y.campers.filter((_, q) => (y.teamOf[q] ?? -1) >= 0 && y.teamOf[q] !== team);
    let best = -Infinity;
    for (const sp of spots(team)) {
      const shots = enemies.filter((e) => clearShot(y, sp.x, sp.z, e.x, e.z) && Math.abs(Math.atan2(e.z - sp.z, (e.x - sp.x) * side)) < MALLOW.maxAngle).length;
      const crowd = y.campers.some((o, q) => q !== p && y.teamOf[q] === team && Math.hypot(o.x - sp.x, o.z - sp.z) < 1.2) ? 1.5 : 0;
      const cover = sp.cover && me.reload > 0.2 ? 0.8 : 0;
      const score = (shots * 1.4 + cover) * (0.4 + s) - crowd + rng() * 2.2;
      if (score > best) {
        best = score;
        c.spotX = sp.x + (rng() - 0.5) * 0.4;
        c.spotZ = sp.z + (rng() - 0.5) * 0.4;
      }
    }
    c.rethink = t + 1.0 + rng() * (1.4 + (1 - s));
  }

  // Throw at someone in a clear line, leading a runner a little.
  if (me.reload <= 0 && t >= c.throwAt && !c.pressed) {
    let target: Camper | null = null;
    let nearest = Infinity;
    y.campers.forEach((e, q) => {
      if ((y.teamOf[q] ?? -1) < 0 || y.teamOf[q] === team || e.dazed > 0.15) return;
      const d = Math.hypot(e.x - me.x, e.z - me.z);
      if (Math.abs(Math.atan2(e.z - me.z, (e.x - me.x) * side)) > MALLOW.maxAngle) return;
      if (d < nearest && clearShot(y, me.x, me.z, e.x, e.z)) {
        nearest = d;
        target = e;
      }
    });
    const tg = target as Camper | null;
    if (tg) {
      const lead = (nearest / MALLOW.fly) * (0.3 + 0.7 * s);
      const ax = tg.x + tg.vx * lead - me.x;
      const az = tg.z + tg.vz * lead - me.z;
      const a = clamp(Math.atan2(az, ax * side) + bell(rng) * (0.08 + (1 - s) * 0.34), -MALLOW.maxAngle, MALLOW.maxAngle);
      c.throwAt = t + MALLOW.reload + 0.35 + (1 - s) * 0.8 + rng() * (0.3 + (1 - s) * 0.5);
      // A light nudge turns it to face the throw without running off.
      return release({ x: side * Math.cos(a) * 0.3, y: -Math.sin(a) * 0.3, a: true });
    }
  }

  // Otherwise head for the spot.
  const dx = c.spotX - me.x;
  const dz = c.spotZ - me.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) return release(IDLE);
  const pace = Math.min(1, d * 1.6) * (0.6 + 0.4 * s);
  return release({ x: (dx / d) * pace, y: -(dz / d) * pace, a: false });
}
