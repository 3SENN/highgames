import { describe, expect, it } from 'vitest';
import {
  PILLOW,
  type Fort,
  cpuDoubles,
  cpuPillowGap,
  fortScore,
  newFort,
  pillowScores,
  pressPillow,
  stepFort,
  whoseTurn,
} from '../src/game/minigames/pillowfort';
import { createRng } from '../src/game/rng';

/** A fort with `n` pillows stacked by alternating partners, the last at time `t`. */
function stacked(n: number, t = 10): Fort {
  const f = newFort();
  for (let i = 0; i < n; i++) pressPillow(f, i % 2, t - (n - 1 - i) * 1);
  return f;
}

describe('pillow fort', () => {
  it('stacks a pillow for every press when partners take turns at an easy pace', () => {
    const f = newFort();
    for (let i = 0; i < 10; i++) expect(pressPillow(f, i % 2, i * 0.5)).toBe('stacked');
    expect(f.pillows).toBe(10);
    expect(f.wobble).toBe(0);
    expect(f.slips).toBe(0);
  });

  it('lets either partner start, then tells whose go it is', () => {
    const f = newFort();
    expect(whoseTurn(f)).toBeNull();
    pressPillow(f, 1, 0);
    expect(whoseTurn(f)).toBe(0);
    pressPillow(f, 0, 1);
    expect(whoseTurn(f)).toBe(1);
  });

  it('wobbles instead of stacking when the same partner presses twice', () => {
    const f = stacked(4);
    const before = f.pillows;
    expect(pressPillow(f, 1, 11)).toBe('same');
    expect(f.pillows).toBe(before);
    expect(f.wobble).toBeGreaterThan(0);
    expect(whoseTurn(f)).toBe(0); // still the partner's go
  });

  it('wobbles when pressed before the last pillow settled', () => {
    const f = stacked(4);
    expect(pressPillow(f, 0, 10 + PILLOW.minGap / 2)).toBe('fast');
    expect(f.pillows).toBe(4);
    expect(f.wobble).toBeGreaterThan(0);
    // Once it settles, the same partner can go.
    expect(pressPillow(f, 0, 10 + PILLOW.minGap + 0.01)).toBe('stacked');
  });

  it('knocks the top pillow off when it wobbles too much, then re-fluffs for a moment', () => {
    const f = stacked(6);
    const results = [pressPillow(f, 1, 11), pressPillow(f, 1, 11.1)];
    expect(results).toEqual(['same', 'tumble']);
    expect(f.pillows).toBe(5);
    expect(f.tumbles).toBe(1);
    expect(f.wobble).toBe(PILLOW.afterTumble);
    expect(pressPillow(f, 0, 11.2)).toBe('ignored');
    stepFort(f, PILLOW.fluff + 0.01);
    expect(pressPillow(f, 0, 12)).toBe('stacked');
  });

  it('settles over time, so slips far apart never knock anything off', () => {
    const f = stacked(6);
    for (let i = 0; i < 10; i++) {
      expect(pressPillow(f, f.last as number, 11 + i * 5)).not.toBe('tumble');
      stepFort(f, 5);
      expect(f.wobble).toBe(0);
    }
    expect(f.pillows).toBe(6);
  });

  it('gets touchier as it grows', () => {
    const low = stacked(2);
    const high = stacked(30, 40);
    pressPillow(low, 1, 20);
    pressPillow(high, 1, 50);
    expect(high.wobble).toBeGreaterThan(low.wobble);
  });

  it('cannot wobble an empty floor', () => {
    const f = newFort();
    expect(pressPillow(f, 0, 0.0)).toBe('stacked');
    const g = newFort();
    g.last = 0;
    expect(pressPillow(g, 0, 1)).toBe('same');
    expect(g.wobble).toBe(0);
    expect(g.pillows).toBe(0);
  });

  it('lets a team of one press on its own, as long as it does not rush', () => {
    const f = newFort();
    expect(pressPillow(f, 0, 0, true)).toBe('stacked');
    expect(pressPillow(f, 0, 1, true)).toBe('stacked');
    expect(pressPillow(f, 0, 1.05, true)).toBe('fast');
  });

  it('gives both partners the same score, the taller fort more, and breaks ties by fewer tumbles', () => {
    const a = { ...newFort(), pillows: 12, tumbles: 3 };
    const b = { ...newFort(), pillows: 12, tumbles: 1 };
    const c = { ...newFort(), pillows: 9 };
    const s = pillowScores([a, c], [[0, 2], [1, 3]], 4);
    expect(s[0]).toBe(s[2]);
    expect(s[1]).toBe(s[3]);
    expect(s[0]).toBeGreaterThan(s[1] as number);
    expect(fortScore(b)).toBeGreaterThan(fortScore(a));
    expect(fortScore(a)).toBeGreaterThan(fortScore({ ...newFort(), pillows: 11 }));
  });
});

describe('pillow fort computer players', () => {
  it('sharp ones keep a steady rhythm above the settle time; sleepy ones are slower', () => {
    const rng = createRng(3);
    const sharp = Array.from({ length: 400 }, () => cpuPillowGap(rng, 1));
    const sleepy = Array.from({ length: 400 }, () => cpuPillowGap(rng, 0));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(sharp.filter((g) => g >= PILLOW.minGap).length / sharp.length).toBeGreaterThan(0.9);
    expect(avg(sleepy)).toBeGreaterThan(avg(sharp));
    const doubles = (skill: number) => Array.from({ length: 2000 }, () => cpuDoubles(rng, skill)).filter(Boolean).length;
    expect(doubles(0)).toBeGreaterThan(doubles(1));
  });

  it('a sharp computer pair builds a taller fort than a sleepy one over a whole game', () => {
    const play = (skill: number, seed: number) => {
      const rng = createRng(seed);
      const f = newFort();
      let t = 0;
      let next = 0.5;
      let who = 0;
      const dt = 1 / 60;
      while (t < PILLOW.duration) {
        if (t >= next) {
          const r = pressPillow(f, who, t);
          if (r === 'stacked') {
            if (cpuDoubles(rng, skill)) next = t + 0.3;
            else {
              who = 1 - who;
              next = t + cpuPillowGap(rng, skill);
            }
          } else if (r === 'same') {
            who = 1 - who;
            next = t + cpuPillowGap(rng, skill);
          } else next = Math.max(t, f.lastAt + PILLOW.minGap) + 0.05 + f.fluff;
        }
        stepFort(f, dt);
        t += dt;
      }
      return f.pillows;
    };
    let sharp = 0;
    let sleepy = 0;
    for (let seed = 1; seed <= 12; seed++) {
      sharp += play(1, seed);
      sleepy += play(0, seed);
    }
    expect(sharp / 12).toBeGreaterThan(sleepy / 12);
    // A sharp pair stays within a sensible height for the camera.
    expect(sharp / 12).toBeLessThan(65);
    expect(sleepy / 12).toBeGreaterThan(10);
  });
});
