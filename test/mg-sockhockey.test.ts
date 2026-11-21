import { describe, expect, it } from 'vitest';
import {
  type Brain,
  IDLE,
  type Rink,
  SOCK,
  type Stick,
  advance,
  cpuStick,
  isOver,
  newBrain,
  newRink,
  pushLine,
  reachable,
  sockScores,
  winner,
} from '../src/game/minigames/sockhockey';
import { createRng } from '../src/game/rng';

const PAIRS = [
  [0, 1],
  [2, 3],
];

/** A rink with everyone parked out of the way in the corners' shadows, so a test can set up one skater. */
function quiet(): Rink {
  const r = newRink(PAIRS, 4);
  r.skaters.forEach((s, i) => {
    s.x = i % 2 ? 3.5 : -3.5;
    s.z = i < 2 ? -1.6 : 1.6;
  });
  return r;
}

function run(r: Rink, seconds: number, sticks: (t: number) => Stick[] = () => []): void {
  const frames = Math.round(seconds * 60);
  for (let f = 0; f < frames && !isOver(r); f++) advance(r, sticks(f / 60), 1 / 60);
}

const push = (x: number, y: number, a = false): Stick => ({ x, y, a });

/** CPU against CPU; returns the winning team (-1 for a draw) and the score. */
function cpuGame(seed: number, skills: readonly number[]): { win: number; score: [number, number] } {
  const rng = createRng(seed);
  const r = newRink(PAIRS, 4);
  const brains: Brain[] = skills.map((s) => newBrain(s, rng));
  while (!isOver(r)) advance(r, brains.map((b, i) => cpuStick(r, i, b, rng)), 1 / 60);
  return { win: winner(r), score: [...r.score] };
}

/** Team a's skill against team b's over many games, swapping ends every game. */
function series(a: number, b: number, games = 40): { wins: number; losses: number; goalsFor: number; goalsAgainst: number } {
  const out = { wins: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  for (let g = 0; g < games; g++) {
    const swap = g % 2 === 1;
    const { win, score } = cpuGame(1000 + g * 37, swap ? [b, b, a, a] : [a, a, b, b]);
    const me = swap ? 1 : 0;
    if (win === me) out.wins++;
    else if (win === 1 - me) out.losses++;
    out.goalsFor += score[me];
    out.goalsAgainst += score[1 - me];
  }
  return out;
}

describe('sock hockey: sliding about', () => {
  it('lines the teams up at their own ends, partners apart', () => {
    const r = newRink(PAIRS, 4);
    expect(r.skaters.map((s) => s.team)).toEqual([0, 0, 1, 1]);
    for (const s of r.skaters) expect(Math.sign(s.x)).toBe(s.team === 0 ? -1 : 1);
    expect(r.skaters[0]?.x).toBeCloseTo(-(r.skaters[2]?.x ?? 0));
    expect(r.puck).toMatchObject({ x: 0, z: 0, vx: 0, vz: 0 });
  });

  it('copes with a team of one', () => {
    const r = newRink([[0, 1], [2]], 3);
    expect(r.skaters).toHaveLength(3);
    expect(r.skaters[2]?.team).toBe(1);
    expect(r.skaters[2]?.z).toBe(0);
    run(r, 1);
    expect(sockScores(r)).toHaveLength(3);
  });

  it('pushes off with the stick and keeps gliding after letting go (socks on wood)', () => {
    const r = quiet();
    const s = r.skaters[0];
    if (!s) throw new Error('no skater');
    s.x = -4;
    s.z = 0;
    run(r, 0.6, () => [push(1, 0)]);
    const top = s.vx;
    expect(top).toBeGreaterThan(3.5);
    expect(top).toBeLessThanOrEqual(SOCK.maxSpeed + 1e-6);
    const at = s.x;
    run(r, 0.5);
    expect(s.x - at).toBeGreaterThan(1.2); // still sliding
    expect(s.vx).toBeLessThan(top);
    expect(s.vx).toBeGreaterThan(top * 0.5);
  });

  it('turns up on the phone as away from the audience (-z)', () => {
    const r = quiet();
    const s = r.skaters[0];
    if (!s) throw new Error('no skater');
    s.x = 0;
    s.z = 1;
    run(r, 0.3, () => [push(0, 1)]);
    expect(s.vz).toBeLessThan(-1);
  });

  it('ignores a stick resting in the deadzone', () => {
    const r = quiet();
    const s = r.skaters[0];
    if (!s) throw new Error('no skater');
    const x = s.x;
    run(r, 0.5, () => [push(0.1, 0.05)]);
    expect(s.x).toBe(x);
  });

  it('keeps everyone in the hall, bouncing softly off the walls', () => {
    const r = quiet();
    run(r, 3, () => [push(1, 1), push(-1, -1), push(1, -1), push(-1, 1)]);
    for (const s of r.skaters) {
      expect(reachable(s.x, s.z, 1e-6)).toBe(true);
    }
  });

  it('bumps skaters off each other', () => {
    const r = quiet();
    const [a, b] = r.skaters;
    if (!a || !b) throw new Error('no skaters');
    a.x = -1;
    a.z = 0;
    b.x = 0.5;
    b.z = 0;
    b.team = 0;
    a.vx = 4;
    run(r, 0.4);
    expect(b.vx).toBeGreaterThan(1);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * SOCK.bodyR - 1e-6);
  });
});

