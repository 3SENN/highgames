// Don't Kill the Vibe: everyone together keeps a house party going until sunrise. Every hour something happens
// (good or bad for the vibe), the group votes which room to go to next, and that room's co-op minigame lifts
// the vibe as much as the group pulls it off. Time drains the vibe a little every hour; at zero the party
// fizzles out.
import * as THREE from 'three';
import { type Companion, buildCompanion } from '../../companion/kit';
import { pick, shuffle } from '../../game/rng';
import type { Host } from '../host';
import { coopMinigames } from '../minigames';
import { CameraFit, type Mark } from '../minigames/kit';
import type { Minigame, MinigameResult } from '../minigames/types';
import { type Env, rooftop } from '../render/env';
import { GRADES, type Grade, type GradeInput } from '../render/post';
import * as props from '../render/props';
import { PALETTE as P, box, canvasTexture, cyl, disc, mix, part, rbox, setLook, toonMat } from '../render/toon';
import type { View } from '../stage';

const HOURS = ['10 PM', '11 PM', 'Midnight', '1 AM', '2 AM', '3 AM', '4 AM'];
const ROOMS = ['Kitchen', 'Living room', 'Balcony', 'Basement', 'Backyard', 'Attic', 'Hallway', 'Rooftop'];
const DRAIN = 0.1;
const BEST_KEY = 'highgames-vibe-best';

const EVENTS: { title: string; text: string; vibe: number }[] = [
  { title: 'Knock knock', text: 'The neighbour asks if the music could be "a tiny bit" quieter.', vibe: -0.1 },
  { title: 'Jackpot', text: 'Someone found the good snacks in the back of the cupboard.', vibe: 0.12 },
  { title: 'Wait, what?', text: 'Everyone forgot what the movie was about. Twenty minutes in.', vibe: -0.06 },
  { title: 'That song', text: 'A great song comes on and the whole room hums along.', vibe: 0.1 },
  { title: 'Pizza!', text: 'The pizza arrives early and it is still hot.', vibe: 0.14 },
  { title: 'Silence', text: 'The playlist ended and nobody noticed for a while.', vibe: -0.08 },
  { title: 'Phone call', text: "Someone's mum calls just to check in. Twice.", vibe: -0.07 },
  { title: 'Blanket fort', text: 'A blanket fort appears in the living room. Nobody knows who built it.', vibe: 0.08 },
  { title: 'Crumbs', text: 'The last chip breaks in half inside the dip.', vibe: -0.05 },
];

// ------------------------------------------------------------------ the night, hour by hour

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const SKY_COLORS = ['zenith', 'horizon', 'ground', 'fog', 'hemiSky', 'hemiGround', 'sun', 'ambient', 'cloud', 'rim', 'city'] as const;
type SkyColor = (typeof SKY_COLORS)[number];
type SkyNumber = 'hemi' | 'sunI' | 'ambI' | 'stars' | 'clouds' | 'rimS' | 'outline' | 'lamps';
/** The sky and its light at one moment of the night (`at`: 0 = 10 PM, 1 = sunrise). */
type SkyKey = { at: number; from: [number, number, number]; grade: Grade } & Record<SkyColor, string> & Record<SkyNumber, number>;

const NIGHT: SkyKey = {
  at: 0,
  zenith: '#080b22',
  horizon: '#242f58',
  ground: '#101430',
  fog: '#141938',
  hemiSky: '#646b9c',
  hemiGround: '#1d2236',
  hemi: 0.62,
  sun: '#b8ccff',
  sunI: 0.85,
  from: [-0.4, 0.9, -0.3],
  ambient: '#8d96c6',
  ambI: 0.16,
  stars: 1,
  clouds: 0.3,
  cloud: '#3a4a86',
  rim: '#a3b8ff',
  rimS: 0.42,
  outline: 0.45,
  city: '#ffffff',
  lamps: 1,
  grade: GRADES.night,
};

