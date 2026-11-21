// Sky Lanterns on the TV: a little wooden jetty on a lake at night, pines and hills on the far shore, the moon on
// the water. Everyone holds a paper lantern; it glows from orange to gold as it warms, floats up into the sky when
// let go in the gold, sinks back when let go too soon, and burns a hole and drops in the lake when held too long.
import * as THREE from 'three';
import {
  LANTERN,
  type LanternBrain,
  type Shore,
  type ShoreEvent,
  basketSize,
  cpuLantern,
  heatNow,
  lanternCoop,
  letGo,
  newLanternBrain,
  newShore,
  press,
  shoreOver,
  stepShore,
  togetherCount,
} from '../../../game/minigames/lanterns';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import { ease } from '../../anim';
import { LIGHTING, lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ROUNDED_FONT, ball, box, canvasTexture, cone, cyl, dome, mix, nameCard, part, plane, rbox, seeded, setLook, toonMat, torus } from '../../render/toon';
import type { Sfx } from '../../audio';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, lanes, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const STEP = 1 / 60; // rules step
const HEIGHT = 1.35;
const LANE = 2.2; // between players on the jetty
const HOLD = new THREE.Vector3(0, HEIGHT * 0.66, 0.42); // where the lantern sits, in front of the chest
const TILT = 0.1; // the camera looks a little down, across the lake and up into the sky
const RISE = 4.6; // seconds a lantern takes to reach its spot in the sky
const ORANGE = new THREE.Color('#ff7a2e');
const GOLD = new THREE.Color('#ffd34d');
const HOT = new THREE.Color('#ff4a2a');
const MOON: [number, number, number] = [-0.3, 0.19, -0.93]; // where the moon is in the sky
const PAPER = P.cream;
const QUIET = { outline: false as const };

// ------------------------------------------------------------------ the paper lantern

