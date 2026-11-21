// Top Bunk on the TV: a sleepover bedroom long after lights-out. The bunk bed stands against the back wall with
// one player up top beside a stack of pillows; the other three scramble about the rug below, three cushions
// each floating over their heads. Seen from the doorway, a little from above.
import * as THREE from 'three';
import {
  BUNK,
  type Aim,
  type Kid,
  type KidBrain,
  type Pillow,
  type Room,
  type Stick,
  aimPoint,
  bunkScores,
  cpuKid,
  cpuTop,
  isOver,
  kidOf,
  newKidBrain,
  newRoom,
  newTopBrain,
  pillowPos,
  stepRoom,
  topWins,
} from '../../../game/minigames/topbunk';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Env, bedroom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, cone, cyl, mix, nameCard, part, pill, rbox, seeded, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.2; // companions on the floor
const TOP_HEIGHT = 1.1; // the one up on the bunk
const BUNK_X = 0;
const BUNK_Z = -2.6;
const BUNK_W = 3.4;
const BUNK_D = 1.6;
const UPPER = 2.2; // top of the upper mattress
const TOP_SPOT = new THREE.Vector3(0.25, UPPER, -2.45);
const BEANBAG = new THREE.Vector3(4.1, 0, -2.15); // in the back corner, beside the bunk
const FLOP_SPOTS: readonly [number, number, number][] = [
  [-0.45, 0.78, 0.05],
  [0.45, 0.8, -0.1],
  [0, 0.92, 0.35],
];
const PILLOW_COLORS = [P.cream, P.moon, P.rose, P.sage, P.mustard, P.mauve];
const ROOM = 1.45; // the room is built at life size and scaled up: the bunk is big next to the companions
const RELOAD_STEPS = 16; // the reload arc fills in this many steps (each a cached geometry)
const MAX_LYING = 12; // pillows left lying on the floor

interface Rig {
  c: Companion;
  marker: THREE.Mesh;
  cushions: THREE.Mesh[];
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
  squash: number;
  flopped: boolean;
  /** Seconds into the flop onto the bean bag. */
  flop: number;
  from: THREE.Vector3;
  spot: THREE.Vector3;
}

/** A fluffy pillow: a soft slab with a puffier middle, piping round the seam and little corner tufts. */
function pillowMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  const cloth = { tex: 'fabric' as const, texStrength: 0.6, texScale: 0.5 };
  withOutline(0.022, () => {
    part(g, rbox(0.64, 0.17, 0.44, 0.08), color, 0, 0, 0, cloth);
    part(g, sphere(0.3, 14), mix(color, P.cream, 0.35), 0, 0.01, 0, { sy: 0.42, sz: 0.68, outline: false, ...cloth });
    part(g, rbox(0.66, 0.03, 0.46, 0.012), mix(color, P.ink, 0.22), 0, 0, 0, { outline: false });
    for (const [x, z] of [
      [-0.32, -0.22],
      [0.32, -0.22],
      [-0.32, 0.22],
      [0.32, 0.22],
    ] as const) {
      part(g, ball(0.045, 1), mix(color, P.ink, 0.18), x, 0, z, { outline: false });
    }
  });
  return g;
}

