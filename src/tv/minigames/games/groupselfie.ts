// Group Selfie on the TV: a living room in the evening, everyone sunk into one big couch, and a little timer camera
// on the coffee table pointing at them. Each photo counts down 3-2-1 over the camera, flashes, and pops up as a
// polaroid: a real picture of the room from the camera's point of view, with a motion-blur trail on anyone who
// wobbled. Then it gets pegged on a string over the couch. Photobombers wander through now and then.
import * as THREE from 'three';
import {
  BOMBER_INFO,
  type Bomber,
  SELFIE,
  type Sample,
  type SelfieCpu,
  type Shot,
  type ShotPhase,
  countdownAt,
  cpuSelfieWobble,
  judgeShot,
  newSelfieCpu,
  phaseAt,
  planShoot,
  selfieCoop,
  shootLength,
  shotAt,
} from '../../../game/minigames/groupselfie';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ROUNDED_FONT, ball, box, canvasTexture, cone, cyl, mix, nameCard, part, pill, popSprite, rbox, toonMat } from '../../render/toon';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import type { View } from '../../stage';
import { CameraFit, type Mark, lanes, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const STEP = 1 / 60;
const HEIGHT = 1.25; // companion height
const SEAT_TOP = 0.52;
const SINK = 0.3; // how deep everyone sinks into the cushions
const COUCH_L = 4.6;
const SPACING = 1.1;
const TABLE = new THREE.Vector3(0, 0.55, 2.6); // the top of the coffee table
const DEVICE = new THREE.Vector3(0, 0.86, 2.75); // the timer camera on it
const LENS = new THREE.Vector3(0, 1.25, 4.6); // where its picture is taken from
const SILL = new THREE.Vector3(0.45, 1.66, -1.4); // the window sill behind the couch
const STRING_Y = 3.75; // the photo string over the couch
const WALL_Z = -1.7;
const SNAP = 512; // photo resolution
const PASSES = 6; // renders blended into one photo, for the motion blur

/** Where photo `i` hangs on the string. */
function pegAt(i: number): THREE.Vector3 {
  return new THREE.Vector3(-3.1 + i * 1.24, STRING_Y - 0.62, WALL_Z + 0.12);
}

const QUIET = { outline: false as const };

function catModel(): THREE.Group {
  const g = new THREE.Group();
  const fur = mix(P.copper, P.mustard, 0.35);
  const dark = mix(fur, P.walnut, 0.4);
  part(g, pill(0.17, 0.42), fur, 0, 0.24, 0, { rz: Math.PI / 2 });
  for (const x of [-0.12, 0.06]) part(g, pill(0.172, 0.02), dark, x, 0.245, 0, { rz: Math.PI / 2, sx: 1, sy: 0.4, ...QUIET });
  part(g, ball(0.18, 1), fur, 0.4, 0.4, 0);
  part(g, ball(0.08, 1), P.cream, 0.5, 0.36, 0, QUIET);
  part(g, ball(0.02, 0), P.rose, 0.575, 0.38, 0, QUIET);
  for (const z of [-0.09, 0.09]) part(g, cone(0.06, 0.13, 8), fur, 0.42, 0.58, z);
  for (const z of [-0.07, 0.07]) part(g, ball(0.028, 0), P.ink, 0.56, 0.43, z, QUIET);
  const tail = part(g, pill(0.04, 0.45), dark, -0.42, 0.45, 0, { rz: -0.4 });
  tail.name = 'tail';
  for (const x of [-0.18, 0.18]) for (const z of [-0.09, 0.09]) part(g, cyl(0.045, 0.045, 0.16, 6), x > 0 ? P.cream : fur, x, 0.07, z);
  return g;
}

function pigeonModel(): THREE.Group {
  const g = new THREE.Group();
  const grey = mix(P.slate, P.stone, 0.6);
  part(g, ball(0.2, 2), grey, 0, 0.2, 0, { sx: 1.25, sz: 0.9 });
  part(g, ball(0.12, 2), mix(grey, P.ink, 0.15), 0.2, 0.38, 0);
  part(g, ball(0.09, 1), P.teal, 0.13, 0.27, 0, { sx: 0.8, gloss: 0.5, ...QUIET });
  part(g, cone(0.035, 0.1, 6), P.mustard, 0.33, 0.37, 0, { rz: -Math.PI / 2, ...QUIET });
  for (const z of [-0.05, 0.05]) part(g, ball(0.022, 0), P.ink, 0.27, 0.42, z, QUIET);
  for (const z of [-0.13, 0.13]) part(g, rbox(0.26, 0.05, 0.1, 0.025), mix(grey, P.ink, 0.3), -0.1, 0.25, z, { rz: 0.3, ...QUIET });
  part(g, rbox(0.18, 0.04, 0.16, 0.02), mix(grey, P.ink, 0.4), -0.28, 0.2, 0, { rz: 0.3, ...QUIET });
  for (const z of [-0.05, 0.05]) part(g, cyl(0.015, 0.015, 0.1, 5), P.terracotta, 0, 0.04, z, QUIET);
  return g;
}

function cushionModel(): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(0.62, 0.2, 0.55, 0.09), P.mustard, 0, 0, 0, { tex: 'knit' });
  part(g, ball(0.04, 0), P.walnut, 0, 0.1, 0, QUIET);
  for (const x of [-1, 1]) for (const z of [-1, 1]) part(g, ball(0.035, 0), P.cream, x * 0.29, 0, z * 0.25, QUIET);
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

