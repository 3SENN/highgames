// Sock Hockey: a long hardwood hallway late at night, everyone in socks. A rolled-up pair of socks is the puck and
// each team defends a laundry basket tipped on its side at its end of the hall. Socks on floorboards barely grip,
// so you push off and glide: momentum is everything. Bump the socks to push them; Slide is a quick dash that hits
// them much harder (once a second). First to three goals, or the most when time is up.
//
// The floor is the x/z plane: the hallway runs along x, +z points at the TV audience, and a stick's y (up on the
// phone) runs away from the audience, toward -z. Team 0 defends the basket at -x (and shoots right), team 1 the
// one at +x. Physics runs at a fixed 120 steps a second.
import type { Rng } from '../rng.js';

export const SOCK = {
  duration: 40, // seconds
  toWin: 3, // goals
  step: 1 / 120,
  hall: { x: 6, z: 2 }, // half-length (to the goal lines) and half-width of the floor
  mouth: 0.8, // half-width of a basket's opening
  corner: 1, // the hall's corners are rounded off (draught excluders), so the socks never wedge in one
  postR: 0.06,
  bodyR: 0.36,
  puckR: 0.2,
  accel: 10, // push from a full stick (units a second, a second)
  drag: 0.9, // socks on wood: speed lost per second, as a fraction
  maxSpeed: 4.6,
  overSpeed: 7, // how quickly speed above the top speed bleeds away after a slide
  deadzone: 0.15,
  dashSpeed: 8,
  dashTime: 0.22, // seconds a slide counts as a slide (hits harder)
  cooldown: 1,
  buffer: 0.15, // a Slide pressed this soon before the cooldown ends still goes
  wallBounce: 0.4,
  bodyBounce: 0.5,
  puckDrag: 1.1,
  puckWall: 0.6,
  puckMax: 9,
  bump: 0.25, // how bouncy a plain bump into the socks is
  smack: 0.6, // and a slide into them
  smackKick: 1.5, // plus this much extra speed
  recoil: 0.1, // speed a skater loses hitting the socks, as a fraction of the hit
  assist: 2.5, // a goal goes to the scoring team's last touch if it was this recent (seconds)
  cheer: 1.8, // seconds after a goal before everyone lines up again
  drop: 0.7, // seconds to glide back to the starting spots
} as const;

