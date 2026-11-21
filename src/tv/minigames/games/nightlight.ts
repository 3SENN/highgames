// Night Light on the TV: a dark bedroom seen from above, a friend fast asleep in the bed in the middle and the
// players keeping watch at the foot of it, each with a torch. Fuzzy dust bunnies with big shiny eyes creep out of
// the dark corners; every phone steers a pool of light across the floor, and holding Shine on a dust bunny makes it
// squeak and scurry home. Three hearts over the headboard: one goes every time the friend gets tickled.
import * as THREE from 'three';
import {
  type Beam,
  type Bunny,
  CORNERS,
  NIGHT,
  type Night,
  type TorchCpu,
  aimToFloor,
  cpuTorch,
  inDark,
  isOver,
  newNight,
  newTorchCpu,
  nightCoop,
  slept,
  stepNight,
} from '../../../game/minigames/nightlight';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, canvasTexture, cone, cyl, mix, part, pill, rbox, seeded, torus } from '../../render/toon';
import type { Sfx } from '../../audio';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, lanes, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const STEP = 1 / 60;
const HEIGHT = 1.25; // the players, standing guard on the end of the bed
const BED_TOP = 0.9; // the top of the duvet
const WATCH_Z = 1.5; // where they stand
const FLUFF = 1.4; // dust bunnies are drawn a little bigger than they count, so they read from the sofa
const HEARTS = new THREE.Vector3(0, 2.35, -2.3);
const HEAD = new THREE.Vector3(0, 1.0, -1.45);
const FLUFF_C = mix(P.mauve, P.linen, 0.45);
const QUIET = { outline: false as const };

/** A soft round blob of light (or dark) to lay on the floor. */
function blobTexture(inner: string, outer: string): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.55, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/** A heart: glowing pink while it lasts (`children[0]`), a small grey one once it's lost (`children[1]`). */
function heartModel(): THREE.Group {
  const g = new THREE.Group();
  const shape = (color: string, glow: number) => {
    const h = new THREE.Group();
    for (const x of [-0.11, 0.11]) part(h, ball(0.16, 2), color, x, 0.06, 0, glow ? { glow } : {});
    part(h, cone(0.235, 0.32, 18), color, 0, -0.14, 0, { rz: Math.PI, ...(glow ? { glow } : {}) });
    g.add(h);
    return h;
  };
  shape(P.neonPink, 1.15);
  const lost = shape(P.slate, 0);
  lost.scale.setScalar(0.7);
  lost.visible = false;
  return g;
}

/** Little bursts of soft glowing sparks (dust, glitter, embers). One draw call for all of them. */
class Sparks {
  private readonly max = 96;
  private readonly pos = new Float32Array(this.max * 3).fill(-999);
  private readonly col = new Float32Array(this.max * 3);
  private readonly vel = new Float32Array(this.max * 3);
  private readonly life = new Float32Array(this.max);
  private readonly tint: THREE.Color[] = Array.from({ length: this.max }, () => new THREE.Color());
  private readonly map = canvasTexture(64, 64, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  });
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private next = 0;

  constructor(scene: THREE.Scene, size = 0.16, private readonly gravity = 2.2) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: this.map, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** `n` sparks from `at`, flying outwards at about `speed` and upwards by `up` times that. */
  burst(at: THREE.Vector3, color: string, n = 10, speed = 1.4, up = 1): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const r = speed * (0.4 + Math.random() * 0.6);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([Math.cos(a) * r, (0.3 + Math.random()) * speed * up, Math.sin(a) * r], i * 3);
      this.life[i] = 0.6 + Math.random() * 0.5;
      (this.tint[i] as THREE.Color).set(color);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const l = this.life[i] as number;
      if (l <= 0) continue;
      const left = l - dt;
      this.life[i] = left;
      const j = i * 3;
      this.vel[j + 1] = (this.vel[j + 1] as number) - dt * this.gravity;
      for (let a = 0; a < 3; a++) this.pos[j + a] = (this.pos[j + a] as number) + (this.vel[j + a] as number) * dt;
      const t = this.tint[i] as THREE.Color;
      const f = Math.max(0, Math.min(1, left * 2.2));
      this.col.set([t.r * f, t.g * f, t.b * f], j);
      if (left <= 0) this.pos[j + 1] = -999;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.map.dispose();
  }
}

interface BunnyModel {
  root: THREE.Group;
  body: THREE.Group;
  eyes: THREE.Group;
  /** Which way it faces (radians). */
  facing: number;
  lastX: number;
  lastZ: number;
}

