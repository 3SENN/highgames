// Hammock Sway: a lazy song on the beach at sunset. Tip your phone over to the other side on the beat and your
// hammock swings that way. Scoring is the rhythm kit's (game/minigames/rhythm.ts); this file holds the song itself
// (its tempo, phrases, chords and tune) and what the TV says about a run through it.
import type { Chart, SongSpec, Track } from './rhythm';

/**
 * Slow and lazy: 70 BPM, eight bars of mostly half notes (a sway on beats one and three), with a few runs of
 * quarter notes in the last bars. About 34 seconds with the count-in and the tail.
 */
export const HAMMOCK_SONG = {
  bpm: 70,
  bars: 8,
  phrase: 2,
  countIn: 4,
  tail: 4,
  tiers: [
    ['x...x...', 'x...x...|x.......', 'x.......|x...x...'],
    ['x...x...|x...x.x.', 'x...x.x.|x...x...', 'x...x...|x.x.x...'],
    ['x.x.x.x.|x...x...', 'x...x.x.|x.x.x...', 'x.x.x...|x.x.x.x.'],
  ],
} as const satisfies SongSpec;

/**
 * The music, in the shape of the rhythm kit's Groove (tv/minigames/rhythm-kit.ts): a sleepy island turn in A major
 * (Amaj9, F#m9, Dmaj9, E9sus), a shuffle on the hats, bass walking up into each bar, and a vibraphone line that
 * takes its time.
 */
export const HAMMOCK_GROOVE = {
  chords: [
    [61, 64, 68, 71],
    [57, 61, 64, 68],
    [57, 61, 64, 66],
    [57, 59, 62, 66],
  ],
  bass: [45, 42, 38, 40],
  kick: [0, 8],
  snare: [4, 12],
  hats: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15],
  keys: [0, 8],
  bassSteps: [0, 8, 14],
  swing: 0.24,
  cutoff: 1150,
  lead: [
    [
      [0, 76, 6],
      [6, 73, 2],
      [8, 71, 8],
    ],
    [
      [2, 69, 4],
      [6, 71, 2],
      [8, 73, 6],
      [14, 76, 2],
    ],
    [
      [0, 78, 6],
      [6, 76, 2],
      [8, 73, 4],
      [12, 71, 4],
    ],
    [
      [0, 69, 8],
      [10, 71, 2],
      [12, 74, 4],
    ],
  ],
} as const;

export type Side = -1 | 1;

/** Each sway tips the hammock over to the other side. */
export function swayTo(side: Side): Side {
  return side === 1 ? -1 : 1;
}

/** How far the hammock swings out (radians) for a sway: further for a clean one, a lurch for a clumsy one. */
export function swingFor(grade: 'perfect' | 'good' | 'miss'): number {
  return grade === 'perfect' ? 0.5 : grade === 'good' ? 0.38 : 0.18;
}

/** The results line: "14 of 18 sways · best run 9". */
export function swayDetail(track: Track, chart: Chart): string {
  return `${track.perfect + track.good} of ${chart.notes.length} sways · best run ${track.best}`;
}
