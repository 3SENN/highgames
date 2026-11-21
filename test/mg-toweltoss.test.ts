import { describe, expect, it } from 'vitest';
import { createRng } from '../src/game/rng';
import {
  type Balloon,
  type Deck,
  IDLE,
  type Stick,
  TOWEL,
  aimPoint,
  cpuStick,
  isOver,
  launchDistance,
  newCpuHolder,
  newDeck,
  onTowel,
  powerOf,
  stepDeck,
  towelAngle,
  towelEnds,
  towelScores,
} from '../src/game/minigames/toweltoss';

const DT = 1 / 60;
const TEAMS = [
  [0, 1],
  [2, 3],
];
const PRESS: Stick = { x: 0, y: 0, a: true };

function sticks(over: Partial<Record<number, Stick>>): Stick[] {
  return [0, 1, 2, 3].map((p) => over[p] ?? IDLE);
}

/** Puts someone somewhere, standing still. */
function place(d: Deck, p: number, x: number, z: number): void {
  const h = d.holders[p];
  if (!h) throw new Error('no holder');
  h.x = x;
  h.z = z;
  h.vx = 0;
  h.vz = 0;
}

/** Steps `n` frames with nobody touching anything; returns everything that happened. */
function idle(d: Deck, n: number) {
  const all = { launched: 0, caught: 0, burst: [] as string[], fumbled: 0, refilled: 0 };
  for (let i = 0; i < n; i++) {
    const ev = stepDeck(d, sticks({}), DT);
    all.launched += ev.launched.length;
    all.caught += ev.caught.length;
    all.burst.push(...ev.burst.map((b) => b.result));
    all.fumbled += ev.fumbled.length;
    all.refilled += ev.refilled.length;
  }
  return all;
}

/** A balloon from `team` coming straight down onto (x, z) after `t` seconds. */
function incoming(d: Deck, team: number, x: number, z: number, t = 0.5): Balloon {
  const b: Balloon = { id: d.nextId++, team, x, y: TOWEL.holdY + (TOWEL.gravity * t * t) / 2, z, vx: 0, vy: 0, vz: 0, tx: x, tz: z, at: d.time + t, missed: false };
  d.balloons.push(b);
  return b;
}

