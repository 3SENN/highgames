// Midnight Snack Run: each team races a shopping cart down its own lane of a late-night supermarket aisle. One
// partner pushes (pumps the phone), the other steers (tilts it); halfway through they swap. Steering close to a
// shelf as you pass grabs the snack on it; the wet floor makes you slide and the stack of cans stops you dead.
// Score: snacks grabbed, plus a bonus for the first cart across the checkout line.
import type { Rng } from '../rng.js';

export const CART = {
  duration: 35, // seconds
  step: 1 / 120, // physics step
  length: 56, // from the start to the checkout line
  runout: 7, // floor beyond the checkout line
  lane: 2.4, // between the shelves
  half: 0.38, // half the cart's width
  long: 0.5, // half the cart's length
  top: 5, // the speed pushing tends towards (never quite reached)
  push: 0.5, // speed a full-power stroke adds to a standing cart (less as it speeds up)
  drag: 0.35, // speed lost per second, per unit of speed
  roll: 0.1, // speed lost per second, always
  steer: 1.8, // sideways speed at full tilt
  deadzone: 0.08, // tilt below this counts as straight
  reach: 0.32, // grab a snack when the cart is this close to its shelf
  swapAt: 17.5, // the partners swap jobs now…
  swapPause: 1.2, // …and the cart coasts while they do
  first: 5, // bonus for the first cart across the line
  stun: 0.9, // seconds of picking up cans after a crash
  slide: 0.7, // seconds of sliding on the wet floor
} as const;

/** How far the cart's middle can go sideways from the middle of its lane. */
export const X_MAX = CART.lane / 2 - CART.half;

export type SnackKind = 'chips' | 'cereal' | 'icecream';
export type ObstacleKind = 'wet' | 'cans';

export interface Snack {
  s: number;
  side: -1 | 1;
  kind: SnackKind;
}

export interface Obstacle {
  s: number;
  x: number;
  kind: ObstacleKind;
  /** Its size on the floor (the puddle round the sign, the stack of cans). */
  r: number;
}

export interface Course {
  snacks: Snack[];
  obstacles: Obstacle[];
}

export interface Cart {
  /** Along the lane, and sideways from its middle (+x to the right). */
  s: number;
  x: number;
  v: number;
  vx: number;
  stun: number;
  slide: number;
  /** Which snacks and obstacles this cart has had (by index in the course). */
  got: boolean[];
  hit: boolean[];
  snacks: number;
  kinds: Record<SnackKind, number>;
  crashes: number;
  slips: number;
  finishedAt: number | null;
}

export type CartEvent =
  | { kind: 'snack'; index: number; snack: SnackKind }
  | { kind: 'missed'; index: number }
  | { kind: 'slip'; index: number }
  | { kind: 'crash'; index: number }
  | { kind: 'finish' };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const clamp01 = (n: number) => clamp(n, 0, 1);

// ------------------------------------------------------------------ the course

/** The aisle's sections: crisps first, then cereal, then the freezers. */
export const SECTIONS: { kind: SnackKind; from: number; to: number }[] = [
  { kind: 'chips', from: 5, to: 22 },
  { kind: 'cereal', from: 22, to: 38 },
  { kind: 'icecream', from: 38, to: 53 },
];

export function sectionAt(s: number): SnackKind {
  return (SECTIONS.find((k) => s < k.to) ?? SECTIONS[SECTIONS.length - 1])?.kind ?? 'icecream';
}

/** One layout for both lanes (fair): snacks along the shelves, two wet floors and two stacks of cans. */
export function makeCourse(rng: Rng): Course {
  const obstacles: Obstacle[] = [];
  const spots: [ObstacleKind, number][] = [
    ['wet', 11 + rng() * 4],
    ['cans', 21 + rng() * 4],
    ['wet', 33 + rng() * 4],
    ['cans', 44 + rng() * 4],
  ];
  for (const [kind, s] of spots) {
    const side = rng() < 0.5 ? -1 : 1;
    obstacles.push({ s, kind, x: side * (0.5 + rng() * 0.15), r: kind === 'wet' ? 0.5 : 0.42 });
  }
  const snacks: Snack[] = [];
  let side: -1 | 1 = rng() < 0.5 ? -1 : 1;
  for (let s = 5 + rng() * 1.5; s < 53; s += 2.5 + rng() * 1.0) {
    // Keep snacks clear of the obstacles, so every one can be had.
    if (obstacles.some((o) => Math.abs(o.s - s) < 1.4)) continue;
    snacks.push({ s, side, kind: sectionAt(s) });
    if (rng() < 0.78) side = side === 1 ? -1 : 1;
  }
  return { snacks, obstacles };
}

