// The rhythm kit's rules (Lo-Fi Session): beat charts, judging moves against them, combos and scores.
// Times are seconds of song time (the game clock since the song started). A bar is four beats, written as eight
// slots of eighth notes: 'x' expects a move, '.' is a rest. Even slots land on the beat, odd ones on the "and".
// Two extras, for games that want them:
//  - pads: '0'-'3' instead of 'x' puts the note on that drum pad (lane); only a move on that pad plays it.
//  - held notes: '=' after a note keeps it held through that eighth ('x===' is held for two beats, and may run on
//    into the next bar). Press on the start, let go on the end: the release is judged too, for a smaller score.
import type { Rng } from '../rng';

export const RHYTHM = {
  /** Seconds off the note that still count as perfect / good. */
  perfect: 0.07,
  good: 0.15,
  /** A move this close to an unjudged note is judged against it (past `good` that note is a miss). */
  reach: 0.25,
  /** Moves from one player closer together than this count once (a double tap, a jittery sensor). */
  debounce: 0.08,
  /**
   * The follow-through after a good move: a nod or strum swings back, and the phone may report that too.
   * In this time ONE move that would not land well is ignored instead of costing a miss. Only one, and only this
   * soon, so moving steadily on every eighth through the rests doesn't pay.
   */
  grace: 0.28,
  points: { perfect: 100, good: 50 },
  /** Extra points per step of combo, up to `comboCap` steps. */
  comboStep: 10,
  comboCap: 10,
  /** Points off for a move with no note near it (flailing through a rest). */
  strayPenalty: 25,
  /** Held notes: seconds off the end that still count as a perfect / good release (letting go is less precise). */
  release: { perfect: 0.1, good: 0.2 },
  /** Letting go this much before the end breaks the note (and the combo); a little early just earns nothing. */
  breakEarly: 0.4,
  /** Points for a clean release: on top of the press, and smaller. */
  releasePoints: { perfect: 50, good: 25 },
  /** A pulse to the phones names the pad of a note this little behind the beat (it is being played right now). */
  pulseLead: 0.05,
} as const;

export type Grade = 'perfect' | 'good' | 'miss';

export interface Note {
  /** Song time in seconds. */
  time: number;
  /** Song time in beats (count-in included). */
  beat: number;
  /** The chart bar (0 = the first bar after the count-in) and the eighth slot in it (0-7). */
  bar: number;
  slot: number;
  /** On the beat (an even slot) rather than the "and" between beats. */
  onBeat: boolean;
  /** Pad charts: the pad (lane) the note is on, 0-3. Absent on charts without pads. */
  pad?: number;
  /** Held notes: seconds to hold it, and the song time to let go. Absent on notes that are just hit. */
  hold?: number;
  release?: number;
}

export interface Chart {
  bpm: number;
  /** Seconds per beat. */
  beat: number;
  /** Each bar's pattern: eight slots of 'x' (move) or '.' (rest), or a pad '0'-'3', or '=' (still held). */
  bars: string[];
  /** Beats of count-in before bar 0. */
  countIn: number;
  /** Song time where bar 0 starts, and where the song ends (after a short tail). */
  start: number;
  end: number;
  notes: Note[];
}

/** A song: its tempo, how long it runs, and the patterns it picks from (easy tiers first). */
export interface SongSpec {
  bpm: number;
  bars: number;
  /** Bars per phrase: each picked pattern runs this long, so it can be learned and repeated. */
  phrase: number;
  countIn: number;
  tail: number;
  /**
   * Patterns from easy to hard. One entry is one bar ('x.x.x.x.'), repeated to fill the phrase, or several bars
   * joined with '|' ('x.x.x.x.|x.......'), cycled to fill it.
   */
  tiers: readonly (readonly string[])[];
}

const BAR = /^[x.0-3=]{8}$/;

/** Eight slots of 'x' (a move), '.' (a rest), '0'-'3' (a move on that pad) or '=' (the note before still held). */
export function isBar(bar: string): boolean {
  return BAR.test(bar);
}

