import { describe, expect, it } from 'vitest';
import {
  type Course,
  GAP,
  LIMIT,
  RIVER,
  allArrived,
  cpuTilt,
  currentAt,
  duckAt,
  flowAt,
  makeCourse,
  newCpuPaddler,
  newRace,
  riverDetail,
  riverScores,
  stepRace,
} from '../src/game/minigames/lazyriver';
import { createRng } from '../src/game/rng';

const empty = (): Course => ({ pads: [], buoys: [], ducks: [], bends: [] });

/** A whole race between computer players; returns the race and who won. */
function race(skills: number[], seed: number) {
  const rng = createRng(seed);
  const r = newRace(makeCourse(rng), skills.length);
  const cpus = skills.map((_, i) => newCpuPaddler(r.floaties[i]?.d ?? 0));
  const dt = 1 / 30;
  while (r.time < RIVER.duration && !allArrived(r)) {
    stepRace(
      r,
      skills.map((s, i) => cpuTilt(cpus[i] as ReturnType<typeof newCpuPaddler>, r, i, s, rng, dt)),
      dt,
    );
  }
  const scores = riverScores(r.floaties);
  return { r, winner: scores.indexOf(Math.max(...scores)) };
}

describe('lazy river', () => {
  it('lays lily pads that always leave a clear way through, and nowhere to get wedged', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const c = makeCourse(createRng(seed));
      expect(c.pads.length).toBeGreaterThan(6);
      expect(c.buoys.length).toBeGreaterThan(4);
      for (const p of c.pads) {
        // Room to pass on both sides between a pad and the banks.
        expect(p.d - p.r + RIVER.half).toBeGreaterThanOrEqual(GAP - 1e-9);
        expect(RIVER.half - (p.d + p.r)).toBeGreaterThanOrEqual(GAP - 1e-9);
        for (const q of c.pads) {
          if (q === p) continue;
          const between = Math.hypot(p.s - q.s, p.d - q.d) - p.r - q.r;
          expect(between).toBeGreaterThanOrEqual(GAP - 1e-9);
        }
      }
      for (const b of c.buoys) {
        expect(Math.abs(b.d)).toBeLessThanOrEqual(LIMIT);
        expect(b.s).toBeLessThan(RIVER.length);
        for (const p of c.pads) expect(Math.hypot(p.s - b.s, p.d - b.d)).toBeGreaterThan(p.r + RIVER.radius);
      }
      for (const f of c.ducks) expect(f.dive.length).toBe(f.count);
    }
  });

  it('flows fastest in the middle and slowest at the banks, evenly at the start, and stills behind the bridge', () => {
    expect(currentAt(0)).toBe(RIVER.middle);
    expect(currentAt(RIVER.half)).toBeCloseTo(RIVER.edge);
    expect(currentAt(2)).toBeGreaterThan(currentAt(3));
    expect(flowAt(0, 0)).toBe(flowAt(0, LIMIT));
    expect(flowAt(40, 0)).toBe(RIVER.middle);
    expect(flowAt(RIVER.length + RIVER.pool, 0)).toBeLessThan(0.5);
  });

  it('paddles sideways with the tilt and stays between the banks', () => {
    const r = newRace(empty(), 1);
    stepRace(r, [1], 0.5);
    const f = r.floaties[0];
    expect(f?.vd).toBeGreaterThan(0);
    expect(f?.s).toBeGreaterThan(0);
    stepRace(r, [1], 4);
    expect(f?.d).toBeCloseTo(LIMIT);
    stepRace(r, [-1], 8);
    expect(f?.d).toBeCloseTo(-LIMIT);
  });

  it('gives the same river whether a second comes in one frame or many', () => {
    const a = newRace(makeCourse(createRng(3)), 4);
    const b = newRace(makeCourse(createRng(3)), 4);
    const tilt = [0.6, -0.3, 0.2, 1];
    stepRace(a, tilt, 1);
    for (let i = 0; i < 30; i++) stepRace(b, tilt, 1 / 30);
    a.floaties.forEach((f, i) => {
      expect(f.s).toBeCloseTo(b.floaties[i]?.s ?? 0, 4);
      expect(f.d).toBeCloseTo(b.floaties[i]?.d ?? 0, 4);
    });
  });

  it('slows and spins a floatie that bumps a lily pad', () => {
    const c = empty();
    c.pads.push({ s: 30, d: 0, r: 0.8, flower: false });
    const r = newRace(c, 1);
    const f = r.floaties[0];
    if (!f) throw new Error('no floatie');
    f.s = 26;
    f.vs = RIVER.middle;
    const events = stepRace(r, [0], 2);
    expect(events).toContainEqual({ t: 'bonk', seat: 0, what: 'pad' });
    expect(f.s).toBeLessThan(30);
    expect(f.vs).toBeLessThan(RIVER.middle * 0.6);
    expect(Math.abs(f.spin)).toBeGreaterThan(0.5);
  });

  it('boosts a floatie that grabs a snack bag, and the bag bobs back up later', () => {
    const c = empty();
    c.buoys.push({ s: 22, d: 0, downUntil: 0 });
    const r = newRace(c, 1);
    const f = r.floaties[0];
    if (!f) throw new Error('no floatie');
    f.s = 20;
    f.vs = RIVER.middle;
    const events = stepRace(r, [0], 1);
    expect(events).toContainEqual({ t: 'snack', seat: 0, buoy: 0 });
    expect(f.snacks).toBe(1);
    expect(f.vs).toBeGreaterThan(RIVER.middle + 0.3);
    expect(c.buoys[0]?.downUntil).toBeGreaterThan(r.time);
    stepRace(r, [0], RIVER.respawn);
    expect(c.buoys[0]?.downUntil).toBeLessThan(r.time);
  });

  it('has a bumped duck duck under, so nobody is held up behind the family', () => {
    const c = empty();
    c.ducks.push({ s: 30, phase: 0, count: 1, dive: [0] });
    const r = newRace(c, 1);
    const f = r.floaties[0];
    if (!f) throw new Error('no floatie');
    const duck = duckAt(c.ducks[0] as Course['ducks'][number], 0, 0);
    f.d = duck.d;
    f.s = duck.s - 1.3;
    f.vs = RIVER.middle;
    const events = stepRace(r, [0], 0.5);
    expect(events.some((e) => e.t === 'bonk' && e.what === 'duck')).toBe(true);
    expect(c.ducks[0]?.dive[0]).toBeGreaterThan(r.time);
    stepRace(r, [0], 1);
    expect(f.s).toBeGreaterThan(duck.s + 0.5);
  });

  it('bounces floaties that bump into each other apart', () => {
    const r = newRace(empty(), 2);
    const [a, b] = r.floaties;
    if (!a || !b) throw new Error('no floaties');
    a.s = b.s = 20;
    a.d = -1.5;
    b.d = 1.5;
    stepRace(r, [1, -1], 1.5);
    expect(b.d - a.d).toBeGreaterThanOrEqual(RIVER.radius * 2 - 1e-6);
    expect(a.bonks + b.bonks).toBeGreaterThan(0);
  });

  it('ranks arrivals by time, ahead of everyone still on the way, who rank by distance', () => {
    const r = newRace(empty(), 4);
    const [a, b, c, d] = r.floaties;
    if (!a || !b || !c || !d) throw new Error('no floaties');
    a.arrivedAt = 31.2;
    b.arrivedAt = 28.4;
    c.s = 90;
    d.s = 60;
    const [sa, sb, sc, sd] = riverScores(r.floaties) as [number, number, number, number];
    expect(sb).toBeGreaterThan(sa);
    expect(sa).toBeGreaterThan(sc);
    expect(sc).toBeGreaterThan(sd);
    expect(riverDetail(b)).toContain('28.4');
    expect(riverDetail(d)).toContain(`${RIVER.length - 60} m`);
  });

  it('notes the arrival when a floatie drifts under the bridge', () => {
    const r = newRace(empty(), 1);
    const f = r.floaties[0];
    if (!f) throw new Error('no floatie');
    f.s = RIVER.length - 1;
    f.vs = RIVER.middle;
    const events = stepRace(r, [0], 1);
    expect(events.some((e) => e.t === 'arrive' && e.seat === 0)).toBe(true);
    expect(f.arrivedAt).toBeGreaterThan(0);
    expect(allArrived(r)).toBe(true);
    stepRace(r, [0], 30);
    expect(f.s).toBeLessThanOrEqual(RIVER.length + RIVER.pool);
  });

  it('has sharp computer players reach the bridge in time and win most races against average ones', () => {
    let arrived = 0;
    let wins = 0;
    const games = 24;
    for (let seed = 1; seed <= games; seed++) {
      const { r, winner } = race([0.5, 1, 0.5, 0.5], seed);
      if (r.floaties[1]?.arrivedAt != null) arrived++;
      if (winner === 1) wins++;
    }
    expect(arrived).toBeGreaterThan(games * 0.6);
    expect(wins).toBeGreaterThan(games * 0.35);
  });

  it('has average computer players often make it, and sleepy ones get a good way down the river', () => {
    let average = 0;
    let sleepyDistance = 0;
    const games = 24;
    for (let seed = 1; seed <= games; seed++) {
      const { r } = race([0, 0.5, 0, 0.5], seed);
      average += [1, 3].filter((i) => r.floaties[i]?.arrivedAt != null).length;
      sleepyDistance += ((r.floaties[0]?.s ?? 0) + (r.floaties[2]?.s ?? 0)) / 2;
    }
    expect(average).toBeGreaterThan(games * 2 * 0.4);
    expect(sleepyDistance / games).toBeGreaterThan(RIVER.length * 0.7);
  });
});
