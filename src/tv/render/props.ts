// The props library: furniture, lamps, plants, kitchen things, garden things. Everything is built in code from
// the toon shapes and library textures, so it all shares one look.
//
// Conventions:
//  - every function returns a THREE.Group with its origin on the floor at the prop's centre (wall things: on the
//    wall, facing +z; hanging things: at the ceiling), about real-world size with 1 unit = 1 metre. The players'
//    companions are about 1.5 tall and stubby, so scale furniture they sit on up a little (`g.scale.setScalar(1.3)`).
//  - options are optional; colours default to palette tokens that go together.
//  - props that move (flames, water, flicker) carry a `userData.tick(dt, time)`; call `tickProps(root)` once to
//    collect them and run the returned function every frame (the environment builders do this for you).
//  - lamps add a real light only when asked (`light: true`): keep a scene to three or four point lights.
import * as THREE from 'three';
import type { TextureName } from './textures';
import { FONT, PALETTE as P, type PartOptions, ball, box, canvasTexture, cone, cyl, disc, lathe, mix, part, pill, rbox, seeded, sphere, toonMat, torus } from './toon';

export type Prop = THREE.Group;
type Tick = (dt: number, time: number) => void;

function group(name: string): Prop {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

/** Collects the animated props under `root`; call the returned function every frame. */
export function tickProps(root: THREE.Object3D): Tick {
  const ticks: Tick[] = [];
  root.traverse((o) => {
    const t = o.userData.tick as Tick | undefined;
    if (t) ticks.push(t);
  });
  return (dt, time) => {
    for (const t of ticks) t(dt, time);
  };
}

const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length] as T;
/** Fabric colours that sit well together on sofas, cushions, books and rugs. */
export const FABRICS = [P.terracotta, P.mustard, P.rose, P.mauve, P.denim, P.teal, P.forest, P.sage] as const;
const NO_LINE: PartOptions = { outline: false };

// ------------------------------------------------------------------ seating

export interface SofaOptions {
  seats?: number;
  color?: string;
  /** Accent cushions, one colour each. */
  pillows?: readonly string[];
  legs?: string;
  tex?: TextureName;
  /** Width per seat. */
  seatW?: number;
}

/** A sofa. Seat top at 0.6; the seat cushions run from z = -0.25 to 0.45. */
export function sofa(o: SofaOptions = {}): Prop {
  const g = group('sofa');
  const n = o.seats ?? 3;
  const c = o.color ?? P.mauve;
  const sw = o.seatW ?? 0.72;
  const w = n * sw;
  const fab: PartOptions = { tex: o.tex ?? 'fabric', texStrength: 0.85 };
  const dark = mix(c, P.ink, 0.2);
  const light = mix(c, '#ffffff', 0.07);
  part(g, rbox(w + 0.5, 0.32, 0.95, 0.08), dark, 0, 0.28, 0, fab);
  part(g, rbox(w + 0.5, 0.78, 0.26, 0.11), c, 0, 0.63, -0.36, fab);
  for (const s of [-1, 1]) part(g, rbox(0.26, 0.58, 0.95, 0.11), c, s * (w / 2 + 0.13), 0.51, 0, fab);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * sw;
    part(g, rbox(sw - 0.03, 0.2, 0.7, 0.08), light, x, 0.5, 0.1, fab);
    part(g, rbox(sw - 0.05, 0.44, 0.2, 0.09), light, x, 0.82, -0.2, { ...fab, rx: -0.12 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, cyl(0.035, 0.025, 0.14, 10), o.legs ?? P.walnut, sx * (w / 2 + 0.12), 0.07, sz * 0.36, NO_LINE);
  (o.pillows ?? []).forEach((pc, i) => {
    const side = i % 2 ? 1 : -1;
    part(g, rbox(0.4, 0.4, 0.15, 0.07), pc, side * (w / 2 - 0.22 - (i >> 1) * 0.34), 0.8, 0.02, { tex: 'knit', rz: side * 0.22, rx: -0.22 });
  });
  return g;
}

/** An armchair, one seat wide. */
export function armchair(o: { color?: string; tex?: TextureName; pillow?: string } = {}): Prop {
  const g = sofa({ seats: 1, color: o.color ?? P.terracotta, tex: o.tex ?? 'velvet', seatW: 0.78, ...(o.pillow ? { pillows: [o.pillow] } : {}) });
  g.name = 'armchair';
  return g;
}

/** A slouchy beanbag. */
export function beanbag(o: { color?: string; r?: number; tex?: TextureName } = {}): Prop {
  const g = group('beanbag');
  const r = o.r ?? 0.55;
  const c = o.color ?? P.mustard;
  const fab: PartOptions = { tex: o.tex ?? 'velvet', texStrength: 0.8 };
  part(g, sphere(r), c, 0, r * 0.55, 0, { ...fab, sy: 0.62 });
  part(g, sphere(r * 0.72), mix(c, '#ffffff', 0.06), 0, r * 0.92, -r * 0.18, { ...fab, sy: 0.7 });
  part(g, sphere(r * 0.12), mix(c, P.ink, 0.25), 0, r * 1.36, -r * 0.2, NO_LINE);
  return g;
}

/** A round floor cushion or pouf. */
export function pouf(o: { color?: string; r?: number; h?: number; tex?: TextureName } = {}): Prop {
  const g = group('pouf');
  const r = o.r ?? 0.34;
  const h = o.h ?? 0.3;
  part(g, sphere(r), o.color ?? P.rose, 0, h / 2, 0, { tex: o.tex ?? 'knit', sy: h / (2 * r) });
  return g;
}

/** A bed with a headboard, pillows and a folded blanket. Mattress top at about 0.55. */
export function bed(o: { w?: number; color?: string; blanket?: string; frame?: string } = {}): Prop {
  const g = group('bed');
  const w = o.w ?? 1.5;
  const L = 2.05;
  const frame = o.frame ?? P.walnut;
  const wood: PartOptions = { tex: 'wood' };
  part(g, rbox(w + 0.12, 0.22, L + 0.1, 0.04), frame, 0, 0.2, 0, wood);
  part(g, rbox(w + 0.12, 1.0, 0.1, 0.05), frame, 0, 0.6, -L / 2 - 0.02, wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, cyl(0.04, 0.035, 0.12, 10), frame, sx * (w / 2 - 0.05), 0.06, sz * (L / 2 - 0.06), NO_LINE);
  part(g, rbox(w, 0.26, L, 0.1), P.cream, 0, 0.42, 0, { tex: 'fabric', texStrength: 0.5 });
  part(g, rbox(w + 0.04, 0.2, L * 0.62, 0.09), o.color ?? P.denim, 0, 0.5, L * 0.19, { tex: 'fabric' });
  part(g, rbox(w + 0.06, 0.1, 0.45, 0.05), o.blanket ?? P.mustard, 0, 0.62, L * 0.3, { tex: 'knit' });
  for (const s of [-1, 1]) part(g, rbox(w * 0.4, 0.16, 0.36, 0.07), P.ceramic, s * w * 0.23, 0.62, -L / 2 + 0.3, { tex: 'fabric', texStrength: 0.4, rx: -0.2 });
  return g;
}

// ------------------------------------------------------------------ tables, rugs, shelves

/** A low coffee table (rectangular, or round with `round`). Top at `h`. */
export function coffeeTable(o: { w?: number; d?: number; h?: number; color?: string; round?: boolean; tex?: TextureName } = {}): Prop {
  const g = group('coffeeTable');
  const w = o.w ?? 1.4;
  const d = o.d ?? 0.75;
  const h = o.h ?? 0.42;
  const c = o.color ?? P.oak;
  const wood: PartOptions = { tex: o.tex ?? 'wood' };
  const leg = mix(c, P.ink, 0.25);
  if (o.round) {
    part(g, cyl(w / 2, w / 2, 0.06, 36), c, 0, h - 0.03, 0, wood);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      part(g, cyl(0.03, 0.022, h - 0.06, 10), leg, Math.cos(a) * w * 0.32, (h - 0.06) / 2, Math.sin(a) * w * 0.32, { ...NO_LINE, rz: Math.cos(a) * 0.12, rx: -Math.sin(a) * 0.12 });
    }
  } else {
    part(g, rbox(w, 0.07, d, 0.03), c, 0, h - 0.035, 0, wood);
    part(g, rbox(w * 0.86, 0.035, d * 0.8, 0.015), leg, 0, h * 0.36, 0, wood);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, rbox(0.06, h - 0.07, 0.06, 0.02), leg, sx * (w / 2 - 0.07), (h - 0.07) / 2, sz * (d / 2 - 0.07), wood);
  }
  return g;
}

/** A small round side table. */
export function sideTable(o: { h?: number; r?: number; color?: string } = {}): Prop {
  const g = group('sideTable');
  const h = o.h ?? 0.55;
  const r = o.r ?? 0.26;
  const c = o.color ?? P.walnut;
  part(g, cyl(r, r, 0.045, 28), c, 0, h - 0.022, 0, { tex: 'wood' });
  part(g, cyl(0.03, 0.03, h - 0.06, 10), mix(c, P.ink, 0.3), 0, (h - 0.04) / 2, 0, NO_LINE);
  part(g, cyl(r * 0.7, r * 0.75, 0.03, 24), mix(c, P.ink, 0.3), 0, 0.015, 0);
  return g;
}

/** A dining or work table. Top at `h`. */
export function table(o: { w?: number; d?: number; h?: number; color?: string; cloth?: string } = {}): Prop {
  const g = group('table');
  const w = o.w ?? 1.6;
  const d = o.d ?? 0.9;
  const h = o.h ?? 0.76;
  const c = o.color ?? P.oak;
  part(g, rbox(w, 0.06, d, 0.025), c, 0, h - 0.03, 0, { tex: 'wood' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, rbox(0.07, h - 0.06, 0.07, 0.02), mix(c, P.ink, 0.2), sx * (w / 2 - 0.08), (h - 0.06) / 2, sz * (d / 2 - 0.08), { tex: 'wood' });
  if (o.cloth) part(g, rbox(w * 0.55, 0.012, d + 0.3, 0.005), o.cloth, 0, h + 0.006, 0, { tex: 'gingham', ...NO_LINE });
  return g;
}

/** A low sideboard or media unit with doors, `w` wide. Top at `h`. */
export function sideboard(o: { w?: number; h?: number; d?: number; color?: string } = {}): Prop {
  const g = group('sideboard');
  const w = o.w ?? 1.8;
  const h = o.h ?? 0.42;
  const d = o.d ?? 0.42;
  const c = o.color ?? P.walnut;
  part(g, rbox(w, h - 0.08, d, 0.02), c, 0, h / 2 + 0.04, 0, { tex: 'wood' });
  for (const s of [-1, 1]) part(g, box(0.05, 0.08, d - 0.12), P.charcoal, s * (w / 2 - 0.15), 0.04, 0, NO_LINE);
  const doors = Math.max(2, Math.round(w / 0.6));
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (i + 0.5) * (w / doors);
    part(g, rbox(w / doors - 0.04, h - 0.14, 0.012, 0.005), mix(c, '#ffffff', 0.06), x, h / 2 + 0.04, d / 2 + 0.004, { outline: 0.01, tex: 'wood' });
    part(g, sphere(0.014, 8), P.brass, x + (i % 2 ? -1 : 1) * (w / doors / 2 - 0.07), h / 2 + 0.06, d / 2 + 0.02, { ...NO_LINE, gloss: 0.6 });
  }
  return g;
}

