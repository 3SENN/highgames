import { describe, expect, it } from 'vitest';
import {
  LEGS,
  type Pair,
  cpuDoubles,
  cpuStepGap,
  isStumble,
  newPair,
  pressStep,
  progress,
  raceScore,
  raceScores,
  stepPair,
  whoseStep,
} from '../src/game/minigames/threelegged';
import { createRng } from '../src/game/rng';

describe('three-legged race', () => {
  it('takes a step for every press when partners alternate at an easy pace', () => {
    const p = newPair();
    for (let i = 0; i < 10; i++) expect(pressStep(p, i % 2, i * 0.4)).toBe('step');
    expect(p.steps).toBe(10);
    expect(p.stumbles).toBe(0);
  });

  it('lets either partner start, then tells whose step it is', () => {
    const p = newPair();
    expect(whoseStep(p)).toBeNull();
    pressStep(p, 1, 0);
    expect(whoseStep(p)).toBe(0);
    pressStep(p, 0, 0.5);
    expect(whoseStep(p)).toBe(1);
  });

  it('stumbles when the same partner steps twice in a row', () => {
    const p = newPair();
    pressStep(p, 0, 1);
    expect(pressStep(p, 0, 2)).toBe('same');
    expect(p.steps).toBe(1);
    expect(p.stumbles).toBe(1);
    expect(p.down).toBe(LEGS.fall);
  });

  it('stumbles when both press at once, even out of order', () => {
    const p = newPair();
    pressStep(p, 0, 1);
    expect(pressStep(p, 1, 1 + LEGS.together / 2)).toBe('together');
    const q = newPair();
    pressStep(q, 0, 1);
    // The partner's press happened a touch earlier but arrived later (a slower phone).
    expect(pressStep(q, 1, 1 - LEGS.together / 2)).toBe('together');
  });

  it('stumbles when the steps come too fast, so mashing does not help', () => {
    const p = newPair();
    pressStep(p, 0, 1);
    expect(pressStep(p, 1, 1 + (LEGS.together + LEGS.rush) / 2)).toBe('rush');
    const q = newPair();
    pressStep(q, 0, 1);
    expect(pressStep(q, 1, 1 + LEGS.rush + 0.01)).toBe('step');
  });

  it('ignores steps while the pair is on the grass, then either partner may start again', () => {
    const p = newPair();
    pressStep(p, 0, 1);
    pressStep(p, 0, 1.5);
    expect(pressStep(p, 1, 1.8)).toBe('down');
    expect(whoseStep(p)).toBeNull();
    stepPair(p, LEGS.fall);
    expect(p.down).toBe(0);
    expect(pressStep(p, 0, 2.6)).toBe('step');
    expect(isStumble('rush')).toBe(true);
    expect(isStumble('down')).toBe(false);
  });

  it('runs faster with a quicker rhythm', () => {
    const run = (gap: number) => {
      const p = newPair();
      let t = 0;
      let who = 0;
      while (p.finishedAt === null && t < 100) {
        pressStep(p, who, t);
        who = 1 - who;
        t += gap;
      }
      return p.finishedAt ?? Infinity;
    };
    expect(run(0.25)).toBeLessThan(run(0.4));
    expect(run(0.4)).toBeLessThan(run(0.7));
  });

  it('crosses the ribbon after the whole course and then ignores presses', () => {
    const p = newPair();
    let r = 'step';
    for (let i = 0; i < LEGS.course; i++) r = pressStep(p, i % 2, i * 0.3);
    expect(r).toBe('finish');
    expect(p.finishedAt).toBeCloseTo((LEGS.course - 1) * 0.3);
    expect(progress(p)).toBe(1);
    expect(pressStep(p, 0, 100)).toBe('done');
  });

  it('lets a pair of one step on its own, as long as it does not rush', () => {
    const p = newPair();
    expect(pressStep(p, 0, 0, true)).toBe('step');
    expect(pressStep(p, 0, 0.5, true)).toBe('step');
    expect(pressStep(p, 0, 0.6, true)).toBe('rush');
  });

  it('ranks finishers by time ahead of everyone still running, and gives partners the same score', () => {
    const fast: Pair = { ...newPair(), steps: LEGS.course, finishedAt: 15 };
    const slow: Pair = { ...newPair(), steps: LEGS.course, finishedAt: 18 };
    const out: Pair = { ...newPair(), steps: LEGS.course - 1 };
    expect(raceScore(fast)).toBeGreaterThan(raceScore(slow));
    expect(raceScore(slow)).toBeGreaterThan(raceScore(out));
    const s = raceScores([fast, out], [[0, 3], [1, 2]], 4);
    expect(s[0]).toBe(s[3]);
    expect(s[1]).toBe(s[2]);
    expect(s[0]).toBeGreaterThan(s[1] as number);
  });
});

