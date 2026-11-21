// Scratch Night on the TV: a late-night set in a cosy flat. Everyone stands behind a long sideboard with their own
// turntable, the city asleep in the window behind. Each record turns once a bar and carries the notes round to the
// stylus; swipe your phone as yours reaches the needle and you scratch. The beat lines painted on the record pass
// the needle on every beat, so the rhythm can be read off the spinning vinyl.
import * as THREE from 'three';
import { type Chart, type Grade, type Note, type Track, makeChart } from '../../../game/minigames/rhythm';
import { SCRATCH_SONG, recordAngle, scratchDetail, turnsToStylus } from '../../../game/minigames/scratchnight';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cone, cyl, material, mix, part, rbox, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark, noise, tone } from '../kit';
import { type Groove, NoteLane, PhraseCaption, RhythmRound, beatPulse, laneTarget } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const SPACING = 2.75;
const DESK_TOP = 0.8;
const DECK_Z = 0.1;
const TILT = 0.32; // the turntables lean toward the room on little risers
const RISE = 0.36; // the tilted plinth's middle, above the desk
const PX = -0.2; // the platter sits left of the plinth's middle, the tonearm on the right
const R = 0.74; // the record
const NOTE_R = 0.52; // where the notes ride, and where the stylus sits
const STYLUS = 0; // the stylus at three o'clock on the record
const AHEAD = 3; // beats of notes riding toward the stylus (three quarters of a turn)
const PAST = 0.45; // beats a missed note rides on past it
const FLOOR_Y = 0.6; // the companions stand on a platform behind the sideboard, so their faces show over the decks
const COMPANION_Z = -1.3;
const INK = P.ink;
const VINYL = '#19161f';
const GREY = '#8d879c';
const BACK = -3.3; // the back wall
const ROOM_H = 9;
const WALL = mix(P.plum, P.midnight, 0.45);

function place<T extends THREE.Object3D>(root: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  root.add(obj);
  return obj;
}

/**
 * Lo-fi boom-bap in G minor (Gm9, Ebmaj9, Cm9, D9): a lazy kick, a dusty backbeat, swung hats and a sleepy
 * vibraphone hook.
 */
const GROOVE: Groove = {
  chords: [
    [58, 62, 65, 69],
    [55, 58, 62, 65],
    [58, 62, 63, 67],
    [57, 60, 64, 66],
  ],
  bass: [43, 39, 36, 38],
  kick: [0, 3, 10],
  snare: [4, 12],
  hats: [0, 2, 4, 6, 8, 10, 12, 14, 7],
  keys: [0, 14],
  bassSteps: [0, 3, 10],
  swing: 0.26,
  cutoff: 1400,
  lead: [
    [
      [0, 74, 4],
      [6, 77, 2],
      [8, 74, 2],
      [10, 72, 6],
    ],
    [
      [2, 70, 4],
      [8, 67, 4],
      [12, 70, 4],
    ],
    [
      [0, 72, 6],
      [6, 74, 2],
      [8, 75, 6],
    ],
    [
      [2, 74, 4],
      [8, 72, 2],
      [10, 69, 6],
    ],
  ],
};

/** A scratch: the record pushed and pulled under the hand, a band of noise sweeping up then back down. */
function scratch(sfx: Sfx, vel: number, n: number): void {
  const lift = n % 3 === 2 ? 1.25 : 1; // every third cut a little higher, so runs don't sound stuck
  noise(sfx, { dur: 0.1, filter: 'bandpass', freq: 650 * lift, to: 2600 * lift, gain: 0.2 * vel });
  noise(sfx, { dur: 0.08, filter: 'bandpass', freq: 2300 * lift, to: 700 * lift, gain: 0.15 * vel, delay: 0.095 });
  tone(sfx, { freq: 170 * lift, to: 480 * lift, dur: 0.1, type: 'sawtooth', gain: 0.018 * vel });
  tone(sfx, { freq: 460 * lift, to: 160 * lift, dur: 0.09, type: 'sawtooth', gain: 0.014 * vel, delay: 0.095 });
}

