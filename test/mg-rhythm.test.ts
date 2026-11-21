import { describe, expect, it } from 'vitest';
import {
  RHYTHM,
  SONGS,
  barAt,
  barLabel,
  chartFromBars,
  cpuHits,
  cpuMoves,
  gradeFor,
  hasHolds,
  isBar,
  judgeHit,
  judgeRelease,
  makeChart,
  newTrack,
  padCount,
  patternLabel,
  releaseGrade,
  replay,
  summary,
  sweepHolds,
  sweepMisses,
  upcomingNote,
} from '../src/game/minigames/rhythm';
import { createRng } from '../src/game/rng';

// 120 BPM: a beat is 0.5 s, an eighth 0.25 s. Count-in of 4 beats, so bar 0 starts at 2 s.
const chart = chartFromBars(['x.x.....', 'x...x.xx'], 120, 4, 4);

describe('rhythm charts', () => {
  it('times notes on beats and off-beats after the count-in', () => {
    expect(chart.start).toBe(2);
    expect(chart.notes.map((n) => n.time)).toEqual([2, 2.5, 4, 5, 5.5, 5.75]);
    expect(chart.notes.map((n) => n.onBeat)).toEqual([true, true, true, true, true, false]);
    expect(chart.notes[5]).toMatchObject({ bar: 1, slot: 7, beat: 11.5 });
    expect(chart.end).toBe(2 + 8 * 0.5 + 4 * 0.5);
    expect(barAt(chart, 1)).toBe(-1);
    expect(barAt(chart, 4.2)).toBe(1);
  });

  it('rejects bars that are not eight slots of x and .', () => {
    expect(isBar('x.x.x.x.')).toBe(true);
    expect(isBar('x.x.x.x')).toBe(false);
    expect(() => chartFromBars(['x-x-x-x-'], 90)).toThrow();
  });

  it('labels a bar one beat at a time', () => {
    expect(patternLabel('x.x.x.xx')).toBe('●· ●· ●· ●●');
    expect(patternLabel('x.......')).toBe('●· ·· ·· ··');
  });

  it('builds every song at 30 to 40 seconds, with moves far enough apart for motion sensing', () => {
    for (const [id, spec] of Object.entries(SONGS)) {
      for (const tier of spec.tiers) for (const entry of tier) for (const bar of entry.split('|')) expect(isBar(bar), `${id}: ${bar}`).toBe(true);
      for (let seed = 1; seed < 30; seed++) {
        const c = makeChart(spec, createRng(seed));
        expect(c.bars).toHaveLength(spec.bars);
        expect(c.end).toBeGreaterThanOrEqual(30);
        expect(c.end).toBeLessThanOrEqual(40);
        for (let i = 1; i < c.notes.length; i++) {
          expect((c.notes[i]?.time ?? 0) - (c.notes[i - 1]?.time ?? 0)).toBeGreaterThanOrEqual(0.3);
        }
      }
    }
  });

  it('starts easy and gets busier', () => {
    for (let seed = 1; seed < 20; seed++) {
      const c = makeChart(SONGS.snackstack, createRng(seed));
      const moves = (bars: string[]) => bars.join('').split('').filter((s) => s === 'x').length;
      expect(moves(c.bars.slice(0, 4))).toBeLessThan(moves(c.bars.slice(-4)));
    }
  });

  it('puts off-beats in Head Nod and rests in every bar of Mellow Strum', () => {
    const nod = makeChart(SONGS.headnod, createRng(3));
    expect(nod.notes.some((n) => !n.onBeat)).toBe(true);
    for (const tier of SONGS.strum.tiers) {
      for (const entry of tier) {
        for (const bar of entry.split('|')) {
          const restBeat = [0, 2, 4, 6].some((s) => bar[s] === '.' && bar[s + 1] === '.');
          expect(restBeat, bar).toBe(true);
        }
      }
    }
  });
});

