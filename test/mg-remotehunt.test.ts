import { describe, expect, it } from 'vitest';
import {
  type Content,
  HUNT,
  THINGS,
  cpuHunt,
  huntScores,
  isDecoy,
  layRoom,
  liftProgress,
  litPeeks,
  newHuntCpu,
  newSearcher,
  peekPoint,
  planRound,
  roundPoints,
  startCheck,
  stepSearcher,
  thingAt,
  toFloor,
  toPointer,
} from '../src/game/minigames/remotehunt';
import { createRng } from '../src/game/rng';

/** One round played by computer players only. Returns when each found the remote. */
function simRound(seed: number, skills: number[], round = 0) {
  const rng = createRng(seed);
  const things = layRoom(rng);
  const plan = planRound(rng, things, round, []);
  const searchers = skills.map(() => newSearcher());
  const cpus = skills.map(() => newHuntCpu(things.length, rng));
  const shown: (Content | null)[] = things.map(() => null);
  const checks = skills.map(() => 0);
  const dt = 1 / 60;
  let firstAt: number | null = null;
  for (let t = 0; t < HUNT.roundTime; t += dt) {
    const lit = litPeeks(
      cpus.map((c) => ({ x: c.x, z: c.z })),
      things,
      plan,
    );
    skills.forEach((skill, i) => {
      const s = searchers[i]!;
      const out = cpuHunt(cpus[i]!, s, { things, plan, lit, shown }, t, dt, skill, rng);
      if (out.press && startCheck(s, things, out.x, out.z, t) === 'lift') checks[i]!++;
      const ev = stepSearcher(s, things, plan, out.x, out.z, t);
      if (ev?.kind === 'found') {
        shown[ev.thing] = 'remote';
        firstAt ??= t;
      } else if (ev?.kind === 'wrong') {
        shown[ev.thing] = ev.content;
      }
    });
    if (firstAt !== null && t > firstAt + HUNT.grace) break;
    if (searchers.every((s) => s.foundAt !== null)) break;
  }
  return { foundAt: searchers.map((s) => s.foundAt), firstAt, checks };
}

