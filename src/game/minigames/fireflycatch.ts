// Firefly Jar: a meadow at dusk, two teams of two with butterfly nets. Fireflies drift about, blinking on and off;
// swing your net (Catch) to scoop them up, and every catch goes into your team's glass jar. Now and then a pair of
// golden fireflies turns up (one on each side, to be fair): they count three, but they're shy and dart off when
// someone runs at them, so tiptoe up (push the stick gently). After 35 s the brighter jar wins.
//
// Everything happens on the floor, in its x/z plane: +z points at the TV audience, and a stick's y (up on the
// phone) runs away from the audience, toward -z. Headings are measured from +z (0 faces the audience).
//  - The net reaches out in front of you: a swing sweeps a circle ahead of you (and scoops up anything right at
//    your feet). A swing can take a few fireflies at once. Then a short cooldown.
//  - Dark fireflies can still be caught: they're just harder to see.
//  - A press starts the swing as far along as half the phone's round trip, so a laggy phone isn't late.
import { createRng, type Rng } from '../rng.js';

export const FIREFLY = {
  duration: 35, // seconds
  step: 1 / 120,
  maxFrame: 0.6, // the longest frame advance() catches up on
  bounds: { x: 6.2, z: 3.3 }, // half-size of the meadow people can walk on
  bodyR: 0.34,
  run: 4.0, // units a second at full stick
  sneak: 2.0, // at or under this speed you're tiptoeing: golden fireflies don't notice you
  response: 9, // how quickly walking follows the stick
  turn: 14, // radians a second
  deadzone: 0.15,
  reach: 0.95, // the net's middle, ahead of your middle
  netR: 0.6, // the net sweeps a circle this big
  scoop: 0.45, // anything this close to your middle is caught too
  swing: 0.34, // seconds a swing lasts
  hitFrom: 0.07, // the net sweeps through between these two moments of the swing
  hitTo: 0.21,
  cooldown: 0.9, // seconds from one swing to the next
  buffer: 0.12, // a press this close to the end of the cooldown waits for it
  maxLag: 0.15, // the most round-trip compensation a phone gets, in seconds
  maxPerSwing: 2,
  flies: 12, // ordinary fireflies about at the start (six on each side)
  rise: 0.5, // seconds a new firefly takes to rise out of the grass (it can't be caught yet)
  respawn: [1.2, 2.6] as const, // seconds before a caught firefly is replaced by a new one
  drift: 0.8, // how fast ordinary fireflies wander
  lit: [1.0, 2.2] as const, // seconds on
  dark: [0.5, 1.3] as const, // seconds off
  goldLit: [1.6, 2.6] as const,
  goldDark: [0.35, 0.7] as const,
  goldValue: 3,
  goldWaves: [4, 12.5, 21, 28.5] as const, // when a pair of golden fireflies turns up
  goldLife: 8.5, // seconds before an uncaught golden one floats off
  goldDrift: 0.35,
  notice: 2.6, // golden fireflies notice someone running at them from this far
  flit: 5.2, // the speed a startled golden firefly darts off at
  flitFor: 0.65, // seconds it darts for
  spawnClear: 1.8, // new fireflies rise at least this far from everyone
} as const;

export interface Stick {
  x: number;
  y: number;
  /** The Catch button was pressed (a rising edge, once). */
  a: boolean;
}

export const IDLE: Stick = { x: 0, y: 0, a: false };

export interface Fly {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  /** How fast its heading is turning (wandering). */
  turnRate: number;
  gold: boolean;
  lit: boolean;
  /** Seconds until it switches on or off. */
  blink: number;
  /** Seconds left rising out of the grass. */
  rise: number;
  /** Seconds left darting off after being startled. */
  flit: number;
  /** Seconds until a golden one floats off (Infinity for ordinary ones). */
  life: number;
}

