// Freeze Dance: a living-room dance party in the small hours. One player is the DJ; the other three dance.
// While the music plays, dancers have to keep moving (keep the phone moving), or their companion yawns: too
// stiff, a strike. When the DJ calls Freeze!, they have half a second to hold perfectly still, or they're caught:
// a strike. Two strikes and you sit down by the snack table. The song lasts 40 seconds: the dancers win if anyone
// is still dancing at the end, the DJ if nobody is.
import type { Rng } from '../rng';

export const FREEZE = {
  duration: 40, // seconds: the length of the song
  dance: 0.25, // wobble that counts as dancing
  still: 0.12, // wobble that counts as frozen
  grace: 0.5, // seconds to freeze once the DJ calls it
  caught: 0.15, // seconds of moving after that to get caught
  warmup: 1, // seconds after the music starts before anyone has to be dancing
  stiff: 1.5, // seconds of not dancing to the music before your companion yawns (a strike)
  lock: 2, // the DJ can't call Freeze within this long of the music starting
  maxFreeze: 5, // the record starts again by itself after this long
  strikes: 2, // strikes and you're out
} as const;

export type Phase = 'music' | 'freeze';

export interface Dancer {
  seat: number;
  strikes: number;
  /** Seconds of not dancing to the music, building toward a yawn. */
  stiff: number;
  /** Seconds of moving during a freeze, after the grace, building toward getting caught. */
  shake: number;
  /** Already caught in this freeze (or yawned in this stretch of music). */
  struck: boolean;
  outAt: number | null;
  stiffs: number;
  catches: number;
}

export interface Party {
  dj: number;
  dancers: Dancer[];
  phase: Phase;
  /** Game time the current phase began. */
  phaseAt: number;
  time: number;
  freezes: number;
  /** When the last dancer sat down (the DJ's win). */
  doneAt: number | null;
}

export interface Strike {
  seat: number;
  why: 'stiff' | 'caught';
}

export interface PartyEvents {
  strikes: Strike[];
  out: number[];
  /** The record started again by itself (the DJ left it frozen too long). */
  resumed: boolean;
}

export function newParty(dj: number, dancers: readonly number[]): Party {
  return {
    dj,
    dancers: dancers.map((seat) => ({ seat, strikes: 0, stiff: 0, shake: 0, struck: false, outAt: null, stiffs: 0, catches: 0 })),
    phase: 'music',
    phaseAt: 0,
    time: 0,
    freezes: 0,
    doneAt: null,
  };
}

export function dancerOf(p: Party, seat: number): Dancer | undefined {
  return p.dancers.find((d) => d.seat === seat);
}

export function isOver(p: Party): boolean {
  return p.doneAt !== null || p.time >= FREEZE.duration;
}

export function djWins(p: Party): boolean {
  return p.dancers.length > 0 && p.dancers.every((d) => d.outAt !== null);
}

/** Seconds until the DJ may call Freeze (0: now). */
export function freezeIn(p: Party): number {
  return p.phase === 'music' ? Math.max(0, p.phaseAt + FREEZE.lock - p.time) : Infinity;
}

function setPhase(p: Party, phase: Phase): void {
  p.phase = phase;
  p.phaseAt = p.time;
  for (const d of p.dancers) {
    d.stiff = 0;
    d.shake = 0;
    d.struck = false;
  }
}

/** The DJ presses Freeze!: 'freeze' when it worked, 'soon' within FREEZE.lock of the music starting, 'frozen' if already. */
export function djFreeze(p: Party): 'freeze' | 'soon' | 'frozen' {
  if (isOver(p)) return 'frozen';
  if (p.phase === 'freeze') return 'frozen';
  if (freezeIn(p) > 0) return 'soon';
  setPhase(p, 'freeze');
  p.freezes += 1;
  return 'freeze';
}

/** The DJ presses Music on: 'music' when it worked, 'playing' if it already was. */
export function djMusic(p: Party): 'music' | 'playing' {
  if (isOver(p) || p.phase === 'music') return 'playing';
  setPhase(p, 'music');
  return 'music';
}

function strike(p: Party, d: Dancer, why: Strike['why'], ev: PartyEvents): void {
  d.strikes += 1;
  d.struck = true;
  if (why === 'stiff') d.stiffs += 1;
  else d.catches += 1;
  ev.strikes.push({ seat: d.seat, why });
  if (d.strikes >= FREEZE.strikes) {
    d.outAt = p.time;
    ev.out.push(d.seat);
    if (djWins(p)) p.doneAt = p.time;
  }
}

/**
 * Advances the party by dt seconds. `wobble` is each seat's latest wobble (0..1); `lag` is per seat how many
 * seconds behind its wobble arrives (half a phone's round trip), added to the time it has to react.
 */
