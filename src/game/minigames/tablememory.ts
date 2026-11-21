// Coffee Table Memory: the phones lie side by side in a row and together they're one big game of pairs. Each
// phone shows a few face-down coasters with a snack under each. On your go you reach over and turn any two (on any
// phone): a pair is yours and you go again; a miss turns back over after a second. Most pairs wins.
//
// Only phones that are really on the table hold coasters (a computer player has no phone to put down), so the
// board depends on how many there are: 2×2 coasters each with four phones, 2×3 with two or three, 3×4 with one.
import { type Rng, shuffle } from '../rng';

export const MEMORY = {
  duration: 45, // seconds of play; a go that's being judged still finishes
  flip: 0.22, // seconds a coaster takes to turn over
  missShow: 1.0, // a miss stays face up this long once it's turned
  matchShow: 0.7, // a pair shows this long before it's taken
  turnTime: 10, // seconds a person has for a go before it passes on
} as const;

/** Width over height of a phone's playfield: y fractions times 1/ASPECT are in width units. */
const ASPECT = 9 / 16;

/** The snacks under the coasters: an emoji, a word under it, and a tint so pairs read at a glance. */
export const SNACKS = [
  { emoji: '🍕', name: 'pizza', color: '#ffd59a' },
  { emoji: '🍩', name: 'doughnut', color: '#ffc0d9' },
  { emoji: '🍪', name: 'cookie', color: '#ead0ac' },
  { emoji: '🥨', name: 'pretzel', color: '#f1c48e' },
  { emoji: '🍿', name: 'popcorn', color: '#fff0a8' },
  { emoji: '🍫', name: 'chocolate', color: '#d9b49c' },
  { emoji: '🧁', name: 'cupcake', color: '#e2d1ff' },
  { emoji: '🍉', name: 'melon', color: '#c4efb5' },
  { emoji: '🍦', name: 'ice cream', color: '#cdeeff' },
  { emoji: '🌮', name: 'taco', color: '#ffe6b0' },
  { emoji: '🍓', name: 'strawberry', color: '#ffcaca' },
  { emoji: '🍟', name: 'chips', color: '#ffdf8f' },
] as const;

// ------------------------------------------------------------------ the coasters on a phone

export interface Grid {
  cols: number;
  rows: number;
  /** A coaster's width as a fraction of the playfield's width (they're square). */
  size: number;
  /** Between coaster centres: across (fraction of the width) and down (fraction of the height). */
  pitchX: number;
  pitchY: number;
}

/** How the coasters sit on each phone, for this many phones on the table. */
export function gridFor(phones: number): Grid {
  if (phones >= 4) return { cols: 2, rows: 2, size: 0.42, pitchX: 0.47, pitchY: 0.27 };
  if (phones >= 2) return { cols: 2, rows: 3, size: 0.36, pitchX: 0.44, pitchY: 0.225 };
  return { cols: 3, rows: 4, size: 0.27, pitchX: 0.3, pitchY: 0.168 };
}

/** The middle of the coasters' block on the playfield (fraction of the height). */
const MID_Y = 0.525;

/** Where a coaster sits on its phone: centre and size, x and w as fractions of the width, y and h of the height. */
export function cardRect(grid: Grid, slot: number): { x: number; y: number; w: number; h: number } {
  const col = slot % grid.cols;
  const row = Math.floor(slot / grid.cols);
  return {
    x: 0.5 + (col - (grid.cols - 1) / 2) * grid.pitchX,
    y: MID_Y + (row - (grid.rows - 1) / 2) * grid.pitchY,
    w: grid.size,
    h: grid.size * ASPECT,
  };
}

/** The coaster under a touch at (x, y) on a phone, or null. A touch just off the edge still counts. */
export function cardAt(grid: Grid, x: number, y: number): number | null {
  for (let slot = 0; slot < grid.cols * grid.rows; slot++) {
    const r = cardRect(grid, slot);
    if (Math.abs(x - r.x) <= r.w / 2 + 0.03 && Math.abs(y - r.y) <= r.h / 2 + 0.02) return slot;
  }
  return null;
}

// ------------------------------------------------------------------ the board

export type CardState = 'down' | 'up' | 'taken';

export interface Card {
  /** Which snack (an index into SNACKS). */
  face: number;
  state: CardState;
  /** Who took it (player position), once it's part of a pair. */
  owner: number | null;
  /** When it last started to turn over (game time), for the flip; -1 if it never has. */
  flipAt: number;
}

