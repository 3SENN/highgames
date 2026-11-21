// Tickle Monster: a backyard at dusk. One player wears a big blanket-monster costume and chases the other three
// round the garden furniture. A tickled player giggles and freezes on the spot until a free teammate stands next
// to them and holds Free! for 0.8 s. The monster wins by having all three frozen at the same moment before the
// time runs out; otherwise the three win.
//
// Everything happens on the lawn, in its x/z plane: +z points at the TV audience. A stick's y (up on the phone)
// runs away from the audience, toward -z. The yard is stepped in fixed 1/120 s steps whatever the frame rate.
import type { Rng } from '../rng.js';

export const TICKLE = {
  duration: 35, // seconds the three have to hold out
  bounds: { x: 6.4, z: 3.7 }, // half-size of the lawn
  monsterR: 0.62, // the costume is big
  runnerR: 0.36,
  monsterSpeed: 4.4, // a bit faster than everyone else
  runnerSpeed: 3.9,
  response: 10, // how quickly running follows the stick
  reach: 0.12, // a tickle lands this far beyond bodies merely touching
  freeReach: 0.55, // gap between two runners (edge to edge) within which Free! works
  freeTime: 0.8, // seconds of holding Free! next to a frozen teammate
  thawDecay: 2.5, // how fast freeing drains when nobody is holding Free! (seconds per second)
  immune: 1.2, // seconds a freed runner can't be tickled again
  step: 1 / 120,
} as const;

export interface Stick {
  x: number;
  y: number;
  a: boolean;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

export type Collider = { shape: 'round'; x: number; z: number; r: number } | { shape: 'box'; x: number; z: number; hx: number; hz: number };

/** The garden furniture, where the TV puts its models. Nobody can walk through any of it. */
export const PROPS = {
  firepit: { shape: 'round', x: 0.2, z: 0.5, r: 0.6 },
  table: { shape: 'round', x: -2.7, z: -1.2, r: 1.0 },
  lounger: { shape: 'box', x: 3.2, z: 1.9, hx: 1.1, hz: 0.4 },
  bbq: { shape: 'round', x: 3.7, z: -1.8, r: 0.42 },
  planter: { shape: 'round', x: -4.3, z: 1.7, r: 0.5 },
} as const satisfies Record<string, Collider>;

export const COLLIDERS: readonly Collider[] = Object.values(PROPS);

export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
  /** Heading in the x/z plane (0 faces +z, the audience). */
  face: number;
  frozen: boolean;
  /** Seconds of Free! done on this frozen runner. */
  thaw: number;
  /** Who is freeing this runner right now (for the ring's colour), or null. */
  helper: number | null;
  /** Seconds left that a freed runner can't be tickled. */
  immune: number;
  /** Runners: times tickled. The monster: tickles given. */
  tickles: number;
  /** Runners: teammates freed. */
  frees: number;
}

export interface Yard {
  monster: number;
  runners: number[];
  bodies: Body[];
  time: number;
  /** Game time when the last free runner was tickled (the monster wins), or null. */
  caughtAt: number | null;
  /** Time not yet stepped (less than one fixed step). */
  carry: number;
}

export interface YardEvents {
  /** Runners tickled. */
  tickled: number[];
  /** Runners freed, and who freed them. */
  freed: { seat: number; by: number }[];
}

const MONSTER_SPAWN: readonly [number, number] = [0.2, -2.4];
const RUNNER_SPAWNS: readonly [number, number][] = [
  [-5.2, -0.4],
  [-1.2, 2.9],
  [5.2, 0.0],
];

function body(x: number, z: number, r: number): Body {
  return { x, z, vx: 0, vz: 0, r, face: 0, frozen: false, thaw: 0, helper: null, immune: 0, tickles: 0, frees: 0 };
}

export function newYard(seats: number, monster: number, runners: readonly number[]): Yard {
  const bodies = Array.from({ length: seats }, (_, seat) => {
    if (seat === monster) return body(MONSTER_SPAWN[0], MONSTER_SPAWN[1], TICKLE.monsterR);
    const k = runners.indexOf(seat);
    const [x, z] = RUNNER_SPAWNS[(k < 0 ? seat : k) % RUNNER_SPAWNS.length] as [number, number];
    return body(x, z, TICKLE.runnerR);
  });
  bodies.forEach((b, seat) => {
    if (seat !== monster) b.face = Math.atan2(MONSTER_SPAWN[0] - b.x, MONSTER_SPAWN[1] - b.z);
  });
  return { monster, runners: [...runners], bodies, time: 0, caughtAt: null, carry: 0 };
}

