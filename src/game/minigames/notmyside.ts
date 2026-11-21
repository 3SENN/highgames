// Not My Side: a living room split down the middle by a line of tape on the floor, one half per pair, and mess
// everywhere (cushions, socks, pizza boxes, empty cans, a pot plant). Walk to something, press Toss to pick it up
// (you carry it overhead, a little slower), press Toss again to lob it over the tape into the other half. When the
// doorbell rings, the side with less mess wins; big things count double.
//
// Everything happens in the room's x/z plane: the tape runs along x = 0, team 0 owns the left half (x < 0) and
// team 1 the right, +z points at the TV audience. A stick's y (up on the phone) runs away from the audience (-z).
import type { Rng } from '../rng.js';

export const MESS = {
  duration: 35, // seconds until the doorbell
  half: { x: 6.8, z: 3.4 }, // half-size of the room
  tape: 0.5, // nobody stands nearer the tape than this
  bodyR: 0.4,
  speed: 4.2, // walking speed at full stick
  slow: { small: 0.86, big: 0.74 }, // speed while carrying something
  response: 12, // how quickly walking follows the stick
  deadzone: 0.18,
  reach: 0.75, // pick up something this close (plus its own size)
  holdY: 1.5, // carried overhead
  toss: 4.4, // horizontal speed of a toss
  up: 5.0, // upward speed of a toss
  gravity: 14,
  maxAngle: 0.85, // radians off straight across that a toss can go
  cooldown: 0.25, // after a toss, before the next pick-up
  bounce: 0.45, // speed kept bouncing off a wall or furniture
  friction: 5, // a sliding thing slows by this much a second
  settle: 2.5, // after the bell, at most this long for things in the air to land
  // Second wind: the messier side gets quicker on its feet and throws further, more the further behind it is
  // (nothing at `from` points of mess behind, the full `max` at `from + span`: +7% a point, up to +35%).
  catchUp: { from: 0, span: 5, max: 0.35 },
  step: 1 / 120, // physics sub-step
} as const;

export type MessKind = 'cushion' | 'pizza' | 'plant' | 'sock' | 'can';

/** Size and weight of each kind of mess. `r` is its radius on the floor, `h` its height. */
export const KINDS: Record<MessKind, { big: boolean; r: number; h: number }> = {
  cushion: { big: true, r: 0.34, h: 0.2 },
  pizza: { big: true, r: 0.33, h: 0.1 },
  plant: { big: true, r: 0.26, h: 0.7 },
  sock: { big: false, r: 0.16, h: 0.08 },
  can: { big: false, r: 0.12, h: 0.24 },
};

/** What each half starts with (mirrored onto the other half). */
export const START_MESS: readonly MessKind[] = ['cushion', 'cushion', 'pizza', 'plant', 'sock', 'sock', 'sock', 'can', 'can'];

/** Points of mess: big things count 2. */
export function worth(kind: MessKind): number {
  return KINDS[kind].big ? 2 : 1;
}

