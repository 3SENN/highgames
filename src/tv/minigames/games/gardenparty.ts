// Garden Party on the TV: a backyard lawn at golden hour, a picket fence, string lights just coming on, and a dozen
// flower beds. Everyone walks a little watering can around; the flowers droop and fade as they get thirsty (a small
// meter above each one drains), spring back with a sparkle when watered, and flop over when they're lost.
import * as THREE from 'three';
import {
  GARDEN,
  type Garden,
  type GardenBrain,
  type GardenEvent,
  IDLE,
  type Stick,
  cpuGarden,
  gardenCoop,
  newGarden,
  newGardenBrain,
  standing,
  stepGarden,
} from '../../../game/minigames/gardenparty';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cone, cyl, dome, gem, material, mix, nameCard, outlineMaterial, part, plane, rbox, seeded, toonMat, torus } from '../../render/toon';
import type { Sfx } from '../../audio';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const STEP = 1 / 60; // rules step
const HEIGHT = 1.1; // the companions, next to knee-high flowers
const TILT = 0.95; // the camera looks down on the lawn
const FENCE_Z = -4.6;
const METER_Y = 1.55;
const FLOWER_SIZE = 0.9;

// Petals are the brightest things in the garden (after the players): rich, but out of the seat colours' way.
const PETALS = [mix(P.rose, P.neonPink, 0.45), mix(P.mustard, P.lamp, 0.55), mix(P.mauve, P.neonViolet, 0.45), mix(P.terracotta, P.ember, 0.35), mix(P.denim, P.screen, 0.65), P.cream, mix(P.brick, P.neonPink, 0.55)];
const DRY = new THREE.Color(mix(P.clay, P.olive, 0.4));
const LOST = new THREE.Color(mix(P.soil, P.stone, 0.4));
const METER = { good: mix(P.water, P.screen, 0.45), thirsty: P.lamp, danger: mix(P.ember, P.neonPink, 0.6) };
const QUIET = { outline: false as const };
const LAWN = '#5f8a52'; // the backyard's dusk lawn, which the mowing stripes sit on

// ------------------------------------------------------------------ flowers

interface FlowerRig {
  root: THREE.Group;
  /** Upper stem and bloom: bends at the middle of the stem as it droops. */
  bend: THREE.Group;
  head: THREE.Group;
  petalMat: THREE.MeshToonMaterial;
  hullMat: THREE.ShaderMaterial;
  base: THREE.Color;
  meter: THREE.Group;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  backMat: THREE.MeshBasicMaterial;
  /** The droop angle, sprung so a watered flower bounces back up. */
  droop: number;
  vel: number;
  lost: boolean;
}

