// Bubble Wrap on the TV: a cosy living room late at night, with a string of fairy lights across it. Everyone's
// sheet of bubble wrap hangs from the line on two pegs, their companion beside it. The phones are the sheets:
// press a bubble on yours and it pops here too. A sheet that's popped flat rolls up and a fresh one unrolls.
import * as THREE from 'three';
import {
  BUBBLE,
  BUBBLES,
  type CpuThumb,
  type Popper,
  type Sheet,
  bubbleScores,
  bubbleXY,
  cpuPress,
  newCpuThumb,
  newPopper,
  press,
} from '../../../game/minigames/bubblewrap';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { SceneItem } from '../../../shared/protocol';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, cyl, dome, material, mix, nameCard, part, rbox, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, SceneStream, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const ASPECT = 9 / 16; // the phone playfield's width over its height
const K = 2.5; // world units per playfield width
const MID_Y = (bubbleXY(0).y + bubbleXY(BUBBLES - 1).y) / 2;
const R = BUBBLE.r * K;
const SPACING = 4.3; // between sheets
const SHEET_W = 2.6;
const SHEET_H = 3.45;
const LINE_Y = 4.35; // the fairy-light line the sheets hang from
const SHEET_TOP = LINE_Y - 0.1;
const SHEET_CY = SHEET_TOP - SHEET_H / 2;
const HEIGHT = 1.45; // companion height
const COMP_DX = SHEET_W / 2 + 0.7; // companion, right of its sheet
const GRACE = 0.15; // seconds after the end in which presses made in time still arrive

const ROOM = 2.3; // the foundation's living room, scaled up to this scene's size
const WALL_Z = -5;
const SHEET = mix(P.denim, P.midnight, 0.4); // the dark plastic backing the bubbles sit on

const COLORS = {
  plain: mix(P.cream, P.moon, 0.6),
  golden: P.lamp,
  grumpy: mix(P.mauve, P.cream, 0.4),
  cross: P.mauve,
  flat: mix(SHEET, P.ink, 0.3),
  face: P.ink,
} as const;

/** Scales a foundation prop or set, and the reach of the lamps inside it, to this scene's size. */
function sized<T extends THREE.Object3D>(o: T, s: number): T {
  o.scale.multiplyScalar(s);
  o.traverse((c) => {
    const l = c as THREE.PointLight;
    if (!l.isPointLight) return;
    l.distance *= s;
    l.intensity *= s ** l.decay;
  });
  return o;
}

/** A bubble's place on its sheet (the sheet's middle is 0, 0). */
function local(i: number): { x: number; y: number } {
  const b = bubbleXY(i);
  return { x: (b.x - 0.5) * K, y: (-(b.y - MID_Y) / ASPECT) * K };
}

// ------------------------------------------------------------------ sounds

/** The pop: a tiny crisp click with a soft knock under it. */
function popSound(sfx: Sfx, golden: boolean): void {
  noise(sfx, { dur: 0.035, filter: 'bandpass', freq: 2400 + Math.random() * 1600, gain: 0.22 });
  tone(sfx, { freq: 230 + Math.random() * 90, to: 110, dur: 0.06, gain: 0.07 });
  if (golden) tone(sfx, { freq: 1320, to: 1760, dur: 0.2, gain: 0.07, delay: 0.02 });
}

function squeak(sfx: Sfx): void {
  tone(sfx, { freq: 540, to: 380, dur: 0.13, type: 'triangle', gain: 0.06 });
}

// ------------------------------------------------------------------ the living room

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
}

interface Lane {
  x: number;
  /** Pivots at the top of the sheet, so it can roll up and down like a blind. */
  roll: THREE.Group;
  inner: THREE.Group;
  bubbles: THREE.Mesh[];
  faces: { group: THREE.Group; brows: THREE.Group }[];
  /** Which bubble each grumpy face sits on. */
  faceAt: Map<number, number>;
  companion: Companion;
  /** Seconds since a bubble was popped (or squeaked), for its little squash. */
  anims: Map<number, { t: number; pop: boolean }>;
  /** Seconds into a sheet swap (-1: none), and the sheet that unrolls. */
  swap: number;
  next: Sheet | null;
  rings: Ring[];
  ring: number;
}

class LivingRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly lanes: Lane[] = [];
  readonly floaters = new Floaters(this.scene);
  private readonly fit = new CameraFit(this.camera, 0.1);
  private readonly bulbs: THREE.Mesh[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private readonly marks: Mark[] = [];
  private readonly env: Env;
  private time = 0;

  constructor(seats: MinigameSeat[], companions: Companion[], sheets: Sheet[]) {
    const n = seats.length;
    const xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    const span = (n / 2) * SPACING + 1.6;
    // The foundation's living room in the evening, scaled up so its wall fills the frame behind the line; it
    // sits a little left of the sheets, as the camera does (the score list covers the left of the screen).
    const w = Math.max(10, (span * 2 + 6) / ROOM);
    this.env = livingRoom(this.scene, { mood: 'evening', w, d: 6, h: 4.6, rug: false, accent: P.mauve, seed: 3 });
    sized(this.env.root, ROOM);
    const roomX = -1.5;
    this.env.root.position.set(roomX, 0, WALL_Z + 3 * ROOM);
    const cam = this.env.sun.shadow.camera;
    cam.left = cam.bottom = -span - 4;
    cam.right = cam.top = span + 4;
    cam.updateProjectionMatrix();
    const place = (o: THREE.Object3D, x: number, z: number, ry = 0) => {
      o.position.set(x, 0, z);
      o.rotation.y = ry;
      this.scene.add(o);
      return o;
    };
    // A long woolly rug under the line, a sofa against the wall behind it, a low table with late-night things.
    place(props.rug({ w: span * 1.75, d: 5.2, color: P.terracotta, border: mix(P.terracotta, P.cream, 0.5), tex: 'knit' }), 0, 0.7);
    place(sized(props.sofa({ seats: 4, color: P.mauve, pillows: [P.mustard, P.teal, P.terracotta, P.cream] }), ROOM * 1.15), roomX + 1.2, WALL_Z + 0.75 * ROOM);
    const side = place(sized(props.coffeeTable({ w: 1.1, round: true }), ROOM * 0.9), span * 0.6, 5.6);
    const bowl = sized(props.snackBowl({ fill: 'popcorn', color: P.teal }), 1);
    bowl.position.set(0.1, 0.42, 0);
    side.add(bowl);
    const mug = props.mug({ color: P.terracotta });
    mug.position.set(-0.3, 0.42, 0.18);
    side.add(mug);
    place(sized(props.pouf({ color: P.teal }), ROOM), -span * 0.72, 5.4);
    place(sized(props.plant({ kind: 'monstera', h: 0.9, pot: P.ceramic, seed: 5 }), ROOM), -span * 0.98, 4.2);

    withOutline(0.03, () => {
      // Two wooden stands holding the fairy-light line, which droops a touch between them.
      for (const s of [-1, 1]) {
        part(this.scene, cyl(0.07, 0.09, LINE_Y + 0.2, 10), P.walnut, s * span, (LINE_Y + 0.2) / 2, 0, { tex: 'wood' });
        part(this.scene, cyl(0.34, 0.4, 0.1, 18), P.walnut, s * span, 0.05, 0, { tex: 'wood' });
        part(this.scene, sphere(0.13, 14), P.brass, s * span, LINE_Y + 0.25, 0, { gloss: 0.6 });
      }
    });
    const sag = (x: number) => LINE_Y + 0.15 - 0.12 * Math.cos((x / span) * Math.PI * 0.5 * n);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 48; k++) {
      const x = -span + (k / 48) * span * 2;
      pts.push(new THREE.Vector3(x, sag(x), 0));
    }
    this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.02, 6, false), material(P.ink)));
    const bulbColors = [P.lamp, P.glow, P.lamp, mix(P.lamp, P.ember, 0.35)];
    for (let k = 0; k < Math.round(span * 3); k++) {
      const x = -span + 0.3 + (k / (Math.round(span * 3) - 1)) * (span * 2 - 0.6);
      const b = part(this.scene, sphere(0.06, 10), bulbColors[k % bulbColors.length] as string, x, sag(x) - 0.09, 0.03, { glow: 2, outline: false, shadow: false });
      this.bulbs.push(b);
    }

    seats.forEach((s, i) => {
      const x = xs[i] as number;
      const roll = new THREE.Group();
      roll.position.set(x, SHEET_TOP, 0.08);
      const inner = new THREE.Group();
      inner.position.y = -SHEET_H / 2;
      roll.add(inner);
      this.scene.add(roll);
      // The plastic backing: dark, so the bubbles read from the sofa, with a rail in the player's colour on top.
      part(inner, rbox(SHEET_W, SHEET_H, 0.04, 0.03), SHEET, 0, 0, 0, { gloss: 0.3 });
      part(inner, rbox(SHEET_W - 0.12, SHEET_H - 0.12, 0.02, 0.02), mix(SHEET, P.moon, 0.14), 0, -0.02, 0.02, { outline: false, shadow: false });
      part(inner, rbox(SHEET_W + 0.08, 0.15, 0.09, 0.03), s.color, 0, SHEET_H / 2 - 0.05, 0.01, { outline: false, shadow: false, gloss: 0.3 });
      const bubbles: THREE.Mesh[] = [];
      for (let b = 0; b < BUBBLES; b++) {
        const p = local(b);
        bubbles.push(part(inner, dome(R), COLORS.plain, p.x, p.y, 0.035, { rx: Math.PI / 2, shadow: false, gloss: 0.6, outline: 0.012 }));
      }
      const faces: Lane['faces'] = [];
      for (let k = 0; k < BUBBLE.grumpy; k++) {
        const group = new THREE.Group();
        part(group, ball(0.022, 1), COLORS.face, -0.05, 0.03, 0, { outline: false, shadow: false });
        part(group, ball(0.022, 1), COLORS.face, 0.05, 0.03, 0, { outline: false, shadow: false });
        part(group, torus(0.045, 0.011, Math.PI), COLORS.face, 0, -0.07, 0, { outline: false, shadow: false });
        const brows = new THREE.Group();
        part(brows, rbox(0.06, 0.016, 0.01, 0.004), COLORS.face, -0.05, 0.075, 0, { rz: -0.45, outline: false, shadow: false });
        part(brows, rbox(0.06, 0.016, 0.01, 0.004), COLORS.face, 0.05, 0.075, 0, { rz: 0.45, outline: false, shadow: false });
        group.add(brows);
        group.visible = false;
        inner.add(group);
        faces.push({ group, brows });
      }
      // Two wooden pegs on the line.
      for (const side of [-1, 1]) {
        part(this.scene, rbox(0.12, 0.42, 0.14, 0.04), P.oak, x + side * (SHEET_W / 2 - 0.3), SHEET_TOP + 0.04, 0.12, { tex: 'wood', outline: 0.015 });
        part(this.scene, rbox(0.13, 0.05, 0.15, 0.02), P.metal, x + side * (SHEET_W / 2 - 0.3), SHEET_TOP + 0.06, 0.12, { outline: false, gloss: 0.6 });
      }
      const rings: Ring[] = [];
      for (let k = 0; k < 6; k++) {
        const mat = new THREE.MeshBasicMaterial({ color: P.cream, transparent: true, opacity: 0, depthWrite: false });
        const mesh = new THREE.Mesh(torus(1, 0.07), mat);
        mesh.visible = false;
        inner.add(mesh);
        rings.push({ mesh, mat, age: 1 });
      }
      const c = companions[i] as Companion;
      c.root.position.set(x + COMP_DX, 0, 0.7);
      c.root.rotation.y = -0.35;
      c.setBase('working');
      this.scene.add(c.root);
      const card = nameCard(s.name, s.color, 0.8);
      card.position.set(x, SHEET_TOP - SHEET_H - 0.32, 0.3);
      this.scene.add(card);
      this.cards.push(card);
      const lane: Lane = { x, roll, inner, bubbles, faces, faceAt: new Map(), companion: c, anims: new Map(), swap: -1, next: null, rings, ring: 0 };
      this.lanes.push(lane);
      this.paint(lane, sheets[i] as Sheet);
      // What must stay on screen: the sheet, the companion and the name card.
      this.marks.push(
        { p: new THREE.Vector3(x - SHEET_W / 2, SHEET_TOP + 0.3, 0) },
        { p: new THREE.Vector3(x + SHEET_W / 2, SHEET_TOP + 0.3, 0) },
        { p: new THREE.Vector3(x - SHEET_W / 2, SHEET_TOP - SHEET_H, 0) },
        { p: new THREE.Vector3(x + COMP_DX + 0.4, 0, 0.7) },
        { p: new THREE.Vector3(x + COMP_DX + 0.4, HEIGHT + 0.1, 0.7) },
        { p: card.position.clone(), pad: 0.05 },
      );
    });
  }

  /** Shows a whole sheet as it is. */
  paint(l: Lane, sheet: Sheet): void {
    l.anims.clear();
    l.faceAt.clear();
    let face = 0;
    sheet.bubbles.forEach((b, i) => {
      if (b.kind === 'grumpy' && face < l.faces.length) l.faceAt.set(i, face++);
      this.bubble(l, i, b.kind, b.left);
    });
    l.faces.forEach((f, k) => {
      if (k >= face) f.group.visible = false;
    });
  }

  /** One bubble: plump and in its colour, or popped flat. */
  bubble(l: Lane, i: number, kind: Sheet['bubbles'][number]['kind'], left: number): void {
    const mesh = l.bubbles[i];
    if (!mesh) return;
    const popped = left <= 0;
    const cross = kind === 'grumpy' && left < BUBBLE.grumpyTaps;
    mesh.material = popped
      ? material(COLORS.flat)
      : material(kind === 'golden' ? COLORS.golden : kind === 'grumpy' ? (cross ? COLORS.cross : COLORS.grumpy) : COLORS.plain, kind === 'golden' ? { glow: 0.7, gloss: 0.6 } : { gloss: 0.6 });
    mesh.scale.set(1, popped ? 0.18 : 1, 1);
    for (const c of mesh.children) if (c.name === 'outline') c.visible = !popped;
    const k = l.faceAt.get(i);
    const f = k === undefined ? undefined : l.faces[k];
    if (f) {
      const p = local(i);
      f.group.position.set(p.x, p.y, 0.035 + R + 0.004);
      f.group.visible = !popped;
      f.brows.visible = cross;
    }
  }

  /** A press landed: pop (with a ring and a squash), or a grumpy bubble getting cross. */
  pressed(lane: number, i: number, kind: Sheet['bubbles'][number]['kind'], left: number): void {
    const l = this.lanes[lane];
    // While a popped sheet rolls up, the next one is painted as it is when it unrolls.
    if (!l || l.next) return;
    this.bubble(l, i, kind, left);
    const popped = left <= 0;
    l.anims.set(i, { t: 0, pop: popped });
    if (!popped) return;
    const r = l.rings[l.ring] as Ring;
    l.ring = (l.ring + 1) % l.rings.length;
    const p = local(i);
    r.mesh.position.set(p.x, p.y, 0.06);
    r.mat.color.set(kind === 'golden' ? COLORS.golden : P.cream);
    r.age = 0;
    r.mesh.visible = true;
  }

  /** The sheet is popped flat: roll it up and unroll `next`. */
  swapSheet(lane: number, next: Sheet): void {
    const l = this.lanes[lane];
    if (!l) return;
    l.swap = 0;
    l.next = next;
  }

  /** Where a bubble is in the room (for floating words). */
  at(lane: number, i: number): THREE.Vector3 {
    const l = this.lanes[lane];
    const p = local(i);
    return new THREE.Vector3((l?.x ?? 0) + p.x, SHEET_CY + p.y + 0.2, 0.5);
  }

  dispose(): void {
    this.floaters.dispose();
    for (const l of this.lanes) {
      l.companion.dispose();
      for (const r of l.rings) r.mat.dispose();
    }
    for (const c of this.cards) {
      c.material.map?.dispose();
      c.material.dispose();
    }
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.env.update(dt, time);
    this.fit.update(() => this.marks);
    for (const l of this.lanes) {
      l.companion.update(dt);
      for (const [i, a] of l.anims) {
        a.t += dt;
        const mesh = l.bubbles[i];
        if (!mesh) continue;
        if (a.pop) {
          const k = Math.min(1, a.t / 0.14);
          const puff = 1 + Math.sin(k * Math.PI) * 0.28;
          mesh.scale.set(puff, 1 - 0.82 * k, puff);
          if (k >= 1) l.anims.delete(i);
        } else {
          const k = Math.min(1, a.t / 0.3);
          const wob = 1 + Math.sin(k * Math.PI * 4) * 0.12 * (1 - k);
          mesh.scale.set(wob, 1 / wob, wob);
          if (k >= 1) l.anims.delete(i);
        }
      }
      for (const r of l.rings) {
        if (!r.mesh.visible) continue;
        r.age += dt;
        const k = r.age / 0.24;
        r.mesh.scale.setScalar(R * (1 + k * 0.9));
        r.mat.opacity = Math.max(0, 0.85 * (1 - k));
        if (k >= 1) r.mesh.visible = false;
      }
      if (l.swap >= 0) {
        l.swap += dt;
        const k = l.swap / BUBBLE.slide;
        if (k < 0.4) l.roll.scale.y = Math.max(0.001, 1 - k / 0.4);
        else {
          if (l.next) {
            this.paint(l, l.next);
            l.next = null;
          }
          l.roll.scale.y = Math.max(0.001, ease.outBack(Math.min(1, (k - 0.4) / 0.6)));
        }
        if (k >= 1) {
          l.roll.scale.y = 1;
          l.swap = -1;
        }
      }
    }
    this.bulbs.forEach((b, k) => b.scale.setScalar(0.9 + 0.1 * Math.sin(this.time * 1.3 + k * 1.7)));
    this.floaters.update(dt);
  }
}