/** A note riding on the record: a round puck on the beat, a smaller bead on the "and". */
function puck(note: Note, color: string): THREE.Group {
  const g = new THREE.Group();
  if (note.onBeat) {
    part(g, cyl(0.12, 0.12, 0.06, 20), color, 0, 0.03, 0, { glow: 0.35, shadow: false });
    part(g, ball(0.06), mix(color, '#ffffff', 0.55), 0, 0.08, 0, { glow: 0.45, shadow: false, outline: false });
  } else {
    part(g, ball(0.075), mix(color, '#ffffff', 0.3), 0, 0.06, 0, { glow: 0.35, shadow: false });
  }
  return g;
}

function greyOut(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.name !== 'outline') mesh.material = material(GREY);
  });
}

/** Where a point on the record at angle `a` (radians, anticlockwise seen from above, 0 at three o'clock) sits. */
function onRecord(a: number, r: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(r * Math.cos(a), y, -r * Math.sin(a));
}

interface Deck {
  /** The tilted plinth: everything on it lies in its x-z plane. */
  tilt: THREE.Group;
  vinyl: THREE.Group;
  /** The notes ride here (centred on the record, not spinning: their angle is worked out from song time). */
  riders: THREE.Group;
  markers: THREE.Object3D[];
  greyed: boolean[];
  arm: THREE.Group;
  lane: NoteLane;
}

/** A turntable in the seat's colour on a little riser; its notes are built for the chart. */
function buildDeck(chart: Chart, color: string): Deck {
  const tilt = new THREE.Group();
  tilt.position.set(0, RISE, 0);
  tilt.rotation.x = TILT;
  // The riser: its front sinks into the sideboard, so it reads as a wedge.
  part(tilt, rbox(1.95, 0.6, 1.5, 0.05), P.walnut, 0, -0.38, 0.03, { tex: 'darkWood' });
  part(tilt, rbox(2.15, 0.16, 1.7, 0.06), mix(color, P.aubergine, 0.7), 0, 0, 0, { gloss: 0.3 });
  part(tilt, rbox(2.17, 0.03, 1.72, 0.015), color, 0, -0.05, 0, { outline: false, glow: 0.7, shadow: false });
  // Platter, record and its label.
  part(tilt, cyl(R + 0.05, R + 0.05, 0.06, 40), P.stone, PX, 0.1, 0, { gloss: 0.6 });
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    part(tilt, rbox(0.03, 0.05, 0.03, 0.01), '#9d97ae', PX + Math.cos(a) * (R + 0.045), 0.1, -Math.sin(a) * (R + 0.045), { outline: false, shadow: false });
  }
  const vinyl = new THREE.Group();
  vinyl.position.set(PX, 0.15, 0);
  tilt.add(vinyl);
  part(vinyl, cyl(R, R, 0.03, 44), VINYL, 0, 0, 0, { gloss: 0.6 });
  for (const r of [0.3, 0.36, 0.42, 0.48, 0.56, 0.62, 0.68]) part(vinyl, torus(r, 0.005), '#322d3c', 0, 0.017, 0, { rx: Math.PI / 2, outline: false, shadow: false });
  part(vinyl, cyl(0.22, 0.22, 0.034, 28), color, 0, 0.002, 0, { outline: false });
  part(vinyl, cyl(0.12, 0.12, 0.036, 20), mix(color, '#ffffff', 0.5), 0, 0.003, 0, { outline: false });
  part(vinyl, cyl(0.025, 0.025, 0.12, 8), '#e6e2ee', 0, 0.04, 0, { outline: false });
  // Beat lines: one per beat, the bar line bold in the seat's colour. The record turns once a bar, so each one
  // passes the stylus on its beat.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const mid = onRecord(a, 0.5, 0.02);
    part(vinyl, rbox(0.42, 0.015, k === 0 ? 0.05 : 0.025, 0.006), k === 0 ? color : '#8f87a3', mid.x, mid.y, mid.z, {
      ry: a,
      outline: false,
      shadow: false,
      ...(k === 0 ? { glow: 0.5 } : {}),
    });
  }

  // The tonearm: from its pivot at the back right down to the stylus at three o'clock.
  const pivot = new THREE.Vector3(0.82, 0.12, -0.58);
  part(tilt, cyl(0.13, 0.15, 0.1, 18), P.stone, pivot.x, 0.1, pivot.z, { gloss: 0.6 });
  const arm = new THREE.Group();
  arm.position.copy(pivot);
  tilt.add(arm);
  const tip = onRecord(STYLUS, NOTE_R, 0).add(new THREE.Vector3(PX, 0, 0));
  const reach = new THREE.Vector3(tip.x - pivot.x, 0, tip.z - pivot.z);
  const len = reach.length();
  arm.rotation.y = Math.atan2(-reach.z, reach.x);
  part(arm, ball(0.07), '#e6e2ee', 0, 0.06, 0);
  part(arm, cyl(0.025, 0.025, len - 0.1, 10), P.ceramic, len / 2 - 0.05, 0.1, 0, { rz: Math.PI / 2, gloss: 0.7 });
  part(arm, rbox(0.17, 0.05, 0.1, 0.02), INK, len - 0.02, 0.09, 0);
  part(arm, cyl(0.06, 0.06, 0.12, 12), '#8f87a3', -0.14, 0.08, 0, { rz: Math.PI / 2 });
  // Knobs and a pitch slider down the right-hand side; a start button front left.
  part(tilt, rbox(0.07, 0.03, 0.6, 0.02), '#211d2b', 0.86, 0.09, 0.3, { outline: false });
  part(tilt, rbox(0.14, 0.05, 0.08, 0.02), '#e6e2ee', 0.86, 0.11, 0.38);
  part(tilt, rbox(0.22, 0.04, 0.14, 0.02), '#e6e2ee', -0.86, 0.09, 0.66);
  part(tilt, cyl(0.04, 0.04, 0.04, 10), P.ember, -0.62, 0.1, 0.68, { glow: 1.4 });

  const riders = new THREE.Group();
  riders.position.set(PX, 0.17, 0);
  tilt.add(riders);
  const markers = chart.notes.map((n) => {
    const m = puck(n, color);
    m.visible = false;
    riders.add(m);
    return m;
  });

  // The kit's lane, without markers of its own: the glowing ring at the stylus, its flash and the words.
  const target = laneTarget(color, 0.16);
  const lane = new NoteLane(chart, {
    color,
    dir: new THREE.Vector3(1, 0, 0),
    length: 1,
    ahead: chart.beat * AHEAD,
    only: () => false,
    rail: false,
    ticks: 0,
    target,
    flash: 0.2,
    labelAt: new THREE.Vector3(0, -0.25, 0.75),
    labelSize: 0.36,
  });
  lane.group.position.copy(onRecord(STYLUS, NOTE_R, 0.02));
  lane.group.rotation.x = -Math.PI / 2; // lay the ring flat on the record
  riders.add(lane.group);

  return { tilt, vinyl, riders, markers, greyed: chart.notes.map(() => false), arm, lane };
}