/** A flower in a bed: stem, two leaves and one of three blooms, in its own petal material so it can fade. */
function buildFlower(kind: number): FlowerRig {
  const root = new THREE.Group();
  const rand = seeded(kind + 7);
  const shape = kind % 3;
  const base = new THREE.Color(PETALS[kind % PETALS.length] as string);
  const petalMat = toonMat({ color: base.clone() });
  const hullMat = outlineMaterial(base, 0.03).clone();
  // The bed: a mound of dark soil in a ring of pebbles.
  part(root, cyl(0.5, 0.58, 0.14, 20), P.soil, 0, 0.05, 0, { outline: 0.02 });
  part(root, cyl(0.44, 0.47, 0.03, 20), P.soilDark, 0, 0.125, 0, QUIET);
  for (let i = 0; i < 4; i++) part(root, ball(0.05 + rand() * 0.03, 0), mix(P.soilDark, P.ink, 0.2), (rand() - 0.5) * 0.5, 0.135, (rand() - 0.5) * 0.5, { sy: 0.5, ...QUIET });
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rand() * 0.25;
    part(root, ball(0.07 + rand() * 0.035, 0), mix(P.stone, i % 3 ? P.cream : P.slate, 0.3), Math.cos(a) * 0.57, 0.06, Math.sin(a) * 0.57, { sy: 0.7, ry: rand() * 3, ...QUIET });
  }
  // The stem in two halves and the leaves.
  const green = P.fern;
  part(root, cyl(0.035, 0.045, 0.5, 8), green, 0, 0.37, 0, { outline: 0.02 });
  for (const side of [-1, 1]) part(root, ball(0.12, 1), P.leaf, side * 0.13, 0.32 + side * 0.04, 0, { sx: 1.2, sy: 0.28, sz: 0.55, rz: side * 0.5, outline: 0.02 });
  const bend = new THREE.Group();
  bend.position.y = 0.6;
  root.add(bend);
  part(bend, cyl(0.03, 0.035, 0.42, 8), green, 0, 0.21, 0, { outline: 0.02 });
  const head = new THREE.Group();
  head.position.y = 0.44;
  bend.add(head);
  const petals = new THREE.Group();
  head.add(petals);
  if (shape === 0) {
    // A daisy: a flat ring of petals round a golden middle, turned up toward the sky.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      part(petals, ball(0.12, 1), '', Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17, { material: petalMat, sx: 1.25, sy: 0.3, sz: 0.55, ry: -a });
    }
    part(head, dome(0.1), P.mustard, 0, 0.01, 0, { sy: 0.6, tex: 'knit', texScale: 0.2 });
  } else if (shape === 1) {
    // A tulip: a cup of four petals.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      part(petals, ball(0.13, 1), '', Math.cos(a) * 0.07, 0.13, Math.sin(a) * 0.07, { material: petalMat, sx: 0.75, sy: 1.35, sz: 0.75, rz: Math.cos(a) * 0.25, rx: -Math.sin(a) * 0.25 });
    }
    part(head, ball(0.06, 1), P.moss, 0, 0.0, 0, QUIET);
  } else {
    // A pompom: a round cluster of little florets.
    part(petals, ball(0.15, 1), '', 0, 0.12, 0, { material: petalMat });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(petals, ball(0.075, 1), '', Math.cos(a) * 0.13, 0.12 + (i % 2 ? 0.06 : -0.05), Math.sin(a) * 0.13, { material: petalMat });
    }
    part(petals, ball(0.075, 1), '', 0, 0.27, 0, { material: petalMat });
  }
  petals.traverse((o) => {
    if (o.name === 'outline') (o as THREE.Mesh).material = hullMat;
  });
  // Turned so it droops to one side or the other, where the camera sees the bloom nod.
  root.rotation.y = (rand() < 0.5 ? 1 : -1) * (Math.PI / 2 + (rand() - 0.5) * 0.8);
  root.scale.setScalar(FLOWER_SIZE);

  // The thirst meter: a little droplet and a bar that drains, always facing the camera.
  const meter = new THREE.Group();
  meter.position.y = METER_Y;
  const backMat = new THREE.MeshBasicMaterial({ color: P.ink, transparent: true, opacity: 0.7, depthTest: false });
  const back = new THREE.Mesh(plane(0.82, 0.17), backMat);
  back.renderOrder = 4;
  const fillMat = new THREE.MeshBasicMaterial({ color: METER.good, depthTest: false, toneMapped: false, transparent: true });
  const fill = new THREE.Mesh(plane(0.74, 0.11), fillMat);
  fill.renderOrder = 5;
  const drop = new THREE.Group();
  drop.position.x = -0.53;
  const dropMat = new THREE.MeshBasicMaterial({ color: METER.good, depthTest: false, toneMapped: false, transparent: true });
  const dropBall = new THREE.Mesh(ball(0.075, 1), dropMat);
  const dropTip = new THREE.Mesh(cone(0.064, 0.1, 10), dropMat);
  dropTip.position.y = 0.075;
  dropBall.renderOrder = dropTip.renderOrder = 5;
  drop.add(dropBall, dropTip);
  meter.add(back, fill, drop);
  return { root, bend, head, petalMat, hullMat, base, meter, fill, fillMat, backMat, droop: 0, vel: 0, lost: false };
}

