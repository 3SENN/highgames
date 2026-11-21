/* window.atelier for an app page in the Atelier emulator (emulator.mjs serves this before the page's own scripts).
 * The same calls and shapes as Atelier's preload (atelier/src/preload/pack.ts) for what Highgames uses:
 * atelier.server, status, test.ready, cast, storage and log. Each call goes to the emulator over one socket. */
(function () {
  'use strict';
  var info = window.__ATELIER_EMULATOR__ || { pack: { id: 'pack', name: 'Pack', version: '0.0.0' } };
  var socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/__atelier/emulator');
  var opened = new Promise(function (resolve, reject) {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', function () {
      reject(new Error('The Atelier emulator is not running.'));
    }, { once: true });
  });
  var seq = 0;
  var waiting = new Map();

  function call(op) {
    var args = Array.prototype.slice.call(arguments, 1);
    return opened.then(function () {
      return new Promise(function (resolve, reject) {
        var id = ++seq;
        waiting.set(id, { resolve: resolve, reject: reject });
        socket.send(JSON.stringify({ id: id, op: op, args: args }));
      });
    });
  }

  function text(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  var wire = function (data) {
    return typeof data === 'string' ? data : JSON.stringify(data === undefined ? null : data);
  };
  var unwire = function (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };
  function safely(fn) {
    try {
      fn();
    } catch (err) {
      setTimeout(function () {
        throw err;
      });
    }
  }

  // ---- atelier.server: sockets as the page sees them ----
  var sockets = new Map();
  var onConnection = new Set();
  var onStop = new Set();

  function serverEvent(e) {
    if (e.type === 'connection') {
      var entry = { message: new Set(), close: new Set() };
      entry.socket = {
        id: e.id,
        query: Object.assign({}, e.query),
        remote: e.remote,
        send: function (data) {
          return call('server.send', [e.id], wire(data));
        },
        close: function (code) {
          return code === undefined ? call('server.close', e.id) : call('server.close', e.id, code);
        },
        onMessage: function (fn) {
          entry.message.add(fn);
          return function () {
            return entry.message.delete(fn);
          };
        },
        onClose: function (fn) {
          entry.close.add(fn);
          return function () {
            return entry.close.delete(fn);
          };
        },
      };
      sockets.set(e.id, entry);
      onConnection.forEach(function (fn) {
        safely(function () {
          fn(entry.socket);
        });
      });
    } else if (e.type === 'message') {
      var found = sockets.get(e.id);
      if (!found) return;
      var value = unwire(e.data);
      found.message.forEach(function (fn) {
        safely(function () {
          fn(value, e.data);
        });
      });
    } else if (e.type === 'close') {
      var gone = sockets.get(e.id);
      sockets.delete(e.id);
      if (gone)
        gone.close.forEach(function (fn) {
          safely(function () {
            fn(e.code);
          });
        });
    } else if (e.type === 'stopped') {
      var open = Array.from(sockets.values());
      sockets.clear();
      open.forEach(function (entry) {
        entry.close.forEach(function (fn) {
          safely(function () {
            fn(1001);
          });
        });
      });
      onStop.forEach(function (fn) {
        safely(function () {
          fn(e.reason);
        });
      });
    }
  }

  socket.addEventListener('message', function (event) {
    var m = unwire(String(event.data));
    if (!m || typeof m !== 'object') return;
    if (m.event === 'server') return m.events.forEach(serverEvent);
    if (m.event === 'reload') return location.reload();
    var w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) w.resolve(m.value);
    else w.reject(new Error(m.error || 'Atelier refused this call.'));
  });
  socket.addEventListener('close', function () {
    waiting.forEach(function (w) {
      w.reject(new Error('The Atelier emulator stopped.'));
    });
    waiting.clear();
  });

  var lastTest = '';
  var store = {};

  window.atelier = Object.freeze({
    pack: Object.freeze(info.pack),
    env: Object.freeze({}),
    log: function () {
      return call('log', Array.prototype.map.call(arguments, text).join(' '));
    },
    storage: {
      get: function (key) {
        return Promise.resolve(Object.prototype.hasOwnProperty.call(store, key) ? JSON.parse(store[key]) : null);
      },
      set: function (key, value) {
        store[key] = JSON.stringify(value);
        return Promise.resolve();
      },
      remove: function (key) {
        delete store[key];
        return Promise.resolve();
      },
      keys: function () {
        return Promise.resolve(Object.keys(store));
      },
    },
    status: {
      set: function (status) {
        return call('status.set', status || null);
      },
      clear: function () {
        return call('status.set', null);
      },
    },
    test: {
      ready: function (state) {
        var json;
        try {
          json = JSON.stringify(state === undefined ? null : state);
        } catch {
          return;
        }
        if (json === lastTest || json.length > 64000) return;
        lastTest = json;
        call('test.ready', JSON.parse(json)).catch(function () {});
      },
    },
    cast: {
      members: function () {
        return call('cast.members');
      },
      pick: function (options) {
        return call('cast.pick', options || {});
      },
    },
    server: {
      start: function (options) {
        return call('server.start', options || {});
      },
      stop: function () {
        return call('server.stop');
      },
      status: function () {
        return call('server.status');
      },
      onConnection: function (fn) {
        if (typeof fn !== 'function') throw new Error('atelier.server.onConnection takes a function.');
        onConnection.add(fn);
        return function () {
          return onConnection.delete(fn);
        };
      },
      onStop: function (fn) {
        if (typeof fn !== 'function') throw new Error('atelier.server.onStop takes a function.');
        onStop.add(fn);
        return function () {
          return onStop.delete(fn);
        };
      },
      onRequest: function () {
        throw new Error('The Atelier emulator does not answer requests: Highgames serves files only.');
      },
      sockets: function () {
        return Array.from(sockets.values()).map(function (e) {
          return e.socket;
        });
      },
      broadcast: function (data) {
        return call('server.send', '*', wire(data));
      },
    },
  });
})();
