// Cushion Claim's rules: a square floor of cushions, everyone starting in a corner. After each minigame the
// players claim cushions by place (1st: 3 claims, 2nd: 2, 3rd: 1). A claim takes a free cushion next to your
// own (cost 1) or someone else's cushion next to yours (cost 2; home corners can't be taken). A small pocket of
// free cushions that only you border becomes yours. Most cushions at the end wins. Pure functions, no DOM.
import type { Rng } from './rng';

export interface ClaimState {
  size: number;
  /** Owner per cell (row-major), null for free. */
  owner: (number | null)[];
  /** Each player's home corner (a cell index). */
  homes: number[];
}

/** Claim points by place (1st, 2nd, 3rd, 4th). */
export const CLAIMS_BY_PLACE = [3, 2, 1, 0] as const;
/** Free pockets up to this size are captured when one player surrounds them. */
export const POCKET_MAX = 4;

export function createClaim(players: number, size = 5): ClaimState {
  const last = size - 1;
  const corners = [0, last, last * size, last * size + last];
  const homes = corners.slice(0, Math.max(1, Math.min(4, players)));
  const owner: (number | null)[] = Array.from({ length: size * size }, () => null);
  homes.forEach((cell, seat) => (owner[cell] = seat));
  return { size, owner, homes };
}

export function claimsFor(place: number): number {
  return CLAIMS_BY_PLACE[place - 1] ?? 0;
}

export function neighbours(s: ClaimState, cell: number): number[] {
  const r = Math.floor(cell / s.size);
  const c = cell % s.size;
  const out: number[] = [];
  if (r > 0) out.push(cell - s.size);
  if (r < s.size - 1) out.push(cell + s.size);
  if (c > 0) out.push(cell - 1);
  if (c < s.size - 1) out.push(cell + 1);
  return out;
}

/** What claiming `cell` costs `seat`, or null if it isn't allowed. */
export function claimCost(s: ClaimState, seat: number, cell: number): number | null {
  const current = s.owner[cell];
  if (current === undefined || current === seat) return null;
  if (!neighbours(s, cell).some((n) => s.owner[n] === seat)) return null;
  if (current === null) return 1;
  if (s.homes[current] === cell) return null; // home corners are safe
  return 2;
}

/** Every cell `seat` may claim with `budget` claim points left. */
export function legalCells(s: ClaimState, seat: number, budget: number): number[] {
  const out: number[] = [];
  for (let cell = 0; cell < s.owner.length; cell++) {
    const cost = claimCost(s, seat, cell);
    if (cost !== null && cost <= budget) out.push(cell);
  }
  return out;
}

/** Free pockets (up to POCKET_MAX cells) bordered only by `seat`'s cushions and the walls. */
export function pocketsFor(s: ClaimState, seat: number): number[] {
  const seen = new Set<number>();
  const captured: number[] = [];
  for (let start = 0; start < s.owner.length; start++) {
    if (s.owner[start] !== null || seen.has(start)) continue;
    const region: number[] = [];
    const queue = [start];
    seen.add(start);
    let onlySeat = true;
    while (queue.length) {
      const cell = queue.pop() as number;
      region.push(cell);
      for (const n of neighbours(s, cell)) {
        const o = s.owner[n];
        if (o === null) {
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        } else if (o !== seat) {
          onlySeat = false;
        }
      }
    }
    const bordered = region.some((cell) => neighbours(s, cell).some((n) => s.owner[n] === seat));
    if (onlySeat && bordered && region.length <= POCKET_MAX) captured.push(...region);
  }
  return captured;
}

/** Claims `cell` for `seat` (the caller checked it is allowed) and captures pockets. Returns the captured cells. */
export function claim(s: ClaimState, seat: number, cell: number): number[] {
  s.owner[cell] = seat;
  const pockets = pocketsFor(s, seat);
  for (const p of pockets) s.owner[p] = seat;
  return pockets;
}

export function counts(s: ClaimState, players: number): number[] {
  const out = Array.from({ length: players }, () => 0);
  for (const o of s.owner) if (o !== null && o < players) out[o] = (out[o] ?? 0) + 1;
  return out;
}

/**
 * A computer player's pick: free cushions that grow its area (more so if they close a pocket), and taking a rival's
 * cushion when that is worth the double price. `skill` 0..1 adds or removes randomness.
 */
export function cpuPick(s: ClaimState, seat: number, budget: number, rng: Rng, skill = 0.6): number | null {
  const options = legalCells(s, seat, budget);
  if (!options.length) return null;
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const cell of options) {
    const cost = claimCost(s, seat, cell) as number;
    const trial: ClaimState = { size: s.size, owner: [...s.owner], homes: s.homes };
    const gained = 1 + claim(trial, seat, cell).length;
    const room = neighbours(s, cell).filter((n) => s.owner[n] === null).length;
    const leader = s.owner[cell] !== null ? 0.6 : 0;
    const score = gained / cost + room * 0.15 + leader + (rng() - 0.5) * (1.2 - skill);
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return best;
}