describe('sock hockey: the socks', () => {
  /** Skater 0 slides into socks lying just ahead, with or without a Slide; returns the socks' speed. */
  function hit(slide: boolean): number {
    const r = quiet();
    const s = r.skaters[0];
    if (!s) throw new Error('no skater');
    s.x = -2;
    s.z = 0;
    s.vx = 3;
    r.puck.x = -1.2;
    let fastest = 0;
    let first = true;
    run(r, 0.4, () => {
      const a = slide && first;
      first = false;
      fastest = Math.max(fastest, Math.hypot(r.puck.vx, r.puck.vz));
      return [push(1, 0, a)];
    });
    return fastest;
  }

  it('a bump pushes them on; a slide sends them flying', () => {
    const bump = hit(false);
    const slide = hit(true);
    expect(bump).toBeGreaterThan(2);
    expect(slide).toBeGreaterThan(bump * 1.4);
    expect(slide).toBeLessThanOrEqual(SOCK.puckMax + 1e-6);
  });

  it('lets you slide once a second', () => {
    const r = quiet();
    const s = r.skaters[0];
    if (!s) throw new Error('no skater');
    let presses = [0, 0.5, 0.9, 1.05];
    run(r, 1.5, (t) => {
      const due = presses.length > 0 && t >= (presses[0] ?? Infinity);
      if (due) presses = presses.slice(1);
      return [push(1, 0, due)];
    });
    // 0 slides; 0.5 is ignored; 0.9 waits (pressed just early) and goes at 1.0; 1.05 is too soon after that.
    expect(s.dashes).toBe(2);
  });

  it('a press counts once per frame, however many steps the frame takes', () => {
    const r = quiet();
    const ev = advance(r, [push(1, 0, true)], 0.5);
    expect(ev.steps).toBe(60);
    expect(ev.dashes).toEqual([0]);
  });

  it('runs at 120 steps a second and caps long frames', () => {
    const r = quiet();
    expect(advance(r, [], 0.25).steps).toBe(30);
    expect(advance(r, [], 3).steps).toBe(Math.round(0.6 / SOCK.step));
  });

  it('scores through the basket’s mouth and bounces off the wall beside it', () => {
    const r = quiet();
    r.puck.x = 4;
    r.puck.z = 0.3;
    r.puck.vx = 6;
    r.puck.touch[0] = { seat: 0, at: 0 };
    r.puck.last = 0;
    let goal = null as ReturnType<typeof advance>['goal'];
    for (let f = 0; f < 60 && !goal; f++) goal = advance(r, [], 1 / 60).goal;
    expect(goal).toMatchObject({ team: 0, by: 0, own: false, side: 1 });
    expect(r.score).toEqual([1, 0]);
    expect(r.skaters[0]?.goals).toBe(1);

    const wide = quiet();
    wide.puck.x = 4;
    wide.puck.z = 1.4;
    wide.puck.vx = 6;
    run(wide, 1);
    expect(wide.score).toEqual([0, 0]);
    expect(wide.puck.vx).toBeLessThan(0);
  });

  it('gives a deflected shot to the shooter, and calls it an own basket otherwise', () => {
    const shot = quiet();
    shot.time = 5;
    shot.puck = { x: -5.7, z: 0, vx: -4, vz: 0, last: 1, touch: [{ seat: 1, at: 4.9 }, { seat: 2, at: 4 }] };
    run(shot, 0.3);
    expect(shot.score).toEqual([0, 1]);
    expect(shot.skaters[2]?.goals).toBe(1);
    expect(shot.skaters[1]?.owns).toBe(0);

    const oops = quiet();
    oops.time = 5;
    oops.puck = { x: -5.7, z: 0, vx: -4, vz: 0, last: 1, touch: [{ seat: 1, at: 4.9 }, null] };
    run(oops, 0.3);
    expect(oops.score).toEqual([0, 1]);
    expect(oops.skaters[1]?.owns).toBe(1);
  });

  it('never lets the socks wedge in a corner', () => {
    const r = quiet();
    r.puck.x = 5.9;
    r.puck.z = 1.9;
    r.puck.vx = 3;
    r.puck.vz = 3;
    run(r, 0.1);
    const cx = SOCK.hall.x - SOCK.corner;
    const cz = SOCK.hall.z - SOCK.corner;
    expect(Math.hypot(r.puck.x - cx, r.puck.z - cz)).toBeLessThanOrEqual(SOCK.corner - SOCK.puckR + 1e-6);
  });

  it('finds a way to push socks lying against a wall', () => {
    for (const [px, pz] of [
      [-5.8, 1.8],
      [5.8, -1.8],
      [0, 1.8],
      [-5.8, 0],
    ] as const) {
      const { ux, uz } = pushLine(px, pz, 6, 0);
      const back = SOCK.bodyR + SOCK.puckR + 0.35;
      expect(reachable(px - ux * back, pz - uz * back)).toBe(true);
    }
  });
});

