import { describe, expect, it } from 'vitest';
import { CHANGES, DIFFERENT, THINGS, THING_SIZE, cpuAnswer, differentScores, planGame, roundPoints, spotChance } from '../src/game/minigames/different';
import { createRng } from '../src/game/rng';

describe("something's off", () => {
  it('has ten things and five kinds of change', () => {
    expect(THINGS).toHaveLength(10);
    expect(THING_SIZE).toHaveLength(10);
    expect(CHANGES).toHaveLength(5);
  });

  it('changes a different thing every round, each kind of change once, with six options', () => {
    for (let seed = 1; seed < 80; seed++) {
      const plan = planGame(createRng(seed));
      expect(plan).toHaveLength(DIFFERENT.rounds);
      expect(new Set(plan.map((r) => r.thing)).size).toBe(DIFFERENT.rounds);
      expect(new Set(plan.map((r) => r.change)).size).toBe(CHANGES.length);
      for (const r of plan) {
        expect(r.options).toHaveLength(DIFFERENT.options);
        expect(new Set(r.options).size).toBe(DIFFERENT.options);
        expect(r.options[r.answer]).toBe(r.thing);
        for (const o of r.options) {
          expect(o).toBeGreaterThanOrEqual(0);
          expect(o).toBeLessThan(THINGS.length);
        }
        expect([-1, 1]).toContain(r.dir);
      }
    }
  });

  it('gets subtler: smaller changes on smaller things as the rounds go on', () => {
    for (let seed = 1; seed < 40; seed++) {
      const plan = planGame(createRng(seed));
      const first = plan[0];
      const last = plan[plan.length - 1];
      if (!first || !last) throw new Error('no rounds');
      expect(first.amount).toBe(1);
      expect(last.amount).toBeCloseTo(DIFFERENT.subtlest);
      expect(THING_SIZE[first.thing]).toBe(1);
      expect(THING_SIZE[last.thing]).toBe(3);
      for (let i = 1; i < plan.length; i++) expect((plan[i] as { amount: number }).amount).toBeLessThan((plan[i - 1] as { amount: number }).amount);
    }
  });

  it('gives 3, 2, 1 to the fastest right answers, nothing to wrong or missing ones', () => {
    expect(roundPoints([2.1, null, 1.4, 3])).toEqual([2, 0, 3, 1]);
    expect(roundPoints([null, null, null, null])).toEqual([0, 0, 0, 0]);
    expect(roundPoints([1, 1, 2])).toEqual([3, 3, 1]);
  });

  it('breaks equal points by total answer time', () => {
    const [a, b, c] = differentScores([8, 8, 9], [10, 7, 30]) as [number, number, number];
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('lets sharp computer players spot more, and sooner, than sleepy ones', () => {
    expect(spotChance(1, 0)).toBeGreaterThan(spotChance(0, 0));
    expect(spotChance(0.5, 1)).toBeLessThan(spotChance(0.5, 0));
    const rng = createRng(7);
    const plan = planGame(rng);
    for (const r of plan) {
      const a = cpuAnswer(rng, r, 0.9);
      expect(a.pick).toBeGreaterThanOrEqual(0);
      expect(a.pick).toBeLessThan(DIFFERENT.options);
      expect(a.at).toBeGreaterThan(0);
      expect(a.at).toBeLessThan(DIFFERENT.answerTime);
    }
  });

  it('plays believably CPU against CPU: sharp beats average beats sleepy, and nobody is hopeless', () => {
    const skills = [0.15, 0.5, 0.6, 0.95];
    const totals = skills.map(() => 0);
    const games = 400;
    const rng = createRng(99);
    let sharpWins = 0;
    for (let g = 0; g < games; g++) {
      const plan = planGame(rng);
      const points = skills.map(() => 0);
      for (const r of plan) {
        const rightAt = skills.map((s) => {
          const a = cpuAnswer(rng, r, s);
          return a.pick === r.answer && a.at <= DIFFERENT.answerTime ? a.at : null;
        });
        roundPoints(rightAt).forEach((p, i) => (points[i] = (points[i] ?? 0) + p));
      }
      points.forEach((p, i) => (totals[i] = (totals[i] ?? 0) + p));
      if ((points[3] ?? 0) >= Math.max(...points)) sharpWins++;
    }
    const avg = totals.map((t) => t / games);
    expect(avg[3]).toBeGreaterThan(avg[1] as number);
    expect(avg[1]).toBeGreaterThan(avg[0] as number);
    expect(avg[0]).toBeGreaterThan(1.5); // a sleepy CPU still picks up a few points
    expect(sharpWins / games).toBeGreaterThan(0.45);
    expect(sharpWins / games).toBeLessThan(0.95); // but it can be beaten
  });
});
