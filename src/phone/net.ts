// The phone's link to the big screen: one socket through Atelier's web server for the game (atelierServer, from
// __atelier/client.js). It reconnects by itself, and the phone's token gives it back the same seat.
import { type PhoneMsg, type TvMsg, parseTvMsg } from '../shared/protocol';
import type { AtelierServerLink } from '../types/atelier';

export type NetStatus = 'connecting' | 'online' | 'offline' | 'waiting-tv';

export interface PhoneNetHandlers {
  tv(msg: TvMsg): void;
  status(status: NetStatus, detail?: string): void;
}

/** Closed with "going away": the big screen reloaded, closed, or stopped sharing. */
const GOING_AWAY = 1001;
/** After this long without the big screen, the phone suggests scanning its code again. */
const LOST_MS = 45_000;

export class PhoneNet {
  private link: AtelierServerLink | null = null;
  private lostSince = 0;

  constructor(private readonly on: PhoneNetHandlers) {}

  start(name: string, token: string): void {
    const client = window.atelierServer;
    if (!client) {
      this.on.status('offline', 'Open this page from the code on the big screen.');
      return;
    }
    this.link?.close();
    this.on.status('connecting');
    const link = client.connect({ query: { name, token } });
    this.link = link;
    link.onOpen(() => {
      this.lostSince = 0;
      this.on.status('online');
    });
    link.onMessage((value) => {
      const msg = parseTvMsg(value);
      if (msg) this.on.tv(msg);
    });
    link.onClose((code) => {
      this.lostSince ||= Date.now();
      if (Date.now() - this.lostSince > LOST_MS) {
        this.on.status('waiting-tv', 'Can’t find the big screen. If it stopped sharing, scan its code again.');
      } else if (code === GOING_AWAY) {
        this.on.status('waiting-tv', 'The big screen closed. Waiting for it to come back…');
      } else {
        this.on.status('offline');
      }
    });
  }

  /** Input goes only while connected: a tap from before a reconnect would arrive too late to mean anything. */
  send(msg: PhoneMsg): void {
    if (this.link?.state === 'open') this.link.send(msg);
  }
}