export function isOver(y: Yard): boolean {
  return y.caughtAt !== null || y.time >= TICKLE.duration - 1e-9;
}

export const frozenCount = (y: Yard): number => y.runners.filter((s) => y.bodies[s]?.frozen).length;

// ------------------------------------------------------------------ geometry

/** Distance from a point to a collider's surface (negative inside), and the way out. */
function surface(c: Collider, x: number, z: number): { d: number; nx: number; nz: number } {
  if (c.shape === 'round') {
    const dx = x - c.x;
    const dz = z - c.z;
    const len = Math.hypot(dx, dz);
    return len > 1e-9 ? { d: len - c.r, nx: dx / len, nz: dz / len } : { d: -c.r, nx: 0, nz: 1 };
  }
  const dx = x - c.x;
  const dz = z - c.z;
  const ox = Math.abs(dx) - c.hx;
  const oz = Math.abs(dz) - c.hz;
  if (ox > 0 || oz > 0) {
    const px = Math.max(ox, 0);
    const pz = Math.max(oz, 0);
    const len = Math.hypot(px, pz);
    return { d: len, nx: (Math.sign(dx) * px) / len, nz: (Math.sign(dz) * pz) / len };
  }
  // Inside: out through the nearest side.
  return ox > oz ? { d: ox, nx: Math.sign(dx) || 1, nz: 0 } : { d: oz, nx: 0, nz: Math.sign(dz) || 1 };
}

/** Room around a point for a body of radius r: to the nearest furniture or fence (negative: it doesn't fit). */
export function clearance(x: number, z: number, r: number): number {
  let room = Math.min(TICKLE.bounds.x - Math.abs(x), TICKLE.bounds.z - Math.abs(z)) - r;
  for (const c of COLLIDERS) room = Math.min(room, surface(c, x, z).d - r);
  return room;
}

function keepOut(b: Body): void {
  for (let pass = 0; pass < 2; pass++) {
    for (const c of COLLIDERS) {
      const s = surface(c, b.x, b.z);
      if (s.d < b.r) {
        b.x += s.nx * (b.r - s.d);
        b.z += s.nz * (b.r - s.d);
      }
    }
    b.x = Math.max(-TICKLE.bounds.x + b.r, Math.min(TICKLE.bounds.x - b.r, b.x));
    b.z = Math.max(-TICKLE.bounds.z + b.r, Math.min(TICKLE.bounds.z - b.r, b.z));
  }
}

/** Bodies don't overlap. Frozen runners stand their ground; the costume shoulders runners aside. */
function separate(y: Yard): void {
  const bs = y.bodies;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i] as Body;
      const b = bs[j] as Body;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = a.r + b.r;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const overlap = min - d;
      let share = 0.5; // how much of the overlap b gives way
      if (a.frozen && !b.frozen) share = 1;
      else if (b.frozen && !a.frozen) share = 0;
      else if (a.frozen && b.frozen) share = 0.5;
      else if (i === y.monster) share = 0.75;
      else if (j === y.monster) share = 0.25;
      a.x -= nx * overlap * (1 - share);
      a.z -= nz * overlap * (1 - share);
      b.x += nx * overlap * share;
      b.z += nz * overlap * share;
    }
  }
}

const gap = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;

/** Can this free runner's Free! reach that frozen one? */
export function canFree(y: Yard, helper: number, frozen: number): boolean {
  const h = y.bodies[helper];
  const f = y.bodies[frozen];
  if (!h || !f || helper === y.monster || h.frozen || !f.frozen) return false;
  return gap(h, f) <= TICKLE.freeReach;
}

// ------------------------------------------------------------------ stepping