/** A stool or simple chair-height seat. */
export function stool(o: { h?: number; color?: string; seat?: string } = {}): Prop {
  const g = group('stool');
  const h = o.h ?? 0.48;
  const c = o.color ?? P.walnut;
  part(g, cyl(0.19, 0.19, 0.06, 24), o.seat ?? P.terracotta, 0, h - 0.03, 0, { tex: 'leather' });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    part(g, cyl(0.022, 0.018, h - 0.05, 8), c, Math.cos(a) * 0.14, (h - 0.05) / 2, Math.sin(a) * 0.14, { ...NO_LINE, rz: Math.cos(a) * 0.15, rx: -Math.sin(a) * 0.15 });
  }
  return g;
}

/** A rug lying on the floor: rectangular or round, with a border. */
export function rug(o: { w?: number; d?: number; color?: string; border?: string; round?: boolean; tex?: TextureName } = {}): Prop {
  const g = group('rug');
  const w = o.w ?? 3;
  const d = o.d ?? 2;
  const c = o.color ?? P.terracotta;
  const border = o.border ?? mix(c, P.cream, 0.55);
  const fab: PartOptions = { tex: o.tex ?? 'terry', shadow: false, outline: false };
  if (o.round) {
    part(g, cyl(w / 2, w / 2, 0.02, 48), border, 0, 0.01, 0, fab);
    part(g, cyl(w / 2 - 0.14, w / 2 - 0.14, 0.02, 48), c, 0, 0.016, 0, fab);
    part(g, cyl(w / 4, w / 4, 0.02, 40), mix(c, P.ink, 0.14), 0, 0.02, 0, fab);
  } else {
    part(g, rbox(w, 0.02, d, 0.008), border, 0, 0.01, 0, fab);
    part(g, rbox(w - 0.26, 0.02, d - 0.26, 0.008), c, 0, 0.016, 0, fab);
    part(g, rbox(w - 0.7, 0.02, d - 0.7, 0.008), mix(c, P.ink, 0.14), 0, 0.02, 0, fab);
  }
  return g;
}

/** A row of books standing on y = 0, `w` wide, starting at x = 0. */
export function books(w: number, seed = 1, o: { h?: number; d?: number } = {}): Prop {
  const g = group('books');
  const rand = seeded(seed);
  const maxH = o.h ?? 0.28;
  const d = o.d ?? 0.19;
  let x = 0;
  while (x < w - 0.03) {
    const t = 0.028 + rand() * 0.035;
    const h = maxH * (0.68 + rand() * 0.32);
    const c = mix(pick(rand, FABRICS), rand() < 0.5 ? P.cream : P.ink, rand() * 0.35);
    const lean = rand() < 0.1 ? 0.2 : 0;
    part(g, box(t, h, d * (0.85 + rand() * 0.15)), c, x + t / 2 + lean * h * 0.4, h / 2, 0, { outline: 0.012, rz: -lean });
    x += t + lean * h * 0.8 + 0.002;
    if (rand() < 0.08) x += 0.07 + rand() * 0.1;
  }
  return g;
}

/** A bookshelf against a wall: books, a plant, a few objects. */
export function bookshelf(o: { w?: number; h?: number; shelves?: number; color?: string; seed?: number } = {}): Prop {
  const g = group('bookshelf');
  const w = o.w ?? 1.3;
  const h = o.h ?? 1.9;
  const n = o.shelves ?? 4;
  const c = o.color ?? P.walnut;
  const d = 0.32;
  const rand = seeded(o.seed ?? 7);
  const wood: PartOptions = { tex: 'wood' };
  for (const s of [-1, 1]) part(g, box(0.04, h, d), c, s * (w / 2 - 0.02), h / 2, 0, wood);
  part(g, box(w - 0.04, h, 0.02), mix(c, P.ink, 0.35), 0, h / 2, -d / 2 + 0.01, { ...wood, outline: false });
  for (let i = 0; i <= n; i++) {
    const y = 0.06 + (i * (h - 0.1)) / n;
    part(g, box(w - 0.06, 0.035, d), c, 0, y, 0, wood);
    if (i === n) break;
    const gap = (h - 0.1) / n - 0.05;
    const kind = rand();
    const row = books((w - 0.14) * (kind < 0.35 ? 0.55 : 0.95), Math.floor(rand() * 1e6), { h: gap * 0.82, d: d * 0.62 });
    row.position.set(-w / 2 + 0.07, y + 0.018, 0.02);
    g.add(row);
    if (kind < 0.35) {
      const item = rand() < 0.5 ? plant({ kind: 'trailing', h: gap * 0.6 }) : vase({ color: pick(rand, FABRICS), h: gap * 0.7 });
      item.position.set(w * 0.28, y + 0.018, 0.02);
      g.add(item);
    }
  }
  return g;
}

/** A shelf on the wall with a few things on it. Origin on the wall, at the shelf's height. */
export function wallShelf(o: { w?: number; color?: string; seed?: number; items?: 'books' | 'kitchen' } = {}): Prop {
  const g = group('wallShelf');
  const w = o.w ?? 1.2;
  const rand = seeded(o.seed ?? 3);
  part(g, rbox(w, 0.04, 0.24, 0.015), o.color ?? P.oak, 0, 0, 0.12, { tex: 'wood' });
  for (const s of [-1, 1]) part(g, box(0.03, 0.12, 0.03), P.charcoal, s * w * 0.38, -0.07, 0.03, NO_LINE);
  if (o.items === 'kitchen') {
    let x = -w / 2 + 0.14;
    while (x < w / 2 - 0.1) {
      const item = rand() < 0.5 ? mug({ color: pick(rand, FABRICS) }) : rand() < 0.6 ? plates({ n: 3 + Math.floor(rand() * 4) }) : jar({ color: pick(rand, FABRICS) });
      item.position.set(x, 0.02, 0.12);
      g.add(item);
      x += 0.2 + rand() * 0.12;
    }
  } else {
    const row = books(w * 0.5, Math.floor(rand() * 1e6), { h: 0.24, d: 0.16 });
    row.position.set(-w / 2 + 0.06, 0.02, 0.12);
    g.add(row);
    const p = plant({ kind: 'trailing', h: 0.22 });
    p.position.set(w * 0.3, 0.02, 0.12);
    g.add(p);
  }
  return g;
}

// ------------------------------------------------------------------ lamps and lights

export interface LampOptions {
  h?: number;
  shade?: string;
  stand?: string;
  /** The glow colour (default the palette's warm lamp light). */
  color?: string;
  lit?: boolean;
  /** Add a real point light (default false: most lamps are just glowing shades). A number sets its strength. */
  light?: boolean | number;
}

function lampLight(g: Prop, o: LampOptions, x: number, y: number, z: number, reach: number): void {
  if (!o.light || o.lit === false) return;
  const light = new THREE.PointLight(o.color ?? P.lamp, typeof o.light === 'number' ? o.light : 9, reach, 1.6);
  light.position.set(x, y, z);
  g.add(light);
  g.userData.light = light;
}

function shade(g: Prop, o: LampOptions, x: number, y: number, z: number, rTop: number, rBottom: number, h: number): void {
  const lit = o.lit !== false;
  const c = o.shade ?? P.cream;
  const mat = toonMat({ color: lit ? mix(c, o.color ?? P.lamp, 0.45) : c, emissive: new THREE.Color(o.color ?? P.lamp), emissiveIntensity: lit ? 0.85 : 0, side: THREE.DoubleSide });
  part(g, new THREE.CylinderGeometry(rTop, rBottom, h, 28, 1, true), c, x, y, z, { material: mat, outline: false, shadow: false });
  if (lit) part(g, sphere(Math.min(rTop, rBottom) * 0.55), o.color ?? P.lamp, x, y - h * 0.1, z, { glow: 2.2, outline: false, shadow: false });
}

/** A standing lamp with an arc and a fabric shade. */
export function floorLamp(o: LampOptions = {}): Prop {
  const g = group('floorLamp');
  const h = o.h ?? 1.75;
  const stand = o.stand ?? P.charcoal;
  part(g, cyl(0.17, 0.19, 0.035, 24), stand, 0, 0.018, 0, { gloss: 0.3 });
  part(g, cyl(0.016, 0.016, h - 0.3, 8), stand, 0, (h - 0.3) / 2, 0, NO_LINE);
  shade(g, o, 0, h - 0.2, 0, 0.16, 0.25, 0.34);
  lampLight(g, o, 0, h - 0.25, 0, 9);
  return g;
}

/** A small lamp for a side table or shelf. */
export function tableLamp(o: LampOptions = {}): Prop {
  const g = group('tableLamp');
  const h = o.h ?? 0.46;
  const base = o.stand ?? P.teal;
  part(g, lathe([[0.0, 0], [0.09, 0], [0.11, 0.05], [0.07, h * 0.36], [0.03, h * 0.5], [0.0, h * 0.5]], 20), base, 0, 0, 0, { gloss: 0.45 });
  shade(g, o, 0, h * 0.76, 0, 0.09, 0.15, h * 0.42);
  lampLight(g, o, 0, h * 0.7, 0, 6);
  return g;
}

