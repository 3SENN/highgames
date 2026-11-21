// Bean Bag Toss on the TV: a back garden at dusk, fairy lights strung over the fence, a fire pit glowing. Two
// boards lean at the far end, one per team; the throwers wait their turn behind the line and step up to toss.
import * as THREE from 'three';
import {
  type Board,
  type BoardEvent,
  TOSS,
  type Toss,
  boardScore,
  cpuSpeed,
  landBag,
  newBoard,
  onBoard,
  planToss,
  settled,
  stepBoard,
  tossScores,
  turnOrder,
} from '../../../game/minigames/cornhole';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Layout } from '../../../shared/protocol';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cone, cyl, gem, material, mix, nameCard, part, popSprite, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, lanes, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const GAP = 3.4; // lane to lane
const HEIGHT = 1.3; // companions
const LOW = 0.1; // the board's front edge is this high…
const HIGH = 0.42; // …and its back edge this high
const SLOPE = Math.atan2(HIGH - LOW, TOSS.board.y1 - TOSS.board.y0);
const BAG_H = 0.07;
const FLIGHT = 0.65; // seconds in the air
const WAIT_Z = 1.35; // where the throwers wait…
const LINE_Z = 0.3; // …and where they step up to toss
const SPREAD = 0.75; // partners wait this far either side of their lane
const TILT = 0.62; // the camera looks down this much (radians)
const AUTO = 8; // seconds before a gentle lob is tossed for someone who hasn't swiped
const SLIDE_MAX = 2.5; // seconds a toss may take to settle

// ------------------------------------------------------------------ pieces

/** A bean bag in the thrower's colour: a squashy canvas square with a stitched seam. */
function bagMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(0.24, BAG_H, 0.24, 0.03), color, 0, 0, 0, { tex: 'fabric', texScale: 0.35, texStrength: 0.7, exact: true, outline: 0.02 });
  part(g, rbox(0.2, BAG_H + 0.02, 0.2, 0.03), mix(color, P.cream, 0.12), 0, 0, 0, { tex: 'fabric', texScale: 0.35, texStrength: 0.7, outline: false, shadow: false });
  for (const s of [-1, 1]) part(g, box(0.225, 0.004, 0.008), mix(color, P.ink, 0.45), 0, BAG_H / 2 + 0.001, s * 0.105, { outline: false, shadow: false });
  return g;
}

/** A board, leaning back, with its hole: oak, painted in the team's colour with cream stripes. Its middle at y = 0. */
function boardMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  const len = TOSS.board.y1 - TOSS.board.y0;
  const w = TOSS.board.half * 2;
  const flat = { outline: false as const, shadow: false };
  // The frame underneath, the deck, and the painted face.
  part(g, rbox(w, 0.09, len, 0.02), P.oak, 0, -0.045, 0, { tex: 'wood', texScale: 0.8, outline: 0.022 });
  part(g, rbox(w - 0.04, 0.02, len - 0.04, 0.008), mix(color, P.aubergine, 0.3), 0, 0.01, 0, { gloss: 0.3, ...flat });
  // A bright edge in the full team colour, and two cream stripes up the face.
  for (const sx of [-1, 1]) part(g, box(0.035, 0.022, len - 0.04), color, sx * (w / 2 - 0.04), 0.012, 0, { exact: true, glow: 0.35, ...flat });
  for (const sx of [-1, 1]) part(g, box(0.05, 0.022, len - 0.1), mix(P.cream, color, 0.15), sx * 0.2, 0.011, 0, flat);
  // The hole (dark, with a turned rim), 0.45 from the back edge.
  const hz = -(TOSS.hole.y - (TOSS.board.y0 + TOSS.board.y1) / 2);
  part(g, cyl(TOSS.hole.r + 0.03, TOSS.hole.r + 0.03, 0.012, 28), mix(P.cream, color, 0.15), 0, 0.016, hz, flat);
  part(g, cyl(TOSS.hole.r, TOSS.hole.r, 0.012, 28), P.ink, 0, 0.02, hz, flat);
  part(g, torus(TOSS.hole.r, 0.012), P.walnut, 0, 0.024, hz, { rx: Math.PI / 2, ...flat });
  return g;
}

