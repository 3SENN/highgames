// Cloud Catch: snacks rain down and every player slides a bowl left and right in their own lane to catch them.
// Chips, cookies, donuts and pretzels are 1 point, a golden cookie 3; catching broccoli costs 2.
// Every lane gets the very same snacks at the same moments, so it comes down to who catches best.
import type { Rng } from '../rng';

export const CATCH = {
  duration: 30, // seconds
  lane: 3.4, // width of each player's lane
  reach: 1.35, // the bowl's centre stays within this distance of the lane's centre
  speed: 6.5, // bowl speed at full stick, units a second
  accel: 40, // how fast the bowl gets up to speed (units a second, a second)
  deadzone: 0.12, // stick values smaller than this count as letting go
  top: 8.8, // snacks appear this high (out of the snack clouds)
  catchY: 2.0, // the bowl's rim: a snack is caught (or missed) as it passes this height
  catchR: 0.5, // how far from the bowl's centre a snack still lands in it
  fall: [3.4, 5.4] as const, // fall speed at the start and at the end
  every: [0.62, 0.36] as const, // seconds between drops at the start and at the end
  golden: 0.07, // share of golden cookies
  broccoli: 0.18, // share of broccoli
  lastDrop: 2.2, // no new snacks in the last seconds, so everything that falls can land
} as const;

export const SNACKS = ['chip', 'cookie', 'donut', 'pretzel'] as const;
export type SnackKind = (typeof SNACKS)[number] | 'golden' | 'broccoli';

export const SNACK_POINTS: Record<SnackKind, number> = { chip: 1, cookie: 1, donut: 1, pretzel: 1, golden: 3, broccoli: -2 };

export interface Drop {
  /** When it appears at the top, in seconds. */
  at: number;
  /** Across the lane, from its centre. */
  x: number;
  kind: SnackKind;
  /** Fall speed, units a second. */
  speed: number;
}

/** The whole shower of snacks for one game (every lane gets the same one). */
export function makeDrops(rng: Rng): Drop[] {
  const drops: Drop[] = [];
  let at = 0.6;
  let lastX = 0;
  while (at < CATCH.duration - CATCH.lastDrop) {
    const k = at / CATCH.duration;
    const r = rng();
    const kind: SnackKind = r < CATCH.golden ? 'golden' : r < CATCH.golden + CATCH.broccoli ? 'broccoli' : (SNACKS[Math.floor(rng() * SNACKS.length)] ?? 'chip');
    // Mostly a fair hop from the last one; now and then a long dash across the lane.
    let x = rng() < 0.4 ? (rng() * 2 - 1) * CATCH.reach : lastX + (rng() * 2 - 1) * 1.6;
    x = Math.max(-CATCH.reach, Math.min(CATCH.reach, x));
    drops.push({ at, x, kind, speed: CATCH.fall[0] + (CATCH.fall[1] - CATCH.fall[0]) * k });
    lastX = x;
    const gap = CATCH.every[0] + (CATCH.every[1] - CATCH.every[0]) * k;
    at += gap * (0.7 + rng() * 0.6);
  }
  return drops;
}

/** Height of a drop at time t (from the top down; it keeps falling past the bowl). */
export function dropY(d: Drop, t: number): number {
  return CATCH.top - d.speed * (t - d.at);
}

/** When a drop passes the bowl's rim. */
export function landsAt(d: Drop): number {
  return d.at + (CATCH.top - CATCH.catchY) / d.speed;
}

export interface Bowl {
  x: number;
  vx: number;
  score: number;
  /** Snacks caught (broccoli not counted). */
  snacks: number;
  goldens: number;
  greens: number;
}