describe('towel toss', () => {
  it('starts each pair on its own side with a balloon on the towel', () => {
    const d = newDeck(TEAMS, 4);
    expect(d.teamOf).toEqual([0, 0, 1, 1]);
    expect(d.holders[0]?.x).toBeLessThan(-TOWEL.fence);
    expect(d.holders[2]?.x).toBeGreaterThan(TOWEL.fence);
    expect(d.sides.map((s) => s.stock)).toEqual([TOWEL.startStock, TOWEL.startStock]);
    // Lined up across the deck: both towels face straight over the fence.
    expect(towelAngle(d, 0)).toBeCloseTo(0);
    expect(towelAngle(d, 1)).toBeCloseTo(0);
  });

  it('launches when both partners press within the window, harder the closer together', () => {
    expect(powerOf(0)).toBe(1);
    expect(powerOf(TOWEL.window / 2)).toBeCloseTo(0.5);
    expect(powerOf(TOWEL.window + 0.01)).toBe(0);
    expect(launchDistance(1)).toBeGreaterThan(launchDistance(0.2));

    const d = newDeck(TEAMS, 4);
    const ev = stepDeck(d, sticks({ 0: PRESS, 1: PRESS }), DT);
    expect(ev.launched.length).toBe(1);
    expect(ev.launched[0]?.power).toBeCloseTo(1);
    expect(d.sides[0]?.stock).toBe(TOWEL.startStock - 1);
    expect(d.balloons.length).toBe(1);

    // 0.15 s apart: a half-power launch.
    const d2 = newDeck(TEAMS, 4);
    let launched = stepDeck(d2, sticks({ 0: PRESS }), DT).launched.length;
    for (let i = 0; i < 8; i++) launched += stepDeck(d2, sticks({ 0: PRESS }), DT).launched.length;
    const ev2 = stepDeck(d2, sticks({ 0: PRESS, 1: PRESS }), DT);
    expect(launched).toBe(0);
    expect(ev2.launched.length).toBe(1);
    expect(ev2.launched[0]?.power).toBeCloseTo(powerOf(9 * DT), 1);
  });

  it('a lone press runs out; pressing twice alone does nothing', () => {
    const d = newDeck(TEAMS, 4);
    stepDeck(d, sticks({ 0: PRESS }), DT);
    const all = idle(d, 40);
    expect(all.launched).toBe(0);
    expect(all.fumbled).toBe(1);
    stepDeck(d, sticks({ 0: PRESS }), DT);
    stepDeck(d, sticks({}), DT);
    const ev = stepDeck(d, sticks({ 0: PRESS }), DT);
    expect(ev.launched.length).toBe(0);
  });

  it('takes the phone lag off a press, so a late message still pairs up', () => {
    const d = newDeck(TEAMS, 4);
    stepDeck(d, sticks({ 0: PRESS }), DT);
    for (let i = 0; i < 20; i++) stepDeck(d, sticks({ 0: PRESS }), DT); // 0.33 s later...
    const ev = stepDeck(d, sticks({ 0: PRESS, 1: { ...PRESS, lag: 0.3 } }), DT); // ...but pressed 0.3 s before it arrived
    expect(ev.launched.length).toBe(1);
    expect(ev.launched[0]?.power).toBeGreaterThan(0.6);
  });

  it('needs a balloon on the towel; a fresh one drops on every few seconds', () => {
    const d = newDeck(TEAMS, 4);
    stepDeck(d, sticks({ 0: PRESS, 1: PRESS }), DT);
    for (let i = 0; i < 40; i++) stepDeck(d, sticks({}), DT);
    const ev = stepDeck(d, sticks({ 0: PRESS }), DT);
    expect(ev.empty).toEqual([0]);
    const all = idle(d, Math.ceil(TOWEL.refill * 60) + 2);
    expect(all.refilled).toBeGreaterThanOrEqual(1);
    expect(d.sides[0]?.stock).toBeGreaterThanOrEqual(1);
    // It stops topping up at refillBelow.
    idle(d, Math.ceil(TOWEL.refill * 60 * 4));
    expect(d.sides[0]?.stock).toBe(TOWEL.refillBelow);
  });

  it('flies the way the towel faces, kept to the forward arc', () => {
    const d = newDeck(TEAMS, 4);
    // Left pair staggered: member 0 behind and up the deck, member 1 nearer the fence: the towel turns towards -z.
    place(d, 0, -4, -1);
    place(d, 1, -3, 1);
    const a = towelAngle(d, 0);
    expect(a).toBeLessThan(0);
    expect(a).toBeCloseTo(-Math.atan2(1, 2));
    const pt = aimPoint(d, 0, 1);
    expect(pt.x).toBeGreaterThan(0);
    expect(pt.z).toBeLessThan(0);
    // Side by side along the deck: as far round as it goes.
    place(d, 0, -4, 0);
    place(d, 1, -2, 0.01);
    expect(Math.abs(towelAngle(d, 0))).toBeCloseTo(TOWEL.maxAngle);
  });

  it('a towel only stretches so far, and partners stay on their side', () => {
    const d = newDeck(TEAMS, 4);
    for (let i = 0; i < 120; i++) stepDeck(d, sticks({ 0: { x: 0, y: 1, a: false }, 1: { x: 0, y: -1, a: false } }), DT);
    const e = towelEnds(d, 0);
    if (!e) throw new Error('no towel');
    expect(Math.hypot(e.bx - e.ax, e.bz - e.az)).toBeLessThanOrEqual(TOWEL.maxLen + 1e-6);
    for (let i = 0; i < 200; i++) stepDeck(d, sticks({ 0: { x: 1, y: 0, a: false }, 2: { x: -1, y: 0, a: false } }), DT);
    expect(d.holders[0]?.x).toBeLessThanOrEqual(-TOWEL.fence + 1e-9);
    expect(d.holders[2]?.x).toBeGreaterThanOrEqual(TOWEL.fence - 1e-9);
  });

  it('catches a balloon that comes down on the towel; one that misses bursts and scores for the throwers', () => {
    const d = newDeck(TEAMS, 4);
    place(d, 2, 4, -1);
    place(d, 3, 4, 1);
    expect(onTowel(d, 1, 4, 0.5)).toBe(true);
    expect(onTowel(d, 1, 4.5, 0.5)).toBe(false);
    expect(onTowel(d, 1, 4, 1.6)).toBe(false); // past the end of the towel
    incoming(d, 0, 4.1, 0.3);
    let all = idle(d, 60);
    expect(all.caught).toBe(1);
    expect(d.sides[1]?.stock).toBe(TOWEL.startStock + 1);
    expect(d.sides[1]?.catches).toBe(1);
    expect(d.sides[0]?.score).toBe(0);

    incoming(d, 0, 6, 2);
    all = idle(d, 60);
    expect(all.burst).toEqual(['score']);
    expect(d.sides[0]?.score).toBe(1);
    expect(towelScores(d, TEAMS, 4)).toEqual([1, 1, 0, 0]);
  });

  it('no point for a balloon on your own side, off the end of the deck or in the pool', () => {
    const d = newDeck(TEAMS, 4);
    place(d, 0, -5, -3);
    place(d, 1, -5, -1.5);
    incoming(d, 0, -2, 2);
    incoming(d, 0, TOWEL.half.x + 0.5, 0);
    incoming(d, 0, 3, -TOWEL.half.z - 0.5);
    incoming(d, 0, 3, TOWEL.half.z + 0.5);
    const all = idle(d, 60);
    expect(all.burst.sort()).toEqual(['pool', 'short', 'wide', 'wide']);
    expect(d.sides[0]?.score).toBe(0);
  });

  it('a real launch comes down where the aim point said', () => {
    const d = newDeck(TEAMS, 4);
    const at = aimPoint(d, 0, 1);
    place(d, 2, at.x, at.z - 0.9);
    place(d, 3, at.x, at.z + 0.9);
    stepDeck(d, sticks({ 0: PRESS, 1: PRESS }), DT);
    const all = idle(d, 120);
    expect(all.caught).toBe(1);
  });

  it('a pair of one launches on a single press', () => {
    const d = newDeck([[0], [1, 2]], 3);
    const ev = stepDeck(d, [PRESS, IDLE, IDLE], DT);
    expect(ev.launched.length).toBe(1);
    expect(ev.launched[0]?.power).toBeCloseTo(TOWEL.soloPower);
    const e = towelEnds(d, 0);
    expect(e && Math.hypot(e.bx - e.ax, e.bz - e.az)).toBeCloseTo(TOWEL.soloLen);
  });

  it('ends after the time', () => {
    const d = newDeck(TEAMS, 4);
    idle(d, TOWEL.duration * 60 + 5);
    expect(isOver(d)).toBe(true);
    expect(d.time).toBeCloseTo(TOWEL.duration);
  });
});

