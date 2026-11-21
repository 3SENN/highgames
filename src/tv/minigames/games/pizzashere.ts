// Pizza's Here! on the TV: an evening flat, everyone sunk into the couch, waiting for the pizza. The kettle
// whistles, a phone buzzes on the table, the neighbour's door bangs, a car's lights sweep past, the cat knocks
// something off the shelf… and now and then the real doorbell goes, with a pizza-box shadow at the frosted glass.
import * as THREE from 'three';
import { type Fake, PIZZA, type TapResult, cpuRound, judgeTap, pizzaScores, planRound, roundPoints } from '../../../game/minigames/pizzashere';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import type { TextureName } from '../../render/textures';
import { PALETTE, ball, box, cone, cyl, gem, lathe, mix, part, pill, rbox, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.25;
const COUCH_X = -0.4;
const COUCH_Z = -1.8;
const SEAT_Y = 0.6;
const CUSHION = 1.45;
const STAND_Z = -0.55; // where someone stands when they get up
const KETTLE = new THREE.Vector3(-4.9, 1.1, -2.6);
const WINDOW = new THREE.Vector3(-2.6, 2.6, -3.18);
const DOOR = new THREE.Vector3(4.5, 0, -3.2);
const GLASS = new THREE.Vector3(DOOR.x, 2.15, -3.08);
const SHELF = new THREE.Vector3(2.4, 2.2, -2.95);
const TABLE = new THREE.Vector3(COUCH_X, 0.58, 0.55);
const FRAME = new THREE.Vector3(COUCH_X, 3.35, -3.15);
const BELL_WORD = new THREE.Vector3(DOOR.x, 3.3, DOOR.z + 0.4);
const SLAM_WORD = new THREE.Vector3(-5.4, 3.0, -2.8);

const P = PALETTE;
const K = 1.35; // props at the couch's scale
const BACK = -3.2; // the back wall's face (z)
const WALL_COLOR = mix(P.sageWall, P.aubergine, 0.4);
const COUCH = mix(P.denim, P.aubergine, 0.2);

interface ShellOptions {
  w: number;
  h: number;
  /** z of the back wall's face and of the open front. */
  back: number;
  front: number;
  wall: string;
  floor: string;
  floorTex?: TextureName;
  /** The set's scale next to the 1 m props (texture tiles and trims grow with it). */
  k?: number;
  /** Height of the darker lower part of the walls (0 = none). */
  dado?: number;
}

/** The room's shell: floorboards, a plastered back wall and side walls with a dado and skirting, open to the camera. */
function roomShell(root: THREE.Object3D, o: ShellOptions): void {
  const k = o.k ?? 1;
  const d = o.front - o.back;
  const zc = (o.front + o.back) / 2;
  const quiet = { outline: false as const, shadow: false };
  const wall = { tex: 'plaster' as TextureName, texScale: 2.6 * k, texStrength: 0.9, ...quiet };
  const trim = mix(o.wall, P.cream, 0.45);
  part(root, box(o.w + 1, 0.3, d + 1), o.floor, 0, -0.15, zc, { tex: o.floorTex ?? 'woodFloor', texScale: 2.2 * k, ...quiet });
  part(root, box(o.w + 1, o.h, 0.4), o.wall, 0, o.h / 2, o.back - 0.2, wall);
  for (const s of [-1, 1]) part(root, box(0.4, o.h, d + 1), mix(o.wall, P.ink, 0.1), s * (o.w / 2 + 0.2), o.h / 2, zc, wall);
  const dado = o.dado ?? 0;
  if (dado > 0) {
    const low = mix(o.wall, P.ink, 0.24);
    part(root, box(o.w, dado, 0.04), low, 0, dado / 2, o.back + 0.02, wall);
    for (const s of [-1, 1]) part(root, box(0.04, dado, d), mix(low, P.ink, 0.1), s * (o.w / 2 - 0.02), dado / 2, zc, wall);
    part(root, box(o.w, 0.06 * k, 0.06 * k), trim, 0, dado, o.back + 0.05, quiet);
    for (const s of [-1, 1]) part(root, box(0.06 * k, 0.06 * k, d), trim, s * (o.w / 2 - 0.05), dado, zc, quiet);
  }
  part(root, box(o.w, 0.14 * k, 0.05 * k), trim, 0, 0.07 * k, o.back + 0.03 * k, quiet);
  for (const s of [-1, 1]) part(root, box(0.05 * k, 0.14 * k, d), trim, s * (o.w / 2 - 0.03 * k), 0.07 * k, zc, quiet);
}

/** Puts a prop into the set at `k` times its size. */
function put<T extends THREE.Object3D>(root: THREE.Object3D, o: T, x: number, y: number, z: number, ry = 0, k = 1): T {
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.scale.setScalar(k);
  root.add(o);
  return o;
}

interface Spark {
  m: THREE.Mesh;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

/** Little glowing sparkles that fly out, fall a bit and fade: for votes, right answers and winners. */
class Sparkles {
  private list: Spark[] = [];
  constructor(private readonly scene: THREE.Scene) {}

  burst(at: THREE.Vector3, color: string, n = 8, speed = 1.4): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const up = Math.random() * 0.8 + 0.5;
      const m = part(this.scene, gem(0.06), i % 2 ? color : P.lamp, at.x, at.y, at.z, { glow: 1.8, outline: false, shadow: false });
      this.list.push({ m, v: new THREE.Vector3(Math.cos(a) * speed * (0.5 + Math.random() * 0.5), up * speed, Math.sin(a) * speed * 0.4), age: 0, life: 0.6 + Math.random() * 0.4, size: 0.6 + Math.random() * 0.7 });
    }
  }

  update(dt: number): void {
    this.list = this.list.filter((sp) => {
      sp.age += dt;
      sp.v.y -= dt * 3.2;
      sp.m.position.addScaledVector(sp.v, dt);
      sp.m.rotation.y += dt * 7;
      sp.m.scale.setScalar(Math.max(0.001, sp.size * (1 - sp.age / sp.life)));
      if (sp.age < sp.life) return true;
      this.scene.remove(sp.m);
      return false;
    });
  }

  dispose(): void {
    for (const sp of this.list) this.scene.remove(sp.m);
    this.list = [];
  }
}

