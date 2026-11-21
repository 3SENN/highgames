// Top Bunk: a sleepover, way past bedtime. One player has claimed the top bunk and a stack of pillows; the other
// three are on the bedroom floor below. Pillows loop down to wherever the top bunk points; the floor scrambles
// and ducks. Everyone on the floor has three cushions to lose, and at none they flop onto the bean bag, out.
// The top bunk wins by bonking all three out before the time runs out; otherwise the floor wins.
//
// Everything happens on the floor, in its x/z plane: +z points at the TV audience and the bunk bed stands at the
// back (-z). A stick's y (up on the phone) runs away from the audience, toward -z.
import type { Rng } from '../rng';

export const BUNK = {
  duration: 30, // seconds the floor has to hold out
  floor: { x: 4.4, back: -0.3, front: 3.3 }, // the open floor the three can run on (x is a half-width)
  hand: { y: 2.75, z: -2.55 }, // where pillows leave the top bunk
  lives: 3, // cushions each
  reload: 0.8, // seconds between throws
  flight: 0.5, // seconds a pillow is in the air…
  flightPerM: 0.055, // …plus this per metre it travels
  arc: 1.1, // how far pillows loop up over the straight line
  landY: 0.5, // pillows come down at about waist height
  hitR: 0.95, // a pillow bonks anyone standing this close to where it comes down…
  duckR: 0.32, // …but someone curled up only on a dead-centre hit
  duck: 0.6, // seconds a duck keeps you small
  duckCooldown: 1.5, // seconds from one duck to the next
  speed: 3.3,
  response: 12, // how quickly running follows the stick
  bodyR: 0.4,
  safe: 1, // seconds a bonked player can't be bonked again
} as const;

export interface Stick {
  x: number;
  y: number;
  a: boolean;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

/** Where the top bunk points on the floor, and whether the Throw button is down. */
export interface Aim {
  x: number;
  z: number;
  fire: boolean;
}

export interface Kid {
  seat: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Heading in the x/z plane (0 faces +z, the audience). */
  face: number;
  lives: number;
  /** Seconds left curled up small. */
  duck: number;
  /** Seconds until the next duck. */
  duckCd: number;
  /** Game time of the last duck. */
  duckAt: number;
  /** Seconds left of not being bonkable after a bonk. */
  safe: number;
  outAt: number | null;
  /** The duck button was down last step (a duck needs a fresh press). */
  pressed: boolean;
  bonks: number;
  /** Pillows that came down right on them while they were curled up (or ducked just in time). */
  dodges: number;
}

export interface Pillow {
  id: number;
  x0: number;
  z0: number;
  tx: number;
  tz: number;
  age: number;
  flight: number;
}

/** A pillow that came down on a phone player who may have pressed Duck just before (their press is still on the way). */
interface Pending {
  seat: number;
  landed: number;
  until: number;
  centre: boolean;
}

export interface Room {
  top: number;
  kids: Kid[];
  aim: { x: number; z: number };
  reload: number;
  pillows: Pillow[];
  pending: Pending[];
  time: number;
  thrown: number;
  nextId: number;
  /** When the last of the floor went out (the top bunk's win). */
  doneAt: number | null;
}

export interface RoomEvents {
  thrown: Pillow | null;
  landed: Pillow[];
  bonked: number[];
  dodged: number[];
  ducked: number[];
  out: number[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MID_Z = (BUNK.floor.back + BUNK.floor.front) / 2;
const HALF_Z = (BUNK.floor.front - BUNK.floor.back) / 2;

/** Keeps a point on the floor (aiming may reach a little past the edge). */
export function clampAim(x: number, z: number): { x: number; z: number } {
  return { x: clamp(x, -BUNK.floor.x - 0.3, BUNK.floor.x + 0.3), z: clamp(z, BUNK.floor.back - 0.3, BUNK.floor.front + 0.3) };
}

/** The floor spot for a phone's pointer (-1..1, y up): right is right on screen, up is further back. */
export function aimPoint(ax: number, ay: number): { x: number; z: number } {
  return clampAim(ax * BUNK.floor.x * 1.1, MID_Z - ay * HALF_Z * 1.15);
}

export function flightTime(x0: number, z0: number, tx: number, tz: number): number {
  return BUNK.flight + BUNK.flightPerM * Math.hypot(tx - x0, tz - z0);
}

/** Where a pillow is now: a loop from the top bunk down to its spot. */
export function pillowPos(p: Pillow): { x: number; y: number; z: number; s: number } {
  const s = Math.min(1, p.age / p.flight);
  return {
    x: p.x0 + (p.tx - p.x0) * s,
    z: p.z0 + (p.tz - p.z0) * s,
    y: BUNK.hand.y + (BUNK.landY - BUNK.hand.y) * s + BUNK.arc * 4 * s * (1 - s),
    s,
  };
}

export function newRoom(top: number, floor: readonly number[]): Room {
  const n = floor.length;
  const kids = floor.map((seat, k) => ({
    seat,
    x: (k - (n - 1) / 2) * 2.9,
    z: MID_Z + 0.5,
    vx: 0,
    vz: 0,
    face: 0,
    lives: BUNK.lives,
    duck: 0,
    duckCd: 0,
    duckAt: -Infinity,
    safe: 0,
    outAt: null,
    pressed: false,
    bonks: 0,
    dodges: 0,
  }));
  return { top, kids, aim: { x: 0, z: MID_Z }, reload: 0.4, pillows: [], pending: [], time: 0, thrown: 0, nextId: 1, doneAt: null };
}

export function kidOf(r: Room, seat: number): Kid | undefined {
  return r.kids.find((k) => k.seat === seat);
}

export function isOver(r: Room): boolean {
  return r.doneAt !== null || r.time >= BUNK.duration;
}

export function topWins(r: Room): boolean {
  return r.kids.length > 0 && r.kids.every((k) => k.outAt !== null);
}

function bonk(r: Room, k: Kid, ev: RoomEvents): void {
  k.lives = Math.max(0, k.lives - 1);
  k.safe = BUNK.safe;
  k.bonks += 1;
  ev.bonked.push(k.seat);
  if (k.lives === 0) {
    k.outAt = r.time;
    k.duck = 0;
    k.vx = k.vz = 0;
    ev.out.push(k.seat);
    if (topWins(r)) r.doneAt = r.time;
  }
}

function separate(r: Room): void {
  const live = r.kids.filter((k) => k.outAt === null);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i] as Kid;
      const b = live[j] as Kid;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = BUNK.bodyR * 2;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const half = (min - d) / 2;
      a.x -= nx * half;
      a.z -= nz * half;
      b.x += nx * half;
      b.z += nz * half;
    }
  }
  for (const k of live) {
    k.x = clamp(k.x, -BUNK.floor.x, BUNK.floor.x);
    k.z = clamp(k.z, BUNK.floor.back, BUNK.floor.front);
  }
}

