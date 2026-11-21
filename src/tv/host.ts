// What every mode needs from the TV: who's playing (names, colours, portraits), the minigame flow (intro, ready,
// countdown, play, results), menus the host phone or the keyboard controls, and votes everyone takes part in.
import { lookKey } from '../../vendor/atelier-look/companionLogic';
import { companionThumb } from '../companion/thumb';
import type { Board } from '../game/board';
import { cpuSkill } from '../game/cpu';
import { type Rng, createRng, pick, randomSeed, shuffle } from '../game/rng';
import { ranks } from '../game/rules';
import type { CompanionLook, CompanionPreset } from '../shared/look';
import type { Clock } from './anim';
import type { Sfx } from './audio';
import type { BoardView } from './board-view';
import type { Minigame, MinigameResult, MinigameSeat } from './minigames/types';
import type { Inputs, Session } from './session';
import type { Stage, View } from './stage';
import { type MenuItem, type Ui, type Who, ordinal } from './ui';

export interface HostDeps {
  session: Session;
  inputs: Inputs;
  stage: Stage;
  boardView: BoardView;
  board: Board;
  ui: Ui;
  sfx: Sfx;
  clock: Clock;
  /** Atelier's preset companions, worn by computer players. */
  presets: CompanionPreset[];
  options: { demo: boolean; rounds: number | null; only: string | null };
}

/** A silly twist on a minigame (Spaced-Out Challenges). */
export type Twist = 'sharp' | 'slowmo' | 'flipped' | 'mirror';

export const TWISTS: Record<Twist, { label: string; text: string }> = {
  sharp: { label: 'Wide awake', text: 'The computer players had a coffee. They are sharp today.' },
  slowmo: { label: 'Slow motion', text: 'Everything is moving… very… slowly.' },
  flipped: { label: 'Upside down', text: "The whole screen is upside down. Don't think about it too much." },
  mirror: { label: 'Mirror world', text: 'Left is right and right is left.' },
};

export class Host {
  rng: Rng = createRng(randomSeed());
  private thumbs = new Map<string, string>();
  /** The view the last minigame left on screen (it is disposed once something replaces it). */
  private lastGameView: View | null = null;
  private pendingThumbs = new Map<string, Promise<void>>();

  constructor(readonly d: HostDeps) {}

  // ------------------------------------------------------------------ who's who

  /** A portrait of a look, or null while it renders (the session's change event refreshes the screens). */
  thumb(look: CompanionLook): string | null {
    const key = lookKey(look);
    const ready = this.thumbs.get(key);
    if (ready) return ready;
    if (!this.pendingThumbs.has(key)) {
      const job = companionThumb(look, 192, 'head')
        .then((url) => {
          this.thumbs.set(key, url);
          this.d.session.changed();
        })
        .catch((err: unknown) => console.error('Could not draw a portrait', err))
        .finally(() => this.pendingThumbs.delete(key));
      this.pendingThumbs.set(key, job);
    }
    return null;
  }

  /** Waits (a few seconds at most) until every seat's portrait is drawn, so a screen that shows them starts complete. */
  async portraits(seconds = 4): Promise<void> {
    for (const s of this.d.session.seats) this.thumb(s.look);
    if (!this.pendingThumbs.size) return;
    await Promise.race([Promise.all(this.pendingThumbs.values()), this.d.clock.wait(seconds)]);
  }

  who(seat: number): Who {
    const s = this.d.session.seats[seat];
    if (!s) return { name: '?', color: '#2d2d2d', thumb: null };
    return { name: s.name, color: s.color, thumb: this.thumb(s.look) };
  }

  color(seat: number): string {
    return this.d.session.seats[seat]?.color ?? '#2d2d2d';
  }

  seats(): number[] {
    return this.d.session.seats.map((s) => s.index);
  }