export interface Stick {
  x: number;
  y: number;
  /** A press of Slide (the rising edge, latched by the TV until the physics has stepped with it). */
  a: boolean;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

export interface Skater {
  team: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Heading in the x/z plane (0 faces +z, the audience; π/2 faces +x). */
  face: number;
  /** Seconds of slide left. */
  dash: number;
  cool: number;
  /** A Slide press waiting for the cooldown to end. */
  queued: number;
  touching: boolean;
  homeX: number;
  homeZ: number;
  goals: number;
  owns: number;
  hits: number;
  dashes: number;
}

export interface Puck {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** The seat (position) that touched the socks last. */
  last: number | null;
  /** Each team's last touch: who, and when. */
  touch: ({ seat: number; at: number } | null)[];
}

export type Phase = 'play' | 'goal' | 'drop' | 'over';

export interface Rink {
  skaters: Skater[];
  puck: Puck;
  /** Seat positions per side: teams[0] defends -x, teams[1] defends +x. */
  teams: number[][];
  score: [number, number];
  /** Seconds since the start (the clock runs through celebrations too). */
  time: number;
  phase: Phase;
  phaseT: number;
  acc: number;
}

export interface Goal {
  /** The team that scored. */
  team: number;
  /** Who touched the socks last (null: nobody). */
  by: number | null;
  /** Knocked into their own basket. */
  own: boolean;
  /** Which basket: -1 left, +1 right. */
  side: number;
}

export interface SockEvents {
  steps: number;
  dashes: number[];
  hits: { seat: number; power: number; dash: boolean }[];
  bumps: { a: number; b: number; power: number }[];
  walls: { seat: number; power: number }[];
  /** The hardest the socks hit a wall this frame (0: they didn't). */
  puckWall: number;
  post: boolean;
  goal: Goal | null;
  /** New socks in the middle; everyone glides back to their spots. */
  reset: boolean;
  /** Play resumes. */
  go: boolean;
  over: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const H = SOCK.hall;
const R = SOCK.bodyR;
const PR = SOCK.puckR;

function noEvents(): SockEvents {
  return { steps: 0, dashes: [], hits: [], bumps: [], walls: [], puckWall: 0, post: false, goal: null, reset: false, go: false, over: false };
}

/** Where member `k` of a team of `size` lines up. Team 1's spots mirror team 0's through the middle. */
export function spotFor(team: number, k: number, size: number): { x: number; z: number } {
  let x: number;
  let z: number;
  if (size <= 1) {
    x = 2.4;
    z = 0;
  } else if (k === 0) {
    x = 1.9;
    z = 0.7;
  } else if (k === 1) {
    x = 4.1;
    z = -0.5;
  } else {
    x = 3.1;
    z = k % 2 ? 1.3 : -1.3;
  }
  const s = team === 0 ? -1 : 1;
  return { x: s * x, z: s * z };
}

function freshPuck(): Puck {
  return { x: 0, z: 0, vx: 0, vz: 0, last: null, touch: [null, null] };
}

/** A new game. `teams`: seat positions per side (as teamsOf gives them); `seats`: how many seats there are. */
export function newRink(teams: readonly (readonly number[])[], seats: number): Rink {
  const sides = [teams[0] ?? [], teams[1] ?? []].map((t) => t.filter((p) => p >= 0 && p < seats));
  // Anyone not on a side (shouldn't happen) joins the smaller one.
  for (let p = 0; p < seats; p++) {
    if (sides.some((t) => t.includes(p))) continue;
    const small = (sides[0]?.length ?? 0) <= (sides[1]?.length ?? 0) ? 0 : 1;
    sides[small]?.push(p);
  }
  const skaters: Skater[] = [];
  for (let p = 0; p < seats; p++) {
    const team = sides[0]?.includes(p) ? 0 : 1;
    const members = sides[team] ?? [];
    const spot = spotFor(team, members.indexOf(p), members.length);
    skaters.push({
      team,
      x: spot.x,
      z: spot.z,
      vx: 0,
      vz: 0,
      face: team === 0 ? Math.PI / 2 : -Math.PI / 2,
      dash: 0,
      cool: 0,
      queued: 0,
      touching: false,
      homeX: spot.x,
      homeZ: spot.z,
      goals: 0,
      owns: 0,
      hits: 0,
      dashes: 0,
    });
  }
  return { skaters, puck: freshPuck(), teams: sides, score: [0, 0], time: 0, phase: 'play', phaseT: 0, acc: 0 };
}

export function isOver(r: Rink): boolean {
  return r.phase === 'over';
}

/** The winning team, or -1 for a draw. */
export function winner(r: Rink): number {
  if (r.score[0] === r.score[1]) return -1;
  return r.score[0] > r.score[1] ? 0 : 1;
}

/** Scores per seat: the team's goals, the same for both partners. */
export function sockScores(r: Rink): number[] {
  return r.skaters.map((s) => r.score[s.team] ?? 0);
}

// ------------------------------------------------------------------ physics

function keepIn(s: Skater, i: number, ev: SockEvents | null): void {
  const bx = H.x - R;
  const bz = H.z - R;
  if (Math.abs(s.x) > bx) {
    const side = Math.sign(s.x);
    s.x = side * bx;
    if (s.vx * side > 0) {
      if (ev && Math.abs(s.vx) > 2.2) ev.walls.push({ seat: i, power: Math.abs(s.vx) });
      s.vx = -s.vx * SOCK.wallBounce;
    }
  }
  if (Math.abs(s.z) > bz) {
    const side = Math.sign(s.z);
    s.z = side * bz;
    if (s.vz * side > 0) {
      if (ev && Math.abs(s.vz) > 2.2) ev.walls.push({ seat: i, power: Math.abs(s.vz) });
      s.vz = -s.vz * SOCK.wallBounce;
    }
  }
  const hit = rounded(s, R, SOCK.wallBounce);
  if (ev && hit > 2.2) ev.walls.push({ seat: i, power: hit });
}

/**
 * Keeps a body of radius `rb` inside the hall's rounded corners, bouncing it off. Returns the speed it hit with
 * (0: it didn't).
 */
function rounded(o: { x: number; z: number; vx: number; vz: number }, rb: number, bounce: number): number {
  const cx = H.x - SOCK.corner;
  const cz = H.z - SOCK.corner;
  if (Math.abs(o.x) <= cx || Math.abs(o.z) <= cz) return 0;
  const sx = Math.sign(o.x);
  const sz = Math.sign(o.z);
  const dx = o.x - sx * cx;
  const dz = o.z - sz * cz;
  const d = Math.hypot(dx, dz);
  const max = SOCK.corner - rb;
  if (d <= max) return 0;
  const nx = dx / d;
  const nz = dz / d;
  o.x = sx * cx + nx * max;
  o.z = sz * cz + nz * max;
  const vn = o.vx * nx + o.vz * nz;
  if (vn <= 0) return 0;
  o.vx -= (1 + bounce) * vn * nx;
  o.vz -= (1 + bounce) * vn * nz;
  return vn;
}

/** Whether a skater could stand at (x, z). */
export function reachable(x: number, z: number, slack = 0.02): boolean {
  const bx = H.x - R + slack;
  const bz = H.z - R + slack;
  if (Math.abs(x) > bx || Math.abs(z) > bz) return false;
  const cx = H.x - SOCK.corner;
  const cz = H.z - SOCK.corner;
  if (Math.abs(x) <= cx || Math.abs(z) <= cz) return true;
  return Math.hypot(Math.abs(x) - cx, Math.abs(z) - cz) <= SOCK.corner - R + slack;
}

function moveSkaters(r: Rink, sticks: readonly Stick[], dt: number, ev: SockEvents, first: boolean): void {
  const drag = Math.exp(-SOCK.drag * dt);
  r.skaters.forEach((s, i) => {
    s.cool = Math.max(0, s.cool - dt);
    s.dash = Math.max(0, s.dash - dt);
    s.queued = Math.max(0, s.queued - dt);
    if (r.phase === 'drop') {
      // Gliding back to the starting spots.
      const k = 1 - Math.exp(-10 * dt);
      s.x += (s.homeX - s.x) * k;
      s.z += (s.homeZ - s.z) * k;
      s.vx = s.vz = 0;
      s.dash = 0;
      s.queued = 0;
      s.face = s.team === 0 ? Math.PI / 2 : -Math.PI / 2;
      return;
    }
    const st = sticks[i] ?? IDLE;
    if (first && st.a) s.queued = SOCK.buffer;
    const mag = Math.hypot(st.x, st.y);
    const push = mag < SOCK.deadzone ? 0 : (Math.min(1, mag) - SOCK.deadzone) / (1 - SOCK.deadzone);
    const ux = mag > 1e-6 ? st.x / mag : 0;
    const uz = mag > 1e-6 ? -st.y / mag : 0;
    if (s.queued > 0 && s.cool <= 0) {
      // Slide the way the stick points; with the stick let go, the way you're already going (or facing).
      let dx = ux;
      let dz = uz;
      if (push <= 0) {
        const sp = Math.hypot(s.vx, s.vz);
        if (sp > 0.5) {
          dx = s.vx / sp;
          dz = s.vz / sp;
        } else {
          dx = Math.sin(s.face);
          dz = Math.cos(s.face);
        }
      }
      const speed = Math.max(SOCK.dashSpeed, s.vx * dx + s.vz * dz);
      s.vx = dx * speed;
      s.vz = dz * speed;
      s.dash = SOCK.dashTime;
      s.cool = SOCK.cooldown;
      s.queued = 0;
      s.dashes += 1;
      ev.dashes.push(i);
    }
    s.vx = (s.vx + ux * push * SOCK.accel * dt) * drag;
    s.vz = (s.vz + uz * push * SOCK.accel * dt) * drag;
    const sp = Math.hypot(s.vx, s.vz);
    if (s.dash <= 0 && sp > SOCK.maxSpeed) {
      const k = Math.max(SOCK.maxSpeed, sp - SOCK.overSpeed * dt) / sp;
      s.vx *= k;
      s.vz *= k;
    }
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    if (sp > 0.3) s.face = Math.atan2(s.vx, s.vz);
    keepIn(s, i, ev);
  });
}

/** Skaters bump off each other (soft, equal weights). */
function bumpSkaters(r: Rink, ev: SockEvents): void {
  const list = r.skaters;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as Skater;
      const b = list[j] as Skater;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d >= 2 * R) continue;
      if (d < 1e-6) {
        dx = 1;
        dz = 0;
        d = 1e-6;
      }
      const nx = d > 1e-5 ? dx / d : 1;
      const nz = d > 1e-5 ? dz / d : 0;
      const overlap = 2 * R - d;
      a.x -= (nx * overlap) / 2;
      a.z -= (nz * overlap) / 2;
      b.x += (nx * overlap) / 2;
      b.z += (nz * overlap) / 2;
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rel < 0) {
        const k = (-(1 + SOCK.bodyBounce) * rel) / 2;
        a.vx -= k * nx;
        a.vz -= k * nz;
        b.vx += k * nx;
        b.vz += k * nz;
        if (-rel > 1.8) ev.bumps.push({ a: i, b: j, power: -rel });
      }
      keepIn(a, i, null);
      keepIn(b, j, null);
    }
  }
}

