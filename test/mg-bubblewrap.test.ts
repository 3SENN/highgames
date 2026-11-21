import { describe, expect, it } from 'vitest';
import {
  BUBBLE,
  BUBBLES,
  type Popper,
  bubbleAt,
  bubbleScores,
  bubbleXY,
  cpuPress,
  newCpuThumb,
  newPopper,
  newSheet,
  press,
  sheetFor,
} from '../src/game/minigames/bubblewrap';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** Pops every bubble of the current sheet in order, `gap` seconds apart, starting at t. Returns the time after. */
function popSheet(p: Popper, t: number, gap = 0.1): number {
  let now = Math.max(t, p.readyAt);
  const start = p.sheets;
  for (let i = 0; i < BUBBLES && p.sheets === start; i++) {
    const at = bubbleXY(i);
    while (p.sheets === start && (p.sheet.bubbles[i]?.left ?? 0) > 0) {
      press(p, at.x, at.y, now);
      now += gap;
    }
  }
  return now;
}

function playCpu(skill: number, seed: number): Popper {
  const rng = createRng(seed);
  const p = newPopper(seed * 31);
  const c = newCpuThumb();
  for (let t = 0; t < BUBBLE.duration; t += DT) {
    const at = cpuPress(c, p, t, DT, skill, rng);
    if (at) press(p, at.x, at.y, t);
  }
  return p;
}

describe('bubble wrap', () => {
  it('lays a 6 by 10 sheet inside the playfield, every bubble its own', () => {
    expect(BUBBLES).toBe(60);
    for (let i = 0; i < BUBBLES; i++) {
      const { x, y } = bubbleXY(i);
      expect(x - BUBBLE.r).toBeGreaterThan(0);
      expect(x + BUBBLE.r).toBeLessThan(1);
      expect(y).toBeGreaterThan(0.15);
      expect(y).toBeLessThan(0.92);
      expect(bubbleAt(x, y)).toBe(i);
      // A press a little off-centre still finds it.
      expect(bubbleAt(x + BUBBLE.r * 0.8, y)).toBe(i);
    }
    expect(bubbleAt(0.5, 0.05)).toBeNull();
    expect(bubbleAt(0.5, 0.98)).toBeNull();
  });

  it('scatters the same number of golden and grumpy bubbles on every sheet', () => {
    for (let seed = 1; seed < 20; seed++) {
      const sheet = newSheet(createRng(seed));
      expect(sheet.bubbles.filter((b) => b.kind === 'golden')).toHaveLength(BUBBLE.golden);
      const grumpy = sheet.bubbles.filter((b) => b.kind === 'grumpy');
      expect(grumpy).toHaveLength(BUBBLE.grumpy);
      expect(grumpy.every((b) => b.left === BUBBLE.grumpyTaps)).toBe(true);
    }
  });

  it('gives everyone the same sheets in the same order', () => {
    expect(sheetFor(7, 2)).toEqual(sheetFor(7, 2));
    expect(sheetFor(7, 2)).not.toEqual(sheetFor(7, 3));
  });

  it('pops a bubble once, counts golden as 3 and needs two presses for a grumpy one', () => {
    const p = newPopper(5);
    const kinds = p.sheet.bubbles.map((b) => b.kind);
    const plain = kinds.indexOf('plain');
    const golden = kinds.indexOf('golden');
    const grumpy = kinds.indexOf('grumpy');
    const at = (i: number) => bubbleXY(i);
    expect(press(p, at(plain).x, at(plain).y, 1)).toMatchObject({ kind: 'pop', points: 1 });
    expect(press(p, at(plain).x, at(plain).y, 1.1)).toMatchObject({ kind: 'miss' });
    expect(press(p, at(golden).x, at(golden).y, 1.2)).toMatchObject({ kind: 'pop', bubble: 'golden', points: 3 });
    expect(press(p, at(grumpy).x, at(grumpy).y, 1.3)).toMatchObject({ kind: 'squeak' });
    expect(press(p, at(grumpy).x, at(grumpy).y, 1.4)).toMatchObject({ kind: 'pop', bubble: 'grumpy', points: 1 });
    expect(p.score).toBe(5);
    expect(p.popped).toBe(3);
    expect(p.goldens).toBe(1);
  });

  it('slides in a fresh sheet once one is fully popped, and ignores presses while it slides', () => {
    const p = newPopper(9);
    const end = popSheet(p, 0, 0.05);
    expect(p.sheets).toBe(1);
    expect(p.popped).toBe(BUBBLES);
    expect(p.score).toBe(BUBBLES + 2 * BUBBLE.golden);
    expect(p.sheet.left).toBe(BUBBLES);
    const first = bubbleXY(0);
    expect(press(p, first.x, first.y, end - 0.05 + BUBBLE.slide / 2)).toEqual({ kind: 'wait' });
    expect(press(p, first.x, first.y, end + BUBBLE.slide).kind).not.toBe('wait');
  });

  it('has computer players pop believably: sharp ones well ahead of sleepy ones, nobody superhuman', () => {
    let sleepy = 0;
    let average = 0;
    let sharp = 0;
    const runs = 30;
    for (let seed = 1; seed <= runs; seed++) {
      const a = playCpu(0.1, seed).score;
      const b = playCpu(0.55, seed).score;
      const c = playCpu(0.95, seed).score;
      sleepy += a / runs;
      average += b / runs;
      sharp += c / runs;
      // Even a sharp computer pops fewer than 7 a second.
      expect(c).toBeLessThan(7 * BUBBLE.duration + 20);
    }
    expect(sleepy).toBeGreaterThan(40);
    expect(average).toBeGreaterThan(sleepy * 1.2);
    expect(sharp).toBeGreaterThan(average * 1.15);
    // A steady five presses a second (a fair human pace) keeps up with an average computer.
    const human = newPopper(3);
    for (let t = 0.4; t < BUBBLE.duration; t += 0.2) {
      const next = human.sheet.bubbles.findIndex((b) => b.left > 0);
      const at = bubbleXY(next);
      if (press(human, at.x, at.y, t).kind === 'wait') t = human.readyAt - 0.2;
    }
    expect(human.score).toBeGreaterThan(average * 0.95);
  });

  it('ranks by points', () => {
    const a = { ...newPopper(1), score: 12 };
    const b = { ...newPopper(1), score: 30 };
    const [sa, sb] = bubbleScores([a, b]) as [number, number];
    expect(sb).toBeGreaterThan(sa);
  });
});
