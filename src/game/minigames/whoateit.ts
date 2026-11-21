// Who Ate It? The last cookie is gone. Each round one player secretly ate it (their phone says so); the TV shows
// a few clues one by one (crumbs in a colour, a footprint size, a shadow by the jar, someone looking shifty).
// The clues fit the snacker but usually fit someone else a bit too. Then everyone votes. The snacker scores if
// fewer than half of the others caught them; everyone who picked right scores too.
// With only two players the cat is a suspect as well (and eats the cookie in one of the rounds).
import type { CompanionLook } from '../../shared/look';
import { type Rng, pick, shuffle } from '../rng';

export const WHO = {
  rounds: 3,
  clueTime: 10, // seconds the clues take, one by one
  voteTime: 6, // seconds to vote once the clues are in
  snackerPoints: 3, // the snacker, when fewer than half of the others caught them
  catchPoints: 2, // each player who picked the snacker
  herring: 0.85, // chance a clue's decoy is the round's red herring (the suspect most like the snacker)
  straightFace: 0.35, // chance the snacker keeps a straight face and someone else looks shifty instead
} as const;

export const FEET = ['small', 'medium', 'big'] as const;
export type Foot = (typeof FEET)[number];
/** The shape on top of someone's head, as a blurry shadow shows it: sticking up, flat-ish, or bumpy. */
export const TOPS = ['spiky', 'flat', 'bumpy'] as const;
export type Top = (typeof TOPS)[number];

export interface Suspect {
  color: string;
  foot: Foot;
  top: Top;
  cat: boolean;
}

/** The house cat: a suspect only when two people play. Grey, so its fluff never looks like a seat colour. */
export const CAT: Suspect = { color: '#9aa0ad', foot: 'small', top: 'spiky', cat: true };

const TOP_OF: Record<string, Top> = {
  'hat-wizard': 'spiky',
  'ears-bunny': 'spiky',
  'hat-crown': 'spiky',
  'ears-cat': 'spiky',
  'ears-elf': 'spiky',
  'hair-spiky': 'spiky',
  'hair-mohawk': 'spiky',
  'hat-flower-crown': 'bumpy',
  'hair-curls': 'bumpy',
  'hair-bun': 'bumpy',
  'hair-pigtails': 'bumpy',
};

/** The outline of the top of a companion's head: its hat if it has one, else its ears, else its hair. */
export function topOf(look: CompanionLook): Top {
  const id = look.parts.hat ?? look.parts.ears ?? look.parts.hair;
  return (id && TOP_OF[id]) || 'flat';
}

/** Footprints by body: Pebbles are small, Beans medium, Sprouts big. */
export function footOf(look: CompanionLook): Foot {
  return look.rig === 'C' ? 'small' : look.rig === 'B' ? 'big' : 'medium';
}

export function suspectOf(look: CompanionLook, color: string): Suspect {
  return { color, foot: footOf(look), top: topOf(look), cat: false };
}

/** Everyone who could have done it: the players, plus the cat when fewer than three play. */
export function suspectsFor(players: readonly Suspect[]): Suspect[] {
  return players.length < 3 ? [...players, CAT] : [...players];
}

/** Who eats the cookie each round (suspect indexes): someone different every round while there are enough. */
export function snackerOrder(rng: Rng, suspects: number, rounds: number = WHO.rounds): number[] {
  const order = shuffle(
    rng,
    Array.from({ length: suspects }, (_, i) => i),
  );
  return Array.from({ length: rounds }, (_, r) => order[r % order.length] as number);
}

export interface Clues {
  /** Two suspects whose colours are in the crumbs (shuffled); the snacker is one of them. */
  crumbs: number[];
  foot: Foot;
  top: Top;
  /** Suspects who look shifty; usually the snacker and one other. */
  flinch: number[];
}

