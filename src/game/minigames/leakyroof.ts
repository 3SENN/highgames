// Leaky Roof: a rainy night in an attic studio. Drips fall from the roof into a pot in front of each player; tap as
// each drop lands in yours. Every pot rings with its own voice, so the drips that land well play the song's tune in
// harmony. Scoring is the rhythm kit's (game/minigames/rhythm.ts); this file holds the song (tempo, phrases, chords
// and the drip tune), each pot's pitch for a drip, and what the TV says about a run.
import type { Chart, Note, SongSpec, Track } from './rhythm';

/**
 * 84 BPM, ten bars. The first half drips on the beat; from bar six on, drips land on the "and" and leave the next
 * beat empty (syncopation). About 34 seconds with the count-in and the tail.
 */
export const LEAKY_SONG = {
  bpm: 84,
  bars: 10,
  phrase: 2,
  countIn: 4,
  tail: 4,
  tiers: [
    ['x...x...|x.x.x...', 'x.x.x...|x...x.x.', 'x...x.x.|x.x.x.x.'],
    ['x.x.x.x.|x..x..x.', 'x.x.x...|x.x..x..', 'x...x.x.|x..x.x..'],
    ['x..x..x.|x..x.x..', 'x.xx..x.|x..x..x.', 'x..x.x..|x.x..x.x'],
    ['x..x..x.|.x.x..x.', 'x.xx.x..|x..x..x.', 'x..x.xx.|x.xx..x.'],
  ],
} as const satisfies SongSpec;

/** The first chart bar of the song's second half, where the syncopated drips come in. */
export const SECOND_HALF = 5;

/**
 * The music, in the shape of the rhythm kit's Groove (tv/minigames/rhythm-kit.ts): rain-on-the-skylight lo-fi in
 * E minor (Em9, Cmaj9, Am9, B7), muffled keys, ticking off-beat hats. No lead: the drips play the tune.
 */
export const LEAKY_GROOVE = {
  chords: [
    [55, 59, 62, 66],
    [55, 59, 62, 64],
    [55, 59, 60, 64],
    [54, 57, 59, 63],
  ],
  bass: [40, 36, 45, 47],
  kick: [0, 9],
  snare: [4, 12],
  hats: [0, 2, 3, 6, 8, 10, 11, 14],
  keys: [0, 7],
  bassSteps: [0, 8, 11],
  swing: 0.2,
  cutoff: 1100,
} as const;

/**
 * The drip tune: for each bar of the four-chord loop, the note (MIDI) a drip plays on each of the eight slots. The
 * beats carry the line, the "and"s are passing notes of the same chord, so whichever drips the chart picks sing.
 */
export const DRIP_TUNE = [
  [76, 78, 74, 76, 71, 67, 74, 71],
  [76, 79, 74, 76, 71, 74, 67, 71],
  [72, 71, 76, 72, 79, 76, 76, 71],
  [78, 81, 75, 78, 71, 75, 69, 71],
] as const;

/** The chord tones (pitch classes) each pot harmonises with, per bar of the loop: Em, C, Am, B7. */
export const DRIP_CHORDS = [[4, 7, 11], [0, 4, 7], [9, 0, 4], [11, 3, 6, 9]] as const;

/** How many pots (voices) there are: the tune, then each pot a chord tone lower than the one before. */
export const POTS = 4;

const pc = (m: number) => ((m % 12) + 12) % 12;

/**
 * The note (MIDI) a pot plays for a drip: pot 0 sings the tune, pot 1 the chord tone below it, pot 2 the next one
 * down, pot 3 the one below that (an octave under the tune on a triad). Together they harmonise the line.
 */
export function dripPitch(chart: Chart, note: number, pot: number): number {
  const n = chart.notes[note];
  if (!n) return DRIP_TUNE[0][0];
  const bar = ((n.bar % DRIP_TUNE.length) + DRIP_TUNE.length) % DRIP_TUNE.length;
  const tones: readonly number[] = DRIP_CHORDS[bar] as readonly number[];
  let p: number = (DRIP_TUNE[bar] as readonly number[])[n.slot] ?? 71;
  const steps = ((pot % POTS) + POTS) % POTS;
  for (let s = 0; s < steps; s++) {
    p -= 1;
    while (!tones.includes(pc(p))) p -= 1;
  }
  return p;
}

/** A drip on the "and" with nothing on the beat after it: it pushes ahead of the beat. */
export function isSyncopated(chart: Chart, note: Note): boolean {
  if (note.onBeat) return false;
  const next = note.slot + 1 < 8 ? chart.bars[note.bar]?.[note.slot + 1] : chart.bars[note.bar + 1]?.[0];
  return next === undefined || next === '.';
}

/** How full a pot looks after `caught` drips: from a splash in the bottom to nearly brimming, never over. */
export function waterLevel(caught: number, total: number): number {
  return Math.min(0.85, 0.15 + (0.7 * Math.max(0, caught)) / Math.max(1, total));
}

/** The results line: "16 of 20 drips · best run 9". */
export function dripDetail(track: Track, chart: Chart): string {
  return `${track.perfect + track.good} of ${chart.notes.length} drips · best run ${track.best}`;
}
