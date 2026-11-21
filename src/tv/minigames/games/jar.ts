// Guess the Jar on the TV: a kitchen counter in the evening with a big glass jar turning slowly on it, packed with gummy
// bears (then cereal loops, then popcorn), the companions either side of it. Everyone types a guess on their phone.
// Then the lid comes off and the jar empties itself onto a baking tray in rows of ten, blocks of a hundred, so the
// whole room can count along. Every piece is one instance of a small shape, with its own outline.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type FillingId, JAR, type JarPlan, cpuGuess, guessPoints, jarScores, planJars } from '../../../game/minigames/jar';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { Floaters, type Mark, frameMarks, noise, tone } from '../kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cyl, material, mix, nameCard, part, popSprite, rbox, seeded, toonMat, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const TAU = Math.PI * 2;
const GLASS_R = JAR.radius + 0.07;
const GLASS_H = JAR.height + 0.45;
const BASE = 0.08; // the glass bottom; the pile starts on it
const COMP_H = 1.3;
const COMP_Z = -0.3;
const TRAY_Z = GLASS_R + 0.7; // the back edge of the tray
const TRAY_TOP = 0.08;
const FLY = 0.5; // seconds a piece is in the air
const GOLD = P.lamp;
const DRESS = 3.6; // the foundation's props, scaled up: the jar is taller than the companions

// Sweet-shop colours, a step calmer than the seat colours so the players' rings stay the brightest things.
const COLORS: Record<FillingId, readonly string[]> = {
  gummy: ['#e2574c', '#ee9a3e', '#efcd52', '#6fbf6a', '#f6ead2'],
  loops: ['#e8709c', '#efcd52', '#7fc76e', '#ee933f', '#9a7fd0', '#62b8d8'],
  popcorn: ['#fff6df', '#fbe7b0', '#fff1c9', '#f3d898'],
};

/** Scales a foundation prop, and the reach of the lamp inside it, to this scene's size. */
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

// ------------------------------------------------------------------ sounds

function plink(sfx: Sfx, row: number): void {
  tone(sfx, { freq: 520 * 2 ** ((row % 12) / 12), dur: 0.08, type: 'triangle', gain: 0.07 });
}

function rattle(sfx: Sfx): void {
  noise(sfx, { dur: 0.05, filter: 'bandpass', freq: 3200, gain: 0.06 });
}

// ------------------------------------------------------------------ pieces: one geometry per kind, instanced

function pieceGeometry(id: FillingId): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const flat = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    flat.deleteAttribute('uv');
    flat.applyMatrix4(m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
    parts.push(flat);
  };
  if (id === 'gummy') {
    add(new THREE.IcosahedronGeometry(0.085, 2), 0, -0.02, 0, 1, 1.15, 0.75);
    add(new THREE.IcosahedronGeometry(0.066, 2), 0, 0.105, 0, 1, 0.95, 0.8);
    for (const s of [-1, 1]) {
      add(new THREE.IcosahedronGeometry(0.028, 1), s * 0.048, 0.162, 0);
      add(new THREE.IcosahedronGeometry(0.032, 1), s * 0.078, 0.02, 0.012);
      add(new THREE.IcosahedronGeometry(0.036, 1), s * 0.05, -0.112, 0.012);
    }
  } else if (id === 'loops') {
    add(new THREE.TorusGeometry(0.075, 0.034, 8, 18), 0, 0, 0);
  } else {
    const lumps: [number, number, number, number][] = [
      [0, 0, 0, 0.085],
      [0.07, 0.03, 0.02, 0.064],
      [-0.06, 0.04, -0.02, 0.07],
      [0.01, -0.05, 0.06, 0.06],
      [-0.02, 0.07, 0.05, 0.055],
      [0.03, 0.02, -0.07, 0.06],
    ];
    for (const [x, y, z, r] of lumps) add(new THREE.IcosahedronGeometry(r, 1), x, y, z);
  }
  const merged = mergeGeometries(parts) as THREE.BufferGeometry;
  for (const p of parts) p.dispose();
  if (id === 'gummy') merged.scale(0.88, 0.88, 0.88);
  merged.computeBoundingSphere();
  return merged;
}

