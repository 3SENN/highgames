// Kite Duo: each pair flies one kite on a windy hilltop at sunset. One partner flies (tilts to steer it about), the
// other reels (every pump gives the kite lift; without pumping it slowly sinks). Balloons float about the sky:
// fly into them for a point, gold ones 3. Touching the tree or the bunting tangles the kite for a moment.
// Halfway through, partners swap jobs. Most balloon points wins.
//
// The sky is a flat x/y plane facing the TV: x across (-x left), y up from the hilltop.
import type { Rng } from '../rng.js';

export const KITE = {
  duration: 35, // seconds
  swapAt: 17.5, // partners swap jobs here
  x: 8.4, // the kites stay within this of the middle
  low: 1.3, // the kite drags along the grass here
  high: 9.4, // the end of the string
  steer: 6, // sideways speed at full tilt
  response: 3.5, // how quickly a kite follows the tilt (they're floaty)
  nudge: 1.3, // up/down speed from tilting forwards/back
  climb: 4.2, // upward speed at full lift…
  sink: 1.7, // …against this steady pull down (so a little over 0.4 lift hovers)
  vresp: 3, // how quickly the climb follows the lift
  perPump: 0.26, // lift from one full pump
  fade: 0.35, // lift lost per second
  autoLift: 0.42, // a pair of one has nobody to reel: the kite holds its height by itself
  kiteR: 0.5,
  balloonR: 0.42,
  tangle: 1.5, // seconds stuck after touching the tree or the bunting
  freeFor: 0.7, // seconds after getting free when it can't tangle again
  wind: 0.9, // gusts push the kites sideways by up to this
  first: 5, // balloons in the sky at the start
  every: 0.8, // seconds between new balloons (on average)
  most: 8, // most balloons in the sky at once
  life: [7, 10] as readonly [number, number], // seconds a balloon stays before it floats off
  rise: 0.2, // balloons drift up this much a second
  gold: 0.16, // share of gold balloons
  step: 1 / 120, // physics sub-step
} as const;

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** The tree on the right of the hill: its crown, as circles. */
export const TREE: readonly Circle[] = [
  { x: 6.4, y: 3.6, r: 1.45 },
  { x: 5.4, y: 2.7, r: 1.0 },
  { x: 7.4, y: 2.8, r: 1.0 },
];

export interface Bunting {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** How far the middle sags below the straight line. */
  sag: number;
}

/** Strings of bunting between tall poles: one low on the left, one high on the right. */
export const BUNTING: readonly Bunting[] = [
  { ax: -8.9, ay: 6.2, bx: -3.0, by: 5.1, sag: 0.7 },
  { ax: 1.6, ay: 8.0, bx: 8.9, by: 7.4, sag: 0.6 },
];

/** A point along a bunting string, k from 0 (one pole) to 1 (the other). */
export function buntingAt(b: Bunting, k: number): { x: number; y: number } {
  return { x: b.ax + (b.bx - b.ax) * k, y: b.ay + (b.by - b.ay) * k - Math.sin(Math.PI * k) * b.sag };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; x: number; y: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  const k = clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1);
  const x = ax + vx * k;
  const y = ay + vy * k;
  return { d: Math.hypot(px - x, py - y), x, y };
}

/** The nearest point of the tree or a bunting string to (x, y), and how far it is from its surface. */
export function nearestSnag(x: number, y: number): { gap: number; nx: number; ny: number } {
  let gap = Infinity;
  let nx = 0;
  let ny = 1;
  for (const c of TREE) {
    const d = Math.hypot(x - c.x, y - c.y);
    if (d - c.r < gap) {
      gap = d - c.r;
      nx = d > 1e-6 ? (x - c.x) / d : 0;
      ny = d > 1e-6 ? (y - c.y) / d : 1;
    }
  }
  for (const b of BUNTING) {
    const N = 12;
    let prev = buntingAt(b, 0);
    for (let i = 1; i <= N; i++) {
      const next = buntingAt(b, i / N);
      const s = segDist(x, y, prev.x, prev.y, next.x, next.y);
      if (s.d < gap) {
        gap = s.d;
        nx = s.d > 1e-6 ? (x - s.x) / s.d : 0;
        ny = s.d > 1e-6 ? (y - s.y) / s.d : -1;
      }
      prev = next;
    }
  }
  return { gap, nx, ny };
}

// ------------------------------------------------------------------ balloons

export interface Balloon {
  id: number;
  /** When it appears and when it floats off. */
  at: number;
  until: number;
  x: number;
  y: number;
  gold: boolean;
  phase: number;
  /** The team that got it, or null. */
  taken: number | null;
}

