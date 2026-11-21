// Microwave Popcorn: everyone has a microwave and the same three bags of popcorn, in sizes that cook differently.
// Hold to run the microwave: kernels pop slowly at first, then crackle at a peak, then slow down again. Let go
// when the popping slows: too early leaves kernels unpopped, too late burns the bottom of the bag.
// A bag scores its popped kernels minus the burnt ones. Letting go before the first pop only pauses the bag.
import { type Rng, shuffle } from '../rng';

export const POPCORN = {
  limit: 40, // seconds for all three bags
  between: 1.4, // seconds to swap one bag for the next
  scorch: 1.0, // the bottom starts to burn this many spreads after the peak…
  burn: 0.45, // …and the burnt share grows with the square of the spreads past that
  overdone: 3.4, // this many spreads after the peak the microwave gives up and switches itself off
} as const;

export type BagSize = 'small' | 'medium' | 'large';

export const BAG_SIZES: Record<BagSize, { kernels: number; spread: readonly [number, number]; start: readonly [number, number]; label: string }> = {
  small: { kernels: 60, spread: [0.55, 0.8], start: [0.8, 1.5], label: 'Small' },
  medium: { kernels: 90, spread: [0.75, 1.05], start: [1.0, 1.9], label: 'Medium' },
  large: { kernels: 120, spread: [0.95, 1.3], start: [1.2, 2.2], label: 'Large' },
};

export interface BagPlan {
  size: BagSize;
  /** Heat (seconds of cooking) at which each kernel pops, sorted. */
  kernels: number[];
  /** When the popping is at its fastest. */
  peak: number;
  /** How spread out the popping is, in seconds. */
  spread: number;
}

/** Roughly normal (mean 0, sd 1), bounded to about ±3.5. */
function gauss(rng: Rng): number {
  return (rng() + rng() + rng() + rng() - 2) * Math.sqrt(3);
}

const lerp = (r: readonly [number, number], k: number) => r[0] + (r[1] - r[0]) * k;

export function planBag(size: BagSize, rng: Rng): BagPlan {
  const s = BAG_SIZES[size];
  const spread = lerp(s.spread, rng());
  const peak = lerp(s.start, rng()) + 3.5 * spread;
  const kernels = Array.from({ length: s.kernels }, () => peak + spread * gauss(rng)).sort((a, b) => a - b);
  return { size, kernels, peak, spread };
}

/** The game's three bags, one of each size in a random order (everyone gets the same ones). */
export function planBags(rng: Rng): BagPlan[] {
  return shuffle(rng, ['small', 'medium', 'large'] as BagSize[]).map((size) => planBag(size, rng));
}

