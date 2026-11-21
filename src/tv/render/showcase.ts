// The environment preview (a development tool): `?env=<name>` on the page address shows one environment from
// env.ts, the props gallery (`props`) or the texture swatches (`textures`) on its own, without the interface.
// Options: `&mood=day|golden|evening|night|neon`, `&full=1` (the fuller variant: a living room with all its
// furniture, a kitchen island, a garden with house and patio…), `&cam=x,y,z`, `&look=x,y,z`, `&fov=40`,
// `&orbit=1` (sway the camera), `&people=0` (hide the stand-ins).
// Four player-sized stand-ins in the seat colours show the scale.
import * as THREE from 'three';
import { SEAT_COLORS } from '../../shared/look';
import type { View } from '../stage';
import { type Env, type Mood, backyard, beach, bedroom, kitchen, lightRig, livingRoom, rooftop } from './env';
import * as props from './props';
import { TEXTURES, type TextureName } from './textures';
import { PALETTE as P, box, nameCard, part, pill, rbox, sphere } from './toon';

function standIns(scene: THREE.Scene): void {
  SEAT_COLORS.forEach((c, i) => {
    const g = new THREE.Group();
    part(g, pill(0.36, 0.5), c, 0, 0.62, 0);
    part(g, sphere(0.08, 10), '#ffffff', -0.13, 0.9, 0.31, { outline: false });
    part(g, sphere(0.08, 10), '#ffffff', 0.13, 0.9, 0.31, { outline: false });
    g.position.set((i - 1.5) * 1.3, 0, 0.4);
    scene.add(g);
  });
}

function gallery(scene: THREE.Scene): Env {
  const rig = lightRig(scene, 'lampInterior', { shadowSize: 16 });
  const root = new THREE.Group();
  part(root, box(40, 0.2, 30), P.oak, 0, -0.1, 0, { tex: 'woodFloor', outline: false, shadow: false });
  part(root, box(40, 6, 0.2), P.duskWall, 0, 3, -5.1, { tex: 'plaster', outline: false });
  const rows: (() => THREE.Object3D)[][] = [
    [
      () => props.sofa({ pillows: [P.mustard, P.teal] }),
      () => props.armchair({ pillow: P.cream }),
      () => props.beanbag(),
      () => props.pouf(),
      () => props.bed(),
      () => props.coffeeTable(),
      () => props.coffeeTable({ round: true, w: 0.9 }),
      () => props.sideTable(),
      () => props.table({ cloth: P.cream }),
      () => props.stool(),
      () => props.sideboard(),
    ],
    [
      () => props.floorLamp({ light: 6 }),
      () => props.tableLamp(),
      () => props.bookshelf(),
      () => props.plant({ kind: 'monstera' }),
      () => props.plant({ kind: 'fern' }),
      () => props.plant({ kind: 'snake' }),
      () => props.plant({ kind: 'ficus' }),
      () => props.plant({ kind: 'cactus' }),
      () => props.plant({ kind: 'palm' }),
      () => props.plant({ kind: 'trailing' }),
      () => props.vase({ stems: true }),
      () => props.tvSet(),
      () => props.speaker(),
      () => props.guitar(),
    ],
    [
      () => props.kitchenCounter({ sink: 0 }),
      () => props.fridge(),
      () => props.stove({ lit: 2 }),
      () => props.crate(),
      () => props.tree({ h: 2.6 }),
      () => props.tree({ kind: 'pine', h: 2.6 }),
      () => props.tree({ kind: 'palm', h: 2.8 }),
      () => props.tree({ kind: 'birch', h: 2.6 }),
      () => props.bush({ flowers: P.rose }),
      () => props.hedge({ w: 1.6 }),
      () => props.fence({ w: 1.6 }),
      () => props.rock(),
      () => props.campfire({ light: 6 }),
      () => props.logSeat(),
      () => props.parasol({ h: 2 }),
      () => props.gardenLamp(),
    ],
  ];
  rows.forEach((row, r) => {
    let x = -(row.length - 1) * 0.95;
    for (const make of row) {
      const o = make();
      o.position.set(x, 0, -3.6 + r * 2.6);
      root.add(o);
      x += 1.9;
    }
  });
  // small things on a table at the front
  const t = props.table({ w: 5.4, d: 0.9 });
  t.position.set(0, 0, 3.6);
  root.add(t);
  const small = [
    props.mug(),
    props.plates({ n: 4 }),
    props.snackBowl(),
    props.snackBowl({ fill: 'fruit', color: P.ceramic }),
    props.pizzaBox({ open: true, slices: 6 }),
    props.pizzaBox(),
    props.drink(),
    props.drink({ kind: 'bottle' }),
    props.jar(),
    props.remote(),
    props.pot(),
    props.pan(),
    props.recordPlayer(),
    props.candle(),
    props.tableLamp(),
  ];
  small.forEach((o, i) => {
    o.position.set(-2.4 + i * 0.34, 0.76, 3.6);
    root.add(o);
  });
  // wall things
  const wallThings = [
    props.windowFrame({ time: 'day' }),
    props.windowFrame({ time: 'dusk' }),
    props.windowFrame({ time: 'night' }),
    props.pictureFrame({ art: 'sunset' }),
    props.pictureFrame({ art: 'hills' }),
    props.pictureFrame({ art: 'leaf' }),
    props.pictureFrame({ art: 'shapes' }),
    props.pictureFrame({ art: 'moon' }),
    props.wallClock(),
    props.wallShelf(),
    props.wallShelf({ items: 'kitchen' }),
    props.neonSign('late night'),
  ];
  wallThings.forEach((o, i) => {
    o.position.set(-13 + i * 2.3, 3.6, -5);
    root.add(o);
  });
  const c = props.curtains();
  c.position.set(-13, 3.6, -5);
  root.add(c);
  scene.add(root);
  return { root, sun: rig.sun, lamps: [], update: props.tickProps(root), bounds: { minX: -20, maxX: 20, minZ: -5, maxZ: 5 } };
}

