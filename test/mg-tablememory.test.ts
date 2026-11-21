import { describe, expect, it } from 'vitest';
import {
  MEMORY,
  SNACKS,
  type MemoryGame,
  cardAt,
  cardPlace,
  cardRect,
  cpuChoose,
  cpuDelay,
  gridFor,
  memoryScores,
  newBoard,
  newCpuMemory,
  newMemory,
  notice,
  pairsLeft,
  pick,
  stepMemory,
} from '../src/game/minigames/tablememory';
import { createRng } from '../src/game/rng';

/** Two cards with the same snack, and one that isn't. */
function pairAndOdd(g: MemoryGame): { a: number; b: number; odd: number } {
  const cards = g.board.cards;
  const a = 0;
  const b = cards.findIndex((c, i) => i !== a && c.face === cards[a]?.face);
  const odd = cards.findIndex((c) => c.face !== cards[a]?.face);
  return { a, b, odd };
}

/** Plays a whole game of computer players at their own pace. Returns pairs per player and the time it took. */
function simulate(skills: number[], phones: number, seed: number, first = 0): { pairs: number[]; time: number; cleared: boolean } {
  const rng = createRng(seed);
  const g = newMemory(skills.length, phones, first, rng);
  const minds = skills.map((s) => newCpuMemory(s));
  let t = 0;
  let next: number | null = null;
  const dt = 1 / 30;
  while (!g.over && t < 200) {
    for (const e of stepMemory(g, t, false)) if (e.t === 'go') next = null;
    if (!g.over && g.resolveAt === null && g.picks.length < 2) {
      const skill = skills[g.turn] ?? 0.5;
      next ??= t + cpuDelay(skill, g.picks.length === 1, rng);
      if (t >= next) {
        const card = cpuChoose(minds[g.turn] as ReturnType<typeof newCpuMemory>, g, t, rng);
        if (card !== null && pick(g, card, t).ok) {
          const face = g.board.cards[card]?.face ?? 0;
          for (const m of minds) notice(m, card, face, t, rng);
        }
        next = null;
      }
    }
    t += dt;
  }
  return { pairs: g.pairs, time: t, cleared: pairsLeft(g.board) === 0 };
}

