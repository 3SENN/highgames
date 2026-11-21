// Hide and Sleep: lights out in a dark house. Three hiders each pick one of six hiding spots in secret, then the
// seeker gets a torch. Pointing it at a spot and pressing searches that spot (the torch stays on it for a moment);
// anyone hiding there is caught. Each hider may sneak once to another spot, but only while the torch is not on
// their own spot, and sneaking rustles where they were. The hiders win if anyone is still hidden at the end.
//
// Everything is in "torch space": x, y from -1 to 1 like the phone's aim pointer (x right, y up). The spots sit
// in two rows of three: the back of the room above, the front below.
import type { Rng } from '../rng.js';

export interface Spot {
  label: string;
  /** Short name for the TV ("the wardrobe"). */
  name: string;
  x: number;
  y: number;
}

export const SPOTS: readonly Spot[] = [
  { label: 'Under the bed', name: 'under the bed', x: -0.6, y: -0.42 },
  { label: 'In the wardrobe', name: 'in the wardrobe', x: -0.6, y: 0.42 },
  { label: 'Behind the curtain', name: 'behind the curtain', x: 0, y: 0.42 },
  { label: 'In the laundry basket', name: 'in the laundry basket', x: 0.6, y: 0.42 },
  { label: 'Under the blankets', name: 'under the blankets', x: 0, y: -0.42 },
  { label: 'Behind the couch', name: 'behind the couch', x: 0.6, y: -0.42 },
];

export const HIDE = {
  hideTime: 7, // seconds to pick a spot
  seekTime: 25,
  onR: 0.26, // the torch is on a spot within this
  reach: 0.34, // a press searches the nearest spot within this
  search: 2.5, // the torch stays on a spot this long while it is searched (rummaging)
  recover: 0.6, // after a search, before the next press counts
  follow: 16, // how quickly the torch follows the pointer
  boundX: 1,
  boundY: 0.85,
  maxLag: 0.15, // most phone delay forgiven when a hider sneaks
} as const;

export interface Hider {
  seat: number;
  spot: number;
  /** Chose a spot themselves (otherwise one is picked for them). */
  picked: boolean;
  snuck: boolean;
  /** The spot they snuck away from. */
  from: number | null;
  caught: boolean;
  caughtAt: number | null;
}

export interface House {
  seeker: number;
  hiders: Hider[];
  phase: 'hide' | 'seek';
  /** Seconds into the seek. */
  time: number;
  /** Where the torch shines, and where the pointer is. */
  beam: { x: number; y: number };
  aim: { x: number; y: number };
  search: { spot: number; until: number } | null;
  /** Earliest time the next press counts. */
  readyAt: number;
  /** Per spot: when the torch came onto it (null while it is off). */
  onSince: (number | null)[];
  /** Per spot: when it was last searched (-1: never). */
  checked: number[];
  checks: number;
  /** Everything the seeker could see or hear, in order (for computer seekers and the TV). */
  log: { kind: 'rustle' | 'check'; spot: number; at: number; found: number }[];
}

export type SneakResult = 'ok' | 'same' | 'used' | 'lit' | 'caught' | 'phase';

export function newHouse(seeker: number, hiders: readonly number[], rng: Rng): House {
  return {
    seeker,
    hiders: hiders.map((seat) => ({ seat, spot: Math.floor(rng() * SPOTS.length), picked: false, snuck: false, from: null, caught: false, caughtAt: null })),
    phase: 'hide',
    time: 0,
    beam: { x: 0, y: 0 },
    aim: { x: 0, y: 0 },
    search: null,
    readyAt: 0,
    onSince: SPOTS.map(() => null),
    checked: SPOTS.map(() => -1),
    checks: 0,
    log: [],
  };
}

export const hiderOf = (h: House, seat: number): Hider | undefined => h.hiders.find((x) => x.seat === seat);
export const hiddenCount = (h: House): number => h.hiders.filter((x) => !x.caught).length;

export function isOver(h: House): boolean {
  return h.phase === 'seek' && (h.time >= HIDE.seekTime || hiddenCount(h) === 0);
}

