// Keep It Up: a balloon drifting round the living room late at night. Three players keep it off the floor by
// running under it and bopping it back up; the fourth runs the desk fan on top of the bookcase and tries to blow
// it down, or off into a corner. Three floor bumps within the time and the fan wins; fewer and the three do.
//
// The floor is the x/z plane, y is up. The back wall is at -z and +z points at the TV audience. A stick's y (up on
// the phone) runs away from the audience, toward -z. The fan stands on the bookcase against the back wall, facing
// +z; tilting the phone right swings it to +x, tilting it forward (nose down) points it at the floor.
import type { Rng } from '../rng.js';

export const KEEP = {
  duration: 30, // seconds the three have to keep it up
  maxTouches: 3, // floor bumps that win it for the fan
  step: 1 / 120, // the balloon's physics step
  room: { x: 5, back: -3, front: 2.6, ceiling: 3.4 },
  ballR: 0.32,
  gravity: 1.6, // what is left of gravity once the air in the balloon is counted
  drag: 1.4, // air drag (per second): a balloon never falls fast
  restitution: 0.55, // how much speed a bounce off a wall or a cushion keeps
  wallSlide: 0.7, // how much of the breeze blowing into a wall turns downward along it
  bopUp: 3.6, // upward speed a bop gives
  bopPush: 0.8, // and a little push away from whoever bopped it
  reach: 1.0, // how far a bop reaches (centre to centre, across the floor)
  reachY: 2.0, // the highest a bopper can reach
  cooldown: 0.4, // between swings, hit or miss
  bodyR: 0.33,
  speed: 4.2,
  response: 10, // how quickly running follows the stick
  downTime: 1.0, // seconds the balloon lies on the floor after a bump before it is tossed back in
  serveY: 2.7,
  fan: {
    x: -0.2,
    y: 2.75,
    z: -2.72,
    force: 9, // push at the fan's mouth (units per second, per second)
    range: 5, // distance at which the push has halved
    cone: 0.42, // half-angle of the airflow (radians)
    along: 0.85, // how much of the push follows the fan's aim (the rest spreads straight out from the fan)
    yawMax: 1.22, // swivels up to 70° either way
    pitchMid: -0.44, // tips down 25° with the phone held level
    pitchSpan: 0.61, // and 35° further down or up
    turn: 2.6, // the swivel's top speed (radians per second)
  },
} as const;

export interface Stick {
  x: number;
  y: number;
  a: boolean;
}

