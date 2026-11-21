// Slap Dot: the phones lie in a circle on the coffee table, tops to the middle. A glowing dot rolls onto one of
// them and its owner has to slap their phone before it pops; a slap sends it on round the circle (now and then
// across to someone else), a little quicker each time. A dot that pops on you, or a slap when it isn't yours,
// costs one of your three lives. Last one with lives left wins; everyone else ranks by when they went out.
import type { Rng } from '../rng';

export const SLAP = {
  lives: 3,
  duration: 45, // seconds of play at most; then whoever has most lives left wins
  fuseStart: 1.6, // seconds the dot may sit on a phone at first
  fuseMin: 0.6, // … and at the end
  fuseKeep: 0.88, // after each pass, this much of the fuse above the minimum is left
  travel: 0.45, // seconds to roll to the next phone at first
  travelMin: 0.26,
  jumpTravel: 1.35, // a jump across the circle takes this much longer
  jumpChance: 0.22, // a slap sends the dot to someone other than the next phone (with three or more left)
  firstRoll: 0.7, // seconds a fresh dot takes from the middle of the table
  early: 0.1, // a slap this long before the dot lands still counts
  afterGood: 0.35, // taps this soon after your own good slap are a double tap, not a false slap
  falseCooldown: 0.6, // one false slap at most in this time
  popPause: 1.4, // after a pop, a fresh dot comes this much later
  hurryFuse: 0.15, // once every person is out, the computer players get this much less fuse (a quick finish)
} as const;

/** Width over height of a phone's playfield. */
const ASPECT = 9 / 16;

export interface Dot {
  id: number;
  /** The phone it left (player position), or -1 for the middle of the table. */
  from: number;
  to: number;
  leaveAt: number;
  arriveAt: number;
  /** Seconds it may sit on `to` once it lands. */
  fuse: number;
  /** Sent across the circle rather than to the next phone. */
  jump: boolean;
  arrived: boolean;
}

export interface SlapGame {
  n: number;
  lives: number[];
  /** When each player went out (game time), or null while still in. */
  outAt: (number | null)[];
  /** Player positions in the order they went out. */
  order: number[];
  /** Extra seconds per player before a dot pops on them (a phone sees it late and its slap arrives late). */
  slack: number[];
  /** Good slaps so far (the fuse and the rolling shrink with them). */
  passes: number;
  /** Speeds the end up when only computer players are left (shorter fuses). */
  hurry: boolean;
  dot: Dot | null;
  /** While there's no dot (after a pop): when the next one comes, and to whom. */
  respawnAt: number;
  respawnTo: number;
  lastGood: number[];
  lastFalse: number[];
  /** Good slaps per player, and their quickest one (seconds after the dot landed). */
  slaps: number[];
  quickest: number[];
  over: boolean;
  nextId: number;
}

export type SlapEvent =
  /** A good slap: the dot is off from `from` to `to`. */
  | { t: 'pass'; from: number; to: number; jump: boolean; reaction: number }
  /** A slap when the dot wasn't yours. */
  | { t: 'false'; p: number; lives: number }
  /** The dot sat too long on p and popped. */
  | { t: 'pop'; p: number; lives: number }
  | { t: 'out'; p: number; place: number }
  | { t: 'land'; p: number }
  /** A fresh dot rolls out from the middle of the table. */
  | { t: 'spawn'; to: number }
  | { t: 'over'; winner: number | null; timeUp: boolean };

export function fuseFor(passes: number): number {
  return SLAP.fuseMin + (SLAP.fuseStart - SLAP.fuseMin) * SLAP.fuseKeep ** Math.max(0, passes);
}

export function travelFor(passes: number, jump: boolean): number {
  return Math.max(SLAP.travelMin, SLAP.travel * 0.97 ** Math.max(0, passes)) * (jump ? SLAP.jumpTravel : 1);
}

export function newSlap(n: number, first: number, slack: readonly number[] = []): SlapGame {
  const g: SlapGame = {
    n,
    lives: new Array<number>(n).fill(SLAP.lives),
    outAt: new Array<number | null>(n).fill(null),
    order: [],
    slack: Array.from({ length: n }, (_, i) => Math.max(0, slack[i] ?? 0)),
    passes: 0,
    hurry: false,
    dot: null,
    respawnAt: 0,
    respawnTo: ((first % n) + n) % n,
    lastGood: new Array<number>(n).fill(-9),
    lastFalse: new Array<number>(n).fill(-9),
    slaps: new Array<number>(n).fill(0),
    quickest: new Array<number>(n).fill(Infinity),
    over: false,
    nextId: 1,
  };
  return g;
}

export function aliveOf(g: SlapGame): number[] {
  return g.outAt.flatMap((o, i) => (o === null ? [i] : []));
}

