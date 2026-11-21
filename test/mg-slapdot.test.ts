import { describe, expect, it } from 'vitest';
import {
  SLAP,
  type SlapGame,
  circleAngle,
  cpuReaction,
  cpuSlaps,
  dotState,
  edgeToward,
  fuseFor,
  newCpuHand,
  newSlap,
  nextAlive,
  slap,
  slapScores,
  stepSlap,
  travelFor,
} from '../src/game/minigames/slapdot';
import { createRng } from '../src/game/rng';

/** An rng that never jumps across the circle. */
const steady = () => 0.99;

/** Runs the game on until the dot has landed on someone. Returns the time. */
function land(g: SlapGame, t: number): number {
  let now = t;
  while (!g.dot || now < g.dot.arriveAt) {
    stepSlap(g, now);
    now += 0.01;
  }
  stepSlap(g, now);
  return now;
}

function sim(skills: number[], seed: number): { time: number; scores: number[]; lost: number } {
  const rng = createRng(seed);
  const g = newSlap(skills.length, seed % skills.length);
  const hands = skills.map((s) => newCpuHand(s));
  let t = 0;
  let lost = 0;
  while (!g.over && t < 60) {
    for (const e of stepSlap(g, t)) if (e.t === 'pop') lost += 1;
    for (const p of cpuSlaps(g, hands, t, rng)) for (const e of slap(g, p, t, t, rng)) if (e.t === 'false') lost += 1;
    t += 1 / 60;
  }
  return { time: t, scores: slapScores(g), lost };
}

