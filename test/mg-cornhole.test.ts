import { describe, expect, it } from 'vitest';
import {
  type Board,
  type BoardEvent,
  TOSS,
  type Toss,
  aimFor,
  boardScore,
  cpuSpeed,
  idealSpeed,
  landBag,
  newBoard,
  onBoard,
  planToss,
  settled,
  steadiness,
  stepBoard,
  tossScores,
  turnOrder,
} from '../src/game/minigames/cornhole';
import { createRng } from '../src/game/rng';

/** Lets a board settle; returns everything that happened. */
function settle(b: Board, newest: number): BoardEvent[] {
  const events: BoardEvent[] = [];
  for (let i = 0; i < 1200 && !settled(b); i++) events.push(...stepBoard(b, newest));
  return events;
}

const straight = (y: number, vy = 0): Toss => ({ speed: 0.5, x: 0, y, vx: 0, vy });

/** A whole game between two teams of two computer players; returns both boards. */
function game(seed: number, skills: [number, number, number, number]): Board[] {
  const rng = createRng(seed);
  const teams = [
    [0, 1],
    [2, 3],
  ];
  const boards = [newBoard(), newBoard()];
  const prev: (number | null)[] = [null, null, null, null];
  for (const { team, player } of turnOrder(teams)) {
    const speed = cpuSpeed(skills[player] ?? 0.5, rng);
    const toss = planToss(speed, prev[player] ?? null, rng);
    prev[player] = speed;
    const b = boards[team] as Board;
    const { index } = landBag(b, player, toss);
    settle(b, index);
  }
  return boards;
}

describe('bean bag toss: turns', () => {
  it('alternates teams and partners, four tosses each', () => {
    const order = turnOrder([
      [0, 1],
      [2, 3],
    ]);
    expect(order).toHaveLength(16);
    expect(order.slice(0, 4).map((o) => o.player)).toEqual([0, 2, 1, 3]);
    for (const p of [0, 1, 2, 3]) expect(order.filter((o) => o.player === p)).toHaveLength(TOSS.tosses);
  });

  it('lets a team of one toss for two, so both teams throw as many bags', () => {
    const order = turnOrder([[0], [1, 2]]);
    expect(order.filter((o) => o.team === 0)).toHaveLength(8);
    expect(order.filter((o) => o.team === 1)).toHaveLength(8);
    expect(order.filter((o) => o.player === 0)).toHaveLength(8);
  });
});

describe('bean bag toss: tossing', () => {
  it('throws further the faster the swipe', () => {
    expect(aimFor(0.7).y).toBeGreaterThan(aimFor(0.5).y);
    expect(aimFor(0.2).y).toBeLessThan(TOSS.board.y0); // a lazy flick lands on the grass
    expect(aimFor(1).y).toBeGreaterThan(TOSS.board.y1); // a wild one sails over
    const ideal = idealSpeed();
    expect(ideal).toBeGreaterThan(0.5);
    expect(ideal).toBeLessThan(0.7);
    expect(onBoard(0, aimFor(ideal).y)).toBe(true);
  });

  it('scatters less when the swipe matches the last one', () => {
    expect(steadiness(0.6, 0.6)).toBe(1);
    expect(steadiness(0.6, 0.3)).toBe(0);
    expect(steadiness(0.6, null)).toBeGreaterThan(0);
    const spread = (prev: number | null) => {
      const rng = createRng(3);
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += Math.abs(planToss(0.6, prev, rng).x);
      return sum / 400;
    };
    expect(spread(0.6)).toBeLessThan(spread(0.2) * 0.6);
  });
});

