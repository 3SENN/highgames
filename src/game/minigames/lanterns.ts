// Sky Lanterns: a lake shore at night. Everyone holds a paper lantern and holds the button to warm the air inside:
// it fills and glows from orange to gold. Let go in the gold and it floats up into the sky. Too early and it sinks
// back into your hands (a little warmth kept, try again); too long and the paper scorches (a little hole, that
// lantern is lost). Golden lanterns let go within a second of each other rise together: a group release, with a
// bonus. The basket holds just enough lanterns for the goal (a solo player gets two spares but is short of time),
// so every scorched one counts; get the goal into the sky within 40 s.
//
// A lantern's warmth is a fixed curve of how long it has been held (it speeds up as the air heats, and the flame
// flutters), so a release can be judged exactly on what the screen showed, with the phone's delay taken off.
import type { Rng } from '../rng';

export const LANTERN = {
  duration: 40, // seconds
  zone: 0.82, // the gold zone runs from here to full; at full the paper scorches
  danger: 0.92, // the phone's ring warns from here
  shape: 0.7, // how much the warming speeds up as the air heats (smaller: more)
  full: [3.3, 4.4] as const, // seconds of steady warming from cold to scorching (each lantern is a little different)
  pace: [0.85, 1.2, 1.5, 1.75] as const, // how slowly lanterns warm, by group size: calmer for a bigger group, and quicker solo
  flicker: 0.3, // how much the flame's flutter speeds up and slows the warming
  flickerRate: [4, 6.5] as const, // radians a second
  keep: 0.5, // share of its warmth a too-early lantern keeps
  sink: 1.0, // seconds a too-early lantern takes to sink back into your hands
  scorch: 1.5, // seconds to drop a scorched lantern and unfold a new one
  reload: 1.1, // seconds to unfold the next one after a launch
  group: 1.0, // golden lanterns let go within this many seconds of each other rise together
  bonus: 0.2, // what each lantern in a group release adds to the count (enough to make up for a scorched one)
  maxLag: 0.15, // most phone delay taken off a release
  spare: [2, 0, 0, 0] as const, // spare lanterns in the basket, by group size (a solo player is short of time instead)
  cpuErr: 0.14, // computer players misjudge the moment by this share of a lantern's warm-up (sleepy ones)…
  cpuLate: 0.035, // …and tend to hang on this much too long
  cpuSocial: [0.1, 0.7] as const, // how likely a computer player tries to let go together (sleepy … sharp)
} as const;

/** Lanterns the group needs in the sky. */
export function lanternGoal(players: number): number {
  return players >= 3 ? 8 : 6;
}

/** Lanterns in the basket (the ones in everyone's hands at the start included): the goal, and two spares solo. */
export function basketSize(players: number): number {
  const n = Math.min(4, Math.max(1, players));
  return lanternGoal(n) + (LANTERN.spare[n - 1] as number);
}

export interface PaperLantern {
  /** Seconds of steady warming to scorch it. */
  full: number;
  /** The flame's flutter. */
  rate: number;
  phase: number;
}

export type HolderState =
  /** A cool lantern in hand, waiting for a press. */
  | 'ready'
  | 'warming'
  /** Let go too early: it lifts a little and sinks back. */
  | 'sinking'
  /** Held too long: the paper burnt through. */
  | 'scorched'
  /** Sent up; unfolding the next one. */
  | 'launched'
  /** The basket is empty. */
  | 'empty';

export interface Holder {
  state: HolderState;
  lantern: PaperLantern | null;
  /** When warming started (game clock). */
  downAt: number;
  /** Warming time the lantern starts with (warmth kept from a too-early try). */
  offset: number;
  /** The phone's one-way delay, taken off when judging. */
  lag: number;
  /** When the current pause (sinking, scorched, launched) ends. */
  until: number;
  /** Warmth at the moment it was let go or scorched (for the view). */
  lastHeat: number;
  launched: number;
  scorched: number;
  early: number;
  /** Lanterns of theirs that rose in a group release. */
  together: number;
}

export interface Launch {
  seat: number;
  at: number;
  group: number;
}

export interface Shore {
  players: number;
  goal: number;
  time: number;
  /** Lanterns left in the basket. */
  basket: number;
  holders: Holder[];
  launches: Launch[];
  /** Seats in every group (a group of one is a lantern let go on its own). */
  groups: number[][];
}

export type ShoreEvent =
  | { kind: 'launch'; seat: number; heat: number; group: number; size: number }
  | { kind: 'early'; seat: number; heat: number }
  | { kind: 'scorch'; seat: number }
  | { kind: 'unfold'; seat: number }
  | { kind: 'empty'; seat: number };

function newLantern(rng: Rng, players: number): PaperLantern {
  return {
    full: (LANTERN.full[0] + rng() * (LANTERN.full[1] - LANTERN.full[0])) * (LANTERN.pace[Math.min(4, Math.max(1, players)) - 1] as number),
    rate: LANTERN.flickerRate[0] + rng() * (LANTERN.flickerRate[1] - LANTERN.flickerRate[0]),
    phase: rng() * Math.PI * 2,
  };
}

