// Snail Bets on the TV: a patio at dusk, string lights on, four garden snails at a chalk start line. Everyone
// picks a snail on their phone, then taps to cheer it along the flagstones while their companion strolls beside it.
import * as THREE from 'three';
import {
  SNAIL,
  SNAILS,
  type Race,
  type SnailFan,
  cheer,
  fanTaps,
  fillBets,
  newFan,
  newRace,
  placeBet,
  placings,
  raceOver,
  snailScores,
  stepRace,
} from '../../../game/minigames/snailrace';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { FONT, PALETTE as P, ball, box, canvasTexture, cone, cyl, gem, mix, nameCard, part, pill, popSprite, rbox, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark, lanes, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.1;
const START = -SNAIL.length / 2;
const LANE_Z = lanes(SNAILS.length, 1.05);
const CROWD_Z = -2.75;
const ORDINALS = ['1st', '2nd', '3rd', '4th'] as const;

// ------------------------------------------------------------------ sounds

const pip = (sfx: Sfx, snail: number) => tone(sfx, { freq: 660 + snail * 110 + Math.random() * 50, dur: 0.06, gain: 0.045 });
const munch = (sfx: Sfx) => {
  for (let k = 0; k < 3; k++) noise(sfx, { dur: 0.05, filter: 'bandpass', freq: 2200 + Math.random() * 600, gain: 0.18, delay: k * 0.13 });
};
const bloop = (sfx: Sfx, up: boolean) => tone(sfx, { freq: up ? 200 : 330, to: up ? 360 : 180, dur: 0.18, type: 'triangle', gain: 0.08 });

// ------------------------------------------------------------------ the snails

/** A snail's name card with a dot in each backer's colour. Same size on screen however far away. */
function snailCard(name: string, shell: string, backers: string[]): THREE.Sprite {
  const texture = canvasTexture(512, 128, (ctx) => {
    ctx.font = `650 46px ${FONT}`;
    const text = Math.min(330, ctx.measureText(name).width);
    const width = Math.min(500, text + 80 + backers.length * 34);
    const left = (512 - width) / 2;
    ctx.fillStyle = 'rgba(24,20,32,0.86)';
    ctx.beginPath();
    ctx.roundRect(left, 22, width, 84, 42);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(left + 1, 23, width - 2, 82, 41);
    ctx.stroke();
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.arc(left + 38, 64, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6f1ea';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, left + 62, 66, 330);
    backers.forEach((c, k) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(left + 76 + text + k * 34, 64, 12, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }));
  sprite.scale.set(0.15 * 0.85, 0.0375 * 0.85, 1);
  sprite.renderOrder = 5;
  return sprite;
}

function dropSprite(s: THREE.Sprite): void {
  s.removeFromParent();
  s.material.map?.dispose();
  s.material.dispose();
}

interface SnailRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  shell: THREE.Group;
  leaf: THREE.Mesh;
  card: THREE.Sprite;
  /** The glistening trail it leaves on the stones. */
  trail: THREE.Mesh;
  tuck: number;
  hop: number;
  pauseFull: number;
  place: THREE.Sprite | null;
}

function snailModel(shellColor: string): Omit<SnailRig, 'card' | 'trail' | 'tuck' | 'hop' | 'pauseFull' | 'place'> {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  const shell = new THREE.Group();
  root.add(body, shell);
  head.position.set(0.44, 0.22, 0);
  body.add(head);
  shell.position.set(-0.08, 0.42, 0);
  const skin = P.sand;
  const slick = { gloss: 0.35 };
  return withOutline(0.022, () => {
    part(body, pill(0.13, 0.62), skin, 0.02, 0.13, 0, { rz: Math.PI / 2, sz: 1.15, ...slick });
    // a paler foot under the body
    part(body, pill(0.1, 0.7), mix(skin, P.cream, 0.5), 0.0, 0.05, 0, { rz: Math.PI / 2, sz: 1.5, sy: 0.5, outline: false });
    part(head, sphere(0.15, 18), skin, 0, 0, 0, slick);
    for (const z of [-0.07, 0.07]) {
      part(head, cyl(0.02, 0.028, 0.3, 8), skin, 0.04, 0.2, z, { rz: -0.3, rx: z * 2.5 });
      part(head, sphere(0.05, 12), mix(skin, P.cream, 0.4), 0.09, 0.35, z * 1.5, slick);
      part(head, sphere(0.027, 10), P.ink, 0.115, 0.36, z * 1.5 + 0.03, { outline: false, gloss: 0.7 });
      // the short lower feelers
      part(head, cyl(0.012, 0.016, 0.1, 6), skin, 0.13, 0.0, z * 0.9, { rz: -1.2, outline: false });
    }
    part(head, torus(0.045, 0.012, Math.PI), P.ink, 0.06, -0.02, 0.13, { rz: Math.PI, outline: false });
    // The shell: a glossy spiral on each side, a darker band round the rim, a highlight.
    const swirl = mix(shellColor, P.ink, 0.32);
    part(shell, sphere(0.32, 24), shellColor, 0, 0, 0, { sz: 0.78, gloss: 0.5 });
    part(shell, torus(0.3, 0.03), swirl, 0, 0, 0, { sz: 0.8, outline: false });
    for (const side of [-1, 1]) {
      part(shell, torus(0.19, 0.04), swirl, 0, 0, side * 0.215, { outline: false, gloss: 0.5 });
      part(shell, torus(0.095, 0.034), mix(shellColor, P.cream, 0.25), 0.025, 0.025, side * 0.245, { outline: false, gloss: 0.5 });
      part(shell, sphere(0.04, 10), swirl, 0.03, 0.03, side * 0.262, { outline: false });
    }
    part(shell, sphere(0.045, 10), mix(shellColor, '#ffffff', 0.6), -0.13, 0.17, 0.17, { outline: false, sy: 0.6 });
    // A lettuce leaf for snack stops.
    const leaf = part(root, ball(0.15, 1), P.leaf, 0.74, 0.06, 0.04, { sy: 0.22, sx: 1.3 });
    part(leaf, cyl(0.012, 0.012, 0.26, 4), P.moss, 0, 0.1, 0, { rz: Math.PI / 2, outline: false });
    leaf.visible = false;
    return { root, body, head, shell, leaf };
  });
}

interface FanRig {
  c: Companion;
  ring: THREE.Mesh;
  pick: THREE.Sprite | null;
  motion: 'walk' | null;
  mood: CompanionMood | null;
  cheerAt: number;
}

interface Cheer {
  sprite: THREE.Sprite;
  age: number;
}

class Patio implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly snails: SnailRig[] = [];
  readonly fans: FanRig[] = [];
  private readonly fit = new CameraFit(this.camera, 0.52);
  private readonly marks: Mark[] = [];
  private env!: Env;
  private tick: (dt: number, time: number) => void = () => undefined;
  private sparks: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private cheers: Cheer[] = [];
  private goWords = new Map<string, THREE.Sprite>();
  private time = 0;

  constructor(
    private readonly seats: MinigameSeat[],
    companions: Companion[],
  ) {
    this.buildPatio();
    SNAILS.forEach((s, i) => {
      const m = snailModel(s.shell);
      m.root.position.set(START, 0, LANE_Z[i] as number);
      this.scene.add(m.root);
      const card = snailCard(s.name, s.shell, []);
      this.scene.add(card);
      const trail = part(this.scene, box(1, 0.006, 0.17), P.moon, START, 0.045, LANE_Z[i] as number, { opacity: 0.2, gloss: 0.7, outline: false, shadow: false });
      trail.visible = false;
      this.snails.push({ ...m, card, trail, tuck: 0, hop: 0, pauseFull: 1, place: null });
    });
    const xs = lanes(seats.length, 1.6);
    seats.forEach((s, i) => {
      const c = companions[i] as Companion;
      c.root.position.set(xs[i] as number, 0, CROWD_Z);
      c.setBase('idle');
      this.scene.add(c.root);
      const ring = part(this.scene, torus(0.42, 0.045), s.color, xs[i] as number, 0.06, CROWD_Z, { rx: Math.PI / 2, glow: 1.1, outline: false, shadow: false });
      this.fans.push({ c, ring, pick: null, motion: null, mood: null, cheerAt: -9 });
    });
    const half = SNAIL.length / 2 + 0.9;
    for (const x of [-half, half]) {
      for (const z of [(LANE_Z[0] as number) - 0.5, (LANE_Z[LANE_Z.length - 1] as number) + 0.6]) this.marks.push({ p: new THREE.Vector3(x, 0, z) });
      this.marks.push({ p: new THREE.Vector3(x, HEIGHT + 0.75, CROWD_Z), pad: 0.04 });
    }
  }

  private buildPatio(): void {
    const s = this.scene;
    // The garden at dusk: lawn, fence, hedges and trees from the kit; a stone patio under the race.
    this.env = backyard(s, { mood: 'evening', w: 19, d: 12.4, patio: { w: 15.2, d: 9 }, clear: { w: 15.6, d: 9.4 }, seed: 6 });
    const set = new THREE.Group();
    s.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = 1) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    // A low brick wall behind the fans, with a stone coping and planters along it.
    part(set, box(15.2, 0.46, 0.5), P.brick, 0, 0.23, -4.2, { tex: 'brick', texScale: 1.1, outline: false });
    part(set, rbox(15.5, 0.1, 0.64, 0.03), P.stone, 0, 0.5, -4.2, { tex: 'stoneTiles', texStrength: 0.6, outline: false });
    const kinds = ['fern', 'monstera', 'snake', 'fern', 'trailing'] as const;
    [-6.2, -3.1, 0.2, 3.3, 6.3].forEach((x, k) => put(props.plant({ kind: kinds[k] as props.PlantKind, h: 0.75 + (k % 2) * 0.2, pot: k % 2 ? P.ceramic : P.terracotta, seed: k + 2 }), x, 0.55, -4.2, k, 1.25));
    put(props.candle({ h: 0.16 }), -4.6, 0.55, -4.15);
    put(props.candle({ h: 0.1 }), -4.4, 0.55, -4.25);
    put(props.candle({ h: 0.14 }), 1.7, 0.55, -4.2);
    // A lantern by the finish, drinks for the spectators, and big soft things in the front corners.
    put(props.gardenLamp({ h: 1.5, light: 7 }), 6.6, 0, -3.3);
    put(props.sideTable({ h: 0.55, r: 0.34 }), -6.9, 0, -3.1);
    put(props.drink({ kind: 'bottle', color: P.forest }), -7.0, 0.55, -3.15);
    put(props.snackBowl({ fill: 'crisps', r: 0.16 }), -6.8, 0.55, -3.0);
    put(props.stool({ h: 0.45, seat: P.mustard }), -6.1, 0, -3.3);
    put(props.bush({ r: 0.7, flowers: P.rose, seed: 3 }), -6.9, 0, 3.1);
    put(props.rock({ r: 0.3, seed: 4 }), -5.9, 0, 3.3);
    put(props.plant({ kind: 'palm', h: 1.4, pot: P.terracotta, seed: 8 }), 7.4, 0, 2.7, 0.4, 1.2);
    put(props.crate({ s: 0.5 }), 6.4, 0, 3.2, 0.3);
    put(props.plant({ kind: 'fern', h: 0.55, pot: P.ceramic }), 6.4, 0.5, 3.2);
    // A picnic blanket for whoever is only here for the snacks, and candles along the front of the patio.
    put(props.blanket({ w: 1.5, d: 1.9, color: P.cream, tex: 'gingham', stripes: P.terracotta }), 3.6, 0.04, 3.05, 1.45);
    put(props.snackBowl({ fill: 'fruit', r: 0.17 }), 3.3, 0.07, 3.0);
    put(props.drink({ kind: 'can', color: P.teal }), 3.95, 0.07, 2.85, 0, 1.3);
    put(props.drink({ kind: 'bottle', color: P.mustard }), 4.1, 0.07, 3.2, 0, 1.3);
    [-4.3, -2.6, -0.9, 1.4].forEach((x, k) => put(props.candle({ h: 0.1 + (k % 2) * 0.06 }), x, 0.04, 2.95 + (k % 2) * 0.2, 0, 1.6));
    this.tick = props.tickProps(set);

    // The track: a long board laid on the flagstones, with painted lanes, a start line and a chequered finish.
    const chalk = { outline: false as const, shadow: false, opacity: 0.8 };
    const lo = (LANE_Z[0] as number) - 0.52;
    const hi = (LANE_Z[LANE_Z.length - 1] as number) + 0.52;
    part(s, rbox(SNAIL.length + 2.6, 0.06, hi - lo + 0.5, 0.02), mix(P.oak, P.sand, 0.35), 0.15, 0.012, (lo + hi) / 2, { tex: 'planks', texScale: 1.6, outline: 0.02, shadow: false });
    for (let k = 0; k <= SNAILS.length; k++) {
      const z = lo + (k * (hi - lo)) / SNAILS.length;
      part(s, box(SNAIL.length + 1.4, 0.012, 0.035), P.cream, 0.2, 0.042, z, chalk);
    }
    part(s, box(0.08, 0.012, hi - lo), P.cream, START, 0.043, (lo + hi) / 2, chalk);
    const rows = 10;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 2; c++) {
        const z = lo + ((r + 0.5) * (hi - lo)) / rows;
        part(s, box(0.2, 0.014, (hi - lo) / rows), (r + c) % 2 ? P.ink : P.cream, -START + 0.1 + c * 0.2, 0.044, z, { outline: false, shadow: false });
      }
    }
    // Finish posts with little pennants, and a glowing bulb on top of each.
    for (const z of [lo - 0.15, hi + 0.15]) {
      part(s, cyl(0.03, 0.035, 1.15, 8), P.walnut, -START + 0.2, 0.575, z, { tex: 'wood' });
      part(s, cone(0.16, 0.34, 3), P.terracotta, -START + 0.38, 0.98, z, { rz: -Math.PI / 2, sz: 0.15, tex: 'fabric', outline: false });
      part(s, sphere(0.05, 10), P.lamp, -START + 0.2, 1.19, z, { glow: 2, outline: false, shadow: false });
    }
    // Lettuce at the start, where the snails were fed.
    for (const [x, z, r] of [
      [-0.55, 0.3, 0.5],
      [-0.75, -0.6, 2.1],
      [-0.6, 1.1, 4.0],
    ] as const) {
      part(s, ball(0.13, 1), mix(P.leaf, P.moss, r / 4), START + x, 0.06, z, { sy: 0.2, sx: 1.3, ry: r, outline: false });
    }
  }

  /** A little burst of warm sparks (a snail crossing the line). */
  private burst(x: number, y: number, z: number, color: string, n = 10): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random();
      const m = part(this.scene, gem(0.045), color, x, y, z, { glow: 2, outline: false, shadow: false });
      this.sparks.push({ m, v: new THREE.Vector3(Math.cos(a) * (0.6 + Math.random()), 1.6 + Math.random() * 1.2, Math.sin(a) * (0.6 + Math.random())), age: 0 });
    }
  }

  /** A seat's pick, shown over their companion; and every snail's backers on its card. */
  showBets(bets: (number | null)[]): void {
    this.fans.forEach((f, i) => {
      if (f.pick) dropSprite(f.pick);
      f.pick = null;
      const b = bets[i];
      const snail = b == null ? undefined : SNAILS[b];
      if (!snail) return;
      f.pick = nameCard(snail.name, snail.shell, 0.7);
      this.scene.add(f.pick);
    });
    this.snails.forEach((s, k) => {
      dropSprite(s.card);
      const backers = bets.map((b, i) => (b === k ? (this.seats[i]?.color ?? '#fff') : null)).filter((c): c is string => c !== null);
      s.card = snailCard(SNAILS[k]?.name ?? '', SNAILS[k]?.shell ?? '#fff', backers);
      this.scene.add(s.card);
    });
  }

  /** A little "Go!" over a snail in the cheering seat's colour (words are drawn once per colour and shared). */
  cheer(seat: number, snail: number): void {
    const fan = this.fans[seat];
    const s = this.snails[snail];
    if (!fan || !s || this.time - fan.cheerAt < 0.28) return;
    fan.cheerAt = this.time;
    const color = this.seats[seat]?.color ?? '#ffffff';
    let base = this.goWords.get(color);
    if (!base) {
      base = popSprite('Go!', color, 0.32);
      this.goWords.set(color, base);
    }
    const sprite = new THREE.Sprite(base.material.clone());
    sprite.scale.copy(base.scale);
    sprite.renderOrder = base.renderOrder;
    sprite.position.set(s.root.position.x + (Math.random() - 0.5) * 0.5, 0.9 + Math.random() * 0.2, s.root.position.z + 0.2);
    this.scene.add(sprite);
    this.cheers.push({ sprite, age: 0 });
    fan.c.react('approval', 0.7);
  }

  finish(snail: number, place: number): void {
    const s = this.snails[snail];
    if (!s) return;
    s.hop = 1;
    this.burst(s.root.position.x + 0.2, 0.5, s.root.position.z, place === 0 ? P.lamp : P.moon, place === 0 ? 16 : 8);
    const word = popSprite(ORDINALS[place] ?? '', place === 0 ? P.lamp : P.cream, 0.45);
    word.position.set(s.root.position.x + 0.3, 1.25, s.root.position.z);
    this.scene.add(word);
    s.place = word;
  }

  /** Puts snails and fans where the race says, `bets` deciding who walks beside which snail. */
  sync(race: Race, bets: (number | null)[], dt: number, racing: boolean): void {
    race.snails.forEach((sn, k) => {
      const rig = this.snails[k];
      if (!rig) return;
      rig.root.position.x = START + sn.x;
      rig.trail.visible = sn.x > 0.3;
      rig.trail.scale.x = Math.max(0.01, sn.x - 0.25);
      rig.trail.position.x = START + (sn.x - 0.25) / 2 - 0.1;
      const tucked = sn.pausing === 'tuck';
      rig.tuck += ((tucked ? 1 : 0) - rig.tuck) * Math.min(1, dt * 10);
      const b = Math.max(0.05, 1 - rig.tuck);
      rig.body.scale.set(b, b, b);
      rig.body.position.x = -0.25 * rig.tuck;
      rig.shell.rotation.z = tucked ? Math.sin(this.time * 9 + k) * 0.08 : sn.speed * Math.sin(this.time * 5 + k) * 0.08;
      if (sn.pausing === 'snack') {
        if (!rig.leaf.visible) rig.pauseFull = Math.max(0.1, sn.pauseLeft);
        rig.leaf.visible = true;
        rig.leaf.scale.setScalar(Math.max(0.2, sn.pauseLeft / rig.pauseFull));
        rig.head.rotation.z = -0.25 + Math.sin(this.time * 14) * 0.12;
      } else {
        rig.leaf.visible = false;
        rig.head.rotation.z = Math.sin(this.time * 3 + k) * 0.05;
        const stretch = sn.finishedAt === null && racing ? Math.sin(this.time * 6 + k) * 0.05 * (0.5 + sn.speed) : 0;
        rig.body.scale.x = b * (1 + stretch);
      }
      rig.root.position.y = Math.abs(Math.sin(rig.hop * Math.PI * 3)) * 0.25 * rig.hop;
      rig.card.position.set(rig.root.position.x, 1.0, rig.root.position.z);
      if (rig.place) rig.place.position.x = rig.root.position.x + 0.3;
    });
    // Fans stroll along behind the track, level with their snail; several on one snail stand side by side.
    const xs = lanes(this.fans.length, 1.6);
    this.fans.forEach((f, i) => {
      const bet = bets[i];
      const with_ = bets.map((b, j) => (b === bet ? j : -1)).filter((j) => j >= 0);
      const slot = with_.indexOf(i);
      const sn = bet == null ? undefined : race.snails[bet];
      const target = racing && sn ? Math.min(SNAIL.length / 2 + 0.6, Math.max(-SNAIL.length / 2 - 0.6, START + sn.x - 0.2 + (slot - (with_.length - 1) / 2) * 0.62)) : (xs[i] as number);
      const root = f.c.root;
      const dx = target - root.position.x;
      const step = Math.sign(dx) * Math.min(Math.abs(dx), dt * 2.5);
      root.position.x += step;
      const moving = Math.abs(dx) > 0.05;
      root.rotation.y += ((moving ? Math.sign(dx) * 1.2 : 0) - root.rotation.y) * Math.min(1, dt * 6);
      const motion = moving ? 'walk' : null;
      if (motion !== f.motion) {
        f.motion = motion;
        f.c.move(motion, 1.2);
      }
      f.ring.position.x = root.position.x;
      if (f.pick) f.pick.position.set(root.position.x, HEIGHT + 0.55, CROWD_Z);
    });
  }

  setMood(seat: number, mood: CompanionMood, react = false): void {
    const f = this.fans[seat];
    if (!f) return;
    if (react) f.c.react(mood, 2.5);
    if (f.mood === mood) return;
    f.mood = mood;
    f.c.setBase(mood);
  }

  dispose(): void {
    for (const f of this.fans) {
      f.c.dispose();
      if (f.pick) dropSprite(f.pick);
    }
    for (const s of this.snails) {
      dropSprite(s.card);
      if (s.place) dropSprite(s.place);
    }
    for (const c of this.cheers) c.sprite.material.dispose();
    for (const k of this.sparks) k.m.removeFromParent();
    for (const w of this.goWords.values()) {
      w.material.map?.dispose();
      w.material.dispose();
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks);
    for (const f of this.fans) f.c.update(dt);
    for (const s of this.snails) s.hop = Math.max(0, s.hop - dt * 0.9);
    this.env.update(dt, this.time);
    this.tick(dt, this.time);
    this.sparks = this.sparks.filter((k) => {
      k.age += dt;
      k.v.y -= dt * 5;
      k.m.position.addScaledVector(k.v, dt);
      k.m.rotation.y += dt * 6;
      k.m.scale.setScalar(Math.max(0.01, 1 - k.age / 0.8));
      if (k.age < 0.8 && k.m.position.y > 0.03) return true;
      k.m.removeFromParent();
      return false;
    });
    this.cheers = this.cheers.filter((c) => {
      c.age += dt;
      c.sprite.position.y += dt * 0.8;
      c.sprite.material.opacity = Math.min(1, 3 * (1 - c.age / 0.8));
      if (c.age < 0.8) return true;
      c.sprite.removeFromParent();
      c.sprite.material.dispose();
      return false;
    });
  }
}