export interface Tilt {
  x: number;
  y: number;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

/** A piece of furniture: a box the balloon bounces off and the runners go round. */
export interface Block {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

export const FURNITURE: readonly Block[] = [
  { name: 'bookcase', x0: -0.8, x1: 0.8, z0: -3, z1: -2.45, top: 2.3 },
  { name: 'sofaBack', x0: -4.6, x1: -1.8, z0: -3, z1: -2.65, top: 1.0 },
  { name: 'sofaSeat', x0: -4.6, x1: -1.8, z0: -2.65, z1: -2.0, top: 0.5 },
  { name: 'table', x0: -3.9, x1: -2.5, z0: -1.25, z1: -0.45, top: 0.45 },
  { name: 'chairBack', x0: 2.3, x1: 3.5, z0: -3, z1: -2.65, top: 1.0 },
  { name: 'chairSeat', x0: 2.3, x1: 3.5, z0: -2.65, z1: -1.85, top: 0.5 },
  { name: 'pouf', x0: 3.0, x1: 3.9, z0: 0.6, z1: 1.5, top: 0.45 },
  { name: 'lamp', x0: 4.3, x1: 4.7, z0: -2.95, z1: -2.55, top: 1.95 },
];

/**
 * Floor cushions piled in the front corners (a cat asleep on one): too soft to run across, too low to stop the
 * balloon. A balloon blown into a corner comes down on them, out of everyone's reach.
 */
export const NOOKS: readonly { x: number; z: number; r: number }[] = [
  { x: -KEEP.room.x, z: KEEP.room.front, r: 1.15 },
  { x: KEEP.room.x, z: KEEP.room.front, r: 1.15 },
];

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds left lying on the floor after a bump (0: in play). */
  down: number;
}

export interface Runner {
  seat: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Seconds until the next swing. */
  cool: number;
  bops: number;
  whiffs: number;
  /** Heading in the x/z plane (0 faces +z, the audience). */
  face: number;
  /** The button was down last step (a swing needs a fresh press). */
  pressed: boolean;
}

export interface Fan {
  yaw: number;
  pitch: number;
}

export interface Room {
  fanSeat: number;
  three: number[];
  runners: Runner[];
  ball: Ball;
  fan: Fan;
  touches: number;
  time: number;
  /** Where the balloon is tossed back in after each bump (decided up front, so the rules stay seeded). */
  serves: { x: number; z: number }[];
  /** Physics time not stepped yet. */
  acc: number;
}

export interface StepEvents {
  /** Seats that bopped the balloon. */
  bops: number[];
  /** Seats that swung and missed. */
  whiffs: number[];
  /** The balloon touched the floor (the bump's number, 1..3), or null. */
  touch: number | null;
  /** The balloon was tossed back in. */
  served: boolean;
  /** The balloon bounced off a wall or furniture, at this speed. */
  bounce: number;
  /** Physics steps taken (0: too little time yet; the inputs were not used). */
  steps: number;
}

const SPAWNS: readonly [number, number][] = [
  [-1.8, 0.9],
  [1.8, 0.9],
  [0, 1.7],
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function noEvents(): StepEvents {
  return { bops: [], whiffs: [], touch: null, served: false, bounce: 0, steps: 0 };
}

export function newRoom(fanSeat: number, three: readonly number[], rng: Rng): Room {
  const runners = three.map((seat, k) => {
    const [x, z] = SPAWNS[k % SPAWNS.length] ?? [0, 1];
    return { seat, x, z, vx: 0, vz: 0, cool: 0, bops: 0, whiffs: 0, face: Math.PI, pressed: false };
  });
  const serves = Array.from({ length: KEEP.maxTouches + 1 }, () => ({ x: (rng() - 0.5) * 4.6, z: -0.3 + rng() * 1.6 }));
  return {
    fanSeat,
    three: [...three],
    runners,
    ball: { x: 0, y: KEEP.serveY, z: 0.3, vx: 0, vy: 0, vz: 0, down: 0 },
    fan: { yaw: 0, pitch: KEEP.fan.pitchMid },
    touches: 0,
    time: 0,
    serves,
    acc: 0,
  };
}

export function isOver(r: Room): boolean {
  return r.touches >= KEEP.maxTouches || r.time >= KEEP.duration;
}

/** The three win if the balloon stays up (fewer than three bumps). */
export function threeWin(r: Room): boolean {
  return r.touches < KEEP.maxTouches;
}

// ------------------------------------------------------------------ the fan and the balloon

/** The way the fan points, as a unit vector. */
export function fanDir(f: Fan): [number, number, number] {
  const c = Math.cos(f.pitch);
  return [Math.sin(f.yaw) * c, Math.sin(f.pitch), Math.cos(f.yaw) * c];
}

/** Where the fan wants to point for a tilt of the phone. */
export function tiltAim(t: Tilt): Fan {
  const F = KEEP.fan;
  return { yaw: clamp(t.x, -1, 1) * F.yawMax, pitch: F.pitchMid + clamp(t.y, -1, 1) * F.pitchSpan };
}

/** The tilt that points the fan at (x, y, z) (as far as the swivel goes). */
export function aimAt(x: number, y: number, z: number): Tilt {
  const F = KEEP.fan;
  const yaw = Math.atan2(x - F.x, z - F.z);
  const pitch = Math.atan2(y - F.y, Math.hypot(x - F.x, z - F.z));
  return { x: clamp(yaw / F.yawMax, -1, 1), y: clamp((pitch - F.pitchMid) / F.pitchSpan, -1, 1) };
}

/** Swings the fan toward the tilt, no faster than the swivel turns. */
export function turnFan(f: Fan, t: Tilt, dt: number): void {
  const want = tiltAim(t);
  const max = KEEP.fan.turn * dt;
  f.yaw += clamp(want.yaw - f.yaw, -max, max);
  f.pitch += clamp(want.pitch - f.pitch, -max, max);
}

/** The airflow's push on a balloon at (x, y, z): an acceleration, strongest close up and along the fan's aim. */
export function airflow(f: Fan, x: number, y: number, z: number): [number, number, number] {
  const F = KEEP.fan;
  const dx = x - F.x;
  const dy = y - F.y;
  const dz = z - F.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.2) return [0, 0, 0];
  const [ax, ay, az] = fanDir(f);
  const cos = clamp((dx * ax + dy * ay + dz * az) / d, -1, 1);
  const angle = Math.acos(cos);
  if (angle >= F.cone) return [0, 0, 0];
  const strength = (F.force * (1 - (angle / F.cone) ** 2)) / (1 + (d / F.range) ** 2);
  // The breeze follows the aim, spreading out from the fan a little.
  const px = ax * F.along + (dx / d) * (1 - F.along);
  const py = ay * F.along + (dy / d) * (1 - F.along);
  const pz = az * F.along + (dz / d) * (1 - F.along);
  const pl = Math.hypot(px, py, pz) || 1;
  return [(px / pl) * strength, (py / pl) * strength, (pz / pl) * strength];
}

/** Bounces the balloon off one piece of furniture. Returns the speed it hit at (0: no contact). */
function bounceOff(b: Ball, k: Block, dt: number): number {
  const R = KEEP.ballR;
  const cx = clamp(b.x, k.x0, k.x1);
  const cy = clamp(b.y, 0, k.top);
  const cz = clamp(b.z, k.z0, k.z1);
  let nx = b.x - cx;
  let ny = b.y - cy;
  let nz = b.z - cz;
  let d = Math.hypot(nx, ny, nz);
  if (d >= R) return 0;
  if (d < 1e-6) {
    // The centre got inside: out through the top.
    nx = 0;
    ny = 1;
    nz = 0;
    d = 0;
    b.y = k.top;
  } else {
    nx /= d;
    ny /= d;
    nz /= d;
  }
  b.x += nx * (R - d);
  b.y += ny * (R - d);
  b.z += nz * (R - d);
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  let hit = 0;
  if (vn < 0) {
    hit = -vn;
    const j = -(1 + KEEP.restitution) * vn;
    b.vx += j * nx;
    b.vy += j * ny;
    b.vz += j * nz;
  }
  // Cushions and table tops are rounded: a balloon resting on one rolls off.
  if (ny > 0.7) {
    const ox = b.x - (k.x0 + k.x1) / 2;
    const oz = b.z - (k.z0 + k.z1) / 2;
    const ol = Math.hypot(ox, oz) || 1;
    b.vx += (ox / ol) * 2.2 * dt;
    b.vz += (oz / ol) * 2.2 * dt;
  }
  return hit;
}

/**
 * Moves the balloon by dt: buoyant fall, drag, the fan's breeze, walls, ceiling and furniture. Stops at the floor
 * (returns 'floor'); otherwise returns the speed of the hardest bounce (0: none).
 */
export function moveBall(b: Ball, fan: Fan | null, dt: number): number | 'floor' {
  const R = KEEP.ballR;
  const room = KEEP.room;
  let [ax, ay, az] = fan ? airflow(fan, b.x, b.y, b.z) : [0, 0, 0];
  // Breeze blowing into a wall runs down it, and takes the balloon along: corners are where it ends up.
  const near = R + 0.03;
  const slide = KEEP.wallSlide;
  if (b.x <= -room.x + near && ax < 0) {
    ay += ax * slide;
    ax = 0;
  } else if (b.x >= room.x - near && ax > 0) {
    ay -= ax * slide;
    ax = 0;
  }
  if (b.z <= room.back + near && az < 0) {
    ay += az * slide;
    az = 0;
  } else if (b.z >= room.front - near && az > 0) {
    ay -= az * slide;
    az = 0;
  }
  ay -= KEEP.gravity;
  ax -= b.vx * KEEP.drag;
  ay -= b.vy * KEEP.drag;
  az -= b.vz * KEEP.drag;
  b.vx += ax * dt;
  b.vy += ay * dt;
  b.vz += az * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  let hit = 0;
  const wall = (v: number) => {
    hit = Math.max(hit, Math.abs(v));
    return -v * KEEP.restitution;
  };
  if (b.x < -room.x + R) {
    b.x = -room.x + R;
    if (b.vx < 0) b.vx = wall(b.vx);
  } else if (b.x > room.x - R) {
    b.x = room.x - R;
    if (b.vx > 0) b.vx = wall(b.vx);
  }
  if (b.z < room.back + R) {
    b.z = room.back + R;
    if (b.vz < 0) b.vz = wall(b.vz);
  } else if (b.z > room.front - R) {
    b.z = room.front - R;
    if (b.vz > 0) b.vz = wall(b.vz);
  }
  if (b.y > room.ceiling - R) {
    b.y = room.ceiling - R;
    if (b.vy > 0) b.vy = wall(b.vy);
  }
  for (const k of FURNITURE) hit = Math.max(hit, bounceOff(b, k, dt));
  if (b.y <= R) {
    b.y = R;
    return 'floor';
  }
  return hit;
}

// ------------------------------------------------------------------ the runners

/** Keeps runners on the floor, out of the furniture and out of each other. */
function separate(r: Room): void {
  const rs = r.runners;
  const R = KEEP.bodyR;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i] as Runner;
      const b = rs[j] as Runner;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= R * 2) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const half = (R * 2 - d) / 2;
      a.x -= nx * half;
      a.z -= nz * half;
      b.x += nx * half;
      b.z += nz * half;
    }
  }
  for (const a of rs) {
    for (const k of FURNITURE) {
      const cx = clamp(a.x, k.x0, k.x1);
      const cz = clamp(a.z, k.z0, k.z1);
      const dx = a.x - cx;
      const dz = a.z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d > 1e-6) {
        a.x = cx + (dx / d) * R;
        a.z = cz + (dz / d) * R;
      } else {
        // Inside: out the nearest side.
        const out = [a.x - k.x0, k.x1 - a.x, a.z - k.z0, k.z1 - a.z];
        const m = out.indexOf(Math.min(...out));
        if (m === 0) a.x = k.x0 - R;
        else if (m === 1) a.x = k.x1 + R;
        else if (m === 2) a.z = k.z0 - R;
        else a.z = k.z1 + R;
      }
    }
    for (const n of NOOKS) {
      const dx = a.x - n.x;
      const dz = a.z - n.z;
      const d = Math.hypot(dx, dz);
      if (d >= n.r + R || d < 1e-6) continue;
      a.x = n.x + (dx / d) * (n.r + R);
      a.z = n.z + (dz / d) * (n.r + R);
    }
    a.x = clamp(a.x, -KEEP.room.x + R, KEEP.room.x - R);
    a.z = clamp(a.z, KEEP.room.back + R, KEEP.room.front - R);
  }
}