export interface Stick {
  x: number;
  y: number;
  a: boolean;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

export interface Item {
  id: number;
  kind: MessKind;
  x: number;
  /** Height of its base above the floor. */
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: 'floor' | 'air' | 'held';
  /** Seat position carrying it, or -1. */
  holder: number;
  /** Seat position that last tossed it, or -1. */
  thrower: number;
  /** Has touched the floor since it was last tossed. */
  touched: boolean;
}

export interface Tidier {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing direction in the x/z plane (unit length). */
  fx: number;
  fz: number;
  /** Id of the item held overhead, or -1. */
  holding: number;
  cooldown: number;
  /** The button was down last step (picking up and tossing need a fresh press). */
  pressed: boolean;
  tosses: number;
  /** Tosses that landed on the other side. */
  over: number;
}

/** An armchair or a coffee table: an upright box on the floor. */
export interface Furniture {
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
}

export interface Room {
  /** Team (0 or 1) per seat position; -1 for a seat that isn't playing. */
  teamOf: number[];
  tidiers: Tidier[];
  items: Item[];
  furniture: Furniture[];
  time: number;
  /** The doorbell has rung: nobody moves any more. */
  rung: boolean;
}

export interface RoomEvents {
  picked: { p: number; item: Item }[];
  thrown: { p: number; item: Item }[];
  /** Something in the air hit furniture (its index) or a wall (-1). */
  bumped: { item: Item; furniture: number }[];
  /** A tossed thing touched the floor for the first time, in `half`'s half. */
  landed: { item: Item; half: number }[];
  /** A press with nothing in reach. */
  whiffs: number[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** +1 for team 0 (tosses to the right), -1 for team 1. */
export function sideOf(team: number): number {
  return team === 0 ? 1 : -1;
}

/** Whose half a point is in: 0 left of the tape, 1 right of it. */
export function halfAt(x: number): number {
  return x < 0 ? 0 : 1;
}

/** The same furniture on both sides of the tape: an armchair at the back and a coffee table at the front. */
export function makeFurniture(): Furniture[] {
  const out: Furniture[] = [];
  for (const s of [-1, 1]) {
    out.push({ x: s * 5.0, z: -2.0, hx: 0.62, hz: 0.56, h: 1.0 });
    out.push({ x: s * 2.4, z: 1.75, hx: 0.62, hz: 0.4, h: 0.45 });
  }
  return out;
}

function inBox(f: Furniture, x: number, z: number, r: number): boolean {
  return Math.abs(x - f.x) < f.hx + r && Math.abs(z - f.z) < f.hz + r;
}

function tidier(x: number, z: number, team: number): Tidier {
  return { x, z, vx: 0, vz: 0, fx: sideOf(team), fz: 0, holding: -1, cooldown: 0, pressed: false, tosses: 0, over: 0 };
}

/** Where a pair starts in its half (mirrored for the other half). */
function startSpot(team: number, member: number, solo: boolean): { x: number; z: number } {
  const z = solo ? 0 : member === 0 ? -0.9 : 0.9;
  return { x: -sideOf(team) * 3.6, z };
}

/**
 * A messy room for `seats` seat positions split into `teams` (two lists of positions). The mess is scattered by
 * `rng` over the left half and mirrored onto the right, so both sides start equally messy.
 */
export function newRoom(teams: readonly (readonly number[])[], seats: number, rng: Rng): Room {
  const teamOf = new Array<number>(seats).fill(-1);
  const tidiers: Tidier[] = [];
  for (let p = 0; p < seats; p++) tidiers.push(tidier(0, 0, 0));
  teams.slice(0, 2).forEach((members, team) => {
    members.forEach((p, m) => {
      if (p < 0 || p >= seats) return;
      teamOf[p] = team;
      const s = startSpot(team, m, members.length < 2);
      tidiers[p] = tidier(s.x, s.z, team);
    });
  });
  const furniture = makeFurniture();
  const starts = [0, 1].flatMap((team) => [0, 1].map((m) => startSpot(team, m, false)));
  const spots: { x: number; z: number; kind: MessKind }[] = [];
  for (const kind of START_MESS) {
    const r = KINDS[kind].r;
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 200; tries++) {
      x = -(0.9 + rng() * (MESS.half.x - 0.9 - 0.6));
      z = (rng() * 2 - 1) * (MESS.half.z - 0.6);
      const clear =
        !furniture.some((f) => inBox(f, x, z, r + 0.25)) &&
        !spots.some((o) => Math.hypot(o.x - x, o.z - z) < 0.75) &&
        !starts.some((s) => Math.hypot(s.x - x, s.z - z) < 0.8);
      if (clear) break;
    }
    spots.push({ x, z, kind });
  }
  const items: Item[] = [];
  for (const mirror of [1, -1]) {
    for (const s of spots) {
      items.push({ id: items.length + 1, kind: s.kind, x: s.x * mirror, y: 0, z: s.z, vx: 0, vy: 0, vz: 0, state: 'floor', holder: -1, thrower: -1, touched: true });
    }
  }
  return { teamOf, tidiers, items, furniture, time: 0, rung: false };
}

export function isOver(r: Room): boolean {
  return r.time >= MESS.duration;
}

/** Points of mess in a team's half: things on the floor or in the air by where they are, carried ones by the carrier. */
/**
 * A team's second wind, 0 to MESS.catchUp.max: how much quicker it walks and how much further it throws, for being
 * behind on mess.
 */
export function boostOf(r: Room, team: number): number {
  const behind = messOn(r, team) - messOn(r, 1 - team);
  const { from, span, max } = MESS.catchUp;
  return clamp((behind - from) / span, 0, 1) * max;
}

export function messOn(r: Room, team: number): number {
  let n = 0;
  for (const it of r.items) {
    const holder = it.holder >= 0 ? r.tidiers[it.holder] : undefined;
    const x = holder ? holder.x : it.x;
    if (halfAt(x) === team) n += worth(it.kind);
  }
  return n;
}

/** The direction of a toss (radians from straight across, positive towards +z): where they face, kept forward. */
export function tossAngle(r: Room, p: number): number {
  const c = r.tidiers[p];
  const team = r.teamOf[p] ?? -1;
  if (!c || team < 0) return 0;
  return clamp(Math.atan2(c.fz, Math.max(0.35, c.fx * sideOf(team))), -MESS.maxAngle, MESS.maxAngle);
}

/** The item nearest `p` that they could pick up right now, or undefined. */
export function inReach(r: Room, p: number): Item | undefined {
  const c = r.tidiers[p];
  if (!c) return undefined;
  let best: Item | undefined;
  let nearest = Infinity;
  for (const it of r.items) {
    if (it.state !== 'floor') continue;
    const d = Math.hypot(it.x - c.x, it.z - c.z);
    if (d <= MESS.reach + KINDS[it.kind].r && d < nearest) {
      nearest = d;
      best = it;
    }
  }
  return best;
}

function press(r: Room, p: number, ev: RoomEvents, boost: number): void {
  const c = r.tidiers[p];
  const team = r.teamOf[p] ?? -1;
  if (!c || team < 0) return;
  if (c.holding >= 0) {
    const it = r.items.find((i) => i.id === c.holding);
    c.holding = -1;
    if (!it) return;
    const a = tossAngle(r, p);
    const dx = sideOf(team) * Math.cos(a);
    const dz = Math.sin(a);
    it.state = 'air';
    it.holder = -1;
    it.thrower = p;
    it.touched = false;
    it.x = c.x + dx * 0.3;
    it.z = c.z + dz * 0.3;
    it.y = MESS.holdY;
    it.vx = dx * MESS.toss * (1 + boost) + c.vx * 0.3;
    it.vz = dz * MESS.toss * (1 + boost) + c.vz * 0.3;
    it.vy = MESS.up;
    c.tosses += 1;
    c.cooldown = MESS.cooldown;
    ev.thrown.push({ p, item: it });
    return;
  }
  if (c.cooldown > 0) return;
  const it = inReach(r, p);
  if (!it) {
    ev.whiffs.push(p);
    return;
  }
  it.state = 'held';
  it.holder = p;
  it.vx = 0;
  it.vy = 0;
  it.vz = 0;
  c.holding = it.id;
  ev.picked.push({ p, item: it });
}

/** Keeps people in their half, inside the room, out of the furniture and out of each other. */
function separate(r: Room): void {
  const cs = r.tidiers;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      if ((r.teamOf[i] ?? -1) < 0 || (r.teamOf[j] ?? -1) < 0) continue;
      const a = cs[i] as Tidier;
      const b = cs[j] as Tidier;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = MESS.bodyR * 2;
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
    const team = r.teamOf[p] ?? -1;
    if (team < 0) return;
    for (const f of r.furniture) {
      if (!inBox(f, c.x, c.z, MESS.bodyR)) continue;
      const ox = f.hx + MESS.bodyR - Math.abs(c.x - f.x);
      const oz = f.hz + MESS.bodyR - Math.abs(c.z - f.z);
      if (ox < oz) {
        c.x += (c.x >= f.x ? 1 : -1) * ox;
        c.vx = 0;
      } else {
        c.z += (c.z >= f.z ? 1 : -1) * oz;
        c.vz = 0;
      }
    }
    const lo = team === 0 ? -MESS.half.x + MESS.bodyR : MESS.tape;
    const hi = team === 0 ? -MESS.tape : MESS.half.x - MESS.bodyR;
    if (c.x < lo || c.x > hi) {
      c.x = clamp(c.x, lo, hi);
      c.vx = 0;
    }
    const zMax = MESS.half.z - MESS.bodyR;
    if (Math.abs(c.z) > zMax) {
      c.z = clamp(c.z, -zMax, zMax);
      c.vz = 0;
    }
  });
}

