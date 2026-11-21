// Laser Kitty on the TV: a lamp-lit living room in the evening (laser dots show best then), a cushion in every corner (one per player), everyone standing by
// theirs with a laser pointer (the phone, pointed at the TV), and one big, lazy grey cat in the middle deciding
// which dot is worth getting up for. Lure it onto your cushion and it curls up for a nap that scores for you.
import * as THREE from 'three';
import {
  CAT,
  type Cat,
  type Dot,
  type LaserCpu,
  catScores,
  cpuLaser,
  cushions,
  moveDot,
  napper,
  newCat,
  newDot,
  newLaserCpu,
  stepCat,
  toFloor,
} from '../../../game/minigames/catlaser';
import { shuffle } from '../../../game/rng';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, canvasTexture, cone, cyl, gem, mix, nameCard, part, pill, rbox, sphere, texturedMaterial, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.3;
const TILT = 0.92;
const STEP = 1 / 60;
const FUR = mix(P.duskWall, P.cream, 0.42);
const STRIPE = mix(P.duskWall, P.plum, 0.3);
const CREAM = P.cream;
const ROOM = 1.9; // the furnished room's scale: the cat and the cushions are built big so they read from above

/** Scales a furnished room up to the game's size, lamps and shadows included. */
function scaleRoom(env: Env, k: number, shadow: number): void {
  env.root.scale.setScalar(k);
  for (const l of env.lamps) {
    l.intensity *= k ** 1.6;
    l.distance *= k;
  }
  const c = env.sun.shadow.camera;
  c.left = c.bottom = -shadow;
  c.right = c.top = shadow;
  c.updateProjectionMatrix();
}

// ------------------------------------------------------------------ sounds

/** A curious little "mrrp?". */
function mrrp(sfx: Sfx): void {
  tone(sfx, { freq: 420, to: 760, dur: 0.12, type: 'triangle', gain: 0.12 });
  tone(sfx, { freq: 760, to: 560, dur: 0.18, type: 'triangle', gain: 0.1, delay: 0.11 });
}

/** A startled hiss. */
function hiss(sfx: Sfx): void {
  noise(sfx, { dur: 0.35, filter: 'highpass', freq: 2600, gain: 0.14 });
}

/** A big, slow yawn. */
function yawn(sfx: Sfx): void {
  tone(sfx, { freq: 520, to: 300, dur: 0.5, gain: 0.08 });
}

/** One soft breath of a purr. */
function purr(sfx: Sfx): void {
  noise(sfx, { dur: 0.45, filter: 'lowpass', freq: 170, to: 120, gain: 0.35 });
}

// ------------------------------------------------------------------ the cat

interface Pose {
  bodyY: number;
  squash: number;
  legs: number;
  headY: number;
  headZ: number;
  headX: number;
  nod: number;
  turn: number;
  /** The tail: how far its root lifts, how much each piece bends up, and how much it curls sideways. */
  tailBase: number;
  tailUp: number;
  curl: number;
  puff: number;
}

const POSES: Record<'stand' | 'stalk' | 'startled' | 'nap', Pose> = {
  stand: { bodyY: 0.66, squash: 1, legs: 1, headY: 1.04, headZ: 0.82, headX: 0, nod: 0, turn: 0, tailBase: 0.5, tailUp: 0.12, curl: 0.05, puff: 1 },
  stalk: { bodyY: 0.52, squash: 0.95, legs: 0.75, headY: 0.82, headZ: 0.9, headX: 0, nod: 0.15, turn: 0, tailBase: 0.05, tailUp: 0, curl: 0.02, puff: 1 },
  startled: { bodyY: 0.78, squash: 1.18, legs: 1.15, headY: 1.1, headZ: 0.78, headX: 0, nod: -0.2, turn: 0, tailBase: 1.35, tailUp: 0.04, curl: 0, puff: 1.7 },
  nap: { bodyY: 0.34, squash: 0.72, legs: 0.12, headY: 0.48, headZ: 0.66, headX: 0.18, nod: 0.35, turn: 0.5, tailBase: -0.25, tailUp: 0, curl: 0.42, puff: 1 },
};

class CatModel {
  readonly root = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly tail: THREE.Group[] = [];
  private readonly open = new THREE.Group();
  private readonly shut = new THREE.Group();
  private readonly pose: Pose = { ...POSES.stand };
  private stride = 0;
  private hopAt = -9;

