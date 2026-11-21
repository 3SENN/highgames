import { describe, expect, it } from 'vitest';
import {
  BUNTING,
  KITE,
  type Kite,
  type Sky,
  TREE,
  type Tilt,
  balloonAt,
  buntingAt,
  cpuGoal,
  cpuPump,
  cpuReelGoal,
  cpuTilt,
  flyerAt,
  kiteScore,
  kiteScores,
  liveBalloons,
  makeBalloons,
  nearestSnag,
  newCpuKite,
  newSky,
  pumpKite,
  stepSky,
  windAt,
} from '../src/game/minigames/kiteduo';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;
const STILL: Tilt[] = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
];

/** A sky with no balloons, so kites can be moved about freely. */
function emptySky(): Sky {
  const sky = newSky(createRng(1), 2);
  sky.balloons = [];
  return sky;
}

function kite(sky: Sky, i: number): Kite {
  const k = sky.kites[i];
  if (!k) throw new Error('no kite');
  return k;
}

describe('kite duo', () => {
  it('puts each pair’s kite above its own side of the hill', () => {
    const sky = newSky(createRng(2), 2);
    expect(kite(sky, 0).x).toBeLessThan(0);
    expect(kite(sky, 1).x).toBeGreaterThan(0);
    expect(sky.balloons.filter((b) => b.at === 0).length).toBe(KITE.first);
  });

  it('sinks without pumping, and climbs with steady pumps', () => {
    const sky = emptySky();
    const y0 = kite(sky, 0).y;
    for (let i = 0; i < 180; i++) stepSky(sky, STILL, DT);
    expect(kite(sky, 0).y).toBeLessThan(y0 - 1);
    const low = kite(sky, 0).y;
    for (let i = 0; i < 180; i++) {
      if (i % 20 === 0) pumpKite(kite(sky, 0), 0.8); // three pumps a second
      stepSky(sky, STILL, DT);
    }
    expect(kite(sky, 0).y).toBeGreaterThan(low + 1);
    expect(kite(sky, 0).lift).toBeLessThanOrEqual(1);
  });

  it('rests on the grass at the bottom and never flies past the end of the string', () => {
    const sky = emptySky();
    for (let i = 0; i < 900; i++) stepSky(sky, STILL, DT);
    expect(kite(sky, 0).y).toBe(KITE.low);
    for (let i = 0; i < 900; i++) {
      pumpKite(kite(sky, 1), 1);
      stepSky(sky, [{ x: 0, y: 0 }, { x: 0, y: 1 }], DT);
    }
    expect(kite(sky, 1).y).toBe(KITE.high);
  });

  it('steers sideways with the tilt, against a gentle wind, and stays in the sky', () => {
    const sky = emptySky();
    const x0 = kite(sky, 0).x;
    for (let i = 0; i < 30; i++) stepSky(sky, [{ x: -1, y: 0 }, { x: 1, y: 0 }], DT);
    expect(kite(sky, 0).x).toBeLessThan(x0 - 0.5);
    for (let i = 0; i < 600; i++) stepSky(sky, [{ x: -1, y: 0 }, { x: 1, y: 0 }], DT);
    expect(kite(sky, 0).x).toBe(-KITE.x);
    expect(kite(sky, 1).x).toBe(KITE.x);
    for (let t = 0; t < KITE.duration; t += 0.37) expect(Math.abs(windAt(t))).toBeLessThanOrEqual(KITE.wind);
  });

  it('tangles in the tree for a moment, ignores pumps meanwhile, then slips free', () => {
    const sky = emptySky();
    const k = kite(sky, 1);
    const crown = TREE[0];
    if (!crown) throw new Error('no tree');
    k.x = crown.x - crown.r - KITE.kiteR - 0.05;
    k.y = crown.y;
    let tangled = 0;
    for (let i = 0; i < 30 && tangled === 0; i++) tangled += stepSky(sky, [{ x: 0, y: 0 }, { x: 1, y: 0 }], DT).tangled.length;
    expect(tangled).toBe(1);
    expect(k.tangles).toBe(1);
    const stuck = { x: k.x, y: k.y };
    expect(pumpKite(k, 1)).toBe(false);
    stepSky(sky, [{ x: 0, y: 0 }, { x: -1, y: -1 }], KITE.tangle - 0.1);
    expect(k.x).toBe(stuck.x);
    expect(k.y).toBe(stuck.y);
    let freed = 0;
    for (let i = 0; i < 20; i++) freed += stepSky(sky, STILL, DT).freed.length;
    expect(freed).toBe(1);
    expect(k.tangled).toBe(0);
    expect(nearestSnag(k.x, k.y).gap).toBeGreaterThan(KITE.kiteR);
  });

  it('tangles in the bunting too', () => {
    const sky = emptySky();
    const k = kite(sky, 0);
    const b = BUNTING[0];
    if (!b) throw new Error('no bunting');
    const mid = buntingAt(b, 0.5);
    k.x = mid.x;
    k.y = mid.y + 1.2;
    let tangled = 0;
    for (let i = 0; i < 120 && tangled === 0; i++) tangled += stepSky(sky, STILL, DT).tangled.length;
    expect(tangled).toBe(1);
  });

  it('collects a balloon once, a point for a plain one and 3 for gold', () => {
    const sky = emptySky();
    const k = kite(sky, 0);
    sky.balloons = [
      { id: 0, at: 0, until: 9, x: k.x + 2, y: k.y, gold: false, phase: 0, taken: null },
      { id: 1, at: 0, until: 9, x: k.x + 4, y: k.y, gold: true, phase: 0, taken: null },
    ];
    k.auto = true; // holds its height
    let got = 0;
    for (let i = 0; i < 120; i++) got += stepSky(sky, [{ x: 1, y: 0 }, { x: 0, y: 0 }], DT).got.length;
    expect(got).toBe(2);
    expect(k.points).toBe(4);
    expect(k.balloons).toBe(2);
    expect(k.golds).toBe(1);
    expect(sky.balloons.every((b) => b.taken === 0)).toBe(true);
  });

  it('lays balloons in reach, clear of the tree and bunting, all through the game', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const list = makeBalloons(createRng(seed));
      expect(list.length).toBeGreaterThan(20);
      expect(list[list.length - 1]?.at).toBeGreaterThan(KITE.duration - 5);
      expect(list.some((b) => b.gold)).toBe(true);
      for (const b of list) {
        expect(Math.abs(b.x)).toBeLessThanOrEqual(KITE.x);
        expect(nearestSnag(b.x, b.y).gap).toBeGreaterThan(KITE.balloonR);
        const end = balloonAt(b, b.until);
        expect(end.y).toBeLessThanOrEqual(KITE.high);
      }
      for (let t = 0; t < KITE.duration; t += 1) {
        expect(liveBalloons({ kites: [], balloons: list, time: t }).length).toBeLessThanOrEqual(KITE.most);
      }
    }
  });

  it('swaps who flies halfway', () => {
    expect(flyerAt(0)).toBe(0);
    expect(flyerAt(KITE.swapAt - 0.01)).toBe(0);
    expect(flyerAt(KITE.swapAt)).toBe(1);
  });

  it('a pair of one holds its height by itself', () => {
    const sky = newSky(createRng(3), 2, [true, false]);
    sky.balloons = [];
    const y0 = kite(sky, 0).y;
    for (let i = 0; i < 300; i++) stepSky(sky, STILL, DT);
    expect(Math.abs(kite(sky, 0).y - y0)).toBeLessThan(1.2);
    expect(kite(sky, 1).y).toBeLessThan(y0 - 2);
  });

  it('gives both partners the same score, more points first, then more balloons', () => {
    const sky = emptySky();
    Object.assign(kite(sky, 0), { points: 9, balloons: 5 });
    Object.assign(kite(sky, 1), { points: 7, balloons: 7 });
    const s = kiteScores(sky, [[0, 3], [1, 2]], 4);
    expect(s[0]).toBe(s[3]);
    expect(s[1]).toBe(s[2]);
    expect(s[0]).toBeGreaterThan(s[1] as number);
    expect(kiteScore({ ...kite(sky, 1), points: 9, balloons: 6 })).toBeGreaterThan(kiteScore(kite(sky, 0)));
  });
});

