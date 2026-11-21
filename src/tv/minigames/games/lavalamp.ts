// Lava Lamp Says on the TV: a dim den at night, fairy lights, everyone sunk into a beanbag around a big lava
// lamp. Blobs of four colours light up one after another, each with its own soft tone; everyone repeats the
// sequence on their phone at the same time. A wrong colour and your companion dozes off on the beanbag.
import * as THREE from 'three';
import { LAVA, type CpuAnswer, type Rememberer, cpuAnswer, cpuSpan, grow, lavaScores, longest, newRememberer, press, startRound, startSequence, stepGap, timeUp } from '../../../game/minigames/lavalamp';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, lanes, tone } from '../kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import type { TextureName } from '../../render/textures';
import { PALETTE as P, ball, box, canvasTexture, cyl, gem, lathe, material, mix, part, toonMat, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

/** The blobs, in the order of the phone buttons: a name, a colour and a note each. */
const BLOBS = [
  { name: 'Pink', color: '#ff5fa2', freq: 330 },
  { name: 'Orange', color: '#ffa23a', freq: 392 },
  { name: 'Teal', color: '#2ec4b6', freq: 494 },
  { name: 'Violet', color: '#9a7bff', freq: 587 },
] as const;

const HEIGHT = 1.45; // companions
const SINK = 0.5; // where they sit, sunk into the beanbag
const LAMP = new THREE.Vector3(0, 0, -0.7);
const GLASS_BOTTOM = 1.15;
const GLASS_TOP = 3.95;
const PIP_EMPTY = mix(P.plum, P.moon, 0.22);
const K = 1.8; // the den is built big around the lamp: props at this scale
const BACK = -3.6; // the back wall's face (z)
const WALL_COLOR = mix(P.plum, P.aubergine, 0.35);
const METAL = mix(P.brass, P.copper, 0.3);

interface ShellOptions {
  w: number;
  h: number;
  /** z of the back wall's face and of the open front. */
  back: number;
  front: number;
  wall: string;
  floor: string;
  floorTex?: TextureName;
  /** The set's scale next to the 1 m props (texture tiles and trims grow with it). */
  k?: number;
  /** Height of the darker lower part of the walls (0 = none). */
  dado?: number;
}

/** The room's shell: floorboards, a plastered back wall and side walls with a dado and skirting, open to the camera. */
function roomShell(root: THREE.Object3D, o: ShellOptions): void {
  const k = o.k ?? 1;
  const d = o.front - o.back;
  const zc = (o.front + o.back) / 2;
  const quiet = { outline: false as const, shadow: false };
  const wall = { tex: 'plaster' as TextureName, texScale: 2.6 * k, texStrength: 0.9, ...quiet };
  const trim = mix(o.wall, P.cream, 0.45);
  part(root, box(o.w + 1, 0.3, d + 1), o.floor, 0, -0.15, zc, { tex: o.floorTex ?? 'woodFloor', texScale: 2.2 * k, ...quiet });
  part(root, box(o.w + 1, o.h, 0.4), o.wall, 0, o.h / 2, o.back - 0.2, wall);
  for (const s of [-1, 1]) part(root, box(0.4, o.h, d + 1), mix(o.wall, P.ink, 0.1), s * (o.w / 2 + 0.2), o.h / 2, zc, wall);
  const dado = o.dado ?? 0;
  if (dado > 0) {
    const low = mix(o.wall, P.ink, 0.24);
    part(root, box(o.w, dado, 0.04), low, 0, dado / 2, o.back + 0.02, wall);
    for (const s of [-1, 1]) part(root, box(0.04, dado, d), mix(low, P.ink, 0.1), s * (o.w / 2 - 0.02), dado / 2, zc, wall);
    part(root, box(o.w, 0.06 * k, 0.06 * k), trim, 0, dado, o.back + 0.05, quiet);
    for (const s of [-1, 1]) part(root, box(0.06 * k, 0.06 * k, d), trim, s * (o.w / 2 - 0.05), dado, zc, quiet);
  }
  part(root, box(o.w, 0.14 * k, 0.05 * k), trim, 0, 0.07 * k, o.back + 0.03 * k, quiet);
  for (const s of [-1, 1]) part(root, box(0.05 * k, 0.14 * k, d), trim, s * (o.w / 2 - 0.03 * k), 0.07 * k, zc, quiet);
}

/** Puts a prop into the set at `k` times its size. */
function put<T extends THREE.Object3D>(root: THREE.Object3D, o: T, x: number, y: number, z: number, ry = 0, k = 1): T {
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.scale.setScalar(k);
  root.add(o);
  return o;
}

interface Spark {
  m: THREE.Mesh;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

/** Little glowing sparkles that fly out, fall a bit and fade: for votes, right answers and winners. */
class Sparkles {
  private list: Spark[] = [];
  constructor(private readonly scene: THREE.Scene) {}

  burst(at: THREE.Vector3, color: string, n = 8, speed = 1.4): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const up = Math.random() * 0.8 + 0.5;
      const m = part(this.scene, gem(0.06), i % 2 ? color : P.lamp, at.x, at.y, at.z, { glow: 1.8, outline: false, shadow: false });
      this.list.push({ m, v: new THREE.Vector3(Math.cos(a) * speed * (0.5 + Math.random() * 0.5), up * speed, Math.sin(a) * speed * 0.4), age: 0, life: 0.6 + Math.random() * 0.4, size: 0.6 + Math.random() * 0.7 });
    }
  }

  update(dt: number): void {
    this.list = this.list.filter((sp) => {
      sp.age += dt;
      sp.v.y -= dt * 3.2;
      sp.m.position.addScaledVector(sp.v, dt);
      sp.m.rotation.y += dt * 7;
      sp.m.scale.setScalar(Math.max(0.001, sp.size * (1 - sp.age / sp.life)));
      if (sp.age < sp.life) return true;
      this.scene.remove(sp.m);
      return false;
    });
  }

  dispose(): void {
    for (const sp of this.list) this.scene.remove(sp.m);
    this.list = [];
  }
}

