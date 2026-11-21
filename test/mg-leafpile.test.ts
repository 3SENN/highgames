import { describe, expect, it } from 'vitest';
import {
  DIVE,
  IDLE,
  LEAF,
  type Stick,
  type Yard,
  advance,
  cpuStick,
  inZone,
  leafScores,
  makeLeaves,
  newBrain,
  newYard,
  pileCount,
  zoneAt,
} from '../src/game/minigames/leafpile';
import { createRng } from '../src/game/rng';

const TEAMS = [
  [0, 1],
  [2, 3],
];

/** A yard with no leaves, everyone parked well apart. */
function bare(seed = 1): Yard {
  const y = newYard(TEAMS, 4, createRng(seed));
  y.leaves = [];
  y.rakers.forEach((r, i) => {
    r.x = -4 + i * 2.6;
    r.z = 2.8;
  });
  return y;
}

const leafAt = (x: number, z: number) => ({ x, z, y: 0, vx: 0, vz: 0, vy: 0 });
const still = (n = 4): Stick[] => Array.from({ length: n }, () => ({ ...IDLE }));

/** Runs `seconds` with the given sticks (presses only on the first frame). */
function run(y: Yard, sticks: Stick[], seconds: number) {
  const evs = [];
  let first = true;
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    evs.push(advance(y, first ? sticks : sticks.map((s) => ({ ...s, a: false })), 1 / 60));
    first = false;
  }
  return evs;
}

/** A whole CPU game; returns each team's pile. */
function play(seed: number, skills: readonly number[]): [number, number] {
  const rng = createRng(seed);
  const y = newYard(TEAMS, 4, rng);
  const brains = skills.map((s) => newBrain(s, rng));
  while (y.phase !== 'done') {
    const sticks = y.rakers.map((_, i) => cpuStick(y, i, brains[i] as ReturnType<typeof newBrain>, rng));
    advance(y, sticks, 1 / 60);
  }
  return [pileCount(y, 0), pileCount(y, 1)];
}

/** How often team A beats team B over `n` games (a tie counts half). */
function winRate(skills: readonly number[], n: number, seed = 1): number {
  let wins = 0;
  for (let k = 0; k < n; k++) {
    const [a, b] = play(seed + k * 7919, skills);
    wins += a > b ? 1 : a === b ? 0.5 : 0;
  }
  return wins / n;
}

describe('leaf pile: the yard', () => {
  it('starts with the leaves mirrored left to right and none in a zone', () => {
    const leaves = makeLeaves(createRng(5));
    expect(leaves).toHaveLength(LEAF.perSide * 2);
    for (let i = 0; i < LEAF.perSide; i++) {
      const a = leaves[i];
      const b = leaves[i + LEAF.perSide];
      expect(b?.x).toBeCloseTo(-(a?.x ?? 0), 9);
      expect(b?.z).toBeCloseTo(a?.z ?? 0, 9);
    }
    for (const l of leaves) {
      expect(zoneAt(l.x, l.z)).toBe(-1);
      expect(Math.abs(l.x)).toBeLessThanOrEqual(LEAF.yard.x);
      expect(Math.abs(l.z)).toBeLessThanOrEqual(LEAF.yard.z);
    }
  });

  it('puts each team in its own half, its zone against its side fence', () => {
    const y = newYard(TEAMS, 4, createRng(2));
    expect(y.rakers.map((r) => r.team)).toEqual([0, 0, 1, 1]);
    expect(y.rakers[0]?.x).toBeLessThan(0);
    expect(y.rakers[2]?.x).toBeGreaterThan(0);
    expect(inZone(-LEAF.yard.x + 0.2, 0, 0)).toBe(true);
    expect(inZone(LEAF.yard.x - 0.2, 0, 1)).toBe(true);
    expect(inZone(LEAF.yard.x - 0.2, LEAF.zone.z + 0.3, 1)).toBe(false);
    expect(inZone(0, 0, 0)).toBe(false);
  });

  it('counts the leaves inside each zone, the same score for both partners', () => {
    const y = bare();
    y.leaves = [leafAt(-6, 0), leafAt(-5, 1), leafAt(6, 0), leafAt(0, 0), leafAt(-6, 3.4)];
    expect(pileCount(y, 0)).toBe(2);
    expect(pileCount(y, 1)).toBe(1);
    expect(leafScores(y, 4)).toEqual([2, 2, 1, 1]);
  });

  it('works with uneven teams', () => {
    const y = newYard([[0, 1], [2]], 3, createRng(3));
    expect(y.rakers[2]?.team).toBe(1);
    expect(y.rakers[2]?.z).toBe(0);
    y.leaves = [leafAt(6, 0)];
    expect(leafScores(y, 3)).toEqual([0, 0, 1]);
  });
});

