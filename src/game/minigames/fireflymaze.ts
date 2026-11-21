// Firefly Maze: a hedge maze at night. Everyone starts in a corner with a lantern; fireflies blink about the
// maze, and walking close to one makes it follow you in a little trail. The way out is in the middle: reaching
// it banks your fireflies (+3 for whoever is out first) and you're done. Bumping into someone makes one of
// your fireflies switch over to them. After 40 s, fireflies still following you count half.
//
// The maze is a grid of cells on the ground (x/z plane, +z toward the TV audience; a stick's y runs toward -z).
// It's generated with four-fold turning symmetry, a pinwheel of four identical quarters round the middle cell, so
// every corner has exactly the same way in. Each quarter is a random spanning tree (so everything is reachable)
// hung off the middle, plus a few extra gaps for loops and short cuts into the neighbouring quarters.
import type { Rng } from '../rng.js';

export const MAZE = {
  size: 9, // cells a side (odd: the way out is the middle cell)
  cell: 1.5, // width of a cell
  wall: 0.3, // hedge thickness
  duration: 40, // seconds
  bodyR: 0.28,
  speed: 3.2, // units a second at full stick
  response: 12,
  deadzone: 0.15,
  perQuarter: 4, // fireflies in each quarter of the maze at the start
  spawn: [3, 33, 2] as const, // more blink in from, until, every (seconds), round the quarters in turn
  catchR: 0.7, // walk this close to a firefly and it follows you
  exitR: 0.55, // this close to the middle and you're out
  firstBonus: 3,
  following: 0.5, // what a firefly still following you at the end is worth
  loops: 3, // extra gaps inside each quarter (loops)
  bridges: 2, // extra gaps between neighbouring quarters
  minWayIn: 10, // the fewest steps from a corner to the middle
  bumpSpeed: 1.2, // walking into someone at least this fast is a bump
  bumpGap: 1.0, // seconds before the same two can bump again
  knock: 3, // the bumper bounces back at this speed
  friction: 12,
} as const;

const S = MAZE.size;
const MID = (S - 1) / 2;

export interface Maze {
  /** open[y*S + x]: is the gap to the cell on the right (x+1) open. */
  right: boolean[];
  /** open[y*S + x]: is the gap to the cell below (y+1, toward the audience) open. */
  down: boolean[];
}

export const cellOf = (x: number, y: number): number => y * S + x;
export const cellX = (c: number): number => c % S;
export const cellY = (c: number): number => Math.floor(c / S);
export const CENTRE = cellOf(MID, MID);

/** The four corners, in the order seats start there (opposite corners first for two players). */
export const CORNERS = [cellOf(0, 0), cellOf(S - 1, S - 1), cellOf(S - 1, 0), cellOf(0, S - 1)] as const;

/** Where each of `players` starts. */
export function startCells(players: number): number[] {
  return Array.from({ length: players }, (_, i) => CORNERS[i % CORNERS.length] as number);
}

/** A quarter turn round the middle cell. */
function turn(x: number, y: number): [number, number] {
  return [S - 1 - y, x];
}

/** The first quarter: x 0..MID, y 0..MID-1. Its turns tile the rest of the grid round the middle. */
function inQuarter(x: number, y: number): boolean {
  return x >= 0 && x <= MID && y >= 0 && y < MID;
}

/** Which quarter a cell is in (0..3), or -1 for the middle. */
export function quarterOf(c: number): number {
  let x = cellX(c);
  let y = cellY(c);
  if (c === CENTRE) return -1;
  for (let q = 0; q < 4; q++) {
    if (inQuarter(x, y)) return q;
    // Turn back: the inverse of a quarter turn.
    [x, y] = [y, S - 1 - x];
  }
  return -1;
}

export function isOpen(m: Maze, a: number, b: number): boolean {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  if (hi - lo === 1 && cellY(lo) === cellY(hi)) return m.right[lo] === true;
  if (hi - lo === S) return m.down[lo] === true;
  return false;
}

function setOpen(m: Maze, a: number, b: number, open = true): void {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  if (hi - lo === 1 && cellY(lo) === cellY(hi)) m.right[lo] = open;
  else if (hi - lo === S) m.down[lo] = open;
}

