// Where Are My Keys? Everyone's keys get tucked into spots around the living room while you watch. Then the
// lights dim, the cushions get fluffed and the cat wanders through (and from round two it bats a keychain or
// two somewhere else). Press the spot where YOUR keys are: the first right answer scores most.
import { type Rng, pick, shuffle } from '../rng.js';

export const KEYS = {
  rounds: 3,
  answerTime: 6, // seconds to answer
  lockout: 1.5, // seconds a wrong press locks you out
  points: [4, 3, 2, 1],
  catMoves: [0, 1, 2], // keychains the cat bats to a new spot, per round
} as const;

/** The hiding spots, in the order of the phone buttons. */
export const SPOTS = ['Couch cushions', 'Fridge', 'Plant pot', 'Hoodie', 'Cereal box', 'Under the rug'] as const;

export interface KeyMove {
  seat: number;
  from: number;
  to: number;
}

export interface KeyRound {
  /** For each seat, the spot its keys are tucked into first. */
  hidden: number[];
  /** What the cat does afterwards, in order. */
  moves: KeyMove[];
  /** For each seat, where its keys really are at the end: the right answer. */
  final: number[];
}

/** Hides every seat's keys in a different spot, then lets the cat move a few of them. */
export function planRound(rng: Rng, seats: number, round: number): KeyRound {
  const all = SPOTS.map((_, i) => i);
  const hidden = shuffle(rng, all).slice(0, seats);
  const final = [...hidden];
  const moves: KeyMove[] = [];
  const count = Math.min(seats, KEYS.catMoves[Math.min(round, KEYS.catMoves.length - 1)] ?? 0);
  for (const seat of shuffle(
    rng,
    hidden.map((_, i) => i),
  ).slice(0, count)) {
    const from = final[seat] as number;
    const to = pick(
      rng,
      all.filter((s) => s !== from),
    );
    moves.push({ seat, from, to });
    final[seat] = to;
  }
  return { hidden, moves, final };
}

/** Points for one round from the time each seat found its keys (seconds), or null if it didn't. */
export function roundPoints(foundAt: readonly (number | null)[]): number[] {
  const sorted = foundAt.filter((t): t is number => t !== null).sort((a, b) => a - b);
  return foundAt.map((t) => (t === null ? 0 : (KEYS.points[sorted.indexOf(t)] ?? 0)));
}

/** Total points first; equal points are broken by the total time it took to answer. */
export function keysScores(points: readonly number[], totalTime: readonly number[]): number[] {
  return points.map((p, i) => p * 1000 - (totalTime[i] ?? 0));
}

/**
 * A computer player's guess. Sharp ones mostly remember; sleepy ones mix things up, and when the cat moved
 * their keys they tend to guess where the keys were first.
 */
export function cpuGuess(rng: Rng, plan: KeyRound, seat: number, skill: number, attempt: number): number {
  const right = plan.final[seat] as number;
  const moved = plan.moves.some((m) => m.seat === seat);
  const remember = Math.min(0.97, 0.5 + skill * 0.42 - (moved ? 0.12 : 0) + attempt * 0.25);
  if (rng() < remember) return right;
  const first = plan.hidden[seat] as number;
  if (moved && first !== right && rng() < 0.6) return first;
  return pick(
    rng,
    SPOTS.map((_, i) => i).filter((s) => s !== right),
  );
}
