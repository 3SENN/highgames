// Leaky Roof on the TV: a rainy night in an attic studio. The roof leaks in a row of drips, one over each player's pot
// or pan; tap as each drop lands in yours. Every pot rings its own note, so the drips that land well play the tune
// together, in harmony. The second half brings in syncopated drips, off the beat.
import * as THREE from 'three';
import { LEAKY_GROOVE, LEAKY_SONG, POTS, dripDetail, dripPitch, waterLevel } from '../../../game/minigames/leakyroof';
import { type Chart, type Note, type Track, makeChart } from '../../../game/minigames/rhythm';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cone, cyl, dome, material, mix, part, rbox, seeded, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark, noise, tone } from '../kit';
import { type Groove, NoteLane, PhraseCaption, RhythmRound, beatPulse } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const GROOVE: Groove = LEAKY_GROOVE;

const SPACING = 2.7;
const POT_DX = 0.42; // a pot sits right of its slot's middle; its owner sits behind it on the left
const POT_Z = 0.45;
const OWNER_X = -0.62;
const OWNER_Z = -0.8;
const CUSHION_Y = 0.24;
const RIM_Y = 0.52; // every pot's rim is at this height: where the drops land
const BEAM_Y = 3.95; // the beam the drips run off
const LANE = BEAM_Y - 0.14 - RIM_Y;
const WALL_Z = -2.8;
const KNEE = 1.3; // the low wall at the back, where the roof comes down
const ROOF_TILT = -0.91; // the roof rises toward us from the top of the low wall
const WOOD = mix(P.wood, P.ink, 0.2);
const WOOD_DARK = mix(P.walnut, P.ink, 0.1);
const PLASTER = mix(P.duskWall, P.linen, 0.3);
const STEEL = mix(P.stone, P.moon, 0.35);
const IRON = P.charcoal;
/** Rain water, lit by the fairy lights. */
const WATER = '#9fcbe6';

/** Each pot's shape: its radius, how wide its water is and how deep. Pot 0 sings highest, pot 3 lowest. */
const POT_SHAPES = [
  { name: 'saucepan', r: 0.27, water: 0.25, depth: 0.38 },
  { name: 'pan', r: 0.29, water: 0.28, depth: 0.08 },
  { name: 'bucket', r: 0.31, water: 0.24, depth: 0.46 },
  { name: 'stockpot', r: 0.36, water: 0.34, depth: 0.46 },
] as const;

/** How each pot rings when a drop lands: a ring time, an overtone (ratio, level) for its metal. */
const POT_TONES = [
  { ring: 0.55, partial: 2.76, level: 0.02 },
  { ring: 0.75, partial: 2.4, level: 0.026 },
  { ring: 0.45, partial: 3.1, level: 0.02 },
  { ring: 0.85, partial: 2.0, level: 0.032 },
] as const;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A drop landing in a pot: a little bloop of water, then the pot rings its note. */
function plink(sfx: Sfx, midi: number, pot: number, vel: number): void {
  const f = hz(midi);
  const t = POT_TONES[pot % POT_TONES.length] ?? POT_TONES[0];
  tone(sfx, { freq: 520, to: 1350, dur: 0.05, gain: 0.014 * vel });
  tone(sfx, { freq: f, dur: t.ring, gain: 0.06 * vel, delay: 0.012 });
  tone(sfx, { freq: f * t.partial, dur: t.ring * 0.3, gain: t.level * vel, delay: 0.012 });
}

/** A water drop, point up, tinted in the seat's colour; smaller on the "and". */
function drop(note: Note, color: string): THREE.Group {
  const g = new THREE.Group();
  const s = note.onBeat ? 1 : 0.78;
  const water = mix(color, WATER, 0.5);
  part(g, sphere(0.11 * s, 16), water, 0, 0, 0, { glow: 0.7, gloss: 0.8, shadow: false });
  part(g, cone(0.078 * s, 0.15 * s, 14), water, 0, 0.1 * s, 0, { glow: 0.7, shadow: false });
  part(g, ball(0.035 * s, 1), P.cream, -0.035 * s, 0.03 * s, 0.08 * s, { glow: 1.4, shadow: false, outline: false });
  return g;
}

