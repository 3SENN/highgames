// Pivot! on the TV: moving day in an old block of flats, seen from above with the ceiling off, like a dollhouse.
// Two hallways side by side share a wall; each team carries its couch from the old flat to the new one, round two
// corners and through the doorway. Each partner holds one end and moves it with their stick.
import * as THREE from 'three';
import {
  CARRY,
  type CarryEvent,
  type Couch,
  type CpuCarrier,
  type Hall,
  LAYOUT,
  type Vec,
  carryFraction,
  carryScore,
  carryScores,
  couchEnds,
  cpuStick,
  keepClear,
  makeHall,
  newCouch,
  newCpuCarrier,
  stepCouch,
} from '../../../game/minigames/couchcarry';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cone, cyl, gem, mix, nameCard, part, rbox, seeded, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const OFFSET = 1.25; // each hallway starts this far either side of the middle (the two share a wall)
const Z0 = 5; // the start of the hallways sits at this world z; forward is -z
const WALL_H = 0.85; // cut-away walls
const COUCH_Y = 0.24; // the couch is carried this far off the floor
const HEIGHT = 1.05; // companions
const HOLD = CARRY.radius + 0.16; // carriers stand this far beyond their end of the couch
const TILT = 0.98; // the camera looks down this much (radians)
const MARKS_MAX = 14; // scuff marks kept per hallway
const STILL: Vec = { x: 0, y: 0 };

const CARDBOARD = mix(P.oak, P.sand, 0.45);
const CARPET = mix(P.duskWall, P.linen, 0.35);

// ------------------------------------------------------------------ pieces

/** A couch, long side along +x (the front end), seat facing +z. Feet at y = 0. The team's colour, in linen. */
function couchMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  const L = CARRY.span + 2 * CARRY.radius;
  const D = 2 * CARRY.radius;
  const inner = L - 0.62;
  const body = mix(color, P.aubergine, 0.22);
  const fab = { tex: 'fabric' as const, texStrength: 0.8 };
  part(g, rbox(L - 0.08, 0.26, D - 0.04, 0.1), mix(body, P.ink, 0.15), 0, 0.2, 0, fab);
  part(g, rbox(inner, 0.38, 0.22, 0.09), body, 0, 0.5, -D / 2 + 0.13, fab);
  for (const side of [-1, 1]) part(g, rbox(0.27, 0.44, D, 0.11), body, side * (L / 2 - 0.135), 0.4, 0, fab);
  // Seat cushions with a line of piping in the full seat colour, and two throw pillows.
  for (const k of [-1, 1]) {
    part(g, rbox(inner / 2 - 0.05, 0.13, D - 0.3, 0.05), mix(color, P.cream, 0.18), (k * inner) / 4, 0.38, 0.08, fab);
    part(g, rbox(inner / 2 - 0.09, 0.02, 0.03, 0.01), color, (k * inner) / 4, 0.4, D / 2 - 0.09, { outline: false, shadow: false, exact: true, glow: 0.25 });
  }
  for (const side of [-1, 1]) part(g, rbox(0.3, 0.035, D + 0.01, 0.015), color, side * (L / 2 - 0.135), 0.625, 0, { outline: false, shadow: false, exact: true, glow: 0.25 });
  part(g, rbox(0.32, 0.28, 0.12, 0.06), P.mustard, -(L / 2 - 0.55), 0.55, -D / 2 + 0.3, { rz: 0.3, rx: -0.2, tex: 'knit' });
  part(g, rbox(0.28, 0.26, 0.11, 0.06), P.cream, L / 2 - 0.58, 0.54, -D / 2 + 0.3, { rz: -0.25, rx: -0.2, tex: 'knit' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, cyl(0.05, 0.035, 0.09, 8), P.walnut, sx * (L / 2 - 0.2), 0.04, sz * (D / 2 - 0.12), { outline: false });
  return g;
}

/** A furniture dolly: a team of one gets a helping hand at the back. */
function dollyMesh(): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(0.75, 0.06, 0.6, 0.03), P.oak, 0, 0.2, 0, { tex: 'planks', texScale: 0.8 });
  part(g, rbox(0.5, 0.02, 0.4, 0.01), P.charcoal, 0, 0.235, 0, { outline: false, shadow: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, cyl(0.08, 0.08, 0.06, 12), P.charcoal, sx * 0.28, 0.08, sz * 0.22, { rx: Math.PI / 2, gloss: 0.3 });
  return g;
}