function holder(lantern: PaperLantern | null): Holder {
  return {
    state: lantern ? 'ready' : 'empty',
    lantern,
    downAt: 0,
    offset: 0,
    lag: 0,
    until: 0,
    lastHeat: 0,
    launched: 0,
    scorched: 0,
    early: 0,
    together: 0,
  };
}

export function newShore(rng: Rng, players: number): Shore {
  const n = Math.max(1, players);
  let basket = basketSize(n);
  const holders = Array.from({ length: n }, () => {
    if (basket <= 0) return holder(null);
    basket -= 1;
    return holder(newLantern(rng, n));
  });
  return { players: n, goal: lanternGoal(n), time: 0, basket, holders, launches: [], groups: [] };
}

/** Warmth (0 cold … 1 scorching) of a lantern held for `t` seconds. Always rising, a little unevenly. */
export function heatAt(l: PaperLantern, t: number): number {
  if (t <= 0) return 0;
  const w = LANTERN.flicker / l.rate;
  const steady = t + w * (Math.sin(l.rate * t + l.phase) - Math.sin(l.phase));
  const a = Math.log(1 + 1 / LANTERN.shape) / l.full;
  return Math.min(1, Math.max(0, LANTERN.shape * (Math.exp(a * steady) - 1)));
}

/** How long a lantern must be held to reach warmth h. */
export function holdFor(l: PaperLantern, h: number): number {
  if (h <= 0) return 0;
  let lo = 0;
  let hi = l.full * 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (heatAt(l, mid) < h) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** How long this holder's lantern has been warming, as of `at` (game clock), without any delay taken off. */
function heldFor(h: Holder, at: number): number {
  return Math.max(0, at - h.downAt) + h.offset;
}

/** The warmth to show right now (on the TV and the phone's ring). */
export function heatNow(s: Shore, seat: number): number {
  const h = s.holders[seat];
  if (!h || !h.lantern) return 0;
  if (h.state === 'warming') return heatAt(h.lantern, heldFor(h, s.time));
  if (h.state === 'ready') return heatAt(h.lantern, h.offset);
  return h.lastHeat;
}

/**
 * The button went down: start warming (only a cool lantern in hand can start). `lag`: the phone's one-way delay in
 * game seconds (at most LANTERN.maxLag of real time); `at`: when it arrived, if between two steps.
 */
export function press(s: Shore, seat: number, lag = 0, at = s.time): boolean {
  const h = s.holders[seat];
  if (!h || h.state !== 'ready' || s.time >= LANTERN.duration) return false;
  h.state = 'warming';
  h.downAt = at;
  h.lag = Math.max(0, Math.min(1, lag));
  return true;
}

/** Group bonus: every lantern that rose in a group of two or more. */
export function togetherCount(s: Shore): number {
  return s.groups.reduce((sum, g) => sum + (g.length >= 2 ? g.length : 0), 0);
}

/** Lanterns in the sky, with the group bonus. */
export function skyCount(s: Shore): number {
  return s.launches.length + togetherCount(s) * LANTERN.bonus;
}

export function lanternCoop(s: Shore): number {
  return Math.min(1, skyCount(s) / Math.max(1, s.goal));
}

/**
 * The button came up (`at`: when it arrived, if between two steps). Judged on what the screen showed when it was
 * let go: the phone's delay is taken off.
 */
export function letGo(s: Shore, seat: number, arrived = s.time): ShoreEvent | null {
  const h = s.holders[seat];
  if (!h || h.state !== 'warming' || !h.lantern) return null;
  const at = arrived - h.lag;
  const heat = heatAt(h.lantern, heldFor(h, at));
  h.lastHeat = heat;
  if (heat < LANTERN.zone) {
    h.state = 'sinking';
    h.until = s.time + LANTERN.sink;
    h.offset = holdFor(h.lantern, heat * LANTERN.keep);
    h.early += 1;
    return { kind: 'early', seat, heat };
  }
  // Up it goes. Within a second of another golden lantern, it joins that group.
  const last = s.launches[s.launches.length - 1];
  let group = -1;
  if (last && at - last.at <= LANTERN.group) {
    const members = s.groups[last.group] as number[];
    if (!members.includes(seat)) group = last.group;
  }
  if (group < 0) {
    group = s.groups.length;
    s.groups.push([]);
  }
  const members = s.groups[group] as number[];
  members.push(seat);
  s.launches.push({ seat, at, group });
  h.launched += 1;
  if (members.length === 2) for (const m of members) (s.holders[m] as Holder).together += 1;
  else if (members.length > 2) h.together += 1;
  h.state = 'launched';
  h.until = s.time + LANTERN.reload;
  h.offset = 0;
  return { kind: 'launch', seat, heat, group, size: members.length };
}

/** Runs the clock: scorches lanterns held too long and hands out new ones after a pause. */
export function stepShore(s: Shore, dt: number, rng: Rng): ShoreEvent[] {
  const events: ShoreEvent[] = [];
  s.time += dt;
  s.holders.forEach((h, seat) => {
    if (h.state === 'warming' && h.lantern) {
      // Scorched only once it was over even on the phone's (delayed) screen.
      if (heatAt(h.lantern, heldFor(h, s.time - h.lag)) >= 1) {
        h.state = 'scorched';
        h.lastHeat = 1;
        h.until = s.time + LANTERN.scorch;
        h.scorched += 1;
        h.offset = 0;
        events.push({ kind: 'scorch', seat });
      }
      return;
    }
    if ((h.state === 'sinking' || h.state === 'scorched' || h.state === 'launched') && s.time >= h.until) {
      if (h.state === 'sinking') {
        h.state = 'ready';
        h.lastHeat = 0;
        return;
      }
      if (s.basket > 0) {
        s.basket -= 1;
        h.lantern = newLantern(rng, s.players);
        h.state = 'ready';
        h.offset = 0;
        h.lastHeat = 0;
        events.push({ kind: 'unfold', seat });
      } else {
        h.lantern = null;
        h.state = 'empty';
        events.push({ kind: 'empty', seat });
      }
    }
  });
  return events;
}

/** Lanterns still to come: in the basket, or in someone's hands (not the ones being dropped). */
export function lanternsLeft(s: Shore): number {
  return s.basket + s.holders.filter((h) => h.state === 'ready' || h.state === 'warming' || h.state === 'sinking').length;
}

/** Over: time is up, the sky is full, or there are no lanterns left to send up. */
export function shoreOver(s: Shore): boolean {
  if (s.time >= LANTERN.duration || lanternCoop(s) >= 1) return true;
  return s.basket === 0 && s.holders.every((h) => h.state === 'empty');
}

// ------------------------------------------------------------------ computer players

export interface LanternBrain {
  skill: number;
  /** When it presses next (null: not planned). */
  pressAt: number | null;
  /** When it lets go (game clock). */
  releaseAt: number;
  /** The latest it would hold on to wait for a friend. */
  holdUntil: number;
  /** Whether it tries to let go together with the others this time. */
  social: boolean;
  /** When it lets go to join a group release that just started. */
  joinAt: number | null;
}

export function newLanternBrain(skill: number): LanternBrain {
  return { skill, pressAt: null, releaseAt: 0, holdUntil: 0, social: false, joinAt: null };
}

function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * A computer player: picks up the lantern after a moment, aims to let go in the middle of the gold, and misjudges
 * it by a little (sharp) or a lot (sleepy, who also tends to hang on too long). Social ones wait a little for a
 * friend who is nearly golden, and let go right after someone else's golden lantern to rise together.
 * Returns what its button does now.
 */
export function cpuLantern(s: Shore, seat: number, b: LanternBrain, rng: Rng): 'press' | 'release' | null {
  const h = s.holders[seat];
  if (!h || !h.lantern) return null;
  const sloppy = 1 - b.skill;
  if (h.state === 'ready') {
    if (b.pressAt === null) b.pressAt = s.time + 0.2 + rng() * 0.35 + sloppy * 0.6;
    if (s.time < b.pressAt) return null;
    b.pressAt = null;
    b.joinAt = null;
    const l = h.lantern;
    const aim = LANTERN.zone + (1 - LANTERN.zone) * (0.4 + rng() * 0.25);
    // Misjudging in proportion to how fast the lantern warms, as people do.
    const err = (gauss(rng) * (0.012 + sloppy * LANTERN.cpuErr) + sloppy * LANTERN.cpuLate) * l.full;
    b.releaseAt = s.time + holdFor(l, aim) - h.offset + err;
    b.social = rng() < LANTERN.cpuSocial[0] + LANTERN.cpuSocial[1] * b.skill;
    b.holdUntil = s.time + holdFor(l, 0.9 + 0.04 * b.skill) - h.offset + gauss(rng) * sloppy * 0.25;
    return 'press';
  }
  if (h.state !== 'warming') return null;
  const heat = heatAt(h.lantern, heldFor(h, s.time));
  const last = s.launches[s.launches.length - 1];
  // Someone else just let a golden one go: join them (if golden too).
  if (b.social && last && last.seat !== seat && s.time - last.at < LANTERN.group * 0.8 && heat >= LANTERN.zone && b.joinAt === null) {
    b.joinAt = s.time + 0.12 + sloppy * 0.45 + rng() * 0.15;
  }
  if (b.joinAt !== null && s.time >= b.joinAt) return 'release';
  if (s.time < b.releaseAt) return null;
  // A friend is nearly golden too: hang on a moment (not past what feels safe).
  if (b.social && s.time < b.holdUntil) {
    const friend = s.holders.some((o, k) => k !== seat && o.state === 'warming' && heatNow(s, k) >= LANTERN.zone - 0.12 && heatNow(s, k) < 1);
    if (friend) return null;
  }
  return 'release';
}
