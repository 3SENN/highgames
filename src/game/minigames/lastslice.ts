// Last Slice: it is the middle of the night and there is one slice of pizza left on the kitchen island.
// One guard runs around the plate and bumps snackers away ("nope!"); a snacker who keeps touching the plate
// for 1.5 s grabs the slice. The guard wins by holding out until the time runs out.
//
// Everything happens on the island top, in its x/z plane: the plate sits at the origin, +z points at the TV
// audience. A stick's y (up on the phone) runs away from the audience, toward -z.
import type { Rng } from '../rng.js';

export const SLICE = {
  duration: 30, // seconds the guard has to hold out
  bounds: { x: 5.4, z: 3.1 }, // half-size of the island top the companions can run on
  plateR: 1.0, // the plate; touching it counts as touching the slice
  bodyR: 0.42,
  guardWeight: 0.8, // when the guard bumps into a snacker, the snacker gives way this much
  guardSpeed: 5.4,
  snackerSpeed: 3.8,
  response: 10, // how quickly running follows the stick
  grab: 1.5, // seconds a snacker has to keep touching the plate
  touch: 0.15, // reach beyond bodies merely touching
  nopeRadius: 2.4, // how far the guard's bump reaches (centre to centre)
  nopeCooldown: 0.75,
  knock: 12, // speed a nope sends a snacker sliding at
  friction: 16, // how quickly that slide stops (units per second, per second)
  stun: 0.75, // seconds a nope'd snacker is dazed
} as const;

/** Distance from the plate's centre at which a companion's body touches the plate. */
export const CONTACT = SLICE.plateR + SLICE.bodyR;

export interface Stick {
  x: number;
  y: number;
  a: boolean;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

export interface Runner {
  x: number;
  z: number;
  /** Running velocity. */
  vx: number;
  vz: number;
  /** Sliding velocity from a nope. */
  kx: number;
  kz: number;
  stun: number;
  /** Seconds this snacker has been touching the plate. */
  grab: number;
  /** Snackers: times nope'd. The guard: snackers bumped. */
  nopes: number;
  /** Heading in the x/z plane (0 faces +z, the audience). */
  face: number;
  /** The action button was down last step (a nope needs a fresh press). */
  pressed: boolean;
}

export interface Kitchen {
  guard: number;
  snackers: number[];
  runners: Runner[];
  cooldown: number;
  time: number;
  grabbedBy: number | null;
}

export interface StepEvents {
  /** Snackers bumped by a nope this step (empty array: a nope that missed), or null for no nope. */
  nope: number[] | null;
  grabbed: number | null;
}

const SPAWNS: readonly [number, number][] = [
  [-4.7, -1.4],
  [4.7, -1.4],
  [0, -2.9],
];

function runner(x: number, z: number): Runner {
  return { x, z, vx: 0, vz: 0, kx: 0, kz: 0, stun: 0, grab: 0, nopes: 0, face: 0, pressed: false };
}

export function newKitchen(seats: number, guard: number, snackers: readonly number[]): Kitchen {
  const runners = Array.from({ length: seats }, (_, seat) => {
    if (seat === guard) return runner(0, CONTACT + 0.4);
    const k = snackers.indexOf(seat);
    const [x, z] = SPAWNS[k % SPAWNS.length] ?? [0, -2.9];
    return runner(x, z);
  });
  return { guard, snackers: [...snackers], runners, cooldown: 0, time: 0, grabbedBy: null };
}

export function isOver(k: Kitchen): boolean {
  return k.grabbedBy !== null || k.time >= SLICE.duration;
}

/** Keeps bodies on the island, off the plate and out of each other. The guard shoulders snackers aside. */
function separate(k: Kitchen): void {
  const rs = k.runners;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i] as Runner;
      const b = rs[j] as Runner;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = SLICE.bodyR * 2;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const overlap = min - d;
      const share = i === k.guard ? SLICE.guardWeight : j === k.guard ? 1 - SLICE.guardWeight : 0.5;
      a.x -= nx * overlap * (1 - share);
      a.z -= nz * overlap * (1 - share);
      b.x += nx * overlap * share;
      b.z += nz * overlap * share;
    }
  }
  for (const r of rs) {
    const d = Math.hypot(r.x, r.z);
    if (d < CONTACT) {
      const nx = d > 1e-6 ? r.x / d : 0;
      const nz = d > 1e-6 ? r.z / d : 1;
      r.x = nx * CONTACT;
      r.z = nz * CONTACT;
    }
    if (Math.abs(r.x) > SLICE.bounds.x) {
      r.x = Math.sign(r.x) * SLICE.bounds.x;
      r.kx = 0;
    }
    if (Math.abs(r.z) > SLICE.bounds.z) {
      r.z = Math.sign(r.z) * SLICE.bounds.z;
      r.kz = 0;
    }
  }
}