export interface Catcher {
  /** The team (index into the teams), or -1. */
  team: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Heading in the x/z plane (0 faces +z). */
  face: number;
  /** Seconds into the current swing, or -1. */
  swing: number;
  /** Seconds until the net is ready again. */
  cool: number;
  /** A press waiting for the cooldown to end (and the head start it gets). */
  queued: number | null;
  /** Fireflies caught this swing. */
  netted: number;
  caught: number;
  golds: number;
  spooks: number;
  whiffs: number;
}

export interface Jar {
  /** What it's worth: ordinary fireflies count one, golden ones three. */
  value: number;
  flies: number;
  golds: number;
}

export interface Meadow {
  time: number;
  acc: number;
  catchers: Catcher[];
  flies: Fly[];
  jars: Jar[];
  nextId: number;
  /** Game times at which a new ordinary firefly rises. */
  pending: number[];
  /** Golden waves so far. */
  wave: number;
  rng: Rng;
}

export interface Catch {
  seat: number;
  team: number;
  id: number;
  gold: boolean;
  x: number;
  z: number;
}

export interface FlyEvents {
  /** Physics steps taken (presses only count once a step has used them). */
  steps: number;
  swings: number[];
  catches: Catch[];
  /** Swings that caught nothing. */
  whiffs: number[];
  /** Golden fireflies startled by someone running at them. */
  spooked: { seat: number; id: number }[];
  /** New fireflies (ids). */
  risen: number[];
  /** A pair of golden fireflies turned up. */
  goldIn: boolean;
  /** Golden fireflies that floated off uncaught (ids). */
  goldOff: number[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const between = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + rng() * (hi - lo);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function noEvents(): FlyEvents {
  return { steps: 0, swings: [], catches: [], whiffs: [], spooked: [], risen: [], goldIn: false, goldOff: [] };
}

export function isOver(m: Meadow): boolean {
  return m.time >= FIREFLY.duration;
}

/** What a firefly is worth in the jar. */
export function flyValue(f: Pick<Fly, 'gold'>): number {
  return f.gold ? FIREFLY.goldValue : 1;
}

/** Where team `team` starts: by its own jar (team 0 on the left, team 1 on the right). */
export function startSpot(team: number, k: number, size: number): { x: number; z: number } {
  const side = team === 0 ? -1 : 1;
  const z = size <= 1 ? 0 : -1.2 + (2.4 * k) / (size - 1);
  return { x: side * (FIREFLY.bounds.x - 1.6), z };
}

function fly(m: Meadow, x: number, z: number, gold: boolean, rise: number, blink: number, lit: boolean, heading: number): Fly {
  const f: Fly = { id: m.nextId++, x, z, vx: 0, vz: 0, heading, turnRate: 0, gold, lit, blink, rise, flit: 0, life: gold ? FIREFLY.goldLife : Infinity };
  m.flies.push(f);
  return f;
}

/**
 * A new meadow: everyone by their own jar, and twelve fireflies, six on each side, the right half a mirror of
 * the left (so neither team starts luckier). `teams` holds seat positions.
 */
export function newMeadow(teams: readonly (readonly number[])[], seats: number, rng: Rng): Meadow {
  const own = createRng(Math.floor(rng() * 0xffffffff));
  const catchers: Catcher[] = Array.from({ length: seats }, () => ({
    team: -1,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    face: 0,
    swing: -1,
    cool: 0,
    queued: null,
    netted: 0,
    caught: 0,
    golds: 0,
    spooks: 0,
    whiffs: 0,
  }));
  teams.forEach((members, team) =>
    members.forEach((p, k) => {
      const c = catchers[p];
      if (!c) return;
      const spot = startSpot(team, k, members.length);
      c.team = team;
      c.x = spot.x;
      c.z = spot.z;
      c.face = team === 0 ? Math.PI / 2 : -Math.PI / 2; // looking into the meadow
    }),
  );
  const m: Meadow = { time: 0, acc: 0, catchers, flies: [], jars: teams.map(() => ({ value: 0, flies: 0, golds: 0 })), nextId: 0, pending: [], wave: 0, rng: own };
  const { x: bx, z: bz } = FIREFLY.bounds;
  for (let k = 0; k < FIREFLY.flies / 2; k++) {
    const x = -(0.7 + own() * (bx - 1.4));
    const z = (own() * 2 - 1) * (bz - 0.4);
    const lit = own() < 0.6;
    const blink = between(own, lit ? FIREFLY.lit : FIREFLY.dark);
    const heading = own() * Math.PI * 2;
    fly(m, x, z, false, 0, blink, lit, heading);
    fly(m, -x, z, false, 0, blink, lit, -heading);
  }
  return m;
}

/** A spot for a new firefly: inside the meadow and clear of everyone (the best of a few tries). */
function clearSpot(m: Meadow, rng: Rng, xFrom: number, xTo: number): { x: number; z: number } {
  let best = { x: 0, z: 0 };
  let bestGap = -1;
  for (let k = 0; k < 10; k++) {
    const x = xFrom + rng() * (xTo - xFrom);
    const z = (rng() * 2 - 1) * (FIREFLY.bounds.z - 0.4);
    let gap = Infinity;
    for (const c of m.catchers) if (c.team >= 0) gap = Math.min(gap, Math.hypot(c.x - x, c.z - z));
    if (gap >= FIREFLY.spawnClear) return { x, z };
    if (gap > bestGap) {
      bestGap = gap;
      best = { x, z };
    }
  }
  return best;
}

function spawnOrdinary(m: Meadow, ev: FlyEvents): void {
  const bx = FIREFLY.bounds.x - 0.5;
  const { x, z } = clearSpot(m, m.rng, -bx, bx);
  const lit = m.rng() < 0.7;
  const f = fly(m, x, z, false, FIREFLY.rise, between(m.rng, lit ? FIREFLY.lit : FIREFLY.dark), lit, m.rng() * Math.PI * 2);
  ev.risen.push(f.id);
}

/** A pair of golden fireflies: one on each side, mirrored, each clear of the people on its side if it can be. */
function spawnGolden(m: Meadow, ev: FlyEvents): void {
  const { x, z } = clearSpot(m, m.rng, -(FIREFLY.bounds.x - 1.6), -1.4);
  const blink = between(m.rng, FIREFLY.goldLit);
  const heading = m.rng() * Math.PI * 2;
  const a = fly(m, x, z, true, FIREFLY.rise, blink, true, heading);
  const b = fly(m, -x, z, true, FIREFLY.rise, blink, true, -heading);
  ev.risen.push(a.id, b.id);
  ev.goldIn = true;
}

function moveCatcher(c: Catcher, s: Stick, dt: number): void {
  const mag = Math.hypot(s.x, s.y);
  const k = mag < FIREFLY.deadzone ? 0 : Math.min(1, (mag - FIREFLY.deadzone) / (1 - FIREFLY.deadzone)) / mag;
  const wantX = s.x * k * FIREFLY.run;
  const wantZ = -s.y * k * FIREFLY.run;
  const follow = 1 - Math.exp(-FIREFLY.response * dt);
  c.vx += (wantX - c.vx) * follow;
  c.vz += (wantZ - c.vz) * follow;
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  const { x: bx, z: bz } = FIREFLY.bounds;
  if (Math.abs(c.x) > bx) {
    c.x = clamp(c.x, -bx, bx);
    c.vx = 0;
  }
  if (Math.abs(c.z) > bz) {
    c.z = clamp(c.z, -bz, bz);
    c.vz = 0;
  }
  // Turn to face where the stick points (so you can turn on the spot to line up the net).
  if (k > 0) {
    const want = Math.atan2(s.x, -s.y);
    const d = wrap(want - c.face);
    const most = FIREFLY.turn * dt;
    c.face = wrap(c.face + clamp(d, -most, most));
  }
}

function moveFly(m: Meadow, f: Fly, dt: number): void {
  const rng = m.rng;
  f.blink -= dt;
  if (f.blink <= 0) {
    f.lit = !f.lit;
    f.blink = between(rng, f.gold ? (f.lit ? FIREFLY.goldLit : FIREFLY.goldDark) : f.lit ? FIREFLY.lit : FIREFLY.dark);
  }
  f.rise = Math.max(0, f.rise - dt);
  const { x: bx, z: bz } = FIREFLY.bounds;
  if (f.flit > 0) {
    f.flit = Math.max(0, f.flit - dt);
    const slow = Math.exp(-2.2 * dt);
    f.vx *= slow;
    f.vz *= slow;
  } else {
    // A lazy wander: the heading drifts, and turns back toward the middle near the edges.
    f.turnRate = clamp(f.turnRate + (rng() - 0.5) * 7 * dt, -1.6, 1.6);
    f.heading = wrap(f.heading + f.turnRate * dt);
    const edge = Math.abs(f.x) > bx - 0.8 || Math.abs(f.z) > bz - 0.6;
    if (edge) {
      const home = Math.atan2(-f.x, -f.z * 1.8);
      f.heading = wrap(f.heading + clamp(wrap(home - f.heading), -2.5 * dt, 2.5 * dt));
    }
    const speed = f.gold ? FIREFLY.goldDrift : FIREFLY.drift;
    const follow = 1 - Math.exp(-3 * dt);
    f.vx += (Math.sin(f.heading) * speed - f.vx) * follow;
    f.vz += (Math.cos(f.heading) * speed - f.vz) * follow;
  }
  f.x += f.vx * dt;
  f.z += f.vz * dt;
  if (Math.abs(f.x) > bx) {
    f.x = clamp(f.x, -bx, bx);
    f.vx = -f.vx * 0.5;
    f.heading = Math.atan2(f.vx, f.vz);
  }
  if (Math.abs(f.z) > bz) {
    f.z = clamp(f.z, -bz, bz);
    f.vz = -f.vz * 0.5;
    f.heading = Math.atan2(f.vx, f.vz);
  }
}

/** Is `c` running at golden firefly `f`, close enough for it to notice? */
export function startles(c: Pick<Catcher, 'x' | 'z' | 'vx' | 'vz'>, f: Pick<Fly, 'x' | 'z'>): boolean {
  const dx = f.x - c.x;
  const dz = f.z - c.z;
  const d = Math.hypot(dx, dz);
  if (d >= FIREFLY.notice || d < 1e-6) return false;
  const speed = Math.hypot(c.vx, c.vz);
  if (speed <= FIREFLY.sneak) return false;
  return (c.vx * dx + c.vz * dz) / (speed * d) > 0.3;
}

/** Where the middle of `c`'s net sweeps. */
export function netAt(c: Pick<Catcher, 'x' | 'z' | 'face'>): { x: number; z: number } {
  return { x: c.x + Math.sin(c.face) * FIREFLY.reach, z: c.z + Math.cos(c.face) * FIREFLY.reach };
}

/** Would a net sweeping now catch a firefly at (x, z)? */
export function inNet(c: Pick<Catcher, 'x' | 'z' | 'face'>, x: number, z: number): boolean {
  const n = netAt(c);
  return Math.hypot(n.x - x, n.z - z) <= FIREFLY.netR || Math.hypot(c.x - x, c.z - z) <= FIREFLY.scoop;
}

function startSwing(c: Catcher, seat: number, lag: number, ev: FlyEvents): void {
  c.swing = clamp(lag, 0, FIREFLY.maxLag);
  c.cool = FIREFLY.cooldown;
  c.netted = 0;
  c.queued = null;
  ev.swings.push(seat);
}

/** Advances the meadow by one step. `lags`: each seat's phone delay in seconds (half its round trip). */
export function stepMeadow(m: Meadow, sticks: readonly Stick[], dt: number, lags: readonly number[] = []): FlyEvents {
  const ev = noEvents();
  if (isOver(m)) return ev;
  m.time += dt;
  ev.steps = 1;

  // Arrivals: golden pairs on schedule, and new ordinary fireflies for the ones caught.
  const wave = FIREFLY.goldWaves[m.wave];
  if (wave !== undefined && m.time >= wave) {
    m.wave += 1;
    spawnGolden(m, ev);
  }
  m.pending = m.pending.filter((at) => {
    if (m.time < at) return true;
    spawnOrdinary(m, ev);
    return false;
  });

  // Walking, and nobody walks through anybody.
  m.catchers.forEach((c, i) => {
    if (c.team < 0) return;
    moveCatcher(c, sticks[i] ?? IDLE, dt);
  });
  for (let i = 0; i < m.catchers.length; i++) {
    for (let j = i + 1; j < m.catchers.length; j++) {
      const a = m.catchers[i] as Catcher;
      const b = m.catchers[j] as Catcher;
      if (a.team < 0 || b.team < 0) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = FIREFLY.bodyR * 2;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
    }
  }

  // Fireflies drift and blink; golden ones dart off from anyone running at them.
  for (const f of m.flies) {
    moveFly(m, f, dt);
    if (!f.gold || f.rise > 0) continue;
    if (f.flit <= 0) {
      const who = m.catchers.findIndex((c) => c.team >= 0 && startles(c, f));
      const c = m.catchers[who];
      if (c) {
        const away = Math.atan2(f.x - c.x, f.z - c.z) + (m.rng() - 0.5) * 1.2;
        f.vx = Math.sin(away) * FIREFLY.flit;
        f.vz = Math.cos(away) * FIREFLY.flit;
        f.heading = away;
        f.flit = FIREFLY.flitFor;
        f.lit = true;
        c.spooks += 1;
        ev.spooked.push({ seat: who, id: f.id });
      }
    }
    f.life -= dt;
  }
  m.flies = m.flies.filter((f) => {
    if (f.life > 0) return true;
    ev.goldOff.push(f.id);
    return false;
  });

  // Nets: new swings, then every net that's mid-sweep, the one furthest into its swing first.
  m.catchers.forEach((c, i) => {
    if (c.team < 0) return;
    c.cool = Math.max(0, c.cool - dt);
    const lag = clamp(lags[i] ?? 0, 0, FIREFLY.maxLag);
    if (sticks[i]?.a && c.swing < 0) {
      if (c.cool <= 0) startSwing(c, i, lag, ev);
      else if (c.cool <= FIREFLY.buffer) c.queued = lag;
    } else if (c.queued !== null && c.cool <= 0 && c.swing < 0) {
      startSwing(c, i, c.queued, ev);
    }
  });
  const sweeping = m.catchers
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.swing >= 0)
    .sort((a, b) => b.c.swing - a.c.swing);
  for (const { c, i } of sweeping) {
    c.swing += dt;
    if (c.swing >= FIREFLY.hitFrom && c.swing - dt <= FIREFLY.hitTo && c.netted < FIREFLY.maxPerSwing) {
      m.flies = m.flies.filter((f) => {
        if (c.netted >= FIREFLY.maxPerSwing || f.rise > 0 || !inNet(c, f.x, f.z)) return true;
        c.netted += 1;
        c.caught += 1;
        if (f.gold) c.golds += 1;
        const jar = m.jars[c.team];
        if (jar) {
          jar.value += flyValue(f);
          jar.flies += 1;
          if (f.gold) jar.golds += 1;
        }
        if (!f.gold) m.pending.push(m.time + between(m.rng, FIREFLY.respawn));
        ev.catches.push({ seat: i, team: c.team, id: f.id, gold: f.gold, x: f.x, z: f.z });
        return false;
      });
    }
    if (c.swing >= FIREFLY.swing) {
      if (c.netted === 0) {
        c.whiffs += 1;
        ev.whiffs.push(i);
      }
      c.swing = -1;
    }
  }
  return ev;
}

/** Advances by a frame of `dt` seconds in fixed steps. A press (`a`) only counts in the first step. */
export function advance(m: Meadow, sticks: readonly Stick[], dt: number, lags: readonly number[] = []): FlyEvents {
  const out = noEvents();
  m.acc += Math.min(dt, FIREFLY.maxFrame);
  let input = sticks;
  // (A hair of slack, so 0.5 s really is 60 steps despite rounding.)
  while (m.acc >= FIREFLY.step - 1e-9 && !isOver(m)) {
    m.acc -= FIREFLY.step;
    const ev = stepMeadow(m, input, FIREFLY.step, lags);
    if (out.steps === 0) input = sticks.map((s) => ({ ...s, a: false }));
    out.steps += ev.steps;
    out.swings.push(...ev.swings);
    out.catches.push(...ev.catches);
    out.whiffs.push(...ev.whiffs);
    out.spooked.push(...ev.spooked);
    out.risen.push(...ev.risen);
    out.goldOff.push(...ev.goldOff);
    out.goldIn ||= ev.goldIn;
  }
  return out;
}

/** Scores per seat: both partners get their jar's worth. Seats without a team get 0. */
export function jarScores(m: Meadow): number[] {
  return m.catchers.map((c) => m.jars[c.team]?.value ?? 0);
}

/** The team whose jar glows brightest, or null on a tie. */
export function brightest(m: Meadow): number | null {
  const best = Math.max(...m.jars.map((j) => j.value));
  const top = m.jars.flatMap((j, t) => (j.value === best ? [t] : []));
  return top.length === 1 ? (top[0] as number) : null;
}

// ------------------------------------------------------------------ computer players

export interface Brain {
  skill: number;
  /** Game time of the next decision: sleepy players react late. */
  next: number;
  x: number;
  y: number;
  press: boolean;
  /** When it'll press the button it decided to press (it takes a moment, like anyone). */
  pressAt: number | null;
  target: number | null;
  /** Whether it remembers to tiptoe on this approach (sleepy players sometimes barge in). */
  careful: boolean;
  /** Where it last saw each firefly glowing. */
  seen: Map<number, { x: number; z: number; at: number }>;
  /** A spot to drift toward when there's nothing to chase. */
  roam: { x: number; z: number };
  /** Zoned out (standing about, watching the lights) until this game time. */
  doze: number;
}

export function newBrain(skill: number, rng: Rng): Brain {
  // Everyone has better and worse days: a little form for this game.
  return { skill: clamp(skill + (rng() - 0.5) * 0.24, 0, 1), next: rng() * 0.2, x: 0, y: 0, press: false, pressAt: null, target: null, careful: true, seen: new Map(), roam: { x: 0, z: 0 }, doze: 0 };
}

/** Seconds from deciding to swing to pressing the button. */
function reaction(skill: number): number {
  return 0.2 + (1 - skill) * 0.2;
}

function think(m: Meadow, i: number, b: Brain, rng: Rng): void {
  const me = m.catchers[i];
  if (!me || me.team < 0) return;
  const s = b.skill;
  // Sleepy players now and then just stand and watch the lights for a moment.
  if (m.time < b.doze) return;
  if (rng() < (1 - s) ** 1.5 * 0.065) {
    b.doze = m.time + 0.8 + rng() * 1.4;
    b.x = 0;
    b.y = 0;
    return;
  }

  // What it knows: glowing fireflies where they are, dark ones where they were last seen (for a while).
  const memory = 0.8 + 1.4 * s;
  const alive = new Set(m.flies.map((f) => f.id));
  for (const f of m.flies) if (f.lit && f.rise <= 0) b.seen.set(f.id, { x: f.x, z: f.z, at: m.time });
  for (const [id, p] of b.seen) if (!alive.has(id) || m.time - p.at > memory) b.seen.delete(id);

  // The best firefly to go for: worth more, nearer, not one a teammate is closer to, not one an opponent is
  // about to net. Sharp players weigh all of that; sleepy ones mostly go for whatever is nearest.
  let best: { f: Fly; px: number; pz: number; score: number } | null = null;
  for (const f of m.flies) {
    const p = b.seen.get(f.id);
    if (!p) continue;
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    let score = (f.gold ? 1 + (FIREFLY.goldValue - 1) * (0.6 + 0.4 * s) : 1) / (d + 0.9);
    let mate = Infinity;
    let rival = Infinity;
    m.catchers.forEach((c, j) => {
      if (j === i || c.team < 0) return;
      const dc = Math.hypot(p.x - c.x, p.z - c.z);
      if (c.team === me.team) mate = Math.min(mate, dc);
      else rival = Math.min(rival, dc);
    });
    if (mate < d - 0.3) score *= 0.5 - 0.3 * s;
    if (rival < d * 0.55 && rival < 1.6) score *= 1 - 0.5 * s;
    if (f.id === b.target) score *= 1.25;
    score *= 1 + (rng() - 0.5) * (1 - s) * 0.6;
    if (!best || score > best.score) best = { f, px: p.x, pz: p.z, score };
  }

  let goX: number;
  let goZ: number;
  let mag: number;
  if (!best) {
    // Nothing in sight: drift about our half, looking.
    b.target = null;
    if (Math.hypot(b.roam.x - me.x, b.roam.z - me.z) < 0.6 || rng() < 0.05) {
      const side = me.team === 0 ? -1 : 1;
      b.roam = { x: side * (0.6 + rng() * 4.4) * (rng() < 0.25 ? -1 : 1), z: (rng() * 2 - 1) * 2.6 };
    }
    goX = b.roam.x - me.x;
    goZ = b.roam.z - me.z;
    mag = 0.55;
  } else {
    const { f } = best;
    if (f.id !== b.target) {
      b.target = f.id;
      b.careful = rng() < 0.5 + 0.5 * s;
    }
    // Sharp players aim where it's drifting to; a lit one they can follow exactly.
    const lead = f.lit ? 0.12 + 0.25 * s : 0;
    const tx = (f.lit ? f.x : best.px) + f.vx * lead;
    const tz = (f.lit ? f.z : best.pz) + f.vz * lead;
    goX = tx - me.x;
    goZ = tz - me.z;
    const d = Math.hypot(goX, goZ);
    mag = 0.94 + 0.06 * s;
    if (f.gold && b.careful && d < FIREFLY.notice + 1.0 + 0.8 * s) mag = (FIREFLY.sneak / FIREFLY.run) * (0.82 + 0.1 * s) + FIREFLY.deadzone * 0.6;
    if (d < FIREFLY.reach * 0.85) mag = Math.min(mag, 0.3);
    // Swing when the net will sweep over it. Pressing takes a moment: sharp players allow for it.
    if (me.cool <= FIREFLY.buffer && me.swing < 0 && b.pressAt === null) {
      const delay = reaction(s);
      const ahead = (FIREFLY.hitFrom + FIREFLY.hitTo) / 2 + delay * s;
      const future = { x: me.x + me.vx * ahead, z: me.z + me.vz * ahead, face: Math.atan2(goX, goZ) };
      const fx = f.x + f.vx * ahead;
      const fz = f.z + f.vz * ahead;
      const facing = Math.abs(wrap(future.face - me.face)) < 0.9;
      const lined = facing && inNet(future, fx, fz);
      if ((lined && rng() < 0.6 + 0.4 * s) || (!lined && d < 2.0 && rng() < (1 - s) * 0.1)) b.pressAt = m.time + delay; // (or a hopeful swing at thin air)
    }
  }
  const dist = Math.hypot(goX, goZ);
  if (dist < 1e-6) {
    b.x = 0;
    b.y = 0;
    return;
  }
  // A slightly wobbly hand when sleepy.
  const angle = Math.atan2(goX, goZ) + (rng() - 0.5) * (1 - s) * 0.6;
  b.x = Math.sin(angle) * mag;
  b.y = -Math.cos(angle) * mag;
}

/** A computer player's stick for this frame (`i` is its seat position). */
export function cpuStick(m: Meadow, i: number, b: Brain, rng: Rng): Stick {
  if (m.time >= b.next) {
    think(m, i, b, rng);
    b.next = m.time + 0.15 + (1 - b.skill) * 0.05 + rng() * 0.08;
  }
  if (b.pressAt !== null && m.time >= b.pressAt) {
    b.pressAt = null;
    b.press = true;
  }
  const a = b.press;
  b.press = false;
  return { x: b.x, y: b.y, a };
}
