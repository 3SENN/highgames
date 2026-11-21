// Tickle Monster on the TV: a back garden at dusk, fairy lights along the fence and a fire pit glowing in the
// middle. One player shuffles about under a big blanket-monster costume (little feet poking out underneath);
// the other three run round the garden furniture. Seen from the patio door, looking down over the lawn.
import * as THREE from 'three';
import { type Brain, IDLE, PROPS, type Stick, TICKLE, type Yard, cpuStick, frozenCount, isOver, newBrain, newYard, stepYard, tickleScores } from '../../../game/minigames/tickletag';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import { CameraFit, Floaters, type Mark, teamsOf, tone } from '../kit';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cone, cyl, dome, material, mix, nameCard, part, pill, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.1; // the three; the monster's companion is fitted inside its costume
const TILT = 0.98; // how far the camera looks down (radians)
const RING_STEPS = 24; // the free ring fills in this many steps (each a cached geometry)
const GIGGLES = ['hee hee', 'hehe', 'hihi', 'tee hee', 'ha!'];

interface Rig {
  c: Companion;
  marker: THREE.Mesh;
  /** Free ring over a frozen runner's head, and its faint backing. */
  progress: THREE.Mesh;
  backing: THREE.Mesh;
  /** Pale ring on the grass under a frozen runner. */
  frost: THREE.Mesh;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
  step: number;
  helper: number | null;
  /** Seconds to the next giggle word while frozen. */
  giggleIn: number;
  /** Seconds since this runner was freed (the frost ring bursts outward), or since tickled (it lands). */
  burst: number;
  wasFrozen: boolean;
}

interface Costume {
  root: THREE.Group;
  body: THREE.Group;
  arms: THREE.Group[];
}

/** The monster costume: a big round blanket in the player's colour, with stripes, googly eyes and soft horns. */
function costume(color: string): Costume {
  // A knitted blanket, the player's colour mixed down; the colour itself is on the stripes.
  const blanket = mix(color, P.plum, 0.45);
  const stripe = mix(color, P.cream, 0.3);
  const knit = { tex: 'knit' as const, texScale: 0.8 };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const arms: THREE.Group[] = [];
  // The drape (hem at 0.23, so little feet show underneath) and the round top.
  part(body, cyl(0.5, 0.7, 0.9, 26), blanket, 0, 0.68, 0, knit);
  part(body, sphere(0.56, 24), blanket, 0, 1.2, 0, { sy: 1.1, ...knit });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    part(body, ball(0.13, 1), blanket, Math.sin(a) * 0.66, 0.25, Math.cos(a) * 0.66, { outline: false, ...knit });
  }
  part(body, torus(0.635, 0.045), stripe, 0, 0.52, 0, { rx: Math.PI / 2, outline: false });
  part(body, torus(0.57, 0.045), stripe, 0, 0.84, 0, { rx: Math.PI / 2, outline: false });
  // Googly eyes, a soft smile with two little fangs, and two horns.
  for (const side of [-1, 1]) {
    part(body, sphere(0.17, 18), P.cream, side * 0.21, 1.33, 0.47, { gloss: 0.5 });
    part(body, sphere(0.08, 12), P.ink, side * 0.19, 1.31, 0.62, { outline: false, gloss: 0.6 });
    part(body, sphere(0.025, 8), '#ffffff', side * 0.19 + 0.03, 1.35, 0.69, { basic: true, shadow: false });
    part(body, cone(0.09, 0.3, 12), P.cream, side * 0.27, 1.79, 0, { rz: -side * 0.35, gloss: 0.3 });
    part(body, cone(0.035, 0.08, 8), P.cream, side * 0.07, 1.01, 0.55, { rx: Math.PI, outline: false });
    const arm = new THREE.Group();
    arm.position.set(side * 0.5, 1.02, 0.05);
    part(arm, pill(0.11, 0.42), blanket, side * 0.28, -0.12, 0, { rz: side * 1.15, ...knit });
    for (let k = -1; k <= 1; k++) part(arm, ball(0.045, 1), stripe, side * 0.55, -0.2 + k * 0.05, 0.06 + Math.abs(k) * -0.03, { outline: false });
    body.add(arm);
    arms.push(arm);
  }
  part(body, torus(0.16, 0.035, Math.PI), P.ink, 0, 1.1, 0.54, { rz: Math.PI, outline: false });
  return { root, body, arms };
}

