import { describe, expect, it } from 'vitest';
import {
  OBSTACLES,
  TAG,
  type Yard,
  chasingIn,
  cpuTag,
  isChaser,
  newCpuTagger,
  newYard,
  pressTag,
  roundOver,
  startRound,
  stepYard,
  tagDetail,
  tagScores,
} from '../src/game/minigames/glowtag';
import { createRng } from '../src/game/rng';

const TEAMS = [
  [0, 2],
  [1, 3],
];

/** Puts player p at (x, z), standing still. */
function put(y: Yard, p: number, x: number, z: number): void {
  const me = y.players[p];
  if (!me) throw new Error('no player');
  me.x = x;
  me.z = z;
  me.vx = me.vz = 0;
}

const still = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));

describe('glow tag: the garden', () => {
  it('starts with the chasers on one side and the runners on the other, swapping every round', () => {
    const y = newYard(TEAMS, 4, 0);
    expect(y.chasing).toBe(0);
    expect(isChaser(y, 0)).toBe(true);
    expect(isChaser(y, 1)).toBe(false);
    const chaserSide = Math.sign(y.players[0]?.x ?? 0);
    expect(Math.sign(y.players[2]?.x ?? 0)).toBe(chaserSide);
    expect(Math.sign(y.players[1]?.x ?? 0)).toBe(-chaserSide);
    startRound(y, 1);
    expect(y.chasing).toBe(1);
    // Now team 1 chases, from the other side of the garden.
    expect(Math.sign(y.players[1]?.x ?? 0)).toBe(-chaserSide);
    expect(Math.sign(y.players[0]?.x ?? 0)).toBe(chaserSide);
    expect(y.clock).toBe(0);
  });

  it('gives each team two turns at being it', () => {
    const turns = [0, 1, 2, 3].map((r) => chasingIn(1, r));
    expect(turns).toEqual([1, 0, 1, 0]);
    expect(TAG.rounds * TAG.round).toBe(60);
  });

  it('moves with the stick (up on the phone is away from the camera) and stays inside the fence', () => {
    const y = newYard(TEAMS, 4, 0);
    put(y, 1, 0, -2.5);
    const sticks = still.map(() => ({ x: 0, y: 0 }));
    sticks[1] = { x: 0, y: 1 };
    stepYard(y, sticks, 0.5);
    expect(y.players[1]?.z ?? 0).toBeLessThan(-2.5);
    stepYard(y, sticks, 3);
    expect(y.players[1]?.z ?? 0).toBeCloseTo(-(TAG.halfD - TAG.body), 5);
    sticks[1] = { x: 1, y: 0 };
    stepYard(y, sticks, 6);
    expect(y.players[1]?.x ?? 0).toBeCloseTo(TAG.halfW - TAG.body, 5);
  });

  it('keeps everyone out of the table and the bushes, and out of each other', () => {
    const y = newYard(TEAMS, 4, 0);
    const table = OBSTACLES[0];
    put(y, 1, table.x + 2, table.z);
    const sticks = still.map(() => ({ x: 0, y: 0 }));
    sticks[1] = { x: -1, y: 0 };
    stepYard(y, sticks, 2);
    const me = y.players[1];
    expect(Math.hypot((me?.x ?? 0) - table.x, (me?.z ?? 0) - table.z)).toBeGreaterThanOrEqual(table.r + TAG.body - 1e-6);
    put(y, 0, 4, 3);
    put(y, 2, 4.1, 3);
    stepYard(y, still, 0.05);
    expect(Math.hypot((y.players[0]?.x ?? 0) - (y.players[2]?.x ?? 0), (y.players[0]?.z ?? 0) - (y.players[2]?.z ?? 0))).toBeGreaterThan(2 * TAG.body - 0.01);
  });

  it('lets runners run a touch faster than chasers', () => {
    expect(TAG.runner).toBeGreaterThan(TAG.chaser);
  });
});

