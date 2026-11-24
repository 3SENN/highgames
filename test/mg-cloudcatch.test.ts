import { describe, expect, it } from 'vitest';
import {
  type Drop,
  CATCH,
  cpuAim,
  cpuStick,
  dropY,
  landsAt,
  makeDrops,
  catchScores,
  newBowl,
  newCpuBowl,
  resolveDrop,
  stepBowl,
} from '../src/game/minigames/cloudcatch';
import { createRng } from '../src/game/rng';

describe('cloud catch', () => {
  it('rains snacks across the lane for the whole game, with golden cookies and broccoli in the mix', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed < 20; seed++) {
      const drops = makeDrops(createRng(seed));
      expect(drops.length).toBeGreaterThan(35);
      drops.forEach((d, i) => {
        expect(Math.abs(d.x)).toBeLessThanOrEqual(CATCH.reach);
        expect(d.at).toBeLessThan(CATCH.duration - CATCH.lastDrop);
        expect(landsAt(d)).toBeLessThan(CATCH.duration);
        if (i > 0) expect(d.at).toBeGreaterThan((drops[i - 1] as Drop).at);
        kinds.add(d.kind);
      });
    }
    expect(kinds).toEqual(new Set(['chip', 'cookie', 'donut', 'pretzel', 'golden', 'broccoli']));
  });

  it('passes the rim exactly when it lands', () => {
    const d: Drop = { at: 3, x: 0, kind: 'chip', speed: 4 };
    expect(dropY(d, d.at)).toBe(CATCH.top);
    expect(dropY(d, landsAt(d))).toBeCloseTo(CATCH.catchY);
  });

  it('slides the bowl with the stick, eases to a stop and stays in its lane', () => {
    const b = newBowl();
    stepBowl(b, 1, 0.05);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vx).toBeLessThan(CATCH.speed);
    for (let i = 0; i < 100; i++) stepBowl(b, 1, 0.05);
    expect(b.x).toBe(CATCH.reach);
    for (let i = 0; i < 100; i++) stepBowl(b, -1, 0.05);
    expect(b.x).toBe(-CATCH.reach);
    stepBowl(b, CATCH.deadzone / 2, 0.05);
    expect(b.vx).toBe(0);
  });

  it('scores snacks, golden cookies and broccoli that land in the bowl, and nothing that misses', () => {
    const b = newBowl();
    expect(resolveDrop(b, { at: 0, x: 0.2, kind: 'donut', speed: 4 })).toBe(1);
    expect(resolveDrop(b, { at: 0, x: -0.3, kind: 'golden', speed: 4 })).toBe(3);
    expect(resolveDrop(b, { at: 0, x: 0.1, kind: 'broccoli', speed: 4 })).toBe(-2);
    expect(resolveDrop(b, { at: 0, x: 1.2, kind: 'cookie', speed: 4 })).toBe(0);
    expect(b).toMatchObject({ score: 2, snacks: 2, goldens: 1, greens: 1 });
    expect(catchScores([b, newBowl()])).toEqual([2, 0]);
  });

  it('has computer players step out from under broccoli about to land', () => {
    const green: Drop = { at: 0, x: 0.1, kind: 'broccoli', speed: 5 };
    const t = landsAt(green) - 0.2;
    const aim = cpuAim(0, [green], t, 1);
    expect(Math.abs(aim - green.x)).toBeGreaterThan(CATCH.catchR);
  });

  it('has sharp computer players catch most snacks, and more than sleepy ones', () => {
    const play = (skill: number, seed: number) => {
      const rng = createRng(seed);
      const drops = makeDrops(rng);
      const b = newBowl();
      const cpu = newCpuBowl();
      let next = 0;
      const dt = 1 / 30;
      for (let t = 0; t < CATCH.duration; t += dt) {
        stepBowl(b, cpuStick(cpu, b, drops, t, dt, skill, rng), dt);
        while (next < drops.length && landsAt(drops[next] as Drop) <= t) resolveDrop(b, drops[next++] as Drop);
      }
      const good = drops.filter((d) => d.kind !== 'broccoli').length;
      return { b, good };
    };
    let sleepy = 0;
    let sharp = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const lazy = play(0, seed);
      const keen = play(1, seed);
      sleepy += lazy.b.score;
      sharp += keen.b.score;
      expect(keen.b.snacks).toBeGreaterThan(keen.good * 0.7);
    }
    expect(sharp).toBeGreaterThan(sleepy * 1.2);
  });
});
