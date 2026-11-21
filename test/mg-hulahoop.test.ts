import { describe, expect, it } from 'vitest';
import {
  HOOP,
  type HoopEvent,
  type Hooper,
  cpuHoop,
  hoopDetail,
  hoopScores,
  newCpuHooper,
  newHooper,
  sinkRate,
  spinning,
  stepHooper,
  teamHoopSeconds,
} from '../src/game/minigames/hulahoop';
import { createRng } from '../src/game/rng';

/** Spins for `seconds` at a speed given by `speed(t)`; returns every event. */
function spin(h: Hooper, speed: (t: number) => number, seconds: number, dt = 0.05): HoopEvent[] {
  const events: HoopEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...stepHooper(h, speed(t), dt));
  return events;
}

describe('hula hoop party', () => {
  it('earns a hoop every few seconds of steady spinning, up to five', () => {
    const h = newHooper();
    const events = spin(h, () => 0.7, HOOP.duration);
    expect(events.filter((e) => e === 'hoop')).toHaveLength(HOOP.max - 1);
    expect(h.hoops).toBe(HOOP.max);
    expect(h.drops + h.dizzies).toBe(0);
    // 1, 2, 3 and 4 hoops for about three seconds each, then five for the rest.
    expect(h.score).toBeGreaterThan(105);
    expect(h.score).toBeLessThanOrEqual(HOOP.duration * HOOP.max);
  });

  it('takes a little longer than three seconds for the first extra hoop, as the hoop catches up with your hips', () => {
    const h = newHooper();
    let t = 0;
    while (h.hoops === 1 && t < 10) {
      stepHooper(h, 0.7, 0.05);
      t += 0.05;
    }
    expect(t).toBeGreaterThanOrEqual(HOOP.earnAfter);
    expect(t).toBeLessThan(HOOP.earnAfter + 0.5);
  });

  it('lets the hoops sink and drop when you spin too slowly, then picks them up again', () => {
    const h: Hooper = { ...newHooper(), hoops: 3, speed: 0.1 };
    const events = spin(h, () => 0, 2.4);
    expect(events).toContain('sinking');
    expect(events).toContain('drop');
    expect(events).toContain('up');
    expect(events.indexOf('sinking')).toBeLessThan(events.indexOf('drop'));
    expect(h.drops).toBe(1);
    expect(h.hoops).toBe(3); // you keep your hoops, it just takes a moment to get them going again
    expect(h.lift).toBeGreaterThan(0);
  });

  it('scores nothing while the hoops are on the floor', () => {
    const h: Hooper = { ...newHooper(), hoops: 4, lift: 0.01, speed: 0 };
    expect(stepHooper(h, 0, 0.05)).toContain('drop');
    expect(spinning(h)).toBe(0);
    const before = h.score;
    expect(spin(h, () => 0.7, HOOP.pickup - 0.1)).not.toContain('up');
    expect(h.score).toBe(before);
    expect(spin(h, () => 0.7, 0.2)).toContain('up');
    expect(spinning(h)).toBe(4);
  });

  it('sinks faster standing still than spinning just under the line, and not at all above it', () => {
    expect(sinkRate(HOOP.sink)).toBe(0);
    expect(sinkRate(0.6)).toBe(0);
    expect(sinkRate(0)).toBeCloseTo(HOOP.sinkStill);
    expect(sinkRate(0.29)).toBeGreaterThan(HOOP.sinkSlow);
    expect(sinkRate(0)).toBeGreaterThan(sinkRate(0.2));
  });

  it('wins back height once you speed up again before they reach the floor', () => {
    const h: Hooper = { ...newHooper(), hoops: 2 };
    spin(h, () => 0, 0.5);
    expect(h.lift).toBeLessThan(1);
    expect(h.lift).toBeGreaterThan(0);
    spin(h, () => 0.7, 1.5);
    expect(h.lift).toBe(1);
    expect(h.drops).toBe(0);
  });

  it('makes you dizzy after spinning too fast for too long, and a hoop flies off', () => {
    const h: Hooper = { ...newHooper(), hoops: 4, speed: 1 };
    const events: HoopEvent[] = [];
    let t = 0;
    while (h.dizzies === 0 && t < 6) {
      events.push(...stepHooper(h, 1, 0.05));
      t += 0.05;
    }
    expect(t).toBeGreaterThan(HOOP.dizzyAfter - 0.1);
    expect(t).toBeLessThan(HOOP.dizzyAfter + 0.2);
    expect(events).toContain('warn');
    expect(events.indexOf('warn')).toBeLessThan(events.indexOf('dizzy'));
    expect(h.hoops).toBe(3);
    expect(h.down).toBe(0);
    // No new hoops while dizzy, however steady.
    expect(spin(h, () => 0.7, HOOP.dizzyFor - 0.1)).not.toContain('hoop');
    expect(spin(h, () => 0.7, 0.2)).toContain('steady');
  });

  it('drops your only hoop when you get dizzy with just the one', () => {
    const h: Hooper = { ...newHooper(), speed: 1 };
    const events = spin(h, () => 1, HOOP.dizzyAfter + 0.1);
    expect(events).toContain('dizzy');
    expect(h.hoops).toBe(1);
    expect(h.down).toBeGreaterThan(0);
  });

  it('forgives short bursts of speed and short dips under the steady line', () => {
    const bursts = newHooper();
    spin(bursts, (t) => (t % 4 < 1.4 ? 1 : 0.7), HOOP.duration);
    expect(bursts.dizzies).toBe(0);
    const dips = newHooper();
    spin(dips, (t) => (t % 2 < 0.15 ? 0.45 : 0.7), HOOP.duration);
    expect(dips.hoops).toBe(HOOP.max);
    const greedy = newHooper();
    spin(greedy, () => 1, HOOP.duration);
    expect(greedy.dizzies).toBeGreaterThan(2);
    expect(greedy.score).toBeLessThan(bursts.score / 2);
  });

  it('gives both partners their team total, and words the results kindly', () => {
    const hs = [40.04, 12, 55.5, 30].map((score) => ({ ...newHooper(), score }));
    expect(teamHoopSeconds(hs, [0, 2])).toBe(95.5);
    const scores = hoopScores(hs, [
      [0, 2],
      [1, 3],
    ]);
    expect(scores).toEqual([95.5, 42, 95.5, 42]);
    // A team of one simply scores its own hoops.
    expect(hoopScores(hs.slice(0, 3), [[0, 2], [1]])).toEqual([95.5, 12, 95.5]);
    const h: Hooper = { ...newHooper(), score: 40.04, best: 4, drops: 1, dizzies: 2 };
    expect(hoopDetail(h, 95.5)).toBe('Team 96 hoop-seconds · 40 yours · best 4 hoops · dropped once · dizzy 2 times');
    expect(hoopDetail(newHooper(), 0)).toBe('Team 0 hoop-seconds · 0 yours · best 1 hoop');
  });
});

