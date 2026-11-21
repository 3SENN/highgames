// Moving Day on the TV: a stairwell on moving day, seen from the side. The whole group carries one big couch over
// their heads, step by step up to the landing and the open door of the new flat. A round "heave-ho" sign on the
// wall keeps the beat: a ring closes in on it and it flashes HO! on every beat, with a dot per player that lights up
// when they pump in time.
import * as THREE from 'three';
import {
  type BeatClose,
  MOVE,
  type Move,
  type MoveCpu,
  type PumpResult,
  beatPhase,
  beatTime,
  cpuPumps,
  isOver,
  moveCoop,
  newMove,
  newMoveCpu,
  pump,
  stepMove,
} from '../../../game/minigames/movingday';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ROUNDED_FONT, ball, canvasTexture, cyl, mix, part, rbox, toonMat, torus } from '../../render/toon';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const RUN = 0.62; // how deep a step is
const RISE = 0.42; // how high
const DEPTH = 2.2; // how wide the staircase is (z)
const STAIR_Z = -0.6; // its middle
const LANDING = 3.4; // the top landing, past the last step
const HEIGHT = 1.3; // companion height
const COUCH_L = 2.5;
const CARRY = 0.08; // gap between the tops of the heads and the couch
const LANE_Z = -0.15; // where the carriers walk
const START_X = -0.55; // the couch's middle at the bottom
const MARK = new THREE.Vector3(-1.7, 5.0, -1.5); // the heave-ho sign, up where the couch never goes
const TOP_Y = MOVE.steps * RISE;
const FACE = P.cream;
const DOT_OFF = mix(P.linen, P.plum, 0.35);
const DOOR_X = MOVE.steps * RUN + 2.1;

/** The stair line through the middle of every tread: smooth, for the couch. */
function ramp(x: number): number {
  return Math.max(0, Math.min(MOVE.steps, x / RUN - 0.5)) * RISE;
}

/** The top of the tread under x. */
function tread(x: number): number {
  return Math.max(0, Math.min(MOVE.steps, Math.floor(x / RUN))) * RISE;
}

/** Each carrier's place along the couch. */
function carrierOffsets(n: number): number[] {
  if (n <= 1) return [0];
  const span = 1.8;
  return Array.from({ length: n }, (_, i) => -span / 2 + (i * span) / (n - 1));
}

function couchModel(): THREE.Group {
  const g = new THREE.Group();
  const body = P.teal;
  const seat = mix(P.teal, P.cream, 0.22);
  const v = { tex: 'velvet' as const };
  part(g, rbox(COUCH_L, 0.42, 0.95, 0.1), body, 0, 0.21, 0, v);
  for (const x of [-0.6, 0, 0.6]) part(g, rbox(0.58, 0.16, 0.72, 0.07), seat, x, 0.5, 0.08, { ...v, outline: false });
  part(g, rbox(COUCH_L, 0.55, 0.28, 0.1), body, 0, 0.66, -0.34, v);
  for (const x of [-1, 1]) part(g, rbox(0.28, 0.52, 0.95, 0.1), body, x * (COUCH_L / 2 - 0.14), 0.5, 0, v);
  // piping along the front edge, brass-capped feet, two cushions
  part(g, rbox(COUCH_L - 0.5, 0.03, 0.03, 0.012), mix(P.teal, P.ink, 0.35), 0, 0.42, 0.47, { outline: false });
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      part(g, cyl(0.05, 0.035, 0.12, 8), P.walnut, x * (COUCH_L / 2 - 0.2), -0.05, z * 0.36, { outline: false });
      part(g, cyl(0.037, 0.037, 0.03, 8), P.brass, x * (COUCH_L / 2 - 0.2), -0.1, z * 0.36, { outline: false, gloss: 0.6 });
    }
  part(g, rbox(0.5, 0.36, 0.14, 0.07), P.mustard, 0.75, 0.72, -0.12, { rz: -0.15, tex: 'knit' });
  part(g, rbox(0.42, 0.32, 0.13, 0.06), P.cream, -0.72, 0.7, -0.1, { rz: 0.2, tex: 'fabric' });
  return g;
}

/** A cardboard moving box with a strip of tape and a label. */
function movingBox(parent: THREE.Object3D, x: number, y: number, z: number, s = 1, ry = 0): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  g.scale.setScalar(s);
  part(g, rbox(0.9, 0.62, 0.7, 0.03), P.clay, 0, 0.31, 0, { tex: 'fabric', texStrength: 0.5 });
  part(g, rbox(0.92, 0.012, 0.16, 0.005), P.sand, 0, 0.625, 0, { outline: false, gloss: 0.3 });
  part(g, rbox(0.16, 0.2, 0.012, 0.005), P.sand, 0, 0.53, 0.352, { outline: false, gloss: 0.3 });
  part(g, rbox(0.3, 0.2, 0.012, 0.005), P.cream, -0.2, 0.26, 0.352, { outline: false });
  parent.add(g);
}