export function stepParty(p: Party, wobble: readonly number[], dt: number, lag: readonly number[] = []): PartyEvents {
  const ev: PartyEvents = { strikes: [], out: [], resumed: false };
  if (isOver(p)) return ev;
  p.time += dt;
  if (p.phase === 'freeze' && p.time - p.phaseAt >= FREEZE.maxFreeze) {
    setPhase(p, 'music');
    ev.resumed = true;
  }
  const since = p.time - p.phaseAt;
  for (const d of p.dancers) {
    if (d.outAt !== null || d.struck) continue;
    const w = wobble[d.seat] ?? 0;
    const late = lag[d.seat] ?? 0;
    if (p.phase === 'music') {
      if (since < FREEZE.warmup + late) continue;
      d.stiff = w < FREEZE.dance ? d.stiff + dt : Math.max(0, d.stiff - dt * 2);
      if (d.stiff >= FREEZE.stiff) {
        strike(p, d, 'stiff', ev);
        // One yawn per stretch of music would let a dancer stand about: count afresh instead.
        d.struck = false;
        d.stiff = 0;
      }
    } else {
      if (since < FREEZE.grace + late) continue;
      d.shake = w > FREEZE.still ? d.shake + dt : Math.max(0, d.shake - dt * 2);
      if (d.shake >= FREEZE.caught) strike(p, d, 'caught', ev);
    }
    if (isOver(p)) break;
  }
  return ev;
}

/** The winning side scores 1, the other 0; teammates always the same. */
export function partyScores(p: Party, seats: number): number[] {
  const dj = djWins(p);
  return Array.from({ length: seats }, (_, s) => {
    if (s === p.dj) return dj ? 1 : 0;
    if (dancerOf(p, s)) return dj ? 0 : 1;
    return 0;
  });
}

// ------------------------------------------------------------------ computer players

/** The computer DJ: lets the music run for a random while (sharp DJs are harder to read), then freezes. */
export interface DjBrain {
  skill: number;
  /** The phase start this plan is for, and when to act. */
  planFor: number;
  actAt: number;
}

export function newDjBrain(skill: number): DjBrain {
  return { skill, planFor: -1, actAt: Infinity };
}

/** What the computer DJ presses this step, if anything. */
export function cpuDj(p: Party, b: DjBrain, rng: Rng): 'freeze' | 'music' | null {
  if (isOver(p)) return null;
  if (b.planFor !== p.phaseAt) {
    b.planFor = p.phaseAt;
    const s = b.skill;
    if (p.phase === 'music') {
      // Sharp DJs mix snap freezes right after the lock with long teasing stretches; sleepy ones let it play.
      const snap = rng() < 0.15 + s * 0.3;
      const wait = snap ? rng() * 0.6 : 0.4 + rng() * (1.4 + (1 - s) * 3.5);
      b.actAt = p.phaseAt + FREEZE.lock + wait;
    } else {
      b.actAt = p.phaseAt + FREEZE.grace + FREEZE.caught + 0.35 + rng() * (1.1 + (1 - s) * 2.2);
    }
  }
  if (p.time < b.actAt) return null;
  b.actAt = Infinity;
  return p.phase === 'music' ? 'freeze' : 'music';
}

/** A computer dancer: reacts to the DJ after a moment (sooner when sharp), and now and then zones out. */
export interface Mover {
  skill: number;
  /** The phase start it has reacted to, and when it will. */
  seenFor: number;
  reactAt: number;
  /** What it is doing now. */
  mode: 'dance' | 'still';
  level: number;
  /** Zoned out (not dancing) until then. */
  dazeUntil: number;
  /** A twitch while frozen, until then. */
  twitchUntil: number;
}

export function newMover(skill: number): Mover {
  return { skill, seenFor: -1, reactAt: 0, mode: 'dance', level: 0.5, dazeUntil: 0, twitchUntil: 0 };
}

/** The wobble a computer dancer "sends" this step. */
export function cpuWobble(p: Party, m: Mover, rng: Rng, dt: number): number {
  const s = m.skill;
  if (m.seenFor !== p.phaseAt) {
    m.seenFor = p.phaseAt;
    const lapse = rng() < (1 - s) * 0.18 ? 0.35 + rng() * 0.4 : 0;
    m.reactAt = p.phaseAt + (p.phase === 'freeze' ? 0.13 + (1 - s) * 0.2 + rng() * 0.3 : 0.2 + (1 - s) * 0.6 + rng() * 0.3) + lapse;
  }
  if (p.time >= m.reactAt) m.mode = p.phase === 'music' ? 'dance' : 'still';
  let target: number;
  if (m.mode === 'dance') {
    if (p.time >= m.dazeUntil && rng() < (1 - s) * 0.05 * dt) m.dazeUntil = p.time + 1.4 + rng() * 2;
    target = p.time < m.dazeUntil ? 0.06 : 0.32 + rng() * 0.5;
  } else {
    if (p.time >= m.twitchUntil && rng() < (1 - s) * 0.1 * dt) m.twitchUntil = p.time + 0.08 + rng() * 0.18;
    target = p.time < m.twitchUntil ? 0.2 + rng() * 0.15 : 0.02 + (1 - s) * 0.05 * rng();
  }
  // Like the phone's own reading: jumps up at once, settles down over a moment.
  m.level = target >= m.level ? target : target + (m.level - target) * Math.exp(-9.75 * dt);
  return m.level;
}
