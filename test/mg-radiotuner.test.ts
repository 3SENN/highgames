import { describe, expect, it } from 'vitest';
import {
  RADIO,
  STATION_NAMES,
  checkLock,
  clarity,
  freqOf,
  inBand,
  lockPoints,
  lockProgress,
  moveTuner,
  newCpuTuner,
  newTuner,
  planStations,
  radioScores,
  stepCpuTuner,
} from '../src/game/minigames/radiotuner';
import { createRng } from '../src/game/rng';

/** Runs one CPU on one station until it locks in; returns the lock time (or null). */
function race(seed: number, skill: number, dt = 1 / 30): number | null {
  const rng = createRng(seed);
  const [st] = planStations(rng, 1);
  if (!st) return null;
  const cpu = newCpuTuner(rng, st.start, skill);
  const t = newTuner(st.start);
  for (let now = 0; now < RADIO.roundTime; now += dt) {
    moveTuner(t, stepCpuTuner(cpu, rng, st.at, dt), now, st.at);
    if (checkLock(t, now)) return t.lockedAt;
  }
  return null;
}

describe('late night radio', () => {
  it('plans stations inside the dial, well apart, with a start far from each', () => {
    for (let seed = 1; seed < 300; seed++) {
      const stations = planStations(createRng(seed));
      expect(stations).toHaveLength(RADIO.rounds);
      stations.forEach((s, i) => {
        expect(s.at).toBeGreaterThanOrEqual(RADIO.edge - 1e-9);
        expect(s.at).toBeLessThanOrEqual(1 - RADIO.edge + 1e-9);
        expect(Math.abs(s.start - s.at)).toBeGreaterThanOrEqual(RADIO.startGap - 0.001);
        expect(s.start).toBeGreaterThanOrEqual(0);
        expect(s.start).toBeLessThanOrEqual(1);
        expect(STATION_NAMES).toContain(s.name);
        const prev = stations[i - 1];
        if (prev) expect(Math.abs(s.at - prev.at)).toBeGreaterThanOrEqual(RADIO.minMove - 1e-9);
      });
      expect(new Set(stations.map((s) => s.name)).size).toBe(RADIO.rounds);
    }
  });

  it('comes in clearer the closer you get', () => {
    expect(clarity(0.5, 0.5)).toBe(1);
    expect(clarity(0.5 + RADIO.range, 0.5)).toBeCloseTo(0, 9);
    expect(clarity(0.9, 0.2)).toBe(0);
    let last = 2;
    for (let d = 0; d <= RADIO.range; d += 0.01) {
      const c = clarity(0.4 + d, 0.4);
      expect(c).toBeLessThanOrEqual(last);
      last = c;
    }
    expect(inBand(0.52, 0.5)).toBe(true);
    expect(inBand(0.54, 0.5)).toBe(false);
    expect(freqOf(0)).toBe('88.0');
    expect(freqOf(1)).toBe('108.0');
  });

  it('locks in after holding inside the band, and starts over when you drift out', () => {
    const t = newTuner(0.1);
    moveTuner(t, 0.49, 1, 0.5);
    expect(t.since).toBe(1);
    expect(checkLock(t, 2)).toBe(false);
    expect(lockProgress(t, 2)).toBeCloseTo(1 / RADIO.lockTime);
    moveTuner(t, 0.5, 2.1, 0.5); // still inside: the hold carries on
    expect(t.since).toBe(1);
    moveTuner(t, 0.6, 2.2, 0.5); // out
    expect(t.since).toBeNull();
    expect(checkLock(t, 5)).toBe(false);
    moveTuner(t, 0.51, 3, 0.5);
    expect(checkLock(t, 3 + RADIO.lockTime - 0.01)).toBe(false);
    expect(checkLock(t, 3 + RADIO.lockTime + 0.2)).toBe(true);
    expect(t.lockedAt).toBeCloseTo(3 + RADIO.lockTime);
    moveTuner(t, 0.9, 6, 0.5); // locked in: moving does nothing
    expect(t.value).toBe(0.51);
    expect(checkLock(t, 7)).toBe(false);
  });

  it('scores the first three to lock in, sharing ties', () => {
    expect(lockPoints([5.2, null, 3.1, 8])).toEqual([2, 0, 3, 1]);
    expect(lockPoints([4, 4, 6, 7])).toEqual([3, 3, 1, 0]);
    expect(lockPoints([null, null])).toEqual([0, 0]);
  });

  it('breaks equal points by total time', () => {
    const [a, b] = radioScores([6, 6], [20, 14]) as [number, number];
    expect(b).toBeGreaterThan(a);
  });

  it('has computer players find the station in a believable time, sharp ones faster', () => {
    const stats = (skill: number) => {
      const times: number[] = [];
      let missed = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const t = race(seed, skill);
        if (t === null) missed++;
        else times.push(t);
      }
      times.sort((a, b) => a - b);
      return { median: times[Math.floor(times.length / 2)] ?? 99, missed };
    };
    const sharp = stats(0.9);
    const mid = stats(0.55);
    const sleepy = stats(0.2);
    expect(sharp.median).toBeGreaterThan(2.2);
    expect(sharp.median).toBeLessThan(5);
    expect(mid.median).toBeGreaterThan(sharp.median);
    expect(mid.median).toBeLessThan(7);
    expect(sleepy.median).toBeGreaterThan(mid.median);
    expect(sharp.missed).toBeLessThan(6);
    expect(mid.missed).toBeLessThan(30);
    expect(sleepy.missed).toBeLessThan(90);
  });

  it('plays the same whatever the frame rate', () => {
    let close = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const a = race(seed, 0.6, 1 / 60);
      const b = race(seed, 0.6, 1 / 10);
      if (a !== null && b !== null && Math.abs(a - b) < 0.6) close++;
    }
    expect(close).toBeGreaterThan(30);
  });

  it('lets sharp computer players win more stations, but not all of them', () => {
    let sharp = 0;
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = createRng(seed * 13);
      const skills = [0.85, 0.5, 0.5, 0.3];
      for (const st of planStations(rng)) {
        const cpus = skills.map((k) => newCpuTuner(rng, st.start, k));
        const tuners = skills.map(() => newTuner(st.start));
        for (let now = 0; now < RADIO.roundTime; now += 1 / 30) {
          cpus.forEach((c, i) => {
            const t = tuners[i];
            if (!t) return;
            moveTuner(t, stepCpuTuner(c, rng, st.at, 1 / 30), now, st.at);
            checkLock(t, now);
          });
        }
        const pts = lockPoints(tuners.map((t) => t.lockedAt));
        total++;
        if (pts[0] === 3) sharp++;
      }
    }
    expect(sharp / total).toBeGreaterThan(0.35);
    expect(sharp / total).toBeLessThan(0.9);
  });
});
