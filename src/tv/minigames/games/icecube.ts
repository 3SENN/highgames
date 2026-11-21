// Ice Cube Curling on the TV: the kitchen at night, only the little lights under the cupboards on. Everyone stands
// at the near end of their own lane on the counter and flicks ice cubes at a coaster at the far end, by the sink.
// The cubes glide, clink into each other and slowly melt into puddles.
import * as THREE from 'three';
import {
  type Cube,
  ICE,
  type IceEvent,
  type IceLane,
  bestCube,
  cpuDelay,
  cpuFlick,
  cubePoints,
  fromCentre,
  iceDetail,
  iceScores,
  laneMoving,
  newLane,
  roundsLine,
  scoreRound,
  stepLane,
  throwCube,
} from '../../../game/minigames/icecube';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cyl, gem, material, mix, nameCard, part, pill, rbox, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, lanes, noise, tone } from '../kit';
import { type Minigame, type MinigameContext, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.05; // companion height: little figures on a big counter
const GAP = 0.32; // between lanes (a chopstick lies in each gap)
const ICE_COLOR = '#d3efff';
const CORK = mix(P.clay, P.oak, 0.5);
const K = 7; // props are built at 1 m scale; on this counter the players are figurines, so everything else is huge
const FRONT = 2.6; // the counter's near edge (z)
const SINK = ICE.end + 1.5; // the sink's far side (as a lane distance)

// ------------------------------------------------------------------ sounds

function clink(sfx: Sfx, hard: number): void {
  const g = Math.min(0.12, 0.04 + hard * 0.03);
  tone(sfx, { freq: 2300 + Math.random() * 500, dur: 0.07, type: 'triangle', gain: g });
  tone(sfx, { freq: 3400 + Math.random() * 600, dur: 0.05, gain: g * 0.6, delay: 0.015 });
}

function whoosh(sfx: Sfx, speed: number): void {
  noise(sfx, { dur: 0.35, filter: 'bandpass', freq: 1400 + speed * 1200, to: 500, gain: 0.12 + speed * 0.1 });
}

function plop(sfx: Sfx): void {
  noise(sfx, { dur: 0.18, freq: 700, to: 200, gain: 0.3 });
  tone(sfx, { freq: 420, to: 180, dur: 0.16, gain: 0.1 });
}

function drip(sfx: Sfx): void {
  tone(sfx, { freq: 900, to: 1400, dur: 0.07, gain: 0.07 });
}

// ------------------------------------------------------------------ the view

interface CubeMesh {
  cube: Cube;
  lane: number;
  group: THREE.Group;
  puddle: THREE.Mesh;
  /** Seconds since it dropped into the sink (null while on the counter). */
  falling: number | null;
}

interface LaneView {
  x: number;
  color: string;
  companion: Companion;
  ready: THREE.Group;
  halo: THREE.Mesh;
}

/** An ice cube: a clear, wet block with a frosty heart and a glint on top. */
function iceCube(): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(1, 1, 1, 0.18), ICE_COLOR, 0, 0, 0, { opacity: 0.86, glow: 0.22, gloss: 0.9, exact: true });
  part(g, rbox(0.56, 0.56, 0.56, 0.14), '#ffffff', 0.03, -0.04, 0.02, { opacity: 0.4, ry: 0.5, rx: 0.3, shadow: false });
  part(g, rbox(0.42, 0.03, 0.16, 0.012), '#ffffff', -0.12, 0.5, -0.12, { ry: 0.5, glow: 0.8, outline: false, shadow: false });
  part(g, sphere(0.07, 8), '#ffffff', 0.24, 0.24, 0.5, { glow: 0.8, outline: false, shadow: false, sz: 0.3 });
  return g;
}