/** Turns bars of patterns into a timed chart. The count-in and the tail are given in beats. */
export function chartFromBars(bars: readonly string[], bpm: number, countIn = 4, tail = 4): Chart {
  const beat = 60 / bpm;
  const start = countIn * beat;
  const notes: Note[] = [];
  let open = false; // the slot before was a note or its hold, so '=' may follow
  bars.forEach((pattern, bar) => {
    if (!isBar(pattern)) throw new Error(`Not a bar pattern: "${pattern}"`);
    for (let slot = 0; slot < 8; slot++) {
      const c = pattern[slot] as string;
      const b = countIn + bar * 4 + slot / 2;
      if (c === '=') {
        const held = notes[notes.length - 1];
        if (!open || !held) throw new Error(`"=" with no note to hold in "${pattern}"`);
        held.release = (b + 0.5) * beat;
        held.hold = (b + 0.5 - held.beat) * beat;
        continue;
      }
      open = c !== '.';
      if (!open) continue;
      const note: Note = { time: b * beat, beat: b, bar, slot, onBeat: slot % 2 === 0 };
      if (c !== 'x') note.pad = Number(c);
      notes.push(note);
    }
  });
  return { bpm, beat, bars: [...bars], countIn, start, end: start + (bars.length * 4 + tail) * beat, notes };
}

/** How many pads a chart uses (0 for a chart without pads). */
export function padCount(chart: Chart): number {
  return chart.notes.reduce((n, note) => (note.pad === undefined ? n : Math.max(n, note.pad + 1)), 0);
}

/** Whether a chart has held notes. */
export function hasHolds(chart: Chart): boolean {
  return chart.notes.some((n) => n.hold !== undefined);
}

/**
 * The note coming up at song time `time`: the first one not more than `RHYTHM.pulseLead` behind it (so a note on
 * this very beat still counts), or -1 after the last. Pulses use it to tell a pad phone which pad is next.
 */
export function upcomingNote(chart: Chart, time: number): number {
  return chart.notes.findIndex((n) => n.time >= time - RHYTHM.pulseLead);
}

/** Picks a song's phrases (easy first, never the same one twice in a row) and times them. */
export function makeChart(spec: SongSpec, rng: Rng): Chart {
  const phrases = Math.ceil(spec.bars / spec.phrase);
  const bars: string[] = [];
  let prev = '';
  for (let p = 0; p < phrases; p++) {
    const tier = spec.tiers[Math.min(spec.tiers.length - 1, Math.floor((p * spec.tiers.length) / phrases))] ?? [];
    const options = tier.length > 1 ? tier.filter((t) => t !== prev) : tier;
    const entry = options[Math.floor(rng() * options.length)] ?? 'x.x.x.x.';
    prev = entry;
    const parts = entry.split('|');
    for (let i = 0; i < spec.phrase && bars.length < spec.bars; i++) bars.push(parts[i % parts.length] as string);
  }
  return chartFromBars(bars, spec.bpm, spec.countIn, spec.tail);
}

/** The chart bar at a song time (negative during the count-in, past the end in the tail). */
export function barAt(chart: Chart, time: number): number {
  return Math.floor((time - chart.start) / (4 * chart.beat));
}

/**
 * A bar as something to read at a glance: one pair per beat, '●' for a move and '·' for a rest ("●· ●· ●· ●●"),
 * '–' while a note is held.
 */
export function patternLabel(bar: string): string {
  return barLabel(bar);
}

/** `patternLabel`, with a pad's move shown as `pads[pad]` ("L· R· L· RR"). */
export function barLabel(bar: string, pads?: readonly string[]): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    const c = bar[i] ?? '.';
    const glyph = c === '.' ? '·' : c === '=' ? '–' : c === 'x' ? '●' : (pads?.[Number(c)] ?? '●');
    out += (i > 0 && i % 2 === 0 ? ' ' : '') + glyph;
  }
  return out;
}

