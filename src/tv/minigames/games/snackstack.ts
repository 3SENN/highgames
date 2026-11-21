// Snack Stack on the TV: a midnight snack session at the kitchen table. Snacks ride little belts toward each plate;
// tap on the beat as one arrives and it lands on your tower. Miss and the tower wobbles; miss again before you
// steady it and the top snack tumbles off. Tallest tower wins.
import * as THREE from 'three';
import { type Chart, type Track, SONGS, makeChart } from '../../../game/minigames/rhythm';
import { SNACK_HEIGHT, type Snack, type Tower, missSnack, newTower, snackSequence, stackSnack, towerDetail, towerScores } from '../../../game/minigames/snackstack';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cyl, mix, part, rbox, seeded, torus } from '../../render/toon';
import type { View } from '../../stage';
import { GROOVES, NoteLane, PhraseCaption, RhythmRound, beatPulse, laneTarget } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const STATION = 3.3;
const SHIFT = -0.42; // the belts reach right, so the stations sit a little left of centre
const TABLE_Y = 0.62;
const BELT_Y = 0.72; // top of the belt
const BELT_Z = 1.12;
const BELT = 2.6;
const PLATE_Z = 0.15;
const TOWER_Y = 0.68;
const TOWER_MAX = 5.2; // taller towers shrink to fit the screen
const COMPANION_Z = -0.95;
const BACK = -3.3; // the back wall
const ROOM_W = 28;
const ROOM_H = 10;
const WALL = mix(P.denim, P.slate, 0.5);
const CABINET = mix(P.forest, P.ink, 0.1);

/** A snack, standing on y = 0. */
function snackModel(kind: Snack, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const o = { shadow: false, outline: false } as const;
  switch (kind) {
    case 'cracker':
      part(g, rbox(0.62, 0.1, 0.62, 0.03), '#dcae66', 0, 0.05, 0);
      part(g, rbox(0.52, 0.02, 0.52, 0.008), '#e8c283', 0, 0.1, 0, o);
      for (const [x, z] of [
        [-0.15, -0.15],
        [0.15, -0.15],
        [-0.15, 0.15],
        [0.15, 0.15],
        [0, 0],
      ] as const)
        part(g, ball(0.028, 1), '#b08040', x, 0.11, z, o);
      break;
    case 'cheese':
      part(g, rbox(0.6, 0.15, 0.48, 0.02), '#f2c64a', 0, 0.075, 0, { gloss: 0.25 });
      part(g, ball(0.05, 1), '#d9a52c', -0.15, 0.07, 0.235, o);
      part(g, ball(0.04, 1), '#d9a52c', 0.13, 0.09, 0.235, o);
      part(g, ball(0.045, 1), '#d9a52c', 0.1, 0.15, -0.05, o);
      break;
    case 'cookie':
      part(g, cyl(0.32, 0.32, 0.11, 22), '#c1844a', 0, 0.055, 0);
      part(g, cyl(0.27, 0.3, 0.02, 22), '#cf9558', 0, 0.115, 0, o);
      for (let k = 0; k < 6; k++) {
        const r = 0.06 + rand() * 0.16;
        part(g, ball(0.04, 1), '#4a2e1c', Math.cos(k * 1.3) * r, 0.12, Math.sin(k * 1.3) * r, o);
      }
      break;
    case 'wafer':
      part(g, rbox(0.66, 0.13, 0.4, 0.02), '#e9a9ba', 0, 0.065, 0);
      for (const y of [0.045, 0.09]) part(g, rbox(0.67, 0.022, 0.41, 0.005), P.cream, 0, y, 0, o);
      break;
    case 'marshmallow':
      part(g, cyl(0.22, 0.22, 0.17, 20), P.cream, 0, 0.085, 0);
      part(g, cyl(0.17, 0.2, 0.012, 20), '#fbf3e6', 0, 0.172, 0, o);
      break;
    case 'sandwich':
      part(g, cyl(0.3, 0.3, 0.05, 22), '#43301f', 0, 0.025, 0);
      part(g, cyl(0.28, 0.28, 0.05, 22), P.cream, 0, 0.075, 0);
      part(g, cyl(0.3, 0.3, 0.05, 22), '#43301f', 0, 0.125, 0);
      break;
    case 'ricecake':
      part(g, cyl(0.33, 0.33, 0.13, 22), '#eadcbb', 0, 0.065, 0);
      for (let k = 0; k < 6; k++) part(g, ball(0.03, 1), '#d2bc92', (rand() - 0.5) * 0.4, 0.13, (rand() - 0.5) * 0.4, o);
      break;
  }
  return g;
}

