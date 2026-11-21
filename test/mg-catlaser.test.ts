import { describe, expect, it } from 'vitest';
import {
  CAT,
  type Cat,
  type CatEvent,
  type Dot,
  catScores,
  cpuLaser,
  cushions,
  interest,
  liking,
  moveDot,
  napper,
  newCat,
  newDot,
  newLaserCpu,
  stepCat,
  toFloor,
  toPointer,
} from '../src/game/minigames/catlaser';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** Runs the cat for `seconds` while `move(i, t)` places each dot. Returns every event. */
function run(cat: Cat, dots: Dot[], pads: { x: number; z: number }[], from: number, seconds: number, move: (i: number, t: number) => { x: number; z: number }): CatEvent[] {
  const events: CatEvent[] = [];
  for (let t = from; t < from + seconds; t += DT) {
    dots.forEach((d, i) => {
      const p = move(i, t);
      moveDot(d, p.x, p.z, t);
    });
    events.push(...stepCat(cat, dots, pads, t, DT));
  }
  return events;
}

/** A whole game of computer players. Returns the nap seconds per seat. */
function sim(seed: number, skills: number[]): number[] {
  const rng = createRng(seed);
  const pads = cushions(skills.length);
  const cat = newCat();
  const dots = skills.map((_, i) => newDot(pads[i]!.x * 0.8, pads[i]!.z * 0.8));
  const cpus = skills.map((_, i) => newLaserCpu(pads[i]!.x * 0.8, pads[i]!.z * 0.8));
  const nap = skills.map(() => 0);
  for (let t = 0; t < CAT.duration; t += DT) {
    skills.forEach((s, i) => {
      const p = cpuLaser(cpus[i]!, i, cat, pads, t, DT, s, rng);
      moveDot(dots[i]!, p.x, p.z, t);
    });
    stepCat(cat, dots, pads, t, DT);
    const who = napper(cat);
    if (who !== null) nap[who]! += DT;
  }
  return nap;
}

