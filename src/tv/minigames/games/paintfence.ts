// Paint the Fence on the TV: a sunny backyard and a long picket fence of bare boards. Two pairs stroll along it
// with brushes, painting each board they pass in their colour (and over each other's), heading back to their
// buckets on the lawn when the brush runs dry. A dog snoozes against the fence and moves only when disturbed.
import * as THREE from 'three';
import {
  type CpuPainter,
  FENCE,
  FENCE_HALF,
  IDLE,
  type Stick,
  type Yard,
  type YardEvents,
  boardX,
  boardsOf,
  bucketsOf,
  cpuStick,
  fenceScores,
  isOver,
  newCpuPainter,
  newYard,
  stepYard,
} from '../../../game/minigames/paintfence';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, type PartOptions, ball, box, cone, cyl, material, mix, nameCard, part, pill, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.25; // companions
const TILT = 0.52; // the camera looks down this much (radians)
const BOARD_H = 1.3;
const BOARD_W = FENCE.gap - 0.1;
const WOOD = mix(P.cream, P.oak, 0.3); // bare boards
const DOG = mix(P.mustard, P.clay, 0.55);
const DOG_DARK = mix(DOG, P.walnut, 0.45);
/** Fresh paint: the team's colour over the wood's grain, with a little sheen. */
const PAINT: PartOptions = { tex: 'planks', texStrength: 0.3, gloss: 0.25 };

// ------------------------------------------------------------------ sounds

/** A soft brush stroke. */
function stroke(sfx: Sfx): void {
  noise(sfx, { dur: 0.12, filter: 'bandpass', freq: 1400, to: 900, gain: 0.06 });
}

/** Dipping the brush. */
function dip(sfx: Sfx): void {
  tone(sfx, { freq: 300, to: 520, dur: 0.12, gain: 0.08 });
  noise(sfx, { dur: 0.1, filter: 'lowpass', freq: 600, gain: 0.08 });
}

/** A sleepy dog's yawn. */
function yawn(sfx: Sfx): void {
  tone(sfx, { freq: 520, to: 260, dur: 0.45, type: 'triangle', gain: 0.07 });
}

// ------------------------------------------------------------------ props

interface BoardRig {
  /** The finished coat (hidden on bare wood). */
  coat: THREE.Mesh;
  top: THREE.Mesh;
  /** A coat going on, growing from the bottom. */
  wet: THREE.Mesh;
  team: number;
  shake: number;
}

/** A tin paint bucket: a label and a pool of paint in a team's colour, a wire handle, a few drips. */
function bucket(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.24, 0.2, 0.38, 20), P.stone, 0, 0.19, 0, { gloss: 0.6, outline: 0.02 });
  part(g, torus(0.24, 0.016), P.metal, 0, 0.375, 0, { rx: Math.PI / 2, gloss: 0.6, outline: false });
  part(g, cyl(0.237, 0.222, 0.17, 20), color, 0, 0.2, 0, { outline: false });
  part(g, cyl(0.215, 0.215, 0.02, 20), color, 0, 0.365, 0, { outline: false, gloss: 0.5 });
  part(g, torus(0.25, 0.012, Math.PI), P.metal, 0, 0.36, 0, { rx: -0.5, outline: false });
  // Drips down the side and a splash on the grass.
  part(g, pill(0.022, 0.1), color, 0.12, 0.31, 0.2, { outline: false, shadow: false });
  part(g, pill(0.018, 0.05), color, -0.06, 0.33, 0.228, { outline: false, shadow: false });
  part(g, cyl(0.17, 0.17, 0.012, 14), color, 0.2, 0.008, 0.24, { outline: false, shadow: false, sz: 1.4, gloss: 0.4 });
  return g;
}

/** A paintbrush, bristles down. */
function brush(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.022, 0.028, 0.28, 8), P.oak, 0, 0.14, 0, { outline: 0.012 });
  part(g, rbox(0.12, 0.05, 0.05, 0.015), P.metal, 0, -0.02, 0, { outline: false, gloss: 0.7 });
  part(g, rbox(0.11, 0.07, 0.045, 0.02), P.linen, 0, -0.07, 0, { outline: false });
  part(g, rbox(0.115, 0.06, 0.05, 0.02), color, 0, -0.12, 0, { outline: false, gloss: 0.4 });
  return g;
}

interface DogRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  tail: THREE.Mesh;
  legs: THREE.Mesh[];
}

