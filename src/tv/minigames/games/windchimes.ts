// Wind Chimes on the TV: a warm night on the porch. A row of wind chimes hangs from the beam, one per player, the
// tubes in their colour, and everyone sits on the bench underneath. Little leaves drift in on the breeze toward each
// chime's sail; wave your phone as yours arrives and the chime rings. Every tube is tuned to one pentatonic scale,
// so the porch always sounds lovely, whoever is ringing.
import * as THREE from 'three';
import { type Chart, type Grade, type Note, type Track, makeChart } from '../../../game/minigames/rhythm';
import { CHIME_SONG, TUBES, chimeDetail, chimeNote, chimeTube } from '../../../game/minigames/windchimes';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, cone, cyl, mix, part, rbox, seeded } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark, tone } from '../kit';
import { type Groove, NoteLane, PhraseCaption, RhythmRound, beatPulse, laneTarget } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const SPACING = 2.7;
const BEAM_Y = 5.0;
const TOP_Y = 4.5; // a chime's wooden top
const CLAPPER_Y = 3.85;
const SAIL_Y = 3.2; // where the leaves arrive
const LANE_Z = 0.25; // the leaves drift just in front of the chimes
const LANE = 2.0;
const DIR = new THREE.Vector3(1, 0.42, 0).normalize(); // the breeze comes from the upper right
const BENCH_Y = 0.55;
const BENCH_Z = -1.25;
const WOOD = P.sand;
const WALL_Z = -2.95;
const SIDING = mix(P.denim, P.aubergine, 0.3);
const TRIM = mix(P.linen, P.duskWall, 0.25);

function place<T extends THREE.Object3D>(root: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  root.add(obj);
  return obj;
}
const TUBE_LEN = [0.95, 0.85, 0.76, 0.68, 0.6];

/**
 * A dreamy half-time in F (Fmaj9, Dm9, Bbmaj9, C9sus): a soft kick, a brushed snare on three, long warm keys and a
 * sleepy vibraphone line that leaves room for the chimes.
 */
