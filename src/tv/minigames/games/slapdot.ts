// Slap Dot on the TV: the same late-night living room, a round coffee table with the phones lying in a circle on it,
// tops to the middle, and everyone's companion standing behind their phone. A warm glowing dot rolls from phone to
// phone in a little arc (a big arc when it jumps across), burns its fuse on whoever's phone it lands on, and pops
// if they're too slow. The phone screens are mirrored on the TV; the dot itself is a glowing ball above them.
import * as THREE from 'three';
import { type Companion, buildCompanion } from '../../../companion/kit';
import {
  type CpuHand,
  SLAP,
  type SlapEvent,
  type SlapGame,
  aliveOf,
  circleAngle,
  cpuSlaps,
  dotState,
  edgeToward,
  newCpuHand,
  newSlap,
  nextAlive,
  slap,
  slapScores,
  stepSlap,
} from '../../../game/minigames/slapdot';
import { type CompanionLook, DEFAULT_LOOK, SEAT_COLORS } from '../../../shared/look';
import type { SceneItem } from '../../../shared/protocol';
import { FONT, PALETTE as P, ball, mix, nameCard, toonMat, torus } from '../../render/toon';
import type { View } from '../../stage';
import { ordinal } from '../../ui';
import { CameraFit, Floaters, type Mark, SceneStream, noise, tone } from '../kit';
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
  onDark,
  overlayItems,
  readyPill,
  screenBg,
} from '../table-kit';
import { type Minigame, type MinigameContext, everyFrame } from '../types';

const PHONE_W = 1.2;
const INNER = 0.9; // from the middle of the table to the phones' top edges
const SCREEN_L = (PHONE_W * 16) / 9;
const RING = INNER + 0.15 + SCREEN_L / 2; // the screens' middles
const TABLE_R = INNER + SCREEN_L + 0.3 + 0.35;
const STAND = TABLE_R + 0.75; // companions stand this far out
const HEIGHT = 1.35;
const TILT = 1.0;
const DOT_R = 0.17;
const DOT_LIFT = 0.2;
const ASPECT = 9 / 16;
/** The dot: warm lamp light when it lands, glowing redder as its fuse burns down. */
const WARM = '#ffc978';
const HOT = '#f0614c';
const FRESH = '#9fcf8a';

interface Player {
  name: string;
  color: string;
  look: CompanionLook;
  thumb: string | null;
  /** The session seat, or null for a made-up computer player (someone playing alone). */
  seat: number | null;
}

interface Flash {
  text: string;
  color: string;
  until: number;
}

// ------------------------------------------------------------------ what a phone shows

interface Look {
  g: SlapGame;
  now: number;
  players: readonly Player[];
  flash: readonly (Flash | null)[];
  overlay: string | null;
  playing: boolean;
}

const bgOf = (color: string) => screenBg(color, 0.84);

/** The fuse burning round the pad, as a line from the top going clockwise. */
function fuseRing(left: number): SceneItem {
  const pts: number[] = [];
  const steps = Math.max(2, Math.round(48 * left));
  const r = 0.37;
  for (let k = 0; k <= steps; k++) {
    const a = -Math.PI / 2 + (k / steps) * Math.PI * 2 * left;
    pts.push(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r * ASPECT);
  }
  return { s: 'line', pts, stroke: left > 0.5 ? mix(FRESH, WARM, (1 - left) * 2) : mix(WARM, HOT, 1 - left * 2), lw: 0.032 };
}

