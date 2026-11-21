#!/usr/bin/env node
// A small stand-in for Atelier, to develop and test Highgames in any browser. It serves the built pack (pack/) the way
// Atelier serves an app (docs/apps.md and docs/packs.md in atelier), so what works here works in Atelier:
//   - the app's files with Atelier's app CSP (inline scripts allowed by hash), and root addresses mapped into the app;
//   - kit 1 at /__atelier/kit/1/ and its import map added to the entry page (kit.mjs finds the kit);
//   - window.atelier on the entry page (emulator-bridge.js): atelier.server, status, test.ready, cast and log;
//   - atelier.server's web server for phones: https on the Wi-Fi (or http on this computer), every address under an
//     unguessable token, __atelier/client.js, __atelier/socket and the kit, with Atelier's limits on peers, sizes and rates.
// It is not Atelier: there is no sandbox, review or partition. Load pack/ in Atelier (Packs › Load a folder…) for that.
//
//   node scripts/atelier/emulator.mjs [--pack pack] [--port 8443] [--phone-port 8444] [--watch] [--cast 1] [--atelier-server]
//
// --atelier-server (or ATELIER_SERVER=1) serves phones with Atelier's own server code instead of this stand-in: its LocalServer
// and its __atelier/client.js, from the atelier repository next to this one (atelier.mjs).
//
// Extra addresses for tests: GET /__atelier/emulator/state (the latest atelier.status and atelier.test.ready), and
// POST /__atelier/emulator/stop (as if the person pressed Stop on Atelier's bar).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import selfsigned from 'selfsigned';
import { WebSocketServer } from 'ws';
import { loadFromAtelier } from './atelier.mjs';
import { ROOT, checkKit, findKit, kitAddons, kitVersion } from './kit.mjs';

/** atelier.server's limits (atelier/src/shared/localServer.ts › SERVER_LIMITS). */
export const LIMITS = { connections: 32, defaultConnections: 16, inBytes: 16 * 1024, outBytes: 64 * 1024, messagesPerSecond: 120, messageBurst: 240 };

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  glb: 'model/gltf-binary',
  wasm: 'application/wasm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};