export interface Board {
  phones: number;
  grid: Grid;
  perPhone: number;
  /** Phone by phone: phone k holds cards k * perPhone … (k + 1) * perPhone - 1. */
  cards: Card[];
}

export function newBoard(phones: number, rng: Rng): Board {
  const p = Math.max(1, Math.min(4, Math.floor(phones)));
  const grid = gridFor(p);
  const perPhone = grid.cols * grid.rows;
  const pairs = (p * perPhone) / 2;
  const snacks = shuffle(
    rng,
    SNACKS.map((_, i) => i),
  ).slice(0, pairs);
  const faces = shuffle(rng, [...snacks, ...snacks]);
  return { phones: p, grid, perPhone, cards: faces.map((face) => ({ face, state: 'down', owner: null, flipAt: -1 })) };
}

/** A card's phone and its place on that phone. */
export function cardPlace(board: Board, card: number): { phone: number; slot: number } {
  return { phone: Math.floor(card / board.perPhone), slot: card % board.perPhone };
}

export function pairsLeft(board: Board): number {
  return board.cards.filter((c) => c.state !== 'taken').length / 2;
}

// ------------------------------------------------------------------ the game

export interface MemoryGame {
  board: Board;
  players: number;
  /** Whose go it is (player position). */
  turn: number;
  /** When this go started (game time). */
  turnStart: number;
  /** The cards turned this go (0, 1 or 2). */
  picks: number[];
  /** With two picks: whether they match, and when they're taken or turned back. */
  match: boolean | null;
  resolveAt: number | null;
  /** Pairs per player. */
  pairs: number[];
  /** Misses per player (for the results). */
  misses: number[];
  over: boolean;
}

export function newMemory(players: number, phones: number, first: number, rng: Rng): MemoryGame {
  const n = Math.max(1, players);
  return {
    board: newBoard(phones, rng),
    players: n,
    turn: ((first % n) + n) % n,
    turnStart: 0,
    picks: [],
    match: null,
    resolveAt: null,
    pairs: new Array<number>(n).fill(0),
    misses: new Array<number>(n).fill(0),
    over: false,
  };
}

export type PickResult =
  | { ok: false; why: 'over' | 'busy' | 'gone' }
  /** `match` is set on the second pick: whether the two are a pair. */
  | { ok: true; second: boolean; match: boolean | null };

/** Turns card `card` face up for whoever's go it is. */
export function pick(g: MemoryGame, card: number, t: number): PickResult {
  if (g.over) return { ok: false, why: 'over' };
  if (g.resolveAt !== null || g.picks.length >= 2) return { ok: false, why: 'busy' };
  const c = g.board.cards[card];
  if (!c || c.state !== 'down') return { ok: false, why: 'gone' };
  c.state = 'up';
  c.flipAt = t;
  g.picks.push(card);
  if (g.picks.length < 2) return { ok: true, second: false, match: null };
  const [a, b] = g.picks.map((i) => g.board.cards[i] as Card);
  g.match = a?.face === b?.face;
  g.resolveAt = t + MEMORY.flip + (g.match ? MEMORY.matchShow : MEMORY.missShow);
  return { ok: true, second: true, match: g.match };
}

export type MemoryEvent =
  /** The two picks were a pair: they're `player`'s now. */
  | { t: 'pair'; player: number; cards: [number, number]; face: number }
  /** They weren't: turned back over. */
  | { t: 'miss'; player: number; cards: [number, number] }
  /** A new go: `again` when the same player goes again after a pair, `slow` when the last one ran out of time. */
  | { t: 'go'; player: number; again: boolean; slow: boolean }
  | { t: 'over'; timeUp: boolean };

function flipBack(g: MemoryGame, t: number): void {
  for (const i of g.picks) {
    const c = g.board.cards[i];
    if (c && c.state === 'up') {
      c.state = 'down';
      c.flipAt = t;
    }
  }
  g.picks = [];
  g.match = null;
  g.resolveAt = null;
}

/**
 * Moves the game on to time t: takes or turns back the two picks once they've shown, starts the next go, passes a
 * go that took too long (`patient`: a person's go, which waits up to MEMORY.turnTime), and ends the game when the
 * board is clear or time is up (a go being judged still finishes).
 */
