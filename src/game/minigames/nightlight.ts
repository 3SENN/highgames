// Night Light: a friend sleeps in a bed in the middle of a dark bedroom while fuzzy, harmless dust bunnies creep
// in from the dark corners toward the bed. Every phone is a torch: hold Shine with your beam on a dust bunny and it
// freezes, squeaks and scurries back to its corner (two beams do it twice as fast). Light doesn't reach into the
// corners themselves, and a dust bunny that was sent home peeks out again a little later. One that reaches the bed
// tickles the friend, who stirs: a heart is lost, and after three the friend wakes up. More dust bunnies come out as
// the night goes on; keep the friend asleep for 40 seconds.
import { type Rng, shuffle } from '../rng';

export const NIGHT = {
  duration: 40, // seconds
  hearts: 3,
  halfW: 8, // the floor: x from -halfW to halfW…
  halfD: 4.8, // …and z from -halfD (the far wall) to halfD (the front)
  bedW: 1.5, // half the bed's width (x)…
  bedD: 2.1, // …and half its length (z), centred on the middle of the room
  reach: 0.2, // a dust bunny this close to the bed tickles the friend
  radius: 0.32, // a dust bunny's size
  beam: 1.1, // radius of a torch's pool of light
  scare: 0.6, // seconds in the light that send a dust bunny home
  fade: 1.0, // how fast that wears off out of the light (seconds per second)
  dark: 1.2, // light doesn't reach this close to a corner
  flee: 6.5, // how fast a scared dust bunny scurries home
  rest: [3, 5.5] as const, // seconds a dust bunny hides at home before it peeks out again…
  bolder: 1.12, // …a little quicker each time
  speedFrom: 0.75, // creeping speed at the start…
  speedTo: 1.4, // …and at the end of the night
  gapFrom: 2.4, // seconds between new dust bunnies at the start (four torches)…
  gapTo: 1.0, // …and at the end
  first: 1.0, // the first one peeks out
  last: 36, // no new ones after this
  aimX: 9, // floor units for a full aim to the side…
  aimZ: 5.6, // …and up or down
  wokeBonus: 0.2, // hearts left count for this much of the result
} as const;

/** The dark corners the dust bunnies live in: the four corners of the room, and under the furniture on each side. */
export const CORNERS: readonly { x: number; z: number }[] = [
  { x: -7.4, z: -4.3 },
  { x: 7.4, z: -4.3 },
  { x: -7.4, z: 4.3 },
  { x: 7.4, z: 4.3 },
  { x: -7.6, z: 0 },
  { x: 7.6, z: 0 },
];

/** Creeping toward the bed, scurrying home after a fright, or hiding at home until it dares come out again. */
export type BunnyState = 'creep' | 'flee' | 'hide';

export interface Bunny {
  id: number;
  corner: number;
  /** Where it goes home to. */
  hx: number;
  hz: number;
  x: number;
  z: number;
  state: BunnyState;
  /** Seconds of light it has had (scared at NIGHT.scare). */
  light: number;
  /** Lit this step (frozen and trembling). */
  lit: boolean;
  /** Seconds left hiding at home. */
  rest: number;
  speed: number;
  /** A little weave in its path, different for each one. */
  phase: number;
  size: number;
}

export interface Spawn {
  at: number;
  corner: number;
  speed: number;
  size: number;
  phase: number;
}

export interface Beam {
  x: number;
  z: number;
  on: boolean;
}

export interface Night {
  players: number;
  time: number;
  hearts: number;
  /** When the friend woke up, or null. */
  wokeAt: number | null;
  bunnies: Bunny[];
  plan: Spawn[];
  next: number;
  nextId: number;
  /** Dust bunnies each seat sent home, and the group's tickles. */
  shooed: number[];
  tickles: number;
}

export interface NightStep {
  spawned: Bunny[];
  /** Dust bunnies that got scared this step, and who had a beam on them. */
  scared: { bunny: Bunny; by: number[] }[];
  /** Dust bunnies that reached the bed (and were taken off the floor). */
  tickled: Bunny[];
  /** Dust bunnies back home (hiding for a while). */
  home: Bunny[];
  /** Dust bunnies peeking out again. */
  back: Bunny[];
  woke: boolean;
}

/** How many dust bunnies a group can handle (1 for four torches): fewer torches, fewer and shyer dust bunnies. */
export function crowd(players: number): number {
  return (Math.min(4, Math.max(1, players)) + 0.8) / 4.8;
}

/** The night's new dust bunnies: from every corner in turn, closer together and quicker as it goes on. */
export function planNight(rng: Rng, players: number): Spawn[] {
  const out: Spawn[] = [];
  let bag: number[] = [];
  let at: number = NIGHT.first;
  while (at <= NIGHT.last) {
    if (bag.length === 0) bag = shuffle(rng, CORNERS.map((_, i) => i));
    const k = at / NIGHT.duration;
    out.push({
      at,
      corner: bag.pop() as number,
      speed: (NIGHT.speedFrom + (NIGHT.speedTo - NIGHT.speedFrom) * k) * (0.9 + rng() * 0.2),
      size: 0.85 + rng() * 0.3,
      phase: rng() * Math.PI * 2,
    });
    at += ((NIGHT.gapFrom + (NIGHT.gapTo - NIGHT.gapFrom) * k) / crowd(players)) * (0.75 + rng() * 0.5);
  }
  return out;
}

