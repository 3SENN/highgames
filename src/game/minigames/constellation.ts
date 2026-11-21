// Ceiling Stars: lying on the bedroom floor, looking up at the glow-in-the-dark stars on the ceiling. A
// constellation lights up with dotted lines for a moment, then the lines fade (the stars stay). Trace it on your
// phone in the same order: the phone pad is the ceiling, 1:1. Closer to every star (in order) scores more, and
// a quick trace gets a little bonus. Three constellations, each one a star bigger.
import type { Rng } from '../rng.js';

export const STARS = {
  sizes: [4, 5, 6], // stars per constellation, one per round
  showFor: 3, // seconds the dotted lines stay up
  traceTime: [6, 6.5, 7], // seconds to trace, per round
  margin: 0.12, // stars stay this far from the pad's edges
  minGap: 0.2, // between the stars of a constellation
  sharp: 0.04, // passing this close to a star counts fully…
  reach: 0.22, // …and from this far it counts nothing
  speedBonus: 30, // most bonus points for an instant (and perfect) trace
} as const;

/** A point on the pad (and the ceiling): 0..1, y down. */
export interface Pt {
  x: number;
  y: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Distance from p to the segment a–b. */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/**
 * A constellation of `size` stars, in tracing order: a wandering path that never crosses itself, never passes
 * close to a star it doesn't connect, and keeps clear of the `avoid` stars (the ceiling's other stickers).
 */
export function makeConstellation(rng: Rng, size: number, avoid: readonly Pt[] = []): Pt[] {
  const lo = STARS.margin;
  const hi = 1 - STARS.margin;
  for (let attempt = 0; attempt < 300; attempt++) {
    const first = { x: 0.22 + rng() * 0.56, y: 0.22 + rng() * 0.56 };
    if (avoid.some((o) => dist(o, first) < 0.08)) continue;
    const pts: Pt[] = [first];
    let heading = rng() * Math.PI * 2;
    while (pts.length < size) {
      const p = pts[pts.length - 1] as Pt;
      let next: Pt | null = null;
      for (let tries = 0; tries < 40 && !next; tries++) {
        const h = heading + (rng() - 0.5) * 3.4;
        const step = 0.22 + rng() * 0.17;
        const q = { x: p.x + Math.cos(h) * step, y: p.y + Math.sin(h) * step };
        if (q.x < lo || q.x > hi || q.y < lo || q.y > hi) continue;
        if (pts.some((o) => dist(o, q) < STARS.minGap) || avoid.some((o) => dist(o, q) < 0.08)) continue;
        // The new line must not brush past an earlier star, and no earlier line may brush past the new star.
        if (pts.slice(0, -1).some((o) => segDist(o, p, q) < 0.09)) continue;
        let clear = true;
        for (let i = 0; i + 1 < pts.length && clear; i++) {
          const a = pts[i] as Pt;
          const b = pts[i + 1] as Pt;
          if (segDist(q, a, b) < 0.09 || (i + 2 < pts.length && crosses(a, b, p, q))) clear = false;
        }
        if (!clear) continue;
        next = q;
        heading = h;
      }
      if (!next) break;
      pts.push(next);
    }
    if (pts.length === size) return pts;
  }
  // Practically never: a plain zigzag.
  return Array.from({ length: size }, (_, i) => ({ x: lo + ((hi - lo) * i) / Math.max(1, size - 1), y: i % 2 ? 0.35 : 0.65 }));
}

/** The ceiling's other glow stars: scattered, never too close to each other or to `avoid`. */
export function decorStars(rng: Rng, count: number, avoid: readonly Pt[] = []): Pt[] {
  const out: Pt[] = [];
  for (let tries = 0; tries < count * 40 && out.length < count; tries++) {
    const p = { x: 0.04 + rng() * 0.92, y: 0.04 + rng() * 0.92 };
    if (avoid.some((o) => dist(o, p) < 0.1) || out.some((o) => dist(o, p) < 0.11)) continue;
    out.push(p);
  }
  return out;
}

/** Strokes as the phone sends them: flat x, y pairs, one array per stroke. */
export type Strokes = readonly (readonly number[])[];

/** Points along the strokes, close together, and the strokes' total length (lifts don't count). */
function resample(strokes: Strokes): { path: Pt[]; length: number } {
  let length = 0;
  for (const s of strokes) for (let i = 2; i + 1 < s.length; i += 2) length += Math.hypot((s[i] as number) - (s[i - 2] as number), (s[i + 1] as number) - (s[i - 1] as number));
  const step = Math.max(0.008, length / 3000);
  const path: Pt[] = [];
  for (const s of strokes) {
    if (s.length < 2) continue;
    path.push({ x: s[0] as number, y: s[1] as number });
    for (let i = 2; i + 1 < s.length; i += 2) {
      const a = { x: s[i - 2] as number, y: s[i - 1] as number };
      const b = { x: s[i] as number, y: s[i + 1] as number };
      const n = Math.max(1, Math.ceil(dist(a, b) / step));
      for (let k = 1; k <= n; k++) path.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  return { path, length };
}

/** How much passing `d` from a star counts: 1 close by, 0 from STARS.reach. */
export function closeness(d: number): number {
  return clamp(1 - (d - STARS.sharp) / (STARS.reach - STARS.sharp), 0, 1);
}

export interface TraceScore {
  /** 0 … 1: how close the trace passes each star, in order, times the ink factor. */
  accuracy: number;
  /** Per star: how close the trace came, as closeness (0 … 1). */
  hits: number[];
  /** The trace's length over the constellation's: scribbling everywhere doesn't pay. */
  ratio: number;
}

/**
 * Scores a trace: for each star in order, the closest the trace comes to it after it reached the star before
 * (the best such matching), so tracing backwards or out of order scores badly. Far too much or too little ink
 * scales it down.
 */
export function scoreTrace(strokes: Strokes, stars: readonly Pt[]): TraceScore {
  const { path, length } = resample(strokes);
  const k = stars.length;
  if (!path.length || !k) return { accuracy: 0, hits: stars.map(() => 0), ratio: 0 };
  const n = path.length;
  // best[s][i]: the most closeness for stars 0..s with star s matched at path point i.
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  for (let s = 0; s < k; s++) {
    const star = stars[s] as Pt;
    const row = new Float64Array(n);
    const back = new Int32Array(n);
    let runMax = -1;
    let runAt = 0;
    for (let i = 0; i < n; i++) {
      if (s > 0) {
        const prev = (best[s - 1] as Float64Array)[i] as number;
        if (prev > runMax) {
          runMax = prev;
          runAt = i;
        }
      }
      row[i] = closeness(dist(star, path[i] as Pt)) + (s > 0 ? runMax : 0);
      back[i] = runAt;
    }
    best.push(row);
    from.push(back);
  }
  const last = best[k - 1] as Float64Array;
  let at = 0;
  for (let i = 1; i < n; i++) if ((last[i] as number) > (last[at] as number)) at = i;
  const hits: number[] = new Array<number>(k).fill(0);
  for (let s = k - 1; s >= 0; s--) {
    hits[s] = closeness(dist(stars[s] as Pt, path[at] as Pt));
    at = (from[s] as Int32Array)[at] as number;
  }
  let ideal = 0;
  for (let s = 1; s < k; s++) ideal += dist(stars[s - 1] as Pt, stars[s] as Pt);
  const ratio = length / Math.max(0.01, ideal);
  const inkFactor = ratio < 0.7 ? ratio / 0.7 : ratio > 1.5 ? Math.max(0, 1 - (ratio - 1.5) / 2) : 1;
  const accuracy = (hits.reduce((a, b) => a + b, 0) / k) * inkFactor;
  return { accuracy, hits, ratio };
}

/** Whether a trace looks complete: every star reached in order, and the last point ends on the last star. */
export function looksFinished(strokes: Strokes, stars: readonly Pt[]): boolean {
  const lastStroke = strokes[strokes.length - 1];
  const end = stars[stars.length - 1];
  if (!lastStroke || lastStroke.length < 2 || !end) return false;
  const tip = { x: lastStroke[lastStroke.length - 2] as number, y: lastStroke[lastStroke.length - 1] as number };
  if (dist(tip, end) > 0.12) return false;
  return scoreTrace(strokes, stars).hits.every((h) => h > 0);
}

/** Points for one round: accuracy, plus a bonus for finishing quickly (scaled by accuracy, so scribbles get none). */
export function roundPoints(accuracy: number, finishedAfter: number, limit: number): number {
  const quick = clamp(1 - finishedAfter / limit, 0, 1);
  return Math.round(accuracy * 100 + STARS.speedBonus * accuracy * quick);
}

// ------------------------------------------------------------------ computer players

function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng() * 0.999999)) * Math.cos(2 * Math.PI * rng());
}

