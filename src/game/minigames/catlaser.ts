// Laser Kitty: everyone has a laser dot on the floor of a sunny room (the phone pointed at the TV), and one big,
// lazy cat decides which dot is the most interesting. It likes dots that move steadily and close by, ignores dots
// that sit still, and is spooked by dots that jump about too fast (it turns away from that one for a moment).
// It also gets bored of a dot it has followed for a while. Lure it onto YOUR cushion: it curls up and naps there,
// and every second of that nap is yours, until another dot tempts it away.
//
// Positions are on the floor: x across (-halfW..halfW), z towards the screen (-halfD at the back .. halfD at the
// front). A pointer (-1..1, y up) covers exactly that area.
import type { Rng } from '../rng.js';

export const CAT = {
  duration: 35, // seconds
  halfW: 6.2,
  halfD: 3.4,
  cushion: 0.95, // a cushion's radius
  napReach: 0.7, // the cat curls up when it gets this close to a cushion's middle
  trot: 3.2, // the cat's top speed, units a second
  stalk: 0.9, // its speed right next to the dot
  accel: 6,
  turn: 4.5, // radians a second
  still: 0.35, // a dot slower than this (units a second, over half a second) is ignored
  steady: [0.8, 4.5] as const, // the speeds it likes best
  fast: 9, // its liking fades towards this speed
  spook: 10, // a dot moving faster than this over a split second spooks it …
  spookRange: 6, // … if it's this close
  ignore: 2.2, // seconds it ignores a dot that spooked it
  startle: 0.9, // seconds it stays startled
  wake: 0.2, // interest needed to start chasing a dot
  napWake: 0.6, // interest needed to tempt it off a cushion …
  tempt: 1.5, // … for this many seconds
  minNap: 3, // seconds a fresh nap can't be disturbed
  commit: 1.5, // seconds it keeps after a dot it just picked (unless that dot stops or spooks it)
  settle: 0.6, // seconds it takes to curl up
  reach: 3.5, // a dot this far away is half as interesting
  boredUp: 0.05, // boredom a second while it follows a dot up close
  boredDown: 0.1,
  boredMax: 0.6,
  sticky: 1.5, // the dot it is following counts this much more
  revisit: 3, // seconds before it naps again on the cushion it just left
  slowWindow: 0.5,
  fastWindow: 0.12,
} as const;

/** Where the pointers land on the floor. */
export function toFloor(x: number, y: number): { x: number; z: number } {
  return { x: x * CAT.halfW, z: -y * CAT.halfD };
}
export function toPointer(x: number, z: number): { x: number; y: number } {
  return { x: x / CAT.halfW, y: -z / CAT.halfD };
}

