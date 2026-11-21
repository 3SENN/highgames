// S'mores Night on the TV: a campfire in a clearing under the stars. Everyone stands round the fire with a long
// stick; tilting moves the marshmallow in toward the flames and back out. A toast meter over each head shows how
// brown it is, finished golden ones go into s'mores on a plate by the fire, and now and then a gust makes the
// flames flare up toward someone.
import * as THREE from 'three';
import {
  SMORES,
  type Campfire,
  type Roast,
  type RoastEvent,
  type SmoresCpu,
  cpuSmoresTilt,
  doneness,
  finishCampfire,
  gustNow,
  newCampfire,
  newSmoresCpu,
  seatAngle,
  smoresCoop,
  stepCampfire,
  tiltToReach,
} from '../../../game/minigames/smores';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ROUNDED_FONT, addOutline, ball, canvasTexture, cone, cyl, mix, nameCard, outlineMaterial, part, plane, rbox, seeded, toonMat, torus } from '../../render/toon';
import type { Sfx } from '../../audio';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const STEP = 1 / 60; // rules step
const RING = 2.9; // where everyone stands, round the fire
const OUT_R = 1.55; // the marshmallow held back: this far from the middle …
const OUT_Y = 1.45; // … and this high
const IN_R = 0.16; // right in the flames
const IN_Y = 0.85;
const HAND_Y = 0.78;
const PLATE = new THREE.Vector3(2.9, 0, 2.35);
const PLATE_Y = 0.66; // top of the stump the plate sits on
const SIGN = new THREE.Vector3(4.6, 0, 1.6);
const EMBERS = 22;
const FIRE = 11; // the fire's light on everyone round it

const QUIET = { outline: false as const };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A marshmallow's colour as it browns: soft white, golden, toasty brown, then charcoal. */
const SHADES: [number, THREE.Color][] = [
  [0, new THREE.Color('#fff8ee')],
  [0.35, new THREE.Color('#fbe6c4')],
  [SMORES.goldLo, new THREE.Color('#f0bf6c')],
  [0.72, new THREE.Color('#e2a24a')],
  [SMORES.goldHi, new THREE.Color('#c07a38')],
  [1.0, new THREE.Color('#7a4a2a')],
  [1.4, new THREE.Color('#2b211d')],
];

function shade(brown: number): THREE.Color {
  const b = Math.max(0, brown);
  for (let i = 1; i < SHADES.length; i++) {
    const [b1, c1] = SHADES[i] as [number, THREE.Color];
    const [b0, c0] = SHADES[i - 1] as [number, THREE.Color];
    if (b <= b1) return c0.clone().lerp(c1, (b - b0) / (b1 - b0));
  }
  return (SHADES[SHADES.length - 1] as [number, THREE.Color])[1].clone();
}

/** Direction from the fire out to a seat. */
function outward(angle: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
}

/** Where the marshmallow is for a reach (0 held back … 1 deep in the flames). */
function mallowAt(angle: number, reach: number): THREE.Vector3 {
  const r = OUT_R + (IN_R - OUT_R) * reach;
  return outward(angle).multiplyScalar(r).setY(OUT_Y + (IN_Y - OUT_Y) * reach);
}

