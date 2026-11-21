// Where Are My Keys? on the TV: a cosy living room with six hiding spots. Everyone's keys get tucked away while
// they watch; then the lights dim, the cushions get fluffed and the cat wanders through (batting a keychain or
// two somewhere else from round two). Then: where are YOUR keys?
import * as THREE from 'three';
import { KEYS, type KeyRound, SPOTS, cpuGuess, keysScores, planRound, roundPoints } from '../../../game/minigames/keys';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, cone, cyl, gem, mix, nameCard, part, pill, popSprite, rbox, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const CAM_POS = new THREE.Vector3(-0.9, 8.6, 12.6); // a little left of centre: the live score list covers the left edge
const CAM_LOOK = new THREE.Vector3(-0.9, 0.9, -0.9);
/** One colour per spot, shared by the spot's name card on the TV and its button on the phones. */
const SPOT_COLORS = ['#e9a93a', '#5cbfa8', '#e07a5f', '#9b7bd4', '#e65a5a', '#4f9fd6'] as const;
const COMP_Z = 3.0;
const KEY_SCALE = 1.25;
const ROOM = 1.7; // the furnished room's scale: the hiding spots are built big so they read from the sofa
/** A spot's colour as its object wears it: a step down, so the name cards and seat colours stay the brightest. */
const tone = (c: string, k = 0.3) => mix(c, P.aubergine, k);

interface Spot {
  group: THREE.Group;
  /** Where keys go in, in world space. */
  anchor: THREE.Vector3;
  /** Where the cat stands to fish keys out. */
  front: THREE.Vector3;
  pokedAt: number;
}

/** A small "jingle" of keys: a few quick, high, slightly detuned pings. */
function jingle(sfx: Sfx, soft = false): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  for (let i = 0; i < 4; i++) {
    const t0 = ctx.currentTime + i * 0.045 + Math.random() * 0.02;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 2600 + Math.random() * 1800;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(soft ? 0.05 : 0.09, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  }
}

/** A short, curious "mrrp?" from the cat. */
function mrrp(sfx: Sfx): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(420, t0);
  osc.frequency.exponentialRampToValueAtTime(760, t0 + 0.12);
  osc.frequency.exponentialRampToValueAtTime(560, t0 + 0.3);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.4);
}

function keychain(color: string): THREE.Group {
  const g = new THREE.Group();
  const steel = { gloss: 0.7, outline: false as const };
  part(g, torus(0.16, 0.03), P.stone, 0, 0, 0, steel);
  const key = (x: number, rz: number, c: string) => {
    const k = new THREE.Group();
    part(k, cyl(0.1, 0.1, 0.045, 18), c, 0, -0.22, 0, { rx: Math.PI / 2, gloss: 0.7 });
    part(k, cyl(0.035, 0.035, 0.05, 10), P.ink, 0, -0.19, 0, { rx: Math.PI / 2, outline: false });
    part(k, rbox(0.06, 0.34, 0.03, 0.012), c, 0, -0.46, 0, { gloss: 0.7 });
    part(k, rbox(0.07, 0.04, 0.03, 0.01), c, 0.055, -0.52, 0, steel);
    part(k, rbox(0.05, 0.04, 0.03, 0.01), c, 0.045, -0.59, 0, steel);
    k.position.x = x;
    k.rotation.z = rz;
    g.add(k);
  };
  key(-0.06, 0.35, P.brass);
  key(0.06, -0.3, P.stone);
  // The fob, big and in the seat's colour, so everyone can follow their own.
  part(g, cyl(0.012, 0.012, 0.2, 4), P.stone, 0, -0.12, 0.06, steel);
  part(g, sphere(0.21, 20), color, 0, -0.36, 0.08, { glow: 0.45, exact: true });
  part(g, torus(0.07, 0.022), P.cream, 0, -0.36, 0.27, { outline: false });
  g.scale.setScalar(KEY_SCALE);
  return g;
}