let haloTexture: THREE.CanvasTexture | null = null;
/** A soft round glow, shared by every lantern's halo. */
function halo(): THREE.CanvasTexture {
  if (!haloTexture) {
    haloTexture = canvasTexture(128, 128, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
  }
  return haloTexture;
}

class PaperLanternMesh {
  readonly group = new THREE.Group();
  readonly paper: THREE.MeshToonMaterial;
  private haloMat: THREE.SpriteMaterial;
  private halo: THREE.Sprite;
  private ringMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private flame: THREE.Mesh;
  private burn: THREE.Mesh;
  heat = 0;
  /** How bright it shines on whoever holds it (the holder's light follows this). */
  shine = 0;
  scorched = false;

  constructor() {
    this.paper = toonMat({ color: PAPER, emissive: ORANGE.clone(), emissiveIntensity: 0 });
    const g = this.group;
    part(g, cyl(0.27, 0.21, 0.5, 18), PAPER, 0, 0, 0, { material: this.paper, outline: 0.02 });
    part(g, dome(0.27), PAPER, 0, 0.25, 0, { material: this.paper, sy: 0.55, outline: 0.02 });
    // The paper's ribs, the wire ring at the bottom and the little burner.
    for (let i = 0; i < 6; i++) part(g, rbox(0.012, 0.5, 0.012, 0.004), P.clay, Math.cos((i * Math.PI) / 3) * 0.243, 0, Math.sin((i * Math.PI) / 3) * 0.243, { rz: -Math.cos((i * Math.PI) / 3) * 0.12, rx: Math.sin((i * Math.PI) / 3) * 0.12, ...QUIET });
    part(g, torus(0.272, 0.01), P.clay, 0, 0.25, 0, { rx: Math.PI / 2, ...QUIET });
    part(g, torus(0.205, 0.012), P.brass, 0, -0.25, 0, { rx: Math.PI / 2, gloss: 0.6, ...QUIET });
    for (const ry of [0, Math.PI / 2]) part(g, rbox(0.4, 0.01, 0.01, 0.004), P.brass, 0, -0.25, 0, { ry, ...QUIET });
    this.flame = part(g, ball(0.055, 1), P.lamp, 0, -0.25, 0, { glow: 2.2, shadow: false });
    // The scorch mark (hidden until the paper burns through).
    this.burn = part(g, ball(0.11, 1), P.espresso, 0, 0.02, 0.24, { sz: 0.25, outline: false, shadow: false });
    this.burn.visible = false;
    this.haloMat = new THREE.SpriteMaterial({ map: halo(), color: ORANGE.clone(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.setScalar(1.8);
    g.add(this.halo);
    // A gold ring around the middle: "now!"
    this.ringMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(torus(0.42, 0.025), this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    g.add(this.ring);
  }

  get color(): THREE.Color {
    return this.paper.emissive;
  }

  /** Glow for warmth h (0 cold … 1 scorching); `golden` once it is in the gold zone. */
  glow(h: number, time: number, sky = false): void {
    this.heat = h;
    const flicker = 1 + Math.sin(time * 23 + this.group.id) * 0.06 + Math.sin(time * 37) * 0.04;
    const golden = h >= LANTERN.zone;
    const c = this.paper.emissive;
    c.copy(ORANGE).lerp(GOLD, Math.max(0, Math.min(1, (h - 0.45) / (LANTERN.zone - 0.45))));
    if (!sky && h > LANTERN.danger) c.lerp(HOT, ((h - LANTERN.danger) / (1 - LANTERN.danger)) * (0.6 + 0.4 * Math.sin(time * 30)));
    if (this.scorched) c.set('#ff5a2a');
    this.paper.emissiveIntensity = (0.05 + 1.05 * h) * flicker;
    this.flame.visible = h > 0.02 || sky;
    this.flame.scale.setScalar((0.6 + 0.8 * h) * flicker);
    this.haloMat.color.copy(c);
    this.haloMat.opacity = Math.min(0.85, h * 0.9) * flicker;
    this.halo.scale.setScalar(1.2 + h * 1.2);
    this.ringMat.opacity = golden && !sky && !this.scorched ? 0.55 + 0.35 * Math.sin(time * 8) : 0;
    this.ring.scale.setScalar(1 + 0.08 * Math.sin(time * 8));
    this.shine = h * 3.2 * flicker;
  }

  /** The paper burns through: a dark hole, browned paper. */
  scorch(): void {
    this.scorched = true;
    this.burn.visible = true;
    this.paper.color.set(P.clay);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.paper.dispose();
    this.haloMat.dispose();
    this.ringMat.dispose();
  }
}

// ------------------------------------------------------------------ the view

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

interface HolderRig {
  c: Companion;
  lantern: PaperLanternMesh | null;
  /** The warm light of the lantern in hand (one per player for the whole game, so shaders never recompile). */
  light: THREE.PointLight;
  mood: CompanionMood | null;
  /** Where the lantern sits relative to the hands (it lifts and sinks back when let go too soon). */
  lift: number;
  sinkFrom: number;
  sinkAt: number;
}

interface Flight {
  lantern: PaperLanternMesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  age: number;
  phase: number;
  group: number;
  together: boolean;
  /** Its glow on the lake. */
  mirror: THREE.Sprite;
}

interface Tween {
  t: number;
  duration: number;
  step: (k: number) => void;
  done?: () => void;
}

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

class LakeView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 300);
  readonly rigs: HolderRig[] = [];
  readonly floaters: Floaters;
  private flights: Flight[] = [];
  private tweens: Tween[] = [];
  private puffs: Puff[] = [];
  private slots: { p: THREE.Vector3; taken: boolean }[] = [];
  private groupSlot = new Map<number, THREE.Vector3>();
  private readonly sparks: Sparks;
  private tick: (dt: number, time: number) => void = () => {};
  private readonly mirrorMat = new THREE.SpriteMaterial({ map: halo(), color: GOLD.clone().multiplyScalar(0.8), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
  private fireflies: THREE.Mesh[] = [];
  private glints: THREE.Mesh[] = [];
  private folded: THREE.Mesh[] = [];
  private sign: THREE.CanvasTexture;
  private signMat: THREE.MeshBasicMaterial;
  private smokeMat = new THREE.MeshBasicMaterial({ color: mix(P.slate, P.moon, 0.35), transparent: true, opacity: 0.45, depthWrite: false });
  private sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(1.6) });
  private fit: CameraFit;
  private marks: Mark[];
  private xs: number[];
  private v = new THREE.Vector3();

  constructor(seats: MinigameSeat[], companions: Companion[], size: number) {
    const n = seats.length;
    this.xs = lanes(n, LANE);
    // Night on the lake: the moon hangs low over the far shore; its light is taken round to the front, so the
    // backs the camera sees are not lost in the dark.
    const rig = lightRig(this.scene, 'moonlit', { fog: { near: 70, far: 210 }, shadowSize: 12, sunFrom: MOON });
    rig.sun.position.set(-7, 13, 9);
    rig.sun.target.position.set(0, 0, -1);
    setLook(this.scene, { keyDir: [-7, 13, 10] });
    this.sparks = new Sparks(this.scene, 0.14, 1.2);
    this.floaters = new Floaters(this.scene);
    const right = (this.xs[n - 1] ?? 0) + 1.7;
    this.buildLake(right);

    // The players on the jetty, each with a lantern.
    seats.forEach((s, i) => {
      const c = companions[i] as Companion;
      c.root.position.set(this.xs[i] ?? 0, 0, 0);
      c.setBase('idle');
      this.scene.add(c.root);
      part(this.scene, torus(0.45, 0.04), s.color, this.xs[i] ?? 0, 0.03, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      const card = nameCard(s.name, s.color, 0.75);
      card.position.set(this.xs[i] ?? 0, HEIGHT + 0.95, 0);
      this.scene.add(card);
      const light = new THREE.PointLight('#ffb46b', 0, 4.5, 1.6);
      light.position.copy(HOLD);
      c.root.add(light);
      const rig: HolderRig = { c, lantern: null, light, mood: null, lift: 0, sinkFrom: 0, sinkAt: -9 };
      this.rigs.push(rig);
      this.give(i, false);
    });

    // Spots in the sky the lanterns drift to, spread over the lake.
    const rand = seeded(77);
    for (let i = 0; i < size + 4; i++) {
      const k = (i + 0.5) / (size + 4);
      this.slots.push({ p: new THREE.Vector3(-7 + k * 14 + (rand() - 0.5) * 0.9, 4.9 + rand() * 2.2 + Math.sin(k * Math.PI) * 0.7, -7 - rand() * 3.5), taken: false });
    }

    // The basket of folded lanterns, and the sign with the count.
    this.sign = canvasTexture(640, 300, () => {});
    this.signMat = new THREE.MeshBasicMaterial({ map: this.sign, transparent: true });
    const sign = new THREE.Mesh(plane(2.3, 2.3 * (300 / 640)), this.signMat);
    sign.position.set(right + 1.05, 2.15, -0.9);
    this.scene.add(sign);
    part(this.scene, cyl(0.06, 0.07, 1.6, 8), P.walnut, right + 1.05, 0.8, -0.95, { tex: 'bark' });
    part(this.scene, box(2.42, 1.2, 0.05), P.walnut, right + 1.05, 2.15, -0.94, { tex: 'planks' });

    this.marks = [
      ...this.xs.flatMap((x) => [{ p: new THREE.Vector3(x, 0, 0.4) }, { p: new THREE.Vector3(x, HEIGHT + 1.0, 0), pad: 0.05 }]),
      { p: new THREE.Vector3(right + 2.3, 2.7, -0.9) },
      { p: new THREE.Vector3(right + 0.4, 0, 0.6) },
      ...this.slots.map((s) => ({ p: s.p, pad: 0.05 })),
    ];
    this.fit = new CameraFit(this.camera, TILT);
    this.fit.update(() => this.marks);
  }

  private buildLake(right: number): void {
    const s = this.scene;
    const rand = seeded(19);
    const sky = LIGHTING.moonlit;
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, sc = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc);
      s.add(o);
      return o;
    };
    // The lake: living water, and the moon's path across it.
    put(props.water({ w: 320, d: 280, scale: 0.6, waves: 0.035, segments: 48, shallow: '#1f4f6e', deep: '#0c1c3c', sky: sky.horizon ?? sky.background, foam: mix(P.moon, P.denim, 0.55) }), 0, -0.4, -70);
    for (let i = 0; i < 14; i++) {
      const k = i / 13;
      const z = -58 + k * 52;
      const m = part(s, rbox(2.2 - k * 1.3, 0.02, 0.16, 0.05), P.moon, (MOON[0] / MOON[2]) * z + (rand() - 0.5) * (1.6 - k), -0.37, z, { glow: 1.1, opacity: 0.4, shadow: false });
      this.glints.push(m);
    }
    // The far shore: dark hills, pines against the sky, a cabin with a light on.
    const far = mix(P.midnight, P.pine, 0.3);
    for (let i = 0; i < 9; i++) part(s, ball(9 + rand() * 6, 1), mix(far, P.denim, i % 2 ? 0.25 : 0.1), -64 + i * 16, -2.5, -64 - rand() * 6, { sy: 0.45, outline: false, shadow: false });
    for (let i = 0; i < 34; i++) {
      const x = -54 + i * 3.2 + rand() * 1.5;
      const z = -52 - rand() * 4;
      const h = 2.5 + rand() * 2.8;
      part(s, cone(0.9 + rand() * 0.4, h, 7), mix(far, P.ink, i % 3 ? 0.3 : 0.1), x, h / 2 - 0.3, z, { outline: false, shadow: false });
    }
    part(s, rbox(2.2, 1.6, 1.6, 0.08), mix(P.walnut, P.midnight, 0.5), 9, 0.6, -50.5, { tex: 'planks', outline: false });
    part(s, cone(1.8, 1.0, 4), mix(P.charcoal, P.midnight, 0.4), 9, 1.9, -50.5, { ry: Math.PI / 4, outline: false });
    part(s, rbox(0.6, 0.5, 0.06, 0.03), P.lamp, 9.3, 0.7, -49.66, { glow: 2, shadow: false });
    part(s, rbox(0.5, 0.02, 2.4, 0.01), P.lamp, 9.3, -0.37, -47.6, { glow: 1.1, opacity: 0.3, shadow: false });
    // Headlands at the sides, half way out, for depth.
    for (const side of [-1, 1]) {
      const hx = side * 30;
      part(s, ball(9, 1), mix(far, P.pine, 0.3), hx + side * 5, -2.6, -27, { sy: 0.4, sx: 1.6, outline: false, shadow: false });
      for (let i = 0; i < 6; i++) put(props.tree({ kind: 'pine', h: 4.5 + rand() * 2.5, seed: 30 + i, color: mix(P.pine, P.midnight, 0.35) }), hx + side * (i * 2.4 - 2) + rand(), 0.4, -25 - rand() * 4);
    }

    // The jetty: a deck of planks on posts, running back to the shore on the left.
    const left = -(right + 0.6);
    const width = right + 1.4 - left;
    const mid = (right + 1.4 + left) / 2;
    const plank = { tex: 'planks' as const };
    part(s, rbox(width, 0.22, 2.8, 0.04), P.wood, mid, -0.11, -0.2, plank);
    part(s, rbox(16, 0.2, 1.6, 0.04), P.wood, left - 8, -0.12, -0.7, plank);
    for (const z of [-1.62, 1.22]) part(s, rbox(width + 0.1, 0.12, 0.1, 0.03), P.walnut, mid, -0.1, z, { tex: 'darkWood' });
    for (const x of [left + 0.2, mid, right + 1.2])
      for (const z of [-1.5, 1.1]) {
        // the back posts stand proud of the deck (the rope hangs between them); the front ones stop under it
        const top = z < 0 ? 0.45 : -0.02;
        part(s, cyl(0.11, 0.11, top + 1.05, 10), P.walnut, x, (top - 1.05) / 2, z, { tex: 'bark' });
        if (z < 0) part(s, cyl(0.125, 0.125, 0.05, 10), P.charcoal, x, top + 0.02, z, QUIET);
      }
    for (let x = left - 14; x < left; x += 3.4) part(s, cyl(0.09, 0.09, 1.0, 8), P.walnut, x, -0.55, -0.1, { tex: 'bark' });
    for (let x = left + 0.4; x < right + 1.4; x += 0.55) part(s, rbox(0.03, 0.01, 2.75, 0.005), mix(P.walnut, P.ink, 0.3), x, 0.005, -0.2, { outline: false, shadow: false });
    // A rope between the back posts, a coil of it, a storm lamp on the corner post.
    for (const [a, b] of [[left + 0.2, mid], [mid, right + 1.2]] as const) {
      const rope = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(a, 0.42, -1.5), new THREE.Vector3((a + b) / 2, 0.12, -1.5), new THREE.Vector3(b, 0.42, -1.5)), 16, 0.022, 6);
      part(s, rope, P.sand, 0, 0, 0, { tex: 'knit', texScale: 0.2, ...QUIET });
    }
    for (let i = 0; i < 3; i++) part(s, torus(0.2 - i * 0.03, 0.03), P.sand, left + 0.8, 0.03 + i * 0.05, 0.75, { rx: Math.PI / 2, tex: 'knit', texScale: 0.2, ...QUIET });
    put(props.gardenLamp({ h: 0.45, lit: true, light: 5 }), left + 0.2, 0.49, -1.5);
    put(props.candle(), right + 0.85, 0, 0.95);
    put(props.candle({ h: 0.09 }), right + 0.62, 0, 1.05);

    // The near shore on the left, where the jetty starts: a grassy bank, pines, rocks, a lamp, a log to sit on.
    const bx = left - 15;
    part(s, ball(8, 2), mix(P.grassDark, P.midnight, 0.3), bx, -2.25, -2.5, { sy: 0.33, sz: 1.3, tex: 'grass', outline: false });
    put(props.tree({ kind: 'pine', h: 6.5, seed: 3 }), bx + 1.5, 0.2, -4.5);
    put(props.tree({ kind: 'pine', h: 5.2, seed: 5 }), bx + 4.6, 0, -6.5);
    put(props.tree({ kind: 'pine', h: 7.5, seed: 8 }), bx - 2.5, 0.2, -3);
    put(props.tree({ kind: 'birch', h: 4.6, seed: 4 }), bx + 4.2, 0.1, 0.9);
    put(props.rock({ r: 0.8, seed: 2 }), bx + 6.6, -0.35, -2.6);
    put(props.rock({ r: 0.5, seed: 6 }), bx + 7.4, -0.4, 1.3);
    put(props.bush({ r: 0.6, seed: 3 }), bx + 5.2, 0, -3.4);
    put(props.logSeat({ len: 1.6 }), bx + 4.4, 0.25, -1.9, 0.5);
    put(props.gardenLamp({ h: 0.9, lit: true }), bx + 6.0, 0.05, 0.3);
    // Rocks off the end of the jetty on the right.
    put(props.rock({ r: 0.7, seed: 9 }), right + 3.8, -0.45, -2.2);
    put(props.rock({ r: 0.4, seed: 11 }), right + 4.7, -0.4, -1.2);
    put(props.rock({ r: 1.0, seed: 12 }), right + 6.5, -0.5, 1.0);
    // Reeds in the shallows and a few fireflies over them.
    for (let i = 0; i < 26; i++) {
      const x = (i % 2 ? right + 2.6 : left - 1.2) + (rand() - 0.5) * 2.2;
      const z = i % 2 ? -3 + rand() * 4.5 : 0.6 + rand() * 1.8;
      const h = 0.8 + rand() * 0.9;
      part(s, cyl(0.015, 0.03, h, 5), mix(P.moss, P.midnight, 0.25), x, -0.4 + h / 2, z, { rz: (rand() - 0.5) * 0.3, rx: (rand() - 0.5) * 0.2, ...QUIET });
      if (i % 3 === 0) part(s, cyl(0.045, 0.045, 0.22, 8), P.walnut, x, -0.4 + h, z, QUIET);
    }
    for (let i = 0; i < 16; i++) {
      const m = part(s, ball(0.035, 0), '#d9ff8a', 0, 0, 0, { glow: 1.8, shadow: false, outline: false });
      m.userData = { x: (i % 2 ? right + 2.6 : left - 1.6) + (rand() - 0.5) * 2.8, y: 0.6 + rand() * 1.4, z: -2.5 + rand() * 3.5, k: rand() * 6 };
      this.fireflies.push(m);
    }

    // The basket of folded lanterns at the end of the jetty.
    const wicker = { tex: 'knit' as const, texScale: 0.25 };
    part(s, cyl(0.42, 0.34, 0.46, 16), P.oak, right + 0.1, 0.23, 0.5, wicker);
    part(s, torus(0.42, 0.04), P.wood, right + 0.1, 0.46, 0.5, { rx: Math.PI / 2, ...wicker });
    part(s, torus(0.36, 0.02), P.wood, right + 0.1, 0.12, 0.5, { rx: Math.PI / 2, ...QUIET });
    part(s, torus(0.3, 0.025, Math.PI), P.wood, right + 0.1, 0.46, 0.5, { ry: Math.PI / 2, ...wicker });
    for (let i = 0; i < 10; i++) {
      const m = part(s, rbox(0.34, 0.04, 0.24, 0.015), i % 2 ? PAPER : mix(PAPER, P.clay, 0.3), right + 0.1 + (i % 2 ? 0.04 : -0.04), 0.3 + i * 0.045, 0.5, { ry: i * 0.5, outline: false });
      this.folded.push(m);
    }
    this.tick = props.tickProps(s);
  }

  /** Hands a seat a fresh lantern (unfolding it from flat when `unfold`). */
  give(seat: number, unfold = true): void {
    const rig = this.rigs[seat];
    if (!rig) return;
    rig.lantern?.dispose();
    const l = new PaperLanternMesh();
    l.group.position.copy(HOLD);
    rig.c.root.add(l.group);
    rig.lantern = l;
    rig.lift = 0;
    rig.sinkAt = -9;
    l.glow(0, 0);
    if (unfold) {
      l.group.scale.set(1, 0.1, 1);
      this.tween(0.45, (k) => l.group.scale.set(1, Math.max(0.1, ease.outBack(k)), 1));
    }
  }

  /** Off it goes, to a spot in the sky (next to its group's other lanterns). */
  launch(seat: number, group: number, size: number, time: number): void {
    const rig = this.rigs[seat];
    const l = rig?.lantern;
    if (!rig || !l) return;
    rig.lantern = null;
    this.scene.attach(l.group);
    const from = l.group.position.clone();
    const near = this.groupSlot.get(group) ?? new THREE.Vector3(from.x * 1.7, 6, -8.5);
    let best = this.slots.find((s) => !s.taken) ?? { p: new THREE.Vector3(from.x, 7, -9), taken: false };
    let bestD = Infinity;
    for (const s of this.slots) {
      if (s.taken) continue;
      const d = Math.abs(s.p.x - near.x) + Math.abs(s.p.y - near.y) * 0.3;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    best.taken = true;
    this.groupSlot.set(group, best.p);
    const together = size >= 2;
    const mirror = new THREE.Sprite(this.mirrorMat);
    mirror.scale.setScalar(0.001);
    this.scene.add(mirror);
    this.flights.push({ lantern: l, from, to: best.p.clone(), age: 0, phase: time + seat, group, together, mirror });
    this.sparks.burst(from, '#ffd34d', together ? 16 : 9, 0.9, 1.2);
    if (together) for (const f of this.flights) if (f.group === group) f.together = true;
  }

  /** Let go too soon: it lifts a little and sinks back into the hands. */
  sink(seat: number, time: number): void {
    const rig = this.rigs[seat];
    if (!rig?.lantern) return;
    rig.sinkAt = time;
    rig.sinkFrom = rig.lantern.heat;
  }

  /** Held too long: the paper burns through, smokes, crumples and drops into the lake. */
  scorch(seat: number): void {
    const rig = this.rigs[seat];
    const l = rig?.lantern;
    if (!rig || !l) return;
    l.scorch();
    l.group.getWorldPosition(this.v);
    for (let i = 0; i < 6; i++) this.puff(this.v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.3)), 0.12 + Math.random() * 0.08);
    this.tween(
      0.45,
      () => {},
      () => {
        if (rig.lantern !== l) return;
        rig.lantern = null;
        this.scene.attach(l.group);
        const from = l.group.position.clone();
        const to = from.clone().add(new THREE.Vector3(0, 0, 1.6)).setY(-0.38);
        this.tween(
          0.8,
          (k) => {
            l.group.position.lerpVectors(from, to, k);
            l.group.position.y += Math.sin(k * Math.PI) * 0.4;
            l.group.scale.set(1 - k * 0.3, 1 - k * 0.6, 1 - k * 0.3);
            l.group.rotation.z = k * 1.4;
            l.glow(Math.max(0, 0.4 - k), k);
          },
          () => {
            this.splash(to);
            l.dispose();
          },
        );
      },
    );
  }

  private splash(at: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({ color: P.moon, transparent: true, opacity: 0.8, depthWrite: false });
    const ring = new THREE.Mesh(torus(0.3, 0.03), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(at.x, -0.37, at.z);
    this.scene.add(ring);
    this.sparks.burst(new THREE.Vector3(at.x, -0.3, at.z), P.moon, 12, 1.3, 1.8);
    this.tween(
      0.8,
      (k) => {
        ring.scale.setScalar(1 + k * 3);
        mat.opacity = 0.8 * (1 - k);
      },
      () => {
        ring.removeFromParent();
        mat.dispose();
      },
    );
  }

  private puff(at: THREE.Vector3, size: number, mat: THREE.Material = this.smokeMat, life = 1.2, vel = new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.7, (Math.random() - 0.5) * 0.3)): void {
    const mesh = new THREE.Mesh(ball(1, 1), mat);
    mesh.position.copy(at);
    mesh.scale.setScalar(size * 0.5);
    this.scene.add(mesh);
    this.puffs.push({ mesh, vel, age: 0, life, size });
  }

  /** The sign: lanterns in the sky against the goal, what's left in the basket, the group bonus. */
  drawSign(up: number, goal: number, basket: number, bonus: number): void {
    const canvas = this.sign.image as HTMLCanvasElement;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(30, 24, 38, 0.92)';
    g.beginPath();
    g.roundRect(14, 14, w - 28, h - 28, 30);
    g.fill();
    g.strokeStyle = 'rgba(201, 163, 91, 0.85)';
    g.lineWidth = 4;
    g.stroke();
    // A little lantern icon.
    g.fillStyle = '#ffd34d';
    g.beginPath();
    g.roundRect(46, 52, 62, 84, 22);
    g.fill();
    g.fillStyle = '#ff9a3c';
    g.fillRect(66, 136, 22, 10);
    g.textBaseline = 'middle';
    g.fillStyle = P.cream;
    g.font = `800 88px ${ROUNDED_FONT}`;
    g.fillText(`${up} / ${goal}`, 136, 98);
    g.font = `600 36px ${ROUNDED_FONT}`;
    g.fillStyle = P.linen;
    g.fillText(`in the sky · ${basket} in the basket`, 46, 190);
    if (bonus > 0) {
      g.fillStyle = '#ffd34d';
      g.fillText(`Together bonus +${bonus.toFixed(1)}`, 46, 244);
    }
    this.sign.needsUpdate = true;
  }

  /** How many folded lanterns show in the basket. */
  basket(left: number): void {
    this.folded.forEach((m, i) => (m.visible = i < left));
  }

  private tween(duration: number, step: (k: number) => void, done?: () => void): void {
    this.tweens.push({ t: 0, duration, step, ...(done ? { done } : {}) });
  }

  /** Each holder's lantern glows as warm as the rules say; moods follow. */
  sync(s: Shore, time: number): void {
    s.holders.forEach((h, i) => {
      const rig = this.rigs[i];
      if (!rig) return;
      const l = rig.lantern;
      let mood: CompanionMood = 'idle';
      if (h.state === 'warming') mood = heatNow(s, i) >= LANTERN.zone ? 'thinking' : 'working';
      else if (h.state === 'empty') mood = 'listening';
      if (mood !== rig.mood) {
        rig.mood = mood;
        rig.c.setBase(mood);
      }
      rig.light.intensity = l ? l.shine : 0;
      if (!l) return;
      let heat = heatNow(s, i);
      // A too-early lantern lifts a little, wobbles and settles back, cooling to what it keeps.
      const u = (time - rig.sinkAt) / LANTERN.sink;
      if (u >= 0 && u < 1) {
        rig.lift = Math.sin(u * Math.PI) * 0.6;
        heat = rig.sinkFrom + (rig.sinkFrom * LANTERN.keep - rig.sinkFrom) * u;
        l.group.rotation.z = Math.sin(u * 14) * 0.15 * (1 - u);
      } else {
        rig.lift = 0;
        l.group.rotation.z = h.state === 'warming' ? Math.sin(time * 9 + i) * 0.03 * heat : 0;
      }
      if (l.group.parent === rig.c.root) l.group.position.set(HOLD.x, HOLD.y + rig.lift + (h.state === 'warming' ? heat * 0.08 : 0), HOLD.z);
      l.glow(heat, time);
      rig.light.color.copy(l.color);
      rig.light.intensity = l.shine;
      rig.light.position.copy(l.group.position);
    });
  }

  dispose(): void {
    for (const r of this.rigs) {
      r.lantern?.dispose();
      r.c.dispose();
    }
    for (const f of this.flights) f.lantern.dispose();
    for (const p of this.puffs) p.mesh.removeFromParent();
    this.floaters.dispose();
    this.sign.dispose();
    this.signMat.dispose();
    this.smokeMat.dispose();
    this.sparkMat.dispose();
    this.mirrorMat.dispose();
    this.sparks.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    for (const r of this.rigs) r.c.update(dt);
    this.floaters.update(dt);
    this.sparks.update(dt);
    this.tick(dt, time);
    // Lanterns drifting up to their spot in the sky, then bobbing there.
    for (const f of this.flights) {
      f.age += dt;
      const k = Math.min(1, f.age / RISE);
      const up = ease.outCubic(k);
      const across = ease.inOutSine(k);
      const p = f.lantern.group.position;
      p.set(f.from.x + (f.to.x - f.from.x) * across, f.from.y + (f.to.y - f.from.y) * up, f.from.z + (f.to.z - f.from.z) * across);
      p.x += Math.sin(time * 0.9 + f.phase) * (0.25 * (1 - k) + 0.08);
      p.y += Math.sin(time * 1.3 + f.phase * 2) * 0.12 * k;
      f.lantern.group.rotation.z = Math.sin(time * 1.1 + f.phase) * 0.08;
      f.lantern.glow(f.together ? 1 : 0.9, time, true);
      // its glow lies on the water below, wider as it climbs
      f.mirror.position.set(p.x, -0.3, p.z + 0.5);
      f.mirror.scale.set(0.6 + k * 1.3, 0.16 + k * 0.2 + Math.sin(time * 2.3 + f.phase) * 0.03, 1);
      if (f.together && k < 0.85 && Math.random() < dt * 14) {
        this.puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.35, 0)), 0.05, this.sparkMat, 0.7, new THREE.Vector3(0, -0.4, 0));
      }
    }
    this.tweens = this.tweens.filter((tw) => {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.duration);
      tw.step(k);
      if (k >= 1) tw.done?.();
      return k < 1;
    });
    this.puffs = this.puffs.filter((p) => {
      p.age += dt;
      const k = p.age / p.life;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.size * (0.5 + k) * Math.max(0, 1 - k * k));
      if (k < 1) return true;
      p.mesh.removeFromParent();
      return false;
    });
    this.fireflies.forEach((m) => {
      const u = m.userData as { x: number; y: number; z: number; k: number };
      m.position.set(u.x + Math.sin(time * 0.4 + u.k) * 0.7, u.y + Math.sin(time * 0.7 + u.k * 2) * 0.3, u.z + Math.cos(time * 0.3 + u.k) * 0.5);
      m.scale.setScalar(0.5 + 0.5 * Math.abs(Math.sin(time * 1.5 + u.k)));
    });
    this.glints.forEach((g, i) => (g.scale.x = 0.8 + 0.25 * Math.sin(time * 1.2 + i * 1.7)));
  }
}

