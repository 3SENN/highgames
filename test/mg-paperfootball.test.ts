import { describe, expect, it } from 'vitest';
import { PHONE_L } from '../src/game/minigames/coasterhockey';
import {
  CORNER,
  FIELD,
  PAPER,
  type TouchSample,
  corners,
  cpuFlick,
  cpuKick,
  launchKick,
  launchSlide,
  makePosts,
  newPaperMatch,
  nextGo,
  paperWinner,
  reachOf,
  readFlick,
  scoreKick,
  scoreSlide,
  slideAt,
  speedFor,
  startY,
  whoseGo,
} from '../src/game/minigames/paperfootball';
import { createRng } from '../src/game/rng';

/** A straight swipe from (x, y) by (dx, dy) field units over `ms`, sampled like a phone does (~30 a second). */
function swipe(x: number, y: number, dx: number, dy: number, ms: number): TouchSample[] {
  const n = Math.max(2, Math.round(ms / 33));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x + (dx * i) / n, y: y + (dy * i) / n, t: (ms / 1000) * (i / n) }));
}

/** The flick speed that leaves the triangle's middle `d` short of side 0's far edge (straight ahead). */
const speedToStop = (d: number) => speedFor(PHONE_L - d - startY(0));

describe('paper football: reading a flick', () => {
  it('reads a quick forward swipe as a flick with a direction and speed', () => {
    const f = readFlick(swipe(0.5, -1.2, 0, 0.5, 100), 0);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.dy).toBeCloseTo(1, 5);
    expect(f.dx).toBeCloseTo(0, 5);
    expect(f.speed).toBeCloseTo(5, 1);
  });

  it('plays towards the other phone for both sides', () => {
    expect(readFlick(swipe(0.5, 1.2, 0, -0.5, 100), 1).ok).toBe(true);
    expect(readFlick(swipe(0.5, 1.2, 0, 0.5, 100), 1)).toEqual({ ok: false, why: 'backwards' });
  });

  it('ignores taps, backward and sideways swipes', () => {
    expect(readFlick(swipe(0.5, -1, 0, 0.02, 80), 0)).toEqual({ ok: false, why: 'tap' });
    expect(readFlick([{ x: 0.5, y: -1, t: 0 }], 0)).toEqual({ ok: false, why: 'tap' });
    expect(readFlick(swipe(0.5, -1, 0, -0.4, 100), 0)).toEqual({ ok: false, why: 'backwards' });
    expect(readFlick(swipe(0.2, -1, 0.5, 0.1, 100), 0)).toEqual({ ok: false, why: 'sideways' });
  });

  it('uses only the end of a long, slow drag', () => {
    const slow = swipe(0.5, -1.6, 0, 0.3, 900);
    const flick = swipe(0.5, -1.3, 0, 0.5, 100).map((s) => ({ ...s, t: s.t + 0.9 }));
    const f = readFlick([...slow, ...flick.slice(1)], 0);
    expect(f.ok && f.speed).toBeGreaterThan(3.5);
  });

  it('turns speed into reach on a gentle (log) scale', () => {
    expect(reachOf(PAPER.refSpeed)).toBeCloseTo(FIELD, 6);
    expect(reachOf(PAPER.refSpeed * 2)).toBeGreaterThan(FIELD);
    expect(reachOf(PAPER.refSpeed / 2)).toBeLessThan(FIELD);
    for (const d of [1, 2.5, 3.2]) expect(reachOf(speedFor(d))).toBeCloseTo(d, 6);
  });
});

describe('paper football: sliding', () => {
  it('is a touchdown when it stops with its tip over the far edge', () => {
    const s = launchSlide(0, 0, 1, speedToStop(CORNER * 0.4));
    expect(s.end).toBe('touchdown');
    const at = slideAt(s, s.time);
    expect(at.moving).toBe(false);
    const tip = Math.max(...corners(at.x, at.y, s.heading).map(([, y]) => y));
    expect(tip).toBeGreaterThan(PHONE_L);
    expect(at.y).toBeLessThanOrEqual(PHONE_L + PAPER.grace);
  });

  it('is short when the tip stays on the phone, and slides off the end when too hard', () => {
    expect(launchSlide(0, 0, 1, speedToStop(CORNER + 0.1)).end).toBe('short');
    expect(launchSlide(0, 0, 1, speedToStop(-0.5)).end).toBe('end');
    expect(launchSlide(0, 0, 1, speedFor(0.5)).end).toBe('own');
  });

  it('slides off a side when flicked at an angle', () => {
    const s = launchSlide(0, 0.4, 1, PAPER.refSpeed);
    expect(s.end).toBe('side');
    const at = slideAt(s, s.time);
    expect(at.x).toBeCloseTo(1, 5);
    expect(s.progress).toBe(-Infinity);
  });

  it('works the same way round for the other phone', () => {
    const s = launchSlide(1, 0, -1, speedToStop(CORNER * 0.4));
    expect(s.end).toBe('touchdown');
    expect(slideAt(s, s.time).y).toBeLessThan(-PHONE_L + CORNER);
  });

  it('moves in a straight line and slows down steadily', () => {
    const s = launchSlide(0, 0.1, 1, PAPER.refSpeed);
    const a = slideAt(s, s.time * 0.25);
    const b = slideAt(s, s.time * 0.5);
    const c = slideAt(s, s.time * 0.75);
    expect(b.y - a.y).toBeGreaterThan(c.y - b.y);
    // Straight: x moves in proportion to y.
    expect((b.x - a.x) / (b.y - a.y)).toBeCloseTo((c.x - b.x) / (c.y - b.y), 6);
  });
});

