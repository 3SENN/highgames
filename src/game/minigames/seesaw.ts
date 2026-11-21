// Seesaw Snacks: each team rides its own seesaw under a tree full of snack-fruit. Partners sit at either end and
// lean by tilting their phones; their leans add up, so leaning the same way tips the plank and leaning opposite
// ways levels it. Snacks drop from the branches on stretchy stalks and dangle at a height over one end: bring that
// end's catch zone (just above the rider's head) to it and it's yours. Broccoli dangles too, and costs a point.
// Both teams get exactly the same snacks at the same moments. Most points in 35 seconds wins.
import type { Rng } from '../rng.js';

export const SEESAW = {
  duration: 35, // seconds
  half: 1.7, // pivot to each seat, along the plank
  pivot: 0.72, // the pivot's height
  angle: 0.4, // the most the plank tips either way (radians)
  reach: 1.3, // the catch zone's middle sits this far above the seat
  zone: 0.2, // half the catch zone's height
  grab: 0.2, // seconds a snack has to stay in the catch zone to be caught (swinging straight past doesn't count)
  press: 1.15, // the most the riders can push (past 1: into the ground)
  together: 0.6, // how far the plank wants to tip per unit of summed lean (1 is all the way)
  deadzone: 0.08, // phone tilt that doesn't count as leaning
  full: 0.7, // phone tilt for a full lean
  spring: 20, // how keenly the plank follows the riders' leans
  damping: 7.5,
  bounce: 0.25, // an end hitting the ground (or the top) bounces back a little
  step: 1 / 120, // physics step (seconds)
  // The snack-fruit.
  firstAt: 1, // the first one drops after this long
  gapStart: [0.75, 1.15], // seconds between drops early on…
  gapEnd: [0.5, 0.85], // …and near the end
  pair: 0.45, // share of drops that come two at once, one over each end
  broccoli: 0.2, // share of broccoli
  top: 4.7, // the branches
  fall: 0.6, // seconds from the branches down to its height
  hangStart: 1.1, // seconds a snack dangles before its stalk snaps: early on…
  hangEnd: 0.8, // …and near the end
  bands: [1.55, 2.02, 2.5], // the heights snacks dangle at (low, middle, high), give or take
  jitter: 0.12,
  middle: 0.2, // share of snacks at the middle height (the rest are high or low)
} as const;

export const TREATS = ['doughnut', 'cookie', 'cupcake', 'pretzel', 'gummy'] as const;
export type Treat = (typeof TREATS)[number] | 'broccoli';
export type End = 0 | 1;

export interface Drop {
  /** When it leaves the branches. */
  at: number;
  /** Over the left (0) or right (1) seat. */
  end: End;
  /** The height it dangles at. */
  y: number;
  treat: Treat;
  /** Seconds it dangles before the stalk snaps. */
  hang: number;
}

// ------------------------------------------------------------------ the plank

/** The plank's angle (radians) for a tip of -1 (left end down) .. 1 (right end down). */
export function plankAngle(tip: number): number {
  return Math.max(-1, Math.min(1, tip)) * SEESAW.angle;
}

/** How high a seat is (the top of the plank's end) at a tip. */
export function seatY(end: End, tip: number): number {
  const s = SEESAW.half * Math.sin(plankAngle(tip));
  return SEESAW.pivot + (end === 0 ? s : -s);
}

/** The middle of an end's catch zone, just above its rider's head. */
export function zoneY(end: End, tip: number): number {
  return seatY(end, tip) + SEESAW.reach;
}

/** The tip that brings an end's catch zone to height y (clamped to what the plank can do). */
export function tipFor(end: End, y: number): number {
  const s = Math.max(-1, Math.min(1, (y - SEESAW.reach - SEESAW.pivot) / SEESAW.half));
  const tip = Math.asin(s) / SEESAW.angle;
  return Math.max(-1, Math.min(1, end === 0 ? tip : -tip));
}

/** The range of tips at which an end catches something dangling at height y (empty when out of reach: lo > hi). */
export function tipWindow(end: End, y: number): [number, number] {
  const a = tipFor(end, y - SEESAW.zone);
  const b = tipFor(end, y + SEESAW.zone);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  // Clamping can make a window out of nothing: only keep the part that really reaches.
  const reaches = (tip: number) => Math.abs(zoneY(end, tip) - y) <= SEESAW.zone + 1e-9;
  if (!reaches(lo) && !reaches(hi)) return [1, -1];
  return [lo, hi];
}

/** A lean (-1 .. 1, positive pushes the right end down) from the phone's sideways tilt. */
export function leanOf(tiltX: number): number {
  const a = Math.abs(tiltX);
  if (a <= SEESAW.deadzone) return 0;
  return Math.sign(tiltX) * Math.min(1, (a - SEESAW.deadzone) / (SEESAW.full - SEESAW.deadzone));
}

