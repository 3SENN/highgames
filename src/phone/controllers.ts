// One screen per layout the TV sends. Each returns a cleanup function.
// Text from the network is always set with textContent; inserted SVG comes from our own generators.
import { cloudSvg } from '../shared/cloud';
import { type IslandId, isIslandId, islandEmblem } from '../shared/islands';
import { ITEMS } from '../shared/items';
import { type ControllerKind, type Layout, type PhoneMsg, type RhythmMotion, type TvMsg } from '../shared/protocol';
import { type IconName, button, die3d, el, flashClass, icon, inkOn, svg } from './dom';
import { aim, attachSwipe, draw, numberPad, slider, spin, swipe, table } from './more-controllers';
import { type Sensors, detectNod, detectPump, detectQuickShake, detectShake, detectStrum, detectSway, detectWave, trackTilt, trackWobble } from './sensors';

export interface Ctx {
  send(msg: PhoneMsg): void;
  sensors: Sensors;
  /** Subscribe to meter / feedback messages while this screen is shown. */
  onTv(fn: (msg: TvMsg) => void): () => void;
  vibrate(pattern: number[]): void;
}

type Cleanup = () => void;

const HOLD: Record<ControllerKind, { icon: IconName; text: string }> = {
  tap: { icon: 'tap', text: 'Watch the big screen, then tap your phone' },
  pump: { icon: 'pump', text: 'Hold your phone and pump it up and down' },
  tilt: { icon: 'tilt', text: 'Hold your phone flat like a paper plane' },
  secret: { icon: 'secret', text: 'Your phone shows a secret. Keep it to yourself!' },
  still: { icon: 'still', text: 'Hold your phone as still as you can' },
  hold: { icon: 'hold', text: 'Press and hold the big button' },
  stick: { icon: 'stick', text: 'Your phone is a joystick: drag to move' },
  buttons: { icon: 'buttons', text: 'Tap the big buttons on your phone' },
  rhythm: { icon: 'rhythm', text: 'Move with the beat' },
  swipe: { icon: 'swipe', text: 'Flick your finger across the phone' },
  aim: { icon: 'aim', text: 'Point your phone at the big screen like a remote' },
  spin: { icon: 'spin', text: 'Move your phone round in circles' },
  slider: { icon: 'slider', text: 'Slide the big fader on your phone' },
  draw: { icon: 'draw', text: 'Draw with your finger on your phone' },
  number: { icon: 'number', text: 'Type a number on your phone' },
  table: { icon: 'table', text: 'Your phone screen is the playfield: touch it' },
};

