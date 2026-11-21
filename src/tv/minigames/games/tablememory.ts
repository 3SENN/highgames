// Coffee Table Memory on the TV: the living room late at night, the phones lying side by side on the coffee table
// with their coasters (the TV mirrors every screen), and the players' companions behind the table, each with a
// little stack of the coasters they've won. Whoever's go it is has a soft glow at their feet; a computer player's
// pick shows as a fingertip drifting over to the coaster it picks.
import * as THREE from 'three';
import { type Companion, buildCompanion } from '../../../companion/kit';
import {
  type Card,
  type CpuMemory,
  MEMORY,
  type MemoryEvent,
  SNACKS,
  cardAt,
  cardPlace,
  cardRect,
  cpuChoose,
  cpuDelay,
  memoryScores,
  newCpuMemory,
  newMemory,
  notice,
  pick,
  stepMemory,
} from '../../../game/minigames/tablememory';
import type { SceneItem } from '../../../shared/protocol';
import { FONT, PALETTE as P, cone, cyl, mix, nameCard, part, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { ordinal } from '../../ui';
import { CameraFit, Floaters, type Mark, SceneStream, lanes, noise, tone } from '../kit';
import {
  CARD,
  Overlay,
  PhoneOnTable,
  type Room,
  SCREEN,
  SCREEN_Y,
  TABLE_Y,
  arrangePhones,
  colourLine,
  countIn,
  diagramFrame,
  diagramPhone,
  diagramTable,
  furnishRoom,
  nameList,
  onDark,
  overlayItems,
  readyPill,
  screenBg,
} from '../table-kit';
import { type Minigame, type MinigameContext, type MinigameSeat, everyFrame } from '../types';

// ================================================================== coffee table memory

const PHONE_W = 1.5;
const ROW_GAP = 0.16;
const HEIGHT = 1.45; // companions
const TILT = 0.95;
const SIDE_BEZEL = 0.07; // the phones' edges (the kit's default phone)
const END_BEZEL = 0.15;
const BG = '#1d1828';
const CORK = SCREEN.cork;
const CORK_DARK = SCREEN.corkDark;
const CORK_RING = '#b08355';
const MOON = SCREEN.cream;
/** A snack's colour as its card: taken a little towards cream, so the six sit together. */
const cardColor = (c: string) => mix(c, SCREEN.cream, 0.35);
const STACK_R = 0.27;

type Rect = { x: number; y: number; w: number; h: number };

// ------------------------------------------------------------------ what a phone shows

/** One coaster: face down (cork, with a little moon), turning over, face up (the snack), or won (its colour). */
function cardItems(c: Card, r: Rect, now: number, ring: string | null, owner: MinigameSeat | null): SceneItem[] {
  const k = c.flipAt < 0 ? 1 : Math.min(1, Math.max(0, (now - c.flipAt) / MEMORY.flip));
  const sc = Math.max(0.06, Math.abs(Math.cos(Math.PI * k)));
  const faceUp = c.state === 'down' ? k < 0.5 : k >= 0.5;
  const w = r.w * sc;
  const radius = r.w * 0.16 * Math.min(1, sc * 1.6);
  if (!faceUp) {
    const items: SceneItem[] = [{ s: 'rect', x: r.x, y: r.y, w, h: r.h, radius, fill: CORK, stroke: CORK_DARK, lw: 0.012 }];
    if (sc > 0.55) {
      items.push(
        { s: 'circle', x: r.x, y: r.y, r: r.w * 0.32 * sc, stroke: CORK_RING, lw: 0.01 },
        { s: 'circle', x: r.x - r.w * 0.025 * sc, y: r.y, r: r.w * 0.13 * sc, fill: MOON },
        { s: 'circle', x: r.x + r.w * 0.045 * sc, y: r.y - r.h * 0.07, r: r.w * 0.115 * sc, fill: CORK },
      );
    }
    return items;
  }
  const snack = SNACKS[c.face] ?? SNACKS[0];
  if (c.state === 'taken' && owner) {
    const items: SceneItem[] = [{ s: 'rect', x: r.x, y: r.y, w, h: r.h, radius, fill: mix(owner.color, SCREEN.night, 0.5), stroke: onDark(owner.color, 0.1), lw: 0.01, alpha: 0.95 }];
    if (sc > 0.6) {
      items.push(
        { s: 'text', x: r.x, y: r.y - r.h * 0.07, text: snack.emoji, size: r.w * 0.4 },
        { s: 'text', x: r.x, y: r.y + r.h * 0.34, text: owner.name, size: r.w * 0.12, fill: SCREEN.cream },
      );
    }
    return items;
  }
  const items: SceneItem[] = [{ s: 'rect', x: r.x, y: r.y, w, h: r.h, radius, fill: cardColor(snack.color), stroke: ring ?? SCREEN.cream, lw: ring ? 0.024 : 0.01 }];
  if (sc > 0.6) {
    items.push(
      { s: 'text', x: r.x, y: r.y - r.h * 0.08, text: snack.emoji, size: r.w * 0.46 },
      { s: 'text', x: r.x, y: r.y + r.h * 0.33, text: snack.name, size: r.w * 0.12, fill: SCREEN.ink, bold: false },
    );
  }
  return items;
}

interface Table {
  seats: readonly MinigameSeat[];
  cpu: readonly boolean[];
  /** The player whose phone lies at each place in the row. */
  owners: readonly number[];
}

interface Moment {
  now: number;
  /** The line under whose go it is. */
  note: string;
  overlay: { text: string; color: string } | null;
}

/** Phone k's screen while playing: whose go, the coasters, and the owner's pairs and the time at the bottom. */
function playScene(tb: Table, game: ReturnType<typeof newMemory>, k: number, m: Moment): SceneItem[] {
  const items: SceneItem[] = [];
  const turn = tb.seats[game.turn] as MinigameSeat;
  const owner = tb.owners[k] ?? 0;
  const mine = owner === game.turn && !tb.cpu[owner];
  items.push(
    { s: 'rect', x: 0.5, y: 0.068, w: 0.92, h: 0.085, radius: 0.08, fill: mix(turn.color, SCREEN.night, mine ? 0.3 : 0.62), stroke: turn.color, lw: 0.006 },
    { s: 'text', x: 0.5, y: 0.07, text: mine ? 'Your go!' : `${turn.name}’s go`, size: 0.07, fill: SCREEN.cream },
    { s: 'text', x: 0.5, y: 0.145, text: m.note, size: 0.045, fill: SCREEN.soft, bold: false },
  );
  const b = game.board;
  const ring = game.match === null ? turn.color : game.match ? SCREEN.gold : SCREEN.bad;
  for (let slot = 0; slot < b.perPhone; slot++) {
    const i = k * b.perPhone + slot;
    const c = b.cards[i];
    if (!c) continue;
    const picked = game.picks.includes(i);
    items.push(...cardItems(c, cardRect(b.grid, slot), m.now, picked ? ring : null, c.owner === null ? null : (tb.seats[c.owner] ?? null)));
  }
  const me = tb.seats[owner] as MinigameSeat;
  const pairs = game.pairs[owner] ?? 0;
  items.push(
    { s: 'text', x: 0.05, y: 0.945, text: `${me.name} · ${pairs} ${pairs === 1 ? 'pair' : 'pairs'}`, size: 0.045, fill: onDark(me.color), align: 'left' },
    { s: 'text', x: 0.95, y: 0.945, text: `${Math.max(0, Math.ceil(MEMORY.duration - m.now))} s`, size: 0.045, fill: SCREEN.soft, align: 'right', bold: false },
  );
  if (m.overlay) items.push(...overlayItems(m.overlay.text, m.overlay.color, 0.5, 0.13));
  return items;
}

/** Phone k while the phones are laid out: whose it is, its place in the row, and Ready once it's tapped. */
function rowScene(tb: Table, k: number, ready: boolean, waiting: string | null): { items: SceneItem[]; bg: string } {
  const owner = tb.owners[k] ?? 0;
  const me = tb.seats[owner] as MinigameSeat;
  const n = tb.owners.length;
  const ink = SCREEN.soft;
  const items: SceneItem[] = [
    { s: 'text', x: 0.5, y: 0.2, text: me.name, size: 0.13, fill: onDark(me.color, 0.2) },
    { s: 'text', x: 0.5, y: 0.285, text: n === 1 ? 'Your phone is the whole table' : `${ordinal(k + 1)} from the left`, size: 0.058, fill: SCREEN.cream, bold: false },
  ];
  const step = Math.min(0.22, 0.86 / n);
  tb.owners.forEach((o, j) => {
    const s = tb.seats[o] as MinigameSeat;
    const x = 0.5 + (j - (n - 1) / 2) * step;
    items.push(
      { s: 'rect', x, y: 0.47, w: step * 0.62, h: step * 0.62, radius: 0.02, fill: j === k ? s.color : mix(s.color, SCREEN.night, 0.75), stroke: s.color, lw: 0.01 },
      { s: 'text', x, y: 0.47 + step * 0.42, text: s.name, size: Math.min(0.045, step * 0.22), fill: onDark(s.color) },
    );
  });
  if (n > 1) items.push({ s: 'text', x: 0.5, y: 0.62, text: 'left  →  right, facing the TV', size: 0.04, fill: ink, bold: false });
  items.push(...readyPill(0.76, ready, 'Tap when it’s down'));
  if (ready && waiting) items.push({ s: 'text', x: 0.5, y: 0.84, text: waiting, size: 0.042, fill: ink, bold: false });
  return { items, bg: screenBg(me.color) };
}

// ------------------------------------------------------------------ the room

/** A fingertip in a player's colour that drifts over to the coaster being picked. */
function fingertip(color: string): THREE.Group {
  const g = new THREE.Group();
  const bob = new THREE.Group();
  bob.name = 'bob';
  part(bob, cone(0.075, 0.22, 16), color, 0, 0.11, 0, { rx: Math.PI, gloss: 0.4, outline: 0.012 });
  part(bob, sphere(0.1, 16), mix(color, P.cream, 0.3), 0, 0.27, 0, { gloss: 0.5, outline: 0.012 });
  part(bob, torus(0.11, 0.012), color, 0, -0.02, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
  g.add(bob);
  g.visible = false;
  return g;
}

class MemoryRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  readonly overlay: Overlay;
  readonly phones: PhoneOnTable[] = [];
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private readonly spots: THREE.Mesh[] = [];
  private readonly fingers: THREE.Group[] = [];
  private readonly stacks: THREE.Group[] = [];
  private readonly xs: number[];
  private readonly stackZ: number;
  private readonly aim: { p: number; to: THREE.Vector3 | null }[];
  private readonly room: Room;
  /** Coasters just won, dropping onto a stack: they fall, squash and settle. */
  private readonly drops: { mesh: THREE.Mesh; y: number; age: number }[] = [];
  private time = 0;

  constructor(
    readonly seats: readonly MinigameSeat[],
    readonly companions: readonly Companion[],
    phones: number,
  ) {
    const rowW = phones * (PHONE_W + SIDE_BEZEL * 2) + (phones - 1) * ROW_GAP;
    const n = seats.length;
    const spacing = Math.max(1.55, Math.min(2.1, (rowW + 1.6) / Math.max(1, n)));
    const tw = Math.max(rowW + 1.6, n * spacing + 0.4);
    const len = (PHONE_W * 16) / 9 + END_BEZEL * 2;
    const td = len + 1.9;
    this.room = furnishRoom(this.scene, { w: tw, d: td });
    // Snacks along the front of the table and at its ends, clear of the phones and of the stacks at the back.
    const { room } = this;
    room.treat('bowl', -tw / 2 + 0.62, td / 2 - 0.62, 0, 2);
    room.treat('candle', -tw / 2 + 0.42, -0.35);
    room.treat('mug', tw / 2 - 0.5, td / 2 - 0.5, 0, 1);
    room.treat('candle', tw / 2 - 0.42, 0.2);
    if (tw > 5) {
      room.treat('remote', 0.5, td / 2 - 0.42, 1.2);
      room.treat('can', -0.9, td / 2 - 0.45, 0, 2);
    }
    for (let k = 0; k < phones; k++) {
      const ph = new PhoneOnTable(PHONE_W);
      ph.place((k - (phones - 1) / 2) * (PHONE_W + SIDE_BEZEL * 2 + ROW_GAP), 0, 0);
      this.scene.add(ph.group);
      this.phones.push(ph);
    }
    this.xs = lanes(n, spacing);
    this.stackZ = -td / 2 + 0.45;
    const backZ = -td / 2 - 0.8;
    this.aim = seats.map((_, p) => ({ p, to: null }));
    seats.forEach((s, p) => {
      const x = this.xs[p] ?? 0;
      const c = companions[p];
      if (c) {
        c.root.position.set(x, 0, backZ);
        c.root.rotation.y = -x * 0.06;
        c.setBase('listening');
        this.scene.add(c.root);
      }
      const card = nameCard(s.name, s.color, 0.95);
      card.position.set(x, HEIGHT + 0.42, backZ);
      this.scene.add(card);
      this.cards.push(card);
      const spot = part(this.scene, torus(0.55, 0.045), s.color, x, 0.05, backZ, { rx: Math.PI / 2, glow: 1.4, shadow: false, outline: false });
      spot.visible = false;
      this.spots.push(spot);
      const f = fingertip(s.color);
      this.scene.add(f);
      this.fingers.push(f);
      const stack = new THREE.Group();
      stack.position.set(Math.max(-tw / 2 + 0.4, Math.min(tw / 2 - 0.4, x)), TABLE_Y, this.stackZ);
      this.scene.add(stack);
      this.stacks.push(stack);
      this.marks.push({ p: new THREE.Vector3(x, 0, backZ) }, { p: card.position.clone(), pad: 0.06 });
    });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.marks.push({ p: new THREE.Vector3((sx * tw) / 2, TABLE_Y, (sz * td) / 2) });
    this.overlay = new Overlay(this.camera, this.scene);
  }

  /** Where a coaster lies in the world. */
  cardAt(card: number, perPhone: number, rect: Rect, lift = 0): THREE.Vector3 {
    const ph = this.phones[Math.floor(card / perPhone)];
    return ph ? ph.at(rect.x, rect.y, lift) : new THREE.Vector3(0, SCREEN_Y + lift, 0);
  }

  /** Whose go it is: a glow at their feet, and they think while the others watch. */
  setTurn(p: number): void {
    this.spots.forEach((s, i) => (s.visible = i === p));
    this.companions.forEach((c, i) => c.setBase(i === p ? 'thinking' : 'listening'));
    this.fingers.forEach((f, i) => {
      f.visible = false;
      if (i === p) f.position.copy(this.stacks[i]?.position ?? new THREE.Vector3()).add(new THREE.Vector3(0, 1.1, 0.3));
    });
    this.aim.forEach((a) => (a.to = null));
  }

  /** Player p's fingertip goes to `to` (snapping there when `snap`), or away (null). */
  point(p: number, to: THREE.Vector3 | null, snap = false): void {
    const f = this.fingers[p];
    const a = this.aim[p];
    if (!f || !a) return;
    a.to = to ? to.clone().add(new THREE.Vector3(0, 0.16, 0)) : null;
    f.visible = to !== null;
    if (to && snap) f.position.copy(a.to as THREE.Vector3);
  }

  /** A pair won: two more coasters on p's stack. */
  addPair(p: number, count: number): THREE.Vector3 {
    const s = this.stacks[p];
    const color = this.seats[p]?.color ?? '#ffffff';
    if (!s) return new THREE.Vector3();
    for (let k = 0; k < 2; k++) {
      const h = (count - 1) * 2 + k;
      const y = 0.025 + h * 0.05;
      const m = part(s, cyl(STACK_R, STACK_R, 0.045, 28), k ? color : mix(color, P.cream, 0.35), Math.sin(h * 2.1) * 0.03, y, Math.cos(h * 1.7) * 0.03, { gloss: 0.25, outline: 0.01 });
      part(m, torus(STACK_R * 0.7, 0.008), mix(color, P.ink, 0.3), 0, 0.024, 0, { rx: Math.PI / 2, outline: false, shadow: false });
      m.rotation.y = h * 0.7;
      this.drops.push({ mesh: m, y, age: -k * 0.09 });
    }
    return s.position.clone().add(new THREE.Vector3(0, 0.3 + count * 0.1, 0));
  }

  above(p: number): THREE.Vector3 {
    const c = this.companions[p];
    return c ? c.root.position.clone().add(new THREE.Vector3(0, HEIGHT + 0.8, 0)) : new THREE.Vector3(0, 2, 0);
  }

  update(dt: number, time = 0): void {
    this.time += dt;
    this.room.update(dt, time);
    this.fit.update(() => this.marks);
    // Won coasters drop in from a little above, squash as they land and settle.
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i] as { mesh: THREE.Mesh; y: number; age: number };
      d.age += dt;
      const fall = Math.min(1, Math.max(0, d.age / 0.18));
      const settle = Math.min(1, Math.max(0, (d.age - 0.18) / 0.25));
      d.mesh.visible = d.age >= 0;
      d.mesh.position.y = d.y + (1 - fall * fall) * 0.55;
      const squash = fall < 1 ? 0 : Math.sin(settle * Math.PI) * (1 - settle);
      d.mesh.scale.set(1 + squash * 0.22, 1 - squash * 0.35, 1 + squash * 0.22);
      if (settle >= 1) {
        d.mesh.scale.setScalar(1);
        this.drops.splice(i, 1);
      }
    }
    for (const c of this.companions) c.update(dt);
    const ease = 1 - Math.exp(-dt * 9);
    this.fingers.forEach((f, i) => {
      const to = this.aim[i]?.to;
      if (!f.visible || !to) return;
      f.position.lerp(to, ease);
      const bob = f.getObjectByName('bob');
      if (bob) bob.position.y = Math.sin(this.time * 6 + i) * 0.03;
    });
    this.spots.forEach((s) => s.scale.setScalar(1 + Math.sin(this.time * 2.4) * 0.04));
    this.floaters.update(dt);
    this.overlay.update(dt);
  }

  dispose(): void {
    this.floaters.dispose();
    this.overlay.dispose();
    for (const p of this.phones) p.dispose();
    for (const c of this.companions) c.dispose();
    for (const card of this.cards) {
      card.removeFromParent();
      card.material.map?.dispose();
      card.material.dispose();
    }
  }
}

