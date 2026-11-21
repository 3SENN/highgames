import { describe, expect, it } from 'vitest';
import {
  IDLE,
  KINDS,
  MESS,
  type Room,
  START_MESS,
  type Stick,
  boostOf,
  cpuStick,
  halfAt,
  inReach,
  isOver,
  isSettled,
  messOn,
  messScores,
  newCpuTidier,
  newRoom,
  ringBell,
  stepRoom,
  stepSettle,
  tossAngle,
  worth,
} from '../src/game/minigames/notmyside';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;
const TEAMS = [
  [0, 1],
  [2, 3],
];

function sticks(over: Partial<Record<number, Stick>>): Stick[] {
  return [0, 1, 2, 3].map((p) => over[p] ?? IDLE);
}

function room(seed = 1): Room {
  return newRoom(TEAMS, 4, createRng(seed));
}

/** Puts someone somewhere, standing still. */
function place(r: Room, p: number, x: number, z: number): void {
  const c = r.tidiers[p];
  if (!c) throw new Error('no tidier');
  c.x = x;
  c.z = z;
  c.vx = 0;
  c.vz = 0;
}

/** Clears the room down to a single item at (x, z). */
function only(r: Room, kind: 'sock' | 'cushion', x: number, z: number): void {
  r.items = [{ id: 1, kind, x, y: 0, z, vx: 0, vy: 0, vz: 0, state: 'floor', holder: -1, thrower: -1, touched: true }];
}

/** Adds a piece of mess lying at (x, z). */
function add(r: Room, kind: 'sock' | 'cushion' | 'can' | 'plant', x: number, z: number): void {
  r.items.push({ id: r.items.length + 1, kind, x, y: 0, z, vx: 0, vy: 0, vz: 0, state: 'floor', holder: -1, thrower: -1, touched: true });
}

function tap(r: Room, p: number, dir: Stick = { x: 0, y: 0, a: true }): void {
  stepRoom(r, sticks({ [p]: dir }), DT);
  stepRoom(r, sticks({}), DT);
}

