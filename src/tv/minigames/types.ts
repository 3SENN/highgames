// What every minigame implements. A minigame is one file in ./games/ that exports `minigame`; the registry
// (./index.ts) finds it by itself, so adding one never means editing shared files.
import type { Rng } from '../../game/rng';
import type { CompanionLook } from '../../shared/look';
import type { ControllerKind, MinigameId } from '../../shared/protocol';
import type { Clock } from '../anim';
import type { Sfx } from '../audio';
import type { Session } from '../session';
import type { Stage } from '../stage';
import type { Ui } from '../ui';

/**
 * Who plays against whom:
 *  - ffa     everyone for themselves
 *  - 1v3     teams[0] is the solo player, teams[1] the three
 *  - 2v2     teams[0] against teams[1]
 *  - coop    everyone together against the game (returns `coop`)
 *  - rhythm  everyone for themselves, to the beat (Lo-Fi Session)
 *  - table   played on the phones lying on the coffee table, the TV keeps score (Coffee Table mode only)
 */
export type MinigameKind = 'ffa' | '1v3' | '2v2' | 'coop' | 'rhythm' | 'table';

export interface MinigameSeat {
  index: number;
  name: string;
  look: CompanionLook;
  /** Portrait for the score list (null while it renders). */
  thumb: string | null;
  color: string;
}

export interface MinigameContext {
  seats: MinigameSeat[];
  session: Session;
  stage: Stage;
  clock: Clock;
  ui: Ui;
  sfx: Sfx;
  rng: Rng;
  /** Seat indexes per side, for 1v3 and 2v2 (see MinigameKind). Undefined for ffa, coop and rhythm. */
  teams?: number[][];
  /** How sharp a computer player is, 0 (sleepy) to 1 (wide awake). Call once per CPU seat. */
  skill(): number;
}

export interface MinigameResult {
  /** A score per seat, higher is better. Teammates get the same score. */
  scores: number[];
  /** A short line per seat for the results ("3 pillows", "Finished in 12.4 s"). */
  details: string[];
  /** Co-op games: how well the group did, 0 (not at all) to 1 (perfect). */
  coop?: number;
}

export interface Minigame {
  readonly id: MinigameId;
  readonly title: string;
  /** One or two sentences on the intro card: what to do and how to win. */
  readonly how: string;
  readonly controller: ControllerKind;
  readonly kind: MinigameKind;
  /**
   * For competitive games that can also be played together (Don't Kill the Vibe): the combined score of all
   * seats that counts as a perfect group result.
   */
  readonly coopTarget?: number;
  play(ctx: MinigameContext): Promise<MinigameResult>;
}

/** Calls `fn` every frame until it returns true. Uses the game clock, so it respects ?speed. */
export function everyFrame(clock: Clock, fn: (dt: number, elapsed: number) => boolean): Promise<void> {
  return new Promise((resolve) => {
    let elapsed = 0;
    let last = clock.time;
    const step = () => {
      const dt = clock.time - last;
      last = clock.time;
      elapsed += dt;
      if (fn(dt, elapsed)) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
