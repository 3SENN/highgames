import { describe, expect, it } from 'vitest';
import {
  SNAIL,
  SNAILS,
  type Race,
  type SnailFan,
  cheer,
  fanTaps,
  fillBets,
  makePauses,
  newFan,
  newRace,
  paceFor,
  placeBet,
  placings,
  raceOver,
  snailScores,
  stepRace,
} from '../src/game/minigames/snailrace';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** Runs a race where each seat taps at a steady rate (taps a second). */
function run(race: Race, rates: number[]): void {
  const next = rates.map(() => 0);
  while (!raceOver(race)) {
    stepRace(race, DT);
    rates.forEach((r, i) => {
      if (r > 0 && race.time >= (next[i] ?? 0)) {
        cheer(race, i, race.time);
        next[i] = race.time + 1 / r;
      }
    });
  }
}

describe('snail bets', () => {
  it('has four snails with shells that are not the seat colours', () => {
    expect(SNAILS).toHaveLength(4);
    const seats = ['#f5a524', '#3b82f6', '#e2437a', '#22b573'];
    for (const s of SNAILS) expect(seats).not.toContain(s.shell.toLowerCase());
  });

  it('spreads each snail’s snack stops and shell tucks through the race without overlaps', () => {
    for (let seed = 1; seed < 60; seed++) {
      const pauses = makePauses(createRng(seed));
      expect(pauses.length).toBeGreaterThanOrEqual(SNAIL.pauses[0]);
      expect(pauses.length).toBeLessThanOrEqual(SNAIL.pauses[1]);
      pauses.forEach((p, i) => {
        expect(p.at).toBeGreaterThanOrEqual(SNAIL.pauseFrom);
        expect(p.at + p.len).toBeLessThanOrEqual(SNAIL.pauseTo + 0.01);
        if (i > 0) {
          const prev = pauses[i - 1];
          if (prev) expect(p.at).toBeGreaterThan(prev.at + prev.len);
        }
      });
    }
  });

  it('takes bets, lets you change your mind, and gives a random snail to anyone who forgot', () => {
    const race = newRace(createRng(1), 3);
    expect(placeBet(race, 0, 2)).toBe(true);
    expect(placeBet(race, 0, 1)).toBe(true);
    expect(placeBet(race, 1, 9)).toBe(false);
    expect(race.bets).toEqual([1, null, null]);
    expect(fillBets(race, createRng(2))).toEqual([1, 2]);
    for (const b of race.bets) expect(b).not.toBeNull();
  });

  it('speeds a snail up with cheering, levelling off for a crowd', () => {
    expect(paceFor(0)).toBe(SNAIL.base);
    expect(paceFor(5)).toBeGreaterThan(paceFor(0));
    const one = paceFor(7.5) - paceFor(0); // one fan at 6 taps a second
    const two = paceFor(15) - paceFor(0); // two fans
    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThan(one * 1.5);
    expect(paceFor(1000)).toBeLessThanOrEqual(SNAIL.base + SNAIL.boost);
  });

  it('ignores taps that come too quickly and taps without a bet', () => {
    const race = newRace(createRng(3), 2);
    placeBet(race, 0, 0);
    expect(cheer(race, 0, 1)).toBe(true);
    expect(cheer(race, 0, 1.02)).toBe(false);
    expect(cheer(race, 0, 1.1)).toBe(true);
    expect(cheer(race, 1, 1.1)).toBe(false);
    expect(race.cheers).toEqual([2, 0]);
  });

  it('stops a snail for its snacks and tucks, and cheering coaxes it out sooner', () => {
    const quiet = newRace(createRng(4), 1);
    const loud = newRace(createRng(4), 1);
    for (const r of [quiet, loud]) {
      placeBet(r, 0, 0);
      const s = r.snails[0];
      if (!s) throw new Error('no snail');
      s.pauses = [{ at: 1, len: 1.5, kind: 'tuck' }];
    }
    let pausedFor = [0, 0];
    for (let i = 0; i < 4 / DT; i++) {
      [quiet, loud].forEach((r, k) => {
        const ev = stepRace(r, DT);
        if (ev.paused.length) expect(ev.paused[0]?.kind).toBe('tuck');
        if (r.snails[0]?.pausing) pausedFor = pausedFor.map((p, j) => (j === k ? p + DT : p));
      });
      if (i % 6 === 0) cheer(loud, 0, loud.time);
    }
    expect(pausedFor[0]).toBeGreaterThan(1.4);
    expect(pausedFor[1]).toBeLessThan((pausedFor[0] ?? 0) - 0.1);
  });

  it('finishes a cheered snail inside the race, and an unloved one never gets there', () => {
    for (let seed = 1; seed < 30; seed++) {
      const race = newRace(createRng(seed), 1);
      placeBet(race, 0, 1);
      run(race, [6]);
      const cheered = race.snails[1];
      expect(cheered?.finishedAt).not.toBeNull();
      expect(cheered?.finishedAt ?? 99).toBeLessThan(SNAIL.race);
      expect(race.snails[0]?.finishedAt).toBeNull();
      expect(race.snails[0]?.x ?? 99).toBeLessThan(SNAIL.length * 0.6);
    }
  });

  it('places snails by finish time, then distance, and scores bets and the cheer bonus', () => {
    const race = newRace(createRng(5), 4);
    const [a, b, c, d] = race.snails;
    if (!a || !b || !c || !d) throw new Error('snails');
    a.finishedAt = 20;
    b.finishedAt = 18;
    c.x = 5;
    d.x = 7;
    expect(placings(race)).toEqual([1, 0, 3, 2]);
    race.bets = [1, 1, 3, 2];
    race.cheers = [50, 80, 80, 10];
    expect(snailScores(race)).toEqual([4, 5, 2, 0]);
  });

  it('ends the race when three snails are home or time runs out', () => {
    const race = newRace(createRng(6), 4);
    expect(raceOver(race)).toBe(false);
    race.snails.slice(0, 3).forEach((s, i) => (s.finishedAt = 10 + i));
    expect(raceOver(race)).toBe(true);
    const slow = newRace(createRng(6), 4);
    slow.time = SNAIL.race;
    expect(raceOver(slow)).toBe(true);
  });

  /** Sharp fan on one snail, another fan of `skill` on the next; how often the sharp one's snail comes in ahead. */
  const duel = (skill: number, games: number) => {
    let sharpAhead = 0;
    for (let seed = 1; seed <= games; seed++) {
      const rng = createRng(seed);
      const race = newRace(rng, 2);
      const fans: SnailFan[] = [newFan(rng, 1), newFan(rng, skill)];
      placeBet(race, 0, 0);
      placeBet(race, 1, 1);
      while (!raceOver(race)) {
        stepRace(race, DT);
        fans.forEach((f, i) => {
          const taps = fanTaps(f, race.time, DT, rng);
          for (let k = 0; k < taps; k++) cheer(race, i, race.time - (DT * k) / Math.max(1, taps));
        });
      }
      const place = placings(race);
      if ((place[0] ?? 9) < (place[1] ?? 9)) sharpAhead++;
      expect(race.snails.some((s) => s.finishedAt !== null)).toBe(true);
    }
    return sharpAhead / games;
  };

  it('has sharp computer fans cheer their snail home ahead of sleepy ones, and average ones close behind', () => {
    expect(duel(0, 80)).toBeGreaterThan(0.85);
    const vsAverage = duel(0.5, 120);
    expect(vsAverage).toBeGreaterThan(0.55);
    expect(vsAverage).toBeLessThan(1); // the snacks and tucks give an average fan a chance
  });
});
