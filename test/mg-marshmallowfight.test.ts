import { describe, expect, it } from 'vitest';
import {
  IDLE,
  MALLOW,
  type Stick,
  type Yard,
  clearShot,
  cpuStick,
  isOver,
  mallowScores,
  newCpuCamper,
  newYard,
  stepYard,
  throwAngle,
} from '../src/game/minigames/marshmallowfight';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;
const TEAMS = [
  [0, 1],
  [2, 3],
];

function sticks(over: Partial<Record<number, Stick>>): Stick[] {
  return [0, 1, 2, 3].map((p) => over[p] ?? IDLE);
}

/** Puts a camper somewhere, standing still. */
function place(y: Yard, p: number, x: number, z: number): void {
  const c = y.campers[p];
  if (!c) throw new Error('no camper');
  c.x = x;
  c.z = z;
  c.vx = 0;
  c.vz = 0;
}

/** Steps until nothing is in the air any more (or a few seconds pass). */
function settle(y: Yard, inputs: Stick[] = sticks({})): void {
  for (let i = 0; i < 240 && (i === 0 || y.mallows.length > 0); i++) stepYard(y, inputs, DT);
}

describe('marshmallow fight', () => {
  it('starts each pair on its own side, facing across', () => {
    const y = newYard(TEAMS, 4);
    expect(y.teamOf).toEqual([0, 0, 1, 1]);
    expect(y.campers[0]?.x).toBeLessThan(-MALLOW.chairX);
    expect(y.campers[2]?.x).toBeGreaterThan(MALLOW.chairX);
    expect(y.campers[0]?.fx).toBe(1);
    expect(y.campers[3]?.fx).toBe(-1);
    expect(y.chairs.length).toBe(MALLOW.chairZ.length * 2);
  });

  it('runs where the stick points (up on the phone is away from the TV) and never crosses the middle', () => {
    const y = newYard(TEAMS, 4);
    const z0 = y.campers[0]?.z ?? 0;
    for (let i = 0; i < 20; i++) stepYard(y, sticks({ 0: { x: 0, y: 1, a: false } }), DT);
    expect(y.campers[0]?.z).toBeLessThan(z0);
    for (let i = 0; i < 300; i++) stepYard(y, sticks({ 0: { x: 1, y: 0, a: false }, 2: { x: -1, y: 0, a: false } }), DT);
    expect(y.campers[0]?.x).toBeLessThanOrEqual(-MALLOW.middle + 1e-9);
    expect(y.campers[2]?.x).toBeGreaterThanOrEqual(MALLOW.middle - 1e-9);
    for (let i = 0; i < 300; i++) stepYard(y, sticks({ 1: { x: 0, y: -1, a: false } }), DT);
    expect(y.campers[1]?.z).toBeLessThanOrEqual(MALLOW.half.z + 1e-9);
  });

  it('cannot run through a lawn chair', () => {
    const y = newYard(TEAMS, 4);
    place(y, 0, -5, 0);
    for (let i = 0; i < 200; i++) stepYard(y, sticks({ 0: { x: 1, y: 0, a: false } }), DT);
    const c = y.campers[0];
    expect(c?.x).toBeLessThanOrEqual(-MALLOW.chairX - MALLOW.chairHalf.x - MALLOW.bodyR + 1e-6);
  });

  it('throws on a fresh press, then has to reload', () => {
    const y = newYard(TEAMS, 4);
    stepYard(y, sticks({}), 0.5);
    const press = sticks({ 0: { x: 0, y: 0, a: true } });
    let thrown = stepYard(y, press, DT).thrown.length;
    for (let i = 0; i < 60; i++) thrown += stepYard(y, press, DT).thrown.length;
    expect(thrown).toBe(1); // holding the button doesn't keep throwing
    expect(y.campers[0]?.throws).toBe(1);
    stepYard(y, sticks({}), DT);
    // Pressed again just before the reload ends: it throws as soon as it's ready.
    const y2 = newYard(TEAMS, 4);
    stepYard(y2, sticks({}), 0.5);
    stepYard(y2, press, DT);
    stepYard(y2, sticks({}), MALLOW.reload - MALLOW.queue / 2);
    let late = stepYard(y2, press, DT).thrown.length;
    for (let i = 0; i < 20; i++) late += stepYard(y2, sticks({}), DT).thrown.length;
    expect(late).toBe(1);
    // Pressed long before the reload ends: nothing.
    const y3 = newYard(TEAMS, 4);
    stepYard(y3, sticks({}), 0.5);
    stepYard(y3, press, DT);
    stepYard(y3, sticks({}), DT);
    let early = stepYard(y3, press, DT).thrown.length;
    for (let i = 0; i < 60; i++) early += stepYard(y3, sticks({}), DT).thrown.length;
    expect(early).toBe(0);
  });

  it('a hit sticks, scores for the thrower’s team and leaves the target briefly un-hittable', () => {
    const y = newYard(TEAMS, 4);
    place(y, 0, -2, 1.1);
    place(y, 2, 2, 1.1);
    place(y, 1, -6, -3);
    place(y, 3, 6, -3);
    stepYard(y, sticks({}), 0.5);
    stepYard(y, sticks({ 0: { x: 0, y: 0, a: true } }), DT);
    let hits = 0;
    for (let i = 0; i < 60; i++) hits += stepYard(y, sticks({}), DT).hits.length;
    expect(hits).toBe(1);
    expect(y.score).toEqual([1, 0]);
    expect(y.campers[2]?.splats).toBe(1);
    expect(y.campers[0]?.hits).toBe(1);
    expect(mallowScores(y, TEAMS, 4)).toEqual([1, 1, 0, 0]);
  });

  it('chairs stop marshmallows, but you can lob one over the chair you hide behind', () => {
    // Straight at someone crouched behind a chair on the far side: blocked.
    const y = newYard(TEAMS, 4);
    place(y, 0, -2, 0);
    place(y, 2, MALLOW.chairX + 1, 0);
    expect(clearShot(y, -2, 0, MALLOW.chairX + 1, 0)).toBe(false);
    stepYard(y, sticks({}), 0.5);
    stepYard(y, sticks({ 0: { x: 0, y: 0, a: true } }), DT);
    let blocked = 0;
    for (let i = 0; i < 90; i++) blocked += stepYard(y, sticks({}), DT).blocked.length;
    expect(blocked).toBe(1);
    expect(y.score).toEqual([0, 0]);
    // From right behind your own chair, over it, at someone out in the open: a hit.
    const y2 = newYard(TEAMS, 4);
    place(y2, 0, -MALLOW.chairX - MALLOW.chairHalf.x - MALLOW.bodyR - 0.01, 0);
    place(y2, 2, 2, 0);
    expect(clearShot(y2, y2.campers[0]?.x ?? 0, 0, 2, 0)).toBe(true);
    stepYard(y2, sticks({}), 0.5);
    stepYard(y2, sticks({ 0: { x: 0, y: 0, a: true } }), DT);
    settle(y2);
    expect(y2.score).toEqual([1, 0]);
  });

  it('flies past teammates', () => {
    const y = newYard(TEAMS, 4);
    place(y, 0, -6, 1.1);
    place(y, 1, -4.2, 1.1);
    place(y, 2, 6, -3);
    place(y, 3, 6, 3);
    stepYard(y, sticks({}), 0.5);
    stepYard(y, sticks({ 0: { x: 0, y: 0, a: true } }), DT);
    settle(y);
    expect(y.campers[1]?.splats).toBe(0);
    expect(y.score).toEqual([0, 0]);
  });

  it('aims where you face, kept to the forward arc, and bends onto someone nearly in line', () => {
    const y = newYard(TEAMS, 4);
    place(y, 0, -3, 0);
    place(y, 2, 5, 3);
    place(y, 3, 5, -3);
    const c = y.campers[0];
    if (!c) throw new Error('no camper');
    c.fx = 0;
    c.fz = 1; // facing the audience
    expect(throwAngle(y, 0)).toBeCloseTo(MALLOW.maxAngle);
    c.fx = -1;
    c.fz = 0; // facing away from the other side: straight across
    expect(throwAngle(y, 0)).toBeCloseTo(0);
    const at = Math.atan2(3, 8);
    c.fx = Math.cos(at + 0.1);
    c.fz = Math.sin(at + 0.1);
    expect(throwAngle(y, 0)).toBeCloseTo(at); // assisted onto the camper at (5, 3)
  });

  it('ends after the time', () => {
    const y = newYard(TEAMS, 4);
    for (let i = 0; i < MALLOW.duration * 60 + 5; i++) stepYard(y, sticks({}), DT);
    expect(isOver(y)).toBe(true);
    expect(y.time).toBeCloseTo(MALLOW.duration);
  });
});

