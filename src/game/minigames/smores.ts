// S'mores Night: everyone roasts a marshmallow on a stick around a campfire. Tilting forward pushes it toward the
// flames (closer browns faster); tilting back pulls it out. A golden one held out of the fire for a second is done
// and goes into a s'more. Too deep for too long and it catches fire: flick it away quickly to blow it out (it's
// charred, so it doesn't count). The flames flicker, and now and then a gust makes them flare up toward someone.
// Make 8 golden ones together (5 with one or two players) in 40 seconds.
import type { Rng } from '../rng';

export const SMORES = {
  duration: 40,
  follow: 10, // how quickly the stick follows the tilt (per second)
  deadZone: 0.06, // forward tilt that still holds the marshmallow back
  tiltSpan: 0.7, // forward tilt past the dead zone for the deepest spot
  outBelow: 0.2, // reach under this is out of the fire
  goldLo: 0.6, // golden brown: from …
  goldHi: 0.85, // … to
  burnAt: 1.1, // this brown and it catches fire anyway
  doneHold: 1, // seconds a golden one is held out of the fire before it's done
  brown: 0.42, // browning per second at the deepest spot, with a full-size fire
  curve: 2.2, // how much faster it browns closer in
  flameFrom: 0.78, // reach where it is right in the flames
  catchTime: 1.0, // seconds deep in the flames before it catches fire
  cool: 0.8, // how fast that wears off out of the flames (per second)
  fireBrown: 0.5, // how fast a burning one blackens
  burnFor: 3, // a burning marshmallow drops into the fire after this
  blowSpeed: 2.2, // pulling back this fast (reach per second) blows the flame out
  fresh: 0.8, // seconds to put a new marshmallow on the stick
  flare: 0.4, // how much further the flames reach at a full flare
  firstGust: 4,
  gustGap: [2.8, 5.5] as const, // quiet between gusts
  gustLength: [1.5, 2.3] as const,
  gustRise: 0.6,
  gustFall: 0.5,
  lastGust: 37,
} as const;

/** Golden marshmallows the group goes for. */
export function goalFor(players: number): number {
  return players >= 3 ? 8 : 5;
}

/**
 * How hot the fire roasts, by group size: a solo roaster needs five in 40 s, a group of four only two each, so
 * smaller groups get a livelier fire and everyone has about the same work to do.
 */
export function heatFor(players: number): number {
  return [1.15, 0.41, 0.44, 0.35][Math.min(4, Math.max(1, players)) - 1] as number;
}

/** Where a seat sits around the fire (radians; π is far left, 0 far right, all on the back half). */
export function seatAngle(i: number, n: number): number {
  return Math.PI - ((i + 0.5) * Math.PI) / Math.max(1, n);
}

/** The tilt's forward/back axis (y, up = tipped back) as how far into the fire the marshmallow goes, 0..1. */
export function tiltToReach(y: number): number {
  return Math.min(1, Math.max(0, (-y - SMORES.deadZone) / SMORES.tiltSpan));
}

/** The tilt that holds the marshmallow at `reach`. */
export function reachToTilt(reach: number): number {
  return reach <= 0 ? 0 : -(SMORES.deadZone + reach * SMORES.tiltSpan);
}

// ------------------------------------------------------------------ gusts

export interface Gust {
  at: number;
  length: number;
  /** Where it blows the flames (an angle around the fire, like seatAngle). */
  angle: number;
  strength: number;
}

/** Gusts come more often around a bigger fire circle (each roast takes longer there, see heatFor). */
export function gustGapScale(players: number): number {
  return [1, 0.75, 0.65, 0.55][Math.min(4, Math.max(1, players)) - 1] as number;
}

export function planGusts(rng: Rng, players = 4): Gust[] {
  const gusts: Gust[] = [];
  const scale = gustGapScale(players);
  let at = SMORES.firstGust + rng() * 1.5;
  while (at < SMORES.lastGust) {
    const length = SMORES.gustLength[0] + rng() * (SMORES.gustLength[1] - SMORES.gustLength[0]);
    gusts.push({ at, length, angle: rng() * Math.PI, strength: 0.7 + rng() * 0.3 });
    at += length + (SMORES.gustGap[0] + rng() * (SMORES.gustGap[1] - SMORES.gustGap[0])) * scale;
  }
  return gusts;
}