/** Opens (or closes) a gap and its three turned copies. */
function openAll(m: Maze, x1: number, y1: number, x2: number, y2: number, open = true): void {
  let a: [number, number] = [x1, y1];
  let b: [number, number] = [x2, y2];
  for (let k = 0; k < 4; k++) {
    setOpen(m, cellOf(a[0], a[1]), cellOf(b[0], b[1]), open);
    a = turn(a[0], a[1]);
    b = turn(b[0], b[1]);
  }
}

const STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Steps from a corner to the middle. */
const wayIn = (m: Maze): number => distances(m, CORNERS[0])[CENTRE] as number;

/** The quarter's hedges as a random spanning tree grown from the cell next to the middle (a perfect maze). */
function growTree(rng: Rng): Maze {
  const m: Maze = { right: Array.from({ length: S * S }, () => false), down: Array.from({ length: S * S }, () => false) };
  const root: [number, number] = [MID, MID - 1];
  const seen = new Set<number>([cellOf(root[0], root[1])]);
  const stack: [number, number][] = [root];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1] as [number, number];
    const next = STEPS.map(([dx, dy]) => [x + dx, y + dy] as [number, number]).filter(([nx, ny]) => inQuarter(nx, ny) && !seen.has(cellOf(nx, ny)));
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny] = next[Math.floor(rng() * next.length)] as [number, number];
    openAll(m, x, y, nx, ny);
    seen.add(cellOf(nx, ny));
    stack.push([nx, ny]);
  }
  openAll(m, root[0], root[1], MID, MID);
  return m;
}

/** Opens up to `count` gaps (and their turned copies) from `pool`, skipping any that make the way in shorter than `floor`. */
function addGaps(m: Maze, rng: Rng, pool: [number, number, number, number][], count: number, floor: number): number {
  let added = 0;
  while (added < count && pool.length) {
    const gap = pool.splice(Math.floor(rng() * pool.length), 1)[0] as [number, number, number, number];
    openAll(m, ...gap);
    if (wayIn(m) >= floor) added++;
    else openAll(m, ...gap, false);
  }
  return added;
}

export function makeMaze(rng: Rng): Maze {
  const bridges = (): [number, number, number, number][] => Array.from({ length: MID }, (_, y) => [MID, y, MID + 1, y]);
  let fallback: { m: Maze; steps: number } | null = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const m = growTree(rng);
    const steps = wayIn(m);
    if (!fallback || steps > fallback.steps) fallback = { m, steps };
    if (steps < MAZE.minWayIn) continue;
    // Short cuts into the next quarter (along the quarter's right-hand side); a maze needs at least one.
    if (addGaps(m, rng, bridges(), MAZE.bridges, MAZE.minWayIn) === 0) continue;
    // A few loops inside the quarter.
    const inner: [number, number, number, number][] = [];
    for (let y = 0; y < MID; y++) {
      for (let x = 0; x <= MID; x++) {
        if (inQuarter(x + 1, y) && !isOpen(m, cellOf(x, y), cellOf(x + 1, y))) inner.push([x, y, x + 1, y]);
        if (inQuarter(x, y + 1) && !isOpen(m, cellOf(x, y), cellOf(x, y + 1))) inner.push([x, y, x, y + 1]);
      }
    }
    addGaps(m, rng, inner, MAZE.loops, MAZE.minWayIn);
    return m;
  }
  // Practically never: the longest tree, with one short cut whatever it does to the way in.
  const m = (fallback as { m: Maze }).m;
  addGaps(m, rng, bridges(), 1, 0);
  return m;
}

export function neighbours(m: Maze, c: number): number[] {
  const x = cellX(c);
  const y = cellY(c);
  const out: number[] = [];
  for (const [dx, dy] of STEPS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
    const n = cellOf(nx, ny);
    if (isOpen(m, c, n)) out.push(n);
  }
  return out;
}

/** Steps from `from` to every cell (Infinity where it can't be reached). */
export function distances(m: Maze, from: number): number[] {
  const d = Array.from({ length: S * S }, () => Infinity);
  d[from] = 0;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i] as number;
    for (const n of neighbours(m, c)) {
      if (d[n] !== Infinity) continue;
      d[n] = (d[c] as number) + 1;
      queue.push(n);
    }
  }
  return d;
}

