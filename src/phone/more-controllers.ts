// The newer ways to hold the phone: swipe, aim, spin, slider, draw, number pad and the table playfield.
// Same rules as controllers.ts: one screen per layout, network text only through textContent, a cleanup per screen.
import { type Layout, MAX_DRAW_POINTS, type SceneItem, type SwipeDir, type TvMsg } from '../shared/protocol';
import { button, el, flashClass, icon } from './dom';
import { trackAim, trackSpin } from './sensors';
import type { Ctx } from './controllers';

type Cleanup = () => void;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Feedback from the TV shown in a note line (green for good news, red for bad). */
function feedbackInto(note: HTMLElement, ctx: Ctx): () => void {
  return ctx.onTv((m) => {
    if (m.t !== 'feedback') return;
    note.textContent = m.text;
    note.classList.toggle('good', m.good);
    note.classList.toggle('bad', !m.good);
  });
}

/**
 * Turns flicks on `pad` into swipes. A long drag can fire several (every `step` px, default 70), so quick
 * back-and-forth works. Rhythm games pass a short step so the swipe fires early in the flick, on the beat.
 * `fn` gets the direction and a speed from 0 (lazy) to 1 (very fast).
 */
export function attachSwipe(pad: HTMLElement, fn: (dir: SwipeDir, speed: number) => void, step = 70): void {
  let start: { x: number; y: number; t: number } | null = null;
  const fire = (x: number, y: number, minDist: number): boolean => {
    if (!start) return false;
    const dx = x - start.x;
    const dy = y - start.y;
    const dist = Math.hypot(dx, dy);
    if (dist < minDist) return false;
    const dir: SwipeDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    const ms = Math.max(16, performance.now() - start.t);
    fn(dir, clamp(dist / ms / 2.5, 0, 1));
    return true;
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  pad.addEventListener('pointermove', (e) => {
    if (start && fire(e.clientX, e.clientY, step)) start = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  pad.addEventListener('pointerup', (e) => {
    fire(e.clientX, e.clientY, Math.min(36, step));
    start = null;
  });
  pad.addEventListener('pointercancel', () => (start = null));
}

// ------------------------------------------------------------------ swipe

export function swipe(root: HTMLElement, l: Extract<Layout, { kind: 'swipe' }>, ctx: Ctx): Cleanup {
  const dirs = l.dirs?.length ? l.dirs : (['up', 'down', 'left', 'right'] as SwipeDir[]);
  const pad = el('div', 'swipe-pad');
  for (const d of dirs) {
    const tag = el('div', `swipe-pad__dir swipe-pad__dir--${d}`);
    const arrow = el('span', 'swipe-pad__arrow');
    arrow.append(icon('arrow', 34)); // one arrow, turned by the stylesheet
    tag.append(arrow, ...(l.labels?.[d] ? [el('span', 'swipe-pad__label', l.labels[d])] : []));
    pad.append(tag);
  }
  const note = el('p', 'big', l.note);
  root.append(el('p', 'kicker', 'Swipe'), pad, note);
  // Light follows the finger across the pad.
  const glow = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    pad.style.setProperty('--x', `${e.clientX - r.left}px`);
    pad.style.setProperty('--y', `${e.clientY - r.top}px`);
  };
  pad.addEventListener('pointerdown', (e) => {
    glow(e);
    pad.classList.add('touching');
  });
  pad.addEventListener('pointermove', (e) => e.buttons && glow(e));
  const lift = () => pad.classList.remove('touching');
  pad.addEventListener('pointerup', lift);
  pad.addEventListener('pointercancel', lift);
  attachSwipe(pad, (dir, speed) => {
    if (!dirs.includes(dir)) return;
    ctx.send({ t: 'swipe', dir, speed: round3(speed) });
    ctx.vibrate([8]);
    const tag = pad.querySelector<HTMLElement>(`.swipe-pad__dir--${dir}`);
    if (tag) flashClass(tag, 'hit');
  });
  return feedbackInto(note, ctx);
}

// ------------------------------------------------------------------ aim

export function aim(root: HTMLElement, l: Extract<Layout, { kind: 'aim' }>, ctx: Ctx): Cleanup {
  // The pad shows where you point; it is also the touch fallback (drag on it) for phones without motion.
  const pad = el('div', 'aim-pad');
  const dot = el('div', 'aim-pad__dot');
  pad.append(el('div', 'aim-pad__cross'), dot);
  const note = el('p', 'big', l.note);
  root.append(el('p', 'kicker', 'Point your phone at the screen'), pad);
  let x = 0;
  let y = 0;
  let fire = false;
  let dirty = true;
  let sensed = false;
  const flush = () => {
    dirty = false;
    ctx.send({ t: 'aim', x: round3(x), y: round3(y), fire });
  };
  const show = () => {
    dot.style.left = `${50 + x * 44}%`;
    dot.style.top = `${50 - y * 42}%`;
  };
  const tracker = trackAim(ctx.sensors, (ax, ay) => {
    sensed = true;
    x = ax;
    y = ay;
    dirty = true;
    show();
  });
  const touch = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    y = clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1, 1);
    dirty = true;
    show();
  };
  pad.addEventListener('pointerdown', (e) => {
    if (sensed) return;
    pad.setPointerCapture(e.pointerId);
    touch(e);
  });
  pad.addEventListener('pointermove', (e) => !sensed && e.buttons && touch(e));
  const row = el('div', 'aim-row');
  if (l.button) {
    const shoot = el('button', 'aim-fire', l.button);
    shoot.type = 'button';
    shoot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fire = true;
      flush();
      ctx.vibrate([12]);
      pad.classList.add('firing');
    });
    const release = () => {
      fire = false;
      flush();
      pad.classList.remove('firing');
    };
    shoot.addEventListener('pointerup', release);
    shoot.addEventListener('pointercancel', release);
    row.append(shoot);
  }
  const recenter = button('', 'secondary aim-recenter', () => {
    tracker.recenter();
    x = 0;
    y = 0;
    dirty = true;
    show();
    ctx.vibrate([6]);
  });
  recenter.append(icon('aim', 22), 'Re-centre');
  row.append(recenter);
  root.append(row, note);
  const hint = setTimeout(() => {
    if (!sensed) note.textContent = `${l.note} (No motion sensor here: drag on the square.)`;
  }, 1500);
  const timer = setInterval(() => dirty && flush(), 50);
  const off = feedbackInto(note, ctx);
  return () => {
    clearInterval(timer);
    clearTimeout(hint);
    tracker.stop();
    off();
    if (fire) ctx.send({ t: 'aim', x, y, fire: false });
  };
}