/** A gardener's little watering can, in their colour, held at the side. Returns it and its spout's tip. */
function wateringCan(color: string): { can: THREE.Group; tip: THREE.Object3D } {
  const can = new THREE.Group();
  const e = 0.6; // the spout's angle above level
  const tin = { gloss: 0.55, outline: 0.02 };
  part(can, cyl(0.12, 0.14, 0.22, 16), color, 0, 0, 0, tin);
  part(can, torus(0.115, 0.02), P.brass, 0, 0.11, 0, { rx: Math.PI / 2, gloss: 0.7, ...QUIET });
  part(can, torus(0.138, 0.012), P.brass, 0, -0.1, 0, { rx: Math.PI / 2, gloss: 0.7, ...QUIET });
  part(can, torus(0.1, 0.022, Math.PI), color, 0, 0.12, -0.02, { ry: Math.PI / 2, ...tin });
  part(can, cyl(0.022, 0.032, 0.3, 8), color, 0, -0.03 + Math.sin(e) * 0.15, 0.11 + Math.cos(e) * 0.15, { rx: Math.PI / 2 - e, ...tin });
  part(can, cyl(0.055, 0.03, 0.05, 10), P.brass, 0, -0.03 + Math.sin(e) * 0.31, 0.11 + Math.cos(e) * 0.31, { rx: Math.PI / 2 - e, gloss: 0.7, outline: 0.02 });
  const tip = new THREE.Object3D();
  tip.position.set(0, -0.03 + Math.sin(e) * 0.34, 0.11 + Math.cos(e) * 0.34);
  can.add(tip);
  return { can, tip };
}

/** A round little bee, facing +z. */
function beeModel(): { bee: THREE.Group; wings: THREE.Mesh[] } {
  const bee = new THREE.Group();
  part(bee, ball(0.1, 1), mix(P.mustard, P.lamp, 0.5), 0, 0, 0, { sz: 1.3, outline: 0.018 });
  part(bee, ball(0.065, 1), P.ink, 0, 0.01, 0.13, { outline: 0.018 });
  for (const z of [-0.02, -0.08]) part(bee, torus(0.094, 0.018), P.ink, 0, 0, z, { outline: false, s: 1 - Math.abs(z) * 1.5 });
  part(bee, cone(0.03, 0.07, 6), P.ink, 0, 0, -0.15, { rx: -Math.PI / 2, outline: false });
  const wings = [-1, 1].map((side) => {
    const w = part(bee, ball(0.075, 1), P.screen, side * 0.07, 0.09, -0.02, { sx: 0.6, sy: 0.12, sz: 1.0, opacity: 0.75, shadow: false });
    return w;
  });
  return { bee, wings };
}

interface GardenerRig {
  c: Companion;
  ring: THREE.Mesh;
  card: THREE.Sprite;
  can: THREE.Group;
  tip: THREE.Object3D;
  tilt: number;
  drip: number;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
}

interface BeeRig {
  bee: THREE.Group;
  wings: THREE.Mesh[];
  lastX: number;
  lastZ: number;
  phase: number;
}

interface Bit {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  /** Petals flutter as they fall; drops and sparkles don't. */
  flutter: boolean;
}