/** Moves everything that's flying or sliding: bounces off walls and furniture, lands, slides to a stop. */
function physics(r: Room, h: number, ev: RoomEvents): void {
  const decay = Math.max(0, 1 - MESS.friction * h);
  r.items.forEach((it) => {
    if (it.state === 'held') {
      const c = r.tidiers[it.holder];
      if (c) {
        it.x = c.x;
        it.z = c.z;
        it.y = MESS.holdY;
      }
      return;
    }
    const rad = KINDS[it.kind].r;
    const moving = it.state === 'air' || it.vx !== 0 || it.vz !== 0;
    if (!moving) return;
    const prevY = it.y;
    if (it.state === 'air') it.vy -= MESS.gravity * h;
    else {
      it.vx *= decay;
      it.vz *= decay;
      if (Math.hypot(it.vx, it.vz) < 0.05) {
        it.vx = 0;
        it.vz = 0;
      }
    }
    it.x += it.vx * h;
    it.z += it.vz * h;
    if (it.state === 'air') it.y += it.vy * h;
    // Furniture: dropping onto the top, it tumbles off the nearest edge; from the side, it bounces back.
    r.furniture.forEach((f, k) => {
      if (!inBox(f, it.x, it.z, rad) || it.y >= f.h) return;
      const ox = f.hx + rad - Math.abs(it.x - f.x);
      const oz = f.hz + rad - Math.abs(it.z - f.z);
      if (it.state === 'air' && prevY >= f.h - 1e-6) {
        it.y = f.h;
        it.vy = Math.max(1.6, Math.abs(it.vy) * 0.3);
        const roll = Math.max(1.4, Math.hypot(it.vx, it.vz) * 0.5);
        if (ox < oz) {
          it.vx = (it.x >= f.x ? 1 : -1) * roll;
          it.vz *= 0.5;
        } else {
          it.vz = (it.z >= f.z ? 1 : -1) * roll;
          it.vx *= 0.5;
        }
      } else if (ox < oz) {
        it.x += (it.x >= f.x ? 1 : -1) * ox;
        it.vx = (it.x >= f.x ? 1 : -1) * Math.abs(it.vx) * MESS.bounce;
      } else {
        it.z += (it.z >= f.z ? 1 : -1) * oz;
        it.vz = (it.z >= f.z ? 1 : -1) * Math.abs(it.vz) * MESS.bounce;
      }
      if (it.state === 'air') ev.bumped.push({ item: it, furniture: k });
    });
    // Walls all round (the front one is the edge of the rug, as far as the mess is concerned).
    const xMax = MESS.half.x - rad;
    const zMax = MESS.half.z - rad;
    let wall = false;
    if (Math.abs(it.x) > xMax) {
      it.x = clamp(it.x, -xMax, xMax);
      it.vx = -it.vx * MESS.bounce;
      wall = true;
    }
    if (Math.abs(it.z) > zMax) {
      it.z = clamp(it.z, -zMax, zMax);
      it.vz = -it.vz * MESS.bounce;
      wall = true;
    }
    if (wall && it.state === 'air') ev.bumped.push({ item: it, furniture: -1 });
    if (it.state === 'air' && it.y <= 0) {
      it.y = 0;
      if (!it.touched) {
        it.touched = true;
        ev.landed.push({ item: it, half: halfAt(it.x) });
        const thrower = r.tidiers[it.thrower];
        const team = r.teamOf[it.thrower] ?? -1;
        if (thrower && team >= 0 && halfAt(it.x) !== team) thrower.over += 1;
      }
      if (it.vy < -3) {
        it.vy = -it.vy * 0.25;
        it.vx *= 0.6;
        it.vz *= 0.6;
      } else {
        it.state = 'floor';
        it.vy = 0;
      }
    }
  });
}

