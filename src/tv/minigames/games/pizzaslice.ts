// Slice It Fair on the TV: a late-night kitchen table with a pizza for everyone, each on a wooden board in their
// colour, and the order chalked up at the back. Your fader swings a pizza wheel round from the 12 o'clock line,
// the slice it would make glowing in your colour. Cut! When everyone has cut, the slices lift out with their size,
// and the order's line shows in gold on every pizza.
import * as THREE from 'three';
import { type Order, SLICE, cpuCut, cutError, cutPoints, knifeAngle, planOrders, sliceScores, sliceShare } from '../../../game/minigames/pizzaslice';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, lanes, noise, tone } from '../kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ROUNDED_FONT, ball, box, canvasTexture, cyl, mix, nameCard, part, pill, popSprite, rbox, seeded, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SPACING = 3.5;
const BOARD_R = 1.45;
const BOARD_TOP = 0.16;
const DOUGH_R = 1.2;
const SAUCE_R = 1.08;
const CHEESE_R = 1.0;
const CRUST_R = 1.12;
const CRUST_TUBE = 0.11;
const COMP_Z = -2.4;
const HEIGHT = 1.35;
const TILT = 0.9;
const TAU = Math.PI * 2;

const DOUGH = '#e0b070';
const CRUST = '#c98f52';
const SAUCE = '#b8452f';
const CHEESE = '#f0c868';
const MOZZ = '#f7e6b8';
const GOLD = P.lamp;
const DRESS = 5; // the foundation's props, scaled up: the pizzas are as big as the companions are tall

/** Scales a foundation prop, and the reach of the lamp inside it, to this scene's size. */
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

/** The direction of a clockwise angle from 12 o'clock, seen from above (12 o'clock is away from the camera). */
const dirOf = (a: number, r = 1) => new THREE.Vector3(Math.sin(a) * r, 0, -Math.cos(a) * r);
const pct = (share: number) => Math.round(share * 100);

// ------------------------------------------------------------------ sounds

function chop(sfx: Sfx): void {
  noise(sfx, { dur: 0.14, filter: 'bandpass', freq: 2600, to: 900, gain: 0.22 });
  tone(sfx, { freq: 260, to: 150, dur: 0.09, type: 'triangle', gain: 0.07 });
}

// ------------------------------------------------------------------ pizza pieces

interface Topping {
  a: number;
  r: number;
  kind: 'pepperoni' | 'olive' | 'basil' | 'mozz';
  spin: number;
}

function toppingsFor(seed: number): Topping[] {
  const rand = seeded(seed);
  const out: Topping[] = [];
  const kinds: Topping['kind'][] = ['pepperoni', 'pepperoni', 'pepperoni', 'pepperoni', 'pepperoni', 'pepperoni', 'pepperoni', 'olive', 'olive', 'olive', 'olive', 'olive', 'basil', 'basil', 'basil', 'basil', 'mozz', 'mozz', 'mozz', 'mozz', 'mozz'];
  for (const kind of kinds) {
    for (let k = 0; k < 30; k++) {
      const a = rand() * TAU;
      const r = 0.22 + Math.sqrt(rand()) * 0.62;
      const p = dirOf(a, r);
      if (out.every((o) => dirOf(o.a, o.r).distanceTo(p) > (kind === 'pepperoni' || o.kind === 'pepperoni' ? 0.34 : 0.22))) {
        out.push({ a, r, kind, spin: rand() * TAU });
        break;
      }
    }
  }
  return out;
}

/** A flat sector from clockwise angle a0 to a1, `h` thick, lying on y = 0. */
function wedgeGeo(r: number, h: number, a0: number, a1: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const steps = Math.max(2, Math.ceil(((a1 - a0) / TAU) * 64));
  shape.moveTo(0, 0);
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    shape.lineTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); // shape y becomes -z (12 o'clock), the extrusion goes up
  return g;
}

interface Piece {
  group: THREE.Group;
  /** Geometry made for this piece only (disposed with it). */
  own: THREE.BufferGeometry[];
}

