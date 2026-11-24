// Skypost's rules. Pure functions over GameState: no rendering, no network, no timers.
// The TV's director calls these and animates what they report.
import { DESTINATIONS, type IslandId } from '../shared/islands.js';
import { ITEMS, type ItemId, MAX_ITEMS } from '../shared/items.js';
import { type Board, space } from './board.js';
import { type Rng, pick, randInt, shuffle } from './rng.js';

export const START_COINS = 10;
export const MAX_PARCELS = 2;
export const PRIORITY_COST = 5;
export const BREEZE_COINS = 3;
export const SQUALL_COINS = 3;
export const DELIVERY_COINS = 3;
export const GUST_STEPS = 2;
/** Coins for 1st, 2nd, 3rd and 4th place in a minigame. */
export const PLACE_COINS = [10, 5, 3, 0] as const;

export interface Parcel {
  to: IslandId;
  priority: boolean;
}

export interface Player {
  seat: number;
  name: string;
  space: number;
  coins: number;
  stamps: number;
  parcels: Parcel[];
  items: ItemId[];
  stats: { moved: number; squalls: number; wins: number; deliveries: number };
}

export interface GameState {
  round: number; // 1-based
  rounds: number;
  players: Player[]; // indexed by seat
  order: number[]; // seats in turn order
}

export function createGame(opts: {
  players: { name: string }[];
  rounds: number;
  board: Board;
  rng: Rng;
}): GameState {
  const players = opts.players.map((p, seat) => ({
    seat,
    name: p.name,
    space: opts.board.start,
    coins: START_COINS,
    stamps: 0,
    parcels: [],
    items: [],
    stats: { moved: 0, squalls: 0, wins: 0, deliveries: 0 },
  }));
  return { round: 1, rounds: opts.rounds, players, order: shuffle(opts.rng, players.map((p) => p.seat)) };
}

export function player(state: GameState, seat: number): Player {
  const p = state.players[seat];
  if (!p) throw new Error(`No player in seat ${seat}`);
  return p;
}

function addCoins(p: Player, amount: number): number {
  const before = p.coins;
  p.coins = Math.max(0, p.coins + amount);
  return p.coins - before;
}

// ------------------------------------------------------------------ rolling

export interface RollPlan {
  dice: 1 | 2;
  bonus: number;
}

/** Uses an item before rolling. Only one item per turn. Returns how the roll changes, or null. */
export function useItem(state: GameState, seat: number, item: ItemId): RollPlan | null {
  const p = player(state, seat);
  const at = p.items.indexOf(item);
  if (at < 0 || !ITEMS[item].usable) return null;
  p.items.splice(at, 1);
  if (item === 'tailwind') return { dice: 1, bonus: 3 };
  if (item === 'twin') return { dice: 2, bonus: 0 };
  return null;
}

export function rollDice(rng: Rng, plan: RollPlan = { dice: 1, bonus: 0 }): { values: number[]; total: number } {
  const values = Array.from({ length: plan.dice }, () => randInt(rng, 1, 6));
  return { values, total: values.reduce((a, b) => a + b, 0) + plan.bonus };
}

// ------------------------------------------------------------------ moving

export interface Delivery {
  parcel: Parcel;
  stamps: number;
  coins: number;
}

export interface EnterResult {
  deliveries: Delivery[];
  /** The player stands on a Post Office counter and has room for a parcel. */
  canPickUp: boolean;
}

/** Moves a player one step onto `to` (which must follow their space) and hands over any parcels for that island. */
export function enterSpace(state: GameState, board: Board, seat: number, to: number): EnterResult {
  const p = player(state, seat);
  if (!space(board, p.space).next.includes(to)) throw new Error(`Space ${to} does not follow ${p.space}`);
  p.space = to;
  p.stats.moved += 1;
  return arrive(state, board, seat);
}

/** What happens on reaching a space, by walking or by being moved there. */
export function arrive(state: GameState, board: Board, seat: number): EnterResult {
  const p = player(state, seat);
  const s = space(board, p.space);
  const deliveries: Delivery[] = [];
  if (s.type === 'dock' && s.island) {
    const here = p.parcels.filter((x) => x.to === s.island);
    p.parcels = p.parcels.filter((x) => x.to !== s.island);
    for (const parcel of here) {
      const stamps = parcel.priority ? 2 : 1;
      p.stamps += stamps;
      p.stats.deliveries += 1;
      addCoins(p, DELIVERY_COINS);
      deliveries.push({ parcel, stamps, coins: DELIVERY_COINS });
    }
  }
  return { deliveries, canPickUp: s.type === 'post' && p.parcels.length < MAX_PARCELS };
}