/** How strongly a gust blows at `time`, 0..1 (rises, holds, dies down). */
export function gustLevel(g: Gust, time: number): number {
  const u = time - g.at;
  if (u <= 0 || u >= g.length) return 0;
  return Math.min(1, u / SMORES.gustRise, (g.length - u) / SMORES.gustFall) * g.strength;
}

/** The gust blowing now, if any, and how strongly. */
export function gustNow(gusts: readonly Gust[], time: number): { gust: Gust; level: number } | null {
  for (const g of gusts) {
    const level = gustLevel(g, time);
    if (level > 0) return { gust: g, level };
  }
  return null;
}

/** How far the flames flare toward a seat at `time`, 0..1: strongest on the side the wind blows to. */
export function flareAt(gusts: readonly Gust[], time: number, angle: number): number {
  const now = gustNow(gusts, time);
  if (!now) return 0;
  return now.level * (0.25 + 0.75 * Math.max(0, Math.cos(angle - now.gust.angle)));
}

/** The flames' flicker: a little more or less heat from moment to moment. */
export function flicker(time: number, seat: number): number {
  return 1 + 0.12 * Math.sin(time * 7.1 + seat * 1.9) + 0.08 * Math.sin(time * 12.7 + seat);
}

/** How deep in the heat the marshmallow is, with the flare: the flames reach further while a gust blows. */
export function effectiveReach(reach: number, flare: number): number {
  const lo = SMORES.outBelow;
  const k = Math.min(1, Math.max(0, (reach - lo) / 0.15));
  return reach + flare * SMORES.flare * k * k * (3 - 2 * k);
}

/** Browning per second at an effective reach. */
export function browningRate(eff: number, heat: number): number {
  const d = Math.max(0, (eff - SMORES.outBelow) / (1 - SMORES.outBelow));
  return heat * SMORES.brown * d ** SMORES.curve;
}

// ------------------------------------------------------------------ the fire

export type RoastPhase = 'roast' | 'fire' | 'fresh';

export interface Roast {
  phase: RoastPhase;
  reach: number;
  brown: number;
  /** Builds up deep in the flames; at 1 it catches fire. */
  scorch: number;
  /** Seconds a golden one has been held out of the fire. */
  out: number;
  /** Seconds on fire, or until a new marshmallow is on the stick. */
  timer: number;
  /** How fast the stick is being pulled back (reach per second, smoothed). */
  pull: number;
  flare: number;
  /** Whether this marshmallow reached golden yet (for a one-off nudge). */
  wasGold: boolean;
  golden: number;
  toasty: number;
  charred: number;
}

export interface Campfire {
  players: number;
  goal: number;
  heat: number;
  time: number;
  gusts: Gust[];
  roasts: Roast[];
  golden: number;
}

export type RoastEventKind = 'gold' | 'golden' | 'toasty' | 'fire' | 'blown' | 'dropped' | 'fresh';

export interface RoastEvent {
  seat: number;
  kind: RoastEventKind;
}

function newRoast(): Roast {
  return { phase: 'roast', reach: 0, brown: 0, scorch: 0, out: 0, timer: 0, pull: 0, flare: 0, wasGold: false, golden: 0, toasty: 0, charred: 0 };
}

export function newCampfire(rng: Rng, players: number): Campfire {
  const n = Math.min(4, Math.max(1, players));
  return { players: n, goal: goalFor(n), heat: heatFor(n), time: 0, gusts: planGusts(rng, n), roasts: Array.from({ length: n }, newRoast), golden: 0 };
}

function finish(c: Campfire, r: Roast, seat: number, out: RoastEvent[]): void {
  if (r.brown <= SMORES.goldHi) {
    r.golden += 1;
    c.golden += 1;
    out.push({ seat, kind: 'golden' });
  } else {
    r.toasty += 1;
    out.push({ seat, kind: 'toasty' });
  }
  r.phase = 'fresh';
  r.timer = SMORES.fresh;
}

