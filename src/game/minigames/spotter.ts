// Cloud Spotter: your phone secretly shows your cloud. Find it among the clouds on the big screen
// and tap its letter. Look-alike clouds differ in just one detail.
import { CLOUD_COLORS, CLOUD_MARKS, CLOUD_SHAPES, CLOUD_VARIANTS, type CloudFeatures, cloudFromKey, cloudKey } from '../../shared/cloud.js';
import { type Rng, shuffle } from '../rng.js';

export const SPOTTER = {
  rounds: 3,
  field: 12,
  roundTime: 16,
  lockout: 1.5, // seconds a wrong answer locks you out
  points: [4, 3, 2, 1],
} as const;

export const LABELS = 'ABCDEFGHJKLM'.split('').slice(0, SPOTTER.field);

export interface Field {
  clouds: CloudFeatures[];
  /** For each seat, the index of its secret cloud in `clouds`. */
  targets: number[];
}

function variantsOf(f: CloudFeatures): CloudFeatures[] {
  const out: CloudFeatures[] = [];
  for (let s = 0; s < CLOUD_SHAPES.length; s++) if (s !== f.shape) out.push({ ...f, shape: s });
  for (let c = 0; c < CLOUD_COLORS.length; c++) if (c !== f.color) out.push({ ...f, color: c });
  for (let m = 0; m < CLOUD_MARKS.length; m++) if (m !== f.mark) out.push({ ...f, mark: m });
  return out;
}

export function makeField(rng: Rng, seats: number): Field {
  const all = shuffle(
    rng,
    Array.from({ length: CLOUD_VARIANTS }, (_, k) => k),
  );
  const targets = all.slice(0, seats);
  const used = new Set(targets);
  const keys = [...targets];
  // Look-alikes first: each differs from someone's cloud in exactly one feature.
  const alikes = shuffle(
    rng,
    targets.flatMap((t) => variantsOf(cloudFromKey(t)).map(cloudKey)),
  );
  for (const k of alikes) {
    if (keys.length >= Math.min(SPOTTER.field, seats + 6)) break;
    if (!used.has(k)) {
      used.add(k);
      keys.push(k);
    }
  }
  for (const k of all) {
    if (keys.length >= SPOTTER.field) break;
    if (!used.has(k)) {
      used.add(k);
      keys.push(k);
    }
  }
  const order = shuffle(rng, keys);
  return { clouds: order.map(cloudFromKey), targets: targets.map((t) => order.indexOf(t)) };
}

/** Points for one round from the time each seat found its cloud (seconds), or null if it didn't. */
export function roundPoints(foundAt: readonly (number | null)[]): number[] {
  const sorted = foundAt.filter((t): t is number => t !== null).sort((a, b) => a - b);
  return foundAt.map((t) => (t === null ? 0 : (SPOTTER.points[sorted.indexOf(t)] ?? 0)));
}