// ------------------------------------------------------------------ little sounds

function whoof(sfx: Sfx): void {
  noise(sfx, { dur: 0.25, freq: 500, to: 1200, gain: 0.08 });
}

function ting(sfx: Sfx): void {
  tone(sfx, { freq: 1318, dur: 0.18, gain: 0.05 });
}

function rise(sfx: Sfx, together: boolean): void {
  noise(sfx, { dur: 0.6, filter: 'bandpass', freq: 500, to: 1400, gain: 0.08 });
  tone(sfx, { freq: 523, to: 784, dur: 0.5, type: 'triangle', gain: 0.07 });
  if (together) {
    tone(sfx, { freq: 659, dur: 0.5, type: 'sine', gain: 0.06, delay: 0.12 });
    tone(sfx, { freq: 988, dur: 0.6, type: 'sine', gain: 0.05, delay: 0.24 });
  }
}

function fwoop(sfx: Sfx): void {
  tone(sfx, { freq: 440, to: 260, dur: 0.4, type: 'sine', gain: 0.07 });
}

function crackle(sfx: Sfx): void {
  noise(sfx, { dur: 0.35, filter: 'highpass', freq: 2500, gain: 0.12 });
  tone(sfx, { freq: 220, to: 120, dur: 0.3, type: 'triangle', gain: 0.06, delay: 0.1 });
  noise(sfx, { dur: 0.3, freq: 400, gain: 0.15, delay: 1.2 });
}