describe('judging moves', () => {
  it('grades by distance to the note', () => {
    expect(gradeFor(0.07)).toBe('perfect');
    expect(gradeFor(-0.071)).toBe('good');
    expect(gradeFor(0.15)).toBe('good');
    expect(gradeFor(-0.16)).toBe('miss');
  });

  it('judges against the nearest unjudged note, once per note', () => {
    const t = newTrack(chart);
    expect(judgeHit(t, chart, 2.03)).toMatchObject({ grade: 'perfect', note: 0, combo: 1 });
    expect(judgeHit(t, chart, 2.6)).toMatchObject({ grade: 'good', note: 1, combo: 2 });
    // Note 1 is taken, so a late move near it is judged against nothing (and the follow-through ignores it).
    expect(judgeHit(t, chart, 2.75)).toBeNull();
    expect(t.judged.slice(0, 3)).toEqual(['perfect', 'good', null]);
  });

  it('counts a move a little too far off as a miss for that note and breaks the combo', () => {
    const t = newTrack(chart);
    judgeHit(t, chart, 2);
    judgeHit(t, chart, 2.5);
    expect(t.combo).toBe(2);
    const j = judgeHit(t, chart, 4.2);
    expect(j).toMatchObject({ grade: 'miss', note: 2, combo: 0, points: 0 });
    expect(t.miss).toBe(1);
    expect(t.combo).toBe(0);
  });

  it('scores perfect over good and grows with the combo', () => {
    const t = newTrack(chart);
    const a = judgeHit(t, chart, 2);
    const b = judgeHit(t, chart, 2.5);
    const c = judgeHit(t, chart, 4.12);
    expect(a?.points).toBe(RHYTHM.points.perfect);
    expect(b?.points).toBe(RHYTHM.points.perfect + RHYTHM.comboStep);
    expect(c?.points).toBe(RHYTHM.points.good + 2 * RHYTHM.comboStep);
    expect(t.score).toBe((a?.points ?? 0) + (b?.points ?? 0) + (c?.points ?? 0));
    expect(t.best).toBe(3);
  });

  it('costs a little for moves in a rest, but not for the follow-through of a good move', () => {
    const t = newTrack(chart);
    judgeHit(t, chart, 2.5);
    judgeHit(t, chart, 2.5 + RHYTHM.grace - 0.05); // the swing back
    expect(t.stray).toBe(0);
    const j = judgeHit(t, chart, 3.25); // nothing near: bar 0's second half is a rest
    expect(j).toMatchObject({ grade: 'miss', note: null });
    expect(t.stray).toBe(1);
    expect(t.combo).toBe(0);
    expect(t.score).toBe(RHYTHM.points.perfect - RHYTHM.strayPenalty);
    expect(summary(t)).toBe('1 perfect · 0 good · 1 miss');
  });

  it('ignores double reports and moves before or after the song', () => {
    const t = newTrack(chart);
    expect(judgeHit(t, chart, 0.5)).toBeNull();
    expect(judgeHit(t, chart, 9)).toBeNull();
    expect(judgeHit(t, chart, 4)).not.toBeNull();
    expect(judgeHit(t, chart, 4 + RHYTHM.debounce / 2)).toBeNull();
  });

  it('marks notes that slid past unplayed as misses', () => {
    const t = newTrack(chart);
    judgeHit(t, chart, 2);
    expect(sweepMisses(t, chart, 2.6)).toEqual([]);
    expect(sweepMisses(t, chart, 2.5 + RHYTHM.reach + 0.01)).toEqual([1]);
    expect(sweepMisses(t, chart, 6.1)).toEqual([2, 3, 4, 5]);
    expect(t.miss).toBe(5);
    expect(t.judged).toEqual(['perfect', 'miss', 'miss', 'miss', 'miss', 'miss']);
  });
});

describe('computer players', () => {
  it('land more perfect hits when wide awake than when sleepy', () => {
    const c = makeChart(SONGS.headnod, createRng(5));
    const perfects = (skill: number) => {
      let n = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const t = newTrack(c);
        for (const h of cpuHits(c, createRng(seed), skill)) judgeHit(t, c, h);
        sweepMisses(t, c, c.end + 1);
        expect(t.perfect + t.good + t.miss).toBe(c.notes.length);
        n += t.perfect;
      }
      return n;
    };
    const awake = perfects(1);
    const sleepy = perfects(0);
    expect(awake).toBeGreaterThan(sleepy);
    expect(awake / (20 * c.notes.length)).toBeGreaterThan(0.8);
  });

  it('plans hits inside the song, in order', () => {
    const c = makeChart(SONGS.strum, createRng(8));
    const hits = cpuHits(c, createRng(2), 0.5);
    expect(hits.length).toBeGreaterThan(c.notes.length * 0.7);
    for (let i = 1; i < hits.length; i++) expect(hits[i]).toBeGreaterThanOrEqual(hits[i - 1] as number);
    expect(hits[0]).toBeGreaterThan(c.start - RHYTHM.reach);
    expect(hits[hits.length - 1]).toBeLessThan(c.end);
  });

  it('plan exactly the same hits on a plain chart when asked for moves', () => {
    const c = makeChart(SONGS.headnod, createRng(4));
    const moves = cpuMoves(c, createRng(9), 0.5);
    expect(moves.map((m) => m.time)).toEqual(cpuHits(c, createRng(9), 0.5));
    expect(moves.every((m) => m.pad === undefined && m.up === undefined)).toBe(true);
  });
});

// Pads at 120 BPM: L at 2, R at 2.5, L at 2.75, R at 3.25.
const pads = chartFromBars(['0.10.1..'], 120, 4, 4);