/** How a piece lies once it's on the tray, and how high its middle sits. */
function trayPose(id: FillingId, r: () => number): { q: THREE.Quaternion; y: number } {
  const e =
    id === 'gummy'
      ? new THREE.Euler(-Math.PI / 2 + 0.3, 0, (r() - 0.5) * 0.4)
      : id === 'loops'
        ? new THREE.Euler(Math.PI / 2 + (r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3)
        : new THREE.Euler((r() - 0.5) * 0.6, r() * TAU, (r() - 0.5) * 0.6);
  return { q: new THREE.Quaternion().setFromEuler(e), y: TRAY_TOP + (id === 'gummy' ? 0.07 : id === 'loops' ? 0.035 : 0.11) };
}

// The kit's outline hull, for instances: the same push along world normals, through each instance's matrix.
const OUTLINE_VERTEX = /* glsl */ `
uniform float thickness;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  #endif
  vec4 world = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  world.xyz += n * thickness;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
const OUTLINE_FRAGMENT = /* glsl */ `
uniform vec3 color;
void main() {
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

function hullGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const bare = new THREE.BufferGeometry();
  bare.setAttribute('position', g.getAttribute('position'));
  const h = mergeVertices(bare, 1e-4);
  h.computeVertexNormals();
  return h;
}

interface Bit {
  batch: number;
  slot: number;
  local: THREE.Matrix4;
  /** On the tray. */
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  /** Seconds into the pour when it hops out. */
  leaveAt: number;
  /** Set when it leaves the jar: where from, and the point its arc bends round. */
  from: THREE.Vector3 | null;
  via: THREE.Vector3;
  fromRot: THREE.Quaternion;
}

interface TrayLayout {
  spacing: number;
  blocks: number;
  width: number;
  depth: number;
  /** x of each block's middle. */
  blockX: number[];
}

function trayLayout(plan: JarPlan): TrayLayout {
  const spacing = plan.filling.spacing * 1.1;
  const blocks = Math.max(1, Math.ceil(plan.count / 100));
  const gap = spacing * 1.6;
  const bw = spacing * 10;
  const width = blocks * bw + (blocks - 1) * gap;
  const blockX = Array.from({ length: blocks }, (_, b) => -width / 2 + bw / 2 + b * (bw + gap));
  return { spacing, blocks, width, depth: spacing * 10, blockX };
}

/** The pieces of one jar: batches of instances by colour, each piece in the jar or on its way to the tray. */
class Contents {
  readonly bits: Bit[] = [];
  private readonly geo: THREE.BufferGeometry;
  private readonly hullGeo: THREE.BufferGeometry;
  /** One instanced mesh per colour (null: no pieces of that colour), and their outline hulls. */
  private readonly batches: (THREE.InstancedMesh | null)[] = [];
  private readonly hulls: THREE.InstancedMesh[] = [];
  private readonly hullMats: THREE.ShaderMaterial[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(
    scene: THREE.Scene,
    readonly plan: JarPlan,
    readonly tray: TrayLayout,
    pourTime: number,
  ) {
    const id = plan.filling.id;
    this.geo = pieceGeometry(id);
    this.hullGeo = hullGeometry(this.geo);
    const colors = COLORS[id];
    // Leave from the top of the pile down, so the jar empties the way a real one would.
    const order = plan.pieces.map((_, i) => i).sort((a, b) => (plan.pieces[b]?.y ?? 0) - (plan.pieces[a]?.y ?? 0));
    const rank = new Map(order.map((p, k) => [p, k] as const));
    const counts = colors.map(() => 0);
    const gap = pourTime / Math.max(1, plan.count);
    plan.pieces.forEach((p, i) => {
      const r = seeded(p.seed % 100000 + 1);
      const batch = Math.floor(r() * colors.length) % colors.length;
      const slot = counts[batch] ?? 0;
      counts[batch] = slot + 1;
      const local = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * TAU, r() * TAU, r() * TAU)), new THREE.Vector3(1, 1, 1));
      const k = rank.get(i) ?? i;
      const b = Math.floor(k / 100);
      const row = Math.floor((k % 100) / 10);
      const col = k % 10;
      const pose = trayPose(id, r);
      const pos = new THREE.Vector3((tray.blockX[b] ?? 0) - tray.spacing * 4.5 + col * tray.spacing, pose.y, TRAY_Z + 0.3 + tray.spacing * (row + 0.5));
      this.bits.push({ batch, slot, local, pos, rot: pose.q, leaveAt: k * gap, from: null, via: new THREE.Vector3(), fromRot: new THREE.Quaternion() });
    });
    colors.forEach((c, bi) => {
      const count = counts[bi] ?? 0;
      if (count === 0) {
        this.batches.push(null);
        return;
      }
      const mesh = new THREE.InstancedMesh(this.geo, material(c, id === 'gummy' ? { glow: 0.12 } : {}), count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const outline = new THREE.ShaderMaterial({
        name: 'outline',
        uniforms: { color: { value: new THREE.Color(c).multiplyScalar(0.62) }, thickness: { value: 0.014 } },
        vertexShader: OUTLINE_VERTEX,
        fragmentShader: OUTLINE_FRAGMENT,
        side: THREE.BackSide,
      });
      this.hullMats.push(outline);
      const hull = new THREE.InstancedMesh(this.hullGeo, outline, count);
      hull.instanceMatrix = mesh.instanceMatrix;
      hull.frustumCulled = false;
      hull.castShadow = false;
      scene.add(mesh, hull);
      this.batches.push(mesh);
      this.hulls.push(hull);
    });
  }

  /**
   * Places every piece: in the jar (through `jarSpace`), in the air, or on the tray. `pour` is seconds since the
   * pour began (null: not yet); `mouth` is where pieces hop out. Returns how many have landed.
   */
  place(jarSpace: THREE.Matrix4, pour: number | null, mouth: THREE.Vector3, shrink = 1): number {
    let landed = 0;
    for (const b of this.bits) {
      const since = pour === null ? -1 : pour - b.leaveAt;
      if (since < 0) {
        this.m.multiplyMatrices(jarSpace, b.local);
      } else if (since < FLY) {
        if (!b.from) {
          // Up out of the jar from where it lay, over the rim and down onto its spot.
          this.m.multiplyMatrices(jarSpace, b.local).decompose(this.v, b.fromRot, this.s);
          b.from = this.v.clone();
          b.via = new THREE.Vector3(mouth.x + (b.pos.x - mouth.x) * 0.3, mouth.y + 1.4, mouth.z + (b.pos.z - mouth.z) * 0.3);
        }
        const k = since / FLY;
        const a = (1 - k) * (1 - k);
        const c = 2 * k * (1 - k);
        this.v.copy(b.from).multiplyScalar(a).addScaledVector(b.via, c).addScaledVector(b.pos, k * k);
        this.q.slerpQuaternions(b.fromRot, b.rot, ease.outCubic(k));
        this.m.compose(this.v, this.q, this.s.set(1, 1, 1));
      } else {
        landed++;
        const sc = Math.max(0.0001, shrink);
        this.m.compose(b.pos, b.rot, this.s.set(sc, sc, sc));
      }
      this.batches[b.batch]?.setMatrixAt(b.slot, this.m);
    }
    for (const mesh of this.batches) if (mesh) mesh.instanceMatrix.needsUpdate = true; // the hulls share it
    return landed;
  }

  dispose(): void {
    for (const m of [...this.batches, ...this.hulls]) {
      if (!m) continue;
      m.removeFromParent();
      m.dispose();
    }
    for (const m of this.hullMats) m.dispose();
    this.geo.dispose();
    this.hullGeo.dispose();
  }
}

