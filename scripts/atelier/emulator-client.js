/* __atelier/client.js in the Atelier emulator: the helper Atelier's web server hands the pages it serves
 * (atelier/src/main/packs/serverClient.ts). The same API: atelierServer.base and atelierServer.connect({ query })
 * with state, send, onOpen, onMessage, onClose and close, reconnecting by itself. */
(() => {
  'use strict';
  const script = document.currentScript;
  const base = new URL('../', script && script.src ? script.src : location.href);

  const decode = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  class Link {
    constructor(options = {}) {
      this.state = 'connecting';
      this.query = options.query || {};
      this.handlers = { open: [], message: [], close: [] };
      this.queue = [];
      this.tries = 0;
      this.closed = false;
      this.socket = null;
      this.timer = 0;
      const nudge = () => {
        if (!this.closed && this.state === 'closed') this.open();
      };
      addEventListener('online', nudge);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') nudge();
      });
      this.open();
    }

    url() {
      const url = new URL('__atelier/socket', base);
      url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      for (const [name, value] of Object.entries(this.query)) url.searchParams.set(name, String(value));
      return url.href;
    }

    emit(kind, a, b) {
      for (const fn of this.handlers[kind]) {
        try {
          fn(a, b);
        } catch (err) {
          setTimeout(() => {
            throw err;
          });
        }
      }
    }

    open() {
      clearTimeout(this.timer);
      this.state = 'connecting';
      let socket;
      try {
        socket = new WebSocket(this.url());
      } catch {
        return this.retry();
      }
      this.socket = socket;
      socket.onopen = () => {
        this.tries = 0;
        this.state = 'open';
        for (const text of this.queue.splice(0)) socket.send(text);
        this.emit('open');
      };
      socket.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : '';
        this.emit('message', decode(text), text);
      };
      socket.onclose = (event) => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.state = 'closed';
        this.emit('close', event.code);
        if (!this.closed) this.retry();
      };
    }

    retry() {
      this.state = 'closed';
      const wait = Math.min(5000, 400 * 2 ** this.tries++);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (!this.closed) this.open();
      }, wait);
    }

    /** Text as it is, anything else as JSON; while it reconnects, the last 50 wait. */
    send(data) {
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      if (this.socket && this.socket.readyState === 1) return this.socket.send(text);
      this.queue.push(text);
      if (this.queue.length > 50) this.queue.shift();
    }

    onOpen(fn) {
      this.handlers.open.push(fn);
      if (this.state === 'open') fn();
    }

    onMessage(fn) {
      this.handlers.message.push(fn);
    }

    onClose(fn) {
      this.handlers.close.push(fn);
    }

    close() {
      this.closed = true;
      clearTimeout(this.timer);
      if (this.socket) this.socket.close(1000);
    }
  }

  window.atelierServer = { base: base.href, connect: (options) => new Link(options) };
})();