/** The phone tilt that gives a lean (the inverse of leanOf, for computer players). */
export function tiltFor(lean: number): number {
  const a = Math.min(1, Math.abs(lean));
  if (a === 0) return 0;
  return Math.sign(lean) * (SEESAW.deadzone + a * (SEESAW.full - SEESAW.deadzone));
}

/**
 * Where the plank wants to be: the partners' leans added up (a rider on their own counts double). Leaning hard
 * together pushes a little past the end, so the low end thumps the ground.
 */
export function plankTarget(leans: readonly number[]): number {
  const sum = leans.length >= 2 ? (leans[0] ?? 0) + (leans[1] ?? 0) : 2 * (leans[0] ?? 0);
  return Math.max(-SEESAW.press, Math.min(SEESAW.press, SEESAW.together * sum));
}

// ------------------------------------------------------------------ the snack-fruit

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** How long a drop dangles, at a moment in the game. */
export function hangTime(at: number): number {
  return lerp(SEESAW.hangStart, SEESAW.hangEnd, Math.min(1, Math.max(0, at / SEESAW.duration)));
}

/** When a drop's stalk snaps (it's gone after that). */
export const snapsAt = (d: Drop) => d.at + SEESAW.fall + d.hang;

/**
 * The whole game's snack-fruit, the same for both teams. Never more than two dangle over one end at once, and
 * two over the same end hang at different heights.
 */
export function makeDrops(rng: Rng): Drop[] {
  const drops: Drop[] = [];
  const band = (b: number) => (SEESAW.bands[b] ?? 2) + (rng() * 2 - 1) * SEESAW.jitter;
  const bandOf = (y: number) => {
    let best = 0;
    SEESAW.bands.forEach((v, i) => {
      if (Math.abs(v - y) < Math.abs((SEESAW.bands[best] ?? 0) - y)) best = i;
    });
    return best;
  };
  const busy = (end: End, at: number) => drops.filter((d) => d.end === end && snapsAt(d) > at - 0.1);
  /** Adds one drop over `end` (or the other end if that one is full); returns false if neither had room. */
  const add = (at: number, end: End, b: number, treat: Treat): boolean => {
    for (const e of [end, (1 - end) as End]) {
      const now = busy(e, at);
      if (now.length >= 2) continue;
      const taken = new Set(now.map((d) => bandOf(d.y)));
      let chosen = b;
      if (taken.has(chosen)) {
        const free = [0, 1, 2].filter((k) => !taken.has(k));
        chosen = free[Math.floor(rng() * free.length)] ?? b;
      }
      drops.push({ at, end: e, y: band(chosen), treat, hang: hangTime(at) });
      return true;
    }
    return false;
  };
  const treat = (): Treat => (rng() < SEESAW.broccoli ? 'broccoli' : (TREATS[Math.floor(rng() * TREATS.length)] ?? 'cookie'));
  // Mostly high or low: a level plank only reaches the middle.
  const pickBand = () => {
    const r = rng();
    return r < SEESAW.middle ? 1 : r < (1 + SEESAW.middle) / 2 ? 0 : 2;
  };
  const sweet = (): Treat => TREATS[Math.floor(rng() * TREATS.length)] ?? 'cookie';
  let t = SEESAW.firstAt;
  const last = SEESAW.duration - SEESAW.fall - 0.8;
  while (t < last) {
    const k = t / SEESAW.duration;
    const end: End = rng() < 0.5 ? 0 : 1;
    if (rng() < SEESAW.pair) {
      // One over each end: usually heights one tip catches both of (one high, one low), sometimes not.
      const b = pickBand();
      const easy = rng() < 0.5;
      const other = easy ? 2 - b : b;
      const first = treat();
      add(t, end, b, first);
      add(t, (1 - end) as End, other, first === 'broccoli' ? sweet() : treat());
    } else add(t, end, pickBand(), treat());
    const [g0, g1] = [lerp(SEESAW.gapStart[0], SEESAW.gapEnd[0], k), lerp(SEESAW.gapStart[1], SEESAW.gapEnd[1], k)];
    t += g0 + rng() * (g1 - g0);
  }
  return drops;
}

/** Where a drop is at a moment: at the branches, coming down on its stretchy stalk, then bobbing at its height. */
export function dropHeight(d: Drop, time: number): number {
  const k = (time - d.at) / SEESAW.fall;
  if (k <= 0) return SEESAW.top;
  if (k < 1) {
    // Comes down quickly, stretches a little past its height and springs back.
    const e = 1 - (1 - k) ** 3;
    return SEESAW.top + (d.y - SEESAW.top) * e - Math.sin(Math.PI * k) * 0.05;
  }
  const since = time - d.at - SEESAW.fall;
  return d.y - Math.sin(since * 11) * 0.09 * Math.exp(-since * 3.5) + Math.sin(since * 2.6 + d.at) * 0.025;
}