// ------------------------------------------------------------------ the diagram

function drawRow(g: CanvasRenderingContext2D, w: number, h: number, tb: Table, ready: ReadonlySet<number>, demo: boolean): void {
  diagramFrame(g, w, h, 'Lay your phones like this');
  const n = tb.owners.length;
  const pw = n >= 4 ? 120 : 130;
  const step = pw + 62;
  const tableW = Math.max(520, n * step + 120);
  diagramTable(g, w / 2, 404, tableW, 380);
  tb.owners.forEach((o, k) => {
    const s = tb.seats[o] as MinigameSeat;
    const x = w / 2 + (k - (n - 1) / 2) * step;
    diagramPhone(g, x, 380, pw, s.color, 0, tb.cpu[o] ? 'cpu' : ready.has(o) ? 'ready' : 'waiting');
    g.font = `700 32px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = onDark(s.color, 0.2);
    g.fillText(s.name, x, 545, step - 10);
  });
  const ink = CARD.soft;
  g.font = `500 30px ${FONT}`;
  g.fillStyle = ink;
  g.textAlign = 'center';
  const lines =
    n === 1
      ? ['Screen up, in the middle, where everyone can reach it.']
      : ['Side by side, screens up,', 'left to right as you face the TV.'];
  lines.forEach((l, i) => g.fillText(l, w / 2, 650 + i * 42));
  const cpus = tb.seats.flatMap((s, p) => (tb.cpu[p] && !tb.owners.includes(p) ? [s] : []));
  const y = 650 + lines.length * 42 + 14;
  if (demo) colourLine(g, w / 2, y, [{ text: 'Everyone plays on the big screen this time.', color: ink }], 30);
  else if (cpus.length) colourLine(g, w / 2, y, [...nameList(cpus, ink), { text: ` ${cpus.length === 1 ? 'plays' : 'play'} from the big screen.`, color: ink }], 30);
  if (!demo) colourLine(g, w / 2, h - 52, [{ text: 'Tap your phone once it’s down.', color: CARD.accent }], 32);
}

// ------------------------------------------------------------------ sounds

function flipSound(ctx: MinigameContext, back: boolean): void {
  noise(ctx.sfx, { dur: 0.06, filter: 'bandpass', freq: back ? 1200 : 1900, to: back ? 700 : 1200, gain: back ? 0.06 : 0.1 });
  tone(ctx.sfx, { freq: back ? 220 : 280, to: back ? 170 : 210, dur: 0.07, type: 'triangle', gain: 0.05 });
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'tablememory',
  title: 'Coffee Table Memory',
  how: 'Lay your phones side by side: they’re one big table of face-down coasters with snacks underneath. On your go, tap any two, on any phone. A pair is yours and you go again. Most pairs wins!',
  controller: 'table',
  kind: 'table',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const cpu = seats.map((s) => session.isCpu(s.index));
    const skills = seats.map((_, p) => (cpu[p] ? ctx.skill() : 0.5));
    const people = seats.flatMap((_, p) => (cpu[p] ? [] : [p]));
    const demo = people.length === 0;
    // Only phones that are really on the table hold coasters (all of them in a demo with nobody at the table).
    const owners = demo ? seats.map((_, p) => p) : people;
    const phoneOf = new Map(owners.map((p, k) => [seats[p]?.index ?? -1, k] as const));
    const first = Math.floor(rng() * n);
    const game = newMemory(n, owners.length, first, rng);
    const minds: (CpuMemory | null)[] = seats.map((_, p) => (cpu[p] ? newCpuMemory(skills[p] ?? 0.5) : null));
    const tb: Table = { seats, cpu, owners };
    const view = new MemoryRoom(
      seats,
      await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))),
      owners.length,
    );
    ctx.stage.setView(view);
    const stream = new SceneStream(session);
    const b = game.board;

    // ---------------------------------------------------------------- laying the phones out
    const waitingLine = (ready: ReadonlySet<number>) => {
      const left = people.filter((p) => !ready.has(p)).map((p) => seats[p]?.name ?? '?');
      return left.length ? `Waiting for ${left.join(', ')}` : 'Here we go!';
    };
    const paintRow = (ready: ReadonlySet<number>) => {
      view.overlay.draw((g, w, h) => drawRow(g, w, h, tb, ready, demo));
      owners.forEach((p, k) => {
        const s = rowScene(tb, k, cpu[p] === true || ready.has(p), null);
        view.phones[k]?.paint(s.items, s.bg);
      });
    };
    view.overlay.show(true);
    ui.live(null);
    await arrangePhones(ctx, stream, {
      people,
      hint: (p) => {
        const k = owners.indexOf(p);
        if (owners.length === 1) return 'Lay your phone flat on the coffee table, screen up, where everyone can reach it. Then tap the screen.';
        const name = (j: number) => seats[owners[j] ?? 0]?.name ?? '?';
        const spot =
          k === 0
            ? `Yours goes on the far left as you face the TV, ${name(1)}’s next to it.`
            : k === owners.length - 1
              ? `Yours goes on the far right as you face the TV, after ${name(k - 1)}’s.`
              : `Yours is ${ordinal(k + 1)} from the left as you face the TV, between ${name(k - 1)}’s and ${name(k + 1)}’s.`;
        return `Lay the phones flat in a row, side by side, screens up, tops towards the TV. ${spot} Then tap your screen.`;
      },
      scene: (p, ready) => rowScene(tb, owners.indexOf(p), true, waitingLine(ready)),
      paint: paintRow,
      caption: demo ? 'Coffee Table Memory: the computer players play on the big screen' : 'Lay the phones in a row like this, then tap them',
      onReady: (p) => view.companions[p]?.react('approval', 1.2),
    });
    view.overlay.show(false);

    // ---------------------------------------------------------------- playing
    let now = 0;
    let note = '';
    let overlay: { text: string; color: string } | null = null;
    let phase: 'count' | 'play' | 'end' = 'count';
    let cpuPlan: { card: number; at: number } | null = null;
    let judgeAt: number | null = null;
    let lastNudge = -9;
    const name = (p: number) => seats[p]?.name ?? '?';
    const color = (p: number) => seats[p]?.color ?? '#ffffff';
    const seatOf = (p: number) => seats[p]?.index ?? -1;
    const rectOf = (card: number) => cardRect(b.grid, cardPlace(b, card).slot);
    const where = (card: number, lift = 0) => view.cardAt(card, b.perPhone, rectOf(card), lift);

    const describe = () => {
      const p = game.turn;
      if (game.match === true) return `A pair! ${name(p)} goes again`;
      if (game.match === false) return 'Not a pair';
      if (cpu[p]) return `${name(p)} is choosing…`;
      const left = MEMORY.turnTime - (now - game.turnStart);
      if (left < 4) return `Quick! ${Math.max(1, Math.ceil(left))}…`;
      return game.picks.length ? 'And one more…' : 'Tap any two coasters, on any phone';
    };
    const draw = (force = false) => {
      const m: Moment = { now, note: phase === 'play' ? describe() : note, overlay };
      owners.forEach((p, k) => {
        const items = playScene(tb, game, k, m);
        view.phones[k]?.paint(items, BG);
        if (!cpu[p]) stream.send(seatOf(p), items, BG, force);
      });
    };
    let liveKey = '';
    const live = () => {
      const rows = seats.map((s, p) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${p === game.turn && !game.over ? '▸ ' : ''}${game.pairs[p] ?? 0} ${game.pairs[p] === 1 ? 'pair' : 'pairs'}` }));
      const key = rows.map((r) => r.value).join('|');
      if (key !== liveKey) {
        liveKey = key;
        ui.live(rows);
      }
    };
    const startGo = (p: number, again: boolean, slow: boolean) => {
      cpuPlan = null;
      view.setTurn(p);
      if (!cpu[p]) {
        session.send(seatOf(p), { t: 'buzz', pattern: again ? [20] : [40] });
        if (!again) session.send(seatOf(p), { t: 'feedback', good: true, text: 'Your go: tap two coasters' });
      }
      const word = slow ? `Too slow! ${name(p)}’s go` : again ? `${name(p)} goes again` : cpu[p] ? `${name(p)}’s go` : `${name(p)}’s go: tap two coasters on any phone`;
      ui.caption(word, color(p));
      if (!again) sfx.tick();
    };

    const flip = (card: number) => {
      const p = game.turn;
      const r = pick(game, card, now);
      if (!r.ok) return;
      flipSound(ctx, false);
      const face = b.cards[card]?.face ?? 0;
      for (const m of minds) if (m) notice(m, card, face, now, rng);
      view.point(p, where(card), !cpu[p]);
      if (r.second) judgeAt = now + MEMORY.flip;
    };

    const judge = () => {
      const p = game.turn;
      const [a, c] = game.picks;
      if (game.match) {
        sfx.good();
        if (a !== undefined && c !== undefined) view.floaters.add('Pair!', color(p), where(a, 0.5).lerp(where(c, 0.5), 0.5), 0.45, 1.1);
        view.companions[p]?.react('happy', 1.4);
        if (!cpu[p]) {
          session.send(seatOf(p), { t: 'buzz', pattern: [20, 40, 20] });
          session.send(seatOf(p), { t: 'feedback', good: true, text: 'A pair! Go again' });
        }
      } else {
        tone(sfx, { freq: 330, to: 250, dur: 0.18, type: 'triangle', gain: 0.06 });
        view.companions[p]?.react('thinking', 1.2);
      }
    };

    const handle = (e: MemoryEvent) => {
      switch (e.t) {
        case 'pair': {
          const at = view.addPair(e.player, game.pairs[e.player] ?? 1);
          view.floaters.add('+1', color(e.player), at, 0.5, 1.2);
          tone(sfx, { freq: 784, dur: 0.12, gain: 0.07 });
          tone(sfx, { freq: 1046, dur: 0.2, gain: 0.07, delay: 0.09 });
          view.point(e.player, null);
          break;
        }
        case 'miss':
          flipSound(ctx, true);
          view.point(e.player, null);
          break;
        case 'go':
          startGo(e.player, e.again, e.slow);
          break;
        case 'over':
          phase = 'end';
          break;
      }
    };

    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'touch' || msg.phase !== 'down' || phase !== 'play') return;
      const k = phoneOf.get(seat);
      if (k === undefined) return;
      const slot = cardAt(b.grid, msg.x, msg.y);
      if (slot === null) return;
      if (cpu[game.turn]) {
        if (now - lastNudge > 1.5) {
          lastNudge = now;
          session.send(seat, { t: 'feedback', good: false, text: `It’s ${name(game.turn)}’s go` });
        }
        return;
      }
      flip(k * b.perPhone + slot);
    });

    view.setTurn(game.turn);
    draw(true);
    await countIn(ctx, (word) => {
      overlay = word ? { text: word, color: SCREEN.cream } : null;
      draw(true);
    });
    phase = 'play';
    game.turnStart = 0;
    startGo(game.turn, false, false);
    let endAt: number | null = null;
    let hudAt = -1;
    await everyFrame(clock, (dt) => {
      now += dt;
      if (phase === 'play') {
        if (judgeAt !== null && now >= judgeAt) {
          judgeAt = null;
          judge();
        }
        for (const e of stepMemory(game, now, !cpu[game.turn])) handle(e);
        const p = game.turn;
        const mind = minds[p];
        if (phase === 'play' && mind && game.resolveAt === null && game.picks.length < 2) {
          const lastFlip = game.picks.length ? (b.cards[game.picks[0] as number]?.flipAt ?? now) : -9;
          if (!cpuPlan && now - lastFlip >= MEMORY.flip) {
            const card = cpuChoose(mind, game, now, rng);
            if (card !== null) {
              cpuPlan = { card, at: now + cpuDelay(skills[p] ?? 0.5, game.picks.length === 1, rng) };
              view.point(p, where(card));
            }
          } else if (cpuPlan && now >= cpuPlan.at) {
            const card = cpuPlan.card;
            cpuPlan = null;
            flip(card);
          }
        }
      }
      if (phase === 'end' && endAt === null) endAt = now;
      draw();
      if (now - hudAt > 0.15) {
        hudAt = now;
        ui.timer(phase === 'play' ? Math.max(0, MEMORY.duration - now) : null);
        live();
      }
      return endAt !== null;
    });
    off();
    ui.timer(null);

    // ---------------------------------------------------------------- the end
    const best = Math.max(...game.pairs);
    const top = seats.flatMap((_, p) => ((game.pairs[p] ?? 0) === best ? [p] : []));
    const cleared = game.board.cards.every((c) => c.state === 'taken');
    const head = cleared ? 'All found!' : 'Time’s up!';
    if (top.length === 1 && best > 0) {
      const w = top[0] as number;
      overlay = { text: `${name(w)} wins!`, color: onDark(color(w), 0.15) };
      ui.caption(`${head} ${name(w)} wins with ${best} ${best === 1 ? 'pair' : 'pairs'}`, color(w));
    } else {
      overlay = { text: best > 0 ? 'A tie!' : head, color: SCREEN.cream };
      ui.caption(best > 0 ? `${head} A tie at ${best} ${best === 1 ? 'pair' : 'pairs'}` : head);
    }
    note = head;
    draw(true);
    sfx.fanfare();
    view.setTurn(-1);
    view.companions.forEach((c, p) => {
      const won = top.includes(p) && best > 0;
      c.setBase(won ? 'happy' : 'idle');
      if (won) c.react('happy', 3);
    });
    seats.forEach((s, p) => {
      if (!cpu[p]) session.send(s.index, { t: 'feedback', good: top.includes(p), text: top.includes(p) && best > 0 ? 'You win!' : `${game.pairs[p] ?? 0} ${game.pairs[p] === 1 ? 'pair' : 'pairs'}` });
    });
    live();
    // Keep drawing a moment, so a coaster that was turning back finishes turning.
    await everyFrame(clock, (dt, t) => {
      now += dt;
      draw();
      return t >= 2.6;
    });
    ui.caption(null);
    return {
      scores: memoryScores(game),
      details: seats.map((_, p) => {
        const k = game.pairs[p] ?? 0;
        return `${k} ${k === 1 ? 'pair' : 'pairs'}`;
      }),
    };
  },
};
