import { describe, expect, it } from 'vitest';
import { COLLIDERS, IDLE, PROPS, type Stick, TICKLE, type Yard, canFree, clearance, cpuStick, frozenCount, isOver, newBrain, newYard, stepYard, tickleScores } from '../src/game/minigames/tickletag';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;
const sticks = (over: Record<number, Stick>): Stick[] => [0, 1, 2, 3].map((s) => over[s] ?? IDLE);
const body = (y: Yard, s: number) => {
  const b = y.bodies[s];
  if (!b) throw new Error(`no body for seat ${s}`);
  return b;
};

/** A CPU-vs-CPU game. Frames vary in length, as on a real TV. */
function play(seed: number, monsterSkill: number, runnerSkill: number) {
  const rng = createRng(seed);
  const y = newYard(4, 0, [1, 2, 3]);
  const brains = [0, 1, 2, 3].map((s) => newBrain(s === 0 ? monsterSkill : runnerSkill, rng));
  let frames = 0;
  while (!isOver(y) && frames++ < 20_000) {
    const dt = DT * (0.6 + rng() * 0.9);
    stepYard(
      y,
      brains.map((b, s) => cpuStick(y, s, b, rng)),
      dt,
    );
  }
  return y;
}

function monsterWins(monsterSkill: number, runnerSkill: number, games = 60, from = 1): number {
  let wins = 0;
  for (let seed = from; seed < from + games; seed++) if (play(seed, monsterSkill, runnerSkill).caughtAt !== null) wins++;
  return wins / games;
}