// ------------------------------------------------------------------ a team's seesaw

export type DropState = 'waiting' | 'falling' | 'hanging' | 'caught' | 'snapped';

export interface Board {
  /** -1: left end down … 1: right end down. */
  tip: number;
  vel: number;
  time: number;
  /** Per drop (same order as the drop list). */
  states: DropState[];
  /** Per drop: seconds it has been in its catch zone. */
  held: number[];
  /** Points: +1 a snack, -1 a broccoli (never below 0). */
  points: number;
  snacks: number;
  greens: number;
  /** Snacks caught by each end's rider. */
  caught: [number, number];
  greensBy: [number, number];
}

export type SeesawEvent =
  | { kind: 'catch'; drop: number; end: End; treat: Treat }
  | { kind: 'snap'; drop: number }
  | { kind: 'drop'; drop: number }
  | { kind: 'bump'; end: End; strength: number };

export function newBoard(drops: readonly Drop[]): Board {
  return { tip: 0, vel: 0, time: 0, states: drops.map(() => 'waiting'), held: drops.map(() => 0), points: 0, snacks: 0, greens: 0, caught: [0, 0], greensBy: [0, 0] };
}

/** Is a drop dangling in an end's catch zone at this tip? */
export function inZone(d: Drop, tip: number): boolean {
  return Math.abs(zoneY(d.end, tip) - d.y) <= SEESAW.zone + 1e-9;
}

function stepOnce(b: Board, drops: readonly Drop[], target: number, h: number, out: SeesawEvent[]): void {
  b.time += h;
  b.vel += (SEESAW.spring * (target - b.tip) - SEESAW.damping * b.vel) * h;
  b.tip += b.vel * h;
  if (Math.abs(b.tip) > 1) {
    const side = Math.sign(b.tip);
    b.tip = side;
    if (b.vel * side > 0) {
      // The low end thumps the ground (the right end when tipping right).
      if (b.vel * side > 0.35) out.push({ kind: 'bump', end: side > 0 ? 1 : 0, strength: Math.min(1, (b.vel * side) / 4) });
      b.vel = -b.vel * SEESAW.bounce;
    }
  }
  drops.forEach((d, i) => {
    const s = b.states[i];
    if (s === 'caught' || s === 'snapped') return;
    if (b.time < d.at) return;
    if (b.time < d.at + SEESAW.fall) {
      if (s === 'waiting') {
        b.states[i] = 'falling';
        out.push({ kind: 'drop', drop: i });
      }
      return;
    }
    if (b.time >= snapsAt(d)) {
      b.states[i] = 'snapped';
      out.push({ kind: 'snap', drop: i });
      return;
    }
    b.states[i] = 'hanging';
    if (!inZone(d, b.tip)) {
      b.held[i] = 0;
      return;
    }
    b.held[i] = (b.held[i] ?? 0) + h;
    if ((b.held[i] ?? 0) < SEESAW.grab - 1e-9) return;
    b.states[i] = 'caught';
    if (d.treat === 'broccoli') {
      b.greens += 1;
      b.greensBy[d.end] += 1;
      b.points = Math.max(0, b.points - 1);
    } else {
      b.snacks += 1;
      b.caught[d.end] += 1;
      b.points += 1;
    }
    out.push({ kind: 'catch', drop: i, end: d.end, treat: d.treat });
  });
}

/**
 * Runs a team's seesaw on for dt seconds, in fixed steps. `tilts` are the riders' phone tilts (left seat first;
 * a team of one has just one).
 */
export function stepBoard(b: Board, drops: readonly Drop[], tilts: readonly number[], dt: number): SeesawEvent[] {
  const out: SeesawEvent[] = [];
  const target = plankTarget(tilts.map(leanOf));
  const end = Math.min(SEESAW.duration, b.time + Math.max(0, dt));
  while (b.time < end - 1e-9) stepOnce(b, drops, target, Math.min(SEESAW.step, end - b.time), out);
  return out;
}

/** A team's score: points, and on equal points the team that caught less broccoli. */
export function boardScore(b: Board): number {
  return b.points * 100 + (99 - Math.min(99, b.greens));
}

/** Scores per seat: both partners get their seesaw's score. `teams` holds seat positions. */
export function seesawScores(boards: readonly Board[], teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    const b = boards[i];
    if (!b) return;
    for (const m of members) if (m >= 0 && m < seats) scores[m] = boardScore(b);
  });
  return scores;
}

