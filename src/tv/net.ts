// The big screen's link to the phones. Atelier runs a small web server for the game (atelier.server): phones on the same
// Wi-Fi scan its QR code, open the controller page from the pack's app/phone folder over https (so they give motion
// sensors), and keep one socket to this page. Atelier owns the real sockets: it lets in only this computer and private
// networks, puts an unguessable token in every address, and caps message sizes and rates. This class turns those
// sockets into numbered phones for the Session and keeps what the lobby shows about joining.
import { parseJoin } from '../shared/join';
import type { TvMsg } from '../shared/protocol';
import type { AtelierBridge, AtelierServerSocket, AtelierServerStopReason } from '../types/atelier';
import { atelier } from './atelier';

/** The pack folder the server serves: the controller page (vite.phone.config.ts builds it there). */
export const PHONE_ROOT = 'app/phone';
/** Four seats, phones that watch, and room for phones that are reconnecting. */
const MAX_CONNECTIONS = 16;

export type Sharing =
  /** Starting the server. */
  | { state: 'starting' }
  /** Phones can join at `url` (on the Wi-Fi when `lan`, else only on this computer, with the reason in `note`). */
  | { state: 'sharing'; url: string; qr: string | null; lan: boolean; note: string | null }
  /** Stopped; S starts it again. */
  | { state: 'stopped'; reason: string }
  /** Phones can't join here at all (the page isn't in Atelier, or Atelier refused). */
  | { state: 'unavailable'; reason: string };

export interface TvNetHandlers {
  sharing(sharing: Sharing): void;
  phoneJoin(id: number, name: string, token: string): void;
  phoneLeave(id: number): void;
  message(id: number, raw: unknown): void;
}

const STOPPED: Record<AtelierServerStopReason, string> = {
  stopped: 'Sharing stopped.',
  person: 'Sharing stopped from Atelier’s bar.',
  idle: 'Sharing paused after a quiet while.',
  closed: 'Sharing stopped.',
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class TvNet {
  sharing: Sharing = { state: 'starting' };
  private readonly sockets = new Map<number, AtelierServerSocket>();
  private nextId = 1;
  private bridge: AtelierBridge | null = null;
  private starting: Promise<void> | null = null;
  private warned = false;

  constructor(private readonly on: TvNetHandlers) {}

  /** How many phones are connected right now. */
  get phones(): number {
    return this.sockets.size;
  }

  /** Starts sharing on the Wi-Fi (or, when that can't be, on this computer). Safe to call again. */
  start(): Promise<void> {
    this.starting ??= this.open().finally(() => (this.starting = null));
    return this.starting;
  }

  private async open(): Promise<void> {
    if (!this.bridge) {
      const bridge = atelier();
      if (!bridge) return this.set({ state: 'unavailable', reason: 'Open Highgames in Atelier to play with phones.' });
      this.bridge = bridge;
      bridge.server.onConnection((socket) => this.accept(socket));
      bridge.server.onStop((reason) => this.stopped(reason));
    }
    const server = this.bridge.server;
    this.set({ state: 'starting' });
    try {
      let note: string | null = null;
      let status;
      try {
        status = await server.start({ lan: true, root: PHONE_ROOT, maxConnections: MAX_CONNECTIONS });
      } catch (err) {
        // No Wi-Fi, a playtest or an organisation that keeps servers on this computer: a browser here can still join.
        note = message(err);
        status = await server.start({ root: PHONE_ROOT, maxConnections: MAX_CONNECTIONS });
      }
      const url = status.lanUrl ?? status.url;
      if (!url) throw new Error('Atelier started the server without an address.');
      this.set({ state: 'sharing', url, qr: status.qr, lan: status.lanUrl !== null, note });
    } catch (err) {
      this.set({ state: 'unavailable', reason: message(err) });
    }
  }

  /** Sends to one phone, or to every connected phone. A message that can't go (too big, gone) is dropped. */
  send(id: number | 'all', msg: TvMsg): void {
    if (!this.bridge || this.sockets.size === 0) return;
    const sent = id === 'all' ? this.bridge.server.broadcast(msg) : this.sockets.get(id)?.send(msg);
    sent?.catch((err: unknown) => {
      if (this.warned) return;
      this.warned = true;
      console.warn('A message to the phones could not be sent:', message(err));
    });
  }

  private accept(socket: AtelierServerSocket): void {
    const id = this.nextId++;
    const join = parseJoin(socket.query, `Player ${id}`);
    if (!join) {
      // Not our controller page (or an old one): it can't take part.
      void socket.close(4400).catch(() => undefined);
      return;
    }
    this.sockets.set(id, socket);
    socket.onMessage((value) => this.on.message(id, value));
    socket.onClose(() => {
      if (this.sockets.delete(id)) this.on.phoneLeave(id);
    });
    this.on.phoneJoin(id, join.name, join.token);
  }

  private stopped(reason: AtelierServerStopReason): void {
    // Atelier closes every socket first (their onClose ran); anything left is gone too.
    for (const id of [...this.sockets.keys()]) {
      this.sockets.delete(id);
      this.on.phoneLeave(id);
    }
    if (reason === 'closed') return; // the page is going away
    this.set({ state: 'stopped', reason: STOPPED[reason] });
  }

  private set(sharing: Sharing): void {
    this.sharing = sharing;
    this.on.sharing(sharing);
  }
}