class BedroomView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly rigs: Rig[] = [];
  readonly topRig: Companion;
  readonly floaters: Floaters;
  private readonly fit: CameraFit;
  private readonly marks: Mark[];
  private readonly topColor: string;
  private readonly card: THREE.Sprite;
  private readonly reticle = new THREE.Group();
  private readonly reloadArc: THREE.Mesh;
  private reloadStep = -1;
  private readonly flying = new Map<number, { mesh: THREE.Group; ring: THREE.Mesh; spin: THREE.Vector3 }>();
  private readonly lying: THREE.Group[] = [];
  private env!: Env;
  private tick: (dt: number, time: number) => void = () => undefined;
  private lamp!: THREE.PointLight;
  private feathers: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private readonly settling: { g: THREE.Group; age: number }[] = [];
  private readonly lava: THREE.Mesh[] = [];
  private readonly stack: THREE.Group[] = [];
  private lean = 0;
  private turn = 0;
  private colorIndex = 0;

  constructor(seats: MinigameSeat[], companions: Companion[], room: Room) {
    this.floaters = new Floaters(this.scene);
    this.buildRoom();

    this.topColor = seats[room.top]?.color ?? '#ffffff';
    this.topRig = companions[room.top] as Companion;
    this.topRig.root.position.copy(TOP_SPOT);
    this.topRig.setBase('listening');
    this.scene.add(this.topRig.root);
    this.card = nameCard('Top bunk', this.topColor, 0.8);
    this.card.position.set(TOP_SPOT.x, UPPER + TOP_HEIGHT + 0.35, TOP_SPOT.z);
    this.scene.add(this.card);

    seats.forEach((s, i) => {
      if (i === room.top) return;
      const c = companions[i] as Companion;
      this.scene.add(c.root);
      c.setBase('thinking');
      const marker = part(this.scene, torus(0.46, 0.045), s.color, 0, 0.06, 0, { rx: Math.PI / 2, glow: 1.1, outline: false, shadow: false });
      const cushions = Array.from({ length: BUNK.lives }, () => part(this.scene, rbox(0.2, 0.08, 0.16, 0.035), s.color, 0, 0, 0, { outline: 0.02, glow: 0.35 }));
      this.rigs[i] = { c, marker, cushions, motion: null, mood: null, squash: 1, flopped: false, flop: -1, from: new THREE.Vector3(), spot: new THREE.Vector3() };
    });

    // The top bunk's aim: a ring on the floor, with an arc that fills as the next pillow is ready.
    part(this.reticle, torus(0.38, 0.035), this.topColor, 0, 0, 0, { rx: Math.PI / 2, glow: 1.4, outline: false, shadow: false });
    part(this.reticle, ball(0.06, 1), this.topColor, 0, 0, 0, { glow: 1.4, outline: false, shadow: false });
    this.reloadArc = part(this.reticle, torus(0.55, 0.03), this.topColor, 0, 0, 0, { rx: -Math.PI / 2, glow: 0.9, outline: false, shadow: false });
    this.reticle.position.set(room.aim.x, 0.08, room.aim.z);
    this.scene.add(this.reticle);

    // Everything that has to stay in the picture: the floor with heads and cushions over it, the bunk, the bean bag.
    const f = BUNK.floor;
    this.marks = [
      ...[-f.x, f.x].flatMap((x) => [
        { p: new THREE.Vector3(x, 0, f.back), pad: 0.05 },
        { p: new THREE.Vector3(x, 0, f.front + 0.4), pad: 0.05 },
        { p: new THREE.Vector3(x, HEIGHT + 0.5, f.back), pad: 0.06 },
      ]),
      { p: new THREE.Vector3(TOP_SPOT.x, UPPER + TOP_HEIGHT + 0.4, TOP_SPOT.z), pad: 0.1 },
      { p: new THREE.Vector3(BUNK_X - BUNK_W / 2, 3, BUNK_Z), pad: 0.03 },
      { p: new THREE.Vector3(BEANBAG.x + 1.4, 1.9, BEANBAG.z), pad: 0.04 },
    ];
    this.fit = new CameraFit(this.camera, 0.62);
  }

  private buildRoom(): void {
    const s = this.scene;
    const rand = seeded(42);
    // A bedroom long after lights-out: moonlight, fairy lights, one lava lamp still on.
    this.env = bedroom(s, { mood: 'night', w: 11.6, d: 5.1, h: 3.4, bed: false, wall: mix(P.denim, P.duskWall, 0.4) });
    this.env.root.getObjectByName('rug')?.removeFromParent();
    this.env.root.scale.setScalar(ROOM);
    this.env.sun.intensity *= 1.25;
    const set = new THREE.Group();
    s.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = ROOM) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    // A big oval rug to scramble about on.
    const rug = props.rug({ round: true, w: 9.6, color: mix(P.denim, P.mauve, 0.3), border: mix(P.mustard, P.cream, 0.3), tex: 'terry' });
    rug.position.set(0, 0, 1.5);
    rug.scale.set(1, 1, 0.56);
    set.add(rug);

    // The bunk bed: posts, two bunks, a rail up top, a ladder at the right end.
    const wood = P.oak;
    const grain = { tex: 'wood' as const, texScale: 1.2 };
    const sheet = { tex: 'fabric' as const, texStrength: 0.5 };
    withOutline(0.03, () => {
      for (const x of [-BUNK_W / 2 + 0.08, BUNK_W / 2 - 0.08]) {
        for (const z of [BUNK_Z - BUNK_D / 2 + 0.08, BUNK_Z + BUNK_D / 2 - 0.08]) {
          part(s, rbox(0.16, 2.95, 0.16, 0.05), wood, BUNK_X + x, 1.475, z, grain);
          part(s, sphere(0.1, 10), mix(wood, P.walnut, 0.4), BUNK_X + x, 2.98, z, { outline: false, gloss: 0.3 });
        }
      }
      for (const y of [0.42, UPPER - 0.3]) part(s, rbox(BUNK_W, 0.22, BUNK_D, 0.05), mix(wood, P.walnut, 0.25), BUNK_X, y, BUNK_Z, grain);
      // head and foot boards
      for (const x of [-BUNK_W / 2 + 0.08, BUNK_W / 2 - 0.08]) {
        for (const y of [0.95, UPPER + 0.28]) part(s, rbox(0.08, 0.5, BUNK_D - 0.2, 0.03), wood, BUNK_X + x, y, BUNK_Z, grain);
      }
      part(s, rbox(BUNK_W - 0.24, 0.24, BUNK_D - 0.2, 0.1), P.cream, BUNK_X, 0.65, BUNK_Z, sheet);
      part(s, rbox(BUNK_W - 0.24, 0.24, BUNK_D - 0.2, 0.1), P.cream, BUNK_X, UPPER - 0.08, BUNK_Z, sheet);
      // A rumpled duvet and a pillow on the empty lower bunk, a patchwork one up top.
      part(s, rbox(2.0, 0.16, BUNK_D - 0.26, 0.08), P.teal, BUNK_X + 0.5, 0.82, BUNK_Z, { rz: 0.03, tex: 'knit' });
      part(s, rbox(0.5, 0.05, BUNK_D - 0.2, 0.02), mix(P.teal, P.cream, 0.5), BUNK_X - 0.3, 0.86, BUNK_Z, { rz: 0.05, tex: 'knit', outline: false });
      part(s, rbox(1.4, 0.12, BUNK_D - 0.3, 0.06), P.mustard, BUNK_X + 0.9, UPPER + 0.05, BUNK_Z, { tex: 'knit' });
      part(s, rbox(0.3, 0.125, BUNK_D - 0.3, 0.06), P.terracotta, BUNK_X + 0.55, UPPER + 0.052, BUNK_Z, { tex: 'knit', outline: false });
      part(s, rbox(BUNK_W - 0.5, 0.09, 0.09, 0.04), wood, BUNK_X - 0.1, UPPER + 0.32, BUNK_Z + BUNK_D / 2 - 0.08, grain);
      for (const x of [-1.0, 0.9]) part(s, rbox(0.08, 0.34, 0.08, 0.03), wood, BUNK_X + x, UPPER + 0.15, BUNK_Z + BUNK_D / 2 - 0.08, grain);
      const lx = BUNK_X + BUNK_W / 2 + 0.25;
      for (const dz of [-0.35, 0.35]) part(s, rbox(0.08, 2.6, 0.08, 0.03), wood, lx, 1.3, BUNK_Z + 0.35 + dz, grain);
      for (let r = 0; r < 4; r++) part(s, cyl(0.04, 0.04, 0.7, 8), mix(wood, P.walnut, 0.25), lx, 0.45 + r * 0.55, BUNK_Z + 0.35, { rx: Math.PI / 2 });
    });
    const lower = pillowMesh(P.sage);
    lower.position.set(BUNK_X - 1.15, 0.86, BUNK_Z);
    lower.rotation.y = Math.PI / 2 + 0.15;
    lower.scale.setScalar(1.5);
    s.add(lower);
    // Fairy lights wound along the top rail.
    put(props.stringLights(new THREE.Vector3(-BUNK_W / 2 + 0.1, 3.02, BUNK_Z + BUNK_D / 2), new THREE.Vector3(BUNK_W / 2 - 0.1, 3.02, BUNK_Z + BUNK_D / 2), { sag: 0.14, count: 9, bulb: 0.04 }), 0, 0, 0, 0, 1);
    // The pillow stack beside the top bunk.
    for (let k = 0; k < 4; k++) {
      const pl = pillowMesh(PILLOW_COLORS[k % PILLOW_COLORS.length] as string);
      pl.position.set(BUNK_X - 1.05 + (rand() - 0.5) * 0.08, UPPER + 0.06 + k * 0.19, BUNK_Z + 0.05);
      pl.rotation.y = (rand() - 0.5) * 0.4;
      s.add(pl);
      this.stack.push(pl);
    }

    // A nightstand with a lava lamp beside the bunk (the room's one warm light).
    withOutline(0.03, () => {
      part(s, rbox(0.9, 0.8, 0.7, 0.05), P.walnut, -2.65, 0.4, -2.7, grain);
      part(s, rbox(0.74, 0.26, 0.04, 0.02), mix(P.walnut, P.oak, 0.3), -2.65, 0.56, -2.34, { ...grain, outline: false });
      part(s, sphere(0.04, 8), P.brass, -2.65, 0.56, -2.31, { outline: false, gloss: 0.7 });
      part(s, cyl(0.16, 0.22, 0.18, 16), P.charcoal, -2.65, 0.89, -2.7, { gloss: 0.5 });
      part(s, cyl(0.12, 0.16, 0.08, 16), P.charcoal, -2.65, 1.48, -2.7, { gloss: 0.5 });
    });
    this.lava.push(part(s, pill(0.12, 0.34), P.rose, -2.65, 1.2, -2.7, { glow: 1.1, opacity: 0.85, outline: false }));
    for (let k = 0; k < 3; k++) this.lava.push(part(s, sphere(0.05, 10), P.lamp, -2.65, 1.1 + k * 0.12, -2.7, { glow: 2, outline: false, shadow: false }));
    this.lamp = new THREE.PointLight('#ffb48a', 26, 15, 1.5);
    this.lamp.position.set(-2.6, 1.6, -2.0);
    s.add(this.lamp);
    put(props.books(0.5, 4, { h: 0.2 }), -3.0, 0.8, -2.85, 0, 1.3);

    // Along the walls: a low bookcase of toys and books, a plant, a poster.
    put(props.bookshelf({ w: 1.5, h: 1.3, shelves: 3, seed: 9 }), -5.6, 0, -3.35);
    put(props.plant({ kind: 'trailing', h: 0.35, seed: 3 }), -6.2, 1.3 * ROOM, -3.3);
    put(props.tableLamp({ lit: false, stand: P.mustard }), -5.1, 1.3 * ROOM, -3.3);
    put(props.pictureFrame({ w: 0.8, h: 1.1, art: 'shapes', frame: P.charcoal, seed: 6 }), -3.9, 3.3, -3.68);
    put(props.pictureFrame({ w: 0.6, h: 0.45, art: 'hills', frame: P.oak, seed: 2 }), -6.0, 3.1, -3.68);
    // On the floor: a sleeping bag, comics, a torch left on, a pouf up front.
    part(set, pill(0.32, 1.4), P.teal, -5.6, 0.32, 0.6, { rz: Math.PI / 2, ry: 0.4, tex: 'fabric' });
    part(set, cyl(0.3, 0.3, 0.6, 18), mix(P.teal, P.ink, 0.25), -6.2, 0.32, 0.86, { rz: Math.PI / 2, ry: 0.4, tex: 'fabric' });
    part(set, sphere(0.2, 12), P.cream, -4.75, 0.22, 0.25, { sy: 0.5, tex: 'fabric', outline: false });
    [P.mustard, P.terracotta, P.sage, P.denim].forEach((c, k) => part(set, rbox(0.5, 0.04, 0.68, 0.02), c, -5.2 + rand() * 0.1, 0.03 + k * 0.045, 3.2, { ry: (rand() - 0.5) * 0.6, outline: 0.015 }));
    part(set, cyl(0.07, 0.07, 0.36, 12), P.terracotta, 3.4, 0.07, 3.9, { rz: Math.PI / 2, ry: 1.1, gloss: 0.4 });
    part(set, cone(0.09, 0.12, 12), P.lamp, 3.27, 0.07, 3.98, { rz: Math.PI / 2, ry: 1.1, glow: 2 });
    part(set, cyl(0.7, 0.7, 0.01, 24), P.lamp, 2.75, 0.03, 4.3, { sz: 0.55, opacity: 0.22, glow: 0.8, outline: false, shadow: false });
    put(props.pouf({ color: P.mustard, r: 0.4 }), -7.3, 0, 3.6, 0, ROOM);

    // The bean bag, where you flop when you're out of cushions.
    put(props.beanbag({ color: P.mauve, r: 0.6 }), BEANBAG.x, 0, BEANBAG.z, -0.2, 1.75);
    this.tick = props.tickProps(set);
  }

  /** A pillow leaves the top bunk: it tumbles through the air, a ring on the floor shows where it comes down. */
  throwPillow(p: Pillow): void {
    const color = PILLOW_COLORS[this.colorIndex++ % PILLOW_COLORS.length] as string;
    const mesh = pillowMesh(color);
    this.scene.add(mesh);
    const ring = part(this.scene, torus(BUNK.hitR, 0.05), this.topColor, p.tx, 0.04, p.tz, { rx: Math.PI / 2, opacity: 0.55, outline: false, shadow: false });
    this.flying.set(p.id, { mesh, ring, spin: new THREE.Vector3(5 + Math.random() * 3, 0, (Math.random() - 0.5) * 4) });
    this.lean = 0.35;
    this.turn = Math.max(-0.8, Math.min(0.8, Math.atan2(p.tx - TOP_SPOT.x, p.tz - TOP_SPOT.z)));
    // The top pillow of the stack bobs, as if it was just grabbed.
    const top = this.stack[this.stack.length - 1];
    if (top) top.scale.setScalar(0.6);
  }

  /** A pillow comes down: it stays lying where it landed. */
  land(p: Pillow): void {
    const f = this.flying.get(p.id);
    if (!f) return;
    this.flying.delete(p.id);
    this.scene.remove(f.ring);
    f.mesh.position.set(p.tx, 0.11, p.tz);
    f.mesh.rotation.set(0, Math.random() * Math.PI, 0);
    this.lying.push(f.mesh);
    // It squashes as it lands, and a few feathers puff out.
    this.settling.push({ g: f.mesh, age: 0 });
    for (let k = 0; k < 7; k++) {
      const a = Math.random() * Math.PI * 2;
      const m = part(this.scene, sphere(0.035, 6), P.cream, p.tx, 0.2, p.tz, { sx: 1.8, sy: 0.35, outline: false, shadow: false });
      this.feathers.push({ m, v: new THREE.Vector3(Math.cos(a) * (0.8 + Math.random()), 1.4 + Math.random() * 1.2, Math.sin(a) * (0.8 + Math.random())), age: 0 });
    }
    if (this.lying.length > MAX_LYING) this.lying.shift()?.removeFromParent();
  }

  /** Someone ran out of cushions: they hop over and flop onto the bean bag. */
  flop(i: number, order: number): void {
    const rig = this.rigs[i];
    if (!rig || rig.flopped) return;
    rig.flopped = true;
    rig.flop = 0;
    rig.from.copy(rig.c.root.position);
    const [x, y, z] = FLOP_SPOTS[order % FLOP_SPOTS.length] ?? [0, 0.8, 0];
    rig.spot.set(BEANBAG.x + x, y, BEANBAG.z + z);
    rig.marker.visible = false;
    for (const m of rig.cushions) m.visible = false;
    rig.c.move(null);
    rig.motion = null;
    rig.c.setBase('sleeping');
  }

  /** Puts everyone where the rules say they are. */
  sync(r: Room, dt: number, time: number): void {
    const follow = 1 - Math.exp(-dt * 12);
    for (const k of r.kids) this.syncKid(k, dt, time, follow);
    const goal = r.aim;
    const k = 1 - Math.exp(-dt * 22);
    this.reticle.position.x += (goal.x - this.reticle.position.x) * k;
    this.reticle.position.z += (goal.z - this.reticle.position.z) * k;
    const step = r.reload <= 0 ? RELOAD_STEPS : Math.floor((1 - r.reload / BUNK.reload) * RELOAD_STEPS);
    if (step !== this.reloadStep) {
      this.reloadStep = step;
      this.reloadArc.visible = step > 0;
      if (step > 0) this.reloadArc.geometry = torus(0.55, 0.04, (step / RELOAD_STEPS) * Math.PI * 2);
    }
    this.reticle.scale.setScalar(r.reload <= 0 ? 1 + Math.sin(time * 6) * 0.06 : 0.9);
    for (const p of r.pillows) {
      const f = this.flying.get(p.id);
      if (!f) continue;
      const at = pillowPos(p);
      f.mesh.position.set(at.x, at.y, at.z);
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      f.ring.scale.setScalar(1.35 - 0.35 * at.s);
    }
  }

  private syncKid(k: Kid, dt: number, time: number, follow: number): void {
    const rig = this.rigs[k.seat];
    if (!rig || rig.flopped) return;
    const root = rig.c.root;
    root.position.set(k.x, 0, k.z);
    rig.marker.position.set(k.x, 0.03, k.z);
    const speed = Math.hypot(k.vx, k.vz);
    const target = speed > 0.4 ? k.face : 0;
    root.rotation.y += Math.atan2(Math.sin(target - root.rotation.y), Math.cos(target - root.rotation.y)) * follow;
    const motion = k.duck > 0 || speed < 0.4 ? null : speed > 2.4 ? 'run' : 'walk';
    if (motion !== rig.motion) {
      rig.motion = motion;
      rig.c.move(motion, speed);
    }
    const mood: CompanionMood = k.duck > 0 ? 'working' : k.lives === 1 ? 'listening' : 'thinking';
    if (mood !== rig.mood) {
      rig.mood = mood;
      rig.c.setBase(mood);
    }
    // Curled up small while ducking.
    rig.squash += ((k.duck > 0 ? 0.52 : 1) - rig.squash) * (1 - Math.exp(-dt * 25));
    root.scale.set(1 + (1 - rig.squash) * 0.3, rig.squash, 1 + (1 - rig.squash) * 0.3);
    // Blinking for a moment after a bonk.
    root.visible = k.safe <= 0 || Math.sin(time * 38) > -0.4;
    rig.cushions.forEach((m, n) => {
      m.visible = n < k.lives;
      m.position.set(k.x + (n - (BUNK.lives - 1) / 2) * 0.26, HEIGHT * rig.squash + 0.32 + Math.sin(time * 3 + n) * 0.03, k.z);
    });
  }

  dispose(): void {
    this.card.material.map?.dispose();
    this.card.material.dispose();
    this.topRig.dispose();
    for (const r of this.rigs) r?.c.dispose();
    for (const f of this.feathers) f.m.removeFromParent();
    this.floaters.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    this.topRig.update(dt);
    for (const r of this.rigs) {
      if (!r) continue;
      r.c.update(dt);
      if (r.flopped && r.flop >= 0 && r.flop < 1) {
        r.flop = Math.min(1, r.flop + dt / 0.7);
        const t = r.flop;
        r.c.root.position.lerpVectors(r.from, r.spot, t);
        r.c.root.position.y += Math.sin(t * Math.PI) * 1.4;
        r.c.root.rotation.set(-0.9 * t, Math.PI * 0.15 * t, 0);
        r.c.root.scale.setScalar(1);
        r.c.root.visible = true;
      }
    }
    this.lean *= Math.exp(-dt * 6);
    this.turn *= Math.exp(-dt * 1.5);
    this.topRig.root.rotation.set(this.lean, this.turn, 0);
    const top = this.stack[this.stack.length - 1];
    if (top) top.scale.setScalar(Math.min(1, top.scale.x + dt * 1.5));
    this.env.update(dt, time);
    this.tick(dt, time);
    this.lamp.intensity = 26 * (1 + Math.sin(time * 0.9) * 0.05);
    for (let i = this.settling.length - 1; i >= 0; i--) {
      const st = this.settling[i] as { g: THREE.Group; age: number };
      st.age += dt;
      const k = Math.min(1, st.age / 0.3);
      const squash = 1 - Math.sin(k * Math.PI) * 0.35 * (1 - k * 0.5);
      st.g.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);
      if (k >= 1) this.settling.splice(i, 1);
    }
    this.feathers = this.feathers.filter((f) => {
      f.age += dt;
      f.v.y -= dt * 2.6;
      f.v.multiplyScalar(Math.exp(-dt * 2));
      f.m.position.addScaledVector(f.v, dt);
      f.m.rotation.z += dt * 5;
      f.m.rotation.x += dt * 3;
      if (f.age < 1.1 && f.m.position.y > 0.04) return true;
      f.m.removeFromParent();
      return false;
    });
    this.lava.forEach((m, i) => {
      if (i > 0) m.position.y = 1.08 + ((time * 0.12 + i * 0.33) % 1) * 0.36;
    });
    this.floaters.update(dt);
  }
}