  waitAll(title: string, text?: string, except?: number): void {
    for (const s of this.d.session.seats) if (s.index !== except) this.d.session.setLayout(s.index, { kind: 'wait', title, ...(text ? { text } : {}) });
  }

  minigameSeats(): MinigameSeat[] {
    return this.d.session.seats.map((s) => ({ index: s.index, name: s.name, look: s.look, color: s.color, thumb: this.thumb(s.look) }));
  }

  /** Random sides for a team minigame: two pairs, or one against three (`solo` picks the one). */
  teamsFor(game: Minigame, solo?: number): number[][] | undefined {
    const all = shuffle(this.rng, this.seats());
    if (game.kind === '2v2') return [all.slice(0, 2), all.slice(2, 4)];
    if (game.kind === '1v3') {
      const one = solo ?? (all[0] as number);
      return [[one], all.filter((s) => s !== one)];
    }
    return undefined;
  }

  // ------------------------------------------------------------------ minigames

  /**
   * Intro card with everyone's Ready, a countdown, then the minigame. Resolves with its result and each seat's
   * place (1 = best; teammates and equal scores share a place). Results are shown by the caller.
   */
  async playMinigame(game: Minigame, opts: { teams?: number[][]; twist?: Twist; skillBoost?: number } = {}): Promise<{ result: MinigameResult; places: number[] }> {
    const { session, inputs, ui, stage, sfx, clock, boardView } = this.d;
    await this.portraits();
    const seats = this.minigameSeats();
    const teams = opts.teams ?? this.teamsFor(game);
    const teamLabel = (seat: number): string | undefined => {
      if (!teams) return undefined;
      const side = teams.findIndex((t) => t.includes(seat));
      if (game.kind === '1v3') return side === 0 ? 'You are on your own!' : 'You are on the team of three';
      const mate = teams[side]?.find((s) => s !== seat);
      return mate !== undefined ? `You team up with ${session.seats[mate]?.name ?? '?'}` : undefined;
    };

    // The intro card sits over whatever the mode shows (the board, the party, a backdrop). Only a minigame's own view
    // left over from the game before falls back to the board.
    if (!stage.current || stage.current === this.lastGameView) {
      stage.setView(boardView);
      boardView.overview();
    }
    ui.caption(null);
    ui.round(null);
    ui.mode('minigame');
    const ready = seats.map((s) => session.isCpu(s.index));
    const twistText = opts.twist ? ` ${TWISTS[opts.twist].text}` : '';
    const how = `${game.how}${twistText}`;
    // Team games show who plays with whom.
    const sides = teams?.map((t, k) => ({
      label: game.kind === '1v3' ? (k === 0 ? 'On their own' : 'Team of three') : t.map((s) => session.seats[s]?.name ?? '?').join(' & '),
      members: t.map((s) => seats.findIndex((x) => x.index === s)).filter((p) => p >= 0),
    }));
    const render = () => ui.showIntro({ ...game, how }, seats.map((s, i) => ({ ...this.who(s.index), ready: ready[i] ?? false })), sides);
    render();
    sfx.go();
    const intro = (seat: number, isReady: boolean) =>
      session.setLayout(seat, { kind: 'intro', game: game.id, title: game.title, how, controller: game.controller, ready: isReady, ...(teamLabel(seat) ? { team: teamLabel(seat) } : {}) });
    for (const s of seats) intro(s.index, ready[s.index] ?? false);
    const offChange = session.onChange(render); // a portrait that arrives late, a phone that reconnects
    await Promise.race([
      Promise.all(
        seats.map((s) =>
          inputs.wait(s.index, (m) => (m.t === 'ready' && m.ready ? true : undefined), { cpu: () => true, cpuDelay: [400, 1200], timeoutMs: 25_000 }).then(() => {
            ready[s.index] = true;
            intro(s.index, true);
            render();
          }),
        ),
      ),
      clock.wait(30),
    ]);
    offChange();
    ui.hidePanel();
    await ui.countdown();
    sfx.go();

    // Twists change how the game looks or runs, for this game only.
    const canvas = stage.renderer.domElement;
    const speedBefore = clock.speed;
    if (opts.twist === 'slowmo') clock.speed = speedBefore * 0.6;
    if (opts.twist === 'flipped') canvas.style.transform = 'rotate(180deg)';
    if (opts.twist === 'mirror') canvas.style.transform = 'scaleX(-1)';
    const boost = opts.skillBoost ?? (opts.twist === 'sharp' ? 0.45 : 0);
    let result: MinigameResult;
    try {
      result = await game.play({
        seats,
        session,
        stage,
        clock,
        ui,
        sfx,
        rng: this.rng,
        ...(teams ? { teams } : {}),
        skill: () => Math.min(1, cpuSkill(this.rng) + boost),
      });
    } finally {
      clock.speed = speedBefore;
      this.lastGameView = stage.current;
      canvas.style.transform = '';
      ui.timer(null);
      ui.caption(null);
    }
    ui.live(null);
    return { result, places: ranks(result.scores) };
  }