function subStep(r: Room, inputs: readonly Stick[], h: number, ev: RoomEvents): void {
  r.time += h;
  const boosts = [boostOf(r, 0), boostOf(r, 1)];
  const follow = Math.min(1, MESS.response * h);
  r.tidiers.forEach((c, p) => {
    if ((r.teamOf[p] ?? -1) < 0) return;
    const input = r.rung ? IDLE : (inputs[p] ?? IDLE);
    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    if (len < MESS.deadzone) {
      ix = 0;
      iy = 0;
    } else {
      c.fx = input.x / len;
      c.fz = -input.y / len;
    }
    const held = c.holding >= 0 ? r.items.find((i) => i.id === c.holding) : undefined;
    const boost = boosts[r.teamOf[p] ?? 0] ?? 0;
    const speed = MESS.speed * (1 + boost) * (held ? (KINDS[held.kind].big ? MESS.slow.big : MESS.slow.small) : 1);
    c.vx += (ix * speed - c.vx) * follow;
    c.vz += (-iy * speed - c.vz) * follow;
    c.x += c.vx * h;
    c.z += c.vz * h;
    c.cooldown = Math.max(0, c.cooldown - h);
    if (input.a && !c.pressed) press(r, p, ev, boost);
    c.pressed = input.a;
  });
  separate(r);
  physics(r, h, ev);
}