describe('sock hockey: the game', () => {
  it('celebrates a goal, then lines everyone up again with new socks in the middle', () => {
    const r = quiet();
    r.puck.x = 5.7;
    r.puck.vx = 5;
    r.puck.touch[0] = { seat: 0, at: 0 };
    run(r, 0.2);
    expect(r.phase).toBe('goal');
    run(r, SOCK.cheer);
    expect(r.phase).toBe('drop');
    expect(r.puck).toMatchObject({ x: 0, z: 0, vx: 0, vz: 0, last: null });
    run(r, SOCK.drop + 0.05);
    expect(r.phase).toBe('play');
    for (const s of r.skaters) {
      expect(s.x).toBeCloseTo(s.homeX, 1);
      expect(s.z).toBeCloseTo(s.homeZ, 1);
    }
  });

  it('ends on the third goal', () => {
    const r = quiet();
    r.score = [2, 1];
    r.puck.x = 5.7;
    r.puck.vx = 5;
    run(r, 0.2);
    expect(r.score).toEqual([3, 1]);
    expect(isOver(r)).toBe(false); // the cheer first
    run(r, SOCK.cheer + 0.1);
    expect(isOver(r)).toBe(true);
    expect(winner(r)).toBe(0);
    expect(sockScores(r)).toEqual([3, 3, 1, 1]);
  });

  it('ends when time is up, a draw if level', () => {
    const r = newRink(PAIRS, 4);
    run(r, SOCK.duration + 1, () => [IDLE, IDLE, IDLE, IDLE]);
    expect(isOver(r)).toBe(true);
    expect(r.time).toBeCloseTo(SOCK.duration, 1);
    expect(winner(r)).toBe(-1);
    expect(sockScores(r)).toEqual([0, 0, 0, 0]);
  });
});

describe('sock hockey: computer players', () => {
  it('play a lively game: goals go in, and games finish', () => {
    let goals = 0;
    let goalless = 0;
    for (let g = 0; g < 30; g++) {
      const { score } = cpuGame(500 + g, [0.6, 0.6, 0.6, 0.6]);
      goals += score[0] + score[1];
      if (score[0] + score[1] === 0) goalless++;
    }
    expect(goals / 30).toBeGreaterThan(1.3);
    expect(goalless).toBeLessThan(8);
  });

  it('sharp teams beat sleepy ones nearly every time', () => {
    const s = series(0.9, 0.15);
    expect(s.wins).toBeGreaterThan(s.losses * 4);
    expect(s.goalsFor).toBeGreaterThan(s.goalsAgainst * 2);
  });

  it('an average team is beatable but not hopeless against a sharp one', () => {
    const s = series(0.5, 0.9);
    expect(s.losses).toBeGreaterThan(s.wins);
    expect(s.wins + (40 - s.wins - s.losses) / 2).toBeGreaterThanOrEqual(4); // some wins or draws
    expect(s.goalsFor).toBeGreaterThan(10);
  });

  it('two equal teams are about even, whichever end they defend', () => {
    const s = series(0.6, 0.6, 60);
    expect(Math.abs(s.wins - s.losses)).toBeLessThan(15);
  });
});
