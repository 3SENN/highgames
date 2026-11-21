// Seats and phones. A seat is a courier in the game; a phone controls a seat.
// Seats without a connected phone are flown by the computer until a phone takes them (back).
import { type CompanionLook, type CompanionPreset, DEFAULT_LOOK, seatColor } from '../shared/look';
import { type Layout, MAX_SEATS, type PhoneMsg, type TvMsg, parsePhoneMsg } from '../shared/protocol';
import type { CastSeat } from './atelier';
import type { TvNet } from './net';

export interface Seat {
  index: number;
  name: string;
  /** The player's Atelier companion (as customised on their phone, or a preset for the computer). */
  look: CompanionLook;
  color: string;
  phoneId: number | null;
  token: string | null; // the owning phone, kept while it is away
  ready: boolean;
  rtt: number; // ms, measured with pings
}

type Listener = () => void;
type InputListener = (seat: number, msg: PhoneMsg) => void;

export class Session {
  seats: Seat[] = [];
  inGame = false;
  private layouts = new Map<number, Layout>();
  private seatOfPhone = new Map<number, number>();
  private spectators = new Set<number>();
  private changeListeners = new Set<Listener>();
  private inputListeners = new Set<InputListener>();
  private leaveListeners = new Set<(seat: number) => void>();
  private pings = new Map<number, number>();
  private pingCounter = 0;

  constructor(private readonly net: TvNet) {
    setInterval(() => this.pingAll(), 2000);
  }

  // ------------------------------------------------------------ events from the network

  onPhoneJoin(phoneId: number, name: string, token: string): void {
    let seat = this.seats.find((s) => s.token === token);
    if (seat) {
      if (seat.phoneId !== null) this.seatOfPhone.delete(seat.phoneId);
      seat.phoneId = phoneId;
    } else if (!this.inGame && this.seats.length < MAX_SEATS) {
      // The phone sends its companion right after joining; until then it wears Atelier's default look.
      seat = { index: this.seats.length, name, look: DEFAULT_LOOK, color: seatColor(this.seats.length), phoneId, token, ready: false, rtt: 60 };
      this.seats.push(seat);
    } else if (this.inGame) {
      // Mid-game: take over a courier the computer is flying.
      seat = this.seats.find((s) => s.token === null);
      if (seat) {
        seat.token = token;
        seat.phoneId = phoneId;
        seat.name = name;
      }
    }
    if (!seat) {
      this.spectators.add(phoneId);
      this.net.send(phoneId, { t: 'layout', layout: { kind: 'wait', title: 'All four seats are taken', text: 'Watch the big screen. You can join the next game.' } });
      return;
    }
    this.seatOfPhone.set(phoneId, seat.index);
    this.sendIdentity(seat);
    const layout = this.layouts.get(seat.index);
    if (layout) this.net.send(phoneId, { t: 'layout', layout });
    this.changed();
  }

  onPhoneLeave(phoneId: number): void {
    this.spectators.delete(phoneId);
    const index = this.seatOfPhone.get(phoneId);
    this.seatOfPhone.delete(phoneId);
    if (index === undefined) return;
    const seat = this.seats[index];
    if (!seat || seat.phoneId !== phoneId) return;
    seat.phoneId = null;
    if (!this.inGame) {
      // In the lobby a phone that leaves gives up its seat.
      this.seats.splice(index, 1);
      this.reindex();
    } else {
      for (const fn of this.leaveListeners) fn(index);
    }
    this.changed();
  }

  onMessage(phoneId: number, raw: unknown): void {
    const msg = parsePhoneMsg(raw);
    const index = this.seatOfPhone.get(phoneId);
    if (!msg || index === undefined) return;
    if (msg.t === 'pong') {
      const sent = this.pings.get(msg.n);
      const seat = this.seats[index];
      if (sent !== undefined && seat) seat.rtt = seat.rtt * 0.7 + (performance.now() - sent) * 0.3;
      return;
    }
    for (const fn of this.inputListeners) fn(index, msg);
  }

  // ------------------------------------------------------------ for the game

  /** True when nobody's phone is controlling this seat right now. */
  isCpu(index: number): boolean {
    return this.seats[index]?.phoneId == null;
  }

  humans(): Seat[] {
    return this.seats.filter((s) => s.token !== null);
  }

  host(): Seat | undefined {
    return this.seats.find((s) => s.phoneId !== null);
  }

