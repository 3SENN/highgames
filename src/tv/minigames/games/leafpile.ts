// Leaf Pile on the TV: a back garden on an autumn evening. The maple over the fence has dropped everything, the
// porch lantern is on and somebody left a mug of cocoa on the fence. Two teams sweep the leaves into their own
// pile (roped off against the side fences) by walking into them, and dive into the other pile to send it flying.
// Seen from the kitchen window, a little above.
import * as THREE from 'three';
import { DIVE, IDLE, LEAF, type Brain, type Stick, type Yard, advance, cpuStick, leafScores, newBrain, newYard, pileCount, zoneSide } from '../../../game/minigames/leafpile';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { preloadTextures } from '../../render/textures';
import { PALETTE as P, ball, cyl, material, mix, nameCard, part, popSprite, rbox, seeded, sphere, toonMat, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.2;
const TILT = 0.84; // how far the camera looks down (radians)
const GRASS = mix(P.olive, P.grassDark, 0.55); // an autumn lawn: tired, a little yellow
const LAWN = mix(P.olive, P.grass, 0.45);
const LEAF_COLORS = [P.ember, P.terracotta, P.mustard, P.copper, mix(P.ember, P.mustard, 0.5), P.brick, mix(P.mustard, P.lamp, 0.4), P.mahogany] as const;
const FENCE_H = 1.7;
const BACK = -(LEAF.yard.z + 1.05); // the back fence, behind a flower bed
const SIDE = LEAF.yard.x + 0.55; // the side fences
const PILE_X = (LEAF.zone.x + LEAF.yard.x) / 2; // the middle of a pile's zone
const LABEL_Y = 2.2;
const MUG = { x: 1.4, y: FENCE_H + 0.2 }; // the cocoa on the fence post

// ------------------------------------------------------------------ sounds

const rustle = (sfx: Sfx, gain = 0.05) => noise(sfx, { dur: 0.12, filter: 'highpass', freq: 2600 + Math.random() * 1200, gain });
const swoosh = (sfx: Sfx) => noise(sfx, { dur: 0.2, filter: 'bandpass', freq: 800, to: 2200, gain: 0.12 });
function crunch(sfx: Sfx, big: boolean): void {
  noise(sfx, { dur: big ? 0.5 : 0.3, filter: 'bandpass', freq: 2600, to: 700, gain: big ? 0.32 : 0.18 });
  noise(sfx, { dur: 0.25, filter: 'highpass', freq: 3500, gain: big ? 0.12 : 0.06, delay: 0.05 });
  tone(sfx, { freq: 150, to: 70, dur: 0.2, gain: 0.1 });
}
const flump = (sfx: Sfx) => {
  noise(sfx, { dur: 0.3, filter: 'lowpass', freq: 500, to: 120, gain: 0.3 });
  noise(sfx, { dur: 0.2, filter: 'highpass', freq: 3000, gain: 0.05 });
};
const whistle = (sfx: Sfx) => {
  tone(sfx, { freq: 1180, dur: 0.18, gain: 0.08 });
  tone(sfx, { freq: 1180, to: 900, dur: 0.35, gain: 0.08, delay: 0.2 });
};

// ------------------------------------------------------------------ the garden

interface Rig {
  c: Companion;
  ring: THREE.Mesh;
  hot: THREE.Material;
  cold: THREE.Material;
  ready: boolean;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
  /** Forward lean: 0 standing, π/2 face down in the leaves. */
  tilt: number;
  /** How far to lift someone lying face down so they rest on the grass. */
  lift: number;
}

interface PileLabel {
  team: number;
  color: string;
  sprite: THREE.Sprite | null;
  n: number;
  pulse: number;
}

interface Drifter {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  t: number;
  speed: number;
  phase: number;
}

class Garden implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly words: Floaters;
  private readonly rigs: Rig[] = [];
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly labels: PileLabel[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private readonly drifters: Drifter[] = [];
  private readonly steam: THREE.Mesh[] = [];
  private env: Env | null = null;
  private lampBase: number[] = [];
  private time = 0;
  private final = false;

  // The leaves: one instanced mesh, coloured per leaf.
  private readonly leafMesh: THREE.InstancedMesh;
  private readonly leafMat: THREE.MeshToonMaterial;
  private readonly yaw: Float32Array;
  private readonly spin: Float32Array;
  private readonly size: Float32Array;
  private readonly rest: Float32Array;
  private readonly heapK: Float32Array;
  private readonly base: Float32Array;
  private readonly grid = new Map<number, number>();
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly s = new THREE.Vector3();

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    companions: Companion[],
    private readonly yard: Yard,
  ) {
    this.words = new Floaters(this.scene);
    this.buildGarden();

    teams.forEach((members, team) => {
      if (team > 1) return;
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      this.buildZone(team, color, members.map((p) => seats[p]?.name ?? '').join(' & '));
      this.labels.push({ team, color, sprite: null, n: -1, pulse: 0 });
    });

    seats.forEach((seat, p) => {
      const c = companions[p] as Companion;
      c.root.rotation.order = 'YXZ';
      const r = yard.rakers[p];
      c.root.position.set(r?.x ?? 0, 0, r?.z ?? 0);
      c.root.rotation.y = r?.face ?? 0;
      c.setBase('idle');
      this.scene.add(c.root);
      const hot = material(seat.color, { glow: 1.2 });
      const cold = material(mix(seat.color, P.aubergine, 0.6));
      const ring = part(this.scene, torus(0.46, 0.045), seat.color, c.root.position.x, 0.05, c.root.position.z, { rx: Math.PI / 2, outline: false, shadow: false, material: hot });
      const lift = Math.max(0.1, (c.kit.bounds.max[2] ?? 0.2) * c.scale) - 0.03;
      this.rigs.push({ c, ring, hot, cold, ready: true, motion: null, mood: null, tilt: 0, lift });
    });

    // The leaves.
    const n = yard.leaves.length;
    this.leafMat = toonMat({ color: '#ffffff' });
    this.leafMesh = new THREE.InstancedMesh(ball(0.15, 1), this.leafMat, n);
    this.leafMesh.castShadow = true;
    this.leafMesh.receiveShadow = true;
    this.leafMesh.frustumCulled = false;
    this.yaw = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.size = new Float32Array(n);
    this.rest = new Float32Array(n);
    this.heapK = new Float32Array(n);
    this.base = new Float32Array(n);
    const rand = seeded(41);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.yaw[i] = rand() * Math.PI * 2;
      this.spin[i] = (rand() - 0.5) * 9;
      this.size[i] = 0.85 + rand() * 0.45;
      this.rest[i] = (rand() - 0.5) * 0.35;
      this.heapK[i] = 0.15 + rand() * 0.85;
      this.base[i] = 0.025;
      const c = LEAF_COLORS[Math.floor(rand() * LEAF_COLORS.length)] as string;
      col.set(mix(c, P.lamp, rand() * 0.2));
      this.leafMesh.setColorAt(i, col);
    }
    if (this.leafMesh.instanceColor) this.leafMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.leafMesh);
    this.placeLeaves(0);

    // What the camera keeps in view: the lawn, heads at the back, the pile labels and the team cards.
    const { x, z } = LEAF.yard;
    for (const sx of [-1, 1]) {
      this.marks.push(
        { p: new THREE.Vector3(sx * (x + 0.3), 0, -(z + 0.2)) },
        { p: new THREE.Vector3(sx * (x + 0.3), 0, z + 0.3) },
        { p: new THREE.Vector3(sx * x, HEIGHT + 0.35, -z) },
        { p: new THREE.Vector3(sx * PILE_X, LABEL_Y, -1.2), pad: 0.06 },
        { p: new THREE.Vector3(sx * PILE_X, 0.05, z + 0.6), pad: 0.05 },
      );
    }
  }

  private buildGarden(): void {
    const s = this.scene;
    const { x: yx, z: yz } = LEAF.yard;
    // The garden itself: the fences are the yard's fences, the house runs down the left side.
    const env = backyard(s, { mood: 'evening', w: SIDE * 2, d: -BACK * 2, house: true, grass: GRASS, clear: { w: yx * 2 + 1.2, d: yz * 2 + 1.2 }, seed: 6 });
    this.env = env;
    // Nothing of the garden's own dressing may stand on the lawn people rake.
    for (const o of [...env.root.children]) {
      const inYard = Math.abs(o.position.x) < yx + 0.5 && o.position.z > -yz - 0.45 && o.position.z < yz + 2;
      if (o.name === 'motes' || (inYard && ['tree', 'bush', 'rock', 'gardenLamp'].includes(o.name))) o.removeFromParent();
    }
    this.lampBase = env.lamps.map((l) => l.intensity);
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, scale = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      s.add(o);
      return o;
    };

    // The lawn and a low brick edging all round it.
    part(s, rbox(yx * 2 + 0.3, 0.02, yz * 2 + 0.3, 0.02), LAWN, 0, 0.005, 0, { tex: 'grass', outline: false, shadow: false });
    const brick = { tex: 'brick' as const, texScale: 0.6, outline: false as const };
    part(s, rbox(yx * 2 + 0.6, 0.09, 0.14, 0.03), P.brick, 0, 0.045, -(yz + 0.12), brick);
    part(s, rbox(yx * 2 + 0.6, 0.09, 0.14, 0.03), P.brick, 0, 0.045, yz + 0.12, brick);
    for (const sx of [-1, 1]) part(s, rbox(0.14, 0.09, yz * 2 + 0.38, 0.03), P.brick, sx * (yx + 0.12), 0.045, 0, brick);
    // The flower bed along the back, gone to seed for the winter, and a strip of soil down each side.
    part(s, rbox(SIDE * 2 - 0.2, 0.08, -BACK - yz - 0.3, 0.03), P.soilDark, 0, 0.02, (BACK - yz - 0.2) / 2, { tex: 'rock', texStrength: 0.5, outline: false, shadow: false });
    for (const sx of [-1, 1]) part(s, rbox(SIDE - yx - 0.3, 0.06, yz * 2 + 0.4, 0.02), P.soilDark, sx * (SIDE + yx + 0.2) / 2, 0.02, 0, { tex: 'rock', texStrength: 0.5, outline: false, shadow: false });

    // Lanterns in the side beds, and warm lights strung along the back fence.
    put(props.gardenLamp({ h: 0.8, lit: true, light: 7 }), SIDE - 0.3, 0, -2.6);
    put(props.gardenLamp({ h: 0.8, lit: true }), SIDE - 0.3, 0, 2.6);
    put(props.gardenLamp({ h: 0.8, lit: true }), -SIDE + 0.35, 0, 3.2);
    for (let i = 0; i < 4; i++) {
      const x0 = -SIDE + 0.3 + (i * (SIDE * 2 - 0.6)) / 4;
      s.add(props.stringLights(new THREE.Vector3(x0, FENCE_H + 0.05, BACK + 0.12), new THREE.Vector3(x0 + (SIDE * 2 - 0.6) / 4, FENCE_H + 0.05, BACK + 0.12), { sag: 0.16, count: 8 }));
    }

    // The maple over the fence, which has dropped everything, and a golden one further along.
    put(props.tree({ kind: 'round', h: 6.2, color: mix(P.ember, P.terracotta, 0.5), seed: 4 }), -3.6, 0, BACK - 1.5);
    put(props.tree({ kind: 'round', h: 4.8, color: P.mustard, seed: 9 }), 4.6, 0, BACK - 2.6);
    put(props.tree({ kind: 'birch', h: 5.2, color: mix(P.mustard, P.olive, 0.4), seed: 5 }), 9.8, 0, -1.5);
    // A few leaves still drifting down from the maple.
    const rand = seeded(9);
    for (let i = 0; i < 9; i++) {
      const c = LEAF_COLORS[i % LEAF_COLORS.length] as string;
      const mesh = part(s, ball(0.13, 1), c, 0, 0, 0, { outline: false, sx: 1, sy: 0.25, sz: 0.62 });
      const from = new THREE.Vector3(-3.6 + (rand() - 0.5) * 3.4, 3.8 + rand(), BACK - 0.9 + rand() * 0.8);
      this.drifters.push({ mesh, from, t: rand(), speed: 0.12 + rand() * 0.08, phase: rand() * 6 });
    }

    // In the bed: pumpkins, a crate of apples, dry shrubs, and the rake leaning on the fence where nobody will use it.
    const pumpkin = (px: number, pz: number, r: number) => {
      const g = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        part(g, sphere(r * 0.62, 12), k % 2 ? P.ember : mix(P.ember, P.terracotta, 0.35), Math.cos(a) * r * 0.42, r * 0.62, Math.sin(a) * r * 0.42, { sy: 1.05, outline: false, gloss: 0.25 });
      }
      part(g, cyl(0.03, 0.05, r * 0.5, 6), P.moss, 0, r * 1.35, 0, { rz: 0.25, outline: false });
      put(g, px, 0.04, pz, rand() * 3);
    };
    pumpkin(-5.6, BACK + 0.6, 0.36);
    pumpkin(-4.95, BACK + 0.72, 0.24);
    pumpkin(3.4, BACK + 0.62, 0.3);
    pumpkin(-SIDE + 0.32, -1.2, 0.22);
    put(props.crate({ s: 0.5 }), 5.4, 0.04, BACK + 0.55, 0.2);
    for (let k = 0; k < 5; k++) part(s, sphere(0.08, 8), k % 2 ? P.brick : P.moss, 5.3 + (k % 3) * 0.12, 0.56 + (k % 2) * 0.03, BACK + 0.45 + (k % 2) * 0.16, { outline: false, gloss: 0.4 });
    put(props.bush({ r: 0.4, color: mix(P.olive, P.copper, 0.45), seed: 3 }), -0.2, 0, BACK + 0.6);
    put(props.bush({ r: 0.32, color: mix(P.olive, P.mustard, 0.4), seed: 8 }), 2.3, 0, BACK + 0.55);
    put(props.bush({ r: 0.36, color: mix(P.moss, P.copper, 0.3), seed: 5 }), SIDE - 0.32, 0, 0.3);
    const rake = new THREE.Group();
    rake.position.set(-1.6, 0, BACK + 0.3);
    rake.rotation.z = -0.3;
    part(rake, cyl(0.03, 0.03, 2.0, 8), P.oak, 0, 1.0, 0, { tex: 'wood' });
    part(rake, rbox(0.75, 0.06, 0.06, 0.02), P.metal, 0, 0.05, 0.02, { gloss: 0.5 });
    for (let k = 0; k < 7; k++) part(rake, cyl(0.012, 0.012, 0.2, 5), P.metal, -0.33 + k * 0.11, -0.04, 0.05, { outline: false });
    s.add(rake);
    // A mug of cocoa somebody left on a fence post, still steaming.
    part(s, rbox(0.2, MUG.y - 0.1, 0.2, 0.03), P.walnut, MUG.x, (MUG.y - 0.1) / 2, BACK + 0.14, { tex: 'planks' });
    part(s, cyl(0.11, 0.1, 0.2, 16), P.denim, MUG.x, MUG.y, BACK + 0.14, { gloss: 0.5 });
    part(s, torus(0.06, 0.02), P.denim, MUG.x + 0.12, MUG.y, BACK + 0.14, { gloss: 0.5, outline: false });
    part(s, cyl(0.095, 0.095, 0.02, 14), P.mahogany, MUG.x, MUG.y + 0.09, BACK + 0.14, { outline: false });
    for (let k = 0; k < 3; k++) {
      this.steam.push(part(s, sphere(0.045, 8), P.cream, MUG.x, MUG.y + 0.12, BACK + 0.14, { opacity: 0.4, outline: false, shadow: false }));
    }

    // In front of the lawn: a bench by the house, a wheelbarrow of leaves, shrubs in the corners.
    const bench = put(props.logSeat({ len: 1.8, r: 0.22 }), -SIDE + 0.75, 0, yz + 2.3, Math.PI / 2);
    bench.name = 'bench';
    const barrow = new THREE.Group();
    part(barrow, rbox(1.0, 0.36, 0.7, 0.08), P.forest, 0, 0.5, 0, { gloss: 0.3 });
    part(barrow, cyl(0.2, 0.2, 0.08, 16), P.charcoal, 0.62, 0.2, 0, { rx: Math.PI / 2 });
    for (const sz of [-1, 1]) {
      part(barrow, cyl(0.025, 0.025, 1.5, 6), P.oak, -0.3, 0.42, sz * 0.3, { rz: Math.PI / 2 - 0.15, outline: false });
      part(barrow, cyl(0.025, 0.025, 0.36, 6), P.charcoal, -0.45, 0.18, sz * 0.3, { outline: false });
    }
    LEAF_COLORS.forEach((c, k) => part(barrow, ball(0.2, 1), c, -0.3 + (k % 4) * 0.2, 0.7 + (k % 3) * 0.05, -0.18 + (k % 2) * 0.3, { sy: 0.5, outline: false }));
    put(barrow, 4.9, 0, yz + 2.2, 0.5);
    put(props.bush({ r: 0.7, color: mix(P.olive, P.copper, 0.35), seed: 12 }), SIDE - 0.9, 0, yz + 2.6);
    put(props.bush({ r: 0.55, color: mix(P.moss, P.mustard, 0.3), seed: 14, flowers: P.cream }), -3.4, 0, yz + 3.1);
    put(props.rock({ r: 0.35, seed: 4 }), -2.5, 0, yz + 2.7);
  }

  /** A team's raking zone: a tinted patch of lawn roped off against its side fence, with a card and stakes. */
  private buildZone(team: number, color: string, names: string): void {
    const s = this.scene;
    const side = zoneSide(team);
    const { zone, yard } = LEAF;
    const w = yard.x - zone.x;
    const cx = side * PILE_X;
    part(s, rbox(w + 0.1, 0.02, zone.z * 2, 0.2), mix(color, mix(LAWN, P.aubergine, 0.4), 0.8), cx, 0.012, 0, { tex: 'grass', outline: false, shadow: false });
    // The rope glows a little in the team's colour; the stakes have a bright knob.
    const rope = { glow: 0.8, outline: false as const, shadow: false };
    part(s, cyl(0.03, 0.03, zone.z * 2, 8), color, side * zone.x, 0.09, 0, { ...rope, rx: Math.PI / 2 });
    for (const sz of [-1, 1]) {
      part(s, cyl(0.03, 0.03, w, 8), color, cx, 0.09, sz * zone.z, { ...rope, rz: Math.PI / 2 });
      part(s, cyl(0.05, 0.06, 0.45, 8), P.oak, side * zone.x, 0.22, sz * zone.z, { tex: 'wood' });
      part(s, sphere(0.08, 10), color, side * zone.x, 0.48, sz * zone.z, { glow: 1.3, outline: false, shadow: false });
    }
    const card = nameCard(names, color, 1.0);
    card.position.set(cx, 0.3, LEAF.yard.z + 0.6);
    s.add(card);
    this.cards.push(card);
  }

  /** The leaf counts floating over each pile. */
  setPiles(piles: readonly number[]): void {
    for (const l of this.labels) {
      const n = piles[l.team] ?? 0;
      if (n === l.n) continue;
      if (l.n >= 0) l.pulse = 1;
      l.n = n;
      if (l.sprite) {
        this.scene.remove(l.sprite);
        l.sprite.material.map?.dispose();
        l.sprite.material.dispose();
      }
      l.sprite = popSprite(String(n), l.color, 0.62);
      l.sprite.position.set(zoneSide(l.team) * PILE_X, LABEL_Y, -1.2);
      this.scene.add(l.sprite);
    }
  }

  cheer(team: number, text: string): void {
    const l = this.labels.find((x) => x.team === team);
    if (l) this.words.add(text, '#fff6a8', new THREE.Vector3(zoneSide(team) * PILE_X, LABEL_Y + 0.7, -1.2), 0.55, 2.4);
  }

  setBase(p: number, mood: CompanionMood, react = false): void {
    const rig = this.rigs[p];
    if (!rig) return;
    this.final = true;
    rig.mood = mood;
    rig.c.setBase(mood);
    if (react) rig.c.react(mood, 3);
  }

  react(p: number, mood: CompanionMood, seconds: number): void {
    this.rigs[p]?.c.react(mood, seconds);
  }

  dispose(): void {
    for (const r of this.rigs) r.c.dispose();
    this.words.dispose();
    for (const l of this.labels) {
      l.sprite?.material.map?.dispose();
      l.sprite?.material.dispose();
    }
    for (const c of this.cards) {
      c.material.map?.dispose();
      c.material.dispose();
    }
    this.leafMesh.dispose();
    this.leafMat.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks);
    this.words.update(dt);
    for (const r of this.rigs) r.c.update(dt);
    this.syncRakers(dt);
    this.placeLeaves(dt);
    for (const l of this.labels) {
      l.pulse = Math.max(0, l.pulse - dt * 3);
      const k = 1 + Math.sin(l.pulse * Math.PI) * 0.18;
      l.sprite?.scale.set((1024 / 112) * 0.62 * k, 0.62 * k, 1);
    }
    for (const d of this.drifters) {
      d.t += dt * d.speed;
      if (d.t > 1) d.t -= 1;
      const y = d.from.y - d.t * (d.from.y - 0.1);
      d.mesh.position.set(d.from.x + Math.sin(this.time * 1.3 + d.phase) * 0.5 + d.t * 0.8, y, d.from.z + Math.cos(this.time + d.phase) * 0.2);
      d.mesh.rotation.set(Math.sin(this.time * 3 + d.phase) * 0.8, this.time * 2 + d.phase, 0);
    }
    this.steam.forEach((b, k) => {
      const t = (this.time * 0.45 + k / 3) % 1;
      b.position.set(MUG.x + Math.sin(this.time * 2 + k * 2) * 0.05, MUG.y + 0.14 + t * 0.55, BACK + 0.14);
      b.scale.setScalar(0.6 + t * 1.6 * (1 - t) * 2);
      b.visible = t < 0.9;
    });
    this.env?.update(dt, this.time);
    // The lamps flicker by a few percent.
    this.env?.lamps.forEach((l, i) => {
      const base = this.lampBase[i];
      if (base !== undefined) l.intensity = base * (1 + Math.sin(this.time * 7 + i * 2) * 0.04 + Math.sin(this.time * 13 + i) * 0.03);
    });
  }

  /** Puts everyone where the rules say they are: walking, mid-dive, or face down in the leaves. */
  private syncRakers(dt: number): void {
    this.yard.rakers.forEach((r, p) => {
      const rig = this.rigs[p];
      if (!rig) return;
      const root = rig.c.root;
      root.position.x = r.x;
      root.position.z = r.z;
      const turn = Math.atan2(Math.sin(r.face - root.rotation.y), Math.cos(r.face - root.rotation.y));
      root.rotation.y += turn * Math.min(1, dt * (r.lunge > 0 ? 30 : 10));
      const lying = r.down > 0 || r.lunge > 0;
      rig.tilt += ((lying ? Math.PI / 2 : 0) - rig.tilt) * Math.min(1, dt * (lying ? 16 : 7));
      root.rotation.x = rig.tilt;
      const k = rig.tilt / (Math.PI / 2);
      const hop = r.lunge > 0 ? Math.sin(Math.PI * (1 - r.lunge / DIVE.time)) * 0.35 : 0;
      root.position.y = rig.lift * k + hop;
      const speed = Math.hypot(r.vx, r.vz);
      this.setMotion(rig, lying || k > 0.2 ? null : speed > 2.6 ? 'run' : speed > 0.3 ? 'walk' : null, speed);
      if (!this.final) this.setMood(rig, r.down > 0 ? 'happy' : 'idle');
      rig.ring.position.set(r.x, 0.04, r.z);
      rig.ring.visible = k < 0.3;
      const ready = r.cool <= 0;
      if (ready !== rig.ready) {
        rig.ready = ready;
        rig.ring.material = ready ? rig.hot : rig.cold;
      }
    });
  }

  private setMotion(rig: Rig, motion: 'walk' | 'run' | null, speed: number): void {
    if (motion === rig.motion) return;
    rig.motion = motion;
    rig.c.move(motion, speed);
  }

  private setMood(rig: Rig, mood: CompanionMood): void {
    if (mood === rig.mood) return;
    rig.mood = mood;
    rig.c.setBase(mood);
  }

  /** Every leaf where it lies (heaped up a little where they're thick) or fluttering through the air. */
  private placeLeaves(dt: number): void {
    const cell = 0.32;
    const key = (x: number, z: number) => (Math.floor(x / cell) + 200) * 1000 + Math.floor(z / cell) + 200;
    const grid = this.grid;
    grid.clear();
    const leaves = this.yard.leaves;
    for (const l of leaves) {
      if (l.y > 0) continue;
      const k = key(l.x, l.z);
      grid.set(k, (grid.get(k) ?? 0) + 1);
    }
    const settle = dt > 0 ? Math.min(1, dt * 8) : 1;
    leaves.forEach((l, i) => {
      const flying = l.y > 0.001;
      const n = flying ? 1 : (grid.get(key(l.x, l.z)) ?? 1);
      const goal = 0.025 + Math.min(0.42, (n - 1) * 0.022) * (this.heapK[i] ?? 1);
      const base = (this.base[i] ?? 0) + (goal - (this.base[i] ?? 0)) * settle;
      this.base[i] = base;
      const spin = this.spin[i] ?? 1;
      let tx: number;
      let tz = 0;
      if (flying) {
        this.yaw[i] = (this.yaw[i] ?? 0) + spin * dt;
        tx = Math.sin(this.time * 6 + spin) * 0.9;
        tz = Math.cos(this.time * 5 + spin) * 0.5;
      } else {
        this.yaw[i] = (this.yaw[i] ?? 0) + Math.hypot(l.vx, l.vz) * dt * Math.sign(spin) * 1.5;
        tx = this.rest[i] ?? 0;
      }
      const sz = this.size[i] ?? 1;
      this.p.set(l.x, l.y + base, l.z);
      this.e.set(tx, this.yaw[i] ?? 0, tz);
      this.q.setFromEuler(this.e);
      this.s.set(sz, sz * 0.24, sz * 0.62);
      this.m.compose(this.p, this.q, this.s);
      this.leafMesh.setMatrixAt(i, this.m);
    });
    this.leafMesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'leafpile',
  title: 'Leaf Pile',
  how: 'Walk into the leaves to sweep them into your team’s pile. Press Dive to jump into the other pile and send it flying! Most leaves in your pile after 35 seconds wins.',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const yard = newYard(teams, seats.length, rng);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const posOf = new Map(seats.map((s, p) => [s.index, p] as const));
    const cpu = (p: number) => session.isCpu(seatOf(p));
    // Have the set's textures in before it first shows (but never wait long for them).
    const warm = Promise.race([preloadTextures('grass', 'brick', 'planks', 'rock', 'bark', 'wood'), new Promise<void>((done) => setTimeout(done, 2000))]);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT })));
    await warm;
    const view = new Garden(seats, teams, companions, yard);
    ctx.stage.setView(view);

    const brains = new Map<number, Brain>();
    for (const p of seats.keys()) if (cpu(p)) brains.set(p, newBrain(ctx.skill(), rng));
    const sticks: Stick[] = seats.map(() => ({ ...IDLE }));
    // A quick tap can go down and up between two frames: remember it until the physics has used it.
    const latch = seats.map(() => false);

    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const teamOf = (p: number) => yard.rakers[p]?.team ?? -1;
    const teamName = (members: readonly number[]) => members.map(nameOf).join(' & ');
    const partnerOf = (p: number) => (teams[teamOf(p)] ?? []).find((q) => q !== p);
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });

    seats.forEach((s, p) => {
      const where = teamOf(p) === 0 ? 'on the left' : 'on the right';
      const partner = partnerOf(p);
      session.setLayout(s.index, {
        kind: 'stick',
        button: 'Dive',
        note: partner === undefined ? `Sweep the leaves into your pile ${where}. Dive into theirs!` : `Team up with ${nameOf(partner)}: sweep the leaves into your pile ${where}!`,
      });
    });

    const off = session.onInput((seat, msg) => {
      const p = posOf.get(seat);
      if (p === undefined || cpu(p) || msg.t !== 'stick') return;
      if (msg.a && !sticks[p]?.a) latch[p] = true;
      sticks[p] = { x: msg.x, y: msg.y, a: msg.a };
    });

    const piles = () => [pileCount(yard, 0), pileCount(yard, 1)];
    const hud = (counts: number[]) =>
      ui.live(
        teams.map((members, team) => {
          const lead = seats[members[0] ?? 0];
          const n = counts[team] ?? 0;
          return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} lea${n === 1 ? 'f' : 'ves'}` };
        }),
      );

    ui.caption('Walk into the leaves to sweep them into your pile. Dive into theirs!');
    let shown = '';
    let hudAt = -1;
    let hurry = false;
    let whistled = false;
    const deniedAt = seats.map(() => -9);
    const rustleAt = seats.map(() => -9);
    const cooling = seats.map(() => false);
    await everyFrame(clock, (dt, t) => {
      const lags = seats.map((s) => Math.max(0, session.seats[s.index]?.rtt ?? 0) / 2000);
      const input = seats.map((_, p): Stick => {
        const brain = brains.get(p);
        const s = brain ? cpuStick(yard, p, brain, rng) : (sticks[p] ?? IDLE);
        if (brain && s.a) latch[p] = true;
        return { x: s.x, y: s.y, a: latch[p] ?? false };
      });
      const ev = advance(yard, input, dt, lags);
      if (ev.steps > 0) latch.fill(false);

      for (const p of ev.dives) {
        swoosh(sfx);
        buzz(p, [20]);
        cooling[p] = true;
      }
      for (const land of ev.lands) {
        const p = land.who;
        const at = new THREE.Vector3(land.x, 1.3, land.z);
        const mine = teamOf(p);
        if (land.zone >= 0 && land.zone !== mine && land.scattered > 0) {
          crunch(sfx, true);
          view.words.add('Whoosh!', seats[p]?.color ?? '#ffffff', at, 0.5);
          tell(p, true, 'Whoosh! Their pile went flying.');
          buzz(p, [40]);
          view.react(p, 'happy', 1.4);
          for (const q of teams[land.zone] ?? []) {
            tell(q, false, 'Your pile got scattered! Sweep it back.');
            buzz(q, [60, 40, 60]);
            view.react(q, 'sad', 1.2);
          }
        } else if (land.zone >= 0 && land.zone === mine) {
          flump(sfx);
          view.words.add('Flump.', '#fff1d6', at, 0.4);
          tell(p, true, 'Comfy! But that’s your own pile.');
        } else {
          crunch(sfx, false);
          if (land.scattered > 0) view.words.add('Flump.', '#fff1d6', at, 0.4);
        }
      }
      for (const p of ev.denied) {
        if (t - (deniedAt[p] ?? -9) < 1.2) continue;
        deniedAt[p] = t;
        tell(p, false, 'Still shaking the leaves off…');
      }
      yard.rakers.forEach((r, p) => {
        if (cooling[p] && r.cool <= 0) {
          cooling[p] = false;
          if (yard.phase === 'play') tell(p, true, 'Dive ready!');
        }
        if ((ev.rustle[p] ?? 0) > 2 && t - (rustleAt[p] ?? -9) > 0.22) {
          rustleAt[p] = t;
          rustle(sfx, Math.min(0.07, 0.025 + (ev.rustle[p] ?? 0) * 0.002));
        }
      });

      if (t - hudAt >= 0.1) {
        hudAt = t;
        const counts = piles();
        view.setPiles(counts);
        const key = counts.join('|');
        if (key !== shown) {
          shown = key;
          hud(counts);
        }
        if (yard.phase === 'play') ui.timer(LEAF.duration - yard.time);
        if (!hurry && yard.phase === 'play' && LEAF.duration - yard.time <= 5) {
          hurry = true;
          ui.caption('Five seconds left!', '#ffd166');
        }
      }
      if (!whistled && yard.phase !== 'play') {
        whistled = true;
        whistle(sfx);
        ui.timer(0);
        ui.caption('Time! Letting the leaves settle…');
      }
      return yard.phase === 'done';
    });
    off();
    ui.timer(null);

    // The count. (Anyone still face down in the leaves gets up for it.)
    const counts = piles();
    for (const r of yard.rakers) r.down = r.lunge = 0;
    view.setPiles(counts);
    hud(counts);
    const best = Math.max(...teams.map((_, k) => counts[k] ?? 0));
    const tie = teams.length > 1 && teams.every((_, k) => (counts[k] ?? 0) === best);
    teams.forEach((members, k) => {
      const won = (counts[k] ?? 0) === best;
      for (const p of members) {
        view.setBase(p, tie ? 'approval' : won ? 'happy' : 'sad', won && !tie);
        tell(p, won, tie ? 'Time! Two piles, exactly the same.' : won ? 'Time! Your pile is the biggest!' : 'Time! Their pile was bigger.');
        buzz(p, won ? [30, 40, 30, 40, 120] : [120]);
      }
      if (won && !tie) {
        view.cheer(k, 'Biggest pile!');
        const lead = seats[members[0] ?? 0];
        ui.caption(`${teamName(members)} ${members.length > 1 ? 'have' : 'has'} the biggest pile!`, lead?.color);
      }
    });
    if (tie) ui.caption(`Two piles of ${best}. Very even.`);
    sfx.good();
    await clock.wait(1.8);
    ui.caption(null);

    return {
      scores: leafScores(yard, seats.length),
      details: seats.map((_, p) => {
        const r = yard.rakers[p];
        const n = counts[teamOf(p)] ?? 0;
        const raids = r?.raids ?? 0;
        return `${n} lea${n === 1 ? 'f' : 'ves'} in your pile${raids ? ` · ${raids} raid${raids === 1 ? '' : 's'}` : ''}`;
      }),
    };
  },
};