describe('bean bag toss: the board', () => {
  it('counts a bag on the board as 1 and a bag on the grass as nothing', () => {
    const b = newBoard();
    landBag(b, 0, straight(7.5, 0.3));
    landBag(b, 0, straight(5, 0.3));
    landBag(b, 0, { ...straight(8), x: 0.9 });
    settle(b, 2);
    expect(boardScore(b)).toEqual({ points: 1, on: 1, holes: 0 });
  });

  it('drops a bag straight through when it lands on the hole', () => {
    const b = newBoard();
    const { events } = landBag(b, 0, straight(TOSS.hole.y, 1));
    expect(events).toEqual([{ kind: 'hole', index: 0, knocked: false }]);
    expect(boardScore(b).points).toBe(3);
  });

  it('slides a well-judged bag up the board and into the hole', () => {
    const b = newBoard();
    const v = Math.sqrt(2 * TOSS.decel.board * 0.5);
    const { index } = landBag(b, 0, straight(TOSS.hole.y - 0.5, v));
    const events = settle(b, index);
    expect(events.filter((e) => e.kind === 'hole')).toEqual([{ kind: 'hole', index: 0, knocked: false }]);
    expect(boardScore(b)).toEqual({ points: 3, on: 0, holes: 1 });
  });

  it('lets a later bag knock an earlier one into the hole', () => {
    const b = newBoard();
    // The first bag stops just short of the hole.
    landBag(b, 0, straight(TOSS.hole.y - TOSS.hole.r - 0.03, 0));
    settle(b, 0);
    expect(boardScore(b).holes).toBe(0);
    // The second slides up behind it and bumps it in.
    const { index } = landBag(b, 1, straight(TOSS.hole.y - 0.9, 2));
    const events = settle(b, index);
    expect(events.some((e) => e.kind === 'bump')).toBe(true);
    expect(events).toContainEqual({ kind: 'hole', index: 0, knocked: true });
    expect(boardScore(b).holes).toBeGreaterThanOrEqual(1);
  });

  it('can knock a bag off the back of the board', () => {
    const b = newBoard();
    landBag(b, 0, straight(TOSS.board.y1 - 0.1, 0));
    landBag(b, 0, { ...straight(TOSS.board.y1 - 0.1), x: 0.3 });
    settle(b, 1);
    const before = boardScore(b).on;
    const { index } = landBag(b, 1, { ...straight(TOSS.board.y1 - 0.5, 2.2), x: 0.3 });
    settle(b, index);
    expect(boardScore(b).on).toBeLessThanOrEqual(before);
    expect(b.bags.some((bag) => !onBoard(bag.x, bag.y) && bag.state !== 'hole')).toBe(true);
  });

  it('gives both partners their board’s points', () => {
    const a = newBoard();
    landBag(a, 0, straight(TOSS.hole.y));
    landBag(a, 1, straight(7.5));
    const b = newBoard();
    landBag(b, 2, straight(7.5));
    expect(tossScores([a, b], [[0, 1], [2, 3]], 4)).toEqual([4, 4, 1, 1]);
  });
});

describe('bean bag toss: computer players', () => {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const games = (s: number, n = 60) => Array.from({ length: n }, (_, i) => game(70 + i, [s, s, s, s]));

  it('sharp throwers outscore sleepy ones on average, and land in the hole now and then, not all the time', () => {
    const sharp = games(1).map((g) => boardScore(g[0] as Board));
    const sleepy = games(0.1).map((g) => boardScore(g[0] as Board));
    expect(mean(sharp.map((s) => s.points))).toBeGreaterThan(mean(sleepy.map((s) => s.points)) + 2.5);
    const holeRate = mean(sharp.map((s) => s.holes)) / (2 * TOSS.tosses);
    expect(holeRate).toBeGreaterThan(0.1);
    expect(holeRate).toBeLessThan(0.35);
    // Sleepy teams still score something.
    expect(mean(sleepy.map((s) => s.points))).toBeGreaterThan(4);
  });

  it('a sharp team usually wins, and close teams are a contest', () => {
    let sharp = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < 80; i++) {
      const [x, y] = game(400 + i, [0.8, 0.8, 0.35, 0.35]).map((g) => boardScore(g).points);
      if ((x ?? 0) > (y ?? 0)) sharp++;
      const [p, q] = game(800 + i, [0.6, 0.6, 0.5, 0.5]).map((g) => boardScore(g).points);
      if ((p ?? 0) > (q ?? 0)) a++;
      if ((q ?? 0) > (p ?? 0)) b++;
    }
    expect(sharp).toBeGreaterThan(50);
    expect(b).toBeGreaterThan(15);
    expect(a).toBeGreaterThan(b * 0.9);
  });
});
