// Marshmallow Fight on the TV: a backyard after dark, a crackling campfire in the middle and a row of lawn chairs
// turned round for cover on each side. Two pairs run about and lob marshmallows across; every hit stays stuck on
// whoever it got, so by the end everyone's a bit fluffy.
import * as THREE from 'three';
import {
  type Camper,
  type CpuCamper,
  IDLE,
  MALLOW,
  type Mallow,
  type Stick,
  cpuStick,
  isOver,
  mallowScores,
  newCpuCamper,
  newYard,
  sideOf,
  stepYard,
  throwAngle,
} from '../../../game/minigames/marshmallowfight';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cone, cyl, disc, gem, material, mix, nameCard, part, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.6; // companions (tall enough to read across the whole yard)
const TILT = 0.78; // the camera looks down this much (radians)
const STUCK_MAX = 10; // marshmallows stuck on one camper before the oldest drops off
const LYING_MAX = 36; // marshmallows left lying on the grass
const MALLOW_WHITE = P.cream;
const MALLOW_TOASTED = mix(P.copper, P.mustard, 0.45);

// ------------------------------------------------------------------ sounds

/** A soft, squashy splat. */
function splat(sfx: Sfx): void {
  noise(sfx, { dur: 0.16, filter: 'lowpass', freq: 900, to: 200, gain: 0.45 });
  tone(sfx, { freq: 210, to: 90, dur: 0.14, gain: 0.16 });
}

/** A light flick as a marshmallow leaves the hand. */
function flick(sfx: Sfx): void {
  noise(sfx, { dur: 0.09, filter: 'bandpass', freq: 1800, to: 3200, gain: 0.12 });
}

/** A dull pat on a lawn chair's canvas. */
function pat(sfx: Sfx): void {
  noise(sfx, { dur: 0.08, filter: 'lowpass', freq: 500, gain: 0.25 });
}

// ------------------------------------------------------------------ props

function marshmallow(color: string = MALLOW_WHITE): THREE.Group {
  const g = new THREE.Group();
  const toasted = color !== MALLOW_WHITE;
  // A soft drum with rounded shoulders; white ones glow a touch so they read across a dark garden.
  const o = { shadow: false, outline: 0.02, exact: true, ...(toasted ? {} : { glow: 0.22 }) };
  part(g, cyl(0.12, 0.12, 0.14, 16), color, 0, 0, 0, o);
  for (const s of [-1, 1]) part(g, cyl(s > 0 ? 0.095 : 0.12, s > 0 ? 0.12 : 0.095, 0.035, 16), toasted ? mix(color, P.walnut, 0.45) : color, 0, s * 0.0875, 0, { ...o, outline: false });
  return g;
}