// ------------------------------------------------------------------ the cart

export function newCart(course: Course): Cart {
  return {
    s: 0,
    x: 0,
    v: 0,
    vx: 0,
    stun: 0,
    slide: 0,
    got: course.snacks.map(() => false),
    hit: course.obstacles.map(() => false),
    snacks: 0,
    kinds: { chips: 0, cereal: 0, icecream: 0 },
    crashes: 0,
    slips: 0,
    finishedAt: null,
  };
}

/** One stroke of the pump (power 0..1). False when it does nothing (stunned, or already across the line). */
export function pushCart(c: Cart, power: number): boolean {
  if (c.stun > 0 || c.finishedAt !== null) return false;
  c.v += CART.push * clamp01(power) * Math.max(0, 1 - c.v / CART.top);
  return true;
}

/** Whether the partners are busy swapping jobs at game time `t` (the cart coasts). */
export function swapping(t: number): boolean {
  return t >= CART.swapAt && t < CART.swapAt + CART.swapPause;
}

/** One physics step (CART.step seconds). `tilt` is the steerer's tilt (-1..1); `t` is the game time. */
export function stepCart(c: Cart, course: Course, tilt: number, t: number): CartEvent[] {
  const dt = CART.step;
  const events: CartEvent[] = [];
  c.stun = Math.max(0, c.stun - dt);
  c.slide = Math.max(0, c.slide - dt);
  // Sideways: follow the tilt, unless sliding on the wet floor.
  if (c.slide > 0) {
    c.vx *= Math.exp(-1.2 * dt);
  } else {
    const steer = c.finishedAt === null && Math.abs(tilt) > CART.deadzone ? clamp(tilt, -1, 1) : 0;
    c.vx += (steer * CART.steer - c.vx) * (1 - Math.exp(-12 * dt));
  }
  c.x += c.vx * dt;
  if (Math.abs(c.x) > X_MAX) {
    c.x = Math.sign(c.x) * X_MAX;
    c.vx = 0;
  }
  // Along the lane: rolling resistance and drag.
  c.v = Math.max(0, c.v - (CART.roll + CART.drag * c.v) * dt);
  const before = c.s;
  c.s = Math.min(CART.length + CART.runout, c.s + c.v * dt);

  // Snacks pass by: grabbed if the cart is close enough to that shelf.
  course.snacks.forEach((k, i) => {
    if (c.got[i] || before >= k.s || c.s < k.s || c.finishedAt !== null) return;
    if (k.side * c.x >= X_MAX - CART.reach) {
      c.got[i] = true;
      c.snacks += 1;
      c.kinds[k.kind] += 1;
      events.push({ kind: 'snack', index: i, snack: k.kind });
    } else {
      events.push({ kind: 'missed', index: i });
    }
  });
  // Obstacles: each one only once (it's knocked over after that).
  course.obstacles.forEach((o, i) => {
    if (c.hit[i] || c.finishedAt !== null) return;
    if (Math.abs(c.s - o.s) >= CART.long + o.r || Math.abs(c.x - o.x) >= CART.half + o.r) return;
    c.hit[i] = true;
    if (o.kind === 'cans') {
      c.crashes += 1;
      c.v = 0;
      c.stun = CART.stun;
      events.push({ kind: 'crash', index: i });
    } else {
      c.slips += 1;
      c.v *= 0.7;
      c.slide = CART.slide;
      // Away from the sign, whichever way the cart was going.
      c.vx = (c.x >= o.x ? 1 : -1) * 1.3;
      events.push({ kind: 'slip', index: i });
    }
  });
  if (c.finishedAt === null && c.s >= CART.length) {
    c.finishedAt = t;
    events.push({ kind: 'finish' });
  }
  return events;
}

// ------------------------------------------------------------------ scores

