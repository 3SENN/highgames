// Where's the Remote? on the TV: a living room with the lights off and stuff all over the floor. Everyone stands
// on the sofa at the back with a torch (the phone, pointed at the TV), and the beams sweep the floor. Somewhere the
// end of the TV remote peeks out from under something; so do a chocolate bar, a phone case and the fan's remote.
// The darkness is a full-screen layer with a soft hole for every torch beam (and a glow round everyone on the sofa).
import * as THREE from 'three';
import {
  CONTENT_NAME,
  type Content,
  HUNT,
  type HuntCpu,
  type HuntRound,
  type Searcher,
  type Thing,
  type ThingKind,
  cpuHunt,
  huntScores,
  isDecoy,
  layRoom,
  liftProgress,
  litPeeks,
  newHuntCpu,
  newSearcher,
  planRound,
  roundPoints,
  startCheck,
  stepSearcher,
  toFloor,
} from '../../../game/minigames/remotehunt';
import { shuffle } from '../../../game/rng';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, lanes, noise, tone } from '../kit';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, cone, cyl, gem, lathe, mix, nameCard, part, pill, rbox, seeded, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const COUCH_Z = -4.75;
const SEAT_Y = 0.56;
const HEIGHT = 1.2;
const TILT = 0.88; // the camera looks down this much (radians)
const DARK = 0.9; // how dark the room gets (1 = pitch black)
const SPOTS = 10; // holes in the darkness: 4 torches, 4 people, the window, one spare
const STEP = 1 / 60;
const WIDE = 27; // the room, wall to wall
const ROOM = 1.9; // the furnished room's scale: the things on the floor are built big so they read from above

// ------------------------------------------------------------------ sounds

/** The light switch. */
function click(sfx: Sfx): void {
  noise(sfx, { dur: 0.04, filter: 'highpass', freq: 3000, gain: 0.25 });
  tone(sfx, { freq: 140, to: 90, dur: 0.08, type: 'triangle', gain: 0.1 });
}

/** Something being lifted: a soft rustle. */
function rustle(sfx: Sfx): void {
  noise(sfx, { dur: 0.28, filter: 'bandpass', freq: 900, to: 1500, gain: 0.18 });
}

/** The telly coming on. */
function bloop(sfx: Sfx): void {
  tone(sfx, { freq: 330, to: 660, dur: 0.18, gain: 0.14 });
  tone(sfx, { freq: 660, to: 990, dur: 0.22, gain: 0.12, delay: 0.14 });
}

/** A not-quite: "hm". */
function hmm(sfx: Sfx): void {
  tone(sfx, { freq: 260, to: 210, dur: 0.22, type: 'triangle', gain: 0.12 });
}

// ------------------------------------------------------------------ things on the floor

