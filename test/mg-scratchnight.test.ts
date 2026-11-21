import { describe, expect, it } from 'vitest';
import { type Chart, type CpuMove, chartFromBars, cpuMoves, hitPoints, isBar, makeChart, replay } from '../src/game/minigames/rhythm';
import { BEATS_PER_TURN, SCRATCH_SONG, recordAngle, scratchDetail, turnsToStylus } from '../src/game/minigames/scratchnight';
import { createRng } from '../src/game/rng';

const spec = SCRATCH_SONG;

/** Every note perfect, in one long combo. */
function best(c: Chart): number {
  return c.notes.reduce((s, _, i) => s + hitPoints('perfect', i + 1), 0);
}

describe('Scratch Night song', () => {
  it('is a lazy 92 BPM set of about 34 to 36 seconds', () => {
    expect(spec.bpm).toBe(92);
    for (const tier of spec.tiers) for (const entry of tier) for (const bar of entry.split('|')) expect(isBar(bar), bar).toBe(true);
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.bars).toHaveLength(spec.bars);
      expect(c.end).toBeGreaterThan(33);
      expect(c.end).toBeLessThan(36.5);
    }
  });

  it('opens with scratches on the beat and saves the off-beat cuts for later', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.notes.filter((n) => n.bar < spec.phrase * 2).every((n) => n.onBeat)).toBe(true);
      expect(c.notes.some((n) => n.bar >= spec.bars / 2 && !n.onBeat)).toBe(true);
    }
  });

  it('leaves room to swipe: never more than two moves in a row on eighths', () => {
    for (const tier of spec.tiers) for (const entry of tier) for (const bar of entry.split('|')) expect(bar).not.toMatch(/xxx/);
  });
});

describe('Scratch Night record', () => {
  const c = chartFromBars(['x.x.x.x.'], 92);

  it('turns once a bar, a quarter turn a beat, and carries each note round to the stylus', () => {
    expect(BEATS_PER_TURN).toBe(4);
    const note = c.notes[1]?.time ?? 0;
    expect(turnsToStylus(c, note, note)).toBe(0);
    expect(turnsToStylus(c, note, note - c.beat)).toBeCloseTo(Math.PI / 2);
    expect(turnsToStylus(c, note, note - 3 * c.beat)).toBeCloseTo((3 * Math.PI) / 2);
    expect(turnsToStylus(c, note, note + c.beat / 2)).toBeCloseTo(-Math.PI / 4);
  });

  it('puts its bar line under the stylus at the start of every bar', () => {
    expect(recordAngle(c, c.start)).toBeCloseTo(0);
    expect(recordAngle(c, c.start + 4 * c.beat)).toBeCloseTo(-Math.PI * 2);
    expect(recordAngle(c, c.start - c.beat)).toBeCloseTo(Math.PI / 2);
  });

  it('says how many scratches landed and the best run', () => {
    const moves: CpuMove[] = c.notes.slice(0, 3).map((n) => ({ time: n.time }));
    expect(scratchDetail(replay(c, moves))).toBe('3 scratches · best run 3');
    expect(scratchDetail(replay(c, [{ time: c.notes[0]?.time ?? 0 }]))).toBe('1 scratch · best run 1');
  });
});

describe('Scratch Night computer players', () => {
  const skills = [0.35, 0.55, 0.8, 1];

  it('rank by how awake they are: an average one is beatable but not hopeless', () => {
    const share = skills.map(() => 0);
    let sharpBeatsSleepy = 0;
    const games = 60;
    for (let g = 1; g <= games; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(3000 + g);
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

  it('gain nothing by swiping all the way through', () => {
    let grid = 0;
    let avg = 0;
    for (let g = 1; g <= 30; g++) {
      const c = makeChart(spec, createRng(g));
      const steady: CpuMove[] = [];
      for (let t = c.start - 0.05; t < c.end; t += 0.2) steady.push({ time: t });
      const sleepy = replay(c, cpuMoves(c, createRng(g), 0.35)).score;
      expect(replay(c, steady).score).toBeLessThan(sleepy);
      // Even on every eighth, bang in time, it does worse than just playing the notes.
      const eighths: CpuMove[] = [];
      for (let t = c.start; t < c.end; t += c.beat / 2) eighths.push({ time: t });
      grid += replay(c, eighths).score / best(c);
      avg += replay(c, cpuMoves(c, createRng(g), 0.55)).score / best(c);
    }
    expect(grid).toBeLessThan(avg);
  });
});
