import { describe, expect, it } from 'vitest';
import {
  FIREFLY,
  type Fly,
  type Meadow,
  type Stick,
  IDLE,
  advance,
  brightest,
  cpuStick,
  inNet,
  isOver,
  jarScores,
  newBrain,
  newMeadow,
  startles,
  stepMeadow,
} from '../src/game/minigames/fireflycatch';
import { createRng } from '../src/game/rng';

const TEAMS = [
  [0, 1],
  [2, 3],
];
const DT = FIREFLY.step;

/** A meadow with no fireflies (and none on the way), everyone parked out of the way. */
function emptyMeadow(seed = 1): Meadow {
  const m = newMeadow(TEAMS, 4, createRng(seed));
  m.flies = [];
  m.wave = FIREFLY.goldWaves.length;
  m.catchers.forEach((c, i) => {
    c.x = -5 + i * 3.3;
    c.z = 3;
    c.face = 0;
  });
  return m;
}

/** Puts a still firefly at (x, z). */
function place(m: Meadow, x: number, z: number, gold = false): Fly {
  const f: Fly = { id: m.nextId++, x, z, vx: 0, vz: 0, heading: 0, turnRate: 0, gold, lit: true, blink: 99, rise: 0, flit: 0, life: gold ? 99 : Infinity };
  m.flies.push(f);
  return f;
}

/** Runs `seconds` of steps with the same sticks (a press only in the first step). */
function run(m: Meadow, sticks: Stick[], seconds: number, lags: number[] = []) {
  const all = { catches: 0, swings: 0, whiffs: 0, spooked: 0 };
  let input = sticks;
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const ev = stepMeadow(m, input, DT, lags);
    input = sticks.map((s) => ({ ...s, a: false }));
    all.catches += ev.catches.length;
    all.swings += ev.swings.length;
    all.whiffs += ev.whiffs.length;
    all.spooked += ev.spooked.length;
  }
  return all;
}

/** Holds everyone still, without letting the fireflies wander off. */
function hold(m: Meadow): void {
  for (const f of m.flies) {
    f.vx = 0;
    f.vz = 0;
  }
}

const press = (i: number): Stick[] => [0, 1, 2, 3].map((k) => (k === i ? { x: 0, y: 0, a: true } : IDLE));

describe('firefly jar: the meadow', () => {
  it('starts both teams by their own jars with a mirrored meadow of fireflies', () => {
    for (let seed = 1; seed < 20; seed++) {
      const m = newMeadow(TEAMS, 4, createRng(seed));
      expect(m.flies).toHaveLength(FIREFLY.flies);
      for (const f of m.flies) {
        const twin = m.flies.find((g) => g !== f && Math.abs(g.x + f.x) < 1e-9 && Math.abs(g.z - f.z) < 1e-9);
        expect(twin).toBeDefined();
        expect(twin?.lit).toBe(f.lit);
        expect(Math.abs(f.x)).toBeLessThanOrEqual(FIREFLY.bounds.x);
        expect(Math.abs(f.z)).toBeLessThanOrEqual(FIREFLY.bounds.z);
      }
      expect(m.catchers[0]?.x).toBeLessThan(0);
      expect(m.catchers[1]?.x).toBeLessThan(0);
      expect(m.catchers[2]?.x).toBeGreaterThan(0);
      expect(m.catchers[3]?.x).toBeGreaterThan(0);
      expect(m.jars.map((j) => j.value)).toEqual([0, 0]);
    }
  });

  it('walks where the stick points (up on the phone is away from the audience) and turns to face it', () => {
    const m = emptyMeadow();
    const c = m.catchers[0];
    if (!c) throw new Error('no catcher');
    c.x = 0;
    c.z = 0;
    run(m, [{ x: 0, y: 1, a: false }, IDLE, IDLE, IDLE], 0.5);
    expect(c.z).toBeLessThan(-0.8);
    expect(Math.abs(c.x)).toBeLessThan(1e-6);
    expect(Math.abs(Math.abs(c.face) - Math.PI)).toBeLessThan(0.01);
    run(m, [{ x: 1, y: 0, a: false }, IDLE, IDLE, IDLE], 0.5);
    expect(c.x).toBeGreaterThan(0.8);
    expect(c.face).toBeCloseTo(Math.PI / 2, 2);
  });

  it('ignores a stick inside the deadzone and keeps everyone inside the meadow', () => {
    const m = emptyMeadow();
    const c = m.catchers[0];
    if (!c) throw new Error('no catcher');
    c.x = 0;
    c.z = 0;
    run(m, [{ x: 0.1, y: 0.05, a: false }, IDLE, IDLE, IDLE], 1);
    expect(Math.hypot(c.x, c.z)).toBeLessThan(1e-9);
    run(m, [{ x: -1, y: -1, a: false }, IDLE, IDLE, IDLE], 5);
    expect(c.x).toBeCloseTo(-FIREFLY.bounds.x, 6);
    expect(c.z).toBeCloseTo(FIREFLY.bounds.z, 6);
  });

  it('tiptoes when the stick is pushed gently and runs at full stick', () => {
    const m = emptyMeadow();
    const [a, b] = m.catchers;
    if (!a || !b) throw new Error('no catchers');
    a.x = -3;
    a.z = 0;
    b.x = -5;
    b.z = 2;
    run(m, [{ x: 0.5, y: 0, a: false }, { x: 1, y: 0, a: false }, IDLE, IDLE], 1);
    expect(Math.hypot(a.vx, a.vz)).toBeLessThanOrEqual(FIREFLY.sneak);
    expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(FIREFLY.sneak * 1.5);
  });

  it('keeps people from walking through each other', () => {
    const m = emptyMeadow();
    const [a, b] = m.catchers;
    if (!a || !b) throw new Error('no catchers');
    a.x = -1;
    a.z = 0;
    b.x = 1;
    b.z = 0;
    run(m, [{ x: 1, y: 0, a: false }, { x: -1, y: 0, a: false }, IDLE, IDLE], 1.5);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(FIREFLY.bodyR * 2 - 0.02);
  });
});

