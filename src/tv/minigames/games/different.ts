// Something's Off on the TV: a cosy living room seen like a doll's house, everyone lined up at the front. The
// lights flicker off for a moment; when they come back one thing is different. After the guesses the room
// quietly puts itself right again, so you can see what it was.
import * as THREE from 'three';
import { CHANGE_WORDS, DIFFERENT, type DiffRound, THINGS, cpuAnswer, differentScores, planGame, roundPoints } from '../../../game/minigames/different';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import type { TextureName } from '../../render/textures';
import { PALETTE, ball, box, cone, cyl, dome, gem, lathe, mix, part, pill, rbox, setLook, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, lanes, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const ROW_Z = 3.7; // where everyone stands, in front of the room
const HEIGHT = 1.0; // companion height
const DARK_BG = new THREE.Color('#0b0910');
const P = PALETTE;
const K = 1.5; // the room is a doll's house seen from afar: props at this scale
const BACK = -3.6; // the back wall's face (z)
const OUTLINE = 0.7; // how bright outlines are with the lights on

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

interface ThingSpec {
  /** Centre of the thing. */
  at: [number, number, number];
  /** From the centre to the top (where a hat goes). */
  top: number;
  /** Rough radius, for the ring that shows what changed. */
  size: number;
  color: string;
  /** A small tilt (the guitar leans on the wall). */
  lean?: number;
  /** Where it moves to (x, z) for dir -1 and dir 1, at full size. */
  moves: [[number, number], [number, number]];
  build(g: THREE.Group, color: string): void;
}

/** The ten things, in the order of THINGS. Each is built round its own centre, so it can turn upside down. */
const SPECS: ThingSpec[] = [
  {
    // Plant
    at: [4.9, 0.95, -2.3],
    top: 0.95,
    size: 0.9,
    color: '#e07a5f',
    moves: [
      [-0.9, 0.9],
      [0, 1.4],
    ],
    build(g, c) {
      part(g, lathe([[0, -0.95], [0.3, -0.95], [0.42, -0.27], [0.45, -0.25], [0.45, -0.19], [0.36, -0.19], [0.3, -0.85], [0, -0.85]], 22), c, 0, 0, 0, { gloss: 0.25 });
      part(g, torus(0.44, 0.045), mix(c, '#ffffff', 0.2), 0, -0.22, 0, { rx: Math.PI / 2, outline: false, gloss: 0.3 });
      part(g, cyl(0.37, 0.37, 0.04, 18), PALETTE.soilDark, 0, -0.27, 0, { outline: false });
      part(g, ball(0.4, 2), PALETTE.fern, 0, 0.18, 0);
      part(g, ball(0.3, 2), PALETTE.leafDark, -0.32, 0.0, 0.08);
      part(g, ball(0.3, 2), PALETTE.moss, 0.32, 0.08, -0.05);
      part(g, ball(0.26, 2), PALETTE.leaf, 0.06, 0.62, 0.02);
    },
  },
  {
    // Lamp
    at: [-4.7, 1.5, -2.5],
    top: 1.5,
    size: 1.1,
    color: '#ffd166',
    moves: [
      [1.2, 0.6],
      [0.2, 1.5],
    ],
    build(g, c) {
      part(g, cyl(0.4, 0.45, 0.08, 24), PALETTE.charcoal, 0, -1.46, 0, { gloss: 0.4 });
      part(g, cyl(0.04, 0.04, 2.3, 10), PALETTE.brass, 0, -0.3, 0, { gloss: 0.6, outline: 0.015 });
      part(g, cyl(0.36, 0.62, 0.72, 28), c, 0, 1.12, 0, { glow: 0.45, tex: 'fabric', texStrength: 0.5 });
      for (const y of [0.78, 1.46]) part(g, torus(y < 1 ? 0.615 : 0.365, 0.02), mix(c, PALETTE.ink, 0.3), 0, y, 0, { rx: Math.PI / 2, outline: false, shadow: false });
      part(g, ball(0.14, 1), PALETTE.lamp, 0, 0.78, 0, { glow: 1.6, shadow: false });
    },
  },
  {
    // Cat
    at: [-2.5, 0.5, 1.0],
    top: 0.5,
    size: 0.55,
    color: '#f2a65a',
    moves: [
      [-1.2, 0],
      [0, 1.0],
    ],
    build(g, c) {
      part(g, ball(0.34, 2), c, 0, -0.2, 0, { sy: 1.1 });
      part(g, ball(0.2, 2), PALETTE.cream, 0, -0.18, 0.2, { sz: 0.6 });
      part(g, pill(0.06, 0.5), c, 0.32, -0.36, -0.15, { rz: -1.1, ry: 0.4 });
      part(g, ball(0.26, 2), c, 0, 0.22, 0.1);
      for (const x of [-0.13, 0.13]) {
        part(g, cone(0.09, 0.18, 4), c, x, 0.47, 0.08, { rz: -x * 1.3 });
        part(g, ball(0.035, 1), PALETTE.ink, x * 0.7, 0.26, 0.34, { outline: false });
      }
      part(g, ball(0.03, 1), PALETTE.rose, 0, 0.2, 0.36, { outline: false });
      for (const x of [-0.06, 0.06]) part(g, rbox(0.3, 0.012, 0.012, 0.004), PALETTE.cream, x * 3.2, 0.19, 0.33, { rz: x * 2.5, outline: false, shadow: false });
    },
  },
  {
    // Pizza box
    at: [-1.25, 0.79, 0.2],
    top: 0.09,
    size: 0.6,
    color: '#e6d2a8',
    moves: [
      [-0.5, 0.25],
      [0.35, 0.4],
    ],
    build(g, c) {
      part(g, rbox(1.0, 0.16, 1.0, 0.03), c, 0, 0, 0);
      part(g, rbox(1.0, 0.012, 0.02, 0.004), mix(c, PALETTE.ink, 0.3), 0, 0.03, 0.5, { outline: false, shadow: false });
      part(g, cyl(0.2, 0.2, 0.02, 24), PALETTE.brick, 0, 0.085, 0.05, { outline: false });
      part(g, cyl(0.12, 0.12, 0.022, 20), mix(c, '#ffffff', 0.2), 0, 0.086, 0.05, { outline: false });
      part(g, rbox(0.5, 0.02, 0.06, 0.01), PALETTE.brick, 0, 0.085, 0.36, { outline: false });
    },
  },
  {
    // Clock
    at: [1.8, 3.9, -3.5],
    top: 0.45,
    size: 0.5,
    color: '#5aa7e2',
    moves: [
      [-1.1, 0],
      [1.1, 0],
    ],
    build(g, c) {
      part(g, cyl(0.44, 0.44, 0.1, 32), c, 0, 0, 0, { rx: Math.PI / 2, gloss: 0.5 });
      part(g, cyl(0.36, 0.36, 0.04, 32), PALETTE.cream, 0, 0, 0.05, { rx: Math.PI / 2, outline: false });
      part(g, ball(0.055, 1), PALETTE.ink, 0, 0.27, 0.08, { outline: false });
      for (const [x, y] of [
        [0.27, 0],
        [0, -0.27],
        [-0.27, 0],
      ] as const) {
        part(g, ball(0.03, 1), PALETTE.stone, x, y, 0.08, { outline: false });
      }
      // Ten past ten.
      part(g, rbox(0.045, 0.2, 0.02, 0.01), PALETTE.ink, -0.08, 0.05, 0.09, { rz: 1.0, outline: false });
      part(g, rbox(0.035, 0.28, 0.02, 0.01), PALETTE.ink, 0.11, 0.07, 0.1, { rz: -0.95, outline: false });
      part(g, ball(0.04, 1), PALETTE.accent, 0, 0, 0.11, { outline: false });
    },
  },
  {
    // Mug
    at: [0.1, 0.9, 0.0],
    top: 0.2,
    size: 0.3,
    color: '#e2525a',
    moves: [
      [-0.45, 0.35],
      [0.4, 0.5],
    ],
    build(g, c) {
      part(g, cyl(0.16, 0.14, 0.4, 20), c, 0, 0, 0, { gloss: 0.5 });
      part(g, torus(0.1, 0.035), c, 0.19, 0.02, 0, { gloss: 0.5 });
      part(g, cyl(0.14, 0.14, 0.02, 20), '#5a3a2a', 0, 0.19, 0, { outline: false });
      part(g, torus(0.15, 0.012), mix(c, '#ffffff', 0.3), 0, 0.2, 0, { rx: Math.PI / 2, outline: false, shadow: false });
      part(g, rbox(0.14, 0.08, 0.02, 0.01), PALETTE.cream, 0, 0.02, 0.15, { outline: false });
    },
  },
  {
    // Poster
    at: [-2.4, 3.4, -3.52],
    top: 1.0,
    size: 1.15,
    color: '#9b7bd4',
    moves: [
      [-1.2, 0],
      [1.0, 0],
    ],
    build(g, c) {
      part(g, rbox(1.5, 2.0, 0.07, 0.03), PALETTE.walnut, 0, 0, 0, { tex: 'wood' });
      part(g, rbox(1.38, 1.88, 0.04, 0.02), PALETTE.cream, 0, 0, 0.025, { outline: false, shadow: false });
      part(g, rbox(1.26, 1.76, 0.04, 0.02), c, 0, 0, 0.03, { outline: false, shadow: false });
      part(g, ball(0.3, 2), PALETTE.mustard, -0.1, 0.28, 0.06, { sz: 0.2, outline: false, shadow: false });
      part(g, torus(0.48, 0.03), PALETTE.sand, -0.1, 0.28, 0.07, { rx: 1.25, rz: 0.35, outline: false, shadow: false });
      part(g, gem(0.09), PALETTE.cream, 0.42, 0.68, 0.07, { outline: false, shadow: false });
      part(g, gem(0.05), PALETTE.cream, -0.46, 0.55, 0.07, { outline: false, shadow: false });
      part(g, rbox(0.9, 0.09, 0.02, 0.02), PALETTE.cream, 0, -0.56, 0.06, { outline: false, shadow: false });
      part(g, rbox(0.6, 0.07, 0.02, 0.02), PALETTE.cream, -0.15, -0.72, 0.06, { outline: false, shadow: false });
    },
  },
  {
    // Guitar
    at: [3.2, 1.25, -3.15],
    top: 1.3,
    size: 1.2,
    color: '#e07a3a',
    lean: -0.14,
    moves: [
      [-1.0, 0],
      [0.6, 0.2],
    ],
    build(g, c) {
      const wood = { tex: 'wood' as TextureName, texStrength: 0.7, gloss: 0.3 };
      part(g, ball(0.5, 2), c, 0, -0.68, 0, { sz: 0.3, ...wood });
      part(g, ball(0.38, 2), c, 0, -0.14, 0, { sz: 0.3, ...wood });
      part(g, cyl(0.13, 0.13, 0.04, 20), PALETTE.espresso, 0, -0.36, 0.13, { rx: Math.PI / 2, outline: false });
      part(g, torus(0.15, 0.012), mix(c, PALETTE.ink, 0.45), 0, -0.36, 0.145, { outline: false, shadow: false });
      part(g, rbox(0.3, 0.06, 0.04, 0.02), PALETTE.walnut, 0, -0.78, 0.15, { outline: false });
      part(g, rbox(0.12, 1.05, 0.08, 0.03), PALETTE.walnut, 0, 0.62, 0.02, { tex: 'darkWood' });
      for (const x of [-0.03, 0, 0.03]) part(g, cyl(0.004, 0.004, 1.75, 4), PALETTE.sand, x, 0.2, 0.17, { outline: false, shadow: false });
      part(g, rbox(0.2, 0.26, 0.08, 0.04), PALETTE.espresso, 0, 1.2, 0.02);
      for (const y of [1.12, 1.26]) for (const x of [-0.13, 0.13]) part(g, ball(0.03, 1), PALETTE.stone, x, y, 0.04, { outline: false, gloss: 0.6 });
    },
  },
  {
    // Sock
    at: [2.6, 0.12, 1.6],
    top: 0.12,
    size: 0.5,
    color: '#7ad18c',
    moves: [
      [-1.0, 0.3],
      [1.0, -0.2],
    ],
    build(g, c) {
      const knit = { tex: 'knit' as TextureName, texScale: 0.3 };
      part(g, pill(0.12, 0.45), c, -0.12, 0, 0, { rz: Math.PI / 2, ...knit });
      part(g, pill(0.12, 0.26), c, 0.22, 0, 0.17, { rx: Math.PI / 2, ...knit });
      part(g, ball(0.125, 2), mix(c, PALETTE.ink, 0.18), 0.22, 0, 0.0, knit);
      part(g, cyl(0.125, 0.125, 0.08, 14), PALETTE.cream, -0.36, 0, 0, { rz: Math.PI / 2, outline: false });
      part(g, cyl(0.126, 0.126, 0.05, 14), PALETTE.cream, -0.2, 0, 0, { rz: Math.PI / 2, outline: false });
    },
  },
  {
    // Snack bowl
    at: [1.3, 0.83, 0.4],
    top: 0.2,
    size: 0.45,
    color: '#5cbfa8',
    moves: [
      [0.4, 0.3],
      [-0.45, 0.4],
    ],
    build(g, c) {
      part(g, dome(0.38), c, 0, 0.08, 0, { rx: Math.PI, sy: 0.5, gloss: 0.5 });
      part(g, torus(0.37, 0.02), mix(c, '#ffffff', 0.25), 0, 0.08, 0, { rx: Math.PI / 2, outline: false, gloss: 0.5 });
      part(g, cyl(0.34, 0.34, 0.03, 18), '#e9b955', 0, 0.07, 0, { outline: false });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        part(g, rbox(0.16, 0.03, 0.12, 0.015), i % 2 ? '#e9b955' : '#dca43f', Math.cos(a) * 0.18, 0.11 + (i % 3) * 0.02, Math.sin(a) * 0.15, { ry: a, rz: 0.4, outline: false });
      }
    },
  },
];

