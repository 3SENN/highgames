import { describe, expect, it } from 'vitest';
import {
  type Beam,
  type Bunny,
  CORNERS,
  NIGHT,
  type Night,
  type TorchCpu,
  aimToFloor,
  cpuTorch,
  crowd,
  inDark,
  isOver,
  newNight,
  newTorchCpu,
  nightCoop,
  planNight,
  slept,
  stepNight,
  toBed,
} from '../src/game/minigames/nightlight';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

/** A night with no planned dust bunnies and one placed by hand. */
function oneBunny(players = 1, at = { x: -6, z: 0 }): { night: Night; bunny: Bunny } {
  const night = newNight(createRng(1), players);
  night.plan = [];
  const corner = 4;
  const home = CORNERS[corner] as { x: number; z: number };
  const bunny: Bunny = { id: 1, corner, hx: home.x, hz: home.z, x: at.x, z: at.z, state: 'creep', light: 0, lit: false, rest: 0, speed: 1, phase: 0, size: 1 };
  night.bunnies.push(bunny);
  return { night, bunny };
}

function simulate(players: number, skill: number, seed: number): Night {
  const rng = createRng(seed);
  const night = newNight(rng, players);
  const cpus: TorchCpu[] = Array.from({ length: players }, (_, i) => newTorchCpu(i, players));
  while (!isOver(night)) {
    const beams = cpus.map((c, i) => {
      const taken = new Set(cpus.filter((o, j) => j !== i && o.target !== null).map((o) => o.target as number));
      return cpuTorch(c, night, skill, rng, DT, taken);
    });
    stepNight(night, DT, beams, rng);
  }
  return night;
}

