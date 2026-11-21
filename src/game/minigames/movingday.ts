// Moving Day: the whole group carries one big couch up a staircase, to a "heave-ho" beat. Each pump close to a beat
// counts for that beat. When most of the group pumps in the same beat's window, the couch goes up a step. Pumps off
// the beat make the couch wobble (a wobbly couch can't be lifted), and two missed beats in a row let it slide down a
// step. Reach the top landing (12 steps) within 40 seconds; the sooner, the better.
import type { Rng } from '../rng';

export const MOVE = {
  duration: 40, // seconds
  steps: 12, // up to the top landing
  firstBeat: 2.0, // the first heave-ho (a moment to get a grip)
  beat: 1.9, // seconds between heave-hos
  window: 0.2, // seconds either side of a beat that still count
  grace: 0.15, // a beat is settled this long after its window closes, for phone messages still on the way
  offWobble: 1.2, // wobble from one off-beat pump, shared by the group (divided by players + 1)
  wobbleLimit: 1, // from here the couch is too wobbly to lift
  wobbleDecay: 0.55, // wobble lost per second
  slideAfter: 2, // missed beats in a row before the couch slides down a step
  earlyFull: 12, // seconds to spare at the top that earn the whole early bonus
} as const;

/** How a beat went: a step up, held in place (half the group), a miss, or a miss that made the couch slide down. */
export type BeatOutcome = 'up' | 'hold' | 'miss' | 'slide';

export interface BeatClose {
  beat: number;
  outcome: BeatOutcome;
  /** Players who pumped in time on this beat. */
  synced: number;
  /** The group was in time, but the couch was wobbling too much to lift. */
  wobbly: boolean;
}

/**
 * How a pump counted: in time for the beat, a second one on the same beat, off the beat (wobble), too late for a
 * beat already settled, or not counted at all (getting a grip before the first heave, or after the end).
 */
export type PumpKind = 'sync' | 'again' | 'off' | 'late' | 'ignored';

export interface PumpResult {
  kind: PumpKind;
  /** Seconds from the nearest beat (negative: early). */
  offset: number;
  /** This pump completed a lift: the couch went up a step. */
  lifted: boolean;
}

export interface Move {
  players: number;
  time: number;
  /** Steps climbed, 0..12. */
  step: number;
  best: number;
  wobble: number;
  /** Missed beats in a row. */
  misses: number;
  /** The beat being played (its window is open or still to come). */
  beat: number;
  /** Who pumped in time on the current beat. */
  synced: boolean[];
  /** The current beat already lifted the couch. */
  lifted: boolean;
  /** When the couch reached the top, or null. */
  doneAt: number | null;
  /** Per seat: pumps in time, pumps off the beat, beats they helped lift. */
  inTime: number[];
  offBeat: number[];
  lifts: number[];
  ups: number;
  slides: number;
}

export function newMove(players: number): Move {
  const n = Math.max(1, players);
  return {
    players: n,
    time: 0,
    step: 0,
    best: 0,
    wobble: 0,
    misses: 0,
    beat: 0,
    synced: Array.from({ length: n }, () => false),
    lifted: false,
    doneAt: null,
    inTime: Array.from({ length: n }, () => 0),
    offBeat: Array.from({ length: n }, () => 0),
    lifts: Array.from({ length: n }, () => 0),
    ups: 0,
    slides: 0,
  };
}

/** When beat `k` falls (game seconds). */
export function beatTime(k: number): number {
  return MOVE.firstBeat + k * MOVE.beat;
}

/** How many players must pump in time to lift: most of the group. */
export function liftNeed(players: number): number {
  return Math.floor(Math.max(1, players) / 2) + 1;
}

/** Exactly half the group in time holds the couch where it is (only possible for two or four players). */
export function holdNeed(players: number): number {
  return Math.ceil(Math.max(1, players) / 2);
}

export function syncedCount(m: Move): number {
  return m.synced.filter(Boolean).length;
}

export function isOver(m: Move): boolean {
  return m.doneAt !== null || m.time >= MOVE.duration;
}

/** Where the beat is now: 0 right on a beat, rising to 1 just before the next. Negative before the first beat. */
export function beatPhase(time: number): number {
  const u = (time - MOVE.firstBeat) / MOVE.beat;
  return u < 0 ? u : Math.max(0, u - Math.floor(u + 1e-9));
}

function lift(m: Move): void {
  m.lifted = true;
  m.misses = 0;
  m.ups += 1;
  m.step = Math.min(MOVE.steps, m.step + 1);
  m.best = Math.max(m.best, m.step);
  m.synced.forEach((s, i) => {
    if (s) m.lifts[i] = (m.lifts[i] ?? 0) + 1;
  });
  if (m.step >= MOVE.steps && m.doneAt === null) m.doneAt = m.time;
}