/** What phone p shows that the TV mirrors too: name and lives, the pad, the fuse, who's next, and any big word. */
function stillItems(l: Look, p: number): SceneItem[] {
  const g = l.g;
  const me = l.players[p] as Player;
  const items: SceneItem[] = [{ s: 'text', x: 0.06, y: 0.055, text: me.name, size: 0.07, fill: onDark(me.color), align: 'left' }];
  for (let k = 0; k < SLAP.lives; k++) {
    items.push({ s: 'text', x: 0.92 - k * 0.085, y: 0.057, text: '♥', size: 0.08, fill: k < (g.lives[p] ?? 0) ? '#e8788c' : '#3d3549' });
  }
  const out = g.outAt[p] !== null;
  items.push(
    { s: 'circle', x: 0.5, y: 0.5, r: 0.3, fill: mix(me.color, SCREEN.night, 0.55), alpha: 0.4 },
    { s: 'circle', x: 0.5, y: 0.5, r: 0.3, stroke: onDark(me.color, 0.2), lw: 0.008, alpha: 0.6 },
    { s: 'circle', x: 0.5, y: 0.5, r: 0.37, stroke: SCREEN.cream, lw: 0.004, alpha: 0.14 },
  );
  const d = g.dot;
  const mine = d && d.to === p && !out;
  if (mine && l.playing) {
    const st = dotState(d, l.now);
    if (!st.rolling) {
      items.push(fuseRing(st.left), { s: 'text', x: 0.5, y: 0.8, text: 'Slap!', size: 0.13, fill: SCREEN.cream });
    }
  }
  if (!out && l.playing && aliveOf(g).length > 1) {
    const next = nextAlive(g, p);
    const e = edgeToward(p, next, g.n);
    e.y = Math.min(0.86, Math.max(0.12, e.y));
    const them = l.players[next] as Player;
    const ix = Math.min(0.8, Math.max(0.2, e.x + (0.5 - e.x) * 0.16));
    const iy = e.y + (0.5 - e.y) * 0.1;
    items.push(
      { s: 'circle', x: e.x, y: e.y, r: 0.028, fill: them.color },
      { s: 'text', x: ix, y: iy + 0.035, text: `${them.name} next`, size: 0.036, fill: onDark(them.color, 0.35), alpha: 0.85, bold: false },
    );
  }
  if (!mine && !out && l.playing) items.push({ s: 'text', x: 0.5, y: 0.93, text: 'Slap your phone when the dot lands', size: 0.042, fill: SCREEN.soft, bold: false });
  if (out) {
    items.push(
      { s: 'rect', x: 0.5, y: 0.5, w: 1, h: 1, fill: SCREEN.night, alpha: 0.6 },
      { s: 'text', x: 0.5, y: 0.47, text: 'Out', size: 0.2, fill: SCREEN.cream, alpha: 0.85 },
      { s: 'text', x: 0.5, y: 0.56, text: 'Watch the big screen', size: 0.05, fill: SCREEN.soft, bold: false },
    );
  }
  const f = l.flash[p];
  if (f && l.now < f.until) items.push(...overlayItems(f.text, f.color, 0.3, 0.12));
  if (l.overlay) items.push(...overlayItems(l.overlay, SCREEN.cream, 0.5, 0.15));
  return items;
}

/** The dot on phone p (on the TV it's a glowing ball instead): rolling in from its edge, sitting, rolling off. */
function dotItems(l: Look, p: number): SceneItem[] {
  const d = l.g.dot;
  if (!d || !l.playing) return [];
  const st = dotState(d, l.now);
  const ball = (x: number, y: number, r: number, hot: number): SceneItem[] => [
    { s: 'circle', x, y, r: r * 1.9, fill: mix(WARM, HOT, hot), alpha: 0.16 },
    { s: 'circle', x, y, r: r * 1.4, fill: mix(WARM, HOT, hot), alpha: 0.32 },
    { s: 'circle', x, y, r, fill: mix('#fff0cf', '#ffb39f', hot), stroke: mix(WARM, HOT, hot), lw: 0.012 },
  ];
  if (d.to === p) {
    if (!st.rolling) {
      const pulse = 1 + Math.sin(l.now * (8 + 16 * (1 - st.left))) * 0.08;
      return ball(0.5, 0.5, 0.11 * pulse, 1 - st.left);
    }
    if (st.k < 0.55) return [];
    const e = edgeToward(p, d.from, l.g.n);
    const u = 1 - (1 - (st.k - 0.55) / 0.45) ** 2;
    return ball(e.x + (0.5 - e.x) * u, e.y + (0.5 - e.y) * u, 0.08, 0);
  }
  if (d.from === p && st.rolling && st.k < 0.45) {
    const e = edgeToward(p, d.to, l.g.n);
    const u = (st.k / 0.45) ** 2;
    return ball(0.5 + (e.x - 0.5) * u, 0.5 + (e.y - 0.5) * u, 0.08, 0);
  }
  return [];
}

