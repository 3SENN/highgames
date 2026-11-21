// Leaf Pile: an autumn backyard at dusk, covered in fallen leaves. Two teams, two raking zones: team 0's against
// the left fence, team 1's against the right. Walking pushes the leaves in front of you along like a little plough;
// Dive lunges forward and lands in a burst that scatters the leaves round where you land (3 s before you can dive
// again, and you lie in the leaves for a moment). After 35 s, and a moment for airborne leaves to come down, the
// leaves inside each zone are counted: the bigger pile wins.
//
// Everything happens on the floor, in its x/z plane: +z points at the TV audience, and a stick's y (up on the
// phone) runs away from the audience, toward -z.
//  - The leaves start mirrored left to right, so both teams have exactly the same yard to work with.
//  - Diving into your own pile just fluffs it up; diving onto open lawn scatters whatever is there; diving into
//    the other team's pile throws its leaves back out toward the middle of the yard.
//  - A dive that runs into someone stops right there: standing in front of your pile guards it.
//  - A dive pressed just as time runs out still counts if the press left the phone in time (half its round trip).
import type { Rng } from '../rng.js';

export const LEAF = {
  duration: 35, // seconds of raking
  settle: 1.2, // seconds after the whistle for airborne leaves to come down before the count
  step: 1 / 120,
  perSide: 100, // leaves on each half of the yard (mirrored)
  yard: { x: 6.6, z: 3.6 }, // half-size of the lawn inside the fences
  zone: { x: 4.6, z: 2.1 }, // a zone runs from |x| = zone.x to the side fence, and |z| <= zone.z
  bodyR: 0.38,
  pushR: 0.6, // leaves inside this distance of someone standing get pushed out to it
  leafR: 0.08,
  speed: 3.6, // units a second at full stick
  response: 12, // how quickly walking follows the stick
  deadzone: 0.15,
  carry: 0.9, // how much of the walker's speed a pushed leaf takes on
  friction: 5, // leaves on the grass slow down by this rate (per second, exponential)
  airDrag: 1.4,
  gravity: 6, // leaves float down gently
  maxLag: 0.15, // the most round-trip compensation a phone gets, in seconds
} as const;

export const DIVE = {
  speed: 7.5, // lunge speed
  time: 0.2, // seconds in the air
  down: 1.0, // seconds lying in the leaves after landing
  cooldown: 3, // seconds from one dive to the next
  burstR: 1.15, // leaves this close to the landing spot go flying…
  maxScatter: 14, // …the nearest ones, up to this many (a big pile takes a few dives to flatten)
  burstSpeed: [3.5, 6] as const,
  lift: [1.8, 2.8] as const,
  bias: 0.6, // leaves scattered out of a zone are thrown toward the middle of the yard this much
  fluff: 0.9, // diving into your own pile only lifts its leaves a little
} as const;

