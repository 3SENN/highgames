// The board game, for Snack Run (everyone for themselves) and Tag Team Takeout (two teams of two).
// A "side" is whoever plays as one courier on the board: one seat, or a team of two sharing coins, smiles,
// items and a little flying couch. In a team, one partner rolls and the other makes the calls (forks, orders,
// the corner store); the roles swap every turn. Rules come from src/game; this file runs the turns.
import { space } from '../../game/board';
import { chooseBuy, chooseFork, chooseItem, choosePriority } from '../../game/cpu';
import { shuffle } from '../../game/rng';
import {
  type EnterResult,
  type GameState,
  PRIORITY_COST,
  applyEvent,
  awardBonuses,
  awardMinigame,
  buyItem,
  createGame,
  enterSpace,
  land,
  marketOffers,
  parcelOffer,
  player,
  rollDice,
  standings,
  takeParcel,
  useItem,
} from '../../game/rules';
import { islandInfo } from '../../shared/islands';
import { ITEMS, MAX_ITEMS } from '../../shared/items';
import type { ChoiceOption } from '../../shared/protocol';
import type { Host } from '../host';
import { MINIGAMES, minigameById, minigamesOfKind } from '../minigames';
import type { Minigame } from '../minigames/types';
import type { Who } from '../ui';

interface Side {
  index: number;
  name: string;
  seats: number[];
}

export class BoardGame {
  private state!: GameState;
  private sides: Side[] = [];
  private bag: Minigame[] = [];
  private active: number | null = null;
  private turns: number[] = [];

  constructor(
    private readonly host: Host,
    private readonly opts: { teams: boolean; rounds: number; title: string; intro: string },
  ) {}

  async run(): Promise<void> {
    const { session, ui, boardView, board, sfx } = this.host.d;
    ui.mode('board');
    ui.caption(null);
    ui.prompts([
      { key: 'M', label: 'Mute' },
      { key: 'F', label: 'Full screen' },
    ]);
    const seats = this.host.seats();
    if (this.opts.teams) {
      const order = shuffle(this.host.rng, seats);
      const pairs = [order.slice(0, 2), order.slice(2, 4)];
      this.sides = pairs.map((p, i) => ({ index: i, name: p.map((s) => session.seats[s]?.name ?? '?').join(' & '), seats: p }));
    } else {
      this.sides = seats.map((s) => ({ index: s, name: session.seats[s]?.name ?? '?', seats: [s] }));
    }
    this.turns = this.sides.map(() => 0);
    this.state = createGame({ players: this.sides.map((s) => ({ name: s.name })), rounds: this.opts.rounds, board, rng: this.host.rng });
    await boardView.setPlayers(
      this.sides.map((s) => ({ seat: s.index, looks: s.seats.map((x) => session.seats[x]?.look).filter((l) => l !== undefined), space: board.start, color: this.host.color(s.seats[0] as number) })),
    );
    boardView.overview();
    const offChange = session.onChange(() => this.refreshHud());
    try {
      this.refreshHud();
      this.host.waitAll('The game is starting', 'Look at the big screen');
      await ui.banner(this.opts.title, this.opts.intro, 3.4);
      const order = this.state.order.map((s) => player(this.state, s).name).join(', then ');
      ui.toast(`Turn order: ${order}`, '#2d2d2d', 5);
      if (this.opts.teams) ui.toast('In a team, one of you rolls and the other makes the calls. You swap every turn.', '#2d2d2d', 6);
      sfx.go();

      for (this.state.round = 1; this.state.round <= this.state.rounds; this.state.round++) {
        ui.round(this.state.round, this.state.rounds);
        await ui.banner(this.state.round === this.state.rounds ? 'Final round!' : `Round ${this.state.round}`, `of ${this.state.rounds}`, 1.4);
        for (const side of this.state.order) await this.turn(side);
        this.active = null;
        this.refreshHud();
        await this.minigame();
      }
      await this.finale();
    } finally {
      offChange();
      ui.round(null);
    }
  }

  // ------------------------------------------------------------------ who is who

  private side(index: number): Side {
    return this.sides[index] as Side;
  }

