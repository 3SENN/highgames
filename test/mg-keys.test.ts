import { describe, expect, it } from 'vitest';
import { KEYS, SPOTS, cpuGuess, keysScores, planRound, roundPoints } from '../src/game/minigames/keys';
import { createRng } from '../src/game/rng';

describe('where are my keys', () => {
  it('has six labelled spots', () => {
    expect(SPOTS).toHaveLength(6);
  });

  it('tucks every set of keys into a different spot, then lets the cat move some', () => {
    for (let seed = 1; seed < 60; seed++) {
      for (let round = 0; round < KEYS.rounds; round++) {
        const plan = planRound(createRng(seed * 7 + round), 4, round);
        expect(plan.hidden).toHaveLength(4);
        expect(new Set(plan.hidden).size).toBe(4);
        expect(plan.moves).toHaveLength(KEYS.catMoves[round] as number);
        expect(new Set(plan.moves.map((m) => m.seat)).size).toBe(plan.moves.length);
        const where = [...plan.hidden];
        for (const m of plan.moves) {
          expect(m.from).toBe(where[m.seat]);
          expect(m.to).not.toBe(m.from);
          where[m.seat] = m.to;
        }
        expect(plan.final).toEqual(where);
        for (const s of [...plan.hidden, ...plan.final]) {
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThan(SPOTS.length);
        }
      }
    }
  });

  it('works with fewer players', () => {
    const plan = planRound(createRng(3), 2, 2);
    expect(plan.hidden).toHaveLength(2);
    expect(plan.moves.length).toBeLessThanOrEqual(2);
  });

  it('gives round points by who found their keys first', () => {
    expect(roundPoints([2.1, null, 1.4, 3])).toEqual([3, 0, 4, 2]);
    expect(roundPoints([null, null, null, null])).toEqual([0, 0, 0, 0]);
  });

  it('breaks equal points by total answer time', () => {
    const [a, b, c] = keysScores([8, 8, 9], [10, 7, 30]) as [number, number, number];
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('lets sharp computer players remember better than sleepy ones', () => {
    const rng = createRng(11);
    let sharp = 0;
    let sleepy = 0;
    for (let i = 0; i < 400; i++) {
      const plan = planRound(rng, 4, i % 3);
      const seat = i % 4;
      const a = cpuGuess(rng, plan, seat, 1, 0);
      const b = cpuGuess(rng, plan, seat, 0, 0);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(SPOTS.length);
      if (a === plan.final[seat]) sharp++;
      if (b === plan.final[seat]) sleepy++;
    }
    expect(sharp).toBeGreaterThan(sleepy);
    expect(sharp / 400).toBeGreaterThan(0.75);
  });
});