// ------------------------------------------------------------------ the phone's sheet

const A = ASPECT;

function phoneScene(p: Popper, t: number, color: string, recent: readonly { i: number; at: number; golden: boolean }[], over: boolean): SceneItem[] {
  const items: SceneItem[] = [];
  const left = Math.max(0, Math.ceil(BUBBLE.duration - t));
  items.push(
    { s: 'text', x: 0.06, y: 0.06, text: `${p.score} pts`, size: 0.1, align: 'left', fill: color },
    { s: 'text', x: 0.94, y: 0.06, text: over ? 'Done' : `${left} s`, size: 0.065, align: 'right', fill: '#d8d0ec' },
  );
  const sliding = t < p.readyAt;
  const k = sliding ? Math.max(0, 1 - (p.readyAt - t) / BUBBLE.slide) : 1;
  const dy = -(1 - ease.outCubic(k)) * 0.9;
  items.push({
    s: 'text',
    x: 0.5,
    y: 0.125,
    text: over ? "Time's up!" : sliding ? 'A fresh sheet!' : p.popped < 8 ? 'Gold is worth 3 · grumpy ones need 2' : 'Keep popping!',
    size: 0.04,
    fill: '#b9b0d3',
    bold: false,
  });
  items.push({ s: 'rect', x: 0.5, y: 0.54 + dy, w: 0.97, h: 0.755, radius: 0.04, fill: SHEET, stroke: mix(SHEET, P.moon, 0.45), lw: 0.006 });
  const r = BUBBLE.r;
  const ry = r * A; // the radius as a fraction of the height
  p.sheet.bubbles.forEach((b, i) => {
    const { x, y: by } = bubbleXY(i);
    const y = by + dy;
    if (b.left <= 0) {
      items.push({ s: 'circle', x, y, r: r * 0.9, fill: COLORS.flat, stroke: mix(SHEET, P.moon, 0.12), lw: 0.004 });
      return;
    }
    if (b.kind === 'grumpy') {
      const cross = b.left < BUBBLE.grumpyTaps;
      items.push({ s: 'circle', x, y, r, fill: cross ? COLORS.cross : COLORS.grumpy, stroke: mix(P.mauve, P.ink, 0.35), lw: 0.006 });
      items.push({ s: 'circle', x: x - 0.33 * r, y: y - 0.12 * ry, r: 0.11 * r, fill: COLORS.face });
      items.push({ s: 'circle', x: x + 0.33 * r, y: y - 0.12 * ry, r: 0.11 * r, fill: COLORS.face });
      items.push({ s: 'line', pts: [x - 0.36 * r, y + 0.5 * ry, x, y + 0.28 * ry, x + 0.36 * r, y + 0.5 * ry], stroke: COLORS.face, lw: 0.008 });
      if (cross) {
        items.push({ s: 'line', pts: [x - 0.55 * r, y - 0.55 * ry, x - 0.16 * r, y - 0.36 * ry], stroke: COLORS.face, lw: 0.008 });
        items.push({ s: 'line', pts: [x + 0.55 * r, y - 0.55 * ry, x + 0.16 * r, y - 0.36 * ry], stroke: COLORS.face, lw: 0.008 });
      }
      return;
    }
    const gold = b.kind === 'golden';
    items.push({ s: 'circle', x, y, r, fill: gold ? COLORS.golden : COLORS.plain, stroke: gold ? P.brass : mix(COLORS.plain, P.denim, 0.45), lw: 0.006 });
    items.push({ s: 'circle', x: x - 0.32 * r, y: y - 0.32 * ry, r: 0.26 * r, fill: gold ? P.cream : '#ffffff', alpha: 0.85 });
  });
  for (const pop of recent) {
    const age = t - pop.at;
    if (age < 0 || age > 0.25 || sliding) continue;
    const { x, y } = bubbleXY(pop.i);
    const q = age / 0.25;
    items.push({ s: 'circle', x, y: y + dy, r: r * (1 + 0.8 * q), stroke: pop.golden ? P.lamp : P.cream, lw: 0.008, alpha: 1 - q });
  }
  if (over) {
    items.push({ s: 'rect', x: 0.5, y: 0.54, w: 0.8, h: 0.16, radius: 0.04, fill: P.aubergine, alpha: 0.9 });
    items.push({ s: 'text', x: 0.5, y: 0.525, text: `${p.score} points`, size: 0.09, fill: '#ffffff' });
    items.push({ s: 'text', x: 0.5, y: 0.575, text: 'Watch the big screen', size: 0.045, fill: '#d8d0ec', bold: false });
  }
  return items;
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'bubblewrap',
  title: 'Bubble Wrap',
  how: 'Your phone is a sheet of bubble wrap: press the bubbles to pop them. Golden ones are worth 3, grumpy ones need two presses. Most points in 25 seconds wins!',
  controller: 'table',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const cpu = seats.map((s) => session.isCpu(s.index));
    const skill = seats.map((_, i) => (cpu[i] ? ctx.skill() : 0));
    const seed = Math.floor(rng() * 0xffffffff);
    const poppers = seats.map(() => newPopper(seed));
    const thumbs: CpuThumb[] = seats.map(() => newCpuThumb());
    const recent: { i: number; at: number; golden: boolean }[][] = seats.map(() => []);
    const view = new LivingRoom(
      seats,
      await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))),
      poppers.map((p) => p.sheet),
    );
    ctx.stage.setView(view);
    const stream = new SceneStream(session);
    session.setLayoutAll(() => ({ kind: 'table', hint: 'Hold your phone like a sheet of bubble wrap and press the bubbles!' }));

    let now = 0;
    let frameAt = performance.now();
    const lastCheer = seats.map(() => -9);

    /** A press on seat i's sheet at time t. */
    const onPress = (i: number, x: number, y: number, t: number) => {
      const p = poppers[i] as Popper;
      const r = press(p, x, y, t);
      const seat = seats[i] as MinigameSeat;
      if (r.kind === 'squeak') {
        const b = p.sheet.bubbles[r.index];
        if (b) view.pressed(i, r.index, b.kind, b.left);
        squeak(sfx);
        session.send(seat.index, { t: 'buzz', pattern: [25] });
        return;
      }
      if (r.kind !== 'pop') return;
      const golden = r.bubble === 'golden';
      popSound(sfx, golden);
      session.send(seat.index, { t: 'buzz', pattern: golden ? [15, 30, 15] : [8] });
      const list = recent[i] as { i: number; at: number; golden: boolean }[];
      list.push({ i: r.index, at: t, golden });
      if (list.length > 8) list.shift();
      const c = view.lanes[i]?.companion;
      if (golden) {
        view.floaters.add('+3', '#ffd166', view.at(i, r.index), 0.5, 0.9);
        c?.react('happy', 1.1);
      } else if (t - (lastCheer[i] ?? 0) > 2.5 && Math.random() < 0.15) {
        lastCheer[i] = t;
        c?.react('approval', 0.6);
      }
      view.pressed(i, r.index, r.bubble, 0);
      if (r.cleared) {
        view.swapSheet(i, p.sheet);
        view.floaters.add('Fresh sheet!', seat.color, view.at(i, 25), 0.55, 1.3);
        c?.react('happy', 1.6);
        sfx.whoosh();
        recent[i] = [];
      }
    };

    const off = session.onInput((seatIndex, msg) => {
      if (msg.t !== 'touch' || msg.phase !== 'down') return;
      const i = posOf.get(seatIndex);
      if (i === undefined || cpu[i]) return;
      // When the finger came down, on the game clock: now, minus the message's trip here.
      const raw = now + Math.max(0, (performance.now() - frameAt) / 1000) * clock.speed;
      const lag = Math.min(0.15, (session.seats[seatIndex]?.rtt ?? 0) / 2000) * clock.speed;
      const t = raw - lag;
      if (t > BUBBLE.duration) return;
      onPress(i, msg.x, msg.y, Math.max(0, t));
    });

    ui.caption('Press the bubbles on your phone to pop them!');
    let hudAt = -1;
    await everyFrame(clock, (dt, t) => {
      now = t;
      frameAt = performance.now();
      if (t <= BUBBLE.duration) {
        // Computer players, in small steps so a long frame doesn't slow their thumbs.
        const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        for (let k = 0; k < steps; k++) {
          const st = t - dt + ((k + 1) * dt) / steps;
          for (let i = 0; i < n; i++) {
            if (!cpu[i]) continue;
            const at = cpuPress(thumbs[i] as CpuThumb, poppers[i] as Popper, st, dt / steps, skill[i] ?? 0.5, rng);
            if (at) onPress(i, at.x, at.y, st);
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const s = seats[i] as MinigameSeat;
        if (!cpu[i]) stream.send(s.index, phoneScene(poppers[i] as Popper, Math.min(t, BUBBLE.duration), s.color, recent[i] ?? [], false), P.aubergine);
      }
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(Math.max(0, BUBBLE.duration - t));
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${poppers[i]?.score ?? 0} pts` })));
      }
      return t >= BUBBLE.duration + GRACE;
    });
    off();
    ui.timer(null);
    ui.caption(null);
    seats.forEach((s, i) => {
      if (!cpu[i]) stream.send(s.index, phoneScene(poppers[i] as Popper, BUBBLE.duration, s.color, [], true), P.aubergine, true);
    });
    const best = Math.max(...poppers.map((p) => p.score));
    view.lanes.forEach((l, i) => {
      l.companion.setBase('idle');
      if ((poppers[i]?.score ?? 0) === best) l.companion.react('happy', 3);
    });
    return {
      scores: bubbleScores(poppers),
      details: poppers.map((p) => [`${p.score} pts`, `${p.popped} popped`, ...(p.sheets ? [`${p.sheets} sheet${p.sheets === 1 ? '' : 's'} cleared`] : [])].join(' · ')),
    };
  },
};
