// Balloon Volley: volleyball with a balloon over the back of the couch in the middle of the living room. Each team
// keeps to its own side and bops the balloon over; it floats down slowly. A bop needs you close enough and has a short
// cooldown, and a team may touch the balloon at most three times before it has to go over. When it touches the floor
// (or the couch cushions) on your side, the other team scores. First to five, or the most in forty seconds.
//
// The court: x runs left to right across the TV with the couch back at x = 0 (team 0 on the left, team 1 on the
// right), y is up, z comes towards the room (the camera).
import type { Rng } from '../rng.js';

export const VOLLEY = {
  duration: 40, // seconds
  target: 5, // points that win straight away
  step: 1 / 120, // seconds per physics step
  half: 4.2, // the court runs from -half to half along x
  depth: 1.7, // ...and from -depth to depth along z
  ceiling: 3.9,
  gravity: 3.0, // a balloon is light: it floats down slowly...
  drag: 0.6, // ...and the air slows it down
  radius: 0.3,
  bounce: 0.55, // walls, ceiling and the couch keep this much of the speed
  wobble: 0.7, // a balloon never flies quite straight: it drifts on the air this much (m/s²)
  backX: 0.16, // the couch back: |x| < backX, up to backH
  backH: 1.15,
  seatX: 1.0, // the seat cushions on either side, from backX to seatX, up to seatH
  seatH: 0.5,
  keepOut: 1.15, // players stay this far from the middle (the couch is in the way)
  wall: 0.35, // ...and this far from the end walls
  speed: 2.4, // a player's top speed
  accel: 10,
  reach: 0.9, // how far from a player (along the floor) a bop reaches
  low: 0.35, // the balloon heights a bop reaches
  high: 2.45,
  cooldown: 0.4,
  flub: 0.2, // how often a computer player gets a balloon badly wrong...
  flubSleepy: 0.42, // ...and how much more often a sleepy one does
  spikeY: 1.85, // a bop this high up...
  spikeX: 2.4, // ...this close to the couch is a spike
  touches: 3, // touches a team may make before it has to go over
  serveDelay: 1.0, // seconds between a point and the next serve
  serveX: 2.4,
  serveY: 2.9,
} as const;

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface Stick {
  x: number;
  y: number;
}

export interface Player {
  /** 0 (left) or 1 (right); -1 for a seat without a side. */
  team: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  lastBop: number;
  bops: number;
  /** Where this player waits for the serve. */
  home: { x: number; z: number };
}

export type VolleyEvent =
  | { t: 'serve'; side: number }
  | { t: 'bop'; player: number; touches: number; spike: boolean }
  | { t: 'whiff'; player: number }
  /** `team` touched it a fourth time: the other team scores. */
  | { t: 'fault'; team: number; player: number }
  /** The balloon touched down on `side`'s half: the other team scores (when the rally was live). */
  | { t: 'floor'; side: number; live: boolean }
  | { t: 'couch' }
  | { t: 'over'; to: number };

export interface Court {
  time: number;
  ball: Ball;
  players: Player[];
  /** Points per team. */
  score: number[];
  /** The team that has touched it since it last came over (null: nobody yet), and how often. */
  touchTeam: number | null;
  touches: number;
  /** The rally is on: a touchdown scores. */
  live: boolean;
  /** The balloon lies still (after a touchdown), waiting for the serve. */
  resting: boolean;
  serveAt: number;
  /** The side the next serve floats down on: the team that lost the last point. */
  serveSide: number;
  /** Goes up whenever the balloon's flight changes in a way you can't see coming (a bop, a serve, the couch). */
  flight: number;
}

export const sideOf = (x: number): number => (x < 0 ? 0 : 1);
/** Towards the other team: +1 for the left team, -1 for the right. */
export const forward = (team: number): number => (team === 0 ? 1 : -1);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Where a player waits: partner 0 near the couch, partner 1 at the back; a team of one in the middle. */
export function homeOf(team: number, member: number, members: number): { x: number; z: number } {
  const f = -forward(team);
  if (members < 2) return { x: f * 2.4, z: 0 };
  return member === 0 ? { x: f * 1.75, z: -0.65 } : { x: f * 3.1, z: 0.65 };
}