describe('pad charts', () => {
  it('puts each note on its pad', () => {
    expect(pads.notes.map((n) => [n.time, n.pad])).toEqual([
      [2, 0],
      [2.5, 1],
      [2.75, 0],
      [3.25, 1],
    ]);
    expect(padCount(pads)).toBe(2);
    expect(padCount(chart)).toBe(0);
    expect('pad' in (chart.notes[0] as object)).toBe(false);
    expect(isBar('0.1.2.3.')).toBe(true);
    expect(isBar('0.1.4...')).toBe(false);
  });

  it('labels pads with their own glyphs', () => {
    expect(barLabel('0.10.1..', ['L', 'R'])).toBe('L· RL ·R ··');
    expect(patternLabel('0.10.1..')).toBe('●· ●● ·● ··');
  });

  it('plays a note only with a move on its pad', () => {
    const t = newTrack(pads);
    expect(judgeHit(t, pads, 2.01, 0)).toMatchObject({ grade: 'perfect', note: 0 });
    expect(judgeHit(t, pads, 2.5, 1)).toMatchObject({ grade: 'perfect', note: 1, combo: 2 });
    // A move without a pad fits any note.
    expect(judgeHit(t, pads, 2.75)).toMatchObject({ grade: 'perfect', note: 2 });
  });

  it('counts the wrong pad as a miss for that note, and leaves the next note on the right pad', () => {
    const t = newTrack(pads);
    const j = judgeHit(t, pads, 2.5, 0);
    expect(j).toMatchObject({ grade: 'miss', note: 1, wrong: true, combo: 0, points: 0 });
    expect(judgeHit(t, pads, 2.76, 0)).toMatchObject({ grade: 'perfect', note: 2 });
    expect(t.judged).toEqual([null, 'miss', 'perfect', null]);
  });

  it('does not excuse the wrong pad as a follow-through', () => {
    const t = newTrack(pads);
    judgeHit(t, pads, 2, 0);
    expect(judgeHit(t, pads, 2.45, 0)).toMatchObject({ grade: 'miss', note: 1, wrong: true });
  });

  it("prefers the move's own pad when notes on both pads are near", () => {
    const t = newTrack(pads);
    expect(judgeHit(t, pads, 2.62, 0)).toMatchObject({ grade: 'good', note: 2 });
    expect(t.judged[1]).toBeNull();
  });

  it('treats a wrong pad far from any note as a stray move', () => {
    const t = newTrack(pads);
    expect(judgeHit(t, pads, 2.2, 1)).toMatchObject({ grade: 'miss', note: null });
    expect(t.stray).toBe(1);
    expect(t.judged[0]).toBeNull();
  });

  it('finds the note coming up for the pulses, counting one on the beat itself', () => {
    expect(upcomingNote(pads, 1)).toBe(0);
    expect(upcomingNote(pads, 2.04)).toBe(0);
    expect(upcomingNote(pads, 2.06)).toBe(1);
    expect(upcomingNote(pads, 3.4)).toBe(-1);
  });

  it('has computer players pick the right pad more often when wide awake', () => {
    const c = makeChart(SONGS.bongocouch, createRng(5));
    const rightPads = (skill: number) => {
      let right = 0;
      let all = 0;
      for (let seed = 1; seed <= 20; seed++) {
        for (const m of cpuMoves(c, createRng(seed), skill)) {
          const near = c.notes.reduce((a, b) => (Math.abs(b.time - m.time) < Math.abs(a.time - m.time) ? b : a));
          all += 1;
          if (m.pad === near.pad) right += 1;
        }
      }
      return right / all;
    };
    const awake = rightPads(1);
    const sleepy = rightPads(0);
    expect(awake).toBeGreaterThan(sleepy);
    expect(awake).toBeGreaterThan(0.95);
    expect(sleepy).toBeGreaterThan(0.8);
    let played = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const t = replay(c, cpuMoves(c, createRng(seed), 1));
      played += t.perfect + t.good;
    }
    expect(played / (20 * c.notes.length)).toBeGreaterThan(0.85);
  });
});

// Held notes at 120 BPM: held from 2 to 3, from 3.5 to 4.25 (on into the next bar), and a plain note at 5.
const held = chartFromBars(['x===..x=', '=...x...'], 120, 4, 4);