/** The cells from `from` to `to`, both included (empty if there's no way). */
export function pathBetween(m: Maze, from: number, to: number): number[] {
  const d = distances(m, to);
  if (d[from] === Infinity) return [];
  const path = [from];
  let c = from;
  while (c !== to) {
    const next = neighbours(m, c).find((n) => (d[n] as number) === (d[c] as number) - 1);
    if (next === undefined) break;
    path.push(next);
    c = next;
  }
  return path;
}

export function cellCentre(c: number): { x: number; z: number } {
  return { x: (cellX(c) - MID) * MAZE.cell, z: (cellY(c) - MID) * MAZE.cell };
}

export function cellAt(x: number, z: number): number {
  const cx = Math.min(S - 1, Math.max(0, Math.round(x / MAZE.cell + MID)));
  const cy = Math.min(S - 1, Math.max(0, Math.round(z / MAZE.cell + MID)));
  return cellOf(cx, cy);
}

/** A hedge as a box on the ground: centre and half sizes. */
export interface Hedge {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

/** Every hedge: the closed gaps between cells and the outer border. Each runs over the joints at its ends. */
export function hedges(m: Maze): Hedge[] {
  const C = MAZE.cell;
  const t = MAZE.wall / 2;
  const out: Hedge[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = cellOf(x, y);
      const { x: px, z: pz } = cellCentre(c);
      if (x < S - 1 && !m.right[c]) out.push({ x: px + C / 2, z: pz, hx: t, hz: C / 2 + t });
      if (y < S - 1 && !m.down[c]) out.push({ x: px, z: pz + C / 2, hx: C / 2 + t, hz: t });
    }
  }
  const half = (S / 2) * C;
  out.push({ x: 0, z: -half, hx: half + t, hz: t }, { x: 0, z: half, hx: half + t, hz: t }, { x: -half, z: 0, hx: t, hz: half + t }, { x: half, z: 0, hx: t, hz: half + t });
  return out;
}

// ------------------------------------------------------------------ the game

export interface Stick {
  x: number;
  y: number;
}

export interface Fly {
  /** When it blinks in (0: there from the start). */
  at: number;
  /** Where it hovers about while nobody has it. */
  hx: number;
  hz: number;
  cell: number;
  phase: number;
  owner: number | null;
  banked: boolean;
}

export interface Walker {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Bounce from a bump. */
  kx: number;
  kz: number;
  face: number;
  /** Fireflies following, nearest first. */
  trail: number[];
  banked: number;
  exitedAt: number | null;
  first: boolean;
}

export interface Garden {
  maze: Maze;
  hedges: Hedge[];
  walkers: Walker[];
  flies: Fly[];
  time: number;
  /** Seats in the order they got out. */
  order: number[];
  /** When each pair last bumped (index a*seats + b). */
  lastBump: number[];
}

export interface GardenEvents {
  caught: { seat: number; fly: number }[];
  /** One firefly from `from` to `to` (`fly` null: the bumper had none to give). */
  bumps: { from: number; to: number; fly: number | null }[];
  exited: { seat: number; banked: number; first: boolean }[];
}

/** Where a free firefly is at time t: drifting lazily round its spot. */
export function flyPos(f: Fly, t: number): { x: number; z: number } {
  return { x: f.hx + Math.cos(t * 0.9 + f.phase) * 0.22, z: f.hz + Math.sin(t * 1.3 + f.phase * 1.7) * 0.18 };
}

/**
 * Fireflies spread over the maze: the same number in every quarter, at different spots, none at the corners.
 * More blink in as the game goes on, a quarter at a time in turn, so staying in pays off too.
 */
export function placeFlies(rng: Rng): Fly[] {
  const byQuarter: number[][] = [[], [], [], []];
  for (let c = 0; c < S * S; c++) {
    const q = quarterOf(c);
    if (q >= 0 && !(CORNERS as readonly number[]).includes(c)) (byQuarter[q] as number[]).push(c);
  }
  const pools = byQuarter.map((cells) => [...cells]);
  const flies: Fly[] = [];
  const add = (q: number, at: number) => {
    let pool = pools[q] as number[];
    if (pool.length === 0) pool = pools[q] = [...(byQuarter[q] as number[])];
    const cell = pool.splice(Math.floor(rng() * pool.length), 1)[0] as number;
    const { x, z } = cellCentre(cell);
    const j = MAZE.cell * 0.22;
    flies.push({ at, hx: x + (rng() * 2 - 1) * j, hz: z + (rng() * 2 - 1) * j, cell, phase: rng() * Math.PI * 2, owner: null, banked: false });
  };
  for (let q = 0; q < 4; q++) for (let k = 0; k < MAZE.perQuarter; k++) add(q, 0);
  const [from, to, every] = MAZE.spawn;
  let q = Math.floor(rng() * 4);
  for (let t = from; t <= to + 1e-9; t += every) add(q++ % 4, t);
  return flies;
}