function scoreGoal(r: Rink, side: number, ev: SockEvents): void {
  const p = r.puck;
  // The basket on the right is team 1's, so a goal there is team 0's.
  const team = side > 0 ? 0 : 1;
  r.score[team] += 1;
  // A shot that clips a defender on its way in is still the shooter's goal; it's only an own basket if the
  // scoring team hadn't touched the socks for a while.
  const mine = p.touch[team];
  const credit = mine && r.time - mine.at < SOCK.assist;
  const by = credit ? mine.seat : p.last;
  const own = !credit && by !== null && r.skaters[by]?.team !== team;
  const who = by !== null ? r.skaters[by] : undefined;
  if (who) {
    if (own) who.owns += 1;
    else who.goals += 1;
  }
  ev.goal = { team, by, own, side };
  r.phase = 'goal';
  r.phaseT = 0;
  p.x = side * (H.x + 0.45);
  p.z = clamp(p.z, -0.5, 0.5);
  p.vx = p.vz = 0;
}

function movePuck(r: Rink, dt: number, ev: SockEvents): void {
  const p = r.puck;
  const drag = Math.exp(-SOCK.puckDrag * dt);
  p.vx *= drag;
  p.vz *= drag;
  p.x += p.vx * dt;
  p.z += p.vz * dt;

  // Skaters: a bump pushes the socks on; a slide sends them flying.
  const reach = R + PR;
  r.skaters.forEach((s, i) => {
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d >= reach) {
      s.touching = false;
      return;
    }
    const nx = d > 1e-6 ? dx / d : Math.sin(s.face);
    const nz = d > 1e-6 ? dz / d : Math.cos(s.face);
    p.x = s.x + nx * reach;
    p.z = s.z + nz * reach;
    const rel = (p.vx - s.vx) * nx + (p.vz - s.vz) * nz;
    if (rel < 0) {
      const dash = s.dash > 0;
      const e = dash ? SOCK.smack : SOCK.bump;
      p.vx -= (1 + e) * rel * nx;
      p.vz -= (1 + e) * rel * nz;
      if (dash) {
        p.vx += nx * SOCK.smackKick;
        p.vz += nz * SOCK.smackKick;
      }
      s.vx += rel * nx * SOCK.recoil;
      s.vz += rel * nz * SOCK.recoil;
      if (!s.touching || dash) {
        ev.hits.push({ seat: i, power: -rel, dash });
        s.hits += 1;
      }
    }
    s.touching = true;
    p.last = i;
    p.touch[s.team] = { seat: i, at: r.time };
  });
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > SOCK.puckMax) {
    p.vx *= SOCK.puckMax / sp;
    p.vz *= SOCK.puckMax / sp;
  }

  // The long walls.
  const bz = H.z - PR;
  if (Math.abs(p.z) > bz) {
    const side = Math.sign(p.z);
    p.z = side * bz;
    if (p.vz * side > 0) {
      ev.puckWall = Math.max(ev.puckWall, Math.abs(p.vz));
      p.vz = -p.vz * SOCK.puckWall;
    }
  }
  // The baskets' edges.
  for (const px of [-H.x, H.x]) {
    for (const pz of [-SOCK.mouth, SOCK.mouth]) {
      const dx = p.x - px;
      const dz = p.z - pz;
      const d = Math.hypot(dx, dz);
      const min = PR + SOCK.postR;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d;
      const nz = dz / d;
      p.x = px + nx * min;
      p.z = pz + nz * min;
      const rel = p.vx * nx + p.vz * nz;
      if (rel < 0) {
        p.vx -= (1 + SOCK.puckWall) * rel * nx;
        p.vz -= (1 + SOCK.puckWall) * rel * nz;
        ev.post = true;
      }
    }
  }
  // The ends: into the basket through its mouth, off the wall beside it.
  if (Math.abs(p.x) > H.x - PR) {
    const side = Math.sign(p.x);
    if (Math.abs(p.z) < SOCK.mouth) {
      if (Math.abs(p.x) > H.x) {
        scoreGoal(r, side, ev);
        return;
      }
    } else {
      p.x = side * (H.x - PR);
      if (p.vx * side > 0) {
        ev.puckWall = Math.max(ev.puckWall, Math.abs(p.vx));
        p.vx = -p.vx * SOCK.puckWall;
      }
    }
  }
  ev.puckWall = Math.max(ev.puckWall, rounded(p, PR, SOCK.puckWall));
  // Socks pinned against a wall push the skater back instead.
  r.skaters.forEach((s, i) => {
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d >= reach || d < 1e-6) return;
    s.x = p.x + (dx / d) * reach;
    s.z = p.z + (dz / d) * reach;
    keepIn(s, i, null);
  });
}