  constructor() {
    withOutline(0.035, () => {
      part(this.torso, pill(0.42, 0.95), FUR, 0, 0, 0, { rx: Math.PI / 2 });
      part(this.torso, sphere(0.34, 16), CREAM, 0, -0.14, 0.32, { sy: 0.7, sz: 0.9, outline: false });
      for (const z of [-0.35, -0.05, 0.25]) part(this.torso, rbox(0.56, 0.06, 0.12, 0.03), STRIPE, 0, 0.39, z, { outline: false });
      this.root.add(this.torso);

      part(this.head, sphere(0.38, 24), FUR, 0, 0, 0, { sx: 1.08 });
      part(this.head, sphere(0.18, 16), CREAM, 0, -0.12, 0.28, { sx: 1.35, sy: 0.75, outline: false });
      part(this.head, sphere(0.045, 8), P.rose, 0, -0.03, 0.4, { outline: false });
      for (const s of [-1, 1]) {
        part(this.head, cone(0.14, 0.28, 4), FUR, s * 0.22, 0.32, -0.02, { rz: -s * 0.35 });
        part(this.head, cone(0.08, 0.16, 4), P.rose, s * 0.21, 0.3, 0.04, { rz: -s * 0.35, outline: false });
        // Wide green eyes that catch the lamp light.
        part(this.open, sphere(0.075, 12), mix(P.olive, P.mustard, 0.4), s * 0.14, 0.07, 0.325, { outline: false, glow: 0.35 });
        part(this.open, sphere(0.05, 10), P.ink, s * 0.14, 0.07, 0.36, { outline: false, sx: 0.6 });
        part(this.open, sphere(0.02, 6), '#ffffff', s * 0.14 + 0.025, 0.1, 0.395, { outline: false });
        part(this.shut, rbox(0.13, 0.025, 0.03, 0.01), P.ink, s * 0.14, 0.06, 0.35, { rz: s * 0.15, outline: false });
        for (const k of [-1, 1]) part(this.head, cyl(0.008, 0.008, 0.36, 4), P.cream, s * 0.3, -0.1 + k * 0.035, 0.3, { rz: Math.PI / 2 + k * s * 0.12, outline: false });
      }
      part(this.head, rbox(0.42, 0.05, 0.08, 0.02), STRIPE, 0, 0.3, 0.12, { outline: false });
      this.shut.visible = false;
      this.head.add(this.open, this.shut);
      this.root.add(this.head);

      for (const [x, z] of [
        [-0.21, 0.45],
        [0.21, 0.45],
        [-0.23, -0.45],
        [0.23, -0.45],
      ] as const) {
        const leg = new THREE.Group();
        leg.position.set(x, 0.56, z);
        part(leg, cyl(0.1, 0.085, 0.5, 10), FUR, 0, -0.27, 0);
        part(leg, sphere(0.11, 10), CREAM, 0, -0.52, 0.03, { sy: 0.7 });
        this.legs.push(leg);
        this.root.add(leg);
      }

      let parent: THREE.Object3D = this.root;
      for (let k = 0; k < 6; k++) {
        const seg = new THREE.Group();
        seg.position.set(0, k === 0 ? 0.72 : 0, k === 0 ? -0.82 : -0.17);
        part(seg, sphere(0.1 - k * 0.006, 10), k === 5 || k === 3 ? STRIPE : FUR, 0, 0, -0.08, { sz: 1.3 });
        parent.add(seg);
        this.tail.push(seg);
        parent = seg;
      }
      // A collar with a little brass bell.
      part(this.head, torus(0.27, 0.035), P.brick, 0, -0.27, 0.02, { rx: Math.PI / 2 + 0.25, outline: false });
      part(this.head, sphere(0.05, 8), P.brass, 0, -0.33, 0.27, { outline: false, gloss: 0.7 });
    });
  }

  /** A little jump (startled). */
  hop(time: number): void {
    this.hopAt = time;
  }