/** Phone p while the phones are laid out: whose it is, who goes either side, Ready once it's tapped. */
function circleScene(players: readonly Player[], cpu: readonly boolean[], p: number, ready: boolean, waiting: string | null): { items: SceneItem[]; bg: string } {
  const me = players[p] as Player;
  const n = players.length;
  const ink = SCREEN.soft;
  const tag = (q: number) => `${players[q]?.name ?? '?'}${cpu[q] ? ' (TV)' : ''}`;
  const items: SceneItem[] = [
    { s: 'text', x: 0.5, y: 0.13, text: me.name, size: 0.12, fill: onDark(me.color, 0.2) },
    { s: 'text', x: 0.5, y: 0.2, text: 'Top of the phone to the middle', size: 0.05, fill: SCREEN.cream, bold: false },
  ];
  // A little circle of everyone, seen from above, the TV at the top.
  const cy = 0.43;
  items.push({ s: 'circle', x: 0.5, y: cy, r: 0.25, fill: CARD.wood, stroke: CARD.woodEdge, lw: 0.006, alpha: 0.9 });
  for (let q = 0; q < n; q++) {
    const a = circleAngle(q, n);
    const x = 0.5 + Math.sin(a) * 0.17;
    const y = cy - Math.cos(a) * 0.17 * ASPECT;
    const s = players[q] as Player;
    items.push({ s: 'circle', x, y, r: q === p ? 0.05 : 0.038, fill: s.color, stroke: SCREEN.cream, lw: q === p ? 0.012 : 0.006, alpha: cpu[q] ? 0.55 : 1 });
    const lx = 0.5 + Math.sin(a) * 0.36;
    const ly = cy - Math.cos(a) * 0.36 * ASPECT;
    items.push({ s: 'text', x: lx, y: ly, text: s.name, size: 0.04, fill: onDark(s.color) });
  }
  if (n === 2) items.push({ s: 'text', x: 0.5, y: 0.7, text: `${tag(1 - p)} across from you`, size: 0.045, fill: ink, bold: false });
  else {
    items.push(
      { s: 'text', x: 0.5, y: 0.69, text: `On your left: ${tag((p + 1) % n)}`, size: 0.045, fill: ink, bold: false },
      { s: 'text', x: 0.5, y: 0.735, text: `On your right: ${tag((p + n - 1) % n)}`, size: 0.045, fill: ink, bold: false },
    );
  }
  items.push(...readyPill(0.82, ready, 'Tap when it’s down'));
  if (ready && waiting) items.push({ s: 'text', x: 0.5, y: 0.9, text: waiting, size: 0.042, fill: ink, bold: false });
  return { items, bg: screenBg(me.color) };
}

// ------------------------------------------------------------------ the diagram