function stepRink(r: Rink, sticks: readonly Stick[], dt: number, ev: SockEvents, first: boolean): void {
  r.time += dt;
  r.phaseT += dt;
  if (r.phase === 'goal' && r.phaseT >= SOCK.cheer) {
    if (r.score.some((s) => s >= SOCK.toWin) || r.time >= SOCK.duration) {
      r.phase = 'over';
      ev.over = true;
      return;
    }
    r.phase = 'drop';
    r.phaseT = 0;
    r.puck = freshPuck();
    ev.reset = true;
  } else if (r.phase === 'drop' && r.phaseT >= SOCK.drop) {
    for (const s of r.skaters) {
      s.x = s.homeX;
      s.z = s.homeZ;
      s.vx = s.vz = 0;
    }
    r.phase = 'play';
    r.phaseT = 0;
    ev.go = true;
  }
  if (r.phase !== 'goal' && r.time >= SOCK.duration) {
    r.phase = 'over';
    ev.over = true;
    return;
  }
  moveSkaters(r, sticks, dt, ev, first);
  bumpSkaters(r, ev);
  if (r.phase === 'play') movePuck(r, dt, ev);
}

/**
 * Advances the game by `dt` seconds in fixed steps of 1/120 s (a long frame is capped at 0.6 s). Slide presses
 * (`a`) count once, on the first step. Returns what happened, for sounds and words on screen.
 */
