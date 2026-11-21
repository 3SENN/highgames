import { describe, expect, it } from 'vitest';
import {
  MOSQ,
  type Mosquito,
  type Swarm,
  applySwat,
  canSwat,
  cpuSwat,
  flying,
  flyingAt,
  fromPointer,
  mosquitoAt,
  mosquitoScores,
  newSwarm,
  newSwatCpu,
  newSwatter,
  pace,
  spawnMosquito,
  stepSwarm,
  swat,
  toPointer,
  wanted,
} from '../src/game/minigames/mosquito';
import { createRng, shuffle } from '../src/game/rng';

const DT = 1 / 60;

/** A whole game of computer players (in a fresh order every step, like the TV does). */
function sim(seed: number, skills: number[]) {
  const rng = createRng(seed);
  const sw = newSwarm();
  const players = skills.map(() => newSwatter());
  const cpus = skills.map((_, i) => newSwatCpu((i - 1.5) * 2, -1));
  let spawned = 0;
  for (let t = 0; t < MOSQ.duration; t += DT) {
    spawned += stepSwarm(sw, rng, t).length;
    for (const i of shuffle(
      rng,
      skills.map((_, k) => k),
    )) {
      const p = players[i]!;
      const out = cpuSwat(cpus[i]!, sw, t, DT, skills[i]!, rng, canSwat(p, t));
      if (out.swat && canSwat(p, t)) applySwat(p, swat(sw, out.x, out.y, t, t, i), t);
    }
  }
  return { players, spawned };
}

function still(at: number, x: number, y: number, gold = false): Mosquito {
  return { id: 99, at, gold, cx: x, cy: y, ax: 0, ay: 0, w: [0, 0, 0, 0], p: [0, 0, 0, 0, 0, 0], fromX: x, fromY: y, toX: x, toY: y, life: 50, swattedAt: null, by: null };
}

