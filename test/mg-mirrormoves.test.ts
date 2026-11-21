import { describe, expect, it } from 'vitest';
import {
  MIRROR,
  POSES,
  copyPoints,
  copyPose,
  cpuCopyDelay,
  cpuLeadGap,
  cpuSlips,
  isCopied,
  leadPose,
  leaderOf,
  makeRun,
  mirrorScores,
  newMirror,
  otherPose,
  rightCopies,
  roundTime,
} from '../src/game/minigames/mirrormoves';
import { createRng } from '../src/game/rng';

describe('mirror mirror', () => {
  it('makes runs of the asked length with no pose twice in a row', () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const len = 3 + (i % 3);
      const run = makeRun(rng, len);
      expect(run).toHaveLength(len);
      for (let k = 0; k < len; k++) {
        expect(run[k]).toBeGreaterThanOrEqual(0);
        expect(run[k]).toBeLessThan(POSES.length);
        if (k > 0) expect(run[k]).not.toBe(run[k - 1]);
      }
    }
  });

  it('plays four rounds of three to five poses that fit the time', () => {
    expect(MIRROR.lengths).toHaveLength(MIRROR.rounds);
    for (const len of MIRROR.lengths) {
      expect(len).toBeGreaterThanOrEqual(3);
      expect(len).toBeLessThanOrEqual(5);
    }
    const longest = MIRROR.lengths.reduce((a, len) => a + roundTime(len), 0) + MIRROR.gap * (MIRROR.rounds - 1);
    expect(longest).toBeLessThanOrEqual(45);
  });

  it('shows only the right next pose, one after the other', () => {
    const m = newMirror([0, 2, 1]);
    expect(leadPose(m, 2, 1)).toBe('wrong');
    expect(m.shownAt).toHaveLength(0);
    expect(leadPose(m, 0, 1)).toBe('shown');
    // Pressed quickly: it waits for the first pose to finish.
    expect(leadPose(m, 2, 1.1)).toBe('shown');
    expect(m.shownAt[1]).toBeCloseTo(1 + MIRROR.pose);
    // Pressed slowly: it shows straight away.
    expect(leadPose(m, 1, 5)).toBe('shown');
    expect(m.shownAt[2]).toBe(5);
    expect(leadPose(m, 1, 6)).toBe('done');
  });

  it('scores right copies, quick ones more, and nothing for wrong ones', () => {
    const m = newMirror([3, 1, 0]);
    leadPose(m, 3, 0);
    leadPose(m, 1, 0.1);
    leadPose(m, 0, 0.2);
    const quick = copyPose(m, 3, 0.5);
    expect(quick).toEqual({ result: 'right', points: MIRROR.copy + MIRROR.quick });
    expect(copyPose(m, 2, 2).result).toBe('wrong');
    const slow = copyPose(m, 0, m.shownAt[2] as number + 4);
    expect(slow).toEqual({ result: 'right', points: MIRROR.copy });
    expect(m.points).toBe(2 * MIRROR.copy + MIRROR.quick);
    expect(rightCopies(m)).toBe(2);
    expect(isCopied(m)).toBe(true);
    expect(copyPose(m, 0, 9).result).toBe('done');
  });

  it('gives fewer points the longer a copy takes', () => {
    expect(copyPoints(0.3)).toBe(MIRROR.copy + MIRROR.quick);
    expect(copyPoints(1.5)).toBeLessThan(copyPoints(1));
    expect(copyPoints(1.5)).toBeGreaterThan(MIRROR.copy);
    expect(copyPoints(10)).toBe(MIRROR.copy);
  });

  it('does not count a copy before the pose has shown', () => {
    const m = newMirror([0, 1, 2]);
    expect(copyPose(m, 0, 0.5).result).toBe('early');
    leadPose(m, 0, 1);
    leadPose(m, 1, 1.1);
    expect(copyPose(m, 0, 0.9).result).toBe('early');
    expect(copyPose(m, 0, 1.2).result).toBe('right');
    // The second pose waits its turn on the TV.
    expect(copyPose(m, 1, 1.5).result).toBe('early');
    expect(copyPose(m, 1, 1 + MIRROR.pose + 0.3).result).toBe('right');
    expect(m.copies).toEqual([true, true]);
  });

  it('swaps the leader every round, and a team of one always copies', () => {
    expect([0, 1, 2, 3].map((r) => leaderOf(r, 2))).toEqual([0, 1, 0, 1]);
    expect(leaderOf(2, 1)).toBeNull();
  });

  it('gives both partners their team’s points', () => {
    const s = mirrorScores([120, 95], [[0, 3], [1, 2]], 4);
    expect(s).toEqual([120, 95, 95, 120]);
  });
});