export function newNight(rng: Rng, players: number): Night {
  const n = Math.max(1, players);
  return {
    players: n,
    time: 0,
    hearts: NIGHT.hearts,
    wokeAt: null,
    bunnies: [],
    plan: planNight(rng, n),
    next: 0,
    nextId: 1,
    shooed: Array.from({ length: n }, () => 0),
    tickles: 0,
  };
}

/** Where a phone's aim (-1..1, y up) lands on the floor. */
export function aimToFloor(x: number, y: number): { x: number; z: number } {
  return {
    x: Math.max(-NIGHT.halfW, Math.min(NIGHT.halfW, x * NIGHT.aimX)),
    z: Math.max(-NIGHT.halfD, Math.min(NIGHT.halfD, 0 - y * NIGHT.aimZ)),
  };
}

/** The closest point of the bed to (x, z), and how far that is. */
export function toBed(x: number, z: number): { x: number; z: number; d: number } {
  const bx = Math.max(-NIGHT.bedW, Math.min(NIGHT.bedW, x));
  const bz = Math.max(-NIGHT.bedD, Math.min(NIGHT.bedD, z));
  return { x: bx, z: bz, d: Math.hypot(x - bx, z - bz) };
}

/** Still in the dark of its corner, where no torch reaches. */
export function inDark(bunny: { x: number; z: number; hx: number; hz: number }): boolean {
  return Math.hypot(bunny.x - bunny.hx, bunny.z - bunny.hz) < NIGHT.dark;
}

/** Whether a beam lights a dust bunny. */
export function inBeam(b: Beam, bunny: Bunny): boolean {
  return b.on && bunny.state === 'creep' && !inDark(bunny) && Math.hypot(b.x - bunny.x, b.z - bunny.z) <= NIGHT.beam + NIGHT.radius * bunny.size * 0.6;
}

export function isOver(n: Night): boolean {
  return n.wokeAt !== null || n.time >= NIGHT.duration;
}

/** One step: dust bunnies come out, creep, freeze in the light, scurry home or reach the bed. */
export function stepNight(n: Night, dt: number, beams: readonly Beam[], rng: Rng): NightStep {
  const out: NightStep = { spawned: [], scared: [], tickled: [], home: [], back: [], woke: false };
  if (isOver(n)) return out;
  n.time = Math.min(NIGHT.duration, n.time + dt);
  while (n.next < n.plan.length && (n.plan[n.next] as Spawn).at <= n.time) {
    const s = n.plan[n.next++] as Spawn;
    const c = CORNERS[s.corner] as { x: number; z: number };
    const bunny: Bunny = { id: n.nextId++, corner: s.corner, hx: c.x, hz: c.z, x: c.x, z: c.z, state: 'creep', light: 0, lit: false, rest: 0, speed: s.speed, phase: s.phase, size: s.size };
    n.bunnies.push(bunny);
    out.spawned.push(bunny);
  }
  const gone = new Set<Bunny>();
  for (const b of n.bunnies) {
    if (b.state === 'hide') {
      b.rest -= dt;
      if (b.rest <= 0 && n.time <= NIGHT.last) {
        b.state = 'creep';
        b.light = 0;
        b.speed *= NIGHT.bolder;
        out.back.push(b);
      }
      continue;
    }
    if (b.state === 'flee') {
      const dx = b.hx - b.x;
      const dz = b.hz - b.z;
      const d = Math.hypot(dx, dz);
      const move = NIGHT.flee * dt;
      if (d <= move + 0.05) {
        b.x = b.hx;
        b.z = b.hz;
        b.state = 'hide';
        b.rest = (NIGHT.rest[0] + rng() * (NIGHT.rest[1] - NIGHT.rest[0])) / crowd(n.players);
        out.home.push(b);
      } else {
        b.x += (dx / d) * move;
        b.z += (dz / d) * move;
      }
      continue;
    }
    const by: number[] = [];
    beams.forEach((beam, i) => {
      if (inBeam(beam, b)) by.push(i);
    });
    b.lit = by.length > 0;
    if (b.lit) {
      // Frozen in the light; two torches scare it twice as fast.
      b.light += dt * Math.min(2, by.length);
      if (b.light >= NIGHT.scare) {
        b.state = 'flee';
        b.lit = false;
        for (const i of by) n.shooed[i] = (n.shooed[i] ?? 0) + 1;
        out.scared.push({ bunny: b, by });
      }
      continue;
    }
    b.light = Math.max(0, b.light - NIGHT.fade * dt);
    const t = toBed(b.x, b.z);
    if (t.d <= NIGHT.reach) {
      gone.add(b);
      out.tickled.push(b);
      n.tickles += 1;
      if (n.hearts > 0) n.hearts -= 1;
      if (n.hearts === 0 && n.wokeAt === null) {
        n.wokeAt = n.time;
        out.woke = true;
      }
      continue;
    }
    // Creep toward the bed, weaving a little from side to side.
    const dx = (t.x - b.x) / Math.max(1e-6, t.d);
    const dz = (t.z - b.z) / Math.max(1e-6, t.d);
    const weave = Math.sin(n.time * 2.1 + b.phase) * 0.45;
    const step = Math.min(t.d - NIGHT.reach * 0.5, b.speed * dt);
    b.x += (dx - dz * weave) * step;
    b.z += (dz + dx * weave) * step;
    b.x = Math.max(-NIGHT.halfW, Math.min(NIGHT.halfW, b.x));
    b.z = Math.max(-NIGHT.halfD, Math.min(NIGHT.halfD, b.z));
  }
  if (gone.size) n.bunnies = n.bunnies.filter((b) => !gone.has(b));
  return out;
}

