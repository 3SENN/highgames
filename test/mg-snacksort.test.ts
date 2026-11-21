import { describe, expect, it } from 'vitest';
import {
  SNACKSORT,
  SNACK_TYPES,
  type SnackCpu,
  type SnackSort,
  beltSpeed,
  cpuSnackSort,
  dealTypes,
  grab,
  newSnackSort,
  resolvedSnacks,
  snackCoop,
  stationX,
  stepSnackSort,
} from '../src/game/minigames/snacksort';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** Runs a whole game; `act` is called every step. */
function play(players: number, seed: number, act: (s: SnackSort) => void): SnackSort {
  const rng = createRng(seed);
  const s = newSnackSort(rng, players);
  for (let t = 0; t < SNACKSORT.duration; t += DT) {
    stepSnackSort(s, DT, rng);
    act(s);
  }
  return s;
}

describe('snack sort', () => {
  it('deals every snack type to exactly one player, one or two each for 2-4 players', () => {
    for (let players = 1; players <= 4; players++) {
      const owned = dealTypes(createRng(players * 7), players);
      expect(owned).toHaveLength(players);
      expect(owned.flat().sort()).toEqual([...SNACK_TYPES].sort());
      if (players >= 2) for (const types of owned) expect(types.length).toBeGreaterThanOrEqual(1);
      if (players >= 2) for (const types of owned) expect(types.length).toBeLessThanOrEqual(2);
    }
  });

  it('spaces the stations evenly around the middle', () => {
    expect(stationX(0, 4)).toBeCloseTo(-1.5 * SNACKSORT.stationGap);
    expect(stationX(3, 4)).toBeCloseTo(1.5 * SNACKSORT.stationGap);
    expect(stationX(2, 4) - stationX(1, 4)).toBeCloseTo(SNACKSORT.stationGap);
    expect(stationX(0, 1)).toBe(0);
    expect(stationX(0, 2) + stationX(1, 2)).toBe(0);
  });

  it('speeds the belt up over time', () => {
    expect(beltSpeed(0)).toBe(SNACKSORT.speedFrom);
    expect(beltSpeed(SNACKSORT.duration)).toBe(SNACKSORT.speedTo);
  });

  it('gets every snack past its station before time is up', () => {
    for (let players = 1; players <= 4; players++) {
      let spawned = 0;
      const rng = createRng(players);
      const s = newSnackSort(rng, players);
      for (let t = 0; t < SNACKSORT.duration; t += DT) spawned += stepSnackSort(s, DT, rng).filter((e) => e.kind === 'spawn').length;
      expect(spawned).toBeGreaterThan(20);
      expect(s.missed).toBe(spawned);
      expect(resolvedSnacks(s)).toBe(spawned);
      expect(snackCoop(s)).toBe(0);
    }
  });

  it('keeps snacks far enough apart that only one is ever at a station', () => {
    let closest = Infinity;
    play(4, 3, (s) => {
      const xs = s.snacks.map((x) => x.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) closest = Math.min(closest, (xs[i] as number) - (xs[i - 1] as number));
    });
    expect(closest).toBeGreaterThan(SNACKSORT.window * 2);
  });

  it('counts a grab of your own snack at your station, and a grab of someone else’s as wrong', () => {
    const rng = createRng(11);
    const s = newSnackSort(rng, 4);
    s.time = 5;
    s.snacks.push({ id: 1, type: 'sweet', owner: 2, x: stationX(2, 4) + 0.3, status: 'belt', missed: false });
    s.snacks.push({ id: 2, type: 'salty', owner: 3, x: stationX(1, 4) - 0.2, status: 'belt', missed: false });
    expect(grab(s, 2).kind).toBe('correct');
    expect(grab(s, 1).kind).toBe('wrong');
    expect(s.stolen).toBe(1);
    expect(grab(s, 0).kind).toBe('empty');
    expect(grab(s, 0).kind).toBe('cooldown');
    expect(s.correct).toEqual([0, 0, 1, 0]);
    expect(s.wrong).toEqual([0, 1, 0, 0]);
    // One right, one stolen, one wrong grab: 1 / (2 + 1).
    expect(snackCoop(s)).toBeCloseTo(1 / 3);
  });

  it('judges a grab where the snack was when the player pressed', () => {
    const s = newSnackSort(createRng(2), 4);
    s.time = 2;
    const x = stationX(1, 4) + SNACKSORT.window + 0.1;
    s.snacks.push({ id: 7, type: 'sour', owner: 1, x, status: 'belt', missed: false });
    expect(grab(s, 1, 0).kind).toBe('empty');
    s.readyAt[1] = 0;
    expect(grab(s, 1, 0.12).kind).toBe('correct');
  });

  it('scores a perfect group 1', () => {
    const s = play(4, 5, (st) => {
      for (const snack of st.snacks) {
        if (snack.status === 'belt' && !snack.missed && Math.abs(snack.x - stationX(snack.owner, 4)) < 0.1) grab(st, snack.owner);
      }
    });
    expect(totalOf(s.correct)).toBeGreaterThan(20);
    expect(snackCoop(s)).toBe(1);
  });

  it('lets sharp computer players do great and average ones decently', () => {
    const avg = (skill: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const plans: SnackCpu[] = [0, 1, 2, 3].map(() => new Map());
        const rng = createRng(seed * 31);
        sum += snackCoop(play(4, seed, (s) => [0, 1, 2, 3].forEach((i) => cpuSnackSort(s, i, skill, rng, plans[i] as SnackCpu))));
      }
      return sum / 40;
    };
    expect(avg(1)).toBeGreaterThan(0.9);
    const mid = avg(0.5);
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(0.88);
  });
});

function totalOf(list: number[]): number {
  return list.reduce((a, b) => a + b, 0);
}
