import { describe, expect, it } from 'vitest';
import { SNACKS, SNACK_HEIGHT, missSnack, newTower, snackSequence, stackSnack, towerDetail, towerHeight, towerScores } from '../src/game/minigames/snackstack';
import { createRng } from '../src/game/rng';

describe('snack stack', () => {
  it('stacks a snack for every hit', () => {
    const t = newTower();
    stackSnack(t, 'cracker', 'perfect');
    stackSnack(t, 'cheese', 'good');
    expect(t.pieces).toEqual(['cracker', 'cheese']);
    expect(towerHeight(t)).toBeCloseTo(SNACK_HEIGHT.cracker + SNACK_HEIGHT.cheese);
    expect(t.peak).toBe(2);
  });

  it('wobbles on a miss and drops the top snack on a second miss', () => {
    const t = newTower();
    stackSnack(t, 'cookie', 'perfect');
    stackSnack(t, 'wafer', 'perfect');
    expect(missSnack(t)).toBe('wobble');
    expect(t.pieces).toHaveLength(2);
    expect(missSnack(t)).toBe('drop');
    expect(t.pieces).toEqual(['cookie']);
    expect(missSnack(t)).toBe('drop');
    expect(t.pieces).toEqual([]);
    expect(t.dropped).toBe(2);
    expect(t.peak).toBe(2);
    // Nothing left to drop: it just wobbles.
    expect(missSnack(t)).toBe('wobble');
  });

  it('steadies completely on a perfect hit, a step on a good one', () => {
    const t = newTower();
    stackSnack(t, 'cookie', 'perfect');
    missSnack(t);
    stackSnack(t, 'cheese', 'good');
    expect(t.wobble).toBe(0);
    expect(missSnack(t)).toBe('wobble');
    stackSnack(t, 'cracker', 'perfect');
    expect(missSnack(t)).toBe('wobble');
    expect(t.pieces).toHaveLength(3);
  });

  it('serves one snack per note, never the same twice in a row', () => {
    const seq = snackSequence(createRng(4), 60);
    expect(seq).toHaveLength(60);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(new Set(seq).size).toBe(SNACKS.length);
  });

  it('ranks the tallest tower first, perfect hits break ties', () => {
    const a = newTower();
    const b = newTower();
    const c = newTower();
    for (let i = 0; i < 5; i++) stackSnack(a, 'cracker', 'good');
    for (let i = 0; i < 6; i++) stackSnack(b, 'cracker', 'good');
    for (let i = 0; i < 5; i++) stackSnack(c, 'cracker', 'good');
    const [sa, sb, sc] = towerScores([a, b, c], [2, 0, 4]) as [number, number, number];
    expect(sb).toBeGreaterThan(sc);
    expect(sc).toBeGreaterThan(sa);
    expect(towerDetail(b, 3, 1)).toBe('6 snacks · 3 perfect · 1 miss');
  });
});