class FlatView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly decks: Deck[] = [];
  private readonly jogs: number[];
  private readonly leans: number[];
  private readonly woofers: THREE.Object3D[] = [];
  private readonly tick: (dt: number, time: number) => void;
  private readonly lantern: THREE.PointLight;
  private readonly marks: Mark[] = [];
  private readonly fit: CameraFit;
  private readonly tail = new THREE.Group();
  private readonly ear = new THREE.Group();
  private songTime: () => number = () => -1;
  private tracks: readonly Track[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly companions: Companion[],
    private readonly chart: Chart,
  ) {
    const scene = this.scene;
    lightRig(scene, 'nightInterior', { shadowSize: 10 });
    const set = new THREE.Group();
    scene.add(set);
    const flat = { outline: false, shadow: false } as const;
    const plaster = { outline: false, tex: 'plaster', texStrength: 0.9 } as const;

    const n = seats.length;
    const xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    this.jogs = seats.map(() => 0);
    this.leans = seats.map(() => 0);
    const W = n * SPACING;
    const FW = Math.max(26, W + 14);
    const sx = W / 2 + 1.25; // the speakers either side of the sideboard
    const wall = BACK + 0.02;

    // The flat: dark boards, a deep plum wall, a rug in front of the decks.
    part(set, box(FW + 0.4, 0.2, 26), P.wood, 0, -0.1, BACK + 13, { ...flat, tex: 'woodFloor', texScale: 3 });
    part(set, box(FW + 0.4, ROOM_H, 0.2), WALL, 0, ROOM_H / 2, BACK - 0.1, plaster);
    for (const s of [-1, 1]) part(set, box(0.2, ROOM_H, 26), mix(WALL, P.ink, 0.12), s * (FW / 2 + 0.1), ROOM_H / 2, BACK + 13, plaster);
    part(set, box(FW, 0.3, 0.07), mix(WALL, P.cream, 0.25), 0, 0.15, BACK + 0.04, { outline: false });
    place(set, props.rug({ w: W + 2.4, d: 3.6, color: mix(P.mauve, P.aubergine, 0.35), border: P.mustard }), 0, 0, 2.9);

    // A row of tall windows behind the decks: the city asleep, a few windows still lit.
    const ww = Math.max(6.5, W + 0.5);
    const wy = 3.3;
    const panes = Math.max(2, Math.round(ww / 2.7));
    for (let k = 0; k < panes; k++) {
      place(set, props.windowFrame({ w: ww / panes - 0.3, h: 2.6, time: 'night', seed: 3 + k * 5, sill: false, frame: P.linen }), -ww / 2 + (k + 0.5) * (ww / panes), wy, wall);
    }
    part(set, rbox(ww + 0.6, 0.12, 0.42, 0.03), P.linen, 0, wy - 1.5, BACK + 0.2);
    place(set, props.plant({ kind: 'trailing', h: 0.32, pot: P.terracotta }), -ww / 2 + 0.6, wy - 1.44, BACK + 0.2, 0, 1.6);
    place(set, props.candle({ h: 0.14 }), ww / 2 - 0.7, wy - 1.44, BACK + 0.2, 0, 2);
    set.add(props.stringLights(new THREE.Vector3(-ww / 2 - 0.4, wy + 1.75, wall + 0.1), new THREE.Vector3(0, wy + 1.75, wall + 0.1), { sag: 0.22, count: 9, bulb: 0.055 }));
    set.add(props.stringLights(new THREE.Vector3(0, wy + 1.75, wall + 0.1), new THREE.Vector3(ww / 2 + 0.4, wy + 1.75, wall + 0.1), { sag: 0.22, count: 9, bulb: 0.055 }));

    // A neon crescent moon on the wall, left, and a poster on the right.
    part(set, torus(0.42, 0.055, Math.PI * 1.35), P.neonPink, -sx - 0.9, 3.7, BACK + 0.1, { rz: 0.9, glow: 2 });
    part(set, ball(0.05, 1), P.lamp, -sx - 0.4, 4.05, BACK + 0.1, { glow: 2 });
    const neon = new THREE.PointLight(P.neonPink, 5, 9, 1.6);
    neon.position.set(-sx - 0.9, 3.6, BACK + 1.0);
    scene.add(neon);
    place(set, props.pictureFrame({ w: 0.8, h: 1.1, art: 'shapes', frame: P.charcoal, seed: 8 }), sx + 1.0, 3.6, wall, 0, 1.5);

    // The sideboard: a long low walnut cabinet, doors and brass knobs, a darker top.
    part(set, rbox(W + 0.7, DESK_TOP - 0.06, 1.55, 0.05), P.walnut, 0, (DESK_TOP - 0.06) / 2, DECK_Z, { tex: 'wood', texScale: 2 });
    part(set, rbox(W + 0.85, 0.08, 1.65, 0.03), mix(P.walnut, P.ink, 0.3), 0, DESK_TOP - 0.04, DECK_Z, { tex: 'darkWood', gloss: 0.25 });
    seats.forEach((_, i) => {
      const x = xs[i] as number;
      for (const dx of [-0.62, 0.62]) {
        part(set, rbox(1.12, DESK_TOP - 0.3, 0.05, 0.03), mix(P.walnut, P.oak, 0.3), x + dx, (DESK_TOP - 0.06) / 2, DECK_Z + 0.78, { tex: 'wood', outline: 0.015 });
        part(set, ball(0.04, 1), P.brass, x + dx + (dx < 0 ? 0.44 : -0.44), DESK_TOP / 2, DECK_Z + 0.82, { outline: false, gloss: 0.6 });
      }
    });
    // The platform the DJs stand on.
    part(set, rbox(W + 0.6, FLOOR_Y, 1.4, 0.05), P.charcoal, 0, FLOOR_Y / 2, COMPANION_Z);

    // Speakers on the floor either side, a woofer and a tweeter each.
    for (const side of [-1, 1]) {
      const x = side * sx;
      part(set, rbox(1.15, 2.0, 0.95, 0.07), P.walnut, x, 1.0, DECK_Z - 0.2, { tex: 'darkWood' });
      part(set, rbox(0.95, 1.8, 0.05, 0.04), P.charcoal, x, 1.0, DECK_Z + 0.28, { outline: false, tex: 'fabric', texStrength: 0.6 });
      part(set, torus(0.36, 0.04), P.stone, x, 0.72, DECK_Z + 0.3, { outline: false, gloss: 0.5 });
      const woofer = new THREE.Group();
      woofer.position.set(x, 0.72, DECK_Z + 0.28);
      part(woofer, cyl(0.34, 0.34, 0.05, 28), '#15121a', 0, 0, 0, { rx: Math.PI / 2, outline: false });
      part(woofer, cyl(0.12, 0.12, 0.08, 18), P.metal, 0, 0, 0.03, { rx: Math.PI / 2, outline: false, gloss: 0.5 });
      set.add(woofer);
      this.woofers.push(woofer);
      part(set, cyl(0.12, 0.12, 0.05, 18), '#15121a', x, 1.55, DECK_Z + 0.3, { rx: Math.PI / 2, outline: false });
      part(set, torus(0.13, 0.025), P.stone, x, 1.55, DECK_Z + 0.31, { outline: false, gloss: 0.5 });
    }

    // On the left speaker: a takeaway carton of noodles and a mug. On the right: the cat, fast asleep.
    const lx = -sx;
    part(set, cone(0.26, 0.42, 4), P.cream, lx - 0.15, 2.22, DECK_Z - 0.25, { rx: Math.PI, ry: Math.PI / 4 });
    part(set, rbox(0.05, 0.03, 0.05, 0.01), P.brick, lx - 0.15, 2.3, DECK_Z - 0.115, { outline: false });
    for (const dx of [-0.05, 0.05]) part(set, cyl(0.012, 0.012, 0.5, 6), P.sand, lx - 0.2 + dx, 2.5, DECK_Z - 0.25, { rz: 0.35 + dx * 2 });
    place(set, props.mug({ color: P.teal }), lx + 0.3, 2.0, DECK_Z - 0.1, 0.5, 2.6);

    const cx = sx;
    const fur = mix(P.terracotta, P.mustard, 0.5);
    const furDark = mix(fur, P.walnut, 0.4);
    part(set, ball(0.34, 3), fur, cx, 2.18, DECK_Z - 0.25, { sy: 0.55, sx: 1.15 });
    part(set, ball(0.2, 3), fur, cx - 0.3, 2.22, DECK_Z - 0.05, { sy: 0.8 });
    part(set, cone(0.07, 0.13, 8), fur, cx - 0.32, 2.42, DECK_Z - 0.14);
    this.ear.position.set(cx - 0.32, 2.42, DECK_Z + 0.04);
    part(this.ear, cone(0.07, 0.13, 8), fur, 0, 0, 0);
    set.add(this.ear);
    for (const dx of [-0.08, 0.08]) part(set, rbox(0.07, 0.014, 0.02, 0.005), INK, cx - 0.3 + dx, 2.24, DECK_Z + 0.13, { outline: false });
    for (let k = 0; k < 3; k++) part(set, rbox(0.04, 0.02, 0.18, 0.01), furDark, cx + (k - 1) * 0.15, 2.36, DECK_Z - 0.25, { outline: false });
    this.tail.position.set(cx + 0.36, 2.08, DECK_Z - 0.05);
    part(this.tail, cyl(0.045, 0.06, 0.45, 8), fur, 0.2, 0, 0, { rz: Math.PI / 2 });
    part(this.tail, ball(0.05), furDark, 0.43, 0, 0);
    set.add(this.tail);

    // A crate of records on the floor, front left; a plant and a beanbag, front right; a floor lamp in the corner.
    const crx = -W / 2 - 0.2;
    place(set, props.crate({ s: 0.5 }), crx, 0, 1.75, 0, 2);
    [P.rose, P.teal, P.mustard, P.sage, P.mauve, P.terracotta].forEach((c, k) => {
      part(set, rbox(0.82, 0.74, 0.035, 0.02), c, crx, 0.72, 1.42 + k * 0.1, { rx: -0.2 + k * 0.045, outline: false });
    });
    place(set, props.plant({ kind: 'monstera', h: 1.1, seed: 6 }), W / 2 - 0.1, 0, 2.2, 0, 1.6);
    place(set, props.beanbag({ color: P.teal }), W / 4 + 1.2, 0, 3.3, -0.5, 1.6);
    // A low table on the rug with the night's leftovers.
    place(set, props.coffeeTable({ w: 1.7, d: 0.8, color: P.walnut, round: false }), -W / 8, 0, 2.9, 0.1, 1.5);
    place(set, props.pizzaBox({ open: true, slices: 3 }), -W / 8 - 0.5, 0.63, 2.9, 0.3, 2);
    place(set, props.mug({ color: P.rose }), -W / 8 + 0.55, 0.63, 2.75, 0.7, 2);
    place(set, props.drink({ color: P.mustard }), -W / 8 + 0.9, 0.63, 3.05, 0, 2);
    place(set, props.snackBowl({ fill: 'sweets', color: P.ceramic }), -W / 8 + 0.2, 0.63, 3.1, 0, 1.6);
    place(set, props.floorLamp({ h: 1.8, shade: P.clay }), sx + 2.2, 0, BACK + 0.9, 0, 1.6);
    place(set, props.pouf({ color: P.mustard, r: 0.4 }), -sx - 2.2, 0, 2.4, 0, 1.6);

    // A round paper lantern hanging over the decks: the room's warm light.
    part(set, cyl(0.01, 0.01, 3.2, 4), P.ink, W / 4, 6.9, 0.4, flat);
    part(set, ball(0.34, 3), P.lamp, W / 4, 4.9, 0.4, { glow: 1.2, shadow: false });
    this.lantern = new THREE.PointLight(P.lamp, 30, 16, 1.4);
    this.lantern.position.set(W / 4, 4.6, 0.6);
    scene.add(this.lantern);
    place(set, props.motes({ n: 18, area: [W + 4, 3, 5], size: 0.05 }), 0, 1.2, 0.5);
    this.tick = props.tickProps(set);

    // The decks, one per seat, each with its DJ behind it.
    seats.forEach((s, i) => {
      const x = xs[i] as number;
      const deck = buildDeck(chart, s.color);
      const root = new THREE.Group();
      root.position.set(x, DESK_TOP, DECK_Z);
      root.add(deck.tilt);
      scene.add(root);
      this.decks.push(deck);
      const c = companions[i];
      if (c) {
        c.root.position.set(x - 0.1, FLOOR_Y, COMPANION_Z);
        c.setBase('listening');
        scene.add(c.root);
      }
    });

    // Keep the decks, the words over the stylus and the DJs' heads on screen.
    scene.updateMatrixWorld(true);
    this.decks.forEach((deck, i) => {
      const x = xs[i] as number;
      for (const [cx, cz] of [
        [-1.1, -0.9],
        [1.1, -0.9],
        [-1.1, 0.9],
        [1.1, 0.9],
      ] as const)
        this.marks.push({ p: deck.tilt.localToWorld(new THREE.Vector3(cx, 0, cz)) });
      const word = deck.riders.localToWorld(onRecord(STYLUS, NOTE_R, 0.75));
      this.marks.push({ p: word, pad: 0.06 });
      this.marks.push({ p: new THREE.Vector3(x, FLOOR_Y + 1.9, COMPANION_Z) });
    });
    this.marks.push({ p: new THREE.Vector3(-W / 2, 0, DECK_Z + 0.85) }, { p: new THREE.Vector3(W / 2, 0, DECK_Z + 0.85) });

    this.fit = new CameraFit(this.camera, 0.52);
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  /** A good scratch: the record jerks back and forth under the hand, and the DJ leans into it. */
  scratch(seat: number): void {
    this.jogs[seat] = 1;
    this.leans[seat] = (this.leans[seat] ?? 0) > 0 ? -1 : 1;
  }

  judge(seat: number, grade: Grade, combo?: number): void {
    this.decks[seat]?.lane.hit(grade, combo);
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    const t = this.songTime();
    const chart = this.chart;
    const playing = t >= 0 && t < chart.end;
    const bob = playing ? beatPulse(t, chart.beat) : 0;
    const spin = recordAngle(chart, Math.min(t, chart.end));

    this.decks.forEach((deck, i) => {
      // The record: one turn a bar, plus a quick jog back and forth on a scratch.
      const k = Math.max(0, (this.jogs[i] ?? 0) - dt * 4.5);
      this.jogs[i] = k;
      const jog = k > 0 ? Math.sin((1 - k) * Math.PI * 2) * 0.35 * k : 0;
      deck.vinyl.rotation.y = STYLUS + spin + jog;
      deck.arm.rotation.z = jog * 0.08;

      const judged = this.tracks[i]?.judged ?? [];
      chart.notes.forEach((note, j) => {
        const m = deck.markers[j] as THREE.Object3D;
        const g = judged[j] ?? null;
        const ahead = (note.time - t) / chart.beat;
        if (g === 'perfect' || g === 'good' || ahead > AHEAD || ahead < -PAST) {
          m.visible = false;
          return;
        }
        if (g === 'miss' && !deck.greyed[j]) {
          deck.greyed[j] = true;
          greyOut(m);
        }
        m.visible = true;
        onRecord(STYLUS + turnsToStylus(chart, note.time, t), NOTE_R, 0, m.position);
        const grow = Math.min(1, Math.max(0, (AHEAD - ahead) / 0.45));
        const fade = ahead < 0 ? 1 + ahead / PAST : 1;
        m.scale.setScalar(Math.max(0.001, grow * fade * (g === 'miss' ? 0.8 : 1)));
      });
      deck.lane.update(t, judged, dt);
    });

    this.companions.forEach((c, i) => {
      c.update(dt);
      const lean = this.leans[i] ?? 0;
      this.leans[i] = lean * Math.exp(-dt * 8);
      c.root.rotation.z = lean * 0.1;
      c.root.rotation.x = bob * 0.09;
      c.root.position.y = FLOOR_Y - bob * 0.03;
    });

    for (const w of this.woofers) w.scale.set(1 + bob * 0.08, 1 + bob * 0.08, 1 + bob * 0.9);
    // The cat sleeps through it all; its tail keeps time, and an ear twitches now and then.
    this.tail.rotation.set(0, Math.sin(time * 1.1) * 0.25 + bob * 0.15, -0.85);
    this.ear.rotation.x = Math.max(0, Math.sin(time * 0.9)) ** 20 * 0.5;
    this.lantern.intensity = 30 * (1 + bob * 0.06);
    this.tick(dt, time);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const d of this.decks) d.lane.dispose();
  }
}

