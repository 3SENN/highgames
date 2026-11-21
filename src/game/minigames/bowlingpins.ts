// Hallway Bowling: one player is the ball (rolled up in a sleeping bag) and steers down a long hallway; the other
// three are the pins, standing in a triangle at the far end, and can only shuffle sideways, slowly. Three rolls;
// every pin knocked over is a point for the ball. The ball wins with 5 or more over the three rolls.
//
// The hallway runs along z: the ball starts at z = BOWL.start and rolls toward -z, the head pin stands at z = 0
// and the two back pins a row behind it. x is across the hallway (+x to the right, seen from behind the ball).
import type { Rng } from '../rng.js';

export const BOWL = {
  rolls: 3,
  need: 5, // pins the ball needs over the three rolls
  start: 16, // where the ball starts each roll
  end: -3.2, // the roll is over once the ball gets here (the pillow pile at the end)
  halfWidth: 1.9, // half the hallway, wall to wall
  ballHalf: 0.62, // the rolled-up sleeping bag: half its length (across the hallway)
  ballR: 0.45, // and its radius
  pinR: 0.3,
  speed: 4.8, // how fast the ball rolls down the hallway
  steer: 2.2, // the ball's fastest sideways speed
  steerResponse: 6, // how quickly the ball follows the tilt
  pinSpeed: 1.0, // the pins' fastest shuffle
  pinResponse: 10,
  rowGap: 0.95, // the back row stands this far behind the head pin
  spread: 0.75, // the back pins start this far either side of the middle
  chain: 1.05, // a falling pin knocks over a standing pin this close behind it or on the side it falls to
} as const;

/** How far across (centre to centre) the ball reaches a pin. */
export const reachX = (): number => BOWL.ballHalf + BOWL.pinR;
/** The furthest the ball's centre gets from the middle of the hallway, and a pin's. */
export const ballLimit = (): number => BOWL.halfWidth - BOWL.ballHalf;
export const pinLimit = (): number => BOWL.halfWidth - BOWL.pinR;

/** Whether the ball touches a pin standing at (x, z). */
export function touches(ball: { x: number; z: number }, x: number, z: number): boolean {
  return Math.abs(x - ball.x) < reachX() && Math.abs(z - ball.z) < BOWL.ballR + BOWL.pinR;
}

export interface Ball {
  x: number;
  z: number;
  vx: number;
  /** How far it has rolled (for the spin of the sleeping bag). */
  rolled: number;
}

export interface Pin {
  seat: number;
  x: number;
  z: number;
  vx: number;
  down: boolean;
  /** Roll time it went down. */
  downAt: number;
  /** -1 or 1: which side it falls toward. */
  fall: number;
  /** Knocked over by a falling neighbour rather than by the ball. */
  chained: boolean;
  /** Times knocked over, all rolls together. */
  knocked: number;
}

export interface Lane {
  bowler: number;
  ball: Ball;
  pins: Pin[];
  /** 1-based number of the roll being played (0 before the first). */
  roll: number;
  /** Seconds into this roll. */
  time: number;
  /** Pins knocked over in each roll. */
  perRoll: number[];
  total: number;
}

export interface Knock {
  seat: number;
  chained: boolean;
}

/** The triangle: the first pin at the head, the next two behind it, left and right. */
function home(k: number): { x: number; z: number } {
  if (k === 0) return { x: 0, z: 0 };
  if (k === 1) return { x: -BOWL.spread, z: -BOWL.rowGap };
  if (k === 2) return { x: BOWL.spread, z: -BOWL.rowGap };
  return { x: (k % 2 ? -1 : 1) * BOWL.spread * 2, z: -BOWL.rowGap * 2 };
}