// ------------------------------------------------------------------ the minigame

export const minigame: Minigame = {
  id: 'lanterns',
  title: 'Sky Lanterns',
  how: 'Hold to warm the air in your paper lantern and let go when it glows gold. Too soon and it sinks back, too long and the paper scorches. Let go together for a group release!',
  controller: 'hold',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const shore = newShore(rng, n);
    const brains: (LanternBrain | null)[] = seats.map((_, i) => (session.isCpu(i) ? newLanternBrain(ctx.skill()) : null));
    const view = new LakeView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), basketSize(n));
    ctx.stage.setView(view);
    const layout = { kind: 'hold' as const, label: 'Warm up', note: 'Hold to warm your lantern. Let go when it glows gold!', zone: [LANTERN.zone, 1] as [number, number] };
    session.setLayoutAll(() => layout);

    const held = seats.map(() => false);
    const golden = seats.map(() => false);
    let frameAt = performance.now();
    const arrival = () => shore.time + Math.max(0, Math.min(0.1, (performance.now() - frameAt) / 1000)) * clock.speed;
    const lagOf = (seat: number) => Math.min(LANTERN.maxLag, (session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed;
    const tell = (seat: number, good: boolean, text: string) => session.send(seat, { t: 'feedback', good, text });
    let over = false;
    let captionUntil = 0;
    const say = (text: string, color?: string) => {
      ui.caption(text, color);
      captionUntil = shore.time + 2.4;
    };
    const status = () => {
      const left = shore.basket + shore.holders.filter((h) => h.state === 'ready' || h.state === 'warming' || h.state === 'sinking').length;
      return `${shore.launches.length} of ${shore.goal} lanterns up · ${left} still to go`;
    };
    const refreshSign = () => {
      view.drawSign(shore.launches.length, shore.goal, shore.basket, togetherCount(shore) * LANTERN.bonus);
      view.basket(shore.basket);
    };

    const handle = (e: ShoreEvent) => {
      const rig = view.rigs[e.seat];
      const seat = seats[e.seat] as MinigameSeat;
      golden[e.seat] = false;
      session.send(e.seat, { t: 'meter', value: 0, danger: false });
      if (e.kind === 'launch') {
        view.launch(e.seat, e.group, e.size, clock.time);
        rise(sfx, e.size >= 2);
        rig?.c.react('happy', 1.4);
        const x = rig?.c.root.position.x ?? 0;
        if (e.size >= 2) {
          view.floaters.add(e.size >= 3 ? `${e.size} together!` : 'Together!', '#ffd34d', new THREE.Vector3(x, HEIGHT + 1.6, 0), 0.5);
          say(`Group release! The lanterns rise together.`, '#ffd34d');
          for (const s of shore.groups[e.group] ?? []) tell(s, true, 'Up together! Group bonus.');
        } else {
          view.floaters.add('Up it goes!', seat.color, new THREE.Vector3(x, HEIGHT + 1.4, 0), 0.4);
          tell(e.seat, true, 'Up it goes!');
        }
        session.send(e.seat, { t: 'buzz', pattern: [30] });
        refreshSign();
      } else if (e.kind === 'early') {
        view.sink(e.seat, clock.time);
        fwoop(sfx);
        rig?.c.react('thinking', 1.0);
        view.floaters.add('Too soon', '#d8d3e8', new THREE.Vector3(rig?.c.root.position.x ?? 0, HEIGHT + 1.4, 0), 0.36);
        tell(e.seat, false, 'Too soon, it sank back. Warm it a bit longer!');
      } else if (e.kind === 'scorch') {
        view.scorch(e.seat);
        crackle(sfx);
        rig?.c.react('sad', 1.6);
        view.floaters.add('Scorched!', '#ff9a6b', new THREE.Vector3(rig?.c.root.position.x ?? 0, HEIGHT + 1.4, 0), 0.42);
        tell(e.seat, false, 'Scorched! Let go sooner next time.');
        session.send(e.seat, { t: 'buzz', pattern: [200, 80, 200] });
        refreshSign();
      } else if (e.kind === 'unfold') {
        view.give(e.seat);
        sfx.hop();
        tell(e.seat, true, held[e.seat] ? 'A fresh lantern! Let go, then hold to warm it.' : 'A fresh lantern. Hold to warm it.');
        refreshSign();
      } else {
        rig?.c.react('listening', 1);
        session.setLayout(e.seat, { kind: 'wait', title: 'The basket is empty', text: 'Watch the lanterns float away' });
      }
    };

    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'hold' || over || seat >= n || session.isCpu(seat)) return;
      held[seat] = msg.down;
      if (msg.down) {
        if (press(shore, seat, lagOf(seat), arrival())) whoof(sfx);
      } else {
        const e = letGo(shore, seat, arrival());
        if (e) handle(e);
      }
    });

    refreshSign();
    ui.caption('Hold to warm your lantern, let go when it glows gold!');
    captionUntil = 3;
    let hudAt = -1;
    let meterAt = -1;
    await everyFrame(clock, (dt) => {
      frameAt = performance.now();
      let left = dt;
      while (left > 1e-6 && !shoreOver(shore)) {
        const step = Math.min(STEP, left);
        left -= step;
        for (const e of stepShore(shore, step, rng)) handle(e);
        seats.forEach((_, i) => {
          if (!session.isCpu(i)) return;
          const b = brains[i] ?? (brains[i] = newLanternBrain(0.5));
          const act = cpuLantern(shore, i, b, rng);
          if (act === 'press') press(shore, i, 0);
          else if (act === 'release') {
            const e = letGo(shore, i);
            if (e) handle(e);
          }
        });
      }
      view.sync(shore, clock.time);
      // A soft ting as a lantern turns gold, and the phones' rings.
      shore.holders.forEach((h, i) => {
        const now = h.state === 'warming' && heatNow(shore, i) >= LANTERN.zone;
        if (now && !golden[i]) ting(sfx);
        golden[i] = now;
      });
      if (shore.time - meterAt >= 0.066) {
        meterAt = shore.time;
        shore.holders.forEach((h, i) => {
          if (session.isCpu(i) || h.state !== 'warming') return;
          const v = heatNow(shore, i);
          session.send(i, { t: 'meter', value: v, danger: v >= LANTERN.danger });
        });
      }
      if (captionUntil && shore.time > captionUntil) {
        captionUntil = 0;
        ui.caption(status());
      }
      if (shore.time - hudAt > 0.2) {
        hudAt = shore.time;
        ui.timer(LANTERN.duration - shore.time);
        ui.live(
          seats.map((s, i) => {
            const h = shore.holders[i];
            const sc = h?.scorched ?? 0;
            return { name: s.name, color: s.color, thumb: s.thumb, value: `${h?.launched ?? 0} up${sc ? ` · ${sc} scorched` : ''}` };
          }),
        );
      }
      return shoreOver(shore);
    });
    over = true;
    off();
    ui.timer(null);

    // Whatever is still warming stays on the jetty; let the last lanterns drift up.
    const coop = lanternCoop(shore);
    const up = shore.launches.length;
    const together = togetherCount(shore);
    for (const r of view.rigs) r.c.setBase(coop >= 0.6 ? 'happy' : 'sad');
    session.setLayoutAll(() => ({ kind: 'wait', title: coop >= 1 ? 'What a sky!' : coop >= 0.5 ? 'Lovely lanterns' : 'A few made it up', text: 'Watch the big screen' }));
    ui.caption(
      coop >= 1
        ? `The sky is full of lanterns!${together ? ' Lovely group releases.' : ''}`
        : `${up} of ${shore.goal} lanterns made it up${together ? `, ${together} of them together` : ''}.`,
      coop >= 1 ? '#ffd34d' : undefined,
    );
    if (coop >= 0.6) sfx.good();
    else sfx.bad();
    await clock.wait(2.4);
    ui.caption(null);
    const score = Math.round(coop * 1000);
    return {
      scores: seats.map(() => score),
      details: shore.holders.map((h) => {
        const parts = [`${h.launched} lantern${h.launched === 1 ? '' : 's'} up`];
        if (h.together) parts.push(`${h.together} together`);
        if (h.scorched) parts.push(`${h.scorched} scorched`);
        return parts.join(' · ');
      }),
      coop,
    };
  },
};