/** A wall lamp: a brass arm and a glowing glass shade. */
function sconce(parent: THREE.Object3D, x: number, y: number, z: number): void {
  part(parent, rbox(0.16, 0.34, 0.05, 0.02), P.brass, x, y, z, { outline: false, gloss: 0.6 });
  part(parent, cyl(0.02, 0.02, 0.16, 6), P.brass, x, y + 0.02, z + 0.09, { rx: Math.PI / 2, outline: false, gloss: 0.6 });
  part(parent, cyl(0.15, 0.1, 0.24, 16), P.lamp, x, y + 0.12, z + 0.2, { glow: 1.25, outline: false, shadow: false });
}

/** Little bursts of soft glowing sparks (dust, glitter, embers). One draw call for all of them. */
class Sparks {
  private readonly max = 96;
  private readonly pos = new Float32Array(this.max * 3).fill(-999);
  private readonly col = new Float32Array(this.max * 3);
  private readonly vel = new Float32Array(this.max * 3);
  private readonly life = new Float32Array(this.max);
  private readonly tint: THREE.Color[] = Array.from({ length: this.max }, () => new THREE.Color());
  private readonly map = canvasTexture(64, 64, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  });
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private next = 0;

  constructor(scene: THREE.Scene, size = 0.16, private readonly gravity = 2.2) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: this.map, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** `n` sparks from `at`, flying outwards at about `speed` and upwards by `up` times that. */
  burst(at: THREE.Vector3, color: string, n = 10, speed = 1.4, up = 1): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const r = speed * (0.4 + Math.random() * 0.6);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([Math.cos(a) * r, (0.3 + Math.random()) * speed * up, Math.sin(a) * r], i * 3);
      this.life[i] = 0.6 + Math.random() * 0.5;
      (this.tint[i] as THREE.Color).set(color);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const l = this.life[i] as number;
      if (l <= 0) continue;
      const left = l - dt;
      this.life[i] = left;
      const j = i * 3;
      this.vel[j + 1] = (this.vel[j + 1] as number) - dt * this.gravity;
      for (let a = 0; a < 3; a++) this.pos[j + a] = (this.pos[j + a] as number) + (this.vel[j + a] as number) * dt;
      const t = this.tint[i] as THREE.Color;
      const f = Math.max(0, Math.min(1, left * 2.2));
      this.col.set([t.r * f, t.g * f, t.b * f], j);
      if (left <= 0) this.pos[j + 1] = -999;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.map.dispose();
  }
}

