import { describe, expect, it } from 'vitest';
import { CONTACT, IDLE, SLICE, type Stick, cpuStick, isOver, newBrain, newKitchen, sliceScores, stepKitchen } from '../src/game/minigames/lastslice';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;
const sticks = (over: Record<number, Stick>): Stick[] => [0, 1, 2, 3].map((s) => over[s] ?? IDLE);

function run(seed: number, guardSkill: number, snackerSkill: number) {
  const rng = createRng(seed);
  const k = newKitchen(4, 0, [1, 2, 3]);
  const brains = [0, 1, 2, 3].map((s) => newBrain(k, s, s === 0 ? guardSkill : snackerSkill));
  let steps = 0;
  while (!isOver(k) && steps++ < 10_000) {
    stepKitchen(
      k,
      brains.map((b, s) => cpuStick(k, s, b, rng)),
      DT,
    );
  }
  return k;
}

describe('last slice', () => {
  it('starts with the guard by the plate and the snackers spread out', () => {
    const k = newKitchen(4, 2, [0, 1, 3]);
    const g = k.runners[2];
    expect(Math.hypot(g?.x ?? 9, g?.z ?? 9)).toBeLessThan(CONTACT + 1);
    for (const s of k.snackers) {
      const r = k.runners[s];
      expect(Math.hypot(r?.x ?? 0, r?.z ?? 0)).toBeGreaterThan(CONTACT + 1);
    }
  });

  it('runs where the stick points (up on the phone is away from the TV) and stays on the island', () => {
    const k = newKitchen(4, 0, [1, 2, 3]);
    const r = k.runners[1];
    const z0 = r?.z ?? 0;
    for (let i = 0; i < 30; i++) stepKitchen(k, sticks({ 1: { x: 0, y: 1, a: false } }), DT);
    expect(r?.z ?? 0).toBeLessThan(z0);
    for (let i = 0; i < 300; i++) stepKitchen(k, sticks({ 1: { x: -1, y: 1, a: false } }), DT);
    expect(r?.x).toBe(-SLICE.bounds.x);
    expect(r?.z).toBe(-SLICE.bounds.z);
  });

  it('never lets anyone stand on the plate', () => {
    const k = newKitchen(4, 0, [1, 2, 3]);
    for (let i = 0; i < 240; i++) stepKitchen(k, sticks({ 3: { x: 0, y: -1, a: false } }), DT);
    const r = k.runners[3];
    expect(Math.hypot(r?.x ?? 0, r?.z ?? 0)).toBeGreaterThanOrEqual(CONTACT - 1e-9);
  });

  it('lets a snacker who keeps touching the plate grab the slice', () => {
    const k = newKitchen(4, 0, [1, 2, 3]);
    let grabbed: number | null = null;
    for (let i = 0; i < 60 * 4 && grabbed === null; i++) grabbed = stepKitchen(k, sticks({ 3: { x: 0, y: -1, a: false } }), DT).grabbed;
    expect(grabbed).toBe(3);
    expect(isOver(k)).toBe(true);
    expect(sliceScores(k, 4)).toEqual([0, 1, 1, 1]);
  });

  it('nopes snackers in reach away, resets their grab, and needs a fresh press each time', () => {
    const k = newKitchen(4, 0, [1, 2, 3]);
    const g = k.runners[0];
    const s = k.runners[3];
    if (!g || !s) throw new Error('missing runners');
    g.x = 0;
    g.z = -CONTACT - 0.1;
    s.x = 0.4;
    s.z = -CONTACT - 0.9;
    s.grab = 1;
    const ev = stepKitchen(k, sticks({ 0: { x: 0, y: 0, a: true } }), DT);
    expect(ev.nope).toEqual([3]);
    expect(s.grab).toBe(0);
    expect(s.stun).toBeGreaterThan(0);
    const before = Math.hypot(s.x - g.x, s.z - g.z);
    for (let i = 0; i < 30; i++) stepKitchen(k, sticks({ 0: { x: 0, y: 0, a: true } }), DT);
    expect(Math.hypot(s.x - g.x, s.z - g.z)).toBeGreaterThan(before + 1);
    // Still holding the button after the cooldown: no second nope.
    let again = false;
    for (let i = 0; i < 90; i++) again ||= stepKitchen(k, sticks({ 0: { x: 0, y: 0, a: true } }), DT).nope !== null;
    expect(again).toBe(false);
    stepKitchen(k, sticks({}), DT);
    expect(stepKitchen(k, sticks({ 0: { x: 0, y: 0, a: true } }), DT).nope).not.toBeNull();
  });

  it('gives the guard the win when time runs out', () => {
    const k = newKitchen(4, 1, [0, 2, 3]);
    for (let i = 0; i < SLICE.duration * 60 + 5; i++) stepKitchen(k, sticks({}), DT);
    expect(isOver(k)).toBe(true);
    expect(k.grabbedBy).toBeNull();
    expect(sliceScores(k, 4)).toEqual([0, 1, 0, 0]);
  });

  it('plays out with computer players, and sharpness matters on both sides', () => {
    let sharpGuard = 0;
    let sleepyGuard = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = run(seed, 1, 0);
      const b = run(seed, 0, 1);
      expect(isOver(a)).toBe(true);
      expect(isOver(b)).toBe(true);
      if (a.grabbedBy === null) sharpGuard++;
      if (b.grabbedBy === null) sleepyGuard++;
    }
    expect(sharpGuard).toBeGreaterThan(sleepyGuard + 10);
  });
});
