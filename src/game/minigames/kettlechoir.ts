// Kettle Choir: long whistling notes, held from start to end. Scoring is the rhythm kit's held notes (the press, plus
// a smaller score for letting go cleanly); this adds what the TV shows about it.
import type { Chart, Track } from './rhythm';

/** The results line: "9 of 12 whistles · 6 clean stops". */
export function kettleDetail(track: Track, chart: Chart): string {
  const played = track.perfect + track.good;
  const clean = track.ends.perfect + track.ends.good;
  return `${played} of ${chart.notes.length} whistles · ${clean} clean stop${clean === 1 ? '' : 's'}`;
}

/** How long a held note is, in beats ("short" is one beat, "long" two or more). */
export function holdBeats(chart: Chart, note: number): number {
  const n = chart.notes[note];
  return n?.hold === undefined ? 0 : n.hold / chart.beat;
}