/** A soft "fwump" (a pillow landing), a whoosh (a throw), a bonk. */
const fwump = (sfx: Sfx) => noise(sfx, { dur: 0.2, freq: 320, to: 110, gain: 0.28 });
const whoosh = (sfx: Sfx) => noise(sfx, { dur: 0.28, filter: 'bandpass', freq: 1100, to: 420, gain: 0.14 });
const bonkSound = (sfx: Sfx) => {
  noise(sfx, { dur: 0.22, freq: 500, to: 140, gain: 0.35 });
  tone(sfx, { freq: 330, to: 170, dur: 0.2, type: 'triangle', gain: 0.12 });
};

export const minigame: Minigame = {
  id: 'topbunk',
  title: 'Top Bunk',
  how: 'Top bunk: point your phone at the floor and throw pillows at the three. Floor: dodge, and Duck to get small just before one lands. Three bonks and you flop onto the bean bag; the top bunk wins if nobody is left on the floor.',
  controller: 'aim',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, rng } = ctx;
    const [solo, three] = teamsOf(ctx);
    const top = solo?.[0] ?? 0;
    const floor = three?.length ? three : seats.map((_, i) => i).filter((i) => i !== top);
    const idx = seats.map((s) => s.index);
    const posOf = new Map(idx.map((s, i) => [s, i] as const));
    const room = newRoom(top, floor);
    const view = new BedroomView(seats, await Promise.all(seats.map((s, i) => buildCompanion(s.look, { height: i === top ? TOP_HEIGHT : HEIGHT }))), room);
    ctx.stage.setView(view);
    const isCpu = (i: number) => session.isCpu(idx[i] ?? i);
    const send = (i: number, msg: Parameters<typeof session.send>[1]) => {
      if (!isCpu(i)) session.send(idx[i] ?? i, msg);
    };

    const topBrain = newTopBrain(isCpu(top) ? ctx.skill() : 0.5);
    const kidBrains = new Map<number, KidBrain>();
    for (const i of floor) if (isCpu(i)) kidBrains.set(i, newKidBrain(ctx.skill()));
    // A phone that drops out mid-game: the computer takes over its seat.
    const kidBrainOf = (i: number): KidBrain => {
      let b = kidBrains.get(i);
      if (!b) kidBrains.set(i, (b = newKidBrain(0.5)));
      return b;
    };
    const topName = seats[top]?.name ?? 'The top bunk';

    session.setLayoutAll((seat) => {
      const i = posOf.get(seat.index) ?? -1;
      return i === top
        ? { kind: 'aim', note: 'You’re on the top bunk! Point at the floor and throw pillows at the three.', button: 'Throw' }
        : { kind: 'stick', button: 'Duck', note: `You’re on the floor with ${BUNK.lives} cushions. Dodge ${topName}’s pillows; Duck just before one lands!` };
    });

    let aim: Aim = { x: room.aim.x, z: room.aim.z, fire: false };
    let fireLatch = false;
    const sticks: Stick[] = seats.map(() => ({ x: 0, y: 0, a: false }));
    const latch = seats.map(() => false);
    const off = session.onInput((seat, msg) => {
      const i = posOf.get(seat);
      if (i === undefined || session.isCpu(seat)) return;
      if (i === top && msg.t === 'aim') {
        const p = aimPoint(msg.x, msg.y);
        if (msg.fire && !aim.fire) fireLatch = true;
        aim = { x: p.x, z: p.z, fire: msg.fire };
      } else if (i !== top && msg.t === 'stick') {
        // A quick tap can go down and up between two frames: remember it.
        if (msg.a && !(sticks[i] as Stick).a) latch[i] = true;
        sticks[i] = { x: msg.x, y: msg.y, a: msg.a };
      }
    });

    ui.caption(`${topName} is on the top bunk. Floor: dodge those pillows!`, seats[top]?.color);
    let hudAt = 0;
    let flopped = 0;
    await everyFrame(clock, (dt) => {
      const topAim = isCpu(top) ? cpuTop(room, topBrain, rng, dt) : { ...aim, fire: aim.fire || fireLatch };
      fireLatch = false;
      const now = seats.map((_, i) => {
        if (i !== top && isCpu(i)) return cpuKid(room, i, kidBrainOf(i), rng);
        const s = sticks[i] as Stick;
        const a = s.a || (latch[i] ?? false);
        latch[i] = false;
        return { x: s.x, y: s.y, a };
      });
      const lag = seats.map((_, i) => (isCpu(i) ? 0 : (Math.min(200, session.seats[idx[i] ?? i]?.rtt ?? 0) / 2000) * clock.speed));
      // Small steps so a slow frame can't skip a pillow past someone.
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let s = 0; s < n && !isOver(room); s++) {
        // A tap on Throw counts once, on the first small step.
        const ev = stepRoom(room, s === 0 ? topAim : { ...topAim, fire: topAim.fire && aim.fire }, now, dt / n, lag);
        if (ev.thrown) {
          view.throwPillow(ev.thrown);
          whoosh(ctx.sfx);
        }
        for (const p of ev.landed) {
          view.land(p);
          fwump(ctx.sfx);
        }
        for (const i of ev.dodged) {
          const k = kidOf(room, i);
          if (k) view.floaters.add('Phew!', seats[i]?.color ?? '#fff', new THREE.Vector3(k.x, HEIGHT + 0.9, k.z), 0.42);
          tone(ctx.sfx, { freq: 620, to: 930, dur: 0.12, gain: 0.07 });
          send(i, { t: 'feedback', good: true, text: 'Phew! Nice duck.' });
        }
        for (const i of ev.bonked) {
          const k = kidOf(room, i);
          if (!k) continue;
          bonkSound(ctx.sfx);
          view.floaters.add('Bonk!', '#ffffff', new THREE.Vector3(k.x, HEIGHT + 0.9, k.z), 0.55);
          view.rigs[i]?.c.react('sad', 0.9);
          view.topRig.react('happy', 0.9);
          send(i, { t: 'buzz', pattern: [70, 40, 70] });
          send(top, { t: 'buzz', pattern: [25] });
          send(top, { t: 'feedback', good: true, text: `Bonk! Got ${seats[i]?.name ?? 'them'}.` });
          if (k.lives > 0) send(i, { t: 'feedback', good: false, text: `Bonk! ${k.lives} cushion${k.lives === 1 ? '' : 's'} left.` });
        }
        for (const i of ev.out) {
          view.flop(i, flopped++);
          tone(ctx.sfx, { freq: 420, to: 150, dur: 0.45, type: 'triangle', gain: 0.1 });
          session.setLayout(idx[i] ?? i, { kind: 'wait', title: 'Flopped on the bean bag', text: 'Out of cushions. Get comfy and cheer the others on!' });
          const left = room.kids.filter((k) => k.outAt === null).length;
          if (left > 0) ui.caption(`${seats[i]?.name ?? 'Someone'} flops onto the bean bag. ${left} left on the floor!`, seats[i]?.color);
        }
      }
      view.sync(room, dt, clock.time);
      if (clock.time - hudAt > 0.1) {
        hudAt = clock.time;
        ui.timer(BUNK.duration - room.time);
        ui.live(
          seats.map((s, i) => {
            const k = kidOf(room, i);
            let value = `Top bunk · ${room.kids.reduce((n, kid) => n + kid.bonks, 0)} bonks`;
            if (k) value = k.outAt !== null ? 'On the bean bag' : `${k.lives} cushion${k.lives === 1 ? '' : 's'}`;
            return { name: s.name, color: s.color, thumb: s.thumb, value };
          }),
        );
      }
      return isOver(room);
    });
    off();
    ui.timer(null);

    // The end: the floor turns to the audience; whoever won cheers.
    const won = topWins(room);
    for (const r of view.rigs) {
      if (!r || r.flopped) continue;
      r.c.move(null);
      r.motion = null;
      r.c.root.rotation.set(0, 0, 0);
      r.c.root.scale.setScalar(1);
      r.c.root.visible = true;
      r.c.setBase(won ? 'sad' : 'happy');
    }
    view.topRig.setBase(won ? 'happy' : 'sad');
    if (won) {
      ctx.sfx.fanfare();
      ui.caption(`Lights out! ${topName} bonked everyone onto the bean bag.`, seats[top]?.color);
    } else {
      ctx.sfx.win();
      ui.caption('The floor holds out. Pillow truce!');
    }
    for (const i of seats.keys()) send(i, { t: 'buzz', pattern: [40, 30, 120] });
    await clock.wait(2);
    ui.caption(null);

    const bonks = room.kids.reduce((n, k) => n + k.bonks, 0);
    return {
      scores: bunkScores(room, seats.length),
      details: seats.map((_, i) => {
        if (i === top) return won ? `Bonked everyone in ${(room.doneAt ?? room.time).toFixed(1)} s` : `${bonks} bonk${bonks === 1 ? '' : 's'} from ${room.thrown} pillows`;
        const k = kidOf(room, i);
        if (!k) return '';
        if (k.outAt !== null) return `On the bean bag at ${k.outAt.toFixed(1)} s`;
        return `Held out · ${k.lives} cushion${k.lives === 1 ? '' : 's'} left`;
      }),
    };
  },
};
