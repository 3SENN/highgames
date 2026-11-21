import { describe, expect, it } from 'vitest';
import {
  HOCKEY,
  type MatchOutcome,
  PHONE_L,
  type Rink,
  type Side,
  advancer,
  aimMallet,
  cpuHockey,
  fromPhone,
  newHockeyCpu,
  newRink,
  planTable,
  stepRink,
  tableScores,
  toPhone,
} from '../src/game/minigames/coasterhockey';
import { createRng } from '../src/game/rng';

/** Steps the table for `seconds`, collecting events. */
function run(r: Rink, seconds: number) {
  const events = [];
  for (let t = 0; t < seconds; t += HOCKEY.step) events.push(...stepRink(r, HOCKEY.step));
  return events;
}

/** A whole computer-against-computer match; returns the final score. */
function cpuMatch(seed: number, skills: [number, number]): [number, number] {
  const rng = createRng(seed);
  const r = newRink(rng() < 0.5 ? 0 : 1);
  const cpus = [newHockeyCpu(skills[0]), newHockeyCpu(skills[1])];
  for (let t = 0; t < HOCKEY.duration && Math.max(...r.score) < HOCKEY.target; t += HOCKEY.step) {
    cpuHockey(r, 0, cpus[0]!, HOCKEY.step, rng);
    cpuHockey(r, 1, cpus[1]!, HOCKEY.step, rng);
    stepRink(r, HOCKEY.step);
  }
  return r.score;
}

describe('table games: two phones top to top', () => {
  it('maps field points onto each phone and back', () => {
    // Where the tops touch is the top edge of both phones; each bottom edge is its own end.
    expect(toPhone(0, 0.5, 0)).toEqual({ x: 0.5, y: -0 });
    expect(toPhone(1, 0.5, 0)).toEqual({ x: 0.5, y: 0 });
    expect(toPhone(0, 0.2, -PHONE_L)).toEqual({ x: 0.2, y: 1 });
    // The other phone lies the other way round: left and right swap.
    expect(toPhone(1, 0.2, PHONE_L)).toEqual({ x: 0.8, y: 1 });
    for (const side of [0, 1] as Side[]) {
      for (const [x, y] of [
        [0.1, 0.3],
        [0.7, -1.2],
        [0.5, 1.7],
      ] as const) {
        const p = toPhone(side, x, y);
        const back = fromPhone(side, p.x, p.y);
        expect(back.x).toBeCloseTo(x, 9);
        expect(back.y).toBeCloseTo(y, 9);
      }
    }
  });

  it('pairs people up: one match, a final for three, two matches for four', () => {
    const rng = createRng(3);
    const two = planTable([0, 1], [2, 3], rng);
    expect(two.first).toHaveLength(1);
    expect([...(two.first[0] as number[])].sort()).toEqual([0, 1]);
    expect(two.sofa.sort()).toEqual([2, 3]);
    expect(two.waiting).toBeNull();

    const three = planTable([0, 1, 2], [3], rng);
    expect(three.first).toHaveLength(1);
    expect(three.waiting).not.toBeNull();
    expect([...(three.first[0] as number[]), three.waiting].sort()).toEqual([0, 1, 2]);
    expect(three.sofa).toEqual([3]);

    const four = planTable([0, 1, 2, 3], [], rng);
    expect(four.first).toHaveLength(2);
    expect(four.first.flat().sort()).toEqual([0, 1, 2, 3]);
  });

  it('gives a lone player a computer opponent, made up if there is no computer seat', () => {
    const rng = createRng(5);
    const withCpus = planTable([2], [0, 1, 3], rng);
    expect(withCpus.first).toHaveLength(1);
    expect(withCpus.first[0]?.[0]).toBe(2);
    expect([0, 1, 3]).toContain(withCpus.first[0]?.[1]);
    expect(withCpus.phantom).toBeNull();
    expect(withCpus.sofa).toHaveLength(2);

    const alone = planTable([0], [], rng);
    expect(alone.first).toEqual([[0, 1]]);
    expect(alone.phantom).toBe(1);
    expect(alone.sofa).toEqual([]);

    // Nobody at the table (a demo): the computer players play each other.
    expect(planTable([], [0, 1, 2, 3], rng).first).toHaveLength(2);
  });

  it('ranks the final above the first round, wins above losses, then the margin', () => {
    const o = (players: [number, number], points: [number, number], round: 1 | 2): MatchOutcome => ({
      players,
      points,
      winner: points[0] === points[1] ? null : points[0] > points[1] ? 0 : 1,
      round,
    });
    // Four players side by side, plus nobody on the sofa.
    const side = tableScores(4, [o([0, 1], [5, 1], 1), o([2, 3], [5, 4], 1)]);
    expect(side[0]).toBeGreaterThan(side[2] as number); // the bigger win
    expect(side[2]).toBeGreaterThan(side[3] as number);
    expect(side[3]).toBeGreaterThan(side[1] as number); // the closer loss
    // Three players: 0 beat 1, then 2 beat 0 in the final; 3 watched.
    const three = tableScores(4, [o([0, 1], [3, 0], 1), o([2, 0], [3, 2], 2)]);
    expect(three[2]).toBeGreaterThan(three[0] as number);
    expect(three[0]).toBeGreaterThan(three[1] as number);
    expect(three[1]).toBeGreaterThan(three[3] as number);
    expect(three[3]).toBe(0);
    // A made-up opponent (position 1 of 1 seat) gets no score.
    expect(tableScores(1, [o([0, 1], [2, 5], 1)])).toHaveLength(1);
    // A draw sits between a win and a loss.
    const draw = tableScores(2, [o([0, 1], [2, 2], 1)]);
    expect(draw[0]).toBe(draw[1]);
  });

  it('sends the winner through, or tosses a coin on a draw', () => {
    expect(advancer({ players: [4, 7], points: [1, 3], winner: 1, round: 1 }, createRng(1))).toBe(7);
    const seen = new Set<number>();
    for (let seed = 1; seed < 30; seed++) seen.add(advancer({ players: [4, 7], points: [2, 2], winner: null, round: 1 }, createRng(seed)));
    expect([...seen].sort()).toEqual([4, 7]);
  });
});