  update(cat: Cat, dt: number, time: number): void {
    const near = cat.mode === 'chase' && cat.speed < CAT.trot * 0.6;
    const want = cat.mode === 'nap' ? POSES.nap : cat.mode === 'startled' ? POSES.startled : near ? POSES.stalk : POSES.stand;
    const k = Math.min(1, dt * (cat.mode === 'startled' ? 14 : 5));
    for (const key of Object.keys(want) as (keyof Pose)[]) this.pose[key] += (want[key] - this.pose[key]) * k;
    const p = this.pose;

    this.root.position.set(cat.x, 0, cat.z);
    const hopK = (time - this.hopAt) / 0.4;
    this.root.position.y = hopK >= 0 && hopK < 1 ? Math.sin(hopK * Math.PI) * 0.5 : 0;
    let dh = cat.heading - this.root.rotation.y;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.root.rotation.y += dh * Math.min(1, dt * 12);

    const breathe = cat.mode === 'nap' ? Math.sin(time * 2.2) * 0.03 : 0;
    this.torso.position.set(0, p.bodyY, 0);
    this.torso.scale.set(1 + (1 - p.squash) * 0.25, p.squash + breathe, 1);
    // Rear wiggle before a pounce.
    this.torso.rotation.z = near ? Math.sin(time * 18) * 0.05 : 0;
    const tempt = cat.mode === 'nap' ? cat.tempt : 0;
    this.head.position.set(p.headX, p.headY + tempt * 0.22, p.headZ);
    this.head.rotation.set(p.nod - tempt * 0.3, p.turn * (1 - tempt) + Math.sin(time * 0.7) * 0.15 * (cat.mode === 'idle' ? 1 : 0), 0);
    const asleep = cat.mode === 'nap' && tempt < 0.6;
    this.open.visible = !asleep;
    this.shut.visible = asleep;

    this.stride += dt * cat.speed * 5.5;
    const swing = Math.min(0.75, cat.speed * 0.35) + (cat.mode === 'settle' ? 0.4 : 0);
    this.legs.forEach((leg, i) => {
      leg.position.y = 0.56 * Math.max(0.35, p.legs);
      leg.scale.set(1, Math.max(0.05, p.legs), 1);
      leg.rotation.x = Math.sin(this.stride + (i === 0 || i === 3 ? 0 : Math.PI)) * swing;
    });
    const sway = Math.sin(time * (cat.mode === 'nap' ? 0.8 : 2.4));
    this.tail.forEach((seg, i) => {
      if (i === 0) seg.position.y = p.bodyY + 0.08;
      // Positive x lifts the tail (it points along -z).
      seg.rotation.x = i === 0 ? p.tailBase : p.tailUp;
      seg.rotation.y = p.curl * 1.6 + sway * (cat.mode === 'nap' ? 0.05 : 0.18);
      seg.scale.setScalar(i === 0 ? 1 : 1 + (p.puff - 1) * 0.4);
    });
  }
}

// ------------------------------------------------------------------ the room

interface DotView {
  group: THREE.Group;
  halo: THREE.Mesh;
  ring: THREE.Mesh;
  line: THREE.Line;
  pointer: THREE.Group;
}

class SunnyRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  readonly cat = new CatModel();
  readonly dots: DotView[] = [];
  readonly glows: THREE.Mesh[] = [];
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly haloMap = canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  private readonly cards: THREE.Sprite[] = [];
  private readonly made: { dispose(): void }[] = [];
  private readonly spots: THREE.Vector3[] = [];
  private readonly w = new THREE.Vector3();
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private sparks: { mesh: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];

  constructor(
    readonly seats: MinigameSeat[],
    readonly people: Companion[],
    pads: { x: number; z: number }[],
  ) {
    // The evening living room, built at 1 m scale and blown up; its own lamps stand out of shot, so ours do the work.
    this.env = livingRoom(this.scene, { mood: 'evening', w: 28 / ROOM, d: (2 * (CAT.halfD + 2.3)) / ROOM, h: 3.6, rug: false, lights: false, dress: 0.7, accent: P.terracotta, wall: P.sageWall, seed: 6 });
    scaleRoom(this.env, ROOM, 11);
    this.env.sun.intensity *= 1.15;
    // A darker parquet than the room's own boards: the cat, the cushions and the dots are what should catch the eye.
    const floor = this.env.root.children[0] as THREE.Mesh;
    const parquet = texturedMaterial('parquet', { color: mix(P.oak, P.walnut, 0.55), strength: 0.75 });
    floor.material = parquet;
    this.made.push(parquet);
    const set = new THREE.Group();
    withOutline(0.035, () => this.buildRoom(set));
    this.scene.add(set);
    this.tick = props.tickProps(set);
    this.scene.add(this.cat.root);

    seats.forEach((s, i) => {
      const pad = pads[i] ?? { x: 0, z: 0 };
      // The cushion: round, puffy, buttoned. Velvet in the player's colour a step down, piped in the full colour.
      const cushion = new THREE.Group();
      const fabric = mix(s.color, P.aubergine, 0.34);
      const velvet = { tex: 'velvet' as const, texStrength: 0.8, texScale: 1.2 };
      withOutline(0.035, () => {
        part(cushion, cyl(CAT.cushion, CAT.cushion, 0.26, 36), fabric, 0, 0.13, 0, velvet);
        part(cushion, new THREE.TorusGeometry(CAT.cushion - 0.05, 0.12, 12, 40), mix(fabric, P.cream, 0.16), 0, 0.24, 0, { rx: Math.PI / 2, ...velvet });
        part(cushion, torus(CAT.cushion + 0.02, 0.03), s.color, 0, 0.13, 0, { rx: Math.PI / 2, outline: false, exact: true });
        part(cushion, cyl(0.1, 0.1, 0.05, 12), mix(fabric, P.ink, 0.3), 0, 0.28, 0, { outline: false });
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          part(cushion, sphere(0.08, 8), s.color, Math.cos(a) * (CAT.cushion + 0.02), 0.14, Math.sin(a) * (CAT.cushion + 0.02), { outline: false, exact: true });
        }
      });
      cushion.position.set(pad.x, 0, pad.z);
      this.scene.add(cushion);
      const glow = part(this.scene, torus(CAT.cushion + 0.25, 0.05), s.color, pad.x, 0.04, pad.z, { rx: Math.PI / 2, glow: 1.6, shadow: false });
      glow.visible = false;
      this.glows.push(glow);

      // Its owner stands just outside the corner, laser in hand, turned to the room (and a little to us).
      const spot = new THREE.Vector3(pad.x + (Math.sign(pad.x) || 1) * 0.9, 0, pad.z + (Math.sign(pad.z) || 1) * 1.0);
      this.spots.push(spot);
      const c = people[i];
      const pointer = new THREE.Group();
      part(pointer, cyl(0.045, 0.045, 0.32, 12), P.charcoal, 0, 0, 0, { rx: Math.PI / 2, gloss: 0.6 });
      part(pointer, cyl(0.05, 0.05, 0.05, 12), P.brass, 0, 0, 0.13, { rx: Math.PI / 2, gloss: 0.7, outline: false });
      part(pointer, sphere(0.045, 8), s.color, 0, 0, 0.18, { glow: 2 });
      pointer.position.set(0.3, HEIGHT * 0.52, 0.28);
      if (c) {
        c.root.position.copy(spot);
        c.root.rotation.y = Math.atan2(-spot.x, 2.5 - spot.z);
        c.setBase('listening');
        c.root.add(pointer);
        this.scene.add(c.root);
      }
      const card = nameCard(s.name, s.color, 0.8);
      card.position.set(spot.x, HEIGHT + 0.45, spot.z);
      this.cards.push(card);
      this.scene.add(card);

      // The dot: a bright core, a soft halo and a thin ring, all in the player's colour.
      const group = new THREE.Group();
      part(group, cyl(0.12, 0.12, 0.02, 18), s.color, 0, 0.03, 0, { glow: 1.8, shadow: false });
      part(group, cyl(0.055, 0.055, 0.025, 12), '#ffffff', 0, 0.035, 0, { glow: 2.2, shadow: false });
      const haloMat = new THREE.MeshBasicMaterial({ map: this.haloMap, color: s.color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), haloMat);
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.04;
      halo.renderOrder = 1;
      group.add(halo);
      const ringMat = new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.8, depthWrite: false });
      const ring = new THREE.Mesh(torus(0.32, 0.022), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.05;
      group.add(ring);
      this.scene.add(group);
      const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(s.color).multiplyScalar(1.6), transparent: true, opacity: 0.5 });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.made.push(haloMat, halo.geometry, ringMat, lineMat, line.geometry);
      this.dots.push({ group, halo, ring, line, pointer });
    });
  }

  /** The game's own dressing on top of the furnished room: the rug, lamps, the cat's things, bits round the edges. */
  private buildRoom(s: THREE.Group): void {
    const put = <T extends THREE.Object3D>(o: T, x: number, z: number, ry = 0, k = ROOM, y = 0): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.multiplyScalar(k);
      s.add(o);
      return o;
    };
    // A round rug in the middle, where the cat starts.
    put(props.rug({ w: 7, round: true, color: mix(P.teal, P.aubergine, 0.3), border: P.sand }), 0, 0, 0, 1, -0.006);

    // Lamps in the back corners and one by the armchair: the room's light.
    put(props.floorLamp({ light: 13 }), -9.6, -4.9);
    put(props.floorLamp({ light: 13, shade: P.linen }), 9.9, -4.7);
    put(props.armchair({ color: P.terracotta, pillow: P.cream }), 9.9, -0.9, -Math.PI / 2 + 0.2, ROOM * 1.15);
    put(props.sideTable({ color: P.walnut }), 9.5, 1.5);
    put(props.tableLamp({ light: 8, stand: P.brass }), 9.5, 1.5, 0, ROOM, 0.5 * ROOM);

    // The cat's corner at the back: a scratching post with a perch, a food bowl, toys left about.
    const post = put(new THREE.Group(), 0.4, -5.0, 0, 1);
    part(post, rbox(1.6, 0.14, 1.3, 0.05), P.walnut, 0, 0.07, 0, { tex: 'wood' });
    part(post, cyl(0.2, 0.2, 2.0, 16), P.sand, -0.3, 1.1, 0, { tex: 'knit', texScale: 0.5 });
    part(post, cyl(0.62, 0.62, 0.16, 24), P.mauve, -0.3, 2.15, 0, { tex: 'terry' });
    part(post, cyl(0.02, 0.02, 0.6, 4), P.cream, 0.28, 1.8, 0.2, { outline: false });
    part(post, sphere(0.1, 10), P.brick, 0.28, 1.45, 0.2);
    put(props.snackBowl({ fill: 'crisps', color: P.ceramic, r: 0.12 }), 2.2, -4.9, 0, 3);
    part(s, sphere(0.2, 12), P.rose, -2.6, 0.2, -4.6, { tex: 'knit', texScale: 0.3 });
    part(s, cyl(0.012, 0.012, 0.9, 4), P.rose, -2.2, 0.02, -4.4, { rz: Math.PI / 2, ry: 0.6, outline: false, shadow: false });
    const mouse = put(new THREE.Group(), 8.9, 4.9, 0.8, 1);
    part(mouse, sphere(0.16, 10), P.stone, 0, 0.12, 0, { sz: 1.5 });
    for (const x of [-0.08, 0.08]) part(mouse, sphere(0.06, 8), P.rose, x, 0.24, 0.12, { outline: false });
    part(mouse, cyl(0.012, 0.012, 0.4, 4), P.rose, 0, 0.08, -0.4, { rx: Math.PI / 2, outline: false });

    // Left (behind the scores): a low table with tea things, a pouf; plants and a crate of records in the corners.
    put(props.coffeeTable({ w: 1.1, d: 0.6, color: P.walnut }), -10.6, 0.2, Math.PI / 2);
    put(props.mug({ color: P.rose }), -10.5, -0.2, 0.5, 2.6, 0.42 * ROOM);
    put(props.candle(), -10.7, 0.7, 0, 3, 0.42 * ROOM);
    put(props.pouf({ color: P.mustard }), -9.9, 3.2, 0, ROOM * 1.1);
    put(props.plant({ kind: 'monstera', h: 1.0, pot: P.terracotta, seed: 3 }), -9.9, 5.6, 0, ROOM);
    put(props.plant({ kind: 'snake', h: 0.8, pot: P.charcoal, seed: 2 }), 9.6, 5.9, 0, ROOM);
    put(props.crate({ color: P.oak }), -6.0, -5.0, 0.1, ROOM * 0.9);
    put(props.plant({ kind: 'fern', h: 0.7, pot: P.ceramic, seed: 9 }), 6.3, -5.0, 0, ROOM);
    put(props.motes({ n: 22, area: [18, 3, 10], size: 0.07 }), 0, 0, 0, 1, 0.5);
  }

  /** A puff of sparkles over the cushion the cat just curled up on. */
  sparkle(who: number): void {
    const g = this.glows[who];
    const color = this.seats[who]?.color ?? P.lamp;
    if (!g) return;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const mesh = part(this.scene, gem(0.07), k % 2 ? color : P.lamp, g.position.x + Math.cos(a) * 0.9, 0.4, g.position.z + Math.sin(a) * 0.9, { glow: 1.6, shadow: false });
      this.sparks.push({ mesh, v: new THREE.Vector3(Math.cos(a) * 1.2, 2.4 + (k % 3) * 0.6, Math.sin(a) * 1.2), age: 0 });
    }
  }

  /** Puts a dot on the floor; `dim` while the cat ignores it, `watched` while the cat is after it. */
  setDot(i: number, x: number, z: number, dim: boolean, watched: boolean, time: number): void {
    const d = this.dots[i];
    if (!d) return;
    d.group.position.set(x, 0, z);
    const pulse = watched ? 1 + Math.sin(time * 9) * 0.12 : 1;
    d.ring.scale.setScalar(pulse * (watched ? 1.25 : 1));
    (d.halo.material as THREE.MeshBasicMaterial).opacity = dim ? 0.25 : 0.9;
    (d.ring.material as THREE.MeshBasicMaterial).opacity = dim ? 0.25 : 0.8;
    const from = d.pointer.getWorldPosition(this.w);
    const pos = d.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, x, 0.05, z);
    pos.needsUpdate = true;
  }

  /** The cushion the cat naps on glows. */
  setNap(who: number | null): void {
    this.glows.forEach((g, i) => (g.visible = i === who));
  }

  catWord(text: string, color: string, size = 0.45): void {
    const p = this.cat.root.position;
    this.floaters.add(text, color, new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.4, 1.7, p.z), size, 1.4);
  }

  dispose(): void {
    for (const c of this.people) c.dispose();
    this.floaters.dispose();
    for (const card of this.cards) {
      card.material.map?.dispose();
      card.material.dispose();
    }
    for (const m of this.made) m.dispose();
    this.haloMap.dispose();
  }

  private marks(): Mark[] {
    const m: Mark[] = [];
    for (const x of [-CAT.halfW, CAT.halfW]) for (const z of [-CAT.halfD, CAT.halfD]) m.push({ p: new THREE.Vector3(x, 0, z), pad: 0.03 });
    for (const s of this.spots) m.push({ p: new THREE.Vector3(s.x, HEIGHT + 0.45, s.z), pad: 0.06 }, { p: s.clone(), pad: 0.03 });
    return m;
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks());
    this.floaters.update(dt);
    this.people.forEach((c) => c.update(dt));
    this.glows.forEach((g) => g.scale.setScalar(1 + Math.sin(time * 3) * 0.04));
    this.env.update(dt, time);
    this.tick(dt, time);
    this.sparks = this.sparks.filter((p) => {
      p.age += dt;
      p.v.y -= dt * 6;
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.rotation.y += dt * 6;
      p.mesh.scale.setScalar(Math.max(0.001, 1 - p.age / 0.8));
      if (p.age < 0.8) return true;
      this.scene.remove(p.mesh);
      return false;
    });
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'catlaser',
  title: 'Laser Kitty',
  how: 'Point your phone at the screen to move your laser dot. The cat follows dots that move slowly and steadily nearby, ignores still ones and gets spooked by fast ones. Lead it onto YOUR cushion: every second it naps there is yours.',
  controller: 'aim',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const pads = cushions(n);
    const view = new SunnyRoom(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), pads);
    ctx.stage.setView(view);
    const skills: (number | undefined)[] = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : undefined));
    const skillOf = (i: number) => (skills[i] ??= ctx.skill());
    const cat = newCat();
    // A phone's pointer starts in the middle (where it pointed first), so dots start there too, by the cat.
    // Computer players start a little way towards their own corner.
    const start = seats.map((_, i) => (session.isCpu(i) ? { x: (pads[i]?.x ?? 0) * 0.3, z: (pads[i]?.z ?? 0) * 0.3 } : { x: 0, z: 0 }));
    const dots: Dot[] = start.map((p) => newDot(p.x, p.z));
    const cpus: LaserCpu[] = start.map((p) => newLaserCpu(p.x, p.z));
    const pos = start.map((p) => ({ ...p }));
    const raw = start.map((p) => ({ x: p.x / CAT.halfW, y: -p.z / CAT.halfD }));
    const nap = seats.map(() => 0);
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'aim' || seat >= n || session.isCpu(seat)) return;
      const r = raw[seat];
      if (!r) return;
      r.x = msg.x;
      r.y = msg.y;
    });
    session.setLayoutAll(() => ({ kind: 'aim', note: 'Lead the cat to your cushion. Slow and steady!', button: null }));
    ui.caption('Lead the cat onto YOUR cushion. Slow and steady: fast dots spook it!');

    let t = 0;
    let acc = 0;
    let hudAt = -1;
    let zzzAt = 0;
    let purrAt = 0;
    let mrrpAt = -9;
    let lastNapper: number | null = null;
    await everyFrame(clock, (dt) => {
      acc += dt;
      while (acc >= STEP && t < CAT.duration) {
        acc -= STEP;
        t += STEP;
        const k = 1 - Math.exp(-STEP * 18);
        for (const i of shuffle(
          rng,
          seats.map((_, s) => s),
        )) {
          const p = pos[i] as { x: number; z: number };
          if (session.isCpu(i)) {
            const out = cpuLaser(cpus[i] as LaserCpu, i, cat, pads, t, STEP, skillOf(i), rng);
            p.x = out.x;
            p.z = out.z;
          } else {
            const r = raw[i] as { x: number; y: number };
            const f = toFloor(r.x, r.y);
            p.x += (f.x - p.x) * k;
            p.z += (f.z - p.z) * k;
            const c = cpus[i] as LaserCpu;
            c.x = p.x;
            c.z = p.z;
          }
          moveDot(dots[i] as Dot, p.x, p.z, t);
        }
        for (const ev of stepCat(cat, dots, pads, t, STEP)) {
          switch (ev.kind) {
            case 'chase':
              if (t - mrrpAt > 2.5) {
                mrrpAt = t;
                mrrp(sfx);
              }
              view.people[ev.dot]?.react('approval', 0.8);
              break;
            case 'spook':
              hiss(sfx);
              if (!ev.napping) view.cat.hop(clock.time);
              view.catWord('!', '#ffffff', 0.7);
              view.people[ev.dot]?.react('sad', 1.2);
              if (!session.isCpu(ev.dot)) {
                session.send(ev.dot, { t: 'feedback', good: false, text: 'Too fast! The cat is ignoring you for a moment.' });
                session.send(ev.dot, { t: 'buzz', pattern: [60, 40, 60] });
              }
              break;
            case 'settle':
              yawn(sfx);
              break;
            case 'nap':
              sfx.good();
              view.catWord('Zzz', seats[ev.cushion]?.color ?? '#ffffff', 0.5);
              view.sparkle(ev.cushion);
              view.people[ev.cushion]?.setBase('happy');
              view.people[ev.cushion]?.react('happy', 1.5);
              if (!session.isCpu(ev.cushion)) {
                session.send(ev.cushion, { t: 'feedback', good: true, text: 'Napping on your cushion! Keep your dot still.' });
                session.send(ev.cushion, { t: 'buzz', pattern: [20, 40, 20] });
              }
              zzzAt = t + 1;
              break;
            case 'wake':
              mrrp(sfx);
              view.people[ev.cushion]?.setBase('listening');
              view.people[ev.cushion]?.react('sad', 1.2);
              if (!session.isCpu(ev.cushion)) session.send(ev.cushion, { t: 'feedback', good: false, text: 'The cat got up. Lure it back!' });
              break;
            case 'lose':
              break;
          }
        }
        const who = napper(cat);
        if (who !== null) {
          nap[who] = (nap[who] ?? 0) + STEP;
          if (t >= zzzAt) {
            zzzAt = t + 1;
            view.catWord('z', seats[who]?.color ?? '#fff', 0.38);
          }
          if (t >= purrAt) {
            purrAt = t + 0.55;
            purr(sfx);
          }
        }
        if (who !== lastNapper) {
          lastNapper = who;
          view.setNap(who);
        }
      }
      view.cat.update(cat, dt, clock.time);
      seats.forEach((_, i) => {
        const p = pos[i];
        const d = dots[i];
        if (p && d) view.setDot(i, p.x, p.z, t < d.ignoreUntil, cat.mode === 'chase' && cat.target === i, clock.time);
      });
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(CAT.duration - t);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${(nap[i] ?? 0).toFixed(1)} s` })));
      }
      return t >= CAT.duration;
    });
    off();
    ui.timer(null);
    ui.caption(null);
    session.setLayoutAll(() => ({ kind: 'wait', title: 'Nap time is over', text: 'Counting the naps…' }));
    const best = Math.max(...nap);
    seats.forEach((_, i) => {
      if (best > 0 && nap[i] === best) view.people[i]?.react('happy', 3);
    });
    return {
      scores: catScores(nap),
      details: nap.map((s) => `${s.toFixed(1)} s of naps`),
    };
  },
};