/** How high a bag's middle sits on the board, `y` from the throwing line. */
function boardTop(y: number): number {
  return LOW + ((y - TOSS.board.y0) / (TOSS.board.y1 - TOSS.board.y0)) * (HIGH - LOW) + 0.025 + BAG_H / 2;
}

// ------------------------------------------------------------------ the view

interface Thrower {
  companion: Companion;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  ring: THREE.Mesh;
  arrow: THREE.Mesh;
  card: THREE.Sprite;
  color: string;
}

interface BagView {
  mesh: THREE.Group;
  yaw: number;
  sink: number;
  /** 1 → 0 after it lands: a squash and settle. */
  pop: number;
}

interface Lane {
  x: number;
  color: string;
  members: number[];
  board: Board;
  bags: BagView[];
  label: THREE.Sprite | null;
  shown: number;
}

/** Dust and glitter: little specks that fly out, fall and shrink away. */
class Specks {
  private list: { m: THREE.Mesh; v: THREE.Vector3; age: number; life: number }[] = [];
  constructor(
    private readonly scene: THREE.Object3D,
    private readonly rand: () => number,
  ) {}

  burst(at: THREE.Vector3, color: string, o: { n?: number; speed?: number; size?: number; glow?: number; up?: number } = {}): void {
    const n = o.n ?? 10;
    const speed = o.speed ?? 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand();
      const m = part(this.scene, o.glow ? gem(o.size ?? 0.06) : sphere(o.size ?? 0.06, 8), color, at.x, at.y, at.z, { ...(o.glow ? { glow: o.glow } : {}), outline: false, shadow: false });
      const out = speed * (0.4 + this.rand() * 0.7);
      this.list.push({ m, v: new THREE.Vector3(Math.cos(a) * out, (o.up ?? 1) * speed * (0.5 + this.rand() * 0.7), Math.sin(a) * out), age: 0, life: 0.45 + this.rand() * 0.35 });
    }
  }

  update(dt: number): void {
    this.list = this.list.filter((s) => {
      s.age += dt;
      s.v.y -= 5 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.y += dt * 7;
      s.m.scale.setScalar(Math.max(0.01, 1 - s.age / s.life));
      if (s.age < s.life) return true;
      s.m.removeFromParent();
      return false;
    });
  }
}

