// Wind Chimes: a night on the porch with a row of hanging chimes, one per player. Leaves drift in on the breeze;
// wave the phone on the beat as one reaches your chime and it rings. Every ring is a note of one pentatonic scale,
// so whatever anyone plays, it sounds pretty together. Judging and scoring are the rhythm kit's (rhythm.ts).
import type { SongSpec, Track } from './rhythm';

/** A slow, dreamy 76 BPM: long rests to let the chimes ring, a few off-beat flutters later on. */
export const CHIME_SONG = {
  bpm: 76,
  bars: 9,
  phrase: 2,
  countIn: 4,
  tail: 4,
  tiers: [
    ['x...x...', 'x...x...|x.x.....', 'x.x.....|x...x...'],
    ['x.x.x...', 'x...x.x.|x.x.x...', 'x..x..x.|x...x...'],
    ['x..x..x.|x...x.x.', 'x.x..x..|x.x.x...', 'x.xx..x.|x...x...'],
  ],
} as const satisfies SongSpec;

/** F major pentatonic (F G A C D), from F5 up: the notes the chimes are tuned to. */
export const PENTATONIC = [77, 79, 81, 84, 86, 89, 91, 93, 96, 98] as const;

/** Tubes on each chime. */
export const TUBES = 5;

/** The order the tubes ring in: a gentle rise and fall, like a breeze through them. */
const WALK = [0, 2, 1, 3, 2, 4, 3, 1] as const;

/** Which tube (0 = the longest, lowest) rings for a player's `count`-th ring (0 first). */
export function chimeTube(count: number): number {
  const n = WALK.length;
  return WALK[((count % n) + n) % n] as number;
}

/** The MIDI note of a tube: each chime along the porch is tuned a step of the scale higher than the one before. */
export function chimeNote(seat: number, tube: number): number {
  const i = Math.max(0, Math.min(PENTATONIC.length - 1, (seat % 4) + Math.max(0, Math.min(TUBES - 1, tube))));
  return PENTATONIC[i] as number;
}

/** The results line: "15 rings · best run 8". */
export function chimeDetail(track: Track): string {
  const hits = track.perfect + track.good;
  return `${hits} ring${hits === 1 ? '' : 's'} · best run ${track.best}`;
}
