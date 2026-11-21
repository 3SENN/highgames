// Highgames inside Atelier: the big screen's link to the phones over atelier.server (with a stand-in for window.atelier),
// the phone's route to the kit below the server's token, and the person's companions taking empty seats.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kitAddress } from '../src/phone/kit-paths';
import { DEFAULT_LOOK } from '../src/shared/look';
import type { TvMsg } from '../src/shared/protocol';
import { type Sharing, PHONE_ROOT, TvNet } from '../src/tv/net';
import { Session } from '../src/tv/session';
import type { AtelierBridge, AtelierServerSocket, AtelierServerStartOptions, AtelierServerStatus, AtelierServerStopReason } from '../src/types/atelier';

const TOKEN = 'phone-token-123';

/** A stand-in for window.atelier: records what the game asks of atelier.server and lets the test play Atelier's part. */
function fakeAtelier(opts: { lanFails?: string } = {}) {
  const started: AtelierServerStartOptions[] = [];
  const broadcasts: unknown[] = [];
  let onConnection: (s: AtelierServerSocket) => void = () => {};
  let onStop: (r: AtelierServerStopReason) => void = () => {};
  const bridge = {
    server: {
      async start(o: AtelierServerStartOptions = {}): Promise<AtelierServerStatus> {
        started.push(o);
        if (o.lan && opts.lanFails) throw new Error(opts.lanFails);
        const lan = o.lan === true;
        return {
          running: true,
          url: lan ? 'https://localhost:42001/tok/' : 'http://127.0.0.1:42001/tok/',
          lanUrl: lan ? 'https://192.168.1.20:42001/tok/' : null,
          port: 42001,
          qr: lan ? 'data:image/png;base64,AAAA' : null,
          lan,
          token: true,
          connections: 0,
        };
      },
      onConnection: (fn: (s: AtelierServerSocket) => void) => {
        onConnection = fn;
        return () => undefined;
      },
      onStop: (fn: (r: AtelierServerStopReason) => void) => {
        onStop = fn;
        return () => undefined;
      },
      broadcast: async (data: unknown) => {
        broadcasts.push(data);
        return 1;
      },
    },
  } as unknown as AtelierBridge;

  /** A served page opening its socket, as Atelier reports it. */
  const connect = (query: Record<string, string>) => {
    let message: (value: unknown, text: string) => void = () => {};
    let close: (code: number) => void = () => {};
    const socket = {
      id: `s${Math.random().toString(16).slice(2, 14)}`,
      query,
      remote: 'lan' as const,
      sent: [] as unknown[],
      closedWith: null as number | null,
      send: vi.fn(async function (this: void, data: unknown) {
        socket.sent.push(data);
      }),
      close: vi.fn(async (code?: number) => {
        socket.closedWith = code ?? 1000;
      }),
      onMessage: (fn: typeof message) => {
        message = fn;
        return () => undefined;
      },
      onClose: (fn: typeof close) => {
        close = fn;
        return () => undefined;
      },
    };
    onConnection(socket);
    return { socket, say: (value: unknown) => message(value, JSON.stringify(value)), hangUp: (code = 1000) => close(code) };
  };

  return { bridge, started, broadcasts, connect, stop: (r: AtelierServerStopReason) => onStop(r) };
}

function tvNet() {
  const events: string[] = [];
  const sharing: Sharing[] = [];
  const net = new TvNet({
    sharing: (s) => sharing.push(s),
    phoneJoin: (id, name, token) => events.push(`join ${id} ${name} ${token}`),
    phoneLeave: (id) => events.push(`leave ${id}`),
    message: (id, raw) => events.push(`msg ${id} ${JSON.stringify(raw)}`),
  });
  return { net, events, sharing };
}