// ------------------------------------------------------------------ spin

export function spin(root: HTMLElement, l: Extract<Layout, { kind: 'spin' }>, ctx: Ctx): Cleanup {
  const ring = el('div', 'spin-ring');
  const knob = el('div', 'spin-ring__knob');
  ring.append(knob);
  const note = el('p', 'big', l.note);
  root.append(el('p', 'kicker', 'Move your phone round in circles'), ring, note);
  let sensorSpeed = 0;
  let touchSpeed = 0;
  let sensed = false;
  const stop = trackSpin(ctx.sensors, (s) => {
    sensed = true;
    sensorSpeed = s;
  });
  // Touch fallback: circle a finger round the ring.
  let lastAngle: number | null = null;
  let lastT = 0;
  const angleOf = (e: PointerEvent) => {
    const r = ring.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  ring.addEventListener('pointerdown', (e) => {
    ring.setPointerCapture(e.pointerId);
    lastAngle = angleOf(e);
    lastT = performance.now();
  });
  ring.addEventListener('pointermove', (e) => {
    if (lastAngle === null) return;
    const a = angleOf(e);
    let d = a - lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    const now = performance.now();
    const dt = Math.max(0.008, (now - lastT) / 1000);
    touchSpeed += (Math.min(1, Math.abs(d / dt) / (Math.PI * 2 * 3)) - touchSpeed) * 0.35;
    lastAngle = a;
    lastT = now;
  });
  const lift = () => (lastAngle = null);
  ring.addEventListener('pointerup', lift);
  ring.addEventListener('pointercancel', lift);
  let turn = 0;
  let lastClick = 0;
  let lastSent = -1;
  const timer = setInterval(() => {
    if (lastAngle === null) touchSpeed *= 0.7;
    const speed = Math.max(sensorSpeed, touchSpeed);
    turn += speed * 120;
    // The dial clicks under a circling finger (never for a moving phone: a buzz would disturb the sensor).
    if (lastAngle !== null && Math.floor(turn / 90) !== lastClick) {
      lastClick = Math.floor(turn / 90);
      ctx.vibrate([5]);
    }
    knob.style.transform = `rotate(${turn}deg)`;
    ring.style.setProperty('--speed', String(speed));
    const rounded = Math.round(speed * 100) / 100;
    if (rounded !== lastSent || rounded > 0) {
      lastSent = rounded;
      ctx.send({ t: 'spin', speed: rounded });
    }
  }, 100);
  const hint = setTimeout(() => {
    if (!sensed) note.textContent = `${l.note} (No motion sensor here: circle a finger round the ring.)`;
  }, 1500);
  const off = feedbackInto(note, ctx);
  return () => {
    clearInterval(timer);
    clearTimeout(hint);
    stop();
    off();
  };
}

// ------------------------------------------------------------------ slider

export function slider(root: HTMLElement, l: Extract<Layout, { kind: 'slider' }>, ctx: Ctx): Cleanup {
  let value = clamp(l.value ?? 0.5, 0, 1);
  const track = el('div', 'fader');
  const fill = el('div', 'fader__fill');
  const thumb = el('div', 'fader__thumb');
  track.append(fill, thumb);
  const wrap = el('div', 'fader-wrap');
  wrap.append(el('span', 'fader__end', l.high ?? ''), track, el('span', 'fader__end', l.low ?? ''));
  const note = el('p', 'big', l.note);
  root.append(wrap);
  let dirty = true;
  let locked = false; // after the confirm button: the answer is in
  const show = () => {
    fill.style.height = `calc(${value} * (100% - 28px))`;
    thumb.style.bottom = `calc(${value * 100}% - 24px)`;
  };
  const set = (e: PointerEvent) => {
    if (locked) return;
    const r = track.getBoundingClientRect();
    value = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    dirty = true;
    show();
    // A detent at every tenth, like a real fader.
    const step = Math.round(value * 10);
    if (step !== lastStep) {
      lastStep = step;
      ctx.vibrate([5]);
    }
  };
  let lastStep = Math.round(value * 10);
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId);
    if (!locked) track.classList.add('active');
    set(e);
  });
  track.addEventListener('pointermove', (e) => e.buttons && set(e));
  const letGo = () => track.classList.remove('active');
  track.addEventListener('pointerup', letGo);
  track.addEventListener('pointercancel', letGo);
  show();
  root.append(note);
  if (l.done) {
    const done = button(l.done, 'primary', () => {
      ctx.send({ t: 'slider', value: round3(value), done: true });
      ctx.vibrate([20]);
      done.disabled = true;
      locked = true;
      track.classList.add('locked');
    });
    root.append(done);
  }
  const timer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    ctx.send({ t: 'slider', value: round3(value), done: false });
  }, 50);
  const off = feedbackInto(note, ctx);
  return () => {
    clearInterval(timer);
    off();
  };
}