export function newLane(bowler: number, pins: readonly number[]): Lane {
  const lane: Lane = {
    bowler,
    ball: { x: 0, z: BOWL.start, vx: 0, rolled: 0 },
    pins: pins.map((seat, k) => ({ seat, ...home(k), vx: 0, down: false, downAt: 0, fall: 1, chained: false, knocked: 0 })),
    roll: 0,
    time: 0,
    perRoll: [],
    total: 0,
  };
  return lane;
}

/** Sets up the next roll: the ball back at the start, every pin standing in the triangle again. */
export function startRoll(lane: Lane): void {
  lane.roll += 1;
  lane.time = 0;
  lane.ball = { x: 0, z: BOWL.start, vx: 0, rolled: 0 };
  lane.pins.forEach((p, k) => {
    const h = home(k);
    p.x = h.x;
    p.z = h.z;
    p.vx = 0;
    p.down = false;
    p.chained = false;
  });
  lane.perRoll.push(0);
}

export function rollOver(lane: Lane): boolean {
  return lane.ball.z <= BOWL.end;
}

export function gameOver(lane: Lane): boolean {
  return lane.roll >= BOWL.rolls && rollOver(lane);
}

/** The ball wins once it has knocked over enough pins. */
export function ballWins(lane: Lane): boolean {
  return lane.total >= BOWL.need;
}

function knock(lane: Lane, p: Pin, fall: number, chained: boolean, out: Knock[]): void {
  p.down = true;
  p.downAt = lane.time;
  p.fall = fall;
  p.chained = chained;
  p.vx = 0;
  p.knocked += 1;
  lane.total += 1;
  lane.perRoll[lane.perRoll.length - 1] = (lane.perRoll[lane.perRoll.length - 1] ?? 0) + 1;
  out.push({ seat: p.seat, chained });
  // A falling pin takes down whoever stands close behind it, or beside it on the side it falls to.
  for (const q of lane.pins) {
    if (q.down || q === p) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d >= BOWL.chain) continue;
    const behind = q.z < p.z - 0.1;
    const side = Math.sign(q.x - p.x) === fall;
    if (behind || side) knock(lane, q, Math.sign(q.x - p.x) || fall, true, out);
  }
}

/**
 * Advances the roll by dt. `steer` is the ball's sideways input (-1..1, 1 = full speed right); `shuffle[seat]`
 * each pin's (-1..1). Returns the pins knocked over in this step.
 */
export function stepLane(lane: Lane, steer: number, shuffle: readonly number[], dt: number): Knock[] {
  const out: Knock[] = [];
  if (rollOver(lane)) return out;
  lane.time += dt;
  const b = lane.ball;
  const want = Math.max(-1, Math.min(1, steer)) * BOWL.steer;
  b.vx += (want - b.vx) * Math.min(1, BOWL.steerResponse * dt);
  b.x += b.vx * dt;
  if (Math.abs(b.x) > ballLimit()) {
    b.x = Math.sign(b.x) * ballLimit();
    b.vx = 0;
  }
  b.z -= BOWL.speed * dt;
  b.rolled += BOWL.speed * dt;

  for (const p of lane.pins) {
    if (p.down) continue;
    const go = Math.max(-1, Math.min(1, shuffle[p.seat] ?? 0)) * BOWL.pinSpeed;
    p.vx += (go - p.vx) * Math.min(1, BOWL.pinResponse * dt);
    p.x += p.vx * dt;
    if (Math.abs(p.x) > pinLimit()) {
      p.x = Math.sign(p.x) * pinLimit();
      p.vx = 0;
    }
  }
  // Pins in the same row can't walk through each other (or squeeze each other through the walls).
  const rows = new Map<number, Pin[]>();
  for (const p of lane.pins) if (!p.down) rows.set(p.z, [...(rows.get(p.z) ?? []), p]);
  const min = BOWL.pinR * 2;
  for (const row of rows.values()) {
    if (row.length < 2) continue;
    row.sort((a, c) => a.x - c.x);
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1] as Pin;
      const c = row[i] as Pin;
      if (c.x - a.x >= min) continue;
      const mid = (a.x + c.x) / 2;
      a.x = mid - min / 2;
      c.x = mid + min / 2;
    }
    (row[0] as Pin).x = Math.max(-pinLimit(), (row[0] as Pin).x);
    for (let i = 1; i < row.length; i++) (row[i] as Pin).x = Math.max((row[i] as Pin).x, (row[i - 1] as Pin).x + min);
    (row[row.length - 1] as Pin).x = Math.min(pinLimit(), (row[row.length - 1] as Pin).x);
    for (let i = row.length - 2; i >= 0; i--) (row[i] as Pin).x = Math.min((row[i] as Pin).x, (row[i + 1] as Pin).x - min);
  }
  for (const p of lane.pins) {
    if (p.down) continue;
    if (touches(b, p.x, p.z)) knock(lane, p, Math.sign(p.x - b.x) || 1, false, out);
  }
  return out;
}

