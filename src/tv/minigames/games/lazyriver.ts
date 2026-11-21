// Lazy River on the TV: golden hour on a winding river through soft hills. Everyone lounges in a donut floatie
// in their colour, drifting past reeds, lily pads, floating snack bags and a sleepy duck family, towards an old
// stone bridge strung with lights. The camera follows the group from behind and above.
import * as THREE from 'three';
import {
  type Course,
  type CpuPaddler,
  type Floatie,
  RIVER,
  type Race,
  type RiverEvent,
  allArrived,
  centreSlope,
  centreX,
  cpuTilt,
  currentAt,
  duckAt,
  makeCourse,
  newCpuPaddler,
  newRace,
  riverDetail,
  riverScores,
  stepRace,
} from '../../../game/minigames/lazyriver';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, cone, cyl, material, mix, nameCard, part, pill, rbox, seeded, sphere, toonMat, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { Floaters, type Mark, frameMarks, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const TILT = 0.8; // how steeply the camera looks down
const HEIGHT = 1.0; // companion height
/** The low sun stands ahead and to the right: long shadows across the water, a warm rim on everyone. */
const SUN_FROM: [number, number, number] = [0.78, 0.44, -0.3];
const BAG_COLORS = [P.terracotta, P.mustard, P.teal, P.mauve, P.sage];
const smooth = (k: number) => {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ river geometry

/** World position of a point in river coordinates (s downstream, d across). */
function riverPoint(course: Course, s: number, d: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const k = centreSlope(course, s);
  const n = 1 / Math.sqrt(1 + k * k);
  return out.set(centreX(course, s) + d * n, y, -s + d * k * n);
}

/** The heading (rotation.y) of something facing downstream at s. */
function riverYaw(course: Course, s: number): number {
  return Math.atan2(centreSlope(course, s), -1);
}

/** River coordinates of a world point (a few rounds of refinement; exact enough near the river). */
function toRiver(course: Course, x: number, z: number): { s: number; d: number } {
  let s = -z;
  let d = 0;
  for (let i = 0; i < 4; i++) {
    const k = centreSlope(course, s);
    const root = Math.sqrt(1 + k * k);
    d = (x - centreX(course, s)) * root;
    s = -z + (d * k) / root;
  }
  return { s, d };
}

/** The ground's height `ad` across from the river's middle: riverbed, muddy edge, grassy bank, soft hills. */
function groundY(ad: number, x: number, z: number): number {
  const H = RIVER.half;
  if (ad < H - 0.4) return -0.45;
  if (ad < H + 0.35) return -0.45 + 0.5 * smooth((ad - (H - 0.4)) / 0.75);
  if (ad < H + 1.7) return 0.05 + 0.45 * smooth((ad - H - 0.35) / 1.35);
  const lumps = Math.sin(x * 0.21 + z * 0.13) * Math.sin(z * 0.17 - x * 0.05) * smooth((ad - 9) / 6) * 0.9;
  return 0.5 + Math.max(0, ad - 15) * 0.16 + lumps;
}

/** The land: a riverbed under the water, muddy edges, grassy banks and soft hills further out. */
function landGeometry(course: Course, zNear: number, zFar: number): THREE.BufferGeometry {
  const width = 100;
  const step = 0.5;
  const cols = Math.round(width / step) + 1;
  const rows = Math.round((zNear - zFar) / step) + 1;
  const pos = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const mud = new THREE.Color(mix(P.soil, P.sand, 0.45));
  const grass = new THREE.Color(mix(P.grass, P.moss, 0.4));
  const field = new THREE.Color(mix(P.olive, P.mustard, 0.4));
  const c = new THREE.Color();
  for (let r = 0; r < rows; r++) {
    const z = zNear - r * step;
    for (let q = 0; q < cols; q++) {
      const x = -width / 2 + q * step + centreX(course, -z) * 0.6;
      const ad = Math.abs(toRiver(course, x, z).d);
      const y = groundY(ad, x, z);
      const i = (r * cols + q) * 3;
      pos[i] = x;
      pos[i + 1] = y;
      pos[i + 2] = z;
      c.copy(mud).lerp(grass, smooth((y - 0.08) / 0.3)).lerp(field, smooth((ad - 14) / 12) * 0.7);
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let q = 0; q < cols - 1; q++) {
      const a = r * cols + q;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // Wound to face up (rows run away from the camera).
      index.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ props

function snackBag(color: string): THREE.Group {
  const g = new THREE.Group();
  // A little life ring keeps it afloat.
  part(g, torus(0.3, 0.075), P.cream, 0, 0.02, 0, { rx: Math.PI / 2, gloss: 0.3 });
  for (let k = 0; k < 4; k++) part(g, torus(0.3, 0.078, Math.PI / 4), P.brick, 0, 0.02, 0, { rx: Math.PI / 2, rz: (k * Math.PI) / 2, outline: false });
  const bag = new THREE.Group();
  bag.position.y = 0.3;
  bag.rotation.z = 0.12;
  part(bag, rbox(0.42, 0.5, 0.17, 0.07), color, 0, 0, 0, { gloss: 0.35 });
  part(bag, rbox(0.45, 0.06, 0.19, 0.02), mix(color, P.ink, 0.3), 0, 0.27, 0, { outline: false });
  part(bag, rbox(0.45, 0.05, 0.19, 0.02), mix(color, P.ink, 0.3), 0, -0.26, 0, { outline: false });
  part(bag, cyl(0.12, 0.12, 0.02, 18), P.cream, 0, 0.02, 0.09, { rx: Math.PI / 2, outline: false });
  part(bag, sphere(0.05, 8), P.mustard, 0, 0.02, 0.11, { outline: false });
  // A soft glint so the pick-ups catch the eye.
  part(bag, sphere(0.035, 6), P.lamp, 0.14, 0.36, 0, { glow: 2, outline: false, shadow: false });
  g.add(bag);
  return g;
}

function duckMesh(mother: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = mother ? P.cream : mix(P.mustard, P.cream, 0.35);
  const s = mother ? 1 : 0.62;
  part(g, sphere(0.3 * s, 16), body, 0, 0.12 * s, 0, { sx: 1, sy: 0.72, sz: 1.3 });
  part(g, cone(0.12 * s, 0.22 * s, 8), body, 0, 0.24 * s, -0.36 * s, { rx: -0.9 });
  part(g, sphere(0.17 * s, 14), body, 0, 0.36 * s, 0.24 * s);
  part(g, rbox(0.12 * s, 0.05 * s, 0.16 * s, 0.02), P.copper, 0, 0.33 * s, 0.42 * s, { outline: false });
  // Sleepy closed eyes.
  for (const x of [-0.1, 0.1]) part(g, rbox(0.012, 0.012, 0.07 * s, 0.004), P.ink, x * s * 1.4, 0.4 * s, 0.3 * s, { rx: 0.2, outline: false, shadow: false });
  if (mother) for (const x of [-0.2, 0.2]) part(g, sphere(0.07, 8), mix(P.cream, P.clay, 0.5), x, 0.2, -0.05, { sy: 0.5, sz: 1.8, outline: false });
  return g;
}

function lilyPad(r: number, flower: boolean, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const leaf = rand() < 0.5 ? P.fern : P.moss;
  part(g, cyl(r, r, 0.05, 26), leaf, 0, 0.03, 0, { gloss: 0.25 });
  part(g, cyl(r * 0.72, r * 0.72, 0.052, 22), mix(leaf, P.olive, 0.3), 0, 0.031, 0, { outline: false, shadow: false });
  for (let k = 0; k < 5; k++) part(g, rbox(r * 0.9, 0.012, 0.022, 0.005), mix(leaf, P.ink, 0.22), 0, 0.06, 0, { ry: k * 1.1 + 0.4, outline: false, shadow: false });
  part(g, rbox(r * 0.95, 0.07, 0.07, 0.01), mix(P.pine, P.ink, 0.3), r * 0.5, 0.03, 0, { outline: false, shadow: false });
  if (flower) {
    const f = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      part(f, sphere(0.1, 8), k % 2 ? P.rose : mix(P.rose, P.cream, 0.45), Math.cos(a) * 0.1, 0.1, Math.sin(a) * 0.1, { sx: 1.5, sy: 0.6, ry: -a, outline: false });
    }
    part(f, sphere(0.06, 8), P.mustard, 0, 0.15, 0, { outline: false });
    f.position.set((rand() - 0.5) * r * 0.6, 0, (rand() - 0.5) * r * 0.6);
    g.add(f);
  }
  return g;
}

// ------------------------------------------------------------------ sounds

function plip(sfx: Sfx): void {
  noise(sfx, { dur: 0.06, filter: 'bandpass', freq: 2600, gain: 0.25 });
  tone(sfx, { freq: 660, to: 990, dur: 0.14, gain: 0.12 });
}

function boop(sfx: Sfx, what: Extract<RiverEvent, { t: 'bonk' }>['what']): void {
  switch (what) {
    case 'duck':
      tone(sfx, { freq: 540, to: 380, dur: 0.1, type: 'sawtooth', gain: 0.045 });
      tone(sfx, { freq: 520, to: 360, dur: 0.12, type: 'sawtooth', gain: 0.045, delay: 0.13 });
      break;
    case 'floatie':
      tone(sfx, { freq: 300, to: 430, dur: 0.12, gain: 0.13 });
      break;
    case 'pad':
      tone(sfx, { freq: 200, to: 120, dur: 0.18, gain: 0.14 });
      noise(sfx, { dur: 0.12, freq: 500, gain: 0.15 });
      break;
    case 'bank':
      noise(sfx, { dur: 0.16, freq: 320, gain: 0.25 });
      break;
  }
}

// ------------------------------------------------------------------ the view

interface Rider {
  group: THREE.Group;
  ring: THREE.Group;
  companion: Companion;
  card: THREE.Sprite;
  bob: number;
  /** Each floatie starts turned a little differently. */
  turn: number;
}

interface Ripple {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
}

interface Streak {
  mesh: THREE.Mesh;
  s: number;
  d: number;
}

class RiverView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 400);
  readonly riders: Rider[] = [];
  readonly floaters: Floaters;
  private readonly sun: THREE.DirectionalLight;
  private readonly tick: (dt: number, time: number) => void;
  private readonly probe = new THREE.PerspectiveCamera();
  private readonly bags: THREE.Group[] = [];
  private readonly ducks: THREE.Group[][] = [];
  private readonly streaks: Streak[] = [];
  private readonly motes: THREE.Mesh[] = [];
  private ripples: Ripple[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly look = new THREE.Vector3();
  private goal = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private placed = false;
  private fitAt = -1;
  private time = 0;
  private zzzAt = 2;

  constructor(
    seats: MinigameSeat[],
    companions: Companion[],
    private readonly race: Race,
  ) {
    const course = race.course;
    this.floaters = new Floaters(this.scene);
    this.sun = lightRig(this.scene, 'goldenHour', { fog: { near: 55, far: 165 }, shadowSize: 30, sunFrom: SUN_FROM }).sun;
    const rand = seeded(41);
    const zNear = 26;
    const zFar = -(RIVER.length + RIVER.pool + 70);

    // Land and water.
    const land = landGeometry(course, zNear, zFar);
    const landMat = toonMat({ vertexColors: true }, { tex: 'grass', texScale: 5, texStrength: 0.7 });
    this.owned.push(land, landMat);
    const ground = new THREE.Mesh(land, landMat);
    ground.receiveShadow = true;
    this.scene.add(ground);
    const water = props.water({ w: 70, d: zNear - zFar, shallow: '#5a9f93', deep: '#2b666c', sky: '#f4c99a', foam: '#9cc9b6', waves: 0.03, scale: 1.5, segments: 48 });
    water.position.set(0, 0, (zNear + zFar) / 2);
    this.scene.add(water);
    this.tick = props.tickProps(water);

    this.buildBanks(course, rand, zNear, zFar);
    this.buildBridge(course);

    for (const p of course.pads) {
      const pad = lilyPad(p.r, p.flower, rand);
      riverPoint(course, p.s, p.d, 0, pad.position);
      pad.rotation.y = rand() * Math.PI * 2;
      this.scene.add(pad);
    }
    course.buoys.forEach((b, k) => {
      const bag = snackBag(BAG_COLORS[k % BAG_COLORS.length] as string);
      riverPoint(course, b.s, b.d, 0, bag.position);
      this.bags.push(bag);
      this.scene.add(bag);
    });
    for (const fam of course.ducks) {
      const line: THREE.Group[] = [];
      for (let k = 0; k < fam.count; k++) {
        const duck = duckMesh(k === 0);
        line.push(duck);
        this.scene.add(duck);
      }
      this.ducks.push(line);
    }

    // Lazy streaks on the water: they drift with the current, so the fast middle shows.
    const streakMat = material(P.cream, { basic: true, opacity: 0.3 });
    for (let k = 0; k < 80; k++) {
      const mesh = part(this.scene, rbox(0.07, 0.01, 0.6, 0.004), '#ffffff', 0, 0.02, 0, { material: streakMat, outline: false, shadow: false });
      this.streaks.push({ mesh, s: -10 + rand() * 45, d: (rand() * 2 - 1) * (RIVER.half - 0.4) });
    }
    // Golden dust drifting over the water.
    for (let k = 0; k < 26; k++) this.motes.push(part(this.scene, ball(0.04, 0), P.lamp, 0, 0, 0, { glow: 2, shadow: false }));

    seats.forEach((s, i) => {
      const group = new THREE.Group();
      const ring = new THREE.Group();
      // The floatie: glossy, in the seat's colour, with cream stripes and a little valve.
      withOutline(0.035, () => part(ring, new THREE.TorusGeometry(0.55, 0.22, 16, 40), s.color, 0, 0.06, 0, { rx: Math.PI / 2, gloss: 0.45, exact: true }));
      for (let k = 0; k < 4; k++) part(ring, new THREE.TorusGeometry(0.55, 0.226, 14, 12, Math.PI / 5), P.cream, 0, 0.06, 0, { rx: Math.PI / 2, rz: (k * Math.PI) / 2, outline: false, gloss: 0.45 });
      part(ring, cyl(0.035, 0.045, 0.07, 8), P.cream, 0.74, 0.14, 0, { rz: -0.9, outline: false });
      const c = companions[i] as Companion;
      c.root.position.set(0, -0.3, 0);
      c.setBase('happy');
      ring.add(c.root);
      group.add(ring);
      const card = nameCard(s.name, s.color, 0.85);
      card.position.set(0, 1.45, 0);
      group.add(card);
      this.owned.push(card.material.map as THREE.Texture, card.material);
      this.scene.add(group);
      this.riders.push({ group, ring, companion: c, card, bob: i * 1.7, turn: (i - (seats.length - 1) / 2) * 0.5 });
    });
    this.place(0);
  }

  private buildBanks(course: Course, rand: () => number, zNear: number, zFar: number): void {
    // Reeds and cattails along both banks (instanced: there are a lot of them).
    const stalks: THREE.Matrix4[] = [];
    const heads: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    for (let s = -zNear; s < -zFar; s += 2.2 + rand() * 1.8) {
      for (const side of [-1, 1]) {
        if (rand() < 0.25) continue;
        const n = 2 + Math.floor(rand() * 3);
        const d0 = side * (RIVER.half + 0.15 + rand() * 0.9);
        for (let k = 0; k < n; k++) {
          const h = 0.8 + rand() * 0.7;
          riverPoint(course, s + (rand() - 0.5) * 0.9, d0 + side * rand() * 0.4, 0, p);
          e.set((rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.3);
          q.setFromEuler(e);
          stalks.push(new THREE.Matrix4().compose(p.clone().setY(h / 2 - 0.1), q, new THREE.Vector3(1, h, 1)));
          if (rand() < 0.6) heads.push(new THREE.Matrix4().compose(p.clone().setY(h - 0.05), q, new THREE.Vector3(1, 1, 1)));
        }
      }
    }
    const stalkMesh = new THREE.InstancedMesh(cyl(0.025, 0.035, 1, 5), material(P.moss), stalks.length);
    stalks.forEach((m, i) => stalkMesh.setMatrixAt(i, m));
    const headMesh = new THREE.InstancedMesh(pill(0.07, 0.22), material(P.walnut), heads.length);
    heads.forEach((m, i) => headMesh.setMatrixAt(i, m));
    stalkMesh.castShadow = headMesh.castShadow = true;
    this.scene.add(stalkMesh, headMesh);
    this.owned.push(stalkMesh, headMesh);

    // Trees in late-summer colours, further back from the water: mostly greens, the odd one turning.
    const leaves = [P.fern, P.moss, P.leaf, P.olive, P.pine, mix(P.mustard, P.terracotta, 0.35), P.leafDark];
    for (let s = -zNear + 4; s < -zFar - 20; s += 5 + rand() * 6) {
      for (const side of [-1, 1]) {
        if (rand() < 0.3) continue;
        const tree = new THREE.Group();
        const pine = rand() < 0.22;
        const h = 1.4 + rand() * 1.2;
        const leaf = pine ? P.pine : (leaves[Math.floor(rand() * leaves.length)] as string);
        part(tree, cyl(0.14, 0.24, h, 8), P.soilDark, 0, h / 2, 0, { tex: 'bark', outline: false });
        if (pine) {
          for (let k = 0; k < 3; k++) part(tree, cone(1.15 - k * 0.3, 1.5, 9), mix(leaf, P.fern, k * 0.14), 0, h + 0.4 + k * 0.85, 0, { ry: k, outline: k === 0 ? 0.05 : false });
        } else {
          const r = 1 + rand() * 0.7;
          part(tree, ball(r, 2), leaf, 0, h + r * 0.6, 0, { outline: 0.05 });
          part(tree, ball(r * 0.7, 2), mix(leaf, P.mustard, 0.14), r * 0.5, h + r * 0.25, 0.25, { outline: false });
          part(tree, ball(r * 0.62, 2), mix(leaf, P.pine, 0.3), -r * 0.52, h + r * 0.35, -0.2, { outline: false });
        }
        const d = side * (RIVER.half + 3 + rand() * 7);
        riverPoint(course, s, d, 0, tree.position);
        tree.position.y = groundY(Math.abs(d), tree.position.x, tree.position.z) - 0.05;
        tree.rotation.y = rand() * Math.PI * 2;
        this.scene.add(tree);
      }
    }

    // Boulders at the water's edge, a few bushes, and wild flowers and tufts scattered over the banks (instanced).
    for (let s = -zNear + 2; s < -zFar - 30; s += 7 + rand() * 9) {
      const side = rand() < 0.5 ? -1 : 1;
      const d = side * (RIVER.half + 0.7 + rand() * 0.8);
      const rock = props.rock({ r: 0.35 + rand() * 0.35, seed: Math.floor(rand() * 99), color: mix(P.stone, P.sand, 0.3) });
      riverPoint(course, s, d, 0, rock.position);
      rock.position.y = groundY(Math.abs(d), rock.position.x, rock.position.z) - 0.08;
      this.scene.add(rock);
      const bd = -side * (RIVER.half + 1.8 + rand() * 2.5);
      const bush = props.bush({ r: 0.55 + rand() * 0.3, seed: Math.floor(rand() * 99), ...(rand() < 0.5 ? { flowers: rand() < 0.5 ? P.rose : P.cream } : {}) });
      riverPoint(course, s + 3, bd, 0, bush.position);
      bush.position.y = groundY(Math.abs(bd), bush.position.x, bush.position.z) - 0.05;
      this.scene.add(bush);
    }
    const flowers: THREE.Matrix4[] = [];
    const tufts: THREE.Matrix4[] = [];
    const one = new THREE.Vector3(1, 1, 1);
    for (let s = -zNear; s < -zFar - 10; s += 0.55) {
      const side = rand() < 0.5 ? -1 : 1;
      const d = side * (RIVER.half + 1.2 + rand() * rand() * 9);
      riverPoint(course, s + rand(), d, 0, p);
      p.y = groundY(Math.abs(d), p.x, p.z);
      e.set((rand() - 0.5) * 0.3, rand() * 3, (rand() - 0.5) * 0.3);
      q.setFromEuler(e);
      if (rand() < 0.45) flowers.push(new THREE.Matrix4().compose(p.clone().setY(p.y + 0.12), q, one));
      else tufts.push(new THREE.Matrix4().compose(p.clone().setY(p.y + 0.14), q, new THREE.Vector3(1, 0.8 + rand() * 0.9, 1)));
    }
    const flowerMesh = new THREE.InstancedMesh(sphere(0.1, 6), material('#ffffff', { exact: true }), flowers.length);
    const petal = new THREE.Color();
    const petals = [P.cream, P.rose, P.mustard, P.mauve];
    flowers.forEach((m, i) => {
      flowerMesh.setMatrixAt(i, m);
      flowerMesh.setColorAt(i, petal.set(petals[i % petals.length] as string));
    });
    const tuftMesh = new THREE.InstancedMesh(cone(0.12, 0.34, 5), material(P.grassDark), tufts.length);
    tufts.forEach((m, i) => tuftMesh.setMatrixAt(i, m));
    this.scene.add(flowerMesh, tuftMesh);
    this.owned.push(flowerMesh, tuftMesh);
  }

  private buildBridge(course: Course): void {
    const bridge = new THREE.Group();
    riverPoint(course, RIVER.length, 0, 0, bridge.position);
    bridge.rotation.y = riverYaw(course, RIVER.length);
    const stone = mix(P.stone, P.sand, 0.45);
    const dark = mix(stone, P.walnut, 0.3);
    const rocky = { tex: 'rock' as const, texScale: 2.4, texStrength: 0.8 };
    const span = RIVER.half + 0.5;
    withOutline(0.05, () => {
      // An arch of stones over the water.
      const blocks = 13;
      for (let k = 0; k < blocks; k++) {
        const a = (k / (blocks - 1)) * Math.PI;
        const x = -Math.cos(a) * span;
        const y = Math.sin(a) * 3.1 + 0.2;
        part(bridge, rbox(1.05, 0.5, 1.7, 0.1), k % 2 ? stone : dark, x, y, 0, { rz: a - Math.PI / 2, ...rocky });
      }
      // Banks under each end, the deck, and low walls.
      for (const side of [-1, 1]) part(bridge, rbox(2.6, 4, 2.2, 0.12), stone, side * (span + 1.1), 1.6, 0, { tex: 'stoneTiles', texScale: 2.2 });
      part(bridge, rbox(2 * span + 4.6, 0.45, 2.2, 0.12), mix(stone, P.cream, 0.18), 0, 3.75, 0, { tex: 'stoneTiles', texScale: 2.2 });
      for (const z of [-0.95, 0.95]) part(bridge, rbox(2 * span + 4.6, 0.5, 0.25, 0.08), stone, 0, 4.2, z, rocky);
    });
    // Ivy creeping up the piers.
    const rand = seeded(7);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 9; k++) part(bridge, ball(0.22 + rand() * 0.2, 1), rand() < 0.5 ? P.fern : P.pine, side * (span + 0.3 + rand() * 1.8), 0.4 + rand() * 2.2, 1.12, { sz: 0.4, outline: false });
    }
    // Lanterns on the corners and a string of little lights under the arch.
    for (const side of [-1, 1]) {
      part(bridge, cyl(0.06, 0.08, 0.9, 8), P.charcoal, side * (span + 2), 4.85, -1.0, { outline: false });
      part(bridge, rbox(0.4, 0.06, 0.4, 0.02), P.charcoal, side * (span + 2), 5.7, -1.0, { outline: false });
      part(bridge, rbox(0.3, 0.38, 0.3, 0.06), P.lamp, side * (span + 2), 5.45, -1.0, { glow: 2, shadow: false });
    }
    const bulbs = [P.lamp, P.ember, P.lamp, P.cream];
    for (let k = 0; k <= 16; k++) {
      const a = 0.12 + (k / 16) * (Math.PI - 0.24);
      part(bridge, sphere(0.07, 8), bulbs[k % bulbs.length] as string, -Math.cos(a) * (span - 0.35), Math.sin(a) * 2.75, -0.9, { glow: 2.2, shadow: false });
    }
    const lamp = new THREE.PointLight('#ffcf8a', 6, 16, 1.6);
    lamp.position.set(0, 3, -2.5);
    bridge.add(lamp);
    const sign = nameCard('Finish', P.lamp, 1.2);
    sign.position.set(0, 5.5, 0);
    bridge.add(sign);
    this.owned.push(sign.material.map as THREE.Texture, sign.material);
    this.scene.add(bridge);
  }

  /** A ring of ripples on the water. */
  ripple(at: THREE.Vector3, color = '#ffffff'): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false });
    const mesh = new THREE.Mesh(torus(0.6, 0.04), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(at.x, 0.04, at.z);
    this.scene.add(mesh);
    this.ripples.push({ mesh, mat, age: 0 });
  }

  /** Where a floatie is in the world. */
  at(i: number, y = 0): THREE.Vector3 {
    const f = this.race.floaties[i] as Floatie;
    return riverPoint(this.race.course, f.s, f.d, y);
  }

  /** Moves everything that floats to where the race has it. */
  private place(dt: number): void {
    const { course, floaties, time } = this.race;
    floaties.forEach((f, i) => {
      const r = this.riders[i];
      if (!r) return;
      r.bob += dt * 2.2;
      riverPoint(course, f.s, f.d, Math.sin(r.bob) * 0.04, r.group.position);
      r.ring.rotation.y = f.angle + r.turn;
      r.ring.rotation.z = Math.sin(r.bob * 0.8) * 0.04 + f.vd * 0.03;
      r.ring.rotation.x = Math.cos(r.bob * 0.7) * 0.04;
    });
    course.buoys.forEach((b, k) => {
      const bag = this.bags[k];
      if (!bag) return;
      const up = b.downUntil <= time;
      bag.visible = up;
      if (!up) return;
      const grow = b.downUntil > 0 ? Math.min(1, (time - b.downUntil) / 0.4) : 1;
      bag.scale.setScalar(Math.max(0.01, grow));
      bag.position.y = Math.sin(this.time * 2 + k) * 0.05 - 0.02;
      bag.rotation.y = this.time * 0.4 + k;
    });
    course.ducks.forEach((fam, n) => {
      const line = this.ducks[n];
      if (!line) return;
      line.forEach((duck, k) => {
        const p = duckAt(fam, k, time);
        riverPoint(course, p.s, p.d, 0, duck.position);
        // Facing the way it paddles: the heading is measured from downstream, towards the right bank.
        duck.rotation.y = riverYaw(course, p.s) - p.heading;
        const dive = (fam.dive[k] ?? 0) - time;
        duck.position.y = dive > 0 ? -0.75 * Math.sin(Math.PI * (1 - dive / 1.6)) : Math.sin(this.time * 2.4 + k) * 0.025;
      });
    });
  }

  private frame(dt: number): void {
    const { course, floaties } = this.race;
    const marks: Mark[] = [];
    const racing = floaties.filter((f) => f.arrivedAt === null || this.race.time - f.arrivedAt < 1.5);
    const watch = racing.length ? racing : floaties;
    let lead = -Infinity;
    let sum = 0;
    for (const f of watch) {
      // Where it is and where it's about to be (the camera eases, so it looks a little ahead).
      const ahead = f.s + Math.max(0, f.vs) * 0.6;
      marks.push({ p: riverPoint(course, f.s, f.d, 0), pad: 0.05 }, { p: riverPoint(course, ahead, f.d, 1.6), pad: 0.06 });
      lead = Math.max(lead, f.s);
      sum += f.s;
    }
    // Always the whole width of the river, and a little of what's coming.
    const mid = sum / watch.length;
    for (const side of [-1, 1]) {
      marks.push({ p: riverPoint(course, mid, side * RIVER.half, 0) });
      marks.push({ p: riverPoint(course, Math.min(lead + 6, RIVER.length + 4), side * RIVER.half * 0.7, 0) });
    }
    if (this.time - this.fitAt > 0.1 || !this.placed) {
      this.fitAt = this.time;
      this.probe.fov = this.camera.fov;
      this.probe.aspect = this.camera.aspect;
      this.probe.updateProjectionMatrix();
      this.goal = frameMarks(this.probe, marks, TILT);
    }
    const k = this.placed ? 1 - Math.exp(-2.4 * dt) : 1;
    this.placed = true;
    this.camera.position.lerp(this.goal.pos, k);
    this.look.lerp(this.goal.look, k);
    this.camera.lookAt(this.look);
    // The haze keeps its distance when the camera pulls back for a spread-out group.
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      const away = this.camera.position.distanceTo(this.look);
      fog.near = away + 30;
      fog.far = away + 140;
    }
    // Keep the sun's shadows around the group.
    this.sun.target.position.copy(this.look);
    this.sun.position.set(this.look.x + SUN_FROM[0] * 60, SUN_FROM[1] * 60, this.look.z + SUN_FROM[2] * 60);
  }

  update(dt: number): void {
    this.time += dt;
    this.tick(dt, this.time);
    this.place(dt);
    for (const r of this.riders) r.companion.update(dt);
    this.floaters.update(dt);
    const { course, floaties } = this.race;
    // Streaks drift with the current around the group, and start again ahead when they fall behind.
    const focus = floaties.reduce((m, f) => m + f.s, 0) / Math.max(1, floaties.length);
    for (const st of this.streaks) {
      st.s += currentAt(st.d) * dt;
      if (st.s > focus + 32) st.s -= 46;
      if (st.s < focus - 14) st.s += 46;
      riverPoint(course, st.s, st.d, 0.02, st.mesh.position);
      st.mesh.rotation.y = riverYaw(course, st.s);
    }
    this.motes.forEach((m, k) => {
      const s = focus - 4 + ((k * 7.3 + this.time * 0.6) % 26);
      riverPoint(course, s, Math.sin(k * 2.1 + this.time * 0.2) * RIVER.half * 1.1, 0.8 + Math.sin(k + this.time * 0.9) * 0.5, m.position);
    });
    this.ripples = this.ripples.filter((r) => {
      r.age += dt;
      r.mesh.scale.setScalar(1 + r.age * 2.2);
      r.mat.opacity = Math.max(0, 0.7 * (1 - r.age / 0.8));
      if (r.age < 0.8) return true;
      this.scene.remove(r.mesh);
      r.mat.dispose();
      return false;
    });
    // Now and then the mother duck snores.
    if (this.time > this.zzzAt) {
      this.zzzAt = this.time + 2.6;
      course.ducks.forEach((fam, n) => {
        const mum = this.ducks[n]?.[0];
        if (mum && (fam.dive[0] ?? 0) < this.race.time) this.floaters.add('z', '#ffffff', mum.position.clone().setY(0.9), 0.32, 1.6);
      });
    }
    this.frame(dt);
  }

  dispose(): void {
    for (const r of this.riders) r.companion.dispose();
    this.floaters.dispose();
    for (const r of this.ripples) r.mat.dispose();
    for (const o of this.owned) o.dispose();
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'lazyriver',
  title: 'Lazy River',
  how: 'Drift down the river on your floatie and tilt to paddle. The middle flows fastest, bumps slow you down and snack bags give a little boost. First under the bridge wins!',
  controller: 'tilt',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const race = newRace(makeCourse(rng), n);
    const skill = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : 0.5));
    const cpus: CpuPaddler[] = race.floaties.map((f) => newCpuPaddler(f.d));
    const tilt = seats.map(() => 0);
    const view = new RiverView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), race);
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'tilt', title: 'Lazy River', note: 'Tilt to paddle left and right. The middle flows fastest.', icon: '🍩' }));
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'tilt' && seat < n && !session.isCpu(seat)) tilt[seat] = msg.x;
    });

    const lastBonkSound: Record<string, number> = {};
    const lastToast = seats.map(() => -9);
    let hudAt = -1;
    let arrived = 0;
    ui.caption('Tilt to paddle. The middle of the river flows fastest!');
    await everyFrame(clock, (dt, t) => {
      const input = seats.map((_, i) => (session.isCpu(i) ? cpuTilt(cpus[i] as CpuPaddler, race, i, skill[i] ?? 0.5, rng, dt) : (tilt[i] ?? 0)));
      for (const e of stepRace(race, input, Math.min(dt, 0.6))) {
        const seat = seats[e.seat] as MinigameSeat;
        const rider = view.riders[e.seat];
        if (e.t === 'bonk') {
          if ((lastBonkSound[e.what] ?? -9) < t - 0.12) {
            lastBonkSound[e.what] = t;
            boop(sfx, e.what);
          }
          view.ripple(view.at(e.seat));
          const word = e.what === 'duck' ? 'Quack!' : e.what === 'floatie' ? 'Boop!' : 'Bonk!';
          view.floaters.add(word, '#ffffff', view.at(e.seat, 1.9), 0.55, 0.9);
          if (e.what !== 'floatie') rider?.companion.react('sad', 0.9);
          if (!session.isCpu(e.seat) && t - (lastToast[e.seat] ?? -9) > 1.2) {
            lastToast[e.seat] = t;
            session.send(e.seat, { t: 'feedback', good: false, text: e.what === 'duck' ? 'Sorry, duck!' : 'Bonk! Steer clear.' });
            session.send(e.seat, { t: 'buzz', pattern: [40] });
          }
        } else if (e.t === 'snack') {
          plip(sfx);
          view.floaters.add('Snack!', seat.color, view.at(e.seat, 1.9), 0.6, 1);
          rider?.companion.react('happy', 1.2);
          if (!session.isCpu(e.seat)) {
            session.send(e.seat, { t: 'feedback', good: true, text: 'Snack boost!' });
            session.send(e.seat, { t: 'buzz', pattern: [15, 30, 15] });
          }
        } else {
          arrived++;
          sfx.good();
          view.floaters.add(arrived === 1 ? 'First!' : 'Made it!', seat.color, view.at(e.seat, 2.2), 0.8, 1.6);
          rider?.companion.setBase('happy');
          rider?.companion.react('happy', 3);
          if (arrived === 1) ui.caption(`${seat.name} drifted under the bridge first!`, seat.color);
          if (!session.isCpu(e.seat)) {
            session.send(e.seat, { t: 'feedback', good: true, text: 'Under the bridge!' });
            session.send(e.seat, { t: 'buzz', pattern: [60, 40, 120] });
          }
        }
      }
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(RIVER.duration - t);
        ui.live(
          seats.map((s, i) => {
            const f = race.floaties[i] as Floatie;
            return { name: s.name, color: s.color, thumb: s.thumb, value: f.arrivedAt !== null ? `${f.arrivedAt.toFixed(1)} s` : `${Math.round(Math.min(f.s, RIVER.length))} m` };
          }),
        );
      }
      return t >= RIVER.duration || (allArrived(race) && race.floaties.every((f) => race.time - (f.arrivedAt ?? 0) > 1.2));
    });
    off();
    ui.timer(null);
    race.floaties.forEach((f, i) => {
      if (f.arrivedAt === null) view.riders[i]?.companion.react('sleeping', 3);
    });
    ui.caption(arrived ? 'Everyone drifts on into the evening…' : 'Nobody reached the bridge. Still, lovely evening.');
    await clock.wait(1.4);
    ui.caption(null);
    return { scores: riverScores(race.floaties), details: race.floaties.map(riverDetail) };
  },
};