// ------------------------------------------------------------------ draw

export function draw(root: HTMLElement, l: Extract<Layout, { kind: 'draw' }>, ctx: Ctx): Cleanup {
  if (l.prompt) {
    const card = el('div', 'secret-card');
    card.append(el('p', 'kicker', l.promptLabel ?? 'Draw this'), el('p', 'big', l.prompt));
    root.append(card);
  }
  const canvas = el('canvas', 'draw-pad');
  const note = el('p', 'muted', l.note);
  root.append(canvas, note);
  const g = canvas.getContext('2d');
  const ink = l.ink ?? (getComputedStyle(document.documentElement).getPropertyValue('--me').trim() || '#2d2d2d');
  const size = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  };
  requestAnimationFrame(size);
  let pending: number[] = [];
  let start = false;
  let last: { x: number; y: number } | null = null;
  const flush = () => {
    if (!pending.length) return;
    ctx.send({ t: 'draw', pts: pending, start });
    pending = [];
    start = false;
  };
  const point = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1);
    const y = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (last && Math.hypot(x - last.x, y - last.y) < 0.006) return;
    if (g) {
      g.strokeStyle = ink;
      g.lineWidth = canvas.width * 0.018;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo((last ?? { x }).x * canvas.width, (last ?? { y }).y * canvas.height);
      g.lineTo(x * canvas.width, y * canvas.height);
      g.stroke();
    }
    last = { x, y };
    pending.push(round3(x), round3(y));
    if (pending.length >= MAX_DRAW_POINTS * 2) flush();
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    flush();
    start = true;
    last = null;
    point(e);
  });
  canvas.addEventListener('pointermove', (e) => e.buttons && point(e));
  const end = () => {
    flush();
    last = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  if (l.done) {
    const done = button(l.done, 'primary', () => {
      flush();
      ctx.send({ t: 'press', index: 0 });
      ctx.vibrate([20]);
      done.disabled = true;
    });
    root.append(done);
  }
  const timer = setInterval(flush, 70);
  const off = feedbackInto(note, ctx);
  return () => {
    clearInterval(timer);
    flush();
    off();
  };
}

