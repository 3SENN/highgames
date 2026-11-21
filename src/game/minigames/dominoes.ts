// Domino Run: a long domino run snakes across the living-room floor, one leg per round. Each leg is split into
// sections and every player builds some of them (with fewer players, each builds more, one after another). The
// slider sets how far apart the dominoes in your section stand: about two-thirds of their height topples cleanly,
// too close and the run jams halfway, too far and it stops (the next section gets a push by hand). Three rounds,
// each with its own domino size: tall, short and chunky. The group scores the sections that toppled cleanly.
import { type Rng, shuffle } from '../rng';

export type DominoKind = 'tall' | 'short' | 'chunky';

/** The round's dominoes: height, thickness (along the run) and width, in floor units. */
export const DOMINO_KINDS: Record<DominoKind, { name: string; h: number; t: number; w: number }> = {
  tall: { name: 'Tall', h: 1.2, t: 0.14, w: 0.5 },
  short: { name: 'Short', h: 0.5, t: 0.1, w: 0.3 },
  chunky: { name: 'Chunky', h: 0.75, t: 0.24, w: 0.66 },
};

export const DOMINO = {
  rounds: 3,
  length: 3.2, // floor length of one section
  gapMin: 0.04, // the gap between neighbouring dominoes at slider 0 …
  gapMax: 1.1, // … and at slider 1
  okLo: 0.58, // gap / height that topples cleanly: from …
  okHi: 0.82, // … to
  ideal: 0.7,
  jitter: 0.1, // each section's dominoes are up to this much taller or shorter than the round's size
  startAway: 0.2, // the slider starts at least this far from the right spot
  buildBase: 4, // seconds to build a round: this …
  buildPer: 3.5, // … plus this for every section a player builds in it
  maxCount: 20, // most dominoes in one section
} as const;

export type SectionResult = 'ok' | 'close' | 'far';

export interface Section {
  round: number;
  /** Position along the round's leg, 0 first. */
  index: number;
  /** Who builds it (position in ctx.seats). */
  seat: number;
  kind: DominoKind;
  h: number;
  t: number;
  w: number;
  /** Where the slider starts. */
  start: number;
  /** The slider now (or when it was set). */
  value: number;
  set: boolean;
}

export interface DominoGame {
  players: number;
  /** The domino size of each round. */
  kinds: DominoKind[];
  sections: Section[][];
}

/** Sections in one leg: everyone builds the same number (one or two players build two each, in turn). */
export function sectionsPerRound(players: number): number {
  return [2, 4, 3, 4][Math.min(4, Math.max(1, players)) - 1] as number;
}

