// Sketchy on the TV: the kitchen, late. Everyone doodles the same silly prompt on their phone, and the drawings
// appear stroke by stroke on paper stuck to the fridge with magnets. Then the camera leans in on the fridge and
// everyone votes for their favourite (not their own); each vote lands on the paper as a magnet in the voter's
// colour.
import * as THREE from 'three';
import { type CpuSketch, type Drawing, SKETCHY, addChunk, cpuSketch, cpuVote, inkLength, pickPrompt, sketchyScores, tally, voteOptions } from '../../../game/minigames/sketchy';
import { shuffle } from '../../../game/rng';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { Floaters, type Mark, frameMarks, noise, tone } from '../kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ROUNDED_FONT, box, canvasTexture, cyl, gem, mix, part, pill, rbox, seeded, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.55; // companions
const FRIDGE_W = 3.9;
const FRIDGE_H = 6.1;
const FRIDGE_D = 1.2;
const FRONT = FRIDGE_D / 2; // the fridge's front face (z)
const SHEET_W = 1.45;
const SHEET_H = 1.78; // a square drawing plus a strip for the name
const CANVAS_W = 512;
const CANVAS_H = Math.round((CANVAS_W * SHEET_H) / SHEET_W);
const MARGIN = 18; // px around the drawing on the paper
const PAD = CANVAS_W - 2 * MARGIN; // px of drawing per pad width
const LINE = 11; // px
const K = 2.1; // the kitchen is built around a fridge big enough to read from the couch: props at this scale
const WALL = -1.1; // the back wall's face (z)
const FRIDGE = mix(P.sage, P.ceramic, 0.3);
const WALL_COLOR = mix(P.linen, P.ink, 0.22);
const PAPER = '#fbf7ee';
const MAGNETS = [P.terracotta, P.mustard, P.teal, P.mauve, P.rose, P.denim] as const;

/** A fridge magnet: a glossy button with a raised middle. */
function magnet(group: THREE.Object3D, color: string, x: number, y: number, r: number, z = 0.05): void {
  part(group, cyl(r, r, r * 0.6, 20), color, x, y, z, { rx: Math.PI / 2, gloss: 0.6, outline: 0.012 });
  part(group, cyl(r * 0.72, r * 0.72, r * 0.2, 20), mix(color, '#ffffff', 0.18), x, y, z + r * 0.36, { rx: Math.PI / 2, gloss: 0.6, outline: false, shadow: false });
}

// ------------------------------------------------------------------ a sheet of paper on the fridge

class Sheet {
  readonly group = new THREE.Group();
  readonly centre: THREE.Vector3;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly ink: string;
  private last: { x: number; y: number } | null = null;
  private dirty = false;
  private votes = 0;
  /** When it last got a wiggle (the winner's sheet). */
  wiggleAt = -9;
  /** When it was last stuck down (a little press and settle). */
  pressAt = -9;

  constructor(seat: MinigameSeat, x: number, y: number, tilt: number, color: string) {
    this.ink = mix(seat.color, P.ink, 0.12);
    this.centre = new THREE.Vector3(x, y, FRONT + 0.02);
    this.group.position.copy(this.centre);
    this.group.rotation.z = tilt;
    part(this.group, rbox(SHEET_W, SHEET_H, 0.02, 0.008), PAPER, 0, 0, 0, { outline: 0.012 });
    // a sliver of shade under the paper's lower edge, so it sits on the door
    part(this.group, rbox(SHEET_W - 0.06, 0.05, 0.005, 0.002), P.ink, 0.02, -SHEET_H / 2 - 0.012, -0.006, { basic: true, opacity: 0.16, outline: false, shadow: false });
    this.texture = canvasTexture(CANVAS_W, CANVAS_H, (g, w, h) => {
      g.fillStyle = PAPER;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#e4dccb';
      g.lineWidth = 3;
      g.setLineDash([10, 10]);
      g.beginPath();
      g.moveTo(MARGIN, CANVAS_W - 2);
      g.lineTo(w - MARGIN, CANVAS_W - 2);
      g.stroke();
      g.setLineDash([]);
      const mid = CANVAS_W + (h - CANVAS_W) / 2;
      g.fillStyle = seat.color;
      g.beginPath();
      g.arc(MARGIN + 16, mid, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = P.ink;
      g.font = `700 42px ${ROUNDED_FONT}`;
      g.textBaseline = 'middle';
      g.fillText(seat.name, MARGIN + 38, mid + 2, w - MARGIN * 2 - 150);
    });
    this.g = (this.texture.image as HTMLCanvasElement).getContext('2d');
    this.material = new THREE.MeshBasicMaterial({ map: this.texture });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(SHEET_W, SHEET_H), this.material);
    face.position.z = 0.012;
    this.group.add(face);
    // The magnet holding it up.
    magnet(this.group, color, 0, SHEET_H / 2 - 0.1, 0.12);
  }