  private sideWho(index: number): Who & { members?: Who[] } {
    const side = this.side(index);
    const first = this.host.who(side.seats[0] as number);
    return side.seats.length > 1 ? { ...first, name: side.name, members: side.seats.map((s) => this.host.who(s)) } : first;
  }

  private color(index: number): string {
    return this.host.color(this.side(index).seats[0] as number);
  }

  /** Who rolls and who decides this turn (the same seat when playing alone). */
  private roles(index: number): { roller: number; decider: number } {
    const seats = this.side(index).seats;
    const n = this.turns[index] ?? 0;
    return { roller: seats[n % seats.length] as number, decider: seats[(n + 1) % seats.length] as number };
  }

  private refreshHud(): void {
    if (!this.state) return;
    const { session, ui } = this.host.d;
    ui.renderHud(
      this.state.players.map((p) => ({
        ...this.sideWho(p.seat),
        seat: p.seat,
        coins: p.coins,
        stamps: p.stamps,
        parcels: p.parcels,
        items: p.items,
        cpu: this.side(p.seat).seats.every((s) => session.isCpu(s)),
      })),
      this.active,
    );
  }

  // ------------------------------------------------------------------ one turn

  private async turn(index: number): Promise<void> {
    const state = this.state;
    const { session, inputs, ui, boardView, board, sfx, clock } = this.host.d;
    const p = player(state, index);
    const { roller, decider } = this.roles(index);
    const rollerName = session.seats[roller]?.name ?? p.name;
    this.active = index;
    this.refreshHud();
    boardView.focusSeat(index);
    for (const s of session.seats) {
      if (s.index === roller || s.index === decider) continue;
      session.setLayout(s.index, { kind: 'wait', title: `${p.name} ${this.opts.teams ? 'are' : 'is'} on the move`, text: 'Watch the big screen' });
    }
    if (decider !== roller) session.setLayout(decider, { kind: 'wait', title: `${rollerName} rolls, you make the calls`, text: 'Your choices show up here' });
    const usable = () => p.items.filter((i) => ITEMS[i].usable);
    ui.caption(session.isCpu(roller) ? `${p.name}'s turn` : `${rollerName}: shake your phone to roll!`, this.color(index));

    let plan = { dice: 1 as 1 | 2, bonus: 0 };
    session.setLayout(roller, { kind: 'turn', items: usable(), motion: true });
    const first = await inputs.wait(roller, (m) => (m.t === 'roll' ? 'roll' : m.t === 'use' ? m.item : undefined), {
      cpu: () => chooseItem(state, index, this.host.rng) ?? 'roll',
      cpuDelay: [700, 1300],
    });
    if (first !== 'roll') {
      const used = useItem(state, index, first);
      if (used) {
        plan = used;
        sfx.good();
        ui.toast(`${rollerName} uses ${ITEMS[first].name}!`, this.color(index));
        this.refreshHud();
      }
      session.setLayout(roller, { kind: 'turn', items: [], motion: true });
      await inputs.wait(roller, (m) => (m.t === 'roll' ? true : undefined), { cpu: () => true, cpuDelay: [400, 800] });
    }
    const roll = rollDice(this.host.rng, plan);
    session.setLayout(roller, { kind: 'rolled', values: roll.values, bonus: plan.bonus });
    ui.caption(`${rollerName} rolls…`, this.color(index));
    // The dice are thrown on the board itself; the sounds follow what they do.
    await boardView.rollDice(index, roll.values, plan.bonus, {
      throw: () => sfx.roll(),
      bounce: (strength) => (strength > 0.45 ? sfx.pump() : sfx.tick()),
      reveal: () => sfx.good(),
      bonus: () => sfx.coin(true),
    });
    ui.caption(`${p.name} ${this.opts.teams ? 'float' : 'floats'} ${roll.total} space${roll.total === 1 ? '' : 's'}`, this.color(index));

    let steps = roll.total;
    ui.steps(steps);
    boardView.showPath(this.wayAhead(p.space, steps), this.color(index));
    while (steps > 0) {
      const options = space(board, p.space).next;
      let to = options[0] as number;
      if (options.length > 1) {
        const described = options.map((o) => this.describePath(o));
        boardView.showForkArrows(options, described.map((d) => d.label));
        const deciderName = session.seats[decider]?.name ?? p.name;
        ui.caption(session.isCpu(decider) ? `${deciderName} is picking a way…` : `${deciderName}: pick a way on your phone`, this.color(index));
        session.setLayout(decider, { kind: 'choice', title: 'Which way?', options: described });
        const idx = await inputs.wait(decider, (m) => (m.t === 'choose' && m.index < options.length ? m.index : undefined), {
          cpu: () => chooseFork(state, board, index, options, this.host.rng),
          cpuDelay: [700, 1300],
        });
        boardView.hideForkArrows();
        to = options[idx] as number;
        boardView.showPath([to, ...this.wayAhead(to, steps - 1)], this.color(index));
        if (decider !== roller) session.setLayout(decider, { kind: 'wait', title: 'Off we go', text: 'Watch the big screen' });
        ui.caption(`${p.name} ${this.opts.teams ? 'drift' : 'drifts'} on`, this.color(index));
      }
      const res = enterSpace(state, board, index, to);
      steps -= 1;
      sfx.hop();
      await boardView.hop(index, to);
      ui.steps(steps > 0 ? steps : null);
      await this.arrival(index, decider, res);
    }
    ui.steps(null);
    boardView.clearPath();
    await this.landing(index, decider, true);
    this.turns[index] = (this.turns[index] ?? 0) + 1;
    this.refreshHud();
    await clock.wait(0.5);
  }

