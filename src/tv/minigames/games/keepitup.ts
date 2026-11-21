// Keep It Up on the TV: a living room late at night, one balloon, three players keeping it off the floor and one
// on the desk fan up on the bookcase, blowing it down or off into the cushion corners. Seen from where the telly
// stands, a little above, like a doll's house with the front wall off.
import * as THREE from 'three';
import {
  FURNITURE,
  KEEP,
  NOOKS,
  type Brain,
  type Room,
  type Stick,
  type Tilt,
  advance,
  airflow,
  cpuStick,
  cpuTilt,
  fanDir,
  inReach,
  isOver,
  keepScores,
  newBrain,
  newRoom,
  threeWin,
} from '../../../game/minigames/keepitup';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cone, cyl, material, mix, nameCard, part, pill, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.1; // the three
const FAN_HEIGHT = 0.75; // the fan's keeper, up on the bookcase
const TILT = 0.64; // how far the camera looks down
const BALLOON = mix(P.neonViolet, P.rose, 0.25);
const STREAKS = 44;
const STRING_POINTS = 10;
const STRING_LEN = 0.9;

interface Rig {
  c: Companion;
  marker: THREE.Mesh;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
  hop: number;
  reach: boolean;
}

interface Streak {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  s: number;
  speed: number;
  len: number;
  max: number;
  live: boolean;
}

/** Takes the outlines off background dressing, so it stays quiet (and cheap to draw). */
function quiet<T extends THREE.Object3D>(o: T): T {
  const lines: THREE.Object3D[] = [];
  o.traverse((c) => {
    if (c.name === 'outline') lines.push(c);
  });
  for (const l of lines) l.removeFromParent();
  return o;
}

/** A quarter of a flat disc, for the cushion rugs in the corners (theta as in THREE.CylinderGeometry). */
function quarterDisc(r: number, h: number, start: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(r, r, h, 14, 1, false, start, Math.PI / 2);
}

class LivingRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  readonly rigs: (Rig | null)[] = [];
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly fanPivot = new THREE.Group();
  private readonly fanHead = new THREE.Group();
  private readonly blades = new THREE.Group();
  private readonly balloon = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly shadowMat = new THREE.MeshBasicMaterial({ color: P.ink, transparent: true, opacity: 0.3, depthWrite: false });
  private tick: (dt: number, time: number) => void = () => {};
  /** A bop squashes the balloon for a moment. */
  private kick = 0;
  private readonly string: THREE.Line;
  private readonly stringPts = Array.from({ length: STRING_POINTS }, () => new THREE.Vector3());
  private readonly streaks: Streak[] = [];
  private readonly streakGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true);
  private readonly glass: THREE.Mesh;
  private readonly glassMat = new THREE.MeshBasicMaterial({ color: '#dff1ff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  private readonly cat = new THREE.Group();
  private readonly own: { dispose(): void }[] = [];
  private readonly rand = seeded(11);
  private spawn = 0;
  private catZ = 2;
  private pop = 1;
  private bobble = 0;
  private catNap = 0;
  private readonly colors: string[];
  /** The fan's keeper (not in rigs: it never runs). */
  readonly fanKeeper: Companion | null;

  constructor(
    seats: MinigameSeat[],
    companions: Companion[],
    fanPos: number,
    private readonly room: Room,
  ) {
    this.colors = seats.map((s) => s.color);
    this.fanKeeper = companions[fanPos] ?? null;
    // Evening in the garden room: one warm key from above, and the floor lamp in the corner.
    const rig = lightRig(this.scene, 'lampInterior', { shadowSize: 8, fog: { near: 30, far: 80 } });
    rig.sun.target.position.set(0, 0, -0.2);
    rig.sun.position.z -= 0.2;
    this.buildRoom();
    this.buildFan();

    // The balloon: a round body with a shine, a knot and a string that trails behind.
    part(this.balloon, sphere(KEEP.ballR, 32), BALLOON, 0, 0, 0, { sy: 1.12, glow: 0.22, gloss: 0.7, exact: true });
    part(this.balloon, sphere(0.07, 10), '#ffffff', -0.11, 0.15, 0.22, { basic: true, shadow: false, sy: 1.4 });
    part(this.balloon, sphere(0.03, 8), '#ffffff', -0.17, 0.04, 0.24, { basic: true, shadow: false });
    part(this.balloon, cone(0.055, 0.09, 10), mix(BALLOON, P.ink, 0.2), 0, -KEEP.ballR * 1.12 - 0.02, 0, { outline: false });
    this.scene.add(this.balloon);
    const sg = new THREE.BufferGeometry().setFromPoints(this.stringPts);
    const sm = new THREE.LineBasicMaterial({ color: P.cream });
    this.string = new THREE.Line(sg, sm);
    this.string.frustumCulled = false;
    this.scene.add(this.string);
    this.own.push(sg, sm);
    const circle = new THREE.CircleGeometry(KEEP.ballR * 1.2, 24);
    this.own.push(circle, this.shadowMat);
    this.shadow = new THREE.Mesh(circle, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    this.scene.add(this.shadow);
    this.glass = new THREE.Mesh(torus(0.5, 0.03), this.glassMat);
    this.glass.visible = false;
    this.scene.add(this.glass);
    this.own.push(this.glassMat, this.streakGeo);
    this.syncBalloon(0);
    for (const s of this.stringPts) s.copy(this.balloon.position).y -= 0.5;

    // Breeze lines: a pool of thin streaks that fly out along the fan's aim.
    for (let i = 0; i < STREAKS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#e6f4ff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(this.streakGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.own.push(mat);
      this.streaks.push({ mesh, mat, from: new THREE.Vector3(), dir: new THREE.Vector3(), s: 0, speed: 0, len: 0, max: 0, live: false });
    }

    seats.forEach((s, i) => {
      const c = companions[i] as Companion;
      this.scene.add(c.root);
      if (i === fanPos) {
        // Sitting up on the bookcase beside the fan, with a little card.
        c.root.position.set(0.45, FURNITURE[0]?.top ?? 2.3, -2.7);
        c.root.rotation.y = -0.35;
        c.setBase('working');
        const card = nameCard('Fan', s.color, 0.75);
        card.position.set(0.45, (FURNITURE[0]?.top ?? 2.3) + FAN_HEIGHT + 0.35, -2.7);
        this.scene.add(card);
        this.own.push(card.material.map as THREE.Texture, card.material);
        this.rigs.push(null);
        return;
      }
      const marker = part(this.scene, torus(0.42, 0.045), s.color, 0, 0.045, 0, { rx: Math.PI / 2, glow: 1.0, outline: false, shadow: false });
      c.setBase('listening');
      this.rigs.push({ c, marker, motion: null, mood: null, hop: 0, reach: false });
    });
  }

  private buildRoom(): void {
    const s = this.scene;
    const { x: W, back, front } = KEEP.room;
    const midZ = (back + front) / 2;
    const depth = front - back;
    const flat = { outline: false as const, shadow: false };
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, k = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(k);
      s.add(o);
      return o;
    };
    const block = (name: string) => FURNITURE.find((f) => f.name === name);
    const wallC = P.duskWall;
    const plaster = { tex: 'plaster' as const, texScale: 3, outline: false as const };
    const cap = mix(P.walnut, P.ink, 0.35);

    // Floorboards, a woolly rug, the walls with a darker dado.
    part(s, box(W * 2 + 0.6, 0.3, depth + 0.3), P.oak, 0, -0.15, midZ + 0.1, { tex: 'woodFloor', ...flat });
    put(props.rug({ w: 5.6, d: 3.1, color: mix(P.plum, P.mauve, 0.5), border: mix(P.mauve, P.cream, 0.4), tex: 'knit' }), 0.3, 0, 0.25);
    part(s, box(W * 2 + 0.6, 3.6, 0.3), wallC, 0, 1.8, back - 0.15, plaster);
    part(s, box(W * 2, 0.95, 0.03), mix(wallC, P.ink, 0.22), 0, 0.475, back + 0.015, { ...plaster, shadow: false });
    part(s, box(W * 2, 0.05, 0.05), P.cream, 0, 0.95, back + 0.035, flat);
    part(s, box(W * 2, 0.14, 0.04), P.cream, 0, 0.07, back + 0.02, flat);
    part(s, box(W * 2 + 0.64, 0.06, 0.34), cap, 0, 3.63, back - 0.15, flat);
    for (const side of [-1, 1]) {
      part(s, box(0.3, 2.6, depth + 0.3), mix(wallC, P.ink, 0.08), side * (W + 0.15), 1.3, midZ + 0.1, plaster);
      part(s, box(0.03, 0.95, depth), mix(wallC, P.ink, 0.28), side * (W - 0.015), 0.475, midZ, { ...plaster, shadow: false });
      part(s, box(0.05, 0.05, depth), P.cream, side * (W - 0.035), 0.95, midZ, flat);
      part(s, box(0.04, 0.14, depth), P.cream, side * (W - 0.02), 0.07, midZ, flat);
      part(s, box(0.34, 0.06, depth + 0.34), cap, side * (W + 0.15), 2.63, midZ + 0.1, flat);
    }
    // The front edge of the floor: where the room meets the glass we are looking through.
    part(s, box(W * 2 + 0.6, 0.34, 0.1), P.walnut, 0, -0.15, front + 0.3, { tex: 'wood', outline: false });
    part(s, box(W * 2 + 0.6, 0.03, 0.08), P.brass, 0, 0.012, front + 0.04, { gloss: 0.6, ...flat });

    // On the walls: a window on the night with curtains, pictures, a clock, a string of lights.
    put(props.windowFrame({ w: 2.0, h: 1.2, time: 'night', seed: 4 }), -3.2, 2.35, back + 0.01);
    put(props.curtains({ w: 2.0, h: 1.2, color: mix(P.mustard, P.cream, 0.25) }), -3.2, 2.35, back + 0.01);
    put(props.pictureFrame({ w: 1.0, h: 0.75, art: 'sunset', frame: P.brass }), 2.9, 2.2, back + 0.01);
    put(props.pictureFrame({ w: 0.45, h: 0.55, art: 'leaf', seed: 9 }), 1.75, 2.45, back + 0.01);
    put(props.pictureFrame({ w: 0.45, h: 0.4, art: 'shapes', frame: P.charcoal, seed: 12 }), 1.75, 1.85, back + 0.01);
    put(props.wallClock(), -1.45, 2.7, back + 0.01);
    for (let i = 0; i < 3; i++) {
      const x0 = -W + 0.2 + (i * (W * 2 - 0.4)) / 3;
      s.add(props.stringLights(new THREE.Vector3(x0, 3.3, back + 0.08), new THREE.Vector3(x0 + (W * 2 - 0.4) / 3, 3.3, back + 0.08), { sag: 0.16, count: 7 }));
    }
    put(props.wallShelf({ w: 1.3, seed: 5 }), W - 0.01, 1.75, -0.9, -Math.PI / 2);
    put(props.pictureFrame({ w: 0.7, h: 0.5, art: 'moon', seed: 4 }), -W + 0.01, 1.9, -0.3, Math.PI / 2);

    // The furniture stands exactly where the rules have it. The bookcase (the fan is on top), full of books.
    const bc = block('bookcase');
    if (bc) put(props.bookshelf({ w: bc.x1 - bc.x0, h: bc.top + 0.02, shelves: 4, seed: 7 }), (bc.x0 + bc.x1) / 2, 0, (bc.z0 + bc.z1) / 2 + 0.06).scale.set(1, 1, 1.4);
    // The sofa under the window, the coffee table with crisps and a mug.
    put(props.sofa({ seats: 3, seatW: 0.76, color: P.denim, pillows: [P.mustard, P.rose] }), -3.2, 0, -2.5).scale.set(1, 0.92, 1);
    put(props.coffeeTable({ w: 1.4, d: 0.8, h: 0.45, color: P.walnut }), -3.2, 0, -0.85);
    put(props.snackBowl({ fill: 'crisps', color: P.ceramic }), -3.45, 0.45, -0.9, 0, 1.25);
    put(props.mug({ color: P.terracotta }), -2.85, 0.45, -0.75, 0.8, 1.5);
    put(props.remote(), -3.1, 0.45, -0.6, 0.5, 1.3);
    // The armchair in the other corner, the floor lamp beside it (the room's warm light), and a pouf on the rug.
    put(props.armchair({ color: P.terracotta, pillow: P.cream }), 2.9, 0, -2.44).scale.set(0.94, 0.92, 1.16);
    put(props.floorLamp({ h: 1.95, lit: true, light: 14 }), 4.5, 0, -2.75);
    put(props.pouf({ color: P.mustard, r: 0.46, h: 0.45 }), 3.45, 0, 1.05);

    // Floor cushions piled in the front corners; a cat asleep on the left ones.
    const cushions = [P.terracotta, P.teal, P.mauve, P.mustard];
    NOOKS.forEach((n, i) => {
      const toward = Math.sign(-n.x) || 1; // +1: the room is to the right of this corner
      const rug = quarterDisc(n.r, 0.04, toward > 0 ? Math.PI / 2 : Math.PI);
      this.own.push(rug);
      part(s, rug, i === 0 ? mix(P.denim, P.ink, 0.15) : mix(P.plum, P.mauve, 0.3), n.x, 0.02, n.z, { tex: 'terry', ...flat });
      const spots = [
        [0.42, 0.42],
        [0.85, 0.45],
        [0.45, 0.85],
      ] as const;
      spots.forEach(([ix, iz], k) => {
        part(s, sphere(0.42, 20), cushions[(i * 2 + k) % cushions.length] as string, n.x + toward * ix, 0.12 + k * 0.03, n.z - iz, { sy: 0.32, ry: k * 0.7, tex: k % 2 ? 'knit' : 'velvet', texScale: 0.7 });
      });
    });
    // The cat: curled up, ears, a tail round its nose.
    const fur = mix(P.copper, P.mustard, 0.45);
    const furDark = mix(P.copper, P.walnut, 0.3);
    part(this.cat, sphere(0.24, 18), fur, 0, 0, 0, { sx: 1.25, sy: 0.55 });
    part(this.cat, sphere(0.13, 14), fur, 0.22, 0.05, 0.1);
    part(this.cat, cone(0.05, 0.09, 8), furDark, 0.18, 0.17, 0.08, { rz: 0.3, outline: false });
    part(this.cat, cone(0.05, 0.09, 8), furDark, 0.28, 0.17, 0.12, { rz: -0.3, outline: false });
    part(this.cat, torus(0.2, 0.04, Math.PI * 1.1), furDark, 0, -0.02, 0.05, { rx: Math.PI / 2, rz: 0.4, outline: false });
    const n0 = NOOKS[0];
    if (n0) this.cat.position.set(n0.x + 0.6, 0.3, n0.z - 0.55);
    this.cat.rotation.y = 0.5;
    s.add(this.cat);

    this.buildGarden();
    this.tick = props.tickProps(s);
  }

  /** The garden round the room, at night: we are looking in through the big window. */
  private buildGarden(): void {
    const s = this.scene;
    const { x: W, back, front } = KEEP.room;
    const g = new THREE.Group();
    const rand = seeded(5);
    const night = (c: string) => mix(c, P.midnight, 0.5);
    part(g, cyl(70, 70, 0.2, 40), night(P.grassDark), 0, -0.42, 0, { tex: 'grass', texScale: 5, outline: false, shadow: false });
    const at = <T extends THREE.Object3D>(o: T, x: number, z: number, k = 1): T => {
      o.position.set(x, -0.32, z);
      o.rotation.y = rand() * 6;
      o.scale.setScalar(k);
      g.add(o);
      return o;
    };
    // trees behind the room and down both sides
    for (let i = 0; i < 9; i++) at(props.tree({ kind: i % 3 === 1 ? 'pine' : 'round', h: 5.6 + rand() * 1.6, seed: i + 1, color: night(i % 3 === 1 ? P.pine : P.leaf) }), -10.5 + i * 2.7 + (rand() - 0.5), back - 2.2 - rand() * 2.2);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) at(props.tree({ kind: i % 2 ? 'round' : 'pine', h: 4.6 + rand() * 1.6, seed: 20 + i, color: night(i % 2 ? P.leaf : P.pine) }), side * (W + 3.2 + rand() * 2.4), back + 0.5 + i * 2.6);
      for (let i = 0; i < 4; i++) at(props.bush({ r: 0.5 + rand() * 0.25, seed: i + 3, color: night(P.fern), ...(i % 2 ? { flowers: P.rose } : {}) }), side * (W + 1.0 + rand() * 0.8), back + 1 + i * 1.7);
      // in front of the glass, at the bottom corners
      at(props.bush({ r: 0.7, seed: 9, color: night(P.fern), flowers: P.cream }), side * (W + 0.2), front + 1.5);
      at(props.bush({ r: 0.5, seed: 12, color: night(P.moss) }), side * (W - 1.3), front + 1.9);
    }
    for (let i = 0; i < 26; i++) at(props.tuft({ seed: i + 1, color: night(P.grass), ...(i % 4 === 0 ? { flowers: P.cream } : {}) }), -W - 1 + rand() * (W * 2 + 2), front + 0.7 + rand() * 1.6, 1.4);
    const lamp = at(props.gardenLamp({ h: 0.9, lit: true }), -W - 1.9, 0.6, 1.2);
    lamp.rotation.y = 0;
    const flies = props.motes({ n: 22, area: [W * 2 + 8, 1.6, 3], color: '#d8ff9a', size: 0.06, seed: 9 });
    flies.position.set(0, 0, front + 1.6);
    g.add(flies);
    s.add(quiet(g));
  }

  private buildFan(): void {
    const F = KEEP.fan;
    const top = FURNITURE[0]?.top ?? 2.3;
    const g = new THREE.Group();
    const body = { gloss: 0.5 };
    part(g, cyl(0.2, 0.25, 0.08, 22), P.cream, F.x, top + 0.04, F.z, body);
    part(g, cyl(0.035, 0.035, F.y - top - 0.1, 10), P.cream, F.x, (top + F.y) / 2, F.z, body);
    // The head swivels (pivot: yaw) and tips (head: pitch). +z in the head is the way the air goes.
    part(this.fanHead, sphere(0.12, 16), P.cream, 0, 0, -0.15, { sz: 1.2, ...body });
    part(this.fanHead, torus(0.25, 0.02), P.brass, 0, 0, 0.02, { gloss: 0.7 });
    part(this.fanHead, torus(0.16, 0.008), P.brass, 0, 0, 0.065, { gloss: 0.7, outline: false });
    for (let k = 0; k < 4; k++) part(this.fanHead, rbox(0.012, 0.5, 0.012, 0.004), P.brass, 0, 0, 0.06, { rz: (k * Math.PI) / 4, outline: false, gloss: 0.7 });
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3;
      part(this.blades, pill(0.055, 0.12), P.teal, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0, { rz: a + Math.PI / 2, sz: 0.3, gloss: 0.4, outline: false });
    }
    part(this.blades, sphere(0.05, 10), P.cream, 0, 0, 0.02, { outline: false });
    this.blades.position.z = 0.01;
    this.fanHead.add(this.blades);
    this.fanPivot.position.set(F.x, F.y, F.z);
    this.fanPivot.add(this.fanHead);
    g.add(this.fanPivot);
    this.scene.add(g);
  }

  /** The bump of the balloon against the telly's glass. */
  private glint(x: number, y: number): void {
    this.glass.position.set(x, y, KEEP.room.front);
    this.glass.visible = true;
    this.glassMat.opacity = 0.55;
    this.glass.scale.setScalar(0.5);
  }

  /** The balloon was tossed back in: it pops into view. */
  served(): void {
    this.pop = 0;
  }

  private hop(seat: number): void {
    const rig = this.rigs[seat];
    if (!rig) return;
    rig.hop = 0.3;
    rig.c.react('approval', 0.5);
  }

  private syncBalloon(dt: number): void {
    const b = this.room.ball;
    this.pop = Math.min(1, this.pop + dt * 3.5);
    const s = 0.4 + 0.6 * (1 - (1 - this.pop) ** 3);
    const down = b.down > 0;
    this.balloon.position.set(b.x, down ? KEEP.ballR * 0.92 : b.y, b.z);
    this.kick = Math.max(0, this.kick - dt * 5);
    const kick = this.kick * this.kick;
    this.balloon.scale.set(s * (down ? 1.08 : 1) * (1 + kick * 0.16), s * (down ? 0.86 : 1) * (1 - kick * 0.14), s * (down ? 1.08 : 1) * (1 + kick * 0.16));
    // Leans with the breeze and wobbles a little as it drifts.
    this.bobble += dt;
    const [ax, , az] = down ? [0, 0, 0] : airflow(this.room.fan, b.x, b.y, b.z);
    const lean = (v: number) => Math.max(-0.5, Math.min(0.5, v * 0.06));
    const k = 1 - Math.exp(-dt * 6);
    this.balloon.rotation.z += (-lean(ax + b.vx * 2) + Math.sin(this.bobble * 2.1) * 0.05 - this.balloon.rotation.z) * k;
    this.balloon.rotation.x += (lean(az + b.vz * 2) + Math.cos(this.bobble * 1.7) * 0.05 - this.balloon.rotation.x) * k;
    // The shadow lands on whatever is under the balloon.
    let floor = 0.05;
    for (const f of FURNITURE) if (b.x >= f.x0 && b.x <= f.x1 && b.z >= f.z0 && b.z <= f.z1) floor = Math.max(floor, f.top + 0.02);
    const h = Math.max(0, b.y - floor);
    this.shadow.position.set(b.x, floor, b.z);
    this.shadow.scale.setScalar(Math.max(0.45, 1.1 - h * 0.17) * s);
    this.shadowMat.opacity = Math.max(0.08, 0.4 - h * 0.08);
    // Touching the front: a soft ring on the glass.
    if (!down && b.z >= KEEP.room.front - KEEP.ballR - 0.02 && this.glassMat.opacity < 0.2) this.glint(b.x, b.y);
  }

  private syncString(dt: number): void {
    const knot = new THREE.Vector3(0, -KEEP.ballR * 1.12 - 0.06, 0);
    this.balloon.localToWorld(knot);
    const pts = this.stringPts;
    const seg = STRING_LEN / (STRING_POINTS - 1);
    (pts[0] as THREE.Vector3).copy(knot);
    const follow = Math.min(1, dt * 9);
    const target = new THREE.Vector3();
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1] as THREE.Vector3;
      const p = pts[i] as THREE.Vector3;
      target.copy(prev).y -= seg;
      p.lerp(target, follow);
      if (p.y < 0.02) p.y = 0.02;
      const d = p.distanceTo(prev);
      if (d > seg) p.sub(prev).multiplyScalar(seg / d).add(prev);
    }
    const attr = this.string.geometry.getAttribute('position') as THREE.BufferAttribute;
    pts.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
    attr.needsUpdate = true;
  }

  private syncStreaks(dt: number): void {
    const F = KEEP.fan;
    const [dx, dy, dz] = fanDir(this.room.fan);
    const aim = new THREE.Vector3(dx, dy, dz);
    const u = new THREE.Vector3().crossVectors(aim, new THREE.Vector3(0, 1, 0));
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    const v = new THREE.Vector3().crossVectors(u, aim).normalize();
    this.spawn += dt * 52;
    const up = new THREE.Vector3(0, 1, 0);
    for (const st of this.streaks) {
      if (!st.live && this.spawn >= 1) {
        this.spawn -= 1;
        const phi = this.rand() * Math.PI * 2;
        const t = Math.tan(this.rand() * F.cone * 0.85);
        st.dir
          .copy(aim)
          .addScaledVector(u, Math.cos(phi) * t)
          .addScaledVector(v, Math.sin(phi) * t)
          .normalize();
        st.from.set(F.x, F.y, F.z).addScaledVector(aim, 0.12).addScaledVector(u, Math.cos(phi) * 0.15).addScaledVector(v, Math.sin(phi) * 0.15);
        st.s = 0;
        st.speed = 6 + this.rand() * 3;
        st.len = 0.35 + this.rand() * 0.45;
        st.max = 4.5 + this.rand() * 3;
        st.live = true;
        st.mesh.quaternion.setFromUnitVectors(up, st.dir);
      }
      if (!st.live) continue;
      st.s += st.speed * dt;
      const head = st.from.clone().addScaledVector(st.dir, st.s);
      const out = Math.abs(head.x) > KEEP.room.x || head.z > KEEP.room.front + 0.3 || head.y < 0.05 || head.y > KEEP.room.ceiling;
      if (st.s >= st.max || out) {
        st.live = false;
        st.mesh.visible = false;
        continue;
      }
      const len = Math.min(st.len, st.s);
      st.mesh.visible = true;
      st.mesh.position.copy(st.from).addScaledVector(st.dir, st.s - len / 2);
      st.mesh.scale.set(1, len, 1);
      const k = st.s / st.max;
      st.mat.opacity = 0.42 * Math.min(1, st.s / 0.6) * (1 - k * k);
    }
    this.spawn = Math.min(this.spawn, 3);
  }

  /** Puts everyone where the rules say they are. */
  sync(dt: number): void {
    const r = this.room;
    const follow = 1 - Math.exp(-dt * 12);
    for (const a of r.runners) {
      const rig = this.rigs[a.seat];
      if (!rig) continue;
      rig.hop = Math.max(0, rig.hop - dt);
      const lift = rig.hop > 0 ? Math.sin(Math.PI * (1 - rig.hop / 0.3)) * 0.22 : 0;
      const root = rig.c.root;
      root.position.set(a.x, lift, a.z);
      rig.marker.position.set(a.x, 0.03, a.z);
      const speed = Math.hypot(a.vx, a.vz);
      const b = r.ball;
      const target = speed > 0.4 ? a.face : Math.atan2(b.x - a.x, b.z - a.z);
      root.rotation.y += Math.atan2(Math.sin(target - root.rotation.y), Math.cos(target - root.rotation.y)) * follow;
      const motion = speed < 0.4 ? null : speed > 2.6 ? 'run' : 'walk';
      if (motion !== rig.motion) {
        rig.motion = motion;
        rig.c.move(motion, speed);
      }
      // The ring under a player lights up while the balloon is within reach.
      const reach = inReach(r, a);
      if (reach !== rig.reach) {
        rig.reach = reach;
        rig.marker.material = material(this.colors[a.seat] ?? '#ffffff', { glow: reach ? 1.7 : 1.0 });
        rig.marker.scale.setScalar(reach ? 1.18 : 1);
      }
      const mood: CompanionMood = b.down > 0 ? 'sad' : b.y < 1.2 ? 'approval' : 'listening';
      if (mood !== rig.mood) {
        rig.mood = mood;
        rig.c.setBase(mood);
      }
    }
    this.fanPivot.rotation.y = r.fan.yaw;
    this.fanHead.rotation.x = -r.fan.pitch;
  }

  /** At the end everyone turns to the audience. */
  settle(): void {
    for (const rig of this.rigs) {
      if (!rig) continue;
      rig.c.move(null);
      rig.motion = null;
      rig.hop = 0;
      rig.c.root.rotation.set(0, 0, 0);
      rig.c.root.position.y = 0;
    }
  }

  setBase(seat: number, mood: CompanionMood): void {
    const rig = this.rigs[seat];
    if (rig) {
      rig.mood = mood;
      rig.c.setBase(mood);
    }
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks());
    this.tick(dt, time);
    for (const r of this.rigs) r?.c.update(dt);
    this.fanKeeper?.update(dt);
    this.blades.rotation.z -= dt * 26;
    this.syncBalloon(dt);
    this.syncString(dt);
    this.syncStreaks(dt);
    if (this.glass.visible) {
      this.glassMat.opacity = Math.max(0, this.glassMat.opacity - dt * 1.4);
      this.glass.scale.setScalar(this.glass.scale.x + dt * 0.9);
      if (this.glassMat.opacity <= 0) this.glass.visible = false;
    }
    // The cat breathes, and now and then a little z drifts up.
    this.cat.scale.y = 1 + Math.sin(time * 1.6) * 0.04;
    this.catNap += dt;
    if (this.catNap > this.catZ) {
      this.catNap = 0;
      this.catZ = 2.5 + this.rand() * 2;
      this.floaters.add('z', '#cfd8ff', this.cat.position.clone().add(new THREE.Vector3(0.25, 0.35, 0)), 0.22, 1.8);
    }
    this.floaters.update(dt);
  }

  private marks(): Mark[] {
    const { x: W, back, front, ceiling } = KEEP.room;
    return [
      { p: new THREE.Vector3(-W, 0, back) },
      { p: new THREE.Vector3(W, 0, back) },
      { p: new THREE.Vector3(-W, 0, front) },
      { p: new THREE.Vector3(W, 0, front) },
      { p: new THREE.Vector3(0, (FURNITURE[0]?.top ?? 2.3) + FAN_HEIGHT + 0.45, back + 0.3), pad: 0.05 },
      { p: new THREE.Vector3(-W + KEEP.ballR, ceiling - KEEP.ballR, front - KEEP.ballR), pad: 0.04 },
      { p: new THREE.Vector3(W - KEEP.ballR, ceiling - KEEP.ballR, front - KEEP.ballR), pad: 0.04 },
    ];
  }

  dispose(): void {
    for (const r of this.rigs) r?.c.dispose();
    this.fanKeeper?.dispose();
    this.floaters.dispose();
    for (const o of this.own) o.dispose();
  }

  // ------------------------------------------------------------------ moments

  bop(seat: number, color: string): void {
    const a = this.room.runners.find((r) => r.seat === seat);
    if (a) this.floaters.add('Bop!', color, new THREE.Vector3(a.x, HEIGHT + 0.5, a.z), 0.4, 0.8);
    this.hop(seat);
    this.kick = 1;
  }

  floorBump(n: number, color: string): void {
    const b = this.room.ball;
    this.floaters.add(`Bump! ${n} of ${KEEP.maxTouches}`, color, new THREE.Vector3(b.x, 0.9, b.z), 0.5, 1.4);
  }
}

