import { describe, expect, it } from 'vitest';
import {
  type Campfire,
  type RoastEvent,
  SMORES,
  cpuSmoresTilt,
  doneness,
  effectiveReach,
  finishCampfire,
  flareAt,
  goalFor,
  heatFor,
  newCampfire,
  newSmoresCpu,
  planGusts,
  reachToTilt,
  seatAngle,
  smoresCoop,
  stepCampfire,
  tiltToReach,
} from '../src/game/minigames/smores';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** A calm fire: no gusts. */
function calm(players = 1): Campfire {
  const c = newCampfire(createRng(1), players);
  c.gusts = [];
  return c;
}

/** Holds the stick at `reach` until `until` says stop (or `max` seconds pass). Returns every event. */
function hold(c: Campfire, reach: number, until: (e: RoastEvent[]) => boolean, max = 20): RoastEvent[] {
  const all: RoastEvent[] = [];
  for (let t = 0; t < max; t += DT) {
    const e = stepCampfire(c, DT, [reach]);
    all.push(...e);
    if (until(e)) break;
  }
  return all;
}

describe("s'mores night", () => {
  it('reads the tilt: held level is out of the fire, tipped forward goes in', () => {
    expect(tiltToReach(0)).toBe(0);
    expect(tiltToReach(0.5)).toBe(0);
    expect(tiltToReach(-1)).toBe(1);
    expect(tiltToReach(-0.4)).toBeGreaterThan(0.3);
    for (const r of [0.2, 0.5, 0.9]) expect(tiltToReach(reachToTilt(r))).toBeCloseTo(r);
  });

  it('turns a marshmallow golden and finishes it once it is held out for a second', () => {
    const c = calm();
    const events = hold(c, 0.7, () => (c.roasts[0]?.brown ?? 0) >= 0.7);
    expect(events.map((e) => e.kind)).toContain('gold');
    expect(doneness(c.roasts[0]!)).toBe('golden');
    const out = hold(c, 0, (e) => e.some((x) => x.kind === 'golden'), 3);
    expect(out.map((e) => e.kind)).toContain('golden');
    expect(c.golden).toBe(1);
    expect(c.roasts[0]?.golden).toBe(1);
    // A new one goes on the stick.
    const fresh = hold(c, 0, (e) => e.some((x) => x.kind === 'fresh'), 2);
    expect(fresh.map((e) => e.kind)).toContain('fresh');
    expect(c.roasts[0]?.brown).toBe(0);
  });

  it('browns faster the closer it is, and not at all held out', () => {
    const rate = (reach: number) => {
      const c = calm();
      hold(c, reach, () => false, 2);
      return c.roasts[0]?.brown ?? 0;
    };
    expect(rate(0)).toBe(0);
    expect(rate(0.75)).toBeGreaterThan(rate(0.5));
    expect(rate(0.5)).toBeGreaterThan(rate(0.3));
  });

  it("doesn't finish a pale one, and an overdone one doesn't count", () => {
    const c = calm();
    hold(c, 0.6, () => (c.roasts[0]?.brown ?? 0) >= 0.3);
    const pale = hold(c, 0, () => false, 2);
    expect(pale.map((e) => e.kind)).not.toContain('golden');
    expect(c.roasts[0]?.phase).toBe('roast');
    hold(c, 0.7, () => (c.roasts[0]?.brown ?? 0) >= 0.95);
    const late = hold(c, 0, (e) => e.length > 0, 3);
    expect(late.map((e) => e.kind)).toEqual(['toasty']);
    expect(c.golden).toBe(0);
    expect(c.roasts[0]?.toasty).toBe(1);
  });

  it('catches fire deep in the flames; a quick flick blows it out, a slow pull lets it burn', () => {
    const c = calm();
    const lit = hold(c, 1, (e) => e.some((x) => x.kind === 'fire'), 5);
    expect(lit.map((e) => e.kind)).toContain('fire');
    expect(c.roasts[0]?.brown).toBeLessThan(SMORES.goldLo);
    const blown = hold(c, 0, (e) => e.length > 0, 1);
    expect(blown.map((e) => e.kind)).toEqual(['blown']);
    expect(c.roasts[0]?.charred).toBe(1);

    const d = calm();
    hold(d, 1, (e) => e.some((x) => x.kind === 'fire'), 5);
    const slow: RoastEvent[] = [];
    let reach = 1;
    for (let t = 0; t < SMORES.burnFor + 1 && !slow.length; t += DT) {
      reach = Math.max(0, reach - 0.5 * DT);
      slow.push(...stepCampfire(d, DT, [reach]));
    }
    expect(slow.map((e) => e.kind)).toEqual(['dropped']);
    expect(d.roasts[0]?.charred).toBe(1);
  });

  it('plans gusts that flare up the flames, mostly toward one side', () => {
    for (let seed = 1; seed < 30; seed++) {
      const gusts = planGusts(createRng(seed), 4);
      expect(gusts.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < gusts.length; i++) {
        const g = gusts[i]!;
        expect(g.at).toBeGreaterThanOrEqual(SMORES.firstGust);
        expect(g.at).toBeLessThan(SMORES.lastGust);
        if (i > 0) expect(g.at).toBeGreaterThan(gusts[i - 1]!.at + gusts[i - 1]!.length);
      }
    }
    expect(planGusts(createRng(3), 4).length).toBeGreaterThan(planGusts(createRng(3), 1).length);
    const g = { at: 10, length: 2, angle: seatAngle(0, 4), strength: 1 };
    expect(flareAt([g], 9, g.angle)).toBe(0);
    expect(flareAt([g], 11, seatAngle(0, 4))).toBeGreaterThan(flareAt([g], 11, seatAngle(3, 4)));
    expect(flareAt([g], 11, seatAngle(3, 4))).toBeGreaterThan(0);
    // A flare reaches a marshmallow in the heat, never one held out.
    expect(effectiveReach(0.6, 1)).toBeCloseTo(0.6 + SMORES.flare);
    expect(effectiveReach(0.1, 1)).toBe(0.1);
  });

  it('sets the goal by group size and caps the result', () => {
    expect(goalFor(1)).toBe(5);
    expect(goalFor(2)).toBe(5);
    expect(goalFor(3)).toBe(8);
    expect(goalFor(4)).toBe(8);
    expect(heatFor(1)).toBeGreaterThan(heatFor(4));
    const c = newCampfire(createRng(2), 3);
    c.golden = 4;
    expect(smoresCoop(c)).toBe(0.5);
    c.golden = 12;
    expect(smoresCoop(c)).toBe(1);
  });

  it('counts a golden one already out of the fire when time is up', () => {
    const c = calm();
    hold(c, 0.7, () => (c.roasts[0]?.brown ?? 0) >= 0.7);
    hold(c, 0, () => false, 0.3);
    expect(finishCampfire(c).map((e) => e.kind)).toEqual(['golden']);
    expect(c.golden).toBe(1);
  });

  it('lets sharp computer groups make every s’more and average ones most of them', () => {
    const avg = (players: number, skill: number) => {
      let sum = 0;
      const games = 60;
      for (let seed = 1; seed <= games; seed++) {
        const rng = createRng(seed * 7 + players);
        const c = newCampfire(rng, players);
        const cpus = c.roasts.map(() => newSmoresCpu(skill, rng));
        while (c.time < SMORES.duration) {
          const targets = cpus.map((cpu, i) => tiltToReach(cpuSmoresTilt(c, i, cpu, skill, rng, DT)));
          stepCampfire(c, DT, targets);
        }
        finishCampfire(c);
        sum += smoresCoop(c);
      }
      return sum / games;
    };
    for (let players = 1; players <= 4; players++) {
      const mid = avg(players, 0.5);
      expect(mid).toBeGreaterThan(0.65);
      expect(mid).toBeLessThan(0.87);
      expect(avg(players, 1)).toBeGreaterThan(0.95);
    }
  });
});