  /** The spaces a courier will cross next, up to the next fork: the board lights them up. */
  private wayAhead(from: number, steps: number): number[] {
    const { board } = this.host.d;
    const ids: number[] = [];
    let id = from;
    for (let i = 0; i < steps; i++) {
      const next = space(board, id).next;
      if (next.length !== 1) break;
      id = next[0] as number;
      ids.push(id);
    }
    return ids;
  }

  /** Labels for a fork: where each way leads. */
  private describePath(start: number): ChoiceOption {
    const { board } = this.host.d;
    let id = start;
    for (let i = 0; i < 12; i++) {
      const s = space(board, id);
      if (s.island === 'hq') return { label: 'Through the Snack Shack', hint: 'Shortcut · grab an order', island: 'hq' };
      if (s.island) return { label: `To ${islandInfo(s.island).name}`, hint: 'Along the islands', island: s.island };
      id = s.next[0] as number;
    }
    return { label: 'Onward' };
  }

  private async arrival(index: number, decider: number, res: EnterResult): Promise<void> {
    const state = this.state;
    const { session, inputs, ui, boardView, sfx, clock } = this.host.d;
    const p = player(state, index);
    for (const d of res.deliveries) {
      sfx.fanfare();
      boardView.excite(index);
      boardView.popText(index, `+${d.stamps} ☺`, '#FFD34D');
      ui.toast(`${p.name} delivered a ${d.parcel.priority ? 'rush ' : ''}order to ${islandInfo(d.parcel.to).name}! +${d.stamps} smile${d.stamps > 1 ? 's' : ''}`, this.color(index), 4);
      for (const s of this.side(index).seats) session.send(s, { t: 'buzz', pattern: [60, 40, 60, 40, 120] });
      this.refreshHud();
      await clock.wait(1.2);
    }
    if (res.canPickUp) {
      const offer = parcelOffer(state, index, this.host.rng);
      const canPriority = p.coins >= PRIORITY_COST;
      ui.caption(`${p.name} ${this.opts.teams ? 'are' : 'is'} at the Snack Shack`, this.color(index));
      session.setLayout(decider, { kind: 'parcel', coins: p.coins, cost: PRIORITY_COST, standard: islandInfo(offer.standard).name, priority: islandInfo(offer.priority).name });
      const priority = await inputs.wait(decider, (m) => (m.t === 'parcel' ? m.priority : undefined), {
        cpu: () => choosePriority(state, index),
        cpuDelay: [700, 1200],
      });
      const rush = priority && canPriority;
      const to = rush ? offer.priority : offer.standard;
      takeParcel(state, index, to, rush);
      sfx.good();
      boardView.popText(index, rush ? 'Rush order!' : 'Order up!', islandInfo(to).color);
      ui.toast(`${p.name} ${this.opts.teams ? 'grab' : 'grabs'} a ${rush ? 'rush ' : ''}order for ${islandInfo(to).name}`, this.color(index));
      this.refreshHud();
      await clock.wait(0.6);
    }
  }