  /** Draws a chunk of a stroke (pad coordinates). */
  add(pts: readonly number[], start: boolean): void {
    const g = this.g;
    if (!g) return;
    g.strokeStyle = this.ink;
    g.fillStyle = this.ink;
    g.lineWidth = LINE;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = MARGIN + (pts[i] as number) * PAD;
      const y = MARGIN + (pts[i + 1] as number) * PAD;
      g.beginPath();
      if ((start && i === 0) || !this.last) {
        g.arc(x, y, LINE / 2, 0, Math.PI * 2);
        g.fill();
      } else {
        g.moveTo(this.last.x, this.last.y);
        g.lineTo(x, y);
        g.stroke();
      }
      this.last = { x, y };
    }
    this.dirty = true;
  }

  /** A vote: a magnet in the voter's colour on the name strip. Returns it, so it can pop in. */
  addVote(color: string): THREE.Group {
    const m = new THREE.Group();
    m.position.set(SHEET_W / 2 - 0.2 - this.votes * 0.27, -SHEET_H / 2 + 0.165, 0.05);
    magnet(m, color, 0, 0, 0.11, 0);
    m.scale.setScalar(0.001);
    this.group.add(m);
    this.votes++;
    return m;
  }

  /** The paper's corners in world space, for the camera. */
  corners(): THREE.Vector3[] {
    return [-1, 1].flatMap((sx) => [-1, 1].map((sy) => this.centre.clone().add(new THREE.Vector3((sx * SHEET_W) / 2, (sy * SHEET_H) / 2, 0))));
  }

  update(time: number, tilt: number): void {
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
    }
    const age = time - this.wiggleAt;
    this.group.rotation.z = tilt + (age < 2 ? Math.sin(age * 16) * Math.exp(-age * 2.2) * 0.12 : 0);
    const press = time - this.pressAt;
    this.group.scale.setScalar(press < 0.5 ? 1 + Math.sin(press * 22) * Math.exp(-press * 9) * 0.07 : 1);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

/** Where each seat's sheet goes on the fridge doors: two columns, top row first. */
function sheetSpot(i: number, n: number): { x: number; y: number } {
  const col = i % 2;
  const row = Math.floor(i / 2);
  const x = (col === 0 ? -1 : 1) * 0.95;
  if (n <= 2) return { x: n === 1 ? 0 : x, y: 2.6 };
  return { x, y: row === 0 ? 3.55 : 1.55 };
}

/** The prompt, on a sticky note across the freezer door. */
const NOTE = '#f3e3a4';

function promptNote(prompt: string): { group: THREE.Group; texture: THREE.CanvasTexture; material: THREE.MeshBasicMaterial } {
  const group = new THREE.Group();
  const w = 3.3;
  const h = 0.86;
  part(group, rbox(w, h, 0.02, 0.008), NOTE, 0, 0, 0, { outline: 0.012 });
  const texture = canvasTexture(1024, Math.round((1024 * h) / w), (g, cw, ch) => {
    g.fillStyle = NOTE;
    g.fillRect(0, 0, cw, ch);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = mix(NOTE, P.ink, 0.55);
    g.font = `600 34px ${ROUNDED_FONT}`;
    g.fillText("Tonight's doodle", cw / 2, ch * 0.27);
    let size = 76;
    g.font = `800 ${size}px ${ROUNDED_FONT}`;
    while (size > 36 && g.measureText(prompt).width > cw - 70) {
      size -= 4;
      g.font = `800 ${size}px ${ROUNDED_FONT}`;
    }
    g.fillStyle = P.ink;
    g.fillText(prompt, cw / 2, ch * 0.64);
  });
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  face.position.z = 0.012;
  group.add(face);
  for (const x of [-w / 2 + 0.18, w / 2 - 0.18]) magnet(group, x < 0 ? P.terracotta : P.teal, x, h / 2 - 0.1, 0.1);
  return { group, texture, material };
}

