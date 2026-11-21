// Hide and Sleep on the TV: a sleepy living room after lights out. Three hiders tuck themselves away (in secret,
// on their phones), then the seeker sweeps a torch round the dark room and searches one spot at a time. A hider
// who sneaks to another spot rustles, heard from that side of the room only.
import * as THREE from 'three';
import {
  HIDE,
  SPOTS,
  type HideBrain,
  type House,
  type SeekBrain,
  cpuPick,
  cpuSeek,
  cpuSneak,
  hiddenCount,
  hideScores,
  hiderOf,
  isOver,
  newHideBrain,
  newHouse,
  newSeekBrain,
  pickSpot,
  pointTo,
  press,
  rustleColumn,
  sneak,
  startSeek,
  stepHouse,
} from '../../../game/minigames/hideandsleep';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Layout } from '../../../shared/protocol';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Env, bedroom } from '../../render/env';
import { setGrade } from '../../render/post';
import * as props from '../../render/props';
import { PALETTE as P, box, cyl, gem, mix, nameCard, part, pill, rbox, setLook, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.3;
const SEEKER = new THREE.Vector3(6.5, 0, 3.1);
const TILT = 0.4;
const MUTED = '#6b7194';
const ROOM = 1.5; // the room is built at life size and scaled up: the furniture is big enough to hide in
const WALL = -3.6; // the back wall
const LAMP = 26; // the reading lamp, when it is on
/** Where each spot's furniture stands. */
const FURNITURE: readonly [number, number][] = [
  [-4.2, 0.9], // bed
  [-4.2, -2.8], // wardrobe
  [0, -3.25], // curtains
  [4.2, -2.6], // laundry basket
  [0, 1.3], // blankets
  [4.2, 0.9], // couch
];
/** Where someone found in each spot ends up standing. */
const POP: readonly [number, number][] = [
  [-4.2, 2.2],
  [-4.2, -1.9],
  [0, -2.55],
  [4.2, -1.75],
  [0, 2.45],
  [4.2, 0.05],
];

/** Torch space (x, y: -1..1) to a point in the room: the front row low and near, the back row high and far. */
function roomPoint(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const t = (y + 0.42) / 0.84;
  return out.set(x * 7, 0.75 + t * 1.05, Math.max(-3.3, 1.0 - t * 3.9));
}

// ------------------------------------------------------------------ sounds

/** A rustle, played from the side of the room it came from. */
function rustle(sfx: Sfx, column: number): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.max(-1, Math.min(1, column / 0.6)) * 0.85;
  pan.connect(out);
  for (let k = 0; k < 3; k++) {
    const t0 = ctx.currentTime + k * 0.09 + Math.random() * 0.03;
    const dur = 0.08 + Math.random() * 0.05;
    const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2200 + Math.random() * 1500;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(filter).connect(g).connect(pan);
    src.start(t0);
  }
}

function giggle(sfx: Sfx): void {
  [0, 0.09, 0.18, 0.27].forEach((d, i) => tone(sfx, { freq: 640 + i * 70, to: 820 + i * 90, dur: 0.07, type: 'triangle', gain: 0.09, delay: d }));
}

function rummage(sfx: Sfx): void {
  noise(sfx, { dur: 0.22, filter: 'bandpass', freq: 1300, to: 700, gain: 0.08 });
}

function nobody(sfx: Sfx): void {
  tone(sfx, { freq: 330, to: 250, dur: 0.25, type: 'sine', gain: 0.08 });
}

// ------------------------------------------------------------------ the scene