class Garden implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: Lane[] = [];
  /** By seat position. */
  readonly throwers: (Thrower | undefined)[] = [];
  private readonly floaters: Floaters;
  private readonly fit: CameraFit;
  private readonly marks: Mark[] = [];
  private readonly cards: THREE.Sprite[] = [];
  private active = -1;
  private hand: THREE.Group | null = null;
  private flying: { mesh: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; age: number; done: boolean } | null = null;
  private time = 0;
  private readonly rand = seeded(73);
  private readonly specks: Specks;
  private readonly env: Env;

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    private readonly companions: Companion[],
    boards: Board[],
  ) {
    this.floaters = new Floaters(this.scene);
    this.fit = new CameraFit(this.camera, TILT);
    this.specks = new Specks(this.scene, this.rand);
    const xs = lanes(teams.length, GAP);
    this.env = this.garden(xs);
    teams.forEach((members, k) => {
      const x = xs[k] ?? 0;
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      // The board, leaning back on two legs.
      const b = boardMesh(color);
      const mid = (TOSS.board.y0 + TOSS.board.y1) / 2;
      b.position.set(x, (LOW + HIGH) / 2, -mid);
      b.rotation.x = SLOPE;
      this.scene.add(b);
      for (const sx of [-1, 1]) part(this.scene, rbox(0.06, HIGH, 0.06, 0.015), P.walnut, x + sx * (TOSS.board.half - 0.08), HIGH / 2 - 0.03, -(TOSS.board.y1 - 0.1), { tex: 'wood', outline: 0.02 });
      this.lanes.push({ x, color, members, board: boards[k] as Board, bags: [], label: null, shown: -1 });
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.1);
      card.position.set(x, 0.05, -(TOSS.board.y0 - 0.55));
      this.scene.add(card);
      this.cards.push(card);
      // The throwers wait behind the line, half turned towards their board.
      members.forEach((p, m) => {
        const seat = seats[p];
        const c = companions[p];
        if (!seat || !c) return;
        const side = members.length > 1 ? (m === 0 ? -1 : 1) : 0;
        const home = new THREE.Vector3(x + side * SPREAD, 0, WAIT_Z);
        c.root.position.copy(home);
        c.root.rotation.y = Math.PI;
        c.setBase('listening');
        this.scene.add(c.root);
        const ring = part(this.scene, torus(0.42, 0.035), seat.color, home.x, 0.03, home.z, { rx: Math.PI / 2, outline: false, shadow: false, exact: true });
        const arrow = part(this.scene, cone(0.13, 0.26, 14), seat.color, home.x, HEIGHT + 0.65, home.z, { rx: Math.PI, glow: 1.1, exact: true, outline: false, shadow: false });
        arrow.visible = false;
        const name = nameCard(seat.name, seat.color, 0.75);
        this.scene.add(name);
        this.cards.push(name);
        this.throwers[p] = { companion: c, home, pos: home.clone(), ring, arrow, card: name, color: seat.color };
      });
      // What the camera keeps on screen: the throwers and their names, the board and its score.
      for (const sx of [-1, 1]) {
        this.marks.push({ p: new THREE.Vector3(x + sx * (SPREAD + 0.45), 0, WAIT_Z + 0.4) }, { p: new THREE.Vector3(x + sx * (SPREAD + 0.45), HEIGHT + 0.5, WAIT_Z), pad: 0.05 });
        this.marks.push({ p: new THREE.Vector3(x + sx * (TOSS.board.half + 0.2), 0, -(TOSS.board.y1 + 0.3)) }, { p: new THREE.Vector3(x + sx * 0.4, 1.6, -mid), pad: 0.06 });
      }
      this.marks.push({ p: new THREE.Vector3(x, HEIGHT + 1.15, LINE_Z), pad: 0.05 });
    });
    this.update(0);
  }

  /** A back garden at dusk: lawn, fence, trees and fairy lights; a deck to throw from, a fire pit and a picnic. */
  private garden(xs: number[]): Env {
    const sc = this.scene;
    const left = Math.min(...xs) - 3.4;
    const right = Math.max(...xs) + 3.4;
    const mid = -(TOSS.board.y1 - 1.6) / 2;
    const env = backyard(sc, { mood: 'evening', w: right - left + 5.6, d: TOSS.board.y1 + 6.4, clear: { w: right - left + 1, d: TOSS.board.y1 + 5 }, seed: 6 });
    // The garden is built round its own middle; the game runs from the line at z = 0 back to the boards.
    env.root.position.z = mid;
    env.sun.target.position.set(0, 0, mid);
    const flat = { outline: false as const, shadow: false };
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, y = 0) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      sc.add(o);
      return o;
    };
    // A low deck to throw from, and the line along its front edge.
    part(sc, rbox(right - left - 1.2, 0.06, 2.5, 0.02), P.wood, 0, 0.0, 1.25, { tex: 'planks', texScale: 1.6, outline: false });
    for (const x of xs) part(sc, box(1.4, 0.012, 0.07), P.cream, x, 0.036, 0.06, flat);
    xs.forEach((x) => {
      // A mown strip down each lane, with chalk edges fading out towards the board.
      part(sc, box(1.7, 0.012, TOSS.board.y1 + 0.9), mix(P.grass, P.moss, 0.5), x, 0.004, -(TOSS.board.y1 + 0.9) / 2 - 0.05, { tex: 'grass', texScale: 1.4, ...flat });
      for (const e of [-1, 1]) part(sc, box(0.04, 0.012, TOSS.board.y0 - 0.6), mix(P.cream, P.grass, 0.35), x + e * 0.85, 0.008, -(TOSS.board.y0 - 0.6) / 2 - 0.1, flat);
      // A paved pad under each board.
      part(sc, rbox(1.9, 0.04, TOSS.board.y1 - TOSS.board.y0 + 1.1, 0.02), P.stone, x, 0.004, -(TOSS.board.y0 + TOSS.board.y1) / 2, { tex: 'stoneTiles', texScale: 1.2, ...flat });
    });
    // Little lanterns down the outside of the lanes.
    for (const z of [-2.2, -4.6, -7]) {
      for (const e of [-1, 1]) put(props.candle({ h: 0.14, color: P.cream }), (e < 0 ? Math.min(...xs) : Math.max(...xs)) + e * 1.25, z);
    }
    for (let i = 0; i + 1 < xs.length; i++) put(props.gardenLamp({ h: 0.45, lit: true }), ((xs[i] ?? 0) + (xs[i + 1] ?? 0)) / 2, -3.6);
    // The fire pit, off to the left, with logs to sit on.
    const fx = left + 0.5;
    put(props.campfire({ light: 9, r: 0.45 }), fx, 2.3);
    put(props.logSeat({ len: 1.5 }), fx - 1.5, 2.9, 0.9);
    put(props.logSeat({ len: 1.2 }), fx + 0.2, 3.7, -0.2);
    put(props.bush({ r: 0.6, flowers: P.rose, seed: 3 }), left - 0.9, -1.2);
    put(props.bush({ r: 0.5, seed: 7, color: P.moss }), left - 0.6, -5.6);
    // A picnic on the right: a gingham blanket, crisps, a bottle, a crate of spare bags.
    const bx = right - 0.5;
    put(props.blanket({ w: 1.7, d: 1.5, color: P.rose, tex: 'gingham' }), bx, 2.3, 0.2);
    put(props.snackBowl({ fill: 'crisps', color: P.ceramic }), bx - 0.3, 2.4, 0, 0.03);
    put(props.drink({ kind: 'bottle', color: P.forest }), bx + 0.35, 2.05, 0, 0.03);
    put(props.pouf({ color: P.mustard, r: 0.32 }), bx + 0.9, 3.0);
    const spare = put(props.crate({ s: 0.45 }), bx + 0.5, 0.6, 0.4);
    [P.terracotta, P.teal, P.mustard].forEach((c, i) => {
      const bag = bagMesh(c);
      bag.position.set((i - 1) * 0.12, 0.47 + i * 0.05, (i % 2) * 0.08 - 0.04);
      bag.rotation.set(0.2 * (i - 1), i, 0);
      spare.add(bag);
    });
    put(props.bush({ r: 0.55, flowers: P.mustard, seed: 5 }), right + 0.9, -2.4);
    put(props.plant({ kind: 'fern', h: 0.7, pot: P.terracotta }), right + 0.4, -6.2);
    return env;
  }

  // -------------------------------------------------- the turn

  /** `p` steps up to the line with a bag. */
  up(p: number): void {
    this.active = p;
    const t = this.throwers[p];
    if (!t) return;
    t.companion.setBase('thinking');
    this.hand = bagMesh(t.color);
    this.scene.add(this.hand);
  }

  /** The bag leaves the hand for where the toss comes down. */
  toss(lane: number, toss: Toss): void {
    const l = this.lanes[lane];
    const bag = this.hand;
    if (!l || !bag) return;
    this.hand = null;
    const t = this.throwers[this.active];
    t?.companion.react('approval', 0.8);
    const to = this.where(l, toss.x, toss.y);
    this.flying = { mesh: bag, from: bag.position.clone(), to, age: 0, done: false };
  }

  /** The bag that just landed is board bag `index` from now on. */
  landed(lane: number): void {
    const l = this.lanes[lane];
    const f = this.flying;
    if (!l || !f) return;
    this.flying = null;
    l.bags.push({ mesh: f.mesh, yaw: (this.rand() - 0.5) * 1.2, sink: 0, pop: 1 });
    // A puff where it comes down: dust off the board, bits of grass off the lawn.
    const wood = f.to.y > BAG_H;
    this.specks.burst(f.to.clone(), wood ? P.sand : P.moss, { n: 6, speed: 1.1, size: 0.035, up: 0.9 });
  }

  /** The thrower goes back to wait. */
  down(): void {
    const t = this.throwers[this.active];
    t?.companion.setBase('listening');
    this.active = -1;
  }

  say(lane: number, text: string, color: string, at?: { x: number; y: number }): void {
    const l = this.lanes[lane];
    if (!l) return;
    const p = at ? this.where(l, at.x, at.y) : new THREE.Vector3(l.x, 0, -TOSS.hole.y);
    this.floaters.add(text, color, p.add(new THREE.Vector3(0, 1.0, 0)), 0.42, 1.6);
  }

