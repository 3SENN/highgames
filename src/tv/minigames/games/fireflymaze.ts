// Firefly Maze on the TV: a hedge maze at night, seen from above at an angle. Each player carries a lantern (a soft
// warm circle in the dark blue); fireflies blink over the hedges and trail after whoever walks close. In the middle
// stands a big glass jar: reach it to let your fireflies in and you're out.
import * as THREE from 'three';
import {
  CENTRE,
  type Garden,
  MAZE,
  type Seeker,
  type Stick,
  cellCentre,
  cpuMaze,
  flyPos,
  gardenOver,
  mazeScores,
  newGarden,
  newSeeker,
  stepGarden,
} from '../../../game/minigames/fireflymaze';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, canvasTexture, cone, cyl, material, mix, part, plane, rbox, seeded, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.1;
const HEDGE_H = 0.5;
const STEP = 1 / 120;
const FLY_Y = 0.85;
const SPACING = 0.3;
/** Where people who got out stand round the jar. */
const JAR_SLOTS = [
  [-0.5, 0.45],
  [0.5, 0.45],
  [-0.5, -0.4],
  [0.5, -0.4],
] as const;

// ------------------------------------------------------------------ sounds

const chime = (sfx: Sfx) => tone(sfx, { freq: 1250 + Math.random() * 200, to: 1700, dur: 0.12, gain: 0.05 });
const bonk = (sfx: Sfx) => {
  tone(sfx, { freq: 300, to: 190, dur: 0.12, type: 'triangle', gain: 0.1 });
  noise(sfx, { dur: 0.08, filter: 'lowpass', freq: 500, gain: 0.25 });
};
const jarSong = (sfx: Sfx, first: boolean) => [784, 988, 1175, first ? 1568 : 1319].forEach((f, k) => tone(sfx, { freq: f, dur: 0.3, gain: 0.06, delay: k * 0.08 }));
const cricket = (sfx: Sfx) => {
  const f = 4000 + Math.random() * 600;
  for (let k = 0; k < 3; k++) tone(sfx, { freq: f, dur: 0.025, gain: 0.012, delay: k * 0.06 });
};

// ------------------------------------------------------------------ the view

function radial(inner: string, outer: string): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

interface WalkerRig {
  c: Companion;
  ring: THREE.Mesh;
  glow: THREE.Mesh;
  lantern: THREE.Group;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
  out: boolean;
}

interface FlyRig {
  core: THREE.Mesh;
  halo: THREE.Sprite;
  pos: THREE.Vector3;
  phase: number;
  /** Where it settled in the jar, once banked. */
  jar: THREE.Vector3 | null;
  shown: number;
}

