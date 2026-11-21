import { describe, expect, it } from 'vitest';
import {
  BOWL,
  ballLimit,
  ballWins,
  bowlScores,
  cpuShuffle,
  cpuSteer,
  gameOver,
  newBowlBrain,
  newLane,
  pinLimit,
  rollOver,
  startRoll,
  stepLane,
} from '../src/game/minigames/bowlingpins';
import { createRng } from '../src/game/rng';

const DT = 1 / 120;
const still = [0, 0, 0, 0];

function rollThrough(lane: ReturnType<typeof newLane>, steer: (t: number) => number, shuffle: number[] = still) {
  const knocks: number[] = [];
  while (!rollOver(lane)) knocks.push(...stepLane(lane, steer(lane.time), shuffle, DT).map((k) => k.seat));
  return knocks;
}

function play(seed: number, ballSkill: number, pinSkill: number) {
  const rng = createRng(seed);
  const lane = newLane(0, [1, 2, 3]);
  const ball = newBowlBrain(ballSkill);
  const pins = [1, 2, 3].map(() => newBowlBrain(pinSkill));
  for (let r = 0; r < BOWL.rolls; r++) {
    startRoll(lane);
    while (!rollOver(lane)) {
      const steer = cpuSteer(lane, ball, rng);
      const shuffle = [0, ...[1, 2, 3].map((s, k) => cpuShuffle(lane, s, pins[k] as ReturnType<typeof newBowlBrain>, rng))];
      stepLane(lane, steer, shuffle, DT);
    }
  }
  return lane;
}

describe('hallway bowling', () => {
  it('rolls the ball down the hallway in a few seconds, steering with the tilt and staying off the walls', () => {
    const lane = newLane(0, [1, 2, 3]);
    startRoll(lane);
    rollThrough(lane, () => 1);
    expect(lane.time).toBeGreaterThan(3);
    expect(lane.time).toBeLessThan(5);
    expect(lane.ball.x).toBe(ballLimit());
  });

  it('knocks over the pins it rolls into, and a falling pin takes down the one right behind it', () => {
    const lane = newLane(0, [1, 2, 3]);
    startRoll(lane);
    // The left back pin stands just behind the head pin, on the far side from the ball's line.
    const [, left] = lane.pins;
    if (!left) throw new Error('missing pin');
    left.x = 0.3;
    lane.ball.x = -0.8;
    const knocks = rollThrough(lane, () => 0);
    expect(knocks).toContain(1);
    expect(knocks).toContain(2);
    expect(lane.pins.find((p) => p.seat === 2)?.chained).toBe(true);
    expect(lane.perRoll).toEqual([knocks.length]);
  });

  it('lets pins shuffle sideways only, slowly, without walking through each other', () => {
    const lane = newLane(0, [1, 2, 3]);
    startRoll(lane);
    const right = lane.pins[2];
    const z = right?.z;
    for (let i = 0; i < 120; i++) stepLane(lane, 0, [0, 0, 0, -1], DT);
    // A second of shuffling covers about the pin speed.
    expect((right?.x ?? 0) - BOWL.spread).toBeLessThan(-BOWL.pinSpeed * 0.8);
    expect(right?.z).toBe(z);
    for (let i = 0; i < 240; i++) stepLane(lane, 0, [0, 0, 0, -1], DT);
    const left = lane.pins[1];
    expect(Math.abs((right?.x ?? 0) - (left?.x ?? 0))).toBeGreaterThanOrEqual(BOWL.pinR * 2 - 1e-9);
    expect(left?.x).toBeGreaterThanOrEqual(-pinLimit());
  });

  it('stands everyone back up for each of the three rolls, and the ball needs five pins to win', () => {
    const lane = newLane(2, [0, 1, 3]);
    for (let r = 0; r < BOWL.rolls; r++) {
      startRoll(lane);
      expect(lane.pins.every((p) => !p.down)).toBe(true);
      expect(lane.pins[0]?.x).toBe(0);
      rollThrough(lane, () => -1);
    }
    expect(gameOver(lane)).toBe(true);
    // Hugging the left wall only ever gets the left back pin.
    expect(lane.perRoll).toEqual([1, 1, 1]);
    expect(lane.total).toBe(3);
    expect(ballWins(lane)).toBe(false);
    expect(bowlScores(lane, 4)).toEqual([1, 1, 0, 1]);
    lane.total = BOWL.need;
    expect(bowlScores(lane, 4)).toEqual([0, 0, 1, 0]);
  });

  it('plays out with computer players: a contest at equal skill, and sharpness matters on both sides', () => {
    const N = 80;
    const ballRate = (b: number, p: number) => {
      let wins = 0;
      for (let seed = 1; seed <= N; seed++) {
        const lane = play(seed, b, p);
        expect(gameOver(lane)).toBe(true);
        if (ballWins(lane)) wins++;
      }
      return wins / N;
    };
    const even = ballRate(0.575, 0.575);
    expect(even).toBeGreaterThan(0.25);
    expect(even).toBeLessThan(0.75);
    expect(ballRate(0.8, 0.35)).toBeGreaterThan(ballRate(0.35, 0.35) + 0.15);
    expect(ballRate(0.35, 0.8)).toBeLessThan(ballRate(0.8, 0.8) - 0.15);
  });
});