/** Where a balloon is at time t: drifting slowly up and swaying. */
export function balloonAt(b: Balloon, t: number): { x: number; y: number } {
  const age = Math.max(0, t - b.at);
  return { x: b.x + Math.sin(age * 0.9 + b.phase) * 0.25, y: b.y + age * KITE.rise };
}

/** Every balloon of a game, in order of appearance, clear of the tree and the bunting and of each other. */
export function makeBalloons(rng: Rng): Balloon[] {
  const out: Balloon[] = [];
  const place = (at: number): void => {
    const life = KITE.life[0] + rng() * (KITE.life[1] - KITE.life[0]);
    for (let tries = 0; tries < 40; tries++) {
      const x = (rng() * 2 - 1) * (KITE.x - 0.6);
      const y = 2.4 + rng() * (KITE.high - 0.8 - life * KITE.rise - 2.4);
      const snag = Math.min(nearestSnag(x, y).gap, nearestSnag(x, y + life * KITE.rise).gap);
      if (snag < KITE.balloonR + 0.5) continue;
      const crowded = out.some((o) => o.at <= at && o.until > at && Math.hypot(o.x - x, o.y - y) < 1.5);
      if (crowded) continue;
      out.push({ id: out.length, at, until: at + life, x, y, gold: rng() < KITE.gold, phase: rng() * Math.PI * 2, taken: null });
      return;
    }
  };
  for (let i = 0; i < KITE.first; i++) place(0);
  let at = 0.6;
  while (at < KITE.duration - 1.5) {
    if (out.filter((o) => o.at <= at && o.until > at).length < KITE.most) place(at);
    at += KITE.every * (0.6 + rng() * 0.8);
  }
  return out;
}

// ------------------------------------------------------------------ kites

export interface Kite {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 to 1: how much the reeler has it pulling up right now. */
  lift: number;
  /** Seconds left tangled. */
  tangled: number;
  /** Seconds left when it can't tangle again. */
  free: number;
  /** A pair of one: the kite holds its height by itself. */
  auto: boolean;
  points: number;
  balloons: number;
  golds: number;
  tangles: number;
}

export interface Tilt {
  x: number;
  y: number;
}

export interface Sky {
  kites: Kite[];
  balloons: Balloon[];
  time: number;
}

export interface SkyEvents {
  /** Balloons collected this step, and by which kite. */
  got: { kite: number; balloon: Balloon }[];
  tangled: number[];
  freed: number[];
}

/** Where each team's kite starts: above its own side of the hill. */
export function kiteStart(team: number, teams: number): number {
  return teams > 1 ? (team === 0 ? -2.6 : 2.6) : 0;
}

export function newSky(rng: Rng, teams: number, solo: readonly boolean[] = []): Sky {
  const kites = Array.from({ length: teams }, (_, i) => ({
    x: kiteStart(i, teams),
    y: 4.6,
    vx: 0,
    vy: 0,
    lift: 0.45,
    tangled: 0,
    free: 0,
    auto: solo[i] === true,
    points: 0,
    balloons: 0,
    golds: 0,
    tangles: 0,
  }));
  return { kites, balloons: makeBalloons(rng), time: 0 };
}

/** Which partner (0 or 1) flies right now; the other reels. */
export function flyerAt(t: number): number {
  return t < KITE.swapAt ? 0 : 1;
}

/** The sideways gust at time t (the same for every kite). */
export function windAt(t: number): number {
  return KITE.wind * (Math.sin(t * 0.45 + 0.7) * 0.7 + Math.sin(t * 1.15 + 2.1) * 0.3);
}

/** One pump from the reeler, power 0..1. Returns false while the kite is tangled (the pump does nothing). */
export function pumpKite(k: Kite, power: number): boolean {
  if (k.tangled > 0) return false;
  k.lift = Math.min(1, k.lift + KITE.perPump * (0.6 + 0.4 * clamp(power, 0, 1)));
  return true;
}

/** Balloons in the sky at time t that nobody has got yet. */
export function liveBalloons(sky: Sky, t = sky.time): Balloon[] {
  return sky.balloons.filter((b) => b.taken === null && b.at <= t && b.until > t && balloonAt(b, t).y < KITE.high + 1);
}

