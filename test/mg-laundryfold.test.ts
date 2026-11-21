import { describe, expect, it } from 'vitest';
import {
  FOLD,
  type FoldDir,
  type Sheet,
  cpuFollow,
  cpuLead,
  cpuMisreads,
  expireSheet,
  foldScore,
  foldScores,
  isReady,
  newSheet,
  nextFold,
  otherDir,
  sheetPlan,
  swipeSheet,
} from '../src/game/minigames/laundryfold';
import { createRng } from '../src/game/rng';

/** Both partners pull the arrow's way 0.1 s apart, starting at `t`. Returns the second result. */
function together(s: Sheet, t: number, rng = createRng(1)) {
  const dir = nextFold(s);
  expect(swipeSheet(s, 0, dir, t, t, rng)).toBe('wait');
  return swipeSheet(s, 1, dir, t + 0.1, t + 0.1, rng);
}

describe('laundry fold', () => {
  it('plans two folds across and two lengthways for every sheet', () => {
    const rng = createRng(5);
    for (let i = 0; i < 50; i++) {
      const plan = sheetPlan(rng);
      expect(plan).toHaveLength(FOLD.perSheet);
      expect(plan.filter((d) => d === 'left' || d === 'right')).toHaveLength(2);
      expect(plan.filter((d) => d === 'up' || d === 'down')).toHaveLength(2);
    }
  });

  it('folds when both partners swipe the arrow’s way together', () => {
    const rng = createRng(2);
    const s = newSheet(rng);
    const dir = nextFold(s);
    expect(swipeSheet(s, 1, dir, 1, 1, rng)).toBe('wait');
    expect(s.folds).toBe(0);
    expect(swipeSheet(s, 0, dir, 1 + FOLD.window - 0.01, 1.6, rng)).toBe('fold');
    expect(s.folds).toBe(1);
    expect(s.streak).toBe(1);
    expect(s.pending).toBeNull();
  });

  it('ignores swipes while the fold settles, then shows the next arrow', () => {
    const rng = createRng(3);
    const s = newSheet(rng);
    expect(together(s, 1, rng)).toBe('fold');
    expect(isReady(s, 1.2)).toBe(false);
    expect(swipeSheet(s, 0, nextFold(s), 1.2, 1.2, rng)).toBe('ignored');
    expect(isReady(s, 1.1 + FOLD.settle)).toBe(true);
    expect(together(s, 2, rng)).toBe('fold');
    expect(s.folds).toBe(2);
  });

  it('makes a neat square every four folds and starts a fresh sheet', () => {
    const rng = createRng(4);
    const s = newSheet(rng);
    const results: string[] = [];
    for (let i = 0; i < 4; i++) results.push(together(s, 1 + i * 2, rng));
    expect(results).toEqual(['fold', 'fold', 'fold', 'square']);
    expect(s.squares).toBe(1);
    expect(s.onSheet).toBe(0);
    expect(s.plan).toHaveLength(FOLD.perSheet);
    // The square goes on the pile before the next arrow.
    expect(s.readyAt).toBeCloseTo(7.1 + FOLD.settle + FOLD.square);
  });

  it('tangles on a wrong-way swipe and stays balled up for a while', () => {
    const rng = createRng(6);
    const s = newSheet(rng);
    expect(swipeSheet(s, 0, otherDir(rng, nextFold(s)), 2, 2, rng)).toBe('wrong');
    expect(s.tangles).toBe(1);
    expect(isReady(s, 2 + FOLD.tangle - 0.01)).toBe(false);
    expect(swipeSheet(s, 0, nextFold(s), 2.5, 2.5, rng)).toBe('ignored');
    expect(isReady(s, 2 + FOLD.tangle)).toBe(true);
    expect(together(s, 3.5, rng)).toBe('fold');
  });

  it('tangles when the partners pull different ways', () => {
    const rng = createRng(7);
    const s = newSheet(rng);
    const dir = nextFold(s);
    swipeSheet(s, 0, dir, 1, 1, rng);
    expect(swipeSheet(s, 1, otherDir(rng, dir), 1.1, 1.1, rng)).toBe('mismatch');
    expect(s.tangles).toBe(1);
    expect(s.folds).toBe(0);
  });

  it('tangles when the second pull comes too late', () => {
    const rng = createRng(8);
    const s = newSheet(rng);
    const dir: FoldDir = nextFold(s);
    swipeSheet(s, 0, dir, 1, 1, rng);
    // Still waiting for the partner, with a little grace for a swipe on its way.
    expect(expireSheet(s, 1 + FOLD.window + 0.1, 0.15)).toBe(false);
    expect(expireSheet(s, 1 + FOLD.window + 0.16, 0.15)).toBe(true);
    expect(s.tangles).toBe(1);
    // A late swipe judged after the fact tangles too.
    const t = newSheet(createRng(8));
    swipeSheet(t, 0, nextFold(t), 1, 1, rng);
    expect(swipeSheet(t, 1, nextFold(t), 1 + FOLD.window + 0.05, 1.7, rng)).toBe('late');
  });

  it('lets a keen partner pull twice without tangling: the latest pull counts', () => {
    const rng = createRng(9);
    const s = newSheet(rng);
    const dir = nextFold(s);
    swipeSheet(s, 0, dir, 1, 1, rng);
    expect(swipeSheet(s, 0, dir, 1.5, 1.5, rng)).toBe('wait');
    expect(swipeSheet(s, 1, dir, 1.9, 1.9, rng)).toBe('fold');
  });

  it('ignores swipes from before the arrow showed', () => {
    const rng = createRng(10);
    const s = newSheet(rng);
    s.readyAt = 2;
    expect(swipeSheet(s, 0, nextFold(s), 1.95, 2.05, rng)).toBe('ignored');
  });

  it('lets a team of one pull both corners with two quick swipes', () => {
    const rng = createRng(11);
    const s = newSheet(rng);
    const dir = nextFold(s);
    expect(swipeSheet(s, 0, dir, 1, 1, rng, true)).toBe('wait');
    expect(swipeSheet(s, 0, dir, 1.2, 1.2, rng, true)).toBe('fold');
  });

  it('gives both partners the same score, more folds more, and breaks ties by fewer tangles', () => {
    const a = { ...newSheet(createRng(1)), folds: 12, tangles: 3 };
    const b = { ...newSheet(createRng(1)), folds: 12, tangles: 1 };
    const c = { ...newSheet(createRng(1)), folds: 9 };
    const s = foldScores([a, c], [[0, 2], [1, 3]], 4);
    expect(s[0]).toBe(s[2]);
    expect(s[1]).toBe(s[3]);
    expect(s[0]).toBeGreaterThan(s[1] as number);
    expect(foldScore(b)).toBeGreaterThan(foldScore(a));
  });
});