/** Each team's score: snacks, plus the bonus for the first cart across (equal times both get it). */
export function cartScores(carts: readonly Cart[]): number[] {
  const done = carts.map((c) => c.finishedAt).filter((t): t is number => t !== null);
  const first = done.length ? Math.min(...done) : null;
  return carts.map((c) => c.snacks + (first !== null && c.finishedAt === first ? CART.first : 0));
}

/** Whether this cart got the first-across bonus. */
export function wasFirst(carts: readonly Cart[], c: Cart): boolean {
  const done = carts.map((k) => k.finishedAt).filter((t): t is number => t !== null);
  return c.finishedAt !== null && c.finishedAt === Math.min(...done);
}

/** Scores per seat: both partners get their team's score. `teams` holds seat positions. */
export function cartSeatScores(carts: readonly Cart[], teams: readonly (readonly number[])[], seats: number): number[] {
  const team = cartScores(carts);
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    for (const m of members) if (m >= 0 && m < seats) scores[m] = team[i] ?? 0;
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

export interface CpuPusher {
  next: number;
  /** Seconds of resting tired arms. */
  rest: number;
}

export function newCpuPusher(): CpuPusher {
  return { next: 0, rest: 0 };
}

/** The pump strokes a computer pusher makes this frame (total power, 0 for none). skill: 0 sleepy … 1 sharp. */
export function cpuPush(p: CpuPusher, skill: number, rng: Rng, t: number, dt: number): number {
  const s = clamp01(skill);
  if (p.rest > 0) {
    p.rest -= dt;
    p.next = t;
    return 0;
  }
  if (rng() < (0.08 + (1 - s) * 0.2) * dt) {
    p.rest = 0.4 + rng() * (0.6 + (1 - s) * 1.0);
    return 0;
  }
  let power = 0;
  for (let n = 0; t >= p.next && n < 8; n++) {
    p.next = Math.max(p.next, t - 0.5) + (0.75 + rng() * 0.5) / (3.4 + 2.0 * s);
    power += clamp(0.58 + 0.27 * s + (rng() - 0.5) * 0.3, 0.3, 1);
  }
  return power;
}

export interface CpuSteerer {
  next: number;
  target: number;
  /** Snacks this steerer has decided not to bother with. */
  skip: Set<number>;
  /** The snack it last made up its mind about. */
  seen: number;
}

export function newCpuSteerer(): CpuSteerer {
  return { next: 0, target: 0, skip: new Set(), seen: -1 };
}

/** The tilt a computer steerer holds this frame: towards the next snack, round the next obstacle. */
export function cpuSteer(st: CpuSteerer, c: Cart, course: Course, skill: number, rng: Rng, t: number): number {
  const s = clamp01(skill);
  if (t >= st.next) {
    st.next = t + 0.1 + (1 - s) * 0.35 * (0.5 + rng());
    const look = 2 + c.v * (0.7 + 0.7 * s);
    // A sleepy steerer doesn't always see the obstacle coming.
    const ahead = course.obstacles.find((o, i) => !c.hit[i] && o.s - c.s > -0.3 && o.s - c.s < look);
    const noticed = ahead && rng() >= (1 - s) * 0.6;
    const index = course.snacks.findIndex((k, i) => !c.got[i] && !st.skip.has(i) && k.s > c.s + 0.2 && k.s - c.s < look + 3);
    const snack = course.snacks[index];
    if (snack && index !== st.seen) {
      // A sleepy steerer lets some snacks go by.
      st.seen = index;
      if (rng() < (1 - s) * 0.35) st.skip.add(index);
    }
    // How far a sleepy hand really leans in.
    const lazy = rng() * (1 - s) * 0.55;
    if (ahead && noticed && Math.abs(c.x - ahead.x) < CART.half + ahead.r + 0.15) {
      st.target = (ahead.x > 0 ? -1 : 1) * X_MAX;
    } else if (snack && !st.skip.has(index)) {
      // Going for the snack, unless that steers straight into the obstacle.
      const into = ahead && noticed && Math.abs(snack.side * X_MAX - ahead.x) < CART.half + ahead.r && ahead.s < snack.s;
      st.target = into ? c.x : snack.side * (X_MAX - lazy);
    } else {
      st.target = (rng() - 0.5) * (1 - s);
    }
  }
  return clamp((st.target - c.x) * (1.6 + 1.4 * s), -1, 1);
}
