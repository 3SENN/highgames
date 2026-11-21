import { describe, expect, it } from 'vitest';
import { type Chart, type CpuMove, SONGS, cpuMoves, hitPoints, makeChart, padCount, replay } from '../src/game/minigames/rhythm';
import { createRng } from '../src/game/rng';

const spec = SONGS.bongocouch;

/** Every note perfect, in one long combo. */
function best(c: Chart): number {
  return c.notes.reduce((s, _, i) => s + hitPoints('perfect', i + 1), 0);
}

describe('Couch Bongos song', () => {
  it('runs about 35 seconds at a relaxed 90 to 100 BPM', () => {
    expect(spec.bpm).toBeGreaterThanOrEqual(90);
    expect(spec.bpm).toBeLessThanOrEqual(100);
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.end).toBeGreaterThan(33);
      expect(c.end).toBeLessThan(37);
    }
  });

  it('puts every beat on the left or right drum, and uses both in every phrase', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(padCount(c)).toBe(2);
      for (const n of c.notes) expect([0, 1]).toContain(n.pad);
      for (let p = 0; p * spec.phrase < spec.bars; p++) {
        const used = new Set(c.notes.filter((n) => Math.floor(n.bar / spec.phrase) === p).map((n) => n.pad));
        expect(used.size, `seed ${seed}, phrase ${p}`).toBe(2);
      }
    }
  });

  it('starts with the drums trading on the beat and gets busier', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.notes.filter((n) => n.bar < spec.phrase).every((n) => n.onBeat)).toBe(true);
      const count = (from: number, to: number) => c.notes.filter((n) => n.bar >= from && n.bar < to).length;
      expect(count(0, 4)).toBeLessThan(count(spec.bars - 4, spec.bars));
    }
  });
});

describe('Couch Bongos computer players', () => {
  const skills = [0.35, 0.55, 0.8, 1];

  it('rank by how awake they are: an average one is beatable but not hopeless', () => {
    const share = skills.map(() => 0);
    let sharpBeatsSleepy = 0;
    const games = 60;
    for (let g = 1; g <= games; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(1000 + g);
      const scores = skills.map((s) => replay(c, cpuMoves(c, rng, s)).score);
      scores.forEach((s, i) => (share[i] = (share[i] as number) + s / best(c) / games));
      if ((scores[3] as number) > (scores[0] as number)) sharpBeatsSleepy += 1;
    }
    for (let i = 1; i < skills.length; i++) expect(share[i]).toBeGreaterThan(share[i - 1] as number);
    expect(share[1]).toBeGreaterThan(0.3);
    expect(share[1]).toBeLessThan(0.65);
    expect(share[3]).toBeGreaterThan(0.7);
    expect(sharpBeatsSleepy / games).toBeGreaterThan(0.85);
  });

  it('gain nothing by hammering both drums all the way through', () => {
    for (let g = 1; g <= 20; g++) {
      const c = makeChart(spec, createRng(g));
      const moves: CpuMove[] = [];
      for (let t = c.start - 0.1; t < c.end; t += c.beat / 2) moves.push({ time: t, pad: 0 }, { time: t + 0.1, pad: 1 });
      const mash = replay(c, moves).score;
      const sleepy = replay(c, cpuMoves(c, createRng(g), 0.35)).score;
      expect(mash).toBeLessThan(sleepy);
    }
  });
});