/** Seconds to build a round. */
export function buildTime(players: number): number {
  const n = Math.min(4, Math.max(1, players));
  return DOMINO.buildBase + DOMINO.buildPer * (sectionsPerRound(n) / n);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The gap between dominoes for a slider value. */
export function gapOf(value: number): number {
  return DOMINO.gapMin + clamp01(value) * (DOMINO.gapMax - DOMINO.gapMin);
}

/** The slider value for a gap. */
export function valueOf(gap: number): number {
  return clamp01((gap - DOMINO.gapMin) / (DOMINO.gapMax - DOMINO.gapMin));
}

/** Where the slider should go for dominoes `h` tall. */
export function idealValue(h: number): number {
  return valueOf(DOMINO.ideal * h);
}

export function judge(gap: number, h: number): SectionResult {
  const r = gap / h;
  return r < DOMINO.okLo ? 'close' : r > DOMINO.okHi ? 'far' : 'ok';
}

export function sectionResult(s: Section): SectionResult {
  return judge(gapOf(s.value), s.h);
}

/** How a section's dominoes stand for a slider value: the gap, centre-to-centre pitch and how many fit. */
export function layoutSection(s: Pick<Section, 't'>, value: number): { gap: number; pitch: number; count: number } {
  const gap = gapOf(value);
  const pitch = gap + s.t;
  const count = Math.max(2, Math.min(DOMINO.maxCount, Math.floor((DOMINO.length - s.t) / pitch) + 1));
  return { gap, pitch, count };
}

/** How many of a section's dominoes go over: all of them, half (a jam), or only the first. */
export function toppled(result: SectionResult, count: number): number {
  return result === 'ok' ? count : result === 'close' ? Math.max(1, Math.ceil(count / 2)) : 1;
}

function startValue(rng: Rng, h: number): number {
  const ideal = idealValue(h);
  for (let i = 0; i < 40; i++) {
    const v = 0.05 + rng() * 0.9;
    if (Math.abs(v - ideal) >= DOMINO.startAway) return Math.round(v * 100) / 100;
  }
  return ideal > 0.5 ? 0.1 : 0.9;
}

export function newDominoGame(rng: Rng, players: number): DominoGame {
  const n = Math.min(4, Math.max(1, players));
  const kinds = shuffle(rng, ['tall', 'short', 'chunky'] as DominoKind[]);
  const per = sectionsPerRound(n);
  const sections = kinds.map((kind, round) =>
    Array.from({ length: per }, (_, index): Section => {
      const base = DOMINO_KINDS[kind];
      const k = 1 + (rng() * 2 - 1) * DOMINO.jitter;
      const h = Math.round(base.h * k * 100) / 100;
      const start = startValue(rng, h);
      return { round, index, seat: index % n, kind, h, t: base.t * k, w: base.w * k, start, value: start, set: false };
    }),
  );
  return { players: n, kinds, sections };
}

/** A seat's sections in a round, in the order it builds them. */
export function seatQueue(game: DominoGame, round: number, seat: number): Section[] {
  return (game.sections[round] ?? []).filter((s) => s.seat === seat);
}

/** The section a seat is working on now (null once all its sections in the round are set). */
export function activeSection(game: DominoGame, round: number, seat: number): Section | null {
  return seatQueue(game, round, seat).find((s) => !s.set) ?? null;
}

/** The slider moved; a set section no longer changes. */
export function slide(s: Section, value: number): void {
  if (!s.set) s.value = clamp01(value);
}

export function setSection(s: Section, value: number): void {
  if (s.set) return;
  s.value = clamp01(value);
  s.set = true;
}

/** Locks every section of a round (time is up): unset ones keep where their slider was. */
export function lockRound(game: DominoGame, round: number): void {
  for (const s of game.sections[round] ?? []) s.set = true;
}

/** Clean sections out of all sections in the game (or in the first `rounds` rounds). */
export function dominoCoop(game: DominoGame, rounds: number = DOMINO.rounds): number {
  const all = game.sections.slice(0, rounds).flat();
  if (!all.length) return 0;
  return all.filter((s) => sectionResult(s) === 'ok').length / all.length;
}

/** A seat's clean sections and the sections it built. */
export function seatTally(game: DominoGame, seat: number, rounds: number = DOMINO.rounds): { ok: number; total: number; close: number; far: number } {
  const mine = game.sections.slice(0, rounds).flat().filter((s) => s.seat === seat);
  const results = mine.map(sectionResult);
  return {
    ok: results.filter((r) => r === 'ok').length,
    close: results.filter((r) => r === 'close').length,
    far: results.filter((r) => r === 'far').length,
    total: mine.length,
  };
}

// ------------------------------------------------------------------ computer players

/** A standard normal number (Box–Muller). */
function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export interface DominoCpu {
  from: number;
  pick: number;
  /** When it starts sliding, and when it presses Set. */
  begin: number;
  at: number;
}

/**
 * A computer player eyes the dominoes and guesses the spacing: sharp ones land very close to two-thirds of the
 * height, sleepy ones are off by a fair bit. It slides over for a moment, then presses Set.
 */
export function cpuDominoPlan(s: Section, skill: number, rng: Rng, now: number): DominoCpu {
  const sd = 0.035 + (1 - skill) * 0.14;
  const ratio = DOMINO.ideal + gauss(rng) * sd;
  const begin = now + 0.4 + rng() * 0.8 + (1 - skill) * 0.6;
  return { from: s.value, pick: valueOf(ratio * s.h), begin, at: begin + 1.0 + rng() * 1.2 + (1 - skill) * 1.2 };
}

/** Where the computer's slider is at `now`, and whether it pressed Set. */
export function cpuDominoSlider(cpu: DominoCpu, now: number): { value: number; done: boolean } {
  if (now >= cpu.at) return { value: cpu.pick, done: true };
  const k = clamp01((now - cpu.begin) / Math.max(0.1, (cpu.at - cpu.begin) * 0.75));
  // Eases over, overshooting a touch before settling.
  const e = 1 - (1 - k) ** 3;
  const over = Math.sin(k * Math.PI) * 0.06 * Math.sign(cpu.pick - cpu.from);
  return { value: clamp01(cpu.from + (cpu.pick - cpu.from) * e + over), done: false };
}
