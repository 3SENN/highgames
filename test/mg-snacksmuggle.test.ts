import { describe, expect, it } from 'vitest';
import {
  SMUGGLE,
  canTurn,
  cpuHold,
  cpuTap,
  isOver,
  newKeeperBrain,
  newSmuggle,
  newSneakBrain,
  smuggleScores,
  stepSmuggle,
  turnRound,
} from '../src/game/minigames/snacksmuggle';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;
const holds = (...seats: number[]) => [0, 1, 2, 3].map((s) => seats.includes(s));

function run(seed: number, keeperSkill: number, sneakerSkill: number) {
  const rng = createRng(seed);
  const s = newSmuggle(0, [1, 2, 3]);
  const keeper = newKeeperBrain(keeperSkill);
  const brains = [1, 2, 3].map(() => newSneakBrain(sneakerSkill));
  let steps = 0;
  while (!isOver(s) && steps++ < 10_000) {
    if (cpuTap(s, keeper, rng, DT)) turnRound(s);
    stepSmuggle(s, [false, ...brains.map((b) => cpuHold(s, b, rng))], DT);
  }
  return s;
}

describe('snack smuggle', () => {
  it('creeps forward only while holding, and the first to the fridge wins it for the three', () => {
    const s = newSmuggle(2, [0, 1, 3]);
    for (let i = 0; i < 60; i++) stepSmuggle(s, holds(1), DT);
    const [a, b] = s.sneakers;
    expect(a?.pos).toBe(0);
    expect(b?.pos).toBeCloseTo(1 / SMUGGLE.travel, 2);
    let won: number | null = null;
    for (let i = 0; i < SMUGGLE.travel * 60 && won === null; i++) won = stepSmuggle(s, holds(1), DT).won;
    expect(won).toBe(1);
    expect(isOver(s)).toBe(true);
    expect(smuggleScores(s, 4)).toEqual([1, 1, 0, 1]);
  });

  it('turns round only after the cooldown, creaks for 0.4 s, looks, then turns back', () => {
    const s = newSmuggle(0, [1, 2, 3]);
    expect(turnRound(s)).toBe(false); // a moment to settle at the start
    for (let i = 0; i < 60; i++) stepSmuggle(s, holds(), DT);
    expect(turnRound(s)).toBe(true);
    expect(s.phase).toBe('turn');
    expect(turnRound(s)).toBe(false);
    let looked = 0;
    for (let i = 0; i < 60 && !looked; i++) if (stepSmuggle(s, holds(), DT).looked) looked = s.time - s.turnAt;
    expect(looked).toBeCloseTo(SMUGGLE.turn, 1);
    for (let i = 0; i < (SMUGGLE.look + SMUGGLE.turnBack) * 60 + 2; i++) stepSmuggle(s, holds(), DT);
    expect(s.phase).toBe('away');
    expect(canTurn(s)).toBe(false);
    for (let i = 0; i < SMUGGLE.cooldown * 60 + 2; i++) stepSmuggle(s, holds(), DT);
    expect(canTurn(s)).toBe(true);
  });

  it('sends anyone still moving during the look back to the doorway; letting go in the creak is safe', () => {
    const s = newSmuggle(0, [1, 2, 3]);
    for (let i = 0; i < 120; i++) stepSmuggle(s, holds(1, 2), DT);
    const [one, two] = s.sneakers;
    const before = one?.pos ?? 0;
    expect(before).toBeGreaterThan(0.05);
    turnRound(s);
    // Seat 2 lets go during the creak, seat 1 keeps going.
    for (let i = 0; i < 12; i++) stepSmuggle(s, holds(1, 2), DT);
    const caught: number[] = [];
    for (let i = 0; i < 30; i++) caught.push(...stepSmuggle(s, holds(1), DT).caught);
    expect(caught).toEqual([1]);
    expect(one?.caught).toBe(1);
    expect(two?.caught).toBe(0);
    for (let i = 0; i < SMUGGLE.sentBack * 60 + 2; i++) stepSmuggle(s, holds(), DT);
    expect(one?.pos).toBe(0);
    expect(two?.pos).toBeGreaterThan(0.05);
  });

  it('forgives a release that was only delayed by the phone', () => {
    const s = newSmuggle(0, [1, 2, 3]);
    for (let i = 0; i < 60; i++) stepSmuggle(s, holds(1), DT);
    turnRound(s);
    const grace = [0, 0.1, 0, 0];
    // Still down when the look begins, released 0.05 s later.
    let caught: number[] = [];
    for (let i = 0; i < 27; i++) caught = caught.concat(stepSmuggle(s, holds(1), DT, grace).caught);
    for (let i = 0; i < 60; i++) caught = caught.concat(stepSmuggle(s, holds(), DT, grace).caught);
    expect(caught).toEqual([]);
  });

  it('gives the keeper the win when nobody reaches the fridge in time', () => {
    const s = newSmuggle(3, [0, 1, 2]);
    for (let i = 0; i < SMUGGLE.duration * 60 + 5; i++) stepSmuggle(s, holds(), DT);
    expect(isOver(s)).toBe(true);
    expect(smuggleScores(s, 4)).toEqual([0, 0, 0, 1]);
  });

  it('plays out with computer players: a fair fight at equal skill, and sharpness matters on both sides', () => {
    const N = 120;
    const keeperWins = (k: number, sn: number) => {
      let n = 0;
      for (let seed = 1; seed <= N; seed++) {
        const s = run(seed, k, sn);
        expect(isOver(s)).toBe(true);
        if (s.winner === null) n++;
      }
      return n / N;
    };
    const even = keeperWins(0.575, 0.575);
    expect(even).toBeGreaterThan(0.25);
    expect(even).toBeLessThan(0.75);
    expect(keeperWins(0.8, 0.35)).toBeGreaterThan(keeperWins(0.35, 0.35) + 0.1);
    expect(keeperWins(0.35, 0.8)).toBeLessThan(keeperWins(0.35, 0.35) - 0.1);
  });
});