/** The lamp's note for a colour: soft and round. */
function note(sfx: Sfx, c: number, dur: number): void {
  const f = BLOBS[c]?.freq ?? 440;
  tone(sfx, { freq: f, dur: dur + 0.15, type: 'sine', gain: 0.13 });
  tone(sfx, { freq: f / 2, dur: dur + 0.1, type: 'triangle', gain: 0.05 });
}

interface Blob {
  mesh: THREE.Mesh;
  base: number;
  speed: number;
  phase: number;
  litAt: number;
  litFor: number;
}

interface Seat3d {
  companion: Companion;
  home: THREE.Vector3;
  side: number;
  pips: THREE.Group;
  /** 0 awake … 1 slumped asleep. */
  slump: number;
  asleep: boolean;
  zAt: number;
  /** How many pips are filled, and when the last one filled (it pops). */
  filled: number;
  popAt: number;
}

class Den implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  readonly seats3d: Seat3d[] = [];
  private readonly blobs: Blob[] = [];
  private readonly fit = new CameraFit(this.camera, 0.2);
  private readonly marks: Mark[] = [];
  private readonly glow: THREE.PointLight;
  private readonly liquid: THREE.MeshToonMaterial;
  private readonly fairy: THREE.Object3D[] = [];
  private readonly sparkles = new Sparkles(this.scene);
  private readonly haloTexture = canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  private readonly haloMat = new THREE.MeshBasicMaterial({ map: this.haloTexture, color: '#ff9fd0', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  private tick: (dt: number, time: number) => void = () => {};
  private lit = -1;
  private litAt = -9;
  private litFor = 0.4;
  /** During the playback the blobs that aren't lit go dim. */
  dimOthers = false;
  private time = 0;

  constructor(
    readonly seats: MinigameSeat[],
    people: Companion[],
  ) {
    // Lights low: a cool dim key, and the lamp does the rest.
    const rig = lightRig(this.scene, 'nightInterior', { shadowSize: 9, fog: { near: 34, far: 90 } });
    rig.sun.target.position.set(0, 0, 0.5);
    rig.sun.intensity = 0.75;
    this.glow = new THREE.PointLight('#ff9fd0', 9, 16, 1.4);
    this.glow.position.set(LAMP.x, 2.6, LAMP.z + 0.9);
    this.scene.add(this.glow);
    this.liquid = toonMat({ color: '#ffd0e8', transparent: true, opacity: 0.24, depthWrite: false, emissive: new THREE.Color('#ff8fc8'), emissiveIntensity: 0.45 });
    this.buildRoom();
    this.buildLamp();

    const n = seats.length;
    const xs = lanes(n, 2.2).map((x) => x + (x < 0 || (x === 0 && n > 1) ? -1.15 : 1.15));
    seats.forEach((s, i) => {
      const x = xs[i] ?? 0;
      const side = x < 0 ? -1 : 1;
      const z = 1.5 - Math.abs(x) * 0.13;
      // The beanbag: velvet in a deep shade of the player's colour, with the colour itself on the piping.
      const bag = mix(s.color, P.aubergine, 0.4);
      const velvet = { tex: 'velvet' as TextureName, texScale: 1.2, texStrength: 0.8 };
      part(this.scene, ball(0.95, 3), bag, x, 0.46, z, { sx: 1.1, sy: 0.45, sz: 1.0, ...velvet });
      part(this.scene, ball(0.5, 2), mix(bag, '#ffffff', 0.06), x, 0.8, z - 0.55, { sx: 1.45, sy: 0.95, sz: 0.62, ...velvet });
      part(this.scene, torus(1.0, 0.035), s.color, x, 0.42, z, { rx: Math.PI / 2, sx: 1.07, glow: 0.7, outline: false, shadow: false });
      const c = people[i] as Companion;
      const home = new THREE.Vector3(x, SINK, z + 0.3);
      c.root.position.copy(home);
      c.root.rotation.y = -side * 0.32;
      this.scene.add(c.root);
      const pips = new THREE.Group();
      pips.position.set(x, SINK + HEIGHT + 0.42, home.z);
      this.scene.add(pips);
      this.seats3d.push({ companion: c, home, side, pips, slump: 0, asleep: false, zAt: 0, filled: 0, popAt: -9 });
      this.marks.push({ p: new THREE.Vector3(x, 0, z + 1.0) }, { p: new THREE.Vector3(x, SINK + HEIGHT + 0.5, z), pad: 0.06 });
    });
    this.marks.push({ p: new THREE.Vector3(LAMP.x, GLASS_TOP + 0.75, LAMP.z), pad: 0.03 }, { p: new THREE.Vector3(LAMP.x, 0, LAMP.z + 1.2) });
    this.fit.update(() => this.marks);
  }

  private buildRoom(): void {
    const s = this.scene;
    const root = new THREE.Group();
    s.add(root);
    roomShell(root, { w: 26, h: 11, back: BACK, front: 12, wall: WALL_COLOR, floor: P.walnut, k: K, dado: 1.9 });
    // A big round woolly rug under the lamp.
    const rugAt = LAMP.z + 1.2;
    const wool = { tex: 'knit' as TextureName, texScale: 1.1, outline: false as const, shadow: false };
    part(root, cyl(3.5, 3.5, 0.04, 56), mix(P.mauve, P.cream, 0.35), LAMP.x, 0.02, rugAt, wool);
    part(root, cyl(3.2, 3.2, 0.04, 56), mix(P.mauve, P.plum, 0.35), LAMP.x, 0.03, rugAt, wool);
    part(root, cyl(1.7, 1.7, 0.04, 48), mix(P.mauve, P.plum, 0.6), LAMP.x, 0.038, rugAt, wool);

    // Back wall: the night in the window, curtains, pictures, books, a plant in the corner.
    put(root, props.windowFrame({ w: 1.4, h: 1.25, time: 'night', seed: 3 }), 5.1, 4.3, BACK + 0.02, 0, K);
    put(root, props.curtains({ w: 1.4, h: 1.25, color: mix(P.teal, P.aubergine, 0.3) }), 5.1, 4.3, BACK + 0.02, 0, K);
    put(root, props.pictureFrame({ w: 0.8, h: 1.0, art: 'moon', frame: P.walnut, seed: 4 }), -4.4, 4.5, BACK + 0.02, 0, K);
    put(root, props.pictureFrame({ w: 0.45, h: 0.55, art: 'shapes', frame: P.brass, seed: 9 }), -2.6, 5.0, BACK + 0.02, 0, K);
    put(root, props.pictureFrame({ w: 0.45, h: 0.4, art: 'leaf', frame: P.charcoal, seed: 12 }), -2.6, 3.95, BACK + 0.02, 0, K);
    put(root, props.bookshelf({ w: 1.3, h: 2.0, seed: 7 }), -8.3, 0, BACK + 0.4, 0, K);
    put(root, props.plant({ kind: 'ficus', h: 1.9, pot: P.ceramic, seed: 4 }), 8.6, 0, BACK + 1.1, 0, K);
    put(root, props.plant({ kind: 'monstera', h: 1.0, seed: 6 }), -5.9, 0, BACK + 1.0, 0, K);
    put(root, props.speaker({ h: 0.9 }), 7.0, 0, BACK + 0.6, -0.15, K);
    put(root, props.guitar(), 2.6, 0, BACK + 0.5, 0, K);
    const side = put(root, props.sideTable({ h: 0.5 }), -6.9, 0, 0.3, 0, K);
    put(side, props.candle({ h: 0.12 }), 0.08, 0.5, 0.04);
    put(side, props.mug({ color: P.terracotta }), -0.1, 0.5, 0.02, 0.8);
    // Fairy lights sagging across the wall: they twinkle.
    const lights = [P.lamp, mix(P.rose, P.lamp, 0.3), P.moon];
    for (let k = 0; k < 4; k++) {
      const x0 = -12 + k * 6;
      const string = props.stringLights(new THREE.Vector3(x0, 5.95, BACK + 0.12), new THREE.Vector3(x0 + 6, 5.95, BACK + 0.12), { sag: 0.22, count: 9, colors: lights, bulb: 0.07 });
      root.add(string);
      this.fairy.push(...string.children.slice(1));
    }
    // Foreground, low in the corners: a pouf with snacks nearby, cushions on the other side.
    put(root, props.pouf({ color: P.teal, r: 0.4 }), -7.6, 0, 4.4, 0, K);
    put(root, props.snackBowl({ fill: 'popcorn', color: P.ceramic }), -5.6, 0, 4.9, 0, K);
    put(root, props.drink({ color: P.mustard }), -4.9, 0, 5.2, 0, K);
    put(root, props.pouf({ color: P.mustard, r: 0.36, h: 0.2 }), 7.9, 0, 4.6, 0, K);
    put(root, props.pouf({ color: P.rose, r: 0.3, h: 0.18 }), 7.4, 0.36, 4.5, 0, K);
    const dust = props.motes({ n: 20, area: [12, 4, 5], color: '#ffb7dc', size: 0.06 });
    dust.position.set(0, 0.8, 0.5);
    root.add(dust);
    this.tick = props.tickProps(root);
  }

  private buildLamp(): void {
    const s = this.scene;
    const g = new THREE.Group();
    g.position.copy(LAMP);
    s.add(g);
    // Base and cap: spun metal, warm and a little glossy, with turned rings.
    const metal = { gloss: 0.65 };
    part(g, cyl(1.05, 1.1, 0.07, 40), P.walnut, 0, 0.035, 0, { tex: 'wood' });
    part(g, lathe([[0, 0.07], [0.86, 0.07], [0.84, 0.16], [0.52, 0.95], [0.43, 1.15], [0.5, 1.2], [0.5, 1.27], [0, 1.27]], 36), METAL, 0, 0, 0, metal);
    part(g, torus(0.62, 0.035), mix(METAL, '#ffffff', 0.25), 0, 0.72, 0, { rx: Math.PI / 2, outline: false, gloss: 0.8 });
    part(g, torus(0.85, 0.03), mix(METAL, P.ink, 0.3), 0, 0.1, 0, { rx: Math.PI / 2, outline: false });
    part(g, lathe([[0, GLASS_TOP - 0.02], [0.41, GLASS_TOP - 0.02], [0.4, GLASS_TOP + 0.06], [0.29, GLASS_TOP + 0.56], [0.2, GLASS_TOP + 0.68], [0, GLASS_TOP + 0.7]], 32), METAL, 0, 0, 0, metal);
    // The glass: a lathe, with glowing liquid inside it.
    const profile = [
      [0.46, GLASS_BOTTOM],
      [0.6, 1.5],
      [0.74, 2.25],
      [0.7, 2.95],
      [0.54, 3.55],
      [0.38, GLASS_TOP],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const glass = new THREE.LatheGeometry(profile, 36);
    const inner = new THREE.LatheGeometry(
      profile.map((p) => new THREE.Vector2(p.x * 0.94, p.y)),
      36,
    );
    const liquid = new THREE.Mesh(inner, this.liquid);
    liquid.renderOrder = 2;
    g.add(liquid);
    const shell = new THREE.Mesh(glass, toonMat({ color: '#fff0fa', transparent: true, opacity: 0.16, depthWrite: false }, { gloss: 0.9 }));
    shell.renderOrder = 3;
    g.add(shell);
    // A long highlight down the glass, and a soft halo of light around the lamp.
    part(g, cyl(0.02, 0.02, 1.5, 6), '#ffffff', -0.5, 2.5, 0.4, { basic: true, opacity: 0.35, rz: -0.06, outline: false, shadow: false }).renderOrder = 4;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 7.5), this.haloMat);
    halo.position.set(0, 2.55, -0.5);
    halo.scale.set(0.85, 1.1, 1);
    halo.renderOrder = 1;
    g.add(halo);
    BLOBS.forEach((b, i) => {
      const mesh = part(g, ball(0.3, 3), b.color, 0, 2.5, 0, { glow: 0.45, shadow: false, outline: false });
      this.blobs.push({ mesh, base: 1.75 + i * 0.45, speed: 0.33 + i * 0.07, phase: i * 1.7, litAt: -9, litFor: 0 });
    });
  }

  /** Lights one blob for `seconds`. */
  light(c: number, seconds: number): void {
    const b = this.blobs[c];
    if (!b) return;
    b.litAt = this.time;
    b.litFor = seconds;
    this.lit = c;
    this.litAt = this.time;
    this.litFor = seconds;
    this.floaters.add(BLOBS[c]?.name ?? '', BLOBS[c]?.color ?? '#ffffff', new THREE.Vector3(LAMP.x + 1.35, 3.2, LAMP.z + 0.9), 0.42, 0.9);
  }

  /** A row of pips over a companion: one per colour this round, filled as they get them right. */
  setPips(i: number, count: number, filled: number, color: string): void {
    const s = this.seats3d[i];
    if (!s) return;
    while (s.pips.children.length > count) s.pips.remove(s.pips.children[s.pips.children.length - 1] as THREE.Object3D);
    while (s.pips.children.length < count) part(s.pips, ball(0.075, 1), PIP_EMPTY, 0, 0, 0, { outline: false, shadow: false });
    const gap = Math.min(0.2, 1.5 / Math.max(1, count));
    s.pips.children.forEach((p, k) => {
      p.position.x = (k - (count - 1) / 2) * gap;
      (p as THREE.Mesh).material = material(k < filled ? color : PIP_EMPTY, k < filled ? { glow: 0.9 } : {});
      // the pip that just filled pops
      if (k === filled - 1 && s.filled !== filled) s.popAt = this.time;
      p.userData.pop = k === filled - 1;
    });
    s.filled = filled;
  }

  doze(i: number): void {
    const s = this.seats3d[i];
    if (!s || s.asleep) return;
    s.asleep = true;
    s.zAt = this.time + 0.6;
    s.companion.setBase('sleeping');
    s.pips.visible = false;
  }

  /** Sparkles over a companion (the whole sequence right). */
  celebrate(i: number, color: string): void {
    const s = this.seats3d[i];
    if (s) this.sparkles.burst(new THREE.Vector3(s.home.x, SINK + HEIGHT + 0.3, s.home.z + 0.2), color, 10);
  }

  dispose(): void {
    for (const s of this.seats3d) s.companion.dispose();
    this.floaters.dispose();
    this.sparkles.dispose();
    this.haloMat.dispose();
    this.haloTexture.dispose();
    this.liquid.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.fit.update(() => this.marks);
    // The blobs drift up and down; a lit one swells and glows, the others go dim during the playback.
    this.blobs.forEach((b, i) => {
      const y = b.base + Math.sin(time * b.speed + b.phase) * 0.62;
      const r = 0.42 + 0.22 * Math.sin(((y - GLASS_BOTTOM) / (GLASS_TOP - GLASS_BOTTOM)) * Math.PI);
      b.mesh.position.set(Math.sin(time * 0.37 + i * 2.1) * (r - 0.3) * 0.8, y, Math.cos(time * 0.29 + i) * 0.08);
      const age = time - b.litAt;
      const on = age >= 0 && age < b.litFor;
      const swell = on ? 1.45 - 0.2 * Math.min(1, age / b.litFor) : 1;
      const wobble = Math.sin(time * 1.3 + i) * 0.1;
      b.mesh.scale.set(swell * (1 - wobble * 0.5), swell * (1 + wobble), swell * (1 - wobble * 0.5));
      const color = BLOBS[i]?.color ?? '#ffffff';
      b.mesh.material = on ? material(color, { glow: 1.8 }) : this.dimOthers ? material(mix(color, P.aubergine, 0.5), { glow: 0.12 }) : material(color, { glow: 0.45 });
    });
    // The lamp's light takes the lit blob's colour for a moment.
    const age = time - this.litAt;
    const k = this.lit >= 0 && age < this.litFor + 0.4 ? Math.max(0, 1 - Math.max(0, age - this.litFor) / 0.4) : 0;
    this.glow.color.set(k > 0 ? (BLOBS[this.lit]?.color ?? '#ff9fd0') : '#ff9fd0');
    this.glow.intensity = (9 + 14 * k) * (1 + Math.sin(time * 0.9) * 0.04);
    this.haloMat.color.copy(this.glow.color);
    this.haloMat.opacity = 0.26 + 0.2 * k;
    this.liquid.emissiveIntensity = 0.35 + 0.5 * k;
    this.liquid.emissive.set(k > 0 ? (BLOBS[this.lit]?.color ?? '#ff8fc8') : '#ff8fc8');
    this.fairy.forEach((f, i) => f.scale.setScalar(1 + Math.sin(time * 1.7 + i * 1.3) * 0.22));
    this.tick(dt, time);
    this.sparkles.update(dt);
    for (const s of this.seats3d) {
      const pop = time - s.popAt;
      for (const pip of s.pips.children) pip.scale.setScalar(pip.userData.pop === true && pop < 0.3 ? 1 + Math.sin((pop / 0.3) * Math.PI) * 0.7 : 1);
      s.companion.update(dt);
      s.slump = s.asleep ? Math.min(1, s.slump + dt * 1.5) : Math.max(0, s.slump - dt * 3);
      s.companion.root.rotation.z = s.side * 0.22 * s.slump;
      s.companion.root.position.y = s.home.y - 0.12 * s.slump;
      if (s.asleep && time >= s.zAt) {
        s.zAt = time + 1.4;
        this.floaters.add('z', '#cfc6ff', s.home.clone().add(new THREE.Vector3(s.side * 0.45, HEIGHT + 0.2, 0.2)), 0.42, 1.6);
      }
    }
    this.floaters.update(dt);
  }
}