/**
 * Advances the room by dt seconds. `sticks` and `lag` are per seat; `lag` is how many seconds a phone's Duck press
 * may still be on its way (half its round trip), so a pillow that lands in that moment waits for it.
 */
export function stepRoom(r: Room, aim: Aim, sticks: readonly Stick[], dt: number, lag: readonly number[] = []): RoomEvents {
  const ev: RoomEvents = { thrown: null, landed: [], bonked: [], dodged: [], ducked: [], out: [] };
  if (isOver(r)) return ev;
  r.time += dt;
  r.reload = Math.max(0, r.reload - dt);

  r.aim = clampAim(aim.x, aim.z);
  if (aim.fire && r.reload <= 0) {
    const x0 = clamp(r.aim.x * 0.15, -0.5, 0.5);
    const p: Pillow = { id: r.nextId++, x0, z0: BUNK.hand.z, tx: r.aim.x, tz: r.aim.z, age: 0, flight: flightTime(x0, BUNK.hand.z, r.aim.x, r.aim.z) };
    r.pillows.push(p);
    r.reload = BUNK.reload;
    r.thrown += 1;
    ev.thrown = p;
  }

  const follow = Math.min(1, BUNK.response * dt);
  for (const k of r.kids) {
    if (k.outAt !== null) continue;
    k.duck = Math.max(0, k.duck - dt);
    k.duckCd = Math.max(0, k.duckCd - dt);
    k.safe = Math.max(0, k.safe - dt);
    const input = sticks[k.seat] ?? IDLE;
    if (input.a && !k.pressed && k.duckCd <= 0) {
      k.duck = BUNK.duck;
      k.duckCd = BUNK.duckCooldown;
      k.duckAt = r.time;
      ev.ducked.push(k.seat);
    }
    k.pressed = input.a;
    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    // Curled up small, you can't run.
    const speed = k.duck > 0 ? 0 : BUNK.speed;
    k.vx += (ix * speed - k.vx) * follow;
    k.vz += (-iy * speed - k.vz) * follow;
    k.x += k.vx * dt;
    k.z += k.vz * dt;
    if (Math.hypot(k.vx, k.vz) > 0.4) k.face = Math.atan2(k.vx, k.vz);
  }
  separate(r);

  // Pillows in the air; the ones that come down.
  const flying: Pillow[] = [];
  for (const p of r.pillows) {
    p.age += dt;
    if (p.age < p.flight) {
      flying.push(p);
      continue;
    }
    ev.landed.push(p);
    for (const k of r.kids) {
      if (k.outAt !== null || k.safe > 0) continue;
      const d = Math.hypot(k.x - p.tx, k.z - p.tz);
      if (d > BUNK.hitR) continue;
      const centre = d <= BUNK.duckR;
      const wait = lag[k.seat] ?? 0;
      if (k.duck > 0) {
        if (centre) bonk(r, k, ev);
        else {
          k.dodges += 1;
          ev.dodged.push(k.seat);
        }
      } else if (wait > 0) {
        r.pending.push({ seat: k.seat, landed: r.time, until: r.time + wait, centre });
      } else {
        bonk(r, k, ev);
      }
    }
  }
  r.pillows = flying;

  // Pillows that came down on someone whose Duck may have been on its way: did it come?
  r.pending = r.pending.filter((h) => {
    if (r.time < h.until && !isOver(r)) return true;
    const k = kidOf(r, h.seat);
    if (!k || k.outAt !== null || k.safe > 0) return false;
    if (!h.centre && k.duckAt >= h.landed - 1e-9) {
      k.dodges += 1;
      ev.dodged.push(k.seat);
    } else {
      bonk(r, k, ev);
    }
    return false;
  });
  return ev;
}