/** The next player still in, clockwise round the circle after p (p itself if nobody else is). */
export function nextAlive(g: SlapGame, p: number): number {
  for (let k = 1; k <= g.n; k++) {
    const q = (p + k) % g.n;
    if (g.outAt[q] === null) return q;
  }
  return p;
}

function launch(g: SlapGame, from: number, to: number, at: number, jump: boolean, first = false): Dot {
  const d: Dot = {
    id: g.nextId++,
    from,
    to,
    leaveAt: at,
    arriveAt: at + (first ? SLAP.firstRoll : travelFor(g.passes, jump)),
    fuse: fuseFor(g.passes) - (g.hurry ? SLAP.hurryFuse : 0),
    jump,
    arrived: false,
  };
  g.dot = d;
  return d;
}

/** Where a slap sends the dot from p: the next phone round, or now and then someone else. */
function send(g: SlapGame, p: number, at: number, rng: Rng): Dot | null {
  const next = nextAlive(g, p);
  if (next === p) return null;
  const others = aliveOf(g).filter((q) => q !== p && q !== next);
  const jump = others.length > 0 && rng() < SLAP.jumpChance;
  const to = jump ? (others[Math.floor(rng() * others.length)] as number) : next;
  g.passes += 1;
  return launch(g, p, to, at, jump);
}

function finish(g: SlapGame, events: SlapEvent[], timeUp: boolean): void {
  g.over = true;
  g.dot = null;
  const alive = aliveOf(g);
  events.push({ t: 'over', winner: alive.length === 1 ? (alive[0] as number) : null, timeUp });
}

/** p loses a life (and maybe goes out). */
function lose(g: SlapGame, p: number, now: number, events: SlapEvent[]): void {
  g.lives[p] = Math.max(0, (g.lives[p] ?? 0) - 1);
  if ((g.lives[p] ?? 0) > 0) return;
  g.outAt[p] = now;
  g.order.push(p);
  events.push({ t: 'out', p, place: aliveOf(g).length + 1 });
  if (aliveOf(g).length <= 1) {
    finish(g, events, false);
    return;
  }
  // A dot on its way to someone who's out rolls on to the next phone.
  if (g.dot && g.dot.to === p) launch(g, p, nextAlive(g, p), now, false);
}

/**
 * Player p slapped their phone. `seen` is when, on the game clock, as the phone saw things (the time it arrived
 * minus the player's slack); `now` is the game time now. A slap on your own dot sends it on; a slap when the dot
 * isn't yours costs a life (a double tap right after a good slap doesn't).
 */
export function slap(g: SlapGame, p: number, seen: number, now: number, rng: Rng): SlapEvent[] {
  if (g.over || g.outAt[p] !== null) return [];
  const d = g.dot;
  if (!d) return [];
  const events: SlapEvent[] = [];
  if (d.to === p) {
    const deadline = d.arriveAt + d.fuse;
    if (seen > deadline) return []; // too late: it pops (stepSlap)
    if (seen >= d.arriveAt - SLAP.early) {
      const reaction = Math.max(0, seen - d.arriveAt);
      g.lastGood[p] = seen;
      g.slaps[p] = (g.slaps[p] ?? 0) + 1;
      g.quickest[p] = Math.min(g.quickest[p] ?? Infinity, reaction);
      const next = send(g, p, Math.max(now, d.arriveAt), rng);
      if (next) events.push({ t: 'pass', from: p, to: next.to, jump: next.jump, reaction });
      return events;
    }
  }
  if (seen - (g.lastGood[p] ?? -9) < SLAP.afterGood) return [];
  if (seen - (g.lastFalse[p] ?? -9) < SLAP.falseCooldown) return [];
  g.lastFalse[p] = seen;
  lose(g, p, now, events);
  events.splice(0, 0, { t: 'false', p, lives: g.lives[p] ?? 0 });
  return events;
}

/** Moves the game on to `now`: dots land and pop, fresh ones roll out, and time runs out. */
export function stepSlap(g: SlapGame, now: number): SlapEvent[] {
  if (g.over) return [];
  const events: SlapEvent[] = [];
  if (now >= SLAP.duration) {
    finish(g, events, true);
    return events;
  }
  if (!g.dot && now >= g.respawnAt) {
    const to = g.outAt[g.respawnTo] === null ? g.respawnTo : nextAlive(g, g.respawnTo);
    launch(g, -1, to, now, false, true);
    events.push({ t: 'spawn', to });
  }
  const d = g.dot;
  if (!d) return events;
  if (!d.arrived && now >= d.arriveAt) {
    d.arrived = true;
    events.push({ t: 'land', p: d.to });
  }
  if (now > d.arriveAt + d.fuse + (g.slack[d.to] ?? 0)) {
    const p = d.to;
    g.dot = null;
    g.respawnAt = now + SLAP.popPause;
    g.respawnTo = nextAlive(g, p);
    const lost: SlapEvent[] = [];
    lose(g, p, now, lost);
    events.push({ t: 'pop', p, lives: g.lives[p] ?? 0 }, ...lost);
  }
  return events;
}

