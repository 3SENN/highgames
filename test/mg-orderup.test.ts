import { describe, expect, it } from 'vitest';
import {
  ORDERUP,
  TOPPINGS,
  addTopping,
  cpuOrderUp,
  dealToppings,
  makeOrder,
  newKitchen,
  newOrderCpu,
  nextTopping,
  orderCoop,
  orderTarget,
  ownerOfTopping,
  pizzasMade,
  stepKitchen,
} from '../src/game/minigames/orderup';
import { createRng } from '../src/game/rng';

describe('order up', () => {
  it('splits the toppings so every one is on exactly one phone, at most six buttons each', () => {
    for (let players = 1; players <= 4; players++) {
      const { pool, hands } = dealToppings(createRng(players), players);
      expect(new Set(pool).size).toBe(pool.length);
      expect(hands.flat().sort()).toEqual([...pool].sort());
      for (const h of hands) {
        expect(h.length).toBeGreaterThanOrEqual(2);
        expect(h.length).toBeLessThanOrEqual(6);
      }
      for (const t of pool) expect(TOPPINGS).toContain(t);
    }
    expect(dealToppings(createRng(1), 4).hands.map((h) => h.length)).toEqual([2, 2, 2, 2]);
  });

  it('writes orders of 3 to 5 different toppings that pass between phones', () => {
    const rng = createRng(8);
    const { pool, hands } = dealToppings(rng, 4);
    for (let i = 0; i < 12; i++) {
      const order = makeOrder(rng, pool, hands, i);
      expect(order.length).toBe(ORDERUP.lengths[Math.min(i, ORDERUP.lengths.length - 1)]);
      expect(new Set(order).size).toBe(order.length);
      for (let k = 1; k < order.length; k++) {
        const owner = (t: string) => hands.findIndex((h) => h.includes(t as never));
        expect(owner(order[k] as string)).not.toBe(owner(order[k - 1] as string));
      }
    }
  });

  it('serves a pizza when the toppings go on in order, then brings a new ticket', () => {
    const rng = createRng(3);
    const k = newKitchen(rng, 4);
    const first = [...k.order];
    first.forEach((t, i) => expect(addTopping(k, ownerOfTopping(k, t), t)).toBe(i === first.length - 1 ? 'served' : 'ok'));
    expect(k.served).toBe(1);
    expect(nextTopping(k)).toBeNull();
    // Presses during the pause don't count.
    expect(addTopping(k, ownerOfTopping(k, first[0] as never), first[0] as never)).toBe('ignored');
    expect(stepKitchen(k, ORDERUP.serveTime + 0.01, rng)).toBe(true);
    expect(k.phase).toBe('build');
    expect(k.done).toBe(0);
    expect(k.order.length).toBe(3);
  });

  it('spoils the pizza on a wrong topping and ignores toppings that are not on your phone', () => {
    const rng = createRng(4);
    const k = newKitchen(rng, 4);
    const wrong = k.order[1] as (typeof k.order)[number];
    const notMine = k.hands[(ownerOfTopping(k, wrong) + 1) % 4]?.[0];
    expect(addTopping(k, ownerOfTopping(k, wrong), notMine ?? wrong)).toBe('ignored');
    expect(addTopping(k, ownerOfTopping(k, wrong), wrong)).toBe('spoiled');
    expect(k.spoiled).toBe(1);
    expect(k.mistakes[ownerOfTopping(k, wrong)]).toBe(1);
    stepKitchen(k, ORDERUP.spoilTime + 0.01, rng);
    expect(k.phase).toBe('build');
  });

  it('measures the group against a fair target, with part credit for an unfinished pizza', () => {
    expect(orderTarget(4)).toBe(5);
    expect(orderTarget(1)).toBeLessThan(orderTarget(4));
    const k = newKitchen(createRng(5), 4);
    k.served = 2;
    k.done = 1;
    k.order = k.pool.slice(0, 4);
    expect(pizzasMade(k)).toBeCloseTo(2 + 0.25 * ORDERUP.partial);
    k.served = 9;
    expect(orderCoop(k)).toBe(1);
  });

  it('lets sharp computer kitchens hit the target and average ones get most of the way', () => {
    const avg = (skill: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const rng = createRng(seed);
        const k = newKitchen(rng, 4);
        const cpus = [0, 1, 2, 3].map(() => newOrderCpu());
        for (let t = 0; t < ORDERUP.duration; t += 1 / 30) {
          stepKitchen(k, 1 / 30, rng);
          cpus.forEach((c, i) => {
            const press = cpuOrderUp(k, i, skill, rng, c);
            if (press) addTopping(k, i, press);
          });
        }
        sum += orderCoop(k);
      }
      return sum / 60;
    };
    expect(avg(1)).toBeGreaterThan(0.95);
    const mid = avg(0.5);
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(0.9);
  });
});