/** Whether a runner can reach the balloon right now. */
export function inReach(r: Room, a: Runner): boolean {
  const b = r.ball;
  return b.down <= 0 && b.y <= KEEP.reachY && Math.hypot(b.x - a.x, b.z - a.z) <= KEEP.reach;
}

function bop(r: Room, a: Runner): void {
  const b = r.ball;
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    dx = 0;
    dz = -1;
  } else {
    dx /= d;
    dz /= d;
  }
  b.vy = Math.max(0, b.vy) * 0.3 + KEEP.bopUp;
  b.vx = b.vx * 0.4 + dx * KEEP.bopPush + a.vx * 0.25;
  b.vz = b.vz * 0.4 + dz * KEEP.bopPush + a.vz * 0.25;
  const h = Math.hypot(b.vx, b.vz);
  if (h > 3) {
    b.vx *= 3 / h;
    b.vz *= 3 / h;
  }
  a.bops += 1;
}

/** One fixed physics step. `sticks` line up with `room.runners`. */
export function stepRoom(r: Room, sticks: readonly Stick[], tilt: Tilt, dt: number): StepEvents {
  const ev = noEvents();
  if (isOver(r)) return ev;
  ev.steps = 1;
  r.time += dt;
  turnFan(r.fan, tilt, dt);
  const follow = Math.min(1, KEEP.response * dt);
  r.runners.forEach((a, k) => {
    const s = sticks[k] ?? IDLE;
    let ix = s.x;
    let iy = s.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    a.vx += (ix * KEEP.speed - a.vx) * follow;
    a.vz += (-iy * KEEP.speed - a.vz) * follow;
    a.x += a.vx * dt;
    a.z += a.vz * dt;
    if (Math.hypot(a.vx, a.vz) > 0.4) a.face = Math.atan2(a.vx, a.vz);
    a.cool = Math.max(0, a.cool - dt);
  });
  separate(r);

  const b = r.ball;
  if (b.down > 0) {
    b.down -= dt;
    if (b.down <= 0) {
      const s = r.serves[r.touches % r.serves.length] ?? { x: 0, z: 0.3 };
      Object.assign(b, { x: s.x, y: KEEP.serveY, z: s.z, vx: 0, vy: 0, vz: 0, down: 0 });
      ev.served = true;
    }
  } else {
    // Swings first (a fresh press, off cooldown), then the balloon moves.
    r.runners.forEach((a, k) => {
      const press = (sticks[k] ?? IDLE).a;
      if (press && !a.pressed && a.cool <= 0) {
        a.cool = KEEP.cooldown;
        if (inReach(r, a)) {
          bop(r, a);
          ev.bops.push(a.seat);
        } else {
          a.whiffs += 1;
          ev.whiffs.push(a.seat);
        }
      }
    });
    const res = moveBall(b, r.fan, dt);
    // Bodies nudge a low balloon aside rather than going through it.
    for (const a of r.runners) {
      if (b.y > 1.15) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = KEEP.bodyR + KEEP.ballR * 0.8;
      if (d >= min || d < 1e-6) continue;
      b.x = a.x + (dx / d) * min;
      b.z = a.z + (dz / d) * min;
    }
    if (res === 'floor') {
      r.touches += 1;
      b.vx = b.vy = b.vz = 0;
      b.down = KEEP.downTime;
      ev.touch = r.touches;
    } else ev.bounce = res;
  }
  for (const [k, a] of r.runners.entries()) a.pressed = (sticks[k] ?? IDLE).a;
  return ev;
}