function tryLift(m: Move): boolean {
  if (m.lifted || isOver(m) || syncedCount(m) < liftNeed(m.players) || m.wobble >= MOVE.wobbleLimit) return false;
  lift(m);
  return true;
}

/**
 * A seat pumps at `at` (game seconds, with half the phone's round trip already taken off). Pumps within the window
 * of the current beat count for it (once per seat); pumps between beats make the couch wobble.
 */
export function pump(m: Move, seat: number, at: number): PumpResult {
  const k = Math.round((at - MOVE.firstBeat) / MOVE.beat);
  const offset = at - beatTime(k);
  if (isOver(m) || seat < 0 || seat >= m.players || at < MOVE.firstBeat - MOVE.beat / 2) return { kind: 'ignored', offset, lifted: false };
  if (Math.abs(offset) <= MOVE.window && k >= 0) {
    if (k < m.beat) return { kind: 'late', offset, lifted: false };
    if (k === m.beat) {
      if (m.synced[seat]) return { kind: 'again', offset, lifted: false };
      m.synced[seat] = true;
      m.inTime[seat] = (m.inTime[seat] ?? 0) + 1;
      if (m.lifted) m.lifts[seat] = (m.lifts[seat] ?? 0) + 1;
      return { kind: 'sync', offset, lifted: tryLift(m) };
    }
  }
  // Between beats (or a beat that hasn't come round yet): the couch wobbles.
  m.offBeat[seat] = (m.offBeat[seat] ?? 0) + 1;
  m.wobble = Math.min(MOVE.wobbleLimit * 1.5, m.wobble + MOVE.offWobble / (m.players + 1));
  return { kind: 'off', offset, lifted: false };
}

/** Runs the clock: wobble settles, and every beat whose window has closed is settled. */
export function stepMove(m: Move, dt: number): BeatClose[] {
  const out: BeatClose[] = [];
  if (isOver(m)) return out;
  m.time = Math.min(MOVE.duration, m.time + dt);
  m.wobble = Math.max(0, m.wobble - MOVE.wobbleDecay * dt);
  while (!isOver(m) && m.time >= beatTime(m.beat) + MOVE.window + MOVE.grace) {
    const synced = syncedCount(m);
    let outcome: BeatOutcome;
    const wobbly = !m.lifted && synced >= liftNeed(m.players);
    if (m.lifted) outcome = 'up';
    else if (!wobbly && synced >= holdNeed(m.players)) outcome = 'hold';
    else {
      m.misses += 1;
      outcome = 'miss';
      if (m.misses >= MOVE.slideAfter) {
        m.misses = 0;
        if (m.step > 0) {
          m.step -= 1;
          m.slides += 1;
          outcome = 'slide';
        }
      }
    }
    out.push({ beat: m.beat, outcome, synced, wobbly });
    m.beat += 1;
    m.synced = m.synced.map(() => false);
    m.lifted = false;
  }
  return out;
}

/** Steps climbed (9 tenths of the score), plus a bonus for reaching the top, more the sooner it was. */
export function moveCoop(m: Move): number {
  const climb = (0.9 * m.step) / MOVE.steps;
  if (m.doneAt === null) return Math.max(0, Math.min(1, climb));
  const spare = Math.max(0, MOVE.duration - m.doneAt);
  return Math.min(1, climb + 0.04 + 0.06 * Math.min(1, spare / MOVE.earlyFull));
}

// ------------------------------------------------------------------ computer players

export interface MoveCpu {
  /** A steady lean early or late on every beat. */
  bias: number;
}

export function newMoveCpu(rng: Rng, skill: number): MoveCpu {
  return { bias: (rng() * 2 - 1) * 0.1 * (1 - skill) };
}

/** A rough bell curve: mean 0, spread 1 (never past 3). */
function wobbly(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 2;
}

/**
 * When a computer player pumps for the beat at `beatAt`: usually once near the beat (sleepier ones drift further off
 * and now and then miss the beat or throw in a stray pump between beats).
 */
export function cpuPumps(cpu: MoveCpu, skill: number, rng: Rng, beatAt: number): number[] {
  const out: number[] = [];
  const sigma = 0.06 + (1 - skill) * 0.24;
  if (rng() >= 0.02 + (1 - skill) * 0.2) out.push(beatAt + cpu.bias + wobbly(rng) * sigma);
  if (rng() < 0.015 + (1 - skill) * 0.12) out.push(beatAt + MOVE.beat * (0.35 + rng() * 0.3));
  return out;
}