/** A round, sleepy dog, built facing +x. */
function dogMesh(): DogRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  part(body, pill(0.27, 0.65), DOG, 0, 0, 0, { rz: Math.PI / 2, outline: 0.02 });
  part(body, ball(0.22, 1), P.cream, 0.32, -0.05, 0, { sx: 0.8, outline: false });
  // A darker saddle patch and a collar with a brass tag.
  part(body, ball(0.24, 1), DOG_DARK, -0.12, 0.09, 0, { sx: 1.25, sy: 0.75, sz: 0.95, outline: false });
  part(body, torus(0.2, 0.03), P.teal, 0.42, 0.04, 0, { ry: Math.PI / 2, outline: false });
  part(body, sphere(0.04, 8), P.brass, 0.44, -0.16, 0, { gloss: 0.7, outline: false });
  const head = new THREE.Group();
  head.position.set(0.58, 0.12, 0);
  body.add(head);
  part(head, ball(0.23, 2), DOG, 0, 0, 0, { outline: 0.02 });
  part(head, ball(0.12, 1), P.cream, 0.17, -0.06, 0, { sx: 1.2, outline: false });
  part(head, ball(0.04, 1), P.ink, 0.3, -0.02, 0, { outline: false, gloss: 0.6 });
  for (const s of [-1, 1]) {
    part(head, cone(0.09, 0.2, 8), DOG_DARK, -0.02, 0.08, s * 0.18, { rx: s * 1.9, sz: 0.5, outline: 0.015 });
    // Closed, sleepy eyes.
    part(head, box(0.07, 0.015, 0.02), P.ink, 0.15, 0.06, s * 0.1, { outline: false });
  }
  const tail = part(body, cyl(0.04, 0.06, 0.32, 8), DOG, -0.6, 0.08, 0, { rz: 1.0, outline: 0.015 });
  const legs: THREE.Mesh[] = [];
  for (const x of [-0.3, 0.3]) for (const z of [-0.14, 0.14]) legs.push(part(body, cyl(0.06, 0.06, 0.26, 8), DOG, x, -0.2, z, { outline: 0.015 }));
  return { root, body, head, tail, legs };
}

// ------------------------------------------------------------------ the scene

interface Rig {
  c: Companion;
  ring: THREE.Mesh;
  card: THREE.Sprite;
  brush: THREE.Group;
  meter: THREE.Group;
  fill: THREE.Mesh;
  motion: 'walk' | 'run' | null;
  yaw: number;
}

interface Fleck {
  m: THREE.Mesh;
  v: THREE.Vector3;
  age: number;
}