const GROOVE: Groove = {
  chords: [
    [57, 60, 64, 67],
    [57, 60, 64, 65],
    [57, 60, 62, 65],
    [58, 62, 65, 67],
  ],
  bass: [41, 38, 46, 36],
  kick: [0, 10],
  snare: [8],
  hats: [0, 4, 8, 12, 14],
  keys: [0],
  bassSteps: [0, 10],
  swing: 0.1,
  cutoff: 1100,
  lead: [
    [
      [0, 72, 8],
      [8, 69, 8],
    ],
    [
      [4, 74, 6],
      [10, 72, 6],
    ],
    [
      [0, 69, 8],
      [8, 74, 8],
    ],
    [
      [2, 72, 6],
      [8, 67, 8],
    ],
  ],
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A soft bell: a round fundamental that rings on, an inharmonic shimmer above it, and a tiny strike. */
function bell(sfx: Sfx, midi: number, vel: number): void {
  const f = hz(midi);
  tone(sfx, { freq: f, dur: 2.4, gain: 0.055 * vel });
  tone(sfx, { freq: f * 2.76, dur: 0.9, gain: 0.016 * vel });
  tone(sfx, { freq: f * 5.4, dur: 0.22, gain: 0.007 * vel });
}

/** A leaf for a note: bigger on the beat, smaller and paler on the "and". Its child sways; the lane moves it. */
function leafMarker(note: Note, color: string): THREE.Group {
  const g = new THREE.Group();
  const leaf = new THREE.Group();
  const s = note.onBeat ? 1 : 0.72;
  const c = note.onBeat ? color : mix(color, '#ffffff', 0.35);
  part(leaf, ball(0.15), c, 0, 0, 0, { sx: 1.25 * s, sy: 0.7 * s, sz: 0.25 * s, glow: 0.3, shadow: false });
  part(leaf, rbox(0.3 * s, 0.018, 0.02, 0.005), mix(c, '#ffffff', 0.55), 0, 0, 0.035 * s, { outline: false, shadow: false, glow: 0.5 });
  part(leaf, rbox(0.09 * s, 0.018, 0.018, 0.005), mix(c, '#2a2140', 0.35), 0.2 * s, 0, 0, { outline: false, shadow: false, rz: -0.3 });
  leaf.rotation.z = 0.35;
  g.add(leaf);
  return g;
}

interface Chime {
  /** Hangs from the beam: sways as a whole in the breeze. */
  swing: THREE.Group;
  tubes: THREE.Group[];
  /** Per tube: how hard it swings now, and where in its swing it is. */
  amp: number[];
  phase: number[];
  sail: THREE.Group;
  sailAmp: number;
  halo: THREE.Mesh;
  haloT: number;
}

function buildChime(color: string): Chime {
  const swing = new THREE.Group();
  swing.position.y = BEAM_Y;
  part(swing, cyl(0.012, 0.012, BEAM_Y - TOP_Y, 6), '#d9cfe6', 0, -(BEAM_Y - TOP_Y) / 2, 0, { outline: false });
  part(swing, cyl(0.3, 0.3, 0.07, 26), WOOD, 0, TOP_Y - BEAM_Y, 0, { tex: 'wood', texScale: 0.8, gloss: 0.25 });
  part(swing, ball(0.05), mix(color, '#ffffff', 0.4), 0, TOP_Y - BEAM_Y + 0.07, 0);
  const tubes: THREE.Group[] = [];
  for (let k = 0; k < TUBES; k++) {
    // Round the top, the longest at the back so every tube shows.
    const a = Math.PI / 2 + (k / TUBES) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 0.2, TOP_Y - BEAM_Y - 0.05, -Math.sin(a) * 0.12);
    const len = TUBE_LEN[k] as number;
    part(pivot, cyl(0.006, 0.006, 0.1, 4), '#d9cfe6', 0, -0.05, 0, { outline: false });
    part(pivot, cyl(0.048, 0.048, len, 14), mix(color, '#ffffff', 0.12 * (k % 2)), 0, -0.1 - len / 2, 0, { glow: 0.18, gloss: 0.7 });
    part(pivot, cyl(0.05, 0.05, 0.03, 12), mix(color, '#ffffff', 0.5), 0, -0.1, 0, { outline: false });
    swing.add(pivot);
    tubes.push(pivot);
  }
  // The clapper among the tubes, and the cord on down to the sail the wind catches.
  part(swing, cyl(0.006, 0.006, TOP_Y - SAIL_Y, 4), '#d9cfe6', 0, (TOP_Y + SAIL_Y) / 2 - BEAM_Y, 0, { outline: false });
  part(swing, cyl(0.11, 0.11, 0.045, 18), WOOD, 0, CLAPPER_Y - BEAM_Y, 0, { gloss: 0.25 });
  const sail = new THREE.Group();
  sail.position.y = SAIL_Y - BEAM_Y;
  part(sail, cyl(0.15, 0.15, 0.035, 24), WOOD, 0, 0, 0, { rx: Math.PI / 2, gloss: 0.25 });
  part(sail, cone(0.06, 0.1, 5), color, 0, 0, 0.03, { rx: Math.PI / 2, outline: false });
  swing.add(sail);
  const halo = new THREE.Mesh(ball(0.55, 2), new THREE.MeshBasicMaterial({ color: mix(color, '#ffffff', 0.6), transparent: true, opacity: 0, depthWrite: false }));
  halo.position.y = TOP_Y - BEAM_Y - 0.5;
  halo.scale.set(1, 1.2, 0.4);
  halo.visible = false;
  swing.add(halo);
  return { swing, tubes, amp: tubes.map(() => 0), phase: tubes.map((_, k) => k * 1.3), sail, sailAmp: 0, halo, haloT: 0 };
}