describe('mirror mirror computer players', () => {
  /** A whole game by a computer pair, run the way the TV runs it. Returns the team's points. */
  function play(skill: number, seed: number): { points: number; right: number; time: number } {
    const rng = createRng(seed);
    let points = 0;
    let right = 0;
    let time = 0;
    for (let r = 0; r < MIRROR.rounds; r++) {
      const len = MIRROR.lengths[r] as number;
      const m = newMirror(makeRun(rng, len));
      let leadAt = cpuLeadGap(rng, skill, true);
      let copyAt: number | null = null;
      let last = -1;
      const dt = 1 / 60;
      let t = 0;
      for (; t < roundTime(len) && !isCopied(m); t += dt) {
        if (t >= leadAt && m.shownAt.length < len) {
          leadPose(m, m.run[m.shownAt.length] as number, leadAt);
          leadAt = t + cpuLeadGap(rng, skill, false);
        }
        const k = m.copies.length;
        const shown = m.shownAt[k];
        if (shown !== undefined && copyAt === null) copyAt = Math.max(shown + cpuCopyDelay(rng, skill), last + 0.25);
        if (copyAt !== null && t >= copyAt) {
          const want = m.run[k] as number;
          copyPose(m, cpuSlips(rng, skill, k) ? otherPose(rng, want) : want, copyAt);
          last = copyAt;
          copyAt = null;
        }
      }
      time += t;
      points += m.points;
      right += rightCopies(m);
    }
    return { points, right, time };
  }

  const average = (skill: number) => {
    let points = 0;
    let right = 0;
    let time = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = play(skill, seed);
      points += g.points;
      right += g.right;
      time += g.time;
    }
    return { points: points / 40, right: right / 40, time: time / 40 };
  };

  it('sharp pairs score more than average ones, and average ones more than sleepy ones', () => {
    const sharp = average(1);
    const mid = average(0.55);
    const sleepy = average(0);
    expect(sharp.points).toBeGreaterThan(mid.points);
    expect(mid.points).toBeGreaterThan(sleepy.points);
    // Nobody is perfect, and nobody hopeless: 16 poses in a game.
    expect(sharp.right).toBeLessThan(16);
    expect(sharp.right).toBeGreaterThan(14);
    expect(mid.right).toBeGreaterThan(12);
    expect(sleepy.right).toBeGreaterThan(9);
  });

  it('finishes rounds early when both play well, so a game stays short', () => {
    const sharp = average(1);
    const sleepy = average(0);
    expect(sharp.time).toBeLessThan(sleepy.time);
    expect(sleepy.time + MIRROR.gap * (MIRROR.rounds - 1)).toBeLessThan(42);
    expect(sharp.time + MIRROR.gap * (MIRROR.rounds - 1)).toBeGreaterThan(15);
  });

  it('copies a wrong pose more often when sleepy and later in a run', () => {
    const rng = createRng(4);
    const slips = (skill: number, step: number) => Array.from({ length: 4000 }, () => cpuSlips(rng, skill, step)).filter(Boolean).length;
    expect(slips(0, 0)).toBeGreaterThan(slips(1, 0));
    expect(slips(0.5, 4)).toBeGreaterThan(slips(0.5, 0));
    const pose = otherPose(rng, 2);
    expect(pose).not.toBe(2);
  });
});