/** The pizza (or the part of it) between clockwise angles a0 and a1. */
function pizzaPiece(toppings: readonly Topping[], a0: number, a1: number): Piece {
  const group = new THREE.Group();
  const own: THREE.BufferGeometry[] = [];
  if (a1 - a0 >= TAU - 1e-6) {
    part(group, cyl(DOUGH_R, DOUGH_R, 0.1, 44), DOUGH, 0, 0.05, 0);
    part(group, cyl(SAUCE_R, SAUCE_R, 0.04, 44), SAUCE, 0, 0.11, 0, { outline: false, gloss: 0.3 });
    part(group, cyl(CHEESE_R, CHEESE_R, 0.05, 44), CHEESE, 0, 0.13, 0, { outline: false, gloss: 0.2 });
    part(group, torus(CRUST_R, CRUST_TUBE), CRUST, 0, 0.12, 0, { rx: Math.PI / 2, gloss: 0.15 });
  } else {
    const wedge = (r: number, h: number) => {
      const g = wedgeGeo(r, h, a0, a1);
      own.push(g);
      return g;
    };
    part(group, wedge(DOUGH_R, 0.1), DOUGH, 0, 0, 0);
    part(group, wedge(SAUCE_R, 0.13), SAUCE, 0, 0, 0, { outline: false, gloss: 0.3 });
    part(group, wedge(CHEESE_R, 0.155), CHEESE, 0, 0, 0, { outline: false, gloss: 0.2 });
    const arc = new THREE.TorusGeometry(CRUST_R, CRUST_TUBE, 10, Math.max(3, Math.ceil(((a1 - a0) / TAU) * 48)), a1 - a0);
    own.push(arc);
    part(group, arc, CRUST, 0, 0.12, 0, { rx: Math.PI / 2, rz: a0 - Math.PI / 2, gloss: 0.15 });
    for (const a of [a0, a1]) {
      const p = dirOf(a, CRUST_R);
      part(group, ball(CRUST_TUBE, 2), CRUST, p.x, 0.12, p.z, { outline: false });
    }
  }
  for (const t of toppings) {
    if (t.a < a0 || t.a >= a1) continue;
    const p = dirOf(t.a, t.r);
    if (t.kind === 'pepperoni') {
      part(group, cyl(0.15, 0.15, 0.05, 16), '#a83a2a', p.x, 0.18, p.z, { outline: 0.018, gloss: 0.3 });
      part(group, cyl(0.1, 0.1, 0.052, 12), '#b94a34', p.x, 0.181, p.z, { outline: false, shadow: false });
    } else if (t.kind === 'olive') part(group, torus(0.055, 0.028), P.charcoal, p.x, 0.18, p.z, { rx: Math.PI / 2, outline: false, gloss: 0.5 });
    else if (t.kind === 'mozz') part(group, ball(0.15, 1), MOZZ, p.x, 0.158, p.z, { sx: 1, sy: 0.14, sz: 0.8, ry: t.spin, outline: false, shadow: false });
    else part(group, ball(0.11, 1), P.fern, p.x, 0.17, p.z, { sx: 1, sy: 0.22, sz: 0.55, ry: t.spin, outline: false });
  }
  return { group, own };
}

function dropPiece(p: Piece | null): void {
  if (!p) return;
  p.group.removeFromParent();
  p.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !p.own.includes(m.geometry)) return;
    for (const c of m.children) if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).geometry.dispose(); // its outline hull
  });
  for (const g of p.own) g.dispose();
}