class GardenView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly rigs: GardenerRig[] = [];
  readonly flowers: FlowerRig[] = [];
  private bees: BeeRig[] = [];
  private bits: Bit[] = [];
  private env!: Env;
  readonly floaters: Floaters;
  private fit: CameraFit;
  private marks: Mark[];
  private dropMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.screen).multiplyScalar(1.15), transparent: true, opacity: 0.85 });
  private sparkMat = material(P.lamp, { glow: 2 });
  private v = new THREE.Vector3();

  constructor(seats: MinigameSeat[], companions: Companion[], g: Garden) {
    this.floaters = new Floaters(this.scene);
    this.buildYard();

    g.flowers.forEach((f) => {
      const rig = buildFlower(f.kind);
      rig.root.position.set(f.x, 0, f.z);
      rig.meter.position.set(f.x, METER_Y, f.z);
      this.scene.add(rig.root, rig.meter);
      this.flowers.push(rig);
    });

    seats.forEach((s, i) => {
      const c = companions[i] as Companion;
      const p = g.gardeners[i];
      c.root.position.set(p?.x ?? 0, 0, p?.z ?? 0);
      c.setBase('idle');
      this.scene.add(c.root);
      const { can, tip } = wateringCan(s.color);
      can.position.set(0.3, HEIGHT * 0.4, 0.2);
      c.root.add(can);
      const ring = part(this.scene, torus(0.42, 0.05), s.color, 0, 0.03, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      const card = nameCard(s.name, s.color, 0.7);
      this.scene.add(card);
      this.rigs.push({ c, ring, card, can, tip, tilt: 0, drip: 0, motion: null, mood: null });
    });

    g.bees.forEach(() => {
      const { bee, wings } = beeModel();
      this.scene.add(bee);
      this.bees.push({ bee, wings, lastX: 0, lastZ: 0, phase: Math.random() * 6 });
    });

    // The whole lawn and the meters over the back row, clear of the score list.
    const { x: bx, z: bz } = GARDEN.bounds;
    this.marks = [
      { p: new THREE.Vector3(-bx - 0.3, 0, bz + 0.5) },
      { p: new THREE.Vector3(bx + 0.3, 0, bz + 0.5) },
      { p: new THREE.Vector3(-bx - 0.3, METER_Y + 0.2, -bz + 0.4), pad: 0.03 },
      { p: new THREE.Vector3(bx + 0.3, METER_Y + 0.2, -bz + 0.4), pad: 0.03 },
    ];
    this.fit = new CameraFit(this.camera, TILT);
    this.fit.update(() => this.marks);
  }

  private buildYard(): void {
    const s = this.scene;
    // The garden at dusk: lawn, fence and hedges, trees beyond, the house along the left, lights coming on.
    this.env = backyard(s, { mood: 'evening', w: 17.6, d: 10.2, clear: { w: 14.2, d: 8 }, house: true, seed: 6 });
    this.env.sun.intensity *= 1.3;
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, sc = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc);
      s.add(o);
      return o;
    };
    // Mowing stripes across the lawn the players walk on.
    for (let i = 0; i < 8; i++) part(s, box(1.8, 0.02, 8.6), mix(LAWN, P.grass, i % 2 ? 0.5 : 0.28), -6.3 + i * 1.8, 0.012, -0.2, { tex: 'grass', outline: false, shadow: false });
    // A garden shed beyond the fence, its window lit.
    part(s, rbox(2.4, 2.3, 1.8, 0.06), P.wood, 5.6, 1.15, FENCE_Z - 2.6, { tex: 'planks' });
    part(s, cone(2.1, 0.9, 4), P.roof, 5.6, 2.75, FENCE_Z - 2.6, { ry: Math.PI / 4, sz: 0.8, tex: 'roofTiles', texScale: 1.2 });
    part(s, rbox(0.7, 0.55, 0.06, 0.03), P.lamp, 5.2, 1.7, FENCE_Z - 1.68, { glow: 1.3, shadow: false });
    for (const [w, h] of [[0.8, 0.05], [0.05, 0.62]] as const) part(s, box(w, h, 0.08), P.walnut, 5.2, 1.7, FENCE_Z - 1.66, QUIET);
    // Along the sides: a picnic blanket with lemonade and snacks, a bird bath, a hose reel, pots.
    put(props.blanket({ color: P.mauve, stripes: P.cream, w: 2.0, d: 1.6 }), -7.6, 0, 3.5, 0.2);
    put(props.snackBowl({ fill: 'fruit', color: P.ceramic }), -7.9, 0.03, 3.8);
    put(props.drink({ kind: 'bottle', color: P.forest }), -7.2, 0.03, 3.3);
    put(props.drink({ kind: 'can', color: P.mustard }), -7.0, 0.03, 3.75);
    put(props.pouf({ color: P.mustard }), -7.7, 0, 2.0);
    part(s, cyl(0.12, 0.2, 0.9, 12), P.stone, -7.7, 0.45, -1.9, { tex: 'concrete' });
    part(s, cyl(0.58, 0.3, 0.18, 20), P.stone, -7.7, 0.95, -1.9, { tex: 'concrete' });
    part(s, cyl(0.48, 0.48, 0.02, 20), P.water, -7.7, 1.045, -1.9, { gloss: 0.6, shadow: false, ...QUIET });
    part(s, cyl(0.45, 0.45, 0.2, 18), P.forest, 7.9, 0.5, 3.0, { rx: Math.PI / 2, ry: 0.3 });
    part(s, torus(0.45, 0.07), P.moss, 7.9, 0.5, 3.0, { ry: 0.3, ...QUIET });
    part(s, box(0.5, 0.08, 0.4), P.charcoal, 7.9, 0.04, 3.0, QUIET);
    put(props.plant({ kind: 'fern', h: 0.7, pot: P.terracotta, seed: 3 }), 7.9, 0, 1.9);
    put(props.plant({ kind: 'palm', h: 1.0, pot: P.ceramic, seed: 5 }), 7.8, 0, -2.0);
    put(props.crate({ s: 0.5 }), -7.9, 0, 0.2, 0.3);
    put(props.plant({ kind: 'monstera', h: 0.7, pot: P.charcoal }), -7.9, 0.5, 0.2);
    // In front of the lawn, nearest the camera: bushes and tufts in flower.
    put(props.bush({ r: 0.7, flowers: P.rose, seed: 7 }), -5.2, 0, 4.9);
    put(props.bush({ r: 0.55, flowers: P.cream, seed: 9 }), 6.6, 0, 4.8);
    put(props.rock({ r: 0.35, seed: 4 }), 4.9, 0, 4.9);
  }

  /** Puts everyone where the rules say they are, and makes the flowers look as thirsty as they are. */
  sync(g: Garden, dt: number, time: number): void {
    const follow = 1 - Math.exp(-dt * 12);
    g.gardeners.forEach((p, i) => {
      const rig = this.rigs[i];
      if (!rig) return;
      const root = rig.c.root;
      root.position.set(p.x, 0, p.z);
      rig.ring.position.set(p.x, 0.03, p.z);
      rig.card.position.set(p.x, HEIGHT + 0.5, p.z);
      root.rotation.y += Math.atan2(Math.sin(p.face - root.rotation.y), Math.cos(p.face - root.rotation.y)) * follow;
      const speed = Math.hypot(p.vx, p.vz);
      const motion = speed < 0.4 ? null : speed > 3.2 ? 'run' : 'walk';
      if (motion !== rig.motion) {
        rig.motion = motion;
        rig.c.move(motion, speed);
      }
      const mood: CompanionMood = p.pouring ? 'working' : 'idle';
      if (mood !== rig.mood) {
        rig.mood = mood;
        rig.c.setBase(mood);
      }
      // Tip the can while pouring, and let water fall from the spout.
      rig.tilt += ((p.pouring ? 0.75 : 0) - rig.tilt) * Math.min(1, dt * 12);
      rig.can.rotation.x = rig.tilt;
      if (p.pouring && rig.tilt > 0.4) {
        rig.drip += dt * 34;
        while (rig.drip >= 1) {
          rig.drip -= 1;
          rig.tip.getWorldPosition(this.v);
          const out = new THREE.Vector3(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y));
          this.spawn(this.dropMat, this.v, out.multiplyScalar(0.9 + Math.random() * 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, -0.4, (Math.random() - 0.5) * 0.5)), 0.5, 0.035, false);
        }
      }
    });

    g.flowers.forEach((f, i) => {
      const rig = this.flowers[i];
      if (!rig) return;
      // Droop toward how thirsty it is, on a spring so it bounces back up when watered.
      const target = f.lost ? 1.85 : Math.max(0, Math.min(1, (0.78 - f.h) / 0.78)) * 1.15;
      rig.vel += ((target - rig.droop) * 60 - rig.vel * 7) * dt;
      rig.droop += rig.vel * dt;
      rig.bend.rotation.x = rig.droop * 0.75;
      rig.head.rotation.x = rig.droop * 0.5;
      const k = f.lost ? 1 : Math.max(0, Math.min(1, (0.7 - f.h) / 0.7)) * 0.85;
      rig.petalMat.color.copy(rig.base).lerp(f.lost ? LOST : DRY, k);
      (rig.hullMat.uniforms.color?.value as THREE.Color).copy(rig.petalMat.color).multiplyScalar(0.62);
      rig.head.scale.setScalar(1 - 0.18 * k);
      // The meter.
      rig.meter.visible = !f.lost;
      if (!f.lost) {
        rig.meter.quaternion.copy(this.camera.quaternion);
        const h = Math.max(0.02, f.h);
        rig.fill.scale.x = h;
        rig.fill.position.x = -0.37 * (1 - h);
        const color = f.h >= GARDEN.thirsty ? METER.good : f.h >= GARDEN.danger ? METER.thirsty : METER.danger;
        rig.fillMat.color.set(color);
        rig.fillMat.opacity = f.h < GARDEN.danger ? 0.55 + 0.45 * Math.abs(Math.sin(time * 9)) : 1;
        rig.meter.scale.setScalar(f.cans ? 1.12 : 1);
      }
    });

    g.bees.forEach((b, i) => {
      const rig = this.bees[i];
      if (!rig) return;
      const angry = b.away > 0;
      rig.phase += dt * (angry ? 9 : 3);
      const wiggle = angry ? Math.sin(rig.phase * 2.3) * 0.25 : Math.sin(rig.phase) * 0.08;
      rig.bee.position.set(b.x + wiggle, 1.15 + Math.sin(rig.phase * 1.3) * 0.12 + (angry ? 0.4 : 0), b.z);
      const dx = b.x - rig.lastX;
      const dz = b.z - rig.lastZ;
      if (Math.hypot(dx, dz) > 1e-4) {
        const yaw = Math.atan2(dx, dz);
        rig.bee.rotation.y += Math.atan2(Math.sin(yaw - rig.bee.rotation.y), Math.cos(yaw - rig.bee.rotation.y)) * follow;
      }
      rig.lastX = b.x;
      rig.lastZ = b.z;
      const flap = Math.sin(time * (angry ? 90 : 60) + i);
      rig.wings.forEach((w, side) => (w.rotation.z = (side ? -1 : 1) * (0.3 + flap * 0.4)));
    });
  }

  /** A watered flower springs back up with a little sparkle. */
  perk(index: number): void {
    const rig = this.flowers[index];
    if (!rig) return;
    rig.vel -= 6;
    rig.head.getWorldPosition(this.v);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      this.spawn(this.sparkMat, this.v, new THREE.Vector3(Math.cos(a) * 1.1, 1.2 + Math.random() * 0.8, Math.sin(a) * 1.1), 0.7, 0.07, false, gem(1));
    }
  }

  /** A lost flower flops over and drops a few dry petals. */
  flop(index: number): void {
    const rig = this.flowers[index];
    if (!rig || rig.lost) return;
    rig.lost = true;
    rig.vel += 4;
    rig.head.getWorldPosition(this.v);
    const dry = material(mix(P.clay, P.olive, 0.4));
    for (let i = 0; i < 5; i++) {
      this.spawn(dry, this.v, new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.8), 1.6, 0.06, true);
    }
  }

  private spawn(mat: THREE.Material, at: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, flutter: boolean, geometry: THREE.BufferGeometry = ball(1, 0)): void {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.copy(at);
    mesh.scale.set(size, flutter ? size * 0.3 : size, size);
    this.scene.add(mesh);
    this.bits.push({ mesh, vel, age: 0, life, size, flutter });
  }

  dispose(): void {
    for (const r of this.rigs) r.c.dispose();
    for (const f of this.flowers) {
      f.petalMat.dispose();
      f.hullMat.dispose();
      f.fillMat.dispose();
      f.backMat.dispose();
      const drop = f.meter.children[2];
      drop?.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        m?.dispose();
      });
    }
    this.floaters.dispose();
    this.dropMat.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    for (const r of this.rigs) {
      r.c.update(dt);
      r.ring.scale.setScalar(1 + Math.sin(time * 3) * 0.04);
    }
    this.floaters.update(dt);
    this.bits = this.bits.filter((b) => {
      b.age += dt;
      if (b.flutter) {
        b.vel.y = Math.max(-0.6, b.vel.y - dt * 1.5);
        b.mesh.position.x += Math.sin(b.age * 6) * dt * 0.4;
        b.mesh.rotation.z += dt * 4;
      } else {
        b.vel.y -= dt * 7;
      }
      b.mesh.position.addScaledVector(b.vel, dt);
      const k = b.age / b.life;
      if (!b.flutter) b.mesh.scale.setScalar(b.size * Math.max(0.05, 1 - k * k));
      if (b.mesh.position.y < 0.04) {
        b.mesh.position.y = 0.04;
        b.vel.set(0, 0, 0);
      }
      if (k < 1) return true;
      this.scene.remove(b.mesh);
      return false;
    });
    this.env.update(dt, time);
  }
}