class GardenView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly rigs: Rig[] = [];
  readonly floaters = new Floaters(this.scene);
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly colors: string[];
  private readonly costume: Costume;
  private readonly card: THREE.Sprite;
  private readonly env: Env;
  private tick: (dt: number, time: number) => void = () => {};
  /** What this game adds to the garden (the environment looks after its own things). */
  private readonly set = new THREE.Group();
  private tickling = 0;
  private slump = 0;

  constructor(
    seats: MinigameSeat[],
    companions: Companion[],
    private readonly monster: number,
  ) {
    this.colors = seats.map((s) => s.color);
    // A fenced garden at dusk, bigger than the lawn the game is played on.
    const { x: bx, z: bz } = TICKLE.bounds;
    this.env = backyard(this.scene, { mood: 'evening', w: 17, d: 12, clear: { w: bx * 2 + 1.2, d: bz * 2 + 1.2 }, seed: 6 });
    this.buildGarden();

    const color = seats[monster]?.color ?? '#9b7bd4';
    this.costume = costume(color);
    this.scene.add(this.costume.root);
    seats.forEach((s, i) => {
      const c = companions[i] as Companion;
      this.scene.add(c.root);
      const isMonster = i === monster;
      if (isMonster) {
        // Fit the companion inside the costume: narrow enough for the drape, short enough for the top.
        const [x0, y0, z0] = c.kit.bounds.min;
        const [x1, y1, z1] = c.kit.bounds.max;
        const wide = Math.max(x1 - x0, z1 - z0) * c.scale;
        const tall = (y1 - y0) * c.scale;
        c.root.scale.setScalar(Math.min(1, 0.92 / Math.max(0.1, wide), 1.25 / Math.max(0.1, tall)));
      }
      const marker = part(this.scene, torus(isMonster ? 0.82 : 0.46, isMonster ? 0.07 : 0.05), s.color, 0, 0.05, 0, { rx: Math.PI / 2, glow: 1.1, outline: false, shadow: false });
      if (isMonster) part(marker, torus(0.62, 0.035), s.color, 0, 0, 0, { glow: 1.1, outline: false, shadow: false });
      const frost = part(this.scene, torus(0.5, 0.09), P.moon, 0, 0.06, 0, { rx: Math.PI / 2, glow: 1.4, outline: false, shadow: false });
      const backing = part(this.scene, torus(0.26, 0.05), P.ink, 0, 0, 0, { opacity: 0.4, shadow: false });
      const progress = part(this.scene, torus(0.26, 0.06, 0.01), s.color, 0, 0, 0, { glow: 1.2, outline: false, shadow: false });
      frost.visible = backing.visible = progress.visible = false;
      c.setBase(isMonster ? 'happy' : 'listening');
      this.rigs.push({ c, marker, progress, backing, frost, motion: null, mood: null, step: -1, helper: null, giggleIn: 0, burst: 9, wasFrozen: false });
    });
    this.card = nameCard('Monster', color, 0.8);
    this.scene.add(this.card);
  }

  private buildGarden(): void {
    const s = this.set;
    this.scene.add(s);
    const { x: bx, z: bz } = TICKLE.bounds;
    const flat = { outline: false as const, shadow: false };
    // The lawn the game is played on: freshly mown in stripes, with a stone edging all round.
    const lawn = mix(P.grass, '#5f8a52', 0.5);
    part(s, box(bx * 2 + 0.5, 0.04, bz * 2 + 0.5), lawn, 0, 0.0, 0, { tex: 'grass', ...flat });
    for (let i = 0; i < 7; i++) part(s, box(0.96, 0.04, bz * 2 + 0.5), mix(lawn, P.cream, 0.1), -bx + 0.72 + i * 1.92, 0.004, 0, { tex: 'grass', ...flat });
    const edge = { tex: 'cobble' as const, texScale: 0.8, ...flat };
    for (const side of [-1, 1]) {
      part(s, box(bx * 2 + 0.9, 0.07, 0.2), P.stone, 0, 0.012, side * (bz + 0.35), edge);
      part(s, box(0.2, 0.07, bz * 2 + 0.5), P.stone, side * (bx + 0.35), 0.012, 0, edge);
    }
    // The patio at the front, with pots either side of the door.
    part(s, box(19, 0.1, 2.6), mix(P.stone, P.clay, 0.3), 0, 0.0, bz + 2.3, { tex: 'stoneTiles', ...flat });
    const dress = <T extends THREE.Object3D>(o: T, x: number, z: number, ry = 0, k = 1, y = 0): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(k);
      s.add(o);
      return o;
    };
    dress(props.plant({ kind: 'palm', h: 1.5, pot: P.terracotta }), bx + 0.9, bz + 1.5, 0, 1.3);
    dress(props.plant({ kind: 'fern', h: 0.8, pot: P.ceramic }), bx - 0.4, bz + 2.2, 0, 1.3);
    dress(props.plant({ kind: 'monstera', h: 1.0, pot: P.charcoal }), -bx - 0.6, bz + 1.7, 0, 1.3);
    dress(props.crate({ s: 0.5 }), -bx + 1.0, bz + 2.3, 0.3, 1.2);
    dress(props.candle(), -bx + 1.0, bz + 2.3, 0, 1.6, 0.6);
    // Flower beds between the lawn and the fence.
    const rand = seeded(17);
    const flowers = [P.rose, P.mustard, P.cream, P.mauve];
    for (let i = 0; i < 9; i++) {
      const x = -bx + 0.6 + i * 1.5 + (rand() - 0.5) * 0.5;
      dress(props.bush({ r: 0.32 + rand() * 0.16, seed: i + 2, ...(i % 2 ? { flowers: flowers[i % flowers.length] as string } : {}) }), x, -bz - 0.95 - rand() * 0.2);
    }
    for (let i = 0; i < 5; i++) dress(props.bush({ r: 0.3 + rand() * 0.14, seed: i + 20, flowers: flowers[(i + 1) % flowers.length] as string }), bx + 0.95 + rand() * 0.25, -bz + 0.8 + i * 1.5);

    this.buildProps();
    this.tick = props.tickProps(s);
  }

  private buildProps(): void {
    const s = this.set;
    const wood = { tex: 'planks' as const, texScale: 1 };
    // The fire pit: a ring of stone with a fire that flickers (and lights the garden).
    const fp = PROPS.firepit;
    part(s, cyl(fp.r, fp.r + 0.05, 0.22, 24), P.stone, fp.x, 0.11, fp.z, { tex: 'rock', texScale: 0.8 });
    part(s, cyl(fp.r - 0.12, fp.r - 0.12, 0.05, 24), mix(P.espresso, P.ink, 0.3), fp.x, 0.21, fp.z, { outline: false });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      part(s, ball(0.1, 1), mix(P.stone, P.ink, (i % 3) * 0.08), fp.x + Math.sin(a) * (fp.r - 0.04), 0.24, fp.z + Math.cos(a) * (fp.r - 0.04), { sy: 0.7, outline: false, tex: 'rock', texScale: 0.5 });
    }
    const fire = props.campfire({ light: 13, r: 0.3 });
    fire.position.set(fp.x, 0.2, fp.z);
    s.add(fire);

    // The patio table with four chairs, a bowl of crisps and a bottle, and a folded parasol.
    const t = PROPS.table;
    part(s, cyl(0.62, 0.62, 0.07, 30), P.oak, t.x, 0.76, t.z, { tex: 'wood' });
    part(s, cyl(0.05, 0.05, 0.72, 10), P.metal, t.x, 0.38, t.z, { outline: false, gloss: 0.5 });
    part(s, cyl(0.3, 0.34, 0.05, 18), P.metal, t.x, 0.03, t.z, { gloss: 0.4 });
    part(s, cyl(0.03, 0.03, 2.3, 8), P.ceramic, t.x, 1.4, t.z, { outline: false });
    part(s, cone(0.17, 1.0, 12), P.terracotta, t.x, 2.1, t.z, { rx: Math.PI, tex: 'fabric', texScale: 0.6 });
    part(s, torus(0.11, 0.02), P.cream, t.x, 1.95, t.z, { rx: Math.PI / 2, outline: false });
    const bowl = props.snackBowl({ fill: 'crisps', color: P.ceramic });
    bowl.position.set(t.x + 0.25, 0.795, t.z + 0.12);
    bowl.scale.setScalar(1.3);
    const bottle = props.drink({ kind: 'bottle', color: P.forest });
    bottle.position.set(t.x - 0.2, 0.795, t.z - 0.15);
    bottle.scale.setScalar(1.5);
    s.add(bowl, bottle);
    const chairC = mix(P.teal, P.slate, 0.25);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const cx = t.x + Math.sin(a) * 0.82;
      const cz = t.z + Math.cos(a) * 0.82;
      part(s, rbox(0.42, 0.06, 0.42, 0.03), chairC, cx, 0.42, cz, { ry: a, ...wood });
      part(s, rbox(0.42, 0.42, 0.05, 0.03), chairC, cx + Math.sin(a) * 0.2, 0.66, cz + Math.cos(a) * 0.2, { ry: a, ...wood });
      for (const [lx, lz] of [
        [-0.17, -0.17],
        [0.17, -0.17],
        [-0.17, 0.17],
        [0.17, 0.17],
      ] as const) {
        const c = Math.cos(a);
        const sn = Math.sin(a);
        part(s, cyl(0.025, 0.025, 0.4, 6), P.metal, cx + lx * c + lz * sn, 0.2, cz - lx * sn + lz * c, { outline: false });
      }
    }

    // The sun lounger, its back propped up, with a rolled towel.
    const l = PROPS.lounger;
    const cushion = { tex: 'fabric' as const, texScale: 0.8, outline: false as const };
    part(s, rbox(l.hx * 2, 0.08, l.hz * 2, 0.04), P.wood, l.x, 0.3, l.z, wood);
    part(s, rbox(l.hx * 1.3, 0.1, l.hz * 1.8, 0.05), P.cream, l.x - l.hx * 0.3, 0.39, l.z, cushion);
    part(s, rbox(0.7, 0.08, l.hz * 1.9, 0.04), P.wood, l.x + l.hx - 0.3, 0.55, l.z, { rz: 0.6, ...wood });
    part(s, rbox(0.62, 0.08, l.hz * 1.7, 0.04), P.cream, l.x + l.hx - 0.33, 0.62, l.z, { rz: 0.6, ...cushion });
    part(s, pill(0.1, 0.5), P.rose, l.x - 0.4, 0.5, l.z, { rx: Math.PI / 2, tex: 'terry', texScale: 0.5 });
    for (const dx of [-l.hx + 0.12, l.hx - 0.12]) for (const dz of [-l.hz + 0.08, l.hz - 0.08]) part(s, cyl(0.03, 0.03, 0.28, 6), P.woodDark, l.x + dx, 0.14, l.z + dz, { outline: false });

    // The barbecue: a round kettle on three legs, lid on, quite cold.
    const b = PROPS.bbq;
    part(s, dome(b.r * 0.92), P.charcoal, b.x, 0.62, b.z, { rx: Math.PI, gloss: 0.5 });
    part(s, dome(b.r * 0.92), mix(P.charcoal, P.slate, 0.35), b.x, 0.64, b.z, { gloss: 0.6 });
    part(s, torus(0.08, 0.02), P.brass, b.x, 1.07, b.z, { outline: false, gloss: 0.6 });
    part(s, torus(b.r * 0.92, 0.02), P.metal, b.x, 0.63, b.z, { rx: Math.PI / 2, outline: false, gloss: 0.6 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      part(s, cyl(0.025, 0.025, 0.62, 6), P.charcoal, b.x + Math.sin(a) * 0.22, 0.3, b.z + Math.cos(a) * 0.22, { rx: Math.cos(a) * 0.2, rz: -Math.sin(a) * 0.2, outline: false });
    }

    // A big terracotta planter with a flowering bush.
    const p = PROPS.planter;
    part(s, cyl(p.r, p.r * 0.75, 0.6, 22), P.terracotta, p.x, 0.3, p.z, { gloss: 0.2, tex: 'patio', texScale: 1.2, texStrength: 0.4 });
    part(s, torus(p.r, 0.05), mix(P.terracotta, P.ink, 0.15), p.x, 0.6, p.z, { rx: Math.PI / 2, outline: false });
    const shrub = props.bush({ r: 0.62, flowers: P.rose, seed: 3 });
    shrub.position.set(p.x, 0.5, p.z);
    s.add(shrub);
  }

  /** Arms up and fingers wiggling for a moment. */
  tickle(): void {
    this.tickling = 0.8;
  }

  /** Everyone turns to face the audience. */
  faceFront(): void {
    for (const r of this.rigs) {
      r.c.move(null);
      r.motion = null;
      r.c.root.rotation.y = 0;
    }
    this.costume.root.rotation.y = 0;
  }

  /** The costume sags at the end of a lost game. */
  sag(): void {
    this.slump = 1;
  }

  sync(y: Yard, dt: number): void {
    const follow = 1 - Math.exp(-dt * 12);
    y.bodies.forEach((b, seat) => {
      const rig = this.rigs[seat];
      if (!rig) return;
      const root = rig.c.root;
      root.position.set(b.x, 0, b.z);
      rig.marker.position.set(b.x, 0.05, b.z);
      const speed = Math.hypot(b.vx, b.vz);
      if (!b.frozen) {
        const target = speed > 0.4 ? b.face : root.rotation.y;
        root.rotation.y += Math.atan2(Math.sin(target - root.rotation.y), Math.cos(target - root.rotation.y)) * follow;
      }
      const motion = b.frozen || speed < 0.4 ? null : speed > 2.6 ? 'run' : 'walk';
      if (motion !== rig.motion) {
        rig.motion = motion;
        rig.c.move(motion, speed);
      }
      if (b.frozen !== rig.wasFrozen) {
        rig.wasFrozen = b.frozen;
        rig.burst = 0;
      }
      rig.burst += dt;
      // The frost ring lands with a bounce when tickled, and bursts outward when freed.
      const k = Math.min(1, rig.burst / 0.3);
      rig.frost.visible = b.frozen || k < 1;
      rig.frost.scale.setScalar(b.frozen ? 1 + (1 - k) * (1 - k) * 0.6 : 1 + k * 1.4);
      rig.frost.position.set(b.x, 0.06, b.z);
      if (seat === this.monster) return;
      const m = y.bodies[this.monster];
      const near = m ? Math.hypot(m.x - b.x, m.z - b.z) < 2.6 : false;
      const mood: CompanionMood = b.frozen ? 'happy' : near ? 'approval' : 'listening';
      if (mood !== rig.mood) {
        rig.mood = mood;
        rig.c.setBase(mood);
      }
      // A freed runner's ring blinks while they can't be tickled.
      rig.marker.visible = b.immune <= 0 || Math.floor(b.immune * 8) % 2 === 0;
      const step = b.frozen ? Math.min(RING_STEPS, Math.ceil((b.thaw / TICKLE.freeTime) * RING_STEPS)) : 0;
      rig.progress.visible = rig.backing.visible = step > 0;
      if (step > 0) {
        const helper = b.helper ?? rig.helper;
        if (step !== rig.step || helper !== rig.helper) {
          rig.progress.geometry = torus(0.26, 0.06, (step / RING_STEPS) * Math.PI * 2);
          if (helper !== null) rig.progress.material = material(this.colors[helper] ?? '#ffffff', { glow: 0.8 });
        }
        rig.helper = helper;
        rig.progress.position.set(b.x, HEIGHT + 0.5, b.z);
        rig.backing.position.copy(rig.progress.position);
      }
      rig.step = step;
    });
    const m = y.bodies[this.monster];
    const rig = this.rigs[this.monster];
    if (m && rig) {
      this.costume.root.position.set(m.x, 0, m.z);
      this.costume.root.rotation.y = rig.c.root.rotation.y;
      this.card.position.set(m.x, 2.35, m.z);
      // Close to someone free: arms up, ready to tickle.
      const close = y.runners.some((s) => {
        const r = y.bodies[s];
        return r && !r.frozen && Math.hypot(r.x - m.x, r.z - m.z) < 1.9;
      });
      if (close) this.tickling = Math.max(this.tickling, 0.2);
    }
  }

  /** Giggle words over frozen runners now and then. */
  giggle(y: Yard, dt: number, rand: () => number): boolean {
    let any = false;
    for (const s of y.runners) {
      const b = y.bodies[s];
      const rig = this.rigs[s];
      if (!b || !rig || !b.frozen) continue;
      rig.giggleIn -= dt;
      if (rig.giggleIn > 0) continue;
      rig.giggleIn = 1.1 + rand() * 0.9;
      this.floaters.add(GIGGLES[Math.floor(rand() * GIGGLES.length)] as string, this.colors[s] ?? '#ffffff', new THREE.Vector3(b.x + (rand() - 0.5) * 0.5, HEIGHT + 0.55, b.z), 0.32, 0.9);
      any = true;
    }
    return any;
  }

  dispose(): void {
    for (const r of this.rigs) r.c.dispose();
    this.floaters.dispose();
  }

  update(dt: number, time: number): void {
    const { x: bx, z: bz } = TICKLE.bounds;
    this.env.update(dt, time);
    this.tick(dt, time);
    // Keep the whole lawn, everyone's heads and the monster's card on screen, clear of the score list.
    this.fit.update((): Mark[] => [
      { p: new THREE.Vector3(-bx, 0, bz) },
      { p: new THREE.Vector3(bx, 0, bz) },
      { p: new THREE.Vector3(-bx, 0, -bz) },
      { p: new THREE.Vector3(bx, 0, -bz) },
      { p: new THREE.Vector3(-bx, 2.5, -bz), pad: 0.04 },
      { p: new THREE.Vector3(bx, 2.5, -bz), pad: 0.04 },
      { p: new THREE.Vector3(-bx, HEIGHT, bz) },
      { p: new THREE.Vector3(bx, HEIGHT, bz) },
    ]);
    for (const r of this.rigs) {
      r.c.update(dt);
      r.progress.quaternion.copy(this.camera.quaternion);
      r.progress.rotateZ(Math.PI / 2);
      r.backing.quaternion.copy(this.camera.quaternion);
    }
    this.floaters.update(dt);
    // Frozen runners giggle on the spot.
    this.rigs.forEach((r, i) => {
      if (i === this.monster) return;
      const frozen = r.wasFrozen;
      r.c.root.rotation.z = frozen ? Math.sin(time * 26 + i * 2) * 0.07 : 0;
      r.c.root.position.y = frozen ? Math.abs(Math.sin(time * 13 + i)) * 0.05 : 0;
    });
    // The costume bobs and sways as it shuffles along; arms wiggle when tickling.
    const mr = this.rigs[this.monster];
    const moving = mr?.motion ? 1 : 0;
    const body = this.costume.body;
    body.position.y = moving * Math.abs(Math.sin(time * 9)) * 0.06;
    body.rotation.z = moving * Math.sin(time * 9) * 0.05;
    body.scale.set(1 + this.slump * 0.06, 1 - this.slump * 0.12, 1 + this.slump * 0.06);
    this.tickling = Math.max(0, this.tickling - dt);
    const up = Math.min(1, this.tickling * 4);
    this.costume.arms.forEach((a, k) => {
      const side = k === 0 ? -1 : 1;
      a.rotation.z = side * (up * 1.2 + Math.sin(time * (up > 0 ? 22 : 4) + k) * (0.08 + up * 0.25)) - side * this.slump * 0.4;
      a.rotation.x = -up * 0.6;
    });

  }
}