describe("where's the remote", () => {
  it('lays ten things inside the torch area without overlaps', () => {
    for (let seed = 1; seed < 30; seed++) {
      const things = layRoom(createRng(seed));
      expect(things).toHaveLength(THINGS.length);
      things.forEach((a, i) => {
        expect(Math.abs(a.x)).toBeLessThan(HUNT.halfW);
        expect(Math.abs(a.z)).toBeLessThan(HUNT.halfD);
        things.forEach((b, j) => {
          if (j > i) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.r + b.r + 0.15);
        });
      });
    }
  });

  it('maps the pointer onto the floor area and back', () => {
    expect(toFloor(1, 1)).toEqual({ x: HUNT.halfW, z: -HUNT.halfD });
    expect(toFloor(-1, -1)).toEqual({ x: -HUNT.halfW, z: HUNT.halfD });
    const p = toPointer(2, -1.5);
    const f = toFloor(p.x, p.y);
    expect(f.x).toBeCloseTo(2);
    expect(f.z).toBeCloseTo(-1.5);
  });

  it('hides one remote with look-alikes and junk, somewhere new each round', () => {
    const rng = createRng(7);
    const things = layRoom(rng);
    const used: number[] = [];
    for (let round = 0; round < HUNT.rounds; round++) {
      const plan = planRound(rng, things, round, used);
      expect(plan.under.filter((c) => c === 'remote')).toHaveLength(1);
      expect(plan.under[plan.remote]).toBe('remote');
      expect(used).not.toContain(plan.remote);
      expect(plan.under.filter(isDecoy)).toHaveLength(round === 0 ? 2 : 3);
      expect(plan.under.filter((c) => c === 'sock' || c === 'crisps' || c === 'coins')).toHaveLength(3);
      for (const a of plan.angle) expect(Math.abs(a)).toBeLessThanOrEqual(1);
      used.push(plan.remote);
    }
  });

  it('lights up what peeks out only where a beam shines', () => {
    const rng = createRng(3);
    const things = layRoom(rng);
    const plan = planRound(rng, things, 0);
    const i = plan.remote;
    const p = peekPoint(things[i]!, plan.angle[i]!);
    expect(litPeeks([{ x: p.x + 0.5, z: p.z }], things, plan)[i]).toBe(true);
    expect(litPeeks([{ x: p.x + HUNT.beam + 0.2, z: p.z }], things, plan)[i]).toBe(false);
    // Nothing to light under an empty thing.
    plan.under.forEach((c, k) => {
      if (c === 'none') {
        const q = things[k]!;
        expect(litPeeks([{ x: q.x, z: q.z }], things, plan)[k]).toBe(false);
      }
    });
  });

  it('lifts a thing after the beam stays on it, and cancels when the beam wanders off', () => {
    const rng = createRng(11);
    const things = layRoom(rng);
    const plan = planRound(rng, things, 0);
    const remote = things[plan.remote]!;
    expect(thingAt(things, remote.x + remote.r * 0.5, remote.z)).toBe(plan.remote);
    expect(thingAt(things, remote.x + 50, remote.z)).toBeNull();
    const s = newSearcher();
    expect(startCheck(s, things, remote.x + 50, remote.z, 0)).toBe('nothing');
    expect(startCheck(s, things, remote.x, remote.z, 1)).toBe('lift');
    expect(startCheck(s, things, remote.x, remote.z, 1.1)).toBe('ignored');
    expect(stepSearcher(s, things, plan, remote.x, remote.z, 1.3)).toBeNull();
    expect(liftProgress(s, 1.3)).toBeCloseTo(0.5);
    expect(stepSearcher(s, things, plan, remote.x + remote.r + HUNT.keep + 0.1, remote.z, 1.4)).toEqual({ kind: 'cancel', thing: plan.remote });
    expect(s.lifting).toBeNull();
    startCheck(s, things, remote.x, remote.z, 2);
    expect(stepSearcher(s, things, plan, remote.x + 0.3, remote.z, 2 + HUNT.lift)).toEqual({ kind: 'found', thing: plan.remote });
    expect(s.foundAt).toBeCloseTo(2 + HUNT.lift);
    expect(startCheck(s, things, remote.x, remote.z, 3)).toBe('ignored');
  });

  it('makes you wait a second after lifting the wrong thing', () => {
    const rng = createRng(5);
    const things = layRoom(rng);
    const plan = planRound(rng, things, 1);
    const k = plan.under.findIndex(isDecoy);
    const decoy = things[k]!;
    const s = newSearcher();
    startCheck(s, things, decoy.x, decoy.z, 0);
    const ev = stepSearcher(s, things, plan, decoy.x, decoy.z, HUNT.lift);
    expect(ev).toEqual({ kind: 'wrong', thing: k, content: plan.under[k] });
    expect(startCheck(s, things, decoy.x, decoy.z, HUNT.lift + HUNT.wrongWait * 0.5)).toBe('ignored');
    expect(startCheck(s, things, decoy.x, decoy.z, HUNT.lift + HUNT.wrongWait + 0.01)).toBe('lift');
  });

  it('scores 3, 2 and 1 by finishing order and breaks ties on time', () => {
    expect(roundPoints([5.2, null, 3.1, 8, 9])).toEqual([2, 0, 3, 1, 0]);
    expect(roundPoints([null, null])).toEqual([0, 0]);
    const s = huntScores([6, 6, 2], [20, 18, 9]);
    expect(s[1]).toBeGreaterThan(s[0]!);
    expect(s[0]).toBeGreaterThan(s[2]!);
  });

  it('has computer players find the remote most rounds, sharp ones sooner than sleepy ones', () => {
    let sharpFirst = 0;
    let sleepyFirst = 0;
    let sharpFound = 0;
    let sleepyFound = 0;
    let avgFound = 0;
    const rounds = 60;
    for (let seed = 1; seed <= rounds; seed++) {
      const sharp = simRound(seed, [1, 1, 1, 1]);
      const sleepy = simRound(seed, [0, 0, 0, 0]);
      const avg = simRound(seed, [0.5, 0.5, 0.5, 0.5]);
      if (sharp.firstAt !== null) {
        sharpFound++;
        sharpFirst += sharp.firstAt;
      }
      if (sleepy.firstAt !== null) {
        sleepyFound++;
        sleepyFirst += sleepy.firstAt;
      }
      if (avg.firstAt !== null) avgFound++;
    }
    expect(sharpFound).toBeGreaterThan(rounds * 0.95);
    expect(avgFound).toBeGreaterThan(rounds * 0.9);
    expect(sleepyFound).toBeGreaterThan(rounds * 0.7);
    const sharpMean = sharpFirst / sharpFound;
    const sleepyMean = sleepyFirst / sleepyFound;
    expect(sharpMean).toBeLessThan(sleepyMean * 0.8);
    // A sharp torch finds it in a few seconds, not instantly.
    expect(sharpMean).toBeGreaterThan(1.2);
    expect(sharpMean).toBeLessThan(7);
  });

  it('lets a sharp computer player beat sleepy ones most of the time, but not every time', () => {
    let sharpPts = 0;
    let sleepyPts = 0;
    let sharpWins = 0;
    const rounds = 80;
    for (let seed = 1; seed <= rounds; seed++) {
      const r = simRound(seed * 3, [1, 0, 0, 0]);
      const pts = roundPoints(r.foundAt);
      sharpPts += pts[0]!;
      sleepyPts += (pts[1]! + pts[2]! + pts[3]!) / 3;
      if (pts[0] === 3) sharpWins++;
    }
    expect(sharpPts).toBeGreaterThan(sleepyPts * 1.4);
    expect(sharpWins).toBeGreaterThan(rounds * 0.4);
    expect(sharpWins).toBeLessThan(rounds * 0.95);
  });
});