export function seesawDetail(b: Board, end: End): string {
  const parts = [`${b.points} point${b.points === 1 ? '' : 's'}`, `${b.caught[end]} snack${b.caught[end] === 1 ? '' : 's'} caught by you`];
  if (b.greens) parts.push(`${b.greens} broccoli`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------ computer players

/** A computer rider: what tip it is working towards, when it next looks up, and how it leans now. */
export interface CpuRider {
  /** Its seat. */
  end: End;
  skill: number;
  want: number;
  next: number;
  lean: number;
  /** How far off its guess of each snack's height is (sleepy riders misjudge). */
  off: number[];
  /** Seconds after a drop starts falling before it notices. */
  notice: number[];
  /** Seconds left of staring at the stars. */
  zoned: number;
  /** Broccoli it never notices. */
  blind: Set<number>;
}

export function newCpuRider(drops: readonly Drop[], end: End, skill: number, rng: Rng): CpuRider {
  const s = Math.max(0, Math.min(1, skill));
  return {
    end,
    skill: s,
    want: 0,
    next: 0,
    lean: 0,
    off: drops.map(() => (rng() * 2 - 1) * (0.05 + (1 - s) * 0.28)),
    notice: drops.map(() => 0.2 + (1 - s) * 0.45 + rng() * (0.15 + (1 - s) * 0.4)),
    zoned: 0,
    blind: new Set(drops.map((d, i) => (d.treat === 'broccoli' && rng() < 0.1 + (1 - s) * 0.5 ? i : -1)).filter((i) => i >= 0)),
  };
}

/**
 * The tip a rider would like: the one that catches the most (and the most urgent) snacks it has noticed, keeps
 * clear of broccoli, and doesn't swing the plank about for nothing. Sleepier riders mostly mind their own end.
 */
export function cpuPlan(c: CpuRider, b: Board, drops: readonly Drop[]): number {
  const seen: { d: Drop; left: number; win: [number, number] }[] = [];
  drops.forEach((d, i) => {
    const s = b.states[i];
    if (s !== 'falling' && s !== 'hanging') return;
    if (b.time < d.at + (c.notice[i] ?? 0)) return;
    if (d.treat === 'broccoli' && c.blind.has(i)) return;
    const left = snapsAt(d) - b.time;
    if (left < 0.1) return;
    seen.push({ d, left, win: tipWindow(d.end, d.y + (c.off[i] ?? 0)) });
  });
  const candidates = new Set<number>([b.tip, 0]);
  for (const x of seen) {
    if (x.win[0] > x.win[1]) continue;
    candidates.add((x.win[0] + x.win[1]) / 2);
    if (x.d.treat === 'broccoli') {
      candidates.add(Math.max(-1, x.win[0] - 0.12));
      candidates.add(Math.min(1, x.win[1] + 0.12));
    }
  }
  const mine = 0.15 + (1 - c.skill) * 1.2;
  let best = b.tip;
  let bestValue = -Infinity;
  for (const tip of candidates) {
    const travel = Math.abs(tip - b.tip) * 0.6;
    let value = -Math.abs(tip - b.tip) * 0.25 - Math.abs(tip) * 0.05;
    for (const x of seen) {
      if (x.win[0] > x.win[1] || tip < x.win[0] - 1e-9 || tip > x.win[1] + 1e-9) continue;
      if (x.d.treat === 'broccoli') value -= 3;
      else if (travel < x.left + 0.1) value += 1 + 1.2 / (x.left + 0.4) + (x.d.end === c.end ? mine : 0);
    }
    if (value > bestValue) {
      bestValue = value;
      best = tip;
    }
  }
  return best;
}

/** The phone tilt a computer rider sends this frame. */
export function cpuTilt(c: CpuRider, b: Board, drops: readonly Drop[], rng: Rng, dt: number): number {
  const s = c.skill;
  if (c.zoned > 0) {
    c.zoned -= dt;
    c.lean += (0 - c.lean) * (1 - Math.exp(-2 * dt));
    return tiltFor(c.lean);
  }
  if (rng() < (0.02 + (1 - s) * 0.08) * dt) c.zoned = 0.5 + rng() * (0.6 + (1 - s) * 1.4);
  if (b.time >= c.next) {
    c.want = cpuPlan(c, b, drops);
    c.next = b.time + 0.12 + (1 - s) * 0.4 + rng() * 0.15;
  }
  // Lean for half the tip it wants (the partner gives the rest), and push harder while the plank lags behind.
  const goal = Math.max(-1, Math.min(1, c.want / (2 * SEESAW.together) + (0.6 + s * 0.9) * (c.want - b.tip)));
  c.lean += (goal - c.lean) * (1 - Math.exp(-(2.5 + s * 8) * dt));
  return tiltFor(c.lean);
}