describe('paper football: the field goal kick', () => {
  it('is good through the posts, wide outside them and short without enough leg', () => {
    const posts = { x: 0.5, y: PHONE_L - PAPER.postsFromEnd, gap: PAPER.postGap };
    expect(launchKick(0, 0, 1, PAPER.refSpeed, posts).result).toBe('good');
    const wide = Math.atan2(posts.gap + 0.15, posts.y - startY(0));
    expect(launchKick(0, Math.sin(wide), Math.cos(wide), PAPER.refSpeed, posts).result).toBe('wide');
    expect(launchKick(0, 0, 1, speedFor(1), posts).result).toBe('short');
  });

  it('puts the posts on the defender’s phone', () => {
    const rng = createRng(2);
    for (let i = 0; i < 20; i++) {
      expect(makePosts(0, rng).y).toBeGreaterThan(0);
      const p = makePosts(1, rng);
      expect(p.y).toBeLessThan(0);
      expect(Math.abs(p.x - 0.5)).toBeLessThanOrEqual(PAPER.postShift);
    }
  });
});

describe('paper football: a match', () => {
  it('takes turns, four flicks each', () => {
    const m = newPaperMatch(1);
    const seen: number[] = [];
    while (whoseGo(m) !== null) {
      seen.push(whoseGo(m) as number);
      nextGo(m);
    }
    expect(seen).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it('scores 6 for a touchdown and 1 for a good kick, and breaks ties by the furthest flick', () => {
    const m = newPaperMatch(0);
    scoreSlide(m, 0, launchSlide(0, 0, 1, speedToStop(CORNER * 0.4)));
    const posts = { x: 0.5, y: PHONE_L - PAPER.postsFromEnd, gap: PAPER.postGap };
    scoreKick(m, 0, launchKick(0, 0, 1, PAPER.refSpeed, posts));
    expect(m.points).toEqual([7, 0]);
    expect(paperWinner(m, createRng(1))).toBe(0);

    const tie = newPaperMatch(0);
    scoreSlide(tie, 0, launchSlide(0, 0, 1, speedToStop(1)));
    scoreSlide(tie, 1, launchSlide(1, 0, -1, speedToStop(0.5)));
    expect(tie.points).toEqual([0, 0]);
    expect(paperWinner(tie, createRng(1))).toBe(1);
  });

  it('plays whole computer matches: sharp beats sleepy most of the time, even players are a contest', () => {
    const play = (seed: number, skills: [number, number]) => {
      const rng = createRng(seed);
      const m = newPaperMatch(rng() < 0.5 ? 0 : 1);
      for (let side = whoseGo(m); side !== null; side = whoseGo(m)) {
        const f = cpuFlick(side, skills[side], rng);
        const s = launchSlide(side, f.dx, f.dy, f.speed);
        scoreSlide(m, side, s);
        if (s.end === 'touchdown') {
          const posts = makePosts(side, rng);
          const k = cpuKick(side, posts, skills[side], rng);
          scoreKick(m, side, launchKick(side, k.dx, k.dy, k.speed, posts));
        }
        nextGo(m);
      }
      return paperWinner(m, rng);
    };
    let sharp = 0;
    let left = 0;
    for (let seed = 1; seed <= 200; seed++) {
      if (play(seed, seed % 2 ? [0.9, 0.1] : [0.1, 0.9]) === (seed % 2 ? 0 : 1)) sharp++;
      if (play(seed + 1000, [0.5, 0.5]) === 0) left++;
    }
    expect(sharp).toBeGreaterThan(130);
    expect(left).toBeGreaterThan(75);
    expect(left).toBeLessThan(125);
  });

  it('makes sharper computer players score more, and lets sleepy ones score sometimes', () => {
    const rate = (skill: number) => {
      const rng = createRng(11);
      let tds = 0;
      for (let i = 0; i < 1000; i++) {
        const side = (i % 2) as 0 | 1;
        const f = cpuFlick(side, skill, rng);
        if (launchSlide(side, f.dx, f.dy, f.speed).end === 'touchdown') tds++;
      }
      return tds / 1000;
    };
    const sleepy = rate(0);
    const average = rate(0.5);
    const sharp = rate(1);
    expect(sleepy).toBeGreaterThan(0.08);
    expect(average).toBeGreaterThan(sleepy);
    expect(sharp).toBeGreaterThan(average + 0.1);
    expect(sharp).toBeLessThan(0.8);

    const rng = createRng(4);
    let good = 0;
    for (let i = 0; i < 200; i++) {
      const side = (i % 2) as 0 | 1;
      const posts = makePosts(side, rng);
      const k = cpuKick(side, posts, 0.9, rng);
      if (launchKick(side, k.dx, k.dy, k.speed, posts).result === 'good') good++;
    }
    expect(good).toBeGreaterThan(170);
  });
});
