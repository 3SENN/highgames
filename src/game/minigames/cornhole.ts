// Bean Bag Toss: a backyard at dusk, two boards leaning at the far end, one per team. Teams take turns tossing bean
// bags at their own board (partners take turns too). How fast you swipe sets how far the bag flies; a steady hand
// (swiping like last time) keeps it straighter. A bag on the board is 1 point, through the hole 3, and bags slide
// and bump, so a later bag can knock an earlier one in (or off). Highest team total after everyone's tosses wins.
//
// Flat yard coordinates: x sideways from the middle of the lane, y forward from the throwing line.
import type { Rng } from '../rng.js';

export const TOSS = {
  tosses: 4, // per player (a team of one tosses for two)
  step: 1 / 120, // physics step
  board: { y0: 7, y1: 9, half: 0.5 }, // the board's front and back edges, half its width
  hole: { y: 8.55, r: 0.12 },
  bag: 0.12, // a bag's radius (they're discs, near enough)
  land: { base: 4.23, per: 6.5 }, // where the bag comes down: base + per × swipe speed
  skid: { base: 0.6, per: 1.2 }, // and how fast it skids on when it lands
  decel: { board: 2.2, grass: 9 }, // how quickly a sliding bag stops
  spread: 0.28, // sideways scatter (standard deviation) of a careless toss
  depth: 0.15, // and along the throw
  restitution: 0.35,
} as const;

export type BagState = 'moving' | 'rest' | 'hole';

export interface Bag {
  /** Who tossed it (seat position). */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: BagState;
}

export interface Board {
  bags: Bag[];
}

