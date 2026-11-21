// Towel Toss: a pool deck at sunset, a low fence across the middle. Each pair holds a beach towel between them
// (the towel is the line from one partner to the other, so it stretches and turns as they move). Both press Launch
// within a moment of each other to fling the water balloon resting on the towel over the fence: it flies the way
// the towel faces, further the closer together the presses were. Catch what comes back on your towel; a balloon
// that hits the deck bursts and scores for the side that threw it. Most splashes in 40 seconds wins.
//
// Everything happens in the deck's x/z plane: the fence runs along x = 0, team 0 holds the left half (x < 0) and
// team 1 the right, +z points at the TV audience. A stick's y (up on the phone) runs away from the audience (-z).
import type { Rng } from '../rng.js';

export const TOWEL = {
  duration: 40, // seconds
  half: { x: 8, z: 3.6 }, // half-size of the deck
  fence: 0.6, // nobody stands nearer the fence than this
  bodyR: 0.36,
  speed: 4.0, // running speed at full stick
  response: 10, // how quickly running follows the stick
  deadzone: 0.18,
  maxLen: 2.6, // the towel pulled taut: partners can't get further apart than this
  minLen: 0.8, // ... or closer together than this
  soloLen: 1.4, // a towel held by one player alone
  holdY: 1.0, // the towel's height
  window: 0.3, // both partners press within this many seconds
  lagGrace: 0.15, // a lone press waits this much longer, for a late message from the other phone
  soloPower: 0.8,
  cooldown: 0.5, // seconds between launches
  maxAngle: 0.75, // radians off straight across that a launch can go
  near: 4.0, // a launch flies this far at the weakest
  far: 8.6, // ... and this far when both pressed at the same instant
  flight: { base: 0.8, per: 0.06 }, // seconds in the air: base + per × distance
  gravity: 9,
  ballR: 0.2,
  catchR: 0.3, // a balloon coming down this close to the towel line (between the partners) is caught
  refill: 3.2, // seconds between fresh balloons dropping onto a towel...
  refillBelow: 2, // ... while it holds fewer than this
  stockMax: 3, // most balloons a towel can hold
  startStock: 1,
  step: 1 / 120, // physics sub-step
} as const;

