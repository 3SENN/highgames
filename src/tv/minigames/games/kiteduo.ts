// Kite Duo on the TV: a windy hilltop at sunset. Each pair flies one kite: one partner steers it about, the other
// works the reel to keep it up, and halfway through they swap. Balloons drift about the pink sky; a tree and two
// strings of bunting are waiting to snag anyone who isn't looking.
import * as THREE from 'three';
import {
  BUNTING,
  type Balloon,
  type CpuKite,
  KITE,
  type Kite,
  type Sky,
  TREE,
  type Tilt,
  balloonAt,
  buntingAt,
  cpuGoal,
  cpuPump,
  cpuReelGoal,
  cpuTilt,
  flyerAt,
  kiteScore,
  kiteScores,
  newCpuKite,
  newSky,
  pumpKite,
  stepSky,
} from '../../../game/minigames/kiteduo';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, cloud, cone, cyl, gem, material, mix, nameCard, part, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.35; // companions
const STAND_Z = 2.6; // where the pairs stand, in front of the sky
const HILL_R = 40;
const TILT = 0.06;
const BALLOON_COLORS = [mix(P.rose, P.cream, 0.45), mix(P.teal, P.cream, 0.55), mix(P.sage, P.cream, 0.35), mix(P.mauve, P.cream, 0.45), mix(P.terracotta, P.cream, 0.4)];
const FLAGS = [P.terracotta, P.mustard, P.teal, P.cream, P.mauve];
const STRING = P.cream;

/** The height of the hill's grassy top at (x, z). */
function hillY(x: number, z: number): number {
  return Math.sqrt(Math.max(0, HILL_R * HILL_R - x * x - z * z)) - HILL_R;
}

// ------------------------------------------------------------------ sounds

/** A soft balloon pop, brighter for gold. */
function pop(sfx: Sfx, gold: boolean): void {
  noise(sfx, { dur: 0.1, filter: 'highpass', freq: 1800, gain: 0.35 });
  tone(sfx, { freq: gold ? 1320 : 880, to: gold ? 1760 : 1100, dur: 0.16, gain: 0.12 });
  if (gold) tone(sfx, { freq: 1980, dur: 0.22, gain: 0.08, delay: 0.08 });
}

/** A rustle of leaves and string. */
function rustle(sfx: Sfx): void {
  noise(sfx, { dur: 0.45, filter: 'bandpass', freq: 2400, to: 900, gain: 0.3 });
}

/** A reel's click. */
function click(sfx: Sfx): void {
  tone(sfx, { freq: 2600, dur: 0.025, type: 'square', gain: 0.03 });
}

// ------------------------------------------------------------------ props

/** A diamond kite in a pair's colour with a cream panel, cross spars and a bow tail (the tail is placed every frame). */
function kiteMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, gem(0.62), color, 0, 0, 0, { sx: 0.74, sz: 0.12, exact: true, tex: 'fabric', texScale: 0.5, texStrength: 0.5, outline: 0.03 });
  part(g, gem(0.4), mix(color, P.cream, 0.6), 0, 0.1, 0.03, { sx: 0.74, sz: 0.12, outline: false });
  part(g, gem(0.16), color, 0, 0.1, 0.055, { sx: 0.74, sz: 0.12, outline: false, exact: true });
  part(g, cyl(0.02, 0.02, 1.2, 6), P.walnut, 0, 0, 0.09, { outline: false });
  part(g, cyl(0.02, 0.02, 0.9, 6), P.walnut, 0, 0.08, 0.09, { rz: Math.PI / 2, outline: false });
  return g;
}

function balloonMesh(gold: boolean, color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, sphere(KITE.balloonR, 20), gold ? P.brass : color, 0, 0, 0, { sy: 1.12, gloss: 0.7, outline: 0.03, glow: gold ? 0.55 : 0.2 });
  part(g, sphere(0.09, 8), P.cream, -0.14, 0.18, 0.3, { opacity: 0.6, outline: false, shadow: false });
  part(g, cone(0.07, 0.1, 8), gold ? P.copper : mix(color, P.ink, 0.2), 0, -KITE.balloonR * 1.1, 0, { rx: Math.PI, outline: false });
  part(g, cyl(0.008, 0.008, 0.7, 4), STRING, 0, -KITE.balloonR * 1.1 - 0.38, 0, { outline: false, shadow: false });
  if (gold) part(g, gem(0.1), P.lamp, 0.3, 0.32, 0.15, { glow: 1.8, outline: false, shadow: false });
  return g;
}

