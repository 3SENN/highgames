// Laundry Fold on the TV: late laundry in the living room, the machine humming at the back. Each team holds a giant
// fitted sheet between them and the arrow on it shows the next fold. Pull together and it folds in half with a soft
// flump; four folds and a neat square goes in the basket. Out of step, and the sheet balls up in a tangle.
import * as THREE from 'three';
import {
  FOLD,
  type FoldDir,
  type SwipeResult,
  cpuFollow,
  cpuLead,
  cpuMisreads,
  expireSheet,
  foldScore,
  foldScores,
  isReady,
  newSheet,
  nextFold,
  otherDir,
  swipeSheet,
} from '../../../game/minigames/laundryfold';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cone, cyl, gem, material, mix, nameCard, part, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SIDE = 4.3; // each team's sheet hangs this far left or right of the middle
const SPREAD = 1.95; // partners stand this far either side of their sheet
const HEIGHT = 1.5; // companions
const SHEET_W = 2.4;
const SHEET_H = 1.6;
const SHEET_Y = 1.45; // the middle of an unfolded sheet
const LAYER = 0.035; // one layer of sheet
const FOLD_TIME = 0.3; // seconds the fold animation takes (shorter than FOLD.settle)
const BASKET_Z = 1.25; // the basket for the finished squares
const BASKET_TOP = 0.36;
const SQUARE_H = 0.075;
const TILT = 0.24; // the camera looks down this much (radians)
const SHEET_COLORS = [P.rose, mix(P.teal, P.cream, 0.25), mix(P.fern, P.cream, 0.4), P.mustard, P.mauve, mix(P.denim, P.cream, 0.3), mix(P.terracotta, P.cream, 0.15)];
const ROOM_H = 5.4;
const ARROW_INK = P.ink;
/** Bed linen: a fine weave over whatever colour the sheet is. */
const CLOTH = { tex: 'fabric' as const, texScale: 0.9, texStrength: 0.5 };
const ROOM_X = -2; // the room is wider on the left, where the camera sees past the score list
const ROOM_W = 23;
const ROOM_D = 8.4;
const BACK = -ROOM_D / 2;

interface Rect {
  w: number;
  h: number;
  cx: number;
  cy: number;
  layers: number;
}

const FULL: Rect = { w: SHEET_W, h: SHEET_H, cx: 0, cy: 0, layers: 0 };
const thickness = (layers: number) => LAYER * (1 + layers * 0.7);

/** The sheet after folding `dir`: the half the arrow points from goes over onto the other half. */
function folded(r: Rect, dir: FoldDir): Rect {
  switch (dir) {
    case 'up':
      return { ...r, h: r.h / 2, cy: r.cy + r.h / 4, layers: r.layers + 1 };
    case 'down':
      return { ...r, h: r.h / 2, cy: r.cy - r.h / 4, layers: r.layers + 1 };
    case 'left':
      return { ...r, w: r.w / 2, cx: r.cx - r.w / 4, layers: r.layers + 1 };
    case 'right':
      return { ...r, w: r.w / 2, cx: r.cx + r.w / 4, layers: r.layers + 1 };
  }
}

const DIR_VEC: Record<FoldDir, [number, number]> = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };
const DIR_ANGLE: Record<FoldDir, number> = { up: 0, left: Math.PI / 2, down: Math.PI, right: -Math.PI / 2 };

// ------------------------------------------------------------------ sounds

/** A cloth swish: someone pulled their corners. */
function swish(sfx: Sfx): void {
  noise(sfx, { dur: 0.14, filter: 'bandpass', freq: 1500, to: 600, gain: 0.12 });
}

/** The soft flump of a neat fold, a little higher every fold of the sheet. */
function flump(sfx: Sfx, step: number): void {
  noise(sfx, { dur: 0.2, filter: 'lowpass', freq: 520, to: 110, gain: 0.32 });
  tone(sfx, { freq: 392 * 1.12 ** step, to: 523 * 1.12 ** step, dur: 0.13, gain: 0.07 });
}

/** Three little notes for a finished square. */
function neat(sfx: Sfx): void {
  tone(sfx, { freq: 660, dur: 0.14, gain: 0.09 });
  tone(sfx, { freq: 880, dur: 0.16, gain: 0.09, delay: 0.09 });
  tone(sfx, { freq: 1320, dur: 0.24, gain: 0.06, delay: 0.18 });
}

/** A muffled bundling-up. */
function bundle(sfx: Sfx): void {
  noise(sfx, { dur: 0.38, filter: 'lowpass', freq: 420, to: 110, gain: 0.3 });
  tone(sfx, { freq: 250, to: 140, dur: 0.32, type: 'triangle', gain: 0.08 });
}

// ------------------------------------------------------------------ the scene

