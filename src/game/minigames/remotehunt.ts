// Where's the Remote? The lights are off in a cluttered living room and the TV remote is hiding under one of ten
// things on the floor. Everyone sweeps a torch beam around (the phone pointed at the TV). A bit of the remote peeks
// out from under its hiding place, but so do a few look-alikes (a chocolate bar, a phone case, the fan's remote).
// Hold the beam on something and press Check to lift it; lifting the wrong thing costs a second.
// First to find it scores 3, then 2, then 1. Three rounds, and the remote hides somewhere new each time.
//
// Positions are on the floor: x across (-halfW..halfW), z towards the screen (-halfD at the back .. halfD at the
// front). A pointer (-1..1, y up) covers exactly that area.
import { type Rng, shuffle } from '../rng.js';

export const HUNT = {
  rounds: 3,
  roundTime: 14, // seconds a round lasts at most
  grace: 5, // once someone has found it, the others get this long to find it too
  lift: 0.6, // seconds the beam has to stay on a thing to lift it
  wrongWait: 1, // seconds you wait after lifting the wrong thing
  points: [3, 2, 1],
  halfW: 6.2,
  halfD: 3.1,
  beam: 1.25, // radius of a torch beam on the floor
  grab: 0.3, // reach around a thing's own radius when you press Check
  keep: 0.75, // how far past a thing's radius the beam may drift while lifting it
} as const;

export const THINGS = [
  { kind: 'cushion', name: 'Cushion', r: 0.72 },
  { kind: 'pizza', name: 'Pizza box', r: 0.78 },
  { kind: 'plant', name: 'Plant', r: 0.58 },
  { kind: 'hoodie', name: 'Hoodie', r: 0.75 },
  { kind: 'catbed', name: 'Cat bed', r: 0.8 },
  { kind: 'basket', name: 'Laundry basket', r: 0.7 },
  { kind: 'mags', name: 'Magazines', r: 0.6 },
  { kind: 'beanbag', name: 'Beanbag', r: 0.85 },
  { kind: 'blanket', name: 'Blanket', r: 0.82 },
  { kind: 'bowl', name: 'Snack bowl', r: 0.55 },
] as const;
export type ThingKind = (typeof THINGS)[number]['kind'];

export interface Thing {
  kind: ThingKind;
  name: string;
  x: number;
  z: number;
  r: number;
}

/** What can be under a thing. The decoys look like the remote at first glance; the junk doesn't. */
export type Content = 'remote' | 'choc' | 'case' | 'fan' | 'sock' | 'crisps' | 'coins' | 'none';
export const DECOYS = ['choc', 'case', 'fan'] as const;
export const JUNK = ['sock', 'crisps', 'coins'] as const;
export const CONTENT_NAME: Record<Content, string> = {
  remote: 'The remote!',
  choc: 'A chocolate bar…',
  case: 'A phone case…',
  fan: "The fan's remote…",
  sock: 'A sock',
  crisps: 'Crisps',
  coins: 'Some coins',
  none: 'Nothing',
};

export function isDecoy(c: Content): boolean {
  return (DECOYS as readonly string[]).includes(c);
}

/** Where a pointer (-1..1, y up) lands on the floor, and back. */
export function toFloor(x: number, y: number): { x: number; z: number } {
  return { x: x * HUNT.halfW, z: -y * HUNT.halfD };
}
export function toPointer(x: number, z: number): { x: number; y: number } {
  return { x: x / HUNT.halfW, y: -z / HUNT.halfD };
}

/** The room for one game: the ten things on a loose, staggered grid (two rows of five). */
export function layRoom(rng: Rng): Thing[] {
  const kinds = shuffle(rng, THINGS);
  return kinds.map((k, i) => {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const x = (col - 2) * 2.45 + (row === 0 ? -0.5 : 0.5) + (rng() - 0.5) * 0.4;
    const z = (row === 0 ? -1.45 : 1.45) + (rng() - 0.5) * 0.5;
    return { kind: k.kind, name: k.name, x, z, r: k.r };
  });
}

export interface HuntRound {
  /** What is under each thing. */
  under: Content[];
  /** Which thing hides the remote. */
  remote: number;
  /** Per thing, which way its secret peeks out (radians around y; 0 = straight towards the screen). */
  angle: number[];
}

/** Hides the remote under a thing it hasn't been under yet, with look-alikes and junk under some of the others. */
export function planRound(rng: Rng, things: readonly Thing[], round: number, used: readonly number[] = []): HuntRound {
  const all = things.map((_, i) => i);
  const fresh = all.filter((i) => !used.includes(i));
  const pool = fresh.length ? fresh : all;
  const remote = pool[Math.floor(rng() * pool.length)] as number;
  const under: Content[] = things.map(() => 'none');
  under[remote] = 'remote';
  const others = shuffle(
    rng,
    all.filter((i) => i !== remote),
  );
  const decoys = shuffle(rng, DECOYS).slice(0, round === 0 ? 2 : 3);
  decoys.forEach((d, k) => {
    const at = others[k];
    if (at !== undefined) under[at] = d;
  });
  const junk = shuffle(rng, JUNK);
  junk.forEach((j, k) => {
    const at = others[decoys.length + k];
    if (at !== undefined) under[at] = j;
  });
  return { under, remote, angle: things.map(() => (rng() - 0.5) * 2.0) };
}

