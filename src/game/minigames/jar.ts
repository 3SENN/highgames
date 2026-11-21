// Guess the Jar: a big glass jar of snacks turns slowly on the kitchen counter. Type how many there are; the
// closest guess wins the round (spot on gets a bonus). Then the jar is tipped out into rows of ten to count.
// Three jars: gummy bears, cereal loops, popcorn. The jar is packed here, so the TV shows exactly `count` pieces.
import { type Rng, randInt } from '../rng.js';

export const JAR = {
  rounds: 3,
  answerTime: 15, // seconds to guess
  /** Once everyone has guessed, this long to change your mind. */
  grace: 2.5,
  points: [3, 2, 1, 0],
  exactBonus: 2,
  /** The inside of the jar: radius and how high it can be filled (jar units). */
  radius: 0.95,
  height: 2.7,
  /** The three jars' counts differ by at least this much. */
  minDiff: 15,
} as const;

export type FillingId = 'gummy' | 'loops' | 'popcorn';

export interface Filling {
  id: FillingId;
  /** For "How many …?" */
  name: string;
  /** Shown next to the number on the phone. */
  unit: string;
  min: number;
  max: number;
  /** Distance between neighbouring pieces in a layer, and between layers. */
  spacing: number;
  layer: number;
}

export const FILLINGS: readonly Filling[] = [
  { id: 'gummy', name: 'gummy bears', unit: 'bears', min: 80, max: 220, spacing: 0.28, layer: 0.25 },
  { id: 'loops', name: 'cereal loops', unit: 'loops', min: 110, max: 260, spacing: 0.25, layer: 0.22 },
  { id: 'popcorn', name: 'bits of popcorn', unit: 'bits', min: 45, max: 130, spacing: 0.34, layer: 0.3 },
];

export interface Piece {
  x: number;
  y: number;
  z: number;
  /** Seed for the piece's colour and how it lies. */
  seed: number;
}

export interface JarPlan {
  filling: Filling;
  count: number;
  /** Exactly `count` pieces, bottom layer first. */
  pieces: Piece[];
  /** The top of the pile. */
  level: number;
}

/**
 * Packs `count` pieces into the jar in loose layers: a hexagonal lattice per layer, turned and shifted at random,
 * with a little jiggle. The top layer is partly filled, heaped a little towards the middle.
 */
export function packJar(rng: Rng, filling: Filling, count: number): Piece[] {
  const { spacing: d, layer: h } = filling;
  const reach = JAR.radius - d / 2;
  const row = (d * Math.sqrt(3)) / 2;
  const n = Math.ceil(reach / row) + 2;
  const pieces: Piece[] = [];
  for (let k = 0; pieces.length < count; k++) {
    const turn = rng() * (Math.PI / 3);
    const ox = (rng() - 0.5) * d;
    const oz = (rng() - 0.5) * row;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const slots: Piece[] = [];
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const px = ox + i * d + (j % 2 ? d / 2 : 0);
        const pz = oz + j * row;
        let x = px * cos - pz * sin + (rng() - 0.5) * 0.16 * d;
        let z = px * sin + pz * cos + (rng() - 0.5) * 0.16 * d;
        const r = Math.hypot(x, z);
        if (r > reach + 0.08 * d) continue;
        if (r > reach) {
          x *= reach / r;
          z *= reach / r;
        }
        const y = h / 2 + k * h + (rng() - 0.5) * 0.2 * h;
        slots.push({ x, y, z, seed: Math.floor(rng() * 1e9) });
      }
    }
    const need = count - pieces.length;
    if (slots.length > need) {
      // The last layer: a loose heap, more in the middle than at the edge.
      const keyed = slots.map((s) => ({ s, key: Math.hypot(s.x, s.z) + rng() * reach * 0.7 }));
      keyed.sort((a, b) => a.key - b.key);
      pieces.push(...keyed.slice(0, need).map((x) => x.s));
    } else pieces.push(...slots);
  }
  return pieces;
}

/** One jar: a random count in the filling's range, packed. */
export function planJar(rng: Rng, filling: Filling, count = randInt(rng, filling.min, filling.max)): JarPlan {
  const pieces = packJar(rng, filling, count);
  const level = pieces.reduce((m, p) => Math.max(m, p.y), 0) + filling.layer / 2;
  return { filling, count, pieces, level };
}

/** The three jars of a game, in order, with counts that clearly differ. */
export function planJars(rng: Rng): JarPlan[] {
  const counts: number[] = [];
  for (const f of FILLINGS) {
    let c = randInt(rng, f.min, f.max);
    for (let k = 0; k < 30 && counts.some((x) => Math.abs(x - c) < JAR.minDiff); k++) c = randInt(rng, f.min, f.max);
    counts.push(c);
  }
  return FILLINGS.map((f, i) => planJar(rng, f, counts[i]));
}

/**
 * Points for one jar from each seat's guess (null: no guess): closest 3, then 2, 1, 0; equal distances share
 * the better points, and a spot-on guess gets a bonus. No guess scores nothing.
 */
export function guessPoints(guesses: readonly (number | null)[], count: number): number[] {
  const dist = guesses.map((g) => (g === null ? null : Math.abs(g - count)));
  const sorted = dist.filter((d): d is number => d !== null).sort((a, b) => a - b);
  return dist.map((d) => (d === null ? 0 : (JAR.points[sorted.indexOf(d)] ?? 0) + (d === 0 ? JAR.exactBonus : 0)));
}

/** Total points first; equal points are broken by the smaller total distance (a missing guess counts as 999). */
export function jarScores(points: readonly number[], totalOff: readonly number[]): number[] {
  return points.map((p, i) => p * 10_000 - Math.min(9_999, totalOff[i] ?? 0));
}

/** A standard normal number (Box-Muller). */
function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** How far off a computer player's eye is, as a fraction of the count (one standard deviation, in log terms). */
export function cpuSpread(skill: number): number {
  return 0.3 - 0.24 * Math.min(1, Math.max(0, skill));
}

/**
 * A computer player's guess and when it types it in (seconds into the round). Sleepy ones are further off and
 * like round numbers.
 */
export function cpuGuess(rng: Rng, count: number, skill: number): { value: number; at: number } {
  const k = Math.min(1, Math.max(0, skill));
  let value = count * Math.exp(gauss(rng) * cpuSpread(k));
  if (rng() < 0.6 - 0.5 * k) value = Math.round(value / 10) * 10;
  else if (rng() < 0.3) value = Math.round(value / 5) * 5;
  value = Math.min(999, Math.max(1, Math.round(value)));
  const at = Math.min(JAR.answerTime - 1, 3 + (1 - k) * 4 + rng() * 4);
  return { value, at };
}