function noEvents(): RoomEvents {
  return { picked: [], thrown: [], bumped: [], landed: [], whiffs: [] };
}

/** Advances the room by dt seconds (in small sub-steps) with one stick per seat position, up to the doorbell. */
export function stepRoom(r: Room, inputs: readonly Stick[], dt: number): RoomEvents {
  const ev = noEvents();
  let left = Math.min(dt, MESS.duration - r.time);
  while (left > 1e-9) {
    const h = Math.min(MESS.step, left);
    subStep(r, inputs, h, ev);
    left -= h;
  }
  if (MESS.duration - r.time < 1e-6) r.time = Math.max(r.time, MESS.duration);
  return ev;
}

/** The doorbell: everyone stops and puts down what they're holding, right where they stand. */
export function ringBell(r: Room): void {
  r.rung = true;
  for (const c of r.tidiers) {
    c.vx = 0;
    c.vz = 0;
    if (c.holding < 0) continue;
    const it = r.items.find((i) => i.id === c.holding);
    c.holding = -1;
    if (!it) continue;
    it.state = 'floor';
    it.holder = -1;
    it.x = c.x;
    it.z = c.z;
    it.y = 0;
  }
}

/** Whether everything has come to rest on the floor. */
export function isSettled(r: Room): boolean {
  return r.items.every((it) => it.state === 'floor' && it.vx === 0 && it.vz === 0);
}

/** After the bell: lets whatever is still flying or sliding come down. Nobody moves. */
export function stepSettle(r: Room, dt: number): RoomEvents {
  const ev = noEvents();
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(MESS.step, left);
    r.time += h;
    physics(r, h, ev);
    left -= h;
  }
  return ev;
}