/**
 * Advances the fire by `dt` (keep it small, e.g. 1/60). `targets` is where each seat holds its stick (0..1, see
 * tiltToReach). Returns what happened.
 */
export function stepCampfire(c: Campfire, dt: number, targets: readonly number[]): RoastEvent[] {
  const events: RoastEvent[] = [];
  c.time += dt;
  const follow = 1 - Math.exp(-SMORES.follow * dt);
  const smooth = 1 - Math.exp(-dt / 0.08);
  c.roasts.forEach((r, seat) => {
    const prev = r.reach;
    r.reach += (Math.min(1, Math.max(0, targets[seat] ?? 0)) - r.reach) * follow;
    r.pull += ((prev - r.reach) / Math.max(1e-6, dt) - r.pull) * smooth;
    r.flare = flareAt(c.gusts, c.time, seatAngle(seat, c.players));
    if (r.phase === 'fresh') {
      r.timer -= dt;
      if (r.timer <= 0) {
        Object.assign(r, { phase: 'roast', brown: 0, scorch: 0, out: 0, timer: 0, wasGold: false });
        events.push({ seat, kind: 'fresh' });
      }
      return;
    }
    if (r.phase === 'fire') {
      r.brown += SMORES.fireBrown * dt;
      r.timer += dt;
      const blown = r.pull >= SMORES.blowSpeed;
      if (blown || r.timer >= SMORES.burnFor) {
        r.charred += 1;
        r.phase = 'fresh';
        r.timer = SMORES.fresh;
        events.push({ seat, kind: blown ? 'blown' : 'dropped' });
      }
      return;
    }
    const eff = effectiveReach(r.reach, r.flare);
    if (r.reach < SMORES.outBelow) {
      if (r.brown >= SMORES.goldLo) {
        r.out += dt;
        if (r.out >= SMORES.doneHold) {
          finish(c, r, seat, events);
          return;
        }
      } else r.out = 0;
    } else r.out = 0;
    r.brown += browningRate(eff, c.heat) * flicker(c.time, seat) * dt;
    if (eff > SMORES.flameFrom) r.scorch += (dt * Math.min(1.5, (eff - SMORES.flameFrom) / (1 - SMORES.flameFrom))) / SMORES.catchTime;
    else r.scorch = Math.max(0, r.scorch - SMORES.cool * dt);
    if (!r.wasGold && r.brown >= SMORES.goldLo && r.brown <= SMORES.goldHi) {
      r.wasGold = true;
      events.push({ seat, kind: 'gold' });
    }
    if (r.scorch >= 1 || r.brown >= SMORES.burnAt) {
      r.phase = 'fire';
      r.timer = 0;
      r.pull = 0;
      events.push({ seat, kind: 'fire' });
    }
  });
  return events;
}

/** Time is up: a golden marshmallow already out of the fire still counts. */
export function finishCampfire(c: Campfire): RoastEvent[] {
  const events: RoastEvent[] = [];
  c.roasts.forEach((r, seat) => {
    if (r.phase === 'roast' && r.reach < SMORES.outBelow && r.brown >= SMORES.goldLo && r.brown <= SMORES.goldHi) finish(c, r, seat, events);
  });
  return events;
}

export function smoresCoop(c: Campfire): number {
  return Math.min(1, c.golden / c.goal);
}

/** A word for how the marshmallow on a stick looks. */
export function doneness(r: Roast): 'pale' | 'golden' | 'toasty' | 'burning' | 'new' {
  if (r.phase === 'fire') return 'burning';
  if (r.phase === 'fresh') return 'new';
  return r.brown < SMORES.goldLo ? 'pale' : r.brown <= SMORES.goldHi ? 'golden' : 'toasty';
}

// ------------------------------------------------------------------ computer players

function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export type CpuMove = 'in' | 'duck' | 'out';

