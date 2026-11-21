import { describe, expect, it } from 'vitest';
import { ORDERS, SLICE, cpuCut, cutError, cutPoints, knifeAngle, planOrders, sliceScores, sliceShare } from '../src/game/minigames/pizzaslice';
import { createRng } from '../src/game/rng';

describe('slice it fair', () => {
  it('plans four different orders, at least one big and two small', () => {
    for (let seed = 1; seed < 200; seed++) {
      const orders = planOrders(createRng(seed));
      expect(orders).toHaveLength(SLICE.rounds);
      expect(new Set(orders).size).toBe(SLICE.rounds);
      for (const o of orders) expect(ORDERS).toContain(o);
      for (let i = 0; i < orders.length; i++) {
        for (let j = i + 1; j < orders.length; j++) expect(Math.abs((orders[i]?.share ?? 0) - (orders[j]?.share ?? 0))).toBeGreaterThanOrEqual(SLICE.minGap - 1e-9);
      }
      expect(orders.some((o) => o.share > 0.5)).toBe(true);
      expect(orders.filter((o) => o.share <= 0.5).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('has orders that match their labels', () => {
    for (const o of ORDERS) {
      const [a, b] = o.label.split('/').map(Number) as [number, number];
      expect(o.share).toBeCloseTo(a / b, 9);
      expect(o.share).toBeGreaterThan(0);
      expect(o.share).toBeLessThan(1);
    }
  });

  it('maps the fader to a clockwise knife from 12 o’clock', () => {
    expect(knifeAngle(0)).toBe(0);
    expect(knifeAngle(0.25)).toBeCloseTo(Math.PI / 2);
    expect(knifeAngle(1)).toBeCloseTo(Math.PI * 2);
    expect(sliceShare(0.4)).toBe(0.4);
    expect(sliceShare(1.3)).toBe(1);
    expect(cutError(0.3, 1 / 3)).toBeCloseTo(1 / 30);
  });

  it('gives round points by closeness, sharing ties', () => {
    expect(cutPoints([0.02, 0.1, 0.01, 0.05])).toEqual([2, 0, 3, 1]);
    expect(cutPoints([0.02, 0.02, 0.3, 0.05])).toEqual([3, 3, 0, 1]);
    expect(cutPoints([0.1, 0.2])).toEqual([3, 2]);
  });

  it('breaks equal points by total error', () => {
    const [a, b, c] = sliceScores([6, 6, 7], [0.3, 0.1, 0.9]) as [number, number, number];
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('has computer players cut sensibly: sharp ones close, sleepy ones looser, all in time', () => {
    const rng = createRng(5);
    const avg = (skill: number) => {
      let sum = 0;
      for (let i = 0; i < 2000; i++) {
        const o = ORDERS[i % ORDERS.length];
        const c = cpuCut(rng, o?.share ?? 0.5, skill);
        expect(c.value).toBeGreaterThanOrEqual(0);
        expect(c.value).toBeLessThanOrEqual(1);
        expect(c.at).toBeGreaterThan(1);
        expect(c.at).toBeLessThan(SLICE.cutTime);
        sum += cutError(c.value, o?.share ?? 0.5);
      }
      return sum / 2000;
    };
    const sharp = avg(1);
    const mid = avg(0.55);
    const sleepy = avg(0.2);
    expect(sharp).toBeLessThan(0.02);
    expect(mid).toBeGreaterThan(sharp);
    expect(mid).toBeLessThan(0.04);
    expect(sleepy).toBeGreaterThan(mid);
    expect(sleepy).toBeLessThan(0.06);
  });

  it('lets sharp computer players beat sleepy ones over a game, but not every time', () => {
    let sharpWins = 0;
    const games = 400;
    for (let g = 0; g < games; g++) {
      const rng = createRng(1000 + g);
      const skills = [0.85, 0.55, 0.55, 0.3];
      const points = skills.map(() => 0);
      const err = skills.map(() => 0);
      for (const o of planOrders(rng)) {
        const errors = skills.map((k) => cutError(cpuCut(rng, o.share, k).value, o.share));
        cutPoints(errors).forEach((p, i) => {
          points[i] = (points[i] ?? 0) + p;
          err[i] = (err[i] ?? 0) + (errors[i] ?? 0);
        });
      }
      const scores = sliceScores(points, err);
      if (scores.indexOf(Math.max(...scores)) === 0) sharpWins++;
    }
    expect(sharpWins / games).toBeGreaterThan(0.35);
    expect(sharpWins / games).toBeLessThan(0.85);
  });
});
