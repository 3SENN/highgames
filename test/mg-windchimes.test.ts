import { describe, expect, it } from 'vitest';
import { type Chart, type CpuMove, chartFromBars, cpuMoves, hitPoints, isBar, makeChart, replay } from '../src/game/minigames/rhythm';
import { CHIME_SONG, PENTATONIC, TUBES, chimeDetail, chimeNote, chimeTube } from '../src/game/minigames/windchimes';
import { createRng } from '../src/game/rng';

const spec = CHIME_SONG;

/** Every note perfect, in one long combo. */
function best(c: Chart): number {
  return c.notes.reduce((s, _, i) => s + hitPoints('perfect', i + 1), 0);
}

describe('Wind Chimes song', () => {
  it('drifts along at a dreamy 76 BPM for about 34 seconds', () => {
    expect(spec.bpm).toBe(76);
    for (const tier of spec.tiers) for (const entry of tier) for (const bar of entry.split('|')) expect(isBar(bar), bar).toBe(true);
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.bars).toHaveLength(spec.bars);
      expect(c.end).toBeGreaterThan(32);
      expect(c.end).toBeLessThan(36);
    }
  });

  it('starts on the beat, gets a little busier, and never fills a bar: four rings at most', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.notes.filter((n) => n.bar < spec.phrase).every((n) => n.onBeat)).toBe(true);
      const count = (from: number, to: number) => c.notes.filter((n) => n.bar >= from && n.bar < to).length;
      expect(count(0, 3)).toBeLessThan(count(spec.bars - 3, spec.bars));
      for (const bar of c.bars) expect(bar.replace(/\./g, '').length).toBeLessThanOrEqual(4);
    }
  });
});

describe('Wind Chimes tuning', () => {
  it('tunes every tube of every chime to F major pentatonic, so any rings sound good together', () => {
    const scale = new Set([5, 7, 9, 0, 2]);
    for (const m of PENTATONIC) expect(scale.has(m % 12)).toBe(true);
    for (let seat = 0; seat < 4; seat++) for (let tube = 0; tube < TUBES; tube++) expect(scale.has(chimeNote(seat, tube) % 12)).toBe(true);
  });

  it('tunes each chime along the porch a step higher, longest tube lowest', () => {
    for (let seat = 1; seat < 4; seat++) expect(chimeNote(seat, 0)).toBeGreaterThan(chimeNote(seat - 1, 0));
    for (let tube = 1; tube < TUBES; tube++) expect(chimeNote(0, tube)).toBeGreaterThan(chimeNote(0, tube - 1));
  });

  it('rings the tubes in a gentle walk: every tube in turn, never a big leap or the same one twice', () => {
    const seen = new Set<number>();
    for (let n = 0; n < 40; n++) {
      const t = chimeTube(n);
      seen.add(t);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(TUBES);
      const step = Math.abs(chimeTube(n + 1) - t);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(2);
    }
    expect(seen.size).toBe(TUBES);
  });

  it('says how many rings landed and the best run', () => {
    const c = chartFromBars(['x...x...'], 76);
    const moves: CpuMove[] = c.notes.map((n) => ({ time: n.time + 0.02 }));
    expect(chimeDetail(replay(c, moves))).toBe('2 rings · best run 2');
  });
});

describe('Wind Chimes computer players', () => {
  const skills = [0.35, 0.55, 0.8, 1];

  it('rank by how awake they are: an average one is beatable but not hopeless', () => {
    const share = skills.map(() => 0);
    let sharpBeatsSleepy = 0;
    const games = 60;
    for (let g = 1; g <= games; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(4000 + g);
      const scores = skills.map((s) => replay(c, cpuMoves(c, rng, s)).score);
      scores.forEach((s, i) => (share[i] = (share[i] as number) + s / best(c) / games));
      if ((scores[3] as number) > (scores[0] as number)) sharpBeatsSleepy += 1;
    }
    for (let i = 1; i < skills.length; i++) expect(share[i]).toBeGreaterThan(share[i - 1] as number);
    expect(share[1]).toBeGreaterThan(0.35);
    expect(share[1]).toBeLessThan(0.65);
    expect(share[3]).toBeGreaterThan(0.72);
    expect(sharpBeatsSleepy / games).toBeGreaterThan(0.85);
  });

  it('gain nothing by waving all the way through', () => {
    let grid = 0;
    let avg = 0;
    for (let g = 1; g <= 30; g++) {
      const c = makeChart(spec, createRng(g));
      const steady: CpuMove[] = [];
      for (let t = c.start - 0.05; t < c.end; t += 0.25) steady.push({ time: t });
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
