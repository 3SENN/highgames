import { describe, expect, it } from 'vitest';
import {
  type Stack,
  TAKEOUT,
  cpuDropAt,
  drop,
  newStack,
  stacked,
  stepStack,
  swingSpeed,
  swingX,
  takeoutScores,
  topOf,
} from '../src/game/minigames/takeoutstack';
import { createRng } from '../src/game/rng';

const DT = 1 / 120;

/** Hooks the next box and returns when it passes right over the stack. */
function hookAndCentre(s: Stack): number {
  stepStack(s, s.nextHook);
  return (s.hookedAt as number) + Math.PI / 2 / swingSpeed(s);
}

function playCpu(skill: number, seed: number): Stack {
  const rng = createRng(seed);
  const s = newStack();
  let at = Infinity;
  for (let t = 0; t < TAKEOUT.duration && !s.done; t += DT) {
    if (stepStack(s, t)) at = cpuDropAt(s, skill, rng);
    if (t >= at) {
      drop(s, at);
      at = Infinity;
    }
  }
  return s;
}

describe('takeout tower', () => {
  it('swings the box either side of the stack, starting from alternate sides', () => {
    const s = newStack();
    expect(stepStack(s, 0)).toBe(false);
    expect(stepStack(s, TAKEOUT.firstHook)).toBe(true);
    const t0 = s.hookedAt as number;
    expect(swingX(s, t0)).toBeCloseTo(TAKEOUT.amp);
    expect(swingX(s, t0 + Math.PI / swingSpeed(s))).toBeCloseTo(-TAKEOUT.amp);
    drop(s, hookAndCentre(s) - 1);
    stepStack(s, s.nextHook);
    expect(swingX(s, s.hookedAt as number)).toBeCloseTo(topOf(s).x - TAKEOUT.amp);
  });

  it('keeps a perfect drop whole', () => {
    const s = newStack();
    const r = drop(s, hookAndCentre(s));
    expect(r?.kind).toBe('perfect');
    expect(topOf(s).w).toBe(TAKEOUT.width);
    expect(s.perfects).toBe(1);
    expect(stacked(s)).toBe(1);
  });

  it('cuts off what hangs over the edge, on the side it hangs over', () => {
    const s = newStack();
    stepStack(s, TAKEOUT.firstHook);
    // A quarter-swing late is far off centre; find a moment 0.3 to the right instead.
    const w = swingSpeed(s);
    const at = (s.hookedAt as number) + Math.acos(0.3 / TAKEOUT.amp) / w;
    expect(swingX(s, at)).toBeCloseTo(0.3);
    const r = drop(s, at);
    expect(r?.kind).toBe('cut');
    if (r?.kind !== 'cut') return;
    expect(r.box.w).toBeCloseTo(TAKEOUT.width - 0.3);
    expect(r.box.x).toBeCloseTo(0.15);
    expect(r.cut.w).toBeCloseTo(0.3);
    expect(r.cut.x).toBeCloseTo(TAKEOUT.width / 2 + 0.15);
    // The kept part and the cut piece make up the whole dropped box.
    expect(r.box.x - r.box.w / 2).toBeCloseTo(0 - TAKEOUT.width / 2 + 0.3);
    expect(r.cut.x + r.cut.w / 2).toBeCloseTo(0.3 + TAKEOUT.width / 2);
  });

  it('ends the tower when a box misses the stack', () => {
    const s = newStack();
    stepStack(s, TAKEOUT.firstHook);
    const r = drop(s, s.hookedAt as number);
    expect(r?.kind).toBe('miss');
    expect(s.done).toBe(true);
    expect(stacked(s)).toBe(0);
    expect(stepStack(s, 99)).toBe(false);
    expect(drop(s, 99)).toBeNull();
  });

  it('waits for the crane between boxes and swings faster as the stack grows', () => {
    const s = newStack();
    const slow = (() => {
      stepStack(s, TAKEOUT.firstHook);
      return swingSpeed(s);
    })();
    const at = (s.hookedAt as number) + Math.PI / 2 / slow;
    drop(s, at);
    expect(drop(s, at + 0.1)).toBeNull();
    expect(stepStack(s, at + TAKEOUT.rehook / 2)).toBe(false);
    expect(stepStack(s, at + TAKEOUT.rehook)).toBe(true);
    for (let k = 0; k < 10; k++) drop(s, hookAndCentre(s));
    expect(swingSpeed(s)).toBeGreaterThan(slow * 1.4);
    for (let k = 0; k < 60; k++) drop(s, hookAndCentre(s));
    expect(swingSpeed(s)).toBeCloseTo(TAKEOUT.swing * TAKEOUT.maxSpeed);
  });

  it('judges the drop where the box was at the time given (the tap minus its travel time)', () => {
    const s = newStack();
    const centre = hookAndCentre(s);
    expect(drop(s, centre)?.kind).toBe('perfect');
    const t = newStack();
    hookAndCentre(t);
    expect(drop(t, centre + 0.12)?.kind).toBe('cut');
  });

  it('ranks taller stacks first, perfect drops breaking ties', () => {
    const a = newStack();
    const b = newStack();
    const c = newStack();
    for (let k = 0; k < 5; k++) drop(a, hookAndCentre(a));
    for (let k = 0; k < 5; k++) drop(b, hookAndCentre(b) + (k ? 0 : 0.05));
    for (let k = 0; k < 4; k++) drop(c, hookAndCentre(c));
    const [sa, sb, sc] = takeoutScores([a, b, c]) as [number, number, number];
    expect(sa).toBeGreaterThan(sb);
    expect(sb).toBeGreaterThan(sc);
  });

  it('has computer players stack believably: sharp ones tall, sleepy ones short, nobody perfect every time', () => {
    let sleepy = 0;
    let average = 0;
    let sharp = 0;
    const runs = 40;
    for (let seed = 1; seed <= runs; seed++) {
      sleepy += stacked(playCpu(0.1, seed)) / runs;
      average += stacked(playCpu(0.55, seed)) / runs;
      const keen = playCpu(0.85, seed);
      sharp += stacked(keen) / runs;
      expect(keen.perfects).toBeLessThan(stacked(keen) + 1);
    }
    expect(sleepy).toBeGreaterThan(3);
    expect(average).toBeGreaterThan(sleepy * 1.4);
    expect(sharp).toBeGreaterThan(average * 1.4);
    // About one box a second and a half at most: the clock matters for the sharpest.
    expect(sharp).toBeLessThan(TAKEOUT.duration / 1.1);
  });
});
