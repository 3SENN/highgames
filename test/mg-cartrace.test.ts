import { describe, expect, it } from 'vitest';
import {
  CART,
  type Cart,
  type CartEvent,
  type Course,
  SECTIONS,
  X_MAX,
  cartScores,
  cartSeatScores,
  cpuPush,
  cpuSteer,
  makeCourse,
  newCart,
  newCpuPusher,
  newCpuSteerer,
  pushCart,
  stepCart,
  swapping,
  wasFirst,
} from '../src/game/minigames/cartrace';
import { createRng } from '../src/game/rng';

const empty: Course = { snacks: [], obstacles: [] };

function roll(c: Cart, course: Course, tilt: number, seconds: number, t0 = 0): CartEvent[] {
  const events: CartEvent[] = [];
  const n = Math.round(seconds / CART.step);
  for (let i = 0; i < n; i++) events.push(...stepCart(c, course, tilt, t0 + i * CART.step));
  return events;
}

/** A whole race for one team of two computer players (they swap jobs halfway, like people do). */
function race(seed: number, pusher: number, steerer: number): Cart {
  const rng = createRng(seed);
  const course = makeCourse(createRng(seed * 7 + 1));
  const c = newCart(course);
  const skill = [pusher, steerer];
  const pushers = [newCpuPusher(), newCpuPusher()];
  const steerers = [newCpuSteerer(), newCpuSteerer()];
  const frame = 1 / 60;
  let t = 0;
  let acc = 0;
  while (t < CART.duration && c.finishedAt === null) {
    t += frame;
    const p = t >= CART.swapAt ? 1 : 0;
    const s = 1 - p;
    let tilt = 0;
    if (!swapping(t)) {
      const power = cpuPush(pushers[p]!, skill[p]!, rng, t, frame);
      if (power > 0) pushCart(c, power);
      tilt = cpuSteer(steerers[s]!, c, course, skill[s]!, rng, t);
    }
    acc += frame;
    while (acc >= CART.step) {
      acc -= CART.step;
      stepCart(c, course, tilt, t);
    }
  }
  return c;
}

describe('snack run: the aisle', () => {
  it('lines the shelves with snacks of each section, clear of the obstacles', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const course = makeCourse(createRng(seed));
      expect(course.snacks.length).toBeGreaterThanOrEqual(10);
      expect(course.obstacles.filter((o) => o.kind === 'wet').length).toBeGreaterThanOrEqual(1);
      expect(course.obstacles.filter((o) => o.kind === 'cans').length).toBeGreaterThanOrEqual(1);
      for (const k of course.snacks) {
        expect(k.s).toBeGreaterThan(0);
        expect(k.s).toBeLessThan(CART.length);
        const section = SECTIONS.find((x) => k.s < x.to);
        expect(k.kind).toBe(section?.kind ?? 'icecream');
        for (const o of course.obstacles) expect(Math.abs(o.s - k.s)).toBeGreaterThanOrEqual(1.4);
      }
      // There is always a way round every obstacle.
      for (const o of course.obstacles) {
        const room = Math.max(X_MAX - (o.x + o.r + CART.half), o.x - o.r - CART.half + X_MAX);
        expect(room).toBeGreaterThan(0.3);
      }
    }
  });
});

describe('snack run: the cart', () => {
  it('speeds up with pushing, ever less as it goes faster, and rolls to a stop', () => {
    const c = newCart(empty);
    pushCart(c, 1);
    const first = c.v;
    for (let i = 0; i < 30; i++) pushCart(c, 1);
    const before = c.v;
    pushCart(c, 1);
    expect(c.v - before).toBeLessThan(first);
    expect(c.v).toBeLessThan(CART.top);
    roll(c, empty, 0, 30);
    expect(c.v).toBe(0);
  });

  it('steers sideways within its lane', () => {
    const c = newCart(empty);
    roll(c, empty, 1, 2);
    expect(c.x).toBeCloseTo(X_MAX, 6);
    roll(c, empty, -0.05, 1); // inside the dead zone: stays put
    expect(c.x).toBeCloseTo(X_MAX, 6);
    roll(c, empty, -1, 2);
    expect(c.x).toBeCloseTo(-X_MAX, 6);
  });

  it('grabs a snack when it passes close to that shelf, and misses it from the middle', () => {
    const course: Course = { snacks: [{ s: 3, side: 1, kind: 'chips' }], obstacles: [] };
    const near = newCart(course);
    near.x = X_MAX;
    near.v = 3;
    expect(roll(near, course, 0, 1.5).map((e) => e.kind)).toContain('snack');
    expect(near.snacks).toBe(1);
    expect(near.kinds.chips).toBe(1);

    const far = newCart(course);
    far.v = 3;
    expect(roll(far, course, 0, 1.5).map((e) => e.kind)).toEqual(['missed']);
    expect(far.snacks).toBe(0);
  });

  it('slides on the wet floor and stops dead in the cans, once each', () => {
    const course: Course = {
      snacks: [],
      obstacles: [
        { s: 3, x: 0, kind: 'wet', r: 0.5 },
        { s: 8, x: 0.2, kind: 'cans', r: 0.42 },
      ],
    };
    const c = newCart(course);
    c.v = 3;
    const slip = roll(c, course, 0, 1);
    expect(slip.map((e) => e.kind)).toEqual(['slip']);
    expect(c.slide).toBeGreaterThan(0);
    expect(c.v).toBeLessThan(3 * 0.75);
    // Sliding: the tilt does nothing for a moment.
    const vx = c.vx;
    roll(c, course, -1, 0.05, 1);
    expect(Math.sign(c.vx)).toBe(Math.sign(vx));
    // Back to the middle and on into the cans.
    c.x = 0;
    c.vx = 0;
    c.slide = 0;
    c.v = 3;
    const crash = roll(c, course, 0, 3, 2);
    expect(crash.map((e) => e.kind)).toEqual(['crash']);
    expect(c.crashes).toBe(1);
    expect(c.slips).toBe(1);
    expect(pushCart(c, 1)).toBe(c.stun <= 0);
  });

  it('crosses the line, then ignores pushing', () => {
    const c = newCart(empty);
    c.s = CART.length - 0.5;
    c.v = 2;
    expect(roll(c, empty, 0, 1, 20).map((e) => e.kind)).toEqual(['finish']);
    expect(c.finishedAt).toBeGreaterThan(20);
    expect(pushCart(c, 1)).toBe(false);
  });

  it('swaps jobs halfway, for a moment', () => {
    expect(swapping(CART.swapAt - 0.01)).toBe(false);
    expect(swapping(CART.swapAt + 0.1)).toBe(true);
    expect(swapping(CART.swapAt + CART.swapPause + 0.01)).toBe(false);
  });
});