/** Night until about 2 AM, then the deep blue before dawn, first light on the horizon, and the sun coming up. */
const SKY_KEYS: SkyKey[] = [
  NIGHT,
  { ...NIGHT, at: 0.5 },
  { ...NIGHT, at: 0.72, zenith: '#0c1233', horizon: '#3d3f78', ground: '#161a3a', fog: '#1c2148', hemiSky: '#7076ac', hemiGround: '#222640', hemi: 0.64, sunI: 0.7, stars: 0.75, cloud: '#46508c', outline: 0.48 },
  {
    at: 0.87,
    zenith: '#1c2a5e',
    horizon: '#d27a6e',
    ground: '#3d3252',
    fog: '#55476e',
    hemiSky: '#a99cc9',
    hemiGround: '#3c3348',
    hemi: 0.74,
    sun: '#ffb890',
    sunI: 0.55,
    from: [0.3, 0.5, -0.5],
    ambient: '#a99ad0',
    ambI: 0.16,
    stars: 0.3,
    clouds: 0.42,
    cloud: '#c77c84',
    rim: '#ffb696',
    rimS: 0.4,
    outline: 0.6,
    city: '#c8b4c4',
    lamps: 0.8,
    grade: GRADES.dusk,
  },
  {
    at: 1,
    zenith: '#6b8fc6',
    horizon: '#ffb680',
    ground: '#b58f8c',
    fog: '#e3aa8c',
    hemiSky: '#ecd9e2',
    hemiGround: '#8d7b74',
    hemi: 0.92,
    sun: '#ffc48a',
    sunI: 1.7,
    from: [0.45, 0.34, -0.55],
    ambient: '#c9c4ff',
    ambI: 0.18,
    stars: 0,
    clouds: 0.5,
    cloud: '#ffc9ac',
    rim: '#ffd2a2',
    rimS: 0.42,
    outline: 0.85,
    city: '#9c8590',
    lamps: 0.3,
    grade: GRADES.golden,
  },
];
const SKY_KEY_COLORS = SKY_KEYS.map((k) => Object.fromEntries(SKY_COLORS.map((c) => [c, new THREE.Color(k[c])])) as Record<SkyColor, THREE.Color>);

function lerpGrade(a: Grade, b: Grade, t: number): Grade {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = { ...a } as unknown as Record<string, number | string>;
  for (const k of Object.keys(a) as (keyof Grade)[]) {
    const x = a[k];
    const y = b[k];
    if (typeof x === 'number' && typeof y === 'number') out[k] = lerp(x, y, t);
    else if (typeof x === 'string' && typeof y === 'string') out[k] = mix(x, y, t);
  }
  return out as unknown as Grade;
}

// ------------------------------------------------------------------ the party

/** The fire bowl everyone sits around. */
const FIRE = new THREE.Vector3(0.6, 0, 1.9);
/** The beanbags: a shallow curve either side of the fire, facing the camera. [x from the fire, z, turn] */
const SEATS: readonly (readonly [number, number, number])[] = [
  [-3.9, 1.6, 0.5],
  [-2.0, 1.0, 0.25],
  [2.0, 1.0, -0.25],
  [3.9, 1.6, -0.5],
];
/** The DJ table at the back, under the billboard. */
const BOOTH = new THREE.Vector3(-1.5, 0, -4.2);
/** The billboard above the parapet: a wall of bars that moves with the music. Its bars start at this height. */
const BOARD_Y = 4.3;
const BARS = 15;
const SPARKS = 30;
/** Radians a second for 100 beats a minute. */
const BEAT = (100 / 60) * Math.PI * 2;
const COLD_BULB = new THREE.Color('#8f9cc8');
const WARM_BULB = new THREE.Color(P.lamp);
const PARTY_BULBS = [P.lamp, P.neonPink, P.lamp, P.neonCyan, P.lamp, P.neonViolet].map((c) => new THREE.Color(c));

