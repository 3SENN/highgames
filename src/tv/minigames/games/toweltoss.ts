// Towel Toss on the TV: a pool deck at sunset, a little white fence down the middle. Each pair holds a striped
// beach towel between them and flings water balloons over the fence; what isn't caught bursts on the tiles.
import * as THREE from 'three';
import {
  type Balloon,
  type CpuHolder,
  type Deck,
  type DeckEvents,
  IDLE,
  type Stick,
  TOWEL,
  cpuStick,
  isOver,
  newCpuHolder,
  newDeck,
  sideOf,
  stepDeck,
  towelAngle,
  towelEnds,
  towelScores,
} from '../../../game/minigames/toweltoss';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { preloadTextures } from '../../render/textures';
import { PALETTE as P, box, cone, cyl, mix, nameCard, part, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.3; // companions
const TILT = 0.8; // the camera looks down this much (radians)
const BALLOONS = [mix(P.rose, P.neonPink, 0.45), mix(P.denim, P.neonCyan, 0.45), mix(P.mustard, P.lamp, 0.3), mix(P.fern, P.neonCyan, 0.25), mix(P.mauve, P.neonViolet, 0.45)];
const SPLASH = mix(P.screen, P.water, 0.45);
const POOL_Z = -TOWEL.half.z - 0.45; // the pool's near edge
const SPLASHES_MAX = 24;

// ------------------------------------------------------------------ sounds

/** A rubbery twang as the towel flings a balloon. */
function boing(sfx: Sfx, power: number): void {
  tone(sfx, { freq: 170, to: 330 + power * 200, dur: 0.18, type: 'triangle', gain: 0.14 });
  noise(sfx, { dur: 0.12, filter: 'bandpass', freq: 800, to: 2000, gain: 0.08 });
}

/** A soft plap into the towel. */
function plap(sfx: Sfx): void {
  tone(sfx, { freq: 260, to: 160, dur: 0.1, gain: 0.14 });
  noise(sfx, { dur: 0.08, filter: 'lowpass', freq: 700, gain: 0.15 });
}

/** A water balloon bursting. */
function sploosh(sfx: Sfx, big: boolean): void {
  noise(sfx, { dur: big ? 0.35 : 0.22, filter: 'bandpass', freq: 1600, to: 380, gain: big ? 0.4 : 0.25 });
  tone(sfx, { freq: 520, to: 140, dur: 0.16, gain: 0.08 });
}

/** A fresh balloon plopping onto the towel. */
function plip(sfx: Sfx): void {
  tone(sfx, { freq: 620, to: 880, dur: 0.07, gain: 0.07 });
}

// ------------------------------------------------------------------ props

function balloonMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, sphere(TOWEL.ballR, 20), color, 0, 0, 0, { sy: 1.1, gloss: 0.8, exact: true, outline: 0.02 });
  part(g, cone(0.05, 0.08, 8), mix(color, P.ink, 0.25), 0, -TOWEL.ballR * 1.1 - 0.02, 0, { rx: Math.PI, outline: false });
  part(g, sphere(0.045, 8), P.cream, -0.07, 0.09, 0.12, { glow: 0.9, opacity: 0.85, outline: false, shadow: false });
  return g;
}

/** A striped beach towel, one unit long along x (stretched to fit), lying flat. */
function towelMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  const terry = { tex: 'terry' as const, texScale: 0.5, outline: false as const };
  part(g, box(1, 0.03, 0.62), P.cream, 0, 0, 0, terry);
  for (const z of [-0.22, 0.22]) part(g, box(1, 0.034, 0.12), color, 0, 0, z, terry);
  part(g, box(1, 0.036, 0.05), mix(color, P.cream, 0.45), 0, 0, 0, terry);
  for (const z of [-0.3, 0.3]) part(g, box(1, 0.02, 0.025), mix(color, P.ink, 0.25), 0, 0, z, { outline: false });
  return g;
}

