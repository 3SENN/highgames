import { describe, expect, it } from 'vitest';
import {
  BUNK,
  IDLE,
  type Stick,
  aimPoint,
  bunkScores,
  cpuKid,
  cpuTop,
  isOver,
  kidOf,
  newKidBrain,
  newRoom,
  newTopBrain,
  pillowPos,
  stepRoom,
  topWins,
} from '../src/game/minigames/topbunk';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;
const NO_AIM = { x: 0, z: 1.5, fire: false };
const sticks = (over: Record<number, Stick> = {}): Stick[] => [0, 1, 2, 3].map((s) => over[s] ?? IDLE);

/** Throws one pillow at (x, z) and steps until it has come down. */
function throwAt(r: ReturnType<typeof newRoom>, x: number, z: number, during: (i: number) => Stick[] = () => sticks(), lag: number[] = []) {
  while (r.reload > 0) stepRoom(r, { x, z, fire: false }, sticks(), DT);
  const bonked: number[] = [];
  const dodged: number[] = [];
  let ev = stepRoom(r, { x, z, fire: true }, during(0), DT, lag);
  for (let i = 1; i < 200 && (r.pillows.length || r.pending.length); i++) {
    bonked.push(...ev.bonked);
    dodged.push(...ev.dodged);
    ev = stepRoom(r, { x, z, fire: false }, during(i), DT, lag);
  }
  bonked.push(...ev.bonked);
  dodged.push(...ev.dodged);
  return { bonked, dodged };
}

function run(seed: number, top: number, floor: number) {
  const rng = createRng(seed);
  const r = newRoom(0, [1, 2, 3]);
  const tb = newTopBrain(top);
  const kb = [0, 1, 2, 3].map(() => newKidBrain(floor));
  let steps = 0;
  while (!isOver(r) && steps++ < 10_000) {
    const aim = cpuTop(r, tb, rng, DT);
    stepRoom(
      r,
      aim,
      [0, 1, 2, 3].map((s) => (s === 0 ? IDLE : cpuKid(r, s, kb[s] as ReturnType<typeof newKidBrain>, rng))),
      DT,
    );
  }
  return r;
}

