// Order Up on the TV: a tiny late-night pizza counter. The ticket board shows the order, the crew stands behind the
// counter, and every phone holds only some of the toppings, so the group has to call out who has what.
import * as THREE from 'three';
import {
  ORDERUP,
  TOPPING_INFO,
  type Kitchen,
  type OrderCpu,
  type Topping,
  addTopping,
  cpuOrderUp,
  newKitchen,
  newOrderCpu,
  orderCoop,
  orderTarget,
  pizzasMade,
  stepKitchen,
} from '../../../game/minigames/orderup';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { type Env, kitchen } from '../../render/env';
import * as props from '../../render/props';
import { FONT, PALETTE as P, ball, box, canvasTexture, cyl, dome, gem, mix, nameCard, part, plane, popSprite, rbox, seeded, sphere, torus } from '../../render/toon';
import { ease } from '../../anim';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const COUNTER_Y = 1.1; // top of the counter
const CREW_Z = -1.9;
const PIZZA = new THREE.Vector3(0, COUNTER_Y + 0.03, 0.35);
const STACK = new THREE.Vector3(7.6, COUNTER_Y, 0.1); // where served pizzas are boxed
const BOX_H = 0.28;
const TRASH = new THREE.Vector3(-7.8, 0, 0.4);
/** The kitchen behind the counter is built a size up, so it reads from the camera's distance. */
const ROOM = 1.3;
const ROOM_D = 9;
const BACK = -(ROOM_D / 2) * ROOM; // the back wall

/** Phone button colours: the topping's colour, a little deeper so white text reads on it. */
function buttonColor(t: Topping): string {
  return `#${new THREE.Color(TOPPING_INFO[t].color).multiplyScalar(0.82).getHexString()}`;
}

/** One topping's pieces, scattered over the pizza (the same spots every time for that topping). */
function toppingPieces(t: Topping): THREE.Group {
  const g = new THREE.Group();
  const color = TOPPING_INFO[t].color;
  const rand = seeded(t.length * 31 + t.charCodeAt(0) * 7 + t.charCodeAt(1));
  const spots = (count: number, radius = 0.78) =>
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + rand() * 0.6;
      const r = i === 0 ? rand() * 0.15 : 0.3 + rand() * (radius - 0.3);
      return [Math.cos(a) * r, Math.sin(a) * r, rand() * Math.PI * 2] as const;
    });
  switch (t) {
    case 'cheese':
      part(g, cyl(0.9, 0.9, 0.035, 28), color, 0, 0.02, 0, { outline: false });
      for (const [x, z] of spots(6, 0.95)) part(g, ball(0.13, 1), color, x, 0.03, z, { sy: 0.35, outline: false });
      break;
    case 'salami':
      for (const [x, z] of spots(7)) part(g, cyl(0.17, 0.17, 0.04, 16), color, x, 0.03, z);
      break;
    case 'mushroom':
      for (const [x, z, r] of spots(6)) {
        part(g, dome(0.13), color, x, 0.04, z, { sy: 0.7, ry: r });
        part(g, rbox(0.08, 0.06, 0.12, 0.02), '#ead9c2', x, 0.04, z + 0.05, { ry: r, outline: false });
      }
      break;
    case 'peppers':
      for (const [x, z, r] of spots(6)) part(g, torus(0.12, 0.035), color, x, 0.04, z, { rx: Math.PI / 2, rz: r });
      break;
    case 'olives':
      for (const [x, z] of spots(8)) part(g, torus(0.065, 0.035), color, x, 0.04, z, { rx: Math.PI / 2 });
      break;
    case 'pineapple':
      for (const [x, z, r] of spots(7)) part(g, rbox(0.17, 0.08, 0.13, 0.03), color, x, 0.05, z, { ry: r });
      break;
    case 'fries':
      for (const [x, z, r] of spots(7)) part(g, rbox(0.06, 0.06, 0.38, 0.02), color, x, 0.05, z, { ry: r });
      break;
    case 'marshmallow':
      for (const [x, z, r] of spots(6)) part(g, cyl(0.09, 0.09, 0.13, 12), r > 3 ? '#fff6fa' : color, x, 0.08, z);
      break;
  }
  return g;
}