describe('tickle monster', () => {
  it('starts everyone on open lawn, with the monster well away from the three', () => {
    const y = newYard(4, 2, [0, 1, 3]);
    for (const b of y.bodies) expect(clearance(b.x, b.z, b.r)).toBeGreaterThan(0);
    const m = body(y, 2);
    expect(m.r).toBe(TICKLE.monsterR);
    for (const s of y.runners) {
      const r = body(y, s);
      expect(r.r).toBe(TICKLE.runnerR);
      expect(Math.hypot(r.x - m.x, r.z - m.z)).toBeGreaterThan(4);
    }
  });

  it('runs where the stick points (up on the phone is away from the TV), the monster a bit faster', () => {
    const y = newYard(4, 0, [1, 2, 3]);
    const r = body(y, 2);
    const m = body(y, 0);
    const [rz, mx] = [r.z, m.x];
    const rx = r.x;
    stepYard(y, sticks({ 2: { x: 0, y: 1, a: false }, 0: { x: 1, y: 0, a: false } }), 0.5);
    expect(r.z).toBeLessThan(rz);
    expect(Math.abs(r.x - rx)).toBeLessThan(1e-9);
    expect(m.x - mx).toBeGreaterThan(rz - r.z);
  });

  it('steps in fixed 1/120 s steps, carrying the rest over', () => {
    const y = newYard(4, 0, [1, 2, 3]);
    stepYard(y, sticks({}), 0.004);
    expect(y.time).toBe(0);
    stepYard(y, sticks({}), 0.005);
    expect(y.time).toBeCloseTo(TICKLE.step, 9);
    stepYard(y, sticks({}), 0.5);
    expect(y.time).toBeCloseTo(Math.floor((0.509 + 1e-9) / TICKLE.step) * TICKLE.step, 9);
  });

  it('keeps everyone on the lawn and out of the garden furniture', () => {
    const y = newYard(4, 0, [1, 2, 3]);
    const pushes: Stick[] = [
      { x: -1, y: 1, a: false },
      { x: 1, y: -1, a: false },
      { x: 0.3, y: 1, a: false },
      { x: -1, y: -0.2, a: false },
    ];
    for (let i = 0; i < 60 * 8; i++) {
      stepYard(y, sticks({ 0: pushes[(i >> 6) % 4] as Stick, 1: pushes[(i >> 5) % 4] as Stick, 2: pushes[((i >> 6) + 1) % 4] as Stick, 3: pushes[((i >> 6) + 2) % 4] as Stick }), DT);
      for (const b of y.bodies) expect(clearance(b.x, b.z, b.r)).toBeGreaterThan(-1e-6);
    }
    expect(COLLIDERS.length).toBe(Object.keys(PROPS).length);
  });

  it('freezes a runner the monster touches, and they stay put', () => {
    const y = newYard(4, 0, [1, 2, 3]);
    const m = body(y, 0);
    const r = body(y, 1);
    m.x = r.x + 2;
    m.z = r.z;
    let ev = stepYard(y, sticks({ 0: { x: -1, y: 0, a: false } }), 0.6);
    expect(ev.tickled).toEqual([1]);
    expect(r.frozen).toBe(true);
    expect(r.tickles).toBe(1);
    expect(m.tickles).toBe(1);
    const at = [r.x, r.z];
    // Pushing into a frozen runner doesn't move them, and they can't be tickled twice.
    ev = stepYard(y, sticks({ 0: { x: -1, y: 0, a: false }, 1: { x: 1, y: 1, a: true } }), 0.5);
    expect(ev.tickled).toEqual([]);
    expect([r.x, r.z]).toEqual(at);
  });

  it('frees a frozen runner after 0.8 s of Free! next to them, not before, and not from too far away', () => {
    const y = newYard(4, 0, [1, 2, 3]);
    const f = body(y, 1);
    const h = body(y, 2);
    f.frozen = true;
    h.x = f.x + f.r + h.r + TICKLE.freeReach + 0.3;
    h.z = f.z;
    expect(canFree(y, 2, 1)).toBe(false);
    stepYard(y, sticks({ 2: { x: 0, y: 0, a: true } }), 1.5);
    expect(f.frozen).toBe(true);
    expect(f.thaw).toBe(0);

    h.x = f.x + f.r + h.r + 0.2;
    expect(canFree(y, 2, 1)).toBe(true);
    let ev = stepYard(y, sticks({ 2: { x: 0, y: 0, a: true } }), 0.7);
    expect(f.frozen).toBe(true);
    expect(f.helper).toBe(2);
    // Letting go drains it.
    stepYard(y, sticks({}), 0.1);
    expect(f.thaw).toBeLessThan(0.7 - 0.2);
    expect(f.helper).toBeNull();
    const before = f.thaw;
    ev = stepYard(y, sticks({ 2: { x: 0, y: 0, a: true } }), TICKLE.freeTime - before - 0.05);
    expect(f.frozen).toBe(true);
    ev = stepYard(y, sticks({ 2: { x: 0, y: 0, a: true } }), 0.1);
    expect(ev.freed).toEqual([{ seat: 1, by: 2 }]);
    expect(f.frozen).toBe(false);
    expect(f.immune).toBeGreaterThan(0);
    expect(h.frees).toBe(1);
  });

  it('gives a freed runner a moment before they can be tickled again', () => {
    const y = newYard(4, 0, [1, 2, 3]);
    const m = body(y, 0);
    const r = body(y, 1);
    r.immune = TICKLE.immune;
    m.x = r.x + m.r + r.r;
    m.z = r.z;
    expect(stepYard(y, sticks({}), 0.5).tickled).toEqual([]);
    expect(stepYard(y, sticks({ 0: { x: -1, y: 0, a: false } }), TICKLE.immune).tickled).toEqual([1]);
  });

  it('lets the monster win the moment all three are frozen at once', () => {
    const y = newYard(4, 3, [0, 1, 2]);
    body(y, 0).frozen = true;
    body(y, 1).frozen = true;
    expect(frozenCount(y)).toBe(2);
    const m = body(y, 3);
    const r = body(y, 2);
    m.x = r.x - 1.5;
    m.z = r.z;
    for (let i = 0; i < 60 && !isOver(y); i++) stepYard(y, sticks({ 3: { x: 1, y: 0, a: false } }), DT);
    expect(isOver(y)).toBe(true);
    expect(y.caughtAt).not.toBeNull();
    expect(tickleScores(y, 4)).toEqual([0, 0, 0, 1]);
  });

  it('gives the three the win when the time runs out, even with two frozen', () => {
    const y = newYard(4, 1, [0, 2, 3]);
    body(y, 0).frozen = true;
    body(y, 2).frozen = true;
    for (let i = 0; i < TICKLE.duration * 60 + 5; i++) stepYard(y, sticks({}), DT);
    expect(isOver(y)).toBe(true);
    expect(y.caughtAt).toBeNull();
    expect(tickleScores(y, 4)).toEqual([1, 0, 1, 1]);
  });

  it('works with fewer players', () => {
    const y = newYard(2, 1, [0]);
    const m = body(y, 1);
    const r = body(y, 0);
    m.x = r.x + 1.2;
    m.z = r.z;
    stepYard(y, [IDLE, { x: -1, y: 0, a: false }], 0.5);
    expect(y.caughtAt).not.toBeNull();
    expect(tickleScores(y, 2)).toEqual([0, 1]);
  });

  it('plays out with computer players: balanced at average skill, and sharpness matters on both sides', () => {
    const even = monsterWins(0.575, 0.575, 80);
    const sharpMonster = monsterWins(0.8, 0.35, 60, 200);
    const sleepyMonster = monsterWins(0.35, 0.8, 60, 400);
    expect(even).toBeGreaterThan(0.25);
    expect(even).toBeLessThan(0.75);
    expect(sharpMonster).toBeGreaterThan(sleepyMonster + 0.3);
    expect(monsterWins(0.575, 0.35, 60, 600)).toBeGreaterThan(monsterWins(0.575, 0.8, 60, 600));
    expect(monsterWins(0.8, 0.575, 60, 800)).toBeGreaterThan(monsterWins(0.35, 0.575, 60, 800));
  });

  it('has computer runners that actually free each other, and a monster that tickles', () => {
    let frees = 0;
    let tickles = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const y = play(seed, 0.6, 0.6);
      tickles += body(y, 0).tickles;
      for (const s of y.runners) frees += body(y, s).frees;
    }
    expect(tickles / 20).toBeGreaterThan(2);
    expect(frees / 20).toBeGreaterThan(1);
  });
});
