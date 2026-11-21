// Decisions for computer-controlled couriers. Simple, readable heuristics with a little randomness.
import type { ItemId } from '../shared/items.js';
import { MAX_ITEMS } from '../shared/items.js';
import { type Board, distance } from './board.js';
import { type Rng, pick } from './rng.js';
import { type GameState, MAX_PARCELS, PRIORITY_COST, player } from './rules.js';

/** Where this courier wants to go: docks for parcels it carries, and the Post Office if it has room. */
function targets(state: GameState, board: Board, seat: number): { docks: Set<number>; posts: Set<number> } {
  const p = player(state, seat);
  const docks = new Set<number>();
  for (const parcel of p.parcels) {
    const id = board.docks[parcel.to];
    if (id !== undefined) docks.add(id);
  }
  return { docks, posts: p.parcels.length < MAX_PARCELS ? new Set(board.posts) : new Set() };
}

export function chooseFork(state: GameState, board: Board, seat: number, options: number[], rng: Rng): number {
  const { docks, posts } = targets(state, board, seat);
  const empty = player(state, seat).parcels.length === 0;
  const cost = (option: number) => {
    const toDock = docks.size > 0 ? distance(board, option, docks) : Infinity;
    // With nothing to deliver the Post Office matters most; with parcels, it's a nice detour.
    const toPost = posts.size > 0 ? distance(board, option, posts) * (empty ? 1 : 1.6) : Infinity;
    return Math.min(toDock, toPost) + rng() * 0.5;
  };
  let best = 0;
  let bestCost = Infinity;
  options.forEach((option, i) => {
    const c = cost(option);
    if (c < bestCost) {
      bestCost = c;
      best = i;
    }
  });
  return best;
}

export function chooseItem(state: GameState, seat: number, rng: Rng): ItemId | null {
  const items = player(state, seat).items;
  if (items.includes('twin') && rng() < 0.75) return 'twin';
  if (items.includes('tailwind') && rng() < 0.6) return 'tailwind';
  return null;
}

export function chooseBuy(state: GameState, seat: number, rng: Rng): ItemId | null {
  const p = player(state, seat);
  if (p.items.length >= MAX_ITEMS) return null;
  if (p.coins >= 14 && !p.items.includes('twin')) return 'twin';
  if (p.coins >= 7 && !p.items.includes('umbrella') && rng() < 0.5) return 'umbrella';
  if (p.coins >= 9 && rng() < 0.4) return 'tailwind';
  return null;
}

export function choosePriority(state: GameState, seat: number): boolean {
  return player(state, seat).coins >= PRIORITY_COST + 6;
}

/** How quickly and how well a CPU plays minigames (0 = sleepy, 1 = sharp). */
export function cpuSkill(rng: Rng): number {
  return 0.35 + rng() * 0.45;
}

export { pick };