/** A dust bunny: a fuzzy grey puff with two tufty ears and big shiny eyes (facing +z). */
function bunnyModel(size: number, seed: number): BunnyModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const eyes = new THREE.Group();
  const rand = seeded(seed);
  const s = NIGHT.radius * size * FLUFF;
  part(body, ball(s, 2), FLUFF_C, 0, s, 0);
  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2;
    const up = rand() * 0.9 - 0.15;
    const r = Math.sqrt(1 - up * up);
    part(body, ball(s * (0.3 + rand() * 0.15), 1), rand() < 0.5 ? mix(FLUFF_C, P.cream, 0.3) : mix(FLUFF_C, P.ink, 0.2), Math.cos(a) * r * s * 0.9, s + up * s * 0.9, Math.sin(a) * r * s * 0.9, { outline: false });
  }
  for (const side of [-1, 1]) part(body, pill(s * 0.16, s * 0.45), mix(FLUFF_C, P.cream, 0.3), side * s * 0.4, s * 1.95, -s * 0.1, { rz: -side * 0.35, outline: false });
  for (const side of [-1, 1]) {
    part(eyes, ball(s * 0.36, 2), P.cream, side * s * 0.38, 0, 0, { glow: 0.7, outline: false });
    part(eyes, ball(s * 0.2, 1), P.ink, side * s * 0.38, -s * 0.02, s * 0.24, { outline: false });
    part(eyes, ball(s * 0.07, 0), '#ffffff', side * s * 0.38 + s * 0.07, s * 0.08, s * 0.4, { basic: true });
  }
  eyes.position.set(0, s * 1.15, s * 0.78);
  root.add(body, eyes);
  return { root, body, eyes, facing: 0, lastX: 0, lastZ: 0 };
}

interface Torch {
  spot: THREE.SpotLight;
  pool: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  tip: THREE.Vector3;
  x: number;
  z: number;
  on: boolean;
  glow: number;
}

interface Fx {
  t: number;
  life: number;
  step: (k: number) => void;
  done?: () => void;
}