/** Advances by dt in fixed steps (any left-over time waits for the next call). Events are merged. */
export function advance(r: Room, sticks: readonly Stick[], tilt: Tilt, dt: number): StepEvents {
  const out = noEvents();
  r.acc += Math.min(dt, 0.6);
  // (A hair of slack, so 0.5 s really is 60 steps despite rounding.)
  while (r.acc >= KEEP.step - 1e-9 && !isOver(r)) {
    r.acc -= KEEP.step;
    const ev = stepRoom(r, sticks, tilt, KEEP.step);
    out.bops.push(...ev.bops);
    out.whiffs.push(...ev.whiffs);
    if (ev.touch !== null) out.touch = ev.touch;
    out.served ||= ev.served;
    out.bounce = Math.max(out.bounce, ev.bounce);
    out.steps += ev.steps;
  }
  return out;
}

/** The winning side scores 1, the other 0; teammates always the same. */
export function keepScores(r: Room, seats: number): number[] {
  const up = threeWin(r);
  return Array.from({ length: seats }, (_, s) => {
    if (s === r.fanSeat) return up ? 0 : 1;
    if (r.three.includes(s)) return up ? 1 : 0;
    return 0;
  });
}

// ------------------------------------------------------------------ computer players

/**
 * Where the balloon will come down to height `hitY` (or the floor), following it for up to `maxT` seconds.
 * `fan`: count the breeze as the fan points now (sharp players do).
 */
