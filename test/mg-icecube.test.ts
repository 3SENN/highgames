import { describe, expect, it } from 'vitest';
import {
  type Cube,
  ICE,
  type IceLane,
  bestCube,
  cpuDelay,
  cpuFlick,
  cubePoints,
  flickFor,
  frictionOf,
  glide,
  iceDetail,
  iceScores,
  isMoving,
  laneMoving,
  laneTotal,
  newLane,
  roundsLine,
  scoreRound,
  stepLane,
  throwCube,
} from '../src/game/minigames/icecube';
import { createRng } from '../src/game/rng';

/** Steps a lane until everything has stopped. */
function settle(lane: IceLane): void {
  for (let t = 0; t < 15 && laneMoving(lane); t += 1 / 30) stepLane(lane, 1 / 30);
}

/** A cube resting somewhere on the lane. */
function resting(lane: IceLane, z: number, size: number = ICE.size, x = 0): Cube {
  const c: Cube = { x, z, vx: 0, vz: 0, size, spin: 0, angle: 0, round: 0, gone: null };
  lane.cubes.push(c);
  return c;
}

describe('ice cube curling', () => {
  it('slides further the faster the flick: lazy ones stop short, wild ones end up in the sink', () => {
    expect(glide(0.1)).toBeLessThan(ICE.coaster - ICE.rim);
    expect(glide(0.3)).toBeLessThan(glide(0.6));
    expect(glide(1)).toBe(Infinity);
    const lane = newLane();
    const c = throwCube(lane, 1, 0, 0);
    const events: string[] = [];
    for (let t = 0; t < 10; t += 0.1) events.push(...stepLane(lane, 0.1).map((e) => e.t));
    expect(c.gone).toBe('sink');
    expect(events).toContain('sink');
    expect(cubePoints(c)).toBe(0);
  });

  it('has a flick that lands a lone cube in the bullseye, and a fair window for the coaster', () => {
    const ideal = flickFor(ICE.coaster);
    const lane = newLane();
    const c = throwCube(lane, ideal, 0, 0);
    settle(lane);
    expect(cubePoints(c)).toBe(3);
    // Room to be a little off and still land on the coaster.
    expect(flickFor(ICE.coaster + ICE.rim) - flickFor(ICE.coaster - ICE.rim)).toBeGreaterThan(0.15);
  });

  it('scores 3, 2, 1 or 0 by how close a cube is to the centre', () => {
    const lane = newLane();
    expect(cubePoints(resting(lane, ICE.coaster + 0.1))).toBe(3);
    expect(cubePoints(resting(lane, ICE.coaster, ICE.size, 0.5))).toBe(2);
    expect(cubePoints(resting(lane, ICE.coaster - 1))).toBe(1);
    expect(cubePoints(resting(lane, ICE.coaster + 2))).toBe(0);
  });

  it('gives a smaller, more melted cube less friction, so the same push slides it further', () => {
    const fresh: Cube = { x: 0, z: 0, vx: 0, vz: 5, size: ICE.size, spin: 0, angle: 0, round: 0, gone: null };
    const small: Cube = { ...fresh, size: 0.25 };
    expect(frictionOf(small)).toBeLessThan(frictionOf(fresh));
    const a = newLane();
    const b = newLane();
    a.cubes.push(fresh);
    b.cubes.push(small);
    settle(a);
    settle(b);
    expect(small.z).toBeGreaterThan(fresh.z + 0.5);
  });

  it('melts cubes away over time, and a melted cube scores nothing', () => {
    const lane = newLane();
    const c = resting(lane, ICE.coaster);
    expect(scoreRound(lane, 0)).toBe(3);
    stepLane(lane, 5);
    expect(c.size).toBeLessThan(ICE.size);
    expect(cubePoints(c)).toBe(3);
    const events = stepLane(lane, (ICE.size - ICE.gone) / ICE.melt);
    expect(events.some((e) => e.t === 'melted')).toBe(true);
    expect(c.gone).toBe('melted');
    expect(bestCube(lane)).toBeNull();
    expect(scoreRound(lane, 1)).toBe(0);
  });

  it('knocks a resting cube on when a new one hits it head on', () => {
    const lane = newLane();
    const old = resting(lane, 6);
    const c = throwCube(lane, flickFor(ICE.coaster), 0, 1);
    const events: string[] = [];
    for (let t = 0; t < 10 && laneMoving(lane); t += 1 / 30) events.push(...stepLane(lane, 1 / 30).map((e) => e.t));
    expect(events).toContain('knock');
    expect(old.z).toBeGreaterThan(7);
    expect(c.z).toBeLessThan(old.z);
    expect(isMoving(old)).toBe(false);
  });

  it('keeps cubes inside their lane', () => {
    const lane = newLane();
    const c = throwCube(lane, 0.5, 1, 0);
    c.vx = 3;
    settle(lane);
    expect(Math.abs(c.x)).toBeLessThanOrEqual(ICE.lane / 2);
  });

  it('scores each round from the best cube on the counter and adds the rounds up', () => {
    const lane = newLane();
    resting(lane, ICE.coaster - 0.9);
    expect(scoreRound(lane, 0)).toBe(1);
    resting(lane, ICE.coaster + 0.05);
    expect(scoreRound(lane, 1)).toBe(3);
    expect(roundsLine(lane)).toBe('1 + 3 = 4');
    expect(scoreRound(lane, 2)).toBe(3);
    expect(laneTotal(lane)).toBe(7);
    expect(iceDetail(lane)).toBe('7 pts (1 · 3 · 3)');
    expect(iceScores([lane, newLane()])).toEqual([7, 0]);
    expect(roundsLine(newLane())).toBe('–');
  });

  it('has sharp computer players score well, and more than sleepy ones', () => {
    const play = (skill: number, seed: number) => {
      const rng = createRng(seed);
      const lane = newLane();
      for (let r = 0; r < ICE.rounds; r++) {
        stepLane(lane, cpuDelay(skill, rng));
        throwCube(lane, cpuFlick(skill, rng), rng() * 2 - 1, r);
        settle(lane);
        scoreRound(lane, r);
        stepLane(lane, 2);
      }
      return laneTotal(lane);
    };
    const games = 40;
    let sleepy = 0;
    let average = 0;
    let sharp = 0;
    for (let seed = 1; seed <= games; seed++) {
      sleepy += play(0, seed) / games;
      average += play(0.5, seed) / games;
      sharp += play(1, seed) / games;
    }
    expect(sharp).toBeGreaterThan(6.5);
    expect(sharp).toBeGreaterThan(average + 1);
    expect(average).toBeGreaterThan(sleepy);
    expect(sleepy).toBeGreaterThan(2);
  });
});