describe('firefly jar: nets', () => {
  it('catches a firefly in front of the net into the team’s jar, and a new one rises later', () => {
    const m = emptyMeadow();
    const c = m.catchers[2];
    if (!c) throw new Error('no catcher');
    c.x = 0;
    c.z = 0;
    c.face = Math.PI / 2; // facing +x
    place(m, FIREFLY.reach, 0);
    hold(m);
    const ev = run(m, press(2), FIREFLY.swing + 0.05);
    expect(ev.catches).toBe(1);
    expect(m.jars[1]).toEqual({ value: 1, flies: 1, golds: 0 });
    expect(m.jars[0]?.value).toBe(0);
    expect(c.caught).toBe(1);
    expect(m.flies).toHaveLength(0);
    expect(m.pending).toHaveLength(1);
    run(m, [IDLE, IDLE, IDLE, IDLE], FIREFLY.respawn[1] + 0.1);
    expect(m.flies).toHaveLength(1);
    expect(m.flies[0]?.gold).toBe(false);
  });

  it('misses a firefly behind you (but scoops one right at your feet)', () => {
    const m = emptyMeadow();
    const c = m.catchers[0];
    if (!c) throw new Error('no catcher');
    c.x = 0;
    c.z = 0;
    c.face = 0; // facing the audience
    place(m, 0, -1.2);
    hold(m);
    const ev = run(m, press(0), FIREFLY.swing + 0.05);
    expect(ev.catches).toBe(0);
    expect(ev.whiffs).toBe(1);
    expect(c.whiffs).toBe(1);
    expect(inNet(c, 0, -0.3)).toBe(true);
    expect(inNet(c, 0, FIREFLY.reach + FIREFLY.netR + 0.05)).toBe(false);
  });

  it('counts a golden firefly three', () => {
    const m = emptyMeadow();
    const c = m.catchers[0];
    if (!c) throw new Error('no catcher');
    c.x = 0;
    c.z = 0;
    c.face = 0;
    place(m, 0, FIREFLY.reach, true);
    run(m, press(0), FIREFLY.swing + 0.05);
    expect(m.jars[0]).toEqual({ value: FIREFLY.goldValue, flies: 1, golds: 1 });
    expect(c.golds).toBe(1);
    expect(m.pending).toHaveLength(0); // golden ones aren't replaced
  });

  it('takes at most a couple of fireflies in one swing', () => {
    const m = emptyMeadow();
    const c = m.catchers[0];
    if (!c) throw new Error('no catcher');
    c.x = 0;
    c.z = 0;
    c.face = 0;
    for (let k = 0; k < 4; k++) place(m, (k - 1.5) * 0.15, FIREFLY.reach);
    hold(m);
    run(m, press(0), FIREFLY.swing + 0.05);
    expect(c.caught).toBe(FIREFLY.maxPerSwing);
    expect(m.flies).toHaveLength(4 - FIREFLY.maxPerSwing);
  });

  it('needs the cooldown between swings, but remembers a press just before it ends', () => {
    const m = emptyMeadow();
    const c = m.catchers[0];
    if (!c) throw new Error('no catcher');
    expect(run(m, press(0), 0.4).swings).toBe(1);
    expect(run(m, press(0), 0.1).swings).toBe(0); // too soon: ignored
    run(m, [IDLE, IDLE, IDLE, IDLE], FIREFLY.cooldown - 0.5 - FIREFLY.buffer / 2);
    expect(c.cool).toBeGreaterThan(0);
    expect(run(m, press(0), FIREFLY.buffer).swings).toBe(1); // waited for the cooldown, then swung
  });

  it('gives a firefly two nets reach for to the earlier swing, with half the round trip taken off', () => {
    const m = emptyMeadow();
    const [a, , b] = m.catchers;
    if (!a || !b) throw new Error('no catchers');
    a.x = -FIREFLY.reach;
    a.z = 0;
    a.face = Math.PI / 2;
    b.x = FIREFLY.reach;
    b.z = 0;
    b.face = -Math.PI / 2;
    place(m, 0, 0);
    hold(m);
    // Both presses land in the same step, but b's phone is slower: b pressed earlier.
    const both: Stick[] = [
      { x: 0, y: 0, a: true },
      IDLE,
      { x: 0, y: 0, a: true },
      IDLE,
    ];
    run(m, both, FIREFLY.swing + 0.05, [0, 0, 0.1, 0]);
    expect(b.caught).toBe(1);
    expect(a.caught).toBe(0);
    expect(m.jars[1]?.value).toBe(1);
  });
});

