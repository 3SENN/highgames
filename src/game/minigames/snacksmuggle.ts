// Snack Smuggle: red light, green light in a dark kitchen at night. The keeper stands at the fridge with their
// back to the room; the other three creep in from the doorway by holding a button. A tap turns the keeper round:
// first a creak while they turn (0.4 s), then a look. Anyone still moving during the look is sent back to the
// doorway. The first sneaker to touch the fridge wins it for the three; if nobody does in time, the keeper wins.
//
// Progress runs from 0 (the doorway) to 1 (touching the fridge). Sneakers are listed by seat position.
import type { Rng } from '../rng.js';

export const SMUGGLE = {
  duration: 40,
  turn: 0.4, // from the tap until the keeper has turned round (the creak warns everyone)
  look: 1.2, // how long the keeper looks
  turnBack: 0.35, // turning back to the fridge; moving is safe again
  cooldown: 1.5, // facing the fridge again, before the next turn
  travel: 21, // seconds of sneaking from the doorway to the fridge
  sentBack: 1.1, // a caught sneaker shuffles back to the doorway
  maxLag: 0.15, // most phone delay forgiven when judging a release
} as const;

/** away: facing the fridge (safe) · turn: creaking round (safe) · look: watching (moving is caught) · back: turning back (safe). */
export type KeeperPhase = 'away' | 'turn' | 'look' | 'back';

export interface Sneaker {
  seat: number;
  /** 0 at the doorway, 1 touching the fridge. */
  pos: number;
  holding: boolean;
  /** Seconds left of the walk back to the doorway after being caught. */
  back: number;
  backFrom: number;
  caught: number;
  /** Already caught during the current look. */
  seen: boolean;
}

export interface Smuggle {
  keeper: number;
  sneakers: Sneaker[];
  phase: KeeperPhase;
  /** Game time the current phase began. */
  phaseAt: number;
  /** Game time of the last turn (the tap). */
  turnAt: number;
  /** Earliest game time the keeper may turn again. */
  readyAt: number;
  time: number;
  turns: number;
  winner: number | null;
}

export interface SmuggleEvents {
  /** The keeper has just turned round (the look begins). */
  looked: boolean;
  /** The keeper starts turning back to the fridge. */
  turnedBack: boolean;
  caught: number[];
  won: number | null;
}

export function newSmuggle(keeper: number, sneakers: readonly number[]): Smuggle {
  return {
    keeper,
    sneakers: sneakers.map((seat) => ({ seat, pos: 0, holding: false, back: 0, backFrom: 0, caught: 0, seen: false })),
    phase: 'away',
    phaseAt: 0,
    turnAt: -99,
    readyAt: 0.8,
    time: 0,
    turns: 0,
    winner: null,
  };
}

export function isOver(s: Smuggle): boolean {
  return s.winner !== null || s.time >= SMUGGLE.duration;
}

/** Whether the keeper may turn round now. */
export function canTurn(s: Smuggle): boolean {
  return !isOver(s) && s.phase === 'away' && s.time >= s.readyAt;
}

/** The keeper's tap: starts the creak and the turn. Returns false when it is too soon (or already turning). */
export function turnRound(s: Smuggle): boolean {
  if (!canTurn(s)) return false;
  s.phase = 'turn';
  s.phaseAt = s.time;
  s.turnAt = s.time;
  return true;
}

/**
 * Advances by dt seconds. `holds[seat]` is whether that sneaker's button is down; `grace[seat]` is how long after
 * the keeper turns a release still counts (half the phone's round trip), so nobody is caught by network delay.
 */
export function stepSmuggle(s: Smuggle, holds: readonly boolean[], dt: number, grace: readonly number[] = []): SmuggleEvents {
  const ev: SmuggleEvents = { looked: false, turnedBack: false, caught: [], won: null };
  if (isOver(s)) return ev;
  s.time += dt;
  if (s.phase === 'turn' && s.time - s.phaseAt >= SMUGGLE.turn) {
    s.phase = 'look';
    s.phaseAt += SMUGGLE.turn;
    s.turns += 1;
    ev.looked = true;
  }
  if (s.phase === 'look' && s.time - s.phaseAt >= SMUGGLE.look) {
    s.phase = 'back';
    s.phaseAt += SMUGGLE.look;
    ev.turnedBack = true;
    for (const sn of s.sneakers) sn.seen = false;
  }
  if (s.phase === 'back' && s.time - s.phaseAt >= SMUGGLE.turnBack) {
    s.phase = 'away';
    s.phaseAt += SMUGGLE.turnBack;
    s.readyAt = s.phaseAt + SMUGGLE.cooldown;
  }

  for (const sn of s.sneakers) {
    sn.holding = holds[sn.seat] ?? false;
    if (sn.back > 0) {
      sn.back = Math.max(0, sn.back - dt);
      sn.pos = sn.backFrom * (sn.back / SMUGGLE.sentBack);
      continue;
    }
    if (s.phase === 'look') {
      // Frozen while watched; still holding once the grace has passed means caught.
      const lag = Math.min(SMUGGLE.maxLag, Math.max(0, grace[sn.seat] ?? 0));
      if (sn.holding && !sn.seen && s.time - s.phaseAt >= lag) {
        sn.seen = true;
        sn.caught += 1;
        sn.back = SMUGGLE.sentBack;
        sn.backFrom = sn.pos;
        ev.caught.push(sn.seat);
      }
      continue;
    }
    if (!sn.holding) continue;
    sn.pos = Math.min(1, sn.pos + dt / SMUGGLE.travel);
    if (sn.pos >= 1 && s.winner === null) {
      s.winner = sn.seat;
      ev.won = sn.seat;
    }
  }
  return ev;
}