class KitchenView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: LaneView[] = [];
  readonly floaters: Floaters;
  private readonly fit = new CameraFit(this.camera, 0.95);
  private readonly marks: Mark[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private cubes: CubeMesh[] = [];
  private readonly puddleMat = material('#a9dcff', { opacity: 0.5, gloss: 0.9 });
  private readonly tick: (dt: number, time: number) => void;
  private sparks: { mesh: THREE.Mesh; v: THREE.Vector3; age: number; life: number }[] = [];
  private time = 0;

  constructor(
    seats: MinigameSeat[],
    companions: Companion[],
    private readonly state: IceLane[],
  ) {
    this.floaters = new Floaters(this.scene);
    // Night in the kitchen: cool moonlight from the window, warm pools from the little lights under the cupboards.
    const rig = lightRig(this.scene, 'nightInterior', { fog: { near: 40, far: 110 }, shadowSize: 13, sunFrom: [-0.3, 1, 0.25] });
    rig.sun.target.position.set(0, 0, -5);
    rig.sun.intensity *= 1.5;

    const xs = lanes(seats.length, ICE.lane + GAP);
    const half = (seats.length * (ICE.lane + GAP)) / 2;
    const set = new THREE.Group();
    this.buildKitchen(set, half);
    this.scene.add(set);
    this.tick = props.tickProps(set);

    seats.forEach((s, i) => {
      const x = xs[i] ?? 0;
      // The lane: a long oak serving board, a glowing throw line in the player's colour, the cork coaster.
      part(this.scene, rbox(ICE.lane, 0.02, ICE.end + 0.6, 0.01), i % 2 ? mix(P.oak, P.cream, 0.1) : mix(P.oak, P.cream, 0.2), x, 0.005, -(ICE.end - 0.6) / 2, { tex: 'wood', texScale: 2.6, gloss: 0.25, outline: false, shadow: false });
      part(this.scene, rbox(ICE.lane - 0.1, 0.025, 0.07, 0.01), s.color, x, 0.012, 0.35, { glow: 1.1, outline: false, shadow: false });
      withOutline(0.03, () => part(this.scene, cyl(ICE.rim, ICE.rim, 0.05, 48), CORK, x, 0.025, -ICE.coaster, { tex: 'terry', texScale: 0.8, texStrength: 0.7 }));
      part(this.scene, cyl(ICE.ring, ICE.ring, 0.05, 40), mix(s.color, P.cream, 0.55), x, 0.031, -ICE.coaster, { outline: false });
      part(this.scene, cyl(ICE.bull, ICE.bull, 0.05, 32), s.color, x, 0.037, -ICE.coaster, { outline: false, exact: true });
      part(this.scene, torus((ICE.rim + ICE.ring) / 2, 0.012), mix(CORK, P.ink, 0.3), x, 0.052, -ICE.coaster, { rx: Math.PI / 2, outline: false, shadow: false });
      part(this.scene, torus(ICE.ring, 0.01), mix(s.color, P.ink, 0.2), x, 0.058, -ICE.coaster, { rx: Math.PI / 2, outline: false, shadow: false });
      const c = companions[i] as Companion;
      c.root.position.set(x - 0.72, 0, 0.55);
      c.root.rotation.y = Math.PI / 2 - 0.55;
      c.setBase('idle');
      this.scene.add(c.root);
      const ready = iceCube();
      ready.scale.setScalar(ICE.size);
      ready.position.set(x, ICE.size / 2, 0);
      ready.visible = false;
      this.scene.add(ready);
      const halo = part(this.scene, torus(0.42, 0.035), P.lamp, 0, 0.06, 0, { rx: Math.PI / 2, glow: 2, shadow: false });
      halo.visible = false;
      const card = nameCard(s.name, s.color, 0.85);
      card.position.set(x, 0.12, 1.75);
      this.scene.add(card);
      this.owned.push(card.material.map as THREE.Texture, card.material);
      this.lanes.push({ x, color: s.color, companion: c, ready, halo });
    });
    // Chopsticks between and beside the lanes keep each cube to its own lane.
    for (let k = 0; k <= seats.length; k++) {
      const x = -half + k * (ICE.lane + GAP);
      part(this.scene, pill(0.06, ICE.end + 0.6), k % 2 ? P.cream : P.linen, x, 0.07, -(ICE.end - 0.6) / 2, { rx: Math.PI / 2, gloss: 0.3 });
      part(this.scene, cyl(0.064, 0.064, 0.5, 10), P.brick, x, 0.07, 0.3, { rx: Math.PI / 2, outline: false });
    }

    // What the camera keeps in view: the near edge with the names, the companions, the sink, the coasters.
    for (const x of [-half - 0.1, half + 0.1]) {
      this.marks.push({ p: new THREE.Vector3(x, 0, 2.1), pad: 0.05 }, { p: new THREE.Vector3(x, HEIGHT + 0.2, 0.6) });
      this.marks.push({ p: new THREE.Vector3(x, 0, -SINK) }, { p: new THREE.Vector3(x * 0.8, 1.5, -ICE.coaster), pad: 0.05 });
    }
  }

  private buildKitchen(s: THREE.Group, half: number): void {
    const wide = half * 2 + 44;
    const put = <T extends THREE.Object3D>(o: T, x: number, z: number, ry = 0, k = K, y = 0): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.multiplyScalar(k);
      s.add(o);
      return o;
    };
    // The worktop (dark oiled wood), its front edge, and the cupboard doors below.
    const top = mix(P.walnut, P.wood, 0.3);
    part(s, box(wide, 1.2, FRONT + ICE.end + 0.2), top, 0, -0.6, (FRONT - ICE.end - 0.2) / 2, { tex: 'wood', texScale: 5, gloss: 0.2, outline: false });
    part(s, rbox(wide, 0.16, 0.22, 0.06), mix(top, P.ink, 0.25), 0, -0.06, FRONT, { outline: false });
    for (let k = -9; k <= 9; k++) {
      part(s, rbox(2.2, 2.4, 0.12, 0.06), P.forest, k * 2.4, -2.5, FRONT + 0.05, { outline: false });
      part(s, cyl(0.03, 0.03, 0.5, 8), P.brass, k * 2.4 + (k % 2 ? 0.8 : -0.8), -1.7, FRONT + 0.14, { outline: false, gloss: 0.6 });
    }
    // The sink across the far end: a steel trough full of water, a tap on the wall.
    const sinkZ = -(ICE.end + SINK) / 2;
    part(s, box(wide - 4, 0.5, SINK - ICE.end), P.metal, 0, -0.85, sinkZ, { tex: 'metalPlate', gloss: 0.6, outline: false });
    part(s, box(wide - 4, 0.02, 0.05), P.stone, 0, 0.0, -ICE.end - 0.02, { gloss: 0.7, outline: false, shadow: false });
    const water = props.water({ w: wide - 4, d: SINK - ICE.end, shallow: '#4f9aa6', deep: '#27566b', sky: P.moon, waves: 0.012, scale: 0.5, segments: 8 });
    water.position.set(0, -0.42, sinkZ);
    s.add(water);
    part(s, box(wide, 0.2, 1.2), top, 0, -0.1, -SINK - 0.6, { tex: 'wood', texScale: 5, outline: false });
    withOutline(0.03, () => {
      const steel = { gloss: 0.8 };
      part(s, cyl(0.13, 0.16, 1.3, 16), P.stone, 2.2, 0.6, -SINK - 0.55, steel);
      part(s, pill(0.1, 1.1), P.stone, 2.2, 1.25, -SINK + 0.05, { rx: Math.PI / 2, ...steel });
      part(s, cyl(0.12, 0.12, 0.2, 12), P.stone, 2.2, 1.12, -SINK + 0.55, steel);
      part(s, rbox(0.5, 0.08, 0.14, 0.03), P.stone, 2.75, 1.3, -SINK - 0.55, steel);
    });
    // The tiled wall, the window on the night, cupboards with little lights underneath.
    const wallZ = -SINK - 1.25;
    part(s, box(wide, 12, 0.3), P.slate, 0, 5.6, wallZ, { tex: 'plaster', outline: false, shadow: false });
    part(s, box(wide, 3.1, 0.08), P.ceramic, 0, 1.55, wallZ + 0.18, { tex: 'kitchenTile', texScale: 2.4, gloss: 0.3, outline: false, shadow: false });
    put(props.windowFrame({ w: 1.5, h: 0.9, time: 'night', seed: 3 }), -1.4, wallZ + 0.2, 0, 3.2, 4.9);
    for (const x of [-half - 3.5, half + 3.5]) {
      part(s, rbox(4.4, 2.6, 1.6, 0.1), P.forest, x, 5.2, wallZ + 0.9);
      part(s, rbox(4.2, 0.08, 0.1, 0.03), P.lamp, x, 3.85, wallZ + 1.6, { glow: 2, shadow: false });
    }
    const lights: [number, number][] = [[-half - 2, -6], [half + 2, -6], [0, -ICE.end + 1]];
    for (const [x, z] of lights) {
      const l = new THREE.PointLight(P.lamp, 20, 20, 1.5);
      l.position.set(x, 3.6, z);
      s.add(l);
    }

    // Things on the counter. Left: a copper pot, mugs, a toaster, plates, a trailing plant, a candle.
    const lx = -half - 2.6;
    const rx = half + 2.6;
    put(props.blanket({ w: 0.4, d: 0.5, color: P.cream, tex: 'gingham' }), lx - 0.2, -3.4, 0.2);
    put(props.pot({ color: P.copper }), lx, -3.5, 0.5);
    put(props.mug({ color: P.rose }), lx + 0.9, -5.9, 0.9);
    put(props.mug({ color: P.teal }), lx - 0.4, -6.5, 2.4);
    withOutline(0.03, () => {
      // A little retro toaster with two slices up.
      const toaster = put(new THREE.Group(), lx, -8.9, 0.15, 1);
      part(toaster, rbox(1.5, 0.9, 0.9, 0.2), P.sage, 0, 0.5, 0, { gloss: 0.5 });
      part(toaster, rbox(1.3, 0.06, 0.74, 0.03), P.stone, 0, 0.955, 0, { gloss: 0.7, outline: false });
      for (const dz of [-0.17, 0.17]) {
        part(toaster, rbox(1.0, 0.04, 0.16, 0.02), P.ink, 0, 0.99, dz, { outline: false });
        part(toaster, rbox(0.8, 0.5, 0.1, 0.05), P.sand, 0, 1.1, dz, { tex: 'terry', texScale: 0.6 });
      }
      part(toaster, rbox(0.1, 0.16, 0.14, 0.03), P.ink, 0.78, 0.6, 0, { outline: false });
      part(toaster, rbox(1.4, 0.08, 0.8, 0.03), P.charcoal, 0, 0.04, 0, { outline: false });
    });
    put(props.plates({ n: 4 }), lx - 2.6, -1.2);
    put(props.plant({ kind: 'trailing', h: 0.28, pot: P.terracotta, seed: 5 }), lx + 0.1, -11.1);
    put(props.candle({ h: 0.09 }), lx + 1.5, 1.2);
    put(props.jar({ color: P.mustard }), lx - 2.8, -6.2);
    put(props.jar({ color: P.terracotta, h: 0.12 }), lx - 3.6, -5.4);
    put(props.pan(), lx - 3.4, -9.8, 0.6);

    // Right: a fruit bowl on a tea towel, the ice tray these cubes came from, jars, a bottle, a pepper mill.
    put(props.blanket({ w: 0.42, d: 0.34, color: P.denim, tex: 'gingham' }), rx + 0.1, -2.4, -0.25);
    put(props.snackBowl({ fill: 'fruit', color: P.ceramic, r: 0.13 }), rx, -2.4);
    withOutline(0.03, () => {
      const tray = put(new THREE.Group(), rx - 0.4, 0.9, -0.2, 1);
      part(tray, rbox(2.5, 0.3, 1.4, 0.08), P.teal, 0, 0.15, 0, { gloss: 0.4 });
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
          part(tray, rbox(0.46, 0.06, 0.5, 0.03), mix(P.teal, P.ink, 0.35), -0.87 + i * 0.58, 0.29, -0.3 + j * 0.6, { outline: false, shadow: false });
          if ((i + j) % 3) part(tray, rbox(0.4, 0.3, 0.44, 0.08), ICE_COLOR, -0.87 + i * 0.58, 0.3, -0.3 + j * 0.6, { opacity: 0.86, glow: 0.22, gloss: 0.9, exact: true, shadow: false });
        }
      }
    });
    put(props.jar({ color: P.sage, h: 0.2 }), rx + 0.2, -6.4);
    put(props.jar({ color: P.clay, h: 0.14 }), rx + 1.1, -5.5);
    put(props.drink({ kind: 'bottle', color: P.forest }), rx - 0.2, -8.9);
    put(props.mug({ color: P.mustard }), rx + 2.9, -3.6, 1.2);
    put(props.plates({ n: 2, color: P.sageWall }), rx + 3.0, -8.4);
    put(props.candle({ h: 0.14, color: P.rose }), rx + 0.4, -11.0);
    put(props.plant({ kind: 'cactus', h: 0.22, pot: P.ceramic, seed: 2 }), rx + 2.6, 0.6);
  }

  /** A little burst of bits: sparkles for points, droplets for a plop. */
  private burst(at: THREE.Vector3, colors: readonly string[], n: number, speed: number): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const mesh = part(this.scene, gem(0.06), colors[k % colors.length] as string, at.x, at.y, at.z, { glow: 1.6, shadow: false });
      this.sparks.push({ mesh, v: new THREE.Vector3(Math.cos(a) * speed, 2 + (k % 3) * 0.7, Math.sin(a) * speed), age: 0, life: 0.7 });
    }
  }

  /** Shows (or hides) the fresh cubes waiting at the throw line. */
  showReady(on: boolean[]): void {
    this.lanes.forEach((l, i) => (l.ready.visible = on[i] ?? false));
  }

  /** A cube was flicked: it leaves the throw line. */
  addCube(i: number, cube: Cube): void {
    const l = this.lanes[i];
    if (!l) return;
    l.ready.visible = false;
    const group = iceCube();
    this.scene.add(group);
    const puddle = part(this.scene, cyl(1, 1, 0.01, 22), '#a9dcff', 0, 0.008, 0, { material: this.puddleMat, shadow: false });
    puddle.visible = false;
    this.cubes.push({ cube, lane: i, group, puddle, falling: null });
    this.place();
    l.companion.react('working', 0.5);
  }

  /** Something happened to a cube (it dropped in the sink, or melted away). */
  event(e: IceEvent, sfx: Sfx): void {
    if (e.t === 'knock') return;
    const m = this.cubes.find((c) => c.cube === e.cube);
    if (!m) return;
    if (e.t === 'sink') {
      m.falling = 0;
      plop(sfx);
      this.floaters.add('Plop!', P.screen, m.group.position.clone().setY(1), 0.5, 1);
      this.burst(new THREE.Vector3(m.group.position.x, 0.1, -ICE.end - 0.6), [P.screen, '#ffffff'], 7, 1.1);
    } else {
      this.scene.remove(m.group);
      drip(sfx);
    }
  }

  /** Lights a halo round each lane's best cube (or hides them). */
  halos(on: boolean): void {
    this.lanes.forEach((l, i) => {
      const lane = this.state[i];
      const best = on && lane ? bestCube(lane) : null;
      l.halo.visible = best !== null && cubePoints(best) > 0;
      if (best) l.halo.position.set(l.x + best.x, 0.07, -best.z);
    });
  }

  /** Floating points over a lane's coaster. */
  score(i: number, points: number): void {
    const l = this.lanes[i];
    if (!l) return;
    const word = points === 3 ? 'Bullseye! +3' : points > 0 ? `+${points}` : 'No points';
    this.floaters.add(word, points > 0 ? l.color : '#d8d8e8', new THREE.Vector3(l.x, 1.2, -ICE.coaster), points === 3 ? 0.7 : 0.6, 1.6);
    if (points > 0) this.burst(new THREE.Vector3(l.x, 0.3, -ICE.coaster), [l.color, P.lamp], points === 3 ? 14 : 8, points === 3 ? 2.2 : 1.5);
  }

  /** Moves every cube mesh to where its cube is. */
  private place(): void {
    for (const m of this.cubes) {
      const l = this.lanes[m.lane];
      if (!l || m.falling !== null) continue;
      const c = m.cube;
      const onCoaster = fromCentre(c) < ICE.rim ? 0.05 : 0;
      m.group.scale.setScalar(Math.max(0.01, c.size));
      m.group.position.set(l.x + c.x, c.size / 2 + onCoaster, -c.z);
      m.group.rotation.y = c.angle;
      const wet = ICE.size - c.size;
      m.puddle.visible = wet > 0.02;
      const r = 0.2 + wet * 1.6;
      m.puddle.scale.set(r, 1, r);
      m.puddle.position.set(l.x + c.x, 0.008 + onCoaster, -c.z);
    }
  }

  dispose(): void {
    for (const l of this.lanes) l.companion.dispose();
    this.floaters.dispose();
    for (const o of this.owned) o.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.tick(dt, this.time);
    this.sparks = this.sparks.filter((p) => {
      p.age += dt;
      p.v.y -= dt * 7;
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.rotation.y += dt * 6;
      p.mesh.scale.setScalar(Math.max(0.001, 1 - p.age / p.life));
      if (p.age < p.life) return true;
      this.scene.remove(p.mesh);
      return false;
    });
    this.fit.update(() => this.marks);
    this.floaters.update(dt);
    for (const l of this.lanes) {
      l.companion.update(dt);
      if (l.ready.visible) l.ready.position.y = ICE.size / 2 + Math.abs(Math.sin(this.time * 3)) * 0.04;
      if (l.halo.visible) l.halo.scale.setScalar(1 + Math.sin(this.time * 5) * 0.08);
    }
    this.place();
    // Cubes that went over the edge drop into the sink.
    this.cubes = this.cubes.filter((m) => {
      if (m.falling === null) return true;
      m.falling += dt;
      m.group.position.y -= dt * (1 + m.falling * 9);
      m.group.position.z -= dt * 1.2;
      m.group.rotation.x += dt * 4;
      if (m.falling < 0.6) return true;
      this.scene.remove(m.group);
      this.scene.remove(m.puddle);
      return false;
    });
  }
}

