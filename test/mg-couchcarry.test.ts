import { describe, expect, it } from 'vitest';
import {
  CARRY,
  type Couch,
  type CarryEvent,
  type Vec,
  carryFraction,
  carryScore,
  carryScores,
  couchEnds,
  cpuStick,
  inHall,
  keepClear,
  makeHall,
  newCouch,
  newCpuCarrier,
  pointAt,
  project,
  stepCouch,
} from '../src/game/minigames/couchcarry';
import { createRng } from '../src/game/rng';

const hall = makeHall();
const still: Vec = { x: 0, y: 0 };

/** Steps the couch for `seconds` with fixed sticks; returns everything that happened. */
function hold(c: Couch, front: Vec, back: Vec, seconds: number, t0 = 0): CarryEvent[] {
  const events: CarryEvent[] = [];
  const n = Math.round(seconds / CARRY.step);
  for (let i = 0; i < n; i++) events.push(...stepCouch(c, hall, [front, back], t0 + i * CARRY.step));
  return events;
}

/** A whole carry by two computer players; returns the couch at the end. */
function cpuCarry(seed: number, front: number, back: number): Couch {
  const rng = createRng(seed);
  const c = newCouch(hall);
  const cpus = [newCpuCarrier(hall), newCpuCarrier(hall)] as const;
  const frame = 1 / 60;
  let t = 0;
  let acc = 0;
  while (t < CARRY.duration && c.finishedAt === null) {
    t += frame;
    const sticks = [cpuStick(cpus[0], hall, c, 0, front, rng, t, frame), cpuStick(cpus[1], hall, c, 1, back, rng, t, frame)] as const;
    acc += frame;
    while (acc >= CARRY.step) {
      acc -= CARRY.step;
      stepCouch(c, hall, sticks, t);
    }
  }
  return c;
}

describe('pivot: the hallway', () => {
  it('starts the couch clear of the walls, pointing down the hallway', () => {
    const c = newCouch(hall);
    for (const e of couchEnds(c)) expect(inHall(hall, e)).toBe(true);
    hold(c, still, still, 1);
    expect(c.touching).toBe(false);
    expect(c.x).toBeCloseTo(hall.start.x, 6);
    expect(c.y).toBeCloseTo(hall.start.y, 6);
    expect(carryFraction(c, hall)).toBe(0);
  });

  it('measures progress smoothly round both corners', () => {
    // Walk the careful line (which cuts the corners) from start to finish: progress never slips back or leaps.
    let prev = project(hall.track, pointAt(hall.race, 0));
    const end = hall.race.at[hall.race.at.length - 1] as number;
    for (let s = 0.05; s < end; s += 0.05) {
      const now = project(hall.track, pointAt(hall.race, s), prev, 0.6);
      expect(now).toBeGreaterThan(prev);
      expect(now - prev).toBeLessThan(0.12);
      prev = now;
    }
    expect(prev).toBeGreaterThan(hall.goal);
  });

  it('keeps carriers out of the walls', () => {
    const p = keepClear(hall, { x: -CARRY.hall / 2 + 0.05, y: 2 }, 0.25);
    expect(p.x).toBeCloseTo(-CARRY.hall / 2 + 0.25, 3);
  });
});

describe('pivot: carrying', () => {
  it('goes straight ahead when both partners push forward', () => {
    const c = newCouch(hall);
    hold(c, { x: 0, y: 1 }, { x: 0, y: 1 }, 1);
    expect(c.y - hall.start.y).toBeGreaterThan(CARRY.speed * 0.8);
    expect(c.x).toBeCloseTo(0, 3);
    expect(c.angle).toBeCloseTo(Math.PI / 2, 3);
  });

  it('moves at half pace when only one partner pulls along it', () => {
    const c = newCouch(hall);
    hold(c, { x: 0, y: 1 }, still, 1);
    const moved = c.y - hall.start.y;
    expect(moved).toBeGreaterThan(CARRY.speed * 0.35);
    expect(moved).toBeLessThan(CARRY.speed * 0.55);
  });

  it('pivots round the still end when the other end moves sideways', () => {
    const c = newCouch(hall);
    const [, back0] = couchEnds(c);
    hold(c, { x: 0.4, y: 0 }, still, 0.7);
    const [, back1] = couchEnds(c);
    expect(c.touching).toBe(false);
    expect(c.angle).toBeLessThan(Math.PI / 2 - 0.18); // turned towards the right
    expect(Math.hypot(back1.x - back0.x, back1.y - back0.y)).toBeLessThan(0.05);
  });

  it('cannot go round the corner without turning', () => {
    const c = newCouch(hall);
    hold(c, { x: 0, y: 0.5 }, { x: 0, y: 0.5 }, 8);
    expect(c.finishedAt).toBeNull();
    expect(c.touching).toBe(true);
    expect(carryFraction(c, hall)).toBeLessThan(0.45);
  });

  it('scuffs and stuns on a hard knock, but not when leaning on a wall gently', () => {
    const gentle = newCouch(hall);
    expect(hold(gentle, { x: -0.35, y: 0 }, { x: -0.35, y: 0 }, 1.5).filter((e) => e.kind === 'scuff')).toHaveLength(0);
    expect(gentle.touching).toBe(true);

    const hard = newCouch(hall);
    const events = hold(hard, { x: 1, y: 0 }, { x: 1, y: 0 }, 0.5);
    const scuffs = events.filter((e) => e.kind === 'scuff');
    expect(scuffs).toHaveLength(1);
    expect(hard.scuffs).toBe(1);
    expect(hard.stun).toBeGreaterThan(0);
    // Stunned: the sticks do nothing for a moment.
    const y = hard.y;
    hold(hard, { x: 0, y: 1 }, { x: 0, y: 1 }, 0.05);
    expect(hard.y - y).toBeLessThan(0.03);
  });

  it('never lets the couch through a wall, however the sticks are mashed', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = createRng(seed);
      const c = newCouch(hall);
      let sticks: [Vec, Vec] = [still, still];
      for (let i = 0; i < 120 * 25; i++) {
        if (i % 25 === 0) sticks = [{ x: rng() * 2 - 1, y: rng() * 2 - 1 }, { x: rng() * 2 - 1, y: rng() * 2 - 1 }];
        stepCouch(c, hall, sticks, i * CARRY.step);
        for (const e of couchEnds(c)) expect(inHall(hall, e)).toBe(true);
      }
    }
  });
});