function drawCircle(g: CanvasRenderingContext2D, w: number, h: number, players: readonly Player[], cpu: readonly boolean[], ready: ReadonlySet<number>, demo: boolean): void {
  diagramFrame(g, w, h, 'Lay your phones like this');
  const n = players.length;
  const cx = w / 2;
  const cy = 380;
  const tr = 175;
  diagramTable(g, cx, cy, tr * 2, tr * 2, true);
  // Which way the dot goes round.
  g.strokeStyle = CARD.accent;
  g.lineWidth = 7;
  g.lineCap = 'round';
  const ar = tr + 26;
  const a0 = -Math.PI / 2 - 0.5;
  const a1 = -Math.PI / 2 + 0.5;
  g.beginPath();
  g.arc(cx, cy, ar, a0, a1);
  g.stroke();
  const tip = { x: cx + Math.cos(a1) * ar, y: cy + Math.sin(a1) * ar };
  g.beginPath();
  g.moveTo(tip.x - 20, tip.y - 18);
  g.lineTo(tip.x, tip.y);
  g.lineTo(tip.x - 26, tip.y + 8);
  g.stroke();
  for (let p = 0; p < n; p++) {
    const s = players[p] as Player;
    const a = circleAngle(p, n);
    const r = 92;
    const x = cx + Math.sin(a) * r;
    const y = cy - Math.cos(a) * r;
    diagramPhone(g, x, y, 62, s.color, a + Math.PI, cpu[p] ? 'cpu' : ready.has(p) ? 'ready' : 'waiting');
    const lr = tr + 62;
    g.font = `700 32px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = onDark(s.color, 0.2);
    const lx = cx + Math.sin(a) * lr * 1.25;
    const ly = cy - Math.cos(a) * lr;
    g.fillText(s.name, lx, ly, 230);
    if (cpu[p] && !demo) {
      g.font = `500 22px ${FONT}`;
      g.fillStyle = CARD.soft;
      g.fillText('on the TV', lx, ly + 30);
    }
  }
  const ink = CARD.soft;
  g.font = `500 30px ${FONT}`;
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.fillText('In a circle, tops to the middle, in this order.', w / 2, 704);
  g.fillText('The dot goes round the arrow’s way.', w / 2, 746);
  if (!demo) colourLine(g, w / 2, h - 52, [{ text: 'Tap your phone once it’s down.', color: CARD.accent }], 32);
  else colourLine(g, w / 2, h - 52, [{ text: 'Everyone plays on the big screen this time.', color: ink }], 30);
}

// ------------------------------------------------------------------ the room

class SlapRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  readonly overlay: Overlay;
  readonly phones: PhoneOnTable[] = [];
  readonly dot: THREE.Group;
  private readonly dotMat: THREE.MeshToonMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly trailMat: THREE.MeshBasicMaterial;
  private readonly trail: THREE.Mesh[] = [];
  private readonly history: THREE.Vector3[] = [];
  private readonly light: THREE.PointLight;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private ringAge = 9;
  private arc: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number } | null = null;
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private readonly room: Room;

  constructor(
    readonly players: readonly Player[],
    readonly companions: readonly Companion[],
  ) {
    this.room = furnishRoom(this.scene, { r: TABLE_R });
    // A bowl of crisps in the middle, where everyone can reach it (the dot arcs over it).
    this.room.treat('bowl', 0, 0, 0, 1);
    const n = players.length;
    players.forEach((pl, p) => {
      const a = circleAngle(p, n);
      const ph = new PhoneOnTable(PHONE_W);
      ph.place(Math.sin(a) * RING, -Math.cos(a) * RING, Math.PI - a);
      this.scene.add(ph.group);
      this.phones.push(ph);
      const c = companions[p];
      const x = Math.sin(a) * STAND;
      const z = -Math.cos(a) * STAND;
      if (c) {
        c.root.position.set(x, 0, z);
        c.root.rotation.y = -a;
        c.setBase('listening');
        this.scene.add(c.root);
      }
      const card = nameCard(pl.name, pl.color, 0.95);
      card.position.set(x, HEIGHT + 0.4, z);
      this.scene.add(card);
      this.cards.push(card);
      this.marks.push({ p: new THREE.Vector3(x, 0, z) }, { p: card.position.clone(), pad: 0.06 });
    });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      this.marks.push({ p: new THREE.Vector3(Math.sin(a) * TABLE_R, TABLE_Y, Math.cos(a) * TABLE_R) });
    }
    // The dot: a warm glowing ball with a soft halo, a light of its own and a short trail.
    this.dot = new THREE.Group();
    this.dotMat = toonMat({ color: WARM, emissive: new THREE.Color(WARM), emissiveIntensity: 0.9 });
    this.dot.add(new THREE.Mesh(ball(DOT_R, 3), this.dotMat));
    this.glowMat = new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.dot.add(new THREE.Mesh(ball(DOT_R * 1.9, 2), this.glowMat));
    this.light = new THREE.PointLight(P.lamp, 3.5, 4.5, 1.6);
    this.dot.add(this.light);
    this.dot.visible = false;
    this.scene.add(this.dot);
    this.trailMat = new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(ball(DOT_R * (0.8 - k * 0.11), 1), this.trailMat);
      m.visible = false;
      this.scene.add(m);
      this.trail.push(m);
    }
    this.ringMat = new THREE.MeshBasicMaterial({ color: HOT, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(torus(1, 0.05), this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.overlay = new Overlay(this.camera, this.scene);
  }

  /** The middle of phone p's screen (or of the table for -1), `lift` above it. */
  spot(p: number, lift = DOT_LIFT): THREE.Vector3 {
    const ph = this.phones[p];
    return ph ? ph.at(0.5, 0.5, lift) : new THREE.Vector3(0, SCREEN_Y + lift, 0);
  }

  above(p: number): THREE.Vector3 {
    const c = this.companions[p];
    return c ? c.root.position.clone().add(new THREE.Vector3(0, HEIGHT + 0.85, 0)) : new THREE.Vector3(0, 2, 0);
  }

  /** Places the dot: rolling along its arc, or sitting and burning (hot: 0 fresh … 1 about to pop). */
  setDot(at: THREE.Vector3 | null, hot = 0, pulse = 1): void {
    this.dot.visible = at !== null;
    if (!at) {
      this.history.length = 0;
      for (const t of this.trail) t.visible = false;
      return;
    }
    this.dot.position.copy(at);
    this.dot.scale.setScalar(pulse);
    const c = new THREE.Color(WARM).lerp(new THREE.Color(HOT), hot);
    this.dotMat.color.copy(c);
    this.dotMat.emissive.copy(c);
    this.glowMat.color.copy(c);
    this.light.color.copy(c);
    this.history.unshift(at.clone());
    if (this.history.length > 13) this.history.pop();
    this.trail.forEach((t, k) => {
      const h = this.history[(k + 1) * 2];
      t.visible = !!h && h.distanceTo(at) > 0.05;
      if (h) t.position.copy(h);
    });
  }

  /** The pop: a red ring spreading over phone p. */
  pop(p: number): void {
    this.ring.position.copy(this.spot(p, 0.03));
    this.ringAge = 0;
    this.ring.visible = true;
  }

  /** A jump across the circle leaves a soft arc where it went. */
  showArc(curve: THREE.Curve<THREE.Vector3>, life: number): void {
    this.dropArc();
    const mat = new THREE.MeshBasicMaterial({ color: P.glow, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.022, 6, false), mat);
    this.scene.add(mesh);
    this.arc = { mesh, mat, age: 0, life };
  }

  private dropArc(): void {
    if (!this.arc) return;
    this.arc.mesh.removeFromParent();
    this.arc.mesh.geometry.dispose();
    this.arc.mat.dispose();
    this.arc = null;
  }

  update(dt: number, time = 0): void {
    this.fit.update(() => this.marks);
    this.room.update(dt, time);
    for (const c of this.companions) c.update(dt);
    if (this.ring.visible) {
      this.ringAge += dt;
      const k = this.ringAge / 0.45;
      this.ring.scale.setScalar(0.3 + k * 0.9);
      this.ringMat.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) this.ring.visible = false;
    }
    if (this.arc) {
      this.arc.age += dt;
      this.arc.mat.opacity = Math.max(0, 0.7 * (1 - this.arc.age / this.arc.life));
      if (this.arc.age >= this.arc.life) this.dropArc();
    }
    this.floaters.update(dt);
    this.overlay.update(dt);
  }

  dispose(): void {
    this.dropArc();
    this.floaters.dispose();
    this.overlay.dispose();
    for (const p of this.phones) p.dispose();
    for (const c of this.companions) c.dispose();
    for (const card of this.cards) {
      card.removeFromParent();
      card.material.map?.dispose();
      card.material.dispose();
    }
    this.dotMat.dispose();
    this.glowMat.dispose();
    this.trailMat.dispose();
    this.ringMat.dispose();
  }
}

/** The arc a dot rolls along: low between neighbours, high across the circle. */
function rollCurve(view: SlapRoom, from: number, to: number, jump: boolean): THREE.QuadraticBezierCurve3 {
  const a = view.spot(from);
  const b = view.spot(to);
  const mid = a.clone().lerp(b, 0.5);
  mid.y += jump ? 1.5 : 0.35 + a.distanceTo(b) * 0.12;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

// ------------------------------------------------------------------ sounds

function slapSound(ctx: MinigameContext, passes: number): void {
  noise(ctx.sfx, { dur: 0.07, filter: 'lowpass', freq: 1100, to: 240, gain: 0.22 });
  tone(ctx.sfx, { freq: Math.min(900, 420 + passes * 14), dur: 0.07, type: 'triangle', gain: 0.05 });
}

function popSound(ctx: MinigameContext): void {
  noise(ctx.sfx, { dur: 0.18, filter: 'bandpass', freq: 2600, to: 500, gain: 0.22 });
  tone(ctx.sfx, { freq: 200, to: 90, dur: 0.22, gain: 0.12 });
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'slapdot',
  title: 'Slap Dot',
  how: 'Lay your phones in a circle, tops to the middle. When the glowing dot lands on your phone, slap it to send it on, before it pops! It gets quicker each time. A pop or a slap when it isn’t yours costs a life; last one with lives left wins.',
  controller: 'table',
  kind: 'table',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const players: Player[] = seats.map((s) => ({ name: s.name, color: s.color, look: s.look, thumb: s.thumb, seat: s.index }));
    // Someone playing on their own gets a made-up computer player to slap with.
    if (players.length < 2) {
      const taken = new Set(players.map((p) => p.color));
      players.push({ name: players.some((p) => p.name === 'Pip') ? 'Mo' : 'Pip', color: SEAT_COLORS.find((c) => !taken.has(c)) ?? SEAT_COLORS[1], look: DEFAULT_LOOK, thumb: null, seat: null });
    }
    const n = players.length;
    const cpu = players.map((pl) => pl.seat === null || session.isCpu(pl.seat));
    const hands: (CpuHand | null)[] = players.map((pl, p) => (cpu[p] ? newCpuHand(pl.seat === null ? 0.5 : ctx.skill()) : null));
    const people = players.flatMap((_, p) => (cpu[p] ? [] : [p]));
    const demo = people.length === 0;
    const posOf = new Map(players.flatMap((pl, p) => (pl.seat === null ? [] : [[pl.seat, p] as const])));
    const view = new SlapRoom(
      players,
      await Promise.all(players.map((pl) => buildCompanion(pl.look, { height: HEIGHT }))),
    );
    ctx.stage.setView(view);
    const stream = new SceneStream(session);
    const name = (p: number) => players[p]?.name ?? '?';
    const color = (p: number) => players[p]?.color ?? '#ffffff';
    const send = (p: number, msg: Parameters<typeof session.send>[1]) => {
      const seat = players[p]?.seat;
      if (seat !== null && seat !== undefined && !cpu[p]) session.send(seat, msg);
    };

    // ---------------------------------------------------------------- laying the phones out
    const waitingLine = (ready: ReadonlySet<number>) => {
      const left = people.filter((p) => !ready.has(p)).map(name);
      return left.length ? `Waiting for ${left.join(', ')}` : 'Here we go!';
    };
    const by = (q: number, where: string) => (cpu[q] ? `${name(q)} (on the big screen) sits ${where}` : `${name(q)}’s phone goes ${where}`);
    view.overlay.show(true);
    ui.live(null);
    await arrangePhones(ctx, stream, {
      people,
      hint: (p) => {
        const where = n === 2 ? `${by(1 - p, 'across from you')}.` : `${by((p + 1) % n, 'on your left')}; ${by((p + n - 1) % n, 'on your right')}.`;
        return `Lay the phones flat in a circle on the table, tops pointing to the middle. ${where} Then tap your screen.`;
      },
      scene: (p, ready) => circleScene(players, cpu, p, true, waitingLine(ready)),
      paint: (ready) => {
        view.overlay.draw((g, w, h) => drawCircle(g, w, h, players, cpu, ready, demo));
        players.forEach((_, p) => {
          const s = circleScene(players, cpu, p, cpu[p] === true || ready.has(p), null);
          view.phones[p]?.paint(s.items, s.bg);
        });
      },
      caption: demo ? 'Slap Dot: the computer players play on the big screen' : 'Lay the phones in a circle like this, then tap them',
      onReady: (p) => view.companions[p]?.react('approval', 1.2),
    });
    view.overlay.show(false);

    // ---------------------------------------------------------------- playing
    const first = Math.floor(rng() * n);
    const g = newSlap(n, first);
    const flash: (Flash | null)[] = players.map(() => null);
    let now = 0;
    let frameAt = performance.now();
    let playing = false;
    let word: string | null = null;
    let curve: { id: number; c: THREE.QuadraticBezierCurve3 } | null = null;
    let outOrder = 0;
    const look = (): Look => ({ g, now, players, flash, overlay: word, playing });
    const draw = (force = false) => {
      const l = look();
      players.forEach((pl, p) => {
        const still = stillItems(l, p);
        const bg = bgOf(pl.color);
        view.phones[p]?.paint(still, bg);
        if (!cpu[p] && pl.seat !== null) stream.send(pl.seat, [...still, ...dotItems(l, p)], bg, force);
      });
    };
    let liveKey = '';
    const live = () => {
      const rows = players
        .map((pl, p) => ({ name: pl.name, color: pl.color, thumb: pl.thumb, value: g.outAt[p] === null ? '♥'.repeat(g.lives[p] ?? 0) : 'Out', seat: pl.seat }))
        .filter((r) => r.seat !== null)
        .map(({ seat: _seat, ...r }) => r);
      const key = rows.map((r) => r.value).join('|');
      if (key !== liveKey) {
        liveKey = key;
        ui.live(rows);
      }
    };
    const placeDot = () => {
      const d = g.dot;
      if (!d || !playing) {
        view.setDot(null);
        return;
      }
      const st = dotState(d, now);
      if (st.rolling) {
        if (!curve || curve.id !== d.id) curve = { id: d.id, c: rollCurve(view, d.from, d.to, d.jump) };
        view.setDot(curve.c.getPoint(st.k));
        return;
      }
      const hot = 1 - st.left;
      const at = view.spot(d.to, DOT_LIFT + Math.abs(Math.sin(now * (5 + 10 * hot))) * 0.08);
      view.setDot(at, hot, 1 + Math.sin(now * (8 + 16 * hot)) * 0.08 * (0.5 + hot));
    };

    const handle = (events: readonly SlapEvent[]) => {
      for (const e of events) {
        switch (e.t) {
          case 'pass': {
            slapSound(ctx, g.passes);
            view.companions[e.from]?.react('approval', 0.6);
            const d = g.dot;
            if (d && e.jump) {
              curve = { id: d.id, c: rollCurve(view, d.from, d.to, true) };
              view.showArc(curve.c, d.arriveAt - now + 0.5);
              noise(sfx, { dur: 0.3, filter: 'bandpass', freq: 700, to: 1800, gain: 0.06 });
            }
            break;
          }
          case 'land':
            tone(sfx, { freq: 880, dur: 0.05, type: 'sine', gain: 0.04 });
            send(e.p, { t: 'buzz', pattern: [30] });
            view.companions[e.p]?.react('working', 0.8);
            break;
          case 'spawn':
            tone(sfx, { freq: 520, to: 880, dur: 0.18, gain: 0.06 });
            break;
          case 'pop':
            popSound(ctx);
            view.pop(e.p);
            view.floaters.add('Pop!', HOT, view.above(e.p), 0.5, 1.1);
            flash[e.p] = { text: 'Pop!', color: '#ff8a8a', until: now + 1 };
            send(e.p, { t: 'buzz', pattern: [120, 60, 120] });
            view.companions[e.p]?.react('sad', 1.4);
            players.forEach((_, q) => {
              if (q !== e.p && g.outAt[q] === null) view.companions[q]?.react('happy', 0.9);
            });
            break;
          case 'false':
            tone(sfx, { freq: 220, to: 150, dur: 0.22, type: 'triangle', gain: 0.08 });
            view.floaters.add('Not yours!', color(e.p), view.above(e.p), 0.42, 1.1);
            flash[e.p] = { text: 'Not yours!', color: '#ff8a8a', until: now + 1 };
            send(e.p, { t: 'buzz', pattern: [80, 50, 80] });
            view.companions[e.p]?.react('sad', 1);
            break;
          case 'out': {
            outOrder += 1;
            sfx.bad();
            flash[e.p] = null;
            view.companions[e.p]?.setBase('sleeping');
            view.floaters.add('Out!', color(e.p), view.above(e.p).add(new THREE.Vector3(0, 0.5, 0)), 0.5, 1.6);
            ui.caption(`${name(e.p)} is out${outOrder === 1 ? ' first' : ''}`, color(e.p));
            send(e.p, { t: 'feedback', good: false, text: `Out! ${ordinal(e.place)} place` });
            if (!demo && people.every((p) => g.outAt[p] !== null) && aliveOf(g).length > 1) {
              g.hurry = true;
              ui.caption('Just the computer players now: the fuse gets shorter');
            }
            break;
          }
          case 'over':
            playing = false;
            break;
        }
      }
    };

    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'touch' || msg.phase !== 'down' || !playing) return;
      const p = posOf.get(seat);
      if (p === undefined || cpu[p]) return;
      const at = now + Math.max(0, (performance.now() - frameAt) / 1000) * clock.speed;
      handle(slap(g, p, at - (g.slack[p] ?? 0), at, rng));
    });

    players.forEach((_, p) => view.companions[p]?.setBase('listening'));
    draw(true);
    await countIn(ctx, (w) => {
      word = w;
      draw(true);
    });
    playing = true;
    ui.caption('Slap your phone when the dot lands on it!');
    let hudAt = -1;
    let endAt: number | null = null;
    await everyFrame(clock, (dt) => {
      now += dt;
      frameAt = performance.now();
      if (playing) {
        // A phone sees the dot late (the trip there and the stream's pace) and its slap arrives late.
        players.forEach((pl, p) => {
          if (cpu[p] || pl.seat === null) return;
          const lag = Math.min(0.15, (session.seats[pl.seat]?.rtt ?? 0) / 2000);
          g.slack[p] = (2 * lag + 0.05) * clock.speed;
        });
        // Computer players in small steps, so a long frame doesn't make them slow.
        const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        for (let k = 1; k <= steps && playing; k++) {
          const t = now - dt + (k * dt) / steps;
          handle(stepSlap(g, t));
          for (const p of cpuSlaps(g, hands, t, rng)) handle(slap(g, p, t, t, rng));
        }
      } else if (endAt === null && g.over) endAt = now;
      placeDot();
      draw();
      if (now - hudAt > 0.15) {
        hudAt = now;
        ui.timer(playing ? Math.max(0, SLAP.duration - now) : null);
        live();
      }
      return endAt !== null;
    });
    off();
    ui.timer(null);
    view.setDot(null);

    // ---------------------------------------------------------------- the end
    const alive = aliveOf(g);
    const scores = slapScores(g);
    const best = Math.max(...scores);
    const top = players.flatMap((_, p) => (scores[p] === best ? [p] : []));
    const timeUp = now >= SLAP.duration - 0.05 && alive.length > 1;
    if (top.length === 1) {
      const w = top[0] as number;
      word = `${name(w)} wins!`;
      ui.caption(timeUp ? `Time’s up! ${name(w)} has the most lives left` : `${name(w)} is the last one standing!`, color(w));
    } else {
      word = 'A tie!';
      ui.caption(`Time’s up! ${top.map(name).join(' and ')} share it`);
    }
    flash.fill(null);
    draw(true);
    sfx.fanfare();
    players.forEach((_, p) => {
      const c = view.companions[p];
      if (!c) return;
      if (top.includes(p)) {
        c.setBase('happy');
        c.react('happy', 3);
      } else if (g.outAt[p] === null) c.setBase('idle');
      send(p, { t: 'feedback', good: top.includes(p), text: top.includes(p) ? 'You win!' : g.outAt[p] === null ? 'Still in at the end' : 'Good game!' });
    });
    live();
    await clock.wait(2.6);
    ui.caption(null);
    return {
      scores: seats.map((_, p) => scores[p] ?? 0),
      details: seats.map((_, p) => {
        const lives = g.lives[p] ?? 0;
        const out = g.outAt[p];
        if (out === null || out === undefined) {
          const left = `${lives} ${lives === 1 ? 'life' : 'lives'} left`;
          return alive.length === 1 ? `Last one standing · ${left}` : `Still in · ${left}`;
        }
        return `Out at ${out.toFixed(1)} s`;
      }),
    };
  },
};