const typeOf = (path) => TYPES[/\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/** Atelier's CSP for an app page (atelier/src/main/packs/sandbox.ts › appCsp), without network hosts. */
function appCsp(hashes) {
  return [
    "default-src 'none'",
    `script-src 'self' 'wasm-unsafe-eval'${hashes.map((h) => ` 'sha256-${h}'`).join('')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "child-src 'self' blob:",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** Each inline script's hash, as Atelier allows them (sandbox.ts › inlineScriptHashes). */
function inlineScriptHashes(html) {
  const out = new Set();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\ssrc\s*=/i.test(m[1] ?? '') || !m[2]?.trim()) continue;
    out.add(createHash('sha256').update(m[2], 'utf8').digest('base64'));
  }
  return [...out];
}

const APP_HEADERS = {
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};
/** What every answer of atelier.server gets (localServer.ts › SERVER_FIXED_HEADERS). */
const SERVER_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "frame-ancestors 'self'",
  'cache-control': 'no-store',
};

// ---------------------------------------------------------------- addresses and the certificate

const ipv4 = (address) => {
  const plain = String(address ?? '').replace(/^::ffff:/i, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(plain) ? plain : null;
};
const isLoopback = (address) => ipv4(address)?.startsWith('127.') || address === '::1';
function isPrivate(address) {
  if (isLoopback(address)) return true;
  const v4 = ipv4(address);
  if (v4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const v6 = String(address).toLowerCase().split('%')[0];
  return /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6);
}

/** This computer's private IPv4 addresses, home networks first (localServers.ts › lanAddresses). */
function lanAddresses() {
  const out = new Set();
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && isPrivate(a.address) && !a.address.startsWith('169.254.')) out.add(a.address);
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return [...out].sort((a, b) => rank(a) - rank(b));
}

/** A self-signed certificate for this computer's addresses, made once in .atelier/cert/ (Atelier makes its own). */
function certificate(ips) {
  const dir = join(ROOT, '.atelier', 'cert');
  const files = { key: join(dir, 'key.pem'), cert: join(dir, 'cert.pem'), ips: join(dir, 'addresses.json') };
  try {
    const known = JSON.parse(readFileSync(files.ips, 'utf8'));
    if (ips.every((ip) => known.includes(ip))) return { key: readFileSync(files.key, 'utf8'), cert: readFileSync(files.cert, 'utf8') };
  } catch {
    // None yet.
  }
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))];
  const pems = selfsigned.generate([{ name: 'commonName', value: 'Highgames dev (Atelier emulator)' }], {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(files.key, pems.private, { mode: 0o600 });
  writeFileSync(files.cert, pems.cert);
  writeFileSync(files.ips, JSON.stringify(ips));
  return { key: pems.private, cert: pems.cert };
}

// ---------------------------------------------------------------- files

/** A file under `dir` by its /-separated path, or null (never outside `dir`). */
function fileIn(dir, rel) {
  if (rel.split('/').some((p) => p === '..' || p === '.' || p.includes('\\'))) return null;
  const full = join(dir, ...rel.split('/'));
  try {
    return statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

/** Where an address lands inside the app, as Atelier resolves it (sandbox.ts › resolveAppPath). */
function resolveAppPath(app, path, exists, wantsPage) {
  let at = path === app.root || path.startsWith(`${app.root}/`) ? path : `${app.root}/${path}`;
  if (at === app.root || at.endsWith('/')) at = `${at.replace(/\/+$/, '')}/index.html`;
  if (exists(at)) return at;
  if (!/\.[A-Za-z0-9]{1,12}$/.test(at.split('/').pop() ?? '')) {
    for (const candidate of [`${at}.html`, `${at}/index.html`]) if (exists(candidate)) return candidate;
    if (wantsPage) return `${app.root}/${app.entry}`;
  }
  return at;
}

/** The kit's import map with the bridge before it, first in the head (sandbox.ts › withImportMap). */
function withAtelier(html, importMap) {
  const tag = `<script src="/__atelier/emulator.js"></script><script type="importmap">${importMap}</script>`;
  const head = /<head\b[^>]*>/i.exec(html);
  return head ? html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length) : tag + html;
}

function plain(res, status, text, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(text);
}

// ---------------------------------------------------------------- one app page's web server (atelier.server)

/** This emulator's own atelier.server: the same paths, checks and limits as Atelier's. */
class PhoneServer {
  constructor({ page, kit, packDir, root, lan, maxConnections, token, port }) {
    Object.assign(this, { page, kit, packDir, root, lan, maxConnections, token, preferredPort: port });
    this.sockets = new Map();
    this.queue = [];
    this.timer = null;
    this.port = 0;
    this.ips = lan ? lanAddresses() : [];
  }

  async start() {
    if (this.lan && this.ips.length === 0) throw new Error('This computer isn’t on a Wi-Fi or local network, so phones can’t reach it. Try again once it is, or start the server without lan.');
    const handle = (req, res) => this.handle(req, res);
    this.server = this.lan ? https.createServer(certificate(this.ips), handle) : http.createServer(handle);
    this.wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.inBytes, perMessageDeflate: false });
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    this.server.on('clientError', (_err, socket) => socket.destroy());
    const host = this.lan ? '0.0.0.0' : '127.0.0.1';
    for (const port of [...Array.from({ length: 11 }, (_, i) => this.preferredPort + i), 0]) {
      try {
        this.port = await new Promise((ok, fail) => {
          this.server.once('error', fail);
          this.server.listen(port, host, () => {
            this.server.off('error', fail);
            ok(this.server.address().port);
          });
        });
        break;
      } catch (err) {
        if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
      }
    }
    return this.status();
  }

  status() {
    const path = this.token ? `/${this.token}/` : '/';
    const lanUrl = this.lan && this.ips[0] ? `https://${this.ips[0]}:${this.port}${path}` : null;
    return {
      running: true,
      url: this.lan ? `https://localhost:${this.port}${path}` : `http://127.0.0.1:${this.port}${path}`,
      lanUrl,
      port: this.port,
      qr: null,
      lan: this.lan,
      token: Boolean(this.token),
      connections: this.connections,
    };
  }

  get connections() {
    return this.sockets.size;
  }

  closeSocket(id, code) {
    this.sockets.get(id)?.close(code);
  }

  /** The file a path below the base asks for in the served folder (localServer.ts › staticFile). */
  served(rel) {
    return this.root ? fileIn(join(this.packDir, this.root), rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel) : null;
  }

  async statusWithQr() {
    const status = this.status();
    if (status.lanUrl) status.qr = await QRCode.toDataURL(status.lanUrl, { margin: 1, width: 336, errorCorrectionLevel: 'M' });
    return status;
  }

  /** The path below the server's base (localServer.ts › serverPath). */
  path(pathname) {
    let rest = pathname.slice(1);
    if (this.token) {
      if (rest === this.token) return { redirect: `/${this.token}/` };
      if (!rest.startsWith(`${this.token}/`)) return null;
      rest = rest.slice(this.token.length + 1);
    }
    try {
      rest = decodeURIComponent(rest);
    } catch {
      return null;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f\\]/.test(rest) || rest.split('/').some((p) => p === '..' || p === '.')) return null;
    return { rel: rest };
  }

  peerOk(address) {
    return this.lan ? isPrivate(address) : isLoopback(address);
  }

  handle(req, res) {
    if (!this.peerOk(req.socket.remoteAddress)) return void req.socket.destroy();
    const url = new URL(req.url ?? '/', 'http://server');
    const at = this.path(url.pathname);
    if (!at) return plain(res, 404, 'Not found.', SERVER_HEADERS);
    if (at.redirect) return plain(res, 308, '', { ...SERVER_HEADERS, location: `${at.redirect}${url.search}` });
    const { rel } = at;
    if (rel === '__atelier/client.js') return this.send(res, 'client.js', readFileSync(join(ROOT, 'scripts', 'atelier', 'emulator-client.js')));
    if (rel === '__atelier/socket') return plain(res, 426, 'Open a WebSocket here.', SERVER_HEADERS);
    if (rel.startsWith(`__atelier/kit/1/`)) {
      const file = fileIn(this.kit, rel.slice('__atelier/kit/1/'.length));
      return file ? this.send(res, file, readFileSync(file)) : plain(res, 404, 'Not found.', SERVER_HEADERS);
    }
    const file = rel.startsWith('__atelier/') ? null : this.served(rel);
    if (file && (req.method === 'GET' || req.method === 'HEAD')) return this.send(res, file, readFileSync(file));
    plain(res, 404, 'Not found.', SERVER_HEADERS);
  }

  send(res, name, body) {
    res.writeHead(200, { ...SERVER_HEADERS, 'content-type': typeOf(name), 'content-length': String(body.length) });
    res.end(body);
  }

  upgrade(req, socket, head) {
    const refuse = (status, text) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!this.peerOk(socket.remoteAddress)) return void socket.destroy();
    // Another site's page can't open the app's socket (localServer.ts › originAllowed).
    const origin = req.headers.origin;
    if (origin !== undefined && new URL(origin).host.toLowerCase() !== String(req.headers.host ?? '').toLowerCase()) return refuse(403, 'Forbidden');
    const url = new URL(req.url ?? '/', 'http://server');
    const at = this.path(url.pathname);
    if (!at || at.redirect || at.rel !== '__atelier/socket') return refuse(404, 'Not Found');
    if (this.sockets.size >= this.maxConnections) return refuse(503, 'Service Unavailable');
    const query = {};
    for (const [k, v] of url.searchParams) if (!(k in query) && Object.keys(query).length < 20) query[k] = v.slice(0, 500);
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, query, socket.remoteAddress));
  }

  accept(ws, query, address) {
    const id = `s${randomBytes(6).toString('hex')}`;
    // A token bucket: Atelier drops a burst and closes a socket that keeps flooding.
    const bucket = { tokens: LIMITS.messageBurst, at: Date.now(), dropped: 0 };
    this.sockets.set(id, ws);
    this.push({ type: 'connection', id, query, remote: isLoopback(address) ? 'local' : 'lan' }, true);
    ws.on('message', (data, binary) => {
      if (binary) return void ws.close(1003, 'Text messages only.');
      const now = Date.now();
      bucket.tokens = Math.min(LIMITS.messageBurst, bucket.tokens + ((now - bucket.at) / 1000) * LIMITS.messagesPerSecond);
      bucket.at = now;
      if (bucket.tokens < 1) {
        if (++bucket.dropped > LIMITS.messageBurst * 4) ws.close(1008, 'Too many messages.');
        return;
      }
      bucket.tokens -= 1;
      bucket.dropped = 0;
      this.push({ type: 'message', id, data: String(data) }, false);
    });
    ws.on('error', () => undefined);
    ws.on('close', (code) => {
      if (this.sockets.delete(id)) this.push({ type: 'close', id, code }, true);
    });
  }

  /** Events reach the page in batches, in order: sockets at once, messages within 8 ms (localServers.ts). */
  push(event, urgent) {
    this.queue.push(event);
    if (urgent) return this.flush();
    this.timer ??= setTimeout(() => this.flush(), 8);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.queue.length && this.page.readyState === 1) this.page.send(JSON.stringify({ event: 'server', events: this.queue.splice(0) }));
    else this.queue.length = 0;
  }

  /** Sends text to sockets ('*' for all); how many it reached. */
  deliver(ids, text) {
    if (Buffer.byteLength(text) > LIMITS.outBytes) throw new Error(`A message is at most ${LIMITS.outBytes / 1024} KB.`);
    let sent = 0;
    for (const id of ids === '*' ? [...this.sockets.keys()] : ids) {
      const ws = this.sockets.get(id);
      if (ws?.readyState === 1 && ws.bufferedAmount <= 1024 * 1024) {
        ws.send(text);
        sent++;
      }
    }
    return sent;
  }

  async stop(reason) {
    const open = [...this.sockets.values()];
    this.sockets.clear();
    for (const ws of open) ws.close(1001, 'The app stopped its server.');
    if (reason) this.push({ type: 'stopped', reason }, true);
    const closed = new Promise((ok) => this.server.close(() => ok()));
    this.server.closeAllConnections?.();
    // A socket that doesn't finish closing is cut, as Atelier does.
    setTimeout(() => open.forEach((ws) => ws.terminate()), 500).unref();
    await Promise.race([closed, new Promise((ok) => setTimeout(ok, 1000).unref())]);
  }
}

