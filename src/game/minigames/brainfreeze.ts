// Brain Freeze: everyone has a giant slushie. Hold the button to slurp, but the cold creeps up and rushes in near
// the top: let go to thaw. Slurp into a full brain freeze and you're frozen solid for a moment.
// First to empty the cup wins; if nobody does, the emptiest cup at the end.
import type { Rng } from '../rng';

export const FREEZE = {
  duration: 30, // seconds
  slurp: 0.078, // share of the cup slurped per second (about 13 s of slurping in all)
  chill: 0.25, // freeze per second while slurping with no freeze yet…
  chillGrow: 0.45, // …plus this much per unit of freeze already there: it rushes in near the top
  thaw: 0.06, // freeze that melts per second with the button up, with no freeze left…
  thawGrow: 1.0, // …plus this much per unit of freeze: a cold head thaws fast, so riding near the edge pays
  frozenFor: 2, // seconds frozen solid at full freeze
  afterFrozen: 0.6, // the freeze that's left once you can move again
  danger: 0.8, // where the phone warns
  lastSips: 4, // seconds the others still get once the first cup is empty
} as const;

export interface Slurper {
  /** 1 full … 0 empty. */
  level: number;
  /** 0 … 1 (full freeze). */
  freeze: number;
  /** Seconds left frozen solid. */
  frozen: number;
  finishedAt: number | null;
  freezes: number;
}

export function newSlurper(): Slurper {
  return { level: 1, freeze: 0, frozen: 0, finishedAt: null, freezes: 0 };
}

function thaw(s: Slurper, dt: number): void {
  s.freeze = Math.max(0, s.freeze - (FREEZE.thaw + FREEZE.thawGrow * s.freeze) * dt);
}

export type SlurpEvent = 'froze' | 'thawed' | 'finished' | null;

/** One step: slurp while holding (if not frozen), thaw while not. Returns what happened, if anything. */
export function stepSlurper(s: Slurper, holding: boolean, dt: number, t: number): SlurpEvent {
  if (s.finishedAt !== null) {
    thaw(s, dt);
    return null;
  }
  if (s.frozen > 0) {
    s.frozen -= dt;
    if (s.frozen > 0) return null;
    s.frozen = 0;
    s.freeze = FREEZE.afterFrozen;
    return 'thawed';
  }
  if (!holding) {
    thaw(s, dt);
    return null;
  }
  s.level = Math.max(0, s.level - FREEZE.slurp * dt);
  s.freeze = Math.min(1, s.freeze + (FREEZE.chill + FREEZE.chillGrow * s.freeze) * dt);
  if (s.level <= 0) {
    s.finishedAt = t;
    return 'finished';
  }
  if (s.freeze >= 1) {
    s.frozen = FREEZE.frozenFor;
    s.freezes += 1;
    return 'froze';
  }
  return null;
}

/** Empty cups rank by time, ahead of everyone still slurping, who rank by how much they drank. */
export function freezeScores(slurpers: readonly Slurper[]): number[] {
  return slurpers.map((s) => (s.finishedAt !== null ? 10_000 - s.finishedAt * 100 : Math.round((1 - s.level) * 1000) / 10));
}

// ------------------------------------------------------------------ computer players

/** When a computer player lets go (`hi`) and starts again (`lo`), rolled anew for every slurp. */
export interface CpuPlan {
  hi: number;
  lo: number;
}

/** skill: 0 sleepy (lets go late or not at all, waits too long) … 1 sharp (rides the edge). */
export function cpuPlan(rng: Rng, skill: number): CpuPlan {
  const greedy = rng() < (1 - skill) * 0.22;
  const hi = greedy ? 1.1 : 0.68 + 0.27 * skill + (rng() - 0.5) * 0.12 * (1 - skill);
  const lo = skill * Math.min(0.75, hi - 0.25) + (1 - skill) * (0.05 + 0.3 * rng());
  return { hi, lo };
}

/** Whether a computer player holds the button this step, given whether it held it the step before. */
export function cpuHolds(s: Slurper, holding: boolean, plan: CpuPlan): boolean {
  if (s.finishedAt !== null || s.frozen > 0) return false;
  return holding ? s.freeze < plan.hi : s.freeze <= plan.lo;
}
