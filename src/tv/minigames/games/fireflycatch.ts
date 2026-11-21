// Firefly Jar on the TV: a meadow at dusk, tall grass all round, a lantern glowing at the back and a picnic blanket
// someone forgot to pack up. Two glass jars sit on tree stumps at either edge; every firefly a team nets floats over
// into its jar, which glows brighter the fuller it gets.
import * as THREE from 'three';
import {
  FIREFLY,
  type Brain,
  type Catcher,
  type Fly,
  type Meadow,
  type Stick,
  IDLE,
  advance,
  brightest,
  cpuStick,
  isOver,
  jarScores,
  newBrain,
  newMeadow,
} from '../../../game/minigames/fireflycatch';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { preloadTextures } from '../../render/textures';
import { PALETTE as P, ball, box, canvasTexture, cone, cyl, mix, nameCard, part, popSprite, rbox, seeded, sphere, toonMat, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.2; // companions
const TILT = 0.82; // how far the camera looks down
const JAR_X = FIREFLY.bounds.x + 1.3; // the jars stand just outside the meadow, left and right
const JAR_Z = -0.4;
const JAR_MOUTH = 1.5; // where a caught firefly drops in
const JAR_BITS = 44; // little lights shown inside a jar (it keeps getting brighter after that)
const FULL = 45; // a jar this full glows its brightest
const FLY_GLOW = '#eaff8c';
const GOLD_GLOW = '#ffc94a';
const FLY_DARK = '#4d4a3c';
const BACK = -7.4; // the fence at the back of the meadow
const FLIGHT = 0.75; // seconds a caught firefly takes to float over to the jar
const GRASS_GREENS = [P.fern, mix(P.fern, P.moss, 0.5), P.leafDark, mix(P.moss, P.pine, 0.4), mix(P.fern, P.pine, 0.5)];
const BLADES_BRIGHT = 1.3; // the long grass catches a little of the evening light

// ------------------------------------------------------------------ sounds

const swish = (sfx: Sfx) => noise(sfx, { dur: 0.13, filter: 'bandpass', freq: 1500, to: 600, gain: 0.06 });
const plink = (sfx: Sfx, gold: boolean) => {
  if (gold) {
    [988, 1319, 1760].forEach((f, i) => tone(sfx, { freq: f, dur: 0.18, type: 'triangle', gain: 0.07, delay: i * 0.07 }));
    return;
  }
  tone(sfx, { freq: 1320, to: 1760, dur: 0.12, gain: 0.07 });
  tone(sfx, { freq: 2640, dur: 0.1, gain: 0.03, delay: 0.06 });
};
const tink = (sfx: Sfx) => tone(sfx, { freq: 2300, dur: 0.05, gain: 0.025 });
const fwip = (sfx: Sfx) => tone(sfx, { freq: 700, to: 1700, dur: 0.12, gain: 0.05 });
const shimmer = (sfx: Sfx) => {
  tone(sfx, { freq: 1568, dur: 0.4, gain: 0.05 });
  tone(sfx, { freq: 2093, dur: 0.5, gain: 0.04, delay: 0.12 });
  tone(sfx, { freq: 2637, dur: 0.6, gain: 0.03, delay: 0.24 });
};
/** A cricket somewhere in the long grass: three tiny chirps. */
const cricket = (sfx: Sfx, pitch: number) => {
  for (let k = 0; k < 3; k++) tone(sfx, { freq: 4000 * pitch, dur: 0.025, gain: 0.012, delay: k * 0.055 });
};

// ------------------------------------------------------------------ bits of the scene

/** A soft round glow for halos (white, tinted by the sprite). */
function haloTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function haloSprite(tex: THREE.Texture, color: string, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

/** A butterfly net held at the hand: handle along +y, the hoop on top in the team's colour, a gauzy bag behind. */
function butterflyNet(color: string): THREE.Group {
  const pivot = new THREE.Group();
  part(pivot, cyl(0.02, 0.024, 0.8, 8), P.oak, 0, 0.4, 0, { tex: 'wood', outline: false });
  part(pivot, cyl(0.028, 0.028, 0.16, 8), P.walnut, 0, 0.1, 0, { tex: 'leather', outline: false });
  part(pivot, cyl(0.026, 0.026, 0.05, 8), P.brass, 0, 0.8, 0, { gloss: 0.6, outline: false });
  part(pivot, torus(0.2, 0.022), color, 0, 1.0, 0, { glow: 0.6, outline: false });
  part(pivot, cone(0.19, 0.36, 14), P.cream, 0, 1.0, -0.18, { rx: -Math.PI / 2, opacity: 0.38, outline: false, shadow: false });
  return pivot;
}

interface FlyRig {
  g: THREE.Group;
  core: THREE.MeshBasicMaterial;
  halo: THREE.Sprite;
  wings: THREE.Mesh[];
  light: number;
  gold: boolean;
  phase: number;
}

interface Flight {
  rig: FlyRig;
  from: THREE.Vector3;
  team: number;
  t: number;
}

interface Drift {
  rig: FlyRig;
  t: number;
}

interface JarRig {
  x: number;
  color: string;
  glass: THREE.MeshToonMaterial;
  light: THREE.PointLight;
  halo: THREE.Sprite;
  bits: { m: THREE.Mesh; base: THREE.Vector3; phase: number }[];
  filled: number;
  label: THREE.Sprite | null;
  shown: number;
  pulse: number;
  level: number;
}

interface Rig {
  c: Companion;
  ring: THREE.Mesh;
  net: THREE.Group;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
}

// ------------------------------------------------------------------ the view

class MeadowView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly words: Floaters;
  readonly rigs: Rig[] = [];
  private readonly jars: JarRig[] = [];
  private readonly flies = new Map<number, FlyRig>();
  private flights: Flight[] = [];
  private drifts: Drift[] = [];
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly tex = haloTexture();
  private readonly tick: (dt: number, time: number) => void = () => {};
  private lantern: THREE.PointLight | null = null;
  private readonly sparks: { s: THREE.Sprite; v: THREE.Vector3; age: number }[] = [];
  private readonly wingMat = new THREE.MeshBasicMaterial({ color: P.moon, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly goldBit = new THREE.MeshBasicMaterial({ color: GOLD_GLOW, toneMapped: false });
  private readonly owned: { dispose(): void }[] = [];
  private grass: THREE.InstancedMesh | null = null;
  private blades: { x: number; z: number; h: number; ry: number; lean: number }[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private time = 0;

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    companions: Companion[],
    private readonly meadow: Meadow,
    private readonly sfx: Sfx,
  ) {
    // Dusk: a low peach sun over the camera's shoulder, violet shade, and everything that glows gets to glow.
    lightRig(this.scene, 'dusk', { fog: { near: 34, far: 80 }, shadowSize: 15, sunFrom: [0.5, 0.6, 0.6] });
    this.words = new Floaters(this.scene);
    this.owned.push(this.tex, this.wingMat, this.goldBit);
    this.buildMeadow();
    this.tick = props.tickProps(this.scene);

    teams.forEach((members, team) => {
      const lead = seats[members[0] ?? 0];
      const color = lead?.color ?? '#ffd166';
      this.jars.push(this.buildJar(team === 0 ? -JAR_X : JAR_X, color, members.map((p) => seats[p]?.name ?? '').join(' & ')));
    });

    seats.forEach((s, p) => {
      const c = companions[p] as Companion;
      const team = meadow.catchers[p]?.team ?? -1;
      const teamColor = this.jars[team]?.color ?? s.color;
      this.scene.add(c.root);
      c.setBase('listening');
      const ring = part(this.scene, torus(0.44, 0.045), s.color, 0, 0.05, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      const net = butterflyNet(teamColor);
      net.position.set(-0.3, HEIGHT * 0.45, 0.08);
      net.rotation.order = 'YXZ'; // tilt forward first, then sweep across

      c.root.add(net);
      this.rigs.push({ c, ring, net, motion: null, mood: null });
    });

    const { x: bx, z: bz } = FIREFLY.bounds;
    for (const px of [-bx - 0.5, bx + 0.5]) {
      for (const pz of [-bz - 0.4, bz + 0.5]) this.marks.push({ p: new THREE.Vector3(px, 0, pz) }, { p: new THREE.Vector3(px, HEIGHT + 0.5, pz), pad: 0.02 });
    }
    for (const side of [-1, 1]) {
      const x = side * JAR_X;
      this.marks.push({ p: new THREE.Vector3(x + side * 0.75, 0, JAR_Z) }, { p: new THREE.Vector3(x, 2.65, JAR_Z), pad: 0.05 }, { p: new THREE.Vector3(x, 0.05, JAR_Z + 1.1), pad: 0.05 });
    }
    this.sync(0);
  }

  // ---------------------------------------------------------------- building

  private buildMeadow(): void {
    const s = this.scene;
    const { x: bx, z: bz } = FIREFLY.bounds;
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, scale = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      s.add(o);
      return o;
    };
    // The ground, the mown meadow in the middle, a worn path round it.
    const turf = { tex: 'grass' as const, outline: false as const, shadow: false };
    part(s, cyl(60, 60, 0.3, 40), mix(P.grassDark, P.ink, 0.25), 0, -0.15, -2, { ...turf, texScale: 5 });
    part(s, rbox(bx * 2 + 1.5, 0.05, bz * 2 + 1.4, 0.02), mix(P.soil, P.grassDark, 0.55), 0, 0.005, 0, { ...turf, texStrength: 0.6 });
    part(s, rbox(bx * 2 + 0.9, 0.055, bz * 2 + 0.8, 0.02), mix(P.grass, P.grassDark, 0.55), 0, 0.012, 0, turf);
    // mowing stripes, barely there
    for (let i = -3; i <= 3; i += 2) part(s, box((bx * 2 + 0.9) / 7, 0.01, bz * 2 + 0.76), mix(P.grass, P.grassDark, 0.3), (i * (bx * 2 + 0.9)) / 7, 0.041, 0, turf);

    // The back of the meadow: a paling fence, a hedge and the wood beyond it.
    put(props.fence({ w: 34, kind: 'picket', color: mix(P.oak, P.plum, 0.45), h: 0.95 }), 0, 0, BACK);
    put(props.hedge({ w: 9, h: 1.3, d: 0.9, seed: 3 }), -9.5, 0, BACK - 1.0);
    put(props.hedge({ w: 7, h: 1.1, d: 0.9, seed: 5 }), 8.5, 0, BACK - 1.0);
    const kinds: props.TreeKind[] = ['round', 'birch', 'pine', 'round', 'round', 'pine', 'birch', 'round'];
    kinds.forEach((kind, i) => {
      const x = -14.5 + i * 4.1 + ((i * 37) % 10) * 0.08;
      put(props.tree({ kind, h: 4.4 + ((i * 53) % 7) * 0.4, seed: i + 2 }), x, 0, BACK - 2.3 - ((i * 29) % 5) * 0.5);
    });
    put(props.bush({ r: 0.7, flowers: P.rose, seed: 2 }), -1.8, 0, BACK - 0.9);
    put(props.bush({ r: 0.55, flowers: P.cream, seed: 6 }), 2.4, 0, BACK - 0.8);
    put(props.rock({ r: 0.45, seed: 3 }), -8.3, 0, -5.6);
    put(props.rock({ r: 0.3, seed: 7 }), -7.7, 0, -5.2);
    put(props.rock({ r: 0.5, seed: 9 }), 10.4, 0, -3.4);
    put(props.logSeat({ len: 1.7, r: 0.24 }), 0.4, 0, -5.4, 0.25);
    // Front corners: a tree's shadowy crown on the left, bushes on the right.
    put(props.bush({ r: 0.9, seed: 11, flowers: P.mustard }), -11.6, 0, 4.6);
    put(props.bush({ r: 0.7, seed: 12 }), 10.6, 0, 5.4);
    put(props.rock({ r: 0.4, seed: 5 }), 9.4, 0, 6.2);

    // A lantern on a post at the back left, still glowing.
    part(s, cyl(0.06, 0.075, 2.0, 10), P.walnut, -5.4, 1.0, -4.7, { tex: 'bark' });
    part(s, rbox(0.56, 0.06, 0.06, 0.02), P.walnut, -5.17, 1.98, -4.7, { tex: 'wood', outline: false });
    part(s, cyl(0.008, 0.008, 0.12, 5), P.ink, -5.0, 1.92, -4.7, { outline: false, shadow: false });
    part(s, cone(0.2, 0.1, 4), P.charcoal, -5.0, 1.89, -4.7, { ry: Math.PI / 4, gloss: 0.4 });
    part(s, box(0.24, 0.3, 0.24), P.lamp, -5.0, 1.69, -4.7, { glow: 1.0, opacity: 0.55, outline: false, shadow: false });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) part(s, box(0.025, 0.32, 0.025), P.charcoal, -5.0 + dx * 0.12, 1.69, -4.7 + dz * 0.12, { outline: false, shadow: false });
    part(s, box(0.28, 0.03, 0.28), P.charcoal, -5.0, 1.53, -4.7, { outline: false });
    part(s, sphere(0.07, 10), P.lamp, -5.0, 1.68, -4.7, { glow: 2.4, outline: false, shadow: false });
    this.lantern = new THREE.PointLight(P.lamp, 10, 10, 1.6);
    this.lantern.position.set(-5.0, 1.8, -4.4);
    s.add(this.lantern);
    const glow = haloSprite(this.tex, P.lamp, 1.8);
    glow.position.set(-5.0, 1.72, -4.6);
    glow.material.opacity = 0.55;
    this.owned.push(glow.material);
    s.add(glow);

    // A picnic blanket at the back right with a bottle, two mugs, a bowl of fruit and a basket.
    const picnic = new THREE.Group();
    picnic.add(props.blanket({ w: 2.3, d: 1.6, color: P.cream, tex: 'gingham' }));
    const lay = (o: THREE.Object3D, x: number, z: number, scale = 1.6, ry = 0) => {
      o.position.set(x, 0.03, z);
      o.scale.setScalar(scale);
      o.rotation.y = ry;
      picnic.add(o);
    };
    lay(props.drink({ kind: 'bottle', color: P.forest }), -0.6, 0.2, 1.9);
    lay(props.mug({ color: P.ceramic }), -0.15, 0.4);
    lay(props.mug({ color: P.terracotta }), 0.1, -0.05, 1.6, 1.2);
    lay(props.snackBowl({ fill: 'fruit', color: P.denim }), 0.55, 0.3, 1.5);
    const basket = new THREE.Group();
    part(basket, rbox(0.6, 0.3, 0.42, 0.05), P.oak, 0, 0.15, 0, { tex: 'planks', texScale: 0.4 });
    part(basket, rbox(0.3, 0.03, 0.44, 0.01), P.wood, -0.16, 0.32, 0, { tex: 'planks', texScale: 0.4, rz: 0.5 });
    part(basket, torus(0.2, 0.018, Math.PI), P.wood, 0, 0.3, 0, { outline: false });
    lay(basket, 0.55, -0.4, 1, 0.3);
    put(picnic, 4.6, 0.02, -5.1, 0.12);

    // Tall grass all round the meadow (short at the front, so it never hides anyone), a few tufts inside.
    const rand = seeded(41);
    const add = (x: number, z: number, h: number) => this.blades.push({ x, z, h, ry: rand() * Math.PI, lean: (rand() - 0.5) * 0.3 });
    const clearOf = (x: number, z: number) => Math.hypot(x + 5.3, z + 4.7) > 0.5 && !(Math.abs(x - 4.6) < 1.5 && Math.abs(z + 5.1) < 1.1) && !(Math.abs(x - 0.4) < 1.1 && Math.abs(z + 5.4) < 0.5);
    for (let i = 0; i < 620; i++) {
      const x = (rand() * 2 - 1) * 13;
      const z = -3.9 - rand() * 3.3;
      const h = 0.6 + rand() * 0.9;
      if (clearOf(x, z)) add(x, z, h);
    }
    for (let i = 0; i < 300; i++) {
      const side = rand() < 0.5 ? -1 : 1;
      const x = side * (bx + 0.9 + rand() * 5.5);
      const z = -3.9 + rand() * 8.6;
      // Keep a clearing round each jar.
      if (Math.hypot(Math.abs(x) - JAR_X, z - JAR_Z) < 1.6 || (Math.abs(x) < JAR_X + 1 && z > JAR_Z + 0.3 && z < JAR_Z + 1.6)) continue;
      add(x, z, Math.abs(x) > JAR_X + 1.2 ? 0.5 + rand() * 0.8 : 0.3 + rand() * 0.4);
    }
    for (let i = 0; i < 260; i++) add((rand() * 2 - 1) * 13, bz + 0.9 + rand() * 3.2, 0.2 + rand() * 0.3);
    for (let i = 0; i < 90; i++) add((rand() * 2 - 1) * bx, (rand() * 2 - 1) * bz, 0.1 + rand() * 0.14);
    const mesh = new THREE.InstancedMesh(cone(0.06, 1, 5), toonMat({ color: '#ffffff' }), this.blades.length);
    this.owned.push(mesh.material as THREE.Material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const color = new THREE.Color();
    for (let i = 0; i < this.blades.length; i++) {
      color.set(GRASS_GREENS[Math.floor(rand() * GRASS_GREENS.length)] as string).multiplyScalar(BLADES_BRIGHT * (0.8 + rand() * 0.35));
      mesh.setColorAt(i, color);
    }
    this.grass = mesh;
    this.swayGrass();
    s.add(mesh);
    // Little flowers dotted about the edges.
    const petals = [P.cream, P.rose, P.mustard, P.mauve];
    for (let i = 0; i < 60; i++) {
      const b = this.blades[Math.floor(rand() * this.blades.length)];
      if (!b || b.h < 0.3) continue;
      part(s, sphere(0.055, 6), petals[i % petals.length] as string, b.x + 0.05, b.h * 0.8, b.z, { outline: false, shadow: false });
    }
  }

  private swayGrass(): void {
    const g = this.grass;
    if (!g) return;
    this.blades.forEach((b, i) => {
      const sway = Math.sin(this.time * 1.3 + b.x * 0.45 + b.z * 0.3) * 0.07 * Math.min(1, b.h);
      this.e.set(b.lean + sway, b.ry, sway * 0.6);
      this.q.setFromEuler(this.e);
      this.v.set(b.x, b.h / 2, b.z);
      this.sc.set(1, b.h, 1);
      g.setMatrixAt(i, this.m4.compose(this.v, this.q, this.sc));
    });
    g.instanceMatrix.needsUpdate = true;
  }

  private buildJar(x: number, color: string, names: string): JarRig {
    const g = new THREE.Group();
    g.position.set(x, 0, JAR_Z);
    this.scene.add(g);
    // A tree stump: bark round it, pale rings on top, a root or two.
    part(g, cyl(0.62, 0.74, 0.55, 20), P.soilDark, 0, 0.275, 0, { tex: 'bark' });
    part(g, cyl(0.59, 0.59, 0.02, 24), P.oak, 0, 0.56, 0, { tex: 'wood', texScale: 0.6, outline: false });
    for (const r of [0.44, 0.27, 0.12]) part(g, torus(r, 0.012), mix(P.oak, P.walnut, 0.6), 0, 0.572, 0, { rx: Math.PI / 2, outline: false, shadow: false });
    for (const a of [0.6, 2.5, 4.4]) part(g, cone(0.2, 0.5, 6), P.soilDark, Math.cos(a) * 0.68, 0.1, Math.sin(a) * 0.68, { tex: 'bark', rz: Math.cos(a) * 1.25, rx: -Math.sin(a) * 1.25, outline: false });
    // The jar: glass, a brass screw lid with a band in the team's colour.
    part(g, cyl(0.3, 0.3, 0.1, 24), P.brass, 0, 1.69, 0, { gloss: 0.7 });
    part(g, cyl(0.31, 0.31, 0.035, 24), color, 0, 1.675, 0, { glow: 0.9, outline: false, shadow: false });
    const glass = new THREE.MeshToonMaterial({ color: P.screen, transparent: true, opacity: 0.26, depthWrite: false, emissive: new THREE.Color(FLY_GLOW), emissiveIntensity: 0 });
    this.owned.push(glass);
    part(g, cyl(0.46, 0.46, 1.04, 28), P.screen, 0, 1.1, 0, { material: glass, outline: false, shadow: false });
    part(g, cyl(0.3, 0.46, 0.08, 28), P.screen, 0, 1.63, 0, { material: glass, outline: false, shadow: false });
    part(g, torus(0.46, 0.022), P.screen, 0, 1.6, 0, { rx: Math.PI / 2, opacity: 0.6, outline: false, shadow: false });
    part(g, torus(0.455, 0.02), P.screen, 0, 0.6, 0, { rx: Math.PI / 2, opacity: 0.5, outline: false, shadow: false });
    // a soft streak of light down the glass
    part(g, box(0.05, 0.7, 0.01), P.cream, -0.22, 1.12, 0.41, { basic: true, opacity: 0.28, ry: -0.5, shadow: false });
    const light = new THREE.PointLight(FLY_GLOW, 0, 7, 1.5);
    light.position.set(0, 1.1, 0.3);
    g.add(light);
    const halo = haloSprite(this.tex, FLY_GLOW, 1.6);
    halo.position.set(0, 1.1, 0);
    halo.material.opacity = 0;
    this.owned.push(halo.material);
    g.add(halo);
    const rand = seeded(x > 0 ? 17 : 29);
    const bits: JarRig['bits'] = [];
    for (let i = 0; i < JAR_BITS; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 0.34;
      const m = part(g, ball(0.055, 1), FLY_GLOW, Math.cos(a) * r, 0, Math.sin(a) * r, { basic: true, shadow: false });
      m.visible = false;
      bits.push({ m, base: new THREE.Vector3(Math.cos(a) * r, 0.68 + rand() * 0.8, Math.sin(a) * r), phase: rand() * 6 });
    }
    const card = nameCard(names, color, 1.15);
    card.position.set(x, 0.3, JAR_Z + 1.1);
    this.owned.push(card.material.map as THREE.Texture, card.material);
    this.scene.add(card);
    return { x, color, glass, light, halo, bits, filled: 0, label: null, shown: -1, pulse: 0, level: 0 };
  }

  private flyRig(f: Fly): FlyRig {
    const g = new THREE.Group();
    const glow = f.gold ? GOLD_GLOW : FLY_GLOW;
    part(g, ball(f.gold ? 0.07 : 0.055, 1), P.aubergine, 0, 0, 0.03, { sz: 1.4, outline: false });
    const core = new THREE.MeshBasicMaterial({ color: glow, toneMapped: false });
    const tail = new THREE.Mesh(ball(f.gold ? 0.075 : 0.06, 1), core);
    tail.position.set(0, -0.01, -0.06);
    g.add(tail);
    const wings = [-1, 1].map((side) => {
      const w = new THREE.Mesh(ball(0.06, 1), this.wingMat);
      w.scale.set(1.5, 0.18, 0.8);
      w.position.set(side * 0.07, 0.04, 0.02);
      g.add(w);
      return w;
    });
    const halo = haloSprite(this.tex, glow, f.gold ? 1.05 : 0.7);
    halo.position.set(0, 0, -0.05);
    g.add(halo);
    this.scene.add(g);
    const rig: FlyRig = { g, core, halo, wings, light: f.lit ? 1 : 0, gold: f.gold, phase: (f.id * 2.399) % (Math.PI * 2) };
    this.flies.set(f.id, rig);
    return rig;
  }

  private dropFly(rig: FlyRig): void {
    this.scene.remove(rig.g);
    rig.core.dispose();
    rig.halo.material.dispose();
  }

  // ---------------------------------------------------------------- events from the game

  /** A few motes of light flying off a spot. */
  private sparkle(at: THREE.Vector3, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.time * 4;
      const sp = haloSprite(this.tex, color, 0.3);
      sp.position.copy(at);
      this.scene.add(sp);
      this.sparks.push({ s: sp, v: new THREE.Vector3(Math.cos(a) * 1.3, 0.9 + (i % 3) * 0.4, Math.sin(a) * 1.3), age: 0 });
    }
  }

  /** A firefly was netted: it floats over to the team's jar. */
  caught(id: number, team: number): void {
    const rig = this.flies.get(id);
    if (!rig) return;
    this.sparkle(rig.g.position, rig.gold ? GOLD_GLOW : FLY_GLOW, rig.gold ? 8 : 4);
    this.flies.delete(id);
    rig.light = 1;
    this.flights.push({ rig, from: rig.g.position.clone(), team, t: 0 });
  }

  /** A golden firefly nobody caught drifts up and away. */
  floatOff(id: number): void {
    const rig = this.flies.get(id);
    if (!rig) return;
    this.flies.delete(id);
    this.drifts.push({ rig, t: 0 });
  }

  /** Where a firefly is now (for words that pop up there). */
  flyAt(id: number): THREE.Vector3 | null {
    return this.flies.get(id)?.g.position.clone() ?? null;
  }

  head(p: number): THREE.Vector3 {
    const r = this.rigs[p];
    const v = r ? r.c.root.position.clone() : new THREE.Vector3();
    v.y += HEIGHT + 0.4;
    return v;
  }

  setMood(p: number, mood: CompanionMood): void {
    const r = this.rigs[p];
    if (!r || r.mood === mood) return;
    r.mood = mood;
    r.c.setBase(mood);
  }

  react(p: number, mood: CompanionMood, seconds: number): void {
    this.rigs[p]?.c.react(mood, seconds);
  }

  /** Time's up: everyone stops where they are. */
  rest(): void {
    for (const r of this.rigs) {
      r.motion = null;
      r.c.move(null, 0);
    }
  }

  cheer(team: number): void {
    const jar = this.jars[team];
    if (!jar) return;
    jar.pulse = 1.5;
    this.words.add('Brightest jar!', '#fff6a8', new THREE.Vector3(jar.x, 2.9, JAR_Z), 0.55, 2.4);
  }

  // ---------------------------------------------------------------- every frame

  /** Puts everyone and every firefly where the rules say they are. */
  sync(dt: number): void {
    const m = this.meadow;
    m.catchers.forEach((c, p) => this.syncCatcher(c, p));
    const alive = new Set<number>();
    for (const f of m.flies) {
      alive.add(f.id);
      const rig = this.flies.get(f.id) ?? this.flyRig(f);
      rig.light += ((f.lit ? 1 : 0) - rig.light) * Math.min(1, dt * 12);
      const bob = Math.sin(this.time * 1.4 + rig.phase) * 0.28 + Math.sin(this.time * 3.3 + rig.phase * 2) * 0.1;
      const y = (f.gold ? 1.0 : 0.8) + bob;
      const up = 1 - f.rise / FIREFLY.rise;
      rig.g.position.set(f.x, 0.08 + (y - 0.08) * up * (2 - up), f.z);
      if (Math.hypot(f.vx, f.vz) > 0.05) rig.g.rotation.y = Math.atan2(f.vx, f.vz);
    }
    for (const [id, rig] of this.flies) {
      if (alive.has(id)) continue;
      this.flies.delete(id);
      this.dropFly(rig);
    }
  }

  private syncCatcher(c: Catcher, p: number): void {
    const rig = this.rigs[p];
    if (!rig || c.team < 0) return;
    const root = rig.c.root;
    root.position.set(c.x, 0, c.z);
    root.rotation.y = c.face;
    rig.ring.position.set(c.x, 0.04, c.z);
    const speed = Math.hypot(c.vx, c.vz);
    const motion = speed < 0.3 ? null : speed <= FIREFLY.sneak + 0.1 ? 'walk' : 'run';
    if (motion !== rig.motion) {
      rig.motion = motion;
      rig.c.move(motion, speed);
    }
    // The net: held up at rest; a swing winds back, sweeps down across the front and comes back up.
    const k = c.swing < 0 ? -1 : c.swing / FIREFLY.swing;
    let rx = -0.35;
    let ry = 0;
    if (k >= 0 && k < 0.2) rx = -0.35 - (k / 0.2) * 0.45;
    else if (k >= 0.2 && k < 0.58) {
      const u = (k - 0.2) / 0.38;
      rx = -0.8 + u * 2.3;
      ry = 0.7 - u * 1.3;
    } else if (k >= 0.58) {
      const u = (k - 0.58) / 0.42;
      rx = 1.5 - u * 1.85;
      ry = -0.6 + u * 0.6;
    }
    rig.net.rotation.set(rx, ry, 0.2);
  }

  /** A firefly's glow follows its blinking. */
  private shine(rig: FlyRig): void {
    const l = rig.light;
    rig.core.color.set(mix(FLY_DARK, rig.gold ? GOLD_GLOW : FLY_GLOW, l));
    rig.halo.material.opacity = 0.04 + 0.9 * l;
    const base = rig.gold ? 1.05 : 0.7;
    rig.halo.scale.setScalar(base * (0.55 + 0.45 * l) * (1 + Math.sin(this.time * 9 + rig.phase) * 0.05));
    const flap = Math.sin(this.time * 38 + rig.phase) * 0.6;
    rig.wings.forEach((w, i) => (w.rotation.z = (i === 0 ? 1 : -1) * flap));
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks);
    this.words.update(dt);
    for (const r of this.rigs) r.c.update(dt);
    this.swayGrass();
    this.tick(dt, this.time);
    if (this.lantern) this.lantern.intensity = 10 + Math.sin(this.time * 6.3) * 0.5 + Math.sin(this.time * 14.1) * 0.3;
    for (const rig of this.flies.values()) this.shine(rig);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i] as (typeof this.sparks)[number];
      sp.age += dt;
      sp.v.y -= 3 * dt;
      sp.s.position.addScaledVector(sp.v, dt);
      sp.s.material.opacity = Math.max(0, 1 - sp.age / 0.5);
      if (sp.age < 0.5) continue;
      sp.s.removeFromParent();
      sp.s.material.dispose();
      this.sparks.splice(i, 1);
    }

    // Caught fireflies on their way to the jar.
    this.flights = this.flights.filter((f) => {
      f.t += dt / FLIGHT;
      const jar = this.jars[f.team];
      const to = new THREE.Vector3(jar?.x ?? 0, JAR_MOUTH, JAR_Z);
      const k = Math.min(1, f.t);
      const e = k * k * (3 - 2 * k);
      f.rig.g.position.lerpVectors(f.from, to, e);
      f.rig.g.position.y += Math.sin(Math.PI * k) * 1.4;
      this.shine(f.rig);
      if (k < 1) return true;
      this.sparkle(to, f.rig.gold ? GOLD_GLOW : FLY_GLOW, f.rig.gold ? 9 : 5);
      this.dropFly(f.rig);
      tink(this.sfx);
      return false;
    });
    // Golden ones nobody caught, drifting off into the evening.
    this.drifts = this.drifts.filter((d) => {
      d.t += dt;
      d.rig.g.position.y += dt * 1.6;
      d.rig.g.position.z -= dt * 1.2;
      d.rig.light = Math.max(0, 1 - d.t);
      this.shine(d.rig);
      if (d.t < 1) return true;
      this.dropFly(d.rig);
      return false;
    });

    this.meadow.jars.forEach((j, team) => this.jarGlow(team, j.value, j.golds, dt));
  }

  /** The jar's lights, glow and count follow what's in it (fireflies still on their way count once they land). */
  private jarGlow(team: number, value: number, golds: number, dt: number): void {
    const jar = this.jars[team];
    if (!jar) return;
    const flying = this.flights.filter((f) => f.team === team);
    const landedGold = Math.max(0, golds - flying.filter((f) => f.rig.gold).length);
    const shown = Math.max(0, value - flying.reduce((n, f) => n + (f.rig.gold ? FIREFLY.goldValue : 1), 0));
    const lights = Math.min(JAR_BITS, shown - landedGold * (FIREFLY.goldValue - 1));
    jar.bits.forEach((b, i) => {
      b.m.visible = i < lights;
      if (!b.m.visible) return;
      const gold = i < landedGold;
      b.m.scale.setScalar(gold ? 1.5 : 1);
      if (gold) b.m.material = this.goldBit;
      b.m.position.set(b.base.x + Math.sin(this.time * 1.7 + b.phase) * 0.04, b.base.y + Math.sin(this.time * 2.3 + b.phase) * 0.05, b.base.z + Math.cos(this.time * 1.5 + b.phase) * 0.04);
    });
    if (shown !== jar.shown) {
      if (shown > jar.shown && jar.shown >= 0) jar.pulse = Math.max(jar.pulse, 1);
      jar.shown = shown;
      if (jar.label) {
        jar.label.removeFromParent();
        jar.label.material.map?.dispose();
        jar.label.material.dispose();
      }
      jar.label = popSprite(String(shown), jar.color, 0.55);
      jar.label.position.set(jar.x, 2.35, JAR_Z);
      this.scene.add(jar.label);
    }
    const goal = Math.min(1, shown / FULL);
    jar.level += (goal - jar.level) * Math.min(1, dt * 3);
    jar.pulse = Math.max(0, jar.pulse - dt * 2.2);
    const l = jar.level + jar.pulse * 0.25;
    jar.light.intensity = 0.4 + l * 9;
    jar.glass.emissiveIntensity = 0.05 + l * 0.7;
    jar.halo.material.opacity = Math.min(0.85, 0.08 + l * 0.7);
    jar.halo.scale.setScalar(1.3 + l * 2.6 + Math.sin(this.time * 2) * 0.05);
    if (jar.label) jar.label.scale.set((1024 / 112) * 0.55 * (1 + jar.pulse * 0.12), 0.55 * (1 + jar.pulse * 0.12), 1);
  }

  dispose(): void {
    for (const r of this.rigs) r.c.dispose();
    this.words.dispose();
    for (const rig of this.flies.values()) this.dropFly(rig);
    for (const f of this.flights) this.dropFly(f.rig);
    for (const d of this.drifts) this.dropFly(d.rig);
    this.flies.clear();
    this.flights = [];
    this.drifts = [];
    for (const sp of this.sparks) sp.s.material.dispose();
    for (const j of this.jars) {
      j.label?.material.map?.dispose();
      j.label?.material.dispose();
    }
    this.goldBit.dispose();
    for (const o of this.owned) o.dispose();
    this.grass?.dispose();
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'fireflycatch',
  title: 'Firefly Jar',
  how: 'Walk about the meadow and press Catch to swing your net at fireflies: every one goes into your team’s jar. Golden ones count three, but they’re shy, so push the stick gently to tiptoe up. The brighter jar after 35 seconds wins.',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const meadow = newMeadow(teams, seats.length, rng);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const posOf = new Map(seats.map((s, p) => [s.index, p] as const));
    const cpu = (p: number) => session.isCpu(seatOf(p));
    // Have the set's textures in before it first shows (but never wait long for them).
    const warm = Promise.race([preloadTextures('grass', 'bark', 'wood', 'gingham', 'planks'), new Promise<void>((done) => setTimeout(done, 2000))]);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT })));
    await warm;
    const view = new MeadowView(seats, teams, companions, meadow, sfx);
    ctx.stage.setView(view);

    const brains = new Map<number, Brain>();
    for (const p of seats.keys()) if (cpu(p)) brains.set(p, newBrain(ctx.skill(), rng));
    const sticks: Stick[] = seats.map(() => ({ ...IDLE }));
    // A quick tap can go down and up between two frames: remember it until the physics has used it.
    const latch = seats.map(() => false);

    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const teamOf = (p: number) => meadow.catchers[p]?.team ?? -1;
    const teamName = (members: readonly number[]) => members.map(nameOf).join(' & ');
    const partnerOf = (p: number) => (teams[teamOf(p)] ?? []).find((q) => q !== p);
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });

    seats.forEach((s, p) => {
      const where = teamOf(p) === 0 ? 'on the left' : 'on the right';
      const partner = partnerOf(p);
      session.setLayout(s.index, {
        kind: 'stick',
        button: 'Catch',
        note:
          partner === undefined
            ? `Net fireflies for your jar ${where}! Push the stick gently to tiptoe up to golden ones.`
            : `Team up with ${nameOf(partner)}: net fireflies for your jar ${where}! Tiptoe (gently) up to golden ones.`,
      });
    });

    const off = session.onInput((seat, msg) => {
      const p = posOf.get(seat);
      if (p === undefined || cpu(p) || msg.t !== 'stick') return;
      if (msg.a && !sticks[p]?.a) latch[p] = true;
      sticks[p] = { x: msg.x, y: msg.y, a: msg.a };
    });

    const hud = () =>
      ui.live(
        teams.map((members, team) => {
          const lead = seats[members[0] ?? 0];
          const v = meadow.jars[team]?.value ?? 0;
          return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${v} firefl${v === 1 ? 'y' : 'ies'}` };
        }),
      );

    const intro = 'Catch fireflies for your jar! Tiptoe up to the golden ones.';
    ui.caption(intro);
    let captionUntil = Infinity;
    let hudKey = '';
    let hudAt = -1;
    let cricketAt = 1.5;
    const spookedAt = seats.map(() => -9);
    await everyFrame(clock, (dt, t) => {
      const lags = seats.map((s) => Math.max(0, session.seats[s.index]?.rtt ?? 0) / 2000);
      const input = seats.map((_, p): Stick => {
        const brain = brains.get(p);
        const s = brain ? cpuStick(meadow, p, brain, rng) : (sticks[p] ?? IDLE);
        if (brain && s.a) latch[p] = true;
        return { x: s.x, y: s.y, a: latch[p] ?? false };
      });
      const ev = advance(meadow, input, dt, lags);
      if (ev.steps > 0) latch.fill(false);

      if (ev.swings.length) swish(sfx);
      // Words pop up where the fireflies were, so look them up before the view lets go of them.
      const perSeat = new Map<number, number>();
      for (const c of ev.catches) perSeat.set(c.seat, (perSeat.get(c.seat) ?? 0) + 1);
      for (const c of ev.catches) {
        const at = view.flyAt(c.id) ?? new THREE.Vector3(c.x, 1, c.z);
        view.caught(c.id, c.team);
        view.words.add(c.gold ? `+${FIREFLY.goldValue}` : '+1', c.gold ? GOLD_GLOW : (seats[c.seat]?.color ?? '#ffffff'), at.add(new THREE.Vector3(0, 0.35, 0)), c.gold ? 0.5 : 0.38);
        plink(sfx, c.gold);
        view.react(c.seat, 'happy', c.gold ? 1.6 : 0.8);
        buzz(c.seat, c.gold ? [20, 30, 20] : [18]);
      }
      for (const [p, n] of perSeat) {
        const gold = ev.catches.some((c) => c.seat === p && c.gold);
        tell(p, true, gold ? 'Golden! That’s three.' : n > 1 ? 'Two at once!' : 'Got one!');
      }
      for (const s of ev.spooked) {
        fwip(sfx);
        const at = view.flyAt(s.id);
        if (at) view.words.add('Tiptoe!', '#fff1d6', at.add(new THREE.Vector3(0, 0.4, 0)), 0.36);
        if (t - (spookedAt[s.seat] ?? -9) > 1.5) {
          spookedAt[s.seat] = t;
          tell(s.seat, false, 'Too quick! Push gently to tiptoe up to golden ones.');
          buzz(s.seat, [50]);
        }
      }
      for (const id of ev.goldOff) view.floatOff(id);
      if (ev.goldIn) {
        shimmer(sfx);
        ui.caption('Golden fireflies! They count three. Tiptoe up to them…', GOLD_GLOW);
        captionUntil = t + 3.5;
        seats.forEach((_, p) => tell(p, true, 'Golden fireflies! Tiptoe up to them.'));
      }
      if (t >= captionUntil) {
        captionUntil = Infinity;
        ui.caption(intro);
      }
      if (meadow.time >= cricketAt) {
        cricket(sfx, 0.9 + rng() * 0.25);
        cricketAt = meadow.time + 1.2 + rng() * 2.2;
      }
      view.sync(dt);

      if (t - hudAt >= 0.1) {
        hudAt = t;
        ui.timer(FIREFLY.duration - meadow.time);
        const key = meadow.jars.map((j) => j.value).join('|');
        if (key !== hudKey) {
          hudKey = key;
          hud();
        }
      }
      return isOver(meadow);
    });
    off();
    ui.timer(null);
    view.rest();
    hud();

    // Time! The brighter jar wins.
    const top = brightest(meadow);
    sfx.good();
    if (top === null) ui.caption('Time! Both jars glow just as bright.');
    else ui.caption(`Time! ${teamName(teams[top] ?? [])}’s jar glows brighter.`, seats[teams[top]?.[0] ?? 0]?.color);
    teams.forEach((members, team) => {
      const won = top === team;
      for (const p of members) {
        view.setMood(p, top === null ? 'approval' : won ? 'happy' : 'sad');
        if (won) view.react(p, 'happy', 3);
        tell(p, won || top === null, top === null ? 'Time! Both jars glow just as bright.' : won ? 'Time! Your jar is the brightest!' : 'Time! Their jar glows brighter.');
        buzz(p, won ? [30, 40, 30, 40, 120] : [80]);
      }
      if (won) view.cheer(team);
    });
    await clock.wait(2);
    ui.caption(null);

    return {
      scores: jarScores(meadow),
      details: seats.map((_, p) => {
        const c = meadow.catchers[p];
        const v = meadow.jars[c?.team ?? -1]?.value ?? 0;
        if (!c) return '';
        return `Jar of ${v} · caught ${c.caught}${c.golds ? ` (${c.golds} golden)` : ''}`;
      }),
    };
  },
};