export const minigame: Minigame = {
  id: 'snailrace',
  title: 'Snail Bets',
  how: 'Pick a snail, then tap to cheer it on: everyone backing the same snail cheers together. 4 points if your snail wins, 2 for second, 1 for third, and 1 more for the loudest fan.',
  controller: 'buttons',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const pos = new Map(seats.map((s, i) => [s.index, i] as const));
    const race = newRace(rng, n);
    const fans: SnailFan[] = seats.map(() => newFan(rng, ctx.skill()));
    const view = new Patio(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    const cpu = (i: number) => session.isCpu(seats[i]?.index ?? i);
    const send = (i: number, msg: Parameters<typeof session.send>[1]) => session.send(seats[i]?.index ?? i, msg);
    const name = (k: number | null | undefined) => (k == null ? '' : (SNAILS[k]?.name ?? ''));

    // 1. Bets.
    let phase: 'bet' | 'race' | 'done' = 'bet';
    let betsChanged = true;
    const bet = (i: number, k: number) => {
      if (!placeBet(race, i, k)) return;
      betsChanged = true;
      sfx.tick();
      view.setMood(i, 'approval', true);
      if (!cpu(i)) send(i, { t: 'feedback', good: true, text: `Backing ${name(k)}!` });
    };
    const taps = seats.map(() => 0);
    let pipAt = 0;
    const off = session.onInput((seat, msg) => {
      const i = pos.get(seat);
      if (i === undefined || cpu(i)) return;
      if (phase === 'bet' && msg.t === 'press') bet(i, msg.index);
      if (phase === 'race' && msg.t === 'tap') taps[i] = (taps[i] ?? 0) + 1;
    });
    session.setLayoutAll(() => ({
      kind: 'buttons',
      title: 'Pick a snail',
      buttons: SNAILS.map((s) => ({ label: s.name, color: s.shell })),
      note: 'You can change your mind until the race starts.',
    }));
    ui.caption('Pick a snail on your phone!');
    const live = (value: (i: number) => string) => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: value(i) })));
    await everyFrame(clock, (dt, t) => {
      seats.forEach((_, i) => {
        const f = fans[i] as SnailFan;
        if (cpu(i) && race.bets[i] !== f.pick && t >= f.betAt) bet(i, f.pick);
      });
      if (betsChanged) {
        betsChanged = false;
        view.showBets(race.bets);
        live((i) => (race.bets[i] == null ? 'Picking…' : name(race.bets[i])));
      }
      view.sync(race, race.bets, dt, false);
      ui.timer(SNAIL.bet - t);
      return t >= SNAIL.bet;
    });
    const forgot = fillBets(race, rng);
    for (const i of forgot) send(i, { t: 'feedback', good: true, text: `You're backing ${name(race.bets[i])}!` });
    view.showBets(race.bets);
    ui.timer(null);

    // 2. Ready, steady…
    seats.forEach((s, i) => session.setLayout(s.index, { kind: 'tap', locked: true, note: `You're backing ${name(race.bets[i])}. Get ready to cheer!` }));
    ui.caption('On your marks…');
    seats.forEach((_, i) => view.setMood(i, 'listening'));
    await clock.wait(1.2);

    // 3. The race.
    phase = 'race';
    sfx.go();
    seats.forEach((s, i) => session.setLayout(s.index, { kind: 'tap', locked: false, note: `Tap to cheer for ${name(race.bets[i])}!` }));
    ui.caption('Cheer your snail on: tap tap tap!');
    seats.forEach((_, i) => view.setMood(i, 'happy'));
    let finished = 0;
    let hudAt = -1;
    await everyFrame(clock, (dt) => {
      // Taps from phones (spread over the frame), and the computer fans' taps.
      seats.forEach((_, i) => {
        const count = cpu(i) ? fanTaps(fans[i] as SnailFan, race.time, dt, rng) : (taps[i] ?? 0);
        taps[i] = 0;
        for (let k = 0; k < count; k++) {
          if (!cheer(race, i, race.time - dt + ((k + 1) * dt) / count)) continue;
          const sn = race.bets[i] ?? 0;
          view.cheer(i, sn);
          if (race.time - pipAt > 0.09) {
            pipAt = race.time;
            pip(sfx, sn);
          }
        }
      });
      const ev = stepRace(race, dt);
      for (const p of ev.paused) {
        if (p.kind === 'snack') munch(sfx);
        else bloop(sfx, false);
        race.bets.forEach((b, i) => {
          if (b === p.snail) send(i, { t: 'feedback', good: false, text: p.kind === 'snack' ? `${name(b)} stopped for a snack! Cheer to hurry it up.` : `${name(b)} tucked into its shell! Cheer to coax it out.` });
        });
      }
      if (ev.resumed.length) bloop(sfx, true);
      for (const k of ev.finished) {
        const place = finished++;
        view.finish(k, place);
        sfx.ring(place === 0);
        race.bets.forEach((b, i) => {
          if (b !== k) return;
          session.setLayout(seats[i]?.index ?? i, { kind: 'tap', locked: true, note: `${name(k)} came ${ORDINALS[place]}!` });
          send(i, { t: 'buzz', pattern: place === 0 ? [30, 40, 30, 40, 120] : [40] });
          view.setMood(i, place === 0 ? 'happy' : 'approval', true);
        });
        ui.caption(place === 0 ? `${name(k)} wins!` : `${name(k)} comes ${ORDINALS[place]}!`, SNAILS[k]?.shell);
      }
      view.sync(race, race.bets, dt, true);
      if (race.time - hudAt > 0.2) {
        hudAt = race.time;
        ui.timer(SNAIL.race - race.time);
        live((i) => `${name(race.bets[i])} · ${race.cheers[i] ?? 0}`);
      }
      return raceOver(race);
    });
    phase = 'done';
    off();
    ui.timer(null);

    // 4. Where everyone's snail came.
    const place = placings(race);
    const scores = snailScores(race);
    const most = Math.max(0, ...race.cheers);
    seats.forEach((s, i) => {
      const k = race.bets[i] ?? 0;
      const p = place[k] ?? 3;
      session.setLayout(s.index, { kind: 'tap', locked: true, note: `${name(k)} came ${ORDINALS[p]}!` });
      view.setMood(i, p === 0 ? 'happy' : p >= 2 ? 'sad' : 'approval');
    });
    const winner = place.indexOf(0);
    ui.caption(`${name(winner)} takes it!${most > 0 ? ' Loudest fan gets a bonus point.' : ''}`, SNAILS[winner]?.shell);
    await clock.wait(2.2);
    ui.caption(null);

    return {
      scores,
      details: seats.map((_, i) => {
        const k = race.bets[i] ?? 0;
        const cheers = race.cheers[i] ?? 0;
        return `${name(k)} came ${ORDINALS[place[k] ?? 3]} · ${cheers} cheer${cheers === 1 ? '' : 's'}${most > 0 && cheers === most ? ' (loudest)' : ''}`;
      }),
    };
  },
};
