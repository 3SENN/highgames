// Sketchy: everyone gets the same silly prompt and 25 seconds to doodle it on their phone. The drawings end up
// on the fridge; then everyone votes for their favourite (never their own). Votes are the score, and on equal
// votes whoever put more ink on the paper goes first.
import { type Rng, pick } from '../rng.js';

export const SKETCHY = {
  drawTime: 25, // seconds to draw
  voteTime: 12, // seconds to vote
  maxPoints: 3000, // points (x, y pairs) kept per drawing
} as const;

/** What to draw. Everyone gets the same one. */
export const PROMPTS = [
  'a cat that just woke up',
  'the last slice of pizza',
  "your houseplant's feelings",
  'a very relaxed cloud',
  "the snack you're thinking about",
  'the moon having a lie-in',
  "a toaster's dream",
  'the sock that went missing',
  'a sleepy dragon',
  'the perfect blanket fort',
  'a biscuit dunked too long',
  'a snail on holiday',
  'the remote, hiding',
  'a really good nap',
  'a pigeon with opinions',
  'noodles, but fancy',
  'the fridge at 3 am',
  'a sofa with a secret',
] as const;

export function pickPrompt(rng: Rng): string {
  return pick(rng, PROMPTS);
}

/** A drawing: strokes of flat x, y pairs (0..1 of the square pad, y down). */
export type Drawing = number[][];

/**
 * Adds a chunk of points from the phone: `start` begins a new stroke, otherwise it continues the last one.
 * Keeps at most `cap` points in all; returns how many were taken.
 */
export function addChunk(drawing: Drawing, pts: readonly number[], start: boolean, cap: number = SKETCHY.maxPoints): number {
  const have = drawing.reduce((n, s) => n + s.length / 2, 0);
  const take = Math.max(0, Math.min(Math.floor(pts.length / 2), cap - have));
  if (take === 0) return 0;
  if (start || drawing.length === 0) drawing.push([]);
  const stroke = drawing[drawing.length - 1] as number[];
  for (let i = 0; i < take * 2; i++) stroke.push(pts[i] as number);
  return take;
}

/** How much ink went on the paper: the length of every stroke added up (in pad widths). */
export function inkLength(drawing: Drawing): number {
  let ink = 0;
  for (const s of drawing) for (let i = 2; i + 1 < s.length; i += 2) ink += Math.hypot((s[i] as number) - (s[i - 2] as number), (s[i + 1] as number) - (s[i - 1] as number));
  return ink;
}

/** Who a seat can vote for: everyone but itself. */
export function voteOptions(seats: number, seat: number): number[] {
  return Array.from({ length: seats }, (_, i) => i).filter((i) => i !== seat);
}

/** Computer players just like whatever catches their eye. */
export function cpuVote(rng: Rng, seats: number, seat: number): number | null {
  const options = voteOptions(seats, seat);
  return options.length ? pick(rng, options) : null;
}

/** Votes each seat received. Votes for yourself or for nobody don't count. */
export function tally(votes: readonly (number | null)[]): number[] {
  const got = votes.map(() => 0);
  votes.forEach((v, voter) => {
    if (v !== null && v !== voter && v >= 0 && v < got.length) got[v] = (got[v] ?? 0) + 1;
  });
  return got;
}

/** Votes first; on equal votes, more ink. */
export function sketchyScores(votes: readonly number[], ink: readonly number[]): number[] {
  return votes.map((v, i) => v * 1000 + Math.min(999, Math.round((ink[i] ?? 0) * 10)));
}

// ------------------------------------------------------------------ computer players' doodles

type P = [number, number];