/** The winning side scores 1, the other 0; teammates always the same. */
export function bunkScores(r: Room, seats: number): number[] {
  const top = topWins(r);
  return Array.from({ length: seats }, (_, s) => {
    if (s === r.top) return top ? 1 : 0;
    if (kidOf(r, s)) return top ? 0 : 1;
    return 0;
  });
}

// ------------------------------------------------------------------ computer players

/** The top bunk's brain: picks someone, leads them a little, and wobbles its aim as much as it is sleepy. */
export interface TopBrain {
  skill: number;
  next: number;
  target: number | null;
  /** Where it wants the pillow to come down (before its aim error). */
  want: { x: number; z: number };
  err: { x: number; z: number };
  aim: { x: number; z: number };
  /** No throwing before this (a sleepy top bunk dawdles between throws). */
  holdUntil: number;
}

export function newTopBrain(skill: number): TopBrain {
  return { skill, next: 0, target: null, want: { x: 0, z: MID_Z }, err: { x: 0, z: 0 }, aim: { x: 0, z: MID_Z }, holdUntil: 0.6 + (1 - skill) * 0.6 };
}

function gauss(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 1.15;
}

function rollError(b: TopBrain, rng: Rng): void {
  const spread = 0.1 + (1 - b.skill) * 0.7;
  b.err = { x: gauss(rng) * spread, z: gauss(rng) * spread };
}

function thinkTop(r: Room, b: TopBrain, rng: Rng): void {
  const live = r.kids.filter((k) => k.outAt === null);
  if (!live.length) return;
  const current = live.find((k) => k.seat === b.target);
  if (!current || rng() < 0.06) {
    // Sharp: someone who can't duck right now, close to where the aim already is. Sleepy: whoever.
    const score = (k: Kid) => -Math.hypot(k.x - b.aim.x, k.z - b.aim.z) * 0.4 + (k.duckCd > 0.6 ? 1.5 : 0) + (k.safe > 0 ? -4 : 0) + rng() * (1.5 + (1 - b.skill) * 4);
    b.target = live.reduce((best, k) => (score(k) > score(best) ? k : best)).seat;
  }
  const k = kidOf(r, b.target ?? -1);
  if (!k) return;
  const t = flightTime(0, BUNK.hand.z, k.x, k.z);
  const lead = 0.2 + b.skill * 0.8;
  b.want = clampAim(k.x + k.vx * t * lead, k.z + k.vz * t * lead);
}

/** The computer top bunk's aim and throw for this step. */
export function cpuTop(r: Room, b: TopBrain, rng: Rng, dt: number): Aim {
  if (r.time >= b.next) {
    thinkTop(r, b, rng);
    b.next = r.time + 0.08 + (1 - b.skill) * 0.16 + rng() * 0.05;
  }
  const goal = clampAim(b.want.x + b.err.x, b.want.z + b.err.z);
  const dx = goal.x - b.aim.x;
  const dz = goal.z - b.aim.z;
  const d = Math.hypot(dx, dz);
  const step = (5 + b.skill * 9) * dt;
  if (d <= step) b.aim = goal;
  else b.aim = { x: b.aim.x + (dx / d) * step, z: b.aim.z + (dz / d) * step };
  const fire = r.reload <= 0 && r.time >= b.holdUntil && d < 0.45 && b.target !== null;
  if (fire) {
    b.holdUntil = r.time + BUNK.reload + (1 - b.skill) * 0.5 * rng();
    rollError(b, rng);
    b.target = rng() < 0.3 ? null : b.target;
  }
  return { x: b.aim.x, z: b.aim.z, fire };
}

/** A computer player on the floor: wanders about, and spots incoming pillows (sooner and more often when sharp). */
export interface KidBrain {
  skill: number;
  next: number;
  way: { x: number; z: number };
  /** Pillow id -> game time this player notices it (Infinity: never noticed). */
  seen: Map<number, number>;
  x: number;
  y: number;
  press: boolean;
}