const GLASS_LIT = new THREE.Color('#ffd9a0').multiplyScalar(1.25);
const PORCH_LIT = new THREE.Color(PALETTE.lamp).multiplyScalar(2);
const WORDS: Record<Fake | 'bell', string> = { kettle: 'Wheee…', phone: 'Bzz bzz', slam: 'Bang!', car: 'Vroom…', cat: 'Clatter!', bell: 'Ding dong!' };

// ------------------------------------------------------------------ sounds (all soft, made in code)

function sound(sfx: Sfx, kind: Fake | 'bell'): void {
  switch (kind) {
    case 'bell':
      tone(sfx, { freq: 659, dur: 0.9, gain: 0.2 });
      tone(sfx, { freq: 1318, dur: 0.4, gain: 0.04 });
      tone(sfx, { freq: 523, dur: 1.3, gain: 0.2, delay: 0.42 });
      tone(sfx, { freq: 1046, dur: 0.5, gain: 0.04, delay: 0.42 });
      break;
    case 'kettle':
      tone(sfx, { freq: 1500, to: 2100, dur: 1.1, gain: 0.045 });
      tone(sfx, { freq: 1512, to: 2125, dur: 1.1, gain: 0.03 });
      noise(sfx, { dur: 1.0, filter: 'highpass', freq: 3000, gain: 0.05 });
      break;
    case 'phone':
      for (const d of [0, 0.38]) {
        tone(sfx, { freq: 150, dur: 0.26, type: 'sawtooth', gain: 0.045, delay: d });
        noise(sfx, { dur: 0.26, filter: 'lowpass', freq: 300, gain: 0.12, delay: d });
      }
      break;
    case 'slam':
      noise(sfx, { dur: 0.4, filter: 'lowpass', freq: 220, to: 90, gain: 0.7 });
      tone(sfx, { freq: 80, to: 50, dur: 0.3, gain: 0.18 });
      noise(sfx, { dur: 0.12, filter: 'bandpass', freq: 2200, gain: 0.08, delay: 0.05 });
      break;
    case 'car':
      noise(sfx, { dur: 0.9, filter: 'bandpass', freq: 250, to: 800, gain: 0.25 });
      noise(sfx, { dur: 0.9, filter: 'bandpass', freq: 800, to: 220, gain: 0.25, delay: 0.85 });
      break;
    case 'cat':
      tone(sfx, { freq: 420, to: 720, dur: 0.14, type: 'triangle', gain: 0.1 });
      for (const d of [0.32, 0.4, 0.47, 0.6]) noise(sfx, { dur: 0.07, filter: 'highpass', freq: 2400 + d * 1000, gain: 0.22, delay: d });
      break;
  }
}

// ------------------------------------------------------------------ the flat

interface Seat {
  c: Companion;
  home: THREE.Vector3;
  busy: boolean;
}

