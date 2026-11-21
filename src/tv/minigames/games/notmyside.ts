// Not My Side on the TV: a lamp-lit living room seen from above with the front wall cut away, like a dollhouse.
// A line of tape runs down the middle; one pair owns each half, and the room is a tip. Carry the mess overhead and
// lob it over the tape until the doorbell rings.
import * as THREE from 'three';
import {
  type CpuTidier,
  IDLE,
  type Item,
  KINDS,
  MESS,
  type MessKind,
  type Room,
  type Stick,
  type Tidier,
  boostOf,
  cpuStick,
  isOver,
  isSettled,
  messOn,
  messScores,
  newCpuTidier,
  newRoom,
  ringBell,
  sideOf,
  stepRoom,
  stepSettle,
  tossAngle,
} from '../../../game/minigames/notmyside';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { preloadTextures } from '../../render/textures';
import { PALETTE as P, box, cone, cyl, material, mix, nameCard, part, pill, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.3; // companions
const TILT = 0.86; // the camera looks down this much (radians)
const WALL = 0.5; // the cut-away walls' height
const TAPE = mix(P.mustard, P.lamp, 0.45);
const ROOM_WALL = P.sageWall;
const CUSHIONS = [P.rose, P.denim, P.mustard, P.sage, P.mauve];
const CANS = [P.brick, P.denim, P.moss, P.copper];
const SOCKS = [P.terracotta, P.denim, P.moss, P.rose];
/** The garden outside sits in the dark. */
const dim = (c: string, k = 0.4) => mix(c, P.midnight, k);

// ------------------------------------------------------------------ sounds

/** Something soft landing on the floorboards. */
function thud(sfx: Sfx, big: boolean): void {
  noise(sfx, { dur: big ? 0.16 : 0.09, filter: 'lowpass', freq: big ? 420 : 900, to: 150, gain: big ? 0.32 : 0.2 });
}

/** Bouncing off the furniture. */
function tok(sfx: Sfx): void {
  tone(sfx, { freq: 330, to: 220, dur: 0.08, type: 'triangle', gain: 0.1 });
}

/** A light swish as something leaves your hands. */
function swish(sfx: Sfx): void {
  noise(sfx, { dur: 0.14, filter: 'bandpass', freq: 900, to: 2400, gain: 0.12 });
}

/** A small "hup" picking something up. */
function hup(sfx: Sfx): void {
  tone(sfx, { freq: 420, to: 620, dur: 0.08, gain: 0.08 });
}

/** A soft rising chime: second wind. */
function lift(sfx: Sfx): void {
  tone(sfx, { freq: 440, to: 660, dur: 0.25, type: 'triangle', gain: 0.08 });
  tone(sfx, { freq: 660, to: 880, dur: 0.25, type: 'triangle', gain: 0.06, delay: 0.12 });
}

/** The doorbell. */
function dingDong(sfx: Sfx): void {
  tone(sfx, { freq: 784, dur: 0.6, type: 'sine', gain: 0.22 });
  tone(sfx, { freq: 622, dur: 0.9, type: 'sine', gain: 0.22, delay: 0.42 });
}

// ------------------------------------------------------------------ the mess

/** One piece of mess, centred on its origin, lying as it lies on the floor. */
function messMesh(kind: MessKind, id: number): THREE.Group {
  const g = new THREE.Group();
  const pick = <T,>(list: readonly T[]) => list[id % list.length] as T;
  const { h } = KINDS[kind];
  switch (kind) {
    case 'cushion': {
      // A knitted scatter cushion with piping, a button and tassels at the corners.
      const c = pick(CUSHIONS);
      part(g, rbox(0.64, h, 0.64, 0.09), c, 0, 0, 0, { tex: 'knit', texScale: 0.5 });
      part(g, rbox(0.52, h + 0.015, 0.52, 0.07), mix(c, P.cream, 0.18), 0, 0, 0, { tex: 'knit', texScale: 0.5, outline: false });
      part(g, cyl(0.05, 0.05, h + 0.035, 12), mix(c, P.cream, 0.55), 0, 0, 0, { outline: false });
      for (const [x, z] of [
        [-0.3, -0.3],
        [0.3, -0.3],
        [-0.3, 0.3],
        [0.3, 0.3],
      ] as const) {
        part(g, sphere(0.045, 8), mix(c, P.ink, 0.3), x, 0, z, { outline: false });
      }
      break;
    }
    case 'pizza': {
      // Last night's pizza box: brown card, a printed lid, a grease spot.
      part(g, rbox(0.64, h, 0.64, 0.02), P.sand, 0, 0, 0, { tex: 'planks', texStrength: 0.25 });
      part(g, cyl(0.17, 0.17, 0.012, 24), P.brick, 0, h / 2 + 0.004, 0, { outline: false, shadow: false });
      part(g, cyl(0.11, 0.11, 0.014, 24), P.cream, 0, h / 2 + 0.006, 0, { outline: false, shadow: false });
      part(g, cyl(0.05, 0.05, 0.016, 12), P.brick, 0, h / 2 + 0.008, 0, { outline: false, shadow: false });
      part(g, rbox(0.66, 0.012, 0.08, 0.004), mix(P.sand, P.ink, 0.2), 0, 0, 0.29, { outline: false });
      part(g, cyl(0.06, 0.06, 0.004, 10), mix(P.sand, P.ink, 0.28), 0.2, h / 2 + 0.003, -0.18, { outline: false, shadow: false });
      break;
    }
    case 'plant': {
      part(g, cyl(0.2, 0.15, 0.3, 18), P.terracotta, 0, -h / 2 + 0.15, 0, { gloss: 0.2 });
      part(g, cyl(0.215, 0.215, 0.05, 18), mix(P.terracotta, P.ink, 0.15), 0, -h / 2 + 0.29, 0, { gloss: 0.2 });
      part(g, cyl(0.17, 0.17, 0.02, 14), P.soilDark, 0, -h / 2 + 0.31, 0, { outline: false });
      const leaves: [number, number, number, number][] = [
        [0, 0.12, 0, 0],
        [0.12, 0.05, 0.05, -0.6],
        [-0.12, 0.08, -0.04, 0.6],
        [0.02, 0.0, -0.13, 0.5],
        [-0.03, 0.02, 0.13, -0.5],
      ];
      leaves.forEach(([x, y, z, tilt], i) => part(g, cone(0.07, 0.38, 6), i % 2 ? P.fern : P.leaf, x, y, z, { rz: tilt, rx: z * 3, outline: 0.015 }));
      break;
    }
    case 'sock': {
      const c = pick(SOCKS);
      const wool = { tex: 'knit' as const, texScale: 0.3 };
      part(g, pill(0.07, 0.24), P.ceramic, 0, 0, 0, { ...wool, rz: Math.PI / 2, sy: 1, sz: 0.75 });
      part(g, pill(0.072, 0.07), c, -0.13, 0, 0, { ...wool, rz: Math.PI / 2, sz: 0.76, outline: false });
      part(g, sphere(0.08, 10), c, 0.16, 0, 0.07, { ...wool, sy: 0.75 });
      break;
    }
    case 'can': {
      const c = pick(CANS);
      part(g, cyl(0.11, 0.11, h, 20), c, 0, 0, 0, { gloss: 0.6 });
      part(g, cyl(0.112, 0.112, 0.07, 20), P.cream, 0, 0.02, 0, { outline: false });
      part(g, cyl(0.09, 0.105, 0.02, 20), P.stone, 0, h / 2 + 0.01, 0, { gloss: 0.7, outline: false });
      part(g, cyl(0.105, 0.09, 0.02, 20), P.stone, 0, -h / 2 - 0.01, 0, { gloss: 0.7, outline: false });
      break;
    }
  }
  return g;
}

// ------------------------------------------------------------------ the scene

interface Rig {
  c: Companion;
  ring: THREE.Mesh;
  aim: THREE.Group;
  card: THREE.Sprite;
  color: string;
  motion: 'walk' | 'run' | null;
  yaw: number;
  hop: number;
}

interface Thing {
  mesh: THREE.Group;
  /** Rest yaw on the floor. */
  yaw: number;
  spin: THREE.Vector3;
  big: boolean;
  plant: boolean;
  /** In the air a moment ago (so it squashes when it lands). */
  flew: boolean;
  squash: number;
}

interface Puff {
  m: THREE.Mesh;
  age: number;
  vx: number;
  vz: number;
}

class LivingRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly floaters: Floaters;
  readonly rigs: (Rig | undefined)[] = [];
  private readonly things = new Map<number, Thing>();
  private readonly fit: CameraFit;
  private readonly marks: Mark[];
  private readonly cards: THREE.Sprite[] = [];
  private readonly chairs: { g: THREE.Group; jiggle: number }[] = [];
  private puffs: Puff[] = [];
  private time = 0;
  private readonly rand = seeded(61);
  private tick: (dt: number, time: number) => void = () => {};

  constructor(seats: MinigameSeat[], teams: number[][], companions: (Companion | undefined)[], room: Room) {
    // Late evening, the lamps on: warm light from above, plum shade, the garden outside in the dark.
    lightRig(this.scene, 'lampInterior', { fog: { near: 30, far: 90 }, shadowSize: 13 });
    this.floaters = new Floaters(this.scene);
    this.build(seats, teams, room);
    this.garden();
    this.tick = props.tickProps(this.scene);

    seats.forEach((seat, p) => {
      const c = companions[p];
      if (!c) return;
      c.setBase('listening');
      this.scene.add(c.root);
      const ring = part(this.scene, torus(0.5, 0.045), seat.color, 0, 0.05, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      const aim = new THREE.Group();
      part(aim, cone(0.15, 0.38, 3), seat.color, 0, 0, 0, { rx: Math.PI / 2, sz: 0.25, glow: 1.4, outline: false, shadow: false });
      this.scene.add(aim);
      const card = nameCard(seat.name, seat.color, 0.85);
      this.scene.add(card);
      this.rigs[p] = { c, ring, aim, card, color: seat.color, motion: null, yaw: 0, hop: 0 };
    });

    for (const it of room.items) {
      const mesh = messMesh(it.kind, it.id);
      const yaw = this.rand() * Math.PI * 2;
      mesh.rotation.y = yaw;
      this.scene.add(mesh);
      this.things.set(it.id, {
        mesh,
        yaw,
        spin: new THREE.Vector3(),
        big: KINDS[it.kind].big,
        plant: it.kind === 'plant',
        flew: false,
        squash: 0,
      });
    }

    const { x, z } = MESS.half;
    this.marks = [
      ...[-x - 0.3, x + 0.3].flatMap((mx) => [
        { p: new THREE.Vector3(mx, 0, z + 0.4), pad: 0.02 },
        { p: new THREE.Vector3(mx, WALL, -z - 0.3), pad: 0.02 },
        { p: new THREE.Vector3(mx * 0.85, MESS.holdY + 0.5, -z), pad: 0.05 },
      ]),
      { p: new THREE.Vector3(0, 0, z + 0.9), pad: 0.05 },
    ];
    this.fit = new CameraFit(this.camera, TILT);
  }

  /** Floorboards, cut-away walls, a sofa and windows at the back, the tape, the rugs and the furniture. */
  private build(seats: MinigameSeat[], teams: number[][], room: Room): void {
    const s = this.scene;
    const { x: hx, z: hz } = MESS.half;
    const flat = { outline: false as const, shadow: false };
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, scale = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      s.add(o);
      return o;
    };
    // Floorboards, back to the wall.
    const back = -hz - 1.3;
    const depth = hz + 0.3 - back;
    part(s, box(hx * 2 + 0.4, 0.08, depth), P.oak, 0, -0.04, (back + hz + 0.3) / 2, { tex: 'woodFloor', ...flat });
    // Cut-away walls: low at the sides and the front, full height at the back; the cut edges are dark.
    const plaster = { tex: 'plaster' as const, outline: false as const };
    const cut = mix(ROOM_WALL, P.ink, 0.45);
    part(s, box(hx * 2 + 0.8, 3.2, 0.2), ROOM_WALL, 0, 1.6, back, plaster);
    part(s, box(hx * 2 + 0.84, 0.05, 0.24), cut, 0, 3.22, back, flat);
    part(s, box(hx * 2 + 0.4, 0.9, 0.04), mix(ROOM_WALL, P.ink, 0.22), 0, 0.45, back + 0.12, plaster);
    part(s, box(hx * 2 + 0.4, 0.05, 0.06), P.cream, 0, 0.92, back + 0.13, flat);
    for (const side of [-1, 1]) {
      part(s, box(0.2, WALL, depth + 0.2), mix(ROOM_WALL, P.ink, 0.1), side * (hx + 0.3), WALL / 2, (back + hz + 0.3) / 2, plaster);
      part(s, box(0.22, 0.03, depth + 0.22), cut, side * (hx + 0.3), WALL + 0.012, (back + hz + 0.3) / 2, flat);
    }
    part(s, box(hx * 2 + 0.8, WALL * 0.6, 0.2), mix(ROOM_WALL, P.ink, 0.1), 0, WALL * 0.3, hz + 0.3, plaster);
    part(s, box(hx * 2 + 0.82, 0.03, 0.22), cut, 0, WALL * 0.6 + 0.012, hz + 0.3, flat);
    // Two windows behind the sofa with the night outside, pictures between them, lights strung along the top.
    for (const side of [-1, 1]) {
      put(props.windowFrame({ w: 1.8, h: 1.25, time: 'night', seed: side > 0 ? 3 : 8 }), side * 3.6, 2.2, back + 0.11);
      put(props.curtains({ w: 1.8, h: 1.3, color: mix(P.terracotta, P.cream, 0.3), open: 0.85 }), side * 3.6, 2.2, back + 0.11);
    }
    put(props.pictureFrame({ w: 1.0, h: 0.75, art: 'sunset', frame: P.walnut, seed: 2 }), -0.75, 2.3, back + 0.11);
    put(props.pictureFrame({ w: 0.55, h: 0.75, art: 'leaf', frame: P.brass, seed: 6 }), 0.45, 2.3, back + 0.11);
    put(props.wallClock({ r: 0.22 }), 1.3, 2.45, back + 0.11);
    put(props.wallShelf({ w: 1.2, seed: 4 }), -5.9, 2.2, back + 0.11);
    put(props.wallShelf({ w: 1.2, seed: 9 }), 5.9, 2.2, back + 0.11);
    for (let i = 0; i < 4; i++) {
      const x0 = -hx + (i * hx) / 2;
      s.add(props.stringLights(new THREE.Vector3(x0, 3.02, back + 0.14), new THREE.Vector3(x0 + hx / 2, 3.02, back + 0.14), { sag: 0.14, count: 8 }));
    }
    // The sofa along the back wall (the tape goes right over it), low cupboards either side.
    const sz = -hz - 0.72;
    put(props.sofa({ seats: 6, color: P.denim, pillows: [P.mustard, P.terracotta, P.cream, P.rose], seatW: 0.82 }), 0, 0, sz, 0, 1.05);
    part(s, box(0.2, 0.02, 0.76), TAPE, 0, 0.64, sz + 0.1, flat);
    for (const side of [-1, 1]) {
      const cx = side * 5.0;
      put(props.sideboard({ w: 3.3, h: 0.7, d: 0.8 }), cx, 0, sz);
      // A table lamp, a few books and a plant on top.
      put(props.tableLamp({ lit: true, light: 6, stand: P.brass }), cx + side * 1.1, 0.7, sz, 0, 1.3);
      put(props.books(0.5, side > 0 ? 5 : 9, { h: 0.34, d: 0.26 }), cx - side * 0.4 - 0.25, 0.7, sz - 0.1);
      put(props.plant({ kind: side > 0 ? 'fern' : 'trailing', h: 0.4, pot: P.ceramic, seed: 3 }), cx - side * 1.2, 0.7, sz);
    }
    // The tape down the middle, and the roll it came off.
    part(s, box(0.22, 0.02, hz * 2 + 0.4), TAPE, 0, 0.012, 0, flat);
    part(s, torus(0.12, 0.05), TAPE, 0.6, 0.06, hz + 0.02, { rx: Math.PI / 2, outline: 0.015 });
    // Each half: a rug in a deep shade of the pair's colour, with the colour itself on its border.
    teams.forEach((members, team) => {
      const lead = seats[members[0] ?? 0];
      const color = lead?.color ?? P.mustard;
      const side = -sideOf(team);
      const rug = { tex: 'terry' as const, ...flat };
      part(s, rbox(4.6, 0.03, 3.6, 0.02), mix(color, P.aubergine, 0.25), side * 3.4, 0.012, 0.2, rug);
      part(s, rbox(4.36, 0.03, 3.36, 0.02), mix(color, P.aubergine, 0.7), side * 3.4, 0.018, 0.2, rug);
      part(s, rbox(3.5, 0.03, 2.5, 0.02), mix(color, P.aubergine, 0.78), side * 3.4, 0.022, 0.2, rug);
      const card = nameCard(`${members.map((p) => seats[p]?.name ?? '').join(' & ')}`, color, 1.0);
      card.position.set(side * 3.4, 0.25, MESS.half.z + 0.75);
      this.scene.add(card);
      this.cards.push(card);
    });
    room.furniture.forEach((f, i) => {
      const g = new THREE.Group();
      if (f.h > 0.7) {
        // An armchair, facing the middle of the room.
        const c = P.clay;
        const velvet = { tex: 'velvet' as const };
        part(g, rbox(f.hx * 2, 0.45, f.hz * 2, 0.1), mix(c, P.ink, 0.12), 0, 0.32, 0, velvet);
        part(g, rbox(f.hx * 2, f.h - 0.1, 0.25, 0.1), c, 0, (f.h - 0.1) / 2 + 0.05, -f.hz + 0.12, velvet);
        for (const side of [-1, 1]) part(g, rbox(0.22, 0.65, f.hz * 2, 0.08), c, side * (f.hx - 0.11), 0.4, 0, velvet);
        part(g, rbox(f.hx * 2 - 0.5, 0.12, f.hz * 2 - 0.35, 0.05), mix(c, P.cream, 0.2), 0, 0.6, 0.08, velvet);
        for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) part(g, cyl(0.04, 0.03, 0.1, 8), P.walnut, sx * (f.hx - 0.1), 0.05, sz2 * (f.hz - 0.1), { outline: false });
      } else {
        // A coffee table with a mug and a remote on it.
        part(g, rbox(f.hx * 2, 0.08, f.hz * 2, 0.04), P.walnut, 0, f.h - 0.04, 0, { tex: 'wood' });
        part(g, rbox(f.hx * 2 - 0.3, 0.03, f.hz * 2 - 0.25, 0.01), mix(P.walnut, P.ink, 0.25), 0, f.h * 0.4, 0, { tex: 'wood', outline: false });
        for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) part(g, cyl(0.04, 0.035, f.h - 0.08, 8), mix(P.walnut, P.ink, 0.25), sx * (f.hx - 0.1), (f.h - 0.08) / 2, sz2 * (f.hz - 0.1), { outline: false });
        const mug = props.mug({ color: i % 2 ? P.teal : P.terracotta });
        mug.position.set(0.25, f.h, 0.05);
        mug.scale.setScalar(1.5);
        const remote = props.remote();
        remote.position.set(-0.2, f.h, -0.08);
        remote.rotation.y = 0.4;
        remote.scale.setScalar(1.5);
        g.add(mug, remote);
      }
      g.position.set(f.x, 0, f.z);
      s.add(g);
      this.chairs.push({ g, jiggle: 0 });
    });
  }

  /** Outside the cut-away walls: the garden at night, the path up to the front door, trees over the back wall. */
  private garden(): void {
    const s = this.scene;
    const { x: hx, z: hz } = MESS.half;
    const flat = { outline: false as const, shadow: false };
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, scale = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      s.add(o);
      return o;
    };
    const back = -hz - 1.3;
    part(s, cyl(60, 60, 0.2, 40), dim(P.grassDark, 0.5), 0, -0.16, 0, { tex: 'grass', texScale: 5, ...flat });
    // A paved strip along the front of the house and the path to the door, where the bell will ring.
    part(s, box(hx * 2 + 3, 0.06, 1.5), dim(P.stone, 0.68), 0, -0.05, hz + 1.2, { tex: 'stoneTiles', ...flat });
    part(s, box(1.8, 0.06, 6), dim(P.stone, 0.62), 4.6, -0.05, hz + 4.6, { tex: 'cobble', ...flat });
    part(s, rbox(1.1, 0.03, 0.6, 0.02), dim(P.terracotta, 0.3), 4.6, -0.005, hz + 0.95, { tex: 'terry', ...flat });
    // Flower beds and bushes along the front, lamps by the path.
    put(props.gardenLamp({ h: 0.7, lit: true, light: 5 }), 3.4, 0, hz + 2.4);
    put(props.gardenLamp({ h: 0.7, lit: true }), 5.8, 0, hz + 2.4);
    put(props.gardenLamp({ h: 0.7, lit: true, light: 5 }), -6.4, 0, hz + 2.3);
    put(props.bush({ r: 0.6, color: dim(P.fern, 0.3), flowers: P.rose, seed: 3 }), -3.2, 0, hz + 2.7);
    put(props.bush({ r: 0.45, color: dim(P.moss, 0.3), seed: 7 }), -2.2, 0, hz + 3.1);
    put(props.bush({ r: 0.7, color: dim(P.fern, 0.3), flowers: P.cream, seed: 5 }), 0.6, 0, hz + 3.3);
    put(props.bush({ r: 0.5, color: dim(P.moss, 0.3), flowers: P.mustard, seed: 9 }), 7.4, 0, hz + 3.0);
    put(props.rock({ r: 0.35, seed: 4 }), 1.7, 0, hz + 2.8);
    put(props.hedge({ w: 5.5, h: 0.9, d: 0.7, color: dim(P.leafDark, 0.25), seed: 4 }), -6.6, 0, hz + 4.6);
    for (let i = 0; i < 26; i++) {
      const tx = -13 + ((i * 7.3) % 24);
      const tz = hz + 2.2 + ((i * 3.7) % 3.6);
      if (Math.abs(tx - 4.6) < 1.3) continue;
      put(props.tuft({ seed: i + 1, color: dim(P.grassDark, 0.2), ...(i % 3 === 0 ? { flowers: [P.rose, P.cream, P.mustard][i % 3] as string } : {}), s: 1.2 }), tx, 0, tz, i);
    }
    // Down the sides: the neighbour's fence, trees and a bench on the left; the bins and a bike shed on the right.
    put(props.fence({ w: 16, kind: 'panel', color: dim(P.wood, 0.3) }), -hx - 4.6, 0, 1, Math.PI / 2);
    put(props.tree({ kind: 'round', h: 3.6, color: dim(P.leaf, 0.3), seed: 3 }), -hx - 3.0, 0, -2.6);
    put(props.tree({ kind: 'birch', h: 4.0, color: dim(P.moss, 0.3), seed: 5 }), -hx - 2.4, 0, 2.4);
    put(props.bush({ r: 0.7, color: dim(P.fern, 0.3), flowers: P.mauve, seed: 11 }), -hx - 1.5, 0, -0.4);
    put(props.logSeat({ len: 1.6 }), -hx - 1.6, 0, 1.0, Math.PI / 2);
    put(props.bush({ r: 0.6, color: dim(P.fern, 0.3), seed: 13 }), hx + 1.3, 0, -1.4);
    put(props.tree({ kind: 'round', h: 3.2, color: dim(P.leaf, 0.3), seed: 8 }), hx + 2.6, 0, 1.6);
    put(props.crate({ s: 0.6 }), hx + 1.1, 0, 1.0, 0.3);
    // Over the back wall: the tops of the trees behind the house.
    const kinds: props.TreeKind[] = ['round', 'pine', 'round', 'birch', 'round', 'pine'];
    kinds.forEach((kind, i) => put(props.tree({ kind, h: 4.6 + (i % 3) * 0.7, color: dim(kind === 'pine' ? P.pine : P.leaf, 0.3), seed: i + 2 }), -11 + i * 4.4, 0, back - 2.2 - (i % 2) * 1.2));
  }

  /** Puts everyone where the rules say, facing where they face. The messier side's rings glow with its second wind. */
  syncPeople(room: Room, dt: number): void {
    const follow = 1 - Math.exp(-dt * 14);
    const boosts = [boostOf(room, 0), boostOf(room, 1)];
    room.tidiers.forEach((cp: Tidier, p) => {
      const r = this.rigs[p];
      const team = room.teamOf[p] ?? -1;
      if (!r || team < 0) return;
      const root = r.c.root;
      r.hop = Math.max(0, r.hop - dt * 4);
      root.position.set(cp.x, Math.sin(r.hop * Math.PI) * 0.1, cp.z);
      const target = Math.atan2(cp.fx, cp.fz);
      r.yaw += Math.atan2(Math.sin(target - r.yaw), Math.cos(target - r.yaw)) * follow;
      root.rotation.set(0, r.yaw, 0);
      const speed = Math.hypot(cp.vx, cp.vz);
      const motion = room.rung || speed < 0.35 ? null : speed > 2.9 ? 'run' : 'walk';
      if (motion !== r.motion) {
        r.motion = motion;
        r.c.move(motion, speed);
      }
      r.ring.position.set(cp.x, 0.04, cp.z);
      const wind = room.rung ? 0 : (boosts[team] ?? 0) / MESS.catchUp.max;
      r.ring.material = material(r.color, { glow: 1.1 + Math.round(wind * 4) * 0.3 });
      r.ring.scale.setScalar(1 + wind * (0.12 + Math.sin(this.time * 8 + p) * 0.06));
      // A little dust kicked up behind someone with their second wind.
      if (wind > 0.2 && speed > 1.5 && this.rand() < dt * 10 * wind) this.trail(cp.x - cp.vx * 0.08, cp.z - cp.vz * 0.08);
      // The toss arrow shows only while carrying something.
      r.aim.visible = cp.holding >= 0 && !room.rung;
      if (r.aim.visible) {
        const a = tossAngle(room, p);
        const dx = sideOf(team) * Math.cos(a);
        const dz = Math.sin(a);
        r.aim.position.set(cp.x + dx * 0.85, 0.05, cp.z + dz * 0.85);
        r.aim.rotation.set(0, Math.atan2(dx, dz), 0);
      }
      r.card.position.set(cp.x, HEIGHT + (cp.holding >= 0 ? 0.95 : 0.42), cp.z);
    });
  }

  /** Moves every piece of mess to where it is: on the floor, overhead or tumbling through the air. */
  syncMess(room: Room, dt: number): void {
    for (const it of room.items) {
      const th = this.things.get(it.id);
      if (!th) continue;
      const { h } = KINDS[it.kind];
      const m = th.mesh;
      if (it.state === 'held') {
        m.position.set(it.x, MESS.holdY + h / 2 + Math.sin(this.time * 7 + it.id) * 0.03, it.z);
        m.rotation.set(Math.sin(this.time * 5 + it.id) * 0.08, th.yaw, 0);
        th.spin.set(0, 0, 0);
        th.flew = false;
        th.squash = 0;
        m.scale.setScalar(1);
        continue;
      }
      m.position.set(it.x, it.y + h / 2, it.z);
      // Whatever lands squashes and settles.
      if (it.state === 'air') th.flew = true;
      else if (th.flew) {
        th.flew = false;
        th.squash = 1;
      }
      th.squash = Math.max(0, th.squash - dt / 0.28);
      const sq = Math.sin(th.squash * Math.PI * 1.5) * th.squash * 0.28;
      m.scale.set(1 + sq, 1 - sq, 1 + sq);
      if (it.state === 'air') {
        if (th.spin.lengthSq() === 0) th.spin.set((this.rand() - 0.5) * 12, (this.rand() - 0.5) * 6, (this.rand() - 0.5) * 12);
        m.rotation.x += th.spin.x * dt;
        m.rotation.y += th.spin.y * dt;
        m.rotation.z += th.spin.z * dt;
      } else {
        th.spin.set(0, 0, 0);
        // Settle flat: the nearest way up (a plant always the right way up).
        const unit = th.plant ? Math.PI * 2 : Math.PI;
        const k = 1 - Math.exp(-dt * 16);
        m.rotation.x += (Math.round(m.rotation.x / unit) * unit - m.rotation.x) * k;
        m.rotation.z += (Math.round(m.rotation.z / unit) * unit - m.rotation.z) * k;
        if (it.vx !== 0 || it.vz !== 0) m.rotation.y += Math.hypot(it.vx, it.vz) * dt * 2;
      }
    }
  }

  /** A little cloud of dust where something landed. */
  puff(x: number, z: number, big: boolean): void {
    const n = big ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand();
      const m = part(this.scene, sphere(big ? 0.09 : 0.06, 8), P.linen, x, 0.08, z, { opacity: 0.7, outline: false, shadow: false });
      this.puffs.push({ m, age: 0, vx: Math.cos(a) * 0.9, vz: Math.sin(a) * 0.9 });
    }
  }

  /** One small puff of dust at someone's heels. */
  private trail(x: number, z: number): void {
    const m = part(this.scene, sphere(0.05, 8), P.linen, x, 0.06, z, { opacity: 0.7, outline: false, shadow: false });
    this.puffs.push({ m, age: 0, vx: (this.rand() - 0.5) * 0.4, vz: (this.rand() - 0.5) * 0.4 });
  }

  jiggle(k: number): void {
    const c = this.chairs[k];
    if (c) c.jiggle = 1;
  }

  hop(p: number): void {
    const r = this.rigs[p];
    if (r) r.hop = 1;
  }

  /** A word over someone's head. */
  say(p: number, text: string, color: string): void {
    const r = this.rigs[p];
    if (r) this.floaters.add(text, color, new THREE.Vector3(r.c.root.position.x, HEIGHT + 1.15, r.c.root.position.z), 0.45, 1.2);
  }

  /** A word over a team's half. */
  sayHalf(team: number, text: string, color: string, life = 2.4): void {
    this.floaters.add(text, color, new THREE.Vector3(-sideOf(team) * 3.4, 2.2, 0), 0.6, life);
  }

  dispose(): void {
    for (const r of this.rigs) {
      if (!r) continue;
      r.c.dispose();
      r.card.material.map?.dispose();
      r.card.material.dispose();
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
    for (const r of this.rigs) r?.c.update(dt);
    this.tick(dt, this.time);
    for (const c of this.chairs) {
      c.jiggle = Math.max(0, c.jiggle - dt * 3);
      c.g.rotation.z = Math.sin(c.jiggle * 20) * c.jiggle * 0.05;
    }
    this.puffs = this.puffs.filter((p) => {
      p.age += dt;
      p.m.position.x += p.vx * dt;
      p.m.position.z += p.vz * dt;
      p.m.position.y += dt * 0.3;
      p.m.scale.setScalar(Math.max(0.01, 1 - p.age / 0.5));
      if (p.age < 0.5) return true;
      p.m.removeFromParent();
      return false;
    });
    this.floaters.update(dt);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'notmyside',
  title: 'Not My Side',
  how: 'The room is a tip and the tape down the middle says whose half is whose. Walk to some mess and press Toss to pick it up, then Toss again to lob it over the tape. The messier side gets a second wind. When the doorbell rings, the tidier side wins (big things count double).',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const skill = seats.map((_, p) => (cpu(p) ? ctx.skill() : 0.5));
    const room = newRoom(teams, seats.length, rng);
    const playing = (p: number) => (room.teamOf[p] ?? -1) >= 0;
    // Have the set's textures in before it first shows (but never wait long for them).
    const warm = Promise.race([preloadTextures('woodFloor', 'plaster', 'terry', 'velvet', 'wood', 'knit', 'grass', 'fabric'), new Promise<void>((done) => setTimeout(done, 2000))]);
    const companions = await Promise.all(seats.map((s, p) => (playing(p) ? buildCompanion(s.look, { height: HEIGHT }) : Promise.resolve(undefined))));
    await warm;
    const view = new LivingRoom(seats, teams, companions, room);
    ctx.stage.setView(view);

    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'someone';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const partnerOf = (p: number) => teams[room.teamOf[p] ?? -1]?.find((q) => q !== p);
    const colorOf = (team: number) => seats[teams[team]?.[0] ?? 0]?.color ?? '#fff';

    seats.forEach((s, p) => {
      if (!playing(p)) return;
      const partner = partnerOf(p);
      const side = room.teamOf[p] === 0 ? 'left' : 'right';
      session.setLayout(s.index, {
        kind: 'stick',
        button: 'Toss',
        note: partner === undefined ? `The ${side} half is yours. Toss the mess over the tape!` : `You and ${nameOf(partner)} share the ${side} half. Toss the mess over the tape!`,
      });
    });

    const sticks: Stick[] = seats.map(() => ({ ...IDLE }));
    /** A press that came and went within one frame still counts. */
    const tapped = seats.map(() => false);
    const cpus: CpuTidier[] = seats.map(() => newCpuTidier());
    const whiffAt = seats.map(() => -Infinity);
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'stick' || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p === undefined || !playing(p)) return;
      sticks[p] = { x: msg.x, y: msg.y, a: msg.a };
      if (msg.a) tapped[p] = true;
    });

    const landed = (item: Item, half: number) => {
      const big = KINDS[item.kind].big;
      thud(sfx, big);
      view.puff(item.x, item.z, big);
      const team = room.teamOf[item.thrower] ?? -1;
      if (team < 0 || room.rung) return;
      const color = seats[item.thrower]?.color ?? '#fff';
      const at = new THREE.Vector3(item.x, 0.9, item.z);
      if (half !== team) view.floaters.add(big ? '+2' : '+1', color, at, 0.4, 0.9);
      else view.floaters.add('Short!', '#e6e1ef', at, 0.36, 0.9);
    };
    const show = (ev: ReturnType<typeof stepRoom>) => {
      for (const { p } of ev.picked) {
        hup(sfx);
        view.hop(p);
        session.send(seatOf(p), { t: 'buzz', pattern: [15] });
      }
      if (ev.thrown.length) swish(sfx);
      for (const { p } of ev.thrown) view.hop(p);
      let bumped = false;
      for (const { furniture } of ev.bumped) {
        if (furniture >= 0) view.jiggle(furniture);
        bumped = true;
      }
      if (bumped) tok(sfx);
      for (const { item, half } of ev.landed) landed(item, half);
      for (const p of ev.whiffs) {
        if (room.time - (whiffAt[p] ?? -Infinity) < 2) continue;
        whiffAt[p] = room.time;
        tell(p, false, 'Nothing in reach. Get closer!');
      }
    };

    ui.caption('Toss picks up, Toss again lobs it over the tape!');
    let hudAt = -1;
    let warned = false;
    /** When each side last heard it had its second wind. */
    const windAt = teams.map(() => -Infinity);
    const secondWind = () => {
      teams.forEach((members, team) => {
        if (boostOf(room, team) < MESS.catchUp.max * 0.6 || room.time - (windAt[team] ?? -Infinity) < 9) return;
        windAt[team] = room.time;
        lift(sfx);
        view.sayHalf(team, 'Second wind!', mix(colorOf(team), '#ffffff', 0.35), 1.6);
        for (const p of members) if (!cpu(p)) tell(p, true, 'Second wind! Your side is a bit quicker now.');
      });
    };
    await everyFrame(clock, (dt) => {
      const inputs = seats.map((_, p) => {
        if (!playing(p)) return IDLE;
        if (cpu(p)) return cpuStick(cpus[p] as CpuTidier, room, p, dt, skill[p] ?? 0.5, rng);
        const s = sticks[p] ?? IDLE;
        const a = s.a || (tapped[p] ?? false);
        tapped[p] = false;
        return { x: s.x, y: s.y, a };
      });
      show(stepRoom(room, inputs, dt));
      secondWind();
      view.syncPeople(room, dt);
      view.syncMess(room, dt);
      if (!warned && room.time >= MESS.duration - 5) {
        warned = true;
        ui.caption('Footsteps on the stairs… someone’s coming!');
      }
      if (room.time - hudAt >= 0.1) {
        hudAt = room.time;
        ui.timer(MESS.duration - room.time);
        ui.live(
          teams.map((members, team) => {
            const lead = seats[members[0] ?? 0];
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${messOn(room, team)} mess` };
          }),
        );
      }
      return isOver(room);
    });
    off();
    ui.timer(null);

    // Ding-dong! Everyone freezes, puts down what they're holding, and the last throws come down.
    ringBell(room);
    dingDong(sfx);
    ui.caption('Ding-dong! The landlord!');
    view.floaters.add('Ding-dong!', '#fff6a8', new THREE.Vector3(0, 2.6, -1), 0.8, 2.2);
    for (const r of view.rigs) r?.c.react('thinking', 1.6);
    for (const p of seats.keys()) if (playing(p)) session.send(seatOf(p), { t: 'buzz', pattern: [40, 60, 40] });
    let waited = 0;
    await everyFrame(clock, (dt) => {
      waited += dt;
      show(stepSettle(room, dt));
      view.syncPeople(room, dt);
      view.syncMess(room, dt);
      return waited >= 0.8 && (isSettled(room) || waited >= MESS.settle);
    });
    ui.caption(null);

    const mess = [messOn(room, 0), messOn(room, 1)];
    const tie = teams.length > 1 && mess[0] === mess[1];
    const best = Math.min(...teams.map((_, team) => mess[team] ?? 0));
    sfx.good();
    teams.forEach((members, team) => {
      const mine = mess[team] ?? 0;
      const won = mine === best;
      view.sayHalf(team, `${mine} mess`, mix(colorOf(team), '#ffffff', 0.3));
      for (const p of members) {
        const r = view.rigs[p];
        r?.c.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) r?.c.react('happy', 3);
        tell(p, won, tie ? 'Ding-dong! Both sides equally messy.' : won ? 'Ding-dong! Your side is the tidy one.' : 'Ding-dong! Your side is the messy one.');
      }
      if (won && !tie) view.say(members[0] ?? 0, 'Spotless!', '#fff6a8');
    });
    await clock.wait(1.8);

    return {
      scores: messScores(room, teams, seats.length),
      details: seats.map((_, p) => {
        const team = room.teamOf[p] ?? -1;
        const c = room.tidiers[p];
        if (team < 0 || !c) return '';
        return `${mess[team] ?? 0} mess on your side · ${c.over} tossed over`;
      }),
    };
  },
};