/** Whether a sneaker is moving right now (holding, and not walking back or frozen by a look). */
export function isMoving(s: Smuggle, sn: Sneaker): boolean {
  return sn.holding && sn.back <= 0 && s.phase !== 'look' && !isOver(s);
}

/** The winning side scores 1, the other 0. */
export function smuggleScores(s: Smuggle, seats: number): number[] {
  const sneakersWin = s.winner !== null;
  return Array.from({ length: seats }, (_, seat) => {
    if (seat === s.keeper) return sneakersWin ? 0 : 1;
    if (s.sneakers.some((sn) => sn.seat === seat)) return sneakersWin ? 1 : 0;
    return 0;
  });
}

// ------------------------------------------------------------------ computer players

export interface SneakBrain {
  skill: number;
  want: boolean;
  /** When this sneaker lets go after hearing the creak (game time), once planned. */
  releaseAt: number | null;
  /** When they start creeping again after the look. */
  resumeAt: number | null;
  /** The turn the release was planned for. */
  planned: number;
}

export function newSneakBrain(skill: number): SneakBrain {
  return { skill, want: true, releaseAt: null, resumeAt: null, planned: -99 };
}

/**
 * Seconds from the creak until a computer sneaker lets go. Usually quick enough; now and then their mind wanders
 * (sleepy ones far more often) and they are too slow.
 */
export function cpuReaction(skill: number, rng: Rng): number {
  const quick = 0.15 + rng() * 0.1;
  const lapse = rng() < 0.05 + (1 - skill) * 0.3;
  return lapse ? quick + 0.12 + rng() * 0.45 : quick;
}

/** A computer sneaker's button for this step. */
export function cpuHold(s: Smuggle, b: SneakBrain, rng: Rng): boolean {
  if (s.phase === 'turn' || s.phase === 'look') {
    if (b.planned !== s.turnAt) {
      b.planned = s.turnAt;
      b.releaseAt = s.turnAt + cpuReaction(b.skill, rng);
      b.resumeAt = null;
    }
    if (b.releaseAt !== null && s.time >= b.releaseAt) b.want = false;
    return b.want;
  }
  if (!b.want) {
    // Creep on again once the keeper turns back: sharp ones straight away, sleepy ones after a moment.
    if (b.resumeAt === null) {
      const from = s.phase === 'back' ? s.phaseAt : s.time;
      b.resumeAt = from + 0.08 + rng() * 0.15 + (1 - b.skill) * rng() * 0.6;
    }
    if (s.time >= b.resumeAt) {
      b.want = true;
      b.resumeAt = null;
    }
  }
  return b.want;
}

export interface KeeperBrain {
  skill: number;
  /** When to turn next (game time), once planned. */
  at: number | null;
}

export function newKeeperBrain(skill: number): KeeperBrain {
  return { skill, at: null };
}

/** Whether a computer keeper taps now (dt: seconds since the last call). Sharp keepers turn soon and often. */
export function cpuTap(s: Smuggle, b: KeeperBrain, rng: Rng, dt: number): boolean {
  if (!canTurn(s)) {
    b.at = null;
    return false;
  }
  if (b.at === null) {
    const quick = rng() < 0.35 + b.skill * 0.5;
    const wait = quick ? rng() * 0.35 : 0.3 + rng() * (0.6 + (1 - b.skill) * 2.2);
    b.at = s.time + wait;
  }
  // Someone almost at the fridge: turn now, once they notice.
  const close = s.sneakers.some((sn) => sn.pos > 0.8 && sn.back <= 0);
  if (close && rng() < dt * (1 + b.skill * 6)) b.at = Math.min(b.at, s.time);
  if (s.time >= b.at) {
    b.at = null;
    return true;
  }
  return false;
}