export interface SmoresCpu {
  /** Where it likes to roast. */
  aim: number;
  /** The brown it pulls out at, for this marshmallow. */
  pullAt: number;
  /** What it does now, and what it means to do next (once its reaction time has passed). */
  move: CpuMove;
  next: CpuMove;
  nextAt: number;
  /** Where it holds the stick. */
  target: number;
  /** Seconds left zoned out (the stick stays put). */
  daze: number;
  /** The gust it reacted to (or decided to ignore). */
  gust: Gust | null;
  heeds: boolean;
  /** On fire: whether it flicks the stick away or only pulls back slowly. */
  flick: boolean;
  phase: RoastPhase;
}

function pullPoint(skill: number, rng: Rng): number {
  const span = SMORES.goldHi - SMORES.goldLo;
  return SMORES.goldLo + span * (0.32 + 0.12 * skill) + gauss(rng) * (1 - skill) * 0.11;
}

export function newSmoresCpu(skill: number, rng: Rng): SmoresCpu {
  const aim = Math.min(SMORES.flameFrom - 0.03, 0.58 + 0.18 * skill + gauss(rng) * 0.04);
  return { aim, pullAt: pullPoint(skill, rng), move: 'out', next: 'in', nextAt: 0.4 + rng() * 0.6, target: 0, daze: 0, gust: null, heeds: true, flick: true, phase: 'roast' };
}

/**
 * A computer roaster: holds its marshmallow at its favourite spot, ducks back when a gust flares toward it (if it
 * notices), pulls out when it thinks it's golden and flicks a burning one away. Sleepy ones react late, misjudge
 * the colour and sometimes zone out. Returns the tilt (y) it holds.
 */
export function cpuSmoresTilt(c: Campfire, seat: number, cpu: SmoresCpu, skill: number, rng: Rng, dt: number): number {
  const r = c.roasts[seat];
  if (!r) return 0;
  const react = 0.15 + (1 - skill) * 0.55;
  if (r.phase !== cpu.phase) {
    if (r.phase === 'fresh') cpu.pullAt = pullPoint(skill, rng);
    if (r.phase === 'fire') cpu.flick = rng() < 0.55 + 0.45 * skill;
    cpu.phase = r.phase;
  }
  if (cpu.daze > 0) cpu.daze -= dt;
  else if (r.phase === 'roast' && rng() < (1 - skill) * 0.045 * dt) cpu.daze = 1 + rng() * 1.5;
  // Pulled out a pale one by mistake: it notices and goes back for a bit more.
  if (r.phase === 'roast' && r.reach < SMORES.outBelow && r.brown >= cpu.pullAt && r.brown < SMORES.goldLo) cpu.pullAt = SMORES.goldLo + 0.03 + rng() * 0.05;

  if (r.phase === 'fire' && !cpu.flick) {
    // A slow, worried pull: not quick enough to blow the flame out.
    cpu.target = Math.max(0, cpu.target - 0.6 * dt);
    return reachToTilt(cpu.target);
  }
  let want: CpuMove = 'in';
  if (r.phase !== 'roast' || r.brown >= cpu.pullAt) want = 'out';
  else {
    const now = gustNow(c.gusts, c.time);
    if (now && now.gust !== cpu.gust) {
      cpu.gust = now.gust;
      cpu.heeds = rng() < 0.2 + 0.78 * skill;
    }
    if (now && cpu.heeds && r.flare > 0.05 + (1 - skill) * 0.3) want = 'duck';
  }
  if (want !== cpu.next) {
    cpu.next = want;
    cpu.nextAt = c.time + react * (0.7 + rng() * 0.6);
  }
  if (cpu.daze <= 0 && c.time >= cpu.nextAt) cpu.move = cpu.next;
  // Ducking: back far enough that the flare stays out of the flames (sleepy ones back off further than needed).
  const duck = Math.max(0.24, Math.min(cpu.aim, SMORES.flameFrom - 0.04 - SMORES.flare * (r.flare + (1 - skill) * 0.6)));
  cpu.target = cpu.move === 'in' ? cpu.aim : cpu.move === 'duck' ? duck : 0;
  const wobble = r.phase === 'roast' && cpu.target > 0 ? gauss(rng) * 0.015 : 0;
  return reachToTilt(cpu.target) + wobble;
}