export interface Stick {
  x: number;
  y: number;
  /** A press of Dive (the TV latches the rising edge). */
  a: boolean;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

export interface Leaf {
  x: number;
  z: number;
  /** Height above the grass (0 when lying on it). */
  y: number;
  vx: number;
  vz: number;
  vy: number;
}

export interface Raker {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Heading in the x/z plane (0 faces +z, the audience). */
  face: number;
  /** Team index (-1: none), and place in the team. */
  team: number;
  member: number;
  /** Seconds of lunge left (diving through the air). */
  lunge: number;
  /** Seconds left lying in the leaves. */
  down: number;
  /** Seconds before the next dive. */
  cool: number;
  dives: number;
  /** Dives that scattered the other team's pile. */
  raids: number;
  /** Leaves pushed this step (for rustling sounds). */
  pushing: number;
}

export type Phase = 'play' | 'settle' | 'done';

export interface Yard {
  leaves: Leaf[];
  rakers: Raker[];
  /** Seat positions per team. */
  teams: number[][];
  time: number;
  acc: number;
  phase: Phase;
  rng: Rng;
}

export interface Landing {
  who: number;
  x: number;
  z: number;
  /** Whose zone the dive landed in (-1: the open lawn). */
  zone: number;
  /** Leaves sent flying. */
  scattered: number;
}

export interface LeafEvents {
  /** Dives that started. */
  dives: number[];
  lands: Landing[];
  /** Divers back on their feet. */
  ups: number[];
  /** Presses while still recovering from the last dive. */
  denied: number[];
  /** Leaves each raker pushed during this advance (summed over the steps). */
  rustle: number[];
  steps: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Which way a team's zone lies: team 0 to the left (-1), team 1 to the right (+1). */
export function zoneSide(team: number): number {
  return team === 0 ? -1 : 1;
}

/** Whether a point is inside `team`'s zone, grown by `margin`. */
export function inZone(x: number, z: number, team: number, margin = 0): boolean {
  if (team !== 0 && team !== 1) return false;
  return zoneSide(team) * x >= LEAF.zone.x - margin && Math.abs(z) <= LEAF.zone.z + margin;
}

/** Whose zone a point is in (-1: neither). */
export function zoneAt(x: number, z: number, margin = 0): number {
  if (inZone(x, z, 0, margin)) return 0;
  if (inZone(x, z, 1, margin)) return 1;
  return -1;
}

/** Leaves in `team`'s zone right now. */
export function pileCount(yard: Yard, team: number): number {
  let n = 0;
  for (const l of yard.leaves) if (inZone(l.x, l.z, team)) n++;
  return n;
}

/** Scores per seat: the leaves in their team's pile (teammates always the same). */
export function leafScores(yard: Yard, seats: number): number[] {
  const piles = [pileCount(yard, 0), pileCount(yard, 1)];
  return Array.from({ length: seats }, (_, i) => {
    const team = yard.rakers[i]?.team ?? -1;
    return team === 0 || team === 1 ? (piles[team] as number) : 0;
  });
}

function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * The fallen leaves: a heap in the middle under the tree, a couple of drifts and a scattering, on the left half,
 * then mirrored onto the right half. None start inside a zone.
 */
export function makeLeaves(rng: Rng): Leaf[] {
  const half: { x: number; z: number }[] = [];
  const maxX = -0.05;
  const minX = -(LEAF.zone.x - 0.25);
  const maxZ = LEAF.yard.z - 0.12;
  const put = (x: number, z: number) => half.push({ x: clamp(x, minX, maxX), z: clamp(z, -maxZ, maxZ) });
  const heap = Math.round(LEAF.perSide * 0.16);
  const drift = Math.round(LEAF.perSide * 0.22);
  for (let k = 0; k < heap; k++) put(-0.05 - Math.abs(gauss(rng)) * 0.45, gauss(rng) * 0.6);
  for (let d = 0; d < 2; d++) {
    const cx = -1.4 - rng() * 2.2;
    const cz = (d === 0 ? -1 : 1) * (0.6 + rng() * 2.0);
    for (let k = 0; k < drift; k++) put(cx + gauss(rng) * 0.45, cz + gauss(rng) * 0.45);
  }
  while (half.length < LEAF.perSide) put(lerp(minX, -0.2, rng()), lerp(-maxZ, maxZ, rng()));
  const leaf = (x: number, z: number): Leaf => ({ x, z, y: 0, vx: 0, vz: 0, vy: 0 });
  return [...half.map((p) => leaf(p.x, p.z)), ...half.map((p) => leaf(-p.x, p.z))];
}

/** A fresh yard: each team starts in its half, facing the audience. `teams` holds seat positions. */
export function newYard(teams: readonly (readonly number[])[], seats: number, rng: Rng): Yard {
  const rakers: Raker[] = Array.from({ length: seats }, (_, i) => {
    const team = teams.findIndex((t) => t.includes(i));
    const members = teams[team] ?? [i];
    const member = Math.max(0, members.indexOf(i));
    const n = members.length;
    const z = n > 1 ? (member / (n - 1) - 0.5) * 2.6 : 0;
    const x = team < 0 ? 0 : zoneSide(team) * 2.4;
    return { x, z, vx: 0, vz: 0, face: 0, team: team > 1 ? -1 : team, member, lunge: 0, down: 0, cool: 0, dives: 0, raids: 0, pushing: 0 };
  });
  return { leaves: makeLeaves(rng), rakers, teams: teams.map((t) => [...t]), time: 0, acc: 0, phase: 'play', rng };
}

function noEvents(seats: number): LeafEvents {
  return { dives: [], lands: [], ups: [], denied: [], rustle: new Array<number>(seats).fill(0), steps: 0 };
}

/** The dive comes down at the raker's chest: leaves round it go flying (or, in your own pile, just fluff up). */
function land(yard: Yard, i: number, ev: LeafEvents): void {
  const r = yard.rakers[i] as Raker;
  r.lunge = 0;
  r.down = DIVE.down;
  r.vx = r.vz = 0;
  const x = r.x + Math.sin(r.face) * 0.3;
  const z = r.z + Math.cos(r.face) * 0.3;
  const zone = zoneAt(x, z, 0.6);
  const own = zone >= 0 && zone === r.team;
  const rng = yard.rng;
  // The nearest leaves go flying, up to a handful; the rest of the heap just puffs up.
  const near = yard.leaves
    .map((l) => ({ l, d: Math.hypot(l.x - x, l.z - z) }))
    .filter((n) => n.d <= DIVE.burstR)
    .sort((a, b) => a.d - b.d);
  let scattered = 0;
  for (const { l, d } of near) {
    const dx = l.x - x;
    const dz = l.z - z;
    if (own || scattered >= DIVE.maxScatter) {
      l.vy = Math.max(l.vy, DIVE.fluff * (0.6 + 0.6 * rng()));
      l.y = Math.max(l.y, 0.01);
      l.vx += (rng() - 0.5) * 0.3;
      l.vz += (rng() - 0.5) * 0.3;
      continue;
    }
    let nx: number;
    let nz: number;
    if (d > 1e-3) {
      nx = dx / d;
      nz = dz / d;
    } else {
      const a = rng() * Math.PI * 2;
      nx = Math.cos(a);
      nz = Math.sin(a);
    }
    // Out of a zone, everything flies back toward the middle of the yard (not into the fence).
    if (zone >= 0) {
      const side = zoneSide(zone);
      if (nx * side > 0) nx = -nx;
      nx -= side * DIVE.bias;
    }
    const len = Math.hypot(nx, nz) || 1;
    const sp = lerp(DIVE.burstSpeed[0], DIVE.burstSpeed[1], rng()) * (1 - 0.35 * (d / DIVE.burstR));
    l.vx = (nx / len) * sp;
    l.vz = (nz / len) * sp;
    l.vy = lerp(DIVE.lift[0], DIVE.lift[1], rng());
    l.y = Math.max(l.y, 0.01);
    scattered++;
  }
  if (zone >= 0 && !own && scattered > 0) r.raids += 1;
  ev.lands.push({ who: i, x, z, zone, scattered });
}

/** One fixed step. `press` holds this step's presses; `lags` each seat's phone delay in seconds. */
function stepYard(yard: Yard, sticks: readonly Stick[], press: readonly boolean[], lags: readonly number[], ev: LeafEvents): void {
  const dt = LEAF.step;
  yard.time += dt;
  if (yard.phase === 'play' && yard.time >= LEAF.duration) yard.phase = 'settle';
  const playing = yard.phase === 'play';
  const late = yard.time - LEAF.duration;
  const bx = LEAF.yard.x - LEAF.bodyR;
  const bz = LEAF.yard.z - LEAF.bodyR;
  const hit = new Array<boolean>(yard.rakers.length).fill(false);

  // Presses, timers and walking.
  yard.rakers.forEach((r, i) => {
    r.cool = Math.max(0, r.cool - dt);
    r.pushing = 0;
    const s = sticks[i] ?? IDLE;
    const mag = Math.hypot(s.x, s.y);
    const moving = mag >= LEAF.deadzone;
    if (press[i]) {
      const allowed = playing || (yard.phase === 'settle' && late <= clamp(lags[i] ?? 0, 0, LEAF.maxLag));
      if (allowed && r.cool <= 0 && r.lunge <= 0 && r.down <= 0) {
        if (moving) r.face = Math.atan2(s.x, -s.y);
        r.lunge = DIVE.time;
        r.cool = DIVE.cooldown;
        r.dives += 1;
        ev.dives.push(i);
      } else if (allowed) {
        ev.denied.push(i);
      }
    }
    if (r.down > 0) {
      r.vx = r.vz = 0;
      r.down -= dt;
      if (r.down <= 0) {
        r.down = 0;
        ev.ups.push(i);
      }
      return;
    }
    if (r.lunge > 0) {
      r.vx = Math.sin(r.face) * DIVE.speed;
      r.vz = Math.cos(r.face) * DIVE.speed;
    } else {
      const k = !playing || !moving ? 0 : Math.min(1, mag) / mag;
      const follow = 1 - Math.exp(-LEAF.response * dt);
      r.vx += (s.x * k * LEAF.speed - r.vx) * follow;
      r.vz += (-s.y * k * LEAF.speed - r.vz) * follow;
    }
    r.x += r.vx * dt;
    r.z += r.vz * dt;
    if (Math.abs(r.x) > bx || Math.abs(r.z) > bz) {
      hit[i] = r.lunge > 0;
      r.x = clamp(r.x, -bx, bx);
      r.z = clamp(r.z, -bz, bz);
    }
    if (r.lunge <= 0 && Math.hypot(r.vx, r.vz) > 0.3) r.face = Math.atan2(r.vx, r.vz);
  });

  // Nobody walks through anybody; a dive that runs into someone comes down right there.
  const rs = yard.rakers;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i] as Raker;
      const b = rs[j] as Raker;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = LEAF.bodyR * 2;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const push = (min - d) / 2;
      a.x = clamp(a.x - nx * push, -bx, bx);
      a.z = clamp(a.z - nz * push, -bz, bz);
      b.x = clamp(b.x + nx * push, -bx, bx);
      b.z = clamp(b.z + nz * push, -bz, bz);
      if (a.lunge > 0) hit[i] = true;
      if (b.lunge > 0) hit[j] = true;
    }
  }
  rs.forEach((r, i) => {
    if (r.lunge <= 0) return;
    r.lunge -= dt;
    if (r.lunge <= 0 || hit[i]) land(yard, i, ev);
  });

  // The leaves: flying ones float down, lying ones get pushed by whoever walks into them.
  const lx = LEAF.yard.x - LEAF.leafR;
  const lz = LEAF.yard.z - LEAF.leafR;
  const groundDrag = Math.exp(-LEAF.friction * dt);
  const airDrag = Math.exp(-LEAF.airDrag * dt);
  for (const l of yard.leaves) {
    if (l.y > 0 || l.vy > 0) {
      l.vy -= LEAF.gravity * dt;
      l.vx *= airDrag;
      l.vz *= airDrag;
      l.y += l.vy * dt;
      if (l.y <= 0) {
        l.y = 0;
        l.vy = 0;
        l.vx *= 0.35;
        l.vz *= 0.35;
      }
    } else {
      rs.forEach((r, i) => {
        if (r.down > 0) return;
        const dx = l.x - r.x;
        const dz = l.z - r.z;
        const d = Math.hypot(dx, dz);
        if (d >= LEAF.pushR) return;
        let nx: number;
        let nz: number;
        if (d > 1e-4) {
          nx = dx / d;
          nz = dz / d;
        } else {
          nx = Math.sin(r.face);
          nz = Math.cos(r.face);
        }
        l.x = r.x + nx * LEAF.pushR;
        l.z = r.z + nz * LEAF.pushR;
        // Carried along: mostly the walker's own velocity, a little straight out from them.
        const along = r.vx * nx + r.vz * nz;
        if (along > 0) {
          l.vx = LEAF.carry * (0.6 * r.vx + 0.4 * nx * along);
          l.vz = LEAF.carry * (0.6 * r.vz + 0.4 * nz * along);
        }
        r.pushing += 1;
        ev.rustle[i] = (ev.rustle[i] ?? 0) + (along > 0.5 ? 1 : 0);
      });
      l.vx *= groundDrag;
      l.vz *= groundDrag;
    }
    l.x += l.vx * dt;
    l.z += l.vz * dt;
    if (Math.abs(l.x) > lx) {
      l.x = clamp(l.x, -lx, lx);
      l.vx = 0;
    }
    if (Math.abs(l.z) > lz) {
      l.z = clamp(l.z, -lz, lz);
      l.vz = 0;
    }
  }

  if (yard.phase === 'settle' && yard.time >= LEAF.duration + LEAF.settle) yard.phase = 'done';
}