describe('held notes', () => {
  it('times each hold and its end, also across a bar line', () => {
    expect(held.notes.map((n) => [n.time, n.hold, n.release])).toEqual([
      [2, 1, 3],
      [3.5, 0.75, 4.25],
      [5, undefined, undefined],
    ]);
    expect('hold' in (held.notes[2] as object)).toBe(false);
    expect(hasHolds(held)).toBe(true);
    expect(hasHolds(chart)).toBe(false);
    expect(patternLabel('x===....')).toBe('●– –– ·· ··');
  });

  it('refuses a hold with no note before it', () => {
    expect(() => chartFromBars(['x.=.....'], 120)).toThrow();
    expect(() => chartFromBars(['=.......'], 120)).toThrow();
    expect(() => chartFromBars(['x.......', '=.......'], 120)).toThrow();
    expect(() => chartFromBars(['x=======', '=.......'], 120)).not.toThrow();
  });

  it('judges the press like any note, then the release on its own for fewer points', () => {
    const t = newTrack(held);
    expect(judgeHit(t, held, 2.02)).toMatchObject({ grade: 'perfect', note: 0 });
    expect(t.holding).toBe(0);
    expect(judgeRelease(t, held, 3.05)).toMatchObject({ grade: 'perfect', note: 0, release: true, combo: 1, points: RHYTHM.releasePoints.perfect });
    expect(t.holding).toBe(-1);
    expect(t.released[0]).toBe('perfect');
    judgeHit(t, held, 3.5);
    expect(judgeRelease(t, held, 4.4)).toMatchObject({ grade: 'good', points: RHYTHM.releasePoints.good });
    expect(t.ends).toEqual({ perfect: 1, good: 1, miss: 0 });
    expect(t.score).toBe(RHYTHM.points.perfect * 2 + RHYTHM.comboStep + RHYTHM.releasePoints.perfect + RHYTHM.releasePoints.good);
    expect(RHYTHM.releasePoints.perfect).toBeLessThan(RHYTHM.points.perfect);
    expect(releaseGrade(-RHYTHM.release.good)).toBe('good');
    expect(releaseGrade(RHYTHM.release.good + 0.01)).toBe('miss');
  });

  it('gives nothing for letting go a bit early, and breaks the note and combo far too early', () => {
    const t = newTrack(held);
    judgeHit(t, held, 2);
    const early = judgeRelease(t, held, 3 - (RHYTHM.release.good + RHYTHM.breakEarly) / 2);
    expect(early).toMatchObject({ grade: 'miss', release: true, combo: 1, points: 0 });
    expect(early?.broken).toBeUndefined();
    judgeHit(t, held, 3.5);
    expect(t.combo).toBe(2);
    expect(judgeRelease(t, held, 3.7)).toMatchObject({ grade: 'miss', broken: true, combo: 0 });
    expect(t.combo).toBe(0);
    expect(t.ends.miss).toBe(2);
  });

  it('ends a hold kept down well past its end, without points', () => {
    const t = newTrack(held);
    judgeHit(t, held, 2);
    expect(sweepHolds(t, held, 3 + RHYTHM.release.good - 0.05)).toBeNull();
    expect(sweepHolds(t, held, 3 + RHYTHM.release.good + 0.05)).toMatchObject({ grade: 'miss', note: 0, release: true, combo: 1 });
    expect(t.holding).toBe(-1);
    expect(t.released[0]).toBe('miss');
    expect(judgeRelease(t, held, 3.3)).toBeNull();
  });

  it('has nothing to let go of after a missed press, or for a plain note', () => {
    const t = newTrack(held);
    expect(judgeHit(t, held, 2.2)).toMatchObject({ grade: 'miss', note: 0 });
    expect(t.released[0]).toBe('miss');
    expect(judgeRelease(t, held, 3)).toBeNull();
    expect(sweepMisses(t, held, 4)).toEqual([1]);
    expect(t.released[1]).toBe('miss');
    expect(judgeHit(t, held, 5)).toMatchObject({ grade: 'perfect', note: 2 });
    expect(t.holding).toBe(-1);
    expect(judgeRelease(t, held, 5.1)).toBeNull();
    expect(t.released[2]).toBeNull();
  });

  it('ends the old hold when a new note is pressed without letting go', () => {
    const t = newTrack(held);
    judgeHit(t, held, 2);
    judgeHit(t, held, 3.5);
    expect(t.released[0]).toBe('miss');
    expect(t.ends.miss).toBe(1);
    expect(t.holding).toBe(1);
  });

  it('has computer players let go near the end, more cleanly when wide awake', () => {
    const c = makeChart(SONGS.kettlechoir, createRng(6));
    const clean = (skill: number) => {
      let n = 0;
      let pressed = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const moves = cpuMoves(c, createRng(seed), skill);
        expect(moves.filter((m) => m.up)).toHaveLength(moves.filter((m) => !m.up).length);
        const t = replay(c, moves);
        // Every note pressed well ends one way or another.
        expect(t.ends.perfect + t.ends.good + t.ends.miss).toBe(t.perfect + t.good);
        expect(t.holding).toBe(-1);
        n += t.ends.perfect + t.ends.good;
        pressed += t.perfect + t.good;
      }
      return n / pressed;
    };
    const awake = clean(1);
    const sleepy = clean(0);
    expect(awake).toBeGreaterThan(sleepy);
    expect(awake).toBeGreaterThan(0.85);
    expect(sleepy).toBeGreaterThan(0.3);
  });
});
