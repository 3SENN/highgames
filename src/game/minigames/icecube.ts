// Ice Cube Curling: late at night on the kitchen counter, everyone slides ice cubes down their own lane at a
// coaster. A flick up on the phone pushes the cube: the faster the flick, the further it glides. Cubes slow down
// on the counter, slowly melt (a smaller cube glides more easily, but one that melts away is just a puddle) and
// knock into the cubes already in their lane. Three throws each, all at once. After every throw your best cube
// on the coaster scores: 3 in the bullseye, 2 on the ring, 1 on the coaster.
//
// A lane runs from the throw line (z = 0) to the counter's far edge (z = ICE.end); x is across, 0 in the middle.
import type { Rng } from '../rng';

export const ICE = {
  rounds: 3,
  throwWindow: 6, // seconds to flick each round
  gather: 0.15, // a flick can send a few swipes: the fastest within this long after the first counts
  lane: 2.4, // lane width
  coaster: 9, // from the throw line to the coaster's centre
  end: 12, // the counter's far edge: past it, a cube drops into the sink
  bull: 0.33, // scoring radii around the coaster's centre
  ring: 0.7,
  rim: 1.15,
  size: 0.5, // a fresh cube's edge
  melt: 0.024, // edge lost per second
  gone: 0.12, // smaller than this and it's only a puddle
  friction: 2.2, // a fresh cube's slowing down, units a second a second
  minDist: 4, // how far a fresh cube glides for the laziest flick…
  maxDist: 13.5, // …and the fastest
  drift: 0.08, // the most a throw wanders sideways, units a second
  restitution: 0.8, // how bouncy cube-on-cube knocks are
  wallBounce: 0.45,
  step: 1 / 120,
} as const;

export interface Cube {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Edge length; it melts. */
  size: number;
  /** Turning, radians a second (for show, from glancing knocks). */
  spin: number;
  angle: number;
  /** Which throw it was (0-based). */
  round: number;
  gone: null | 'melted' | 'sink';
}

export interface IceLane {
  cubes: Cube[];
  /** Points scored after each round (null until it's scored). */
  rounds: (number | null)[];
}

export type IceEvent = { t: 'knock'; hard: number } | { t: 'sink'; cube: Cube } | { t: 'melted'; cube: Cube };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function newLane(): IceLane {
  return { cubes: [], rounds: Array.from({ length: ICE.rounds }, () => null) };
}

/** How far a fresh cube would glide on its own (before melting) for a flick speed 0..1. */
export function flickDistance(speed: number): number {
  return ICE.minDist + (ICE.maxDist - ICE.minDist) * clamp(speed, 0, 1);
}

/** The push a flick gives: just enough for a fresh cube to glide flickDistance. */
export function launchSpeed(speed: number): number {
  return Math.sqrt(2 * ICE.friction * flickDistance(speed));
}

/** Slides a new cube from the throw line. `drift` (-1..1) is how much it wanders sideways. */
export function throwCube(lane: IceLane, speed: number, drift: number, round: number): Cube {
  const c: Cube = { x: 0, z: 0, vx: clamp(drift, -1, 1) * ICE.drift, vz: launchSpeed(speed), size: ICE.size, spin: (drift || 0.3) * 1.5, angle: 0, round, gone: null };
  lane.cubes.push(c);
  return c;
}

export const live = (c: Cube) => c.gone === null;
const radius = (c: Cube) => c.size * 0.6;

/** How hard the counter slows a cube: a smaller (more melted) cube glides more easily. */
export function frictionOf(c: Cube): number {
  return ICE.friction * (0.55 + 0.45 * (c.size / ICE.size));
}

export function isMoving(c: Cube): boolean {
  return live(c) && (c.vx !== 0 || c.vz !== 0);
}

export function laneMoving(lane: IceLane): boolean {
  return lane.cubes.some(isMoving);
}

