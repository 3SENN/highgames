// Snail Bets: four garden snails line up on the patio at dusk. Everyone bets on one (8 s), then cheers it on by
// tapping (25 s). Cheers give your snail little boosts, and everyone who backed the same snail cheers it together,
// though a crowd helps less than you'd think (boosts level off). Snails also stop for a snack or tuck into their
// shell for a moment; cheering coaxes them out a bit sooner.
// Points: 4 if your snail wins, 2 for second, 1 for third, and 1 more for whoever cheered most.
import type { Rng } from '../rng.js';

export const SNAIL = {
  bet: 8, // seconds to pick a snail
  race: 25, // seconds of racing at most
  length: 9, // start line to finish line
  base: 0.18, // a snail's own pace, units a second
  boost: 0.45, // the most cheering can add on top
  zealScale: 5, // how much cheering it takes to get most of the boost (it levels off)
  decay: 0.8, // cheering fades at this rate a second
  minTapGap: 0.07, // taps closer together than this count once
  pauses: [2, 4] as const, // snack stops and shell tucks per snail (fewest, most)
  pauseLen: [0.9, 2.0] as const,
  pauseFrom: 2, // pauses happen between these race times
  pauseTo: 20,
  coax: 0.05, // seconds a cheer takes off a pause
  pep: 0.07, // some snails are a little zippier today: their pace is this much faster or slower at most
  points: [4, 2, 1, 0] as const, // by where your snail finished
  cheerBonus: 1, // for whoever cheered most
  finishers: 3, // the race ends once this many snails are home
} as const;

/** The four snails: shell colours that aren't the seats' colours. */
export const SNAILS = [
  { name: 'Lilac', shell: '#b49ae0' },
  { name: 'Custard', shell: '#f3df7e' },
  { name: 'Cocoa', shell: '#9b6a4f' },
  { name: 'Pebble', shell: '#9aa4b4' },
] as const;

export type PauseKind = 'snack' | 'tuck';

export interface Pause {
  at: number;
  len: number;
  kind: PauseKind;
}

export interface Snail {
  /** Distance from the start line. */
  x: number;
  speed: number;
  /** How zippy it is today (a hidden factor on its pace). */
  pep: number;
  /** Cheering, fading over time. */
  zeal: number;
  pauses: Pause[];
  /** The next pause in `pauses` that hasn't started. */
  next: number;
  pausing: PauseKind | null;
  pauseLeft: number;
  finishedAt: number | null;
}

export interface Race {
  snails: Snail[];
  time: number;
  /** Each seat's snail (null: no bet yet). */
  bets: (number | null)[];
  cheers: number[];
  lastTap: number[];
}

export interface RaceEvents {
  paused: { snail: number; kind: PauseKind }[];
  resumed: number[];
  finished: number[];
}

/** A snail's stops for the race (two to four): one in each stretch of the window, so they don't bunch up. */
export function makePauses(rng: Rng): Pause[] {
  const out: Pause[] = [];
  const count = SNAIL.pauses[0] + Math.floor(rng() * (SNAIL.pauses[1] - SNAIL.pauses[0] + 1));
  const span = (SNAIL.pauseTo - SNAIL.pauseFrom) / count;
  for (let k = 0; k < count; k++) {
    const len = SNAIL.pauseLen[0] + rng() * (SNAIL.pauseLen[1] - SNAIL.pauseLen[0]);
    const at = SNAIL.pauseFrom + k * span + rng() * Math.max(0, span - len - 0.3);
    out.push({ at, len, kind: rng() < 0.5 ? 'snack' : 'tuck' });
  }
  return out;
}

export function newRace(rng: Rng, seats: number): Race {
  return {
    snails: SNAILS.map(() => ({ x: 0, speed: SNAIL.base, pep: 1 + (rng() * 2 - 1) * SNAIL.pep, zeal: 0, pauses: makePauses(rng), next: 0, pausing: null, pauseLeft: 0, finishedAt: null })),
    time: 0,
    bets: Array.from({ length: seats }, () => null),
    cheers: Array.from({ length: seats }, () => 0),
    lastTap: Array.from({ length: seats }, () => -Infinity),
  };
}

/** Puts (or moves) a seat's bet. */
export function placeBet(race: Race, seat: number, snail: number): boolean {
  if (seat < 0 || seat >= race.bets.length || snail < 0 || snail >= race.snails.length) return false;
  race.bets[seat] = snail;
  return true;
}

/** Seats without a bet get a random snail. */
export function fillBets(race: Race, rng: Rng): number[] {
  const filled: number[] = [];
  race.bets.forEach((b, i) => {
    if (b === null) {
      race.bets[i] = Math.floor(rng() * race.snails.length);
      filled.push(i);
    }
  });
  return filled;
}

