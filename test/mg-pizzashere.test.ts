import { describe, expect, it } from 'vitest';
import { FAKES, PIZZA, type TapResult, cpuRound, judgeTap, pizzaScores, planRound, roundPoints } from '../src/game/minigames/pizzashere';
import { createRng } from '../src/game/rng';

describe("pizza's here", () => {
  it('plans a few noises, never the same twice in a row, then the doorbell', () => {
    for (let seed = 1; seed < 80; seed++) {
      const rng = createRng(seed);
      for (let round = 0; round < PIZZA.rounds; round++) {
        const plan = planRound(rng, round);
        const [lo, hi] = PIZZA.fakes[round] as readonly [number, number];
        expect(plan.fakes.length).toBeGreaterThanOrEqual(lo);
        expect(plan.fakes.length).toBeLessThanOrEqual(hi);
        let prev = 0;
        plan.fakes.forEach((f, i) => {
          expect(FAKES).toContain(f.kind);
          expect(f.at).toBeGreaterThan(prev);
          if (i > 0) expect(f.kind).not.toBe(plan.fakes[i - 1]?.kind);
          prev = f.at;
        });
        if (plan.fakes.length > 0) expect(plan.bellAt - prev).toBeGreaterThanOrEqual(PIZZA.bellGap[0] - 1e-9);
        else expect(plan.bellAt).toBeGreaterThanOrEqual(PIZZA.firstEvent[0]);
        expect(plan.bellAt).toBeLessThan(12);
      }
    }
  });

  it('keeps the whole game short', () => {
    const rng = createRng(4);
    let total = 0;
    for (let round = 0; round < PIZZA.rounds; round++) total += planRound(rng, round).bellAt + PIZZA.window + 1.4;
    expect(total).toBeGreaterThan(20);
    expect(total).toBeLessThan(60);
  });

  it('takes half the round trip off, and calls taps before the doorbell early', () => {
    expect(judgeTap(1300, 1000, 80)).toBe(260);
    expect(judgeTap(1030, 1000, 80)).toBe('early');
    expect(judgeTap(5000, Infinity, 0)).toBe('early');
  });

  it('gives the quickest tap the round and costs early ones a point', () => {
    expect(roundPoints([320, 'early', 280, null])).toEqual([0, PIZZA.falseStart, PIZZA.win, 0]);
    expect(roundPoints([300, 300, null])).toEqual([PIZZA.win, PIZZA.win, 0]);
    expect(roundPoints(['early', null])).toEqual([PIZZA.falseStart, 0]);
  });

  it('ranks by points, then total reaction time', () => {
    const rounds: TapResult[][] = [
      [300, 400],
      [500, 290],
      [null, 'early'],
    ];
    const [a, b] = pizzaScores(rounds, 2) as [number, number];
    // a: 2 points; b: 2 - 1 = 1 point.
    expect(a).toBeGreaterThan(b);
  });

  it('plays believably CPU against CPU: sharp ones win most, sleepy ones jump up more', () => {
    const skills = [0.1, 0.5, 0.6, 0.95];
    const wins = skills.map(() => 0);
    const early = skills.map(() => 0);
    const points = skills.map(() => 0);
    const rng = createRng(17);
    const games = 500;
    for (let g = 0; g < games; g++) {
      for (let round = 0; round < PIZZA.rounds; round++) {
        const plan = planRound(rng, round);
        const results: TapResult[] = skills.map((s) => {
          const c = cpuRound(rng, plan, s);
          if (c.jumpAt !== null) return 'early';
          return c.reactMs <= PIZZA.window * 1000 ? c.reactMs : null;
        });
        roundPoints(results).forEach((p, i) => {
          points[i] = (points[i] ?? 0) + p;
          if (p === PIZZA.win) wins[i] = (wins[i] ?? 0) + 1;
          if (p === PIZZA.falseStart) early[i] = (early[i] ?? 0) + 1;
        });
      }
    }
    const perGame = (v: number) => v / games;
    expect(wins[3]).toBeGreaterThan(wins[1] as number);
    expect(wins[1]).toBeGreaterThan(wins[0] as number);
    expect(early[0]).toBeGreaterThan(early[3] as number);
    // An average CPU jumps up less than once a game, and still wins a round now and then.
    expect(perGame(early[1] as number)).toBeLessThan(1);
    expect(perGame(wins[1] as number)).toBeGreaterThan(0.3);
    // A sharp one wins most rounds against them, but not all.
    expect(perGame(wins[3] as number)).toBeGreaterThan(2.5);
    expect(perGame(wins[3] as number)).toBeLessThan(5.5);
    // Average CPU reaction is beatable by an alert person (~350 ms).
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const c = cpuRound(rng, { fakes: [], bellAt: 1 }, 0.55);
      sum += c.reactMs;
      n++;
    }
    expect(sum / n).toBeGreaterThan(350);
    expect(sum / n).toBeLessThan(480);
  });
});
