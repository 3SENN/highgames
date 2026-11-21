import { describe, expect, it } from 'vitest';
import { TUG, type Tug, cpuHear, cpuPump, fatigue, newPuller, newTug, pumpTug, stepTug, tugScores } from '../src/game/minigames/blankettug';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** Steps the tug for `seconds`, calling `each` every step first. */
function play(t: Tug, seconds: number, each: (time: number) => void = () => {}): void {
  for (let i = 0; i < seconds * 60 && t.winner === null; i++) {
    each(t.time);
    stepTug(t, DT);
  }
}

function run(seed: number, solo: number, team: number): Tug {
  const rng = createRng(seed);
  const t = newTug(4, 0, [1, 2, 3]);
  const ps = [0, 1, 2, 3].map((s) => newPuller(s === 0 ? solo : team, rng, s > 0));
  play(t, TUG.duration + 1, () => {
    for (let s = 0; s < 4; s++) {
      const power = cpuPump(t, ps[s] as ReturnType<typeof newPuller>, rng);
      if (power === null) continue;
      pumpTug(t, s, power);
      if (s > 0) for (let m = 1; m < 4; m++) if (m !== s) cpuHear(t, ps[m] as ReturnType<typeof newPuller>, t.time, rng);
    }
  });
  return t;
}

describe('blanket tug', () => {
  it('pulls the blanket toward whoever pumps, the solo player three times as hard', () => {
    const a = newTug(4, 0, [1, 2, 3]);
    pumpTug(a, 1, 1);
    play(a, 1);
    expect(a.pos).toBeGreaterThan(0);
    const b = newTug(4, 0, [1, 2, 3]);
    pumpTug(b, 0, 1);
    play(b, 1);
    expect(b.pos).toBeCloseTo(-3 * a.pos, 3);
  });

  it('gives nothing extra for pumping faster than about four times a second', () => {
    expect(fatigue(0.25)).toBe(1);
    expect(fatigue(0.5)).toBe(1);
    expect(fatigue(0.125)).toBeCloseTo(0.5);
    const pullAt = (rate: number) => {
      const t = newTug(4, 0, [1, 2, 3]);
      let next = 0;
      let sum = 0;
      play(t, 5, (time) => {
        if (time >= next) {
          sum += pumpTug(t, 1, 1).pull;
          next += 1 / rate;
        }
      });
      return sum;
    };
    expect(pullAt(4)).toBeGreaterThan(pullAt(2) * 1.8);
    expect(pullAt(8)).toBeLessThan(pullAt(4) * 1.08);
  });

  it('gives the three a small bonus for pumping together', () => {
    const t = newTug(4, 0, [1, 2, 3]);
    play(t, 1);
    const alone = pumpTug(t, 1, 1);
    expect(alone.sync).toBe(0);
    play(t, 0.1);
    const together = pumpTug(t, 2, 1);
    expect(together.sync).toBe(1);
    expect(together.pull).toBeCloseTo(alone.pull * (1 + TUG.syncBonus));
    play(t, 0.5);
    expect(pumpTug(t, 3, 1).sync).toBe(0);
    // The solo player never gets it.
    expect(pumpTug(t, 0, 1).sync).toBe(0);
  });

  it('backdates a phone pump, but never before its last one', () => {
    const t = newTug(4, 0, [1, 2, 3]);
    play(t, 1);
    pumpTug(t, 1, 1);
    const late = pumpTug(t, 1, 1, t.time - 0.5);
    expect(late.pull).toBe(0);
  });

  it('ends when the middle is dragged 2 m past the line', () => {
    const t = newTug(4, 2, [0, 1, 3]);
    let next = 0;
    play(t, TUG.duration, (time) => {
      if (time >= next) {
        pumpTug(t, 2, 1);
        next += 0.25;
      }
    });
    expect(t.winner).toBe('solo');
    expect(t.pos).toBe(-TUG.win);
    expect(t.time).toBeLessThan(TUG.duration);
    expect(tugScores(t, 4)).toEqual([0, 0, 1, 0]);
  });

  it('gives the win to the side ahead when time runs out, and calls a dead heat a draw', () => {
    const t = newTug(4, 0, [1, 2, 3]);
    pumpTug(t, 3, 0.6);
    play(t, TUG.duration + 1);
    expect(t.winner).toBe('team');
    expect(tugScores(t, 4)).toEqual([0, 1, 1, 1]);
    const d = newTug(4, 0, [1, 2, 3]);
    play(d, TUG.duration + 1);
    expect(d.winner).toBe('draw');
    expect(tugScores(d, 4)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('plays out with computer players, and sharpness matters on both sides', () => {
    let sharpSolo = 0;
    let sleepySolo = 0;
    let even = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = run(seed, 0.9, 0.4);
      const b = run(seed, 0.4, 0.9);
      const c = run(seed, 0.575, 0.575);
      expect(a.winner && b.winner && c.winner).toBeTruthy();
      if (a.winner === 'solo') sharpSolo++;
      if (b.winner === 'solo') sleepySolo++;
      if (c.winner === 'solo') even++;
    }
    expect(sharpSolo).toBeGreaterThan(34);
    expect(sleepySolo).toBeLessThan(6);
    expect(even).toBeGreaterThan(8);
    expect(even).toBeLessThan(32);
  });
});