/** Turns a colour round the colour wheel: a long way when `amount` is 1, a little when it's small. */
function shiftColour(color: string, amount: number, dir: number): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl);
  const h = (((hsl.h + dir * (0.12 + 0.33 * amount)) % 1) + 1) % 1;
  return `#${new THREE.Color().setHSL(h, Math.max(hsl.s, 0.5), Math.min(0.7, Math.max(0.42, hsl.l))).getHexString()}`;
}

class Thing {
  readonly root = new THREE.Group();
  readonly home: THREE.Vector3;
  body = new THREE.Group();
  hat: THREE.Group | null = null;

  constructor(readonly spec: ThingSpec) {
    this.home = new THREE.Vector3(...spec.at);
    this.root.position.copy(this.home);
    this.root.rotation.z = spec.lean ?? 0;
    this.paint(spec.color);
  }

  paint(color: string): void {
    this.root.remove(this.body);
    this.body = new THREE.Group();
    withOutline(0.03, () => this.spec.build(this.body, color));
    this.root.add(this.body);
  }

  /** A tiny party hat on top, `s` times the normal size. */
  addHat(s: number): void {
    const hat = new THREE.Group();
    part(hat, cone(0.13, 0.32, 20), PALETTE.rose, 0, 0.16, 0, { gloss: 0.3 });
    for (const y of [0.1, 0.2]) part(hat, torus(0.13 * (1 - y / 0.32) + 0.004, 0.012), PALETTE.mustard, 0, y, 0, { rx: Math.PI / 2, outline: false, shadow: false });
    part(hat, torus(0.12, 0.025), PALETTE.cream, 0, 0.02, 0, { rx: Math.PI / 2, outline: false });
    part(hat, ball(0.05, 1), PALETTE.cream, 0, 0.34, 0, { outline: false });
    hat.scale.setScalar(s);
    hat.userData.size = s;
    hat.position.set(0, this.spec.top, 0);
    hat.rotation.z = 0.15;
    this.root.add(hat);
    this.hat = hat;
  }