/** Bumps every snacker in reach away from the guard. Returns the seats it hit. */
function nope(k: Kitchen): number[] {
  const g = k.runners[k.guard];
  if (!g) return [];
  const hit: number[] = [];
  for (const s of k.snackers) {
    const r = k.runners[s];
    if (!r) continue;
    let dx = r.x - g.x;
    let dz = r.z - g.z;
    const d = Math.hypot(dx, dz);
    if (d > SLICE.nopeRadius) continue;
    if (d < 1e-6) {
      dx = r.x || 0;
      dz = r.z || 1;
    }
    const len = Math.hypot(dx, dz) || 1;
    r.kx = (dx / len) * SLICE.knock;
    r.kz = (dz / len) * SLICE.knock;
    r.stun = SLICE.stun;
    r.grab = 0;
    r.nopes += 1;
    hit.push(s);
  }
  g.nopes += hit.length;
  return hit;
}

/** Advances the kitchen by dt seconds with one stick per seat. */
export function stepKitchen(k: Kitchen, inputs: readonly Stick[], dt: number): StepEvents {
  const ev: StepEvents = { nope: null, grabbed: null };
  if (isOver(k)) return ev;
  k.time += dt;
  k.cooldown = Math.max(0, k.cooldown - dt);
  const follow = Math.min(1, SLICE.response * dt);
  k.runners.forEach((r, seat) => {
    const input = inputs[seat] ?? IDLE;
    const speed = seat === k.guard ? SLICE.guardSpeed : SLICE.snackerSpeed;
    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    if (r.stun > 0) {
      r.stun = Math.max(0, r.stun - dt);
      ix = 0;
      iy = 0;
    }
    r.vx += (ix * speed - r.vx) * follow;
    r.vz += (-iy * speed - r.vz) * follow;
    const kl = Math.hypot(r.kx, r.kz);
    if (kl > 0) {
      const next = Math.max(0, kl - SLICE.friction * dt);
      r.kx *= next / kl;
      r.kz *= next / kl;
    }
    r.x += (r.vx + r.kx) * dt;
    r.z += (r.vz + r.kz) * dt;
    if (Math.hypot(r.vx, r.vz) > 0.4) r.face = Math.atan2(r.vx, r.vz);
  });
  separate(k);

  const g = k.runners[k.guard];
  if (g) {
    const a = (inputs[k.guard] ?? IDLE).a;
    if (a && !g.pressed && k.cooldown <= 0) {
      k.cooldown = SLICE.nopeCooldown;
      ev.nope = nope(k);
    }
    g.pressed = a;
  }

  for (const s of k.snackers) {
    const r = k.runners[s];
    if (!r) continue;
    const touching = r.stun <= 0 && Math.hypot(r.x, r.z) <= CONTACT + SLICE.touch;
    r.grab = touching ? r.grab + dt : 0;
    if (r.grab >= SLICE.grab && k.grabbedBy === null) {
      k.grabbedBy = s;
      ev.grabbed = s;
    }
  }
  return ev;
}