/** A plain pizza (crust and sauce) on y = 0. */
function pizzaBase(): THREE.Group {
  const g = new THREE.Group();
  const dough = mix(P.sand, P.mustard, 0.3);
  part(g, cyl(1.05, 1.08, 0.1, 36), dough, 0, 0.05, 0, { outline: 0.02 });
  part(g, torus(1.0, 0.09), mix(dough, P.wood, 0.45), 0, 0.1, 0, { rx: Math.PI / 2, outline: 0.02 });
  part(g, cyl(0.93, 0.93, 0.02, 36), P.brick, 0, 0.105, 0, { outline: false, gloss: 0.4 });
  // A few scorched bubbles on the crust.
  for (let i = 0; i < 7; i++) part(g, sphere(0.06, 8), mix(dough, P.walnut, 0.5), Math.cos(i * 0.93) * 1.0, 0.15, Math.sin(i * 0.93) * 1.0, { sy: 0.5, outline: false, shadow: false });
  return g;
}

function pizzaBox(): THREE.Group {
  const g = new THREE.Group();
  const card = mix(P.sand, P.oak, 0.35);
  part(g, rbox(1.75, BOX_H, 1.75, 0.04), card, 0, BOX_H / 2, 0, { outline: 0.02 });
  part(g, rbox(1.76, 0.05, 1.76, 0.02), mix(card, P.wood, 0.4), 0, BOX_H - 0.04, 0, { outline: false });
  part(g, cyl(0.34, 0.34, 0.02, 24), P.brick, 0, BOX_H + 0.005, 0, { outline: false });
  part(g, cyl(0.24, 0.24, 0.022, 24), card, 0, BOX_H + 0.006, 0, { outline: false, shadow: false });
  part(g, cyl(0.16, 0.16, 0.024, 3), P.brick, 0, BOX_H + 0.007, 0, { outline: false, shadow: false });
  return g;
}

interface Tween {
  t: number;
  duration: number;
  step: (k: number) => void;
  done?: () => void;
}

interface Floater {
  sprite: THREE.Sprite;
  life: number;
}