  /** Where the label goes. */
  above(): THREE.Vector3 {
    return this.home.clone().add(new THREE.Vector3(0, this.spec.top + 0.6, 0.3));
  }
}

/** A light switch click and the soft buzz of a bulb. */
function click(sfx: Sfx, on: boolean): void {
  noise(sfx, { dur: 0.05, filter: 'highpass', freq: on ? 2600 : 1800, gain: 0.22 });
  if (on) tone(sfx, { freq: 110, type: 'sawtooth', dur: 0.35, gain: 0.025 });
}

class RoomView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly things: Thing[];
  readonly floaters: Floaters;
  private readonly fit: CameraFit;
  private readonly marks: Mark[] = [];
  private lights: { light: THREE.Light; base: number }[] = [];
  private bg = new THREE.Color();
  private readonly sparkles = new Sparkles(this.scene);
  private tick: (dt: number, time: number) => void = () => {};
  private ring: THREE.Mesh | null = null;
  private ringAge = 0;

  constructor(
    seats: MinigameSeat[],
    readonly people: Companion[],
  ) {
    // Evening in the living room: one warm key from above, plum shade, and the floor lamp's own pool of light.
    const rig = lightRig(this.scene, 'lampInterior', { shadowSize: 10, fog: { near: 34, far: 90 } });
    rig.sun.target.position.set(0, 0, 0);
    this.bg.copy(this.scene.background as THREE.Color);
    const lamp = new THREE.PointLight(PALETTE.lamp, 22, 11, 1.5);
    lamp.position.set(-4.4, 2.3, -1.9);
    this.scene.add(lamp);
    this.buildRoom();
    this.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) this.lights.push({ light: o as THREE.Light, base: (o as THREE.Light).intensity });
    });
    this.things = SPECS.map((s) => new Thing(s));
    for (const t of this.things) {
      this.scene.add(t.root);
      this.marks.push({ p: t.home.clone(), pad: 0.04 }, { p: t.above(), pad: 0.05 });
    }
    const xs = lanes(seats.length, 1.6);
    seats.forEach((s, i) => {
      const c = people[i];
      const x = xs[i] ?? 0;
      part(this.scene, torus(0.45, 0.04), s.color, x, 0.03, ROW_Z, { rx: Math.PI / 2, glow: 1.1, outline: false, shadow: false });
      if (c) {
        c.root.position.set(x, 0, ROW_Z);
        c.setBase('listening');
        this.scene.add(c.root);
      }
      this.marks.push({ p: new THREE.Vector3(x, 0, ROW_Z), pad: 0.05 }, { p: new THREE.Vector3(x, HEIGHT + 0.7, ROW_Z), pad: 0.06 });
    });
    this.floaters = new Floaters(this.scene);
    this.fit = new CameraFit(this.camera, 0.4);
  }

  private buildRoom(): void {
    const s = this.scene;
    const root = new THREE.Group();
    s.add(root);
    roomShell(root, { w: 16, h: 9, back: BACK, front: 9, wall: P.duskWall, floor: P.oak, k: K, dado: 1.45 });
    // A round rug and the coffee table.
    const terry = { tex: 'terry' as TextureName, texScale: 0.9, outline: false as const, shadow: false };
    const rug = mix(P.terracotta, P.plum, 0.3);
    part(root, cyl(2.8, 2.8, 0.04, 48), mix(rug, P.cream, 0.5), -0.2, 0.02, 0.6, { sz: 0.55, ...terry });
    part(root, cyl(2.55, 2.55, 0.04, 48), rug, -0.2, 0.03, 0.6, { sz: 0.55, ...terry });
    part(root, cyl(1.5, 1.5, 0.04, 40), mix(rug, P.ink, 0.14), -0.2, 0.038, 0.6, { sz: 0.55, ...terry });
    put(root, props.coffeeTable({ w: 4.0 / K, d: 1.6 / K, h: 0.7 / K, color: P.walnut }), 0, 0, 0.2, 0, K);
    // The couch at the back: not one of the things, it never changes.
    put(root, props.sofa({ seats: 2, seatW: 1.25, color: P.denim, pillows: [P.mustard, P.rose] }), 0, 0, -2.82, 0, K);
    // The wall and the corners, dressed with things that aren't on the list (no second plant, lamp or clock).
    put(root, props.windowFrame({ w: 1.3, h: 1.5, time: 'dusk', seed: 5 }), -6.5, 3.75, BACK + 0.02, 0, K);
    put(root, props.curtains({ w: 1.3, h: 1.5, color: mix(P.mauve, P.cream, 0.25) }), -6.5, 3.75, BACK + 0.02, 0, K);
    put(root, props.bookshelf({ w: 1.25, h: 2.1, seed: 7 }), 6.95, 0, BACK + 0.32, 0, K);
    put(root, props.sideboard({ w: 2.0 }), -7.62, 0, 0.7, Math.PI / 2, K);
    put(root, props.recordPlayer({ playing: true }), -7.62, 0.42 * K, 1.2, Math.PI / 2, K);
    put(root, props.books(0.5, 4, { h: 0.2 }), -7.6, 0.42 * K, -0.4, Math.PI / 2, K);
    put(root, props.speaker({ h: 0.9 }), -7.4, 0, -1.6, Math.PI / 2, K);
    put(root, props.wallShelf({ w: 1.3, seed: 5 }), 7.99, 3.4, -0.6, -Math.PI / 2, K);
    put(root, props.armchair({ color: P.terracotta, pillow: P.cream }), 6.7, 0, 0.9, -Math.PI / 2 + 0.45, K);
    // Foreground: a pouf and a folded blanket, low in the corners.
    put(root, props.pouf({ color: P.mustard }), -6.4, 0, 4.6, 0, K);
    put(root, props.crate({ s: 0.5 }), 6.9, 0, 4.7, 0.3, K);
    part(root, rbox(0.9, 0.2, 0.7, 0.08), P.teal, 6.9, 0.5 * K + 0.1, 4.7, { tex: 'knit', ry: 0.3 });
    const dust = props.motes({ n: 16, area: [12, 3, 5], size: 0.05 });
    dust.position.set(0, 1, 0);
    root.add(dust);
    this.tick = props.tickProps(root);
  }

  /** 1 = lights on, 0 = off. */
  setLight(k: number): void {
    for (const l of this.lights) l.light.intensity = l.base * (0.04 + 0.96 * k);
    setLook(this.scene, { outline: OUTLINE * (0.06 + 0.94 * k) });
    (this.scene.background as THREE.Color).copy(DARK_BG).lerp(this.bg, k);
    this.scene.fog?.color.copy(this.scene.background as THREE.Color);
  }

  /** The changed thing as it is now. */
  apply(round: DiffRound): void {
    const t = this.things[round.thing];
    if (!t) return;
    switch (round.change) {
      case 'gone':
        t.root.visible = false;
        break;
      case 'flip':
        t.body.rotation.z = Math.PI;
        break;
      case 'colour':
        t.paint(shiftColour(t.spec.color, round.amount, round.dir));
        break;
      case 'hat':
        t.addHat(0.6 + 0.6 * round.amount);
        break;
      case 'move': {
        const [dx, dz] = t.spec.moves[round.dir < 0 ? 0 : 1];
        const k = 0.45 + 0.55 * round.amount;
        t.root.position.set(t.home.x + dx * k, t.home.y, t.home.z + dz * k);
        break;
      }
    }
  }

  /** Puts the thing right again, with a little animation (k from 0 to 1). */
  undo(round: DiffRound, k: number): void {
    const t = this.things[round.thing];
    if (!t) return;
    switch (round.change) {
      case 'gone':
        t.root.visible = true;
        t.root.scale.setScalar(Math.max(0.01, k));
        break;
      case 'flip':
        t.body.rotation.z = Math.PI * (1 - k);
        break;
      case 'colour':
        if (k >= 0.5 && t.body.userData.fixed !== true) {
          t.paint(t.spec.color);
          t.body.userData.fixed = true;
        }
        t.body.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.12);
        break;
      case 'hat':
        if (t.hat) {
          t.hat.scale.setScalar(Math.max(0.001, (t.hat.userData.size as number) * (1 - k)));
          t.hat.position.y = t.spec.top + k * 0.6;
          if (k >= 1) {
            t.root.remove(t.hat);
            t.hat = null;
          }
        }
        break;
      case 'move':
        t.root.position.lerp(t.home, k);
        break;
    }
    if (k >= 1) {
      t.root.position.copy(t.home);
      t.root.scale.setScalar(1);
      t.root.visible = true;
      t.body.rotation.z = 0;
      t.body.scale.setScalar(1);
      t.body.userData.fixed = false;
    }
  }

  /** A soft gold ring round the thing that changed. */
  showRing(thing: number): void {
    this.hideRing();
    const t = this.things[thing];
    if (!t) return;
    const ring = new THREE.Mesh(torus(t.spec.size, 0.04), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp).multiplyScalar(1.5), transparent: true, opacity: 0.95 }));
    ring.position.copy(t.home).add(new THREE.Vector3(0, 0, 0.35));
    ring.renderOrder = 4;
    this.scene.add(ring);
    this.ring = ring;
    this.ringAge = 0;
    this.sparkles.burst(ring.position, PALETTE.lamp, 10, 1.2);
  }

  hideRing(): void {
    if (!this.ring) return;
    this.scene.remove(this.ring);
    (this.ring.material as THREE.Material).dispose();
    this.ring = null;
  }

  above(seat: number): THREE.Vector3 {
    const c = this.people[seat];
    return new THREE.Vector3(c?.root.position.x ?? 0, HEIGHT + 0.55, ROW_Z);
  }

  dispose(): void {
    this.hideRing();
    this.floaters.dispose();
    this.sparkles.dispose();
    for (const c of this.people) c.dispose();
  }

  /** Sparkles over a player who got it right. */
  cheer(seat: number, color: string): void {
    this.sparkles.burst(this.above(seat), color, 8, 1.1);
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    for (const c of this.people) c.update(dt);
    this.floaters.update(dt);
    this.sparkles.update(dt);
    this.tick(dt, time);
    if (this.ring) {
      this.ringAge += dt;
      // lands with a little overshoot, then breathes
      const land = Math.min(1, this.ringAge / 0.3);
      this.ring.scale.setScalar((1.5 - 0.5 * (1 - (1 - land) ** 3)) * (1 + Math.sin(this.ringAge * 6) * 0.05));
    }
  }
}

