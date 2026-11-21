import { describe, expect, it } from 'vitest';
import {
  BAG_SIZES,
  type BagPlan,
  type Cook,
  POPCORN,
  bagScore,
  bestHeat,
  burntAt,
  cookTotal,
  cpuHolding,
  letGo,
  newCook,
  newCpuCook,
  overdoneAt,
  planBag,
  planBags,
  popcornScores,
  poppedAt,
  scorchAt,
  stepCook,
  stopCook,
} from '../src/game/minigames/popcorn';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** Cooks every bag to `heatOf(plan)` and lets go. */
function cookAll(plans: BagPlan[], heatOf: (p: BagPlan) => number): Cook {
  const c = newCook();
  for (let t = 0; t < POPCORN.limit && c.bag < plans.length; t += DT) {
    const plan = plans[c.bag] as BagPlan;
    stepCook(c, plans, c.heat < heatOf(plan), DT, t);
  }
  return c;
}

function playCpu(skill: number, seed: number): { total: number; best: number; time: number } {
  const rng = createRng(seed);
  const plans = planBags(createRng(seed * 7));
  const c = newCook();
  const cpu = newCpuCook();
  let t = 0;
  for (; t < POPCORN.limit && c.bag < plans.length; t += DT) stepCook(c, plans, cpuHolding(cpu, c, plans, t, skill, rng), DT, t);
  return { total: cookTotal(c), best: plans.reduce((s, p) => s + bagScore(p, bestHeat(p)), 0), time: t };
}

