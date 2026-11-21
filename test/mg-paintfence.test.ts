import { describe, expect, it } from 'vitest';
import {
  FENCE,
  FENCE_HALF,
  IDLE,
  type Stick,
  type Yard,
  blocked,
  boardAt,
  boardX,
  boardsOf,
  brushOn,
  bucketsOf,
  cpuStick,
  fenceScores,
  isOver,
  newCpuPainter,
  newYard,
  stepYard,
} from '../src/game/minigames/paintfence';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;
const TEAMS = [
  [0, 1],
  [2, 3],
];
const LANE = FENCE.z + FENCE.near + 0.1;

function sticks(over: Partial<Record<number, Stick>>): Stick[] {
  return [0, 1, 2, 3].map((p) => over[p] ?? IDLE);
}

function yard(seed = 1): Yard {
  return newYard(TEAMS, 4, createRng(seed));
}

/** Puts someone somewhere, standing still; everyone else out of the way at the front of the lawn. */
function place(y: Yard, p: number, x: number, z: number): void {
  y.painters.forEach((c, q) => {
    if (q === p) return;
    c.x = -6 + q * 4;
    c.z = FENCE.front;
  });
  const c = y.painters[p];
  if (!c) throw new Error('no painter');
  c.x = x;
  c.z = z;
  c.vx = 0;
  c.vz = 0;
}

/** Moves the dog well away (napping at the far right end). */
function dogAway(y: Yard): void {
  y.dog.x = FENCE.dog.range;
  y.dog.t = 0;
}

function run(y: Yard, input: Stick[], seconds: number) {
  const all = { painted: 0, filled: 0, woke: 0, dry: 0 };
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const ev = stepYard(y, input, DT);
    all.painted += ev.painted.length;
    all.filled += ev.filled.length;
    all.woke += ev.woke.length;
    all.dry += ev.dry.length;
  }
  return all;
}

describe('paint the fence', () => {
  it('starts with bare boards, full brushes, the dog in the middle and pairs at either end', () => {
    const y = yard();
    expect(y.boards.length).toBe(FENCE.boards);
    expect(boardsOf(y, -1)).toBe(FENCE.boards);
    expect(y.painters.every((c) => c.paint === 1)).toBe(true);
    expect(y.dog.x).toBe(0);
    expect(y.painters[0]?.x).toBeLessThan(0);
    expect(y.painters[2]?.x).toBeGreaterThan(0);
    expect(boardAt(boardX(5))).toBe(5);
    expect(boardAt(FENCE_HALF + 0.5)).toBe(-1);
    // Each team has a bucket at both stations, mirrored.
    expect(bucketsOf(0).map((b) => b.x)).toEqual(bucketsOf(1).map((b) => -b.x).reverse());
  });

  it('paints the nearest board in the pair’s colour after a moment, and only within reach', () => {
    const y = yard();
    dogAway(y);
    place(y, 0, boardX(4), LANE);
    expect(brushOn(y, 0)).toBe(4);
    run(y, sticks({}), FENCE.coat * 0.5);
    expect(y.boards[4]?.team).toBe(-1);
    const all = run(y, sticks({}), FENCE.coat * 0.6);
    expect(all.painted).toBe(1);
    expect(y.boards[4]?.team).toBe(0);
    expect(y.boards[4]?.by).toBe(0);
    // Out on the lawn, the brush doesn't reach.
    place(y, 0, boardX(8), FENCE.z + FENCE.reach + 0.3);
    expect(brushOn(y, 0)).toBe(-1);
  });

  it('strolling along the fence paints every board you pass', () => {
    const y = yard();
    dogAway(y);
    place(y, 0, boardX(2) - FENCE.gap / 2 + 0.02, LANE);
    // Full stick to the right for 3 seconds: the brush keeps you to a stroll.
    run(y, sticks({ 0: { x: 1, y: 0.2 } }), 3);
    const c = y.painters[0];
    expect(c?.x).toBeLessThan(boardX(2) + FENCE.brush * 3 + 0.3);
    const painted = y.boards.filter((b) => b.team === 0).length;
    expect(painted).toBeGreaterThanOrEqual(8);
    for (let i = 2; i < 2 + painted; i++) expect(y.boards[i]?.team).toBe(0);
  });

  it('runs out of paint, and fills up again at the pair’s bucket', () => {
    const y = yard();
    dogAway(y);
    place(y, 0, boardX(0) - FENCE.gap / 2 + 0.02, LANE);
    const all = run(y, sticks({ 0: { x: 1, y: 0.2 } }), 6);
    expect(y.painters[0]?.paint).toBe(0);
    expect(all.painted).toBe(FENCE.tank);
    expect(all.dry).toBeGreaterThanOrEqual(1);
    expect(brushOn(y, 0)).toBe(-1);
    // At the other team's bucket: nothing.
    const theirs = bucketsOf(1)[0];
    const ours = bucketsOf(0)[0];
    if (!theirs || !ours) throw new Error('no buckets');
    place(y, 0, theirs.x, theirs.z);
    run(y, sticks({}), 0.5);
    expect(y.painters[0]?.paint).toBe(0);
    place(y, 0, ours.x, ours.z);
    const filling = run(y, sticks({}), FENCE.fill + 0.1);
    expect(y.painters[0]?.paint).toBe(1);
    expect(filling.filled).toBe(1);
  });

  it('boards can be painted over, and the brush skips boards already yours', () => {
    const y = yard();
    dogAway(y);
    const b = y.boards[10];
    if (!b) throw new Error('no board');
    b.team = 1;
    place(y, 0, boardX(10), LANE);
    run(y, sticks({}), FENCE.coat + 0.05);
    expect(b.team).toBe(0);
    const paint = y.painters[0]?.paint ?? 0;
    run(y, sticks({}), 0.5);
    expect(y.painters[0]?.paint).toBe(paint);
    expect(fenceScores(y, TEAMS, 4)).toEqual([1, 1, 0, 0]);
  });

  it('nobody can paint behind the napping dog, or walk through it', () => {
    const y = yard();
    const mid = boardAt(0);
    expect(blocked(y, mid)).toBe(true);
    expect(blocked(y, mid + 4)).toBe(false);
    place(y, 0, boardX(mid), LANE);
    expect(y.painters[0]?.z).toBe(LANE);
    run(y, sticks({}), 0.1);
    // Pushed out of the dog, onto the lawn and out of reach.
    expect((y.painters[0]?.z ?? 0) - FENCE.z).toBeGreaterThan(FENCE.dog.dz);
    expect(boardsOf(y, 0)).toBe(0);
  });

  it('walking past wakes the dog (once it has napped a while), and it wanders off to nap somewhere else', () => {
    const y = yard();
    y.dog.t = 0;
    place(y, 0, -3, LANE + 0.3);
    // Walking past straight away: it's only just settled.
    run(y, sticks({ 0: { x: 1, y: 0 } }), 1.4);
    expect(y.dog.state).toBe('nap');
    // Later on, walking past again wakes it.
    run(y, sticks({}), FENCE.dog.calm);
    place(y, 0, -2.5, LANE + 0.3);
    const all = run(y, sticks({ 0: { x: 1, y: 0 } }), 2);
    expect(all.woke).toBe(1);
    expect(y.dog.state).not.toBe('nap');
    expect(blocked(y, boardAt(0))).toBe(false);
    run(y, sticks({}), 12);
    expect(y.dog.state).toBe('nap');
    expect(Math.abs(y.dog.x)).toBeGreaterThan(2);
    expect(Math.abs(y.dog.x)).toBeLessThanOrEqual(FENCE.dog.range);
  });

  it('stays in the yard: off the fence, inside the ends and the front', () => {
    const y = yard();
    run(y, sticks({ 0: { x: -1, y: 1 }, 2: { x: 1, y: -1 } }), 4);
    expect(y.painters[0]?.x).toBeGreaterThanOrEqual(-FENCE_HALF - 0.6 - 1e-9);
    expect(y.painters[0]?.z).toBeGreaterThanOrEqual(FENCE.z + FENCE.near - 1e-9);
    expect(y.painters[2]?.z).toBeLessThanOrEqual(FENCE.front + 1e-9);
  });

  it('ends after the time', () => {
    const y = yard();
    run(y, sticks({}), FENCE.duration + 0.2);
    expect(isOver(y)).toBe(true);
    expect(y.time).toBeCloseTo(FENCE.duration);
  });
});