export function advance(r: Rink, sticks: readonly Stick[], dt: number): SockEvents {
  const ev = noEvents();
  r.acc += Math.min(Math.max(0, dt), 0.6);
  // (A hair of slack, so 0.5 s really is 60 steps despite rounding.)
  while (r.acc >= SOCK.step - 1e-9 && !isOver(r)) {
    r.acc -= SOCK.step;
    stepRink(r, sticks, SOCK.step, ev, ev.steps === 0);
    ev.steps += 1;
  }
  return ev;
}

// ------------------------------------------------------------------ computer players

export interface Brain {
  skill: number;
  /** Game time of the next decision: sleepy players react late. */
  next: number;
  x: number;
  y: number;
  press: boolean;
  /** Going for the socks (or hanging back to mind the basket). */
  attack: boolean;
  /** Where in the basket's mouth they aim. */
  aimZ: number;
}

export function newBrain(skill: number, rng: Rng): Brain {
  return { skill: clamp(skill, 0, 1), next: rng() * 0.2, x: 0, y: 0, press: false, attack: false, aimZ: 0 };
}

/**
 * Steers toward (tx, tz): mostly pointing the stick where they want to be (so they slide past it a bit), with a
 * touch of minding their momentum. Sleepy players wobble and push off lazily.
 */
