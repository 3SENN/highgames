// Order Up: late-night pizza orders come in on a ticket (3 to 5 toppings, in order). Every phone holds only some of
// the topping buttons, so the group has to call out who has what. Toppings go on in the ticket's order; a wrong
// one spoils the pizza and a fresh order comes in. Serve as many pizzas as you can before time is up.
import { type Rng, shuffle } from '../rng';

export const TOPPINGS = ['cheese', 'salami', 'mushroom', 'peppers', 'olives', 'pineapple', 'fries', 'marshmallow'] as const;
export type Topping = (typeof TOPPINGS)[number];

export const TOPPING_INFO: Record<Topping, { name: string; color: string }> = {
  cheese: { name: 'Cheese', color: '#f7c62f' },
  salami: { name: 'Salami', color: '#c8323c' },
  mushroom: { name: 'Mushroom', color: '#b98d68' },
  peppers: { name: 'Peppers', color: '#3fae4a' },
  olives: { name: 'Olives', color: '#4a3a5c' },
  pineapple: { name: 'Pineapple', color: '#f39c33' },
  fries: { name: 'Fries', color: '#d9a43a' },
  marshmallow: { name: 'Marshmallow', color: '#f28ab8' },
};

export const ORDERUP = {
  duration: 40, // seconds
  lengths: [3, 3, 4, 4, 5], // toppings per order: the first orders are short, then they stay at 5
  serveTime: 1.3, // seconds a served pizza takes to box before the next ticket
  spoilTime: 1.5, // seconds to clear a spoiled pizza
  partial: 0.5, // credit for a pizza still on the counter at the end, times how far along it is
} as const;

export type KitchenPhase = 'build' | 'serve' | 'spoil';

export interface Kitchen {
  players: number;
  /** Every topping in this game. */
  pool: Topping[];
  /** The topping buttons on each seat's phone. */
  hands: Topping[][];
  order: Topping[];
  /** How many of the order's toppings are on. */
  done: number;
  phase: KitchenPhase;
  /** Seconds left in the serve or spoil pause. */
  wait: number;
  time: number;
  served: number;
  spoiled: number;
  /** Orders handed out so far (sets the next order's length). */
  orders: number;
  /** Bumps whenever the next topping changes, so computer players re-plan. */
  step: number;
  /** Toppings each seat put on correctly, and wrong ones. */
  added: number[];
  mistakes: number[];
}

export type AddResult = 'ok' | 'served' | 'spoiled' | 'ignored';

/** How many toppings are in play: everyone gets two or three buttons (a solo player gets five). */
export function poolSize(players: number): number {
  return [5, 6, 7, 8][Math.min(4, Math.max(1, players)) - 1] as number;
}

/** A fair number of pizzas for the group: five for three or four players, four for one or two. */
export function orderTarget(players: number): number {
  return players >= 3 ? 5 : 4;
}

export function dealToppings(rng: Rng, players: number): { pool: Topping[]; hands: Topping[][] } {
  const n = Math.max(1, players);
  const pool = shuffle(rng, TOPPINGS).slice(0, poolSize(n));
  const hands: Topping[][] = Array.from({ length: n }, () => []);
  pool.forEach((t, i) => hands[i % n]?.push(t));
  return { pool, hands };
}

export function orderLength(index: number): number {
  return ORDERUP.lengths[Math.min(index, ORDERUP.lengths.length - 1)] as number;
}

/** A fresh order: distinct toppings from the pool. Consecutive toppings come from different phones when possible. */
export function makeOrder(rng: Rng, pool: readonly Topping[], hands: readonly Topping[][], index: number): Topping[] {
  const len = Math.min(orderLength(index), pool.length);
  const owner = (t: Topping) => hands.findIndex((h) => h.includes(t));
  const order: Topping[] = [];
  let left = shuffle(rng, pool);
  while (order.length < len) {
    const prev = order[order.length - 1];
    const handOff = left.find((t) => prev === undefined || owner(t) !== owner(prev));
    const next = handOff ?? (left[0] as Topping);
    order.push(next);
    left = left.filter((t) => t !== next);
  }
  return order;
}

