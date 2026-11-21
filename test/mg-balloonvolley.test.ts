import { describe, expect, it } from 'vitest';
import {
  type Ball,
  type Court,
  type Stick,
  VOLLEY,
  bop,
  bopVelocity,
  canReach,
  cpuThink,
  isOver,
  movePlayer,
  newCourt,
  newMind,
  predict,
  serve,
  stepBall,
  stepCourt,
  volleyScores,
} from '../src/game/minigames/balloonvolley';
import { createRng } from '../src/game/rng';

const TEAMS = [
  [0, 1],
  [2, 3],
];
const still: Stick[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
const ballAt = (x: number, y: number, z = 0, vx = 0, vy = 0, vz = 0): Ball => ({ x, y, z, vx, vy, vz });

/** A live rally with the balloon placed by hand. */
function rally(ball: Ball): Court {
  const c = newCourt(TEAMS, 4, 0);
  serve(c, 0);
  Object.assign(c.ball, ball);
  return c;
}

/** Steps until the balloon touches something or `seconds` pass; returns what it touched. */
function fly(b: Ball, seconds: number): 'floor' | 'couch' | null {
  for (let t = 0; t < seconds; t += VOLLEY.step) {
    const hit = stepBall(b, VOLLEY.step);
    if (hit) return hit;
  }
  return null;
}

describe('balloon volley physics', () => {
  it('floats down slowly: a gentle top speed, and two metres take more than a second', () => {
    const b = ballAt(-2.5, 2.9);
    let t = 0;
    while (b.y > 0.9 && t < 5) {
      stepBall(b, VOLLEY.step);
      t += VOLLEY.step;
    }
    expect(t).toBeGreaterThan(1);
    expect(-b.vy).toBeLessThan(VOLLEY.gravity / VOLLEY.drag + 0.01);
  });

  it('bounces off the back of the couch when it comes over too low', () => {
    const b = ballAt(-1.2, 1.0, 0, 3, 0.5);
    expect(fly(b, 2)).toBe('couch');
    expect(b.x).toBeLessThan(0);
    expect(b.vx).toBeLessThan(0);
  });

  it('sails over the couch when it is high enough', () => {
    const b = ballAt(-1.5, 2.2, 0, 2.5, 1);
    let crossed = false;
    for (let t = 0; t < 3 && !crossed; t += VOLLEY.step) {
      expect(stepBall(b, VOLLEY.step)).not.toBe('couch');
      crossed = b.x > VOLLEY.backX + VOLLEY.radius;
    }
    expect(crossed).toBe(true);
  });

  it('never balances on top of the couch', () => {
    const b = ballAt(0, 2, 0, 0, -0.5);
    let side = 0;
    for (let t = 0; t < 6; t += VOLLEY.step) {
      if (stepBall(b, VOLLEY.step) === 'floor') {
        side = Math.sign(b.x);
        break;
      }
    }
    expect(side).not.toBe(0);
  });

  it('stays inside the room: walls and ceiling bounce it back', () => {
    const b = ballAt(3.5, 3, 1, 6, 6, 6);
    for (let t = 0; t < 1; t += VOLLEY.step) {
      stepBall(b, VOLLEY.step);
      expect(Math.abs(b.x)).toBeLessThanOrEqual(VOLLEY.half);
      expect(Math.abs(b.z)).toBeLessThanOrEqual(VOLLEY.depth);
      expect(b.y).toBeLessThanOrEqual(VOLLEY.ceiling);
    }
  });
});

describe('balloon volley rules', () => {
  it('gives the other team a point when the balloon touches the floor, and serves to the side that lost it', () => {
    const c = rally(ballAt(-2.5, VOLLEY.radius + 0.002, 0, 0, -1));
    const events = stepCourt(c, still);
    expect(events).toContainEqual({ t: 'floor', side: 0, live: true });
    expect(c.score).toEqual([0, 1]);
    expect(c.live).toBe(false);
    // The serve floats down on the left, after a short pause.
    let served = false;
    for (let t = 0; t < VOLLEY.serveDelay + 0.1 && !served; t += VOLLEY.step) served = stepCourt(c, still).some((e) => e.t === 'serve');
    expect(served).toBe(true);
    expect(c.ball.x).toBeLessThan(0);
  });

  it('counts the seat cushions as your side’s floor', () => {
    const c = rally(ballAt(0.6, VOLLEY.seatH + VOLLEY.radius + 0.002, 0, 0, -1));
    stepCourt(c, still);
    expect(c.score).toEqual([1, 0]);
  });

  it('needs you close enough and within reach in height', () => {
    const c = rally(ballAt(-1.8, 1.5, -0.6));
    const p = c.players[0];
    if (!p) throw new Error('no player');
    p.x = -1.8;
    p.z = 0.6;
    expect(canReach(p, c.ball)).toBe(false);
    expect(bop(c, 0, { x: 0, y: 0 })?.t).toBe('whiff');
    p.z = -0.2;
    c.time += VOLLEY.cooldown;
    expect(canReach(p, c.ball)).toBe(true);
    expect(bop(c, 0, { x: 0, y: 0 })?.t).toBe('bop');
    expect(c.ball.vx).toBeGreaterThan(0);
    expect(c.ball.vy).toBeGreaterThan(0);
    c.ball.y = VOLLEY.high + 0.1;
    expect(canReach(p, c.ball)).toBe(false);
  });

  it('has a cooldown between bops, whiffs included', () => {
    const c = rally(ballAt(-1.8, 1.5, -0.65));
    expect(bop(c, 0, { x: 0, y: 0 })?.t).toBe('bop');
    c.time += VOLLEY.cooldown - 0.05;
    expect(bop(c, 0, { x: 0, y: 0 })).toBeNull();
    c.time += 0.05;
    expect(bop(c, 0, { x: 0, y: 0 })).not.toBeNull();
  });

  it('judges reach on where the balloon was when the button was pressed', () => {
    const c = rally(ballAt(-1.8, 1.5, 1.6));
    const seen = ballAt(-1.8, 1.5, -0.6);
    expect(bop(c, 0, { x: 0, y: 0 }, seen)?.t).toBe('bop');
  });

  it('lets a team touch it three times; the fourth gives the other team the point', () => {
    const c = rally(ballAt(-1.8, 1.5, -0.65));
    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      Object.assign(c.ball, ballAt(-1.8, 1.5, -0.65));
      const e = bop(c, 0, { x: -1, y: 0 });
      results.push(e?.t ?? 'none');
      if (e?.t === 'bop') expect(e.touches).toBe(i + 1);
      c.time += VOLLEY.cooldown;
    }
    expect(results).toEqual(['bop', 'bop', 'bop', 'fault']);
    expect(c.score).toEqual([0, 1]);
    expect(c.serveSide).toBe(0);
  });

  it('starts the count again once the balloon has gone over', () => {
    const c = rally(ballAt(-1.8, 1.5, -0.65));
    bop(c, 0, { x: 0, y: 0 });
    expect(c.touches).toBe(1);
    Object.assign(c.ball, ballAt(-0.005, 2.5, 0, 2, 0));
    const events = stepCourt(c, still);
    expect(events).toContainEqual({ t: 'over', to: 1 });
    expect(c.touchTeam).toBeNull();
    expect(c.touches).toBe(0);
  });

  it('turns a high bop near the couch into a spike that goes down; a high bop at the back does not', () => {
    const c = rally(ballAt(-1.6, 2.2, 0));
    const p = c.players[0];
    if (!p) throw new Error('no player');
    const near = bopVelocity(ballAt(-1.6, 2.2), p, { x: 0, y: 0 });
    expect(near.spike).toBe(true);
    expect(near.vy).toBeLessThan(0);
    expect(near.vx).toBeGreaterThan(3);
    const back = bopVelocity(ballAt(-3.4, 2.2), p, { x: 0, y: 0 });
    expect(back.spike).toBe(false);
    expect(back.vy).toBeGreaterThan(0);
    const low = bopVelocity(ballAt(-2, 0.9), p, { x: 0, y: 0 });
    expect(low.vy).toBeGreaterThan(back.vy);
    // Pulling the stick back keeps it short, pushing sends it deeper.
    expect(bopVelocity(ballAt(-2, 1.4), p, { x: -1, y: 0 }).vx).toBeLessThan(bopVelocity(ballAt(-2, 1.4), p, { x: 1, y: 0 }).vx);
    // A spike from close to the couch clears it.
    const b = ballAt(-1.6, 2.2, 0, near.vx, near.vy, near.vz);
    expect(fly(b, 3)).toBe('floor');
    expect(b.x).toBeGreaterThan(0);
  });

  it('keeps players on their own side of the couch and on the rug', () => {
    const c = newCourt(TEAMS, 4, 0);
    const left = c.players[0];
    const right = c.players[3];
    if (!left || !right) throw new Error('no player');
    for (let i = 0; i < 400; i++) {
      movePlayer(left, { x: 1, y: 1 }, VOLLEY.step);
      movePlayer(right, { x: 1, y: -1 }, VOLLEY.step);
    }
    expect(left.x).toBeCloseTo(-VOLLEY.keepOut);
    expect(left.z).toBeLessThan(-VOLLEY.depth + 0.3);
    expect(right.x).toBeCloseTo(VOLLEY.half - VOLLEY.wall);
    expect(right.z).toBeGreaterThan(VOLLEY.depth - 0.3);
    // Top speed.
    expect(Math.hypot(left.vx, left.vz)).toBeLessThanOrEqual(VOLLEY.speed + 1e-6);
  });

  it('ends at five points or after forty seconds, and gives partners the same score', () => {
    const c = newCourt(TEAMS, 4, 0);
    expect(isOver(c)).toBe(false);
    c.score = [5, 3];
    expect(isOver(c)).toBe(true);
    expect(volleyScores(c, TEAMS, 4)).toEqual([5, 5, 3, 3]);
    c.score = [2, 2];
    c.time = VOLLEY.duration;
    expect(isOver(c)).toBe(true);
  });

  it('predicts where the balloon comes down on a side', () => {
    const b = ballAt(-2, 1.5, 0, 2.5, 3);
    const land = predict(b, 1, 1.5);
    expect(land).not.toBeNull();
    expect(land?.x).toBeGreaterThan(0);
    expect(predict(b, 0, 1.5)).toBeNull();
  });
});