/** A whole game between computer pairs. */
function game(skills: number[], seed: number): Yard {
  const rng = createRng(seed);
  const y = newYard(TEAMS, 4);
  const cpus = skills.map(() => newCpuCamper());
  while (!isOver(y)) {
    stepYard(
      y,
      cpus.map((c, p) => cpuStick(c, y, p, DT, skills[p] ?? 0.5, rng)),
      DT,
    );
  }
  return y;
}

describe('marshmallow fight computer players', () => {
  it('evenly matched pairs land a fair number of hits and either side can win', () => {
    let wins = [0, 0];
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const y = game([0.5, 0.5, 0.5, 0.5], seed);
      total += y.score[0] + y.score[1];
      if (y.score[0] > y.score[1]) wins = [(wins[0] ?? 0) + 1, wins[1] ?? 0];
      if (y.score[1] > y.score[0]) wins = [wins[0] ?? 0, (wins[1] ?? 0) + 1];
    }
    const perTeam = total / 40;
    expect(perTeam).toBeGreaterThan(6);
    expect(perTeam).toBeLessThan(22);
    expect(wins[0]).toBeGreaterThan(4);
    expect(wins[1]).toBeGreaterThan(4);
  });

  it('sharp pairs beat sleepy ones, and sleepy ones still land a few', () => {
    let sharpWins = 0;
    let sleepyHits = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const y = game([1, 1, 0, 0], seed);
      if (y.score[0] > y.score[1]) sharpWins++;
      sleepyHits += y.score[1];
    }
    expect(sharpWins).toBeGreaterThanOrEqual(18);
    expect(sleepyHits / 20).toBeGreaterThan(2);
  });
});