// ---------------------------------------------------------------- the songs of the Lo-Fi Session games

/** Mellow tempos, 30 to 40 seconds each, no two moves closer than the phone's motion sensing allows. */
export const SONGS = {
  /** Head Nod: nods on beats, then off-beats join in. */
  headnod: {
    bpm: 90,
    bars: 12,
    phrase: 2,
    countIn: 4,
    tail: 4,
    tiers: [
      ['x.x.x.x.', 'x...x...|x.x.x.x.', 'x.x.x...'],
      ['x.x.x.xx', 'x..xx.x.', 'x.xx..x.'],
      ['x..x..x.', 'xx..x.x.', 'x.xxx.x.'],
    ],
  },
  /** Snack Stack: taps, a little busier. */
  snackstack: {
    bpm: 96,
    bars: 12,
    phrase: 2,
    countIn: 4,
    tail: 4,
    tiers: [
      ['x.x.x.x.', 'x...x.x.', 'x.x.x...|x.x.x.x.'],
      ['x.x.xxx.', 'xx..x.x.', 'x.x.x.xx'],
      ['xx.xx.x.', 'x.xxx.xx', 'x..x..x.|xx.xx.x.'],
    ],
  },
  /** Mellow Strum: strums with rests in every bar, sometimes a whole bar to let it ring. */
  strum: {
    bpm: 84,
    bars: 10,
    phrase: 2,
    countIn: 4,
    tail: 4,
    tiers: [
      ['x...x...', 'x.x.x...', 'x...x.x.|x.......'],
      ['x.x.x...|x.x.....', 'x..xx...', 'x.x...x.|x.x.x...'],
      ['x.xx..x.', 'xx..xx..', 'x..x..x.|x.......'],
    ],
  },
  /** Couch Bongos: two drums, '0' the left and '1' the right; trading sides, then off-beat answers. */
  bongocouch: {
    bpm: 96,
    bars: 12,
    phrase: 2,
    countIn: 4,
    tail: 4,
    tiers: [
      ['0.1.0.1.', '0.0.1.1.', '0...1...|0.1.0.1.'],
      ['0.1.0.11', '0.1..10.', '00..1.1.', '0.10..1.'],
      ['0.1101..', '01.0.1.1', '0.0110.1', '0..10.1.|0.1.0110'],
    ],
  },
  /** Kettle Choir: held whistles ('=' holds on), short ones of a beat and long ones of two to four. */
  kettlechoir: {
    bpm: 88,
    bars: 10,
    phrase: 2,
    countIn: 4,
    tail: 4,
    tiers: [
      ['x===....', 'x=..x=..', 'x=====..'],
      ['x=..x===|====....', 'x==.x==.', 'x=.x=...|x===....'],
      ['x=.x====|==..x=..', 'x=.x=.x=|=====...', 'x======.|x=..x=..'],
    ],
  },
} as const satisfies Record<string, SongSpec>;

// ---------------------------------------------------------------- judging

/** One player's run through a chart. */
export interface Track {
  /** Per note: how it went, or null while it is still to come. */
  judged: (Grade | null)[];
  combo: number;
  best: number;
  perfect: number;
  good: number;
  miss: number;
  /** Moves with no note near them. */
  stray: number;
  score: number;
  /** Song time of the last move that counted, and of the last one that landed well. */
  lastHit: number;
  lastGood: number;
  /** Held notes: how each one's release went ('miss' once it can no longer end well), null for other notes. */
  released: (Grade | null)[];
  /** The held note being held down now, or -1. */
  holding: number;
  /** Releases of held notes that were pressed well, by grade. */
  ends: Record<Grade, number>;
}