/** An ellipse (or part of one) as points; angles go clockwise on screen because y points down. */
function arc(cx: number, cy: number, rx: number, ry: number, from = 0, to = Math.PI * 2, steps = 28): P[] {
  const out: P[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

function line(x0: number, y0: number, x1: number, y1: number, steps = 6): P[] {
  return Array.from({ length: steps + 1 }, (_, i): P => [x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]);
}

/** Turns points into a stroke with a gentle hand-drawn wobble, kept on the paper. */
function hand(rng: Rng, pts: readonly P[], amp: number): number[] {
  const f1 = 5 + rng() * 6;
  const f2 = 11 + rng() * 9;
  const p1 = rng() * 6.3;
  const p2 = rng() * 6.3;
  const out: number[] = [];
  pts.forEach(([x, y], i) => {
    const u = i / Math.max(1, pts.length - 1);
    const dx = amp * (Math.sin(u * f1 + p1) + 0.5 * Math.sin(u * f2 + p2));
    const dy = amp * (Math.cos(u * f1 * 0.9 + p2) + 0.5 * Math.sin(u * f2 * 1.1 + p1));
    out.push(Math.round(Math.min(0.98, Math.max(0.02, x + dx)) * 1000) / 1000, Math.round(Math.min(0.98, Math.max(0.02, y + dy)) * 1000) / 1000);
  });
  return out;
}

type Shape = (rng: Rng, cx: number, cy: number, r: number) => P[][];

const SHAPES: Record<string, Shape> = {
  smiley: (_, cx, cy, r) => [
    arc(cx, cy, r, r),
    arc(cx - r * 0.35, cy - r * 0.25, r * 0.08, r * 0.1, 0, Math.PI * 2, 10),
    arc(cx + r * 0.35, cy - r * 0.25, r * 0.08, r * 0.1, 0, Math.PI * 2, 10),
    arc(cx, cy + r * 0.05, r * 0.55, r * 0.45, Math.PI * 0.15, Math.PI * 0.85, 14),
  ],
  sun: (_, cx, cy, r) => {
    const out = [arc(cx, cy, r * 0.6, r * 0.6)];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      out.push(line(cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3));
    }
    return out;
  },
  cloud: (_, cx, cy, r) => {
    const pts: P[] = [];
    const bumps = 4;
    for (let k = 0; k < bumps; k++) {
      const bx = cx - r + (k + 0.5) * ((2 * r) / bumps);
      pts.push(...arc(bx, cy - r * 0.05 - (k % 2) * r * 0.12, r / bumps, r * 0.38, Math.PI, Math.PI * 2, 8));
    }
    pts.push(...arc(cx, cy, r, r * 0.3, 0, Math.PI, 16));
    return [pts, arc(cx - r * 0.3, cy + r * 0.05, r * 0.05, r * 0.05, 0, Math.PI * 2, 6), arc(cx + r * 0.3, cy + r * 0.05, r * 0.05, r * 0.05, 0, Math.PI * 2, 6)];
  },
  flower: (_, cx, cy, r) => {
    const head = cy - r * 0.35;
    const out = [arc(cx, head, r * 0.18, r * 0.18, 0, Math.PI * 2, 14)];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      out.push(arc(cx + Math.cos(a) * r * 0.36, head + Math.sin(a) * r * 0.36, r * 0.17, r * 0.17, 0, Math.PI * 2, 12));
    }
    out.push(line(cx, head + r * 0.55, cx + r * 0.05, cy + r, 8));
    out.push(arc(cx + r * 0.22, cy + r * 0.55, r * 0.2, r * 0.09, 0, Math.PI * 2, 12));
    return out;
  },
  spiral: (_, cx, cy, r) => {
    const pts: P[] = [];
    for (let i = 0; i <= 70; i++) {
      const a = (i / 70) * Math.PI * 6;
      const rr = (r * i) / 70;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return [pts];
  },
  house: (_, cx, cy, r) => {
    const top = cy - r * 0.15;
    return [
      [...line(cx - r * 0.7, top, cx - r * 0.7, cy + r * 0.8), ...line(cx - r * 0.7, cy + r * 0.8, cx + r * 0.7, cy + r * 0.8), ...line(cx + r * 0.7, cy + r * 0.8, cx + r * 0.7, top)],
      [...line(cx - r * 0.85, top, cx, cy - r), ...line(cx, cy - r, cx + r * 0.85, top), ...line(cx + r * 0.85, top, cx - r * 0.85, top)],
      [...line(cx - r * 0.15, cy + r * 0.8, cx - r * 0.15, cy + r * 0.35, 3), ...line(cx - r * 0.15, cy + r * 0.35, cx + r * 0.15, cy + r * 0.35, 3), ...line(cx + r * 0.15, cy + r * 0.35, cx + r * 0.15, cy + r * 0.8, 3)],
    ];
  },
  cat: (_, cx, cy, r) => [
    arc(cx, cy, r * 0.8, r * 0.7),
    [...line(cx - r * 0.65, cy - r * 0.4, cx - r * 0.55, cy - r * 1.0, 4), ...line(cx - r * 0.55, cy - r * 1.0, cx - r * 0.2, cy - r * 0.68, 4)],
    [...line(cx + r * 0.65, cy - r * 0.4, cx + r * 0.55, cy - r * 1.0, 4), ...line(cx + r * 0.55, cy - r * 1.0, cx + r * 0.2, cy - r * 0.68, 4)],
    // Sleepy eyes, a little nose, whiskers.
    arc(cx - r * 0.3, cy - r * 0.12, r * 0.14, r * 0.08, 0, Math.PI, 8),
    arc(cx + r * 0.3, cy - r * 0.12, r * 0.14, r * 0.08, 0, Math.PI, 8),
    arc(cx, cy + r * 0.12, r * 0.07, r * 0.05, 0, Math.PI * 2, 8),
    line(cx - r * 0.25, cy + r * 0.2, cx - r * 0.95, cy + r * 0.1, 4),
    line(cx + r * 0.25, cy + r * 0.2, cx + r * 0.95, cy + r * 0.1, 4),
  ],
};

export const DOODLES = Object.keys(SHAPES);

export interface CpuSketch {
  strokes: Drawing;
  /** Seconds into the drawing time when it starts, and how long it takes. */
  startAt: number;
  duration: number;
}

/** A computer player's doodle: one simple main shape, sometimes with a squiggle, a little sun or some z's. */
export function cpuSketch(rng: Rng, skill: number): CpuSketch {
  const neat = 0.006 + (1 - skill) * 0.012;
  const main = pick(rng, DOODLES);
  const shape = SHAPES[main] as Shape;
  const cx = 0.45 + rng() * 0.1;
  const cy = 0.45 + rng() * 0.1;
  const strokes: Drawing = shape(rng, cx, cy, 0.24 + rng() * 0.06).map((s) => hand(rng, s, neat));
  if (rng() < 0.5) {
    const y = 0.86 + rng() * 0.06;
    const pts: P[] = [];
    for (let i = 0; i <= 30; i++) pts.push([0.1 + (0.8 * i) / 30, y + Math.sin((i / 30) * Math.PI * (4 + rng() * 2)) * 0.02]);
    strokes.push(hand(rng, pts, neat));
  }
  if (rng() < 0.4 && main !== 'sun') strokes.push(...(SHAPES.sun as Shape)(rng, 0.84, 0.15, 0.09).map((s) => hand(rng, s, neat * 0.5)));
  if (rng() < 0.35) {
    const z = (x: number, y: number, s: number): P[] => [...line(x, y, x + s, y, 2), ...line(x + s, y, x, y + s, 3), ...line(x, y + s, x + s, y + s, 2)];
    strokes.push(hand(rng, z(0.12, 0.2, 0.06), neat * 0.4), hand(rng, z(0.2, 0.1, 0.045), neat * 0.4));
  }
  return { strokes, startAt: 0.8 + rng() * 2, duration: 7 + (1 - skill) * 5 + rng() * 5 };
}