/** The fold arrow, pointing up: a white arrow on a dark backing so it reads on every colour of sheet. */
function arrowShape(): THREE.Group {
  const g = new THREE.Group();
  const layer = (color: string, grow: number, z: number) => {
    part(g, rbox(0.17 * grow, 0.44 + (grow - 1) * 0.3, 0.04, 0.03), color, 0, -0.14, z, { outline: false, shadow: false });
    part(g, cone(0.27 * grow, 0.32 * grow, 24), color, 0, 0.2, z, { sz: 0.15, outline: false, shadow: false });
  };
  layer(ARROW_INK, 1.35, 0);
  layer(P.cream, 1, 0.03);
  return g;
}

interface Flap {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  age: number;
  dir: FoldDir;
  to: Rect;
  square: boolean;
  turned: boolean;
}

interface Flying {
  mesh: THREE.Group;
  age: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

interface Rig {
  x: number;
  members: number[];
  root: THREE.Group;
  rect: Rect;
  color: string;
  sheetNo: number;
  body: THREE.Group;
  flap: Flap | null;
  arrow: THREE.Group;
  hinge: THREE.Group;
  arrowDir: FoldDir | null;
  lump: THREE.Group;
  tangle: number;
  /** 0 → 1 while a fresh or untangled sheet shakes out. */
  unfurl: number;
  /** The fold that just landed squashes a little. */
  pop: number;
  lift: number;
  liftGoal: number;
  piled: number;
  flying: Flying[];
  basket: THREE.Group;
  /** 1 → 0 as a square lands in the basket: it gives a little. */
  thump: number;
}

interface Member {
  companion: Companion;
  x: number;
  side: number;
  color: string;
  ring: THREE.Mesh;
  hop: number;
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

class LaundryView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly rigs: Rig[] = [];
  /** By seat position. */
  readonly members: (Member | undefined)[] = [];
  private readonly companions: Companion[];
  private readonly floaters: Floaters;
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly drum: THREE.Group;
  private readonly env: Env;
  private readonly specks: Specks;
  private readonly machine = new THREE.Group();
  private time = 0;

  constructor(seats: MinigameSeat[], teams: number[][], companions: Companion[]) {
    this.companions = companions;
    this.floaters = new Floaters(this.scene);
    this.specks = new Specks(this.scene, seeded(61));
    // Late evening in the living room: lamps on, dusk in the window.
    this.env = livingRoom(this.scene, { mood: 'evening', w: ROOM_W, d: ROOM_D, h: ROOM_H, rug: false, accent: P.teal, seed: 3 });
    this.env.root.position.x = ROOM_X;
    this.env.sun.target.position.set(0, 0, 0);
    this.drum = this.room();

    teams.forEach((members, team) => {
      const x = (team === 0 ? -1 : 1) * (teams.length > 1 ? SIDE : 0);
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      // Each team's own round rug, in its colour mixed down, with a bright ring to stand in.
      const rug = props.rug({ w: 5.7, round: true, color: mix(color, P.aubergine, 0.6), border: mix(color, P.cream, 0.5), tex: 'knit' });
      rug.position.set(x, 0, 0.4);
      this.scene.add(rug);
      part(this.scene, torus(2.42, 0.03), color, x, 0.03, 0.4, { rx: Math.PI / 2, outline: false, shadow: false, exact: true, glow: 0.3 });
      // A wicker basket for the finished squares.
      const basket = new THREE.Group();
      part(basket, cyl(0.52, 0.42, 0.32, 22), P.oak, 0, 0.16, 0, { tex: 'knit', texScale: 0.3, outline: 0.025 });
      part(basket, torus(0.52, 0.045), P.wood, 0, 0.32, 0, { rx: Math.PI / 2, outline: 0.02 });
      for (let i = 0; i < 3; i++) part(basket, torus(0.5 - i * 0.03, 0.012), P.walnut, 0, 0.08 + i * 0.08, 0, { rx: Math.PI / 2, outline: false, shadow: false });
      for (const e of [-1, 1]) part(basket, torus(0.1, 0.02, Math.PI), P.wood, e * 0.54, 0.3, 0, { ry: Math.PI / 2, outline: false });
      part(basket, cyl(0.45, 0.45, 0.02, 20), P.linen, 0, 0.3, 0, { tex: 'fabric', outline: false, shadow: false });
      basket.position.set(x, 0, BASKET_Z);
      this.scene.add(basket);
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.25);
      card.position.set(x, 0.3, 2.3);
      this.scene.add(card);

      const root = new THREE.Group();
      root.position.set(x, SHEET_Y, 0);
      this.scene.add(root);
      const body = new THREE.Group();
      const arrow = arrowShape();
      const hinge = new THREE.Group();
      const lump = new THREE.Group();
      lump.visible = false;
      arrow.visible = hinge.visible = false;
      root.add(body, arrow, hinge, lump);
      const rig: Rig = {
        x,
        members,
        root,
        rect: { ...FULL },
        color: SHEET_COLORS[team * 3] as string,
        sheetNo: team * 3,
        body,
        flap: null,
        arrow,
        hinge,
        arrowDir: null,
        lump,
        tangle: 0,
        unfurl: 0,
        pop: 0,
        lift: 0,
        liftGoal: 0,
        piled: 0,
        flying: [],
        basket,
        thump: 0,
      };
      this.buildBody(rig);
      this.rigs.push(rig);

      members.forEach((p, m) => {
        const seat = seats[p];
        const c = companions[p];
        if (!seat || !c) return;
        const side = members.length > 1 ? (m === 0 ? -1 : 1) : -1;
        const mx = x + side * SPREAD;
        c.root.position.set(mx, 0, 0.2);
        c.root.rotation.y = -side * 0.55; // turned towards the sheet, still facing the room
        c.setBase('listening');
        this.scene.add(c.root);
        const ring = part(this.scene, torus(0.6, 0.04), seat.color, mx, 0.07, 0.2, { rx: Math.PI / 2, glow: 0.6, outline: false, shadow: false, exact: true });
        this.members[p] = { companion: c, x: mx, side, color: seat.color, ring, hop: 1 };
      });
      for (const side of [-1, 1]) {
        const ex = x + side * (SPREAD + 0.55);
        this.marks.push({ p: new THREE.Vector3(ex, 0, 0.2) }, { p: new THREE.Vector3(ex, HEIGHT + 0.6, 0.2) });
        this.marks.push({ p: new THREE.Vector3(x + side * 1.3, SHEET_Y + SHEET_H / 2 + 0.75, 0) });
        this.marks.push({ p: new THREE.Vector3(x + side * 1.3, 0.3, 2.3), pad: 0.07 });
      }
    });
  }