interface Polaroid {
  group: THREE.Group;
  target: THREE.WebGLRenderTarget;
  photo: THREE.MeshBasicMaterial;
  label: THREE.CanvasTexture;
  labelMat: THREE.MeshBasicMaterial;
  /** Seconds since it came out. */
  age: number;
  /** Seconds since it set off for the string, or -1. */
  flying: number;
  from?: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number };
  index: number;
  tilt: number;
}

class LivingRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly crew: Companion[];
  /** Each seat's wobble right now, for the jiggle (set by the game). */
  wobble: number[];
  private readonly fit = new CameraFit(this.camera, 0.2);
  private readonly marks: Mark[] = [];
  private readonly lens = new THREE.PerspectiveCamera(52, 1, 0.1, 60);
  private readonly pass = new THREE.WebGLRenderTarget(SNAP, SNAP, { type: THREE.HalfFloatType });
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadMat: THREE.MeshBasicMaterial;
  private readonly seatX: number[];
  private readonly led: THREE.MeshToonMaterial;
  private readonly flashLight: THREE.PointLight;
  private readonly flashMat: THREE.MeshBasicMaterial;
  private readonly counts: THREE.Sprite[] = [];
  private readonly polaroids: Polaroid[] = [];
  private readonly pigeon: THREE.Group;
  private readonly cat: THREE.Group;
  private readonly cushion: THREE.Group;
  private readonly sparks: Sparks;
  private readonly tick: (dt: number, time: number) => void;
  private flash = 0;
  private count = 0;
  private countPop = 0;
  /** The shot being taken, and the game time (set by the game each frame). */
  shot: Shot | null = null;
  time = 0;

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    this.crew = companions;
    this.wobble = seats.map(() => 0);
    this.seatX = lanes(seats.length, SPACING);
    // An evening in: one soft warm key from the front, the lamps do the rest.
    const rig = lightRig(this.scene, 'lampInterior', { fog: { near: 40, far: 90 }, shadowSize: 8, sunFrom: [0.25, 1, 0.8] });
    rig.sun.target.position.set(0, 0.5, 1);
    rig.sun.position.add(rig.sun.target.position);
    this.sparks = new Sparks(this.scene, 0.12, 0.8);
    this.buildRoom();
    this.buildCouch();
    this.tick = props.tickProps(this.scene);

    // Everyone squeezed onto the couch, sunk into the cushions, looking at the little camera.
    seats.forEach((s, i) => {
      const c = companions[i];
      const x = this.seatX[i] ?? 0;
      if (c) {
        c.root.position.set(x, SEAT_TOP - SINK, 0.02);
        c.root.rotation.y = Math.atan2(DEVICE.x - x, DEVICE.z) * 0.6;
        c.setBase('idle');
        this.scene.add(c.root);
      }
      const card = nameCard(s.name, s.color, 0.75);
      card.position.set(x, 0.12, 0.75);
      this.scene.add(card);
    });

    // The timer camera: a tiny tripod, a body, a lens toward the couch, a red light and a flash.
    const device = new THREE.Group();
    device.position.copy(DEVICE);
    device.userData.noPhoto = true;
    this.scene.add(device);
    for (const a of [0, 2.1, 4.2]) part(device, cyl(0.015, 0.015, 0.24, 5), P.metal, Math.sin(a) * 0.08, -0.2, Math.cos(a) * 0.08, { rx: Math.cos(a) * 0.35, rz: -Math.sin(a) * 0.35, outline: false });
    part(device, rbox(0.55, 0.34, 0.24, 0.05), P.charcoal, 0, 0, 0, { tex: 'leather', texStrength: 0.6 });
    part(device, rbox(0.56, 0.1, 0.25, 0.03), P.cream, 0, 0.13, 0, { gloss: 0.3, ...QUIET });
    part(device, cyl(0.11, 0.12, 0.12, 18), P.ink, 0, 0, -0.16, { rx: Math.PI / 2, gloss: 0.5 });
    part(device, cyl(0.125, 0.125, 0.025, 18), P.brass, 0, 0, -0.125, { rx: Math.PI / 2, gloss: 0.7, ...QUIET });
    part(device, cyl(0.07, 0.07, 0.02, 16), P.screen, 0, 0, -0.225, { rx: Math.PI / 2, glow: 0.5, outline: false });
    part(device, rbox(0.14, 0.08, 0.05, 0.02), P.ceramic, 0.17, 0.12, -0.11, { gloss: 0.5, ...QUIET });
    part(device, cyl(0.035, 0.035, 0.03, 10), P.brass, 0.18, 0.19, 0.02, { gloss: 0.7, ...QUIET });
    this.led = toonMat({ color: '#ff4d5e', emissive: new THREE.Color('#ff4d5e'), emissiveIntensity: 0.1 });
    part(device, ball(0.035, 1), '#ff4d5e', -0.19, 0.19, 0, { material: this.led, outline: false });
    this.flashLight = new THREE.PointLight('#ffffff', 0, 12, 1.2);
    this.flashLight.position.set(0, 0.2, -0.3);
    device.add(this.flashLight);

    // The countdown numbers over the camera.
    for (const text of ['3', '2', '1', 'Click!']) {
      const sp = popSprite(text, text === 'Click!' ? P.lamp : P.cream, text === 'Click!' ? 0.55 : 0.9);
      sp.position.copy(DEVICE).add(new THREE.Vector3(0, 0.95, 0));
      sp.visible = false;
      this.scene.add(sp);
      this.counts.push(sp);
    }

    // A white flash over the whole picture at the click.
    this.scene.add(this.camera);
    this.flashMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), this.flashMat);
    flash.position.z = -0.4;
    flash.renderOrder = 999;
    this.camera.add(flash);

    // The photobombers, waiting off stage.
    this.pigeon = pigeonModel();
    this.cat = catModel();
    this.cushion = cushionModel();
    for (const g of [this.pigeon, this.cat, this.cushion]) {
      g.visible = false;
      this.scene.add(g);
    }

    // The photo's camera, and a full-screen quad to blend the blur passes with.
    this.lens.position.copy(LENS);
    this.lens.lookAt(0, 1.0, 0);
    this.quadMat = new THREE.MeshBasicMaterial({ map: this.pass.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMat));

    // In view: the couch with everyone on it, the table and camera, and the string of photos.
    this.marks.push(
      { p: new THREE.Vector3(-COUCH_L / 2 - 0.4, 0, 0.6) },
      { p: new THREE.Vector3(COUCH_L / 2 + 0.4, 0, 0.6) },
      { p: new THREE.Vector3(-1.6, 0, TABLE.z + 0.7), pad: 0.04 },
      { p: new THREE.Vector3(1.6, 0, TABLE.z + 0.7), pad: 0.04 },
      { p: DEVICE.clone().setY(DEVICE.y + 1.4) },
      { p: new THREE.Vector3(pegAt(0).x - 0.55, STRING_Y + 0.1, WALL_Z) },
      { p: new THREE.Vector3(pegAt(SELFIE.photos - 1).x + 0.55, STRING_Y + 0.1, WALL_Z) },
    );
  }

  private buildRoom(): void {
    const s = this.scene;
    const wall = mix(P.teal, P.slate, 0.5);
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, sc = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc);
      s.add(o);
      return o;
    };
    const face = WALL_Z + 0.01;
    // Floorboards, a deep green wall with a darker dado, a woolly rug under the couch and table.
    part(s, box(34, 0.3, 18), P.oak, 0, -0.15, 4, { tex: 'woodFloor', outline: false, shadow: false });
    part(s, box(34, 10, 0.3), wall, 0, 5, WALL_Z - 0.15, { tex: 'plaster', texStrength: 0.9, ...QUIET });
    part(s, box(34, 1.0, 0.03), mix(wall, P.ink, 0.28), 0, 0.5, WALL_Z + 0.015, { tex: 'plaster', ...QUIET });
    part(s, box(34, 0.06, 0.06), P.cream, 0, 1.02, WALL_Z + 0.03, QUIET);
    part(s, box(34, 0.16, 0.05), P.cream, 0, 0.08, WALL_Z + 0.025, QUIET);
    put(props.rug({ w: 7.4, d: 4.4, color: mix(P.linen, P.mustard, 0.2), border: P.walnut, tex: 'knit' }), 0, 0, 1.7);
    // The window behind the couch, with its sill and curtains.
    put(props.windowFrame({ w: 2.4, h: 0.95, time: 'dusk', seed: 7, sill: false }), 0, 2.17, face);
    put(props.curtains({ w: 2.4, h: 0.95, color: mix(P.mustard, P.cream, 0.3) }), 0, 2.17, face);
    part(s, rbox(2.8, 0.08, 0.36, 0.03), P.cream, 0, SILL.y - 0.04, WALL_Z + 0.2, { tex: 'wood', texStrength: 0.4 });
    put(props.plant({ kind: 'cactus', h: 0.3, pot: P.terracotta }), -0.95, SILL.y, WALL_Z + 0.2);
    // The string for the photos, with a little peg for each, and fairy lights above it.
    part(s, cyl(0.012, 0.012, 8.2, 6), P.walnut, 0, STRING_Y, WALL_Z + 0.1, { rz: Math.PI / 2, outline: false });
    for (const e of [-1, 1]) part(s, ball(0.05, 1), P.brass, e * 4.1, STRING_Y, WALL_Z + 0.1, { gloss: 0.7, ...QUIET });
    for (let i = 0; i < SELFIE.photos; i++) part(s, rbox(0.05, 0.16, 0.04, 0.01), P.oak, pegAt(i).x, STRING_Y - 0.04, WALL_Z + 0.14, QUIET);
    for (let i = 0; i < 4; i++) s.add(props.stringLights(new THREE.Vector3(-9 + i * 4.5, 4.75, WALL_Z + 0.08), new THREE.Vector3(-4.5 + i * 4.5, 4.75, WALL_Z + 0.08), { sag: 0.35, count: 10 }));
    // Either side of the couch: a floor lamp and a tall plant; further out, shelves, pictures and a sideboard.
    put(props.floorLamp({ lit: true, light: 5, h: 2.3 }), -3.4, 0, -0.6);
    put(props.plant({ kind: 'ficus', h: 1.9, pot: P.terracotta, seed: 3 }), 3.5, 0, -0.75);
    put(props.pictureFrame({ w: 0.8, h: 1.0, art: 'sunset', frame: P.walnut, seed: 3 }), -2.3, 2.2, face);
    put(props.pictureFrame({ w: 0.55, h: 0.45, art: 'leaf', frame: P.brass, seed: 5 }), 2.05, 2.5, face);
    put(props.pictureFrame({ w: 0.5, h: 0.6, art: 'shapes', frame: P.charcoal, seed: 8 }), 2.1, 1.85, face);
    put(props.bookshelf({ w: 1.6, h: 2.4, seed: 4 }), 5.6, 0, WALL_Z + 0.22);
    put(props.speaker({ h: 0.9 }), 7.0, 0, WALL_Z + 0.3);
    put(props.pictureFrame({ w: 0.9, h: 0.7, art: 'hills', frame: P.walnut, seed: 2 }), 7.4, 2.3, face);
    put(props.sideboard({ w: 2.2 }), -5.9, 0, WALL_Z + 0.3);
    put(props.recordPlayer({ playing: true }), -6.3, 0.72, WALL_Z + 0.32);
    put(props.tableLamp({ lit: true, stand: P.terracotta }), -5.2, 0.72, WALL_Z + 0.3);
    put(props.pictureFrame({ w: 1.1, h: 0.8, art: 'moon', frame: P.charcoal, seed: 6 }), -5.9, 2.3, face);
    put(props.wallShelf({ w: 1.3, seed: 3 }), -8.2, 2.0, face);
    put(props.guitar(), -7.7, 0, WALL_Z + 0.3, 0.2);
    // In the foreground corners: an armchair and a pouf, a plant, a stack of magazines.
    put(props.armchair({ color: P.denim, pillow: P.mustard }), -5.2, 0, 2.4, 0.9, 1.25);
    put(props.pouf({ color: P.mauve }), 4.6, 0, 2.2);
    put(props.plant({ kind: 'monstera', h: 1.1, pot: P.ceramic, seed: 6 }), 5.9, 0, 3.4);
    put(props.sideTable({ h: 0.6 }), 4.9, 0, 0.6);
    put(props.candle(), 4.9, 0.6, 0.6);
    put(props.motes({ n: 18, area: [10, 2.5, 4], size: 0.035 }), 0, 0.8, 1);
    // The coffee table: a bowl of popcorn, a mug, the remote.
    put(props.coffeeTable({ w: 3.0, d: 1.2, h: TABLE.y, color: P.walnut }), TABLE.x, 0, TABLE.z);
    put(props.snackBowl({ fill: 'popcorn', color: P.teal, r: 0.26 }), -0.95, TABLE.y, TABLE.z + 0.15);
    put(props.mug({ color: P.ceramic }), 1.0, TABLE.y, TABLE.z - 0.1, 0.7, 1.3);
    put(props.remote(), 0.75, TABLE.y, TABLE.z + 0.3, 0.5);
    put(props.books(0.3, 3), -0.35, TABLE.y, TABLE.z - 0.3, Math.PI / 2);
  }

  private buildCouch(): void {
    const g = new THREE.Group();
    this.scene.add(g);
    const body = P.terracotta;
    const light = mix(P.terracotta, P.cream, 0.18);
    const v = { tex: 'velvet' as const };
    part(g, rbox(COUCH_L, 0.36, 1.1, 0.1), body, 0, 0.24, 0.05, v);
    for (const x of [-1, 0, 1]) part(g, rbox(COUCH_L / 3 - 0.06, 0.16, 0.92, 0.07), light, (x * COUCH_L) / 3, 0.46, 0.12, v);
    part(g, rbox(COUCH_L + 0.5, 0.78, 0.32, 0.1), body, 0, 0.75, -0.42, v);
    for (const x of [-1, 0, 1]) part(g, rbox(COUCH_L / 3 - 0.1, 0.48, 0.18, 0.08), light, (x * COUCH_L) / 3, 0.86, -0.24, v);
    for (const side of [-1, 1]) part(g, rbox(0.3, 0.62, 1.15, 0.1), body, side * (COUCH_L / 2 + 0.12), 0.44, 0.05, v);
    // a knitted throw over one arm, brass-capped feet
    part(g, rbox(0.36, 0.5, 0.7, 0.08), P.mustard, COUCH_L / 2 + 0.12, 0.52, 0.1, { tex: 'knit' });
    for (const x of [-1, 1])
      for (const z of [-1, 1]) {
        part(g, cyl(0.05, 0.035, 0.08, 8), P.walnut, x * (COUCH_L / 2), 0.04, 0.05 + z * 0.42, QUIET);
        part(g, cyl(0.037, 0.037, 0.02, 8), P.brass, x * (COUCH_L / 2), 0.01, 0.05 + z * 0.42, { gloss: 0.7, ...QUIET });
      }
  }

  /** The number on the timer: 3, 2, 1, or 4 for "Click!", 0 for nothing. */
  setCount(n: number): void {
    if (n === this.count) return;
    this.count = n;
    this.countPop = 1;
    this.counts.forEach((sp, i) => (sp.visible = n > 0 && (n === 4 ? i === 3 : i === 3 - n)));
  }

  /** Click: the flash goes off. */
  click(): void {
    this.flash = 1;
  }

  /** Where a seat's face is, for floating words. */
  faceOf(i: number): THREE.Vector3 {
    return new THREE.Vector3(this.seatX[i] ?? 0, SEAT_TOP - SINK + HEIGHT + 0.25, 0.4);
  }

  /**
   * Takes the photo: renders the room from the timer camera several times, with everyone in `blur` (a seat and how
   * far they moved) shifted a little further each time, and blends the renders, so they come out as a trail.
   */
  snap(renderer: THREE.WebGLRenderer, blur: { seat: number; amount: number }[]): THREE.WebGLRenderTarget {
    const out = new THREE.WebGLRenderTarget(SNAP, SNAP, { type: THREE.HalfFloatType });
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.visible && ((o as THREE.Sprite).isSprite || o.userData.noPhoto === true || o.parent === this.camera)) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    const still = this.crew.map((c) => ({ pos: c.root.position.clone(), rz: c.root.rotation.z }));
    this.crew.forEach((c, i) => {
      const s = still[i];
      if (!s) return;
      c.root.position.copy(s.pos);
      c.root.position.x = this.seatX[i] ?? s.pos.x;
      c.root.rotation.z = 0;
    });
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.autoClear;
    const flash = this.flashLight.intensity;
    this.flashLight.intensity = 4;
    for (let k = 0; k < PASSES; k++) {
      const u = k / (PASSES - 1) - 0.5;
      for (const b of blur) {
        const c = this.crew[b.seat];
        if (!c) continue;
        c.root.position.x = (this.seatX[b.seat] ?? 0) + u * b.amount;
        c.root.position.y = SEAT_TOP - SINK + Math.sin(u * Math.PI * 2) * b.amount * 0.12;
        c.root.rotation.z = u * b.amount * 0.5;
      }
      renderer.setRenderTarget(this.pass);
      renderer.autoClear = true;
      renderer.render(this.scene, this.lens);
      this.quadMat.opacity = 1 / (k + 1);
      renderer.setRenderTarget(out);
      renderer.autoClear = k === 0;
      renderer.render(this.quadScene, this.quadCam);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevClear;
    this.flashLight.intensity = flash;
    this.crew.forEach((c, i) => {
      const s = still[i];
      if (!s) return;
      c.root.position.copy(s.pos);
      c.root.rotation.z = s.rz;
    });
    for (const o of hidden) o.visible = true;
    return out;
  }

  /** The photo comes out of the camera as a polaroid, big on screen, and develops. */
  showPhoto(index: number, target: THREE.WebGLRenderTarget, caption: string, good: boolean): void {
    const group = new THREE.Group();
    group.userData.noPhoto = true;
    part(group, rbox(1.0, 1.2, 0.03, 0.02), P.linen, 0, 0, 0, { outline: 0.02 });
    const photo = new THREE.MeshBasicMaterial({ map: target.texture, color: '#2b2420' });
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.86), photo);
    pic.position.set(0, 0.08, 0.02);
    group.add(pic);
    const label = canvasTexture(512, 112, (g, w, h) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = good ? P.forest : P.brick;
      g.font = `700 48px ${ROUNDED_FONT}`;
      g.fillText(caption, w / 2, h / 2 + 2, w - 24);
    });
    const labelMat = new THREE.MeshBasicMaterial({ map: label, transparent: true, depthWrite: false });
    const text = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.19), labelMat);
    text.position.set(0, -0.47, 0.02);
    group.add(text);
    this.camera.add(group);
    this.polaroids.push({ group, target, photo, label, labelMat, age: 0, flying: -1, index, tilt: (index % 2 ? 1 : -1) * (0.04 + (index % 3) * 0.02) });
  }

  /** The newest photo goes up on the string. */
  pinPhoto(): void {
    const p = this.polaroids.find((x) => x.flying < 0);
    if (!p) return;
    this.scene.attach(p.group);
    p.from = { pos: p.group.position.clone(), quat: p.group.quaternion.clone(), scale: p.group.scale.x };
    p.flying = 0;
    // Up on the string it's part of the room, so it shows in the next photos too.
    p.group.userData.noPhoto = false;
  }

  /** Places a camera-held polaroid: `nx`, `ny` in screen units, `hs` its height as a share of the screen. */
  private hold(p: Polaroid, nx: number, ny: number, hs: number, spin: number): void {
    const d = 3;
    const half = d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    p.group.position.set(nx * half * this.camera.aspect, ny * half, -d);
    p.group.rotation.set(0, 0, spin);
    p.group.scale.setScalar((hs * 2 * half) / 1.2);
  }

  /** Photobombers: where they are at game time `t` during their shot. */
  private bombers(t: number): void {
    const shot = this.shot;
    const kind: Bomber | null = shot?.bomber ?? null;
    const at = shot?.bomberAt ?? 0;
    const u = t - at;
    const active = (k: Bomber, from: number, to: number) => kind === k && u >= from && u <= to;
    // The pigeon flutters down onto the sill, bobs about, and flies off once the photo is taken.
    this.pigeon.visible = active('pigeon', -0.6, (shot?.clickAt ?? 0) - at + 1.6);
    if (this.pigeon.visible) {
      const leave = (shot?.clickAt ?? 0) - at + 0.9;
      if (u < 0) {
        const k = ease.outCubic((u + 0.6) / 0.6);
        this.pigeon.position.set(SILL.x + (1 - k) * 2.2, SILL.y + (1 - k) * 1.4, SILL.z);
      } else if (u < leave) {
        this.pigeon.position.copy(SILL).add(new THREE.Vector3(Math.sin(u * 1.5) * 0.15, 0, 0));
        this.pigeon.rotation.z = Math.abs(Math.sin(u * 7)) * 0.2;
      } else {
        const k = (u - leave) / 0.7;
        this.pigeon.position.set(SILL.x - k * 2.5, SILL.y + k * 1.6, SILL.z);
      }
      this.pigeon.rotation.y = u >= 0 && u < leave ? -0.6 : Math.PI;
    }
    // The cat hops up onto the coffee table, strolls across right in front of the camera, and hops down again.
    this.cat.visible = active('cat', -1.4, 2.6);
    if (this.cat.visible) {
      const x = 2.6 - ((u + 1.4) / 4) * 5.2;
      const off = Math.max(0, Math.abs(x) - 1.45);
      this.cat.position.set(x, Math.max(0, TABLE.y - off * 2.5) + Math.abs(Math.sin(u * 8)) * 0.03, TABLE.z - 0.15);
      this.cat.scale.set(-1, 1, 1);
      const tail = this.cat.getObjectByName('tail');
      if (tail) tail.rotation.z = -0.4 + Math.sin(u * 4) * 0.3;
    }
    // A cushion topples off the back of the couch onto somebody's head, and slides off after the photo.
    this.cushion.visible = active('cushion', -0.4, (shot?.clickAt ?? 0) - at + 1.4);
    if (this.cushion.visible && shot) {
      const x = this.seatX[shot.victim % Math.max(1, this.seatX.length)] ?? 0;
      const top = SEAT_TOP - SINK + HEIGHT + 0.1;
      const off = shot.clickAt - at + SELFIE.exposure + 0.4;
      if (u < 0) {
        const k = (u + 0.4) / 0.4;
        this.cushion.position.set(x, 2.6 - k * k * (2.6 - top), -0.35 + k * 0.35);
        this.cushion.rotation.set(k * 2.5, 0, k * 0.8);
      } else if (u < off) {
        this.cushion.position.set(x, top + Math.max(0, 0.06 - u * 0.4), 0);
        this.cushion.rotation.set(0.1, 0.3, 0.12);
      } else {
        const k = (u - off) / 0.6;
        this.cushion.position.set(x + k * 0.9, top - k * k * (top - 0.6), k * 0.6);
        this.cushion.rotation.set(0.1, 0.3, 0.12 + k * 1.4);
      }
    }
  }

  dispose(): void {
    for (const c of this.crew) c.dispose();
    for (const p of this.polaroids) {
      p.target.dispose();
      p.photo.dispose();
      p.label.dispose();
      p.labelMat.dispose();
    }
    this.pass.dispose();
    this.quadMat.dispose();
    this.led.dispose();
    this.sparks.dispose();
    this.flashMat.dispose();
    for (const sp of this.counts) {
      sp.material.map?.dispose();
      sp.material.dispose();
    }
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    for (const c of this.crew) c.update(dt);
    this.sparks.update(dt);
    this.tick(dt, time);
    // Everyone jiggles as much as their phone does.
    this.crew.forEach((c, i) => {
      const w = Math.min(1, this.wobble[i] ?? 0);
      c.root.rotation.z = Math.sin(time * 13 + i * 1.9) * w * 0.22;
      c.root.position.x = (this.seatX[i] ?? 0) + Math.sin(time * 9.1 + i) * w * 0.07;
    });
    // The timer camera: the red light blinks faster as the count runs down; the flash fades.
    const shot = this.shot;
    const phase: ShotPhase = shot ? phaseAt(shot, this.time) : 'show';
    const blink = phase === 'count' ? (Math.sin(this.time * (8 + 10 * (4 - countdownAt(shot as Shot, this.time)))) > 0 ? 1.4 : 0.1) : 0.1;
    this.led.emissiveIntensity = blink;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.flashMat.opacity = this.flash * this.flash * 0.85;
    this.flashLight.intensity = this.flash * 30;
    this.countPop = Math.max(0, this.countPop - dt * 4);
    for (const sp of this.counts) {
      if (!sp.visible) continue;
      const base = sp === this.counts[3] ? 0.55 : 0.9;
      const s = base * (1 + this.countPop * 0.35);
      sp.scale.set((1024 / 112) * s, s, 1);
    }
    this.bombers(this.time);
    // Polaroids: out of the camera and up the screen, developing; later off to their peg on the string.
    for (const p of this.polaroids) {
      p.age += dt;
      const dev = Math.min(1, p.age / 1.3);
      p.photo.color.setRGB(0.17 + 0.83 * dev, 0.14 + 0.86 * dev, 0.13 + 0.87 * dev);
      if (p.flying < 0) {
        const k = ease.outBack(Math.min(1, p.age / 0.45));
        this.hold(p, 0.24, -1.7 + k * 1.66, 0.6, p.tilt * 1.5 * (1 - k) + p.tilt);
      } else if (p.from) {
        const before = p.flying;
        p.flying += dt;
        if (before < 0.7 && p.flying >= 0.7) this.sparks.burst(pegAt(p.index).add(new THREE.Vector3(0, 0.55, 0.1)), P.lamp, 8, 0.7, 0.6);
        const k = ease.inOutSine(Math.min(1, p.flying / 0.7));
        const peg = pegAt(p.index);
        p.group.position.lerpVectors(p.from.pos, peg, k);
        p.group.position.z += Math.sin(k * Math.PI) * 0.6;
        p.group.quaternion.slerpQuaternions(p.from.quat, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, p.tilt)), k);
        // it lands on its peg with a little overshoot and swings to rest
        const settle = Math.max(0, Math.min(1, (p.flying - 0.7) / 0.5));
        const swing = p.flying >= 0.7 ? Math.sin(settle * Math.PI * 3) * (1 - settle) * 0.12 : 0;
        if (swing) p.group.rotateZ(swing);
        p.group.scale.setScalar(p.from.scale + (0.82 - p.from.scale) * k + (p.flying >= 0.7 ? Math.sin(settle * Math.PI) * 0.05 * (1 - settle) : 0));
      }
    }
  }
}

