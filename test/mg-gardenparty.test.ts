import { describe, expect, it } from 'vitest';
import {
  GARDEN,
  type Garden,
  type GardenBrain,
  type GardenEvent,
  IDLE,
  type Stick,
  SLOTS,
  cpuGarden,
  flowerCount,
  flowerValue,
  gardenCoop,
  newGarden,
  newGardenBrain,
  reachable,
  standing,
  stepGarden,
  wiltAt,
} from '../src/game/minigames/gardenparty';
import { createRng } from '../src/game/rng';

const DT = 1 / 30;

/** Runs the garden for `seconds` with fixed sticks; returns every event. */
function run(g: Garden, sticks: (g: Garden) => Stick[], seconds: number, seed = 1): GardenEvent[] {
  const rng = createRng(seed);
  const events: GardenEvent[] = [];
  for (let t = 0; t < seconds - 1e-9 && g.time < GARDEN.duration; t += DT) events.push(...stepGarden(g, sticks(g), DT, rng));
  return events;
}

/** A garden of computer players at one skill, played to the end. */
function cpuGame(players: number, skill: number, seed: number): Garden {
  const rng = createRng(seed);
  const g = newGarden(createRng(seed * 7 + 1), players);
  const brains: GardenBrain[] = Array.from({ length: players }, () => newGardenBrain(skill));
  while (g.time < GARDEN.duration) stepGarden(g, brains.map((b, i) => cpuGarden(g, i, b, rng, DT, brains)), DT, rng);
  return g;
}