/** The nearest spot within r of (x, y), or -1. */
export function spotAt(x: number, y: number, r: number): number {
  let best = -1;
  let bestD = r;
  SPOTS.forEach((s, i) => {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The spot the torch is on, or -1. */
export const litSpot = (h: House): number => spotAt(h.beam.x, h.beam.y, HIDE.onR);

/** Picking (or changing) a spot while the seeker counts. */
export function pickSpot(h: House, seat: number, spot: number): boolean {
  const me = hiderOf(h, seat);
  if (!me || h.phase !== 'hide' || !SPOTS[spot]) return false;
  me.spot = spot;
  me.picked = true;
  return true;
}

export function startSeek(h: House): void {
  h.phase = 'seek';
  h.time = 0;
  h.readyAt = 0;
}

/** Where the seeker points (torch space; clamped to the room). */
export function pointTo(h: House, x: number, y: number): void {
  h.aim.x = Math.max(-HIDE.boundX, Math.min(HIDE.boundX, x));
  h.aim.y = Math.max(-HIDE.boundY, Math.min(HIDE.boundY, y));
}

/**
 * A hider's one sneak to another spot. Not while the torch is on their spot, unless it only got there within
 * `lag` seconds (the press was on its way from the phone before the torch arrived).
 */
export function sneak(h: House, seat: number, to: number, lag = 0): SneakResult {
  const me = hiderOf(h, seat);
  if (!me || !SPOTS[to]) return 'phase';
  if (h.phase !== 'seek' || isOver(h)) return 'phase';
  if (me.caught) return 'caught';
  if (to === me.spot) return 'same';
  if (me.snuck) return 'used';
  const since = h.onSince[me.spot];
  const grace = Math.min(HIDE.maxLag, Math.max(0, lag));
  if (since != null && h.time - since > grace) return 'lit';
  me.from = me.spot;
  me.spot = to;
  me.snuck = true;
  h.log.push({ kind: 'rustle', spot: me.from, at: h.time, found: 0 });
  return 'ok';
}

/**
 * Where a rustle is heard: the column (torch x) of the spot it came from. The TV plays it from that side, so
 * the seeker learns left, middle or right, but not front or back.
 */
export const rustleColumn = (spot: number): number => SPOTS[spot]?.x ?? 0;

/** Whether a press would count right now. */
export const canSearch = (h: House): boolean => h.phase === 'seek' && !isOver(h) && h.search === null && h.time >= h.readyAt;

/** The seeker presses: searches the spot under the torch. Returns it, -1 if the torch is on no spot, null if not ready. */
export function press(h: House): number | null {
  if (!canSearch(h)) return null;
  const spot = spotAt(h.beam.x, h.beam.y, HIDE.reach);
  if (spot < 0) return -1;
  h.search = { spot, until: h.time + HIDE.search };
  return spot;
}

export interface HouseEvents {
  /** A search finished: the spot and who was found there (seats). */
  searched: { spot: number; found: number[] } | null;
}

export function stepHouse(h: House, dt: number): HouseEvents {
  const ev: HouseEvents = { searched: null };
  if (h.phase !== 'seek' || isOver(h)) return ev;
  h.time += dt;
  // The torch follows the pointer, or settles on the spot being searched.
  const target = h.search ? (SPOTS[h.search.spot] as Spot) : h.aim;
  const k = Math.min(1, HIDE.follow * dt);
  h.beam.x += (target.x - h.beam.x) * k;
  h.beam.y += (target.y - h.beam.y) * k;
  const lit = litSpot(h);
  h.onSince = h.onSince.map((since, i) => (i === lit ? (since ?? h.time) : null));
  if (h.search && h.time >= h.search.until) {
    const spot = h.search.spot;
    const found: number[] = [];
    for (const x of h.hiders) {
      if (x.caught || x.spot !== spot) continue;
      x.caught = true;
      x.caughtAt = h.time;
      found.push(x.seat);
    }
    h.search = null;
    h.readyAt = h.time + HIDE.recover;
    h.checked[spot] = h.time;
    h.checks += 1;
    h.log.push({ kind: 'check', spot, at: h.time, found: found.length });
    ev.searched = { spot, found };
  }
  return ev;
}

/** The winning side scores 1, the other 0: the hiders win if anyone is still hidden at the end. */
export function hideScores(h: House, seats: number): number[] {
  const hidersWin = hiddenCount(h) > 0;
  return Array.from({ length: seats }, (_, seat) => {
    if (seat === h.seeker) return hidersWin ? 0 : 1;
    if (hiderOf(h, seat)) return hidersWin ? 1 : 0;
    return 0;
  });
}

// ------------------------------------------------------------------ computer players

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export interface SeekBrain {
  skill: number;
  /** Expected number of hiders in each spot. */
  belief: number[];
  /** How much of the house log has been taken in. */
  read: number;
  target: number;
  /** The computer's own pointer. */
  x: number;
  y: number;
  /** When the torch got onto the target (game time), for a human-like pause before pressing. */
  arrived: number | null;
  pause: number;
}

export function newSeekBrain(h: House, skill: number): SeekBrain {
  const n = h.hiders.length;
  return { skill, belief: SPOTS.map(() => n / SPOTS.length), read: 0, target: -1, x: 0, y: 0, arrived: null, pause: 0 };
}

function normalise(p: number[], total: number, skip = -1): void {
  const sum = p.reduce((a, v, i) => a + (i === skip ? 0 : v), 0);
  for (let i = 0; i < p.length; i++) {
    if (i === skip) continue;
    p[i] = sum > 1e-9 ? ((p[i] as number) * total) / sum : total / (p.length - (skip >= 0 ? 1 : 0));
  }
}

/** Takes in new rustles and searches. */
function listen(h: House, b: SeekBrain, rng: Rng): void {
  while (b.read < h.log.length) {
    const e = h.log[b.read++];
    if (!e) break;
    const total = h.hiders.length - h.hiders.filter((x) => x.caught && (x.caughtAt ?? 0) <= e.at).length;
    if (e.kind === 'check') {
      b.belief[e.spot] = 0;
      normalise(b.belief, total, e.spot);
    } else {
      // A rustle on the left, in the middle or on the right: someone left one of that column's two spots.
      // Sleepy seekers don't always notice.
      if (rng() > 0.15 + b.skill * 0.6) continue;
      // ... and may mishear which side it came from.
      const heard = rustleColumn(e.spot);
      const col = rng() < (1 - b.skill) * 0.4 ? (heard === 0 ? (rng() < 0.5 ? -0.6 : 0.6) : 0) : heard;
      const column = SPOTS.map((s, i) => (s.x === col ? i : -1)).filter((i) => i >= 0);
      const there = column.reduce((a, i) => a + (b.belief[i] ?? 0), 0);
      for (const i of column) b.belief[i] = there > 1 ? (b.belief[i] ?? 0) * (1 - 1 / there) : 0;
      // ... and went somewhere else: a sharp seeker guesses somewhere already searched.
      const w = SPOTS.map((s, i) => ((h.checked[i] ?? -1) >= 0 ? 1 + b.skill * 0.5 : 1) * (s.x === col ? 0.5 : 1));
      const ws = w.reduce((a, v) => a + v, 0);
      w.forEach((v, i) => (b.belief[i] = (b.belief[i] ?? 0) + v / ws));
      normalise(b.belief, total);
    }
  }
}

function choose(h: House, b: SeekBrain, rng: Rng): number {
  let best = 0;
  let bestScore = -Infinity;
  SPOTS.forEach((s, i) => {
    const score = (b.belief[i] ?? 0) * (1 + (1 - b.skill) * rng() * 1.6) - dist(h.beam, s) * 0.12 + rng() * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** A computer seeker's pointer and button for this step (call it every step during the seek). */
export function cpuSeek(h: House, b: SeekBrain, rng: Rng, dt: number): { x: number; y: number; fire: boolean } {
  listen(h, b, rng);
  if (h.search) {
    b.target = -1;
    b.arrived = null;
    return { x: b.x, y: b.y, fire: false };
  }
  if (b.target < 0 || (b.belief[b.target] ?? 0) < 1e-6) {
    b.target = choose(h, b, rng);
    b.arrived = null;
    b.pause = 0.2 + rng() * 0.3 + (1 - b.skill) * rng() * 0.6;
  }
  const spot = SPOTS[b.target] as Spot;
  // Move the pointer toward the spot at a hand's pace (sleepy hands are slower and wobblier).
  const speed = 1.3 + b.skill * 2.2;
  const dx = spot.x - b.x;
  const dy = spot.y - b.y;
  const d = Math.hypot(dx, dy);
  const step = Math.min(d, speed * dt);
  if (d > 1e-6) {
    b.x += (dx / d) * step;
    b.y += (dy / d) * step;
  }
  let fire = false;
  if (dist(h.beam, spot) < 0.1) {
    b.arrived ??= h.time;
    if (h.time - b.arrived >= b.pause && canSearch(h)) {
      fire = true;
      b.target = -1;
    }
  }
  return { x: b.x, y: b.y, fire };
}

export interface HideBrain {
  skill: number;
  next: number;
  /** Happy to squeeze in with a teammate (decided once, sleepy hiders more often). */
  cosy: boolean | null;
}

export function newHideBrain(skill: number): HideBrain {
  return { skill, next: 0, cosy: null };
}

/** A computer hider's spot during the hide phase: anywhere, and sharp ones don't share. */
export function cpuPick(h: House, seat: number, b: HideBrain, rng: Rng): number {
  const taken = new Set(h.hiders.filter((x) => x.seat !== seat && x.picked).map((x) => x.spot));
  const free = SPOTS.map((_, i) => i).filter((i) => !taken.has(i));
  const pool = rng() < 0.5 + b.skill * 0.5 && free.length ? free : SPOTS.map((_, i) => i);
  return pool[Math.floor(rng() * pool.length)] ?? 0;
}

/** Whether a computer hider sneaks now, and where to. Null: stay put. */
export function cpuSneak(h: House, seat: number, b: HideBrain, rng: Rng): number | null {
  const me = hiderOf(h, seat);
  if (!me || me.caught || me.snuck || h.phase !== 'seek' || h.time < b.next) return null;
  b.next = h.time + 0.12 + (1 - b.skill) * 0.45 + rng() * 0.1;
  const mine = SPOTS[me.spot] as Spot;
  const lit = litSpot(h);
  if (lit === me.spot) return null;
  const busy = h.search?.spot ?? -1;
  // Spots already searched (and not being searched now) are where to go.
  const done = SPOTS.map((_, i) => i !== me.spot && i !== busy && (h.checked[i] ?? -1) >= 0);
  const doneCount = done.filter(Boolean).length;
  const mineDone = (h.checked[me.spot] ?? -1) >= 0;
  // Danger: the seeker is searching next door, or the torch is right by us.
  const danger = h.search ? busy !== me.spot && dist(SPOTS[busy] as Spot, mine) < 0.75 : (h.checks > 0 || h.time > 1) && dist(h.beam, mine) < 0.36;
  let worry = 0;
  if (danger && !mineDone) worry = doneCount ? 0.3 + b.skill * 0.6 : 0.1 + b.skill * 0.3;
  // The seeker is busy elsewhere and there's a choice of searched spots: a good moment to slip away.
  else if (h.search && !mineDone && doneCount >= 2) worry = 0.04 + b.skill * 0.25;
  // Nearly everywhere else has been searched: it's our turn next.
  const unsearched = h.checked.filter((t, i) => t < 0 && i !== me.spot).length;
  if (unsearched <= 1 && !mineDone) worry = Math.max(worry, 0.2 + b.skill * 0.5);
  if (rng() >= worry) return null;
  // Searched spots are safest (best of all in the same column, where the rustle gives nothing away), but with
  // only one or two of them a sharp hider mixes in quiet corners so the seeker can't be sure. Nobody piles in
  // with a teammate unless they're the cosy sort.
  b.cosy ??= rng() > 0.3 + b.skill;
  const onlyDone = doneCount > 0 && rng() < (doneCount >= 2 ? 0.4 + b.skill * 0.5 : 0.6 - b.skill * 0.3);
  const options = SPOTS.map((s, i) => {
    if (i === me.spot || i === busy || i === lit || dist(s, h.beam) < 0.5) return 0;
    if (onlyDone && !done[i]) return 0;
    const mate = h.hiders.some((x) => x !== me && !x.caught && x.spot === i);
    const column = s.x === mine.x ? 1 + b.skill : 1;
    return (done[i] ? 2 * column : 1) * (mate ? (b.cosy ? 0.5 : 0) : 1);
  });
  const total = options.reduce((a, v) => a + v, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (let i = 0; i < options.length; i++) {
    r -= options[i] as number;
    if (r <= 0 && (options[i] as number) > 0) return i;
  }
  return null;
}
