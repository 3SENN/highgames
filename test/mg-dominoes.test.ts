import { describe, expect, it } from 'vitest';
import {
  DOMINO,
  DOMINO_KINDS,
  activeSection,
  buildTime,
  cpuDominoPlan,
  cpuDominoSlider,
  dominoCoop,
  gapOf,
  idealValue,
  judge,
  layoutSection,
  lockRound,
  newDominoGame,
  sectionResult,
  sectionsPerRound,
  seatQueue,
  seatTally,
  setSection,
  slide,
  toppled,
  valueOf,
} from '../src/game/minigames/dominoes';
import { createRng } from '../src/game/rng';

describe('domino run', () => {
  it('plays three rounds of tall, short and chunky dominoes, sections shared out evenly', () => {
    for (let players = 1; players <= 4; players++) {
      const g = newDominoGame(createRng(players * 3), players);
      expect(g.sections).toHaveLength(DOMINO.rounds);
      expect([...g.kinds].sort()).toEqual(['chunky', 'short', 'tall']);
      const per = sectionsPerRound(players);
      g.sections.forEach((round, r) => {
        expect(round).toHaveLength(per);
        round.forEach((s, i) => {
          expect(s.round).toBe(r);
          expect(s.index).toBe(i);
          expect(s.seat).toBe(i % players);
          expect(s.kind).toBe(g.kinds[r]);
          const base = DOMINO_KINDS[s.kind].h;
          expect(s.h).toBeGreaterThanOrEqual(base * (1 - DOMINO.jitter) - 0.01);
          expect(s.h).toBeLessThanOrEqual(base * (1 + DOMINO.jitter) + 0.01);
          // The slider never starts on the right spot.
          expect(Math.abs(s.start - idealValue(s.h))).toBeGreaterThanOrEqual(DOMINO.startAway - 1e-9);
          expect(s.value).toBe(s.start);
        });
        const counts = Array.from({ length: players }, (_, seat) => seatQueue(g, r, seat).length);
        expect(new Set(counts).size).toBe(1);
      });
    }
    expect(sectionsPerRound(1)).toBe(2);
    expect(sectionsPerRound(2)).toBe(4);
    expect(buildTime(1)).toBeGreaterThan(buildTime(4));
  });

  it('topples cleanly at about two-thirds of the height, jams when too close, stops when too far', () => {
    for (const h of [0.5, 0.75, 1.2]) {
      expect(judge(0.7 * h, h)).toBe('ok');
      expect(judge(0.6 * h, h)).toBe('ok');
      expect(judge(0.8 * h, h)).toBe('ok');
      expect(judge(0.4 * h, h)).toBe('close');
      expect(judge(0.95 * h, h)).toBe('far');
      expect(gapOf(idealValue(h))).toBeCloseTo(0.7 * h);
    }
    expect(valueOf(gapOf(0.37))).toBeCloseTo(0.37);
    // The right spot is somewhere different every round, and always on the slider.
    const ideals = (Object.keys(DOMINO_KINDS) as (keyof typeof DOMINO_KINDS)[]).map((k) => idealValue(DOMINO_KINDS[k].h));
    for (const v of ideals) {
      expect(v).toBeGreaterThan(0.15);
      expect(v).toBeLessThan(0.9);
    }
    expect(Math.max(...ideals) - Math.min(...ideals)).toBeGreaterThan(0.3);
  });

  it('fits more dominoes in a section the closer they stand', () => {
    const s = { t: DOMINO_KINDS.short.t };
    let prev = Infinity;
    for (let v = 0; v <= 1; v += 0.1) {
      const { count, pitch } = layoutSection(s, v);
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(DOMINO.maxCount);
      expect(count).toBeLessThanOrEqual(prev);
      if (count > 2) expect((count - 1) * pitch + s.t).toBeLessThanOrEqual(DOMINO.length + 1e-9);
      prev = count;
    }
    expect(toppled('ok', 9)).toBe(9);
    expect(toppled('close', 9)).toBe(5);
    expect(toppled('far', 9)).toBe(1);
  });

  it('builds each seat its sections in turn and locks them on Set or when time is up', () => {
    const g = newDominoGame(createRng(5), 2);
    const [a, b] = seatQueue(g, 0, 0);
    expect(activeSection(g, 0, 0)).toBe(a);
    slide(a!, 0.3);
    expect(a!.value).toBe(0.3);
    setSection(a!, idealValue(a!.h));
    expect(a!.set).toBe(true);
    slide(a!, 0.99);
    expect(a!.value).toBeCloseTo(idealValue(a!.h));
    expect(activeSection(g, 0, 0)).toBe(b);
    lockRound(g, 0);
    expect(activeSection(g, 0, 0)).toBeNull();
    expect(activeSection(g, 0, 1)).toBeNull();
    expect(sectionResult(a!)).toBe('ok');
  });

  it('scores the clean sections over the whole run', () => {
    const g = newDominoGame(createRng(7), 4);
    for (const round of g.sections) for (const s of round) setSection(s, s.seat === 0 ? idealValue(s.h) : 0);
    expect(dominoCoop(g)).toBeCloseTo(0.25);
    expect(seatTally(g, 0)).toEqual({ ok: 3, close: 0, far: 0, total: 3 });
    expect(seatTally(g, 1).close).toBe(3);
    for (const round of g.sections) for (const s of round) s.value = idealValue(s.h);
    expect(dominoCoop(g)).toBe(1);
    expect(dominoCoop(g, 1)).toBe(1);
  });

  it('slides a computer player over to its pick and presses Set', () => {
    const g = newDominoGame(createRng(9), 1);
    const s = g.sections[0]![0]!;
    const plan = cpuDominoPlan(s, 0.6, createRng(2), 10);
    expect(plan.begin).toBeGreaterThan(10);
    expect(plan.at).toBeGreaterThan(plan.begin);
    expect(plan.at).toBeLessThan(10 + buildTime(4));
    expect(cpuDominoSlider(plan, 10).value).toBeCloseTo(s.start);
    expect(cpuDominoSlider(plan, 10).done).toBe(false);
    expect(cpuDominoSlider(plan, plan.at)).toEqual({ value: plan.pick, done: true });
  });

  it('lets sharp computer crews build a clean run and average ones most of it', () => {
    const avg = (players: number, skill: number) => {
      let sum = 0;
      const games = 150;
      for (let seed = 1; seed <= games; seed++) {
        const rng = createRng(seed * 13 + players);
        const g = newDominoGame(rng, players);
        for (const round of g.sections) for (const s of round) setSection(s, cpuDominoSlider(cpuDominoPlan(s, skill, rng, 0), 99).value);
        sum += dominoCoop(g);
      }
      return sum / games;
    };
    for (let players = 1; players <= 4; players++) {
      const mid = avg(players, 0.5);
      expect(mid).toBeGreaterThan(0.66);
      expect(mid).toBeLessThan(0.84);
      expect(avg(players, 1)).toBeGreaterThan(0.95);
      expect(avg(players, 0.1)).toBeLessThan(mid);
    }
  });
});