/** A whole game between computer pairs. */
function game(skills: number[], seed: number): Deck {
  const rng = createRng(seed * 7919);
  const d = newDeck(TEAMS, 4);
  const cpus = skills.map(() => newCpuHolder());
  while (!isOver(d)) {
    stepDeck(
      d,
      cpus.map((c, p) => cpuStick(c, d, p, DT, skills[p] ?? 0.5, rng)),
      DT,
    );
  }
  return d;
}

describe('towel toss computer players', () => {
  it('evenly matched pairs launch, catch some and miss some, and either side can win', () => {
    const wins = [0, 0];
    let points = 0;
    let catches = 0;
    let launches = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const d = game([0.5, 0.5, 0.5, 0.5], seed);
      const [a, b] = d.sides;
      if (!a || !b) throw new Error('no sides');
      points += a.score + b.score;
      catches += a.catches + b.catches;
      launches += a.launches + b.launches;
      if (a.score > b.score) wins[0] = (wins[0] ?? 0) + 1;
      if (b.score > a.score) wins[1] = (wins[1] ?? 0) + 1;
    }
    expect(points / 40).toBeGreaterThan(3);
    expect(points / 40).toBeLessThan(12);
    expect(catches / launches).toBeGreaterThan(0.2);
    expect(catches / launches).toBeLessThan(0.65);
    expect(wins[0]).toBeGreaterThan(4);
    expect(wins[1]).toBeGreaterThan(4);
  });

  it('sharp pairs beat sleepy ones, and sleepy ones still land a few', () => {
    let sharpWins = 0;
    let sleepy = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const d = game([1, 1, 0, 0], seed);
      if ((d.sides[0]?.score ?? 0) > (d.sides[1]?.score ?? 0)) sharpWins++;
      sleepy += d.sides[1]?.score ?? 0;
    }
    expect(sharpWins).toBeGreaterThanOrEqual(18);
    expect(sleepy / 20).toBeGreaterThan(0.5);
  });

  it('a computer answers a person’s press in time', () => {
    const rng = createRng(3);
    const d = newDeck(TEAMS, 4);
    const cpu = newCpuHolder();
    // Seat 0 is a person who presses once; seat 1 is a computer partner.
    stepDeck(d, [PRESS, cpuStick(cpu, d, 1, DT, 0.5, rng, false), IDLE, IDLE], DT);
    let launched = 0;
    for (let i = 0; i < 30; i++) launched += stepDeck(d, [IDLE, cpuStick(cpu, d, 1, DT, 0.5, rng, false), IDLE, IDLE], DT).launched.length;
    expect(launched).toBe(1);
  });
});