describe('glow tag: tagging', () => {
  it('tags a runner in reach: their glow stick dims, and the chasers score', () => {
    const y = newYard(TEAMS, 4, 0);
    put(y, 0, 0, 2.5);
    put(y, 1, 0.7, 2.5);
    expect(pressTag(y, 0)).toEqual({ kind: 'tag', runner: 1 });
    expect(y.players[1]?.dim).toBe(TAG.dim);
    expect(y.score).toEqual([1, 0]);
    expect(y.players[0]?.tags).toBe(1);
    expect(y.players[1]?.caught).toBe(1);
  });

  it('misses a runner out of reach, and then has to wait a moment', () => {
    const y = newYard(TEAMS, 4, 0);
    put(y, 0, 0, 2.5);
    put(y, 1, TAG.reach + 0.2, 2.5);
    expect(pressTag(y, 0)).toEqual({ kind: 'whiff' });
    put(y, 1, 0.5, 2.5);
    expect(pressTag(y, 0)).toEqual({ kind: 'cool' });
    stepYard(y, still, TAG.cooldown + 0.02);
    put(y, 1, 0.5, 2.5);
    expect(pressTag(y, 0).kind).toBe('tag');
  });

  it('cannot tag a dim runner again, and the glow comes back after a few seconds', () => {
    const y = newYard(TEAMS, 4, 0);
    put(y, 0, 0, 2.5);
    put(y, 1, 0.6, 2.5);
    put(y, 3, -4, -3);
    expect(pressTag(y, 0).kind).toBe('tag');
    stepYard(y, still, TAG.cooldown + 0.05);
    put(y, 1, 0.6, 2.5);
    expect(pressTag(y, 0)).toEqual({ kind: 'whiff' });
    const lit = stepYard(y, still, TAG.dim);
    expect(lit).toContain(1);
    expect(y.players[1]?.dim).toBe(0);
  });

  it('tags the nearest runner when two are in reach', () => {
    const y = newYard(TEAMS, 4, 0);
    put(y, 0, 0, 0 + 2.5);
    put(y, 1, 0.75, 2.5);
    put(y, 3, -0.65, 2.5);
    expect(pressTag(y, 0)).toEqual({ kind: 'tag', runner: 3 });
  });

  it('ignores runners pressing, and teammates are never tagged', () => {
    const y = newYard(TEAMS, 4, 0);
    put(y, 1, 0, 2.5);
    put(y, 0, 0.5, 2.5);
    expect(pressTag(y, 1)).toEqual({ kind: 'runner' });
    put(y, 2, 0.5, 2.9);
    put(y, 0, 4, -3);
    put(y, 3, -4, -3);
    put(y, 1, -4, 3);
    expect(pressTag(y, 2)).toEqual({ kind: 'whiff' });
  });

  it('judges a late press where the phone saw it', () => {
    const y = newYard(TEAMS, 4, 0);
    put(y, 0, 0, 2.5);
    put(y, 1, 0.7, 2.5);
    put(y, 3, -5, -3);
    // The runner dashes off; the press left the phone while they were still in reach.
    const sticks = still.map(() => ({ x: 0, y: 0 }));
    sticks[1] = { x: 1, y: 0 };
    stepYard(y, sticks, 0.15);
    const gap = Math.hypot((y.players[1]?.x ?? 0) - (y.players[0]?.x ?? 0), (y.players[1]?.z ?? 0) - (y.players[0]?.z ?? 0));
    expect(gap).toBeGreaterThan(TAG.reach);
    const copy = structuredClone(y);
    expect(pressTag(copy, 0, 0).kind).toBe('whiff');
    expect(pressTag(y, 0, 0.14).kind).toBe('tag');
  });

  it('ends a round after fifteen seconds and gives both partners the team’s tags', () => {
    const y = newYard(TEAMS, 4, 0);
    stepYard(y, still, TAG.round - 0.1);
    expect(roundOver(y)).toBe(false);
    stepYard(y, still, 0.1);
    expect(roundOver(y)).toBe(true);
    y.score = [5, 3];
    expect(tagScores(y)).toEqual([5, 3, 5, 3]);
    (y.players[0] as { tags: number }).tags = 3;
    (y.players[0] as { caught: number }).caught = 2;
    expect(tagDetail(y, 0)).toBe('5 team tags · 3 by you · tagged 2 times');
    expect(tagDetail(y, 3)).toBe('3 team tags · 0 by you · never tagged');
  });

  it('copes with a team of one', () => {
    const y = newYard([[0], [1, 2]], 3, 0);
    expect(y.players.map((p) => p.team)).toEqual([0, 1, 1]);
    stepYard(y, still, 1);
    expect(tagScores(y)).toEqual([0, 0, 0]);
  });
});

describe('glow tag: computer players', () => {
  function game(chase: number, run: number, seed: number) {
    const rng = createRng(seed);
    const y = newYard(TEAMS, 4, 0);
    // Only the rounds where team 0 chases: the chasers have `chase` skill, the runners `run`.
    const dt = 1 / 30;
    let tags = 0;
    for (let r = 0; r < TAG.rounds; r += 2) {
      startRound(y, r);
      const cpus = y.players.map((_, p) => newCpuTagger(isChaser(y, p) ? chase : run, rng));
      while (!roundOver(y)) {
        const inputs = cpus.map((c, p) => cpuTag(c, y, p, rng, dt));
        inputs.forEach((i, p) => {
          if (i.a && pressTag(y, p).kind === 'tag') tags += 1;
        });
        stepYard(y, inputs, dt);
      }
    }
    return tags / 2;
  }
  const average = (chase: number, run: number) => {
    let sum = 0;
    for (let seed = 1; seed <= 16; seed++) sum += game(chase, run, seed * 7);
    return sum / 16;
  };

  it('chase better when sharp, and get away better when sharp', () => {
    const mid = average(0.55, 0.55);
    expect(average(1, 0.55)).toBeGreaterThan(mid);
    expect(average(0.55, 1)).toBeLessThan(mid);
    expect(average(0, 0.55)).toBeLessThan(mid);
  });

  it('make a few tags a round, never a walkover', () => {
    const mid = average(0.55, 0.55);
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(6);
    // Even sharp chasers can't tag faster than glow sticks come back on.
    expect(average(1, 0)).toBeLessThanOrEqual((TAG.round / TAG.dim) * 2);
  });

  it('only chasers press Tag', () => {
    const rng = createRng(3);
    const y = newYard(TEAMS, 4, 0);
    const cpus = y.players.map(() => newCpuTagger(0.6, rng));
    let runnerPresses = 0;
    for (let i = 0; i < 300; i++) {
      const inputs = cpus.map((c, p) => cpuTag(c, y, p, rng, 1 / 30));
      inputs.forEach((s, p) => {
        if (s.a && !isChaser(y, p)) runnerPresses += 1;
        if (s.a) pressTag(y, p);
        expect(Math.hypot(s.x, s.y)).toBeLessThan(1.5);
      });
      stepYard(y, inputs, 1 / 30);
    }
    expect(runnerPresses).toBe(0);
  });
});
