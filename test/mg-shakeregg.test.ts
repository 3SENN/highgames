import { describe, expect, it } from 'vitest';
import { type Chart, type CpuMove, chartFromBars, cpuMoves, hitPoints, isBar, makeChart, replay } from '../src/game/minigames/rhythm';
import { EGG_SONG, doubleTimeBars, eggDetail, isDoubleTime } from '../src/game/minigames/shakeregg';
import { createRng } from '../src/game/rng';

const spec = EGG_SONG;

/** Every note perfect, in one long combo. */
function best(c: Chart): number {
  return c.notes.reduce((s, _, i) => s + hitPoints('perfect', i + 1), 0);
}

describe('Shaker Egg song', () => {
  it('is a 100 BPM bossa of about 33 seconds', () => {
    expect(spec.bpm).toBe(100);
    for (const tier of spec.tiers) for (const entry of tier) for (const bar of entry.split('|')) expect(isBar(bar), bar).toBe(true);
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.bars).toHaveLength(spec.bars);
      expect(c.end).toBeGreaterThan(32);
      expect(c.end).toBeLessThan(36);
    }
  });

  it('spots double-time bars by their runs of eighth notes', () => {
    expect(isDoubleTime('xxxx....')).toBe(true);
    expect(isDoubleTime('x..xxxx.')).toBe(true);
    expect(isDoubleTime('x.x.x.x.')).toBe(false);
    expect(isDoubleTime('xxx.xxx.')).toBe(false);
    expect(doubleTimeBars(chartFromBars(['x.x.x.x.', 'xxxx....', 'x...x...', 'x..xxxx.'], 100))).toEqual([1, 3]);
  });

  it('keeps the first half relaxed and plays double time only in the second half, in every game', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const c = makeChart(spec, createRng(seed));
      const fast = doubleTimeBars(c);
      expect(fast.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      for (const b of fast) expect(b).toBeGreaterThanOrEqual(spec.bars / 2);
      // Never a whole bar of eighths: there is always a beat to breathe.
      for (const bar of c.bars) expect(bar).toMatch(/\.\./);
    }
  });

  it('says how many shakes landed and the best run', () => {
    const c = chartFromBars(['xxxx....'], 100);
    const moves: CpuMove[] = c.notes.map((n) => ({ time: n.time - 0.03 }));
    expect(eggDetail(replay(c, moves))).toBe('4 shakes · best run 4');
  });
});

describe('Shaker Egg computer players', () => {
  const skills = [0.35, 0.55, 0.8, 1];

  it('rank by how awake they are: an average one is beatable but not hopeless', () => {
    const share = skills.map(() => 0);
    let sharpBeatsSleepy = 0;
    const games = 60;
    for (let g = 1; g <= games; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(5000 + g);
      const scores = skills.map((s) => replay(c, cpuMoves(c, rng, s)).score);
      scores.forEach((s, i) => (share[i] = (share[i] as number) + s / best(c) / games));
      if ((scores[3] as number) > (scores[0] as number)) sharpBeatsSleepy += 1;
    }
    for (let i = 1; i < skills.length; i++) expect(share[i]).toBeGreaterThan(share[i - 1] as number);
    expect(share[1]).toBeGreaterThan(0.35);
    expect(share[1]).toBeLessThan(0.65);
    expect(share[3]).toBeGreaterThan(0.72);
    expect(sharpBeatsSleepy / games).toBeGreaterThan(0.9);
  });

  it('gain nothing by shaking all the way through', () => {
    let grid = 0;
    let avg = 0;
    for (let g = 1; g <= 30; g++) {
      const c = makeChart(spec, createRng(g));
      const steady: CpuMove[] = [];
      for (let t = c.start - 0.05; t < c.end; t += 0.2) steady.push({ time: t });
      const sleepy = replay(c, cpuMoves(c, createRng(g), 0.35)).score;
      expect(replay(c, steady).score).toBeLessThan(sleepy);
      const eighths: CpuMove[] = [];
      for (let t = c.start; t < c.end; t += c.beat / 2) eighths.push({ time: t });
      grid += replay(c, eighths).score / best(c);
      avg += replay(c, cpuMoves(c, createRng(g), 0.55)).score / best(c);
    }
    expect(grid).toBeLessThan(avg);
  });
});
