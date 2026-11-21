import { describe, expect, it } from 'vitest';
import {
  type Board,
  type Drop,
  SEESAW,
  type SeesawEvent,
  boardScore,
  cpuTilt,
  dropHeight,
  leanOf,
  makeDrops,
  newBoard,
  newCpuRider,
  plankTarget,
  seatY,
  seesawDetail,
  seesawScores,
  snapsAt,
  stepBoard,
  tiltFor,
  tipFor,
  tipWindow,
  zoneY,
} from '../src/game/minigames/seesaw';
import { createRng } from '../src/game/rng';

/** Runs a board for `seconds` with fixed phone tilts. */
function ride(b: Board, drops: Drop[], tilts: number[], seconds: number): SeesawEvent[] {
  const out: SeesawEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) out.push(...stepBoard(b, drops, tilts, 1 / 60));
  return out;
}

const dangling = (end: 0 | 1, y: number, treat: Drop['treat'] = 'cookie', at = 0, hang = 1): Drop => ({ at, end, y, treat, hang });

describe('seesaw snacks: the plank', () => {
  it('sits level with no one leaning, and one end goes up as the other goes down', () => {
    expect(seatY(0, 0)).toBeCloseTo(SEESAW.pivot);
    expect(seatY(1, 0)).toBeCloseTo(SEESAW.pivot);
    expect(seatY(1, 1)).toBeLessThan(SEESAW.pivot);
    expect(seatY(0, 1)).toBeGreaterThan(SEESAW.pivot);
    expect(seatY(0, 1) + seatY(1, 1)).toBeCloseTo(2 * SEESAW.pivot);
    // The low end gets down near the ground, not through it.
    expect(seatY(1, 1)).toBeGreaterThan(0);
    expect(seatY(1, 1)).toBeLessThan(0.15);
  });

  it('finds the tip that brings a catch zone to a height', () => {
    for (const end of [0, 1] as const) {
      for (const y of [1.5, 2.0, 2.5]) {
        const tip = tipFor(end, y);
        expect(zoneY(end, tip)).toBeCloseTo(y, 5);
        const [lo, hi] = tipWindow(end, y);
        expect(lo).toBeLessThanOrEqual(tip);
        expect(hi).toBeGreaterThanOrEqual(tip);
      }
    }
    // Far out of reach: no window at all.
    const [lo, hi] = tipWindow(0, 4);
    expect(lo).toBeGreaterThan(hi);
  });

  it('turns phone tilt into a lean, with a little dead zone, and back', () => {
    expect(leanOf(0.05)).toBe(0);
    expect(leanOf(SEESAW.full)).toBeCloseTo(1);
    expect(leanOf(-1)).toBe(-1);
    for (const l of [-1, -0.4, 0.25, 0.8]) expect(leanOf(tiltFor(l))).toBeCloseTo(l, 6);
  });

  it('adds the partners’ leans: the same way tips it, opposite ways level it', () => {
    expect(plankTarget([1, 1])).toBeGreaterThan(1);
    expect(plankTarget([-1, -1])).toBeLessThan(-1);
    expect(plankTarget([1, -1])).toBe(0);
    expect(Math.abs(plankTarget([1, 0]))).toBeLessThan(1);
    // A rider on their own counts double.
    expect(plankTarget([0.5])).toBeCloseTo(plankTarget([0.5, 0.5]));

    const both = newBoard([]);
    ride(both, [], [0.8, 0.8], 1.5);
    expect(both.tip).toBeGreaterThan(0.95);
    const opposite = newBoard([]);
    ride(opposite, [], [0.8, -0.8], 1.5);
    expect(Math.abs(opposite.tip)).toBeLessThan(0.02);
    const alone = newBoard([]);
    ride(alone, [], [0.8, 0], 1.5);
    expect(alone.tip).toBeGreaterThan(0.3);
    expect(alone.tip).toBeLessThan(both.tip);
  });

  it('thumps the ground when both lean hard the same way', () => {
    const b = newBoard([]);
    const events = ride(b, [], [-1, -1], 1.2);
    expect(events.some((e) => e.kind === 'bump' && e.end === 0)).toBe(true);
    expect(b.tip).toBeGreaterThanOrEqual(-1);
  });
});

