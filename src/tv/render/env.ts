// Lighting recipes and ready-made environments. An environment builder gives a scene a complete, dressed,
// lit space (floor, walls or horizon, furniture around the edges, lamps, plants, sky, fog, rim light and colour
// grade) and leaves the middle free for the game:
//
//   const env = livingRoom(scene, { mood: 'evening', clear: { w: 6, d: 3 } });
//   // ... add the game's own things around (0, 0, 0) ...
//   update(dt, time) { env.update(dt, time); }
//
// The camera is expected to look from +z towards -z (the "back wall" is at -z), slightly down.
// Preview any of them on their own with `?env=livingRoom` (kitchen, bedroom, backyard, beach, rooftop, props)
// and `&mood=night` etc. on the page address.
import * as THREE from 'three';
import { type GradeName, setGrade } from './post';
import * as props from './props';
import type { TextureName } from './textures';
import { PALETTE as P, SKIES, type SkyLook, applySky, box, cyl, mix, part, rbox, seeded, setLook, sphere } from './toon';

// ------------------------------------------------------------------ lighting recipes

export type Lighting = 'goldenHour' | 'dusk' | 'midday' | 'moonlit' | 'lampInterior' | 'nightInterior' | 'dayInterior' | 'neon';

/**
 * The lighting recipes, as sky presets. Exteriors reuse the SKIES; interiors are their own:
 *  - goldenHour: low warm sun, long shadows, blue-violet shade.
 *  - dusk: the sun just gone; peach key, violet fill, first stars.
 *  - midday: clear and bright (use sparingly: it is the least cosy).
 *  - moonlit: night outside. A cool key from the moon, strong rim so shapes stay readable.
 *  - lampInterior: evening indoors. A soft warm key from above, plum shade; lamps do the rest.
 *  - nightInterior: lights low. Like lampInterior but darker and bluer; screens and lamps glow.
 *  - dayInterior: daylight through a window: soft, pale, gentle contrast.
 *  - neon: late night. Dark violet room, pink and cyan side lights, big bloom.
 */
export const LIGHTING: Record<Lighting, SkyLook> = {
  goldenHour: SKIES.afternoon,
  dusk: SKIES.dusk,
  midday: SKIES.midday,
  moonlit: { ...SKIES.night, sunIntensity: 0.85, hemi: 0.62 },
  lampInterior: {
    background: '#1d1626',
    hemiSky: '#a79bbd',
    hemiGround: '#43343a',
    hemi: 0.55,
    sun: '#ffe0bd',
    sunIntensity: 1.25,
    sunFrom: [0.3, 1, 0.55],
    ambient: '#9c8fb4',
    ambientIntensity: 0.14,
    rim: '#ffc890',
    rimStrength: 0.4,
    outline: 0.7,
    grade: 'cosy',
  },
  nightInterior: {
    background: '#12101f',
    hemiSky: '#6c70a6',
    hemiGround: '#26202f',
    hemi: 0.42,
    sun: '#c9c2ff',
    sunIntensity: 0.6,
    sunFrom: [-0.35, 1, 0.5],
    ambient: '#7a7cba',
    ambientIntensity: 0.12,
    rim: '#9fb0ff',
    rimStrength: 0.42,
    outline: 0.45,
    grade: 'night',
  },
  dayInterior: {
    background: '#d8ccbc',
    hemiSky: '#f3ecdf',
    hemiGround: '#a39280',
    hemi: 0.8,
    sun: '#fff0d6',
    sunIntensity: 1.7,
    sunFrom: [-0.7, 0.85, 0.5],
    ambient: '#d6dcff',
    ambientIntensity: 0.14,
    rim: '#ffffff',
    rimStrength: 0.28,
    grade: 'neutral',
  },
  neon: {
    background: '#120a24',
    hemiSky: '#5a3cc0',
    hemiGround: '#1a0c2c',
    hemi: 0.5,
    sun: '#cdbcff',
    sunIntensity: 0.6,
    sunFrom: [0.2, 1, 0.5],
    ambient: '#ff5fa2',
    ambientIntensity: 0.1,
    rim: '#6fe6ff',
    rimStrength: 0.6,
    outline: 0.5,
    grade: 'neon',
  },
};

export interface Rig {
  sun: THREE.DirectionalLight;
  /** Extra lights the recipe added (the neon side lights). */
  extras: THREE.Light[];
}

/**
 * Lights a scene with a recipe: sky or backdrop, fog, hemisphere and key light with shadows, rim light, colour
 * grade. `shadowSize` is half the width the shadows must cover around the origin.
 */
export function lightRig(scene: THREE.Scene, name: Lighting, o: { fog?: { near: number; far: number }; shadowSize?: number; sunFrom?: [number, number, number] } = {}): Rig {
  const sky = { ...LIGHTING[name], ...(o.sunFrom ? { sunFrom: o.sunFrom } : {}) };
  const sun = applySky(scene, sky, o.fog ?? { near: 40, far: 140 }, o.shadowSize ?? 14);
  setGrade(scene, (sky.grade ?? 'neutral') as GradeName);
  const extras: THREE.Light[] = [];
  if (name === 'neon') {
    const pink = new THREE.DirectionalLight(P.neonPink, 0.9);
    pink.position.set(-8, 3, -2);
    const cyan = new THREE.DirectionalLight(P.neonCyan, 0.7);
    cyan.position.set(8, 3, -1);
    scene.add(pink, cyan);
    extras.push(pink, cyan);
  }
  return { sun, extras };
}

// ------------------------------------------------------------------ shared pieces

export interface Env {
  /** Everything the builder added except the lights. Remove it to clear the set. */
  root: THREE.Group;
  sun: THREE.DirectionalLight;
  /** Real lights from lamps and fires (for dimming, flicker, blackouts). */
  lamps: THREE.PointLight[];
  /** Call every frame: animates water, flames, clouds, turntables. */
  update(dt: number, time: number): void;
  /** The usable floor: x and z limits inside the walls or fences. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export type Mood = 'day' | 'golden' | 'evening' | 'night' | 'neon';

interface Common {
  /** The time and feel: decides lighting, window views, which lamps are lit, the grade. */
  mood?: Mood;
  /** The area around the origin kept free for the game (full width and depth). */
  clear?: { w: number; d: number };
  /** 0..1: how much dressing (plants, pictures, small things). Default 1. */
  dress?: number;
  seed?: number;
  /** Real point lights on the main lamps (default true; costs a little per light). */
  lights?: boolean;
}

