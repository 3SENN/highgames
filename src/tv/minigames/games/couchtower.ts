// Couch Tower on the TV: a backyard at night, a wobbly tower of a couch, a coffee table, a beanbag and a loveseat,
// with the whole group balancing on top. A gauge shows the lean; string lights count the seconds it stays up.
import * as THREE from 'three';
import {
  CAT_HOP,
  CAT_TOP,
  EVENT_INFO,
  TOWER,
  type Tower,
  type TowerCpu,
  type TowerEvent,
  activeEvents,
  cpuTowerWobble,
  newTower,
  stepTower,
  survived,
  towerCoop,
  towerSide,
} from '../../../game/minigames/couchtower';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { FONT, PALETTE as P, ball, box, canvasTexture, cone, cyl, material, mix, part, pill, plane, popSprite, rbox, seeded, sphere, torus } from '../../render/toon';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const STEP = 1 / 60; // physics step
const SHARES = [0.4, 0.2, 0.2, 0.2]; // how the lean spreads over the four joints of the stack
const SEAT_Y = 0.58; // where the players stand on the top couch
const BULBS = 15; // string lights, one per two seconds
const SPEAKER_X = 4.7;
const DOOR = new THREE.Vector3(-4.4, 0, -6.1);
const GAUGE = new THREE.Vector3(7.0, 3.6, 0.2);
const WALL_Z = -6.6; // the back of the house
const LIT = [P.lamp, P.rose, P.moon]; // the string lights, once they come on

/** The cat: ginger, round, facing +x. */
function catModel(): THREE.Group {
  const g = new THREE.Group();
  const fur = mix(P.accent, P.mustard, 0.45);
  const dark = mix(fur, P.mahogany, 0.5);
  const line = { outline: 0.02 };
  part(g, pill(0.2, 0.4), fur, 0, 0.24, 0, { rz: Math.PI / 2, ...line });
  for (const x of [-0.18, 0, 0.18]) part(g, torus(0.2, 0.025, Math.PI), dark, x, 0.24, 0, { ry: Math.PI / 2, outline: false, shadow: false });
  part(g, ball(0.13, 1), P.cream, 0.22, 0.17, 0, { sx: 1.1, outline: false });
  part(g, ball(0.2, 1), fur, 0.42, 0.42, 0, line);
  part(g, ball(0.09, 1), P.cream, 0.55, 0.37, 0, { sz: 1.3, outline: false });
  part(g, sphere(0.022, 6), P.rose, 0.63, 0.4, 0, { outline: false });
  for (const z of [-0.1, 0.1]) {
    part(g, cone(0.07, 0.14, 8), fur, 0.44, 0.62, z, line);
    part(g, cone(0.04, 0.08, 8), P.rose, 0.46, 0.61, z, { outline: false, shadow: false });
  }
  for (const z of [-0.08, 0.08]) part(g, ball(0.03, 0), P.ink, 0.6, 0.45, z, { outline: false, gloss: 0.7 });
  part(g, pill(0.045, 0.45), dark, -0.42, 0.42, 0, { rz: -0.5, ...line });
  part(g, sphere(0.055, 8), P.cream, -0.55, 0.64, 0, { outline: false });
  for (const x of [-0.2, 0.2]) for (const z of [-0.1, 0.1]) part(g, cyl(0.05, 0.05, 0.16, 6), x > 0 ? P.cream : fur, x, 0.07, z, { outline: false });
  return g;
}

interface Tween {
  t: number;
  duration: number;
  step: (k: number) => void;
  done?: () => void;
}

interface Fx {
  obj: THREE.Object3D;
  life: number;
  total: number;
  step: (k: number) => void;
  dispose?: () => void;
}