/** A whole race for a computer pair: each partner steps a CPU gap after the other. Returns the finishing time. */
function cpuRace(skill: number, seed: number): { time: number; stumbles: number } {
  const rng = createRng(seed);
  const p = newPair();
  const dt = 1 / 60;
  let t = 0;
  let next = 0.3 + rng() * 0.3;
  let who = 0;
  let double = false;
  while (t < LEGS.duration && p.finishedAt === null) {
    stepPair(p, dt);
    t += dt;
    if (p.down > 0) {
      next = t + p.down + 0.2 + rng() * 0.3;
      continue;
    }
    if (t < next) continue;
    const r = pressStep(p, double ? 1 - who : who, t);
    if (r === 'step' && !double && cpuDoubles(rng, skill)) {
      double = true;
      next = t + 0.25;
      who = 1 - who;
      continue;
    }
    double = false;
    if (r === 'step') who = 1 - who;
    else who = 0;
    next = t + cpuStepGap(rng, skill);
  }
  return { time: p.finishedAt ?? Infinity, stumbles: p.stumbles };
}

describe('three-legged race computer players', () => {
  it('sharp ones keep a quick rhythm clear of the rush limit; sleepy ones are slower and trip more', () => {
    const rng = createRng(5);
    const sharp = Array.from({ length: 500 }, () => cpuStepGap(rng, 1));
    const sleepy = Array.from({ length: 500 }, () => cpuStepGap(rng, 0));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(sharp.filter((g) => g >= LEGS.rush).length / sharp.length).toBeGreaterThan(0.95);
    expect(sleepy.filter((g) => g < LEGS.rush).length).toBeGreaterThan(sharp.filter((g) => g < LEGS.rush).length);
    expect(avg(sleepy)).toBeGreaterThan(avg(sharp) + 0.15);
  });

  it('computer pairs finish in time, and sharp pairs beat average ones beat sleepy ones', () => {
    const avgTime = (skill: number) => {
      let sum = 0;
      let late = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const r = cpuRace(skill, seed * 7 + Math.round(skill * 100));
        if (r.time >= LEGS.duration) late++;
        sum += Math.min(r.time, LEGS.duration + 5);
      }
      expect(late).toBeLessThanOrEqual(skill >= 0.5 ? 0 : 2);
      return sum / 30;
    };
    const sharp = avgTime(1);
    const mid = avgTime(0.5);
    const sleepy = avgTime(0);
    expect(sharp).toBeGreaterThan(13);
    expect(sharp).toBeLessThan(21);
    expect(mid).toBeGreaterThan(sharp + 3);
    expect(sleepy).toBeGreaterThan(mid + 3);
    expect(sleepy).toBeLessThan(LEGS.duration - 2);
  });

  it('sharp pairs win nearly every head-to-head against sleepy pairs, average ones mostly', () => {
    let sharpWins = 0;
    let midWins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      if (cpuRace(1, seed).time < cpuRace(0, seed + 1000).time) sharpWins++;
      if (cpuRace(0.5, seed).time < cpuRace(0, seed + 1000).time) midWins++;
    }
    expect(sharpWins).toBeGreaterThanOrEqual(38);
    expect(midWins).toBeGreaterThan(24);
  });
});