export function newTrack(chart: Chart): Track {
  return {
    judged: chart.notes.map(() => null),
    combo: 0,
    best: 0,
    perfect: 0,
    good: 0,
    miss: 0,
    stray: 0,
    score: 0,
    lastHit: -Infinity,
    lastGood: -Infinity,
    released: chart.notes.map(() => null),
    holding: -1,
    ends: { perfect: 0, good: 0, miss: 0 },
  };
}

export interface Judgement {
  grade: Grade;
  /** The note it was judged against; null for a move with no note near it. */
  note: number | null;
  /** Seconds early (negative) or late; null when nothing was hit. */
  offset: number | null;
  /** The combo after this. */
  combo: number;
  points: number;
  /** Pad charts: the move was on another pad than the note's (a miss for that note). */
  wrong?: boolean;
  /** Held notes: this judges letting go, not the press. */
  release?: boolean;
  /** A release so early that the note broke off (and the combo with it). */
  broken?: boolean;
}

export function gradeFor(offset: number): Grade {
  const d = Math.abs(offset);
  return d <= RHYTHM.perfect + 1e-9 ? 'perfect' : d <= RHYTHM.good + 1e-9 ? 'good' : 'miss';
}

/** The grade for letting go of a held note `offset` seconds off its end. */
export function releaseGrade(offset: number): Grade {
  const d = Math.abs(offset);
  return d <= RHYTHM.release.perfect + 1e-9 ? 'perfect' : d <= RHYTHM.release.good + 1e-9 ? 'good' : 'miss';
}

/** Points for a hit that brings the combo to `combo`. */
export function hitPoints(grade: Grade, combo: number): number {
  if (grade === 'miss') return 0;
  return RHYTHM.points[grade] + RHYTHM.comboStep * Math.min(Math.max(0, combo - 1), RHYTHM.comboCap);
}

/** A note that will never be played well: a held one can no longer end well either. */
function missNote(track: Track, chart: Chart, i: number): void {
  track.judged[i] = 'miss';
  track.miss += 1;
  track.combo = 0;
  if (chart.notes[i]?.hold !== undefined && track.released[i] === null) track.released[i] = 'miss';
}

/**
 * Judges a move at song time `time` against the nearest note nobody judged yet. Returns null when the move is
 * ignored: before the first note or after the last, a double report, or a follow-through that would not land.
 *
 * On a pad chart, pass the `pad` the move was on. A note on the same pad within the good window is played; else a
 * move within the good window of a note on another pad is a miss for that note (`wrong`), and leaves the notes on
 * its own pad for the right move. Moves without a pad, and notes without one, fit any pad.
 */
export function judgeHit(track: Track, chart: Chart, time: number, pad?: number): Judgement | null {
  const notes = chart.notes;
  const first = notes[0];
  const last = notes[notes.length - 1];
  if (!first || !last || time < first.time - RHYTHM.reach || time > last.time + RHYTHM.reach) return null;
  if (time - track.lastHit < RHYTHM.debounce) return null;
  track.lastHit = time;

  const fits = (n: Note) => pad === undefined || n.pad === undefined || n.pad === pad;
  let nearest = -1;
  let dist = Infinity;
  let mine = -1;
  let mineDist = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i] as Note;
    if (n.time - time > RHYTHM.reach) break;
    if (track.judged[i] !== null) continue;
    const d = Math.abs(n.time - time);
    if (d > RHYTHM.reach) continue;
    if (d < dist) {
      dist = d;
      nearest = i;
    }
    if (d < mineDist && fits(n)) {
      mineDist = d;
      mine = i;
    }
  }
  const good = RHYTHM.good + 1e-9;
  if (nearest >= 0 && nearest !== mine && !(mine >= 0 && mineDist <= good) && dist <= good) {
    // The other pad, right as its note came: that note is missed (follow-through or not), the next one stays.
    missNote(track, chart, nearest);
    return { grade: 'miss', note: nearest, offset: time - (notes[nearest] as Note).time, combo: 0, points: 0, wrong: true };
  }
  // From here on, notes on other pads are as good as not there.
  const target = mine;
  const following = time - track.lastGood < RHYTHM.grace;
  if (target < 0) {
    if (following) {
      track.lastGood = -Infinity; // the follow-through is used up
      return null;
    }
    track.combo = 0;
    track.stray += 1;
    const before = track.score;
    track.score = Math.max(0, track.score - RHYTHM.strayPenalty);
    return { grade: 'miss', note: null, offset: null, combo: 0, points: track.score - before };
  }
  const note = notes[target] as Note;
  const offset = time - note.time;
  const grade = gradeFor(offset);
  if (grade === 'miss' && following) {
    track.lastGood = -Infinity;
    return null;
  }
  if (grade === 'miss') {
    missNote(track, chart, target);
    return { grade, note: target, offset, combo: 0, points: 0 };
  }
  track.judged[target] = grade;
  track.combo += 1;
  track.best = Math.max(track.best, track.combo);
  track[grade] += 1;
  track.lastGood = time;
  if (note.hold !== undefined) {
    // A new hold while another is still down: the old one can no longer end well.
    if (track.holding >= 0 && track.holding !== target) settleHold(track);
    track.holding = target;
  }
  const points = hitPoints(grade, track.combo);
  track.score += points;
  return { grade, note: target, offset, combo: track.combo, points };
}