describe('seesaw snacks: the snack-fruit', () => {
  it('drops snacks over both ends for the whole game, the same every time for a seed', () => {
    const drops = makeDrops(createRng(4));
    expect(makeDrops(createRng(4))).toEqual(drops);
    expect(drops.length).toBeGreaterThan(35);
    expect(drops[0]?.at).toBeCloseTo(SEESAW.firstAt);
    expect(Math.max(...drops.map(snapsAt))).toBeLessThanOrEqual(SEESAW.duration);
    expect(Math.max(...drops.map((d) => d.at))).toBeGreaterThan(SEESAW.duration - 5);
    expect(new Set(drops.map((d) => d.end))).toEqual(new Set([0, 1]));
  });

  it('only hangs snacks where a catch zone can reach, mostly high or low', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const drops = makeDrops(createRng(seed));
      for (const d of drops) {
        const [lo, hi] = tipWindow(d.end, d.y);
        expect(lo).toBeLessThanOrEqual(hi);
      }
      const middle = drops.filter((d) => Math.abs(d.y - (SEESAW.bands[1] ?? 2)) < 0.2).length;
      expect(middle / drops.length).toBeLessThan(0.4);
    }
  });

  it('never dangles more than two over one end at once, and two over the same end at different heights', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const drops = makeDrops(createRng(seed));
      for (const d of drops) {
        const now = drops.filter((e) => e !== d && e.end === d.end && e.at <= d.at && snapsAt(e) > d.at);
        expect(now.length).toBeLessThanOrEqual(1);
        for (const e of now) expect(Math.abs(e.y - d.y)).toBeGreaterThan(0.2);
      }
    }
  });

  it('mixes in about a fifth broccoli', () => {
    let greens = 0;
    let all = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const drops = makeDrops(createRng(seed));
      all += drops.length;
      greens += drops.filter((d) => d.treat === 'broccoli').length;
      const kinds = new Set(drops.map((d) => d.treat));
      expect(kinds.size).toBeGreaterThan(3);
    }
    expect(greens / all).toBeGreaterThan(0.12);
    expect(greens / all).toBeLessThan(0.25);
  });

  it('comes down from the branches and bobs at its height', () => {
    const d = dangling(0, 2, 'cookie', 1);
    expect(dropHeight(d, 0.5)).toBe(SEESAW.top);
    expect(dropHeight(d, 1 + SEESAW.fall / 2)).toBeLessThan(SEESAW.top);
    expect(dropHeight(d, 1 + SEESAW.fall / 2)).toBeGreaterThan(2);
    expect(Math.abs(dropHeight(d, 1 + SEESAW.fall + 1) - 2)).toBeLessThan(0.05);
  });
});