// ------------------------------------------------------------------ the game

/** Steps every lane and passes what happened on to the view (and a clink now and then). */
function stepAll(state: IceLane[], view: KitchenView, sfx: Sfx, dt: number, clinkAt: { t: number }, now: number): void {
  for (const lane of state) {
    for (const e of stepLane(lane, Math.min(dt, 0.6))) {
      if (e.t === 'knock') {
        if (now - clinkAt.t > 0.08) {
          clinkAt.t = now;
          clink(sfx, e.hard);
        }
      } else view.event(e, sfx);
    }
  }
}

/** A short word on a throw for its phone: how it did, and a nudge for the next one. */
function verdict(points: number, thrown: Cube | null, last: boolean): string {
  const head = points === 3 ? 'Bullseye! 3 points' : points === 2 ? 'On the ring: 2 points' : points === 1 ? 'On the coaster: 1 point' : 'No points this time';
  if (!thrown) return `${head}. Flick up to slide your cube!`;
  if (last) return `${head}.`;
  if (thrown.gone === 'sink') return `${head}. Into the sink! Flick a bit softer.`;
  if (thrown.z < ICE.coaster - ICE.rim) return `${head}. Too short: flick a bit harder.`;
  if (thrown.z > ICE.coaster + ICE.rim) return `${head}. Too far: flick a bit softer.`;
  return `${head}. Nice flick!`;
}