/**
 * Advances the yard by `dt` in fixed steps. A stick's `a` is a press: it counts on the first step only.
 * `lags`: each seat's phone delay in seconds (half its round trip).
 */
export function advance(yard: Yard, sticks: readonly Stick[], dt: number, lags: readonly number[] = []): LeafEvents {
  const ev = noEvents(yard.rakers.length);
  yard.acc += Math.min(Math.max(0, dt), 0.6);
  let press = sticks.map((s) => s.a);
  // (A hair of slack, so 0.5 s really is 60 steps despite rounding.)
  while (yard.acc >= LEAF.step - 1e-9 && yard.phase !== 'done') {
    yard.acc -= LEAF.step;
    stepYard(yard, sticks, press, lags, ev);
    ev.steps += 1;
    press = press.map(() => false);
  }
  return ev;
}

// ------------------------------------------------------------------ computer players

export interface Brain {
  skill: number;
  /** Game time of the next decision (sleepy players react late), and of the last one. */
  next: number;
  thought: number;
  x: number;
  y: number;
  press: boolean;
  mode: 'rake' | 'raid' | 'doze';
  /** When a doze or a raid gives up. */
  until: number;
  /** The leaf being herded (-1: none), and when to look for a better one. */
  leaf: number;
  pickAt: number;
  /** How far that leaf was from the pile when last checked, and when to check again that it's getting closer. */
  gap: number;
  checkAt: number;
  /** Leaves given up on for now (stuck in a corner, say). */
  skip: { leaf: number; until: number }[];
}