describe('leaf pile: walking and pushing', () => {
  it('walks where the stick points (up on the phone is away from the audience)', () => {
    const y = bare();
    const s = still();
    s[0] = { x: 0, y: 1, a: false };
    const z0 = y.rakers[0]?.z ?? 0;
    run(y, s, 0.5);
    expect(y.rakers[0]?.z).toBeLessThan(z0 - 1);
    expect(y.rakers[0]?.x).toBeCloseTo(-4, 5);
  });

  it('pushes a leaf in front along with you', () => {
    const y = bare();
    const r = y.rakers[0];
    if (!r) throw new Error('no raker');
    r.x = -2;
    r.z = 0;
    y.leaves = [leafAt(-2.8, 0)];
    const s = still();
    s[0] = { x: -1, y: 0, a: false };
    run(y, s, 0.8);
    const l = y.leaves[0];
    expect(l?.x).toBeLessThan(-4);
    expect(l?.x).toBeLessThan(r.x);
    expect(Math.abs(l?.z ?? 9)).toBeLessThan(0.5);
  });

  it('keeps leaves and people inside the fences', () => {
    const y = bare();
    y.leaves = [leafAt(-6, 0)];
    const r = y.rakers[0];
    if (!r) throw new Error('no raker');
    r.x = -5;
    r.z = 0;
    const s = still();
    s[0] = { x: -1, y: 0, a: false };
    run(y, s, 2);
    expect(r.x).toBeGreaterThanOrEqual(-LEAF.yard.x + LEAF.bodyR - 1e-9);
    for (const l of y.leaves) expect(Math.abs(l.x)).toBeLessThanOrEqual(LEAF.yard.x);
  });

  it('keeps people from walking through each other', () => {
    const y = bare();
    const [a, b] = [y.rakers[0], y.rakers[2]];
    if (!a || !b) throw new Error('no raker');
    a.x = -1;
    a.z = 0;
    b.x = 1;
    b.z = 0;
    const s = still();
    s[0] = { x: 1, y: 0, a: false };
    s[2] = { x: -1, y: 0, a: false };
    run(y, s, 1.5);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(LEAF.bodyR * 2 - 0.02);
  });
});