/** A cheer from a seat at race time `t`. Returns false when it doesn't count (too quick, no bet, snail home). */
export function cheer(race: Race, seat: number, t: number): boolean {
  const bet = race.bets[seat];
  if (bet == null) return false;
  const s = race.snails[bet];
  if (!s || s.finishedAt !== null) return false;
  if (t - (race.lastTap[seat] ?? -Infinity) < SNAIL.minTapGap) return false;
  race.lastTap[seat] = t;
  race.cheers[seat] = (race.cheers[seat] ?? 0) + 1;
  s.zeal += 1;
  if (s.pausing) s.pauseLeft = Math.max(0, s.pauseLeft - SNAIL.coax);
  return true;
}

/** How fast a snail goes with this much cheering behind it. */
export function paceFor(zeal: number): number {
  return SNAIL.base + SNAIL.boost * (1 - Math.exp(-zeal / SNAIL.zealScale));
}

export function stepRace(race: Race, dt: number): RaceEvents {
  const ev: RaceEvents = { paused: [], resumed: [], finished: [] };
  race.time += dt;
  const t = race.time;
  race.snails.forEach((s, i) => {
    s.zeal *= Math.exp(-SNAIL.decay * dt);
    if (s.finishedAt !== null) {
      s.speed = 0;
      return;
    }
    const due = s.pauses[s.next];
    if (!s.pausing && due && t >= due.at) {
      s.pausing = due.kind;
      s.pauseLeft = due.len;
      s.next += 1;
      ev.paused.push({ snail: i, kind: due.kind });
    }
    if (s.pausing) {
      s.pauseLeft -= dt;
      s.speed = 0;
      if (s.pauseLeft > 0) return;
      s.pausing = null;
      ev.resumed.push(i);
    }
    s.speed = paceFor(s.zeal) * s.pep;
    s.x += s.speed * dt;
    if (s.x >= SNAIL.length) {
      // When exactly it crossed, so two close finishes are told apart fairly.
      s.finishedAt = t - (s.x - SNAIL.length) / Math.max(1e-6, s.speed);
      s.x = SNAIL.length;
      ev.finished.push(i);
    }
  });
  return ev;
}

export function raceOver(race: Race): boolean {
  const home = race.snails.filter((s) => s.finishedAt !== null).length;
  return race.time >= SNAIL.race || home >= Math.min(SNAIL.finishers, race.snails.length);
}

/** Each snail's place (0 = first): finishers by time, then the rest by how far they got. Ties share. */
export function placings(race: Race): number[] {
  const key = (s: Snail) => (s.finishedAt !== null ? s.finishedAt : 1e6 - s.x);
  return race.snails.map((s) => race.snails.filter((o) => key(o) < key(s) - 1e-9).length);
}

/** Points per seat: from where their snail came, plus the cheer bonus for the most cheers (shared on a tie). */
export function snailScores(race: Race): number[] {
  const place = placings(race);
  const most = Math.max(0, ...race.cheers);
  return race.bets.map((b, i) => {
    const p = b == null ? 0 : (SNAIL.points[place[b] ?? 3] ?? 0);
    return p + (most > 0 && race.cheers[i] === most ? SNAIL.cheerBonus : 0);
  });
}

// ------------------------------------------------------------------ computer players

export interface SnailFan {
  skill: number;
  /** When it places its bet during the betting time. */
  betAt: number;
  pick: number;
  /** Taps owed (fractions carry over). */
  owed: number;
  /** This second's tapping speed. */
  rate: number;
  nextRate: number;
}

/** A computer player bets on a random snail at some point in the betting time. */
export function newFan(rng: Rng, skill: number): SnailFan {
  return { skill, betAt: 1.2 + rng() * (SNAIL.bet - 3), pick: Math.floor(rng() * SNAILS.length), owed: rng(), rate: 0, nextRate: 0 };
}

/** Taps a second for a computer player: about 3 when sleepy up to 8 when sharp. */
export function fanRate(skill: number): number {
  return 3 + 5 * skill;
}

/** How many times a computer player taps in this step (it speeds up and slows down a little as it goes). */
export function fanTaps(fan: SnailFan, t: number, dt: number, rng: Rng): number {
  if (t >= fan.nextRate) {
    fan.rate = fanRate(fan.skill) * (0.8 + rng() * 0.4);
    // Sleepy fans now and then zone out for a moment.
    if (rng() < (1 - fan.skill) * 0.2) fan.rate = 0;
    fan.nextRate = t + 0.8 + rng() * 0.6;
  }
  fan.owed += fan.rate * dt;
  const taps = Math.floor(fan.owed);
  fan.owed -= taps;
  return taps;
}
