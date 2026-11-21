// Couch Tower: the whole group balances on top of a wobbly tower of stacked furniture. Every phone reports how much
// it wobbles; together that decides how the tower leans. Wobbling unsettles the whole stack (and pushes it toward
// your side of the top couch), while a calm group keeps it upright. Little things keep happening: a breeze, the cat
// climbing up, the doorbell, a bass drop from the speaker. Keep it standing for 30 seconds.
import { type Rng, shuffle } from '../rng';

export const TOWER = {
  duration: 30, // seconds to keep it up
  fallAt: 0.42, // lean (radians) where it topples
  gravity: 2.2, // how strongly a lean pulls itself further over
  balance: 8, // how strongly a calm group pulls it back upright
  damping: 2.0,
  push: 3, // lean push from wobbling off-centre (each player pushes toward their own side)
  jitter: 1.4, // random shoves at full group wobble
  calmFrom: 0.03, // group wobble that still counts as perfectly calm…
  calmSpan: 0.32, // …and how much more it takes to lose all balance
  calmBelow: 0.15, // wobble under this counts as "calm" for the bonus and the results
  calmBonus: 0.1, // most the calm bonus adds to the result
  smoothing: 0.25, // seconds over which each phone's wobble is smoothed
  settle: 1.5, // seconds at the start to pick up the phone and get comfy (wobble doesn't count yet)
  firstEvent: 3.5,
  eventGap: [1.8, 3.2] as const, // seconds of quiet between one disturbance and the next
  lastEvent: 27, // no new disturbances after this
  strengthFrom: 0.7, // how hard the first disturbance pushes…
  strengthTo: 2.0, // …growing to this by the end of the 30 seconds
} as const;

export type TowerEventKind = 'breeze' | 'cat' | 'doorbell' | 'bass';

export const EVENT_INFO: Record<TowerEventKind, { length: number; label: string }> = {
  breeze: { length: 3.2, label: 'A breeze!' },
  cat: { length: 5.4, label: 'The cat is climbing up!' },
  doorbell: { length: 1.4, label: 'Ding dong!' },
  bass: { length: 2.9, label: 'Bass drop!' },
};

/** The speaker's beat during a bass drop (seconds between thumps). */
export const BASS_BEAT = 0.47;
/** When the cat reaches the top, and when it hops off again. */
export const CAT_TOP = 4;
export const CAT_HOP = 4.9;

export interface TowerEvent {
  kind: TowerEventKind;
  at: number;
  length: number;
  side: -1 | 1;
  strength: number;
}

export interface Tower {
  players: number;
  time: number;
  lean: number;
  spin: number;
  fallen: boolean;
  fellAt: number | null;
  /** Smoothed wobble per seat. */
  wobble: number[];
  /** Seconds each seat spent calm. */
  calmBy: number[];
  /** Seconds the group as a whole was calm. */
  calmTime: number;
  /** The random direction the wobbling shoves the tower, drifting slowly. */
  drift: number;
  events: TowerEvent[];
  /** Index of the next event to start. */
  next: number;
  /** Impulses already given (doorbell, bass thumps, the cat's hop), per event. */
  kicks: number[];
}

export interface TowerStep {
  started: TowerEvent[];
  thumps: number;
  fell: boolean;
}

/** Where each player stands on the top couch, -1 (left) to 1 (right). */
export function towerSide(seat: number, players: number): number {
  return players <= 1 ? 0 : (seat - (players - 1) / 2) / ((players - 1) / 2);
}

/** The night's disturbances: one of each kind early on in a random order, then random ones, stronger as time goes. */
export function planEvents(rng: Rng): TowerEvent[] {
  const kinds: TowerEventKind[] = ['breeze', 'cat', 'doorbell', 'bass'];
  const events: TowerEvent[] = [];
  let bag = shuffle(rng, kinds);
  let at: number = TOWER.firstEvent;
  while (at <= TOWER.lastEvent) {
    if (bag.length === 0) bag = shuffle(rng, kinds);
    let kind = bag.pop() as TowerEventKind;
    if (kind === events[events.length - 1]?.kind && bag.length) {
      bag.unshift(kind);
      kind = bag.pop() as TowerEventKind;
    }
    const length = EVENT_INFO[kind].length;
    events.push({ kind, at, length, side: rng() < 0.5 ? -1 : 1, strength: TOWER.strengthFrom + (TOWER.strengthTo - TOWER.strengthFrom) * (at / TOWER.duration) });
    at += length + TOWER.eventGap[0] + rng() * (TOWER.eventGap[1] - TOWER.eventGap[0]);
  }
  return events;
}

export function newTower(rng: Rng, players: number): Tower {
  const n = Math.max(1, players);
  const events = planEvents(rng);
  return {
    players: n,
    time: 0,
    lean: 0,
    spin: 0,
    fallen: false,
    fellAt: null,
    wobble: Array.from({ length: n }, () => TOWER.calmFrom as number),
    calmBy: Array.from({ length: n }, () => 0),
    calmTime: 0,
    drift: 0,
    events,
    next: 0,
    kicks: events.map(() => 0),
  };
}

