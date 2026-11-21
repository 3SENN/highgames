import { describe, expect, it } from 'vitest';
import { GLIDER, flyThrough, makeRings, newGlider, stepGlider } from '../src/game/minigames/glider';
import { PUMP, newBalloon, pumpBalloon, pumpScores, stepBalloon } from '../src/game/minigames/pump';
import { LABELS, SPOTTER, makeField, roundPoints } from '../src/game/minigames/spotter';
import { reactionMs, strikePoints, thunderScores } from '../src/game/minigames/thunder';
import { createRng } from '../src/game/rng';
import { cloudKey } from '../src/shared/cloud';

describe('thunder snap', () => {
  it('scores the fastest valid taps and ignores early ones', () => {
    expect(strikePoints([300, 'early', 250, null])).toEqual([2, 0, 3, 0]);
  });

  it('shares points on equal times', () => {
    expect(strikePoints([300, 300, 400, null])).toEqual([3, 3, 1, 0]);
  });

  it('breaks equal points by total reaction time', () => {
    const s = thunderScores(
      [
        [200, 300],
        [300, 200],
        [250, 260],
      ],
      2,
    );
    expect(s[0]).toBeGreaterThan(s[1] as number);
  });

  it('takes half the round trip off the measured time', () => {
    expect(reactionMs(1300, 1000, 80)).toBe(260);
    expect(reactionMs(1010, 1000, 80)).toBe(0);
  });
});

describe('balloon pump', () => {
  it('rises with steady pumping and finishes', () => {
    const b = newBalloon();
    let t = 0;
    while (t < PUMP.duration && b.finishedAt === null) {
      if (b.air < 80) pumpBalloon(b, 1);
      stepBalloon(b, 0.05, t);
      t += 0.05;
    }
    expect(b.finishedAt).not.toBeNull();
    expect(b.bursts).toBe(0);
  });

  it('bursts when over-filled and ignores pumps while stunned', () => {
    const b = newBalloon();
    let result = 'ok';
    for (let i = 0; i < 20 && result !== 'burst'; i++) result = pumpBalloon(b, 1);
    expect(result).toBe('burst');
    expect(b.air).toBe(0);
    expect(pumpBalloon(b, 1)).toBe('ignored');
  });

  it('ranks finishers by time ahead of everyone still climbing', () => {
    const a = { ...newBalloon(), finishedAt: 12 };
    const b = { ...newBalloon(), finishedAt: 10 };
    const c = { ...newBalloon(), height: 99 };
    const [sa, sb, sc] = pumpScores([a, b, c]) as [number, number, number];
    expect(sb).toBeGreaterThan(sa);
    expect(sa).toBeGreaterThan(sc);
  });
});

describe('glider rings', () => {
  it('lays rings inside the play area along the whole flight', () => {
    const rings = makeRings(createRng(4));
    const last = rings[rings.length - 1];
    expect(last?.z).toBeGreaterThanOrEqual(GLIDER.duration * GLIDER.speed - GLIDER.spacing);
    for (const r of rings) {
      expect(Math.abs(r.x)).toBeLessThanOrEqual(GLIDER.bounds.x);
      expect(r.y).toBeGreaterThanOrEqual(GLIDER.bounds.yMin);
      expect(r.y).toBeLessThanOrEqual(GLIDER.bounds.yMax);
    }
  });

  it('steers toward the tilt and stays in bounds', () => {
    const g = newGlider(0, 1);
    for (let i = 0; i < 200; i++) stepGlider(g, { x: 1, y: -1 }, 0.05);
    expect(g.x).toBe(GLIDER.bounds.x);
    expect(g.y).toBe(GLIDER.bounds.yMin);
  });

  it('counts a ring once per player, gold rings for three', () => {
    const ring = { z: 0, x: 0, y: 5, r: 2, gold: true, taken: [] as number[] };
    const g = { x: 0.5, y: 5.5, vx: 0, vy: 0, rings: 0 };
    expect(flyThrough(g, ring, 0)).toBe(3);
    expect(flyThrough(g, ring, 0)).toBe(0);
    expect(flyThrough({ ...g, x: 5 }, ring, 1)).toBe(0);
  });
});

describe('cloud spotter', () => {
  it('makes a full field of different clouds with one secret cloud per player', () => {
    for (let seed = 1; seed < 40; seed++) {
      const field = makeField(createRng(seed), 4);
      expect(field.clouds).toHaveLength(SPOTTER.field);
      expect(new Set(field.clouds.map(cloudKey)).size).toBe(SPOTTER.field);
      expect(new Set(field.targets).size).toBe(4);
      for (const t of field.targets) expect(field.clouds[t]).toBeDefined();
    }
    expect(LABELS).toHaveLength(SPOTTER.field);
  });

  it('includes look-alikes that differ in one feature', () => {
    const field = makeField(createRng(9), 2);
    const target = field.clouds[field.targets[0] as number];
    const alike = field.clouds.filter((c) => {
      if (!target || c === target) return false;
      const diff = Number(c.shape !== target.shape) + Number(c.color !== target.color) + Number(c.mark !== target.mark);
      return diff === 1;
    });
    expect(alike.length).toBeGreaterThan(0);
  });

  it('gives round points by finishing order', () => {
    expect(roundPoints([5.2, null, 3.1, 8])).toEqual([3, 0, 4, 2]);
  });
});