describe('slap dot', () => {
  it('starts with a slow fuse that shrinks towards 0.6 s, and rolls quicker too', () => {
    expect(fuseFor(0)).toBeCloseTo(1.6);
    for (let p = 1; p < 60; p++) {
      expect(fuseFor(p)).toBeLessThan(fuseFor(p - 1));
      expect(fuseFor(p)).toBeGreaterThan(0.59);
      expect(travelFor(p, false)).toBeLessThanOrEqual(travelFor(p - 1, false));
    }
    expect(fuseFor(30)).toBeLessThan(0.65);
    expect(travelFor(3, true)).toBeGreaterThan(travelFor(3, false));
  });

  it('rolls a fresh dot from the middle, and a slap sends it to the next phone round', () => {
    const g = newSlap(4, 2);
    expect(stepSlap(g, 0)).toEqual([{ t: 'spawn', to: 2 }]);
    expect(g.dot).toMatchObject({ from: -1, to: 2 });
    const t = land(g, 0);
    expect(g.dot?.arrived).toBe(true);
    const events = slap(g, 2, t + 0.3, t + 0.3, steady);
    expect(events).toEqual([{ t: 'pass', from: 2, to: 3, jump: false, reaction: expect.closeTo(0.3, 1) }]);
    expect(g.dot).toMatchObject({ from: 2, to: 3, jump: false });
    expect(g.passes).toBe(1);
    expect(g.dot?.fuse).toBeCloseTo(fuseFor(1));
    // And round the corner from the last phone to the first.
    const t2 = land(g, t + 0.3);
    expect(slap(g, 3, t2 + 0.2, t2 + 0.2, steady)[0]).toMatchObject({ t: 'pass', from: 3, to: 0 });
  });

  it('now and then sends it across the circle instead', () => {
    const g = newSlap(4, 0);
    const t = land(g, 0);
    const events = slap(g, 0, t + 0.2, t + 0.2, () => 0);
    expect(events[0]).toMatchObject({ t: 'pass', from: 0, jump: true });
    expect([2, 3]).toContain(g.dot?.to);
    // With only two left there's nowhere to jump to.
    const two = newSlap(2, 0);
    const t2 = land(two, 0);
    expect(slap(two, 0, t2 + 0.2, t2 + 0.2, () => 0)[0]).toMatchObject({ to: 1, jump: false });
  });

  it('pops a dot that sits too long (with the phone’s slack), then rolls out a fresh one to the next player', () => {
    const g = newSlap(3, 1, [0, 0.1, 0]);
    const t = land(g, 0);
    const d = g.dot;
    if (!d) throw new Error('no dot');
    // Player 1's phone is slow, so it gets 0.1 s longer.
    expect(stepSlap(g, d.arriveAt + d.fuse + 0.05)).toEqual([]);
    expect(stepSlap(g, d.arriveAt + d.fuse + 0.11)).toEqual([{ t: 'pop', p: 1, lives: 2 }]);
    expect(g.dot).toBeNull();
    // A late slap after the deadline doesn't count either way.
    expect(slap(g, 1, d.arriveAt + d.fuse + 0.12, t + 3, steady)).toEqual([]);
    expect(stepSlap(g, d.arriveAt + d.fuse + 0.2)).toEqual([]);
    expect(stepSlap(g, d.arriveAt + d.fuse + 0.11 + SLAP.popPause)).toEqual([{ t: 'spawn', to: 2 }]);
  });

  it('costs a life for a false slap, but not for a double tap or a burst of taps', () => {
    const g = newSlap(3, 0);
    const t = land(g, 0);
    expect(slap(g, 1, t + 0.1, t + 0.1, steady)).toEqual([{ t: 'false', p: 1, lives: 2 }]);
    expect(slap(g, 1, t + 0.3, t + 0.3, steady)).toEqual([]);
    expect(slap(g, 1, t + 0.1 + SLAP.falseCooldown, t + 0.8, steady)).toEqual([{ t: 'false', p: 1, lives: 1 }]);
    // A good slap followed straight away by a second tap.
    expect(slap(g, 0, t + 0.2, t + 0.2, steady)[0]).toMatchObject({ t: 'pass', from: 0, to: 1 });
    expect(slap(g, 0, t + 0.3, t + 0.3, steady)).toEqual([]);
    expect(g.lives).toEqual([3, 1, 3]);
  });

  it('counts a slap just before the dot lands, but not one well before', () => {
    const g = newSlap(2, 0);
    stepSlap(g, 0);
    const arrive = g.dot?.arriveAt ?? 0;
    expect(slap(g, 0, arrive - SLAP.early / 2, arrive - SLAP.early / 2, steady)[0]).toMatchObject({ t: 'pass', from: 0, to: 1 });
    // It leaves when it would have landed, not before.
    expect(g.dot?.leaveAt).toBeCloseTo(arrive);
    const arrive2 = g.dot?.arriveAt ?? 0;
    expect(slap(g, 1, arrive2 - 0.3, arrive2 - 0.3, steady)).toEqual([{ t: 'false', p: 1, lives: 2 }]);
  });

  it('puts players out after three lives, skips their phone and ranks by order out', () => {
    const g = newSlap(3, 0);
    stepSlap(g, 0);
    let t = 0;
    for (let k = 0; k < 3; k++) {
      t += 1;
      const events = slap(g, 2, t, t, steady);
      expect(events[0]).toMatchObject({ t: 'false', p: 2 });
      if (k === 2) expect(events[1]).toEqual({ t: 'out', p: 2, place: 3 });
    }
    expect(g.outAt[2]).toBe(3);
    expect(nextAlive(g, 1)).toBe(0);
    expect(slap(g, 2, t + 1, t + 1, steady)).toEqual([]);
    for (let k = 0; k < 3; k++) {
      t += 1;
      const events = slap(g, 1, t, t, steady);
      if (k === 2) expect(events.map((e) => e.t)).toEqual(['false', 'out', 'over']);
    }
    expect(g.over).toBe(true);
    const [a, b, c] = slapScores(g) as [number, number, number];
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('ends when time is up, most lives left ranking first', () => {
    const g = newSlap(3, 0);
    stepSlap(g, 0);
    expect(slap(g, 1, 0.5, 0.5, steady)[0]).toMatchObject({ t: 'false', p: 1 });
    stepSlap(g, 1);
    expect(stepSlap(g, SLAP.duration)).toEqual([{ t: 'over', winner: null, timeUp: true }]);
    const [a, b, c] = slapScores(g) as [number, number, number];
    expect(a).toBe(c);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(10);
  });

  it('reports where the dot is: rolling, then burning its fuse', () => {
    const g = newSlap(2, 0);
    stepSlap(g, 0);
    const d = g.dot;
    if (!d) throw new Error('no dot');
    expect(dotState(d, d.leaveAt).rolling).toBe(true);
    expect(dotState(d, (d.leaveAt + d.arriveAt) / 2).k).toBeCloseTo(0.5);
    expect(dotState(d, d.arriveAt + d.fuse / 2)).toEqual({ rolling: false, k: 1, left: 0.5 });
  });

  it('points each phone the right way round the circle', () => {
    for (const n of [2, 3, 4]) {
      for (let i = 0; i < n; i++) {
        // The middle of the table is past the top of every phone.
        const mid = edgeToward(i, -1, n);
        expect(mid.x).toBeCloseTo(0.5);
        expect(mid.y).toBeLessThan(0.1);
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const e = edgeToward(i, j, n);
          const onEdge = e.x < 0.1 || e.x > 0.9 || e.y < 0.1 || e.y > 0.9;
          expect(onEdge).toBe(true);
        }
      }
    }
    // Four phones: the next one clockwise is to your left, the one before to your right, the far one ahead.
    expect(edgeToward(0, 1, 4).x).toBeLessThan(0.3);
    expect(edgeToward(0, 3, 4).x).toBeGreaterThan(0.7);
    expect(edgeToward(0, 2, 4)).toMatchObject({ x: expect.closeTo(0.5, 2) });
    expect(edgeToward(0, 2, 4).y).toBeLessThan(0.1);
    // Two phones lie left and right of the TV, three and four go round from the far side.
    expect(Math.sin(circleAngle(0, 2))).toBeCloseTo(-1);
    expect(Math.sin(circleAngle(1, 2))).toBeCloseTo(1);
  });

  it('has computer players slap believably: sharp ones quick, sleepy ones slower and dreamier', () => {
    const rng = createRng(3);
    const mean = (skill: number) => {
      let sum = 0;
      for (let k = 0; k < 2000; k++) sum += cpuReaction(skill, rng);
      return sum / 2000;
    };
    const sleepy = mean(0);
    const sharp = mean(1);
    expect(sharp).toBeGreaterThan(0.25);
    expect(sharp).toBeLessThan(0.36);
    expect(sleepy).toBeGreaterThan(0.6);
    expect(sleepy).toBeLessThan(0.8);
    // Nobody is faster than a person could be.
    for (let k = 0; k < 500; k++) expect(cpuReaction(1, rng)).toBeGreaterThanOrEqual(0.17);
  });

  it('has a computer player slap its own dot and only now and then flinch at a neighbour’s', () => {
    const rng = createRng(9);
    let flinches = 0;
    let good = 0;
    for (let seed = 0; seed < 200; seed++) {
      const g = newSlap(3, 0);
      const hands = [newCpuHand(0.5), newCpuHand(0.5), null];
      for (let t = 0; t < 4 && !g.over; t += 1 / 60) {
        stepSlap(g, t);
        for (const p of cpuSlaps(g, hands, t, rng)) {
          for (const e of slap(g, p, t, t, rng)) {
            if (e.t === 'false') flinches += 1;
            if (e.t === 'pass') good += 1;
          }
        }
        // Person 2 never slaps: their dots pop.
      }
    }
    expect(good).toBeGreaterThan(300);
    expect(flinches).toBeLessThan(good * 0.05);
  });

  it('plays out a lively game between computer players in time, sharp ones outlasting sleepy ones', () => {
    const runs = 150;
    const wins = [0, 0, 0, 0];
    let lost = 0;
    for (let seed = 1; seed <= runs; seed++) {
      const r = sim([0.05, 0.5, 0.95, 0.5], seed);
      expect(r.time).toBeLessThan(SLAP.duration + 0.1);
      const best = Math.max(...r.scores);
      r.scores.forEach((s, i) => {
        if (s === best) wins[i] = (wins[i] ?? 0) + 1;
      });
      lost += r.lost / runs;
    }
    const [sleepy, average, sharp] = wins as [number, number, number];
    expect(sharp).toBeGreaterThan(average * 1.8);
    expect(average).toBeGreaterThan(sleepy * 3);
    // Lives are lost: a 4-way game isn't a staring contest.
    expect(lost).toBeGreaterThan(5);
  });

  it('finishes quickly once only computer players are left', () => {
    let ended = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const rng = createRng(seed);
      const g = newSlap(3, 0);
      g.hurry = true;
      g.passes = 25;
      const hands = [0.5, 0.5, 0.5].map((s) => newCpuHand(s));
      let t = 0;
      while (!g.over && t < 30) {
        stepSlap(g, t);
        for (const p of cpuSlaps(g, hands, t, rng)) slap(g, p, t, t, rng);
        t += 1 / 60;
      }
      if (g.over && t < 30) ended += 1;
    }
    expect(ended).toBeGreaterThan(80);
  });
});
