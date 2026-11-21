// Seesaw Snacks on the TV: a playground at dusk under one enormous tree that grows snack-fruit. Two seesaws, one per
// team, a partner in the bucket seat at each end. Snacks come down from the branches on stretchy stalks and dangle
// over the seats; each rider has a soft glowing catch zone just above their head.
import * as THREE from 'three';
import {
  type Board,
  type CpuRider,
  type Drop,
  type End,
  SEESAW,
  type SeesawEvent,
  type Treat,
  boardScore,
  cpuTilt,
  dropHeight,
  inZone,
  leanOf,
  makeDrops,
  newBoard,
  newCpuRider,
  plankAngle,
  seatY,
  seesawDetail,
  seesawScores,
  stepBoard,
  zoneY,
} from '../../../game/minigames/seesaw';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cone, cyl, dome, gem, mix, nameCard, part, pill, popSprite, rbox, seeded, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SIDE = 3.45; // each seesaw's pivot, either side of the middle
const HEIGHT = 1.3; // companions
const SINK = 0.2; // a rider's feet sit this far down in the bucket seat
const SNACK_Z = 0.42; // snacks dangle a little in front of the riders
const ZONE_R = 0.34;
const TILT = 0.16; // the camera looks down this much (radians)
const STALK = P.moss;
const LEAVES = [P.pine, P.leafDark, P.fern, mix(P.leafDark, P.moss, 0.5)];

// ------------------------------------------------------------------ sounds

const nom = (sfx: Sfx) => {
  noise(sfx, { dur: 0.12, filter: 'bandpass', freq: 2200, to: 1200, gain: 0.18 });
  tone(sfx, { freq: 520, to: 780, dur: 0.12, type: 'triangle', gain: 0.08, delay: 0.04 });
};
const blegh = (sfx: Sfx) => {
  tone(sfx, { freq: 220, to: 130, dur: 0.32, type: 'square', gain: 0.035 });
  tone(sfx, { freq: 180, to: 110, dur: 0.3, type: 'triangle', gain: 0.07, delay: 0.05 });
};
const boing = (sfx: Sfx) => tone(sfx, { freq: 420, to: 260, dur: 0.16, gain: 0.035 });
const thunk = (sfx: Sfx, k: number) => noise(sfx, { dur: 0.14, filter: 'lowpass', freq: 380, to: 110, gain: 0.15 + 0.25 * k });

// ------------------------------------------------------------------ snack-fruit

/** One treat, about 0.4 units across, centred on its middle, with a little leaf on top (it grew on a tree). */
function treatMesh(treat: Treat): THREE.Group {
  const g = new THREE.Group();
  switch (treat) {
    case 'doughnut': {
      part(g, torus(0.13, 0.065), mix(P.mustard, P.clay, 0.55), 0, 0, 0, { outline: 0.014 });
      part(g, torus(0.13, 0.055), P.rose, 0, 0, 0.025, { outline: false, gloss: 0.5 });
      const sprinkles = [P.cream, P.moon, P.mustard];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        part(g, box(0.018, 0.05, 0.018), sprinkles[k % 3] as string, Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.08, { rz: a * 2, outline: false, shadow: false });
      }
      break;
    }
    case 'cookie':
      part(g, cyl(0.19, 0.19, 0.07, 20), mix(P.oak, P.mustard, 0.35), 0, 0, 0, { rx: Math.PI / 2, outline: 0.014 });
      part(g, cyl(0.16, 0.18, 0.02, 20), mix(P.oak, P.mustard, 0.6), 0, 0, 0.04, { rx: Math.PI / 2, outline: false });
      for (const [x, y] of [[-0.08, 0.05], [0.07, 0.08], [0.02, -0.07], [-0.06, -0.06], [0.1, -0.02]] as const) part(g, ball(0.03, 1), P.walnut, x, y, 0.05, { outline: false, gloss: 0.3 });
      break;
    case 'cupcake':
      part(g, cyl(0.15, 0.1, 0.18, 14), mix(P.denim, P.moon, 0.35), 0, -0.07, 0, { outline: 0.014 });
      part(g, dome(0.17), P.cream, 0, 0.02, 0, { sy: 0.9, outline: 0.014 });
      part(g, sphere(0.11, 12), P.cream, 0, 0.12, 0, { sy: 0.7, outline: false });
      part(g, sphere(0.05, 10), P.brick, 0, 0.21, 0, { gloss: 0.6, outline: false });
      break;
    case 'pretzel': {
      const baked = mix(P.wood, P.mahogany, 0.4);
      part(g, torus(0.16, 0.035, Math.PI), baked, 0, 0.01, 0, { rz: Math.PI, gloss: 0.3, outline: 0.014 });
      part(g, torus(0.09, 0.035), baked, -0.075, 0.04, 0, { gloss: 0.3, outline: 0.014 });
      part(g, torus(0.09, 0.035), baked, 0.075, 0.04, 0, { gloss: 0.3, outline: 0.014 });
      for (const [x, y] of [[-0.12, 0.1], [0.1, 0.11], [0, -0.14], [0.15, -0.06], [-0.15, -0.05]] as const) part(g, ball(0.012, 0), P.cream, x, y, 0.035, { outline: false, shadow: false });
      break;
    }
    case 'gummy': {
      const jelly = { gloss: 0.7, outline: 0.014 };
      part(g, ball(0.12, 2), P.accent, 0, -0.05, 0, { sy: 1.1, ...jelly });
      part(g, ball(0.09, 2), P.accent, 0, 0.12, 0, jelly);
      for (const s of [-1, 1]) {
        part(g, ball(0.04, 1), P.accent, s * 0.07, 0.2, 0, jelly);
        part(g, ball(0.045, 1), P.accent, s * 0.11, -0.02, 0.02, jelly);
      }
      break;
    }
    case 'broccoli':
      part(g, cyl(0.05, 0.07, 0.22, 10), mix(P.moss, P.cream, 0.4), 0, -0.1, 0, { outline: 0.014 });
      for (const [x, y, r] of [[0, 0.08, 0.12], [-0.1, 0.02, 0.09], [0.1, 0.02, 0.09], [-0.05, 0.15, 0.08], [0.06, 0.15, 0.08]] as const) part(g, ball(r), x === 0 ? P.fern : P.leafDark, x, y, 0, { outline: 0.014 });
      break;
  }
  if (treat !== 'broccoli') part(g, cone(0.05, 0.12, 4), P.leaf, 0.04, 0.24, 0, { rz: -0.6, sz: 0.3, outline: false });
  return g;
}

