// Blanket Tug: a cold night and only one giant fuzzy blanket. One player pulls one end on their own, three
// times as strong per pump; the other three pull the other end together. A strip of tape on the floor marks
// the middle: the first side to drag the blanket's middle 2 m past it wins, or the side ahead when time runs out.
// Pumping faster than about four times a second adds nothing, and the three get a little extra when their pumps
// land together.
//
// Positions are in metres along the floor: + is toward the three, - toward the solo player.
import type { Rng } from '../rng';

export const TUG = {
  duration: 25, // seconds
  win: 2, // metres past the line
  solo: 3, // the solo player's pull per pump, against 1 for each of the three
  fullSwing: 0.25, // seconds since your last pump for a full-strength one: faster than 4 a second adds nothing
  sync: 0.25, // a teammate's pump this close to yours counts as pulling together
  syncBonus: 0.1, // extra pull for a pump that lands together with a teammate's
  shove: 0.05, // metres a unit of pull drags the blanket (it slides there over a moment)
  drag: 3.2, // how quickly that slide dies down (per second)
  draw: 0.02, // closer to the line than this when time runs out: nobody wins
} as const;

export type Side = 'solo' | 'team';

export interface Tug {
  solo: number;
  team: number[];
  /** Where the blanket's middle is (m): + toward the three. */
  pos: number;
  vel: number;
  time: number;
  /** Per seat: game time of the last pump. */
  last: number[];
  pumps: number[];
  /** Per seat: all the pull they put in. */
  pull: number[];
  /** Pumps that landed together with a teammate. */
  synced: number;
  winner: Side | 'draw' | null;
}

export interface PumpResult {
  /** Pull this pump added (strength, power, fatigue and rhythm together). */
  pull: number;
  /** Teammates who pumped within TUG.sync of this pump. */
  sync: number;
}

export function newTug(seats: number, solo: number, team: readonly number[]): Tug {
  return {
    solo,
    team: [...team],
    pos: 0,
    vel: 0,
    time: 0,
    last: Array.from({ length: seats }, () => -Infinity),
    pumps: Array.from({ length: seats }, () => 0),
    pull: Array.from({ length: seats }, () => 0),
    synced: 0,
    winner: null,
  };
}

export function sideOf(t: Tug, seat: number): Side | null {
  if (seat === t.solo) return 'solo';
  return t.team.includes(seat) ? 'team' : null;
}

/** How much of a full pump a pump this soon after the last one is worth (pumping too fast adds nothing). */
export function fatigue(gap: number): number {
  return Math.min(1, Math.max(0, gap) / TUG.fullSwing);
}

/**
 * One pump of `power` (0..1) by `seat`, made at game time `at` (a phone's pump is backdated by half its round
 * trip). Returns what it added.
 */
export function pumpTug(t: Tug, seat: number, power: number, at: number = t.time): PumpResult {
  const side = sideOf(t, seat);
  if (!side || t.winner !== null) return { pull: 0, sync: 0 };
  const prev = t.last[seat] ?? -Infinity;
  const when = Math.min(t.time, Math.max(at, prev));
  const gap = when - prev;
  let sync = 0;
  if (side === 'team') {
    for (const mate of t.team) if (mate !== seat && Math.abs(when - (t.last[mate] ?? -Infinity)) <= TUG.sync) sync++;
  }
  const strength = side === 'solo' ? TUG.solo : 1;
  const pull = strength * Math.min(1, Math.max(0.2, power)) * fatigue(gap) * (sync > 0 ? 1 + TUG.syncBonus : 1);
  t.last[seat] = when;
  t.pumps[seat] = (t.pumps[seat] ?? 0) + 1;
  t.pull[seat] = (t.pull[seat] ?? 0) + pull;
  if (sync > 0) t.synced += 1;
  t.vel += (side === 'team' ? 1 : -1) * pull * TUG.shove * TUG.drag;
  return { pull, sync };
}

/** Advances the blanket by dt seconds. Returns the winner on the step the tug is decided. */
export function stepTug(t: Tug, dt: number): Side | 'draw' | null {
  if (t.winner !== null) return null;
  t.time += dt;
  t.pos += t.vel * dt;
  t.vel *= Math.exp(-TUG.drag * dt);
  if (t.pos >= TUG.win) t.winner = 'team';
  else if (t.pos <= -TUG.win) t.winner = 'solo';
  else if (t.time >= TUG.duration) t.winner = t.pos > TUG.draw ? 'team' : t.pos < -TUG.draw ? 'solo' : 'draw';
  if (t.winner !== null) t.pos = Math.max(-TUG.win, Math.min(TUG.win, t.pos));
  return t.winner;
}

/** The winning side scores 1 and the other 0 (half each for a dead heat); teammates always the same. */
export function tugScores(t: Tug, seats: number): number[] {
  return Array.from({ length: seats }, (_, s) => {
    const side = sideOf(t, s);
    if (!side) return 0;
    if (t.winner === 'draw') return 0.5;
    return t.winner === side ? 1 : 0;
  });
}

// ------------------------------------------------------------------ computer players

export interface Puller {
  skill: number;
  /** Game time of the next pump. */
  next: number;
  /** Not pumping until then (a sleepy puller loses the thread now and then). */
  nap: number;
  /** Everyone has second winds and slumps: the pumping pace drifts up and down. */
  surge: { speed: number; phase: number };
  /** On a team, a computer player leans on the others a little. */
  share: number;
}

export function newPuller(skill: number, rng: Rng, team = false): Puller {
  return {
    skill,
    next: 0.15 + rng() * 0.35 * (1.4 - skill),
    nap: 0,
    surge: { speed: 0.35 + rng() * 0.5, phase: rng() * Math.PI * 2 },
    share: team ? 0.9 : 1,
  };
}

const rateOf = (skill: number) => 2.3 + skill * 1.6;

/** A computer player's pump this step: its power, or null for none. */
export function cpuPump(t: Tug, p: Puller, rng: Rng): number | null {
  if (t.winner !== null || t.time < p.next || t.time < p.nap) return null;
  if (rng() < (1.15 - p.skill) * 0.03) {
    p.nap = t.time + 0.4 + rng() * 0.9;
    p.next = p.nap;
    return null;
  }
  const pace = rateOf(p.skill) * (1 + 0.2 * Math.sin(t.time * p.surge.speed + p.surge.phase));
  p.next = t.time + (1 / pace) * (1 + (rng() - 0.5) * 0.3 * (1.3 - p.skill));
  return Math.min(1, (0.5 + p.skill * 0.4 + (rng() - 0.5) * 0.15) * p.share);
}

/** A teammate just pumped at `at`: a sharp computer teammate falls in with them. */
export function cpuHear(t: Tug, p: Puller, at: number, rng: Rng): void {
  if (t.winner !== null || t.time < p.nap) return;
  const period = 1 / rateOf(p.skill);
  const ahead = p.next - at;
  if (ahead > 0.05 && ahead < period * 0.6 && rng() < p.skill * 0.85) p.next = at + 0.02 + rng() * 0.08;
}