const withAtelier = (bridge: AtelierBridge | undefined) => {
  (globalThis as { window?: unknown }).window = { atelier: bridge };
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('the big screen over atelier.server', () => {
  it('shares the controller page on the Wi-Fi, with Atelier’s QR code', async () => {
    const atelier = fakeAtelier();
    withAtelier(atelier.bridge);
    const { net, sharing } = tvNet();
    await net.start();
    expect(atelier.started).toEqual([{ lan: true, root: PHONE_ROOT, maxConnections: 16 }]);
    expect(sharing.at(-1)).toEqual({ state: 'sharing', url: 'https://192.168.1.20:42001/tok/', qr: 'data:image/png;base64,AAAA', lan: true, note: null });
  });

  it('falls back to this computer when Atelier can’t share on the Wi-Fi, and says why', async () => {
    const atelier = fakeAtelier({ lanFails: 'In test_pack, a server runs on this computer only.' });
    withAtelier(atelier.bridge);
    const { net } = tvNet();
    await net.start();
    expect(atelier.started.map((o) => o.lan ?? false)).toEqual([true, false]);
    expect(net.sharing).toMatchObject({ state: 'sharing', url: 'http://127.0.0.1:42001/tok/', qr: null, lan: false, note: 'In test_pack, a server runs on this computer only.' });
  });

  it('says phones can’t join on a page Atelier doesn’t host', async () => {
    withAtelier(undefined);
    const { net } = tvNet();
    await net.start();
    expect(net.sharing.state).toBe('unavailable');
  });

  it('turns sockets into numbered phones, and their messages and goodbyes into the session’s', async () => {
    const atelier = fakeAtelier();
    withAtelier(atelier.bridge);
    const { net, events } = tvNet();
    await net.start();
    const sam = atelier.connect({ name: ' Sam ', token: TOKEN });
    const kim = atelier.connect({ name: 'Kim', token: 'other-token-456' });
    sam.say({ t: 'tap' });
    sam.hangUp();
    sam.hangUp(); // Atelier says it once; a second goodbye changes nothing
    expect(events).toEqual([`join 1 Sam ${TOKEN}`, 'join 2 Kim other-token-456', 'msg 1 {"t":"tap"}', 'leave 1']);
    expect(net.phones).toBe(1);
    expect(kim.socket.closedWith).toBeNull();
  });

  it('closes a socket that isn’t one of our controller pages', async () => {
    const atelier = fakeAtelier();
    withAtelier(atelier.bridge);
    const { net, events } = tvNet();
    await net.start();
    const stranger = atelier.connect({ name: 'x' });
    expect(stranger.socket.closedWith).toBe(4400);
    expect(events).toEqual([]);
  });

  it('sends to one phone, or broadcasts to all of them', async () => {
    const atelier = fakeAtelier();
    withAtelier(atelier.bridge);
    const { net } = tvNet();
    await net.start();
    const msg: TvMsg = { t: 'ping', n: 1 };
    net.send('all', msg); // nobody is connected yet: nothing goes
    expect(atelier.broadcasts).toEqual([]);
    const sam = atelier.connect({ name: 'Sam', token: TOKEN });
    net.send(1, msg);
    net.send(2, msg); // no such phone
    net.send('all', { t: 'meter', value: 0.5, danger: false });
    expect(sam.socket.sent).toEqual([msg]);
    expect(atelier.broadcasts).toEqual([{ t: 'meter', value: 0.5, danger: false }]);
  });

  it('lets every phone go when sharing stops, and offers to share again unless the page is leaving', async () => {
    const atelier = fakeAtelier();
    withAtelier(atelier.bridge);
    const { net, events } = tvNet();
    await net.start();
    atelier.connect({ name: 'Sam', token: TOKEN });
    atelier.stop('person');
    expect(events.at(-1)).toBe('leave 1');
    expect(net.sharing).toEqual({ state: 'stopped', reason: 'Sharing stopped from Atelier’s bar.' });
    await net.start();
    expect(net.sharing.state).toBe('sharing');
    atelier.stop('closed');
    expect(net.sharing.state).toBe('sharing');
  });
});

describe('the phone’s route to the kit', () => {
  const base = 'https://192.168.1.20:42001/AbCdEfGhIjKlMnOpQrStUv/';
  const page = `${base}index.html`;

  it('sends the kit runtime’s root addresses below the server’s token', () => {
    expect(kitAddress('/__atelier/kit/1/companion/manifest.json', base, page)).toBe(`${base}__atelier/kit/1/companion/manifest.json`);
    expect(kitAddress('https://192.168.1.20:42001/__atelier/kit/1/companion/face/a.svg?v=2', base, page)).toBe(`${base}__atelier/kit/1/companion/face/a.svg?v=2`);
  });

  it('leaves every other address alone', () => {
    for (const url of [`${base}__atelier/kit/1/companion/x.glb`, './assets/index.js', 'https://elsewhere.example/__atelier/x', 'data:image/png;base64,AA', 'blob:https://192.168.1.20:42001/1234']) {
      expect(kitAddress(url, base, page)).toBe(url);
    }
    expect(kitAddress('/__atelier/kit/1/x', 'https://192.168.1.20:42001/', page)).toBe('/__atelier/kit/1/x');
  });
});

describe('the person’s companions in empty seats', () => {
  it('seat the cast first, then presets, skipping names already taken', () => {
    vi.useFakeTimers();
    try {
      const net = { send: vi.fn() } as unknown as TvNet;
      const session = new Session(net);
      session.onPhoneJoin(1, 'Pip', TOKEN);
      const cast = [
        { name: 'pip', look: DEFAULT_LOOK },
        { name: 'Mochi', look: DEFAULT_LOOK },
      ];
      const presets = [{ id: 'bolt', name: 'Bolt', look: DEFAULT_LOOK }, { id: 'mochi', name: 'Mochi', look: DEFAULT_LOOK }] as never;
      session.fillWithCpus(presets, cast);
      expect(session.seats.map((s) => s.name)).toEqual(['Pip', 'Mochi', 'Bolt', 'Player 4']);
      expect(session.seats.slice(1).every((s) => s.token === null && s.ready)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
