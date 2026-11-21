// Garden Party: a backyard garden at golden hour. The flowers slowly wilt (they droop, fade, and a little thirst
// meter drains above each one); everyone walks a watering can around the lawn and holds Water near a flower to perk
// it up. A flower that wilts all the way flops over and is lost. Bees drift from flower to flower and buzz off,
// annoyed, when they get splashed (no harm done). After 40 s the group scores the flowers still standing, weighted
// by how healthy they are. Fewer players look after fewer (and closer) flowers, so it stays fair.
//
// Everything happens on the lawn's x/z plane: +z points at the TV audience. A stick's y (up on the phone) walks
// away from the audience, toward -z.
import type { Rng } from '../rng';

export const GARDEN = {
  duration: 40, // seconds
  bounds: { x: 6.4, z: 3.3 }, // half-size of the lawn the players walk on
  bodyR: 0.34,
  bedR: 0.5, // a flower bed: players walk round it
  reach: 1.3, // player centre to flower centre for the can to reach it
  spout: 0.6, // the can's spout, in front of the player (where bees get splashed)
  speed: 4.4, // walking speed at full stick
  response: 10, // how quickly walking follows the stick
  deadzone: 0.15,
  water: 0.65, // health a second one can gives
  wilt: [0.09, 0.15] as const, // health lost a second at the start and at the end (times each flower's thirst)
  thirst: [0.85, 1.2] as const, // how thirsty each flower is
  start: [0.5, 1] as const, // starting health, spread over the flowers
  full: 0.97, // watered up to this, a flower springs back up
  perkFrom: 0.8, // …if it had sunk below this since the last time
  thirsty: 0.5, // below this a flower droops and its meter turns amber
  danger: 0.25, // below this its meter turns red
  bloom: 0.6, // at the end, a flower this healthy counts in full; a nearly wilted one still counts half
  beeSpeed: 1.1,
  beeFlee: 5.5, // how fast a splashed bee buzzes off
  beeAway: 3.2, // seconds it sulks before coming back
  splashR: 0.45, // how close to the spout a bee gets splashed
  beeOff: 0.5, // bees hover a little to the side of a flower
} as const;

/** Where the beds go, the middle ones first: fewer players look after fewer, closer flowers. */
export const SLOTS: readonly (readonly [number, number])[] = [
  [-1.6, -2.1],
  [1.6, 2.2],
  [1.6, -2.1],
  [-1.6, 2.2],
  [-3.4, 0.05],
  [3.4, 0.05],
  [-4.9, -2.1],
  [4.9, 2.2],
  [4.9, -2.1],
  [-4.9, 2.2],
];

/** Flowers for the group: two to two and a half each (a solo gardener gets three close ones). */
export function flowerCount(players: number): number {
  return [3, 6, 8, 10][Math.min(4, Math.max(1, players)) - 1] as number;
}

export function beeCount(players: number): number {
  return [1, 2, 2, 3][Math.min(4, Math.max(1, players)) - 1] as number;
}