class Hedgerows implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly walkers: WalkerRig[] = [];
  readonly flies: FlyRig[] = [];
  readonly words: Floaters;
  private readonly fit = new CameraFit(this.camera, 0.95);
  private readonly marks: Mark[] = [];
  private readonly glowTex = radial('rgba(255,214,150,0.85)', 'rgba(255,214,150,0)');
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly haloTex = radial('rgba(226,255,140,1)', 'rgba(226,255,140,0)');
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private readonly jarGlow: THREE.Sprite;
  private readonly jarRing: THREE.Mesh;
  private jarPulse = 0;
  private banked = 0;
  private time = 0;
  private cricketIn = 1;

  constructor(
    g: Garden,
    seats: MinigameSeat[],
    companions: Companion[],
    private readonly sfx: Sfx,
  ) {
    // A walled garden on a moonless-ish night. The lanterns do the lighting, so the moon is turned well down.
    this.env = backyard(this.scene, { mood: 'night', w: 36, d: 19.5, clear: { w: 15, d: 15 }, lights: false, seed: 4 });
    this.env.sun.intensity *= 0.5;
    const cam = this.env.sun.shadow.camera;
    cam.left = cam.bottom = -10;
    cam.right = cam.top = 10;
    cam.updateProjectionMatrix();
    this.scene.traverse((o) => {
      if ((o as THREE.AmbientLight).isAmbientLight) (o as THREE.AmbientLight).intensity = 0.05;
      if ((o as THREE.HemisphereLight).isHemisphereLight) (o as THREE.HemisphereLight).intensity *= 0.62;
    });
    this.glowMat = new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.5 });
    this.words = new Floaters(this.scene);
    this.jarRing = this.buildMaze(g);
    this.tick = this.dress();
    const { x: jx, z: jz } = cellCentre(CENTRE);
    this.jarGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.jarGlow.position.set(jx, 0.5, jz);
    this.jarGlow.renderOrder = 3;
    this.scene.add(this.jarGlow);

    seats.forEach((s, i) => {
      const c = companions[i] as Companion;
      const w = g.walkers[i];
      c.root.position.set(w?.x ?? 0, 0, w?.z ?? 0);
      c.setBase('listening');
      this.scene.add(c.root);
      const lantern = new THREE.Group();
      lantern.position.set(0.3, 0.42, 0.12);
      withOutline(0.02, () => {
        part(lantern, cyl(0.07, 0.08, 0.04, 10), P.charcoal, 0, -0.1, 0, { gloss: 0.5 });
        part(lantern, cyl(0.055, 0.055, 0.16, 10), P.lamp, 0, 0.0, 0, { glow: 2 });
        for (let k = 0; k < 4; k++) part(lantern, cyl(0.006, 0.006, 0.17, 4), P.charcoal, Math.cos(k * 1.57) * 0.062, 0, Math.sin(k * 1.57) * 0.062, { outline: false });
        part(lantern, cone(0.09, 0.08, 10), P.charcoal, 0, 0.12, 0, { gloss: 0.5 });
        part(lantern, torus(0.04, 0.01), P.brass, 0, 0.19, 0, { outline: false, gloss: 0.6 });
      });
      const light = new THREE.PointLight(P.lamp, 3.0, 4.2, 1.3);
      light.castShadow = false;
      lantern.add(light);
      c.root.add(lantern);
      const glow = new THREE.Mesh(plane(4.2, 4.2), this.glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.renderOrder = 2;
      this.scene.add(glow);
      const ring = part(this.scene, torus(0.34, 0.04), s.color, 0, 0.04, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      this.walkers.push({ c, ring, glow, lantern, motion: null, mood: null, out: false });
    });

    const rand = seeded(41);
    g.flies.forEach(() => {
      const core = part(this.scene, ball(0.045, 1), '#f2ffb0', 0, 0, 0, { basic: true, shadow: false });
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      halo.scale.setScalar(0.5);
      halo.renderOrder = 3;
      this.scene.add(halo);
      core.visible = halo.visible = false;
      this.flies.push({ core, halo, pos: new THREE.Vector3(), phase: rand() * Math.PI * 2, jar: null, shown: 0 });
    });

    const half = (MAZE.size / 2) * MAZE.cell + MAZE.wall;
    for (const x of [-half, half]) {
      for (const z of [-half, half]) this.marks.push({ p: new THREE.Vector3(x, 0, z) }, { p: new THREE.Vector3(x, HEDGE_H, z), pad: 0.02 });
    }
    // Heads in the back corners stay on screen too.
    const corner = ((MAZE.size - 1) / 2) * MAZE.cell;
    for (const x of [-corner, corner]) this.marks.push({ p: new THREE.Vector3(x, HEIGHT, -corner), pad: 0.02 });
  }

  private buildMaze(g: Garden): THREE.Mesh {
    const s = this.scene;
    const half = (MAZE.size / 2) * MAZE.cell;
    const rand = seeded(7);
    // Gravel paths under the hedges, with a stone kerb all the way round.
    part(s, box(half * 2 + 0.5, 0.06, half * 2 + 0.5), mix(P.stone, P.aubergine, 0.3), 0, 0.0, 0, { tex: 'cobble', texScale: 2.2, outline: false, shadow: false });
    for (const k of [-1, 1]) {
      part(s, box(half * 2 + 0.9, 0.1, 0.22), P.stone, 0, 0.02, k * (half + 0.36), { tex: 'stoneTiles', outline: false });
      part(s, box(0.22, 0.1, half * 2 + 0.9), P.stone, k * (half + 0.36), 0.02, 0, { tex: 'stoneTiles', outline: false });
    }
    // The hedges: clipped boxes, with leafy clumps along their tops and a few pale flowers (instanced).
    const dark = mix(P.pine, P.leafDark, 0.55);
    withOutline(0.025, () => {
      for (const h of g.hedges) part(s, rbox(h.hx * 2, HEDGE_H, h.hz * 2, 0.1), dark, h.x, HEDGE_H / 2, h.z, { tex: 'grass', texScale: 1.1 });
    });
    const spots: { x: number; y: number; z: number; r: number }[] = [];
    for (const h of g.hedges) {
      const along = h.hx >= h.hz;
      const len = (along ? h.hx : h.hz) * 2;
      const wide = (along ? h.hz : h.hx) * 2;
      const n = Math.max(1, Math.round(len / 0.34));
      for (let k = 0; k < n; k++) {
        const t = ((k + 0.5) / n - 0.5) * (len - 0.1) + (rand() - 0.5) * 0.1;
        const side = (rand() - 0.5) * wide * 0.7;
        spots.push({ x: h.x + (along ? t : side), y: HEDGE_H - 0.03 + rand() * 0.05, z: h.z + (along ? side : t), r: 0.75 + rand() * 0.6 });
      }
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const clumps = new THREE.InstancedMesh(ball(0.13, 1), material('#ffffff', { exact: true, outline: false }), spots.length);
    spots.forEach((c, i) => {
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, 0));
      m4.compose(new THREE.Vector3(c.x, c.y, c.z), q, new THREE.Vector3(c.r, c.r * 0.6, c.r));
      clumps.setMatrixAt(i, m4);
      clumps.setColorAt(i, col.set(mix(dark, rand() < 0.5 ? P.fern : P.moss, 0.15 + rand() * 0.4)));
    });
    clumps.receiveShadow = true;
    s.add(clumps);
    const blooms = spots.filter(() => rand() < 0.12);
    const petals = new THREE.InstancedMesh(sphere(0.035, 8), material('#ffffff', { exact: true, outline: false }), blooms.length);
    blooms.forEach((c, i) => {
      m4.compose(new THREE.Vector3(c.x + (rand() - 0.5) * 0.1, c.y + 0.07, c.z + (rand() - 0.5) * 0.1), q.identity(), new THREE.Vector3(1, 0.7, 1));
      petals.setMatrixAt(i, m4);
      petals.setColorAt(i, col.set(rand() < 0.5 ? P.cream : P.rose));
    });
    s.add(petals);
    // Tufts of grass coming up through the gravel, and pale pebbles, so the lantern light has something to catch.
    const bits = Array.from({ length: 90 }, () => ({ x: (rand() * 2 - 1) * (half - 0.3), z: (rand() * 2 - 1) * (half - 0.3) }));
    const tufts = new THREE.InstancedMesh(cone(0.05, 0.16, 5), material('#ffffff', { exact: true, outline: false }), 60);
    const stones = new THREE.InstancedMesh(ball(0.06, 0), material('#ffffff', { exact: true, outline: false }), 30);
    bits.forEach((c, i) => {
      if (i < 60) {
        m4.compose(new THREE.Vector3(c.x, 0.1, c.z), q.identity(), new THREE.Vector3(1, 0.7 + rand() * 0.6, 1));
        tufts.setMatrixAt(i, m4);
        tufts.setColorAt(i, col.set(mix(P.grassDark, P.moss, rand())));
      } else {
        m4.compose(new THREE.Vector3(c.x, 0.04, c.z), q.identity(), new THREE.Vector3(1 + rand(), 0.5, 1 + rand()));
        stones.setMatrixAt(i - 60, m4);
        stones.setColorAt(i - 60, col.set(mix(P.stone, P.cream, rand() * 0.5)));
      }
    });
    stones.receiveShadow = true;
    s.add(tufts, stones);

    // The middle: a round of flagstones and the big glass jar, with a warm light so it's easy to find.
    const { x: cx, z: cz } = cellCentre(CENTRE);
    part(s, cyl(0.74, 0.76, 0.06, 28), P.stone, cx, 0.035, cz, { tex: 'stoneTiles', texScale: 0.9, outline: false });
    const ring = part(s, torus(0.72, 0.03), P.lamp, cx, 0.07, cz, { rx: Math.PI / 2, glow: 1.6, outline: false, shadow: false });
    part(s, cyl(0.28, 0.3, 0.08, 18), P.walnut, cx, 0.1, cz, { tex: 'wood' });
    part(s, cyl(0.26, 0.26, 0.62, 24), P.screen, cx, 0.45, cz, { opacity: 0.22, gloss: 0.9, outline: false });
    part(s, torus(0.262, 0.012), P.ceramic, cx, 0.3, cz, { rx: Math.PI / 2, outline: false, opacity: 0.5 });
    part(s, torus(0.26, 0.025), P.ceramic, cx, 0.75, cz, { rx: Math.PI / 2, outline: false, gloss: 0.8 });
    part(s, cyl(0.2, 0.22, 0.09, 18), P.oak, cx, 0.8, cz, { tex: 'wood' });
    part(s, sphere(0.045, 10), P.brass, cx, 0.87, cz, { outline: false, gloss: 0.7 });
    const beacon = new THREE.PointLight(P.lamp, 2.4, 3.6, 1.3);
    beacon.position.set(cx, 1.2, cz);
    beacon.castShadow = false;
    s.add(beacon);
    return ring;
  }

  /** The garden round the maze: trees, beds, a still pool, lanterns that only glow. */
  private dress(): (dt: number, time: number) => void {
    const set = new THREE.Group();
    this.scene.add(set);
    const half = (MAZE.size / 2) * MAZE.cell;
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, scale = 1, y = 0) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    // To the left (the wide side of the picture): a pool with a stone edge, a tree, a bench, flower beds.
    const px = -half - 5.2;
    const pz = 3.4;
    part(set, box(4.6, 0.16, 3.6), P.stone, px, 0.02, pz, { tex: 'stoneTiles', outline: false });
    part(set, box(4.0, 0.2, 3.0), mix(P.denim, P.midnight, 0.7), px, 0.035, pz, { outline: false, shadow: false, rim: 0 });
    // the moon and a couple of stars, mirrored in the still water
    part(set, cyl(0.2, 0.2, 0.004, 20), P.moon, px + 0.7, 0.138, pz - 0.5, { glow: 1.2, outline: false, shadow: false });
    for (const [dx, dz] of [
      [-0.9, -0.9],
      [0.1, 0.8],
      [1.5, 0.4],
    ] as const) {
      part(set, cyl(0.03, 0.03, 0.004, 8), P.moon, px + dx, 0.138, pz + dz, { glow: 1.5, outline: false, shadow: false });
    }
    for (const [dx, dz, r] of [
      [-1.4, 0.9, 0.3],
      [-0.9, 0.5, 0.22],
      [1.2, -0.8, 0.26],
    ] as const) {
      part(set, cyl(r, r, 0.012, 14), P.fern, px + dx, 0.145, pz + dz, { outline: false, shadow: false });
    }
    part(set, sphere(0.07, 8), P.rose, px - 1.35, 0.18, pz + 0.95, { outline: false });
    put(props.rock({ r: 0.4, seed: 3 }), px + 2.5, pz + 1.9);
    put(props.rock({ r: 0.26, seed: 5 }), px + 2.9, pz + 1.4);
    put(props.gardenLamp({ h: 0.8 }), px + 2.6, pz - 1.9);
    put(props.gardenLamp({ h: 0.8 }), px - 2.6, pz - 1.9);
    put(props.tree({ kind: 'round', h: 3.8, seed: 3 }), px - 0.6, -5.0);
    put(props.tree({ kind: 'birch', h: 4.4, seed: 6 }), px - 4.4, -1.2);
    put(props.logSeat({ len: 1.5 }), px + 1.6, -2.2, 1.2);
    put(props.bush({ r: 0.7, flowers: P.rose, seed: 2 }), px + 2.7, -5.6);
    put(props.bush({ r: 0.55, flowers: P.cream, seed: 7 }), px - 3.2, 1.2);
    put(props.bush({ r: 0.8, seed: 9 }), px - 3.6, 6.4);
    put(props.plant({ kind: 'fern', h: 0.8, pot: P.terracotta }), px + 2.9, 5.6, 0, 1.3);
    // Stepping stones from the bench to the maze.
    for (let k = 0; k < 5; k++) part(set, cyl(0.3, 0.32, 0.05, 9), mix(P.stone, P.aubergine, 0.15), -half - 0.9 - k * 0.75, 0.02, -1.0 - Math.sin(k * 0.9) * 0.35, { ry: k, tex: 'stoneTiles', outline: false, shadow: false });
    // Above, below and to the right of the maze: hedges and beds just outside the kerb.
    put(props.hedge({ w: 6, h: 0.9, seed: 3 }), -3.4, -half - 1.5);
    put(props.hedge({ w: 4.5, h: 1.1, seed: 5 }), 4.2, -half - 1.6);
    put(props.gardenLamp({ h: 1.2 }), 0.6, -half - 1.2);
    put(props.bush({ r: 0.7, flowers: P.mustard, seed: 4 }), half + 1.6, -4.2);
    put(props.bush({ r: 0.6, seed: 12 }), half + 1.5, 1.4);
    put(props.gardenLamp({ h: 0.9 }), half + 1.1, -1.4);
    put(props.tree({ kind: 'pine', h: 3.6, seed: 2 }), half + 3.2, 4.4);
    put(props.bush({ r: 0.75, flowers: P.rose, seed: 6 }), -4.6, half + 1.5);
    put(props.plant({ kind: 'monstera', h: 1.0, pot: P.ceramic, seed: 3 }), 3.8, half + 1.4, 0, 1.3);
    put(props.rock({ r: 0.35, seed: 8 }), 0.4, half + 1.3);
    return props.tickProps(set);
  }

  /** Fireflies went into the jar: it brightens, and its ring pulses once. */
  bank(count: number): void {
    this.banked = count;
    this.jarPulse = 1;
  }

  head(seat: number): THREE.Vector3 {
    const p = this.walkers[seat]?.c.root.position.clone() ?? new THREE.Vector3();
    p.y = HEIGHT + 0.45;
    return p;
  }

  private setMood(w: WalkerRig, mood: CompanionMood): void {
    if (mood === w.mood) return;
    w.mood = mood;
    w.c.setBase(mood);
  }

  /** Puts everyone (and every firefly) where the garden says. */
  sync(g: Garden, dt: number): void {
    const follow = 1 - Math.exp(-dt * 16);
    g.walkers.forEach((w, i) => {
      const rig = this.walkers[i];
      if (!rig) return;
      const root = rig.c.root;
      if (w.exitedAt !== null) {
        if (!rig.out) {
          rig.out = true;
          rig.ring.visible = false;
          const k = g.order.indexOf(i);
          const [sx, sz] = JAR_SLOTS[k % JAR_SLOTS.length] as readonly [number, number];
          root.position.set(sx, 0, sz);
          root.rotation.set(0, 0, 0);
          root.scale.setScalar(0.85);
          rig.c.move(null);
          rig.motion = null;
          this.setMood(rig, 'happy');
        }
        rig.glow.position.set(root.position.x, 0.03, root.position.z);
        return;
      }
      root.position.x += (w.x - root.position.x) * follow;
      root.position.z += (w.z - root.position.z) * follow;
      const speed = Math.hypot(w.vx, w.vz);
      const target = speed > 0.3 ? w.face : root.rotation.y;
      root.rotation.y += Math.atan2(Math.sin(target - root.rotation.y), Math.cos(target - root.rotation.y)) * Math.min(1, dt * 10);
      const motion = speed < 0.3 ? null : speed > 2.4 ? 'run' : 'walk';
      if (motion !== rig.motion) {
        rig.motion = motion;
        rig.c.move(motion, speed);
      }
      this.setMood(rig, w.trail.length > 0 ? 'happy' : 'listening');
      rig.ring.position.set(root.position.x, 0.03, root.position.z);
      rig.glow.position.set(root.position.x, 0.03, root.position.z);
    });

    // Fireflies: hovering free, trailing their walker in a little line, or settled in the jar.
    const t = g.time;
    const lead = new THREE.Vector3();
    const { x: jx, z: jz } = cellCentre(CENTRE);
    g.walkers.forEach((w, i) => {
      const root = this.walkers[i]?.c.root;
      if (!root) return;
      lead.set(root.position.x - Math.sin(root.rotation.y) * 0.25, FLY_Y + 0.15, root.position.z - Math.cos(root.rotation.y) * 0.25);
      let prev = lead.clone();
      w.trail.forEach((fi, k) => {
        const f = this.flies[fi];
        if (!f) return;
        const d = f.pos.distanceTo(prev);
        const gap = k === 0 ? 0.05 : SPACING;
        if (d > gap) f.pos.lerp(prev, (1 - gap / d) * Math.min(1, dt * 7));
        f.pos.y += (prev.y + Math.sin(t * 3 + f.phase) * 0.05 - f.pos.y) * Math.min(1, dt * 4);
        prev = f.pos.clone();
      });
    });
    g.flies.forEach((f, fi) => {
      const rig = this.flies[fi];
      if (!rig) return;
      const born = f.at <= t;
      if (!born) return;
      if (rig.shown === 0) {
        const p = flyPos(f, t);
        rig.pos.set(p.x, FLY_Y, p.z);
      }
      rig.shown = Math.min(1, rig.shown + dt * 1.5);
      if (f.banked) {
        if (!rig.jar) rig.jar = new THREE.Vector3(jx + (Math.random() - 0.5) * 0.28, 0.25 + Math.random() * 0.4, jz + (Math.random() - 0.5) * 0.28);
        const home = rig.jar.clone();
        home.y += Math.sin(t * 2 + rig.phase) * 0.04;
        rig.pos.lerp(home, Math.min(1, dt * 3));
      } else if (f.owner === null) {
        const p = flyPos(f, t);
        rig.pos.lerp(new THREE.Vector3(p.x, FLY_Y + Math.sin(t * 1.6 + rig.phase) * 0.12, p.z), Math.min(1, dt * 5));
      }
    });
  }

  dispose(): void {
    for (const w of this.walkers) w.c.dispose();
    for (const f of this.flies) f.halo.material.dispose();
    this.jarGlow.material.dispose();
    this.glowMat.dispose();
    this.glowTex.dispose();
    this.haloTex.dispose();
    this.words.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks);
    this.words.update(dt);
    this.env.update(dt, this.time);
    this.tick(dt, this.time);
    // The jar glows with what is inside it, and breathes.
    this.jarPulse = Math.max(0, this.jarPulse - dt * 1.8);
    const fill = Math.min(1, this.banked / 8);
    this.jarGlow.material.opacity = Math.min(0.6, fill * 0.45 + this.jarPulse * 0.4) * (0.85 + 0.15 * Math.sin(this.time * 2.3));
    this.jarGlow.scale.setScalar(0.7 + fill * 0.5 + this.jarPulse * 0.5);
    this.jarRing.scale.setScalar(1 + this.jarPulse * 0.18);
    for (const w of this.walkers) {
      w.c.update(dt);
      w.lantern.rotation.z = Math.sin(this.time * 6) * 0.12 * (w.motion ? 1 : 0.3);
    }
    for (const f of this.flies) {
      const visible = f.shown > 0;
      f.core.visible = f.halo.visible = visible;
      if (!visible) continue;
      // A slow glow, then a brighter blink now and then.
      const pulse = Math.max(0, Math.sin(this.time * 2.1 + f.phase));
      const b = (0.35 + 0.65 * pulse ** 3) * f.shown;
      f.core.position.copy(f.pos);
      f.halo.position.copy(f.pos);
      f.core.scale.setScalar(0.6 + 0.6 * b);
      f.halo.material.opacity = 0.15 + 0.85 * b;
      f.halo.scale.setScalar(0.35 + 0.3 * b);
    }
    this.cricketIn -= dt;
    if (this.cricketIn <= 0) {
      this.cricketIn = 0.8 + Math.random() * 1.6;
      cricket(this.sfx);
    }
  }
}