  /**
   * Fills empty seats with computer players: first the person's own Atelier companions (the app's cast), then Atelier's
   * preset companions. Names people already took are skipped, so nobody plays against a second "Pip".
   */
  fillWithCpus(presets: readonly CompanionPreset[], cast: readonly CastSeat[] = []): void {
    const names = new Set(this.seats.map((s) => s.name.toLowerCase()));
    const fresh = (name: string): boolean => {
      const key = name.toLowerCase();
      if (names.has(key)) return false;
      names.add(key);
      return true;
    };
    const shuffled = [...presets].sort(() => Math.random() - 0.5);
    const pool = [...cast.filter((c) => fresh(c.name)), ...shuffled.filter((p) => fresh(p.name))];
    while (this.seats.length < MAX_SEATS) {
      const pick = pool.shift();
      const index = this.seats.length;
      this.seats.push({
        index,
        name: pick?.name ?? `Player ${index + 1}`,
        look: pick?.look ?? DEFAULT_LOOK,
        color: seatColor(index),
        phoneId: null,
        token: null,
        ready: true,
        rtt: 0,
      });
    }
    this.changed();
  }

  /** Between modes: computer players leave (people stay, even if their phone is away), so new people can join. */
  dropCpus(): void {
    this.inGame = false;
    this.seats = this.seats.filter((s) => s.token !== null);
    this.reindex();
    this.changed();
  }

  /** Back to the lobby: computer couriers leave, people stay. */
  resetForLobby(): void {
    this.inGame = false;
    this.seats = this.seats.filter((s) => s.phoneId !== null);
    for (const s of this.seats) s.ready = false;
    this.reindex();
    this.layouts.clear();
    this.changed();
  }

  setLayout(index: number, layout: Layout): void {
    this.layouts.set(index, layout);
    const phone = this.seats[index]?.phoneId;
    if (phone != null) this.net.send(phone, { t: 'layout', layout });
  }

  send(index: number, msg: TvMsg): void {
    const phone = this.seats[index]?.phoneId;
    if (phone != null) this.net.send(phone, msg);
  }

  setLayoutAll(make: (seat: Seat) => Layout): void {
    for (const seat of this.seats) this.setLayout(seat.index, make(seat));
  }

  onInput(fn: InputListener): () => void {
    this.inputListeners.add(fn);
    return () => this.inputListeners.delete(fn);
  }

  onChange(fn: Listener): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onSeatLeft(fn: (seat: number) => void): () => void {
    this.leaveListeners.add(fn);
    return () => this.leaveListeners.delete(fn);
  }

  changed(): void {
    for (const fn of this.changeListeners) fn();
  }

  sendIdentity(seat: Seat): void {
    if (seat.phoneId === null) return;
    this.net.send(seat.phoneId, { t: 'you', seat: seat.index, name: seat.name, color: seat.color });
  }

  private reindex(): void {
    this.seatOfPhone.clear();
    this.seats.forEach((s, i) => {
      s.index = i;
      s.color = seatColor(i);
      if (s.phoneId !== null) this.seatOfPhone.set(s.phoneId, i);
    });
    for (const s of this.seats) this.sendIdentity(s);
  }

  private pingAll(): void {
    const n = ++this.pingCounter;
    this.pings.set(n, performance.now());
    this.pings.delete(n - 10);
    for (const s of this.seats) if (s.phoneId !== null) this.net.send(s.phoneId, { t: 'ping', n });
  }
}

// ------------------------------------------------------------------ waiting for input

type Accept<T> = (msg: PhoneMsg) => T | undefined;

interface Waiter {
  seat: number;
  accept: Accept<unknown>;
  resolve: (v: unknown) => void;
  cpu: () => unknown;
}

/**
 * Turns phone input into promises: `await inputs.wait(seat, accept, { cpu })`.
 * A seat flown by the computer (or a phone that drops out mid-wait) answers with `cpu()`.
 */
export class Inputs {
  private waiters = new Set<Waiter>();

  constructor(
    private readonly session: Session,
    private readonly speed: number,
  ) {
    session.onInput((seat, msg) => {
      for (const w of [...this.waiters]) {
        if (w.seat !== seat) continue;
        const v = w.accept(msg);
        if (v !== undefined) {
          this.waiters.delete(w);
          w.resolve(v);
        }
      }
    });
    session.onSeatLeft((seat) => {
      for (const w of [...this.waiters]) {
        if (w.seat !== seat) continue;
        this.waiters.delete(w);
        setTimeout(() => w.resolve(w.cpu()), 600 / this.speed);
      }
    });
  }

  wait<T>(seat: number, accept: Accept<T>, opts: { cpu: () => T; cpuDelay?: [number, number]; timeoutMs?: number }): Promise<T> {
    return new Promise<T>((resolve) => {
      if (this.session.isCpu(seat)) {
        const [lo, hi] = opts.cpuDelay ?? [500, 1100];
        setTimeout(() => resolve(opts.cpu()), (lo + Math.random() * (hi - lo)) / this.speed);
        return;
      }
      const w: Waiter = { seat, accept, resolve: resolve as (v: unknown) => void, cpu: opts.cpu };
      this.waiters.add(w);
      // Nobody waits forever on a phone that went quiet.
      setTimeout(() => {
        if (this.waiters.delete(w)) resolve(opts.cpu());
      }, opts.timeoutMs ?? 45_000);
    });
  }
}