/** A court for `teams` (seat positions; teams[0] plays on the left), the first serve on `firstSide`. */
export function newCourt(teams: readonly (readonly number[])[], seats: number, firstSide = 0): Court {
  const players: Player[] = Array.from({ length: seats }, () => ({ team: -1, x: 0, z: 0, vx: 0, vz: 0, lastBop: -Infinity, bops: 0, home: { x: 0, z: 0 } }));
  teams.slice(0, 2).forEach((members, team) => {
    members.forEach((p, member) => {
      const pl = players[p];
      if (!pl) return;
      const home = homeOf(team, member, members.length);
      Object.assign(pl, { team, x: home.x, z: home.z, home });
    });
  });
  return {
    time: 0,
    ball: { x: -forward(firstSide) * VOLLEY.serveX, y: VOLLEY.serveY, z: 0, vx: 0, vy: 0, vz: 0 },
    players,
    score: [0, 0],
    touchTeam: null,
    touches: 0,
    live: false,
    resting: true,
    serveAt: 0.6,
    serveSide: firstSide,
    flight: 0,
  };
}

export function serve(c: Court, side: number): void {
  Object.assign(c.ball, { x: -forward(side) * VOLLEY.serveX, y: VOLLEY.serveY, z: 0, vx: 0, vy: 0.4, vz: 0 });
  c.live = true;
  c.resting = false;
  c.touchTeam = null;
  c.touches = 0;
  c.flight += 1;
}

/**
 * Moves the balloon one step. Returns what it touched: 'floor' (or a seat cushion), 'couch' (bounced off its back)
 * or null.
 */
export function stepBall(b: Ball, dt: number): 'floor' | 'couch' | null {
  const { gravity, drag, radius: R, bounce, half, depth, ceiling, backX, backH, seatX, seatH } = VOLLEY;
  b.vy -= gravity * dt;
  const k = Math.exp(-drag * dt);
  b.vx *= k;
  b.vy *= k;
  b.vz *= k;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  // The end walls, the edges of the rug and the ceiling: soft bounces.
  if (b.x < -half + R) {
    b.x = -half + R;
    b.vx = Math.abs(b.vx) * bounce;
  } else if (b.x > half - R) {
    b.x = half - R;
    b.vx = -Math.abs(b.vx) * bounce;
  }
  if (b.z < -depth + R) {
    b.z = -depth + R;
    b.vz = Math.abs(b.vz) * bounce;
  } else if (b.z > depth - R) {
    b.z = depth - R;
    b.vz = -Math.abs(b.vz) * bounce;
  }
  if (b.y > ceiling - R) {
    b.y = ceiling - R;
    b.vy = -Math.abs(b.vy) * bounce;
  }
  // The couch back, a long box across the middle.
  let hit: 'couch' | null = null;
  const cx = clamp(b.x, -backX, backX);
  const cy = clamp(b.y, 0, backH);
  const dx = b.x - cx;
  const dy = b.y - cy;
  const d = Math.hypot(dx, dy);
  if (d < R) {
    const nx = d > 1e-6 ? dx / d : b.vx > 0 ? -1 : 1;
    const ny = d > 1e-6 ? dy / d : 0;
    b.x = cx + nx * R;
    b.y = cy + ny * R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + bounce) * vn * nx;
      b.vy -= (1 + bounce) * vn * ny;
    }
    // Never balance on top of the couch: it rolls off one side or the other.
    if (ny > 0.6 && Math.abs(b.vx) < 0.5) b.vx = (b.x < 0 ? -1 : 1) * 0.6;
    hit = 'couch';
  }
  // The floor, or the seat cushions either side of the back.
  const ax = Math.abs(b.x);
  const surface = ax > backX && ax < seatX ? seatH : 0;
  if (b.y - R <= surface) {
    b.y = surface + R;
    return 'floor';
  }
  return hit;
}

/** Can `p` bop a balloon at `b`? Close enough along the floor, and not too low or too high. */
export function canReach(p: Player, b: Ball): boolean {
  return Math.hypot(b.x - p.x, b.z - p.z) <= VOLLEY.reach && b.y >= VOLLEY.low && b.y <= VOLLEY.high;
}

/**
 * The balloon's new speed after a bop by `p` aiming with `stick`. Low bops float up gently, higher ones go further
 * and flatter, and a bop at the top of your reach near the couch is a spike: down over the couch, fast. Pushing the
 * stick towards the other side sends it deeper, pulling it back keeps it short (a set for your partner); up and
 * down aim across the room.
 */