/** The ring at a pot's rim, lying flat. */
function rimTarget(color: string, r: number): THREE.Group {
  const g = new THREE.Group();
  part(g, torus(r, 0.035), color, 0, 0, 0, { rx: Math.PI / 2, glow: 1.1, shadow: false });
  return g;
}

/** A pot or pan for pot `kind`, its rim at RIM_Y, standing on y = 0. */
function buildPot(kind: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const shape = POT_SHAPES[kind % POT_SHAPES.length] ?? POT_SHAPES[0];
  const r = shape.r;
  switch (shape.name) {
    case 'saucepan':
      // On a couple of old paperbacks, to reach the drip.
      part(g, rbox(0.7, 0.07, 0.55, 0.02), P.denim, 0, 0.035, 0);
      part(g, rbox(0.62, 0.065, 0.5, 0.02), P.terracotta, 0.02, 0.1, 0.01, { ry: 0.12 });
      part(g, cyl(r + 0.03, r, RIM_Y - 0.13, 28), STEEL, 0, 0.13 + (RIM_Y - 0.13) / 2, 0, { gloss: 0.7 });
      part(g, torus(r + 0.03, 0.022), mix(STEEL, P.cream, 0.4), 0, RIM_Y, 0, { rx: Math.PI / 2, outline: false, gloss: 0.7 });
      part(g, rbox(0.62, 0.06, 0.09, 0.03), color, r + 0.33, RIM_Y - 0.06, -0.12, { ry: 0.35, gloss: 0.3 });
      break;
    case 'pan':
      // A frying pan on an upturned crate.
      part(g, rbox(0.66, RIM_Y - 0.1, 0.56, 0.04), P.wood, 0, (RIM_Y - 0.1) / 2, 0, { tex: 'planks' });
      for (const y of [0.14, 0.28]) part(g, rbox(0.67, 0.025, 0.57, 0.01), P.woodDark, 0, y, 0, { outline: false });
      part(g, cyl(r + 0.05, r, 0.1, 28), IRON, 0, RIM_Y - 0.05, 0, { gloss: 0.35 });
      part(g, rbox(0.55, 0.05, 0.08, 0.025), color, r + 0.3, RIM_Y - 0.03, -0.15, { ry: 0.45, gloss: 0.3 });
      break;
    case 'bucket':
      part(g, cyl(r + 0.02, r - 0.06, RIM_Y, 28), STEEL, 0, RIM_Y / 2, 0, { tex: 'metalPlate', texStrength: 0.3, gloss: 0.6 });
      part(g, torus(r - 0.01, 0.024), color, 0, RIM_Y * 0.55, 0, { rx: Math.PI / 2, outline: false });
      part(g, torus(r + 0.02, 0.02), mix(STEEL, P.cream, 0.4), 0, RIM_Y, 0, { rx: Math.PI / 2, outline: false, gloss: 0.7 });
      part(g, torus(r + 0.02, 0.012, Math.PI), P.metal, 0, RIM_Y, 0, { rx: -1.2, outline: false });
      break;
    default:
      // The big stock pot, in enamel of the seat's colour, its lid propped against it.
      part(g, cyl(r + 0.01, r, RIM_Y, 28), mix(color, P.aubergine, 0.15), 0, RIM_Y / 2, 0, { gloss: 0.6 });
      part(g, torus(r + 0.01, 0.024), P.ceramic, 0, RIM_Y, 0, { rx: Math.PI / 2, outline: false, gloss: 0.6 });
      for (const s of [-1, 1]) part(g, rbox(0.1, 0.05, 0.14, 0.02), IRON, s * (r + 0.06), RIM_Y - 0.1, 0);
      part(g, dome(0.3), mix(color, P.aubergine, 0.15), -r - 0.12, 0.25, -0.25, { rz: 1.25, sy: 0.35, gloss: 0.6 });
      break;
  }
  return g;
}