/** A folding lawn chair, turned round so its back faces the middle: cover. `toward` is +1 or -1 (the middle's side). */
function lawnChair(stripe: string, toward: number): THREE.Group {
  const g = new THREE.Group();
  const frame = mix(P.ceramic, P.metal, 0.35);
  const tube = { gloss: 0.6, outline: 0.02 };
  const { x: hx, z: hz } = MALLOW.chairHalf;
  // Legs and arm rests.
  for (const z of [-hz + 0.05, hz - 0.05]) {
    part(g, cyl(0.03, 0.03, 0.9, 8), frame, 0, 0.32, z, { rz: 0.55, ...tube });
    part(g, cyl(0.03, 0.03, 0.9, 8), frame, 0, 0.32, z, { rz: -0.55, ...tube });
    part(g, rbox(hx * 2 + 0.1, 0.05, 0.08, 0.02), P.oak, 0, 0.62, z, { tex: 'wood', texScale: 0.5, outline: 0.02 });
  }
  // Webbing on the seat and the back, in stripes: the team's colour and cream canvas.
  const slats = 5;
  for (let i = 0; i < slats; i++) {
    const color = i % 2 === 0 ? stripe : P.cream;
    const web = { tex: 'fabric' as const, texScale: 0.4, texStrength: 0.6, outline: false as const, ...(i % 2 === 0 ? { exact: true } : {}) };
    const z = -hz + 0.12 + (i / (slats - 1)) * (hz * 2 - 0.24);
    part(g, rbox(hx * 2 - 0.08, 0.04, (hz * 2 - 0.24) / slats, 0.015), color, 0, 0.42, z, web);
    part(g, rbox(0.05, 0.85, (hz * 2 - 0.24) / slats, 0.015), color, toward * (hx - 0.06), 0.93, z, { rz: toward * -0.18, ...web });
  }
  // A tall back, so a marshmallow really does stop on it.
  for (const z of [-hz + 0.06, hz - 0.06]) part(g, cyl(0.03, 0.03, 0.92, 8), frame, toward * (hx - 0.05), 0.92, z, { rz: toward * -0.18, ...tube });
  part(g, rbox(0.06, 0.06, hz * 2, 0.02), frame, toward * (hx + 0.02), 1.36, 0, tube);
  return g;
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

// ------------------------------------------------------------------ the scene

interface Rig {
  c: Companion;
  ring: THREE.Mesh;
  aim: THREE.Mesh;
  card: THREE.Sprite;
  color: string;
  motion: 'walk' | 'run' | null;
  yaw: number;
  stuck: THREE.Object3D[];
  hop: number;
}

interface Flying {
  m: Mallow;
  mesh: THREE.Group;
  toasted: boolean;
}

interface Lying {
  mesh: THREE.Group;
  vy: number;
  resting: boolean;
}

class Backyard implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly floaters: Floaters;
  readonly rigs: (Rig | undefined)[] = [];
  private readonly fit: CameraFit;
  private readonly marks: Mark[];
  private readonly fireLight: THREE.PointLight;
  private readonly flames: THREE.Mesh[] = [];
  private embers: { m: THREE.Mesh; age: number; vx: number }[] = [];
  private readonly chairs: { g: THREE.Group; jiggle: number }[] = [];
  private flying = new Map<number, Flying>();
  private lying: Lying[] = [];
  private emberIn = 0;
  private readonly rand = seeded(41);
  private readonly specks: Specks;
  private readonly env: Env;

  constructor(seats: MinigameSeat[], teams: number[][], companions: (Companion | undefined)[]) {
    // A garden after dark: moonlight from the builder, and the fire in the middle does the rest.
    this.env = backyard(this.scene, { mood: 'night', w: 2 * MALLOW.half.x + 4.4, d: 2 * MALLOW.half.z + 6.4, clear: { w: 2 * MALLOW.half.x + 1.2, d: 2 * MALLOW.half.z + 1.4 }, seed: 11 });
    this.fireLight = new THREE.PointLight(P.ember, 26, 15, 1.5);
    this.fireLight.position.set(0, 1.1, 0);
    this.scene.add(this.fireLight);
    this.floaters = new Floaters(this.scene);
    this.specks = new Specks(this.scene, this.rand);
    this.yard();

    // Each side's row of chairs (in the rules' order), striped in the team's colour.
    for (const team of [0, 1]) {
      const lead = teams[team]?.[0];
      const color = lead === undefined ? '#9fb4c8' : (seats[lead]?.color ?? '#ffd166');
      const toward = sideOf(team);
      for (const z of MALLOW.chairZ) {
        const chair = lawnChair(mix(color, P.aubergine, 0.12), toward);
        chair.position.set(-toward * MALLOW.chairX, 0, z);
        this.scene.add(chair);
        this.chairs.push({ g: chair, jiggle: 0 });
      }
    }

    seats.forEach((seat, p) => {
      const c = companions[p];
      if (!c) return;
      c.setBase('listening');
      this.scene.add(c.root);
      const ring = part(this.scene, torus(0.5, 0.04), seat.color, 0, 0.05, 0, { rx: Math.PI / 2, glow: 1.1, outline: false, shadow: false, exact: true });
      const aim = part(this.scene, cone(0.17, 0.42, 3), seat.color, 0, 0.06, 0, { rx: Math.PI / 2, sz: 0.25, glow: 0.8, outline: false, shadow: false });
      const card = nameCard(seat.name, seat.color, 0.85);
      this.scene.add(card);
      this.rigs[p] = { c, ring, aim, card, color: seat.color, motion: null, yaw: 0, stuck: [], hop: 0 };
    });

    const { x, z } = MALLOW.half;
    this.marks = [
      ...[-x - 0.4, x + 0.4].flatMap((mx) => [
        { p: new THREE.Vector3(mx, 0, z + 0.5), pad: 0.02 },
        { p: new THREE.Vector3(mx, 0, -z - 0.4), pad: 0.02 },
        { p: new THREE.Vector3(mx, HEIGHT + 0.5, -z), pad: 0.06 },
      ]),
      { p: new THREE.Vector3(0, 0, z + 0.6), pad: 0.03 },
    ];
    this.fit = new CameraFit(this.camera, TILT);
  }

  /** What the garden builder doesn't bring: the tent, the cooler, a picnic in front, and the campfire itself. */
  private yard(): void {
    const s = this.scene;
    const rand = seeded(9);
    const { x: hx, z: hz } = MALLOW.half;
    const flat = { outline: false as const, shadow: false };
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, y = 0) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      s.add(o);
      return o;
    };
    // The lawn is worn where everyone runs about, and bare round the fire.
    part(s, disc(1, 48), mix('#5f8a52', P.olive, 0.3), 0, 0.006, 0, { sx: hx + 1.2, sz: hz + 0.9, tex: 'grass', texScale: 1.6, ...flat });
    part(s, disc(1.35, 36), mix(P.soil, P.grassDark, 0.35), 0, 0.01, 0, { tex: 'sand', texScale: 1.2, ...flat });
    // A little tent in the back corner with a lantern inside, a cooler by the fence.
    const tent = new THREE.Group();
    part(tent, cone(1.5, 1.9, 4), P.terracotta, 0, 0.95, 0, { ry: Math.PI / 4, tex: 'fabric', texScale: 0.8, texStrength: 0.6, outline: 0.03 });
    part(tent, cone(0.52, 1.15, 4), P.espresso, 0, 0.57, 0.98, { ry: Math.PI / 4, sz: 0.2, ...flat });
    part(tent, sphere(0.09, 10), P.lamp, 0, 0.5, 0.95, { glow: 2, ...flat });
    for (const e of [-1, 1]) part(tent, cyl(0.008, 0.008, 1.5, 4), P.cream, e * 1.35, 0.5, 0.75, { rz: e * 0.9, rx: 0.5, ...flat });
    put(tent, -hx + 0.9, -hz - 1.75, 0.25);
    const cooler = new THREE.Group();
    part(cooler, rbox(0.9, 0.55, 0.55, 0.06), P.denim, 0, 0.28, 0, { gloss: 0.3, outline: 0.025 });
    part(cooler, rbox(0.94, 0.1, 0.58, 0.04), P.ceramic, 0, 0.6, 0, { gloss: 0.4, outline: 0.025 });
    part(cooler, torus(0.12, 0.015, Math.PI), P.charcoal, 0, 0.66, 0, { outline: false });
    put(cooler, hx - 0.8, -hz - 1.2, -0.25);
    put(props.drink({ kind: 'can', color: P.teal }), hx - 0.2, -hz - 0.95);
    // In front, out of the way of the fight: a blanket with the bag of marshmallows, roasting sticks, a lantern.
    put(props.blanket({ w: 1.9, d: 1.4, color: P.mauve, tex: 'gingham' }), -2.6, hz + 1.9, 0.25);
    const bag = new THREE.Group();
    part(bag, rbox(0.42, 0.5, 0.26, 0.08), mix(P.denim, P.cream, 0.5), 0, 0.25, 0, { gloss: 0.3, outline: 0.022 });
    part(bag, box(0.3, 0.16, 0.01), P.cream, 0, 0.27, 0.131, flat);
    for (let i = 0; i < 5; i++) {
      const m = marshmallow();
      m.position.set(0.35 + rand() * 0.5, 0.11, (rand() - 0.5) * 0.6);
      m.rotation.set(rand() < 0.5 ? Math.PI / 2 : 0, rand() * 3, 0);
      bag.add(m);
    }
    put(bag, -2.9, hz + 1.9, 0.5, 0.03);
    put(props.candle({ h: 0.18 }), -1.9, hz + 2.3, 0, 0.03);
    put(props.crate({ s: 0.5 }), 3.4, hz + 2.2, 0.35);
    put(props.snackBowl({ fill: 'sweets', color: P.ceramic }), 3.4, hz + 2.2, 0, 0.5);
    put(props.bush({ r: 0.7, seed: 4, flowers: P.rose }), -hx - 1.3, hz + 1.6);
    put(props.bush({ r: 0.6, seed: 9, color: P.moss }), hx + 1.4, hz + 1.3);
    // Logs to sit on by the fire, where nobody runs.
    put(props.logSeat({ len: 1.3 }), 0.1, 2.25, 0.15);
    put(props.logSeat({ len: 1.2 }), -0.1, -2.3, -0.2);
    for (const [x, z, r] of [[0.5, 1.75, 0.4], [-0.45, -1.8, 2.2]] as const) part(s, cyl(0.012, 0.012, 0.9, 5), P.walnut, x, 0.2, z, { rz: 1.2, ry: r, ...flat });
    // The campfire: a ring of stones, crossed logs, a bed of embers and flames.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      part(s, ball(0.17 + rand() * 0.05, 1), mix(P.stone, P.slate, rand() * 0.6), Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62, { sy: 0.7, ry: i, tex: 'rock', outline: 0.02 });
    }
    for (let i = 0; i < 3; i++) part(s, cyl(0.08, 0.08, 0.9, 10), P.soilDark, 0, 0.16, 0, { rz: Math.PI / 2, ry: (i / 3) * Math.PI, tex: 'bark', outline: 0.02 });
    part(s, disc(0.5, 20), P.ember, 0, 0.035, 0, { glow: 0.9, ...flat });
    const flameColors = [P.ember, '#ffb347', '#ffe08a'];
    flameColors.forEach((color, i) => {
      this.flames.push(part(s, cone(0.32 - i * 0.08, 0.75 - i * 0.12, 10), color, 0, 0.5 - i * 0.03, 0, { glow: 1.2 + i * 0.35, ...flat }));
    });
  }

  /** Puts every camper where the rules say, facing where they face, with their aim arrow in front. */
  sync(campers: readonly Camper[], aims: readonly number[], teamOf: readonly number[], dt: number): void {
    const follow = 1 - Math.exp(-dt * 14);
    campers.forEach((cp, p) => {
      const r = this.rigs[p];
      const team = teamOf[p] ?? -1;
      if (!r || team < 0) return;
      const root = r.c.root;
      r.hop = Math.max(0, r.hop - dt * 4);
      root.position.set(cp.x, Math.sin(r.hop * Math.PI) * 0.08, cp.z);
      const target = Math.atan2(cp.fx, cp.fz);
      r.yaw += Math.atan2(Math.sin(target - r.yaw), Math.cos(target - r.yaw)) * follow;
      root.rotation.set(0, r.yaw, cp.dazed > 0 ? Math.sin(cp.dazed * 28) * 0.18 : 0);
      const speed = Math.hypot(cp.vx, cp.vz);
      const motion = speed < 0.35 ? null : speed > 2.8 ? 'run' : 'walk';
      if (motion !== r.motion) {
        r.motion = motion;
        r.c.move(motion, speed);
      }
      r.ring.position.set(cp.x, 0.05, cp.z);
      const a = aims[p] ?? 0;
      const side = sideOf(team);
      const dx = side * Math.cos(a);
      const dz = Math.sin(a);
      r.aim.position.set(cp.x + dx * 0.85, 0.06, cp.z + dz * 0.85);
      r.aim.rotation.set(Math.PI / 2, 0, Math.atan2(-dx, dz));
      const ready = cp.reload <= 0;
      const k = ready ? 1 : 0.6;
      r.aim.scale.set(k, k, 0.25 * k);
      r.aim.material = material(r.color, ready ? { glow: 0.8 } : { glow: 0.2 });
      r.card.position.set(cp.x, HEIGHT + 0.42, cp.z);
    });
  }

  /** A marshmallow leaves someone's hand. */
  thrown(m: Mallow): void {
    const mesh = marshmallow();
    this.scene.add(mesh);
    this.flying.set(m.id, { m, mesh, toasted: false });
    const r = this.rigs[m.owner];
    if (r) r.hop = 1;
  }

  /** Moves everything in the air along its arc. */
  fly(live: readonly Mallow[], dt: number): void {
    for (const m of live) {
      const f = this.flying.get(m.id);
      if (!f) continue;
      f.mesh.position.set(m.x, this.arc(m.travelled), m.z);
      f.mesh.rotation.x += dt * 9;
      f.mesh.rotation.z += dt * 5;
      if (m.toasted && !f.toasted) {
        f.toasted = true;
        f.mesh.clear();
        f.mesh.add(marshmallow(MALLOW_TOASTED));
      }
    }
  }

  private arc(travelled: number): number {
    if (travelled < 8) return 1.15 + Math.sin((travelled / 8) * Math.PI) * 0.5;
    return Math.max(0.1, 1.15 - (travelled - 8) * 0.35);
  }

  /** A hit: the marshmallow sticks to the camper it got. */
  stick(m: Mallow, target: number): void {
    const f = this.flying.get(m.id);
    this.flying.delete(m.id);
    const r = this.rigs[target];
    if (!f || !r) {
      if (f) this.scene.remove(f.mesh);
      return;
    }
    const root = r.c.root;
    root.updateMatrixWorld(true);
    // On the side it came from, somewhere between the knees and the top of the head.
    const h = 0.35 + this.rand() * (HEIGHT - 0.45);
    const spread = (this.rand() - 0.5) * 1.4;
    const ax = -m.dx * Math.cos(spread) + m.dz * Math.sin(spread);
    const az = -m.dz * Math.cos(spread) - m.dx * Math.sin(spread);
    const radius = (h > HEIGHT * 0.55 ? 0.34 : 0.27) * (HEIGHT / 1.35);
    const world = new THREE.Vector3(root.position.x + ax * radius, h, root.position.z + az * radius);
    const local = root.worldToLocal(world);
    f.mesh.position.copy(local);
    f.mesh.rotation.set(this.rand() * Math.PI, this.rand() * Math.PI, this.rand() * Math.PI);
    f.mesh.scale.set(1.15, 0.8, 1.15); // a bit squashed
    this.specks.burst(new THREE.Vector3(root.position.x + ax * radius, h, root.position.z + az * radius), m.toasted ? MALLOW_TOASTED : MALLOW_WHITE, { n: 7, speed: 1.6, size: 0.045, up: 0.8 });
    r.hop = Math.max(r.hop, 0.6);
    root.add(f.mesh);
    r.stuck.push(f.mesh);
    while (r.stuck.length > STUCK_MAX) r.stuck.shift()?.removeFromParent();
    this.floaters.add(m.toasted ? 'Toasty!' : 'Splat!', m.toasted ? P.lamp : P.cream, new THREE.Vector3(root.position.x, HEIGHT + 0.9, root.position.z), 0.42, 1.0);
  }

  /** A marshmallow that hit a chair (index `chair`) or ran out of steam drops onto the grass and stays there. */
  drop(m: Mallow, chair: number | null): void {
    const f = this.flying.get(m.id);
    this.flying.delete(m.id);
    if (!f) return;
    const bounce = chair !== null;
    if (bounce) {
      f.mesh.position.x -= m.dx * 0.25;
      f.mesh.position.z -= m.dz * 0.25;
      const c = this.chairs[chair];
      if (c) c.jiggle = 1;
      this.specks.burst(f.mesh.position.clone(), P.cream, { n: 4, speed: 1, size: 0.03, up: 0.6 });
    }
    this.lying.push({ mesh: f.mesh, vy: bounce ? 1.5 : 0, resting: false });
    while (this.lying.length > LYING_MAX) this.lying.shift()?.mesh.removeFromParent();
  }

  /** A word over a camper's head. */
  say(p: number, text: string, color: string): void {
    const r = this.rigs[p];
    if (r) this.floaters.add(text, color, new THREE.Vector3(r.c.root.position.x, HEIGHT + 1.15, r.c.root.position.z), 0.5, 1.2);
  }

  dispose(): void {
    for (const r of this.rigs) {
      if (!r) continue;
      r.c.dispose();
      r.card.material.map?.dispose();
      r.card.material.dispose();
    }
    this.floaters.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    this.env.update(dt, time);
    this.specks.update(dt);
    for (const r of this.rigs) r?.c.update(dt);
    // The fire flickers and spits the odd ember.
    const flicker = 0.85 + Math.sin(time * 13) * 0.06 + Math.sin(time * 23 + 1) * 0.05 + Math.sin(time * 7.3) * 0.05;
    this.fireLight.intensity = 26 * flicker;
    this.flames.forEach((f, i) => {
      const k = 1 + Math.sin(time * (9 + i * 3) + i) * 0.12;
      f.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));
      f.rotation.y = time * (0.8 + i * 0.4);
    });
    this.emberIn -= dt;
    if (this.emberIn <= 0) {
      this.emberIn = 0.15 + this.rand() * 0.3;
      const m = part(this.scene, ball(0.03, 0), P.lamp, (this.rand() - 0.5) * 0.3, 0.7, (this.rand() - 0.5) * 0.3, { glow: 2, shadow: false });
      this.embers.push({ m, age: 0, vx: (this.rand() - 0.5) * 0.5 });
    }
    this.embers = this.embers.filter((e) => {
      e.age += dt;
      e.m.position.y += dt * 0.9;
      e.m.position.x += e.vx * dt;
      e.m.scale.setScalar(Math.max(0.01, 1 - e.age / 1.4));
      if (e.age < 1.4) return true;
      e.m.removeFromParent();
      return false;
    });
    for (const c of this.chairs) {
      c.jiggle = Math.max(0, c.jiggle - dt * 3);
      c.g.rotation.x = Math.sin(c.jiggle * 18) * c.jiggle * 0.12;
    }
    for (const l of this.lying) {
      if (l.resting) continue;
      l.vy -= 14 * dt;
      l.mesh.position.y += l.vy * dt;
      l.mesh.rotation.x += dt * 6;
      if (l.mesh.position.y <= 0.12) {
        l.mesh.position.y = 0.12;
        l.mesh.rotation.set(Math.PI / 2, l.mesh.rotation.y, 0);
        l.resting = true;
      }
    }
    this.floaters.update(dt);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'marshmallowfight',
  title: 'Marshmallow Fight',
  how: 'Team up with your partner and lob marshmallows across the campfire: move with the stick and press Throw (it flies the way you face). Every hit sticks and scores, and the lawn chairs make good cover. Most hits in 30 seconds wins!',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const skill = seats.map((_, p) => (cpu(p) ? ctx.skill() : 0.5));
    const yard = newYard(teams, seats.length);
    const playing = (p: number) => (yard.teamOf[p] ?? -1) >= 0;
    const companions = await Promise.all(seats.map((s, p) => (playing(p) ? buildCompanion(s.look, { height: HEIGHT }) : Promise.resolve(undefined))));
    const view = new Backyard(seats, teams, companions);
    ctx.stage.setView(view);

    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'someone';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const partnerOf = (p: number) => teams[yard.teamOf[p] ?? -1]?.find((q) => q !== p);

    seats.forEach((s, p) => {
      if (!playing(p)) return;
      const partner = partnerOf(p);
      const side = yard.teamOf[p] === 0 ? 'left' : 'right';
      session.setLayout(s.index, {
        kind: 'stick',
        button: 'Throw',
        note: partner === undefined ? `You hold the ${side} side. Run, duck and throw!` : `You and ${nameOf(partner)} hold the ${side} side. Run, duck behind your chairs and throw!`,
      });
    });

    const sticks: Stick[] = seats.map(() => ({ ...IDLE }));
    /** A press that came and went within one frame still counts. */
    const tapped = seats.map(() => false);
    const cpus: CpuCamper[] = seats.map(() => newCpuCamper());
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'stick' || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p === undefined || !playing(p)) return;
      sticks[p] = { x: msg.x, y: msg.y, a: msg.a };
      if (msg.a) tapped[p] = true;
    });

    ui.caption('Lob marshmallows across. Duck behind the chairs!');
    let hudAt = -1;
    await everyFrame(clock, (dt) => {
      const inputs = seats.map((_, p) => {
        if (!playing(p)) return IDLE;
        if (cpu(p)) return cpuStick(cpus[p] as CpuCamper, yard, p, dt, skill[p] ?? 0.5, rng);
        const s = sticks[p] ?? IDLE;
        const a = s.a || (tapped[p] ?? false);
        tapped[p] = false;
        return { x: s.x, y: s.y, a };
      });
      const ev = stepYard(yard, inputs, dt);
      if (ev.thrown.length) flick(sfx);
      for (const m of ev.thrown) view.thrown(m);
      view.fly(yard.mallows, dt);
      for (const { mallow: m, target } of ev.hits) {
        view.stick(m, target);
        splat(sfx);
        const thrower = m.owner;
        const color = seats[thrower]?.color ?? '#fff';
        view.say(thrower, '+1', color);
        view.rigs[thrower]?.c.react('happy', 0.9);
        view.rigs[target]?.c.react('sad', 1.0);
        tell(thrower, true, `Got ${nameOf(target)}!`);
        tell(target, false, `Splat! ${nameOf(thrower)} got you.`);
        session.send(seatOf(target), { t: 'buzz', pattern: [70] });
        session.send(seatOf(thrower), { t: 'buzz', pattern: [15] });
      }
      for (const { mallow: m, chair } of ev.blocked) {
        view.drop(m, chair);
        pat(sfx);
      }
      for (const m of ev.dropped) view.drop(m, null);
      view.sync(
        yard.campers,
        yard.campers.map((_, p) => (playing(p) ? throwAngle(yard, p) : 0)),
        yard.teamOf,
        dt,
      );
      if (yard.time - hudAt >= 0.1) {
        hudAt = yard.time;
        ui.timer(MALLOW.duration - yard.time);
        ui.live(
          teams.map((members, team) => {
            const lead = seats[members[0] ?? 0];
            const n = yard.score[team === 0 ? 0 : 1];
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} hit${n === 1 ? '' : 's'}` };
          }),
        );
      }
      return isOver(yard);
    });
    off();
    ui.timer(null);
    ui.caption(null);

    // Time! Whatever's still in the air drops, and the stickier side sulks.
    for (const m of yard.mallows) view.drop(m, null);
    yard.mallows = [];
    const [a, b] = yard.score;
    const tie = teams.length > 1 && a === b;
    sfx.good();
    teams.forEach((members, team) => {
      const mine = yard.score[team === 0 ? 0 : 1];
      const won = mine === Math.max(a, b);
      for (const p of members) {
        const r = view.rigs[p];
        r?.c.move(null);
        r?.c.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) r?.c.react('happy', 3);
        tell(p, won, tie ? 'Time! Exactly as many hits each.' : won ? 'Time! Your team landed the most!' : 'Time! They landed more.');
      }
      if (won && !tie) view.say(members[0] ?? 0, 'Sweetest aim!', '#fff6a8');
    });
    await clock.wait(1.6);

    return {
      scores: mallowScores(yard, teams, seats.length),
      details: seats.map((_, p) => {
        const team = yard.teamOf[p] ?? -1;
        const c = yard.campers[p];
        if (team < 0 || !c) return '';
        const n = yard.score[team === 0 ? 0 : 1];
        return `${n} team hit${n === 1 ? '' : 's'} · ${c.hits} yours · ${c.splats} stuck on you`;
      }),
    };
  },
};
