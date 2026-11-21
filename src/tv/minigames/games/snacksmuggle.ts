// Snack Smuggle on the TV: a dark kitchen in the middle of the night, seen from the side. The keeper stands at the
// fridge with their back to the room; three sneakers creep in from the hallway door on the left. When the floor
// creaks the keeper turns round, and anyone still moving shuffles back to the door.
import * as THREE from 'three';
import {
  SMUGGLE,
  type KeeperBrain,
  type Smuggle,
  type SneakBrain,
  canTurn,
  cpuHold,
  cpuTap,
  isMoving,
  isOver,
  newKeeperBrain,
  newSmuggle,
  newSneakBrain,
  smuggleScores,
  stepSmuggle,
  turnRound,
} from '../../../game/minigames/snacksmuggle';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Layout } from '../../../shared/protocol';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cyl, mix, nameCard, part, pill, rbox, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.35;
const DOOR = -6.6; // the hallway door (where sneakers start)
const FRIDGE = 6.9; // the fridge's front face
const TOUCH = FRIDGE - 0.45; // a sneaker's x when touching the fridge
const LANES = [-0.3, 1.0, 2.3]; // sneakers' z, back to front
const KEEPER = new THREE.Vector3(5.7, 0, -1.7);
const TILT = 0.42;

// ------------------------------------------------------------------ sounds

/** The floorboard creaks: a low groan and a dry scrape. */
function creak(sfx: Sfx): void {
  tone(sfx, { freq: 150, to: 105, dur: 0.38, type: 'sawtooth', gain: 0.045 });
  tone(sfx, { freq: 210, to: 170, dur: 0.3, type: 'triangle', gain: 0.05, delay: 0.05 });
  noise(sfx, { dur: 0.35, filter: 'bandpass', freq: 900, to: 450, gain: 0.12 });
}

/** A soft "hm?" as the keeper looks round. */
function hmm(sfx: Sfx): void {
  tone(sfx, { freq: 260, to: 330, dur: 0.18, type: 'triangle', gain: 0.07 });
}

/** One quiet sock step. */
function tiptoe(sfx: Sfx): void {
  noise(sfx, { dur: 0.05, filter: 'highpass', freq: 2600, gain: 0.025 });
}

// ------------------------------------------------------------------ the scene

interface Rig {
  c: Companion;
  ring: THREE.Mesh;
  card: THREE.Sprite | null;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
}