/** The held note being held ends without a release to judge (it ran over, or a new press came first). */
function settleHold(track: Track): number {
  const k = track.holding;
  track.holding = -1;
  if (k < 0 || track.released[k] !== null) return -1;
  track.released[k] = 'miss';
  track.ends.miss += 1;
  return k;
}

/**
 * Judges letting go of the held note being held, at song time `time`. Near its end is a clean release worth
 * `RHYTHM.releasePoints`; more than `RHYTHM.breakEarly` before it breaks the note and the combo; anything else
 * earns nothing. Returns null when nothing is held (a tap note's release, or one after a missed press).
 */
export function judgeRelease(track: Track, chart: Chart, time: number): Judgement | null {
  const k = track.holding;
  const n = chart.notes[k];
  if (k < 0 || !n || n.release === undefined) return null;
  track.holding = -1;
  if (track.released[k] !== null) return null;
  const offset = time - n.release;
  const grade = releaseGrade(offset);
  track.released[k] = grade;
  track.ends[grade] += 1;
  if (grade === 'miss') {
    const broken = offset < -RHYTHM.breakEarly;
    if (broken) track.combo = 0;
    return { grade, note: k, offset, combo: track.combo, points: 0, release: true, ...(broken ? { broken: true } : {}) };
  }
  const points = RHYTHM.releasePoints[grade];
  track.score += points;
  return { grade, note: k, offset, combo: track.combo, points, release: true };
}

/** Marks every note that slid past unplayed as a miss. Returns the notes that were missed just now. */
export function sweepMisses(track: Track, chart: Chart, time: number): number[] {
  const missed: number[] = [];
  for (let i = 0; i < chart.notes.length; i++) {
    const n = chart.notes[i] as Note;
    if (n.time + RHYTHM.reach >= time) break;
    if (track.judged[i] !== null) continue;
    missNote(track, chart, i);
    missed.push(i);
  }
  return missed;
}

/**
 * Ends a hold kept down well past its note's end: a release 'miss' (no points; the combo stays). Returns that
 * judgement, or null while the hold may still end well.
 */
export function sweepHolds(track: Track, chart: Chart, time: number): Judgement | null {
  const n = chart.notes[track.holding];
  if (!n || n.release === undefined || time <= n.release + RHYTHM.release.good) return null;
  const k = settleHold(track);
  return k < 0 ? null : { grade: 'miss', note: k, offset: time - n.release, combo: track.combo, points: 0, release: true };
}

/** "12 perfect · 3 good · 2 miss" (strays count as misses: the phone said "Miss" for each). */
export function summary(track: Track): string {
  return `${track.perfect} perfect · ${track.good} good · ${track.miss + track.stray} miss`;
}

