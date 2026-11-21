// Hallway Bowling on the TV: a long upstairs hallway late at night. One player rolls down it inside a sleeping bag
// (only their head pokes out); the other three stand in a triangle at the far end as pins and shuffle aside.
// The camera follows the bag down the runner rug.
import * as THREE from 'three';
import {
  BOWL,
  type BowlBrain,
  type Knock,
  type Lane,
  ballWins,
  bowlScores,
  cpuShuffle,
  cpuSteer,
  newBowlBrain,
  newLane,
  rollOver,
  startRoll,
  stepLane,
} from '../../../game/minigames/bowlingpins';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { Floaters, type Mark, frameMarks, noise, teamsOf, tone } from '../kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cyl, mix, nameCard, part, rbox, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.25; // pins
const BAG_R = BOWL.ballR;
const WALL = BOWL.halfWidth + 0.15;
const TILT = 0.5; // the camera looks down this much
const TILT_FULL = 0.7; // phone tilt that gives full steering
const FALL = 0.35; // seconds a pin takes to topple

// ------------------------------------------------------------------ sounds

function bonk(sfx: Sfx, pitch = 1): void {
  tone(sfx, { freq: 520 * pitch, to: 250 * pitch, dur: 0.14, type: 'triangle', gain: 0.16 });
  noise(sfx, { dur: 0.12, freq: 300, gain: 0.25 });
}

function thud(sfx: Sfx): void {
  noise(sfx, { dur: 0.16, freq: 140, gain: 0.12 });
}

// ------------------------------------------------------------------ the scene

interface PinRig {
  seat: number;
  c: Companion;
  ring: THREE.Mesh;
  motion: 'walk' | null;
  mood: CompanionMood | null;
  /** 0 standing, 1 flat on the floor. */
  down: number;
  fall: number;
  /** Seconds since it got back up (for the wobble), or -1. */
  wobble: number;
  /** A ring that spreads over the rug where the pin was hit. */
  wave: THREE.Mesh;
  waveMat: THREE.MeshBasicMaterial;
  waveAge: number;
  wasDown: boolean;
}

/** Takes the outlines off background dressing, so it stays quiet (and cheap to draw). */
function quiet<T extends THREE.Object3D>(o: T): T {
  const lines: THREE.Object3D[] = [];
  o.traverse((c) => {
    if (c.name === 'outline') lines.push(c);
  });
  for (const l of lines) l.removeFromParent();
  return o;
}

