// Takeout Tower on the TV: a rooftop at dusk, the city twinkling all around. Everyone has a little toy
// crane with their companion riding on it, swinging takeout boxes over a delivery bag. Tap to drop: the bit that
// hangs over the edge is snipped off and tumbles to the floor. The cranes (and the camera) rise with the stacks.
import * as THREE from 'three';
import {
  type DropResult,
  type Stack,
  TAKEOUT,
  cpuDropAt,
  drop,
  newStack,
  stacked,
  stepStack,
  swingX,
  takeoutScores,
  topOf,
} from '../../../game/minigames/takeoutstack';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Layout } from '../../../shared/protocol';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { type Env, rooftop } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, cyl, gem, mix, nameCard, part, rbox, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SPACING = 5.2;
const W0 = TAKEOUT.width;
const H = TAKEOUT.height;
const DEPTH = 0.95;
const BASE_Y = 0.5; // top of the delivery bag everything stands on
const ROPE = 2.2; // trolley to hook
const HANG = ROPE + 0.3 + H / 2; // trolley to the middle of the hanging box
const CLEAR = HANG + H / 2 + 0.5; // the jib sits this far above the top of the stack (the box clears it by 0.35)
const MAST_DX = 2.45;
const HEIGHT = 1.0; // companion height (riding on the crane)
const VIEW_H = 7.5; // the camera keeps at least this much height in view
const FALL = 0.2; // seconds a dropped box takes to land
const GRACE = 0.15;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const BOX_COLORS = [P.cream, P.sand, P.linen, P.clay] as const;
const ROOF = 2; // the foundation's rooftop, scaled up to this scene's size
const SETTLE = 0.26; // seconds a landed box takes to squash and settle
const STEEL = P.linen; // the cranes' paint

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

/** Where a box's middle sits when it's the k-th on the stack (1 = the first on the bag). */
const boxY = (k: number) => BASE_Y + (k - 0.5) * H;

// ------------------------------------------------------------------ sounds

function thump(sfx: Sfx): void {
  noise(sfx, { dur: 0.12, filter: 'lowpass', freq: 320, to: 120, gain: 0.4 });
  tone(sfx, { freq: 150, to: 85, dur: 0.12, gain: 0.08 });
}

function snip(sfx: Sfx): void {
  noise(sfx, { dur: 0.09, filter: 'bandpass', freq: 3600, to: 1400, gain: 0.16 });
}

function sparkle(sfx: Sfx, streak: number): void {
  const f = 660 * 2 ** (Math.min(streak - 1, 8) / 6);
  tone(sfx, { freq: f, dur: 0.16, gain: 0.08 });
  tone(sfx, { freq: f * 1.5, dur: 0.22, gain: 0.06, delay: 0.07 });
}

// ------------------------------------------------------------------ boxes

/** A takeout box `w` wide: a paper box with a folded lid and a band in the player's colour. */
function boxMesh(color: string, k: number, w: number): THREE.Group {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.name = 'inner';
  inner.scale.x = Math.max(0.01, w / W0);
  const paper = BOX_COLORS[k % BOX_COLORS.length] as string;
  withOutline(0.022, () => {
    part(inner, rbox(W0, H * 0.84, DEPTH, 0.05), paper, 0, -H * 0.08, 0);
    part(inner, rbox(W0 + 0.02, 0.09, DEPTH + 0.02, 0.03), color, 0, -H * 0.1, 0, { outline: false });
    part(inner, rbox(W0 * 0.96, 0.06, DEPTH * 0.92, 0.03), mix(paper, P.walnut, 0.2), 0, H * 0.37, 0);
    part(inner, rbox(W0 * 0.3, 0.02, 0.05, 0.01), mix(paper, P.walnut, 0.4), 0, H * 0.41, 0, { outline: false, shadow: false });
    part(inner, rbox(W0 * 0.22, H * 0.3, 0.02, 0.01), mix(color, P.ink, 0.15), 0, -H * 0.1, DEPTH / 2 + 0.005, { outline: false, shadow: false });
  });
  g.add(inner);
  return g;
}

function setWidth(g: THREE.Group, w: number): void {
  const inner = g.getObjectByName('inner');
  if (inner) inner.scale.x = Math.max(0.01, w / W0);
}