function tick(y: Yard, inputs: readonly Stick[], ev: YardEvents): void {
  const dt = TICKLE.step;
  y.time += dt;
  const follow = 1 - Math.exp(-TICKLE.response * dt);
  y.bodies.forEach((b, seat) => {
    b.immune = Math.max(0, b.immune - dt);
    if (b.frozen) {
      b.vx = b.vz = 0;
      return;
    }
    const input = inputs[seat] ?? IDLE;
    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    const speed = seat === y.monster ? TICKLE.monsterSpeed : TICKLE.runnerSpeed;
    b.vx += (ix * speed - b.vx) * follow;
    b.vz += (-iy * speed - b.vz) * follow;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    if (Math.hypot(b.vx, b.vz) > 0.4) b.face = Math.atan2(b.vx, b.vz);
  });
  separate(y);
  for (const b of y.bodies) keepOut(b);

  // Tickles: the costume touching a free runner.
  const m = y.bodies[y.monster];
  if (m) {
    for (const s of y.runners) {
      const r = y.bodies[s];
      if (!r || r.frozen || r.immune > 0 || gap(m, r) > TICKLE.reach) continue;
      r.frozen = true;
      r.vx = r.vz = 0;
      r.thaw = 0;
      r.helper = null;
      r.tickles += 1;
      m.tickles += 1;
      ev.tickled.push(s);
    }
  }

  // Free!: a teammate next to a frozen runner, holding the button.
  for (const s of y.runners) {
    const f = y.bodies[s];
    if (!f || !f.frozen) continue;
    let helper: number | null = null;
    let best = Infinity;
    for (const h of y.runners) {
      const hb = y.bodies[h];
      if (h === s || !hb || !(inputs[h] ?? IDLE).a || !canFree(y, h, s)) continue;
      const d = gap(hb, f);
      if (d < best) {
        best = d;
        helper = h;
      }
    }
    f.helper = helper;
    if (helper === null) {
      f.thaw = Math.max(0, f.thaw - TICKLE.thawDecay * dt);
      continue;
    }
    f.thaw += dt;
    if (f.thaw >= TICKLE.freeTime) {
      f.frozen = false;
      f.thaw = 0;
      f.helper = null;
      f.immune = TICKLE.immune;
      (y.bodies[helper] as Body).frees += 1;
      ev.freed.push({ seat: s, by: helper });
    }
  }

  if (y.runners.length > 0 && y.caughtAt === null && y.runners.every((s) => y.bodies[s]?.frozen)) y.caughtAt = y.time;
}

/**
 * Advances the yard by dt seconds with one stick per seat, in fixed steps (time left over is carried to the
 * next call). The same sticks hold for every step of the call.
 */
export function stepYard(y: Yard, inputs: readonly Stick[], dt: number): YardEvents {
  const ev: YardEvents = { tickled: [], freed: [] };
  y.carry += Math.max(0, dt);
  while (y.carry >= TICKLE.step - 1e-12 && !isOver(y)) {
    y.carry -= TICKLE.step;
    tick(y, inputs, ev);
  }
  if (isOver(y)) y.carry = 0;
  return ev;
}

/** The winning side scores 1, the losing side 0; teammates always the same. */
export function tickleScores(y: Yard, seats: number): number[] {
  const monsterWins = y.caughtAt !== null;
  return Array.from({ length: seats }, (_, s) => {
    if (s === y.monster) return monsterWins ? 1 : 0;
    if (y.runners.includes(s)) return monsterWins ? 0 : 1;
    return 0;
  });
}

// ------------------------------------------------------------------ computer players

export interface Brain {
  skill: number;
  /** Game time of the next decision: sleepy players react late. */
  next: number;
  x: number;
  y: number;
  a: boolean;
  /** The monster: who it is after. */
  target: number | null;
  /** The last way it ran (x, z), so it doesn't dither between two equally good ways. */
  hx: number;
  hz: number;
  /** Runners: how bold they are about freeing a teammate (0..1, set once). */
  nerve: number;
}

export function newBrain(skill: number, rng: Rng): Brain {
  return { skill, next: 0, x: 0, y: 0, a: false, target: null, hx: 0, hz: 0, nerve: 0.3 + rng() * 0.5 };
}

const DIRS = 20;

/**
 * The best way to run (x, z unit vector) for `want` (a desired direction): ways that run into furniture or the
 * fence soon score badly, open ways score a little better, and the last way it ran gets a small bonus.
 */
function pickWay(b: Body, brain: Brain, wantX: number, wantZ: number, o: { look: number; open: number; hold: number }): [number, number] {
  let bx = 0;
  let bz = 0;
  let best = -Infinity;
  for (let k = 0; k < DIRS; k++) {
    const a = (k / DIRS) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    let room = Infinity;
    for (const step of [0.35, o.look * 0.5, o.look]) room = Math.min(room, clearance(b.x + dx * step, b.z + dz * step, b.r));
    let score = dx * wantX + dz * wantZ + (dx * brain.hx + dz * brain.hz) * o.hold;
    if (room < 0) score -= 1.5 + Math.min(1.5, -room * 2);
    else score += Math.min(room, 1.5) * o.open;
    if (score > best) {
      best = score;
      bx = dx;
      bz = dz;
    }
  }
  return [bx, bz];
}