// ------------------------------------------------------------------ the kitchen

/** Companions either side of the jar, left to right. */
function companionXs(n: number): number[] {
  const left = Math.ceil(n / 2);
  const xs: number[] = [];
  for (let k = left - 1; k >= 0; k--) xs.push(-(GLASS_R + 1.0 + k * 1.6));
  for (let k = 0; k < n - left; k++) xs.push(GLASS_R + 1.0 + k * 1.6);
  return xs;
}

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

class Kitchen implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly people: Companion[];
  readonly floaters: Floaters;
  readonly jar = new THREE.Group();
  readonly lid = new THREE.Group();
  private readonly inside = new THREE.Group();
  readonly xs: number[];
  contents: Contents | null = null;
  /** Seconds since the pour began (null: not pouring). */
  pour: number | null = null;
  landed = 0;
  shrink = 1;
  /** 0: close on the jar, 1: the whole tray. */
  shot = 0;
  private tray = new THREE.Group();
  private readonly probe = new THREE.PerspectiveCamera();
  private shots: [Shot, Shot] | null = null;
  private shotKey = '';
  private readonly sprites: THREE.Sprite[] = [];
  private readonly mouth = new THREE.Vector3();
  private readonly glassGeo = new THREE.CylinderGeometry(GLASS_R, GLASS_R, GLASS_H, 44, 1, true);
  private readonly glassMat = toonMat({ color: '#dff3ff', transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide }, { gloss: 0.7 });
  private readonly dressing = new THREE.Group();
  private readonly tick: (dt: number, time: number) => void;
  private time = 0;

  constructor(seats: MinigameSeat[], people: Companion[]) {
    this.people = people;
    // Evening lamplight; the two pendant lamps over the worktop do the rest.
    lightRig(this.scene, 'lampInterior', { fog: { near: 40, far: 100 }, shadowSize: 13 });
    this.floaters = new Floaters(this.scene);
    this.xs = companionXs(seats.length);
    this.buildRoom();
    this.scene.add(this.dressing);
    this.tick = props.tickProps(this.dressing);
    this.buildJar();
    this.scene.add(this.tray);
    seats.forEach((s, i) => {
      const c = people[i];
      const x = this.xs[i] ?? 0;
      if (c) {
        c.root.position.set(x, 0, COMP_Z);
        c.root.rotation.y = -Math.sign(x) * 0.3;
        c.setBase('thinking');
        this.scene.add(c.root);
      }
      part(this.scene, torus(0.5, 0.045), s.color, x, 0.02, COMP_Z, { rx: Math.PI / 2, glow: 0.7, outline: false, shadow: false });
      const card = nameCard(s.name, s.color, 0.85);
      card.position.set(x, 0.18, COMP_Z + 0.85);
      this.scene.add(card);
    });
  }

  /** The worktop, the tiled wall behind it, and the kitchen's things around the edges. */
  private buildRoom(): void {
    const s = this.dressing;
    const flat = { outline: false as const, shadow: false as const };
    // A butcher-block worktop, deep green tiles up the wall, plaster above.
    part(s, box(44, 0.5, 13), mix(P.oak, P.walnut, 0.3), 0, -0.25, 2.5, { tex: 'wood', texScale: 3, gloss: 0.15, outline: false });
    part(s, box(44, 0.2, 0.34), P.walnut, 0, -0.12, 9.1, { tex: 'wood', outline: false });
    part(s, box(50, 4.6, 0.4), mix(P.forest, P.sage, 0.3), 0, 2.3, -3.6, { tex: 'kitchenTile', texScale: 5, gloss: 0.3, ...flat });
    part(s, box(50, 0.14, 0.5), P.walnut, 0, 4.66, -3.58, flat);
    part(s, box(50, 12, 0.4), '#8f8b80', 0, 10.7, -3.62, { tex: 'plaster', ...flat });
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, k = 1) => {
      sized(o, DRESS * k);
      o.position.set(x, y, z);
      o.rotation.y = ry;
      s.add(o);
      return o;
    };
    // On the wall: a window onto the dusk, a shelf of crockery; two pendant lamps over the worktop.
    put(props.windowFrame({ w: 1.25, h: 0.95, time: 'dusk', frame: P.cream, seed: 8 }), 5.4, 7.0, -3.38);
    put(props.wallShelf({ w: 1.5, items: 'kitchen', seed: 2 }), -5.2, 5.6, -3.38);
    put(props.wallShelf({ w: 1.2, items: 'kitchen', seed: 6 }), -5.6, 7.5, -3.38);
    for (const x of [-3.3, 3.3]) put(props.pendantLamp({ drop: 0.9, r: 0.25, shade: P.brass, lit: true, light: 1.6 }), x, 9.4, -1.5, 0, 0.9);
    // Along the back of the worktop, either side of the jar.
    put(props.pot({ color: P.copper }), 7.0, 0, -2.2, 0.4);
    put(props.jar({ color: P.mustard }), 5.2, 0, -2.6);
    put(props.jar({ color: P.terracotta, h: 0.2 }), 4.5, 0, -2.8);
    put(props.mug({ color: P.teal }), 8.6, 0, -1.2, 0.8);
    put(props.plant({ kind: 'fern', h: 0.42, pot: P.terracotta, seed: 3 }), -7.4, 0, -2.2);
    put(props.plates({ n: 5 }), -5.2, 0, -2.5);
    put(props.snackBowl({ fill: 'fruit', color: P.ceramic, seed: 2 }), -9.4, 0, -1.4, 0, 0.9);
    put(props.candle({ h: 0.09 }), -4.0, 0, -2.9, 0, 0.8);
    // A tea towel and a few things at the front corners, for when the camera pulls back over the tray.
    const towel = put(props.blanket({ w: 0.75, d: 0.5, color: P.terracotta, tex: 'gingham' }), -9.2, 0, 4.2, 0.3);
    towel.position.y = 0.005;
    put(props.mug({ color: P.rose }), -8.4, 0, 6.6, -0.4);
    put(props.jar({ color: P.olive, h: 0.14 }), 9.3, 0, 4.6);
    put(props.plates({ n: 2, r: 0.1 }), 9.0, 0, 7.0);
  }

  private buildJar(): void {
    const j = this.jar;
    part(j, cyl(GLASS_R, GLASS_R, BASE, 40), '#cfe9f5', 0, BASE / 2, 0, { opacity: 0.5, shadow: false, gloss: 0.6 });
    const glass = new THREE.Mesh(this.glassGeo, this.glassMat);
    glass.position.y = GLASS_H / 2;
    j.add(glass);
    part(j, torus(GLASS_R, 0.05), '#eaf7ff', 0, GLASS_H, 0, { rx: Math.PI / 2, opacity: 0.6, shadow: false });
    // Glints on the glass.
    part(j, rbox(0.09, GLASS_H * 0.7, 0.02, 0.02), '#ffffff', -GLASS_R * 0.6, GLASS_H * 0.5, GLASS_R * 0.8, { ry: -0.65, opacity: 0.5, shadow: false });
    part(j, rbox(0.05, GLASS_H * 0.3, 0.02, 0.02), '#ffffff', -GLASS_R * 0.38, GLASS_H * 0.62, GLASS_R * 0.93, { ry: -0.4, opacity: 0.4, shadow: false });
    this.inside.position.y = BASE;
    j.add(this.inside);
    // A screw-top lid with a cloth tied over it.
    part(this.lid, cyl(GLASS_R + 0.06, GLASS_R + 0.06, 0.26, 40), P.brass, 0, 0.13, 0, { gloss: 0.6 });
    for (const y of [0.06, 0.2]) part(this.lid, torus(GLASS_R + 0.06, 0.025), mix(P.brass, P.walnut, 0.4), 0, y, 0, { rx: Math.PI / 2, outline: false });
    part(this.lid, cyl(GLASS_R + 0.2, GLASS_R + 0.3, 0.08, 10), P.terracotta, 0, 0.3, 0, { ry: 0.3, tex: 'gingham', texScale: 0.9 });
    part(this.lid, torus(GLASS_R + 0.08, 0.04), P.cream, 0, 0.2, 0, { rx: Math.PI / 2 });
    part(this.lid, cyl(0.13, 0.16, 0.14, 14), P.walnut, 0, 0.41, 0, { tex: 'wood' });
    this.lid.position.set(0, GLASS_H - 0.05, 0);
    j.add(this.lid);
    this.scene.add(j);
  }

  /** A fresh jar for a new round, and the tray sized for it. */
  fill(plan: JarPlan): void {
    this.contents?.dispose();
    this.pour = null;
    this.landed = 0;
    this.shrink = 1;
    const layout = trayLayout(plan);
    this.contents = new Contents(this.scene, plan, layout, Math.min(2.2, plan.count * 0.026));
    // The tray: a baking sheet as wide as the blocks of a hundred.
    this.scene.remove(this.tray);
    this.tray = new THREE.Group();
    const w = layout.width + layout.spacing * 2;
    const d = layout.depth + 0.6;
    part(this.tray, rbox(w, 0.06, d, 0.03), P.stone, 0, 0.03, TRAY_Z + d / 2, { outline: false, tex: 'metalPlate', texStrength: 0.25, gloss: 0.35 });
    for (const side of [-1, 1]) {
      part(this.tray, rbox(w + 0.1, 0.12, 0.1, 0.04), mix(P.stone, P.metal, 0.35), 0, 0.06, TRAY_Z + d / 2 + (side * d) / 2, { gloss: 0.5 });
      part(this.tray, rbox(0.1, 0.12, d, 0.04), mix(P.stone, P.metal, 0.35), (side * (w + 0.05)) / 2, 0.06, TRAY_Z + d / 2, { gloss: 0.5 });
    }
    this.scene.add(this.tray);
    this.shotKey = '';
    this.place();
  }

  trayDepth(): number {
    return (this.contents?.tray.depth ?? 3) + 0.6;
  }

  /** A word or number floating over a spot (cleared with clearSprites). */
  sprite(text: string, color: string, at: THREE.Vector3, size = 0.5): THREE.Sprite {
    const s = popSprite(text, color, size);
    s.position.copy(at);
    this.scene.add(s);
    this.sprites.push(s);
    return s;
  }

  clearSprites(): void {
    for (const s of this.sprites) {
      s.removeFromParent();
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.sprites.length = 0;
  }

  overHead(i: number): THREE.Vector3 {
    return new THREE.Vector3(this.xs[i] ?? 0, COMP_H + 0.55, COMP_Z + 0.2);
  }

  /** Where each block's label goes, in front of the tray. */
  blockLabel(b: number): THREE.Vector3 {
    const t = this.contents?.tray;
    return new THREE.Vector3(t?.blockX[b] ?? 0, 0.35, TRAY_Z + this.trayDepth() + 0.35);
  }

  private marks(reveal: boolean): Mark[] {
    const out: Mark[] = [
      { p: new THREE.Vector3(-GLASS_R, 0, GLASS_R) },
      { p: new THREE.Vector3(GLASS_R, GLASS_H + 0.9, 0) },
      { p: new THREE.Vector3(-GLASS_R, GLASS_H + 0.9, 0) },
    ];
    for (const x of this.xs) out.push({ p: new THREE.Vector3(x - 0.45, COMP_H + 0.8, COMP_Z) }, { p: new THREE.Vector3(x + 0.45, 0.18, COMP_Z + 0.85), pad: 0.06 });
    if (reveal) {
      const w = (this.contents?.tray.width ?? 3) / 2 + 0.4;
      const z = TRAY_Z + this.trayDepth() + 0.4;
      out.push({ p: new THREE.Vector3(-w, 0, z), pad: 0.04 }, { p: new THREE.Vector3(w, 0, z), pad: 0.04 }, { p: new THREE.Vector3(-w, 0, TRAY_Z) }, { p: new THREE.Vector3(w, 0, TRAY_Z) });
    }
    return out;
  }

  private frame(): void {
    const key = `${this.camera.aspect.toFixed(3)}|${this.contents?.tray.width ?? 0}`;
    if (key !== this.shotKey || !this.shots) {
      this.shotKey = key;
      this.probe.fov = this.camera.fov;
      this.probe.aspect = this.camera.aspect;
      this.probe.updateProjectionMatrix();
      this.shots = [frameMarks(this.probe, this.marks(false), 0.36), frameMarks(this.probe, this.marks(true), 0.62)];
    }
    const [a, b] = this.shots;
    const k = ease.inOutSine(Math.min(1, Math.max(0, this.shot)));
    this.camera.position.lerpVectors(a.pos, b.pos, k);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(a.look, b.look, k));
  }

  private place(): void {
    if (!this.contents) return;
    this.jar.updateMatrixWorld(true);
    this.mouth.set(0, GLASS_H + 0.1, 0).applyMatrix4(this.jar.matrixWorld);
    this.landed = this.contents.place(this.inside.matrixWorld, this.pour, this.mouth, this.shrink);
  }

  dispose(): void {
    for (const c of this.people) c.dispose();
    this.contents?.dispose();
    this.contents = null;
    this.clearSprites();
    this.floaters.dispose();
    this.glassGeo.dispose();
    this.glassMat.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.tick(dt, time);
    this.frame();
    this.floaters.update(dt);
    for (const c of this.people) c.update(dt);
    this.inside.rotation.y = this.time * 0.32;
    if (this.pour === null) this.lid.rotation.y = this.time * 0.32;
    this.jar.rotation.z = this.pour !== null && this.landed < (this.contents?.plan.count ?? 0) ? Math.sin(this.time * 28) * 0.012 : 0;
    this.place();
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'jar',
  title: 'Guess the Jar',
  how: 'How many snacks are in the jar? Type your guess before the time runs out. Closest guess wins the round, and spot on gets a bonus. Three jars.',
  controller: 'number',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const skill = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : 0.5));
    const plans = planJars(rng);
    const view = new Kitchen(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: COMP_H }))));
    ctx.stage.setView(view);
    const points = seats.map(() => 0);
    const totalOff = seats.map(() => 0);
    const exact = seats.map(() => 0);
    let guesses: (number | null)[] = seats.map(() => null);
    let guessing = false;
    const live = () =>
      ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${points[i]} pts${guessing && guesses[i] !== null ? ' ✓' : ''}` })));
    live();

    const guessed = (seat: number, value: number) => {
      if (!guessing) return;
      const first = guesses[seat] === null;
      guesses[seat] = Math.round(Math.min(999, Math.max(1, value)));
      if (!first) return;
      tone(sfx, { freq: 880, dur: 0.08, gain: 0.06 });
      const c = view.people[seat];
      c?.setBase('approval');
      c?.react('happy', 0.8);
      view.floaters.add('Got it!', seats[seat]?.color ?? '#fff', view.overHead(seat), 0.4, 1.1);
      live();
    };
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'number' && seat < n && !session.isCpu(seat)) guessed(seat, msg.value);
    });

    for (let round = 0; round < plans.length; round++) {
      const plan = plans[round] as JarPlan;
      const { filling, count } = plan;
      view.fill(plan);
      view.shot = 0;
      guesses = seats.map(() => null);
      seats.forEach((_, i) => view.people[i]?.setBase('thinking'));
      session.setLayoutAll(() => ({ kind: 'number', note: `Jar ${round + 1} of ${plans.length}: how many ${filling.name}?`, min: 1, max: 999, unit: filling.unit }));
      ui.caption(`How many ${filling.name} are in the jar?`);
      const cpu = seats.map((_, i) => (session.isCpu(i) ? cpuGuess(rng, count, skill[i] ?? 0.5) : null));
      guessing = true;
      live();
      let endAt: number = JAR.answerTime;
      let lastTick = Math.ceil(endAt);
      await everyFrame(clock, (_, t) => {
        cpu.forEach((g, i) => {
          if (g && guesses[i] === null && t >= g.at) guessed(i, g.value);
        });
        if (guesses.every((g) => g !== null)) endAt = Math.min(endAt, t + JAR.grace);
        const left = endAt - t;
        ui.timer(left);
        if (left <= 3 && Math.ceil(left) < lastTick) {
          lastTick = Math.ceil(left);
          sfx.tick();
        }
        return t >= endAt;
      });
      guessing = false;
      ui.timer(null);
      live();
      session.setLayoutAll(() => ({ kind: 'wait', title: 'Let’s count!', text: 'Watch the big screen.' }));

      // The count: lid off, everything hops out onto the tray in rows of ten.
      ui.caption('Let’s count them…');
      sfx.whoosh();
      const lid = view.lid;
      const lidFrom = lid.position.clone();
      await Promise.all([
        clock.tween(0.8, (k) => (view.shot = k)),
        clock.tween(0.5, (k) => {
          lid.position.set(lidFrom.x, lidFrom.y + Math.sin(k * Math.PI) * 1.2 - (lidFrom.y - 1.25) * k, lidFrom.z - 2.3 * k); // leans on the wall behind
          lid.rotation.x = -1.1 * k;
        }),
      ]);
      seats.forEach((_, i) => view.people[i]?.setBase('listening'));
      view.pour = 0;
      let rows = 0;
      let hundreds = 0;
      let rattleAt = 0;
      let shown = -1;
      await everyFrame(clock, (dt) => {
        view.pour = (view.pour ?? 0) + dt;
        // A plink for every row of ten, a label for every block of a hundred.
        for (; rows < Math.floor(view.landed / 10); rows++) plink(sfx, rows);
        for (; hundreds < Math.floor(view.landed / 100); hundreds++) view.sprite(`${(hundreds + 1) * 100}`, '#ffffff', view.blockLabel(hundreds), 0.42);
        if ((view.pour ?? 0) - rattleAt > 0.07 && view.landed < count) {
          rattleAt = view.pour ?? 0;
          rattle(sfx);
        }
        if (view.landed !== shown) {
          shown = view.landed;
          ui.caption(`Counting… ${shown}`);
        }
        return view.landed >= count;
      });
      const lastBlock = Math.ceil(count / 100) - 1;
      if (count % 100 !== 0) view.sprite(`${count}`, GOLD, view.blockLabel(lastBlock), 0.5);
      sfx.good();
      view.sprite(`${count}!`, GOLD, new THREE.Vector3(0, GLASS_H + 0.55, 0.4), 0.9);
      ui.caption(`${count} ${filling.name}!`, GOLD);
      await clock.wait(0.5);

      // Everyone's guess over their head, then the points.
      const pts = guessPoints(guesses, count);
      guesses.forEach((g, i) => {
        const p = pts[i] ?? 0;
        const spotOn = g === count;
        view.sprite(g === null ? '–' : `${g}`, spotOn ? GOLD : p === JAR.points[0] ? '#ffffff' : P.linen, view.overHead(i).add(new THREE.Vector3(0, 0.25, 0)), 0.45);
      });
      tone(sfx, { freq: 660, dur: 0.12, gain: 0.1 });
      await clock.wait(0.8);
      const winners = seats.filter((_, i) => (pts[i] ?? 0) >= JAR.points[0]).map((s) => s.name);
      pts.forEach((p, i) => {
        const g = guesses[i] ?? null;
        points[i] = (points[i] ?? 0) + p;
        totalOff[i] = (totalOff[i] ?? 0) + (g === null ? 999 : Math.abs(g - count));
        const seat = seats[i] as MinigameSeat;
        const c = view.people[i];
        const at = view.overHead(i).add(new THREE.Vector3(0, 0.75, 0));
        if (g === count) {
          exact[i] = (exact[i] ?? 0) + 1;
          c?.setBase('happy');
          c?.react('happy', 2.5);
          view.floaters.add('Spot on!', GOLD, at.clone().add(new THREE.Vector3(0, 0.35, 0)), 0.55, 1.8);
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU;
            view.floaters.add('★', mix(GOLD, seat.color, (k % 2) * 0.5), at.clone().add(new THREE.Vector3(Math.cos(a) * 0.7, Math.sin(a) * 0.35, 0.1)), 0.32, 1.5);
          }
          sfx.win();
        } else if (p > 0) {
          if (p === JAR.points[0]) c?.react('happy', 1.8);
        } else c?.react('sad', 1.4);
        if (p > 0) view.floaters.add(`+${p}`, seat.color, at, 0.5, 1.4);
        session.setLayout(i, {
          kind: 'wait',
          title: g === count ? 'Spot on!' : p > 0 ? `+${p} point${p > 1 ? 's' : ''}` : 'No points this time',
          text: g === null ? `There were ${count}.` : `You guessed ${g}. There were ${count}.`,
        });
      });
      if (winners.length && !guesses.some((g) => g === count)) ui.caption(`${count} ${filling.name}! Closest: ${winners.join(' & ')}`, GOLD);
      live();
      await clock.wait(1.9);

      // Tidy up for the next jar.
      view.clearSprites();
      seats.forEach((_, i) => view.people[i]?.setBase('thinking'));
      if (round + 1 < plans.length) {
        await Promise.all([clock.tween(0.45, (k) => (view.shrink = 1 - k)), clock.tween(0.6, (k) => (view.shot = 1 - k))]);
        lid.position.copy(lidFrom);
        lid.rotation.x = 0;
      }
    }
    off();
    ui.timer(null);
    ui.caption(null);
    seats.forEach((_, i) => view.people[i]?.setBase('idle'));
    return {
      scores: jarScores(points, totalOff),
      details: points.map((p, i) => {
        const spot = exact[i] ?? 0;
        return `${p} pts${spot ? ` · ${spot} spot on` : ` · ${Math.round((totalOff[i] ?? 0) / plans.length)} off on average`}`;
      }),
    };
  },
};
