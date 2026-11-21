// Channel Surf: one player hogs the remote of an old telly, the others sit on the couch. Every time the channel
// changes, the couch has 1.5 s to react to what's on (Yum! for cooking, Aww for nature, Stretch! for a workout,
// Ha! for cartoons). A slow or wrong reaction adds a bored point; six bored points and the remote wins. If the
// couch is still entertained when the 35 seconds are up, the couch wins.
//
// The rules, in game seconds:
//  - A switch opens a reaction window. Each couch member's first press in it is judged: right or wrong.
//  - A window lasts 1.5 s; anyone who hasn't pressed by then is slow. If the remote switches again before it runs
//    out, the window closes early and nobody is slow in it: presses after the switch count for the new channel
//    (so a reaction to the old channel that comes in late is a wrong one).
//  - The old set needs 1.2 s between presses. A press sooner than that fuzzes the picture into static for 1.2 s:
//    the channel stays where it was, any open window closes (nobody is slow in it), and the remote does nothing
//    until the picture comes back.
//  - Switching to the channel that's already on does nothing.
//  - Presses are timed when they were made on the phone (the caller takes half the round trip off). A window waits
//    `grace` seconds for presses still on their way before calling anyone slow.
import { type Rng, pick } from '../rng.js';

export const SURF = {
  duration: 35,
  /** Seconds the set needs between presses of the remote. */
  minGap: 1.2,
  /** Seconds the couch has to react to a new channel. */
  window: 1.5,
  /** Bored points the remote needs against a full couch of three. */
  bored: 6,
  /** Seconds of static after a press that came too soon. */
  static: 1.2,
  /** Longest phone lag allowed for (seconds): windows wait this long before anyone is slow. */
  grace: 0.15,
} as const;

export interface Channel {
  name: string;
  /** The reaction that fits it, on the couch's buttons. */
  reaction: string;
  color: string;
}

export const CHANNELS: readonly Channel[] = [
  { name: 'Cooking', reaction: 'Yum!', color: '#f0913f' },
  { name: 'Nature', reaction: 'Aww', color: '#52b46a' },
  { name: 'Workout', reaction: 'Stretch!', color: '#4a98e0' },
  { name: 'Cartoons', reaction: 'Ha!', color: '#e163a5' },
];

/** right/wrong: a press; slow: no press in time; off: no press, but the window was cut short (no point). */
export type Verdict = 'right' | 'wrong' | 'slow' | 'off';

/** One reaction window: from a switch until 1.5 s later or the next press of the remote. */
export interface Watch {
  /** The switch that opened it (1 = the first switch). */
  id: number;
  channel: number;
  opensAt: number;
  closesAt: number;
  /** Closed early by another press of the remote. */
  cut: boolean;
  /** Per couch member. */
  verdicts: (Verdict | null)[];
  settled: boolean;
}

export interface Surf {
  /** How many sit on the couch. */
  members: number;
  /** Bored points the remote needs. */
  target: number;
  grace: number;
  time: number;
  channel: number;
  /** When the remote was last pressed (a switch or static). */
  lastPress: number;
  /** When the last switch happened, and how long the channel before it had been on. */
  lastSwitchAt: number;
  lastGap: number;
  staticUntil: number;
  bored: number;
  /** Open windows and closed ones still waiting for late presses. */
  windows: Watch[];
  switches: number;
  statics: number;
  /** Per couch member. */
  right: number[];
  boredBy: number[];
}

export type SwitchResult = 'switched' | 'static' | 'same' | 'ignored';

export interface Reaction {
  verdict: 'right' | 'wrong';
  /** The channel it was judged against. */
  channel: number;
}

export interface SlowEvent {
  member: number;
  channel: number;
}

/** Bored points the remote needs against `members` couch potatoes: 6 against three, 2 each against fewer. */
export function boredTarget(members: number): number {
  return members >= 3 ? SURF.bored : Math.max(1, members * 2);
}

export function newSurf(members: number, rng: Rng, grace: number = SURF.grace): Surf {
  return {
    members,
    target: boredTarget(members),
    grace,
    time: 0,
    channel: Math.floor(rng() * CHANNELS.length),
    lastPress: 0,
    lastSwitchAt: 0,
    lastGap: 0,
    staticUntil: 0,
    bored: 0,
    windows: [],
    switches: 0,
    statics: 0,
    right: Array.from({ length: members }, () => 0),
    boredBy: Array.from({ length: members }, () => 0),
  };
}

export function remoteWins(s: Surf): boolean {
  return s.bored >= s.target;
}