/** Moves a lane on by dt seconds: gliding, melting, knocking into each other, the walls and the sink. */
export function stepLane(lane: IceLane, dt: number): IceEvent[] {
  const out: IceEvent[] = [];
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(ICE.step, left);
    left -= h;
    for (const c of lane.cubes) {
      if (!live(c)) continue;
      c.size -= ICE.melt * h;
      if (c.size < ICE.gone) {
        c.gone = 'melted';
        c.vx = c.vz = 0;
        out.push({ t: 'melted', cube: c });
        continue;
      }
      const v = Math.hypot(c.vx, c.vz);
      if (v > 0) {
        const slow = frictionOf(c) * h;
        if (v <= slow) c.vx = c.vz = 0;
        else {
          c.vx *= (v - slow) / v;
          c.vz *= (v - slow) / v;
        }
      }
      c.x += c.vx * h;
      c.z += c.vz * h;
      c.spin *= Math.exp(-1.5 * h);
      c.angle += c.spin * h * Math.min(1, v);
      const wall = ICE.lane / 2 - radius(c);
      if (Math.abs(c.x) > wall) {
        c.x = Math.sign(c.x) * wall;
        if (c.vx * Math.sign(c.x) > 0) c.vx = -c.vx * ICE.wallBounce;
      }
      if (c.z < -0.5) {
        c.z = -0.5;
        if (c.vz < 0) c.vz = -c.vz * ICE.wallBounce;
      }
      if (c.z > ICE.end) {
        c.gone = 'sink';
        c.vx = c.vz = 0;
        out.push({ t: 'sink', cube: c });
      }
    }
    // Knocks: round-ish cubes, heavier the bigger they are.
    const cubes = lane.cubes.filter(live);
    for (let i = 0; i < cubes.length; i++) {
      for (let j = i + 1; j < cubes.length; j++) {
        const a = cubes[i] as Cube;
        const b = cubes[j] as Cube;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const reach = radius(a) + radius(b);
        const d2 = dx * dx + dz * dz;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const nx = d2 > 1e-12 ? dx / d : 0;
        const nz = d2 > 1e-12 ? dz / d : 1;
        const ma = a.size ** 3;
        const mb = b.size ** 3;
        const overlap = reach - d;
        a.x += nx * overlap * (mb / (ma + mb));
        a.z += nz * overlap * (mb / (ma + mb));
        b.x -= nx * overlap * (ma / (ma + mb));
        b.z -= nz * overlap * (ma / (ma + mb));
        const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vrel >= 0) continue;
        const j0 = (-(1 + ICE.restitution) * vrel) / (1 / ma + 1 / mb);
        a.vx += (j0 / ma) * nx;
        a.vz += (j0 / ma) * nz;
        b.vx -= (j0 / mb) * nx;
        b.vz -= (j0 / mb) * nz;
        const glance = (a.vx - b.vx) * nz - (a.vz - b.vz) * nx;
        a.spin += glance * 1.5;
        b.spin -= glance * 1.5;
        if (-vrel > 0.2) out.push({ t: 'knock', hard: -vrel });
      }
    }
  }
  return out;
}

/** How far a cube is from the coaster's centre. */
export function fromCentre(c: Cube): number {
  return Math.hypot(c.x, c.z - ICE.coaster);
}

/** 3 in the bullseye, 2 on the ring, 1 on the coaster, 0 off it (or melted, or in the sink). */
export function cubePoints(c: Cube): number {
  if (!live(c)) return 0;
  const d = fromCentre(c);
  return d <= ICE.bull ? 3 : d <= ICE.ring ? 2 : d <= ICE.rim ? 1 : 0;
}

/** The lane's best cube: the closest one still there. */
export function bestCube(lane: IceLane): Cube | null {
  let best: Cube | null = null;
  for (const c of lane.cubes) if (live(c) && (!best || fromCentre(c) < fromCentre(best))) best = c;
  return best;
}

/** Scores a round from the lane's best cube right now. Returns the points. */
export function scoreRound(lane: IceLane, round: number): number {
  const best = bestCube(lane);
  const points = best ? cubePoints(best) : 0;
  lane.rounds[round] = points;
  return points;
}

export function laneTotal(lane: IceLane): number {
  return lane.rounds.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

export function iceScores(lanes: readonly IceLane[]): number[] {
  return lanes.map(laneTotal);
}

/** The rounds so far, e.g. "3 + 0 + 2 = 5" (for the live list and the results). */
export function roundsLine(lane: IceLane): string {
  const done = lane.rounds.filter((p): p is number => p !== null);
  if (done.length === 0) return '–';
  return done.length === 1 ? `${done[0]}` : `${done.join(' + ')} = ${laneTotal(lane)}`;
}

export function iceDetail(lane: IceLane): string {
  const total = laneTotal(lane);
  return `${total} pt${total === 1 ? '' : 's'} (${lane.rounds.map((p) => p ?? 0).join(' · ')})`;
}

/** How far a lone fresh cube really glides for a flick (melting a little on the way). */
export function glide(speed: number): number {
  const lane = newLane();
  const c = throwCube(lane, speed, 0, 0);
  for (let t = 0; t < 12 && isMoving(c); t += 0.05) stepLane(lane, 0.05);
  return c.gone === 'sink' ? Infinity : c.z;
}

/** The flick speed that sends a lone fresh cube `distance` down the lane. */
export function flickFor(distance: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (glide(mid) < distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------------ computer players

function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(Math.PI * 2 * rng());
}

/** The flick that lands a lone fresh cube in the bullseye (worked out once). */
let ideal: number | null = null;

/** A computer player's flick: aimed at the bullseye, the sleepier the shakier. */
export function cpuFlick(skill: number, rng: Rng): number {
  ideal ??= flickFor(ICE.coaster);
  return clamp(ideal + gauss(rng) * (0.03 + (1 - skill) * 0.14), 0, 1);
}

/** How long a computer player takes to flick after the round starts, in seconds. */
export function cpuDelay(skill: number, rng: Rng): number {
  return 0.7 + rng() * 1.3 + (1 - skill) * 0.9;
}