const pts = (n: number) => (n % 1 === 0 ? `${n}` : n.toFixed(1));

export const minigame: Minigame = {
  id: 'fireflymaze',
  title: 'Firefly Maze',
  how: 'Walk near fireflies and they follow you. Take them to the jar in the middle (+3 for first out). Bump into someone and one of yours flies over to them; any still following at the end count half.',
  controller: 'stick',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const pos = new Map(seats.map((s, i) => [s.index, i] as const));
    const g = newGarden(rng, seats.length);
    const view = new Hedgerows(g, seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), sfx);
    ctx.stage.setView(view);
    const brains: Seeker[] = seats.map(() => newSeeker(rng, ctx.skill()));
    const sticks: Stick[] = seats.map(() => ({ x: 0, y: 0 }));
    const cpu = (i: number) => session.isCpu(seats[i]?.index ?? i);
    const send = (i: number, msg: Parameters<typeof session.send>[1]) => session.send(seats[i]?.index ?? i, msg);
    const off = session.onInput((seat, msg) => {
      const i = pos.get(seat);
      if (i === undefined || msg.t !== 'stick' || cpu(i)) return;
      sticks[i] = { x: msg.x, y: msg.y };
    });
    session.setLayoutAll(() => ({ kind: 'stick', button: null, note: 'Walk close to fireflies and they follow you. Take them to the jar in the middle!' }));
    ui.caption('Gather fireflies, then find the jar in the middle!');
    const value = (i: number) => {
      const w = g.walkers[i];
      if (!w) return '';
      if (w.exitedAt !== null) return `${w.banked} in the jar${w.first ? ' · first' : ''}`;
      return `${w.trail.length} following`;
    };
    let hudAt = -1;

    await everyFrame(clock, (dt) => {
      const steps = Math.max(1, Math.ceil(dt / STEP));
      for (let k = 0; k < steps && !gardenOver(g); k++) {
        const input = seats.map((_, i) => (cpu(i) ? cpuMaze(g, i, brains[i] as Seeker, rng, dt / steps) : (sticks[i] ?? { x: 0, y: 0 })));
        const ev = stepGarden(g, input, dt / steps);
        for (const c of ev.caught) {
          chime(sfx);
          view.words.add('+1', seats[c.seat]?.color ?? '#ffffff', view.head(c.seat), 0.3, 0.8);
          send(c.seat, { t: 'buzz', pattern: [12] });
        }
        for (const b of ev.bumps) {
          bonk(sfx);
          if (b.fly === null) continue;
          view.words.add('+1', seats[b.to]?.color ?? '#ffffff', view.head(b.to), 0.3, 0.9);
          send(b.from, { t: 'feedback', good: false, text: `Bump! A firefly flew over to ${seats[b.to]?.name ?? 'them'}.` });
          send(b.to, { t: 'feedback', good: true, text: `${seats[b.from]?.name ?? 'Someone'} bumped into you: a firefly came over!` });
          send(b.from, { t: 'buzz', pattern: [60] });
        }
        for (const e of ev.exited) {
          jarSong(sfx, e.first);
          view.bank(g.flies.filter((f) => f.banked).length);
          const who = seats[e.seat];
          view.words.add(e.first ? `First out! +${MAZE.firstBonus}` : `${e.banked} in the jar`, who?.color ?? '#ffffff', new THREE.Vector3(0, 1.6, 0), 0.4, 1.4);
          ui.caption(`${who?.name ?? 'Someone'} is out with ${e.banked} firefl${e.banked === 1 ? 'y' : 'ies'}${e.first ? ` (+${MAZE.firstBonus} for first out)` : ''}!`, who?.color);
          session.setLayout(who?.index ?? e.seat, { kind: 'wait', title: 'You’re out!', text: `${e.banked} firefl${e.banked === 1 ? 'y' : 'ies'} in the jar${e.first ? `, and +${MAZE.firstBonus} for being first` : ''}.` });
          send(e.seat, { t: 'buzz', pattern: [30, 40, 90] });
        }
      }
      view.sync(g, dt);
      if (g.time - hudAt > 0.2) {
        hudAt = g.time;
        ui.timer(MAZE.duration - g.time);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: value(i) })));
      }
      return gardenOver(g);
    });
    off();
    ui.timer(null);

    const stillIn = g.walkers.some((w) => w.exitedAt === null);
    if (stillIn) {
      sfx.whoosh();
      ui.caption('Time! Fireflies still following you count half.');
      session.setLayoutAll(() => ({ kind: 'wait', title: 'Time!', text: 'Fireflies still following you count half.' }));
    }
    for (const w of view.walkers) {
      w.c.move(null);
      w.motion = null;
    }
    const scores = mazeScores(g);
    const best = Math.max(...scores);
    scores.forEach((s, i) => view.walkers[i]?.c.setBase(s === best ? 'happy' : g.walkers[i]?.exitedAt === null ? 'sad' : 'idle'));
    ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${pts(scores[i] ?? 0)} pts` })));
    await clock.wait(stillIn ? 2 : 1.4);
    ui.caption(null);

    return {
      scores,
      details: g.walkers.map((w) => {
        const parts: string[] = [];
        if (w.exitedAt !== null) parts.push(`${w.banked} in the jar`);
        if (w.first) parts.push(`first out +${MAZE.firstBonus}`);
        if (w.trail.length) parts.push(`${w.trail.length} still following (${pts(w.trail.length * MAZE.following)})`);
        if (!parts.length) parts.push('No fireflies');
        return parts.join(' · ');
      }),
    };
  },
};