export function bopVelocity(b: Ball, p: Player, stick: Stick): { vx: number; vy: number; vz: number; spike: boolean } {
  const dir = forward(p.team);
  const f = clamp((b.y - 0.8) / 1.4, 0, 1);
  const spike = b.y >= VOLLEY.spikeY && Math.abs(b.x) <= VOLLEY.spikeX;
  const k = clamp((b.y - VOLLEY.spikeY) / 0.45, 0, 1);
  const up = spike ? lerp(0.6, -0.6, k) : lerp(3.4, 1.4, f);
  const power = spike ? lerp(3.4, 4.2, k) : lerp(1.4, 3.2, f);
  const deep = 1 + (spike ? 0.3 : 0.55) * clamp(stick.x * dir, -1, 1);
  const across = clamp(-stick.y, -1, 1) * 0.75 - b.z * 0.12;
  return { vx: dir * power * deep, vy: up, vz: power * across * 0.8, spike };
}

function point(c: Court, to: number, serveSide: number): void {
  c.score[to] = (c.score[to] ?? 0) + 1;
  c.live = false;
  c.serveAt = c.time + VOLLEY.serveDelay;
  c.serveSide = serveSide;
}

/**
 * Player `p` presses Bop with `stick`. `seen` is where the balloon was when they pressed (the TV judges reach
 * against it, so a phone's delay doesn't cost a bop). Returns null while the cooldown runs.
 */
export function bop(c: Court, p: number, stick: Stick, seen: Ball = c.ball): VolleyEvent | null {
  const pl = c.players[p];
  if (!pl || pl.team < 0 || c.time - pl.lastBop < VOLLEY.cooldown) return null;
  pl.lastBop = c.time;
  if (!c.live || !canReach(pl, seen)) return { t: 'whiff', player: p };
  if (c.touchTeam === pl.team) c.touches += 1;
  else {
    c.touchTeam = pl.team;
    c.touches = 1;
  }
  pl.bops += 1;
  if (c.touches > VOLLEY.touches) {
    point(c, 1 - pl.team, pl.team);
    c.ball.vy = Math.max(c.ball.vy, 1.2);
    c.flight += 1;
    return { t: 'fault', team: pl.team, player: p };
  }
  const v = bopVelocity(c.ball, pl, stick);
  c.ball.vx = v.vx;
  c.ball.vy = v.vy;
  c.ball.vz = v.vz;
  c.flight += 1;
  return { t: 'bop', player: p, touches: c.touches, spike: v.spike };
}

/** Moves a player towards where their stick points, keeping them on their side of the couch. */
export function movePlayer(p: Player, stick: Stick, dt: number): void {
  if (p.team < 0) return;
  const { speed, accel, half, depth, keepOut, wall } = VOLLEY;
  let sx = clamp(stick.x, -1, 1);
  let sz = -clamp(stick.y, -1, 1);
  const len = Math.hypot(sx, sz);
  if (len > 1) {
    sx /= len;
    sz /= len;
  }
  const k = Math.min(1, accel * dt);
  p.vx += (sx * speed - p.vx) * k;
  p.vz += (sz * speed - p.vz) * k;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  const [lo, hi] = p.team === 0 ? [-half + wall, -keepOut] : [keepOut, half - wall];
  if (p.x < lo || p.x > hi) {
    p.x = clamp(p.x, lo, hi);
    p.vx = 0;
  }
  if (Math.abs(p.z) > depth - 0.25) {
    p.z = clamp(p.z, -depth + 0.25, depth - 0.25);
    p.vz = 0;
  }
}

/** Partners don't walk through each other. */
function separate(players: Player[]): void {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i] as Player;
      const b = players[j] as Player;
      if (a.team < 0 || a.team !== b.team) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = 0.6;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 0;
      const nz = d > 1e-6 ? dz / d : 1;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
    }
  }
}

/** One physics step: players move, the balloon floats, touchdowns score, the next serve comes. */
export function stepCourt(c: Court, sticks: readonly Stick[], dt = VOLLEY.step): VolleyEvent[] {
  const events: VolleyEvent[] = [];
  c.time += dt;
  c.players.forEach((p, i) => movePlayer(p, sticks[i] ?? { x: 0, y: 0 }, dt));
  separate(c.players);
  if (!c.live && c.time >= c.serveAt) {
    serve(c, c.serveSide);
    events.push({ t: 'serve', side: c.serveSide });
  }
  if (c.resting) return events;
  // The drift: slow, smooth, different every flight, and nobody can quite see it coming.
  const w = VOLLEY.wobble * dt;
  c.ball.vx += w * Math.sin(c.time * 1.9 + c.flight * 2.3);
  c.ball.vz += w * Math.sin(c.time * 1.4 + c.flight * 1.1 + 1.7);
  const before = sideOf(c.ball.x);
  const hit = stepBall(c.ball, dt);
  const after = sideOf(c.ball.x);
  if (before !== after && c.live) {
    c.touchTeam = null;
    c.touches = 0;
    events.push({ t: 'over', to: after });
  }
  if (hit === 'couch') {
    c.flight += 1;
    events.push({ t: 'couch' });
  } else if (hit === 'floor') {
    const side = sideOf(c.ball.x);
    events.push({ t: 'floor', side, live: c.live });
    if (c.live) point(c, 1 - side, side);
    c.resting = true;
    c.ball.vx = c.ball.vy = c.ball.vz = 0;
  }
  return events;
}