export const minigame: Minigame = {
  id: 'different',
  title: "Something's Off",
  how: 'Take a good look at the room. The lights flicker, and when they come back one thing has changed. Pick it on your phone: fastest right answers score most, and you only get one guess per round.',
  controller: 'buttons',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const view = new RoomView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    const skill = seats.map(() => ctx.skill());
    const plan = planGame(rng);
    const points = seats.map(() => 0);
    const spotted = seats.map(() => 0);
    const totalTime = seats.map(() => 0);
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${points[i]} pts` })));
    live();

    for (let r = 0; r < plan.length; r++) {
      const round = plan[r] as DiffRound;
      const look = DIFFERENT.look[r] ?? 2;

      // 1. Take a good look.
      session.setLayoutAll(() => ({ kind: 'wait', title: 'Take a good look…', text: `Round ${r + 1} of ${plan.length}: something is about to change.` }));
      ui.caption(`Round ${r + 1} of ${plan.length}: take a good look at the room…`);
      seats.forEach((_, i) => view.people[i]?.setBase('listening'));
      await everyFrame(clock, (_, t) => {
        ui.timer(look - t);
        return t >= look;
      });
      ui.timer(null);

      // 2. The lights flicker off, something changes, they come back.
      click(sfx, false);
      seats.forEach((_, i) => view.people[i]?.react('approval', DIFFERENT.dark + 0.4));
      let changed = false;
      let wasOn = false;
      await everyFrame(clock, (_, t) => {
        const d = DIFFERENT.dark;
        // Off, a weak flicker, off, then on with a stutter.
        const on = (t > 0.12 && t < 0.17) || (t > d && t < d + 0.06) || t > d + 0.11;
        view.setLight(on ? (t < d ? 0.35 : 1) : 0);
        if (!changed && t > d * 0.45) {
          changed = true;
          view.apply(round);
        }
        if (on && !wasOn && t > d) click(sfx, true);
        wasOn = on;
        return t > d + 0.15;
      });
      view.setLight(1);

      // 3. What changed?
      const rightAt: (number | null)[] = seats.map(() => null);
      const done = seats.map(() => false);
      const cpu = seats.map((_, i) => (session.isCpu(i) ? cpuAnswer(rng, round, skill[i] ?? 0.5) : null));
      let now = 0;
      let order = 0;
      session.setLayoutAll(() => ({
        kind: 'buttons',
        title: 'What changed?',
        buttons: round.options.map((o) => ({ label: THINGS[o] ?? '?' })),
        note: `Round ${r + 1} of ${plan.length} · one guess!`,
      }));
      ui.caption("What's different? Pick it on your phone!");
      seats.forEach((_, i) => view.people[i]?.setBase('thinking'));

      const answer = (seat: number, index: number, at: number) => {
        if (done[seat] || seat >= seats.length || index < 0 || index >= round.options.length) return;
        done[seat] = true;
        const c = view.people[seat];
        if (index === round.answer) {
          rightAt[seat] = Math.max(0, at);
          order++;
          sfx.good();
          session.send(seat, { t: 'feedback', good: true, text: 'Spotted it!' });
          session.setLayout(seat, { kind: 'wait', title: 'Spotted it!', text: order === 1 ? 'And you were first.' : 'Nice one.' });
          c?.setBase('happy');
          c?.react('happy', 1.2);
          view.floaters.add(order === 1 ? 'First!' : 'Yes!', seats[seat]?.color ?? '#fff', view.above(seat), 0.45, 1.2);
          view.cheer(seat, seats[seat]?.color ?? '#fff');
        } else {
          sfx.bad();
          session.send(seat, { t: 'feedback', good: false, text: `Not the ${THINGS[round.options[index] ?? 0]?.toLowerCase() ?? 'that'}!` });
          session.send(seat, { t: 'buzz', pattern: [120] });
          session.setLayout(seat, { kind: 'wait', title: 'Not that one!', text: 'Sit tight until the next round.' });
          c?.setBase('sad');
          c?.react('sad', 1.0);
          view.floaters.add('Hmm…', '#d8e2ff', view.above(seat), 0.4, 1.2);
        }
      };
      const off = session.onInput((seat, msg) => {
        if (msg.t === 'press' && !session.isCpu(seat)) answer(seat, msg.index, now - (session.seats[seat]?.rtt ?? 0) / 2000);
      });
      await everyFrame(clock, (_, t) => {
        now = t;
        cpu.forEach((a, i) => {
          if (a && !done[i] && t >= a.at) answer(i, a.pick, a.at);
        });
        ui.timer(DIFFERENT.answerTime - t);
        return t >= DIFFERENT.answerTime || done.every(Boolean);
      });
      off();
      ui.timer(null);

      // 4. Show what it was, score, and put the room right again.
      const pts = roundPoints(rightAt);
      pts.forEach((p, i) => {
        points[i] = (points[i] ?? 0) + p;
        totalTime[i] = (totalTime[i] ?? 0) + (rightAt[i] ?? DIFFERENT.answerTime + 2);
        if (rightAt[i] !== null) spotted[i] = (spotted[i] ?? 0) + 1;
        if (p > 0) view.floaters.add(`+${p}`, seats[i]?.color ?? '#fff', view.above(i), 0.5, 1.4);
      });
      live();
      session.setLayoutAll(() => ({ kind: 'wait', title: r + 1 < plan.length ? 'Next round coming up…' : 'Counting up…', text: `It was the ${THINGS[round.thing]?.toLowerCase() ?? '?'}.` }));
      const thing = view.things[round.thing];
      view.showRing(round.thing);
      tone(sfx, { freq: 880, to: 1320, dur: 0.25, gain: 0.08 });
      if (thing) view.floaters.add(`${THINGS[round.thing]}: ${CHANGE_WORDS[round.change]}`, '#ffd166', thing.above(), 0.42, 2.2);
      ui.caption(`It was the ${THINGS[round.thing]?.toLowerCase() ?? '?'}. ${CHANGE_WORDS[round.change]}`);
      await clock.wait(1.2);
      await clock.tween(0.6, (k) => view.undo(round, k));
      view.undo(round, 1);
      await clock.wait(0.4);
      view.hideRing();
      seats.forEach((_, i) => view.people[i]?.setBase('listening'));
    }

    ui.caption(null);
    ui.timer(null);
    view.floaters.dispose();
    return {
      scores: differentScores(points, totalTime),
      details: points.map((p, i) => `${p} pts · spotted ${spotted[i]} of ${plan.length}`),
    };
  },
};
