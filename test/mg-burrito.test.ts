import { describe, expect, it } from 'vitest';
import {
  BURRITO,
  type Roller,
  burritoDetail,
  burritoScores,
  cpuSpin,
  newCpuSpinner,
  newRoller,
  stepRoller,
  wholeLayers,
  wrapRate,
} from '../src/game/minigames/burrito';
import { createRng } from '../src/game/rng';

/** Rolls for the whole game at a speed given by `speed(t)`; returns the roller and every event. */
function roll(speed: (t: number) => number, dt = 0.1) {
  const r = newRoller();
  const events: string[] = [];
  for (let t = 0; t < BURRITO.duration - 1e-9; t += dt) events.push(...stepRoller(r, speed(t), dt));
  return { r, events };
}

describe('blanket burrito', () => {
  it('wraps faster the faster you circle, and not at all when you barely move', () => {
    expect(wrapRate(0.05)).toBe(0);
    expect(wrapRate(0.5)).toBeGreaterThan(wrapRate(0.3));
    expect(wrapRate(1)).toBeCloseTo(BURRITO.rate);
  });

  it('wraps a good burrito at a steady pace just under the dizzy line', () => {
    const { r, events } = roll(() => 0.82);
    expect(r.dizzies).toBe(0);
    expect(wholeLayers(r)).toBeGreaterThanOrEqual(10);
    expect(events.filter((e) => e === 'layer').length).toBe(wholeLayers(r));
  });

  it('gets dizzy after about two seconds too fast, loses a layer and wobbles for a moment', () => {
    const r: Roller = { ...newRoller(), layers: 5.5 };
    const events: string[] = [];
    let t = 0;
    while (r.dizzies === 0 && t < 5) {
      events.push(...stepRoller(r, 1, 0.05));
      t += 0.05;
    }
    expect(t).toBeGreaterThan(BURRITO.dizzyAfter - 0.1);
    expect(t).toBeLessThan(BURRITO.dizzyAfter + 0.2);
    expect(events).toContain('warn');
    expect(events).toContain('dizzy');
    const after = r.layers;
    expect(after).toBeCloseTo(5.5 + wrapRate(1) * (t - 0.05) - BURRITO.lose, 1);
    // Nothing rolls while dizzy, however fast you spin.
    stepRoller(r, 1, 1);
    expect(r.layers).toBe(after);
    expect(stepRoller(r, 0.5, BURRITO.dizzyFor)).toContain('steady');
    expect(r.dizzy).toBe(0);
  });

  it('forgives short bursts of speed once you ease off long enough', () => {
    const { r } = roll((t) => (t % 4 < 1.5 ? 1 : 0.6));
    expect(r.dizzies).toBe(0);
    const { r: greedy } = roll(() => 1);
    expect(greedy.dizzies).toBeGreaterThan(3);
    expect(greedy.layers).toBeLessThan(r.layers / 2);
  });

  it('never unwraps below nothing', () => {
    const r = newRoller();
    stepRoller(r, 0.9, BURRITO.dizzyAfter + 0.1);
    expect(r.dizzies).toBe(1);
    expect(r.layers).toBeGreaterThanOrEqual(0);
  });

  it('ranks by layers, and words the results kindly', () => {
    const a = { ...newRoller(), layers: 9.2 };
    const b = { ...newRoller(), layers: 9.7, dizzies: 2 };
    const c = { ...newRoller(), layers: 1.4 };
    const [sa, sb, sc] = burritoScores([a, b, c]) as [number, number, number];
    expect(sb).toBeGreaterThan(sa);
    expect(sa).toBeGreaterThan(sc);
    expect(burritoDetail(b)).toBe('9 layers · dizzy 2 times');
    expect(burritoDetail(c)).toBe('1 layer');
  });

  it('has sharp computer players wrap the biggest burritos, and sleepy ones still wrap a few', () => {
    const totals = [0, 0.5, 1].map(() => 0);
    let dizzy = 0;
    const games = 30;
    for (let seed = 1; seed <= games; seed++) {
      const rng = createRng(seed);
      [0, 0.5, 1].forEach((skill, i) => {
        const cpu = newCpuSpinner(skill, rng);
        const r = newRoller();
        for (let t = 0; t < BURRITO.duration; t += 0.1) stepRoller(r, cpuSpin(cpu, r, skill, rng, 0.1), 0.1);
        totals[i] = (totals[i] ?? 0) + r.layers / games;
        if (skill < 1) dizzy += r.dizzies;
      });
    }
    const [sleepy, average, sharp] = totals as [number, number, number];
    expect(sleepy).toBeGreaterThan(4);
    expect(average).toBeGreaterThan(sleepy);
    expect(sharp).toBeGreaterThan(average + 1.5);
    expect(sharp).toBeLessThan(12);
    // The less sharp ones get carried away now and then.
    expect(dizzy).toBeGreaterThan(games * 0.4);
  });
});