describe('microwave popcorn', () => {
  it('has three bags, one of each size, that pop at different moments', () => {
    const plans = planBags(createRng(3));
    expect(plans.map((p) => p.size).sort()).toEqual(['large', 'medium', 'small']);
    for (const p of plans) expect(p.kernels).toHaveLength(BAG_SIZES[p.size].kernels);
    const bests = new Set<number>();
    for (let seed = 1; seed <= 10; seed++) for (const p of planBags(createRng(seed))) bests.add(Math.round(bestHeat(p) * 10));
    expect(bests.size).toBeGreaterThan(15);
  });

  it('pops slowly, then at a peak, then slowly again', () => {
    const p = planBag('large', createRng(11));
    const rate = (h: number) => poppedAt(p, h + p.spread / 2) - poppedAt(p, h - p.spread / 2);
    expect(rate(p.peak)).toBeGreaterThan(rate(p.peak - 2 * p.spread) * 2);
    expect(rate(p.peak)).toBeGreaterThan(rate(p.peak + 2 * p.spread) * 2);
    expect(poppedAt(p, 0)).toBe(0);
    expect(poppedAt(p, 999)).toBe(p.kernels.length);
  });

  it('burns nothing until after the peak, then more and more, but never more than popped', () => {
    const p = planBag('medium', createRng(5));
    expect(burntAt(p, scorchAt(p))).toBe(0);
    expect(burntAt(p, scorchAt(p) + p.spread)).toBeGreaterThan(burntAt(p, scorchAt(p) + p.spread / 2));
    expect(burntAt(p, overdoneAt(p))).toBeLessThanOrEqual(poppedAt(p, overdoneAt(p)));
  });

  it('scores best when the popping has slowed down, worse too early or too late', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = planBag('small', createRng(seed));
      const best = bestHeat(p);
      // The best moment is past the peak, once the popping has clearly slowed.
      expect(best).toBeGreaterThan(p.peak + 0.5 * p.spread);
      expect(best).toBeLessThan(p.peak + 1.8 * p.spread);
      expect(bagScore(p, best)).toBeGreaterThan(bagScore(p, p.peak));
      expect(bagScore(p, best)).toBeGreaterThan(bagScore(p, p.peak + 2.2 * p.spread));
      expect(bagScore(p, best)).toBeGreaterThan(p.kernels.length * 0.72);
    }
  });

  it('cooks only while held, takes the bag out on letting go, and moves on to the next bag', () => {
    const plans = planBags(createRng(8));
    const c = newCook();
    let t = 0;
    const first = plans[0] as BagPlan;
    while (c.heat < bestHeat(first)) {
      stepCook(c, plans, true, DT, t);
      t += DT;
    }
    expect(c.running).toBe(true);
    const step = stepCook(c, plans, false, DT, t);
    expect(step.finished?.popped).toBe(poppedAt(first, c.results[0]?.heat ?? 0));
    expect(c.bag).toBe(1);
    expect(c.heat).toBe(0);
    // The next bag needs a moment to go in.
    stepCook(c, plans, true, DT, t + DT);
    expect(c.heat).toBe(0);
    stepCook(c, plans, true, DT, t + POPCORN.between + DT);
    expect(c.heat).toBeGreaterThan(0);
  });

  it('only pauses a bag let go before the first pop', () => {
    const plans = planBags(createRng(2));
    const c = newCook();
    stepCook(c, plans, true, 0.3, 0);
    expect(stepCook(c, plans, false, DT, 0.3).finished).toBeNull();
    expect(c.bag).toBe(0);
    expect(c.heat).toBeCloseTo(0.3);
  });

  it('takes half the round trip off a release', () => {
    const plans = planBags(createRng(4));
    const c = newCook();
    const plan = plans[0] as BagPlan;
    stepCook(c, plans, true, plan.peak + 2 * plan.spread, 0);
    const late = c.heat;
    const result = letGo(c, plans, 10, 0.1);
    expect(result?.heat).toBeCloseTo(late - 0.1);
    expect(result?.burnt).toBe(burntAt(plan, late - 0.1));
  });

  it('switches a forgotten microwave off, and takes a cooking bag out when time is up', () => {
    const plans = planBags(createRng(6));
    const c = newCook();
    let finished = null;
    for (let t = 0; t < 30 && !finished; t += DT) finished = stepCook(c, plans, true, DT, t).finished;
    expect(finished).not.toBeNull();
    expect(finished?.heat).toBeGreaterThanOrEqual(overdoneAt(plans[0] as BagPlan));
    const d = newCook();
    stepCook(d, plans, true, 3, 0);
    expect(stopCook(d, plans, 40)).not.toBeNull();
    expect(d.results).toHaveLength(1);
    expect(stopCook(newCook(), plans, 40)).toBeNull();
  });

  it('adds up popped minus burnt over the bags', () => {
    const plans = planBags(createRng(9));
    const good = cookAll(plans, bestHeat);
    const early = cookAll(plans, (p) => p.peak - p.spread);
    const late = cookAll(plans, (p) => p.peak + 2.5 * p.spread);
    expect(good.results).toHaveLength(3);
    expect(cookTotal(good)).toBe(plans.reduce((s, p) => s + bagScore(p, bestHeat(p)), 0));
    const [g, e, l] = popcornScores([good, early, late]) as [number, number, number];
    expect(g).toBeGreaterThan(e);
    expect(g).toBeGreaterThan(l);
  });

  it('has computer players cook believably: sharp ones close to the best, sleepy ones well off, all in time', () => {
    let sleepy = 0;
    let average = 0;
    let sharp = 0;
    let best = 0;
    const runs = 40;
    for (let seed = 1; seed <= runs; seed++) {
      const a = playCpu(0.1, seed);
      const b = playCpu(0.55, seed);
      const c = playCpu(0.95, seed);
      sleepy += a.total;
      average += b.total;
      sharp += c.total;
      best += c.best;
      expect(b.time).toBeLessThan(POPCORN.limit - 8);
    }
    expect(sharp).toBeLessThanOrEqual(best);
    expect(sharp).toBeGreaterThan(best * 0.93);
    expect(average).toBeLessThan(sharp * 0.97);
    expect(average).toBeGreaterThan(best * 0.8);
    expect(sleepy).toBeLessThan(average * 0.92);
    // A player who lets go a quarter of a spread off the best moment still beats a sleepy computer.
    let human = 0;
    for (let seed = 1; seed <= runs; seed++) for (const p of planBags(createRng(seed * 7))) human += bagScore(p, bestHeat(p) + 0.25 * p.spread * (seed % 2 ? 1 : -1));
    expect(human).toBeGreaterThan(sleepy);
  });
});