/** The bit that peeks out from under a thing (where a beam has to be to light it up). */
export function peekPoint(thing: Thing, angle: number): { x: number; z: number } {
  const d = thing.r + 0.12;
  return { x: thing.x + Math.sin(angle) * d, z: thing.z + Math.cos(angle) * d };
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** The thing under a beam (the closest one in reach), or null. */
export function thingAt(things: readonly Thing[], x: number, z: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  things.forEach((t, i) => {
    const d = dist(x, z, t.x, t.z);
    if (d <= t.r + HUNT.grab && d - t.r < bestD) {
      best = i;
      bestD = d - t.r;
    }
  });
  return best;
}

/** For each thing, whether what peeks out from under it is lit by one of the beams. */
export function litPeeks(beams: readonly { x: number; z: number }[], things: readonly Thing[], plan: HuntRound): boolean[] {
  return things.map((t, i) => {
    if (plan.under[i] === 'none') return false;
    const p = peekPoint(t, plan.angle[i] ?? 0);
    return beams.some((b) => dist(b.x, b.z, p.x, p.z) <= HUNT.beam);
  });
}

// ------------------------------------------------------------------ a player's search

export interface Searcher {
  /** The thing being lifted, or null. */
  lifting: number | null;
  /** When the lift started (already corrected for the phone's lag). */
  liftStart: number;
  /** No new checks before this time (after lifting the wrong thing). */
  waitUntil: number;
  /** When this player lifted the real remote, or null. */
  foundAt: number | null;
}

export function newSearcher(): Searcher {
  return { lifting: null, liftStart: 0, waitUntil: 0, foundAt: null };
}

/** Check was pressed with the beam at (x, z) at time `t`. Returns what it started. */
export function startCheck(s: Searcher, things: readonly Thing[], x: number, z: number, t: number): 'lift' | 'nothing' | 'ignored' {
  if (s.foundAt !== null || s.lifting !== null || t < s.waitUntil) return 'ignored';
  const at = thingAt(things, x, z);
  if (at === null) return 'nothing';
  s.lifting = at;
  s.liftStart = t;
  return 'lift';
}

export type LiftEvent = { kind: 'cancel'; thing: number } | { kind: 'found'; thing: number } | { kind: 'wrong'; thing: number; content: Content };

/** Moves a lift along with the beam at (x, z). A lift needs the beam to stay on the thing. */
export function stepSearcher(s: Searcher, things: readonly Thing[], plan: HuntRound, x: number, z: number, t: number): LiftEvent | null {
  if (s.lifting === null) return null;
  const thing = s.lifting;
  const th = things[thing];
  if (!th || dist(x, z, th.x, th.z) > th.r + HUNT.keep) {
    s.lifting = null;
    return { kind: 'cancel', thing };
  }
  if (t < s.liftStart + HUNT.lift) return null;
  s.lifting = null;
  const content = plan.under[thing] ?? 'none';
  if (content === 'remote') {
    s.foundAt = s.liftStart + HUNT.lift;
    return { kind: 'found', thing };
  }
  s.waitUntil = t + HUNT.wrongWait;
  return { kind: 'wrong', thing, content };
}

/** How far a lift has got, 0..1. */
export function liftProgress(s: Searcher, t: number): number {
  return s.lifting === null ? 0 : Math.min(1, Math.max(0, (t - s.liftStart) / HUNT.lift));
}

/** Points for a round by finishing order: 3, 2, 1, then nothing. Equal times share. */
export function roundPoints(foundAt: readonly (number | null)[]): number[] {
  const sorted = foundAt.filter((t): t is number => t !== null).sort((a, b) => a - b);
  return foundAt.map((t) => (t === null ? 0 : (HUNT.points[sorted.indexOf(t)] ?? 0)));
}

/** Points first; equal points are broken by the total time it took. */
export function huntScores(points: readonly number[], totalTime: readonly number[]): number[] {
  return points.map((p, i) => p * 1000 - (totalTime[i] ?? 0));
}

// ------------------------------------------------------------------ computer players

/**
 * A computer player's torch: it sweeps from thing to thing, notices what peeks out where any beam shines (the
 * sharper it is, the quicker, and the less it falls for a look-alike), and checks what it believes is the remote.
 * Sleepy ones also check things on a hunch now and then.
 */
export interface HuntCpu {
  /** Where the beam is, on the floor. */
  x: number;
  z: number;
  vx: number;
  vz: number;
  goal: number | null;
  /** Heading to the goal to check it (not just to have a look). */
  check: boolean;
  pressed: boolean;
  dwell: number;
  /** Per thing: how sure it is that's the remote (acts at 1). */
  notice: number[];
  ruledOut: boolean[];
  /** A little offset so it doesn't aim at the dead centre every time. */
  ox: number;
  oz: number;
}

export function newHuntCpu(things: number, rng: Rng): HuntCpu {
  return {
    x: (rng() - 0.5) * 4,
    z: 0,
    vx: 0,
    vz: 0,
    goal: null,
    check: false,
    pressed: false,
    dwell: 0,
    notice: Array.from({ length: things }, () => 0),
    ruledOut: Array.from({ length: things }, () => false),
    ox: 0,
    oz: 0,
  };
}

export interface HuntSeen {
  things: readonly Thing[];
  plan: HuntRound;
  /** For each thing, whether its secret is lit by any beam right now. */
  lit: readonly boolean[];
  /** What everyone has seen under each thing this round (lifted up), or null. */
  shown: readonly (Content | null)[];
}

/** One step of a computer player. Returns where its beam is and whether it presses Check now. */
export function cpuHunt(c: HuntCpu, s: Searcher, seen: HuntSeen, t: number, dt: number, skill: number, rng: Rng): { x: number; z: number; press: boolean } {
  const { things, plan, lit, shown } = seen;
  if (s.foundAt !== null) return { x: c.x, z: c.z, press: false };
  // What it learns from lifts everyone saw.
  shown.forEach((what, i) => {
    if (what === null) return;
    if (what === 'remote') c.notice[i] = (c.notice[i] ?? 0) + dt * (0.8 + 2.4 * skill);
    else c.ruledOut[i] = true;
  });
  // What it spots in the beams.
  lit.forEach((on, i) => {
    if (!on || c.ruledOut[i]) return;
    const what = plan.under[i] ?? 'none';
    const rate = what === 'remote' ? 0.6 + 3.2 * skill : isDecoy(what) ? 0.08 + 0.75 * (1 - skill) : 0;
    c.notice[i] = (c.notice[i] ?? 0) + dt * rate * (0.6 + rng() * 0.8);
  });
  if (!c.check) {
    let best = -1;
    let bestN = 1;
    c.notice.forEach((n, i) => {
      if (!c.ruledOut[i] && n >= bestN) {
        best = i;
        bestN = n;
      }
    });
    if (best >= 0) setGoal(c, best, true, rng);
  }

  // A lift in progress: hold still. A lift that ended: learn from it.
  if (s.lifting !== null) return { x: c.x, z: c.z, press: false };
  if (c.pressed) {
    c.pressed = false;
    if (t < s.waitUntil && c.goal !== null) {
      c.ruledOut[c.goal] = true;
      c.notice[c.goal] = 0;
      c.check = false;
      c.goal = null;
    }
  }

  // Choose where to look next.
  if (c.goal === null || (c.check && c.ruledOut[c.goal])) {
    c.check = false;
    const open = things.map((_, i) => i).filter((i) => !c.ruledOut[i] && i !== c.goal);
    if (open.length) {
      const w = open.map((i) => {
        const th = things[i] as Thing;
        return 1 / (0.6 + dist(c.x, c.z, th.x, th.z));
      });
      let r = rng() * w.reduce((a, b) => a + b, 0);
      let pickI = open[0] as number;
      for (let k = 0; k < open.length; k++) {
        r -= w[k] as number;
        if (r <= 0) {
          pickI = open[k] as number;
          break;
        }
      }
      setGoal(c, pickI, false, rng);
      c.dwell = 0.2 + (1 - skill) * 0.5 + rng() * 0.3;
    }
  }

  // Glide the beam towards the goal.
  const goal = c.goal === null ? null : (things[c.goal] ?? null);
  const gx = goal ? goal.x + c.ox : c.x;
  const gz = goal ? goal.z + c.oz : c.z;
  const vmax = 3.2 + 4.8 * skill;
  const dx = gx - c.x;
  const dz = gz - c.z;
  const d = Math.hypot(dx, dz);
  const want = Math.min(vmax, d * 4);
  const k = Math.min(1, dt * 8);
  c.vx += ((d > 1e-6 ? (dx / d) * want : 0) - c.vx) * k;
  c.vz += ((d > 1e-6 ? (dz / d) * want : 0) - c.vz) * k;
  c.x = Math.max(-HUNT.halfW, Math.min(HUNT.halfW, c.x + c.vx * dt));
  c.z = Math.max(-HUNT.halfD, Math.min(HUNT.halfD, c.z + c.vz * dt));

  let press = false;
  if (goal && dist(c.x, c.z, goal.x, goal.z) < goal.r * 0.7) {
    if (c.check) {
      if (t >= s.waitUntil) {
        press = true;
        c.pressed = true;
      }
    } else {
      c.dwell -= dt;
      if (c.dwell <= 0) {
        // A hunch: sometimes it just checks what it is looking at.
        if (rng() < 0.04 + (1 - skill) * 0.12) setGoal(c, c.goal as number, true, rng);
        else c.goal = null;
      }
    }
  }
  return { x: c.x, z: c.z, press };
}

function setGoal(c: HuntCpu, goal: number, check: boolean, rng: Rng): void {
  if (c.goal !== goal) {
    c.ox = (rng() - 0.5) * 0.5;
    c.oz = (rng() - 0.5) * 0.5;
  }
  c.goal = goal;
  c.check = check;
  c.pressed = false;
}