class StairsView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly crew: Companion[];
  readonly floaters: Floaters;
  private readonly fit = new CameraFit(this.camera, 0.07);
  private readonly marks: Mark[] = [];
  private readonly offsets: number[];
  private readonly couch: THREE.Group;
  private readonly face: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly word: THREE.CanvasTexture;
  private readonly wordMat: THREE.MeshBasicMaterial;
  private readonly plaque: THREE.CanvasTexture;
  private readonly plaqueMat: THREE.MeshBasicMaterial;
  private readonly dots: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly doorGlow = toonMat({ color: P.lamp, emissive: new THREE.Color(P.lamp), emissiveIntensity: 1.1 });
  private readonly colors: string[];
  private readonly sparks: Sparks;
  private readonly tick: (dt: number, time: number) => void;
  private squash = 0;
  private wordShown = '';
  private stepShown = -1;
  private flash = 0;
  private jolt = 0;
  /** Where the couch is drawn (steps, fractional while moving). */
  private shown = 0;
  /** Set by the game each frame. */
  target = 0;
  wobble = 0;
  phase = -1;
  synced: boolean[] = [];
  /** The finale: 0 while climbing, then 0..1 onto the landing, then the couch goes down. */
  private finale = -1;
  private sad = false;

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    this.crew = companions;
    this.colors = seats.map((s) => s.color);
    this.offsets = carrierOffsets(seats.length);
    const rig = lightRig(this.scene, 'lampInterior', { fog: { near: 40, far: 90 }, shadowSize: 11, sunFrom: [-0.25, 1, 0.75] });
    rig.sun.target.position.set(4.5, 2.5, 0);
    rig.sun.position.add(rig.sun.target.position);
    this.floaters = new Floaters(this.scene);
    this.sparks = new Sparks(this.scene);
    const s = this.scene;
    const quiet = { outline: false as const };
    const wall = P.duskWall;
    const panel = mix(P.linen, P.plum, 0.3);

    // The stairwell: floorboards, a painted back wall with a dado below, the stairs and the landing.
    part(s, rbox(34, 0.3, 12, 0.05), P.oak, 3, -0.15, 2.6, { tex: 'woodFloor', outline: false, shadow: false });
    part(s, rbox(34, 14, 0.3, 0.05), wall, 3, 7, -1.85, { tex: 'plaster', texStrength: 0.9, ...quiet });
    part(s, rbox(34, 1.1, 0.04, 0.01), mix(wall, P.ink, 0.25), 3, 0.55, -1.69, { tex: 'plaster', ...quiet });
    part(s, rbox(34, 0.06, 0.07, 0.02), P.cream, 3, 1.1, -1.67, quiet);
    part(s, rbox(34, 0.2, 0.06, 0.02), P.cream, 3, 0.1, -1.67, quiet);
    for (let k = 1; k < MOVE.steps; k++) part(s, rbox(RUN, k * RISE, DEPTH, 0.02), panel, k * RUN + RUN / 2, (k * RISE) / 2, STAIR_Z, { tex: 'wood', texStrength: 0.35, ...quiet });
    part(s, rbox(LANDING + 6, TOP_Y, DEPTH, 0.03), panel, MOVE.steps * RUN + LANDING / 2 + 3, TOP_Y / 2, STAIR_Z, { tex: 'wood', texStrength: 0.35, ...quiet });
    // Walnut treads with a woven runner up the middle, held by brass rods.
    for (let k = 1; k <= MOVE.steps; k++) {
      const w = k === MOVE.steps ? LANDING + 6 : RUN;
      const x = k * RUN + w / 2;
      part(s, rbox(w + 0.06, 0.07, DEPTH + 0.06, 0.02), P.walnut, x, k * RISE + 0.005, STAIR_Z, { tex: 'wood', gloss: 0.2 });
      part(s, rbox(w + 0.065, 0.075, 1.1, 0.02), P.terracotta, x, k * RISE + 0.012, LANE_Z, { tex: 'terry', ...quiet });
      for (const e of [-1, 1]) part(s, rbox(w + 0.07, 0.078, 0.07, 0.02), mix(P.terracotta, P.ink, 0.4), x, k * RISE + 0.013, LANE_Z + e * 0.5, quiet);
      if (k < MOVE.steps) part(s, cyl(0.014, 0.014, 1.24, 6), P.brass, k * RUN + RUN + 0.02, k * RISE + 0.07, LANE_Z, { rx: Math.PI / 2, gloss: 0.7, ...quiet });
    }
    // Panel frames on the side of the stairs, and a skirting along its foot.
    const front = STAIR_Z + DEPTH / 2 + 0.012;
    for (let k = 3; k <= MOVE.steps; k += 3) {
      const h = (k - 2) * RISE - 0.5;
      part(s, rbox(RUN * 3 - 0.3, h, 0.03, 0.012), mix(panel, P.ink, 0.12), (k - 1.5) * RUN + RUN / 2 + 0.15, 0.3 + h / 2, front, quiet);
    }
    for (let i = 0; i < 4; i++) part(s, rbox(1.5, TOP_Y - 0.8, 0.03, 0.012), mix(panel, P.ink, 0.12), MOVE.steps * RUN + 1.0 + i * 1.75, TOP_Y / 2 - 0.05, front, quiet);
    part(s, rbox(MOVE.steps * RUN + LANDING + 6, 0.16, 0.05, 0.02), P.cream, (MOVE.steps * RUN + LANDING + 6) / 2 + RUN, 0.08, front, quiet);
    // A handrail up the wall on brass brackets, and a newel post at the foot.
    const len = Math.hypot(MOVE.steps * RUN, MOVE.steps * RISE);
    const slope = Math.atan2(RISE, RUN);
    const midX = (MOVE.steps * RUN) / 2 + RUN / 2;
    part(s, cyl(0.05, 0.05, len, 10), P.walnut, midX, ramp(midX) + 1.0, -1.58, { rz: slope - Math.PI / 2, tex: 'darkWood', gloss: 0.3 });
    for (let k = 1; k < MOVE.steps; k += 2) part(s, rbox(0.05, 0.05, 0.14, 0.01), P.brass, k * RUN + RUN / 2, ramp(k * RUN + RUN / 2) + 0.97, -1.64, { gloss: 0.6, ...quiet });
    part(s, rbox(0.16, 1.25, 0.16, 0.03), P.walnut, RUN + 0.05, 0.62, STAIR_Z + DEPTH / 2 - 0.1, { tex: 'darkWood' });
    part(s, ball(0.11, 2), P.walnut, RUN + 0.05, 1.33, STAIR_Z + DEPTH / 2 - 0.1, { gloss: 0.4 });

    // Up the wall: pictures, wall lamps between them, fairy lights above, a tall window at the foot.
    const arts: props.Art[] = ['hills', 'sunset', 'leaf'];
    [2, 6, 10].forEach((k, i) => {
      const f = props.pictureFrame({ w: i === 1 ? 0.8 : 1.0, h: i === 1 ? 1.0 : 0.75, art: arts[i] as props.Art, frame: i === 1 ? P.brass : P.walnut, seed: 3 + i });
      f.position.set(k * RUN + 0.3, k * RISE + 2.9, -1.69);
      s.add(f);
    });
    for (const k of [4, 8]) sconce(s, k * RUN + 0.3, k * RISE + 2.75, -1.68);
    sconce(s, DOOR_X - 1.5, TOP_Y + 1.9, -1.68);
    sconce(s, -4.4, 2.6, -1.68);
    for (let i = 0; i < 4; i++) {
      const x0 = -5 + i * 4.4;
      const x1 = x0 + 4.4;
      const lift = (x: number) => 7.2 + Math.max(0, x) * 0.55;
      s.add(props.stringLights(new THREE.Vector3(x0, lift(x0), -1.64), new THREE.Vector3(x1, lift(x1), -1.64), { sag: 0.3, count: 9 }));
    }
    const win = props.windowFrame({ w: 1.7, h: 2.5, time: 'dusk', seed: 6 });
    win.position.set(-5.6, 5.0, -1.69);
    const drapes = props.curtains({ w: 1.7, h: 2.5, color: mix(P.mauve, P.cream, 0.25) });
    drapes.position.copy(win.position);
    s.add(win, drapes);
    const small = props.pictureFrame({ w: 0.55, h: 0.7, art: 'moon', frame: P.charcoal, seed: 9 });
    small.position.set(-3.6, 2.5, -1.69);
    s.add(small);

    // Moving day at the foot of the stairs: boxes, a lamp that is already plugged in, a rolled-up rug, plants.
    movingBox(s, -3.1, 0, 0.4, 1, 0.2);
    movingBox(s, -3.0, 0.62, 0.35, 0.85, -0.15);
    movingBox(s, -2.1, 0, 0.9, 0.8, 0.5);
    movingBox(s, -5.4, 0, -0.6, 1.1, -0.2);
    movingBox(s, -5.3, 0.68, -0.65, 0.9, 0.3);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, sc = 1) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc);
      s.add(o);
      return o;
    };
    put(props.floorLamp({ lit: true, light: 9, h: 1.9 }), -4.3, 0, -1.0);
    put(props.plant({ kind: 'monstera', h: 1.1, pot: P.ceramic, seed: 4 }), -6.3, 0, 0.6);
    part(s, cyl(0.17, 0.17, 2.0, 14), P.mauve, -4.2, 0.17, 1.5, { rz: Math.PI / 2, tex: 'terry' });
    for (const e of [-1, 1]) part(s, cyl(0.172, 0.172, 0.06, 14), P.cream, -4.2 + e * 0.6, 0.17, 1.5, { rz: Math.PI / 2, ...quiet });
    // Along the side of the stairs, lower than the treads behind them.
    movingBox(s, 2.6, 0, 1.0, 0.7, 0.3);
    put(props.plant({ kind: 'snake', h: 0.8, pot: P.charcoal }), 3.5, 0, 0.95);
    movingBox(s, 4.7, 0, 1.1, 1, -0.2);
    movingBox(s, 4.75, 0.62, 1.05, 0.8, 0.25);
    put(props.guitar(), 5.7, 0, 0.7, 0.2);
    put(props.bookshelf({ w: 1.5, h: 2.3, seed: 5 }), 8.6, 0, 0.75);
    put(props.plant({ kind: 'ficus', h: 2.0, pot: P.terracotta, seed: 2 }), 10.3, 0, 1.2);
    put(props.armchair({ color: P.mustard, pillow: P.cream }), 6.9, 0, 1.5, -0.5, 1.15);
    put(props.rug({ w: 3.4, d: 1.6, color: P.denim }), 0.4, 0, 1.6);
    // On the landing: a plant by the door and a pendant lamp over it.
    put(props.plant({ kind: 'palm', h: 1.3, pot: P.terracotta, seed: 7 }), 10.45, TOP_Y + 0.04, 0.0);
    put(props.pendantLamp({ drop: 1.4, lit: true }), DOOR_X - 2.6, TOP_Y + 4.6, -0.5);
    put(props.motes({ n: 20, area: [14, 5, 2.5], size: 0.035 }), 3, 2.5, 0);

    // The new flat's door on the landing, open, warm light spilling out, and a doormat.
    part(s, rbox(1.7, 2.6, 0.14, 0.04), P.walnut, DOOR_X, TOP_Y + 1.3, -1.68, { tex: 'darkWood' });
    part(s, rbox(1.36, 2.36, 0.05, 0.02), P.lamp, DOOR_X, TOP_Y + 1.2, -1.6, { material: this.doorGlow, outline: false });
    part(s, rbox(0.12, 2.3, 1.0, 0.03), P.forest, DOOR_X + 0.72, TOP_Y + 1.18, -1.1, { ry: -0.35, gloss: 0.25 });
    part(s, ball(0.05, 1), P.brass, DOOR_X + 0.6, TOP_Y + 1.15, -0.72, { gloss: 0.7, ...quiet });
    part(s, rbox(1.3, 0.03, 0.7, 0.02), P.forest, DOOR_X, TOP_Y + 0.06, -0.55, { tex: 'terry', ...quiet });
    const glow = new THREE.PointLight(P.lamp, 5, 7, 1.4);
    glow.position.set(DOOR_X, TOP_Y + 1.4, -0.6);
    this.scene.add(glow);
    this.tick = props.tickProps(s);

    // The heave-ho sign: a round wooden plaque, a face that flashes on the beat, a ring that closes in on it,
    // a dot per player and a little plaque with the step count.
    const sign = new THREE.Group();
    sign.position.copy(MARK);
    this.scene.add(sign);
    part(sign, cyl(1.22, 1.22, 0.1, 40), P.walnut, 0, 0, 0, { rx: Math.PI / 2, tex: 'darkWood', gloss: 0.3 });
    part(sign, torus(1.06, 0.035), P.brass, 0, 0, 0.05, { outline: false, gloss: 0.7 });
    this.face = new THREE.Mesh(new THREE.CircleGeometry(1.0, 48), new THREE.MeshBasicMaterial({ color: FACE }));
    this.face.position.z = 0.06;
    sign.add(this.face);
    this.word = canvasTexture(512, 256, () => {});
    this.wordMat = new THREE.MeshBasicMaterial({ map: this.word, transparent: true, toneMapped: false, depthWrite: false });
    const word = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), this.wordMat);
    word.position.set(0, 0.08, 0.08);
    sign.add(word);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.14, 64), new THREE.MeshBasicMaterial({ color: P.lamp, transparent: true, depthWrite: false }));
    this.ring.position.z = 0.1;
    sign.add(this.ring);
    seats.forEach((_, i) => {
      const a = -Math.PI / 2 + (i - (seats.length - 1) / 2) * 0.38;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), new THREE.MeshBasicMaterial({ color: DOT_OFF }));
      dot.position.set(Math.cos(a) * 0.72, Math.sin(a) * 0.72, 0.09);
      sign.add(dot);
      this.dots.push(dot);
    });
    this.plaque = canvasTexture(512, 256, () => {});
    this.plaqueMat = new THREE.MeshBasicMaterial({ map: this.plaque, transparent: true, toneMapped: false, depthWrite: false });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), this.plaqueMat);
    plaque.position.set(0, -1.75, 0.06);
    sign.add(plaque);

    // The couch, and everyone under it.
    this.couch = couchModel();
    this.scene.add(this.couch);
    companions.forEach((c) => {
      c.setBase('working');
      c.root.rotation.y = 0.75; // up the stairs, but faces still toward us
      this.scene.add(c.root);
    });

    // Keep the bottom of the stairs, the landing and its door, and the sign in view.
    this.marks.push(
      { p: new THREE.Vector3(-3.4, 0, 1.0) },
      { p: new THREE.Vector3(-2.2, HEIGHT + 1.3, LANE_Z) },
      { p: new THREE.Vector3(MOVE.steps * RUN + LANDING - 0.2, TOP_Y, 0.6) },
      { p: new THREE.Vector3(DOOR_X, TOP_Y + HEIGHT + 1.45, -1.6) },
      { p: new THREE.Vector3(MOVE.steps * RUN + 0.6, TOP_Y + HEIGHT + 2.1, LANE_Z) },
      { p: new THREE.Vector3(MARK.x - 1.3, MARK.y + 1.3, MARK.z) },
      { p: new THREE.Vector3(MARK.x - 1.3, MARK.y - 2.3, MARK.z) },
    );
    this.drawWord('Ready?');
    this.drawPlaque(0);
    this.pose(0, 0);
  }

  /** Where carrier `i` stands, at couch position `s` (steps). */
  private carrierAt(i: number, s: number): THREE.Vector3 {
    const base = Math.floor(s);
    const f = s - base;
    const x0 = START_X + base * RUN + (this.offsets[i] ?? 0);
    const from = tread(x0);
    const to = tread(x0 + RUN);
    const k = ease.inOutSine(Math.max(0, Math.min(1, f)));
    return new THREE.Vector3(x0 + f * RUN, from + (to - from) * k + Math.sin(f * Math.PI) * 0.16, LANE_Z);
  }

  /** Places the couch and the carriers for couch position `s`. */
  private pose(s: number, time: number): void {
    const x = START_X + s * RUN + (this.finale > 0 ? Math.min(1, this.finale) * 1.9 : 0);
    const back = ramp(x - COUCH_L / 2 + 0.2);
    const front = ramp(x + COUCH_L / 2 - 0.2);
    const lower = this.finale > 1 ? ease.inOutSine(Math.min(1, this.finale - 1)) : 0;
    const y = (back + front) / 2 + HEIGHT + CARRY - lower * (HEIGHT + CARRY - 0.04);
    const tilt = Math.atan2(front - back, COUCH_L - 0.4) * (1 - lower);
    const shake = this.wobble * 0.12 + this.jolt * 0.25;
    this.couch.position.set(x, y + Math.abs(Math.sin(time * 9)) * this.jolt * 0.12, LANE_Z);
    this.couch.rotation.set(Math.sin(time * 11.3) * shake * 0.6, 0, tilt + Math.sin(time * 13.7) * shake);
    const sq = Math.sin(this.squash * Math.PI * 2) * this.squash * 0.12;
    this.couch.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    this.crew.forEach((c, i) => {
      const p = this.finale > 0 ? new THREE.Vector3(x + (this.offsets[i] ?? 0), tread(x + (this.offsets[i] ?? 0)), LANE_Z) : this.carrierAt(i, s);
      if (lower > 0) p.x += (i - (this.crew.length - 1) / 2) * 0.25 * lower;
      c.root.position.copy(p);
      c.root.position.z += lower * 0.9;
      c.root.rotation.z = Math.sin(time * 12 + i * 2.1) * this.wobble * 0.08;
      c.root.rotation.y = 0.75 * (1 - lower);
    });
  }

  private drawWord(text: string): void {
    if (text === this.wordShown) return;
    this.wordShown = text;
    const canvas = this.word.image as HTMLCanvasElement;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const big = text === 'HO!';
    g.font = `800 ${big ? 150 : 88}px ${ROUNDED_FONT}`;
    g.fillStyle = big ? P.brick : P.plum;
    g.fillText(text, 256, 132, 490);
    this.word.needsUpdate = true;
  }

  drawPlaque(step: number): void {
    if (step === this.stepShown) return;
    this.stepShown = step;
    const canvas = this.plaque.image as HTMLCanvasElement;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(30, 24, 38, 0.88)';
    g.beginPath();
    g.roundRect(8, 30, w - 16, h - 60, 98);
    g.fill();
    g.strokeStyle = 'rgba(201, 163, 91, 0.9)';
    g.lineWidth = 5;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = P.cream;
    g.font = `700 78px ${ROUNDED_FONT}`;
    g.fillText(step >= MOVE.steps ? 'Home!' : `Step ${step} / ${MOVE.steps}`, w / 2, h / 2 + 4, w - 40);
    this.plaque.needsUpdate = true;
  }

  /** The beat lands: the sign flashes. */
  beat(): void {
    this.flash = 1;
  }

  /** The couch lurches (a slide or a lift). */
  lurch(amount: number): void {
    this.jolt = Math.max(this.jolt, amount);
  }

  /** A step up: the couch squashes and settles, dust puffs from under the feet. */
  heave(): void {
    this.squash = 1;
    for (const c of this.crew) this.sparks.burst(c.root.position.clone().add(new THREE.Vector3(0, 0.08, 0.3)), P.lamp, 3, 0.7, 0.5);
  }

  /** The couch makes it up: onto the landing, and down it goes. */
  arrive(): void {
    this.finale = 0.001;
    for (const c of this.crew) c.move('walk', 1.6);
  }

  giveUp(): void {
    this.sad = true;
    for (const c of this.crew) c.setBase('sad');
  }

  headOf(i: number): THREE.Vector3 {
    const c = this.crew[i];
    return c ? c.root.position.clone().add(new THREE.Vector3(0, HEIGHT * 0.6, 0.9)) : this.couch.position.clone();
  }

  couchTop(): THREE.Vector3 {
    return this.couch.position.clone().add(new THREE.Vector3(0, 1.3, 0.4));
  }

  dispose(): void {
    for (const c of this.crew) c.dispose();
    this.floaters.dispose();
    this.sparks.dispose();
    this.word.dispose();
    this.wordMat.dispose();
    this.plaque.dispose();
    this.plaqueMat.dispose();
    this.doorGlow.dispose();
    this.face.geometry.dispose();
    this.face.material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    for (const d of this.dots) {
      d.geometry.dispose();
      d.material.dispose();
    }
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    for (const c of this.crew) c.update(dt);
    this.floaters.update(dt);
    this.sparks.update(dt);
    this.tick(dt, time);
    this.squash = Math.max(0, this.squash - dt * 3.2);
    // The couch catches up with the step it's on: up in a hop, down in a quick slide.
    const gap = this.target - this.shown;
    this.shown += Math.sign(gap) * Math.min(Math.abs(gap), dt * (gap > 0 ? 2.8 : 4.5));
    if (this.finale >= 0 && Math.abs(gap) < 1e-3) {
      const before = this.finale;
      this.finale = Math.min(2.2, this.finale + dt * (this.finale < 1 ? 0.75 : 1.4));
      if (before < 2 && this.finale >= 2) {
        this.squash = 1;
        for (const dx of [-1, 0, 1]) this.sparks.burst(this.couch.position.clone().add(new THREE.Vector3(dx, 0.2, 0.5)), P.lamp, 10, 1.6);
      }
      if (before < 1 && this.finale >= 1) {
        for (const c of this.crew) {
          c.move(null);
          c.setBase('happy');
        }
      }
    }
    this.jolt = Math.max(0, this.jolt - dt * 2.5);
    this.pose(this.shown, time);

    // The sign: the ring closes in toward the next beat; the face flashes on it.
    const p = this.phase;
    const toNext = p < 0 ? Math.max(0, 1 + p) : p;
    this.ring.scale.setScalar(1 + 1.3 * (1 - toNext));
    this.ring.material.opacity = this.finale >= 0 || this.sad ? 0 : 0.2 + 0.8 * toNext * toNext;
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.face.material.color.set(mix(FACE, P.lamp, this.flash)).multiplyScalar(1 + this.flash * 0.5);
    this.face.scale.setScalar(1 + this.flash * 0.08);
    if (this.finale >= 0) this.drawWord('Phew!');
    else if (this.sad) this.drawWord('Time!');
    else if (p < 0) this.drawWord(p > -0.5 ? 'heave…' : 'Ready?');
    else this.drawWord(p < 0.32 ? 'HO!' : p > 0.5 ? 'heave…' : '');
    this.dots.forEach((d, i) => {
      const on = this.synced[i] ?? false;
      d.material.color.set(on ? (this.colors[i] ?? '#ffffff') : DOT_OFF);
      d.scale.setScalar(on ? 1.25 : 1);
    });
    this.doorGlow.emissiveIntensity = 1.1 + Math.sin(time * 1.6) * 0.1 + (this.finale > 0 ? Math.min(1, this.finale) * 0.6 : 0);
  }
}

