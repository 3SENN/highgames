// Who Ate It? on the TV: everyone on the couch, an empty cookie jar on the sideboard. Each round the clues turn up
// one by one (coloured crumbs, a trail of footprints, a shadow on the wall by the jar, someone looking shifty),
// and get pinned to the side as little cards. Then everyone votes on their phone and the snacker is revealed.
import * as THREE from 'three';
import {
  type Clues,
  type Foot,
  type Suspect,
  type Top,
  WHO,
  candidatesFor,
  cpuVote,
  footOf,
  makeClues,
  roundPoints,
  snackerOrder,
  suspectOf,
  suspectsFor,
  whoScores,
} from '../../../game/minigames/whoateit';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Layout } from '../../../shared/protocol';
import { ease } from '../../anim';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import type { TextureName } from '../../render/textures';
import { PALETTE, ROUNDED_FONT, ball, box, canvasTexture, cone, cyl, gem, lathe, mix, part, pill, popSprite, rbox, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

/** Companion heights by body, so footprint sizes can be read off the couch. */
const HEIGHT: Record<Foot, number> = { small: 1.0, medium: 1.2, big: 1.42 };
/** Footprint size (width, length). */
const PRINT: Record<Foot, [number, number]> = { small: [0.13, 0.2], medium: [0.18, 0.28], big: [0.24, 0.38] };
const FOOT_WORDS: Record<Foot, string> = { small: 'Small footprints', medium: 'Medium footprints', big: 'Big footprints' };

const COUCH_X = -1.6;
const COUCH_Z = -1.7;
const SEAT_Y = 0.62; // where a companion's feet rest on a cushion
const CUSHION = 1.4; // cushion width
const JAR = new THREE.Vector3(3.3, 1.1, -2.2);
const SHADOW = new THREE.Vector3(3.45, 2.55, -3.17);
const CARD_X = 5.35;
const CARD_Y = [3.3, 2.55, 1.8, 1.05] as const;
const P = PALETTE;
const K = 1.4; // props at the couch's scale
const BACK = -3.2; // the back wall's face (z)
const COUCH = mix(P.plum, P.mauve, 0.45);

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

/** A clue card: white rounded label with optional colour dots. */
function clueCard(text: string, dots: readonly string[] = []): THREE.Sprite {
  const texture = canvasTexture(640, 160, (g) => {
    g.fillStyle = 'rgba(30,24,38,0.35)';
    g.beginPath();
    g.roundRect(12, 24, 624, 128, 40);
    g.fill();
    g.fillStyle = PALETTE.cream;
    g.beginPath();
    g.roundRect(8, 16, 624, 128, 40);
    g.fill();
    g.font = `700 50px ${ROUNDED_FONT}`;
    g.fillStyle = PALETTE.ink;
    g.textBaseline = 'middle';
    g.fillText(text, 46, 82, 560 - dots.length * 66);
    dots.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(640 - 72 - i * 66, 80, 25, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(30,24,38,0.4)';
      g.stroke();
    });
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(2.1, 0.525, 1);
  sprite.renderOrder = 6;
  return sprite;
}

interface Cat {
  root: THREE.Group;
  head: THREE.Group;
  tail: THREE.Mesh;
}

function sittingCat(color: string): Cat {
  const root = new THREE.Group();
  const head = new THREE.Group();
  const light = mix(color, '#ffffff', 0.45);
  part(root, ball(0.34, 2), color, 0, 0.34, 0, { sy: 1.1 });
  part(root, ball(0.2, 2), light, 0, 0.36, 0.2, { sz: 0.6 });
  const tail = part(root, pill(0.06, 0.55), color, 0.34, 0.12, -0.12, { rz: -1.2, ry: 0.5 });
  for (const x of [-0.14, 0.14]) part(root, ball(0.09, 1), light, x, 0.06, 0.24, { sy: 0.6 });
  part(head, ball(0.27, 2), color, 0, 0, 0);
  for (const x of [-0.13, 0.13]) {
    part(head, cone(0.09, 0.18, 4), color, x, 0.25, -0.02, { rz: -x * 1.3 });
    part(head, ball(0.035, 1), PALETTE.ink, x * 0.7, 0.04, 0.24, { outline: false });
  }
  part(head, ball(0.03, 1), PALETTE.rose, 0, -0.02, 0.26, { outline: false });
  head.position.set(0, 0.78, 0.08);
  root.add(head);
  return { root, head, tail };
}

function cookie(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.3, 0.3, 0.08, 24), '#c98d55', 0, 0, 0, { rx: Math.PI / 2 });
  part(g, cyl(0.26, 0.26, 0.09, 24), '#d9a066', 0, 0, 0.005, { rx: Math.PI / 2, outline: false, shadow: false });
  for (const [x, y] of [
    [-0.12, 0.08],
    [0.1, 0.12],
    [0.02, -0.1],
    [-0.15, -0.08],
    [0.16, -0.05],
  ] as const) {
    part(g, ball(0.045, 1), PALETTE.espresso, x, y, 0.045, { outline: false, gloss: 0.4 });
  }
  return g;
}

