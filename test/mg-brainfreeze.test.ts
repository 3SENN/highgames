import { describe, expect, it } from 'vitest';
import { FREEZE, type Slurper, cpuHolds, cpuPlan, freezeScores, newSlurper, stepSlurper } from '../src/game/minigames/brainfreeze';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** Plays a fixed strategy: hold up to `hi`, let go until `lo`. */
function ride(hi: number, lo: number): Slurper {
  const s = newSlurper();
  let holding = false;
  for (let t = 0; t < FREEZE.duration && s.finishedAt === null; t += DT) {
    holding = cpuHolds(s, holding, { hi, lo });
    stepSlurper(s, holding, DT, t);
  }
  return s;
}

describe('brain freeze', () => {
  it('slurps and chills while holding, thaws while letting go', () => {
    const s = newSlurper();
    stepSlurper(s, true, 1, 1);
    expect(s.level).toBeCloseTo(1 - FREEZE.slurp);
    expect(s.freeze).toBeGreaterThan(0);
    const cold = s.freeze;
    stepSlurper(s, false, 0.5, 1.5);
    expect(s.freeze).toBeLessThan(cold);
    expect(s.level).toBeCloseTo(1 - FREEZE.slurp);
    for (let i = 0; i < 100; i++) stepSlurper(s, false, 0.1, 2 + i);
    expect(s.freeze).toBe(0);
  });

  it('chills faster the colder you already are', () => {
    const warm = { ...newSlurper(), freeze: 0.1 };
    const cold = { ...newSlurper(), freeze: 0.8 };
    stepSlurper(warm, true, 0.1, 1);
    stepSlurper(cold, true, 0.1, 1);
    expect(cold.freeze - 0.8).toBeGreaterThan(warm.freeze - 0.1);
  });

  it('freezes you solid at full freeze, ignores slurping for a while, then lets you go a bit chilly', () => {
    const s = { ...newSlurper(), freeze: 0.99 };
    let event = null;
    for (let i = 0; i < 10 && event === null; i++) event = stepSlurper(s, true, 0.05, 1);
    expect(event).toBe('froze');
    expect(s.frozen).toBe(FREEZE.frozenFor);
    expect(s.freezes).toBe(1);
    const level = s.level;
    let thawed = false;
    for (let t = 0; t < FREEZE.frozenFor + 0.1 && !thawed; t += 0.05) thawed = stepSlurper(s, true, 0.05, 2 + t) === 'thawed';
    expect(thawed).toBe(true);
    expect(s.level).toBe(level);
    expect(s.freeze).toBe(FREEZE.afterFrozen);
  });

  it('rewards riding near the edge: it empties the cup in time, sips too timid or too greedy do not', () => {
    const edge = ride(0.95, 0.75);
    expect(edge.finishedAt).not.toBeNull();
    expect(edge.finishedAt as number).toBeLessThan(FREEZE.duration - 5);
    expect(edge.freezes).toBe(0);
    expect(ride(0.3, 0).finishedAt).toBeNull();
    const greedy = ride(2, 1);
    expect(greedy.finishedAt).toBeNull();
    expect(greedy.freezes).toBeGreaterThan(3);
  });

  it('ranks empty cups by time, ahead of the rest by how much they drank', () => {
    const fast = { ...newSlurper(), level: 0, finishedAt: 18 };
    const slow = { ...newSlurper(), level: 0, finishedAt: 22 };
    const most = { ...newSlurper(), level: 0.1 };
    const least = { ...newSlurper(), level: 0.6 };
    const [a, b, c, d] = freezeScores([fast, slow, most, least]) as [number, number, number, number];
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
  });

  it('has sharp computer players finish without freezing, and faster than sleepy ones', () => {
    const play = (skill: number, seed: number) => {
      const rng = createRng(seed);
      const s = newSlurper();
      let holding = false;
      let plan = cpuPlan(rng, skill);
      for (let t = 0; t < FREEZE.duration && s.finishedAt === null; t += DT) {
        const next = cpuHolds(s, holding, plan);
        if (next && !holding) plan = cpuPlan(rng, skill);
        holding = next;
        stepSlurper(s, holding, DT, t);
      }
      return s;
    };
    let sleepy = 0;
    let sharp = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const keen = play(1, seed);
      expect(keen.finishedAt).not.toBeNull();
      expect(keen.freezes).toBe(0);
      sharp += keen.finishedAt as number;
      sleepy += play(0, seed).finishedAt ?? FREEZE.duration + 5;
    }
    expect(sleepy).toBeGreaterThan(sharp * 1.15);
  });

  it('never has a computer player hold while frozen or done', () => {
    const plan = { hi: 0.9, lo: 0.5 };
    expect(cpuHolds({ ...newSlurper(), frozen: 1 }, true, plan)).toBe(false);
    expect(cpuHolds({ ...newSlurper(), finishedAt: 10, level: 0 }, true, plan)).toBe(false);
  });
});