export function predict(r: Room, hitY: number, fan: boolean, maxT = 4): { x: number; z: number; t: number } {
  const b: Ball = { ...r.ball };
  const dt = 1 / 30;
  for (let t = 0; t < maxT; t += dt) {
    if (b.vy < 0 && b.y <= hitY) return { x: b.x, z: b.z, t };
    if (moveBall(b, fan ? r.fan : null, dt) === 'floor') return { x: b.x, z: b.z, t };
  }
  return { x: b.x, z: b.z, t: maxT };
}

export interface Brain {
  skill: number;
  /** Game time of the next decision: sleepy players react late. */
  next: number;
  /** How high a runner likes to bop the balloon (sharp ones go early). */
  hitY: number;
  x: number;
  y: number;
  /** A swing waiting to be sent (one step only, so the next one is a fresh press). */
  press: boolean;
}

export function newBrain(skill: number, rng: Rng): Brain {
  return { skill, next: 0, hitY: 0.95 + skill * 0.55 + rng() * 0.25, x: 0, y: 0, press: false };
}

function steerTo(a: Runner, b: Brain, tx: number, tz: number, rng: Rng): void {
  let vx = tx - a.x;
  let vz = tz - a.z;
  const d = Math.hypot(vx, vz);
  if (d < 0.05) {
    b.x = b.y = 0;
    return;
  }
  vx /= d;
  vz /= d;
  const wobble = (rng() - 0.5) * (1 - b.skill) * 0.9;
  const c = Math.cos(wobble);
  const s = Math.sin(wobble);
  const speed = d < 0.35 ? d / 0.35 : 1;
  b.x = (vx * c - vz * s) * speed;
  b.y = -(vx * s + vz * c) * speed;
}