// ------------------------------------------------------------------ the view

interface Rider {
  end: End;
  /** Seat position, or -1 for the teddy bear. */
  p: number;
  root: THREE.Object3D;
  companion: Companion | null;
  card: THREE.Sprite | null;
  zone: THREE.Group;
  zoneMat: THREE.MeshBasicMaterial;
  color: string;
  lean: number;
  mood: CompanionMood | null;
}

interface Side {
  cx: number;
  color: string;
  plank: THREE.Group;
  riders: Rider[];
  score: THREE.Sprite | null;
  shown: number;
  bounce: number;
}

interface Hanging {
  team: number;
  drop: Drop;
  mesh: THREE.Group;
  stalk: THREE.Mesh;
  state: 'dangling' | 'caught' | 'falling';
  age: number;
  vy: number;
  to: THREE.Vector3;
  spin: number;
}

class Playground implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly sides: Side[] = [];
  readonly floaters: Floaters;
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly stalkMat = new THREE.MeshToonMaterial({ color: STALK });
  private readonly stalkGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 6);
  private hanging = new Map<string, Hanging>();
  private sparks: { mesh: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private readonly env: Env;
  private readonly swings: THREE.Group[] = [];
  private tick: (dt: number, time: number) => void = () => {};
  private readonly lamp = new THREE.PointLight(P.lamp, 14, 12, 1.5);
  private time = 0;

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    private readonly companions: Companion[],
  ) {
    this.floaters = new Floaters(this.scene);
    this.owned.push(this.stalkMat, this.stalkGeo);
    this.env = this.playground();

    teams.forEach((members, team) => {
      const cx = teams.length > 1 ? (team === 0 ? -SIDE : SIDE) : 0;
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      this.stand(cx, color);
      const plank = new THREE.Group();
      plank.position.set(cx, SEESAW.pivot, 0);
      // A wooden plank with a bucket seat in the team's colour at each end, and a handle bar in front of each.
      part(plank, rbox(2 * SEESAW.half + 0.4, 0.1, 0.38, 0.04), P.oak, 0, 0, 0, { tex: 'planks', texScale: 1.2, outline: 0.018 });
      part(plank, rbox(2 * SEESAW.half - 0.9, 0.012, 0.1, 0.005), color, 0, 0.056, 0, { outline: false, shadow: false });
      for (const s of [-1, 1]) {
        const sx = s * SEESAW.half;
        part(plank, rbox(0.56, 0.34, 0.5, 0.1), mix(color, P.aubergine, 0.18), sx, 0.2, 0, { gloss: 0.4, outline: 0.018 });
        part(plank, rbox(0.44, 0.06, 0.38, 0.03), P.charcoal, sx, 0.36, 0, { tex: 'leather', outline: false });
        part(plank, cyl(0.025, 0.025, 0.42, 8), P.metal, sx - s * 0.42, 0.3, 0, { rx: Math.PI / 2, gloss: 0.7, outline: 0.012 });
        for (const z of [-0.2, 0.2]) part(plank, cyl(0.025, 0.025, 0.3, 8), P.metal, sx - s * 0.42, 0.15, z, { gloss: 0.7, outline: false });
        for (const z of [-0.21, 0.21]) part(plank, sphere(0.04, 8), P.charcoal, sx - s * 0.42, 0.3, z, { outline: false });
      }
      this.scene.add(plank);
      const side: Side = { cx, color, plank, riders: [], score: null, shown: -1, bounce: 0 };
      this.sides.push(side);

      for (const end of [0, 1] as const) {
        const p = members[end];
        const seat = p === undefined ? undefined : seats[p];
        const c = p === undefined ? undefined : companions[p];
        const zoneColor = seat?.color ?? '#ffffff';
        const zone = new THREE.Group();
        const zoneMat = new THREE.MeshBasicMaterial({ color: zoneColor, transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false });
        const column = new THREE.Mesh(new THREE.CylinderGeometry(ZONE_R, ZONE_R, 2 * SEESAW.zone, 20, 1, true), zoneMat);
        zone.add(column);
        this.owned.push(zoneMat, column.geometry);
        for (const y of [-SEESAW.zone, SEESAW.zone]) part(zone, torus(ZONE_R, 0.02), zoneColor, 0, y, 0, { rx: Math.PI / 2, basic: true, opacity: 0.6, shadow: false });
        this.scene.add(zone);
        if (p !== undefined && seat && c) {
          c.setBase('listening');
          this.scene.add(c.root);
          const card = nameCard(seat.name, seat.color, 0.8);
          this.scene.add(card);
          side.riders.push({ end, p, root: c.root, companion: c, card, zone, zoneMat, color: seat.color, lean: 0, mood: null });
        } else {
          // A team of one shares its seesaw with a teddy bear.
          side.riders.push({ end, p: -1, root: this.teddy(), companion: null, card: null, zone, zoneMat, color: zoneColor, lean: 0, mood: null });
          zone.visible = false;
        }
      }
      // What the camera keeps in view: both seats at their lowest and highest with the catch zones over them,
      // the names on the ground, and the branches the snacks come from.
      for (const s of [-1, 1]) {
        const x = cx + s * (SEESAW.half + 0.45);
        this.marks.push({ p: new THREE.Vector3(x, 0, 0.6) }, { p: new THREE.Vector3(x, seatY(0, 1) + SEESAW.reach + SEESAW.zone + 0.1, 0.3) });
        this.marks.push({ p: new THREE.Vector3(cx + s * SEESAW.half, 0.12, 1.05), pad: 0.05 });
        this.marks.push({ p: new THREE.Vector3(cx + s * SEESAW.half, SEESAW.top + 0.15, SNACK_Z) });
      }
    });
    this.update(0, 0);
  }

  /** The A-frame the plank rocks on. */
  private stand(cx: number, color: string): void {
    const s = this.scene;
    for (const z of [-0.32, 0.32]) {
      for (const lean of [-1, 1]) part(s, rbox(0.1, SEESAW.pivot + 0.15, 0.1, 0.03), P.slate, cx + lean * 0.16, (SEESAW.pivot - 0.05) / 2, z, { rz: lean * 0.32, gloss: 0.5, outline: 0.018 });
      part(s, rbox(0.62, 0.06, 0.14, 0.02), P.charcoal, cx, 0.05, z, { outline: false });
    }
    part(s, cyl(0.07, 0.07, 0.8, 14), mix(color, P.aubergine, 0.3), cx, SEESAW.pivot, 0, { rx: Math.PI / 2, gloss: 0.5, outline: 0.018 });
    for (const z of [-0.41, 0.41]) part(s, cyl(0.1, 0.1, 0.03, 14), P.brass, cx, SEESAW.pivot, z, { rx: Math.PI / 2, gloss: 0.7, outline: false });
    // A round of bark chips under the seesaw, with a log edging.
    const bark = mix(P.soil, P.wood, 0.45);
    part(s, cyl(1, 1, 0.05, 44), bark, cx, 0.02, 0.1, { sx: 2.6, sz: 1.25, tex: 'cobble', texScale: 0.9, texStrength: 0.8, outline: false });
    part(s, torus(1, 0.035), P.walnut, cx, 0.04, 0.1, { rx: Math.PI / 2, sx: 2.6, sy: 1.25, tex: 'bark', outline: false });
    const rand = seeded(Math.round(cx * 10) + 50);
    for (let k = 0; k < 26; k++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand());
      part(s, rbox(0.12, 0.03, 0.06, 0.01), rand() < 0.5 ? P.woodDark : mix(P.oak, P.soil, 0.3), cx + Math.cos(a) * r * 2.3, 0.055, 0.1 + Math.sin(a) * r * 1.05, { ry: rand() * 3, outline: false, shadow: false });
    }
  }

  /** A teddy bear, for an empty seat. */
  private teddy(): THREE.Group {
    const g = new THREE.Group();
    const fur = mix(P.clay, P.wood, 0.4);
    withOutline(0.025, () => {
      part(g, ball(0.26, 2), fur, 0, 0.32, 0, { sy: 1.1, tex: 'terry', texStrength: 0.5 });
      part(g, ball(0.2, 2), fur, 0, 0.7, 0, { tex: 'terry', texStrength: 0.5 });
      for (const s of [-1, 1]) {
        part(g, ball(0.08, 1), fur, s * 0.14, 0.86, 0);
        part(g, pill(0.07, 0.16), fur, s * 0.25, 0.4, 0.05, { rz: s * 0.6 });
      }
      part(g, ball(0.09, 1), P.cream, 0, 0.66, 0.15, { sz: 0.7 });
      part(g, torus(0.17, 0.03), P.terracotta, 0, 0.55, 0, { rx: Math.PI / 2, outline: false });
      for (const s of [-1, 1]) part(g, ball(0.025, 1), P.ink, s * 0.07, 0.75, 0.17, { outline: false, gloss: 0.6 });
    });
    this.scene.add(g);
    return g;
  }

  /** A park at dusk: lawn and hedges, the big snack-fruit tree, swings and a slide at the back, a lamp post coming on. */
  private playground(): Env {
    const s = this.scene;
    const rand = seeded(9);
    const env = backyard(s, { mood: 'evening', w: 25, d: 12.4, clear: { w: 16, d: 5.6 }, lights: false, seed: 9 });
    env.sun.target.position.set(0, 1, 0);
    const set = new THREE.Group();
    s.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = 1) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      if (scale !== 1) o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    // The tree: a fat trunk, two great branches, and a canopy over both seesaws.
    const bark = { tex: 'bark' as const, texScale: 1.6, outline: 0.025 };
    const trunk = mix(P.woodDark, P.walnut, 0.4);
    part(set, cyl(0.42, 0.62, 5.2, 18), trunk, 0, 2.6, -1.8, bark);
    for (const a of [0.3, 2.2, 4.1, 5.4]) part(set, cyl(0.1, 0.24, 0.9, 8), trunk, Math.cos(a) * 0.6, 0.25, -1.8 + Math.sin(a) * 0.5, { rz: -Math.cos(a) * 0.9, rx: Math.sin(a) * 0.9, tex: 'bark', outline: false });
    for (const sx of [-1, 1]) {
      part(set, cyl(0.2, 0.32, 4.4, 12), trunk, sx * 2.2, 4.75, -1.2, { rz: sx * -1.15, rx: 0.15, ...bark });
      part(set, cyl(0.12, 0.18, 2.2, 10), trunk, sx * 4.6, 5.25, -0.7, { rz: sx * -1.35, rx: 0.2, ...bark });
    }
    for (let k = 0; k < 50; k++) {
      const x = (rand() * 2 - 1) * 6.8;
      const r = 0.6 + rand() * 0.5;
      const y = 5.25 + rand() * 0.9 + (1 - Math.abs(x) / 6.8) * 0.8;
      const z = -2.2 + rand() * 2.4;
      // The canopy casts no shadow: the riders under it stay in the evening light.
      part(set, ball(r, 1), LEAVES[k % LEAVES.length] as string, x, y, z, { shadow: false, outline: k % 2 ? 0.02 : false });
    }
    // Snack-fruit still growing in the leaves.
    const fruit = [P.rose, mix(P.oak, P.mustard, 0.35), P.cream, P.accent, P.mustard, mix(P.wood, P.mahogany, 0.4)];
    for (let k = 0; k < 30; k++) {
      const x = (rand() * 2 - 1) * 6.2;
      part(set, sphere(0.09 + rand() * 0.05, 10), fruit[k % fruit.length] as string, x, 4.85 + rand() * 0.5, 0.1 + rand() * 0.5, { glow: 0.3, gloss: 0.5, outline: false });
    }
    // A string of warm bulbs wound through the lower branches.
    for (const sx of [-1, 1]) set.add(props.stringLights(new THREE.Vector3(sx * 0.5, 4.9, -0.9), new THREE.Vector3(sx * 6.4, 5.0, -0.5), { sag: 0.16, count: 11, bulb: 0.04 }));

    // Swings on the left.
    const paint = mix(P.terracotta, P.ink, 0.12);
    const steel = { gloss: 0.5, outline: 0.018 };
    for (const sx of [-8.6, -6.4]) for (const sz of [-1, 1]) part(set, cyl(0.06, 0.06, 3.2, 8), paint, sx, 1.5, -3.6 + sz * 0.6, { rx: sz * 0.28, ...steel });
    part(set, cyl(0.06, 0.06, 2.3, 8), paint, -7.5, 3.0, -3.6, { rz: Math.PI / 2, ...steel });
    for (const sx of [-8.0, -7.0]) {
      const swing = new THREE.Group();
      for (const dx of [-0.2, 0.2]) part(swing, cyl(0.012, 0.012, 2.1, 6), P.metal, dx, -1.05, 0, { outline: false });
      part(swing, rbox(0.48, 0.06, 0.2, 0.02), P.mustard, 0, -2.12, 0, { outline: 0.015 });
      swing.position.set(sx, 3.0, -3.6);
      set.add(swing);
      this.swings.push(swing);
    }
    // A slide on the right: a wooden tower with a ladder, a blue chute.
    part(set, rbox(0.9, 2.2, 0.9, 0.05), P.oak, 7.6, 1.1, -4.8, { tex: 'planks', outline: 0.02 });
    part(set, rbox(1.1, 0.08, 1.1, 0.03), P.walnut, 7.6, 2.24, -4.8, { tex: 'planks', outline: false });
    for (const dx of [-0.42, 0.42]) part(set, rbox(0.06, 0.8, 0.06, 0.02), P.walnut, 7.6 + dx, 2.65, -4.4, { outline: false });
    part(set, rbox(0.9, 0.06, 0.06, 0.02), P.walnut, 7.6, 3.05, -4.4, { outline: false });
    part(set, rbox(0.9, 0.1, 3.2, 0.05), mix(P.denim, P.moon, 0.25), 7.6, 1.2, -3.3, { rx: 0.62, gloss: 0.6, outline: 0.02 });
    for (const dx of [-0.45, 0.45]) part(set, rbox(0.06, 0.22, 3.2, 0.02), P.denim, 7.6 + dx, 1.3, -3.3, { rx: 0.62, gloss: 0.5, outline: false });
    // A park bench at the front, and a lamp post just coming on.
    const bench = new THREE.Group();
    for (const dz of [-0.16, 0, 0.16]) part(bench, rbox(1.8, 0.05, 0.13, 0.02), P.wood, 0, 0.5, dz, { tex: 'wood', outline: 0.012 });
    for (const dy of [0.72, 0.9]) part(bench, rbox(1.8, 0.13, 0.05, 0.02), P.wood, 0, dy, -0.27, { tex: 'wood', outline: 0.012 });
    for (const sx of [-0.75, 0.75]) {
      part(bench, rbox(0.07, 0.5, 0.46, 0.02), P.charcoal, sx, 0.25, 0, { gloss: 0.4, outline: false });
      part(bench, rbox(0.07, 0.56, 0.07, 0.02), P.charcoal, sx, 0.74, -0.23, { gloss: 0.4, outline: false });
    }
    put(bench, -7.3, 0, 2.5, 0.3);
    part(set, cyl(0.06, 0.08, 3.4, 10), P.charcoal, 6.3, 1.7, -2.4, { gloss: 0.4, outline: 0.018 });
    part(set, cyl(0.12, 0.14, 0.2, 10), P.charcoal, 6.3, 0.1, -2.4, { outline: false });
    part(set, cone(0.34, 0.3, 16), P.charcoal, 6.3, 3.52, -2.4, { gloss: 0.4, outline: 0.018 });
    part(set, sphere(0.2, 14), P.lamp, 6.3, 3.28, -2.4, { glow: 2.2, outline: false, shadow: false });
    this.lamp.position.set(6.3, 3.0, -2.1);
    s.add(this.lamp);

    // Dressing at the edges and near the camera.
    put(props.bush({ r: 0.8, flowers: P.rose, seed: 3 }), -9.6, 0, 2.2);
    put(props.bush({ r: 0.6, flowers: P.cream, seed: 5 }), -8.5, 0, 3.0);
    put(props.bush({ r: 0.85, flowers: P.mustard, seed: 8 }), 9.4, 0, 2.4);
    put(props.rock({ r: 0.35, seed: 4 }), 8.3, 0, 3.0);
    put(props.blanket({ color: P.denim, tex: 'gingham', w: 1.8, d: 1.4 }), 0.1, 0, 3.0, -0.2);
    put(props.snackBowl({ fill: 'sweets', color: P.ceramic, r: 0.17 }), -0.1, 0.03, 2.9);
    put(props.drink({ kind: 'bottle', color: P.forest }), 0.5, 0.03, 3.2);
    put(props.drink({ kind: 'can', color: P.terracotta }), 0.3, 0.03, 2.75);
    // A football someone left behind.
    const football = part(set, sphere(0.17, 16), P.cream, 1.9, 0.17, 2.3, { outline: 0.015 });
    for (const tilt of [0.5, -0.7]) part(football, torus(0.172, 0.011), P.terracotta, 0, 0, 0, { rx: Math.PI / 2 + tilt, rz: tilt, outline: false, shadow: false });
    for (let k = 0; k < 10; k++) put(props.tuft({ seed: k + 30, flowers: [P.cream, P.rose, P.mustard][k % 3] as string, s: 1.2 }), (rand() - 0.5) * 3, 0, -2.6 + rand() * 1.4, rand() * 6);
    this.tick = props.tickProps(set);
    return env;
  }

  /** Where a seat is in the world now (the top of the plank's end). */
  private seatAt(side: Side, end: End, out = new THREE.Vector3()): THREE.Vector3 {
    const a = side.plank.rotation.z;
    const lx = (end === 0 ? -1 : 1) * SEESAW.half;
    return out.set(side.cx + lx * Math.cos(a), SEESAW.pivot + lx * Math.sin(a) + side.bounce, 0);
  }

  /** Where a team's drop dangles (x, z); y comes from the rules. */
  private dropX(team: number, d: Drop): number {
    const side = this.sides[team];
    return (side?.cx ?? 0) + (d.end === 0 ? -1 : 1) * SEESAW.half * 0.95;
  }

  /** The team's seesaw, riders and catch zones, from the rules (and how each rider is leaning). */
  sync(team: number, b: Board, drops: readonly Drop[], tilts: readonly number[], dt: number): void {
    const side = this.sides[team];
    if (!side) return;
    side.bounce *= Math.exp(-10 * dt);
    side.plank.rotation.z = -plankAngle(b.tip);
    side.plank.position.y = SEESAW.pivot + side.bounce;
    const at = new THREE.Vector3();
    for (const r of side.riders) {
      this.seatAt(side, r.end, at);
      const lean = r.p >= 0 ? leanOf(tilts[r.end] ?? 0) : 0;
      r.lean += (lean - r.lean) * (1 - Math.exp(-8 * dt));
      r.root.position.set(at.x, at.y + 0.05 - (r.companion ? SINK : 0.02), 0);
      r.root.rotation.set(0, (r.end === 0 ? 1 : -1) * 0.3, -r.lean * 0.28 + side.plank.rotation.z * 0.4);
      r.card?.position.set(side.cx + (r.end === 0 ? -1 : 1) * SEESAW.half, 0.12, 1.05);
      // The catch zone over the head, brighter while something dangles in it.
      const zy = zoneY(r.end, b.tip) + side.bounce;
      r.zone.position.set(at.x, zy, SNACK_Z * 0.6);
      let inside = false;
      drops.forEach((d, i) => {
        if (d.end === r.end && b.states[i] === 'hanging' && inZone(d, b.tip)) inside = true;
      });
      const goal = inside ? 0.42 : 0.14;
      r.zoneMat.opacity += (goal - r.zoneMat.opacity) * (1 - Math.exp(-12 * dt));
    }
    // The team's points above the pivot.
    if (b.points !== side.shown) {
      side.shown = b.points;
      if (side.score) {
        side.score.removeFromParent();
        side.score.material.map?.dispose();
        side.score.material.dispose();
      }
      side.score = popSprite(String(b.points), side.color, 0.6);
      side.score.position.set(side.cx, 3.35, -0.2);
      this.scene.add(side.score);
    }
    // Snacks on their stalks.
    for (const h of this.hanging.values()) {
      if (h.team !== team || h.state !== 'dangling') continue;
      const y = dropHeight(h.drop, b.time);
      h.mesh.position.set(this.dropX(team, h.drop), y, SNACK_Z);
      h.mesh.rotation.y = Math.sin(this.time * 1.7 + h.spin) * 0.5;
      this.stalkTo(h, y + 0.2);
    }
  }

  private stalkTo(h: Hanging, bottom: number): void {
    const top = SEESAW.top + 0.6;
    const len = Math.max(0.01, top - bottom);
    h.stalk.position.set(h.mesh.position.x, bottom + len / 2, SNACK_Z);
    h.stalk.scale.set(1, len, 1);
  }

  /** What happened on a team's seesaw. */
  event(team: number, e: SeesawEvent): void {
    const side = this.sides[team];
    if (!side) return;
    if (e.kind === 'bump') {
      side.bounce = -0.03 * e.strength;
      return;
    }
    const key = `${team}:${e.drop}`;
    if (e.kind === 'drop') return;
    const h = this.hanging.get(key);
    if (!h) return;
    h.age = 0;
    if (e.kind === 'catch') {
      h.state = 'caught';
      const r = side.riders.find((x) => x.end === e.end);
      this.seatAt(side, e.end, h.to);
      h.to.y += HEIGHT * 0.75;
      const green = e.treat === 'broccoli';
      const head = h.to.clone().add(new THREE.Vector3(0, 0.6, 0.3));
      this.floaters.add(green ? '−1' : '+1', green ? '#c8f0a0' : (r?.color ?? '#fff6a8'), head, 0.42, 1.0);
      r?.companion?.react(green ? 'sad' : 'happy', green ? 1.2 : 0.9);
      // A good catch bursts into a few sparkles in the rider's colour.
      if (!green) {
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + team;
          const mesh = part(this.scene, gem(0.05), r?.color ?? P.lamp, h.mesh.position.x, h.mesh.position.y, SNACK_Z, { glow: 1.6, shadow: false });
          this.sparks.push({ mesh, v: new THREE.Vector3(Math.cos(a) * 1.5, 1.2 + Math.sin(a) * 1.3, 0.3), age: 0 });
        }
      }
    } else {
      h.state = 'falling';
      h.vy = 0;
    }
  }

  /** A drop leaves the branches over one of the team's seats. */
  spawn(team: number, i: number, d: Drop): void {
    const mesh = treatMesh(d.treat);
    mesh.position.set(this.dropX(team, d), SEESAW.top, SNACK_Z);
    this.scene.add(mesh);
    const stalk = new THREE.Mesh(this.stalkGeo, this.stalkMat);
    this.scene.add(stalk);
    const h: Hanging = { team, drop: d, mesh, stalk, state: 'dangling', age: 0, vy: 0, to: new THREE.Vector3(), spin: i * 1.7 };
    this.hanging.set(`${team}:${i}`, h);
    this.stalkTo(h, SEESAW.top + 0.2);
  }

  setMood(team: number, end: End, mood: CompanionMood): void {
    const r = this.sides[team]?.riders.find((x) => x.end === end);
    if (!r?.companion || r.mood === mood) return;
    r.mood = mood;
    r.companion.setBase(mood);
  }

  cheer(team: number, text: string): void {
    const side = this.sides[team];
    if (side) this.floaters.add(text, '#fff6a8', new THREE.Vector3(side.cx, 3.9, 0), 0.6, 2.4);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
    for (const side of this.sides) {
      side.score?.material.map?.dispose();
      side.score?.material.dispose();
      for (const r of side.riders) {
        r.card?.material.map?.dispose();
        r.card?.material.dispose();
      }
    }
    for (const o of this.owned) o.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.fit.update(() => this.marks);
    this.env.update(dt, time);
    this.tick(dt, time);
    // The set breathes: the swings rock a little, the lamp flickers by a few percent.
    this.swings.forEach((sw, i) => (sw.rotation.x = Math.sin(time * 1.1 + i * 2.3) * 0.07));
    this.lamp.intensity = 14 * (1 + Math.sin(time * 9.1) * 0.02 + Math.sin(time * 2.3) * 0.03);
    this.sparks = this.sparks.filter((sp) => {
      sp.age += dt;
      sp.v.y -= 5 * dt;
      sp.mesh.position.addScaledVector(sp.v, dt);
      sp.mesh.rotation.y += dt * 9;
      sp.mesh.scale.setScalar(Math.max(0.01, 1 - sp.age / 0.5));
      if (sp.age < 0.5) return true;
      sp.mesh.removeFromParent();
      return false;
    });
    for (const c of this.companions) c.update(dt);
    this.floaters.update(dt);
    // Caught snacks pop into the rider; snapped ones drop to the grass, bounce and fade.
    for (const [key, h] of this.hanging) {
      if (h.state === 'dangling') continue;
      h.age += dt;
      const top = SEESAW.top + 0.6;
      const pulled = Math.min(1, h.age / 0.35);
      const bottom = h.mesh.position.y + 0.2 + (top - h.mesh.position.y) * pulled;
      if (h.state === 'caught') {
        const k = Math.min(1, h.age / 0.25);
        h.mesh.position.lerp(h.to, k);
        h.mesh.scale.setScalar(Math.max(0.01, 1 - k));
      } else {
        h.vy -= 12 * dt;
        h.mesh.position.y += h.vy * dt;
        h.mesh.rotation.z += dt * 4;
        if (h.mesh.position.y < 0.15) {
          h.mesh.position.y = 0.15;
          h.vy = Math.abs(h.vy) > 1.5 ? -h.vy * 0.3 : 0;
        }
        if (h.age > 1.2) h.mesh.scale.setScalar(Math.max(0.01, 1 - (h.age - 1.2) * 3));
      }
      this.stalkTo(h, Math.min(top, bottom));
      h.stalk.visible = pulled < 1;
      if ((h.state === 'caught' && h.age > 0.3) || h.age > 1.55) {
        h.mesh.removeFromParent();
        h.stalk.removeFromParent();
        this.hanging.delete(key);
      }
    }
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'seesaw',
  title: 'Seesaw Snacks',
  how: 'Tilt your phone to lean: lean the same way as your partner to tip the seesaw, opposite ways to level it. Bring your end up or down so the dangling snacks are just above your head, and dodge the broccoli (it costs a point)!',
  controller: 'tilt',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const drops = makeDrops(rng);
    const boards = teams.map(() => newBoard(drops));
    const view = new Playground(seats, teams, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);

    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const slot = new Map<number, { team: number; end: End }>();
    teams.forEach((t, team) => t.slice(0, 2).forEach((p, end) => slot.set(p, { team, end: end as End })));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const riders: (CpuRider | null)[] = seats.map((_, p) => {
      const w = slot.get(p);
      return w && cpu(p) ? newCpuRider(drops, w.end, ctx.skill(), rng) : null;
    });
    const tilt = seats.map(() => 0);
    boards.forEach((b, team) => view.sync(team, b, drops, [0, 0], 0));

    seats.forEach((s, p) => {
      const w = slot.get(p);
      const partner = w ? teams[w.team]?.find((q) => q !== p) : undefined;
      const mine = w?.end === 0 ? 'left' : 'right';
      const theirs = w?.end === 0 ? 'right' : 'left';
      const note =
        partner === undefined
          ? `You’re on the ${mine} seat (a teddy has the other). Tilt to tip the seesaw and catch snacks over your head!`
          : `You’re on the ${mine} seat, ${nameOf(partner)} on the ${theirs}. Lean the same way to tip it, opposite ways to level it.`;
      session.setLayout(s.index, { kind: 'tilt', title: 'Seesaw Snacks', note, icon: '🍩' });
    });
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'tilt' || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p !== undefined) tilt[p] = msg.x;
    });

    ui.caption('Lean together to tip the seesaw. Catch the snacks, dodge the broccoli!');
    let hudAt = -1;
    const lastToast = seats.map(() => -10);
    await everyFrame(clock, (dt, t) => {
      teams.forEach((members, team) => {
        const b = boards[team];
        if (!b) return;
        const tilts = members.slice(0, 2).map((p) => {
          const r = riders[p];
          return r ? cpuTilt(r, b, drops, rng, Math.min(dt, 0.25)) : (tilt[p] ?? 0);
        });
        for (const e of stepBoard(b, drops, tilts, dt)) {
          if (e.kind === 'drop') {
            view.spawn(team, e.drop, drops[e.drop] as Drop);
            if (team === 0) boing(sfx);
          } else if (e.kind === 'bump') thunk(sfx, e.strength);
          else if (e.kind === 'catch') {
            const p = members[e.end];
            if (e.treat === 'broccoli') {
              blegh(sfx);
              if (p !== undefined) {
                tell(p, false, 'Broccoli! That’s a point off.');
                session.send(seatOf(p), { t: 'buzz', pattern: [70, 40, 70] });
                lastToast[p] = t;
              }
            } else {
              nom(sfx);
              if (p !== undefined) {
                session.send(seatOf(p), { t: 'buzz', pattern: [12] });
                if (t - (lastToast[p] ?? -10) > 1.2) {
                  lastToast[p] = t;
                  tell(p, true, `Got it! ${b.points} point${b.points === 1 ? '' : 's'} for your team.`);
                }
              }
            }
          }
          view.event(team, e);
        }
        view.sync(team, b, drops, tilts, dt);
        // Riders look pleased while a snack is in reach, puzzled while broccoli is.
        members.slice(0, 2).forEach((_, end) => {
          let mood: CompanionMood = 'listening';
          drops.forEach((d, i) => {
            if (d.end !== end || b.states[i] !== 'hanging' || !inZone(d, b.tip)) return;
            mood = d.treat === 'broccoli' ? 'thinking' : 'approval';
          });
          view.setMood(team, end as End, mood);
        });
      });
      if (t - hudAt >= 0.1) {
        hudAt = t;
        ui.timer(SEESAW.duration - t);
        ui.live(
          teams.map((members, team) => {
            const lead = seats[members[0] ?? 0];
            const n = boards[team]?.points ?? 0;
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} point${n === 1 ? '' : 's'}` };
          }),
        );
      }
      return t >= SEESAW.duration;
    });
    off();
    ui.timer(null);
    ui.caption(null);

    // Time! The team with the most points cheers.
    const scores = boards.map(boardScore);
    const best = Math.max(...scores);
    const tie = scores.length > 1 && scores.every((v) => v === best);
    sfx.good();
    teams.forEach((members, team) => {
      const won = scores[team] === best;
      members.slice(0, 2).forEach((p, end) => {
        view.setMood(team, end as End, tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) view.sides[team]?.riders.find((r) => r.end === end)?.companion?.react('happy', 3);
        tell(p, won, tie ? 'Time! Exactly as many points each.' : won ? 'Time! Your seesaw caught the most!' : 'Time! Their seesaw caught more.');
      });
      if (won && !tie) view.cheer(team, 'Snack champs!');
    });
    await clock.wait(1.6);

    return {
      scores: seesawScores(boards, teams, seats.length),
      details: seats.map((_, p) => {
        const w = slot.get(p);
        const b = w ? boards[w.team] : undefined;
        return w && b ? seesawDetail(b, w.end) : '';
      }),
    };
  },
};