export function isOver(s: Surf): boolean {
  return remoteWins(s) || s.time >= SURF.duration;
}

export function isStatic(s: Surf): boolean {
  return s.time < s.staticUntil;
}

/** The set is ready for the next press (the little light on the telly is green). */
export function canSwitch(s: Surf): boolean {
  return !isStatic(s) && s.time - s.lastPress >= SURF.minGap - 1e-9;
}

/** Closes every open window now; nobody still deciding in them is slow. */
function cutWindows(s: Surf): void {
  for (const w of s.windows) {
    if (w.closesAt > s.time) {
      w.closesAt = s.time;
      w.cut = true;
    }
  }
}

/** The remote pressed channel `ch` at time `at` (when it was pressed on the phone; the switch shows now). */
export function switchChannel(s: Surf, ch: number, at: number = s.time): SwitchResult {
  if (isOver(s) || !Number.isInteger(ch) || ch < 0 || ch >= CHANNELS.length) return 'ignored';
  if (at < s.staticUntil - 1e-9) return 'ignored';
  if (at - s.lastPress < SURF.minGap - 1e-9) {
    cutWindows(s);
    s.staticUntil = s.time + SURF.static;
    s.lastPress = s.time;
    s.statics += 1;
    return 'static';
  }
  if (ch === s.channel) return 'same';
  cutWindows(s);
  s.switches += 1;
  s.channel = ch;
  s.lastPress = s.time;
  s.lastGap = s.time - s.lastSwitchAt;
  s.lastSwitchAt = s.time;
  s.windows.push({ id: s.switches, channel: ch, opensAt: s.time, closesAt: s.time + SURF.window, cut: false, verdicts: Array.from({ length: s.members }, () => null), settled: false });
  return 'switched';
}

/** A couch member pressed reaction `choice` at time `at`. Null when it doesn't count (no new channel, already reacted). */
export function react(s: Surf, member: number, choice: number, at: number = s.time): Reaction | null {
  if (isOver(s) || member < 0 || member >= s.members) return null;
  let w: Watch | undefined;
  for (let i = s.windows.length - 1; i >= 0; i--) {
    const c = s.windows[i] as Watch;
    if (c.opensAt <= at + 1e-9) {
      w = c;
      break;
    }
  }
  if (!w || w.settled || at > w.closesAt + 1e-9 || w.verdicts[member] !== null) return null;
  const verdict = choice === w.channel ? 'right' : 'wrong';
  w.verdicts[member] = verdict;
  if (verdict === 'right') s.right[member] = (s.right[member] ?? 0) + 1;
  else {
    s.bored += 1;
    s.boredBy[member] = (s.boredBy[member] ?? 0) + 1;
  }
  return { verdict, channel: w.channel };
}

/** Advances the clock; returns everyone who just turned out to be slow. */
export function stepSurf(s: Surf, dt: number): SlowEvent[] {
  const out: SlowEvent[] = [];
  if (isOver(s)) return out;
  s.time = Math.min(SURF.duration, s.time + dt);
  const end = s.time >= SURF.duration;
  for (const w of s.windows) {
    if (w.settled || (!end && s.time < w.closesAt + s.grace)) continue;
    w.settled = true;
    // At the final whistle, a window still running lets everyone off.
    const letOff = w.cut || w.closesAt > s.time;
    w.verdicts.forEach((v, member) => {
      if (v !== null) return;
      w.verdicts[member] = letOff ? 'off' : 'slow';
      if (letOff) return;
      s.bored += 1;
      s.boredBy[member] = (s.boredBy[member] ?? 0) + 1;
      out.push({ member, channel: w.channel });
    });
  }
  s.windows = s.windows.filter((w) => !w.settled);
  return out;
}

/** 1 for everyone on the winning side, 0 for the others. */
export function surfScores(s: Surf, seats: number, remote: number, couch: readonly number[]): number[] {
  const remoteWon = remoteWins(s);
  return Array.from({ length: seats }, (_, p) => {
    if (p === remote) return remoteWon ? 1 : 0;
    if (couch.includes(p)) return remoteWon ? 0 : 1;
    return 0;
  });
}

// ------------------------------------------------------------------ computer players

/** A roughly normal number with mean 0 and spread 1. */
const wobble = (rng: Rng) => (rng() + rng() + rng() + rng() - 2) * 1.73;