/** A whole game between computer pairs; skills[team][member]. */
function game(skills: number[][], seed: number): Sky {
  const rng = createRng(seed);
  const sky = newSky(rng, 2);
  const brains = skills.map((t) => t.map(() => newCpuKite()));
  while (sky.time < KITE.duration) {
    const fl = flyerAt(sky.time);
    const tilts = sky.kites.map((k, i) => {
      const flyer = brains[i]?.[fl] ?? newCpuKite();
      const reeler = brains[i]?.[1 - fl] ?? newCpuKite();
      const tilt = cpuTilt(flyer, sky, k, DT, skills[i]?.[fl] ?? 0.5, rng);
      const power = cpuPump(reeler, k, cpuGoal(flyer, sky, k).y, sky.time, skills[i]?.[1 - fl] ?? 0.5, rng);
      if (power !== null) pumpKite(k, power);
      return tilt;
    });
    stepSky(sky, tilts, DT);
  }
  return sky;
}

describe('kite duo computer players', () => {
  it('a computer reeler aims for the balloon its person seems to be steering at', () => {
    const sky = emptySky();
    const k = kite(sky, 0);
    k.x = 0;
    k.y = 4;
    k.vx = 4;
    sky.balloons = [
      { id: 0, at: 0, until: 9, x: -3, y: 8, gold: false, phase: 0, taken: null },
      { id: 1, at: 0, until: 9, x: 3, y: 2.5, gold: false, phase: 0, taken: null },
    ];
    expect(cpuReelGoal(sky, k)).toBeLessThan(3.5);
    k.vx = -4;
    expect(cpuReelGoal(sky, k)).toBeGreaterThan(7);
    sky.balloons = [];
    expect(cpuReelGoal(sky, k)).toBeGreaterThan(KITE.low + 2);
  });

  it('a computer reeler holds a person’s kite up in the sky', () => {
    const rng = createRng(4);
    const sky = emptySky();
    const reeler = newCpuKite();
    let low = 0;
    while (sky.time < 20) {
      const k = kite(sky, 0);
      const power = cpuPump(reeler, k, cpuReelGoal(sky, k), sky.time, 0.5, rng);
      if (power !== null) pumpKite(k, power);
      stepSky(sky, [{ x: Math.sin(sky.time), y: 0 }, { x: 0, y: 0 }], DT);
      if (k.y <= KITE.low + 0.1) low += DT;
    }
    expect(low).toBeLessThan(2);
  });

  it('evenly matched pairs both collect plenty and either can win', () => {
    const wins = [0, 0];
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sky = game(
        [
          [0.5, 0.5],
          [0.5, 0.5],
        ],
        seed,
      );
      const [a, b] = sky.kites.map((k) => k.points) as [number, number];
      total += a + b;
      if (a > b) wins[0] = (wins[0] ?? 0) + 1;
      if (b > a) wins[1] = (wins[1] ?? 0) + 1;
    }
    expect(total / 40).toBeGreaterThan(8);
    expect(wins[0]).toBeGreaterThan(4);
    expect(wins[1]).toBeGreaterThan(4);
  });

  it('sharp pairs beat sleepy ones, and sleepy ones still pop a few', () => {
    let sharpWins = 0;
    let sleepy = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sky = game(
        [
          [1, 1],
          [0, 0],
        ],
        seed,
      );
      if (kite(sky, 0).points > kite(sky, 1).points) sharpWins++;
      sleepy += kite(sky, 1).points;
    }
    expect(sharpWins).toBeGreaterThanOrEqual(17);
    expect(sleepy / 20).toBeGreaterThan(4);
  });
});