/** Scores per seat: the mess on the other side (so the tidier side scores higher). Partners share it. */
export function messScores(r: Room, teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.slice(0, 2).forEach((members, team) => {
    const theirs = messOn(r, 1 - team);
    for (const m of members) if (m >= 0 && m < seats) scores[m] = theirs;
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

export interface CpuTidier {
  /** The item it's going for, or -1. */
  target: number;
  /** Where it tosses from (picked when it picks something up). */
  spotX: number;
  spotZ: number;
  /** The toss direction it wants (radians from straight across). */
  aim: number;
  /** When it reached its spot (it tosses a moment later). */
  readyAt: number;
  /** If it hasn't reached its spot by then, it tosses from wherever it is. */
  giveUp: number;
  /** When it reached the thing it's going for (it picks it up a moment later). */
  pickAt: number;
  rethink: number;
  /** Seconds left gazing at the ceiling. */
  spaced: number;
  /** Detour round furniture: until then, in this direction. */
  detourUntil: number;
  detourX: number;
  detourZ: number;
  lastX: number;
  lastZ: number;
  stuckFor: number;
  /** It pressed last call (picking up and tossing need a fresh press). */
  pressed: boolean;
}

export function newCpuTidier(): CpuTidier {
  return { target: -1, spotX: 0, spotZ: 0, aim: 0, readyAt: Infinity, giveUp: Infinity, pickAt: Infinity, rethink: 0, spaced: 0, detourUntil: 0, detourX: 0, detourZ: 0, lastX: 0, lastZ: 0, stuckFor: 0, pressed: false };
}

/** The stick a computer tidier pushes this step. skill: 0 sleepy … 1 sharp. */
export function cpuStick(c: CpuTidier, r: Room, p: number, dt: number, skill: number, rng: Rng): Stick {
  const me = r.tidiers[p];
  const team = r.teamOf[p] ?? -1;
  if (!me || team < 0 || r.rung) return IDLE;
  const s = clamp(skill, 0, 1);
  const side = sideOf(team);
  const t = r.time;
  const out = (stick: Stick): Stick => {
    c.pressed = stick.a;
    return stick;
  };

  // Gazing at the ceiling now and then.
  if (c.spaced > 0) {
    c.spaced -= dt;
    return out(IDLE);
  }
  if (rng() < (0.03 + (1 - s) * 0.15) * dt) c.spaced = 0.3 + rng() * (0.4 + (1 - s) * 0.9);

  // Noticing when it's stuck on a corner of the furniture.
  const moved = Math.hypot(me.x - c.lastX, me.z - c.lastZ);
  c.lastX = me.x;
  c.lastZ = me.z;
  const walk = (tx: number, tz: number, pace: number): Stick => {
    const dx = tx - me.x;
    const dz = tz - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) return IDLE;
    if (t < c.detourUntil) return { x: c.detourX, y: -c.detourZ, a: false };
    c.stuckFor = moved < 0.4 * dt ? c.stuckFor + dt : 0;
    if (c.stuckFor > 0.35) {
      c.stuckFor = 0;
      const turn = rng() < 0.5 ? 1 : -1;
      c.detourX = (-dz / d) * turn;
      c.detourZ = (dx / d) * turn;
      c.detourUntil = t + 0.45;
    }
    const k = Math.min(1, d * 2) * pace;
    return { x: (dx / d) * k, y: -(dz / d) * k, a: false };
  };
  const pace = 0.5 + 0.45 * s;

  if (me.holding >= 0) {
    // Carry it to the tape and lob it over.
    if (c.readyAt === Infinity && (Math.hypot(c.spotX - me.x, c.spotZ - me.z) < 0.3 || t >= c.giveUp)) c.readyAt = t + 0.1 + (1 - s) * 0.5 * rng();
    if (t >= c.readyAt && !c.pressed) {
      c.readyAt = Infinity;
      c.target = -1;
      c.rethink = t + 0.2;
      return out({ x: side * Math.cos(c.aim) * 0.3, y: -Math.sin(c.aim) * 0.3, a: true });
    }
    if (t >= c.readyAt) return out({ x: side * Math.cos(c.aim) * 0.3, y: -Math.sin(c.aim) * 0.3, a: false });
    return out(walk(c.spotX, c.spotZ, pace));
  }

  // Choose something to pick up: big things are worth more, near things are quicker, and a sharp tidier leaves
  // what's nearer its partner to its partner.
  const partner = r.tidiers.find((_, q) => q !== p && r.teamOf[q] === team);
  const valid = (it: Item | undefined) => it !== undefined && it.state === 'floor' && halfAt(it.x) === team;
  if (t >= c.rethink || !valid(r.items.find((i) => i.id === c.target))) {
    let best = -Infinity;
    c.target = -1;
    for (const it of r.items) {
      if (!valid(it)) continue;
      const d = Math.hypot(it.x - me.x, it.z - me.z);
      const toTape = Math.abs(it.x);
      const theirs = partner ? Math.hypot(it.x - partner.x, it.z - partner.z) < d - 0.5 : false;
      const value = (KINDS[it.kind].big ? 1.4 + 0.6 * s : 1) / (d + 1.2 + toTape * 0.25 * s) - (theirs ? 0.25 * s : 0) + rng() * (0.05 + (1 - s) * 0.2);
      if (value > best) {
        best = value;
        c.target = it.id;
      }
    }
    c.rethink = t + 0.6 + rng() * (0.8 + (1 - s));
  }
  const it = r.items.find((i) => i.id === c.target);
  if (!it) {
    // Nothing on our side: wait near the tape for the next lob.
    return out(walk(-side * 2.2, partner && partner.z < me.z ? 1.2 : -1.2, pace * 0.6));
  }
  if (Math.hypot(it.x - me.x, it.z - me.z) <= MESS.reach + KINDS[it.kind].r - 0.05 && me.cooldown <= 0) {
    if (c.pickAt === Infinity) c.pickAt = t + 0.12 + (1 - s) * 0.5 * rng();
    if (c.pressed || t < c.pickAt) return out(IDLE);
    c.pickAt = Infinity;
    // Picked up: decide where to toss it from (clear of the furniture) and which way.
    for (let tries = 0; tries < 12; tries++) {
      c.spotX = -side * (MESS.tape + 0.15 + (1 - s) * (0.3 + rng() * 1.6) + rng() * 0.5);
      c.spotZ = clamp(me.z + (rng() - 0.5) * (1.2 + tries * 0.4), -MESS.half.z + 0.8, MESS.half.z - 0.8);
      if (!r.furniture.some((f) => inBox(f, c.spotX, c.spotZ, MESS.bodyR + 0.15))) break;
    }
    c.aim = clamp(-c.spotZ * 0.18 + (rng() - 0.5) * (0.9 + (1 - s) * 0.5), -MESS.maxAngle, MESS.maxAngle);
    c.readyAt = Infinity;
    c.giveUp = t + 3.5;
    return out({ x: 0, y: 0, a: true });
  }
  return out(walk(it.x, it.z, pace));
}
