import { describe, expect, it } from 'vitest';
import { COUCH, couchDetail, couchScores, isComfy, newSinker, stepSinker, wiggle } from '../src/game/minigames/couchlock';

/** Wiggles `rate` times a second at `power` until popped out or the time is up. */
function play(rate: number, power: number) {
  const s = newSinker();
  const dt = 1 / 60;
  let next = 0;
  for (let t = 0; t < COUCH.duration && s.finishedAt === null; t += dt) {
    if (t >= next) {
      wiggle(s, power, t);
      next = t + 1 / rate;
    }
    stepSinker(s, dt, t);
  }
  return s;
}

describe('couch lock', () => {
  it('pops out with steady, strong wiggling', () => {
    const s = play(4, 0.85);
    expect(s.finishedAt).not.toBeNull();
    expect(s.finishedAt as number).toBeLessThan(COUCH.duration);
    expect(s.out).toBe(COUCH.goal);
  });

  it('stays stuck with lazy wiggling, but not at the very bottom', () => {
    const s = play(2, 0.5);
    expect(s.finishedAt).toBeNull();
    expect(s.out).toBeGreaterThan(10);
    expect(s.out).toBeLessThan(COUCH.goal);
  });

  it('does not reward frantic mashing over a steady rhythm', () => {
    const mash = newSinker();
    const steady = newSinker();
    wiggle(mash, 1, 1);
    wiggle(steady, 1, 1);
    let mashed = 0;
    let rhythm = 0;
    for (let i = 1; i <= 20; i++) mashed += wiggle(mash, 1, 1 + i * 0.1);
    for (let i = 1; i <= 8; i++) rhythm += wiggle(steady, 1, 1 + i * 0.25);
    expect(mashed).toBeLessThanOrEqual(rhythm * 1.01);
  });

  it('sinks faster once you get too comfy', () => {
    const busy = { ...newSinker(), out: 50, lastWiggle: 1 };
    const comfy = { ...newSinker(), out: 50, lastWiggle: 0 };
    expect(isComfy(busy, 1.5)).toBe(false);
    expect(isComfy(comfy, 1.5)).toBe(true);
    stepSinker(busy, 0.5, 1.5);
    stepSinker(comfy, 0.5, 1.5);
    expect(comfy.out).toBeLessThan(busy.out);
  });

  it('ignores wiggles once out and never sinks below the bottom', () => {
    const s = { ...newSinker(), out: COUCH.goal - 1 };
    wiggle(s, 1, 1);
    expect(s.finishedAt).toBe(1);
    expect(wiggle(s, 1, 2)).toBe(0);
    const buried = newSinker();
    stepSinker(buried, 5, 5);
    expect(buried.out).toBe(0);
  });

  it('ranks who popped out by time, ahead of everyone still stuck', () => {
    const a = { ...newSinker(), finishedAt: 14, out: COUCH.goal };
    const b = { ...newSinker(), finishedAt: 11, out: COUCH.goal };
    const c = { ...newSinker(), out: 97 };
    const d = { ...newSinker(), out: 40 };
    const [sa, sb, sc, sd] = couchScores([a, b, c, d]) as [number, number, number, number];
    expect(sb).toBeGreaterThan(sa);
    expect(sa).toBeGreaterThan(sc);
    expect(sc).toBeGreaterThan(sd);
    expect(couchDetail(b)).toContain('11.0');
    expect(couchDetail(d)).toContain('40%');
  });
});