// ---------------------------------------------------------------- computer players

/** A normally distributed number (mean 0, deviation 1). */
function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * When a computer player moves, planned ahead for the whole chart: it plays most notes, a little off the beat.
 * `skill` 0 (sleepy) to 1 (wide awake) sets how many notes it plays and how tight its timing is.
 */
export function cpuHits(chart: Chart, rng: Rng, skill: number): number[] {
  const s = Math.min(1, Math.max(0, skill));
  const play = 0.72 + 0.22 * s;
  const spread = 0.035 + (1 - s) * 0.08;
  const lean = (rng() - 0.5) * 0.05 * (1 - s); // some lag a touch, some rush
  const hits: number[] = [];
  for (const n of chart.notes) {
    const err = Math.max(-0.2, Math.min(0.2, lean + gauss(rng) * spread));
    if (rng() < play) hits.push(n.time + err);
  }
  return hits.sort((a, b) => a - b);
}

/** A computer player's move: a hit (on `pad`, for pad charts), or letting go of a held note (`up`). */
export interface CpuMove {
  time: number;
  pad?: number;
  up?: boolean;
}

/**
 * A computer player's moves for any chart. On a plain chart these are exactly `cpuHits`. On a pad chart it picks
 * the right pad most of the time (more often when awake); on held notes it lets go near the end, give or take,
 * and now and then drifts off and lets go far too early (more often when sleepy).
 */
export function cpuMoves(chart: Chart, rng: Rng, skill: number): CpuMove[] {
  if (padCount(chart) === 0 && !hasHolds(chart)) return cpuHits(chart, rng, skill).map((time) => ({ time }));
  const s = Math.min(1, Math.max(0, skill));
  const play = 0.72 + 0.22 * s;
  const spread = 0.035 + (1 - s) * 0.08;
  const lean = (rng() - 0.5) * 0.05 * (1 - s);
  const right = 0.9 + 0.09 * s;
  const pads = Math.max(2, padCount(chart));
  const drift = 0.03 + 0.12 * (1 - s);
  const letGo = 0.045 + (1 - s) * 0.09;

  const presses: { note: Note; move: CpuMove }[] = [];
  for (const n of chart.notes) {
    const err = Math.max(-0.2, Math.min(0.2, lean + gauss(rng) * spread));
    if (rng() >= play) continue;
    const move: CpuMove = { time: n.time + err };
    if (n.pad !== undefined) move.pad = rng() < right ? n.pad : (n.pad + 1 + Math.floor(rng() * (pads - 1))) % pads;
    presses.push({ note: n, move });
  }
  const moves: CpuMove[] = presses.map((p) => p.move);
  presses.forEach(({ note, move }, k) => {
    if (note.release === undefined) return;
    let up = rng() < drift ? move.time + (note.release - move.time) * (0.2 + 0.45 * rng()) : note.release + lean + gauss(rng) * letGo;
    const next = presses[k + 1]?.move.time ?? Infinity;
    up = Math.max(move.time + 0.05, Math.min(up, next - 0.03));
    moves.push({ time: up, up: true });
  });
  return moves.sort((a, b) => a.time - b.time);
}

/**
 * Plays moves (in time order) through a fresh track the way the round does for a computer seat: misses swept as
 * time passes, a press while holding ends that hold first. For tests and balancing.
 */
export function replay(chart: Chart, moves: readonly CpuMove[], track: Track = newTrack(chart)): Track {
  for (const m of moves) {
    sweepMisses(track, chart, m.time);
    sweepHolds(track, chart, m.time);
    if (m.up) {
      judgeRelease(track, chart, m.time);
      continue;
    }
    if (track.holding >= 0) judgeRelease(track, chart, m.time);
    judgeHit(track, chart, m.time, m.pad);
  }
  sweepMisses(track, chart, chart.end + 1);
  sweepHolds(track, chart, chart.end + 1);
  return track;
}