describe('balloon volley computer players', () => {
  /** A whole game between two computer pairs; returns the score and some numbers about it. */
  function play(skills: number[], seed: number) {
    const rng = createRng(seed);
    const c = newCourt(TEAMS, 4, seed % 2);
    const minds = skills.map((s) => newMind(s));
    let bops = 0;
    while (!isOver(c)) {
      const sticks = [0, 1, 2, 3].map((p) => cpuThink(c, p, minds[p] ?? newMind(0.5), rng, { p: p % 2 === 0 ? p + 1 : p - 1, human: false }));
      sticks.forEach((s, p) => {
        if (s.a && bop(c, p, s)?.t === 'bop') bops += 1;
      });
      stepCourt(c, sticks);
    }
    return { score: c.score, time: c.time, bops };
  }

  it('sharp pairs beat sleepy pairs almost always, and average pairs usually', () => {
    let sharpWins = 0;
    let midWins = 0;
    let midLosses = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const a = play([1, 1, 0, 0], seed);
      if ((a.score[0] ?? 0) > (a.score[1] ?? 0)) sharpWins += 1;
      const b = play([0.55, 0.55, 0.1, 0.1], seed);
      if ((b.score[0] ?? 0) > (b.score[1] ?? 0)) midWins += 1;
      if ((b.score[0] ?? 0) < (b.score[1] ?? 0)) midLosses += 1;
    }
    expect(sharpWins).toBeGreaterThanOrEqual(20);
    expect(midWins).toBeGreaterThan(midLosses);
  });

  it('plays real rallies with a handful of points a game', () => {
    let points = 0;
    let bops = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const g = play([0.55, 0.55, 0.55, 0.55], seed);
      points += (g.score[0] ?? 0) + (g.score[1] ?? 0);
      bops += g.bops;
      expect(g.time).toBeLessThanOrEqual(VOLLEY.duration + VOLLEY.step);
    }
    // Every point takes a few bops; there are a few points a game.
    expect(points / 24).toBeGreaterThan(2);
    expect(points / 24).toBeLessThan(9);
    expect(bops / points).toBeGreaterThan(2.5);
  });

  it('waits at home while the balloon is on the other side, and walks under it on its own side', () => {
    const c = rally(ballAt(2.5, 2.5, 0, 0, 0));
    const mind = newMind(1);
    const rng = createRng(1);
    const p = c.players[1];
    if (!p) throw new Error('no player');
    p.x = -3.5;
    p.z = 1.2;
    const s = cpuThink(c, 1, mind, rng, { p: 0, human: false });
    expect(s.a).toBe(false);
    // Comes down on its side, towards the back: it heads there.
    const d = rally(ballAt(-3, 2.6, 0, 0, 0));
    const q = d.players[1];
    if (!q) throw new Error('no player');
    q.x = -2.4;
    q.z = 1;
    const m2 = newMind(1);
    let s2 = cpuThink(d, 1, m2, rng, { p: 0, human: false });
    for (let i = 0; i < 60; i++) {
      d.time += VOLLEY.step;
      s2 = cpuThink(d, 1, m2, rng, { p: 0, human: false });
    }
    expect(s2.x).toBeLessThan(0);
    expect(s2.y).toBeGreaterThan(0);
  });
});