describe('snack run: scores', () => {
  it('adds the bonus for the first cart across', () => {
    const a = { ...newCart(empty), snacks: 6, finishedAt: 28 };
    const b = { ...newCart(empty), snacks: 9, finishedAt: 30 };
    const c = { ...newCart(empty), snacks: 10, finishedAt: null };
    expect(cartScores([a, b, c])).toEqual([6 + CART.first, 9, 10]);
    expect(wasFirst([a, b, c], a)).toBe(true);
    expect(wasFirst([a, b, c], b)).toBe(false);
  });

  it('gives the bonus to both on a dead heat, and to nobody if nobody got there', () => {
    const a = { ...newCart(empty), snacks: 4, finishedAt: 29 };
    const b = { ...newCart(empty), snacks: 5, finishedAt: 29 };
    expect(cartScores([a, b])).toEqual([4 + CART.first, 5 + CART.first]);
    expect(cartScores([{ ...a, finishedAt: null }, { ...b, finishedAt: null }])).toEqual([4, 5]);
  });

  it('gives both partners their team’s score', () => {
    const a = { ...newCart(empty), snacks: 7, finishedAt: 25 };
    const b = { ...newCart(empty), snacks: 3 };
    expect(cartSeatScores([a, b], [[2, 0], [1, 3]], 4)).toEqual([12, 3, 12, 3]);
  });
});

describe('snack run: computer players', () => {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const runs = (s: number, n = 24) => Array.from({ length: n }, (_, i) => race(50 + i, s, s));

  it('average pairs reach the till in about half a minute with a fair few snacks', () => {
    const r = runs(0.57);
    const done = r.filter((c) => c.finishedAt !== null);
    expect(done.length).toBeGreaterThan(r.length * 0.75);
    const t = mean(done.map((c) => c.finishedAt ?? 0));
    expect(t).toBeGreaterThan(27);
    expect(t).toBeLessThan(33);
    expect(mean(r.map((c) => c.snacks))).toBeGreaterThan(6);
  });

  it('sharp pairs are quicker and rarely bump into things; sleepy ones still grab some snacks', () => {
    const sharp = runs(1);
    const sleepy = runs(0.1);
    expect(mean(sharp.map((c) => c.finishedAt ?? CART.duration))).toBeLessThan(25);
    expect(mean(sharp.map((c) => c.crashes + c.slips))).toBeLessThan(0.3);
    expect(mean(sleepy.map((c) => c.snacks))).toBeGreaterThan(2);
    expect(mean(sleepy.map((c) => c.crashes + c.slips))).toBeGreaterThan(1);
  });

  it('a sharp team usually wins, and close teams are a contest', () => {
    let sharp = 0;
    let closeA = 0;
    let closeB = 0;
    for (let i = 0; i < 30; i++) {
      const [a, b] = cartScores([race(300 + i, 0.8, 0.8), race(300 + i, 0.35, 0.35)]);
      if ((a ?? 0) > (b ?? 0)) sharp++;
      const [c, d] = cartScores([race(600 + i, 0.6, 0.6), race(900 + i, 0.5, 0.5)]);
      if ((c ?? 0) > (d ?? 0)) closeA++;
      if ((d ?? 0) > (c ?? 0)) closeB++;
    }
    expect(sharp).toBeGreaterThanOrEqual(25);
    expect(closeA).toBeGreaterThan(closeB);
    expect(closeB).toBeGreaterThan(2);
  });
});