interface Pot {
  root: THREE.Group;
  water: THREE.Mesh;
  /** The water's radius (ripples spread to it). */
  radius: number;
  bottom: number;
  depth: number;
  level: number;
  want: number;
  squash: number;
}

interface Ripple {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
}

interface Splash {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  t: number;
}

interface Streak {
  mesh: THREE.Mesh;
  z0: number;
  z1: number;
  speed: number;
}

class AtticView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: NoteLane[] = [];
  private readonly pots: Pot[] = [];
  private readonly ripples: Ripple[][] = [];
  private readonly splashes: Splash[][] = [];
  private readonly beads: THREE.Mesh[] = [];
  private readonly streaks: Streak[] = [];
  private readonly bulbs: THREE.Mesh[] = [];
  private readonly owned: THREE.Material[] = [];
  private readonly marks: Mark[] = [];
  private readonly fit: CameraFit;
  private readonly cat = new THREE.Group();
  private readonly dressing: THREE.Object3D[] = [];
  private tick: (dt: number, time: number) => void = () => {};
  private songTime: () => number = () => -1;
  private tracks: readonly Track[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly companions: Companion[],
    private readonly chart: Chart,
  ) {
    const scene = this.scene;
    // Lights low: the night through the skylights, the fairy lights along the beam and the desk lamp do the rest.
    lightRig(scene, 'nightInterior', { shadowSize: 12 });
    const rand = seeded(88);

    const n = seats.length;
    const xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    const W = n * SPACING;
    const FW = Math.max(30, W + 18);
    const beamHalf = W / 2 + 3; // the posts stand out past the desk and the guitar
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, sc = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc);
      scene.add(o);
      this.dressing.push(o);
      return o;
    };

    withOutline(0.03, () => {
      // Old floorboards, the low wall at the back, and a woolly rug under the pots.
      part(scene, box(FW + 20, 0.5, 30), mix(P.oak, P.walnut, 0.45), 0, -0.25, 6, { tex: 'woodFloor', outline: false, shadow: false });
      part(scene, box(FW + 20, KNEE, 0.3), PLASTER, 0, KNEE / 2, WALL_Z, { tex: 'plaster', outline: false });
      part(scene, box(FW + 20, 0.14, 0.34), WOOD, 0, 0.07, WALL_Z + 0.02, { tex: 'darkWood', outline: false });
      put(props.rug({ w: W + 2.6, d: 2.7, color: mix(P.mauve, P.plum, 0.55), border: mix(P.sand, P.plum, 0.35), tex: 'knit' }), 0, 0, 0.2);

      // The roof, rising toward us from the low wall: boards, rafters, skylights with rain on them.
      const roof = new THREE.Group();
      roof.position.set(0, KNEE, WALL_Z + 0.12);
      roof.rotation.x = ROOF_TILT;
      scene.add(roof);
      const L = 6;
      part(roof, box(FW + 20, 0.2, L + 6), mix(P.wood, P.ink, 0.3), 0, 0, L / 2 + 3, { tex: 'planks', outline: false });
      const skylights = n <= 1 ? [-1.6, 1.6] : [-W / 2 + 0.2, 0, W / 2 - 0.2];
      for (let x = -FW / 2 + 0.6; x <= FW / 2; x += 1.6) {
        if (skylights.some((sx) => Math.abs(sx - x) < 0.8)) continue;
        part(roof, rbox(0.16, 0.2, L + 6, 0.04), WOOD_DARK, x, -0.18, L / 2 + 3, { tex: 'darkWood', outline: false });
      }
      for (const sx of skylights) {
        const frame = mix(P.linen, P.ink, 0.25);
        part(roof, rbox(1.25, 0.12, 1.65, 0.04), frame, sx, -0.13, 2.4, { outline: 0.015 });
        part(roof, rbox(1.05, 0.1, 1.45, 0.02), mix(P.midnight, P.denim, 0.25), sx, -0.15, 2.4, { basic: true });
        part(roof, rbox(1.05, 0.11, 0.05, 0.01), frame, sx, -0.16, 2.4, { outline: false });
        for (let k = 0; k < 7; k++) {
          const mat = new THREE.MeshBasicMaterial({ color: P.moon, transparent: true, opacity: 0.5, depthWrite: false });
          this.owned.push(mat);
          const m = new THREE.Mesh(rbox(0.014, 0.01, 0.2 + rand() * 0.15, 0.004), mat);
          m.position.set(sx - 0.45 + rand() * 0.9, -0.23, 0);
          roof.add(m);
          this.streaks.push({ mesh: m, z0: 1.75, z1: 3.05, speed: 0.9 + rand() * 0.8 });
          m.position.z = 1.75 + rand() * 1.3;
        }
        for (let k = 0; k < 6; k++) part(roof, ball(0.018, 0), P.cream, sx - 0.4 + rand() * 0.8, -0.22, 1.8 + rand() * 1.2, { basic: true, shadow: false });
      }

      // The beam the drips run off, and a post at each end holding it up.
      part(scene, rbox(beamHalf * 2 + 0.4, 0.26, 0.3, 0.05), WOOD, 0, BEAM_Y + 0.13, POT_Z, { tex: 'darkWood' });
      for (const s of [-1, 1]) {
        part(scene, rbox(0.24, BEAM_Y, 0.24, 0.05), WOOD_DARK, s * beamHalf, BEAM_Y / 2, POT_Z, { tex: 'darkWood' });
        part(scene, rbox(0.12, 0.9, 0.12, 0.03), WOOD_DARK, s * (beamHalf - 0.35), BEAM_Y - 0.25, POT_Z, { rz: s * 0.78, tex: 'darkWood' });
      }

      // Fairy lights along the beam, clear of the drips.
      const leaks = xs.map((x) => x + POT_DX);
      for (let x = -beamHalf + 0.4; x <= beamHalf - 0.4; x += 0.45) {
        if (leaks.some((lx) => Math.abs(lx - x) < 0.35)) continue;
        const k = this.bulbs.length;
        this.bulbs.push(part(scene, sphere(0.05, 10), [P.lamp, P.glow, '#ffbf9a'][k % 3] as string, x, BEAM_Y - 0.06 - 0.06 * Math.abs(Math.sin(x * 2.1)), POT_Z + 0.16, { glow: 2.2, shadow: false }));
      }

      // On the right: a desk with a little keyboard, a glowing screen and a lamp; a beanbag in front of it.
      const dx = W / 2 + 1.75;
      part(scene, rbox(1.7, 0.08, 0.85, 0.03), P.wood, dx, 0.92, -0.9, { tex: 'wood' });
      for (const [ox, oz] of [
        [-0.75, -0.33],
        [0.75, -0.33],
        [-0.75, 0.33],
        [0.75, 0.33],
      ] as const)
        part(scene, rbox(0.07, 0.9, 0.07, 0.02), P.walnut, dx + ox, 0.45, -0.9 + oz, { outline: false });
      part(scene, rbox(0.9, 0.06, 0.3, 0.02), P.charcoal, dx - 0.1, 0.99, -0.75);
      part(scene, rbox(0.82, 0.02, 0.14, 0.01), P.ceramic, dx - 0.1, 1.025, -0.7, { outline: false });
      part(scene, rbox(0.66, 0.45, 0.05, 0.03), P.charcoal, dx - 0.05, 1.3, -1.15);
      part(scene, rbox(0.58, 0.37, 0.055, 0.02), P.screen, dx - 0.05, 1.3, -1.12, { glow: 1.3 });
      part(scene, cyl(0.12, 0.14, 0.03, 12), P.charcoal, dx + 0.6, 0.97, -1.05);
      part(scene, cyl(0.02, 0.02, 0.5, 6), P.charcoal, dx + 0.6, 1.2, -1.05, { rz: 0.2, outline: false });
      part(scene, cone(0.16, 0.2, 14), P.lamp, dx + 0.52, 1.47, -1.0, { rz: 0.6, glow: 1.6 });
      put(props.mug({ color: P.sage }), dx + 0.45, 0.96, -0.65, 0.8, 2.2);
      put(props.beanbag({ color: P.teal }), dx + 0.5, 0, 1.2, -0.6, 1.25);
      put(props.books(0.5, 6), dx + 1.5, 0, -0.4, 0.5, 1.6);

      // On the left: a guitar, a crate of records, a plant and a pouf.
      const lx = -W / 2 - 1.8;
      put(props.guitar(), lx, 0, -2.05, 0, 1.5);
      part(scene, rbox(0.7, 0.42, 0.45, 0.04), P.wood, lx + 0.9, 0.21, -0.9, { tex: 'planks' });
      for (let k = 0; k < 6; k++) part(scene, rbox(0.03, 0.4, 0.4, 0.01), props.FABRICS[(k * 3) % props.FABRICS.length] as string, lx + 0.66 + k * 0.09, 0.4, -0.9, { rz: 0.1, outline: false });
      put(props.plant({ kind: 'ficus', h: 1.5, pot: P.terracotta, seed: 4 }), lx - 0.7, 0, 0.0, 0, 1.2);
      put(props.pouf({ color: P.mustard }), lx - 0.1, 0, 1.5, 0, 1.6);
      put(props.motes({ n: 20, area: [W + 6, 2.6, 4], size: 0.04, color: P.moon }), 0, 0.8, 0.5);
    });
    this.tick = props.tickProps(scene);

    // A cat asleep on the rug at the front, its tail curled round.
    withOutline(0.03, () => {
      const fur = mix(P.mustard, P.terracotta, 0.45);
      part(this.cat, ball(0.24, 2), fur, 0, 0.14, 0, { sx: 1.3, sy: 0.65 });
      part(this.cat, ball(0.14, 2), fur, 0.26, 0.15, 0.08);
      for (const s of [-1, 1]) part(this.cat, cone(0.05, 0.1, 4), mix(fur, P.ink, 0.15), 0.26 + s * 0.07, 0.27, 0.06);
      part(this.cat, torus(0.2, 0.04, Math.PI * 1.2), mix(fur, P.ink, 0.15), -0.05, 0.05, 0.08, { rx: Math.PI / 2, outline: false });
    });
    this.cat.position.set(-W / 2 - 0.6, 0.05, 1.6);
    scene.add(this.cat);

    const lamp = new THREE.PointLight(P.lamp, 10, 9, 1.4);
    lamp.position.set(W / 2 + 2.1, 1.6, -0.6);
    const glow = new THREE.PointLight(P.lamp, 9, 13, 1.4);
    glow.position.set(0, BEAM_Y - 0.4, 1.5);
    scene.add(lamp, glow);

    seats.forEach((s, i) => {
      const x = xs[i] as number;
      const px = x + POT_DX;
      const kind = i % POTS;
      const shape = POT_SHAPES[kind] ?? POT_SHAPES[0];

      // The owner on a floor cushion behind the pot.
      withOutline(0.03, () => part(scene, sphere(0.42, 20), mix(s.color, P.aubergine, 0.25), x + OWNER_X, 0.15, OWNER_Z, { sy: 0.45, tex: 'velvet' }));
      const c = companions[i];
      if (c) {
        c.root.position.set(x + OWNER_X, CUSHION_Y, OWNER_Z);
        c.root.rotation.y = 0.25;
        c.setBase('listening');
        scene.add(c.root);
      }

      // The pot, and the water in it.
      const root = withOutline(0.035, () => buildPot(kind, s.color));
      root.position.set(px, 0, POT_Z);
      scene.add(root);
      const water = new THREE.Mesh(cyl(shape.water, shape.water, 0.02, 22), material('#5f93c8', { glow: 0.4, gloss: 0.8 }));
      root.add(water);
      const bottom = RIM_Y - shape.depth;
      this.pots.push({ root, water, radius: shape.water, bottom, depth: shape.depth, level: 0.15, want: waterLevel(0, chart.notes.length), squash: 0 });

      // Where it leaks: a damp patch on the beam and a bead of water waiting to fall.
      withOutline(0.02, () => {
        part(scene, ball(0.16, 1), mix(P.walnut, P.ink, 0.3), px, BEAM_Y + 0.005, POT_Z, { sy: 0.2, outline: false });
        this.beads.push(part(scene, ball(0.05, 1), mix(s.color, WATER, 0.5), px, BEAM_Y - 0.04, POT_Z, { glow: 0.8, shadow: false }));
      });

      const lane = new NoteLane(chart, {
        color: s.color,
        dir: new THREE.Vector3(0, 1, 0),
        length: LANE,
        ahead: chart.beat * 3,
        marker: (note) => drop(note, s.color),
        target: rimTarget(s.color, shape.r + 0.03),
        rail: false,
        flash: 0.26,
        ticks: 0.28,
        past: 0.3,
        labelAt: new THREE.Vector3(0.75, 0.55, 0.2),
        labelSize: 0.32,
      });
      lane.group.position.set(px, RIM_Y, POT_Z);
      scene.add(lane.group);
      this.lanes.push(lane);

      const rings: Ripple[] = [];
      for (let k = 0; k < 2; k++) {
        const mat = new THREE.MeshBasicMaterial({ color: mix(s.color, P.cream, 0.6), transparent: true, opacity: 0, depthWrite: false });
        this.owned.push(mat);
        const mesh = new THREE.Mesh(torus(0.1, 0.012), mat);
        mesh.rotation.x = Math.PI / 2;
        mesh.visible = false;
        scene.add(mesh);
        rings.push({ mesh, mat, t: 1 });
      }
      this.ripples.push(rings);
      const drops: Splash[] = [];
      const splashMat = new THREE.MeshBasicMaterial({ color: WATER });
      this.owned.push(splashMat);
      for (let k = 0; k < 6; k++) {
        const mesh = new THREE.Mesh(ball(0.025, 0), splashMat);
        mesh.visible = false;
        scene.add(mesh);
        drops.push({ mesh, v: new THREE.Vector3(), t: 1 });
      }
      this.splashes.push(drops);

      this.marks.push(
        { p: new THREE.Vector3(px - 0.3, BEAM_Y + 0.3, POT_Z) },
        { p: new THREE.Vector3(px + 0.3, BEAM_Y + 0.3, POT_Z) },
        { p: new THREE.Vector3(x - SPACING / 2 + 0.1, 0, 1.4) },
        { p: new THREE.Vector3(x + SPACING / 2 - 0.1, 0, 1.4) },
        { p: new THREE.Vector3(x + OWNER_X, 1.65, OWNER_Z) },
        { p: new THREE.Vector3(px + 1.1, RIM_Y + 0.55, POT_Z + 0.2), pad: 0.05 },
      );
    });

    this.fit = new CameraFit(this.camera, 0.2);
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  /** A drop landed in time: the pot wobbles, ripples spread and a little splash jumps. */
  land(seat: number, caught: number): void {
    const pot = this.pots[seat];
    if (!pot) return;
    pot.squash = 1;
    pot.want = waterLevel(caught, this.chart.notes.length);
    const at = new THREE.Vector3(pot.root.position.x, pot.water.position.y + 0.012, pot.root.position.z);
    const ring = this.ripples[seat]?.find((r) => r.t >= 1);
    if (ring) {
      ring.t = 0;
      ring.mesh.position.copy(at);
      ring.mesh.visible = true;
    }
    for (const d of (this.splashes[seat] ?? []).filter((q) => q.t >= 1).slice(0, 3)) {
      const a = Math.random() * Math.PI * 2;
      d.t = 0;
      d.mesh.position.copy(at);
      d.v.set(Math.cos(a) * 0.45, 2.0 + Math.random() * 0.4, Math.sin(a) * 0.45);
      d.mesh.visible = true;
    }
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    const t = this.songTime();
    const playing = t >= 0 && t < this.chart.end;
    const bob = playing ? beatPulse(t, this.chart.beat) : 0;
    this.companions.forEach((c) => {
      c.update(dt);
      c.root.position.y = CUSHION_Y - bob * 0.03;
    });
    this.lanes.forEach((lane, i) => lane.update(t, this.tracks[i]?.judged ?? [], dt));

    for (const pot of this.pots) {
      pot.level += (pot.want - pot.level) * Math.min(1, dt * 4);
      pot.water.position.y = pot.bottom + pot.depth * pot.level;
      pot.squash = Math.max(0, pot.squash - dt * 6);
      pot.root.scale.set(1 + 0.05 * pot.squash, 1 - 0.07 * pot.squash, 1 + 0.05 * pot.squash);
    }
    this.ripples.forEach((rings, i) => {
      const reach = (this.pots[i]?.radius ?? 0.3) / 0.1 - 1;
      for (const r of rings) {
        if (r.t >= 1) continue;
        r.t = Math.min(1, r.t + dt / 0.7);
        r.mesh.scale.setScalar(1 + r.t * reach);
        r.mat.opacity = 0.8 * (1 - r.t);
        if (r.t >= 1) r.mesh.visible = false;
      }
    });
    for (const drops of this.splashes) {
      for (const d of drops) {
        if (d.t >= 1) continue;
        d.t = Math.min(1, d.t + dt / 0.6);
        d.v.y -= dt * 8;
        d.mesh.position.addScaledVector(d.v, dt);
        if (d.t >= 1) d.mesh.visible = false;
      }
    }
    // The waiting beads swell as their next drop comes.
    const next = this.chart.notes.find((n) => n.time > t);
    const swell = next ? Math.max(0, 1 - (next.time - t) / (this.chart.beat * 3)) : 0;
    this.beads.forEach((b, i) => b.scale.setScalar(0.7 + 0.5 * swell + 0.05 * Math.sin(time * 3 + i)));
    for (const s of this.streaks) {
      s.mesh.position.z -= s.speed * dt;
      if (s.mesh.position.z < s.z0) s.mesh.position.z = s.z1;
    }
    this.bulbs.forEach((b, i) => b.scale.setScalar(1 + 0.15 * Math.max(0, Math.sin(time * 1.2 + i * 1.7))));
    this.cat.scale.set(1, 1 + 0.04 * Math.sin(time * 1.6), 1);
    this.tick(dt, time);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const l of this.lanes) l.dispose();
    for (const m of this.owned) m.dispose();
  }
}