function buildThing(kind: ThingKind, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'cushion': {
      const c = mix(P.mustard, P.terracotta, 0.2);
      part(g, rbox(1.3, 0.36, 1.24, 0.17), c, 0, 0.18, 0, { tex: 'velvet', texStrength: 0.8 });
      for (const [x, z] of [
        [-0.6, -0.57],
        [0.6, -0.57],
        [-0.6, 0.57],
        [0.6, 0.57],
      ] as const) {
        part(g, sphere(0.085, 8), mix(c, P.ink, 0.25), x, 0.2, z, { outline: false });
      }
      part(g, rbox(0.9, 0.012, 0.86, 0.006), mix(c, P.cream, 0.25), 0, 0.362, 0, { outline: false, shadow: false, tex: 'velvet' });
      part(g, cyl(0.07, 0.07, 0.04, 12), mix(c, P.ink, 0.3), 0, 0.37, 0, { outline: false });
      break;
    }
    case 'pizza':
      part(g, rbox(1.45, 0.16, 1.45, 0.03), P.sand, 0, 0.08, 0, { tex: 'planks', texScale: 3, texStrength: 0.25 });
      part(g, rbox(1.32, 0.012, 0.04, 0.005), mix(P.sand, P.ink, 0.25), 0, 0.165, 0.5, { outline: false, shadow: false });
      part(g, cyl(0.36, 0.36, 0.02, 28), P.brick, 0, 0.17, -0.05, { outline: false, shadow: false });
      part(g, cyl(0.25, 0.25, 0.025, 28), P.cream, 0, 0.175, -0.05, { outline: false, shadow: false });
      part(g, cone(0.13, 0.17, 3), P.mustard, 0, 0.19, -0.05, { rx: -Math.PI / 2, sy: 0.3, outline: false, shadow: false });
      part(g, sphere(0.13, 10), mix(P.sand, P.walnut, 0.3), 0.42, 0.16, -0.4, { sy: 0.08, outline: false, shadow: false });
      break;
    case 'plant': {
      part(g, cyl(0.46, 0.36, 0.7, 22), P.terracotta, 0, 0.35, 0, { gloss: 0.2 });
      part(g, torus(0.46, 0.06), mix(P.terracotta, P.cream, 0.15), 0, 0.7, 0, { rx: Math.PI / 2 });
      part(g, cyl(0.42, 0.42, 0.04, 18), P.espresso, 0, 0.69, 0, { outline: false });
      const greens = [P.fern, P.moss, P.leaf, P.pine];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + rand() * 0.4;
        part(g, sphere(0.2, 10), greens[k % greens.length] as string, Math.cos(a) * 0.26, 1.02 + rand() * 0.15, Math.sin(a) * 0.26, { sx: 0.55, sy: 1.7, sz: 0.3, ry: -a + Math.PI / 2, rz: -Math.cos(a) * 0.7, rx: Math.sin(a) * 0.7 });
      }
      part(g, sphere(0.2, 12), P.fern, 0, 1.28, 0, { sy: 1.3 });
      break;
    }
    case 'hoodie': {
      const c = P.denim;
      const dark = mix(c, P.ink, 0.25);
      const knit = { tex: 'knit' as const, texScale: 0.9 };
      part(g, sphere(0.62, 18), c, 0, 0.2, 0, { ...knit, sx: 1.15, sy: 0.36, sz: 1.0 });
      part(g, sphere(0.34, 14), c, -0.38, 0.32, -0.28, { ...knit, sy: 0.62 });
      part(g, sphere(0.2, 12), dark, -0.38, 0.36, -0.06, { sy: 0.5, outline: false });
      part(g, pill(0.13, 0.62), c, 0.5, 0.14, 0.34, { ...knit, rz: Math.PI / 2, ry: -0.6 });
      part(g, pill(0.13, 0.5), c, -0.2, 0.14, 0.56, { ...knit, rz: Math.PI / 2, ry: 0.3 });
      part(g, rbox(0.5, 0.04, 0.26, 0.03), dark, 0.12, 0.38, 0.12, { ry: 0.2, outline: false });
      for (const x of [-0.18, -0.06]) part(g, cyl(0.015, 0.015, 0.36, 4), P.cream, x, 0.36, 0.12, { rx: Math.PI / 2.4, outline: false });
      break;
    }
    case 'catbed':
      part(g, cyl(0.62, 0.62, 0.16, 26), mix(P.mauve, P.ink, 0.15), 0, 0.08, 0, { tex: 'terry' });
      part(g, torus(0.58, 0.22), P.mauve, 0, 0.22, 0, { rx: Math.PI / 2, tex: 'terry' });
      part(g, cyl(0.42, 0.42, 0.06, 22), P.cream, 0, 0.2, 0, { outline: false, tex: 'terry' });
      // A toy mouse someone left in it.
      part(g, sphere(0.1, 10), P.stone, 0.12, 0.3, -0.05, { sz: 1.4 });
      for (const x of [0.06, 0.18]) part(g, sphere(0.04, 8), P.rose, x, 0.38, -0.13, { outline: false });
      break;
    case 'basket':
      part(g, cyl(0.62, 0.52, 0.8, 24), P.sand, 0, 0.4, 0, { tex: 'planks', texScale: 0.6 });
      for (const y of [0.22, 0.48, 0.74]) part(g, torus(0.6 - (0.8 - y) * 0.12, 0.035), P.oak, 0, y, 0, { rx: Math.PI / 2, outline: false });
      for (const [x, z, c] of [
        [-0.2, -0.1, P.rose],
        [0.18, 0.08, P.sage],
        [0.02, -0.25, P.cream],
      ] as const) {
        part(g, sphere(0.26, 12), c, x, 0.8, z, { sy: 0.6, tex: 'knit' });
      }
      part(g, pill(0.08, 0.5), P.sage, 0.55, 0.62, 0.2, { rz: 0.9, ry: 0.5 });
      break;
    case 'mags': {
      const covers = [P.terracotta, P.teal, P.mustard, P.mauve, P.denim];
      covers.forEach((c, k) => {
        part(g, rbox(1.0, 0.06, 0.78, 0.02), c, (rand() - 0.5) * 0.14, 0.03 + k * 0.065, (rand() - 0.5) * 0.14, { ry: (rand() - 0.5) * 0.6, gloss: 0.3 });
      });
      part(g, rbox(0.5, 0.01, 0.12, 0.005), P.cream, 0.1, 0.33, -0.2, { ry: 0.2, outline: false, shadow: false });
      part(g, rbox(0.4, 0.01, 0.3, 0.005), P.cream, 0.15, 0.33, 0.1, { ry: 0.2, outline: false, shadow: false });
      break;
    }
    case 'beanbag':
      part(g, sphere(0.85, 22), P.terracotta, 0, 0.44, 0, { sy: 0.55, tex: 'velvet', texStrength: 0.8 });
      part(g, sphere(0.5, 16), mix(P.terracotta, P.cream, 0.12), 0.08, 0.66, -0.16, { sy: 0.45, outline: false, tex: 'velvet', texStrength: 0.8 });
      part(g, sphere(0.07, 8), mix(P.terracotta, P.ink, 0.3), 0.08, 0.88, -0.16, { sy: 0.5, outline: false });
      break;
    case 'blanket': {
      const c = P.teal;
      const knit = { tex: 'knit' as const };
      part(g, rbox(1.6, 0.14, 1.4, 0.07), c, 0, 0.07, 0, { ry: 0.15, ...knit });
      part(g, pill(0.12, 1.2), mix(c, P.cream, 0.12), 0, 0.17, -0.3, { rz: Math.PI / 2, ry: 0.15, ...knit });
      part(g, pill(0.1, 0.9), mix(c, P.cream, 0.12), 0.15, 0.15, 0.3, { rz: Math.PI / 2, ry: 0.4, ...knit });
      for (const z of [-0.45, 0, 0.45]) part(g, rbox(1.5, 0.012, 0.05, 0.005), P.cream, 0, 0.145, z, { ry: 0.15, outline: false, shadow: false });
      break;
    }
    case 'bowl':
      part(g, lathe([[0, 0], [0.24, 0], [0.5, 0.38], [0.46, 0.38], [0.22, 0.06], [0, 0.06]], 28), P.denim, 0, 0, 0, { gloss: 0.5 });
      for (let k = 0; k < 12; k++) {
        const a = rand() * Math.PI * 2;
        const r = rand() * 0.32;
        part(g, sphere(0.085, 6), k % 3 ? P.cream : mix(P.cream, P.mustard, 0.4), Math.cos(a) * r, 0.34 + rand() * 0.1, Math.sin(a) * r, { outline: false });
      }
      break;
  }
  return g;
}

