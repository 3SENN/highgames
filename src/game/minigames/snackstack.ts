// Snack Stack: tap on the beat to stack a snack on your tower. A miss makes it wobble; a second miss before you
// steady it drops the top snack. Tallest tower wins.
import type { Grade } from './rhythm';
import type { Rng } from '../rng';

export const SNACKS = ['cracker', 'cheese', 'cookie', 'wafer', 'marshmallow', 'sandwich', 'ricecake'] as const;
export type Snack = (typeof SNACKS)[number];

/** How tall each snack stands on the tower, in world units on the TV. */
export const SNACK_HEIGHT: Record<Snack, number> = {
  cracker: 0.1,
  cheese: 0.15,
  cookie: 0.11,
  wafer: 0.13,
  marshmallow: 0.17,
  sandwich: 0.15,
  ricecake: 0.13,
};

export interface Tower {
  pieces: Snack[];
  /** 0 steady, 1 wobbling: a miss while wobbling drops the top snack. */
  wobble: number;
  dropped: number;
  /** The most snacks it ever held. */
  peak: number;
}

export function newTower(): Tower {
  return { pieces: [], wobble: 0, dropped: 0, peak: 0 };
}

/** One snack for each note of the chart, the same for everyone; never the same snack twice in a row. */
export function snackSequence(rng: Rng, count: number): Snack[] {
  const out: Snack[] = [];
  for (let i = 0; i < count; i++) {
    const options = SNACKS.filter((s) => s !== out[i - 1]);
    out.push(options[Math.floor(rng() * options.length)] as Snack);
  }
  return out;
}

/** A hit stacks the snack. A perfect one steadies the tower completely, a good one by a step. */
export function stackSnack(tower: Tower, snack: Snack, grade: Exclude<Grade, 'miss'>): void {
  tower.pieces.push(snack);
  tower.peak = Math.max(tower.peak, tower.pieces.length);
  tower.wobble = grade === 'perfect' ? 0 : Math.max(0, tower.wobble - 1);
}

export type MissResult = 'wobble' | 'drop';

/** A miss: a steady tower starts to wobble; a wobbling one loses its top snack (and keeps wobbling). */
export function missSnack(tower: Tower): MissResult {
  if (tower.wobble >= 1 && tower.pieces.length > 0) {
    tower.pieces.pop();
    tower.dropped += 1;
    return 'drop';
  }
  tower.wobble = 1;
  return 'wobble';
}

export function towerHeight(tower: Tower): number {
  return tower.pieces.reduce((h, s) => h + SNACK_HEIGHT[s], 0);
}

/** Tallest tower (in snacks) wins; perfect hits break ties. */
export function towerScores(towers: readonly Tower[], perfects: readonly number[]): number[] {
  return towers.map((t, i) => t.pieces.length * 1000 + Math.min(999, perfects[i] ?? 0));
}

export function towerDetail(tower: Tower, perfect: number, misses: number): string {
  const n = tower.pieces.length;
  return `${n} snack${n === 1 ? '' : 's'} · ${perfect} perfect · ${misses} miss`;
}