/** Where a toss comes down, and how it is moving when it does. */
export interface Toss {
  speed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type BoardEvent =
  /** `index` dropped through the hole; `knocked` when another bag sent it there. */
  | { kind: 'hole'; index: number; knocked: boolean }
  | { kind: 'bump'; a: number; b: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const clamp01 = (n: number) => clamp(n, 0, 1);

/** A normally distributed number (mean 0, deviation 1). */
function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ------------------------------------------------------------------ tossing

/** How steady a toss is, 0 (nothing like last time) to 1 (the same swipe again). The first toss counts as a bit steady. */
export function steadiness(speed: number, prev: number | null): number {
  if (prev === null) return 0.3;
  return clamp01(1 - Math.abs(speed - prev) / 0.15);
}

/** Where a bag thrown at `speed` (0..1) lands before any scatter, and how fast it skids on. */
export function aimFor(speed: number): { y: number; skid: number } {
  const s = clamp01(speed);
  return { y: TOSS.land.base + TOSS.land.per * s, skid: TOSS.skid.base + TOSS.skid.per * s };
}

/** Where a bag thrown on the board ends up, ignoring other bags (how far it skids). */
export function restsAt(speed: number): number {
  const { y, skid } = aimFor(speed);
  const onBoard = y >= TOSS.board.y0 && y <= TOSS.board.y1;
  return y + (skid * skid) / (2 * (onBoard ? TOSS.decel.board : TOSS.decel.grass));
}

/** The swipe speed that, thrown dead straight, leaves a bag resting `y` from the line. */
export function speedFor(y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (restsAt(mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The swipe speed that, thrown dead straight, slides a bag right into the hole. */
export function idealSpeed(): number {
  return speedFor(TOSS.hole.y);
}

/** A toss: the swipe's speed sets the distance; the scatter shrinks when it matches the thrower's last swipe. */
export function planToss(speed: number, prev: number | null, rng: Rng): Toss {
  const steady = steadiness(speed, prev);
  const { y, skid } = aimFor(speed);
  const ly = y + gauss(rng) * TOSS.depth * (1 - 0.5 * steady);
  const lx = gauss(rng) * TOSS.spread * (1 - 0.6 * steady);
  // It flies from the middle of the throwing line, so it skids on in the same direction.
  const len = Math.hypot(lx, ly) || 1;
  return { speed: clamp01(speed), x: lx, y: ly, vx: (skid * lx) / len, vy: (skid * ly) / len };
}

// ------------------------------------------------------------------ the board

export function newBoard(): Board {
  return { bags: [] };
}

export function onBoard(x: number, y: number): boolean {
  return Math.abs(x) <= TOSS.board.half && y >= TOSS.board.y0 && y <= TOSS.board.y1;
}

/** Whether a bag drops through: a slow bag falls in from the hole's edge, a quick one only right over the middle. */
function overHole(x: number, y: number, speed = 0): boolean {
  return Math.hypot(x, y - TOSS.hole.y) < TOSS.hole.r * clamp(1.25 - 0.6 * speed, 0.4, 1);
}

/** A tossed bag comes down. Straight through the hole if it lands right on it. Returns its index. */
export function landBag(board: Board, owner: number, toss: Toss): { index: number; events: BoardEvent[] } {
  const bag: Bag = { owner, x: toss.x, y: toss.y, vx: toss.vx, vy: toss.vy, state: 'moving' };
  board.bags.push(bag);
  const index = board.bags.length - 1;
  if (overHole(bag.x, bag.y)) {
    bag.state = 'hole';
    bag.vx = bag.vy = 0;
    return { index, events: [{ kind: 'hole', index, knocked: false }] };
  }
  return { index, events: [] };
}

/** One physics step: bags slide, slow down, bump each other and drop through the hole. `newest` is the bag just thrown. */
export function stepBoard(board: Board, newest: number): BoardEvent[] {
  const dt = TOSS.step;
  const events: BoardEvent[] = [];
  const bags = board.bags;
  for (const b of bags) {
    if (b.state !== 'moving') continue;
    const sp = Math.hypot(b.vx, b.vy);
    const decel = onBoard(b.x, b.y) ? TOSS.decel.board : TOSS.decel.grass;
    const next = Math.max(0, sp - decel * dt);
    if (next < 0.02) {
      b.vx = b.vy = 0;
      b.state = 'rest';
      continue;
    }
    b.vx *= next / sp;
    b.vy *= next / sp;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  // Bumps between bags (equal weights): a sliding bag can set a resting one going.
  for (let i = 0; i < bags.length; i++) {
    const a = bags[i] as Bag;
    if (a.state === 'hole') continue;
    for (let j = i + 1; j < bags.length; j++) {
      const b = bags[j] as Bag;
      if (b.state === 'hole' || (a.state !== 'moving' && b.state !== 'moving')) continue;
      let nx = b.x - a.x;
      let ny = b.y - a.y;
      const d = Math.hypot(nx, ny);
      const min = TOSS.bag * 2;
      if (d >= min) continue;
      if (d < 1e-6) {
        nx = 0;
        ny = 1;
      } else {
        nx /= d;
        ny /= d;
      }
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        const j2 = (-(1 + TOSS.restitution) * rel) / 2;
        a.vx -= nx * j2;
        a.vy -= ny * j2;
        b.vx += nx * j2;
        b.vy += ny * j2;
        a.state = 'moving';
        b.state = 'moving';
        events.push({ kind: 'bump', a: i, b: j });
      }
    }
  }
  bags.forEach((b, i) => {
    if (b.state === 'hole' || !onBoard(b.x, b.y) || !overHole(b.x, b.y, Math.hypot(b.vx, b.vy))) return;
    b.state = 'hole';
    b.vx = b.vy = 0;
    events.push({ kind: 'hole', index: i, knocked: i !== newest });
  });
  return events;
}

export function settled(board: Board): boolean {
  return board.bags.every((b) => b.state !== 'moving');
}

/** A board's points: 1 for each bag on it, 3 for each through the hole. */
export function boardScore(board: Board): { points: number; on: number; holes: number } {
  let on = 0;
  let holes = 0;
  for (const b of board.bags) {
    if (b.state === 'hole') holes++;
    else if (onBoard(b.x, b.y)) on++;
  }
  return { points: on + 3 * holes, on, holes };
}

/** Scores per seat: both partners get their board's points. `teams` holds seat positions. */
export function tossScores(boards: readonly Board[], teams: readonly (readonly number[])[], seats: number): number[] {
  const scores = new Array<number>(seats).fill(0);
  teams.forEach((members, i) => {
    const b = boards[i];
    if (!b) return;
    for (const m of members) if (m >= 0 && m < seats) scores[m] = boardScore(b).points;
  });
  return scores;
}

// ------------------------------------------------------------------ turns

/**
 * Who tosses when: the teams take turns, and so do the partners in each team (A1, B1, A2, B2, A1…). Every team
 * gets the same number of tosses: a team of one tosses for two.
 */
export function turnOrder(teams: readonly (readonly number[])[], tosses: number = TOSS.tosses): { team: number; player: number }[] {
  const out: { team: number; player: number }[] = [];
  const rounds = 2 * tosses;
  for (let r = 0; r < rounds; r++) {
    teams.forEach((members, team) => {
      const player = members[r % Math.max(1, members.length)];
      if (player !== undefined) out.push({ team, player });
    });
  }
  return out;
}

// ------------------------------------------------------------------ computer players

/** The swipe speed a computer player makes: a sharp one goes for the hole, a sleepy one just for the board. */
export function cpuSpeed(skill: number, rng: Rng): number {
  const s = clamp01(skill);
  const middle = speedFor((TOSS.board.y0 + TOSS.board.y1) / 2);
  const aim = middle + (idealSpeed() - 0.01 - middle) * (0.3 + 0.7 * s);
  return clamp01(aim + gauss(rng) * (0.025 + (1 - s) * 0.09));
}