class Backyard implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly floaters: Floaters;
  readonly rigs: (Rig | undefined)[] = [];
  private readonly boards: BoardRig[] = [];
  private readonly dog: DogRig;
  private readonly fit: CameraFit;
  private readonly marks: Mark[];
  private readonly cards: THREE.Sprite[] = [];
  private flecks: Fleck[] = [];
  private zzzIn = 1;
  /** A coat still going on looks a little lighter. */
  private readonly wetColors: string[];
  private readonly rand = seeded(29);
  private time = 0;
  private readonly env: Env;

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    companions: (Companion | undefined)[],
    private readonly colors: string[],
    teamOf: readonly number[],
  ) {
    this.wetColors = colors.map((c) => mix(c, P.cream, 0.3));
    this.floaters = new Floaters(this.scene);
    this.env = this.build();

    for (let i = 0; i < FENCE.boards; i++) {
      const x = boardX(i);
      const lean = (this.rand() - 0.5) * 0.03;
      const wood = mix(WOOD, P.oak, this.rand() * 0.45);
      part(this.scene, rbox(BOARD_W, BOARD_H, 0.06, 0.02), wood, x, BOARD_H / 2, FENCE.z, { rz: lean, tex: 'planks', texStrength: 0.8, outline: 0.014 });
      part(this.scene, cone(BOARD_W * 0.72, 0.2, 4), wood, x, BOARD_H + 0.08, FENCE.z, { ry: Math.PI / 4, sz: 0.25, rz: lean, outline: 0.014 });
      // Two nails where the board meets each rail.
      for (const y of [0.35, BOARD_H - 0.3]) part(this.scene, box(0.03, 0.03, 0.012), P.metal, x, y, FENCE.z + 0.032, { outline: false, shadow: false, gloss: 0.5 });
      const coat = part(this.scene, box(BOARD_W + 0.02, BOARD_H, 0.03), P.cream, x, BOARD_H / 2, FENCE.z + 0.035, { outline: false, rz: lean });
      const top = part(this.scene, cone(BOARD_W * 0.74, 0.21, 4), P.cream, x, BOARD_H + 0.08, FENCE.z + 0.005, { ry: Math.PI / 4, sz: 0.3, outline: false, rz: lean });
      const wet = part(this.scene, box(BOARD_W + 0.03, BOARD_H, 0.03), P.cream, x, 0, FENCE.z + 0.045, { outline: false, rz: lean });
      coat.visible = false;
      top.visible = false;
      wet.visible = false;
      this.boards.push({ coat, top, wet, team: -1, shake: 0 });
    }

    // Each pair's buckets, and a card with their names at the front of the lawn.
    teams.forEach((members, team) => {
      const color = colors[team] ?? '#ffd166';
      for (const b of bucketsOf(team)) {
        const g = bucket(color);
        g.position.set(b.x, 0, b.z);
        this.scene.add(g);
      }
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.0);
      card.position.set((team === 0 ? -1 : 1) * 4.2, 0.2, FENCE.front + 0.75);
      this.scene.add(card);
      this.cards.push(card);
    });

    this.dog = dogMesh();
    this.scene.add(this.dog.root);

    seats.forEach((seat, p) => {
      const c = companions[p];
      const team = teamOf[p] ?? -1;
      if (!c || team < 0) return;
      const color = colors[team] ?? seat.color;
      c.setBase('happy');
      this.scene.add(c.root);
      const ring = part(this.scene, torus(0.42, 0.045), seat.color, 0, 0.04, 0, { rx: Math.PI / 2, glow: 0.6, outline: false, shadow: false });
      const card = nameCard(seat.name, seat.color, 0.8);
      this.scene.add(card);
      const b = brush(color);
      b.position.set(0.32, 0.62, 0.22);
      b.rotation.set(0.5, 0, -0.3);
      c.root.add(b);
      const meter = new THREE.Group();
      part(meter, box(0.62, 0.12, 0.01), P.aubergine, 0, 0, 0, { basic: true });
      const fill = part(meter, box(0.56, 0.07, 0.012), color, 0, 0, 0.004, { basic: true });
      this.scene.add(meter);
      this.rigs[p] = { c, ring, card, brush: b, meter, fill, motion: null, yaw: 0 };
    });

    const xm = FENCE_HALF + 0.7;
    this.marks = [
      ...[-xm, xm].flatMap((x) => [
        { p: new THREE.Vector3(x, BOARD_H + 0.3, FENCE.z), pad: 0.02 },
        { p: new THREE.Vector3(x, 0, FENCE.front + 0.3), pad: 0.02 },
        { p: new THREE.Vector3(x * 1.04, HEIGHT + 0.62, FENCE.front), pad: 0.04 },
      ]),
      { p: new THREE.Vector3(0, 0, FENCE.front + 0.8), pad: 0.05 },
      { p: new THREE.Vector3(0, HEIGHT + 0.9, FENCE.z + FENCE.near), pad: 0.04 },
    ];
    this.fit = new CameraFit(this.camera, TILT);
  }

  /** The garden at golden hour: lawn, the fence's posts and rails, flower beds, a shed and a tree behind it. */
  private build(): Env {
    const s = this.scene;
    const rand = seeded(11);
    const env = backyard(s, { mood: 'golden', w: 23, d: 11.5, clear: { w: 19.5, d: 9.2 }, seed: 7 });
    env.sun.target.position.set(0, 0, 0.6);
    const set = new THREE.Group();
    s.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = 1) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      if (scale !== 1) o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    // Mown stripes on the lawn.
    const stripe = mix(P.grass, P.grassDark, 0.55);
    for (let i = -9; i <= 9; i++) {
      if (i % 2 === 0) continue;
      part(set, box(1.0, 0.02, FENCE.front - FENCE.z + 1.6), stripe, i, 0.001, (FENCE.front + FENCE.z) / 2 + 0.2, { tex: 'grass', outline: false, shadow: false });
    }
    // Posts and rails behind the boards.
    const timber = mix(P.oak, P.cream, 0.25);
    for (const side of [-1, 1]) {
      part(set, rbox(0.17, BOARD_H + 0.25, 0.17, 0.04), timber, side * (FENCE_HALF + 0.12), (BOARD_H + 0.25) / 2, FENCE.z - 0.06, { tex: 'planks', texStrength: 0.7, outline: 0.02 });
      part(set, rbox(0.23, 0.06, 0.23, 0.02), mix(timber, P.ink, 0.2), side * (FENCE_HALF + 0.12), BOARD_H + 0.28, FENCE.z - 0.06, { outline: false });
    }
    for (const y of [0.35, BOARD_H - 0.3]) part(set, rbox(FENCE_HALF * 2 + 0.2, 0.1, 0.06, 0.02), mix(timber, P.ink, 0.12), 0, y, FENCE.z - 0.07, { tex: 'planks', texStrength: 0.7, outline: false });

    // Beyond the fence: a flower bed, bushes peeking over, an apple tree and a garden shed.
    part(set, rbox(FENCE_HALF * 2 + 1.4, 0.1, 1.5, 0.04), P.soilDark, 0, 0.01, FENCE.z - 1.0, { outline: false, shadow: false });
    const blooms = [P.rose, P.mustard, P.cream, P.terracotta, P.mauve];
    for (let i = 0; i < 9; i++) {
      const x = -7.6 + i * 1.9 + (rand() - 0.5) * 0.5;
      if (Math.abs(x - 6.2) < 1.7) continue; // the shed stands here
      put(props.bush({ r: 0.72 + rand() * 0.26, flowers: blooms[i % blooms.length] as string, seed: i + 3 }), x, 0, FENCE.z - 1.15 - rand() * 0.4, rand() * 6);
    }
    for (let i = 0; i < 14; i++) put(props.tuft({ seed: i + 40, flowers: blooms[(i + 2) % blooms.length] as string, s: 1.5 }), -7.8 + i * 1.2 + rand() * 0.4, 0.05, FENCE.z - 0.42 - rand() * 0.2, rand() * 6);
    const apple = put(props.tree({ kind: 'round', h: 4.4, seed: 5 }), -5.4, 0, FENCE.z - 2.9);
    for (let i = 0; i < 7; i++) part(apple, sphere(0.09, 10), P.brick, (rand() - 0.5) * 2.2, 2.5 + rand() * 1.2, 0.75 + rand() * 0.45, { gloss: 0.4, outline: false });
    put(props.tree({ kind: 'birch', h: 3.8, seed: 9 }), 1.6, 0, FENCE.z - 3.6);
    const shed = new THREE.Group();
    const shedWall = mix(P.teal, P.slate, 0.45);
    part(shed, box(2.6, 2.0, 2.0), shedWall, 0, 1.0, 0, { tex: 'planks', outline: 0.025 });
    part(shed, box(1.5, 0.5, 1.96), shedWall, 0, 2.2, 0, { tex: 'planks', outline: false });
    for (const side of [-1, 1]) part(shed, box(1.75, 0.09, 2.5), P.roof, side * 0.72, 2.42, 0, { rz: side * -0.52, tex: 'roofTiles', outline: 0.02 });
    part(shed, rbox(0.74, 1.4, 0.06, 0.02), P.walnut, -0.45, 0.72, 1.02, { tex: 'wood', outline: 0.015 });
    part(shed, sphere(0.04, 8), P.brass, -0.2, 0.72, 1.07, { gloss: 0.6, outline: false });
    part(shed, rbox(0.62, 0.56, 0.05, 0.02), P.cream, 0.6, 1.25, 1.02, { outline: 0.015 });
    part(shed, box(0.5, 0.44, 0.02), P.midnight, 0.6, 1.25, 1.05, { gloss: 0.6, outline: false });
    put(shed, 6.2, 0, FENCE.z - 2.7, -0.12);
    put(props.plant({ kind: 'fern', h: 0.6, pot: P.terracotta, seed: 2 }), 7.9, 0, FENCE.z - 1.5);

    // On the lawn: a watering can, plant pots, and things left about at the front.
    const can = new THREE.Group();
    part(can, cyl(0.2, 0.22, 0.34, 16), P.sage, 0, 0.17, 0, { gloss: 0.5, outline: 0.02 });
    part(can, cyl(0.03, 0.035, 0.44, 8), P.sage, 0.3, 0.3, 0, { rz: -0.9, gloss: 0.5, outline: false });
    part(can, cyl(0.07, 0.03, 0.05, 10), P.sage, 0.47, 0.44, 0, { rz: -0.9, gloss: 0.5, outline: false });
    part(can, torus(0.13, 0.02, Math.PI), P.sage, -0.2, 0.2, 0, { rz: Math.PI / 2, outline: false });
    put(can, -FENCE_HALF - 0.4, 0, FENCE.front - 0.3, 0.4);
    const pots = new THREE.Group();
    part(pots, cyl(0.2, 0.15, 0.26, 14), P.terracotta, 0, 0.13, 0, { outline: 0.02 });
    part(pots, cyl(0.2, 0.15, 0.26, 14), P.terracotta, 0.02, 0.31, 0, { rx: 0.18, outline: 0.02 });
    part(pots, cyl(0.16, 0.12, 0.2, 14), mix(P.terracotta, P.ink, 0.15), 0.42, 0.1, 0.12, { outline: 0.02 });
    put(pots, FENCE_HALF + 0.4, 0, FENCE.front - 0.4);
    put(props.plant({ kind: 'fern', h: 0.45, pot: P.terracotta, seed: 5 }), FENCE_HALF + 0.95, 0, FENCE.front - 1.2);
    // The front corners: something soft and close to the camera on both sides.
    put(props.bush({ r: 1.0, flowers: P.rose, seed: 11 }), -10.2, 0, 6.6);
    put(props.bush({ r: 0.7, flowers: P.cream, seed: 12 }), -8.6, 0, 7.6);
    put(props.rock({ r: 0.4, seed: 6 }), -7.4, 0, 6.9);
    put(props.blanket({ color: P.terracotta, tex: 'gingham', w: 2.0, d: 1.6 }), 7.2, 0, 5.6, 0.35);
    put(props.snackBowl({ fill: 'fruit', color: P.ceramic, r: 0.2 }), 6.9, 0.03, 5.5);
    put(props.drink({ kind: 'bottle', color: P.forest }), 7.6, 0.03, 5.9);
    put(props.pouf({ color: P.mustard }), 5.6, 0, 6.3, 0, 1.3);
    // The decorators' corner: a dust sheet with spare tins and a roller tray, and a stepladder.
    const sheet = new THREE.Group();
    part(sheet, rbox(3.0, 0.03, 1.9, 0.012), P.linen, 0, 0.015, 0, { tex: 'fabric', texStrength: 0.7, outline: false, shadow: false });
    const tins = [P.sage, P.mauve, P.mustard, P.clay];
    tins.forEach((c, i) => {
      const x = -1.0 + i * 0.52 + (i % 2) * 0.1;
      const z = -0.35 + (i % 2) * 0.5;
      part(sheet, cyl(0.17, 0.17, 0.3, 18), P.stone, x, 0.18, z, { gloss: 0.6, outline: 0.018 });
      part(sheet, cyl(0.172, 0.172, 0.14, 18), c, x, 0.17, z, { outline: false });
      part(sheet, cyl(0.175, 0.175, 0.02, 18), mix(P.stone, P.ink, 0.2), x, 0.335, z, { gloss: 0.6, outline: false });
    });
    part(sheet, cyl(0.17, 0.17, 0.3, 18), P.stone, 0.2, 0.48, -0.1, { gloss: 0.6, outline: 0.018 });
    part(sheet, cyl(0.172, 0.172, 0.14, 18), P.cream, 0.2, 0.47, -0.1, { outline: false });
    part(sheet, rbox(0.5, 0.07, 0.7, 0.02), P.charcoal, 1.0, 0.065, 0.3, { ry: 0.3, gloss: 0.4, outline: 0.015 });
    part(sheet, cyl(0.06, 0.06, 0.34, 12), P.cream, 1.0, 0.14, 0.24, { rz: Math.PI / 2, ry: 0.3, tex: 'terry', outline: false });
    part(sheet, cyl(0.014, 0.014, 0.5, 6), P.oak, 1.14, 0.2, 0.52, { rx: 1.25, ry: 0.3, outline: false });
    put(sheet, -0.6, 0, 5.9, -0.08);
    const ladder = new THREE.Group();
    for (const side of [-1, 1]) {
      for (const dx of [-0.26, 0.26]) part(ladder, rbox(0.05, 1.7, 0.07, 0.015), P.oak, dx, 0.82, side * 0.3, { rx: side * -0.36, tex: 'wood', outline: 0.012 });
    }
    for (let i = 0; i < 4; i++) part(ladder, rbox(0.56, 0.035, 0.12, 0.012), mix(P.oak, P.ink, 0.12), 0, 0.3 + i * 0.36, 0.48 - i * 0.135, { tex: 'wood', outline: false });
    part(ladder, rbox(0.62, 0.05, 0.3, 0.02), P.oak, 0, 1.62, 0, { tex: 'wood', outline: 0.012 });
    put(ladder, -7.2, 0, 4.9, 0.5);
    put(props.crate({ s: 0.55 }), 10.2, 0, 6.6, 0.3);
    put(props.plant({ kind: 'monstera', h: 0.8, pot: P.ceramic, seed: 4 }), 10.2, 0.55, 6.6);
    put(props.bush({ r: 0.8, flowers: P.mustard, seed: 14 }), 10.9, 0, 4.6);
    // Daisies in the grass.
    const buckets = bucketsOf(0).concat(bucketsOf(1));
    for (let i = 0; i < 16; i++) {
      const x = (rand() - 0.5) * 18;
      const z = FENCE.z + 0.6 + rand() * (FENCE.front - FENCE.z);
      if (buckets.some((b) => Math.hypot(b.x - x, b.z - z) < 0.7)) continue;
      put(props.tuft({ seed: i + 70, flowers: P.cream, s: 0.8 }), x, 0, z, rand() * 6);
    }
    return env;
  }

  /** Board colours and coats in progress, from the rules. */
  syncBoards(y: Yard): void {
    y.boards.forEach((b, i) => {
      const r = this.boards[i];
      if (!r) return;
      if (b.team !== r.team) {
        r.team = b.team;
        r.coat.visible = b.team >= 0;
        r.top.visible = b.team >= 0;
        if (b.team >= 0) {
          const m = material(this.colors[b.team] ?? P.cream, PAINT);
          r.coat.material = m;
          r.top.material = m;
          // A finished board: a little spatter off the top.
          for (let k = 0; k < 4; k++) this.fleck(boardX(i), BOARD_H * (0.55 + this.rand() * 0.45), b.team);
        }
        r.shake = 1;
      }
      const lead = b.wet[0] >= b.wet[1] ? 0 : 1;
      const wet = b.wet[lead];
      r.wet.visible = wet > 0.02;
      if (r.wet.visible) {
        r.wet.material = material(this.wetColors[lead] ?? '#ffffff');
        r.wet.scale.y = wet;
        r.wet.position.y = (BOARD_H * wet) / 2;
      }
    });
  }

  /** Puts everyone where the rules say, brushes bobbing on boards, paint meters over their heads. */
  syncPeople(y: Yard, dt: number): void {
    const follow = 1 - Math.exp(-dt * 12);
    y.painters.forEach((cp, p) => {
      const r = this.rigs[p];
      if (!r) return;
      const root = r.c.root;
      root.position.set(cp.x, 0, cp.z);
      const speed = Math.hypot(cp.vx, cp.vz);
      // Painting: side-on to the fence, half turned to it. Otherwise face where they're going.
      const along = cp.vx >= 0 ? 1 : -1;
      const target = cp.painting >= 0 ? Math.atan2(along, -0.4) : speed > 0.3 ? Math.atan2(cp.vx, cp.vz) : r.yaw;
      r.yaw += Math.atan2(Math.sin(target - r.yaw), Math.cos(target - r.yaw)) * follow;
      root.rotation.set(0, r.yaw, 0);
      const motion = speed < 0.3 ? null : speed > 2.6 ? 'run' : 'walk';
      if (motion !== r.motion) {
        r.motion = motion;
        r.c.move(motion, speed);
      }
      const brushing = cp.painting >= 0;
      r.brush.position.y = 0.62 + (brushing ? Math.sin(this.time * 18 + p) * 0.12 : 0);
      r.brush.rotation.x = brushing ? 1.2 : 0.5;
      r.ring.position.set(cp.x, 0.04, cp.z);
      r.card.position.set(cp.x, HEIGHT + 0.62, cp.z);
      r.meter.position.set(cp.x, HEIGHT + 0.32, cp.z);
      r.meter.quaternion.copy(this.camera.quaternion);
      const k = Math.max(0.001, cp.paint);
      r.fill.scale.x = k;
      r.fill.position.x = -(1 - k) * 0.28;
      r.fill.visible = cp.paint > 0.2 || Math.sin(this.time * 12) > -0.2;
      if (brushing && this.rand() < dt * 14) this.fleck(boardX(cp.painting), 0.3 + this.rand() * 0.8, y.teamOf[p] ?? 0);
    });
  }

  /** The dog: lying in a loaf, stretching, or ambling along to its next spot. */
  syncDog(y: Yard, dt: number): void {
    const d = y.dog;
    const g = this.dog;
    g.root.position.set(d.x, 0, d.z);
    const walking = d.state === 'walk';
    const face = walking ? (d.tx >= d.x ? 0 : Math.PI) : g.root.rotation.y;
    g.root.rotation.y += (face - g.root.rotation.y) * (1 - Math.exp(-dt * 8));
    if (d.state === 'nap') {
      // Curled up, breathing slowly.
      g.body.position.y = 0.2;
      g.body.rotation.z = 0;
      g.body.scale.set(1, 0.86 + Math.sin(this.time * 1.6) * 0.03, 1);
      g.head.position.set(0.55, 0.0, 0.05);
      g.head.rotation.set(0, 0, -0.25);
      for (const l of g.legs) l.visible = false;
      g.tail.rotation.z = 1.4 + Math.sin(this.time * 0.8) * 0.05;
      this.zzzIn -= dt;
      if (this.zzzIn <= 0) {
        this.zzzIn = 1.8 + this.rand();
        this.floaters.add('z', '#cfd8ff', new THREE.Vector3(d.x + 0.4, 0.8, d.z), 0.3, 1.6);
      }
    } else {
      const stretch = d.state === 'stretch';
      g.body.position.y = 0.36 + (walking ? Math.abs(Math.sin(this.time * 9)) * 0.03 : 0);
      g.body.rotation.z = stretch ? -0.25 : 0;
      g.body.scale.set(1, 1, 1);
      g.head.position.set(0.58, 0.14, 0);
      g.head.rotation.set(0, 0, stretch ? 0.4 : 0.1);
      g.legs.forEach((l, i) => {
        l.visible = true;
        l.rotation.z = walking ? Math.sin(this.time * 9 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5 : 0;
      });
      g.tail.rotation.z = 0.9 + Math.sin(this.time * 14) * 0.35;
    }
  }

  /** A fleck of paint off a brush. */
  private fleck(x: number, y: number, team: number): void {
    const m = part(this.scene, ball(0.03, 0), this.colors[team] ?? '#ffffff', x + (this.rand() - 0.5) * 0.2, y, FENCE.z + 0.1, { outline: false, shadow: false });
    this.flecks.push({ m, v: new THREE.Vector3((this.rand() - 0.5) * 1.2, 0.8 + this.rand(), 0.6 + this.rand() * 0.6), age: 0 });
  }

  /** A word over someone's head. */
  say(p: number, text: string, color: string): void {
    const r = this.rigs[p];
    if (r) this.floaters.add(text, color, new THREE.Vector3(r.c.root.position.x, HEIGHT + 1.2, r.c.root.position.z), 0.4, 1.2);
  }

  sayAt(x: number, z: number, text: string, color: string, size = 0.45): void {
    this.floaters.add(text, color, new THREE.Vector3(x, 1.4, z), size, 1.4);
  }

  dispose(): void {
    for (const r of this.rigs) {
      if (!r) continue;
      r.c.dispose();
      r.card.material.map?.dispose();
      r.card.material.dispose();
      r.meter.removeFromParent();
    }
    for (const c of this.cards) {
      c.material.map?.dispose();
      c.material.dispose();
    }
    this.floaters.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks);
    this.env.update(dt, this.time);
    for (const r of this.rigs) r?.c.update(dt);
    for (const b of this.boards) {
      if (b.shake <= 0) continue;
      b.shake = Math.max(0, b.shake - dt * 4);
      const k = 1 + Math.sin(b.shake * Math.PI) * 0.06;
      b.coat.scale.set(k, 1, 1);
      b.top.scale.set(k, 1, 0.3 * k);
    }
    this.flecks = this.flecks.filter((f) => {
      f.age += dt;
      f.v.y -= 9 * dt;
      f.m.position.addScaledVector(f.v, dt);
      if (f.age < 0.5 && f.m.position.y > 0.02) return true;
      f.m.removeFromParent();
      return false;
    });
    this.floaters.update(dt);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'paintfence',
  title: 'Paint the Fence',
  how: 'Stroll along the fence with your partner to paint the boards in your colour (you can paint over theirs). When your brush runs dry, walk back to your bucket. Mind the sleepy dog! Most boards in your colour after 35 seconds wins.',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const skill = seats.map((_, p) => (cpu(p) ? ctx.skill() : 0.5));
    const yard = newYard(teams, seats.length, rng);
    const playing = (p: number) => (yard.teamOf[p] ?? -1) >= 0;
    const colors = teams.map((members) => seats[members[0] ?? 0]?.color ?? '#ffd166');
    const companions = await Promise.all(seats.map((s, p) => (playing(p) ? buildCompanion(s.look, { height: HEIGHT }) : Promise.resolve(undefined))));
    const view = new Backyard(seats, teams, companions, colors, yard.teamOf);
    ctx.stage.setView(view);

    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'someone';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const partnerOf = (p: number) => teams[yard.teamOf[p] ?? -1]?.find((q) => q !== p);

    seats.forEach((s, p) => {
      if (!playing(p)) return;
      const partner = partnerOf(p);
      const lead = (teams[yard.teamOf[p] ?? -1]?.[0] ?? p) === p;
      const colour = lead ? 'your colour' : `${nameOf(teams[yard.teamOf[p] ?? -1]?.[0] ?? p)}'s colour`;
      session.setLayout(s.index, {
        kind: 'stick',
        button: null,
        note: partner === undefined ? 'Walk along the fence to paint it. Refill at your buckets!' : `You and ${nameOf(partner)} paint in ${colour}. Walk along the fence; refill at your buckets!`,
      });
    });

    const sticks: Stick[] = seats.map(() => ({ ...IDLE }));
    const cpus: CpuPainter[] = seats.map(() => newCpuPainter());
    const dryAt = seats.map(() => -Infinity);
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'stick' || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p === undefined || !playing(p)) return;
      sticks[p] = { x: msg.x, y: msg.y };
    });

    let strokeAt = -1;
    const show = (ev: YardEvents) => {
      if (ev.painted.length && yard.time - strokeAt > 0.09) {
        strokeAt = yard.time;
        stroke(sfx);
      }
      for (const p of ev.dry) {
        if (yard.time - (dryAt[p] ?? -Infinity) < 1) continue;
        dryAt[p] = yard.time;
        view.say(p, 'Out of paint!', '#e6e1ef');
        tell(p, false, 'Out of paint! Back to your bucket.');
        session.send(seatOf(p), { t: 'buzz', pattern: [40, 40, 40] });
      }
      for (const p of ev.filled) {
        dip(sfx);
        tell(p, true, 'Brush full. Back to the fence!');
      }
      for (const p of ev.woke) {
        yawn(sfx);
        view.sayAt(yard.dog.x, yard.dog.z, 'Yawn…', '#fff6dc');
        view.rigs[p]?.c.react('approval', 0.8);
      }
    };

    ui.caption('Stroll along the fence to paint it. Refill at your bucket!');
    let hudAt = -1;
    await everyFrame(clock, (dt) => {
      const inputs = seats.map((_, p): Stick => {
        if (!playing(p)) return IDLE;
        if (cpu(p)) return cpuStick(cpus[p] as CpuPainter, yard, p, dt, skill[p] ?? 0.5, rng);
        return sticks[p] ?? IDLE;
      });
      show(stepYard(yard, inputs, dt));
      view.syncBoards(yard);
      view.syncPeople(yard, dt);
      view.syncDog(yard, dt);
      if (yard.time - hudAt >= 0.1) {
        hudAt = yard.time;
        ui.timer(FENCE.duration - yard.time);
        ui.live(
          teams.map((members, team) => {
            const lead = seats[members[0] ?? 0];
            const n = boardsOf(yard, team);
            return { name: teamName(members), color: colors[team] ?? lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} board${n === 1 ? '' : 's'}` };
          }),
        );
      }
      return isOver(yard);
    });
    off();
    ui.timer(null);
    ui.caption(null);

    // Time! Brushes down; the pair with more of the fence admires their work.
    const counts = teams.map((_, team) => boardsOf(yard, team));
    const best = Math.max(...counts);
    const tie = teams.length > 1 && counts[0] === counts[1];
    sfx.good();
    teams.forEach((members, team) => {
      const won = counts[team] === best;
      for (const p of members) {
        const r = view.rigs[p];
        r?.c.move(null);
        r?.c.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) r?.c.react('happy', 3);
        tell(p, won, tie ? 'Time! Half the fence each.' : won ? 'Time! Most of the fence is yours!' : 'Time! Most of the fence is theirs.');
      }
      view.sayAt((team === 0 ? -1 : 1) * 4.2, FENCE.front - 0.3, `${counts[team] ?? 0} board${counts[team] === 1 ? '' : 's'}`, mix(colors[team] ?? '#fff', '#ffffff', 0.3), 0.6);
    });
    await clock.wait(1.8);

    return {
      scores: fenceScores(yard, teams, seats.length),
      details: seats.map((_, p) => {
        const team = yard.teamOf[p] ?? -1;
        const c = yard.painters[p];
        if (team < 0 || !c) return '';
        const n = counts[team] ?? 0;
        return `${n} board${n === 1 ? '' : 's'} in your colour · ${c.boards} painted by you`;
      }),
    };
  },
};