class BedroomView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly crew: Companion[];
  readonly floaters: Floaters;
  private readonly fit = new CameraFit(this.camera, 0.98);
  private readonly marks: Mark[] = [];
  private readonly torches: Torch[] = [];
  private readonly bunnies = new Map<number, BunnyModel>();
  private readonly hearts: THREE.Group[] = [];
  private readonly duvet: THREE.Group;
  private readonly head: THREE.Group;
  private readonly lamp: THREE.PointLight;
  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly sparks: Sparks;
  private readonly tick: (dt: number, time: number) => void;
  private fx: Fx[] = [];
  private stir = 0;
  private zzzIn = 1;
  private awake = false;

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    this.crew = companions;
    this.floaters = new Floaters(this.scene);
    // Lights off: a cool moon through the window, and the little lamp by the bed.
    const rig = lightRig(this.scene, 'nightInterior', { fog: { near: 30, far: 70 }, shadowSize: 11 });
    rig.sun.intensity *= 1.15;
    this.sparks = new Sparks(this.scene, 0.2, 0.6);
    this.buildRoom();
    this.duvet = new THREE.Group();
    this.head = new THREE.Group();
    this.buildBed();
    this.tick = props.tickProps(this.scene);
    this.lamp = new THREE.PointLight(P.lamp, 3.2, 6.5, 1.4);
    this.lamp.position.set(-2.35, 1.35, -1.9);
    this.scene.add(this.lamp);

    // The dark corners: soft black blobs that the torches can't get into.
    const dark = blobTexture('rgba(5, 6, 16, 0.92)', 'rgba(5, 6, 16, 0)');
    const darkMat = new THREE.MeshBasicMaterial({ map: dark, transparent: true, depthWrite: false, toneMapped: false });
    const darkGeo = new THREE.PlaneGeometry(NIGHT.dark * 3.2, NIGHT.dark * 3.2);
    this.textures.push(dark);
    this.materials.push(darkMat);
    this.geometries.push(darkGeo);
    for (const c of CORNERS) {
      const blob = new THREE.Mesh(darkGeo, darkMat);
      blob.rotation.x = -Math.PI / 2;
      blob.position.set(c.x, 0.03, c.z);
      blob.renderOrder = 2;
      this.scene.add(blob);
    }

    // The watch: everyone at the foot of the bed, each with a torch.
    const xs = lanes(seats.length, 0.72);
    const pool = blobTexture('rgba(255, 255, 255, 0.55)', 'rgba(255, 255, 255, 0)');
    this.textures.push(pool);
    // Moonlight from the window, lying on the floor.
    const moonMat = new THREE.MeshBasicMaterial({ map: pool, color: P.moon, opacity: 0.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const moonGeo = new THREE.PlaneGeometry(5.2, 3.4);
    const moonPatch = new THREE.Mesh(moonGeo, moonMat);
    moonPatch.rotation.x = -Math.PI / 2;
    moonPatch.position.set(3.9, 0.035, -3.0);
    this.scene.add(moonPatch);
    this.materials.push(moonMat);
    this.geometries.push(moonGeo);
    seats.forEach((s, i) => {
      const x = xs[i] ?? 0;
      const c = companions[i];
      if (c) {
        c.root.position.set(x, BED_TOP - 0.06, WATCH_Z);
        c.setBase('listening');
        this.scene.add(c.root);
      }
      const tip = new THREE.Vector3(x + 0.18, BED_TOP + HEIGHT * 0.5, WATCH_Z + 0.32);
      part(this.scene, cyl(0.06, 0.05, 0.28, 10), P.charcoal, tip.x, tip.y, tip.z - 0.12, { rx: -0.6 });
      part(this.scene, cyl(0.07, 0.07, 0.03, 12), s.color, tip.x, tip.y + 0.06, tip.z - 0.02, { rx: -0.6, glow: 0.6, outline: false });
      const light = mix(s.color, '#ffffff', 0.6);
      const spot = new THREE.SpotLight(light, 0, 16, 0.2, 0.45, 1.2);
      this.scene.add(spot, spot.target);
      const poolMat = new THREE.MeshBasicMaterial({ map: pool, color: light, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const poolMesh = new THREE.Mesh(new THREE.PlaneGeometry(NIGHT.beam * 2.4, NIGHT.beam * 2.4), poolMat);
      poolMesh.rotation.x = -Math.PI / 2;
      poolMesh.renderOrder = 1;
      this.scene.add(poolMesh);
      const ringMat = new THREE.MeshBasicMaterial({ color: s.color, transparent: true, depthWrite: false, toneMapped: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(NIGHT.beam - 0.07, NIGHT.beam, 48), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 3;
      this.scene.add(ring);
      const beamGeo = new THREE.CylinderGeometry(0.05, 1, 1, 24, 1, true);
      beamGeo.translate(0, -0.5, 0);
      const beamMat = new THREE.MeshBasicMaterial({ color: light, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      this.scene.add(beam);
      this.materials.push(poolMat, ringMat, beamMat);
      this.geometries.push(poolMesh.geometry, ring.geometry, beamGeo);
      this.torches.push({ spot, pool: poolMesh, ring, beam, tip, x, z: 0, on: false, glow: 0 });
    });

    // The hearts over the headboard.
    for (let i = 0; i < NIGHT.hearts; i++) {
      const h = heartModel();
      h.position.set(HEARTS.x + (i - (NIGHT.hearts - 1) / 2) * 0.72, HEARTS.y, HEARTS.z);
      this.scene.add(h);
      this.hearts.push(h);
    }

    // The whole floor, the hearts and the watch stay on screen.
    this.marks.push(
      { p: new THREE.Vector3(-NIGHT.halfW - 0.3, 0, -NIGHT.halfD - 0.2) },
      { p: new THREE.Vector3(NIGHT.halfW + 0.3, 0, -NIGHT.halfD - 0.2) },
      { p: new THREE.Vector3(-NIGHT.halfW - 0.3, 0, NIGHT.halfD + 0.2) },
      { p: new THREE.Vector3(NIGHT.halfW + 0.3, 0, NIGHT.halfD + 0.2) },
      { p: HEARTS.clone().setY(HEARTS.y + 0.35), pad: 0.03 },
      { p: new THREE.Vector3(0, BED_TOP + HEIGHT + 0.2, WATCH_Z) },
    );
  }

  private buildRoom(): void {
    const s = this.scene;
    const W = NIGHT.halfW;
    const D = NIGHT.halfD;
    const back = -D - 0.4; // the back wall's face
    const wall = mix(P.denim, P.duskWall, 0.55);
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, sc = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc);
      s.add(o);
      return o;
    };
    // Floorboards that run on past the front, a papered back wall, and side walls that fill the frame.
    part(s, box(W * 2 + 1.4, 0.3, D * 2 + 14), mix(P.oak, P.walnut, 0.3), 0, -0.15, 6.4, { tex: 'woodFloor', outline: false, shadow: false });
    part(s, box(W * 2 + 1.4, 4.4, 0.3), wall, 0, 2.2, back - 0.15, { tex: 'plaster', ...QUIET });
    part(s, box(W * 2 + 0.8, 1.0, 0.03), mix(wall, P.ink, 0.25), 0, 0.5, back + 0.015, { tex: 'plaster', ...QUIET });
    part(s, box(W * 2 + 0.8, 0.06, 0.06), mix(P.cream, P.denim, 0.3), 0, 1.02, back + 0.03, QUIET);
    for (const side of [-1, 1]) {
      part(s, box(0.3, 14, D * 2 + 14), mix(wall, P.ink, 0.1), side * (W + 0.55), 7, 6.4, { tex: 'plaster', outline: false, shadow: false });
      part(s, box(0.04, 0.16, D * 2 + 14), mix(P.cream, P.denim, 0.3), side * (W + 0.38), 0.08, 6.4, QUIET);
    }
    // A big round rug under the bed.
    put(props.rug({ w: 7.0, color: P.mauve, border: mix(P.mauve, P.cream, 0.4), round: true, tex: 'knit' }), 0, 0, 0.2);
    // The window with the moon in it, its curtains, pictures and a string of fairy lights left on.
    put(props.windowFrame({ w: 2.6, h: 1.9, time: 'night', seed: 4 }), 3.6, 2.35, back + 0.01);
    put(props.curtains({ w: 2.6, h: 1.9, color: mix(P.mauve, P.denim, 0.3) }), 3.6, 2.35, back + 0.01);
    put(props.pictureFrame({ w: 0.9, h: 1.1, art: 'moon', frame: P.walnut, seed: 3 }), 0, 2.9, back + 0.01);
    put(props.pictureFrame({ w: 0.6, h: 0.5, art: 'hills', frame: P.brass, seed: 5 }), -1.3, 2.6, back + 0.01);
    put(props.pictureFrame({ w: 0.55, h: 0.7, art: 'leaf', frame: P.charcoal, seed: 8 }), 6.6, 2.5, back + 0.01);
    put(props.wallShelf({ w: 1.5, seed: 4 }), -7.1, 2.3, back + 0.01);
    for (let i = 0; i < 4; i++) {
      const x0 = -W + i * W * 0.5;
      s.add(props.stringLights(new THREE.Vector3(x0, 3.9, back + 0.08), new THREE.Vector3(x0 + W * 0.5, 3.9, back + 0.08), { sag: 0.3, count: 8, bulb: 0.04 }));
    }
    // The left wall is the one the camera sees most of: pictures, a shelf, a clock and more fairy lights.
    const lx = -W - 0.39;
    put(props.pictureFrame({ w: 1.1, h: 0.8, art: 'sunset', frame: P.walnut, seed: 2 }), lx, 2.5, -2.9, Math.PI / 2);
    put(props.pictureFrame({ w: 0.5, h: 0.65, art: 'shapes', frame: P.brass, seed: 7 }), lx, 2.2, -1.8, Math.PI / 2);
    put(props.wallClock({ color: P.brass }), lx, 2.7, 0, Math.PI / 2);
    put(props.wallShelf({ w: 1.6, seed: 9 }), lx, 2.1, 2.6, Math.PI / 2);
    put(props.pictureFrame({ w: 0.8, h: 1.0, art: 'leaf', frame: P.charcoal, seed: 4 }), lx, 2.6, 5.2, Math.PI / 2);
    for (let i = 0; i < 3; i++) s.add(props.stringLights(new THREE.Vector3(lx + 0.07, 3.9, -D + i * 4), new THREE.Vector3(lx + 0.07, 3.9, -D + 4 + i * 4), { sag: 0.3, count: 8, bulb: 0.04 }));
    // A wardrobe and a toy chest against the far wall.
    const wood = { tex: 'wood' as const };
    part(s, rbox(2.2, 3.0, 1.0, 0.05), P.mahogany, -4.6, 1.5, back + 0.5, wood);
    for (const x of [-0.53, 0.53]) part(s, rbox(0.96, 2.5, 0.04, 0.02), mix(P.mahogany, P.ink, 0.15), -4.6 + x, 1.6, back + 1.01, { ...wood, ...QUIET });
    for (const x of [-0.12, 0.12]) part(s, ball(0.05, 1), P.brass, -4.6 + x, 1.6, back + 1.05, { gloss: 0.7, ...QUIET });
    part(s, rbox(2.3, 0.1, 1.08, 0.03), mix(P.mahogany, P.ink, 0.25), -4.6, 3.03, back + 0.52, wood);
    part(s, rbox(1.6, 0.7, 0.9, 0.05), P.teal, 6.0, 0.35, back + 0.55, { tex: 'planks', texStrength: 0.6 });
    part(s, rbox(1.66, 0.12, 0.96, 0.04), mix(P.teal, P.ink, 0.2), 6.0, 0.75, back + 0.55, { tex: 'planks', texStrength: 0.6 });
    part(s, rbox(0.2, 0.14, 0.03, 0.01), P.brass, 6.0, 0.62, back + 1.01, { gloss: 0.7, ...QUIET });
    part(s, ball(0.2, 2), P.mustard, 5.75, 1.0, back + 0.55, { tex: 'knit' });
    part(s, ball(0.13, 1), P.cream, 6.25, 0.93, back + 0.65, QUIET);
    // The bedside table with the night light, a book and a glass of water.
    put(props.sideTable({ h: 0.78, r: 0.42, color: P.walnut }), -2.35, 0, -1.9);
    put(props.tableLamp({ lit: true, stand: P.brass, h: 0.5 }), -2.35, 0.78, -1.95);
    part(s, rbox(0.3, 0.05, 0.22, 0.01), P.terracotta, -2.2, 0.81, -1.62, { ry: 0.4 });
    put(props.sideTable({ h: 0.78, r: 0.42, color: P.walnut }), 2.35, 0, -1.9);
    put(props.mug({ color: P.ceramic }), 2.3, 0.78, -1.85, 0.8);
    put(props.plant({ kind: 'trailing', h: 0.3, pot: P.ceramic }), 2.5, 0.78, -2.05);
    // Furniture the dust bunnies live under, halfway along each side wall.
    put(props.sideboard({ w: 2.6 }), -W - 0.12, 0, 0, Math.PI / 2);
    put(props.books(0.7, 4), -W - 0.1, 0.72, 0.5, Math.PI / 2);
    put(props.vase({ color: P.ceramic, h: 0.4 }), -W - 0.1, 0.72, -0.7);
    put(props.bookshelf({ w: 2.2, h: 1.5, shelves: 3, seed: 6 }), W + 0.18, 0, 0, -Math.PI / 2);
    put(props.plant({ kind: 'fern', h: 0.45, pot: P.terracotta }), W + 0.1, 1.5, 0.5);
    // The corners: tall things at the back, low soft things in front, so the eyes in the dark still show.
    put(props.floorLamp({ lit: false, h: 1.8 }), -W + 0.1, 0, -D + 0.05);
    put(props.plant({ kind: 'ficus', h: 2.0, pot: P.ceramic, seed: 3 }), W - 0.1, 0, -D - 0.05);
    put(props.beanbag({ color: P.teal }), -W + 0.2, 0, D + 1.1, 0.5);
    put(props.pouf({ color: P.mustard }), W - 0.5, 0, D + 1.0);
    put(props.plant({ kind: 'monstera', h: 1.0, pot: P.charcoal, seed: 5 }), W + 0.05, 0, D + 0.9);
    // Left out on the floor in front: slippers, a book, building blocks.
    for (const dx of [0, 0.3]) part(s, rbox(0.2, 0.1, 0.42, 0.05), P.rose, -1.6 + dx, 0.05, D + 0.9, { ry: 0.2 + dx, tex: 'knit' });
    part(s, rbox(0.5, 0.06, 0.36, 0.01), P.denim, 3.4, 0.03, D + 1.0, { ry: -0.4 });
    [P.terracotta, P.mustard, P.sage].forEach((c, i) => part(s, rbox(0.22, 0.22, 0.22, 0.03), c, 5.1 + i * 0.3, 0.11 + (i === 1 ? 0.22 : 0), D + 0.9 + (i % 2) * 0.12, { ry: i * 0.5 }));
    put(props.motes({ n: 16, area: [W * 1.6, 2, D * 1.6], color: P.moon, size: 0.05 }), 0, 0.8, 0);
  }

  private buildBed(): void {
    const s = this.scene;
    const wood = { tex: 'wood' as const };
    part(s, rbox(NIGHT.bedW * 2 + 0.2, 0.42, NIGHT.bedD * 2 + 0.1, 0.06), P.walnut, 0, 0.21, 0, wood);
    part(s, rbox(NIGHT.bedW * 2 + 0.3, 1.5, 0.22, 0.08), P.walnut, 0, 0.75, -NIGHT.bedD - 0.05, wood);
    for (const x of [-0.85, 0, 0.85]) part(s, rbox(0.7, 0.9, 0.04, 0.02), mix(P.walnut, P.ink, 0.2), x, 0.95, -NIGHT.bedD + 0.07, { ...wood, ...QUIET });
    part(s, rbox(NIGHT.bedW * 2, 0.28, NIGHT.bedD * 2 - 0.1, 0.08), P.cream, 0, 0.56, 0, { tex: 'fabric', texStrength: 0.5 });
    part(s, rbox(1.7, 0.24, 0.75, 0.1), P.cream, 0, 0.8, -1.5, { tex: 'fabric', texStrength: 0.4 });
    // The duvet, with the friend curled up under it, and a folded throw at the foot.
    s.add(this.duvet);
    const quilt = { tex: 'knit' as const };
    part(this.duvet, rbox(NIGHT.bedW * 2 + 0.08, 0.16, 2.9, 0.07), P.denim, 0, 0.78, 0.55, quilt);
    part(this.duvet, ball(0.8, 2), P.denim, 0.05, 0.82, 0.15, { sx: 0.9, sy: 0.4, sz: 1.55, ...quilt });
    part(this.duvet, rbox(NIGHT.bedW * 2 + 0.1, 0.06, 0.35, 0.03), P.cream, 0, 0.85, -0.82, { tex: 'fabric', ...QUIET });
    part(s, rbox(NIGHT.bedW * 2 + 0.12, 0.05, 0.5, 0.02), P.mustard, 0, 0.865, 0.85, { tex: 'knit', ...QUIET });
    // Their sleepy head on the pillow, in a nightcap.
    this.head.position.copy(HEAD);
    s.add(this.head);
    part(this.head, ball(0.36, 2), P.clay, 0, 0.12, 0, { exact: true });
    for (const x of [-0.13, 0.13]) part(this.head, rbox(0.12, 0.025, 0.02, 0.01), P.ink, x, 0.13, 0.35, QUIET);
    for (const x of [-0.22, 0.22]) part(this.head, ball(0.06, 1), P.rose, x, 0.04, 0.27, { outline: false, opacity: 0.8 });
    part(this.head, cone(0.34, 0.75, 16), P.terracotta, 0.05, 0.42, -0.22, { rx: -1.1, rz: -0.25, tex: 'knit' });
    part(this.head, torus(0.33, 0.07), P.cream, 0, 0.3, -0.06, { rx: -1.1 + Math.PI / 2, outline: false });
    part(this.head, ball(0.1, 1), P.cream, 0.2, 0.62, -0.72);
  }

  /** Where torch `i` points and whether it's on. */
  setBeam(i: number, x: number, z: number, on: boolean): void {
    const t = this.torches[i];
    if (!t) return;
    t.x = x;
    t.z = z;
    t.on = on;
  }

  /** Brings the dust bunnies on screen in line with the night. */
  sync(night: Night, time: number, dt: number): void {
    for (const b of night.bunnies) {
      let m = this.bunnies.get(b.id);
      if (!m) {
        m = bunnyModel(b.size, b.id * 13 + 5);
        m.lastX = b.x;
        m.lastZ = b.z;
        m.facing = Math.atan2(-b.x, -b.z);
        this.bunnies.set(b.id, m);
        this.scene.add(m.root);
      }
      this.poseBunny(m, b, time, dt);
    }
  }

  private poseBunny(m: BunnyModel, b: Bunny, time: number, dt: number): void {
    const vx = b.x - m.lastX;
    const vz = b.z - m.lastZ;
    m.lastX = b.x;
    m.lastZ = b.z;
    const hiding = b.state === 'hide' || (b.state === 'creep' && inDark(b) && b.light === 0 && Math.hypot(b.x - b.hx, b.z - b.hz) < 0.3);
    m.body.visible = !hiding;
    if (Math.hypot(vx, vz) > 1e-4) {
      const want = Math.atan2(vx, vz);
      let d = want - m.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      m.facing += d * Math.min(1, dt * 10);
    } else if (hiding) {
      m.facing = Math.atan2(-b.hx, -b.hz);
    }
    const phase = time * (b.state === 'flee' ? 16 : 7) + b.phase;
    let y = 0;
    let shake = 0;
    if (b.state === 'flee') y = Math.abs(Math.sin(phase)) * 0.28;
    else if (b.lit) shake = 0.05;
    else if (!hiding) y = Math.abs(Math.sin(phase)) * 0.1;
    m.root.position.set(b.x + (shake ? Math.sin(time * 60) * shake : 0), y, b.z);
    m.root.rotation.y = m.facing;
    // Squinting in the light; blinking in the dark.
    const blink = Math.sin(time * 1.3 + b.phase * 3) > 0.97 ? 0.1 : 1;
    m.eyes.scale.set(1, b.lit ? 0.3 : hiding ? blink : 1, 1);
    m.eyes.position.y = NIGHT.radius * b.size * FLUFF * (hiding ? 0.9 : 1.15);
  }

  /** A dust bunny gets a fright: it jumps and squeaks. */
  scared(b: Bunny, color: string): void {
    this.floaters.add('Eep!', color, new THREE.Vector3(b.x, 1.0, b.z), 0.42, 0.9);
    this.sparks.burst(new THREE.Vector3(b.x, 0.4, b.z), color, 9, 1.5, 0.8);
    const m = this.bunnies.get(b.id);
    if (m) this.tween(0.3, (k) => m.body.scale.set(1 + Math.sin(k * Math.PI) * 0.22, 1 - Math.sin(k * Math.PI) * 0.3, 1 + Math.sin(k * Math.PI) * 0.22));
  }

  /** A dust bunny reached the bed: it hops up, tickles, and puffs away. One heart goes. */
  tickle(b: Bunny, heartsLeft: number): void {
    const m = this.bunnies.get(b.id);
    this.bunnies.delete(b.id);
    if (m) {
      const from = m.root.position.clone();
      const to = new THREE.Vector3(from.x * 0.6, BED_TOP, Math.min(from.z, 1.6) * 0.7);
      this.tween(0.7, (k) => {
        m.root.position.lerpVectors(from, to, k);
        m.root.position.y += Math.sin(k * Math.PI) * 0.9;
        m.root.scale.setScalar(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      }, () => {
        this.scene.remove(m.root);
        this.sparks.burst(to.clone().setY(BED_TOP + 0.3), FLUFF_C, 12, 1.2, 0.6);
      });
    }
    this.stir = 1.4;
    this.floaters.add('Hee hee!', P.rose, HEAD.clone().add(new THREE.Vector3(0.6, 0.9, 0.3)), 0.5, 1.3);
    const heart = this.hearts[heartsLeft];
    if (heart) {
      this.tween(0.8, (k) => {
        heart.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.4 - k * 0.45);
        heart.rotation.z = k * 0.6;
      }, () => {
        heart.scale.setScalar(1);
        heart.rotation.z = 0;
        const [full, lost] = heart.children;
        if (full) full.visible = false;
        if (lost) lost.visible = true;
      });
    }
  }

  /** The friend wakes up: sits up, eyes open. */
  wake(): void {
    this.awake = true;
    const from = this.head.position.clone();
    this.tween(0.6, (k) => {
      this.head.position.set(from.x, from.y + k * 0.45, from.z + k * 0.35);
      this.head.rotation.x = -k * 0.3;
    });
    this.floaters.add('Huh…?', '#ffffff', HEAD.clone().add(new THREE.Vector3(0, 1.3, 0.4)), 0.55, 2);
  }

  /** Everyone made it through: a last contented snore. */
  sleepTight(): void {
    this.floaters.add('z z z', '#cfd9ff', HEAD.clone().add(new THREE.Vector3(0.5, 0.9, 0)), 0.55, 2);
  }

  private tween(life: number, step: (k: number) => void, done?: () => void): void {
    this.fx.push({ t: 0, life, step, ...(done ? { done } : {}) });
  }

  dispose(): void {
    for (const c of this.crew) c.dispose();
    this.floaters.dispose();
    for (const t of this.textures) t.dispose();
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const t of this.torches) t.spot.dispose();
    this.sparks.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    for (const c of this.crew) c.update(dt);
    this.floaters.update(dt);
    this.sparks.update(dt);
    this.tick(dt, time);
    // Torches: a pool of light where each one points, a beam from the hand, a ring that always shows the aim.
    for (const t of this.torches) {
      t.glow += ((t.on ? 1 : 0) - t.glow) * Math.min(1, dt * 18);
      t.spot.intensity = 26 * t.glow;
      t.spot.position.set(t.x, 6, t.z + 2.2);
      t.spot.target.position.set(t.x, 0, t.z);
      t.pool.position.set(t.x, 0.02, t.z);
      t.pool.material.opacity = 0.15 + 0.85 * t.glow;
      t.pool.scale.setScalar(0.75 + 0.25 * t.glow);
      t.ring.position.set(t.x, 0.04, t.z);
      t.ring.material.opacity = 0.55 + 0.35 * Math.sin(time * 5);
      const to = new THREE.Vector3(t.x, 0.02, t.z);
      const dir = to.clone().sub(t.tip);
      const len = dir.length();
      t.beam.position.copy(t.tip);
      t.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      t.beam.scale.set(NIGHT.beam * 0.85, len, NIGHT.beam * 0.85);
      t.beam.material.opacity = 0.13 * t.glow;
    }
    // The friend: breathing, stirring when tickled, the odd z drifting up.
    this.stir = Math.max(0, this.stir - dt);
    const breathe = Math.sin(time * 1.7) * 0.03;
    this.duvet.scale.y = 1 + breathe;
    this.duvet.rotation.z = Math.sin(time * 14) * 0.03 * this.stir;
    if (!this.awake) this.head.rotation.z = Math.sin(time * 9) * 0.12 * this.stir + Math.sin(time * 0.8) * 0.04;
    this.zzzIn -= dt;
    if (this.zzzIn <= 0 && !this.awake) {
      this.zzzIn = 2.6;
      this.floaters.add('z', '#cfd9ff', HEAD.clone().add(new THREE.Vector3(0.45, 0.75, 0.1)), 0.32, 1.8);
    }
    this.hearts.forEach((h, i) => (h.position.y = HEARTS.y + Math.sin(time * 2 + i) * 0.05));
    this.lamp.intensity = 3.1 + Math.sin(time * 1.1) * 0.2;
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      f.step(k);
      if (k >= 1) f.done?.();
      return k < 1;
    });
  }
}

// ------------------------------------------------------------------ little sounds

function squeak(sfx: Sfx): void {
  const f = 1250 + Math.random() * 300;
  tone(sfx, { freq: f, to: f * 1.6, dur: 0.08, type: 'triangle', gain: 0.07 });
  tone(sfx, { freq: f * 1.3, to: f * 1.9, dur: 0.07, type: 'triangle', gain: 0.06, delay: 0.08 });
}

function rustle(sfx: Sfx): void {
  noise(sfx, { dur: 0.22, filter: 'highpass', freq: 2600, gain: 0.035 });
}

function giggle(sfx: Sfx): void {
  [620, 720, 660, 760].forEach((f, i) => tone(sfx, { freq: f, to: f * 0.9, dur: 0.08, type: 'sine', gain: 0.08, delay: i * 0.1 }));
  tone(sfx, { freq: 190, to: 150, dur: 0.45, type: 'sine', gain: 0.1, delay: 0.42 });
}

// ------------------------------------------------------------------ the minigame

const LINE = 'Shine your torch on the dust bunnies before they reach the bed!';

export const minigame: Minigame = {
  id: 'nightlight',
  title: 'Night Light',
  how: 'Your phone is a torch: point it at the screen and hold Shine on the dust bunnies creeping toward the bed, and they scurry back to their corners. Don’t let them tickle your sleeping friend awake!',
  controller: 'aim',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const night = newNight(rng, n);
    const skill = seats.map(() => ctx.skill());
    const cpus: TorchCpu[] = seats.map((_, i) => newTorchCpu(i, n));
    const view = new BedroomView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'aim', note: 'Point at a dust bunny and hold Shine', button: 'Shine' }));

    // Where each phone points (aim −1..1) and where its torch is drawn (smoothed, on the floor).
    const aim = seats.map(() => ({ x: 0, y: -0.2, fire: false }));
    const beams: Beam[] = seats.map((_, i) => ({ x: cpus[i]?.x ?? 0, z: cpus[i]?.z ?? 0, on: false }));
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'aim' || seat >= n || session.isCpu(seat)) return;
      const a = aim[seat];
      if (!a) return;
      a.x = msg.x;
      a.y = msg.y;
      a.fire = msg.fire;
    });

    let captionUntil = 0;
    let hudAt = -1;
    ui.caption(LINE);
    await everyFrame(clock, (dt) => {
      let left = Math.min(dt, 0.5);
      while (left > 1e-6 && !isOver(night)) {
        const step = Math.min(STEP, left);
        left -= step;
        // Humans: the torch follows the phone, smoothed a little. Computer players sweep to their target.
        const taken = new Set<number>();
        cpus.forEach((c, i) => {
          if (session.isCpu(i) && c.target !== null) taken.add(c.target);
        });
        seats.forEach((_, i) => {
          const b = beams[i] as Beam;
          if (session.isCpu(i)) {
            const mine = cpus[i] as TorchCpu;
            const others = new Set([...taken].filter((id) => id !== mine.target));
            const r = cpuTorch(mine, night, skill[i] ?? 0.5, rng, step, others);
            b.x = r.x;
            b.z = r.z;
            b.on = r.on;
          } else {
            const a = aim[i] as { x: number; y: number; fire: boolean };
            const p = aimToFloor(a.x, a.y);
            const k = Math.min(1, step * 16);
            b.x += (p.x - b.x) * k;
            b.z += (p.z - b.z) * k;
            b.on = a.fire;
            // Keep the computer's idea of this torch in step, in case the phone drops out.
            const c = cpus[i] as TorchCpu;
            c.x = b.x;
            c.z = b.z;
          }
        });
        const r = stepNight(night, step, beams, rng);
        if (r.spawned.length || r.back.length) rustle(sfx);
        for (const s of r.scared) {
          squeak(sfx);
          const who = s.by[0] ?? 0;
          view.scared(s.bunny, seats[who]?.color ?? '#ffffff');
          for (const i of s.by) {
            view.crew[i]?.react('happy', 0.8);
            if (!session.isCpu(i)) session.send(i, { t: 'feedback', good: true, text: s.by.length > 1 ? 'Shooed it together!' : 'Shooed one home!' });
          }
        }
        for (const b of r.tickled) {
          view.tickle(b, night.hearts);
          giggle(sfx);
          for (const c of view.crew) c.react('thinking', 1.2);
          for (const i of seats.keys()) session.send(i, { t: 'buzz', pattern: [60, 50, 60] });
          if (!r.woke) {
            ui.caption(`Hee hee! They stirred… ${night.hearts} heart${night.hearts === 1 ? '' : 's'} left.`, '#ffb3cf');
            captionUntil = night.time + 2.4;
          }
        }
        if (r.woke) {
          view.wake();
          sfx.bad();
        }
      }
      beams.forEach((b, i) => view.setBeam(i, b.x, b.z, b.on));
      view.sync(night, clock.time, dt);
      if (captionUntil && night.time > captionUntil) {
        captionUntil = 0;
        ui.caption(LINE);
      }
      if (night.time - hudAt > 0.2) {
        hudAt = night.time;
        ui.timer(NIGHT.duration - night.time);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${night.shooed[i] ?? 0} shooed` })));
      }
      return isOver(night);
    });
    off();
    ui.timer(null);
    const woke = night.wokeAt !== null;
    session.setLayoutAll(() => ({ kind: 'wait', title: woke ? 'They woke up!' : 'Sleep tight!', text: 'Watch the big screen' }));
    beams.forEach((_, i) => view.setBeam(i, beams[i]?.x ?? 0, beams[i]?.z ?? 0, false));
    if (woke) {
      for (const c of view.crew) c.setBase('sad');
      ui.caption(`Oh no, they woke up after ${slept(night).toFixed(1)} s. Back to sleep, everyone…`);
      await clock.wait(2.2);
    } else {
      view.sleepTight();
      for (const c of view.crew) c.setBase('happy');
      sfx.good();
      ui.caption(`Morning! They slept right through${night.hearts === NIGHT.hearts ? ', not a single tickle' : ''}.`);
      await clock.wait(2);
    }
    ui.caption(null);
    const coop = nightCoop(night);
    const score = Math.round(coop * 1000);
    return {
      scores: seats.map(() => score),
      details: seats.map((_, i) => {
        const k = night.shooed[i] ?? 0;
        return `Shooed ${k} dust bunn${k === 1 ? 'y' : 'ies'}`;
      }),
      coop,
    };
  },
};