describe('firefly jar: golden fireflies', () => {
  it('turns up in mirrored pairs on schedule and floats off if nobody catches them', () => {
    const m = newMeadow(TEAMS, 4, createRng(3));
    run(m, [IDLE, IDLE, IDLE, IDLE], FIREFLY.goldWaves[0] + 0.05);
    const gold = m.flies.filter((f) => f.gold);
    expect(gold).toHaveLength(2);
    expect((gold[0]?.x ?? 0) * (gold[1]?.x ?? 0)).toBeLessThan(0); // one on each side
    run(m, [IDLE, IDLE, IDLE, IDLE], FIREFLY.rise + FIREFLY.goldLife + 0.1);
    expect(m.flies.filter((f) => f.gold && gold.includes(f))).toHaveLength(0);
  });

  it('dart off from someone running at them, but not from someone tiptoeing', () => {
    expect(startles({ x: 0, z: 0, vx: 0, vz: 3.5 }, { x: 0, z: 2 })).toBe(true);
    expect(startles({ x: 0, z: 0, vx: 0, vz: FIREFLY.sneak * 0.9 }, { x: 0, z: 2 })).toBe(false);
    expect(startles({ x: 0, z: 0, vx: 0, vz: -3.5 }, { x: 0, z: 2 })).toBe(false); // running away from it
    expect(startles({ x: 0, z: 0, vx: 0, vz: 3.5 }, { x: 0, z: FIREFLY.notice + 0.2 })).toBe(false); // too far to notice

    const m = emptyMeadow();
    const c = m.catchers[0];
    if (!c) throw new Error('no catcher');
    c.x = -3;
    c.z = 0;
    const g = place(m, 0, 0, true);
    const ev = run(m, [{ x: 1, y: 0, a: false }, IDLE, IDLE, IDLE], 0.8);
    expect(ev.spooked).toBeGreaterThan(0);
    expect(c.spooks).toBeGreaterThan(0);
    expect(g.x).toBeGreaterThan(0.8);

    const m2 = emptyMeadow();
    const c2 = m2.catchers[0];
    if (!c2) throw new Error('no catcher');
    c2.x = -3;
    c2.z = 0;
    c2.face = Math.PI / 2;
    place(m2, 0, 0, true);
    hold(m2);
    let caught = 0;
    for (let k = 0; k < 400 && caught === 0; k++) {
      const near = m2.flies[0] ? Math.abs((m2.flies[0].x ?? 0) - c2.x) < FIREFLY.reach : false;
      const ev2 = stepMeadow(m2, [{ x: 0.45, y: 0, a: near && c2.swing < 0 }, IDLE, IDLE, IDLE], DT);
      caught += ev2.catches.length;
      expect(ev2.spooked).toHaveLength(0);
    }
    expect(caught).toBe(1);
    expect(m2.jars[0]?.value).toBe(FIREFLY.goldValue);
  });
});