export interface Stick {
  x: number;
  y: number;
  a: boolean;
  /** Seconds the press is older than it looks (half the phone's round trip); 0 for computer players. */
  lag?: number;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

export interface Holder {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing direction (unit length): where the stick last pointed. */
  fx: number;
  fz: number;
  /** The button was down last step (a launch press needs a fresh press). */
  pressed: boolean;
  /** When this player's waiting press happened (game time), or null. */
  pending: number | null;
  catches: number;
}

export interface Balloon {
  id: number;
  /** Team that launched it. */
  team: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Where it comes down through towel height. */
  tx: number;
  tz: number;
  /** Game time it comes down through towel height. */
  at: number;
  /** Got past the towels: it's falling to the deck. */
  missed: boolean;
}

export interface Side {
  /** Seat positions, in member order. */
  members: number[];
  /** Balloons resting on the towel. */
  stock: number;
  refillIn: number;
  cooldown: number;
  /** Balloons that burst on the other side. */
  score: number;
  launches: number;
  catches: number;
}

export interface Deck {
  /** Team (0 or 1) per seat position; -1 for a seat that isn't playing. */
  teamOf: number[];
  holders: Holder[];
  sides: Side[];
  balloons: Balloon[];
  time: number;
  nextId: number;
}

export type Burst = { balloon: Balloon; result: 'score' | 'short' | 'wide' | 'pool' };

export interface DeckEvents {
  launched: { team: number; balloon: Balloon; power: number; gap: number }[];
  caught: { team: number; balloon: Balloon; spilled: boolean }[];
  burst: Burst[];
  /** A fresh balloon dropped onto a team's towel. */
  refilled: number[];
  /** A press that found no partner press in time (seat position). */
  fumbled: number[];
  /** A press with nothing on the towel (seat position). */
  empty: number[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** +1 for team 0 (launches to the right), -1 for team 1. */
export function sideOf(team: number): number {
  return team === 0 ? 1 : -1;
}

function holder(x: number, z: number, team: number): Holder {
  return { x, z, vx: 0, vz: 0, fx: sideOf(team), fz: 0, pressed: false, pending: null, catches: 0 };
}

/** A deck for `seats` seat positions split into `teams` (two lists of positions). */
export function newDeck(teams: readonly (readonly number[])[], seats: number): Deck {
  const teamOf = new Array<number>(seats).fill(-1);
  const holders: Holder[] = [];
  for (let p = 0; p < seats; p++) holders.push(holder(0, 0, 0));
  const sides: Side[] = [];
  teams.slice(0, 2).forEach((list, team) => {
    const members = list.filter((p) => p >= 0 && p < seats);
    members.forEach((p, m) => {
      teamOf[p] = team;
      const z = members.length > 1 ? (m === 0 ? -0.9 : 0.9) * sideOf(team) : 0;
      holders[p] = holder(-sideOf(team) * 3.6, z, team);
    });
    sides.push({ members, stock: TOWEL.startStock, refillIn: TOWEL.refill, cooldown: 0, score: 0, launches: 0, catches: 0 });
  });
  return { teamOf, holders, sides, balloons: [], time: 0, nextId: 1 };
}

export function isOver(d: Deck): boolean {
  return d.time >= TOWEL.duration;
}

/** The two ends of a team's towel (x, z), or null for a team without players. */
export function towelEnds(d: Deck, team: number): { ax: number; az: number; bx: number; bz: number } | null {
  const side = d.sides[team];
  const a = side ? d.holders[side.members[0] ?? -1] : undefined;
  if (!side || !a) return null;
  const b = d.holders[side.members[1] ?? -1];
  if (b) return { ax: a.x, az: a.z, bx: b.x, bz: b.z };
  // Alone: held out in both hands, across the way they face.
  const s = sideOf(team);
  const ang = clamp(Math.atan2(a.fz, Math.max(0.35, a.fx * s)), -TOWEL.maxAngle, TOWEL.maxAngle);
  const ux = -Math.sin(ang);
  const uz = s * Math.cos(ang);
  const h = TOWEL.soloLen / 2;
  return { ax: a.x - ux * h, az: a.z - uz * h, bx: a.x + ux * h, bz: a.z + uz * h };
}

/** Which way a team's towel faces: radians from straight across (positive towards +z), kept to the forward arc. */
export function towelAngle(d: Deck, team: number): number {
  const e = towelEnds(d, team);
  if (!e) return 0;
  const s = sideOf(team);
  const ux = e.bx - e.ax;
  const uz = e.bz - e.az;
  // The normal of the towel line, turned to point over the fence.
  let nx = -uz;
  let nz = ux;
  if (nx * s < 0 || (nx === 0 && nz === 0)) {
    nx = -nx;
    nz = -nz;
  }
  if (nx === 0 && nz === 0) return 0;
  return clamp(Math.atan2(nz, Math.max(1e-6, nx * s)), -TOWEL.maxAngle, TOWEL.maxAngle);
}

/** How far a launch flies for a given power (0..1). */
export function launchDistance(power: number): number {
  return TOWEL.near + (TOWEL.far - TOWEL.near) * clamp(power, 0, 1);
}

/** Launch power from the gap between the partners' presses: 1 at the same instant, 0 at the edge of the window. */
export function powerOf(gap: number): number {
  return clamp(1 - Math.abs(gap) / TOWEL.window, 0, 1);
}

/** Where a balloon from a team's towel would come down, at a power. */
export function aimPoint(d: Deck, team: number, power: number): { x: number; z: number } {
  const e = towelEnds(d, team);
  if (!e) return { x: 0, z: 0 };
  const a = towelAngle(d, team);
  const dist = launchDistance(power);
  return { x: (e.ax + e.bx) / 2 + sideOf(team) * Math.cos(a) * dist, z: (e.az + e.bz) / 2 + Math.sin(a) * dist };
}

function launch(d: Deck, team: number, power: number, gap: number, ev: DeckEvents): void {
  const side = d.sides[team];
  const e = towelEnds(d, team);
  if (!side || !e) return;
  const a = towelAngle(d, team);
  const dist = launchDistance(power);
  const T = TOWEL.flight.base + TOWEL.flight.per * dist;
  const s = sideOf(team);
  const dx = s * Math.cos(a);
  const dz = Math.sin(a);
  const x = (e.ax + e.bx) / 2;
  const z = (e.az + e.bz) / 2;
  const b: Balloon = {
    id: d.nextId++,
    team,
    x,
    y: TOWEL.holdY,
    z,
    vx: (dx * dist) / T,
    vy: (TOWEL.gravity * T) / 2,
    vz: (dz * dist) / T,
    tx: x + dx * dist,
    tz: z + dz * dist,
    at: d.time + T,
    missed: false,
  };
  d.balloons.push(b);
  side.stock -= 1;
  side.launches += 1;
  side.cooldown = TOWEL.cooldown;
  if (side.stock < TOWEL.refillBelow && side.refillIn <= 0) side.refillIn = TOWEL.refill;
  for (const m of side.members) {
    const h = d.holders[m];
    if (h) h.pending = null;
  }
  ev.launched.push({ team, balloon: b, power, gap });
}

/** A fresh press from seat position `p` at game time `at`. */
function press(d: Deck, p: number, at: number, ev: DeckEvents): void {
  const team = d.teamOf[p] ?? -1;
  const side = d.sides[team];
  const me = d.holders[p];
  if (!side || !me) return;
  if (side.cooldown > 0) return;
  if (side.stock <= 0) {
    ev.empty.push(p);
    return;
  }
  if (side.members.length < 2) {
    launch(d, team, TOWEL.soloPower, 0, ev);
    return;
  }
  const other = d.holders[side.members.find((q) => q !== p) ?? -1];
  if (other && other.pending !== null && Math.abs(at - other.pending) <= TOWEL.window) {
    launch(d, team, powerOf(at - other.pending), at - other.pending, ev);
    return;
  }
  me.pending = at;
}

/** Keeps partners on their side of the fence, on the deck, and within a towel's length of each other. */
function constrain(d: Deck): void {
  for (const side of d.sides) {
    const a = d.holders[side.members[0] ?? -1];
    const b = d.holders[side.members[1] ?? -1];
    if (a && b) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const nx = len > 1e-6 ? dx / len : 0;
      const nz = len > 1e-6 ? dz / len : 1;
      const fix = len > TOWEL.maxLen ? len - TOWEL.maxLen : len < TOWEL.minLen ? len - TOWEL.minLen : 0;
      if (fix !== 0) {
        a.x += (nx * fix) / 2;
        a.z += (nz * fix) / 2;
        b.x -= (nx * fix) / 2;
        b.z -= (nz * fix) / 2;
        // Pulled taut: neither keeps running apart.
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if ((fix > 0 && rel > 0) || (fix < 0 && rel < 0)) {
          a.vx += (nx * rel) / 2;
          a.vz += (nz * rel) / 2;
          b.vx -= (nx * rel) / 2;
          b.vz -= (nz * rel) / 2;
        }
      }
    }
  }
  d.holders.forEach((h, p) => {
    const team = d.teamOf[p] ?? -1;
    if (team < 0) return;
    const lo = team === 0 ? -TOWEL.half.x + TOWEL.bodyR : TOWEL.fence;
    const hi = team === 0 ? -TOWEL.fence : TOWEL.half.x - TOWEL.bodyR;
    if (h.x < lo || h.x > hi) {
      h.x = clamp(h.x, lo, hi);
      h.vx = 0;
    }
    const zMax = TOWEL.half.z - TOWEL.bodyR;
    if (Math.abs(h.z) > zMax) {
      h.z = clamp(h.z, -zMax, zMax);
      h.vz = 0;
    }
  });
}

/** Whether a point is on a team's towel: between the partners and within catchR of the line. */
export function onTowel(d: Deck, team: number, x: number, z: number): boolean {
  const e = towelEnds(d, team);
  if (!e) return false;
  const ux = e.bx - e.ax;
  const uz = e.bz - e.az;
  const len2 = ux * ux + uz * uz;
  if (len2 < 1e-9) return Math.hypot(x - e.ax, z - e.az) <= TOWEL.catchR;
  const t = ((x - e.ax) * ux + (z - e.az) * uz) / len2;
  const margin = TOWEL.ballR / Math.sqrt(len2);
  if (t < -margin || t > 1 + margin) return false;
  const k = clamp(t, 0, 1);
  return Math.hypot(x - (e.ax + ux * k), z - (e.az + uz * k)) <= TOWEL.catchR;
}

function burstResult(b: Balloon): Burst['result'] {
  if (b.z < -TOWEL.half.z) return 'pool';
  if (Math.abs(b.x) > TOWEL.half.x || b.z > TOWEL.half.z) return 'wide';
  const half = b.x < 0 ? 0 : 1;
  return half === b.team ? 'short' : 'score';
}

function subStep(d: Deck, inputs: readonly Stick[], h: number, ev: DeckEvents): void {
  d.time += h;
  const follow = Math.min(1, TOWEL.response * h);
  d.holders.forEach((c, p) => {
    if ((d.teamOf[p] ?? -1) < 0) return;
    const input = inputs[p] ?? IDLE;
    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    if (len < TOWEL.deadzone) {
      ix = 0;
      iy = 0;
    } else {
      c.fx = input.x / len;
      c.fz = -input.y / len;
    }
    c.vx += (ix * TOWEL.speed - c.vx) * follow;
    c.vz += (-iy * TOWEL.speed - c.vz) * follow;
    c.x += c.vx * h;
    c.z += c.vz * h;
  });
  constrain(d);

  // Presses: two partners within the window launch together; a lone press runs out.
  d.holders.forEach((c, p) => {
    if ((d.teamOf[p] ?? -1) < 0) return;
    const input = inputs[p] ?? IDLE;
    if (input.a && !c.pressed) press(d, p, d.time - Math.max(0, input.lag ?? 0), ev);
    c.pressed = input.a;
    if (c.pending !== null && d.time - c.pending > TOWEL.window + TOWEL.lagGrace) {
      c.pending = null;
      ev.fumbled.push(p);
    }
  });

  d.sides.forEach((side, team) => {
    side.cooldown = Math.max(0, side.cooldown - h);
    if (side.stock >= TOWEL.refillBelow) {
      side.refillIn = TOWEL.refill;
      return;
    }
    side.refillIn -= h;
    if (side.refillIn <= 0) {
      side.stock += 1;
      side.refillIn = TOWEL.refill;
      ev.refilled.push(team);
    }
  });

  d.balloons = d.balloons.filter((b) => {
    const prevY = b.y;
    b.vy -= TOWEL.gravity * h;
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.z += b.vz * h;
    if (!b.missed && prevY > TOWEL.holdY && b.y <= TOWEL.holdY) {
      // Coming down through towel height: on a towel, it's caught.
      const team = [0, 1].find((t) => onTowel(d, t, b.x, b.z));
      const side = team === undefined ? undefined : d.sides[team];
      if (team !== undefined && side) {
        const spilled = side.stock >= TOWEL.stockMax;
        if (!spilled) side.stock += 1;
        side.catches += 1;
        for (const m of side.members) {
          const hd = d.holders[m];
          if (hd) hd.catches += 1;
        }
        ev.caught.push({ team, balloon: b, spilled });
        return false;
      }
      b.missed = true;
    }
    if (b.y <= TOWEL.ballR) {
      const result = burstResult(b);
      if (result === 'score') {
        const side = d.sides[b.team];
        if (side) side.score += 1;
      }
      ev.burst.push({ balloon: b, result });
      return false;
    }
    return true;
  });
}

/** Advances the deck by dt seconds (in small sub-steps) with one stick per seat position. */
export function stepDeck(d: Deck, inputs: readonly Stick[], dt: number): DeckEvents {
  const ev: DeckEvents = { launched: [], caught: [], burst: [], refilled: [], fumbled: [], empty: [] };
  let left = Math.min(dt, TOWEL.duration - d.time);
  while (left > 1e-9) {
    const h = Math.min(TOWEL.step, left);
    subStep(d, inputs, h, ev);
    left -= h;
  }
  if (TOWEL.duration - d.time < 1e-6) d.time = Math.max(d.time, TOWEL.duration);
  return ev;
}

/** Scores per seat: both partners get their team's splashes. `teams` holds seat positions. */
export function towelScores(d: Deck, teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.slice(0, 2).forEach((members, team) => {
    for (const m of members) if (m >= 0 && m < seats) scores[m] = d.sides[team]?.score ?? 0;
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

export interface CpuHolder {
  /** The balloon it's going for, and where it thinks it comes down. */
  chasing: number;
  guessX: number;
  guessZ: number;
  /** Not before this does it start moving for it. */
  moveAt: number;
  /** Balloons it already decided about (id → whether it goes for it). */
  seen: Map<number, boolean>;
  /** Where it stands to launch from, and which way it means to aim. */
  homeX: number;
  aim: number;
  rethink: number;
  /** When it presses next (Infinity: not planned). */
  pressAt: number;
  /** The partner press it is answering (so it answers each one once). */
  answering: number | null;
  /** Seconds left watching the sunset. */
  spaced: number;
  pressed: boolean;
}

export function newCpuHolder(): CpuHolder {
  return { chasing: -1, guessX: 0, guessZ: 0, moveAt: 0, seen: new Map(), homeX: 0, aim: 0, rethink: 0, pressAt: Infinity, answering: null, spaced: 0, pressed: false };
}

/** Roughly bell-shaped noise with a standard deviation of about 1. */
function bell(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 2;
}

/** The stick a computer holder pushes this step. skill: 0 sleepy … 1 sharp. */
export function cpuStick(c: CpuHolder, d: Deck, p: number, dt: number, skill: number, rng: Rng, partnerIsCpu = true): Stick {
  const me = d.holders[p];
  const team = d.teamOf[p] ?? -1;
  const side = d.sides[team];
  if (!me || !side) return IDLE;
  const s = clamp(skill, 0, 1);
  const sd = sideOf(team);
  const t = d.time;
  const member = side.members.indexOf(p);
  const partner = d.holders[side.members[1 - member] ?? -1];
  const solo = !partner;
  const out = (stick: Stick): Stick => {
    c.pressed = stick.a;
    return stick;
  };
  // Where this member stands for a towel centred on (x, z) and facing `aim`, `len` long.
  const slot = (x: number, z: number, aim: number, len: number) => {
    if (solo) return { x, z };
    const ux = -Math.sin(aim);
    const uz = sd * Math.cos(aim);
    const k = member === 0 ? -len / 2 : len / 2;
    return { x: x + ux * k, z: z + uz * k };
  };
  const go = (x: number, z: number, pace: number): Stick => {
    const dx = x - me.x;
    const dz = z - me.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.06) return { x: 0, y: 0, a: false };
    const k = Math.min(1, dist * 2.2) * pace;
    return { x: (dx / dist) * k, y: -(dz / dist) * k, a: false };
  };

  if (c.spaced > 0) {
    c.spaced -= dt;
    return out(IDLE);
  }
  if (rng() < (0.02 + (1 - s) * 0.1) * dt) c.spaced = 0.3 + rng() * (0.3 + (1 - s) * 0.8);

  // Incoming: the soonest balloon coming down on our side.
  let threat: Balloon | undefined;
  for (const b of d.balloons) {
    if (b.team === team || b.missed) continue;
    const ours = b.tx * sd < 0 && Math.abs(b.tx) < TOWEL.half.x + 0.3 && Math.abs(b.tz) < TOWEL.half.z + 0.3;
    if (!ours) continue;
    if (!c.seen.has(b.id)) {
      // Sharp holders go for nearly everything; sleepy ones let some go.
      c.seen.set(b.id, rng() < 0.7 + 0.3 * s);
    }
    if (!c.seen.get(b.id)) continue;
    if (!threat || b.at < threat.at) threat = b;
  }
  if (threat) {
    if (c.chasing !== threat.id) {
      c.chasing = threat.id;
      const err = 0.45 + (1 - s) * 0.8;
      c.guessX = threat.tx + bell(rng) * err * 0.5;
      c.guessZ = threat.tz + bell(rng) * err * 0.5;
      c.moveAt = t + 0.14 + (1 - s) * 0.4 + rng() * 0.15;
    }
    if (t < c.moveAt) return out(IDLE);
    const len = Math.min(TOWEL.maxLen - 0.3, 2.0);
    const spot = slot(c.guessX, c.guessZ, 0, len);
    return out(go(spot.x, spot.z, 0.8 + 0.2 * s));
  }
  c.chasing = -1;

  // Nothing coming: line up near the fence, aim, and launch together.
  const centreZ = solo ? me.z : clamp((me.z + partner.z) / 2, -1.5, 1.5);
  if (t >= c.rethink) {
    c.homeX = -sd * (1.4 + rng() * 1.6 + (1 - s) * 1.0);
    // Sharp holders aim away from the other towel, keeping it on the deck even at full power; sleepy ones
    // just roughly across.
    const theirs = towelEnds(d, 1 - team);
    const oz = theirs ? (theirs.az + theirs.bz) / 2 : 0;
    const away = -Math.sign(oz - centreZ || rng() - 0.5);
    const room = (TOWEL.half.z - 0.5 - away * centreZ) / TOWEL.far;
    const sharp = away * Math.min(0.15 + rng() * 0.3, Math.asin(clamp(room, -1, 1)));
    c.aim = clamp(s * sharp + (1 - s) * (rng() - 0.5) * 0.7, -TOWEL.maxAngle, TOWEL.maxAngle);
    c.rethink = t + 2 + rng() * 2;
  }
  const len = 1.9;
  const spot = slot(c.homeX, centreZ * 0.8, c.aim, len);
  let stick = go(spot.x, spot.z, 0.55 + 0.35 * s);
  if (side.stock <= 0 || side.cooldown > 0) return out(stick);

  // Answer the partner's press (a sharp holder quickly), or lead when lined up.
  const partnerPending = partner?.pending ?? null;
  if (partnerPending !== null && c.answering !== partnerPending) {
    c.answering = partnerPending;
    c.pressAt = t + Math.abs(bell(rng)) * (0.025 + (1 - s) * 0.12) + 0.02;
  }
  // A sharp holder also checks the towel points somewhere on the deck, short or long.
  const onDeck = (q: { x: number; z: number }) => Math.abs(q.x) < TOWEL.half.x - 0.3 && Math.abs(q.z) < TOWEL.half.z - 0.3;
  const safe = s < 0.3 || (onDeck(aimPoint(d, team, 1)) && onDeck(aimPoint(d, team, 0.3)));
  const lined = Math.hypot(spot.x - me.x, spot.z - me.z) < 0.35 && safe;
  const leads = solo || member === 0 || !partnerIsCpu;
  if (c.pressAt === Infinity && lined && leads && me.pending === null) {
    c.pressAt = t + (partnerIsCpu ? 0.15 + rng() * 0.4 : 1.6 + rng() * 1.2);
  }
  if (t >= c.pressAt && !c.pressed) {
    c.pressAt = Infinity;
    stick = { ...stick, a: true };
  }
  return out(stick);
}
