// Midnight Snack Run on the TV: a big supermarket just before closing, nobody about. Two lanes run side by side
// down one long aisle (crisps, then cereal, then the humming freezers) to the tills. One partner pushes the cart,
// the other rides in it and steers; halfway they hop out and swap.
import * as THREE from 'three';
import {
  CART,
  type Cart,
  type CartEvent,
  type Course,
  type CpuPusher,
  type CpuSteerer,
  type SnackKind,
  cartScores,
  cartSeatScores,
  cpuPush,
  cpuSteer,
  makeCourse,
  newCart,
  newCpuPusher,
  newCpuSteerer,
  pushCart,
  sectionAt,
  stepCart,
  swapping,
  wasFirst,
} from '../../../game/minigames/cartrace';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Layout } from '../../../shared/protocol';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { FONT, PALETTE as P, box, canvasTexture, cyl, gem, material, mix, nameCard, part, popSprite, rbox, seeded, sphere, toonMat, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { Floaters, type Mark, frameMarks, lanes, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const GAP = CART.lane + 1.0; // lane to lane: a lane and the low shelf unit between them
const SHELF_D = 1.0; // shelf depth
const SHELF_H = 2.3; // the shelves along the walls
const MID_H = 1.5; // the low unit between the lanes
const SHELF_END = 53; // the shelves stop here; the tills come after
const HEIGHT = 1.1; // companions
const BASKET_Y = 0.46; // the bottom of the cart's basket
const HANDLE_Z = 0.95; // the pusher walks this far behind the cart's middle
const TILT = 0.5; // the camera looks down this much (radians)
const HOP = 0.9; // seconds the partners take to swap places
const PILE_MAX = 12;

const WALL_H = 6.4; // the shop's walls, up into the dark
const SUN: [number, number, number] = [0.25, 1, 0.45];
const pale = (c: string) => mix(c, P.cream, 0.55);
const SNACK_COLORS: Record<SnackKind, string[]> = {
  chips: [P.mustard, P.terracotta, P.denim, P.sage, P.mauve],
  cereal: [P.mustard, P.rose, P.teal, P.copper, P.olive],
  icecream: [pale(P.rose), P.cream, pale(P.teal), pale(P.mauve), pale(P.copper)],
};
/** Each section's own colour: the shelf trim and the sign over it. */
const SECTION: Record<SnackKind, { color: string; name: string }> = {
  chips: { color: P.terracotta, name: 'Crisps' },
  cereal: { color: P.mustard, name: 'Cereal' },
  icecream: { color: P.teal, name: 'Frozen' },
};

// ------------------------------------------------------------------ textures and pieces

/** A shelf full of products, painted once per section: rows of bags, boxes or freezer tubs in the dark of the shelf. */
function shelfTexture(kind: SnackKind, seed: number): THREE.CanvasTexture {
  return canvasTexture(512, 256, (g, w, h) => {
    const rand = seeded(seed);
    const cold = kind === 'icecream';
    const back = g.createLinearGradient(0, 0, 0, h);
    back.addColorStop(0, cold ? '#9fd0e6' : '#3b2f33');
    back.addColorStop(1, cold ? '#6fa9c9' : '#2a2126');
    g.fillStyle = back;
    g.fillRect(0, 0, w, h);
    const rows = 4;
    const rh = h / rows;
    const colors = SNACK_COLORS[kind];
    for (let r = 0; r < rows; r++) {
      const floor = (r + 1) * rh - 9;
      let x = 6;
      while (x < w - 24) {
        const pw = kind === 'cereal' ? 30 + rand() * 10 : kind === 'chips' ? 38 + rand() * 12 : 28 + rand() * 8;
        const ph = rh * (kind === 'cereal' ? 0.78 : kind === 'chips' ? 0.6 : 0.42) * (0.9 + rand() * 0.15);
        const c = colors[Math.floor(rand() * colors.length)] as string;
        g.fillStyle = c;
        g.beginPath();
        g.roundRect(x, floor - ph, pw, ph, kind === 'chips' ? 9 : 3);
        g.fill();
        // a label band and a soft shade down one side, so the packs have a little form
        g.fillStyle = 'rgba(246,238,224,0.75)';
        g.fillRect(x + 4, floor - ph * 0.62, pw - 8, ph * 0.2);
        g.fillStyle = 'rgba(30,24,38,0.22)';
        g.fillRect(x + pw - 6, floor - ph + 3, 6, ph - 3);
        x += pw + 4;
      }
      // the shelf's edge, with price tags
      g.fillStyle = cold ? '#e9f4f8' : '#8b7f78';
      g.fillRect(0, floor, w, 9);
      g.fillStyle = cold ? '#7fb2cc' : '#efe6d6';
      for (let t = 14; t < w; t += 46) g.fillRect(t, floor + 2, 16, 5);
      // the shadow under the shelf above
      const shade = g.createLinearGradient(0, r * rh, 0, r * rh + 18);
      shade.addColorStop(0, 'rgba(20,14,24,0.5)');
      shade.addColorStop(1, 'rgba(20,14,24,0)');
      g.fillStyle = shade;
      g.fillRect(0, r * rh, w, 18);
    }
    if (cold) {
      // Glass doors: slim dark frames and a soft shine.
      g.strokeStyle = '#3c4658';
      g.lineWidth = 8;
      for (let i = 0; i < 3; i++) g.strokeRect((i * w) / 3 + 4, 4, w / 3 - 8, h - 8);
      g.fillStyle = 'rgba(255,255,255,0.2)';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo((i * w) / 3 + 40, 10);
        g.lineTo((i * w) / 3 + 80, 10);
        g.lineTo((i * w) / 3 + 30, h - 10);
        g.lineTo((i * w) / 3 - 10, h - 10);
        g.fill();
      }
    }
  });
}

/** A section's sign: its name in cream on the section's colour. */
function signTexture(text: string, color: string): THREE.CanvasTexture {
  return canvasTexture(512, 160, (g, w, h) => {
    g.fillStyle = mix(color, P.aubergine, 0.3);
    g.beginPath();
    g.roundRect(0, 0, w, h, 26);
    g.fill();
    g.strokeStyle = 'rgba(246,238,224,0.6)';
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(12, 12, w - 24, h - 24, 18);
    g.stroke();
    g.fillStyle = P.cream;
    g.font = `650 84px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

/** A shopping cart: bright wire, with the rim and the handle in the team's colour. Faces -z; the middle of the basket at 0. */
function cartMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  const wire = mix(P.metal, P.ceramic, 0.6);
  const steel = { gloss: 0.6, outline: 0.02 };
  const w = CART.half * 2 - 0.04;
  const l = CART.long * 2;
  part(g, rbox(w - 0.06, 0.04, l - 0.06, 0.02), wire, 0, BASKET_Y, 0, steel);
  for (const sx of [-1, 1]) part(g, rbox(0.035, 0.44, l, 0.015), wire, sx * (w / 2 - 0.02), BASKET_Y + 0.22, 0, steel);
  for (const sz of [-1, 1]) part(g, rbox(w, 0.44, 0.035, 0.015), wire, 0, BASKET_Y + 0.22, sz * (l / 2 - 0.02), steel);
  // The wires of the basket, as fine dark lines.
  for (const y of [0.1, 0.2, 0.3]) {
    for (const sx of [-1, 1]) part(g, box(0.006, 0.012, l - 0.04), P.slate, sx * (w / 2 + 0.001), BASKET_Y + y, 0, { outline: false, shadow: false });
    for (const sz of [-1, 1]) part(g, box(w - 0.04, 0.012, 0.006), P.slate, 0, BASKET_Y + y, sz * (l / 2 + 0.001), { outline: false, shadow: false });
  }
  // The rim and the handle in the team colour.
  const team = { exact: true, gloss: 0.4, outline: 0.02 };
  for (const sx of [-1, 1]) part(g, rbox(0.06, 0.05, l + 0.02, 0.02), color, sx * (w / 2 - 0.02), BASKET_Y + 0.45, 0, team);
  for (const sz of [-1, 1]) part(g, rbox(w + 0.02, 0.05, 0.06, 0.02), color, 0, BASKET_Y + 0.45, sz * (l / 2 - 0.02), team);
  for (const sx of [-1, 1]) part(g, cyl(0.022, 0.022, 0.36, 8), wire, sx * (w / 2 - 0.04), BASKET_Y + 0.55, l / 2 + 0.08, { rx: -0.5, ...steel });
  part(g, cyl(0.045, 0.045, w + 0.04, 12), color, 0, BASKET_Y + 0.7, l / 2 + 0.17, { rz: Math.PI / 2, ...team });
  // Chassis, a bottom tray and wheels.
  for (const sx of [-1, 1]) part(g, rbox(0.04, 0.04, l - 0.1, 0.02), P.metal, sx * (w / 2 - 0.08), 0.16, 0, { gloss: 0.5, outline: false });
  part(g, rbox(w - 0.2, 0.02, l - 0.2, 0.01), P.slate, 0, 0.17, 0, { outline: false });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      part(g, cyl(0.07, 0.07, 0.05, 14), P.charcoal, sx * (w / 2 - 0.08), 0.07, sz * (l / 2 - 0.12), { rz: Math.PI / 2, outline: 0.02 });
      part(g, cyl(0.03, 0.03, 0.055, 10), P.ceramic, sx * (w / 2 - 0.08), 0.07, sz * (l / 2 - 0.12), { rz: Math.PI / 2, outline: false, gloss: 0.6 });
    }
  }
  return g;
}

/** A snack you can grab, sitting on the shelf's edge. */
function snackMesh(kind: SnackKind, color: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'chips') {
    part(g, rbox(0.32, 0.4, 0.14, 0.07), color, 0, 0.2, 0, { gloss: 0.35 });
    part(g, rbox(0.33, 0.05, 0.15, 0.02), mix(color, P.ink, 0.3), 0, 0.37, 0, { outline: false });
    part(g, rbox(0.33, 0.05, 0.15, 0.02), mix(color, P.ink, 0.3), 0, 0.03, 0, { outline: false });
    part(g, sphere(0.075, 12), P.cream, 0, 0.21, 0.066, { sz: 0.25, outline: false });
    part(g, sphere(0.045, 10), P.mustard, 0, 0.21, 0.08, { sz: 0.3, outline: false });
  } else if (kind === 'cereal') {
    part(g, rbox(0.28, 0.44, 0.12, 0.02), color, 0, 0.22, 0);
    part(g, box(0.24, 0.1, 0.005), P.cream, 0, 0.36, 0.061, { outline: false, shadow: false });
    part(g, cyl(0.085, 0.06, 0.02, 16), P.ceramic, 0, 0.18, 0.065, { rx: Math.PI / 2, outline: false, gloss: 0.5 });
    part(g, sphere(0.04, 10), P.mustard, 0.01, 0.2, 0.072, { outline: false });
  } else {
    part(g, cyl(0.14, 0.11, 0.2, 18), color, 0, 0.1, 0, { gloss: 0.3 });
    part(g, cyl(0.15, 0.15, 0.03, 18), P.ceramic, 0, 0.21, 0, { gloss: 0.5 });
    part(g, cyl(0.142, 0.132, 0.05, 18), mix(color, P.rose, 0.6), 0, 0.12, 0, { outline: false });
    part(g, sphere(0.09, 12), mix(color, P.rose, 0.5), 0, 0.27, 0, { gloss: 0.4 });
  }
  return g;
}

/** Small things in the basket: one for each snack grabbed. */
function pileMesh(kind: SnackKind, color: string): THREE.Mesh {
  const geo = kind === 'icecream' ? cyl(0.07, 0.06, 0.1, 10) : kind === 'cereal' ? rbox(0.14, 0.2, 0.06, 0.02) : rbox(0.16, 0.18, 0.07, 0.04);
  return new THREE.Mesh(geo, material(color));
}

// ------------------------------------------------------------------ the view

interface Flying {
  mesh: THREE.Object3D;
  from: THREE.Vector3;
  team: number;
  age: number;
  kind: SnackKind;
  color: string;
}

interface Can {
  mesh: THREE.Object3D;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
}

interface Side {
  x: number;
  color: string;
  cart: Cart;
  group: THREE.Group;
  pile: THREE.Group;
  piled: number;
  members: number[];
  /** Who rides in the basket and who pushes (seat positions, -1 for nobody). */
  rider: number;
  pusher: number;
  /** Swap hop progress, 0..1, or null. */
  hop: number | null;
  card: THREE.Sprite;
  snacks: THREE.Group[];
  signs: (THREE.Group | null)[];
  stacks: (THREE.Group | null)[];
  fall: number[];
  cans: Can[];
  tilt: number;
  lean: number;
  shove: number;
  sway: number;
  /** 1 → 0 as the basket takes a snack: it bounces. */
  bump: number;
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

class Supermarket implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 220);
  readonly sides: Side[] = [];
  private readonly floaters: Floaters;
  private readonly probe = new THREE.PerspectiveCamera();
  private readonly owned: { dispose(): void }[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private flying: Flying[] = [];
  private goal = { pos: new THREE.Vector3(0, 7, 10), look: new THREE.Vector3(0, 0, -6) };
  private look = new THREE.Vector3();
  private placed = false;
  private fitAt = -1;
  private time = 0;
  private readonly rand = seeded(57);
  private readonly specks: Specks;
  private readonly sun: THREE.DirectionalLight;
  private tick: (dt: number, time: number) => void = () => {};

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    private readonly companions: Companion[],
    private readonly course: Course,
    carts: Cart[],
  ) {
    this.floaters = new Floaters(this.scene);
    this.specks = new Specks(this.scene, this.rand);
    // After hours: most of the lights are off. A warm key from the strip lights overhead, plum in the shade,
    // and the shadows follow the carts down the aisle.
    this.sun = lightRig(this.scene, 'lampInterior', { fog: { near: 26, far: 80 }, shadowSize: 13, sunFrom: SUN }).sun;
    this.sun.intensity = 1.55;
    const xs = lanes(teams.length, GAP);
    this.store(xs);
    teams.forEach((members, k) => {
      const x = xs[k] ?? 0;
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      const group = cartMesh(color);
      const pile = new THREE.Group();
      pile.position.y = BASKET_Y + 0.02;
      group.add(pile);
      this.scene.add(group);
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.05);
      this.scene.add(card);
      this.cards.push(card);
      const side: Side = {
        x,
        color,
        cart: carts[k] as Cart,
        group,
        pile,
        piled: 0,
        members,
        rider: members[1] ?? -1,
        pusher: members[0] ?? -1,
        hop: null,
        card,
        snacks: [],
        signs: [],
        stacks: [],
        fall: course.obstacles.map(() => 0),
        cans: [],
        tilt: 0,
        lean: 0,
        shove: 0,
        sway: 0,
        bump: 0,
      };
      this.lane(side);
      for (const p of members) {
        const c = companions[p];
        if (!c) continue;
        c.setBase('happy');
        c.root.rotation.y = Math.PI;
        this.scene.add(c.root);
      }
      this.sides.push(side);
    });
    this.tick = props.tickProps(this.scene);
    this.update(0);
  }

  /** The floor, the shelves and the aisles either side, the walls, the tills and the shop window at the end. */
  private store(xs: number[]): void {
    const sc = this.scene;
    const left = (xs[0] ?? 0) - CART.lane / 2 - SHELF_D;
    const right = (xs[xs.length - 1] ?? 0) + CART.lane / 2 + SHELF_D;
    const mid = (left + right) / 2;
    const far = CART.length + CART.runout + 1;
    // The shop goes on either side of the race: more aisles, then the walls.
    const AISLES = 3;
    const shopL = left - AISLES * GAP - 1.6;
    const shopR = right + AISLES * GAP + 1.6;
    const shopW = shopR - shopL;
    const flat = { outline: false as const, shadow: false };
    // Polished terrazzo, a painted guide line down each lane, and the walls going up into the dark.
    part(sc, box(shopW + 60, 0.2, far + 60), P.aubergine, mid, -0.22, -far / 2 + 8, flat);
    part(sc, box(shopW + 0.4, 0.2, far + 24), mix(P.linen, P.duskWall, 0.3), mid, -0.1, -far / 2 + 8, { tex: 'terrazzo', texScale: 2.4, gloss: 0.3, ...flat });
    for (const x of xs) for (const e of [-1, 1]) part(sc, box(0.05, 0.01, CART.length + 4), mix(P.cream, P.duskWall, 0.3), x + e * (CART.lane / 2 - 0.42), 0.004, -CART.length / 2 + 2, flat);
    const wallC = mix(P.plum, P.aubergine, 0.35);
    for (const e of [-1, 1]) {
      const x = e < 0 ? shopL - 0.15 : shopR + 0.15;
      part(sc, box(0.3, WALL_H, far + 24), wallC, x, WALL_H / 2, -far / 2 + 8, { tex: 'plaster', ...flat });
      // a painted band, and posters
      part(sc, box(0.02, 0.5, far + 24), mix(P.terracotta, P.aubergine, 0.35), x - e * 0.16, 3.05, -far / 2 + 8, flat);
      const arts = ['shapes', 'sunset', 'leaf', 'hills', 'moon'] as const;
      for (let i = 0; i < 5; i++) {
        const poster = props.pictureFrame({ w: 2.2, h: 1.5, art: arts[(i + (e > 0 ? 2 : 0)) % arts.length] as props.Art, frame: P.charcoal, seed: i + 3 });
        poster.position.set(x - e * 0.16, 4.6, -4 - i * 12 - (e > 0 ? 5 : 0));
        poster.rotation.y = (-e * Math.PI) / 2;
        sc.add(poster);
      }
    }

    // Shelf faces, one painted texture per section; the freezers glow.
    const kinds = ['chips', 'cereal', 'icecream'] as const;
    const faces = new Map<SnackKind, THREE.Material>();
    const faceMat = (kind: SnackKind, tex: THREE.Texture) => toonMat({ map: tex, ...(kind === 'icecream' ? { emissive: new THREE.Color(P.screen), emissiveMap: tex, emissiveIntensity: 0.75 } : {}) });
    const textures = new Map<SnackKind, THREE.CanvasTexture>();
    kinds.forEach((kind, i) => {
      const tex = shelfTexture(kind, 11 + i);
      const mat = faceMat(kind, tex);
      textures.set(kind, tex);
      faces.set(kind, mat);
      this.owned.push(tex, mat);
    });
    // Shelf units: one either side of the lanes, and a low one between each pair of lanes.
    const units: { x: number; h: number; facing: number[] }[] = [];
    units.push({ x: left + SHELF_D / 2, h: SHELF_H, facing: [-1, 1] });
    for (let i = 0; i + 1 < xs.length; i++) units.push({ x: ((xs[i] ?? 0) + (xs[i + 1] ?? 0)) / 2, h: MID_H, facing: [-1, 1] });
    units.push({ x: right - SHELF_D / 2, h: SHELF_H, facing: [-1, 1] });
    const MOD = 4;
    const body = mix(P.charcoal, P.slate, 0.35);
    const top = mix(P.charcoal, P.plum, 0.3);
    const boxC = mix(P.oak, P.sand, 0.45);
    withOutline(0.025, () => {
      units.forEach((u, ui) => {
        const tall = u.h === SHELF_H;
        for (let s0 = -3; s0 < SHELF_END; s0 += MOD) {
          const len = Math.min(MOD, SHELF_END - s0) - 0.06;
          const z = -(s0 + len / 2);
          const kind = sectionAt(Math.max(0, s0 + len / 2));
          const cold = kind === 'icecream';
          part(sc, rbox(SHELF_D, u.h, len, 0.04), cold ? mix(P.ceramic, P.slate, 0.25) : body, u.x, u.h / 2, z, cold ? { gloss: 0.4 } : {});
          part(sc, rbox(SHELF_D + 0.06, 0.12, len + 0.04, 0.03), top, u.x, u.h + 0.02, z);
          part(sc, box(SHELF_D + 0.08, 0.1, len + 0.02), P.charcoal, u.x, 0.05, z, flat);
          for (const f of u.facing) {
            part(sc, box(0.04, u.h - 0.28, len - 0.1), '#ffffff', u.x + f * (SHELF_D / 2 + 0.005), u.h / 2 + 0.04, z, { material: faces.get(kind), outline: false });
            // the section's colour along the top edge, and a slim light under it: warm over the shelves, cold in the freezers
            part(sc, box(0.05, 0.13, len + 0.04), mix(SECTION[kind].color, P.aubergine, 0.15), u.x + f * (SHELF_D / 2 + 0.03), u.h + 0.02, z, flat);
            part(sc, box(0.03, 0.03, len - 0.2), cold ? P.screen : P.lamp, u.x + f * (SHELF_D / 2 + 0.03), u.h - 0.1, z, { glow: cold ? 1.5 : 1.1, ...flat });
          }
          // Stock on top of the tall shelves, now and then.
          const n = Math.floor((s0 + 3) / MOD) + ui * 3;
          if (tall && n % 3 !== 1) {
            const dz = ((n * 7) % 5) * 0.4 - 0.8;
            part(sc, rbox(0.6, 0.42, 0.7, 0.02), boxC, u.x - 0.05, u.h + 0.29, z + dz, { ry: ((n % 4) - 1.5) * 0.12, outline: 0.02 });
            if (n % 2 === 0) part(sc, rbox(0.5, 0.34, 0.5, 0.02), mix(P.oak, P.sand, 0.3), u.x, u.h + 0.25, z + dz + 0.85, { ry: 0.3, outline: 0.02 });
          }
        }
      });
      // A sign for each section, standing on the tall shelves where it starts.
      for (const kind of kinds) {
        const start = kind === 'chips' ? 1.5 : kind === 'cereal' ? 22 : 38;
        const tex = signTexture(SECTION[kind].name, SECTION[kind].color);
        const mat = toonMat({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.35 });
        this.owned.push(tex, mat);
        for (const u of [units[0], units[units.length - 1]]) {
          if (!u) continue;
          part(sc, box(1.9, 0.6, 0.06), '#ffffff', u.x, SHELF_H + 0.75, -(start + 0.4), { material: mat, outline: false });
          part(sc, box(1.98, 0.68, 0.04), P.charcoal, u.x, SHELF_H + 0.75, -(start + 0.44), flat);
          for (const dx of [-0.7, 0.7]) part(sc, cyl(0.02, 0.02, 0.4, 6), P.charcoal, u.x + dx, SHELF_H + 0.25, -(start + 0.44), flat);
        }
      }
    });
    // The aisles beyond: the same shelves, one long unit per section (nobody shops there tonight).
    for (const e of [-1, 1]) {
      for (let k = 1; k <= AISLES; k++) {
        const x = (e < 0 ? left + SHELF_D / 2 : right - SHELF_D / 2) + e * k * GAP;
        kinds.forEach((kind, i) => {
          const s0 = i === 0 ? -3 : i === 1 ? 22 : 38;
          const s1 = i === 0 ? 22 : i === 1 ? 38 : SHELF_END;
          const len = s1 - s0 - 0.08;
          const z = -(s0 + s1) / 2;
          const cold = kind === 'icecream';
          const tex = (textures.get(kind) as THREE.CanvasTexture).clone();
          tex.wrapS = THREE.RepeatWrapping;
          tex.repeat.set(Math.round(len / MOD), 1);
          tex.needsUpdate = true;
          const mat = faceMat(kind, tex);
          this.owned.push(tex, mat);
          part(sc, box(SHELF_D, SHELF_H, len), cold ? mix(P.ceramic, P.slate, 0.25) : body, x, SHELF_H / 2, z, { outline: false });
          part(sc, box(SHELF_D + 0.06, 0.12, len + 0.04), top, x, SHELF_H + 0.02, z, { outline: false });
          for (const f of [-1, 1]) {
            part(sc, box(0.04, SHELF_H - 0.28, len - 0.1), '#ffffff', x + f * (SHELF_D / 2 + 0.005), SHELF_H / 2 + 0.04, z, { material: mat, outline: false, shadow: false });
            part(sc, box(0.05, 0.13, len + 0.04), mix(SECTION[kind].color, P.aubergine, 0.15), x + f * (SHELF_D / 2 + 0.03), SHELF_H + 0.02, z, flat);
            part(sc, box(0.03, 0.03, len - 0.2), cold ? P.screen : P.lamp, x + f * (SHELF_D / 2 + 0.03), SHELF_H - 0.1, z, { glow: cold ? 1.5 : 1.1, ...flat });
          }
          for (let b = 0; b < 3; b++) {
            const bz = z + ((((k + i) * 5 + b * 7) % 9) / 9 - 0.5) * len * 0.8;
            part(sc, rbox(0.6, 0.42, 0.7, 0.02), b % 2 ? boxC : mix(P.oak, P.sand, 0.3), x, SHELF_H + 0.29, bz, { ry: (b - 1) * 0.2, outline: false });
          }
        });
      }
    }
    withOutline(0.025, () => {
      // The tills: a counter on the outer side of each lane, a lit number on a pole, and the line on the floor.
      xs.forEach((x, k) => {
        const out = xs.length > 1 ? (k === 0 ? -1 : 1) : 1;
        const cx = x + out * (CART.lane / 2 + 0.5);
        const z = -(CART.length + 1.4);
        part(sc, rbox(0.9, 0.9, 3.2, 0.05), P.walnut, cx, 0.45, z, { tex: 'wood' });
        part(sc, rbox(0.94, 0.05, 3.24, 0.02), P.ceramic, cx, 0.92, z, { tex: 'terrazzo', gloss: 0.4, outline: false });
        part(sc, rbox(0.6, 0.03, 2.4, 0.01), P.charcoal, cx, 0.955, z + 0.2, { outline: false, shadow: false });
        part(sc, rbox(0.4, 0.3, 0.36, 0.05), P.slate, cx, 1.1, z - 1.1, { gloss: 0.3 });
        part(sc, box(0.3, 0.16, 0.01), P.screen, cx, 1.14, z - 0.915, { glow: 1.3, ...flat });
        part(sc, cyl(0.03, 0.03, 1.6, 8), P.metal, cx + out * 0.35, 1.7, z - 1.4, { gloss: 0.5, outline: false });
        part(sc, cyl(0.24, 0.24, 0.08, 20), P.lamp, cx + out * 0.35, 2.55, z - 1.4, { rx: Math.PI / 2, glow: 1.5, ...flat });
        part(sc, torus(0.25, 0.025), P.charcoal, cx + out * 0.35, 2.55, z - 1.4, flat);
        const n = popSprite(String(k + 1), P.ink, 0.3);
        n.position.set(cx + out * 0.35, 2.56, z - 1.34);
        sc.add(n);
        this.cards.push(n);
        part(sc, rbox(CART.lane, 0.012, 0.16, 0.02), P.lamp, x, 0.006, -CART.length, { glow: 1.2, ...flat });
      });
      // More tills along the front of the shop, closed for the night.
      for (const e of [-1, 1]) {
        for (let k = 1; k <= AISLES; k++) {
          const cx = (e < 0 ? left : right) + e * (k * GAP - 1.2);
          part(sc, box(0.9, 0.9, 3.2), P.walnut, cx, 0.45, -(CART.length + 1.4), { tex: 'wood', outline: false });
          part(sc, box(0.94, 0.05, 3.24), P.ceramic, cx, 0.92, -(CART.length + 1.4), { tex: 'terrazzo', gloss: 0.4, outline: false });
        }
      }
      // The shop window at the far end: the night outside, street lamps glowing, and the sign still on.
      const wz = -(far + 0.4);
      const frame = P.charcoal;
      part(sc, box(shopW + 0.6, WALL_H - 3.7, 0.3), wallC, mid, 3.7 + (WALL_H - 3.7) / 2, wz, { tex: 'plaster', ...flat });
      part(sc, box(shopW, 0.3, 0.3), frame, mid, 0.15, wz, { outline: false });
      part(sc, box(shopW, 0.2, 0.3), frame, mid, 3.6, wz, { outline: false });
      for (let i = 0; i <= 10; i++) part(sc, box(0.16, 3.6, 0.3), frame, shopL + (i * shopW) / 10, 1.8, wz, { outline: false });
      part(sc, box(shopW, 3.3, 0.05), P.midnight, mid, 1.85, wz - 0.1, { basic: true });
      part(sc, box(shopW, 0.9, 0.05), mix(P.midnight, P.plum, 0.5), mid, 0.75, wz - 0.08, { basic: true });
      for (let i = 0; i < 5; i++) {
        const x = shopL + ((i + 0.5) * shopW) / 5 + 0.4;
        part(sc, box(0.05, 2.3, 0.05), P.ink, x, 1.45, wz - 0.3, { basic: true });
        part(sc, sphere(0.18, 12), P.lamp, x, 2.65, wz - 0.3, { glow: 2, ...flat });
      }
      const sign = props.neonSign('open late', { color: P.neonPink, h: 0.75 });
      sign.position.set(mid, 4.5, wz + 0.16);
      sc.add(sign);
    });
    // By the start, behind the carts: a palm in a pot, in the corner of the frame.
    const palm = props.plant({ kind: 'palm', h: 1.5, pot: P.charcoal });
    palm.position.set(right - 0.5, 0, 4.2);
    sc.add(palm);
  }

  /** One lane's snacks and obstacles. */
  private lane(s: Side): void {
    const sc = this.scene;
    this.course.snacks.forEach((k) => {
      const colors = SNACK_COLORS[k.kind];
      const m = snackMesh(k.kind, colors[Math.floor(this.rand() * colors.length)] as string);
      m.position.set(s.x + k.side * (CART.lane / 2 - 0.16), 0.66, -k.s);
      // A little shelf sticking out, with a lit edge so the eye finds it.
      part(sc, rbox(0.36, 0.04, 0.36, 0.015), P.slate, m.position.x, 0.63, m.position.z, { outline: 0.02 });
      part(sc, box(0.02, 0.03, 0.34), P.lamp, m.position.x - k.side * 0.18, 0.63, m.position.z, { glow: 1.3, outline: false, shadow: false });
      const spark = part(m, gem(0.06), P.lamp, 0, 0.62, 0, { glow: 1.8, outline: false, shadow: false });
      spark.name = 'spark';
      sc.add(m);
      s.snacks.push(m);
    });
    this.course.obstacles.forEach((o) => {
      const x = s.x + o.x;
      const z = -o.s;
      if (o.kind === 'wet') {
        part(sc, cyl(o.r, o.r, 0.01, 28), P.screen, x, 0.008, z, { opacity: 0.6, shadow: false, exact: true });
        part(sc, cyl(o.r * 0.55, o.r * 0.55, 0.01, 22), '#ffffff', x - o.r * 0.15, 0.011, z - o.r * 0.1, { opacity: 0.35, shadow: false, exact: true });
        const sign = new THREE.Group();
        for (const f of [-1, 1]) part(sign, rbox(0.4, 0.62, 0.03, 0.02), P.mustard, 0, 0.3, f * 0.11, { rx: f * 0.33, gloss: 0.3 });
        for (const f of [-1, 1]) part(sign, box(0.22, 0.2, 0.005), P.ink, 0, 0.36, f * (0.11 - 0.02) + f * 0.035, { rx: f * 0.33, outline: false, shadow: false });
        part(sign, rbox(0.3, 0.05, 0.24, 0.01), P.charcoal, 0, 0.6, 0, { outline: false });
        sign.position.set(x, 0, z);
        sign.rotation.y = 0.4;
        sc.add(sign);
        s.signs.push(sign);
        s.stacks.push(null);
      } else {
        const stack = new THREE.Group();
        const rows = [4, 3, 2, 1];
        const tins = [P.terracotta, P.teal];
        rows.forEach((n, row) => {
          for (let i = 0; i < n; i++) {
            const can = new THREE.Group();
            part(can, cyl(0.085, 0.085, 0.18, 14), tins[(row + i) % 2] as string, 0, 0, 0, { gloss: 0.55, outline: 0.02 });
            part(can, cyl(0.087, 0.087, 0.07, 14), P.cream, 0, 0.005, 0, { outline: false });
            part(can, cyl(0.08, 0.08, 0.186, 14), P.ceramic, 0, 0, 0, { outline: false, gloss: 0.8 });
            can.position.set((i - (n - 1) / 2) * 0.18, 0.09 + row * 0.185, ((row % 2) - 0.5) * 0.04);
            stack.add(can);
          }
        });
        part(stack, cyl(o.r, o.r, 0.04, 22), P.oak, 0, 0.02, 0, { tex: 'wood', texScale: 0.6, outline: 0.02 });
        stack.position.set(x, 0, z);
        sc.add(stack);
        s.stacks.push(stack);
        s.signs.push(null);
      }
    });
  }

  // -------------------------------------------------- what happens

  grab(k: number, index: number, kind: SnackKind): void {
    const s = this.sides[k];
    const m = s?.snacks[index];
    if (!s || !m) return;
    const color = SNACK_COLORS[kind][index % SNACK_COLORS[kind].length] as string;
    this.flying.push({ mesh: m, from: m.position.clone(), team: k, age: 0, kind, color });
    m.getObjectByName('spark')?.removeFromParent();
    this.specks.burst(m.position.clone().add(new THREE.Vector3(0, 0.3, 0)), P.lamp, { n: 7, speed: 1.6, glow: 1.8, size: 0.045 });
    this.floaters.add('+1', P.lamp, m.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 0.45, 0.9);
  }

  miss(k: number, index: number): void {
    this.sides[k]?.snacks[index]?.getObjectByName('spark')?.removeFromParent();
  }

  slip(k: number, index: number): void {
    const s = this.sides[k];
    if (!s) return;
    s.fall[index] = 0.001;
    s.sway = 1;
    this.specks.burst(new THREE.Vector3(s.x + s.cart.x, 0.1, -s.cart.s), P.screen, { n: 9, speed: 1.8, size: 0.05, up: 0.8 });
    this.floaters.add('Whoa!', P.screen, new THREE.Vector3(s.x + s.cart.x, 2.2, -s.cart.s), 0.5, 1.1);
    for (const p of s.members) this.companions[p]?.react('thinking', 1);
  }

  crash(k: number, index: number): void {
    const s = this.sides[k];
    const stack = s?.stacks[index];
    if (!s || !stack) return;
    // Every can goes its own way.
    stack.updateMatrixWorld(true);
    for (const child of [...stack.children]) {
      if (!(child instanceof THREE.Group)) continue;
      const world = child.getWorldPosition(new THREE.Vector3());
      stack.remove(child);
      child.position.copy(world);
      this.scene.add(child);
      s.cans.push({
        mesh: child,
        v: new THREE.Vector3((this.rand() - 0.5) * 3, 1.5 + this.rand() * 2.5, -(1 + this.rand() * 2.5)),
        spin: new THREE.Vector3((this.rand() - 0.5) * 14, (this.rand() - 0.5) * 6, (this.rand() - 0.5) * 14),
        resting: false,
      });
    }
    s.shove = 1;
    this.floaters.add('Crash!', mix(P.rose, P.cream, 0.5), new THREE.Vector3(s.x + s.cart.x, 2.2, -s.cart.s), 0.55, 1.2);
    for (const p of s.members) this.companions[p]?.react('sad', 1.3);
  }

  finish(k: number, first: boolean): void {
    const s = this.sides[k];
    if (!s) return;
    const at = new THREE.Vector3(s.x + s.cart.x, 1.2, -s.cart.s);
    this.specks.burst(at, P.lamp, { n: first ? 18 : 10, speed: 3, glow: 1.8 });
    if (first) this.specks.burst(at, s.color, { n: 10, speed: 2.2, glow: 1.4, size: 0.05 });
    this.floaters.add(first ? 'First to the till! +5' : 'Through the till!', first ? P.lamp : P.cream, new THREE.Vector3(s.x + s.cart.x, 2.6, -s.cart.s), 0.5, 2.4);
    for (const p of s.members) this.companions[p]?.react('happy', 2.5);
  }

  /** A stroke of the pump: the pusher leans in. */
  stroke(k: number): void {
    const s = this.sides[k];
    if (s) s.shove = Math.max(s.shove, 0.6);
  }

  /** The partners swap places: the rider hops out to the handle, the pusher hops in. */
  swap(k: number, pusher: number, rider: number): void {
    const s = this.sides[k];
    if (!s) return;
    s.pusher = pusher;
    s.rider = rider;
    s.hop = 0;
    this.floaters.add('Swap!', P.lamp, new THREE.Vector3(s.x + s.cart.x, 2.4, -s.cart.s), 0.7, 1.6);
  }

  setTilt(k: number, tilt: number): void {
    const s = this.sides[k];
    if (s) s.tilt = tilt;
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
    for (const card of this.cards) {
      card.material.map?.dispose();
      card.material.dispose();
    }
    for (const o of this.owned) o.dispose();
  }

  // -------------------------------------------------- every frame

  update(dt: number): void {
    this.time += dt;
    for (const c of this.companions) c.update(dt);
    for (const s of this.sides) this.ride(s, dt);
    this.flyIn(dt);
    this.specks.update(dt);
    this.tick(dt, this.time);
    this.floaters.update(dt);
    this.frame(dt);
  }

  private ride(s: Side, dt: number): void {
    const c = s.cart;
    s.lean += (s.tilt - s.lean) * (1 - Math.exp(-8 * dt));
    s.shove = Math.max(0, s.shove - dt * 3);
    s.sway = Math.max(0, s.sway - dt * 1.4);
    s.bump = Math.max(0, s.bump - dt * 5);
    s.pile.position.y = BASKET_Y + 0.02 + Math.sin(s.bump * Math.PI) * 0.05;
    const wobble = Math.sin(this.time * 14) * 0.25 * s.sway;
    const pos = new THREE.Vector3(s.x + c.x, 0, -c.s);
    s.group.position.copy(pos);
    s.group.rotation.set(0, -c.vx * 0.12 + wobble, 0);
    s.card.position.set(pos.x, 2.25, pos.z + 0.3);

    // The partners: one in the basket, one at the handle (or hopping over during the swap).
    const inBasket = pos.clone().add(new THREE.Vector3(0, BASKET_Y + 0.02, -0.05));
    const atHandle = pos.clone().add(new THREE.Vector3(0, 0, HANDLE_Z - s.shove * 0.08));
    if (s.hop !== null) s.hop = Math.min(1, s.hop + dt / HOP);
    const k = s.hop ?? 1;
    const arc = Math.sin(Math.PI * k) * 0.9;
    const rider = s.rider >= 0 ? this.companions[s.rider] : undefined;
    const pusher = s.pusher >= 0 ? this.companions[s.pusher] : undefined;
    if (rider) {
      rider.root.position.lerpVectors(atHandle, inBasket, k);
      rider.root.position.y += arc;
      rider.root.rotation.set(0, Math.PI, s.lean * 0.35 * k);
      rider.move(null);
    }
    if (pusher) {
      pusher.root.position.lerpVectors(inBasket, atHandle, k);
      pusher.root.position.y += arc;
      pusher.root.rotation.set(-s.shove * 0.12, Math.PI, 0);
      pusher.move(c.v > 2.3 ? 'run' : c.v > 0.2 ? 'walk' : null, c.v);
    }
    if (s.hop !== null && s.hop >= 1) s.hop = null;

    // Snacks sparkle while they're there for the taking.
    s.snacks.forEach((m, i) => {
      const spark = m.getObjectByName('spark');
      if (spark) {
        spark.position.y = 0.62 + Math.sin(this.time * 3 + i) * 0.06;
        spark.rotation.y += dt * 2;
        // the snack itself turns a little on its shelf, to catch the eye
        m.rotation.y = Math.sin(this.time * 1.6 + i * 1.3) * 0.35;
      }
    });
    // Knocked-over wet floor signs fall flat; tumbling cans fly, bounce and roll to a stop.
    s.signs.forEach((sign, i) => {
      const f = s.fall[i] ?? 0;
      if (!sign || f <= 0 || f >= 1) return;
      s.fall[i] = Math.min(1, f + dt * 4);
      sign.rotation.set(-(s.fall[i] ?? 0) * (Math.PI / 2 - 0.2), sign.rotation.y, 0);
    });
    for (const can of s.cans) {
      if (can.resting) continue;
      can.v.y -= 12 * dt;
      can.mesh.position.addScaledVector(can.v, dt);
      can.mesh.rotation.x += can.spin.x * dt;
      can.mesh.rotation.y += can.spin.y * dt;
      can.mesh.rotation.z += can.spin.z * dt;
      // The shelves keep the cans in the lane.
      const wall = CART.lane / 2 - 0.1;
      if (Math.abs(can.mesh.position.x - s.x) > wall) {
        can.mesh.position.x = s.x + Math.sign(can.mesh.position.x - s.x) * wall;
        can.v.x *= -0.4;
      }
      if (can.mesh.position.y <= 0.085) {
        can.mesh.position.y = 0.085;
        if (can.v.y < -1.5) {
          can.v.set(can.v.x * 0.6, -can.v.y * 0.35, can.v.z * 0.6);
          can.spin.multiplyScalar(0.5);
        } else {
          can.v.multiplyScalar(Math.exp(-3 * dt));
          can.v.y = 0;
          can.mesh.rotation.set(Math.PI / 2, can.mesh.rotation.y, 0);
          if (can.v.length() < 0.05) can.resting = true;
        }
      }
    }
  }

  /** Grabbed snacks arc into the basket and join the pile. */
  private flyIn(dt: number): void {
    this.flying = this.flying.filter((f) => {
      const s = this.sides[f.team];
      if (!s) return false;
      f.age += dt;
      const k = Math.min(1, f.age / 0.35);
      const to = new THREE.Vector3(s.x + s.cart.x, BASKET_Y + 0.4, -s.cart.s);
      f.mesh.position.lerpVectors(f.from, to, k);
      f.mesh.position.y += Math.sin(Math.PI * k) * 0.5;
      f.mesh.rotation.y += dt * 8;
      f.mesh.scale.setScalar(1 - k * 0.4);
      if (k < 1) return true;
      f.mesh.removeFromParent();
      s.bump = 1;
      if (s.piled < PILE_MAX) {
        const item = pileMesh(f.kind, f.color);
        const i = s.piled++;
        item.position.set(((i % 3) - 1) * 0.2, 0.09 + Math.floor(i / 6) * 0.15, (Math.floor(i / 3) % 2) * 0.24 - 0.12 + 0.18);
        item.rotation.set(0, (i * 1.7) % 1, (i % 2) * 0.3);
        s.pile.add(item);
      }
      return false;
    });
  }

  /** Follows both carts from behind and above, keeping them and the stretch ahead in the clear part of the screen. */
  private frame(dt: number): void {
    if (this.time - this.fitAt >= 0.1 || !this.placed) {
      this.fitAt = this.time;
      this.probe.fov = this.camera.fov;
      this.probe.aspect = this.camera.aspect;
      this.probe.updateProjectionMatrix();
      const marks: Mark[] = [];
      const back = Math.min(...this.sides.map((s) => s.cart.s));
      const front = Math.max(...this.sides.map((s) => s.cart.s));
      for (const s of this.sides) {
        marks.push({ p: new THREE.Vector3(s.x + s.cart.x, 2.25, -s.cart.s + 0.3), pad: 0.05 });
        for (const e of [-1, 1]) {
          const x = s.x + e * (CART.lane / 2);
          marks.push({ p: new THREE.Vector3(x, 0, -(back - 1.6)) }, { p: new THREE.Vector3(x, 2.4, -(back - 1.2)), pad: 0.05 });
          marks.push({ p: new THREE.Vector3(x, 0, -Math.min(CART.length + 2, front + 7)) });
        }
      }
      this.goal = frameMarks(this.probe, marks, TILT);
    }
    const k = this.placed ? 1 - Math.exp(-3 * dt) : 1;
    this.placed = true;
    this.camera.position.lerp(this.goal.pos, k);
    this.look.lerp(this.goal.look, k);
    this.camera.lookAt(this.look);
    // The shadows keep to the stretch of aisle on screen.
    this.sun.target.position.set(this.look.x, 0, this.look.z - 3);
    this.sun.position.set(this.look.x + SUN[0] * 60, SUN[1] * 60, this.look.z - 3 + SUN[2] * 60);
  }
}

// ------------------------------------------------------------------ sounds

function rustle(sfx: Sfx): void {
  noise(sfx, { dur: 0.12, filter: 'bandpass', freq: 3200, to: 2200, gain: 0.25 });
  tone(sfx, { freq: 880, to: 1320, dur: 0.12, gain: 0.08 });
}

function splash(sfx: Sfx): void {
  noise(sfx, { dur: 0.35, filter: 'bandpass', freq: 1400, to: 500, gain: 0.3 });
}

function clatter(sfx: Sfx): void {
  for (let i = 0; i < 5; i++) noise(sfx, { dur: 0.07, filter: 'bandpass', freq: 2600 + i * 300, gain: 0.22, delay: i * 0.07 });
  tone(sfx, { freq: 200, to: 120, dur: 0.2, type: 'triangle', gain: 0.12 });
}

function chime(sfx: Sfx): void {
  tone(sfx, { freq: 659, dur: 0.18, type: 'triangle', gain: 0.12 });
  tone(sfx, { freq: 988, dur: 0.3, type: 'triangle', gain: 0.12, delay: 0.12 });
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'cartrace',
  title: 'Midnight Snack Run',
  how: 'One of you pumps the phone to push the cart, the other tilts to steer it past the shelves and grab snacks. Mind the wet floor and the cans! Halfway, you swap. A point per snack, and 5 more for the first cart to the till.',
  controller: 'pump',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const course = makeCourse(rng);
    const carts = teams.map(() => newCart(course));
    const skill = seats.map(() => ctx.skill());
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT })));
    const view = new Supermarket(seats, teams, companions, course, carts);
    ctx.stage.setView(view);

    const teamOf = new Map<number, number>();
    teams.forEach((t, k) => t.forEach((p) => teamOf.set(p, k)));
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');

    // Jobs: the first partner pushes first. A team of one pushes, then steers, with the cart helping out.
    let swapped = false;
    const pusherOf = (k: number): number | null => {
      const m = teams[k] ?? [];
      if (m.length < 2) return swapped ? null : (m[0] ?? null);
      return m[swapped ? 1 : 0] ?? null;
    };
    const steererOf = (k: number): number | null => {
      const m = teams[k] ?? [];
      if (m.length < 2) return swapped ? (m[0] ?? null) : null;
      return m[swapped ? 0 : 1] ?? null;
    };
    const pushers: CpuPusher[] = seats.map(() => newCpuPusher());
    const steerers: CpuSteerer[] = seats.map(() => newCpuSteerer());
    const helpPush = teams.map(() => newCpuPusher());
    const helpSteer = teams.map(() => newCpuSteerer());
    const tiltIn = seats.map(() => 0);
    const tilts = teams.map(() => 0);

    const brief = (p: number, swap: boolean) => {
      const k = teamOf.get(p) ?? 0;
      const partner = (teams[k] ?? []).find((m) => m !== p);
      const pushing = pusherOf(k) === p;
      const mate = partner === undefined ? null : (seats[partner]?.name ?? 'your partner');
      const layout: Layout = pushing
        ? { kind: 'pump', label: 'Push', redline: false, note: mate ? `Pump to push the cart. ${mate} steers.` : 'Pump to push the cart.' }
        : { kind: 'tilt', title: 'Midnight Snack Run · you steer', icon: '🛒', note: mate ? `Tilt to steer close to the shelves. ${mate} pushes.` : 'Tilt to steer close to the shelves.' };
      session.setLayout(seatOf(p), layout);
      const lead = swap ? 'Swap! ' : '';
      const text =
        partner === undefined
          ? pushing
            ? `${lead}You push! The cart steers itself a little.`
            : `${lead}Now you steer: tilt to grab snacks! The cart rolls itself.`
          : pushing
            ? `${lead}You push, ${nameOf(partner)} steers!`
            : `${lead}You steer: tilt to grab snacks! ${nameOf(partner)} pushes.`;
      tell(p, true, text);
      if (swap) buzz(p, [40, 40, 40]);
    };
    seats.forEach((_, p) => brief(p, false));

    let now = 0;
    let over = false;
    const off = session.onInput((seat, msg) => {
      if (over || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      const k = p === undefined ? undefined : teamOf.get(p);
      if (p === undefined || k === undefined) return;
      if (msg.t === 'tilt') tiltIn[p] = msg.x;
      else if (msg.t === 'pump' && pusherOf(k) === p && !swapping(now)) {
        const c = carts[k];
        if (c && pushCart(c, msg.power)) view.stroke(k);
      }
    });

    const onEvent = (k: number, e: CartEvent) => {
      const members = teams[k] ?? [];
      switch (e.kind) {
        case 'snack': {
          view.grab(k, e.index, e.snack);
          rustle(sfx);
          const st = steererOf(k);
          if (st !== null) buzz(st, [15]);
          break;
        }
        case 'missed':
          view.miss(k, e.index);
          break;
        case 'slip':
          view.slip(k, e.index);
          splash(sfx);
          for (const p of members) {
            tell(p, false, 'Whoa, wet floor!');
            buzz(p, [40, 30, 40]);
          }
          break;
        case 'crash':
          view.crash(k, e.index);
          clatter(sfx);
          for (const p of members) {
            tell(p, false, 'Crash! Cans everywhere.');
            buzz(p, [90, 50, 90]);
          }
          break;
        case 'finish': {
          const c = carts[k];
          const first = c ? wasFirst(carts, c) : false;
          view.finish(k, first);
          if (first) sfx.good();
          else chime(sfx);
          for (const p of members) tell(p, true, first ? 'First to the till! +5' : 'Through the till!');
          break;
        }
      }
    };

    const CAPTION = 'Push and steer: grab snacks off the shelves on the way to the till!';
    ui.caption(CAPTION);
    let acc = 0;
    let simT = 0;
    let hudAt = -1;
    let meterAt = -1;
    let captionBack = false;
    await everyFrame(clock, (dt, t) => {
      now = t;
      // Halfway: everybody swaps jobs.
      if (!swapped && t >= CART.swapAt) {
        swapped = true;
        ui.caption('Swap! Pushers steer, steerers push.', '#fff6a8');
        tone(sfx, { freq: 520, to: 780, dur: 0.25, type: 'triangle', gain: 0.14 });
        tone(sfx, { freq: 780, to: 520, dur: 0.25, type: 'triangle', gain: 0.12, delay: 0.25 });
        teams.forEach((_, k) => view.swap(k, pusherOf(k) ?? -1, steererOf(k) ?? -1));
        tiltIn.fill(0);
        seats.forEach((_, p) => brief(p, true));
      }
      if (swapped && !captionBack && !swapping(t)) {
        captionBack = true;
        ui.caption(CAPTION);
      }
      const pause = swapping(t);
      teams.forEach((_, k) => {
        const c = carts[k];
        if (!c) return;
        if (!pause && c.finishedAt === null) {
          const p = pusherOf(k);
          const power = p === null ? cpuPush(helpPush[k] as CpuPusher, 0.55, rng, t, dt) : cpu(p) ? cpuPush(pushers[p] as CpuPusher, skill[p] ?? 0.5, rng, t, dt) : 0;
          if (power > 0 && pushCart(c, power)) view.stroke(k);
        }
        const st = steererOf(k);
        const tilt = pause ? 0 : st === null ? cpuSteer(helpSteer[k] as CpuSteerer, c, course, 0.55, rng, t) : cpu(st) ? cpuSteer(steerers[st] as CpuSteerer, c, course, skill[st] ?? 0.5, rng, t) : (tiltIn[st] ?? 0);
        tilts[k] = tilt;
        view.setTilt(k, tilt);
      });
      // Fixed physics steps, however long the frame was.
      acc += dt;
      while (acc >= CART.step) {
        acc -= CART.step;
        simT += CART.step;
        carts.forEach((c, k) => {
          for (const e of stepCart(c, course, tilts[k] ?? 0, simT)) onEvent(k, e);
        });
      }
      // The pusher's gauge shows how fast the cart is going.
      if (t - meterAt >= 0.1) {
        meterAt = t;
        teams.forEach((_, k) => {
          const p = pusherOf(k);
          const c = carts[k];
          if (p !== null && c && !cpu(p)) session.send(seatOf(p), { t: 'meter', value: Math.min(1, c.v / 3.2), danger: false });
        });
      }
      if (t - hudAt >= 0.1) {
        hudAt = t;
        ui.timer(CART.duration - t);
        ui.live(
          teams.map((members, k) => {
            const lead = seats[members[0] ?? 0];
            const c = carts[k];
            const n = c?.snacks ?? 0;
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} snack${n === 1 ? '' : 's'}${c?.finishedAt != null ? ' · till' : ''}` };
          }),
        );
      }
      return t >= CART.duration || carts.every((c) => c.finishedAt !== null);
    });
    over = true;
    off();
    ui.timer(null);
    ui.caption(null);
    for (const s of seats) session.send(s.index, { t: 'meter', value: 0, danger: false });

    // Done: the team with the most (snacks + till bonus) cheers.
    const team = cartScores(carts);
    const best = Math.max(...team);
    const tie = team.length > 1 && team.every((s) => s === best);
    sfx.good();
    teams.forEach((members, k) => {
      const won = team[k] === best;
      for (const p of members) {
        companions[p]?.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) companions[p]?.react('happy', 3);
        tell(p, won, tie ? 'Dead level! Same haul each.' : won ? `Best haul: ${team[k]} points!` : `Their haul was bigger: ${best} to ${team[k]}.`);
      }
    });
    await clock.wait(1.8);

    return {
      scores: cartSeatScores(carts, teams, seats.length),
      details: seats.map((_, p) => {
        const k = teamOf.get(p);
        const c = k === undefined ? undefined : carts[k];
        if (!c) return '';
        const n = `${c.snacks} snack${c.snacks === 1 ? '' : 's'}`;
        return wasFirst(carts, c) ? `${n} · first to the till` : c.finishedAt !== null ? `${n} · till at ${c.finishedAt.toFixed(1)} s` : n;
      }),
    };
  },
};