describe('firefly jar: time and scores', () => {
  it('steps at 120 Hz, catches up on long frames (up to a limit) and counts a press once', () => {
    const m = emptyMeadow();
    expect(advance(m, [IDLE, IDLE, IDLE, IDLE], 0.5).steps).toBe(60);
    expect(advance(m, [IDLE, IDLE, IDLE, IDLE], 5).steps).toBe(Math.round(FIREFLY.maxFrame / FIREFLY.step));
    const ev = advance(m, press(0), 2.0);
    expect(ev.swings).toEqual([0]);
  });

  it('ends after 35 s and gives both partners their jar', () => {
    const m = emptyMeadow();
    m.jars[0] = { value: 7, flies: 5, golds: 1 };
    m.jars[1] = { value: 4, flies: 4, golds: 0 };
    while (!isOver(m)) advance(m, [IDLE, IDLE, IDLE, IDLE], 0.5);
    expect(m.time).toBeGreaterThanOrEqual(FIREFLY.duration);
    expect(m.time).toBeLessThan(FIREFLY.duration + 0.02);
    expect(advance(m, [IDLE, IDLE, IDLE, IDLE], 0.5).steps).toBe(0);
    expect(jarScores(m)).toEqual([7, 7, 4, 4]);
    expect(brightest(m)).toBe(0);
    m.jars[1] = { value: 7, flies: 7, golds: 0 };
    expect(brightest(m)).toBeNull();
  });

  it('plays with uneven teams (a team of one)', () => {
    const m = newMeadow([[0], [1, 2]], 3, createRng(5));
    expect(m.catchers.map((c) => c.team)).toEqual([0, 1, 1]);
    const rng = createRng(6);
    const brains = [0.6, 0.6, 0.6].map((s) => newBrain(s, rng));
    while (!isOver(m)) advance(m, brains.map((b, i) => cpuStick(m, i, b, rng)), 1 / 30);
    expect(m.jars[0]?.value).toBeGreaterThan(0);
    expect(m.jars[1]?.value).toBeGreaterThan(0);
    const s = jarScores(m);
    expect(s[1]).toBe(s[2]);
  });
});

// ------------------------------------------------------------------ computer players

function play(skills: number[], seed: number) {
  const rng = createRng(seed);
  const m = newMeadow(TEAMS, 4, rng);
  const brains = skills.map((s) => newBrain(s, rng));
  while (!isOver(m)) advance(m, brains.map((b, i) => cpuStick(m, i, b, rng)), 1 / 60);
  return m;
}

/** `a` team against `b` team, swapping sides every other game. */
function match(a: number, b: number, games: number) {
  let wins = 0;
  let ours = 0;
  let theirs = 0;
  let spooksA = 0;
  let spooksB = 0;
  for (let k = 0; k < games; k++) {
    const swap = k % 2 === 1;
    const m = play(swap ? [b, b, a, a] : [a, a, b, b], 4000 + k);
    const ja = m.jars[swap ? 1 : 0]?.value ?? 0;
    const jb = m.jars[swap ? 0 : 1]?.value ?? 0;
    ours += ja;
    theirs += jb;
    if (ja > jb) wins += 1;
    const sa = swap ? [2, 3] : [0, 1];
    const sb = swap ? [0, 1] : [2, 3];
    spooksA += sa.reduce((n, i) => n + (m.catchers[i]?.spooks ?? 0), 0);
    spooksB += sb.reduce((n, i) => n + (m.catchers[i]?.spooks ?? 0), 0);
  }
  return { rate: wins / games, ours: ours / games, theirs: theirs / games, spooksA: spooksA / games, spooksB: spooksB / games };
}

describe('firefly jar: computer players', () => {
  it('catch plenty, golden ones too, at a pace people can match', () => {
    const m = play([0.5, 0.5, 0.5, 0.5], 11);
    const caught = m.catchers.map((c) => c.caught);
    for (const n of caught) {
      expect(n).toBeGreaterThan(6);
      expect(n).toBeLessThan(32); // under a catch a second
    }
    expect(m.jars.reduce((n, j) => n + j.golds, 0)).toBeGreaterThan(0);
  });

  it('sharp teams beat sleepy ones, and tiptoe up to golden ones more', () => {
    const r = match(0.9, 0.15, 30);
    expect(r.rate).toBeGreaterThanOrEqual(0.8);
    expect(r.spooksA).toBeLessThan(r.spooksB);
  });

  it('equal teams are an even match', () => {
    const r = match(0.6, 0.6, 30);
    expect(r.rate).toBeGreaterThan(0.25);
    expect(r.rate).toBeLessThan(0.75);
  });

  it('an average team stays in the game against a sharp one', () => {
    const r = match(0.5, 0.9, 30);
    expect(r.ours).toBeGreaterThan(r.theirs * 0.6);
    expect(r.ours).toBeLessThan(r.theirs);
  });
});
