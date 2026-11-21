import { describe, expect, it } from 'vitest';
import {
  CAT,
  WHO,
  type Suspect,
  candidatesFor,
  cpuVote,
  fit,
  footOf,
  makeClues,
  roundPoints,
  snackerOrder,
  suspectOf,
  suspectsFor,
  topOf,
  whoScores,
} from '../src/game/minigames/whoateit';
import { type Rng, createRng, pick } from '../src/game/rng';
import { type CompanionLook, DEFAULT_LOOK, PART_IDS, SEAT_COLORS } from '../src/shared/look';

function randomLook(rng: Rng): CompanionLook {
  const maybe = <T>(list: readonly T[], p = 0.6): T | null => (rng() < p ? pick(rng, list) : null);
  return {
    ...DEFAULT_LOOK,
    rig: pick(rng, ['A', 'B', 'C'] as const),
    parts: {
      ...DEFAULT_LOOK.parts,
      hat: maybe(PART_IDS.hat, 0.5),
      ears: maybe(PART_IDS.ears, 0.5),
      hair: maybe(PART_IDS.hair, 0.7),
    },
  };
}

function players(rng: Rng, n: number): Suspect[] {
  return Array.from({ length: n }, (_, i) => suspectOf(randomLook(rng), SEAT_COLORS[i] as string));
}

