// Blanket Burrito: everyone lies at the edge of a giant fluffy blanket and rolls themselves up in it by moving
// their phone round in circles. The faster you circle, the quicker the layers wrap, but keep it up too fast for
// too long and you get dizzy: you wobble, the burrito loosens and you lose a layer. Most layers wins.

export const BURRITO = {
  duration: 25, // seconds
  rate: 0.58, // layers a second at full spin
  deadzone: 0.08, // circling slower than this doesn't roll you
  dizzySpeed: 0.85, // spinning at or above this…
  dizzyAfter: 2, // …for this many seconds makes you dizzy
  cool: 1.2, // how fast that wears off again below dizzySpeed (seconds per second)
  warnAt: 1.1, // a gentle warning once you've been that long too fast
  dizzyFor: 2.2, // seconds of wobbling, when nothing rolls
  lose: 1, // layers that come loose when you get dizzy
} as const;

export interface Roller {
  /** Layers wrapped so far, with how far into the next one. */
  layers: number;
  /** Seconds spent spinning too fast (wears off when you slow down). */
  heat: number;
  /** Seconds of dizziness left. */
  dizzy: number;
  dizzies: number;
  warned: boolean;
}

export type RollEvent = 'layer' | 'warn' | 'dizzy' | 'steady';

export function newRoller(): Roller {
  return { layers: 0, heat: 0, dizzy: 0, dizzies: 0, warned: false };
}

/** How quickly you wrap at a spin speed (0..1), in layers a second. */
export function wrapRate(speed: number): number {
  if (speed < BURRITO.deadzone) return 0;
  return (BURRITO.rate * (Math.min(1, speed) - BURRITO.deadzone)) / (1 - BURRITO.deadzone);
}

/** Rolls on for dt seconds at the given spin speed. Returns what happened (a new layer, getting dizzy, …). */
export function stepRoller(r: Roller, speed: number, dt: number): RollEvent[] {
  const out: RollEvent[] = [];
  if (r.dizzy > 0) {
    r.dizzy = Math.max(0, r.dizzy - dt);
    if (r.dizzy === 0) out.push('steady');
    return out;
  }
  if (speed >= BURRITO.dizzySpeed) r.heat += dt;
  else r.heat = Math.max(0, r.heat - BURRITO.cool * dt);
  if (r.heat >= BURRITO.dizzyAfter) {
    r.dizzy = BURRITO.dizzyFor;
    r.dizzies += 1;
    r.heat = 0;
    r.warned = false;
    r.layers = Math.max(0, r.layers - BURRITO.lose);
    out.push('dizzy');
    return out;
  }
  if (r.heat >= BURRITO.warnAt && !r.warned) {
    r.warned = true;
    out.push('warn');
  }
  if (r.heat === 0) r.warned = false;
  const before = Math.floor(r.layers);
  r.layers += wrapRate(speed) * dt;
  if (Math.floor(r.layers) > before) out.push('layer');
  return out;
}

/** Whole layers (what the burrito shows and the results say). */
export function wholeLayers(r: Roller): number {
  return Math.floor(r.layers + 1e-9);
}

/** Most layers wins; the layer you were halfway through breaks a tie. */
export function burritoScores(rollers: readonly Roller[]): number[] {
  return rollers.map((r) => Math.round(r.layers * 1000) / 1000);
}

export function burritoDetail(r: Roller): string {
  const n = wholeLayers(r);
  const dizzy = r.dizzies ? ` · dizzy ${r.dizzies === 1 ? 'once' : `${r.dizzies} times`}` : '';
  return `${n} layer${n === 1 ? '' : 's'}${dizzy}`;
}

// ------------------------------------------------------------------ computer players

/** A computer player's hand: a comfortable pace, now and then a burst of enthusiasm, and the odd daydream. */
export interface CpuSpinner {
  pace: number;
  /** Seconds left of an over-eager burst. */
  burst: number;
  /** Seconds left of a daydream. */
  daydream: number;
  wobble: number;
}

export function newCpuSpinner(skill: number, rng: () => number): CpuSpinner {
  return { pace: 0.48 + skill * 0.28 + (rng() - 0.5) * 0.06, burst: 0, daydream: 0, wobble: rng() * 10 };
}

/**
 * The spin speed a computer player sends this frame. Sharp ones keep just under the dizzy line and ease off
 * a burst before it's too late; sleepy ones circle slowly, drift off and get carried away.
 */
export function cpuSpin(c: CpuSpinner, r: Roller, skill: number, rng: () => number, dt: number): number {
  c.wobble += dt * (2.2 + rng() * 0.6);
  const shake = Math.sin(c.wobble) * (0.025 + (1 - skill) * 0.07);
  if (c.daydream > 0) {
    c.daydream -= dt;
    return Math.max(0, 0.15 + shake);
  }
  if (rng() < (0.02 + (1 - skill) * 0.07) * dt) {
    c.daydream = 0.8 + rng() * (0.6 + (1 - skill) * 1.4);
    return 0.15;
  }
  if (c.burst > 0) {
    c.burst -= dt;
    // Notice the head starting to spin and ease off (the sharper, the sooner).
    if (r.heat > 0.9 + (1 - skill) * 1.5 && rng() < (0.3 + skill * 6) * dt) c.burst = 0;
    return Math.min(1, 0.92 + shake);
  }
  if (r.dizzy === 0 && rng() < (0.06 + (1 - skill) * 0.06) * dt) c.burst = 1.2 + rng() * (0.8 + (1 - skill) * 2.4);
  return Math.max(0, Math.min(1, c.pace + shake));
}