/** A blurry shadow of the top of someone's head. */
function shadowShape(top: Top, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const o = { material: mat, shadow: false } as const;
  part(g, ball(0.55, 2), '#000', 0, 0, 0, { ...o, sz: 0.05 });
  if (top === 'spiky') {
    part(g, cone(0.22, 0.75, 4), '#000', -0.32, 0.6, 0, { ...o, rz: 0.35, sz: 0.1 });
    part(g, cone(0.22, 0.75, 4), '#000', 0.32, 0.6, 0, { ...o, rz: -0.35, sz: 0.1 });
    part(g, cone(0.16, 0.45, 4), '#000', 0, 0.62, 0, { ...o, sz: 0.1 });
  } else if (top === 'bumpy') {
    for (const [x, y, r] of [
      [-0.42, 0.38, 0.2],
      [-0.16, 0.55, 0.22],
      [0.14, 0.56, 0.22],
      [0.42, 0.38, 0.2],
    ] as const) {
      part(g, ball(r, 2), '#000', x, y, 0, { ...o, sz: 0.1 });
    }
  } else {
    part(g, rbox(1.35, 0.14, 0.04, 0.06), '#000', 0.08, 0.3, 0, o);
    part(g, ball(0.5, 2), '#000', 0, 0.38, 0, { ...o, sy: 0.55, sz: 0.06 });
  }
  return g;
}