function aim(brain: Brain, vx: number, vz: number, rng: Rng, speed = 1): void {
  const wobble = (rng() - 0.5) * (1 - brain.skill) * 0.9;
  const c = Math.cos(wobble);
  const s = Math.sin(wobble);
  const wx = vx * c - vz * s;
  const wz = vx * s + vz * c;
  brain.hx = vx;
  brain.hz = vz;
  brain.x = wx * speed;
  brain.y = -wz * speed;
}

function thinkMonster(y: Yard, seat: number, brain: Brain, rng: Rng): void {
  const m = y.bodies[seat] as Body;
  const live = y.runners.filter((s) => !y.bodies[s]?.frozen);
  brain.a = false;
  if (!live.length) {
    aim(brain, 0, 0, rng, 0);
    return;
  }
  const frozen = y.runners.filter((s) => y.bodies[s]?.frozen);
  const cost = (s: number) => {
    const r = y.bodies[s] as Body;
    let c = Math.hypot(r.x - m.x, r.z - m.z) / TICKLE.monsterSpeed;
    c += r.immune > 0 ? r.immune + 0.4 : 0;
    // Sharp monsters go for whoever is busy freeing someone, and for runners with little room left.
    const freeing = frozen.some((f) => canFree(y, s, f));
    if (freeing) c -= 0.3 + brain.skill * 0.7;
    c -= Math.max(0, 1.2 - clearance(r.x, r.z, r.r)) * brain.skill * 0.5;
    if (s === brain.target) c -= 0.35 + (1 - brain.skill) * 0.6;
    return c + rng() * (1 - brain.skill) * 1.2;
  };
  const target = live.reduce((best, s) => (cost(s) < cost(best) ? s : best));
  brain.target = target;
  const r = y.bodies[target] as Body;
  const dist = Math.hypot(r.x - m.x, r.z - m.z);
  const lead = brain.skill * Math.min(0.5, dist / TICKLE.monsterSpeed);
  const tx = r.x + r.vx * lead;
  const tz = r.z + r.vz * lead;
  const len = Math.hypot(tx - m.x, tz - m.z) || 1;
  const [vx, vz] = pickWay(m, brain, (tx - m.x) / len, (tz - m.z) / len, { look: Math.min(1.4, len), open: 0.05, hold: 0.15 });
  // A sleepy monster drags its feet in the heavy blanket.
  aim(brain, vx, vz, rng, 0.86 + brain.skill * 0.14);
}

/** Does the straight line from (ax, az) to (bx, bz) run through furniture (grown by `r`)? */
function blocked(ax: number, az: number, bx: number, bz: number, r: number): boolean {
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (COLLIDERS.some((c) => surface(c, x, z).d < r)) return true;
  }
  return false;
}

/** The best way to run away from (mx, mz): gaining distance, keeping room to move, and (sharp) putting furniture in between. */
function fleeWay(me: Body, brain: Brain, mx: number, mz: number): [number, number] {
  const skill = brain.skill;
  const look = 1.0 + skill * 0.8;
  const now = Math.hypot(me.x - mx, me.z - mz);
  let bx = 0;
  let bz = 0;
  let best = -Infinity;
  for (let k = 0; k < DIRS; k++) {
    const a = (k / DIRS) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const px = me.x + dx * look;
    const pz = me.z + dz * look;
    let room = Infinity;
    for (const step of [0.35, look * 0.5, look]) room = Math.min(room, clearance(me.x + dx * step, me.z + dz * step, me.r));
    let score = (Math.hypot(px - mx, pz - mz) - now) / look + (dx * brain.hx + dz * brain.hz) * 0.25;
    if (room < 0) score -= 2 + Math.min(1.5, -room * 2);
    else score += Math.min(room, 1.5) * (0.2 + skill * 0.35);
    if (skill > 0.3 && blocked(mx, mz, px, pz, TICKLE.monsterR * 0.8)) score += (skill - 0.3) * 0.9;
    if (score > best) {
      best = score;
      bx = dx;
      bz = dz;
    }
  }
  return [bx, bz];
}