/** A flat arrow on the floor, pointing along +x. */
function arrowMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(0.34, 0.03, 0.09, 0.02), color, 0.17, 0, 0, { glow: 0.6, outline: false, shadow: false });
  part(g, cone(0.13, 0.22, 3), color, 0.42, 0, 0, { rz: -Math.PI / 2, sx: 0.25, glow: 0.6, outline: false, shadow: false });
  return g;
}

/** A cardboard moving box, taped shut, with a label on its side. */
function movingBox(parent: THREE.Object3D, x: number, y: number, z: number, s: number, ry: number): void {
  const g = new THREE.Group();
  part(g, rbox(0.5 * s, 0.4 * s, 0.42 * s, 0.02), CARDBOARD, 0, 0.2 * s, 0, { outline: 0.02 });
  part(g, box(0.505 * s, 0.012, 0.09 * s), mix(P.sand, P.cream, 0.4), 0, 0.4 * s + 0.003, 0, { outline: false, shadow: false, gloss: 0.3 });
  part(g, box(0.2 * s, 0.12 * s, 0.01), P.cream, -0.08 * s, 0.24 * s, 0.211 * s, { outline: false, shadow: false });
  g.position.set(x, y, z);
  g.rotation.y = ry;
  parent.add(g);
}

/** Dust and glitter: little specks that fly out, fall and shrink away. */
class Specks {
  private list: { m: THREE.Mesh; v: THREE.Vector3; age: number; life: number }[] = [];
  constructor(
    private readonly scene: THREE.Object3D,
    private readonly rand: () => number,
  ) {}

  burst(at: THREE.Vector3, color: string, o: { n?: number; speed?: number; size?: number; glow?: number; up?: number } = {}): void {
    const n = o.n ?? 10;
    const speed = o.speed ?? 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand();
      const m = part(this.scene, o.glow ? gem(o.size ?? 0.06) : sphere(o.size ?? 0.06, 8), color, at.x, at.y, at.z, { ...(o.glow ? { glow: o.glow } : {}), outline: false, shadow: false });
      const out = speed * (0.4 + this.rand() * 0.7);
      this.list.push({ m, v: new THREE.Vector3(Math.cos(a) * out, (o.up ?? 1) * speed * (0.5 + this.rand() * 0.7), Math.sin(a) * out), age: 0, life: 0.45 + this.rand() * 0.35 });
    }
  }

  update(dt: number): void {
    this.list = this.list.filter((s) => {
      s.age += dt;
      s.v.y -= 5 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.y += dt * 7;
      s.m.scale.setScalar(Math.max(0.01, 1 - s.age / s.life));
      if (s.age < s.life) return true;
      s.m.removeFromParent();
      return false;
    });
  }
}

// ------------------------------------------------------------------ the view

interface Carrier {
  /** Seat position, or -1 for the dolly. */
  p: number;
  end: 0 | 1;
  companion: Companion | null;
  root: THREE.Object3D;
  ring: THREE.Mesh | null;
  card: THREE.Sprite | null;
  arrow: THREE.Group | null;
  pos: THREE.Vector3;
  facing: number;
  placed: boolean;
}

interface Side {
  sign: number;
  base: number;
  color: string;
  couch: Couch;
  mesh: THREE.Group;
  carriers: Carrier[];
  marks: THREE.Mesh[];
  /** The sticks right now, in the hallway's own coordinates (front, back). */
  sticks: [Vec, Vec];
  label: THREE.Vector3;
  /** 1 → 0 after the couch is set down at home: a little squash and settle. */
  settle: number;
  lamp: THREE.PointLight | null;
}