describe('laser kitty', () => {
  it('maps pointers onto the floor and puts the cushions in the corners, equally far from the cat', () => {
    expect(toFloor(1, 1)).toEqual({ x: CAT.halfW, z: -CAT.halfD });
    const p = toPointer(-3, 2);
    expect(toFloor(p.x, p.y).x).toBeCloseTo(-3);
    const pads = cushions(4);
    expect(pads).toHaveLength(4);
    expect(cushions(2)).toHaveLength(2);
    const r = Math.hypot(pads[0]!.x, pads[0]!.z);
    for (const c of pads) {
      expect(Math.abs(c.x) + CAT.cushion).toBeLessThanOrEqual(CAT.halfW + 0.01);
      expect(Math.abs(c.z) + CAT.cushion).toBeLessThanOrEqual(CAT.halfD + 0.01);
      expect(Math.hypot(c.x, c.z)).toBeCloseTo(r);
    }
  });

  it('measures steady movement, ignores a shaky hand and catches a flick', () => {
    const steady = newDot(0, 0);
    for (let t = 0; t < 1; t += DT) moveDot(steady, -3 + 2 * t, 0, t);
    expect(steady.slow).toBeCloseTo(2, 1);
    expect(steady.fast).toBeCloseTo(2, 1);
    const shaky = newDot(0, 0);
    const rng = createRng(1);
    for (let t = 0; t < 1; t += DT) moveDot(shaky, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12, t);
    expect(shaky.slow).toBeLessThan(CAT.still);
    const flick = newDot(0, 0);
    for (let t = 0; t < 0.5; t += DT) moveDot(flick, t < 0.4 ? 0 : (t - 0.4) * 30, 0, t);
    expect(flick.fast).toBeGreaterThan(CAT.spook);
  });

  it('likes steady dots best, ignores still ones and cools on dots that zip about', () => {
    expect(liking(0)).toBe(0);
    expect(liking(CAT.still)).toBe(0);
    expect(liking(2)).toBe(1);
    expect(liking(CAT.fast)).toBeLessThan(0.5);
    const cat = newCat();
    const near = { ...newDot(0, 1), slow: 2 };
    const far = { ...newDot(0, 5), slow: 2 };
    const behind = { ...newDot(0, -1), slow: 2 };
    expect(interest(cat, near, 0)).toBeGreaterThan(interest(cat, far, 0));
    expect(interest(cat, near, 0)).toBeGreaterThan(interest(cat, behind, 0));
    expect(interest(cat, { ...near, ignoreUntil: 1 }, 0.5)).toBe(0);
  });

  it('stays put for a still dot and goes after a steady one', () => {
    const pads = cushions(2);
    const cat = newCat();
    const dots = [newDot(0.8, 0.8), newDot(-3, 0)];
    run(cat, dots, pads, 0, 2, (i) => (i === 0 ? { x: 0.8, z: 0.8 } : { x: -3, z: 0 }));
    expect(cat.mode).toBe('idle');
    expect(Math.hypot(cat.x, cat.z)).toBeLessThan(0.05);
    const ev = run(cat, dots, pads, 2, 1.5, (i, t) => (i === 0 ? { x: 0.8, z: 0.8 } : { x: -3 + Math.sin(t * 2) * 0.8, z: Math.cos(t * 2) * 0.8 }));
    expect(ev).toContainEqual({ kind: 'chase', dot: 1 });
    expect(cat.mode).toBe('chase');
    expect(cat.x).toBeLessThan(-0.5);
  });

  it('gets spooked by a dot jumping about close by, and ignores that dot for a while', () => {
    const pads = cushions(2);
    const cat = newCat();
    const dots = [newDot(1, 1), newDot(-5, -2)];
    const ev = run(cat, dots, pads, 0, 0.6, (i, t) => (i === 0 ? { x: 1 + Math.sin(t * 40) * 1.5, z: 1 } : { x: -5, z: -2 }));
    expect(ev.find((e) => e.kind === 'spook')).toEqual({ kind: 'spook', dot: 0, napping: false });
    expect(cat.mode).toBe('startled');
    expect(interest(cat, dots[0]!, 0.7)).toBe(0);
    expect(dots[0]!.ignoreUntil).toBeGreaterThan(CAT.ignore);
  });

  it('naps on a cushion it is led to, stays a while, then follows a tempting dot', () => {
    const pads = cushions(2);
    const home = pads[0]!;
    const cat = newCat();
    const dots = [newDot(0, 0), newDot(4, 2)];
    // Seat 0 leads the cat home, a step ahead of it, then sits still.
    let napAt = -1;
    for (let t = 0; t < 12 && napAt < 0; t += DT) {
      const dx = home.x - cat.x;
      const dz = home.z - cat.z;
      const d = Math.hypot(dx, dz) || 1;
      const lead = Math.min(1.1, d);
      moveDot(dots[0]!, cat.x + (dx / d) * lead + Math.cos(t * 3) * 0.5, cat.z + (dz / d) * lead + Math.sin(t * 3) * 0.5, t);
      moveDot(dots[1]!, 4, 2, t);
      const ev = stepCat(cat, dots, pads, t, DT);
      if (ev.some((e) => e.kind === 'nap')) napAt = t;
    }
    expect(napAt).toBeGreaterThan(0);
    expect(napper(cat)).toBe(0);
    // Seat 1 dances right next to it: nothing before the nap's quiet time, then it gets up for seat 1.
    const dance = (i: number, t: number) => (i === 0 ? { x: dots[0]!.x, z: dots[0]!.z } : { x: home.x + 0.8 + Math.cos(t * 3) * 0.5, z: home.z + Math.sin(t * 3) * 0.5 });
    run(cat, dots, pads, napAt, CAT.minNap - 0.1, dance);
    expect(napper(cat)).toBe(0);
    const ev = run(cat, dots, pads, napAt + CAT.minNap, CAT.tempt + 0.6, dance);
    expect(ev).toContainEqual({ kind: 'wake', cushion: 0, dot: 1 });
    expect(cat.mode).toBe('chase');
    // It doesn't curl up on the cushion it just left straight away.
    expect(cat.left).toBe(0);
  });

  it('gets bored of the dot it follows', () => {
    const pads = cushions(1);
    const cat = newCat();
    const dots = [newDot(0, 1)];
    run(cat, dots, pads, 0, 4, (_, t) => ({ x: Math.sin(t * 2.5) * 1.2, z: 0.5 + Math.cos(t * 2.5) * 1.2 }));
    expect(dots[0]!.boredom).toBeGreaterThan(0.1);
    expect(catScores([3.14159, 0])).toEqual([3.1, 0]);
  });

  it('has computer players get the cat napping, sharp ones far more than sleepy ones', () => {
    let total = 0;
    const games = 30;
    for (let seed = 1; seed <= games; seed++) total += sim(seed, [0.5, 0.5, 0.5, 0.5]).reduce((a, b) => a + b, 0);
    expect(total / games).toBeGreaterThan(CAT.duration * 0.2);
    let sharp = 0;
    let sleepy = 0;
    let wins = 0;
    for (let seed = 1; seed <= games; seed++) {
      const nap = sim(seed * 5, [1, 0, 0, 0]);
      sharp += nap[0]!;
      sleepy += (nap[1]! + nap[2]! + nap[3]!) / 3;
      if (nap[0]! > Math.max(nap[1]!, nap[2]!, nap[3]!)) wins++;
    }
    expect(sharp).toBeGreaterThan(sleepy * 3);
    expect(wins).toBeGreaterThan(games * 0.7);
    // An average player still gets a look in against a sharp one.
    let avg = 0;
    for (let seed = 1; seed <= games; seed++) avg += sim(seed * 7, [1, 0.5]).at(1)!;
    expect(avg / games).toBeGreaterThan(1);
  });
});
