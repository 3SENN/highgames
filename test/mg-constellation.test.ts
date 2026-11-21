import { describe, expect, it } from 'vitest';
import { type Pt, STARS, cpuTrace, decorStars, looksFinished, makeConstellation, roundPoints, scoreTrace, segDist } from '../src/game/minigames/constellation';
import { createRng } from '../src/game/rng';

/** A trace straight through the stars, as one stroke with points every `step`. */
function through(stars: readonly Pt[], step = 0.02, offset = { x: 0, y: 0 }): number[] {
  const out: number[] = [];
  stars.forEach((s, i) => {
    if (i === 0) {
      out.push(s.x + offset.x, s.y + offset.y);
      return;
    }
    const a = stars[i - 1] as Pt;
    const n = Math.ceil(Math.hypot(s.x - a.x, s.y - a.y) / step);
    for (let k = 1; k <= n; k++) out.push(a.x + ((s.x - a.x) * k) / n + offset.x, a.y + ((s.y - a.y) * k) / n + offset.y);
  });
  return out;
}

describe('ceiling stars', () => {
  it('makes readable constellations: inside the pad, spaced out, no crossings or near misses', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = createRng(seed);
      const decor = decorStars(rng, 12);
      const size = STARS.sizes[seed % 3] as number;
      const stars = makeConstellation(rng, size, decor);
      expect(stars.length).toBe(size);
      stars.forEach((s, i) => {
        expect(s.x).toBeGreaterThanOrEqual(STARS.margin - 1e-9);
        expect(s.x).toBeLessThanOrEqual(1 - STARS.margin + 1e-9);
        expect(s.y).toBeGreaterThanOrEqual(STARS.margin - 1e-9);
        expect(s.y).toBeLessThanOrEqual(1 - STARS.margin + 1e-9);
        for (const o of stars.slice(i + 1)) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThanOrEqual(STARS.minGap);
        for (const d of decor) expect(Math.hypot(d.x - s.x, d.y - s.y)).toBeGreaterThanOrEqual(0.08);
        // No line passes close to a star it doesn't connect.
        for (let k = 0; k + 1 < stars.length; k++) {
          if (k === i || k + 1 === i) continue;
          expect(segDist(s, stars[k] as Pt, stars[k + 1] as Pt)).toBeGreaterThanOrEqual(0.09);
        }
      });
    }
  });

  it('scores a clean trace near perfect, and a slightly off one a bit lower', () => {
    const stars = makeConstellation(createRng(5), 5);
    const clean = scoreTrace([through(stars)], stars);
    expect(clean.accuracy).toBeGreaterThan(0.97);
    expect(clean.hits.every((h) => h === 1)).toBe(true);
    const off = scoreTrace([through(stars, 0.02, { x: 0.08, y: 0.03 })], stars);
    expect(off.accuracy).toBeLessThan(clean.accuracy);
    expect(off.accuracy).toBeGreaterThan(0.5);
  });

  it('wants the stars in order: backwards scores badly', () => {
    const stars = makeConstellation(createRng(9), 5);
    const back = scoreTrace([through([...stars].reverse())], stars);
    expect(back.accuracy).toBeLessThan(0.65);
  });

  it("doesn't pay for scribbling everywhere or for a tiny tap", () => {
    const stars = makeConstellation(createRng(11), 4);
    const scribble: number[] = [];
    for (let row = 0; row <= 20; row++) {
      const y = row / 20;
      scribble.push(row % 2 ? 1 : 0, y, row % 2 ? 0 : 1, y);
    }
    expect(scoreTrace([scribble], stars).accuracy).toBeLessThan(0.15);
    expect(scoreTrace([[0.5, 0.5]], stars).accuracy).toBe(0);
    expect(scoreTrace([], stars).accuracy).toBe(0);
  });

  it('lets a trace in two strokes count, as long as the order is right', () => {
    const stars = makeConstellation(createRng(14), 6);
    const a = through(stars.slice(0, 3));
    const b = through(stars.slice(2));
    expect(scoreTrace([a, b], stars).accuracy).toBeGreaterThan(0.9);
  });

  it('knows when a trace is finished: every star reached, ending on the last one', () => {
    const stars = makeConstellation(createRng(21), 4);
    expect(looksFinished([through(stars)], stars)).toBe(true);
    expect(looksFinished([through(stars.slice(0, 3))], stars)).toBe(false);
    expect(looksFinished([], stars)).toBe(false);
  });

  it('gives a speed bonus scaled by accuracy', () => {
    expect(roundPoints(1, 0, 8)).toBe(100 + STARS.speedBonus);
    expect(roundPoints(1, 8, 8)).toBe(100);
    expect(roundPoints(0.5, 2, 8)).toBeLessThan(roundPoints(1, 6, 8));
    expect(roundPoints(0, 0, 8)).toBe(0);
  });

  it('has computer players trace believably: sharp ones well, sleepy ones wobbly, all within the time', () => {
    const avg = (skill: number) => {
      let sum = 0;
      let n = 0;
      for (let seed = 1; seed <= 120; seed++) {
        const rng = createRng(seed);
        const round = seed % 3;
        const stars = makeConstellation(rng, STARS.sizes[round] as number);
        const trace = cpuTrace(rng, stars, skill);
        expect(trace.times[trace.times.length - 1] as number).toBeLessThan(STARS.traceTime[round] as number);
        sum += scoreTrace([trace.pts], stars).accuracy;
        n++;
      }
      return sum / n;
    };
    const sleepy = avg(0);
    const middling = avg(0.55);
    const sharp = avg(1);
    expect(sharp).toBeGreaterThan(0.9);
    expect(middling).toBeGreaterThan(0.72);
    expect(middling).toBeLessThan(0.9);
    expect(sleepy).toBeGreaterThan(0.5);
    expect(sleepy).toBeLessThan(middling - 0.08);
  });
});
