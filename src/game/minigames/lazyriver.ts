// Lazy River: everyone drifts down a winding river on a donut floatie at golden hour. The current carries you
// along on its own; tilting paddles you sideways. The middle of the river flows fastest, the banks slowest.
// Bumping a bank, a lily pad, a duck or each other slows you down and sets your floatie spinning (and a spinning
// floatie steers badly for a moment). Floating snack bags give a short boost. First under the bridge wins; the
// rest rank by how far they got.
//
// Positions are river coordinates: `s` is how far downstream (0 at the start, RIVER.length at the bridge) and `d`
// is across (0 in the middle, + to the right looking downstream). The bends are only for show (see centreX).
import type { Rng } from '../rng';

export const RIVER = {
  duration: 35, // seconds
  length: 96, // from the start to the bridge
  half: 4.2, // half the river's width
  radius: 0.75, // a floatie's radius
  edge: 1.6, // current at the banks, units a second
  middle: 3.5, // current in the middle
  calm: 2.2, // the even flow at the start
  settle: 10, // over the first this-many units the even flow turns into the real current
  steer: 2.8, // sideways paddling speed at full tilt
  steerResponse: 4, // how quickly paddling gets you moving sideways (per second)
  catchUp: 0.9, // how quickly the current brings you back up to speed (per second)
  deadzone: 0.08, // tilts smaller than this count as letting go
  boost: 1.9, // extra speed from a snack
  boostTime: 1.6, // seconds
  respawn: 3.5, // a snack bag bobs back up after this many seconds
  padSlow: 0.4, // speed kept after bumping a lily pad or a duck
  bankSlow: 0.6, // speed kept after bumping a bank
  bumpSlow: 0.85, // speed kept after bumping another floatie
  spinDecay: 1.1, // how quickly a spin wears off (per second)
  grip: 0.3, // steering is 1 / (1 + grip * |spin|) as good while spinning
  pool: 9, // behind the bridge the floaties drift into a calm pool and stop this far on
  buoyR: 0.45,
  duckR: 0.38,
  duckPeriod: 26, // seconds for a duck family to paddle once round its lazy loop
  step: 1 / 120, // physics sub-step
} as const;

export interface Pad {
  s: number;
  d: number;
  r: number;
  /** Has a little flower on it (for show). */
  flower: boolean;
}

export interface Buoy {
  s: number;
  d: number;
  /** Race time when it bobs back up after being eaten (0: it's up). */
  downUntil: number;
}

/**
 * A mother duck and her ducklings paddling slowly round a long loop across the river. A duck that gets bumped
 * ducks under for a moment, so nobody gets stuck behind the family.
 */
export interface Ducks {
  s: number;
  phase: number;
  /** Ducks in the line, the mother first. */
  count: number;
  /** Per duck: race time until which it is under water (and can't be bumped). */
  dive: number[];
}

export interface Bend {
  amp: number;
  wave: number;
  phase: number;
}

export interface Course {
  pads: Pad[];
  buoys: Buoy[];
  ducks: Ducks[];
  bends: Bend[];
}

export interface Floatie {
  s: number;
  d: number;
  vs: number;
  vd: number;
  /** Radians a second; set off by bumps, wears off. */
  spin: number;
  /** Which way the floatie faces (for show). */
  angle: number;
  /** Seconds of snack boost left. */
  boost: number;
  arrivedAt: number | null;
  snacks: number;
  bonks: number;
  /** Race time of the last bonk (a long scrape counts once). */
  lastBonk: number;
}

export interface Race {
  course: Course;
  floaties: Floatie[];
  time: number;
}