class Kitchen implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly rigs: Rig[] = [];
  readonly floaters = new Floaters(this.scene);
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly door = new THREE.Group();
  private readonly gaze: THREE.Mesh;
  private readonly gazeMat: THREE.MeshBasicMaterial;
  private readonly keeperCard: THREE.Sprite;
  private gazeLevel = 0;
  private readonly fridgeLight: THREE.PointLight;
  private clock: THREE.Mesh | null = null;
  private tick: (dt: number, time: number) => void = () => {};
  /** Seconds since each seat was caught (for the ring's flash), by seat position. */
  private readonly flash: number[] = [];
  /** Where the keeper faces: 0 = the fridge, 1 = the room. */
  turn = 0;
  turnTarget = 0;
  doorOpen = 0;

  constructor(
    seats: MinigameSeat[],
    companions: Companion[],
    readonly keeper: number,
    readonly sneakers: number[],
  ) {
    const rig = lightRig(this.scene, 'nightInterior', { shadowSize: 13, fog: { near: 36, far: 80 } });
    rig.sun.position.x += 0.5;
    rig.sun.target.position.set(0.5, 0, 0);
    // Warm light spilling from the hallway, the strip under the shelf, and the fridge's own light (when it opens).
    const hall = new THREE.PointLight(P.lamp, 46, 13, 1.5);
    hall.position.set(DOOR - 1.9, 3.0, 0.9);
    const strip = new THREE.PointLight(P.lamp, 14, 9, 1.6);
    strip.position.set(2.3, 3.3, -2.3);
    this.fridgeLight = new THREE.PointLight(P.screen, 0, 10, 1.5);
    this.fridgeLight.position.set(FRIDGE - 1.2, 2.4, 1.8);
    this.scene.add(hall, strip, this.fridgeLight);
    this.build();

    this.gazeMat = new THREE.MeshBasicMaterial({ color: P.lamp, transparent: true, opacity: 0, depthWrite: false });
    // The keeper's gaze: a pale wedge across the floor toward the door, shown while they look.
    const mid = ((LANES[0] ?? 0) + (LANES[LANES.length - 1] ?? 0)) / 2;
    const aim = Math.atan2(-(mid - KEEPER.z), DOOR - KEEPER.x);
    this.gaze = new THREE.Mesh(new THREE.CircleGeometry(14, 28, aim - 0.36, 0.72), this.gazeMat);
    this.gaze.rotation.x = -Math.PI / 2;
    this.gaze.position.set(KEEPER.x, 0.02, KEEPER.z);
    this.scene.add(this.gaze);

    seats.forEach((s, i) => {
      const comp = companions[i] as Companion;
      this.scene.add(comp.root);
      const isKeeper = i === keeper;
      const ring = part(this.scene, torus(isKeeper ? 0.55 : 0.45, 0.05), s.color, 0, 0.04, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      this.flash.push(9);
      comp.setBase(isKeeper ? 'working' : 'thinking');
      // Sneakers carry their name above their head.
      const card = sneakers.includes(i) ? nameCard(s.name, s.color, 0.6) : null;
      if (card) this.scene.add(card);
      this.rigs.push({ c: comp, ring, card, motion: null, mood: null });
    });
    this.keeperCard = nameCard('Keeper', seats[keeper]?.color ?? '#ffffff', 0.75);
    this.keeperCard.position.set(KEEPER.x, HEIGHT + 0.75, KEEPER.z);
    this.scene.add(this.keeperCard);
  }

  private build(): void {
    const s = this.scene;
    const K = 1.9; // the kitchen is seen from a sneaker's height: furniture is this much bigger than life
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, k = K, to: THREE.Object3D = s): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(k);
      to.add(o);
      return o;
    };
    const flat = { outline: false as const, shadow: false };
    const wallC = mix(P.sageWall, P.slate, 0.3);
    const plaster = { tex: 'plaster' as const, texScale: 4, outline: false as const };
    const BACK = -3.6;
    const LEFT = DOOR - 0.6; // the wall the hallway door is in
    const RIGHT = FRIDGE + 1.65;

    // The floor: big stone tiles; the back wall with a tiled splashback.
    part(s, box(60, 0.3, 34), mix(P.clay, P.slate, 0.3), 0, -0.15, 8, { tex: 'stoneTiles', texScale: 5, texStrength: 0.75, ...flat });
    part(s, box(60, 11, 0.3), wallC, 0, 5.5, BACK - 0.15, { ...plaster, shadow: false });
    part(s, box(RIGHT - LEFT, 0.26, 0.08), P.cream, (LEFT + RIGHT) / 2, 0.13, BACK + 0.04, flat);
    part(s, box(11.6, 1.5, 0.06), mix(P.ceramic, P.slate, 0.4), -0.85, 1.77 + 0.75, BACK + 0.03, { tex: 'kitchenTile', texScale: 1.6, gloss: 0.25, ...flat });

    // The run along the back wall: cabinets with a sink, the cooker, more cabinets.
    put(props.kitchenCounter({ w: 2.7, color: P.forest, sink: -0.3 }), -3.75, 0, BACK);
    put(props.stove(), -0.6, 0, BACK);
    put(props.kitchenCounter({ w: 2.7, color: P.forest }), 2.55, 0, BACK);
    const top = 0.93 * K;
    put(props.pot({ color: P.copper }), -0.85, top, BACK + 0.4);
    put(props.pan(), -0.3, top, BACK + 0.85, 0.5);
    put(props.plant({ kind: 'trailing', h: 0.3 }), -5.7, top, BACK + 0.45);
    put(props.plates({ n: 5 }), -2.2, top, BACK + 0.6);
    put(props.mug({ color: P.terracotta }), -1.75, top, BACK + 0.85, 0.8);
    put(props.snackBowl({ fill: 'fruit', color: P.ceramic }), 4.1, top, BACK + 0.6);
    // The toaster, the biscuit jar, and a microwave whose clock still blinks.
    part(s, rbox(0.85, 0.55, 0.55, 0.14), P.stone, -4.9, top + 0.28, BACK + 0.6, { gloss: 0.6 });
    for (const dz of [-0.09, 0.09]) part(s, box(0.6, 0.02, 0.07), P.ink, -4.9, top + 0.56, BACK + 0.6 + dz, flat);
    part(s, cyl(0.03, 0.03, 0.12, 8), P.ink, -4.42, top + 0.36, BACK + 0.6, { rz: Math.PI / 2, outline: false });
    part(s, cyl(0.3, 0.3, 0.62, 20), mix(P.cream, P.mustard, 0.25), 1.05, top + 0.31, BACK + 0.6, { gloss: 0.5 });
    part(s, cyl(0.32, 0.32, 0.1, 20), P.terracotta, 1.05, top + 0.66, BACK + 0.6, { gloss: 0.3 });
    part(s, sphere(0.07, 10), P.brass, 1.05, top + 0.75, BACK + 0.6, { outline: false, gloss: 0.6 });
    part(s, rbox(1.5, 0.85, 0.85, 0.07), P.slate, 2.75, top + 0.43, BACK + 0.55, { gloss: 0.4 });
    part(s, rbox(0.95, 0.6, 0.03, 0.02), P.ink, 2.55, top + 0.43, BACK + 0.98, { gloss: 0.7, outline: false });
    part(s, cyl(0.02, 0.02, 0.5, 6), P.metal, 3.1, top + 0.43, BACK + 1.0, { outline: false, gloss: 0.7 });
    this.clock = part(s, rbox(0.3, 0.1, 0.02, 0.01), '#7dffa1', 3.28, top + 0.66, BACK + 0.985, { glow: 1.8, outline: false, shadow: false });

    // Above the worktop: a window on the night, a hood over the cooker, shelves of crockery with a strip light.
    put(props.windowFrame({ w: 1.5, h: 1.15, time: 'night', seed: 8 }), -3.75, 4.6, BACK + 0.02);
    part(s, box(1.5, 0.5, 0.9), P.metal, -0.6, 4.25, BACK + 0.45, { tex: 'metalPlate', texStrength: 0.35, gloss: 0.4 });
    part(s, box(0.6, 6, 0.5), P.metal, -0.6, 7.5, BACK + 0.25, { tex: 'metalPlate', texStrength: 0.35, outline: false });
    put(props.wallShelf({ w: 1.7, items: 'kitchen', seed: 2 }), 2.55, 4.0, BACK + 0.02);
    put(props.wallShelf({ w: 1.7, items: 'kitchen', seed: 6 }), 2.55, 5.3, BACK + 0.02);
    part(s, box(2.6, 0.05, 0.1), P.lamp, 2.55, 3.72, BACK + 0.3, { glow: 1.6, ...flat });
    put(props.wallClock({ color: P.brass }), 5.6, 5.0, BACK + 0.02);
    put(props.pictureFrame({ w: 0.6, h: 0.8, art: 'leaf', frame: P.oak }), -6.2, 6.0, BACK + 0.02);
    for (const [x, z] of [
      [-2.6, 0.3],
      [1.6, 0.9],
    ] as const) {
      put(props.pendantLamp({ drop: 1.55, lit: false, shade: P.brass }), x, 10.2, z);
    }

    // The left wall, with the doorway to the hallway. The door stands open into the hall.
    const sideC = mix(wallC, P.ink, 0.12);
    part(s, box(0.3, 11, 2.4), sideC, LEFT - 0.15, 5.5, BACK + 1.2, plaster);
    part(s, box(0.3, 11, 16), sideC, LEFT - 0.15, 5.5, 3.3 + 8, plaster);
    part(s, box(0.3, 7, 4.7), sideC, LEFT - 0.15, 4.2 + 3.5, 0.95, plaster);
    part(s, box(0.08, 0.26, 16), P.cream, LEFT + 0.04, 0.13, 3.3 + 8, flat);
    const wood = { tex: 'wood' as const };
    part(s, rbox(0.4, 4.2, 0.36, 0.04), P.walnut, LEFT, 2.1, -1.4, wood);
    part(s, rbox(0.4, 4.2, 0.36, 0.04), P.walnut, LEFT, 2.1, 3.3, wood);
    part(s, rbox(0.4, 0.34, 5.06, 0.04), P.walnut, LEFT, 4.27, 0.95, wood);
    const leaf = new THREE.Group();
    part(leaf, rbox(0.12, 3.9, 1.8, 0.03), P.oak, 0, 1.95, 0, wood);
    for (const y of [1.0, 2.9]) part(leaf, rbox(0.03, 1.5, 1.3, 0.02), mix(P.oak, P.ink, 0.12), 0.07, y, 0, { ...wood, outline: false });
    part(leaf, sphere(0.09, 10), P.brass, 0.14, 1.9, 0.68, { outline: false, gloss: 0.7 });
    leaf.position.set(DOOR - 1.5, 0, -2.0);
    leaf.rotation.y = 0.9;
    s.add(leaf);
    // The hallway beyond: floorboards, a far wall with a picture and a lamp that is still on.
    part(s, box(5, 0.3, 9), P.oak, LEFT - 2.5, -0.14, 0.95, { tex: 'woodFloor', ...flat });
    part(s, box(0.3, 11, 12), mix(P.clay, P.terracotta, 0.2), LEFT - 4.4, 5.5, 0.95, plaster);
    put(props.pictureFrame({ w: 0.7, h: 0.9, art: 'sunset' }), LEFT - 4.24, 2.9, 1.7, Math.PI / 2);
    put(props.sideTable({ h: 0.6 }), LEFT - 3.7, 0, -0.1);
    put(props.tableLamp({ lit: true, stand: P.teal }), LEFT - 3.7, 0.6 * K, -0.1);
    // Warm light on the kitchen floor, and a doormat where the sneakers start.
    part(s, box(2.6, 0.01, 4.3), P.lamp, DOOR + 0.5, 0.012, 0.95, { basic: true, opacity: 0.16, shadow: false });
    part(s, rbox(0.9, 0.05, 4.2, 0.02), P.mustard, DOOR + 0.35, 0.02, 0.95, { tex: 'terry', ...flat });

    // The fridge on the right: tall and pale, magnets on the door, a door that can swing open.
    const fridgeC = mix(P.sage, P.cream, 0.45);
    part(s, rbox(1.6, 4.4, 5.2, 0.14), fridgeC, FRIDGE + 0.8, 2.2, 0.5, { gloss: 0.35 });
    part(s, box(1.5, 0.16, 5.0), P.charcoal, FRIDGE + 0.8, 0.08, 0.5, flat);
    // The freezer side stays shut.
    part(s, rbox(0.14, 4.1, 2.5, 0.05), mix(fridgeC, '#ffffff', 0.1), FRIDGE - 0.08, 2.2, -0.75, { gloss: 0.35 });
    part(s, pill(0.05, 1.2), P.metal, FRIDGE - 0.22, 2.4, 0.3, { gloss: 0.7, outline: false });
    part(s, rbox(0.02, 0.22, 0.5, 0.01), P.screen, FRIDGE - 0.155, 3.3, -0.9, { glow: 1.3, ...flat });
    this.door.position.set(FRIDGE - 0.1, 0, 3.05);
    s.add(this.door);
    part(this.door, rbox(0.14, 4.1, 2.5, 0.05), mix(fridgeC, '#ffffff', 0.1), 0.02, 2.2, -1.25, { gloss: 0.35 });
    part(this.door, pill(0.05, 1.2), P.metal, -0.12, 2.4, -2.3, { gloss: 0.7, outline: false });
    const magnets = [P.terracotta, P.mustard, P.denim, P.rose];
    magnets.forEach((m, i) => part(this.door, cyl(0.09, 0.09, 0.04, 12), m, -0.07, 2.8 + (i % 2) * 0.5, -0.6 - i * 0.35, { rz: Math.PI / 2, outline: false }));
    part(this.door, box(0.02, 0.6, 0.45), P.cream, -0.06, 2.0, -1.2, { rx: 0.05, outline: false });
    part(this.door, box(0.02, 0.4, 0.5), mix(P.mustard, P.cream, 0.5), -0.06, 1.3, -0.75, { rx: -0.08, outline: false });
    // Inside (seen once the door opens): a warm glow, shelves and things to eat.
    part(s, box(0.02, 3.8, 2.3), '#fff8de', FRIDGE - 0.015, 2.2, 1.85, { glow: 1.1, ...flat });
    for (const y of [1.2, 2.2, 3.2]) part(s, box(0.03, 0.05, 2.3), P.stone, FRIDGE - 0.03, y, 1.85, flat);
    const snacks = [P.terracotta, P.mustard, P.teal, P.rose, P.moss, P.denim, P.copper];
    for (let i = 0; i < 9; i++) {
      const row = i % 3;
      part(s, box(0.03, 0.35 + ((i * 7) % 3) * 0.12, 0.3), snacks[i % snacks.length] as string, FRIDGE - 0.035, 1.25 + row + 0.25, 1.05 + Math.floor(i / 3) * 0.75 + row * 0.1, flat);
    }
    // The mat in front of the fridge: the finish.
    part(s, rbox(1.0, 0.05, 4.2, 0.02), P.terracotta, TOUCH - 0.05, 0.02, 0.95, { tex: 'terry', ...flat });
    part(s, rbox(0.7, 0.055, 3.9, 0.02), mix(P.terracotta, P.ink, 0.15), TOUCH - 0.05, 0.022, 0.95, { tex: 'terry', ...flat });

    // The right wall behind the fridge, with shelves and a plant in the corner.
    part(s, box(0.3, 11, 24), sideC, RIGHT + 0.15, 5.5, 8, plaster);
    put(props.wallShelf({ w: 1.5, seed: 9, items: 'kitchen' }), RIGHT - 0.01, 3.4, 5.4, -Math.PI / 2);
    put(props.pictureFrame({ w: 0.7, h: 0.5, art: 'moon' }), RIGHT - 0.01, 5.2, 5.6, -Math.PI / 2);
    const crate = put(props.crate({ s: 0.5 }), RIGHT - 1.0, 0, 4.6, 0.2);
    put(props.plant({ kind: 'fern', h: 0.6 }), 0, 0.5, 0, 0, 1, crate);

    // In front: the kitchen table with stools, and big plants by the door.
    put(props.table({ w: 1.9, d: 0.95, color: P.oak, cloth: P.terracotta }), 1.6, 0, 7.6);
    put(props.snackBowl({ fill: 'crisps', color: P.teal }), 1.2, 0.76 * K, 7.5);
    put(props.mug({ color: P.mustard }), 2.4, 0.76 * K, 7.3, 0.6);
    put(props.candle(), 1.9, 0.76 * K, 7.7);
    put(props.stool({ h: 0.5 }), -0.6, 0, 6.4, 0.3);
    put(props.stool({ h: 0.5, seat: P.teal }), 3.9, 0, 6.6, 1.2);
    put(props.plant({ kind: 'monstera', h: 1.2, pot: P.ceramic }), LEFT + 1.0, 0, 5.6);
    put(props.plant({ kind: 'snake', h: 0.9, pot: P.charcoal }), LEFT + 0.8, 0, 7.4);
    this.tick = props.tickProps(s);
  }

  /** A caught sneaker's ring flashes for a moment. */
  caught(seat: number): void {
    this.flash[seat] = 0;
  }

  /** Where a sneaker stands for a progress of 0..1. */
  static spot(pos: number, lane: number): THREE.Vector3 {
    return new THREE.Vector3(DOOR + 0.6 + pos * (TOUCH - DOOR - 0.6), 0, LANES[lane] ?? 0);
  }

  sync(s: Smuggle, dt: number): void {
    // Sneakers along their lanes.
    s.sneakers.forEach((sn, k) => {
      const rig = this.rigs[sn.seat];
      if (!rig) return;
      const p = Kitchen.spot(sn.pos, k);
      const root = rig.c.root;
      root.position.copy(p);
      rig.ring.position.set(p.x, 0.04, p.z);
      rig.card?.position.set(p.x, HEIGHT + 0.55, p.z);
      const walkingBack = sn.back > 0;
      const moving = isMoving(s, sn);
      const face = walkingBack ? -Math.PI / 2 : Math.PI / 2;
      root.rotation.y += Math.atan2(Math.sin(face - root.rotation.y), Math.cos(face - root.rotation.y)) * Math.min(1, dt * 12);
      // A little crouch while creeping.
      root.scale.set(1, moving ? 0.92 : 1, 1);
      const motion = walkingBack ? 'run' : moving ? 'walk' : null;
      if (motion !== rig.motion) {
        rig.motion = motion;
        rig.c.move(motion, walkingBack ? 5 : 0.6);
      }
      const mood: CompanionMood = walkingBack ? 'sad' : s.phase === 'look' || s.phase === 'turn' ? 'listening' : moving ? 'working' : 'thinking';
      if (mood !== rig.mood) {
        rig.mood = mood;
        rig.c.setBase(mood);
      }
    });
    // The keeper turns between the fridge (+x) and the room (-x), by way of the audience.
    if (s.phase === 'turn') this.turnTarget = Math.min(1, (s.time - s.phaseAt) / SMUGGLE.turn);
    else if (s.phase === 'look') this.turnTarget = 1;
    else if (s.phase === 'back') this.turnTarget = 1 - Math.min(1, (s.time - s.phaseAt) / SMUGGLE.turnBack);
    else this.turnTarget = 0;
    const k = this.rigs[this.keeper];
    if (k) {
      k.c.root.position.copy(KEEPER);
      k.ring.position.set(KEEPER.x, 0.03, KEEPER.z);
    }
    this.gazeLevel = s.phase === 'look' ? 1 : 0;
  }

  dispose(): void {
    for (const r of this.rigs) {
      r.c.dispose();
      r.card?.material.map?.dispose();
      r.card?.material.dispose();
    }
    this.keeperCard.material.map?.dispose();
    this.keeperCard.material.dispose();
    this.floaters.dispose();
    this.gazeMat.dispose();
    this.gaze.geometry.dispose();
  }

  private marks(): Mark[] {
    return [
      { p: new THREE.Vector3(DOOR - 1.3, 0, LANES[0] ?? 0), pad: 0.08 },
      { p: new THREE.Vector3(DOOR - 1.3, 0, LANES[2] ?? 0), pad: 0.08 },
      { p: new THREE.Vector3(FRIDGE + 1.4, 0, 3.2) },
      { p: new THREE.Vector3(FRIDGE + 1.4, 4.4, -2) },
      { p: new THREE.Vector3(KEEPER.x, HEIGHT + 0.9, KEEPER.z), pad: 0.05 },
      { p: new THREE.Vector3(DOOR, 4.3, -1.4) },
    ];
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks());
    this.tick(dt, time);
    // The microwave's clock blinks; caught rings flash and settle.
    if (this.clock) this.clock.visible = time % 1.4 < 1.0;
    this.rigs.forEach((r, i) => {
      const f = (this.flash[i] = (this.flash[i] ?? 9) + dt);
      const k = Math.max(0, 1 - f / 0.45);
      r.ring.scale.setScalar(1 + k * 0.5 * Math.abs(Math.cos(f * 20)));
    });
    this.fridgeLight.intensity = this.doorOpen * 26;
    for (const r of this.rigs) r.c.update(dt);
    this.floaters.update(dt);
    // Ease the keeper's turn (eased, so the creak has a little build-up).
    const k = this.rigs[this.keeper];
    if (k) {
      this.turn += (this.turnTarget - this.turn) * Math.min(1, dt * 18);
      const e = this.turn * this.turn * (3 - 2 * this.turn);
      k.c.root.rotation.y = Math.PI / 2 - e * Math.PI;
    }
    const cur = this.gazeMat.opacity / 0.2;
    const next = cur + (this.gazeLevel - cur) * Math.min(1, dt * 10);
    this.gazeMat.opacity = next * 0.2;
    this.gaze.visible = this.gazeMat.opacity > 0.005;
    this.door.rotation.y = this.doorOpen * 1.4;
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'snacksmuggle',
  title: 'Snack Smuggle',
  how: 'Sneakers: hold to creep from the door to the fridge, and freeze when the floor creaks. Keeper: tap to turn round, and anyone you catch moving goes back to the door. First to touch the fridge wins it for the three.',
  controller: 'hold',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const [side0, side1] = teamsOf(ctx);
    const keeper = side0?.[0] ?? 0;
    const sneakers = (side1 ?? seats.map((_, i) => i).filter((i) => i !== keeper)).slice(0, LANES.length);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const s = newSmuggle(keeper, sneakers);
    const view = new Kitchen(seats, await Promise.all(seats.map((x) => buildCompanion(x.look, { height: HEIGHT }))), keeper, sneakers);
    ctx.stage.setView(view);
    for (const [k, p] of sneakers.entries()) view.rigs[p]?.c.root.position.copy(Kitchen.spot(0, k));
    view.sync(s, 0);

    const keeperBrain: KeeperBrain = newKeeperBrain(cpu(keeper) ? ctx.skill() : 0.5);
    const brains = new Map<number, SneakBrain>(sneakers.filter(cpu).map((p) => [p, newSneakBrain(ctx.skill())] as const));
    const held = seats.map(() => false);
    let tapped = false;

    // Phones: the keeper's tap button unlocks whenever a turn is allowed; sneakers hold to creep.
    const keeperName = seats[keeper]?.name ?? 'The keeper';
    const keeperLayout = (ready: boolean): Layout => ({
      kind: 'tap',
      locked: !ready,
      label: 'Turn!',
      note: ready ? 'You keep the fridge. Tap to turn around!' : 'You keep the fridge. Facing the fridge… wait for it.',
    });
    let keeperReady: boolean | null = null;
    const syncKeeper = () => {
      const ready = canTurn(s);
      if (ready === keeperReady) return;
      keeperReady = ready;
      session.setLayout(seatOf(keeper), keeperLayout(ready));
    };
    for (const p of sneakers) {
      session.setLayout(seatOf(p), { kind: 'hold', label: 'Sneak', note: 'You’re sneaking! Hold to creep to the fridge, and let go when the floor creaks.' });
    }
    syncKeeper();
    const off = session.onInput((seat, msg) => {
      const p = posOf.get(seat);
      if (p === undefined || session.isCpu(seat)) return;
      if (p === keeper && msg.t === 'tap') tapped = true;
      else if (msg.t === 'hold' && sneakers.includes(p)) held[p] = msg.down;
    });

    ui.caption(`${keeperName} keeps the fridge. Sneakers: hold to creep, freeze when it creaks!`, seats[keeper]?.color);
    let hudAt = -1;
    let meterAt = -1;
    let stepAt = 0;
    const lastMeter = new Map<number, string>();
    await everyFrame(clock, (dt) => {
      // The keeper's turn: a tap from the phone, or the computer's choice.
      const wantTurn = cpu(keeper) ? cpuTap(s, keeperBrain, rng, dt) : tapped;
      tapped = false;
      if (wantTurn && turnRound(s)) {
        creak(sfx);
        view.floaters.add('creak…', '#d9d4ff', new THREE.Vector3(KEEPER.x - 0.6, 0.6, KEEPER.z + 1.2), 0.42, 0.9);
      }
      const holds = seats.map((_, p) => (cpu(p) ? (brains.get(p) ? cpuHold(s, brains.get(p) as SneakBrain, rng) : false) : (held[p] ?? false)));
      const grace = seats.map((_, p) => (cpu(p) ? 0 : Math.min(SMUGGLE.maxLag, (session.seats[seatOf(p)]?.rtt ?? 0) / 2000) * clock.speed));
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let i = 0; i < n && !isOver(s); i++) {
        const ev = stepSmuggle(s, holds, dt / n, grace);
        if (ev.looked) {
          hmm(sfx);
          view.rigs[keeper]?.c.react('approval', SMUGGLE.look);
        }
        for (const p of ev.caught) {
          sfx.bad();
          const at = view.rigs[p]?.c.root.position ?? new THREE.Vector3();
          view.floaters.add('Caught!', seats[p]?.color ?? '#ffffff', at.clone().setY(HEIGHT + 0.7), 0.5);
          view.caught(p);
          view.rigs[keeper]?.c.react('happy', 1.2);
          session.send(seatOf(p), { t: 'feedback', good: false, text: 'Caught moving! Back to the door.' });
          session.send(seatOf(p), { t: 'buzz', pattern: [80, 40, 80] });
          if (!cpu(keeper)) session.send(seatOf(keeper), { t: 'buzz', pattern: [30] });
        }
      }
      view.sync(s, dt);
      syncKeeper();
      // Soft sock steps while anyone creeps.
      if (s.sneakers.some((sn) => isMoving(s, sn)) && s.time - stepAt > 0.32) {
        stepAt = s.time;
        tiptoe(sfx);
      }
      // Each sneaker's ring shows how close they are; it turns to danger while the keeper turns or looks.
      if (s.time - meterAt > 0.07) {
        meterAt = s.time;
        const danger = s.phase === 'turn' || s.phase === 'look';
        for (const sn of s.sneakers) {
          if (cpu(sn.seat)) continue;
          const v = Math.round(sn.pos * 50) / 50;
          const key = `${v}|${danger}`;
          if (lastMeter.get(sn.seat) === key) continue;
          lastMeter.set(sn.seat, key);
          session.send(seatOf(sn.seat), { t: 'meter', value: v, danger });
        }
      }
      if (s.time - hudAt > 0.1) {
        hudAt = s.time;
        ui.timer(SMUGGLE.duration - s.time);
        const caught = s.sneakers.reduce((a, sn) => a + sn.caught, 0);
        ui.live(
          seats.map((x, p) => {
            const sn = s.sneakers.find((y) => y.seat === p);
            let value = '';
            if (p === keeper) value = `Keeper · ${caught} caught`;
            else if (sn) value = sn.back > 0 ? 'Caught!' : `${Math.floor(sn.pos * 100)}%`;
            return { name: x.name, color: x.color, thumb: x.thumb, value };
          }),
        );
      }
      return isOver(s);
    });
    off();
    ui.timer(null);

    // The end: the winner at the fridge, the door swings open (or stays shut).
    for (const r of view.rigs) {
      r.c.move(null);
      r.motion = null;
    }
    const winner = s.winner;
    if (winner !== null) {
      sfx.fanfare();
      ui.caption(`${seats[winner]?.name ?? 'A sneaker'} touched the fridge! Midnight snacks for the three.`, seats[winner]?.color);
      for (const p of sneakers) view.rigs[p]?.c.setBase('happy');
      view.rigs[keeper]?.c.setBase('sad');
      view.turnTarget = 1;
      await clock.tween(0.6, (k) => (view.doorOpen = k));
    } else {
      sfx.win();
      ui.caption(`The fridge is safe! ${keeperName} kept the snacks.`, seats[keeper]?.color);
      for (const p of sneakers) view.rigs[p]?.c.setBase('sad');
      view.rigs[keeper]?.c.setBase('happy');
      view.turnTarget = 1;
    }
    for (const x of seats) session.send(x.index, { t: 'buzz', pattern: [40, 30, 120] });
    await clock.wait(2);
    ui.caption(null);

    const caught = s.sneakers.reduce((a, sn) => a + sn.caught, 0);
    return {
      scores: smuggleScores(s, seats.length),
      details: seats.map((_, p) => {
        if (p === keeper) return winner === null ? `Kept the fridge · caught ${caught}` : `Fridge raided at ${s.time.toFixed(1)} s · caught ${caught}`;
        const sn = s.sneakers.find((y) => y.seat === p);
        if (!sn) return '';
        if (p === winner) return 'Touched the fridge!';
        const times = sn.caught === 0 ? 'never caught' : sn.caught === 1 ? 'caught once' : `caught ${sn.caught} times`;
        return `${winner === null ? 'Got' : 'Team snack · got'} ${Math.floor(sn.pos * 100)}% of the way · ${times}`;
      }),
    };
  },
};
