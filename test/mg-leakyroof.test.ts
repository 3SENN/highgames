import { describe, expect, it } from 'vitest';
import {
  DRIP_CHORDS,
  DRIP_TUNE,
  LEAKY_GROOVE,
  LEAKY_SONG,
  POTS,
  SECOND_HALF,
  dripDetail,
  dripPitch,
  isSyncopated,
  waterLevel,
} from '../src/game/minigames/leakyroof';
import { type Chart, type CpuMove, chartFromBars, cpuMoves, hitPoints, isBar, makeChart, replay } from '../src/game/minigames/rhythm';
import { createRng } from '../src/game/rng';

const spec = LEAKY_SONG;

/** Every drip perfect in one long combo. */
function best(c: Chart): number {
  return c.notes.reduce((s, _, i) => s + hitPoints('perfect', i + 1), 0);
}

describe('Leaky Roof song', () => {
  it('is written in whole bars of drips and rests', () => {
    for (const tier of spec.tiers) for (const entry of tier) for (const bar of entry.split('|')) expect(isBar(bar), bar).toBe(true);
  });

  it('runs about 34 seconds at 84 BPM, with taps far enough apart', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.bpm).toBe(84);
      expect(c.bars).toHaveLength(10);
      expect(c.end).toBeGreaterThan(32);
      expect(c.end).toBeLessThan(36);
      for (let i = 1; i < c.notes.length; i++) expect((c.notes[i]?.time ?? 0) - (c.notes[i - 1]?.time ?? 0)).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('drips on the beat in the first half and syncopates in every bar of the second', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const c = makeChart(spec, createRng(seed));
      const first = c.notes.filter((n) => n.bar < SECOND_HALF);
      expect(first.every((n) => n.onBeat)).toBe(true);
      for (let bar = SECOND_HALF; bar < c.bars.length; bar++) {
        expect(c.notes.some((n) => n.bar === bar && isSyncopated(c, n)), `seed ${seed}, bar ${bar}: ${c.bars[bar]}`).toBe(true);
      }
    }
  });

  it('tells a push off the beat from a pickup into it', () => {
    const c = chartFromBars(['x..x..xx', 'x.......'], 84);
    expect(c.notes.map((n) => isSyncopated(c, n))).toEqual([false, true, false, false, false]);
    const end = chartFromBars(['x......x'], 84);
    expect(isSyncopated(end, end.notes[1] as never)).toBe(true);
  });

  it('has a groove in the shape the rhythm kit plays', () => {
    const g = LEAKY_GROOVE;
    expect(g.chords).toHaveLength(g.bass.length);
    expect(DRIP_TUNE).toHaveLength(g.chords.length);
    expect(DRIP_CHORDS).toHaveLength(g.chords.length);
    for (const steps of [g.kick, g.snare, g.hats, g.keys, g.bassSteps]) for (const s of steps) expect(s >= 0 && s < 16).toBe(true);
  });
});

describe('Leaky Roof pots', () => {
  const c = makeChart(spec, createRng(7));

  it('plays the drip tune on the first pot, bar by bar', () => {
    c.notes.forEach((n, i) => expect(dripPitch(c, i, 0)).toBe(DRIP_TUNE[n.bar % 4]?.[n.slot]));
  });

  it('gives every pot its own voice, lower one by one, on tones of the chord', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const chart = makeChart(spec, createRng(seed));
      chart.notes.forEach((n, i) => {
        const voices = Array.from({ length: POTS }, (_, p) => dripPitch(chart, i, p));
        for (let p = 1; p < POTS; p++) {
          expect(voices[p]).toBeLessThan(voices[p - 1] as number);
          const tones: readonly number[] = DRIP_CHORDS[n.bar % 4] as readonly number[];
          expect(tones).toContain((voices[p] as number) % 12);
        }
        expect((voices[0] as number) - (voices[POTS - 1] as number)).toBeLessThanOrEqual(12);
        expect(voices[POTS - 1]).toBeGreaterThanOrEqual(55);
        expect(voices[0]).toBeLessThanOrEqual(84);
      });
    }
  });

  it('wraps pots past the fourth back round', () => {
    expect(dripPitch(c, 0, 4)).toBe(dripPitch(c, 0, 0));
  });

  it('fill up with the drips they catch, never over the brim', () => {
    expect(waterLevel(0, 30)).toBeCloseTo(0.15);
    expect(waterLevel(15, 30)).toBeGreaterThan(waterLevel(5, 30));
    expect(waterLevel(30, 30)).toBeLessThanOrEqual(0.85);
    expect(waterLevel(99, 30)).toBeLessThanOrEqual(0.85);
  });

  it('says how many drips landed and the longest run', () => {
    const chart = chartFromBars(['x.x.x...', 'x..x..x.'], 84);
    const moves: CpuMove[] = [0, 1, 2, 4].map((k) => ({ time: chart.notes[k]?.time ?? 0 }));
    expect(dripDetail(replay(chart, moves), chart)).toBe('4 of 6 drips · best run 3');
  });
});

describe('Leaky Roof computer players', () => {
  const skills = [0.35, 0.55, 0.8, 1];

  it('rank by how awake they are: an average one is beatable but not hopeless', () => {
    const share = skills.map(() => 0);
    let sharpBeatsSleepy = 0;
    const games = 80;
    for (let g = 1; g <= games; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(4000 + g);
      const tracks = skills.map((s) => replay(c, cpuMoves(c, rng, s)));
      tracks.forEach((t, i) => (share[i] = (share[i] as number) + t.score / best(c) / games));
      if ((tracks[3]?.score ?? 0) > (tracks[0]?.score ?? 0)) sharpBeatsSleepy += 1;
    }
    for (let i = 1; i < skills.length; i++) expect(share[i]).toBeGreaterThan(share[i - 1] as number);
    expect(share[1]).toBeGreaterThan(0.35);
    expect(share[1]).toBeLessThan(0.75);
    expect(share[3]).toBeGreaterThan(0.75);
    expect(sharpBeatsSleepy / games).toBeGreaterThan(0.85);
  });

  it('gain nothing by drumming on the phone', () => {
    for (let g = 1; g <= 20; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(500 + g);
      const moves: CpuMove[] = [];
      for (let t = c.start - 0.3; t < c.end; t += 0.15 + rng() * 0.1) moves.push({ time: t });
      expect(replay(c, moves).score).toBeLessThan(replay(c, cpuMoves(c, createRng(g), 0.35)).score);
    }
  });

  it('pay for tapping through the rests: every eighth is worth less than resting in them', () => {
    let everyEighth = 0;
    let average = 0;
    for (let g = 1; g <= 40; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(700 + g);
      const moves: CpuMove[] = [];
      for (let t = c.start; t < c.end; t += c.beat / 2) moves.push({ time: t + (rng() - 0.5) * 0.16 });
      everyEighth += replay(c, moves).score / best(c);
      average += replay(c, cpuMoves(c, createRng(g), 0.55)).score / best(c);
    }
    expect(everyEighth).toBeLessThan(average);
  });
});
