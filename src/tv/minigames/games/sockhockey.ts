// Sock Hockey on the TV: the long hallway late at night, seen from a little above with the front wall off, like a
// doll's house. Wall lights, a radiator with socks drying on it, a coat rack, and a laundry basket tipped on its
// side in the doorway at each end. Everyone slides about in their socks after a rolled-up pair of socks.
import * as THREE from 'three';
import { type Brain, type Rink, SOCK, type SockEvents, type Stick, advance, cpuStick, isOver, newBrain, newRink, sockScores, winner } from '../../../game/minigames/sockhockey';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { preloadTextures } from '../../render/textures';
import { PALETTE as P, ball, box, cone, cyl, material, mix, nameCard, part, pill, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.1; // companions
const TILT = 0.9; // how far the camera looks down (radians)
const HX = SOCK.hall.x;
const HZ = SOCK.hall.z;
const BASKET_X = HX + 0.47; // the middle of a basket, in the doorway at each end
const BASKET_H = 1.1;
const PUFFS = 28;
const CARD_X = 4.3; // each team's name lies on the floor in front of its end of the hall
const CARD_Z = HZ + 0.55;
/** Pairs of socks, rolled up: body colour and stripes. */
const SOCKS: readonly (readonly [string, string])[] = [
  [P.ceramic, P.terracotta],
  [P.denim, P.ceramic],
  [P.mustard, P.plum],
  [P.sage, P.ceramic],
  [P.rose, P.plum],
  [P.linen, P.teal],
];
const WALL = P.clay; // the hallway's wallpaper
const TRIM = P.cream; // skirting boards, door frames, rails

// ------------------------------------------------------------------ sounds

const swish = (sfx: Sfx) => noise(sfx, { dur: 0.16, filter: 'bandpass', freq: 900, to: 2600, gain: 0.07 });
const thud = (sfx: Sfx, power: number) => {
  tone(sfx, { freq: 170 + power * 6, to: 95, dur: 0.08, gain: Math.min(0.12, 0.03 + power * 0.012) });
  noise(sfx, { dur: 0.05, filter: 'lowpass', freq: 900, to: 300, gain: Math.min(0.12, 0.02 + power * 0.012) });
};
const thwump = (sfx: Sfx) => {
  tone(sfx, { freq: 150, to: 60, dur: 0.16, gain: 0.16 });
  noise(sfx, { dur: 0.12, filter: 'lowpass', freq: 1400, to: 200, gain: 0.16 });
};
const bonk = (sfx: Sfx) => {
  noise(sfx, { dur: 0.18, filter: 'lowpass', freq: 380, to: 80, gain: 0.22 });
  tone(sfx, { freq: 120, to: 70, dur: 0.14, gain: 0.08 });
};
const tick = (sfx: Sfx, power: number) => tone(sfx, { freq: 330, to: 240, dur: 0.05, type: 'triangle', gain: Math.min(0.06, 0.015 + power * 0.006) });
const tock = (sfx: Sfx) => tone(sfx, { freq: 620, to: 520, dur: 0.09, type: 'triangle', gain: 0.07 });
const oof = (sfx: Sfx) => tone(sfx, { freq: 250, to: 170, dur: 0.12, type: 'triangle', gain: 0.07 });
const rustle = (sfx: Sfx) => {
  noise(sfx, { dur: 0.45, filter: 'bandpass', freq: 1800, to: 500, gain: 0.18 });
  tone(sfx, { freq: 523, dur: 0.14, type: 'triangle', gain: 0.07, delay: 0.1 });
  tone(sfx, { freq: 784, dur: 0.22, type: 'triangle', gain: 0.07, delay: 0.22 });
};

// ------------------------------------------------------------------ props

/** A rolled-up pair of socks: a soft woolly ball, two stripes round it and the folded cuff. */
function sockBall(body: string, stripe: string): THREE.Group {
  const g = new THREE.Group();
  const r = SOCK.puckR;
  const wool = { tex: 'knit' as const, texScale: 0.35 };
  part(g, sphere(r, 20), body, 0, 0, 0, { ...wool, sy: 0.88, outline: 0.018 });
  for (const x of [-0.07, 0.07]) part(g, torus(r * 0.93, 0.028), stripe, x, 0, 0, { ...wool, ry: Math.PI / 2, sy: 0.9, outline: false });
  part(g, torus(r * 0.55, 0.055), mix(body, P.cream, 0.3), 0, 0, r * 0.62, { ...wool, sy: 0.9, outline: 0.018 });
  return g;
}

/**
 * A wicker laundry basket tipped on its side, opening toward -x in its own space (turn it to face the hall), with a
 * rim in the team's colour and a T-shirt spilling out at the back.
 */
function basket(color: string, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const wicker = P.oak;
  const weave = mix(wicker, P.cream, 0.3);
  const W = 0.95; // half-width
  const D = 0.47; // half-depth
  const cane = { tex: 'knit' as const, texScale: 0.9, outline: 0.02 };
  part(g, rbox(0.08, BASKET_H, 2 * W, 0.03), wicker, D - 0.04, BASKET_H / 2, 0, cane);
  part(g, rbox(2 * D, 0.08, 2 * W, 0.03), wicker, 0, BASKET_H - 0.04, 0, cane);
  part(g, rbox(2 * D, 0.06, 2 * W, 0.03), mix(wicker, P.ink, 0.2), 0, 0.03, 0, cane);
  for (const z of [-1, 1]) {
    part(g, rbox(2 * D, BASKET_H, 0.08, 0.03), wicker, 0, BASKET_H / 2, z * (W - 0.04), cane);
    // Handle holes and the bands of the weave.
    part(g, rbox(0.34, 0.12, 0.02, 0.05), P.espresso, 0, BASKET_H * 0.72, z * (W + 0.005), { outline: false });
    for (const y of [0.2, 0.42, 0.95]) part(g, rbox(2 * D - 0.04, 0.04, 0.03, 0.012), weave, 0, y, z * (W + 0.006), { outline: false });
  }
  for (const z of [-0.6, -0.2, 0.2, 0.6]) part(g, rbox(2 * D - 0.06, 0.025, 0.06, 0.01), weave, 0, BASKET_H + 0.005, z, { outline: false });
  // The rim round the mouth, in the team's colour (it glows a little: this is the goal).
  const rim = { glow: 0.55, outline: false as const };
  part(g, rbox(0.1, 0.1, 2 * W + 0.06, 0.04), color, -D, BASKET_H - 0.03, 0, rim);
  part(g, rbox(0.1, 0.08, 2 * W + 0.06, 0.03), color, -D, 0.04, 0, rim);
  for (const z of [-1, 1]) part(g, rbox(0.1, BASKET_H, 0.1, 0.04), color, -D, BASKET_H / 2, z * (W - 0.02), rim);
  // A T-shirt that never made it into the wash.
  part(g, rbox(0.5, 0.12, 0.7, 0.06), [P.denim, P.mustard, P.mauve][Math.floor(rand() * 3)] as string, 0.15, 0.12, -0.35 + rand() * 0.5, { tex: 'fabric', ry: rand() - 0.5 });
  return g;
}

/** A sausage-dog draught excluder curled into a corner of the hall (it's what rounds the corners off). */
function excluder(sx: number, sz: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const cx = sx * (HX - SOCK.corner);
  const cz = sz * (HZ - SOCK.corner);
  const rad = SOCK.corner + 0.05;
  const n = 9;
  const wool = { tex: 'knit' as const, texScale: 0.4, outline: 0.02 };
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * (Math.PI / 2);
    const x = cx + Math.cos(a) * rad * sx;
    const z = cz + Math.sin(a) * rad * sz;
    part(g, sphere(0.12, 12), k % 3 === 1 ? mix(color, P.cream, 0.35) : color, x, 0.11, z, { ...wool, sy: 0.85 });
  }
  // Its head at one end, with a nose and floppy ears.
  const hx = cx + (rad - 0.05) * sx;
  const hz = cz;
  part(g, sphere(0.14, 12), color, hx, 0.16, hz - sz * 0.05, wool);
  part(g, sphere(0.04, 8), P.ink, hx - sx * 0.13, 0.17, hz - sz * 0.12, { outline: false });
  for (const e of [-1, 1]) part(g, pill(0.04, 0.1), mix(color, P.ink, 0.3), hx + e * 0.08, 0.22, hz - sz * 0.05, { rz: e * 0.5, outline: false });
  return g;
}