function finish(scene: THREE.Scene, root: THREE.Group, rig: Rig, bounds: Env['bounds']): Env {
  scene.add(root);
  const tick = props.tickProps(root);
  const lamps: THREE.PointLight[] = [];
  root.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight) lamps.push(o as THREE.PointLight);
  });
  return { root, sun: rig.sun, lamps, update: tick, bounds };
}

const place = <T extends THREE.Object3D>(root: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T => {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  root.add(obj);
  return obj;
};

interface ShellOptions {
  w: number;
  d: number;
  h: number;
  wall: string;
  floor: TextureName;
  floorColor: string;
  /** Lower part of the walls in another colour (a dado), up to this height. */
  dado?: { color: string; h: number; tex?: TextureName };
  skirting?: string;
}

/** Floor, back wall and side walls of a room centred on the origin, open towards +z and above. */
function shell(root: THREE.Group, o: ShellOptions): void {
  const { w, d, h } = o;
  // The floor runs on past the open front, so a low camera never sees its edge.
  part(root, box(w + 0.4, 0.2, d + 8), o.floorColor, 0, -0.1, 4 - 0.2, { tex: o.floor, outline: false, shadow: false });
  const wallOpts = { tex: 'plaster' as TextureName, outline: false as const, texStrength: 0.9 };
  part(root, box(w + 0.4, h, 0.2), o.wall, 0, h / 2, -d / 2 - 0.1, wallOpts);
  for (const s of [-1, 1]) part(root, box(0.2, h, d + 8), mix(o.wall, P.ink, 0.06), s * (w / 2 + 0.1), h / 2, 4 - 0.2, wallOpts);
  if (o.dado) {
    const t = { tex: o.dado.tex ?? ('plaster' as TextureName), outline: false as const };
    part(root, box(w, o.dado.h, 0.03), o.dado.color, 0, o.dado.h / 2, -d / 2 + 0.015, t);
    for (const s of [-1, 1]) part(root, box(0.03, o.dado.h, d + 8), mix(o.dado.color, P.ink, 0.06), s * (w / 2 - 0.015), o.dado.h / 2, 4 - 0.2, t);
    part(root, box(w, 0.05, 0.05), o.skirting ?? P.cream, 0, o.dado.h, -d / 2 + 0.035, { outline: false });
  }
  const sk = o.skirting ?? P.cream;
  part(root, box(w, 0.14, 0.04), sk, 0, 0.07, -d / 2 + 0.02, { outline: false });
  for (const s of [-1, 1]) part(root, box(0.04, 0.14, d + 8), sk, s * (w / 2 - 0.02), 0.07, 4 - 0.2, { outline: false });
  // a cornice where the wall meets the dark above
  part(root, box(w + 0.4, 0.12, 0.3), mix(o.wall, P.ink, 0.25), 0, h + 0.06, -d / 2 - 0.05, { outline: false });
}

const interiorLighting = (mood: Mood): Lighting => (mood === 'day' || mood === 'golden' ? 'dayInterior' : mood === 'night' ? 'nightInterior' : mood === 'neon' ? 'neon' : 'lampInterior');
const outside = (mood: Mood): props.Outside => (mood === 'day' ? 'day' : mood === 'golden' || mood === 'evening' ? 'dusk' : 'night');

// ------------------------------------------------------------------ living room

export interface LivingRoomOptions extends Common {
  w?: number;
  d?: number;
  h?: number;
  wall?: string;
  floor?: TextureName;
  /** The room's main fabric colour (sofa, curtains pick up on it). */
  accent?: string;
  /** 'edges' (default): dressing along the walls only. 'full': also a sofa, armchair, coffee table and TV. */
  furniture?: 'edges' | 'full';
  rug?: false | string;
}

/**
 * A cosy living room: wooden floor, painted walls, a window with curtains, pictures, bookshelf, lamps, plants,
 * a rug, string lights. With `furniture: 'full'` it is a complete room; by default the middle stays empty.
 */
export function livingRoom(scene: THREE.Scene, o: LivingRoomOptions = {}): Env {
  const mood = o.mood ?? 'evening';
  const w = o.w ?? 10;
  const d = o.d ?? 7;
  const h = o.h ?? 3.4;
  const dress = o.dress ?? 1;
  const rand = seeded(o.seed ?? 1);
  const accent = o.accent ?? P.mauve;
  const lit = mood !== 'day' && mood !== 'golden';
  const realLights = o.lights !== false && lit;
  const root = new THREE.Group();
  root.name = 'livingRoom';
  const rig = lightRig(scene, interiorLighting(mood), { shadowSize: Math.max(w, d) * 0.75 });
  const wall = o.wall ?? (mood === 'day' || mood === 'golden' ? P.linen : mood === 'neon' ? '#4a3a6a' : P.duskWall);
  shell(root, { w, d, h, wall, floor: o.floor ?? 'woodFloor', floorColor: mood === 'neon' ? '#5a4660' : P.oak, dado: { color: mix(wall, P.ink, 0.22), h: 0.95 } });
  const back = -d / 2;

  if (o.rug !== false) place(root, props.rug({ w: Math.min(w - 3, 5.2), d: Math.min(d - 2.4, 3.4), color: o.rug ?? P.terracotta }), 0, 0, 0.3);

  // back wall: window with curtains, pictures, shelf
  const winX = -w * 0.2;
  place(root, props.windowFrame({ w: 1.5, h: 1.6, time: outside(mood), seed: 5 + (o.seed ?? 0) }), winX, 1.95, back + 0.01);
  place(root, props.curtains({ w: 1.5, h: 1.6, color: mix(accent, P.cream, 0.25) }), winX, 1.95, back + 0.01);
  const arts: props.Art[] = ['sunset', 'hills', 'leaf', 'shapes', 'moon'];
  place(root, props.pictureFrame({ w: 0.8, h: 1.0, art: arts[Math.floor(rand() * arts.length)] as props.Art, seed: 3 }), w * 0.08, 2.15, back + 0.01);
  if (dress > 0.4) {
    place(root, props.pictureFrame({ w: 0.45, h: 0.55, art: 'leaf', frame: P.brass, seed: 9 }), w * 0.08 + 0.85, 2.4, back + 0.01);
    place(root, props.pictureFrame({ w: 0.45, h: 0.4, art: 'shapes', frame: P.charcoal, seed: 12 }), w * 0.08 + 0.85, 1.85, back + 0.01);
  }
  place(root, props.bookshelf({ w: 1.4, h: 2.1, seed: 7 + (o.seed ?? 0) }), w * 0.34, 0, back + 0.2);
  if (dress > 0.6) place(root, props.wallClock(), -w * 0.4, 2.5, back + 0.01);

  // corners: lamp, plants
  const lampL = place(root, props.floorLamp({ lit, light: realLights ? 10 : false }), -w / 2 + 0.7, 0, back + 0.75);
  lampL.name = 'floorLamp';
  place(root, props.plant({ kind: 'ficus', h: 1.9, pot: P.ceramic, seed: 4 }), w / 2 - 0.6, 0, back + 0.6);
  if (dress > 0.3) place(root, props.plant({ kind: 'monstera', h: 1.0, seed: 6 }), -w / 2 + 0.55, 0, back + 1.9);

  // left wall: a sideboard with a record player and a lamp
  const sideX = -w / 2 + 0.36;
  place(root, props.sideboard({ w: 2.0 }), sideX, 0, 0.4, Math.PI / 2);
  place(root, props.recordPlayer({ playing: lit }), sideX, 0.42, 0.75, Math.PI / 2);
  place(root, props.tableLamp({ lit, light: realLights ? 5 : false, stand: P.terracotta }), sideX, 0.42, -0.1);
  if (dress > 0.5) place(root, props.speaker({ h: 0.9 }), sideX + 0.02, 0, -0.9, Math.PI / 2);

  // right wall: a shelf, a guitar, a speaker
  const rightX = w / 2 - 0.01;
  place(root, props.wallShelf({ w: 1.3, seed: 5 }), rightX, 1.7, -0.6, -Math.PI / 2);
  if (dress > 0.4) place(root, props.guitar(), w / 2 - 0.35, 0, back + 1.9, -Math.PI / 2 + 0.3);
  if (dress > 0.2) place(root, props.pictureFrame({ w: 0.7, h: 0.5, art: 'moon', seed: 4 }), rightX, 2.5, 0.9, -Math.PI / 2);

  // string lights along the top of the back wall
  if (lit && dress > 0.2) {
    const y = h - 0.35;
    for (let i = 0; i < 3; i++) {
      const x0 = -w / 2 + 0.2 + (i * (w - 0.4)) / 3;
      root.add(props.stringLights(new THREE.Vector3(x0, y, back + 0.08), new THREE.Vector3(x0 + (w - 0.4) / 3, y, back + 0.08), { sag: 0.16, count: 7 }));
    }
  }
  if (mood === 'neon') place(root, props.neonSign('good vibes', { color: P.neonPink, h: 0.55 }), w * 0.08, 3.0, back + 0.02);

  if (o.furniture === 'full') {
    place(root, props.sofa({ seats: 3, color: accent, pillows: [P.mustard, P.teal, P.terracotta] }), 0, 0, back + 0.75, 0, 1.25);
    place(root, props.coffeeTable({ w: 1.5 }), 0, 0, 0.5);
    place(root, props.snackBowl({ fill: 'popcorn' }), -0.3, 0.42, 0.5);
    place(root, props.mug({ color: P.teal }), 0.35, 0.42, 0.6, 0.6);
    place(root, props.remote(), 0.1, 0.42, 0.72, 0.4);
    place(root, props.armchair({ color: P.terracotta, pillow: P.cream }), -w / 2 + 1.5, 0, 0.9, Math.PI / 2 - 0.35, 1.2);
    const tv = place(root, props.tvSet({ w: 1.5 }), w / 2 - 0.45, 0, 0.6, -Math.PI / 2);
    tv.name = 'tv';
  } else {
    // foreground and corner dressing that frames the play area
    place(root, props.pouf({ color: P.mustard }), -w / 2 + 1.2, 0, d / 2 - 0.2);
    if (dress > 0.5) place(root, props.beanbag({ color: P.teal }), w / 2 - 1.1, 0, d / 2 - 0.5, 0.4);
  }
  if (dress > 0.3) place(root, props.plant({ kind: 'snake', h: 0.85, pot: P.charcoal }), w / 2 - 0.45, 0, 1.6);
  if (lit && dress > 0.5) place(root, props.motes({ n: 18, area: [w * 0.8, 2.2, d * 0.7], size: 0.035 }), 0, 0.6, 0);

  return finish(scene, root, rig, { minX: -w / 2, maxX: w / 2, minZ: back, maxZ: d / 2 });
}

// ------------------------------------------------------------------ bedroom

export interface BedroomOptions extends Common {
  w?: number;
  d?: number;
  h?: number;
  wall?: string;
  bedding?: string;
  /** false leaves the bed out (the game brings its own). */
  bed?: boolean;
}

/** A bedroom: bed against the back wall, bedside tables with lamps, a window, a rug, shelves. */
export function bedroom(scene: THREE.Scene, o: BedroomOptions = {}): Env {
  const mood = o.mood ?? 'night';
  const w = o.w ?? 8;
  const d = o.d ?? 6;
  const h = o.h ?? 3.2;
  const lit = mood !== 'day' && mood !== 'golden';
  const realLights = o.lights !== false && lit;
  const root = new THREE.Group();
  root.name = 'bedroom';
  const rig = lightRig(scene, interiorLighting(mood), { shadowSize: Math.max(w, d) * 0.75 });
  const wall = o.wall ?? (lit ? '#737a8c' : P.sageWall);
  shell(root, { w, d, h, wall, floor: 'woodFloor', floorColor: P.walnut });
  const back = -d / 2;
  place(root, props.rug({ w: 3.4, d: 2.2, color: P.denim, tex: 'knit' }), 0, 0, 0.6);
  const bedX = o.bed === false ? 0 : -w * 0.12;
  if (o.bed !== false) {
    place(root, props.bed({ color: o.bedding ?? P.rose }), bedX, 0, back + 1.15, 0, 1.15);
    for (const s of [-1, 1]) {
      place(root, props.sideTable({ h: 0.5 }), bedX + s * 1.25, 0, back + 0.4);
      place(root, props.tableLamp({ lit, light: realLights && s < 0 ? 6 : false, stand: P.brass }), bedX + s * 1.25, 0.5, back + 0.4);
    }
  }
  place(root, props.windowFrame({ w: 1.3, h: 1.5, time: outside(mood) }), w * 0.28, 1.95, back + 0.01);
  place(root, props.curtains({ w: 1.3, h: 1.5, color: P.cream }), w * 0.28, 1.95, back + 0.01);
  place(root, props.pictureFrame({ w: 0.7, h: 0.5, art: 'moon' }), bedX, 2.35, back + 0.01);
  place(root, props.wallShelf({ w: 1.1 }), -w / 2 + 0.01, 1.8, 0, Math.PI / 2);
  place(root, props.plant({ kind: 'monstera', h: 1.1 }), w / 2 - 0.6, 0, back + 0.6);
  place(root, props.floorLamp({ lit, light: false }), -w / 2 + 0.6, 0, back + 0.6);
  place(root, props.bookshelf({ w: 1.0, h: 1.3, shelves: 3, seed: 5 }), w / 2 - 0.2, 0, 0.8, -Math.PI / 2);
  if (lit) root.add(props.stringLights(new THREE.Vector3(-w / 2 + 0.3, h - 0.5, back + 0.08), new THREE.Vector3(w / 2 - 0.3, h - 0.5, back + 0.08), { sag: 0.35, count: 16 }));
  return finish(scene, root, rig, { minX: -w / 2, maxX: w / 2, minZ: back, maxZ: d / 2 });
}

// ------------------------------------------------------------------ kitchen

export interface KitchenOptions extends Common {
  w?: number;
  d?: number;
  h?: number;
  wall?: string;
  cabinets?: string;
  floor?: TextureName;
  /** An island counter in the middle, this wide (leave out for an empty floor). */
  island?: number;
}

/**
 * A kitchen: cabinets with a worktop, sink and cooker along the back wall, a fridge, tiled splashback, shelves
 * with crockery, pendant lamps, a window, pots and plants.
 */
export function kitchen(scene: THREE.Scene, o: KitchenOptions = {}): Env {
  const mood = o.mood ?? 'evening';
  const w = o.w ?? 9;
  const d = o.d ?? 6.5;
  const h = o.h ?? 3.3;
  const dress = o.dress ?? 1;
  const lit = mood !== 'day' && mood !== 'golden';
  const realLights = o.lights !== false && lit;
  const cab = o.cabinets ?? P.forest;
  const root = new THREE.Group();
  root.name = 'kitchen';
  const rig = lightRig(scene, interiorLighting(mood), { shadowSize: Math.max(w, d) * 0.75 });
  const wall = o.wall ?? (lit ? '#a9a593' : P.cream);
  shell(root, { w, d, h, wall, floor: o.floor ?? 'terrazzo', floorColor: '#cdb9a4' });
  const back = -d / 2;

  // the run along the back wall: fridge | counter with sink | cooker | counter
  const runW = w - 0.4;
  let x = -runW / 2;
  place(root, props.fridge(), x + 0.42, 0, back);
  x += 0.9;
  const c1 = Math.max(1.8, runW * 0.42);
  place(root, props.kitchenCounter({ w: c1, color: cab, sink: 0 }), x + c1 / 2, 0, back);
  const sinkX = x + c1 / 2;
  x += c1;
  place(root, props.stove({ lit: lit ? 1 : 0 }), x + 0.33, 0, back);
  const stoveX = x + 0.33;
  x += 0.66;
  const c2 = runW / 2 - x;
  if (c2 > 0.5) place(root, props.kitchenCounter({ w: c2, color: cab }), x + c2 / 2, 0, back);
  // splashback tiles behind the run
  part(root, box(runW - 0.9, 0.75, 0.03), P.ceramic, 0.45, 0.94 + 0.375, back + 0.015, { tex: 'kitchenTile', texNatural: false, outline: false, gloss: 0.25 });
  // window over the sink, shelves either side
  place(root, props.windowFrame({ w: 1.2, h: 1.0, time: outside(mood), seed: 8 }), sinkX, 2.35, back + 0.01);
  place(root, props.wallShelf({ w: 1.4, items: 'kitchen', seed: 2 }), sinkX + c1 * 0.5 + 0.9, 2.1, back + 0.01);
  if (dress > 0.4) place(root, props.wallShelf({ w: 1.2, items: 'kitchen', seed: 6 }), sinkX + c1 * 0.5 + 0.9, 2.6, back + 0.01);
  // on the worktops
  place(root, props.pot({ color: P.copper }), stoveX - 0.15, 0.93, back + 0.17);
  place(root, props.pan(), stoveX + 0.15, 0.93, back + 0.45, 0.5);
  place(root, props.plant({ kind: 'trailing', h: 0.3 }), sinkX - c1 * 0.36, 0.93, back + 0.2);
  if (dress > 0.3) {
    place(root, props.jar({ color: P.mustard }), sinkX + c1 * 0.34, 0.93, back + 0.16);
    place(root, props.jar({ color: P.terracotta, h: 0.2 }), sinkX + c1 * 0.34 + 0.13, 0.93, back + 0.16);
    place(root, props.plates({ n: 5 }), sinkX - c1 * 0.2, 0.93, back + 0.36);
    if (c2 > 0.9) place(root, props.snackBowl({ fill: 'fruit', color: P.ceramic }), x + c2 / 2, 0.93, back + 0.32);
  }
  // pendant lamps
  const lampsN = o.island ? 3 : 2;
  for (let i = 0; i < lampsN; i++) {
    const lx = (i - (lampsN - 1) / 2) * 1.5;
    place(root, props.pendantLamp({ drop: h - 2.25, lit, light: realLights && i !== 1 ? 9 : false }), lx, h + 0.4, o.island ? 0 : -0.6);
  }
  if (o.island) {
    const isl = place(root, props.kitchenCounter({ w: o.island, color: mix(cab, P.ink, 0.1) }), 0, 0, -0.31);
    isl.name = 'island';
    for (let i = 0; i < Math.floor(o.island / 0.8); i++) place(root, props.stool({ h: 0.62 }), (i - (Math.floor(o.island / 0.8) - 1) / 2) * 0.8, 0, 0.75);
  }
  // side walls
  place(root, props.pictureFrame({ w: 0.6, h: 0.8, art: 'leaf', frame: P.oak }), -w / 2 + 0.01, 2.1, 0.3, Math.PI / 2);
  place(root, props.wallClock({ color: P.brass }), w / 2 - 0.01, 2.5, -0.4, -Math.PI / 2);
  if (dress > 0.3) place(root, props.plant({ kind: 'ficus', h: 1.7, pot: P.ceramic }), w / 2 - 0.6, 0, 1.2);
  if (dress > 0.5) {
    const t = place(root, props.crate({ s: 0.5 }), -w / 2 + 0.5, 0, 1.4, 0.2);
    place(t, props.plant({ kind: 'fern', h: 0.6 }), 0, 0.5, 0);
  }
  return finish(scene, root, rig, { minX: -w / 2, maxX: w / 2, minZ: back + 0.7, maxZ: d / 2 });
}

// ------------------------------------------------------------------ backyard

export interface BackyardOptions extends Common {
  /** The fenced lawn's width and depth. */
  w?: number;
  d?: number;
  /** A paved patio in the middle, this size. */
  patio?: { w: number; d: number };
  /** A brick house wall with a lit window and a door along the left side. */
  house?: boolean;
  grass?: string;
}

/**
 * A garden: lawn, fence and hedges, trees beyond, bushes and flowers, garden lamps, string lights between
 * posts, fireflies at night. Default mood: evening (dusk).
 */
export function backyard(scene: THREE.Scene, o: BackyardOptions = {}): Env {
  const mood = o.mood ?? 'evening';
  const w = o.w ?? 16;
  const d = o.d ?? 11;
  const dress = o.dress ?? 1;
  const rand = seeded(o.seed ?? 2);
  const clear = o.clear ?? { w: 8, d: 5 };
  const lit = mood === 'evening' || mood === 'night' || mood === 'neon';
  const realLights = o.lights !== false && lit;
  const root = new THREE.Group();
  root.name = 'backyard';
  const lighting: Lighting = mood === 'day' ? 'midday' : mood === 'golden' ? 'goldenHour' : mood === 'evening' ? 'dusk' : 'moonlit';
  // the low sun comes over the camera's shoulder, so what faces the camera is lit
  const rig = lightRig(scene, lighting, { fog: { near: 30, far: 95 }, shadowSize: Math.max(w, d) * 0.8, ...(mood === 'evening' || mood === 'golden' ? { sunFrom: [0.6, 0.5, 0.55] as [number, number, number] } : {}) });
  const grass = o.grass ?? (lit ? '#5f8a52' : P.grass);
  const back = -d / 2;

  // ground: the lawn, and darker land running off to the horizon
  part(root, cyl(70, 70, 0.2, 48), mix(grass, P.ink, 0.12), 0, -0.14, 0, { tex: 'grass', texScale: 6, outline: false, shadow: false });
  part(root, box(w + 1.2, 0.2, d + 10), grass, 0, -0.1, 5 - 0.6, { tex: 'grass', outline: false, shadow: false });
  if (o.patio) part(root, rbox(o.patio.w, 0.06, o.patio.d, 0.02), P.stone, 0, 0.005, 0, { tex: 'stoneTiles', outline: false, shadow: false });

  // fences and hedges
  place(root, props.fence({ w: w + 0.4, kind: 'panel' }), 0, 0, back);
  for (const s of [-1, 1]) {
    if (s < 0 && o.house) continue;
    place(root, props.fence({ w: d + 6, kind: 'panel' }), s * (w / 2 + 0.1), 0, 3 - 0.2, (s * Math.PI) / 2);
  }
  place(root, props.hedge({ w: w * 0.36, h: 1.1, seed: 3 }), -w * 0.26, 0, back + 0.6);
  place(root, props.hedge({ w: w * 0.22, h: 0.9, seed: 5 }), w * 0.34, 0, back + 0.6);
  if (o.house) {
    // the house: a brick wall along the left with a glowing window and a door
    const hx = -w / 2 - 0.1;
    part(root, box(0.4, 4.2, d + 8), P.brick, hx - 0.1, 2.1, 3, { tex: 'brick', outline: false });
    place(root, props.windowFrame({ w: 1.4, h: 1.3, time: lit ? 'dusk' : 'day', seed: 2 }), hx + 0.11, 1.9, -0.6, Math.PI / 2);
    if (lit) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(1.5) }));
      place(root, glow, hx + 0.125, 1.9, -0.6, Math.PI / 2);
    }
    part(root, rbox(0.08, 2.1, 1.0, 0.02), P.forest, hx + 0.12, 1.05, 1.8, {});
    part(root, sphere(0.04, 8), P.brass, hx + 0.19, 1.05, 2.15, { outline: false, gloss: 0.6 });
    place(root, props.gardenLamp({ h: 0.1, lit, light: realLights ? 8 : false }), hx + 0.3, 2.3, 1.8);
  }

  // trees beyond the fence
  const kinds: props.TreeKind[] = ['round', 'birch', 'round', 'pine'];
  for (let i = 0; i < 9; i++) {
    const tx = -w * 0.75 + (i / 8) * w * 1.5 + (rand() - 0.5) * 1.5;
    place(root, props.tree({ kind: kinds[i % kinds.length] as props.TreeKind, h: 4.2 + rand() * 2.6, seed: i + 1 }), tx, 0, back - 1.6 - rand() * 3.5);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) place(root, props.tree({ kind: i % 2 ? 'pine' : 'round', h: 4.5 + rand() * 2, seed: 20 + i }), s * (w / 2 + 2.2 + rand() * 2.5), 0, back + 2 + i * 4.5);

  // inside the garden: bushes, flowers, a tree in a corner, tufts
  place(root, props.tree({ kind: 'round', h: 3.4, seed: 8 }), w / 2 - 1.3, 0, back + 1.6);
  const flowers = [P.rose, P.mustard, P.cream, P.terracotta];
  place(root, props.bush({ r: 0.65, flowers: P.rose, seed: 2 }), -w / 2 + 1.0, 0, back + 1.5);
  place(root, props.bush({ r: 0.5, flowers: P.mustard, seed: 4 }), w / 2 - 2.6, 0, back + 1.1);
  place(root, props.rock({ r: 0.35 }), -w / 2 + 2.2, 0, back + 1.2);
  const tufts = Math.round(40 * dress);
  for (let i = 0; i < tufts; i++) {
    const tx = (rand() - 0.5) * (w - 0.8);
    const tz = back + 0.8 + rand() * (d + 2);
    if (Math.abs(tx) < clear.w / 2 && Math.abs(tz) < clear.d / 2) continue;
    place(root, props.tuft({ seed: i + 1, ...(rand() < 0.3 ? { flowers: flowers[i % flowers.length] as string } : {}), s: 0.9 + rand() * 0.6 }), tx, 0, tz, rand() * 6);
  }

  // lamps and string lights
  const lampXs = [-w / 2 + 0.9, w / 2 - 0.9];
  lampXs.forEach((lx, i) => place(root, props.gardenLamp({ h: 0.75, lit, light: realLights && !o.house ? 7 : realLights && i === 1 ? 7 : false }), lx, 0, 1.2));
  if (dress > 0.2) {
    const poleH = 3.1;
    const pts = [new THREE.Vector3(-w / 2 + 0.4, poleH, back + 0.3), new THREE.Vector3(0, poleH + 0.2, back + 0.25), new THREE.Vector3(w / 2 - 0.4, poleH, back + 0.3)];
    for (const p of pts) part(root, cyl(0.035, 0.045, p.y, 8), P.woodDark, p.x, p.y / 2, p.z, { tex: 'planks' });
    for (let i = 0; i < pts.length - 1; i++) {
      const bulbs = { sag: 0.4, count: 12, ...(lit ? {} : { colors: [P.ceramic] as const }) };
      root.add(props.stringLights(pts[i] as THREE.Vector3, pts[i + 1] as THREE.Vector3, bulbs));
    }
  }
  if (lit) place(root, props.motes({ n: 26, area: [w * 0.9, 1.6, d * 0.9], color: '#d8ff9a', size: 0.06, seed: 9 }), 0, 0.3, 0);
  return finish(scene, root, rig, { minX: -w / 2 + 0.3, maxX: w / 2 - 0.3, minZ: back + 1.2, maxZ: d / 2 });
}