/** 1 when the group is perfectly calm, 0 when it is wobbling too much to balance at all. */
export function calmOf(groupWobble: number): number {
  return Math.min(1, Math.max(0, 1 - (groupWobble - TOWER.calmFrom) / TOWER.calmSpan));
}

export function groupWobble(t: Tower): number {
  return t.wobble.reduce((a, b) => a + b, 0) / Math.max(1, t.wobble.length);
}

/** The events going on right now. */
export function activeEvents(t: Tower): TowerEvent[] {
  return t.events.filter((e) => t.time >= e.at && t.time < e.at + e.length);
}

/** The steady push of an event at `u` seconds in (breeze and the climbing cat lean on the tower). */
function eventPush(e: TowerEvent, u: number): number {
  if (e.kind === 'breeze') return e.side * 1.0 * e.strength * Math.sin((Math.PI * u) / e.length);
  if (e.kind === 'cat' && u < CAT_HOP) return e.side * 1.1 * e.strength * Math.min(1, u / CAT_TOP);
  return 0;
}

/** One step. `wobble` is every seat's latest wobble (0 still … 1 shaking). */
export function stepTower(t: Tower, dt: number, wobble: readonly number[], rng: Rng): TowerStep {
  const out: TowerStep = { started: [], thumps: 0, fell: false };
  if (t.fallen || t.time >= TOWER.duration) return out;
  t.time += dt;
  const k = Math.min(1, dt / TOWER.smoothing);
  // While everyone settles in, nobody's wobble counts against them.
  const settling = t.time < TOWER.settle;
  t.wobble = t.wobble.map((w, i) => w + ((settling ? Math.min(TOWER.calmFrom, wobble[i] ?? w) : (wobble[i] ?? w)) - w) * k);
  const group = groupWobble(t);
  const calm = calmOf(group);
  const offCentre = t.wobble.reduce((sum, w, i) => sum + w * towerSide(i, t.players), 0) / t.players;
  t.drift = Math.max(-1, Math.min(1, t.drift + (rng() * 2 - 1) * dt * 4 - t.drift * dt * 0.5));

  while (t.next < t.events.length && t.time >= (t.events[t.next] as TowerEvent).at) out.started.push(t.events[t.next++] as TowerEvent);

  let push = 0;
  t.events.forEach((e, i) => {
    const u = t.time - e.at;
    if (u < 0 || u > e.length) return;
    push += eventPush(e, u);
    if (e.kind === 'doorbell' && (t.kicks[i] ?? 0) === 0) {
      t.kicks[i] = 1;
      t.spin += e.side * 0.55 * e.strength;
    } else if (e.kind === 'cat' && u >= CAT_HOP && (t.kicks[i] ?? 0) === 0) {
      t.kicks[i] = 1;
      t.spin -= e.side * 0.35 * e.strength;
    } else if (e.kind === 'bass') {
      const beats = Math.floor(u / BASS_BEAT) + 1;
      while ((t.kicks[i] ?? 0) < beats) {
        t.kicks[i] = (t.kicks[i] ?? 0) + 1;
        t.spin += e.side * 0.13 * e.strength;
        out.thumps += 1;
      }
    }
  });

  const accel =
    TOWER.gravity * t.lean - TOWER.balance * calm * t.lean - TOWER.damping * t.spin + TOWER.push * offCentre + TOWER.jitter * group * t.drift + push;
  t.spin += accel * dt;
  t.lean += t.spin * dt;

  if (group < TOWER.calmBelow) t.calmTime += dt;
  t.wobble.forEach((w, i) => {
    if (w < TOWER.calmBelow) t.calmBy[i] = (t.calmBy[i] ?? 0) + dt;
  });
  if (Math.abs(t.lean) >= TOWER.fallAt) {
    t.fallen = true;
    t.fellAt = Math.min(t.time, TOWER.duration);
    out.fell = true;
  }
  return out;
}

/** Seconds the tower stood. */
export function survived(t: Tower): number {
  return t.fellAt ?? Math.min(t.time, TOWER.duration);
}

/** Time survived over the full 30 s, plus a small bonus for the time the group stayed calm. */
export function towerCoop(t: Tower): number {
  return Math.min(1, survived(t) / TOWER.duration + TOWER.calmBonus * Math.min(1, t.calmTime / TOWER.duration));
}

// ------------------------------------------------------------------ computer players

export interface TowerCpu {
  fidget: number;
}

/**
 * The wobble a computer player "sends": a steady hand plus now and then a fidget, and a startle when the doorbell
 * rings or the bass drops. Sleepy ones (skill 0) fidget more and hold less still.
 */
export function cpuTowerWobble(c: TowerCpu, skill: number, rng: Rng, dt: number, startle: boolean): number {
  c.fidget *= Math.exp(-dt * 2.5);
  if (rng() < dt * (0.05 + (1 - skill) * 0.35)) c.fidget += 0.15 + rng() * 0.3 * (1.3 - skill);
  if (startle) c.fidget += 0.1 + (1 - skill) * 0.35;
  const steady = 0.03 + (1 - skill) * 0.16;
  return Math.min(1, steady * (0.7 + rng() * 0.6) + c.fidget);
}