function subStep(sky: Sky, tilts: readonly Tilt[], h: number, ev: SkyEvents): void {
  sky.time += h;
  const t = sky.time;
  const wind = windAt(t);
  sky.kites.forEach((k, i) => {
    if (k.tangled > 0) {
      k.tangled -= h;
      k.vx = 0;
      k.vy = 0;
      if (k.tangled <= 0) {
        // Free: it slips off the snag and drifts clear.
        k.tangled = 0;
        k.free = KITE.freeFor;
        const s = nearestSnag(k.x, k.y);
        if (s.gap < KITE.kiteR + 0.15) {
          k.x += s.nx * (KITE.kiteR + 0.15 - s.gap);
          k.y += s.ny * (KITE.kiteR + 0.15 - s.gap);
        }
        k.x = clamp(k.x, -KITE.x, KITE.x);
        k.y = clamp(k.y, KITE.low, KITE.high);
        ev.freed.push(i);
      }
      return;
    }
    const tilt = tilts[i] ?? { x: 0, y: 0 };
    if (k.auto) k.lift = Math.max(k.lift, KITE.autoLift);
    k.vx += (clamp(tilt.x, -1, 1) * KITE.steer + wind - k.vx) * Math.min(1, KITE.response * h);
    const climb = k.lift * KITE.climb - KITE.sink + clamp(tilt.y, -1, 1) * KITE.nudge;
    k.vy += (climb - k.vy) * Math.min(1, KITE.vresp * h);
    k.x += k.vx * h;
    k.y += k.vy * h;
    k.lift = Math.max(0, k.lift - KITE.fade * h);
    k.free = Math.max(0, k.free - h);
    if (Math.abs(k.x) > KITE.x) {
      k.x = clamp(k.x, -KITE.x, KITE.x);
      k.vx = 0;
    }
    if (k.y < KITE.low || k.y > KITE.high) {
      k.y = clamp(k.y, KITE.low, KITE.high);
      k.vy = 0;
    }
    if (k.free <= 0 && nearestSnag(k.x, k.y).gap < KITE.kiteR * 0.8) {
      k.tangled = KITE.tangle;
      k.tangles += 1;
      k.lift = 0;
      k.vx = 0;
      k.vy = 0;
      ev.tangled.push(i);
    }
  });
  for (const b of sky.balloons) {
    if (b.taken !== null || b.at > t || b.until <= t) continue;
    const p = balloonAt(b, t);
    let best = -1;
    let nearest = KITE.kiteR + KITE.balloonR;
    sky.kites.forEach((k, i) => {
      if (k.tangled > 0) return;
      const d = Math.hypot(k.x - p.x, k.y - p.y);
      if (d < nearest) {
        nearest = d;
        best = i;
      }
    });
    if (best < 0) continue;
    const k = sky.kites[best] as Kite;
    b.taken = best;
    k.points += b.gold ? 3 : 1;
    k.balloons += 1;
    if (b.gold) k.golds += 1;
    ev.got.push({ kite: best, balloon: b });
  }
}

/** Advances the sky by dt seconds (in small sub-steps) with each kite's tilt from its flyer. */
export function stepSky(sky: Sky, tilts: readonly Tilt[], dt: number): SkyEvents {
  const ev: SkyEvents = { got: [], tangled: [], freed: [] };
  let left = Math.min(dt, KITE.duration - sky.time);
  while (left > 1e-9) {
    const h = Math.min(KITE.step, left);
    subStep(sky, tilts, h, ev);
    left -= h;
  }
  // Rounding never leaves the clock a hair short of the end.
  if (KITE.duration - sky.time < 1e-6) sky.time = KITE.duration;
  return ev;
}

/** A kite's score: its points, and on equal points the pair that got more balloons. */
export function kiteScore(k: Kite): number {
  return k.points * 100 + Math.min(99, k.balloons);
}