export function newGarden(rng: Rng, players: number): Garden {
  const maze = makeMaze(rng);
  const walkers = startCells(players).map((c) => {
    const { x, z } = cellCentre(c);
    return { x, z, vx: 0, vz: 0, kx: 0, kz: 0, face: 0, trail: [], banked: 0, exitedAt: null, first: false };
  });
  return { maze, hedges: hedges(maze), walkers, flies: placeFlies(rng), time: 0, order: [], lastBump: Array.from({ length: players * players }, () => -Infinity) };
}

export function gardenOver(g: Garden): boolean {
  return g.time >= MAZE.duration || g.walkers.every((w) => w.exitedAt !== null);
}

/** Pushes a body out of a hedge box. */
function collide(w: Walker, h: Hedge): void {
  const cx = Math.min(h.x + h.hx, Math.max(h.x - h.hx, w.x));
  const cz = Math.min(h.z + h.hz, Math.max(h.z - h.hz, w.z));
  const dx = w.x - cx;
  const dz = w.z - cz;
  const d = Math.hypot(dx, dz);
  const r = MAZE.bodyR;
  if (d >= r) return;
  if (d > 1e-6) {
    w.x = cx + (dx / d) * r;
    w.z = cz + (dz / d) * r;
    const nx = dx / d;
    const nz = dz / d;
    const into = w.kx * nx + w.kz * nz;
    if (into < 0) {
      w.kx -= into * nx;
      w.kz -= into * nz;
    }
    return;
  }
  // The centre is inside the hedge: out the shortest way.
  const px = h.hx - Math.abs(w.x - h.x) + r;
  const pz = h.hz - Math.abs(w.z - h.z) + r;
  if (px < pz) w.x += Math.sign(w.x - h.x || 1) * px;
  else w.z += Math.sign(w.z - h.z || 1) * pz;
}

const near = (h: Hedge, w: Walker) => Math.abs(w.x - h.x) < h.hx + MAZE.bodyR + 0.05 && Math.abs(w.z - h.z) < h.hz + MAZE.bodyR + 0.05;