  private async landing(index: number, decider: number, allowGust: boolean): Promise<void> {
    const state = this.state;
    const { session, inputs, ui, boardView, board, sfx, clock } = this.host.d;
    const p = player(state, index);
    const l = land(state, board, index, this.host.rng);
    switch (l.kind) {
      case 'coins':
        if (l.amount !== 0) {
          sfx.coin(l.amount > 0);
          boardView.popText(index, `${l.amount > 0 ? '+' : '−'}${Math.abs(l.amount)} ●`, l.amount > 0 ? '#9BE564' : '#FF8FA3');
          if (l.amount < 0) boardView.excite(index, 1.4, 'sad');
        } else {
          boardView.popText(index, '0 ●', '#FFFFFF');
        }
        break;
      case 'umbrella':
        sfx.good();
        boardView.popText(index, 'Hoodie up!', '#9BD3FF');
        ui.toast(`${p.name} ${this.opts.teams ? 'pull' : 'pulls'} the hoodie up and shrug${this.opts.teams ? '' : 's'} off the bummer`, this.color(index));
        break;
      case 'event': {
        const before = state.players.map((q) => q.stamps);
        const out = applyEvent(state, board, index, l.event, this.host.rng);
        sfx.whoosh();
        await ui.banner(out.title, out.text, 2.6);
        if (out.swapWith !== undefined) {
          await Promise.all([boardView.fly(index, p.space), boardView.fly(out.swapWith, player(state, out.swapWith).space)]);
        }
        for (const c of out.coins) if (c.amount) boardView.popText(c.seat, `${c.amount > 0 ? '+' : '−'}${Math.abs(c.amount)} ●`, c.amount > 0 ? '#9BE564' : '#FF8FA3');
        state.players.forEach((q, i) => {
          if (q.stamps > (before[i] ?? 0)) ui.toast(`${q.name} delivered on arrival! +${q.stamps - (before[i] ?? 0)} ☺`, this.color(i));
        });
        break;
      }
      case 'market': {
        ui.caption(`${p.name} ${this.opts.teams ? 'pop' : 'pops'} into the corner store`, this.color(index));
        session.setLayout(decider, { kind: 'shop', coins: p.coins, offers: marketOffers(), full: p.items.length >= MAX_ITEMS });
        const item = await inputs.wait(decider, (m) => (m.t === 'buy' ? m.item : undefined), {
          cpu: () => chooseBuy(state, index, this.host.rng),
          cpuDelay: [900, 1500],
        });
        if (item && buyItem(state, index, item)) {
          sfx.coin(false);
          ui.toast(`${p.name} ${this.opts.teams ? 'buy' : 'buys'} ${ITEMS[item].name === 'Hoodie' ? 'a Hoodie' : `a ${ITEMS[item].name}`}`, this.color(index));
        } else {
          ui.toast(`${p.name} just ${this.opts.teams ? 'look' : 'looks'} at the snacks for a while`, this.color(index));
        }
        break;
      }
      case 'gust':
        if (!allowGust) break;
        sfx.whoosh();
        ui.toast(`A breeze carries ${p.name} ${l.steps} spaces onward`, this.color(index));
        for (let i = 0; i < l.steps; i++) {
          const to = space(board, p.space).next[0] as number;
          const res = enterSpace(state, board, index, to);
          await boardView.hop(index, to, 0.22);
          await this.arrival(index, decider, res);
        }
        await this.landing(index, decider, false);
        return;
      case 'none':
        break;
    }
    this.refreshHud();
    await clock.wait(0.7);
  }

  // ------------------------------------------------------------------ the minigame after each round