/** Scores per seat: both partners get their kite's score. `teams` holds seat positions. */
export function kiteScores(sky: Sky, teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    const k = sky.kites[i];
    if (!k) return;
    for (const m of members) if (m >= 0 && m < seats) scores[m] = kiteScore(k);
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

export interface CpuKite {
  /** The balloon it's after (an id), or null. */
  target: number | null;
  /** When the flyer next rethinks. */
  rethink: number;
  /** Aim error, fixed between rethinks. */
  errX: number;
  errY: number;
  /** When the reeler may pump next. */
  pumpAt: number;
  /** Seconds left gazing at the sunset. */
  daydream: number;
}

export function newCpuKite(): CpuKite {
  return { target: null, rethink: 0, errX: 0, errY: 0, pumpAt: 0.2, daydream: 0 };
}

/**
 * The balloon worth going for: points over how long it takes to get there, among those that'll still be there.
 * `heightCost` makes climbing count for more (a computer flyer whose partner, a person, does the climbing).
 */
export function cpuPick(sky: Sky, k: Kite, heightCost = 1): Balloon | null {
  const t = sky.time;
  let best: Balloon | null = null;
  let bestValue = 0;
  for (const b of liveBalloons(sky, t)) {
    const p = balloonAt(b, t);
    const reach = Math.abs(p.x - k.x) / (KITE.steer * 0.7) + (Math.abs(p.y - k.y) / 1.8) * heightCost + 0.3;
    if (b.until - t < reach + 0.3) continue;
    const value = (b.gold ? 3 : 1) / reach;
    if (value > bestValue) {
      bestValue = value;
      best = b;
    }
  }
  return best;
}

/** Where a computer player wants the kite: its target balloon, or a comfortable height mid-sky. */
export function cpuGoal(c: CpuKite, sky: Sky, k: Kite): { x: number; y: number } {
  const b = c.target === null ? undefined : sky.balloons[c.target];
  if (b && b.taken === null && b.until > sky.time) return balloonAt(b, sky.time + 0.4);
  return { x: k.x, y: 5.2 };
}

/**
 * The height a computer reeler aims for when a person flies: the balloon the kite seems to be heading for (nearest
 * to where it'll be across in a moment), or a comfortable height mid-sky.
 */
export function cpuReelGoal(sky: Sky, k: Kite): number {
  const ahead = k.x + k.vx * 0.8;
  let goal = 5.2;
  let nearest = Infinity;
  for (const b of liveBalloons(sky)) {
    const p = balloonAt(b, sky.time + 0.4);
    const d = Math.abs(p.x - ahead) + Math.abs(p.y - k.y) * 0.3;
    if (d < nearest) {
      nearest = d;
      goal = p.y;
    }
  }
  return goal;
}

/**
 * A computer flyer's tilt: steers at its balloon, now and then misjudging or gazing at the sunset; sharp ones
 * swerve round the tree and the bunting. `heightCost` as in cpuPick.
 */
export function cpuTilt(c: CpuKite, sky: Sky, k: Kite, dt: number, skill: number, rng: Rng, heightCost = 1): Tilt {
  const s = Math.max(0, Math.min(1, skill));
  if (c.daydream > 0) {
    c.daydream -= dt;
    return { x: 0, y: 0 };
  }
  if (rng() < (0.02 + (1 - s) * 0.12) * dt) c.daydream = 0.4 + rng() * (0.4 + (1 - s) * 1.0);
  const t = sky.time;
  const current = c.target === null ? undefined : sky.balloons[c.target];
  if (t >= c.rethink || !current || current.taken !== null || current.until <= t) {
    c.target = cpuPick(sky, k, heightCost)?.id ?? null;
    c.rethink = t + 0.2 + (1 - s) * 0.5 + rng() * 0.3;
    c.errX = (rng() - 0.5) * (0.3 + (1 - s) * 1.6);
    c.errY = (rng() - 0.5) * (0.2 + (1 - s) * 1.0);
  }
  const goal = cpuGoal(c, sky, k);
  let x = clamp((goal.x + c.errX - k.x) * (0.45 + 0.35 * s) - windAt(t) / KITE.steer * s, -1, 1);
  let y = clamp((goal.y + c.errY - k.y) * 0.5, -1, 1);
  // Something to snag on just ahead: sharp flyers steer away from it.
  const ahead = nearestSnag(k.x + k.vx * 0.35, k.y + k.vy * 0.35);
  if (ahead.gap < KITE.kiteR + 0.6 && rng() < 0.3 + 0.7 * s) {
    x = clamp(x + ahead.nx * 1.2, -1, 1);
    y = clamp(y + ahead.ny * 1.2, -1, 1);
  }
  return { x, y };
}

/**
 * Whether a computer reeler pumps now (returns the pump's power) or not (null). It pumps hard to climb to `goalY`
 * and gently to hold there; sleepy ones are slower and sometimes forget.
 */
export function cpuPump(c: CpuKite, k: Kite, goalY: number, t: number, skill: number, rng: Rng): number | null {
  const s = Math.max(0, Math.min(1, skill));
  if (k.tangled > 0 || t < c.pumpAt) return null;
  if (c.daydream > 0) return null;
  const want = clamp((KITE.sink + (goalY - k.y) * 1.3 - k.vy * 0.3) / KITE.climb, 0, 1);
  if (k.lift >= want - 0.03) return null;
  if (rng() < 0.01 + (1 - s) * 0.07) {
    c.pumpAt = t + 0.6 + rng() * (1 - s) * 1.4;
    return null;
  }
  c.pumpAt = t + 0.17 + (1 - s) * 0.22 + rng() * 0.1;
  return 0.55 + 0.35 * s + rng() * 0.1;
}