describe('coffee table memory', () => {
  it('deals enough pairs for every number of phones, each snack exactly twice', () => {
    const expected: Record<number, number> = { 1: 12, 2: 12, 3: 18, 4: 16 };
    for (let phones = 1; phones <= 4; phones++) {
      for (let seed = 1; seed < 15; seed++) {
        const b = newBoard(phones, createRng(seed));
        expect(b.cards).toHaveLength(expected[phones] as number);
        expect(b.cards.length / 2).toBeLessThanOrEqual(SNACKS.length);
        const counts = new Map<number, number>();
        for (const c of b.cards) counts.set(c.face, (counts.get(c.face) ?? 0) + 1);
        expect([...counts.values()].every((n) => n === 2)).toBe(true);
        expect(b.cards.every((c) => c.state === 'down' && c.owner === null)).toBe(true);
      }
    }
    expect(gridFor(4)).toMatchObject({ cols: 2, rows: 2 });
    expect(gridFor(3)).toMatchObject({ cols: 2, rows: 3 });
    expect(gridFor(2)).toMatchObject({ cols: 2, rows: 3 });
    expect(gridFor(1)).toMatchObject({ cols: 3, rows: 4 });
  });

  it('lays the coasters inside the phone, clear of each other and of the top and bottom lines', () => {
    for (let phones = 1; phones <= 4; phones++) {
      const grid = gridFor(phones);
      const n = grid.cols * grid.rows;
      for (let s = 0; s < n; s++) {
        const r = cardRect(grid, s);
        expect(r.x - r.w / 2).toBeGreaterThan(0.03);
        expect(r.x + r.w / 2).toBeLessThan(0.97);
        expect(r.y - r.h / 2).toBeGreaterThan(0.19);
        expect(r.y + r.h / 2).toBeLessThan(0.87);
        expect(cardAt(grid, r.x, r.y)).toBe(s);
        expect(cardAt(grid, r.x + r.w * 0.45, r.y - r.h * 0.45)).toBe(s);
        for (let o = s + 1; o < n; o++) {
          const q = cardRect(grid, o);
          const apart = Math.abs(q.x - r.x) >= r.w + 0.02 || Math.abs(q.y - r.y) >= r.h + 0.01;
          expect(apart).toBe(true);
        }
      }
      expect(cardAt(grid, 0.5, 0.05)).toBeNull();
      expect(cardAt(grid, 0.5, 0.95)).toBeNull();
    }
    const b = newBoard(3, createRng(1));
    expect(cardPlace(b, 7)).toEqual({ phone: 1, slot: 1 });
  });

  it('gives a pair to whoever found it, and they go again', () => {
    const g = newMemory(3, 4, 1, createRng(5));
    const { a, b } = pairAndOdd(g);
    expect(pick(g, a, 1)).toEqual({ ok: true, second: false, match: null });
    expect(pick(g, a, 1.1)).toEqual({ ok: false, why: 'gone' });
    expect(pick(g, b, 1.5)).toEqual({ ok: true, second: true, match: true });
    expect(pick(g, 5, 1.6)).toEqual({ ok: false, why: 'busy' });
    expect(stepMemory(g, 1.6)).toEqual([]);
    const events = stepMemory(g, 1.5 + MEMORY.flip + MEMORY.matchShow);
    expect(events).toContainEqual({ t: 'pair', player: 1, cards: [a, b], face: g.board.cards[a]?.face });
    expect(events).toContainEqual({ t: 'go', player: 1, again: true, slow: false });
    expect(g.pairs).toEqual([0, 1, 0]);
    expect(g.board.cards[a]).toMatchObject({ state: 'taken', owner: 1 });
    expect(pick(g, b, 3)).toEqual({ ok: false, why: 'gone' });
  });

  it('turns a miss back over after a second and passes the go on', () => {
    const g = newMemory(2, 2, 1, createRng(8));
    const { a, odd } = pairAndOdd(g);
    pick(g, a, 0.5);
    expect(pick(g, odd, 0.9)).toMatchObject({ ok: true, match: false });
    // Still face up for a second after it has turned.
    expect(stepMemory(g, 0.9 + MEMORY.flip + MEMORY.missShow - 0.05)).toEqual([]);
    expect(g.board.cards[odd]?.state).toBe('up');
    const events = stepMemory(g, 0.9 + MEMORY.flip + MEMORY.missShow);
    expect(events).toContainEqual({ t: 'miss', player: 1, cards: [a, odd] });
    expect(events).toContainEqual({ t: 'go', player: 0, again: false, slow: false });
    expect(g.board.cards[a]?.state).toBe('down');
    expect(g.board.cards[odd]?.state).toBe('down');
    expect(g.misses).toEqual([0, 1]);
  });

  it('passes a go that takes too long (people only) and ends when time is up', () => {
    const g = newMemory(2, 1, 0, createRng(2));
    pick(g, 3, 1);
    expect(stepMemory(g, MEMORY.turnTime - 0.1)).toEqual([]);
    expect(stepMemory(g, MEMORY.turnTime)).toEqual([{ t: 'go', player: 1, again: false, slow: true }]);
    expect(g.board.cards[3]?.state).toBe('down');
    expect(stepMemory(g, MEMORY.turnTime * 2.5, false)).toEqual([]);
    pick(g, 4, MEMORY.duration - 1);
    expect(stepMemory(g, MEMORY.duration)).toEqual([{ t: 'over', timeUp: true }]);
    expect(g.board.cards[4]?.state).toBe('down');
    expect(pick(g, 5, MEMORY.duration + 1)).toEqual({ ok: false, why: 'over' });
  });

  it('finishes a go that is being judged when time runs out', () => {
    const g = newMemory(2, 4, 0, createRng(3));
    const { a, b } = pairAndOdd(g);
    pick(g, a, MEMORY.duration - 0.5);
    pick(g, b, MEMORY.duration - 0.2);
    expect(stepMemory(g, MEMORY.duration)).toEqual([]);
    const events = stepMemory(g, MEMORY.duration + 1);
    expect(events.map((e) => e.t)).toEqual(['pair', 'over']);
    expect(memoryScores(g)).toEqual([1, 0]);
  });

  it('ends as soon as the last pair is taken', () => {
    const g = newMemory(2, 4, 0, createRng(4));
    let t = 0;
    const faces = new Map<number, number[]>();
    g.board.cards.forEach((c, i) => faces.set(c.face, [...(faces.get(c.face) ?? []), i]));
    const events: string[] = [];
    for (const [a, b] of faces.values()) {
      pick(g, a as number, t);
      pick(g, b as number, t + 0.1);
      t += 2;
      events.push(...stepMemory(g, t).map((e) => e.t));
    }
    expect(events[events.length - 1]).toBe('over');
    expect(g.pairs).toEqual([8, 0]);
    expect(g.over).toBe(true);
  });

  it('has a computer player go for a pair it remembers', () => {
    const rng = createRng(11);
    const g = newMemory(2, 4, 0, rng);
    const m = newCpuMemory(1);
    const { a, b } = pairAndOdd(g);
    m.seen.set(a, { face: g.board.cards[a]?.face ?? 0, at: 0 });
    m.seen.set(b, { face: g.board.cards[b]?.face ?? 0, at: 0 });
    const first = cpuChoose(m, g, 1, rng);
    expect([a, b]).toContain(first);
    pick(g, first as number, 1);
    expect(cpuChoose(m, g, 2, rng)).toBe(first === a ? b : a);
  });

  it('has sharp computer players remember better than sleepy ones, and find most pairs in time', () => {
    const runs = 160;
    const total = { sleepy: 0, average: 0, sharp: 0 };
    let found = 0;
    let smallCleared = 0;
    let small = 0;
    for (let seed = 1; seed <= runs; seed++) {
      // Rotate the seats so going first doesn't decide it.
      const order = [0.05, 0.5, 0.95, 0.5];
      const shift = seed % 4;
      const skills = [...order.slice(shift), ...order.slice(0, shift)];
      const phones = 1 + (seed % 4);
      const r = simulate(skills, phones, seed);
      skills.forEach((s, i) => {
        const k = s < 0.3 ? 'sleepy' : s < 0.7 ? 'average' : 'sharp';
        total[k] += (r.pairs[i] ?? 0) / runs / (k === 'average' ? 2 : 1);
      });
      found += r.pairs.reduce((a, b) => a + b, 0) / (newBoard(phones, createRng(1)).cards.length / 2) / runs;
      if (phones <= 2) {
        small += 1;
        if (r.cleared) smallCleared += 1;
      }
      expect(r.time).toBeLessThan(MEMORY.duration + MEMORY.turnTime);
    }
    expect(total.sharp).toBeGreaterThan(total.average * 1.3);
    expect(total.average).toBeGreaterThan(total.sleepy * 1.5);
    // Even a sleepy one finds a pair now and then.
    expect(total.sleepy).toBeGreaterThan(0.35);
    expect(found).toBeGreaterThan(0.65);
    expect(smallCleared / small).toBeGreaterThan(0.8);
  });
});