export function render(root: HTMLElement, layout: Layout, ctx: Ctx): Cleanup {
  root.replaceChildren();
  // A new kind of screen settles in with a short animation; the same screen redrawn stays put.
  root.className = '';
  if (root.dataset.kind !== layout.kind) flashClass(root, 'enter');
  root.dataset.kind = layout.kind;
  switch (layout.kind) {
    case 'lobby':
      // The lobby is the companion editor (customizer.ts), mounted by main.ts so it survives lobby updates.
      root.append(el('div', 'spinner'), el('h1', '', 'Getting your companion ready…'));
      return () => {};
    case 'wait':
      root.append(el('div', 'spinner'), el('h1', '', layout.title), ...(layout.text ? [el('p', 'muted', layout.text)] : []));
      return () => {};
    case 'turn':
      return turn(root, layout, ctx);
    case 'rolled': {
      // The die lands on your number, like the one on the TV.
      const dice = el('div', `dice n${Math.min(3, layout.values.length)}`);
      dice.setAttribute('role', 'img');
      dice.setAttribute('aria-label', `You rolled ${layout.values.join(' and ')}${layout.bonus ? ` plus ${layout.bonus}` : ''}`);
      layout.values.forEach((v, i) => {
        const d = die3d(v);
        d.style.setProperty('--i', String(i));
        dice.append(d);
      });
      if (layout.bonus) dice.append(el('div', 'bonus', `+${layout.bonus}`));
      const sum = layout.values.reduce((a, b) => a + b, 0) + layout.bonus;
      const total = el('p', 'total');
      total.append(el('b', '', String(sum)), el('span', '', sum === 1 ? 'space' : 'spaces'));
      root.append(el('p', 'kicker', 'You rolled'), dice, total, el('p', 'muted', 'Off you go. Watch the big screen.'));
      ctx.vibrate([14, 60, 30]);
      return () => {};
    }
    case 'choice': {
      root.append(el('h1', '', layout.title));
      const list = el('div', 'stack');
      layout.options.forEach((o, i) => {
        const b = el('button', 'option');
        b.type = 'button';
        if (o.island && isIslandId(o.island)) b.append(svg(islandEmblem(o.island as IslandId, 34), 'option__emblem'));
        const text = el('span', 'text');
        text.append(el('strong', '', o.label), ...(o.hint ? [el('small', '', o.hint)] : []));
        b.append(text, icon('chevron', 20));
        b.addEventListener('click', () => {
          ctx.vibrate([15]);
          ctx.send({ t: 'choose', index: i });
          b.classList.add('picked');
          list.querySelectorAll('button').forEach((x) => (x.disabled = true));
        });
        list.append(b);
      });
      root.append(list);
      return () => {};
    }
    case 'shop': {
      root.append(el('p', 'kicker', 'Corner store'), el('h1', '', `You have ${layout.coins} coins`));
      const price = (cost: number) => {
        const tag = el('span', 'price');
        tag.append(icon('coin', 18), String(cost));
        return tag;
      };
      const list = el('div', 'stack');
      for (const o of layout.offers) {
        const item = ITEMS[o.id];
        const b = el('button', 'option');
        b.type = 'button';
        b.disabled = layout.full || layout.coins < o.cost;
        const text = el('span', 'text');
        text.append(el('strong', '', item.name), el('small', '', item.text));
        b.append(text, price(o.cost));
        b.addEventListener('click', () => {
          ctx.vibrate([15]);
          ctx.send({ t: 'buy', item: o.id });
        });
        list.append(b);
      }
      if (layout.full) list.append(el('p', 'muted', 'Your bag is full (2 items).'));
      root.append(list, button('Just looking', 'secondary', () => ctx.send({ t: 'buy', item: null })));
      return () => {};
    }
    case 'parcel': {
      root.append(el('p', 'kicker', 'Snack Shack'), el('h1', '', 'Grab an order'));
      const list = el('div', 'stack');
      const badge = (name: IconName) => {
        const wrap = el('span', 'option__icon');
        wrap.append(icon(name, 26));
        return wrap;
      };
      const std = el('button', 'option');
      std.type = 'button';
      const stdText = el('span', 'text');
      stdText.append(el('strong', '', `To ${layout.standard}`), el('small', '', 'Free · 1 smile on delivery'));
      std.append(badge('bag'), stdText, icon('chevron', 20));
      std.addEventListener('click', () => {
        ctx.vibrate([15]);
        ctx.send({ t: 'parcel', priority: false });
      });
      const pri = el('button', 'option gold');
      pri.type = 'button';
      pri.disabled = layout.coins < layout.cost;
      const priText = el('span', 'text');
      priText.append(el('strong', '', `Rush order to ${layout.priority}`), el('small', '', `${layout.cost} coins · 2 smiles on delivery`));
      const cost = el('span', 'price');
      cost.append(icon('coin', 18), String(layout.cost));
      pri.append(badge('bag'), priText, cost);
      pri.addEventListener('click', () => {
        ctx.vibrate([15]);
        ctx.send({ t: 'parcel', priority: true });
      });
      list.append(std, pri);
      root.append(list);
      return () => {};
    }
    case 'intro':
      return intro(root, layout, ctx);
    case 'tap':
      return tap(root, layout, ctx);
    case 'pump':
      return pump(root, layout, ctx);
    case 'tilt':
      return tilt(root, layout, ctx);
    case 'secret':
      return secret(root, layout, ctx);
    case 'menu':
      return menu(root, layout, ctx);
    case 'still':
      return still(root, layout, ctx);
    case 'hold':
      return hold(root, layout, ctx);
    case 'stick':
      return stick(root, layout, ctx);
    case 'buttons':
      return bigButtons(root, layout, ctx);
    case 'rhythm':
      return rhythm(root, layout, ctx);
    case 'swipe':
      return swipe(root, layout, ctx);
    case 'aim':
      return aim(root, layout, ctx);
    case 'spin':
      return spin(root, layout, ctx);
    case 'slider':
      return slider(root, layout, ctx);
    case 'draw':
      return draw(root, layout, ctx);
    case 'number':
      return numberPad(root, layout, ctx);
    case 'table':
      return table(root, layout, ctx);
    case 'result':
      root.append(el('div', `medal place-${layout.place}`, String(layout.place)), el('h1', '', layout.title), el('p', 'muted', layout.text));
      if (layout.place === 1) ctx.vibrate([60, 40, 60, 40, 160]);
      return () => {};
    case 'final': {
      const chips = el('div', 'chips');
      const smiles = el('span', 'chip chip--smile');
      smiles.append(icon('smile', 20), `${layout.stamps} ${layout.stamps === 1 ? 'smile' : 'smiles'}`);
      const coins = el('span', 'chip');
      coins.append(icon('coin', 20), `${layout.coins} ${layout.coins === 1 ? 'coin' : 'coins'}`);
      chips.append(smiles, coins);
      root.append(el('div', `medal place-${layout.place}`, String(layout.place)), el('h1', '', layout.place === 1 ? 'You win!' : `${layout.winner} wins!`), chips);
      if (layout.place === 1) ctx.vibrate([60, 40, 60, 40, 160]);
      if (layout.host) root.append(button('Play again', 'primary', () => ctx.send({ t: 'again' })));
      else root.append(el('p', 'muted', 'The host can start a new game.'));
      return () => {};
    }
  }
}