/** Moves a player directly (gusts, swaps). Counts as arriving but not as walking. */
export function placeAt(state: GameState, board: Board, seat: number, to: number): EnterResult {
  space(board, to);
  player(state, seat).space = to;
  return arrive(state, board, seat);
}

// ------------------------------------------------------------------ parcels

export function parcelOffer(state: GameState, seat: number, rng: Rng): { standard: IslandId; priority: IslandId } {
  const carried = new Set(player(state, seat).parcels.map((x) => x.to));
  const fresh = DESTINATIONS.filter((d) => !carried.has(d));
  const pool = fresh.length >= 2 ? fresh : DESTINATIONS;
  const standard = pick(rng, pool);
  const others = pool.filter((d) => d !== standard);
  return { standard, priority: pick(rng, others.length > 0 ? others : pool) };
}

export function takeParcel(state: GameState, seat: number, to: IslandId, priority: boolean): boolean {
  const p = player(state, seat);
  if (p.parcels.length >= MAX_PARCELS) return false;
  if (priority && p.coins < PRIORITY_COST) return false;
  if (priority) addCoins(p, -PRIORITY_COST);
  p.parcels.push({ to, priority });
  return true;
}

// ------------------------------------------------------------------ landing

export type SkyEvent = 'shower' | 'gift' | 'swap' | 'magpie' | 'tailwind';
export const SKY_EVENTS: readonly SkyEvent[] = ['shower', 'gift', 'swap', 'magpie', 'tailwind'];

export type Landing =
  | { kind: 'coins'; amount: number }
  | { kind: 'umbrella' }
  | { kind: 'event'; event: SkyEvent }
  | { kind: 'market' }
  | { kind: 'gust'; steps: number }
  | { kind: 'none' };

/** The effect of the space a turn ends on. Coin spaces are applied here; the rest are applied by the caller. */
export function land(state: GameState, board: Board, seat: number, rng: Rng): Landing {
  const p = player(state, seat);
  switch (space(board, p.space).type) {
    case 'start':
    case 'breeze':
    case 'dock':
      return { kind: 'coins', amount: addCoins(p, BREEZE_COINS) };
    case 'squall': {
      p.stats.squalls += 1;
      const umbrella = p.items.indexOf('umbrella');
      if (umbrella >= 0) {
        p.items.splice(umbrella, 1);
        return { kind: 'umbrella' };
      }
      return { kind: 'coins', amount: addCoins(p, -SQUALL_COINS) };
    }
    case 'event':
      return { kind: 'event', event: pick(rng, state.players.length > 1 ? SKY_EVENTS : SKY_EVENTS.filter((e) => e !== 'swap')) };
    case 'market':
      return { kind: 'market' };
    case 'gust':
      return { kind: 'gust', steps: GUST_STEPS };
    case 'post':
      return { kind: 'none' };
  }
}

export interface EventOutcome {
  title: string;
  text: string;
  coins: { seat: number; amount: number }[];
  swapWith?: number;
}

