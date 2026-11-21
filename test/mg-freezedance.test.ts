import { describe, expect, it } from 'vitest';
import {
  FREEZE,
  type Party,
  cpuDj,
  cpuWobble,
  dancerOf,
  djFreeze,
  djMusic,
  djWins,
  freezeIn,
  isOver,
  newDjBrain,
  newMover,
  newParty,
  partyScores,
  stepParty,
} from '../src/game/minigames/freezedance';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** Steps the party for `seconds` with every dancer's wobble from `wobble(seat, sinceStart)`; returns the strikes. */
function play(p: Party, seconds: number, wobble: (seat: number, t: number) => number, lag: number[] = []) {
  const strikes: { seat: number; why: string }[] = [];
  const start = p.time;
  for (let i = 0; i < Math.round(seconds * 60) && !isOver(p); i++) {
    strikes.push(...stepParty(p, [0, 1, 2, 3].map((s) => wobble(s, p.time - start)), DT, lag).strikes);
  }
  return strikes;
}

const dancing = () => 0.6;
const frozen = () => 0.03;

function run(seed: number, dj: number, dancers: number): Party {
  const rng = createRng(seed);
  const p = newParty(0, [1, 2, 3]);
  const b = newDjBrain(dj);
  const ms = [0, 1, 2, 3].map(() => newMover(dancers));
  let steps = 0;
  while (!isOver(p) && steps++ < 10_000) {
    const a = cpuDj(p, b, rng);
    if (a === 'freeze') djFreeze(p);
    else if (a === 'music') djMusic(p);
    stepParty(
      p,
      [0, 1, 2, 3].map((s) => (s === 0 ? 0 : cpuWobble(p, ms[s] as ReturnType<typeof newMover>, rng, DT))),
      DT,
    );
  }
  return p;
}

describe('freeze dance', () => {
  it('lets the DJ freeze only a while after the music starts, and not twice', () => {
    const p = newParty(0, [1, 2, 3]);
    expect(djFreeze(p)).toBe('soon');
    play(p, FREEZE.lock - 0.1, dancing);
    expect(freezeIn(p)).toBeGreaterThan(0);
    expect(djFreeze(p)).toBe('soon');
    play(p, 0.2, dancing);
    expect(djFreeze(p)).toBe('freeze');
    expect(djFreeze(p)).toBe('frozen');
    expect(djMusic(p)).toBe('music');
    expect(djMusic(p)).toBe('playing');
    expect(djFreeze(p)).toBe('soon');
  });

  it('gives a strike to a dancer who stops dancing to the music', () => {
    const p = newParty(0, [1, 2, 3]);
    const strikes = play(p, FREEZE.warmup + FREEZE.stiff + 0.2, (s) => (s === 2 ? 0.05 : 0.6));
    expect(strikes).toEqual([{ seat: 2, why: 'stiff' }]);
  });

  it('gives half a second to freeze, then catches anyone still moving', () => {
    const p = newParty(0, [1, 2, 3]);
    play(p, FREEZE.lock + 0.05, dancing);
    djFreeze(p);
    // Seat 1 freezes in time, seat 2 a bit late but within the grace, seat 3 keeps dancing.
    const strikes = play(p, 2, (s, t) => (s === 1 ? (t < 0.2 ? 0.6 : 0.03) : s === 2 ? (t < 0.45 ? 0.6 : 0.03) : 0.6));
    expect(strikes).toEqual([{ seat: 3, why: 'caught' }]);
    // Only one catch per freeze.
    expect(dancerOf(p, 3)?.strikes).toBe(1);
  });

  it('gives a phone its lag on top of the grace', () => {
    const p = newParty(0, [1, 2, 3]);
    play(p, FREEZE.lock + 0.05, dancing);
    djFreeze(p);
    const late = (s: number, t: number) => (s === 1 && t < FREEZE.grace + 0.2 ? 0.6 : 0.03);
    expect(play(p, 2, late, [0, 0.15, 0, 0])).toEqual([]);
  });

  it('puts a dancer out at two strikes and starts the record again by itself', () => {
    const p = newParty(0, [1, 2, 3]);
    play(p, FREEZE.lock + 0.05, dancing);
    djFreeze(p);
    play(p, FREEZE.maxFreeze + 0.1, (s) => (s === 1 ? 0.6 : 0.03));
    expect(p.phase).toBe('music');
    play(p, FREEZE.lock + 0.05, dancing);
    djFreeze(p);
    play(p, 2, (s) => (s === 1 ? 0.6 : 0.03));
    const d = dancerOf(p, 1);
    expect(d?.strikes).toBe(2);
    expect(d?.outAt).not.toBeNull();
    // Out of the game: no more strikes.
    djMusic(p);
    expect(play(p, 5, frozen).filter((s) => s.seat === 1)).toEqual([]);
  });

  it('gives the DJ the win when nobody is left dancing, the dancers otherwise', () => {
    const p = newParty(3, [0, 1, 2]);
    play(p, 8, frozen);
    expect(djWins(p)).toBe(true);
    expect(isOver(p)).toBe(true);
    expect(partyScores(p, 4)).toEqual([0, 0, 0, 1]);

    const q = newParty(0, [1, 2, 3]);
    play(q, FREEZE.duration + 1, dancing);
    expect(isOver(q)).toBe(true);
    expect(partyScores(q, 4)).toEqual([0, 1, 1, 1]);
  });

  it('plays out with computer players, and sharpness matters on both sides', () => {
    let sharpDj = 0;
    let sleepyDj = 0;
    let even = 0;
    let freezes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = run(seed, 0.9, 0.4);
      const b = run(seed, 0.4, 0.9);
      const c = run(seed, 0.575, 0.575);
      expect(isOver(a) && isOver(b) && isOver(c)).toBe(true);
      if (djWins(a)) sharpDj++;
      if (djWins(b)) sleepyDj++;
      if (djWins(c)) even++;
      freezes += c.freezes;
    }
    expect(sharpDj).toBeGreaterThan(30);
    expect(sleepyDj).toBeLessThan(8);
    expect(even).toBeGreaterThan(8);
    expect(even).toBeLessThan(32);
    // The DJ freezes every few seconds, not constantly.
    expect(freezes / 40).toBeGreaterThan(3);
    expect(freezes / 40).toBeLessThan(12);
  });
});