const put = <T extends THREE.Object3D>(root: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T => {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  root.add(obj);
  return obj;
};

/**
 * The framing leaves the middle of the screen to the banners (they cover a band across it): the sky, the lights
 * and the billboard sit above that band, the fire and the players below it.
 *
 * The party: a rooftop above the city. Everyone sits on beanbags around a fire bowl, with a DJ table, snacks,
 * strings of lights and a billboard of bars that moves with the music. The vibe lives in the world (how warm and bright the lights are, how high the fire burns, the
 * music's bars, who is dancing or sulking), and the night passes from 10 PM to sunrise behind the skyline.
 */
class PartyView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  vibe = 0.6;
  private readonly env: Env;
  private readonly set = new THREE.Group();
  private readonly tickSet: (dt: number, time: number) => void;
  private readonly framing = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  private readonly fit = new CameraFit(this.framing, 0.105);
  private readonly marks: Mark[] = [];
  private readonly owned: THREE.Material[] = [];
  // the vibe in the world
  private shown: number;
  private flare = 0;
  private flicker = 0;
  private readonly bulbs: THREE.MeshToonMaterial[] = [];
  private readonly bars: { mesh: THREE.Mesh; h: number }[] = [];
  private readonly cones: THREE.Object3D[] = [];
  private readonly fire: THREE.Group;
  private readonly flames: THREE.Object3D[] = [];
  private readonly fireLight: THREE.PointLight | null;
  private readonly boothLight: THREE.PointLight;
  private readonly lampBase: { light: THREE.PointLight; base: number }[] = [];
  private readonly sparks: THREE.Points;
  private readonly sparkLife = new Float32Array(SPARKS);
  private readonly sparkVel = new Float32Array(SPARKS * 3);
  private readonly seats: { pos: THREE.Vector3; yaw: number; doorYaw: number }[] = [];
  // the room vote
  private voting = 0;
  private wantVote = false;
  private readonly doormat: THREE.MeshBasicMaterial;
  private readonly door = new THREE.Vector3();
  // the hours
  private clock: number;
  private clockTarget: number;
  private lampDim = 1;
  private readonly sky: Record<string, THREE.IUniform> | null;
  private readonly hemi: THREE.HemisphereLight | null;
  private readonly ambient: THREE.AmbientLight | null;
  private readonly city: THREE.MeshBasicMaterial[] = [];
  private readonly tmp = Object.fromEntries(SKY_COLORS.map((c) => [c, new THREE.Color()])) as Record<SkyColor, THREE.Color>;
  private gradeNow: Grade = GRADES.night;

  constructor(
    private readonly companions: Companion[],
    colors: string[],
    hour = 0,
    vibe = 0.6,
  ) {
    this.vibe = vibe;
    this.shown = vibe;
    this.clock = this.clockTarget = clamp01(hour / HOURS.length);
    const env = rooftop(this.scene, { mood: 'night', w: 14, d: 10, sign: 'good vibes', lounge: true, seed: 2 });
    this.env = env;
    this.scene.add(this.set);
    const set = this.set;

    // What the hours change: the sky dome, the lights, the fog and the far towers.
    const dome = this.scene.getObjectByName('sky') as THREE.Mesh | undefined;
    this.sky = (dome?.material as THREE.ShaderMaterial | undefined)?.uniforms ?? null;
    this.hemi = (this.scene.children.find((o) => (o as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight | undefined) ?? null;
    this.ambient = (this.scene.children.find((o) => (o as THREE.AmbientLight).isAmbientLight) as THREE.AmbientLight | undefined) ?? null;
    env.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && o.parent?.name === 'skyline') this.city.push(m.material as THREE.MeshBasicMaterial);
    });
    for (const light of env.lamps) this.lampBase.push({ light, base: light.intensity });
    const doorLamp = env.root.getObjectByName('doorLamp');
    if (doorLamp) this.door.set(doorLamp.position.x, 0, doorLamp.position.z);

    // Every bulb on the strings listens to the vibe: the rooftop's own strings and the party's.
    // The party's strings hang high, from masts, so they cross the sky above everyone.
    const masts: [number, number, number][] = [
      [-6.7, 5.7, 3.0],
      [6.7, 5.7, 3.0],
      [5.4, 5.4, -3.6],
      [-6.2, 5.2, -4.2],
    ];
    for (const [x, y, z] of masts) part(set, cyl(0.035, 0.05, y, 8), P.charcoal, x, y / 2, z, { outline: false });
    const top = (i: number) => new THREE.Vector3(...(masts[i] as [number, number, number]));
    set.add(props.stringLights(top(3), top(1), { sag: 0.9, count: 24, bulb: 0.07 }));
    set.add(props.stringLights(top(0), top(2), { sag: 0.9, count: 24, bulb: 0.07 }));
    set.add(props.stringLights(top(0), top(1), { sag: 1.1, count: 22, bulb: 0.07 }));
    for (let i = 0; i < PARTY_BULBS.length; i++) {
      const m = toonMat({ color: P.lamp, emissive: new THREE.Color(P.lamp), emissiveIntensity: 2 });
      this.bulbs.push(m);
      this.owned.push(m);
    }
    let n = 0;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && o.parent?.name === 'stringLights' && m.geometry.type === 'SphereGeometry') m.material = this.bulbs[n++ % this.bulbs.length] as THREE.Material;
    });

    // The fire bowl, on a stone slab in the middle of a long rug.
    put(set, props.rug({ w: 10.6, d: 4.4, color: mix(P.plum, P.aubergine, 0.25), border: mix(P.clay, P.aubergine, 0.45) }), FIRE.x, 0, FIRE.z - 0.5);
    part(set, cyl(1.0, 1.05, 0.07, 28), P.stone, FIRE.x, 0.055, FIRE.z, { tex: 'stoneTiles', outline: false });
    part(set, cyl(0.66, 0.44, 0.3, 28), P.charcoal, FIRE.x, 0.24, FIRE.z, { tex: 'metalPlate', texStrength: 0.4, gloss: 0.3 });
    part(set, cyl(0.6, 0.6, 0.02, 28), P.espresso, FIRE.x, 0.385, FIRE.z, { outline: false, shadow: false });
    this.fire = put(set, props.campfire({ light: 13, r: 0.36 }), FIRE.x, 0.36, FIRE.z);
    this.fire.scale.setScalar(1.3);
    for (const o of this.fire.children) {
      const type = (o as THREE.Mesh).geometry?.type;
      if (type === 'IcosahedronGeometry') o.visible = false; // the bowl is the ring of stones
      else if (type === 'ConeGeometry') this.flames.push(o);
    }
    this.fireLight = (this.fire.userData.light as THREE.PointLight | undefined) ?? null;
    if (this.fireLight) this.fireLight.distance = 15;
    const dot = canvasTexture(32, 32, (ctx) => {
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
    });
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3).fill(-50), 3));
    const sparkMat = new THREE.PointsMaterial({ map: dot, color: new THREE.Color(P.ember).multiplyScalar(1.8), size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.owned.push(sparkMat);
    this.sparks = new THREE.Points(sparkGeo, sparkMat);
    this.sparks.frustumCulled = false;
    set.add(this.sparks);

    // Everyone on a beanbag either side of the fire, each with a little lantern in their colour.
    const slots = companions.length <= 2 ? [1, 2] : [0, 1, 2, 3];
    companions.forEach((c, i) => {
      const [dx, z, turn] = SEATS[slots[i % slots.length] as number] as (typeof SEATS)[number];
      const pos = new THREE.Vector3(FIRE.x + dx, 0.42, z);
      const seat = colors[i] ?? P.mauve;
      put(set, props.beanbag({ color: mix(seat, P.aubergine, 0.45), r: 0.6 }), pos.x, 0, pos.z - 0.12, turn, 1.25);
      const lx = pos.x - Math.sign(dx) * 0.2;
      const lz = pos.z + 1.0;
      part(set, cyl(0.075, 0.085, 0.03, 12), P.charcoal, lx, 0.035, lz, { outline: false });
      part(set, cyl(0.065, 0.065, 0.17, 12), seat, lx, 0.13, lz, { glow: 1.3, outline: false, shadow: false });
      part(set, cyl(0.08, 0.05, 0.035, 12), P.charcoal, lx, 0.235, lz, { outline: false });
      c.root.position.copy(pos);
      c.root.rotation.y = turn;
      this.scene.add(c.root);
      this.seats.push({ pos, yaw: turn, doorYaw: Math.atan2(this.door.x - pos.x, this.door.z - pos.z) });
    });
    // The frame: the row of players in the lower third, and a lot of sky.
    this.marks.push({ p: new THREE.Vector3(-4.3, 0, 1.6) }, { p: new THREE.Vector3(5.5, 0, 1.6) }, { p: new THREE.Vector3(FIRE.x, 0, FIRE.z + 1.3) }, { p: new THREE.Vector3(FIRE.x, 8.3, -5) });

    // The DJ table: two decks and speakers.
    const booth = put(set, new THREE.Group(), BOOTH.x, 0, BOOTH.z);
    booth.add(props.table({ w: 2.3, d: 0.8, h: 0.82, color: P.walnut }));
    part(booth, rbox(2.3, 0.72, 0.04, 0.01), P.aubergine, 0, 0.42, 0.39, { tex: 'fabric', outline: false });
    for (const s of [-1, 1]) put(booth, props.recordPlayer(), s * 0.62, 0.82, 0.02);
    part(booth, rbox(0.36, 0.07, 0.3, 0.015), P.charcoal, 0, 0.855, 0.04, { gloss: 0.3 });
    for (let i = 0; i < 3; i++) part(booth, cyl(0.018, 0.018, 0.02, 8), i === 1 ? P.neonPink : P.neonCyan, (i - 1) * 0.09, 0.9, 0.1, { glow: 1.6, outline: false, shadow: false });
    for (const s of [-1, 1]) {
      const sp = put(booth, props.speaker({ h: 1.0 }), s * 1.8, 0, 0.15, -s * 0.3, 1.4);
      if (sp.userData.cone) this.cones.push(sp.userData.cone as THREE.Object3D);
    }
    // Above it, the billboard: a rooftop sign turned into a wall of bars.
    const board = put(set, new THREE.Group(), BOOTH.x, 0, -4.95);
    for (const s of [-1, 1]) {
      part(board, cyl(0.06, 0.08, BOARD_Y, 8), P.charcoal, s * 1.75, BOARD_Y / 2, 0, { outline: false });
      part(board, cyl(0.03, 0.03, 2.7, 6), P.charcoal, s * 0.95, 3.1, 0, { rz: s * 0.62, outline: false });
    }
    part(board, box(3.5, 0.05, 0.05), P.charcoal, 0, 2.2, 0, { outline: false });
    part(board, rbox(4.4, 2.6, 0.14, 0.03), '#191423', 0, BOARD_Y + 1.05, 0, { outline: false });
    part(board, box(4.44, 0.05, 0.16), P.lamp, 0, BOARD_Y + 2.38, 0, { glow: 1.2, outline: false, shadow: false });
    const from = new THREE.Color(P.neonPink);
    const mid = new THREE.Color(P.neonViolet);
    const to = new THREE.Color(P.neonCyan);
    for (let i = 0; i < BARS; i++) {
      const k = i / (BARS - 1);
      const c = k < 0.5 ? from.clone().lerp(mid, k * 2) : mid.clone().lerp(to, k * 2 - 1);
      const mat = new THREE.MeshBasicMaterial({ color: c.multiplyScalar(1.45) });
      this.owned.push(mat);
      const mesh = part(board, box(0.19, 1, 0.03), '#ffffff', (i - (BARS - 1) / 2) * 0.27, BOARD_Y, 0.09, { material: mat, outline: false, shadow: false });
      this.bars.push({ mesh, h: 0.1 });
    }
    this.boothLight = new THREE.PointLight(P.neonPink, 0, 10, 1.6);
    this.boothLight.position.set(BOOTH.x, 1.7, BOOTH.z + 1.3);
    set.add(this.boothLight);

    // Snacks, drinks and somewhere to put them, behind the players.
    const snacks = put(set, new THREE.Group(), 2.3, 0, -1.9, -0.2);
    snacks.add(props.table({ w: 1.7, d: 0.85, h: 0.74, color: P.oak, cloth: P.cream }));
    put(snacks, props.pizzaBox({ open: true, slices: 5 }), -0.45, 0.75, 0.02, 0.3, 1.25);
    put(snacks, props.snackBowl({ fill: 'popcorn', color: P.terracotta, r: 0.19 }), 0.2, 0.75, -0.12);
    put(snacks, props.snackBowl({ fill: 'crisps', color: P.teal, r: 0.16, seed: 4 }), 0.55, 0.75, 0.2);
    put(snacks, props.drink({ kind: 'bottle', color: P.forest }), 0.08, 0.75, 0.25);
    put(snacks, props.drink({ kind: 'bottle', color: P.copper }), -0.05, 0.75, 0.3);
    put(snacks, props.drink({ color: P.rose }), 0.7, 0.75, -0.2);
    put(snacks, props.candle({ h: 0.16 }), -0.1, 0.75, -0.25);
    put(set, props.crate({ s: 0.55 }), 6.2, 0, 0.4, 0.3);
    put(set, props.pizzaBox(), 6.2, 0.55, 0.4, 0.5, 1.2);
    put(set, props.pouf({ color: P.mustard, r: 0.4 }), 6.1, 0, 2.6);
    put(set, props.logSeat({ len: 1.9, r: 0.24 }), -2.6, 0, -1.2, 0.25);
    put(set, props.crate({ s: 0.5 }), -5.7, 0, 0.3, 0.2);
    put(set, props.drink({ color: P.teal }), -5.8, 0.5, 0.3);
    put(set, props.drink({ kind: 'bottle', color: P.forest }), -5.6, 0.5, 0.4);
    put(set, props.candle(), -5.65, 0.5, 0.18);
    const guitar = put(set, props.guitar(), -3.4, 0, -2.2, 0.5);
    guitar.rotation.x = -0.18;
    // Foreground: soft, dark shapes in the bottom corners.
    const crate = put(set, props.crate({ s: 0.6 }), -5.9, 0, 5.2, 0.2);
    put(crate, props.plant({ kind: 'palm', h: 1.6, pot: P.charcoal, seed: 3 }), 0, 0.6, 0);
    put(set, props.beanbag({ color: P.denim, r: 0.6 }), -4.4, 0, 6.0, 0.6, 1.3);
    const crate2 = put(set, props.crate({ s: 0.6 }), 4.4, 0, 5.6, -0.3);
    put(crate2, props.plant({ kind: 'monstera', h: 1.2, pot: P.terracotta, seed: 8 }), 0, 0.6, 0);
    put(set, props.pouf({ color: P.rose, r: 0.42 }), 3.2, 0, 6.3);
    put(set, props.motes({ n: 20, area: [12, 2.2, 8], size: 0.05, seed: 5 }), 0, 0.8, 0);

    // The doorstep lights up while the room votes where to go next.
    this.doormat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(1.5), transparent: true, opacity: 0, depthWrite: false });
    this.owned.push(this.doormat);
    part(set, disc(0.8, 32), '#ffffff', this.door.x, 0.02, this.door.z + 0.75, { material: this.doormat, outline: false, shadow: false });

    this.tickSet = props.tickProps(set);
    this.applyTime();
    this.setVibe(vibe);
  }

  get grade(): GradeInput {
    return this.gradeNow;
  }

  setVibe(v: number): void {
    this.vibe = v;
    const mood = v > 0.6 ? 'happy' : v > 0.3 ? 'idle' : 'sad';
    for (const c of this.companions) c.setBase(mood);
  }

  /** A moment in the world: the lights flare, sparks fly and everyone cheers; or the lights stutter and they sulk. */
  cheer(good: boolean): void {
    for (const c of this.companions) c.react(good ? 'happy' : 'sad', 1.8);
    if (good) this.flare = 1;
    else this.flicker = 1;
  }

  /** The time of night: 0 is 10 PM, HOURS.length is sunrise. The sky follows slowly. */
  setHour(hour: number): void {
    this.clockTarget = clamp01(hour / HOURS.length);
  }

  /** While the room votes, everyone looks at the door and the doorstep glows. */
  setVoting(on: boolean): void {
    this.wantVote = on;
  }

  /** Sets the sky, the light and the grade for the time on the clock. */
  private applyTime(): void {
    const p = this.clock;
    let i = 0;
    while (i < SKY_KEYS.length - 2 && p > (SKY_KEYS[i + 1] as SkyKey).at) i++;
    const a = SKY_KEYS[i] as SkyKey;
    const b = SKY_KEYS[i + 1] as SkyKey;
    const t = clamp01((p - a.at) / (b.at - a.at));
    const ca = SKY_KEY_COLORS[i] as Record<SkyColor, THREE.Color>;
    const cb = SKY_KEY_COLORS[i + 1] as Record<SkyColor, THREE.Color>;
    const col = (k: SkyColor) => this.tmp[k].lerpColors(ca[k], cb[k], t);
    const num = (k: SkyNumber) => lerp(a[k], b[k], t);
    const from = a.from.map((v, j) => lerp(v, b.from[j] as number, t)) as [number, number, number];

    const u = this.sky;
    if (u) {
      (u.zenith?.value as THREE.Color).copy(col('zenith'));
      (u.horizon?.value as THREE.Color).copy(col('horizon'));
      (u.ground?.value as THREE.Color).copy(col('ground'));
      (u.cloudColor?.value as THREE.Color).copy(col('cloud'));
      if (u.stars) u.stars.value = num('stars');
      if (u.clouds) u.clouds.value = num('clouds');
      // The moon crosses the sky and sets; a little later the sun comes up behind the towers.
      const dir = u.sunDir?.value as THREE.Vector3;
      const disc = u.sunColor?.value as THREE.Color;
      if (p < 0.8) {
        const k = p / 0.8;
        dir.set(lerp(0.13, 0.66, k), lerp(0.105, 0.03, k), -1).normalize();
        disc.set(NIGHT.sun);
        if (u.moon) u.moon.value = 1;
        if (u.sunGlow) u.sunGlow.value = 0.9 * (1 - smooth(0.58, 0.78, p));
      } else {
        dir.set(0.34, lerp(-0.05, 0.075, (p - 0.8) / 0.2), -1).normalize();
        disc.copy(col('sun'));
        if (u.moon) u.moon.value = 0;
        if (u.sunGlow) u.sunGlow.value = smooth(0.82, 0.97, p);
      }
    }
    (this.scene.fog as THREE.Fog | null)?.color.copy(col('fog'));
    if (this.hemi) {
      this.hemi.color.copy(col('hemiSky'));
      this.hemi.groundColor.copy(col('hemiGround'));
      this.hemi.intensity = num('hemi');
    }
    if (this.ambient) {
      this.ambient.color.copy(col('ambient'));
      this.ambient.intensity = num('ambI');
    }
    const sun = this.env.sun;
    sun.color.copy(col('sun'));
    sun.intensity = num('sunI');
    sun.position.set(from[0] * 60, from[1] * 60, from[2] * 60);
    setLook(this.scene, { rimColor: col('rim'), rimStrength: num('rimS'), keyDir: from, keyColor: this.tmp.sun, outline: num('outline') });
    const city = col('city');
    for (const m of this.city) m.color.copy(city).multiplyScalar(1.25);
    this.lampDim = num('lamps');
    this.gradeNow = lerpGrade(a.grade, b.grade, t);
  }

  update(dt: number, time: number): void {
    // The camera: framed once around the party, then drifting a little.
    if (this.framing.aspect !== this.camera.aspect) this.framing.aspect = this.camera.aspect;
    this.fit.update(() => this.marks);
    this.voting += ((this.wantVote ? 1 : 0) - this.voting) * Math.min(1, dt * 2.5);
    this.camera.quaternion.copy(this.framing.quaternion);
    this.camera.position.copy(this.framing.position);
    this.camera.position.x += Math.sin(time * 0.11) * 0.3 - this.voting * 0.5;
    this.camera.position.y += Math.sin(time * 0.17) * 0.07;
    this.camera.position.z -= this.voting * 0.7;

    // The hours pass.
    if (this.clock !== this.clockTarget) {
      const step = dt * 0.085;
      this.clock = Math.abs(this.clockTarget - this.clock) <= step ? this.clockTarget : this.clock + Math.sign(this.clockTarget - this.clock) * step;
      this.applyTime();
    }

    this.env.update(dt, time);
    this.tickSet(dt, time);

    // The vibe, in everything that glows and moves.
    this.shown += (this.vibe - this.shown) * Math.min(1, dt * 1.6);
    this.flare = Math.max(0, this.flare - dt / 1.6);
    this.flicker = Math.max(0, this.flicker - dt / 1.1);
    const v = this.shown;
    const phase = time * BEAT;
    const pulse = Math.pow(0.5 + 0.5 * Math.cos(phase), 3);
    const stutter = this.flicker > 0 ? (Math.sin(time * 43) + Math.sin(time * 71) > 0.2 ? 0.12 : 0.85) : 1;
    const warm = smooth(0.08, 0.5, v);
    const festive = smooth(0.55, 0.95, v) * 0.85;
    this.bulbs.forEach((m, i) => {
      m.emissive.copy(COLD_BULB).lerp(WARM_BULB, warm).lerp(PARTY_BULBS[i] as THREE.Color, festive);
      m.color.copy(m.emissive);
      const twinkle = 1 + Math.sin(time * 1.7 + i * 2.1) * 0.08 + pulse * festive * 0.25 * (i % 2 ? 1 : -1);
      m.emissiveIntensity = ((0.22 + 2.3 * v) * twinkle + this.flare * 1.6) * stutter * (0.35 + 0.65 * this.lampDim);
    });
    for (const l of this.lampBase) l.light.intensity = l.base * (0.45 + 0.8 * v + this.flare * 0.5 + this.voting * 0.9) * stutter * this.lampDim;
    for (const f of this.flames) f.scale.multiplyScalar(0.4 + 0.95 * v + this.flare * 0.3);
    if (this.fireLight) this.fireLight.intensity *= (0.22 + 1.15 * v + this.flare * 0.6) * (0.5 + 0.5 * this.lampDim);
    this.boothLight.color.setHSL(0.86 + 0.1 * Math.sin(time * 0.31), 0.85, 0.62);
    this.boothLight.intensity = v * v * 11 * (0.65 + 0.35 * pulse) * stutter * this.lampDim;
    this.bars.forEach((b, i) => {
      const wave = 0.25 + 0.75 * Math.abs(Math.sin(time * (2.1 + (i % 5) * 0.43) + i * 1.7));
      const want = 0.06 + v * wave * (0.5 + 0.5 * pulse) * 1.3 * (this.flicker > 0 ? 0.15 : 1) + this.flare * 0.25;
      b.h += (want - b.h) * Math.min(1, dt * 14);
      const tall = Math.min(2.2, b.h * 1.6);
      b.mesh.scale.y = tall;
      b.mesh.position.y = BOARD_Y + tall / 2;
    });
    for (const c of this.cones) c.scale.setScalar(1 + pulse * 0.14 * v);
    this.doormat.opacity = this.voting * (0.3 + 0.2 * Math.sin(time * 5));

    // Sparks from the fire: more of them the better the party, and a burst on a good moment.
    const attr = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const born = (0.12 + 1.1 * v + this.flare * 7) * dt;
    for (let i = 0; i < SPARKS; i++) {
      let life = this.sparkLife[i] as number;
      if (life > 0) {
        life -= dt;
        const j = i * 3;
        attr.setXYZ(i, attr.getX(i) + (this.sparkVel[j] as number) * dt + Math.sin(time * 5 + i) * 0.004, attr.getY(i) + (this.sparkVel[j + 1] as number) * dt, attr.getZ(i) + (this.sparkVel[j + 2] as number) * dt);
        if (life <= 0) attr.setY(i, -50);
      } else if (Math.random() < born) {
        life = 0.9 + Math.random() * 1.3;
        attr.setXYZ(i, FIRE.x + (Math.random() - 0.5) * 0.4, 0.7 + Math.random() * 0.3, FIRE.z + (Math.random() - 0.5) * 0.4);
        this.sparkVel.set([(Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.9 + this.flare, (Math.random() - 0.5) * 0.5], i * 3);
      }
      this.sparkLife[i] = life;
    }
    attr.needsUpdate = true;

    // Everyone: nodding and swaying when the party is good, slumped when it isn't, looking at the door for a vote.
    const dance = smooth(0.5, 0.85, v);
    const slump = 1 - smooth(0.1, 0.35, v);
    this.companions.forEach((c, i) => {
      const seat = this.seats[i];
      if (seat) {
        c.root.position.y = seat.pos.y + dance * 0.1 * Math.abs(Math.sin(phase / 2 + i * 0.9)) - slump * 0.06;
        c.root.rotation.z = dance * 0.07 * Math.sin(phase / 2 + i * 1.3);
        c.root.rotation.x = slump * 0.12;
        c.root.rotation.y = lerp(seat.yaw, seat.doorYaw, this.voting * 0.8);
      }
      c.update(dt);
    });
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const m of this.owned) m.dispose();
    this.sparks.geometry.dispose();
  }
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    // Storage blocked: no record kept.
  }
}

