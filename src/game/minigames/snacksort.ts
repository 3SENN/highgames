// Snack Sort: snacks slide along a conveyor past one station per player. Each player secretly owns one or two
// snack types (their phone says which) and grabs theirs as it passes their station. A snack nobody grabs in time
// is missed; grabbing someone else's snack loses it for the group and counts as a wrong grab.
import { type Rng, shuffle } from '../rng';

export const SNACK_TYPES = ['sweet', 'salty', 'sour', 'spicy'] as const;
export type SnackType = (typeof SNACK_TYPES)[number];

/** How each type looks on the belt (the phone tells its owner the same). */
export const SNACK_INFO: Record<SnackType, { name: string; looks: string; color: string }> = {
  sweet: { name: 'Sweet', looks: 'pink cupcakes', color: '#ff7eb6' },
  salty: { name: 'Salty', looks: 'popcorn tubs', color: '#f2b13c' },
  sour: { name: 'Sour', looks: 'green gummies', color: '#5fcf4f' },
  spicy: { name: 'Spicy', looks: 'red chilies', color: '#ef4a3c' },
};

export const SNACKSORT = {
  duration: 40, // seconds
  stationGap: 3.6, // world units between stations
  lead: 4.5, // belt before the first station
  tail: 2.8, // belt after the last station
  window: 0.8, // a snack is "at" a station within this distance of it
  speedFrom: 2.0, // belt speed (units a second) at the start…
  speedTo: 3.0, // …and at the end
  gapFrom: 1.5, // seconds between snacks at the start…
  gapTo: 0.85, // …and at the end
  cooldown: 0.35, // seconds between grabs
} as const;

export type SnackStatus = 'belt' | 'grabbed' | 'tossed' | 'gone';

export interface Snack {
  id: number;
  type: SnackType;
  owner: number;
  x: number;
  status: SnackStatus;
  /** Rolled past its owner's station without being grabbed. */
  missed: boolean;
}

export interface SnackSort {
  players: number;
  /** The snack types each seat owns. */
  owned: SnackType[][];
  snacks: Snack[];
  time: number;
  nextSpawn: number;
  nextId: number;
  bag: SnackType[];
  /** Correct grabs per seat. */
  correct: number[];
  /** Wrong grabs per seat (someone else's snack). */
  wrong: number[];
  missed: number;
  /** Snacks lost because the wrong player took them before their owner could. */
  stolen: number;
  readyAt: number[];
}

export type SnackEvent = { kind: 'spawn'; snack: Snack } | { kind: 'missed'; snack: Snack } | { kind: 'gone'; snack: Snack };

export type GrabResult = { kind: 'correct'; snack: Snack } | { kind: 'wrong'; snack: Snack } | { kind: 'empty' } | { kind: 'cooldown' };

/** Deals the four types out: one each for four players; with fewer, some players own two (or more, solo). */
export function dealTypes(rng: Rng, players: number): SnackType[][] {
  const n = Math.max(1, players);
  const owned: SnackType[][] = Array.from({ length: n }, () => []);
  shuffle(rng, SNACK_TYPES).forEach((type, i) => owned[i % n]?.push(type));
  return owned;
}

export function stationX(seat: number, players: number): number {
  return (seat - (Math.max(1, players) - 1) / 2) * SNACKSORT.stationGap;
}

export function beltStart(players: number): number {
  return stationX(0, players) - SNACKSORT.lead;
}

export function beltEnd(players: number): number {
  return stationX(Math.max(1, players) - 1, players) + SNACKSORT.tail;
}

/** Belt speed: speeds up a little as the night goes on. */
export function beltSpeed(time: number): number {
  const k = Math.min(1, Math.max(0, time / SNACKSORT.duration));
  return SNACKSORT.speedFrom + (SNACKSORT.speedTo - SNACKSORT.speedFrom) * k;
}

function spawnGap(time: number): number {
  const k = Math.min(1, Math.max(0, time / SNACKSORT.duration));
  return SNACKSORT.gapFrom + (SNACKSORT.gapTo - SNACKSORT.gapFrom) * k;
}

/** The last moment a snack can come out and still reach the last station before time is up. */
export function lastSpawn(players: number): number {
  const run = stationX(Math.max(1, players) - 1, players) + SNACKSORT.window - beltStart(players);
  return SNACKSORT.duration - run / SNACKSORT.speedTo - 0.4;
}

export function newSnackSort(rng: Rng, players: number): SnackSort {
  const n = Math.max(1, players);
  return {
    players: n,
    owned: dealTypes(rng, n),
    snacks: [],
    time: 0,
    nextSpawn: 0.4,
    nextId: 0,
    bag: [],
    correct: Array.from({ length: n }, () => 0),
    wrong: Array.from({ length: n }, () => 0),
    missed: 0,
    stolen: 0,
    readyAt: Array.from({ length: n }, () => 0),
  };
}

export function ownerOf(s: SnackSort, type: SnackType): number {
  const i = s.owned.findIndex((types) => types.includes(type));
  return i < 0 ? 0 : i;
}