function thinkRunner(r: Room, k: number, b: Brain, rng: Rng): void {
  const me = r.runners[k];
  if (!me) return;
  const ball = r.ball;
  if (ball.down > 0) {
    // Drift back toward the middle, ready for the toss.
    steerTo(me, b, (me.x + 0) / 2, (me.z + 0.6) / 2, rng);
    return;
  }
  const sees = rng() < 0.35 + b.skill * 0.65;
  const spot = predict(r, b.hitY, sees);
  const err = (1 - b.skill) * 0.9;
  spot.x += (rng() - 0.5) * err;
  spot.z += (rng() - 0.5) * err;
  // Whoever gets there first goes for it; the others spread out in front of the spot, where the fan blows it.
  const eta = (a: Runner) => Math.hypot(spot.x - a.x, spot.z - a.z);
  const order = [...r.runners.keys()].sort((i, j) => eta(r.runners[i] as Runner) - eta(r.runners[j] as Runner));
  const rank = order.indexOf(k);
  const chase = rank === 0 || rng() < (1 - b.skill) * 0.35;
  let tx = spot.x;
  let tz = spot.z;
  if (!chase) {
    const fx = spot.x - KEEP.fan.x;
    const fz = spot.z - KEEP.fan.z;
    const fl = Math.hypot(fx, fz) || 1;
    const side = rank === 1 ? 1 : -1;
    const ahead = 0.6 + b.skill * 0.9;
    const wide = 1.2 + b.skill * 0.5;
    tx = spot.x + (fx / fl) * ahead + (-fz / fl) * wide * side;
    tz = spot.z + (fz / fl) * ahead + (fx / fl) * wide * side;
    // Sleepy helpers drift rather than hold a spot.
    tx = me.x + (tx - me.x) * (0.4 + b.skill * 0.6);
    tz = me.z + (tz - me.z) * (0.4 + b.skill * 0.6);
  }
  steerTo(me, b, clamp(tx, -4.6, 4.6), clamp(tz, -2.6, 2.2), rng);
  if (me.cool > 0) return;
  const reach = Math.hypot(ball.x - me.x, ball.z - me.z);
  if (inReach(r, me)) {
    const want = (ball.vy < 0 && ball.y < b.hitY + 0.3) || ball.y < 0.9;
    if (want && rng() < 0.55 + b.skill * 0.45) b.press = true;
  } else if (reach < 1.5 && ball.y < KEEP.reachY + 0.4 && rng() < (1 - b.skill) * 0.12) {
    b.press = true; // a hopeful swing at thin air
  }
}

/** A computer runner's stick for this frame (`k` is its place in `room.runners`). */
export function cpuStick(r: Room, k: number, b: Brain, rng: Rng): Stick {
  if (r.time >= b.next) {
    thinkRunner(r, k, b, rng);
    b.next = r.time + 0.07 + (1 - b.skill) * 0.24 + rng() * 0.06;
  }
  const a = b.press;
  b.press = false;
  return { x: b.x, y: b.y, a };
}

/** A computer fan: follows the balloon (leading it a little), with a slower, shakier hand when sleepy. */
export function cpuTilt(r: Room, b: Brain, rng: Rng): Tilt {
  if (r.time >= b.next) {
    const ball = r.ball;
    let t: Tilt;
    if (ball.down > 0) t = aimAt(0, 1.2, 0.5);
    else {
      const lead = 0.15 + b.skill * 0.35;
      // Sharp fans aim a touch under the balloon so the breeze presses it down.
      t = aimAt(ball.x + ball.vx * lead, ball.y + ball.vy * lead - b.skill * 0.4, ball.z + ball.vz * lead);
    }
    const shake = (1 - b.skill) * 0.35;
    b.x = clamp(t.x + (rng() - 0.5) * shake, -1, 1);
    b.y = clamp(t.y + (rng() - 0.5) * shake, -1, 1);
    b.next = r.time + 0.08 + (1 - b.skill) * 0.3 + rng() * 0.06;
  }
  return { x: b.x, y: b.y };
}
