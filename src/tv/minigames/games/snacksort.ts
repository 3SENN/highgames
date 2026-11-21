// Snack Sort on the TV: a late-night snack conveyor in a cosy kitchen. Snacks come out of the hatch on the left and
// slide past one station per player; each player's phone secretly says which snack types are theirs to grab.
import * as THREE from 'three';
import {
  SNACKSORT,
  SNACK_INFO,
  type GrabResult,
  type Snack,
  type SnackCpu,
  type SnackType,
  beltEnd,
  beltSpeed,
  beltStart,
  cpuSnackSort,
  grab,
  newSnackSort,
  resolvedSnacks,
  snackCoop,
  stationX,
  stepSnackSort,
  totalCorrect,
  totalWrong,
} from '../../../game/minigames/snacksort';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { type Env, kitchen } from '../../render/env';
import * as props from '../../render/props';
import { FONT, PALETTE as P, ball, box, canvasTexture, cone, cyl, dome, gem, mix, nameCard, part, plane, popSprite, rbox, seeded, sphere, torus } from '../../render/toon';
import { ease } from '../../anim';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const BELT_Y = 1.0; // top of the belt
const STAND_Z = -1.9; // where the players stand, behind the belt
const STEP = 1 / 30; // rules step (the frame is split so fast playtests stay fair)
/** The belt runs right to left on screen, so the hatch is in view and the drop bin sits under the score list. */
const wx = (x: number) => -x;
/** The kitchen is built a size up, so its worktops and shelves read behind a belt this long. */
const ROOM = 1.35;
const ROOM_D = 9.6;
const BACK = -(ROOM_D / 2) * ROOM; // the back wall

const EMOJI: Record<SnackType, string> = { sweet: '🧁', salty: '🍿', sour: '🍬', spicy: '🌶️' };

/** One snack on its little plate, about 0.6 units tall, sitting on y = 0. */
function snackModel(type: SnackType): THREE.Group {
  const g = new THREE.Group();
  const line = { outline: 0.02 };
  part(g, cyl(0.34, 0.3, 0.05, 24), P.ceramic, 0, 0.025, 0, { gloss: 0.5, ...line });
  part(g, torus(0.3, 0.012), mix(P.ceramic, P.ink, 0.18), 0, 0.052, 0, { rx: Math.PI / 2, outline: false, shadow: false });
  if (type === 'sweet') {
    // A cupcake: pleated paper cup, a swirl of pink frosting and a cherry.
    part(g, cyl(0.22, 0.16, 0.26, 14), mix(SNACK_INFO.sweet.color, P.cream, 0.6), 0, 0.18, 0, line);
    part(g, dome(0.25), SNACK_INFO.sweet.color, 0, 0.3, 0, { sy: 0.9, gloss: 0.3, ...line });
    part(g, cone(0.15, 0.2, 14), SNACK_INFO.sweet.color, 0, 0.6, 0, { gloss: 0.3, ...line });
    part(g, sphere(0.07, 10), P.brick, 0, 0.74, 0, { gloss: 0.7, outline: false });
  } else if (type === 'salty') {
    // A striped popcorn tub, overflowing.
    part(g, cyl(0.24, 0.17, 0.42, 16), P.cream, 0, 0.26, 0, line);
    part(g, torus(0.215, 0.03), SNACK_INFO.salty.color, 0, 0.2, 0, { rx: Math.PI / 2, outline: false });
    part(g, torus(0.235, 0.03), SNACK_INFO.salty.color, 0, 0.36, 0, { rx: Math.PI / 2, outline: false });
    const rand = seeded(7);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.14;
      part(g, ball(0.085, 1), i % 3 ? P.cream : mix(P.cream, P.mustard, 0.45), Math.cos(a) * r, 0.5 + rand() * 0.08 + (i === 0 ? 0.08 : 0), Math.sin(a) * r, { outline: i === 0 ? 0.02 : false });
    }
  } else if (type === 'sour') {
    // A stack of sugar-dusted sour gummies.
    const jelly = { gloss: 0.6, ...line };
    part(g, rbox(0.42, 0.18, 0.42, 0.07), SNACK_INFO.sour.color, 0, 0.14, 0, { ry: 0.3, ...jelly });
    part(g, rbox(0.34, 0.16, 0.34, 0.06), mix(SNACK_INFO.sour.color, P.mustard, 0.35), 0, 0.31, 0, { ry: -0.25, ...jelly });
    part(g, rbox(0.26, 0.14, 0.26, 0.05), SNACK_INFO.sour.color, 0, 0.46, 0, { ry: 0.5, ...jelly });
    for (let i = 0; i < 8; i++) part(g, ball(0.022, 0), P.cream, Math.cos(i * 2.1) * 0.15, 0.24 + (i % 3) * 0.15, Math.sin(i * 2.1) * 0.15, { outline: false, shadow: false });
  } else {
    // A plump red chili with a little green stalk, lying on its side.
    part(g, cone(0.15, 0.55, 14), SNACK_INFO.spicy.color, 0.06, 0.2, 0, { rz: Math.PI / 2 + 0.25, gloss: 0.6, ...line });
    part(g, ball(0.15, 1), SNACK_INFO.spicy.color, 0.3, 0.24, 0, { gloss: 0.6, ...line });
    part(g, cyl(0.04, 0.05, 0.16, 8), P.fern, 0.46, 0.3, 0, { rz: -1.1, outline: false });
  }
  return g;
}