class TowerView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 200);
  readonly crew: Companion[];
  private joints: THREE.Group[] = [];
  private top: THREE.Group;
  private bulbs: THREE.Mesh[] = [];
  private streaks: THREE.Mesh[] = [];
  private woofers: THREE.Mesh[] = [];
  private bell: THREE.Mesh;
  private cat: THREE.Group | null = null;
  private catEvent: TowerEvent | null = null;
  private tweens: Tween[] = [];
  private fx: Fx[] = [];
  private gauge: THREE.CanvasTexture;
  private gaugeMat: THREE.MeshBasicMaterial;
  private lamp: THREE.PointLight;
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private lit = 0;
  /** Set by the game each frame. */
  lean = 0;
  wobble: number[] = [];
  breeze: TowerEvent | null = null;
  /** Set by the game once the breeze has passed. */
  breezeOver = false;
  /** Seconds into the current cat event (set by the game). */
  catTime = 0;
  private fallen = false;
  private ringing = 0;

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    this.crew = companions;
    const scene = this.scene;
    // A back garden at night; the action is on the deck behind the house.
    const env = backyard(scene, { mood: 'night', w: 27, d: 15, clear: { w: 22, d: 12 }, lights: false, seed: 13 });
    env.sun.target.position.set(0, 2, 0);
    env.sun.intensity *= 1.2;
    this.env = env;
    const set = new THREE.Group();
    scene.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = 1) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      if (scale !== 1) o.scale.setScalar(scale);
      set.add(o);
      return o;
    };

    // The back of the house: brick, a stone plinth, the door with its lamp and bell, three lit windows.
    const bricks = mix(P.brick, P.aubergine, 0.35);
    part(set, box(40, 11, 0.5), bricks, 0, 5.5, WALL_Z, { tex: 'brick', texScale: 2.4, outline: false });
    part(set, box(40, 0.6, 0.6), mix(P.stone, P.aubergine, 0.3), 0, 0.3, WALL_Z + 0.05, { tex: 'concrete', outline: false });
    part(set, cyl(0.09, 0.09, 11, 8), P.charcoal, -11.2, 5.5, WALL_Z + 0.36, { gloss: 0.4, outline: false });
    const door = P.forest;
    part(set, rbox(2.3, 3.5, 0.24, 0.04), P.cream, DOOR.x, 1.75, DOOR.z - 0.1, { outline: false });
    part(set, rbox(1.9, 3.2, 0.2, 0.05), door, DOOR.x, 1.6, DOOR.z, { gloss: 0.3, outline: 0.025 });
    for (const [dx, dy, dh] of [[-0.42, 2.2, 1.4], [0.42, 2.2, 1.4], [-0.42, 0.8, 1.0], [0.42, 0.8, 1.0]] as const) part(set, rbox(0.62, dh, 0.04, 0.02), mix(door, P.ink, 0.18), DOOR.x + dx, dy, DOOR.z + 0.1, { outline: false });
    part(set, rbox(2.5, 0.2, 0.9, 0.04), P.stone, DOOR.x, 0.1, DOOR.z + 0.5, { tex: 'stoneTiles', outline: false });
    part(set, rbox(2.5, 0.25, 0.45, 0.05), P.cream, DOOR.x, 3.5, DOOR.z + 0.1, { outline: false });
    part(set, sphere(0.08, 10), P.brass, DOOR.x + 0.68, 1.55, DOOR.z + 0.16, { gloss: 0.7, outline: false });
    part(set, rbox(0.22, 0.34, 0.06, 0.02), P.brass, DOOR.x + 1.3, 1.6, DOOR.z + 0.1, { gloss: 0.6, outline: false });
    this.bell = part(set, sphere(0.09, 12), P.screen, DOOR.x + 1.3, 1.6, DOOR.z + 0.15, { glow: 0.9, outline: false, shadow: false });
    part(set, cyl(0.03, 0.03, 0.3, 6), P.charcoal, DOOR.x, 3.95, DOOR.z + 0.18, { rx: Math.PI / 2, outline: false });
    part(set, cone(0.3, 0.2, 14), P.charcoal, DOOR.x, 3.98, DOOR.z + 0.34, { outline: false });
    part(set, sphere(0.16, 12), P.lamp, DOOR.x, 3.82, DOOR.z + 0.34, { glow: 2.2, outline: false, shadow: false });
    const porch = new THREE.PointLight(P.lamp, 14, 9, 1.6);
    porch.position.set(DOOR.x, 3.5, DOOR.z + 0.9);
    scene.add(porch);
    for (const [x, y] of [
      [3.6, 3.4],
      [7.4, 3.4],
      [-8.6, 3.4],
    ] as const) {
      part(set, rbox(2.5, 1.9, 0.12, 0.03), P.cream, x, y, WALL_Z + 0.24, { outline: false });
      part(set, box(2.2, 1.6, 0.06), P.lamp, x, y, WALL_Z + 0.3, { glow: 0.85, outline: false, shadow: false });
      part(set, box(0.07, 1.6, 0.08), P.cream, x, y, WALL_Z + 0.34, { outline: false, shadow: false });
      part(set, box(2.2, 0.07, 0.08), P.cream, x, y + 0.15, WALL_Z + 0.34, { outline: false, shadow: false });
      part(set, rbox(2.7, 0.1, 0.3, 0.03), P.stone, x, y - 0.98, WALL_Z + 0.34, { outline: false });
      // Curtains half drawn inside, lit from behind.
      for (const side of [-1, 1]) part(set, box(0.46, 1.6, 0.02), mix(P.terracotta, P.aubergine, 0.2), x + side * 0.87, y, WALL_Z + 0.335, { glow: 0.3, outline: false, shadow: false });
    }
    put(props.plant({ kind: 'trailing', h: 0.4, pot: P.terracotta, seed: 3 }), 3.0, 2.47, WALL_Z + 0.4, 0, 1.4);
    put(props.plant({ kind: 'fern', h: 0.4, pot: P.ceramic, seed: 5 }), 8.0, 2.47, WALL_Z + 0.4, 0, 1.4);

    // The deck, a round rug in the middle of it, and two party speakers.
    part(set, box(24, 0.24, 11.4), P.wood, 0, -0.1, -0.9, { tex: 'planks', texScale: 2.6, outline: false, shadow: false });
    part(set, box(24.2, 0.3, 0.3), P.woodDark, 0, -0.13, 4.85, { tex: 'planks', outline: false });
    put(props.rug({ round: true, w: 6.9, color: P.denim, border: mix(P.denim, P.cream, 0.3) }), 0, 0.02, 0.4);
    for (const side of [-1, 1]) {
      const x = side * SPEAKER_X;
      part(set, rbox(1.3, 2.0, 1.1, 0.08), P.charcoal, x, 1.0, -0.6, { tex: 'leather', texStrength: 0.35, outline: 0.03 });
      part(set, cyl(0.5, 0.5, 0.04, 28), P.metal, x, 0.75, -0.045, { rx: Math.PI / 2, gloss: 0.6, outline: false });
      this.woofers.push(part(set, cyl(0.42, 0.42, 0.08, 28), P.slate, x, 0.75, -0.04, { rx: Math.PI / 2, outline: false }));
      part(set, sphere(0.14, 12), P.charcoal, x, 0.75, 0.0, { sz: 0.5, gloss: 0.5, outline: false });
      part(set, cyl(0.19, 0.19, 0.04, 20), P.metal, x, 1.55, -0.045, { rx: Math.PI / 2, gloss: 0.6, outline: false });
      part(set, cyl(0.15, 0.15, 0.06, 20), P.slate, x, 1.55, -0.03, { rx: Math.PI / 2, outline: false });
      part(set, sphere(0.03, 8), P.neonCyan, x + 0.5, 1.86, -0.04, { glow: 2, outline: false, shadow: false });
    }
    // String lights across the yard: they light up one by one while the tower stands.
    const hang = (k: number) => 6.15 - 4 * 0.45 * k * (1 - k);
    set.add(props.stringLights(new THREE.Vector3(-6.9, 6.25, -3.2), new THREE.Vector3(6.9, 6.25, -3.2), { sag: 0.45, count: 0 }));
    for (let i = 0; i < BULBS; i++) {
      const k = i / (BULBS - 1);
      const x = -6.6 + k * 13.2;
      part(set, cyl(0.05, 0.06, 0.12, 6), P.charcoal, x, hang(k) + 0.15, -3.2, { outline: false, shadow: false });
      this.bulbs.push(part(set, sphere(0.17, 12), P.slate, x, hang(k), -3.2, { outline: false, shadow: false }));
    }
    for (const x of [-6.9, 6.9]) part(set, cyl(0.07, 0.08, 6.4, 8), P.walnut, x, 3.1, -3.2, { tex: 'planks', outline: false });

    // Around the deck: lanterns, plants, somewhere to put a drink.
    put(props.gardenLamp({ h: 1.3, light: 9 }), -3.4, 0.02, 2.6);
    put(props.gardenLamp({ h: 1.3, light: 9 }), 3.6, 0.02, 2.6);
    put(props.plant({ kind: 'palm', h: 1.7, pot: P.terracotta, seed: 4 }), -7.6, 0.02, -5.2, 0, 1.4);
    put(props.plant({ kind: 'ficus', h: 1.9, pot: P.ceramic, seed: 6 }), -1.9, 0.02, -5.4, 0, 1.3);
    put(props.plant({ kind: 'monstera', h: 1.0, pot: P.charcoal, seed: 8 }), 10.2, 0.02, -5.1, 0, 1.5);
    put(props.crate({ s: 0.8 }), -9.4, 0.02, 2.4, 0.3);
    put(props.drink({ kind: 'bottle', color: P.forest }), -9.5, 0.82, 2.4, 0, 1.6);
    put(props.snackBowl({ fill: 'crisps', color: P.terracotta, r: 0.2 }), -9.2, 0.82, 2.5);
    put(props.pouf({ color: P.mustard }), -8.2, 0.02, 3.3, 0, 1.7);
    put(props.beanbag({ color: P.rose }), 9.6, 0.02, 3.0, -0.5, 1.6);
    put(props.bush({ r: 1.0, flowers: P.cream, seed: 5 }), -11.5, 0, 6.2);
    put(props.bush({ r: 0.9, flowers: P.rose, seed: 9 }), 11.6, 0, 6.4);
    put(props.rock({ r: 0.4, seed: 3 }), 9.8, 0, 6.6);

    // The tower. Each piece hangs off the one below it, so the lean spreads up the stack.
    const sofa = { tex: 'fabric' as const, texScale: 0.9, outline: 0.03 };
    const wood = { tex: 'wood' as const, outline: 0.025 };
    const base = new THREE.Group();
    this.scene.add(base);
    this.joints.push(base);
    for (const x of [-2.1, 2.1]) for (const z of [-0.7, 0.7]) part(base, cyl(0.08, 0.06, 0.16, 8), P.walnut, x, 0.08, z, { outline: false });
    part(base, rbox(4.6, 0.55, 1.8, 0.12), P.teal, 0, 0.43, 0, sofa);
    for (const x of [-1.05, 1.05]) part(base, rbox(2.05, 0.28, 1.4, 0.1), mix(P.teal, P.cream, 0.16), x, 0.84, 0.12, sofa);
    part(base, rbox(4.6, 0.75, 0.42, 0.12), P.teal, 0, 1.05, -0.69, sofa);
    for (const x of [-2.12, 2.12]) part(base, rbox(0.42, 0.6, 1.8, 0.12), P.teal, x, 0.95, 0, sofa);
    part(base, rbox(0.5, 0.06, 1.5, 0.03), P.mustard, 2.12, 1.27, 0.05, { tex: 'knit', outline: false });
    part(base, rbox(0.06, 0.5, 1.5, 0.03), P.mustard, 2.35, 1.03, 0.05, { tex: 'knit', outline: false });
    const table = new THREE.Group();
    table.position.y = 0.98;
    base.add(table);
    this.joints.push(table);
    for (const x of [-1.5, 1.5]) for (const z of [-0.5, 0.5]) part(table, cyl(0.07, 0.06, 0.72, 8), P.walnut, x, 0.36, z, { outline: false });
    part(table, rbox(3.6, 0.16, 1.4, 0.05), P.oak, 0, 0.78, 0, { ...wood, gloss: 0.2 });
    part(table, rbox(3.3, 0.06, 1.1, 0.02), P.walnut, 0, 0.67, 0, { outline: false });
    const bowl = props.snackBowl({ fill: 'popcorn', color: P.terracotta, r: 0.2 });
    bowl.position.set(-1.35, 0.86, 0.3);
    table.add(bowl);
    const cup = props.mug({ color: P.ceramic, r: 0.07 });
    cup.position.set(-0.9, 0.86, 0.45);
    table.add(cup);
    // A lamp on the corner of the table, glowing warm.
    part(table, cyl(0.2, 0.26, 0.08, 16), P.charcoal, 1.45, 0.9, 0.35, { gloss: 0.4, outline: false });
    part(table, cyl(0.035, 0.035, 1.5, 8), P.brass, 1.45, 1.65, 0.35, { gloss: 0.6, outline: false });
    part(table, cyl(0.22, 0.4, 0.42, 20), mix(P.lamp, P.terracotta, 0.25), 1.45, 2.45, 0.35, { glow: 0.5, outline: false, shadow: false });
    this.lamp = new THREE.PointLight(P.lamp, 7, 9, 1.5);
    this.lamp.position.set(1.45, 2.35, 0.6);
    table.add(this.lamp);
    const bag = new THREE.Group();
    bag.position.y = 0.86;
    table.add(bag);
    this.joints.push(bag);
    part(bag, ball(0.85, 2), P.mauve, 0, 0.5, 0, { sx: 1.25, sy: 0.6, tex: 'velvet', outline: 0.03 });
    part(bag, torus(0.3, 0.04), mix(P.mauve, P.ink, 0.25), 0, 1.0, 0, { rx: Math.PI / 2, outline: false });
    this.top = new THREE.Group();
    this.top.position.y = 0.98;
    bag.add(this.top);
    this.joints.push(this.top);
    part(this.top, rbox(4.4, 0.4, 1.3, 0.1), P.terracotta, 0, 0.2, 0, sofa);
    part(this.top, rbox(4.0, 0.18, 1.0, 0.08), mix(P.terracotta, P.cream, 0.2), 0, 0.49, 0.08, sofa);
    part(this.top, rbox(4.4, 0.65, 0.3, 0.1), P.terracotta, 0, 0.6, -0.55, sofa);
    for (const x of [-2.05, 2.05]) part(this.top, rbox(0.35, 0.45, 1.3, 0.1), P.terracotta, x, 0.55, 0, sofa);
    for (const x of [-1.8, 1.8]) part(this.top, cyl(0.07, 0.05, 0.12, 8), P.walnut, x, -0.05, 0.4, { outline: false });
    this.tick = props.tickProps(set);
    // From the front and a little above: the whole tower even at full lean, the speakers and the gauge, clear of the score list.
    this.camera.position.set(0.2, 5.8, 18.5);
    this.camera.lookAt(0.6, 3.0, 0);
    // Everyone on the top couch, each on a little spot in their colour, facing the camera.
    seats.forEach((s, i) => {
      const x = towerSide(i, seats.length) * 1.45;
      part(this.top, cyl(0.38, 0.38, 0.02, 20), s.color, x, SEAT_Y + 0.005, 0.12, { glow: 0.35, outline: false });
      const c = companions[i];
      if (!c) return;
      c.root.position.set(x, SEAT_Y, 0.12);
      c.root.rotation.y = Math.atan2(this.camera.position.x - x, this.camera.position.z);
      c.setBase('idle');
      this.top.add(c.root);
    });

    // The wind (hidden until a breeze blows).
    for (let i = 0; i < 9; i++) {
      const m = part(this.scene, pill(0.04, 1.3), P.moon, 0, 0, 0, { rz: Math.PI / 2, opacity: 0.4, outline: false, shadow: false });
      m.visible = false;
      this.streaks.push(m);
    }

    // The gauge: how far the tower leans, and how long it has stood.
    this.gauge = canvasTexture(560, 440, () => {});
    this.gaugeMat = new THREE.MeshBasicMaterial({ map: this.gauge, transparent: true, toneMapped: false });
    const sign = new THREE.Mesh(plane(3.4, 3.4 * (440 / 560)), this.gaugeMat);
    sign.position.copy(GAUGE);
    this.scene.add(sign);
    part(set, cyl(0.08, 0.09, GAUGE.y - 1.1, 8), P.walnut, GAUGE.x, (GAUGE.y - 1.1) / 2, GAUGE.z - 0.15, { tex: 'wood', outline: false });
    part(set, rbox(3.6, 3.6 * (440 / 560) + 0.2, 0.1, 0.05), P.walnut, GAUGE.x, GAUGE.y, GAUGE.z - 0.08, { tex: 'wood', outline: 0.02 });
    part(set, cyl(0.3, 0.36, 0.1, 14), P.charcoal, GAUGE.x, 0.07, GAUGE.z - 0.15, { outline: false });
    this.drawGauge(0, 0);
  }

  /** Redraws the gauge: lean needle over green, amber and red, and the seconds stood. */
  drawGauge(lean: number, stood: number): void {
    const canvas = this.gauge.image as HTMLCanvasElement;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(30, 24, 38, 0.97)';
    g.beginPath();
    g.roundRect(6, 6, w - 12, h - 12, 36);
    g.fill();
    const cx = w / 2;
    const cy = 250;
    const r = 175;
    const zones: [number, number, string][] = [
      [0, 0.12, '#ff6b6b'],
      [0.12, 0.3, '#ffd166'],
      [0.3, 0.7, '#7be38a'],
      [0.7, 0.88, '#ffd166'],
      [0.88, 1, '#ff6b6b'],
    ];
    g.lineWidth = 34;
    for (const [a, b, color] of zones) {
      g.strokeStyle = color;
      g.beginPath();
      g.arc(cx, cy, r, Math.PI + a * Math.PI, Math.PI + b * Math.PI);
      g.stroke();
    }
    const k = Math.max(-1, Math.min(1, lean / TOWER.fallAt));
    const angle = -Math.PI / 2 + k * (Math.PI / 2);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 12;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(angle) * (r - 10), cy + Math.sin(angle) * (r - 10));
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx, cy, 20, 0, Math.PI * 2);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 56px ${FONT}`;
    g.fillText(`${Math.min(TOWER.duration, Math.floor(stood))} / ${TOWER.duration} s`, cx, 330);
    g.font = `600 30px ${FONT}`;
    g.fillStyle = 'rgba(241, 231, 214, 0.72)';
    g.fillText('Keep the needle in the green', cx, 392);
    this.gauge.needsUpdate = true;
  }

  /** Lights the string lights for the seconds the tower has stood. */
  light(stood: number): void {
    const lit = Math.min(BULBS, Math.floor((stood / TOWER.duration) * BULBS + 1e-6));
    this.bulbs.forEach((b, i) => {
      b.material = i < lit ? material(LIT[i % 3] as string, { glow: 1.8 }) : material(P.slate);
      // A bulb coming on pops, then settles.
      if (i < lit && i >= this.lit) b.userData.pop = 1;
    });
    this.lit = lit;
  }

  /** A disturbance begins: show it. */
  start(e: TowerEvent, sfx: Sfx): void {
    if (e.kind === 'breeze') {
      this.breeze = e;
      const rand = seeded(Math.round(e.at * 100));
      this.streaks.forEach((s) => {
        s.visible = true;
        s.position.set(-e.side * (9 + rand() * 8), 0.8 + rand() * 5.5, -1.5 + rand() * 3);
      });
      sfx.whoosh();
    } else if (e.kind === 'cat') {
      this.catEvent = e;
      this.cat = catModel();
      this.cat.scale.x = -e.side; // facing the tower's middle
      this.top.add(this.cat);
      chirp(sfx);
    } else if (e.kind === 'doorbell') {
      this.ringing = 1.4;
      this.float('Ding dong!', '#9be3ff', DOOR.x + 0.6, 4.1, DOOR.z + 0.6, 0.7);
      dingDong(sfx);
    } else {
      this.float('Bass drop!', '#ff9ec7', -e.side * SPEAKER_X, 2.7, 0.2, 0.6);
    }
  }

  /** One thump of the speaker on the side pushing the tower. */
  thump(e: TowerEvent, sfx: Sfx): void {
    const i = e.side > 0 ? 0 : 1;
    const woofer = this.woofers[i];
    if (woofer) woofer.scale.set(1.35, 1, 1.35);
    const mat = new THREE.MeshBasicMaterial({ color: P.rose, transparent: true, opacity: 0.8, toneMapped: false });
    const ring = new THREE.Mesh(torus(0.5, 0.04), mat);
    ring.position.set(-e.side * SPEAKER_X, 0.75, 0.05);
    this.scene.add(ring);
    this.fx.push({
      obj: ring,
      life: 0.6,
      total: 0.6,
      step: (k) => {
        ring.scale.setScalar(1 + k * 3);
        mat.opacity = 0.8 * (1 - k);
      },
      dispose: () => mat.dispose(),
    });
    thud(sfx);
  }

  float(text: string, color: string, x: number, y: number, z: number, height = 0.55): void {
    const sprite = popSprite(text, color, height);
    sprite.position.set(x, y, z);
    this.scene.add(sprite);
    this.fx.push({
      obj: sprite,
      life: 1.4,
      total: 1.4,
      step: (k) => {
        sprite.position.y += 0.012;
        sprite.material.opacity = Math.min(1, (1 - k) * 3);
      },
      dispose: () => {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      },
    });
  }

  /** The tower goes over: the stack folds toward the lean and everyone tumbles onto the deck. */
  topple(lean: number): Promise<void> {
    this.fallen = true;
    const dir = Math.sign(lean) || 1;
    const from = lean;
    const tipped = new Promise<void>((resolve) =>
      this.tween(
        1.3,
        (k) => {
          // The base goes over as a whole and every piece above folds a little further: about flat at the end.
          const e = k * k;
          this.joints.forEach((j, i) => {
            const share = from * (SHARES[i] ?? 0.2);
            j.rotation.z = -(share + ((i ? 0.25 : 0.9) * dir - share) * e);
          });
        },
        resolve,
      ),
    );
    // Halfway over, the crew lets go and lands on the deck in front.
    this.tween(
      0.55,
      () => {},
      () => {
        this.crew.forEach((c, i) => {
          this.scene.attach(c.root);
          const from = c.root.position.clone();
          const to = new THREE.Vector3(dir * (1.0 + i * 0.85), 0, 2.2 + (i % 2) * 0.6);
          const spin = c.root.rotation.z;
          c.setBase('sad');
          this.tween(0.75, (k) => {
            c.root.position.lerpVectors(from, to, ease.inOutSine(k));
            c.root.position.y += Math.sin(k * Math.PI) * 1.2;
            c.root.rotation.z = spin * (1 - k);
            c.root.rotation.x = 0;
            c.root.rotation.y = Math.atan2(this.camera.position.x - c.root.position.x, this.camera.position.z - c.root.position.z);
          });
        });
        if (this.cat) {
          const cat = this.cat;
          this.cat = null;
          this.hop(cat, dir);
        }
      },
    );
    return tipped;
  }

  private hop(cat: THREE.Group, side: number): void {
    this.scene.attach(cat);
    const from = cat.position.clone();
    const to = new THREE.Vector3(side * 8.5, 0, 1.2);
    const start = cat.rotation.z;
    cat.scale.x = side;
    cat.rotation.y = 0;
    this.tween(
      0.9,
      (k) => {
        cat.position.lerpVectors(from, to, k);
        cat.position.y += Math.sin(k * Math.PI) * 1.6;
        cat.rotation.z = start * (1 - k);
      },
      () => this.scene.remove(cat),
    );
  }

  private tween(duration: number, step: (k: number) => void, done?: () => void): void {
    this.tweens.push({ t: 0, duration, step, ...(done ? { done } : {}) });
  }

  dispose(): void {
    for (const c of this.crew) c.dispose();
    for (const f of this.fx) f.dispose?.();
    this.gauge.dispose();
    this.gaugeMat.dispose();
  }

  update(dt: number, time: number): void {
    for (const c of this.crew) c.update(dt);
    if (!this.fallen) {
      // The stack bends a little at every joint; the wobblier the group, the more it jiggles.
      const shake = this.wobble.reduce((a, b) => a + b, 0) / Math.max(1, this.wobble.length);
      this.joints.forEach((j, i) => (j.rotation.z = -this.lean * (SHARES[i] ?? 0.2) + Math.sin(time * 9 + i * 1.7) * shake * 0.04));
      this.crew.forEach((c, i) => (c.root.rotation.z = Math.sin(time * 12 + i * 2.1) * (this.wobble[i] ?? 0) * 0.45));
      this.updateCat(time);
    }
    // The breeze's streaks race across the yard.
    const b = this.breeze;
    this.streaks.forEach((s, i) => {
      if (!s.visible || !b) return;
      s.position.x += b.side * (10 + (i % 3) * 3) * dt;
      if (Math.abs(s.position.x) > 14) s.position.x = -b.side * (10 + (i % 4));
    });
    if (b && this.breezeOver) {
      this.breeze = null;
      for (const s of this.streaks) s.visible = false;
    }
    this.bulbs.forEach((bulb, i) => (bulb.position.x += Math.sin(time * 3 + i) * (b ? 0.004 : 0.0008)));
    this.ringing = Math.max(0, this.ringing - dt);
    this.bell.scale.setScalar(1 + Math.abs(Math.sin(this.ringing * 12)) * this.ringing);
    for (const w of this.woofers) w.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 10));
    this.lamp.intensity = 7 + Math.sin(time * 1.3) * 0.6;
    this.env.update(dt, time);
    this.tick(dt, time);
    for (const bulb of this.bulbs) {
      const pop = (bulb.userData.pop as number | undefined) ?? 0;
      if (pop <= 0) continue;
      bulb.userData.pop = Math.max(0, pop - dt * 3);
      bulb.scale.setScalar(1 + Math.sin(pop * Math.PI) * 0.6);
    }
    this.tweens = this.tweens.filter((tw) => {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.duration);
      tw.step(k);
      if (k >= 1) tw.done?.();
      return k < 1;
    });
    this.fx = this.fx.filter((f) => {
      f.life -= dt;
      f.step(Math.min(1, 1 - f.life / f.total));
      if (f.life <= 0) {
        this.scene.remove(f.obj);
        f.dispose?.();
      }
      return f.life > 0;
    });
  }

  /** The cat climbs the side of the stack, sits on the armrest for a moment, then hops off. */
  private updateCat(time: number): void {
    const cat = this.cat;
    const e = this.catEvent;
    if (!cat || !e) return;
    const u = this.catTime;
    if (u < CAT_TOP) {
      const k = u / CAT_TOP;
      // Head up, paws on the stack.
      cat.position.set(e.side * (2.55 - k * 0.45), -2.8 + k * 3.6 + Math.abs(Math.sin(time * 9)) * 0.06, 0.55 - k * 0.45);
      cat.rotation.z = (-e.side * Math.PI) / 2;
    } else if (u < CAT_HOP) {
      // Sitting on the armrest, looking at the camera (and not into anyone's ear).
      cat.position.set(e.side * 2.08, 0.78, 0.1);
      cat.scale.x = 1;
      cat.rotation.set(0, -Math.PI / 2, 0);
    } else {
      this.cat = null;
      this.catEvent = null;
      this.hop(cat, e.side);
    }
  }
}

// ------------------------------------------------------------------ little sounds, from the raw Web Audio context

function tone(sfx: Sfx, freq: number, dur: number, opts: { at?: number; to?: number; type?: OscillatorType; gain?: number } = {}): void {
  const a = sfx.audio;
  if (!a) return;
  const t0 = a.ctx.currentTime + (opts.at ?? 0);
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function dingDong(sfx: Sfx): void {
  tone(sfx, 784, 0.6, { gain: 0.3 });
  tone(sfx, 622, 0.9, { at: 0.45, gain: 0.3 });
}

function thud(sfx: Sfx): void {
  tone(sfx, 120, 0.28, { to: 42, gain: 0.55 });
}

function chirp(sfx: Sfx): void {
  tone(sfx, 520, 0.22, { to: 820, type: 'triangle', gain: 0.18 });
  tone(sfx, 760, 0.18, { to: 600, type: 'triangle', gain: 0.14, at: 0.2 });
}

// ------------------------------------------------------------------ the minigame

export const minigame: Minigame = {
  id: 'couchtower',
  title: 'Couch Tower',
  how: 'Everyone is balancing on top of a wobbly furniture tower: hold your phone as still as you can, because any wobble tips it toward your side. Keep it standing for 30 seconds, whatever the night throws at you!',
  controller: 'still',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const tower: Tower = newTower(rng, n);
    const skill = seats.map(() => ctx.skill());
    const cpus: TowerCpu[] = seats.map(() => ({ fidget: 0 }));
    const input = seats.map(() => 0.05);
    const view = new TowerView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.25 }))));
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'still', note: 'Hold still! The tower leans toward whoever wobbles.' }));
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'still' && seat < n && !session.isCpu(seat)) input[seat] = msg.wobble;
    });

    const calmLine = 'Hold still and keep the tower up!';
    let captionUntil = 0;
    let startle = false;
    let hudAt = -1;
    let mood = '';
    let settled = false;
    ui.caption('Get comfy up there…');
    await everyFrame(clock, (dt) => {
      let left = dt;
      while (left > 1e-6 && !tower.fallen && tower.time < TOWER.duration) {
        const step = Math.min(STEP, left);
        left -= step;
        const wobble = seats.map((_, i) => (session.isCpu(i) ? cpuTowerWobble(cpus[i] as TowerCpu, skill[i] ?? 0.5, rng, step, startle) : (input[i] ?? 0.05)));
        const r = stepTower(tower, step, wobble, rng);
        startle = false;
        for (const e of r.started) {
          view.start(e, sfx);
          ui.caption(EVENT_INFO[e.kind].label);
          captionUntil = tower.time + 2.2;
          if (e.kind === 'doorbell' || e.kind === 'bass') startle = true;
          view.crew.forEach((c) => c.react(e.kind === 'cat' ? 'happy' : 'listening', 1.2));
        }
        if (r.thumps) {
          const bass = activeEvents(tower).find((e) => e.kind === 'bass');
          if (bass) view.thump(bass, sfx);
        }
      }
      // Hand the view what it needs to draw this frame.
      view.lean = tower.lean;
      view.wobble = tower.wobble;
      const now = activeEvents(tower);
      view.breezeOver = !now.some((e) => e.kind === 'breeze');
      const cat = now.find((e) => e.kind === 'cat') ?? tower.events.find((e) => e.kind === 'cat' && tower.time >= e.at && tower.time < e.at + e.length + 0.2);
      view.catTime = cat ? tower.time - cat.at : CAT_HOP + 1;
      if (captionUntil && tower.time > captionUntil) {
        captionUntil = 0;
        ui.caption(calmLine);
      } else if (!settled && !captionUntil && tower.time > TOWER.settle) {
        settled = true;
        ui.caption(calmLine);
      }
      const want = Math.abs(tower.lean) > 0.28 ? 'thinking' : Math.abs(tower.lean) > 0.15 ? 'listening' : 'idle';
      if (want !== mood) {
        mood = want;
        for (const c of view.crew) c.setBase(want);
      }
      if (tower.time - hudAt > 0.1) {
        hudAt = tower.time;
        const stood = survived(tower);
        view.drawGauge(tower.lean, stood);
        view.light(stood);
        ui.timer(TOWER.duration - tower.time);
        ui.live(
          seats.map((s, i) => {
            const w = tower.wobble[i] ?? 0;
            const pct = tower.time > 0.5 ? Math.round(((tower.calmBy[i] ?? 0) / tower.time) * 100) : 100;
            return { name: s.name, color: s.color, thumb: s.thumb, value: w > 0.25 ? 'Wobbly!' : `${pct}% calm` };
          }),
        );
      }
      return tower.fallen || tower.time >= TOWER.duration;
    });
    off();
    ui.timer(null);
    view.breezeOver = true;
    session.setLayoutAll(() => ({ kind: 'wait', title: tower.fallen ? 'Timber!' : 'You kept it up!', text: 'Watch the big screen' }));
    const stood = survived(tower);
    view.drawGauge(tower.fallen ? Math.sign(tower.lean) * TOWER.fallAt : tower.lean, stood);
    view.light(stood);
    if (tower.fallen) {
      sfx.whoosh();
      ui.caption(`Timber! The tower stood for ${stood.toFixed(1)} s.`);
      for (const i of seats.keys()) session.send(i, { t: 'buzz', pattern: [200, 80, 200] });
      await view.topple(tower.lean);
      sfx.rumble();
      await clock.wait(1.2);
    } else {
      for (const c of view.crew) c.setBase('happy');
      sfx.good();
      ui.caption('You kept the tower up! What a crew.');
      await clock.wait(1.8);
    }
    ui.caption(null);
    const coop = towerCoop(tower);
    const score = Math.round(coop * 1000);
    const total = Math.max(0.01, tower.time);
    return {
      scores: seats.map(() => score),
      details: seats.map((_, i) => `Calm ${Math.round(((tower.calmBy[i] ?? 0) / total) * 100)}% of the time`),
      coop,
    };
  },
};
