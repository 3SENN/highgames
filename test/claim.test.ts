import { describe, expect, it } from 'vitest';
import { claim, claimCost, claimsFor, counts, cpuPick, createClaim, legalCells, pocketsFor } from '../src/game/claim';
import { createRng } from '../src/game/rng';

describe('Cushion Claim rules', () => {
  it('starts everyone in a corner', () => {
    const s = createClaim(4);
    expect(s.homes).toEqual([0, 4, 20, 24]);
    expect(counts(s, 4)).toEqual([1, 1, 1, 1]);
    expect(createClaim(2).homes).toEqual([0, 4]);
  });

  it('gives claims by place', () => {
    expect([1, 2, 3, 4].map(claimsFor)).toEqual([3, 2, 1, 0]);
  });

  it('only allows cushions next to your own, at a price', () => {
    const s = createClaim(2);
    expect(claimCost(s, 0, 1)).toBe(1); // free, next to home
    expect(claimCost(s, 0, 2)).toBeNull(); // not adjacent
    expect(claimCost(s, 0, 0)).toBeNull(); // already yours
    expect(legalCells(s, 0, 1).sort()).toEqual([1, 5]);
  });

  it('charges double for a rival cushion and protects home corners', () => {
    const s = createClaim(2);
    claim(s, 0, 1);
    claim(s, 0, 2);
    claim(s, 1, 3);
    expect(claimCost(s, 0, 3)).toBe(2);
    expect(claimCost(s, 0, 4)).toBeNull(); // player 1's home
    expect(legalCells(s, 0, 1)).not.toContain(3);
  });

  it('captures a small pocket you surround', () => {
    const s = createClaim(1, 5);
    // Wall off cell 6 (row 1, col 1) with player 0's cushions: 1, 5, 7, 11.
    for (const c of [1, 5, 7, 11]) s.owner[c] = 0;
    expect(pocketsFor(s, 0)).toEqual([6]);
    const s2 = createClaim(1, 5);
    for (const c of [1, 5, 11]) s2.owner[c] = 0;
    const captured = claim(s2, 0, 7);
    expect(captured).toContain(6);
    expect(s2.owner[6]).toBe(0);
  });

  it('does not capture a pocket a rival also borders, or a big open area', () => {
    const s = createClaim(2, 5);
    for (const c of [1, 5, 7]) s.owner[c] = 0;
    s.owner[11] = 1;
    expect(pocketsFor(s, 0)).not.toContain(6);
    expect(pocketsFor(createClaim(1, 5), 0)).toEqual([]); // the whole board is one big free area
  });

  it('lets computer players make sensible picks until the board fills', () => {
    const rng = createRng(3);
    const s = createClaim(4);
    for (let turn = 0; turn < 60; turn++) {
      const seat = turn % 4;
      const pick = cpuPick(s, seat, 2, rng, 0.8);
      if (pick === null) continue;
      expect(claimCost(s, seat, pick)).not.toBeNull();
      claim(s, seat, pick);
    }
    const total = counts(s, 4).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(20);
  });
});
