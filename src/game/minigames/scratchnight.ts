// Scratch Night: a late-night DJ set in the flat. Each player has a turntable; the record turns once a bar and
// carries the notes round to the stylus, and a swipe on the beat scratches. Judging and scoring are the rhythm
// kit's (rhythm.ts); this holds the song, the record's turn and the results line.
import type { Chart, SongSpec, Track } from './rhythm';

/** A lazy boom-bap set at 92 BPM: scratches on the beat first, then the push-and-pull of off-beat cuts. */
export const SCRATCH_SONG = {
  bpm: 92,
  bars: 12,
  phrase: 2,
  countIn: 4,
  tail: 3,
  tiers: [
    ['x...x...', 'x...x.x.|x...x...', 'x.x.x...|x.......'],
    ['x..x..x.', 'x.x..x..|x...x...', 'x..x....|x..x..x.'],
    ['x..x..x.|x.xx....', 'xx..x...|x..x..x.', 'x..x.xx.|x...x...'],
  ],
} as const satisfies SongSpec;

/** The record turns once a bar (four beats), so each beat line on it passes the stylus on its beat. */
export const BEATS_PER_TURN = 4;

/**
 * How far round the record (radians, the way it spins) a note at song time `noteTime` still is from the stylus at
 * song time `now`: 0 under the stylus, a quarter turn one beat ahead, negative once it has gone past.
 */
export function turnsToStylus(chart: Chart, noteTime: number, now: number): number {
  return ((noteTime - now) / (BEATS_PER_TURN * chart.beat)) * Math.PI * 2;
}

/** The record's own angle at song time `now`: its bar line sits under the stylus at the start of every bar. */
export function recordAngle(chart: Chart, now: number): number {
  return turnsToStylus(chart, chart.start, now);
}

/** The results line: "14 scratches · best run 9". */
export function scratchDetail(track: Track): string {
  const hits = track.perfect + track.good;
  return `${hits} scratch${hits === 1 ? '' : 'es'} · best run ${track.best}`;
}
