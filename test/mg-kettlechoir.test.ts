import { describe, expect, it } from 'vitest';
import { holdBeats, kettleDetail } from '../src/game/minigames/kettlechoir';
import { type Chart, type CpuMove, RHYTHM, SONGS, chartFromBars, cpuMoves, hitPoints, makeChart, replay } from '../src/game/minigames/rhythm';
import { createRng } from '../src/game/rng';

const spec = SONGS.kettlechoir;

/** Every press perfect in one long combo, every stop perfect. */
function best(c: Chart): number {
  return c.notes.reduce((s, _, i) => s + hitPoints('perfect', i + 1) + RHYTHM.releasePoints.perfect, 0);
}

describe('Kettle Choir song', () => {
  it('runs about 32 seconds', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      expect(c.end).toBeGreaterThan(30);
      expect(c.end).toBeLessThan(34);
    }
  });

  it('holds every note, mixing short one-beat whistles with long ones', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      const beats = c.notes.map((_, i) => holdBeats(c, i));
      expect(beats.every((b) => b >= 1 - 1e-9)).toBe(true);
      expect(beats.some((b) => b <= 1 + 1e-9)).toBe(true);
      expect(beats.some((b) => b >= 3 - 1e-9)).toBe(true);
    }
  });

  it('leaves at least an eighth between letting go and the next press, and ends inside the song', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = makeChart(spec, createRng(seed));
      for (let i = 1; i < c.notes.length; i++) {
        const prev = c.notes[i - 1];
        expect((c.notes[i]?.time ?? 0) - (prev?.release ?? 0)).toBeGreaterThanOrEqual(c.beat / 2 - 1e-9);
      }
      expect(c.notes[c.notes.length - 1]?.release ?? 0).toBeLessThan(c.end - c.beat * 2);
    }
  });
});

describe('Kettle Choir scoring', () => {
  const c = chartFromBars(['x===..x=', '=...x=..'], 88);

  it('pays for clean stops on top of the presses', () => {
    const perfect: CpuMove[] = c.notes.flatMap((n) => [{ time: n.time }, { time: n.release ?? n.time, up: true }]);
    const sloppy: CpuMove[] = c.notes.flatMap((n) => [{ time: n.time }, { time: (n.release ?? n.time) - 0.3, up: true }]);
    expect(replay(c, perfect).score).toBe(best(c));
    expect(replay(c, sloppy).score).toBe(best(c) - c.notes.length * RHYTHM.releasePoints.perfect);
  });

  it('says how many whistles were played and stopped cleanly', () => {
    const moves: CpuMove[] = [
      { time: c.notes[0]?.time ?? 0 },
      { time: c.notes[0]?.release ?? 0, up: true },
      { time: c.notes[1]?.time ?? 0 },
      { time: (c.notes[1]?.time ?? 0) + 0.1, up: true },
    ];
    expect(kettleDetail(replay(c, moves), c)).toBe('2 of 3 whistles · 1 clean stop');
    expect(holdBeats(c, 0)).toBe(2);
    expect(holdBeats(c, 1)).toBe(1.5);
  });
});

describe('Kettle Choir computer players', () => {
  const skills = [0.35, 0.55, 0.8, 1];

  it('rank by how awake they are: an average one is beatable but not hopeless', () => {
    const share = skills.map(() => 0);
    const clean = skills.map(() => 0);
    let sharpBeatsSleepy = 0;
    const games = 60;
    for (let g = 1; g <= games; g++) {
      const c = makeChart(spec, createRng(g));
      const rng = createRng(2000 + g);
      const tracks = skills.map((s) => replay(c, cpuMoves(c, rng, s)));
      tracks.forEach((t, i) => {
        share[i] = (share[i] as number) + t.score / best(c) / games;
        clean[i] = (clean[i] as number) + (t.ends.perfect + t.ends.good) / c.notes.length / games;
      });
      if ((tracks[3]?.score ?? 0) > (tracks[0]?.score ?? 0)) sharpBeatsSleepy += 1;
    }
    for (let i = 1; i < skills.length; i++) {
      expect(share[i]).toBeGreaterThan(share[i - 1] as number);
      expect(clean[i]).toBeGreaterThan(clean[i - 1] as number);
    }
    expect(share[1]).toBeGreaterThan(0.35);
    expect(share[1]).toBeLessThan(0.7);
    expect(share[3]).toBeGreaterThan(0.75);
    expect(sharpBeatsSleepy / games).toBeGreaterThan(0.85);
  });

  it('gain nothing by tapping every eighth', () => {
    for (let g = 1; g <= 20; g++) {
      const c = makeChart(spec, createRng(g));
      const moves: CpuMove[] = [];
      for (let t = c.start - 0.05; t < c.end; t += c.beat / 2) moves.push({ time: t }, { time: t + 0.12, up: true });
      expect(replay(c, moves).score).toBeLessThan(replay(c, cpuMoves(c, createRng(g), 0.35)).score);
    }
  });
});