// ------------------------------------------------------------------ little sounds

function chime(sfx: Sfx, save: boolean): void {
  tone(sfx, { freq: save ? 880 : 1046, dur: 0.12, type: 'sine', gain: 0.1 });
  tone(sfx, { freq: save ? 1318 : 1396, dur: 0.22, type: 'sine', gain: 0.09, delay: 0.07 });
}

function flopSound(sfx: Sfx): void {
  tone(sfx, { freq: 392, to: 196, dur: 0.45, type: 'triangle', gain: 0.1 });
  noise(sfx, { dur: 0.18, freq: 300, gain: 0.12, delay: 0.32 });
}

function buzz(sfx: Sfx): void {
  for (let i = 0; i < 3; i++) tone(sfx, { freq: 210 + i * 25, to: 260 + i * 30, dur: 0.1, type: 'sawtooth', gain: 0.035, delay: i * 0.09 });
}

// ------------------------------------------------------------------ the minigame

export const minigame: Minigame = {
  id: 'gardenparty',
  title: 'Garden Party',
  how: 'The flowers are getting thirsty! Walk your watering can over and hold Water near a droopy flower to perk it up. Keep as many standing as you can until sunset (the bees don’t like a splash).',
  controller: 'stick',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const g = newGarden(rng, n);
    const brains: (GardenBrain | null)[] = seats.map((_, i) => (session.isCpu(i) ? newGardenBrain(ctx.skill()) : null));
    const inputs: Stick[] = seats.map(() => ({ ...IDLE }));
    const latch = seats.map(() => false);
    const view = new GardenView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), g);
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'stick', button: 'Water', note: 'Walk to a droopy flower and hold Water to perk it up.' }));
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'stick' || seat >= n || session.isCpu(seat)) return;
      // A quick tap can go down and up between two frames: still give it a splash.
      if (msg.a && !(inputs[seat] as Stick).a) latch[seat] = true;
      inputs[seat] = { x: msg.x, y: msg.y, a: msg.a };
    });

    const total = g.flowers.length;
    const status = () => `${standing(g)} of ${total} flowers standing. Keep them perky!`;
    let captionUntil = 0;
    const say = (text: string, color?: string) => {
      ui.caption(text, color);
      captionUntil = g.time + 2.6;
    };
    ui.caption('Hold Water by a droopy flower to perk it up!');
    captionUntil = 3;

    const handle = (e: GardenEvent) => {
      const f = g.flowers[e.kind === 'splash' ? 0 : e.flower];
      if (e.kind === 'perk') {
        view.perk(e.flower);
        chime(sfx, e.save);
        const first = e.seats[0];
        const who = first === undefined ? undefined : seats[first];
        if (e.save && f && who) view.floaters.add('Phew!', who.color, new THREE.Vector3(f.x, 1.55, f.z), 0.42);
        for (const s of e.seats) {
          view.rigs[s]?.c.react('happy', 0.9);
          session.send(s, { t: 'feedback', good: true, text: e.save ? 'Saved it, just in time!' : 'Perked up!' });
          session.send(s, { t: 'buzz', pattern: [15] });
        }
      } else if (e.kind === 'lost') {
        view.flop(e.flower);
        flopSound(sfx);
        for (const r of view.rigs) r.c.react('sad', 1.2);
        if (f) view.floaters.add('Flop.', '#d8cbb5', new THREE.Vector3(f.x, 1.2, f.z), 0.4);
        seats.forEach((_, i) => session.send(i, { t: 'feedback', good: false, text: 'A flower flopped… keep the others going!' }));
        say(`Oh no, one flopped. ${standing(g)} of ${total} still standing.`, '#d8a07a');
      } else if (e.kind === 'splash') {
        const b = g.bees[e.bee];
        buzz(sfx);
        if (b) view.floaters.add('Bzz!', '#ffd23f', new THREE.Vector3(b.x, 1.7, b.z), 0.36, 0.9);
        session.send(e.seat, { t: 'feedback', good: true, text: 'Bzzz! One very grumpy bee.' });
        session.send(e.seat, { t: 'buzz', pattern: [20, 30, 20, 30, 20] });
      }
    };

    let hudAt = -1;
    await everyFrame(clock, (dt, t) => {
      let left = dt;
      while (left > 1e-6 && g.time < GARDEN.duration) {
        const step = Math.min(STEP, left);
        left -= step;
        const sticks = seats.map((_, i) => {
          const b = brains[i];
          if (session.isCpu(i)) return cpuGarden(g, i, b ?? (brains[i] = newGardenBrain(0.5)), rng, step, brains);
          const s = inputs[i] as Stick;
          return { x: s.x, y: s.y, a: s.a || (latch[i] ?? false) };
        });
        latch.fill(false);
        for (const e of stepGarden(g, sticks, step, rng)) handle(e);
      }
      view.sync(g, dt, t);
      if (captionUntil && g.time > captionUntil) {
        captionUntil = 0;
        ui.caption(status());
      }
      if (g.time - hudAt > 0.2) {
        hudAt = g.time;
        ui.timer(GARDEN.duration - g.time);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${g.gardeners[i]?.perks ?? 0} perked up` })));
      }
      return g.time >= GARDEN.duration;
    });
    off();
    ui.timer(null);

    const coop = gardenCoop(g);
    const up = standing(g);
    for (const r of view.rigs) {
      r.c.move(null);
      r.c.setBase(coop >= 0.6 ? 'happy' : 'sad');
      r.can.rotation.x = 0;
    }
    for (const p of g.gardeners) p.pouring = false;
    session.setLayoutAll(() => ({ kind: 'wait', title: coop >= 0.8 ? 'What a garden!' : coop >= 0.5 ? 'Nice and green' : 'A bit crispy…', text: 'Watch the big screen' }));
    ui.caption(up === total ? `Every flower made it to sunset. Lovely work!` : `${up} of ${total} flowers made it to sunset.`);
    if (coop >= 0.6) sfx.good();
    else sfx.bad();
    await clock.wait(1.8);
    ui.caption(null);
    const score = Math.round(coop * 1000);
    return {
      scores: seats.map(() => score),
      details: g.gardeners.map((p) => {
        const perked = p.perks ? `Perked up ${p.perks} flower${p.perks === 1 ? '' : 's'}` : 'Kept the lawn company';
        return p.bees ? `${perked} · ${p.bees} grumpy bee${p.bees === 1 ? '' : 's'}` : perked;
      }),
      coop,
    };
  },
};
