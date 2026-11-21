// Three-Legged Race on the TV: a lazy sports afternoon on the lawn. Two pairs, each tied together at the ankle
// with a scarf, hobble down chalk lanes to a ribbon. A steady left, right, left, right gets them going; tripping
// over each other lands them in the grass for a moment.
import * as THREE from 'three';
import { LEGS, type StepResult, cpuDoubles, cpuStepGap, isStumble, newPair, pressStep, progress, raceScore, raceScores, stepPair, whoseStep } from '../../../game/minigames/threelegged';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cone, cyl, gem, material, mix, nameCard, part, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { Floaters, type Mark, frameMarks, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.45; // companions
const START_X = -14;
const FINISH_X = 14;
const STRIDE = (FINISH_X - START_X) / LEGS.course;
const LANE_Z = [-1.3, 1.3];
const SPREAD = 0.34; // partners stand this far either side of their lane's middle
const POST_Z = 2.8;
const TILT = 0.3;
const FACING = Math.PI / 2 - 0.55; // running to +x, turned a little towards the TV
const SUN: [number, number, number] = [0.6, 0.5, 0.55]; // the garden builder's low evening sun, over the camera's shoulder
const BUNTING = [P.terracotta, P.mustard, P.teal, P.rose, P.cream, P.denim];

// ------------------------------------------------------------------ sounds

/** A soft footstep on grass: the left leg a touch lower than the right. */
function footstep(sfx: Sfx, member: number): void {
  noise(sfx, { dur: 0.07, filter: 'lowpass', freq: 380, gain: 0.3 });
  tone(sfx, { freq: member === 0 ? 150 : 185, to: 90, dur: 0.08, gain: 0.12 });
}

/** A tumble into the grass. */
function flump(sfx: Sfx): void {
  noise(sfx, { dur: 0.3, filter: 'lowpass', freq: 600, to: 120, gain: 0.5 });
  tone(sfx, { freq: 300, to: 140, dur: 0.3, type: 'triangle', gain: 0.1, delay: 0.05 });
}

// ------------------------------------------------------------------ the scene

interface Runner {
  c: Companion;
  pivot: THREE.Group;
  arrow: THREE.Mesh;
  hop: number;
  color: string;
}

interface Lane {
  root: THREE.Group;
  tumble: THREE.Group;
  runners: Runner[];
  card: THREE.Sprite;
  z: number;
  /** Where it's drawn, easing after where the rules put it. */
  x: number;
  goal: number;
  fall: number;
  motion: 'walk' | 'run' | null;
  /** Whose step it is (member index), shown by an arrow. */
  due: number | null;
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

class Lawn implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 220);
  readonly lanes: Lane[] = [];
  readonly floaters: Floaters;
  private readonly probe = new THREE.PerspectiveCamera();
  private goal = { pos: new THREE.Vector3(START_X, 6, 16), look: new THREE.Vector3(START_X + 4, 1, 0) };
  private readonly look = new THREE.Vector3();
  private placed = false;
  private fitIn = 0;
  private time = 0;
  private readonly ribbon: { pivot: THREE.Group; side: number }[] = [];
  private broken = -1;
  private puffs: { m: THREE.Mesh; age: number }[] = [];
  private readonly flags: { m: THREE.Mesh; phase: number }[] = [];
  private readonly rand = seeded(23);
  private readonly specks: Specks;
  private readonly env: Env;

  constructor(seats: MinigameSeat[], teams: number[][], companions: (Companion | undefined)[]) {
    // A long garden in the last of the sun. The shadows only cover the stretch on screen (they follow the camera).
    this.env = backyard(this.scene, { mood: 'golden', w: FINISH_X - START_X + 20, d: 15, clear: { w: FINISH_X - START_X + 10, d: 8 }, seed: 14 });
    const cam = this.env.sun.shadow.camera;
    cam.left = cam.bottom = -13;
    cam.right = cam.top = 13;
    cam.updateProjectionMatrix();
    this.floaters = new Floaters(this.scene);
    this.specks = new Specks(this.scene, this.rand);
    this.grounds();

    teams.forEach((members, team) => {
      const z = LANE_Z[team] ?? 0;
      const root = new THREE.Group();
      const tumble = new THREE.Group();
      root.add(tumble);
      root.position.set(START_X, 0, z);
      this.scene.add(root);
      const lead = seats[members[0] ?? 0];
      const color = lead?.color ?? '#ffd166';
      const runners: Runner[] = [];
      members.forEach((p, m) => {
        const c = companions[p];
        const seat = seats[p];
        if (!c || !seat) return;
        const pivot = new THREE.Group();
        pivot.position.z = members.length > 1 ? (m === 0 ? -SPREAD : SPREAD) : 0;
        c.root.rotation.y = FACING;
        c.setBase('working');
        pivot.add(c.root);
        tumble.add(pivot);
        const arrow = part(tumble, cone(0.13, 0.26, 14), seat.color, 0, HEIGHT + 0.42, pivot.position.z, { rx: Math.PI, glow: 0.7, exact: true, outline: false, shadow: false });
        part(tumble, torus(0.3, 0.03), seat.color, 0, 0.04, pivot.position.z, { rx: Math.PI / 2, glow: 0.7, outline: false, shadow: false, exact: true });
        runners.push({ c, pivot, arrow, hop: 0, color: seat.color });
      });
      // The scarf round the two inner ankles.
      if (members.length > 1) {
        part(tumble, torus(0.13, 0.05), color, 0.02, 0.14, 0, { rx: Math.PI / 2, sy: 1.7, tex: 'knit', texScale: 0.25, exact: true, outline: 0.02 });
        part(tumble, cone(0.07, 0.22, 6), mix(color, P.cream, 0.25), 0.15, 0.1, 0.02, { rz: -1.9, outline: 0.02 });
        part(tumble, cone(0.06, 0.18, 6), color, 0.13, 0.09, -0.06, { rz: -2.2, rx: 0.5, exact: true, outline: 0.02 });
      }
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.1);
      card.position.set(0, HEIGHT + 0.95, 0);
      root.add(card);
      this.lanes.push({ root, tumble, runners, card, z, x: START_X, goal: START_X, fall: 0, motion: null, due: null });
    });
    this.camera.position.copy(this.goal.pos);
    this.camera.lookAt(this.goal.look);
  }

  /** Mown lanes, chalk, the start line, the ribbon, bunting along the back, and the garden party around it. */
  private grounds(): void {
    const s = this.scene;
    const rand = seeded(17);
    const flat = { outline: false as const, shadow: false };
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, y = 0) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      s.add(o);
      return o;
    };
    // The track: mown in stripes, chalked along the lanes.
    const len = FINISH_X - START_X + 8;
    const stripes = Math.round(len / 2.2);
    for (let i = 0; i < stripes; i++) {
      const c = i % 2 === 0 ? mix(P.grass, P.cream, 0.14) : mix(P.grass, P.grassDark, 0.3);
      part(s, box(len / stripes, 0.012, 6.4), c, -len / 2 + (i + 0.5) * (len / stripes), 0.004, 0, { tex: 'grass', texScale: 1.6, ...flat });
    }
    const chalk = mix(P.cream, P.grass, 0.12);
    for (const z of [-2.6, 0, 2.6]) part(s, box(FINISH_X - START_X + 6, 0.012, 0.07), chalk, 0, 0.012, z, flat);
    part(s, box(0.14, 0.012, 5.3), chalk, START_X - 0.4, 0.013, 0, flat);
    // A chequered finish line under the ribbon.
    for (let k = 0; k < 14; k++) {
      for (let j = 0; j < 2; j++) {
        part(s, box(0.2, 0.012, 0.38), (k + j) % 2 === 0 ? P.ink : P.cream, FINISH_X + 0.1 + j * 0.2, 0.014, -2.47 + k * 0.38, flat);
      }
    }
    // Little distance flags along the far edge.
    for (let x = START_X + 7; x < FINISH_X; x += 7) {
      part(s, cyl(0.02, 0.02, 0.7, 6), P.cream, x, 0.35, -3.0, { outline: false });
      part(s, cone(0.16, 0.34, 3), P.terracotta, x + 0.17, 0.58, -3.0, { rz: -Math.PI / 2, sz: 0.3, outline: 0.02 });
    }
    // The finish posts and the ribbon, in two halves that part when someone breaks through.
    for (const side of [-1, 1]) {
      part(s, cyl(0.07, 0.09, 1.6, 12), P.cream, FINISH_X, 0.8, side * POST_Z, { outline: 0.025 });
      for (const y of [0.35, 0.75, 1.15]) part(s, cyl(0.078, 0.086, 0.14, 12), P.terracotta, FINISH_X, y, side * POST_Z, { outline: false });
      part(s, sphere(0.13, 14), P.brass, FINISH_X, 1.68, side * POST_Z, { gloss: 0.7, outline: 0.025 });
    }
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(FINISH_X, 1.05, side * POST_Z);
      part(pivot, rbox(0.03, 0.1, POST_Z, 0.012), P.accent, 0, 0, -side * (POST_Z / 2), { outline: false, gloss: 0.4, glow: 0.25 });
      s.add(pivot);
      this.ribbon.push({ pivot, side });
    }
    // Bunting from pole to pole along the back; the flags flutter.
    const span = 9;
    for (let x0 = START_X - 9; x0 < FINISH_X + 9; x0 += span) {
      part(s, cyl(0.045, 0.06, 3.5, 8), P.cream, x0, 1.75, -6.2, { tex: 'planks', texStrength: 0.4, outline: 0.02 });
      const n = 12;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        const sag = Math.sin(k * Math.PI) * 0.6;
        const m = part(s, cone(0.2, 0.4, 3), BUNTING[(i + Math.round(x0)) % BUNTING.length] as string, x0 + k * span, 3.25 - sag, -6.2, { rx: Math.PI, sz: 0.25, shadow: false, outline: false });
        this.flags.push({ m, phase: i * 0.8 + x0 });
      }
      for (let i = 0; i < n; i++) {
        const k0 = i / n;
        const k1 = (i + 1) / n;
        const y0 = 3.45 - Math.sin(k0 * Math.PI) * 0.6;
        const y1 = 3.45 - Math.sin(k1 * Math.PI) * 0.6;
        part(s, cyl(0.008, 0.008, Math.hypot(span / n, y1 - y0), 4), P.cream, x0 + ((k0 + k1) / 2) * span, (y0 + y1) / 2, -6.2, { rz: Math.PI / 2 + Math.atan2(y1 - y0, span / n), ...flat });
      }
    }
    part(s, cyl(0.045, 0.06, 3.5, 8), P.cream, START_X - 9 + Math.ceil((FINISH_X - START_X + 18) / span) * span, 1.75, -6.2, { tex: 'planks', texStrength: 0.4, outline: 0.02 });
    // A picnic near the start: gingham, lemonade, a bowl of fruit, a parasol.
    put(props.blanket({ w: 2.6, d: 2.0, color: P.rose, tex: 'gingham' }), START_X - 3.6, -4.9, 0.15);
    put(props.snackBowl({ fill: 'fruit', color: P.ceramic }), START_X - 3.9, -4.8, 0, 0.03);
    put(props.drink({ kind: 'bottle', color: P.forest }), START_X - 3.1, -5.2, 0, 0.03);
    put(props.mug({ color: P.mustard }), START_X - 3.0, -4.6, 0, 0.03);
    put(props.parasol({ colors: [P.terracotta, P.cream], h: 2.2 }), START_X - 5.2, -5.4, 0.4);
    put(props.pouf({ color: P.teal, r: 0.34 }), START_X - 2.0, -5.5);
    // Along the back, for whoever is watching: a drinks table, benches, crates, a prize table by the finish.
    const table = put(props.table({ w: 1.8, d: 0.8, cloth: P.cream }), -4.5, -5.0);
    for (let i = 0; i < 4; i++) {
      const c = props.drink({ kind: i % 2 ? 'can' : 'bottle', color: [P.teal, P.terracotta, P.mustard, P.forest][i] as string });
      c.position.set(-0.6 + i * 0.4, 0.75, (i % 2) * 0.2 - 0.1);
      table.add(c);
    }
    put(props.logSeat({ len: 1.8 }), -1.2, -4.6, 0.1);
    put(props.logSeat({ len: 1.5 }), 3.4, -4.8, -0.15);
    put(props.crate({ s: 0.5 }), 5.4, -5.2, 0.3);
    put(props.crate({ s: 0.4 }), 5.45, -5.2, 0.7, 0.5);
    put(props.parasol({ colors: [P.mustard, P.cream], h: 2.3 }), 7.4, -5.5, -0.3);
    put(props.blanket({ w: 1.6, d: 1.9, color: P.teal, stripes: P.cream }), 8.1, -4.7, -0.4);
    // The deckchair by the finish, and the prize: a rosette on a crate.
    const chair = new THREE.Group();
    const canvas = { tex: 'fabric' as const, texScale: 0.5, texStrength: 0.6, outline: 0.02 };
    part(chair, rbox(1.0, 0.05, 1.1, 0.02), P.teal, 0, 0.45, 0, { rz: 0.2, ...canvas });
    part(chair, rbox(1.0, 0.05, 0.9, 0.02), P.teal, -0.5, 0.95, 0, { rz: 1.1, ...canvas });
    for (const z of [-0.5, 0.5]) {
      part(chair, cyl(0.03, 0.03, 1.5, 6), P.oak, -0.1, 0.6, z, { rz: 0.6, tex: 'wood', outline: 0.02 });
      part(chair, cyl(0.03, 0.03, 1.2, 6), P.oak, 0.05, 0.38, z, { rz: -0.9, tex: 'wood', outline: 0.02 });
    }
    put(chair, FINISH_X + 4.4, -4.9, 0.2);
    const prize = put(props.crate({ s: 0.6 }), FINISH_X + 2.4, -4.6, -0.2);
    part(prize, cyl(0.2, 0.2, 0.03, 20), P.terracotta, 0, 0.82, 0.31, { rx: Math.PI / 2, outline: 0.02 });
    part(prize, cyl(0.12, 0.12, 0.04, 20), P.brass, 0, 0.82, 0.32, { rx: Math.PI / 2, outline: false, gloss: 0.7 });
    for (const e of [-1, 1]) part(prize, box(0.08, 0.26, 0.012), P.terracotta, e * 0.07, 0.6, 0.31, { rz: e * 0.25, outline: false });
    // Flower beds in front, low, so the bottom of the picture is never just lawn.
    const blooms = [P.rose, P.mustard, P.cream, P.terracotta, P.mauve];
    for (let x = START_X - 10; x < FINISH_X + 10; x += 2.0 + rand() * 1.8) {
      const z = 4.7 + rand() * 1.9;
      if (rand() < 0.5) put(props.bush({ r: 0.32 + rand() * 0.14, seed: Math.round(x * 3), flowers: blooms[Math.floor(rand() * blooms.length)] as string }), x, z);
      else if (rand() < 0.2) put(props.rock({ r: 0.2 + rand() * 0.12, seed: Math.round(x) }), x, z);
      for (let k = 0; k < 3; k++) put(props.tuft({ seed: Math.round(x * 7) + k, s: 0.9 + rand() * 0.7, flowers: blooms[Math.floor(rand() * blooms.length)] as string }), x + 0.5 + rand() * 1.2, z - 0.6 + rand() * 1.2, rand() * 6);
    }
  }

  /** The pair's place along the course (in steps), whose step it is, and how far into a fall it is (0 to 1). */
  setPair(team: number, steps: number, due: number | null, fall: number): void {
    const l = this.lanes[team];
    if (!l) return;
    l.goal = START_X + steps * STRIDE;
    l.due = due;
    l.fall = fall;
  }

  /** A good step: that partner hops. */
  step(team: number, member: number): void {
    const l = this.lanes[team];
    const r = l?.runners[member];
    if (!l || !r) return;
    r.hop = 1;
    const m = part(this.scene, sphere(0.1, 10), mix(P.cream, P.grass, 0.25), l.x - 0.25, 0.08, l.z + r.pivot.position.z, { opacity: 0.6, outline: false, shadow: false });
    this.puffs.push({ m, age: 0 });
  }

  /** Down they go. */
  stumble(team: number, text: string): void {
    const l = this.lanes[team];
    if (!l) return;
    for (const r of l.runners) r.c.react('sad', LEGS.fall + 0.3);
    // Bits of grass fly up where they land.
    this.specks.burst(new THREE.Vector3(l.x + 0.9, 0.15, l.z), P.moss, { n: 9, speed: 1.9, size: 0.04 });
    this.specks.burst(new THREE.Vector3(l.x + 0.9, 0.15, l.z), mix(P.cream, P.grass, 0.3), { n: 5, speed: 1.2, size: 0.07, up: 0.5 });
    this.floaters.add(text, mix(P.rose, P.cream, 0.5), new THREE.Vector3(l.x + 0.4, HEIGHT + 1.4, l.z), 0.45, 1.3);
  }

  /** The ribbon parts for the first pair through. */
  breakRibbon(team: number): void {
    if (this.broken < 0) this.broken = 0;
    const l = this.lanes[team];
    if (l) {
      // Confetti in the bunting's colours, and gold.
      const at = new THREE.Vector3(FINISH_X + 0.3, 1.2, l.z);
      this.specks.burst(at, P.lamp, { n: 16, speed: 3, glow: 1.6 });
      BUNTING.forEach((c, i) => this.specks.burst(at, c, { n: 4, speed: 2 + i * 0.3, size: 0.05 }));
    }
    if (l) this.floaters.add('First across!', P.lamp, new THREE.Vector3(FINISH_X + 1, HEIGHT + 1.7, l.z), 0.62, 2.6);
  }

  dispose(): void {
    for (const l of this.lanes) {
      for (const r of l.runners) r.c.dispose();
      l.card.material.map?.dispose();
      l.card.material.dispose();
    }
    this.floaters.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.env.update(dt, this.time);
    this.specks.update(dt);
    for (const f of this.flags) f.m.rotation.x = Math.PI + Math.sin(this.time * 3.2 + f.phase) * 0.28;
    for (const l of this.lanes) {
      const before = l.x;
      l.x += (l.goal - l.x) * (1 - Math.exp(-7 * dt));
      l.root.position.x = l.x;
      const speed = dt > 0 ? Math.abs(l.x - before) / dt : 0;
      const motion = l.fall > 0 || speed < 0.25 ? null : speed > 1.6 ? 'run' : 'walk';
      if (motion !== l.motion) {
        l.motion = motion;
        for (const r of l.runners) r.c.move(motion, Math.max(1, speed));
      }
      // A fall: tip forwards into the grass, lie there a moment, get back up.
      const k = l.fall <= 0 ? 0 : l.fall > 0.75 ? (1 - l.fall) / 0.25 : l.fall > 0.25 ? 1 : l.fall / 0.25;
      l.tumble.rotation.z = -1.25 * Math.sin((Math.min(1, k) * Math.PI) / 2);
      l.runners.forEach((r, i) => {
        r.c.update(dt);
        r.hop = Math.max(0, r.hop - dt * 6);
        r.pivot.position.y = Math.sin(r.hop * Math.PI) * 0.14;
        r.pivot.rotation.z = -Math.sin(r.hop * Math.PI) * 0.12;
        const due = l.fall <= 0 && (l.due === i || (l.due === null && i === 0));
        r.arrow.visible = due;
        r.arrow.position.y = HEIGHT + 0.42 + Math.sin(this.time * 6 + i) * 0.06;
        r.arrow.material = material(r.color, { glow: due ? 1.1 : 0.3, exact: true });
      });
    }
    if (this.broken >= 0) {
      this.broken = Math.min(1, this.broken + dt * 1.8);
      for (const r of this.ribbon) r.pivot.rotation.x = r.side * -1.35 * this.broken + Math.sin(this.time * 9) * 0.05 * (1 - this.broken);
    }
    this.puffs = this.puffs.filter((p) => {
      p.age += dt;
      p.m.scale.setScalar(1 + p.age * 4);
      p.m.position.y += dt * 0.3;
      if (p.age < 0.4) return true;
      p.m.removeFromParent();
      return false;
    });
    this.floaters.update(dt);
    this.frame(dt);
  }

  /** Keeps both pairs (and the ribbon, once it's close) in the free part of the screen. */
  private frame(dt: number): void {
    this.fitIn -= dt;
    if (this.fitIn <= 0 || !this.placed) {
      this.fitIn = 0.1;
      this.probe.fov = this.camera.fov;
      this.probe.aspect = this.camera.aspect;
      this.probe.updateProjectionMatrix();
      const xs = this.lanes.map((l) => l.x);
      let lo = Math.min(...xs, START_X + 2) - 1.4;
      let hi = Math.max(...xs) + 2.2;
      if (hi > FINISH_X - 7) hi = Math.max(hi, FINISH_X + 1.2);
      // Never closer in than about 10 units of lawn.
      const mid = (lo + hi) / 2;
      lo = Math.min(lo, mid - 5);
      hi = Math.max(hi, mid + 5);
      const marks: Mark[] = [];
      for (const x of [lo, hi]) {
        marks.push({ p: new THREE.Vector3(x, 0, 2.7), pad: 0.02 }, { p: new THREE.Vector3(x, 0, -2.7) }, { p: new THREE.Vector3(x, HEIGHT + 1.15, -1.3), pad: 0.05 });
      }
      this.goal = frameMarks(this.probe, marks, TILT);
    }
    const k = this.placed ? 1 - Math.exp(-2.5 * dt) : 1;
    this.placed = true;
    this.camera.position.lerp(this.goal.pos, k);
    this.look.lerp(this.goal.look, k);
    if (k === 1) this.look.copy(this.goal.look);
    this.camera.lookAt(this.look);
    // The sun's shadows keep to the stretch of lawn on screen.
    const sun = this.env.sun;
    sun.target.position.set(this.look.x, 0, 0);
    sun.position.set(this.look.x + SUN[0] * 60, SUN[1] * 60, SUN[2] * 60);
  }
}