class KitchenView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly floaters: Floaters;
  readonly cat: Cat | null;
  private readonly fit: CameraFit;
  private readonly marks: Mark[] = [];
  private readonly lid = new THREE.Group();
  private readonly shadowMat = new THREE.MeshBasicMaterial({ color: '#1a1422', transparent: true, opacity: 0, depthWrite: false });
  private readonly sparkles = new Sparkles(this.scene);
  private tick: (dt: number, time: number) => void = () => {};
  /** Everything the current round added (crumbs, prints, cards, markers), cleared between rounds. */
  private clue = new THREE.Group();
  private sprites: THREE.Sprite[] = [];
  private bobbers: { o: THREE.Object3D; y: number; age: number }[] = [];
  private turns: { o: THREE.Object3D; to: number }[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly people: Companion[],
    /** Each companion's height. */
    private readonly heights: number[],
    withCat: boolean,
  ) {
    // Evening: one warm key, plum shade, the floor lamp by the couch.
    const rig = lightRig(this.scene, 'lampInterior', { shadowSize: 10, fog: { near: 34, far: 90 } });
    rig.sun.target.position.set(0.5, 0, -1);
    this.buildRoom(seats);
    this.scene.add(this.clue);

    seats.forEach((_, i) => {
      const c = people[i];
      const x = this.seatX(i, seats.length);
      if (c) {
        c.root.position.set(x, SEAT_Y, COUCH_Z + 0.15);
        c.setBase('idle');
        this.scene.add(c.root);
      }
      const h = heights[i] ?? 1.2;
      this.marks.push({ p: new THREE.Vector3(x, SEAT_Y + h + 0.8, COUCH_Z), pad: 0.06 });
    });
    this.cat = withCat ? sittingCat('#9aa0ad') : null;
    if (this.cat) {
      this.cat.root.position.set(this.couchRight(seats.length) + 0.75, 0, COUCH_Z + 0.6);
      this.cat.root.scale.setScalar(1.15);
      this.scene.add(this.cat.root);
    }
    const left = COUCH_X - this.couchWidth(seats.length) / 2;
    this.marks.push(
      { p: new THREE.Vector3(left, 0, COUCH_Z + 0.6), pad: 0.04 },
      { p: new THREE.Vector3(0.6, 0, -0.1), pad: 0.04 },
      { p: new THREE.Vector3(SHADOW.x, SHADOW.y + 1.1, SHADOW.z), pad: 0.03 },
      { p: new THREE.Vector3(JAR.x + 0.8, 0, JAR.z + 0.5), pad: 0.03 },
    );
    for (const y of CARD_Y) this.marks.push({ p: new THREE.Vector3(CARD_X - 1.1, y, -2), pad: 0.03 }, { p: new THREE.Vector3(CARD_X + 1.1, y, -2), pad: 0.03 });
    this.floaters = new Floaters(this.scene);
    this.fit = new CameraFit(this.camera, 0.32);
  }

  couchWidth(n: number): number {
    return Math.max(2, n) * CUSHION + 0.9;
  }

  couchRight(n: number): number {
    return COUCH_X + this.couchWidth(n) / 2;
  }

  seatX(i: number, n: number): number {
    const k = Math.max(2, n);
    return COUCH_X + (i - (k - 1) / 2) * CUSHION;
  }

  private buildRoom(seats: MinigameSeat[]): void {
    const s = this.scene;
    const root = new THREE.Group();
    s.add(root);
    roomShell(root, { w: 20, h: 9, back: BACK, front: 9, wall: mix(P.slate, P.duskWall, 0.55), floor: P.oak, k: K, dado: 1.35 });
    const n = Math.max(2, seats.length);
    const w = this.couchWidth(seats.length);
    const left = COUCH_X - w / 2;
    // A window over the couch with the evening coming in.
    put(root, props.windowFrame({ w: 1.7, h: 1.05, time: 'dusk', seed: 6 }), COUCH_X, 3.35, BACK + 0.02, 0, K);
    put(root, props.curtains({ w: 1.7, h: 1.05, color: mix(P.mustard, P.cream, 0.3) }), COUCH_X, 3.35, BACK + 0.02, 0, K);

    withOutline(0.03, () => {
      // The couch: one seat cushion per player, in a deep shade of their colour with the colour itself on the piping.
      const fab = { tex: 'fabric' as TextureName, texScale: 1.2, texStrength: 0.85 };
      part(s, rbox(w, 0.5, 1.3, 0.12), mix(COUCH, P.ink, 0.18), COUCH_X, 0.32, COUCH_Z, fab);
      part(s, rbox(w, 1.15, 0.42, 0.14), COUCH, COUCH_X, 0.95, COUCH_Z - 0.58, fab);
      for (const side of [-1, 1]) part(s, rbox(0.42, 0.85, 1.3, 0.16), COUCH, COUCH_X + side * (w / 2 - 0.21), 0.6, COUCH_Z, fab);
      for (let i = 0; i < n; i++) {
        const color = seats[i]?.color;
        const x = this.seatX(i, seats.length);
        part(s, rbox(CUSHION - 0.08, 0.26, 1.05, 0.12), color ? mix(color, COUCH, 0.5) : mix(COUCH, '#ffffff', 0.08), x, 0.68, COUCH_Z + 0.08, fab);
        part(s, rbox(CUSHION - 0.14, 0.7, 0.3, 0.13), mix(COUCH, '#ffffff', 0.07), x, 1.22, COUCH_Z - 0.3, { ...fab, rx: -0.1 });
        if (color) part(s, rbox(CUSHION - 0.3, 0.05, 0.04, 0.02), color, x, 0.7, COUCH_Z + 0.61, { glow: 0.8, outline: false, shadow: false });
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(s, cyl(0.06, 0.045, 0.14, 10), P.walnut, COUCH_X + sx * (w / 2 - 0.2), 0.04, COUCH_Z + sz * 0.5, { outline: false });
      // The sideboard with the cookie jar.
      part(s, rbox(1.5, 1.02, 1.0, 0.05), P.walnut, JAR.x + 0.15, 0.56, JAR.z, { tex: 'wood' });
      part(s, rbox(1.58, 0.07, 1.06, 0.03), mix(P.walnut, P.ink, 0.25), JAR.x + 0.15, 1.08, JAR.z, { tex: 'darkWood' });
      for (const x of [-0.36, 0.36]) {
        part(s, rbox(0.66, 0.8, 0.03, 0.012), mix(P.walnut, '#ffffff', 0.07), JAR.x + 0.15 + x, 0.58, JAR.z + 0.5, { tex: 'wood', outline: 0.012 });
        part(s, ball(0.045, 1), P.brass, JAR.x + 0.15 + x * 0.3, 0.7, JAR.z + 0.53, { outline: false, gloss: 0.6 });
      }
      for (const x of [-0.6, 0.6]) part(s, box(0.08, 0.1, 0.8), P.charcoal, JAR.x + 0.15 + x, 0.05, JAR.z, { outline: false });
    });
    // The jar: glass, a few crumbs inside, a lid that lifts.
    part(s, lathe([[0, 0], [0.3, 0], [0.33, 0.12], [0.33, 0.5], [0.27, 0.62], [0.27, 0.66]], 28), '#e8f6ff', JAR.x, JAR.y, JAR.z, { opacity: 0.45, gloss: 0.9 });
    part(s, torus(0.27, 0.02), P.ceramic, JAR.x, JAR.y + 0.66, JAR.z, { rx: Math.PI / 2, outline: false, gloss: 0.6 });
    part(s, rbox(0.03, 0.34, 0.01, 0.004), '#ffffff', JAR.x - 0.2, JAR.y + 0.32, JAR.z + 0.27, { basic: true, opacity: 0.55, outline: false, shadow: false });
    part(s, cyl(0.22, 0.22, 0.03, 16), '#d9a066', JAR.x, JAR.y + 0.03, JAR.z, { outline: false });
    const label = cookie();
    label.scale.setScalar(0.45);
    label.position.set(JAR.x, JAR.y + 0.3, JAR.z + 0.34);
    s.add(label);
    part(this.lid, cyl(0.31, 0.31, 0.07, 24), P.terracotta, 0, 0, 0, { gloss: 0.5 });
    part(this.lid, torus(0.3, 0.02), mix(P.terracotta, '#ffffff', 0.2), 0, 0.03, 0, { rx: Math.PI / 2, outline: false, gloss: 0.5 });
    part(this.lid, ball(0.08, 1), P.brass, 0, 0.09, 0, { gloss: 0.6 });
    this.lid.position.set(JAR.x, JAR.y + 0.68, JAR.z);
    s.add(this.lid);
    // A little plant keeping the jar company.
    put(root, props.plant({ kind: 'fern', h: 0.42, pot: P.terracotta, seed: 3 }), JAR.x + 0.62, JAR.y, JAR.z - 0.1, 0, K);

    // The rest of the room. The wall by the jar stays bare (a shadow turns up there), and so does the wall behind
    // the clue cards.
    const lamp = put(root, props.floorLamp({ light: 16, h: 1.9 }), left - 1.2, 0, COUCH_Z - 0.6, 0, K);
    lamp.name = 'floorLamp';
    put(root, props.plant({ kind: 'ficus', h: 1.9, pot: P.ceramic, seed: 4 }), left - 2.9, 0, BACK + 0.9, 0, K);
    put(root, props.pictureFrame({ w: 0.6, h: 0.8, art: 'hills', seed: 3 }), left - 1.3, 3.5, BACK + 0.02, 0, K);
    put(root, props.pictureFrame({ w: 0.42, h: 0.42, art: 'leaf', frame: P.brass, seed: 9 }), left - 2.6, 3.9, BACK + 0.02, 0, K);
    put(root, props.speaker({ h: 0.95 }), 8.0, 0, BACK + 0.7, -0.2, K);
    put(root, props.plant({ kind: 'snake', h: 0.85, pot: P.charcoal }), 9.0, 0, BACK + 1.6, 0, K);
    // In front of the couch: a rug and the coffee table with the evening's leftovers (clear of the footprints).
    put(root, props.rug({ w: 4.6, d: 1.9, color: mix(P.teal, P.plum, 0.35) }), COUCH_X - 0.2, 0, 1.75, 0, K);
    const table = put(root, props.coffeeTable({ w: 1.7, d: 0.7, color: P.walnut }), COUCH_X - 0.2, 0, 1.7, 0, K);
    put(table, props.snackBowl({ fill: 'crisps', color: P.ceramic }), -0.45, 0.42, 0.02);
    put(table, props.mug({ color: P.mustard }), 0.1, 0.42, 0.14, 0.6);
    put(table, props.mug({ color: P.teal }), 0.3, 0.42, -0.12, 2.2);
    put(table, props.plates({ n: 3 }), 0.6, 0.42, 0.08);
    put(table, props.remote(), -0.12, 0.42, -0.14, 0.5);
    put(root, props.pouf({ color: P.mustard }), left - 1.5, 0, 3.6, 0, K);
    put(root, props.plant({ kind: 'monstera', h: 1.0, pot: P.terracotta, seed: 8 }), 8.2, 0, 3.8, 0, K);
    // fairy lights along the top of the wall
    for (let k = 0; k < 4; k++) {
      const x0 = -9 + k * 4.6;
      root.add(props.stringLights(new THREE.Vector3(x0, 5.25, BACK + 0.1), new THREE.Vector3(x0 + 4.6, 5.25, BACK + 0.1), { sag: 0.2, count: 8, bulb: 0.055 }));
    }
    const dust = props.motes({ n: 16, area: [12, 3, 5], size: 0.05 });
    dust.position.set(0, 1, 0);
    root.add(dust);
    this.tick = props.tickProps(root);
  }

  /** Lifts or settles the jar's lid (k 0 shut … 1 open). */
  setLid(k: number): void {
    this.lid.position.y = JAR.y + 0.68 + k * 0.35;
    this.lid.position.x = JAR.x + k * 0.25;
    this.lid.rotation.z = -k * 0.6;
  }

  /** The top of a suspect's head (players, then the cat). */
  headOf(suspect: number): THREE.Vector3 {
    const c = this.people[suspect];
    if (c) return new THREE.Vector3(c.root.position.x, SEAT_Y + (this.heights[suspect] ?? 1.2) + 0.3, c.root.position.z);
    const p = this.cat?.root.position ?? new THREE.Vector3();
    return new THREE.Vector3(p.x, 1.5, p.z);
  }

  /** Something that pops in with a little bounce. */
  private pop(o: THREE.Object3D): void {
    o.scale.multiplyScalar(0.001);
    this.bobbers.push({ o, y: o.position.y, age: 0 });
  }

  card(index: number, text: string, dots: readonly string[] = []): void {
    const s = clueCard(text, dots);
    s.position.set(CARD_X, CARD_Y[index] ?? 1, -2);
    const full = s.scale.clone();
    s.scale.set(0.001, 0.001, 1);
    this.sprites.push(s);
    this.scene.add(s);
    let k = 0;
    s.userData.grow = (dt: number) => {
      k = Math.min(1, k + dt / 0.35);
      const e = ease.outBack(k);
      s.scale.set(full.x * e, full.y * e, 1);
      return k >= 1;
    };
  }

  crumbs(colors: readonly string[]): void {
    const g = new THREE.Group();
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    // On the sideboard by the jar, then a trail on the floor.
    const spots: [number, number, number][] = [];
    for (let i = 0; i < 7; i++) spots.push([JAR.x + rand(0.3, 0.75), JAR.y + 0.05, JAR.z + rand(-0.2, 0.4)]);
    for (let i = 0; i < 9; i++) {
      const k = i / 8;
      spots.push([JAR.x - 0.2 - k * 1.3 + rand(-0.2, 0.2), 0.04, JAR.z + 0.8 + k * 0.7 + rand(-0.2, 0.2)]);
    }
    spots.forEach(([x, y, z], i) => {
      part(g, ball(rand(0.05, 0.08), 0), '#c98d55', x, y, z, { outline: false, ry: rand(0, 3) });
      const c = colors[i % colors.length] ?? '#fff';
      part(g, pill(0.04, 0.12), c, x + 0.07, y + 0.02, z + 0.05, { rz: Math.PI / 2, ry: rand(0, 3), glow: 0.35, outline: false });
    });
    this.clue.add(g);
    this.pop(g);
  }

  footprints(foot: Foot): void {
    const g = new THREE.Group();
    const [w, l] = PRINT[foot];
    const from = new THREE.Vector3(JAR.x - 0.3, 0, JAR.z + 1.0);
    const to = new THREE.Vector3(0.6, 0, -0.3);
    const dir = to.clone().sub(from);
    const yaw = Math.atan2(dir.x, dir.z);
    const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    for (let i = 0; i < 6; i++) {
      const p = from.clone().lerp(to, i / 5).addScaledVector(side, (i % 2 ? 1 : -1) * w * 0.9);
      const print = new THREE.Group();
      part(print, cyl(0.5, 0.5, 0.012, 16), PALETTE.cream, 0, 0, 0, { sx: w * 2, sz: l * 2, outline: false, shadow: false });
      for (const t of [-1, 0, 1]) part(print, cyl(0.5, 0.5, 0.012, 10), PALETTE.cream, t * w * 0.55, 0, l * 1.25, { sx: w * 0.5, sz: w * 0.5, outline: false, shadow: false });
      print.position.set(p.x, 0.02, p.z);
      print.rotation.y = yaw;
      g.add(print);
    }
    this.clue.add(g);
    this.pop(g);
  }

  shadow(top: Top): void {
    const g = shadowShape(top, this.shadowMat);
    g.position.copy(SHADOW);
    this.clue.add(g);
    this.shadowMat.opacity = 0;
  }

  /** Fades the wall shadow in (0..1). */
  setShadow(k: number): void {
    this.shadowMat.opacity = 0.42 * k;
  }

  /** A shifty look: turns away and gets a little "…" over its head. */
  flinch(suspect: number): void {
    const c = this.people[suspect];
    const to = (suspect % 2 ? 1 : -1) * 0.6;
    if (c) {
      c.setBase('thinking');
      this.turns.push({ o: c.root, to });
    } else if (this.cat) {
      this.turns.push({ o: this.cat.head, to });
    }
    const dots = popSprite('…', '#ffffff', 0.45);
    dots.position.copy(this.headOf(suspect)).add(new THREE.Vector3(0.35, 0.1, 0));
    this.sprites.push(dots);
    this.scene.add(dots);
  }

  /** Little balls in the voters' colours over the one they picked. */
  showVotes(votes: readonly (number | null)[], seats: MinigameSeat[]): void {
    const by = new Map<number, number[]>();
    votes.forEach((v, voter) => {
      if (v !== null) by.set(v, [...(by.get(v) ?? []), voter]);
    });
    by.forEach((voters, suspect) => {
      const at = this.headOf(suspect);
      voters.forEach((voter, k) => {
        const b = new THREE.Group();
        part(b, ball(0.13, 2), seats[voter]?.color ?? '#fff', 0, 0, 0, { glow: 0.9, outline: false, shadow: false });
        b.position.set(at.x + (k - (voters.length - 1) / 2) * 0.32, at.y + 0.2, at.z + 0.2);
        this.clue.add(b);
        this.pop(b);
      });
    });
  }

  showCookie(suspect: number): void {
    const c = cookie();
    c.position.copy(this.headOf(suspect)).add(new THREE.Vector3(0, 0.75, 0.2));
    this.clue.add(c);
    this.pop(c);
    this.sparkles.burst(c.position, PALETTE.lamp, 12, 1.3);
  }

  /** Clears the round: clues off, everyone facing front again. */
  clear(): void {
    this.scene.remove(this.clue);
    this.clue = new THREE.Group();
    this.scene.add(this.clue);
    for (const s of this.sprites) {
      this.scene.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.sprites = [];
    this.bobbers = [];
    this.turns = [];
    this.shadowMat.opacity = 0;
    for (const c of this.people) {
      c.root.rotation.y = 0;
      c.setBase('idle');
    }
    if (this.cat) this.cat.head.rotation.y = 0;
  }

  dispose(): void {
    this.clear();
    this.floaters.dispose();
    this.sparkles.dispose();
    this.shadowMat.dispose();
    for (const c of this.people) c.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    for (const c of this.people) c.update(dt);
    this.floaters.update(dt);
    this.sparkles.update(dt);
    this.tick(dt, time);
    this.bobbers = this.bobbers.filter((b) => {
      b.age += dt;
      const k = Math.min(1, b.age / 0.4);
      b.o.scale.setScalar(Math.max(0.001, ease.outBack(k)));
      return k < 1;
    });
    for (const s of this.sprites) {
      const grow = s.userData.grow as ((dt: number) => boolean) | undefined;
      if (grow && grow(dt)) delete s.userData.grow;
    }
    for (const t of this.turns) t.o.rotation.y += (t.to - t.o.rotation.y) * Math.min(1, dt * 5);
    if (this.cat) this.cat.tail.rotation.y = 0.5 + Math.sin(time * 1.8) * 0.2;
  }
}

export const minigame: Minigame = {
  id: 'whoateit',
  title: 'Who Ate It?',
  how: 'Someone ate the last cookie, and their phone knows it. Act natural! Watch the clues, then vote for the snacker: 2 points if you catch them, 3 for the snacker if most of you guess wrong.',
  controller: 'buttons',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const players: Suspect[] = seats.map((s) => suspectOf(s.look, s.color));
    const suspects = suspectsFor(players);
    const names = suspects.map((_, i) => (i < n ? (seats[i]?.name ?? '?') : 'The cat'));
    /** A suspect's name in the middle of a sentence. */
    const named = (i: number) => (i < n ? (names[i] ?? '?') : 'the cat');
    const heights = seats.map((s) => HEIGHT[footOf(s.look)]);
    const companions = await Promise.all(seats.map((s, i) => buildCompanion(s.look, { height: heights[i] })));
    const view = new KitchenView(seats, companions, heights, suspects.length > n);
    ctx.stage.setView(view);
    const skill = seats.map(() => ctx.skill());
    const order = snackerOrder(rng, suspects.length);
    const points = seats.map(() => 0);
    const rightVotes = seats.map(() => 0);
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${points[i]} pts` })));
    live();
    const chime = (f: number) => {
      tone(sfx, { freq: f, dur: 0.18, type: 'triangle', gain: 0.08 });
      tone(sfx, { freq: f * 1.5, dur: 0.22, type: 'sine', gain: 0.05, delay: 0.09 });
    };

    for (let r = 0; r < order.length; r++) {
      const snacker = order[r] as number;
      const clues: Clues = makeClues(rng, suspects, snacker);
      view.clear();
      const votes: (number | null)[] = seats.map(() => null);
      const candidates = seats.map((_, i) => candidatesFor(suspects.length, i));
      const layout = (seat: number, note: string): Layout => {
        const list = candidates[seat] ?? [];
        const buttons = list.map((c) => ({ label: names[c] ?? '?', color: suspects[c]?.color ?? '#999' }));
        if (buttons.length < 2) buttons.push({ label: 'No idea', color: '#b4b8c2' });
        return {
          kind: 'buttons',
          title: 'Who ate the last cookie?',
          buttons,
          note,
          secret: seat === snacker ? 'You ate it. Act natural.' : 'Somebody ate it. Who?',
        };
      };
      seats.forEach((_, i) => session.setLayout(i, layout(i, `Round ${r + 1} of ${order.length} · clues coming in…`)));
      let open = true;
      let voting = false;
      const vote = (seat: number, suspect: number | null) => {
        if (!open || seat >= n) return;
        const first = votes[seat] === null;
        votes[seat] = suspect;
        if (voting && first && suspect !== null) view.floaters.add('Voted', seats[seat]?.color ?? '#fff', view.headOf(seat), 0.32, 1.0);
      };
      const off = session.onInput((seat, msg) => {
        if (msg.t !== 'press' || session.isCpu(seat)) return;
        const c = candidates[seat]?.[msg.index] ?? null;
        vote(seat, c);
        session.send(seat, { t: 'feedback', good: true, text: c === null ? 'No idea? Fair enough.' : `You picked ${named(c)}${voting ? '' : ' (for now)'}` });
      });

      // The jar: empty!
      ui.caption(r === 0 ? 'The last cookie is gone!' : 'The last cookie is gone… again!');
      noise(sfx, { dur: 0.08, filter: 'highpass', freq: 3000, gain: 0.12 });
      tone(sfx, { freq: 1900, dur: 0.12, gain: 0.06 });
      await clock.tween(0.45, (k) => view.setLid(k), ease.outBack);
      seats.forEach((_, i) => view.people[i]?.react('approval', 1.2));
      await clock.wait(0.8);

      // The clues, one by one over ten seconds.
      const at0 = clock.time;
      const until = (s: number) => clock.wait(Math.max(0, at0 + s - clock.time));
      ui.caption('Clue 1: crumbs…');
      chime(660);
      noise(sfx, { dur: 0.25, filter: 'bandpass', freq: 2600, gain: 0.14 });
      const crumbColors = clues.crumbs.map((i) => suspects[i]?.color ?? '#fff');
      view.crumbs(crumbColors);
      view.card(0, 'Crumbs', crumbColors);
      await until(2.5);
      ui.caption('Clue 2: footprints…');
      chime(740);
      view.footprints(clues.foot);
      for (let i = 0; i < 4; i++) noise(sfx, { dur: 0.08, freq: 260, gain: 0.25, delay: i * 0.16 });
      view.card(1, FOOT_WORDS[clues.foot]);
      await until(5);
      ui.caption('Clue 3: a shadow by the jar…');
      chime(830);
      tone(sfx, { freq: 220, to: 160, dur: 0.6, gain: 0.05 });
      view.shadow(clues.top);
      void clock.tween(0.8, (k) => view.setShadow(k));
      view.card(2, 'A shadow by the jar');
      await until(7.5);
      ui.caption('Clue 4: someone looks a bit shifty…');
      chime(988);
      tone(sfx, { freq: 320, to: 190, dur: 0.25, type: 'sine', gain: 0.07 });
      for (const f of clues.flinch) view.flinch(f);
      view.card(3, 'Shifty looks');
      await until(WHO.clueTime);

      // Vote.
      voting = true;
      seats.forEach((_, i) => session.setLayout(i, layout(i, 'Vote now! You can change your mind.')));
      ui.caption('Who ate it? Vote on your phone!');
      const cpuAt = seats.map((_, i) => (session.isCpu(i) ? 0.8 + (1 - (skill[i] ?? 0.5)) * 2.5 + rng() * 1.5 : Infinity));
      const voted = seats.map((_, i) => !session.isCpu(i) && votes[i] !== null);
      let allAt = Infinity;
      await everyFrame(clock, (_, t) => {
        seats.forEach((__, i) => {
          if (!voted[i] && session.isCpu(i) && t >= (cpuAt[i] ?? Infinity)) {
            voted[i] = true;
            vote(i, cpuVote(rng, clues, suspects, i, skill[i] ?? 0.5));
          }
          if (!voted[i] && votes[i] !== null) voted[i] = true;
        });
        if (allAt === Infinity && voted.every(Boolean)) allAt = t;
        ui.timer(WHO.voteTime - t);
        return t >= WHO.voteTime || t >= allAt + 1.2;
      });
      open = false;
      off();
      ui.timer(null);

      // The truth.
      session.setLayoutAll(() => ({ kind: 'wait', title: 'And the snacker was…' }));
      view.showVotes(votes, seats);
      sfx.tick();
      await clock.wait(0.9);
      const pts = roundPoints(votes, snacker, n);
      const caught = votes.filter((v, i) => i !== snacker && v === snacker).length;
      const gotAway = snacker < n && (pts[snacker] ?? 0) > 0;
      view.showCookie(snacker);
      ui.caption(snacker < n ? `It was ${names[snacker]}! ${gotAway ? 'Got away with it.' : 'Caught red-handed.'}` : 'It was the cat! Of course it was.');
      if (snacker >= n && view.cat) {
        view.cat.head.rotation.y = 0;
        tone(sfx, { freq: 420, to: 760, dur: 0.14, type: 'triangle', gain: 0.12 });
        tone(sfx, { freq: 760, to: 560, dur: 0.18, type: 'triangle', gain: 0.12, delay: 0.13 });
      }
      if (gotAway) sfx.fanfare();
      else if (caught > 0) sfx.good();
      seats.forEach((_, i) => {
        const c = view.people[i];
        if (!c) return;
        c.root.rotation.y = 0;
        if (i === snacker) c.react(gotAway ? 'happy' : 'sad', 2.4);
        else c.react(votes[i] === snacker ? 'happy' : 'sad', 2.0);
      });
      pts.forEach((p, i) => {
        points[i] = (points[i] ?? 0) + p;
        if (i !== snacker && votes[i] === snacker) rightVotes[i] = (rightVotes[i] ?? 0) + 1;
        if (p > 0) view.floaters.add(`+${p}`, seats[i]?.color ?? '#fff', view.headOf(i).add(new THREE.Vector3(0, 0.3, 0.4)), 0.5, 1.8);
      });
      seats.forEach((_, i) => {
        if (i === snacker) session.send(i, { t: 'feedback', good: gotAway, text: gotAway ? 'You got away with it!' : 'Busted!' });
        else session.send(i, { t: 'feedback', good: votes[i] === snacker, text: votes[i] === snacker ? 'You caught them!' : `It was ${named(snacker)}.` });
      });
      live();
      await clock.wait(2.3);
      await clock.tween(0.3, (k) => view.setLid(1 - k));
    }

    view.clear();
    ui.caption(null);
    view.floaters.dispose();
    return {
      scores: whoScores(points, rightVotes),
      details: points.map((p, i) => `${p} pts · ${rightVotes[i]} right guess${rightVotes[i] === 1 ? '' : 'es'}`),
    };
  },
};