  /** The standard results card, and each phone's own result, for a few seconds. */
  async showResults(game: Minigame, result: MinigameResult, places: number[], coins?: number[]): Promise<void> {
    const { session, ui, sfx, clock } = this.d;
    sfx.fanfare();
    ui.showResults(
      game.title,
      session.seats.map((s, i) => ({ ...this.who(s.index), place: places[i] ?? 4, detail: result.details[i] ?? '', coins: coins?.[i] ?? 0 })),
    );
    for (const s of session.seats) {
      const place = places[s.index] ?? 4;
      const gain = coins?.[s.index] ?? 0;
      session.setLayout(s.index, {
        kind: 'result',
        place,
        title: place === 1 ? 'You won!' : `${ordinal(place)} place`,
        text: `${result.details[s.index] ?? ''}${gain > 0 ? ` · +${gain} coins` : ''}`,
      });
    }
    await clock.wait(4.5);
    ui.hidePanel();
  }

  /**
   * The end of a mode: a ranking on the TV, each phone's own result, and a "Back to the menu" button on the host
   * phone (and the TV). Resolves when someone goes back (or after a while in a CPU demo).
   */
  finish(opts: { kicker: string; title: string; rows: (Who & { seat: number; place: number; value: string; text?: string; members?: Who[] })[] }): Promise<void> {
    const { session, ui, clock } = this.d;
    return new Promise((resolve) => {
      let closed = false;
      const done = () => {
        if (closed) return;
        closed = true;
        off();
        ui.hidePanel();
        resolve();
      };
      ui.showRanking({ kicker: opts.kicker, title: opts.title, rows: opts.rows, again: 'Back to the menu', onAgain: done });
      const host = session.host();
      for (const r of opts.rows) {
        const s = session.seats[r.seat];
        if (!s) continue;
        if (s === host) {
          session.setLayout(r.seat, { kind: 'menu', title: `${ordinal(r.place)} · ${r.value}`, options: [{ label: 'Back to the menu' }], canPick: true, note: r.text ?? opts.title });
        } else {
          session.setLayout(r.seat, { kind: 'result', place: r.place, title: r.place === 1 ? 'You won!' : `${ordinal(r.place)} place`, text: r.text ?? r.value });
        }
      }
      const off = session.onInput((seat, msg) => {
        if ((msg.t === 'choose' || msg.t === 'again') && session.seats[seat] === session.host()) done();
      });
      if (!session.host()) void clock.wait(10).then(done);
    });
  }

  // ------------------------------------------------------------------ menus and votes