  /** The laundry corner of the living room: the washing machine mid-cycle, an airer, the pile still to fold. */
  private room(): THREE.Group {
    const s = this.scene;
    const flat = { outline: false as const, shadow: false };
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, y = 0) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      s.add(o);
      return o;
    };
    // The washing machine against the back wall, with a bottle of something lavender on top. It shudders as it spins.
    const m = this.machine;
    const steel = { gloss: 0.5, outline: 0.03 };
    part(m, rbox(1.3, 1.4, 1.1, 0.08), P.ceramic, 0, 0.7, 0, steel);
    part(m, rbox(1.16, 0.2, 0.06, 0.03), mix(P.ceramic, P.slate, 0.3), 0, 1.24, 0.55, { outline: false, gloss: 0.4 });
    part(m, cyl(0.07, 0.07, 0.06, 16), P.metal, 0.38, 1.24, 0.6, { rx: Math.PI / 2, gloss: 0.6, outline: 0.02 });
    part(m, box(0.3, 0.08, 0.01), P.screen, -0.05, 1.24, 0.585, { glow: 1.4, ...flat });
    part(m, sphere(0.03, 8), P.fern, -0.42, 1.24, 0.59, { glow: 1.8, ...flat });
    part(m, torus(0.36, 0.07), mix(P.metal, P.ceramic, 0.5), 0, 0.62, 0.62, { gloss: 0.7, outline: 0.03 });
    part(m, cyl(0.33, 0.33, 0.02, 28), P.midnight, 0, 0.62, 0.56, { rx: Math.PI / 2, basic: true });
    part(m, cyl(0.33, 0.33, 0.02, 28), P.screen, 0, 0.62, 0.65, { rx: Math.PI / 2, basic: true, opacity: 0.22, shadow: false });
    part(m, rbox(0.22, 0.36, 0.14, 0.05), P.mauve, 0.3, 1.58, -0.1, { gloss: 0.4, outline: 0.025 });
    part(m, cyl(0.06, 0.06, 0.08, 12), P.cream, 0.3, 1.8, -0.1, { outline: false });
    part(m, rbox(0.3, 0.2, 0.2, 0.03), P.sand, -0.25, 1.5, -0.05, { outline: 0.025 });
    // Socks going round inside the drum.
    const drum = new THREE.Group();
    drum.position.set(0, 0.62, 0.61);
    [P.rose, P.mustard, P.teal, P.cream].forEach((c, i) => {
      const a = (i / 4) * Math.PI * 2;
      part(drum, sphere(0.07, 10), c, Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0, { sx: 1.5, rz: a, ...flat });
    });
    m.add(drum);
    put(m, 0, BACK + 0.6);
    // A warm pool of light over the middle of the room.
    put(props.pendantLamp({ drop: ROOM_H - 3.6, r: 0.32, lit: true, light: 9, shade: P.brass }), 0, -0.9, 0, ROOM_H);
    // The pile still to fold, in a big basket by the machine, and a couple that missed it.
    const pile = new THREE.Group();
    part(pile, cyl(0.62, 0.5, 0.5, 22), P.oak, 0, 0.25, 0, { tex: 'knit', texScale: 0.3, outline: 0.025 });
    part(pile, torus(0.62, 0.05), P.wood, 0, 0.5, 0, { rx: Math.PI / 2, outline: 0.02 });
    const rand = seeded(19);
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * 0.34;
      part(pile, ball(0.22 + rand() * 0.1, 1), SHEET_COLORS[i % SHEET_COLORS.length] as string, Math.cos(a) * r, 0.52 + rand() * 0.28 + (i > 5 ? 0.2 : 0), Math.sin(a) * r, { sy: 0.75, ...CLOTH, outline: 0.02 });
    }
    put(pile, -1.6, BACK + 0.75);
    part(s, ball(0.24, 1), SHEET_COLORS[4] as string, -2.5, 0.12, BACK + 1.1, { sy: 0.55, ...CLOTH, outline: 0.02 });
    part(s, ball(0.2, 1), SHEET_COLORS[1] as string, -0.85, 0.1, BACK + 1.45, { sy: 0.5, ...CLOTH, outline: 0.02 });
    // An airer with towels over it, on the other side.
    const airer = new THREE.Group();
    const rod = { outline: false as const, gloss: 0.5 };
    for (const e of [-1, 1]) {
      for (const t of [-1, 1]) part(airer, cyl(0.02, 0.02, 1.5, 6), P.ceramic, e * 0.75, 0.7, t * 0.22, { rx: t * 0.3, ...rod });
    }
    const towels = [P.terracotta, P.cream, P.teal, P.mustard];
    for (let i = 0; i < 4; i++) {
      const z = -0.36 + i * 0.24;
      part(airer, cyl(0.014, 0.014, 1.5, 6), P.ceramic, 0, 1.4, z, { rz: Math.PI / 2, ...rod });
      part(airer, rbox(0.42, 0.6 + (i % 2) * 0.25, 0.04, 0.015), towels[i] as string, -0.42 + i * 0.28, 1.4 - (0.6 + (i % 2) * 0.25) / 2 + 0.02, z, { tex: 'terry', texScale: 0.4, outline: 0.02 });
    }
    put(airer, 2.1, BACK + 0.9, 0.12);
    put(props.wallShelf({ w: 1.3, seed: 9 }), 2.2, BACK + 0.01, 0, 2.5);
    // Up front: a low table on a rug with tea and yesterday's folding, a pouf with the ironing pile, a beanbag.
    put(props.rug({ w: 3.4, d: 1.8, color: P.terracotta }), 0, 3.7);
    put(props.coffeeTable({ w: 1.5, d: 0.7, h: 0.38 }), 0, 3.7);
    put(props.mug({ color: P.teal }), 0.5, 3.6, 0.6, 0.38);
    put(props.remote(), 0.25, 3.85, 0.4, 0.38);
    [SHEET_COLORS[6], SHEET_COLORS[2], SHEET_COLORS[4]].forEach((c, i) => part(s, rbox(0.56, 0.07, 0.42, 0.03), c as string, -0.35, 0.415 + i * 0.07, 3.7, { ...CLOTH, ry: (i - 1) * 0.14, outline: 0.02 }));
    put(props.pouf({ color: P.mustard, r: 0.4 }), 5.9, 3.5);
    part(s, rbox(0.62, 0.075, 0.46, 0.03), SHEET_COLORS[1] as string, 5.9, 0.42, 3.5, { ...CLOTH, ry: 0.3, outline: 0.02 });
    part(s, rbox(0.62, 0.075, 0.46, 0.03), SHEET_COLORS[0] as string, 5.9, 0.5, 3.5, { ...CLOTH, ry: -0.1, outline: 0.02 });
    put(props.beanbag({ color: P.teal }), -6.6, 3.6, 0.5);
    put(props.plant({ kind: 'monstera', h: 1.1, pot: P.ceramic, seed: 5 }), -9.4, 3.0);
    // Odd socks that got away.
    for (const [x, z, c, r] of [[-2.6, 2.9, P.rose, 0.4], [2.4, 3.1, P.mustard, 2.1], [3.3, 2.7, P.cream, 1.2]] as const) {
      part(s, rbox(0.3, 0.05, 0.11, 0.025), c, x, 0.03, z, { ry: r, tex: 'knit', texScale: 0.2, outline: 0.02 });
      part(s, rbox(0.11, 0.05, 0.2, 0.025), c, x + Math.cos(r) * 0.12 + Math.sin(r) * 0.06, 0.03, z - Math.sin(r) * 0.12 + Math.cos(r) * 0.06, { ry: r, tex: 'knit', texScale: 0.2, outline: 0.02 });
    }
    return drum;
  }

  /** The sheet as it hangs now. */
  private buildBody(rig: Rig): void {
    rig.body.clear();
    const { w, h, cx, cy, layers } = rig.rect;
    part(rig.body, rbox(w, h, thickness(layers), 0.02), rig.color, cx, cy, 0, { ...CLOTH, outline: 0.03 });
    // A paler hem along the top and bottom, and soft creases where it has been folded.
    const hem = mix(rig.color, P.cream, 0.35);
    const z = thickness(layers) / 2 + 0.002;
    for (const sy of [-1, 1]) part(rig.body, box(w - 0.08, 0.035, 0.004), hem, cx, cy + sy * (h / 2 - 0.06), z, { outline: false, shadow: false });
    if (layers === 0) {
      for (const k of [-1, 1]) part(rig.body, box(0.012, h - 0.2, 0.004), mix(rig.color, P.ink, 0.12), cx + k * (w / 4), cy, z, { outline: false, shadow: false });
      // The fitted corners, gathered with elastic: famously impossible.
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) part(rig.body, ball(0.12, 1), hem, sx * (w / 2 - 0.06), sy * (h / 2 - 0.06), 0.02, { sx: 1, sy: 1, sz: 0.4, ...CLOTH, outline: 0.02 });
      }
    }
  }

  /** The next fold's arrow, and the dashed line it folds along (null: no arrow while the sheet is busy). */
  showArrow(team: number, dir: FoldDir | null): void {
    const rig = this.rigs[team];
    // While the sheet is still folding or balled up (a long frame), the arrow waits for it.
    if (rig && (rig.flap || rig.tangle > 0)) dir = null;
    if (!rig || dir === rig.arrowDir) return;
    rig.arrowDir = dir;
    rig.arrow.visible = rig.hinge.visible = dir !== null;
    if (!dir) return;
    const { w, h, cx, cy, layers } = rig.rect;
    const z = thickness(layers) / 2 + 0.02;
    rig.arrow.position.set(cx, cy, z);
    rig.arrow.rotation.set(0, 0, DIR_ANGLE[dir]);
    rig.arrow.scale.setScalar(Math.max(0.62, Math.min(1, Math.min(w, h) / 1.1)));
    rig.hinge.clear();
    const across = dir === 'left' || dir === 'right';
    const len = (across ? h : w) * 0.9;
    const dashes = Math.max(3, Math.round(len / 0.22));
    for (let i = 0; i < dashes; i++) {
      const at = (i - (dashes - 1) / 2) * (len / dashes);
      const dash = across ? box(0.03, (len / dashes) * 0.55, 0.01) : box((len / dashes) * 0.55, 0.03, 0.01);
      part(rig.hinge, dash, P.cream, across ? cx : cx + at, across ? cy + at : cy, z - 0.01, { basic: true, opacity: 0.8, shadow: false });
    }
  }

  /** Who has pulled and is waiting for their partner (a member index, or null). */
  setWaiting(team: number, member: number | null): void {
    const rig = this.rigs[team];
    if (!rig) return;
    const p = member === null ? undefined : rig.members[member];
    const m = p === undefined ? undefined : this.members[p];
    rig.liftGoal = m ? m.side * 0.07 : 0;
    rig.members.forEach((q) => {
      const mm = this.members[q];
      if (mm) mm.ring.material = material(mm.color, { glow: q === p ? 1.3 : 0.6, exact: true });
    });
  }

  /** A partner pulls their corners: a little hop. */
  pull(p: number): void {
    const m = this.members[p];
    if (m) m.hop = 0;
  }

  fold(team: number, dir: FoldDir, square: boolean): void {
    const rig = this.rigs[team];
    if (!rig) return;
    if (rig.flap) this.endFold(rig);
    this.endTangle(rig);
    const from = rig.rect;
    const to = folded(from, dir);
    const t = thickness(from.layers);
    rig.body.clear();
    part(rig.body, rbox(to.w, to.h, t, 0.02), rig.color, to.cx, to.cy, 0, { ...CLOTH, outline: 0.03 });
    const pivot = new THREE.Group();
    pivot.position.set(from.cx, from.cy, 0);
    const across = dir === 'left' || dir === 'right';
    const [ox, oy] = { up: [0, -from.h / 4], down: [0, from.h / 4], left: [from.w / 4, 0], right: [-from.w / 4, 0] }[dir] as [number, number];
    const mesh = part(pivot, rbox(across ? from.w / 2 : from.w, across ? from.h : from.h / 2, t, 0.02), rig.color, ox, oy, -t, { ...CLOTH, outline: 0.03 });
    rig.body.add(pivot);
    rig.flap = { pivot, mesh, age: 0, dir, to, square, turned: false };
    this.showArrow(team, null);
    for (const p of rig.members) this.members[p]?.companion.react('happy', 0.7);
  }

  tangle(team: number): void {
    const rig = this.rigs[team];
    if (!rig) return;
    if (rig.flap) this.endFold(rig);
    this.showArrow(team, null);
    rig.tangle = FOLD.tangle;
    rig.body.visible = false;
    rig.lump.clear();
    rig.lump.visible = true;
    rig.lump.position.set(rig.rect.cx * 0.5, rig.rect.cy * 0.5 - 0.15, 0.1);
    const rand = seeded(97 + rig.sheetNo * 7 + Math.floor(this.time * 10));
    const light = mix(rig.color, P.cream, 0.3);
    for (let i = 0; i < 8; i++) {
      part(rig.lump, ball(0.2 + rand() * 0.12, 1), i % 2 ? rig.color : light, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.42, (rand() - 0.5) * 0.3, { ...CLOTH, outline: 0.03 });
    }
    this.specks.burst(new THREE.Vector3(rig.x + rig.rect.cx * 0.5, SHEET_Y + rig.rect.cy * 0.5, 0.3), light, { n: 7, speed: 1.4, size: 0.05, up: 0.5 });
    // A loop of elastic and a corner sticking out.
    part(rig.lump, torus(0.15, 0.045), light, 0.38, 0.22, 0.05, { rz: 0.6 });
    part(rig.lump, cone(0.1, 0.32, 10), rig.color, -0.42, -0.12, 0.08, { rz: 1.9 });
    for (const p of rig.members) this.members[p]?.companion.react('sad', 1.1);
  }

  cheer(team: number, text: string): void {
    const rig = this.rigs[team];
    if (rig) this.floaters.add(text, P.lamp, new THREE.Vector3(rig.x, SHEET_Y + SHEET_H / 2 + 0.35, 0.5), 0.6, 2.4);
  }

  say(team: number, text: string, color: string): void {
    const rig = this.rigs[team];
    if (rig) this.floaters.add(text, color, new THREE.Vector3(rig.x + rig.rect.cx, SHEET_Y + rig.rect.cy + rig.rect.h / 2 + 0.3, 0.5), 0.42, 1.1);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.env.update(dt, this.time);
    this.specks.update(dt);
    // Mid-cycle: the machine shudders a little.
    this.machine.position.x = Math.sin(this.time * 31) * 0.004;
    this.machine.rotation.z = Math.sin(this.time * 23) * 0.004;
    this.fit.update(() => this.marks);
    for (const c of this.companions) c.update(dt);
    for (const m of this.members) {
      if (!m) continue;
      m.hop = Math.min(1, m.hop + dt / 0.28);
      m.companion.root.position.y = Math.sin(Math.PI * m.hop) * 0.14;
    }
    for (const rig of this.rigs) this.animate(rig, dt);
    this.drum.rotation.z -= dt * 2.4;
    this.floaters.update(dt);
  }

  private animate(rig: Rig, dt: number): void {
    // The sheet sways gently, and lifts on the side of whoever pulled.
    rig.lift += (rig.liftGoal - rig.lift) * (1 - Math.exp(-12 * dt));
    rig.root.rotation.z = rig.lift + Math.sin(this.time * 1.3 + rig.x) * 0.012;
    rig.root.rotation.x = Math.sin(this.time * 0.9 + rig.x) * 0.03;
    const f = rig.flap;
    if (f) {
      f.age += dt;
      const k = Math.min(1, f.age / FOLD_TIME);
      const a = Math.PI * ease.inOutSine(k);
      if (f.dir === 'up') f.pivot.rotation.x = -a;
      else if (f.dir === 'down') f.pivot.rotation.x = a;
      else if (f.dir === 'left') f.pivot.rotation.y = -a;
      else f.pivot.rotation.y = a;
      f.pivot.position.z = Math.sin(Math.PI * k) * 0.14;
      // Past edge-on we see the back of the fabric, a touch paler.
      if (k >= 0.5 && !f.turned) {
        f.turned = true;
        f.mesh.material = material(mix(rig.color, P.cream, 0.25), CLOTH);
      }
      if (k >= 1) this.endFold(rig);
    }
    if (rig.tangle > 0) {
      rig.tangle -= dt;
      rig.lump.rotation.z = Math.sin(this.time * 9) * 0.18;
      rig.lump.rotation.y += dt * 2.5;
      rig.lump.scale.setScalar(1 + Math.sin(this.time * 14) * 0.06);
      if (rig.tangle <= 0) this.endTangle(rig);
    }
    rig.unfurl = Math.min(1, rig.unfurl + dt / 0.3);
    rig.pop = Math.max(0, rig.pop - dt / 0.25);
    const u = ease.outBack(rig.unfurl);
    const squash = Math.sin(Math.PI * rig.pop) * 0.08;
    rig.body.scale.set(u * (1 + squash), u * (1 - squash), 1);
    if (rig.arrowDir) {
      const [vx, vy] = DIR_VEC[rig.arrowDir];
      const bob = (Math.sin(this.time * 7) * 0.5 + 0.5) * 0.08;
      rig.arrow.position.x = rig.rect.cx + vx * bob;
      rig.arrow.position.y = rig.rect.cy + vy * bob;
    }
    rig.flying = rig.flying.filter((s) => {
      s.age += dt;
      const k = Math.min(1, s.age / 0.5);
      s.mesh.position.lerpVectors(s.from, s.to, ease.outCubic(k));
      s.mesh.position.y += Math.sin(Math.PI * k) * 0.5;
      s.mesh.rotation.x = (Math.PI / 2) * (1 - k);
      if (k < 1) return true;
      // Landed: the basket gives, a little puff of lint.
      rig.thump = 1;
      this.specks.burst(s.to.clone(), P.cream, { n: 6, speed: 1, size: 0.03, up: 0.8 });
      return false;
    });
    rig.thump = Math.max(0, rig.thump - dt / 0.3);
    const give = Math.sin(rig.thump * Math.PI) * rig.thump;
    rig.basket.scale.set(1 + give * 0.07, 1 - give * 0.12, 1 + give * 0.07);
  }

  private endFold(rig: Rig): void {
    const f = rig.flap;
    if (!f) return;
    rig.flap = null;
    rig.rect = f.to;
    rig.pop = 1;
    this.buildBody(rig);
    if (!f.square) return;
    // A neat square: into the basket it goes, and a fresh sheet shakes out.
    const square = new THREE.Group();
    part(square, rbox(0.62, SQUARE_H, 0.46, 0.03), rig.color, 0, 0, 0, { ...CLOTH, outline: 0.025 });
    part(square, box(0.5, 0.01, 0.02), mix(rig.color, P.cream, 0.4), 0, SQUARE_H / 2, 0.1, { outline: false, shadow: false });
    // A neat square: a little glitter where it was folded.
    this.specks.burst(new THREE.Vector3(rig.x + rig.rect.cx, SHEET_Y + rig.rect.cy, 0.3), P.lamp, { n: 12, speed: 2.2, glow: 1.8, size: 0.05 });
    const from = new THREE.Vector3(rig.x + rig.rect.cx, SHEET_Y + rig.rect.cy, 0.1);
    const to = new THREE.Vector3(rig.x + (rig.piled % 2 ? 0.03 : -0.03), BASKET_TOP + SQUARE_H / 2 + rig.piled * SQUARE_H, BASKET_Z);
    square.position.copy(from);
    square.rotation.y = (rig.piled % 3) * 0.12 - 0.12;
    this.scene.add(square);
    rig.flying.push({ mesh: square, age: 0, from, to });
    rig.piled += 1;
    rig.sheetNo += 1;
    rig.color = SHEET_COLORS[rig.sheetNo % SHEET_COLORS.length] as string;
    rig.rect = { ...FULL };
    rig.unfurl = 0;
    this.buildBody(rig);
  }

  private endTangle(rig: Rig): void {
    if (!rig.lump.visible) return;
    rig.tangle = 0;
    rig.lump.visible = false;
    rig.body.visible = true;
    rig.unfurl = 0.35;
  }
}

