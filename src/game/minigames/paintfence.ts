// Paint the Fence: a long picket fence across a sunny backyard and a paint bucket per pair at each end of the
// lawn. Walk along the fence and your brush paints the board you're nearest to (a moment per board, slowing you to
// a stroll) in your pair's colour; boards can be painted over. Paint runs out, so head back to your bucket to fill
// up. A sleepy dog naps against the fence, and nobody can paint the boards behind it until someone walks past and
// it ambles off somewhere else. Most boards in your colour after 35 seconds wins.
//
// Everything happens in the yard's x/z plane: the fence runs along x at z = FENCE.z, +z points at the TV audience.
// A stick's y (up on the phone) runs away from the audience (-z, towards the fence).
import type { Rng } from '../rng.js';

export const FENCE = {
  duration: 35, // seconds
  boards: 36,
  gap: 0.44, // from one board to the next
  z: -1.2, // the fence line
  near: 0.42, // nobody gets closer to the fence than this
  reach: 0.95, // a brush reaches the fence from this far away
  front: 3.0, // the yard's front edge (z)
  bodyR: 0.36,
  speed: 3.9, // walking speed at full stick
  brush: 1.35, // walking speed while the brush is on a board
  response: 10, // how quickly walking follows the stick
  deadzone: 0.18,
  coat: 0.3, // seconds to paint a board
  tank: 9, // boards a full brush paints
  fill: 0.8, // seconds from empty to full at the bucket
  bucketR: 0.8, // stand this close to a bucket to fill up
  stations: [-4.2, 4.2] as readonly number[], // bucket pairs on the lawn, one bucket per team at each
  bucketZ: 2.0,
  bucketGap: 0.42, // team 0's bucket this far left of the station, team 1's this far right
  dog: {
    half: 0.6, // half the length of a dog lying down
    r: 0.3,
    dz: 0.52, // lies this far in front of the fence
    block: 0.8, // boards this close to the dog (in x) can't be painted
    wake: 0.75, // someone walking past this close (from its body) wakes it...
    calm: 3, // ... once it has napped for this long
    first: 1.5, // (at the start, it's been napping a while already)
    stretch: 0.8, // seconds of stretching before it wanders off
    speed: 1.7,
    range: 6.6, // it naps no further from the middle than this
  },
  step: 1 / 120, // physics sub-step
} as const;

export interface Stick {
  x: number;
  y: number;
}

export const IDLE: Stick = { x: 0, y: 0 };

export interface Board {
  /** Whose colour it is: 0, 1, or -1 for bare wood. */
  team: number;
  /** Each team's coat in progress (0..1). */
  wet: [number, number];
  /** Seat position that finished the current coat, or -1. */
  by: number;
}

export interface Painter {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Paint on the brush, 0..1 (1 paints FENCE.tank boards). */
  paint: number;
  /** The board the brush is on this step, or -1. */
  painting: number;
  /** Boards this painter finished. */
  boards: number;
}

export interface Dog {
  x: number;
  z: number;
  state: 'nap' | 'stretch' | 'walk';
  /** Seconds in the current state. */
  t: number;
  /** Where it's wandering to. */
  tx: number;
  moves: number;
}

export interface Yard {
  /** Team (0 or 1) per seat position; -1 for a seat that isn't playing. */
  teamOf: number[];
  painters: Painter[];
  boards: Board[];
  dog: Dog;
  time: number;
  rng: Rng;
}