describe('mosquito', () => {
  it('maps the pointer onto the play wall and back', () => {
    expect(fromPointer(1, -1)).toEqual({ x: MOSQ.halfW, y: -MOSQ.halfH });
    const p = toPointer(2, 1);
    expect(fromPointer(p.x, p.y).x).toBeCloseTo(2);
  });

  it('flies in from off screen, stays in the room while it buzzes about, then flies off', () => {
    const rng = createRng(2);
    for (let k = 0; k < 40; k++) {
      const m = spawnMosquito(rng, k, 5);
      const start = mosquitoAt(m, 5);
      expect(Math.abs(start.x) > MOSQ.halfW || start.y > MOSQ.halfH).toBe(true);
      for (let t = 5 + MOSQ.enter; t < 5 + m.life; t += 0.1) {
        const p = mosquitoAt(m, t);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(MOSQ.halfW);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(MOSQ.halfH);
      }
      const end = mosquitoAt(m, 5 + m.life + MOSQ.leave);
      expect(Math.abs(end.x) > MOSQ.halfW || end.y > MOSQ.halfH).toBe(true);
      expect(flyingAt(m, 5 + m.life + MOSQ.leave + 0.1)).toBe(false);
    }
  });

  it('speeds up over the game', () => {
    expect(pace(1) - pace(0)).toBeCloseTo(1, 1);
    expect(pace(30) - pace(29)).toBeGreaterThan(1.9);
    const rng = createRng(4);
    const speed = (t0: number) => {
      let sum = 0;
      let n = 0;
      for (let k = 0; k < 30; k++) {
        const m = spawnMosquito(rng, k, t0 - 2);
        for (let t = t0; t < t0 + 1.5; t += 0.05) {
          const a = mosquitoAt(m, t);
          const b = mosquitoAt(m, t + 0.05);
          sum += Math.hypot(a.x - b.x, a.y - b.y) / 0.05;
          n++;
        }
      }
      return sum / n;
    };
    expect(speed(27)).toBeGreaterThan(speed(3) * 1.4);
  });

  it('keeps a few mosquitos about, never more than five, and stops letting them in at the very end', () => {
    expect(wanted(0)).toBe(MOSQ.start);
    expect(wanted(29)).toBe(MOSQ.max);
    const rng = createRng(8);
    const sw = newSwarm();
    let most = 0;
    let late = 0;
    for (let t = 0; t < MOSQ.duration; t += DT) {
      const born = stepSwarm(sw, rng, t);
      if (t > MOSQ.duration - MOSQ.lastSpawn) late += born.length;
      most = Math.max(most, flying(sw, t).length);
    }
    expect(most).toBe(MOSQ.max);
    expect(late).toBe(0);
  });

  it('swats what is inside the swat circle where it was when the player pressed', () => {
    const sw: Swarm = { list: [still(0, 1, 1), still(0, 1.3, 1, true)], nextId: 100, nextSpawn: 99 };
    sw.list[1]!.id = 98;
    const r = swat(sw, 1.1, 1, 2, 2.05, 0);
    expect(r.kind).toBe('hit');
    expect(r.kind === 'hit' && r.points).toBe(4);
    expect(sw.list.every((m) => m.by === 0 && m.swattedAt === 2.05)).toBe(true);
    // Someone a moment later at the same spot was just too slow: no slap.
    expect(swat(sw, 1, 1, 2.0, 2.1, 1).kind).toBe('late');
    // Long after, it's thin air.
    expect(swat(sw, 1, 1, 3, 3, 1).kind).toBe('miss');
    // Far away is a miss too.
    const sw2: Swarm = { list: [still(0, 1, 1)], nextId: 1, nextSpawn: 99 };
    expect(swat(sw2, 1 + MOSQ.swat + MOSQ.body + 0.05, 1, 1, 1, 0).kind).toBe('miss');
  });

  it('judges a moving mosquito where it was when the phone pressed, not much further back', () => {
    const m = spawnMosquito(createRng(3), 1, 0);
    const pressed = 4;
    const then = mosquitoAt(m, pressed);
    const sw: Swarm = { list: [m], nextId: 2, nextSpawn: 99 };
    expect(swat(sw, then.x, then.y, pressed, pressed + 0.08, 0).kind).toBe('hit');
    const m2 = spawnMosquito(createRng(3), 1, 0);
    const old = mosquitoAt(m2, 2);
    const sw2: Swarm = { list: [m2], nextId: 2, nextSpawn: 99 };
    const now = mosquitoAt(m2, 4);
    if (Math.hypot(old.x - now.x, old.y - now.y) > 2 * (MOSQ.swat + MOSQ.bigBody)) expect(swat(sw2, old.x, old.y, 2, 4, 0).kind).toBe('miss');
  });

  it('stuns you for a second after a miss and scores golden ones as three', () => {
    const p = newSwatter();
    applySwat(p, { kind: 'miss' }, 5);
    expect(canSwat(p, 5.5)).toBe(false);
    expect(canSwat(p, 5 + MOSQ.stun)).toBe(true);
    applySwat(p, { kind: 'hit', hits: [still(0, 0, 0, true), still(0, 0, 0)], points: 4 }, 7);
    expect(canSwat(p, 7 + MOSQ.gap / 2)).toBe(false);
    applySwat(p, { kind: 'late' }, 8);
    expect(canSwat(p, 8 + MOSQ.gap + 0.001)).toBe(true);
    expect(p).toMatchObject({ points: 4, hits: 2, golds: 1, misses: 1 });
    expect(mosquitoScores([p, newSwatter()])).toEqual([4, 0]);
  });

  it('has sharp computer players swat more and slap themselves less than sleepy ones, whatever their seat', () => {
    let sharp = 0;
    let sleepy = 0;
    let sharpMiss = 0;
    let sleepyMiss = 0;
    const games = 20;
    for (let seed = 1; seed <= games; seed++) {
      const { players } = sim(seed, [1, 0, 0, 0]);
      sharp += players[0]!.points;
      sleepy += (players[1]!.points + players[2]!.points + players[3]!.points) / 3;
      sharpMiss += players[0]!.misses;
      sleepyMiss += (players[1]!.misses + players[2]!.misses + players[3]!.misses) / 3;
    }
    expect(sharp).toBeGreaterThan(sleepy * 2);
    expect(sharpMiss).toBeLessThan(sleepyMiss);
    // Average players share fairly, and miss now and then.
    const totals = [0, 0, 0, 0];
    let misses = 0;
    let hits = 0;
    for (let seed = 1; seed <= games; seed++) {
      const { players } = sim(seed + 100, [0.5, 0.5, 0.5, 0.5]);
      players.forEach((p, i) => {
        totals[i]! += p.points;
        misses += p.misses;
        hits += p.hits;
      });
    }
    const mean = totals.reduce((a, b) => a + b, 0) / 4;
    for (const t of totals) expect(Math.abs(t - mean)).toBeLessThan(mean * 0.25);
    expect(mean / games).toBeGreaterThan(6);
    expect(mean / games).toBeLessThan(25);
    expect(misses / (hits + misses)).toBeGreaterThan(0.15);
    expect(misses / (hits + misses)).toBeLessThan(0.55);
  });
});