export function newBowl(): Bowl {
  return { x: 0, vx: 0, score: 0, snacks: 0, goldens: 0, greens: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Slides the bowl with the stick (-1 … 1), easing into and out of its speed and stopping at the lane's edges. */
export function stepBowl(b: Bowl, stick: number, dt: number): void {
  const s = Math.abs(stick) < CATCH.deadzone ? 0 : clamp(stick, -1, 1);
  const want = s * CATCH.speed;
  const step = CATCH.accel * dt;
  b.vx = b.vx < want ? Math.min(want, b.vx + step) : Math.max(want, b.vx - step);
  b.x += b.vx * dt;
  if (b.x > CATCH.reach || b.x < -CATCH.reach) {
    b.x = clamp(b.x, -CATCH.reach, CATCH.reach);
    b.vx = 0;
  }
}

export function catches(bowlX: number, d: Drop): boolean {
  return Math.abs(bowlX - d.x) <= CATCH.catchR;
}

/** Checks one drop against one bowl as it passes the rim. Returns the points it was worth (0 when missed). */
export function resolveDrop(b: Bowl, d: Drop): number {
  if (!catches(b.x, d)) return 0;
  const points = SNACK_POINTS[d.kind];
  b.score += points;
  if (d.kind === 'broccoli') b.greens += 1;
  else b.snacks += 1;
  if (d.kind === 'golden') b.goldens += 1;
  return points;
}

export function catchScores(bowls: readonly Bowl[]): number[] {
  return bowls.map((b) => b.score);
}

// ------------------------------------------------------------------ computer players

/**
 * Where a computer player wants its bowl: under the next snack it can still reach (looking further ahead the
 * sharper it is), and out of the way of broccoli that's about to land on it.
 */
export function cpuAim(bowlX: number, drops: readonly Drop[], t: number, skill: number): number {
  const ahead = 0.8 + skill * 1.4;
  const notice = 0.1 + (1 - skill) * 0.35; // a snack has to fall a moment before it's spotted
  const falling = drops.filter((d) => d.at + notice <= t && landsAt(d) >= t && landsAt(d) <= t + ahead).sort((a, b) => landsAt(a) - landsAt(b));
  const greens = falling.filter((d) => d.kind === 'broccoli');
  const nearGreen = (x: number, when: number) => greens.some((g) => Math.abs(landsAt(g) - when) < 0.35 && Math.abs(g.x - x) < CATCH.catchR + 0.15);
  let target = bowlX;
  for (const d of falling) {
    if (d.kind === 'broccoli') continue;
    const left = landsAt(d) - t;
    if (Math.abs(d.x - bowlX) > CATCH.speed * 0.8 * left + CATCH.catchR) continue;
    if (nearGreen(d.x, landsAt(d))) continue;
    target = d.x;
    break;
  }
  // Broccoli about to land in the bowl (or where the bowl is headed): step aside.
  const dodge = 0.3 + skill * 0.3;
  const danger = greens.find((g) => landsAt(g) - t < dodge && (Math.abs(g.x - bowlX) < CATCH.catchR + 0.2 || Math.abs(g.x - target) < CATCH.catchR + 0.2));
  if (danger) {
    const side = bowlX === danger.x ? (danger.x > 0 ? -1 : 1) : Math.sign(bowlX - danger.x);
    target = danger.x + side * (CATCH.catchR + 0.55);
    if (Math.abs(target) > CATCH.reach) target = danger.x - side * (CATCH.catchR + 0.55);
  }
  return clamp(target, -CATCH.reach, CATCH.reach);
}

/** A stick value that brings the bowl to `target` without overshooting much. */
export function steer(bowlX: number, target: number): number {
  const d = target - bowlX;
  if (Math.abs(d) < 0.06) return 0;
  return clamp(d * 3, -1, 1);
}

/** A computer player's hands: it rethinks its aim now and then, misjudges a little, and sometimes spaces out. */
export interface CpuBowl {
  target: number;
  nextThink: number;
  /** Seconds left staring into space. */
  daydream: number;
}

export function newCpuBowl(): CpuBowl {
  return { target: 0, nextThink: 0, daydream: 0 };
}

/** The stick a computer player pushes this step. skill: 0 sleepy … 1 sharp. */
export function cpuStick(c: CpuBowl, b: Bowl, drops: readonly Drop[], t: number, dt: number, skill: number, rng: Rng): number {
  if (c.daydream > 0) {
    c.daydream -= dt;
    return 0;
  }
  if (rng() < (0.04 + (1 - skill) * 0.3) * dt) {
    c.daydream = 0.5 + rng() * (0.4 + (1 - skill) * 0.8);
    return 0;
  }
  if (t >= c.nextThink) {
    c.target = clamp(cpuAim(b.x, drops, t, skill) + (rng() - 0.5) * (0.35 + (1 - skill) * 0.9), -CATCH.reach, CATCH.reach);
    c.nextThink = t + 0.12 + (1 - skill) * 0.45 * rng();
  }
  return steer(b.x, c.target) * (0.5 + 0.5 * skill);
}