export function newKitchen(rng: Rng, players: number): Kitchen {
  const n = Math.max(1, players);
  const { pool, hands } = dealToppings(rng, n);
  return {
    players: n,
    pool,
    hands,
    order: makeOrder(rng, pool, hands, 0),
    done: 0,
    phase: 'build',
    wait: 0,
    time: 0,
    served: 0,
    spoiled: 0,
    orders: 1,
    step: 0,
    added: Array.from({ length: n }, () => 0),
    mistakes: Array.from({ length: n }, () => 0),
  };
}

export function ownerOfTopping(k: Kitchen, t: Topping): number {
  return k.hands.findIndex((h) => h.includes(t));
}

/** The topping the ticket needs next (null between pizzas). */
export function nextTopping(k: Kitchen): Topping | null {
  return k.phase === 'build' ? (k.order[k.done] ?? null) : null;
}

/** A seat presses one of its topping buttons. Presses between pizzas, or of toppings it doesn't hold, are ignored. */
export function addTopping(k: Kitchen, seat: number, t: Topping): AddResult {
  if (k.phase !== 'build' || !k.hands[seat]?.includes(t)) return 'ignored';
  if (t !== k.order[k.done]) {
    k.mistakes[seat] = (k.mistakes[seat] ?? 0) + 1;
    k.spoiled += 1;
    k.phase = 'spoil';
    k.wait = ORDERUP.spoilTime;
    k.step += 1;
    return 'spoiled';
  }
  k.added[seat] = (k.added[seat] ?? 0) + 1;
  k.done += 1;
  k.step += 1;
  if (k.done >= k.order.length) {
    k.served += 1;
    k.phase = 'serve';
    k.wait = ORDERUP.serveTime;
    return 'served';
  }
  return 'ok';
}

/** Runs the clock; after a serve or spoil pause the next ticket comes in. Returns true when a new order arrived. */
export function stepKitchen(k: Kitchen, dt: number, rng: Rng): boolean {
  k.time += dt;
  if (k.phase === 'build') return false;
  k.wait -= dt;
  if (k.wait > 0) return false;
  k.order = makeOrder(rng, k.pool, k.hands, k.orders);
  k.orders += 1;
  k.done = 0;
  k.phase = 'build';
  k.wait = 0;
  k.step += 1;
  return true;
}

/** Pizzas served, plus part credit for one still being built. */
export function pizzasMade(k: Kitchen): number {
  const partial = k.phase === 'build' && k.order.length ? (k.done / k.order.length) * ORDERUP.partial : 0;
  return k.served + partial;
}

export function orderCoop(k: Kitchen): number {
  return Math.min(1, pizzasMade(k) / orderTarget(k.players));
}

// ------------------------------------------------------------------ computer players

export interface OrderCpu {
  step: number;
  at: number;
  topping: Topping | null;
}

export function newOrderCpu(): OrderCpu {
  return { step: -1, at: 0, topping: null };
}

/**
 * A computer player waits for one of its toppings to come up on the ticket, finds the button (slower when sleepy)
 * and presses it. Now and then it grabs the wrong one of its buttons. Returns the topping it presses, if any.
 */
export function cpuOrderUp(k: Kitchen, seat: number, skill: number, rng: Rng, cpu: OrderCpu): Topping | null {
  const next = nextTopping(k);
  const hand = k.hands[seat] ?? [];
  if (!next || !hand.includes(next)) {
    cpu.topping = null;
    cpu.step = k.step;
    return null;
  }
  if (cpu.step !== k.step) {
    cpu.step = k.step;
    const others = hand.filter((t) => t !== next);
    const slip = others.length > 0 && rng() < 0.01 + (1 - skill) * 0.07;
    cpu.topping = slip ? (others[Math.floor(rng() * others.length)] as Topping) : next;
    cpu.at = k.time + 0.85 + (1 - skill) * 1.8 + rng() * 0.6;
  }
  if (cpu.topping && k.time >= cpu.at) {
    const t = cpu.topping;
    cpu.topping = null;
    return t;
  }
  return null;
}