class Hallways implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly sides: Side[] = [];
  private readonly floaters: Floaters;
  private readonly fit: CameraFit;
  private readonly marks: Mark[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private time = 0;
  private readonly rand = seeded(41);
  private readonly specks: Specks;
  /** Two hallways side by side (their name cards move apart). */
  private two = false;
  private tick: (dt: number, time: number) => void = () => {};

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    private readonly companions: Companion[],
    private readonly hall: Hall,
    couches: Couch[],
  ) {
    this.floaters = new Floaters(this.scene);
    this.fit = new CameraFit(this.camera, TILT);
    this.specks = new Specks(this.scene, this.rand);
    // Evening, the ceiling lights on: warm from above, plum in the shade.
    const rig = lightRig(this.scene, 'lampInterior', { fog: { near: 40, far: 120 }, shadowSize: 15, sunFrom: [0.3, 1, 0.4] });
    rig.sun.intensity = 1.5;
    rig.sun.target.position.set(0, 0, -1.5);
    this.surroundings();

    const two = teams.length > 1;
    this.two = two;
    teams.forEach((members, k) => {
      const sign = two && k === 0 ? -1 : 1;
      const base = two ? sign * OFFSET : -LAYOUT.turn2 / 2 - 0.5;
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      const mesh = couchMesh(color);
      this.scene.add(mesh);
      const side: Side = { sign, base, color, couch: couches[k] as Couch, mesh, carriers: [], marks: [], sticks: [STILL, STILL], label: new THREE.Vector3(), settle: 0, lamp: null };
      this.sides.push(side);
      this.building(side);
      // Who holds which end: the first partner the front, the second the back (or the dolly).
      for (const end of [0, 1] as const) {
        const p = members[end];
        const seat = p === undefined ? undefined : seats[p];
        const c = p === undefined ? undefined : companions[p];
        if (p !== undefined && seat && c) {
          c.setBase('listening');
          this.scene.add(c.root);
          const ring = part(this.scene, torus(0.3, 0.035), seat.color, 0, 0.03, 0, { rx: Math.PI / 2, glow: 0.9, outline: false, shadow: false, exact: true });
          const card = nameCard(seat.name, seat.color, 0.7);
          this.scene.add(card);
          this.cards.push(card);
          const arrow = arrowMesh(seat.color);
          this.scene.add(arrow);
          side.carriers.push({ p, end, companion: c, root: c.root, ring, card, arrow, pos: new THREE.Vector3(), facing: 0, placed: false });
        } else if (end === 1) {
          const dolly = dollyMesh();
          this.scene.add(dolly);
          side.carriers.push({ p: -1, end, companion: null, root: dolly, ring: null, card: null, arrow: null, pos: new THREE.Vector3(), facing: 0, placed: false });
        }
      }
      // The team's name by the old flat's door.
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.2);
      card.position.copy(this.at(side, { x: two ? 1.1 : 0, y: LAYOUT.back - LAYOUT.wall - 0.75 }, 0.2));
      side.label.copy(card.position);
      this.scene.add(card);
      this.cards.push(card);
    });
    if (two) {
      // The shared wall between the two hallways.
      const y0 = LAYOUT.back - LAYOUT.wall;
      const y1 = LAYOUT.turn1 + CARRY.hall / 2 + LAYOUT.wall;
      part(this.scene, rbox(2 * (OFFSET - CARRY.hall / 2), WALL_H - 0.01, y1 - y0, 0.04), P.cream, 0, (WALL_H - 0.01) / 2, Z0 - (y0 + y1) / 2, { tex: 'plaster', outline: 0.02 });
    }
    this.tick = props.tickProps(this.scene);
    this.update(0);
  }

  /** A point in a hallway's own coordinates, in the world. */
  at(s: Side, p: Vec, y = 0): THREE.Vector3 {
    return new THREE.Vector3(s.base + s.sign * p.x, y, Z0 - p.y);
  }

  /** A direction in a hallway's own coordinates, as a world heading (rotation about y of +x). */
  heading(s: Side, d: Vec): number {
    return Math.atan2(d.y, s.sign * d.x);
  }

  /** The rest of the floor, lights low: the neighbours' rooms either side, so the frame is never empty. */
  private surroundings(): void {
    const sc = this.scene;
    const Y = -0.13;
    const dim = (c: string) => mix(c, P.aubergine, 0.4);
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, s = 1) => {
      o.position.set(x, Y, z);
      o.rotation.y = ry;
      if (s !== 1) o.scale.setScalar(s);
      sc.add(o);
      return o;
    };
    part(sc, box(90, 0.2, 80), mix(P.walnut, P.plum, 0.4), 0, Y - 0.1, 0, { tex: 'woodFloor', texScale: 3, outline: false, shadow: false });
    const wall = (x: number, z: number, w: number, d: number) => part(sc, box(w, WALL_H, d), dim(P.duskWall), x, Y + WALL_H / 2, z, { tex: 'plaster', outline: false });
    // On the left (under the score list and beside it): a living room and, further back, a bedroom.
    wall(-17.4, -2, 0.25, 22);
    wall(-13.4, -2.6, 8, 0.25);
    put(props.rug({ w: 4.2, d: 3, color: dim(P.teal) }), -12.6, 2.2);
    put(props.sofa({ seats: 3, color: dim(P.mauve), pillows: [P.mustard, P.terracotta] }), -15.9, 2.2, Math.PI / 2, 1.3);
    put(props.coffeeTable({ round: true, w: 1.2 }), -12.8, 2.2);
    put(props.snackBowl({ fill: 'popcorn' }), -12.8, 2.2).position.y = Y + 0.42;
    put(props.armchair({ color: dim(P.terracotta), pillow: P.cream }), -11.9, 5.4, Math.PI - 0.5, 1.2);
    put(props.floorLamp({ lit: true }), -16.2, 5.2);
    put(props.plant({ kind: 'monstera', h: 1.3 }), -10.1, 6.1);
    put(props.bookshelf({ w: 1.6, h: 1.4, shelves: 3, seed: 3 }), -14, -2.3);
    put(props.plant({ kind: 'ficus', h: 1.6, pot: P.ceramic }), -10.2, -1.8);
    put(props.bed({ color: dim(P.denim), blanket: dim(P.rose) }), -15.6, -6.4, Math.PI / 2, 1.2);
    put(props.rug({ w: 2.6, d: 2.6, round: true, color: dim(P.rose), tex: 'knit' }), -12.4, -6.2);
    put(props.sideTable({ h: 0.5 }), -16.6, -4.2);
    put(props.tableLamp({ lit: true, stand: P.brass }), -16.6, -4.2).position.y = Y + 0.5;
    put(props.crate({ s: 0.55 }), -10.3, -8.3, 0.3);
    // On the right: a narrow study.
    wall(11.9, -2, 0.25, 22);
    put(props.rug({ w: 2, d: 3.4, color: dim(P.forest) }), 10.2, 1.6);
    put(props.bookshelf({ w: 1.6, h: 1.4, shelves: 3, seed: 8 }), 11.5, -3.2, -Math.PI / 2);
    put(props.armchair({ color: dim(P.mustard) }), 10.6, -6.6, -0.6, 1.2);
    put(props.plant({ kind: 'snake', h: 0.9, pot: P.charcoal }), 9.4, -8.4);
    put(props.floorLamp({ lit: true }), 11.2, 4.6);
    put(props.plant({ kind: 'fern', h: 0.8 }), 9.3, 5.8);
    put(props.pouf({ color: dim(P.terracotta) }), 10.3, 2.2);
  }

  /** Floors, walls, the doorway, the new flat and a few moving boxes, for one hallway. */
  private building(s: Side): void {
    const sc = this.scene;
    const hall = this.hall;
    const bx = (k: { x0: number; y0: number; x1: number; y1: number }) => ({ c: this.at(s, { x: (k.x0 + k.x1) / 2, y: (k.y0 + k.y1) / 2 }), w: k.x1 - k.x0, d: k.y1 - k.y0 });
    const lo = { x: Math.min(...hall.blocks.map((b) => b.x0)), y: Math.min(...hall.blocks.map((b) => b.y0)) };
    const hi = { x: Math.max(...hall.blocks.map((b) => b.x1)), y: Math.max(...hall.blocks.map((b) => b.y1)) };
    const put = (o: THREE.Object3D, at: Vec, ry = 0, y = 0) => {
      o.position.copy(this.at(s, at, y));
      o.rotation.y = ry * s.sign;
      sc.add(o);
      return o;
    };
    const { x: dx, y: dy, width, depth } = hall.door;
    withOutline(0.022, () => {
      // The rest of the flat (carpet), under everything.
      const all = bx({ x0: lo.x, y0: lo.y, x1: hi.x, y1: hi.y });
      part(sc, rbox(all.w, 0.1, all.d, 0.03), CARPET, all.c.x, -0.07, all.c.z, { tex: 'terry', texScale: 1.2, texStrength: 0.7, outline: false });
      // Floorboards along each stretch; the new flat has parquet.
      hall.floors.forEach((f, i) => {
        const room = i === hall.floors.length - 1;
        const { c, w, d } = bx(f);
        part(sc, rbox(w, 0.06, d, 0.02), room ? mix(P.oak, P.cream, 0.2) : mix(P.oak, P.sand, 0.3), c.x, -0.03, c.z, { tex: room ? 'parquet' : 'woodFloor', texScale: room ? 1.3 : 1.0, outline: false, shadow: false });
      });
      // A runner rug down the first stretch, in the team's colour mixed down, with a paler edge.
      const rug = this.at(s, { x: 0, y: 2.3 }, 0.012);
      part(sc, rbox(0.95, 0.02, 4.6, 0.04), mix(s.color, P.cream, 0.35), rug.x, rug.y, rug.z, { tex: 'terry', outline: false, shadow: false });
      part(sc, rbox(0.72, 0.022, 4.37, 0.04), mix(s.color, P.aubergine, 0.5), rug.x, rug.y + 0.004, rug.z, { tex: 'terry', outline: false, shadow: false });
      // The walls: painted plaster with a wooden skirting, seen from above.
      hall.blocks.forEach((k, i) => {
        const { c, w, d } = bx(k);
        const h = WALL_H + i * 0.002;
        part(sc, rbox(w, h, d, 0.03), P.cream, c.x, h / 2, c.z, { tex: 'plaster', texStrength: 0.8 });
        part(sc, box(w + 0.03, 0.1, d + 0.03), mix(P.walnut, P.oak, 0.4), c.x, 0.05, c.z, { outline: false, shadow: false });
      });
      // The doorway: posts, the door swung back against the wall, a doormat.
      for (const side of [-1, 1]) {
        const p = this.at(s, { x: dx + side * (width / 2 + 0.06), y: dy + depth / 2 });
        part(sc, rbox(0.14, 1.02, depth + 0.06, 0.03), P.walnut, p.x, 0.51, p.z, { tex: 'wood' });
      }
      const leaf = this.at(s, { x: dx + width / 2 + 0.66, y: dy + depth + 0.05 });
      part(sc, rbox(1.26, 0.95, 0.06, 0.02), P.teal, leaf.x, 0.48, leaf.z, { gloss: 0.25 });
      part(sc, sphere(0.045, 10), P.brass, leaf.x + s.sign * 0.5, 0.48, leaf.z - 0.05, { outline: false, gloss: 0.7 });
      const mat = this.at(s, { x: dx, y: dy - 0.42 }, 0.012);
      part(sc, rbox(1.0, 0.03, 0.5, 0.02), P.walnut, mat.x, mat.y, mat.z, { tex: 'knit', outline: false, shadow: false });
      // A ring of light on the floor where the couch has to end up.
      const goal = this.at(s, { x: dx, y: dy + depth + 2.1 }, 0.035);
      part(sc, torus(1.18, 0.03), s.color, goal.x, goal.y, goal.z, { rx: Math.PI / 2, glow: 0.8, outline: false, shadow: false, exact: true });
    });
    // The new flat: a round rug, plants, a shelf and a lamp that is already on.
    const top = dy + depth + LAYOUT.room.depth;
    put(props.rug({ w: 2.3, round: true, color: mix(s.color, P.aubergine, 0.5), border: mix(s.color, P.cream, 0.45) }), { x: dx, y: dy + depth + 2.1 });
    put(props.plant({ kind: 'monstera', h: 1.0, pot: P.terracotta, seed: 3 }), { x: dx - LAYOUT.room.half + 0.45, y: top - 0.45 });
    put(props.plant({ kind: 'snake', h: 0.7, pot: P.ceramic }), { x: dx - LAYOUT.room.half + 0.4, y: dy + depth + 0.45 });
    const lamp = put(props.floorLamp({ h: 1.35, lit: true, light: 7 }), { x: dx + LAYOUT.room.half - 0.45, y: top - 0.45 });
    s.lamp = (lamp.userData.light as THREE.PointLight | undefined) ?? null;
    put(props.bookshelf({ w: 1.5, h: 1.0, shelves: 2, seed: 4 + s.sign }), { x: dx - 0.5, y: top - 0.2 });
    put(props.sideTable({ h: 0.42 }), { x: dx + LAYOUT.room.half - 0.45, y: dy + depth + 0.5 });
    put(props.mug({ color: P.teal }), { x: dx + LAYOUT.room.half - 0.45, y: dy + depth + 0.5 }, 0, 0.42);
    // Moving boxes everywhere else: in the rooms off the hallway and by the old flat's door.
    const spots: [number, number, number, number][] = [
      [2.0, 0.6, 1, 0.2],
      [2.6, 1.8, 0.9, -0.3],
      [4.6, 3.6, 1.1, 0.5],
      [5.6, 1.2, 1, 0.1],
      [0.2, 8.4, 1, -0.2],
      [1.2, 9.3, 0.85, 0.4],
      [1.7, LAYOUT.back - 0.65, 0.9, 0.3],
    ];
    for (const [x, y, sz, r] of spots) {
      const p = this.at(s, { x, y });
      movingBox(sc, p.x, 0, p.z, sz, r * s.sign);
      if (this.rand() < 0.5) movingBox(sc, p.x + 0.04, 0.4 * sz, p.z - 0.03, sz * 0.8, -r);
    }
    // The rooms off the hallway are half packed: a rug, a rolled-up one, plants waiting by the boxes.
    put(props.rug({ w: 1.9, d: 1.3, color: P.denim, tex: 'knit' }), { x: 3.9, y: 1.9 }, 0.3);
    put(props.plant({ kind: 'ficus', h: 1.25, pot: P.ceramic, seed: 2 }), { x: 6.1, y: 3.9 });
    put(props.pouf({ color: P.mustard, r: 0.3 }), { x: 3.2, y: 3.4 });
    const roll = this.at(s, { x: 5.2, y: 2.6 });
    part(sc, cyl(0.13, 0.13, 1.5, 12), P.terracotta, roll.x, 0.13, roll.z, { rz: Math.PI / 2, ry: 0.5 * s.sign, tex: 'terry', outline: 0.02 });
    put(props.plant({ kind: 'fern', h: 0.6, seed: 5 }), { x: 0.5, y: 9.6 });
    put(props.crate({ s: 0.5 }), { x: 6.2, y: 0.2 }, 0.2);
    put(props.stool({ h: 0.45 }), { x: 2.3, y: 4.3 });
    // What the camera has to keep on screen: the whole building and the team's name.
    for (const x of [lo.x, hi.x]) for (const y of [lo.y, hi.y]) this.marks.push({ p: this.at(s, { x, y }) }, { p: this.at(s, { x, y }, y === hi.y ? 1.5 : WALL_H) });
    this.marks.push({ p: this.at(s, { x: this.two ? 1.1 : 0, y: LAYOUT.back - LAYOUT.wall - 0.75 }, 0.2), pad: 0.06 });
  }

  /** A scuff: a grubby mark on the wall where it hit, and the couch shudders. */
  scuff(k: number, e: Extract<CarryEvent, { kind: 'scuff' }>): void {
    const s = this.sides[k];
    if (!s) return;
    const p = this.at(s, { x: e.at.x + e.normal.x * 0.012, y: e.at.y + e.normal.y * 0.012 }, 0.32 + this.rand() * 0.25);
    const mark = part(this.scene, rbox(0.3 + this.rand() * 0.14, 0.07 + this.rand() * 0.04, 0.02, 0.01), mix(s.color, P.charcoal, 0.6), p.x, p.y, p.z, {
      ry: Math.atan2(s.sign * e.normal.x, -e.normal.y),
      rz: (this.rand() - 0.5) * 0.5,
      outline: false,
      shadow: false,
    });
    s.marks.push(mark);
    while (s.marks.length > MARKS_MAX) s.marks.shift()?.removeFromParent();
    this.specks.burst(new THREE.Vector3(p.x, 0.45, p.z), P.linen, { n: 7, speed: 1.3, size: 0.07, up: 0.7 });
    this.floaters.add('Scuff!', mix(P.rose, P.cream, 0.5), this.at(s, s.couch, 1.4), 0.45, 1.0);
    for (const c of s.carriers) c.companion?.react('sad', 1.1);
  }

  home(k: number): void {
    const s = this.sides[k];
    if (!s) return;
    s.settle = 1;
    this.specks.burst(this.at(s, s.couch, 0.7), P.lamp, { n: 16, speed: 2.6, glow: 1.8 });
    this.specks.burst(this.at(s, s.couch, 0.7), s.color, { n: 8, speed: 1.8, glow: 1.4, size: 0.05 });
    this.floaters.add('Home!', P.lamp, this.at(s, s.couch, 1.6), 0.7, 2.4);
    for (const c of s.carriers) {
      c.companion?.setBase('happy');
      c.companion?.react('happy', 3);
    }
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
    for (const card of this.cards) {
      card.material.map?.dispose();
      card.material.dispose();
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const c of this.companions) c.update(dt);
    for (const s of this.sides) this.place(s, dt);
    this.specks.update(dt);
    this.tick(dt, this.time);
    // The lamps in the new flats breathe a little, and flare when the couch comes home.
    this.sides.forEach((s, i) => {
      if (s.lamp) s.lamp.intensity = 7 * (1 + Math.sin(this.time * 2.3 + i * 2) * 0.04) + s.settle * 5;
    });
    this.floaters.update(dt);
    this.fit.update(() => this.marks);
  }

  /** The couch where the rules say it is, and its carriers at their ends. */
  private place(s: Side, dt: number): void {
    const c = s.couch;
    const moving = Math.hypot(c.vx, c.vy) + Math.abs(c.spin) * 0.8;
    const bob = Math.abs(Math.sin(this.time * 9)) * Math.min(1, moving) * 0.04;
    const shake = c.stun > 0 ? Math.sin(this.time * 70) * 0.05 * (c.stun / CARRY.stun) : 0;
    const centre = this.at(s, c, COUCH_Y + bob);
    // Set down at home: it drops to the floor, squashes and settles.
    const home = c.finishedAt !== null;
    s.settle = Math.max(0, s.settle - dt / 0.45);
    const q = home ? Math.sin(s.settle * Math.PI) * s.settle : 0;
    s.mesh.position.set(centre.x + shake, home ? COUCH_Y * s.settle : centre.y, centre.z + shake * 0.6);
    s.mesh.scale.set(1 + q * 0.1, 1 - q * 0.16, 1 + q * 0.1);
    s.mesh.rotation.set(0, this.heading(s, { x: Math.cos(c.angle), y: Math.sin(c.angle) }), shake * 0.6);
    const ends = couchEnds(c);
    const ax = Math.cos(c.angle);
    const ay = Math.sin(c.angle);
    const goingTo = Math.hypot(c.vx, c.vy) > 0.25 ? { x: c.vx, y: c.vy } : { x: ax, y: ay };
    for (const r of s.carriers) {
      const e = ends[r.end];
      const out = r.end === 0 ? 1 : -1;
      const where = r.p < 0 ? e : keepClear(this.hall, { x: e.x + ax * HOLD * out, y: e.y + ay * HOLD * out }, 0.24);
      const goal = this.at(s, where);
      const before = r.pos.clone();
      r.pos.lerp(goal, r.placed ? 1 - Math.exp(-14 * dt) : 1);
      r.placed = true;
      const speed = dt > 0 ? before.distanceTo(r.pos) / dt : 0;
      r.root.position.copy(r.pos);
      if (r.companion) {
        r.companion.move(speed > 0.2 ? 'walk' : null, speed);
        // Face where the couch is going (rotation.y = atan2(x, z) faces a world direction).
        const want = this.heading(s, goingTo) + Math.PI / 2;
        let d = want - r.facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        r.facing += d * (1 - Math.exp(-8 * dt));
        r.root.rotation.y = r.facing;
      } else {
        r.root.rotation.y = this.heading(s, { x: ax, y: ay });
      }
      r.ring?.position.set(r.pos.x, 0.03, r.pos.z);
      r.card?.position.set(r.pos.x, HEIGHT + 0.42, r.pos.z);
      if (r.arrow) {
        const st = s.sticks[r.end];
        const l = Math.hypot(st.x, st.y);
        r.arrow.visible = l > 0.15 && c.finishedAt === null;
        r.arrow.position.set(r.pos.x, 0.04, r.pos.z);
        r.arrow.rotation.y = this.heading(s, st);
        r.arrow.scale.setScalar(0.6 + Math.min(1, l) * 0.6);
      }
    }
  }
}