export function newBrain(skill: number, rng: Rng): Brain {
  return { skill: clamp(skill, 0, 1), next: rng() * 0.3, thought: 0, x: 0, y: 0, press: false, mode: 'rake', until: 0, leaf: -1, pickAt: 0, gap: 0, checkAt: 0, skip: [] };
}

/** Where a leaf should go to end up in `team`'s pile. */
function pileSpot(team: number, z: number): { x: number; z: number } {
  return { x: zoneSide(team) * (LEAF.zone.x + 0.9), z: clamp(z, -(LEAF.zone.z - 0.6), LEAF.zone.z - 0.6) };
}

/** The spot behind a leaf from which walking pushes it toward the pile, and how far that had to be pulled in. */
function behind(l: Leaf, team: number): { x: number; z: number; dx: number; dz: number; off: number } {
  const t = pileSpot(team, l.z);
  const len = Math.hypot(t.x - l.x, t.z - l.z) || 1;
  const dx = (t.x - l.x) / len;
  const dz = (t.z - l.z) / len;
  const bx = l.x - dx * 0.75;
  const bz = l.z - dz * 0.75;
  const mx = LEAF.yard.x - LEAF.bodyR;
  const mz = LEAF.yard.z - LEAF.bodyR;
  const x = clamp(bx, -mx, mx);
  const z = clamp(bz, -mz, mz);
  return { x, z, dx, dz, off: Math.hypot(bx - x, bz - z) };
}

