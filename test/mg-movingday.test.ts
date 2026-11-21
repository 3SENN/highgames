import { describe, expect, it } from 'vitest';
import {
  MOVE,
  type Move,
  beatPhase,
  beatTime,
  cpuPumps,
  holdNeed,
  isOver,
  liftNeed,
  moveCoop,
  newMove,
  newMoveCpu,
  pump,
  stepMove,
} from '../src/game/minigames/movingday';
import { createRng } from '../src/game/rng';

/** Runs the clock up to `t` (game seconds). */
const until = (m: Move, t: number) => stepMove(m, Math.max(0, t - m.time));

/** Plays a beat: the given seats pump right on it, then the beat is settled. */
function beat(m: Move, seats: number[], offset = 0) {
  const at = beatTime(m.beat) + offset;
  until(m, at);
  const results = seats.map((s) => pump(m, s, at));
  const closes = until(m, beatTime(m.beat) + MOVE.window + MOVE.grace + 0.01);
  return { results, closes };
}

/** A group of computer players at one skill, pumping as the TV plays them. */
function simulate(players: number, skill: number, seed: number): Move {
  const rng = createRng(seed);
  const m = newMove(players);
  const cpus = Array.from({ length: players }, () => newMoveCpu(rng, skill));
  const queue: { seat: number; at: number }[] = [];
  let planned = -1;
  while (!isOver(m)) {
    const now = m.time + 1 / 60;
    while (beatTime(planned + 1) - MOVE.beat / 2 <= now) {
      planned++;
      cpus.forEach((c, seat) => cpuPumps(c, skill, rng, beatTime(planned)).forEach((at) => queue.push({ seat, at })));
      queue.sort((a, b) => a.at - b.at);
    }
    while (queue.length && (queue[0] as { at: number }).at <= now) {
      const p = queue.shift() as { seat: number; at: number };
      until(m, p.at);
      pump(m, p.seat, p.at);
    }
    until(m, now);
  }
  return m;
}

describe('moving day', () => {
  it('needs most of the group to lift, and half of an even group to hold', () => {
    expect([1, 2, 3, 4].map(liftNeed)).toEqual([1, 2, 2, 3]);
    expect([1, 2, 3, 4].map(holdNeed)).toEqual([1, 1, 2, 2]);
    expect(beatPhase(beatTime(3))).toBeCloseTo(0);
    expect(beatPhase(beatTime(3) + MOVE.beat / 2)).toBeCloseTo(0.5);
    expect(beatPhase(0)).toBeLessThan(0);
  });

  it('goes up a step as soon as most of the group pumps in time', () => {
    const m = newMove(4);
    const { results, closes } = beat(m, [0, 1, 2], 0.05);
    expect(results.map((r) => r.kind)).toEqual(['sync', 'sync', 'sync']);
    expect(results.map((r) => r.lifted)).toEqual([false, false, true]);
    expect(m.step).toBe(1);
    expect(closes[0]?.outcome).toBe('up');
    expect(m.lifts).toEqual([1, 1, 1, 0]);
  });

  it('counts a seat once per beat, and ignores pumps for a beat that was already settled', () => {
    const m = newMove(2);
    const at = beatTime(0);
    until(m, at);
    expect(pump(m, 0, at).kind).toBe('sync');
    expect(pump(m, 0, at + 0.05).kind).toBe('again');
    until(m, beatTime(0) + MOVE.window + MOVE.grace + 0.01);
    expect(pump(m, 1, at).kind).toBe('late');
    expect(m.offBeat).toEqual([0, 0]);
  });

  it('holds with half the group, and slides down a step after two missed beats in a row', () => {
    const m = newMove(4);
    beat(m, [0, 1, 2]);
    beat(m, [0, 1, 2, 3]);
    expect(m.step).toBe(2);
    expect(beat(m, [0, 1]).closes[0]?.outcome).toBe('hold');
    expect(beat(m, [0]).closes[0]?.outcome).toBe('miss');
    expect(beat(m, [0, 1]).closes[0]?.outcome).toBe('hold');
    expect(m.step).toBe(2);
    expect(beat(m, []).closes[0]?.outcome).toBe('slide');
    expect(m.step).toBe(1);
    expect(m.slides).toBe(1);
    // Never below the bottom step.
    beat(m, []);
    beat(m, []);
    beat(m, []);
    beat(m, []);
    expect(m.step).toBe(0);
  });

  it('wobbles from pumps between beats, and a wobbly couch cannot be lifted', () => {
    const m = newMove(2);
    const early = beatTime(0) - 0.3;
    until(m, early);
    const r = pump(m, 0, early);
    expect(r.kind).toBe('off');
    expect(r.offset).toBeCloseTo(-0.3);
    expect(m.wobble).toBeCloseTo(MOVE.offWobble / 3);
    pump(m, 1, early + 0.02);
    pump(m, 0, early + 0.04);
    const { results, closes } = beat(m, [0, 1]);
    expect(results.some((x) => x.lifted)).toBe(false);
    expect(closes[0]).toMatchObject({ outcome: 'miss', wobbly: true });
    expect(m.offBeat).toEqual([2, 1]);
    expect(m.inTime).toEqual([1, 1]);
    // It settles down again.
    until(m, m.time + 3);
    expect(m.wobble).toBe(0);
  });

  it('reaches the top in twelve good beats and scores a perfect group 1', () => {
    const m = newMove(3);
    for (let i = 0; i < MOVE.steps; i++) beat(m, [0, 1, 2]);
    expect(m.step).toBe(MOVE.steps);
    expect(m.doneAt).not.toBeNull();
    expect(isOver(m)).toBe(true);
    expect(moveCoop(m)).toBe(1);
  });

  it('scores the steps climbed, with a bonus for reaching the top that grows the sooner it was', () => {
    const m = newMove(4);
    m.step = 6;
    expect(moveCoop(m)).toBeCloseTo(0.45);
    m.step = MOVE.steps;
    m.doneAt = MOVE.duration;
    expect(moveCoop(m)).toBeCloseTo(0.94);
    m.doneAt = MOVE.duration - MOVE.earlyFull / 2;
    expect(moveCoop(m)).toBeCloseTo(0.97);
  });

  it('ignores pumps while everyone gets a grip, and after the end', () => {
    const m = newMove(2);
    until(m, 0.5);
    expect(pump(m, 0, 0.5).kind).toBe('ignored');
    expect(m.wobble).toBe(0);
    expect(m.offBeat).toEqual([0, 0]);
  });

  it('runs out of time at 40 seconds', () => {
    const m = newMove(1);
    until(m, MOVE.duration + 5);
    expect(isOver(m)).toBe(true);
    expect(m.step).toBe(0);
    expect(moveCoop(m)).toBe(0);
    expect(pump(m, 0, MOVE.duration).kind).toBe('ignored');
  });

  it('lets sharp computer players reach the top early and gets average ones most of the way', () => {
    const avg = (players: number, skill: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 80; seed++) sum += moveCoop(simulate(players, skill, seed * 7 + players));
      return sum / 80;
    };
    expect(avg(4, 1)).toBeGreaterThan(0.97);
    const mid = avg(4, 0.5);
    expect(mid).toBeGreaterThan(0.65);
    expect(mid).toBeLessThan(0.85);
    for (const players of [1, 2, 3]) {
      expect(avg(players, 1)).toBeGreaterThan(0.95);
      const v = avg(players, 0.5);
      expect(v).toBeGreaterThan(0.45);
      expect(v).toBeLessThan(0.97);
    }
  });
});