// ------------------------------------------------------------------ the view

interface Rig {
  c: Companion;
  ring: THREE.Mesh;
  color: string;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
  lean: number;
  face: number;
  ready: boolean;
}

interface Puff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  grow: number;
}

interface Basket {
  group: THREE.Group;
  side: number;
  wobble: number;
}

class Hallway implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly words: Floaters;
  readonly rigs: Rig[] = [];
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly baskets: Basket[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private readonly puffs: Puff[] = [];
  private puffNext = 0;
  private socks: THREE.Group;
  private socksPop = 1;
  /** How many pairs already lie in each basket (by side). */
  private readonly pile = new Map<number, number>();
  private sockKind = 0;
  private readonly roll = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private sticks: readonly Stick[] = [];
  private time = 0;
  private readonly rand = seeded(41);
  private tick: (dt: number, time: number) => void = () => {};
  private readonly wallLamps: THREE.PointLight[] = [];

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    companions: Companion[],
    private readonly rink: Rink,
  ) {
    // Late at night, the hall lights on: warm lamp light from above, plum shade.
    lightRig(this.scene, 'lampInterior', { fog: { near: 30, far: 70 }, shadowSize: 11 });
    this.words = new Floaters(this.scene);
    this.buildHall();
    this.buildFlat();
    this.tick = props.tickProps(this.scene);

    // The baskets in the doorways, in each team's colour, with the team's names over them.
    teams.forEach((members, team) => {
      const side = team === 0 ? -1 : 1;
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      const group = basket(color, this.rand);
      group.position.set(side * BASKET_X, 0, 0);
      group.rotation.y = side > 0 ? 0 : Math.PI;
      this.scene.add(group);
      this.baskets.push({ group, side, wobble: 0 });
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.1);
      card.position.set(side * CARD_X, 0.14, CARD_Z);
      this.scene.add(card);
      this.cards.push(card);
    });

    seats.forEach((s, i) => {
      const c = companions[i] as Companion;
      c.root.rotation.order = 'YXZ';
      c.setBase('idle');
      this.scene.add(c.root);
      const ring = part(this.scene, torus(0.42, 0.045), s.color, 0, 0.035, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      const sk = rink.skaters[i];
      this.rigs.push({ c, ring, color: s.color, motion: null, mood: null, lean: 0, face: sk?.face ?? 0, ready: true });
    });

    for (let k = 0; k < PUFFS; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: P.linen, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(ball(0.11, 1), mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.puffs.push({ mesh, mat, age: 1, life: 1, grow: 1 });
    }

    this.socks = this.newSockBall();

    // Keep both baskets, their names and the whole floor on screen, clear of the HUD.
    for (const sx of [-1, 1]) {
      this.marks.push({ p: new THREE.Vector3(sx * (HX + 0.95), 0, 1.1) }, { p: new THREE.Vector3(sx * (HX + 0.95), 0, -1.1) });
      this.marks.push({ p: new THREE.Vector3(sx * (CARD_X - 1.1), 0.14, CARD_Z), pad: 0.05 }, { p: new THREE.Vector3(sx * (CARD_X + 1.1), 0.14, CARD_Z), pad: 0.05 });
      this.marks.push({ p: new THREE.Vector3(sx * BASKET_X, BASKET_H + 0.3, 0) });
      for (const sz of [-1, 1]) {
        this.marks.push({ p: new THREE.Vector3(sx * (HX - 0.4), 0, sz * (HZ + 0.1)) });
        this.marks.push({ p: new THREE.Vector3(sx * (HX - 0.4), HEIGHT + 0.2, sz * (HZ - SOCK.bodyR)) });
      }
    }
    this.sync([]);
  }

  /** Floorboards, the walls (the front one cut away), lights and the bits and bobs of a hallway. */
  private buildHall(): void {
    const s = this.scene;
    const flat = { outline: false as const, shadow: false };
    // Floorboards along the hall.
    part(s, box(2 * HX + 0.6, 0.1, 2 * HZ + 0.5), P.oak, 0, -0.05, 0.05, { tex: 'woodFloor', outline: false, shadow: false });
    // Masking tape: a centre line and a circle, the way you'd mark out a rink at midnight.
    const tape = mix(P.sand, P.cream, 0.4);
    part(s, rbox(0.07, 0.008, 2 * HZ - 0.2, 0.003), tape, 0, 0.006, 0, flat);
    part(s, torus(0.75, 0.03), tape, 0, 0.008, 0, { ...flat, rx: Math.PI / 2 });
    for (const sx of [-1, 1]) {
      part(s, torus(SOCK.mouth + 0.45, 0.03, Math.PI), tape, sx * HX, 0.008, 0, { ...flat, rx: Math.PI / 2, rz: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
    part(s, torus(0.11, 0.045), tape, 1.4, 0.05, HZ - 0.25, { rx: Math.PI / 2, outline: 0.012 }); // the roll it came off

    // The back wall: wallpaper above, panelling below, a dado rail and a skirting board.
    const len = 2 * HX + 0.4;
    const paper = { tex: 'plaster' as const, outline: false as const };
    const panel = { tex: 'wood' as const, outline: false as const };
    part(s, box(len, 3.4, 0.2), WALL, 0, 1.7, -HZ - 0.1, paper);
    part(s, box(len, 0.95, 0.06), P.walnut, 0, 0.48, -HZ + 0.02, panel);
    for (let k = -6; k <= 6; k++) part(s, box(0.03, 0.8, 0.02), mix(P.walnut, P.ink, 0.3), k * 0.95, 0.5, -HZ + 0.055, flat);
    part(s, rbox(len, 0.06, 0.1, 0.02), TRIM, 0, 0.97, -HZ + 0.03, { outline: false });
    part(s, rbox(len, 0.16, 0.08, 0.02), TRIM, 0, 0.08, -HZ + 0.04, { outline: false });
    part(s, box(len + 0.2, 0.06, 0.3), mix(WALL, P.ink, 0.35), 0, 3.43, -HZ - 0.1, flat);
    // The front: cut away, just a low skirting so you can see the edge.
    part(s, rbox(len, 0.16, 0.08, 0.02), TRIM, 0, 0.08, HZ + 0.04, { outline: false });
    // The end walls, with the doorways the baskets sit in. The front stretch is cut low.
    for (const sx of [-1, 1]) {
      const x = sx * (HX + 0.1);
      const run = HZ - 0.95 + 0.2;
      part(s, box(0.2, 3.4, run), mix(WALL, P.ink, 0.08), x, 1.7, -(0.95 + run / 2), paper);
      part(s, box(0.24, 0.06, run), mix(WALL, P.ink, 0.35), x, 3.43, -(0.95 + run / 2), flat);
      part(s, rbox(0.2, 0.32, run, 0.03), mix(WALL, P.ink, 0.08), x, 0.16, 0.95 + run / 2, { tex: 'plaster', outline: false });
      part(s, rbox(0.26, 0.16, run, 0.02), TRIM, x, 0.08, -(0.95 + run / 2), { outline: false });
      // The door frame.
      part(s, rbox(0.3, 2.3, 0.1, 0.03), TRIM, x, 1.15, -1.0, { outline: 0.02 });
      part(s, rbox(0.3, 0.12, 2.1, 0.03), TRIM, x, 2.3, 0, { outline: 0.02 });
    }

    // Pictures along the back wall, and a round mirror over the radiator.
    const wall = -HZ + 0.02;
    const hang = (o: THREE.Object3D, x: number, y: number) => {
      o.position.set(x, y, wall - 0.01);
      s.add(o);
    };
    hang(props.pictureFrame({ w: 1.1, h: 0.8, art: 'hills', frame: P.walnut, seed: 3 }), -4.2, 2.1);
    hang(props.pictureFrame({ w: 0.8, h: 1.0, art: 'moon', frame: P.ceramic, seed: 5 }), 1.3, 2.15);
    hang(props.pictureFrame({ w: 0.55, h: 0.7, art: 'leaf', frame: P.brass, seed: 7 }), 0.35, 2.3);
    hang(props.pictureFrame({ w: 0.7, h: 0.9, art: 'shapes', frame: P.walnut, seed: 9 }), 4.6, 2.05);
    part(s, cyl(0.44, 0.44, 0.05, 36), P.brass, -1.6, 2.15, wall + 0.02, { rx: Math.PI / 2, gloss: 0.6 });
    part(s, cyl(0.38, 0.38, 0.02, 36), mix(P.moon, P.duskWall, 0.6), -1.6, 2.15, wall + 0.05, { rx: Math.PI / 2, gloss: 0.8, outline: false, shadow: false });

    // A radiator under the mirror, with a pair of socks drying on it.
    part(s, rbox(1.6, 0.62, 0.14, 0.04), P.ceramic, -1.6, 0.5, wall + 0.1, { gloss: 0.4 });
    for (let k = 0; k < 9; k++) part(s, rbox(0.06, 0.56, 0.17, 0.02), mix(P.ceramic, P.ink, 0.12), -2.3 + k * 0.175, 0.5, wall + 0.11, { outline: false });
    part(s, pill(0.06, 0.32), P.rose, -1.9, 0.86, wall + 0.12, { rz: Math.PI / 2, tex: 'knit', texScale: 0.3 });
    part(s, pill(0.06, 0.32), P.sage, -1.35, 0.86, wall + 0.12, { rz: Math.PI / 2 + 0.15, tex: 'knit', texScale: 0.3 });

    // A coat rack with coats, a scarf and a woolly hat; boots and an umbrella stand under it.
    part(s, rbox(1.8, 0.1, 0.06, 0.02), P.walnut, 3.0, 2.55, wall + 0.04, { tex: 'wood' });
    (
      [
        [P.denim, 2.45],
        [P.terracotta, 3.0],
        [P.olive, 3.55],
      ] as const
    ).forEach(([c, x]) => {
      part(s, cyl(0.025, 0.025, 0.12, 8), P.brass, x, 2.52, wall + 0.1, { rx: Math.PI / 2, outline: false });
      part(s, rbox(0.42, 1.1, 0.16, 0.12), c, x, 1.95, wall + 0.1, { tex: 'fabric' });
    });
    part(s, rbox(0.12, 0.8, 0.05, 0.04), P.mustard, 3.28, 2.0, wall + 0.2, { rz: 0.08, tex: 'knit', texScale: 0.3 });
    part(s, sphere(0.16, 12), P.terracotta, 2.45, 2.62, wall + 0.12, { sy: 0.8, tex: 'knit', texScale: 0.3 });
    for (const [bx, c] of [[2.6, P.forest], [2.95, P.forest]] as const) {
      part(s, rbox(0.14, 0.34, 0.16, 0.05), c, bx, 0.17, wall + 0.14, { gloss: 0.3 });
      part(s, rbox(0.14, 0.1, 0.3, 0.04), c, bx, 0.05, wall + 0.24, { gloss: 0.3 });
    }
    part(s, cyl(0.15, 0.13, 0.5, 16), P.charcoal, 4.1, 0.25, wall + 0.2, { gloss: 0.4 });
    part(s, cyl(0.02, 0.02, 0.9, 6), P.teal, 4.12, 0.6, wall + 0.2, { rz: 0.12, outline: false });
    part(s, torus(0.05, 0.015, Math.PI), P.walnut, 4.02, 1.05, wall + 0.2, { outline: false });
    const fern = props.plant({ kind: 'fern', h: 0.6, pot: P.terracotta, seed: 4 });
    fern.position.set(-4.3, 0, wall + 0.28);
    s.add(fern);

    // Three wall lights, warm and low.
    for (const x of [-3.0, 0, 3.0]) {
      part(s, rbox(0.14, 0.24, 0.05, 0.02), P.brass, x, 2.75, -HZ + 0.03, { gloss: 0.6, outline: false });
      part(s, cone(0.2, 0.28, 20), P.lamp, x, 2.85, -HZ + 0.18, { glow: 1.6, rx: Math.PI, outline: false, shadow: false });
      const lamp = new THREE.PointLight(P.lamp, 8, 8, 1.4);
      lamp.position.set(x, 2.5, -HZ + 0.5);
      s.add(lamp);
      this.wallLamps.push(lamp);
    }

    // Draught excluders curled into the corners.
    const dogs = [P.copper, P.mauve, P.terracotta, P.sage];
    let d = 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.add(excluder(sx, sz, dogs[d++ % dogs.length] as string));
  }

  /**
   * The rest of the flat, lights off, seen through the cut-away walls: the kitchen through the left doorway, a
   * bedroom through the right one, and the living room in front.
   */
  private buildFlat(): void {
    const s = this.scene;
    const flat = { outline: false as const, shadow: false };
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, scale = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      s.add(o);
      return o;
    };
    const dim = (c: string, k = 0.35) => mix(c, P.midnight, k); // the other rooms sit in the dark
    const left = -(HX + 0.2);
    const right = HX + 0.2;
    const front = HZ + 0.08;
    const back = -HZ - 0.2;
    // The floors: dark boards everywhere, tiles in the kitchen, carpet in the bedroom.
    part(s, box(60, 0.1, 44), dim(P.walnut, 0.25), 0, -0.07, 0, { tex: 'woodFloor', ...flat });
    part(s, box(6, 0.1, front - back), dim(P.linen, 0.68), left - 3, -0.055, (front + back) / 2, { tex: 'kitchenTile', ...flat });
    part(s, box(6, 0.1, front - back), dim(P.denim, 0.5), right + 3, -0.055, (front + back) / 2, { tex: 'knit', texScale: 1.2, ...flat });
    // The back wall carries on behind the kitchen and the bedroom; low cut walls divide the rest.
    for (const sx of [-1, 1]) {
      part(s, box(6, 3.4, 0.2), dim(sx < 0 ? P.sageWall : P.duskWall, 0.55), sx * (HX + 3.2), 1.7, -HZ - 0.1, { tex: 'plaster', outline: false });
      part(s, box(6.2, 0.06, 0.3), dim(P.duskWall, 0.6), sx * (HX + 3.2), 3.43, -HZ - 0.1, flat);
      part(s, rbox(6, 0.3, 0.16, 0.03), dim(WALL, 0.3), sx * (HX + 3.2), 0.15, front + 0.04, { outline: false });
    }

    // The kitchen: counter and cooker along the back, the fridge, a little table with the washing still on it.
    put(props.kitchenCounter({ w: 2.2, sink: 0.3, color: dim(P.forest, 0.3), top: dim(P.linen, 0.5) }), left - 1.7, 0, back + 0.55);
    put(props.stove({ color: dim(P.charcoal, 0.3) }), left - 3.3, 0, back + 0.55);
    put(props.fridge({ color: dim(P.ceramic, 0.6) }), left - 4.4, 0, back + 0.6);
    put(props.table({ w: 1.3, d: 0.8, h: 0.75, color: P.oak }), left - 2.4, 0, 0.7, 0.1);
    put(props.stool({ h: 0.48 }), left - 1.5, 0, 1.3);
    put(props.stool({ h: 0.48, seat: P.teal }), left - 3.3, 0, 0.5);
    const washing = new THREE.Group();
    [P.rose, P.denim, P.cream, P.mustard].forEach((c, i) => part(washing, rbox(0.42, 0.06, 0.3, 0.025), c, 0, 0.03 + i * 0.06, 0, { tex: 'fabric', ry: i * 0.2, outline: 0.012 }));
    put(washing, left - 2.5, 0.75, 0.7);
    put(props.mug({ color: P.teal }), left - 2.0, 0.75, 0.85);
    // The front door, at the far end of the kitchen: deep green, a brass knob, a little glowing window.
    part(s, rbox(0.12, 2.25, 1.3, 0.04), P.forest, left - 5.6, 1.13, 0.6, { gloss: 0.3 });
    part(s, sphere(0.06, 10), P.brass, left - 5.52, 1.05, 1.1, { gloss: 0.7, outline: false });
    part(s, rbox(0.04, 0.4, 0.5, 0.02), P.lamp, left - 5.53, 1.85, 0.6, { glow: 1.4, outline: false, shadow: false });

    // The bedroom: the corner of a bed and a night-light.
    put(props.bed({ color: dim(P.mauve, 0.15), blanket: P.mustard }), right + 1.9, 0, -0.7, 0, 1.15);
    put(props.sideTable({ h: 0.45 }), right + 0.75, 0, -1.6);
    part(s, sphere(0.09, 10), P.lamp, right + 0.75, 0.55, -1.6, { glow: 2, outline: false, shadow: false });
    put(props.rug({ w: 1.6, d: 1.0, color: dim(P.rose, 0.2), tex: 'knit' }), right + 1.6, 0, 1.2);

    // The living room in front: the back of the sofa, a rug, a lamp left on, plants, somebody's snacks.
    put(props.rug({ w: 7.5, d: 3.4, color: dim(P.plum, 0.25), border: dim(P.mauve, 0.2) }), -0.4, 0, 5.4);
    put(props.sofa({ seats: 4, color: dim(P.teal, 0.2), pillows: [P.mustard, P.terracotta, P.cream] }), -0.4, 0, 4.2, 0, 1.25);
    put(props.coffeeTable({ w: 1.7, d: 0.8 }), -0.4, 0, 5.8, 0, 1.2);
    put(props.snackBowl({ fill: 'crisps', color: P.terracotta }), -0.9, 0.5, 5.8, 0, 1.3);
    put(props.pizzaBox({ open: true, slices: 3 }), 0.1, 0.5, 5.75, 0.3, 1.2);
    put(props.floorLamp({ lit: true, light: 7 }), 2.55, 0, 3.9);
    put(props.armchair({ color: dim(P.terracotta, 0.15), pillow: P.cream }), -4.7, 0, 4.9, 0.7, 1.25);
    put(props.plant({ kind: 'monstera', h: 1.2, pot: P.ceramic, seed: 3 }), -6.9, 0, 3.6, 0, 1.2);
    put(props.plant({ kind: 'ficus', h: 1.9, pot: P.charcoal, seed: 6 }), 6.5, 0, 4.5);
    put(props.beanbag({ color: dim(P.mustard, 0.2) }), 4.6, 0, 5.3, -0.4, 1.25);
    put(props.sideboard({ w: 2.2 }), -9.0, 0, 3.1);
    put(props.recordPlayer({ playing: true }), -9.4, 0.42, 3.1);
    put(props.tableLamp({ lit: true, stand: P.brass }), -8.3, 0.42, 3.1);
    put(props.speaker({ h: 0.9 }), -10.6, 0, 3.2);
    put(props.pouf({ color: dim(P.rose, 0.15) }), -8.6, 0, 5.2, 0, 1.3);
    // Behind the back wall: the bathroom's tiles and a bath mat, just visible over the top.
    part(s, box(30, 0.1, 6), dim(P.slate, 0.6), 0, -0.058, back - 3.1, { tex: 'kitchenTile', ...flat });
  }

  private newSockBall(): THREE.Group {
    const [body, stripe] = SOCKS[this.sockKind++ % SOCKS.length] as readonly [string, string];
    const g = sockBall(body, stripe);
    g.position.set(0, SOCK.puckR * 0.88, 0);
    g.scale.setScalar(0.01);
    this.socksPop = 0;
    this.scene.add(g);
    return g;
  }

  /** Where the next pair to land in a basket comes to rest. */
  private pileSpot(side: number): { x: number; z: number } {
    const n = this.pile.get(side) ?? 0;
    return { x: side * (HX + 0.22 + (n % 2) * 0.3), z: -0.5 + (n % 3) * 0.5 };
  }

  /** The socks just scored stay in the basket; a fresh pair pops up in the middle. */
  newSocks(): void {
    const side = Math.sign(this.socks.position.x) || 1;
    const spot = this.pileSpot(side);
    this.socks.position.set(spot.x, 0.06 + SOCK.puckR * 0.88, spot.z);
    this.pile.set(side, (this.pile.get(side) ?? 0) + 1);
    this.socks = this.newSockBall();
  }

  goal(side: number, text: string, color: string): void {
    const b = this.baskets.find((x) => x.side === side);
    if (b) b.wobble = 1;
    // A burst of fluff out of the basket.
    for (let k = 0; k < 9; k++) {
      const f = this.puffs[this.puffNext++ % this.puffs.length];
      if (!f) continue;
      f.mesh.position.set(side * (HX + 0.1 - this.rand() * 0.5), 0.3 + this.rand() * 0.7, (this.rand() - 0.5) * 1.6);
      f.age = 0;
      f.life = 0.6 + this.rand() * 0.4;
      f.grow = 1 + this.rand();
      f.mesh.visible = true;
    }
    this.words.add(text, color, new THREE.Vector3(side * BASKET_X, BASKET_H + 1.0, 0), 0.7, 1.8);
  }

  head(i: number): THREE.Vector3 {
    const p = this.rigs[i]?.c.root.position.clone() ?? new THREE.Vector3();
    p.y += HEIGHT + 0.3;
    return p;
  }

  /** Dust puffs at someone's feet (a slide, a bonk). */
  puff(i: number, n = 3): void {
    const r = this.rigs[i];
    if (!r) return;
    const at = r.c.root.position;
    for (let k = 0; k < n; k++) {
      const f = this.puffs[this.puffNext++ % this.puffs.length];
      if (!f) continue;
      f.mesh.position.set(at.x + (this.rand() - 0.5) * 0.4, 0.08, at.z + (this.rand() - 0.5) * 0.4);
      f.age = 0;
      f.life = 0.45 + this.rand() * 0.3;
      f.grow = 0.6 + this.rand() * 0.8;
      f.mesh.visible = true;
    }
  }

  react(i: number, mood: CompanionMood, seconds: number): void {
    this.rigs[i]?.c.react(mood, seconds);
  }

  setBase(i: number, mood: CompanionMood): void {
    const r = this.rigs[i];
    if (!r) return;
    r.mood = mood;
    r.c.setBase(mood);
  }

  sync(sticks: readonly Stick[]): void {
    this.sticks = sticks;
  }

  dispose(): void {
    for (const r of this.rigs) r.c.dispose();
    this.words.dispose();
    for (const c of this.cards) {
      c.material.map?.dispose();
      c.material.dispose();
    }
    for (const f of this.puffs) f.mat.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks);
    this.words.update(dt);
    this.tick(dt, this.time);
    this.wallLamps.forEach((l, i) => (l.intensity = 8 * (1 + Math.sin(this.time * 6 + i * 2.1) * 0.03 + Math.sin(this.time * 13.7 + i) * 0.02)));
    const r = this.rink;

    this.rigs.forEach((rig, i) => {
      const s = r.skaters[i];
      if (!s) return;
      rig.c.update(dt);
      const root = rig.c.root;
      root.position.set(s.x, 0, s.z);
      rig.ring.position.set(s.x, 0.03, s.z);
      const speed = Math.hypot(s.vx, s.vz);
      const st = this.sticks[i];
      const pushing = st ? Math.hypot(st.x, st.y) >= SOCK.deadzone : false;
      // Turn toward where they're sliding; lean in when pushing off, more on a slide, back a touch when gliding.
      rig.face += Math.atan2(Math.sin(s.face - rig.face), Math.cos(s.face - rig.face)) * Math.min(1, dt * 9);
      const lean = s.dash > 0 ? 0.42 : pushing && r.phase !== 'drop' ? 0.08 + speed * 0.02 : speed > 1 ? -0.06 : 0;
      rig.lean += (lean - rig.lean) * Math.min(1, dt * 10);
      root.rotation.y = rig.face;
      root.rotation.x = rig.lean;
      root.rotation.z = Math.sin(this.time * 3 + i) * Math.min(0.05, speed * 0.012);
      // Feet shuffle while pushing off; gliding, they just stand there and slide.
      const motion = pushing && speed > 0.4 && r.phase !== 'drop' ? (speed > 3 ? 'run' : 'walk') : null;
      if (motion !== rig.motion) {
        rig.motion = motion;
        rig.c.move(motion, Math.max(1, speed));
      }
      if (s.dash > 0 && this.rand() < dt * 30) this.puff(i, 1);
      // The ring glows while a slide is ready.
      const ready = s.cool <= 0;
      if (ready !== rig.ready) {
        rig.ready = ready;
        rig.ring.material = material(ready ? rig.color : mix(rig.color, P.aubergine, 0.5), ready ? { glow: 1.2 } : {});
      }
      rig.ring.scale.setScalar(ready ? 1 + Math.sin(this.time * 5 + i) * 0.04 : 0.85);
    });

    // The socks roll the way they slide; after a goal they sit in the basket.
    const p = r.puck;
    const sp = Math.hypot(p.vx, p.vz);
    if (Math.abs(p.x) > HX) {
      // In the basket: tumble onto the pile.
      const spot = this.pileSpot(Math.sign(p.x));
      const f = 1 - Math.exp(-8 * dt);
      this.socks.position.x += (spot.x - this.socks.position.x) * f;
      this.socks.position.z += (spot.z - this.socks.position.z) * f;
      this.socks.position.y = 0.06 + SOCK.puckR * 0.88;
    } else {
      this.socks.position.set(p.x, SOCK.puckR * 0.88, p.z);
      if (sp > 1e-3) {
        this.axis.set(p.vz / sp, 0, -p.vx / sp);
        this.roll.setFromAxisAngle(this.axis, (sp * dt) / SOCK.puckR);
        this.socks.quaternion.premultiply(this.roll);
      }
    }
    // A fresh pair pops up with a little overshoot.
    this.socksPop = Math.min(1, this.socksPop + dt * 3);
    const u = this.socksPop - 1;
    this.socks.scale.setScalar(Math.max(0.01, 1 + 2.7 * u * u * u + 1.7 * u * u));

    for (const b of this.baskets) {
      b.wobble = Math.max(0, b.wobble - dt * 1.6);
      const w = Math.sin(b.wobble * 22) * b.wobble;
      b.group.scale.set(1 - w * 0.05, 1 + w * 0.08, 1 + w * 0.05);
    }
    for (const f of this.puffs) {
      if (!f.mesh.visible) continue;
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.mesh.visible = false;
        continue;
      }
      f.mesh.scale.setScalar(0.5 + t * f.grow);
      f.mesh.position.y += dt * 0.25;
      f.mat.opacity = 0.55 * (1 - t);
    }
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'sockhockey',
  title: 'Sock Hockey',
  how: 'Socks on, floor polished: slide about the hallway and knock the rolled-up socks into the other team’s laundry basket. Press Slide for a quick dash that hits them harder. First to 3, or the most after 40 seconds.',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const rink = newRink(teams, seats.length);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const posOf = new Map(seats.map((s, p) => [s.index, p] as const));
    const cpu = (p: number) => session.isCpu(seatOf(p));
    // Have the set's textures in before it first shows (but never wait long for them).
    const warm = Promise.race([preloadTextures('woodFloor', 'plaster', 'wood', 'knit', 'fabric', 'kitchenTile'), new Promise<void>((done) => setTimeout(done, 2000))]);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT })));
    await warm;
    const view = new Hallway(seats, rink.teams, companions, rink);
    ctx.stage.setView(view);

    const brains = new Map<number, Brain>();
    for (const p of seats.keys()) if (cpu(p)) brains.set(p, newBrain(ctx.skill(), rng));
    const held: Stick[] = seats.map(() => ({ x: 0, y: 0, a: false }));
    const latch: boolean[] = seats.map(() => false);

    const nameOf = (p: number) => seats[p]?.name ?? 'Someone';
    const teamOf = (p: number) => rink.skaters[p]?.team ?? 0;
    const teamName = (t: number) => (rink.teams[t] ?? []).map(nameOf).join(' & ');
    const teamColor = (t: number) => seats[rink.teams[t]?.[0] ?? 0]?.color ?? '#ffffff';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });

    seats.forEach((s, p) => {
      const t = teamOf(p);
      const partner = (rink.teams[t] ?? []).find((q) => q !== p);
      const way = t === 0 ? 'right' : 'left';
      session.setLayout(s.index, {
        kind: 'stick',
        button: 'Slide',
        note: partner === undefined ? `Slide the socks into the basket on the ${way}!` : `Team up with ${nameOf(partner)}: slide the socks into the basket on the ${way}!`,
      });
    });

    const off = session.onInput((seat, msg) => {
      const p = posOf.get(seat);
      if (p === undefined || msg.t !== 'stick' || cpu(p)) return;
      // A quick tap can go down and up between two frames: remember it until the physics has used it.
      if (msg.a && !held[p]?.a) latch[p] = true;
      held[p] = { x: msg.x, y: msg.y, a: msg.a };
    });

    const caption = () => ui.caption(`First to ${SOCK.toWin}! Slide the socks into the other basket.`);
    caption();
    let hudAt = -1;
    let tickAt = -1;
    const live = () =>
      ui.live(
        rink.teams.map((members, t) => {
          const lead = seats[members[0] ?? 0];
          const n = rink.score[t] ?? 0;
          return { name: teamName(t), color: teamColor(t), thumb: lead?.thumb ?? null, value: `${n} goal${n === 1 ? '' : 's'}` };
        }),
      );

    const events = (ev: SockEvents, t: number) => {
      for (const p of ev.dashes) {
        swish(sfx);
        view.puff(p, 4);
        if (!cpu(p)) buzz(p, [12]);
      }
      for (const h of ev.hits) {
        if (h.dash) {
          thwump(sfx);
          if (!cpu(h.seat)) buzz(h.seat, [25]);
        } else if (h.power > 0.8) thud(sfx, h.power);
      }
      for (const b of ev.bumps) {
        oof(sfx);
        if (b.power > 4) {
          view.react(b.a, 'thinking', 0.7);
          view.react(b.b, 'thinking', 0.7);
        }
      }
      for (const w of ev.walls) {
        bonk(sfx);
        view.puff(w.seat, 3);
        if (w.power > 4.5) {
          view.words.add('oof', '#ffffff', view.head(w.seat), 0.32, 0.9);
          view.react(w.seat, 'sad', 0.8);
        }
        if (!cpu(w.seat)) buzz(w.seat, [40]);
      }
      if (ev.puckWall > 1 && t - tickAt > 0.08) {
        tickAt = t;
        tick(sfx, ev.puckWall);
      }
      if (ev.post) tock(sfx);
      if (ev.goal) {
        const g = ev.goal;
        const color = teamColor(g.team);
        const score = `${rink.score[0]}–${rink.score[1]}`;
        rustle(sfx);
        sfx.good();
        const who = g.by !== null ? nameOf(g.by) : null;
        view.goal(g.side, g.own ? 'Oops!' : 'Goal!', color);
        ui.caption(g.own ? `Oops, into their own basket! ${score}` : who ? `${who} scores! ${score}` : `In the basket! ${score}`, color);
        seats.forEach((_, p) => {
          const mine = teamOf(p) === g.team;
          view.react(p, mine ? 'happy' : 'sad', mine ? 1.8 : 1.2);
          tell(p, mine, mine ? `Goal! ${score}` : `They scored. Shake it off! ${score}`);
          buzz(p, mine ? [30, 40, 60] : [90]);
        });
        live();
      }
      if (ev.reset) {
        view.newSocks();
        caption();
      }
      if (ev.go) sfx.tick();
    };

    await everyFrame(clock, (dt, t) => {
      const input = seats.map((_, p) => {
        const brain = brains.get(p);
        const s = brain ? cpuStick(rink, p, brain, rng) : (held[p] ?? { x: 0, y: 0, a: false });
        if (brain && s.a) latch[p] = true;
        return { x: s.x, y: s.y, a: latch[p] ?? false };
      });
      const ev = advance(rink, input, dt);
      // Presses only count once the physics has stepped with them.
      if (ev.steps > 0) latch.fill(false);
      events(ev, t);
      view.sync(input);
      if (t - hudAt > 0.1) {
        hudAt = t;
        ui.timer(Math.max(0, SOCK.duration - rink.time));
        live();
      }
      return isOver(rink);
    });
    off();
    ui.timer(null);
    live();

    // Full time.
    const win = winner(rink);
    const score = `${rink.score[0]}–${rink.score[1]}`;
    if (win < 0) {
      sfx.good();
      ui.caption(`A draw, ${score}. Socks everywhere.`);
    } else {
      sfx.win();
      const verb = (rink.teams[win]?.length ?? 0) > 1 ? 'win' : 'wins';
      ui.caption(`${teamName(win)} ${verb} ${Math.max(...rink.score)}–${Math.min(...rink.score)}!`, teamColor(win));
      view.goal(win === 0 ? -1 : 1, 'Winners!', teamColor(win));
    }
    seats.forEach((_, p) => {
      const t = teamOf(p);
      const mood: CompanionMood = win < 0 ? 'approval' : t === win ? 'happy' : 'sad';
      view.setBase(p, mood);
      if (t === win) view.react(p, 'happy', 3);
      tell(p, win < 0 || t === win, win < 0 ? `A draw, ${score}.` : t === win ? `You win, ${score}!` : `They win, ${score}. Good sliding.`);
      buzz(p, t === win ? [30, 40, 30, 40, 120] : [120]);
    });
    await clock.wait(1.8);
    ui.caption(null);

    return {
      scores: sockScores(rink),
      details: seats.map((_, p) => {
        const s = rink.skaters[p];
        if (!s) return '';
        const mine = rink.score[s.team] ?? 0;
        const theirs = rink.score[1 - s.team] ?? 0;
        const result = mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
        const own = s.goals > 0 ? ` · scored ${s.goals}` : '';
        return `${mine}–${theirs} ${result}${own}`;
      }),
    };
  },
};