/** The winning side scores 1, the losing side 0; teammates always the same. */
export function sliceScores(k: Kitchen, seats: number): number[] {
  const guardWins = k.grabbedBy === null;
  return Array.from({ length: seats }, (_, s) => {
    if (s === k.guard) return guardWins ? 1 : 0;
    if (k.snackers.includes(s)) return guardWins ? 0 : 1;
    return 0;
  });
}

// ------------------------------------------------------------------ computer players

export interface Brain {
  skill: number;
  /** Game time of the next decision: sleepy players react late. */
  next: number;
  /** Snackers: the side of the plate they are going for (an angle in the x/z plane). */
  lane: number;
  x: number;
  y: number;
  /** A nope press waiting to be sent (for one step only, so the next one is a fresh press). */
  press: boolean;
}

export function newBrain(k: Kitchen, seat: number, skill: number): Brain {
  const r = k.runners[seat];
  return { skill, next: 0, lane: r ? Math.atan2(r.z, r.x) : 0, x: 0, y: 0, press: false };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Which way to run to reach (tx, tz), going round the plate instead of into it. World x/z, unit length. */
function steer(x: number, z: number, tx: number, tz: number): [number, number] {
  const d = Math.hypot(x, z);
  const from = Math.atan2(z, x);
  const da = wrap(Math.atan2(tz, tx) - from);
  let vx = tx - x;
  let vz = tz - z;
  if (Math.abs(da) > 0.55 && d < CONTACT + 1.4) {
    const dir = Math.sign(da) || 1;
    const outward = (CONTACT + 0.25 - d) * 1.6;
    vx = -Math.sin(from) * dir + Math.cos(from) * outward;
    vz = Math.cos(from) * dir + Math.sin(from) * outward;
  }
  const len = Math.hypot(vx, vz);
  return len > 1e-6 ? [vx / len, vz / len] : [0, 0];
}

function aim(b: Brain, vx: number, vz: number, rng: Rng, speed = 1): void {
  const wobble = (rng() - 0.5) * (1 - b.skill) * 1.1;
  const c = Math.cos(wobble);
  const s = Math.sin(wobble);
  const wx = vx * c - vz * s;
  const wz = vx * s + vz * c;
  b.x = wx * speed;
  b.y = -wz * speed;
}

function thinkGuard(k: Kitchen, seat: number, b: Brain, rng: Rng): void {
  const g = k.runners[seat];
  if (!g) return;
  const live = k.snackers.map((s) => ({ s, r: k.runners[s] as Runner })).filter((t) => t.r && t.r.stun <= 0);
  if (!live.length) {
    // Everyone is dazed: drift back toward the plate.
    const [vx, vz] = steer(g.x, g.z, g.x * 0.5, g.z * 0.5);
    aim(b, vx, vz, rng, Math.hypot(g.x, g.z) > CONTACT + 0.6 ? 1 : 0);
    return;
  }
  const danger = (r: Runner) => 0.3 + (r.grab / SLICE.grab) * 2 + Math.max(0, 1 - (Math.hypot(r.x, r.z) - CONTACT) / 4);
  const angle = (r: Runner) => Math.atan2(r.z, r.x);
  const ga = Math.atan2(g.z, g.x);
  let ta: number;
  if (rng() < 0.5 + b.skill * 0.5) {
    // Sharp: the spot on the rim that covers the most danger (from the rim a nope reaches about 100° each way),
    // counting the time it takes to run there.
    const spots = live.map((t) => angle(t.r));
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = angle((live[i] as (typeof live)[number]).r);
        spots.push(a + wrap(angle((live[j] as (typeof live)[number]).r) - a) / 2);
      }
    }
    const value = (spot: number) =>
      live.reduce((sum, t) => sum + (Math.abs(wrap(angle(t.r) - spot)) < 1.65 ? danger(t.r) : 0), 0) - Math.abs(wrap(spot - ga)) * 0.35;
    ta = spots.reduce((best, s) => (value(s) > value(best) ? s : best));
  } else {
    // Sleepy: whoever is nearest.
    const near = live.reduce((best, t) => (Math.hypot(t.r.x - g.x, t.r.z - g.z) < Math.hypot(best.r.x - g.x, best.r.z - g.z) ? t : best));
    ta = angle(near.r);
  }
  const tx = Math.cos(ta) * (CONTACT + 0.15);
  const tz = Math.sin(ta) * (CONTACT + 0.15);
  const [vx, vz] = steer(g.x, g.z, tx, tz);
  const close = Math.hypot(tx - g.x, tz - g.z);
  aim(b, vx, vz, rng, close < 0.3 ? close / 0.3 : 1);
  if (k.cooldown <= 0) {
    const reach = SLICE.nopeRadius * (0.9 + (1 - b.skill) * 0.15);
    const inReach = live.filter((t) => Math.hypot(t.r.x - g.x, t.r.z - g.z) <= reach);
    const touching = live.filter((t) => t.r.grab > 0);
    const worth = inReach.length >= 2 || inReach.some((t) => t.r.grab > 0.15 + (1 - b.skill) * 0.4) || (inReach.length > 0 && touching.every((t) => inReach.includes(t)));
    if (worth && rng() < 0.6 + b.skill * 0.4) b.press = true;
  }
}