class FlatView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly floaters: Floaters;
  readonly seats: Seat[] = [];
  private readonly fit: CameraFit;
  private readonly marks: Mark[] = [];
  private readonly silhouetteMat = new THREE.MeshBasicMaterial({ color: '#2a2136', transparent: true, opacity: 0, depthWrite: false });
  private readonly sparkles = new Sparkles(this.scene);
  private readonly glassMat = new THREE.MeshBasicMaterial({ color: '#39405a' });
  private tick: (dt: number, time: number) => void = () => {};
  private readonly sweepMat = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly steamMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false });
  private readonly porchMat = new THREE.MeshBasicMaterial({ color: '#6a6458' });
  private readonly porchLight = new THREE.PointLight(PALETTE.lamp, 0, 6, 1.5);
  private readonly sweep: THREE.Mesh;
  private readonly kettle = new THREE.Group();
  private readonly phone = new THREE.Group();
  private readonly screen: THREE.Mesh;
  private readonly frame = new THREE.Group();
  private readonly catHead = new THREE.Group();
  private readonly catPaw = new THREE.Group();
  private readonly knockables: { g: THREE.Group; home: THREE.Vector3; down: boolean }[] = [];
  private puffs: { m: THREE.Mesh; age: number; vx: number }[] = [];
  private anims: ((dt: number) => boolean)[] = [];
  private time = 0;
  private kettleUntil = 0;
  private phoneUntil = 0;
  private frameAt = -9;
  private catAt = -9;

  constructor(
    seats: MinigameSeat[],
    people: Companion[],
  ) {
    // Evening in the flat: one warm key, plum shade, a floor lamp by the kitchen corner.
    const rig = lightRig(this.scene, 'lampInterior', { shadowSize: 10, fog: { near: 34, far: 90 } });
    rig.sun.target.position.set(0, 0, -1);
    this.buildRoom(seats);

    // The door's frosted glass, the porch lamp and the delivery shadow.
    part(this.scene, rbox(0.8, 0.9, 0.04, 0.03), '#39405a', GLASS.x, GLASS.y, GLASS.z + 0.05, { material: this.glassMat, shadow: false });
    for (const x of [-0.2, 0.2]) part(this.scene, box(0.03, 0.9, 0.05), PALETTE.mahogany, GLASS.x + x * 0.66, GLASS.y, GLASS.z + 0.1, { outline: false, shadow: false });
    const shadow = new THREE.Group();
    part(shadow, ball(0.16, 2), '#000', -0.12, 0.2, 0, { material: this.silhouetteMat, sz: 0.1 });
    part(shadow, rbox(0.62, 0.34, 0.02, 0.12), '#000', -0.12, -0.2, 0, { material: this.silhouetteMat });
    part(shadow, rbox(0.52, 0.11, 0.02, 0.03), '#000', 0.14, -0.04, 0.005, { material: this.silhouetteMat, rz: 0.08 });
    shadow.position.set(GLASS.x, GLASS.y, GLASS.z + 0.09);
    this.scene.add(shadow);
    part(this.scene, ball(0.12, 2), '#fff1b8', DOOR.x + 1.05, 2.45, DOOR.z + 0.14, { material: this.porchMat });
    this.porchLight.position.set(DOOR.x + 0.6, 2.4, DOOR.z + 0.7);
    this.scene.add(this.porchLight);

    // A band of light that sweeps the back wall when a car goes by.
    this.sweep = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 5), this.sweepMat);
    this.sweep.position.set(-9, 2.6, -3.17);
    this.sweep.rotation.z = 0.25;
    this.scene.add(this.sweep);

    // The phone on the coffee table.
    part(this.phone, rbox(0.28, 0.035, 0.5, 0.03), PALETTE.charcoal, 0, 0, 0, { gloss: 0.5 });
    this.screen = part(this.phone, rbox(0.24, 0.01, 0.44, 0.02), PALETTE.screen, 0, 0.022, 0, { glow: 1.8, outline: false });
    this.screen.visible = false;
    this.phone.position.set(TABLE.x + 0.9, TABLE.y + 0.04, TABLE.z + 0.1);
    this.phone.rotation.y = 0.35;
    this.scene.add(this.phone);

    people.forEach((c, i) => {
      const home = new THREE.Vector3(this.seatX(i, seats.length), SEAT_Y, COUCH_Z + 0.15);
      c.root.position.copy(home);
      c.setBase('idle');
      this.scene.add(c.root);
      this.seats.push({ c, home, busy: false });
      this.marks.push({ p: new THREE.Vector3(home.x, SEAT_Y + HEIGHT + 0.9, home.z), pad: 0.05 });
    });
    this.marks.push(
      { p: new THREE.Vector3(KETTLE.x - 1.0, 0, KETTLE.z + 0.5), pad: 0.02 },
      { p: new THREE.Vector3(KETTLE.x, KETTLE.y + 1.4, KETTLE.z), pad: 0.03 },
      { p: new THREE.Vector3(DOOR.x + 1.2, 3.1, DOOR.z), pad: 0.03 },
      { p: new THREE.Vector3(DOOR.x + 0.6, 0, DOOR.z + 0.9), pad: 0.02 },
      { p: new THREE.Vector3(TABLE.x, 0, TABLE.z + 0.7), pad: 0.03 },
      { p: new THREE.Vector3(SHELF.x, SHELF.y + 1.1, SHELF.z), pad: 0.03 },
      // Room for the words that float up from the door and the wall.
      { p: BELL_WORD.clone().add(new THREE.Vector3(0, 0.6, 0)), pad: 0.04 },
      { p: SLAM_WORD.clone().add(new THREE.Vector3(0, 0.6, 0)), pad: 0.04 },
    );
    this.floaters = new Floaters(this.scene);
    this.fit = new CameraFit(this.camera, 0.3);
    this.reset();
  }

  seatX(i: number, n: number): number {
    return COUCH_X + (i - (Math.max(2, n) - 1) / 2) * CUSHION;
  }

  private buildRoom(seats: MinigameSeat[]): void {
    const s = this.scene;
    const players = seats.length;
    const root = new THREE.Group();
    s.add(root);
    roomShell(root, { w: 20, h: 9, back: BACK, front: 9, wall: WALL_COLOR, floor: P.oak, k: K, dado: 1.3 });
    put(root, props.rug({ w: 4.2, d: 1.9, color: mix(P.terracotta, P.plum, 0.3) }), COUCH_X, 0, 0.35, 0, K);
    const wood = { tex: 'wood' as TextureName };

    withOutline(0.03, () => {
      // The couch: every player's colour on the piping of their seat.
      const n = Math.max(2, players);
      const w = n * CUSHION + 0.9;
      const fab = { tex: 'fabric' as TextureName, texScale: 1.2, texStrength: 0.85 };
      part(s, rbox(w, 0.5, 1.3, 0.12), mix(COUCH, P.ink, 0.18), COUCH_X, 0.3, COUCH_Z, fab);
      part(s, rbox(w, 1.15, 0.42, 0.14), COUCH, COUCH_X, 0.93, COUCH_Z - 0.58, fab);
      for (const side of [-1, 1]) part(s, rbox(0.42, 0.85, 1.3, 0.16), COUCH, COUCH_X + side * (w / 2 - 0.21), 0.58, COUCH_Z, fab);
      for (let i = 0; i < n; i++) {
        const x = this.seatX(i, players);
        part(s, rbox(CUSHION - 0.08, 0.24, 1.05, 0.12), mix(COUCH, '#ffffff', 0.1), x, 0.66, COUCH_Z + 0.08, fab);
        part(s, rbox(CUSHION - 0.14, 0.7, 0.3, 0.13), mix(COUCH, '#ffffff', 0.07), x, 1.2, COUCH_Z - 0.3, { ...fab, rx: -0.1 });
        const color = seats[i]?.color;
        if (color) part(s, rbox(CUSHION - 0.3, 0.05, 0.04, 0.02), color, x, 0.68, COUCH_Z + 0.61, { glow: 0.8, outline: false, shadow: false });
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(s, cyl(0.06, 0.045, 0.14, 10), P.walnut, COUCH_X + sx * (w / 2 - 0.2), 0.04, COUCH_Z + sz * 0.5, { outline: false });

      // The coffee table with a can, the remote and plates waiting for the pizza.
      part(s, rbox(2.8, 0.1, 1.1, 0.05), P.walnut, TABLE.x, TABLE.y - 0.05, TABLE.z, wood);
      part(s, rbox(2.4, 0.05, 0.85, 0.02), mix(P.walnut, P.ink, 0.25), TABLE.x, 0.24, TABLE.z, wood);
      for (const x of [-1.25, 1.25]) for (const z of [-0.4, 0.4]) part(s, rbox(0.09, 0.5, 0.09, 0.03), mix(P.walnut, P.ink, 0.25), TABLE.x + x, 0.26, TABLE.z + z, wood);
    });
    put(root, props.drink({ color: P.teal }), TABLE.x - 0.8, TABLE.y, TABLE.z - 0.1, 0, 2.2);
    put(root, props.remote(), TABLE.x - 0.1, TABLE.y, TABLE.z + 0.15, -0.5, 2.6);
    put(root, props.plates({ n: 4 }), TABLE.x + 0.25, TABLE.y, TABLE.z - 0.2, 0, 2);
    put(root, props.mug({ color: P.mustard }), TABLE.x - 0.45, TABLE.y, TABLE.z + 0.25, 0.8, 2.2);

    // The kitchen corner with the kettle.
    put(root, props.kitchenCounter({ w: 1.5, color: P.forest }), KETTLE.x, 0, BACK, 0, 1.2);
    part(root, box(1.8, 0.75, 0.04), P.ceramic, KETTLE.x, 1.52, BACK + 0.02, { tex: 'kitchenTile', gloss: 0.25, outline: false, shadow: false });
    put(root, props.wallShelf({ w: 1.2, items: 'kitchen', seed: 2 }), KETTLE.x, 3.75, BACK + 0.01, 0, K);
    withOutline(0.03, () => {
      const copper = { gloss: 0.6 };
      part(this.kettle, lathe([[0, 0], [0.3, 0], [0.32, 0.08], [0.27, 0.4], [0.2, 0.46], [0, 0.47]], 24), P.copper, 0, 0, 0, copper);
      part(this.kettle, torus(0.3, 0.02), mix(P.copper, P.ink, 0.3), 0, 0.03, 0, { rx: Math.PI / 2, outline: false });
      part(this.kettle, ball(0.06, 1), P.ink, 0, 0.5, 0, { outline: false });
      part(this.kettle, cone(0.06, 0.32, 12), P.copper, 0.3, 0.32, 0, { rz: -1.0, ...copper });
      part(this.kettle, torus(0.16, 0.03, Math.PI), P.espresso, 0, 0.48, 0, { rx: 0 });
    });
    this.kettle.position.set(KETTLE.x + 0.2, KETTLE.y + 0.05, KETTLE.z);
    s.add(this.kettle);
    put(root, props.mug({ color: P.ceramic }), KETTLE.x - 0.45, KETTLE.y + 0.04, KETTLE.z + 0.1, 0.6, 2.4);
    put(root, props.jar({ color: P.mustard }), KETTLE.x - 0.7, KETTLE.y + 0.04, KETTLE.z - 0.2, 0, 1.6);

    // The window on the street at night.
    put(root, props.windowFrame({ w: 1.4, h: 1.0, time: 'night', seed: 4 }), WINDOW.x, WINDOW.y + 0.15, BACK + 0.02, 0, K);
    put(root, props.curtains({ w: 1.4, h: 1.0, color: mix(P.mustard, P.cream, 0.25) }), WINDOW.x, WINDOW.y + 0.15, BACK + 0.02, 0, K);

    // A picture above the couch (it rattles when the neighbour's door goes).
    put(this.frame, props.pictureFrame({ w: 1.15, h: 0.72, art: 'sunset', frame: P.walnut, seed: 2 }), 0, -0.5, 0, 0, 1.4);
    this.frame.position.copy(FRAME).add(new THREE.Vector3(0, 0.5, 0));
    s.add(this.frame);

    withOutline(0.03, () => {
      // The front door with frosted glass.
      const trim = mix(WALL_COLOR, P.cream, 0.5);
      part(s, rbox(1.7, 3.0, 0.1, 0.04), trim, DOOR.x, 1.5, DOOR.z + 0.03, { shadow: false });
      part(s, rbox(1.45, 2.85, 0.12, 0.05), P.mahogany, DOOR.x, 1.43, DOOR.z + 0.08, wood);
      part(s, rbox(1.0, 1.1, 0.04, 0.03), mix(P.mahogany, P.ink, 0.25), GLASS.x, GLASS.y, DOOR.z + 0.13, { outline: false });
      for (const x of [-0.33, 0.33]) part(s, rbox(0.5, 1.0, 0.03, 0.03), mix(P.mahogany, P.ink, 0.15), DOOR.x + x, 0.75, DOOR.z + 0.15, { ...wood, outline: false, shadow: false });
      part(s, ball(0.07, 1), P.brass, DOOR.x + 0.56, 1.42, DOOR.z + 0.22, { gloss: 0.7 });
      part(s, rbox(0.36, 0.07, 0.03, 0.01), P.brass, DOOR.x, 1.42, DOOR.z + 0.16, { gloss: 0.7, outline: false });
      part(s, rbox(1.4, 0.04, 0.75, 0.02), mix(P.brick, P.ink, 0.2), DOOR.x, 0.02, DOOR.z + 0.62, { tex: 'terry', outline: false, shadow: false });
      part(s, rbox(0.14, 0.22, 0.06, 0.03), P.charcoal, DOOR.x + 1.05, 2.25, DOOR.z + 0.06);
      part(s, cyl(0.035, 0.035, 0.03, 12), P.brass, DOOR.x + 1.05, 2.2, DOOR.z + 0.1, { rx: Math.PI / 2, outline: false, gloss: 0.7 });

      // The shelf with the cat, a vase and a book.
      part(s, rbox(1.8, 0.08, 0.5, 0.03), P.walnut, SHELF.x, SHELF.y, SHELF.z, wood);
      for (const x of [-0.7, 0.7]) part(s, box(0.05, 0.22, 0.4), P.charcoal, SHELF.x + x, SHELF.y - 0.14, SHELF.z - 0.03, { outline: false });
      const cat = new THREE.Group();
      const fur = '#4a4654';
      part(cat, ball(0.24, 2), fur, 0, 0.24, 0, { sy: 1.1 });
      part(cat, pill(0.045, 0.4), fur, -0.22, 0.05, 0.05, { rz: 1.4 });
      part(this.catPaw, ball(0.07, 1), fur, 0, 0, 0);
      this.catPaw.position.set(0.16, 0.08, 0.16);
      cat.add(this.catPaw);
      part(this.catHead, ball(0.19, 2), fur, 0, 0, 0);
      for (const x of [-0.09, 0.09]) {
        part(this.catHead, cone(0.065, 0.13, 4), fur, x, 0.17, 0, { rz: -x * 1.3 });
        part(this.catHead, ball(0.03, 1), P.lamp, x * 0.75, 0.03, 0.17, { glow: 1.2, outline: false });
      }
      part(this.catHead, ball(0.02, 1), P.rose, 0, -0.03, 0.185, { outline: false });
      this.catHead.position.set(0, 0.56, 0.04);
      cat.add(this.catHead);
      cat.position.set(SHELF.x - 0.45, SHELF.y + 0.04, SHELF.z);
      s.add(cat);
      const vase = new THREE.Group();
      part(vase, lathe([[0, 0], [0.09, 0], [0.13, 0.12], [0.07, 0.27], [0.09, 0.32], [0, 0.3]], 18), P.teal, 0, 0, 0, { gloss: 0.5 });
      part(vase, pill(0.02, 0.25), P.moss, 0, 0.42, 0, { outline: false });
      part(vase, ball(0.07, 1), P.rose, 0, 0.58, 0);
      const book = new THREE.Group();
      part(book, rbox(0.34, 0.08, 0.26, 0.02), P.mustard, 0, 0.04, 0);
      part(book, rbox(0.3, 0.08, 0.24, 0.02), P.mauve, 0.02, 0.12, 0, { ry: 0.2 });
      for (const [g, x] of [
        [vase, 0.1],
        [book, 0.55],
      ] as const) {
        const home = new THREE.Vector3(SHELF.x + x, SHELF.y + 0.04, SHELF.z + 0.05);
        g.position.copy(home);
        s.add(g);
        this.knockables.push({ g, home, down: false });
      }
    });

    // The lamp, and the corners.
    put(root, props.floorLamp({ light: 18, h: 1.9 }), KETTLE.x - 1.75, 0, BACK + 1.0, 0, K);
    put(root, props.plant({ kind: 'ficus', h: 1.8, pot: P.ceramic, seed: 4 }), DOOR.x + 2.1, 0, BACK + 0.9, 0, K);
    put(root, props.pouf({ color: P.mustard }), KETTLE.x - 0.6, 0, 3.4, 0, K);
    put(root, props.plant({ kind: 'monstera', h: 1.0, pot: P.terracotta, seed: 8 }), DOOR.x + 1.9, 0, 3.6, 0, K);
    const dust = props.motes({ n: 16, area: [12, 3, 5], size: 0.05 });
    dust.position.set(0, 1, 0);
    root.add(dust);
    this.tick = props.tickProps(root);
  }

  /** Back to waiting: the door's dark, things are back on the shelf, everyone's on the couch. */
  reset(): void {
    this.silhouetteMat.opacity = 0;
    this.porchLight.intensity = 0;
    this.porchMat.color.set('#6a6458');
    this.glassMat.color.set('#39405a');
    for (const k of this.knockables) {
      k.down = false;
      k.g.position.copy(k.home);
      k.g.rotation.set(0, 0, 0);
    }
  }

  /** Something happens in the flat (or at the door). */
  happen(kind: Fake | 'bell'): void {
    const t = this.time;
    switch (kind) {
      case 'kettle':
        this.kettleUntil = t + 1.1;
        this.floaters.add(WORDS.kettle, '#e8eef8', KETTLE.clone().add(new THREE.Vector3(0.3, 1.2, 0.3)), 0.42, 1.2);
        break;
      case 'phone':
        this.phoneUntil = t + 0.7;
        this.floaters.add(WORDS.phone, '#e8eef8', this.phone.position.clone().add(new THREE.Vector3(0, 0.6, 0.2)), 0.42, 1.0);
        break;
      case 'slam':
        this.frameAt = t;
        this.floaters.add(WORDS.slam, '#e8eef8', SLAM_WORD, 0.5, 1.0);
        break;
      case 'car': {
        let k = 0;
        this.anims.push((dt) => {
          k = Math.min(1, k + dt / 1.5);
          this.sweep.position.x = -8 + 16 * k;
          this.sweepMat.opacity = Math.sin(k * Math.PI) * 0.22;
          return k >= 1;
        });
        this.floaters.add(WORDS.car, '#e8eef8', WINDOW.clone().add(new THREE.Vector3(0, 1.1, 0.3)), 0.42, 1.3);
        break;
      }
      case 'cat': {
        this.catAt = t;
        const item = this.knockables.find((k) => !k.down);
        if (item) {
          item.down = true;
          const from = item.g.position.clone();
          const to = new THREE.Vector3(from.x + 0.3, 0.02, SHELF.z + 0.7);
          let k = 0;
          this.anims.push((dt) => {
            k = Math.min(1, k + dt / 0.65);
            const tip = Math.min(1, k / 0.35);
            const fall = Math.max(0, (k - 0.35) / 0.65);
            item.g.rotation.z = -tip * 0.6 - fall * 1.0;
            item.g.position.set(from.x + (to.x - from.x) * fall, from.y + (to.y - from.y) * fall * fall, from.z + (to.z - from.z) * fall);
            return k >= 1;
          });
        }
        this.floaters.add(WORDS.cat, '#e8eef8', SHELF.clone().add(new THREE.Vector3(0, 1.2, 0.3)), 0.42, 1.1);
        break;
      }
      case 'bell': {
        this.porchMat.color.copy(PORCH_LIT);
        let k = 0;
        this.anims.push((dt) => {
          k = Math.min(1, k + dt / 0.35);
          this.silhouetteMat.opacity = 0.75 * k;
          this.porchLight.intensity = 9 * k;
          this.glassMat.color.set('#39405a').lerp(GLASS_LIT, k);
          return k >= 1;
        });
        this.floaters.add(WORDS.bell, '#ffd166', BELL_WORD, 0.6, 1.4);
        break;
      }
    }
  }

  /** Fades the delivery shadow and porch light out again. */
  leave(): void {
    let k = 0;
    this.anims.push((dt) => {
      k = Math.min(1, k + dt / 0.4);
      this.silhouetteMat.opacity = 0.75 * (1 - k);
      this.porchLight.intensity = 9 * (1 - k);
      this.glassMat.color.set('#39405a').lerp(GLASS_LIT, 1 - k);
      return k >= 1;
    });
  }

  /** Got up for nothing: hop off the couch, look around, sit back down. */
  getUp(i: number): void {
    const s = this.seats[i];
    if (!s || s.busy) return;
    s.busy = true;
    const c = s.c;
    const stand = new THREE.Vector3(s.home.x, 0, STAND_Z);
    let t = 0;
    let looking = false;
    c.react('approval', 0.5);
    this.anims.push((dt) => {
      t += dt;
      if (t < 0.35) {
        const k = t / 0.35;
        c.root.position.lerpVectors(s.home, stand, k);
        c.root.position.y += Math.sin(k * Math.PI) * 0.5;
      } else if (t < 1.45) {
        const k = (t - 0.35) / 1.1;
        c.root.position.copy(stand);
        c.root.rotation.y = Math.sin(k * Math.PI * 2) * 0.9;
        if (!looking) c.react('thinking', 1.2);
        looking = true;
      } else if (t < 1.8) {
        const k = (t - 1.45) / 0.35;
        c.root.rotation.y = 0;
        c.root.position.lerpVectors(stand, s.home, k);
        c.root.position.y += Math.sin(k * Math.PI) * 0.5;
      } else {
        c.root.position.copy(s.home);
        c.react('sad', 1.0);
        s.busy = false;
        return true;
      }
      return false;
    });
  }

  /** The winner bounces with joy. */
  cheer(i: number): void {
    const s = this.seats[i];
    if (!s || s.busy) return;
    s.c.react('happy', 1.6);
    this.sparkles.burst(this.above(i), PALETTE.lamp, 10, 1.2);
    let t = 0;
    this.anims.push((dt) => {
      t = Math.min(1, t + dt / 0.5);
      s.c.root.position.y = s.home.y + Math.sin(t * Math.PI) * 0.45;
      return t >= 1;
    });
  }

  above(i: number): THREE.Vector3 {
    const s = this.seats[i];
    return new THREE.Vector3(s?.home.x ?? 0, SEAT_Y + HEIGHT + 0.45, (s?.home.z ?? 0) + 0.3);
  }

  dispose(): void {
    this.floaters.dispose();
    this.sparkles.dispose();
    this.glassMat.dispose();
    for (const p of this.puffs) this.scene.remove(p.m);
    this.puffs = [];
    this.silhouetteMat.dispose();
    this.porchMat.dispose();
    this.sweepMat.dispose();
    this.steamMat.dispose();
    this.sweep.geometry.dispose();
    for (const s of this.seats) s.c.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.fit.update(() => this.marks);
    for (const s of this.seats) s.c.update(dt);
    this.floaters.update(dt);
    this.sparkles.update(dt);
    this.tick(dt, time);
    this.anims = this.anims.filter((a) => !a(dt));

    // Kettle: steam and a jiggle.
    const boiling = time < this.kettleUntil;
    this.kettle.rotation.z = boiling ? Math.sin(time * 40) * 0.03 : 0;
    if (boiling && Math.random() < dt * 14) {
      const m = new THREE.Mesh(ball(0.1, 1), this.steamMat);
      m.position.set(this.kettle.position.x + 0.42, this.kettle.position.y + 0.5, this.kettle.position.z);
      this.scene.add(m);
      this.puffs.push({ m, age: 0, vx: 0.2 + Math.random() * 0.3 });
    }
    this.puffs = this.puffs.filter((p) => {
      p.age += dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += dt * 0.9;
      p.m.scale.setScalar(Math.max(0.01, (1 + p.age * 2.5) * (1 - p.age / 0.9)));
      if (p.age < 0.9) return true;
      this.scene.remove(p.m);
      return false;
    });

    // Phone: buzzes across the table, screen lit.
    const buzzing = time < this.phoneUntil;
    this.screen.visible = buzzing;
    this.phone.position.x = TABLE.x + 0.9 + (buzzing ? Math.sin(time * 70) * 0.015 : 0);

    // The picture rattles; the cat swats.
    const fa = time - this.frameAt;
    this.frame.rotation.z = fa < 1.2 ? Math.sin(fa * 30) * Math.exp(-fa * 4) * 0.12 : 0;
    const ca = time - this.catAt;
    this.catPaw.position.x = 0.16 + (ca < 0.5 ? Math.sin((ca / 0.5) * Math.PI) * 0.18 : 0);
    this.catHead.rotation.y = ca < 1 ? 0.5 * Math.sin(ca * Math.PI) : Math.sin(time * 0.6) * 0.15;
  }
}