// ------------------------------------------------------------------ the flat

interface Piece {
  group: THREE.Group;
  vx: number;
  vy: number;
  spin: number;
  settled: boolean;
}

interface Falling {
  group: THREE.Group;
  from: THREE.Vector3;
  rot: number;
  age: number;
  result: DropResult;
  /** Boxes stacked once it lands. */
  n: number;
  streak: number;
}

interface Settle {
  group: THREE.Group;
  y: number;
  age: number;
}

interface Glint {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  age: number;
}

interface Lane {
  x: number;
  color: string;
  stack: Stack;
  boxes: THREE.Group[];
  hanging: THREE.Group | null;
  hangIn: number;
  falling: Falling[];
  pieces: Piece[];
  glints: Glint[];
  mast: THREE.Mesh;
  jib: THREE.Group;
  trolley: THREE.Mesh;
  beacon: THREE.Mesh;
  settles: Settle[];
  rope: THREE.Mesh;
  hook: THREE.Mesh;
  card: THREE.Sprite;
  craneY: number;
  trolleyX: number;
  theta: number;
  companion: Companion;
  /** Boxes made so far (for the paper colours). */
  made: number;
}

class Flat implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 220);
  readonly lanes: Lane[] = [];
  readonly floaters = new Floaters(this.scene);
  /** Seconds since the game started (the stacks' clock). */
  now = 0;
  /** Landings since the game last looked (for sounds and buzzes). */
  readonly events: { lane: Lane; kind: DropResult['kind']; streak: number }[] = [];
  private readonly proxy = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 220);
  private readonly fit = new CameraFit(this.proxy, 0.1);
  private placed = false;
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private readonly dressing = new THREE.Group();

  constructor(seats: MinigameSeat[], companions: Companion[], stacks: Stack[]) {
    const n = seats.length;
    const span = (n / 2) * SPACING + 3;
    // The foundation's rooftop at dusk, with the skyline all round: the camera can climb with the stacks and
    // there is always city behind them. Its own string lights would hang in front of the stacks, so the dressing
    // near the play area is ours.
    const w = Math.max(14, (span * 2 + 6) / ROOF);
    this.env = rooftop(this.scene, { mood: 'evening', w, d: 8, dress: 0.2, seed: 2 });
    sized(this.env.root, ROOF);
    // The skyline is twice as far away now: push the haze back so its windows still twinkle through it.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = 30;
    fog.far = 215;
    const cam = this.env.sun.shadow.camera;
    cam.left = cam.bottom = -span - 5;
    cam.right = cam.top = span + 5;
    cam.updateProjectionMatrix();
    const d = this.dressing;
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, s = ROOF) => {
      sized(o, s);
      o.position.set(x, 0, z);
      o.rotation.y = ry;
      d.add(o);
      return o;
    };
    put(props.rug({ w: span * 1.75, d: 4.8, color: P.terracotta, border: mix(P.terracotta, P.cream, 0.45), tex: 'terry' }), 0.6, 0.5, 0, 1);
    // Lights strung behind the stacks, from a pole on the stair house to one by the water tank.
    const from = new THREE.Vector3(-span - 0.6, 7.4, -3.6);
    const to = new THREE.Vector3(span + 1.6, 7.4, -3.6);
    d.add(props.stringLights(from, to, { sag: 0.55, count: Math.round(span * 2.2), bulb: 0.09 }));
    part(d, cyl(0.05, 0.07, 2.1, 8), P.charcoal, from.x, 6.45, from.z, { outline: false });
    part(d, cyl(0.06, 0.09, 7.5, 8), P.charcoal, to.x, 3.75, to.z, { outline: false });
    const kinds: props.PlantKind[] = ['palm', 'fern', 'monstera', 'snake'];
    [-1, 1].forEach((side, k) => {
      const crate = put(props.crate({ s: 0.55 }), side * (span + 2.6), 4.6, 0.3 * side);
      const plant = props.plant({ kind: kinds[k] as props.PlantKind, h: 1.0, pot: P.charcoal, seed: 4 + k });
      plant.position.y = 0.55;
      crate.add(plant);
      const low = put(props.crate({ s: 0.4 }), side * (span + 4.2), 3.2, -0.2 * side);
      const small = props.plant({ kind: kinds[k + 2] as props.PlantKind, h: 0.6, pot: P.terracotta, seed: 8 + k });
      small.position.y = 0.4;
      low.add(small);
    });
    // Dinner so far, in the foreground: a crate for a table, a candle, an open box, cans, a cushion to sit on.
    const table = put(props.crate({ s: 0.5 }), span * 0.42, 8.2, 0.2);
    const candle = props.candle({ h: 0.12 });
    candle.position.set(0.12, 0.5, -0.1);
    const can = props.drink({ kind: 'can', color: P.teal });
    can.position.set(-0.14, 0.5, 0.08);
    table.add(candle, can);
    put(props.pizzaBox({ open: true, slices: 3 }), span * 0.42 - 2.6, 8.6, -0.4);
    put(props.pouf({ color: P.mustard }), span * 0.42 + 2.8, 7.6);
    put(props.drink({ kind: 'bottle', color: P.forest }), span * 0.42 - 1.3, 7.4);
    const far = put(props.crate({ s: 0.45 }), -span * 0.5, 8.8, -0.3);
    const fern = props.plant({ kind: 'fern', h: 0.7, pot: P.terracotta, seed: 11 });
    fern.position.y = 0.45;
    far.add(fern);
    this.scene.add(d);
    this.tick = props.tickProps(d);

    seats.forEach((seat, i) => {
      const x = (i - (n - 1) / 2) * SPACING;
      // The delivery bag everything stands on.
      withOutline(0.03, () => {
        part(this.scene, rbox(W0, BASE_Y, 1.15, 0.08), seat.color, x, BASE_Y / 2, 0, { gloss: 0.25 });
        part(this.scene, rbox(W0 + 0.02, 0.1, 1.17, 0.03), P.cream, x, BASE_Y * 0.55, 0, { outline: false });
        part(this.scene, rbox(W0 * 0.34, BASE_Y * 0.36, 0.03, 0.02), mix(seat.color, P.ink, 0.3), x, BASE_Y * 0.24, 0.585, { outline: false, shadow: false });
        part(this.scene, torus(0.28, 0.035, Math.PI), mix(seat.color, P.ink, 0.3), x, BASE_Y, 0);
      });
      // The crane: a mast, a jib with a counterweight, a trolley, a rope and a hook.
      const mast = part(this.scene, rbox(0.24, 1, 0.24, 0.05), STEEL, x + MAST_DX, 0.5, -0.3, { gloss: 0.3 });
      part(this.scene, rbox(0.9, 0.2, 0.9, 0.06), P.charcoal, x + MAST_DX, 0.1, -0.3, { tex: 'metalPlate', texStrength: 0.4 });
      part(this.scene, rbox(0.5, 0.14, 0.5, 0.04), P.brass, x + MAST_DX, 0.27, -0.3, { gloss: 0.5, outline: false });
      const jib = new THREE.Group();
      jib.position.set(x + MAST_DX, BASE_Y + CLEAR, -0.3);
      part(jib, rbox(5.0, 0.15, 0.2, 0.05), STEEL, -2.2, 0, 0, { gloss: 0.3 });
      // a tie bar over the jib from a short king post, so it reads as a crane
      part(jib, rbox(0.12, 0.7, 0.12, 0.03), STEEL, 0, 0.4, 0, { outline: false });
      part(jib, cyl(0.02, 0.02, 3.3, 6), P.charcoal, -1.6, 0.4, 0, { rz: Math.PI / 2 + 0.21, outline: false, shadow: false });
      part(jib, rbox(0.55, 0.38, 0.38, 0.06), P.charcoal, 0.5, -0.05, 0, { tex: 'metalPlate', texStrength: 0.4 });
      part(jib, rbox(0.75, 0.1, 0.75, 0.04), P.walnut, 0.05, -1.35, 0.3, { tex: 'planks' });
      part(jib, rbox(0.06, 1.3, 0.06, 0.02), STEEL, 0.05, -0.68, 0.0, { outline: false });
      const beacon = part(jib, sphere(0.07, 10), P.ember, -4.7, 0.13, 0, { glow: 2.2, outline: false, shadow: false });
      const trolley = part(jib, rbox(0.34, 0.18, 0.3, 0.05), P.brass, 0, -0.12, 0, { gloss: 0.5 });
      this.scene.add(jib);
      const rope = part(this.scene, cyl(0.016, 0.016, 1, 6), P.ink, 0, 0, 0, { outline: false, shadow: false });
      const hook = part(this.scene, torus(0.08, 0.022, Math.PI * 1.4), P.metal, 0, 0, 0, { outline: false, gloss: 0.6 });
      const c = companions[i] as Companion;
      c.root.position.set(0.05, -1.3, 0.3);
      c.root.rotation.y = -0.5;
      c.setBase('listening');
      jib.add(c.root);
      const card = nameCard(seat.name, seat.color, 0.8);
      this.scene.add(card);
      const glints: Glint[] = [];
      for (let k = 0; k < 8; k++) {
        const mesh = part(this.scene, gem(0.08), P.lamp, 0, 0, 0, { glow: 2, shadow: false });
        mesh.visible = false;
        glints.push({ mesh, v: new THREE.Vector3(), age: 1 });
      }
      this.lanes.push({
        x,
        color: seat.color,
        stack: stacks[i] as Stack,
        boxes: [],
        hanging: null,
        hangIn: 1,
        falling: [],
        pieces: [],
        glints,
        mast,
        jib,
        trolley,
        beacon,
        settles: [],
        rope,
        hook,
        card,
        craneY: BASE_Y + CLEAR,
        trolleyX: 0,
        theta: Math.asin(TAKEOUT.amp / HANG),
        companion: c,
        made: 0,
      });
    });
  }

  /** A fresh box on lane i's hook. */
  hook(i: number): void {
    const l = this.lanes[i];
    if (!l) return;
    const g = boxMesh(l.color, l.made++, topOf(l.stack).w);
    part(g, torus(0.2, 0.018, Math.PI), P.metal, 0, H / 2 - 0.02, 0, { outline: false, shadow: false }).name = 'handle';
    g.scale.setScalar(0.01);
    this.scene.add(g);
    l.hanging = g;
    l.hangIn = 0;
  }

  /** The box on lane i's hook was let go. */
  dropped(i: number, r: DropResult): void {
    const l = this.lanes[i];
    if (!l || !l.hanging) return;
    const g = l.hanging;
    l.hanging = null;
    g.scale.setScalar(1);
    const handle = g.getObjectByName('handle');
    if (handle) handle.visible = false;
    l.falling.push({ group: g, from: g.position.clone(), rot: g.rotation.z, age: 0, result: r, n: stacked(l.stack), streak: l.stack.streak });
  }

  private land(l: Lane, f: Falling): void {
    const r = f.result;
    if (r.kind === 'miss') {
      // Nothing under it: it carries on down past the stack.
      this.tumble(l, f.group, Math.sign(r.from - topOf(l.stack).x) || 1, 0.4);
      this.floaters.add('Toppled!', l.color, new THREE.Vector3(l.x, boxY(f.n) + 1.2, 0.8), 0.6, 1.6);
      this.events.push({ lane: l, kind: 'miss', streak: 0 });
      return;
    }
    f.group.position.set(l.x + r.box.x, boxY(f.n), 0);
    f.group.rotation.z = 0;
    setWidth(f.group, r.box.w);
    l.boxes.push(f.group);
    l.settles.push({ group: f.group, y: boxY(f.n), age: 0 });
    if (r.kind === 'cut') {
      const piece = boxMesh(l.color, l.made - 1, r.cut.w);
      piece.position.set(l.x + r.cut.x, boxY(f.n), 0);
      this.scene.add(piece);
      this.tumble(l, piece, Math.sign(r.cut.x - r.box.x) || 1, 1);
    } else {
      for (const gl of l.glints) {
        const a = Math.random() * Math.PI * 2;
        gl.mesh.position.set(l.x + r.box.x + Math.cos(a) * r.box.w * 0.4, boxY(f.n) + H * 0.4, Math.sin(a) * 0.4);
        gl.v.set(Math.cos(a) * 1.6, 1.4 + Math.random() * 1.2, Math.sin(a) * 1.2);
        gl.age = 0;
        gl.mesh.visible = true;
      }
      this.floaters.add('Perfect!', P.lamp, new THREE.Vector3(l.x + r.box.x, boxY(f.n) + 0.9, 0.8), 0.45, 1.0);
    }
    this.events.push({ lane: l, kind: r.kind, streak: f.streak });
  }

  /** Sends a box (or a snipped-off piece) tumbling off toward `side`. */
  private tumble(l: Lane, g: THREE.Group, side: number, push: number): void {
    l.pieces.push({ group: g, vx: side * ((0.5 + Math.random() * 0.4) * push + 0.3), vy: 0.6, spin: -side * (3 + Math.random() * 3), settled: false });
    while (l.pieces.length > 12) {
      const old = l.pieces.shift();
      if (old) this.scene.remove(old.group);
    }
  }

  dispose(): void {
    this.floaters.dispose();
    for (const l of this.lanes) {
      l.companion.dispose();
      l.card.material.map?.dispose();
      l.card.material.dispose();
    }
  }

  update(dt: number, time: number): void {
    let hi = 0;
    let lowest = Infinity;
    for (const l of this.lanes) {
      const s = l.stack;
      const top = topOf(s);
      const target = BASE_Y + stacked(s) * H + CLEAR;
      l.craneY += (target - l.craneY) * Math.min(1, dt * 4);
      l.trolleyX += (top.x - l.trolleyX) * Math.min(1, dt * 8);
      hi = Math.max(hi, target);
      if (!s.done) lowest = Math.min(lowest, BASE_Y + stacked(s) * H);
      l.mast.scale.y = l.craneY + 0.25;
      l.mast.position.y = (l.craneY + 0.25) / 2;
      l.jib.position.y = l.craneY;
      l.trolley.position.x = l.x + l.trolleyX - (l.x + MAST_DX);
      l.card.position.set(l.x + 0.2, l.craneY + 0.55, -0.3);
      // The rope swings with the box (and drifts back to the starting side while the crane fetches the next).
      if (l.hanging && s.hookedAt !== null) {
        l.theta = Math.asin(THREE.MathUtils.clamp((swingX(s, this.now) - l.trolleyX) / HANG, -0.95, 0.95));
      } else if (!s.done) {
        const want = Math.asin(THREE.MathUtils.clamp((s.side * TAKEOUT.amp) / HANG, -0.95, 0.95));
        l.theta += (want - l.theta) * Math.min(1, dt * 4);
      } else l.theta *= 1 - Math.min(1, dt * 2);
      const pivot = new THREE.Vector3(l.x + l.trolleyX, l.craneY - 0.15, 0);
      const dir = new THREE.Vector3(Math.sin(l.theta), -Math.cos(l.theta), 0);
      const ropeLen = s.done ? ROPE * 0.6 : ROPE;
      l.rope.scale.y = ropeLen;
      l.rope.position.copy(pivot).addScaledVector(dir, ropeLen / 2);
      l.rope.rotation.z = l.theta;
      l.hook.position.copy(pivot).addScaledVector(dir, ropeLen + 0.06);
      l.hook.rotation.z = l.theta + Math.PI * 1.2;
      if (l.hanging) {
        l.hangIn = Math.min(1, l.hangIn + dt / 0.18);
        l.hanging.scale.setScalar(Math.max(0.01, ease.outBack(l.hangIn)));
        l.hanging.position.copy(pivot).addScaledVector(dir, HANG);
        l.hanging.rotation.z = l.theta;
      }
      // Dropped boxes fall, then land.
      for (let k = l.falling.length - 1; k >= 0; k--) {
        const f = l.falling[k] as Falling;
        f.age += dt;
        const q = Math.min(1, f.age / FALL);
        const toY = f.result.kind === 'miss' ? boxY(f.n + 1) : boxY(f.n);
        f.group.position.y = f.from.y + (toY - f.from.y) * q * q;
        f.group.rotation.z = f.rot * (1 - q);
        if (q >= 1) {
          l.falling.splice(k, 1);
          this.land(l, f);
        }
      }
      // Snipped pieces tumble to the floor in small steps.
      for (const p of l.pieces) {
        if (p.settled) continue;
        let left = dt;
        while (left > 0) {
          const h = Math.min(1 / 120, left);
          left -= h;
          p.vy -= 9.8 * h;
          p.group.position.x += p.vx * h;
          p.group.position.y += p.vy * h;
          p.group.rotateOnAxis(Z_AXIS, p.spin * h);
          if (p.group.position.y < H / 2) {
            p.group.position.y = H / 2;
            p.vy = Math.abs(p.vy) * 0.25;
            p.vx *= 0.5;
            p.spin *= 0.4;
            if (p.vy < 0.4) {
              p.settled = true;
              p.group.rotation.z = Math.round(p.group.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
              break;
            }
          }
        }
      }
      // Landed boxes squash and settle.
      for (let k = l.settles.length - 1; k >= 0; k--) {
        const s = l.settles[k] as Settle;
        s.age += dt;
        const q = Math.min(1, s.age / SETTLE);
        const sy = 1 - 0.22 * (1 - q) * Math.cos(q * 4.7);
        s.group.scale.set(1 + (1 - sy) * 0.5, sy, 1);
        s.group.position.y = s.y - ((1 - sy) * H) / 2;
        if (q >= 1) l.settles.splice(k, 1);
      }
      l.beacon.scale.setScalar(0.75 + 0.25 * Math.sin(time * 2.4 + l.x));
      for (const g of l.glints) {
        if (!g.mesh.visible) continue;
        g.age += dt;
        g.v.y -= 4 * dt;
        g.mesh.position.addScaledVector(g.v, dt);
        g.mesh.rotation.y += dt * 8;
        g.mesh.scale.setScalar(Math.max(0.01, 1 - g.age / 0.6));
        if (g.age > 0.6) g.mesh.visible = false;
      }
      l.companion.update(dt);
    }
    this.env.update(dt, time);
    this.tick(dt, time);
    this.frame(hi, lowest, dt);
    this.floaters.update(dt);
  }

  /** Rises with the tallest stack while keeping every stack that's still going in view. */
  private frame(hi: number, lowest: number, dt: number): void {
    const top = hi + 0.9;
    const bottom = Math.max(0, Math.min(top - VIEW_H, Number.isFinite(lowest) ? lowest - 1.2 : top));
    const left = (this.lanes[0]?.x ?? 0) - 2.4;
    const right = (this.lanes[this.lanes.length - 1]?.x ?? 0) + MAST_DX + 0.9;
    this.proxy.fov = this.camera.fov;
    this.proxy.aspect = this.camera.aspect;
    this.fit.update(() => {
      const marks: Mark[] = [];
      for (const y of [bottom, top]) for (const x of [left, right]) marks.push({ p: new THREE.Vector3(x, y, 0.5) });
      for (const l of this.lanes) marks.push({ p: new THREE.Vector3(l.x + 0.2, l.craneY + 0.55, -0.3), pad: 0.05 });
      return marks;
    }, `${bottom.toFixed(2)}|${top.toFixed(2)}`);
    const k = this.placed ? 1 - Math.exp(-2.5 * dt) : 1;
    this.placed = true;
    this.camera.position.lerp(this.proxy.position, k);
    this.camera.quaternion.slerp(this.proxy.quaternion, k);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'takeoutstack',
  title: 'Takeout Tower',
  how: 'A takeout box swings on your crane: tap to drop it on your stack. Whatever hangs over the edge gets snipped off, so line it up! Tallest stack after 30 seconds wins.',
  controller: 'tap',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const cpu = seats.map((s) => session.isCpu(s.index));
    const skill = seats.map((_, i) => (cpu[i] ? ctx.skill() : 0));
    const stacks = seats.map(() => newStack());
    const cpuAt = seats.map(() => Infinity);
    const view = new Flat(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), stacks);
    ctx.stage.setView(view);
    const layout = (i: number, l: Layout) => {
      const s = seats[i] as MinigameSeat;
      if (!cpu[i]) session.setLayout(s.index, l);
    };
    seats.forEach((_, i) => layout(i, { kind: 'tap', locked: true, note: 'Here comes your first box…' }));

    let now = 0;
    let frameAt = performance.now();
    let over = false;
    let lastDrop = 0;

    const onDrop = (i: number, t: number) => {
      const s = stacks[i] as Stack;
      const r = drop(s, t);
      if (!r) return;
      lastDrop = now;
      cpuAt[i] = Infinity;
      view.dropped(i, r);
      const n = stacked(s);
      const comp = view.lanes[i]?.companion;
      if (r.kind === 'miss') {
        comp?.setBase('sad');
        layout(i, { kind: 'wait', title: 'Toppled!', text: `Your tower: ${n} box${n === 1 ? '' : 'es'} high. Watch the others…` });
        session.send((seats[i] as MinigameSeat).index, { t: 'buzz', pattern: [120, 60, 120] });
        return;
      }
      if (r.kind === 'perfect') comp?.react('happy', 1.0);
      else if (r.cut.w > W0 * 0.25) comp?.react('thinking', 1.0);
      const note = r.kind === 'perfect' ? `Perfect! ${n} high.` : `Snip! ${n} high.`;
      layout(i, { kind: 'tap', locked: true, note });
    };

    const off = session.onInput((seatIndex, msg) => {
      if (msg.t !== 'tap' || over) return;
      const i = posOf.get(seatIndex);
      if (i === undefined || cpu[i]) return;
      // Drop it where it was when the finger came down: the tap took `lag` to arrive.
      const raw = now + Math.max(0, (performance.now() - frameAt) / 1000) * clock.speed;
      const lag = Math.min(0.15, (session.seats[seatIndex]?.rtt ?? 0) / 2000) * clock.speed;
      const t = raw - lag;
      if (t > TAKEOUT.duration) return;
      onDrop(i, t);
    });

    ui.caption('Tap to drop your box. Line it up with the one below!');
    let hudAt = -1;
    await everyFrame(clock, (_, t) => {
      now = t;
      view.now = t;
      frameAt = performance.now();
      stacks.forEach((s, i) => {
        if (t <= TAKEOUT.duration && stepStack(s, t)) {
          view.hook(i);
          const n = stacked(s) + 1;
          if (cpu[i]) cpuAt[i] = cpuDropAt(s, skill[i] ?? 0.5, rng);
          else layout(i, { kind: 'tap', locked: false, note: n === 1 ? 'Tap to drop the box' : `Tap to drop box ${n}` });
        }
        const at = cpuAt[i] ?? Infinity;
        if (cpu[i] && t >= at && at <= TAKEOUT.duration) onDrop(i, at);
      });
      for (const e of view.events.splice(0)) {
        const i = view.lanes.indexOf(e.lane);
        if (e.kind === 'miss') {
          sfx.bad();
          noise(sfx, { dur: 0.4, filter: 'bandpass', freq: 900, to: 300, gain: 0.2 });
          continue;
        }
        thump(sfx);
        if (e.kind === 'cut') snip(sfx);
        else sparkle(sfx, e.streak);
        if (i >= 0) session.send((seats[i] as MinigameSeat).index, { t: 'buzz', pattern: e.kind === 'perfect' ? [15, 30, 15] : [25] });
      }
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(Math.max(0, TAKEOUT.duration - t));
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${stacked(stacks[i] as Stack)} high` })));
      }
      const allDone = stacks.every((s) => s.done);
      return t >= TAKEOUT.duration + GRACE || (allDone && t >= lastDrop + 1.2);
    });
    over = true;
    off();
    ui.timer(null);
    ui.caption(null);
    seats.forEach((_, i) => {
      if (!(stacks[i] as Stack).done) layout(i, { kind: 'wait', title: "Time's up!", text: `Your tower: ${stacked(stacks[i] as Stack)} boxes high.` });
    });
    const scores = takeoutScores(stacks);
    const best = Math.max(...scores);
    view.lanes.forEach((l, i) => {
      if (scores[i] === best) {
        l.companion.setBase('happy');
        l.companion.react('happy', 3);
      }
    });
    await clock.wait(0.6);
    return {
      scores,
      details: stacks.map((s) => {
        const n = stacked(s);
        return [`${n} box${n === 1 ? '' : 'es'} high`, ...(s.perfects ? [`${s.perfects} perfect`] : []), ...(s.done ? ['toppled'] : [])].join(' · ');
      }),
    };
  },
};