/** Kernels popped after `heat` seconds of cooking. */
export function poppedAt(plan: BagPlan, heat: number): number {
  let lo = 0;
  let hi = plan.kernels.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((plan.kernels[mid] as number) <= heat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** When the bottom of the bag starts to burn. */
export function scorchAt(plan: BagPlan): number {
  return plan.peak + POPCORN.scorch * plan.spread;
}

/** When the microwave switches itself off. */
export function overdoneAt(plan: BagPlan): number {
  return plan.peak + POPCORN.overdone * plan.spread;
}

/** Popped kernels that have burnt after `heat` seconds (never more than have popped). */
export function burntAt(plan: BagPlan, heat: number): number {
  const over = (heat - scorchAt(plan)) / plan.spread;
  if (over <= 0) return 0;
  return Math.min(poppedAt(plan, heat), Math.floor(plan.kernels.length * POPCORN.burn * over * over));
}

/** What a bag is worth taken out after `heat` seconds. */
export function bagScore(plan: BagPlan, heat: number): number {
  return poppedAt(plan, heat) - burntAt(plan, heat);
}

/** The heat where taking the bag out scores best (the earliest such moment). */
export function bestHeat(plan: BagPlan): number {
  let best = 0;
  let bestScore = -1;
  for (let h = 0; h <= overdoneAt(plan); h += 0.01) {
    const s = bagScore(plan, h);
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  return best;
}

// ------------------------------------------------------------------ one player's microwave

export interface BagResult {
  popped: number;
  burnt: number;
  heat: number;
}

export interface Cook {
  /** The bag in the microwave (bags.length when all are done). */
  bag: number;
  /** Seconds this bag has cooked. */
  heat: number;
  running: boolean;
  /** The next bag is in and ready from this time. */
  restUntil: number;
  results: BagResult[];
}

export function newCook(): Cook {
  return { bag: 0, heat: 0, running: false, restUntil: 0, results: [] };
}

export function cookDone(c: Cook, plans: readonly BagPlan[]): boolean {
  return c.bag >= plans.length;
}

/** Takes the bag out at `heat`, scores it and puts the next one in. */
function finish(c: Cook, plan: BagPlan, heat: number, t: number): BagResult {
  const result = { popped: poppedAt(plan, heat), burnt: burntAt(plan, heat), heat };
  c.results.push(result);
  c.bag += 1;
  c.heat = 0;
  c.running = false;
  c.restUntil = t + POPCORN.between;
  return result;
}

export interface CookStep {
  /** Kernels that popped this step. */
  pops: number;
  /** The bag that came out this step, if one did. */
  finished: BagResult | null;
}

/**
 * One step of a microwave: cooks while the button is held. Letting go after the first pop takes the bag out;
 * letting go before only pauses it. A bag left in far too long switches the microwave off by itself.
 */
export function stepCook(c: Cook, plans: readonly BagPlan[], holding: boolean, dt: number, t: number): CookStep {
  const plan = plans[c.bag];
  if (!plan || t < c.restUntil) {
    c.running = false;
    return { pops: 0, finished: null };
  }
  if (!holding) {
    if (!c.running) return { pops: 0, finished: null };
    c.running = false;
    return { pops: 0, finished: poppedAt(plan, c.heat) > 0 ? finish(c, plan, c.heat, t) : null };
  }
  c.running = true;
  const before = poppedAt(plan, c.heat);
  c.heat += dt;
  const pops = poppedAt(plan, c.heat) - before;
  return { pops, finished: c.heat >= overdoneAt(plan) ? finish(c, plan, c.heat, t) : null };
}

/**
 * A player let go. `lag` (seconds) is how long the message took to arrive: the bag comes out at the heat it had
 * when they actually let go.
 */
export function letGo(c: Cook, plans: readonly BagPlan[], t: number, lag: number): BagResult | null {
  const plan = plans[c.bag];
  if (!plan || !c.running) return null;
  c.running = false;
  const heat = Math.max(0, c.heat - Math.max(0, lag));
  if (poppedAt(plan, heat) > 0) return finish(c, plan, heat, t);
  c.heat = heat;
  return null;
}

/** Time's up: a bag that has started cooking comes out as it is. */
export function stopCook(c: Cook, plans: readonly BagPlan[], t: number): BagResult | null {
  const plan = plans[c.bag];
  if (!plan || c.heat <= 0) return null;
  return finish(c, plan, c.heat, t);
}

export function cookTotal(c: Cook): number {
  return c.results.reduce((sum, r) => sum + r.popped - r.burnt, 0);
}

export function popcornScores(cooks: readonly Cook[]): number[] {
  return cooks.map(cookTotal);
}

// ------------------------------------------------------------------ computer players

/** What a computer player means to do with the bag in front of it. */
export interface CpuCook {
  bag: number;
  pressAt: number;
  stopHeat: number;
}

export function newCpuCook(): CpuCook {
  return { bag: -1, pressAt: 0, stopHeat: 0 };
}

/**
 * Whether a computer player holds the button now. It listens for the popping to slow down: a sharp one lets go
 * close to the best moment, a sleepy one is off by more (and more often late than early).
 */
export function cpuHolding(cpu: CpuCook, c: Cook, plans: readonly BagPlan[], t: number, skill: number, rng: Rng): boolean {
  const plan = plans[c.bag];
  if (!plan) return false;
  if (cpu.bag !== c.bag) {
    cpu.bag = c.bag;
    cpu.pressAt = Math.max(t, c.restUntil) + 0.25 + (1 - skill) * 0.9 * rng();
    const off = gauss(rng) * (0.1 + 0.75 * (1 - skill)) + (1 - skill) * 0.2;
    cpu.stopHeat = Math.max(plan.kernels[3] ?? 0, bestHeat(plan) + off * plan.spread);
  }
  return t >= cpu.pressAt && t >= c.restUntil && c.heat < cpu.stopHeat;
}
