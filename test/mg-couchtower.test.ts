import { describe, expect, it } from 'vitest';
import {
  TOWER,
  type Tower,
  type TowerCpu,
  calmOf,
  cpuTowerWobble,
  newTower,
  planEvents,
  stepTower,
  survived,
  towerCoop,
  towerSide,
} from '../src/game/minigames/couchtower';
import { createRng } from '../src/game/rng';

const DT = 1 / 30;

function run(t: Tower, wobble: (time: number) => number[], seed = 1): Tower {
  const rng = createRng(seed);
  for (let i = 0; i < TOWER.duration / DT + 5 && !t.fallen; i++) stepTower(t, DT, wobble(t.time), rng);
  return t;
}

describe('couch tower', () => {
  it('plans a few disturbances of every kind, getting stronger, none after the cut-off', () => {
    for (let seed = 1; seed < 30; seed++) {
      const events = planEvents(createRng(seed));
      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(new Set(events.slice(0, 4).map((e) => e.kind)).size).toBe(4);
      for (let i = 1; i < events.length; i++) {
        const [a, b] = [events[i - 1], events[i]];
        expect(b?.kind).not.toBe(a?.kind);
        expect(b?.at ?? 0).toBeGreaterThan((a?.at ?? 0) + (a?.length ?? 0));
        expect(b?.strength ?? 0).toBeGreaterThan(a?.strength ?? 0);
      }
      for (const e of events) expect(e.at).toBeLessThanOrEqual(TOWER.lastEvent);
    }
  });

  it('puts players on the top couch from left to right', () => {
    expect(towerSide(0, 4)).toBe(-1);
    expect(towerSide(3, 4)).toBe(1);
    expect(towerSide(0, 1)).toBe(0);
    expect(calmOf(0)).toBe(1);
    expect(calmOf(1)).toBe(0);
  });

  it('stays up for a calm group and scores it 1', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const t = run(newTower(createRng(seed), 4), () => [0.03, 0.04, 0.03, 0.05], seed);
      expect(t.fallen).toBe(false);
      expect(survived(t)).toBeCloseTo(TOWER.duration, 1);
      expect(towerCoop(t)).toBe(1);
    }
  });

  it('topples early when everyone wobbles, and the calm bonus never helps a shaky group', () => {
    const t = run(newTower(createRng(2), 4), () => [0.5, 0.6, 0.5, 0.6]);
    expect(t.fallen).toBe(true);
    expect(survived(t)).toBeLessThan(10);
    expect(towerCoop(t)).toBeCloseTo(survived(t) / TOWER.duration, 1);
  });

  it('lets nobody’s wobble count while everyone settles in', () => {
    const t = newTower(createRng(3), 4);
    const rng = createRng(3);
    for (let i = 0; i < 20; i++) stepTower(t, TOWER.settle / 25, [1, 1, 1, 1], rng);
    expect(Math.max(...t.wobble)).toBeLessThanOrEqual(TOWER.calmFrom);
  });

  it('leans toward the side of the player who wobbles', () => {
    const t = newTower(createRng(4), 4);
    t.events = [];
    t.kicks = [];
    const rng = createRng(4);
    for (let i = 0; i < 60; i++) stepTower(t, DT, [0.03, 0.03, 0.03, 0.4], rng);
    expect(t.lean).toBeGreaterThan(0.01);
  });

  it('gives a small bonus for calm time to a group that fell late', () => {
    const t = newTower(createRng(5), 4);
    t.time = 20;
    t.fellAt = 20;
    t.fallen = true;
    t.calmTime = 15;
    expect(towerCoop(t)).toBeCloseTo(20 / 30 + TOWER.calmBonus * 0.5);
  });

  it('lets sharp computer players survive and average ones get most of the way', () => {
    const avg = (skill: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const rng = createRng(seed * 13);
        const cpus: TowerCpu[] = [0, 1, 2, 3].map(() => ({ fidget: 0 }));
        const t = newTower(createRng(seed), 4);
        let startle = false;
        for (let i = 0; i < TOWER.duration / DT + 5 && !t.fallen; i++) {
          const r = stepTower(t, DT, cpus.map((c) => cpuTowerWobble(c, skill, rng, DT, startle)), rng);
          startle = r.started.some((e) => e.kind === 'doorbell' || e.kind === 'bass');
        }
        sum += towerCoop(t);
      }
      return sum / 60;
    };
    expect(avg(1)).toBeGreaterThan(0.95);
    const mid = avg(0.5);
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(0.9);
  });
});