export interface CouchBrain {
  skill: number;
  /** The last switch this potato noticed. */
  seen: number;
  /** A press on its way: which reaction and when. */
  plan: { at: number; choice: number } | null;
  /** How long it expects the next channel to stay on (a steady rhythm is easy to keep up with). */
  expect: number;
}

export function newCouchBrain(skill: number): CouchBrain {
  return { skill, seen: 0, plan: null, expect: -9 };
}

/**
 * A computer couch potato's press for this step (a reaction index), or null. Sleepy ones react later, zone out
 * when a channel has been on for a while, and sometimes press the wrong thing; when the channel changes again
 * while they're still deciding, a sleepy one tends to press the reaction meant for the last channel. Everyone is
 * quicker when the remote keeps a steady rhythm.
 */
export function cpuCouch(s: Surf, b: CouchBrain, rng: Rng): number | null {
  if (isOver(s)) return null;
  if (s.switches !== b.seen) {
    b.seen = s.switches;
    const steady = Math.abs(s.lastGap - b.expect) < 0.3;
    b.expect = s.lastGap;
    if (b.plan === null || rng() < 0.25 + b.skill * 0.6) {
      const lazy = 1 - b.skill;
      let delay = 0.74 + lazy * 0.45 + wobble(rng) * (0.09 + lazy * 0.16) - (steady ? 0.12 + b.skill * 0.18 : 0);
      const zoned = (0.07 + lazy * 0.16) * Math.min(1, s.lastGap / 2.5);
      if (!steady && rng() < zoned) delay += 0.4 + rng() * 0.8;
      const right = rng() >= 0.025 + lazy * 0.07;
      const others = CHANNELS.map((_, i) => i).filter((i) => i !== s.channel);
      b.plan = { at: s.time + Math.max(0.32, delay), choice: right ? s.channel : pick(rng, others) };
    }
  }
  if (b.plan && s.time >= b.plan.at) {
    const c = b.plan.choice;
    b.plan = null;
    return c;
  }
  return null;
}

export interface RemoteBrain {
  skill: number;
  /** Game time of the next press (or of the next look at the couch). */
  nextAt: number;
  /** At nextAt, look at the couch first: wait for anyone still deciding, or let the channel run a bit longer. */
  watch: boolean;
}

export function newRemoteBrain(skill: number, rng: Rng): RemoteBrain {
  return { skill, nextAt: SURF.minGap + 0.2 + rng() * 0.8, watch: false };
}

/**
 * How long a computer remote waits after a press without watching the couch: a mix of quick flicks right after
 * the set is ready and longer lingers; sleepy ones flick too soon now and then and get static.
 */
function nextGap(skill: number, rng: Rng): number {
  const lazy = 1 - skill;
  const r = rng();
  const eager = 0.15 * lazy;
  if (r < eager) return 0.7 + rng() * 0.45;
  if (r < eager + 0.4) return SURF.minGap + 0.02 + rng() * (0.06 + 0.4 * lazy);
  return SURF.window + 0.05 + rng() * (0.5 + 1.5 * lazy) + (rng() < 0.15 ? rng() * 1.5 : 0);
}

/**
 * A computer remote's press for this step, already applied to the room, or null while it waits. Sharp ones watch the
 * couch (the reactions show on the TV): they give anyone still deciding the whole window to be slow in, and
 * otherwise flick on quickly or let the channel run a little, so there's no steady rhythm to settle into.
 */
export function cpuRemote(s: Surf, b: RemoteBrain, rng: Rng): { channel: number; result: SwitchResult } | null {
  if (isOver(s) || s.time < b.nextAt) return null;
  if (b.watch) {
    b.watch = false;
    const w = s.windows[s.windows.length - 1];
    if (w && !w.cut && w.verdicts.some((v) => v === null)) {
      b.nextAt = Math.max(s.time, w.closesAt + s.grace + 0.03 + rng() * 0.15);
      return null;
    }
    if (rng() < 0.35) {
      b.nextAt = s.time + 0.3 + rng() * 1.4;
      return null;
    }
  }
  const channel = pick(
    rng,
    CHANNELS.map((_, i) => i).filter((i) => i !== s.channel),
  );
  const result = switchChannel(s, channel, s.time);
  if (result === 'static') {
    // Wait for the picture to come back first.
    b.nextAt = s.staticUntil + 0.1 + rng() * 0.6;
  } else if (rng() < b.skill) {
    b.watch = true;
    b.nextAt = s.time + SURF.minGap + 0.03 + rng() * 0.1;
  } else {
    b.nextAt = s.time + nextGap(b.skill, rng);
  }
  return { channel, result };
}