  private nextMinigame(): { game: Minigame; teams?: number[][] } {
    const forced = this.host.d.options.only ? minigameById(this.host.d.options.only) : undefined;
    if (this.opts.teams) {
      const teams = this.sides.map((s) => s.seats);
      if (forced) return { game: forced, teams: forced.kind === '2v2' ? teams : undefined };
      const pool = minigamesOfKind('2v2');
      if (pool.length && this.host.rng() < 0.7) return { game: pool[Math.floor(this.host.rng() * pool.length)] as Minigame, teams };
      return { game: this.drawFfa() };
    }
    if (forced) return { game: forced };
    // Mostly everyone for themselves; now and then teams, or the leader alone against the rest.
    const roll = this.host.rng();
    const twos = minigamesOfKind('2v2');
    const ones = minigamesOfKind('1v3');
    if (roll < 0.15 && ones.length) {
      const leader = standings(this.state)[0]?.seat;
      const game = ones[Math.floor(this.host.rng() * ones.length)] as Minigame;
      return { game, teams: this.host.teamsFor(game, leader) };
    }
    if (roll < 0.3 && twos.length) {
      const game = twos[Math.floor(this.host.rng() * twos.length)] as Minigame;
      return { game, teams: this.host.teamsFor(game) };
    }
    return { game: this.drawFfa() };
  }

  /** Free-for-all games come out of a shuffled bag, so they don't repeat until all have been played. */
  private drawFfa(): Minigame {
    if (this.bag.length === 0) {
      const ffa = MINIGAMES.filter((m) => m.kind === 'ffa');
      this.bag = shuffle(this.host.rng, ffa.length ? ffa : [...MINIGAMES]);
    }
    return this.bag.pop() as Minigame;
  }

  private async minigame(): Promise<void> {
    const { stage, boardView, ui } = this.host.d;
    const { game, teams } = this.nextMinigame();
    const { result } = await this.host.playMinigame(game, teams ? { teams } : {});
    // Per side: a team's score is its members' score (they're the same in a team game; the best one otherwise).
    const sideScores = this.sides.map((s) => Math.max(...s.seats.map((seat) => result.scores[seat] ?? 0)));
    const { places: sidePlaces, coins: sideCoins } = awardMinigame(this.state, sideScores);
    const seatOf = (seat: number) => this.sides.findIndex((s) => s.seats.includes(seat));
    const places = this.host.seats().map((seat) => sidePlaces[seatOf(seat)] ?? 4);
    const coins = this.host.seats().map((seat) => sideCoins[seatOf(seat)] ?? 0);
    await this.host.showResults(game, result, places, coins);
    stage.setView(boardView);
    ui.mode('board');
    if (this.state.round < this.state.rounds) ui.round(this.state.round + 1, this.state.rounds);
    this.refreshHud();
  }

  // ------------------------------------------------------------------ the end

  private async finale(): Promise<void> {
    const state = this.state;
    const { session, ui, boardView, sfx, clock } = this.host.d;
    ui.round(null);
    boardView.overview();
    this.host.waitAll('Counting the smiles…');
    await ui.banner('That’s the last delivery!', 'Time for the bonus smiles', 2.4);
    for (const bonus of awardBonuses(state)) {
      sfx.fanfare();
      ui.showBonus(bonus.title, bonus.text, bonus.seats.map((s) => this.sideWho(s)));
      for (const s of bonus.seats) boardView.excite(s, 2);
      this.refreshHud();
      await clock.wait(3);
    }
    const table = standings(state);
    sfx.win();
    boardView.faceCamera();
    for (const row of table) boardView.excite(row.seat, 8, row.place === 1 ? 'happy' : row.place === table.length ? 'sad' : 'approval');
    const winner = table.filter((r) => r.place === 1).map((r) => player(state, r.seat).name).join(' & ');
    const host = session.host();
    for (const row of table) {
      for (const seat of this.side(row.seat).seats) {
        session.setLayout(seat, { kind: 'final', place: row.place, stamps: row.stamps, coins: row.coins, winner, host: session.seats[seat] === host });
      }
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        off();
        resolve();
      };
      ui.showFinal(
        table.map((r) => ({ ...this.sideWho(r.seat), place: r.place, stamps: r.stamps, coins: r.coins })),
        done,
      );
      const off = session.onInput((seat, msg) => {
        if (msg.t === 'again' && session.seats[seat] === session.host()) done();
      });
      if (!session.host()) void clock.wait(12).then(done);
    });
    ui.hidePanel();
  }
}