describe('not my side', () => {
  it('starts both halves equally messy, with nothing inside the furniture', () => {
    for (let seed = 1; seed < 30; seed++) {
      const r = room(seed);
      expect(r.items.length).toBe(START_MESS.length * 2);
      expect(messOn(r, 0)).toBe(messOn(r, 1));
      expect(messOn(r, 0)).toBe(START_MESS.reduce((n, k) => n + worth(k), 0));
      for (const it of r.items) {
        expect(Math.abs(it.x)).toBeLessThan(MESS.half.x);
        expect(Math.abs(it.z)).toBeLessThan(MESS.half.z);
        const rad = KINDS[it.kind].r;
        for (const f of r.furniture) expect(Math.abs(it.x - f.x) < f.hx + rad && Math.abs(it.z - f.z) < f.hz + rad).toBe(false);
      }
    }
    expect(room().teamOf).toEqual([0, 0, 1, 1]);
  });

  it('counts big things double', () => {
    expect(worth('cushion')).toBe(2);
    expect(worth('pizza')).toBe(2);
    expect(worth('plant')).toBe(2);
    expect(worth('sock')).toBe(1);
    expect(worth('can')).toBe(1);
  });

  it('walks where the stick points and never crosses the tape', () => {
    const r = room();
    const z0 = r.tidiers[0]?.z ?? 0;
    for (let i = 0; i < 20; i++) stepRoom(r, sticks({ 0: { x: 0, y: 1, a: false } }), DT);
    expect(r.tidiers[0]?.z).toBeLessThan(z0);
    for (let i = 0; i < 300; i++) stepRoom(r, sticks({ 0: { x: 1, y: 0, a: false }, 2: { x: -1, y: 0, a: false } }), DT);
    expect(r.tidiers[0]?.x).toBeLessThanOrEqual(-MESS.tape + 1e-9);
    expect(r.tidiers[2]?.x).toBeGreaterThanOrEqual(MESS.tape - 1e-9);
  });

  it('picks up the nearest thing in reach and carries it overhead, a little slower', () => {
    const r = room();
    place(r, 0, -3, 0);
    only(r, 'cushion', -2.6, 0);
    add(r, 'cushion', 4, 0); // as much mess on the other side: no second wind either way
    expect(inReach(r, 0)?.id).toBe(1);
    tap(r, 0);
    expect(r.tidiers[0]?.holding).toBe(1);
    expect(r.items[0]?.state).toBe('held');
    // Walk for a second: slower than empty-handed.
    place(r, 0, -6, -2);
    for (let i = 0; i < 60; i++) stepRoom(r, sticks({ 0: { x: 0, y: -1, a: false } }), DT);
    const carried = (r.tidiers[0]?.z ?? 0) + 2;
    const r2 = room();
    place(r2, 0, -6, -2);
    r2.items = [];
    for (let i = 0; i < 60; i++) stepRoom(r2, sticks({ 0: { x: 0, y: -1, a: false } }), DT);
    const free = (r2.tidiers[0]?.z ?? 0) + 2;
    expect(carried).toBeLessThan(free * 0.9);
    expect(carried).toBeGreaterThan(free * 0.6);
    expect(r.items[0]?.x).toBeCloseTo(r.tidiers[0]?.x ?? 0);
    // A press with nothing in reach does nothing.
    const r3 = room();
    place(r3, 0, -3, 0);
    r3.items = [];
    const ev = stepRoom(r3, sticks({ 0: { x: 0, y: 0, a: true } }), DT);
    expect(ev.whiffs).toEqual([0]);
  });

  it('a toss from near the tape lands on the other side; one from the back wall falls short', () => {
    const r = room();
    place(r, 0, -1, 0);
    only(r, 'sock', -0.7, 0);
    tap(r, 0);
    expect(r.tidiers[0]?.holding).toBe(1);
    expect(messOn(r, 0)).toBe(1);
    const ev = stepRoom(r, sticks({ 0: { x: 1, y: 0, a: true } }), DT);
    expect(ev.thrown.length).toBe(1);
    for (let i = 0; i < 240 && !isSettled(r); i++) stepRoom(r, sticks({}), DT);
    expect(isSettled(r)).toBe(true);
    expect(halfAt(r.items[0]?.x ?? 0)).toBe(1);
    expect(messOn(r, 0)).toBe(0);
    expect(messOn(r, 1)).toBe(1);
    expect(r.tidiers[0]?.over).toBe(1);

    const r2 = room();
    place(r2, 0, -6.2, 0);
    only(r2, 'sock', -5.9, 0);
    add(r2, 'sock', 5, 3); // level, so no second wind
    tap(r2, 0);
    stepRoom(r2, sticks({ 0: { x: 1, y: 0, a: true } }), DT);
    for (let i = 0; i < 240 && !isSettled(r2); i++) stepRoom(r2, sticks({}), DT);
    expect(halfAt(r2.items[0]?.x ?? 0)).toBe(0);
  });

  it('gives the messier side a second wind that grows the further behind it is', () => {
    const r = room();
    r.items = [];
    expect(boostOf(r, 0)).toBe(0);
    add(r, 'sock', -2, 0);
    expect(boostOf(r, 0)).toBeCloseTo(MESS.catchUp.max / MESS.catchUp.span);
    expect(boostOf(r, 1)).toBe(0); // ahead: nothing
    add(r, 'cushion', -3, 1);
    add(r, 'plant', -4, -1);
    add(r, 'can', -5, 2);
    expect(messOn(r, 0)).toBe(6);
    expect(boostOf(r, 0)).toBeCloseTo(MESS.catchUp.max); // capped
    add(r, 'cushion', 3, 0);
    add(r, 'cushion', 4, 1);
    expect(boostOf(r, 0)).toBeCloseTo(MESS.catchUp.max * (2 / MESS.catchUp.span));
  });

  it('a second wind means quicker feet and longer tosses', () => {
    // The same run and the same toss, once level and once far behind.
    const trial = (behind: boolean) => {
      const r = room();
      place(r, 0, -1, -2.5);
      only(r, 'sock', -0.8, -2.5);
      add(r, 'sock', 6, -3); // level...
      if (behind) for (let i = 0; i < 4; i++) add(r, 'cushion', -6, -2 + i * 1.2); // ...or 7 points worse off
      tap(r, 0);
      for (let i = 0; i < 30; i++) stepRoom(r, sticks({ 0: { x: 0, y: -1, a: false } }), DT);
      const walked = (r.tidiers[0]?.z ?? 0) + 2.5;
      stepRoom(r, sticks({ 0: { x: 1, y: 0, a: true } }), DT);
      for (let i = 0; i < 300 && !isSettled(r); i++) stepRoom(r, sticks({}), DT);
      return { walked, landed: r.items[0]?.x ?? 0 };
    };
    const level = trial(false);
    const behind = trial(true);
    expect(behind.walked).toBeGreaterThan(level.walked * (1 + MESS.catchUp.max * 0.8));
    expect(behind.landed).toBeGreaterThan(level.landed + 0.5);
  });

  it('tosses the way you face, kept to the forward arc', () => {
    const r = room();
    const c = r.tidiers[0];
    if (!c) throw new Error('no tidier');
    c.fx = 0;
    c.fz = 1;
    expect(tossAngle(r, 0)).toBeCloseTo(MESS.maxAngle);
    c.fx = -1;
    c.fz = 0;
    expect(tossAngle(r, 0)).toBeCloseTo(0);
    const d = r.tidiers[2];
    if (!d) throw new Error('no tidier');
    d.fx = -1;
    d.fz = -0.2;
    expect(tossAngle(r, 2)).toBeCloseTo(Math.atan2(-0.2, 1));
  });

  it('bounces off furniture and walls and stays in the room', () => {
    const r = room();
    const chair = r.furniture[2];
    if (!chair) throw new Error('no chair');
    // Lob straight at the armchair on the right, low: it bounces back.
    r.items = [{ id: 1, kind: 'can', x: chair.x - 1.5, y: 0.4, z: chair.z, vx: 6, vy: 0.5, vz: 0, state: 'air', holder: -1, thrower: 0, touched: false }];
    let bumps = 0;
    for (let i = 0; i < 300 && !isSettled(r); i++) bumps += stepRoom(r, sticks({}), DT).bumped.length;
    expect(bumps).toBeGreaterThan(0);
    expect(r.items[0]?.x).toBeLessThan(chair.x - chair.hx);
    // Something dropped on top of a table tumbles off onto the floor.
    const table = r.furniture[3];
    if (!table) throw new Error('no table');
    r.items = [{ id: 1, kind: 'sock', x: table.x, y: 2, z: table.z, vx: 0.2, vy: 0, vz: 0, state: 'air', holder: -1, thrower: 0, touched: false }];
    for (let i = 0; i < 400 && !isSettled(r); i++) stepRoom(r, sticks({}), DT);
    const it = r.items[0];
    expect(it?.state).toBe('floor');
    expect(Math.abs((it?.x ?? 0) - table.x) >= table.hx + KINDS.sock.r - 1e-6 || Math.abs((it?.z ?? 0) - table.z) >= table.hz + KINDS.sock.r - 1e-6).toBe(true);
    // Hurled at a wall: stays inside.
    r.items = [{ id: 1, kind: 'sock', x: 5, y: 1, z: 0, vx: 20, vy: 2, vz: 9, state: 'air', holder: -1, thrower: 0, touched: false }];
    for (let i = 0; i < 400 && !isSettled(r); i++) stepRoom(r, sticks({}), DT);
    expect(Math.abs(r.items[0]?.x ?? 99)).toBeLessThan(MESS.half.x);
    expect(Math.abs(r.items[0]?.z ?? 99)).toBeLessThan(MESS.half.z);
  });

  it('rings at the time; held things are put down where they stand and flying things land', () => {
    const r = room();
    place(r, 0, -1, 0);
    only(r, 'cushion', -0.8, 0);
    r.items.push({ id: 2, kind: 'sock', x: -2, y: 1.5, z: 1, vx: 4, vy: 3, vz: 0, state: 'air', holder: -1, thrower: 0, touched: false });
    tap(r, 0);
    for (let i = 0; i < MESS.duration * 60 + 5; i++) stepRoom(r, sticks({ 0: { x: 0.3, y: 0, a: false } }), DT);
    expect(isOver(r)).toBe(true);
    expect(r.time).toBeCloseTo(MESS.duration);
    ringBell(r);
    expect(r.tidiers[0]?.holding).toBe(-1);
    expect(r.items[0]?.state).toBe('floor');
    expect(halfAt(r.items[0]?.x ?? 0)).toBe(0);
    for (let i = 0; i < 200 && !isSettled(r); i++) stepSettle(r, DT);
    expect(isSettled(r)).toBe(true);
    // After the bell, sticks do nothing.
    const x = r.tidiers[0]?.x;
    stepRoom(r, sticks({ 0: { x: -1, y: 0, a: true } }), DT);
    expect(r.tidiers[0]?.x).toBe(x);
  });

  it('scores each pair by the mess on the other side', () => {
    const r = room();
    r.items = [
      { id: 1, kind: 'cushion', x: -2, y: 0, z: 0, vx: 0, vy: 0, vz: 0, state: 'floor', holder: -1, thrower: -1, touched: true },
      { id: 2, kind: 'sock', x: 2, y: 0, z: 0, vx: 0, vy: 0, vz: 0, state: 'floor', holder: -1, thrower: -1, touched: true },
      { id: 3, kind: 'can', x: 3, y: 0, z: 0, vx: 0, vy: 0, vz: 0, state: 'floor', holder: -1, thrower: -1, touched: true },
      { id: 4, kind: 'plant', x: 4, y: 0, z: 0, vx: 0, vy: 0, vz: 0, state: 'floor', holder: -1, thrower: -1, touched: true },
    ];
    expect(messOn(r, 0)).toBe(2);
    expect(messOn(r, 1)).toBe(4);
    expect(messScores(r, TEAMS, 4)).toEqual([4, 4, 2, 2]);
  });
});

