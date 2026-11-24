// A calm place to look at behind the menus and the standings between games: a lamp-lit room (or kitchen, or
// rooftop) with the players' companions hanging around. Each series mode has its own.
import * as THREE from 'three';
import { type Companion, buildCompanion } from '../../companion/kit';
import type { CompanionLook } from '../../shared/look';
import type { Host } from '../host';
import { type Env, kitchen, livingRoom, rooftop } from '../render/env';
import * as props from '../render/props';
import { PALETTE as P, part, rbox } from '../render/toon';
import type { View } from '../stage';

export type BackdropTheme = 'lounge' | 'lofi' | 'kitchen' | 'rooftop' | 'table';

/** Where a companion waits: position, and which way it faces. */
type Slot = [x: number, y: number, z: number, yaw: number];

interface Layout {
  env: Env;
  cam: [number, number, number];
  look: [number, number, number];
  slots: Slot[];
}

const put = <T extends THREE.Object3D>(scene: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T => {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  scene.add(obj);
  return obj;
};

/** Two on the sofa, two on the floor either side of the coffee table. */
const SOFA_SLOTS: Slot[] = [
  [-2.15, 0, 0.4, 0.45],
  [-0.62, 0.7, -2.5, 0.1],
  [0.62, 0.7, -2.5, -0.1],
  [2.15, 0, 0.4, -0.45],
];

const BUILD: Record<BackdropTheme, (scene: THREE.Scene) => Layout> = {
  // Free Play and the challenges: the living room on a quiet evening.
  lounge: (scene) => ({
    env: livingRoom(scene, { mood: 'evening', furniture: 'full', seed: 2 }),
    cam: [0.7, 2.5, 7.6],
    look: [0.3, 1.05, -1],
    slots: SOFA_SLOTS,
  }),
  // The Lo-Fi Session: the same room after midnight, in neon.
  lofi: (scene) => {
    const env = livingRoom(scene, { mood: 'neon', furniture: 'full', seed: 4, accent: P.denim });
    put(scene, props.speaker({ h: 1.0 }), 3.6, 0, -2.6, -0.4, 1.2);
    put(scene, props.guitar(), -2.6, 0, -3.1, 0.3);
    return { env, cam: [0.7, 2.5, 7.6], look: [0.3, 1.05, -1], slots: SOFA_SLOTS };
  },
  // The Sky Cup: the kitchen, where the snacks are.
  kitchen: (scene) => {
    const env = kitchen(scene, { mood: 'evening', island: 2.6 });
    for (const lamp of env.lamps) lamp.intensity *= 0.6; // calmer than a kitchen you cook in
    put(scene, props.pizzaBox({ open: true, slices: 6 }), -0.6, 0.93, -0.3, 0.3, 1.2);
    put(scene, props.snackBowl({ fill: 'crisps', color: P.terracotta }), 0.3, 0.93, -0.25);
    put(scene, props.drink({ kind: 'bottle', color: P.forest }), 0.75, 0.93, -0.4);
    put(scene, props.drink({ color: P.rose }), 0.9, 0.93, -0.2);
    return {
      env,
      cam: [0.7, 2.6, 7.4],
      look: [0.3, 1.1, -0.9],
      slots: [
        [-2.5, 0, 1.0, 0.4],
        [-1.75, 0, 0.2, 0.3],
        [1.75, 0, 0.2, -0.3],
        [2.5, 0, 1.0, -0.4],
      ],
    };
  },
  // The Night Owl Marathon: up on the roof, the city still awake.
  rooftop: (scene) => ({
    env: rooftop(scene, { mood: 'night', lounge: true, sign: 'night owls', seed: 6 }),
    cam: [0.8, 3.0, 10.6],
    look: [0.4, 1.5, -1.5],
    slots: [
      [-2.2, 0, 0.6, 0.3],
      [-0.75, 0, 0, 0.1],
      [0.75, 0, 0, -0.1],
      [2.2, 0, 0.6, -0.3],
    ],
  }),
  // Coffee Table: a cleared table with everyone's phone on it.
  table: (scene) => {
    const env = livingRoom(scene, { mood: 'evening', seed: 5, rug: P.denim });
    put(scene, props.sofa({ seats: 3, color: P.forest, pillows: [P.mustard, P.cream] }), 0, 0, -2.75, 0, 1.25);
    put(scene, props.coffeeTable({ w: 2.0, d: 1.1 }), 0, 0, 0.5);
    for (let i = 0; i < 4; i++) {
      const phone = put(scene, new THREE.Group(), (i - 1.5) * 0.44, 0.425, 0.5 + (i % 2 ? 0.14 : -0.1), (i - 1.5) * 0.22);
      part(phone, rbox(0.16, 0.016, 0.32, 0.006), P.charcoal, 0, 0.008, 0, { outline: 0.012 });
      part(phone, rbox(0.14, 0.004, 0.29, 0.002), P.screen, 0, 0.018, 0, { glow: 1.25, outline: false, shadow: false });
    }
    put(scene, props.mug({ color: P.terracotta }), 0.86, 0.42, 0.2, 0.8);
    return { env, cam: [0.6, 2.9, 6.0], look: [0.2, 0.75, -0.6], slots: SOFA_SLOTS };
  },
};

class BackdropView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 400);
  private readonly layout: Layout;
  private readonly tick: (dt: number, time: number) => void;
  private companions: Companion[] = [];
  private shown = '';
  private asked = 0;

  constructor(theme: BackdropTheme) {
    this.layout = BUILD[theme](this.scene);
    // The builder's own props tick with env.update; this catches the ones added on top.
    const extra = new THREE.Group();
    for (const o of [...this.scene.children]) if (o !== this.layout.env.root && !(o as THREE.Light).isLight && o.name !== 'sky') extra.add(o);
    this.scene.add(extra);
    this.tick = props.tickProps(extra);
    this.update(0, 0);
  }

  /** The players' companions, waiting around. Rebuilt only when somebody's look changed. */
  setPlayers(looks: CompanionLook[]): void {
    const key = JSON.stringify(looks);
    if (key === this.shown) return;
    this.shown = key;
    const ask = ++this.asked;
    void Promise.all(looks.map((look) => buildCompanion(look, { height: 1.25 }).catch(() => null))).then((built) => {
      if (ask !== this.asked) {
        for (const c of built) c?.dispose();
        return;
      }
      for (const c of this.companions) c.dispose();
      this.companions = [];
      built.forEach((c, i) => {
        const slot = this.layout.slots[i % this.layout.slots.length];
        if (!c || !slot) return;
        c.root.position.set(slot[0], slot[1], slot[2]);
        c.root.rotation.y = slot[3];
        c.setBase('idle');
        this.scene.add(c.root);
        this.companions.push(c);
      });
    });
  }

  update(dt: number, time: number): void {
    const { cam, look, env } = this.layout;
    env.update(dt, time);
    this.tick(dt, time);
    for (const c of this.companions) c.update(dt);
    // A slow drift, so the room is never a still picture.
    this.camera.position.set(cam[0] + Math.sin(time * 0.09) * 0.4, cam[1] + Math.sin(time * 0.13) * 0.06, cam[2]);
    this.camera.lookAt(look[0], look[1], look[2]);
  }
  // No dispose(): the stage disposes a view when a minigame replaces it, and this one comes back after each game.
}

const views = new Map<BackdropTheme, BackdropView>();

/** Shows a mode's backdrop behind whatever the UI puts up next (a menu, a banner with the standings). */
export function showBackdrop(host: Host, theme: BackdropTheme = 'lounge'): void {
  let view = views.get(theme);
  if (!view) {
    view = new BackdropView(theme);
    views.set(theme, view);
  }
  view.setPlayers(host.d.session.seats.map((s) => s.look));
  host.d.stage.setView(view);
}