/** The winning side scores 1, the other 0. */
export function bowlScores(lane: Lane, seats: number): number[] {
  const ball = ballWins(lane);
  return Array.from({ length: seats }, (_, seat) => {
    if (seat === lane.bowler) return ball ? 1 : 0;
    if (lane.pins.some((p) => p.seat === seat)) return ball ? 0 : 1;
    return 0;
  });
}

// ------------------------------------------------------------------ computer players

export interface BowlBrain {
  skill: number;
  /** Roll time of the next decision. */
  next: number;
  /** The ball: where it means to be when it reaches the head pin's row, and then the back row. */
  aim: number;
  aim2: number;
  /** A pin: the stick it holds until the next decision. */
  stick: number;
  /** The ball's aim error for this roll. */
  err: number;
  roll: number;
}

export function newBowlBrain(skill: number): BowlBrain {
  return { skill, next: 0, aim: 0, aim2: 0, stick: 0, err: 0, roll: 0 };
}

/** How many pins a ball at x on the head row (then x2 on the back row) would knock over, chains included. */
function wouldKnock(pins: readonly Pin[], x: number, x2: number): number {
  const sim: Lane = { bowler: -1, ball: { x, z: 0, vx: 0, rolled: 0 }, pins: pins.map((p) => ({ ...p })), roll: 1, time: 0, perRoll: [0], total: 0 };
  const out: Knock[] = [];
  for (const p of sim.pins) {
    if (p.down) continue;
    const bx = p.z < -0.5 ? x2 : x;
    if (Math.abs(p.x - bx) < reachX()) knock(sim, p, Math.sign(p.x - bx) || 1, false, out);
  }
  return out.length;
}