describe('garden party', () => {
  it('plants fewer flowers for fewer players, spread out, inside the lawn and not all equally thirsty', () => {
    expect([1, 2, 3, 4].map(flowerCount)).toEqual([3, 6, 8, 10]);
    for (let players = 1; players <= 4; players++) {
      const g = newGarden(createRng(players), players);
      expect(g.flowers.length).toBe(flowerCount(players));
      expect(g.gardeners.length).toBe(players);
      for (const f of g.flowers) {
        expect(Math.abs(f.x)).toBeLessThan(GARDEN.bounds.x);
        expect(Math.abs(f.z)).toBeLessThan(GARDEN.bounds.z);
        expect(f.h).toBeGreaterThan(0.4);
        expect(f.h).toBeLessThanOrEqual(1);
      }
      for (let i = 0; i < g.flowers.length; i++) {
        for (let j = i + 1; j < g.flowers.length; j++) {
          const [a, b] = [g.flowers[i], g.flowers[j]];
          // Far enough apart that one can never waters two.
          expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0))).toBeGreaterThan(GARDEN.reach + 0.5);
        }
      }
      const hs = g.flowers.map((f) => f.h);
      expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(players === 1 ? 0.2 : 0.35);
    }
    expect(SLOTS.length).toBe(flowerCount(4));
  });

  it('wilts faster as the evening goes on, and loses a flower nobody waters', () => {
    expect(wiltAt(GARDEN.duration)).toBeGreaterThan(wiltAt(0));
    const g = newGarden(createRng(2), 4);
    const f = g.flowers[0];
    if (!f) throw new Error('no flower');
    f.h = 0.3;
    f.thirst = 1;
    const events = run(g, () => [IDLE, IDLE, IDLE, IDLE], 0.3 / wiltAt(0) + 0.3);
    expect(f.lost).toBe(true);
    expect(f.lostAt).toBeCloseTo(0.3 / wiltAt(0), 0);
    expect(events.filter((e) => e.kind === 'lost' && e.flower === 0)).toHaveLength(1);
    expect(events.some((e) => e.kind === 'danger' && e.flower === 0)).toBe(true);
    // A lost flower stays lost: the can doesn't reach it any more.
    expect(reachable(g, f.x + 0.9, f.z)).not.toBe(0);
  });

  it('perks a flower up when someone holds Water next to it, and credits whoever watered it', () => {
    const g = newGarden(createRng(3), 2);
    const f = g.flowers[0];
    const p = g.gardeners[1];
    if (!f || !p) throw new Error('setup');
    f.h = 0.4;
    f.low = 0.4;
    p.x = f.x + 0.95;
    p.z = f.z;
    const events = run(g, () => [IDLE, { x: 0, y: 0, a: true }], 1.5);
    expect(f.h).toBeGreaterThan(GARDEN.full - 0.05);
    const perk = events.find((e) => e.kind === 'perk');
    expect(perk).toMatchObject({ kind: 'perk', flower: 0, seats: [1], save: false });
    expect(p.perks).toBe(1);
    expect(p.given).toBeGreaterThan(0.5);
    expect(g.gardeners[0]?.perks).toBe(0);
    // Topping up a flower that is already fine is no "perk".
    const more = run(g, () => [IDLE, { x: 0, y: 0, a: true }], 1);
    expect(more.some((e) => e.kind === 'perk')).toBe(false);
  });

  it('calls it a save when the flower was nearly gone', () => {
    const g = newGarden(createRng(4), 1);
    const f = g.flowers[1];
    const p = g.gardeners[0];
    if (!f || !p) throw new Error('setup');
    f.h = 0.15;
    f.low = 0.15;
    p.x = f.x;
    p.z = f.z + 1.0;
    const events = run(g, () => [{ x: 0, y: 0, a: true }], 2.5);
    expect(events.find((e) => e.kind === 'perk')).toMatchObject({ save: true });
    expect(p.saves).toBe(1);
  });

  it('walks where the stick points (up is away from the audience), round the beds and inside the lawn', () => {
    const g = newGarden(createRng(5), 1);
    const p = g.gardeners[0];
    if (!p) throw new Error('setup');
    run(g, () => [{ x: 0, y: 1, a: false }], 0.5);
    expect(p.z).toBeLessThan(0);
    run(g, () => [{ x: 1, y: -1, a: false }], 8);
    expect(p.x).toBeLessThanOrEqual(GARDEN.bounds.x);
    expect(p.z).toBeLessThanOrEqual(GARDEN.bounds.z);
    for (let k = 0; k < 4; k++) {
      run(g, () => [{ x: Math.sin(k * 2), y: Math.cos(k * 2), a: false }], 2);
      for (const f of g.flowers) expect(Math.hypot(p.x - f.x, p.z - f.z)).toBeGreaterThanOrEqual(GARDEN.bedR + GARDEN.bodyR - 1e-6);
    }
  });

  it('sends a splashed bee buzzing off, with no harm done', () => {
    const g = newGarden(createRng(6), 4);
    const p = g.gardeners[0];
    const b = g.bees[0];
    if (!p || !b) throw new Error('setup');
    p.x = 0;
    p.z = 0;
    p.face = 0;
    b.x = 0;
    b.z = GARDEN.spout;
    const before = gardenCoop(g);
    const events = stepGarden(g, [{ x: 0, y: 0, a: true }, IDLE, IDLE, IDLE], DT, createRng(6));
    expect(events).toContainEqual({ kind: 'splash', bee: 0, seat: 0 });
    expect(p.bees).toBe(1);
    expect(b.away).toBeGreaterThan(0);
    expect(b.vz).toBeGreaterThan(0);
    expect(gardenCoop(g)).toBeCloseTo(before, 1);
    // It stays away for a while (no second splash right away), then comes back to the flowers.
    const again = run(g, () => [{ x: 0, y: 0, a: true }, IDLE, IDLE, IDLE], 1);
    expect(again.some((e) => e.kind === 'splash' && e.bee === 0)).toBe(false);
  });

  it('scores flowers still standing, weighted by how healthy they are', () => {
    const g = newGarden(createRng(7), 4);
    for (const f of g.flowers) f.h = 1;
    expect(gardenCoop(g)).toBe(1);
    const [a, b, c] = g.flowers;
    if (!a || !b || !c) throw new Error('setup');
    a.lost = true;
    a.h = 0;
    b.h = 0.01;
    c.h = GARDEN.bloom;
    expect(flowerValue(a)).toBe(0);
    expect(flowerValue(b)).toBeCloseTo(0.5, 1);
    expect(flowerValue(c)).toBe(1);
    expect(gardenCoop(g)).toBeCloseTo((g.flowers.length - 1.5) / g.flowers.length, 2);
    expect(standing(g)).toBe(g.flowers.length - 1);
    for (const f of g.flowers) f.lost = true;
    expect(gardenCoop(g)).toBe(0);
  });

  it('lets sharp computer gardeners keep nearly everything, average ones most of it, for any group size', () => {
    const avg = (players: number, skill: number) => {
      let sum = 0;
      const N = 16;
      for (let seed = 1; seed <= N; seed++) sum += gardenCoop(cpuGame(players, skill, seed));
      return sum / N;
    };
    for (let players = 1; players <= 4; players++) {
      const sharp = avg(players, 1);
      const mid = avg(players, 0.55);
      const sleepy = avg(players, 0.15);
      expect(sharp).toBeGreaterThan(0.9);
      expect(mid).toBeGreaterThan(0.62);
      expect(mid).toBeLessThan(0.9);
      expect(sleepy).toBeLessThan(mid);
    }
  });
});