export const minigame: Minigame = {
  id: 'pizzashere',
  title: "Pizza's Here!",
  how: 'Waiting for the pizza, and the flat is full of noises. Tap only when the doorbell rings: the quickest tap wins the round. Jump up at anything else and you lose a point and sit the round out.',
  controller: 'tap',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const view = new FlatView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    const skill = seats.map(() => ctx.skill());
    const rounds: TapResult[][] = [];
    const totals = seats.map(() => 0);
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${totals[i]} pts` })));
    live();

    for (let r = 0; r < PIZZA.rounds; r++) {
      const plan = planRound(rng, r);
      view.reset();
      const results: TapResult[] = seats.map(() => null);
      const tapped = new Set<number>();
      let bellAt = Infinity; // performance.now() when the doorbell rang
      let rung = false;
      let open = true;
      session.setLayoutAll(() => ({ kind: 'tap', locked: false, label: 'Get it!', note: `Round ${r + 1} of ${PIZZA.rounds} · only the doorbell!` }));
      ui.caption(`Round ${r + 1} of ${PIZZA.rounds}: tap only for the doorbell…`);
      seats.forEach((_, i) => view.seats[i]?.c.setBase('listening'));

      /** A tap from a phone (measured here), or from a computer player (its own reaction time). */
      const onTap = (seat: number, cpuMs: number | null = null) => {
        if (!open || tapped.has(seat) || seat >= seats.length) return;
        tapped.add(seat);
        const result: TapResult = cpuMs !== null && rung ? cpuMs : judgeTap(performance.now(), bellAt, session.seats[seat]?.rtt ?? 0);
        results[seat] = result;
        if (result === 'early') {
          session.setLayout(seat, { kind: 'tap', locked: true, note: 'You got up for nothing! Sit tight until the next round.' });
          session.send(seat, { t: 'buzz', pattern: [80, 60, 80] });
          view.getUp(seat);
          view.floaters.add(`${PIZZA.falseStart}`, '#FF8FA3', view.above(seat), 0.5, 1.4);
          sfx.bad();
        } else {
          session.setLayout(seat, { kind: 'tap', locked: true, note: `${result} ms` });
          view.seats[seat]?.c.react('approval', 0.8);
          sfx.tick();
        }
      };
      const off = session.onInput((seat, msg) => {
        if (msg.t === 'tap' && !session.isCpu(seat)) onTap(seat);
      });

      // Noises, then the doorbell.
      const cpu = seats.map((_, i) => (session.isCpu(i) ? cpuRound(rng, plan, skill[i] ?? 0.5) : null));
      let next = 0;
      await everyFrame(clock, (_, t) => {
        while (next < plan.fakes.length && t >= (plan.fakes[next]?.at ?? Infinity)) {
          const kind = (plan.fakes[next] as { kind: Fake }).kind;
          view.happen(kind);
          sound(sfx, kind);
          next++;
        }
        cpu.forEach((c, i) => {
          if (c && c.jumpAt !== null && t >= c.jumpAt && t < plan.bellAt) onTap(i);
        });
        return t >= plan.bellAt;
      });
      bellAt = performance.now();
      rung = true;
      view.happen('bell');
      sound(sfx, 'bell');
      ui.caption('Ding dong!');
      cpu.forEach((c, i) => {
        if (c && c.jumpAt === null && !tapped.has(i)) void clock.wait(c.reactMs / 1000).then(() => onTap(i, c.reactMs));
      });
      await clock.wait(PIZZA.window);
      open = false;
      off();

      // Who got there first?
      rounds.push(results);
      const pts = roundPoints(results);
      const winner = pts.findIndex((p) => p === PIZZA.win);
      pts.forEach((p, i) => {
        totals[i] = (totals[i] ?? 0) + p;
        if (p === PIZZA.win) {
          view.cheer(i);
          view.floaters.add(`+${p} · ${results[i]} ms`, seats[i]?.color ?? '#fff', view.above(i), 0.5, 1.6);
        }
      });
      if (winner >= 0) {
        sfx.good();
        ui.caption(`${seats[winner]?.name ?? '?'} gets the door. Pizza!`);
      } else {
        ui.caption('Nobody got up… the pizza waits on the doorstep.');
      }
      seats.forEach((_, i) => {
        if (results[i] === 'early') return;
        const note = pts[i] === PIZZA.win ? 'You got the door! Pizza!' : typeof results[i] === 'number' ? `${results[i]} ms, just behind.` : 'Missed the doorbell!';
        session.setLayout(i, { kind: 'tap', locked: true, note });
      });
      live();
      await clock.wait(1.2);
      view.leave();
      await clock.wait(0.35);
    }

    ui.caption(null);
    view.floaters.dispose();
    return {
      scores: pizzaScores(rounds, seats.length),
      details: seats.map((_, i) => {
        const wins = rounds.filter((r) => roundPoints(r)[i] === PIZZA.win).length;
        const early = rounds.filter((r) => r[i] === 'early').length;
        return `${totals[i]} pts · ${wins} door${wins === 1 ? '' : 's'}${early ? ` · up ${early}× for nothing` : ''}`;
      }),
    };
  },
};