/** A lamp hanging on a cord. Origin at the ceiling; the shade hangs `drop` below. */
export function pendantLamp(o: LampOptions & { drop?: number; r?: number } = {}): Prop {
  const g = group('pendantLamp');
  const drop = o.drop ?? 1;
  const r = o.r ?? 0.24;
  const c = o.shade ?? P.brass;
  part(g, cyl(0.008, 0.008, drop, 6), P.ink, 0, -drop / 2, 0, NO_LINE);
  part(g, cyl(0.05, 0.05, 0.03, 12), P.charcoal, 0, -0.015, 0, NO_LINE);
  const lit = o.lit !== false;
  const mat = toonMat({ color: c, side: THREE.DoubleSide }, { gloss: 0.4 });
  part(g, new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), c, 0, -drop - r * 0.15, 0, { material: mat, outline: false });
  if (lit) part(g, sphere(r * 0.32), o.color ?? P.lamp, 0, -drop - r * 0.05, 0, { glow: 2.4, outline: false, shadow: false });
  lampLight(g, o, 0, -drop - r * 0.4, 0, 8);
  return g;
}

/**
 * A string of little lights sagging between two points (world positions, or local to wherever you add it).
 * Bulbs glow and bloom; no real lights.
 */
export function stringLights(from: THREE.Vector3, to: THREE.Vector3, o: { sag?: number; count?: number; colors?: readonly string[]; bulb?: number } = {}): Prop {
  const g = group('stringLights');
  const sag = o.sag ?? from.distanceTo(to) * 0.12;
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mid.y -= sag * 2;
  const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
  const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.008, 5), toonMat({ color: P.ink }));
  wire.castShadow = false;
  g.add(wire);
  const n = o.count ?? Math.max(4, Math.round(from.distanceTo(to) / 0.45));
  const colors = o.colors ?? [P.lamp];
  for (let i = 0; i < n; i++) {
    const p = curve.getPoint((i + 0.5) / n);
    part(g, sphere(o.bulb ?? 0.045, 10), colors[i % colors.length] as string, p.x, p.y - 0.05, p.z, { glow: 2.2, outline: false, shadow: false });
  }
  return g;
}

/** A candle with a small steady flame. */
export function candle(o: { h?: number; color?: string } = {}): Prop {
  const g = group('candle');
  const h = o.h ?? 0.12;
  part(g, cyl(0.03, 0.032, h, 12), o.color ?? P.ceramic, 0, h / 2, 0, NO_LINE);
  const flame = part(g, cone(0.014, 0.05, 8), P.lamp, 0, h + 0.035, 0, { glow: 2.5, outline: false, shadow: false });
  g.userData.tick = ((_dt, time) => {
    flame.scale.y = 1 + Math.sin(time * 9 + h * 50) * 0.12;
  }) satisfies Tick;
  return g;
}

/** A low garden light on a post, or a taller lantern with `h`. */
export function gardenLamp(o: LampOptions = {}): Prop {
  const g = group('gardenLamp');
  const h = o.h ?? 0.7;
  const stand = o.stand ?? P.charcoal;
  part(g, cyl(0.025, 0.03, h, 8), stand, 0, h / 2, 0, NO_LINE);
  part(g, cyl(0.07, 0.07, 0.02, 12), stand, 0, h + 0.13, 0, NO_LINE);
  if (o.lit !== false) part(g, cyl(0.05, 0.05, 0.12, 12), o.color ?? P.lamp, 0, h + 0.06, 0, { glow: 2, outline: false, shadow: false });
  else part(g, cyl(0.05, 0.05, 0.12, 12), P.ceramic, 0, h + 0.06, 0, NO_LINE);
  lampLight(g, o, 0, h + 0.1, 0, 5);
  return g;
}

