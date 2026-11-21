// Lava Lamp Says: blobs of four colours light up in the big lava lamp, one after another, each with its own soft
// tone. Everyone repeats the sequence on their phone at the same time. Every round it grows by one colour. One
// wrong colour (or running out of time) and your companion dozes off on the beanbag. Last one remembering wins;
// everyone else ranks by how far they got.
import { type Rng, randInt } from '../rng.js';

export const LAVA = {
  colors: 4,
  start: 3, // colours in the first sequence
  rounds: 6, // at most (so the longest sequence is start + rounds - 1)
  answerTime: 6, // seconds to repeat the sequence
} as const;

/** The first sequence. */
export function startSequence(rng: Rng): number[] {
  let seq: number[] = [];
  while (seq.length < LAVA.start) seq = grow(rng, seq);
  return seq;
}

/** The same sequence with one more colour on the end (never three of the same in a row). */
export function grow(rng: Rng, seq: readonly number[]): number[] {
  const n = seq.length;
  const triple = n >= 2 && seq[n - 1] === seq[n - 2];
  let c = randInt(rng, 0, LAVA.colors - 1);
  if (triple && c === seq[n - 1]) c = (c + 1 + randInt(rng, 0, LAVA.colors - 2)) % LAVA.colors;
  return [...seq, c];
}

/** Seconds between the colours as the lamp plays the sequence: a bit quicker every round. */
export function stepGap(round: number): number {
  return Math.max(0.4, 0.62 - round * 0.04);
}

export interface Rememberer {
  /** Next position in this round's sequence. */
  at: number;
  /** Repeated this round's sequence. */
  done: boolean;
  out: boolean;
  /** Rounds repeated correctly. */
  cleared: number;
  /** Colours right in the round they dozed off in. */
  partial: number;
  /** Seconds spent answering, over all rounds (breaks ties). */
  time: number;
}

export function newRememberer(): Rememberer {
  return { at: 0, done: false, out: false, cleared: 0, partial: 0, time: 0 };
}

/** A new round: back to the start of the (longer) sequence. */
export function startRound(r: Rememberer): void {
  r.at = 0;
  r.done = r.out;
}

export type PressResult = 'good' | 'done' | 'wrong' | 'ignored';

/** One colour pressed, `t` seconds into the answer. */
export function press(r: Rememberer, seq: readonly number[], color: number, t: number): PressResult {
  if (r.out || r.done) return 'ignored';
  if (color !== seq[r.at]) {
    r.out = true;
    r.done = true;
    r.partial = r.at;
    r.time += t;
    return 'wrong';
  }
  r.at += 1;
  if (r.at < seq.length) return 'good';
  r.done = true;
  r.cleared += 1;
  r.time += t;
  return 'done';
}

/** Time's up for this round: anyone still going dozes off. Returns true if this one did. */
export function timeUp(r: Rememberer, limit: number = LAVA.answerTime): boolean {
  if (r.done) return false;
  r.out = true;
  r.done = true;
  r.partial = r.at;
  r.time += limit;
  return true;
}

/** The longest sequence someone repeated. */
export function longest(r: Rememberer): number {
  return r.cleared ? LAVA.start + r.cleared - 1 : 0;
}

/** Rounds first, then colours right in the round you dozed off in, then the quicker answers. */
export function lavaScores(players: readonly Rememberer[]): number[] {
  return players.map((r) => r.cleared * 100 + r.partial * 5 - Math.min(4.9, r.time / 10));
}

// ------------------------------------------------------------------ computer players

/** How many colours a computer player can hold in its head: sleepy about 4, sharp about 8. */
export function cpuSpan(rng: Rng, skill: number): number {
  return 3.3 + skill * 5.2 + (rng() - 0.5) * 1.6;
}

export interface CpuAnswer {
  presses: number[];
  /** Seconds into the answer for each press. */
  times: number[];
}

/**
 * What a computer player presses this round. Within its span it's nearly always right (a sleepy one slips now
 * and then); beyond it, it might still get lucky, but usually loses the thread somewhere past the span.
 */
export function cpuAnswer(rng: Rng, seq: readonly number[], span: number, skill: number): CpuAnswer {
  const n = seq.length;
  let wrongAt = -1;
  if (n <= span) {
    if (rng() < (1 - skill) * 0.07) wrongAt = randInt(rng, 0, n - 1);
  } else if (rng() > 0.3 ** (n - span)) {
    wrongAt = randInt(rng, Math.min(n - 1, Math.max(1, Math.floor(span) - 1)), n - 1);
  }
  const presses: number[] = [];
  const times: number[] = [];
  let t = 0.7 + (1 - skill) * 0.7 + rng() * 0.3;
  for (let i = 0; i < n; i++) {
    const right = seq[i] as number;
    if (i === wrongAt) {
      presses.push((right + 1 + randInt(rng, 0, LAVA.colors - 2)) % LAVA.colors);
      times.push(t);
      break;
    }
    presses.push(right);
    times.push(t);
    t += 0.28 + (1 - skill) * 0.3 + rng() * 0.15;
  }
  return { presses, times };
}