export function stepGarden(g: Garden, sticks: readonly Stick[], dt: number): GardenEvents {
  const ev: GardenEvents = { caught: [], bumps: [], exited: [] };
  if (gardenOver(g)) return ev;
  g.time += dt;
  const active = g.walkers.map((w, i) => (w.exitedAt === null ? i : -1)).filter((i) => i >= 0);

  for (const i of active) {
    const w = g.walkers[i] as Walker;
    const s = sticks[i] ?? { x: 0, y: 0 };
    const mag = Math.hypot(s.x, s.y);
    const k = mag < MAZE.deadzone ? 0 : Math.min(1, mag) / mag;
    const follow = 1 - Math.exp(-MAZE.response * dt);
    w.vx += (s.x * k * MAZE.speed - w.vx) * follow;
    w.vz += (-s.y * k * MAZE.speed - w.vz) * follow;
    const kl = Math.hypot(w.kx, w.kz);
    if (kl > 0) {
      const left = Math.max(0, kl - MAZE.friction * dt);
      w.kx *= left / kl;
      w.kz *= left / kl;
    }
    w.x += (w.vx + w.kx) * dt;
    w.z += (w.vz + w.kz) * dt;
    if (Math.hypot(w.vx, w.vz) > 0.3) w.face = Math.atan2(w.vx, w.vz);
    for (const h of g.hedges) if (near(h, w)) collide(w, h);
  }

  // Bumps: whoever walks into the other gives them a firefly.
  const n = g.walkers.length;
  for (let a = 0; a < active.length; a++) {
    for (let b = a + 1; b < active.length; b++) {
      const ia = active[a] as number;
      const ib = active[b] as number;
      const p = g.walkers[ia] as Walker;
      const q = g.walkers[ib] as Walker;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = MAZE.bodyR * 2;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const overlap = min - d;
      p.x -= (nx * overlap) / 2;
      p.z -= (nz * overlap) / 2;
      q.x += (nx * overlap) / 2;
      q.z += (nz * overlap) / 2;
      const cp = Math.max(0, p.vx * nx + p.vz * nz);
      const cq = Math.max(0, -(q.vx * nx + q.vz * nz));
      const key = ia * n + ib;
      if (Math.max(cp, cq) < MAZE.bumpSpeed || Math.abs(cp - cq) < 0.5 || g.time - (g.lastBump[key] ?? -Infinity) < MAZE.bumpGap) continue;
      g.lastBump[key] = g.time;
      const [from, to, sign] = cp > cq ? [ia, ib, -1] : [ib, ia, 1];
      const giver = g.walkers[from] as Walker;
      const taker = g.walkers[to] as Walker;
      giver.kx = sign * nx * MAZE.knock;
      giver.kz = sign * nz * MAZE.knock;
      giver.vx = giver.vz = 0;
      const fly = giver.trail.pop() ?? null;
      if (fly !== null) {
        taker.trail.push(fly);
        (g.flies[fly] as Fly).owner = to;
      }
      ev.bumps.push({ from, to, fly });
    }
  }
  for (const i of active) {
    const w = g.walkers[i] as Walker;
    for (const h of g.hedges) if (near(h, w)) collide(w, h);
  }

  // Fireflies close by (and not through a hedge) start following.
  g.flies.forEach((f, fi) => {
    if (f.owner !== null || f.banked || f.at > g.time) return;
    const pos = flyPos(f, g.time);
    let best = -1;
    let bestD: number = MAZE.catchR;
    for (const i of active) {
      const w = g.walkers[i] as Walker;
      const d = Math.hypot(w.x - pos.x, w.z - pos.z);
      if (d >= bestD) continue;
      const c = cellAt(w.x, w.z);
      if (c !== f.cell && !isOpen(g.maze, c, f.cell)) continue;
      best = i;
      bestD = d;
    }
    if (best < 0) return;
    f.owner = best;
    (g.walkers[best] as Walker).trail.push(fi);
    ev.caught.push({ seat: best, fly: fi });
  });

  // The way out.
  for (const i of active) {
    const w = g.walkers[i] as Walker;
    if (Math.hypot(w.x, w.z) > MAZE.exitR) continue;
    w.exitedAt = g.time;
    w.first = g.order.length === 0;
    g.order.push(i);
    for (const fi of w.trail) (g.flies[fi] as Fly).banked = true;
    w.banked = w.trail.length;
    w.trail = [];
    w.vx = w.vz = w.kx = w.kz = 0;
    ev.exited.push({ seat: i, banked: w.banked, first: w.first });
  }
  return ev;
}

/** Banked fireflies, +3 for the first out, and half for each firefly still following at the end. */
export function mazeScores(g: Garden): number[] {
  return g.walkers.map((w) => w.banked + (w.first ? MAZE.firstBonus : 0) + w.trail.length * MAZE.following);
}

// ------------------------------------------------------------------ computer players

export interface Seeker {
  skill: number;
  path: number[];
  /** The firefly it's after (null: heading out, or wandering). */
  fly: number | null;
  out: boolean;
  rethinkAt: number;
  /** Seconds it allows to get out in time (sleepy ones cut it fine, or forget). */
  margin: number;
  /** How many fireflies it's happy to take out. */
  greed: number;
  /** When it means to head out anyway, if it has any fireflies. */
  leaveBy: number;
  /** Goes for the first-out bonus once it has a handful. */
  dasher: boolean;
  /** Seconds left dithering at a junction. */
  dither: number;
}

export function newSeeker(rng: Rng, skill: number): Seeker {
  const forgetful = rng() < (1 - skill) * 0.35;
  return {
    skill,
    path: [],
    fly: null,
    out: false,
    rethinkAt: 0,
    margin: forgetful ? -2 - rng() * 3 : 1.2 + skill * 1.6,
    greed: 8 + Math.round(skill * 6 + rng() * 4),
    leaveBy: 22 + rng() * 12,
    dasher: rng() < 0.3,
    dither: 0,
  };
}

/** How fast a computer player walks, as a share of full stick. */
export const seekerPace = (skill: number): number => 0.72 + 0.26 * skill;