function turn(root: HTMLElement, l: Extract<Layout, { kind: 'turn' }>, ctx: Ctx): Cleanup {
  let done = false;
  const roll = () => {
    if (done) return;
    done = true;
    // The die leaves your hand: a rattle you can feel, and it tumbles until the TV shows what it landed on.
    ctx.vibrate([22, 36, 16, 36, 12, 44, 40]);
    ctx.send({ t: 'roll' });
    big.disabled = true;
    big.classList.add('rolling');
    hint.replaceChildren('Rolling…');
  };
  root.append(el('p', 'kicker', 'Your turn'), el('h1', '', 'Roll the die'));
  const big = button('', 'roll', roll);
  big.append(el('span', 'roll__shadow'), die3d());
  big.setAttribute('aria-label', 'Roll the die');
  const hint = el('p', 'big roll-hint');
  if (ctx.sensors.live) hint.append(icon('shake', 26), 'Shake your phone, or tap the die');
  else hint.append('Tap the die to roll');
  root.append(big, hint);
  if (l.items.length) {
    root.append(el('p', 'section-label', 'Use an item first?'));
    const row = el('div', 'stack');
    for (const id of l.items) {
      const b = el('button', 'option');
      b.type = 'button';
      const text = el('span', 'text');
      text.append(el('strong', '', ITEMS[id].name), el('small', '', ITEMS[id].text));
      b.append(text, icon('chevron', 20));
      b.addEventListener('click', () => {
        ctx.vibrate([15]);
        ctx.send({ t: 'use', item: id });
      });
      row.append(b);
    }
    root.append(row);
  }
  const stop = l.motion ? detectShake(ctx.sensors, roll) : () => {};
  return stop;
}