export const minigame: Minigame = {
  id: 'scratchnight',
  title: 'Scratch Night',
  how: 'A late-night set, a turntable each. Notes ride round on your record: swipe your phone as one reaches the needle to scratch it. Swiping through the gaps costs you.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui, sfx } = ctx;
    const chart = makeChart(SCRATCH_SONG, ctx.rng);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.8, mood: 'listening' })));
    const view = new FlatView(seats, companions, chart);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const cuts = seats.map(() => 0);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'swipe',
      groove: GROOVE,
      note: 'Swipe as a note reaches the needle',
      onJudge: (seat, j) => {
        view.judge(seat, j.grade, round.tracks[seat]?.combo);
        const c = view.companions[seat];
        if (j.grade !== 'miss') {
          view.scratch(seat);
          scratch(sfx, (j.grade === 'perfect' ? 1 : 0.75) * (session.isCpu(seat) ? 0.35 : 1), cuts[seat] ?? 0);
          cuts[seat] = (cuts[seat] ?? 0) + 1;
          if (j.combo > 0 && j.combo % 8 === 0) c?.react('happy', 1.3);
        } else if (now - (lastSad[seat] ?? -9) > 1.5) {
          lastSad[seat] = now;
          c?.react('sad', 0.9);
        }
      },
    });
    view.attach(round);

    const caption = new PhraseCaption(ui, chart, SCRATCH_SONG.phrase, 'Scratch', 'Let it spin…');
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${round.tracks[i]?.score ?? 0} pts` })));
    ui.caption('Swipe as a note on your record reaches the needle');
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
    await ctx.clock.wait(1.2);
    return { scores, details: round.tracks.map(scratchDetail) };
  },
};