/** The game is over: a team reached the target, or time is up. */
export function isOver(c: Court): boolean {
  return c.time >= VOLLEY.duration || c.score.some((s) => s >= VOLLEY.target);
}

/** Scores per seat: both partners get their team's points. `teams` holds seat positions. */
export function volleyScores(c: Court, teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    for (const m of members) if (m >= 0 && m < seats) scores[m] = c.score[i] ?? 0;
  });
  return scores;
}

// ------------------------------------------------------------------ computer players

/** Where the balloon comes down to `height` on `team`'s side, and in how many seconds (null: it won't). */
export function predict(b: Ball, team: number, height: number, horizon = 4): { x: number; z: number; t: number } | null {
  const sim = { ...b };
  const dt = 1 / 60;
  for (let t = 0; t < horizon; t += dt) {
    const hit = stepBall(sim, dt);
    const mine = sideOf(sim.x) === team && Math.abs(sim.x) > VOLLEY.keepOut - VOLLEY.reach;
    if (hit === 'floor') return sideOf(sim.x) === team ? { x: sim.x, z: sim.z, t } : null;
    if (mine && sim.vy < 0 && sim.y <= height) return { x: sim.x, z: sim.z, t };
  }
  return null;
}

/** What a computer player has in mind: refreshed every time the balloon's flight changes. */
export interface CpuMind {
  skill: number;
  flight: number;
  /** When it has worked out the new flight (its reaction time), and when it looks again (the balloon drifts). */
  readAt: number;
  lookAt: number;
  landing: { x: number; z: number; t: number; at: number } | null;
  /** How far off its guess is: depth is the hardest to judge. */
  err: { x: number; z: number };
  /** The height it likes to bop at this time, and the height it goes for (higher when it means to spike). */
  base: number;
  want: number;
  /** It means to wait for a high ball near the couch and send it over fast and flat. */
  spike: boolean;
  /** It will swing a little too soon this time. */
  eager: boolean;
  /** This time it misjudges the flight badly, or leaves it for its partner ("yours!"). */
  flub: 'none' | 'misjudge' | 'leave';
  swingAt: number | null;
  aim: Stick;
}

export function newMind(skill: number): CpuMind {
  return { skill: clamp(skill, 0, 1), flight: -1, readAt: 0, lookAt: 0, landing: null, err: { x: 0, z: 0 }, base: 1.6, want: 1.6, spike: false, eager: false, flub: 'none', swingAt: null, aim: { x: 0, y: 0 } };
}

/**
 * A computer player's stick and button for this step. It watches the balloon, works out where it comes down (with
 * an error that shrinks as it gets close, and looking again now and then as the balloon drifts), lets its partner
 * take balloons that land nearer them, and bops at a comfortable height: sharp ones like a high ball near the couch,
 * to send it over fast and flat.
 */