// ------------------------------------------------------------------ the camera: the room, then the fridge up close

class Shots {
  private readonly probe = new THREE.PerspectiveCamera();
  private readonly look = new THREE.Vector3();
  private aspect = -1;
  private poses: { pos: THREE.Vector3; look: THREE.Vector3 }[] = [];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly shots: { marks: Mark[]; tilt: number }[],
  ) {}

  /** k: 0 = the first shot, 1 = the second. */
  apply(k: number): void {
    if (this.camera.aspect !== this.aspect) {
      this.aspect = this.camera.aspect;
      this.probe.fov = this.camera.fov;
      this.probe.aspect = this.camera.aspect;
      this.probe.updateProjectionMatrix();
      this.poses = this.shots.map((s) => frameMarks(this.probe, s.marks, s.tilt));
    }
    const a = this.poses[0];
    const b = this.poses[1] ?? a;
    if (!a || !b) return;
    this.camera.position.lerpVectors(a.pos, b.pos, k);
    this.look.lerpVectors(a.look, b.look, k);
    this.camera.lookAt(this.look);
  }
}

// ------------------------------------------------------------------ the kitchen

class Kitchen implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly sheets: Sheet[] = [];
  readonly floaters = new Floaters(this.scene);
  /** 0 = the whole kitchen, 1 = the drawings up close. */
  zoom = 0;
  private readonly tilts: number[] = [];
  private readonly shots: Shots;
  private readonly note: ReturnType<typeof promptNote>;
  private readonly set = new THREE.Group();
  private readonly pendants: THREE.Object3D[] = [];
  private readonly sparks: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private tick: (dt: number, time: number) => void = () => {};
  private time = 0;

  constructor(
    seats: MinigameSeat[],
    readonly people: Companion[],
    prompt: string,
  ) {
    const rig = lightRig(this.scene, 'lampInterior', { shadowSize: 11, fog: { near: 34, far: 90 } });
    rig.sun.target.position.set(0, 2, 0);
    const rand = seeded(41);
    this.buildRoom();
    this.buildFridge();
    this.note = promptNote(prompt);
    this.note.group.position.set(0, 5.42, FRONT + 0.02);
    this.note.group.rotation.z = -0.015;
    this.scene.add(this.note.group);

    const n = seats.length;
    const marks: Mark[] = [
      ...[-1, 1].flatMap((sx) => [0, FRIDGE_H + 0.9].map((y) => ({ p: new THREE.Vector3((sx * FRIDGE_W) / 2, y, FRONT) }))),
    ];
    seats.forEach((s, i) => {
      const spot = sheetSpot(i, n);
      const tilt = (rand() - 0.5) * 0.07;
      const sheet = new Sheet(s, spot.x, spot.y, tilt, MAGNETS[Math.floor(rand() * MAGNETS.length)] as string);
      this.sheets.push(sheet);
      this.tilts.push(tilt);
      this.scene.add(sheet.group);
      // Each artist stands beside the fridge, on the side of their drawing.
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const x = side * (FRIDGE_W / 2 + 0.85 + row * 1.25);
      const z = 1.4 - row * 0.45;
      const c = people[i];
      if (c) {
        c.root.position.set(x, 0, z);
        c.root.rotation.y = -side * 0.3;
        this.scene.add(c.root);
      }
      part(this.scene, torus(0.5, 0.045), s.color, x, 0.03, z, { rx: Math.PI / 2, glow: 1.1, outline: false, shadow: false });
      marks.push({ p: new THREE.Vector3(x, 0, z + 0.4) }, { p: new THREE.Vector3(x, HEIGHT + 0.15, z), pad: 0.04 });
    });
    const close: Mark[] = this.sheets.flatMap((sh) => sh.corners().map((p) => ({ p, pad: 0.015 })));
    this.shots = new Shots(this.camera, [
      { marks, tilt: 0.12 },
      { marks: close, tilt: 0.02 },
    ]);
    this.shots.apply(0);
  }

  private buildRoom(): void {
    const s = this.scene;
    const root = this.set;
    s.add(root);
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, k = K): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(k);
      root.add(o);
      return o;
    };
    const flat = { outline: false as const, shadow: false };
    // Terrazzo floor, a plastered wall, a skirting board.
    part(root, box(44, 0.3, 26), mix(P.clay, P.walnut, 0.22), 0, -0.15, 6, { tex: 'terrazzo', texScale: 3.2, outline: false, shadow: false });
    part(root, box(44, 12, 0.4), WALL_COLOR, 0, 6, WALL - 0.2, { tex: 'plaster', texScale: 5, texStrength: 0.9, ...flat });
    part(root, box(44, 0.3, 0.08), mix(WALL_COLOR, P.ink, 0.3), 0, 0.15, WALL + 0.04, flat);

    // Cabinets either side of the fridge: sink on the left, cooker on the right.
    const run = 3.5; // metres of cabinets per side, before scaling
    const edge = FRIDGE_W / 2 + 0.08;
    const leftX = -edge - (run * K) / 2;
    put(props.kitchenCounter({ w: run, color: P.forest, sink: -0.2 }), leftX, 0, WALL);
    const stoveX = edge + 0.33 * K;
    put(props.stove({ lit: 1 }), stoveX, 0, WALL);
    const rightW = run - 0.66;
    const rightX = edge + 0.66 * K + (rightW * K) / 2;
    put(props.kitchenCounter({ w: rightW, color: P.forest }), rightX, 0, WALL);
    const top = 0.93 * K;
    // Tiles above the worktops, wall cupboards above those.
    for (const side of [-1, 1]) {
      const cx = side * (edge + (run * K) / 2);
      part(root, box(run * K, 1.5, 0.05), P.ceramic, cx, top + 0.75, WALL + 0.025, { tex: 'kitchenTile', texScale: 2.2, gloss: 0.25, ...flat });
      const cup = new THREE.Group();
      part(cup, rbox(run * K, 1.7, 0.85, 0.04), P.forest, 0, 0, 0);
      const doors = 4;
      for (let i = 0; i < doors; i++) {
        const dx = (i - (doors - 1) / 2) * ((run * K) / doors);
        part(cup, rbox((run * K) / doors - 0.1, 1.5, 0.04, 0.015), mix(P.forest, '#ffffff', 0.06), dx, 0, 0.43, { outline: 0.02 });
        part(cup, cyl(0.025, 0.025, 0.3, 6), P.brass, dx + (i % 2 ? -1 : 1) * ((run * K) / doors / 2 - 0.2), -0.45, 0.48, { outline: false, gloss: 0.6 });
      }
      cup.position.set(cx, 5.75, WALL + 0.43);
      root.add(cup);
      // a strip of warm light under the cupboards
      part(root, box(run * K - 0.6, 0.04, 0.12), P.lamp, cx, 4.87, WALL + 0.5, { glow: 1.6, ...flat });
    }
    // On the worktops.
    put(props.plant({ kind: 'trailing', h: 0.3 }), leftX - 2.6, top, WALL + 0.5);
    put(props.plates({ n: 5 }), leftX + 1.3, top, WALL + 0.75);
    put(props.mug({ color: P.terracotta }), leftX + 2.2, top, WALL + 0.9, 0.7);
    put(props.jar({ color: P.mustard }), leftX + 2.9, top, WALL + 0.4);
    put(props.jar({ color: P.terracotta, h: 0.2 }), leftX + 3.2, top, WALL + 0.42);
    put(props.pot({ color: P.copper }), stoveX - 0.3, top, WALL + 0.36);
    put(props.pan(), stoveX + 0.32, top, WALL + 0.95, 0.5);
    put(props.snackBowl({ fill: 'fruit', color: P.ceramic }), rightX - 0.6, top, WALL + 0.7);
    put(props.drink({ kind: 'bottle', color: P.pine }), rightX + 1.0, top, WALL + 0.45);
    put(props.drink({ kind: 'bottle', color: P.copper }), rightX + 1.3, top, WALL + 0.6);
    put(props.plant({ kind: 'snake', h: 0.5, pot: P.ceramic }), rightX + 2.5, top, WALL + 0.6);
    // The night outside, over the sink; shelves of crockery on the other side.
    put(props.windowFrame({ w: 1.15, h: 0.62, time: 'night', seed: 8, sill: false }), leftX - 0.4, top + 0.78, WALL + 0.06, 0, K);
    put(props.wallClock({ color: P.brass }), rightX + 2.2, top + 0.85, WALL + 0.06, 0, K * 1.1);
    // Beyond the cabinets: a tall plant and a picture, so the wall never ends bare.
    put(props.plant({ kind: 'ficus', h: 1.8, pot: P.ceramic, seed: 3 }), edge + run * K + 1.6, 0, WALL + 1.3);
    put(props.pictureFrame({ w: 0.6, h: 0.8, art: 'leaf', frame: P.oak }), -edge - run * K - 1.7, 4.2, WALL + 0.02, 0, K);
    put(props.crate({ s: 0.5 }), -edge - run * K - 1.6, 0, WALL + 1.2, 0.2);
    put(props.plant({ kind: 'fern', h: 0.6 }), -edge - run * K - 1.6, 0.5 * K, WALL + 1.2);
    // Foreground: stools and a low plant at the bottom corners.
    put(props.stool({ h: 0.6, seat: P.terracotta }), 7.5, 0, 3.4, 0.4);
    put(props.plant({ kind: 'monstera', h: 1.0, pot: P.charcoal, seed: 9 }), -7.6, 0, 3.4);
    // Pendant lamps: the room's warm light.
    for (const x of [-5.6, 5.6]) {
      const lamp = put(props.pendantLamp({ drop: 1.35, r: 0.3, shade: P.brass }), x, 9.1, 1.6);
      this.pendants.push(lamp);
      const light = new THREE.PointLight(P.lamp, 26, 15, 1.5);
      light.position.set(x, 5.6, 2.2);
      s.add(light);
    }
    root.add(props.motes({ n: 14, area: [16, 5, 4], size: 0.06 }).translateY(1.5).translateZ(2.5));
    this.tick = props.tickProps(root);
  }

  private buildFridge(): void {
    const s = this.scene;
    const body = { gloss: 0.35 };
    part(s, rbox(FRIDGE_W, FRIDGE_H, FRIDGE_D, 0.22), FRIDGE, 0, FRIDGE_H / 2 + 0.08, 0, body);
    const seam = mix(FRIDGE, P.ink, 0.4);
    part(s, rbox(0.04, 4.6, 0.02, 0.01), seam, 0, 2.5, FRONT + 0.005, { outline: false, shadow: false });
    part(s, rbox(FRIDGE_W - 0.2, 0.04, 0.02, 0.01), seam, 0, 4.82, FRONT + 0.005, { outline: false, shadow: false });
    // Brushed handles on little brackets, a badge, a kick plate.
    const steel = { gloss: 0.7, outline: 0.015 };
    for (const x of [-0.13, 0.13]) {
      part(s, pill(0.045, 0.8), P.stone, x, 4.15, FRONT + 0.1, steel);
      for (const y of [3.78, 4.52]) part(s, cyl(0.03, 0.03, 0.1, 8), P.metal, x, y, FRONT + 0.05, { rx: Math.PI / 2, outline: false });
    }
    part(s, pill(0.045, 1.1), P.stone, 0, 4.97, FRONT + 0.1, { ...steel, rz: Math.PI / 2 });
    for (const x of [-0.5, 0.5]) part(s, cyl(0.03, 0.03, 0.1, 8), P.metal, x, 4.97, FRONT + 0.05, { rx: Math.PI / 2, outline: false });
    part(s, rbox(0.5, 0.11, 0.02, 0.01), P.brass, FRIDGE_W / 2 - 0.5, 5.92, FRONT + 0.01, { gloss: 0.6, outline: false, shadow: false });
    part(s, rbox(FRIDGE_W - 0.3, 0.16, 0.1, 0.03), P.charcoal, 0, 0.1, FRONT - 0.08, { outline: false });
    // On top: a fern, the biscuit tin and last night's pizza boxes.
    const fern = props.plant({ kind: 'fern', h: 0.55, pot: P.terracotta, seed: 5 });
    fern.scale.setScalar(K * 0.8);
    fern.position.set(-1.15, FRIDGE_H + 0.08, 0);
    s.add(fern);
    part(s, cyl(0.42, 0.42, 0.5, 24), P.denim, 0.2, FRIDGE_H + 0.33, 0, { gloss: 0.5 });
    part(s, cyl(0.44, 0.44, 0.08, 24), P.brass, 0.2, FRIDGE_H + 0.62, 0, { gloss: 0.6 });
    for (let i = 0; i < 2; i++) {
      const b = props.pizzaBox({ size: 0.44 });
      b.scale.setScalar(K);
      b.position.set(1.25, FRIDGE_H + 0.08 + i * 0.1, 0.02);
      b.rotation.y = 0.15 - i * 0.3;
      s.add(b);
    }
  }

  dispose(): void {
    for (const c of this.people) c.dispose();
    for (const s of this.sheets) s.dispose();
    for (const sp of this.sparks) this.scene.remove(sp.m);
    this.note.texture.dispose();
    this.note.material.dispose();
    this.floaters.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.shots.apply(this.zoom);
    for (const c of this.people) c.update(dt);
    this.sheets.forEach((s, i) => s.update(time, this.tilts[i] ?? 0));
    this.pendants.forEach((p, i) => (p.rotation.z = Math.sin(time * 0.7 + i * 2) * 0.015));
    this.tick(dt, time);
    this.floaters.update(dt);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i] as (typeof this.sparks)[number];
      sp.age += dt;
      sp.v.y -= dt * 2.2;
      sp.m.position.addScaledVector(sp.v, dt);
      sp.m.rotation.z += dt * 5;
      sp.m.scale.setScalar(Math.max(0.001, 1 - sp.age / 0.9));
      if (sp.age >= 0.9) {
        this.scene.remove(sp.m);
        this.sparks.splice(i, 1);
      }
    }
  }

  /** A little burst of sparkles in front of the fridge (a vote landing, the winner). */
  sparkle(at: THREE.Vector3, color: string, n = 8): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const m = part(this.scene, gem(0.07), i % 2 ? color : P.lamp, at.x, at.y, at.z + 0.12, { glow: 1.8, outline: false, shadow: false });
      this.sparks.push({ m, v: new THREE.Vector3(Math.cos(a) * (0.7 + Math.random()), Math.sin(a) * (0.7 + Math.random()) + 0.5, 0.2), age: 0 });
    }
  }

  get now(): number {
    return this.time;
  }
}