describe('top bunk', () => {
  it('maps the phone pointer onto the floor: right is right, up is further back', () => {
    const c = aimPoint(0, 0);
    expect(aimPoint(1, 0).x).toBeGreaterThan(c.x + 3);
    expect(aimPoint(0, 1).z).toBeLessThan(c.z - 1);
    const far = aimPoint(1, -1);
    expect(far.x).toBeLessThanOrEqual(BUNK.floor.x + 0.3);
    expect(far.z).toBeLessThanOrEqual(BUNK.floor.front + 0.3);
  });

  it('loops pillows from the top bunk down to where it pointed', () => {
    const r = newRoom(0, [1, 2, 3]);
    while (r.reload > 0) stepRoom(r, NO_AIM, sticks(), DT);
    const ev = stepRoom(r, { x: 2, z: 2, fire: true }, sticks(), DT);
    const p = ev.thrown;
    if (!p) throw new Error('no throw');
    expect(pillowPos(p).y).toBeGreaterThan(2);
    p.age = p.flight / 2;
    expect(pillowPos(p).y).toBeGreaterThan(BUNK.landY + 0.5);
    p.age = p.flight;
    const end = pillowPos(p);
    expect(end.x).toBeCloseTo(2);
    expect(end.z).toBeCloseTo(2);
  });

  it('needs to reload between throws', () => {
    const r = newRoom(0, [1, 2, 3]);
    let thrown = 0;
    for (let i = 0; i < 60 * 2; i++) if (stepRoom(r, { x: 0, z: 1, fire: true }, sticks(), DT).thrown) thrown++;
    expect(thrown).toBeGreaterThanOrEqual(2);
    expect(thrown).toBeLessThanOrEqual(Math.ceil(2 / BUNK.reload) + 1);
  });

  it('bonks whoever stands where a pillow lands, costing a cushion', () => {
    const r = newRoom(0, [1, 2, 3]);
    const k = kidOf(r, 2);
    if (!k) throw new Error('missing kid');
    const { bonked } = throwAt(r, k.x + 0.5, k.z);
    expect(bonked).toEqual([2]);
    expect(k.lives).toBe(BUNK.lives - 1);
  });

  it('lets a duck save you unless the pillow lands dead centre', () => {
    const r = newRoom(0, [1, 2, 3]);
    const k = kidOf(r, 1);
    if (!k) throw new Error('missing kid');
    // Duck as the pillow comes down, 0.6 m off centre: saved.
    const duckLate = (i: number) => sticks(i > 25 && i < 30 ? { 1: { x: 0, y: 0, a: true } } : {});
    let res = throwAt(r, k.x + 0.6, k.z, duckLate);
    expect(res.bonked).toEqual([]);
    expect(res.dodged).toEqual([1]);
    expect(k.lives).toBe(BUNK.lives);
    // Dead centre: a duck doesn't help.
    for (let i = 0; i < 120; i++) stepRoom(r, NO_AIM, sticks(), DT);
    res = throwAt(r, k.x, k.z, duckLate);
    expect(res.bonked).toEqual([1]);
  });

  it('can only duck again after the cooldown, and with a fresh press', () => {
    const r = newRoom(0, [1, 2, 3]);
    const k = kidOf(r, 3);
    if (!k) throw new Error('missing kid');
    let ducks = 0;
    for (let i = 0; i < 60 * 3; i++) ducks += stepRoom(r, NO_AIM, sticks({ 3: { x: 0, y: 0, a: i % 2 === 0 } }), DT).ducked.length;
    expect(ducks).toBe(2);
    // Holding the button down: one duck, not one every cooldown.
    for (let i = 0; i < 30; i++) stepRoom(r, NO_AIM, sticks(), DT);
    for (let i = 0; i < 60 * 3; i++) ducks += stepRoom(r, NO_AIM, sticks({ 3: { x: 0, y: 0, a: true } }), DT).ducked.length;
    expect(ducks).toBe(3);
  });

  it('waits for a phone whose Duck may still be on its way', () => {
    const r = newRoom(0, [1, 2, 3]);
    const k = kidOf(r, 1);
    if (!k) throw new Error('missing kid');
    // The duck arrives just after the pillow came down, within the phone's lag: it counts.
    let landedAt = -1;
    const res = throwAt(
      r,
      k.x + 0.6,
      k.z,
      (i) => {
        if (landedAt < 0 && r.pending.length) landedAt = i;
        return sticks(landedAt >= 0 && i === landedAt + 2 ? { 1: { x: 0, y: 0, a: true } } : {});
      },
      [0, 0.1, 0, 0],
    );
    expect(res.dodged).toEqual([1]);
    expect(k.lives).toBe(BUNK.lives);
  });

  it('keeps bonked players safe for a moment, and puts them out at no cushions', () => {
    const r = newRoom(0, [1, 2, 3]);
    const k = kidOf(r, 1);
    if (!k) throw new Error('missing kid');
    for (let n = 0; n < BUNK.lives; n++) {
      throwAt(r, k.x, k.z);
      expect(k.lives).toBe(BUNK.lives - n - 1);
      for (let i = 0; i < 70; i++) stepRoom(r, NO_AIM, sticks(), DT);
    }
    expect(k.outAt).not.toBeNull();
    // Out players don't move or get bonked any more.
    const { bonked } = throwAt(r, k.x, k.z);
    expect(bonked).toEqual([]);
  });

  it('gives the top bunk the win when all three are out, the floor the win otherwise', () => {
    const r = newRoom(2, [0, 1, 3]);
    for (const k of r.kids) k.lives = 1;
    for (const k of r.kids) throwAt(r, k.x, k.z);
    expect(topWins(r)).toBe(true);
    expect(isOver(r)).toBe(true);
    expect(bunkScores(r, 4)).toEqual([0, 0, 1, 0]);

    const q = newRoom(1, [0, 2, 3]);
    for (let i = 0; i < BUNK.duration * 60 + 5; i++) stepRoom(q, NO_AIM, sticks(), DT);
    expect(isOver(q)).toBe(true);
    expect(bunkScores(q, 4)).toEqual([1, 0, 1, 1]);
  });

  it('keeps the floor players on the floor', () => {
    const r = newRoom(0, [1, 2, 3]);
    for (let i = 0; i < 300; i++) stepRoom(r, NO_AIM, sticks({ 1: { x: -1, y: 1, a: false }, 3: { x: 1, y: -1, a: false } }), DT);
    expect(kidOf(r, 1)?.x).toBeCloseTo(-BUNK.floor.x);
    expect(kidOf(r, 1)?.z).toBeCloseTo(BUNK.floor.back);
    expect(kidOf(r, 3)?.x).toBeCloseTo(BUNK.floor.x);
    expect(kidOf(r, 3)?.z).toBeCloseTo(BUNK.floor.front);
  });

  it('plays out with computer players, and sharpness matters on both sides', () => {
    let sharpTop = 0;
    let sleepyTop = 0;
    let even = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = run(seed, 0.9, 0.4);
      const b = run(seed, 0.4, 0.9);
      const c = run(seed, 0.575, 0.575);
      expect(isOver(a) && isOver(b) && isOver(c)).toBe(true);
      if (topWins(a)) sharpTop++;
      if (topWins(b)) sleepyTop++;
      if (topWins(c)) even++;
    }
    expect(sharpTop).toBeGreaterThan(30);
    expect(sleepyTop).toBeLessThan(10);
    // Evenly matched, either side can win.
    expect(even).toBeGreaterThan(8);
    expect(even).toBeLessThan(32);
  });
});