interface Rig {
  tower: THREE.Group;
  pieces: THREE.Object3D[];
  heights: number[];
  top: number;
  amp: number;
}

function place<T extends THREE.Object3D>(root: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  root.add(obj);
  return obj;
}

class KitchenView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: NoteLane[] = [];
  readonly rigs: Rig[] = [];
  private readonly landing: { obj: THREE.Object3D; y: number; t: number }[] = [];
  private readonly falling: { obj: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private readonly rand = seeded(31);
  private readonly rollers: THREE.Mesh[] = [];
  private readonly tick: (dt: number, time: number) => void;
  private songTime: () => number = () => -1;
  private tracks: readonly Track[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly companions: Companion[],
    private readonly chart: Chart,
    snacks: readonly Snack[],
    private readonly towers: readonly Tower[],
  ) {
    const scene = this.scene;
    const rand = this.rand;
    lightRig(scene, 'lampInterior', { shadowSize: 12 });
    const set = new THREE.Group();
    scene.add(set);
    const flat = { outline: false, shadow: false } as const;
    const plaster = { outline: false, tex: 'plaster', texStrength: 0.9 } as const;

    const n = seats.length;
    const W = n * STATION + 1.4;
    const cx = (i: number) => (i - (n - 1) / 2) * STATION + SHIFT;
    const wall = BACK + 0.02;

    // The kitchen at midnight: terrazzo floor, a slate-green wall, tiles over the worktop.
    part(set, box(ROOM_W + 0.4, 0.2, 26), mix(P.clay, P.cream, 0.3), 0, -0.1, BACK + 13, { ...flat, tex: 'terrazzo', texScale: 2.4 });
    part(set, box(ROOM_W + 0.4, ROOM_H, 0.2), WALL, 0, ROOM_H / 2, BACK - 0.1, plaster);
    for (const s of [-1, 1]) part(set, box(0.2, ROOM_H, 26), mix(WALL, P.ink, 0.1), s * (ROOM_W / 2 + 0.1), ROOM_H / 2, BACK + 13, plaster);
    part(set, box(ROOM_W, 0.2, 0.06), mix(P.cream, WALL, 0.3), 0, 0.1, BACK + 0.04, { outline: false });

    // The worktop along the back wall, with the things a midnight snack needs.
    const runW = W + 1.6;
    const run = -0.4;
    const top = 0.93 * 1.5;
    place(set, props.kitchenCounter({ w: runW / 1.5, color: CABINET, sink: -runW / 1.5 / 2 + 1.0 }), run, 0, BACK, 0, 1.5);
    part(set, box(runW, 1.5, 0.05), P.ceramic, run, top + 0.75, wall, { outline: false, tex: 'kitchenTile', texScale: 1.7, gloss: 0.25 });
    place(set, props.jar({ color: P.mustard, h: 0.2 }), -3.9, top, BACK + 0.45, 0, 2.2);
    place(set, props.jar({ color: P.terracotta }), -3.4, top, BACK + 0.4, 0, 2.2);
    part(set, rbox(0.8, 0.5, 0.45, 0.1), P.stone, 0.6, top + 0.25, BACK + 0.5, { gloss: 0.6 });
    part(set, rbox(0.5, 0.36, 0.06, 0.04), P.sand, 0.6, top + 0.6, BACK + 0.5, { tex: 'wood', texStrength: 0.3 });
    place(set, props.snackBowl({ fill: 'fruit', color: P.ceramic }), 2.4, top, BACK + 0.5, 0, 2);
    place(set, props.plates({ n: 6 }), -1.4, top, BACK + 0.5, 0, 1.9);
    place(set, props.plant({ kind: 'trailing', h: 0.34, pot: P.terracotta }), 4.3, top, BACK + 0.4, 0, 1.8);
    place(set, props.pot({ color: P.copper }), -5.6, top, BACK + 0.5, 0, 1.8);
    // Above it: a window onto the night, shelves of crockery, a clock.
    place(set, props.windowFrame({ w: 1.6, h: 1.4, time: 'night', seed: 4 }), -runW / 2 + 1.3, 4.9, wall, 0, 1.8);
    place(set, props.wallShelf({ w: 1.5, items: 'kitchen', seed: 2 }), 0.2, 4.2, wall, 0, 1.8);
    place(set, props.wallShelf({ w: 1.5, items: 'kitchen', seed: 6 }), 3.6, 5.0, wall, 0, 1.8);
    place(set, props.wallClock({ color: P.brass }), -2.6, 5.6, wall, 0, 2.4);
    // Brass pendants high over the table.
    for (const px of [-W / 3, 0, W / 3]) place(set, props.pendantLamp({ drop: 0.9, shade: P.brass, r: 0.28 }), px + SHIFT, 9.4, 0.4, 0, 1.9);
    const warm = new THREE.PointLight(P.lamp, 16, 24, 1.3);
    warm.position.set(-0.5, 6.4, 1.6);
    scene.add(warm);

    // The fridge stands open, glowing into the room.
    const fx = W / 2 + 0.9;
    part(set, rbox(1.5, 3.0, 1.2, 0.1), P.sage, fx, 1.5, BACK + 1.2, { gloss: 0.3 });
    part(set, rbox(1.3, 2.7, 0.05, 0.02), mix(P.screen, P.sage, 0.35), fx, 1.5, BACK + 1.82, { glow: 0.6, ...flat });
    for (const y of [0.9, 1.7, 2.4]) part(set, rbox(1.25, 0.04, 0.1, 0.01), P.ceramic, fx, y, BACK + 1.86, { outline: false });
    part(set, rbox(0.25, 0.4, 0.2, 0.03), P.denim, fx - 0.3, 1.12, BACK + 1.9, { gloss: 0.4 });
    part(set, cyl(0.12, 0.12, 0.14, 14), P.rose, fx + 0.25, 1.79, BACK + 1.9, { gloss: 0.4 });
    part(set, cyl(0.09, 0.09, 0.3, 14), P.forest, fx - 0.2, 2.57, BACK + 1.9, { gloss: 0.6 });
    part(set, ball(0.12), P.mustard, fx + 0.3, 1.02, BACK + 1.9);
    const hinge = new THREE.Group();
    hinge.position.set(fx + 0.75, 0, BACK + 1.8);
    hinge.rotation.y = 1.9;
    part(hinge, rbox(1.15, 2.9, 0.1, 0.06), mix(P.sage, '#ffffff', 0.08), -0.575, 1.5, 0.05, { gloss: 0.3 });
    part(hinge, cyl(0.025, 0.025, 0.7, 8), P.metal, -1.0, 1.7, -0.06, { outline: false, gloss: 0.7 });
    set.add(hinge);
    const fridgeGlow = new THREE.PointLight(P.screen, 4.5, 8, 1.5);
    fridgeGlow.position.set(fx, 1.6, BACK + 2.7);
    scene.add(fridgeGlow);

    // The long low table on a rug, things at the corners in front.
    place(set, props.rug({ w: W + 1.6, d: 5.6, color: mix(P.terracotta, P.aubergine, 0.2), border: P.sand }), 0, 0, 0.9);
    // In front, on the floor: last night's pizza boxes, a beanbag, a pouf.
    place(set, props.pizzaBox({}), -2.2, 0, 3.6, 0.3, 2.6);
    place(set, props.pizzaBox({ open: true, slices: 2 }), -2.3, 0.12, 3.65, -0.2, 2.6);
    place(set, props.drink({ color: P.teal }), -0.9, 0, 3.9, 0, 2.4);
    place(set, props.beanbag({ color: P.mustard }), W / 2 - 1.4, 0, 3.7, -0.4, 1.7);
    place(set, props.pouf({ color: P.teal, r: 0.4 }), 2.2, 0, 4.2, 0, 1.6);
    part(set, rbox(W, 0.14, 2.0, 0.05), P.oak, 0, TABLE_Y - 0.07, 0.45, { tex: 'wood', texScale: 2 });
    part(set, rbox(W - 0.5, 0.08, 1.6, 0.03), mix(P.oak, P.ink, 0.3), 0, TABLE_Y - 0.2, 0.45, { tex: 'wood', outline: false });
    for (const sx of [-1, 1]) for (const dz of [-0.8, 0.8]) part(set, rbox(0.16, 0.56, 0.16, 0.04), mix(P.oak, P.ink, 0.3), sx * (W / 2 - 0.3), 0.28, 0.45 + dz, { tex: 'wood' });
    place(set, props.stool({ h: 0.5, seat: P.mustard }), -W / 2 - 1.2, 0, 2.6, 0, 1.6);
    place(set, props.plant({ kind: 'ficus', h: 1.7, pot: P.ceramic, seed: 5 }), W / 2 + 2.6, 0, 1.6, 0, 1.5);
    place(set, props.crate({ s: 0.5 }), -W / 2 - 2.6, 0, BACK + 0.9, 0.3, 1.6);
    place(set, props.plant({ kind: 'fern', h: 0.7 }), -W / 2 - 2.6, 0.8, BACK + 0.9, 0, 1.6);
    place(set, props.motes({ n: 16, area: [W, 3, 4], size: 0.05 }), 0, 1, 0.5);

    seats.forEach((s, i) => {
      const x = cx(i);
      const tx = x - 0.7;
      // A floor cushion and a plate with a rim in the player's colour; a little belt in a deep shade of it.
      place(set, props.pouf({ color: mix(s.color, P.ink, 0.1), r: 0.54, h: 0.34 }), x + 0.75, 0, COMPANION_Z);
      part(set, cyl(0.5, 0.42, 0.05, 28), P.cream, tx, TABLE_Y + 0.025, PLATE_Z, { gloss: 0.5 });
      part(set, cyl(0.36, 0.36, 0.052, 28), mix(P.cream, P.sand, 0.25), tx, TABLE_Y + 0.026, PLATE_Z, flat);
      part(set, torus(0.47, 0.03), s.color, tx, TABLE_Y + 0.05, PLATE_Z, { rx: Math.PI / 2, outline: false, gloss: 0.4 });
      const bx = tx + BELT / 2 + 0.05;
      part(set, rbox(BELT + 0.6, 0.07, 0.6, 0.03), P.charcoal, bx, BELT_Y - 0.075, BELT_Z, { tex: 'metalPlate', texStrength: 0.4, gloss: 0.3 });
      part(set, rbox(BELT + 0.5, 0.05, 0.46, 0.02), mix(s.color, P.aubergine, 0.6), bx, BELT_Y - 0.025, BELT_Z, { outline: false });
      for (const dz of [-0.26, 0.26]) part(set, rbox(BELT + 0.56, 0.05, 0.04, 0.015), s.color, bx, BELT_Y - 0.01, BELT_Z + dz, { glow: 0.5, ...flat });
      for (const ex of [-0.22, BELT + 0.32]) this.rollers.push(part(set, cyl(0.075, 0.075, 0.56, 14), P.stone, tx + ex, BELT_Y - 0.05, BELT_Z, { rx: Math.PI / 2, gloss: 0.6 }));

      const tower = new THREE.Group();
      tower.position.set(tx, TOWER_Y, PLATE_Z);
      scene.add(tower);
      this.rigs.push({ tower, pieces: [], heights: [], top: 0, amp: 0 });

      const target = laneTarget(s.color, 0.36);
      target.position.set(0, 0.2, 0);
      const lane = new NoteLane(chart, {
        color: s.color,
        dir: new THREE.Vector3(1, 0, 0),
        length: BELT,
        ahead: chart.beat * 2.5,
        rail: false,
        ticks: 0.44,
        across: new THREE.Vector3(0, 0, 1),
        past: 0.35,
        target,
        marker: (_, k) => {
          const m = new THREE.Group();
          const snack = snackModel(snacks[k] ?? 'cracker', rand);
          snack.scale.setScalar(0.68);
          m.add(snack);
          return m;
        },
        labelAt: new THREE.Vector3(0, 0.95, 0.1),
        labelSize: 0.4,
      });
      lane.group.position.set(tx, BELT_Y + 0.005, BELT_Z);
      scene.add(lane.group);
      this.lanes.push(lane);
    });
    this.tick = props.tickProps(set);

    this.camera.position.set(-0.2, 5.9, 15.6);
    this.camera.lookAt(-1.0, 2.75, 0);

    seats.forEach((_, i) => {
      const c = companions[i];
      if (!c) return;
      const x = cx(i) + 0.75;
      c.root.position.set(x, 0.3, COMPANION_Z);
      c.root.rotation.y = Math.atan2(this.camera.position.x - x, this.camera.position.z - COMPANION_Z) * 0.7;
      c.setBase('idle');
      scene.add(c.root);
    });
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  private fit(rig: Rig): void {
    rig.tower.scale.setScalar(Math.min(1, TOWER_MAX / Math.max(0.01, rig.top)));
  }

  /** A snack lands on top of the tower. */
  stack(seat: number, kind: Snack): void {
    const rig = this.rigs[seat];
    if (!rig) return;
    const piece = snackModel(kind, this.rand);
    const y = rig.top;
    piece.position.set((this.rand() - 0.5) * 0.08, y, (this.rand() - 0.5) * 0.08);
    piece.rotation.y = this.rand() * Math.PI * 2;
    rig.tower.add(piece);
    rig.pieces.push(piece);
    rig.heights.push(SNACK_HEIGHT[kind]);
    rig.top += SNACK_HEIGHT[kind];
    this.landing.push({ obj: piece, y, t: 0 });
    this.fit(rig);
  }

  wobble(seat: number): void {
    const rig = this.rigs[seat];
    if (rig) rig.amp = Math.max(rig.amp, 0.09);
  }

  /** The top snack tumbles off sideways onto the table, and stays there. */
  drop(seat: number): void {
    const rig = this.rigs[seat];
    const piece = rig?.pieces.pop();
    if (!rig || !piece) return;
    rig.top -= rig.heights.pop() ?? 0;
    const k = this.landing.findIndex((l) => l.obj === piece);
    if (k >= 0) this.landing.splice(k, 1);
    piece.scale.setScalar(1);
    this.scene.attach(piece);
    this.falling.push({
      obj: piece,
      v: new THREE.Vector3(-0.9 - this.rand() * 0.6, 1.6, (this.rand() - 0.5) * 0.6),
      spin: new THREE.Vector3((this.rand() - 0.5) * 7, (this.rand() - 0.5) * 4, 3 + this.rand() * 4),
    });
    rig.amp = Math.max(rig.amp, 0.14);
    this.fit(rig);
  }

  update(dt: number, time: number): void {
    const t = this.songTime();
    const playing = t >= 0 && t < this.chart.end;
    const bob = playing ? beatPulse(t, this.chart.beat) : 0;
    this.companions.forEach((c) => {
      c.update(dt);
      c.root.position.y = 0.3 - bob * 0.035;
    });
    this.lanes.forEach((lane, i) => lane.update(t, this.tracks[i]?.judged ?? [], dt));
    if (playing) for (const r of this.rollers) r.rotation.y += dt * 3;

    this.rigs.forEach((rig, i) => {
      const shaky = (this.towers[i]?.wobble ?? 0) >= 1;
      const rest = shaky ? 0.045 : Math.min(0.03, 0.004 + 0.0015 * rig.pieces.length);
      rig.amp = Math.max(rest, rig.amp * Math.exp(-dt * 2.2));
      rig.tower.rotation.z = rig.amp * Math.sin(time * (shaky ? 9 : 2.2) + i);
      rig.tower.rotation.x = rig.amp * 0.4 * Math.sin(time * (shaky ? 7 : 1.7) + i * 2);
    });

    // A snack drops the last bit onto the tower, squashes as it lands and settles.
    for (let k = this.landing.length - 1; k >= 0; k--) {
      const l = this.landing[k] as (typeof this.landing)[number];
      l.t = Math.min(2, l.t + dt / 0.14);
      const fall = Math.min(1, l.t);
      l.obj.position.y = l.y + (1 - fall) ** 2 * 0.55;
      const s = l.t > 1 ? Math.sin((l.t - 1) * Math.PI) * (2 - l.t) : 0;
      l.obj.scale.set(1 + s * 0.12, 1 - s * 0.26, 1 + s * 0.12);
      if (l.t >= 2) {
        l.obj.scale.setScalar(1);
        this.landing.splice(k, 1);
      }
    }

    for (let k = this.falling.length - 1; k >= 0; k--) {
      const f = this.falling[k] as (typeof this.falling)[number];
      f.v.y -= 14 * dt;
      f.obj.position.addScaledVector(f.v, dt);
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      f.obj.rotation.z += f.spin.z * dt;
      if (f.obj.position.y <= TABLE_Y && f.v.y < 0) {
        f.obj.position.y = TABLE_Y;
        f.obj.rotation.x = 0;
        f.obj.rotation.z = (this.rand() - 0.5) * 0.2;
        this.falling.splice(k, 1);
      }
    }
    this.tick(dt, time);
    this.camera.position.set(-0.2 + Math.sin(time * 0.12) * 0.15, 5.9, 15.6);
    this.camera.lookAt(-1.0, 2.75, 0);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const l of this.lanes) l.dispose();
  }
}