interface Blown {
  obj: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  t: number;
  v: THREE.Vector3;
}

class PorchView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: NoteLane[] = [];
  private readonly chimes: Chime[] = [];
  /** Per seat, per note: the swaying leaf inside each marker. */
  private readonly leaves: (THREE.Object3D | null)[][] = [];
  private readonly blown: Blown[][] = [];
  private readonly tick: (dt: number, time: number) => void;
  private readonly marks: Mark[] = [];
  private readonly fit: CameraFit;
  private readonly perp = new THREE.Vector3(-DIR.y, DIR.x, 0);
  private songTime: () => number = () => -1;
  private tracks: readonly Track[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly companions: Companion[],
    private readonly chart: Chart,
  ) {
    const scene = this.scene;
    lightRig(scene, 'moonlit', { fog: { near: 30, far: 95 }, shadowSize: 12 });
    const set = new THREE.Group();
    scene.add(set);
    const rand = seeded(29);
    const flat = { outline: false, shadow: false } as const;

    const n = seats.length;
    const xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    const W = n * SPACING;
    const post = W / 2 + 1.15;
    const HW = W + 3.4; // the house front

    // The garden at night: a dark lawn, a fence and trees either side of the house, flowers by the steps.
    part(set, cyl(70, 70, 0.2, 48), mix(P.grassDark, P.midnight, 0.45), 0, -0.52, 0, { ...flat, tex: 'grass', texScale: 6 });
    for (const side of [-1, 1]) {
      place(set, props.fence({ w: 14, kind: 'panel', h: 2.4, color: mix(P.wood, P.midnight, 0.35) }), side * (HW / 2 + 7), -0.42, WALL_Z - 2);
      [
        ['round', 7, 2.4, -4.5],
        ['pine', 8.5, 5.5, -6.5],
        ['birch', 7.5, 8.5, -5],
        ['round', 6.5, 12, -7],
      ].forEach(([kind, h, dx, dz], k) => place(set, props.tree({ kind: kind as props.TreeKind, h: h as number, seed: k + (side > 0 ? 3 : 11) }), side * (HW / 2 + (dx as number)), -0.42, WALL_Z + (dz as number)));
      place(set, props.bush({ r: 0.95, flowers: side > 0 ? P.mauve : P.cream, seed: 2 + side }), side * (HW / 2 + 1.3), -0.42, -0.6);
      place(set, props.bush({ r: 0.7, flowers: P.rose, seed: 6 + side }), side * (post + 0.4), -0.42, 2.2);
    }
    for (let k = 0; k < 22; k++) {
      const tx = (rand() - 0.5) * (W + 12);
      const tz = 2.0 + rand() * 2.6;
      if (Math.abs(tx) < 1.8) continue;
      place(set, props.tuft({ seed: k + 1, s: 1.2 + rand() * 0.8, ...(rand() < 0.35 ? { flowers: [P.mauve, P.cream, P.rose][k % 3] as string } : {}) }), tx, -0.42, tz, rand() * 6);
    }
    for (let k = 0; k < 3; k++) part(set, cyl(0.5, 0.55, 0.08, 12), P.stone, (k % 2 ? 0.25 : -0.3), -0.4, 3.0 + k * 0.85, { tex: 'stoneTiles', outline: false, ry: k * 1.3 });
    place(set, props.motes({ n: 26, area: [W + 10, 2.6, 5], color: '#d8ff9a', size: 0.09, seed: 9 }), 0, 0.3, 1.6);

    // The porch deck and the steps down at the front.
    part(set, rbox(HW - 0.4, 0.45, 4.6, 0.06), P.wood, 0, -0.22, -0.6, { tex: 'planks', texScale: 2.6 });
    [0, 1].forEach((k) => part(set, rbox(2.6, 0.2, 0.45, 0.04), mix(P.wood, P.ink, 0.1), 0, -0.18 - k * 0.2, 1.85 + k * 0.42, { tex: 'planks' }));

    // The house wall: clapboards in night blue, a lit window and the front door with a little lamp.
    for (let k = 0; k < 14; k++) part(set, rbox(HW - 0.4, 0.46, 0.25, 0.04), k % 2 ? SIDING : mix(SIDING, '#ffffff', 0.05), 0, 0.23 + k * 0.42, WALL_Z, { outline: false, tex: 'planks', texStrength: 0.35 });
    const wx = n > 1 ? (xs[0] as number) + SPACING / 2 : -W / 2 - 0.4; // between two chimes, clear of their rings and words
    const wy = 1.6;
    part(set, rbox(1.7, 1.35, 0.1, 0.04), TRIM, wx, wy, WALL_Z + 0.17);
    part(set, rbox(1.45, 1.1, 0.11, 0.03), P.lamp, wx, wy, WALL_Z + 0.18, { glow: 0.9, ...flat });
    part(set, rbox(0.06, 1.1, 0.12, 0.01), TRIM, wx, wy, WALL_Z + 0.19, { outline: false });
    part(set, rbox(1.45, 0.06, 0.12, 0.01), TRIM, wx, wy, WALL_Z + 0.19, { outline: false });
    part(set, rbox(1.9, 0.07, 0.28, 0.03), TRIM, wx, wy - 0.71, WALL_Z + 0.25);
    const dx = W / 2 + 0.6;
    part(set, rbox(1.1, 2.3, 0.1, 0.04), mix(P.mahogany, P.plum, 0.3), dx, 1.15, WALL_Z + 0.17, { tex: 'wood', gloss: 0.2 });
    for (const y of [0.65, 1.7]) part(set, rbox(0.7, 0.7, 0.03, 0.02), mix(P.mahogany, P.ink, 0.25), dx, y, WALL_Z + 0.23, { outline: false });
    part(set, ball(0.05), P.brass, dx + 0.38, 1.1, WALL_Z + 0.26, { gloss: 0.7 });
    place(set, props.rug({ w: 1.3, d: 0.7, color: P.terracotta, border: P.sand }), dx, 0, -2.3);
    part(set, rbox(0.18, 0.28, 0.18, 0.04), P.charcoal, dx - 0.75, 2.6, WALL_Z + 0.2);
    part(set, ball(0.1), P.lamp, dx - 0.75, 2.6, WALL_Z + 0.33, { glow: 2, shadow: false });
    const porch = new THREE.PointLight(P.lamp, 14, 16, 1.4);
    porch.position.set(dx - 0.9, 3.0, -1.7);
    scene.add(porch);
    const windowGlow = new THREE.PointLight(P.lamp, 9, 10, 1.5);
    windowGlow.position.set(wx, wy, -1.9);
    scene.add(windowGlow);

    // Posts at the ends, the beam the chimes hang from, the roof edge over it with a string of little lights.
    for (const sx of [-1, 1]) {
      part(set, rbox(0.24, BEAM_Y + 0.1, 0.24, 0.04), TRIM, sx * post, BEAM_Y / 2, 0);
      part(set, rbox(0.38, 0.12, 0.38, 0.03), TRIM, sx * post, 0.06, 0);
    }
    part(set, rbox(W + 2.7, 0.24, 0.26, 0.05), TRIM, 0, BEAM_Y + 0.12, 0);
    part(set, rbox(HW, 0.14, 3.6, 0.05), mix(P.plum, P.midnight, 0.4), 0, BEAM_Y + 0.45, -1.2, { rx: 0.12, tex: 'roofTiles', texStrength: 0.6 });
    part(set, rbox(HW + 0.1, 0.1, 0.12, 0.03), TRIM, 0, BEAM_Y + 0.22, 0.58, { outline: false });
    for (let k = 0; k < 3; k++) {
      const x0 = -HW / 2 + (k * HW) / 3;
      set.add(props.stringLights(new THREE.Vector3(x0, BEAM_Y + 0.14, 0.66), new THREE.Vector3(x0 + HW / 3, BEAM_Y + 0.14, 0.66), { sag: 0.16, count: 8, bulb: 0.05 }));
    }

    // The bench along the wall, a cushion in each player's colour.
    const wood = { tex: 'wood', texScale: 1.6 } as const;
    part(set, rbox(W + 0.4, 0.12, 0.8, 0.05), P.oak, 0, BENCH_Y - 0.06, BENCH_Z, wood);
    for (const bx of [-W / 2, 0, W / 2]) part(set, rbox(0.12, BENCH_Y - 0.1, 0.6, 0.03), P.walnut, bx, (BENCH_Y - 0.1) / 2, BENCH_Z, wood);
    part(set, rbox(W + 0.4, 0.12, 0.08, 0.03), P.oak, 0, BENCH_Y + 0.75, BENCH_Z - 0.38, wood);
    seats.forEach((s, i) => part(set, rbox(SPACING - 0.5, 0.12, 0.62, 0.055), mix(s.color, P.ink, 0.1), xs[i] as number, BENCH_Y + 0.05, BENCH_Z, { tex: 'fabric', texStrength: 0.7 }));

    // Tea on a little table at the left, a pot of lavender and a lantern at the right.
    const tx = -post + 0.55;
    place(set, props.sideTable({ h: 0.5, r: 0.3, color: P.walnut }), tx, 0, 0.9, 0, 1.3);
    part(set, ball(0.17, 3), P.teal, tx - 0.08, 0.8, 0.9, { sy: 0.85, gloss: 0.55 });
    part(set, cyl(0.03, 0.04, 0.16, 8), P.teal, tx + 0.12, 0.84, 0.9, { rz: -0.9, gloss: 0.55 });
    place(set, props.mug({ color: P.ceramic }), tx + 0.22, 0.65, 1.08, 0.6, 1.9);
    const px = post - 0.6;
    part(set, cyl(0.24, 0.19, 0.4, 16), P.terracotta, px, 0.2, 1.0, { gloss: 0.2 });
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      part(set, cyl(0.012, 0.012, 0.45, 4), P.pine, px + Math.cos(a) * 0.08, 0.6, 1.0 + Math.sin(a) * 0.08, { rz: Math.cos(a) * 0.25, rx: Math.sin(a) * 0.25, outline: false });
      part(set, ball(0.035, 1), P.mauve, px + Math.cos(a) * 0.14, 0.86, 1.0 + Math.sin(a) * 0.14, flat);
    }
    place(set, props.gardenLamp({ h: 0.3, light: 4 }), px - 0.65, 0, 1.3, 0, 1.8);
    place(set, props.plant({ kind: 'fern', h: 0.8, pot: P.ceramic }), -post + 0.5, 0, -2.2, 0, 1.4);
    this.tick = props.tickProps(set);

    seats.forEach((s, i) => {
      const x = xs[i] as number;
      const chime = buildChime(s.color);
      chime.swing.position.x = x;
      scene.add(chime.swing);
      this.chimes.push(chime);

      const c = companions[i];
      if (c) {
        c.root.position.set(x, BENCH_Y + 0.1, BENCH_Z + 0.05);
        c.setBase('idle');
        scene.add(c.root);
      }

      const leaves: (THREE.Object3D | null)[] = chart.notes.map(() => null);
      const target = laneTarget(s.color, 0.26);
      const lane = new NoteLane(chart, {
        color: s.color,
        dir: DIR,
        length: LANE,
        ahead: chart.beat * 3,
        rail: false,
        ticks: 0.28,
        target,
        flash: 0.32,
        marker: (note, k) => {
          const m = leafMarker(note, s.color);
          leaves[k] = m.children[0] ?? null;
          return m;
        },
        past: 0.5,
        labelAt: new THREE.Vector3(0, -0.6, 0.3),
        labelSize: 0.34,
      });
      lane.group.position.set(x, SAIL_Y, LANE_Z);
      // The breeze: a faint dotted trail the leaves follow.
      for (let k = 1; k <= 9; k++) {
        const p = DIR.clone().multiplyScalar((k / 9) * LANE);
        part(lane.group, ball(0.022, 1), mix(s.color, '#ffffff', 0.5), p.x, p.y, -0.05, { opacity: 0.5, shadow: false, glow: 0.4 });
      }
      scene.add(lane.group);
      this.lanes.push(lane);
      this.leaves.push(leaves);

      // Leaves blown away after a ring.
      const pool: Blown[] = [];
      for (let k = 0; k < 4; k++) {
        const mat = new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0, depthWrite: false });
        const obj = new THREE.Group();
        const m = new THREE.Mesh(ball(0.15, 1), mat);
        m.scale.set(1.2, 0.68, 0.25);
        obj.add(m);
        obj.visible = false;
        scene.add(obj);
        pool.push({ obj, mat, t: 1, v: new THREE.Vector3() });
      }
      this.blown.push(pool);

      const end = DIR.clone().multiplyScalar(LANE).add(new THREE.Vector3(x, SAIL_Y, LANE_Z));
      this.marks.push(
        { p: new THREE.Vector3(x, BEAM_Y + 0.3, 0) },
        { p: new THREE.Vector3(x - 0.45, SAIL_Y, LANE_Z) },
        { p: end, pad: 0.04 },
        { p: new THREE.Vector3(x, SAIL_Y - 0.6, LANE_Z + 0.3), pad: 0.06 },
        { p: new THREE.Vector3(x, BENCH_Y + 1.5, BENCH_Z) },
        { p: new THREE.Vector3(x, 0, BENCH_Z + 0.5) },
      );
    });


    this.fit = new CameraFit(this.camera, 0.1);
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  /** The chime rings: `tube` swings hardest, the others jostle, and the sail and the whole chime sway. */
  ring(seat: number, tube: number, grade: Grade): void {
    const c = this.chimes[seat];
    if (!c) return;
    const strength = grade === 'perfect' ? 1 : 0.7;
    c.amp.forEach((a, k) => (c.amp[k] = Math.max(a, (k === tube ? 0.32 : 0.12) * strength)));
    c.sailAmp = 0.45 * strength;
    c.haloT = 1;
    const pool = this.blown[seat];
    const free = pool?.find((b) => b.t >= 1);
    if (free) {
      free.t = 0;
      free.obj.position.set(c.swing.position.x, SAIL_Y, LANE_Z + 0.1);
      free.v.set(-0.9 - Math.random() * 0.4, 0.5 + Math.random() * 0.3, 0.2);
      free.obj.visible = true;
    }
  }

  judge(seat: number, grade: Grade, combo?: number): void {
    this.lanes[seat]?.hit(grade, combo);
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    const t = this.songTime();
    const playing = t >= 0 && t < this.chart.end;
    const bob = playing ? beatPulse(t, this.chart.beat, 4) : 0;

    this.companions.forEach((c, i) => {
      c.update(dt);
      c.root.rotation.z = Math.sin(t * Math.PI / this.chart.beat / 2 + i) * 0.04 * (playing ? 1 : 0);
      c.root.position.y = BENCH_Y + 0.1 - bob * 0.02;
    });

    this.chimes.forEach((c, i) => {
      // The breeze sways every chime a little; rung tubes swing and settle.
      c.swing.rotation.z = Math.sin(time * 0.7 + i * 1.7) * 0.025;
      c.tubes.forEach((tube, k) => {
        const a = (c.amp[k] ?? 0) * Math.exp(-dt * 1.6);
        c.amp[k] = a;
        c.phase[k] = (c.phase[k] ?? 0) + dt * (5.5 + k * 0.6);
        tube.rotation.z = a * Math.sin(c.phase[k] as number) + Math.sin(time * 1.3 + k) * 0.02;
        tube.rotation.x = a * 0.5 * Math.cos((c.phase[k] as number) * 0.9);
      });
      c.sailAmp *= Math.exp(-dt * 2.2);
      c.sail.rotation.z = c.sailAmp * Math.sin(time * 7) + Math.sin(time * 1.1 + i) * 0.08;
      c.haloT = Math.max(0, c.haloT - dt * 1.6);
      c.halo.visible = c.haloT > 0;
      (c.halo.material as THREE.MeshBasicMaterial).opacity = c.haloT * 0.35;
    });

    this.lanes.forEach((lane, i) => {
      lane.update(t, this.tracks[i]?.judged ?? [], dt);
      // Each leaf flutters across its path as it drifts, settling as it reaches the chime.
      this.leaves[i]?.forEach((leaf, k) => {
        if (!leaf || !leaf.parent?.visible) return;
        const d = leaf.parent.position.dot(DIR);
        const k01 = Math.max(0, Math.min(1, d / LANE));
        const sway = Math.sin(time * 2.3 + k * 1.9) * 0.16 * k01;
        leaf.position.copy(this.perp).multiplyScalar(sway);
        leaf.rotation.z = 0.35 + Math.sin(time * 3.1 + k) * 0.5 * k01;
      });
    });

    for (const pool of this.blown) {
      for (const b of pool) {
        if (b.t >= 1) continue;
        b.t = Math.min(1, b.t + dt / 1.2);
        b.obj.position.addScaledVector(b.v, dt);
        b.v.y -= dt * 0.6;
        b.obj.rotation.z += dt * 4;
        b.mat.opacity = 0.9 * (1 - b.t);
        if (b.t >= 1) b.obj.visible = false;
      }
    }

    this.tick(dt, time);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const l of this.lanes) l.dispose();
    for (const c of this.chimes) (c.halo.material as THREE.Material).dispose();
    for (const pool of this.blown) for (const b of pool) b.mat.dispose();
  }
}