// ------------------------------------------------------------------ beach

export interface BeachOptions extends Common {
  /** How far behind the origin the waterline is (the sea lies beyond, at -z). */
  shore?: number;
  /** A lit campfire at this position on the sand. */
  campfire?: [number, number];
  /** Leave out the parasols and towels. */
  bare?: boolean;
}

/**
 * A beach: sand in front, a living sea with a foam edge behind, palms, rocks, parasols and towels, islands on
 * the horizon. Default mood: golden hour.
 */
export function beach(scene: THREE.Scene, o: BeachOptions = {}): Env {
  const mood = o.mood ?? 'golden';
  const shore = o.shore ?? 5;
  const dress = o.dress ?? 1;
  const rand = seeded(o.seed ?? 3);
  const clear = o.clear ?? { w: 8, d: 5 };
  const lit = mood === 'evening' || mood === 'night' || mood === 'neon';
  const root = new THREE.Group();
  root.name = 'beach';
  const lighting: Lighting = mood === 'day' ? 'midday' : mood === 'golden' ? 'goldenHour' : mood === 'evening' ? 'dusk' : 'moonlit';
  // the sun sits over the sea, so the water catches it
  const rig = lightRig(scene, lighting, { fog: { near: 40, far: 150 }, shadowSize: 16, sunFrom: mood === 'day' ? [0.3, 1, -0.3] : mood === 'night' ? [-0.35, 0.8, -0.6] : [0.55, 0.42, -0.75] });
  const sky = LIGHTING[lighting];
  const sandC = lit ? '#b79f86' : P.sand;

  // sand: a broad beach sloping gently into the water
  part(root, box(160, 0.4, 60), sandC, 0, -0.2, 30 - shore - 2, { tex: 'sand', outline: false, shadow: false });
  const wet = part(root, box(160, 0.4, 6), mix(sandC, '#6a5a4e', 0.45), 0, -0.26, -shore - 1.2, { tex: 'sand', outline: false, shadow: false, gloss: 0.25 });
  wet.rotation.x = 0.035;
  const sea = props.water({
    w: 220,
    d: 150,
    shoreZ: 75,
    scale: 0.55,
    waves: 0.06,
    segments: 60,
    shallow: mood === 'night' ? '#1f4f6e' : mood === 'evening' ? '#4a7f9a' : '#43b6b5',
    deep: mood === 'night' ? '#0c1c3c' : mood === 'evening' ? '#27406e' : '#1c6a90',
    sky: sky.horizon ?? sky.background,
    foam: mood === 'night' ? '#b8c8f0' : '#f2fbff',
  });
  place(root, sea, 0, -0.12, -shore - 75 + 0.6);

  // islands on the horizon
  for (let i = 0; i < 4; i++) {
    const ix = -70 + i * 45 + rand() * 12;
    const s = 6 + rand() * 7;
    part(root, sphere(1, 16), mix(P.pine, sky.horizon ?? sky.background, 0.55), ix, -0.3, -shore - 70 - rand() * 30, { sx: s * 2.2, sy: s * 0.5, sz: s, outline: false, shadow: false });
  }
  // rocks at the water's edge, palms at the sides and back
  place(root, props.rock({ r: 0.9, seed: 3 }), -9 - rand() * 2, 0, -shore + 0.6);
  place(root, props.rock({ r: 0.6, seed: 5 }), 10 + rand() * 2, 0, -shore + 1.4);
  place(root, props.rock({ r: 0.45, seed: 7 }), 7.6, -0.1, -shore - 1.5);
  const palmSpots: [number, number][] = [
    [-8.5, -shore + 2.6],
    [-11, 0.5],
    [9.5, -shore + 3.2],
    [12, 1.5],
    [-12.5, 4],
  ];
  palmSpots.forEach(([px, pz], i) => place(root, props.tree({ kind: 'palm', h: 4.4 + rand() * 1.6, seed: i + 2 }), px, 0, pz, rand() * 6));
  for (let i = 0; i < 4; i++) place(root, props.bush({ r: 0.5 + rand() * 0.3, color: P.olive, seed: i + 1 }), (i % 2 ? 1 : -1) * (10.5 + rand() * 3), 0, -1 + i * 1.6);

  if (!o.bare) {
    place(root, props.parasol({ colors: [P.terracotta, P.cream] }), -clear.w / 2 - 1.6, 0, -1.2, 0.4);
    place(root, props.blanket({ color: P.teal, stripes: P.cream }), -clear.w / 2 - 1.5, 0, -0.4, 0.3);
    if (dress > 0.4) {
      place(root, props.parasol({ colors: [P.mustard, P.cream], h: 2.1 }), clear.w / 2 + 2.2, 0, 0.6, -0.5);
      place(root, props.blanket({ color: P.rose, tex: 'gingham', w: 1.6, d: 1.6 }), clear.w / 2 + 2.0, 0, 1.3, -0.2);
      place(root, props.snackBowl({ fill: 'fruit', color: P.ceramic }), clear.w / 2 + 2.0, 0.03, 1.3);
      place(root, props.drink({ kind: 'bottle', color: P.forest }), clear.w / 2 + 2.4, 0.03, 1.0);
    }
  }
  if (dress > 0.3) place(root, props.logSeat({ len: 1.8 }), clear.w / 2 + 1.5, 0, -shore + 2.2, 0.5);
  if (o.campfire) place(root, props.campfire({ light: o.lights !== false }), o.campfire[0], 0, o.campfire[1]);
  // shells and pebbles
  for (let i = 0; i < Math.round(26 * dress); i++) {
    const sx = (rand() - 0.5) * 26;
    const sz = -shore + 0.4 + rand() * (shore + 5);
    if (Math.abs(sx) < clear.w / 2 && Math.abs(sz) < clear.d / 2) continue;
    part(root, sphere(0.05 + rand() * 0.05, 6), rand() < 0.5 ? P.ceramic : mix(P.stone, P.rose, rand() * 0.5), sx, 0.02, sz, { sy: 0.5, outline: false, shadow: false });
  }
  if (lit) place(root, props.motes({ n: 16, area: [20, 1.5, 8], color: '#d8ff9a', size: 0.06 }), 0, 0.4, 1);
  setLook(scene, { rimStrength: (sky.rimStrength ?? 0.3) + 0.08 });
  return finish(scene, root, rig, { minX: -9, maxX: 9, minZ: -shore + 0.8, maxZ: 8 });
}