export const minigame: Minigame = {
  id: 'snackstack',
  title: 'Snack Stack',
  how: 'Midnight snacks! Tap your phone on the beat as each snack slides onto your plate to stack it. Miss and your tower wobbles; miss again and the top snack tumbles off. Tallest tower wins.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui } = ctx;
    const chart = makeChart(SONGS.snackstack, ctx.rng);
    const snacks = snackSequence(ctx.rng, chart.notes.length);
    const towers = seats.map(() => newTower());
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.45 })));
    const view = new KitchenView(seats, companions, chart, snacks, towers);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'tap',
      groove: GROOVES.kitchen,
      note: 'Tap as a snack reaches your plate',
      onJudge: (seat, j) => {
        const tower = towers[seat];
        if (!tower) return;
        view.lanes[seat]?.hit(j.grade, round.tracks[seat]?.combo);
        const c = view.companions[seat];
        if (j.grade !== 'miss') {
          const snack = snacks[j.note ?? 0] ?? 'cracker';
          stackSnack(tower, snack, j.grade);
          view.stack(seat, snack);
          round.music?.chime(tower.pieces.length, session.isCpu(seat) ? 0.4 : 1);
          if (j.combo > 0 && j.combo % 6 === 0) c?.react('happy', 1.3);
        } else if (missSnack(tower) === 'drop') {
          view.drop(seat);
          round.music?.plop();
          session.send(seat, { t: 'buzz', pattern: [60, 40, 60] });
          lastSad[seat] = now;
          c?.react('sad', 1.2);
        } else {
          view.wobble(seat);
          if (now - (lastSad[seat] ?? -9) > 1.5) {
            lastSad[seat] = now;
            c?.react('sad', 0.8);
          }
        }
      },
    });
    view.attach(round);

    const caption = new PhraseCaption(ui, chart, SONGS.snackstack.phrase, 'Tap', 'Last crumbs…');
    const live = () =>
      ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${towers[i]?.pieces.length ?? 0} snacks` })));
    ui.caption('Tap your phone as each snack reaches your plate');
    let liveAt = -1;
    await round.play((_, t) => {
      now = t;
      caption.update(t);
      if (t - liveAt > 0.2) {
        liveAt = t;
        live();
      }
    });
    live();

    const scores = towerScores(
      towers,
      round.tracks.map((t) => t.perfect),
    );
    const top = Math.max(...scores);
    view.companions.forEach((c, i) => c.setBase(scores[i] === top ? 'happy' : 'idle'));
    ui.caption(null);
    await ctx.clock.wait(1.4);
    return {
      scores,
      details: towers.map((t, i) => towerDetail(t, round.tracks[i]?.perfect ?? 0, (round.tracks[i]?.miss ?? 0) + (round.tracks[i]?.stray ?? 0))),
    };
  },
};