describe('coaster hockey', () => {
  it('bounces the coaster off the side rails', () => {
    const r = newRink(0);
    r.puck = { x: 0.5, y: -0.5, vx: -2, vy: 0 };
    run(r, 0.4);
    expect(r.puck.vx).toBeGreaterThan(0);
    expect(r.puck.x).toBeGreaterThanOrEqual(HOCKEY.puckR);
  });

  it('scores when the coaster goes into a slot, and serves it back to the side that conceded', () => {
    const r = newRink(0);
    r.mallets[0].x = 0.15; // out of the way
    r.mallets[0].tx = 0.15;
    r.puck = { x: 0.5, y: -1.2, vx: 0, vy: -2.5 };
    const events = run(r, 0.5);
    expect(events).toContainEqual({ t: 'goal', side: 1 });
    expect(r.score).toEqual([0, 1]);
    expect(r.live).toBe(false);
    const later = run(r, HOCKEY.goalPause + 0.1);
    expect(later).toContainEqual({ t: 'serve', side: 0 });
    expect(r.live).toBe(true);
    expect(r.puck.y).toBeLessThan(0); // back on side 0's phone
  });

  it('bounces off the end beside the slot', () => {
    const r = newRink(0);
    r.mallets[1].x = 0.5;
    r.puck = { x: 0.08 + HOCKEY.puckR, y: 1.3, vx: 0, vy: 2.5 };
    run(r, 0.4);
    expect(r.score).toEqual([0, 0]);
    expect(r.puck.vy).toBeLessThan(0);
  });

  it('crosses from one phone to the other through the touching tops', () => {
    const r = newRink(0);
    r.mallets[1].x = 0.85;
    r.mallets[1].tx = 0.85;
    r.puck = { x: 0.3, y: -0.6, vx: 0, vy: 2 };
    run(r, 0.6);
    expect(r.puck.y).toBeGreaterThan(0);
  });

  it('keeps each mallet on its own phone and moves it no faster than its top speed', () => {
    const r = newRink(0);
    aimMallet(r, 0, 1.4, 1.2);
    expect(r.mallets[0].ty).toBeLessThanOrEqual(-HOCKEY.malletR);
    expect(r.mallets[0].tx).toBeLessThanOrEqual(1 - HOCKEY.malletR);
    aimMallet(r, 1, -0.4, -1);
    expect(r.mallets[1].ty).toBeGreaterThanOrEqual(HOCKEY.malletR);
    expect(r.mallets[1].tx).toBeGreaterThanOrEqual(HOCKEY.malletR);
    const before = { x: r.mallets[0].x, y: r.mallets[0].y };
    stepRink(r, HOCKEY.step);
    const moved = Math.hypot(r.mallets[0].x - before.x, r.mallets[0].y - before.y);
    expect(moved).toBeLessThanOrEqual(HOCKEY.malletMax * HOCKEY.step + 1e-9);
  });

  it('knocks the coaster away from a mallet that runs into it', () => {
    const r = newRink(0);
    r.puck = { x: 0.5, y: -0.9, vx: 0, vy: 0 };
    r.mallets[0].x = 0.5;
    r.mallets[0].y = -1.2;
    aimMallet(r, 0, 0.5, -0.5);
    const events = run(r, 0.2);
    expect(events.some((e) => e.t === 'hit' && e.side === 0)).toBe(true);
    expect(r.puck.vy).toBeGreaterThan(1);
  });

  it('lets a sharp computer player beat a sleepy one, and keeps even players even', () => {
    let sharp = 0;
    let sleepy = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const flip = seed % 2 === 0;
      const [a, b] = cpuMatch(seed, flip ? [0.9, 0.15] : [0.15, 0.9]);
      const s = flip ? a : b;
      const z = flip ? b : a;
      if (s > z) sharp++;
      else if (z > s) sleepy++;
    }
    expect(sharp).toBeGreaterThan(30);
    expect(sleepy).toBeLessThan(5);

    let left = 0;
    let right = 0;
    let goals = 0;
    for (let seed = 100; seed < 140; seed++) {
      const [a, b] = cpuMatch(seed, [0.5, 0.5]);
      goals += a + b;
      if (a > b) left++;
      else if (b > a) right++;
    }
    expect(Math.abs(left - right)).toBeLessThan(14);
    // Average players do score: the coaster doesn't just get blocked all game.
    expect(goals / 40).toBeGreaterThan(2);
  });
});