describe('hula hoop computer players', () => {
  const play = (skill: number, seed: number) => {
    const rng = createRng(seed);
    const h = newHooper();
    const c = newCpuHooper(skill, rng);
    const dt = 1 / 60;
    for (let t = 0; t < HOOP.duration; t += dt) stepHooper(h, cpuHoop(c, h, skill, rng, dt), dt);
    return h;
  };
  const average = (skill: number) => {
    let sum = 0;
    for (let seed = 1; seed <= 60; seed++) sum += play(skill, seed * 13 + 1).score;
    return sum / 60;
  };

  it('sends sensible spin speeds', () => {
    const rng = createRng(5);
    const h = newHooper();
    const c = newCpuHooper(0.5, rng);
    for (let i = 0; i < 2000; i++) {
      const s = cpuHoop(c, h, 0.5, rng, 1 / 60);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      stepHooper(h, s, 1 / 60);
    }
  });

  it('sharp ones keep more hoops going than sleepy ones, and an average one is beatable', () => {
    const sharp = average(1);
    const mid = average(0.55);
    const sleepy = average(0);
    expect(sharp).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(sleepy + 20);
    // Sharp is strong but not perfect; an average computer leaves room for a steady hand to win.
    expect(sharp).toBeGreaterThan(100);
    expect(sharp).toBeLessThan(HOOP.duration * HOOP.max * 0.8);
    expect(mid).toBeLessThan(105);
    expect(sleepy).toBeGreaterThan(15);
  });

  it('sleepy ones drop their hoops now and then, sharp ones hardly ever', () => {
    let sharp = 0;
    let sleepy = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = play(1, seed);
      const b = play(0, seed);
      sharp += a.drops + a.dizzies;
      sleepy += b.drops + b.dizzies;
    }
    expect(sleepy).toBeGreaterThan(sharp * 3);
    expect(sleepy / 40).toBeGreaterThan(1);
  });
});