interface Flight {
  group: THREE.Group;
  t: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  arc: number;
  spin: number;
  done: () => void;
}

interface Floater {
  sprite: THREE.Sprite;
  life: number;
}

class SnackView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly cooks: Companion[];
  private snacks = new Map<number, THREE.Group>();
  private flights: Flight[] = [];
  private floaters: Floater[] = [];
  private slats: THREE.Mesh[] = [];
  private slatGap = 0.7;
  private slatFrom: number;
  private slatSpan: number;
  private baskets: { at: THREE.Vector3; pile: THREE.Group[]; group: THREE.Group; pop: number }[] = [];
  private sparks: { mesh: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private bars: { mesh: THREE.Mesh; flash: number }[] = [];
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private board: THREE.CanvasTexture;
  private boardMat: THREE.MeshBasicMaterial;
  private binX: number;
  /** The belt's current speed, set by the game. */
  speed = beltSpeed(0);

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    this.cooks = companions;
    const n = seats.length;
    const s = this.scene;
    // A late-night kitchen: the worktops, cooker and fridge along the back wall, warm lamps, the night in the windows.
    const env = kitchen(s, { mood: 'evening', w: 21.5, d: ROOM_D, h: 7, lights: false, cabinets: P.forest });
    env.root.scale.setScalar(ROOM);
    env.sun.target.position.set(0, 0, -1);
    // Its own pendants would hang in front of the names: this room gets bigger ones, further apart.
    env.root.traverse((o) => {
      if (o.name === 'pendantLamp') o.visible = false;
    });
    this.env = env;
    const set = new THREE.Group();
    s.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = 1) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      if (scale !== 1) o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    const start = wx(beltStart(n));
    const end = wx(beltEnd(n));
    const mid = (start + end) / 2;
    const len = start - end + 1.2;
    this.binX = end - 1.1;

    // The wall above the worktops: a neon sign, a window onto the night, shelves of snack jars, fairy lights.
    put(props.neonSign('snacks', { color: P.neonPink, h: 1.1 }), -8.6, 5.45, BACK + 0.04);
    put(props.windowFrame({ w: 3.0, h: 2.4, time: 'night', seed: 3 }), 10.0, 4.55, BACK + 0.02);
    put(props.curtains({ w: 3.0, h: 2.4, color: mix(P.terracotta, P.cream, 0.3) }), 10.0, 4.55, BACK + 0.02);
    put(props.pictureFrame({ w: 1.0, h: 1.3, art: 'leaf', frame: P.oak, seed: 4 }), 13.2, 4.2, BACK + 0.02);
    put(props.pictureFrame({ w: 0.9, h: 0.7, art: 'moon', frame: P.brass, seed: 7 }), 13.2, 5.5, BACK + 0.02);
    const rand = seeded(12);
    const tints = [SNACK_INFO.sweet.color, SNACK_INFO.salty.color, SNACK_INFO.sour.color, SNACK_INFO.spicy.color];
    for (const [sx, sy] of [[-12.2, 4.3], [5.9, 6.0]] as const) {
      part(set, rbox(3.6, 0.12, 0.6, 0.03), P.walnut, sx, sy, BACK + 0.32, { tex: 'wood', outline: 0.02 });
      for (const dx of [-1.4, 1.4]) part(set, box(0.06, 0.3, 0.5), P.charcoal, sx + dx, sy - 0.2, BACK + 0.28, { outline: false });
      for (let i = 0; i < 4; i++) {
        const jx = sx - 1.26 + i * 0.84;
        const h = 0.6 + rand() * 0.25;
        part(set, cyl(0.26, 0.26, h, 18), P.moon, jx, sy + 0.06 + h / 2, BACK + 0.34, { opacity: 0.4, gloss: 0.7 });
        part(set, cyl(0.22, 0.22, h * 0.6, 14), tints[(i + (sx < 0 ? 0 : 2)) % 4] as string, jx, sy + 0.08 + h * 0.3, BACK + 0.34, { outline: false, shadow: false });
        part(set, cyl(0.28, 0.28, 0.08, 18), P.walnut, jx, sy + 0.1 + h, BACK + 0.34, { outline: false });
      }
    }
    const bulbs = [P.lamp, P.rose, P.moon];
    for (let i = 0; i < 4; i++) set.add(props.stringLights(new THREE.Vector3(-14.2 + i * 7.1, 7.7, BACK + 0.12), new THREE.Vector3(-7.1 + i * 7.1, 7.7, BACK + 0.12), { sag: 0.3, count: 9, colors: bulbs, bulb: 0.09 }));
    // Big brass pendants over the line: these three do the lighting.
    for (const x of [-9.2, -4.6, 5.2]) put(props.pendantLamp({ drop: 5.2, r: 0.55, light: 26 }), x, 10.2, -0.9);

    // The conveyor: body, belt, moving slats, rails, rollers and legs.
    const steel = { tex: 'metalPlate' as const, texStrength: 0.3, gloss: 0.5 };
    part(set, rbox(len, 0.55, 1.8, 0.08), P.slate, mid, BELT_Y - 0.38, 0, { ...steel, outline: 0.03 });
    part(set, rbox(len - 0.5, 0.07, 0.02, 0.01), P.mustard, mid, BELT_Y - 0.42, 0.905, { outline: false, shadow: false });
    part(set, rbox(len, 0.08, 1.56, 0.03), mix(P.charcoal, P.slate, 0.55), mid, BELT_Y - 0.05, 0, { outline: false });
    for (const z of [-0.86, 0.86]) part(set, rbox(len, 0.16, 0.1, 0.04), P.metal, mid, BELT_Y + 0.02, z, { gloss: 0.7, outline: 0.02 });
    for (const x of [end - 0.55, start + 0.55]) part(set, cyl(0.2, 0.2, 1.6, 16), P.metal, x, BELT_Y - 0.2, 0, { rx: Math.PI / 2, gloss: 0.6, outline: false });
    for (let x = end; x <= start + 0.6; x += 3) {
      for (const z of [-0.6, 0.6]) {
        part(set, cyl(0.09, 0.09, BELT_Y - 0.6, 10), P.charcoal, x, (BELT_Y - 0.6) / 2, z, { gloss: 0.4, outline: false });
        part(set, cyl(0.16, 0.18, 0.05, 12), P.charcoal, x, 0.025, z, { outline: false });
      }
    }
    this.slatFrom = end - 0.5;
    this.slatSpan = len;
    for (let x = 0; x < len; x += this.slatGap) this.slats.push(part(set, rbox(0.07, 0.02, 1.5, 0.01), mix(P.slate, P.stone, 0.5), this.slatFrom + x, BELT_Y + 0.0, 0, { outline: false, shadow: false }));

    // The tiled hatch the snacks come out of (a warm light inside), and the bin at the end.
    const hx = start + 0.4;
    part(set, rbox(1.9, 2.5, 2.3, 0.1), P.ceramic, hx, 1.25, 0, { tex: 'kitchenTile', gloss: 0.3, outline: 0.03 });
    part(set, rbox(0.1, 1.0, 1.7, 0.04), P.ink, start - 0.57, 1.45, 0, { outline: false });
    part(set, rbox(0.12, 0.1, 1.9, 0.03), P.brass, start - 0.6, 2.02, 0, { gloss: 0.6, outline: false });
    for (let i = 0; i < 6; i++) part(set, box(0.03, 0.42, 0.24), P.mustard, start - 0.63, 1.76, -0.7 + i * 0.28, { opacity: 0.7, outline: false, shadow: false });
    part(set, rbox(2.2, 0.16, 2.6, 0.05), P.walnut, hx, 2.58, 0, { tex: 'wood', outline: 0.03 });
    part(set, sphere(0.1, 12), P.lamp, start - 0.72, 2.3, 0, { glow: 2.2, outline: false, shadow: false });
    put(props.plant({ kind: 'trailing', h: 0.5, pot: P.terracotta, seed: 3 }), hx, 2.66, 0.5, 0, 1.6);
    part(set, rbox(1.5, 1.1, 1.9, 0.08), P.walnut, this.binX, 0.55, 0, { tex: 'planks', outline: 0.03 });
    part(set, rbox(1.3, 0.05, 1.7, 0.02), P.ink, this.binX, 1.11, 0, { outline: false });
    const oops = nameCard('Dropped', '#9a9a9a', 0.75);
    oops.position.set(this.binX, 1.75, 0.6);
    this.scene.add(oops);

    // The stations: a glowing grab zone on the belt, a platform spot, a basket and the player.
    part(set, rbox(len + 2, 0.35, 1.5, 0.06), P.wood, mid, 0.175, STAND_Z, { tex: 'planks', outline: 0.03 });
    seats.forEach((seat, i) => {
      const x = wx(stationX(i, n));
      const w = SNACKSORT.window * 2;
      part(set, rbox(w, 0.02, 1.5, 0.01), seat.color, x, BELT_Y + 0.02, 0, { opacity: 0.32, shadow: false });
      this.bars.push({ mesh: part(set, rbox(w, 0.18, 0.12, 0.04), seat.color, x, BELT_Y - 0.02, 0.92, { glow: 0.7, outline: false }), flash: 0 });
      // The spot to stand on: the seat's colour deepened, its edge at full strength.
      part(set, cyl(0.62, 0.62, 0.04, 28), mix(seat.color, P.aubergine, 0.5), x, 0.37, STAND_Z, { outline: false });
      part(set, torus(0.6, 0.03), seat.color, x, 0.395, STAND_Z, { rx: Math.PI / 2, glow: 0.6, outline: false, shadow: false });
      // A wicker basket with bands in the seat's colour.
      const basket = new THREE.Group();
      basket.position.set(x + 1.1, 0.35, STAND_Z + 0.35);
      part(basket, cyl(0.42, 0.3, 0.42, 20), P.oak, 0, 0.21, 0, { tex: 'knit', texScale: 0.45, outline: 0.02 });
      part(basket, torus(0.42, 0.035), seat.color, 0, 0.42, 0, { rx: Math.PI / 2, outline: false });
      part(basket, torus(0.345, 0.028), seat.color, 0, 0.14, 0, { rx: Math.PI / 2, outline: false });
      part(basket, cyl(0.36, 0.36, 0.02, 20), P.ink, 0, 0.415, 0, { outline: false, shadow: false });
      set.add(basket);
      this.baskets.push({ at: new THREE.Vector3(x + 1.1, 0.67, STAND_Z + 0.35), pile: [], group: basket, pop: 0 });
      const c = companions[i];
      if (c) {
        c.root.position.set(x, 0.37, STAND_Z);
        c.setBase('listening');
        this.scene.add(c.root);
      }
      const card = nameCard(seat.name, seat.color, 0.8);
      card.position.set(x, 2.6, STAND_Z);
      this.scene.add(card);
    });

    // In front of the line: a runner on the floor, crates of supplies and a trolley of bowls nearer the camera.
    put(props.rug({ w: len + 3, d: 4.8, color: mix(P.denim, P.aubergine, 0.3), border: P.mustard }), mid, 0, 4.0);
    const stack = put(new THREE.Group(), -8.8, 0, 6.6, 0.25);
    for (const [cx, cy, cz, ry] of [[0, 0, 0, 0], [1.05, 0, 0.2, 0.3], [0.4, 0.95, 0.05, -0.2]] as const) {
      const crate = props.crate({ s: 0.95 });
      crate.position.set(cx, cy, cz);
      crate.rotation.y = ry;
      stack.add(crate);
    }
    const leafy = props.plant({ kind: 'monstera', h: 1.0, pot: P.ceramic, seed: 5 });
    leafy.position.set(1.05, 0.95, 0.2);
    leafy.scale.setScalar(1.4);
    stack.add(leafy);
    const trolley = put(new THREE.Group(), 9.4, 0, 5.6, -0.3);
    trolley.add(props.table({ w: 2.4, d: 1.1, h: 1.0, color: P.walnut }));
    part(trolley, rbox(2.2, 0.05, 0.95, 0.02), P.walnut, 0, 0.35, 0, { tex: 'wood', outline: false });
    const bowls: [number, number, 'popcorn' | 'crisps' | 'fruit' | 'sweets', string][] = [[-0.75, 0.1, 'popcorn', P.teal], [0, -0.1, 'sweets', P.terracotta], [0.75, 0.12, 'crisps', P.ceramic]];
    for (const [bx, bz, fill, color] of bowls) {
      const bowl = props.snackBowl({ fill, color, r: 0.27 });
      bowl.position.set(bx, 1.0, bz);
      trolley.add(bowl);
    }
    const pile = props.plates({ n: 6, r: 0.26 });
    pile.position.set(-0.6, 0.38, 0);
    trolley.add(pile);
    put(props.stool({ h: 0.7, seat: P.mustard }), 7.2, 0, 6.3, 0, 1.3);
    put(props.plant({ kind: 'ficus', h: 2.0, pot: P.ceramic, seed: 7 }), -12.6, 0, 2.6, 0, 1.4);
    this.tick = props.tickProps(set);
    // The scoreboard: sorted, dropped and how the group is doing.
    this.board = canvasTexture(1024, 200, () => {});
    this.boardMat = new THREE.MeshBasicMaterial({ map: this.board, transparent: true, toneMapped: false });
    const sign = new THREE.Mesh(plane(7.2, 1.4), this.boardMat);
    sign.position.set(1.2, 4.2, BACK + 0.4);
    part(set, rbox(7.6, 1.76, 0.12, 0.05), P.walnut, 1.2, 4.2, BACK + 0.3, { tex: 'wood', outline: 0.02 });
    this.scene.add(sign);
    this.score(0, 0, 0, 0);

    // A little from the left and above, framing the hatch on the right and every station clear of the score list.
    this.camera.position.set(-1.8, 8.2, 21.5);
    this.camera.lookAt(0.3, 2.5, 0);
    for (const c of companions) c.root.rotation.y = Math.atan2(this.camera.position.x - c.root.position.x, this.camera.position.z - c.root.position.z);
  }

  /** Redraws the scoreboard. */
  score(sorted: number, dropped: number, wrong: number, ratio: number): void {
    const canvas = this.board.image as HTMLCanvasElement;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(30, 24, 38, 0.96)';
    g.beginPath();
    g.roundRect(8, 8, w - 16, h - 16, 40);
    g.fill();
    g.textBaseline = 'middle';
    g.font = `800 62px ${FONT}`;
    g.fillStyle = '#9bf0a8';
    g.fillText(`✔ ${sorted} sorted`, 48, 70);
    g.fillStyle = '#ffb0bd';
    g.fillText(`✖ ${dropped + wrong} lost`, 560, 70);
    // The bar: how much of the snack run ended up in the right hands.
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    g.roundRect(48, 128, w - 96, 40, 20);
    g.fill();
    if (ratio > 0) {
      g.fillStyle = ratio >= 0.8 ? '#7be38a' : ratio >= 0.6 ? '#ffd166' : '#ff8f6b';
      g.beginPath();
      g.roundRect(48, 128, Math.max(40, (w - 96) * ratio), 40, 20);
      g.fill();
    }
    g.font = `700 30px ${FONT}`;
    g.fillStyle = P.aubergine;
    g.fillText(`${Math.round(ratio * 100)}%`, 64, 149);
    this.board.needsUpdate = true;
  }

  addSnack(s: Snack): void {
    const g = snackModel(s.type);
    g.position.set(wx(s.x), BELT_Y, 0);
    g.rotation.y = (s.id * 1.7) % (Math.PI * 2);
    g.scale.setScalar(0.01);
    g.userData.age = 0;
    this.snacks.set(s.id, g);
    this.scene.add(g);
  }

  /** Keeps the belt's snacks where the rules have them. */
  sync(list: readonly Snack[]): void {
    for (const s of list) {
      const g = this.snacks.get(s.id);
      if (g && s.status === 'belt') g.position.x = wx(s.x);
    }
  }

  private fly(id: number, to: THREE.Vector3, opts: { arc: number; duration: number; spin: number }, done: (g: THREE.Group) => void): void {
    const g = this.snacks.get(id);
    if (!g) return;
    this.snacks.delete(id);
    this.flights.push({ group: g, t: 0, duration: opts.duration, from: g.position.clone(), to, arc: opts.arc, spin: opts.spin, done: () => done(g) });
  }

  /** A correct grab: into the player's basket, which fills up. */
  toBasket(id: number, seat: number): void {
    const b = this.baskets[seat];
    if (!b) return;
    const to = b.at.clone().add(new THREE.Vector3((b.pile.length % 3) * 0.12 - 0.12, Math.min(6, b.pile.length) * 0.06, 0));
    this.fly(id, to, { arc: 1.6, duration: 0.45, spin: 0 }, (g) => {
      g.scale.setScalar(0.55);
      b.pile.push(g);
      // The basket squashes and settles, the station's bar flashes, a few sparkles fly.
      b.pop = 1;
      const bar = this.bars[seat];
      if (bar) bar.flash = 1;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const mesh = part(this.scene, gem(0.07), P.lamp, b.at.x, b.at.y + 0.2, b.at.z, { glow: 1.8, shadow: false });
        this.sparks.push({ mesh, v: new THREE.Vector3(Math.cos(a) * 1.6, 2.2, Math.sin(a) * 1.6), age: 0 });
      }
      if (b.pile.length > 9) this.scene.remove(b.pile.shift() as THREE.Group);
    });
  }

  /** A wrong grab: tossed over the shoulder. */
  toss(id: number, x: number): void {
    this.fly(id, new THREE.Vector3(x + 1.2, -0.4, 3.2), { arc: 2.2, duration: 0.7, spin: 9 }, (g) => this.scene.remove(g));
  }

  /** Off the end of the belt into the bin. */
  drop(id: number): void {
    this.fly(id, new THREE.Vector3(this.binX, 0.75, 0), { arc: 0.3, duration: 0.35, spin: 3 }, (g) => this.scene.remove(g));
  }

  float(text: string, color: string, x: number, y: number, z: number, height = 0.5): void {
    const sprite = popSprite(text, color, height);
    sprite.position.set(x, y, z);
    this.floaters.push({ sprite, life: 1.1 });
    this.scene.add(sprite);
  }

  dispose(): void {
    for (const c of this.cooks) c.dispose();
    for (const f of this.floaters) disposeSprite(f.sprite);
    this.board.dispose();
    this.boardMat.dispose();
  }

  update(dt: number, time: number): void {
    for (const c of this.cooks) c.update(dt);
    // The belt's slats move with the snacks.
    for (const s of this.slats) {
      s.position.x -= this.speed * dt;
      if (s.position.x < this.slatFrom) s.position.x += this.slatSpan;
    }
    this.env.update(dt, time);
    this.tick(dt, time);
    // Fresh snacks pop out of the hatch.
    for (const g of this.snacks.values()) {
      const age = g.userData.age as number;
      if (age >= 0.3) continue;
      g.userData.age = age + dt;
      g.scale.setScalar(Math.max(0.01, ease.outBack(Math.min(1, (age + dt) / 0.3))));
    }
    for (const b of this.baskets) {
      if (b.pop <= 0) continue;
      b.pop = Math.max(0, b.pop - dt * 4);
      const k = Math.sin(b.pop * Math.PI);
      b.group.scale.set(1 + k * 0.1, 1 - k * 0.12, 1 + k * 0.1);
    }
    for (const bar of this.bars) {
      if (bar.flash <= 0) continue;
      bar.flash = Math.max(0, bar.flash - dt * 3);
      bar.mesh.scale.set(1, 1 + bar.flash * 0.8, 1 + bar.flash * 0.8);
    }
    this.sparks = this.sparks.filter((sp) => {
      sp.age += dt;
      sp.v.y -= 7 * dt;
      sp.mesh.position.addScaledVector(sp.v, dt);
      sp.mesh.rotation.y += dt * 9;
      sp.mesh.scale.setScalar(Math.max(0.01, 1 - sp.age / 0.55));
      if (sp.age < 0.55) return true;
      sp.mesh.removeFromParent();
      return false;
    });
    this.flights = this.flights.filter((f) => {
      f.t += dt;
      const k = Math.min(1, f.t / f.duration);
      f.group.position.lerpVectors(f.from, f.to, k);
      f.group.position.y += Math.sin(k * Math.PI) * f.arc;
      f.group.rotation.z += f.spin * dt;
      if (k >= 1) f.done();
      return k < 1;
    });
    this.floaters = this.floaters.filter((f) => {
      f.life -= dt;
      f.sprite.position.y += dt * 0.8;
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, f.life * 2.5);
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        disposeSprite(f.sprite);
      }
      return f.life > 0;
    });
  }
}