/** Rain on the roof: a soft hiss with the odd heavier patter and slow gusts. Starts once the TV has sound. */
class Rain {
  private nodes: { srcs: AudioBufferSourceNode[]; lfo: OscillatorNode; level: GainNode } | null = null;
  private stopped = false;

  constructor(private readonly sfx: Sfx) {}

  pump(): void {
    if (this.nodes || this.stopped) return;
    const a = this.sfx.audio;
    if (!a) return;
    const ac = a.ctx;
    const len = ac.sampleRate * 3;
    const hiss = ac.createBuffer(1, len, ac.sampleRate);
    const h = hiss.getChannelData(0);
    for (let i = 0; i < len; i++) h[i] = Math.random() * 2 - 1;
    const patter = ac.createBuffer(1, len, ac.sampleRate);
    const p = patter.getChannelData(0);
    let tap = 0;
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.0009) tap = 0.4 + Math.random() * 0.6;
      p[i] = (Math.random() * 2 - 1) * tap;
      tap *= 0.993;
    }
    // Layers -> gusts (a slow swell) -> level (fades in and out) -> out.
    const level = ac.createGain();
    const now = ac.currentTime;
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(1, now + 1.5);
    level.connect(a.out);
    const gusts = ac.createGain();
    gusts.gain.value = 1;
    gusts.connect(level);
    const layer = (buffer: AudioBuffer, type: BiquadFilterType, freq: number, q: number, gain: number) => {
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ac.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g).connect(gusts);
      src.start(now, Math.random() * 2);
      return src;
    };
    const srcs = [layer(hiss, 'bandpass', 1400, 0.5, 0.022), layer(patter, 'bandpass', 2600, 0.8, 0.03)];
    // Slow gusts: the hiss swells and settles.
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ac.createGain();
    depth.gain.value = 0.25;
    lfo.connect(depth).connect(gusts.gain);
    lfo.start(now);
    this.nodes = { srcs, lfo, level };
  }

  stop(): void {
    this.stopped = true;
    const n = this.nodes;
    const ac = this.sfx.audio?.ctx;
    if (!n || !ac) return;
    const now = ac.currentTime;
    n.level.gain.cancelScheduledValues(now);
    n.level.gain.setValueAtTime(n.level.gain.value, now);
    n.level.gain.linearRampToValueAtTime(0, now + 2);
    for (const s of n.srcs) s.stop(now + 2.2);
    n.lfo.stop(now + 2.2);
    this.nodes = null;
  }
}