// ------------------------------------------------------------------ rooftop

export interface RooftopOptions extends Common {
  w?: number;
  d?: number;
  /** Words for the neon sign on the stair house (none without). */
  sign?: string;
  /** A lounge corner with a sofa made of crates and cushions. */
  lounge?: boolean;
}

/**
 * A city rooftop at night: concrete deck, brick parapet, a stair house with a door and a lamp, water tank,
 * vents, planters, string lights overhead, and the skyline all around. Default mood: night ('neon' adds colour).
 */
export function rooftop(scene: THREE.Scene, o: RooftopOptions = {}): Env {
  const mood = o.mood ?? 'night';
  const w = o.w ?? 14;
  const d = o.d ?? 10;
  const dress = o.dress ?? 1;
  const rand = seeded(o.seed ?? 4);
  const lit = mood !== 'day' && mood !== 'golden';
  const realLights = o.lights !== false && lit;
  const root = new THREE.Group();
  root.name = 'rooftop';
  const lighting: Lighting = mood === 'day' ? 'midday' : mood === 'golden' ? 'goldenHour' : mood === 'evening' ? 'dusk' : mood === 'neon' ? 'neon' : 'moonlit';
  const sky: SkyLook = mood === 'neon' ? { ...SKIES.night, ...LIGHTING.neon, zenith: '#0a0620', horizon: '#3a1f6a', ground: '#140a2a', stars: 0.7, sunGlow: 0.6, moon: true, clouds: 0.25, cloudColor: '#4a2f7a' } : LIGHTING[lighting];
  const sun = applySky(scene, sky, { near: 45, far: 170 }, Math.max(w, d) * 0.8);
  setGrade(scene, (sky.grade ?? 'night') as GradeName);
  const rig: Rig = { sun, extras: [] };
  if (mood === 'neon') {
    const pink = new THREE.DirectionalLight(P.neonPink, 0.8);
    pink.position.set(-8, 3, -2);
    const cyan = new THREE.DirectionalLight(P.neonCyan, 0.6);
    cyan.position.set(8, 3, -1);
    scene.add(pink, cyan);
    rig.extras.push(pink, cyan);
  }
  const back = -d / 2;
  const deck = lit ? '#6a6672' : '#a8a39c';
  const brick = lit ? '#7a4a44' : P.brick;

  // the deck and the building below it
  part(root, box(w + 0.8, 0.3, d + 8), deck, 0, -0.15, 4 - 0.4, { tex: 'concrete', outline: false, shadow: false });
  part(root, box(w + 0.6, 30, d + 8), mix(brick, P.ink, 0.35), 0, -15.3, 4 - 0.4, { tex: 'brick', outline: false, shadow: false });
  // parapet: back and sides
  const wallH = 0.95;
  const parapet = (pw: number, x: number, z: number, ry: number) => {
    const g = new THREE.Group();
    part(g, box(pw, wallH, 0.3), brick, 0, wallH / 2, 0, { tex: 'brick', outline: false });
    part(g, rbox(pw + 0.1, 0.1, 0.42, 0.03), P.stone, 0, wallH + 0.05, 0, { tex: 'concrete' });
    place(root, g, x, 0, z, ry);
  };
  parapet(w + 0.6, 0, back - 0.15, 0);
  for (const s of [-1, 1]) parapet(d + 8, s * (w / 2 + 0.15), 4 - 0.4, Math.PI / 2);

  // the skyline
  root.add(props.skyline({ radius: 70, seed: 21 + (o.seed ?? 0), base: mood === 'neon' ? '#1c1240' : lit ? '#161a3c' : '#8f9ab0', windows: lit ? '#ffd58a' : '#c9d4e6', y: -22, height: 44 }));
  root.add(props.skyline({ radius: 38, seed: 5 + (o.seed ?? 0), base: mood === 'neon' ? '#140c30' : lit ? '#10142e' : '#7f8aa0', windows: lit ? '#ffc978' : '#c9d4e6', y: -26, height: 30 }));

  // stair house at the back left, with a door, a lamp and maybe a sign
  const hx = -w / 2 + 1.7;
  const hz = back + 1.3;
  part(root, box(3, 2.7, 2.2), brick, hx, 1.35, hz, { tex: 'brick' });
  part(root, rbox(3.3, 0.14, 2.5, 0.04), P.charcoal, hx, 2.77, hz, { tex: 'concrete' });
  part(root, rbox(0.95, 2.0, 0.08, 0.02), P.forest, hx + 0.5, 1.0, hz + 1.12, { gloss: 0.2 });
  part(root, sphere(0.04, 8), P.brass, hx + 0.82, 1.0, hz + 1.18, { outline: false, gloss: 0.6 });
  const doorLamp = place(root, props.gardenLamp({ h: 0.05, lit, light: realLights ? 7 : false }), hx + 0.5, 2.2, hz + 1.2);
  doorLamp.name = 'doorLamp';
  if (o.sign && lit) place(root, props.neonSign(o.sign, { color: mood === 'neon' ? P.neonCyan : P.neonPink, h: 0.5 }), hx - 0.3, 2.1, hz + 1.12);

  // water tank at the back right
  const tx = w / 2 - 1.6;
  const tz = back + 1.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(root, box(0.1, 1.5, 0.1), P.charcoal, tx + sx * 0.6, 0.75, tz + sz * 0.6, { outline: false });
  part(root, cyl(0.95, 0.95, 1.6, 20), P.woodDark, tx, 2.3, tz, { tex: 'planks' });
  part(root, new THREE.ConeGeometry(1.05, 0.6, 20), P.charcoal, tx, 3.4, tz, { tex: 'metalPlate', texStrength: 0.4 });
  for (const y of [1.8, 2.8]) part(root, cyl(0.97, 0.97, 0.06, 20), P.metal, tx, y, tz, { outline: false });

  // vents, an air conditioner, an aerial
  const vent = (x: number, z: number, s = 1) => {
    part(root, box(0.7 * s, 0.6 * s, 0.7 * s), P.metal, x, 0.3 * s, z, { tex: 'metalPlate', texStrength: 0.35, gloss: 0.2 });
    part(root, cyl(0.24 * s, 0.24 * s, 0.05, 16), P.charcoal, x, 0.62 * s, z, { outline: false });
  };
  vent(w / 2 - 1.0, 1.4);
  if (dress > 0.4) vent(-w / 2 + 0.9, 2.2, 0.8);
  part(root, cyl(0.02, 0.02, 2.4, 6), P.charcoal, hx - 0.9, 3.9, hz - 0.5, { outline: false });
  for (let i = 0; i < 3; i++) part(root, box(0.7 - i * 0.15, 0.02, 0.02), P.charcoal, hx - 0.9, 4.4 + i * 0.25, hz - 0.5, { outline: false });
  if (lit) part(root, sphere(0.05, 8), '#ff4a4a', hx - 0.9, 5.12, hz - 0.5, { glow: 2.4, outline: false, shadow: false });

  // planters and crates along the edges
  const plantKinds: props.PlantKind[] = ['fern', 'snake', 'monstera', 'palm'];
  for (let i = 0; i < Math.round(5 * dress); i++) {
    const side = i % 2 ? 1 : -1;
    const c = place(root, props.crate({ s: 0.5 }), side * (w / 2 - 0.55), 0, -0.6 + i * 0.85, rand() * 0.3);
    place(c, props.plant({ kind: plantKinds[i % plantKinds.length] as props.PlantKind, h: 0.7 + rand() * 0.5, pot: P.charcoal }), 0, 0.5, 0);
  }
  if (o.lounge) {
    const lx = w / 2 - 2.6;
    place(root, props.sofa({ seats: 2, color: P.denim, pillows: [P.mustard, P.rose] }), lx, 0, back + 3.2, -0.5, 1.2);
    place(root, props.crate({ s: 0.45 }), lx - 1.5, 0, back + 3.9, 0.3);
    place(root, props.candle(), lx - 1.5, 0.45, back + 3.9);
    place(root, props.rug({ w: 2.6, d: 1.8, color: P.terracotta }), lx - 0.6, 0, back + 4.2, -0.5);
  }

  // string lights from the stair house over the deck to posts at the right
  if (dress > 0.2) {
    const a = new THREE.Vector3(hx + 1.4, 2.85, hz + 1.0);
    const posts = [new THREE.Vector3(w / 2 - 0.3, 3.0, back + 3.4), new THREE.Vector3(w / 2 - 0.3, 3.0, 2.6)];
    for (const p of posts) part(root, cyl(0.035, 0.045, p.y, 8), P.charcoal, p.x, p.y / 2, p.z, { outline: false });
    const far = new THREE.Vector3(-w / 2 + 0.3, 3.0, 2.6);
    part(root, cyl(0.035, 0.045, far.y, 8), P.charcoal, far.x, far.y / 2, far.z, { outline: false });
    const colors = mood === 'neon' ? [P.neonPink, P.neonCyan, P.neonViolet, P.lamp] : lit ? [P.lamp] : [P.ceramic];
    root.add(props.stringLights(a, posts[0] as THREE.Vector3, { sag: 0.5, count: 18, colors }));
    root.add(props.stringLights(a, far, { sag: 0.35, count: 8, colors }));
    root.add(props.stringLights(far, posts[1] as THREE.Vector3, { sag: 0.7, count: 22, colors }));
  }
  return finish(scene, root, rig, { minX: -w / 2 + 0.4, maxX: w / 2 - 0.4, minZ: back + 0.4, maxZ: d / 2 });
}
