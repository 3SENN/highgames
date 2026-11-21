import { describe, expect, it } from 'vitest';
import { HAMMOCK_GROOVE, HAMMOCK_SONG, swayDetail, swayTo, swingFor } from '../src/game/minigames/hammocksway';
import { type Chart, type CpuMove, chartFromBars, cpuMoves, hitPoints, isBar, makeChart, replay } from '../src/game/minigames/rhythm';
import { createRng } from '../src/game/rng';

const spec = HAMMOCK_SONG;

/** Every sway perfect in one long combo. */
function best(c: Chart): number {
  return c.notes.reduce((s, _, i) => s + hitPoints('perfect', i + 1), 0);
}

/** Beats between each note and the next. */
function gaps(c: Chart, from = 0, to = Infinity): number[] {
  const notes = c.notes.filter((n) => n.bar >= from && n.bar < to);
  return notes.slice(1).map((n, i) => n.beat - (notes[i]?.beat ?? 0));
}

describe('Hammock Sway song', () => {
  it('is written in whole bars of moves and rests', () => {
    for (const tier of spec.tiers) for (const entry of tier) for (const bar of entry.split('|')) expect(isBar(bar), bar).toBe(true);
  });

  it('runs about 34 seconds at a lazy 70 BPM', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.bpm).toBe(70);
      expect(c.bars).toHaveLength(8);
      expect(c.end).toBeGreaterThan(32);
      expect(c.end).toBeLessThan(36);
    }
  });

  it('sways only on the beat, never closer than a beat apart', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.notes.every((n) => n.onBeat)).toBe(true);
      expect(Math.min(...gaps(c))).toBeGreaterThanOrEqual(1);
    }
  });

  it('starts with half notes and saves the quarter-note runs for later', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      // The first half: two beats or more between sways.
      expect(Math.min(...gaps(c, 0, 4))).toBeGreaterThanOrEqual(2);
      // The last bars: at least one run of three sways a beat apart.
      const late = gaps(c, 6);
      expect(late.some((g, i) => g === 1 && late[i + 1] === 1)).toBe(true);
      // Mostly half notes all the same.
      const all = gaps(c);
      expect(all.filter((g) => g >= 2).length).toBeGreaterThanOrEqual(all.length / 2);
    }
  });

  it('has a groove in the shape the rhythm kit plays', () => {
    const g = HAMMOCK_GROOVE;
    expect(g.chords).toHaveLength(g.bass.length);
    for (const steps of [g.kick, g.snare, g.hats, g.keys, g.bassSteps]) for (const s of steps) expect(s >= 0 && s < 16).toBe(true);
    for (const bar of g.lead) for (const [step, , len] of bar) expect(step + len).toBeLessThanOrEqual(16);
  });
});

describe('Hammock Sway swinging', () => {
  it('swings to the other side with every sway', () => {
    expect(swayTo(1)).toBe(-1);
    expect(swayTo(swayTo(1))).toBe(1);
  });

  it('swings further for a cleaner sway', () => {
    expect(swingFor('perfect')).toBeGreaterThan(swingFor('good'));
    expect(swingFor('good')).toBeGreaterThan(swingFor('miss'));
  });

  it('says how many sways landed and the longest run', () => {
    const c = chartFromBars(['x...x...', 'x.x.x...'], 70);
    const moves: CpuMove[] = [0, 1, 3, 4].map((k) => ({ time: c.notes[k]?.time ?? 0 }));
    expect(swayDetail(replay(c, moves), c)).toBe('4 of 5 sways · best run 2');
  });
});

describe('Hammock Sway computer players', () => {
  const skills = [0.35, 0.55, 0.8, 1];

  it('rank by how awake they are: an average one is beatable but not hopeless', () => {
    const share = skills.map(() => 0);
    let sharpBeatsSleepy = 0;
    const games = 80;
    for (let g = 1; g <= games; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(3000 + g);
      const tracks = skills.map((s) => replay(c, cpuMoves(c, rng, s)));
      tracks.forEach((t, i) => (share[i] = (share[i] as number) + t.score / best(c) / games));
      if ((tracks[3]?.score ?? 0) > (tracks[0]?.score ?? 0)) sharpBeatsSleepy += 1;
    }
    for (let i = 1; i < skills.length; i++) expect(share[i]).toBeGreaterThan(share[i - 1] as number);
    expect(share[1]).toBeGreaterThan(0.35);
    expect(share[1]).toBeLessThan(0.75);
    expect(share[3]).toBeGreaterThan(0.75);
    expect(sharpBeatsSleepy / games).toBeGreaterThan(0.8);
  });

  it('gain nothing by flailing the phone about', () => {
    for (let g = 1; g <= 20; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(500 + g);
      const moves: CpuMove[] = [];
      for (let t = c.start - 0.3; t < c.end; t += 0.15 + rng() * 0.1) moves.push({ time: t });
      expect(replay(c, moves).score).toBeLessThan(replay(c, cpuMoves(c, createRng(g), 0.35)).score);
    }
  });

  it('pay for swaying through the rests: on every beat is worth less than resting in them', () => {
    let everyBeat = 0;
    let average = 0;
    for (let g = 1; g <= 40; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(700 + g);
      const moves: CpuMove[] = [];
      for (let t = c.start; t < c.end; t += c.beat) moves.push({ time: t + (rng() - 0.5) * 0.16 });
      everyBeat += replay(c, moves).score / best(c);
      average += replay(c, cpuMoves(c, createRng(g), 0.55)).score / best(c);
    }
    expect(everyBeat).toBeLessThan(average);
  });
});
