import { describe, expect, it } from 'vitest';
import {
  SNACK,
  applyPass,
  bowlScore,
  catchWindow,
  cpuCatchOffset,
  cpuTossValue,
  flightTime,
  judgeCatch,
  judgeToss,
  meterAt,
  newBowl,
  passChips,
  snackScores,
  sweepSpeed,
} from '../src/game/minigames/snackpass';
import { createRng } from '../src/game/rng';

describe('snack pass meter', () => {
  it('sweeps up to full, back down to empty, and again', () => {
    const up = 1 / sweepSpeed(0);
    expect(meterAt(0, 0)).toBe(0);
    expect(meterAt(up / 2, 0)).toBeCloseTo(0.5);
    expect(meterAt(up, 0)).toBeCloseTo(1);
    expect(meterAt(up * 1.5, 0)).toBeCloseTo(0.5);
    expect(meterAt(up * 2, 0)).toBeCloseTo(0);
    expect(meterAt(up * 2.25, 0)).toBeCloseTo(0.25);
    for (let t = 0; t < 5; t += 0.07) {
      expect(meterAt(t, 3)).toBeGreaterThanOrEqual(0);
      expect(meterAt(t, 3)).toBeLessThanOrEqual(1);
    }
  });

  it('gets faster with a streak, up to a cap', () => {
    expect(sweepSpeed(3)).toBeGreaterThan(sweepSpeed(0));
    expect(sweepSpeed(50)).toBe(sweepSpeed(SNACK.sweepCap));
  });
});

describe('snack pass tosses and catches', () => {
  it('judges the toss by how close it is to the sweet spot', () => {
    expect(judgeToss(SNACK.sweet)).toBe('perfect');
    expect(judgeToss(SNACK.sweet + SNACK.perfect)).toBe('perfect');
    expect(judgeToss(SNACK.sweet - SNACK.good)).toBe('good');
    expect(judgeToss(SNACK.sweet + SNACK.good + 0.01)).toBe('sloppy');
    expect(judgeToss(0.2)).toBe('sloppy');
  });

  it('floats soft lobs longer than hard throws', () => {
    expect(flightTime(0.3)).toBeGreaterThan(flightTime(SNACK.sweet));
    expect(flightTime(1)).toBeLessThan(flightTime(SNACK.sweet));
    expect(flightTime(SNACK.sweet)).toBe(SNACK.flight);
  });

  it('judges the catch by its timing around the landing', () => {
    expect(judgeCatch(0, 'perfect')).toBe('clean');
    expect(judgeCatch(-SNACK.clean, 'good')).toBe('clean');
    expect(judgeCatch(SNACK.window, 'good')).toBe('good');
    expect(judgeCatch(-SNACK.window - 0.01, 'good')).toBe('miss');
    expect(judgeCatch(SNACK.window + 0.01, 'good')).toBe('miss');
    expect(judgeCatch(null, 'perfect')).toBe('miss');
  });

  it('makes sloppy tosses harder to catch', () => {
    expect(catchWindow('sloppy')).toBeLessThan(catchWindow('perfect'));
    expect(judgeCatch(SNACK.window, 'good')).toBe('good');
    expect(judgeCatch(SNACK.window, 'sloppy')).toBe('miss');
  });
});

describe('snack pass bowl', () => {
  it('adds chips for good passes, more for a streak, up to a cap', () => {
    const b = newBowl();
    expect(applyPass(b, 'perfect', 'clean')).toBe(5);
    expect(applyPass(b, 'perfect', 'clean')).toBe(6);
    expect(applyPass(b, 'good', 'good')).toBe(3 + 2);
    expect(b.streak).toBe(3);
    expect(passChips('perfect', 'clean', 99)).toBe(5 + SNACK.streakCap);
    expect(b.passes).toBe(3);
    expect(b.chips).toBe(16);
  });

  it('spills a chip on a sloppy toss and resets the streak', () => {
    const b = { ...newBowl(), chips: 10, streak: 2 };
    expect(applyPass(b, 'sloppy', 'good')).toBe(-1 + 1 + 2);
    expect(b.streak).toBe(0);
    expect(applyPass(b, 'sloppy', 'good')).toBe(0);
    const c = { ...newBowl(), chips: 3 };
    expect(applyPass(c, 'sloppy', 'good')).toBe(0);
  });

  it('spills a handful when the bowl is dropped, but never below zero', () => {
    const b = { ...newBowl(), chips: 10, streak: 4 };
    expect(applyPass(b, 'perfect', 'miss')).toBe(-SNACK.spill);
    expect(b.chips).toBe(10 - SNACK.spill);
    expect(b.streak).toBe(0);
    expect(b.drops).toBe(1);
    const empty = newBowl();
    expect(applyPass(empty, 'sloppy', 'miss')).toBe(0);
    expect(empty.chips).toBe(0);
  });

  it('gives both partners the same score, more chips more, ties broken by passes', () => {
    const a = { ...newBowl(), chips: 30, passes: 8 };
    const b = { ...newBowl(), chips: 30, passes: 10 };
    const s = snackScores([a, { ...newBowl(), chips: 12 }], [[0, 1], [2, 3]], 4);
    expect(s[0]).toBe(s[1]);
    expect(s[2]).toBe(s[3]);
    expect(s[0]).toBeGreaterThan(s[2] as number);
    expect(bowlScore(b)).toBeGreaterThan(bowlScore(a));
  });
});

describe('snack pass computer players', () => {
  it('sharp ones toss and catch well; sleepy ones fumble more', () => {
    const rng = createRng(11);
    const rate = (skill: number) => {
      let perfect = 0;
      let caught = 0;
      for (let i = 0; i < 1000; i++) {
        const toss = judgeToss(cpuTossValue(rng, skill));
        if (toss === 'perfect') perfect++;
        if (judgeCatch(cpuCatchOffset(rng, skill, toss), toss) !== 'miss') caught++;
      }
      return { perfect: perfect / 1000, caught: caught / 1000 };
    };
    const sharp = rate(1);
    const sleepy = rate(0);
    expect(sharp.perfect).toBeGreaterThan(0.8);
    expect(sharp.caught).toBeGreaterThan(0.95);
    expect(sleepy.perfect).toBeLessThan(sharp.perfect);
    expect(sleepy.caught).toBeLessThan(sharp.caught);
    expect(sleepy.caught).toBeGreaterThan(0.4);
  });

  it('keeps computer tosses on the meter', () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const v = cpuTossValue(rng, 0);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