describe('pivot: finishing and scores', () => {
  it('finishes when the whole couch is through the door', () => {
    const c = cpuCarry(3, 1, 1);
    expect(c.finishedAt).not.toBeNull();
    expect(carryFraction(c, hall)).toBe(1);
    for (const e of couchEnds(c)) expect(e.y).toBeGreaterThan(hall.door.y + hall.door.depth);
  });

  it('ranks through-the-door ahead of further along, and sooner ahead of later', () => {
    const quick = { ...newCouch(hall), finishedAt: 14 };
    const slow = { ...newCouch(hall), finishedAt: 30 };
    const close = { ...newCouch(hall), progress: hall.goal - 0.01 };
    const far = { ...newCouch(hall), progress: hall.from + 2 };
    expect(carryScore(quick, hall)).toBeGreaterThan(carryScore(slow, hall));
    expect(carryScore(slow, hall)).toBeGreaterThan(carryScore(close, hall));
    expect(carryScore(close, hall)).toBeGreaterThan(carryScore(far, hall));
  });

  it('gives both partners their couch’s score', () => {
    const a = { ...newCouch(hall), finishedAt: 20 };
    const b = { ...newCouch(hall), progress: hall.from + 5 };
    const s = carryScores([a, b], hall, [[0, 3], [1, 2]], 4);
    expect(s[0]).toBe(s[3]);
    expect(s[1]).toBe(s[2]);
    expect(s[0]).toBeGreaterThan(s[1] as number);
  });
});

describe('pivot: computer players', () => {
  const runs = (front: number, back: number, n = 12) => Array.from({ length: n }, (_, i) => cpuCarry(100 + i, front, back));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('sharp pairs get through quickly and cleanly', () => {
    const r = runs(1, 1);
    expect(r.every((c) => c.finishedAt !== null)).toBe(true);
    const t = mean(r.map((c) => c.finishedAt ?? CARRY.duration));
    expect(t).toBeGreaterThan(10);
    expect(t).toBeLessThan(16);
    expect(mean(r.map((c) => c.scuffs))).toBeLessThan(1);
  });

  it('average pairs take around twenty seconds and scuff now and then', () => {
    const r = runs(0.57, 0.57);
    const t = mean(r.map((c) => c.finishedAt ?? CARRY.duration));
    expect(t).toBeGreaterThan(16);
    expect(t).toBeLessThan(26);
    expect(mean(r.map((c) => c.scuffs))).toBeGreaterThan(0.5);
  });

  it('sleepy pairs are slow and bumpy, but still get somewhere', () => {
    const r = runs(0.1, 0.1);
    expect(mean(r.map((c) => carryFraction(c, hall)))).toBeGreaterThan(0.6);
    expect(mean(r.map((c) => c.finishedAt ?? CARRY.duration))).toBeGreaterThan(30);
    expect(mean(r.map((c) => c.scuffs))).toBeGreaterThan(2);
  });

  it('a sharp pair usually beats a sleepy one, and close pairs are a contest', () => {
    let sharp = 0;
    let close = 0;
    for (let i = 0; i < 16; i++) {
      if (carryScore(cpuCarry(200 + i, 0.8, 0.8), hall) > carryScore(cpuCarry(300 + i, 0.35, 0.35), hall)) sharp++;
      if (carryScore(cpuCarry(400 + i, 0.6, 0.6), hall) > carryScore(cpuCarry(500 + i, 0.5, 0.5), hall)) close++;
    }
    expect(sharp).toBeGreaterThanOrEqual(14);
    expect(close).toBeGreaterThan(4);
    expect(close).toBeLessThan(16);
  });

  it('carries its share alongside a partner who does nothing', () => {
    for (const idle of [0, 1] as const) {
      const rng = createRng(9 + idle);
      const c = newCouch(hall);
      const cpu = newCpuCarrier(hall);
      for (let i = 0; i < 120 * 20; i++) {
        const t = i * CARRY.step;
        const mine = cpuStick(cpu, hall, c, idle === 0 ? 1 : 0, 0.7, rng, t, CARRY.step);
        stepCouch(c, hall, idle === 0 ? [still, mine] : [mine, still], t);
      }
      expect(carryFraction(c, hall)).toBeGreaterThan(0.4);
    }
  });
});
