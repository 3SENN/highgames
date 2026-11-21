// Hula Hoop Party: everyone keeps a hula hoop going round their waist by moving their phone in circles. Spin too
// slowly and the hoops sink down your legs and drop (picking them up takes a moment). Keep a steady pace and you
// earn another hoop, up to five. Spin too fast for too long and you get dizzy and one flies off. A team scores
// hoop-seconds: every second, every hoop still spinning round either partner.
import type { Rng } from '../rng.js';

export const HOOP = {
  duration: 30, // seconds
  sink: 0.3, // spinning slower than this lets the hoops sink
  sinkSlow: 0.6, // lift lost a second just under that line…
  sinkStill: 1.5, // …and standing still
  rise: 1.2, // lift won back a second once you spin fast enough again
  pickup: 1.5, // seconds to pick the hoops up after they drop
  steady: 0.55, // spinning at least this fast (and not too fast)…
  earnAfter: 3, // …for this long earns another hoop
  slip: 1.5, // the steady timer runs back this fast below the line (a short dip only costs a little)
  earnLift: 0.8, // hoops have to be up round the waist to earn another
  max: 5,
  dizzySpeed: 0.9, // spinning at or above this…
  dizzyAfter: 2.2, // …for this long makes you dizzy
  cool: 1, // and it wears off this fast below the line
  warnAt: 1.2, // a gentle warning after this long too fast
  dizzyFor: 1.4, // seconds of wobbling, when no new hoops come
  follow: 5, // how quickly the hoops' spin follows your hips (a second)
  step: 0.05, // longest simulation step (seconds)
} as const;

export interface Hooper {
  /** The hoops' spin: your phone's speed, smoothed (0..1). */
  speed: number;
  /** Hoops you have (1..max); while they're on the floor these are the ones you'll pick up. */
  hoops: number;
  /** 1: round your waist, 0: on the floor. */
  lift: number;
  /** Seconds of steady spinning towards the next hoop. */
  steady: number;
  /** Seconds spent spinning too fast (wears off when you slow down). */
  heat: number;
  /** Seconds of dizziness left. */
  dizzy: number;
  /** Seconds left picking the hoops up (above 0: they're on the floor). */
  down: number;
  /** Hoop-seconds so far. */
  score: number;
  /** Hoops earned, drops, dizzy spells, and the most hoops at once. */
  earned: number;
  drops: number;
  dizzies: number;
  best: number;
  warned: boolean;
  slipping: boolean;
}

/**
 * What happened during a step:
 *  hoop      another hoop                 sinking  the hoops started slipping down
 *  drop      they hit the floor           up       picked up and spinning again
 *  warn      spinning a bit too fast      dizzy    too dizzy: a hoop flew off
 *  steady    the dizziness wore off
 */
export type HoopEvent = 'hoop' | 'sinking' | 'drop' | 'up' | 'warn' | 'dizzy' | 'steady';

export function newHooper(): Hooper {
  return { speed: 0.5, hoops: 1, lift: 1, steady: 0, heat: 0, dizzy: 0, down: 0, score: 0, earned: 0, drops: 0, dizzies: 0, best: 1, warned: false, slipping: false };
}

/** Lift lost a second at a spin speed: nothing above the sink line, faster the slower you go. */
export function sinkRate(speed: number): number {
  if (speed >= HOOP.sink) return 0;
  const k = 1 - Math.max(0, speed) / HOOP.sink;
  return HOOP.sinkSlow + (HOOP.sinkStill - HOOP.sinkSlow) * k;
}

/** Hoops spinning right now (none while they're on the floor). */
export function spinning(h: Hooper): number {
  return h.down > 0 ? 0 : h.hoops;
}

/** The hoops fall to the floor; picking them up takes a moment. */
function drop(h: Hooper): void {
  h.down = HOOP.pickup;
  h.lift = 0;
  h.steady = 0;
  h.heat = 0;
  h.dizzy = 0;
  h.warned = false;
  h.slipping = false;
}

function stepOnce(h: Hooper, input: number, dt: number, out: HoopEvent[]): void {
  h.speed += (Math.max(0, Math.min(1, input)) - h.speed) * (1 - Math.exp(-HOOP.follow * dt));
  if (h.down > 0) {
    h.down = Math.max(0, h.down - dt);
    if (h.down === 0) {
      h.lift = 1;
      h.steady = 0;
      out.push('up');
    }
    return;
  }
  h.score += h.hoops * dt;

  // Too slow: the hoops slip down, and at the bottom they drop.
  const sink = sinkRate(h.speed);
  if (sink > 0) {
    h.lift -= sink * dt;
    if (!h.slipping && h.lift < 0.75) {
      h.slipping = true;
      out.push('sinking');
    }
    if (h.lift <= 0) {
      h.drops += 1;
      drop(h);
      out.push('drop');
      return;
    }
  } else {
    h.lift = Math.min(1, h.lift + HOOP.rise * dt);
    if (h.lift >= 1) h.slipping = false;
  }

  if (h.dizzy > 0) {
    h.dizzy = Math.max(0, h.dizzy - dt);
    if (h.dizzy === 0) out.push('steady');
    return;
  }

  // Too fast for too long: dizzy, and a hoop flies off (your only one simply drops).
  if (h.speed >= HOOP.dizzySpeed) h.heat += dt;
  else h.heat = Math.max(0, h.heat - HOOP.cool * dt);
  if (h.heat >= HOOP.dizzyAfter) {
    h.dizzies += 1;
    h.heat = 0;
    h.steady = 0;
    h.warned = false;
    out.push('dizzy');
    if (h.hoops > 1) {
      h.hoops -= 1;
      h.dizzy = HOOP.dizzyFor;
    } else drop(h);
    return;
  }
  if (h.heat >= HOOP.warnAt && !h.warned) {
    h.warned = true;
    out.push('warn');
  }
  if (h.heat === 0) h.warned = false;

  // Steady and up round the waist: towards another hoop.
  if (h.speed >= HOOP.steady && h.speed < HOOP.dizzySpeed && h.lift >= HOOP.earnLift) {
    h.steady += dt;
    if (h.steady >= HOOP.earnAfter) {
      if (h.hoops < HOOP.max) {
        h.hoops += 1;
        h.earned += 1;
        h.best = Math.max(h.best, h.hoops);
        h.steady = 0;
        out.push('hoop');
      } else h.steady = HOOP.earnAfter;
    }
  } else if (h.speed < HOOP.steady) {
    h.steady = Math.max(0, h.steady - HOOP.slip * dt);
  }
}

