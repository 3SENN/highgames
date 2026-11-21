import { describe, expect, it } from 'vitest';
import {
  BOMBERS,
  SELFIE,
  type Sample,
  countdownAt,
  cpuSelfieWobble,
  judgeShot,
  newSelfieCpu,
  phaseAt,
  planShoot,
  selfieCoop,
  shootLength,
  shotAt,
} from '../src/game/minigames/groupselfie';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** A shoot played by computer players, sampled ten times a second as the phones do. */
function simulate(players: number, skill: number, seed: number): number {
  const rng = createRng(seed);
  const shots = planShoot(rng, players);
  const cpus = Array.from({ length: players }, () => newSelfieCpu());
  const samples: Sample[][] = Array.from({ length: players }, () => []);
  const results: boolean[][] = [];
  let t = 0;
  let sampleAt = 0;
  let judged = 0;
  while (t < shootLength(shots)) {
    t += DT;
    const shot = shotAt(shots, t);
    if (!shot) break;
    const startle = shot.bomber !== null && t - DT < shot.bomberAt && t >= shot.bomberAt;
    const wobble = cpus.map((c) => cpuSelfieWobble(c, skill, rng, DT, phaseAt(shot, t), startle));
    if (t >= sampleAt) {
      sampleAt += 0.1;
      wobble.forEach((w, i) => samples[i]?.push({ at: t, wobble: w }));
    }
    while (judged < shots.length && t >= (shots[judged]?.clickAt ?? 0) + SELFIE.exposure + SELFIE.grace) {
      const click = shots[judged]?.clickAt ?? 0;
      results.push(samples.map((s) => judgeShot(s, click).sharp));
      judged++;
    }
  }
  expect(results).toHaveLength(SELFIE.photos);
  return selfieCoop(results);
}

describe('group selfie', () => {
  it('plans six photos with a 3-2-1 each and photobombers of every kind, never on the first', () => {
    for (let seed = 1; seed < 30; seed++) {
      const shots = planShoot(createRng(seed), 4);
      expect(shots).toHaveLength(SELFIE.photos);
      expect(shots[0]?.bomber).toBeNull();
      const bombers = shots.filter((s) => s.bomber);
      expect(bombers).toHaveLength(SELFIE.bombers);
      expect(new Set(bombers.map((s) => s.bomber)).size).toBe(BOMBERS.length);
      for (const s of shots) {
        expect(s.clickAt).toBeCloseTo(s.countAt + s.beat * 3);
        expect(s.victim).toBeGreaterThanOrEqual(0);
        expect(s.victim).toBeLessThan(4);
        if (s.bomber) {
          expect(s.bomberAt).toBeGreaterThan(s.countAt);
          expect(s.bomberAt).toBeLessThan(s.clickAt);
        }
      }
      for (let i = 1; i < shots.length; i++) expect(shots[i]?.countAt ?? 0).toBeGreaterThan(shots[i - 1]?.end ?? 0);
      const total = shootLength(shots);
      expect(total).toBeGreaterThan(25);
      expect(total).toBeLessThan(40);
    }
  });

  it('counts down 3, 2, 1 and then exposes', () => {
    const shot = planShoot(createRng(3), 2)[0];
    if (!shot) throw new Error('no shot');
    expect(phaseAt(shot, shot.countAt - 0.1)).toBe('wriggle');
    expect(countdownAt(shot, shot.countAt + 0.01)).toBe(3);
    expect(countdownAt(shot, shot.countAt + shot.beat * 1.5)).toBe(2);
    expect(countdownAt(shot, shot.clickAt - 0.01)).toBe(1);
    expect(countdownAt(shot, shot.clickAt)).toBe(0);
    expect(phaseAt(shot, shot.clickAt + 0.1)).toBe('expose');
    expect(phaseAt(shot, shot.clickAt + SELFIE.exposure + 0.1)).toBe('show');
  });

  it('blurs anyone who wobbles at the click or while the shutter is open', () => {
    const click = 10;
    const steady: Sample[] = [9.7, 9.8, 9.95, 10.05, 10.15, 10.25, 10.35].map((at) => ({ at, wobble: 0.05 }));
    expect(judgeShot(steady, click)).toEqual({ sharp: true, peak: 0.05 });
    // Wriggling well before the click doesn't matter, nor after the shutter closes.
    expect(judgeShot([{ at: 9.5, wobble: 0.9 }, ...steady, { at: 10.6, wobble: 0.9 }], click).sharp).toBe(true);
    // Still moving at the click…
    expect(judgeShot([{ at: 9.92, wobble: 0.3 }, { at: 10.02, wobble: 0.1 }], click).sharp).toBe(false);
    // …or a twitch mid-exposure.
    expect(judgeShot([...steady, { at: 10.2, wobble: SELFIE.threshold }], click)).toEqual({ sharp: false, peak: SELFIE.threshold });
    // A phone that sent nothing counts as still.
    expect(judgeShot([], click).sharp).toBe(true);
  });

  it('scores sharp faces over all faces', () => {
    expect(
      selfieCoop([
        [true, true, false, true],
        [true, false, true, true],
      ]),
    ).toBeCloseTo(6 / 8);
    expect(selfieCoop([])).toBe(0);
  });

  it('keeps computer players wriggling between photos and still for the click', () => {
    const c = newSelfieCpu();
    const rng = createRng(9);
    const wriggle = Array.from({ length: 60 }, () => cpuSelfieWobble(c, 0.8, rng, DT, 'wriggle', false));
    expect(Math.max(...wriggle)).toBeGreaterThan(SELFIE.threshold);
    for (let i = 0; i < 120; i++) cpuSelfieWobble(c, 1, rng, DT, 'count', false);
    expect(cpuSelfieWobble(c, 1, rng, DT, 'expose', false)).toBeLessThan(SELFIE.threshold);
  });

  it('lets sharp computer players take sharp photos and average ones most of them', () => {
    const avg = (players: number, skill: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 80; seed++) sum += simulate(players, skill, seed * 11 + players);
      return sum / 80;
    };
    expect(avg(4, 1)).toBeGreaterThan(0.95);
    const mid = avg(4, 0.5);
    expect(mid).toBeGreaterThan(0.65);
    expect(mid).toBeLessThan(0.85);
    expect(avg(1, 1)).toBeGreaterThan(0.9);
    expect(avg(2, 0.5)).toBeGreaterThan(0.6);
  });
});