export type RiverEvent =
  | { t: 'bonk'; seat: number; what: 'bank' | 'pad' | 'duck' | 'floatie' }
  | { t: 'snack'; seat: number; buoy: number }
  | { t: 'arrive'; seat: number; time: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Furthest a floatie's centre gets from the middle. */
export const LIMIT = RIVER.half - RIVER.radius;

// ------------------------------------------------------------------ the course

/** How fast the water flows at `d` across the river: fastest in the middle, slowest at the banks. */
export function currentAt(d: number): number {
  const k = clamp(d / RIVER.half, -1, 1);
  return RIVER.edge + (RIVER.middle - RIVER.edge) * (1 - k * k);
}

/** The river's middle, sideways, at `s` (for drawing the bends). */
export function centreX(course: Course, s: number): number {
  let x = 0;
  for (const b of course.bends) x += b.amp * Math.sin((s / b.wave) * Math.PI * 2 + b.phase);
  return x;
}

/** How steeply the river bends at `s` (dx/ds of its middle). */
export function centreSlope(course: Course, s: number): number {
  let k = 0;
  for (const b of course.bends) k += ((b.amp * Math.PI * 2) / b.wave) * Math.cos((s / b.wave) * Math.PI * 2 + b.phase);
  return k;
}

/** Where duck `k` of a family is at race time `t` (it paddles round a loop, the ducklings trailing behind). */
export function duckAt(f: Ducks, k: number, t: number): { s: number; d: number; heading: number } {
  const w = (Math.PI * 2) / RIVER.duckPeriod;
  const a = t * w + f.phase - k * 0.42;
  const across = LIMIT - 0.2;
  const along = 0.6;
  // Heading: the direction of travel in (s, d), as an angle from downstream.
  const ds = -along * Math.sin(a) * w;
  const dd = across * Math.cos(a) * w;
  return { s: f.s + along * Math.cos(a), d: across * Math.sin(a), heading: Math.atan2(dd, ds) };
}

/**
 * The narrowest gap the course leaves between two lily pads, or a pad and a bank: wide enough to float through
 * comfortably. Narrower gaps would be notches a floatie could get wedged in.
 */
export const GAP = 2 * RIVER.radius + 0.4;

/** Every gap across a row of pads (sorted by d), banks included; negative where pads overlap. */
export function rowGaps(row: readonly Pad[]): number[] {
  const sorted = [...row].sort((a, b) => a.d - b.d);
  const gaps: number[] = [];
  let from = -RIVER.half;
  for (const p of sorted) {
    gaps.push(p.d - p.r - from);
    from = p.d + p.r;
  }
  gaps.push(RIVER.half - from);
  return gaps;
}

/** A river: gentle bends, lily pads in the fast middle, snack bags and two duck families. */
export function makeCourse(rng: Rng): Course {
  const bends: Bend[] = [
    { amp: 3.2 + rng() * 0.8, wave: 64 + rng() * 14, phase: rng() * Math.PI * 2 },
    { amp: 1 + rng() * 0.5, wave: 24 + rng() * 6, phase: rng() * Math.PI * 2 },
  ];
  const ducks: Ducks[] = [
    { s: Math.round(RIVER.length * (0.36 + rng() * 0.06)), phase: rng() * Math.PI * 2, count: 4, dive: [0, 0, 0, 0] },
    { s: Math.round(RIVER.length * (0.68 + rng() * 0.06)), phase: rng() * Math.PI * 2, count: 3, dive: [0, 0, 0] },
  ];
  // Rows of one or two pads. Every gap they leave is either wide enough to float through or not there at all,
  // so there are choices to make but nowhere to get wedged.
  const pads: Pad[] = [];
  const reach = RIVER.half - GAP; // a pad's far edge stays this close to the middle
  for (let s = 11 + rng() * 3; s < RIVER.length - 7; s += 6.5 + rng() * 4) {
    if (ducks.some((f) => Math.abs(f.s - s) < 4.5)) continue;
    if (rng() < 0.4) {
      // Two small pads: around the left, between them, or around the right (the middle gap is >= GAP too).
      const r1 = 0.5 + rng() * 0.15;
      const r2 = 0.5 + rng() * 0.15;
      pads.push({ s: s + (rng() * 2 - 1) * 0.6, d: -(reach - r1), r: r1, flower: rng() < 0.4 });
      pads.push({ s: s + (rng() * 2 - 1) * 0.6, d: reach - r2, r: r2, flower: rng() < 0.4 });
    } else {
      const r = 0.55 + rng() * 0.4;
      pads.push({ s: s + (rng() * 2 - 1) * 0.6, d: (rng() * 2 - 1) * (reach - r), r, flower: rng() < 0.4 });
    }
  }
  const buoys: Buoy[] = [];
  for (let s = 9 + rng() * 3; s < RIVER.length - 5; s += 7 + rng() * 3) {
    for (let tries = 0; tries < 20; tries++) {
      const d = (rng() * 2 - 1) * (LIMIT - 0.3);
      const at = s + (rng() * 2 - 1) * 1.5;
      if (pads.some((p) => Math.hypot(p.s - at, p.d - d) < p.r + 1.6)) continue;
      if (ducks.some((f) => Math.abs(f.s - at) < 3)) continue;
      buoys.push({ s: at, d, downUntil: 0 });
      break;
    }
  }
  return { pads, buoys, ducks, bends };
}

// ------------------------------------------------------------------ floating

export function newFloatie(d: number): Floatie {
  return { s: 0, d: clamp(d, -LIMIT, LIMIT), vs: RIVER.calm, vd: 0, spin: 0, angle: 0, boost: 0, arrivedAt: null, snacks: 0, bonks: 0, lastBonk: -9 };
}

/** Everyone side by side at the start. */
export function newRace(course: Course, seats: number): Race {
  const spread = Math.min(1.9, (2 * LIMIT) / Math.max(1, seats));
  const floaties = Array.from({ length: seats }, (_, i) => newFloatie((i - (seats - 1) / 2) * spread));
  return { course, floaties, time: 0 };
}

/**
 * The water's pull on a floatie. Near the start it flows evenly (so starting at the side costs nothing while
 * everyone finds the fast water), behind the bridge it eases off into a still pool.
 */
export function flowAt(s: number, d: number): number {
  const k = clamp(s / RIVER.settle, 0, 1);
  const flow = RIVER.calm * (1 - k) + currentAt(d) * k;
  const past = s - RIVER.length;
  return past <= 0 ? flow : flow * clamp(1 - past / RIVER.pool, 0.08, 1);
}

function bonk(race: Race, f: Floatie, seat: number, what: 'bank' | 'pad' | 'duck' | 'floatie', slow: number, spin: number, out: RiverEvent[]): void {
  if (race.time - f.lastBonk < 0.35) return;
  f.lastBonk = race.time;
  f.vs *= slow;
  f.spin = clamp(f.spin + spin, -9, 9);
  f.bonks += 1;
  out.push({ t: 'bonk', seat, what });
}

/**
 * Pushes a floatie out of a round obstacle at (s, d) of radius r, bouncing it off softly.
 * Returns how hard it hit (the speed it was moving into the obstacle), or 0 when it did not touch.
 */
function pushOut(f: Floatie, s: number, d: number, r: number, bounce: number): number {
  const ds = f.s - s;
  const dd = f.d - d;
  const reach = r + RIVER.radius;
  const dist2 = ds * ds + dd * dd;
  if (dist2 >= reach * reach) return 0;
  const dist = Math.sqrt(dist2) || 1e-6;
  const ns = ds / dist;
  const nd = dd / dist;
  f.s = s + ns * reach;
  f.d = d + nd * reach;
  const vn = f.vs * ns + f.vd * nd;
  if (vn >= 0) return 0.001;
  f.vs -= (1 + bounce) * vn * ns;
  f.vd -= (1 + bounce) * vn * nd;
  return -vn;
}

/** Which way a glancing hit spins the floatie (+1 or -1). */
function spinSign(f: Floatie, otherD: number): number {
  return f.d >= otherD ? 1 : -1;
}

/**
 * Moves every floatie on by dt seconds. `tilt` is each player's sideways tilt (-1 … 1; + steers right).
 * Steps in small fixed sub-steps, so a long frame (or a fast playtest) behaves the same.
 */
export function stepRace(race: Race, tilt: readonly number[], dt: number): RiverEvent[] {
  const out: RiverEvent[] = [];
  const { course, floaties } = race;
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(RIVER.step, left);
    left -= h;
    race.time += h;
    const t = race.time;
    const steerK = 1 - Math.exp(-RIVER.steerResponse * h);
    const flowK = 1 - Math.exp(-RIVER.catchUp * h);
    floaties.forEach((f, i) => {
      const raw = tilt[i] ?? 0;
      const x = Math.abs(raw) < RIVER.deadzone ? 0 : clamp(raw, -1, 1);
      const settled = f.arrivedAt !== null && f.s >= RIVER.length + RIVER.pool * 0.6;
      const grip = 1 / (1 + RIVER.grip * Math.abs(f.spin));
      f.vd += ((settled ? 0 : x * RIVER.steer * grip) - f.vd) * steerK;
      f.vs += (flowAt(f.s, f.d) + (f.boost > 0 ? RIVER.boost : 0) - f.vs) * flowK;
      f.boost = Math.max(0, f.boost - h);
      f.s += f.vs * h;
      f.d += f.vd * h;
      if (f.s > RIVER.length + RIVER.pool) {
        f.s = RIVER.length + RIVER.pool;
        f.vs = Math.min(f.vs, 0);
      }
      f.spin *= Math.exp(-RIVER.spinDecay * h);
      f.angle += (f.spin + 0.18) * h;

      // The banks.
      if (Math.abs(f.d) > LIMIT) {
        const side = Math.sign(f.d);
        f.d = side * LIMIT;
        const into = f.vd * side;
        if (into > 0) {
          f.vd = -f.vd * 0.35;
          if (into > 0.7) bonk(race, f, i, 'bank', RIVER.bankSlow, -side * (2 + into), out);
        }
      }
      // Lily pads.
      for (const p of course.pads) {
        if (Math.abs(p.s - f.s) > 2.2) continue;
        const hit = pushOut(f, p.s, p.d, p.r, 0.25);
        if (hit > 0.5) bonk(race, f, i, 'pad', RIVER.padSlow, spinSign(f, p.d) * (2.5 + hit), out);
      }
      // Ducks: a bump slows you, and the duck ducks under for a moment and paddles on.
      for (const fam of course.ducks) {
        if (Math.abs(fam.s - f.s) > 4) continue;
        for (let k = 0; k < fam.count; k++) {
          if ((fam.dive[k] ?? 0) > t) continue;
          const p = duckAt(fam, k, t);
          const r = k === 0 ? RIVER.duckR * 1.3 : RIVER.duckR;
          if (Math.hypot(p.s - f.s, p.d - f.d) >= r + RIVER.radius) continue;
          fam.dive[k] = t + 1.6;
          bonk(race, f, i, 'duck', RIVER.padSlow, spinSign(f, p.d) * 3, out);
        }
      }
      // Snack bags.
      course.buoys.forEach((b, k) => {
        if (b.downUntil > t || f.arrivedAt !== null) return;
        if (Math.hypot(b.s - f.s, b.d - f.d) > RIVER.radius + RIVER.buoyR) return;
        b.downUntil = t + RIVER.respawn;
        f.boost = RIVER.boostTime;
        f.snacks += 1;
        out.push({ t: 'snack', seat: i, buoy: k });
      });
      if (f.arrivedAt === null && f.s >= RIVER.length) {
        f.arrivedAt = t;
        out.push({ t: 'arrive', seat: i, time: t });
      }
    });

    // Floaties bumping into each other: they bounce apart and both slow a little.
    for (let a = 0; a < floaties.length; a++) {
      for (let b = a + 1; b < floaties.length; b++) {
        const fa = floaties[a] as Floatie;
        const fb = floaties[b] as Floatie;
        const ds = fa.s - fb.s;
        const dd = fa.d - fb.d;
        const reach = RIVER.radius * 2;
        const dist2 = ds * ds + dd * dd;
        if (dist2 >= reach * reach) continue;
        const dist = Math.sqrt(dist2) || 1e-6;
        const ns = dist2 > 1e-12 ? ds / dist : 0;
        const nd = dist2 > 1e-12 ? dd / dist : 1;
        const push = (reach - dist) / 2;
        fa.s += ns * push;
        fa.d += nd * push;
        fb.s -= ns * push;
        fb.d -= nd * push;
        const vrel = (fa.vs - fb.vs) * ns + (fa.vd - fb.vd) * nd;
        if (vrel >= 0) continue;
        const j = (-(1 + 0.5) * vrel) / 2;
        fa.vs += j * ns;
        fa.vd += j * nd;
        fb.vs -= j * ns;
        fb.vd -= j * nd;
        if (-vrel > 0.9) {
          const sgn = (fa.vs - fb.vs) * nd - (fa.vd - fb.vd) * ns >= 0 ? 1 : -1;
          bonk(race, fa, a, 'floatie', RIVER.bumpSlow, sgn * (1 - vrel * 0.6), out);
          bonk(race, fb, b, 'floatie', RIVER.bumpSlow, -sgn * (1 - vrel * 0.6), out);
        }
      }
    }
  }
  return out;
}