// ------------------------------------------------------------------ number pad

export function numberPad(root: HTMLElement, l: Extract<Layout, { kind: 'number' }>, ctx: Ctx): Cleanup {
  let text = '';
  const shown = el('div', 'numpad__value', '–');
  const unit = el('span', 'numpad__unit', l.unit ?? '');
  const display = el('div', 'numpad__display');
  display.append(shown, unit);
  const note = el('p', 'muted', l.note);
  const keys = el('div', 'numpad');
  const ok = el('button', 'numpad__key numpad__ok', 'OK');
  ok.type = 'button';
  const update = () => {
    shown.textContent = text || '–';
    shown.classList.toggle('empty', text === '');
    flashClass(shown, 'tick');
    ok.disabled = text === '' || text === '-';
  };
  const add = (k: string) => {
    if (k === '⌫') text = text.slice(0, -1);
    else if (text.length < 6) text = text === '0' ? k : text + k;
    ctx.vibrate([6]);
    update();
  };
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0']) {
    const b = el('button', 'numpad__key', k === '⌫' ? '' : k);
    b.type = 'button';
    if (k === '⌫') {
      b.classList.add('numpad__key--back');
      b.append(icon('back', 28));
      b.setAttribute('aria-label', 'Delete');
    }
    b.addEventListener('click', () => add(k));
    keys.append(b);
  }
  ok.addEventListener('click', () => {
    const value = clamp(Number(text), l.min, l.max);
    text = String(value);
    update();
    ctx.send({ t: 'number', value });
    ctx.vibrate([20]);
    note.textContent = `Sent: ${value}${l.unit ? ` ${l.unit}` : ''}. You can still change it.`;
  });
  keys.append(ok);
  update();
  root.append(display, keys, note);
  return feedbackInto(note, ctx);
}

// ------------------------------------------------------------------ table playfield

/** The playfield is always 9:16 (portrait), so every phone shows the same shapes in the same places. */
const TABLE_ASPECT = 9 / 16;