function rethink(g: Garden, seat: number, s: Seeker, rng: Rng): void {
  const w = g.walkers[seat] as Walker;
  const here = cellAt(w.x, w.z);
  const fromHere = distances(g.maze, here);
  const outSteps = fromHere[CENTRE] as number;
  const secondsOut = (outSteps * MAZE.cell) / (MAZE.speed * seekerPace(s.skill)) + s.margin;
  const left = MAZE.duration - g.time;
  s.out = false;
  s.fly = null;
  const dash = s.dasher && g.order.length === 0 && w.trail.length >= 5 && g.time >= 14;
  if (left < secondsOut || dash || w.trail.length >= s.greed || (g.time >= s.leaveBy && w.trail.length > 0)) {
    s.out = true;
    s.path = pathBetween(g.maze, here, CENTRE);
    return;
  }
  // The nearest free firefly it has noticed (sharper ones notice further away).
  const sight = 3 + Math.round(s.skill * 7);
  let best = -1;
  let bestSteps = Infinity;
  g.flies.forEach((f, fi) => {
    if (f.owner !== null || f.banked || f.at > g.time) return;
    const steps = (fromHere[f.cell] as number) + rng() * (1 - s.skill) * 2;
    if (steps <= sight && steps < bestSteps) {
      best = fi;
      bestSteps = steps;
    }
  });
  if (best >= 0) {
    s.fly = best;
    s.path = pathBetween(g.maze, here, (g.flies[best] as Fly).cell);
    return;
  }
  if ((w.trail.length >= 2 && g.time > s.leaveBy - 8) || left < secondsOut + 4) {
    s.out = true;
    s.path = pathBetween(g.maze, here, CENTRE);
    return;
  }
  // Nothing in sight: wander toward somewhere further off.
  const far = fromHere.map((d, c) => (d >= 3 && d <= 8 && c !== CENTRE ? c : -1)).filter((c) => c >= 0);
  const goal = far.length ? (far[Math.floor(rng() * far.length)] as number) : CENTRE;
  s.path = pathBetween(g.maze, here, goal);
}

/** A computer player's stick: follows its path cell by cell, keeping to the middle of the hedge rows. */
export function cpuMaze(g: Garden, seat: number, s: Seeker, rng: Rng, dt: number): Stick {
  const w = g.walkers[seat];
  if (!w || w.exitedAt !== null) return { x: 0, y: 0 };
  if (s.dither > 0) {
    s.dither -= dt;
    return { x: 0, y: 0 };
  }
  const flyGone = s.fly !== null && (g.flies[s.fly] as Fly).owner !== null;
  if (g.time >= s.rethinkAt || flyGone || s.path.length === 0) {
    rethink(g, seat, s, rng);
    s.rethinkAt = g.time + 0.3 + (1 - s.skill) * 0.6 + rng() * 0.2;
    if (rng() < (1 - s.skill) * 0.12) s.dither = 0.3 + rng() * 0.7;
  }
  const here = cellAt(w.x, w.z);
  const at = s.path.indexOf(here);
  if (at < 0) {
    s.path = [];
    return { x: 0, y: 0 };
  }
  if (at > 0) s.path = s.path.slice(at);
  const pace = seekerPace(s.skill);
  const aim = (tx: number, tz: number): Stick => {
    const dx = tx - w.x;
    const dz = tz - w.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return { x: 0, y: 0 };
    const p = pace * Math.min(1, d / 0.3);
    return { x: (dx / d) * p, y: (-dz / d) * p };
  };
  const next = s.path[1];
  if (next === undefined) {
    // In the goal cell: straight for the firefly (or the middle).
    if (s.fly !== null) {
      const pos = flyPos(g.flies[s.fly] as Fly, g.time);
      return aim(pos.x, pos.z);
    }
    const c = cellCentre(here);
    return aim(c.x, c.z);
  }
  // Along the row: forward, while drifting back to the row's middle so corners don't snag.
  const c = cellCentre(here);
  const nc = cellCentre(next);
  const along = { x: Math.sign(nc.x - c.x), z: Math.sign(nc.z - c.z) };
  const fix = 2.5;
  const vx = along.x !== 0 ? along.x : Math.max(-1, Math.min(1, (c.x - w.x) * fix));
  const vz = along.z !== 0 ? along.z : Math.max(-1, Math.min(1, (c.z - w.z) * fix));
  const len = Math.hypot(vx, vz) || 1;
  return { x: (vx / len) * pace, y: (-vz / len) * pace };
}