function disposeSprite(s: THREE.Sprite): void {
  s.material.map?.dispose();
  s.material.dispose();
}

function typesText(types: readonly SnackType[]): string {
  return types.map((t) => `${EMOJI[t]} ${SNACK_INFO[t].name} (${SNACK_INFO[t].looks})`).join(' + ');
}

export const minigame: Minigame = {
  id: 'snacksort',
  title: 'Snack Sort',
  how: 'Your phone secretly tells you which snacks are yours. Press Grab when one of yours is at your station; every snack in the right hands counts, while misses and wrong grabs drag the group down.',
  controller: 'buttons',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const state = newSnackSort(rng, n);
    const skill = seats.map(() => ctx.skill());
    const plans: SnackCpu[] = seats.map(() => new Map());
    const view = new SnackView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.75 }))));
    ctx.stage.setView(view);
    seats.forEach((s, i) =>
      session.setLayout(i, {
        kind: 'buttons',
        title: 'Snack Sort',
        secret: `Yours: ${typesText(state.owned[i] ?? [])}`,
        buttons: [{ label: 'Grab!', color: s.color }],
        note: 'Grab yours when it reaches your station. Leave the rest!',
      }),
    );

    const result = (seat: number, r: GrabResult) => {
      const x = wx(stationX(seat, n));
      const cook = view.cooks[seat];
      if (r.kind === 'correct') {
        sfx.good();
        view.toBasket(r.snack.id, seat);
        view.float('+1', '#9bf0a8', x, 3.2, STAND_Z + 0.6);
        cook?.react('happy', 1.1);
        session.send(seat, { t: 'feedback', good: true, text: `Got it! ${EMOJI[r.snack.type]}` });
      } else if (r.kind === 'wrong') {
        sfx.bad();
        view.toss(r.snack.id, x);
        view.float('Not yours!', '#ffb0bd', x, 3.2, STAND_Z + 0.6);
        cook?.react('sad', 1.4);
        session.send(seat, { t: 'feedback', good: false, text: `That ${SNACK_INFO[r.snack.type].name.toLowerCase()} one wasn't yours!` });
        session.send(seat, { t: 'buzz', pattern: [120] });
      } else if (r.kind === 'empty') {
        cook?.react('thinking', 0.6);
        session.send(seat, { t: 'feedback', good: false, text: 'Nothing at your station yet…' });
      }
    };
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'press' || seat >= n || session.isCpu(seat)) return;
      result(seat, grab(state, seat, (session.seats[seat]?.rtt ?? 0) / 2000));
    });

    let hudAt = -1;
    let dirty = true;
    ui.caption('Grab your secret snacks at your station!');
    await everyFrame(clock, (dt) => {
      let left = dt;
      while (left > 1e-6) {
        const step = Math.min(STEP, left);
        left -= step;
        for (const e of stepSnackSort(state, step, rng)) {
          if (e.kind === 'spawn') view.addSnack(e.snack);
          else if (e.kind === 'gone') view.drop(e.snack.id);
          else {
            dirty = true;
            const x = wx(stationX(e.snack.owner, n));
            view.float('Missed', '#d8d3e8', x - 0.9, BELT_Y + 0.9, 0.4, 0.4);
            view.cooks[e.snack.owner]?.react('sad', 0.9);
            if (!session.isCpu(e.snack.owner)) session.send(e.snack.owner, { t: 'buzz', pattern: [40, 40, 40] });
          }
        }
        seats.forEach((_, i) => {
          if (!session.isCpu(i)) return;
          const r = cpuSnackSort(state, i, skill[i] ?? 0.5, rng, plans[i] as SnackCpu);
          if (r) result(i, r);
        });
      }
      view.sync(state.snacks);
      view.speed = beltSpeed(state.time);
      if (state.time - hudAt > 0.15 || dirty) {
        hudAt = state.time;
        dirty = false;
        view.score(totalCorrect(state), state.missed + state.stolen, totalWrong(state), resolvedSnacks(state) ? snackCoop(state) : 0);
        ui.timer(SNACKSORT.duration - state.time);
        ui.live(
          seats.map((s, i) => {
            const good = state.correct[i] ?? 0;
            const bad = state.wrong[i] ?? 0;
            return { name: s.name, color: s.color, thumb: s.thumb, value: `${good} ✔${bad ? ` · ${bad} ✖` : ''}` };
          }),
        );
      }
      return state.time >= SNACKSORT.duration;
    });
    off();
    ui.timer(null);
    const coop = snackCoop(state);
    view.score(totalCorrect(state), state.missed + state.stolen, totalWrong(state), coop);
    for (const c of view.cooks) c.setBase(coop >= 0.6 ? 'happy' : 'sad');
    ui.caption(coop >= 0.8 ? 'Snack masters! Everything in the right hands.' : coop >= 0.5 ? 'Nicely sorted!' : 'A few snacks went astray…');
    if (coop >= 0.6) sfx.good();
    session.setLayoutAll(() => ({ kind: 'wait', title: 'Snacks sorted!', text: 'Watch the big screen' }));
    await clock.wait(1.6);
    ui.caption(null);
    const score = Math.round(coop * 1000);
    return {
      scores: seats.map(() => score),
      details: seats.map((_, i) => {
        const types = (state.owned[i] ?? []).map((t) => EMOJI[t]).join('');
        const bad = state.wrong[i] ?? 0;
        return `${types} ${state.correct[i] ?? 0} grabbed${bad ? ` · ${bad} wrong` : ''}`;
      }),
      coop,
    };
  },
};