export const minigame: Minigame = {
  id: 'icecube',
  title: 'Ice Cube Curling',
  how: 'Flick up on your phone to slide an ice cube down the counter: the faster the flick, the further it glides. Land it on the coaster, bullseye is 3. Three throws, and watch out, they melt!',
  controller: 'swipe',
  kind: 'ffa',

  async play(ctx: MinigameContext) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const state = seats.map(() => newLane());
    const skill = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : 0.5));
    const view = new KitchenView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), state);
    ctx.stage.setView(view);
    const clinkAt = { t: -1 };
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: roundsLine(state[i] as IceLane) })));
    live();

    let phase: 'throw' | 'wait' = 'wait';
    let round = 0;
    let now = 0;
    const thrown: (Cube | null)[] = seats.map(() => null);
    const flick: ({ at: number; speed: number } | null)[] = seats.map(() => null);
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'swipe' || msg.dir !== 'up' || seat >= n || session.isCpu(seat)) return;
      if (phase !== 'throw' || thrown[seat]) return;
      const f = flick[seat];
      // A flick can arrive as a few swipes; the fastest of them counts.
      if (!f) flick[seat] = { at: now, speed: msg.speed };
      else f.speed = Math.max(f.speed, msg.speed);
    });
    const release = (i: number, speed: number) => {
      const lane = state[i] as IceLane;
      thrown[i] = throwCube(lane, speed, rng() * 2 - 1, round);
      view.addCube(i, thrown[i] as Cube);
      whoosh(sfx, speed);
      if (!session.isCpu(i)) {
        session.send(i, { t: 'buzz', pattern: [18] });
        session.send(i, { t: 'feedback', good: true, text: 'Wheee… watch the big screen.' });
      }
    };

    for (round = 0; round < ICE.rounds; round++) {
      thrown.fill(null);
      flick.fill(null);
      const delays = seats.map((_, i) => cpuDelay(skill[i] ?? 0.5, rng));
      view.showReady(seats.map(() => true));
      session.setLayoutAll(() => ({ kind: 'swipe', note: `Throw ${round + 1} of ${ICE.rounds}: flick up to slide your ice cube`, dirs: ['up'], labels: { up: 'Slide' } }));
      ui.caption(`Throw ${round + 1} of ${ICE.rounds}: flick up to slide your ice cube!`);
      sfx.tick();
      phase = 'throw';
      const start = clock.time;
      await everyFrame(clock, (dt) => {
        now = clock.time - start;
        seats.forEach((_, i) => {
          if (thrown[i]) return;
          if (session.isCpu(i)) {
            if (now >= (delays[i] ?? 1)) release(i, cpuFlick(skill[i] ?? 0.5, rng));
            return;
          }
          const f = flick[i];
          if (f && now - f.at >= ICE.gather) release(i, f.speed);
        });
        stepAll(state, view, sfx, dt, clinkAt, now);
        ui.timer(ICE.throwWindow - now);
        return thrown.every((c) => c !== null) || now >= ICE.throwWindow;
      });
      phase = 'wait';
      // A flick that came in just as time ran out still counts.
      seats.forEach((_, i) => {
        const f = flick[i];
        if (!thrown[i] && f) release(i, f.speed);
      });
      ui.timer(null);
      view.showReady(seats.map(() => false));
      seats.forEach((_, i) => {
        if (!thrown[i] && !session.isCpu(i)) session.send(i, { t: 'feedback', good: false, text: 'Too slow: that one melted in your hand!' });
      });

      // Let everything glide to a stop.
      ui.caption('Wheee…');
      const glideStart = clock.time;
      await everyFrame(clock, (dt) => {
        stepAll(state, view, sfx, dt, clinkAt, clock.time);
        return !state.some(laneMoving) || clock.time - glideStart > 8;
      });

      // Score the round from each lane's best cube.
      const points = state.map((lane) => scoreRound(lane, round));
      view.halos(true);
      points.forEach((p, i) => {
        view.score(i, p);
        const c = view.lanes[i]?.companion;
        if (p === 3) c?.react('happy', 1.8);
        else if (p > 0) c?.react('approval', 1.4);
        else c?.react('sad', 1.4);
        if (!session.isCpu(i)) {
          session.send(i, { t: 'feedback', good: p > 0, text: verdict(p, thrown[i] ?? null, round === ICE.rounds - 1) });
          if (p > 0) session.send(i, { t: 'buzz', pattern: p === 3 ? [30, 40, 30, 40, 60] : [30] });
        }
      });
      const top = Math.max(...points);
      if (top === 3) sfx.ring(true);
      else if (top > 0) sfx.ring(false);
      live();
      ui.caption(`Throw ${round + 1}: ${seats.map((s, i) => `${s.name} ${points[i]}`).join(' · ')}`);
      const pause = clock.time;
      await everyFrame(clock, (dt) => {
        stepAll(state, view, sfx, dt, clinkAt, clock.time);
        return clock.time - pause > 1.8;
      });
      view.halos(false);
    }
    off();
    const scores = iceScores(state);
    const best = Math.max(...scores);
    scores.forEach((s, i) => {
      if (s === best) view.lanes[i]?.companion.react('happy', 3);
    });
    ui.caption(null);
    return { scores, details: state.map(iceDetail) };
  },
};