/** atelier.server on Atelier's own LocalServer (atelier/src/main/packs/localServer.ts), with its client.js. */
class AtelierPhoneServer extends PhoneServer {
  constructor(options, LocalServer) {
    super(options);
    this.LocalServer = LocalServer;
  }

  async start() {
    if (this.lan && this.ips.length === 0) throw new Error('This computer isn’t on a Wi-Fi or local network, so phones can’t reach it. Try again once it is, or start the server without lan.');
    this.real = new this.LocalServer({
      lan: this.lan,
      token: this.token,
      port: this.preferredPort,
      maxConnections: this.maxConnections,
      tls: this.lan ? certificate(this.ips) : null,
      file: (rel) => {
        const file = this.served(rel);
        return file ? { path: file } : null;
      },
      // Atelier's kit folder holds every major: <major>/<path>.
      kitFile: (rel) => (rel.startsWith('1/') ? fileIn(this.kit, rel.slice(2)) : null),
      hostNames: () => ['127.0.0.1', 'localhost', '[::1]', ...this.ips],
      hooks: {
        request: async () => ({ status: 404, body: 'Not found.' }),
        connection: (id, info) => this.push({ type: 'connection', id, query: info.query, remote: info.remote }, true),
        message: (id, data) => this.push({ type: 'message', id, data }, false),
        close: (id, code) => this.push({ type: 'close', id, code }, true),
      },
    });
    this.port = await this.real.start();
    return this.status();
  }