/** Spins on for dt seconds at the phone's spin speed (0..1). Returns what happened, in order. */
export function stepHooper(h: Hooper, input: number, dt: number): HoopEvent[] {
  const out: HoopEvent[] = [];
  for (let left = Math.max(0, dt); left > 1e-9; left -= HOOP.step) stepOnce(h, input, Math.min(HOOP.step, left), out);
  return out;
}

/** A team's hoop-seconds: both partners together, to a tenth. */
export function teamHoopSeconds(hoopers: readonly Hooper[], members: readonly number[]): number {
  let sum = 0;
  for (const m of members) sum += hoopers[m]?.score ?? 0;
  return Math.round(sum * 10) / 10;
}

/** Scores per seat: both partners get their team's hoop-seconds. `teams` holds seat positions. */
export function hoopScores(hoopers: readonly Hooper[], teams: readonly (readonly number[])[]): number[] {
  const scores = hoopers.map(() => 0);
  for (const members of teams) {
    const total = teamHoopSeconds(hoopers, members);
    for (const m of members) if (m >= 0 && m < scores.length) scores[m] = total;
  }
  return scores;
}

export function hoopDetail(h: Hooper, team: number): string {
  const extra = [`${Math.round(h.score)} yours`, `best ${h.best} hoop${h.best === 1 ? '' : 's'}`];
  if (h.drops) extra.push(`dropped ${h.drops === 1 ? 'once' : `${h.drops} times`}`);
  if (h.dizzies) extra.push(`dizzy ${h.dizzies === 1 ? 'once' : `${h.dizzies} times`}`);
  return `Team ${Math.round(team)} hoop-seconds · ${extra.join(' · ')}`;
}

// ------------------------------------------------------------------ computer players

/** A computer player's hips: a comfortable pace, the odd daydream (the hoops sink) and bursts of enthusiasm. */
export interface CpuHooper {
  pace: number;
  wobble: number;
  /** Seconds left of a daydream. */
  spaced: number;
  /** Seconds left of an over-eager burst. */
  burst: number;
}

export function newCpuHooper(skill: number, rng: Rng): CpuHooper {
  const s = Math.max(0, Math.min(1, skill));
  return { pace: 0.62 + s * 0.12 + (rng() - 0.5) * 0.06, wobble: rng() * 10, spaced: 0, burst: 0 };
}

/**
 * The spin speed a computer player sends this frame. Sharp ones keep a steady pace in the sweet band and ease
 * off before they get dizzy; sleepy ones wobble about the steady line, drift off and get carried away.
 */
export function cpuHoop(c: CpuHooper, h: Hooper, skill: number, rng: Rng, dt: number): number {
  const s = Math.max(0, Math.min(1, skill));
  c.wobble += dt * (2.2 + rng() * 1.2);
  const shake = Math.sin(c.wobble) * (0.06 + (1 - s) * 0.08) + (rng() - 0.5) * (0.06 + (1 - s) * 0.06);
  if (c.spaced > 0) {
    c.spaced -= dt;
    // Notice the hoops sinking and pick the pace up again (the sharper, the sooner).
    if (h.down === 0 && h.lift < 0.75 - s * 0.3 && rng() < (0.5 + s * 5) * dt) c.spaced = 0;
    return Math.max(0, 0.14 + shake);
  }
  if (h.down === 0 && rng() < (0.1 + (1 - s) * 0.12) * dt) {
    c.spaced = 0.5 + rng() * (0.5 + (1 - s) * 1.5);
    return 0.14;
  }
  if (c.burst > 0) {
    c.burst -= dt;
    if (h.heat > 0.5 + (1 - s) * 1.5 && rng() < (0.5 + s * 6) * dt) c.burst = 0;
    return Math.min(1, 0.95 + shake * 0.4);
  }
  if (h.dizzy === 0 && rng() < (0.07 + (1 - s) * 0.08) * dt) c.burst = 0.8 + rng() * (0.8 + (1 - s) * 2.2);
  return Math.max(0, Math.min(1, c.pace + shake));
}