// ------------------------------------------------------------------ the game

const TRIP_WORDS: Record<'same' | 'together' | 'rush', { tv: string; you: string; partner: string }> = {
  same: { tv: 'Same leg twice!', you: 'Oops: same leg twice! Take turns.', partner: 'Your partner went twice. Up you get…' },
  together: { tv: 'Both at once!', you: 'Both at once! Take turns.', partner: 'Both at once! Take turns.' },
  rush: { tv: 'Too quick!', you: 'Too quick! Find a steady rhythm.', partner: 'Too quick! Find a steady rhythm.' },
};

export const minigame: Minigame = {
  id: 'threelegged',
  title: 'Three-Legged Race',
  how: 'You and your partner are tied at the ankle, and each of you moves one leg: take turns on Step, left, right, left, right. Going twice, both at once or mashing trips you up. First pair across the ribbon wins!',
  controller: 'buttons',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const pairs = teams.map(() => newPair());
    const solo = teams.map((t) => t.length < 2);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const skill = seats.map((_, p) => (cpu(p) ? ctx.skill() : 0.5));
    const slotOf = new Map<number, { team: number; member: number }>();
    teams.forEach((t, team) => t.forEach((p, member) => slotOf.set(p, { team, member })));
    const companions = await Promise.all(seats.map((s, p) => (slotOf.has(p) ? buildCompanion(s.look, { height: HEIGHT }) : Promise.resolve(undefined))));
    const view = new Lawn(seats, teams, companions);
    ctx.stage.setView(view);

    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const partnerOf = (p: number): number | undefined => {
      const w = slotOf.get(p);
      return w && !solo[w.team] ? teams[w.team]?.[1 - w.member] : undefined;
    };
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    // Each phone's last turn line, so it only hears about changes.
    const said = seats.map(() => '');
    const tell = (p: number, good: boolean, text: string, force = false) => {
      if (!force && said[p] === text) return;
      said[p] = text;
      session.send(seatOf(p), { t: 'feedback', good, text });
    };
    /** Tells both partners whose step it is (after a fall or at the start, the left leg leads). */
    const turns = (team: number) => {
      const pair = pairs[team];
      const members = teams[team] ?? [];
      if (!pair || pair.finishedAt !== null) return;
      if (solo[team]) {
        const only = members[0];
        if (only !== undefined) tell(only, true, 'Step, step, step… steady!');
        return;
      }
      const due = whoseStep(pair) ?? 0;
      members.forEach((p, m) => tell(p, true, m === due ? 'Your step!' : 'Wait for your partner'));
    };

    seats.forEach((s, p) => {
      const w = slotOf.get(p);
      if (!w) return;
      const partner = partnerOf(p);
      const leg = w.member === 0 ? 'left' : 'right';
      session.setLayout(s.index, {
        kind: 'buttons',
        title: 'Three-Legged Race',
        buttons: [{ label: 'Step', color: s.color }],
        note:
          partner === undefined
            ? 'You move both legs. Steady steps, no mashing!'
            : `You're the ${leg} leg, tied to ${nameOf(partner)}. ${w.member === 0 ? 'You start!' : `${nameOf(partner)} starts.`}`,
      });
      said[p] = '';
    });

    const cpuNext = seats.map(() => Infinity);
    const cpuDouble = seats.map(() => false);
    /** When each pair was last ready for either partner to go (the start, or getting up). */
    const readyAt = teams.map(() => 0);
    const wasDown = teams.map(() => false);
    let now = 0;
    let frameAt = performance.now();
    let winner = -1;

    const press = (p: number, t: number) => {
      const w = slotOf.get(p);
      const pair = w ? pairs[w.team] : undefined;
      if (!w || !pair || winner >= 0) return;
      const result: StepResult = pressStep(pair, w.member, t, solo[w.team]);
      const partner = partnerOf(p);
      if (result === 'step' || result === 'finish') {
        view.step(w.team, w.member);
        footstep(sfx, w.member);
        if (partner !== undefined) session.send(seatOf(partner), { t: 'buzz', pattern: [12] });
        if (cpu(p) && partner !== undefined && result === 'step' && cpuDoubles(rng, skill[p] ?? 0.5)) {
          cpuDouble[p] = true;
          cpuNext[p] = t + 0.24 + rng() * 0.2;
        }
        if (result === 'finish') {
          winner = w.team;
          return;
        }
        turns(w.team);
      } else if (isStumble(result)) {
        const words = TRIP_WORDS[result as 'same' | 'together' | 'rush'];
        view.stumble(w.team, words.tv);
        flump(sfx);
        tell(p, false, words.you, true);
        if (partner !== undefined) tell(partner, false, words.partner, true);
        for (const q of teams[w.team] ?? []) {
          session.send(seatOf(q), { t: 'buzz', pattern: [90, 50, 90] });
          cpuNext[q] = Infinity;
          cpuDouble[q] = false;
        }
        wasDown[w.team] = true;
      }
    };

    const cpuSteps = (t: number) => {
      teams.forEach((members, team) => {
        const pair = pairs[team];
        if (!pair || pair.down > 0 || pair.finishedAt !== null) return;
        const due = whoseStep(pair, solo[team]);
        members.forEach((p, member) => {
          if (!cpu(p)) return;
          const other = members[1 - member];
          // Either may go: the left leg leads, unless it's a person who hasn't got going after a moment.
          const mine = due === member || (due === null && (solo[team] || member === 0 || (other !== undefined && !cpu(other) && t - (readyAt[team] ?? 0) > 1.4)));
          if (cpuNext[p] === Infinity) {
            if (mine) {
              const react = 0.12 + (1 - (skill[p] ?? 0.5)) * 0.3 + rng() * 0.15;
              cpuNext[p] = Math.max(t + (due === null ? react : 0.02), Math.max(0, pair.lastAt) + cpuStepGap(rng, skill[p] ?? 0.5));
            }
            return;
          }
          if (t < (cpuNext[p] ?? Infinity)) return;
          const double = cpuDouble[p];
          cpuNext[p] = Infinity;
          cpuDouble[p] = false;
          if (mine || double) press(p, t);
        });
      });
    };

    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'press' || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p === undefined) return;
      // When it was pressed: this frame's clock, less half the phone's round trip.
      const raw = now + Math.max(0, (performance.now() - frameAt) / 1000) * clock.speed;
      const lag = Math.min(0.15, (session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed;
      press(p, raw - lag);
    });

    // The layouts' notes already say who starts; turn lines follow from the first step on.
    ui.caption('Take turns on Step: left, right, left, right!');
    let hudAt = -1;
    await everyFrame(clock, (dt, t) => {
      now = t;
      frameAt = performance.now();
      pairs.forEach((pair, team) => {
        stepPair(pair, dt);
        if (wasDown[team] && pair.down <= 0) {
          wasDown[team] = false;
          readyAt[team] = t;
          turns(team);
        }
      });
      cpuSteps(t);
      pairs.forEach((pair, team) => view.setPair(team, pair.steps, whoseStep(pair, solo[team]), pair.down > 0 ? pair.down / LEGS.fall : 0));
      if (t - hudAt >= 0.1) {
        hudAt = t;
        ui.timer(LEGS.duration - t);
        ui.live(
          teams.map((members, team) => {
            const lead = seats[members[0] ?? 0];
            const pair = pairs[team];
            const value = pair?.finishedAt != null ? 'Across!' : `${Math.round(progress(pair ?? newPair()) * 100)}%`;
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value };
          }),
        );
      }
      return winner >= 0 || t >= LEGS.duration;
    });
    off();
    ui.timer(null);
    ui.caption(null);

    // The ribbon (or the whistle), and a cheer for the pair that got furthest.
    const best = Math.max(...pairs.map(raceScore));
    const tie = pairs.length > 1 && pairs.every((p) => raceScore(p) === best);
    if (winner >= 0) {
      view.breakRibbon(winner);
      sfx.good();
    } else {
      tone(sfx, { freq: 1800, dur: 0.5, type: 'square', gain: 0.06 });
    }
    teams.forEach((members, team) => {
      const pair = pairs[team] ?? newPair();
      const won = raceScore(pair) === best;
      // The winners run on through the ribbon.
      view.setPair(team, pair.steps + (team === winner ? 4 : 0), null, 0);
      for (const p of members) {
        const c = view.lanes[team]?.runners[slotOf.get(p)?.member ?? 0]?.c;
        c?.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) c?.react('happy', 3);
        const text = tie ? 'Time! Neck and neck.' : won ? (pair.finishedAt !== null ? 'First across the line!' : 'Time! You got furthest!') : winner >= 0 ? 'They broke the ribbon first.' : 'Time! They got further.';
        tell(p, won, text, true);
      }
    });
    await clock.wait(1.8);

    return {
      scores: raceScores(pairs, teams, seats.length),
      details: seats.map((_, p) => {
        const w = slotOf.get(p);
        const pair = w ? pairs[w.team] : undefined;
        if (!pair) return '';
        const trips = pair.stumbles ? ` · ${pair.stumbles} tumble${pair.stumbles === 1 ? '' : 's'}` : '';
        if (pair.finishedAt !== null) return `Across in ${pair.finishedAt.toFixed(1)} s${trips}`;
        return `${Math.round(progress(pair) * 100)}% of the way${trips}`;
      }),
    };
  },
};
