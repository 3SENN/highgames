import { describe, expect, it } from 'vitest';
import {
  FURNITURE,
  IDLE,
  KEEP,
  NOOKS,
  type Room,
  type Stick,
  advance,
  airflow,
  aimAt,
  cpuStick,
  cpuTilt,
  fanDir,
  isOver,
  keepScores,
  moveBall,
  newBrain,
  newRoom,
  stepRoom,
  threeWin,
  tiltAim,
} from '../src/game/minigames/keepitup';
import { createRng } from '../src/game/rng';

const DT = KEEP.step;
const LEVEL = { x: 0, y: 0 };
/** A fan pointing straight up at the ceiling corner: out of everyone's way. */
const AWAY = { x: -1, y: 1 };
const sticks = (over: Record<number, Stick>): Stick[] => [0, 1, 2].map((k) => over[k] ?? IDLE);

function room(): Room {
  return newRoom(0, [1, 2, 3], createRng(1));
}

/** Puts the balloon somewhere, still. */
function place(r: Room, x: number, y: number, z: number): void {
  Object.assign(r.ball, { x, y, z, vx: 0, vy: 0, vz: 0, down: 0 });
}

function play(seed: number, fanSkill: number, threeSkill: number): Room {
  const rng = createRng(seed);
  const r = newRoom(0, [1, 2, 3], rng);
  const fan = newBrain(fanSkill, rng);
  const brains = [1, 2, 3].map(() => newBrain(threeSkill, rng));
  let frames = 0;
  while (!isOver(r) && frames++ < 10_000) {
    const s = r.runners.map((_, k) => cpuStick(r, k, brains[k] ?? fan, rng));
    advance(r, s, cpuTilt(r, fan, rng), 1 / 30);
  }
  return r;
}

