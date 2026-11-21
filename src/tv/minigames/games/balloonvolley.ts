// Balloon Volley on the TV: a slow evening, the couch pulled into the middle of the room, and one pink balloon. Each
// team keeps to its side of the couch and bops the balloon back over; it drifts down slowly, its shadow on the rug
// showing where. The dots by each team's name show how many of their three touches they have used.
import * as THREE from 'three';
import {
  type Ball,
  type CpuMind,
  type Court,
  type Stick,
  VOLLEY,
  type VolleyEvent,
  bop,
  canReach,
  cpuThink,
  isOver,
  newCourt,
  newMind,
  stepCourt,
  volleyScores,
} from '../../../game/minigames/balloonvolley';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { preloadTextures } from '../../render/textures';
import { PALETTE as P, box, cone, cyl, gem, material, mix, nameCard, part, rbox, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.4; // companions
const TILT = 0.42; // the camera looks down this much (radians)
const BALLOON = mix(P.rose, P.neonPink, 0.4);
const COUCH = P.mauve;
const BACK = -VOLLEY.depth - 1.0; // the back wall
const SHIFT = -0.75; // the room sits a little left of the middle: the camera sees further that way, behind the scores
const PIP = { off: mix(P.slate, P.cream, 0.3), on: P.lamp, last: P.ember } as const;
const PIP_Z = VOLLEY.depth + 0.45;
const CARD_Z = VOLLEY.depth + 0.85;
const HISTORY = 30; // physics steps of balloon positions kept, to judge a bop where the phone saw it

// ------------------------------------------------------------------ sounds

/** A soft rubbery boop, a little higher for each touch. */
function boop(sfx: Sfx, touch: number): void {
  const f = 360 * 1.15 ** touch;
  tone(sfx, { freq: f, to: f * 1.6, dur: 0.12, gain: 0.12 });
  noise(sfx, { dur: 0.06, filter: 'bandpass', freq: 900, gain: 0.08 });
}

function spikeSound(sfx: Sfx): void {
  tone(sfx, { freq: 760, to: 300, dur: 0.2, type: 'triangle', gain: 0.1 });
  noise(sfx, { dur: 0.16, filter: 'bandpass', freq: 1800, to: 500, gain: 0.12 });
}

function swing(sfx: Sfx): void {
  noise(sfx, { dur: 0.1, filter: 'bandpass', freq: 1200, to: 500, gain: 0.07 });
}

function fwump(sfx: Sfx): void {
  noise(sfx, { dur: 0.2, filter: 'lowpass', freq: 320, to: 110, gain: 0.25 });
}

function landing(sfx: Sfx): void {
  noise(sfx, { dur: 0.25, filter: 'lowpass', freq: 260, to: 90, gain: 0.3 });
  tone(sfx, { freq: 523, dur: 0.12, gain: 0.08, delay: 0.12 });
  tone(sfx, { freq: 784, dur: 0.2, gain: 0.08, delay: 0.22 });
}

function serveSound(sfx: Sfx): void {
  tone(sfx, { freq: 520, to: 780, dur: 0.16, gain: 0.07 });
}

// ------------------------------------------------------------------ the scene

interface Body {
  companion: Companion;
  team: number;
  color: string;
  ring: THREE.Mesh;
  reach: THREE.Mesh;
  reachMat: THREE.MeshBasicMaterial;
  heading: number;
  hop: number;
}

class CourtView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  /** By seat position. */
  readonly bodies: (Body | undefined)[] = [];
  private readonly companions: Companion[];
  private readonly floaters: Floaters;
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly balloon = new THREE.Group();
  private readonly skin: THREE.Group;
  private readonly string: THREE.Line;
  private readonly shadow: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly drop: THREE.Mesh;
  private readonly pips: THREE.Mesh[][] = [];
  private readonly ownMats: THREE.Material[] = [];
  private readonly teamColors: string[] = [];
  private readonly sparks: { m: THREE.Mesh; v: THREE.Vector3; age: number; life: number }[] = [];
  private readonly pipOn: boolean[][] = [];
  private env: Env | null = null;
  private squash = 0;
  private stretch = 0;
  private appear = 1;
  private time = 0;

  constructor(seats: MinigameSeat[], teams: number[][], companions: Companion[]) {
    this.companions = companions;
    this.floaters = new Floaters(this.scene);
    this.room();
    this.couch();

    // The balloon, its string, and its shadow on the rug with a faint line down to it.
    this.skin = new THREE.Group();
    part(this.skin, sphere(VOLLEY.radius, 28), BALLOON, 0, 0, 0, { sy: 1.12, gloss: 0.7, glow: 0.18, exact: true });
    part(this.skin, sphere(0.075, 10), P.cream, -0.1, 0.15, 0.2, { glow: 0.9, opacity: 0.8, sy: 1.5, rz: 0.5, outline: false, shadow: false });
    part(this.skin, cone(0.06, 0.09, 10), mix(BALLOON, P.ink, 0.25), 0, -VOLLEY.radius * 1.12 - 0.03, 0, { rx: Math.PI, outline: false });
    part(this.skin, torus(0.035, 0.012), mix(BALLOON, P.ink, 0.35), 0, -VOLLEY.radius * 1.12 - 0.065, 0, { rx: Math.PI / 2, outline: false, shadow: false });
    this.balloon.add(this.skin);
    const stringGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 8 }, () => new THREE.Vector3()));
    const stringMat = new THREE.LineBasicMaterial({ color: P.cream, transparent: true, opacity: 0.7 });
    this.ownMats.push(stringMat);
    this.string = new THREE.Line(stringGeo, stringMat);
    this.string.frustumCulled = false;
    this.scene.add(this.balloon, this.string);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: P.ink, transparent: true, opacity: 0.3, depthWrite: false });
    this.ownMats.push(this.shadowMat);
    this.shadow = part(this.scene, cyl(VOLLEY.radius, VOLLEY.radius, 0.01, 32), P.ink, 0, 0.02, 0, { material: this.shadowMat, outline: false, shadow: false });
    const dropMat = new THREE.MeshBasicMaterial({ color: P.cream, transparent: true, opacity: 0.16, depthWrite: false });
    this.ownMats.push(dropMat);
    this.drop = part(this.scene, cyl(0.01, 0.01, 1, 6), P.cream, 0, 0, 0, { material: dropMat, outline: false, shadow: false });

    teams.forEach((members, team) => {
      const sx = team === 0 ? -1 : 1;
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      this.teamColors.push(color);
      // The team's half of the rug.
      // (a deep shade of the team's colour, and the colour itself only on a glowing strip along its outer edge)
      const hw = VOLLEY.half - VOLLEY.backX - 0.1;
      const hx = sx * ((VOLLEY.half + VOLLEY.backX) / 2 + 0.05);
      part(this.scene, rbox(hw, 0.03, VOLLEY.depth * 2 - 0.15, 0.012), mix(color, P.aubergine, 0.66), hx, 0.04, 0, { tex: 'knit', outline: false, shadow: false });
      part(this.scene, rbox(hw - 0.5, 0.03, VOLLEY.depth * 2 - 0.65, 0.012), mix(color, P.aubergine, 0.76), hx, 0.046, 0, { tex: 'knit', outline: false, shadow: false });
      part(this.scene, box(hw - 0.3, 0.012, 0.035), color, hx, 0.062, VOLLEY.depth - 0.16, { glow: 1.2, outline: false, shadow: false });
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.25);
      card.position.set(sx * 2.5, 0.3, CARD_Z);
      this.scene.add(card);
      // Three touch dots by the team's name.
      const row: THREE.Mesh[] = [];
      for (let i = 0; i < VOLLEY.touches; i++) {
        part(this.scene, cyl(0.1, 0.12, 0.035, 20), P.brass, sx * (0.36 + i * 0.32), 0.018, PIP_Z, { gloss: 0.6, outline: false });
        row.push(part(this.scene, sphere(0.09, 14), PIP.off, sx * (0.36 + i * 0.32), 0.12, PIP_Z, { outline: false, shadow: false }));
      }
      this.pips.push(row);
      this.pipOn.push(row.map(() => false));

      members.forEach((p) => {
        const seat = seats[p];
        const c = companions[p];
        if (!seat || !c) return;
        c.setBase('listening');
        this.scene.add(c.root);
        const ring = part(this.scene, torus(0.42, 0.04), seat.color, 0, 0.075, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
        const reachMat = new THREE.MeshBasicMaterial({ color: seat.color, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false });
        this.ownMats.push(reachMat);
        const reach = part(this.scene, torus(VOLLEY.reach, 0.02, Math.PI * 2), seat.color, 0, 0.06, 0, { rx: Math.PI / 2, material: reachMat, outline: false, shadow: false });
        this.bodies[p] = { companion: c, team, color: seat.color, ring, reach, reachMat, heading: 0, hop: 1 };
      });
      for (const e of [VOLLEY.half + 0.75, 1.0]) this.marks.push({ p: new THREE.Vector3(sx * e, 0, VOLLEY.depth + 0.2) }, { p: new THREE.Vector3(sx * e, 0, -VOLLEY.depth) });
      this.marks.push({ p: new THREE.Vector3(sx * 2.6, 3.2, -VOLLEY.depth) }, { p: new THREE.Vector3(sx * 1.5, 3.0, 0.8) });
      this.marks.push({ p: new THREE.Vector3(sx * 2.5 - 1.1, 0.3, CARD_Z), pad: 0.07 }, { p: new THREE.Vector3(sx * 2.5 + 1.1, 0.3, CARD_Z), pad: 0.07 });
    });
  }

  /**
   * An evening living room with a high ceiling: a tall window behind the couch, lamps, pictures, and a bookcase at
   * either end of the rug (the balloon bounces off them).
   */
  private room(): void {
    const s = this.scene;
    const env = livingRoom(s, { mood: 'evening', w: 15.5, d: -BACK * 2, h: 5.7, rug: false, lights: false, wall: P.duskWall, accent: P.teal });
    env.root.position.x = SHIFT;
    this.env = env;
    // The room's own window and curtains make way for a tall one over the couch.
    for (const o of [...env.root.children]) if (['window', 'curtains', 'picture', 'clock', 'pouf', 'beanbag'].includes(o.name)) o.removeFromParent();
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, scale = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      s.add(o);
      return o;
    };
    put(props.windowFrame({ w: 2.3, h: 2.7, time: 'dusk', seed: 4 }), 0, 3.1, BACK + 0.01);
    put(props.curtains({ w: 2.3, h: 2.8, color: mix(P.teal, P.cream, 0.25), open: 0.8 }), 0, 3.1, BACK + 0.01);
    // A picture rail high on the wall, and a gallery either side of the window.
    part(s, box(15.5, 0.07, 0.05), mix(P.duskWall, P.ink, 0.3), SHIFT, 4.75, BACK + 0.03, { outline: false, shadow: false });
    put(props.pictureFrame({ w: 1.2, h: 0.9, art: 'sunset', frame: P.walnut, seed: 2 }), -3.0, 3.5, BACK + 0.01);
    put(props.pictureFrame({ w: 0.6, h: 0.8, art: 'leaf', frame: P.brass, seed: 5 }), -4.3, 3.3, BACK + 0.01);
    put(props.pictureFrame({ w: 0.7, h: 0.55, art: 'moon', frame: P.charcoal, seed: 7 }), -5.6, 3.6, BACK + 0.01);
    put(props.pictureFrame({ w: 0.9, h: 0.7, art: 'hills', frame: P.oak, seed: 13 }), -3.6, 2.2, BACK + 0.01);
    put(props.wallClock({ r: 0.26 }), -6.6, 2.6, BACK + 0.01);
    put(props.pictureFrame({ w: 0.9, h: 1.2, art: 'shapes', frame: P.walnut, seed: 9 }), 2.9, 3.5, BACK + 0.01);
    put(props.pictureFrame({ w: 0.6, h: 0.6, art: 'hills', frame: P.brass, seed: 11 }), 4.0, 3.9, BACK + 0.01);
    put(props.wallShelf({ w: 1.4, seed: 8 }), 5.3, 3.0, BACK + 0.01);
    for (let i = 0; i < 4; i++) {
      const x0 = -8 + i * 3.7;
      s.add(props.stringLights(new THREE.Vector3(x0, 4.7, BACK + 0.1), new THREE.Vector3(x0 + 3.7, 4.7, BACK + 0.1), { sag: 0.28, count: 9 }));
    }
    // Lamps: a standing lamp behind each half, the left one really lighting the room.
    put(props.floorLamp({ lit: true, light: 11, h: 1.95 }), -2.3, 0, BACK + 0.45);
    put(props.floorLamp({ lit: true, h: 1.95 }), 2.3, 0, BACK + 0.45);
    put(props.plant({ kind: 'monstera', h: 1.2, pot: P.ceramic, seed: 3 }), -1.2, 0, BACK + 0.5);
    put(props.plant({ kind: 'snake', h: 0.9, pot: P.terracotta, seed: 5 }), 1.25, 0, BACK + 0.45);

    // The big rug the court is played on.
    part(s, rbox(VOLLEY.half * 2 + 0.5, 0.03, VOLLEY.depth * 2 + 0.4, 0.012), P.linen, 0, 0.02, 0, { tex: 'terry', outline: false, shadow: false });
    part(s, rbox(VOLLEY.half * 2 + 0.3, 0.03, VOLLEY.depth * 2 + 0.2, 0.012), mix(P.clay, P.ink, 0.25), 0, 0.027, 0, { tex: 'terry', outline: false, shadow: false });

    // Bookcases at either end: the walls of the court. A lamp on one, a fern on the other.
    for (const sx of [-1, 1]) {
      const x = sx * (VOLLEY.half + 0.16);
      put(props.bookshelf({ w: VOLLEY.depth * 2, h: 1.5, shelves: 3, seed: sx > 0 ? 41 : 43 }), x, 0, 0, (-sx * Math.PI) / 2);
      if (sx < 0) {
        put(props.tableLamp({ lit: true, light: 4, stand: P.brass }), x, 1.5, -1.0);
        put(props.vase({ color: P.terracotta, h: 0.3 }), x, 1.5, 0.9);
      } else {
        put(props.plant({ kind: 'fern', h: 0.55, pot: P.terracotta, seed: 6 }), x, 1.5, -1.0);
        const stack = put(props.books(0.4, 12, { h: 0.2 }), x + 0.05, 1.5, 0.6, Math.PI / 2);
        stack.rotation.z = 0;
      }
    }
    // Beyond the bookcases, and in the corners of the picture: a chair, a speaker, plants, a pouf.
    put(props.armchair({ color: P.terracotta, pillow: P.cream }), -6.4, 0, -1.2, 0.9, 1.25);
    put(props.sideTable({ h: 0.55 }), -5.4, 0, BACK + 0.5);
    put(props.snackBowl({ fill: 'popcorn' }), -5.4, 0.55, BACK + 0.5);
    put(props.plant({ kind: 'ficus', h: 2.1, pot: P.charcoal, seed: 2 }), -7.4, 0, BACK + 0.7);
    put(props.speaker({ h: 0.9 }), 5.6, 0, BACK + 0.45, -0.3);
    put(props.plant({ kind: 'palm', h: 1.7, pot: P.ceramic, seed: 7 }), 6.3, 0, -0.6);
    put(props.pouf({ color: P.mustard }), -6.6, 0, 2.6, 0, 1.3);
    put(props.plant({ kind: 'monstera', h: 1.1, pot: P.charcoal, seed: 9 }), -7.9, 0, 1.6, 0, 1.2);
    put(props.beanbag({ color: P.denim }), 4.5, 0, 3.3, -0.4, 1.25);
  }

  /** The couch in the middle: back to back seats, its back the net. */
  private couch(): void {
    const s = this.scene;
    const len = VOLLEY.depth * 2;
    const velvet = { tex: 'velvet' as const };
    part(s, rbox(VOLLEY.backX * 2, VOLLEY.backH, len, 0.1), COUCH, 0, VOLLEY.backH / 2, 0, velvet);
    // piping along the top of the back
    part(s, cyl(0.03, 0.03, len - 0.16, 8), mix(COUCH, P.cream, 0.35), 0, VOLLEY.backH - 0.005, 0, { rx: Math.PI / 2, outline: false, shadow: false });
    for (const sx of [-1, 1]) {
      const mid = (sx * (VOLLEY.backX + VOLLEY.seatX)) / 2;
      const w = VOLLEY.seatX - VOLLEY.backX;
      part(s, rbox(w, VOLLEY.seatH - 0.12, len - 0.1, 0.08), mix(COUCH, P.ink, 0.2), mid, (VOLLEY.seatH - 0.12) / 2 + 0.04, 0, velvet);
      for (const z of [-len / 4, len / 4]) {
        part(s, rbox(w - 0.04, 0.16, len / 2 - 0.08, 0.07), mix(COUCH, P.cream, 0.1), mid, VOLLEY.seatH - 0.08, z, velvet);
        // back cushions leaning on the net
        part(s, rbox(0.2, 0.46, len / 2 - 0.2, 0.09), mix(COUCH, P.cream, 0.06), sx * (VOLLEY.backX + 0.1), VOLLEY.seatH + 0.22, z, { ...velvet, rz: sx * 0.1 });
      }
      // A cushion thrown in the corner.
      part(s, rbox(0.4, 0.4, 0.15, 0.07), sx < 0 ? P.mustard : P.teal, sx * (VOLLEY.backX + 0.42), VOLLEY.seatH + 0.17, sx * 0.9, { tex: 'knit', ry: 0.9, rx: -0.5 });
    }
    for (const z of [-1, 1]) {
      part(s, rbox(VOLLEY.seatX * 2 + 0.1, 0.72, 0.28, 0.11), COUCH, 0, 0.4, z * (len / 2 + 0.1), velvet);
      for (const x of [-0.85, 0.85]) part(s, cyl(0.045, 0.03, 0.1, 10), P.walnut, x, 0.04, z * (len / 2 + 0.08), { outline: false });
    }
  }

  /** Mirrors the court: players, the balloon and its shadow, the touch dots. */
  sync(c: Court, dt: number): void {
    c.players.forEach((pl, p) => {
      const b = this.bodies[p];
      if (!b || pl.team < 0) return;
      const root = b.companion.root;
      const speed = Math.hypot(pl.vx, pl.vz);
      b.companion.move(speed > 0.35 ? 'run' : null, speed);
      // Face where they are going, or the balloon; never quite away from the room.
      const want = speed > 0.35 ? Math.atan2(pl.vx, pl.vz) : Math.atan2(c.ball.x - pl.x, c.ball.z - pl.z + 1.5);
      const goal = Math.max(-1.35, Math.min(1.35, Math.atan2(Math.sin(want), Math.cos(want))));
      b.heading += (goal - b.heading) * (1 - Math.exp(-8 * dt));
      b.hop = Math.min(1, b.hop + dt / 0.3);
      root.position.set(pl.x, Math.sin(Math.PI * b.hop) * 0.25, pl.z);
      root.rotation.set(0, b.heading, 0);
      b.ring.position.set(pl.x, 0.07, pl.z);
      b.reach.position.set(pl.x, 0.06, pl.z);
      const near = c.live && canReach(pl, c.ball) && c.time - pl.lastBop >= VOLLEY.cooldown;
      b.reachMat.opacity += ((near ? 0.9 : 0.22) - b.reachMat.opacity) * (1 - Math.exp(-14 * dt));
    });

    const ball0 = c.ball;
    this.appear = Math.min(1, this.appear + dt / 0.25);
    this.squash = Math.max(0, this.squash - dt / 0.35);
    const sq = Math.sin(Math.PI * this.squash) * 0.25;
    this.balloon.position.set(ball0.x, ball0.y + (c.resting ? -sq * VOLLEY.radius : 0), ball0.z);
    // A bop stretches it for a moment (taller, thinner, then back with a wobble).
    this.stretch = Math.max(0, this.stretch - dt / 0.4);
    const st = Math.sin(this.stretch * Math.PI * 2.5) * this.stretch * 0.22;
    const pop = 1 + 2.7 * (this.appear - 1) ** 3 + 1.7 * (this.appear - 1) ** 2; // serves pop in with a little overshoot
    this.skin.scale.set((1 + sq - st * 0.6) * pop, (1 - sq + st) * pop, (1 + sq - st * 0.6) * pop);
    this.skin.rotation.z = Math.sin(this.time * 1.7) * 0.12 - ball0.vx * 0.05;
    this.skin.rotation.x = Math.sin(this.time * 1.3) * 0.1 + ball0.vz * 0.05;
    // The string trails behind, swaying.
    const pos = this.string.geometry.getAttribute('position') as THREE.BufferAttribute;
    const top = ball0.y - VOLLEY.radius * 1.12 - 0.08;
    for (let i = 0; i < pos.count; i++) {
      const k = i / (pos.count - 1);
      const sway = Math.sin(this.time * 3 + k * 4) * 0.04 * k;
      pos.setXYZ(i, ball0.x - ball0.vx * 0.08 * k + sway, top - k * 0.55 + Math.max(0, ball0.vy) * 0.05 * k, ball0.z - ball0.vz * 0.08 * k);
    }
    pos.needsUpdate = true;
    this.string.visible = this.appear > 0.5 && !c.resting;
    // The shadow, on the rug or a seat cushion: bigger and fainter the higher the balloon.
    const ax = Math.abs(ball0.x);
    const floor = ax > VOLLEY.backX && ax < VOLLEY.seatX ? VOLLEY.seatH : ax <= VOLLEY.backX ? VOLLEY.backH : 0;
    const h = Math.max(0, ball0.y - floor);
    this.shadow.position.set(ball0.x, floor + 0.05, ball0.z);
    this.shadow.scale.setScalar((0.8 + h * 0.18) * this.appear);
    this.shadowMat.opacity = Math.max(0.12, 0.42 - h * 0.08) * this.appear;
    this.drop.visible = h > 0.4 && !c.resting;
    this.drop.position.set(ball0.x, floor + h / 2, ball0.z);
    this.drop.scale.set(1, Math.max(0.01, h - VOLLEY.radius), 1);

    this.pips.forEach((row, team) => {
      const used = c.touchTeam === team ? c.touches : 0;
      row.forEach((pip, i) => {
        const on = i < used;
        const was = this.pipOn[team];
        if (was && was[i] !== on) {
          was[i] = on;
          pip.material = material(on ? (i === VOLLEY.touches - 1 ? PIP.last : PIP.on) : PIP.off, { glow: on ? 1.6 : 0, outline: false });
          if (on) pip.scale.setScalar(1.7);
        }
        const goal = on ? 1.2 : 1;
        pip.scale.setScalar(pip.scale.x + (goal - pip.scale.x) * (1 - Math.exp(-10 * dt)));
      });
    });
  }

  bop(p: number, spike: boolean): void {
    const b = this.bodies[p];
    if (!b) return;
    b.hop = 0;
    b.companion.react(spike ? 'happy' : 'approval', 0.6);
    this.stretch = 1;
    this.burst(this.balloon.position, spike ? 9 : 5, spike ? P.lamp : b.color, spike ? 1.6 : 1.1);
  }

  whiff(p: number): void {
    const b = this.bodies[p];
    if (!b) return;
    b.hop = 0.5;
    b.companion.react('thinking', 0.6);
  }

  landed(): void {
    this.squash = 1;
    if (this.balloon.position.y < VOLLEY.radius + 0.1) this.burst(this.balloon.position.clone().setY(0.1), 8, P.cream, 1.3, true);
  }

  /** A little burst of sparks (or, `flat`, dust along the floor) from a spot. */
  private burst(at: THREE.Vector3, n: number, color: string, speed: number, flat = false): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.time * 5;
      const m = flat
        ? part(this.scene, sphere(0.07, 8), color, at.x, at.y, at.z, { opacity: 0.5, outline: false, shadow: false })
        : part(this.scene, gem(0.05), color, at.x, at.y, at.z, { glow: 1.8, outline: false, shadow: false });
      const v = flat ? new THREE.Vector3(Math.cos(a) * speed, 0.25, Math.sin(a) * speed * 0.6) : new THREE.Vector3(Math.cos(a) * speed, Math.sin(a) * speed + 0.4, 0.3);
      this.sparks.push({ m, v, age: 0, life: flat ? 0.5 : 0.45 });
    }
  }

  served(): void {
    this.appear = 0;
  }

  say(at: THREE.Vector3, text: string, color: string, size = 0.5): void {
    this.floaters.add(text, color, at, size, 1.3);
  }

  sayOver(p: number, text: string, color: string): void {
    const b = this.bodies[p];
    if (b) this.floaters.add(text, color, b.companion.root.position.clone().setY(HEIGHT + 0.6), 0.38, 1.0);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const m of this.ownMats) m.dispose();
    this.string.geometry.dispose();
    this.floaters.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks);
    this.env?.update(dt, this.time);
    for (const c of this.companions) c.update(dt);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i] as (typeof this.sparks)[number];
      sp.age += dt;
      sp.v.multiplyScalar(Math.exp(-3 * dt));
      sp.m.position.addScaledVector(sp.v, dt);
      sp.m.rotation.y += dt * 9;
      sp.m.scale.setScalar(Math.max(0.01, 1 - sp.age / sp.life));
      if (sp.age < sp.life) continue;
      sp.m.removeFromParent();
      this.sparks.splice(i, 1);
    }
    this.floaters.update(dt);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'balloonvolley',
  title: 'Balloon Volley',
  how: 'Keep the balloon off your side of the couch! Walk under it with the stick and press Bop! to send it back over. Three touches per side at most; a high bop near the couch is a spike. First to five.',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const court = newCourt(teams, seats.length, rng() < 0.5 ? 0 : 1);
    const minds: (CpuMind | null)[] = seats.map((_, p) => (cpu(p) ? newMind(ctx.skill()) : null));
    // Have the set's textures in before it first shows (but never wait long for them).
    const warm = Promise.race([preloadTextures('woodFloor', 'plaster', 'velvet', 'knit', 'terry', 'wood'), new Promise<void>((done) => setTimeout(done, 2000))]);
    const view = new CourtView(seats, teams, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    await warm;
    ctx.stage.setView(view);

    const teamOf = new Map<number, number>();
    teams.forEach((t, team) => t.forEach((p) => teamOf.set(p, team)));
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const partnerOf = (p: number): number | undefined => {
      const team = teamOf.get(p);
      return team === undefined ? undefined : teams[team]?.find((q) => q !== p);
    };
    const tellTeam = (team: number, good: boolean, text: string) => {
      for (const p of teams[team] ?? []) tell(p, good, text);
    };
    const scoreLine = (team: number) => `${court.score[team] ?? 0}–${court.score[1 - team] ?? 0}`;

    seats.forEach((s, p) => {
      const team = teamOf.get(p);
      const partner = partnerOf(p);
      const side = team === 0 ? 'left' : 'right';
      const member = team === undefined ? 0 : (teams[team]?.indexOf(p) ?? 0);
      session.setLayout(s.index, {
        kind: 'stick',
        button: 'Bop!',
        note:
          partner === undefined
            ? `You keep the ${side} side on your own. Bop it back over the couch!`
            : member === 0
              ? `You and ${nameOf(partner)} keep the ${side} side: you take the couch end, ${nameOf(partner)} the back.`
              : `You and ${nameOf(partner)} keep the ${side} side: you take the back, ${nameOf(partner)} the couch end.`,
      });
    });

    // Input: the stick moves you; a press of Bop! is judged against where the balloon was when the finger went down.
    const sticks: Stick[] = seats.map(() => ({ x: 0, y: 0 }));
    const held = seats.map(() => false);
    const presses: { p: number; lag: number }[] = [];
    let over = false;
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'stick' || over || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p === undefined) return;
      sticks[p] = { x: msg.x, y: msg.y };
      if (msg.a && !held[p]) presses.push({ p, lag: Math.min(0.15, (session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed });
      held[p] = msg.a;
    });

    const history: Ball[] = [];
    const seen = (lag: number): Ball => history[Math.max(0, history.length - 1 - Math.round(lag / VOLLEY.step))] ?? court.ball;
    const whiffSaid = seats.map(() => -Infinity);

    const onEvent = (e: VolleyEvent) => {
      switch (e.t) {
        case 'bop': {
          view.bop(e.player, e.spike);
          if (e.spike) {
            spikeSound(sfx);
            view.sayOver(e.player, 'Spike!', '#fff6a8');
          } else boop(sfx, e.touches);
          if (!cpu(e.player)) buzz(e.player, [15]);
          if (e.touches === VOLLEY.touches) {
            const team = teamOf.get(e.player);
            if (team !== undefined) tellTeam(team, true, 'Three touches: it has to go over now!');
          }
          return;
        }
        case 'whiff':
          view.whiff(e.player);
          swing(sfx);
          if (!cpu(e.player) && court.time - (whiffSaid[e.player] ?? -Infinity) > 2) {
            whiffSaid[e.player] = court.time;
            tell(e.player, false, 'Missed! Get right under it.');
          }
          return;
        case 'fault': {
          sfx.bad();
          const at = new THREE.Vector3(court.ball.x, 2.6, court.ball.z);
          view.say(at, 'Four touches!', '#ffb3c0', 0.5);
          tellTeam(e.team, false, `Four touches: their point. ${scoreLine(e.team)}`);
          tellTeam(1 - e.team, true, `They touched it four times: your point! ${scoreLine(1 - e.team)}`);
          for (const p of teams[1 - e.team] ?? []) view.bodies[p]?.companion.react('happy', 1.2);
          return;
        }
        case 'floor': {
          view.landed();
          if (!e.live) return;
          landing(sfx);
          const winner = 1 - e.side;
          view.say(new THREE.Vector3(court.ball.x, 1.6, court.ball.z), 'Point!', '#fff6a8', 0.6);
          tellTeam(winner, true, `Point! ${scoreLine(winner)}`);
          tellTeam(e.side, false, `It landed on your side. ${scoreLine(e.side)}`);
          for (const p of teams[winner] ?? []) {
            view.bodies[p]?.companion.react('happy', 1.4);
            buzz(p, [30]);
          }
          for (const p of teams[e.side] ?? []) {
            view.bodies[p]?.companion.react('sad', 1.2);
            buzz(p, [80, 40, 80]);
          }
          return;
        }
        case 'couch':
          fwump(sfx);
          return;
        case 'serve':
          view.served();
          serveSound(sfx);
          return;
        case 'over':
          return;
      }
    };

    const live = () =>
      ui.live(
        teams.map((members, team) => {
          const lead = seats[members[0] ?? 0];
          const n = court.score[team] ?? 0;
          return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} point${n === 1 ? '' : 's'}` };
        }),
      );

    ui.caption('Bop it over the couch: three touches per side at most!');
    let acc = 0;
    let hudAt = -1;
    await everyFrame(clock, (dt) => {
      acc += dt;
      let steps = Math.min(Math.floor(acc / VOLLEY.step), 90);
      acc = Math.min(acc - steps * VOLLEY.step, VOLLEY.step);
      while (steps-- > 0 && !isOver(court)) {
        seats.forEach((_, p) => {
          if (!cpu(p)) return;
          // A phone that drops out mid-game: a computer player takes over that seat.
          const mind = (minds[p] ??= newMind(0.5));
          const mate = partnerOf(p);
          const out = cpuThink(court, p, mind, rng, mate === undefined ? undefined : { p: mate, human: !cpu(mate) });
          sticks[p] = { x: out.x, y: out.y };
          if (out.a) presses.push({ p, lag: 0 });
        });
        for (const press of presses.splice(0)) {
          const e = bop(court, press.p, sticks[press.p] ?? { x: 0, y: 0 }, seen(press.lag));
          if (e) onEvent(e);
        }
        for (const e of stepCourt(court, sticks)) onEvent(e);
        history.push({ ...court.ball });
        if (history.length > HISTORY) history.shift();
      }
      view.sync(court, dt);
      if (court.time - hudAt >= 0.1) {
        hudAt = court.time;
        ui.timer(VOLLEY.duration - court.time);
        live();
      }
      return isOver(court);
    });
    over = true;
    off();
    live();
    ui.timer(null);
    ui.caption(null);
    for (const b of view.bodies) b?.companion.move(null);

    const [a = 0, b = 0] = court.score;
    const tie = a === b;
    sfx.good();
    teams.forEach((members, team) => {
      const won = (court.score[team] ?? 0) > (court.score[1 - team] ?? 0);
      for (const p of members) {
        view.bodies[p]?.companion.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won) view.bodies[p]?.companion.react('happy', 3);
        tell(p, won || tie, tie ? `Time! A draw, ${scoreLine(team)}.` : won ? `You win ${scoreLine(team)}!` : `They win, ${scoreLine(1 - team)}.`);
      }
      if (won) view.say(new THREE.Vector3((team === 0 ? -1 : 1) * 2.5, 2.8, 0), 'Champions of the couch!', '#fff6a8', 0.55);
    });
    await clock.wait(1.6);

    return {
      scores: volleyScores(court, teams, seats.length),
      details: seats.map((_, p) => {
        const team = teamOf.get(p);
        const n = court.players[p]?.bops ?? 0;
        if (team === undefined) return '';
        return `${scoreLine(team)} · ${n} bop${n === 1 ? '' : 's'}`;
      }),
    };
  },
};