export function table(root: HTMLElement, l: Extract<Layout, { kind: 'table' }>, ctx: Ctx): Cleanup {
  const canvas = el('canvas', 'table-canvas');
  const hint = el('p', 'table-hint');
  hint.append(icon('table', 30), l.hint ?? 'Lay your phone flat on the table and watch the big screen.');
  root.append(canvas, hint);
  const g = canvas.getContext('2d');
  let items: SceneItem[] = [];
  let bg = '#f4f1ea';
  let box = { x: 0, y: 0, w: 1, h: 1 };
  const layout = () => {
    const r = root.getBoundingClientRect();
    const availH = innerHeight - r.top;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(availH * dpr);
    canvas.style.height = `${availH}px`;
    // The largest 9:16 box that fits, centred.
    const w = Math.min(canvas.width, canvas.height * TABLE_ASPECT);
    const h = w / TABLE_ASPECT;
    box = { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
  };
  layout();
  addEventListener('resize', layout);
  const drawScene = () => {
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#100c14'; // the bars beside the playfield match the page
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = bg;
    g.fillRect(box.x, box.y, box.w, box.h);
    g.save();
    g.beginPath();
    g.rect(box.x, box.y, box.w, box.h);
    g.clip();
    const X = (v: number) => box.x + v * box.w;
    const Y = (v: number) => box.y + v * box.h;
    for (const it of items) {
      g.globalAlpha = clamp(it.alpha ?? 1, 0, 1);
      switch (it.s) {
        case 'circle':
          g.beginPath();
          g.arc(X(it.x), Y(it.y), Math.max(0, it.r * box.w), 0, Math.PI * 2);
          if (it.fill) {
            g.fillStyle = it.fill;
            g.fill();
          }
          if (it.stroke) {
            g.strokeStyle = it.stroke;
            g.lineWidth = (it.lw ?? 0.01) * box.w;
            g.stroke();
          }
          break;
        case 'rect': {
          const w = it.w * box.w;
          const h = it.h * box.h;
          g.save();
          g.translate(X(it.x), Y(it.y));
          if (it.rot) g.rotate(it.rot);
          g.beginPath();
          g.roundRect(-w / 2, -h / 2, w, h, (it.radius ?? 0) * box.w);
          if (it.fill) {
            g.fillStyle = it.fill;
            g.fill();
          }
          if (it.stroke) {
            g.strokeStyle = it.stroke;
            g.lineWidth = (it.lw ?? 0.01) * box.w;
            g.stroke();
          }
          g.restore();
          break;
        }
        case 'text':
          g.fillStyle = it.fill ?? '#2d2d2d';
          g.font = `${it.bold === false ? 500 : 700} ${Math.max(6, it.size * box.w)}px 'Inter Variable', system-ui, sans-serif`;
          g.textAlign = it.align ?? 'center';
          g.textBaseline = 'middle';
          g.fillText(it.text, X(it.x), Y(it.y));
          break;
        case 'line':
          if (it.pts.length < 4) break;
          g.strokeStyle = it.stroke;
          g.lineWidth = it.lw * box.w;
          g.lineCap = 'round';
          g.lineJoin = 'round';
          g.beginPath();
          g.moveTo(X(it.pts[0] as number), Y(it.pts[1] as number));
          for (let i = 2; i + 1 < it.pts.length; i += 2) g.lineTo(X(it.pts[i] as number), Y(it.pts[i + 1] as number));
          g.stroke();
          break;
      }
    }
    g.restore();
    g.globalAlpha = 1;
  };
  let frame = requestAnimationFrame(function loop() {
    drawScene();
    frame = requestAnimationFrame(loop);
  });
  // Touches, as fractions of the playfield. Moves are sent at most ~30 times a second per finger.
  const ids = new Map<number, number>();
  const lastMove = new Map<number, number>();
  const toField = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    return { x: clamp(((e.clientX - r.left) * sx - box.x) / box.w, 0, 1), y: clamp(((e.clientY - r.top) * sy - box.y) / box.h, 0, 1) };
  };
  const send = (e: PointerEvent, phase: 'down' | 'move' | 'up') => {
    let id = ids.get(e.pointerId);
    if (id === undefined) {
      if (phase !== 'down') return;
      id = [0, 1, 2, 3, 4].find((n) => ![...ids.values()].includes(n)) ?? 0;
      ids.set(e.pointerId, id);
    }
    const p = toField(e);
    ctx.send({ t: 'touch', id, x: round3(p.x), y: round3(p.y), phase });
    if (phase === 'up') ids.delete(e.pointerId);
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    hint.hidden = true;
    send(e, 'down');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ids.has(e.pointerId)) return;
    const now = performance.now();
    if (now - (lastMove.get(e.pointerId) ?? 0) < 33) return;
    lastMove.set(e.pointerId, now);
    send(e, 'move');
  });
  canvas.addEventListener('pointerup', (e) => send(e, 'up'));
  canvas.addEventListener('pointercancel', (e) => send(e, 'up'));
  const off = ctx.onTv((m: TvMsg) => {
    if (m.t !== 'scene') return;
    items = m.items;
    if (m.bg) bg = m.bg;
    hint.hidden = true;
  });
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', layout);
    off();
  };
}