function catModel(): { root: THREE.Group; legs: THREE.Mesh[]; tail: THREE.Mesh } {
  const root = new THREE.Group();
  const fur = mix(P.mustard, P.terracotta, 0.45);
  const stripe = P.copper;
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [
    [-0.16, 0.3],
    [0.16, 0.3],
    [-0.16, -0.3],
    [0.16, -0.3],
  ] as const) {
    legs.push(part(root, cyl(0.07, 0.065, 0.36, 10), fur, x, 0.18, z));
    part(root, sphere(0.075, 10), P.cream, x, 0.03, z + 0.02, { sy: 0.5, outline: false });
  }
  part(root, pill(0.27, 0.62), fur, 0, 0.5, 0, { rx: Math.PI / 2 });
  part(root, sphere(0.2, 14), P.cream, 0, 0.45, 0.32, { sx: 0.9, sz: 0.6, outline: false });
  for (const z of [-0.25, 0, 0.25]) part(root, rbox(0.42, 0.05, 0.09, 0.02), stripe, 0, 0.76, z, { outline: false });
  part(root, sphere(0.27, 18), fur, 0, 0.82, 0.55);
  part(root, sphere(0.12, 12), P.cream, 0, 0.75, 0.74, { sx: 1.3, sy: 0.7, outline: false });
  for (const x of [-0.14, 0.14]) {
    part(root, cone(0.1, 0.2, 4), fur, x, 1.08, 0.53, { rz: -x * 1.4 });
    part(root, sphere(0.045, 10), P.ink, x * 0.75, 0.88, 0.79, { outline: false, gloss: 0.6 });
  }
  part(root, sphere(0.03, 8), P.rose, 0, 0.79, 0.86, { outline: false });
  const tail = part(root, cyl(0.045, 0.07, 0.75, 8), fur, 0, 0.82, -0.68, { rx: -0.7 });
  return { root, legs, tail };
}

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

class LivingRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly spots: Spot[] = [];
  readonly keys: THREE.Group[] = [];
  readonly cat = catModel();
  catWalking = false;
  private fridgeDoor = new THREE.Group();
  private mess: THREE.Group[] = [];
  private lights: { light: THREE.Light; base: number }[] = [];
  private readonly env: Env;
  private readonly lit = new THREE.Color();
  private readonly dusk = new THREE.Color(P.midnight);
  private pops: { sprite: THREE.Sprite; age: number }[] = [];
  private sparks: { mesh: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private time = 0;

  constructor(
    seats: MinigameSeat[],
    readonly people: Companion[],
  ) {
    // An evening living room, built at 1 m scale and blown up to suit the big hiding spots.
    this.env = livingRoom(this.scene, { mood: 'evening', w: 12.5, d: 5.8, h: 3.7, rug: false, dress: 1, accent: P.mauve, wall: P.sageWall, seed: 2 });
    scaleRoom(this.env, ROOM, 11);
    // The corner lamp stands right by a pale wall: keep its pool soft, so the fridge's name card stays readable.
    for (const l of this.env.lamps) l.intensity *= 0.5;
    this.env.sun.target.position.set(0, 0, -0.5);
    this.lit.copy(this.scene.background as THREE.Color);
    // The room's own light, so it can dim (the lamps stay on).
    this.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight && !(l as THREE.PointLight).isPointLight) this.lights.push({ light: l, base: l.intensity });
    });
    this.buildRoom();
    this.buildSpots();
    this.buildMess();

    seats.forEach((s, i) => {
      const c = people[i];
      if (c) {
        c.root.position.set((i - (seats.length - 1) / 2) * 2.3, 0, COMP_Z);
        c.setBase('listening');
        this.scene.add(c.root);
        part(this.scene, torus(0.55, 0.045), s.color, c.root.position.x, 0.03, COMP_Z, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      }
      const k = keychain(s.color);
      k.visible = false;
      this.keys.push(k);
      this.scene.add(k);
    });
    this.cat.root.visible = false;
    this.scene.add(this.cat.root);

    this.fit();
  }

  /** Extra dressing on top of the furnished room. */
  private buildRoom(): void {
    const s = this.scene;
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, k = ROOM): void => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.multiplyScalar(k);
      s.add(o);
    };
    // A tiled splashback behind the fridge: the kitchen corner.
    part(s, rbox(3.4, 2.6, 0.06, 0.02), mix(P.sageWall, P.cream, 0.35), -7.2, 1.6, -4.88, { tex: 'kitchenTile', outline: false, shadow: false });
    // Foreground: a plant and a pouf in the bottom corners, a mug by the players' feet.
    put(props.plant({ kind: 'fern', h: 0.9, pot: P.charcoal, seed: 3 }), 8.4, 0, 4.6, 0.4);
    put(props.pouf({ color: P.rose }), -8.2, 0, 4.4);
    put(props.mug({ color: P.teal }), 6.6, 0, 3.4, 0.7, 2.2);
  }

  private addSpot(x: number, z: number, anchor: [number, number, number], front: [number, number, number], label: string, color: string, labelAt: [number, number], build: (g: THREE.Group) => void): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    withOutline(0.04, () => build(group));
    this.scene.add(group);
    const card = nameCard(label, color, 0.85);
    card.position.set(x + labelAt[0], labelAt[1], z);
    this.scene.add(card);
    this.spots.push({ group, anchor: new THREE.Vector3(...anchor), front: new THREE.Vector3(...front), pokedAt: -9 });
  }

  private buildSpots(): void {
    const [cCushion, cFridge, cPot, cHoodie, cCereal, cRug] = SPOT_COLORS;
    // 0: the couch, with big cushions to lose things between.
    this.addSpot(0, -3.7, [0, 1.05, -3.45], [0, 0, -2.2], SPOTS[0], cCushion, [0, 2.75], (g) => {
      const frame = P.denim;
      const fab = { tex: 'fabric' as const, texScale: 1.4 };
      part(g, rbox(4.6, 0.6, 1.7, 0.12), frame, 0, 0.42, 0, fab);
      part(g, rbox(4.6, 1.3, 0.5, 0.14), frame, 0, 1.1, -0.6, fab);
      for (const x of [-2.3, 2.3]) part(g, rbox(0.5, 1.0, 1.7, 0.2), mix(frame, P.ink, 0.08), x, 0.75, 0, fab);
      const cushion = tone(cCushion, 0.18);
      for (const x of [-1.03, 1.03]) {
        part(g, rbox(2.02, 0.38, 1.35, 0.17), cushion, x, 0.88, 0.1, { tex: 'velvet', texStrength: 0.8 });
        part(g, rbox(1.9, 0.95, 0.38, 0.18), mix(cushion, P.cream, 0.14), x, 1.38, -0.32, { rx: -0.12, tex: 'velvet', texStrength: 0.8 });
        part(g, sphere(0.05, 8), mix(cushion, P.ink, 0.3), x, 1.42, -0.12, { outline: false });
      }
      part(g, rbox(0.62, 0.62, 0.22, 0.1), P.cream, -1.85, 1.3, 0.08, { rz: 0.3, rx: -0.2, tex: 'knit' });
      for (const x of [-2.1, 2.1]) for (const z of [-0.6, 0.6]) part(g, cyl(0.08, 0.06, 0.14, 8), P.walnut, x, 0.06, z, { outline: false });
    });
    // 1: the fridge, with a door that swings open.
    this.addSpot(-7.2, -3.7, [-7.2, 1.3, -3.0], [-6.2, 0, -2.2], SPOTS[1], cFridge, [0, 3.85], (g) => {
      const body = mix(P.sage, P.ceramic, 0.15);
      const door = mix(body, P.cream, 0.2);
      const handle = tone(cFridge, 0.1);
      part(g, rbox(1.5, 3.2, 1.3, 0.12), body, 0, 1.6, 0, { gloss: 0.3 });
      part(g, rbox(1.44, 1.05, 0.1, 0.06), door, 0, 2.55, 0.66, { gloss: 0.35 });
      part(g, pill(0.045, 0.6), handle, 0.55, 2.35, 0.75, { gloss: 0.6 });
      part(g, rbox(1.3, 0.1, 1.1, 0.03), P.charcoal, 0, 0.05, 0.02, { outline: false });
      this.fridgeDoor.position.set(-0.72, 1.0, 0.66);
      part(this.fridgeDoor, rbox(1.44, 1.9, 0.1, 0.06), door, 0.72, 0, 0, { gloss: 0.35 });
      part(this.fridgeDoor, pill(0.045, 0.9), handle, 1.27, 0.35, 0.09, { gloss: 0.6 });
      part(this.fridgeDoor, cyl(0.08, 0.08, 0.03, 14), P.terracotta, 0.4, 0.6, 0.07, { rx: Math.PI / 2, outline: false });
      part(this.fridgeDoor, cyl(0.06, 0.06, 0.03, 14), P.mustard, 0.95, 0.72, 0.07, { rx: Math.PI / 2, outline: false });
      part(this.fridgeDoor, rbox(0.3, 0.38, 0.02, 0.01), P.cream, 0.75, 0.3, 0.06, { rz: 0.1, outline: false });
      g.add(this.fridgeDoor);
    });
    // 2: a plant pot with a chunky cactus and a single pink flower.
    this.addSpot(-5.6, 0.6, [-5.32, 0.86, 0.72], [-4.5, 0, 1.6], SPOTS[2], cPot, [0, 2.65], (g) => {
      const pot = tone(cPot, 0.14);
      part(g, cyl(0.58, 0.44, 0.8, 24), pot, 0, 0.4, 0, { gloss: 0.25 });
      part(g, torus(0.58, 0.07), mix(pot, P.cream, 0.15), 0, 0.8, 0, { rx: Math.PI / 2 });
      part(g, cyl(0.52, 0.52, 0.04, 24), P.espresso, 0, 0.78, 0, { outline: false });
      part(g, cyl(0.66, 0.7, 0.07, 24), mix(pot, P.ink, 0.15), 0, 0.035, 0, { outline: false });
      part(g, pill(0.27, 0.8), P.fern, -0.05, 1.35, -0.05);
      part(g, pill(0.14, 0.3), P.moss, -0.38, 1.4, -0.05, { rz: 0.3 });
      part(g, pill(0.12, 0.22), P.moss, 0.27, 1.55, -0.05, { rz: -0.4 });
      for (let k = 0; k < 6; k++) part(g, cyl(0.012, 0.012, 1.05, 4), mix(P.fern, P.ink, 0.25), -0.05 + Math.cos(k * 1.05) * 0.262, 1.35, -0.05 + Math.sin(k * 1.05) * 0.262, { outline: false, shadow: false });
      part(g, sphere(0.11, 10), P.rose, -0.05, 1.95, -0.05);
      part(g, sphere(0.05, 8), P.mustard, -0.05, 2.03, -0.05, { outline: false });
    });
    // 3: a hoodie slung over the back of a chair.
    this.addSpot(4.3, -3.5, [4.3, 1.35, -3.68], [3.9, 0, -2.2], SPOTS[3], cHoodie, [0, 3.25], (g) => {
      const wood = { tex: 'wood' as const };
      const hoodie = tone(cHoodie, 0.22);
      for (const [x, z] of [
        [-0.55, 0.45],
        [0.55, 0.45],
        [-0.55, -0.5],
        [0.55, -0.5],
      ] as const) {
        part(g, cyl(0.06, 0.05, 0.95, 8), P.walnut, x, 0.47, z);
      }
      part(g, rbox(1.3, 0.14, 1.15, 0.05), P.wood, 0, 0.98, 0, wood);
      part(g, rbox(1.3, 1.2, 0.12, 0.05), P.wood, 0, 1.65, -0.52, wood);
      part(g, rbox(1.4, 1.05, 0.3, 0.14), hoodie, 0, 1.6, -0.36, { tex: 'knit' });
      part(g, sphere(0.38, 18), mix(hoodie, P.ink, 0.14), 0, 2.2, -0.55, { sz: 0.7, tex: 'knit' });
      for (const x of [-0.78, 0.78]) part(g, pill(0.15, 0.7), hoodie, x, 1.4, -0.32, { rz: x > 0 ? 0.12 : -0.12, tex: 'knit' });
      part(g, rbox(0.8, 0.3, 0.06, 0.04), mix(hoodie, P.ink, 0.2), 0, 1.35, -0.19, { outline: false });
      for (const x of [-0.12, 0.12]) part(g, cyl(0.02, 0.02, 0.4, 4), P.cream, x, 1.88, -0.2, { outline: false });
    });
    // 4: a cereal box on a little side table.
    this.addSpot(5.6, 0.6, [5.6, 2.36, 0.6], [4.5, 0, 1.6], SPOTS[4], cCereal, [0, 3.6], (g) => {
      const boxColor = tone(cCereal, 0.2);
      part(g, cyl(0.4, 0.46, 0.08, 18), P.walnut, 0, 0.04, 0);
      part(g, cyl(0.07, 0.07, 1.0, 8), P.walnut, 0, 0.5, 0);
      part(g, cyl(0.75, 0.75, 0.1, 32), P.wood, 0, 1.0, 0, { tex: 'wood', gloss: 0.2 });
      part(g, rbox(0.85, 1.25, 0.38, 0.04), boxColor, 0, 1.68, 0);
      part(g, rbox(0.86, 0.2, 0.39, 0.02), P.cream, 0, 2.05, 0, { outline: false });
      part(g, cyl(0.26, 0.26, 0.02, 24), P.cream, 0, 1.55, 0.19, { rx: Math.PI / 2, outline: false });
      part(g, sphere(0.2, 16), P.mustard, 0, 1.56, 0.2, { sz: 0.25, sy: 0.8, outline: false });
      for (let i = 0; i < 5; i++) part(g, torus(0.05, 0.025), P.sand, -0.5 + i * 0.22, 1.07, 0.45 - (i % 2) * 0.15, { rx: Math.PI / 2, outline: false });
      const bowl = props.snackBowl({ fill: 'popcorn', color: P.teal, r: 0.2 });
      bowl.position.set(-0.38, 1.05, -0.3);
      g.add(bowl);
    });
    // 5: the rug, which hides things surprisingly well.
    this.addSpot(0, -0.4, [1.1, 0.08, -0.3], [1.1, 0, 1.4], SPOTS[5], cRug, [-1.1, 0.75], (g) => {
      const rug = tone(cRug, 0.34);
      const fab = { tex: 'terry' as const, outline: false as const, shadow: false };
      part(g, rbox(4.6, 0.06, 2.8, 0.03), mix(rug, P.cream, 0.5), 0, 0.03, 0, fab);
      part(g, rbox(4.3, 0.065, 2.5, 0.03), rug, 0, 0.035, 0, fab);
      part(g, rbox(3.6, 0.07, 1.8, 0.03), mix(rug, P.ink, 0.16), 0, 0.038, 0, fab);
      for (const z of [-0.5, 0, 0.5]) part(g, rbox(3.2, 0.072, 0.07, 0.02), mix(rug, P.cream, 0.4), 0, 0.04, z, fab);
      for (const x of [-2.36, 2.36]) for (let k = 0; k < 9; k++) part(g, cyl(0.02, 0.02, 0.18, 4), P.cream, x + Math.sign(x) * 0.05, 0.03, -1.2 + k * 0.3, { rz: Math.PI / 2, outline: false, shadow: false });
    });
  }

  /** Clutter that lands when the room gets messed up. */
  private buildMess(): void {
    const add = (x: number, z: number, build: (g: THREE.Group) => void) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      build(g);
      g.visible = false;
      this.mess.push(g);
      this.scene.add(g);
    };
    const prop = (g: THREE.Group, o: THREE.Object3D, k: number, ry = 0) => {
      o.scale.setScalar(k);
      o.rotation.y = ry;
      g.add(o);
    };
    add(-2.7, 1.1, (g) => part(g, rbox(0.9, 0.35, 0.9, 0.16), P.rose, 0, 0.2, 0, { ry: 0.5, rz: 0.2, tex: 'velvet' }));
    add(2.8, 1.3, (g) => prop(g, props.pizzaBox({ open: true, slices: 2 }), 2.4, -0.3));
    add(-1.9, -1.9, (g) => part(g, pill(0.1, 0.4), P.cream, 0, 0.1, 0, { rz: Math.PI / 2, ry: 0.7, tex: 'knit' }));
    add(-2.25, -3.45, (g) => part(g, rbox(0.7, 0.9, 1.6, 0.08), P.mauve, 0, 1.3, 0, { rz: 0.2, tex: 'knit' }));
    add(3.4, -1.7, (g) => prop(g, props.snackBowl({ fill: 'popcorn', color: P.denim }), 2.6));
    add(1.5, 1.8, (g) => prop(g, props.remote(), 2.6, 0.4));
  }

  setMess(k: number): void {
    this.mess.forEach((m, i) => {
      const local = Math.min(1, Math.max(0, k * this.mess.length - i * 0.6));
      m.visible = local > 0;
      m.scale.setScalar(Math.max(0.001, ease.outBack(local)));
    });
  }

  /** 0 = the evening's light, 1 = dim and moody (the lamps stay on). */
  setDim(d: number): void {
    for (const l of this.lights) l.light.intensity = l.base * (1 - 0.62 * d);
    (this.scene.background as THREE.Color).copy(this.lit).lerp(this.dusk, d);
    this.scene.fog?.color.copy(this.scene.background as THREE.Color);
  }

  /** A puff of sparkles over a player's head (their keys are found). */
  sparkle(seat: number, color: string): void {
    const at = this.overHead(seat);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const mesh = part(this.scene, gem(0.07), k % 2 ? color : P.lamp, at.x, at.y - 0.3, at.z, { glow: 1.6, shadow: false });
      this.sparks.push({ mesh, v: new THREE.Vector3(Math.cos(a) * 1.8, 2 + (k % 3) * 0.6, Math.sin(a) * 0.9), age: 0 });
    }
  }

  poke(spot: number): void {
    const s = this.spots[spot];
    if (s) s.pokedAt = this.time;
  }

  setFridge(open: number): void {
    this.fridgeDoor.rotation.y = -1.5 * open;
  }

  /** Where seat `seat`'s keys sit at `spot`, spread out if several are there. */
  restAt(spot: number, slot: number, of: number): THREE.Vector3 {
    const s = this.spots[spot];
    const p = s ? s.anchor.clone() : new THREE.Vector3();
    p.x += (slot - (of - 1) / 2) * 0.55;
    p.y += 0.75;
    return p;
  }

  overHead(seat: number): THREE.Vector3 {
    const c = this.people[seat];
    return new THREE.Vector3(c?.root.position.x ?? 0, 2.15, COMP_Z + 0.1);
  }

  label(seat: number, text: string, color: string): void {
    const c = this.people[seat];
    if (!c) return;
    const s = popSprite(text, color, 0.6);
    s.position.set(c.root.position.x, 2.7, COMP_Z);
    this.scene.add(s);
    this.pops.push({ sprite: s, age: 0 });
  }

  dispose(): void {
    for (const c of this.people) c.dispose();
  }

  private fittedFor = 0;
  /** Pulls the camera back on screens narrower than 16:9, so every hiding spot stays in the picture. */
  private fit(): void {
    if (this.camera.aspect === this.fittedFor) return;
    this.fittedFor = this.camera.aspect;
    const back = Math.max(1, 16 / 9 / this.camera.aspect);
    this.camera.position.copy(CAM_LOOK).addScaledVector(CAM_POS.clone().sub(CAM_LOOK), back);
    this.camera.lookAt(CAM_LOOK);
  }

  update(dt: number, time: number): void {
    this.fit();
    this.time = time;
    for (const c of this.people) c.update(dt);
    this.env.update(dt, time);
    this.sparks = this.sparks.filter((p) => {
      p.age += dt;
      p.v.y -= dt * 6;
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.rotation.y += dt * 6;
      p.mesh.scale.setScalar(Math.max(0.001, 1 - p.age / 0.7));
      if (p.age < 0.7) return true;
      this.scene.remove(p.mesh);
      return false;
    });
    this.keys.forEach((k, i) => {
      if (k.visible) k.rotation.z = Math.sin(time * 3.2 + i * 1.7) * 0.22;
    });
    for (const s of this.spots) {
      const age = time - s.pokedAt;
      const wob = age < 1 ? Math.sin(age * 22) * Math.exp(-age * 5) * 0.09 : 0;
      s.group.scale.set(1 + wob * 0.5, 1 - wob, 1 + wob * 0.5);
    }
    if (this.catWalking) {
      this.cat.legs.forEach((l, i) => (l.rotation.x = Math.sin(time * 16 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5));
      this.cat.root.position.y = Math.abs(Math.sin(time * 16)) * 0.05;
    }
    this.cat.tail.rotation.z = Math.sin(time * 2.5) * 0.3;
    this.pops = this.pops.filter((p) => {
      p.age += dt;
      p.sprite.position.y += dt * 0.5;
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - Math.max(0, p.age - 1.1) / 0.5);
      if (p.age > 1.6) this.scene.remove(p.sprite);
      return p.age <= 1.6;
    });
  }
}