/** A thin string from a to b sagging by `sag` in the middle. */
function stringGeometry(a: THREE.Vector3, b: THREE.Vector3, sag: number): THREE.TubeGeometry {
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= sag;
  return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 18, 0.02, 4, false);
}

// ------------------------------------------------------------------ the scene

interface Holder {
  c: Companion;
  x: number;
  card: THREE.Sprite | null;
  reel: THREE.Group;
  spin: number;
  lean: number;
  bob: number;
  color: string;
}

interface KiteRig {
  g: THREE.Group;
  tail: THREE.Mesh[];
  trail: THREE.Vector3[];
  line: THREE.Mesh;
  lead: THREE.Mesh;
  members: number[];
  color: string;
  shake: number;
  /** 1 → 0 after a balloon: the kite swells for a moment. */
  pop: number;
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

class Hilltop implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 260);
  readonly floaters: Floaters;
  readonly holders: (Holder | undefined)[] = [];
  readonly kites: KiteRig[] = [];
  private readonly fit: CameraFit;
  private readonly marks: Mark[];
  private readonly balloons = new Map<number, THREE.Group>();
  private readonly lineMat = new THREE.MeshBasicMaterial({ color: STRING, toneMapped: false });
  private readonly leaves: THREE.Mesh[] = [];
  private readonly flags: { m: THREE.Mesh; phase: number }[] = [];
  private readonly drifting: THREE.Group[] = [];
  private shakeTree = 0;
  private time = 0;
  private readonly seats: MinigameSeat[];
  private readonly rand = seeded(31);
  private readonly specks: Specks;
  private readonly sun: THREE.Mesh[] = [];

  constructor(seats: MinigameSeat[], teams: number[][], companions: (Companion | undefined)[]) {
    this.seats = seats;
    // Dusk: the last warm light comes over the camera's shoulder, so faces and kites are lit against the sky.
    const rig = lightRig(this.scene, 'dusk', { fog: { near: 70, far: 220 }, shadowSize: 12, sunFrom: [0.5, 0.5, 0.65] });
    rig.sun.target.position.set(0, 0, 1.5);
    this.floaters = new Floaters(this.scene);
    this.specks = new Specks(this.scene, this.rand);
    this.landscape();

    teams.forEach((members, team) => {
      const lead = seats[members[0] ?? 0];
      const color = lead?.color ?? '#ffd166';
      const base = teams.length > 1 ? (team === 0 ? -2.6 : 2.6) : 0;
      members.forEach((p, m) => {
        const c = companions[p];
        const seat = seats[p];
        if (!c || !seat) return;
        const x = base + (members.length > 1 ? (m === 0 ? -0.7 : 0.7) : 0) * (team === 0 ? 1 : -1);
        c.root.position.set(x, hillY(x, STAND_Z), STAND_Z);
        c.root.rotation.y = (team === 0 ? 1 : -1) * 0.35;
        c.setBase('listening');
        this.scene.add(c.root);
        // The reel, held in front; shown on whoever is reeling.
        const reel = new THREE.Group();
        part(reel, cyl(0.17, 0.17, 0.1, 18), P.oak, 0, 0, 0, { rx: Math.PI / 2, tex: 'wood', texScale: 0.4, outline: 0.022 });
        part(reel, cyl(0.12, 0.12, 0.12, 16), color, 0, 0, 0, { rx: Math.PI / 2, outline: false, exact: true });
        part(reel, cyl(0.05, 0.05, 0.13, 10), P.brass, 0, 0, 0, { rx: Math.PI / 2, outline: false, gloss: 0.7 });
        part(reel, rbox(0.05, 0.22, 0.05, 0.02), P.walnut, 0.1, 0.08, 0.08, { outline: 0.02 });
        reel.position.set(x, hillY(x, STAND_Z) + 0.72, STAND_Z + 0.32);
        this.scene.add(reel);
        part(this.scene, torus(0.42, 0.035), seat.color, x, hillY(x, STAND_Z) + 0.05, STAND_Z, { rx: Math.PI / 2, glow: 0.9, outline: false, shadow: false, exact: true });
        this.holders[p] = { c, x, card: null, reel, spin: 0, lean: 0, bob: 0, color: seat.color };
      });
      const g = kiteMesh(color);
      this.scene.add(g);
      const tail: THREE.Mesh[] = [];
      for (let i = 0; i < 5; i++) tail.push(part(this.scene, cone(0.09, 0.2, 3), i % 2 === 0 ? color : P.cream, 0, 0, 0, { sz: 0.3, outline: false, ...(i % 2 === 0 ? { exact: true } : {}) }));
      const line = new THREE.Mesh(new THREE.BufferGeometry(), this.lineMat);
      const leadLine = new THREE.Mesh(new THREE.BufferGeometry(), this.lineMat);
      this.scene.add(line, leadLine);
      this.kites.push({ g, tail, trail: [], line, lead: leadLine, members, color, shake: 0, pop: 0 });
    });

    this.marks = [
      ...[-KITE.x - 0.7, KITE.x + 0.7].flatMap((x) => [
        { p: new THREE.Vector3(x, KITE.high + 0.7, 0) },
        { p: new THREE.Vector3(x, KITE.low - 0.4, 0) },
      ]),
      { p: new THREE.Vector3(-4.2, hillY(4.2, STAND_Z), STAND_Z + 0.4), pad: 0.03 },
      { p: new THREE.Vector3(4.2, hillY(4.2, STAND_Z), STAND_Z + 0.4), pad: 0.03 },
      { p: new THREE.Vector3(0, HEIGHT + 0.5, STAND_Z), pad: 0.08 },
    ];
    this.fit = new CameraFit(this.camera, TILT);
  }

  /** The hill and what's on it, the setting sun, far hills, clouds, the tree and the bunting. */
  private landscape(): void {
    const s = this.scene;
    const rand = seeded(29);
    const flat = { outline: false as const, shadow: false };
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, lift = 0) => {
      o.position.set(x, hillY(x, z) + lift, z);
      o.rotation.y = ry;
      s.add(o);
      return o;
    };
    part(s, ball(HILL_R, 4), mix(P.grass, P.grassDark, 0.4), 0, -HILL_R, 0, { tex: 'grass', texScale: 3, outline: false });
    // Long grass and flowers, except where everyone stands.
    const blooms = [P.rose, P.mustard, P.cream, P.mauve];
    for (let i = 0; i < 46; i++) {
      const x = (rand() - 0.5) * 26;
      const z = -1.5 + rand() * 7.5;
      if (Math.abs(z - STAND_Z) < 0.9 && Math.abs(x) < 4.6) continue;
      put(props.tuft({ seed: i + 1, s: 0.9 + rand() * 0.8, ...(rand() < 0.4 ? { flowers: blooms[i % blooms.length] as string } : {}) }), x, z, rand() * 6);
    }
    // Things brought up the hill: a blanket and a basket, a spare kite, a log to sit on.
    put(props.blanket({ w: 1.7, d: 1.4, color: P.terracotta, tex: 'gingham' }), -6.9, 3.2, 0.3, 0.01);
    put(props.crate({ s: 0.42 }), -7.5, 3.0, 0.5);
    put(props.drink({ kind: 'bottle', color: P.forest }), -6.6, 3.4, 0, 0.03);
    put(props.mug({ color: P.cream }), -6.3, 3.0, 0, 0.03);
    const spare = kiteMesh(P.mustard);
    spare.rotation.set(-1.35, 0, 0.4);
    spare.scale.setScalar(0.8);
    put(spare, 8.3, 3.3, 0, 0.12);
    put(props.logSeat({ len: 1.5 }), 9.2, 2.2, 0.5);
    put(props.rock({ r: 0.4, seed: 3 }), -9.6, 1.4);
    put(props.rock({ r: 0.25, seed: 6 }), -9.0, 1.9);
    put(props.bush({ r: 0.6, seed: 4, flowers: P.rose }), -10.6, 3.9);
    put(props.bush({ r: 0.55, seed: 8, color: P.moss }), 10.9, 4.1);
    // Pines on the far slope: their tops stand against the valley.
    for (let i = 0; i < 12; i++) {
      const x = -30 + i * 5.4 + (rand() - 0.5) * 3;
      const z = -17 - rand() * 11;
      put(props.tree({ kind: 'pine', h: 3.4 + rand() * 2.6, seed: i + 2, color: mix(P.pine, P.plum, 0.35) }), x, z, 0, -0.3);
    }
    // The sun going down behind the far hills, and the hills themselves in two hazy rows.
    const sunC = mix(P.lamp, P.ember, 0.3);
    this.sun.push(part(s, sphere(8.5, 28), sunC, -6, 2.5, -124, { glow: 1.7, ...flat }));
    this.sun.push(part(s, sphere(13.5, 28), sunC, -6, 2.5, -126, { opacity: 0.22, glow: 1, ...flat }));
    for (let i = 0; i < 7; i++) {
      part(s, sphere(1, 20), mix(P.mauve, P.terracotta, 0.25 + rand() * 0.15), -84 + i * 28 + rand() * 8, -13, -104 - rand() * 12, { sx: 22 + rand() * 10, sy: 15 + rand() * 6, sz: 14, ...flat });
    }
    for (let i = 0; i < 6; i++) {
      part(s, sphere(1, 20), mix(P.plum, P.mauve, 0.25 + rand() * 0.3), -70 + i * 28 + rand() * 6, -12, -76 - rand() * 14, { sx: 18 + rand() * 10, sy: 11 + rand() * 5, sz: 14, ...flat });
    }
    for (let i = 0; i < 8; i++) {
      const c = cloud(rand, 1.2 + rand() * 1.6, mix(P.rose, P.cream, 0.35 + rand() * 0.4));
      c.position.set(-45 + i * 13 + rand() * 4, 12 + rand() * 10, -45 - rand() * 20);
      s.add(c);
      this.drifting.push(c);
    }
    // The tree: a trunk from the hill and a crown that matches what the kites can snag on.
    const [main] = TREE;
    if (main) {
      const foot = hillY(main.x, 0);
      part(s, cyl(0.2, 0.32, main.y - foot, 10), P.soilDark, main.x, (main.y + foot) / 2, 0, { tex: 'bark', outline: 0.03 });
      part(s, cyl(0.08, 0.1, 1.2, 8), P.soilDark, main.x - 0.5, main.y - 0.9, 0, { rz: 0.7, tex: 'bark', outline: 0.03 });
      part(s, cyl(0.07, 0.09, 1.1, 8), P.soilDark, main.x + 0.5, main.y - 0.8, 0, { rz: -0.7, tex: 'bark', outline: 0.03 });
    }
    TREE.forEach((c, i) => {
      this.leaves.push(part(s, ball(c.r, 2), mix(P.fern, P.pine, 0.25 + i * 0.2), c.x, c.y, 0, { outline: 0.035 }));
      // lighter clumps on the sunny side, inside the crown
      this.leaves.push(part(s, ball(c.r * 0.5, 2), mix(P.fern, P.moss, 0.6), c.x - c.r * 0.28, c.y + c.r * 0.3, c.r * 0.58, { outline: false }));
      this.leaves.push(part(s, ball(c.r * 0.36, 2), mix(P.fern, P.olive, 0.5), c.x + c.r * 0.34, c.y - c.r * 0.05, c.r * 0.7, { outline: false }));
    });
    // Bunting: poles, the string, and little flags fluttering below it.
    for (const b of BUNTING) {
      for (const [x, y] of [
        [b.ax, b.ay],
        [b.bx, b.by],
      ] as const) {
        const foot = hillY(x, 0);
        part(s, cyl(0.06, 0.085, y - foot + 0.2, 8), P.cream, x, (y + foot + 0.2) / 2, 0, { tex: 'planks', texStrength: 0.5, outline: 0.025 });
        part(s, sphere(0.1, 10), P.brass, x, y + 0.24, 0, { gloss: 0.7, outline: false });
      }
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const p = buntingAt(b, i / 24);
        pts.push(new THREE.Vector3(p.x, p.y, 0));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.025, 5, false), material(P.cream));
      s.add(tube);
      const n = Math.round(Math.hypot(b.bx - b.ax, b.by - b.ay) / 0.55);
      for (let i = 1; i < n; i++) {
        const p = buntingAt(b, i / n);
        const m = part(s, cone(0.17, 0.34, 3), FLAGS[i % FLAGS.length] as string, p.x, p.y - 0.18, 0, { rx: Math.PI, sz: 0.25, shadow: false, outline: 0.02 });
        this.flags.push({ m, phase: i * 0.7 });
      }
    }
  }

  /** Name cards show who flies and who reels; they change at the swap. */
  roles(flyers: readonly number[]): void {
    this.holders.forEach((h, p) => {
      if (!h) return;
      if (h.card) {
        h.card.removeFromParent();
        h.card.material.map?.dispose();
        h.card.material.dispose();
      }
      const flying = flyers.includes(p);
      h.card = nameCard(`${this.seats[p]?.name ?? ''} · ${flying ? 'flies' : 'reels'}`, h.color, 0.85);
      h.card.position.set(h.x, hillY(h.x, STAND_Z) + HEIGHT + 0.35, STAND_Z);
      this.scene.add(h.card);
      h.reel.visible = !flying;
      h.c.setBase(flying ? 'thinking' : 'working');
    });
  }

  /** The reeler gave a pump. */
  pumped(p: number, power: number): void {
    const h = this.holders[p];
    if (!h) return;
    h.spin += 0.8 + power;
    h.bob = 1;
  }

  /** The flyer's lean with their tilt. */
  steer(p: number, x: number): void {
    const h = this.holders[p];
    if (h) h.lean += (x * 0.25 - h.lean) * 0.2;
  }

  got(team: number, b: Balloon, t: number): void {
    const m = this.balloons.get(b.id);
    if (m) {
      m.removeFromParent();
      this.balloons.delete(b.id);
    }
    const p = balloonAt(b, t);
    const color = this.kites[team]?.color ?? '#ffffff';
    // A pop: scraps of balloon, and gold ones glitter.
    const at = new THREE.Vector3(p.x, p.y, 0.2);
    this.specks.burst(at, b.gold ? P.lamp : (BALLOON_COLORS[b.id % BALLOON_COLORS.length] as string), { n: b.gold ? 16 : 9, speed: b.gold ? 3 : 2.2, size: 0.06, ...(b.gold ? { glow: 1.8 } : {}) });
    const kite = this.kites[team];
    if (kite) kite.pop = 1;
    this.floaters.add(b.gold ? '+3' : '+1', b.gold ? P.lamp : color, new THREE.Vector3(p.x, p.y + 0.6, 0.4), b.gold ? 0.6 : 0.45, 1.0);
  }

  tangled(team: number, k: Kite): void {
    const r = this.kites[team];
    if (r) r.shake = 1;
    const nearTree = TREE.some((c) => Math.hypot(k.x - c.x, k.y - c.y) < c.r + KITE.kiteR + 0.3);
    if (nearTree) this.shakeTree = 1;
    this.specks.burst(new THREE.Vector3(k.x, k.y, 0.3), nearTree ? P.fern : P.cream, { n: 8, speed: 1.8, size: 0.05, up: 0.4 });
    this.floaters.add('Tangled!', mix(P.rose, P.cream, 0.5), new THREE.Vector3(k.x, k.y + 0.9, 0.4), 0.45, 1.3);
  }

  /** Shows the balloons in the sky right now; ones about to float off shrink away. */
  sync(sky: Sky, flyers: readonly number[], dt: number): void {
    const t = sky.time;
    for (const b of sky.balloons) {
      const live = b.taken === null && b.at <= t && b.until > t;
      let m = this.balloons.get(b.id);
      if (!live) {
        if (m) {
          m.removeFromParent();
          this.balloons.delete(b.id);
        }
        continue;
      }
      if (!m) {
        m = balloonMesh(b.gold, BALLOON_COLORS[b.id % BALLOON_COLORS.length] as string);
        this.scene.add(m);
        this.balloons.set(b.id, m);
      }
      const p = balloonAt(b, t);
      m.position.set(p.x, p.y, 0);
      m.rotation.z = Math.sin(t * 1.3 + b.phase) * 0.12;
      const grow = Math.min(1, (t - b.at) / 0.35);
      const fade = Math.min(1, (b.until - t) / 0.5);
      m.scale.setScalar(Math.max(0.01, Math.min(grow, fade)));
    }
    sky.kites.forEach((k, team) => {
      const r = this.kites[team];
      if (!r) return;
      r.shake = Math.max(0, r.shake - dt * 0.8);
      const wobble = k.tangled > 0 ? Math.sin(this.time * 30) * 0.25 : 0;
      r.g.position.set(k.x, k.y, 0);
      r.g.rotation.set(0, 0, -k.vx * 0.06 + wobble);
      r.pop = Math.max(0, r.pop - dt / 0.3);
      r.g.scale.setScalar(1 + Math.sin(r.pop * Math.PI) * 0.22);
      // The tail follows where the kite has been.
      r.trail.unshift(new THREE.Vector3(k.x, k.y - 0.62, 0.02));
      if (r.trail.length > 30) r.trail.length = 30;
      r.tail.forEach((bow, i) => {
        const at = r.trail[Math.min(r.trail.length - 1, (i + 1) * 4)] ?? r.trail[0];
        if (!at) return;
        bow.position.set(at.x + Math.sin(this.time * 6 + i) * 0.05, at.y - (i + 1) * 0.16, at.z);
        bow.rotation.set(0, 0, Math.PI + Math.sin(this.time * 5 + i) * 0.4);
      });
      // The string: reel → flyer's hand → kite.
      const flyer = this.holders[r.members[flyers[team] ?? 0] ?? -1] ?? this.holders[r.members[0] ?? -1];
      const reeler = this.holders[r.members.find((p) => p !== r.members[flyers[team] ?? 0]) ?? -1];
      if (!flyer) return;
      const hand = new THREE.Vector3(flyer.x + 0.15, hillY(flyer.x, STAND_Z) + 0.85, STAND_Z + 0.2);
      const tip = new THREE.Vector3(k.x, k.y - 0.55, 0);
      r.line.geometry.dispose();
      r.line.geometry = stringGeometry(hand, tip, 0.35 + Math.max(0, 1.4 - k.lift * 2) * 0.4);
      r.lead.visible = !!reeler;
      if (reeler) {
        r.lead.geometry.dispose();
        r.lead.geometry = stringGeometry(reeler.reel.position, hand, 0.1);
      }
    });
  }

  dispose(): void {
    for (const h of this.holders) {
      if (!h) continue;
      h.c.dispose();
      h.card?.material.map?.dispose();
      h.card?.material.dispose();
    }
    for (const r of this.kites) {
      r.line.geometry.dispose();
      r.lead.geometry.dispose();
    }
    this.lineMat.dispose();
    this.floaters.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.fit.update(() => this.marks);
    for (const h of this.holders) {
      if (!h) continue;
      h.c.update(dt);
      h.bob = Math.max(0, h.bob - dt * 5);
      h.reel.rotation.z -= h.spin * dt * 6;
      h.spin *= Math.exp(-dt * 4);
      h.c.root.position.y = hillY(h.x, STAND_Z) + Math.sin(h.bob * Math.PI) * 0.05;
      h.c.root.rotation.z = -h.lean;
    }
    this.shakeTree = Math.max(0, this.shakeTree - dt * 1.5);
    this.leaves.forEach((l, i) => {
      l.rotation.z = Math.sin(time * 1.1 + i) * 0.03 + Math.sin(time * 25) * 0.06 * this.shakeTree;
    });
    for (const f of this.flags) f.m.rotation.x = Math.PI + Math.sin(time * 4 + f.phase) * 0.35;
    for (const c of this.drifting) c.position.x += dt * 0.25;
    // The sun's halo breathes, slowly.
    this.sun[1]?.scale.setScalar(1 + Math.sin(time * 0.5) * 0.03);
    this.specks.update(dt);
    this.floaters.update(dt);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'kiteduo',
  title: 'Kite Duo',
  how: 'Fly a kite with your partner: one of you tilts to steer, the other pumps the reel to keep it up (no pumping and it sinks). Fly into balloons, gold ones are worth 3, and keep clear of the tree and the bunting. Halfway through you swap jobs!',
  controller: 'tilt',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const solo = teams.map((t) => t.length < 2);
    const sky = newSky(rng, teams.length, solo);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const skill = seats.map((_, p) => (cpu(p) ? ctx.skill() : 0.5));
    const slotOf = new Map<number, { team: number; member: number }>();
    teams.forEach((t, team) => t.forEach((p, member) => slotOf.set(p, { team, member })));
    const companions = await Promise.all(seats.map((s, p) => (slotOf.has(p) ? buildCompanion(s.look, { height: HEIGHT }) : Promise.resolve(undefined))));
    const view = new Hilltop(seats, teams, companions);
    ctx.stage.setView(view);

    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const partnerOf = (p: number): number | undefined => {
      const w = slotOf.get(p);
      return w && !solo[w.team] ? teams[w.team]?.[1 - w.member] : undefined;
    };
    /** Each team's flyer, by member index: a pair of one always flies. */
    const flyerMember = (team: number, t: number) => (solo[team] ? 0 : flyerAt(t));
    const isFlyer = (p: number, t: number) => {
      const w = slotOf.get(p);
      return !!w && flyerMember(w.team, t) === w.member;
    };

    /** Hands out the jobs: the tilt screen to flyers, the reel to reelers. */
    const jobs = (t: number, swapped: boolean) => {
      seats.forEach((s, p) => {
        if (!slotOf.has(p)) return;
        const partner = partnerOf(p);
        const mate = partner === undefined ? '' : nameOf(partner);
        if (isFlyer(p, t)) {
          session.setLayout(s.index, { kind: 'tilt', title: 'Kite Duo · you fly', icon: '🪁', note: partner === undefined ? 'Tilt to steer, nose up to climb.' : `Tilt to steer. ${mate} reels the line.` });
          tell(p, true, partner === undefined ? 'You fly! Tilt to steer, nose up to climb.' : `${swapped ? 'Swap! ' : ''}You fly: tilt to steer. ${mate} reels.`);
        } else {
          session.setLayout(s.index, { kind: 'pump', label: `Reeling for ${mate}: pump for lift`, redline: false, note: `Pump to give the kite lift. ${mate} steers.` });
          tell(p, true, `${swapped ? 'Swap! ' : ''}You reel: pump to lift the kite. ${mate} steers.`);
        }
        if (swapped) session.send(s.index, { t: 'buzz', pattern: [40, 40, 40] });
      });
      view.roles(seats.map((_, p) => p).filter((p) => isFlyer(p, t)));
    };

    const tilts: Tilt[] = seats.map(() => ({ x: 0, y: 0 }));
    const brains: CpuKite[] = seats.map(() => newCpuKite());
    let now = 0;
    const off = session.onInput((seat, msg) => {
      if (session.isCpu(seat)) return;
      const p = posOf.get(seat);
      const w = p === undefined ? undefined : slotOf.get(p);
      if (p === undefined || !w || now >= KITE.duration) return;
      const flying = isFlyer(p, now);
      if (msg.t === 'tilt' && flying) tilts[p] = { x: msg.x, y: msg.y };
      else if (msg.t === 'pump' && !flying) {
        const k = sky.kites[w.team];
        if (k && pumpKite(k, msg.power)) {
          view.pumped(p, msg.power);
          click(sfx);
        }
      }
    });

    jobs(0, false);
    ui.caption('Flyers tilt to steer, reelers pump for lift!');
    let swapped = false;
    let hudAt = -1;
    let meterAt = -1;
    /** When to remind the flyers what they do (the tilt screen has no line of its own). */
    const reminders = [2.6, KITE.swapAt + 2.6];
    await everyFrame(clock, (dt) => {
      const t = sky.time;
      now = t;
      if (!swapped && t >= KITE.swapAt) {
        swapped = true;
        // Fresh hands: whatever the old flyer was tilting doesn't carry over.
        for (let p = 0; p < tilts.length; p++) tilts[p] = { x: 0, y: 0 };
        jobs(t, true);
        sfx.go();
        ui.caption('Swap! Flyers reel, reelers fly.');
      }
      if (t >= (reminders[0] ?? Infinity)) {
        reminders.shift();
        seats.forEach((_, p) => {
          if (slotOf.has(p) && isFlyer(p, t) && !cpu(p)) tell(p, true, 'Tilt to steer the kite!');
        });
      }
      const inputs = teams.map((members, team) => {
        const k = sky.kites[team] as Kite;
        const fm = flyerMember(team, t);
        const flyer = members[fm];
        const reeler = solo[team] ? undefined : members[1 - fm];
        let tilt: Tilt = { x: 0, y: 0 };
        if (flyer !== undefined) {
          if (cpu(flyer)) {
            const heightCost = reeler !== undefined && !cpu(reeler) ? 2.5 : 1;
            tilt = cpuTilt(brains[flyer] as CpuKite, sky, k, dt, skill[flyer] ?? 0.5, rng, heightCost);
          } else tilt = tilts[flyer] ?? tilt;
          view.steer(flyer, tilt.x);
        }
        if (reeler !== undefined && cpu(reeler)) {
          const goal = flyer !== undefined && cpu(flyer) ? cpuGoal(brains[flyer] as CpuKite, sky, k).y : cpuReelGoal(sky, k);
          const power = cpuPump(brains[reeler] as CpuKite, k, goal, t, skill[reeler] ?? 0.5, rng);
          if (power !== null && pumpKite(k, power)) view.pumped(reeler, power);
        }
        return tilt;
      });
      const ev = stepSky(sky, inputs, dt);
      for (const { kite, balloon } of ev.got) {
        view.got(kite, balloon, sky.time);
        pop(sfx, balloon.gold);
        for (const p of teams[kite] ?? []) {
          view.holders[p]?.c.react('happy', balloon.gold ? 1.4 : 0.7);
          session.send(seatOf(p), { t: 'buzz', pattern: balloon.gold ? [20, 40, 20] : [15] });
        }
      }
      for (const team of ev.tangled) {
        const k = sky.kites[team];
        if (k) view.tangled(team, k);
        rustle(sfx);
        for (const p of teams[team] ?? []) {
          view.holders[p]?.c.react('sad', 1.5);
          tell(p, false, 'Tangled! Hang on a moment…');
          session.send(seatOf(p), { t: 'buzz', pattern: [80, 40, 80] });
        }
      }
      for (const team of ev.freed) for (const p of teams[team] ?? []) tell(p, true, 'Free again!');
      view.sync(
        sky,
        teams.map((_, team) => flyerMember(team, sky.time)),
        dt,
      );
      // The reeler's gauge shows the kite's lift, red while it drags in the grass.
      if (sky.time - meterAt >= 0.1) {
        meterAt = sky.time;
        teams.forEach((members, team) => {
          const k = sky.kites[team];
          if (!k || solo[team]) return;
          const reeler = members[1 - flyerMember(team, sky.time)];
          if (reeler !== undefined && !cpu(reeler)) session.send(seatOf(reeler), { t: 'meter', value: k.lift, danger: k.y < KITE.low + 0.4 });
        });
      }
      if (sky.time - hudAt >= 0.1) {
        hudAt = sky.time;
        ui.timer(KITE.duration - sky.time);
        ui.live(
          teams.map((members, team) => {
            const lead = seats[members[0] ?? 0];
            const n = sky.kites[team]?.points ?? 0;
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} pt${n === 1 ? '' : 's'}` };
          }),
        );
      }
      return sky.time >= KITE.duration;
    });
    off();
    ui.timer(null);
    ui.caption(null);

    // Time! The pair that popped the most cheers.
    const best = Math.max(...sky.kites.map(kiteScore));
    const tie = sky.kites.length > 1 && sky.kites.every((k) => kiteScore(k) === best);
    sfx.good();
    teams.forEach((members, team) => {
      const k = sky.kites[team];
      const won = !!k && kiteScore(k) === best;
      for (const p of members) {
        session.send(seatOf(p), { t: 'meter', value: 0, danger: false });
        view.holders[p]?.c.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) view.holders[p]?.c.react('happy', 3);
        tell(p, won, tie ? 'Time! Exactly as many points each.' : won ? 'Time! Your kite popped the most!' : 'Time! Their kite popped more.');
      }
    });
    await clock.wait(1.6);

    return {
      scores: kiteScores(sky, teams, seats.length),
      details: seats.map((_, p) => {
        const w = slotOf.get(p);
        const k = w ? sky.kites[w.team] : undefined;
        if (!k) return '';
        return `${k.points} pt${k.points === 1 ? '' : 's'} · ${k.balloons} balloon${k.balloons === 1 ? '' : 's'}${k.tangles ? ` · ${k.tangles} tangle${k.tangles === 1 ? '' : 's'}` : ''}`;
      }),
    };
  },
};