/** Last one standing ranks first, then whoever has most lives left; everyone out ranks by when they went out. */
export function slapScores(g: SlapGame): number[] {
  return g.outAt.map((o, p) => (o === null ? 100 + (g.lives[p] ?? 0) * 10 : g.order.indexOf(p) + 1));
}

/** How far the dot is: rolling (k 0..1 of the way) or sitting (`left`: share of its fuse still to burn). */
export function dotState(d: Dot, now: number): { rolling: boolean; k: number; left: number } {
  if (now < d.arriveAt) return { rolling: true, k: Math.max(0, (now - d.leaveAt) / Math.max(0.01, d.arriveAt - d.leaveAt)), left: 1 };
  return { rolling: false, k: 1, left: Math.max(0, 1 - (now - d.arriveAt) / d.fuse) };
}

// ------------------------------------------------------------------ the circle on the table

/**
 * Phone i's place round the table: an angle clockwise from the far side (seen from above, the TV's side is the
 * near one). Nobody sits right in front of the TV: two phones lie left and right, more go round from the back.
 */
export function circleAngle(i: number, n: number): number {
  return ((2 * i - 1) * Math.PI) / Math.max(1, n);
}

/** The point on the edge of phone i's screen (0..1 of width and height) that faces phone `target` (-1: the middle). */
export function edgeToward(i: number, target: number, n: number): { x: number; y: number } {
  const a = circleAngle(i, n);
  const px = Math.sin(a);
  const py = Math.cos(a);
  const tx = target < 0 ? 0 : Math.sin(circleAngle(target, n));
  const ty = target < 0 ? 0 : Math.cos(circleAngle(target, n));
  const vx = tx - px;
  const vy = ty - py;
  // The phone's top points to the middle; its right is to the right of someone sitting at its bottom edge.
  const ux = -px;
  const uy = -py;
  const rx = uy;
  const ry = -ux;
  const dx = vx * rx + vy * ry; // across the screen, to the right
  const dy = -(vx * ux + vy * uy); // down the screen
  const len = Math.hypot(dx, dy) || 1;
  const sx = dx / len;
  const sy = dy / len;
  const t = Math.min(sx ? 0.5 / Math.abs(sx) : Infinity, sy ? 0.5 / ASPECT / Math.abs(sy) : Infinity) * 0.9;
  return { x: 0.5 + sx * t, y: 0.5 + sy * t * ASPECT };
}

// ------------------------------------------------------------------ computer players

/** Seconds a computer player takes to slap a dot that just landed (now and then it's miles away). */
export function cpuReaction(skill: number, rng: Rng, jump = false): number {
  const base = 0.6 - 0.32 * skill;
  const jitter = (rng() + rng() + rng() - 1.5) * 0.17;
  const lapse = rng() < 0.04 + 0.12 * (1 - skill) ? 0.3 + rng() * 0.5 : 0;
  return Math.max(0.17, base + jitter + lapse + (jump ? 0.06 : 0));
}

/** Chance a computer player flinches and slaps when the dot lands on a neighbour's phone. */
export function flinchChance(skill: number): number {
  return 0.004 + 0.035 * (1 - skill);
}

export interface CpuHand {
  skill: number;
  /** The dot it's waiting on, and when it'll slap it. */
  dotId: number;
  slapAt: number | null;
  /** The last dot it watched land elsewhere, and a flinch it's about to make. */
  watched: number;
  flinchAt: number | null;
}

export function newCpuHand(skill: number): CpuHand {
  return { skill: Math.max(0, Math.min(1, skill)), dotId: 0, slapAt: null, watched: 0, flinchAt: null };
}

/** Which computer players slap at `now` (null hands are people). */
export function cpuSlaps(g: SlapGame, hands: readonly (CpuHand | null)[], now: number, rng: Rng): number[] {
  const out: number[] = [];
  const d = g.dot;
  hands.forEach((h, p) => {
    if (!h || g.outAt[p] !== null || g.over) return;
    if (d && d.to === p) {
      if (h.dotId !== d.id) {
        h.dotId = d.id;
        h.slapAt = d.arriveAt + cpuReaction(h.skill, rng, d.jump);
      }
      if (h.slapAt !== null && now >= h.slapAt) {
        h.slapAt = null;
        out.push(p);
        return;
      }
    } else if (d && d.arrived && h.watched !== d.id) {
      h.watched = d.id;
      const neighbour = nextAlive(g, p) === d.to || nextAlive(g, d.to) === p;
      if (neighbour && rng() < flinchChance(h.skill)) h.flinchAt = now + 0.12 + rng() * 0.15;
    }
    if (h.flinchAt !== null && now >= h.flinchAt) {
      h.flinchAt = null;
      if (!d || d.to !== p) out.push(p);
    }
  });
  return out;
}