class PizzaView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly crew: Companion[];
  private pizza: THREE.Group | null = null;
  private layers = 0;
  private boxes = 0;
  private tweens: Tween[] = [];
  private floaters: Floater[] = [];
  private oven: THREE.Mesh;
  private sparks: { mesh: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private readonly fire = new THREE.PointLight(P.ember, 22, 9, 1.6);
  private board: THREE.CanvasTexture;
  private boardMat: THREE.MeshBasicMaterial;

  constructor(seats: MinigameSeat[], companions: Companion[], target: number) {
    this.crew = companions;
    const n = seats.length;
    const s = this.scene;
    // The pizzeria: warm plaster walls, terracotta floor tiles, the kitchen along the back wall.
    const env = kitchen(s, { mood: 'evening', w: 18.5, d: ROOM_D, h: 6.6, lights: false, wall: mix(P.terracotta, P.espresso, 0.4), cabinets: P.walnut, floor: 'patio' });
    env.root.scale.setScalar(ROOM);
    env.sun.target.position.set(0, 0, -1);
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

    // The brick oven in the back, glowing: a chimney breast up the wall, the dome, an arched mouth with the fire in it.
    const brick = { tex: 'brick' as const, texScale: 1.6 };
    part(set, box(5.6, 8, 1.3), mix(P.brick, P.espresso, 0.25), 6.5, 4, BACK + 0.6, { ...brick, outline: false });
    part(set, dome(2.3), P.brick, 6.5, 0, -4.6, { sy: 1.05, ...brick, outline: 0.03 });
    part(set, rbox(5.4, 0.4, 3.4, 0.08), mix(P.brick, P.ink, 0.25), 6.5, 0.2, -4.6, { ...brick, outline: 0.03 });
    part(set, torus(0.92, 0.16, Math.PI), mix(P.brick, P.ink, 0.35), 6.5, 0.72, -2.3, { sy: 0.85, ...brick, outline: false });
    part(set, rbox(2.3, 0.14, 0.5, 0.04), P.stone, 6.5, 0.66, -2.2, { tex: 'stoneTiles', outline: false });
    this.oven = part(set, dome(0.8), P.ember, 6.5, 0.75, -2.26, { glow: 1.7, sy: 0.85, rx: -Math.PI / 2, shadow: false });
    this.fire.position.set(6.5, 1.3, -1.7);
    s.add(this.fire);
    // A peel leaning by the oven, logs stacked beside it.
    part(set, cyl(0.03, 0.03, 2.6, 8), P.oak, 9.3, 1.3, -3.0, { rz: 0.12, outline: false });
    part(set, cyl(0.42, 0.42, 0.04, 20), P.oak, 9.14, 2.62, -3.0, { rx: Math.PI / 2, tex: 'wood', outline: 0.02 });
    for (let i = 0; i < 6; i++) part(set, cyl(0.16, 0.16, 1.0, 10), mix(P.woodDark, P.oak, (i % 3) * 0.25), 3.6 + (i % 3) * 0.34 - (i > 2 ? -0.17 : 0), 0.57 + (i > 2 ? 0.29 : 0), -3.1, { rx: Math.PI / 2, tex: 'bark', outline: false });

    // On the wall: a neon sign, pictures, fairy lights.
    put(props.neonSign('pizza', { color: P.neonPink, h: 1.3 }), -6.4, 5.6, BACK + 0.04);
    put(props.pictureFrame({ w: 0.9, h: 0.7, art: 'shapes', frame: P.brass, seed: 8 }), -2.8, 6.3, BACK + 0.02);
    put(props.pictureFrame({ w: 0.8, h: 1.0, art: 'leaf', frame: P.charcoal, seed: 2 }), 1.4, 6.3, BACK + 0.02);
    const bulbs = [P.lamp, mix(P.ember, P.lamp, 0.4), P.cream];
    for (let i = 0; i < 3; i++) set.add(props.stringLights(new THREE.Vector3(-12 + i * 5.2, 7.0, BACK + 0.12), new THREE.Vector3(-6.8 + i * 5.2, 7.0, BACK + 0.12), { sag: 0.3, count: 8, colors: bulbs, bulb: 0.09 }));
    // Brass pendants at both ends of the counter.
    put(props.pendantLamp({ drop: 4.6, r: 0.55, light: 26 }), -8.6, 10.2, 0.2);
    put(props.pendantLamp({ drop: 4.3, r: 0.55, light: 20 }), 9.4, 10.2, 0.4);

    // The counter (white tiles, a walnut top), the boxing table on the right and the bin on the left.
    part(set, rbox(13, COUNTER_Y - 0.12, 1.9, 0.08), P.ceramic, 0.6, (COUNTER_Y - 0.12) / 2, 0, { tex: 'kitchenTile', gloss: 0.3, outline: 0.03 });
    part(set, rbox(13.2, 0.14, 2.1, 0.05), P.walnut, 0.6, COUNTER_Y - 0.06, 0, { tex: 'wood', gloss: 0.2, outline: 0.03 });
    part(set, rbox(13, 0.16, 0.04, 0.02), P.brick, 0.6, 0.52, 0.96, { outline: false, shadow: false });
    part(set, rbox(13, 0.14, 0.06, 0.02), P.charcoal, 0.6, 0.07, 0.94, { outline: false });
    part(set, rbox(2.4, COUNTER_Y, 2.1, 0.08), P.oak, STACK.x, COUNTER_Y / 2, STACK.z, { tex: 'planks', outline: 0.03 });
    part(set, cyl(0.62, 0.52, 1.3, 20), P.slate, TRASH.x, 0.65, TRASH.z, { tex: 'metalPlate', texStrength: 0.25, gloss: 0.5, outline: 0.03 });
    part(set, torus(0.6, 0.06), P.metal, TRASH.x, 1.3, TRASH.z, { rx: Math.PI / 2, gloss: 0.6, outline: false });
    part(set, cyl(1.25, 1.25, 0.06, 36), P.oak, PIZZA.x, COUNTER_Y + 0.03, PIZZA.z, { tex: 'wood', outline: 0.02 });
    // Things a pizza counter has: a flour shaker, an oil bottle, a pot of basil, a rolling pin.
    put(props.jar({ color: P.ceramic, h: 0.26 }), -3.4, COUNTER_Y, 0.55, 0, 1.6);
    put(props.drink({ kind: 'bottle', color: P.olive }), -3.0, COUNTER_Y, 0.7, 0, 1.6);
    put(props.plant({ kind: 'fern', h: 0.3, pot: P.terracotta, seed: 2 }), 4.4, COUNTER_Y, 0.6, 0, 1.6);
    part(set, cyl(0.07, 0.07, 0.8, 12), P.oak, 3.0, COUNTER_Y + 0.07, 0.75, { rz: Math.PI / 2, ry: 0.3, tex: 'wood', outline: 0.015 });
    // The goal: a little flag at the height of the target stack of boxes.
    const goalY = COUNTER_Y + target * BOX_H;
    part(set, cyl(0.04, 0.04, goalY - COUNTER_Y + 0.6, 8), P.brass, STACK.x + 1.05, (goalY + COUNTER_Y + 0.6) / 2, STACK.z - 0.6, { gloss: 0.6, outline: false });
    part(set, rbox(0.55, 0.32, 0.04, 0.02), P.mustard, STACK.x + 1.33, goalY + 0.42, STACK.z - 0.6, { glow: 0.3, outline: false });
    part(set, rbox(0.5, 0.03, 0.03, 0.01), P.mustard, STACK.x + 0.8, goalY, STACK.z - 0.6, { glow: 0.7, outline: false });
    const goal = nameCard(`Goal: ${target} pizzas`, P.mustard, 0.8);
    goal.position.set(STACK.x + 0.7, goalY + 1.0, STACK.z - 0.6);
    this.scene.add(goal);

    // The crew, each with a tray of closed topping tubs in their colour (what's inside is on their phone).
    part(set, rbox(13, 0.25, 1.4, 0.05), P.woodDark, 0.6, 0.125, CREW_Z, { tex: 'planks', outline: 0.03 });
    seats.forEach((seat, i) => {
      const x = (i - (n - 1) / 2) * 2.75;
      part(set, rbox(1.7, 0.1, 0.55, 0.04), mix(seat.color, P.aubergine, 0.3), x, COUNTER_Y + 0.05, -0.6, { outline: 0.02 });
      for (let k = 0; k < 3; k++) {
        part(set, cyl(0.2, 0.18, 0.22, 16), P.ceramic, x - 0.5 + k * 0.5, COUNTER_Y + 0.21, -0.6, { gloss: 0.5, outline: 0.02 });
        part(set, cyl(0.22, 0.22, 0.05, 16), seat.color, x - 0.5 + k * 0.5, COUNTER_Y + 0.34, -0.6, { outline: false });
        part(set, sphere(0.045, 8), seat.color, x - 0.5 + k * 0.5, COUNTER_Y + 0.38, -0.6, { outline: false });
      }
      const c = companions[i];
      if (c) {
        c.root.position.set(x, 0.25, CREW_Z);
        c.setBase('listening');
        this.scene.add(c.root);
      }
      const card = nameCard(seat.name, seat.color, 0.8);
      card.position.set(x, 2.65, CREW_Z);
      this.scene.add(card);
    });

    // The customers' side: stools at the counter, a little table with a candle, plants and a pile of boxes.
    for (const x of [-4.6, -2.3, 2.9, 5.2]) put(props.stool({ h: 0.6, seat: P.terracotta }), x, 0, 1.75, x, 1.4);
    put(props.rug({ w: 12.5, d: 3.4, color: mix(P.forest, P.aubergine, 0.3), border: P.mustard }), 0.6, 0, 3.6);
    const bistro = put(new THREE.Group(), 5.8, 0, 5.9, -0.2, 1.35);
    bistro.add(props.table({ w: 1.2, d: 1.2, h: 0.78, color: P.walnut, cloth: P.terracotta }));
    const flame = props.candle({ h: 0.14 });
    flame.position.set(0.1, 0.8, 0);
    bistro.add(flame);
    const olives = props.snackBowl({ fill: 'fruit', color: P.ceramic, r: 0.14 });
    olives.position.set(-0.25, 0.8, 0.15);
    bistro.add(olives);
    put(props.stool({ h: 0.5, seat: P.mustard }), 4.2, 0, 6.5, 0, 1.4);
    put(props.plant({ kind: 'ficus', h: 2.0, pot: P.terracotta, seed: 6 }), -6.6, 0, 5.2, 0, 1.35);
    const boxes = put(new THREE.Group(), -4.4, 0, 6.5, 0.3);
    boxes.add(props.crate({ s: 0.9 }));
    for (let i = 0; i < 4; i++) {
      const b = props.pizzaBox({ size: 0.42 });
      b.scale.setScalar(2.1);
      b.position.set(0.02 * i, 0.9 + i * 0.095, 0);
      b.rotation.y = i * 0.12;
      boxes.add(b);
    }
    this.tick = props.tickProps(set);
    // The ticket board above the crew.
    this.board = canvasTexture(1400, 330, () => {});
    this.boardMat = new THREE.MeshBasicMaterial({ map: this.board, transparent: true, toneMapped: false });
    const sign = new THREE.Mesh(plane(9.6, 9.6 * (330 / 1400)), this.boardMat);
    sign.position.set(0.3, 4.35, -3.6);
    this.scene.add(sign);
    // It hangs from the ceiling on two chains.
    for (const dx of [-4.2, 4.2]) part(set, cyl(0.02, 0.02, 5, 6), P.charcoal, 0.3 + dx, 4.35 + 1.1 + 2.5, -3.6, { outline: false, shadow: false });
    part(set, rbox(9.9, 0.14, 0.14, 0.04), P.walnut, 0.3, 4.35 + 1.16, -3.62, { tex: 'wood', outline: false });

    // From the front, a little left and above: the whole crew, the ticket and the box stack, clear of the score list.
    this.camera.position.set(-0.6, 7.6, 17);
    this.camera.lookAt(0.9, 2.3, 0);
    for (const c of companions) c.root.rotation.y = Math.atan2(this.camera.position.x - c.root.position.x, this.camera.position.z - c.root.position.z);
    this.newPizza();
  }

  /** Redraws the ticket: the order with the next topping highlighted, and the pizzas so far. */
  ticket(k: Kitchen, target: number): void {
    const canvas = this.board.image as HTMLCanvasElement;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fffaf1';
    g.beginPath();
    g.roundRect(6, 6, w - 12, h - 12, 34);
    g.fill();
    g.strokeStyle = '#d8452c';
    g.lineWidth = 10;
    g.stroke();
    g.textBaseline = 'middle';
    g.fillStyle = '#2a2140';
    g.font = `800 50px ${FONT}`;
    g.textAlign = 'left';
    g.fillText(k.phase === 'build' ? `Order #${k.orders}` : k.phase === 'serve' ? 'Order up!' : 'Spoiled!', 44, 62);
    g.textAlign = 'right';
    g.fillStyle = '#d8452c';
    g.fillText(`🍕 ${k.served} / ${target}`, w - 44, 62);
    g.textAlign = 'center';
    if (k.phase !== 'build') {
      g.fillStyle = k.phase === 'serve' ? '#2f9e5b' : '#b03a48';
      g.font = `700 54px ${FONT}`;
      g.fillText(k.phase === 'serve' ? 'Boxing it up… next ticket coming' : 'Wrong topping! Fresh dough coming…', w / 2, 205);
    } else {
      const count = k.order.length;
      const gap = 18;
      const cw = (w - 88 - gap * (count - 1)) / count;
      k.order.forEach((t, i) => {
        const x = 44 + i * (cw + gap);
        const y = 130;
        const ch = 160;
        const done = i < k.done;
        const next = i === k.done;
        g.globalAlpha = done ? 0.45 : 1;
        g.fillStyle = next ? '#2a2140' : '#efe6d8';
        g.beginPath();
        g.roundRect(x, y, cw, ch, 26);
        g.fill();
        g.fillStyle = TOPPING_INFO[t].color;
        g.beginPath();
        g.arc(x + cw / 2, y + 52, 30, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = next ? '#ffffff' : '#2a2140';
        g.font = `700 ${count > 4 ? 34 : 40}px ${FONT}`;
        g.fillText(TOPPING_INFO[t].name, x + cw / 2, y + 122, cw - 16);
        if (done) {
          g.globalAlpha = 1;
          g.fillStyle = '#2f9e5b';
          g.font = `800 64px ${FONT}`;
          g.fillText('✔', x + cw / 2, y + 52);
        }
        if (next) {
          g.fillStyle = '#ffd166';
          g.fillStyle = P.brick;
          g.font = `800 28px ${FONT}`;
          g.fillText('Next', x + cw / 2, y - 18 + 4);
        }
        g.globalAlpha = 1;
      });
    }
    this.board.needsUpdate = true;
  }

  newPizza(): void {
    const p = pizzaBase();
    p.position.copy(PIZZA);
    p.scale.setScalar(0.01);
    this.pizza = p;
    this.layers = 0;
    this.scene.add(p);
    this.tween(0.35, (k) => p.scale.setScalar(Math.max(0.01, ease.outBack(k))));
  }

  /** A topping drops onto the pizza from above. */
  addTopping(t: Topping): void {
    const p = this.pizza;
    if (!p) return;
    const pieces = toppingPieces(t);
    const y = 0.11 + this.layers * 0.025;
    this.layers += 1;
    p.add(pieces);
    this.tween(0.35, (k) => {
      pieces.position.y = y + (1 - ease.outCubic(k)) * 1.4;
      pieces.scale.setScalar(0.4 + 0.6 * ease.outBack(k));
    });
    // The pizza takes the weight: a small squash as the topping lands, then it settles.
    this.tween(0.5, (k) => {
      const land = Math.max(0, (k - 0.55) / 0.45);
      const squash = Math.sin(land * Math.PI) * 0.07;
      p.scale.set(1 + squash, 1 - squash * 1.6, 1 + squash);
    });
  }

  /** The finished pizza slides to the boxing table and joins the stack. */
  serve(): void {
    const p = this.pizza;
    if (!p) return;
    this.pizza = null;
    const from = p.position.clone();
    const to = STACK.clone().setY(COUNTER_Y + this.boxes * BOX_H + 0.02);
    const level = this.boxes;
    this.boxes += 1;
    this.tween(
      0.55,
      (k) => {
        p.position.lerpVectors(from, to, ease.inOutSine(k));
        p.position.y += Math.sin(k * Math.PI) * 1.2;
      },
      () => {
        this.scene.remove(p);
        const box = pizzaBox();
        box.position.copy(STACK).setY(COUNTER_Y + level * BOX_H);
        box.rotation.y = (level % 3) * 0.08 - 0.08;
        this.scene.add(box);
        this.tween(0.25, (k) => box.scale.set(1, Math.max(0.05, ease.outBack(k)), 1));
        this.float('Order up!', P.mustard, STACK.x, COUNTER_Y + level * BOX_H + 1.2, STACK.z);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const mesh = part(this.scene, gem(0.08), i % 2 ? P.lamp : P.mustard, STACK.x, COUNTER_Y + (level + 1) * BOX_H + 0.1, STACK.z, { glow: 1.8, shadow: false });
          this.sparks.push({ mesh, v: new THREE.Vector3(Math.cos(a) * 2.2, 2.6, Math.sin(a) * 2.2), age: 0 });
        }
      },
    );
  }

  /** A spoiled pizza flips into the bin. */
  spoil(): void {
    const p = this.pizza;
    if (!p) return;
    this.pizza = null;
    const from = p.position.clone();
    const to = TRASH.clone().setY(1.2);
    this.tween(
      0.7,
      (k) => {
        p.position.lerpVectors(from, to, k);
        p.position.y += Math.sin(k * Math.PI) * 2.2;
        p.rotation.x = k * Math.PI * 1.5;
        p.scale.setScalar(1 - 0.5 * k);
      },
      () => this.scene.remove(p),
    );
    this.float('Spoiled!', '#ffb0bd', PIZZA.x, COUNTER_Y + 1.6, PIZZA.z);
  }

  float(text: string, color: string, x: number, y: number, z: number, height = 0.55): void {
    const sprite = popSprite(text, color, height);
    sprite.position.set(x, y, z);
    this.floaters.push({ sprite, life: 1.2 });
    this.scene.add(sprite);
  }

  private tween(duration: number, step: (k: number) => void, done?: () => void): void {
    this.tweens.push({ t: 0, duration, step, ...(done ? { done } : {}) });
  }

  dispose(): void {
    for (const c of this.crew) c.dispose();
    for (const f of this.floaters) disposeSprite(f.sprite);
    this.board.dispose();
    this.boardMat.dispose();
  }

  update(dt: number, time: number): void {
    for (const c of this.crew) c.update(dt);
    this.oven.scale.setScalar(0.95 + 0.05 * Math.sin(time * 3.1) + 0.03 * Math.sin(time * 7.3));
    this.fire.intensity = 22 * (0.9 + 0.07 * Math.sin(time * 9.3) + 0.05 * Math.sin(time * 4.1));
    this.env.update(dt, time);
    this.tick(dt, time);
    this.sparks = this.sparks.filter((sp) => {
      sp.age += dt;
      sp.v.y -= 7 * dt;
      sp.mesh.position.addScaledVector(sp.v, dt);
      sp.mesh.rotation.y += dt * 9;
      sp.mesh.scale.setScalar(Math.max(0.01, 1 - sp.age / 0.6));
      if (sp.age < 0.6) return true;
      sp.mesh.removeFromParent();
      return false;
    });
    this.tweens = this.tweens.filter((tw) => {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.duration);
      tw.step(k);
      if (k >= 1) tw.done?.();
      return k < 1;
    });
    this.floaters = this.floaters.filter((f) => {
      f.life -= dt;
      f.sprite.position.y += dt * 0.7;
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

export const minigame: Minigame = {
  id: 'orderup',
  title: 'Order Up',
  how: 'Every phone has only some of the toppings: call out who has what and add them in the order on the ticket. A wrong topping spoils the pizza, so serve as many as you can together!',
  controller: 'buttons',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const k = newKitchen(rng, n);
    const target = orderTarget(n);
    const skill = seats.map(() => ctx.skill());
    const cpus: OrderCpu[] = seats.map(() => newOrderCpu());
    const view = new PizzaView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.75 }))), target);
    ctx.stage.setView(view);
    view.ticket(k, target);
    seats.forEach((_, i) =>
      session.setLayout(i, {
        kind: 'buttons',
        title: 'Your toppings',
        buttons: (k.hands[i] ?? []).map((t) => ({ label: TOPPING_INFO[t].name, color: buttonColor(t) })),
        note: 'Call out what you have! Add yours when it’s next on the ticket.',
      }),
    );

    const press = (seat: number, t: Topping) => {
      const r = addTopping(k, seat, t);
      if (r === 'ignored') return;
      const cook = view.crew[seat];
      if (r === 'spoiled') {
        sfx.bad();
        view.spoil();
        cook?.react('sad', 1.6);
        view.crew.forEach((c, i) => {
          if (i !== seat) c.react('thinking', 1.2);
        });
        seats.forEach((_, i) => session.send(i, { t: 'feedback', good: false, text: `Spoiled! ${seats[seat]?.name ?? 'Someone'} added ${TOPPING_INFO[t].name.toLowerCase()}, but the ticket said ${TOPPING_INFO[k.order[k.done] ?? t].name.toLowerCase()}.` }));
        session.send(seat, { t: 'buzz', pattern: [160] });
      } else {
        view.addTopping(t);
        sfx.hop();
        cook?.react('working', 0.7);
        if (r === 'served') {
          sfx.good();
          view.serve();
          for (const c of view.crew) c.react('happy', 1.4);
          seats.forEach((_, i) => session.send(i, { t: 'feedback', good: true, text: `Order up! ${k.served} served.` }));
        } else {
          session.send(seat, { t: 'feedback', good: true, text: `${TOPPING_INFO[t].name} on!` });
        }
      }
      view.ticket(k, target);
    };
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'press' || seat >= n || session.isCpu(seat)) return;
      const t = k.hands[seat]?.[msg.index];
      if (t) press(seat, t);
    });

    let hudAt = -1;
    ui.caption('Call out your toppings and follow the ticket!');
    await everyFrame(clock, (dt) => {
      if (stepKitchen(k, dt, rng)) {
        view.newPizza();
        view.ticket(k, target);
      }
      seats.forEach((_, i) => {
        if (!session.isCpu(i)) return;
        const t = cpuOrderUp(k, i, skill[i] ?? 0.5, rng, cpus[i] as OrderCpu);
        if (t) press(i, t);
      });
      if (k.time - hudAt > 0.2) {
        hudAt = k.time;
        ui.timer(ORDERUP.duration - k.time);
        ui.live(
          seats.map((s, i) => {
            const m = k.mistakes[i] ?? 0;
            return { name: s.name, color: s.color, thumb: s.thumb, value: `${k.added[i] ?? 0} added${m ? ` · ${m} ✖` : ''}` };
          }),
        );
      }
      return k.time >= ORDERUP.duration;
    });
    off();
    ui.timer(null);
    const coop = orderCoop(k);
    for (const c of view.crew) c.setBase(coop >= 0.6 ? 'happy' : 'sad');
    const made = pizzasMade(k);
    ui.caption(`${k.served} pizza${k.served === 1 ? '' : 's'} served${made > k.served ? ' (and one nearly done)' : ''}. Goal was ${target}!`);
    if (coop >= 0.6) sfx.good();
    session.setLayoutAll(() => ({ kind: 'wait', title: 'Kitchen closed!', text: 'Watch the big screen' }));
    await clock.wait(1.6);
    ui.caption(null);
    const score = Math.round(coop * 1000);
    return {
      scores: seats.map(() => score),
      details: seats.map((_, i) => {
        const m = k.mistakes[i] ?? 0;
        const added = k.added[i] ?? 0;
        return `${added} topping${added === 1 ? '' : 's'} added${m ? ` · spoiled ${m}` : ''}`;
      }),
      coop,
    };
  },
};