/** The ball's tilt for this step (-1..1): it picks the line that knocks over the most pins and steers for it. */
export function cpuSteer(lane: Lane, b: BowlBrain, rng: Rng): number {
  const ball = lane.ball;
  if (b.roll !== lane.roll) {
    b.roll = lane.roll;
    b.next = 0;
    b.err = (rng() - 0.5) * (1 - b.skill) * 0.6;
  }
  const t = ball.z / BOWL.speed; // seconds until the head row
  if (lane.time >= b.next) {
    b.next = lane.time + 0.07 + (1 - b.skill) * 0.25 + rng() * 0.05;
    // Pins keep moving: a sharp ball expects them to carry on the way they shuffle.
    const ahead = Math.max(0, Math.min(t, 0.5)) * b.skill;
    const pins = lane.pins.map((p) => ({ ...p, x: Math.max(-pinLimit(), Math.min(pinLimit(), p.x + p.vx * ahead)) }));
    const shift = ((BOWL.steer * BOWL.rowGap) / BOWL.speed) * 0.7;
    // Pins will try to step out of the line: a sharp ball goes for lines that still work if they do.
    const dodge = Math.min(Math.max(0, t), 1) * BOWL.pinSpeed * 0.5 * b.skill;
    let best = -1;
    let bestScore = -Infinity;
    for (let x = -ballLimit(); x <= ballLimit() + 1e-6; x += 0.1) {
      for (const d of [-1, -0.5, 0, 0.5, 1]) {
        const x2 = Math.max(-ballLimit(), Math.min(ballLimit(), x + d * shift));
        const fled = pins.map((p) => ({ ...p, x: Math.max(-pinLimit(), Math.min(pinLimit(), p.x + Math.sign(p.x - (p.z < -0.5 ? x2 : x)) * dodge)) }));
        // Prefer lines it can still reach, close to where it is.
        const reach = Math.max(0.15, t) * BOWL.steer * 0.8;
        const far = Math.abs(x - ball.x);
        const n = wouldKnock(pins, x, x2) * 0.4 + wouldKnock(fled, x, x2) * 0.6 - (far > reach ? 3 : 0) - far * 0.05;
        if (n > bestScore) {
          bestScore = n;
          best = x;
          b.aim2 = x2;
        }
      }
    }
    b.aim = best;
  }
  const target = (ball.z > -0.3 ? b.aim : b.aim2) + b.err;
  // Steer so the ball arrives on the line (and doesn't overshoot it).
  const lead = ball.x + ball.vx * (0.25 - b.skill * 0.1);
  return Math.max(-1, Math.min(1, (target - lead) * (1.6 + b.skill * 1.6)));
}

/** A pin's shuffle for this step (-1..1): out of the ball's way, and not lined up behind a teammate. */
export function cpuShuffle(lane: Lane, seat: number, b: BowlBrain, rng: Rng): number {
  const me = lane.pins.find((p) => p.seat === seat);
  if (!me || me.down) return 0;
  if (b.roll !== lane.roll) {
    b.roll = lane.roll;
    b.next = 0;
    b.stick = 0;
  }
  if (lane.time < b.next) return b.stick;
  b.next = lane.time + 0.1 + (1 - b.skill) * 0.4 + rng() * 0.08;
  const ball = lane.ball;
  const t = (ball.z - me.z) / BOWL.speed;
  if (t < -0.1) return (b.stick = 0);
  // Where the ball will cross my row: sharp pins read where it is heading, sleepy ones only where it is.
  const look = Math.min(Math.max(0, t), 0.8) * b.skill;
  const guess = (rng() - 0.5) * (1 - b.skill) * 0.8;
  const cross = Math.max(-ballLimit(), Math.min(ballLimit(), ball.x + ball.vx * look + guess));
  const clear = reachX() + 0.2 + b.skill * 0.25;
  const alarm = 1.2 + b.skill * 1.6; // seconds out at which a pin starts to worry
  let want = 0;
  if (t < alarm && Math.abs(cross - me.x) < clear) {
    // Get out of the way on the side with room to spare.
    const right = cross + clear - me.x;
    const left = me.x - (cross - clear);
    const canRight = cross + clear <= pinLimit();
    const canLeft = cross - clear >= -pinLimit();
    const goRight = canRight && (!canLeft || right < left);
    want = goRight ? 1 : -1;
  } else if (t > 0.6) {
    // Time to spare: stay out of a teammate's line, so one ball can't get two of us.
    for (const o of lane.pins) {
      if (o === me || o.down) continue;
      const dx = me.x - o.x;
      if (Math.abs(dx) < BOWL.chain + 0.5 && rng() < b.skill) want += Math.sign(dx) || (me.z < o.z ? 1 : -1);
    }
    want = Math.max(-1, Math.min(1, want));
    // ... but keep off the walls, where there is nowhere left to go.
    if (Math.abs(me.x) > pinLimit() - 0.5 && Math.sign(want) === Math.sign(me.x)) want = 0;
  }
  // Sleepy pins sometimes just stand there.
  if (rng() > 0.55 + b.skill * 0.45) want = 0;
  b.stick = want;
  return want;
}