export interface YardEvents {
  painted: { board: number; p: number; team: number; from: number }[];
  /** Brush full again at the bucket. */
  filled: number[];
  /** Ran out of paint on a board. */
  dry: number[];
  /** The dog woke up (seat position that disturbed it). */
  woke: number[];
  settled: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The x of board `i`. */
export function boardX(i: number): number {
  return (i - (FENCE.boards - 1) / 2) * FENCE.gap;
}

/** Half the fence's length (to the outer edge of the end boards). */
export const FENCE_HALF = (FENCE.boards / 2) * FENCE.gap;

/** Where a team's bucket at a station stands. */
export function bucketsOf(team: number): { x: number; z: number }[] {
  return FENCE.stations.map((x) => ({ x: x + (team === 0 ? -1 : 1) * FENCE.bucketGap, z: FENCE.bucketZ }));
}

/** The board nearest x, or -1 when past the ends. */
export function boardAt(x: number): number {
  const i = Math.round(x / FENCE.gap + (FENCE.boards - 1) / 2);
  if (i < 0 || i >= FENCE.boards) return -1;
  return Math.abs(x - boardX(i)) <= FENCE.gap * 0.75 ? i : -1;
}

/** Whether the napping dog is in front of board `i`. */
export function blocked(y: Yard, i: number): boolean {
  return y.dog.state === 'nap' && Math.abs(boardX(i) - y.dog.x) < FENCE.dog.block;
}

function painter(x: number, z: number): Painter {
  return { x, z, vx: 0, vz: 0, paint: 1, painting: -1, boards: 0 };
}

/** A yard for `seats` seat positions split into `teams` (two lists of positions). `rng` moves the dog about. */
export function newYard(teams: readonly (readonly number[])[], seats: number, rng: Rng): Yard {
  const teamOf = new Array<number>(seats).fill(-1);
  const painters: Painter[] = [];
  for (let p = 0; p < seats; p++) painters.push(painter(0, 0));
  teams.slice(0, 2).forEach((members, team) => {
    members.forEach((p, m) => {
      if (p < 0 || p >= seats) return;
      teamOf[p] = team;
      const side = team === 0 ? -1 : 1;
      const x = members.length < 2 ? 3.6 : m === 0 ? 5.6 : 2.0;
      painters[p] = painter(side * x, 1.0);
    });
  });
  const boards: Board[] = Array.from({ length: FENCE.boards }, () => ({ team: -1, wet: [0, 0], by: -1 }));
  const dog: Dog = { x: 0, z: FENCE.z + FENCE.dog.dz, state: 'nap', t: FENCE.dog.calm - FENCE.dog.first, tx: 0, moves: 0 };
  return { teamOf, painters, boards, dog, time: 0, rng };
}

export function isOver(y: Yard): boolean {
  return y.time >= FENCE.duration;
}

/** Boards in a team's colour. */
export function boardsOf(y: Yard, team: number): number {
  return y.boards.filter((b) => b.team === team).length;
}

/** The board `p`'s brush would be on right now (in reach, not theirs already, not behind the dog), or -1. */
export function brushOn(y: Yard, p: number): number {
  const c = y.painters[p];
  const team = y.teamOf[p] ?? -1;
  if (!c || team < 0 || c.paint <= 0 || c.z - FENCE.z > FENCE.reach) return -1;
  const i = boardAt(c.x);
  if (i < 0 || blocked(y, i) || y.boards[i]?.team === team) return -1;
  return i;
}

/** Distance from (x, z) to the lying dog's body (a capsule along x). */
function toDog(d: Dog, x: number, z: number): { dist: number; nx: number; nz: number } {
  const cx = clamp(x, d.x - FENCE.dog.half, d.x + FENCE.dog.half);
  const dx = x - cx;
  const dz = z - d.z;
  const dist = Math.hypot(dx, dz);
  return dist > 1e-6 ? { dist, nx: dx / dist, nz: dz / dist } : { dist, nx: 0, nz: 1 };
}

/** Keeps painters in the yard, off the fence, out of the dog and out of each other. */
function separate(y: Yard): void {
  const cs = y.painters;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      if ((y.teamOf[i] ?? -1) < 0 || (y.teamOf[j] ?? -1) < 0) continue;
      const a = cs[i] as Painter;
      const b = cs[j] as Painter;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = FENCE.bodyR * 2;
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
  cs.forEach((c, p) => {
    if ((y.teamOf[p] ?? -1) < 0) return;
    if (y.dog.state !== 'walk') {
      const d = toDog(y.dog, c.x, c.z);
      const min = FENCE.dog.r + FENCE.bodyR;
      if (d.dist < min) {
        c.x += d.nx * (min - d.dist);
        c.z += d.nz * (min - d.dist);
      }
    }
    const xMax = FENCE_HALF + 0.6;
    if (Math.abs(c.x) > xMax) {
      c.x = clamp(c.x, -xMax, xMax);
      c.vx = 0;
    }
    const zMin = FENCE.z + FENCE.near;
    if (c.z < zMin || c.z > FENCE.front) {
      c.z = clamp(c.z, zMin, FENCE.front);
      c.vz = 0;
    }
  });
}

/** Somewhere new along the fence for the dog: well away from where it was, and from everybody. */
function dogSpot(y: Yard): number {
  let best = y.dog.x;
  let bestScore = -Infinity;
  for (let k = 0; k < 8; k++) {
    const x = (y.rng() * 2 - 1) * FENCE.dog.range;
    if (Math.abs(x - y.dog.x) < 2.5) continue;
    let near = Infinity;
    y.painters.forEach((c, p) => {
      if ((y.teamOf[p] ?? -1) >= 0) near = Math.min(near, Math.abs(c.x - x));
    });
    const score = Math.min(near, 4) + y.rng() * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
  }
  if (best === y.dog.x) best = y.dog.x > 0 ? -y.dog.x * 0.5 - 2 : -y.dog.x * 0.5 + 2;
  return clamp(best, -FENCE.dog.range, FENCE.dog.range);
}

function stepDog(y: Yard, h: number, ev: YardEvents): void {
  const d = y.dog;
  d.t += h;
  switch (d.state) {
    case 'nap': {
      if (d.t < FENCE.dog.calm) return;
      const by = y.painters.findIndex(
        (c, p) => (y.teamOf[p] ?? -1) >= 0 && Math.hypot(c.vx, c.vz) > 0.4 && toDog(d, c.x, c.z).dist < FENCE.dog.r + FENCE.bodyR + FENCE.dog.wake,
      );
      if (by >= 0) {
        d.state = 'stretch';
        d.t = 0;
        ev.woke.push(by);
      }
      return;
    }
    case 'stretch':
      if (d.t >= FENCE.dog.stretch) {
        d.state = 'walk';
        d.t = 0;
        d.tx = dogSpot(y);
      }
      return;
    case 'walk': {
      const dx = d.tx - d.x;
      const step = FENCE.dog.speed * h;
      // It strolls a little way out on the lawn, and back in to lie down.
      const along = Math.abs(dx);
      d.z = FENCE.z + FENCE.dog.dz + Math.min(0.7, along * 0.5, d.t * 1.5);
      if (along <= step) {
        d.x = d.tx;
        d.z = FENCE.z + FENCE.dog.dz;
        d.state = 'nap';
        d.t = 0;
        d.moves += 1;
        ev.settled = true;
      } else d.x += Math.sign(dx) * step;
      return;
    }
  }
}

function subStep(y: Yard, inputs: readonly Stick[], h: number, ev: YardEvents): void {
  y.time += h;
  const follow = Math.min(1, FENCE.response * h);
  y.painters.forEach((c, p) => {
    if ((y.teamOf[p] ?? -1) < 0) return;
    const input = inputs[p] ?? IDLE;
    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    if (len < FENCE.deadzone) {
      ix = 0;
      iy = 0;
    }
    // A brush on a board slows you to a stroll.
    const speed = c.painting >= 0 ? FENCE.brush : FENCE.speed;
    c.vx += (ix * speed - c.vx) * follow;
    c.vz += (-iy * speed - c.vz) * follow;
    const v = Math.hypot(c.vx, c.vz);
    if (c.painting >= 0 && v > FENCE.brush) {
      c.vx *= FENCE.brush / v;
      c.vz *= FENCE.brush / v;
    }
    c.x += c.vx * h;
    c.z += c.vz * h;
  });
  separate(y);
  stepDog(y, h, ev);

  // Brushes on boards, and filling up at the buckets.
  y.painters.forEach((c, p) => {
    const team = y.teamOf[p] ?? -1;
    if (team < 0) return;
    const i = brushOn(y, p);
    c.painting = i;
    const b = y.boards[i];
    if (b) {
      b.wet[team === 0 ? 0 : 1] += h / FENCE.coat;
      c.paint = Math.max(0, c.paint - h / (FENCE.coat * (FENCE.tank + 0.02))); // (a hair extra, so rounding never cuts the last board short)
      if (c.paint <= 0) ev.dry.push(p);
      if (b.wet[team === 0 ? 0 : 1] >= 1) {
        const from = b.team;
        b.team = team;
        b.wet = [0, 0];
        b.by = p;
        c.boards += 1;
        ev.painted.push({ board: i, p, team, from });
      }
    }
    if (c.paint < 1 && bucketsOf(team).some((k) => Math.hypot(k.x - c.x, k.z - c.z) < FENCE.bucketR)) {
      c.paint = Math.min(1, c.paint + h / FENCE.fill);
      if (c.paint >= 1) ev.filled.push(p);
    }
  });
}

/** Advances the yard by dt seconds (in small sub-steps) with one stick per seat position. */
export function stepYard(y: Yard, inputs: readonly Stick[], dt: number): YardEvents {
  const ev: YardEvents = { painted: [], filled: [], dry: [], woke: [], settled: false };
  let left = Math.min(dt, FENCE.duration - y.time);
  while (left > 1e-9) {
    const h = Math.min(FENCE.step, left);
    subStep(y, inputs, h, ev);
    left -= h;
  }
  if (FENCE.duration - y.time < 1e-6) y.time = Math.max(y.time, FENCE.duration);
  return ev;
}

/** Scores per seat: both partners get their team's boards. `teams` holds seat positions. */
export function fenceScores(y: Yard, teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.slice(0, 2).forEach((members, team) => {
    const n = boardsOf(y, team);
    for (const m of members) if (m >= 0 && m < seats) scores[m] = n;
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

export interface CpuPainter {
  mode: 'paint' | 'fill';
  /** The board it's heading for, and which way it paints from there. */
  board: number;
  dir: number;
  rethink: number;
  /** Fills up to this much before heading back. */
  leaveAt: number;
  /** Notices the brush is dry at this time. */
  noticeAt: number;
  /** Seconds left admiring the clouds. */
  daydream: number;
  lastX: number;
  stuckFor: number;
}

export function newCpuPainter(): CpuPainter {
  return { mode: 'paint', board: -1, dir: 1, rethink: 0, leaveAt: 1, noticeAt: Infinity, daydream: 0, lastX: 0, stuckFor: 0 };
}

/** The stick a computer painter pushes this step. skill: 0 sleepy … 1 sharp. */
export function cpuStick(c: CpuPainter, y: Yard, p: number, dt: number, skill: number, rng: Rng): Stick {
  const me = y.painters[p];
  const team = y.teamOf[p] ?? -1;
  if (!me || team < 0) return IDLE;
  const s = clamp(skill, 0, 1);
  const t = y.time;
  const pace = 0.62 + 0.38 * s;
  const go = (x: number, z: number, k = pace): Stick => {
    const dx = x - me.x;
    const dz = z - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return IDLE;
    const m = Math.min(1, d * 2.5) * k;
    return { x: (dx / d) * m, y: -(dz / d) * m };
  };

  if (c.daydream > 0) {
    c.daydream -= dt;
    return IDLE;
  }
  if (rng() < (0.03 + (1 - s) * 0.14) * dt) c.daydream = 0.3 + rng() * (0.3 + (1 - s) * 0.9);

  // Out of paint: noticed straight away by a sharp painter, a little later by a sleepy one.
  if (c.mode === 'paint' && me.paint <= 0.001) {
    if (c.noticeAt === Infinity) c.noticeAt = t + (1 - s) * (0.2 + rng() * 0.8);
    if (t >= c.noticeAt) {
      c.mode = 'fill';
      c.noticeAt = Infinity;
      c.leaveAt = s > 0.6 ? 0.99 : 0.55 + rng() * 0.44;
    }
  }
  // A sharp painter tops up on the way past a bucket.
  if (c.mode === 'paint' && s > 0.5 && me.paint < 0.35 && bucketsOf(team).some((k) => Math.hypot(k.x - me.x, k.z - me.z) < 1.6)) {
    c.mode = 'fill';
    c.leaveAt = 0.99;
  }
  if (c.mode === 'fill') {
    const buckets = bucketsOf(team);
    let k = buckets[0] ?? { x: 0, z: FENCE.bucketZ };
    for (const b of buckets) if (Math.hypot(b.x - me.x, b.z - me.z) < Math.hypot(k.x - me.x, k.z - me.z)) k = b;
    if (me.paint >= c.leaveAt) {
      c.mode = 'paint';
      c.rethink = 0;
    } else {
      // Stand just on the fence side of the bucket.
      return go(k.x, k.z - 0.45, 1);
    }
  }

  // Which board to work from: bare or theirs (theirs is worth two), near, a long run of them, and not where the
  // partner is busy.
  const mine = (i: number) => y.boards[i]?.team === team || blocked(y, i);
  const partner = y.painters.find((_, q) => q !== p && y.teamOf[q] === team);
  const moved = Math.abs(me.x - c.lastX);
  c.lastX = me.x;
  c.stuckFor = moved < 0.2 * dt ? c.stuckFor + dt : 0;
  const target = c.board >= 0 ? c.board : -1;
  const done = target < 0 || (mine(target) && mine(target + c.dir) && mine(target + 2 * c.dir));
  if (t >= c.rethink || done || c.stuckFor > 0.6) {
    c.stuckFor = 0;
    let best = -Infinity;
    for (let i = 0; i < FENCE.boards; i++) {
      if (mine(i)) continue;
      const bx = boardX(i);
      const theirs = y.boards[i]?.team === 1 - team;
      let run = 0;
      let dir = 1;
      for (const d of [-1, 1]) {
        let n = 0;
        for (let k = 1; k <= 6; k++) {
          const j = i + d * k;
          if (j < 0 || j >= FENCE.boards || mine(j)) break;
          n++;
        }
        if (n > run) {
          run = n;
          dir = d;
        }
      }
      const crowd = partner ? Math.max(0, 2.2 - Math.abs(partner.x - bx)) : 0;
      const score = (theirs ? 1 + 0.6 * s : 1) + run * 0.12 * s - Math.abs(bx - me.x) * 0.22 - crowd * 0.5 * s + rng() * (0.15 + (1 - s) * 0.9);
      if (score > best) {
        best = score;
        c.board = i;
        c.dir = dir;
      }
    }
    c.rethink = t + 1.2 + rng() * (1 + (1 - s));
    if (best === -Infinity) {
      // The whole fence is ours: stand by and keep an eye on it.
      c.board = -1;
      return go(clamp(me.x, -FENCE_HALF + 1, FENCE_HALF - 1), FENCE.z + FENCE.near + 0.3, 0.5);
    }
  }
  if (c.board < 0) return IDLE;
  const bx = boardX(c.board);
  const lane = FENCE.z + FENCE.near + 0.15;
  // Get to the board, then stroll along the fence in the chosen direction.
  if (Math.abs(me.x - bx) > 0.35 && !(me.z - FENCE.z <= FENCE.reach && Math.sign(bx - me.x) === c.dir)) return go(bx, lane, 1);
  if (me.z - lane > 0.15) return go(me.x + c.dir * 0.3, lane, 1);
  if (mine(c.board)) c.board = clamp(c.board + c.dir, 0, FENCE.boards - 1);
  return { x: c.dir * pace, y: 0.25 };
}