function intro(root: HTMLElement, l: Extract<Layout, { kind: 'intro' }>, ctx: Ctx): Cleanup {
  const hold = HOLD[l.controller];
  root.append(el('p', 'kicker', 'Next minigame'), el('h1', '', l.title));
  if (l.team) root.append(el('p', 'team-line', l.team));
  const how = el('div', 'how-card');
  how.append(icon(hold.icon, 30), el('span', '', hold.text));
  root.append(how, el('p', 'muted', l.how));
  if (l.ready) {
    const badge = el('div', 'ready-badge');
    badge.append(icon('check', 30), el('strong', '', 'Ready!'), el('span', '', 'Waiting for the others…'));
    root.append(badge);
  } else {
    root.append(
      button("I'm ready", 'primary', () => {
        // A tap is the moment iOS allows asking for motion again.
        if ((l.controller === 'pump' || l.controller === 'tilt') && !ctx.sensors.live) void ctx.sensors.enable();
        ctx.vibrate([18]);
        ctx.send({ t: 'ready', ready: true });
      }),
    );
  }
  return () => {};
}

function tap(root: HTMLElement, l: Extract<Layout, { kind: 'tap' }>, ctx: Ctx): Cleanup {
  const b = el('button', `snap${l.locked ? ' locked' : ''}`, l.locked ? '' : (l.label ?? 'Snap!'));
  b.type = 'button';
  b.disabled = l.locked;
  if (l.locked) {
    b.append(icon('lock', 44));
    b.setAttribute('aria-label', 'Locked');
  }
  // pointerdown, not click: every millisecond counts here.
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (b.disabled) return;
    b.disabled = true;
    b.classList.add('pressed');
    ctx.vibrate([20]);
    ctx.send({ t: 'tap' });
  });
  root.append(b, el('p', 'big', l.note));
  return () => {};
}

function pump(root: HTMLElement, l: Extract<Layout, { kind: 'pump' }>, ctx: Ctx): Cleanup {
  const gauge = el('div', 'gauge');
  const fill = el('div', 'fill');
  if (l.redline !== false) gauge.append(el('div', 'redline'));
  gauge.append(fill);
  const note = el('p', 'big', l.note ?? (ctx.sensors.live ? 'Pump your phone up and down!' : 'Tap Pump as fast as you dare!'));
  const pumpBtn = button('Pump', 'pump-btn', () => send(0.7));
  pumpBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    send(0.7);
  });
  root.append(el('p', 'kicker', l.label ?? 'Balloon pressure'), gauge, note, pumpBtn);
  let last = 0;
  const send = (power: number) => {
    const now = performance.now();
    if (now - last < 90) return;
    last = now;
    ctx.send({ t: 'pump', power });
    gauge.classList.remove('kick');
    void gauge.offsetWidth;
    gauge.classList.add('kick');
  };
  const stopPump = detectPump(ctx.sensors, (p) => send(p));
  const off = ctx.onTv((m) => {
    if (m.t === 'pulse') {
      flashClass(gauge, 'pulse');
    } else if (m.t === 'meter') {
      fill.style.height = `${Math.min(100, m.value * 100)}%`;
      gauge.classList.toggle('danger', m.danger);
      if (m.danger) ctx.vibrate([10]);
    } else if (m.t === 'feedback') {
      note.textContent = m.text;
      root.classList.toggle('bad', !m.good);
      setTimeout(() => root.classList.remove('bad'), 1200);
    }
  });
  return () => {
    stopPump();
    off();
  };
}

