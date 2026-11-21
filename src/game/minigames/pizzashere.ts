// Pizza's Here! Everyone's on the couch waiting for the pizza. The flat is full of noises (a kettle, a phone
// buzzing, the neighbour's door, a car, the cat knocking something over) and somewhere in there is the real
// doorbell. Tap only on the doorbell: the quickest tap after it wins the round. Jump up at anything else and you
// got up for nothing: you lose a point and sit out the rest of the round.
import { type Rng, pick, randInt } from '../rng';

export const PIZZA = {
  rounds: 6,
  win: 2, // points for the quickest tap after the doorbell
  falseStart: -1, // points for getting up for nothing
  window: 1.3, // seconds after the doorbell in which taps count
  firstEvent: [0.8, 1.6] as const, // seconds before the first noise of a round
  gap: [0.8, 1.6] as const, // seconds between noises
  bellGap: [0.9, 2.0] as const, // seconds from the last noise to the doorbell
  /** How many noises come before the doorbell, per round (fewest, most). */
  fakes: [
    [1, 2],
    [1, 2],
    [0, 2],
    [1, 3],
    [1, 3],
    [2, 3],
  ] as const,
  missMs: 1500, // what a missed or early round adds to the reaction-time tiebreak
} as const;

export const FAKES = ['kettle', 'phone', 'slam', 'car', 'cat'] as const;
export type Fake = (typeof FAKES)[number];

/** How much each noise makes people jump (a slammed door sounds a lot like someone at the door). */
export const JUMPINESS: Record<Fake, number> = { kettle: 0.8, phone: 1.0, slam: 1.5, car: 0.6, cat: 1.0 };

export interface PizzaRound {
  /** The noises before the doorbell, in order: seconds into the round. */
  fakes: { at: number; kind: Fake }[];
  /** When the doorbell rings, seconds into the round. */
  bellAt: number;
}

const between = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + rng() * (hi - lo);

/** Plans one round: a few noises (never the same one twice in a row), then the doorbell. */
export function planRound(rng: Rng, round: number): PizzaRound {
  const [lo, hi] = PIZZA.fakes[Math.min(round, PIZZA.fakes.length - 1)] ?? [1, 2];
  const n = randInt(rng, lo, hi);
  const fakes: PizzaRound['fakes'] = [];
  let at = between(rng, PIZZA.firstEvent);
  let last: Fake | null = null;
  for (let i = 0; i < n; i++) {
    const kind = pick(
      rng,
      FAKES.filter((f) => f !== last),
    );
    fakes.push({ at, kind });
    last = kind;
    at += between(rng, i === n - 1 ? PIZZA.bellGap : PIZZA.gap);
  }
  return { fakes, bellAt: at };
}

/** One player's round: reaction time in ms, 'early' (got up for nothing) or null (didn't tap). */
export type TapResult = number | 'early' | null;

/**
 * Judges a tap as the TV received it: half the phone's round trip is taken off, so slow Wi-Fi isn't punished.
 * Before the doorbell (bellAtMs = Infinity while it hasn't rung) it's 'early'.
 */
export function judgeTap(tapAtMs: number, bellAtMs: number, rttMs: number): TapResult {
  const t = tapAtMs - Math.max(0, rttMs) / 2;
  if (!(t >= bellAtMs)) return 'early';
  return Math.round(t - bellAtMs);
}

/** Points for one round: the quickest tap after the doorbell wins (equal times both win), early taps lose one. */
export function roundPoints(results: readonly TapResult[]): number[] {
  const times = results.filter((r): r is number => typeof r === 'number');
  const best = times.length ? Math.min(...times) : -1;
  return results.map((r) => (r === 'early' ? PIZZA.falseStart : r === best ? PIZZA.win : 0));
}

/** A single ranking score: points first, total reaction time as the tiebreak. */
export function pizzaScores(rounds: readonly (readonly TapResult[])[], seats: number): number[] {
  const out: number[] = [];
  for (let seat = 0; seat < seats; seat++) {
    let points = 0;
    let time = 0;
    for (const r of rounds) {
      points += roundPoints(r)[seat] ?? 0;
      const v = r[seat];
      time += typeof v === 'number' ? v : PIZZA.missMs;
    }
    out.push(points * 100_000 - Math.min(time, 99_999));
  }
  return out;
}

/**
 * A computer player's round: whether it jumps up at one of the noises (sleepy ones do, now and then; the door
 * slam gets everyone), and otherwise how fast it reacts to the doorbell.
 */
export function cpuRound(rng: Rng, plan: PizzaRound, skill: number): { jumpAt: number | null; reactMs: number } {
  for (const f of plan.fakes) {
    const p = (0.015 + 0.1 * (1 - skill)) * JUMPINESS[f.kind];
    if (rng() < p) return { jumpAt: f.at + 0.25 + rng() * 0.35, reactMs: 0 };
  }
  // Reaction times wobble like people's do (a bell-ish spread of about ±60 ms), and sleepy ones sometimes drift off.
  const wobble = (rng() + rng() + rng() - 1.5) * 120;
  const daydream = rng() < 0.15 * (1 - skill) ? 350 : 0;
  return { jumpAt: null, reactMs: Math.max(170, Math.round(280 + wobble + (1 - skill) * 240 + daydream)) };
}