// ------------------------------------------------------------------ little sounds

function heave(sfx: Sfx, delay: number): void {
  tone(sfx, { freq: 196, to: 233, dur: 0.22, type: 'triangle', gain: 0.05, delay });
}

function ho(sfx: Sfx, delay: number): void {
  tone(sfx, { freq: 110, to: 70, dur: 0.22, gain: 0.28, delay });
  noise(sfx, { dur: 0.12, freq: 320, gain: 0.16, delay });
}

function clunk(sfx: Sfx): void {
  tone(sfx, { freq: 330, to: 262, dur: 0.12, type: 'triangle', gain: 0.12 });
  tone(sfx, { freq: 494, dur: 0.12, type: 'sine', gain: 0.08, delay: 0.06 });
}

function creak(sfx: Sfx): void {
  tone(sfx, { freq: 170, to: 135, dur: 0.22, type: 'sawtooth', gain: 0.025 });
}

function scrape(sfx: Sfx): void {
  noise(sfx, { dur: 0.45, filter: 'bandpass', freq: 900, to: 260, gain: 0.22 });
}

// ------------------------------------------------------------------ the minigame

const LINE = 'Pump on every HO! When most of you are in time, the couch goes up a step.';

export const minigame: Minigame = {
  id: 'movingday',
  title: 'Moving Day',
  how: 'Carry the couch up the stairs together: pump your phone on every "HO!" of the beat. When most of you pump in time it goes up a step; miss two beats in a row and it slides back down. Reach the landing in 40 seconds!',
  controller: 'pump',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const m: Move = newMove(n);
    const skill = seats.map(() => ctx.skill());
    const cpus: MoveCpu[] = seats.map((_, i) => newMoveCpu(rng, skill[i] ?? 0.5));
    const view = new StairsView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'pump', label: 'Up the stairs', redline: false }));

    const t0 = clock.time;
    const now = () => clock.time - t0;
    let captionUntil = 0;
    const say = (text: string, color?: string) => {
      ui.caption(text, color);
      captionUntil = m.time + 2.4;
    };

    const onClose = (c: BeatClose) => {
      const at = view.couchTop();
      if (c.outcome === 'hold') view.floaters.add('Hold it…', '#ffffff', at, 0.42);
      else if (c.outcome === 'miss') {
        view.floaters.add(c.wobbly ? 'Too wobbly!' : 'Missed the beat', '#ffd0dc', at, 0.42);
        if (c.wobbly) say('Too wobbly to lift! Only pump on the HO.');
      } else if (c.outcome === 'slide') {
        view.floaters.add('Whoa!', '#ff9eb5', at, 0.6);
        view.lurch(1);
        scrape(sfx);
        for (const comp of view.crew) comp.react('sad', 1.2);
        for (const i of seats.keys()) session.send(i, { t: 'buzz', pattern: [70, 40, 70] });
        say('Two beats missed: it slid down a step! Find the beat together.', '#ff9eb5');
      }
    };
    const advance = (to: number) => {
      for (const c of stepMove(m, Math.max(0, to - m.time))) onClose(c);
    };
    let sentStep = -1;
    let sentDanger = false;
    const meters = () => {
      const danger = m.wobble >= MOVE.wobbleLimit * 0.7;
      if (m.step === sentStep && danger === sentDanger) return;
      sentStep = m.step;
      sentDanger = danger;
      for (const i of seats.keys()) if (!session.isCpu(i)) session.send(i, { t: 'meter', value: m.step / MOVE.steps, danger });
    };
    const onPump = (seat: number, r: PumpResult) => {
      const human = !session.isCpu(seat);
      if (r.kind === 'sync') {
        view.floaters.add('Ho!', seats[seat]?.color ?? '#ffffff', view.headOf(seat), 0.3, 0.8);
        if (human) session.send(seat, { t: 'feedback', good: true, text: r.lifted ? 'Heave-ho! Up it goes.' : 'In time!' });
      } else if (r.kind === 'off') {
        creak(sfx);
        view.lurch(0.3);
        view.crew[seat]?.react('thinking', 0.6);
        if (human) session.send(seat, { t: 'feedback', good: false, text: r.offset < 0 ? 'Too early: wait for the HO!' : 'Too late: pump right on the HO!' });
      }
      if (r.lifted) {
        clunk(sfx);
        view.lurch(0.35);
        view.heave();
        view.floaters.add('Heave-ho!', P.lamp, view.couchTop(), 0.5);
        for (const comp of view.crew) comp.react('approval', 0.5);
      }
      meters();
    };
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'pump' || seat >= n || session.isCpu(seat) || isOver(m)) return;
      advance(now());
      const at = now() - ((session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed;
      onPump(seat, pump(m, seat, at));
    });

    const queue: { seat: number; at: number }[] = [];
    let planned = -1;
    let hoAt = 0; // the next beat to sound…
    let heaveAt = 0; // …and the next "heave" half a beat before it
    let hudAt = -1;
    ui.caption(LINE);
    captionUntil = 3;
    await everyFrame(clock, () => {
      const t = Math.min(now(), MOVE.duration);
      // The computer players decide how they'll pump for each beat half a beat ahead.
      while (beatTime(planned + 1) - MOVE.beat / 2 <= t) {
        planned++;
        seats.forEach((_, i) => {
          if (session.isCpu(i)) for (const at of cpuPumps(cpus[i] as MoveCpu, skill[i] ?? 0.5, rng, beatTime(planned))) queue.push({ seat: i, at });
        });
        queue.sort((a, b) => a.at - b.at);
      }
      while (queue.length && (queue[0] as { at: number }).at <= t && !isOver(m)) {
        const p = queue.shift() as { seat: number; at: number };
        advance(p.at);
        if (session.isCpu(p.seat)) onPump(p.seat, pump(m, p.seat, p.at));
      }
      advance(t);
      // The beat, scheduled a moment ahead so it lands right on time.
      while (!isOver(m) && beatTime(hoAt) - t < 0.12) ho(sfx, Math.max(0, (beatTime(hoAt++) - t) / clock.speed));
      while (!isOver(m) && beatTime(heaveAt) - MOVE.beat / 2 - t < 0.12) heave(sfx, Math.max(0, (beatTime(heaveAt++) - MOVE.beat / 2 - t) / clock.speed));
      const phase = beatPhase(m.time);
      if (phase >= 0 && (view.phase < 0 || phase < view.phase)) {
        view.beat();
        // The phones' gauges flash on the beat too, for anyone looking down at their phone.
        seats.forEach((_, i) => !session.isCpu(i) && session.send(i, { t: 'pulse' }));
      }
      view.phase = phase;
      view.synced = m.synced;
      view.wobble = Math.min(1, m.wobble);
      view.target = m.step;
      view.drawPlaque(m.step);
      if (captionUntil && m.time > captionUntil) {
        captionUntil = 0;
        ui.caption(m.step > 0 ? `Step ${m.step} of ${MOVE.steps}: pump on the HO!` : LINE);
      }
      if (m.time - hudAt > 0.2) {
        hudAt = m.time;
        meters();
        ui.timer(MOVE.duration - m.time);
        ui.live(
          seats.map((s, i) => {
            const offBeat = m.offBeat[i] ?? 0;
            return { name: s.name, color: s.color, thumb: s.thumb, value: `${m.inTime[i] ?? 0} in time${offBeat ? ` · ${offBeat} off` : ''}` };
          }),
        );
      }
      return isOver(m);
    });
    off();
    ui.timer(null);
    const home = m.doneAt !== null;
    session.setLayoutAll(() => ({ kind: 'wait', title: home ? 'Home sweet home!' : 'Time’s up!', text: 'Watch the big screen' }));
    view.target = m.step;
    if (home) {
      view.arrive();
      sfx.good();
      ui.caption(`You made it up in ${(m.doneAt ?? MOVE.duration).toFixed(1)} s! Couch delivered.`);
      await clock.wait(2.6);
    } else {
      view.giveUp();
      sfx.bad();
      ui.caption(`Time’s up on step ${m.step} of ${MOVE.steps}. Nearly there!`);
      await clock.wait(2);
    }
    ui.caption(null);
    const coop = moveCoop(m);
    const score = Math.round(coop * 1000);
    return {
      scores: seats.map(() => score),
      details: seats.map((_, i) => {
        const inTime = m.inTime[i] ?? 0;
        const offBeat = m.offBeat[i] ?? 0;
        return `${inTime} heave${inTime === 1 ? '' : 's'} in time${offBeat ? ` · ${offBeat} off the beat` : ''}`;
      }),
      coop,
    };
  },
};