/** Each seat's cushion: in the corners (back left, back right, front left, front right), all as far from the middle. */
export function cushions(n: number): { x: number; z: number }[] {
  const cx = CAT.halfW - CAT.cushion - 0.05;
  const cz = CAT.halfD - CAT.cushion;
  const corners = [
    { x: -cx, z: -cz },
    { x: cx, z: -cz },
    { x: -cx, z: cz },
    { x: cx, z: cz },
  ];
  return corners.slice(0, Math.max(1, Math.min(4, n)));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

// ------------------------------------------------------------------ the dots

export interface Dot {
  x: number;
  z: number;
  /** Recent positions: t, x, z, t, x, z, … */
  samples: number[];
  /** Speed over the last half second (steady movement), units a second. */
  slow: number;
  /** Speed over the last split second (jumps and flicks). */
  fast: number;
  boredom: number;
  /** The cat ignores this dot until then (it spooked it). */
  ignoreUntil: number;
}

export function newDot(x: number, z: number): Dot {
  return { x, z, samples: [], slow: 0, fast: 0, boredom: 0, ignoreUntil: 0 };
}

function speedOver(d: Dot, t: number, window: number): number {
  const s = d.samples;
  for (let k = 0; k < s.length; k += 3) {
    const at = s[k] as number;
    if (at >= t - window - 1e-9) {
      const span = t - at;
      return span < window * 0.5 ? 0 : dist(d.x, d.z, s[k + 1] as number, s[k + 2] as number) / span;
    }
  }
  return 0;
}

/** Moves a dot (call it every step, also when it doesn't move) and measures how it moves. */
export function moveDot(d: Dot, x: number, z: number, t: number): void {
  d.x = clamp(x, -CAT.halfW, CAT.halfW);
  d.z = clamp(z, -CAT.halfD, CAT.halfD);
  d.samples.push(t, d.x, d.z);
  let drop = 0;
  while (drop + 3 < d.samples.length && (d.samples[drop] as number) < t - CAT.slowWindow - 0.05) drop += 3;
  if (drop) d.samples.splice(0, drop);
  d.slow = speedOver(d, t, CAT.slowWindow);
  d.fast = speedOver(d, t, CAT.fastWindow);
}

/** How much the cat likes a dot's movement, 0..1: not still, best steady, less when it zips about. */
export function liking(speed: number): number {
  const [lo, hi] = CAT.steady;
  if (speed <= CAT.still) return 0;
  if (speed < lo) return (speed - CAT.still) / (lo - CAT.still);
  if (speed <= hi) return 1;
  return Math.max(0.25, 1 - ((speed - hi) / (CAT.fast - hi)) * 0.75);
}

// ------------------------------------------------------------------ the cat

export type CatMode = 'idle' | 'chase' | 'startled' | 'settle' | 'nap';

export interface Cat {
  x: number;
  z: number;
  /** Which way it faces: 0 = towards the screen (+z), x = sin, z = cos. */
  heading: number;
  speed: number;
  mode: CatMode;
  /** Seconds in the current mode. */
  modeT: number;
  /** The dot it follows, or null. */
  target: number | null;
  /** When it picked that dot. */
  since: number;
  /** How tempted the napping cat is to get up, 0..1. */
  tempt: number;
  /** The cushion it is curled up on (settle, nap), or null. */
  cushion: number | null;
  left: number | null;
  leftAt: number;
}

export function newCat(): Cat {
  return { x: 0, z: 0, heading: 0, speed: 0, mode: 'idle', modeT: 0, target: null, since: 0, tempt: 0, cushion: null, left: null, leftAt: -99 };
}

/**
 * How interesting a dot is to the cat right now, 0..1: how it moves, how close it is, how bored of it the cat is,
 * and whether it is in front of the cat (a napping cat has its eyes shut and only goes by distance).
 */
export function interest(cat: Cat, d: Dot, t: number): number {
  if (t < d.ignoreUntil) return 0;
  const gap = dist(cat.x, cat.z, d.x, d.z);
  const r = gap / CAT.reach;
  let view = 1;
  if (cat.mode !== 'nap' && cat.mode !== 'settle' && gap > 0.3) {
    const ahead = (Math.sin(cat.heading) * (d.x - cat.x) + Math.cos(cat.heading) * (d.z - cat.z)) / gap;
    view = 0.55 + 0.45 * ((1 + ahead) / 2);
  }
  return liking(d.slow) * (1 / (1 + r * r)) * (1 - d.boredom) * view;
}

export type CatEvent =
  | { kind: 'chase'; dot: number }
  | { kind: 'spook'; dot: number; napping: boolean }
  | { kind: 'settle'; cushion: number }
  | { kind: 'nap'; cushion: number }
  | { kind: 'wake'; cushion: number; dot: number }
  | { kind: 'lose' };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** One step of the cat. `dots` by seat, `pads` the cushions by seat. */
export function stepCat(cat: Cat, dots: readonly Dot[], pads: readonly { x: number; z: number }[], t: number, dt: number): CatEvent[] {
  const events: CatEvent[] = [];
  cat.modeT += dt;
  const resting = cat.mode === 'nap' || cat.mode === 'settle';

  // A dot jumping about close by spooks it: it turns away from that one for a moment.
  dots.forEach((d, i) => {
    if (t < d.ignoreUntil || d.fast < CAT.spook || dist(cat.x, cat.z, d.x, d.z) > CAT.spookRange) return;
    d.ignoreUntil = t + CAT.ignore;
    events.push({ kind: 'spook', dot: i, napping: resting });
    if (resting) return;
    cat.mode = 'startled';
    cat.modeT = 0;
    cat.target = null;
    cat.heading = Math.atan2(cat.x - d.x, cat.z - d.z);
    cat.speed = 1.6;
  });

  // It gets bored of a dot it has been following up close.
  dots.forEach((d, i) => {
    const following = cat.mode === 'chase' && cat.target === i && dist(cat.x, cat.z, d.x, d.z) < 2.5;
    d.boredom = clamp(d.boredom + (following ? CAT.boredUp : -CAT.boredDown) * dt, 0, CAT.boredMax);
  });

  const best = (sticky: boolean) => {
    let pick: number | null = null;
    let top = 0;
    dots.forEach((d, i) => {
      const v = interest(cat, d, t) * (sticky && i === cat.target ? CAT.sticky : 1);
      if (v > top) {
        top = v;
        pick = i;
      }
    });
    return { pick: pick as number | null, top };
  };

  switch (cat.mode) {
    case 'startled':
      cat.speed = Math.max(0, cat.speed - dt * 2.5);
      if (cat.modeT >= CAT.startle) setMode(cat, 'idle');
      break;
    case 'settle': {
      const pad = pads[cat.cushion ?? 0];
      if (pad) {
        const k = Math.min(1, dt * 6);
        cat.x += (pad.x - cat.x) * k;
        cat.z += (pad.z - cat.z) * k;
      }
      cat.speed = 0;
      cat.heading += dt * 5; // turns round before lying down …
      if (cat.modeT >= CAT.settle) {
        cat.heading = Math.atan2(-cat.x, -cat.z); // … to face the room
        setMode(cat, 'nap');
        events.push({ kind: 'nap', cushion: cat.cushion ?? 0 });
      }
      break;
    }
    case 'nap': {
      if (cat.modeT < CAT.minNap) break;
      const { pick, top } = best(false);
      const tempted = pick !== null && top >= CAT.napWake;
      cat.tempt = clamp(cat.tempt + (tempted ? 1 : -0.5) * (dt / CAT.tempt), 0, 1);
      if (tempted && cat.tempt >= 1) {
        const from = cat.cushion ?? 0;
        cat.left = from;
        cat.leftAt = t;
        cat.cushion = null;
        cat.target = pick;
        cat.since = t;
        cat.tempt = 0;
        setMode(cat, 'chase');
        events.push({ kind: 'wake', cushion: from, dot: pick });
      }
      break;
    }
    case 'idle':
    case 'chase': {
      const held = cat.mode === 'chase' && cat.target !== null && t - cat.since < CAT.commit;
      const keep = held ? interest(cat, dots[cat.target as number] as Dot, t) : 0;
      const { pick, top } = held && keep > 0.05 ? { pick: cat.target, top: keep } : best(true);
      if (pick !== null && top >= (cat.mode === 'chase' ? CAT.wake * 0.6 : CAT.wake)) {
        if (cat.target !== pick || cat.mode !== 'chase') {
          events.push({ kind: 'chase', dot: pick });
          cat.since = t;
        }
        cat.target = pick;
        if (cat.mode !== 'chase') setMode(cat, 'chase');
      } else if (cat.mode === 'chase') {
        cat.target = null;
        setMode(cat, 'idle');
        events.push({ kind: 'lose' });
      }
      let want = 0;
      const d = cat.target === null ? null : dots[cat.target];
      if (cat.mode === 'chase' && d) {
        const gap = dist(cat.x, cat.z, d.x, d.z);
        const face = Math.atan2(d.x - cat.x, d.z - cat.z);
        const diff = wrap(face - cat.heading);
        cat.heading = wrap(cat.heading + clamp(diff, -CAT.turn * dt, CAT.turn * dt));
        want = gap < 0.3 ? 0 : gap < 1.4 ? CAT.stalk + (CAT.trot - CAT.stalk) * Math.max(0, (gap - 0.4) / 1.0) : CAT.trot;
        want *= Math.max(0.15, Math.cos(diff));
      }
      cat.speed = cat.speed < want ? Math.min(want, cat.speed + CAT.accel * dt) : Math.max(want, cat.speed - CAT.accel * dt);
      // Cats can't resist a cushion.
      for (let j = 0; j < pads.length; j++) {
        const pad = pads[j] as { x: number; z: number };
        if (dist(cat.x, cat.z, pad.x, pad.z) > CAT.napReach) continue;
        if (j === cat.left && t - cat.leftAt < CAT.revisit) continue;
        cat.cushion = j;
        cat.target = null;
        cat.tempt = 0;
        setMode(cat, 'settle');
        events.push({ kind: 'settle', cushion: j });
        break;
      }
      break;
    }
  }
  if (cat.mode !== 'settle' && cat.mode !== 'nap') {
    cat.x = clamp(cat.x + Math.sin(cat.heading) * cat.speed * dt, -CAT.halfW, CAT.halfW);
    cat.z = clamp(cat.z + Math.cos(cat.heading) * cat.speed * dt, -CAT.halfD, CAT.halfD);
  }
  return events;
}

function setMode(cat: Cat, mode: CatMode): void {
  cat.mode = mode;
  cat.modeT = 0;
}

/** Who the napping cat is earning seconds for, or null. */
export function napper(cat: Cat): number | null {
  return cat.mode === 'nap' ? cat.cushion : null;
}

export function catScores(nap: readonly number[]): number[] {
  return nap.map((s) => Math.round(s * 10) / 10);
}

// ------------------------------------------------------------------ computer players

/**
 * A computer player's laser: it slides its dot up beside the cat (on the side of its own cushion), keeps it
 * moving in lazy circles until the cat follows, then leads it home a step ahead. While the cat naps on its
 * cushion it keeps the dot still. Sleepier ones react later, drift off, and now and then flick the dot.
 */
export interface LaserCpu {
  x: number;
  z: number;
  vx: number;
  vz: number;
  plan: 'park' | 'lure' | 'home';
  /** Where it last looked at the cat (it reacts a moment late). */
  seenX: number;
  seenZ: number;
  /** How far off its aim is. */
  offX: number;
  offZ: number;
  orbit: number;
  nextThink: number;
  /** Zoned out until then (the dot sits still). */
  daze: number;
  /** Top speed for now (it varies a little). */
  pace: number;
}

export function newLaserCpu(x: number, z: number): LaserCpu {
  return { x, z, vx: 0, vz: 0, plan: 'park', seenX: 0, seenZ: 0, offX: 0, offZ: 0, orbit: 0, nextThink: 0, daze: 0, pace: 3 };
}

/** One step of a computer player's dot (floor position). */
export function cpuLaser(c: LaserCpu, me: number, cat: Cat, pads: readonly { x: number; z: number }[], t: number, dt: number, skill: number, rng: Rng): { x: number; z: number } {
  const home = pads[me] ?? { x: 0, z: 0 };
  if (t < c.daze) return { x: c.x, z: c.z };
  if (rng() < (0.01 + (1 - skill) * 0.05) * dt) {
    c.daze = t + 0.4 + rng() * (0.3 + (1 - skill) * 1.0);
    c.vx = 0;
    c.vz = 0;
    return { x: c.x, z: c.z };
  }
  // A clumsy flick of the wrist now and then.
  if (rng() < (1 - skill) * 0.05 * dt) {
    c.x = clamp(c.x + (rng() - 0.5) * 5, -CAT.halfW, CAT.halfW);
    c.z = clamp(c.z + (rng() - 0.5) * 3, -CAT.halfD, CAT.halfD);
    return { x: c.x, z: c.z };
  }
  const following = cat.target === me && cat.mode === 'chase';
  if (t >= c.nextThink) {
    c.nextThink = t + 0.12 + (1 - skill) * 0.45 * (0.5 + rng());
    c.seenX = cat.x;
    c.seenZ = cat.z;
    c.pace = 2.8 + skill * 0.8 + (rng() - 0.5) * (0.4 + (1 - skill) * 2);
    const mine = cat.cushion === me && (cat.mode === 'nap' || cat.mode === 'settle');
    c.plan = mine ? 'park' : following && dist(cat.x, cat.z, home.x, home.z) < 1.8 ? 'home' : 'lure';
    const sloppy = 0.15 + (1 - skill) * 0.7;
    c.offX = (rng() - 0.5) * sloppy;
    c.offZ = (rng() - 0.5) * sloppy;
  }
  let tx = c.x;
  let tz = c.z;
  if (c.plan === 'home') {
    tx = home.x + c.offX * 0.3;
    tz = home.z + c.offZ * 0.3;
  } else if (c.plan === 'lure') {
    const hx = home.x - c.seenX;
    const hz = home.z - c.seenZ;
    const h = Math.hypot(hx, hz) || 1;
    const lead = following ? 1.0 + skill * 0.3 : 1.3;
    tx = c.seenX + (hx / h) * lead + c.offX;
    tz = c.seenZ + (hz / h) * lead + c.offZ;
  }
  let want = 0;
  if (c.plan !== 'park') {
    // Lazy circles round the spot keep the dot moving (and interesting).
    if (dist(c.x, c.z, tx, tz) < 0.9) c.orbit += dt * 2.6;
    tx += Math.cos(c.orbit) * 0.6;
    tz += Math.sin(c.orbit) * 0.6;
    want = Math.min(c.pace, Math.max(1.3, dist(c.x, c.z, tx, tz) * 6));
  }
  const dx = tx - c.x;
  const dz = tz - c.z;
  const d = Math.hypot(dx, dz);
  const k = Math.min(1, dt * 8);
  c.vx += ((d > 1e-6 ? (dx / d) * want : 0) - c.vx) * k;
  c.vz += ((d > 1e-6 ? (dz / d) * want : 0) - c.vz) * k;
  if (c.plan === 'park' && Math.hypot(c.vx, c.vz) < 0.05) {
    c.vx = 0;
    c.vz = 0;
  }
  c.x = clamp(c.x + c.vx * dt, -CAT.halfW, CAT.halfW);
  c.z = clamp(c.z + c.vz * dt, -CAT.halfD, CAT.halfD);
  return { x: c.x, z: c.z };
}