function thinkSnacker(k: Kitchen, seat: number, b: Brain, rng: Rng): void {
  const me = k.runners[seat];
  const g = k.runners[k.guard];
  if (!me || !g) return;
  const ga = Math.atan2(g.z, g.x);
  const gd = Math.hypot(g.x, g.z);
  // Sharp snackers pick the side of the plate the guard is not on, and spread out so one nope can't get them all.
  if (rng() < b.skill) {
    const diff = wrap(b.lane - ga);
    if (Math.abs(diff) < 1.1) b.lane += (Math.sign(diff) || 1) * 0.45;
    for (const s of k.snackers) {
      const o = k.runners[s];
      if (s === seat || !o) continue;
      const apart = wrap(b.lane - Math.atan2(o.z, o.x));
      if (Math.abs(apart) < 1.9) b.lane += (Math.sign(apart) || 1) * 0.2;
    }
  }
  b.lane = wrap(b.lane + (rng() - 0.5) * 0.35);
  const toGuard = Math.hypot(g.x - me.x, g.z - me.z);
  const ready = k.cooldown <= 0.1;
  let tx: number;
  let tz: number;
  let speed = 1;
  if (toGuard < SLICE.nopeRadius + 0.2 && ready && me.grab < SLICE.grab * 0.5 && rng() < b.skill * 0.5) {
    // Back off out of reach.
    const away = toGuard || 1;
    tx = me.x + ((me.x - g.x) / away) * 2;
    tz = me.z + ((me.z - g.z) / away) * 2;
  } else if (ready && Math.abs(wrap(b.lane - ga)) < 0.9 && gd < CONTACT + 1 && rng() < b.skill) {
    // The guard is on our side: wait just out of reach.
    tx = Math.cos(b.lane) * (CONTACT + 2.3);
    tz = Math.sin(b.lane) * (CONTACT + 2.3);
    const left = Math.hypot(tx - me.x, tz - me.z);
    speed = left < 0.4 ? left / 0.4 : 1;
  } else {
    // Go for it: lean right into the plate.
    tx = Math.cos(b.lane) * (CONTACT - 0.2);
    tz = Math.sin(b.lane) * (CONTACT - 0.2);
  }
  const [vx, vz] = steer(me.x, me.z, tx, tz);
  aim(b, vx, vz, rng, speed);
}

/** A computer player's stick for this step. */
export function cpuStick(k: Kitchen, seat: number, b: Brain, rng: Rng): Stick {
  if (k.time >= b.next) {
    if (seat === k.guard) thinkGuard(k, seat, b, rng);
    else thinkSnacker(k, seat, b, rng);
    // The guard has one job and watches the plate; snackers are easier to distract.
    b.next = k.time + 0.08 + (1 - b.skill) * (seat === k.guard ? 0.18 : 0.26) + rng() * 0.08;
  }
  const a = b.press;
  b.press = false;
  return { x: b.x, y: b.y, a };
}