  get connections() {
    return this.real?.connections ?? 0;
  }

  closeSocket(id, code) {
    this.real?.closeSocket(id, code);
  }

  deliver(ids, text) {
    if (Buffer.byteLength(text) > LIMITS.outBytes) throw new Error(`A message is at most ${LIMITS.outBytes / 1024} KB.`);
    let sent = 0;
    for (const id of ids === '*' ? this.real.socketIds() : ids) if (this.real.send(id, text)) sent++;
    return sent;
  }

  async stop(reason) {
    if (reason) this.push({ type: 'stopped', reason }, true);
    await this.real?.stop();
  }
}

// ---------------------------------------------------------------- the emulator

export async function startEmulator(options = {}) {
  const packDir = resolve(ROOT, options.pack ?? 'pack');
  const manifestFile = join(packDir, 'atelier-pack.json');
  if (!existsSync(manifestFile)) throw new Error(`No pack at ${packDir}: run npm run build first.`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const app = { root: 'app', entry: 'index.html', ...manifest.contributes?.apps?.[0] };
  const kit = findKit();
  const problems = checkKit(kit, kitAddons());
  if (problems.length) throw new Error(`The Atelier kit at ${kit} doesn't fit this game: ${problems.join('; ')}.`);
  const importMap = readFileSync(join(kit, 'importmap.json'), 'utf8').trim();
  // Atelier's own server code for the phones, when asked for.
  let LocalServer = null;
  if (options.atelierServer) {
    const loaded = await loadFromAtelier('local-server', "export { LocalServer } from '{atelier}/src/main/packs/localServer.ts';");
    if (!loaded) throw new Error('--atelier-server needs the atelier repository next to this one (or ATELIER_DIR).');
    LocalServer = loaded.module.LocalServer;
  }
  const serverAllowed = manifest.permissions?.server;
  const port = options.port ?? 8443;
  const phonePort = options.phonePort ?? port + 1;
  // Kept per app while Atelier runs, so phones reconnect after the app reloads; the person's Stop throws it away.
  let token = randomBytes(16).toString('base64url');
  const quiet = options.quiet === true;
  const log = (...args) => quiet || console.info(...args);
  // What the app told Atelier: its status line, its latest playtest state, and every screen it reported.
  const state = { status: null, test: null, screens: [], logs: [] };

  // The cast: Atelier's preset companions stand in for the person's own (the first is "their active companion").
  const companion = JSON.parse(readFileSync(join(kit, 'companion', 'manifest.json'), 'utf8'));
  const presetsRaw = JSON.parse(readFileSync(join(kit, 'companion', companion.config.presets), 'utf8'));
  const presets = (Array.isArray(presetsRaw) ? presetsRaw : presetsRaw.presets ?? []).filter((p) => p?.look);
  const castCount = Math.max(0, Math.min(options.cast ?? 1, app.cast?.max ?? 0));
  const member = (p) => ({ ref: createHash('sha256').update(`emulator:${p.id ?? p.name}`).digest('hex').slice(0, 16), name: p.name, rig: p.look.rig, look: p.look });
  let cast = presets.slice(0, castCount).map(member);

  const bridge = () =>
    `window.__ATELIER_EMULATOR__ = ${JSON.stringify({ pack: { id: manifest.id, name: manifest.name, version: manifest.version } })};\n` +
    readFileSync(join(ROOT, 'scripts', 'atelier', 'emulator-bridge.js'), 'utf8');

  const exists = (rel) => fileIn(packDir, rel) !== null;
  const tv = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path;
    try {
      path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return plain(res, 400, 'Bad request.');
    }
    if (path === '__atelier/emulator.js') return void res.writeHead(200, { ...APP_HEADERS, 'content-type': TYPES.js }).end(bridge());
    if (path === '__atelier/emulator/state') return void res.writeHead(200, { 'content-type': TYPES.json, 'cache-control': 'no-store' }).end(JSON.stringify(state));
    if (path === '__atelier/emulator/stop' && req.method === 'POST') {
      token = randomBytes(16).toString('base64url');
      for (const s of pages.values()) if (s.server) void s.server.stop('person').then(() => (s.server = null));
      return plain(res, 200, 'Stopped.');
    }
    if (path.startsWith('__atelier/kit/1/')) {
      const file = fileIn(kit, path.slice('__atelier/kit/1/'.length));
      return file ? void res.writeHead(200, { ...APP_HEADERS, 'content-type': typeOf(file) }).end(readFileSync(file)) : plain(res, 404, 'Not found');
    }
    if (path.startsWith('__atelier/')) return plain(res, 404, 'Not found');
    const at = resolveAppPath(app, path, exists, /text\/html/i.test(String(req.headers.accept ?? '')));
    const file = fileIn(packDir, at);
    if (!file) return plain(res, 404, 'Not found');
    if (/\.html?$/i.test(file)) {
      const html = withAtelier(readFileSync(file, 'utf8'), importMap);
      return void res.writeHead(200, { ...APP_HEADERS, 'content-type': TYPES.html, 'content-security-policy': appCsp(inlineScriptHashes(html)) }).end(html);
    }
    res.writeHead(200, { ...APP_HEADERS, 'content-type': typeOf(file), 'content-security-policy': appCsp([]) }).end(readFileSync(file));
  });

  // Each app page's bridge: its calls, and its server's events back.
  const pages = new Map();
  const control = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  tv.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/__atelier/emulator' || !isLoopback(socket.remoteAddress)) return void socket.destroy();
    control.handleUpgrade(req, socket, head, (ws) => {
      const page = { ws, server: null };
      pages.set(ws, page);
      ws.on('message', (raw) => void answer(page, String(raw)));
      ws.on('close', () => {
        pages.delete(ws);
        if (page.server) void page.server.stop(null);
      });
    });
  });

  let phonePortNext = phonePort;
  const ops = {
    async 'server.start'(page, [o = {}]) {
      if (!serverAllowed) throw new Error('This pack has no server permission: add "server": {} to permissions (with "lan": true to share on the Wi-Fi).');
      if (o.lan && !serverAllowed.lan) throw new Error('This pack may only serve this computer: add "lan": true to permissions.server to share on the Wi-Fi.');
      const root = o.root ?? null;
      if (root !== null && !statSafe(join(packDir, root))?.isDirectory()) throw new Error(`There is no folder ${root} in the pack.`);
      const wanted = { lan: o.lan === true, root, token: o.token !== false, maxConnections: Math.min(o.maxConnections ?? LIMITS.defaultConnections, LIMITS.connections) };
      if (page.server && JSON.stringify(page.server.options) === JSON.stringify(wanted)) return page.server.statusWithQr();
      if (page.server) await page.server.stop(null);
      const opts = { page: page.ws, kit, packDir, root, lan: wanted.lan, maxConnections: wanted.maxConnections, token: wanted.token ? token : null, port: phonePortNext };
      const server = LocalServer ? new AtelierPhoneServer(opts, LocalServer) : new PhoneServer(opts);
      server.options = wanted;
      const status = await server.start();
      phonePortNext = status.port;
      page.server = server;
      log(`  Phones join at ${status.lanUrl ?? status.url}`);
      return server.statusWithQr();
    },
    async 'server.stop'(page) {
      if (page.server) await page.server.stop('stopped');
      page.server = null;
    },
    'server.status': (page) => page.server?.statusWithQr() ?? { running: false, url: null, lanUrl: null, port: null, qr: null, lan: false, token: false, connections: 0 },
    'server.send'(page, [ids, text]) {
      if (!page.server) throw new Error('The server is not running: call atelier.server.start() first.');
      return page.server.deliver(ids, text);
    },
    'server.close'(page, [id, code = 1000]) {
      page.server?.closeSocket(id, code);
    },
    'status.set'(_page, [status]) {
      const text = status?.text ?? null;
      if (text !== null && text.length > 40) throw new Error('A status is at most 40 characters.');
      if (text !== state.status) log(`  Status: ${text ?? '(none)'}`);
      state.status = text;
    },
    'test.ready'(_page, [value]) {
      state.test = value;
      const screen = value && typeof value === 'object' ? value.screen : undefined;
      if (typeof screen === 'string' && state.screens.at(-1) !== screen) state.screens.push(screen);
    },
    'cast.members': () => cast,
    'cast.pick'(_page, [o = {}]) {
      cast = presets.slice(0, Math.min(o.max ?? app.cast?.max ?? 1, app.cast?.max ?? 1)).map(member);
      return cast;
    },
    log(_page, [text]) {
      state.logs = [...state.logs.slice(-99), String(text)];
      log(`  [app] ${text}`);
    },
  };
  const statSafe = (p) => {
    try {
      return statSync(p);
    } catch {
      return null;
    }
  };
  async function answer(page, raw) {
    let call;
    try {
      call = JSON.parse(raw);
    } catch {
      return;
    }
    const reply = (body) => page.ws.readyState === 1 && page.ws.send(JSON.stringify({ id: call.id, ...body }));
    const op = ops[call.op];
    if (!op) return reply({ ok: false, error: `The emulator doesn't do ${call.op}.` });
    try {
      reply({ ok: true, value: (await op(page, call.args ?? [])) ?? null });
    } catch (err) {
      reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Like Atelier's developer mode: a change in the pack reloads its open pages (once a build settles).
  let watcher = null;
  if (options.watch) {
    let timer = null;
    watcher = watch(packDir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const { ws } of pages.values()) ws.send(JSON.stringify({ event: 'reload' }));
      }, 300);
    });
  }

  await new Promise((ok, fail) => {
    tv.once('error', fail);
    tv.listen(port, '127.0.0.1', ok);
  });
  const url = `http://127.0.0.1:${port}/`;
  log(`\n  Highgames in the Atelier emulator (kit 1, ${kitVersion(kit)}${LocalServer ? ', phones on Atelier’s own LocalServer' : ''}).\n\n  Big screen:  ${url}\n`);
  return {
    url,
    state: () => state,
    async close() {
      watcher?.close();
      for (const page of pages.values()) {
        if (page.server) await page.server.stop(null);
        page.ws.terminate();
      }
      await new Promise((ok) => tv.close(() => ok()));
    },
  };
}

// ---------------------------------------------------------------- the command

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const emulator = await startEmulator({
    pack: flag('--pack', 'pack'),
    port: Number(flag('--port', process.env.PORT ?? 8443)),
    phonePort: Number(flag('--phone-port', process.env.PHONE_PORT ?? 0)) || undefined,
    watch: args.includes('--watch'),
    cast: Number(flag('--cast', 1)),
    atelierServer: args.includes('--atelier-server') || process.env.ATELIER_SERVER === '1',
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
  const stop = () => void emulator.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