describe('who ate it', () => {
  it('reads the suspect from the look: feet from the body, the shadow from hat, ears or hair', () => {
    const look = (rig: 'A' | 'B' | 'C', hat: string | null, ears: string | null, hair: string | null): CompanionLook => ({
      ...DEFAULT_LOOK,
      rig,
      parts: { ...DEFAULT_LOOK.parts, hat, ears, hair },
    });
    expect(footOf(look('C', null, null, null))).toBe('small');
    expect(footOf(look('A', null, null, null))).toBe('medium');
    expect(footOf(look('B', null, null, null))).toBe('big');
    expect(topOf(look('A', 'hat-wizard', null, 'hair-bun'))).toBe('spiky');
    expect(topOf(look('A', null, 'ears-cat', 'hair-bun'))).toBe('spiky');
    expect(topOf(look('A', null, null, 'hair-bun'))).toBe('bumpy');
    expect(topOf(look('A', 'hat-cap', null, null))).toBe('flat');
    expect(topOf(look('A', 'hat-beanie', 'ears-bunny', null))).toBe('flat');
    expect(topOf(look('A', null, null, null))).toBe('flat');
  });

  it('adds the cat as a suspect only when fewer than three play', () => {
    const rng = createRng(1);
    expect(suspectsFor(players(rng, 2))).toHaveLength(3);
    expect(suspectsFor(players(rng, 2))[2]).toBe(CAT);
    expect(suspectsFor(players(rng, 3))).toHaveLength(3);
    expect(suspectsFor(players(rng, 4))).toHaveLength(4);
    expect(candidatesFor(3, 1)).toEqual([0, 2]);
  });

  it('picks a different snacker every round', () => {
    for (let seed = 1; seed < 50; seed++) {
      for (const n of [3, 4]) {
        const order = snackerOrder(createRng(seed), n);
        expect(order).toHaveLength(WHO.rounds);
        expect(new Set(order).size).toBe(WHO.rounds);
        for (const s of order) expect(s).toBeLessThan(n);
      }
      // Two players and the cat: each eats one cookie.
      expect(new Set(snackerOrder(createRng(seed), 3)).size).toBe(3);
    }
  });

  it('makes clues that always fit the snacker, and often someone else too', () => {
    const rng = createRng(5);
    let unique = 0;
    let total = 0;
    for (let i = 0; i < 2000; i++) {
      const n = 2 + (i % 3);
      const suspects = suspectsFor(players(rng, n));
      const snacker = i % suspects.length;
      const clues = makeClues(rng, suspects, snacker);
      expect(clues.crumbs).toContain(snacker);
      expect(clues.crumbs).toHaveLength(2);
      expect(new Set(clues.crumbs).size).toBe(2);
      expect(clues.foot).toBe(suspects[snacker]?.foot);
      expect(clues.top).toBe(suspects[snacker]?.top);
      expect(clues.flinch.length).toBeGreaterThanOrEqual(1);
      for (const f of [...clues.crumbs, ...clues.flinch]) expect(f).toBeLessThan(suspects.length);
      const mine = fit(clues, suspects, snacker);
      const best = Math.max(...suspects.map((_, k) => (k === snacker ? -1 : fit(clues, suspects, k))));
      total++;
      if (mine > best + 0.5) unique++;
    }
    // A careful detective usually gets there, but the clues are far from a giveaway.
    expect(unique / total).toBeGreaterThan(0.35);
    expect(unique / total).toBeLessThan(0.85);
  });

  it('scores catchers and a snacker who got away', () => {
    // 4 players, snacker 2: two of three caught them → no snacker points.
    expect(roundPoints([2, 2, 0, 1], 2, 4)).toEqual([2, 2, 0, 0]);
    // Only one of three caught them → the snacker gets away with it.
    expect(roundPoints([2, 3, 0, 1], 2, 4)).toEqual([2, 0, 3, 0]);
    // Nobody voted.
    expect(roundPoints([null, null, null], 0, 3)).toEqual([3, 0, 0]);
    // 3 players: one of two is exactly half → caught.
    expect(roundPoints([1, 0, 2], 0, 3)).toEqual([0, 2, 0]);
    // The cat did it (index 2 with two players): only the catchers score.
    expect(roundPoints([2, 0], 2, 2)).toEqual([2, 0]);
  });

  it('ranks by points, then right votes', () => {
    const [a, b] = whoScores([4, 4], [1, 2]) as [number, number];
    expect(b).toBeGreaterThan(a);
  });

  it('never lets a computer vote for itself', () => {
    const rng = createRng(3);
    for (let i = 0; i < 300; i++) {
      const suspects = suspectsFor(players(rng, 2 + (i % 3)));
      const snacker = i % suspects.length;
      const clues = makeClues(rng, suspects, snacker);
      const self = (snacker + 1) % Math.min(suspects.length, 2 + (i % 3));
      const v = cpuVote(rng, clues, suspects, self, rng());
      expect(v).not.toBe(self);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(suspects.length);
    }
  });

  it('plays believably CPU against CPU: sharp ones catch the snacker more, sleepy ones still sometimes do', () => {
    const rng = createRng(21);
    const rate = (skill: number, n: number) => {
      let right = 0;
      let votes = 0;
      for (let i = 0; i < 3000; i++) {
        const suspects = suspectsFor(players(rng, n));
        const snacker = Math.floor(rng() * suspects.length);
        const clues = makeClues(rng, suspects, snacker);
        const self = snacker === 0 ? 1 : 0;
        if (cpuVote(rng, clues, suspects, self, skill) === snacker) right++;
        votes++;
      }
      return right / votes;
    };
    for (const n of [2, 3, 4]) {
      const sleepy = rate(0.1, n);
      const average = rate(0.55, n);
      const sharp = rate(0.95, n);
      expect(sharp).toBeGreaterThan(average);
      expect(average).toBeGreaterThan(sleepy);
      expect(sleepy).toBeGreaterThan(1 / (n + (n < 3 ? 1 : 0)) - 0.02); // at least as good as a blind guess
      expect(sharp).toBeLessThan(0.92); // the clues stay a little ambiguous
      expect(sharp).toBeGreaterThan(0.6);
    }
    // A snacker among three average computers gets away now and then.
    let away = 0;
    const games = 1500;
    for (let g = 0; g < games; g++) {
      const suspects = suspectsFor(players(rng, 4));
      const clues = makeClues(rng, suspects, 0);
      const votes = [null, ...[1, 2, 3].map((s) => cpuVote(rng, clues, suspects, s, 0.55))];
      if ((roundPoints(votes, 0, 4)[0] ?? 0) > 0) away++;
    }
    expect(away / games).toBeGreaterThan(0.12);
    expect(away / games).toBeLessThan(0.7);
  });
});
