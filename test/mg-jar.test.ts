import { describe, expect, it } from 'vitest';
import { FILLINGS, JAR, cpuGuess, cpuSpread, guessPoints, jarScores, packJar, planJar, planJars } from '../src/game/minigames/jar';
import { createRng } from '../src/game/rng';

describe('guess the jar', () => {
  it('fills three different jars with counts in range that clearly differ', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 150; seed++) {
      const jars = planJars(createRng(seed));
      expect(jars.map((j) => j.filling.id)).toEqual(['gummy', 'loops', 'popcorn']);
      for (const j of jars) {
        expect(j.count).toBeGreaterThanOrEqual(j.filling.min);
        expect(j.count).toBeLessThanOrEqual(j.filling.max);
        expect(j.pieces).toHaveLength(j.count);
      }
      for (let a = 0; a < jars.length; a++) {
        for (let b = a + 1; b < jars.length; b++) expect(Math.abs((jars[a]?.count ?? 0) - (jars[b]?.count ?? 0))).toBeGreaterThanOrEqual(JAR.minDiff);
      }
      seen.add(jars.map((j) => j.count).join(','));
    }
    expect(seen.size).toBeGreaterThan(140); // seeded, and different from game to game
  });

  it('packs every piece inside the jar without pieces sitting on top of each other, even when full', () => {
    for (const f of FILLINGS) {
      for (let seed = 1; seed < 25; seed++) {
        const plan = planJar(createRng(seed), f, f.max);
        expect(plan.level).toBeLessThanOrEqual(JAR.height);
        for (const p of plan.pieces) {
          expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(JAR.radius - f.spacing / 2 + 1e-9);
          expect(p.y).toBeGreaterThan(0);
        }
        const ps = plan.pieces;
        let closest = Infinity;
        for (let i = 0; i < ps.length; i++) {
          for (let j = i + 1; j < ps.length; j++) {
            const a = ps[i];
            const b = ps[j];
            if (a && b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
          }
        }
        expect(closest).toBeGreaterThan(Math.min(f.spacing * 0.8, f.layer * 0.78));
      }
    }
  });

  it('fills the jar higher the more there are, so the jar matches its count', () => {
    for (const f of FILLINGS) {
      let last = 0;
      for (let count = f.min; count <= f.max; count += 10) {
        const pieces = packJar(createRng(42), f, count);
        expect(pieces).toHaveLength(count);
        const top = Math.max(...pieces.map((p) => p.y));
        expect(top).toBeGreaterThanOrEqual(last - f.layer * 0.25);
        last = Math.max(last, top);
      }
      const low = planJar(createRng(1), f, f.min).level;
      const high = planJar(createRng(1), f, f.max).level;
      expect(high).toBeGreaterThan(low * 1.6);
    }
  });

  it('gives points by closeness, a bonus for spot on, and nothing for no guess', () => {
    expect(guessPoints([150, 130, 171, 100], 160)).toEqual([3, 1, 2, 0]);
    expect(guessPoints([160, 150, null, 100], 160)).toEqual([3 + JAR.exactBonus, 2, 0, 1]);
    expect(guessPoints([150, 170, 100, null], 160)).toEqual([3, 3, 1, 0]);
  });

  it('breaks equal points by total distance', () => {
    const [a, b] = jarScores([5, 5], [40, 12]) as [number, number];
    expect(b).toBeGreaterThan(a);
  });

  it('has computer players guess believably: sharp ones close, sleepy ones looser', () => {
    const rng = createRng(3);
    const avgOff = (skill: number) => {
      let off = 0;
      for (let i = 0; i < 3000; i++) {
        const count = 50 + Math.floor(rng() * 200);
        const g = cpuGuess(rng, count, skill);
        expect(g.value).toBeGreaterThanOrEqual(1);
        expect(g.value).toBeLessThanOrEqual(999);
        expect(Number.isInteger(g.value)).toBe(true);
        expect(g.at).toBeGreaterThan(2);
        expect(g.at).toBeLessThan(JAR.answerTime);
        off += Math.abs(g.value - count) / count;
      }
      return off / 3000;
    };
    const sharp = avgOff(1);
    const mid = avgOff(0.55);
    const sleepy = avgOff(0.2);
    expect(sharp).toBeLessThan(0.08);
    expect(mid).toBeGreaterThan(sharp);
    expect(mid).toBeLessThan(0.17);
    expect(sleepy).toBeGreaterThan(mid);
    expect(sleepy).toBeLessThan(0.3);
    expect(cpuSpread(0)).toBeGreaterThan(cpuSpread(1));
  });

  it('lets sharp computer players win more often, but not every game', () => {
    let sharpWins = 0;
    const games = 400;
    for (let g = 0; g < games; g++) {
      const rng = createRng(500 + g);
      const skills = [0.85, 0.5, 0.5, 0.3];
      const points = skills.map(() => 0);
      const off = skills.map(() => 0);
      for (const jar of planJars(rng)) {
        const guesses = skills.map((k) => cpuGuess(rng, jar.count, k).value);
        guessPoints(guesses, jar.count).forEach((p, i) => {
          points[i] = (points[i] ?? 0) + p;
          off[i] = (off[i] ?? 0) + Math.abs((guesses[i] ?? 0) - jar.count);
        });
      }
      const scores = jarScores(points, off);
      if (scores.indexOf(Math.max(...scores)) === 0) sharpWins++;
    }
    expect(sharpWins / games).toBeGreaterThan(0.35);
    expect(sharpWins / games).toBeLessThan(0.85);
  });
});