export interface CpuTrace {
  /** One stroke as flat x, y pairs… */
  pts: number[];
  /** …and when each point is drawn, in seconds after tracing starts. */
  times: number[];
}

/** skill 0 (sleepy: wobbly, slow, sometimes mixes up the order) … 1 (sharp: steady and quick). */
export function cpuTrace(rng: Rng, stars: readonly Pt[], skill: number): CpuTrace {
  const order = stars.map((_, i) => i);
  if (stars.length >= 4 && rng() < (1 - skill) * 0.3) {
    const k = 1 + Math.floor(rng() * (stars.length - 2));
    [order[k], order[k + 1]] = [order[k + 1] as number, order[k] as number];
  }
  const sigma = 0.042 + (1 - skill) * 0.09;
  const targets = order.map((i) => {
    const s = stars[i] as Pt;
    return { x: clamp(s.x + gauss(rng) * sigma, 0, 1), y: clamp(s.y + gauss(rng) * sigma, 0, 1) };
  });
  const pts: number[] = [];
  const times: number[] = [];
  let t = 0.45 + (1 - skill) * 1.3 + rng() * 0.4;
  const put = (p: Pt, at: number) => {
    pts.push(Math.round(clamp(p.x, 0, 1) * 1000) / 1000, Math.round(clamp(p.y, 0, 1) * 1000) / 1000);
    times.push(at);
  };
  put(targets[0] as Pt, t);
  for (let s = 1; s < targets.length; s++) {
    const a = targets[s - 1] as Pt;
    const b = targets[s] as Pt;
    const d = dist(a, b);
    const segT = 0.25 + (1 - skill) * 0.35 + rng() * 0.15;
    const steps = Math.max(4, Math.ceil(d / 0.015));
    const bow = (rng() - 0.5) * (1 - skill) * 0.09;
    const nx = d > 0 ? -(b.y - a.y) / d : 0;
    const ny = d > 0 ? (b.x - a.x) / d : 0;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const off = bow * Math.sin(Math.PI * u);
      put({ x: a.x + (b.x - a.x) * u + nx * off + gauss(rng) * 0.002, y: a.y + (b.y - a.y) * u + ny * off + gauss(rng) * 0.002 }, t + segT * u);
    }
    t += segT;
  }
  return { pts, times };
}