// ------------------------------------------------------------------ sounds

/** A soft pencil scratch. */
function scratch(sfx: Sfx): void {
  noise(sfx, { dur: 0.07, filter: 'bandpass', freq: 3200 + Math.random() * 1600, gain: 0.035 });
}

/** A magnet clicking onto the fridge, pitched up a little for each one. */
function clunk(sfx: Sfx, k: number): void {
  noise(sfx, { dur: 0.06, filter: 'lowpass', freq: 520, gain: 0.3 });
  tone(sfx, { freq: 740 * 1.06 ** k, dur: 0.14, type: 'sine', gain: 0.08 });
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'sketchy',
  title: 'Sketchy',
  how: 'Everyone gets the same silly thing to draw: doodle it on your phone in 25 seconds. Then vote for your favourite drawing on the fridge (not your own). Most votes wins!',
  controller: 'draw',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const prompt = pickPrompt(rng);
    const view = new Kitchen(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), prompt);
    ctx.stage.setView(view);

    const drawings: Drawing[] = seats.map(() => []);
    const done = seats.map(() => false);
    const sketches: (CpuSketch | null)[] = seats.map((_, i) => (session.isCpu(i) ? cpuSketch(rng, ctx.skill()) : null));
    const cursors = seats.map(() => ({ stroke: 0, point: 0, count: 0 }));
    const totals = sketches.map((s) => (s ? s.strokes.reduce((a, st) => a + st.length / 2, 0) : 0));
    const votes: (number | null)[] = seats.map(() => null);
    const voted = seats.map(() => false);
    const ballots = seats.map((_, i) => voteOptions(n, i));
    let phase: 'draw' | 'vote' | 'reveal' = 'draw';
    let voteOpenedAt = 0;
    let scratchAt = -1;

    const ink = (i: number, pts: readonly number[], start: boolean) => {
      const drawing = drawings[i];
      if (!drawing) return;
      const took = addChunk(drawing, pts, start);
      if (!took) return;
      view.sheets[i]?.add(pts.slice(0, took * 2), start);
      if (view.now - scratchAt > 0.12) {
        scratchAt = view.now;
        scratch(sfx);
      }
    };
    /** Draws a computer player's doodle up to `fraction` of its points. */
    const cpuDraw = (i: number, fraction: number) => {
      const sketch = sketches[i];
      const cur = cursors[i];
      if (!sketch || !cur) return;
      const target = Math.floor(Math.min(1, Math.max(0, fraction)) * (totals[i] ?? 0));
      while (cur.count < target) {
        const stroke = sketch.strokes[cur.stroke];
        if (!stroke) break;
        const start = cur.point === 0;
        const chunk: number[] = [];
        while (cur.count < target && cur.point * 2 < stroke.length) {
          chunk.push(stroke[cur.point * 2] as number, stroke[cur.point * 2 + 1] as number);
          cur.point++;
          cur.count++;
        }
        ink(i, chunk, start);
        if (cur.point * 2 >= stroke.length) {
          cur.stroke++;
          cur.point = 0;
        }
      }
    };
    const finish = (i: number) => {
      if (done[i]) return;
      done[i] = true;
      session.setLayout(i, { kind: 'wait', title: 'On the fridge!', text: 'Waiting for the others…' });
      view.people[i]?.react('happy', 1.4);
      const sheet = view.sheets[i];
      if (sheet) sheet.pressAt = view.now;
      clunk(sfx, i);
    };
    const castVote = (voter: number, index: number) => {
      if (voted[voter]) return;
      voted[voter] = true;
      votes[voter] = ballots[voter]?.[index] ?? null;
      session.setLayout(voter, { kind: 'wait', title: 'Vote in!', text: "Let's see who gets the best spot on the fridge…" });
      view.people[voter]?.react('approval', 1.2);
      sfx.tick();
    };

    const off = session.onInput((seat, msg) => {
      if (seat >= n || session.isCpu(seat)) return;
      if (msg.t === 'draw' && phase !== 'reveal' && !done[seat]) ink(seat, msg.pts, msg.start);
      else if (msg.t === 'press' && phase === 'draw') finish(seat);
      // (A late press of the Done button mustn't count as a vote.)
      else if (msg.t === 'press' && phase === 'vote' && clock.time - voteOpenedAt > 0.4) castVote(seat, msg.index);
    });

    // 1. Draw.
    session.setLayoutAll((s) => ({ kind: 'draw', note: `Draw it! You have ${SKETCHY.drawTime} seconds.`, prompt, promptLabel: 'Everyone draws', done: 'Done', ink: seats[s.index]?.color ?? s.color }));
    ui.caption(`Draw: ${prompt}`);
    view.people.forEach((c) => c.setBase('working'));
    let hudAt = -1;
    let humansDoneAt: number | null = null;
    const anyHuman = sketches.some((s) => s === null);
    await everyFrame(clock, (_, t) => {
      const humansDone = anyHuman && seats.every((__, i) => sketches[i] !== null || done[i] || session.isCpu(i));
      if (humansDone && humansDoneAt === null) humansDoneAt = t;
      sketches.forEach((sketch, i) => {
        if (!sketch || done[i]) return;
        const hurry = humansDoneAt === null ? 0 : (t - humansDoneAt) / 1.5;
        cpuDraw(i, Math.max((t - sketch.startAt) / sketch.duration, hurry));
        if ((cursors[i]?.count ?? 0) >= (totals[i] ?? 0)) finish(i);
      });
      if (t - hudAt > 0.25) {
        hudAt = t;
        ui.timer(SKETCHY.drawTime - t);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: done[i] ? 'Done!' : 'Drawing…' })));
      }
      return t >= SKETCHY.drawTime || seats.every((__, i) => done[i] || (session.isCpu(i) && !sketches[i]));
    });
    sketches.forEach((_, i) => cpuDraw(i, 1));
    ui.timer(null);

    // 2. Vote, with the drawings up close.
    phase = 'vote';
    voteOpenedAt = clock.time;
    sfx.whoosh();
    void clock.tween(1.2, (k) => (view.zoom = k));
    view.people.forEach((c) => c.setBase('thinking'));
    seats.forEach((_, i) => {
      const options = ballots[i] ?? [];
      const buttons = options.map((o) => ({ label: seats[o]?.name ?? '?', color: seats[o]?.color }));
      if (buttons.length < 2) buttons.push({ label: 'Pass', color: '#9aa0b4' });
      session.setLayout(i, { kind: 'buttons', title: 'Which one do you like best?', buttons, note: `“${prompt}” · not your own` });
    });
    ui.caption(`Vote for your favourite “${prompt}” on your phone!`);
    const voteAt = seats.map(() => 1.5 + rng() * 5);
    hudAt = -1;
    await everyFrame(clock, (_, t) => {
      seats.forEach((__, i) => {
        if (!voted[i] && session.isCpu(i) && t >= (voteAt[i] ?? 0)) {
          const v = cpuVote(rng, n, i);
          castVote(i, v === null ? -1 : (ballots[i] ?? []).indexOf(v));
        }
      });
      if (t - hudAt > 0.25) {
        hudAt = t;
        ui.timer(SKETCHY.voteTime - t);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: voted[i] ? 'Voted' : 'Choosing…' })));
      }
      return t >= SKETCHY.voteTime || voted.every(Boolean);
    });
    ui.timer(null);

    // 3. The magnets go up.
    phase = 'reveal';
    off();
    session.setLayoutAll(() => ({ kind: 'wait', title: 'Counting the magnets…', text: 'Eyes on the fridge.' }));
    ui.caption('Counting the magnets…');
    await clock.wait(0.6);
    const cast = shuffle(
      rng,
      votes.map((v, voter) => ({ voter, v })).filter((x): x is { voter: number; v: number } => x.v !== null && x.v !== x.voter),
    );
    for (const [k, { voter, v }] of cast.entries()) {
      const sheet = view.sheets[v];
      if (!sheet) continue;
      const m = sheet.addVote(seats[voter]?.color ?? '#ffffff');
      void clock.tween(0.3, (e) => m.scale.setScalar(Math.max(0.001, e)), ease.outBack);
      view.sparkle(m.getWorldPosition(new THREE.Vector3()), seats[voter]?.color ?? P.lamp, 6);
      clunk(sfx, k);
      await clock.wait(0.5);
    }
    const got = tally(votes);
    const inks = drawings.map(inkLength);
    const scores = sketchyScores(got, inks);
    const best = Math.max(...scores);
    const winner = scores.indexOf(best);
    const top = seats[winner];
    if (cast.length && top) {
      sfx.good();
      const sheet = view.sheets[winner];
      if (sheet) {
        sheet.wiggleAt = view.now;
        view.sparkle(sheet.centre, top.color, 16);
        view.floaters.add('Fridge of fame!', top.color, sheet.centre.clone().add(new THREE.Vector3(0, 0, 0.3)), 0.42, 2.2);
      }
      ui.caption(`${top.name}'s drawing gets the best spot on the fridge!`, top.color);
    } else {
      ui.caption('No votes? Every drawing stays on the fridge, then.');
    }
    seats.forEach((_, i) => view.people[i]?.setBase(i === winner && cast.length ? 'happy' : 'approval'));
    ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${got[i] ?? 0} vote${got[i] === 1 ? '' : 's'}` })));
    await clock.wait(2.8);
    ui.caption(null);
    return {
      scores,
      details: got.map((v, i) => `${v === 0 ? 'No' : v} vote${v === 1 ? '' : 's'}${inks[i] && inks[i] > 0 ? '' : ' · blank page'}`),
    };
  },
};