export const minigame: Minigame = {
  id: 'leakyroof',
  title: 'Leaky Roof',
  how: 'Rain on the attic roof, and it drips into a pot in front of each of you. Tap as each drop lands in yours: every pot rings its own note, so together you play the tune. Later on the drips come off the beat.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui, sfx } = ctx;
    const chart = makeChart(LEAKY_SONG, ctx.rng);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.3, mood: 'listening' })));
    const view = new AtticView(seats, companions, chart);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const caught = seats.map(() => 0);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'tap',
      groove: GROOVE,
      note: 'Tap as each drop lands in your pot',
      onJudge: (seat, j) => {
        view.lanes[seat]?.hit(j.grade);
        const c = view.companions[seat];
        const human = !session.isCpu(seat);
        if (j.grade !== 'miss' && j.note !== null) {
          caught[seat] = (caught[seat] ?? 0) + 1;
          view.land(seat, caught[seat] ?? 0);
          // Each pot sings its own voice of the tune; the computer pots a little softer.
          plink(sfx, dripPitch(chart, j.note, seat % POTS), seat % POTS, (j.grade === 'perfect' ? 1 : 0.75) * (human ? 1 : 0.45));
          if (j.combo > 0 && j.combo % 8 === 0) c?.react('happy', 1.3);
          return;
        }
        // A drop that fell in unplayed lands with a dull plop.
        if (human && j.note !== null && j.offset === null) noise(sfx, { dur: 0.12, filter: 'lowpass', freq: 700, to: 300, gain: 0.05 });
        if (now - (lastSad[seat] ?? -9) > 1.5) {
          lastSad[seat] = now;
          c?.react('sad', 0.9);
        }
      },
    });
    view.attach(round);

    const rain = new Rain(sfx);
    const caption = new PhraseCaption(ui, chart, LEAKY_SONG.phrase, 'Drip', 'The rain eases off…');
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${round.tracks[i]?.score ?? 0} pts` })));
    ui.caption('Tap as each drop lands in your pot');
    let liveAt = -1;
    try {
      await round.play((_, t) => {
        now = t;
        rain.pump();
        caption.update(t);
        if (t - liveAt > 0.2) {
          liveAt = t;
          live();
        }
      });
    } finally {
      rain.stop();
    }
    live();

    const scores = round.tracks.map((t) => t.score);
    const top = Math.max(...scores);
    view.companions.forEach((c, i) => c.setBase(scores[i] === top ? 'happy' : 'idle'));
    ui.caption(null);
    await ctx.clock.wait(1.2);
    return { scores, details: round.tracks.map((t) => dripDetail(t, chart)) };
  },
};