function steer(b: Brain, gx: number, gz: number, speed: number, noise: number): void {
  const len = Math.hypot(gx, gz);
  if (len < 0.08) {
    b.x = b.y = 0;
    return;
  }
  const a = Math.atan2(gx, gz) + noise;
  const m = clamp(speed, 0, 1);
  b.x = Math.sin(a) * m;
  b.y = -Math.cos(a) * m;
}

/** The middle of the thickest part of `team`'s pile (null: it has fewer than 3 leaves). */
export function pileHeart(yard: Yard, team: number): { x: number; z: number; n: number } | null {
  const inside = yard.leaves.filter((l) => inZone(l.x, l.z, team));
  if (inside.length < 3) return null;
  let best = inside[0] as Leaf;
  let bestN = -1;
  for (const a of inside) {
    let n = 0;
    for (const c of inside) if (Math.abs(c.x - a.x) < 1 && Math.abs(c.z - a.z) < 1) n++;
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  let sx = 0;
  let sz = 0;
  let k = 0;
  for (const c of inside) {
    if (Math.hypot(c.x - best.x, c.z - best.z) > 1.1) continue;
    sx += c.x;
    sz += c.z;
    k++;
  }
  return { x: sx / k, z: sz / k, n: bestN };
}

function pickLeaf(yard: Yard, i: number, b: Brain, rng: Rng): void {
  const me = yard.rakers[i] as Raker;
  const mates = (yard.teams[me.team] ?? []).filter((p) => p !== i).map((p) => yard.rakers[p]);
  const cell = 0.6;
  const grid = new Map<string, number>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;
  for (const l of yard.leaves) grid.set(key(l.x, l.z), (grid.get(key(l.x, l.z)) ?? 0) + 1);
  const opp = me.team === 0 ? 1 : 0;
  b.skip = b.skip.filter((k) => k.until > yard.time);
  let best = -1;
  let bestCost = Infinity;
  yard.leaves.forEach((l, j) => {
    if (l.y > 0.3 || inZone(l.x, l.z, me.team, -0.2) || b.skip.some((k) => k.leaf === j)) return;
    const back = behind(l, me.team);
    // Wedged in a corner or against the fence the wrong way: nobody can get behind it.
    if (back.off > 0.3) return;
    const t = pileSpot(me.team, l.z);
    let cost = Math.hypot(me.x - back.x, me.z - back.z) + 0.5 * Math.hypot(t.x - l.x, t.z - l.z);
    cost -= 0.25 * b.skill * Math.min(8, grid.get(key(l.x, l.z)) ?? 0);
    if (back.off > 0.1) cost += 1.5;
    for (const m of mates) if (m && Math.hypot(m.x - l.x, m.z - l.z) < 1.5) cost += 2;
    if (inZone(l.x, l.z, opp)) cost -= 0.8 * b.skill; // stealing from their pile counts twice
    cost += rng() * (0.3 + (1 - b.skill) * 3);
    if (cost < bestCost) {
      bestCost = cost;
      best = j;
    }
  });
  b.leaf = best;
  b.pickAt = yard.time + 1.2 + rng() * 0.8 + (1 - b.skill) * 1.0;
  const l = yard.leaves[best];
  b.gap = l ? gapToPile(l, me.team) : 0;
  b.checkAt = yard.time + 2.5;
}

function gapToPile(l: Leaf, team: number): number {
  const t = pileSpot(team, l.z);
  return Math.hypot(t.x - l.x, t.z - l.z);
}

function rake(yard: Yard, i: number, b: Brain, rng: Rng): void {
  const me = yard.rakers[i] as Raker;
  const cur = yard.leaves[b.leaf];
  // A leaf that hasn't come any closer to the pile in a while is a lost cause for now.
  if (cur && yard.time >= b.checkAt) {
    const gap = gapToPile(cur, me.team);
    if (gap > b.gap - 0.4) {
      b.skip.push({ leaf: b.leaf, until: yard.time + 6 });
      b.leaf = -1;
    }
    b.gap = gap;
    b.checkAt = yard.time + 2.5;
  }
  const pushing = (l: Leaf) => {
    const back = behind(l, me.team);
    const rx = me.x - l.x;
    const rz = me.z - l.z;
    return { back, rx, rz, ahead: rx * back.dx + rz * back.dz, side: rx * back.dz - rz * back.dx };
  };
  const now = cur && b.leaf >= 0 ? pushing(cur) : null;
  const lined = now !== null && now.ahead < -0.2 && Math.abs(now.side) < 0.4;
  if (!cur || b.leaf < 0 || (yard.time >= b.pickAt && !lined) || inZone(cur.x, cur.z, me.team, -0.35) || cur.y > 0.3) pickLeaf(yard, i, b, rng);
  const l = yard.leaves[b.leaf];
  if (!l) {
    b.x = b.y = 0;
    return;
  }
  const noise = (rng() - 0.5) * 2 * (1 - b.skill) * 0.3;
  const pace = 0.55 + 0.45 * b.skill;
  const { back, rx, rz, ahead, side } = pushing(l);
  if (ahead < -0.2 && Math.abs(side) < 0.4) {
    // Lined up behind it: walk on through, toward the pile.
    steer(b, l.x + back.dx * 0.8 - me.x, l.z + back.dz * 0.8 - me.z, pace, noise);
    return;
  }
  // Get round behind it without pushing it the wrong way.
  let gx = back.x - me.x;
  let gz = back.z - me.z;
  const len = Math.hypot(gx, gz);
  if (len > 1e-6) {
    const ux = gx / len;
    const uz = gz / len;
    const along = clamp(-(rx * ux + rz * uz), 0, len);
    const px = me.x + ux * along - l.x;
    const pz = me.z + uz * along - l.z;
    if (Math.hypot(px, pz) < 0.6 && along > 0 && along < len) {
      // Round the side it's on: to a spot beside the leaf and a little behind it.
      const s = side >= 0 ? 1 : -1;
      gx = l.x + back.dz * s * 0.9 - back.dx * 0.6 - me.x;
      gz = l.z - back.dx * s * 0.9 - back.dz * 0.6 - me.z;
    }
  }
  steer(b, gx, gz, len < 0.6 ? pace * 0.6 : pace, noise);
}

function raid(yard: Yard, i: number, b: Brain, rng: Rng): void {
  const me = yard.rakers[i] as Raker;
  const opp = me.team === 0 ? 1 : 0;
  const heart = pileHeart(yard, opp);
  if (!heart || me.cool > 0 || yard.time > b.until) {
    b.mode = 'rake';
    rake(yard, i, b, rng);
    return;
  }
  const out = -zoneSide(opp); // from their pile toward the middle of the yard
  const dx = heart.x - me.x;
  const dz = heart.z - me.z;
  const dist = Math.hypot(dx, dz);
  // Sleepy players dive from too far away and come up short.
  const reach = 1.6 + (1 - b.skill) * rng() * 1.4;
  if (dist <= reach && (me.x - heart.x) * out > 0.3) {
    const noise = (rng() - 0.5) * 2 * (1 - b.skill) * 0.4;
    steer(b, dx, dz, 1, noise);
    b.press = true;
    b.mode = 'rake';
    return;
  }
  steer(b, heart.x + out * 1.4 - me.x, heart.z - me.z, 0.8 + 0.2 * b.skill, (rng() - 0.5) * (1 - b.skill) * 0.4);
}

function think(yard: Yard, i: number, b: Brain, rng: Rng): void {
  const me = yard.rakers[i];
  if (!me || me.down > 0 || me.lunge > 0 || yard.phase !== 'play' || (me.team !== 0 && me.team !== 1)) {
    b.x = b.y = 0;
    return;
  }
  const t = yard.time;
  if (b.mode === 'doze') {
    if (t < b.until) return;
    b.mode = 'rake';
  }
  // Sleepy players zone out now and then.
  if (rng() < (1 - b.skill) * 0.035) {
    b.mode = 'doze';
    b.until = t + 0.5 + rng() * 1.2;
    b.x = b.y = 0;
    return;
  }
  const opp = me.team === 0 ? 1 : 0;
  const hasOpp = yard.rakers.some((r) => r.team === opp);
  if (b.mode === 'rake' && hasOpp && me.cool <= 0) {
    const theirs = pileCount(yard, opp);
    if (theirs >= 8) {
      // How keen they are to go and dive, per second: keener on a big pile, and (sharp ones) near the end.
      const left = LEAF.duration - t;
      const mates = (yard.teams[me.team] ?? []).filter((p) => p !== i).map((p) => yard.rakers[p]);
      const busy = mates.some((m) => m && (m.lunge > 0 || zoneSide(opp) * m.x > LEAF.zone.x - 2));
      const base = left < 8 ? 0.04 + 0.5 * b.skill : 0.045 - 0.025 * b.skill;
      const rate = base * Math.min(1.5, theirs / 20) * (busy ? 0.25 : 1);
      if (rng() < rate * (t - b.thought)) {
        b.mode = 'raid';
        b.until = t + 6;
      }
    }
  }
  if (b.mode === 'raid') raid(yard, i, b, rng);
  else rake(yard, i, b, rng);
}

/** A computer player's stick for this frame (`i` is its seat position). */
export function cpuStick(yard: Yard, i: number, b: Brain, rng: Rng): Stick {
  if (yard.time >= b.next) {
    think(yard, i, b, rng);
    b.thought = yard.time;
    b.next = yard.time + 0.07 + (1 - b.skill) * 0.25 + rng() * 0.05;
  }
  const a = b.press;
  b.press = false;
  return { x: b.x, y: b.y, a };
}