/** The round's clues: true about the snacker, with a red herring or two so they rarely point at one suspect. */
export function makeClues(rng: Rng, suspects: readonly Suspect[], snacker: number): Clues {
  const me = suspects[snacker] as Suspect;
  const others = suspects.map((_, i) => i).filter((i) => i !== snacker);
  if (others.length === 0) return { crumbs: [snacker], foot: me.foot, top: me.top, flinch: [snacker] };
  // The red herring: whoever looks most like the snacker (same feet, same shadow), so the clues can't settle it.
  const likeness = (i: number) => (suspects[i]?.foot === me.foot ? 1 : 0) + (suspects[i]?.top === me.top ? 1 : 0);
  const most = Math.max(...others.map(likeness));
  const herring = pick(
    rng,
    others.filter((i) => likeness(i) === most),
  );
  const decoy = () => (rng() < WHO.herring ? herring : pick(rng, others));
  const crumbs = shuffle(rng, [snacker, decoy()]);
  let flinch: number[];
  if (rng() < WHO.straightFace) {
    const a = decoy();
    const rest = others.filter((i) => i !== a);
    flinch = rest.length > 0 && rng() < 0.5 ? shuffle(rng, [a, pick(rng, rest)]) : [a];
  } else {
    flinch = shuffle(rng, [snacker, decoy()]);
  }
  return { crumbs, foot: me.foot, top: me.top, flinch };
}

/** How much each clue counts when weighing them up (looking shifty is the least reliable). */
export const CLUE_WEIGHT = { crumbs: 1, foot: 0.8, top: 0.8, flinch: 0.6 } as const;

/** How well suspect `i` fits the clues; `seen` leaves out clues someone didn't notice. */
export function fit(clues: Clues, suspects: readonly Suspect[], i: number, seen: readonly boolean[] = [true, true, true, true]): number {
  const s = suspects[i];
  if (!s) return 0;
  let score = 0;
  if (seen[0] && clues.crumbs.includes(i)) score += CLUE_WEIGHT.crumbs;
  if (seen[1] && s.foot === clues.foot) score += CLUE_WEIGHT.foot;
  if (seen[2] && s.top === clues.top) score += CLUE_WEIGHT.top;
  if (seen[3] && clues.flinch.includes(i)) score += CLUE_WEIGHT.flinch;
  return score;
}

/** The suspects a player can vote for: everyone but themselves. */
export function candidatesFor(suspects: number, self: number): number[] {
  return Array.from({ length: suspects }, (_, i) => i).filter((i) => i !== self);
}

/**
 * A computer player's vote. Sharp ones notice every clue and weigh them carefully; sleepy ones miss some and
 * go with a hunch. (A computer snacker votes for whoever looks guiltiest, to blend in.)
 */
export function cpuVote(rng: Rng, clues: Clues, suspects: readonly Suspect[], self: number, skill: number): number {
  const notice = 0.3 + 0.5 * skill;
  const seen = [rng() < notice, rng() < notice, rng() < notice, rng() < notice];
  const spread = 0.35 + 1.4 * (1 - skill);
  let best = -1;
  let bestScore = -Infinity;
  for (const i of candidatesFor(suspects.length, self)) {
    const score = fit(clues, suspects, i, seen) + (rng() - 0.5) * 2 * spread;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Points for one round, per player: each player who picked the snacker scores catchPoints; the snacker scores
 * snackerPoints if fewer than half of the others picked them. `snacker` may be the cat (an index ≥ players).
 */
export function roundPoints(votes: readonly (number | null)[], snacker: number, players: number): number[] {
  const pts = Array.from({ length: players }, () => 0);
  const voters = pts.map((_, i) => i).filter((i) => i !== snacker);
  let caught = 0;
  for (const v of voters) {
    if (votes[v] === snacker) {
      pts[v] = (pts[v] ?? 0) + WHO.catchPoints;
      caught++;
    }
  }
  if (snacker < players && caught < voters.length / 2) pts[snacker] = (pts[snacker] ?? 0) + WHO.snackerPoints;
  return pts;
}

/** Points first; equal points are broken by how many times someone picked right. */
export function whoScores(points: readonly number[], rightVotes: readonly number[]): number[] {
  return points.map((p, i) => p * 100 + (rightVotes[i] ?? 0));
}