export function allArrived(race: Race): boolean {
  return race.floaties.every((f) => f.arrivedAt !== null);
}

/** Who drifted under the bridge ranks by arrival, ahead of everyone still on the way; they rank by distance. */
export function riverScores(floaties: readonly Floatie[]): number[] {
  return floaties.map((f) => (f.arrivedAt !== null ? 10_000 - f.arrivedAt * 100 : Math.min(f.s, RIVER.length)));
}

export function riverDetail(f: Floatie): string {
  const snacks = f.snacks ? ` · ${f.snacks} snack${f.snacks === 1 ? '' : 's'}` : '';
  if (f.arrivedAt !== null) return `Under the bridge in ${f.arrivedAt.toFixed(1)} s${snacks}`;
  return `${Math.max(1, Math.round(RIVER.length - f.s))} m short of the bridge${snacks}`;
}

// ------------------------------------------------------------------ computer players

/** A computer player's paddling: where it wants to be across the river, rethought now and then. */
export interface CpuPaddler {
  target: number;
  nextThink: number;
  /** Seconds left gazing at the sky. */
  spaced: number;
}

export function newCpuPaddler(d = 0): CpuPaddler {
  return { target: d, nextThink: 0, spaced: 0 };
}

/**
 * The best line across the river for floatie `i` right now: fast water, clear of lily pads, ducks and the
 * others just ahead, and a snack bag if there's one to grab. Looks further ahead the sharper it is.
 */