function smoreModel(): THREE.Group {
  const g = new THREE.Group();
  const cracker = mix(P.oak, P.mustard, 0.35);
  part(g, rbox(0.3, 0.05, 0.3, 0.015), cracker, 0, 0.025, 0, { outline: 0.015 });
  part(g, rbox(0.24, 0.035, 0.24, 0.01), P.walnut, 0, 0.065, 0, { ry: 0.08, gloss: 0.4, ...QUIET });
  part(g, cyl(0.12, 0.13, 0.08, 16), mix(P.cream, P.mustard, 0.4), 0, 0.12, 0, { outline: 0.015 });
  part(g, rbox(0.3, 0.05, 0.3, 0.015), cracker, 0.01, 0.185, -0.01, { ry: 0.12, outline: 0.015 });
  for (const x of [-0.07, 0.07]) for (const z of [-0.07, 0.07]) part(g, ball(0.012, 0), P.walnut, 0.01 + x, 0.212, -0.01 + z, QUIET);
  return g;
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

interface Fx {
  obj: THREE.Object3D;
  t: number;
  dur: number;
  step: (k: number) => void;
  /** When it finishes. */
  done?: () => void;
  /** Frees what it made (also when the game ends early). */
  cleanup?: () => void;
}

interface Stick {
  angle: number;
  hand: THREE.Vector3;
  stick: THREE.Mesh;
  mallow: THREE.Mesh;
  mat: THREE.MeshToonMaterial;
  outline: THREE.Mesh | null;
  shadeKey: number;
  flame: THREE.Group;
  meter: THREE.Sprite;
  meterTex: THREE.CanvasTexture;
  meterKey: string;
  card: THREE.Sprite;
  pop: number;
}

class CampfireView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly crew: Companion[];
  readonly floaters: Floaters;
  private readonly fit: CameraFit;
  private readonly marks: Mark[] = [];
  private readonly sticks: Stick[] = [];
  private readonly flames: THREE.Group;
  private readonly flameParts: { mesh: THREE.Mesh; base: number; speed: number }[] = [];
  private readonly light: THREE.PointLight;
  private readonly embers: { mesh: THREE.Mesh; vy: number; drift: number }[] = [];
  private readonly sparks: Sparks;
  private readonly tick: (dt: number, time: number) => void;
  private readonly leaves: THREE.Mesh[] = [];
  private readonly made: THREE.Group[] = [];
  private fx: Fx[] = [];
  private readonly sign: THREE.CanvasTexture;
  private readonly signMat: THREE.MeshBasicMaterial;
  private readonly rand = seeded(23);
  private crackleIn = 0.3;
  /** Set by the game every frame. */
  gust: { dir: THREE.Vector3; level: number } | null = null;

  constructor(
    seats: MinigameSeat[],
    companions: Companion[],
    private readonly sfx: Sfx,
  ) {
    this.crew = companions;
    this.floaters = new Floaters(this.scene);
    // A clear night: cool moonlight from behind, and the fire as the warm key in the middle of it all.
    lightRig(this.scene, 'moonlit', { fog: { near: 30, far: 85 }, shadowSize: 12 });
    this.sparks = new Sparks(this.scene, 0.13, 0.9);
    const n = seats.length;
    const s = this.scene;
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, sc = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc);
      s.add(o);
      return o;
    };

    // The clearing: dark grass, a trodden patch of earth round the fire.
    const grass = mix(P.grassDark, P.midnight, 0.35);
    part(s, cyl(60, 60, 0.3, 48), grass, 0, -0.15, 0, { tex: 'grass', texScale: 5, outline: false, shadow: false });
    part(s, cyl(4.5, 4.7, 0.04, 40), mix(P.soil, P.midnight, 0.2), 0, 0.02, 0.2, { tex: 'sand', outline: false, shadow: false });
    part(s, cyl(2.0, 2.3, 0.02, 32), mix(P.soilDark, P.ink, 0.25), 0, 0.045, 0, { tex: 'sand', outline: false, shadow: false });
    const rand = seeded(9);
    // Pines all round the back, a darker wall of forest behind them.
    for (let i = 0; i < 17; i++) {
      const a = Math.PI * 0.02 + (i / 16) * Math.PI * 0.96 + (rand() - 0.5) * 0.08;
      const r = 10.5 + rand() * 6;
      put(props.tree({ kind: 'pine', h: 5 + rand() * 3.2, seed: i + 2, color: mix(P.pine, P.midnight, 0.2 + rand() * 0.2) }), Math.cos(a) * r * 1.35, 0, -Math.sin(a) * r - 2, rand() * 6);
    }
    for (let i = 0; i < 34; i++) {
      const a = (i / 33) * Math.PI + (rand() - 0.5) * 0.06;
      const r = 20 + rand() * 6;
      const h = 6 + rand() * 4;
      part(s, cone(1.8 + rand() * 0.7, h, 7), mix(P.pine, P.midnight, 0.55 + rand() * 0.15), Math.cos(a) * r * 1.5, h / 2 + 0.5, -Math.sin(a) * r - 2, { outline: false, shadow: false });
    }
    for (const [x, z, h] of [[-13.5, 2.5, 6.5], [-15, 6, 7.5], [13, 0.5, 6.8], [14.5, 5, 7.6]] as const) put(props.tree({ kind: 'pine', h, seed: Math.round(h * 3), color: mix(P.pine, P.midnight, 0.3) }), x, 0, z);
    // Undergrowth round the edge of the clearing, never on the trodden earth.
    for (let i = 0; i < 46; i++) {
      const a = rand() * Math.PI * 2;
      const r = 5.4 + rand() * 6;
      const x = Math.cos(a) * r * 1.25;
      const z = Math.sin(a) * r * 0.8 - 0.5;
      if (Math.hypot(x - PLATE.x - 0.4, z - PLATE.z) < 2.2) continue;
      put(props.tuft({ seed: i + 1, s: 0.9 + rand() * 0.8, color: mix(P.moss, P.midnight, 0.25), ...(i % 5 === 0 ? { flowers: P.cream } : {}) }), x, 0, z, rand() * 6);
    }
    put(props.bush({ r: 0.7, seed: 3, color: mix(P.fern, P.midnight, 0.3) }), -8.6, 0, -0.4);
    put(props.bush({ r: 0.55, seed: 5, color: mix(P.fern, P.midnight, 0.3) }), 7.6, 0, -3.6);
    put(props.rock({ r: 0.6, seed: 2 }), -4.6, 0, -4.6);
    put(props.rock({ r: 0.35, seed: 4 }), -3.8, 0, -5.1);
    put(props.rock({ r: 0.5, seed: 7 }), 6.4, 0, 4.4);

    // The tent, with a lamp on inside, its guy lines, and fairy lights strung from it to a pole.
    const tent = new THREE.Group();
    put(tent, -6.6, 0, -3.0, 0.5);
    const canvas = { tex: 'fabric' as const, texScale: 1.2 };
    part(tent, cone(2.0, 2.3, 4), P.terracotta, 0, 1.15, 0, { ry: Math.PI / 4, ...canvas });
    part(tent, cone(0.75, 1.5, 3), P.lamp, 0, 0.75, 1.26, { sz: 0.12, glow: 1.15, shadow: false });
    for (const sx of [-1, 1]) part(tent, plane(0.75, 1.75), mix(P.terracotta, P.ink, 0.25), sx * 0.52, 0.8, 1.36, { rz: sx * 0.42, material: toonMat({ color: mix(P.terracotta, P.ink, 0.25), side: THREE.DoubleSide }), outline: false });
    part(tent, cyl(0.03, 0.03, 0.5, 6), P.walnut, 0, 2.4, 0, QUIET);
    for (const [gx, gz] of [[-2.3, 1.6], [2.3, 1.6], [-2.3, -1.6], [2.3, -1.6]] as const) {
      part(tent, cyl(0.02, 0.02, 0.24, 5), P.walnut, gx, 0.1, gz, { rz: gx > 0 ? -0.4 : 0.4, ...QUIET });
      const len = Math.hypot(gx * 0.45, 0.9, gz * 0.45);
      const line = part(tent, cyl(0.006, 0.006, len, 4), P.sand, gx * 0.78, 0.5, gz * 0.78, { outline: false, shadow: false });
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-gx * 0.45, 0.9, -gz * 0.45).normalize());
    }
    part(s, cyl(0.04, 0.05, 2.9, 8), P.walnut, -2.6, 1.45, -5.6, { tex: 'bark' });
    s.add(props.stringLights(new THREE.Vector3(-6.6, 2.6, -3.0), new THREE.Vector3(-2.6, 2.85, -5.6), { sag: 0.45, count: 10 }));
    s.add(props.stringLights(new THREE.Vector3(-2.6, 2.85, -5.6), new THREE.Vector3(3.4, 3.4, -7.4), { sag: 0.6, count: 13 }));
    part(s, cyl(0.04, 0.05, 3.5, 8), P.walnut, 3.4, 1.75, -7.4, { tex: 'bark' });
    // Camp life round the edges: a blanket with a guitar and mugs, a stack of firewood, a storm lamp, a backpack.
    put(props.blanket({ color: P.denim, stripes: P.cream, w: 2.0, d: 1.5 }), -5.3, 0, 2.4, 0.5);
    put(props.guitar(), -5.8, 0.06, 2.3, 0.9).rotateX(-1.25);
    put(props.mug({ color: P.terracotta }), -4.8, 0.03, 2.9);
    put(props.mug({ color: P.ceramic }), -5.0, 0.03, 2.0, 1.2);
    for (let i = 0; i < 6; i++) part(s, cyl(0.12, 0.12, 1.1, 8), i % 2 ? P.wood : P.walnut, 5.9 + (i % 3) * 0.25 + (i > 2 ? 0.12 : 0), 0.12 + (i > 2 ? 0.21 : 0), -2.6, { rx: Math.PI / 2, ry: 0.4, tex: 'bark' });
    put(props.gardenLamp({ h: 0.25, lit: true }), 5.2, 0, -2.0);
    part(s, rbox(0.5, 0.62, 0.34, 0.12), P.forest, -3.4, 0.31, 4.5, { ry: 0.5, tex: 'fabric' });
    part(s, rbox(0.36, 0.24, 0.1, 0.05), mix(P.forest, P.ink, 0.25), -3.3, 0.24, 4.68, { ry: 0.5, tex: 'fabric' });
    put(props.logSeat({ len: 1.7 }), -1.2, 0, 4.9, 0.15);
    put(props.logSeat({ len: 1.5 }), 0.2, 0, -4.6, -0.2);

    // The fire: a ring of stones, crossed logs, glowing embers and the flames.
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      part(s, ball(0.24 + (i % 3) * 0.04, 1), mix(P.stone, P.ink, 0.3 + (i % 3) * 0.1), Math.cos(a) * 0.95, 0.12, Math.sin(a) * 0.95, { sy: 0.65, ry: i * 1.3, tex: 'rock', outline: 0.02 });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      part(s, cyl(0.09, 0.11, 1.2, 8), i % 2 ? P.soilDark : P.walnut, Math.cos(a) * 0.22, 0.32, Math.sin(a) * 0.22, { rx: -Math.sin(a) * 0.95, rz: Math.cos(a) * 0.95, tex: 'bark', outline: 0.02 });
    }
    part(s, cyl(0.55, 0.62, 0.08, 20), P.ember, 0, 0.06, 0, { glow: 1.3, shadow: false });
    this.flames = new THREE.Group();
    this.flames.position.y = 0.12;
    this.scene.add(this.flames);
    const tongue = (r: number, h: number, color: string, x: number, z: number, opacity?: number) => {
      const mesh = part(this.flames, cone(r, h, 12), color, x, h / 2, z, { glow: 1.05, shadow: false, ...(opacity ? { opacity } : {}) });
      this.flameParts.push({ mesh, base: h, speed: 5 + this.rand() * 6 });
    };
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      tongue(0.3, 0.75 + this.rand() * 0.25, P.ember, Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0.92);
    }
    tongue(0.42, 1.25, '#ff9a3c', 0, 0, 0.92);
    tongue(0.28, 0.95, '#ffd25e', 0, 0.02);
    tongue(0.14, 0.6, '#fff1b0', 0, 0.04);
    this.light = new THREE.PointLight('#ffb468', FIRE, 20, 1.3);
    this.light.position.set(0, 1.3, 0.2);
    this.scene.add(this.light);
    for (let i = 0; i < EMBERS; i++) {
      const mesh = part(this.scene, ball(0.03, 0), i % 3 ? P.ember : P.lamp, 0, 0.3 + this.rand() * 2.5, 0, { glow: 2, shadow: false });
      this.embers.push({ mesh, vy: 0.5 + this.rand() * 0.6, drift: (this.rand() - 0.5) * 0.4 });
    }
    for (let i = 0; i < 7; i++) {
      const leaf = part(this.scene, ball(0.07, 1), [P.copper, P.olive, P.mustard][i % 3] as string, 0, 0, 0, { sy: 0.25, sx: 1.6, shadow: false, outline: false });
      leaf.visible = false;
      this.leaves.push(leaf);
    }

    // The plate on a tree stump, the supplies and a little sign counting the s'mores.
    part(s, cyl(0.62, 0.72, PLATE_Y - 0.04, 18), P.walnut, PLATE.x, (PLATE_Y - 0.04) / 2, PLATE.z, { tex: 'bark' });
    part(s, cyl(0.6, 0.6, 0.02, 18), P.oak, PLATE.x, PLATE_Y - 0.03, PLATE.z, { tex: 'wood', texScale: 0.5, ...QUIET });
    part(s, cyl(0.58, 0.5, 0.05, 24), P.ceramic, PLATE.x, PLATE_Y, PLATE.z, { gloss: 0.5 });
    part(s, cyl(0.44, 0.44, 0.012, 24), mix(P.ceramic, P.denim, 0.25), PLATE.x, PLATE_Y + 0.022, PLATE.z, { gloss: 0.5, ...QUIET });
    // a cool box with a lid and a handle, the bag of marshmallows, a bar of chocolate
    part(s, rbox(0.9, 0.5, 0.6, 0.08), P.denim, PLATE.x + 1.25, 0.25, PLATE.z - 0.5, { ry: -0.3, gloss: 0.3 });
    part(s, rbox(0.95, 0.12, 0.65, 0.05), P.ceramic, PLATE.x + 1.25, 0.56, PLATE.z - 0.5, { ry: -0.3, gloss: 0.3 });
    part(s, rbox(0.4, 0.04, 0.08, 0.02), P.charcoal, PLATE.x + 1.25, 0.64, PLATE.z - 0.5, { ry: -0.3, ...QUIET });
    part(s, rbox(0.42, 0.5, 0.2, 0.08), P.cream, PLATE.x - 0.95, 0.25, PLATE.z + 0.35, { ry: 0.4 });
    part(s, rbox(0.44, 0.16, 0.22, 0.04), P.rose, PLATE.x - 0.95, 0.28, PLATE.z + 0.35, { ry: 0.4, ...QUIET });
    for (let i = 0; i < 3; i++) part(s, cyl(0.07, 0.07, 0.1, 12), P.cream, PLATE.x - 0.6 + i * 0.13, 0.05, PLATE.z + 0.75 + (i % 2) * 0.1, { rx: i ? 0 : Math.PI / 2, ...QUIET });
    part(s, rbox(0.3, 0.04, 0.18, 0.01), P.walnut, PLATE.x + 0.55, 0.02, PLATE.z + 0.75, { ry: 0.5, gloss: 0.4 });
    part(s, cyl(0.05, 0.06, 1.1, 8), P.walnut, SIGN.x, 0.55, SIGN.z, { tex: 'bark' });
    part(s, rbox(1.72, 0.9, 0.05, 0.02), P.wood, SIGN.x, 1.45, SIGN.z - 0.005, { tex: 'planks', texScale: 0.8 });
    this.sign = canvasTexture(512, 256, () => {});
    this.signMat = new THREE.MeshBasicMaterial({ map: this.sign, transparent: true });
    const board = new THREE.Mesh(plane(1.6, 0.8), this.signMat);
    board.position.set(SIGN.x, 1.45, SIGN.z + 0.03);
    this.scene.add(board);

    // Everyone round the fire with a stick, a toast meter over their head.
    this.tick = props.tickProps(this.scene);
    seats.forEach((s, i) => {
      const angle = seatAngle(i, n);
      const out = outward(angle);
      const at = out.clone().multiplyScalar(RING);
      const c = companions[i];
      if (c) {
        c.root.position.copy(at);
        c.root.rotation.y = Math.atan2(-at.x, -at.z);
        c.setBase('listening');
        this.scene.add(c.root);
      }
      part(this.scene, torus(0.42, 0.04), s.color, at.x, 0.05, at.z, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      const hand = out.clone().multiplyScalar(RING - 0.38).setY(HAND_Y);
      const stick = part(this.scene, cyl(0.022, 0.028, 1, 6), P.wood, 0, 0, 0, { outline: false });
      const mat = toonMat({ color: shade(0) });
      const mallow = new THREE.Mesh(cyl(0.12, 0.12, 0.2, 16), mat);
      mallow.castShadow = true;
      addOutline(mallow, mat.color, 0.025);
      this.scene.add(mallow);
      const outline = (mallow.children.find((o) => o.name === 'outline') as THREE.Mesh | undefined) ?? null;
      const flame = new THREE.Group();
      part(flame, cone(0.13, 0.36, 10), P.ember, 0, 0.18, 0, { glow: 1.6, shadow: false });
      part(flame, cone(0.07, 0.22, 10), P.lamp, 0, 0.12, 0.02, { glow: 2, shadow: false });
      flame.visible = false;
      this.scene.add(flame);
      const meterTex = canvasTexture(320, 72, () => {});
      const meter = new THREE.Sprite(new THREE.SpriteMaterial({ map: meterTex, transparent: true, depthWrite: false }));
      meter.scale.set(1.25, 1.25 * (72 / 320), 1);
      meter.position.copy(at).setY(1.78);
      meter.renderOrder = 4;
      this.scene.add(meter);
      const card = nameCard(s.name, s.color, 0.8);
      card.position.copy(at).setY(2.2);
      this.scene.add(card);
      this.sticks.push({ angle, hand, stick, mallow, mat, outline, shadeKey: -1, flame, meter, meterTex, meterKey: '', card, pop: 1 });
      this.marks.push({ p: at.clone() }, { p: at.clone().setY(2.25), pad: 0.06 });
      for (const side of [-0.65, 0.65]) this.marks.push({ p: at.clone().setY(1.78).setX(at.x + side), pad: 0.02 });
    });
    this.marks.push({ p: new THREE.Vector3(0, 1.9, 0) }, { p: new THREE.Vector3(0, 0, 1.3) }, { p: PLATE.clone().setZ(PLATE.z + 0.8) }, { p: SIGN.clone().setY(1.9), pad: 0.03 }, { p: SIGN.clone().setX(SIGN.x + 0.8) });
    this.fit = new CameraFit(this.camera, 0.5);
    this.drawSign(0, 8);
  }

  /** The sign by the plate: s'mores made out of the goal. */
  drawSign(made: number, goal: number): void {
    const canvas = this.sign.image as HTMLCanvasElement;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(30, 24, 38, 0.55)';
    g.beginPath();
    g.roundRect(26, 26, w - 52, h - 52, 22);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = made >= goal ? P.lamp : P.cream;
    g.font = `800 88px ${ROUNDED_FONT}`;
    g.fillText(`${made} / ${goal}`, w / 2, 112);
    g.font = `600 36px ${ROUNDED_FONT}`;
    g.fillStyle = P.linen;
    g.fillText(made >= goal ? 'Goal reached!' : "S'mores made", w / 2, 190);
    this.sign.needsUpdate = true;
  }

  /** Places every stick and marshmallow, and colours them. */
  sync(c: Campfire): void {
    c.roasts.forEach((r, i) => {
      const s = this.sticks[i];
      if (!s) return;
      const m = mallowAt(s.angle, r.reach);
      // The stick runs from the marshmallow through the hand and a little past it.
      const along = s.hand.clone().sub(m);
      const len = along.length() + 0.55;
      along.normalize();
      s.stick.position.copy(m).addScaledVector(along, len / 2 - 0.04);
      s.stick.scale.set(1, len, 1);
      s.stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
      s.mallow.position.copy(m);
      s.mallow.quaternion.copy(s.stick.quaternion);
      s.mallow.visible = r.phase !== 'fresh';
      s.flame.visible = r.phase === 'fire';
      s.flame.position.copy(m).setY(m.y + 0.08);
      const key = Math.round(Math.min(1.5, r.brown) * 24);
      if (key !== s.shadeKey) {
        s.shadeKey = key;
        const col = shade(key / 24);
        s.mat.color.copy(col);
        if (s.outline) s.outline.material = outlineMaterial(col, 0.025);
      }
      this.drawMeter(s, r);
    });
  }

  private drawMeter(s: Stick, r: Roast): void {
    const word = doneness(r);
    const holding = r.phase === 'roast' && r.out > 0 ? Math.round((r.out / SMORES.doneHold) * 8) : 0;
    const key = `${Math.round(Math.min(1.4, r.brown) * 60)}|${word}|${holding}`;
    if (key === s.meterKey) return;
    s.meterKey = key;
    const canvas = s.meterTex.image as HTMLCanvasElement;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = word === 'burning' ? 'rgba(120, 30, 20, 0.92)' : 'rgba(30, 24, 38, 0.88)';
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, 30);
    g.fill();
    const x0 = 22;
    const x1 = w - 22;
    const top = 22;
    const bh = h - 44;
    const xAt = (b: number) => x0 + (x1 - x0) * clamp01(b / SMORES.burnAt);
    const grad = g.createLinearGradient(x0, 0, x1, 0);
    for (const [b, c] of SHADES) if (b <= SMORES.burnAt) grad.addColorStop(clamp01(b / SMORES.burnAt), `#${c.getHexString()}`);
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(x0, top, x1 - x0, bh, bh / 2);
    g.fill();
    // The golden band, outlined.
    g.strokeStyle = '#fff1a8';
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(xAt(SMORES.goldLo), top - 6, xAt(SMORES.goldHi) - xAt(SMORES.goldLo), bh + 12, 8);
    g.stroke();
    // Where this marshmallow is.
    const mx = xAt(r.phase === 'fresh' ? 0 : r.brown);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#2a2140';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(mx, h / 2, 15, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (holding) {
      // Counting the second it is held out.
      g.strokeStyle = '#7be38a';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(mx, h / 2, 22, -Math.PI / 2, -Math.PI / 2 + (holding / 8) * Math.PI * 2);
      g.stroke();
    }
    if (word === 'burning') {
      g.font = `800 32px ${ROUNDED_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffe08a';
      g.fillText('Flick it out!', w / 2, h / 2 + 2);
    }
    s.meterTex.needsUpdate = true;
  }

  /** What happened to a marshmallow: fly it to the plate, eat it, flick it into the fire… */
  event(e: RoastEvent, made: number, seatColor: string): void {
    const s = this.sticks[e.seat];
    const c = this.crew[e.seat];
    if (!s) return;
    const from = s.mallow.position.clone();
    const above = from.clone().setY(from.y + 0.55);
    if (e.kind === 'golden') {
      const spot = this.plateSpot(made - 1);
      const ghost = new THREE.Mesh(s.mallow.geometry, toonMat({ color: s.mat.color.clone() }));
      this.scene.add(ghost);
      this.fly(ghost, from, spot.clone().setY(spot.y + 0.2), 0.7, 1.4, () => {
        const smore = smoreModel();
        smore.position.copy(spot);
        smore.rotation.y = made * 1.3;
        smore.scale.setScalar(0.01);
        this.scene.add(smore);
        this.made.push(smore);
        this.sparks.burst(spot.clone().setY(spot.y + 0.2), P.lamp, 12, 1.0, 1.1);
        this.tween(smore, 0.3, (k) => smore.scale.setScalar(Math.max(0.01, 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2)));
        tone(this.sfx, { freq: 880, to: 1320, dur: 0.14, gain: 0.07 });
        tone(this.sfx, { freq: 1320, dur: 0.22, gain: 0.05, delay: 0.1 });
      });
      this.floaters.add('Golden!', seatColor, above, 0.42);
      this.sparks.burst(from, P.lamp, 6, 0.7, 1);
      c?.react('happy', 1.6);
    } else if (e.kind === 'toasty') {
      // A bit too dark to count, but it doesn't go to waste.
      const ghost = new THREE.Mesh(s.mallow.geometry, toonMat({ color: s.mat.color.clone() }));
      this.scene.add(ghost);
      const mouth = s.hand.clone().add(outward(s.angle).multiplyScalar(0.3)).setY(1.05);
      this.fly(ghost, from, mouth, 0.5, 0.3, () => {}, true);
      this.floaters.add('A bit toasty', '#d8d3e8', above, 0.36);
      tone(this.sfx, { freq: 300, to: 240, dur: 0.18, type: 'triangle', gain: 0.08 });
      c?.react('talking', 1.2);
    } else if (e.kind === 'blown' || e.kind === 'dropped') {
      const ghost = new THREE.Mesh(s.mallow.geometry, toonMat({ color: shade(1.4) }));
      this.scene.add(ghost);
      this.fly(ghost, from, new THREE.Vector3(0, 0.4, 0), e.kind === 'blown' ? 0.55 : 0.4, e.kind === 'blown' ? 0.6 : 0, () => {}, true);
      this.puff(from);
      this.floaters.add(e.kind === 'blown' ? 'Charred!' : 'Burnt up!', '#ffb0bd', above, 0.38);
      if (e.kind === 'blown') noise(this.sfx, { dur: 0.3, filter: 'highpass', freq: 1800, to: 900, gain: 0.08 });
      c?.react('sad', 1.6);
    } else if (e.kind === 'fire') {
      noise(this.sfx, { dur: 0.35, filter: 'lowpass', freq: 250, to: 1100, gain: 0.14 });
      this.floaters.add('On fire!', '#ffb36b', above, 0.38, 0.9);
      this.sparks.burst(from, P.ember, 10, 1.1, 1.3);
      c?.react('thinking', 1.2);
    } else if (e.kind === 'gold') {
      tone(this.sfx, { freq: 1250, dur: 0.07, gain: 0.035 });
    } else if (e.kind === 'fresh') {
      s.pop = 0;
    }
  }

  /** Where the n-th s'more goes on the plate (a ring of six, then a second layer). */
  private plateSpot(i: number): THREE.Vector3 {
    const layer = Math.floor(i / 7);
    const k = i % 7;
    const a = (k / 6) * Math.PI * 2 + layer * 0.5;
    const r = k === 6 ? 0 : 0.33;
    return new THREE.Vector3(PLATE.x + Math.cos(a) * r, PLATE_Y + 0.03 + layer * 0.21, PLATE.z + Math.sin(a) * r);
  }

  private puff(at: THREE.Vector3): void {
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: mix(P.slate, P.moon, 0.4), transparent: true, opacity: 0.6, depthWrite: false });
      const m = new THREE.Mesh(ball(0.08, 1), mat);
      m.position.copy(at).add(new THREE.Vector3((i - 1.5) * 0.06, 0.05, 0));
      this.scene.add(m);
      const from = m.position.clone();
      this.fx.push({
        obj: m,
        t: 0,
        dur: 0.9 + i * 0.1,
        step: (k) => {
          m.position.copy(from).setY(from.y + k * 0.7);
          m.scale.setScalar(1 + k * 2.5);
          mat.opacity = 0.6 * (1 - k);
        },
        cleanup: () => mat.dispose(),
      });
    }
  }

  private fly(obj: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, dur: number, arc: number, done: () => void, shrink = false): void {
    obj.position.copy(from);
    this.fx.push({
      obj,
      t: 0,
      dur,
      step: (k) => {
        obj.position.lerpVectors(from, to, k);
        obj.position.y += Math.sin(k * Math.PI) * arc;
        obj.rotation.z += 0.12;
        if (shrink) obj.scale.setScalar(Math.max(0.01, 1 - k * 0.9));
      },
      done,
      cleanup: () => (obj.material as THREE.Material).dispose(),
    });
  }

  private tween(obj: THREE.Object3D, dur: number, step: (k: number) => void): void {
    this.fx.push({ obj, t: 0, dur, step });
  }

  dispose(): void {
    for (const c of this.crew) c.dispose();
    this.floaters.dispose();
    for (const f of this.fx) f.cleanup?.();
    for (const s of this.sticks) {
      s.mat.dispose();
      s.meterTex.dispose();
      s.meter.material.dispose();
      s.card.material.map?.dispose();
      s.card.material.dispose();
    }
    this.sign.dispose();
    this.signMat.dispose();
    this.sparks.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    for (const c of this.crew) c.update(dt);
    this.floaters.update(dt);
    this.sparks.update(dt);
    this.tick(dt, time);
    // The flames flicker, flare up and lean with the wind.
    const level = this.gust?.level ?? 0;
    const dir = this.gust?.dir ?? new THREE.Vector3();
    for (const f of this.flameParts) {
      const k = 1 + 0.12 * Math.sin(time * f.speed) + 0.07 * Math.sin(time * f.speed * 2.3 + 1) + level * 0.55;
      f.mesh.scale.set(1 + level * 0.15, k, 1 + level * 0.15);
      f.mesh.position.y = (f.base * k) / 2;
    }
    this.flames.rotation.x = dir.z * level * 0.55;
    this.flames.rotation.z = -dir.x * level * 0.55;
    this.light.intensity = FIRE * (1 + Math.sin(time * 9) * 0.06 + Math.sin(time * 23) * 0.035 + level * 0.3);
    for (const e of this.embers) {
      e.mesh.position.y += e.vy * dt;
      e.mesh.position.x += (e.drift + dir.x * level * 1.5) * dt;
      e.mesh.position.z += dir.z * level * 1.5 * dt;
      if (e.mesh.position.y > 3.2) {
        e.mesh.position.set((this.rand() - 0.5) * 0.6, 0.4, (this.rand() - 0.5) * 0.6);
      }
    }
    // Leaves blown across while a gust lasts.
    this.leaves.forEach((leaf, i) => {
      if (level <= 0.05) {
        leaf.visible = false;
        return;
      }
      if (!leaf.visible) {
        leaf.visible = true;
        leaf.position.copy(dir).multiplyScalar(-6 - i * 0.8).setY(0.5 + (i % 4) * 0.5);
        leaf.position.x += (i - 3) * 0.6;
      }
      leaf.position.addScaledVector(dir, (5 + i * 0.6) * dt);
      leaf.position.y += Math.sin(time * 6 + i) * dt * 0.8;
      leaf.rotation.set(time * (2 + i), time * 3, 0);
    });
    for (const s of this.sticks) {
      s.flame.scale.set(1, 1 + 0.25 * Math.sin(time * 17 + s.angle * 5), 1);
      if (s.pop < 1) {
        s.pop = Math.min(1, s.pop + dt / 0.3);
        s.mallow.scale.setScalar(Math.max(0.01, 1 + 2.7 * (s.pop - 1) ** 3 + 1.7 * (s.pop - 1) ** 2));
      }
    }
    // A soft crackle now and then.
    this.crackleIn -= dt;
    if (this.crackleIn <= 0) {
      this.crackleIn = 0.15 + this.rand() * 0.6;
      noise(this.sfx, { dur: 0.04 + this.rand() * 0.05, filter: 'highpass', freq: 2200 + this.rand() * 1800, gain: 0.025 + this.rand() * 0.03 });
    }
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.step(k);
      if (k >= 1) {
        if (!this.made.includes(f.obj as THREE.Group)) this.scene.remove(f.obj);
        f.cleanup?.();
        f.done?.();
      }
      return k < 1;
    });
  }
}

/** A buzz on the player's phone for what happened (the phone itself doesn't show the marshmallow). */
function buzzFor(kind: RoastEvent['kind']): number[] | null {
  switch (kind) {
    case 'gold':
      return [25, 50, 25];
    case 'golden':
      return [40, 60, 40, 60, 40];
    case 'fire':
      return [220];
    case 'blown':
      return [30];
    default:
      return null;
  }
}

export const minigame: Minigame = {
  id: 'smores',
  title: "S'mores Night",
  how: "Roast marshmallows round the campfire! Tilt your phone forward to move yours toward the flames and back to pull it out. When it's golden, hold it out of the fire for a second. Too close for too long and it catches fire: flick it back quickly to blow it out.",
  controller: 'tilt',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const fire = newCampfire(rng, n);
    const skill = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : 0.5));
    const cpus: SmoresCpu[] = seats.map((_, i) => newSmoresCpu(skill[i] ?? 0.5, rng));
    const tilt = seats.map(() => 0);
    const view = new CampfireView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.3 }))), sfx);
    ctx.stage.setView(view);
    view.drawSign(0, fire.goal);
    view.sync(fire);
    session.setLayoutAll(() => ({ kind: 'tilt', title: "S'mores Night", icon: '🍡', note: 'Tip forward towards the fire to roast, level or back to pull it out. Aim for golden!' }));
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'tilt' && seat < n && !session.isCpu(seat)) tilt[seat] = msg.y;
    });

    const calm = 'Tilt forward to roast, back to pull it out. Golden? Hold it out for a second!';
    ui.caption(calm);
    let captionUntil = 0;
    let lastGust: unknown = null;
    let hudAt = -1;
    let meterAt = -1;
    let goalShown = false;
    const handle = (events: RoastEvent[]) => {
      for (const e of events) {
        view.event(e, fire.golden, seats[e.seat]?.color ?? '#ffffff');
        if (e.kind === 'golden') view.drawSign(fire.golden, fire.goal);
        const buzz = buzzFor(e.kind);
        if (buzz && !session.isCpu(e.seat)) session.send(e.seat, { t: 'buzz', pattern: buzz });
        if (e.kind === 'golden' && fire.golden === fire.goal && !goalShown) {
          goalShown = true;
          sfx.good();
          ui.caption(`That's ${fire.goal} s'mores! Any more are a bonus.`, '#ffe08a');
          captionUntil = fire.time + 2.5;
        }
      }
    };

    await everyFrame(clock, (dt) => {
      let left = dt;
      while (left > 1e-6 && fire.time < SMORES.duration) {
        const step = Math.min(STEP, left);
        left -= step;
        const targets = seats.map((_, i) => tiltToReach(session.isCpu(i) ? cpuSmoresTilt(fire, i, cpus[i] as SmoresCpu, skill[i] ?? 0.5, rng, step) : (tilt[i] ?? 0)));
        handle(stepCampfire(fire, step, targets));
      }
      // The wind: show it, and say so.
      const g = gustNow(fire.gusts, fire.time);
      view.gust = g ? { dir: new THREE.Vector3(Math.cos(g.gust.angle), 0, -Math.sin(g.gust.angle)), level: g.level } : null;
      if (g && g.gust !== lastGust) {
        lastGust = g.gust;
        noise(sfx, { dur: 1.3, filter: 'lowpass', freq: 320, to: 1200, gain: 0.09 });
        ui.caption('A gust! The flames are flaring up…', '#ffd9a8');
        captionUntil = fire.time + 1.8;
      }
      if (captionUntil && fire.time > captionUntil) {
        captionUntil = 0;
        ui.caption(goalShown ? `${fire.golden} s'mores and counting!` : calm);
      }
      view.sync(fire);
      if (fire.time - meterAt > 0.16) {
        meterAt = fire.time;
        fire.roasts.forEach((r, i) => {
          if (!session.isCpu(i)) session.send(i, { t: 'meter', value: Math.min(1, r.brown / SMORES.burnAt), danger: r.phase === 'fire' || r.scorch > 0.6 });
        });
      }
      if (fire.time - hudAt > 0.2) {
        hudAt = fire.time;
        ui.timer(Math.max(0, SMORES.duration - fire.time));
        ui.live(
          seats.map((s, i) => {
            const r = fire.roasts[i] as Roast;
            const word = doneness(r);
            const state = word === 'burning' ? ' · On fire!' : word === 'golden' ? ' · Golden!' : word === 'toasty' ? ' · Toasty' : '';
            return { name: s.name, color: s.color, thumb: s.thumb, value: `${r.golden} golden${state}` };
          }),
        );
      }
      return fire.time >= SMORES.duration;
    });
    off();
    handle(finishCampfire(fire));
    view.sync(fire);
    view.gust = null;
    ui.timer(null);
    const coop = smoresCoop(fire);
    session.setLayoutAll(() => ({ kind: 'wait', title: 'Fire’s dying down', text: 'Watch the big screen' }));
    for (const c of view.crew) c.setBase(coop >= 0.6 ? 'happy' : 'sad');
    ui.caption(fire.golden >= fire.goal ? `${fire.golden} s'mores! A proper campfire night.` : `${fire.golden} of ${fire.goal} s'mores made. Still tasty.`);
    if (coop >= 0.6) sfx.good();
    await clock.wait(2);
    ui.caption(null);
    const score = Math.round(coop * 1000);
    return {
      scores: seats.map(() => score),
      details: seats.map((_, i) => {
        const r = fire.roasts[i] as Roast;
        const extra = [r.toasty ? `${r.toasty} toasty` : '', r.charred ? `${r.charred} charred` : ''].filter(Boolean).join(', ');
        return `${r.golden} golden${extra ? ` (${extra})` : ''}`;
      }),
      coop,
    };
  },
};