/** A whole game between computer pairs; returns the mess on each side at the bell. */
function game(skills: number[], seed: number): [number, number] {
  const rng = createRng(seed * 7919);
  const r = newRoom(TEAMS, 4, createRng(seed));
  const cpus = skills.map(() => newCpuTidier());
  while (!isOver(r)) {
    stepRoom(
      r,
      cpus.map((c, p) => cpuStick(c, r, p, DT, skills[p] ?? 0.5, rng)),
      DT,
    );
  }
  ringBell(r);
  for (let i = 0; i < MESS.settle * 60 && !isSettled(r); i++) stepSettle(r, DT);
  return [messOn(r, 0), messOn(r, 1)];
}

describe('not my side computer players', () => {
  it('evenly matched pairs keep busy and either side can win', () => {
    const wins = [0, 0];
    let tossed = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const rng = createRng(seed * 7919);
      const r = newRoom(TEAMS, 4, createRng(seed));
      const cpus = [0, 1, 2, 3].map(() => newCpuTidier());
      while (!isOver(r)) stepRoom(r, cpus.map((c, p) => cpuStick(c, r, p, DT, 0.5, rng)), DT);
      ringBell(r);
      for (let i = 0; i < MESS.settle * 60 && !isSettled(r); i++) stepSettle(r, DT);
      tossed += r.tidiers.reduce((n, c) => n + c.tosses, 0);
      const [a, b] = [messOn(r, 0), messOn(r, 1)];
      if (a < b) wins[0] = (wins[0] ?? 0) + 1;
      if (b < a) wins[1] = (wins[1] ?? 0) + 1;
    }
    const perPlayer = tossed / 24 / 4;
    expect(perPlayer).toBeGreaterThan(5);
    expect(perPlayer).toBeLessThan(20);
    expect(wins[0]).toBeGreaterThan(5);
    expect(wins[1]).toBeGreaterThan(5);
  });

  it('sharp pairs leave the sleepy pair the messier room most of the time', () => {
    let sharpWins = 0;
    let margin = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const [a, b] = game([1, 1, 0, 0], seed);
      if (a < b) sharpWins++;
      margin += b - a;
      const [c, d] = game([0, 0, 1, 1], seed + 100);
      if (d < c) sharpWins++;
      margin += c - d;
    }
    expect(sharpWins).toBeGreaterThanOrEqual(42);
    expect(margin / 48).toBeGreaterThan(5);
  });

  it('an average pair beats a sleepy one most of the time', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const [a, b] = game([0.5, 0.5, 0.1, 0.1], seed);
      if (a < b) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(18);
  });

  it('thanks to the second wind, a slightly weaker pair still wins about a third of the time', () => {
    // An average pair (0.5) against a pair that makes roughly 12% more tosses (0.8), from both sides of the tape.
    const series = (seeds: number) => {
      let weakerWins = 0;
      let draws = 0;
      let weakTosses = 0;
      let strongTosses = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        for (const flip of [false, true]) {
          const skills = flip ? [0.8, 0.8, 0.5, 0.5] : [0.5, 0.5, 0.8, 0.8];
          const rng = createRng((seed + (flip ? 500 : 0)) * 7919);
          const r = newRoom(TEAMS, 4, createRng(seed + (flip ? 500 : 0)));
          const cpus = skills.map(() => newCpuTidier());
          while (!isOver(r)) stepRoom(r, cpus.map((c, p) => cpuStick(c, r, p, DT, skills[p] ?? 0.5, rng)), DT);
          ringBell(r);
          for (let i = 0; i < MESS.settle * 60 && !isSettled(r); i++) stepSettle(r, DT);
          const weak = flip ? 1 : 0;
          const [mine, theirs] = [messOn(r, weak), messOn(r, 1 - weak)];
          if (mine < theirs) weakerWins++;
          if (mine === theirs) draws++;
          const tosses = r.tidiers.map((c) => c.tosses);
          weakTosses += weak === 0 ? (tosses[0] ?? 0) + (tosses[1] ?? 0) : (tosses[2] ?? 0) + (tosses[3] ?? 0);
          strongTosses += weak === 0 ? (tosses[2] ?? 0) + (tosses[3] ?? 0) : (tosses[0] ?? 0) + (tosses[1] ?? 0);
        }
      }
      return { win: weakerWins / (seeds * 2), notLost: (weakerWins + draws) / (seeds * 2), more: strongTosses / weakTosses - 1 };
    };
    // Without the second wind, the stronger pair's ~12% more tosses decide nearly every game.
    const catchUp = MESS.catchUp as { max: number };
    const max = catchUp.max;
    catchUp.max = 0;
    let off: ReturnType<typeof series>;
    try {
      off = series(20);
    } finally {
      catchUp.max = max;
    }
    expect(off.more).toBeGreaterThan(0.08);
    expect(off.more).toBeLessThan(0.16);
    expect(off.win).toBeLessThan(0.12);
    // With it, the weaker pair wins about a third of its games and avoids losing in about half.
    const on = series(40);
    expect(on.win).toBeGreaterThanOrEqual(0.25);
    expect(on.win).toBeLessThanOrEqual(0.42);
    expect(on.notLost).toBeGreaterThan(0.45);
  });
});