/** A whole game between computer pairs. */
function game(skills: number[], seed: number): Yard {
  const rng = createRng(seed * 7919);
  const y = newYard(TEAMS, 4, createRng(seed));
  const cpus = skills.map(() => newCpuPainter());
  while (!isOver(y)) {
    stepYard(
      y,
      cpus.map((c, p) => cpuStick(c, y, p, DT, skills[p] ?? 0.5, rng)),
      DT,
    );
  }
  return y;
}

describe('paint the fence computer players', () => {
  it('evenly matched pairs paint most of the fence and either side can win', () => {
    const wins = [0, 0];
    let painted = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const y = game([0.5, 0.5, 0.5, 0.5], seed);
      const a = boardsOf(y, 0);
      const b = boardsOf(y, 1);
      painted += a + b;
      if (a > b) wins[0] = (wins[0] ?? 0) + 1;
      if (b > a) wins[1] = (wins[1] ?? 0) + 1;
      expect(y.painters.every((c) => c.boards > 8)).toBe(true);
    }
    expect(painted / 20).toBeGreaterThan(FENCE.boards * 0.8);
    expect(wins[0]).toBeGreaterThan(4);
    expect(wins[1]).toBeGreaterThan(4);
  });

  it('sharp pairs beat sleepy ones, and sleepy ones still hold some of the fence', () => {
    let sharpWins = 0;
    let sleepy = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const y = game([1, 1, 0, 0], seed);
      if (boardsOf(y, 0) > boardsOf(y, 1)) sharpWins++;
      sleepy += boardsOf(y, 1);
    }
    expect(sharpWins).toBeGreaterThanOrEqual(17);
    expect(sleepy / 20).toBeGreaterThan(4);
  });

  it('an average pair beats a sleepy one more often than not, but not every time', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const y = game([0.5, 0.5, 0.1, 0.1], seed);
      if (boardsOf(y, 0) > boardsOf(y, 1)) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(17);
    expect(wins).toBeLessThanOrEqual(29);
  });
});
