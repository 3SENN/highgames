import { describe, expect, it } from 'vitest';
import { LAVA, type Rememberer, cpuAnswer, cpuSpan, grow, lavaScores, longest, newRememberer, press, startRound, startSequence, stepGap, timeUp } from '../src/game/minigames/lavalamp';
import { type Rng, createRng } from '../src/game/rng';

/** Plays a whole game of computer players; returns them and how many rounds were played. */
function playCpus(rng: Rng, skills: readonly number[]): { players: Rememberer[]; rounds: number } {
  const players = skills.map(() => newRememberer());
  const spans = skills.map((k) => cpuSpan(rng, k));
  let seq = startSequence(rng);
  let rounds = 0;
  for (let round = 0; round < LAVA.rounds; round++) {
    if (round > 0 && players.filter((p) => !p.out).length <= 1) break;
    rounds++;
    players.forEach((p, i) => {
      startRound(p);
      if (p.out) return;
      const a = cpuAnswer(rng, seq, spans[i] as number, skills[i] as number);
      a.presses.forEach((c, k) => {
        const t = a.times[k] as number;
        if (t <= LAVA.answerTime) press(p, seq, c, t);
      });
      timeUp(p);
    });
    seq = grow(rng, seq);
  }
  return { players, rounds };
}

describe('lava lamp says', () => {
  it('grows the same sequence by one colour, never three of a kind in a row', () => {
    const rng = createRng(4);
    let seq = startSequence(rng);
    expect(seq.length).toBe(LAVA.start);
    for (let i = 0; i < 200; i++) {
      const next = grow(rng, seq);
      expect(next.slice(0, seq.length)).toEqual(seq);
      expect(next.length).toBe(seq.length + 1);
      const n = next.length;
      expect(next[n - 1]).toBeGreaterThanOrEqual(0);
      expect(next[n - 1]).toBeLessThan(LAVA.colors);
      if (n >= 3) expect(next[n - 1] === next[n - 2] && next[n - 2] === next[n - 3]).toBe(false);
      seq = next.length > 12 ? startSequence(rng) : next;
    }
  });

  it('plays a bit quicker every round', () => {
    expect(stepGap(0)).toBeGreaterThan(stepGap(3));
    expect(stepGap(20)).toBeGreaterThanOrEqual(0.4);
  });

  it('clears a round on the full sequence and knocks you out on a wrong colour', () => {
    const seq = [0, 2, 1];
    const r = newRememberer();
    startRound(r);
    expect(press(r, seq, 0, 0.5)).toBe('good');
    expect(press(r, seq, 2, 0.9)).toBe('good');
    expect(press(r, seq, 1, 1.4)).toBe('done');
    expect(press(r, seq, 1, 1.6)).toBe('ignored');
    expect(r.cleared).toBe(1);
    expect(timeUp(r)).toBe(false);
    startRound(r);
    const longer = [...seq, 3];
    expect(press(r, longer, 0, 0.4)).toBe('good');
    expect(press(r, longer, 3, 0.8)).toBe('wrong');
    expect(r.out).toBe(true);
    expect(r.partial).toBe(1);
    startRound(r);
    expect(press(r, longer, 0, 0.4)).toBe('ignored');
    expect(longest(r)).toBe(LAVA.start);
  });

  it('knocks you out when the time runs out', () => {
    const r = newRememberer();
    startRound(r);
    press(r, [1, 1, 2], 1, 0.5);
    expect(timeUp(r)).toBe(true);
    expect(r.out).toBe(true);
    expect(r.partial).toBe(1);
  });

  it('ranks by rounds, then colours right in the last round, then speed', () => {
    const a = { ...newRememberer(), cleared: 3, time: 20 };
    const b = { ...newRememberer(), cleared: 2, partial: 4, out: true, time: 5 };
    const c = { ...newRememberer(), cleared: 2, partial: 1, out: true, time: 5 };
    const d = { ...newRememberer(), cleared: 2, partial: 1, out: true, time: 9 };
    const [sa, sb, sc, sd] = lavaScores([a, b, c, d]) as [number, number, number, number];
    expect(sa).toBeGreaterThan(sb);
    expect(sb).toBeGreaterThan(sc);
    expect(sc).toBeGreaterThan(sd);
  });

  it('has computer players answer in time and remember more the sharper they are', () => {
    let sleepy = 0;
    let middling = 0;
    let sharp = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      const rng = createRng(seed);
      for (const [skill, add] of [
        [0, (v: number) => (sleepy += v)],
        [0.55, (v: number) => (middling += v)],
        [1, (v: number) => (sharp += v)],
      ] as const) {
        const span = cpuSpan(rng, skill);
        let seq = startSequence(rng);
        let got = 0;
        for (let round = 0; round < 10; round++) {
          const a = cpuAnswer(rng, seq, span, skill);
          expect(a.times[a.times.length - 1] as number).toBeLessThan(LAVA.answerTime);
          if (a.presses.length !== seq.length || a.presses.some((c, k) => c !== seq[k])) break;
          got = seq.length;
          seq = grow(rng, seq);
        }
        add(got);
      }
    }
    sleepy /= N;
    middling /= N;
    sharp /= N;
    expect(sleepy).toBeGreaterThan(2);
    expect(sleepy).toBeLessThan(4.5);
    expect(middling).toBeGreaterThan(4.5);
    expect(middling).toBeLessThan(7);
    expect(sharp).toBeGreaterThan(7.5);
  });

  it('lets sharp computer players win most CPU-only games, and keeps games short', () => {
    let sharpWins = 0;
    let longGames = 0;
    const N = 300;
    for (let seed = 1; seed <= N; seed++) {
      const { players, rounds } = playCpus(createRng(seed), [0.9, 0.45, 0.45, 0.2]);
      const scores = lavaScores(players);
      if ((scores[0] as number) >= Math.max(...scores)) sharpWins++;
      if (rounds > 5) longGames++;
    }
    expect(sharpWins / N).toBeGreaterThan(0.5);
    expect(sharpWins / N).toBeLessThan(0.97);
    expect(longGames / N).toBeLessThan(0.5);
  });
});
