// Shaker Egg: a kitchen jam session. Everyone sits at the counter with a shaker egg; little eggs roll along a groove
// in the counter toward each player, and a shake on the beat plays one. The second half slips into double time
// (runs of eighth notes). Judging and scoring are the rhythm kit's (rhythm.ts).
import type { Chart, SongSpec, Track } from './rhythm';

/**
 * A bossa at 100 BPM. Four tiers over six two-bar phrases: the first half sits on the beat and the bossa's
 * three-three-two, the second half adds double-time runs.
 */
export const EGG_SONG = {
  bpm: 100,
  bars: 12,
  phrase: 2,
  countIn: 4,
  tail: 4,
  tiers: [
    ['x...x...|x.x.x...', 'x.x.....|x...x...', 'x...x.x.|x.......'],
    ['x..x..x.|x.......', 'x..x..x.|..x..x..', 'x.x..x..|x...x...'],
    ['x...xxxx|x.......', 'x..x..x.|xxxx....', 'xxxx..x.|x...x...'],
    ['x...xxxx|xxxx....', 'xxxx....|x..xxxx.', 'x..x..x.|xxxxxx..'],
  ],
} as const satisfies SongSpec;

/** A double-time bar: a run of four eighth notes or more in a row. */
export function isDoubleTime(bar: string): boolean {
  return /x{4}/.test(bar);
}

/** The chart bars played in double time. */
export function doubleTimeBars(chart: Chart): number[] {
  return chart.bars.flatMap((bar, i) => (isDoubleTime(bar) ? [i] : []));
}

/** The results line: "24 shakes · best run 12". */
export function eggDetail(track: Track): string {
  const hits = track.perfect + track.good;
  return `${hits} shake${hits === 1 ? '' : 's'} · best run ${track.best}`;
}