describe('night light', () => {
  it('plans more dust bunnies for more torches, from every corner, closer together as the night goes on', () => {
    for (let seed = 1; seed < 20; seed++) {
      const four = planNight(createRng(seed), 4);
      const one = planNight(createRng(seed), 1);
      expect(four.length).toBeGreaterThan(one.length);
      expect(new Set(four.map((s) => s.corner)).size).toBe(CORNERS.length);
      for (const s of four) expect(s.at).toBeLessThanOrEqual(NIGHT.last);
      const gaps = four.slice(1).map((s, i) => s.at - (four[i] as { at: number }).at);
      const early = gaps.slice(0, 4).reduce((a, b) => a + b, 0);
      const late = gaps.slice(-4).reduce((a, b) => a + b, 0);
      expect(late).toBeLessThan(early);
      expect((four[four.length - 1]?.speed ?? 0) > (four[0]?.speed ?? 0)).toBe(true);
    }
    expect(crowd(4)).toBe(1);
    expect(crowd(1)).toBeLessThan(crowd(2));
  });

  it('points the torch at the floor and keeps it in the room', () => {
    expect(aimToFloor(0, 0)).toEqual({ x: 0, z: 0 });
    expect(aimToFloor(1, 1)).toEqual({ x: NIGHT.halfW, z: -NIGHT.halfD });
    expect(aimToFloor(-0.5, -0.5).x).toBeCloseTo(-NIGHT.aimX / 2);
    expect(toBed(0, 0).d).toBe(0);
    expect(toBed(NIGHT.bedW + 2, 0).d).toBeCloseTo(2);
  });

  it('lets an unlit dust bunny creep up and tickle the friend, and three tickles wake them', () => {
    const { night } = oneBunny();
    let tickled = 0;
    for (let i = 0; i < 60 * 10 && !tickled; i++) tickled += stepNight(night, DT, [], createRng(2)).tickled.length;
    expect(tickled).toBe(1);
    expect(night.hearts).toBe(NIGHT.hearts - 1);
    expect(night.bunnies).toHaveLength(0);
    night.hearts = 1;
    night.bunnies.push({ ...(oneBunny().bunny as Bunny), x: NIGHT.bedW + 0.1, z: 0 });
    const r = stepNight(night, DT, [], createRng(2));
    expect(r.woke).toBe(true);
    expect(night.wokeAt).toBeCloseTo(night.time);
    expect(isOver(night)).toBe(true);
    expect(nightCoop(night)).toBeCloseTo(((1 - NIGHT.wokeBonus) * night.time) / NIGHT.duration);
  });

  it('freezes a dust bunny in the light and sends it home, faster with two torches', () => {
    const time = (beams: Beam[]) => {
      const { night, bunny } = oneBunny(2);
      const rng = createRng(3);
      let t = 0;
      for (let i = 0; i < 200; i++) {
        const before = { x: bunny.x, z: bunny.z };
        const r = stepNight(night, DT, beams, rng);
        t += DT;
        if (r.scared.length) {
          expect(r.scared[0]?.by).toEqual(beams.map((_, k) => k));
          return t;
        }
        expect(bunny.x).toBe(before.x);
        expect(bunny.lit).toBe(true);
      }
      return Infinity;
    };
    const one = time([{ x: -6, z: 0, on: true }]);
    const two = time([
      { x: -6, z: 0, on: true },
      { x: -5.8, z: 0.2, on: true },
    ]);
    expect(one).toBeCloseTo(NIGHT.scare, 1);
    expect(two).toBeLessThan(one * 0.6);
    // A torch that isn't shining does nothing.
    const { night, bunny } = oneBunny();
    stepNight(night, DT, [{ x: bunny.x, z: bunny.z, on: false }], createRng(1));
    expect(bunny.lit).toBe(false);
  });

  it('scurries home after a fright, hides a while and peeks out again', () => {
    const { night, bunny } = oneBunny(1);
    const rng = createRng(4);
    let scared = false;
    for (let i = 0; i < 60 && !scared; i++) scared = stepNight(night, DT, [{ x: -6, z: 0, on: true }], rng).scared.length > 0;
    expect(bunny.state).toBe('flee');
    expect(night.shooed).toEqual([1]);
    let home = false;
    let back = false;
    for (let i = 0; i < 60 * 20 && !back; i++) {
      const r = stepNight(night, DT, [], rng);
      home ||= r.home.length > 0;
      back = r.back.length > 0;
    }
    expect(home).toBe(true);
    expect(back).toBe(true);
    expect(bunny.state).toBe('creep');
    expect(bunny.speed).toBeGreaterThan(1);
  });

  it('cannot light a dust bunny still in the dark of its corner', () => {
    const home = CORNERS[0] as { x: number; z: number };
    const { night, bunny } = oneBunny(1, home);
    bunny.hx = home.x;
    bunny.hz = home.z;
    expect(inDark(bunny)).toBe(true);
    stepNight(night, DT, [{ x: home.x, z: home.z, on: true }], createRng(5));
    expect(bunny.lit).toBe(false);
  });

  it('scores time asleep with the hearts left as a bonus', () => {
    const night = newNight(createRng(6), 4);
    night.time = NIGHT.duration;
    expect(nightCoop(night)).toBe(1);
    night.hearts = 1;
    expect(nightCoop(night)).toBeCloseTo(1 - NIGHT.wokeBonus + NIGHT.wokeBonus / 3);
    night.hearts = 0;
    night.wokeAt = 20;
    expect(slept(night)).toBe(20);
    expect(nightCoop(night)).toBeCloseTo((1 - NIGHT.wokeBonus) / 2);
  });

  it('lets sharp computer players keep the friend asleep and average ones get most of the way', () => {
    const avg = (players: number, skill: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 40; seed++) sum += nightCoop(simulate(players, skill, seed * 7 + players));
      return sum / 40;
    };
    expect(avg(4, 1)).toBeGreaterThan(0.95);
    const mid = avg(4, 0.5);
    expect(mid).toBeGreaterThan(0.65);
    expect(mid).toBeLessThan(0.87);
    for (const players of [1, 2, 3]) {
      expect(avg(players, 1)).toBeGreaterThan(0.85);
      const v = avg(players, 0.5);
      expect(v).toBeGreaterThan(0.6);
      expect(v).toBeLessThan(0.97);
    }
  });
});
