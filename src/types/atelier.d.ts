// The parts of Atelier this game uses, as Atelier's preload (window.atelier, on the big screen) and its server helper
// (atelierServer, from __atelier/client.js on the phones) expose them. Atelier documents both in docs/apps.md and
// docs/packs.md › A web server of its own; every call is checked in Atelier's main process.

/** What atelier.server.start and status answer. */
export interface AtelierServerStatus {
  running: boolean;
  /** The address on this computer. */
  url: string | null;
  /** The address phones on the same Wi-Fi open (https), or null for a server on this computer only. */
  lanUrl: string | null;
  port: number | null;
  /** A QR code of lanUrl as an image data URL; null without lanUrl. */
  qr: string | null;
  lan: boolean;
  /** Whether the addresses carry the unguessable token. */
  token: boolean;
  connections: number;
}

/** Why a server stopped: our own stop(), the person's Stop on Atelier's bar, nobody using it, or the page going away. */
export type AtelierServerStopReason = 'stopped' | 'person' | 'idle' | 'closed';

/** One served page's socket, as the app's page sees it. */
export interface AtelierServerSocket {
  readonly id: string;
  readonly query: Readonly<Record<string, string>>;
  readonly remote: 'local' | 'lan';
  /** Objects go as JSON (at most 64 KB). */
  send(data: unknown): Promise<unknown>;
  /** 1000, or 4000 to 4999. */
  close(code?: number): Promise<unknown>;
  onMessage(fn: (value: unknown, text: string) => void): () => unknown;
  onClose(fn: (code: number) => void): () => unknown;
}

export interface AtelierServerStartOptions {
  lan?: boolean;
  /** A folder of the pack whose files the server serves. */
  root?: string;
  token?: boolean;
  maxConnections?: number;
}

/** A companion playing in the app: its name and look, never anything else about it. */
export interface AtelierCastMember {
  ref: string;
  name: string;
  rig: string;
  look: unknown;
}

/** window.atelier in an app's page (the subset Highgames uses). */
export interface AtelierBridge {
  readonly pack: Readonly<{ id: string; name: string; version: string }>;
  readonly server: {
    start(options?: AtelierServerStartOptions): Promise<AtelierServerStatus>;
    stop(): Promise<unknown>;
    status(): Promise<AtelierServerStatus>;
    onConnection(fn: (socket: AtelierServerSocket) => void): () => unknown;
    onStop(fn: (reason: AtelierServerStopReason) => void): () => unknown;
    /** Sends to every open socket; how many it reached. */
    broadcast(data: unknown): Promise<number>;
    sockets(): AtelierServerSocket[];
  };
  readonly status: {
    /** Shown on the app's tab and sidebar row. `text` is at most 40 characters. */
    set(status: { text?: string | null; badge?: number | null; progress?: number | null }): Promise<unknown>;
    clear(): Promise<unknown>;
  };
  readonly test: {
    /** The game's state for Atelier's playtests; cheap to call often (sent only when it changes). */
    ready(state: unknown): void;
  };
  readonly cast: {
    /** The companions the person picked for this app, or their active companion. */
    members(): Promise<AtelierCastMember[]>;
    /** Atelier's own character picker over the app. */
    pick(options?: { max?: number; title?: string }): Promise<AtelierCastMember[]>;
  };
  log(...values: unknown[]): Promise<unknown>;
}

/** One socket from a served page to the app (atelierServer.connect); it reconnects by itself. */
export interface AtelierServerLink {
  readonly state: 'connecting' | 'open' | 'closed';
  /** Text as it is, anything else as JSON; while it reconnects, the last 50 wait. */
  send(data: unknown): void;
  onOpen(fn: () => void): void;
  onMessage(fn: (value: unknown, text: string) => void): void;
  onClose(fn: (code: number) => void): void;
  close(): void;
}

/** __atelier/client.js on a page the app's server serves. */
export interface AtelierServerClient {
  /** The server's base address, with its token. */
  readonly base: string;
  connect(options?: { query?: Record<string, string> }): AtelierServerLink;
}

declare global {
  interface Window {
    atelier?: AtelierBridge;
    atelierServer?: AtelierServerClient;
  }
}
