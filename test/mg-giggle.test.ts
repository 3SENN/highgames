import { describe, expect, it } from 'vitest';
import {
  GIGGLE,
  SILLIES,
  composure,
  cpuWobble,
  giggleScores,
  newCpuSitter,
  newSitter,
  sillyAt,
  sillySchedule,
  stepSitter,
  threshold,
} from '../src/game/minigames/giggle';
import { createRng } from '../src/game/rng';

/** Runs one sitter with a fixed wobble from t0 for `seconds`; returns the time it cracked (or null). */
function run(wobble: number, t0: number, seconds: number, silly = false): number | null {
  const s = newSitter();
  const dt = 1 / 60;
  for (let t = t0; t < t0 + seconds; t += dt) stepSitter(s, wobble, dt, t, silly);
  return s.crackedAt;
}

describe('giggle fit', () => {
  it('lets less wobble slide as the show goes on, and even less during a silly moment', () => {
    expect(threshold(GIGGLE.duration, false)).toBeLessThan(threshold(0, false));
    expect(threshold(10, true)).toBeLessThan(threshold(10, false));
  });

  it('cracks you up after a moment of wobbling, but not after a twitch', () => {
    const cracked = run(0.8, 5, 2);
    expect(cracked).not.toBeNull();
    expect((cracked as number) - 5).toBeLessThan(0.6);
    expect(run(0.8, 5, 0.12)).toBeNull();
    expect(run(0.05, 5, 30)).toBeNull();
  });

  it('calms down again while you hold still', () => {
    const s = newSitter();
    stepSitter(s, 0.9, 0.15, 5, false);
    const nervous = s.giggle;
    expect(nervous).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) stepSitter(s, 0.02, 1 / 60, 5.2 + i / 60, false);
    expect(s.giggle).toBeLessThan(nervous);
    expect(s.crackedAt).toBeNull();
  });

  it('ignores wobbling while everyone gets comfy', () => {
    expect(run(1, 0, GIGGLE.settle - 0.05)).toBeNull();
  });

  it('cracks a mild wobble during a silly moment that would pass otherwise', () => {
    const w = threshold(20, false) - 0.02;
    expect(run(w, 20, 2, false)).toBeNull();
    expect(run(w, 20, 2, true)).not.toBeNull();
  });

  it('scores the seconds each player kept a straight face', () => {
    const a = { giggle: 1, crackedAt: 12.34 };
    const b = newSitter();
    expect(giggleScores([a, b], 31)).toEqual([12.3, 31]);
    expect(composure(a)).toBe(0);
    expect(composure(b)).toBe(1);
  });

  it('plans silly moments through the show, each kind once before repeats, never twice in a row', () => {
    for (let seed = 1; seed < 30; seed++) {
      const plan = sillySchedule(createRng(seed));
      expect(plan.length).toBeGreaterThanOrEqual(5);
      const firstRound = plan.slice(0, SILLIES.length);
      expect(new Set(firstRound.map((m) => m.kind)).size).toBe(firstRound.length);
      plan.forEach((m, i) => {
        expect(m.at).toBeLessThan(GIGGLE.duration);
        const next = plan[i + 1];
        if (next) {
          expect(next.at - m.at).toBeGreaterThanOrEqual(GIGGLE.sillyLength + GIGGLE.gap[0]);
          expect(next.kind).not.toBe(m.kind);
        }
      });
      const first = plan[0];
      expect(first && sillyAt(plan, first.at + 0.1)).toBe(first);
      expect(sillyAt(plan, 0.5)).toBeNull();
    }
  });

  it('has sleepy computer players crack sooner than sharp ones, and silly moments set them off', () => {
    const crackTime = (skill: number, seed: number) => {
      const rng = createRng(seed);
      const plan = sillySchedule(rng);
      const s = newSitter();
      const c = newCpuSitter();
      const dt = 1 / 30;
      for (let t = 0; t < GIGGLE.duration && s.crackedAt === null; t += dt) {
        const silly = sillyAt(plan, t) !== null;
        stepSitter(s, cpuWobble(c, rng, skill, dt, t, silly), dt, t, silly);
      }
      return s.crackedAt ?? GIGGLE.duration;
    };
    let sleepy = 0;
    let sharp = 0;
    for (let seed = 1; seed <= 150; seed++) {
      sleepy += crackTime(0, seed);
      sharp += crackTime(1, seed);
    }
    expect(sharp).toBeGreaterThan(sleepy * 1.4);

    const fits = (silly: boolean) => {
      const rng = createRng(7);
      let n = 0;
      for (let i = 0; i < 4000; i++) {
        const c = newCpuSitter();
        cpuWobble(c, rng, 0.5, 0.1, 20, silly);
        if (c.fit > 0) n++;
      }
      return n;
    };
    expect(fits(true)).toBeGreaterThan(fits(false) * 3);
  });
});
