import { describe, expect, it } from 'vitest';
import { type Drawing, PROMPTS, SKETCHY, addChunk, cpuSketch, cpuVote, inkLength, pickPrompt, sketchyScores, tally, voteOptions } from '../src/game/minigames/sketchy';
import { createRng } from '../src/game/rng';

describe('sketchy', () => {
  it('has plenty of different, short prompts and picks them from the seed', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(PROMPTS).size).toBe(PROMPTS.length);
    for (const p of PROMPTS) expect(p.length).toBeLessThanOrEqual(34);
    expect(pickPrompt(createRng(7))).toBe(pickPrompt(createRng(7)));
    const seen = new Set(Array.from({ length: 60 }, (_, i) => pickPrompt(createRng(i))));
    expect(seen.size).toBeGreaterThan(10);
  });

  it('builds strokes from the phone chunks: start begins a new stroke, the rest continues it', () => {
    const d: Drawing = [];
    addChunk(d, [0.1, 0.1, 0.2, 0.2], true);
    addChunk(d, [0.3, 0.3], false);
    addChunk(d, [0.5, 0.5, 0.6, 0.5], true);
    expect(d).toEqual([
      [0.1, 0.1, 0.2, 0.2, 0.3, 0.3],
      [0.5, 0.5, 0.6, 0.5],
    ]);
    // A continuation with no stroke yet (its start got lost) still makes one.
    const e: Drawing = [];
    addChunk(e, [0.4, 0.4], false);
    expect(e).toEqual([[0.4, 0.4]]);
  });

  it('stops taking ink at the cap', () => {
    const d: Drawing = [];
    expect(addChunk(d, [0, 0, 0.1, 0, 0.2, 0], true, 2)).toBe(2);
    expect(addChunk(d, [0.3, 0], false, 2)).toBe(0);
    expect(d.flat().length).toBe(4);
  });

  it('measures ink as the length of all strokes, not counting the jumps between them', () => {
    expect(
      inkLength([
        [0, 0, 0.3, 0, 0.3, 0.4],
        [0.9, 0.9, 0.9, 0.8],
      ]),
    ).toBeCloseTo(0.8);
    expect(inkLength([[0.5, 0.5]])).toBe(0);
  });

  it('only lets you vote for the others', () => {
    expect(voteOptions(4, 2)).toEqual([0, 1, 3]);
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      const v = cpuVote(rng, 4, 1);
      expect(v).not.toBe(1);
      expect(v).not.toBeNull();
    }
    expect(cpuVote(rng, 1, 0)).toBeNull();
  });

  it('counts votes, ignoring votes for yourself and blank ones', () => {
    expect(tally([1, 0, 1, 3])).toEqual([1, 2, 0, 0]);
    expect(tally([0, null, 9, 3])).toEqual([0, 0, 0, 0]);
  });

  it('ranks by votes, and breaks equal votes by ink', () => {
    const [a, b, c, d] = sketchyScores([2, 1, 1, 0], [1, 30, 5, 500]) as [number, number, number, number];
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
  });

  it('has computer players doodle something on the paper, in time', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sketch = cpuSketch(createRng(seed), (seed % 5) / 4);
      expect(sketch.strokes.length).toBeGreaterThan(0);
      expect(inkLength(sketch.strokes)).toBeGreaterThan(0.8);
      expect(sketch.strokes.flat().length / 2).toBeLessThan(SKETCHY.maxPoints);
      for (const v of sketch.strokes.flat()) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(sketch.startAt + sketch.duration).toBeLessThan(SKETCHY.drawTime - 2);
    }
  });
});