describe('leaf pile: diving', () => {
  function raidSetup(): Yard {
    const y = bare(4);
    // A neat pile in team 1's zone.
    for (let k = 0; k < 30; k++) y.leaves.push(leafAt(5.9 + (k % 3) * 0.2, -1 + Math.floor(k / 3) * 0.2));
    const r = y.rakers[0];
    if (!r) throw new Error('no raker');
    r.x = 4.0;
    r.z = 0;
    r.face = Math.PI / 2; // facing +x, toward the pile
    return y;
  }

  it('scatters the other pile out of its zone, toward the middle', () => {
    const y = raidSetup();
    const before = pileCount(y, 1);
    const s = still();
    s[0] = { x: 1, y: 0, a: true };
    const evs = run(y, s, 2.5);
    const lands = evs.flatMap((e) => e.lands);
    expect(lands).toHaveLength(1);
    expect(lands[0]?.zone).toBe(1);
    expect(lands[0]?.scattered).toBeGreaterThan(5);
    expect(lands[0]?.scattered).toBeLessThanOrEqual(DIVE.maxScatter);
    expect(pileCount(y, 1)).toBeLessThan(before - 5);
    expect(y.rakers[0]?.raids).toBe(1);
    // Thrown out toward the middle, not over the fence.
    const out = y.leaves.filter((l) => !inZone(l.x, l.z, 1));
    for (const l of out) expect(l.x).toBeLessThan(LEAF.zone.x + 0.01);
    for (const l of y.leaves) expect(l.y).toBe(0);
  });

  it('only fluffs up your own pile', () => {
    const y = raidSetup();
    const r = y.rakers[2]; // team 1
    if (!r) throw new Error('no raker');
    r.x = 4.0;
    r.z = -2.5;
    r.face = Math.PI / 2;
    y.rakers[0]!.x = -4;
    const before = pileCount(y, 1);
    const s = still();
    s[2] = { x: 0.8, y: -0.3, a: true };
    run(y, s, 2.5);
    expect(pileCount(y, 1)).toBe(before);
    expect(r.raids).toBe(0);
  });

  it('lies you down for a moment and makes you wait before the next dive', () => {
    const y = bare();
    const r = y.rakers[0];
    if (!r) throw new Error('no raker');
    r.x = -2;
    r.z = 0;
    const press = still();
    press[0] = { x: 1, y: 0, a: true };
    const first = advance(y, press, 1 / 60);
    expect(first.dives).toEqual([0]);
    // Holding the stick while lying in the leaves goes nowhere.
    run(y, still(), DIVE.time + 0.05);
    const at = r.x;
    const walk = still();
    walk[0] = { x: 1, y: 0, a: false };
    run(y, walk, DIVE.down * 0.7);
    expect(r.x).toBeCloseTo(at, 5);
    // Too soon: refused.
    const again = advance(y, press, 1 / 60);
    expect(again.dives).toEqual([]);
    expect(again.denied).toEqual([0]);
    run(y, still(), DIVE.cooldown);
    expect(advance(y, press, 1 / 60).dives).toEqual([0]);
    expect(r.dives).toBe(2);
  });

  it('counts a press once, however many steps a long frame takes', () => {
    const y = bare();
    const s = still();
    s[0] = { x: 1, y: 0, a: true };
    const ev = advance(y, s, 0.5);
    expect(ev.steps).toBe(60);
    expect(ev.dives).toEqual([0]);
    expect(ev.denied).toEqual([]);
  });

  it('stops a dive that runs into someone guarding the pile', () => {
    const y = raidSetup();
    const guard = y.rakers[2];
    if (!guard) throw new Error('no raker');
    guard.x = 4.9;
    guard.z = 0;
    const s = still();
    s[0] = { x: 1, y: 0, a: true };
    const evs = run(y, s, 0.5);
    const land = evs.flatMap((e) => e.lands)[0];
    expect(land).toBeDefined();
    expect(land?.x ?? 9).toBeLessThan(4.9);
    expect(pileCount(y, 1)).toBeGreaterThan(20);
  });

  it('still counts a dive pressed just before time, by half the phone’s round trip', () => {
    const late = (lag: number) => {
      const y = bare();
      y.time = LEAF.duration + 0.05;
      y.phase = 'settle';
      const s = still();
      s[0] = { x: 1, y: 0, a: true };
      return advance(y, s, 1 / 60, [lag, 0, 0, 0]).dives;
    };
    expect(late(0)).toEqual([]);
    expect(late(0.1)).toEqual([0]);
  });

  it('lets the leaves come down before the count, then stops', () => {
    const y = bare();
    y.leaves = [{ x: 0, z: 0, y: 0.5, vx: 0, vz: 0, vy: 2 }];
    y.time = LEAF.duration - 0.01;
    run(y, still(), LEAF.settle + 0.3);
    expect(y.phase).toBe('done');
    expect(y.leaves[0]?.y).toBe(0);
  });
});

describe('leaf pile: computer players', () => {
  it('rake leaves into their own pile', () => {
    // One sharp computer alone in the yard.
    const rng = createRng(11);
    const y = newYard([[0], [1]], 2, rng);
    const b = newBrain(0.9, rng);
    while (y.phase !== 'done') advance(y, [{ ...cpuStick(y, 0, b, rng), a: false }, IDLE], 1 / 60);
    expect(pileCount(y, 0)).toBeGreaterThan(20);
    expect(pileCount(y, 1)).toBe(0);
  });

  it('go and dive into a big pile now and then', () => {
    let dives = 0;
    for (let k = 0; k < 4; k++) {
      const rng = createRng(100 + k);
      const y = newYard(TEAMS, 4, rng);
      const brains = [0.8, 0.8, 0.8, 0.8].map((s) => newBrain(s, rng));
      while (y.phase !== 'done') {
        const sticks = y.rakers.map((_, i) => cpuStick(y, i, brains[i] as ReturnType<typeof newBrain>, rng));
        dives += advance(y, sticks, 1 / 60).lands.filter((l) => l.zone >= 0).length;
      }
    }
    expect(dives).toBeGreaterThan(4);
  });

  it('balance: sharp beats sleepy, equal is even, average is beatable but not hopeless', { timeout: 60_000 }, () => {
    const sharpVsSleepy = winRate([0.9, 0.9, 0.1, 0.1], 24);
    const even = winRate([0.5, 0.5, 0.5, 0.5], 24, 3);
    const avgVsSharp = winRate([0.5, 0.5, 0.9, 0.9], 24, 5);
    expect(sharpVsSleepy).toBeGreaterThan(0.75);
    expect(even).toBeGreaterThan(0.25);
    expect(even).toBeLessThan(0.75);
    expect(avgVsSharp).toBeGreaterThan(0.05);
    expect(avgVsSharp).toBeLessThan(0.45);
  });
});