  /**
   * A menu on the TV that the host phone (or the keyboard: arrows and Enter, Escape for `back`) controls.
   * Resolves with the picked index, or -1 for back.
   */
  menu(opts: { kicker: string; title: string; items: MenuItem[]; note?: string; back?: string }): Promise<number> {
    const { session, ui } = this.d;
    return new Promise((resolve) => {
      let selected = 0;
      let closed = false;
      const items = opts.back ? [...opts.items, { title: opts.back, sub: 'Go back', icon: '↩' }] : opts.items;
      const done = (i: number) => {
        if (closed) return;
        closed = true;
        offInput();
        offChange();
        removeEventListener('keydown', onKey);
        ui.hidePanel();
        resolve(opts.back && i === items.length - 1 ? -1 : i);
      };
      const render = () => {
        ui.showMenu({ kicker: opts.kicker, title: opts.title, items, selected, note: opts.note, onPick: done });
        const host = session.host();
        for (const s of session.seats) {
          session.setLayout(s.index, {
            kind: 'menu',
            title: opts.title,
            options: items.map((it) => ({ label: it.title, ...(it.sub ? { hint: it.sub } : {}) })),
            canPick: s === host,
          });
        }
      };
      const onKey = (e: KeyboardEvent) => {
        const cols = Math.max(1, Math.floor((window.innerWidth * 0.92) / 260));
        const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
        if (e.key in moves) {
          selected = Math.max(0, Math.min(items.length - 1, selected + (moves[e.key] as number)));
          render();
        } else if (e.key === 'Enter') {
          done(selected);
        } else if (e.key === 'Escape' && opts.back) {
          done(items.length - 1);
        }
      };
      addEventListener('keydown', onKey);
      const offInput = session.onInput((seat, msg) => {
        if (msg.t === 'choose' && session.seats[seat] === session.host() && msg.index < items.length) done(msg.index);
      });
      // People who join while the menu is up get it on their phone too.
      const offChange = session.onChange(() => render());
      render();
      // Nobody to pick (a CPU demo): choose the first option.
      if (!session.host()) setTimeout(() => done(0), 1500);
    });
  }

  /** Everyone with a phone votes; the majority wins (ties and no votes: a random pick among the leaders). */
  vote(opts: { title: string; items: MenuItem[]; seconds?: number }): Promise<number> {
    const { session, ui, clock, sfx } = this.d;
    return new Promise((resolve) => {
      const votes = new Map<number, number>();
      const humans = session.seats.filter((s) => !session.isCpu(s.index)).map((s) => s.index);
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        offInput();
        const counts = opts.items.map((_, i) => [...votes.values()].filter((v) => v === i).length);
        const best = Math.max(...counts);
        const leaders = counts.flatMap((c, i) => (c === best ? [i] : []));
        ui.hidePanel();
        resolve(pick(this.rng, leaders));
      };
      const render = () => {
        ui.showMenu({
          kicker: 'Vote',
          title: opts.title,
          items: opts.items.map((it, i) => {
            const n = [...votes.values()].filter((v) => v === i).length;
            return { ...it, tag: n ? `${n} vote${n === 1 ? '' : 's'}` : undefined };
          }),
          selected: -1,
          note: humans.length ? 'Vote on your phone' : undefined,
          onPick: () => {},
        });
        for (const s of session.seats) {
          session.setLayout(s.index, {
            kind: 'menu',
            title: opts.title,
            options: opts.items.map((it) => ({ label: it.title, ...(it.sub ? { hint: it.sub } : {}) })),
            canPick: !votes.has(s.index),
            note: votes.has(s.index) ? 'Vote counted. Waiting for the others…' : 'Pick one',
          });
        }
      };
      const offInput = session.onInput((seat, msg) => {
        if (msg.t !== 'choose' || msg.index >= opts.items.length || votes.has(seat)) return;
        votes.set(seat, msg.index);
        sfx.tick();
        render();
        if (humans.every((h) => votes.has(h))) setTimeout(finish, 600);
      });
      render();
      void clock.wait(humans.length ? (opts.seconds ?? 15) : 1.5).then(() => {
        if (humans.some((h) => !votes.has(h)) || !humans.length) finish();
      });
    });
  }
}