function lounger(parent: THREE.Object3D, x: number, z: number, color: string, ry: number): void {
  const g = new THREE.Group();
  part(g, rbox(0.75, 0.1, 1.9, 0.04), P.oak, 0, 0.3, 0, { tex: 'planks', texScale: 0.5 });
  part(g, rbox(0.68, 0.09, 1.2, 0.04), color, 0, 0.4, 0.3, { tex: 'fabric' });
  part(g, rbox(0.68, 0.09, 0.7, 0.04), color, 0, 0.6, -0.62, { tex: 'fabric', rx: -0.6 });
  part(g, rbox(0.5, 0.1, 0.24, 0.05), P.cream, 0, 0.78, -0.72, { tex: 'terry', rx: -0.6, outline: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, cyl(0.035, 0.035, 0.28, 8), P.walnut, sx * 0.3, 0.14, sz * 0.8, { outline: false });
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  parent.add(g);
}

// ------------------------------------------------------------------ the scene

interface Rig {
  c: Companion;
  ring: THREE.Mesh;
  card: THREE.Sprite;
  motion: 'walk' | 'run' | null;
  yaw: number;
}

interface TowelRig {
  towel: THREE.Group;
  /** Balloons resting on it. */
  resting: THREE.Group[];
  aim: THREE.Group;
  color: string;
  flick: number;
  /** The newest resting balloon is still dropping in (1 → 0). */
  drop: number;
}

interface Flying {
  mesh: THREE.Group;
  shadow: THREE.Mesh;
  marker: THREE.Mesh;
}

interface Splash {
  m: THREE.Mesh;
  age: number;
  sx: number;
}

interface Drop {
  m: THREE.Mesh;
  v: THREE.Vector3;
  age: number;
}

class PoolDeck implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly floaters: Floaters;
  readonly rigs: (Rig | undefined)[] = [];
  readonly towels: (TowelRig | undefined)[] = [];
  private readonly flying = new Map<number, Flying>();
  private splashes: Splash[] = [];
  private drops: Drop[] = [];
  private readonly fit: CameraFit;
  private readonly marks: Mark[];
  private readonly floats: { g: THREE.Object3D; x: number; z: number; phase: number }[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private readonly rand = seeded(73);
  private ripples: { m: THREE.Mesh; age: number }[] = [];
  private tick: (dt: number, time: number) => void = () => {};
  private time = 0;

  constructor(seats: MinigameSeat[], teams: number[][], companions: (Companion | undefined)[]) {
    // Golden hour: a low warm sun from the front left, long shadows across the deck, blue-violet shade.
    lightRig(this.scene, 'goldenHour', { fog: { near: 30, far: 95 }, shadowSize: 14, sunFrom: [-0.65, 0.55, 0.5] });
    this.floaters = new Floaters(this.scene);
    this.build();
    this.tick = props.tickProps(this.scene);

    seats.forEach((seat, p) => {
      const c = companions[p];
      if (!c) return;
      c.setBase('listening');
      this.scene.add(c.root);
      const ring = part(this.scene, torus(0.45, 0.045), seat.color, 0, 0.045, 0, { rx: Math.PI / 2, glow: 0.9, outline: false, shadow: false });
      const card = nameCard(seat.name, seat.color, 0.85);
      this.scene.add(card);
      this.rigs[p] = { c, ring, card, motion: null, yaw: 0 };
    });
    teams.forEach((members, team) => {
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      const towel = towelMesh(color);
      this.scene.add(towel);
      const resting = Array.from({ length: TOWEL.stockMax }, (_, i) => {
        const b = balloonMesh(BALLOONS[(team * 2 + i) % BALLOONS.length] as string);
        this.scene.add(b);
        return b;
      });
      const aim = new THREE.Group();
      part(aim, cone(0.16, 0.42, 3), color, 0, 0, 0, { rx: Math.PI / 2, sz: 0.25, glow: 1.2, outline: false, shadow: false });
      this.scene.add(aim);
      this.towels[team] = { towel, resting, aim, color, flick: 0, drop: 0 };
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.0);
      card.position.set(-sideOf(team) * 4, 0.2, TOWEL.half.z + 0.75);
      // The pair's half of the court: a thin strip of their colour along its front edge.
      part(this.scene, box(TOWEL.half.x - 0.5, 0.012, 0.05), color, -sideOf(team) * (TOWEL.half.x / 2 + 0.05), 0.012, TOWEL.half.z - 0.02, { glow: 0.8, outline: false, shadow: false });
      this.scene.add(card);
      this.cards.push(card);
    });

    const { x, z } = TOWEL.half;
    this.marks = [
      ...[-x - 0.2, x + 0.2].flatMap((mx) => [
        { p: new THREE.Vector3(mx, 0, z + 0.3), pad: 0.02 },
        { p: new THREE.Vector3(mx, 0, -z - 0.2), pad: 0.02 },
        { p: new THREE.Vector3(mx * 0.8, HEIGHT + 0.6, -z), pad: 0.05 },
      ]),
      { p: new THREE.Vector3(0, 3.6, 0), pad: 0.02 },
      { p: new THREE.Vector3(0, 0, z + 0.9), pad: 0.05 },
    ];
    this.fit = new CameraFit(this.camera, TILT);
  }

  /** The deck tiles, the pool behind, the fence down the middle, palms, loungers and parasols all round. */
  private build(): void {
    const s = this.scene;
    const { x: hx, z: hz } = TOWEL.half;
    const flat = { outline: false as const, shadow: false };
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, scale = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      s.add(o);
      return o;
    };
    // The garden the deck sits in, the stone deck, and the court on it in terracotta tiles.
    part(s, cyl(70, 70, 0.3, 40), mix(P.grass, P.olive, 0.4), 0, -0.35, 0, { tex: 'grass', texScale: 5, ...flat });
    part(s, box(hx * 2 + 7, 0.2, hz * 2 + 7), P.sand, -0.6, -0.11, POOL_Z + 0.05 + (hz * 2 + 7) / 2, { tex: 'stoneTiles', ...flat });
    part(s, box(hx * 2 + 0.5, 0.2, hz * 2 + 0.4), P.clay, 0, -0.1, 0, { tex: 'patio', ...flat });
    part(s, box(hx * 2 + 0.74, 0.2, hz * 2 + 0.64), mix(P.sand, P.ink, 0.2), 0, -0.105, 0, { tex: 'stoneTiles', ...flat });

    // The pool along the back: living water, a pale stone edge, a ladder and a couple of floats.
    const poolD = 6.4;
    const poolW = hx * 2 + 5;
    const pz = POOL_Z - poolD / 2 - 0.2;
    const coping = { tex: 'stoneTiles' as const, texScale: 1.2, ...flat };
    for (const k of [-1, 1]) {
      part(s, box(poolW + 0.8, 0.22, 0.4), P.ceramic, -0.6, -0.08, pz + k * (poolD / 2 + 0.2), coping);
      part(s, box(0.4, 0.22, poolD), P.ceramic, -0.6 + k * (poolW / 2 + 0.2), -0.08, pz, coping);
    }
    part(s, box(poolW, 0.3, poolD), mix(P.teal, P.midnight, 0.3), -0.6, -0.32, pz, flat);
    put(props.water({ w: poolW, d: poolD, waves: 0.015, scale: 1.3, segments: 24, shallow: '#4cc0c4', deep: '#2a86a8', sky: P.lamp }), -0.6, -0.03, pz);
    for (const dx of [-0.25, 0.25]) part(s, torus(0.3, 0.03, Math.PI), P.stone, 5.5 + dx, 0.05, POOL_Z - 0.2, { ry: Math.PI / 2, gloss: 0.7, outline: false });
    const ring = new THREE.Group();
    part(ring, torus(0.4, 0.14), P.terracotta, 0, 0, 0, { rx: Math.PI / 2, gloss: 0.5 });
    for (let i = 0; i < 4; i++) part(ring, torus(0.4, 0.145, Math.PI / 4), P.cream, 0, 0, 0, { rx: Math.PI / 2, rz: (i * Math.PI) / 2, gloss: 0.5, outline: false });
    s.add(ring);
    this.floats.push({ g: ring, x: -3.5, z: POOL_Z - 1.8, phase: 0 });
    const lilo = new THREE.Group();
    part(lilo, rbox(0.9, 0.14, 2.0, 0.07), P.mustard, 0, 0, 0, { gloss: 0.4 });
    for (let i = -2; i <= 2; i++) part(lilo, rbox(0.92, 0.15, 0.06, 0.02), mix(P.mustard, P.cream, 0.5), 0, 0, i * 0.35, { outline: false });
    part(lilo, rbox(0.8, 0.2, 0.4, 0.1), P.mustard, 0, 0.06, -0.85, { gloss: 0.4, outline: false });
    lilo.rotation.y = 1.2;
    s.add(lilo);
    this.floats.push({ g: lilo, x: 3.2, z: POOL_Z - 2.9, phase: 1.7 });
    const duck = new THREE.Group();
    part(duck, sphere(0.2, 14), P.mustard, 0, 0.06, 0, { sy: 0.8, gloss: 0.5 });
    part(duck, sphere(0.12, 12), P.mustard, 0.13, 0.26, 0, { gloss: 0.5 });
    part(duck, cone(0.05, 0.1, 8), P.ember, 0.27, 0.25, 0, { rz: -Math.PI / 2, outline: false });
    s.add(duck);
    this.floats.push({ g: duck, x: 0.4, z: POOL_Z - 4.4, phase: 3.1 });

    // Beyond the pool: loungers under parasols, a hedge, and palms against the evening.
    const far = pz - poolD / 2 - 0.4;
    part(s, box(poolW + 6, 0.2, 8), P.sand, -0.6, -0.11, far - 3.8, { tex: 'stoneTiles', ...flat });
    for (const [lx, c, pc] of [
      [-6.4, P.teal, P.terracotta],
      [-1.2, P.rose, P.mustard],
      [4.2, P.denim, P.teal],
    ] as const) {
      lounger(s, lx, far - 1.2, c, Math.PI);
      lounger(s, lx + 1.0, far - 1.2, c, Math.PI);
      put(props.parasol({ colors: [pc, P.cream], h: 2.3 }), lx + 0.5, 0, far - 2.0);
    }
    put(props.hedge({ w: 30, h: 1.3, d: 1.0, seed: 6 }), -0.6, 0, far - 3.6);
    [-12, -7.5, -2.5, 3, 8, 12.5].forEach((tx, i) => put(props.tree({ kind: 'palm', h: 5 + (i % 3) * 0.7, seed: i + 3 }), tx, 0, far - 4.6 - (i % 2) * 0.8, i * 1.3));

    // The low white fence down the middle.
    put(props.fence({ w: hz * 2 + 0.2, kind: 'picket', h: 0.66, color: P.ceramic }), 0, 0, 0, Math.PI / 2);

    // Either end of the court: palms, a lounger and a parasol, towels and drinks, planters, a hedge behind.
    for (const side of [-1, 1]) {
      put(props.tree({ kind: 'palm', h: 4.4, seed: side > 0 ? 4 : 7 }), side * (hx + 1.5), 0, -hz - 0.1, side * 0.8);
      put(props.tree({ kind: 'palm', h: 3.8, seed: side > 0 ? 9 : 12 }), side * (hx + 2.7), 0, hz - 1.0, side * 2);
      lounger(s, side * (hx + 1.4), 1.0, side < 0 ? P.denim : P.rose, side * 0.25);
      put(props.blanket({ color: side < 0 ? P.terracotta : P.teal, stripes: P.cream, w: 0.9, d: 1.7 }), side * (hx + 1.5), 0, -1.4, side * 0.5);
      put(props.sideTable({ h: 0.4, color: P.oak }), side * (hx + 2.2), 0, 0.2);
      put(props.drink({ kind: 'bottle', color: P.forest }), side * (hx + 2.2) - 0.06, 0.4, 0.2, 0, 1.5);
      put(props.drink({ kind: 'can', color: P.terracotta }), side * (hx + 2.2) + 0.1, 0.4, 0.26, 0, 1.5);
    }
    put(props.parasol({ colors: [P.teal, P.cream], h: 2.4, r: 1.4 }), -hx - 2.1, 0, 1.4, 0.3);
    put(props.hedge({ w: 15, h: 1.1, d: 0.9, seed: 3 }), -hx - 4.1, 0, 1.5, Math.PI / 2);
    put(props.hedge({ w: 15, h: 1.1, d: 0.9, seed: 8 }), hx + 3.4, 0, 1.5, Math.PI / 2);
    // Warm bulbs strung from palm to palm along the back of the court.
    const posts = [-hx - 1.2, -hx / 2, 0, hx / 2, hx + 1.2];
    for (let i = 0; i < posts.length - 1; i++) {
      s.add(props.stringLights(new THREE.Vector3(posts[i] as number, 3.3, -hz - 0.35), new THREE.Vector3(posts[i + 1] as number, 3.3, -hz - 0.35), { sag: 0.3, count: 9 }));
    }
    for (const px of posts.slice(1, -1)) part(s, cyl(0.03, 0.04, 3.3, 8), P.walnut, px, 1.65, -hz - 0.35, { tex: 'wood', outline: false });

    // In front of the court: planters at the corners, a pile of spare towels, a bucket of water balloons, flip-flops.
    for (const [px, kind] of [
      [-hx - 0.4, 'palm'],
      [hx + 0.2, 'monstera'],
    ] as const) {
      put(props.plant({ kind, h: 1.3, pot: P.terracotta, seed: 5 }), px, 0, hz + 1.6, 0, 1.3);
    }
    const bucket = new THREE.Group();
    part(bucket, cyl(0.34, 0.26, 0.42, 20), P.denim, 0, 0.21, 0, { gloss: 0.5 });
    part(bucket, torus(0.34, 0.02), P.stone, 0, 0.42, 0, { rx: Math.PI / 2, gloss: 0.7, outline: false });
    BALLOONS.forEach((c, i) => part(bucket, sphere(0.15, 12), c, Math.cos(i * 1.26) * 0.14, 0.44 + (i % 2) * 0.08, Math.sin(i * 1.26) * 0.14, { gloss: 0.8, exact: true, outline: false }));
    put(bucket, -1.1, 0, hz + 2.5);
    const towels = new THREE.Group();
    [P.teal, P.cream, P.terracotta, P.mustard].forEach((c, i) => part(towels, rbox(0.7, 0.1, 0.5, 0.04), c, 0, 0.05 + i * 0.1, 0, { tex: 'terry', texScale: 0.5, ry: i * 0.12, outline: 0.012 }));
    put(towels, 1.6, 0, hz + 2.4, 0.3);
    for (const [fx, c] of [[3.2, P.rose], [3.42, P.rose], [-3.6, P.teal], [-3.38, P.teal]] as const) {
      part(s, rbox(0.14, 0.03, 0.34, 0.03), c, fx, 0.015, hz + 2.2 + (fx > 0 ? 0 : 0.2), { ry: fx * 0.5, outline: false });
    }
    lounger(s, -hx + 1.2, hz + 3.6, P.mustard, -1.2);
    lounger(s, hx - 2.4, hz + 3.5, P.teal, 1.1);
    put(props.bush({ r: 0.7, color: P.olive, flowers: P.rose, seed: 4 }), 5.2, 0, hz + 5.6);
    put(props.bush({ r: 0.8, color: P.fern, flowers: P.cream, seed: 6 }), -4.4, 0, hz + 5.9);
  }

  /** Puts everyone where the rules say; each pair's towel stretched between them. */
  sync(d: Deck, dt: number): void {
    const follow = 1 - Math.exp(-dt * 10);
    d.holders.forEach((h, p) => {
      const r = this.rigs[p];
      const team = d.teamOf[p] ?? -1;
      if (!r || team < 0) return;
      const root = r.c.root;
      root.position.set(h.x, 0, h.z);
      // Facing over the fence, the way their towel faces.
      const a = towelAngle(d, team);
      const target = Math.atan2(sideOf(team) * Math.cos(a), Math.sin(a));
      r.yaw += Math.atan2(Math.sin(target - r.yaw), Math.cos(target - r.yaw)) * follow;
      root.rotation.set(0, r.yaw, 0);
      const speed = Math.hypot(h.vx, h.vz);
      const motion = speed < 0.35 ? null : speed > 2.8 ? 'run' : 'walk';
      if (motion !== r.motion) {
        r.motion = motion;
        r.c.move(motion, speed);
      }
      r.ring.position.set(h.x, 0.04, h.z);
      r.card.position.set(h.x, HEIGHT + 0.42, h.z);
    });
    d.sides.forEach((side, team) => {
      const tr = this.towels[team];
      const e = towelEnds(d, team);
      if (!tr || !e) return;
      tr.flick = Math.max(0, tr.flick - dt * 4);
      tr.drop = Math.max(0, tr.drop - dt * 2.5);
      const dx = e.bx - e.ax;
      const dz = e.bz - e.az;
      const len = Math.hypot(dx, dz);
      const two = side.members.length > 1;
      const shown = two ? Math.max(0.3, len - 0.4) : len;
      const cx = (e.ax + e.bx) / 2;
      const cz = (e.az + e.bz) / 2;
      const yaw = Math.atan2(-dz, dx);
      const bounce = Math.sin(tr.flick * Math.PI) * 0.25;
      tr.towel.position.set(cx, TOWEL.holdY + bounce, cz);
      tr.towel.rotation.set(0, yaw, Math.sin(this.time * 2 + team) * 0.02);
      tr.towel.scale.set(shown, 1, 1 - Math.max(0, len - 2) * 0.12);
      // Resting balloons sit along the towel; the newest may still be dropping in.
      tr.resting.forEach((b, i) => {
        b.visible = i < side.stock;
        if (!b.visible) return;
        const k = side.stock === 1 ? 0 : (i / (side.stock - 1) - 0.5) * Math.min(0.6, shown * 0.5);
        const fall = i === side.stock - 1 ? tr.drop * tr.drop * 2.5 : 0;
        b.position.set(cx + (dx / Math.max(1e-6, len)) * k, TOWEL.holdY + TOWEL.ballR + 0.03 + bounce + fall + Math.sin(this.time * 4 + i) * 0.015, cz + (dz / Math.max(1e-6, len)) * k);
      });
      // An arrow on the deck in front of the towel shows where it'll fling.
      const a = towelAngle(d, team);
      const fx = sideOf(team) * Math.cos(a);
      const fz = Math.sin(a);
      tr.aim.visible = side.stock > 0;
      tr.aim.position.set(cx + fx * 1.0, 0.05, cz + fz * 1.0);
      tr.aim.rotation.set(0, Math.atan2(fx, fz), 0);
    });
  }

  /** A balloon leaves a towel. */
  launched(b: Balloon, team: number): void {
    const color = BALLOONS[b.id % BALLOONS.length] as string;
    const mesh = balloonMesh(color);
    this.scene.add(mesh);
    const shadow = part(this.scene, cyl(TOWEL.ballR, TOWEL.ballR, 0.01, 20), P.ink, b.x, 0.03, b.z, { opacity: 0.28, outline: false, shadow: false });
    const tcolor = this.towels[team]?.color ?? P.cream;
    const marker = part(this.scene, torus(0.36, 0.04), tcolor, b.tx, 0.05, b.tz, { rx: Math.PI / 2, glow: 1.3, outline: false, shadow: false });
    this.flying.set(b.id, { mesh, shadow, marker });
    const tr = this.towels[team];
    if (tr) tr.flick = 1;
  }

  /** Moves everything in the air. */
  fly(d: Deck): void {
    for (const b of d.balloons) {
      const f = this.flying.get(b.id);
      if (!f) continue;
      const stretch = 1 + Math.min(0.25, Math.abs(b.vy) * 0.025);
      f.mesh.position.set(b.x, b.y, b.z);
      f.mesh.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
      f.mesh.rotation.set(Math.atan2(b.vz, Math.abs(b.vy)) * 0.3, 0, -Math.atan2(b.vx, Math.abs(b.vy)) * 0.3);
      f.shadow.position.set(b.x, 0.03, b.z);
      const left = Math.max(0, b.at - d.time);
      f.marker.visible = !b.missed;
      f.marker.scale.setScalar(0.8 + Math.min(1.2, left) * 0.5 + Math.sin(this.time * 12) * 0.04);
    }
  }

  private forget(id: number): Flying | undefined {
    const f = this.flying.get(id);
    if (!f) return undefined;
    this.flying.delete(id);
    f.shadow.removeFromParent();
    f.marker.removeFromParent();
    return f;
  }

  /** Caught: it joins the balloons resting on the towel. */
  caught(b: Balloon, team: number): void {
    this.forget(b.id)?.mesh.removeFromParent();
    const tr = this.towels[team];
    if (tr) tr.flick = 0.5;
  }

  /** It hit the deck (or the pool): a burst of water and a puddle. */
  burst(b: Balloon, pool: boolean): void {
    this.forget(b.id)?.mesh.removeFromParent();
    const y = pool ? -0.02 : 0.02;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + this.rand();
      const m = part(this.scene, sphere(0.05 + this.rand() * 0.03, 8), SPLASH, b.x, 0.15, b.z, { glow: 0.35, outline: false, shadow: false });
      this.drops.push({ m, v: new THREE.Vector3(Math.cos(a) * (1.2 + this.rand()), 2.2 + this.rand() * 1.5, Math.sin(a) * (1.2 + this.rand())), age: 0 });
    }
    if (pool) {
      // Rings spreading across the water.
      for (const delay of [0, 0.18]) {
        const mat = new THREE.MeshBasicMaterial({ color: P.cream, transparent: true, opacity: 0.8, depthWrite: false });
        const r = part(this.scene, torus(0.3, 0.025), P.cream, b.x, y + 0.03, b.z, { rx: Math.PI / 2, material: mat, outline: false, shadow: false });
        r.visible = false;
        this.ripples.push({ m: r, age: -delay });
      }
      return;
    }
    const m = part(this.scene, cyl(0.55, 0.55, 0.012, 24), SPLASH, b.x, y, b.z, { opacity: 0.55, gloss: 0.8, outline: false, shadow: false });
    m.rotation.y = this.rand() * Math.PI;
    m.scale.setScalar(0.001);
    this.splashes.push({ m, age: 0, sx: 0.8 + this.rand() * 0.5 });
    while (this.splashes.length > SPLASHES_MAX) this.splashes.shift()?.m.removeFromParent();
  }

  refilled(team: number): void {
    const tr = this.towels[team];
    if (tr) tr.drop = 1;
  }

  /** A word over a spot. */
  say(x: number, z: number, text: string, color: string, size = 0.45): void {
    this.floaters.add(text, color, new THREE.Vector3(x, 1.9, z), size, 1.2);
  }

  /** Lets whatever is still in the air pop where it is (time's up). */
  popAll(): void {
    for (const id of [...this.flying.keys()]) this.forget(id)?.mesh.removeFromParent();
  }

  dispose(): void {
    for (const r of this.rigs) {
      if (!r) continue;
      r.c.dispose();
      r.card.material.map?.dispose();
      r.card.material.dispose();
    }
    for (const c of this.cards) {
      c.material.map?.dispose();
      c.material.dispose();
    }
    this.floaters.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks);
    for (const r of this.rigs) r?.c.update(dt);
    this.tick(dt, this.time);
    this.ripples = this.ripples.filter((r) => {
      r.age += dt;
      const k = Math.max(0, r.age) / 0.9;
      r.m.visible = r.age >= 0;
      r.m.scale.setScalar(1 + k * 3.2);
      (r.m.material as THREE.Material).opacity = 0.8 * (1 - k);
      if (k < 1) return true;
      r.m.removeFromParent();
      (r.m.material as THREE.Material).dispose();
      return false;
    });
    for (const f of this.floats) {
      f.g.position.set(f.x + Math.sin(this.time * 0.3 + f.phase) * 0.3, 0.03 + Math.sin(this.time * 1.4 + f.phase) * 0.03, f.z);
      f.g.rotation.y += dt * 0.08;
    }
    this.drops = this.drops.filter((d) => {
      d.age += dt;
      d.v.y -= 12 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.age < 0.7 && d.m.position.y > -0.1) return true;
      d.m.removeFromParent();
      return false;
    });
    this.splashes = this.splashes.filter((s) => {
      s.age += dt;
      const k = Math.min(1, s.age / 0.25);
      const fade = Math.max(0, 1 - Math.max(0, s.age - 4) / 2);
      const r = (0.6 + 0.6 * k) * fade + 0.001;
      s.m.scale.set(r * s.sx, 1, r);
      if (fade > 0) return true;
      s.m.removeFromParent();
      return false;
    });
    this.floaters.update(dt);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'toweltoss',
  title: 'Towel Toss',
  how: 'You and your partner hold a beach towel between you. Press Launch at the same moment to fling a water balloon over the fence (the closer together, the further it flies), and catch theirs on your towel. Every balloon that bursts on their side scores!',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const skill = seats.map((_, p) => (cpu(p) ? ctx.skill() : 0.5));
    const deck = newDeck(teams, seats.length);
    const playing = (p: number) => (deck.teamOf[p] ?? -1) >= 0;
    // Have the set's textures in before it first shows (but never wait long for them).
    const warm = Promise.race([preloadTextures('stoneTiles', 'patio', 'grass', 'terry', 'fabric', 'planks'), new Promise<void>((done) => setTimeout(done, 2000))]);
    const companions = await Promise.all(seats.map((s, p) => (playing(p) ? buildCompanion(s.look, { height: HEIGHT }) : Promise.resolve(undefined))));
    await warm;
    const view = new PoolDeck(seats, teams, companions);
    ctx.stage.setView(view);

    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'someone';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const partnerOf = (p: number) => teams[deck.teamOf[p] ?? -1]?.find((q) => q !== p);
    const partnerIsCpu = seats.map((_, p) => {
      const q = partnerOf(p);
      return q === undefined || cpu(q);
    });

    seats.forEach((s, p) => {
      if (!playing(p)) return;
      const partner = partnerOf(p);
      session.setLayout(s.index, {
        kind: 'stick',
        button: 'Launch',
        note: partner === undefined ? 'Hold your towel, catch their balloons and press Launch to fling one back!' : `You and ${nameOf(partner)} hold a towel. Press Launch together, and catch theirs!`,
      });
    });

    const sticks: Stick[] = seats.map(() => ({ ...IDLE }));
    /** A press that came and went within one frame still counts, timed when it arrived. */
    const tapped = seats.map(() => false);
    const cpus: CpuHolder[] = seats.map(() => newCpuHolder());
    const nagAt = seats.map(() => -Infinity);
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'stick' || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p === undefined || !playing(p)) return;
      sticks[p] = { x: msg.x, y: msg.y, a: msg.a };
      if (msg.a) tapped[p] = true;
    });
    const nag = (p: number, text: string) => {
      if (deck.time - (nagAt[p] ?? -Infinity) < 2.5) return;
      nagAt[p] = deck.time;
      tell(p, false, text);
    };

    const show = (ev: DeckEvents) => {
      for (const { team, balloon, power, gap } of ev.launched) {
        view.launched(balloon, team);
        boing(sfx, power);
        const members = teams[team] ?? [];
        for (const p of members) {
          view.rigs[p]?.c.react('happy', 0.6);
          if (!cpu(p)) tell(p, true, Math.abs(gap) < 0.06 ? 'Perfect timing! Full power.' : power > 0.5 ? 'Whoosh!' : 'A bit out of step: a short one.');
          session.send(seatOf(p), { t: 'buzz', pattern: [20] });
        }
      }
      for (const { team, balloon } of ev.caught) {
        view.caught(balloon, team);
        plap(sfx);
        const at = towelEnds(deck, team);
        if (at) view.say((at.ax + at.bx) / 2, (at.az + at.bz) / 2, 'Caught!', view.towels[team]?.color ?? '#fff');
        for (const p of teams[team] ?? []) {
          view.rigs[p]?.c.react('approval', 0.8);
          session.send(seatOf(p), { t: 'buzz', pattern: [15] });
        }
      }
      for (const { balloon: b, result } of ev.burst) {
        view.burst(b, result === 'pool');
        sploosh(sfx, result === 'score');
        if (result === 'score') {
          view.say(b.x, b.z, 'Splash!', view.towels[b.team]?.color ?? '#fff', 0.55);
          for (const p of teams[1 - b.team] ?? []) {
            view.rigs[p]?.c.react('sad', 0.9);
            session.send(seatOf(p), { t: 'buzz', pattern: [60] });
          }
        } else view.say(b.x, Math.max(-TOWEL.half.z, b.z), result === 'pool' ? 'Plop!' : result === 'short' ? 'Short!' : 'Wide!', '#e6e1ef', 0.4);
      }
      if (ev.refilled.length) plip(sfx);
      for (const team of ev.refilled) view.refilled(team);
      for (const p of ev.fumbled) {
        if (cpu(p)) continue;
        const partner = partnerOf(p);
        nag(p, partner === undefined ? 'Press again!' : `Press at the same moment as ${nameOf(partner)}!`);
      }
      for (const p of ev.empty) if (!cpu(p)) nag(p, 'No balloon on your towel yet. One’s on its way!');
    };

    ui.caption('Press Launch together to fling. Catch theirs on your towel!');
    let hudAt = -1;
    await everyFrame(clock, (dt) => {
      const inputs = seats.map((_, p): Stick => {
        if (!playing(p)) return IDLE;
        if (cpu(p)) return cpuStick(cpus[p] as CpuHolder, deck, p, dt, skill[p] ?? 0.5, rng, partnerIsCpu[p] ?? true);
        const s = sticks[p] ?? IDLE;
        const a = s.a || (tapped[p] ?? false);
        tapped[p] = false;
        const lag = Math.min(TOWEL.lagGrace, (session.seats[seatOf(p)]?.rtt ?? 0) / 2000) * clock.speed;
        return { x: s.x, y: s.y, a, lag };
      });
      show(stepDeck(deck, inputs, dt));
      view.sync(deck, dt);
      view.fly(deck);
      if (deck.time - hudAt >= 0.1) {
        hudAt = deck.time;
        ui.timer(TOWEL.duration - deck.time);
        ui.live(
          teams.map((members, team) => {
            const lead = seats[members[0] ?? 0];
            const n = deck.sides[team]?.score ?? 0;
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} splash${n === 1 ? '' : 'es'}` };
          }),
        );
      }
      return isOver(deck);
    });
    off();
    ui.timer(null);
    ui.caption(null);

    // Time! Whatever's still in the air pops harmlessly, and the drier side cheers.
    view.popAll();
    deck.balloons = [];
    const score = [deck.sides[0]?.score ?? 0, deck.sides[1]?.score ?? 0];
    const best = Math.max(...teams.map((_, t) => score[t] ?? 0));
    const tie = teams.length > 1 && score[0] === score[1];
    sfx.good();
    teams.forEach((members, team) => {
      const won = (score[team] ?? 0) === best;
      for (const p of members) {
        const r = view.rigs[p];
        r?.c.move(null);
        r?.c.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) r?.c.react('happy', 3);
        tell(p, won, tie ? 'Time! Exactly as many splashes each.' : won ? 'Time! Your side made the most splashes!' : 'Time! They made more splashes.');
      }
      const e = towelEnds(deck, team);
      if (won && !tie && e) view.say((e.ax + e.bx) / 2, (e.az + e.bz) / 2, 'Make a splash!', '#fff6a8', 0.6);
    });
    await clock.wait(1.6);

    return {
      scores: towelScores(deck, teams, seats.length),
      details: seats.map((_, p) => {
        const team = deck.teamOf[p] ?? -1;
        const side = deck.sides[team];
        if (team < 0 || !side) return '';
        return `${side.score} splash${side.score === 1 ? '' : 'es'} · ${side.catches} caught`;
      }),
    };
  },
};