export const minigame: Minigame = {
  id: 'keepitup',
  title: 'Keep It Up',
  how: 'Three of you keep the balloon in the air: run under it and Bop! it back up. The fourth tilts the desk fan to blow it down. Three bumps on the floor and the fan wins.',
  controller: 'stick',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const fanPos = teams[0]?.[0] ?? 0;
    const three = seats.map((_, p) => p).filter((p) => p !== fanPos);
    const room = newRoom(fanPos, three, rng);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const posOf = new Map(seats.map((s, p) => [s.index, p] as const));
    const cpu = (p: number) => session.isCpu(seatOf(p));

    const companions = await Promise.all(seats.map((s, p) => buildCompanion(s.look, { height: p === fanPos ? FAN_HEIGHT : HEIGHT })));
    const view = new LivingRoom(seats, companions, fanPos, room);
    ctx.stage.setView(view);

    // Computer players think with their own sharpness.
    const brains = new Map<number, Brain>();
    for (const p of seats.keys()) if (cpu(p)) brains.set(p, newBrain(ctx.skill(), rng));
    const sticks = new Map<number, Stick>(three.map((p) => [p, { x: 0, y: 0, a: false }]));
    const latch = new Map<number, boolean>();
    let tilt: Tilt = { x: 0, y: 0 };

    const fanName = seats[fanPos]?.name ?? 'The fan';
    const fanColor = seats[fanPos]?.color ?? '#ffffff';
    session.setLayoutAll((seat) =>
      posOf.get(seat.index) === fanPos ? { kind: 'tilt', title: 'You’re the fan', icon: '🌀', note: 'Tilt to swing the fan. Blow the balloon down to the floor three times.' } : { kind: 'stick', button: 'Bop!', note: `You’re on balloon duty! Run under it and Bop! it back up. ${fanName} is on the fan.` },
    );
    const tellFan = (good: boolean, text: string) => session.send(seatOf(fanPos), { t: 'feedback', good, text });
    // The tilt screen has no note of its own: the fan's job comes as a few short toasts.
    const fanTips = ['You’re the fan! Tilt to aim the breeze.', 'Blow the balloon down: three bumps wins.', 'Tip forward to aim low, side to side to swivel.'];
    let tipAt = 0;

    const off = session.onInput((seat, msg) => {
      const p = posOf.get(seat);
      if (p === undefined || cpu(p)) return;
      if (p === fanPos) {
        if (msg.t === 'tilt') tilt = { x: msg.x, y: msg.y };
        return;
      }
      const s = sticks.get(p);
      if (msg.t !== 'stick' || !s) return;
      // A quick tap can go down and up between two frames: remember it.
      if (msg.a && !s.a) latch.set(p, true);
      sticks.set(p, { x: msg.x, y: msg.y, a: msg.a });
    });

    ui.caption(`${fanName} is on the fan. Everyone else: keep that balloon up!`, fanColor);
    let hudAt = -1;
    let bounceAt = -1;
    await everyFrame(clock, (dt, t) => {
      if (fanTips.length && t >= tipAt) {
        tellFan(true, fanTips.shift() as string);
        tipAt = t + 2.1;
      }
      const fanBrain = brains.get(fanPos);
      const aim = fanBrain ? cpuTilt(room, fanBrain, rng) : tilt;
      const now = room.runners.map((a, k) => {
        const brain = brains.get(a.seat);
        const s = brain ? cpuStick(room, k, brain, rng) : (sticks.get(a.seat) ?? { x: 0, y: 0, a: false });
        if (brain && s.a) latch.set(a.seat, true);
        return { x: s.x, y: s.y, a: s.a || (latch.get(a.seat) ?? false) };
      });
      const ev = advance(room, now, aim, dt);
      // Presses only count once the physics has stepped with them.
      if (ev.steps > 0) latch.clear();

      for (const seat of ev.bops) {
        const color = seats[seat]?.color ?? '#ffffff';
        view.bop(seat, color);
        tone(sfx, { freq: 300 + rng() * 60, to: 540, dur: 0.12, type: 'triangle', gain: 0.12 });
        session.send(seatOf(seat), { t: 'buzz', pattern: [15] });
      }
      if (ev.whiffs.length) noise(sfx, { dur: 0.09, filter: 'bandpass', freq: 1600, to: 800, gain: 0.06 });
      if (ev.bounce > 0.8 && t - bounceAt > 0.15) {
        bounceAt = t;
        tone(sfx, { freq: 620, to: 500, dur: 0.08, gain: 0.04 });
      }
      if (ev.touch !== null) {
        const n = ev.touch;
        view.floorBump(n, fanColor);
        noise(sfx, { dur: 0.25, filter: 'lowpass', freq: 320, to: 90, gain: 0.35 });
        tone(sfx, { freq: 190, to: 120, dur: 0.22, gain: 0.1 });
        view.fanKeeper?.react('happy', 1.2);
        if (n < KEEP.maxTouches) {
          ui.caption(`Bump! ${n} of ${KEEP.maxTouches}. Keep it up!`, fanColor);
          tellFan(true, `Bump! ${n} of ${KEEP.maxTouches}`);
          for (const p of three) session.send(seatOf(p), { t: 'feedback', good: false, text: `Bump ${n} of ${KEEP.maxTouches}. Keep it up!` });
        }
        session.send(seatOf(fanPos), { t: 'buzz', pattern: [40, 30, 40] });
        for (const p of three) session.send(seatOf(p), { t: 'buzz', pattern: [90] });
      }
      if (ev.served) {
        view.served();
        sfx.whoosh();
      }
      view.sync(dt);

      if (t - hudAt > 0.1) {
        hudAt = t;
        ui.timer(KEEP.duration - room.time);
        ui.live(
          seats.map((s, p) => {
            const a = room.runners.find((r) => r.seat === p);
            const value = p === fanPos ? `Fan · ${room.touches}/${KEEP.maxTouches} bumps` : `${a?.bops ?? 0} bop${a?.bops === 1 ? '' : 's'}`;
            return { name: s.name, color: s.color, thumb: s.thumb, value };
          }),
        );
      }
      return isOver(room);
    });
    off();
    ui.timer(null);

    const up = threeWin(room);
    view.settle();
    if (up) {
      sfx.fanfare();
      const n = room.touches;
      ui.caption(n === 0 ? 'Kept it up! Not a single bump.' : `Kept it up! Only ${n} bump${n === 1 ? '' : 's'}.`);
      for (const p of three) view.setBase(p, 'happy');
      view.fanKeeper?.setBase('sad');
    } else {
      sfx.win();
      ui.caption(`${fanName} blew it down! Three bumps.`, fanColor);
      for (const p of three) view.setBase(p, 'sad');
      view.fanKeeper?.setBase('happy');
    }
    for (const p of seats.keys()) session.send(seatOf(p), { t: 'buzz', pattern: [40, 30, 120] });
    await clock.wait(2);
    ui.caption(null);

    return {
      scores: keepScores(room, seats.length),
      details: seats.map((_, p) => {
        const n = room.touches;
        if (p === fanPos) return up ? `Fan · ${n} bump${n === 1 ? '' : 's'}` : `Fan · blew it down in ${room.time.toFixed(1)} s`;
        const a = room.runners.find((r) => r.seat === p);
        const bops = a?.bops ?? 0;
        return `${bops} bop${bops === 1 ? '' : 's'} · ${up ? 'kept it up' : 'it hit the floor'}`;
      }),
    };
  },
};