function steer(me: Skater, b: Brain, tx: number, tz: number, hurry: boolean, rng: Rng): void {
  const s = b.skill;
  const ex = tx - me.x;
  const ez = tz - me.z;
  const d = Math.hypot(ex, ez);
  let sx = 0;
  let sz = 0;
  if (d > 1e-3) {
    const want = hurry ? SOCK.maxSpeed : Math.min(SOCK.maxSpeed, d * (1.4 + 2.2 * s));
    const dx = ex / d;
    const dz = ez / d;
    // The push that keeps that speed up against the drag, plus a correction toward the velocity wanted.
    const keep = (want * SOCK.drag) / SOCK.accel;
    const smartX = dx * (want + keep) - me.vx;
    const smartZ = dz * (want + keep) - me.vz;
    const naive = Math.min(1, d / 0.4);
    const k = 0.3;
    sx = dx * naive * (1 - k) + smartX * k;
    sz = dz * naive * (1 - k) + smartZ * k;
  }
  sx += (rng() - 0.5) * (1 - s) * 0.7;
  sz += (rng() - 0.5) * (1 - s) * 0.7;
  // Sleepy players push off lazily, never quite at full tilt.
  const top = 0.5 + 0.5 * s;
  const m = Math.hypot(sx, sz);
  if (m > top) {
    sx *= top / m;
    sz *= top / m;
  }
  b.x = sx;
  b.y = -sz;
}

const BACK = R + PR + 0.35; // how far behind the socks a skater lines up

/**
 * The way to push socks at (px, pz) toward (gx, gz): straight at it if a skater can get behind them, otherwise
 * (socks against a wall) the nearest way that can be reached, along the wall, round the rounded corner.
 */
export function pushLine(px: number, pz: number, gx: number, gz: number): { ux: number; uz: number } {
  let ix = gx - px;
  let iz = gz - pz;
  const il = Math.hypot(ix, iz) || 1;
  ix /= il;
  iz /= il;
  if (reachable(px - ix * BACK, pz - iz * BACK)) return { ux: ix, uz: iz };
  let best = { ux: ix, uz: iz };
  let score = -Infinity;
  const base = Math.atan2(iz, ix);
  for (let k = 1; k < 36; k++) {
    // Fan out from the ideal line, both ways round.
    const a = base + Math.ceil(k / 2) * (Math.PI / 18) * (k % 2 ? 1 : -1);
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    if (!reachable(px - ux * BACK, pz - uz * BACK)) continue;
    const sc = ux * ix + uz * iz;
    if (sc > score) {
      score = sc;
      best = { ux, uz };
    }
  }
  return best;
}

/** A waypoint that takes a skater round the socks at (px, pz) on the way to (tx, tz), if they're in the way. */
function around(me: Skater, tx: number, tz: number, px: number, pz: number): { tx: number; tz: number } {
  const sx = tx - me.x;
  const sz = tz - me.z;
  const l2 = sx * sx + sz * sz;
  if (l2 < 1e-6) return { tx, tz };
  const t = clamp(((px - me.x) * sx + (pz - me.z) * sz) / l2, 0, 1);
  const clear = R + PR + 0.2;
  if (Math.hypot(px - (me.x + sx * t), pz - (me.z + sz * t)) >= clear) return { tx, tz };
  const l = Math.sqrt(l2);
  const nx = -sz / l;
  const nz = sx / l;
  const side = (px - me.x) * nx + (pz - me.z) * nz >= 0 ? 1 : -1;
  const out = clear + 0.3;
  const wx = px - nx * side * out;
  const wz = pz - nz * side * out;
  if (reachable(wx, wz, -0.05)) return { tx: wx, tz: wz };
  return { tx: px + nx * side * out, tz: pz + nz * side * out };
}