describe('seesaw snacks: catching', () => {
  it('catches a snack that stays in the catch zone for a moment', () => {
    const drops = [dangling(1, zoneY(1, 0))];
    const b = newBoard(drops);
    const events = ride(b, drops, [0, 0], SEESAW.fall + 0.1);
    expect(events.filter((e) => e.kind === 'drop')).toHaveLength(1);
    expect(b.snacks).toBe(0); // still settling in the zone
    const more = ride(b, drops, [0, 0], 0.2);
    expect(more).toContainEqual({ kind: 'catch', drop: 0, end: 1, treat: 'cookie' });
    expect(b.points).toBe(1);
    expect(b.caught).toEqual([0, 1]);
  });

  it('lets snacks out of reach snap off and fall', () => {
    const drops = [dangling(0, zoneY(0, 1) - 0.01)];
    const b = newBoard(drops);
    const events = ride(b, drops, [0, 0], SEESAW.fall + 1.2);
    expect(events.some((e) => e.kind === 'snap')).toBe(true);
    expect(b.states[0]).toBe('snapped');
    expect(b.points).toBe(0);
  });

  it('needs the right end at the right height: tipping brings a high snack within reach', () => {
    const high = zoneY(0, 1) - 0.05;
    const drops = [dangling(0, high, 'doughnut', 0, 2)];
    const level = newBoard(drops);
    ride(level, drops, [0, 0], 2.6);
    expect(level.snacks).toBe(0);
    const tipped = newBoard(drops);
    ride(tipped, drops, [0.8, 0.8], 2.6);
    expect(tipped.snacks).toBe(1);
  });

  it('does not count swinging straight past', () => {
    // Dangling over the left seat, reachable only near level: whoosh from one end to the other.
    const drops = [dangling(0, zoneY(0, 0), 'cookie', 0, 3)];
    const b = newBoard(drops);
    b.tip = -1;
    b.time = SEESAW.fall + 0.05;
    b.vel = 7;
    ride(b, drops, [1, 1], 0.4);
    expect(b.tip).toBeGreaterThan(0.6);
    expect(b.snacks).toBe(0);
  });

  it('takes a point for broccoli, but never below nothing', () => {
    const drops = [dangling(0, zoneY(0, 0), 'broccoli'), dangling(1, zoneY(1, 0), 'pretzel', 1.5), dangling(1, zoneY(1, 0), 'broccoli', 3)];
    const b = newBoard(drops);
    ride(b, drops, [0, 0], 5);
    expect(b.greens).toBe(2);
    expect(b.snacks).toBe(1);
    expect(b.points).toBe(0);
    expect(b.greensBy).toEqual([1, 1]);
  });

  it('ranks by points, then by less broccoli, and gives both partners the score', () => {
    const a = { ...newBoard([]), points: 12, greens: 3 };
    const b = { ...newBoard([]), points: 12, greens: 1 };
    const c = { ...newBoard([]), points: 9 };
    expect(boardScore(b)).toBeGreaterThan(boardScore(a));
    expect(boardScore(a)).toBeGreaterThan(boardScore(c));
    expect(seesawScores([a, c], [[0, 2], [1, 3]], 4)).toEqual([boardScore(a), boardScore(c), boardScore(a), boardScore(c)]);
    const d: Board = { ...newBoard([]), points: 7, snacks: 9, greens: 2, caught: [5, 4] };
    expect(seesawDetail(d, 0)).toBe('7 points · 5 snacks caught by you · 2 broccoli');
    expect(seesawDetail(newBoard([]), 1)).toBe('0 points · 0 snacks caught by you');
  });
});

describe('seesaw snacks: computer players', () => {
  const play = (skills: (number | null)[], seed: number) => {
    const rng = createRng(seed);
    const drops = makeDrops(rng);
    const b = newBoard(drops);
    const riders = skills.map((s, end) => (s === null ? null : newCpuRider(drops, end as 0 | 1, s, rng)));
    const dt = 1 / 60;
    let most = 0;
    while (b.time < SEESAW.duration - 1e-6) {
      const tilts = riders.map((r) => (r ? cpuTilt(r, b, drops, rng, dt) : 0));
      for (const t of tilts) most = Math.max(most, Math.abs(t));
      stepBoard(b, drops, tilts, dt);
    }
    expect(most).toBeLessThanOrEqual(1);
    return { b, snacks: drops.filter((d) => d.treat !== 'broccoli').length };
  };
  const average = (skills: (number | null)[]) => {
    let points = 0;
    let share = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { b, snacks } = play(skills, seed * 17);
      points += b.points;
      share += b.snacks / snacks;
    }
    return { points: points / 20, share: share / 20 };
  };

  it('a sharp pair catches most snacks, an average one plenty, a sleepy one a few', () => {
    const sharp = average([1, 1]);
    const mid = average([0.55, 0.55]);
    const sleepy = average([0, 0]);
    expect(sharp.points).toBeGreaterThan(mid.points);
    expect(mid.points).toBeGreaterThan(sleepy.points + 5);
    expect(sharp.share).toBeGreaterThan(0.75);
    expect(sharp.share).toBeLessThan(0.97);
    expect(mid.share).toBeGreaterThan(0.45);
    expect(mid.share).toBeLessThan(0.85);
    expect(sleepy.share).toBeGreaterThan(0.1);
  });

  it('beats doing nothing, and still helps a partner who just sits there', () => {
    const idle = average([null, null]);
    const helped = average([0.55, null]);
    expect(helped.points).toBeGreaterThan(idle.points + 4);
    expect(average([0.55, 0.55]).points).toBeGreaterThan(helped.points);
  });
});