// ------------------------------------------------------------------ the game

const TANGLE_WORDS: Partial<Record<SwipeResult, { me: string; partner: string }>> = {
  wrong: { me: 'Wrong way! The sheet’s in a tangle…', partner: 'Tangled! Shake it out…' },
  mismatch: { me: 'Different ways! Tangled…', partner: 'Different ways! Tangled…' },
  late: { me: 'Out of step! Tangled…', partner: 'Out of step! Tangled…' },
};

export const minigame: Minigame = {
  id: 'laundryfold',
  title: 'Laundry Fold',
  how: 'Fold a giant fitted sheet with your partner: when the arrow shows, both swipe that way at the same moment. Out of step, and it ends up in a tangle! Most folds wins.',
  controller: 'swipe',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const solo = teams.map((t) => t.length < 2);
    const sheets = teams.map(() => newSheet(rng));
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const skill = seats.map((_, p) => (cpu(p) ? ctx.skill() : 0.5));
    const view = new LaundryView(seats, teams, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);

    const slotOf = new Map<number, { team: number; member: number }>();
    teams.forEach((t, team) => t.forEach((p, member) => slotOf.set(p, { team, member })));
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const partnerOf = (p: number): number | undefined => {
      const w = slotOf.get(p);
      return w && !solo[w.team] ? teams[w.team]?.[1 - w.member] : undefined;
    };
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');

    seats.forEach((s, p) => {
      const w = slotOf.get(p);
      const partner = partnerOf(p);
      const mine = w?.member === 1 ? 'right' : 'left';
      const theirs = w?.member === 1 ? 'left' : 'right';
      session.setLayout(s.index, {
        kind: 'swipe',
        note:
          partner === undefined
            ? 'You fold this one on your own: swipe the arrow’s way twice, quickly!'
            : `You hold the ${mine} corners, ${nameOf(partner)} the ${theirs}. Swipe the arrow’s way together!`,
      });
    });

    let now = 0;
    let frameAt = performance.now();
    let over = false;

    const tangled = (team: number, result: SwipeResult, by: number | null) => {
      view.tangle(team);
      bundle(sfx);
      const words = TANGLE_WORDS[result] ?? TANGLE_WORDS.late;
      for (const p of teams[team] ?? []) {
        tell(p, false, (p === by ? words?.me : words?.partner) ?? 'Tangled!');
        buzz(p, [70, 40, 70]);
      }
      view.say(team, 'Tangled!', '#ffb3c0');
    };

    /** Partner at seat position `p` swipes `dir`; `at` is when their finger moved. */
    const pull = (p: number, dir: FoldDir, at: number) => {
      const w = slotOf.get(p);
      const sheet = w ? sheets[w.team] : undefined;
      if (!w || !sheet || over) return;
      const step = sheet.onSheet;
      const result = swipeSheet(sheet, w.member, dir, at, now, rng, solo[w.team]);
      const partner = partnerOf(p);
      switch (result) {
        case 'ignored':
          return;
        case 'wait':
          view.pull(p);
          swish(sfx);
          if (partner !== undefined) {
            tell(p, true, `Pulled! Now ${nameOf(partner)}…`);
            tell(partner, true, `${nameOf(p)} pulled: swipe now!`);
            buzz(partner, [25]);
          } else tell(p, true, 'One more!');
          return;
        case 'fold':
        case 'square':
          view.pull(p);
          view.fold(w.team, dir, result === 'square');
          flump(sfx, step);
          if (result === 'square') {
            neat(sfx);
            view.say(w.team, 'Neat!', '#ffd166');
          }
          for (const q of teams[w.team] ?? []) {
            tell(q, true, result === 'square' ? `A neat square! ${sheet.folds} folds` : `Folded! ${sheet.folds} so far`);
            buzz(q, [15]);
          }
          return;
        default:
          tangled(w.team, result, p);
      }
    };

    // Computer players: each one plans a pull when the arrow shows, and pulls sooner once its partner has.
    const plans: ({ at: number; dir: FoldDir } | null)[] = seats.map(() => null);
    const planKey = seats.map(() => -1);
    const followed = seats.map(() => false);
    const cpuTurns = (t: number) => {
      teams.forEach((members, team) => {
        const sheet = sheets[team];
        if (!sheet || !isReady(sheet, t)) return;
        const key = sheet.folds * 1000 + sheet.tangles;
        members.forEach((p, member) => {
          if (!cpu(p)) return;
          const s = skill[p] ?? 0.5;
          const other = members[1 - member];
          if (planKey[p] !== key) {
            planKey[p] = key;
            followed[p] = false;
            // With a person for a partner, a computer lets them lead.
            const wait = other !== undefined && !cpu(other) ? 0.45 : 0;
            plans[p] = { at: t + cpuLead(rng, s) + wait, dir: cpuMisreads(rng, s) ? otherDir(rng, nextFold(sheet)) : nextFold(sheet) };
          }
          const plan = plans[p];
          const pend = sheet.pending;
          if (plan && pend && !followed[p] && (pend.member !== member || solo[team])) {
            followed[p] = true;
            plan.at = Math.min(plan.at, pend.at + cpuFollow(rng, s) * (solo[team] ? 0.6 : 1));
          }
          if (plan && t >= plan.at) {
            plans[p] = null;
            pull(p, plan.dir, plan.at);
            // On its own, a computer pulls the other corners right after.
            if (solo[team] && sheet.pending?.member === member) {
              plans[p] = { at: t + 0.12 + (1 - s) * 0.25 + rng() * 0.15, dir: plan.dir };
              followed[p] = true;
            }
          }
        });
      });
    };

    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'swipe' || over || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p === undefined) return;
      // When the finger moved, on the game clock: the message took about half the round trip to arrive.
      const raw = now + Math.max(0, (performance.now() - frameAt) / 1000) * clock.speed;
      const lag = Math.min(0.15, (session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed;
      pull(p, msg.dir, raw - lag);
    });

    ui.caption('Swipe the arrow’s way at the same moment as your partner!');
    let hudAt = -1;
    await everyFrame(clock, (_, t) => {
      now = t;
      frameAt = performance.now();
      cpuTurns(t);
      sheets.forEach((sheet, team) => {
        if (expireSheet(sheet, t, 0.15 * clock.speed)) tangled(team, 'late', null);
        view.showArrow(team, isReady(sheet, t) ? nextFold(sheet) : null);
        view.setWaiting(team, sheet.pending && !solo[team] ? sheet.pending.member : null);
      });
      if (t - hudAt >= 0.1) {
        hudAt = t;
        ui.timer(FOLD.duration - t);
        ui.live(
          teams.map((members, team) => {
            const lead = seats[members[0] ?? 0];
            const n = sheets[team]?.folds ?? 0;
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} fold${n === 1 ? '' : 's'}` };
          }),
        );
      }
      return t >= FOLD.duration;
    });
    over = true;
    off();
    ui.timer(null);
    ui.caption(null);
    teams.forEach((_, team) => {
      view.showArrow(team, null);
      view.setWaiting(team, null);
    });

    // Time! The tidier pile cheers.
    const best = Math.max(...sheets.map(foldScore));
    const tie = sheets.length > 1 && sheets.every((s) => foldScore(s) === best);
    sfx.good();
    teams.forEach((members, team) => {
      const sheet = sheets[team];
      const won = sheet !== undefined && foldScore(sheet) === best;
      for (const p of members) {
        view.members[p]?.companion.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) view.members[p]?.companion.react('happy', 3);
        tell(p, won, tie ? 'Time! Exactly as tidy as each other.' : won ? 'Time! Your team folded the most!' : 'Time! They folded a few more.');
      }
      if (won && !tie) view.cheer(team, 'Tidiest team!');
    });
    await clock.wait(1.6);

    return {
      scores: foldScores(sheets, teams, seats.length),
      details: seats.map((_, p) => {
        const w = slotOf.get(p);
        const s = w ? sheets[w.team] : undefined;
        if (!s) return '';
        return `${s.folds} fold${s.folds === 1 ? '' : 's'}${s.tangles ? ` · ${s.tangles} tangle${s.tangles === 1 ? '' : 's'}` : ''}`;
      }),
    };
  },
};