function think(r: Rink, i: number, b: Brain, rng: Rng): void {
  const me = r.skaters[i];
  if (!me) return;
  const s = b.skill;
  b.press = false;
  if (r.phase !== 'play') {
    // A little victory wiggle after a goal; otherwise wait.
    const scored = r.phase === 'goal' && (r.puck.x > 0 ? 0 : 1) === me.team;
    b.x = scored ? Math.sin(r.time * 2 + i) * 0.5 : 0;
    b.y = scored ? Math.cos(r.time * 2 + i) * 0.5 : 0;
    return;
  }
  const p = r.puck;
  const fwd = me.team === 0 ? 1 : -1;
  const oppX = fwd * H.x;
  const ownX = -fwd * H.x;
  // Where the socks will be in a moment (sliding to a stop).
  const lead = 0.12;
  const glide = (1 - Math.exp(-SOCK.puckDrag * lead)) / SOCK.puckDrag;
  const px = clamp(p.x + p.vx * glide, -H.x + PR, H.x - PR);
  const pz = clamp(p.z + p.vz * glide, -H.z + PR, H.z - PR);

  // Whoever on the team is best placed goes for the socks (closest, and not stuck on the wrong side of them). The
  // second member of a pair likes to stay back while the socks are up the other end.
  const mates = r.teams[me.team] ?? [i];
  const cost = (k: number) => {
    const m = r.skaters[k];
    if (!m) return Infinity;
    const wrong = (m.x - px) * fwd > 0.3 ? 1.2 : 0;
    const back = mates.length > 1 && k === mates[1] && px * fwd > 0.5 ? 2.5 : 0;
    return Math.hypot(m.x - px, m.z - pz) + wrong + back - (k === i && b.attack ? 0.6 : 0);
  };
  let best = i;
  for (const k of mates) if (cost(k) < cost(best)) best = k;
  b.attack = best === i;

  let tx: number;
  let tz: number;
  let hurry = false;
  let drive = false;
  if (b.attack) {
    if (rng() < 0.12 + 0.2 * (1 - s)) b.aimZ = (rng() - 0.5) * 2 * (0.25 + (1 - s) * 0.9);
    const { ux, uz } = pushLine(px, pz, oppX, clamp(b.aimZ, -1.2, 1.2));
    const ox = me.x - px;
    const oz = me.z - pz;
    const along = ox * ux + oz * uz; // below zero: on the good side of the socks
    const side = -ox * uz + oz * ux; // across the line to the basket
    if (along < -0.05 && Math.abs(side) < 0.3 + 0.15 * s) {
      // Lined up: drive through the socks toward the basket, and slide when close.
      tx = px + ux * 1.5;
      tz = pz + uz * 1.5;
      hurry = true;
      drive = true;
      const dist = Math.hypot(ox, oz);
      if (me.cool <= 0 && dist < 1.3 + s && Math.abs(side) < 0.18 + (1 - s) * 0.2 && rng() < 0.3 + 0.6 * s) b.press = true;
    } else {
      tx = px - ux * BACK;
      tz = pz - uz * BACK;
      hurry = true;
    }
  } else {
    // Hang back between the socks and our basket.
    const out = clamp((px - ownX) * fwd * 0.28, 0.8, 3.2);
    tx = ownX + fwd * out;
    tz = clamp(pz * 0.45, -SOCK.mouth - 0.2, SOCK.mouth + 0.2);
  }
  // Getting there: go round the socks rather than knock them the wrong way (sleepy ones don't always bother).
  if (!drive && rng() < 0.4 + 0.6 * s) ({ tx, tz } = around(me, tx, tz, p.x, p.z));
  tx = clamp(tx, -H.x + R, H.x - R);
  tz = clamp(tz, -H.z + R, H.z - R);
  steer(me, b, tx, tz, hurry, rng);
  // Now and then a sleepy one slides for no reason at all.
  if (!b.press && me.cool <= 0 && rng() < (1 - s) * 0.03) b.press = true;
}

/** A computer skater's stick for this frame. The Slide press comes once per decision. */
export function cpuStick(r: Rink, i: number, b: Brain, rng: Rng): Stick {
  if (r.time >= b.next) {
    think(r, i, b, rng);
    b.next = r.time + 0.07 + (1 - b.skill) * 0.3 + rng() * 0.05;
  }
  const a = b.press;
  b.press = false;
  return { x: b.x, y: b.y, a };
}
