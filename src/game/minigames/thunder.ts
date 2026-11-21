// Thunder Snap: watch the big screen and tap your phone the moment lightning strikes.
// Tapping before the flash locks you out of that strike.

export const THUNDER = {
  strikes: 3,
  minWait: 1.8, // seconds of rumbling before a strike
  maxWait: 4.5,
  window: 1.6, // seconds after the flash in which taps count
  points: [3, 2, 1, 0],
  missPenaltyMs: 2000,
} as const;

/** One player's result in one strike: reaction time in ms, 'early', or null for no tap. */
export type StrikeResult = number | 'early' | null;

/** Points for one strike: fastest valid tap 3, then 2, then 1. Early or missing taps score 0. */
export function strikePoints(results: readonly StrikeResult[]): number[] {
  const valid = results
    .map((r, seat) => ({ r, seat }))
    .filter((x): x is { r: number; seat: number } => typeof x.r === 'number')
    .sort((a, b) => a.r - b.r);
  const points = results.map(() => 0);
  valid.forEach((x, i) => {
    // Equal times share the better points.
    const first = valid.findIndex((y) => y.r === x.r);
    points[x.seat] = THUNDER.points[first] ?? THUNDER.points[i] ?? 0;
  });
  return points;
}

/** A single ranking score per seat: points first, total reaction time as the tiebreak. */
export function thunderScores(strikes: readonly (readonly StrikeResult[])[], seats: number): number[] {
  const scores: number[] = [];
  for (let seat = 0; seat < seats; seat++) {
    let points = 0;
    let time = 0;
    for (const strike of strikes) {
      points += strikePoints(strike)[seat] ?? 0;
      const r = strike[seat];
      time += typeof r === 'number' ? r : THUNDER.missPenaltyMs;
    }
    scores.push(points * 100_000 - Math.min(time, 99_999));
  }
  return scores;
}

/** Reaction time as measured on the TV, minus half the phone's round trip so slow Wi-Fi isn't punished. */
export function reactionMs(tapAtMs: number, flashAtMs: number, rttMs: number): number {
  return Math.max(0, Math.round(tapAtMs - flashAtMs - Math.max(0, rttMs) / 2));
}