class Hallway implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  readonly pins: PinRig[] = [];
  readonly bag = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly probe = new THREE.PerspectiveCamera();
  private readonly look = new THREE.Vector3(0, 0, 0);
  private camReady = false;
  private readonly ballCard: THREE.Sprite;
  private tick: (dt: number, time: number) => void = () => {};
  private readonly own: { dispose(): void }[] = [];
  private squash = 0;

  constructor(
    seats: MinigameSeat[],
    readonly bowler: Companion,
    bowlerSeat: number,
    pins: { seat: number; c: Companion }[],
  ) {
    // Late evening upstairs: one warm key from above, the rooms either side in the dark.
    const rig = lightRig(this.scene, 'lampInterior', { shadowSize: 19, fog: { near: 34, far: 90 } });
    rig.sun.position.z += 10;
    rig.sun.target.position.set(0, 0, 10);
    this.build();

    // The sleeping bag: a rolled-up cylinder across the hallway, the player's head poking out of one end.
    const color = seats[bowlerSeat]?.color ?? '#7bb6ff';
    // Quilted and mixed down, with the player's own colour on the straps and the piping.
    const quilt = mix(color, P.aubergine, 0.42);
    const lining = mix(color, P.cream, 0.7);
    part(this.spin, cyl(BAG_R, BAG_R, BOWL.ballHalf * 2, 26), quilt, 0, 0, 0, { rz: Math.PI / 2, tex: 'knit', texScale: 0.7 });
    // Quilting seams round the roll, and the two straps that keep it rolled up.
    for (const x of [-0.5, -0.18, 0.18, 0.5]) part(this.spin, torus(BAG_R + 0.004, 0.014), mix(quilt, P.ink, 0.35), x, 0, 0, { ry: Math.PI / 2, outline: false, shadow: false });
    for (const x of [-0.34, 0.34]) {
      part(this.spin, cyl(BAG_R + 0.022, BAG_R + 0.022, 0.085, 26), color, x, 0, 0, { rz: Math.PI / 2, outline: false });
      part(this.spin, rbox(0.11, 0.07, 0.13, 0.02), P.brass, x, BAG_R + 0.03, 0, { gloss: 0.6, outline: false });
    }
    // The roll's spiral at each end: the pale lining.
    for (const side of [-1, 1]) {
      part(this.spin, cyl(BAG_R - 0.05, BAG_R - 0.05, 0.02, 26), mix(lining, P.ink, 0.12), side * (BOWL.ballHalf + 0.004), 0, 0, { rz: Math.PI / 2, outline: false, shadow: false });
      part(this.spin, torus(BAG_R * 0.62, 0.035), lining, side * (BOWL.ballHalf + 0.012), 0, 0, { ry: Math.PI / 2, outline: false, shadow: false });
      part(this.spin, torus(BAG_R * 0.3, 0.03), lining, side * (BOWL.ballHalf + 0.012), 0, 0, { ry: Math.PI / 2, outline: false, shadow: false });
    }
    this.bag.add(this.spin);
    // The bowler lies along the roll (head to the right), facing the camera; the bag turns round them.
    bowler.root.rotation.z = -Math.PI / 2;
    bowler.root.position.set(-0.35, 0, 0.05);
    this.bag.add(bowler.root);
    bowler.setBase('happy');
    this.scene.add(this.bag);
    this.ballCard = nameCard(seats[bowlerSeat]?.name ?? '', color, 0.7);
    this.scene.add(this.ballCard);

    for (const p of pins) {
      this.scene.add(p.c.root);
      const pinColor = seats[p.seat]?.color ?? '#ffffff';
      const ring = part(this.scene, torus(0.36, 0.045), pinColor, 0, 0.05, 0, { rx: Math.PI / 2, glow: 1.1, outline: false, shadow: false });
      p.c.setBase('listening');
      const waveMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pinColor).multiplyScalar(1.3), transparent: true, opacity: 0, depthWrite: false });
      const wave = new THREE.Mesh(torus(0.5, 0.03), waveMat);
      wave.rotation.x = Math.PI / 2;
      wave.visible = false;
      this.scene.add(wave);
      this.own.push(waveMat);
      this.pins.push({ seat: p.seat, c: p.c, ring, motion: null, mood: null, down: 0, fall: 1, wobble: -1, wave, waveMat, waveAge: 9, wasDown: false });
    }
  }

  private build(): void {
    const s = this.scene;
    const near = BOWL.start + 10;
    const far = BOWL.end - 2.6;
    const len = near - far;
    const midZ = (near + far) / 2;
    const flat = { outline: false as const, shadow: false };
    const H = 2.2; // the walls are cut off here, like a doll's house
    const wallC = mix(P.linen, P.duskWall, 0.25);
    const dado = mix(P.sageWall, P.slate, 0.3);
    const capC = mix(P.walnut, P.ink, 0.3);

    // Floorboards, and the runner rug down the middle with its woven bands.
    part(s, box(WALL * 2 + 0.4, 0.3, len), P.oak, 0, -0.15, midZ, { tex: 'woodFloor', texScale: 1.6, ...flat });
    const rugW = BOWL.halfWidth * 2 - 0.5;
    part(s, rbox(rugW, 0.03, len - 1, 0.012), mix(P.cream, P.mustard, 0.3), 0, 0.012, midZ + 0.5, { tex: 'terry', ...flat });
    part(s, rbox(rugW - 0.2, 0.034, len - 1.2, 0.012), mix(P.terracotta, P.mahogany, 0.45), 0, 0.016, midZ + 0.5, { tex: 'terry', ...flat });
    part(s, rbox(rugW - 0.62, 0.038, len - 1.6, 0.012), mix(P.terracotta, P.mahogany, 0.2), 0, 0.02, midZ + 0.5, { tex: 'terry', ...flat });
    const bands = new THREE.InstancedMesh(box(rugW - 0.9, 0.012, 0.07), new THREE.MeshBasicMaterial({ color: mix(P.mustard, P.terracotta, 0.35) }), 40);
    const diamonds = new THREE.InstancedMesh(box(0.26, 0.012, 0.26), new THREE.MeshBasicMaterial({ color: mix(P.cream, P.mustard, 0.7) }), 40);
    const m = new THREE.Matrix4();
    const turn = new THREE.Matrix4().makeRotationY(Math.PI / 4);
    let n = 0;
    for (let z = far + 2; z < near - 1 && n < 40; z += 1.6, n++) {
      bands.setMatrixAt(n, m.makeTranslation(0, 0.04, z));
      diamonds.setMatrixAt(n, m.makeTranslation(0, 0.041, z + 0.8).multiply(turn));
    }
    bands.count = diamonds.count = n;
    s.add(bands, diamonds);
    this.own.push(bands.material as THREE.Material, diamonds.material as THREE.Material);

    for (const side of [-1, 1]) {
      const x = side * (WALL + 0.15);
      part(s, box(0.3, H, len), wallC, x, H / 2, midZ, { tex: 'plaster', texScale: 3, outline: false });
      part(s, box(0.34, 0.9, len), dado, side * (WALL + 0.14), 0.45, midZ, { tex: 'plaster', texScale: 3, ...flat });
      part(s, box(0.38, 0.07, len), P.cream, side * (WALL + 0.13), 0.93, midZ, flat);
      part(s, box(0.36, 0.14, len), P.cream, side * (WALL + 0.14), 0.07, midZ, flat);
      part(s, box(0.34, 0.06, len), capC, x, H + 0.03, midZ, flat);
      // Bedroom doors along the walls, with panels and brass knobs.
      for (let z = far + 3.5; z < near - 2; z += 6.5) {
        part(s, rbox(0.1, 1.98, 1.24, 0.03), P.cream, side * (WALL - 0.01), 0.99, z, { outline: false });
        part(s, rbox(0.1, 1.86, 1.06, 0.03), P.walnut, side * (WALL - 0.04), 0.95, z, { tex: 'wood', outline: false });
        for (const y of [0.52, 1.4]) part(s, rbox(0.03, 0.68, 0.74, 0.02), mix(P.walnut, P.ink, 0.18), side * (WALL - 0.1), y, z, { tex: 'wood', ...flat });
        part(s, sphere(0.055, 10), P.brass, side * (WALL - 0.14), 0.98, z + side * 0.4, { gloss: 0.7, ...flat });
      }
      // Pictures between the doors, and little night lights by the skirting.
      let k = 0;
      for (let z = far + 6.7; z < near - 2; z += 6.5, k++) {
        const arts: props.Art[] = ['hills', 'leaf', 'moon', 'sunset', 'shapes'];
        const pic = quiet(props.pictureFrame({ w: 0.75, h: 0.58, art: arts[(k + (side > 0 ? 2 : 0)) % arts.length] as props.Art, frame: k % 2 ? P.brass : P.walnut, seed: k + 3 }));
        pic.position.set(side * (WALL - 0.005), 1.52, z);
        pic.rotation.y = -side * (Math.PI / 2);
        s.add(pic);
        part(s, rbox(0.06, 0.16, 0.12, 0.02), P.cream, side * (WALL - 0.03), 0.3, z + 1.8, flat);
        part(s, sphere(0.06, 10), P.lamp, side * (WALL - 0.08), 0.3, z + 1.8, { glow: 2.2, ...flat });
      }
    }
    // The far end: a wall with a round window on the night, and a soft pile of pillows to land in.
    part(s, box(WALL * 2 + 0.6, H + 0.2, 0.3), wallC, 0, (H + 0.2) / 2, far, { tex: 'plaster', texScale: 3, outline: false });
    part(s, box(WALL * 2 + 0.64, 0.06, 0.34), capC, 0, H + 0.23, far, flat);
    part(s, box(WALL * 2, 0.9, 0.04), dado, 0, 0.45, far + 0.16, { tex: 'plaster', texScale: 3, ...flat });
    part(s, box(WALL * 2, 0.07, 0.06), P.cream, 0, 0.93, far + 0.17, flat);
    part(s, torus(0.5, 0.06), P.cream, 0, 1.6, far + 0.17, { outline: false, shadow: false });
    part(s, cyl(0.5, 0.5, 0.04, 28), P.midnight, 0, 1.6, far + 0.16, { rx: Math.PI / 2, basic: true, shadow: false });
    part(s, box(0.03, 1.0, 0.03), P.cream, 0, 1.6, far + 0.19, flat);
    part(s, box(1.0, 0.03, 0.03), P.cream, 0, 1.6, far + 0.19, flat);
    part(s, sphere(0.13, 14), P.moon, 0.2, 1.74, far + 0.185, { glow: 2, sz: 0.2, ...flat });
    const pillows = [P.mustard, P.mauve, P.denim, P.rose, P.sage, P.cream];
    pillows.forEach((c, i) => {
      const x = -1.5 + (i % 3) * 1.5 + (i > 2 ? 0.7 : 0);
      part(s, rbox(1.2, 0.4, 0.8, 0.18), c, x, 0.2 + (i > 2 ? 0.35 : 0), far + 0.9 + (i > 2 ? 0.2 : 0), { ry: (i - 2.5) * 0.15, tex: i % 2 ? 'knit' : 'fabric' });
    });
    // Where the pins stand: little brass-rimmed dots on the rug.
    for (const [x, z] of [
      [0, 0],
      [-BOWL.spread, -BOWL.rowGap],
      [BOWL.spread, -BOWL.rowGap],
    ] as const) {
      part(s, cyl(0.22, 0.22, 0.012, 22), P.brass, x, 0.044, z, flat);
      part(s, cyl(0.17, 0.17, 0.014, 22), P.cream, x, 0.046, z, flat);
    }

    // The rest of the upstairs, seen over the walls: the rooms either side, dark and quiet, and the garden beyond.
    part(s, cyl(90, 90, 0.2, 40), mix(P.grassDark, P.midnight, 0.55), 0, -0.5, midZ, { tex: 'grass', texScale: 6, ...flat });
    const rooms = [
      [0, 2, 1, 3],
      [3, 1, 0, 2],
    ];
    [-1, 1].forEach((side, si) => {
      const x0 = WALL + 0.3;
      const x1 = x0 + 10.4;
      for (let k = 0; k < 5; k++) {
        const z0 = far - 0.15 + k * 6.5;
        this.room(side, x0, x1, z0, z0 + 6.5, (rooms[si] as number[])[k] ?? -1, k);
      }
      // the outside wall of the house, and the wall at the back
      part(s, box(0.3, H, 32.8), wallC, side * (x1 + 0.15), H / 2, far - 0.3 + 16.4, { tex: 'plaster', texScale: 3, outline: false });
      part(s, box(0.34, 0.06, 32.8), capC, side * (x1 + 0.15), H + 0.03, far - 0.3 + 16.4, flat);
      part(s, box(x1 - x0 + 0.5, H, 0.3), wallC, side * ((x0 + x1) / 2 + 0.1), H / 2, far - 0.15, { tex: 'plaster', texScale: 3, outline: false });
      part(s, box(x1 - x0 + 0.5, 0.06, 0.34), capC, side * ((x0 + x1) / 2 + 0.1), H + 0.03, far - 0.15, flat);
      // trees in the garden
      for (let i = 0; i < 6; i++) {
        const tree = quiet(props.tree({ kind: i % 3 === 1 ? 'pine' : 'round', h: 4 + ((i * 7) % 4) * 0.5, seed: i + (side > 0 ? 10 : 1) }));
        tree.position.set(side * (x1 + 2.6 + ((i * 5) % 3) * 1.4), -0.4, far - 2 + i * 5.6);
        s.add(tree);
      }
    });
    for (let i = 0; i < 9; i++) {
      const tree = quiet(props.tree({ kind: i % 2 ? 'round' : 'pine', h: 4.2 + ((i * 3) % 4) * 0.6, seed: 30 + i }));
      tree.position.set(-17 + i * 4.2, -0.4, far - 3.4 - ((i * 7) % 3) * 1.3);
      s.add(tree);
    }
    this.tick = props.tickProps(s);
  }

  /** One room off the hallway (side -1 or +1), from x0 to x1 away from the middle and z0 to z1. */
  private room(side: number, x0: number, x1: number, z0: number, z1: number, kind: number, index: number): void {
    const s = this.scene;
    const g = new THREE.Group();
    const flat = { outline: false as const, shadow: false };
    const w = x1 - x0;
    const d = z1 - z0;
    const cz = (z0 + z1) / 2;
    // local: u runs away from the hallway (0 at its wall), v along the hallway from the room's middle
    const put = <T extends THREE.Object3D>(o: T, u: number, v: number, ry = 0, k = 1.35, y = 0): T => {
      o.position.set(side * (x0 + u), y, cz + v);
      o.rotation.y = side * ry;
      o.scale.setScalar(k);
      g.add(o);
      return o;
    };
    const dim = (c: string) => mix(c, P.aubergine, 0.35);
    const floors: [string, 'woodFloor' | 'terry' | 'kitchenTile' | 'parquet' | 'knit'][] = [
      [dim(P.walnut), 'woodFloor'],
      [dim(mix(P.ceramic, P.slate, 0.55)), 'kitchenTile'],
      [dim(P.oak), 'parquet'],
      [dim(mix(P.sage, P.slate, 0.45)), 'terry'],
    ];
    const [fc, ft] = floors[kind] ?? [dim(P.walnut), 'woodFloor'];
    part(g, box(w, 0.3, d), fc, side * (x0 + w / 2), -0.16, cz, { tex: ft, texScale: ft === 'kitchenTile' ? 1.2 : 2, ...flat });
    // the wall between this room and the next one up the hallway
    part(g, box(w, 0.9, 0.2), mix(P.duskWall, P.aubergine, 0.25), side * (x0 + w / 2), 0.45, z1, { tex: 'plaster', texScale: 3, outline: false });
    part(g, box(w, 0.06, 0.24), mix(P.walnut, P.ink, 0.3), side * (x0 + w / 2), 0.93, z1, flat);
    const lit = index === 1 || index === 2;
    if (kind === 0) {
      // a bedroom
      put(props.rug({ w: 3.2, d: 2.2, color: dim(P.rose), tex: 'knit' }), 4.2, 0.6);
      put(props.bed({ color: dim(P.mauve), blanket: P.mustard }), 5.2, -d / 2 + 1.6, 0);
      put(props.sideTable({ h: 0.5 }), 3.3, -d / 2 + 0.6);
      put(props.tableLamp({ lit, light: lit ? 7 : false, stand: P.brass }), 3.3, -d / 2 + 0.6, 0, 1.35, 0.5 * 1.35);
      put(props.plant({ kind: 'monstera', h: 1.1, pot: P.ceramic }), 1.0, d / 2 - 1.0);
      put(props.bookshelf({ w: 1.4, h: 1.5, shelves: 3, seed: 5 + index }), w - 0.35, 0.6, -Math.PI / 2);
    } else if (kind === 1) {
      // the bathroom: a bath, a basin, a mat
      const bx = side * (x0 + 5.6);
      part(g, rbox(3.0, 0.85, 1.5, 0.3), P.ceramic, bx, 0.43, cz - d / 2 + 1.2, { gloss: 0.6 });
      part(g, rbox(2.6, 0.06, 1.1, 0.25), dim(P.teal), bx, 0.8, cz - d / 2 + 1.2, { gloss: 0.7, ...flat });
      part(g, cyl(0.03, 0.03, 0.4, 8), P.brass, bx - 1.3, 1.0, cz - d / 2 + 0.7, { gloss: 0.7, ...flat });
      part(g, rbox(1.1, 0.9, 0.7, 0.08), dim(P.sage), side * (x0 + 1.6), 0.45, cz + d / 2 - 0.6, {});
      part(g, rbox(1.2, 0.08, 0.8, 0.04), P.ceramic, side * (x0 + 1.6), 0.94, cz + d / 2 - 0.6, { gloss: 0.6 });
      put(props.rug({ w: 1.7, round: true, color: dim(P.mustard) }), 4.8, 0.9);
      put(props.plant({ kind: 'fern', h: 0.8, pot: P.ceramic }), w - 0.9, d / 2 - 0.9);
      put(props.stool({ h: 0.45, seat: P.cream }), 7.6, 0.3);
    } else if (kind === 2) {
      // the study: a desk, books, a beanbag
      put(props.rug({ w: 3.0, round: true, color: dim(P.teal) }), 4.6, 0.2);
      put(props.table({ w: 1.7, d: 0.8 }), 5.0, -d / 2 + 0.9, 0);
      put(props.stool({ h: 0.48 }), 5.0, -d / 2 + 2.1);
      put(props.tableLamp({ lit, light: lit ? 7 : false, stand: P.terracotta }), 5.8, -d / 2 + 0.8, 0, 1.35, 0.76 * 1.35);
      put(props.bookshelf({ w: 1.6, h: 1.5, shelves: 3, seed: 11 + index }), w - 0.35, 0.3, -Math.PI / 2);
      put(props.beanbag({ color: dim(P.mustard) }), 1.6, d / 2 - 1.4, 0.4);
      put(props.guitar(), 0.6, -d / 2 + 0.8, 0.5);
    } else if (kind === 3) {
      // the other bedroom
      put(props.rug({ w: 2.8, d: 2.0, color: dim(P.terracotta) }), 4.0, 0.5);
      put(props.bed({ color: dim(P.teal), blanket: P.rose, frame: P.oak }), 6.4, -d / 2 + 1.6, 0);
      put(props.pouf({ color: dim(P.mustard) }), 2.2, 1.2);
      put(props.plant({ kind: 'ficus', h: 1.6, pot: P.charcoal }), w - 0.9, d / 2 - 0.9);
      put(props.floorLamp({ lit, light: lit ? 8 : false }), 1.0, -d / 2 + 0.8);
      put(props.crate({ s: 0.5 }), 2.0, -d / 2 + 0.7, 0.3);
    }
    s.add(quiet(g));
  }

  /** Puts the bag and the pins where the rules have them. */
  sync(lane: Lane): void {
    const b = lane.ball;
    this.bag.position.set(b.x, BAG_R, b.z);
    this.spin.rotation.x = -b.rolled / BAG_R;
    // A bump squashes the roll for a moment.
    this.bag.scale.set(1 + this.squash * 0.1, 1 - this.squash * 0.16, 1 + this.squash * 0.06);
    this.bag.rotation.y = -b.vx * 0.08;
    this.ballCard.position.set(b.x, BAG_R * 2 + 0.55, b.z);
    for (const rig of this.pins) {
      const p = lane.pins.find((q) => q.seat === rig.seat);
      if (!p) continue;
      const root = rig.c.root;
      if (p.down) {
        const t = Math.max(0, lane.time - p.downAt - (p.chained ? 0.08 : 0));
        rig.down = Math.min(1, t / FALL);
        rig.fall = p.fall;
      }
      // Toppling: backward, and over to the side it was hit toward; a little slide as it lands.
      const k = rig.down * rig.down;
      root.position.set(p.x + rig.fall * k * 0.3, 0, p.z - k * 0.35);
      root.rotation.set(-k * 1.25, 0, -rig.fall * k * 0.55);
      rig.ring.position.set(p.x, 0.05, p.z);
      rig.ring.visible = rig.down < 0.5;
      if (p.down && !rig.wasDown) {
        rig.waveAge = 0;
        rig.wave.position.set(p.x, 0.06, p.z);
        if (!p.chained) this.squash = 1;
      }
      rig.wasDown = p.down;
      const moving = !p.down && Math.abs(p.vx) > 0.15;
      const motion = moving ? 'walk' : null;
      if (motion !== rig.motion) {
        rig.motion = motion;
        rig.c.move(motion, 0.8);
      }
      const near = b.z - p.z < 5 && b.z > p.z - 0.5;
      const mood: CompanionMood = p.down ? 'sleeping' : near ? 'thinking' : 'listening';
      if (mood !== rig.mood) {
        rig.mood = mood;
        rig.c.setBase(mood);
      }
    }
  }

  /** Pins stand back up in the triangle, wobbling. k runs 0 to 1. */
  standUp(lane: Lane, from: { x: number; down: number }[], k: number): void {
    const e = 1 - (1 - k) * (1 - k);
    lane.pins.forEach((p, i) => {
      const rig = this.pins.find((r) => r.seat === p.seat);
      const f = from[i];
      if (!rig || !f) return;
      const home = i === 0 ? 0 : i === 1 ? -BOWL.spread : BOWL.spread;
      const down = f.down * (1 - e);
      const kk = down * down;
      const x = f.x + (home - f.x) * e;
      rig.c.root.position.set(x + rig.fall * kk * 0.3, 0, p.z - kk * 0.35);
      rig.c.root.rotation.set(-kk * 1.25, 0, -rig.fall * kk * 0.55 + Math.sin(k * 22) * 0.22 * (1 - k) * (f.down > 0 ? 1 : 0.3));
      rig.ring.position.set(x, 0.05, p.z);
      rig.ring.visible = down < 0.5;
    });
  }

  resetPins(): void {
    for (const r of this.pins) {
      r.down = 0;
      r.mood = null;
      r.wasDown = false;
    }
  }

  dispose(): void {
    this.bowler.dispose();
    for (const p of this.pins) p.c.dispose();
    this.floaters.dispose();
    this.ballCard.material.map?.dispose();
    this.ballCard.material.dispose();
    for (const o of this.own) o.dispose();
  }

  /** Follows the bag down the hallway, keeping it and the pins in the picture (and clear of the HUD). */
  private frame(dt: number): void {
    const bz = this.bag.position.z;
    const marks: Mark[] = [
      { p: new THREE.Vector3(-BOWL.halfWidth, 0, -BOWL.rowGap - 0.6) },
      { p: new THREE.Vector3(BOWL.halfWidth, 0, -BOWL.rowGap - 0.6) },
      { p: new THREE.Vector3(0, HEIGHT + 0.4, 0), pad: 0.06 },
      { p: new THREE.Vector3(-BOWL.halfWidth, 0, Math.max(2.5, bz + 1)) },
      { p: new THREE.Vector3(BOWL.halfWidth, 0, Math.max(2.5, bz + 1)) },
      { p: new THREE.Vector3(this.bag.position.x, BAG_R * 2 + 0.6, Math.max(2.5, bz)), pad: 0.07 },
    ];
    this.probe.fov = this.camera.fov;
    this.probe.aspect = this.camera.aspect;
    this.probe.updateProjectionMatrix();
    const { pos, look } = frameMarks(this.probe, marks, TILT);
    const k = this.camReady ? Math.min(1, dt * 4) : 1;
    this.camReady = true;
    this.camera.position.lerp(pos, k);
    this.look.lerp(look, k);
    this.camera.lookAt(this.look);
  }

  update(dt: number, time: number): void {
    this.frame(dt);
    this.tick(dt, time);
    this.squash = Math.max(0, this.squash - dt * 5);
    for (const p of this.pins) {
      p.waveAge += dt;
      const k = p.waveAge / 0.5;
      p.wave.visible = k < 1;
      if (k < 1) {
        const e = 1 - (1 - k) * (1 - k);
        p.wave.scale.setScalar(0.6 + e * 2.2);
        p.waveMat.opacity = 0.8 * (1 - k);
      }
    }
    this.bowler.update(dt);
    for (const p of this.pins) p.c.update(dt);
    this.floaters.update(dt);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'bowlingpins',
  title: 'Hallway Bowling',
  how: 'One of you is the bowling ball, rolled up in a sleeping bag: tilt to steer down the hallway. The other three are the pins: shuffle sideways to dodge. Three rolls, and the ball wins with 5 pins or more.',
  controller: 'tilt',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const [side0, side1] = teamsOf(ctx);
    const bowler = side0?.[0] ?? 0;
    const pinSeats = (side1 ?? seats.map((_, i) => i).filter((i) => i !== bowler)).slice(0, 3);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const lane = newLane(bowler, pinSeats);
    const companions = await Promise.all(seats.map((s, i) => buildCompanion(s.look, { height: i === bowler ? 1.3 : HEIGHT })));
    const view = new Hallway(
      seats,
      companions[bowler] as Companion,
      bowler,
      pinSeats.map((seat) => ({ seat, c: companions[seat] as Companion })),
    );
    // Seats that are neither (only with odd numbers of players) just aren't in the hallway.
    companions.forEach((c, i) => {
      if (i !== bowler && !pinSeats.includes(i)) c.dispose();
    });
    ctx.stage.setView(view);

    const ballBrain: BowlBrain = newBowlBrain(cpu(bowler) ? ctx.skill() : 0.5);
    const pinBrains = new Map<number, BowlBrain>(pinSeats.filter(cpu).map((p) => [p, newBowlBrain(ctx.skill())] as const));
    let tilt = 0;
    const sticks = seats.map(() => 0);
    const off = session.onInput((seat, msg) => {
      const p = posOf.get(seat);
      if (p === undefined || session.isCpu(seat)) return;
      if (msg.t === 'tilt' && p === bowler) tilt = msg.x;
      else if (msg.t === 'stick' && pinSeats.includes(p)) sticks[p] = msg.x;
    });

    const ballName = seats[bowler]?.name ?? 'The ball';
    const live = () =>
      ui.live(
        seats.map((s, p) => {
          let value = '';
          if (p === bowler) value = `Ball · ${lane.total} / ${BOWL.need} pins`;
          else {
            const pin = lane.pins.find((q) => q.seat === p);
            if (pin) value = pin.down ? 'Knocked over' : pin.knocked === 0 ? 'Standing' : `Standing · down ${pin.knocked}×`;
          }
          return { name: s.name, color: s.color, thumb: s.thumb, value };
        }),
      );

    for (let r = 1; r <= BOWL.rolls; r++) {
      startRoll(lane);
      view.resetPins();
      view.sync(lane);
      live();
      session.setLayout(seatOf(bowler), { kind: 'tilt', title: 'You’re the bowling ball', icon: '🎳', note: 'Tilt left and right to steer down the hallway.' });
      if (!cpu(bowler)) session.send(seatOf(bowler), { t: 'feedback', good: true, text: `You’re the ball! Tilt to steer · roll ${r} of ${BOWL.rolls}` });
      for (const p of pinSeats) {
        session.setLayout(seatOf(p), { kind: 'stick', button: null, note: `You’re a pin! Shuffle left and right to dodge the sleeping bag. Roll ${r} of ${BOWL.rolls}.` });
        sticks[p] = 0;
      }
      const left = BOWL.need - lane.total;
      ui.caption(
        left > 0 ? `Roll ${r} of ${BOWL.rolls}: ${ballName} needs ${left} more pin${left === 1 ? '' : 's'}.` : `Roll ${r} of ${BOWL.rolls}: ${ballName} has enough already. Bonus pins!`,
        seats[bowler]?.color,
      );
      await clock.wait(r === 1 ? 0.8 : 1.2);
      sfx.go();
      session.send(seatOf(bowler), { t: 'buzz', pattern: [30] });

      let thudAt = 0;
      const before = lane.total;
      await everyFrame(clock, (dt) => {
        const steer = cpu(bowler) ? cpuSteer(lane, ballBrain, rng) : Math.max(-1, Math.min(1, tilt / TILT_FULL));
        const shuffle = seats.map((_, p) => (pinBrains.has(p) ? cpuShuffle(lane, p, pinBrains.get(p) as BowlBrain, rng) : (sticks[p] ?? 0)));
        const knocks: Knock[] = [];
        const n = Math.max(1, Math.ceil(dt / (1 / 120)));
        for (let i = 0; i < n && !rollOver(lane); i++) knocks.push(...stepLane(lane, steer, shuffle, dt / n));
        for (const k of knocks) {
          bonk(sfx, k.chained ? 0.85 : 1);
          const at = view.pins.find((q) => q.seat === k.seat)?.c.root.position ?? new THREE.Vector3();
          view.floaters.add(k.chained ? 'Clonk!' : 'Bonk!', seats[k.seat]?.color ?? '#ffffff', at.clone().setY(HEIGHT + 0.6), 0.45);
          session.send(seatOf(k.seat), { t: 'feedback', good: false, text: 'Knocked over! Have a little lie-down.' });
          session.send(seatOf(k.seat), { t: 'buzz', pattern: [70, 40, 70] });
          if (!cpu(bowler)) session.send(seatOf(bowler), { t: 'buzz', pattern: [25] });
        }
        if (knocks.length) live();
        if (lane.time - thudAt > 0.32) {
          thudAt = lane.time;
          thud(sfx);
        }
        view.sync(lane);
        return rollOver(lane);
      });

      // How the roll went.
      const got = lane.total - before;
      const word = got === lane.pins.length && got > 1 ? 'Strike!' : got === 0 ? 'Missed!' : `${got} pin${got === 1 ? '' : 's'}`;
      const color = got === 0 ? '#ffffff' : (seats[bowler]?.color ?? '#ffffff');
      view.floaters.add(word, color, new THREE.Vector3(0, HEIGHT + 1.2, -0.4), 0.7, 1.4);
      if (got === lane.pins.length && got > 1) sfx.fanfare();
      else if (got === 0) sfx.coin(false);
      else sfx.good();
      view.bowler.react(got === 0 ? 'sad' : 'happy', 1.2);
      for (const p of lane.pins) {
        if (cpu(p.seat) || p.down) continue;
        session.send(seatOf(p.seat), { t: 'feedback', good: true, text: 'Still standing!' });
      }
      live();
      await clock.wait(1.1);
      if (r < BOWL.rolls) {
        // Everyone wobbles back up into the triangle.
        const from = lane.pins.map((p) => ({ x: p.x, down: view.pins.find((q) => q.seat === p.seat)?.down ?? 0 }));
        await clock.tween(0.8, (k) => view.standUp(lane, from, k));
      }
    }
    off();

    // The end.
    const won = ballWins(lane);
    for (const r of view.pins) {
      r.c.move(null);
      r.motion = null;
    }
    if (won) {
      sfx.win();
      ui.caption(`${ballName} knocked over ${lane.total} pins and wins!`, seats[bowler]?.color);
      view.bowler.setBase('happy');
      for (const r of view.pins) r.c.setBase('sad');
    } else {
      sfx.win();
      ui.caption(`The pins stood their ground: only ${lane.total} down.`, seats[pinSeats[0] ?? 0]?.color);
      view.bowler.setBase('sad');
      for (const r of view.pins) r.c.react('happy', 3);
    }
    for (const s of seats) session.send(s.index, { t: 'buzz', pattern: [40, 30, 120] });
    await clock.wait(2);
    ui.caption(null);

    return {
      scores: bowlScores(lane, seats.length),
      details: seats.map((_, p) => {
        if (p === bowler) return `${lane.total} pins in ${BOWL.rolls} rolls (${lane.perRoll.join(' + ')})`;
        const pin = lane.pins.find((q) => q.seat === p);
        if (!pin) return '';
        if (pin.knocked === 0) return 'Never knocked over!';
        return `Knocked over ${pin.knocked === 1 ? 'once' : pin.knocked === 2 ? 'twice' : `${pin.knocked} times`}`;
      }),
    };
  },
};