/** What hides under a thing, lying on the floor with its outer end along +z. */
function buildItem(c: Content): THREE.Group {
  const g = new THREE.Group();
  switch (c) {
    case 'remote':
      part(g, rbox(0.3, 0.1, 0.95, 0.045), P.charcoal, 0, 0.06, 0, { gloss: 0.3 });
      part(g, cyl(0.05, 0.05, 0.03, 12), '#ff4d4d', 0, 0.12, 0.36, { outline: false, glow: 0.8 });
      for (let r = 0; r < 3; r++) for (let k = -1; k <= 1; k++) part(g, cyl(0.026, 0.026, 0.025, 8), P.stone, k * 0.08, 0.115, 0.2 - r * 0.1, { outline: false, shadow: false });
      part(g, torus(0.065, 0.02), P.sage, 0, 0.115, -0.2, { rx: Math.PI / 2, outline: false, shadow: false });
      part(g, sphere(0.028, 8), '#ff6b6b', 0, 0.08, 0.48, { glow: 1.6, outline: false, shadow: false });
      break;
    case 'choc':
      part(g, rbox(0.32, 0.1, 0.92, 0.03), P.walnut, 0, 0.06, 0, { gloss: 0.3 });
      for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) part(g, rbox(0.12, 0.03, 0.12, 0.02), mix(P.walnut, P.wood, 0.3), -0.07 + k * 0.14, 0.115, 0.38 - r * 0.15, { outline: false, shadow: false });
      part(g, rbox(0.34, 0.12, 0.36, 0.03), P.brass, 0, 0.06, -0.3, { gloss: 0.6 });
      part(g, rbox(0.35, 0.125, 0.1, 0.02), P.brick, 0, 0.06, -0.14, { outline: false });
      break;
    case 'case':
      part(g, rbox(0.38, 0.08, 0.82, 0.08), P.slate, 0, 0.05, 0, { gloss: 0.3 });
      part(g, rbox(0.17, 0.03, 0.17, 0.05), mix(P.slate, P.ink, 0.3), -0.07, 0.1, 0.27, { outline: false });
      for (const z of [0.23, 0.31]) part(g, torus(0.03, 0.012), P.stone, -0.07, 0.12, z, { rx: Math.PI / 2, outline: false, shadow: false });
      part(g, cyl(0.06, 0.06, 0.01, 12), P.rose, 0.08, 0.095, -0.12, { outline: false, shadow: false });
      part(g, gem(0.05), P.mustard, -0.06, 0.1, -0.2, { sy: 0.3, outline: false, shadow: false });
      break;
    case 'fan':
      part(g, rbox(0.26, 0.09, 0.8, 0.04), P.ceramic, 0, 0.055, 0, { gloss: 0.3 });
      for (const z of [0.25, 0.1, -0.05]) part(g, cyl(0.035, 0.035, 0.025, 10), P.denim, 0, 0.105, z, { outline: false, shadow: false });
      part(g, rbox(0.16, 0.012, 0.12, 0.01), P.screen, 0, 0.104, -0.24, { outline: false, shadow: false });
      break;
    case 'sock':
      part(g, pill(0.11, 0.5), P.rose, 0, 0.1, 0, { rx: Math.PI / 2, tex: 'knit', texScale: 0.5 });
      part(g, sphere(0.13, 10), P.rose, 0.06, 0.1, -0.32, { tex: 'knit', texScale: 0.5 });
      for (const z of [0.05, 0.2]) part(g, torus(0.11, 0.02), P.cream, 0, 0.1, z, { outline: false, shadow: false });
      break;
    case 'crisps':
      part(g, rbox(0.5, 0.07, 0.55, 0.03), P.mustard, 0, 0.04, 0, { ry: 0.3, gloss: 0.4 });
      part(g, rbox(0.51, 0.075, 0.12, 0.02), P.brick, 0, 0.04, 0.05, { ry: 0.3, outline: false });
      break;
    case 'coins':
      for (const [x, z] of [
        [0, 0.1],
        [0.14, -0.08],
        [-0.12, -0.12],
      ] as const) {
        part(g, cyl(0.09, 0.09, 0.025, 16), P.brass, x, 0.02, z, { glow: 0.2, gloss: 0.7 });
      }
      break;
    case 'none':
      break;
  }
  return g;
}