/** Seconds the friend slept through. */
export function slept(n: Night): number {
  return n.wokeAt ?? Math.min(n.time, NIGHT.duration);
}

/** Time asleep over the whole night, with the hearts left as a bonus. */
export function nightCoop(n: Night): number {
  const asleep = slept(n) / NIGHT.duration;
  return Math.max(0, Math.min(1, asleep * (1 - NIGHT.wokeBonus) + (NIGHT.wokeBonus * n.hearts) / NIGHT.hearts));
}

// ------------------------------------------------------------------ computer players

export interface TorchCpu {
  x: number;
  z: number;
  target: number | null;
  /** Seconds until it looks round for a new target. */
  think: number;
  /** Seconds before it reacts to a new target. */
  wait: number;
  /** Zoned out for this long. */
  nap: number;
  /** Where it aims, a little off the target. */
  ox: number;
  oz: number;
}

export function newTorchCpu(seat: number, players: number): TorchCpu {
  const x = players <= 1 ? 0 : (seat / (players - 1) - 0.5) * 6;
  return { x, z: NIGHT.bedD + 1, target: null, think: 0, wait: 0, nap: 0, ox: 0, oz: 0 };
}

/** How soon a dust bunny reaches the bed (seconds), if left alone. */
function threat(b: Bunny): number {
  return toBed(b.x, b.z).d / Math.max(0.1, b.speed);
}

/**
 * A computer player's torch: picks the most urgent dust bunny (one nobody else is on, if it can), sweeps the beam
 * over to it and holds Shine once it's there. Sleepier ones are slower, aim worse, pick less well and zone out now
 * and then. `taken` holds the dust bunnies other torches are already on.
 */
export function cpuTorch(c: TorchCpu, night: Night, skill: number, rng: Rng, dt: number, taken: ReadonlySet<number>): Beam {
  c.nap = Math.max(0, c.nap - dt);
  if (c.nap <= 0 && rng() < dt * (0.02 + (1 - skill) * 0.1)) c.nap = 0.5 + rng() * (0.6 + (1 - skill) * 1.2);
  if (c.nap > 0) return { x: c.x, z: c.z, on: false };
  const creeping = night.bunnies.filter((b) => b.state === 'creep' && !inDark(b));
  let target = creeping.find((b) => b.id === c.target);
  c.think -= dt;
  if (!target || c.think <= 0) {
    c.think = 0.25 + (1 - skill) * 0.5 + rng() * 0.25;
    const free = creeping.filter((b) => !taken.has(b.id) || b.id === c.target);
    const pool = free.length ? free : creeping;
    let pick: Bunny | undefined;
    if (pool.length && rng() < (1 - skill) * 0.35) pick = pool[Math.floor(rng() * pool.length)];
    else pick = pool.reduce<Bunny | undefined>((best, b) => (!best || threat(b) < threat(best) ? b : best), undefined);
    if (pick && pick.id !== c.target) {
      const miss = 0.15 + (1 - skill) * 0.6;
      c.ox = (rng() * 2 - 1) * miss;
      c.oz = (rng() * 2 - 1) * miss;
      c.wait = 0.15 + (1 - skill) * 0.45 + rng() * 0.2;
    }
    target = pick;
    c.target = pick ? pick.id : null;
  }
  if (!target) return { x: c.x, z: c.z, on: false };
  c.wait -= dt;
  if (c.wait > 0) return { x: c.x, z: c.z, on: false };
  const tx = target.x + c.ox;
  const tz = target.z + c.oz;
  const dx = tx - c.x;
  const dz = tz - c.z;
  const d = Math.hypot(dx, dz);
  const move = (4 + skill * 7) * dt;
  if (d <= move) {
    c.x = tx;
    c.z = tz;
  } else {
    c.x += (dx / d) * move;
    c.z += (dz / d) * move;
  }
  const on = Math.hypot(target.x - c.x, target.z - c.z) < NIGHT.beam * 1.3;
  return { x: c.x, z: c.z, on };
}