export const minigame: Minigame = {
  id: 'windchimes',
  title: 'Wind Chimes',
  how: 'A warm night on the porch, a wind chime each. Leaves drift in on the breeze: wave your phone side to side as one reaches your chime to ring it. Waving in the quiet bits costs you.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui, sfx } = ctx;
    const chart = makeChart(CHIME_SONG, ctx.rng);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.35, mood: 'idle' })));
    const view = new PorchView(seats, companions, chart);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const rings = seats.map(() => 0);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'wave',
      groove: GROOVE,
      note: 'Wave as a leaf reaches your chime',
      onJudge: (seat, j) => {
        view.judge(seat, j.grade, round.tracks[seat]?.combo);
        const c = view.companions[seat];
        if (j.grade !== 'miss') {
          const tube = chimeTube(rings[seat] ?? 0);
          rings[seat] = (rings[seat] ?? 0) + 1;
          view.ring(seat, tube, j.grade);
          bell(sfx, chimeNote(seat, tube), (j.grade === 'perfect' ? 1 : 0.75) * (session.isCpu(seat) ? 0.45 : 1));
          if (j.combo > 0 && j.combo % 6 === 0) c?.react('happy', 1.4);
        } else if (now - (lastSad[seat] ?? -9) > 1.8) {
          lastSad[seat] = now;
          c?.react('sad', 0.8);
        }
      },
    });
    view.attach(round);

    const caption = new PhraseCaption(ui, chart, CHIME_SONG.phrase, 'Wave', 'Let them ring…');
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${round.tracks[i]?.score ?? 0} pts` })));
    ui.caption('Wave your phone as a leaf reaches your chime');
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

    const scores = round.tracks.map((t) => t.score);
    const top = Math.max(...scores);
    view.companions.forEach((c, i) => c.setBase(scores[i] === top ? 'happy' : 'idle'));
    ui.caption(null);
    await ctx.clock.wait(1.5);
    return { scores, details: round.tracks.map(chimeDetail) };
  },
};