/** The order, chalked on a little board. */
function orderBoard(text: string, round: number, rounds: number): THREE.Sprite {
  const tex = canvasTexture(1024, 300, (ctx, w, h) => {
    ctx.fillStyle = P.walnut;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 46);
    ctx.fill();
    ctx.fillStyle = mix(P.forest, P.ink, 0.45);
    ctx.beginPath();
    ctx.roundRect(22, 22, w - 44, h - 44, 30);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(241,231,214,0.65)';
    ctx.font = `600 44px ${ROUNDED_FONT}`;
    ctx.fillText(`Order ${round + 1} of ${rounds}`, w / 2, 84);
    ctx.fillStyle = P.cream;
    ctx.font = `700 84px ${ROUNDED_FONT}`;
    ctx.fillText(`“${text}”`, w / 2, 186, w - 90);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(5.6, (5.6 * 300) / 1024, 1);
  return s;
}

// ------------------------------------------------------------------ the kitchen table

interface Rig {
  seat: MinigameSeat;
  companion: Companion;
  /** Board centre; everything on the board hangs off this. */
  root: THREE.Group;
  knife: THREE.Group;
  noon: THREE.Group;
  wheel: THREE.Mesh;
  /** The slice your knife would make, glowing. */
  fan: THREE.Mesh;
  fanGeo: THREE.BufferGeometry;
  goal: THREE.Group;
  toppings: Topping[];
  whole: Piece | null;
  slice: Piece | null;
  rest: Piece | null;
  /** The fader value shown (eased towards `value`). */
  shown: number;
  value: number;
  /** The slice's lift, 0..1. */
  lift: number;
  pop: number;
}

const FAN_STEPS = 64;

class PizzaKitchen implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly rigs: Rig[] = [];
  readonly floaters: Floaters;
  private readonly fit: CameraFit;
  private readonly marks: Mark[] = [];
  private board: THREE.Sprite | null = null;
  private readonly boardAt: THREE.Vector3;
  private readonly tick: (dt: number, time: number) => void;
  private readonly dressing = new THREE.Group();
  private time = 0;

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    // Evening lamplight; the pendant lamp over the table does the rest.
    lightRig(this.scene, 'lampInterior', { fog: { near: 30, far: 80 }, shadowSize: 13 });
    this.floaters = new Floaters(this.scene);
    this.fit = new CameraFit(this.camera, TILT);

    const n = seats.length;
    const xs = lanes(n, SPACING);
    const width = n * SPACING + 5;
    this.buildRoom(width);
    this.scene.add(this.dressing);
    this.tick = props.tickProps(this.dressing);

    seats.forEach((seat, i) => {
      const x = xs[i] ?? 0;
      const c = companions[i] as Companion;
      c.root.position.set(x, 0, COMP_Z);
      c.setBase('thinking');
      this.scene.add(c.root);

      // The board in the seat's colour, with a handle towards us and the name in front.
      part(this.scene, cyl(BOARD_R, BOARD_R, BOARD_TOP, 44), P.oak, x, BOARD_TOP / 2, 0, { tex: 'wood' });
      part(this.scene, torus(BOARD_R - 0.02, 0.05), seat.color, x, BOARD_TOP - 0.02, 0, { rx: Math.PI / 2, glow: 0.5, outline: false });
      part(this.scene, rbox(0.42, 0.12, 0.55, 0.05), P.oak, x, 0.07, BOARD_R + 0.2, { tex: 'wood' });
      part(this.scene, cyl(0.07, 0.07, 0.13, 12), seat.color, x, 0.08, BOARD_R + 0.36, { outline: false, gloss: 0.4 });
      const card = nameCard(seat.name, seat.color, 0.9);
      card.position.set(x, 0.28, BOARD_R + 0.85);
      this.scene.add(card);

      const root = new THREE.Group();
      root.position.set(x, BOARD_TOP, 0);
      this.scene.add(root);

      // The 12 o'clock line, scored into the cheese.
      const noon = new THREE.Group();
      for (let k = 0; k < 4; k++) part(noon, rbox(0.045, 0.02, 0.16, 0.01), P.cream, 0, 0.2, -0.16 - k * 0.24, { outline: false, shadow: false });
      root.add(noon);

      // The knife: a glowing line and a pizza wheel at the rim.
      const knife = new THREE.Group();
      part(knife, rbox(0.05, 0.03, DOUGH_R + 0.1, 0.012), seat.color, 0, 0.24, -(DOUGH_R + 0.1) / 2, { glow: 0.8, shadow: false });
      const wheel = part(knife, cyl(0.2, 0.2, 0.04, 24), P.ceramic, 0, 0.24, -DOUGH_R - 0.28, { rz: Math.PI / 2, gloss: 0.7 });
      part(knife, ball(0.06, 1), seat.color, 0.03, 0.24, -DOUGH_R - 0.28, { outline: false });
      part(knife, pill(0.06, 0.45), seat.color, 0, 0.5, -DOUGH_R - 0.5, { rx: -0.75, gloss: 0.4 });
      root.add(knife);

      const fanGeo = new THREE.BufferGeometry();
      fanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((FAN_STEPS + 2) * 3), 3));
      const index: number[] = [];
      for (let k = 0; k < FAN_STEPS; k++) index.push(0, k + 1, k + 2);
      fanGeo.setIndex(index);
      const fan = new THREE.Mesh(fanGeo, new THREE.MeshBasicMaterial({ color: seat.color, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      fan.position.y = 0.26;
      fan.renderOrder = 2;
      fan.frustumCulled = false;
      root.add(fan);

      const goal = new THREE.Group();
      part(goal, rbox(0.07, 0.03, DOUGH_R + 0.3, 0.012), GOLD, 0, 0.3, -(DOUGH_R + 0.3) / 2, { glow: 1, shadow: false });
      part(goal, ball(0.09, 1), GOLD, 0, 0.3, -DOUGH_R - 0.3, { glow: 1, shadow: false });
      goal.visible = false;
      root.add(goal);

      this.rigs.push({ seat, companion: c, root, knife, noon, wheel, fan, fanGeo, goal, toppings: [], whole: null, slice: null, rest: null, shown: 0, value: 0, lift: 0, pop: 1 });
      this.marks.push(
        { p: new THREE.Vector3(x - BOARD_R, 0, -BOARD_R - 0.6) },
        { p: new THREE.Vector3(x + BOARD_R, 0, -BOARD_R - 0.6) },
        { p: new THREE.Vector3(x - BOARD_R, 0.28, BOARD_R + 0.85), pad: 0.06 },
        { p: new THREE.Vector3(x + BOARD_R, 0.28, BOARD_R + 0.85), pad: 0.06 },
        { p: new THREE.Vector3(x, HEIGHT + 1.2, COMP_Z) },
      );
    });
    this.boardAt = new THREE.Vector3(0, HEIGHT + 1.9, COMP_Z - 0.6);
    this.marks.push({ p: this.boardAt.clone().add(new THREE.Vector3(-2.8, 0.75, 0)) }, { p: this.boardAt.clone().add(new THREE.Vector3(2.8, 0.75, 0)) });
  }

  /** The table, the tiled wall behind it, and late-night things around the boards. */
  private buildRoom(width: number): void {
    const s = this.dressing;
    // A dark wooden table, so the pizzas are the brightest things on it, and a woven runner under the boards.
    part(s, box(width + 14, 0.4, 11), P.walnut, -1, -0.2, -0.6, { tex: 'wood', texScale: 2.4, outline: false });
    part(s, rbox(width + 13, 0.03, 4.3, 0.01), mix(P.forest, P.ink, 0.42), -1, 0.012, 0.3, { tex: 'fabric', outline: false, shadow: false });
    for (const z of [-1.72, 2.32]) part(s, box(width + 13, 0.032, 0.07), P.brass, -1, 0.012, z, { outline: false, shadow: false });
    // The back wall: tiles to shoulder height, plaster above.
    part(s, box(width + 26, 3.3, 0.3), mix(P.teal, P.ink, 0.25), -1, 1.65, -6.4, { tex: 'kitchenTile', texScale: 5, gloss: 0.3, outline: false, shadow: false });
    part(s, box(width + 26, 0.16, 0.4), P.walnut, -1, 3.36, -6.36, { tex: 'wood', outline: false, shadow: false });
    part(s, box(width + 26, 9, 0.3), P.duskWall, -1, 7.9, -6.42, { tex: 'plaster', outline: false, shadow: false });
    // The pendant lamp over the table.
    const lamp = sized(props.pendantLamp({ drop: 0.5, r: 0.3, shade: P.terracotta, lit: true, light: 5 }), DRESS * 0.9);
    lamp.position.set(-3.4, 8.6, -3.6);
    s.add(lamp);
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, k = 1) => {
      sized(o, DRESS * k);
      o.position.set(x, 0, z);
      o.rotation.y = ry;
      s.add(o);
    };
    // Along the back of the table, behind the companions.
    const half = width / 2;
    put(props.pizzaBox({ open: false }), half - 1.2, -4.7, 0.2, 0.9);
    put(props.pizzaBox({ open: false }), half - 1.0, -4.75, -0.12, 0.9);
    (s.children[s.children.length - 1] as THREE.Object3D).position.y = 0.25;
    put(props.jar({ color: P.terracotta, h: 0.14 }), half - 4.4, -5.0);
    put(props.jar({ color: P.olive, h: 0.18 }), half - 5.3, -5.15);
    put(props.candle({ h: 0.1 }), half - 6.6, -4.6, 0, 0.8);
    put(props.plant({ kind: 'trailing', h: 0.26, pot: P.terracotta, seed: 3 }), -half + 5.2, -5.1);
    put(props.drink({ kind: 'bottle', color: P.forest }), -half + 3.6, -5.0);
    put(props.drink({ kind: 'bottle', color: P.copper }), -half + 2.8, -5.3);
    put(props.candle({ h: 0.14 }), -half + 1.4, -4.7, 0, 0.8);
    put(props.plates({ n: 4, r: 0.12 }), -half - 0.6, -4.4);
    // At the ends, and in the front corners.
    put(props.mug({ color: P.teal }), -half - 1.6, -1.9, 0.9);
    put(props.snackBowl({ fill: 'crisps', color: P.ceramic, seed: 4 }), -half - 3.0, 0.2, 0, 0.9);
    put(props.drink({ kind: 'can', color: P.rose }), -half - 1.9, 1.9);
    put(props.candle({ h: 0.08 }), -half - 0.9, 3.2, 0, 0.8);
    put(props.mug({ color: P.terracotta }), half + 0.3, -2.2, -0.6);
    put(props.plates({ n: 2, r: 0.11 }), half + 0.6, 2.6);
  }

  /** Fresh pizzas slide in for a new order. */
  serve(round: number, order: Order, rounds: number): void {
    this.rigs.forEach((r, i) => {
      dropPiece(r.whole);
      dropPiece(r.slice);
      dropPiece(r.rest);
      r.slice = null;
      r.rest = null;
      r.toppings = toppingsFor(round * 11 + i * 3 + 7);
      r.whole = pizzaPiece(r.toppings, 0, TAU);
      r.root.add(r.whole.group);
      r.value = 0;
      r.shown = 0;
      r.lift = 0;
      r.pop = 0;
      r.knife.visible = true;
      r.noon.visible = true;
      r.fan.visible = true;
      r.goal.visible = false;
      r.goal.rotation.y = -knifeAngle(order.share);
    });
    if (this.board) {
      this.scene.remove(this.board);
      this.board.material.map?.dispose();
      this.board.material.dispose();
    }
    this.board = orderBoard(order.text, round, rounds);
    this.board.position.copy(this.boardAt);
    this.scene.add(this.board);
  }

  /** Cuts seat i's pizza at fader value v: the slice and the rest come apart a little. */
  cut(i: number, v: number): void {
    const r = this.rigs[i];
    if (!r) return;
    const a = knifeAngle(v);
    r.value = v;
    r.shown = v;
    dropPiece(r.whole);
    r.whole = null;
    if (a > 0.01) {
      r.slice = pizzaPiece(r.toppings, 0, a);
      r.root.add(r.slice.group);
    }
    if (a < TAU - 0.01) {
      r.rest = pizzaPiece(r.toppings, a, TAU);
      r.root.add(r.rest.group);
    }
    r.knife.visible = false;
    r.noon.visible = false;
    r.fan.visible = false;
    r.pop = Math.min(r.pop, 0.72); // the board gives a little jump as the wheel comes down
    const mid = a / 2;
    r.slice?.group.position.copy(dirOf(mid, 0.06));
    r.rest?.group.position.copy(dirOf(mid + Math.PI, 0.04));
  }

  label(i: number, text: string, color: string, size = 0.55): THREE.Sprite | null {
    const r = this.rigs[i];
    if (!r) return null;
    const mid = knifeAngle(r.value) / 2;
    const s = popSprite(text, color, size);
    s.position.copy(r.root.position).add(dirOf(mid, 0.55));
    s.position.y += 1.25;
    this.scene.add(s);
    return s;
  }

  dispose(): void {
    for (const r of this.rigs) {
      r.companion.dispose();
      dropPiece(r.whole);
      dropPiece(r.slice);
      dropPiece(r.rest);
      r.fanGeo.dispose();
      (r.fan.material as THREE.Material).dispose();
    }
    if (this.board) {
      this.board.material.map?.dispose();
      this.board.material.dispose();
    }
    this.floaters.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.tick(dt, time);
    this.fit.update(() => this.marks);
    this.floaters.update(dt);
    for (const r of this.rigs) {
      r.companion.update(dt);
      // New pizzas pop onto the board.
      if (r.pop < 1) {
        r.pop = Math.min(1, r.pop + dt * 2.6);
        const k = Math.max(0.001, ease.outBack(r.pop));
        r.root.scale.setScalar(k);
      }
      // The knife eases after the fader, the wheel rolls as it goes.
      const before = r.shown;
      r.shown += (r.value - r.shown) * (1 - Math.exp(-dt * 16));
      const a = knifeAngle(r.shown);
      r.knife.rotation.y = -a;
      r.wheel.rotation.x += (r.shown - before) * 40;
      if (r.fan.visible) {
        const pos = r.fanGeo.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, 0, 0, 0);
        for (let k = 0; k <= FAN_STEPS; k++) {
          const p = dirOf((a * k) / FAN_STEPS, DOUGH_R + 0.02);
          pos.setXYZ(k + 1, p.x, 0, p.z);
        }
        pos.needsUpdate = true;
      }
      // The lifted slice floats a little.
      if (r.slice && r.lift > 0) {
        const mid = knifeAngle(r.value) / 2;
        const out = dirOf(mid, 0.06 + 0.5 * r.lift);
        r.slice.group.position.set(out.x, r.lift * (0.75 + Math.sin(this.time * 2.2 + r.seat.index) * 0.05), out.z);
      }
    }
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'pizzaslice',
  title: 'Slice It Fair',
  how: 'An order comes in for everyone ("A third, please"). Slide to swing your knife round from 12 o’clock, then hit Cut! The slice closest to the order scores most.',
  controller: 'slider',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const skill = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : 0.5));
    const orders = planOrders(rng);
    const view = new PizzaKitchen(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    const points = seats.map(() => 0);
    const totalErr = seats.map(() => 0);
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${points[i]} pts` })));
    live();

    let accepting = false;
    let cuts: (number | null)[] = seats.map(() => null);
    const doCut = (seat: number, v: number) => {
      if (!accepting || cuts[seat] !== null) return;
      cuts[seat] = v;
      view.cut(seat, v);
      chop(sfx);
      const c = view.rigs[seat]?.companion;
      c?.setBase('listening');
      c?.react('approval', 1.2);
      if (!session.isCpu(seat)) {
        session.send(seat, { t: 'buzz', pattern: [30] });
        session.setLayout(seat, { kind: 'wait', title: 'Cut!', text: 'Watch the big screen…' });
      }
    };
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'slider' || seat >= n || session.isCpu(seat) || !accepting || cuts[seat] !== null) return;
      const r = view.rigs[seat];
      if (r) r.value = msg.value;
      if (msg.done) doCut(seat, msg.value);
    });

    for (let round = 0; round < orders.length; round++) {
      const order = orders[round] as Order;
      cuts = seats.map(() => null);
      view.serve(round, order, orders.length);
      seats.forEach((_, i) => view.rigs[i]?.companion.setBase('thinking'));
      sfx.whoosh();
      session.setLayoutAll(() => ({
        kind: 'slider',
        note: `Order ${round + 1} of ${orders.length}: “${order.text}”. Swing your knife, then Cut!`,
        low: 'None',
        high: 'Whole pizza',
        done: 'Cut!',
        value: 0,
      }));
      ui.caption(`“${order.text}”`);
      const cpu = seats.map((_, i) => {
        if (!session.isCpu(i)) return null;
        const plan = cpuCut(rng, order.share, skill[i] ?? 0.5);
        return { ...plan, wander: (rng() < 0.5 ? -1 : 1) * (0.04 + rng() * 0.08) };
      });
      accepting = true;
      let lastTick = Math.ceil(SLICE.cutTime);
      await everyFrame(clock, (dt, t) => {
        cpu.forEach((p, i) => {
          const r = view.rigs[i];
          if (!p || !r || cuts[i] !== null) return;
          // Swing past it, think again, settle, cut.
          const aim = t < p.at * 0.55 ? p.value + p.wander : p.value;
          r.value += (Math.max(0, Math.min(1, aim)) - r.value) * (1 - Math.exp(-dt * 3.2));
          if (t >= p.at) doCut(i, p.value);
        });
        const left = SLICE.cutTime - t;
        ui.timer(left);
        if (left <= 3 && Math.ceil(left) < lastTick) {
          lastTick = Math.ceil(left);
          sfx.tick();
        }
        return t >= SLICE.cutTime || cuts.every((c) => c !== null);
      });
      // Anyone still thinking is cut where their knife is.
      cuts.forEach((c, i) => {
        if (c === null) doCut(i, view.rigs[i]?.value ?? 0);
      });
      accepting = false;
      ui.timer(null);

      // The reveal: slices lift out with their size, the order's line in gold.
      const served = cuts.map((c) => sliceShare(c ?? 0));
      const errors = served.map((s) => cutError(s, order.share));
      const pts = cutPoints(errors);
      session.setLayoutAll(() => ({ kind: 'wait', title: 'Let’s see those slices…' }));
      await clock.wait(0.35);
      sfx.whoosh();
      const labels: THREE.Sprite[] = [];
      await clock.tween(0.6, (k) => view.rigs.forEach((r) => (r.lift = k)), ease.outBack);
      view.rigs.forEach((r, i) => {
        r.goal.visible = true;
        const best = pts[i] === SLICE.points[0];
        const l = view.label(i, `${pct(served[i] ?? 0)}%`, best ? GOLD : '#ffffff');
        if (l) labels.push(l);
      });
      tone(sfx, { freq: 660, dur: 0.12, gain: 0.12 });
      tone(sfx, { freq: 990, dur: 0.18, gain: 0.1, delay: 0.1 });
      const winners = seats.filter((_, i) => pts[i] === SLICE.points[0]).map((s) => s.name);
      ui.caption(`${order.label} is ${pct(order.share)}%. Closest: ${winners.join(' & ')}!`, GOLD);
      await clock.wait(0.8);
      pts.forEach((p, i) => {
        points[i] = (points[i] ?? 0) + p;
        totalErr[i] = (totalErr[i] ?? 0) + (errors[i] ?? 0);
        const r = view.rigs[i];
        const seat = seats[i] as MinigameSeat;
        if (r && p > 0) view.floaters.add(`+${p}`, seat.color, r.root.position.clone().add(new THREE.Vector3(0, 2.2, 0.4)), 0.55, 1.4);
        const c = r?.companion;
        if (p === SLICE.points[0]) c?.react('happy', 2);
        else if (p === 0) c?.react('sad', 1.6);
        session.setLayout(i, {
          kind: 'wait',
          title: p > 0 ? `+${p} point${p > 1 ? 's' : ''}` : 'No points this time',
          text: `You served ${pct(served[i] ?? 0)}%. The order was ${pct(order.share)}%.`,
        });
      });
      if (pts.some((p) => p === SLICE.points[0])) sfx.good();
      live();
      await clock.wait(1.9);
      for (const l of labels) {
        l.removeFromParent();
        l.material.map?.dispose();
        l.material.dispose();
      }
    }
    off();
    ui.timer(null);
    ui.caption(null);
    seats.forEach((_, i) => view.rigs[i]?.companion.setBase('idle'));
    return {
      scores: sliceScores(points, totalErr),
      details: points.map((p, i) => `${p} pts · ${Math.round(((totalErr[i] ?? 0) / orders.length) * 100)}% off on average`),
    };
  },
};

