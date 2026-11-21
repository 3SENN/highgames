// Something's Off: a cosy room full of stuff. The lights flicker off for a moment and when they come back, one
// thing is different: it moved, changed colour, got a tiny hat, vanished or turned upside down. Pick it on your
// phone: the fastest right answers score 3, 2 and 1; a wrong guess sits you out for the rest of the round.
// The changes get smaller and sneakier as the rounds go on.
import { type Rng, pick, shuffle } from '../rng';

export const DIFFERENT = {
  rounds: 5,
  look: [3.2, 2.6, 2.4, 2.2, 2.0], // seconds to take the room in before the lights go, per round
  dark: 0.9, // seconds the lights are off
  answerTime: 6.5, // seconds to answer once the lights are back
  points: [3, 2, 1],
  options: 6, // buttons on the phone
  subtlest: 0.35, // the size of the change in the last round (1 = the first round's)
} as const;

/** Everything in the room that can change, in a fixed order (the TV builds them in this order too). */
export const THINGS = ['Plant', 'Lamp', 'Cat', 'Pizza box', 'Clock', 'Mug', 'Poster', 'Guitar', 'Sock', 'Snack bowl'] as const;
export type ThingName = (typeof THINGS)[number];
/** How easy each thing is to keep an eye on: 1 big, 2 medium, 3 small. */
export const THING_SIZE: readonly (1 | 2 | 3)[] = [1, 1, 2, 2, 3, 3, 1, 1, 3, 2];
/** Which sizes each round picks from: big things first, small things last. */
const SIZES_BY_STEP: readonly (readonly number[])[] = [[1], [1, 2], [2], [2, 3], [3]];

export const CHANGES = ['gone', 'flip', 'colour', 'hat', 'move'] as const;
export type Change = (typeof CHANGES)[number];

/** What the TV says when it shows what changed. */
export const CHANGE_WORDS: Record<Change, string> = {
  gone: 'Gone!',
  flip: 'Upside down!',
  colour: 'New colour!',
  hat: 'Tiny hat!',
  move: 'Moved!',
};

export interface DiffRound {
  /** Index into THINGS. */
  thing: number;
  change: Change;
  /** How big the change is: 1 (obvious) down to DIFFERENT.subtlest. */
  amount: number;
  /** Which way a move goes or a colour turns. */
  dir: -1 | 1;
  /** The things on the phone's buttons (indexes into THINGS), shuffled; one of them is `thing`. */
  options: number[];
  /** Where `thing` is in `options`. */
  answer: number;
  /** 0 in the first round … 1 in the last. */
  subtle: number;
}

/** Plans the whole game: a different thing every round, every kind of change before any repeats. */
export function planGame(rng: Rng, rounds: number = DIFFERENT.rounds): DiffRound[] {
  const all = THINGS.map((_, i) => i);
  const used = new Set<number>();
  let bag: Change[] = [];
  const out: DiffRound[] = [];
  for (let r = 0; r < rounds; r++) {
    if (bag.length === 0) bag = shuffle(rng, CHANGES);
    const change = bag.shift() as Change;
    const subtle = rounds > 1 ? r / (rounds - 1) : 0;
    const sizes = SIZES_BY_STEP[Math.round(subtle * (SIZES_BY_STEP.length - 1))] ?? [1, 2, 3];
    let pool = all.filter((i) => !used.has(i) && sizes.includes(THING_SIZE[i] ?? 1));
    if (pool.length === 0) pool = all.filter((i) => !used.has(i));
    if (pool.length === 0) pool = all;
    const thing = pick(rng, pool);
    used.add(thing);
    const others = shuffle(
      rng,
      all.filter((i) => i !== thing),
    ).slice(0, DIFFERENT.options - 1);
    const options = shuffle(rng, [thing, ...others]);
    out.push({
      thing,
      change,
      amount: 1 - (1 - DIFFERENT.subtlest) * subtle,
      dir: rng() < 0.5 ? -1 : 1,
      options,
      answer: options.indexOf(thing),
      subtle,
    });
  }
  return out;
}

/** Points for one round from when each seat answered right (seconds), or null: 3, 2, 1; equal times share. */
export function roundPoints(rightAt: readonly (number | null)[]): number[] {
  const sorted = rightAt.filter((t): t is number => t !== null).sort((a, b) => a - b);
  return rightAt.map((t) => (t === null ? 0 : (DIFFERENT.points[sorted.indexOf(t)] ?? 0)));
}

/** Total points first; equal points are broken by the total time it took to answer. */
export function differentScores(points: readonly number[], totalTime: readonly number[]): number[] {
  return points.map((p, i) => p * 1000 - (totalTime[i] ?? 0));
}

/** How likely a computer player spots the change: sharp ones nearly always, sleepy ones about half the time. */
export function spotChance(skill: number, subtle: number): number {
  return Math.min(0.97, Math.max(0.1, 0.5 + 0.45 * skill - 0.25 * subtle * (1 - 0.4 * skill)));
}

/** A computer player's answer: when (seconds after the lights come back) and which button. */
export function cpuAnswer(rng: Rng, round: DiffRound, skill: number): { at: number; pick: number } {
  const at = 1.0 + (1 - skill) * 2.0 + round.subtle * 1.0 + rng() * 1.2;
  if (rng() < spotChance(skill, round.subtle)) return { at, pick: round.answer };
  const wrong = round.options.map((_, i) => i).filter((i) => i !== round.answer);
  return { at: at * 0.85, pick: pick(rng, wrong) };
}