// ------------------------------------------------------------------ little sounds

function beep(sfx: Sfx, high: boolean): void {
  tone(sfx, { freq: high ? 1320 : 880, dur: high ? 0.16 : 0.08, type: 'sine', gain: 0.1 });
}

function shutter(sfx: Sfx): void {
  noise(sfx, { dur: 0.06, filter: 'highpass', freq: 3000, gain: 0.25 });
  tone(sfx, { freq: 2200, to: 1400, dur: 0.04, type: 'square', gain: 0.04 });
  noise(sfx, { dur: 0.08, filter: 'highpass', freq: 2500, gain: 0.18, delay: 0.12 });
}

const BOMBER_SOUND: Record<Bomber, (sfx: Sfx) => void> = {
  pigeon: (sfx) => {
    tone(sfx, { freq: 330, to: 290, dur: 0.18, type: 'sine', gain: 0.1 });
    tone(sfx, { freq: 300, to: 260, dur: 0.25, type: 'sine', gain: 0.09, delay: 0.22 });
  },
  cat: (sfx) => tone(sfx, { freq: 600, to: 900, dur: 0.35, type: 'triangle', gain: 0.07 }),
  cushion: (sfx) => noise(sfx, { dur: 0.2, freq: 260, gain: 0.3 }),
};