function swatches(scene: THREE.Scene): Env {
  const rig = lightRig(scene, 'dayInterior', { shadowSize: 12 });
  const root = new THREE.Group();
  part(root, box(40, 0.2, 30), P.linen, 0, -0.1, 0, { outline: false, shadow: false });
  const names = Object.keys(TEXTURES) as TextureName[];
  names.forEach((name, i) => {
    const x = ((i % 9) - 4) * 1.5;
    const z = -2.4 + Math.floor(i / 9) * 2.6;
    part(root, rbox(1.2, 1.2, 1.2, 0.1), '#ffffff', x, 0.6, z, { tex: name, texNatural: true, exact: true });
    part(root, sphere(0.42), P.cream, x, 1.62, z, { tex: name });
    const label = nameCard(name, P.terracotta, 0.8);
    label.position.set(x, 2.3, z);
    root.add(label);
  });
  scene.add(root);
  return { root, sun: rig.sun, lamps: [], update: () => undefined, bounds: { minX: -8, maxX: 8, minZ: -4, maxZ: 4 } };
}

interface Entry {
  build: (scene: THREE.Scene, mood: Mood | undefined, full: boolean) => Env;
  cam: [number, number, number];
  look: [number, number, number];
  people?: boolean;
}

const BUILDERS: Record<string, Entry> = {
  livingRoom: { build: (s, mood, full) => livingRoom(s, { ...(mood ? { mood } : {}), ...(full ? { furniture: 'full' as const } : {}) }), cam: [0, 3.4, 9.2], look: [0, 1.0, -0.6], people: true },
  bedroom: { build: (s, mood) => bedroom(s, mood ? { mood } : {}), cam: [0, 3.2, 8.2], look: [0, 1.0, -0.6], people: true },
  kitchen: { build: (s, mood, full) => kitchen(s, { ...(mood ? { mood } : {}), ...(full ? { island: 2.4 } : {}) }), cam: [0, 3.3, 8.8], look: [0, 1.1, -0.8], people: true },
  backyard: { build: (s, mood, full) => backyard(s, { ...(mood ? { mood } : {}), ...(full ? { house: true, patio: { w: 7, d: 4 } } : {}) }), cam: [0, 4.4, 12.5], look: [0, 0.9, -1], people: true },
  beach: { build: (s, mood, full) => beach(s, { ...(mood ? { mood } : {}), ...(full ? { campfire: [4.6, 0.6] as [number, number] } : {}) }), cam: [0, 3.6, 12], look: [0, 1.0, -2], people: true },
  rooftop: { build: (s, mood, full) => rooftop(s, { ...(mood ? { mood } : {}), sign: 'open late', ...(full ? { lounge: true } : {}) }), cam: [0, 4.2, 12], look: [0, 1.2, -1.2], people: true },
  props: { build: (s) => gallery(s), cam: [0, 7.5, 13.5], look: [0, 0.8, -0.5] },
  textures: { build: (s) => swatches(s), cam: [0, 7, 9], look: [0, 0.8, 0] },
};

export function showcaseView(name: string): View {
  const q = new URLSearchParams(window.location.search);
  const entry = BUILDERS[name] ?? (BUILDERS.livingRoom as Entry);
  const scene = new THREE.Scene();
  const mood = (q.get('mood') ?? undefined) as Mood | undefined;
  const env = entry.build(scene, mood, q.get('full') === '1');
  if (entry.people && q.get('people') !== '0') standIns(scene);
  const vec = (key: string, fallback: [number, number, number]): [number, number, number] => {
    const parts = (q.get(key) ?? '').split(',').map(Number);
    return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? (parts as [number, number, number]) : fallback;
  };
  const camera = new THREE.PerspectiveCamera(Number(q.get('fov')) || 38, window.innerWidth / window.innerHeight, 0.1, 400);
  const centre = new THREE.Vector3(...vec('look', entry.look));
  camera.position.set(...vec('cam', entry.cam));
  camera.lookAt(centre);
  const orbit = q.get('orbit') === '1';
  const start = camera.position.clone();
  return {
    scene,
    camera,
    update(dt, time) {
      env.update(dt, time);
      if (!orbit) return;
      const a = Math.sin(time * 0.25) * 0.5;
      const dx = start.x - centre.x;
      const dz = start.z - centre.z;
      camera.position.set(centre.x + dx * Math.cos(a) + dz * Math.sin(a), start.y, centre.z + dz * Math.cos(a) - dx * Math.sin(a));
      camera.lookAt(centre);
    },
  };
}