export interface Stick {
  x: number;
  y: number;
  a: boolean;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

export interface Flower {
  x: number;
  z: number;
  /** Health: 1 fresh, 0 wilted (lost). */
  h: number;
  thirst: number;
  /** Which of the flower looks (the view picks a shape and colour from it). */
  kind: number;
  lost: boolean;
  lostAt: number | null;
  /** The lowest it sank since it last perked up. */
  low: number;
  /** Cans pouring on it this step. */
  cans: number;
}

export interface Gardener {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Heading in the x/z plane (0 faces +z, the audience). */
  face: number;
  pouring: boolean;
  /** The flower the can reaches while pouring (-1: none, the grass gets it). */
  target: number;
  /** Flowers perked up, of which saved from the brink, health given, bees splashed. */
  perks: number;
  saves: number;
  given: number;
  bees: number;
}

export interface Bee {
  x: number;
  z: number;
  /** The flower it is heading for or hovering at, and where beside it. */
  flower: number;
  ox: number;
  oz: number;
  hover: number;
  /** Seconds left buzzing off after a splash. */
  away: number;
  vx: number;
  vz: number;
}

export interface Garden {
  players: number;
  time: number;
  flowers: Flower[];
  gardeners: Gardener[];
  bees: Bee[];
}

export type GardenEvent =
  | { kind: 'perk'; flower: number; seats: number[]; save: boolean }
  | { kind: 'danger'; flower: number }
  | { kind: 'lost'; flower: number }
  | { kind: 'splash'; bee: number; seat: number };

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export function newGarden(rng: Rng, players: number): Garden {
  const n = Math.max(1, players);
  const count = flowerCount(n);
  // Starting health spread evenly (then shuffled), so the flowers don't all get thirsty at once.
  const healths = Array.from({ length: count }, (_, i) => GARDEN.start[0] + ((GARDEN.start[1] - GARDEN.start[0]) * (i + 0.5)) / count);
  for (let i = healths.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [healths[i], healths[j]] = [healths[j] as number, healths[i] as number];
  }
  const flowers: Flower[] = SLOTS.slice(0, count).map(([x, z], i) => {
    const h = Math.min(1, (healths[i] ?? 1) + (rng() - 0.5) * 0.06);
    return {
      x: x + (rng() - 0.5) * 0.5,
      z: z + (rng() - 0.5) * 0.4,
      h,
      thirst: GARDEN.thirst[0] + rng() * (GARDEN.thirst[1] - GARDEN.thirst[0]),
      kind: Math.floor(rng() * 1000),
      lost: false,
      lostAt: null,
      low: h,
      cans: 0,
    };
  });
  const gardeners: Gardener[] = Array.from({ length: n }, (_, i) => ({
    x: (i - (n - 1) / 2) * 1.3,
    z: 0.1,
    vx: 0,
    vz: 0,
    face: 0,
    pouring: false,
    target: -1,
    perks: 0,
    saves: 0,
    given: 0,
    bees: 0,
  }));
  const bees: Bee[] = Array.from({ length: beeCount(n) }, (_, i) => {
    const f = flowers[(i * 3 + 1) % flowers.length] as Flower;
    const a = rng() * Math.PI * 2;
    const ox = Math.sin(a) * GARDEN.beeOff;
    const oz = Math.cos(a) * GARDEN.beeOff;
    return { x: f.x + ox, z: f.z + oz, flower: (i * 3 + 1) % flowers.length, ox, oz, hover: 1 + rng() * 2, away: 0, vx: 0, vz: 0 };
  });
  return { players: n, time: 0, flowers, gardeners, bees };
}

/** Health a flower of thirst 1 loses a second at time t: slow at first, quicker as the evening goes on. */
export function wiltAt(t: number): number {
  const k = Math.min(1, Math.max(0, t / GARDEN.duration));
  return GARDEN.wilt[0] + (GARDEN.wilt[1] - GARDEN.wilt[0]) * k;
}

/** The nearest flower still standing that a can at (x, z) reaches, or -1. */
export function reachable(g: Garden, x: number, z: number): number {
  let best = -1;
  let bestD: number = GARDEN.reach;
  g.flowers.forEach((f, i) => {
    if (f.lost) return;
    const d = dist(x, z, f.x, f.z);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** Keeps gardeners on the lawn, out of the beds and out of each other. */
function separate(g: Garden): void {
  const gs = g.gardeners;
  for (let i = 0; i < gs.length; i++) {
    for (let j = i + 1; j < gs.length; j++) {
      const a = gs[i] as Gardener;
      const b = gs[j] as Gardener;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = GARDEN.bodyR * 2;
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
  for (const p of gs) {
    for (const f of g.flowers) {
      const dx = p.x - f.x;
      const dz = p.z - f.z;
      const d = Math.hypot(dx, dz);
      const min = GARDEN.bedR + GARDEN.bodyR;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 0;
      const nz = d > 1e-6 ? dz / d : 1;
      p.x = f.x + nx * min;
      p.z = f.z + nz * min;
    }
    p.x = Math.max(-GARDEN.bounds.x, Math.min(GARDEN.bounds.x, p.x));
    p.z = Math.max(-GARDEN.bounds.z, Math.min(GARDEN.bounds.z, p.z));
  }
}

function moveBees(g: Garden, dt: number, rng: Rng): void {
  const standing = g.flowers.map((f, i) => (f.lost ? -1 : i)).filter((i) => i >= 0);
  for (const b of g.bees) {
    if (b.away > 0) {
      b.away -= dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.vx *= Math.exp(-dt * 0.6);
      b.vz *= Math.exp(-dt * 0.6);
      b.x = Math.max(-GARDEN.bounds.x - 4, Math.min(GARDEN.bounds.x + 4, b.x));
      b.z = Math.max(-GARDEN.bounds.z - 3, Math.min(GARDEN.bounds.z + 2, b.z));
      continue;
    }
    const f = g.flowers[b.flower];
    if (!f || f.lost || b.hover <= 0) {
      // Off to another flower.
      const choices = standing.filter((i) => i !== b.flower);
      b.flower = choices.length ? (choices[Math.floor(rng() * choices.length)] as number) : (standing[0] ?? b.flower);
      b.hover = 1.4 + rng() * 2.2;
      const a = rng() * Math.PI * 2;
      b.ox = Math.sin(a) * GARDEN.beeOff;
      b.oz = Math.cos(a) * GARDEN.beeOff;
      continue;
    }
    const tx = f.x + b.ox;
    const tz = f.z + b.oz;
    const d = dist(b.x, b.z, tx, tz);
    if (d > 0.1) {
      const step = Math.min(d, GARDEN.beeSpeed * dt);
      b.x += ((tx - b.x) / d) * step;
      b.z += ((tz - b.z) / d) * step;
    } else {
      b.hover -= dt;
    }
  }
}

/** One step. `sticks` is every seat's stick (x, y -1..1, y up = away from the audience) and Water button. */
export function stepGarden(g: Garden, sticks: readonly Stick[], dt: number, rng: Rng): GardenEvent[] {
  const events: GardenEvent[] = [];
  if (g.time >= GARDEN.duration) return events;
  g.time = Math.min(GARDEN.duration, g.time + dt);
  const follow = Math.min(1, GARDEN.response * dt);

  // Walk.
  g.gardeners.forEach((p, i) => {
    const s = sticks[i] ?? IDLE;
    let sx = s.x;
    let sy = s.y;
    const len = Math.hypot(sx, sy);
    if (len < GARDEN.deadzone) sx = sy = 0;
    else if (len > 1) {
      sx /= len;
      sy /= len;
    }
    p.vx += (sx * GARDEN.speed - p.vx) * follow;
    p.vz += (-sy * GARDEN.speed - p.vz) * follow;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    if (Math.hypot(p.vx, p.vz) > 0.4) p.face = Math.atan2(p.vx, p.vz);
  });
  separate(g);

  // Pour.
  for (const f of g.flowers) f.cans = 0;
  g.gardeners.forEach((p, i) => {
    p.pouring = (sticks[i] ?? IDLE).a;
    p.target = p.pouring ? reachable(g, p.x, p.z) : -1;
    const f = g.flowers[p.target];
    if (!f) return;
    f.cans += 1;
    // Standing still while pouring: turn the can toward the flower.
    if (Math.hypot(p.vx, p.vz) < 1) p.face = Math.atan2(f.x - p.x, f.z - p.z);
  });

  // Wilt and drink.
  const wilt = wiltAt(g.time);
  g.flowers.forEach((f, i) => {
    if (f.lost) return;
    const before = f.h;
    const gain = f.cans * GARDEN.water * dt;
    f.h = Math.min(1, f.h + gain - wilt * f.thirst * dt);
    if (f.cans) {
      const share = Math.max(0, Math.min(gain, 1 - before)) / f.cans;
      for (const p of g.gardeners) if (p.target === i) p.given += share;
    }
    f.low = Math.min(f.low, f.h);
    if (before >= GARDEN.danger && f.h < GARDEN.danger) events.push({ kind: 'danger', flower: i });
    if (f.h <= 0) {
      f.h = 0;
      f.lost = true;
      f.lostAt = g.time;
      events.push({ kind: 'lost', flower: i });
      return;
    }
    if (f.cans && before < GARDEN.full && f.h >= GARDEN.full && f.low < GARDEN.perkFrom) {
      const seats = g.gardeners.map((p, k) => (p.target === i ? k : -1)).filter((k) => k >= 0);
      const save = f.low < GARDEN.danger;
      for (const k of seats) {
        const p = g.gardeners[k] as Gardener;
        p.perks += 1;
        if (save) p.saves += 1;
      }
      events.push({ kind: 'perk', flower: i, seats, save });
      f.low = f.h;
    }
  });

  // Bees, and the ones that get in the way of a can.
  moveBees(g, dt, rng);
  g.gardeners.forEach((p, seat) => {
    if (!p.pouring) return;
    const sx = p.x + Math.sin(p.face) * GARDEN.spout;
    const sz = p.z + Math.cos(p.face) * GARDEN.spout;
    g.bees.forEach((b, i) => {
      if (b.away > 0 || dist(b.x, b.z, sx, sz) > GARDEN.splashR) return;
      let dx = b.x - p.x;
      let dz = b.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) {
        dx = Math.sin(p.face);
        dz = Math.cos(p.face);
      } else {
        dx /= d;
        dz /= d;
      }
      b.away = GARDEN.beeAway;
      b.vx = dx * GARDEN.beeFlee;
      b.vz = dz * GARDEN.beeFlee;
      p.bees += 1;
      events.push({ kind: 'splash', bee: i, seat });
    });
  });
  return events;
}

/** What a flower is worth at the end: nothing once lost, half when nearly wilted, all of it from `bloom` up. */
export function flowerValue(f: Flower): number {
  return f.lost ? 0 : 0.5 + 0.5 * Math.min(1, f.h / GARDEN.bloom);
}

export function standing(g: Garden): number {
  return g.flowers.filter((f) => !f.lost).length;
}

/** The flowers still standing, weighted by how healthy they are, over all the flowers. */
export function gardenCoop(g: Garden): number {
  if (!g.flowers.length) return 0;
  return g.flowers.reduce((sum, f) => sum + flowerValue(f), 0) / g.flowers.length;
}

// ------------------------------------------------------------------ computer players

export interface GardenBrain {
  skill: number;
  /** The flower it is heading for (-1: none yet). */
  target: number;
  /** Seconds until it looks round the garden again. */
  think: number;
  /** Seconds left zoning out. */
  doze: number;
  /** The health it waters a flower up to. */
  aim: number;
  /** Whether it minds where the others are going this time. */
  polite: boolean;
  /** A slow wobble in its steering. */
  wander: number;
}

export function newGardenBrain(skill: number): GardenBrain {
  return { skill, target: -1, think: 0, doze: 0, aim: 0.95, polite: true, wander: 0 };
}

/** Seconds until flower f is lost if nobody waters it. */
export function timeLeft(g: Garden, f: Flower): number {
  return f.h / Math.max(1e-6, wiltAt(g.time) * f.thirst);
}

function plan(g: Garden, seat: number, b: GardenBrain, rng: Rng, brains: readonly (GardenBrain | null)[]): void {
  const p = g.gardeners[seat] as Gardener;
  const sloppy = 1 - b.skill;
  b.polite = rng() < 0.35 + 0.65 * b.skill;
  b.aim = Math.min(1, 0.78 + 0.18 * b.skill + rng() * 0.05);
  let best = -1;
  let bestScore = Infinity;
  g.flowers.forEach((f, i) => {
    if (f.lost) return;
    const d = Math.max(0, dist(p.x, p.z, f.x, f.z) - GARDEN.reach * 0.7);
    const travel = d / (GARDEN.speed * 0.8);
    // Most urgent first, close ones before far ones; past saving or still fresh: later.
    const left = timeLeft(g, f);
    let score = left + travel * 1.5;
    if (left < travel) score += 20;
    if (f.h > 0.85) score += 8;
    if (b.polite) {
      const taken = g.gardeners.some((o, k) => {
        if (k === seat) return false;
        if (brains[k]?.target === i) return true;
        // Someone (a person, say) already standing at it with the can.
        return o.target === i || (dist(o.x, o.z, f.x, f.z) < GARDEN.reach + 0.2 && dist(o.x, o.z, f.x, f.z) < dist(p.x, p.z, f.x, f.z));
      });
      if (taken) score += 7;
    }
    score += rng() * sloppy * 6;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  b.target = best;
  b.think = 0.35 + sloppy * 1.1 + rng() * 0.3;
}

/**
 * A computer gardener: looks for the thirstiest flower it can get to (sharp ones mind where the others are going,
 * sleepy ones pick less wisely and zone out now and then), walks over and waters it up.
 */
export function cpuGarden(g: Garden, seat: number, b: GardenBrain, rng: Rng, dt: number, brains: readonly (GardenBrain | null)[] = []): Stick {
  const p = g.gardeners[seat];
  if (!p) return IDLE;
  const sloppy = 1 - b.skill;
  b.wander += dt * (1.1 + rng() * 0.6);
  if (b.doze > 0) {
    b.doze -= dt;
    return IDLE;
  }
  if (rng() < dt * (0.01 + sloppy * 0.12)) {
    b.doze = 0.4 + rng() * (0.5 + sloppy * 1.5);
    return IDLE;
  }
  b.think -= dt;
  let f = g.flowers[b.target];
  const near = f ? dist(p.x, p.z, f.x, f.z) <= GARDEN.reach * 0.85 : false;
  const watering = !!f && !f.lost && near && f.h < b.aim;
  if (!f || f.lost || (near && f.h >= b.aim) || (b.think <= 0 && !watering)) {
    plan(g, seat, b, rng, brains);
    f = g.flowers[b.target];
  }
  if (!f) return IDLE;
  const dx = f.x - p.x;
  const dz = f.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d <= GARDEN.reach * 0.75) return { x: 0, y: 0, a: f.h < b.aim };
  // Walk there (wobbling a little), already pouring on the last stretch.
  const angle = Math.atan2(dx, dz) + Math.sin(b.wander) * sloppy * 0.5;
  const m = 0.75 + 0.25 * b.skill;
  return { x: Math.sin(angle) * m, y: -Math.cos(angle) * m, a: d <= GARDEN.reach && f.h < b.aim };
}