// ------------------------------------------------------------------ the minigame

export const minigame: Minigame = {
  id: 'groupselfie',
  title: 'Group Selfie',
  how: 'Everyone on the couch for six group photos! After each 3-2-1, hold your phone dead still while the shutter clicks, or you come out blurry. Whatever wanders into the shot, don’t flinch.',
  controller: 'still',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const shots = planShoot(rng, n);
    const total = shootLength(shots);
    const skill = seats.map(() => ctx.skill());
    const cpus: SelfieCpu[] = seats.map(() => newSelfieCpu());
    const view = new LivingRoom(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    const note = (i: number) => `Photo ${i + 1} of ${SELFIE.photos}: hold still on the click!`;
    session.setLayoutAll(() => ({ kind: 'still', note: 'Squeeze in! Hold still when the camera clicks.' }));

    const t0 = clock.time;
    const now = () => clock.time - t0;
    const samples: Sample[][] = seats.map(() => []);
    const live = seats.map(() => 0.05);
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'still' || seat >= n || session.isCpu(seat)) return;
      live[seat] = msg.wobble;
      samples[seat]?.push({ at: now() - ((session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed, wobble: msg.wobble });
    });

    const results: boolean[][] = [];
    const sharpBy = seats.map(() => 0);
    let judged = 0;
    let pinned = 0;
    let t = 0;
    let sampleAt = 0;
    let lastCount = 0;
    let shotIndex = -1;
    let clicked = -1;
    let hudAt = -1;
    let meterAt = -1;
    ui.caption('Squeeze in for a group selfie!');
    await everyFrame(clock, () => {
      const target = Math.min(now(), total);
      while (t < target - 1e-6) {
        const dt = Math.min(STEP, target - t);
        const prev = t;
        t += dt;
        const shot = shotAt(shots, t);
        if (!shot) break;
        const phase = phaseAt(shot, t);
        const startle = shot.bomber !== null && prev < shot.bomberAt && t >= shot.bomberAt;
        seats.forEach((_, i) => {
          if (!session.isCpu(i)) return;
          live[i] = cpuSelfieWobble(cpus[i] as SelfieCpu, skill[i] ?? 0.5, rng, dt, phase, startle);
        });
        if (t >= sampleAt) {
          sampleAt = t + 0.1;
          seats.forEach((_, i) => {
            if (session.isCpu(i)) samples[i]?.push({ at: t, wobble: live[i] ?? 0 });
          });
        }
        if (startle && shot.bomber) {
          BOMBER_SOUND[shot.bomber](sfx);
          ui.caption(`${BOMBER_INFO[shot.bomber].label} Don’t flinch…`);
        }
      }
      const shot = shotAt(shots, t);
      view.time = t;
      view.shot = shot;
      view.wobble = live.map((w) => Math.min(1, w));

      // A new photo: phones get its note, everyone smiles for the camera.
      if (shot && shot.index !== shotIndex && t >= shot.countAt) {
        shotIndex = shot.index;
        session.setLayoutAll(() => ({ kind: 'still', note: note(shot.index) }));
        ui.caption(note(shot.index));
        for (const c of view.crew) c.setBase('happy');
      }
      // The 3-2-1 over the camera, then the click.
      const count = shot ? countdownAt(shot, t) : 0;
      if (count !== lastCount) {
        if (count > 0) beep(sfx, count === 1);
        lastCount = count;
      }
      if (shot && t >= shot.clickAt && clicked < shot.index) {
        clicked = shot.index;
        view.click();
        shutter(sfx);
      }
      const clicking = shot !== null && t >= shot.clickAt && t < shot.clickAt + SELFIE.exposure + 0.3;
      view.setCount(count > 0 ? count : clicking ? 4 : 0);

      // Judge each photo a moment after the shutter closes, take the picture and show it.
      while (judged < shots.length && t >= (shots[judged] as Shot).clickAt + SELFIE.exposure + SELFIE.grace) {
        const s = shots[judged] as Shot;
        const verdicts = seats.map((_, i) => judgeShot(samples[i] ?? [], s.clickAt));
        const sharp = verdicts.map((v) => v.sharp);
        results.push(sharp);
        sharp.forEach((ok, i) => {
          if (ok) sharpBy[i] = (sharpBy[i] ?? 0) + 1;
        });
        const blurry = seats.filter((_, i) => !sharp[i]).map((x) => x.name);
        const blur = verdicts.map((v, seat) => ({ seat, amount: Math.min(0.5, 0.16 + v.peak * 0.6) })).filter((b) => !sharp[b.seat]);
        const photo = view.snap(ctx.stage.renderer, blur);
        const caption = blurry.length === 0 ? (n > 1 ? 'All sharp!' : 'Sharp!') : `Blurry: ${blurry.join(', ')}`;
        view.showPhoto(s.index, photo, caption, blurry.length === 0);
        if (blurry.length === 0) sfx.good();
        else tone(sfx, { freq: 392, to: 330, dur: 0.25, type: 'triangle', gain: 0.1 });
        ui.caption(blurry.length === 0 ? `Photo ${s.index + 1}: everyone sharp!` : `Photo ${s.index + 1}: ${blurry.join(', ')} came out blurry`, blurry.length ? '#ffb3cf' : undefined);
        seats.forEach((_, i) => {
          view.crew[i]?.react(sharp[i] ? 'approval' : 'sad', 1.4);
          view.crew[i]?.setBase('idle');
          if (!session.isCpu(i)) session.send(i, { t: 'feedback', good: sharp[i] ?? false, text: sharp[i] ? 'Sharp! Nice one.' : 'Blurry! You wobbled on the click.' });
        });
        judged++;
      }
      // Each photo goes up on the string just before the next countdown.
      while (pinned < judged && t >= (shots[pinned] as Shot).end - 0.25) {
        view.pinPhoto();
        pinned++;
      }

      // The phones' composure bars while it matters.
      if (t - meterAt > 0.2) {
        meterAt = t;
        const phase = shot ? phaseAt(shot, t) : 'show';
        seats.forEach((_, i) => {
          if (session.isCpu(i)) return;
          const w = live[i] ?? 0;
          const watching = phase === 'count' || phase === 'expose';
          session.send(i, { t: 'meter', value: watching ? Math.min(1, w / (SELFIE.threshold * 2)) : 0, danger: watching && w >= SELFIE.threshold });
        });
      }
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(total - t);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${sharpBy[i] ?? 0} / ${judged} sharp` })));
      }
      return judged >= shots.length && pinned >= shots.length && t >= total;
    });
    off();
    ui.timer(null);
    const coop = selfieCoop(results);
    const faces = results.reduce((a, r) => a + r.length, 0);
    const sharpFaces = results.reduce((a, r) => a + r.filter(Boolean).length, 0);
    session.setLayoutAll(() => ({ kind: 'wait', title: 'That’s a wrap!', text: 'Watch the big screen' }));
    for (const c of view.crew) c.setBase(coop >= 0.7 ? 'happy' : 'idle');
    if (coop >= 0.7) sfx.good();
    ui.caption(`${sharpFaces} of ${faces} faces sharp. ${coop >= 0.9 ? 'Frame-worthy!' : coop >= 0.7 ? 'A lovely set.' : 'Very… artistic.'}`);
    await clock.wait(2.2);
    ui.caption(null);
    const score = Math.round(coop * 1000);
    return {
      scores: seats.map(() => score),
      details: seats.map((_, i) => `Sharp in ${sharpBy[i] ?? 0} of ${SELFIE.photos} photos`),
      coop,
    };
  },
};