export function cpuThink(c: Court, p: number, mind: CpuMind, rng: Rng, partner?: { p: number; human: boolean }): Stick & { a: boolean } {
  const pl = c.players[p];
  if (!pl || pl.team < 0) return { x: 0, y: 0, a: false };
  const s = mind.skill;
  const dir = forward(pl.team);
  if (c.flight !== mind.flight) {
    mind.flight = c.flight;
    mind.readAt = c.time + 0.12 + (1 - s) * 0.4 + rng() * 0.12;
    mind.lookAt = mind.readAt;
    mind.landing = null;
    mind.swingAt = null;
    const a = rng() * Math.PI * 2;
    const r = (0.08 + (1 - s) * 0.8) * Math.sqrt(rng());
    mind.err = { x: Math.cos(a) * r, z: Math.sin(a) * r * 1.6 };
    mind.eager = rng() < 0.04 + (1 - s) * 0.2;
    const flub = rng();
    const chance = VOLLEY.flub + (1 - s) * VOLLEY.flubSleepy;
    mind.flub = flub < chance * 0.5 ? 'misjudge' : flub < chance ? 'leave' : 'none';
    if (mind.flub === 'misjudge') {
      const m = 1.3 + rng() * 0.7;
      mind.err = { x: Math.cos(a) * m, z: Math.sin(a) * m };
    }
    mind.base = 1.15 + rng() * (0.45 + (1 - s) * 0.4);
    mind.spike = rng() < s * 0.8;
  }
  if (c.live && c.time >= mind.lookAt) {
    mind.lookAt = c.time + 0.25 + (1 - s) * 0.6;
    let land = predict(c.ball, pl.team, mind.base);
    mind.want = mind.base;
    if (mind.spike && land && Math.abs(land.x) < 2.3) {
      const high = predict(c.ball, pl.team, 2.0);
      if (high) {
        land = high;
        mind.want = 2.0;
      }
    }
    mind.landing = land ? { ...land, at: c.time } : null;
  }

  // Who goes for it: whoever of the two is nearer where it comes down (a person gets the benefit of the doubt).
  let goal = pl.home;
  const land = mind.landing;
  if (c.live && land) {
    const mate = partner ? c.players[partner.p] : undefined;
    const mine = Math.hypot(land.x - pl.x, land.z - pl.z);
    const theirs = mate ? Math.hypot(land.x - mate.x, land.z - mate.z) : Infinity;
    const leave = mind.flub === 'leave' && mate !== undefined && Math.abs(mine - theirs) < 1.6;
    if (!leave && mine <= theirs + (partner?.human ? -0.35 : 0)) {
      const left = Math.max(0, land.t - (c.time - land.at));
      const blur = mind.flub === 'misjudge' ? 1 : 0.25 + 0.75 * Math.min(1, left / 1.1);
      // Stand a touch behind where it comes down, so it falls in front of you.
      goal = { x: land.x + mind.err.x * blur - dir * 0.18, z: land.z + mind.err.z * blur };
    } else if (mate) {
      // Cover the other half of the court.
      goal = { x: pl.home.x, z: clamp(-mate.z * 0.8, -1.2, 1.2) };
    }
  }
  const dx = goal.x - pl.x;
  const dz = goal.z - pl.z;
  const d = Math.hypot(dx, dz);
  const top = 0.7 + 0.3 * s;
  const g = d < 0.06 ? 0 : Math.min(top, d * 2.6) / d;
  const stick: Stick = { x: dx * g, y: -dz * g };

  // Swinging.
  let a = false;
  if (c.live && c.time >= mind.readAt && c.time - pl.lastBop >= VOLLEY.cooldown) {
    const b = c.ball;
    const flat = Math.hypot(b.x - pl.x, b.z - pl.z);
    const ready = mind.eager ? flat <= VOLLEY.reach + 0.35 && b.y <= VOLLEY.high + 0.2 : canReach(pl, b);
    const time = (b.vy < 0 && b.y <= mind.want) || b.y < VOLLEY.low + 0.35;
    if (ready && time && mind.swingAt === null) {
      mind.swingAt = c.time + rng() * (0.02 + (1 - s) * 0.12);
      mind.aim = cpuAim(c, pl, rng, partner ? c.players[partner.p] : undefined);
    }
    if (mind.swingAt !== null && c.time >= mind.swingAt) {
      a = true;
      mind.swingAt = null;
      return { ...mind.aim, a };
    }
  }
  return { ...stick, a };
}

/** Where a computer player aims a bop: over the couch towards the emptier side, or a short set for its partner. */
function cpuAim(c: Court, pl: Player, rng: Rng, mate?: Player): Stick {
  const dir = forward(pl.team);
  const used = c.touchTeam === pl.team ? c.touches : 0;
  // Far back with a partner near the couch and touches to spare: a short set.
  if (mate && used === 0 && Math.abs(pl.x) > 2.7 && Math.abs(mate.x) < 2.4 && rng() < 0.35) {
    return { x: -dir * 0.7, y: -clamp((mate.z - c.ball.z) * 0.8, -0.8, 0.8) };
  }
  const them = c.players.filter((q) => q.team === 1 - pl.team);
  const middle = them.length ? them.reduce((sum, q) => sum + q.z, 0) / them.length : 0;
  const z = middle > 0 ? -1 : 1; // towards the side they are not on
  return { x: dir * (0.2 + rng() * 0.8), y: -z * (0.3 + rng() * 0.6) };
}