/** The lane's team reacts. */
  cheer(lane: number, mood: CompanionMood, seconds = 1.4): void {
    for (const p of this.lanes[lane]?.members ?? []) this.throwers[p]?.companion.react(mood, seconds);
  }

  /** Where a spot `x`, `y` (yard coordinates) in a lane is in the world, on the board's surface or the grass. */
  private where(l: Lane, x: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(l.x + x, onBoard(x, y) ? boardTop(y) : BAG_H / 2, -y);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
    for (const card of this.cards) {
      card.material.map?.dispose();
      card.material.dispose();
    }
    for (const l of this.lanes) {
      l.label?.material.map?.dispose();
      l.label?.material.dispose();
    }
  }

  // -------------------------------------------------- every frame

  update(dt: number): void {
    this.time += dt;
    this.env.update(dt, this.time);
    this.specks.update(dt);
    for (const c of this.companions) c.update(dt);
    this.walk(dt);
    this.fly(dt);
    for (const l of this.lanes) this.place(l, dt);
    this.floaters.update(dt);
    this.fit.update(() => this.marks);
  }

  /** The thrower walks up to the line and back; the one whose go it is glows. */
  private walk(dt: number): void {
    this.throwers.forEach((t, p) => {
      if (!t) return;
      const up = p === this.active;
      const goal = up ? new THREE.Vector3(this.lanes.find((l) => Math.abs(l.x - t.home.x) < GAP / 2)?.x ?? t.home.x, 0, LINE_Z) : t.home;
      const before = t.pos.clone();
      t.pos.lerp(goal, 1 - Math.exp(-6 * dt));
      const speed = dt > 0 ? before.distanceTo(t.pos) / dt : 0;
      t.companion.move(speed > 0.25 ? 'walk' : null, speed);
      t.companion.root.position.copy(t.pos);
      t.ring.position.set(t.pos.x, 0.03, t.pos.z);
      t.ring.material = material(t.color, up ? { glow: 1.2, exact: true } : { glow: 0.4, exact: true });
      t.ring.scale.setScalar(up ? 1 + Math.sin(this.time * 6) * 0.06 : 0.8);
      t.arrow.visible = up;
      t.arrow.position.set(t.pos.x, HEIGHT + 0.65 + Math.sin(this.time * 5) * 0.08, t.pos.z);
      t.card.position.set(t.pos.x, HEIGHT + (up ? 1.05 : 0.35), t.pos.z);
      if (up && this.hand) {
        this.hand.position.set(t.pos.x + 0.28, 0.72 + Math.sin(this.time * 3) * 0.03, t.pos.z - 0.12);
        this.hand.rotation.set(0.3, this.time * 0.6, 0);
      }
    });
  }

  private fly(dt: number): void {
    const f = this.flying;
    if (!f || f.done) return;
    f.age += dt;
    const k = Math.min(1, f.age / FLIGHT);
    f.mesh.position.lerpVectors(f.from, f.to, k);
    f.mesh.position.y += Math.sin(Math.PI * k) * 2.2;
    f.mesh.rotation.set(k * 7, k * 3, 0);
    if (k >= 1) f.done = true;
  }

  /** Bags sit where the rules say: on the sloping board, on the grass, or sinking through the hole. */
  private place(l: Lane, dt: number): void {
    l.bags.forEach((v, i) => {
      const b = l.board.bags[i];
      if (!b) return;
      if (b.state === 'hole') {
        if (v.sink === 0) {
          const at = this.where(l, 0, TOSS.hole.y);
          this.specks.burst(at, P.lamp, { n: 14, speed: 2.2, glow: 1.8, size: 0.05 });
          this.specks.burst(at, l.color, { n: 7, speed: 1.6, glow: 1.4, size: 0.04 });
        }
        v.sink = Math.min(1, v.sink + dt * 3);
        const p = this.where(l, b.x, TOSS.hole.y);
        v.mesh.position.set(l.x + b.x * (1 - v.sink), p.y - v.sink * 0.4, p.z);
        v.mesh.rotation.set(SLOPE + v.sink * 1.2, v.yaw, 0);
        v.mesh.visible = v.sink < 1;
        return;
      }
      const on = onBoard(b.x, b.y);
      v.mesh.position.copy(this.where(l, b.x, b.y));
      v.mesh.rotation.set(on ? SLOPE : 0, v.yaw, 0);
      // Landing: flat for a moment, then it plumps back up.
      v.pop = Math.max(0, v.pop - dt / 0.28);
      const q = Math.sin(v.pop * Math.PI) * v.pop;
      v.mesh.scale.set(1 + q * 0.3, 1 - q * 0.45, 1 + q * 0.3);
    });
    // The board's points float above it.
    const pts = boardScore(l.board).points;
    if (pts !== l.shown) {
      l.shown = pts;
      if (l.label) {
        this.scene.remove(l.label);
        l.label.material.map?.dispose();
        l.label.material.dispose();
      }
      l.label = popSprite(String(pts), l.color, 0.55);
      l.label.position.set(l.x, 1.35, -(TOSS.board.y0 + TOSS.board.y1) / 2);
      this.scene.add(l.label);
    }
    if (l.label) l.label.position.y = 1.35 + Math.sin(this.time * 2 + l.x) * 0.04;
  }
}