describe('keep it up', () => {
  it('starts with the balloon up in the middle and the three spread out on the floor', () => {
    const r = room();
    expect(r.ball.y).toBe(KEEP.serveY);
    expect(Math.abs(r.ball.x)).toBeLessThan(1);
    expect(r.runners.map((a) => a.seat)).toEqual([1, 2, 3]);
    for (const a of r.runners) {
      expect(Math.abs(a.x)).toBeLessThan(KEEP.room.x);
      for (const b of r.runners) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
    }
  });

  it('runs where the stick points (up on the phone is away from the TV), round the furniture and the cushions', () => {
    const r = room();
    const a = r.runners[0];
    if (!a) throw new Error('no runner');
    const z0 = a.z;
    for (let i = 0; i < 30; i++) stepRoom(r, sticks({ 0: { x: 0, y: 1, a: false } }), AWAY, DT);
    expect(a.z).toBeLessThan(z0);
    // Into the front-left corner: the cushions keep everyone out of reach of it.
    for (let i = 0; i < 600; i++) stepRoom(r, sticks({ 0: { x: -1, y: -1, a: false } }), AWAY, DT);
    const nook = NOOKS[0];
    if (!nook) throw new Error('no nook');
    expect(Math.hypot(a.x - nook.x, a.z - nook.z)).toBeGreaterThanOrEqual(nook.r + KEEP.bodyR - 1e-6);
    // Into the sofa: never inside it.
    for (let i = 0; i < 600; i++) stepRoom(r, sticks({ 0: { x: -0.3, y: 1, a: false } }), AWAY, DT);
    for (const f of FURNITURE) expect(a.x > f.x0 && a.x < f.x1 && a.z > f.z0 && a.z < f.z1).toBe(false);
  });

  it('lets a balloon float down gently and counts one bump when it lands, then tosses it back in', () => {
    const b = { x: 1, y: 3, z: 0.5, vx: 0, vy: 0, vz: 0, down: 0 };
    let landed = false;
    let fastest = 0;
    for (let i = 0; i < 120 * 6 && !landed; i++) {
      landed = moveBall(b, null, DT) === 'floor';
      fastest = Math.max(fastest, -b.vy);
    }
    expect(landed).toBe(true);
    expect(fastest).toBeLessThan(KEEP.gravity / KEEP.drag + 0.01);

    const r = room();
    place(r, 1, 1, 0.5);
    r.runners.forEach((a, k) => Object.assign(a, { x: -3 + k, z: 2 }));
    let touches = 0;
    let served = false;
    for (let i = 0; i < 120 * 3; i++) {
      const ev = stepRoom(r, sticks({}), AWAY, DT);
      if (ev.touch !== null) touches++;
      served ||= ev.served;
    }
    expect(touches).toBe(1);
    expect(r.touches).toBe(1);
    expect(served).toBe(true);
    expect(r.ball.y).toBeGreaterThan(1);
  });

  it('bops a balloon in reach up, misses one out of reach, and needs a fresh press after the cooldown', () => {
    const r = room();
    const a = r.runners[0];
    if (!a) throw new Error('no runner');
    Object.assign(a, { x: 0, z: 1 });
    place(r, 0.5, 1.2, 1);
    let ev = stepRoom(r, sticks({ 0: { x: 0, y: 0, a: true } }), AWAY, DT);
    expect(ev.bops).toEqual([1]);
    expect(r.ball.vy).toBeGreaterThan(3);
    // Still holding the button: no second bop, even after the cooldown.
    let again = 0;
    for (let i = 0; i < 120; i++) {
      place(r, 0.5, 1.2, 1);
      again += stepRoom(r, sticks({ 0: { x: 0, y: 0, a: true } }), AWAY, DT).bops.length;
    }
    expect(again).toBe(0);
    stepRoom(r, sticks({}), AWAY, DT);
    // Too high to reach: a swing at thin air, and then a cooldown.
    place(r, 0.5, KEEP.reachY + 0.4, 1);
    ev = stepRoom(r, sticks({ 0: { x: 0, y: 0, a: true } }), AWAY, DT);
    expect(ev.whiffs).toEqual([1]);
    stepRoom(r, sticks({}), AWAY, DT);
    place(r, 0.5, 1.2, 1);
    expect(stepRoom(r, sticks({ 0: { x: 0, y: 0, a: true } }), AWAY, DT).bops).toEqual([]);
    for (let i = 0; i < KEEP.cooldown * 120; i++) stepRoom(r, sticks({}), AWAY, DT);
    place(r, 0.5, 1.2, 1);
    expect(stepRoom(r, sticks({ 0: { x: 0, y: 0, a: true } }), AWAY, DT).bops).toEqual([1]);
  });

  it('points the fan where the phone tilts, at the swivel’s own pace, and only blows inside its cone', () => {
    expect(fanDir(tiltAim({ x: 1, y: 0 }))[0]).toBeGreaterThan(0.5);
    expect(fanDir(tiltAim({ x: 0, y: -1 }))[1]).toBeLessThan(-0.7);
    const t = aimAt(2, 1, 1);
    const aim = tiltAim(t);
    const [ax, ay, az] = airflow(aim, 2, 1, 1);
    expect(az).toBeGreaterThan(0);
    expect(ax).toBeGreaterThan(0);
    expect(ay).toBeLessThan(0);
    expect(airflow(aim, -3, 1, 1)).toEqual([0, 0, 0]);
    // Closer is stronger.
    const near = Math.hypot(...airflow(tiltAim(aimAt(0, 1.5, -1)), 0, 1.5, -1));
    const far = Math.hypot(...airflow(tiltAim(aimAt(0, 1.5, 2)), 0, 1.5, 2));
    expect(near).toBeGreaterThan(far);

    const r = room();
    stepRoom(r, sticks({}), { x: 1, y: 0 }, 0.1);
    expect(r.fan.yaw).toBeCloseTo(KEEP.fan.turn * 0.1, 5);
  });

  it('blows a balloon against a wall down it, into the corner', () => {
    const fall = (fan: ReturnType<typeof tiltAim> | null) => {
      const b = { x: 4.2, y: 2.4, z: 2.1, vx: 0, vy: 0, vz: 0, down: 0 };
      let t = 0;
      while (moveBall(b, fan, DT) !== 'floor' && t < 10) t += DT;
      return { b, t };
    };
    const { b, t } = fall(tiltAim(aimAt(4.6, 2.2, 2.3)));
    // Much quicker than drifting down on its own.
    expect(t).toBeLessThan(fall(null).t * 0.75);
    const nook = NOOKS[1];
    if (!nook) throw new Error('no nook');
    expect(Math.hypot(b.x - nook.x, b.z - nook.z)).toBeLessThan(nook.r);
  });

  it('gives the fan the win on the third bump, and the three the win if it stays up', () => {
    const r = room();
    place(r, 0, 0.5, 0);
    r.runners.forEach((a, k) => Object.assign(a, { x: -4 + k, z: -1.5 }));
    for (let i = 0; i < 120 * 20 && !isOver(r); i++) {
      if (r.ball.down <= 0 && r.ball.y > 0.6) place(r, r.ball.x, 0.5, r.ball.z);
      stepRoom(r, sticks({}), AWAY, DT);
    }
    expect(r.touches).toBe(KEEP.maxTouches);
    expect(isOver(r)).toBe(true);
    expect(threeWin(r)).toBe(false);
    expect(keepScores(r, 4)).toEqual([1, 0, 0, 0]);

    const s = newRoom(2, [0, 1, 3], createRng(2));
    for (let i = 0; i < KEEP.duration * 120 + 5; i++) {
      if (s.ball.y < 2) place(s, s.ball.x, 2.5, s.ball.z);
      stepRoom(s, [IDLE, IDLE, IDLE], AWAY, DT);
    }
    expect(isOver(s)).toBe(true);
    expect(threeWin(s)).toBe(true);
    expect(keepScores(s, 4)).toEqual([1, 1, 0, 1]);
  });

  it('steps the physics at 120 Hz whatever the frame rate, and keeps a press for a frame too short to step', () => {
    const r = room();
    expect(advance(r, sticks({}), LEVEL, 0.5).steps).toBe(60);
    expect(r.time).toBeCloseTo(0.5, 6);
    const short = advance(r, sticks({ 0: { x: 0, y: 0, a: true } }), LEVEL, KEEP.step / 3);
    expect(short.steps).toBe(0);
    expect(r.runners[0]?.pressed).toBe(false);
  });

  it('plays out with computer players, and sharpness matters on both sides', { timeout: 60_000 }, () => {
    const seeds = 24;
    let sharpFan = 0;
    let sleepyFan = 0;
    let even = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const a = play(seed, 1, 0.2);
      const b = play(seed, 0.2, 1);
      const c = play(seed, 0.55, 0.55);
      for (const g of [a, b, c]) expect(isOver(g)).toBe(true);
      if (threeWin(a)) sharpFan++;
      if (threeWin(b)) sleepyFan++;
      if (threeWin(c)) even++;
    }
    // The three win far more often against a sleepy fan, and an even match can go either way.
    expect(sleepyFan).toBeGreaterThan(sharpFan + 8);
    expect(even).toBeGreaterThan(seeds * 0.25);
    expect(even).toBeLessThan(seeds * 0.85);
  });
});