describe('laundry fold computer players', () => {
  /** A whole game by a computer pair, run the way the TV runs it. */
  function play(skills: [number, number], seed: number): Sheet {
    const rng = createRng(seed);
    const s = newSheet(rng);
    const dt = 1 / 60;
    let key = -1;
    let plans: ({ at: number; dir: FoldDir } | null)[] = [null, null];
    let followed = [false, false];
    for (let t = 0; t < FOLD.duration; t += dt) {
      if (isReady(s, t)) {
        const k = s.folds * 1000 + s.tangles;
        if (k !== key) {
          key = k;
          plans = skills.map((sk) => ({ at: t + cpuLead(rng, sk), dir: cpuMisreads(rng, sk) ? otherDir(rng, nextFold(s)) : nextFold(s) }));
          followed = [false, false];
        }
        for (const m of [0, 1]) {
          const p = s.pending;
          const plan = plans[m];
          if (p && p.member !== m && plan && !followed[m]) {
            followed[m] = true;
            plan.at = Math.min(plan.at, p.at + cpuFollow(rng, skills[m] as number));
          }
        }
        for (const m of [0, 1]) {
          const plan = plans[m];
          if (plan && t >= plan.at) {
            swipeSheet(s, m, plan.dir, plan.at, t, rng);
            plans[m] = null;
          }
        }
      }
      expireSheet(s, t);
    }
    return s;
  }

  const average = (skill: number) => {
    let folds = 0;
    for (let seed = 1; seed <= 30; seed++) folds += play([skill, skill], seed).folds;
    return folds / 30;
  };

  it('a sharp pair folds more than an average one, and an average one more than a sleepy one', () => {
    const sharp = average(1);
    const mid = average(0.55);
    const sleepy = average(0);
    expect(sharp).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(sleepy);
    // Strong but beatable: a quick human pair folds about one sheet corner a second.
    expect(sharp).toBeLessThan(27);
    expect(sharp).toBeGreaterThan(18);
    expect(mid).toBeGreaterThan(12);
    expect(mid).toBeLessThan(21);
    expect(sleepy).toBeGreaterThan(7);
  });

  it('sleepy pairs tangle more than sharp ones', () => {
    let sharp = 0;
    let sleepy = 0;
    for (let seed = 1; seed <= 30; seed++) {
      sharp += play([1, 1], seed).tangles;
      sleepy += play([0, 0], seed).tangles;
    }
    expect(sleepy).toBeGreaterThan(sharp);
  });

  it('follows a partner’s pull quickly enough when sharp', () => {
    const rng = createRng(12);
    const late = Array.from({ length: 500 }, () => cpuFollow(rng, 1)).filter((d) => d > FOLD.window).length;
    expect(late).toBe(0);
    const sleepyLate = Array.from({ length: 500 }, () => cpuFollow(rng, 0)).filter((d) => d > FOLD.window).length;
    expect(sleepyLate).toBeGreaterThan(0);
  });
});