// ------------------------------------------------------------------ sounds

function whoosh(sfx: Sfx): void {
  noise(sfx, { dur: 0.3, filter: 'bandpass', freq: 700, to: 1500, gain: 0.18 });
}

function thump(sfx: Sfx, wood: boolean): void {
  noise(sfx, { dur: 0.12, freq: wood ? 520 : 260, to: 120, gain: wood ? 0.4 : 0.25 });
  if (wood) tone(sfx, { freq: 150, to: 95, dur: 0.14, type: 'triangle', gain: 0.12 });
}

function plop(sfx: Sfx): void {
  noise(sfx, { dur: 0.18, freq: 300, to: 80, gain: 0.35 });
  tone(sfx, { freq: 660, dur: 0.12, type: 'triangle', gain: 0.12, delay: 0.08 });
  tone(sfx, { freq: 990, dur: 0.22, type: 'triangle', gain: 0.12, delay: 0.18 });
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'cornhole',
  title: 'Bean Bag Toss',
  how: 'Take turns with your partner to toss bean bags at your board: swipe up, faster goes further. A swipe like your last keeps it straight. On the board is 1 point, through the hole 3. Highest team total wins!',
  controller: 'swipe',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const boards = teams.map(() => newBoard());
    const skill = seats.map(() => ctx.skill());
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT })));
    const view = new Garden(seats, teams, companions, boards);
    ctx.stage.setView(view);

    const teamOf = new Map<number, number>();
    teams.forEach((t, k) => t.forEach((p) => teamOf.set(p, k)));
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const partnerOf = (p: number) => (teams[teamOf.get(p) ?? -1] ?? []).find((m) => m !== p);

    const order = turnOrder(teams);
    const totals = seats.map((_, p) => order.filter((o) => o.player === p).length);
    const done = seats.map(() => 0);
    const prev: (number | null)[] = seats.map(() => null);

    const hud = () =>
      ui.live(
        teams.map((members, k) => {
          const lead = seats[members[0] ?? 0];
          const pts = boardScore(boards[k] as Board).points;
          return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${pts} pt${pts === 1 ? '' : 's'}` };
        }),
      );

    // A swipe from whoever is up.
    let waiting = -1;
    let swiped: number | null = null;
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'swipe' || msg.dir !== 'up' || session.isCpu(seat)) return;
      if (posOf.get(seat) === waiting && swiped === null) swiped = msg.speed;
    });

    hud();
    for (let turn = 0; turn < order.length; turn++) {
      const { team, player } = order[turn] as { team: number; player: number };
      const board = boards[team] as Board;
      const next = order[turn + 1];
      done[player] = (done[player] ?? 0) + 1;
      const nth = done[player] ?? 1;
      const total = totals[player] ?? TOSS.tosses;
      const seat = seats[player];

      // Who's up: the TV, and every phone.
      view.up(player);
      ui.caption(`${nameOf(player)}’s toss · ${nth} of ${total}`, seat?.color);
      seats.forEach((_, p) => {
        const partner = partnerOf(p);
        let layout: Layout;
        if (p === player) {
          const with_ = partner === undefined ? '' : ` You and ${nameOf(partner)} take turns.`;
          layout = { kind: 'swipe', note: `Your toss! Swipe up: faster goes further.${with_} (${nth} of ${total})`, dirs: ['up'], labels: { up: 'Toss' } };
        } else if (partner === player) {
          layout = { kind: 'wait', title: 'Your partner is up', text: `${nameOf(player)} is tossing.` };
        } else {
          layout = { kind: 'wait', title: `${nameOf(player)} is up`, text: next?.player === p ? 'You’re next!' : teamOf.get(p) === next?.team ? 'Your team is next.' : 'Watch the board.' };
        }
        session.setLayout(seatOf(p), layout);
      });
      if (!cpu(player)) session.send(seatOf(player), { t: 'buzz', pattern: [25] });

      // Wait for the swipe (or think, for a computer player), then toss.
      waiting = player;
      swiped = null;
      const cpuAt = 0.45 + rng() * 0.5 + (1 - (skill[player] ?? 0.5)) * 0.3;
      let lob = false;
      await everyFrame(clock, (_, t) => {
        if (cpu(player) && t >= cpuAt) swiped = cpuSpeed(skill[player] ?? 0.5, rng);
        if (swiped === null && t >= AUTO) {
          swiped = 0.42;
          lob = true;
        }
        return swiped !== null;
      });
      waiting = -1;
      const speed = swiped ?? 0.42;
      const toss = planToss(speed, prev[player] ?? null, rng);
      prev[player] = speed;
      if (lob) tell(player, false, 'A gentle lob for you…');
      view.toss(team, toss);
      whoosh(sfx);
      await clock.wait(FLIGHT);

      // It lands, slides and bumps until everything is still.
      const before = boardScore(board);
      const { index, events: first } = landBag(board, player, toss);
      view.landed(team);
      const events: BoardEvent[] = [...first];
      thump(sfx, onBoard(toss.x, toss.y));
      let acc = 0;
      await everyFrame(clock, (dt, t) => {
        acc += dt;
        while (acc >= TOSS.step && !settled(board)) {
          acc -= TOSS.step;
          for (const e of stepBoard(board, index)) {
            events.push(e);
            if (e.kind === 'bump') thump(sfx, false);
          }
        }
        return settled(board) || t >= SLIDE_MAX;
      });
      for (const b of board.bags) if (b.state === 'moving') b.state = 'rest';

      // How did it go?
      const bag = board.bags[index];
      const after = boardScore(board);
      const knocked = events.filter((e) => e.kind === 'hole' && e.knocked).length;
      const gain = after.points - before.points;
      let text: string;
      let good = true;
      if (bag?.state === 'hole') {
        text = first.length ? 'Straight in! +3' : 'In the hole! +3';
        plop(sfx);
        view.cheer(team, 'happy', 2);
      } else if (bag && onBoard(bag.x, bag.y)) {
        text = 'On the board! +1';
        sfx.tick();
      } else {
        good = false;
        const y = bag?.y ?? 0;
        text = y < TOSS.board.y0 ? 'Short… a bit faster next time.' : y > TOSS.board.y1 ? 'Long… a touch slower.' : 'Wide… same swipe again to steady it.';
        view.cheer(team, 'thinking', 1);
      }
      if (knocked) {
        text = `${bag?.state === 'hole' ? 'In, and knocked one in too!' : 'Knocked one in!'} +${gain}`;
        good = true;
        plop(sfx);
        view.cheer(team, 'happy', 2);
      }
      view.say(team, text.split('…')[0] ?? text, good ? '#fff6a8' : '#ffd0d8', bag ? { x: bag.x, y: Math.min(bag.y, TOSS.board.y1) } : undefined);
      tell(player, good, text);
      hud();
      await clock.wait(0.45);
      view.down();
    }
    off();
    ui.caption(null);

    // Done: the bigger total cheers.
    const pts = boards.map((b) => boardScore(b).points);
    const best = Math.max(...pts);
    const tie = pts.length > 1 && pts.every((s) => s === best);
    sfx.good();
    teams.forEach((members, k) => {
      const won = pts[k] === best;
      for (const p of members) {
        companions[p]?.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) companions[p]?.react('happy', 3);
        tell(p, won, tie ? `Level on ${best}! A draw.` : won ? `You win, ${pts[k]} to ${Math.min(...pts)}!` : `Close one: ${pts[k]} to their ${best}.`);
      }
      if (won && !tie) view.say(k, 'Winners!', '#fff6a8');
    });
    await clock.wait(1.8);

    return {
      scores: tossScores(boards, teams, seats.length),
      details: seats.map((_, p) => {
        const k = teamOf.get(p);
        const b = k === undefined ? undefined : boards[k];
        if (!b) return '';
        const s = boardScore(b);
        return `${s.points} point${s.points === 1 ? '' : 's'}${s.holes ? ` · ${s.holes} in the hole` : ''}`;
      }),
    };
  },
};