export function stepMemory(g: MemoryGame, t: number, patient = true): MemoryEvent[] {
  if (g.over) return [];
  const events: MemoryEvent[] = [];
  const timeUp = t >= MEMORY.duration;
  if (g.resolveAt !== null && t >= g.resolveAt) {
    const [a, b] = g.picks as [number, number];
    const player = g.turn;
    if (g.match) {
      for (const i of g.picks) {
        const c = g.board.cards[i];
        if (c) {
          c.state = 'taken';
          c.owner = player;
        }
      }
      g.pairs[player] = (g.pairs[player] ?? 0) + 1;
      events.push({ t: 'pair', player, cards: [a, b], face: g.board.cards[a]?.face ?? 0 });
      g.picks = [];
      g.match = null;
      g.resolveAt = null;
      if (pairsLeft(g.board) === 0) {
        g.over = true;
        events.push({ t: 'over', timeUp: false });
        return events;
      }
      if (!timeUp) {
        g.turnStart = t;
        events.push({ t: 'go', player, again: true, slow: false });
      }
    } else {
      g.misses[player] = (g.misses[player] ?? 0) + 1;
      flipBack(g, t);
      events.push({ t: 'miss', player, cards: [a, b] });
      if (!timeUp) {
        g.turn = (g.turn + 1) % g.players;
        g.turnStart = t;
        events.push({ t: 'go', player: g.turn, again: false, slow: false });
      }
    }
  }
  if (g.resolveAt === null && timeUp) {
    flipBack(g, t);
    g.over = true;
    events.push({ t: 'over', timeUp: true });
    return events;
  }
  if (g.resolveAt === null && patient && t - g.turnStart >= MEMORY.turnTime) {
    flipBack(g, t);
    g.turn = (g.turn + 1) % g.players;
    g.turnStart = t;
    events.push({ t: 'go', player: g.turn, again: false, slow: true });
  }
  return events;
}

/** Pairs are what count; equal pairs share a place. */
export function memoryScores(g: MemoryGame): number[] {
  return g.pairs.slice();
}

// ------------------------------------------------------------------ computer players

/** What a computer player remembers: the cards it noticed face up, and when. */
export interface CpuMemory {
  skill: number;
  seen: Map<number, { face: number; at: number }>;
}

export function newCpuMemory(skill: number): CpuMemory {
  return { skill: Math.max(0, Math.min(1, skill)), seen: new Map() };
}

/** Chance a computer player takes note of a card turned face up (a sleepy one is often looking elsewhere). */
export function noticeChance(skill: number): number {
  return 0.55 + 0.4 * skill;
}

/** How long a memory lasts (seconds): the chance of recalling a card fades as exp(-age / hold). */
export function holdTime(skill: number): number {
  return 8 + 37 * skill;
}

/** A card was turned face up at time t: the computer player may take note of it. */
export function notice(m: CpuMemory, card: number, face: number, t: number, rng: Rng): void {
  if (rng() < noticeChance(m.skill)) m.seen.set(card, { face, at: t });
}

/** Seconds a computer player takes over a pick: a little longer when it's a guess, quicker when sharp. */
export function cpuDelay(skill: number, second: boolean, rng: Rng): number {
  return (second ? 0.45 : 0.6) + (1 - skill) * 0.4 + rng() * 0.45;
}

/**
 * The card a computer player turns next on its go. It recalls what it can (each memory fading with time), goes
 * for a pair it knows, matches the card it just turned if it remembers the other one, and otherwise tries a card
 * it hasn't seen.
 */
export function cpuChoose(m: CpuMemory, g: MemoryGame, t: number, rng: Rng): number | null {
  const cards = g.board.cards;
  const open = cards.map((c, i) => (c.state === 'down' && !g.picks.includes(i) ? i : -1)).filter((i) => i >= 0);
  if (!open.length) return null;
  for (const i of [...m.seen.keys()]) if (cards[i]?.state === 'taken') m.seen.delete(i);
  const hold = holdTime(m.skill);
  const known = new Map<number, number>(); // card -> face, what it recalls right now
  for (const i of open) {
    const s = m.seen.get(i);
    if (s && rng() < Math.exp(-(t - s.at) / hold)) known.set(i, s.face);
  }
  const unknown = open.filter((i) => !known.has(i));
  const guess = () => (unknown.length ? (unknown[Math.floor(rng() * unknown.length)] as number) : (open[Math.floor(rng() * open.length)] as number));
  if (g.picks.length === 0) {
    const byFace = new Map<number, number[]>();
    for (const [i, f] of known) byFace.set(f, [...(byFace.get(f) ?? []), i]);
    for (const list of byFace.values()) if (list.length >= 2) return list[0] as number;
    return guess();
  }
  const face = cards[g.picks[0] as number]?.face;
  for (const [i, f] of known) if (f === face) return i;
  return guess();
}