class Bedroom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  /** One group per spot (wobbles when searched). */
  readonly spots: THREE.Group[] = [];
  private readonly shake: number[] = SPOTS.map(() => 0);
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  /** The room's own lights with their evening strengths, dimmed for lights-out. */
  private readonly dimmed: { light: THREE.Light; base: number; low: number }[] = [];
  private readonly sunWarm = new THREE.Color();
  private readonly sunCold = new THREE.Color(P.moon);
  private readonly bgWarm = new THREE.Color();
  private readonly bgCold = new THREE.Color(P.midnight);
  private lampOn: THREE.Object3D | null = null;
  private lampOff: THREE.Object3D | null = null;
  private lamp: THREE.PointLight | null = null;
  private sparks: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private readonly torch = new THREE.SpotLight('#fff0c8', 0, 0, 0.2, 0.5, 0);
  private readonly cone: THREE.Mesh;
  private readonly coneMat: THREE.MeshBasicMaterial;
  private readonly cards = new Map<number, THREE.Sprite>();
  private readonly pops = new Map<number, { age: number }>();
  private readonly target = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  beamOn = false;
  dark = 0;
  time = 0;

  constructor(
    readonly seats: MinigameSeat[],
    readonly companions: Companion[],
    readonly seeker: number,
    readonly hiders: number[],
  ) {
    // A bedsit in the evening; the kit's furniture is cleared out, the hiding places are the game's own.
    this.env = bedroom(this.scene, { mood: 'evening', w: 11.8, d: 4.8, h: 4.4, bed: false, lights: false, wall: mix(P.duskWall, P.denim, 0.25) });
    for (const name of ['rug', 'window', 'curtains', 'floorLamp', 'picture', 'stringLights']) {
      for (const o of this.env.root.children.filter((c) => c.name === name)) o.removeFromParent();
    }
    this.env.root.scale.setScalar(ROOM);
    this.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight) this.dimmed.push({ light: l, base: l.intensity, low: (o as THREE.HemisphereLight).isHemisphereLight ? 0.72 : (o as THREE.DirectionalLight).isDirectionalLight ? 0.42 : 0.4 });
    });
    this.sunWarm.copy(this.env.sun.color);
    if (this.scene.background instanceof THREE.Color) this.bgWarm.copy(this.scene.background);
    this.scene.background = this.bgWarm.clone();
    this.torch.castShadow = true;
    this.torch.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.torch, this.torch.target);
    this.coneMat = new THREE.MeshBasicMaterial({ color: P.lamp, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const coneGeo = new THREE.CylinderGeometry(0.05, 1, 1, 24, 1, true);
    coneGeo.translate(0, -0.5, 0);
    this.cone = new THREE.Mesh(coneGeo, this.coneMat);
    this.cone.visible = false;
    this.scene.add(this.cone);
    this.tick = this.build();

    seats.forEach((_, i) => {
      const c = companions[i] as Companion;
      this.scene.add(c.root);
      if (i === seeker) {
        c.root.position.copy(SEEKER);
        c.setBase('sleeping');
        // A little torch in hand.
        const t = new THREE.Group();
        part(t, cyl(0.07, 0.06, 0.32, 12), P.charcoal, 0, 0, 0, { rx: Math.PI / 2, gloss: 0.5 });
        part(t, cyl(0.072, 0.072, 0.05, 12), P.brass, 0, 0, 0.1, { rx: Math.PI / 2, gloss: 0.7, outline: false });
        part(t, cyl(0.09, 0.07, 0.08, 12), P.lamp, 0, 0, 0.18, { rx: Math.PI / 2, glow: 2 });
        t.position.set(0.3, HEIGHT * 0.45, 0.28);
        c.root.add(t);
      } else {
        // Hiders mill about in the middle until the lights go out.
        const k = hiders.indexOf(i);
        c.root.position.set((k - 1) * 1.4, 0, 2.6);
        c.setBase('happy');
      }
    });
    const card = nameCard('Seeker', seats[seeker]?.color ?? '#ffffff', 0.7);
    card.position.set(SEEKER.x, HEIGHT + 0.7, SEEKER.z);
    this.scene.add(card);
    this.cards.set(seeker, card);
    this.lights(1);
  }

  private build(): (dt: number, time: number) => void {
    const s = this.scene;
    const set = new THREE.Group();
    s.add(set);
    const put = (parent: THREE.Object3D, o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = ROOM) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      parent.add(o);
      return o;
    };
    const wood = { tex: 'wood' as const, texScale: 1.4 };
    // A big round rug in the middle; a clock and pictures on the wall.
    put(set, props.rug({ round: true, w: 5.4, color: mix(P.denim, P.mauve, 0.25), tex: 'terry' }), 0, 0, 0.5, 0, 1);
    put(set, props.wallClock({ r: 0.2, color: P.brass }), -2.1, 3.5, WALL + 0.02);
    put(set, props.pictureFrame({ w: 0.75, h: 0.55, art: 'hills', frame: P.oak, seed: 4 }), 2.3, 3.3, WALL + 0.02);
    put(set, props.pictureFrame({ w: 0.4, h: 0.5, art: 'leaf', frame: P.brass, seed: 7 }), 6.3, 3.4, WALL + 0.02);
    put(set, props.pictureFrame({ w: 0.6, h: 0.8, art: 'moon', frame: P.charcoal, seed: 2 }), -6.6, 3.3, WALL + 0.02);

    // Fairy lights along the wall (they stay on after lights-out: just enough to see the furniture by).
    for (let k = 0; k < 3; k++) set.add(props.stringLights(new THREE.Vector3(-7.8 + k * 5.2, 4.25, WALL + 0.1), new THREE.Vector3(-2.6 + k * 5.2, 4.25, WALL + 0.1), { sag: 0.22, count: 8, bulb: 0.05 }));

    const add = (i: number, build: (g: THREE.Group) => void) => {
      const g = new THREE.Group();
      const [x, z] = FURNITURE[i] ?? [0, 0];
      g.position.set(x, 0, z);
      withOutline(0.03, () => build(g));
      s.add(g);
      this.spots[i] = g;
    };
    // 0: the bed, raised on legs with a dark gap underneath.
    add(0, (g) => {
      put(g, props.bed({ w: 1.38, color: P.denim, blanket: P.mustard, frame: P.walnut }), 0, 0.26, 0, Math.PI / 2, 1.45);
      for (const [x, z] of [
        [-1.35, -0.85],
        [1.35, -0.85],
        [-1.35, 0.85],
        [1.35, 0.85],
      ] as const) {
        part(g, rbox(0.16, 0.5, 0.16, 0.04), P.walnut, x, 0.25, z, wood);
      }
      part(g, box(2.7, 0.04, 1.8), P.ink, 0, 0.03, 0, { outline: false, shadow: false });
      // the valance leaves the gap open at the front
      part(g, box(2.9, 0.1, 0.03), mix(P.denim, P.ink, 0.3), 0, 0.5, -1.02, { outline: false });
    });
    // 1: the wardrobe.
    add(1, (g) => {
      part(g, rbox(2.2, 3.6, 1.0, 0.05), P.walnut, 0, 1.8, 0, wood);
      for (const side of [-1, 1]) {
        part(g, rbox(1.0, 3.1, 0.05, 0.03), mix(P.walnut, P.oak, 0.22), side * 0.53, 1.85, 0.5, { ...wood, outline: 0.015 });
        part(g, rbox(0.7, 1.3, 0.03, 0.02), mix(P.walnut, P.ink, 0.18), side * 0.53, 2.6, 0.53, { outline: false });
        part(g, rbox(0.7, 1.3, 0.03, 0.02), mix(P.walnut, P.ink, 0.18), side * 0.53, 1.1, 0.53, { outline: false });
        part(g, sphere(0.055, 10), P.brass, side * 0.13, 1.9, 0.56, { outline: false, gloss: 0.7 });
      }
      part(g, rbox(2.34, 0.14, 1.1, 0.04), mix(P.walnut, P.ink, 0.2), 0, 3.65, 0, wood);
      part(g, rbox(2.26, 0.2, 1.04, 0.03), mix(P.walnut, P.ink, 0.25), 0, 0.1, 0, { outline: false });
      part(g, cyl(0.3, 0.3, 0.3, 18), P.terracotta, 0.5, 3.87, 0, { tex: 'fabric' });
      part(g, cyl(0.31, 0.31, 0.06, 18), P.cream, 0.5, 4.0, 0, { outline: false });
      part(g, rbox(0.6, 0.22, 0.45, 0.04), P.sand, -0.45, 3.83, 0.05, { tex: 'planks', texScale: 0.6 });
    });
    // 2: the window and long curtains.
    add(2, (g) => {
      put(g, props.windowFrame({ w: 1.5, h: 1.45, time: 'night', seed: 3 }), 0, 2.25, WALL + 3.27, 0, ROOM);
      part(g, cyl(0.04, 0.04, 3.7, 10), P.brass, 0, 3.6, -0.15, { rz: Math.PI / 2, gloss: 0.6 });
      for (const side of [-1, 1]) {
        part(g, sphere(0.08, 10), P.brass, side * 1.88, 3.6, -0.15, { outline: false, gloss: 0.6 });
        for (let k = 0; k < 4; k++) part(g, pill(0.16, 3.05), mix(P.mauve, k % 2 ? P.plum : P.rose, 0.25), side * (0.78 + k * 0.29), 1.78, -0.05 + (k % 2) * 0.08, { tex: 'fabric', outline: k === 0 || k === 3 ? 0.03 : false });
      }
    });
    // 3: the laundry basket, clothes spilling over.
    add(3, (g) => {
      part(g, cyl(0.62, 0.5, 1.0, 22), P.sand, 0, 0.5, 0, { tex: 'knit', texScale: 0.35 });
      part(g, torus(0.62, 0.06), mix(P.sand, P.walnut, 0.35), 0, 1.0, 0, { rx: Math.PI / 2 });
      part(g, torus(0.52, 0.04), mix(P.sand, P.walnut, 0.35), 0, 0.03, 0, { rx: Math.PI / 2, outline: false });
      for (const side of [-1, 1]) part(g, torus(0.14, 0.03, Math.PI), mix(P.sand, P.walnut, 0.5), side * 0.63, 0.78, 0, { ry: Math.PI / 2, rz: 0, outline: false });
      part(g, sphere(0.32, 12), P.sage, -0.15, 1.05, 0.05, { sy: 0.6, tex: 'fabric' });
      part(g, sphere(0.28, 12), P.mustard, 0.2, 1.08, -0.1, { sy: 0.6, tex: 'fabric' });
      part(g, pill(0.07, 0.5), P.rose, 0.55, 0.85, 0.2, { rz: 0.6, tex: 'knit' });
      part(g, pill(0.06, 0.3), P.cream, -0.5, 0.95, 0.3, { rz: -0.9, rx: 0.4, tex: 'knit' });
    });
    // 4: a cosy heap of blankets on the rug.
    add(4, (g) => {
      const heap: [number, number, number, number, string][] = [
        [0, 0.3, 0, 1.0, P.terracotta],
        [-0.6, 0.25, 0.2, 0.75, P.sage],
        [0.65, 0.25, 0.15, 0.7, P.sand],
        [0.1, 0.55, -0.1, 0.65, P.mauve],
        [-0.2, 0.2, 0.6, 0.6, P.denim],
      ];
      for (const [x, y, z, r, c] of heap) part(g, sphere(r, 20), c, x, y, z, { sy: 0.5, tex: 'knit', texScale: 0.6 });
      part(g, rbox(0.5, 0.16, 0.36, 0.07), P.cream, 0.75, 0.5, 0.45, { rz: -0.3, ry: 0.4, tex: 'fabric' });
    });
    // 5: the couch, facing the room.
    add(5, (g) => {
      put(g, props.sofa({ seats: 3, color: P.terracotta, pillows: [P.mustard, P.cream] }), 0, 0, -0.05, 0, 1.25);
      put(g, props.blanket({ w: 0.7, d: 1.1, color: P.sage, tex: 'knit' }), 0.95, 0.8, 0.1, 0.2, 1.1);
    });
    // A plant, the reading lamp (on in the evening, off after lights out), and soft things up front.
    put(set, props.plant({ kind: 'ficus', h: 1.5, pot: P.terracotta, seed: 3 }), -6.7, 0, -2.9);
    this.lampOn = put(set, props.floorLamp({ h: 1.7, lit: true, light: LAMP }), 6.3, 0, -2.9);
    this.lampOff = put(set, props.floorLamp({ h: 1.7, lit: false }), 6.3, 0, -2.9);
    this.lamp = (this.lampOn.userData.light as THREE.PointLight | undefined) ?? null;
    if (this.lamp) this.lamp.distance = 22;
    put(set, props.pouf({ color: P.mustard, r: 0.36 }), -7.4, 0, 2.9);
    put(set, props.books(0.5, 6, { h: 0.2 }), -6.6, 0, 3.4, 1.2, 1.3);
    put(set, props.sideTable({ h: 0.5, r: 0.28 }), 2.05, 0, 1.2, 0, 1.3);
    put(set, props.mug({ color: P.teal, r: 0.05 }), 2.0, 0.65, 1.25, 0.5, 1.5);
    return props.tickProps(set);
  }

  /** Room lights: 1 = cosy evening, 0 = lights out (the torch does the rest). */
  lights(k: number): void {
    this.dark = 1 - k;
    for (const d of this.dimmed) d.light.intensity = d.base * (d.low + (1 - d.low) * k);
    this.env.sun.color.copy(this.sunCold).lerp(this.sunWarm, k);
    if (this.lamp) this.lamp.intensity = LAMP * k;
    if (this.lampOn) this.lampOn.visible = k > 0.5;
    if (this.lampOff) this.lampOff.visible = k <= 0.5;
    (this.scene.background as THREE.Color).copy(this.bgCold).lerp(this.bgWarm, k);
    setGrade(this.scene, k > 0.5 ? 'cosy' : 'night');
    setLook(this.scene, { outline: 0.4 + 0.3 * k });
  }

  /** A little burst of sparks in a seat's colour (someone is found). */
  private burst(x: number, y: number, z: number, color: string): void {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + Math.random();
      const m = part(this.scene, gem(0.05), color, x, y, z, { glow: 2, outline: false, shadow: false });
      this.sparks.push({ m, v: new THREE.Vector3(Math.cos(a) * (0.8 + Math.random()), 1.8 + Math.random() * 1.4, Math.sin(a) * (0.8 + Math.random())), age: 0 });
    }
  }

  /** The hiders slip away into the dark. */
  hideAll(): void {
    for (const h of this.hiders) {
      const c = this.companions[h];
      if (c) c.root.visible = false;
    }
  }

  /** Shows a hider standing by their spot (found, or at the end). */
  showAt(seat: number, spot: number, slot: number, of: number, mood: 'happy' | 'sleeping' | 'sad'): void {
    const c = this.companions[seat];
    if (!c) return;
    const [x, z] = POP[spot] ?? [0, 0];
    const ox = (slot - (of - 1) / 2) * 0.85;
    c.root.position.set(x + ox, 0, z);
    c.root.rotation.set(0, 0, 0);
    c.root.visible = true;
    c.setBase(mood);
    this.pops.set(seat, { age: 0 });
    this.burst(x + ox, HEIGHT * 0.7, z, this.seats[seat]?.color ?? P.lamp);
    if (!this.cards.has(seat)) {
      const card = nameCard(this.seats[seat]?.name ?? '', this.seats[seat]?.color ?? '#ffffff', 0.62);
      this.scene.add(card);
      this.cards.set(seat, card);
    }
    this.cards.get(seat)?.position.set(x + ox, HEIGHT + 0.55, z);
  }

  /** A spot gives a little wobble (searching makes it shake for longer). */
  wobble(spot: number, amount: number): void {
    this.shake[spot] = Math.max(this.shake[spot] ?? 0, amount);
  }

  /** The rustle's word, drifting up from the side of the room it came from. */
  rustleAt(column: number): void {
    this.floaters.add('rustle…', P.moon, new THREE.Vector3(column * 7, 1.6, -0.9), 0.38, 1.3);
  }

  sync(h: House): void {
    roomPoint(h.beam.x, h.beam.y, this.target);
    const seeker = this.companions[this.seeker];
    if (seeker && this.beamOn) {
      const dx = this.target.x - SEEKER.x;
      const dz = this.target.z - SEEKER.z;
      seeker.root.rotation.y = Math.atan2(dx, dz);
    }
    if (h.search) this.wobble(h.search.spot, 0.7);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const card of this.cards.values()) {
      card.material.map?.dispose();
      card.material.dispose();
    }
    this.floaters.dispose();
    this.coneMat.dispose();
    this.cone.geometry.dispose();
    for (const k of this.sparks) k.m.removeFromParent();
    this.torch.dispose();
  }

  private marks(): Mark[] {
    return [
      { p: new THREE.Vector3(-5.9, 0, 2.6), pad: 0.05 },
      { p: new THREE.Vector3(-5.6, 3.9, -3.4) },
      { p: new THREE.Vector3(0, 3.7, -3.4) },
      { p: new THREE.Vector3(5.6, 1.4, -3.2) },
      { p: new THREE.Vector3(5.9, 0, 2.6) },
      { p: new THREE.Vector3(SEEKER.x, HEIGHT + 0.8, SEEKER.z), pad: 0.05 },
    ];
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks());
    for (const c of this.companions) c.update(dt);
    this.floaters.update(dt);
    this.env.update(dt, this.time);
    this.tick(dt, this.time);
    this.sparks = this.sparks.filter((k) => {
      k.age += dt;
      k.v.y -= dt * 6;
      k.m.position.addScaledVector(k.v, dt);
      k.m.rotation.y += dt * 6;
      k.m.scale.setScalar(Math.max(0.01, 1 - k.age / 0.9));
      if (k.age < 0.9) return true;
      k.m.removeFromParent();
      return false;
    });
    // Searched or rustling spots shake.
    this.spots.forEach((g, i) => {
      const a = this.shake[i] ?? 0;
      g.rotation.z = Math.sin(this.time * 34 + i) * 0.025 * a;
      g.scale.y = 1 + Math.sin(this.time * 21 + i) * 0.02 * a;
      this.shake[i] = Math.max(0, a - dt * 1.6);
    });
    // Found hiders pop up with a hop.
    for (const [seat, p] of this.pops) {
      p.age += dt;
      const c = this.companions[seat];
      if (c) c.root.position.y = p.age < 0.45 ? Math.sin((p.age / 0.45) * Math.PI) * 0.5 : 0;
      if (p.age > 0.5) this.pops.delete(seat);
    }
    // The torch: a spotlight from the seeker's hand onto the room, and a faint beam through the air.
    const seeker = this.companions[this.seeker];
    if (seeker) {
      const yaw = seeker.root.rotation.y;
      this.tip.set(SEEKER.x + Math.sin(yaw) * 0.45, HEIGHT * 0.55, SEEKER.z + Math.cos(yaw) * 0.45);
    }
    const on = this.beamOn;
    this.torch.position.copy(this.tip);
    this.torch.target.position.copy(this.target);
    const len = this.tip.distanceTo(this.target);
    // The torch lights what it points at, and fades out a little way behind it.
    this.torch.decay = 0.4;
    this.torch.distance = len * 2.4;
    this.torch.intensity = on ? 3.4 * len ** 0.4 : 0;
    this.torch.angle = Math.atan(1.45 / Math.max(1, len));
    this.cone.visible = on;
    this.coneMat.opacity = on ? 0.045 : 0;
    if (on) {
      const dir = this.target.clone().sub(this.tip).normalize();
      this.cone.position.copy(this.tip);
      this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      const r = Math.tan(this.torch.angle) * len;
      this.cone.scale.set(r, len, r);
    }
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'hideandsleep',
  title: 'Hide and Sleep',
  how: 'Hiders: pick a secret spot on your phone, and sneak to another once if the torch comes near. Seeker: point your phone like a torch and press Found you! to search. The hiders win if anyone stays hidden.',
  controller: 'aim',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const [side0, side1] = teamsOf(ctx);
    const seeker = side0?.[0] ?? 0;
    const hiders = side1 ?? seats.map((_, i) => i).filter((i) => i !== seeker);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const house = newHouse(seeker, hiders, rng);
    const view = new Bedroom(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), seeker, hiders);
    ctx.stage.setView(view);

    const seekBrain: SeekBrain | null = cpu(seeker) ? newSeekBrain(house, ctx.skill()) : null;
    const hideBrains = new Map<number, HideBrain>(hiders.filter(cpu).map((p) => [p, newHideBrain(ctx.skill())] as const));
    const pickAt = new Map<number, number>(hiders.filter(cpu).map((p) => [p, 0.6 + rng() * 4] as const));
    const seekerName = seats[seeker]?.name ?? 'The seeker';
    const lagOf = (p: number) => Math.min(HIDE.maxLag, (session.seats[seatOf(p)]?.rtt ?? 0) / 2000) * clock.speed;

    // ---- phones
    const hideLayout = (p: number): Layout => {
      const me = hiderOf(house, p);
      const seeking = house.phase === 'seek';
      const known = !!me && (me.picked || seeking);
      const spot = me ? SPOTS[me.spot] : undefined;
      const buttons = SPOTS.map((s, i) => ({ label: s.label, color: known && me?.spot === i ? (seats[p]?.color ?? MUTED) : MUTED }));
      if (!seeking) {
        return {
          kind: 'buttons',
          title: 'Hide!',
          buttons,
          note: 'You’re hiding! Pick a spot (you can change your mind until the count ends).',
          ...(known && spot ? { secret: `You’re ${spot.name}.` } : {}),
        };
      }
      return {
        kind: 'buttons',
        title: 'Shh…',
        buttons,
        note: me?.snuck ? 'No more sneaking. Stay very still…' : 'You’re hiding! Tap another spot to sneak there once, but not while the torch is on you.',
        secret: me?.snuck ? `You snuck ${spot?.name ?? 'away'}.` : `You’re ${spot?.name ?? 'hidden'}.`,
      };
    };
    const updateHider = (p: number) => {
      const me = hiderOf(house, p);
      if (!me) return;
      if (me.caught) {
        session.setLayout(seatOf(p), { kind: 'wait', title: 'Found you!', text: `You were ${SPOTS[me.spot]?.name ?? 'hiding'}. Giggle quietly and root for the others.` });
      } else session.setLayout(seatOf(p), hideLayout(p));
    };
    session.setLayout(seatOf(seeker), { kind: 'wait', title: 'Eyes shut!', text: 'You’re the seeker. Count to ten, and no peeking at anyone’s phone!' });
    for (const p of hiders) updateHider(p);

    let pressed = false;
    let fireDown = false;
    const onSneak = (p: number, to: number) => {
      const me = hiderOf(house, p);
      const from = me?.spot ?? -1;
      const r = sneak(house, p, to, cpu(p) ? 0 : lagOf(p));
      if (r === 'ok') {
        rustle(sfx, rustleColumn(from));
        view.rustleAt(rustleColumn(from));
        updateHider(p);
        if (!cpu(p)) session.send(seatOf(p), { t: 'feedback', good: true, text: `Sneaked ${SPOTS[to]?.name ?? 'away'}!` });
      } else if (!cpu(p)) {
        const text = r === 'lit' ? 'Not now: the torch is on you!' : r === 'used' ? 'You’ve already snuck once. Stay still!' : r === 'same' ? 'You’re already there.' : '';
        if (text) session.send(seatOf(p), { t: 'feedback', good: false, text });
      }
    };
    const off = session.onInput((seat, msg) => {
      const p = posOf.get(seat);
      if (p === undefined || session.isCpu(seat)) return;
      if (p === seeker && msg.t === 'aim') {
        if (house.phase === 'seek') pointTo(house, msg.x, msg.y);
        if (msg.fire && !fireDown) pressed = true;
        fireDown = msg.fire;
      } else if (msg.t === 'press' && hiders.includes(p)) {
        if (house.phase === 'hide') {
          if (pickSpot(house, p, msg.index)) updateHider(p);
        } else onSneak(p, msg.index);
      }
    });

    // ---- lights out, and the count
    ui.caption('Lights out! Hiders, pick a hiding spot on your phone.', seats[hiders[0] ?? seeker]?.color);
    await clock.wait(0.7);
    noise(sfx, { dur: 0.06, filter: 'highpass', freq: 2000, gain: 0.2 });
    await clock.tween(0.6, (k) => view.lights(1 - k));
    view.hideAll();
    let tickAt = 0;
    let counted = 0;
    await everyFrame(clock, (_, t) => {
      for (const [p, at] of pickAt) {
        if (t < at) continue;
        pickAt.delete(p);
        pickSpot(house, p, cpuPick(house, p, hideBrains.get(p) as HideBrain, rng));
      }
      if (t - tickAt >= 1) {
        tickAt = Math.floor(t);
        sfx.tick();
      }
      ui.timer(HIDE.hideTime - t);
      const count = Math.min(10, Math.max(1, Math.ceil((t / HIDE.hideTime) * 10)));
      if (count !== counted) {
        counted = count;
        ui.caption(`${seekerName} is counting… ${count}`, seats[seeker]?.color);
      }
      return t >= HIDE.hideTime;
    });

    // ---- the seek
    startSeek(house);
    for (const p of hiders) {
      updateHider(p);
      const me = hiderOf(house, p);
      if (me && !me.picked && !cpu(p)) session.send(seatOf(p), { t: 'feedback', good: true, text: `We tucked you ${SPOTS[me.spot]?.name ?? 'away'}.` });
    }
    session.setLayout(seatOf(seeker), { kind: 'aim', note: 'You’re the seeker! Point the torch at a hiding spot and press Found you!', button: 'Found you!' });
    pressed = false;
    view.companions[seeker]?.setBase('listening');
    view.beamOn = true;
    sfx.go();
    ui.caption(`Ready or not! ${seekerName} has the torch.`, seats[seeker]?.color);

    let hudAt = -1;
    let rummageAt = 0;
    await everyFrame(clock, (dt) => {
      // The seeker: a computer's pointer, or the phone's (already set by its messages).
      let fire = false;
      if (seekBrain) {
        const a = cpuSeek(house, seekBrain, rng, dt);
        pointTo(house, a.x, a.y);
        fire = a.fire;
      } else {
        fire = pressed;
        pressed = false;
      }
      if (fire) {
        const r = press(house);
        if (r === -1 && !seekBrain) session.send(seatOf(seeker), { t: 'feedback', good: false, text: 'Point the torch at a hiding spot first.' });
        if (r !== null && r >= 0) {
          rummage(sfx);
          view.companions[seeker]?.react('working', HIDE.search);
        }
      }
      for (const [p, b] of hideBrains) {
        const to = cpuSneak(house, p, b, rng);
        if (to !== null) onSneak(p, to);
      }
      const n = Math.max(1, Math.ceil(dt / (1 / 60)));
      for (let i = 0; i < n && !isOver(house); i++) {
        const ev = stepHouse(house, dt / n);
        if (!ev.searched) continue;
        const { spot, found } = ev.searched;
        const where = SPOTS[spot]?.name ?? '';
        if (found.length) {
          giggle(sfx);
          found.forEach((p, k) => {
            view.showAt(p, spot, k, found.length, 'happy');
            view.floaters.add(`Found ${seats[p]?.name ?? ''}!`, seats[p]?.color ?? '#ffffff', new THREE.Vector3((POP[spot]?.[0] ?? 0) + (k - (found.length - 1) / 2) * 0.85, HEIGHT + 0.9, POP[spot]?.[1] ?? 0), 0.5);
            updateHider(p);
            session.send(seatOf(p), { t: 'buzz', pattern: [60, 40, 60] });
          });
          view.companions[seeker]?.react('happy', 1.2);
          if (!seekBrain) {
            session.send(seatOf(seeker), { t: 'feedback', good: true, text: `Found ${found.map((p) => seats[p]?.name ?? '').join(' and ')} ${where}!` });
            session.send(seatOf(seeker), { t: 'buzz', pattern: [30, 30, 30] });
          }
        } else {
          nobody(sfx);
          const [x, z] = POP[spot] ?? [0, 0];
          view.floaters.add('Nobody…', '#c9c4e8', new THREE.Vector3(x, 1.6, z), 0.42);
          if (!seekBrain) session.send(seatOf(seeker), { t: 'feedback', good: false, text: `Nobody ${where}.` });
        }
      }
      if (house.search && house.time - rummageAt > 0.35) {
        rummageAt = house.time;
        rummage(sfx);
      }
      view.sync(house);
      if (house.time - hudAt > 0.1) {
        hudAt = house.time;
        ui.timer(HIDE.seekTime - house.time);
        const found = hiders.length - hiddenCount(house);
        ui.live(
          seats.map((s, p) => {
            const me = hiderOf(house, p);
            const value = p === seeker ? `Seeker · found ${found} of ${hiders.length}` : me ? (me.caught ? 'Found!' : 'Hiding') : '';
            return { name: s.name, color: s.color, thumb: s.thumb, value };
          }),
        );
      }
      return isOver(house);
    });
    off();
    ui.timer(null);

    // ---- the reveal: the torch goes off, the lights come on, everyone still hidden pops out
    view.beamOn = false;
    const left = house.hiders.filter((x) => !x.caught);
    const bySpot = new Map<number, number[]>();
    for (const x of left) bySpot.set(x.spot, [...(bySpot.get(x.spot) ?? []), x.seat]);
    await clock.tween(0.5, (k) => view.lights(k));
    for (const [spot, group] of bySpot) group.forEach((p, k) => view.showAt(p, spot, k, group.length, 'happy'));
    if (left.length) {
      sfx.win();
      const names = left.map((x) => seats[x.seat]?.name ?? '').join(' and ');
      ui.caption(`${names} stayed hidden! The hiders win.`, seats[left[0]?.seat ?? 0]?.color);
      view.companions[seeker]?.setBase('sad');
      for (const x of house.hiders) if (x.caught) view.companions[x.seat]?.setBase('happy');
    } else {
      sfx.fanfare();
      ui.caption(`${seekerName} found everyone!`, seats[seeker]?.color);
      view.companions[seeker]?.setBase('happy');
      for (const x of house.hiders) view.companions[x.seat]?.setBase('sleeping');
    }
    for (const s of seats) session.send(s.index, { t: 'buzz', pattern: [40, 30, 120] });
    await clock.wait(2.2);
    ui.caption(null);

    const found = hiders.length - hiddenCount(house);
    return {
      scores: hideScores(house, seats.length),
      details: seats.map((_, p) => {
        if (p === seeker) return `Found ${found} of ${hiders.length} in ${house.checks} search${house.checks === 1 ? '' : 'es'}`;
        const me = hiderOf(house, p);
        if (!me) return '';
        const where = SPOTS[me.spot]?.name ?? '';
        return me.caught ? `Found ${where} at ${(me.caughtAt ?? 0).toFixed(1)} s` : `Stayed hidden ${where}`;
      }),
    };
  },
};