export const minigame: Minigame = {
  id: 'lavalamp',
  title: 'Lava Lamp Says',
  how: 'Watch the blobs in the lava lamp light up, then press the same colours on your phone, in order. Every round adds one more. One wrong colour and you doze off: stay awake the longest to win!',
  controller: 'buttons',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const view = new Den(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    const players = seats.map(() => newRememberer());
    const skills: (number | null)[] = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : null));
    const spans = skills.map((k) => (k === null ? 0 : cpuSpan(rng, k)));
    let seq = startSequence(rng);
    let answering = false;
    let now = 0;
    const live = () =>
      ui.live(
        seats.map((s, i) => {
          const p = players[i] as Rememberer;
          const got = longest(p);
          return { name: s.name, color: s.color, thumb: s.thumb, value: `${p.out ? 'Asleep' : 'Awake'}${got ? ` · ${got} colours` : ''}` };
        }),
      );
    const doze = (i: number, text: string) => {
      view.doze(i);
      session.setLayout(i, { kind: 'wait', title: 'Zzz…', text: `${text} Your companion is having a nap on the beanbag.` });
      session.send(i, { t: 'buzz', pattern: [180] });
      tone(sfx, { freq: 392, to: 196, dur: 0.6, type: 'triangle', gain: 0.07 });
      live();
    };
    const answer = (i: number, color: number, t: number) => {
      const p = players[i] as Rememberer;
      const seat = seats[i] as MinigameSeat;
      if (t > LAVA.answerTime) return;
      const result = press(p, seq, color, t);
      if (result === 'ignored') return;
      view.setPips(i, seq.length, result === 'wrong' ? 0 : p.at, seat.color);
      if (result === 'wrong') {
        session.send(i, { t: 'feedback', good: false, text: `Oops, that was ${BLOBS[seq[p.partial] ?? 0]?.name ?? 'another one'}.` });
        doze(i, 'Wrong colour.');
      } else if (result === 'done') {
        session.setLayout(i, { kind: 'wait', title: 'Got it!', text: 'Still awake. The next one is a colour longer…' });
        view.seats3d[i]?.companion.react('happy', 1.2);
        view.celebrate(i, seat.color);
        tone(sfx, { freq: 784, dur: 0.18, type: 'sine', gain: 0.05 });
        tone(sfx, { freq: 1046, dur: 0.25, type: 'sine', gain: 0.05, delay: 0.08 });
      }
    };
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'press' || !answering || seat >= n || session.isCpu(seat)) return;
      answer(seat, msg.index, Math.max(0, now - (session.seats[seat]?.rtt ?? 0) / 2000));
    });
    live();

    for (let round = 0; round < LAVA.rounds; round++) {
      const awake = seats.map((_, i) => i).filter((i) => !players[i]?.out);
      if (!awake.length || (round > 0 && n > 1 && awake.length <= 1)) break;
      players.forEach(startRound);

      // 1. Watch the lamp.
      for (const i of awake) {
        session.setLayout(i, { kind: 'wait', title: 'Watch the lamp…', text: `Round ${round + 1}: ${seq.length} colours. Remember them!` });
        view.seats3d[i]?.companion.setBase('listening');
        view.setPips(i, seq.length, 0, seats[i]?.color ?? '#fff');
      }
      ui.caption(`Round ${round + 1}: watch the lamp… ${seq.length} colours`);
      await clock.wait(0.7);
      view.dimOthers = true;
      const gap = stepGap(round);
      for (const c of seq) {
        view.light(c, gap * 0.72);
        note(sfx, c, gap * 0.72);
        await clock.wait(gap);
      }
      view.dimOthers = false;
      await clock.wait(0.2);

      // 2. Everyone repeats it at once.
      const plans: (CpuAnswer | null)[] = seats.map((_, i) => {
        if (!awake.includes(i) || !session.isCpu(i)) return null;
        if (skills[i] == null) {
          // Their phone went away: the computer takes over.
          skills[i] = ctx.skill();
          spans[i] = cpuSpan(rng, skills[i] ?? 0.5);
        }
        return cpuAnswer(rng, seq, spans[i] ?? 3, skills[i] ?? 0.5);
      });
      const sent = seats.map(() => 0);
      for (const i of awake) {
        session.setLayout(i, {
          kind: 'buttons',
          title: 'Your turn!',
          buttons: BLOBS.map((b) => ({ label: b.name, color: b.color })),
          note: `Round ${round + 1}: all ${seq.length} colours, in order.`,
        });
        view.seats3d[i]?.companion.setBase('thinking');
      }
      ui.caption('Your turn! Press the colours on your phone, in order.');
      tone(sfx, { freq: 523, dur: 0.12, type: 'sine', gain: 0.06 });
      answering = true;
      now = 0;
      let hudAt = -1;
      await everyFrame(clock, (_, t) => {
        now = t;
        plans.forEach((plan, i) => {
          if (!plan) return;
          while ((sent[i] ?? 0) < plan.times.length && (plan.times[sent[i] ?? 0] as number) <= t) {
            answer(i, plan.presses[sent[i] ?? 0] as number, plan.times[sent[i] ?? 0] as number);
            sent[i] = (sent[i] ?? 0) + 1;
          }
        });
        if (t - hudAt > 0.2) {
          hudAt = t;
          ui.timer(LAVA.answerTime - t);
        }
        return t >= LAVA.answerTime + 0.15 || awake.every((i) => players[i]?.done);
      });
      answering = false;
      ui.timer(null);
      for (const i of awake) if (timeUp(players[i] as Rememberer)) doze(i, 'Out of time.');
      live();
      const still = players.filter((p) => !p.out).length;
      ui.caption(still ? `${still} still awake.` : 'Everyone dozed off…');
      await clock.wait(1.2);
      seq = grow(rng, seq);
    }
    off();

    // Whoever is still awake wins; if several made it to the end, the quickest answers.
    const scores = lavaScores(players);
    const best = Math.max(...scores);
    const winners = seats.filter((_, i) => scores[i] === best);
    const awake = seats.filter((_, i) => !players[i]?.out);
    const top = winners[0];
    if (awake.length === 1 && top) ui.caption(`${top.name} is the last one awake!`, top.color);
    else if (awake.length > 1 && top) ui.caption(`Still awake: ${awake.map((s) => s.name).join(', ')}. ${top.name} was the quickest!`, top.color);
    else if (top) ui.caption(`Everyone nodded off. ${top.name} lasted longest.`, top.color);
    seats.forEach((s, i) => {
      if (scores[i] === best) {
        view.seats3d[i]?.companion.setBase('happy');
        view.floaters.add('Wide awake!', s.color, (view.seats3d[i]?.home ?? new THREE.Vector3()).clone().add(new THREE.Vector3(0, HEIGHT + 0.6, 0.3)), 0.45, 2.2);
      }
      view.setPips(i, 0, 0, s.color);
    });
    sfx.good();
    await clock.wait(2.4);
    ui.caption(null);
    return {
      scores,
      details: players.map((p) => {
        const got = longest(p);
        if (!p.out) return `Stayed awake · ${got} colours`;
        return got ? `Remembered ${got} colours` : 'Dozed off straight away';
      }),
    };
  },
};