export function applyEvent(state: GameState, board: Board, seat: number, event: SkyEvent, rng: Rng): EventOutcome {
  const p = player(state, seat);
  switch (event) {
    case 'shower': {
      const coins = state.players.map((q) => ({ seat: q.seat, amount: addCoins(q, 2) }));
      return { title: 'Couch cushions', text: 'Someone checks between the couch cushions. Everyone finds 2 coins!', coins };
    }
    case 'gift':
      return { title: 'Big tipper', text: `A very happy customer tips ${p.name} 5 coins.`, coins: [{ seat, amount: addCoins(p, 5) }] };
    case 'swap': {
      const others = state.players.filter((q) => q.seat !== seat);
      const other = pick(rng, others);
      const mine = p.space;
      placeAt(state, board, seat, other.space);
      placeAt(state, board, other.seat, mine);
      return { title: 'Whoosh!', text: `A gust of wind blows ${p.name} and ${other.name} into each other's spot.`, coins: [], swapWith: other.seat };
    }
    case 'magpie': {
      const order = standings(state);
      const last = order[order.length - 1] as { seat: number };
      const first = order[0] as { seat: number };
      if (last.seat === seat && first.seat !== seat) {
        const leader = player(state, first.seat);
        const taken = -addCoins(leader, -3);
        addCoins(p, taken);
        return {
          title: 'Kind seagull',
          text: `A seagull swipes ${taken} coins from ${leader.name} and drops them on ${p.name}.`,
          coins: [
            { seat, amount: taken },
            { seat: leader.seat, amount: -taken },
          ],
        };
      }
      const target = player(state, last.seat === seat ? (order[order.length - 2] as { seat: number }).seat : last.seat);
      const taken = -addCoins(p, -3);
      addCoins(target, taken);
      return {
        title: 'Cheeky seagull',
        text: `A seagull runs off with ${taken} of ${p.name}'s coins and drops them on ${target.name}.`,
        coins: [
          { seat, amount: -taken },
          { seat: target.seat, amount: taken },
        ],
      };
    }
    case 'tailwind':
      if (p.items.length < MAX_ITEMS) {
        p.items.push('tailwind');
        return { title: 'Second wind', text: `${p.name} finds an Energy Drink for later!`, coins: [] };
      }
      return { title: 'Second wind', text: `${p.name}'s bag is full, so they sell an Energy Drink for 4 coins.`, coins: [{ seat, amount: addCoins(p, 4) }] };
  }
}

// ------------------------------------------------------------------ market

export function marketOffers(): { id: ItemId; cost: number }[] {
  return (Object.keys(ITEMS) as ItemId[]).map((id) => ({ id, cost: ITEMS[id].cost }));
}

export function buyItem(state: GameState, seat: number, item: ItemId): boolean {
  const p = player(state, seat);
  if (p.items.length >= MAX_ITEMS || p.coins < ITEMS[item].cost) return false;
  addCoins(p, -ITEMS[item].cost);
  p.items.push(item);
  return true;
}

// ------------------------------------------------------------------ minigames and scoring

/** Competition ranking: higher score is better; equal scores share a place (1, 2, 2, 4). */
export function ranks(scores: readonly number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}

export function awardMinigame(state: GameState, scores: readonly number[]): { places: number[]; coins: number[] } {
  const places = ranks(scores);
  const coins = places.map((place, seat) => {
    const p = player(state, seat);
    if (place === 1) p.stats.wins += 1;
    return addCoins(p, PLACE_COINS[place - 1] ?? 0);
  });
  return { places, coins };
}

export interface Standing {
  seat: number;
  place: number;
  stamps: number;
  coins: number;
}

export function standings(state: GameState): Standing[] {
  const key = (p: Player) => p.stamps * 10_000 + p.coins;
  const places = ranks(state.players.map(key));
  return state.players
    .map((p, i) => ({ seat: p.seat, place: places[i] as number, stamps: p.stamps, coins: p.coins }))
    .sort((a, b) => a.place - b.place || a.seat - b.seat);
}

export interface Bonus {
  id: 'wins' | 'moved' | 'squalls';
  title: string;
  text: string;
  seats: number[];
}

/** End-of-game bonus stamps. Ties all get one. Applies the stamps and returns what was given. */
export function awardBonuses(state: GameState): Bonus[] {
  const defs: { id: Bonus['id']; title: string; text: string; value: (p: Player) => number }[] = [
    { id: 'wins', title: 'Game Night MVP', text: 'Won the most minigames', value: (p) => p.stats.wins },
    { id: 'moved', title: 'Wanderer', text: 'Wandered the most spaces', value: (p) => p.stats.moved },
    { id: 'squalls', title: 'Rough Night', text: 'Landed on the most bummers', value: (p) => p.stats.squalls },
  ];
  const out: Bonus[] = [];
  for (const d of defs) {
    const best = Math.max(...state.players.map(d.value));
    if (best <= 0) continue;
    const seats = state.players.filter((p) => d.value(p) === best).map((p) => p.seat);
    for (const s of seats) player(state, s).stamps += 1;
    out.push({ id: d.id, title: d.title, text: d.text, seats });
  }
  return out;
}