function tilt(root: HTMLElement, l: Extract<Layout, { kind: 'tilt' }>, ctx: Ctx): Cleanup {
  const plane = el('div', 'plane', l.icon ?? '');
  if (!l.icon) plane.append(icon('tilt', 96));
  const pad = el('div', 'pad');
  pad.append(plane);
  const note = el('p', 'big', l.note ?? 'Tilt to steer. Nose down to dive.');
  let x = 0;
  let y = 0;
  let gotSensor = false;
  const tracker = trackTilt(ctx.sensors, (tx, ty) => {
    gotSensor = true;
    x = tx;
    y = ty;
  });
  root.append(el('p', 'kicker', l.title ?? 'Glider'), pad, note, button('Re-centre', 'secondary', () => tracker.recenter()));

  // Without motion sensors the pad becomes a touch joystick.
  const touch = (e: PointerEvent) => {
    if (gotSensor) return;
    const r = pad.getBoundingClientRect();
    x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    y = Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1)));
  };
  pad.addEventListener('pointerdown', touch);
  pad.addEventListener('pointermove', (e) => e.buttons && touch(e));
  pad.addEventListener('pointerup', () => {
    if (!gotSensor) x = y = 0;
  });
  const timer = setInterval(() => {
    ctx.send({ t: 'tilt', x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    plane.style.transform = `translate(${x * 38}%, ${-y * 38}%) rotate(${x * 35}deg)`;
  }, 50);
  const hint = setTimeout(() => {
    if (!gotSensor) note.textContent = 'No motion sensor: drag your finger on the pad to steer.';
  }, 1200);
  // A game can show a level (a `meter` message, 0..1) and good or bad news (`feedback`).
  const bar = el('div', 'calm-bar tilt-meter');
  const fill = el('div', 'calm-bar__fill');
  bar.append(fill);
  bar.hidden = true;
  pad.after(bar);
  const off = ctx.onTv((m) => {
    if (m.t === 'meter') {
      bar.hidden = false;
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, m.value)) * 100)}%`;
      bar.classList.toggle('danger', m.danger);
    } else if (m.t === 'feedback') {
      note.textContent = m.text;
      note.classList.toggle('good', m.good);
      note.classList.toggle('bad', !m.good);
    }
  });
  return () => {
    clearInterval(timer);
    clearTimeout(hint);
    tracker.stop();
    off();
  };
}

function secret(root: HTMLElement, l: Extract<Layout, { kind: 'secret' }>, ctx: Ctx): Cleanup {
  root.append(el('p', 'kicker', `Round ${l.round} of ${l.rounds} · your secret cloud`), svg(cloudSvg(l.cloud, { size: 200 }), 'my-cloud'));
  const note = el('p', 'big', 'Find it on the big screen!');
  const grid = el('div', 'letters');
  l.labels.forEach((label, i) => {
    const b = button(label, 'letter', () => {
      ctx.vibrate([15]);
      ctx.send({ t: 'answer', index: i });
    });
    grid.append(b);
  });
  root.append(note, grid);
  const off = ctx.onTv((m) => {
    if (m.t !== 'feedback') return;
    note.textContent = m.text;
    if (m.good) {
      grid.querySelectorAll('button').forEach((b) => (b.disabled = true));
      root.classList.add('good');
    } else {
      grid.classList.add('locked');
      setTimeout(() => grid.classList.remove('locked'), 1500);
    }
  });
  return off;
}

// ------------------------------------------------------------------ the newer controllers

function menu(root: HTMLElement, l: Extract<Layout, { kind: 'menu' }>, ctx: Ctx): Cleanup {
  root.append(el('h1', '', l.title));
  if (l.note) root.append(el('p', 'muted', l.note));
  const list = el('div', 'stack');
  l.options.forEach((o, i) => {
    const b = el('button', 'option');
    b.type = 'button';
    b.disabled = !l.canPick;
    const text = el('span', 'text');
    text.append(el('strong', '', o.label), ...(o.hint ? [el('small', '', o.hint)] : []));
    b.append(text);
    if (l.canPick) b.append(icon('chevron', 20));
    b.addEventListener('click', () => {
      ctx.vibrate([15]);
      ctx.send({ t: 'choose', index: i });
      list.querySelector('.picked')?.classList.remove('picked');
      b.classList.add('picked');
    });
    list.append(b);
  });
  if (!l.canPick) list.classList.add('watching');
  root.append(list);
  if (!l.canPick) root.append(el('p', 'muted', 'The host picks. Shout your vote!'));
  return () => {};
}

function still(root: HTMLElement, l: Extract<Layout, { kind: 'still' }>, ctx: Ctx): Cleanup {
  const level = el('div', 'level');
  const bubble = el('div', 'bubble');
  level.append(el('div', 'level__ring'), bubble);
  const note = el('p', 'big', l.note);
  // A game can show how close you are to losing it (a `meter` message: 0 calm … 1 gone).
  const bar = el('div', 'calm-bar');
  const fill = el('div', 'calm-bar__fill');
  bar.append(fill);
  bar.hidden = true;
  root.append(el('p', 'kicker', l.title ?? 'Stay still'), level, bar, note);
  const offTv = ctx.onTv((m) => {
    if (m.t === 'meter') {
      bar.hidden = false;
      fill.style.width = `${Math.round((1 - Math.min(1, Math.max(0, m.value))) * 100)}%`;
      bar.classList.toggle('danger', m.danger);
    } else if (m.t === 'feedback') {
      note.textContent = m.text;
      note.classList.toggle('good', m.good);
      note.classList.toggle('bad', !m.good);
    }
  });
  let wobble = 0;
  let sensed = false;
  const stop = trackWobble(ctx.sensors, (w) => {
    sensed = true;
    wobble = w;
  });
  // Without motion sensors: keep a thumb on the circle; lifting it counts as wobbling.
  let pressed = false;
  level.addEventListener('pointerdown', () => (pressed = true));
  const up = () => (pressed = false);
  level.addEventListener('pointerup', up);
  level.addEventListener('pointercancel', up);
  const timer = setInterval(() => {
    const w = sensed ? wobble : pressed ? 0.02 : 1;
    ctx.send({ t: 'still', wobble: Math.round(w * 100) / 100 });
    const angle = performance.now() / 180;
    bubble.style.transform = `translate(${Math.cos(angle) * w * 70}px, ${Math.sin(angle * 1.3) * w * 70}px)`;
    level.classList.toggle('shaky', w > 0.35);
  }, 100);
  const hint = setTimeout(() => {
    if (!sensed) note.textContent = 'No motion sensor here: keep your thumb on the circle.';
  }, 1200);
  return () => {
    clearInterval(timer);
    clearTimeout(hint);
    stop();
    offTv();
  };
}

function hold(root: HTMLElement, l: Extract<Layout, { kind: 'hold' }>, ctx: Ctx): Cleanup {
  const btn = el('button', 'hold-btn', l.label);
  btn.type = 'button';
  const ring = el('div', 'hold-ring');
  if (l.zone) {
    const [from, to] = l.zone.map((v) => Math.max(0, Math.min(1, v)) * 100);
    ring.classList.add('zoned');
    ring.style.setProperty('--z0', `${from ?? 0}%`);
    ring.style.setProperty('--z1', `${to ?? 0}%`);
  }
  ring.append(btn);
  const note = el('p', 'big', l.note);
  root.append(ring, note);
  let down = false;
  const set = (d: boolean) => {
    if (d === down) return;
    down = d;
    btn.classList.toggle('down', d);
    if (d) ctx.vibrate([10]);
    ctx.send({ t: 'hold', down: d });
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    set(true);
  });
  btn.addEventListener('pointerup', () => set(false));
  btn.addEventListener('pointercancel', () => set(false));
  let inZone = false;
  const off = ctx.onTv((m) => {
    if (m.t === 'meter') {
      ring.style.setProperty('--fill', `${Math.min(100, m.value * 100)}%`);
      ring.classList.toggle('danger', m.danger);
      // A tick in your thumb as the ring enters the gold band.
      const now = !!l.zone && m.value >= (l.zone[0] ?? 0) && m.value <= (l.zone[1] ?? 0);
      if (now && !inZone && down) ctx.vibrate([8]);
      inZone = now;
    } else if (m.t === 'feedback') {
      note.textContent = m.text;
      note.classList.toggle('good', m.good);
      note.classList.toggle('bad', !m.good);
    }
  });
  return () => {
    off();
    if (down) ctx.send({ t: 'hold', down: false });
  };
}

function stick(root: HTMLElement, l: Extract<Layout, { kind: 'stick' }>, ctx: Ctx): Cleanup {
  const pad = el('div', 'stick-pad');
  const knob = el('div', 'stick-knob');
  pad.append(knob);
  const row = el('div', 'stick-row');
  row.append(pad);
  if (!l.button) pad.classList.add('solo');
  let atEdge = false;
  let x = 0;
  let y = 0;
  let a = false;
  let dirty = true;
  const flush = () => {
    dirty = false;
    ctx.send({ t: 'stick', x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, a });
  };
  if (l.button) {
    const action = el('button', 'stick-btn', l.button);
    action.type = 'button';
    // The button is sent the moment it changes (not on the next tick), so a quick tap is never lost.
    action.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      a = true;
      flush();
      ctx.vibrate([12]);
    });
    const release = () => {
      a = false;
      flush();
    };
    action.addEventListener('pointerup', release);
    action.addEventListener('pointercancel', release);
    row.append(action);
  }
  const note = el('p', 'big', l.note);
  root.append(row, note);
  const offTv = ctx.onTv((m) => {
    if (m.t !== 'feedback') return;
    note.textContent = m.text;
    note.classList.toggle('good', m.good);
    note.classList.toggle('bad', !m.good);
  });
  const move = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    let dx = ((e.clientX - r.left) / r.width) * 2 - 1;
    let dy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    // A soft bump when the knob reaches the rim.
    if (len >= 1 && !atEdge) ctx.vibrate([6]);
    atEdge = len >= 1;
    x = dx;
    y = dy;
    dirty = true;
    knob.style.transform = `translate(${x * 42}%, ${-y * 42}%)`;
  };
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    pad.classList.add('active');
    move(e);
  });
  pad.addEventListener('pointermove', (e) => e.buttons && move(e));
  const center = () => {
    x = y = 0;
    dirty = true;
    atEdge = false;
    pad.classList.remove('active');
    knob.style.transform = '';
  };
  pad.addEventListener('pointerup', center);
  pad.addEventListener('pointercancel', center);
  const timer = setInterval(() => {
    if (dirty) flush();
  }, 50);
  return () => {
    clearInterval(timer);
    offTv();
  };
}

function bigButtons(root: HTMLElement, l: Extract<Layout, { kind: 'buttons' }>, ctx: Ctx): Cleanup {
  root.append(el('h1', '', l.title));
  if (l.secret) {
    const card = el('div', 'secret-card');
    const only = el('p', 'kicker');
    only.append(icon('secret', 16), 'Only you can see this');
    card.append(only, el('p', 'big', l.secret));
    root.append(card);
  }
  const grid = el('div', `big-buttons n${l.buttons.length}`);
  const note = el('p', 'muted', l.note ?? '');
  l.buttons.forEach((b, i) => {
    const btn = el('button', 'big-button', b.label);
    btn.type = 'button';
    if (b.color) {
      btn.style.setProperty('--b', b.color);
      btn.style.setProperty('--on-b', inkOn(b.color));
    }
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      ctx.vibrate([12]);
      ctx.send({ t: 'press', index: i });
      btn.disabled = true;
      btn.classList.add('pressed');
      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('pressed');
      }, 220);
    });
    grid.append(btn);
  });
  root.append(grid, note);
  return ctx.onTv((m) => {
    if (m.t === 'feedback') {
      note.textContent = m.text;
      root.classList.toggle('bad', !m.good);
      setTimeout(() => root.classList.remove('bad'), 700);
    }
  });
}

const RHYTHM_WORDS: Record<RhythmMotion, { kicker: string; verb: string }> = {
  tap: { kicker: 'Tap along', verb: 'Tap on the beat' },
  nod: { kicker: 'Nod along', verb: 'Nod your phone on the beat' },
  strum: { kicker: 'Strum along', verb: 'Strum your phone on the beat' },
  swipe: { kicker: 'Swipe along', verb: 'Swipe on the beat' },
  wave: { kicker: 'Wave along', verb: 'Wave your phone side to side on the beat' },
  shake: { kicker: 'Shake along', verb: 'Shake your phone on the beat' },
  sway: { kicker: 'Sway along', verb: 'Tip your phone left and right on the beat' },
  pads: { kicker: 'Play along', verb: 'Hit the right pad on the beat' },
  hold: { kicker: 'Hum along', verb: 'Press on the beat, let go when the note ends' },
};
const PAD_COLORS = ['#F5A524', '#3B82F6', '#E2437A', '#22B573'];

function rhythm(root: HTMLElement, l: Extract<Layout, { kind: 'rhythm' }>, ctx: Ctx): Cleanup {
  const words = RHYTHM_WORDS[l.motion] ?? RHYTHM_WORDS.tap;
  const word = el('div', 'beat-word', '');
  root.append(el('p', 'kicker', words.kicker));
  const pulseTargets: HTMLElement[] = [];
  const hitFx = (e: HTMLElement) => flashClass(e, 'hit');
  let stop: () => void = () => {};

  if (l.motion === 'pads') {
    // Two to four drum pads; the beat says which one.
    const n = Math.min(4, Math.max(2, l.pads ?? 2));
    const grid = el('div', `beat-pads n${n}`);
    for (let i = 0; i < n; i++) {
      const pad = el('button', 'beat-pad', l.padLabels?.[i] ?? '');
      pad.type = 'button';
      const color = l.padColors?.[i] ?? PAD_COLORS[i] ?? '#2d2d2d';
      pad.style.setProperty('--b', color);
      pad.style.setProperty('--on-b', inkOn(color));
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        ctx.send({ t: 'beat', pad: i });
        ctx.vibrate([8]);
        hitFx(pad);
      });
      grid.append(pad);
      pulseTargets.push(pad);
    }
    root.append(grid, word);
  } else {
    const beat = el('div', 'beat-ring');
    beat.append(word);
    pulseTargets.push(beat);
    root.append(beat);
    // A touch gets a tick back; a motion doesn't, so the buzz can never be mistaken for the next move.
    const hit = (touched = false) => {
      ctx.send({ t: 'beat' });
      if (touched) ctx.vibrate([8]);
      hitFx(beat);
    };
    if (l.motion === 'hold') {
      // Press on the beat, let go when the note ends.
      let down = false;
      beat.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        beat.setPointerCapture(e.pointerId);
        down = true;
        beat.classList.add('down');
        hit(true);
      });
      const up = () => {
        if (!down) return;
        down = false;
        beat.classList.remove('down');
        ctx.send({ t: 'beat', up: true });
      };
      beat.addEventListener('pointerup', up);
      beat.addEventListener('pointercancel', up);
    } else if (l.motion === 'swipe') {
      attachSwipe(beat, () => hit(true), 26);
    } else {
      // Taps always count; the motions come from the sensors when the phone has them.
      beat.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        hit(true);
      });
      const detectors: Partial<Record<RhythmMotion, (s: Sensors, fn: () => void) => () => void>> = {
        nod: detectNod,
        strum: detectStrum,
        wave: detectWave,
        shake: detectQuickShake,
        sway: detectSway,
      };
      stop = detectors[l.motion]?.(ctx.sensors, () => hit()) ?? (() => {});
    }
  }
  root.append(el('p', 'big', l.note || words.verb));
  const off = ctx.onTv((m) => {
    if (m.t === 'pulse') {
      const target = m.pad !== undefined && pulseTargets.length > 1 ? pulseTargets[m.pad] : pulseTargets[0];
      if (target) flashClass(target, 'pulse');
    } else if (m.t === 'feedback') {
      word.textContent = m.text;
      word.className = `beat-word ${m.good ? 'good' : 'bad'}`;
    }
  });
  return () => {
    stop();
    off();
  };
}

/** The header: your name and seat colour (the portrait of your companion is set by main.ts). */
export function identity(name: HTMLElement, you: Extract<TvMsg, { t: 'you' }>): void {
  document.documentElement.style.setProperty('--me', you.color);
  document.documentElement.style.setProperty('--on-me', inkOn(you.color));
  name.textContent = you.name;
}