/** A neon sign: glowing text on the wall. Origin on the wall at the sign's centre. */
export function neonSign(text: string, o: { color?: string; h?: number } = {}): Prop {
  const g = group('neonSign');
  const c = o.color ?? P.neonPink;
  const h = o.h ?? 0.5;
  let w = 256;
  const tex = canvasTexture(1024, 256, (ctx) => {
    ctx.font = `700 150px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    w = Math.min(1000, ctx.measureText(text).width + 80);
    ctx.shadowColor = c;
    ctx.shadowBlur = 36;
    ctx.strokeStyle = c;
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, 512, 132, 960);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeText(text, 512, 132, 960);
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.6) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * 4, h), mat);
  mesh.position.z = 0.03;
  g.add(mesh);
  g.userData.width = (w / 1024) * h * 4;
  return g;
}

// ------------------------------------------------------------------ plants

export type PlantKind = 'monstera' | 'fern' | 'snake' | 'ficus' | 'cactus' | 'trailing' | 'palm';

/** A plant in a pot. `h` is the overall height. */
export function plant(o: { kind?: PlantKind; h?: number; pot?: string; seed?: number } = {}): Prop {
  const g = group('plant');
  const kind = o.kind ?? 'monstera';
  const h = o.h ?? (kind === 'ficus' || kind === 'palm' ? 1.5 : kind === 'trailing' ? 0.3 : 0.8);
  const rand = seeded(o.seed ?? kind.length * 13 + 1);
  const potH = Math.min(0.34, h * (kind === 'trailing' ? 0.45 : 0.28));
  const potR = potH * 0.62;
  part(g, lathe([[0, 0], [potR * 0.78, 0], [potR, potH], [potR * 0.9, potH], [potR * 0.72, potH * 0.2], [0, potH * 0.2]], 20), o.pot ?? P.terracotta, 0, 0, 0, { gloss: 0.2 });
  part(g, cyl(potR * 0.9, potR * 0.9, 0.02, 16), P.soilDark, 0, potH * 0.9, 0, NO_LINE);
  const top = h - potH;
  // A flat leaf from (x, y, z), pointing outwards at `yaw` and tilted up by `pitch`.
  const leaf = (c: string, x: number, y: number, z: number, len: number, wide: number, yaw: number, pitch: number) => {
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.order = 'YXZ';
    holder.rotation.set(-pitch, yaw, 0);
    part(holder, sphere(0.5, 12), c, 0, 0, len / 2, { sx: wide, sy: 0.035, sz: len, outline: false });
    g.add(holder);
  };
  if (kind === 'snake') {
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const len = top * (0.6 + rand() * 0.4);
      part(g, cone(0.045, len, 6), mix(P.fern, i % 2 ? P.olive : P.pine, 0.45), Math.cos(a) * potR * 0.4, potH + len / 2, Math.sin(a) * potR * 0.4, { rz: Math.cos(a) * 0.14, rx: -Math.sin(a) * 0.14, sz: 0.4, ry: a, outline: 0.012 });
    }
  } else if (kind === 'cactus') {
    part(g, pill(potR * 0.5, top * 0.55), P.moss, 0, potH + top * 0.4, 0, { outline: 0.015 });
    part(g, pill(potR * 0.28, top * 0.2), P.moss, potR * 0.75, potH + top * 0.45, 0, { outline: 0.015 });
    part(g, sphere(0.03, 8), P.rose, 0, potH + top * 0.4 + top * 0.275 + potR * 0.5, 0, NO_LINE);
  } else if (kind === 'ficus' || kind === 'palm') {
    part(g, cyl(0.025, 0.04, top * 0.62, 8), P.soil, 0, potH + top * 0.31, 0, { ...NO_LINE, tex: 'bark' });
    if (kind === 'ficus') {
      for (let i = 0; i < 9; i++) {
        const a = rand() * Math.PI * 2;
        const rr = rand() * top * 0.2;
        part(g, ball(top * (0.14 + rand() * 0.08), 1), mix(P.fern, rand() < 0.5 ? P.leafDark : P.moss, rand() * 0.6), Math.cos(a) * rr, potH + top * (0.6 + rand() * 0.32), Math.sin(a) * rr, { outline: 0.015 });
      }
    } else {
      for (let i = 0; i < 8; i++) leaf(mix(P.fern, P.pine, rand() * 0.5), 0, potH + top * 0.62, 0, top * (0.42 + rand() * 0.16), 0.2, (i / 8) * Math.PI * 2 + rand() * 0.3, 0.5 - rand() * 0.7);
    }
  } else if (kind === 'trailing') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand();
      const len = top * (0.9 + rand() * 0.9);
      leaf(mix(P.fern, P.olive, rand() * 0.6), 0, potH, 0, len, 0.09, a, -0.5 - rand() * 0.5);
    }
    part(g, ball(potR * 0.9, 1), P.fern, 0, potH + potR * 0.3, 0, { outline: 0.012, sy: 0.7 });
  } else if (kind === 'fern') {
    for (let i = 0; i < 14; i++) leaf(mix(P.fern, P.moss, rand() * 0.6), 0, potH, 0, top * (0.7 + rand() * 0.5), 0.1, (i / 14) * Math.PI * 2 + rand() * 0.4, 0.25 + rand() * 0.8);
  } else {
    // monstera: a few big leaves on stalks
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rand() * 0.5;
      const reach = top * (0.25 + rand() * 0.25);
      const y = potH + top * (0.45 + rand() * 0.5);
      part(g, cyl(0.008, 0.012, y - potH, 5), P.moss, (Math.cos(a) * reach) / 2, (y + potH) / 2, (Math.sin(a) * reach) / 2, { ...NO_LINE, rz: (-Math.cos(a) * reach) / (y - potH), rx: (Math.sin(a) * reach) / (y - potH) });
      leaf(mix(P.fern, P.pine, rand() * 0.5), Math.cos(a) * reach * 0.8, y, Math.sin(a) * reach * 0.8, top * 0.34, 0.26, -a + Math.PI / 2, 0.15 - rand() * 0.4);
    }
  }
  return g;
}

/** A vase (with a few stems when `stems` is set). */
export function vase(o: { color?: string; h?: number; stems?: boolean } = {}): Prop {
  const g = group('vase');
  const h = o.h ?? 0.3;
  part(g, lathe([[0, 0], [h * 0.2, 0], [h * 0.3, h * 0.35], [h * 0.14, h * 0.8], [h * 0.18, h], [h * 0.13, h], [0, h * 0.9]], 20), o.color ?? P.teal, 0, 0, 0, { gloss: 0.5 });
  if (o.stems) {
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7;
      part(g, cyl(0.006, 0.006, h * 0.9, 5), P.moss, Math.cos(a) * 0.04, h * 1.35, Math.sin(a) * 0.04, { ...NO_LINE, rz: Math.cos(a) * 0.25, rx: Math.sin(a) * 0.25 });
      part(g, sphere(0.035, 8), [P.rose, P.mustard, P.cream, P.terracotta][i] as string, Math.cos(a) * 0.15, h * 1.78, Math.sin(a) * 0.15, NO_LINE);
    }
  }
  return g;
}

// ------------------------------------------------------------------ walls: windows, curtains, pictures

export type Outside = 'day' | 'dusk' | 'night';

function outsideTexture(time: Outside, seed: number): THREE.CanvasTexture {
  return canvasTexture(256, 320, (ctx, w, h) => {
    const rand = seeded(seed);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    const stops = time === 'day' ? ['#6ea4d8', '#bfdcee', '#f3e6cf'] : time === 'dusk' ? ['#2c2a5e', '#b0647e', '#f3a36e'] : ['#070b22', '#141c48', '#2b3a70'];
    stops.forEach((c, i) => sky.addColorStop(i / (stops.length - 1), c));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    if (time === 'night') {
      ctx.fillStyle = '#e9edff';
      for (let i = 0; i < 40; i++) ctx.fillRect(rand() * w, rand() * h * 0.7, 1.6, 1.6);
    }
    // sun or moon with a halo
    const sx = w * (0.3 + rand() * 0.4);
    const sy = time === 'dusk' ? h * 0.66 : h * 0.24;
    const halo = ctx.createRadialGradient(sx, sy, 2, sx, sy, 90);
    halo.addColorStop(0, time === 'night' ? 'rgba(220,230,255,0.5)' : 'rgba(255,236,190,0.75)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = time === 'night' ? '#eef1ff' : '#fff3d6';
    ctx.beginPath();
    ctx.arc(sx, sy, time === 'night' ? 15 : 19, 0, Math.PI * 2);
    ctx.fill();
    // far roofs and trees
    const far = time === 'day' ? '#7fa2a8' : time === 'dusk' ? '#4a3560' : '#10163a';
    const near = time === 'day' ? '#4f7d62' : time === 'dusk' ? '#2c2244' : '#0a0e26';
    ctx.fillStyle = far;
    let x = 0;
    while (x < w) {
      const bw = 24 + rand() * 40;
      const bh = 40 + rand() * 70;
      ctx.fillRect(x, h - bh, bw, bh);
      if (time !== 'day') {
        ctx.fillStyle = '#ffd58a';
        for (let i = 0; i < 4; i++) if (rand() < 0.55) ctx.fillRect(x + 5 + (i % 2) * 10, h - bh + 8 + Math.floor(i / 2) * 14, 5, 7);
        ctx.fillStyle = far;
      }
      x += bw + 2;
    }
    ctx.fillStyle = near;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(rand() * w, h + 6, 30 + rand() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/**
 * A window on a wall, with the world outside painted in: 'day', 'dusk' or 'night'. Origin on the wall at the
 * window's centre. The panes glow a little (and bloom at dusk and by day).
 */
export function windowFrame(o: { w?: number; h?: number; time?: Outside; frame?: string; seed?: number; sill?: boolean } = {}): Prop {
  const g = group('window');
  const w = o.w ?? 1.3;
  const h = o.h ?? 1.5;
  const time = o.time ?? 'dusk';
  const frame = o.frame ?? P.cream;
  const bright = time === 'day' ? 1.5 : time === 'dusk' ? 1.15 : 0.9;
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: outsideTexture(time, o.seed ?? 5), color: new THREE.Color(bright, bright, bright) }));
  pane.position.z = 0.01;
  g.add(pane);
  const t = 0.07;
  part(g, box(w + t * 2, t, 0.09), frame, 0, h / 2 + t / 2, 0.03);
  part(g, box(w + t * 2, t, 0.09), frame, 0, -h / 2 - t / 2, 0.03);
  for (const s of [-1, 1]) part(g, box(t, h, 0.09), frame, s * (w / 2 + t / 2), 0, 0.03);
  part(g, box(0.035, h, 0.05), frame, 0, 0, 0.035, NO_LINE);
  part(g, box(w, 0.035, 0.05), frame, 0, h * 0.12, 0.035, NO_LINE);
  if (o.sill !== false) part(g, rbox(w + 0.3, 0.05, 0.2, 0.02), frame, 0, -h / 2 - t - 0.02, 0.09);
  return g;
}

/** Curtains for a window `w` wide and `h` tall: two gathered panels on a rail. Origin at the window's centre. */
export function curtains(o: { w?: number; h?: number; color?: string; open?: number; rail?: string } = {}): Prop {
  const g = group('curtains');
  const w = o.w ?? 1.3;
  const h = (o.h ?? 1.5) + 0.5;
  const c = o.color ?? P.mustard;
  const open = o.open ?? 0.7;
  const top = (o.h ?? 1.5) / 2 + 0.22;
  part(g, cyl(0.018, 0.018, w + 0.7, 8), o.rail ?? P.charcoal, 0, top, 0.14, { ...NO_LINE, rz: Math.PI / 2 });
  for (const s of [-1, 1]) part(g, sphere(0.035, 8), o.rail ?? P.charcoal, s * (w / 2 + 0.35), top, 0.14, NO_LINE);
  const panel = (w / 2 + 0.3) * (1 - open * 0.72);
  const folds = Math.max(3, Math.round(panel / 0.1));
  for (const s of [-1, 1]) {
    for (let i = 0; i < folds; i++) {
      const x = s * (w / 2 + 0.3 - (i + 0.5) * (panel / folds));
      part(g, cyl(0.062, 0.07, h, 8), i % 2 ? c : mix(c, P.ink, 0.1), x, top - h / 2 - 0.02, 0.14 + (i % 2) * 0.02, { tex: 'fabric', texStrength: 0.6, outline: false });
    }
  }
  return g;
}

export type Art = 'sunset' | 'hills' | 'shapes' | 'leaf' | 'moon';

function artTexture(kind: Art, seed: number): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rand = seeded(seed);
    const cols = [P.terracotta, P.mustard, P.teal, P.rose, P.denim, P.sage, P.forest, P.mauve];
    ctx.fillStyle = P.cream;
    ctx.fillRect(0, 0, w, h);
    if (kind === 'sunset' || kind === 'moon') {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      (kind === 'sunset' ? ['#3d3a6e', '#c56a6a', '#f0b070'] : ['#101736', '#2b3a70', '#5a5a92']).forEach((c, i) => sky.addColorStop(i / 2, c));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = kind === 'sunset' ? '#ffe0a6' : '#eef1ff';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * (kind === 'sunset' ? 0.62 : 0.36), w * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = kind === 'sunset' ? '#2c2244' : '#0b1026';
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h * 0.72 + Math.sin(x * 0.03 + seed) * 14 + rand() * 6);
      ctx.lineTo(w, h);
      ctx.fill();
    } else if (kind === 'hills') {
      ctx.fillStyle = '#e9d9bd';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = [P.sage, P.teal, P.forest, P.pine][i] as string;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 8) ctx.lineTo(x, h * (0.42 + i * 0.14) + Math.sin(x * 0.02 * (i + 1) + seed * (i + 1)) * 22);
        ctx.lineTo(w, h);
        ctx.fill();
      }
      ctx.fillStyle = P.terracotta;
      ctx.beginPath();
      ctx.arc(w * 0.68, h * 0.26, 24, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'leaf') {
      ctx.strokeStyle = P.forest;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.9);
      ctx.lineTo(w / 2, h * 0.15);
      ctx.stroke();
      ctx.fillStyle = P.fern;
      for (let i = 0; i < 6; i++) {
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(w / 2 + s * 34, h * (0.24 + i * 0.1), 34, 11, s * -0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = pick(rand, cols);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        if (rand() < 0.5) ctx.arc(rand() * w, rand() * h, 30 + rand() * 50, 0, Math.PI * 2);
        else ctx.rect(rand() * w * 0.7, rand() * h * 0.7, 40 + rand() * 90, 40 + rand() * 90);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  });
}

/** A framed picture. Origin on the wall at the picture's centre. */
export function pictureFrame(o: { w?: number; h?: number; art?: Art; frame?: string; seed?: number } = {}): Prop {
  const g = group('picture');
  const w = o.w ?? 0.6;
  const h = o.h ?? 0.75;
  const frame = o.frame ?? P.walnut;
  part(g, rbox(w, h, 0.045, 0.015), frame, 0, 0, 0.022, { tex: 'wood' });
  part(g, box(w - 0.07, h - 0.07, 0.01), P.cream, 0, 0, 0.047, NO_LINE);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.16, h - 0.16), toonMat({ map: artTexture(o.art ?? 'shapes', o.seed ?? 2) }));
  art.position.z = 0.054;
  g.add(art);
  return g;
}

/** A round wall clock. Origin on the wall. */
export function wallClock(o: { r?: number; color?: string } = {}): Prop {
  const g = group('clock');
  const r = o.r ?? 0.2;
  part(g, cyl(r, r, 0.04, 28), o.color ?? P.walnut, 0, 0, 0.02, { rx: Math.PI / 2 });
  part(g, cyl(r * 0.86, r * 0.86, 0.01, 28), P.cream, 0, 0, 0.043, { rx: Math.PI / 2, outline: false });
  part(g, box(0.012, r * 0.55, 0.008), P.ink, 0, r * 0.25, 0.052, NO_LINE);
  part(g, box(r * 0.42, 0.012, 0.008), P.ink, r * 0.2, 0, 0.052, NO_LINE);
  return g;
}

// ------------------------------------------------------------------ kitchen

/**
 * A run of kitchen cabinets with a worktop, `w` wide; origin at the floor against the wall (the back is at
 * z = 0, the front at z = 0.62). Worktop at 0.92. `sink` puts a sink at that x.
 */
export function kitchenCounter(o: { w?: number; color?: string; top?: string; sink?: number; handles?: string; topTex?: TextureName } = {}): Prop {
  const g = group('kitchenCounter');
  const w = o.w ?? 2.4;
  const c = o.color ?? P.forest;
  const d = 0.62;
  part(g, box(w, 0.1, d - 0.06), P.charcoal, 0, 0.05, d / 2 - 0.03, NO_LINE);
  part(g, rbox(w, 0.78, d, 0.02), c, 0, 0.49, d / 2);
  part(g, rbox(w + 0.04, 0.05, d + 0.04, 0.02), o.top ?? P.cream, 0, 0.905, d / 2 + 0.01, { tex: o.topTex ?? 'terrazzo', gloss: 0.25 });
  const doors = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (i + 0.5) * (w / doors);
    part(g, rbox(w / doors - 0.04, 0.68, 0.02, 0.008), mix(c, '#ffffff', 0.06), x, 0.49, d + 0.005, { outline: 0.012 });
    part(g, cyl(0.012, 0.012, 0.14, 6), o.handles ?? P.brass, x + (i % 2 ? -1 : 1) * (w / doors / 2 - 0.09), 0.62, d + 0.035, { ...NO_LINE, gloss: 0.6 });
  }
  if (o.sink !== undefined) {
    part(g, rbox(0.56, 0.02, 0.4, 0.008), P.metal, o.sink, 0.935, d / 2 + 0.02, { gloss: 0.6, outline: false });
    part(g, rbox(0.46, 0.02, 0.3, 0.008), P.charcoal, o.sink, 0.94, d / 2 + 0.02, NO_LINE);
    part(g, cyl(0.016, 0.016, 0.26, 8), P.metal, o.sink, 1.06, 0.12, { ...NO_LINE, gloss: 0.7 });
    part(g, torus(0.07, 0.014, Math.PI), P.metal, o.sink, 1.19, 0.19, { ...NO_LINE, gloss: 0.7, ry: Math.PI / 2 });
  }
  return g;
}

/** A fridge with a freezer door, a few magnets and a note. Back at z = 0. */
export function fridge(o: { color?: string; h?: number } = {}): Prop {
  const g = group('fridge');
  const h = o.h ?? 1.85;
  const c = o.color ?? P.sage;
  const w = 0.78;
  const d = 0.7;
  part(g, rbox(w, h, d, 0.05), c, 0, h / 2 + 0.03, d / 2, { gloss: 0.3 });
  part(g, rbox(w - 0.04, h * 0.3, 0.03, 0.012), mix(c, '#ffffff', 0.08), 0, h * 0.84, d + 0.008, { gloss: 0.3, outline: 0.012 });
  part(g, rbox(w - 0.04, h * 0.62, 0.03, 0.012), mix(c, '#ffffff', 0.08), 0, h * 0.35, d + 0.008, { gloss: 0.3, outline: 0.012 });
  for (const y of [h * 0.78, h * 0.58]) part(g, cyl(0.014, 0.014, 0.2, 6), P.metal, -w / 2 + 0.09, y, d + 0.05, { ...NO_LINE, gloss: 0.7 });
  const magnets = [P.terracotta, P.mustard, P.denim, P.rose];
  magnets.forEach((m, i) => part(g, cyl(0.022, 0.022, 0.012, 10), m, 0.05 + (i % 2) * 0.16, h * (0.46 + i * 0.045), d + 0.03, { rx: Math.PI / 2, outline: false }));
  part(g, box(0.13, 0.16, 0.004), P.cream, 0.12, h * 0.36, d + 0.027, { rz: 0.08, outline: false });
  return g;
}

/** A cooker with an oven door and four rings (lit rings glow). Back at z = 0, top at 0.92. */
export function stove(o: { color?: string; lit?: number } = {}): Prop {
  const g = group('stove');
  const c = o.color ?? P.charcoal;
  const w = 0.62;
  const d = 0.62;
  part(g, rbox(w, 0.9, d, 0.02), c, 0, 0.46, d / 2);
  part(g, rbox(w - 0.08, 0.44, 0.02, 0.01), mix(c, '#ffffff', 0.08), 0, 0.38, d + 0.005, { outline: 0.012 });
  part(g, rbox(w - 0.2, 0.2, 0.012, 0.006), '#1a1418', 0, 0.42, d + 0.018, { ...NO_LINE, gloss: 0.6 });
  part(g, cyl(0.014, 0.014, w - 0.14, 6), P.metal, 0, 0.64, d + 0.045, { ...NO_LINE, rz: Math.PI / 2, gloss: 0.7 });
  for (let i = 0; i < 4; i++) part(g, cyl(0.022, 0.022, 0.02, 10), P.metal, -0.2 + i * 0.13, 0.78, d + 0.012, { rx: Math.PI / 2, outline: false, gloss: 0.6 });
  for (let i = 0; i < 4; i++) {
    const x = (i % 2 ? 1 : -1) * 0.15;
    const z = d / 2 + (i < 2 ? -1 : 1) * 0.14;
    const lit = i < (o.lit ?? 0);
    part(g, torus(0.075, 0.012), lit ? P.ember : '#141016', x, 0.925, z, { rx: Math.PI / 2, outline: false, ...(lit ? { glow: 1.8 } : {}) });
  }
  part(g, box(w, 0.1, 0.03), c, 0, 0.97, 0.015, NO_LINE);
  return g;
}

/** A frying pan (handle towards +x). */
export function pan(o: { r?: number; color?: string } = {}): Prop {
  const g = group('pan');
  const r = o.r ?? 0.13;
  part(g, lathe([[0, 0], [r * 0.85, 0], [r, 0.04], [r * 0.94, 0.04], [r * 0.8, 0.012], [0, 0.012]], 24), o.color ?? P.charcoal, 0, 0, 0, { gloss: 0.5 });
  part(g, rbox(r * 1.2, 0.018, 0.028, 0.008), P.walnut, r * 1.5, 0.035, 0, NO_LINE);
  return g;
}

/** A pot with two handles and a lid. */
export function pot(o: { r?: number; color?: string } = {}): Prop {
  const g = group('pot');
  const r = o.r ?? 0.12;
  const c = o.color ?? P.copper;
  part(g, cyl(r, r * 0.92, r * 1.1, 24), c, 0, r * 0.55, 0, { gloss: 0.6 });
  part(g, cyl(r * 1.03, r * 1.03, 0.015, 24), mix(c, P.ink, 0.2), 0, r * 1.11, 0, NO_LINE);
  part(g, sphere(0.02, 8), P.ink, 0, r * 1.15, 0, NO_LINE);
  for (const s of [-1, 1]) part(g, torus(0.03, 0.008, Math.PI), P.ink, s * r, r * 0.85, 0, { ...NO_LINE, rz: s * -Math.PI / 2 });
  return g;
}

// ------------------------------------------------------------------ tabletop things

/** A mug of something warm. */
export function mug(o: { color?: string; r?: number } = {}): Prop {
  const g = group('mug');
  const r = o.r ?? 0.042;
  const c = o.color ?? P.ceramic;
  part(g, lathe([[0, 0], [r * 0.9, 0], [r, r * 0.3], [r, r * 2.2], [r * 0.84, r * 2.2], [r * 0.84, r * 0.4], [0, r * 0.4]], 18), c, 0, 0, 0, { gloss: 0.5, outline: 0.012 });
  part(g, torus(r * 0.62, r * 0.16, Math.PI), c, r, r * 1.15, 0, { rz: -Math.PI / 2, outline: false, gloss: 0.5 });
  part(g, cyl(r * 0.84, r * 0.84, 0.004, 14), '#5a3a2a', 0, r * 1.9, 0, NO_LINE);
  return g;
}

/** A stack of `n` plates. */
export function plates(o: { n?: number; color?: string; r?: number } = {}): Prop {
  const g = group('plates');
  const r = o.r ?? 0.11;
  const n = o.n ?? 1;
  for (let i = 0; i < n; i++) part(g, lathe([[0, 0], [r * 0.6, 0], [r, 0.016], [r, 0.022], [r * 0.58, 0.008], [0, 0.008]], 24), o.color ?? P.ceramic, 0, i * 0.012, 0, { gloss: 0.5, outline: i === n - 1 ? 0.012 : false });
  return g;
}

/** A bowl heaped with snacks: 'popcorn', 'crisps', 'fruit' or 'sweets'. */
export function snackBowl(o: { color?: string; r?: number; fill?: 'popcorn' | 'crisps' | 'fruit' | 'sweets'; seed?: number } = {}): Prop {
  const g = group('snackBowl');
  const r = o.r ?? 0.15;
  const rand = seeded(o.seed ?? 11);
  part(g, lathe([[0, 0], [r * 0.45, 0], [r, r * 0.62], [r * 0.93, r * 0.62], [r * 0.42, r * 0.1], [0, r * 0.1]], 24), o.color ?? P.teal, 0, 0, 0, { gloss: 0.5 });
  const fill = o.fill ?? 'popcorn';
  const cols = fill === 'popcorn' ? ['#f6e9c6', '#f1dba2', '#fff5dc'] : fill === 'crisps' ? ['#e9b955', '#dca43f'] : fill === 'fruit' ? [P.terracotta, P.mustard, P.moss, '#b0405a'] : [P.rose, P.neonCyan, P.mustard, P.mauve, P.terracotta];
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * r * 0.72;
    const s = fill === 'fruit' ? r * 0.26 : r * 0.17;
    part(g, ball(s, 1), pick(rand, cols), Math.cos(a) * rr, r * 0.5 + (1 - rr / r) * r * 0.3, Math.sin(a) * rr, { outline: false, ...(fill === 'crisps' ? { sy: 0.3, rz: rand() } : {}) });
  }
  return g;
}

/** A pizza box, closed or open (with a pizza and `slices` of 8 left). */
export function pizzaBox(o: { open?: boolean; slices?: number; size?: number } = {}): Prop {
  const g = group('pizzaBox');
  const s = o.size ?? 0.42;
  const card = '#c9a57a';
  part(g, rbox(s, 0.045, s, 0.01), card, 0, 0.022, 0, { outline: 0.012 });
  if (o.open) {
    part(g, rbox(s, 0.02, s, 0.008), card, 0, 0.045 + s / 2, -s / 2 - 0.01, { rx: Math.PI / 2 - 0.25, outline: 0.012 });
    part(g, cyl(s * 0.43, s * 0.43, 0.012, 28), '#e8c27a', 0, 0.05, 0, NO_LINE);
    const left = o.slices ?? 8;
    for (let i = 0; i < left; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      part(g, cyl(s * 0.15, s * 0.15, 0.008, 3), '#d9603f', Math.cos(a) * s * 0.22, 0.058, Math.sin(a) * s * 0.22, { ry: -a + Math.PI / 6, outline: false });
      part(g, cyl(s * 0.035, s * 0.035, 0.008, 8), '#a8382f', Math.cos(a) * s * 0.26, 0.064, Math.sin(a) * s * 0.26, NO_LINE);
    }
  } else {
    part(g, cyl(s * 0.2, s * 0.2, 0.004, 20), P.terracotta, 0, 0.047, 0, NO_LINE);
  }
  return g;
}

/** A drinks can or a bottle. */
export function drink(o: { kind?: 'can' | 'bottle'; color?: string } = {}): Prop {
  const g = group('drink');
  const c = o.color ?? P.teal;
  if (o.kind === 'bottle') {
    part(g, lathe([[0, 0], [0.035, 0], [0.035, 0.14], [0.014, 0.2], [0.014, 0.26], [0, 0.26]], 14), c, 0, 0, 0, { gloss: 0.7, outline: 0.012 });
    part(g, cyl(0.036, 0.036, 0.06, 14), P.cream, 0, 0.08, 0, NO_LINE);
  } else {
    part(g, cyl(0.033, 0.033, 0.12, 14), c, 0, 0.06, 0, { gloss: 0.6, outline: 0.012 });
    part(g, cyl(0.03, 0.03, 0.004, 14), P.stone, 0, 0.122, 0, NO_LINE);
  }
  return g;
}

/** A storage jar with a lid. */
export function jar(o: { color?: string; h?: number } = {}): Prop {
  const g = group('jar');
  const h = o.h ?? 0.16;
  part(g, cyl(0.05, 0.05, h, 14), o.color ?? P.mustard, 0, h / 2, 0, { gloss: 0.5, outline: 0.012 });
  part(g, cyl(0.054, 0.054, 0.025, 14), P.walnut, 0, h + 0.012, 0, NO_LINE);
  return g;
}

/** A TV remote. */
export function remote(): Prop {
  const g = group('remote');
  part(g, rbox(0.05, 0.02, 0.17, 0.008), P.charcoal, 0, 0.01, 0, { outline: 0.01 });
  part(g, cyl(0.008, 0.008, 0.004, 8), P.terracotta, 0, 0.022, -0.06, NO_LINE);
  return g;
}

// ------------------------------------------------------------------ sound and screens

/** A loudspeaker: a floor-stander by default, a bookshelf speaker with a small `h`. */
export function speaker(o: { h?: number; color?: string } = {}): Prop {
  const g = group('speaker');
  const h = o.h ?? 0.95;
  const w = Math.min(0.3, h * 0.6);
  const c = o.color ?? P.walnut;
  part(g, rbox(w, h, w * 1.05, 0.025), c, 0, h / 2, 0, { tex: 'darkWood' });
  part(g, rbox(w - 0.05, h - 0.06, 0.012, 0.005), P.charcoal, 0, h / 2, w * 0.53, { tex: 'fabric', texStrength: 0.6, outline: false });
  const cone1 = part(g, cyl(w * 0.3, w * 0.3, 0.014, 20), '#15121a', 0, h * 0.36, w * 0.545, { rx: Math.PI / 2, outline: false });
  part(g, cyl(w * 0.14, w * 0.14, 0.014, 16), '#15121a', 0, h * 0.74, w * 0.545, { rx: Math.PI / 2, outline: false });
  part(g, sphere(w * 0.1, 10), P.stone, 0, h * 0.36, w * 0.55, { outline: false, sz: 0.4, gloss: 0.5 });
  g.userData.cone = cone1;
  return g;
}

/** A record player on its own; the platter turns (animated) when `playing`. */
export function recordPlayer(o: { color?: string; playing?: boolean } = {}): Prop {
  const g = group('recordPlayer');
  part(g, rbox(0.46, 0.08, 0.38, 0.02), o.color ?? P.walnut, 0, 0.04, 0, { tex: 'darkWood' });
  const platter = new THREE.Group();
  platter.position.set(-0.04, 0.085, 0);
  g.add(platter);
  part(platter, cyl(0.155, 0.155, 0.012, 32), '#17131c', 0, 0, 0, { outline: false, gloss: 0.5 });
  part(platter, cyl(0.05, 0.05, 0.014, 20), P.terracotta, 0, 0.001, 0, NO_LINE);
  part(platter, box(0.02, 0.016, 0.004), P.cream, 0.03, 0.002, 0, NO_LINE);
  part(g, cyl(0.016, 0.016, 0.04, 8), P.brass, 0.17, 0.1, -0.13, { ...NO_LINE, gloss: 0.6 });
  part(g, box(0.012, 0.01, 0.2), P.brass, 0.14, 0.115, -0.04, { ...NO_LINE, ry: 0.3, gloss: 0.6 });
  if (o.playing !== false) {
    g.userData.tick = ((dt) => {
      platter.rotation.y -= dt * 3.4;
    }) satisfies Tick;
  }
  return g;
}

/**
 * A flat television on a low wooden unit. `userData.screen` is the screen mesh: give it your own material or
 * texture (`setScreen(tv, texture)`); by default it shows a soft idle glow.
 */
export function tvSet(o: { w?: number; unit?: string; glow?: string; stand?: boolean } = {}): Prop {
  const g = group('tvSet');
  const w = o.w ?? 1.5;
  const h = w * 0.58;
  const unitH = o.stand === false ? 0 : 0.42;
  if (unitH) {
    g.add(sideboard({ w: w + 0.5, h: unitH, ...(o.unit ? { color: o.unit } : {}) }));
    part(g, rbox(0.4, 0.02, 0.2, 0.008), P.charcoal, 0, unitH + 0.01, 0, NO_LINE);
    part(g, box(0.07, 0.1, 0.04), P.charcoal, 0, unitH + 0.06, -0.02, NO_LINE);
  }
  const y = unitH + 0.1 + h / 2;
  part(g, rbox(w, h, 0.05, 0.015), '#17141c', 0, y, 0, { gloss: 0.4 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.05, h - 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(o.glow ?? P.screen).multiplyScalar(0.55) }));
  screen.position.set(0, y, 0.027);
  g.add(screen);
  g.userData.screen = screen;
  return g;
}

/** Puts a texture (a canvas, a video frame) on a tvSet's screen. `bright` above 1 makes it bloom. */
export function setScreen(tv: Prop, map: THREE.Texture, bright = 1.1): void {
  const screen = tv.userData.screen as THREE.Mesh | undefined;
  if (!screen) return;
  (screen.material as THREE.Material).dispose();
  screen.material = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(bright, bright, bright) });
}

/** An acoustic guitar leaning back a little (lean it on a wall or a stand). */
export function guitar(o: { color?: string } = {}): Prop {
  const g = group('guitar');
  const c = o.color ?? P.oak;
  const body = new THREE.Group();
  body.rotation.x = -0.18;
  g.add(body);
  part(body, cyl(0.19, 0.19, 0.09, 24), c, 0, 0.2, 0, { rx: Math.PI / 2, tex: 'wood' });
  part(body, cyl(0.145, 0.145, 0.09, 24), c, 0, 0.44, 0, { rx: Math.PI / 2, tex: 'wood' });
  part(body, cyl(0.05, 0.05, 0.092, 16), '#1a1418', 0, 0.36, 0.002, { rx: Math.PI / 2, outline: false });
  part(body, box(0.05, 0.5, 0.025), P.walnut, 0, 0.8, 0.03, NO_LINE);
  part(body, rbox(0.075, 0.14, 0.03, 0.01), P.walnut, 0, 1.1, 0.03, { outline: 0.012 });
  return g;
}

// ------------------------------------------------------------------ outdoors

export type TreeKind = 'round' | 'pine' | 'palm' | 'birch';

/** A tree. `h` is the overall height. */
export function tree(o: { kind?: TreeKind; h?: number; seed?: number; color?: string } = {}): Prop {
  const g = group('tree');
  const kind = o.kind ?? 'round';
  const h = o.h ?? (kind === 'palm' ? 4.5 : 3.6);
  const rand = seeded(o.seed ?? 3);
  const leafC = o.color ?? (kind === 'pine' ? P.pine : P.leaf);
  if (kind === 'pine') {
    part(g, cyl(h * 0.03, h * 0.045, h * 0.3, 8), P.soilDark, 0, h * 0.15, 0, { tex: 'bark' });
    for (let i = 0; i < 4; i++) part(g, cone(h * (0.26 - i * 0.045), h * 0.34, 9), mix(leafC, P.fern, i * 0.12), 0, h * (0.36 + i * 0.17), 0, { ry: i * 0.7 });
  } else if (kind === 'palm') {
    let x = 0;
    const lean = (rand() - 0.5) * 0.5;
    const segs = 7;
    for (let i = 0; i < segs; i++) {
      const y = (i + 0.5) * (h * 0.86 / segs);
      x += lean * (i / segs) * (h / segs);
      part(g, cyl(h * 0.028, h * 0.036, (h * 0.86) / segs + 0.04, 8), mix(P.soil, P.sand, 0.3), x, y, 0, { rz: -lean * (i / segs) * 0.9, tex: 'bark', outline: i % 2 ? false : 0.02 });
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand() * 0.3;
      const frond = new THREE.Group();
      frond.position.set(x, h * 0.88, 0);
      frond.rotation.set(0, a, 0);
      const len = h * (0.3 + rand() * 0.08);
      part(frond, sphere(0.5, 10), mix(leafC, P.pine, rand() * 0.4), 0, -len * 0.14, len * 0.48, { sx: len * 0.26, sy: 0.05, sz: len, rx: 0.35 + rand() * 0.25, outline: 0.02 });
      g.add(frond);
    }
    for (let i = 0; i < 3; i++) part(g, sphere(h * 0.03, 8), P.soilDark, x + Math.cos(i * 2.1) * h * 0.035, h * 0.85, Math.sin(i * 2.1) * h * 0.035, NO_LINE);
  } else {
    const birch = kind === 'birch';
    part(g, cyl(h * (birch ? 0.022 : 0.035), h * (birch ? 0.03 : 0.055), h * 0.5, 8), birch ? P.ceramic : P.soilDark, 0, h * 0.25, 0, { tex: 'bark', texStrength: birch ? 0.5 : 1 });
    const puffs = birch ? 6 : 5;
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + rand();
      const rr = i === 0 ? 0 : h * (0.1 + rand() * 0.07);
      const r = h * (i === 0 ? 0.25 : 0.15 + rand() * 0.06) * (birch ? 0.8 : 1);
      part(g, ball(r, 2), mix(leafC, i % 2 ? P.leafDark : P.moss, 0.15 + rand() * 0.35), Math.cos(a) * rr, h * (i === 0 ? 0.72 : 0.56 + rand() * 0.16), Math.sin(a) * rr, { outline: 0.035 });
    }
  }
  return g;
}

/** A bush: a few leafy balls, optionally with flowers. */
export function bush(o: { r?: number; seed?: number; color?: string; flowers?: string } = {}): Prop {
  const g = group('bush');
  const r = o.r ?? 0.5;
  const rand = seeded(o.seed ?? 5);
  const c = o.color ?? P.fern;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rand();
    const rr = i === 0 ? 0 : r * 0.5;
    part(g, ball(r * (i === 0 ? 0.75 : 0.5 + rand() * 0.15), 1), mix(c, i % 2 ? P.leafDark : P.moss, rand() * 0.4), Math.cos(a) * rr, r * (i === 0 ? 0.6 : 0.36), Math.sin(a) * rr, { outline: 0.025 });
  }
  if (o.flowers) {
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const up = 0.5 + rand() * 0.5;
      part(g, sphere(r * 0.07, 8), o.flowers, Math.cos(a) * r * 0.75 * (1.1 - up * 0.5), r * (0.4 + up * 0.75), Math.sin(a) * r * 0.75 * (1.1 - up * 0.5), NO_LINE);
    }
  }
  return g;
}

/** A clipped hedge, `w` long along x. */
export function hedge(o: { w?: number; h?: number; d?: number; color?: string; seed?: number } = {}): Prop {
  const g = group('hedge');
  const w = o.w ?? 3;
  const h = o.h ?? 1;
  const d = o.d ?? 0.6;
  const c = o.color ?? mix(P.leafDark, P.leaf, 0.45);
  const rand = seeded(o.seed ?? 9);
  part(g, rbox(w, h, d, Math.min(0.22, d * 0.4)), c, 0, h / 2, 0, { tex: 'grass', texScale: 1.2, outline: 0.03 });
  for (let i = 0; i < w * 5; i++) part(g, ball(0.1 + rand() * 0.12, 1), mix(c, rand() < 0.5 ? P.fern : P.moss, 0.2 + rand() * 0.5), (rand() - 0.5) * (w - 0.25), h * (0.25 + rand() * 0.78), (rand() < 0.75 ? 1 : -1) * d * 0.44, NO_LINE);
  return g;
}

/** A wooden fence, `w` long along x: 'picket' (pointed slats) or 'panel' (tall boards). */
export function fence(o: { w?: number; h?: number; color?: string; kind?: 'picket' | 'panel' } = {}): Prop {
  const g = group('fence');
  const w = o.w ?? 4;
  const panel = o.kind === 'panel';
  const h = o.h ?? (panel ? 1.7 : 0.9);
  const c = o.color ?? (panel ? P.wood : P.cream);
  const wood: PartOptions = { tex: 'planks', texStrength: panel ? 1 : 0.5 };
  const posts = Math.max(2, Math.round(w / 1.6) + 1);
  for (let i = 0; i < posts; i++) part(g, rbox(0.1, h + 0.08, 0.1, 0.02), mix(c, P.ink, 0.15), -w / 2 + (i * w) / (posts - 1), (h + 0.08) / 2, -0.03, wood);
  if (panel) {
    part(g, box(w, h - 0.12, 0.035), c, 0, h / 2 + 0.03, 0.02, { ...wood, outline: 0.02 });
    part(g, box(w, 0.06, 0.06), mix(c, P.ink, 0.15), 0, h - 0.02, 0.03, wood);
  } else {
    for (const y of [h * 0.3, h * 0.72]) part(g, box(w, 0.06, 0.03), mix(c, P.ink, 0.1), 0, y, 0, wood);
    const n = Math.round(w / 0.17);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n);
      part(g, box(0.1, h - 0.1, 0.022), c, x, (h - 0.1) / 2 + 0.04, 0.03, { ...wood, outline: 0.012 });
      part(g, cone(0.07, 0.08, 4), c, x, h - 0.02, 0.03, { ry: Math.PI / 4, sz: 0.32, outline: false });
    }
  }
  return g;
}

/** A rock or boulder. */
export function rock(o: { r?: number; seed?: number; color?: string } = {}): Prop {
  const g = group('rock');
  const r = o.r ?? 0.4;
  const rand = seeded(o.seed ?? 2);
  for (let i = 0; i < 3; i++) {
    const s = r * (i === 0 ? 1 : 0.45 + rand() * 0.3);
    part(g, ball(s, 0), mix(o.color ?? P.stone, P.ink, rand() * 0.15), i === 0 ? 0 : (rand() - 0.5) * r * 1.6, s * 0.45, i === 0 ? 0 : (rand() - 0.5) * r * 1.2, { tex: 'rock', sy: 0.7, ry: rand() * 3, outline: 0.03 });
  }
  return g;
}

/** A tuft of grass or a clump of flowers, for dressing lawns. */
export function tuft(o: { color?: string; flowers?: string; seed?: number; s?: number } = {}): Prop {
  const g = group('tuft');
  const rand = seeded(o.seed ?? 4);
  const s = o.s ?? 1;
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2;
    part(g, cone(0.03 * s, (0.16 + rand() * 0.12) * s, 4), mix(o.color ?? P.grassDark, P.fern, rand() * 0.5), Math.cos(a) * 0.05 * s, 0.09 * s, Math.sin(a) * 0.05 * s, { rz: Math.cos(a) * 0.3, rx: -Math.sin(a) * 0.3, outline: false, shadow: false });
  }
  if (o.flowers) for (let i = 0; i < 3; i++) part(g, sphere(0.03 * s, 6), o.flowers, (rand() - 0.5) * 0.14 * s, (0.2 + rand() * 0.08) * s, (rand() - 0.5) * 0.14 * s, { outline: false, shadow: false });
  return g;
}

/** A campfire: stones, logs and flames that flicker, with a real flickering light when `light` is set. */
export function campfire(o: { lit?: boolean; light?: boolean | number; r?: number } = {}): Prop {
  const g = group('campfire');
  const r = o.r ?? 0.42;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    part(g, ball(r * 0.24, 0), mix(P.stone, P.ink, (i % 3) * 0.08), Math.cos(a) * r, r * 0.1, Math.sin(a) * r, { sy: 0.7, ry: i, outline: 0.02, tex: 'rock' });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    part(g, cyl(r * 0.1, r * 0.1, r * 1.3, 8), P.soilDark, Math.cos(a) * r * 0.2, r * 0.3, Math.sin(a) * r * 0.2, { rz: Math.PI / 2 - 0.5, ry: -a, tex: 'bark', outline: 0.02 });
  }
  if (o.lit === false) return g;
  const flames: THREE.Mesh[] = [];
  const cols = [P.ember, '#ffb347', '#ffe08a'];
  for (let i = 0; i < 3; i++) flames.push(part(g, cone(r * (0.42 - i * 0.11), r * (1.5 - i * 0.3), 8), cols[i] as string, 0, r * (0.85 - i * 0.1), 0, { glow: 1.1 + i * 0.35, outline: false, shadow: false }));
  part(g, disc(r * 0.8, 20), P.ember, 0, 0.03, 0, { glow: 0.7, outline: false, shadow: false });
  let light: THREE.PointLight | null = null;
  if (o.light) {
    light = new THREE.PointLight(P.ember, typeof o.light === 'number' ? o.light : 14, 12, 1.5);
    light.position.set(0, r * 1.4, 0);
    g.add(light);
    g.userData.light = light;
  }
  const base = light?.intensity ?? 0;
  g.userData.tick = ((_dt, time) => {
    flames.forEach((f, i) => {
      const k = Math.sin(time * (7 + i * 2.3) + i) * 0.5 + Math.sin(time * (13.7 + i)) * 0.5;
      f.scale.set(1 + k * 0.08, 1 + k * 0.16, 1 + k * 0.08);
      f.rotation.y = time * (1 + i);
    });
    if (light) light.intensity = base * (0.86 + 0.14 * Math.sin(time * 11.3) * Math.sin(time * 5.1));
  }) satisfies Tick;
  return g;
}

/** A log to sit on. */
export function logSeat(o: { len?: number; r?: number } = {}): Prop {
  const g = group('log');
  const len = o.len ?? 1.4;
  const r = o.r ?? 0.2;
  part(g, cyl(r, r, len, 14), P.soilDark, 0, r, 0, { rz: Math.PI / 2, tex: 'bark' });
  for (const s of [-1, 1]) part(g, cyl(r * 0.86, r * 0.86, 0.01, 14), P.oak, s * (len / 2 + 0.003), r, 0, { rz: Math.PI / 2, outline: false, tex: 'wood', texScale: 0.5 });
  return g;
}

/** A beach or garden parasol. */
export function parasol(o: { h?: number; r?: number; colors?: readonly [string, string] } = {}): Prop {
  const g = group('parasol');
  const h = o.h ?? 2.3;
  const r = o.r ?? 1.25;
  const [a, b] = o.colors ?? [P.terracotta, P.cream];
  part(g, cyl(0.03, 0.03, h, 8), P.ceramic, 0, h / 2, 0, NO_LINE);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const geo = new THREE.ConeGeometry(r, r * 0.42, 3, 1, true, (i / n) * Math.PI * 2, (Math.PI * 2) / n);
    const mesh = new THREE.Mesh(geo, toonMat({ color: i % 2 ? a : b, side: THREE.DoubleSide }, { tex: 'fabric', texStrength: 0.5 }));
    mesh.position.y = h - r * 0.16;
    mesh.castShadow = true;
    g.add(mesh);
  }
  part(g, sphere(0.05, 8), a, 0, h + r * 0.07, 0, NO_LINE);
  g.rotation.z = 0.06;
  return g;
}

/** A towel or picnic blanket lying on the ground. */
export function blanket(o: { w?: number; d?: number; color?: string; tex?: TextureName; stripes?: string } = {}): Prop {
  const g = group('blanket');
  const w = o.w ?? 1;
  const d = o.d ?? 1.9;
  part(g, rbox(w, 0.025, d, 0.01), o.color ?? P.teal, 0, 0.0125, 0, { tex: o.tex ?? 'terry', outline: false, shadow: false });
  if (o.stripes) for (const s of [-1, 1]) part(g, box(w, 0.027, d * 0.08), o.stripes, 0, 0.0135, s * d * 0.34, { outline: false, shadow: false });
  return g;
}

/** A wooden crate (stack them, sit on them). */
export function crate(o: { s?: number; color?: string } = {}): Prop {
  const g = group('crate');
  const s = o.s ?? 0.5;
  const c = o.color ?? P.wood;
  part(g, box(s * 0.94, s * 0.94, s * 0.94), mix(c, P.ink, 0.25), 0, s / 2, 0, { tex: 'planks', outline: false });
  for (const y of [0.17, 0.5, 0.83]) {
    part(g, box(s, s * 0.26, s * 1.0), c, 0, s * y, 0, { tex: 'planks', texScale: 1, outline: 0.015 });
  }
  return g;
}

/** A city skyline for the far distance: a ring of dark towers with lit windows (unlit, cheap). */
export function skyline(o: { radius?: number; seed?: number; base?: string; windows?: string; height?: number; y?: number } = {}): Prop {
  const g = group('skyline');
  const rand = seeded(o.seed ?? 21);
  const radius = o.radius ?? 60;
  const tall = o.height ?? 16;
  const tex = canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = o.base ?? '#1a1a3a';
    ctx.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 8; y += 20) {
      for (let x = 8; x < w - 12; x += 22) {
        const r = rand();
        if (r < 0.42) continue;
        ctx.fillStyle = r < 0.9 ? (o.windows ?? '#ffd58a') : P.neonCyan;
        ctx.globalAlpha = 0.45 + rand() * 0.55;
        ctx.fillRect(x, y, 12, 11);
      }
    }
    ctx.globalAlpha = 1;
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const count = 46;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.08;
    const w = 4 + rand() * 6;
    const h = tall * (0.35 + rand() * rand() * 1.1);
    const t = tex.clone();
    t.repeat.set(Math.max(1, Math.round(w / 3.4)) / 2, Math.max(1, Math.round(h / 5)) / 2);
    t.offset.set(rand(), rand());
    const m = new THREE.Mesh(box(1, 1, 1), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.25, 1.25, 1.25) }));
    const dist = radius * (0.9 + rand() * 0.3);
    m.scale.set(w, h, w);
    m.position.set(Math.cos(a) * dist, (o.y ?? -6) + h / 2, Math.sin(a) * dist);
    m.rotation.y = -a + Math.PI / 2;
    g.add(m);
  }
  return g;
}

// ------------------------------------------------------------------ water

const WATER_VERTEX = /* glsl */ `
uniform float time;
uniform float waves;
varying vec3 vWorld;
varying vec3 vView;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  world.y += ( sin( world.x * 0.9 + time * 1.1 ) * 0.5 + sin( world.z * 1.3 - time * 0.8 ) * 0.5 ) * waves;
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  vView = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const WATER_FRAGMENT = /* glsl */ `
uniform float time;
uniform vec3 shallow;
uniform vec3 deep;
uniform vec3 foam;
uniform vec3 skyTint;
uniform vec3 hgKeyDir;
uniform vec3 hgKeyColor;
uniform float scale;
uniform float opacity;
uniform vec2 shore;      // x: distance along +z where the shore starts (world z), y: width of the foam band
varying vec3 vWorld;
varying vec3 vView;
#include <common>
#include <fog_pars_fragment>
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// soft cell pattern: the bright wobbly lines of light on shallow water
float cells( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p );
  float d = 1.0;
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 o = vec2( float( x ), float( y ) );
    vec2 h = vec2( hash( i + o ), hash( i + o + 17.3 ) );
    h = 0.5 + 0.4 * sin( time * 0.9 + 6.2831 * h );
    d = min( d, length( o + h - f ) );
  }
  return d;
}
void main() {
  vec2 p = vWorld.xz * scale;
  vec2 flow = vec2( time * 0.05, time * 0.03 );
  float n = vnoise( p * 0.6 + flow * 2.0 );
  float c1 = cells( p * 1.2 + flow + n * 0.4 );
  float c2 = cells( p * 2.1 - flow * 1.4 + 3.7 );
  float lines = smoothstep( 0.62, 0.9, c1 ) * 0.7 + smoothstep( 0.7, 0.95, c2 ) * 0.35;
  vec3 v = normalize( vView );
  vec3 up = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  // a wobbling surface normal for the sheen
  vec3 nrm = normalize( up + ( viewMatrix * vec4( ( c1 - 0.5 ) * 0.35, 0.0, ( n - 0.5 ) * 0.35, 0.0 ) ).xyz );
  float fres = pow( 1.0 - saturate( dot( nrm, v ) ), 3.0 );
  vec3 col = mix( shallow, deep, saturate( n * 0.55 + 0.25 + fres * 0.4 ) );
  col = mix( col, skyTint, fres * 0.5 );
  col += foam * lines * ( 0.45 - fres * 0.25 );
  vec3 l = normalize( ( viewMatrix * vec4( hgKeyDir, 0.0 ) ).xyz );
  float spec = pow( saturate( dot( nrm, normalize( l + v ) ) ), 90.0 );
  col += hgKeyColor * smoothstep( 0.3, 0.8, spec ) * 1.4;
  if ( shore.y > 0.0 ) {
    float edge = ( vWorld.z - shore.x ) / shore.y + sin( vWorld.x * 0.8 + time * 0.9 ) * 0.25 + sin( time * 0.6 ) * 0.3;
    col = mix( col, foam, smoothstep( 0.35, 1.0, edge ) * 0.9 );
  }
  gl_FragColor = vec4( col, opacity );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * A water surface, `w` by `d`, lying at y = 0 and animated: drifting light lines, sheen, soft swell, and an
 * optional foam edge at a shore. Works for sea, pools, rivers and ponds.
 *  - `shoreZ` (in the water's own z): foam gathers from there towards +z (put the beach on that side).
 */
export function water(o: { w?: number; d?: number; shallow?: string; deep?: string; foam?: string; sky?: string; waves?: number; scale?: number; opacity?: number; shoreZ?: number; segments?: number } = {}): Prop {
  const g = group('water');
  const w = o.w ?? 40;
  const d = o.d ?? 40;
  const seg = o.segments ?? 40;
  const geo = new THREE.PlaneGeometry(w, d, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    time: { value: 0 },
    waves: { value: o.waves ?? 0.05 },
    shallow: { value: new THREE.Color(o.shallow ?? '#3fb3b8') },
    deep: { value: new THREE.Color(o.deep ?? '#1d6f8f') },
    foam: { value: new THREE.Color(o.foam ?? '#eafcff') },
    skyTint: { value: new THREE.Color(o.sky ?? '#bfe3f2') },
    hgKeyDir: { value: new THREE.Vector3(0.4, 0.8, 0.45) },
    hgKeyColor: { value: new THREE.Color('#fff2dc') },
    scale: { value: o.scale ?? 1 },
    opacity: { value: o.opacity ?? 1 },
    shore: { value: new THREE.Vector2(0, 0) },
  };
  const mat = new THREE.ShaderMaterial({ name: 'water', uniforms, vertexShader: WATER_VERTEX, fragmentShader: WATER_FRAGMENT, fog: true, transparent: (o.opacity ?? 1) < 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  g.add(mesh);
  g.userData.material = mat;
  const world = new THREE.Vector3();
  g.userData.tick = ((_dt, time) => {
    uniforms.time.value = time;
    if (o.shoreZ !== undefined) {
      g.getWorldPosition(world);
      uniforms.shore.value.set(world.z + o.shoreZ - 1.2, 1.2);
    }
  }) satisfies Tick;
  // The sheen follows the scene's key light: copy it in when the water is first drawn in a scene.
  mesh.onBeforeRender = (_r, scene) => {
    const look = (scene as THREE.Scene).userData.look as { keyDir?: [number, number, number]; keyColor?: THREE.ColorRepresentation } | undefined;
    if (look?.keyDir) uniforms.hgKeyDir.value.set(...look.keyDir).normalize();
    if (look?.keyColor) uniforms.hgKeyColor.value.set(look.keyColor);
  };
  return g;
}

/** A bank of clouds: `n` soft clouds scattered in a box, drifting slowly (animated). */
export function cloudBank(o: { n?: number; area?: [number, number, number]; scale?: number; color?: string; seed?: number; speed?: number } = {}): Prop {
  const g = group('clouds');
  const rand = seeded(o.seed ?? 17);
  const [ax, ay, az] = o.area ?? [60, 6, 20];
  const n = o.n ?? 8;
  for (let i = 0; i < n; i++) {
    const c = new THREE.Group();
    const puffs = 4 + Math.floor(rand() * 4);
    const s = (o.scale ?? 2) * (0.7 + rand() * 0.8);
    for (let k = 0; k < puffs; k++) {
      const t = k - (puffs - 1) / 2;
      const m = part(c, sphere((0.7 + rand() * 0.5) * s, 14), o.color ?? P.cloud, t * 0.9 * s, (1 - Math.abs(t) / puffs) * 0.5 * s, (rand() - 0.5) * 0.5 * s, { outline: false, shadow: false, exact: true, rim: 0.6, sy: 0.72 });
      m.receiveShadow = false;
    }
    c.position.set((rand() - 0.5) * ax, (rand() - 0.5) * ay, (rand() - 0.5) * az);
    g.add(c);
  }
  const speed = o.speed ?? 0.25;
  g.userData.tick = ((dt) => {
    for (const c of g.children) {
      c.position.x += dt * speed;
      if (c.position.x > ax / 2) c.position.x -= ax;
    }
  }) satisfies Tick;
  return g;
}

/** Dust motes or fireflies: a few glowing specks drifting in a box (animated). */
export function motes(o: { n?: number; area?: [number, number, number]; color?: string; size?: number; seed?: number } = {}): Prop {
  const g = group('motes');
  const rand = seeded(o.seed ?? 31);
  const [ax, ay, az] = o.area ?? [8, 3, 6];
  const n = o.n ?? 24;
  const positions = new Float32Array(n * 3);
  const phase: number[] = [];
  for (let i = 0; i < n; i++) {
    positions[i * 3] = (rand() - 0.5) * ax;
    positions[i * 3 + 1] = rand() * ay;
    positions[i * 3 + 2] = (rand() - 0.5) * az;
    phase.push(rand() * 10);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dot = canvasTexture(32, 32, (ctx) => {
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
  });
  const mat = new THREE.PointsMaterial({ map: dot, color: new THREE.Color(o.color ?? P.lamp).multiplyScalar(1.6), size: o.size ?? 0.07, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  g.add(points);
  const base = positions.slice();
  g.userData.tick = ((_dt, time) => {
    const attr = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const ph = phase[i] as number;
      attr.setXYZ(i, (base[i * 3] as number) + Math.sin(time * 0.3 + ph) * 0.3, (base[i * 3 + 1] as number) + Math.sin(time * 0.23 + ph * 2) * 0.2, (base[i * 3 + 2] as number) + Math.cos(time * 0.27 + ph) * 0.3);
    }
    attr.needsUpdate = true;
  }) satisfies Tick;
  return g;
}