function thinkRunner(y: Yard, seat: number, brain: Brain, rng: Rng): void {
  const me = y.bodies[seat] as Body;
  const m = y.bodies[y.monster];
  brain.a = false;
  if (me.frozen || !m) {
    aim(brain, 0, 0, rng, 0);
    return;
  }
  const skill = brain.skill;
  const toM = Math.hypot(m.x - me.x, m.z - me.z) || 1;
  // Where the monster will be in a moment (sharp runners look further ahead).
  const ahead = 0.1 + skill * 0.35;
  const mx = m.x + m.vx * ahead;
  const mz = m.z + m.vz * ahead;
  const dm = Math.hypot(mx - me.x, mz - me.z);
  // Is it coming for me? Sharp runners read where it's heading; sleepy ones mostly notice how close it is.
  const heading = (m.vx * (me.x - m.x) + m.vz * (me.z - m.z)) / (toM * TICKLE.monsterSpeed);
  const comingForMe = Math.max(0, Math.min(1, (heading - 0.2) / 0.5));

  // Freeing someone already: keep at it unless the monster is about to arrive.
  const frozen = y.runners.filter((s) => s !== seat && y.bodies[s]?.frozen);
  const freeing = frozen.find((f) => canFree(y, seat, f));
  if (freeing !== undefined) {
    const f = y.bodies[freeing] as Body;
    const left = (TICKLE.freeTime - f.thaw) * TICKLE.monsterSpeed;
    const bail = dm < 0.8 + skill * 0.7 + comingForMe * skill * 0.6 && dm < left + 0.6 + rng() * 0.5;
    if (!bail) {
      brain.a = true;
      const d = Math.hypot(f.x - me.x, f.z - me.z) || 1;
      aim(brain, (f.x - me.x) / d, (f.z - me.z) / d, rng, gap(me, f) > TICKLE.freeReach * 0.5 ? 0.35 : 0);
      return;
    }
  }

  const danger = 1.4 + skill * 0.4 + (1 - skill) * 0.9 + comingForMe * skill * 2.6 + (me.immune > 0 ? -0.6 : 0);
  if (dm < danger) {
    const [vx, vz] = fleeWay(me, brain, mx, mz);
    aim(brain, vx, vz, rng);
    return;
  }

  // A teammate to free: one the monster can't reach before we're done.
  let goal: Body | null = null;
  let goalScore = -Infinity;
  for (const f of frozen) {
    const fb = y.bodies[f] as Body;
    const mine = Math.hypot(fb.x - me.x, fb.z - me.z);
    const myTime = Math.max(0, mine - me.r - fb.r - TICKLE.freeReach) / TICKLE.runnerSpeed + TICKLE.freeTime - fb.thaw;
    const itsTime = Math.max(0, Math.hypot(fb.x - mx, fb.z - mz) - m.r - fb.r - TICKLE.freeReach) / TICKLE.monsterSpeed;
    // Sharp runners only go when they'll make it; sleepy and bold ones dash in anyway.
    const caution = 0.1 + skill * 0.5 - brain.nerve * 0.3 + (frozen.length >= 2 ? -0.15 : 0);
    const margin = itsTime - myTime * caution;
    if (margin < 0 && rng() < 0.5 + skill * 0.5) continue;
    const score = margin - mine * 0.15;
    if (score > goalScore) {
      goalScore = score;
      goal = fb;
    }
  }
  if (goal) {
    const d = Math.hypot(goal.x - me.x, goal.z - me.z) || 1;
    const [vx, vz] = pickWay(me, brain, (goal.x - me.x) / d, (goal.z - me.z) / d, { look: Math.min(1.2, d), open: 0.05, hold: 0.15 });
    aim(brain, vx, vz, rng, 1);
    brain.a = gap(me, goal) < TICKLE.freeReach + 0.6;
    return;
  }

  // Nothing to do: drift toward open lawn away from the monster.
  const [vx, vz] = fleeWay(me, brain, mx, mz);
  aim(brain, vx, vz, rng, 0.35 + skill * 0.35);
}

/** A computer player's stick for this moment. */
export function cpuStick(y: Yard, seat: number, brain: Brain, rng: Rng): Stick {
  if (y.time >= brain.next) {
    if (seat === y.monster) thinkMonster(y, seat, brain, rng);
    else thinkRunner(y, seat, brain, rng);
    const slow = seat === y.monster ? 0.2 : 0.26;
    brain.next = y.time + 0.07 + (1 - brain.skill) * slow + rng() * 0.07;
  }
  return { x: brain.x, y: brain.y, a: brain.a };
}
