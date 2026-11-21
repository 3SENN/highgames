// Microwave Popcorn on the TV: a kitchen counter late at night, a microwave for everyone with their companion
// perched beside it and a bowl on the other side. Hold to run the microwave: the bag puffs up, kernels hop about
// behind the glass, and the bowl fills as each bag comes out. Leave it in too long and the bag browns and smokes.
import * as THREE from 'three';
import {
  BAG_SIZES,
  type BagPlan,
  type BagResult,
  type Cook,
  type CpuCook,
  POPCORN,
  burntAt,
  cookDone,
  cookTotal,
  cpuHolding,
  letGo,
  newCook,
  newCpuCook,
  planBags,
  popcornScores,
  poppedAt,
  scorchAt,
  stepCook,
  stopCook,
} from '../../../game/minigames/popcorn';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Layout } from '../../../shared/protocol';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { type Env, kitchen } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ROUNDED_FONT, ball, cyl, dome, mix, nameCard, part, plane, rbox, toonMat, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SPACING = 4.5;
const CT = 1.05; // counter top
const W = 1.9; // microwave
const H = 1.15;
const D = 1.2;
const CAVITY_X = -0.2; // middle of the cavity, from the microwave's middle
const MW_DX = -0.3; // microwave, from the lane's middle
const BOWL_DX = 1.4;
const COMP_DX = -1.85;
const HEIGHT = 1.0; // companion height (they stand on the counter)
const CREAM = P.cream;
const TOAST = '#8f5c33';
// The foundation's kitchen, three times life size: the microwaves stand on its island and the companions are
// little things up on the worktop. The island's top is the counter top.
const ROOM = 3;
const ISLAND_TOP = 0.93;

/** Scales a foundation prop or set, and the reach of the lamps inside it, to this scene's size. */
function sized<T extends THREE.Object3D>(o: T, s: number): T {
  o.scale.multiplyScalar(s);
  o.traverse((c) => {
    const l = c as THREE.PointLight;
    if (!l.isPointLight) return;
    l.distance *= s;
    l.intensity *= s ** l.decay;
  });
  return o;
}
const BAG_SCALE: Record<BagPlan['size'], number> = { small: 0.74, medium: 0.87, large: 1.0 };
const PUFF_PER = 6; // kernels per popcorn puff in the bowl
const MAX_PUFFS = 64;
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ sounds

/** The microwaves' low hum while any of them runs. */
class Hum {
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;

  constructor(private readonly sfx: Sfx) {
    const a = sfx.audio;
    if (!a) return;
    this.osc = a.ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 96;
    const filter = a.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    this.gain = a.ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(filter).connect(this.gain).connect(a.out);
    this.osc.start();
  }

  set(running: number): void {
    const ctx = this.sfx.audio?.ctx;
    if (!ctx || !this.gain) return;
    this.gain.gain.setTargetAtTime(running ? 0.03 + 0.008 * running : 0, ctx.currentTime, 0.08);
  }

  stop(): void {
    try {
      this.osc?.stop();
    } catch {
      // already stopped
    }
    this.gain?.disconnect();
  }
}

function popSound(sfx: Sfx, pops: number): void {
  for (let k = 0; k < Math.min(3, pops); k++) {
    const delay = k * 0.013 + Math.random() * 0.01;
    noise(sfx, { dur: 0.025 + Math.random() * 0.02, filter: 'bandpass', freq: 900 + Math.random() * 1700, gain: 0.26, delay });
    tone(sfx, { freq: 420 + Math.random() * 260, to: 170, dur: 0.045, gain: 0.04, delay });
  }
}

function ding(sfx: Sfx): void {
  tone(sfx, { freq: 1568, dur: 0.55, gain: 0.07 });
  tone(sfx, { freq: 2093, dur: 0.45, gain: 0.04, delay: 0.01 });
}

// ------------------------------------------------------------------ the kitchen

interface Hop {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  age: number;
}

interface Smoke {
  mesh: THREE.Mesh;
  mat: THREE.MeshToonMaterial;
  age: number;
}

interface Drop {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  age: number;
}