export function cpuLine(race: Race, i: number, skill: number): number {
  const f = race.floaties[i] as Floatie;
  const look = 3.5 + skill * 7;
  const clear = RIVER.radius + 0.1;
  let best = f.d;
  let bestValue = -Infinity;
  for (let d = -LIMIT; d <= LIMIT + 1e-6; d += 0.2) {
    let v = currentAt(d) - Math.abs(d - f.d) * 0.12;
    for (const p of race.course.pads) {
      const ahead = p.s - f.s;
      if (ahead < -0.5 || ahead > look) continue;
      if (Math.abs(d - p.d) < p.r + clear) v -= 3 * (1.2 - ahead / look);
    }
    for (const fam of race.course.ducks) {
      const ahead = fam.s - f.s;
      if (ahead < -1.5 || ahead > look + 1.5) continue;
      const when = race.time + Math.max(0, ahead) / Math.max(1, f.vs);
      for (let k = 0; k < fam.count; k++) {
        if ((fam.dive[k] ?? 0) > when) continue;
        const p = duckAt(fam, k, when);
        if (Math.abs(d - p.d) < RIVER.duckR + clear + 0.2) v -= 2.5;
      }
    }
    for (const b of race.course.buoys) {
      const ahead = b.s - f.s;
      if (ahead < 0 || ahead > look || b.downUntil > race.time + ahead / Math.max(1, f.vs)) continue;
      if (Math.abs(d - b.d) < 0.6) v += 0.4 + skill * 0.9;
    }
    race.floaties.forEach((o, k) => {
      if (k === i) return;
      const ahead = o.s - f.s;
      if (ahead > -1 && ahead < 2 + skill * 2 && Math.abs(d - o.d) < 1.7) v -= 0.4 + skill * 0.8;
    });
    if (v > bestValue) {
      bestValue = v;
      best = d;
    }
  }
  return best;
}

/** A normally distributed number (mean 0, deviation 1). */
function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(Math.PI * 2 * rng());
}

/** The tilt a computer player holds this frame. skill: 0 sleepy … 1 sharp. */
export function cpuTilt(c: CpuPaddler, race: Race, i: number, skill: number, rng: Rng, dt: number): number {
  const f = race.floaties[i] as Floatie;
  if (c.spaced > 0) {
    c.spaced -= dt;
    return 0;
  }
  if (rng() < (0.015 + (1 - skill) * 0.11) * dt) {
    c.spaced = 0.6 + rng() * (0.4 + (1 - skill) * 1.6);
    return 0;
  }
  if (race.time >= c.nextThink) {
    c.target = clamp(cpuLine(race, i, skill) + gauss(rng) * (0.15 + (1 - skill) * 0.9), -LIMIT, LIMIT);
    c.nextThink = race.time + 0.18 + (1 - skill) * 0.5 + rng() * 0.2;
  }
  const want = (c.target - f.d) * (0.8 + skill * 0.7) - f.vd * 0.2;
  return clamp(want, -1, 1) * (0.55 + 0.45 * skill);
}
