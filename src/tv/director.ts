// The flow around the modes: the lobby (join and dress up), then the mode menu, then the chosen mode, and back.
// It also tells Atelier what's going on: a line on the game's tab (atelier.status) and the state for playtests.
import { type CastSeat, castSeats, pickCast, reportState, setStatus } from './atelier';
import { Host, type HostDeps } from './host';
import { MODES } from './modes';
import type { TvNet } from './net';

export interface DirectorDeps extends HostDeps {
  net: TvNet;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export class Director {
  private readonly host: Host;
  private rounds = 5;
  /** The person's own companions (Atelier's cast for this app): they fill the seats nobody's phone takes. */
  private cast: CastSeat[] = [];

  constructor(private readonly d: DirectorDeps) {
    this.host = new Host(d);
    if (d.options.rounds) this.rounds = d.options.rounds;
  }

  async run(): Promise<never> {
    let demo = this.d.options.demo;
    this.cast = await castSeats();
    for (;;) {
      if (!demo) demo = await this.lobby();
      if (demo) {
        // A CPU-only game to watch: straight into Snack Run.
        await this.play(0);
        demo = false;
        continue;
      }
      await this.menu();
    }
  }

  /** The mode menu, until the host goes back to the lobby. */
  private async menu(): Promise<void> {
    const { ui } = this.d;
    for (;;) {
      this.reset();
      ui.caption('Pick a mode');
      setStatus('Picking a mode');
      reportState({ screen: 'menu', players: this.d.session.humans().length });
      const i = await this.host.menu({
        kicker: 'Highgames',
        title: 'What are we playing?',
        items: MODES.map((m) => ({ title: m.title, sub: m.sub, tag: m.tag, icon: m.icon })),
        note: 'The host picks on their phone, or use the arrow keys and Enter.',
        back: 'Back to the lobby',
      });
      if (i < 0) return;
      await this.play(i);
    }
  }

  private async play(index: number): Promise<void> {
    const { session, ui, presets } = this.d;
    const mode = MODES[index];
    if (!mode) return;
    session.fillWithCpus(presets, this.cast);
    session.inGame = true;
    setStatus(mode.title);
    reportState({ screen: 'game', mode: mode.id, players: session.humans().length });
    ui.caption(null); // not "Pick a mode" any more
    try {
      await mode.run(this.host, this.rounds);
    } catch (err) {
      console.error(err);
      ui.toast('Something went wrong in that mode. Back to the menu.', '#e0344b', 5);
    }
    session.dropCpus();
  }

  /** A clean screen between modes. */
  private reset(): void {
    const { stage, boardView, ui } = this.d;
    stage.setView(boardView);
    void boardView.setPlayers([]);
    boardView.overview();
    ui.hideHud();
    ui.hidePanel();
    ui.round(null);
    ui.meter(null);
    ui.live(null);
    ui.timer(null);
    ui.mode('lobby');
    ui.prompts([
      { key: '←→', label: 'Choose' },
      { key: 'Enter', label: 'Play' },
      { key: 'Esc', label: 'Lobby' },
    ]);
  }

  // ------------------------------------------------------------------ the lobby

  /** Resolves when the game should start; true means a CPU-only demo. */
  private lobby(): Promise<boolean> {
    const { session, ui, boardView, stage } = this.d;
    session.resetForLobby();
    stage.setView(boardView);
    void boardView.setPlayers([]);
    boardView.overview();
    ui.hideHud();
    ui.round(null);
    ui.meter(null);
    ui.mode('lobby');
    ui.caption('Scan the code to join, then dress up your companion');
    // The keys along the bottom: S once sharing stopped, C when Atelier has companions to offer.
    let shownKeys = '';
    const keys = () => {
      const list = [
        { key: 'Enter', label: 'Start' },
        { key: 'D', label: 'CPU game' },
        ...(this.d.net.sharing.state === 'stopped' ? [{ key: 'S', label: 'Share again' }] : []),
        ...(this.cast.length > 0 ? [{ key: 'C', label: 'Your companions' }] : []),
        { key: 'M', label: 'Mute' },
      ];
      const id = list.map((k) => k.key).join();
      if (id === shownKeys) return;
      shownKeys = id;
      ui.prompts(list);
    };

    return new Promise((resolve) => {
      const render = () => {
        const host = session.host();
        const { sharing } = this.d.net;
        ui.showLobby({
          sharing,
          seats: session.seats.map((s) => ({ ...this.host.who(s.index), ready: s.ready, host: s === host })),
          rounds: this.rounds,
          cast: this.cast.map((c) => c.name),
        });
        keys();
        const players = session.seats.length;
        setStatus(sharing.state === 'sharing' ? `Lobby · ${plural(players, 'player')}` : 'Lobby · not sharing');
        reportState({ screen: 'lobby', sharing: sharing.state, lan: sharing.state === 'sharing' && sharing.lan, players, ready: session.seats.filter((s) => s.ready).length });
        boardView.lineup(session.seats.map((s) => ({ seat: s.index, look: s.look, name: s.name, color: s.color, ready: s.ready })));
        for (const s of session.seats) {
          session.setLayout(s.index, { kind: 'lobby', ready: s.ready, host: s === host, rounds: this.rounds, canStart: s === host });
        }
      };
      const finish = (demo: boolean) => {
        offChange();
        offInput();
        offStart();
        removeEventListener('keydown', onKey);
        ui.hidePanel();
        boardView.endLineup();
        resolve(demo);
      };
      const offChange = session.onChange(render);
      const offStart = ui.onStart(finish);
      const onKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (e.key === 'Enter') finish(false);
        else if (e.key === 'd' || e.key === 'D') finish(true);
        else if ((e.key === 's' || e.key === 'S') && this.d.net.sharing.state === 'stopped') void this.d.net.start();
        else if ((e.key === 'c' || e.key === 'C') && this.cast.length > 0) void this.chooseCast(render);
      };
      addEventListener('keydown', onKey);
      const offInput = session.onInput((seat, msg) => {
        const s = session.seats[seat];
        if (!s) return;
        if (msg.t === 'look') {
          s.look = msg.look;
        } else if (msg.t === 'ready') {
          s.ready = msg.ready;
        } else if (msg.t === 'rounds' && s === session.host()) {
          this.rounds = msg.rounds;
        } else if (msg.t === 'start' && s === session.host()) {
          finish(false);
          return;
        } else {
          return;
        }
        render();
      });
      render();
    });
  }

  /** Atelier's own picker: which of the person's companions play the empty seats. */
  private async chooseCast(render: () => void): Promise<void> {
    const picked = await pickCast(4);
    if (!picked || picked.length === 0) return;
    this.cast = picked;
    this.d.ui.toast(`${picked.map((c) => c.name).join(', ')} will fill the empty seats`);
    render();
  }
}