/** How well the group did in a game, 0..1, from its co-op result or its co-op target. */
function groupScore(game: Minigame, result: MinigameResult): number {
  if (result.coop !== undefined) return Math.max(0, Math.min(1, result.coop));
  if (game.coopTarget) return Math.max(0, Math.min(1, result.scores.reduce((a, b) => a + b, 0) / game.coopTarget));
  return 0.5;
}

export async function runVibe(host: Host): Promise<void> {
  const { session, ui, stage, sfx, clock } = host.d;
  ui.mode('board');
  ui.hideHud();
  ui.prompts([
    { key: 'M', label: 'Mute' },
    { key: 'F', label: 'Full screen' },
  ]);
  const games = coopMinigames();
  let vibe = 0.6;
  let alive = true;
  const companions = await Promise.all(session.seats.map((s) => buildCompanion(s.look, { height: 1.7 })));
  const makeView = (hour: number) => {
    // Each minigame replaces the view, so the party scene is rebuilt (with fresh companions) to come back to.
    return Promise.all(session.seats.map((s) => buildCompanion(s.look, { height: 1.7 }))).then((cs) => new PartyView(cs, session.seats.map((s) => s.color), hour, vibe));
  };
  let view = new PartyView(companions, session.seats.map((s) => s.color), 0, vibe);
  stage.setView(view);
  const showMeter = (hour: number) =>
    ui.meter({ label: 'Vibe', value: vibe, sub: hour < HOURS.length ? `${HOURS[hour]} · ${HOURS.length - hour} hour${HOURS.length - hour === 1 ? '' : 's'} to sunrise` : 'Sunrise' });

  host.waitAll('The party is starting', 'Look at the big screen');
  showMeter(0);
  view.setVibe(vibe);
  await ui.banner("Don't Kill the Vibe", 'Keep the party going until sunrise. Play together to lift the vibe; every hour drains it a little.', 3.6);
  const rooms = shuffle(host.rng, ROOMS);
  let gameBag = shuffle(host.rng, games);

  for (let hour = 0; hour < HOURS.length && alive; hour++) {
    showMeter(hour);
    view.setHour(hour);
    ui.caption(`${HOURS[hour]}`);
    // Something happens.
    const ev = pick(host.rng, EVENTS);
    vibe = Math.max(0, Math.min(1, vibe + ev.vibe));
    view.setVibe(vibe);
    view.cheer(ev.vibe > 0);
    if (ev.vibe > 0) sfx.good();
    else sfx.bad();
    showMeter(hour);
    await ui.banner(ev.title, `${ev.text} ${ev.vibe > 0 ? '+' : '−'}${Math.round(Math.abs(ev.vibe) * 100)} vibe`, 3);
    if (vibe <= 0) {
      alive = false;
      break;
    }

    // Two rooms, two games: the group votes.
    if (games.length === 0) {
      await ui.banner('Quiet hour', 'No co-op games are installed yet, so everyone just chills.', 2.4);
    } else {
      if (gameBag.length < 2) gameBag = shuffle(host.rng, games);
      const choices = [gameBag.pop() as Minigame, (gameBag.pop() ?? games[0]) as Minigame];
      const roomA = rooms[(hour * 2) % rooms.length] as string;
      const roomB = rooms[(hour * 2 + 1) % rooms.length] as string;
      view.setVoting(true);
      const picked = await host.vote({
        title: 'Where does the party go next?',
        items: [
          { title: roomA, sub: choices[0]?.title, icon: '🚪' },
          { title: roomB, sub: choices[1]?.title, icon: '🚪' },
        ],
      });
      view.setVoting(false);
      const game = choices[picked] as Minigame;
      ui.meter(null);
      const { result } = await host.playMinigame(game);
      const score = groupScore(game, result);
      const gain = -0.08 + 0.32 * score;
      vibe = Math.max(0, Math.min(1, vibe + gain));
      view = await makeView(hour);
      stage.setView(view);
      view.setVibe(vibe);
      view.cheer(gain > 0);
      ui.mode('board');
      showMeter(hour);
      sfx.fanfare();
      await ui.banner(score >= 0.8 ? 'The room loved it' : score >= 0.5 ? 'Not bad at all' : 'That got a bit awkward', `${Math.round(score * 100)}% together · ${gain >= 0 ? '+' : '−'}${Math.round(Math.abs(gain) * 100)} vibe`, 2.8);
    }

    // The hour passes.
    vibe = Math.max(0, vibe - DRAIN);
    view.setVibe(vibe);
    view.setHour(hour + 1);
    showMeter(hour + 1);
    if (vibe <= 0) alive = false;
    await clock.wait(0.6);
  }

  if (alive) {
    // Let the sun come up before the results cover the view.
    ui.caption('Sunrise');
    await clock.wait(2.4);
  }
  ui.caption(null);
  const pct = Math.round(vibe * 100);
  const best = readBest();
  if (alive && pct > best) saveBest(pct);
  view.cheer(alive);
  if (alive) sfx.win();
  else sfx.bad();
  showMeter(HOURS.length);
  await host.finish({
    kicker: "Don't Kill the Vibe",
    title: alive ? `Sunrise! The party survived at ${pct}%` : 'The party fizzled out',
    rows: session.seats.map((s) => ({
      ...host.who(s.index),
      seat: s.index,
      place: 1,
      value: alive ? 'Made it to morning' : 'Went home early',
      text: alive ? `The vibe made it to morning at ${pct}%.` : 'Next time, maybe fewer phone calls.',
    })),
  });
  ui.meter(null);
  if (alive && pct > best) ui.toast(`New best night: ${pct}% vibe at sunrise`, '#2d2d2d', 5);
}