interface Lane {
  x: number;
  companion: Companion;
  door: THREE.Group;
  table: THREE.Group;
  bag: THREE.Group;
  puff: THREE.Group;
  bagMat: THREE.MeshToonMaterial;
  glowMat: THREE.MeshToonMaterial;
  display: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; text: string };
  bowl: THREE.Group;
  puffs: number;
  hops: Hop[];
  hop: number;
  smoke: Smoke[];
  smokeNext: number;
  drops: Drop[];
  /** Puffs still to pour into the bowl. */
  pour: { kind: 'pop' | 'burnt'; at: number }[];
  jiggle: number;
  /** 1 as popcorn lands in the bowl, easing to 0: the bowl gives a little bounce. */
  bounce: number;
  /** Seconds into taking a bag out (-1: not), and the bag that goes in after. */
  out: number;
  next: BagPlan | null;
  plan: BagPlan | null;
  /** How browned the bag looks (0..1) and how much it smokes. */
  burn: number;
  running: boolean;
}

class Kitchen implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly lanes: Lane[] = [];
  readonly floaters = new Floaters(this.scene);
  private readonly fit = new CameraFit(this.camera, 0.2);
  private readonly marks: Mark[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private readonly own: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly env: Env;

  constructor(seats: MinigameSeat[], companions: Companion[], first: BagPlan) {
    const n = seats.length;
    const span = (n / 2) * SPACING + 1.2;
    // The kitchen sits a little left of the lanes, as the camera does (the score list covers the left of the
    // screen); its island runs under every lane.
    const roomX = -2;
    const island = Math.max(5, (span * 2 + 2 + Math.abs(roomX) * 2 + 1.5) / ROOM);
    this.env = kitchen(this.scene, { mood: 'evening', w: island + 1.9, d: 5.2, h: 3.5, island, cabinets: P.forest, seed: 2 });
    sized(this.env.root, ROOM);
    for (const l of this.env.lamps) l.intensity *= 0.4;
    // Every other stool goes, so the island front stays calm under the name cards.
    this.env.root.children.filter((c) => c.name === 'stool').forEach((c, k) => k % 2 === 1 && c.removeFromParent());
    this.env.root.position.set(roomX, CT - ISLAND_TOP * ROOM, 0);
    const cam = this.env.sun.shadow.camera;
    cam.left = cam.bottom = -span - 5;
    cam.right = cam.top = span + 5;
    cam.updateProjectionMatrix();
    // A woven runner on the floor in front of the island.
    const runner = props.rug({ w: span * 1.7, d: 3.4, color: P.denim, border: mix(P.denim, P.cream, 0.45), tex: 'knit' });
    runner.position.set(0, CT - ISLAND_TOP * ROOM, 5.2);
    this.scene.add(runner);
    // Late-night things at the quiet ends of the island.
    const on = (o: THREE.Object3D, x: number, z: number, ry = 0) => {
      sized(o, ROOM);
      o.position.set(x, CT, z);
      o.rotation.y = ry;
      this.scene.add(o);
    };
    const left = -span - 0.6;
    on(props.plant({ kind: 'trailing', h: 0.3, pot: P.terracotta }), left - 1.1, -0.2);
    on(props.jar({ color: P.mustard }), left - 2.4, -0.35);
    on(props.jar({ color: P.terracotta, h: 0.2 }), left - 2.9, -0.1);
    on(props.mug({ color: P.teal }), left - 0.2, 0.35, 0.7);
    on(props.drink({ kind: 'can', color: P.rose }), span + 0.55, -0.3);

    seats.forEach((s, i) => {
      const x = (i - (n - 1) / 2) * SPACING;
      const mx = x + MW_DX;
      // ---- the microwave: a hollow box, a door with a window, and a control panel on the right.
      const body = mix(P.slate, P.charcoal, 0.45);
      withOutline(0.03, () => {
        part(this.scene, rbox(W, 0.1, D, 0.04), body, mx, CT + H - 0.05, 0, { gloss: 0.3 });
        part(this.scene, rbox(W, 0.1, D, 0.04), body, mx, CT + 0.05, 0);
        part(this.scene, rbox(0.1, H, D, 0.04), body, mx - W / 2 + 0.05, CT + H / 2, 0);
        part(this.scene, rbox(W, H, 0.1, 0.04), body, mx, CT + H / 2, -D / 2 + 0.05);
        part(this.scene, rbox(0.5, H, D, 0.05), body, mx + W / 2 - 0.25, CT + H / 2, 0, { gloss: 0.3 });
        part(this.scene, rbox(0.42, H - 0.12, 0.03, 0.02), P.ink, mx + W / 2 - 0.25, CT + H / 2, D / 2 - 0.005, { outline: false, gloss: 0.4 });
        for (let v = 0; v < 5; v++) part(this.scene, rbox(0.34, 0.025, 0.02, 0.008), P.ink, mx - 0.25, CT + H + 0.002, -0.3 + v * 0.09, { outline: false, shadow: false });
        part(this.scene, rbox(0.42, 0.06, 0.04, 0.02), s.color, mx + W / 2 - 0.25, CT + 0.12, D / 2 + 0.01, { outline: false });
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 2; c++) part(this.scene, rbox(0.12, 0.08, 0.04, 0.02), P.linen, mx + W / 2 - 0.33 + c * 0.16, CT + H - 0.52 - r * 0.13, D / 2 + 0.01, { outline: false });
        }
        part(this.scene, cyl(0.07, 0.07, 0.05, 16), s.color, mx + W / 2 - 0.25, CT + 0.3, D / 2 + 0.02, { rx: Math.PI / 2, gloss: 0.4 });
        for (const fx of [-W / 2 + 0.15, W / 2 - 0.15]) for (const fz of [-D / 2 + 0.15, D / 2 - 0.15]) part(this.scene, cyl(0.05, 0.05, 0.04, 8), P.metal, mx + fx, CT + 0.02, fz, { outline: false });
      });
      // The display: a little screen on the panel.
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 64;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.push(texture);
      const screenMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      this.own.push(screenMat);
      const screen = new THREE.Mesh(plane(0.38, 0.15), screenMat);
      screen.position.set(mx + W / 2 - 0.25, CT + H - 0.25, D / 2 + 0.012);
      this.scene.add(screen);
      // Inside: a warm light at the back (glows while running) and the glass turntable.
      const glowMat = toonMat({ color: P.glow, emissive: new THREE.Color(P.lamp), emissiveIntensity: 0 });
      this.own.push(glowMat);
      part(this.scene, rbox(W - 0.62, H - 0.24, 0.02, 0.01), P.glow, mx + CAVITY_X, CT + H / 2, -D / 2 + 0.11, { material: glowMat, outline: false });
      const table = new THREE.Group();
      table.position.set(mx + CAVITY_X, CT + 0.11, 0);
      part(table, cyl(0.5, 0.5, 0.03, 28), P.ceramic, 0, 0, 0, { outline: false, gloss: 0.5 });
      this.scene.add(table);
      // The bag: a soft pillow with red crimped ends, puffing up as it pops.
      const bag = new THREE.Group();
      bag.position.y = 0.02;
      const puff = new THREE.Group();
      const bagMat = toonMat({ color: CREAM });
      this.own.push(bagMat);
      part(puff, ball(0.5, 3), CREAM, 0, 0, 0, { material: bagMat, sz: 0.62 });
      part(puff, rbox(0.1, 0.18, 0.6, 0.04), P.terracotta, -0.5, 0, 0);
      part(puff, rbox(0.1, 0.18, 0.6, 0.04), P.terracotta, 0.5, 0, 0);
      bag.add(puff);
      table.add(bag);
      // The door, hinged on the left, with a big window.
      const door = new THREE.Group();
      door.position.set(mx - W / 2, CT + H / 2, D / 2 + 0.03);
      const dw = W - 0.5;
      withOutline(0.025, () => {
        part(door, rbox(dw, 0.12, 0.05, 0.02), body, dw / 2, H / 2 - 0.06, 0);
        part(door, rbox(dw, 0.12, 0.05, 0.02), body, dw / 2, -H / 2 + 0.06, 0);
        part(door, rbox(0.12, H, 0.05, 0.02), body, 0.06, 0, 0);
        part(door, rbox(0.12, H, 0.05, 0.02), body, dw - 0.06, 0, 0);
      });
      part(door, rbox(dw - 0.2, H - 0.2, 0.02, 0.01), P.ink, dw / 2, 0, 0, { opacity: 0.2, shadow: false });
      part(door, rbox(0.05, H * 0.62, 0.07, 0.02), P.metal, dw - 0.06, 0, 0.05, { outline: false, gloss: 0.7 });
      this.scene.add(door);
      // The bowl, in the player's colour.
      const bowl = new THREE.Group();
      bowl.position.set(x + BOWL_DX, CT + 0.32, 0.15);
      part(bowl, dome(0.58), s.color, 0, 0, 0, { rx: Math.PI, sy: 0.55, gloss: 0.5 });
      part(bowl, torus(0.58, 0.05), P.ceramic, 0, 0, 0, { rx: Math.PI / 2, gloss: 0.5 });
      part(bowl, cyl(0.26, 0.22, 0.05, 18), P.ceramic, 0, -0.31, 0, { outline: false });
      this.scene.add(bowl);
      // Kernels hopping behind the glass, and smoke for a burning bag.
      const hops: Hop[] = [];
      for (let k = 0; k < 12; k++) {
        const mesh = part(this.scene, ball(0.05, 1), k % 3 ? P.cream : P.glow, 0, 0, 0, { outline: false, shadow: false });
        mesh.visible = false;
        hops.push({ mesh, v: new THREE.Vector3(), age: 1 });
      }
      const smoke: Smoke[] = [];
      for (let k = 0; k < 10; k++) {
        const mat = toonMat({ color: P.stone, transparent: true, opacity: 0, depthWrite: false });
        this.own.push(mat);
        const mesh = new THREE.Mesh(ball(0.2, 2), mat);
        mesh.visible = false;
        this.scene.add(mesh);
        smoke.push({ mesh, mat, age: 1 });
      }
      const c = companions[i] as Companion;
      c.root.position.set(x + COMP_DX, CT, 0.2);
      c.root.rotation.y = 0.45;
      c.setBase('idle');
      this.scene.add(c.root);
      const card = nameCard(s.name, s.color, 0.8);
      card.position.set(x - 0.1, CT - 0.42, 1.0);
      this.scene.add(card);
      this.cards.push(card);
      const lane: Lane = {
        x,
        companion: c,
        door,
        table,
        bag,
        puff,
        bagMat,
        glowMat,
        display: { canvas, texture, text: '' },
        bowl,
        puffs: 0,
        hops,
        hop: 0,
        smoke,
        smokeNext: 0,
        drops: [],
        pour: [],
        jiggle: 0,
        bounce: 0,
        out: -1,
        next: null,
        plan: null,
        burn: 0,
        running: false,
      };
      this.lanes.push(lane);
      this.bagIn(lane, first);
      this.screen(lane, 'POP');
      this.marks.push(
        { p: new THREE.Vector3(x + COMP_DX - 0.4, CT, 0.6) },
        { p: new THREE.Vector3(x + COMP_DX, CT + HEIGHT + 0.1, 0.2) },
        { p: new THREE.Vector3(mx - W / 2, CT + H + 0.25, 0) },
        { p: new THREE.Vector3(x + BOWL_DX + 0.62, CT, 0.6) },
        { p: new THREE.Vector3(x + BOWL_DX + 0.62, CT + 0.8, 0.2) },
        { p: card.position.clone(), pad: 0.05 },
      );
    });
  }

  /** A fresh, flat bag on the turntable. */
  private bagIn(l: Lane, plan: BagPlan): void {
    l.plan = plan;
    l.bag.visible = true;
    l.bag.position.set(0, 0.02, 0);
    l.bag.scale.setScalar(BAG_SCALE[plan.size]);
    l.bag.rotation.set(0, 0, 0);
    l.puff.scale.set(1, 0.16, 1);
    l.bagMat.color.set(CREAM);
    l.burn = 0;
  }

  /** Writes on a microwave's little screen. */
  screen(l: Lane, text: string): void {
    const key = `${text}|${l.running}`;
    if (l.display.text === key) return;
    l.display.text = key;
    const g = l.display.canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = P.ink;
    g.fillRect(0, 0, 160, 64);
    g.fillStyle = l.running ? P.lamp : mix(P.lamp, P.ink, 0.45);
    g.font = `800 44px ${ROUNDED_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 80, 35);
    l.display.texture.needsUpdate = true;
  }

  /** Shows a cooking bag: how puffed, how brown, whether it turns. */
  cook(i: number, plan: BagPlan, heat: number, running: boolean, pops: number): void {
    const l = this.lanes[i];
    if (!l || l.out >= 0) return;
    l.running = running;
    const n = plan.kernels.length;
    const popped = poppedAt(plan, heat) / n;
    l.puff.scale.set(1 + popped * 0.08, 0.16 + 0.52 * popped ** 0.7, 1 + popped * 0.12);
    const burnt = burntAt(plan, heat) / n;
    const scorch = Math.max(0, (heat - scorchAt(plan)) / plan.spread);
    l.burn = Math.min(1, burnt * 1.8 + scorch * 0.15);
    l.bagMat.color.set(mix(CREAM, TOAST, l.burn));
    l.jiggle = Math.min(1, l.jiggle + pops * 0.35);
    for (let k = 0; k < Math.min(2, pops); k++) this.hopKernel(l);
    this.screen(l, running ? `0:${String(Math.floor(heat)).padStart(2, '0')}` : heat > 0 ? 'PAUSE' : 'POP');
  }

  private hopKernel(l: Lane): void {
    const h = l.hops[l.hop] as Hop;
    l.hop = (l.hop + 1) % l.hops.length;
    const s = BAG_SCALE[l.plan?.size ?? 'medium'];
    h.mesh.position.set(l.table.position.x + (Math.random() - 0.5) * 0.7 * s, CT + 0.3 + l.puff.scale.y * 0.4 * s, (Math.random() - 0.5) * 0.4);
    h.v.set((Math.random() - 0.5) * 1.2, 1.4 + Math.random() * 1.1, (Math.random() - 0.5) * 0.6);
    h.age = 0;
    h.mesh.visible = true;
  }

  /** The bag comes out: the door opens, the popcorn goes in the bowl, the next bag (if any) goes in. */
  bagOut(i: number, r: BagResult, next: BagPlan | null): void {
    const l = this.lanes[i];
    if (!l) return;
    l.out = 0;
    l.next = next;
    l.running = false;
    this.screen(l, 'END');
    const good = Math.max(0, Math.round((r.popped - r.burnt) / PUFF_PER));
    const bad = Math.min(4, Math.ceil(r.burnt / (PUFF_PER * 2)));
    for (let k = 0; k < good; k++) l.pour.push({ kind: 'pop', at: 0.55 + k * 0.025 });
    for (let k = 0; k < bad; k++) l.pour.push({ kind: 'burnt', at: 0.6 + k * 0.08 });
  }

  bowlTop(i: number): THREE.Vector3 {
    const l = this.lanes[i];
    return new THREE.Vector3((l?.x ?? 0) + BOWL_DX, CT + 1.1, 0.4);
  }

  dispose(): void {
    this.floaters.dispose();
    for (const l of this.lanes) l.companion.dispose();
    for (const m of this.own) m.dispose();
    for (const t of this.textures) t.dispose();
    for (const c of this.cards) {
      c.material.map?.dispose();
      c.material.dispose();
    }
  }

  update(dt: number, time: number): void {
    this.env.update(dt, time);
    this.fit.update(() => this.marks);
    for (const l of this.lanes) {
      l.companion.update(dt);
      l.glowMat.emissiveIntensity += ((l.running ? 0.9 : 0) - l.glowMat.emissiveIntensity) * Math.min(1, dt * 10);
      if (l.running) l.table.rotation.y += dt * 1.1;
      l.jiggle = Math.max(0, l.jiggle - dt * 4);
      if (l.out < 0) {
        l.bag.position.y = 0.02 + Math.abs(Math.sin(time * 40)) * 0.03 * l.jiggle;
        l.bag.rotation.z = Math.sin(time * 33) * 0.05 * l.jiggle;
      }
      // Kernels hop about inside.
      for (const h of l.hops) {
        if (!h.mesh.visible) continue;
        h.age += dt;
        h.v.y -= 7 * dt;
        h.mesh.position.addScaledVector(h.v, dt);
        const roof = CT + H - 0.16;
        if (h.mesh.position.y > roof) {
          h.mesh.position.y = roof;
          h.v.y = -Math.abs(h.v.y) * 0.4;
        }
        if (h.age > 0.45 || h.mesh.position.y < CT + 0.15) h.mesh.visible = false;
      }
      // Smoke from a burning bag (and a little after it comes out).
      l.smokeNext -= dt;
      if (l.burn > 0.04 && l.smokeNext <= 0) {
        l.smokeNext = 0.5 / (1 + l.burn * 6);
        const s = l.smoke.find((m) => !m.mesh.visible);
        if (s) {
          s.age = 0;
          s.mesh.visible = true;
          s.mesh.position.set(l.x + MW_DX + CAVITY_X + (Math.random() - 0.5) * 0.9, CT + H + 0.05, (Math.random() - 0.3) * 0.5);
        }
      }
      for (const s of l.smoke) {
        if (!s.mesh.visible) continue;
        s.age += dt;
        const k = s.age / 1.6;
        s.mesh.position.y += dt * 0.55;
        s.mesh.position.x += Math.sin(time * 1.7 + s.mesh.id) * dt * 0.15;
        s.mesh.scale.setScalar(0.6 + k * 1.6);
        s.mat.opacity = Math.max(0, 0.55 * Math.sin(Math.min(1, k) * Math.PI));
        if (k >= 1) s.mesh.visible = false;
      }
      // Taking a bag out and putting the next one in.
      if (l.out >= 0) this.stepOut(l, dt);
      // Popcorn falling into the bowl.
      for (let k = l.drops.length - 1; k >= 0; k--) {
        const d = l.drops[k] as Drop;
        d.age += dt;
        const q = Math.min(1, d.age / 0.3);
        d.mesh.position.lerpVectors(d.from, d.to, ease.outCubic(q));
        d.mesh.position.y = d.from.y + (d.to.y - d.from.y) * q * q;
        if (q >= 1) {
          l.drops.splice(k, 1);
          l.bounce = 1;
        }
      }
      l.bounce = Math.max(0, l.bounce - dt * 5);
      const squash = Math.sin(l.bounce * Math.PI) * 0.07;
      l.bowl.scale.set(1 + squash, 1 - squash, 1 + squash);
    }
    this.floaters.update(dt);
  }

  private stepOut(l: Lane, dt: number): void {
    l.out += dt;
    l.burn = Math.max(0, l.burn - dt * 0.5);
    const t = l.out;
    const span = POPCORN.between;
    const open = t < 0.3 ? t / 0.3 : t < span - 0.35 ? 1 : Math.max(0, (span - t) / 0.3);
    l.door.rotation.y = -1.7 * ease.inOutSine(Math.min(1, open));
    // The bag glides out toward the bowl and shrinks away as it pours.
    const lift = Math.min(1, Math.max(0, (t - 0.2) / 0.5));
    if (lift > 0 && lift < 1) {
      // Out through the open door (toward the camera) and over to the bowl, in the turning table's own frame.
      const spin = l.table.rotation.y;
      l.bag.position
        .set((BOWL_DX - MW_DX - CAVITY_X) * ease.inOutSine(lift), 0.02 + Math.sin(lift * Math.PI * 0.6), 0.15 * lift + 0.75 * Math.sin(lift * Math.PI))
        .applyAxisAngle(UP, -spin);
      l.bag.rotation.set(0, -spin, -lift * 1.4);
      l.bag.scale.setScalar(BAG_SCALE[l.plan?.size ?? 'medium'] * (1 - lift * 0.7));
    } else if (lift >= 1) l.bag.visible = false;
    while (l.pour.length && (l.pour[0]?.at ?? 99) <= t) {
      const p = l.pour.shift();
      if (p) this.addPuff(l, p.kind === 'burnt');
    }
    if (t >= span - 0.25 && l.next) {
      this.bagIn(l, l.next);
      l.next = null;
      this.screen(l, 'POP');
    }
    if (t >= span) {
      l.out = -1;
      l.door.rotation.y = 0;
      for (const p of l.pour.splice(0)) this.addPuff(l, p.kind === 'burnt');
    }
  }

  /** One more puff of popcorn in the bowl, heaped in a little mound. */
  private addPuff(l: Lane, burnt: boolean): void {
    if (l.puffs >= MAX_PUFFS) return;
    const k = l.puffs++;
    const ring = k % 14;
    const r = 0.46 * Math.sqrt((ring + 0.5) / 14);
    const a = k * 2.39996;
    const to = new THREE.Vector3(Math.cos(a) * r, -0.17 + Math.floor(k / 14) * 0.075 + (0.46 - r) * 0.18, Math.sin(a) * r * 0.9);
    const mesh = part(l.bowl, ball(0.085, 1), burnt ? P.walnut : k % 3 ? P.cream : P.glow, to.x, to.y + 1.0, to.z, { outline: false, shadow: false, s: 0.85 + ((k * 37) % 10) / 30 });
    l.drops.push({ mesh, from: new THREE.Vector3(to.x * 0.3, to.y + 1.0, to.z * 0.3), to, age: 0 });
  }
}

// ------------------------------------------------------------------ the game

function bagNote(c: Cook, plans: readonly BagPlan[]): string {
  const k = c.bag;
  const plan = plans[k];
  const last = c.results[c.results.length - 1];
  const before = last ? `${last.popped} popped, ${last.burnt} burnt. ` : '';
  return plan ? `${before}Bag ${k + 1} of ${plans.length} (${BAG_SIZES[plan.size].label.toLowerCase()}). Hold to cook, let go when the popping slows.` : '';
}

export const minigame: Minigame = {
  id: 'popcorn',
  title: 'Microwave Popcorn',
  how: 'Hold the button to run your microwave and let go when the popping slows down: too early leaves kernels, too late burns the bag. Three bags, most good popcorn wins!',
  controller: 'hold',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const cpu = seats.map((s) => session.isCpu(s.index));
    const skill = seats.map((_, i) => (cpu[i] ? ctx.skill() : 0));
    const plans = planBags(rng);
    const cooks = seats.map(() => newCook());
    const cpus: CpuCook[] = seats.map(() => newCpuCook());
    const holding = seats.map(() => false);
    const buzzAt = seats.map(() => -1);
    const view = new Kitchen(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), plans[0] as BagPlan);
    ctx.stage.setView(view);
    const hum = new Hum(sfx);
    const layoutFor = (i: number): Layout => {
      const c = cooks[i] as Cook;
      if (cookDone(c, plans)) return { kind: 'wait', title: 'All three bags done!', text: `${cookTotal(c)} good kernels in your bowl. Watch the big screen.` };
      return { kind: 'hold', label: 'Microwave', note: bagNote(c, plans) };
    };
    seats.forEach((s, i) => session.setLayout(s.index, layoutFor(i)));

    let now = 0;
    let frameAt = performance.now();
    let lastOut = 0;
    const moods = seats.map(() => '');
    const setMood = (i: number, mood: 'idle' | 'listening' | 'thinking') => {
      if (moods[i] === mood) return;
      moods[i] = mood;
      view.lanes[i]?.companion.setBase(mood);
    };

    const finished = (i: number, r: BagResult, auto: boolean) => {
      const c = cooks[i] as Cook;
      const seat = seats[i] as MinigameSeat;
      const plan = plans[c.bag - 1] as BagPlan;
      lastOut = now;
      view.bagOut(i, r, plans[c.bag] ?? null);
      ding(sfx);
      if (auto) sfx.bad();
      const good = r.popped - r.burnt;
      view.floaters.add(`+${good}`, seat.color, view.bowlTop(i), 0.55, 1.4);
      if (r.burnt > 0) view.floaters.add(`${r.burnt} burnt`, P.clay, view.bowlTop(i).add(new THREE.Vector3(0, -0.45, 0.1)), 0.38, 1.4);
      const share = good / plan.kernels.length;
      const comp = view.lanes[i]?.companion;
      if (share >= 0.82) comp?.react('happy', 1.8);
      else if (share < 0.6 || r.burnt > plan.kernels.length * 0.15) comp?.react('sad', 1.6);
      else comp?.react('approval', 1.2);
      session.setLayout(seat.index, layoutFor(i));
      session.send(seat.index, { t: 'buzz', pattern: r.burnt > 0 ? [60, 40, 60] : [30] });
    };

    const off = session.onInput((seatIndex, msg) => {
      if (msg.t !== 'hold') return;
      const i = posOf.get(seatIndex);
      if (i === undefined || cpu[i]) return;
      holding[i] = msg.down;
      if (msg.down) return;
      // Let go on what the screen showed: the release took `lag` to arrive.
      const raw = now + Math.max(0, (performance.now() - frameAt) / 1000) * clock.speed;
      const lag = Math.min(0.15, (session.seats[seatIndex]?.rtt ?? 0) / 2000) * clock.speed;
      const r = letGo(cooks[i] as Cook, plans, raw, lag);
      if (r) finished(i, r, false);
    });

    ui.caption('Hold to run the microwave. Let go when the popping slows down!');
    let hudAt = -1;
    await everyFrame(clock, (dt, t) => {
      now = t;
      frameAt = performance.now();
      let running = 0;
      cooks.forEach((c, i) => {
        if (cpu[i]) holding[i] = cpuHolding(cpus[i] as CpuCook, c, plans, t, skill[i] ?? 0.5, rng);
        const bag = c.bag;
        const step = stepCook(c, plans, holding[i] ?? false, dt, t);
        if (step.finished) {
          // Still held when it came out: the microwave switched itself off.
          finished(i, step.finished, holding[i] === true);
          return;
        }
        const plan = plans[bag];
        if (!plan) {
          setMood(i, 'idle');
          return;
        }
        if (c.running) running += 1;
        view.cook(i, plan, c.heat, c.running, step.pops);
        // Worried once the bag is visibly burning (past the best moment), not before: no free hints.
        setMood(i, c.running ? (burntAt(plan, c.heat) >= plan.kernels.length * 0.05 ? 'thinking' : 'listening') : 'idle');
        if (step.pops > 0) {
          popSound(sfx, step.pops);
          const s = seats[i] as MinigameSeat;
          if (!cpu[i] && t - (buzzAt[i] ?? -1) > 0.09) {
            buzzAt[i] = t;
            session.send(s.index, { t: 'buzz', pattern: [7] });
          }
        }
      });
      hum.set(running);
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(Math.max(0, POPCORN.limit - t));
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${cookTotal(cooks[i] as Cook)} pts` })));
      }
      const allDone = cooks.every((c) => cookDone(c, plans));
      return t >= POPCORN.limit || (allDone && t >= lastOut + POPCORN.between);
    });
    off();
    hum.stop();
    cooks.forEach((c, i) => {
      const r = stopCook(c, plans, now);
      if (r) {
        view.bagOut(i, r, null);
        ding(sfx);
      }
    });
    ui.timer(null);
    ui.caption(null);
    const totals = cooks.map(cookTotal);
    const best = Math.max(...totals);
    view.lanes.forEach((l, i) => {
      l.companion.setBase('idle');
      if (totals[i] === best) l.companion.react('happy', 3);
    });
    return {
      scores: popcornScores(cooks),
      details: cooks.map((c) => {
        const popped = c.results.reduce((s, r) => s + r.popped, 0);
        const burnt = c.results.reduce((s, r) => s + r.burnt, 0);
        return [`${cookTotal(c)} pts`, `${c.results.length} bag${c.results.length === 1 ? '' : 's'}`, ...(burnt ? [`${burnt} burnt`] : popped ? ['none burnt'] : [])].join(' · ');
      }),
    };
  },
};