// ------------------------------------------------------------------ sounds

/** The couch knocking a wall: a soft thud. */
function thud(sfx: Sfx): void {
  noise(sfx, { dur: 0.16, freq: 260, to: 90, gain: 0.42 });
  tone(sfx, { freq: 170, to: 105, dur: 0.18, type: 'triangle', gain: 0.1 });
}

/** Home: three gentle notes. */
function arrive(sfx: Sfx): void {
  [523, 659, 784].forEach((freq, i) => tone(sfx, { freq, dur: 0.3, type: 'triangle', gain: 0.12, delay: 0.12 + i * 0.1 }));
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'couchcarry',
  title: 'Pivot!',
  how: 'Moving day! You and your partner each hold one end of the couch: your stick moves your end. Walk it round two corners and through the door: first couch home wins. Bump the walls and you’ll scuff it!',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const hall = makeHall();
    const couches = teams.map(() => newCouch(hall));
    const skill = seats.map(() => ctx.skill());
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT })));
    const view = new Hallways(seats, teams, companions, hall, couches);
    ctx.stage.setView(view);

    const teamOf = new Map<number, number>();
    teams.forEach((t, k) => t.forEach((p) => teamOf.set(p, k)));
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');

    // Computer players, and a helper on the back end for a team of one (the dolly).
    const cpus: (CpuCarrier | null)[] = seats.map(() => newCpuCarrier(hall));
    const helpers = teams.map((t) => (t.length < 2 ? newCpuCarrier(hall) : null));
    const raw: Vec[] = seats.map(() => STILL);

    seats.forEach((s, p) => {
      const k = teamOf.get(p);
      const members = k === undefined ? [] : (teams[k] ?? []);
      const front = members[0] === p;
      const partner = members.find((m) => m !== p);
      const note =
        partner === undefined
          ? 'You have the front end; a dolly rolls the back. Steer it round the corners!'
          : `You have the ${front ? 'front' : 'back'} end, ${nameOf(partner)} has the ${front ? 'back' : 'front'}. Pivot round the corners together!`;
      session.setLayout(s.index, { kind: 'stick', button: null, note });
    });

    let over = false;
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'stick' || over || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p !== undefined) raw[p] = { x: msg.x, y: msg.y };
    });

    const onEvent = (k: number, e: CarryEvent) => {
      const members = teams[k] ?? [];
      if (e.kind === 'scuff') {
        view.scuff(k, e);
        thud(sfx);
        for (const p of members) {
          tell(p, false, 'Scuffed the wall! Gently does it.');
          buzz(p, [70, 40, 70]);
        }
      } else {
        view.home(k);
        sfx.good();
        arrive(sfx);
      }
    };

    ui.caption('Each of you holds one end. Pivot round the corners together!');
    let acc = 0;
    let simT = 0;
    let hudAt = -1;
    await everyFrame(clock, (dt, t) => {
      teams.forEach((members, k) => {
        const c = couches[k];
        const side = view.sides[k];
        if (!c || !side) return;
        const sticks: [Vec, Vec] = [STILL, STILL];
        for (const end of [0, 1] as const) {
          const p = members[end];
          const helper = helpers[k];
          if (p === undefined) sticks[end] = helper ? cpuStick(helper, hall, c, end, 0.6, rng, t, dt) : STILL;
          else if (cpu(p)) sticks[end] = cpuStick(cpus[p] as CpuCarrier, hall, c, end, skill[p] ?? 0.5, rng, t, dt);
          else sticks[end] = { x: side.sign * (raw[p]?.x ?? 0), y: raw[p]?.y ?? 0 };
        }
        side.sticks = sticks;
      });
      // Fixed physics steps, however long the frame was.
      acc += dt;
      while (acc >= CARRY.step) {
        acc -= CARRY.step;
        simT += CARRY.step;
        couches.forEach((c, k) => {
          const side = view.sides[k];
          for (const e of stepCouch(c, hall, side?.sticks ?? [STILL, STILL], simT)) onEvent(k, e);
        });
      }
      if (t - hudAt >= 0.1) {
        hudAt = t;
        ui.timer(CARRY.duration - t);
        ui.live(
          teams.map((members, k) => {
            const lead = seats[members[0] ?? 0];
            const c = couches[k];
            const value = !c ? '' : c.finishedAt !== null ? 'Home!' : `${Math.floor(carryFraction(c, hall) * 100)}%`;
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value };
          }),
        );
      }
      return t >= CARRY.duration || couches.some((c) => c.finishedAt !== null);
    });
    over = true;
    off();
    ui.timer(null);
    ui.caption(null);
    for (const s of view.sides) s.sticks = [STILL, STILL];

    // Done: whoever got home (or furthest) cheers.
    const scores = couches.map((c) => carryScore(c, hall));
    const best = Math.max(...scores);
    const tie = scores.length > 1 && scores.every((s) => s === best);
    const anyHome = couches.some((c) => c.finishedAt !== null);
    if (!anyHome) sfx.good();
    teams.forEach((members, k) => {
      const won = scores[k] === best;
      const home = couches[k]?.finishedAt !== null;
      for (const p of members) {
        const c = view.sides[k]?.carriers.find((r) => r.p === p)?.companion;
        if (!home) c?.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie && !home) c?.react('happy', 3);
        tell(
          p,
          won,
          tie ? 'Dead level! Neither couch got further.' : won ? (home ? 'Home! Your couch is in.' : 'Time! Your couch got furthest.') : home ? 'In, but theirs got there first.' : anyHome ? 'Their couch got home first.' : 'Time! Their couch got further.',
        );
      }
    });
    await clock.wait(1.8);

    return {
      scores: carryScores(couches, hall, teams, seats.length),
      details: seats.map((_, p) => {
        const k = teamOf.get(p);
        const c = k === undefined ? undefined : couches[k];
        if (!c) return '';
        const scuffs = c.scuffs ? ` · ${c.scuffs} scuff${c.scuffs === 1 ? '' : 's'}` : '';
        return c.finishedAt !== null ? `Through the door in ${c.finishedAt.toFixed(1)} s${scuffs}` : `${Math.floor(carryFraction(c, hall) * 100)}% of the way${scuffs}`;
      }),
    };
  },
};