export function newKidBrain(skill: number): KidBrain {
  return { skill, next: 0, way: { x: 0, z: MID_Z }, seen: new Map(), x: 0, y: 0, press: false };
}

function pickWay(r: Room, k: Kid, b: KidBrain, rng: Rng): void {
  let best = { x: 0, z: MID_Z };
  let bestScore = -Infinity;
  const tries = 1 + Math.round(b.skill * 5);
  for (let i = 0; i < tries; i++) {
    const p = { x: (rng() * 2 - 1) * BUNK.floor.x * 0.9, z: BUNK.floor.back + 0.3 + rng() * (BUNK.floor.front - BUNK.floor.back - 0.6) };
    // Away from the top bunk's aim and from the others (one pillow can't get two), not too far to walk.
    let score = Math.min(3.5, Math.hypot(p.x - r.aim.x, p.z - r.aim.z)) - Math.hypot(p.x - k.x, p.z - k.z) * 0.15;
    for (const o of r.kids) if (o !== k && o.outAt === null) score += Math.min(2.5, Math.hypot(p.x - o.x, p.z - o.z)) * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  b.way = best;
}

function thinkKid(r: Room, k: Kid, b: KidBrain, rng: Rng): void {
  for (const p of r.pillows) {
    if (b.seen.has(p.id)) continue;
    const notices = rng() < 0.6 + b.skill * 0.25;
    b.seen.set(p.id, notices ? r.time - p.age + 0.18 + (1 - b.skill) * 0.24 + rng() * 0.2 : Infinity);
  }
  for (const id of b.seen.keys()) if (!r.pillows.some((p) => p.id === id)) b.seen.delete(id);

  // The most urgent pillow coming down near us that we have noticed.
  let threat: Pillow | null = null;
  for (const p of r.pillows) {
    if ((b.seen.get(p.id) ?? Infinity) > r.time) continue;
    if (Math.hypot(k.x - p.tx, k.z - p.tz) > BUNK.hitR + 0.35) continue;
    if (!threat || p.flight - p.age < threat.flight - threat.age) threat = p;
  }
  if (threat) {
    const left = threat.flight - threat.age;
    const dx = k.x - threat.tx;
    const dz = k.z - threat.tz;
    const d = Math.hypot(dx, dz);
    const need = Math.max(0, BUNK.hitR + 0.12 - d);
    const run = need / BUNK.speed + 0.12;
    if (k.duckCd <= 0 && left < BUNK.duck - 0.08 && (run > left || rng() < 0.25)) {
      b.press = true;
      b.x = b.y = 0;
      return;
    }
    // Run straight away from where it will land (sideways if it is right on top of us).
    let ax = d > 0.05 ? dx / d : rng() < 0.5 ? 1 : -1;
    let az = d > 0.05 ? dz / d : 0;
    // Pinned against a wall: slide along it instead.
    if (Math.abs(k.x) > BUNK.floor.x - 0.2 && Math.sign(ax) === Math.sign(k.x)) ax = 0;
    if ((k.z < BUNK.floor.back + 0.2 && az < 0) || (k.z > BUNK.floor.front - 0.2 && az > 0)) az = 0;
    if (ax === 0 && az === 0) ax = k.x > 0 ? -1 : 1;
    const len = Math.hypot(ax, az) || 1;
    b.x = ax / len;
    b.y = -az / len;
    return;
  }

  // Nothing coming: drift about, away from the aim.
  const toWay = Math.hypot(b.way.x - k.x, b.way.z - k.z);
  if (toWay < 0.4 || rng() < 0.04 + b.skill * 0.04) pickWay(r, k, b, rng);
  const wx = b.way.x - k.x;
  const wz = b.way.z - k.z;
  const wl = Math.hypot(wx, wz) || 1;
  const pace = 0.35 + b.skill * 0.45;
  const wobble = (rng() - 0.5) * (1 - b.skill) * 0.8;
  const c = Math.cos(wobble);
  const s = Math.sin(wobble);
  const vx = (wx / wl) * c - (wz / wl) * s;
  const vz = (wx / wl) * s + (wz / wl) * c;
  b.x = vx * pace;
  b.y = -vz * pace;
}

/** A computer floor player's stick for this step. */
export function cpuKid(r: Room, seat: number, b: KidBrain, rng: Rng): Stick {
  const k = kidOf(r, seat);
  if (!k || k.outAt !== null) return IDLE;
  if (r.time >= b.next) {
    thinkKid(r, k, b, rng);
    b.next = r.time + 0.05 + (1 - b.skill) * 0.15 + rng() * 0.05;
  }
  const a = b.press;
  b.press = false;
  return { x: b.x, y: b.y, a };
}