/** A little giggle: quick bright blips going up and down. */
function giggleSound(sfx: Sfx, rand: () => number): void {
  const base = 820 + rand() * 260;
  for (let k = 0; k < 4; k++) tone(sfx, { freq: base * (1 + (k % 2) * 0.18), to: base * (1.12 + (k % 2) * 0.2), dur: 0.06, type: 'triangle', gain: 0.07, delay: k * 0.075 });
}

/** A cricket, somewhere in the hedge. */
function chirp(sfx: Sfx): void {
  for (let k = 0; k < 3; k++) tone(sfx, { freq: 4300, to: 4100, dur: 0.035, type: 'sine', gain: 0.018, delay: k * 0.06 });
}

export const minigame: Minigame = {
  id: 'tickletag',
  title: 'Tickle Monster',
  how: 'One of you is the Tickle Monster: touch the others to tickle them and they freeze, giggling. Runners: hold Free! next to a frozen friend to free them. The monster wins if all three are frozen at once.',
  controller: 'stick',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const monster = teams[0]?.[0] ?? 0;
    const runners = teams[1]?.length ? [...(teams[1] as number[])] : seats.map((_, p) => p).filter((p) => p !== monster);
    const y = newYard(seats.length, monster, runners);
    const view = new GardenView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), monster);
    ctx.stage.setView(view);

    const seatOf = (p: number) => seats[p]?.index ?? p;
    const posOf = new Map(seats.map((s, p) => [s.index, p] as const));
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const nameOf = (p: number) => seats[p]?.name ?? 'Someone';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });
    const brains: Brain[] = seats.map((_, p) => newBrain(cpu(p) ? ctx.skill() : 0.5, rng));
    const inputs: Stick[] = seats.map(() => ({ ...IDLE }));
    const latch = seats.map(() => false);
    const many = runners.length === 1 ? 'your friend' : runners.length === 2 ? 'both' : 'all three';

    seats.forEach((s, p) => {
      session.setLayout(
        s.index,
        p === monster
          ? { kind: 'stick', button: null, note: `You're the Tickle Monster! Touch the others to tickle them. Get ${many} frozen at once.` }
          : { kind: 'stick', button: 'Free!', note: 'Run from the monster! Hold Free! next to a frozen friend to free them.' },
      );
    });
    const off = session.onInput((seat, msg) => {
      const p = posOf.get(seat);
      if (msg.t !== 'stick' || p === undefined || cpu(p)) return;
      // A quick tap can go down and up between two frames: remember it for one frame.
      if (msg.a && !(inputs[p] as Stick).a) latch[p] = true;
      inputs[p] = { x: msg.x, y: msg.y, a: msg.a };
    });

    const monsterName = nameOf(monster);
    const monsterColor = seats[monster]?.color;
    ui.caption(`${monsterName} is the Tickle Monster! Everyone else: run!`, monsterColor);
    const rand = seeded(Math.floor(rng() * 1e6));
    let hudAt = -1;
    let chirpAt = 2;
    await everyFrame(clock, (dt, t) => {
      const sticks = seats.map((_, p) => {
        if (cpu(p)) return cpuStick(y, p, brains[p] as Brain, rng);
        const s = inputs[p] as Stick;
        const a = s.a || (latch[p] ?? false);
        latch[p] = false;
        return { x: s.x, y: s.y, a };
      });
      const ev = stepYard(y, sticks, dt);
      for (const s of ev.tickled) {
        const b = y.bodies[s];
        giggleSound(sfx, rand);
        view.tickle();
        view.floaters.add('Tickled!', seats[s]?.color ?? '#ffffff', new THREE.Vector3(b?.x ?? 0, HEIGHT + 0.9, b?.z ?? 0), 0.42);
        const rig = view.rigs[s];
        if (rig) rig.giggleIn = 0.6;
        buzz(s, [40, 30, 40, 30, 40]);
        buzz(monster, [30]);
        const n = frozenCount(y);
        if (y.caughtAt === null) {
          tell(s, false, 'Tickled! Giggle on the spot until a friend frees you.');
          tell(monster, true, `Got ${nameOf(s)}! ${n} of ${runners.length} frozen.`);
          ui.caption(`${nameOf(s)} got tickled! Hold Free! next to them.`, seats[s]?.color);
        }
      }
      for (const f of ev.freed) {
        const b = y.bodies[f.seat];
        sfx.good();
        view.floaters.add('Free!', seats[f.by]?.color ?? '#ffffff', new THREE.Vector3(b?.x ?? 0, HEIGHT + 0.9, b?.z ?? 0), 0.42);
        view.rigs[f.seat]?.c.react('happy', 0.8);
        buzz(f.seat, [25, 40, 25]);
        tell(f.seat, true, `${nameOf(f.by)} freed you! Run!`);
        tell(f.by, true, `You freed ${nameOf(f.seat)}!`);
        ui.caption(`${nameOf(f.by)} freed ${nameOf(f.seat)}!`, seats[f.by]?.color);
      }
      view.sync(y, dt);
      if (view.giggle(y, dt, rand) && rand() < 0.35) giggleSound(sfx, rand);
      if (t >= chirpAt) {
        chirpAt = t + 2.5 + rand() * 3;
        chirp(sfx);
      }
      if (t - hudAt > 0.1) {
        hudAt = t;
        ui.timer(Math.max(0, TICKLE.duration - y.time));
        ui.live(
          seats.map((s, p) => {
            const b = y.bodies[p];
            let value = 'Running';
            if (p === monster) value = `Monster · ${frozenCount(y)}/${runners.length} frozen`;
            else if (b?.frozen) value = b.thaw > 0 ? `Giggling · ${Math.round((b.thaw / TICKLE.freeTime) * 100)}%` : 'Giggling';
            else if ((b?.immune ?? 0) > 0) value = 'Free!';
            return { name: s.name, color: s.color, thumb: s.thumb, value };
          }),
        );
      }
      return isOver(y);
    });
    off();
    ui.timer(null);

    // The end: everyone turns to the audience.
    view.faceFront();
    const monsterWon = y.caughtAt !== null;
    if (monsterWon) {
      sfx.fanfare();
      giggleSound(sfx, rand);
      view.tickle();
      ui.caption(`Everyone's giggling! ${monsterName} wins as the Tickle Monster.`, monsterColor);
    } else {
      sfx.win();
      view.sag();
      for (const s of runners) view.rigs[s]?.c.setBase('happy');
      ui.caption(`Never all frozen at once: the ${runners.length === 3 ? 'three' : 'runners'} win! The costume needs a lie-down.`, seats[runners[0] ?? 0]?.color);
    }
    for (const p of seats.keys()) buzz(p, [40, 30, 120]);
    await clock.wait(2);
    ui.caption(null);

    return {
      scores: tickleScores(y, seats.length),
      details: seats.map((_, p) => {
        const b = y.bodies[p];
        if (p === monster) return monsterWon ? `Monster · all frozen at ${(y.caughtAt ?? 0).toFixed(1)} s` : `Monster · ${b?.tickles ?? 0} tickle${b?.tickles === 1 ? '' : 's'}`;
        const n = b?.tickles ?? 0;
        const f = b?.frees ?? 0;
        return `${n ? `Tickled ${n}×` : 'Never tickled'} · freed ${f}`;
      }),
    };
  },
};