/** A small torch for a companion's hand: points along +z. */
function torch(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.06, 0.06, 0.3, 12), color, 0, 0, 0, { rx: Math.PI / 2, exact: true, gloss: 0.4 });
  part(g, cyl(0.09, 0.065, 0.1, 14), P.charcoal, 0, 0, 0.18, { rx: Math.PI / 2, gloss: 0.5 });
  part(g, cyl(0.075, 0.075, 0.02, 14), P.lamp, 0, 0, 0.235, { rx: Math.PI / 2, glow: 2.2 });
  return g;
}

/** Scales a furnished room up to the game's size, lamps and shadows included. */
function scaleRoom(env: Env, k: number, shadow: number): void {
  env.root.scale.setScalar(k);
  for (const l of env.lamps) {
    l.intensity *= k ** 1.6;
    l.distance *= k;
  }
  const c = env.sun.shadow.camera;
  c.left = c.bottom = -shadow;
  c.right = c.top = shadow;
  c.updateProjectionMatrix();
}

// ------------------------------------------------------------------ the darkness

const DARK_VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
// Each spot: xy = centre (normalised screen), z = radius (in screen heights / 2), w = ring strength (0: a soft glow).
const DARK_FRAGMENT = /* glsl */ `
uniform vec4 uSpots[${SPOTS}];
uniform vec3 uTints[${SPOTS}];
uniform float uAspect;
uniform float uDark;
uniform vec3 uNight;
varying vec2 vP;
void main() {
  float dark = uDark;
  float warm = 0.0;
  float ringA = 0.0;
  vec3 ringC = vec3(0.0);
  for (int i = 0; i < ${SPOTS}; i++) {
    vec4 s = uSpots[i];
    if (s.z <= 0.0) continue;
    float r = length((vP - s.xy) * vec2(uAspect, 1.0)) / s.z;
    if (s.w > 0.0) {
      dark *= smoothstep(0.68, 1.0, r);
      warm = max(warm, (1.0 - smoothstep(0.5, 1.0, r)) * 0.1);
      float ring = (1.0 - smoothstep(0.0, 0.09, abs(r - 1.0))) * s.w;
      if (ring > ringA) {
        ringA = ring;
        ringC = uTints[i];
      }
    } else {
      dark *= mix(0.35, 1.0, smoothstep(0.25, 1.0, r));
    }
  }
  float a = dark;
  vec3 c = uNight;
  float wa = warm * (1.0 - a);
  c = mix(c, vec3(1.0, 0.86, 0.6), wa / max(a + wa, 0.0001));
  a = a + wa;
  c = mix(c, ringC, ringA / max(ringA + a * (1.0 - ringA), 0.0001));
  a = ringA + a * (1.0 - ringA);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------ the room

interface ThingView {
  thing: Thing;
  group: THREE.Group;
  /** How far up it is now (0..1) and how far it should be. */
  up: number;
  want: number;
  /** Held fully up until then (a reveal). */
  hold: number;
  item: THREE.Group | null;
}

interface Beam {
  on: boolean;
  x: number;
  z: number;
  ring: number;
  torch: THREE.Group;
  cone: THREE.Mesh;
}

class DarkRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  readonly things: ThingView[];
  readonly beams: Beam[] = [];
  /** How dark it is now, and how dark it should be. */
  dark = 0;
  darkWant = 0;
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly overlay: THREE.ShaderMaterial;
  private readonly veil: THREE.Mesh;
  private readonly spots = Array.from({ length: SPOTS }, () => new THREE.Vector4());
  private readonly tints = Array.from({ length: SPOTS }, () => new THREE.Color());
  private readonly cards: THREE.Sprite[] = [];
  private readonly moon = new THREE.Vector3(-0.2 * WIDE, 1.95 * ROOM, -6.2);
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  /** Lamps and bulbs: they go out with the lights. */
  private readonly lampGlows: { m: THREE.MeshToonMaterial; base: number }[] = [];
  private readonly lampLights: { l: THREE.PointLight; base: number }[] = [];
  private time = 0;
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  constructor(
    readonly seats: MinigameSeat[],
    readonly people: Companion[],
    things: Thing[],
  ) {
    // An evening living room (the darkness is a layer on top), built at 1 m scale and blown up.
    this.env = livingRoom(this.scene, { mood: 'evening', w: WIDE / ROOM, d: 12.6 / ROOM, h: 3.6, rug: false, lights: false, dress: 0.7, accent: P.mauve, wall: P.duskWall, seed: 4 });
    scaleRoom(this.env, ROOM, 11);
    this.env.sun.target.position.set(0, 0, -1);
    const set = new THREE.Group();
    withOutline(0.035, () => this.buildRoom(set));
    this.scene.add(set);
    this.tick = props.tickProps(set);
    for (const root of [this.env.root, set]) {
      root.traverse((o) => {
        const l = o as THREE.PointLight;
        if (l.isPointLight) this.lampLights.push({ l, base: l.intensity });
        if (!/Lamp$|^stringLights$/.test(o.name)) return;
        o.traverse((c) => {
          const m = c as THREE.Mesh;
          const mat = m.material as THREE.MeshToonMaterial | undefined;
          if (!m.isMesh || !mat || !(mat.emissiveIntensity > 0)) return;
          // Its own copy: the bulbs' materials are shared with other scenes.
          const own = mat.clone();
          m.material = own;
          this.lampGlows.push({ m: own, base: own.emissiveIntensity });
        });
      });
    }
    const rand = seeded(23);
    this.things = things.map((thing) => {
      const group = new THREE.Group();
      withOutline(0.03, () => group.add(buildThing(thing.kind, rand)));
      group.position.set(thing.x, 0, thing.z);
      group.rotation.y = (rand() - 0.5) * 0.8;
      this.scene.add(group);
      return { thing, group, up: 0, want: 0, hold: -1, item: null };
    });

    const xs = lanes(seats.length, 1.75);
    seats.forEach((s, i) => {
      const c = people[i];
      const x = xs[i] ?? 0;
      const t = torch(s.color);
      t.position.set(0.32, HEIGHT * 0.52, 0.28);
      if (c) {
        c.root.position.set(x, SEAT_Y, COUCH_Z + 0.1);
        c.setBase('thinking');
        c.root.add(t);
        this.scene.add(c.root);
      }
      const card = nameCard(s.name, s.color, 0.8);
      card.position.set(x, SEAT_Y + HEIGHT + 0.42, COUCH_Z + 0.1);
      this.cards.push(card);
      this.scene.add(card);
      const geo = new THREE.CylinderGeometry(0.06, 1, 1, 24, 1, true);
      geo.translate(0, -0.5, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: mix(s.color, P.lamp, 0.55),
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const beamCone = new THREE.Mesh(geo, mat);
      beamCone.renderOrder = 3;
      beamCone.frustumCulled = false;
      beamCone.visible = false;
      this.scene.add(beamCone);
      this.beams.push({ on: false, x, z: 0, ring: 1, torch: t, cone: beamCone });
      this.tints[i]?.set(s.color);
    });

    this.overlay = new THREE.ShaderMaterial({
      uniforms: {
        uSpots: { value: this.spots },
        uTints: { value: this.tints },
        uAspect: { value: 16 / 9 },
        uDark: { value: 0 },
        uNight: { value: new THREE.Color('#070818') },
      },
      vertexShader: DARK_VERTEX,
      fragmentShader: DARK_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.overlay);
    this.veil.frustumCulled = false;
    this.veil.renderOrder = 2; // after the room, before name cards and floating words
    this.scene.add(this.veil);
  }

  private buildRoom(s: THREE.Group): void {
    const put = <T extends THREE.Object3D>(o: T, x: number, z: number, ry = 0, k = ROOM, y = 0): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.multiplyScalar(k);
      s.add(o);
      return o;
    };
    // A big rug under the clutter.
    const rug = mix(P.mauve, P.aubergine, 0.42);
    put(props.rug({ w: 14.6, d: 7.8, color: rug, border: mix(rug, P.cream, 0.35), tex: 'terry' }), 0, 0, 0, 1);

    // The sofa at the back, a throw over one arm.
    const frame = P.denim;
    const fab = { tex: 'fabric' as const, texScale: 1.4 };
    part(s, rbox(7.8, 0.56, 1.5, 0.14), mix(frame, P.ink, 0.2), 0, 0.28, COUCH_Z, fab);
    part(s, rbox(7.8, 1.3, 0.5, 0.18), frame, 0, 0.95, COUCH_Z - 0.6, fab);
    for (const x of [-3.9, 3.9]) part(s, rbox(0.5, 0.95, 1.5, 0.2), frame, x, 0.55, COUCH_Z, fab);
    for (const x of [-2.55, 0, 2.55]) part(s, rbox(2.45, 0.2, 1.25, 0.1), mix(frame, P.cream, 0.1), x, 0.62, COUCH_Z + 0.05, { ...fab, outline: false });
    part(s, rbox(0.62, 0.5, 1.2, 0.12), P.mustard, 3.9, 0.82, COUCH_Z + 0.05, { tex: 'knit', outline: false });
    for (const x of [-2.1, 2.1]) for (const z of [-0.6, 0.6]) part(s, cyl(0.07, 0.05, 0.12, 8), P.walnut, x * 1.8, 0.03, COUCH_Z + z, { outline: false });

    // Lamps either side of it (the darkness takes them down with everything else), a side table with snacks.
    put(props.floorLamp({ light: 12 }), -6.4, -5.1);
    put(props.sideTable({ color: P.walnut }), 5.6, -5.0);
    put(props.tableLamp({ light: 9, stand: P.terracotta }), 5.6, -5.1, 0, ROOM, 0.5 * ROOM);
    put(props.mug({ color: P.teal }), 5.9, -4.6, 1, ROOM * 1.3, 0.5 * ROOM);

    // Round the rug's edges: plants, a pouf, a speaker, shoes, a guitar on the floor.
    put(props.plant({ kind: 'monstera', h: 1.1, pot: P.ceramic, seed: 5 }), -9.2, -4.4);
    put(props.pouf({ color: P.rose }), -9.4, 1.6, 0, ROOM * 1.2);
    put(props.speaker({ h: 0.9 }), 9.6, -4.8, -0.3);
    put(props.crate({ color: P.oak }), 9.4, 1.0, 0.3, ROOM);
    put(props.books(0.6, 3), 8.8, 1.0, 0.3, ROOM, 0.5 * ROOM);
    put(props.plant({ kind: 'snake', h: 0.8, pot: P.charcoal }), 9.9, 3.4);
    for (const dx of [0, 0.5]) part(s, pill(0.17, 0.4), P.sage, -8.6 + dx, 0.14, 4.4 + dx * 0.4, { rx: Math.PI / 2, ry: 0.5, tex: 'terry' });
    put(props.pouf({ color: P.forest, r: 0.5 }), 8.6, 5.6, 0, ROOM);
    put(props.snackBowl({ fill: 'crisps', color: P.terracotta }), -5.6, 5.0, 0, 2.6);
    put(props.drink({ color: P.mustard }), -4.6, 4.7, 0, 3);
    put(props.motes({ n: 20, area: [16, 3, 9], size: 0.07 }), 0, 0, 0, 1, 0.5);
  }

  /** Puts this round's secrets under the things. */
  setRound(plan: HuntRound): void {
    this.things.forEach((tv, i) => {
      if (tv.item) this.scene.remove(tv.item);
      tv.item = null;
      tv.up = 0;
      tv.want = 0;
      tv.hold = -1;
      const what = plan.under[i] ?? 'none';
      if (what === 'none') return;
      const item = withOutline(0.018, () => buildItem(what));
      const a = plan.angle[i] ?? 0;
      const d = tv.thing.r + (what === 'remote' || isDecoy(what) ? -0.05 : 0.05);
      item.position.set(tv.thing.x + Math.sin(a) * d, 0.01, tv.thing.z + Math.cos(a) * d);
      item.rotation.y = a;
      this.scene.add(item);
      tv.item = item;
    });
  }

  /** Holds a thing up for a moment (something was found under it, or the lights came on). */
  reveal(thing: number, seconds: number): void {
    const tv = this.things[thing];
    if (tv) tv.hold = this.time + seconds;
  }

  word(thing: number, text: string, color: string): void {
    const tv = this.things[thing];
    if (tv) this.floaters.add(text, color, new THREE.Vector3(tv.thing.x, 1.9, tv.thing.z), 0.42, 1.6);
  }

  hop(thing: number): void {
    const item = this.things[thing]?.item;
    if (!item) return;
    const y0 = 0.01;
    const start = this.time;
    item.userData.hop = (t: number) => {
      const k = (t - start) / 0.7;
      item.position.y = y0 + (k < 1 ? Math.sin(k * Math.PI) * 0.6 : 0);
      item.rotation.z = k < 1 ? Math.sin(k * Math.PI * 2) * 0.4 : 0;
      return k < 1;
    };
  }

  dispose(): void {
    for (const c of this.people) c.dispose();
    this.floaters.dispose();
    for (const card of this.cards) {
      card.material.map?.dispose();
      card.material.dispose();
    }
    for (const b of this.beams) {
      b.cone.geometry.dispose();
      (b.cone.material as THREE.Material).dispose();
    }
    this.overlay.dispose();
    for (const g of this.lampGlows) g.m.dispose();
    this.veil.geometry.dispose();
  }

  private marks(): Mark[] {
    const m: Mark[] = [];
    for (const x of [-HUNT.halfW, HUNT.halfW]) for (const z of [-HUNT.halfD, HUNT.halfD]) m.push({ p: new THREE.Vector3(x, 0, z), pad: 0.02 });
    for (const x of [-3.9, 3.9]) m.push({ p: new THREE.Vector3(x, SEAT_Y + HEIGHT + 0.45, COUCH_Z), pad: 0.06 });
    return m;
  }

  /** Projects a world point to normalised screen coordinates. */
  private screen(x: number, y: number, z: number): THREE.Vector3 {
    return this.v.set(x, y, z).project(this.camera);
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.fit.update(() => this.marks());
    this.camera.updateMatrixWorld();
    this.floaters.update(dt);
    this.env.update(dt, time);
    this.tick(dt, time);
    this.dark += (this.darkWant - this.dark) * Math.min(1, dt * 5);
    const aspect = this.camera.aspect;
    this.overlay.uniforms.uAspect!.value = aspect;
    this.overlay.uniforms.uDark!.value = this.dark;
    const lit = 1 - Math.min(1, this.dark / DARK);
    for (const g of this.lampGlows) g.m.emissiveIntensity = g.base * lit;
    for (const g of this.lampLights) g.l.intensity = g.base * lit;

    // Things wobble up when lifted.
    for (const tv of this.things) {
      const want = time < tv.hold ? 1 : tv.want;
      tv.up += (want - tv.up) * Math.min(1, dt * (want > tv.up ? 14 : 7));
      const k = tv.up;
      tv.group.position.y = k * 0.85;
      tv.group.rotation.z = Math.sin(time * 19 + tv.thing.x) * 0.1 * k * (1 - k * 0.6);
      tv.group.rotation.x = Math.sin(time * 15 + tv.thing.z) * 0.07 * k;
      const hop = tv.item?.userData.hop as ((t: number) => boolean) | undefined;
      if (hop && !hop(time) && tv.item) delete tv.item.userData.hop;
    }

    // People turn towards their beams; beams and the holes in the dark follow the pointers.
    this.spots.forEach((s) => s.set(0, 0, 0, 0));
    this.people.forEach((c, i) => {
      c.update(dt);
      const b = this.beams[i];
      if (!b) return;
      const turn = b.on ? THREE.MathUtils.clamp(Math.atan2(b.x - c.root.position.x, b.z - c.root.position.z), -1.1, 1.1) : 0;
      c.root.rotation.y += (turn - c.root.rotation.y) * Math.min(1, dt * 8);
      c.root.updateMatrixWorld(true);
      // A soft glow round everyone on the sofa.
      const mid = this.screen(c.root.position.x, SEAT_Y + HEIGHT * 0.55, c.root.position.z).clone();
      const top = this.screen(c.root.position.x, SEAT_Y + HEIGHT + 0.25, c.root.position.z);
      this.spots[4 + i]?.set(mid.x, mid.y, Math.max(0.05, (top.y - mid.y) * 1.35), 0);
    });
    this.beams.forEach((b, i) => {
      b.torch.visible = b.on;
      b.cone.visible = b.on;
      if (!b.on) return;
      const from = b.torch.getWorldPosition(this.w);
      const to = new THREE.Vector3(b.x, 0.05, b.z);
      const dir = to.clone().sub(from);
      const len = dir.length();
      b.cone.position.copy(from);
      b.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      b.cone.scale.set(HUNT.beam * 0.8, len, HUNT.beam * 0.8);
      const c = this.screen(b.x, 0.15, b.z).clone();
      const edge = this.screen(b.x + HUNT.beam, 0.15, b.z);
      this.spots[i]?.set(c.x, c.y, Math.abs(edge.x - c.x) * aspect, b.ring);
    });
    const m = this.screen(this.moon.x, this.moon.y, this.moon.z).clone();
    const mt = this.screen(this.moon.x, this.moon.y + 1.3, this.moon.z);
    this.spots[8]?.set(m.x, m.y, Math.max(0.05, mt.y - m.y), 0);
  }
}

// ------------------------------------------------------------------ the game

interface Press {
  seat: number;
  at: number;
}

export const minigame: Minigame = {
  id: 'remotehunt',
  title: "Where's the Remote?",
  how: 'Lights off, remote lost. Sweep your torch round the room, hold it on whatever might be hiding the remote and press Check to lift it. Careful: some things only look like it! First to find it scores most, three rounds.',
  controller: 'aim',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const things = layRoom(rng);
    const view = new DarkRoom(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), things);
    ctx.stage.setView(view);
    const skills: (number | undefined)[] = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : undefined));
    const skillOf = (i: number) => (skills[i] ??= ctx.skill());
    const points = seats.map(() => 0);
    const found = seats.map(() => 0);
    const totalTime = seats.map(() => 0);
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${points[i]} pts` })));
    live();

    // Pointers: the latest from each phone, smoothed on screen.
    const raw = seats.map(() => ({ x: 0, y: 0, fire: false }));
    const pos = seats.map((_, i) => ({ x: view.beams[i]?.x ?? 0, z: 0.8 }));
    const presses: Press[] = [];
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'aim' || seat >= n || session.isCpu(seat)) return;
      const r = raw[seat];
      if (!r) return;
      if (msg.fire && !r.fire) presses.push({ seat, at: clock.time - Math.min(0.25, (session.seats[seat]?.rtt ?? 0) / 2000) });
      r.x = msg.x;
      r.y = msg.y;
      r.fire = msg.fire;
    });

    const used: number[] = [];
    for (let round = 0; round < HUNT.rounds; round++) {
      const plan = planRound(rng, things, round, used);
      used.push(plan.remote);
      const searchers: Searcher[] = seats.map(() => newSearcher());
      const cpus: HuntCpu[] = seats.map(() => newHuntCpu(things.length, rng));
      cpus.forEach((c, i) => {
        c.x = pos[i]?.x ?? 0;
        c.z = pos[i]?.z ?? 0;
      });
      const shown: (Content | null)[] = things.map(() => null);
      const foundAt: (number | null)[] = seats.map(() => null);
      let order = 0;
      let firstAt: number | null = null;
      const enough = Math.min(n, HUNT.points.length);

      // Lights off.
      ui.caption(`Round ${round + 1} of ${HUNT.rounds}: lights off…`);
      session.setLayoutAll(() => ({ kind: 'wait', title: 'Lights off…', text: 'Get your torch ready.' }));
      await clock.wait(round === 0 ? 0.4 : 0.8);
      click(sfx);
      view.darkWant = DARK;
      await clock.wait(0.5);
      view.setRound(plan);
      presses.length = 0;
      seats.forEach((_, i) => {
        const b = view.beams[i];
        if (b) {
          b.on = true;
          b.ring = 1;
        }
        view.people[i]?.setBase('thinking');
      });
      session.setLayoutAll(() => ({ kind: 'aim', note: `Round ${round + 1}: hold your torch on something and press Check.`, button: 'Check' }));
      ui.caption('Find the remote! Hold your torch on something and press Check.');
      sfx.go();

      const check = (seat: number, at: number) => {
        const s = searchers[seat];
        const p = pos[seat];
        if (!s || !p) return;
        const r = startCheck(s, things, p.x, p.z, at);
        if (r === 'lift') rustle(sfx);
        else if (r === 'nothing' && !session.isCpu(seat)) session.send(seat, { t: 'feedback', good: false, text: 'Point at something first' });
      };

      let t = 0;
      let acc = 0;
      const roundStart = clock.time;
      await everyFrame(clock, (dt) => {
        // Humans' pointers, smoothed.
        const k = 1 - Math.exp(-dt * 18);
        seats.forEach((_, i) => {
          const p = pos[i];
          const r = raw[i];
          if (!p || !r || session.isCpu(i)) return;
          const f = toFloor(r.x, r.y);
          p.x += (f.x - p.x) * k;
          p.z += (f.z - p.z) * k;
        });
        for (const pr of presses.splice(0)) check(pr.seat, Math.max(t - 0.25, pr.at - roundStart));
        acc += dt;
        while (acc >= STEP) {
          acc -= STEP;
          t += STEP;
          const lit = litPeeks(
            seats.map((_, i) => (searchers[i]?.foundAt === null ? (pos[i] ?? { x: 99, z: 99 }) : { x: 99, z: 99 })),
            things,
            plan,
          );
          for (const i of shuffle(
            rng,
            seats.map((_, s) => s),
          )) {
            const s = searchers[i] as Searcher;
            const p = pos[i] as { x: number; z: number };
            if (session.isCpu(i)) {
              const out = cpuHunt(cpus[i] as HuntCpu, s, { things, plan, lit, shown }, t, STEP, skillOf(i), rng);
              p.x = out.x;
              p.z = out.z;
              if (out.press) check(i, t);
            } else {
              const c = cpus[i] as HuntCpu;
              c.x = p.x;
              c.z = p.z;
            }
            const ev = stepSearcher(s, things, plan, p.x, p.z, t);
            if (!ev) continue;
            if (ev.kind === 'found') {
              foundAt[i] = s.foundAt;
              shown[ev.thing] = 'remote';
              firstAt ??= t;
              order++;
              const pts = HUNT.points[order - 1] ?? 0;
              view.reveal(ev.thing, 0.9);
              view.hop(ev.thing);
              view.word(ev.thing, order === 1 ? 'Found it!' : `+${pts}`, seats[i]?.color ?? '#fff');
              bloop(sfx);
              sfx.good();
              const b = view.beams[i];
              if (b) b.on = false;
              view.people[i]?.setBase('happy');
              view.people[i]?.react('happy', 1.6);
              session.send(i, { t: 'feedback', good: true, text: 'Found it!' });
              session.send(i, { t: 'buzz', pattern: [20, 40, 20] });
              session.setLayout(i, { kind: 'wait', title: 'Found it!', text: pts ? `+${pts} · waiting for the others…` : 'Waiting for the others…' });
            } else if (ev.kind === 'wrong') {
              shown[ev.thing] = ev.content;
              view.reveal(ev.thing, 0.6);
              view.word(ev.thing, CONTENT_NAME[ev.content], isDecoy(ev.content) ? '#ffd166' : '#ffffff');
              if (isDecoy(ev.content)) hmm(sfx);
              else sfx.tick();
              view.people[i]?.react('sad', 1);
              if (!session.isCpu(i)) {
                session.send(i, { t: 'feedback', good: false, text: isDecoy(ev.content) ? `${CONTENT_NAME[ev.content]} Not the remote!` : `${CONTENT_NAME[ev.content]}. Keep looking!` });
                session.send(i, { t: 'buzz', pattern: [90] });
              }
            }
          }
        }
        // What the view shows: lifts in progress, beams, dimmed rings while someone waits.
        view.things.forEach((tv, j) => {
          tv.want = Math.max(0, ...searchers.map((s) => (s.lifting === j ? liftProgress(s, t) : 0)));
        });
        seats.forEach((_, i) => {
          const b = view.beams[i];
          const p = pos[i];
          const s = searchers[i];
          if (!b || !p || !s) return;
          b.x = p.x;
          b.z = p.z;
          b.ring = t < s.waitUntil ? 0.3 : 1;
        });
        ui.timer(HUNT.roundTime - t);
        return t >= HUNT.roundTime || order >= enough || (firstAt !== null && t >= firstAt + HUNT.grace);
      });
      ui.timer(null);

      // Lights on: where it was all along.
      const pts = roundPoints(foundAt);
      pts.forEach((p, i) => {
        points[i] = (points[i] ?? 0) + p;
        totalTime[i] = (totalTime[i] ?? 0) + (foundAt[i] ?? HUNT.roundTime + 2);
        if (foundAt[i] !== null) found[i] = (found[i] ?? 0) + 1;
      });
      session.setLayoutAll(() => ({ kind: 'wait', title: round + 1 < HUNT.rounds ? 'Lights on…' : 'Counting up…' }));
      view.beams.forEach((b) => (b.on = false));
      click(sfx);
      view.darkWant = 0;
      view.reveal(plan.remote, 2);
      view.hop(plan.remote);
      ui.caption(order ? 'There it was!' : 'It was there all along!');
      seats.forEach((_, i) => {
        if (foundAt[i] === null) view.people[i]?.setBase('sad');
      });
      live();
      await clock.wait(2.2);
    }
    off();
    ui.caption(null);
    seats.forEach((_, i) => view.people[i]?.setBase('idle'));
    return {
      scores: huntScores(points, totalTime),
      details: points.map((p, i) => `${p} pts · found it ${found[i]} of ${HUNT.rounds}`),
    };
  },
};