export const minigame: Minigame = {
  id: 'keys',
  title: 'Where Are My Keys?',
  how: 'Watch where your keys (the keychain in your colour) get tucked away; the room gets messy and the cat gets curious. Then press the spot where YOUR keys are: first right answer scores most, wrong guesses lock you out for a moment.',
  controller: 'buttons',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const view = new LivingRoom(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.25 }))));
    ctx.stage.setView(view);
    const skill = seats.map(() => ctx.skill());
    const points = seats.map(() => 0);
    const found = seats.map(() => 0);
    const totalTime = seats.map(() => 0);
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${points[i]} pts` })));
    live();

    /** Moves an object along an arc. */
    const arc = (o: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, seconds: number, lift: number) =>
      clock.tween(seconds, (k) => {
        o.position.lerpVectors(from, to, k);
        o.position.y += Math.sin(k * Math.PI) * lift;
      });
    const tuck = async (seat: number, spot: number) => {
      const key = view.keys[seat];
      const s = view.spots[spot];
      if (!key || !s) return;
      const from = key.position.clone();
      if (spot === 1) void clock.tween(0.2, (k) => view.setFridge(k));
      await clock.tween(0.3, (k) => {
        key.position.lerpVectors(from, s.anchor, k);
        key.scale.setScalar(KEY_SCALE * (1 - k * 0.95));
      });
      key.visible = false;
      key.scale.setScalar(KEY_SCALE);
      view.poke(spot);
      jingle(sfx, true);
      if (spot === 1) void clock.wait(0.2).then(() => clock.tween(0.25, (k) => view.setFridge(1 - k)));
    };
    const walkCat = async (to: THREE.Vector3, speed = 6.5) => {
      const cat = view.cat.root;
      const from = cat.position.clone();
      from.y = 0;
      cat.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      view.catWalking = true;
      await clock.tween(from.distanceTo(to) / speed, (k) => {
        cat.position.x = from.x + (to.x - from.x) * k;
        cat.position.z = from.z + (to.z - from.z) * k;
      }, ease.linear);
      view.catWalking = false;
      cat.position.y = 0;
    };

    for (let round = 0; round < KEYS.rounds; round++) {
      const plan: KeyRound = planRound(rng, seats.length, round);
      const flight = [1.0, 0.85, 0.7][round] ?? 0.7;

      // 1. Everyone watches their keys fly into the spots.
      session.setLayoutAll(() => ({ kind: 'wait', title: 'Watch your keys!', text: 'Yours have the keychain in your colour.' }));
      ui.caption(`Round ${round + 1} of ${KEYS.rounds}: watch where your keys go!`);
      seats.forEach((_, i) => view.people[i]?.setBase('listening'));
      await Promise.all(
        plan.hidden.map(async (spot, seat) => {
          const key = view.keys[seat];
          if (!key) return;
          key.position.copy(view.overHead(seat));
          key.visible = true;
          await clock.wait(seat * 0.25);
          jingle(sfx, true);
          await arc(key, view.overHead(seat), view.restAt(spot, 0, 1), flight, 2.2);
        }),
      );
      await clock.wait(0.9);
      await Promise.all(plan.hidden.map((spot, seat) => clock.wait(seat * 0.12).then(() => tuck(seat, spot))));

      // 2. The room gets messy, the lights go down, the cat wanders through.
      ui.caption('Uh oh. Things are getting cosy…');
      sfx.whoosh();
      seats.forEach((_, i) => view.people[i]?.setBase('thinking'));
      void clock.tween(0.6, (k) => view.setDim(k));
      void clock.tween(1.2, (k) => view.setMess(k), ease.linear);
      for (let i = 0; i < 3; i++) void clock.wait(0.2 + i * 0.35).then(() => view.poke(0));
      const cat = view.cat.root;
      cat.position.set(-8.5, 0, 1.9);
      cat.visible = true;
      for (const m of plan.moves) {
        const spot = view.spots[m.from];
        const target = view.spots[m.to];
        const key = view.keys[m.seat];
        if (!spot || !target || !key) continue;
        await walkCat(spot.front);
        cat.rotation.y = Math.atan2(spot.anchor.x - cat.position.x, spot.anchor.z - cat.position.z);
        mrrp(sfx);
        view.poke(m.from);
        if (m.from === 1) await clock.tween(0.2, (k) => view.setFridge(k));
        key.visible = true;
        jingle(sfx);
        await arc(key, spot.anchor, view.restAt(m.to, 0, 1), 0.85, 2.4);
        if (m.from === 1) void clock.tween(0.25, (k) => view.setFridge(1 - k));
        await clock.wait(0.3);
        await tuck(m.seat, m.to);
      }
      await walkCat(new THREE.Vector3(8.8, 0, 1.9), 6);
      cat.visible = false;

      // 3. Where are YOUR keys?
      const foundAt: (number | null)[] = seats.map(() => null);
      const lockedUntil = seats.map(() => 0);
      const locked = seats.map(() => false);
      const attempts = seats.map(() => 0);
      const cpuAt = seats.map((_, i) => 0.9 + (1 - (skill[i] ?? 0.5)) * 2.2 + rng() * 1.2);
      let now = 0;
      let order = 0;
      session.setLayoutAll(() => ({
        kind: 'buttons',
        title: 'Where are your keys?',
        buttons: SPOTS.map((label, i) => ({ label, color: SPOT_COLORS[i] })),
        note: 'First right answer scores most.',
      }));
      ui.caption('Where are YOUR keys? Pick the spot on your phone!');
      seats.forEach((_, i) => view.people[i]?.setBase('thinking'));

      const answer = (seat: number, spot: number) => {
        if (foundAt[seat] !== null || now < (lockedUntil[seat] ?? 0) || spot < 0 || spot >= SPOTS.length) return;
        attempts[seat] = (attempts[seat] ?? 0) + 1;
        if (spot === plan.final[seat]) {
          foundAt[seat] = now;
          order++;
          sfx.good();
          jingle(sfx);
          session.send(seat, { t: 'feedback', good: true, text: 'Found them!' });
          session.setLayout(seat, { kind: 'wait', title: 'Got them!', text: 'Waiting for the others…' });
          const c = view.people[seat];
          c?.setBase('happy');
          c?.react('happy', 1.4);
          const key = view.keys[seat];
          if (key) {
            key.position.copy(view.overHead(seat));
            key.visible = true;
          }
          view.label(seat, order === 1 ? 'First!' : 'Found!', seats[seat]?.color ?? '#fff');
          view.sparkle(seat, seats[seat]?.color ?? '#fff');
        } else {
          lockedUntil[seat] = now + KEYS.lockout;
          locked[seat] = true;
          sfx.bad();
          session.send(seat, { t: 'feedback', good: false, text: `Not in the ${SPOTS[spot]?.toLowerCase() ?? 'there'}! Hold on…` });
          session.send(seat, { t: 'buzz', pattern: [120] });
          view.people[seat]?.react('sad', 1.0);
        }
      };
      const off = session.onInput((seat, msg) => {
        if (msg.t === 'press' && !session.isCpu(seat)) answer(seat, msg.index);
      });
      await everyFrame(clock, (_, t) => {
        now = t;
        seats.forEach((__, i) => {
          if (locked[i] && t >= (lockedUntil[i] ?? 0)) {
            locked[i] = false;
            if (foundAt[i] === null) session.send(i, { t: 'feedback', good: true, text: 'Try again!' });
          }
          if (session.isCpu(i) && foundAt[i] === null && t >= (cpuAt[i] ?? 0) && t >= (lockedUntil[i] ?? 0)) {
            answer(i, cpuGuess(rng, plan, i, skill[i] ?? 0.5, attempts[i] ?? 0));
            cpuAt[i] = t + KEYS.lockout + 0.4 + rng() * 0.8;
          }
        });
        ui.timer(KEYS.answerTime - t);
        return t >= KEYS.answerTime || foundAt.every((f) => f !== null);
      });
      off();
      ui.timer(null);

      // 4. Lights up: everyone's keys pop out where they really were.
      const pts = roundPoints(foundAt);
      pts.forEach((p, i) => {
        points[i] = (points[i] ?? 0) + p;
        totalTime[i] = (totalTime[i] ?? 0) + (foundAt[i] ?? KEYS.answerTime + 2);
        if (foundAt[i] !== null) found[i] = (found[i] ?? 0) + 1;
      });
      session.setLayoutAll(() => ({ kind: 'wait', title: round + 1 < KEYS.rounds ? 'Next round coming up…' : 'Counting keys…' }));
      void clock.tween(0.5, (k) => {
        view.setDim(1 - k);
        view.setMess(1 - k);
      });
      const bySpot = new Map<number, number[]>();
      plan.final.forEach((spot, seat) => {
        if (foundAt[seat] === null) bySpot.set(spot, [...(bySpot.get(spot) ?? []), seat]);
      });
      bySpot.forEach((list, spot) => {
        view.poke(spot);
        list.forEach((seat, slot) => {
          const key = view.keys[seat];
          const from = view.spots[spot]?.anchor;
          if (!key || !from) return;
          key.visible = true;
          void arc(key, from, view.restAt(spot, slot, list.length), 0.45, 0.8);
          view.people[seat]?.setBase('sad');
        });
      });
      if (bySpot.size) jingle(sfx);
      ui.caption(bySpot.size ? 'There they were all along!' : 'Everybody found their keys!');
      pts.forEach((p, i) => {
        if (p > 0) view.label(i, `+${p}`, seats[i]?.color ?? '#fff');
      });
      live();
      await clock.wait(1.8);
      view.keys.forEach((k) => (k.visible = false));
    }
    ui.caption(null);
    seats.forEach((_, i) => view.people[i]?.setBase('idle'));
    return {
      scores: keysScores(points, totalTime),
      details: points.map((p, i) => `${p} pts · found ${found[i]} of ${KEYS.rounds}`),
    };
  },
};