/** Moves the belt on: new snacks at the start, missed ones past their owner's station, gone ones off the end. */
export function stepSnackSort(s: SnackSort, dt: number, rng: Rng): SnackEvent[] {
  const events: SnackEvent[] = [];
  s.time += dt;
  const dx = beltSpeed(s.time) * dt;
  for (const snack of s.snacks) {
    if (snack.status !== 'belt') continue;
    snack.x += dx;
    if (!snack.missed && snack.x > stationX(snack.owner, s.players) + SNACKSORT.window) {
      snack.missed = true;
      s.missed += 1;
      events.push({ kind: 'missed', snack });
    }
    if (snack.x > beltEnd(s.players)) {
      snack.status = 'gone';
      events.push({ kind: 'gone', snack });
    }
  }
  if (s.time >= s.nextSpawn && s.time <= lastSpawn(s.players)) {
    // A shuffled bag of two of each type, so every owner gets a fair share.
    if (s.bag.length === 0) s.bag = shuffle(rng, [...SNACK_TYPES, ...SNACK_TYPES]);
    const type = s.bag.pop() as SnackType;
    const snack: Snack = { id: s.nextId++, type, owner: ownerOf(s, type), x: beltStart(s.players), status: 'belt', missed: false };
    s.snacks.push(snack);
    events.push({ kind: 'spawn', snack });
    s.nextSpawn = s.time + spawnGap(s.time) * (0.85 + rng() * 0.3);
  }
  s.snacks = s.snacks.filter((x) => x.status === 'belt');
  return events;
}

/**
 * A player presses Grab. `lag` is how many seconds ago they really pressed (half their phone's round trip), so the
 * snack is judged where it was when they pressed.
 */
export function grab(s: SnackSort, seat: number, lag = 0): GrabResult {
  if (seat < 0 || seat >= s.players) return { kind: 'empty' };
  if (s.time < (s.readyAt[seat] ?? 0)) return { kind: 'cooldown' };
  s.readyAt[seat] = s.time + SNACKSORT.cooldown;
  const at = stationX(seat, s.players);
  const back = beltSpeed(s.time) * Math.max(0, Math.min(0.3, lag));
  let best: Snack | null = null;
  for (const snack of s.snacks) {
    if (snack.status !== 'belt') continue;
    const d = Math.abs(snack.x - back - at);
    if (d <= SNACKSORT.window && (!best || d < Math.abs(best.x - back - at))) best = snack;
  }
  if (!best) return { kind: 'empty' };
  if (best.owner === seat && !best.missed) {
    best.status = 'grabbed';
    s.correct[seat] = (s.correct[seat] ?? 0) + 1;
    return { kind: 'correct', snack: best };
  }
  best.status = 'tossed';
  s.wrong[seat] = (s.wrong[seat] ?? 0) + 1;
  if (!best.missed) s.stolen += 1;
  return { kind: 'wrong', snack: best };
}

export function totalCorrect(s: SnackSort): number {
  return s.correct.reduce((a, b) => a + b, 0);
}

export function totalWrong(s: SnackSort): number {
  return s.wrong.reduce((a, b) => a + b, 0);
}

/** Snacks whose fate is decided: grabbed by their owner, missed, or taken by someone else first. */
export function resolvedSnacks(s: SnackSort): number {
  return totalCorrect(s) + s.missed + s.stolen;
}

/** How well the group sorted: correct grabs over every snack plus every wrong grab. */
export function snackCoop(s: SnackSort): number {
  const total = resolvedSnacks(s) + totalWrong(s);
  return total === 0 ? 0 : Math.min(1, totalCorrect(s) / total);
}

// ------------------------------------------------------------------ computer players

/** What a computer player plans for each snack it has seen coming: grab at this x, or leave it (null). */
export type SnackCpu = Map<number, number | null>;

/**
 * A computer player watches the snacks coming to its station. It grabs its own a little late or early (and now
 * and then zones out), and once in a while grabs someone else's by mistake. `skill` 0 (sleepy) to 1 (sharp).
 */
export function cpuSnackSort(s: SnackSort, seat: number, skill: number, rng: Rng, plan: SnackCpu): GrabResult | null {
  const at = stationX(seat, s.players);
  const w = SNACKSORT.window;
  for (const snack of s.snacks) {
    if (snack.status !== 'belt' || snack.x < at - w - 0.6) continue;
    if (!plan.has(snack.id)) {
      if (snack.x > at + w) {
        plan.set(snack.id, null);
        continue;
      }
      const mine = snack.owner === seat && !snack.missed;
      if (mine) {
        const zonesOut = rng() < 0.02 + (1 - skill) * 0.3;
        const reach = 2 * w * (0.15 + rng() * (0.35 + (1 - skill) * 0.75));
        plan.set(snack.id, zonesOut ? null : at - w + reach);
      } else {
        const slips = rng() < 0.004 + (1 - skill) * 0.06;
        plan.set(snack.id, slips ? at - w * 0.3 + rng() * w * 0.6 : null);
      }
    }
    const pressAt = plan.get(snack.id);
    if (pressAt != null && snack.x >= pressAt) {
      plan.set(snack.id, null);
      return grab(s, seat, 0);
    }
  }
  return null;
}
