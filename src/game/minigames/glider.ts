// Glider Rings: hold your phone flat like a paper plane and tilt it to steer through rings.
import { type Rng, randInt } from '../rng.js';

export const GLIDER = {
  duration: 30,
  speed: 16, // forward units per second
  steer: 11, // sideways units per second at full tilt
  response: 5, // how quickly the glider follows the tilt
  bounds: { x: 9, yMin: 1.5, yMax: 10 },
  spacing: 13,
  firstRing: 26,
} as const;

export interface Glider {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rings: number;
}

export interface Ring {
  z: number; // distance along the course
  x: number;
  y: number;
  r: number;
  gold: boolean;
  taken: number[]; // seats that flew through
}

export function newGlider(seat: number, seats: number): Glider {
  const spread = seats > 1 ? (seat / (seats - 1) - 0.5) * 8 : 0;
  return { x: spread, y: 5, vx: 0, vy: 0, rings: 0 };
}

export function makeRings(rng: Rng): Ring[] {
  const count = Math.ceil((GLIDER.duration * GLIDER.speed - GLIDER.firstRing) / GLIDER.spacing) + 1;
  const rings: Ring[] = [];
  let x = 0;
  let y = 5;
  for (let i = 0; i < count; i++) {
    x = Math.max(-GLIDER.bounds.x + 2, Math.min(GLIDER.bounds.x - 2, x + randInt(rng, -5, 5)));
    y = Math.max(GLIDER.bounds.yMin + 1.5, Math.min(GLIDER.bounds.yMax - 1.5, y + randInt(rng, -3, 3)));
    const gold = i > 2 && rng() < 0.18;
    rings.push({ z: GLIDER.firstRing + i * GLIDER.spacing, x, y, r: gold ? 1.7 : 2.4, gold, taken: [] });
  }
  return rings;
}

export function stepGlider(g: Glider, input: { x: number; y: number }, dt: number): void {
  const k = 1 - Math.exp(-GLIDER.response * dt);
  g.vx += (input.x * GLIDER.steer - g.vx) * k;
  g.vy += (input.y * GLIDER.steer - g.vy) * k;
  g.x = Math.max(-GLIDER.bounds.x, Math.min(GLIDER.bounds.x, g.x + g.vx * dt));
  g.y = Math.max(GLIDER.bounds.yMin, Math.min(GLIDER.bounds.yMax, g.y + g.vy * dt));
}

/** Checks a glider against a ring it is passing now. Returns the points scored (0, 1 or 3). */
export function flyThrough(g: Glider, ring: Ring, seat: number): number {
  if (ring.taken.includes(seat)) return 0;
  if (Math.hypot(g.x - ring.x, g.y - ring.y) > ring.r) return 0;
  ring.taken.push(seat);
  const points = ring.gold ? 3 : 1;
  g.rings += points;
  return points;
}
