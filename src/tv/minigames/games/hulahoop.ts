// Hula Hoop Party on the TV: a back garden at night, fairy lights strung along the fence, a boombox playing
// something mellow and a table of snacks. Everyone has hoops going round their waist; each team stands on its own
// rug with a little chalkboard keeping its hoop-seconds.
import * as THREE from 'three';
import {
  HOOP,
  type CpuHooper,
  type HoopEvent,
  type Hooper,
  cpuHoop,
  hoopDetail,
  hoopScores,
  newCpuHooper,
  newHooper,
  spinning,
  stepHooper,
  teamHoopSeconds,
} from '../../../game/minigames/hulahoop';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { FONT, PALETTE as P, canvasTexture, cyl, gem, mix, part, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.45; // companions
const WAIST = HEIGHT * 0.33;
const HOOP_R = 0.5;
const ECC = 0.17; // how far a hoop's middle swings off the body's
const SPREAD = 1.25; // partners stand this far either side of their team's middle
const SIDE = 3.0; // each team's middle, left and right of the garden's
const TILT = 0.24; // the camera looks down this much (radians)
const ARC_STEPS = 24;
const HOOP_TINTS = [P.cream, P.mustard, P.moon, P.rose, P.sage];
const BULBS = [P.lamp, mix(P.ember, P.lamp, 0.4), P.cream, P.moon, P.rose];
const BEAT = 0.68; // seconds: the boombox's beat (the game plays the sounds)

// ------------------------------------------------------------------ sounds

const chime = (sfx: Sfx, n: number) => {
  tone(sfx, { freq: 560 + n * 70, to: 880 + n * 90, dur: 0.16, type: 'triangle', gain: 0.1 });
  tone(sfx, { freq: 1100 + n * 120, dur: 0.12, gain: 0.05, delay: 0.08 });
};
const clatter = (sfx: Sfx) => {
  noise(sfx, { dur: 0.22, filter: 'bandpass', freq: 900, to: 300, gain: 0.22 });
  tone(sfx, { freq: 330, to: 140, dur: 0.3, type: 'triangle', gain: 0.08 });
};
const woozy = (sfx: Sfx) => {
  tone(sfx, { freq: 740, to: 280, dur: 0.5, gain: 0.08 });
  tone(sfx, { freq: 680, to: 250, dur: 0.5, gain: 0.06, delay: 0.12, type: 'triangle' });
};
/** The boombox, very quietly: a soft kick on the beat and a hat between. */
const beat = (sfx: Sfx, n: number) => {
  if (n % 2 === 0) tone(sfx, { freq: 110, to: 48, dur: 0.16, gain: 0.07 });
  else noise(sfx, { dur: 0.05, filter: 'highpass', freq: 6500, gain: 0.025 });
  if (n % 8 === 0) tone(sfx, { freq: 220, dur: 0.9, type: 'triangle', gain: 0.025 });
  if (n % 8 === 4) tone(sfx, { freq: 196, dur: 0.9, type: 'triangle', gain: 0.025 });
};

// ------------------------------------------------------------------ the view

interface Dancer {
  companion: Companion;
  name: string;
  x: number;
  color: string;
  hoops: THREE.Mesh[];
  angles: number[];
  /** Per hoop: how much faster or slower than the hips, and how much it tilts. */
  mul: number[];
  tilt: number[];
  arc: THREE.Mesh;
  badge: THREE.Sprite;
  badgeKey: string;
  stars: THREE.Group;
  mood: CompanionMood | null;
  lift: number;
  sway: number;
  wobble: number;
  /** Seconds left of seeing stars. */
  woozy: number;
  /** Hoops shown last frame, and the pop of a hoop just earned (1 → 0). */
  shown: number;
  pop: number;
}

interface Loose {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  roll: number;
  age: number;
  flat: boolean;
}

interface Board {
  x: number;
  color: string;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  shown: number;
}

/** The badge over a dancer: a dark pill with their name and a row of hoops. */
function drawBadge(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, color: string, hoops: number, state: 'ok' | 'down' | 'dizzy'): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(30,24,38,0.88)';
  ctx.beginPath();
  ctx.roundRect(8, 8, w - 16, h - 16, 46);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(54, 50, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.font = `700 40px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2, 50, w - 150);
  if (state === 'down') {
    ctx.fillStyle = 'rgba(241,231,214,0.62)';
    ctx.font = `600 32px ${FONT}`;
    ctx.fillText('Picking up…', w / 2, 112);
    return;
  }
  const r = 17;
  const gap = 50;
  const left = w / 2 - ((HOOP.max - 1) * gap) / 2;
  for (let k = 0; k < HOOP.max; k++) {
    ctx.beginPath();
    ctx.arc(left + k * gap, 112, r, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = k < hoops ? (state === 'dizzy' ? '#c9a6ff' : color) : 'rgba(255,255,255,0.16)';
    ctx.stroke();
  }
}

/** A team's chalkboard: a wooden frame, dark green slate, the number in chalk. */
function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, value: number, color: string): void {
  ctx.fillStyle = P.walnut;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 22);
  ctx.fill();
  const slate = ctx.createLinearGradient(0, 0, w, h);
  slate.addColorStop(0, '#2c4a3c');
  slate.addColorStop(1, '#1f382d');
  ctx.fillStyle = slate;
  ctx.beginPath();
  ctx.roundRect(16, 16, w - 32, h - 32, 12);
  ctx.fill();
  // Chalk dust, wiped.
  ctx.strokeStyle = 'rgba(241,231,214,0.05)';
  ctx.lineWidth = 26;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(60 + k * 40, 70 + k * 62);
    ctx.lineTo(w - 90 - k * 30, 60 + k * 66);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(52, 52, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 118px ${FONT}`;
  ctx.fillText(String(value), w / 2, h / 2 - 8);
  ctx.font = `600 30px ${FONT}`;
  ctx.fillStyle = 'rgba(241,231,214,0.7)';
  ctx.fillText('hoop-seconds', w / 2, h - 46);
}

class Garden implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  /** By seat position. */
  readonly dancers: (Dancer | undefined)[] = [];
  readonly floaters: Floaters;
  private readonly boards: Board[] = [];
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly lanterns: THREE.Group[] = [];
  private readonly woofers: THREE.Mesh[] = [];
  private readonly env: Env;
  private tick: (dt: number, time: number) => void = () => {};
  private loose: Loose[] = [];
  private readonly boombox = new THREE.Vector3(-5.5, 0, -2.1);
  private time = 0;

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    private readonly companions: Companion[],
  ) {
    this.floaters = new Floaters(this.scene);
    this.env = this.yard();

    teams.forEach((members, team) => {
      const cx = teams.length > 1 ? (team === 0 ? -SIDE : SIDE) : 0;
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      // The team's rug (their colour, deepened; the trim carries it at full strength), and its chalkboard on an easel.
      part(this.scene, cyl(1, 1, 0.04, 48), mix(color, P.aubergine, 0.62), cx, 0.02, 0, { sx: 2.5, sz: 1.35, tex: 'terry', outline: false });
      part(this.scene, torus(1, 0.03), mix(color, P.cream, 0.1), cx, 0.045, 0, { rx: Math.PI / 2, sx: 2.3, sy: 1.2, outline: false, shadow: false });
      part(this.scene, torus(1, 0.012), mix(color, P.cream, 0.45), cx, 0.045, 0, { rx: Math.PI / 2, sx: 2.12, sy: 1.08, outline: false, shadow: false });
      for (const s of [-1, 1]) part(this.scene, cyl(0.035, 0.035, 2.1, 8), P.walnut, cx + s * 0.5, 1.05, -1.45, { rz: s * -0.06, tex: 'wood', outline: 0.015 });
      part(this.scene, cyl(0.03, 0.03, 2.0, 8), P.walnut, cx, 1.0, -1.75, { rx: -0.3, tex: 'wood', outline: false });
      part(this.scene, rbox(1.1, 0.05, 0.1, 0.015), P.walnut, cx, 1.62, -1.4, { tex: 'wood', outline: false });
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 288;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const board: Board = { x: cx, color, texture, canvas, shown: -1 };
      const mat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.73), mat);
      plane.position.set(cx, 2.02, -1.38);
      plane.rotation.x = -0.05;
      this.scene.add(plane);
      this.owned.push(texture, mat, plane.geometry);
      this.boards.push(board);
      this.drawBoard(board, 0);
      this.marks.push({ p: new THREE.Vector3(cx - 0.7, 2.45, -1.38) }, { p: new THREE.Vector3(cx + 0.7, 2.45, -1.38) });

      members.forEach((p, m) => {
        const seat = seats[p];
        const c = companions[p];
        if (!seat || !c) return;
        const x = cx + (members.length > 1 ? (m === 0 ? -1 : 1) * SPREAD : 0);
        c.root.position.set(x, 0, 0);
        c.setBase('listening');
        this.scene.add(c.root);
        // A faint ring at the feet, and an arc that fills towards the next hoop.
        part(this.scene, torus(0.62, 0.025), mix(seat.color, '#ffffff', 0.4), x, 0.05, 0, { rx: Math.PI / 2, opacity: 0.45, outline: false, shadow: false });
        const arc = part(this.scene, torus(0.62, 0.05, 0.01), seat.color, x, 0.06, 0, { rx: -Math.PI / 2, rz: Math.PI / 2, glow: 1, outline: false, shadow: false });
        const rand = seeded(17 + p * 13);
        const hoops: THREE.Mesh[] = [];
        for (let k = 0; k < HOOP.max; k++) {
          const tint = k === 0 ? seat.color : mix(seat.color, HOOP_TINTS[k % HOOP_TINTS.length] as string, 0.45 + rand() * 0.2);
          const h = part(this.scene, torus(HOOP_R, 0.034), tint, x, WAIST, 0, { rx: Math.PI / 2, outline: 0.014, gloss: 0.55 });
          h.visible = k === 0;
          hoops.push(h);
        }
        const stars = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          part(stars, gem(0.08), P.lamp, Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32, { glow: 1.6, shadow: false });
        }
        stars.position.set(x, HEIGHT + 0.12, 0);
        stars.visible = false;
        this.scene.add(stars);
        const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(512, 160, () => {}), transparent: true, depthWrite: false }));
        badge.scale.set(1.25, 0.39, 1);
        badge.position.set(x, HEIGHT + 0.55, 0.1);
        badge.renderOrder = 5;
        this.scene.add(badge);
        this.dancers[p] = {
          companion: c,
          name: seat.name,
          x,
          color: seat.color,
          hoops,
          angles: hoops.map(() => rand() * Math.PI * 2),
          mul: hoops.map((_, k) => 1 + (k === 0 ? 0 : (rand() - 0.35) * 0.22)),
          tilt: hoops.map((_, k) => 0.06 + k * 0.025 + rand() * 0.04),
          arc,
          badge,
          badgeKey: '',
          stars,
          mood: null,
          lift: 1,
          sway: 0,
          wobble: rand() * 10,
          woozy: 0,
          shown: 1,
          pop: 0,
        };
        for (const s of [-1, 1]) this.marks.push({ p: new THREE.Vector3(x + s * (HOOP_R + ECC + 0.15), 0, 0.7) }, { p: new THREE.Vector3(x + s * 0.65, HEIGHT + 0.78, 0.1) });
      });
    });
  }

  /** The garden at night: lawn and fences, fairy lights and paper lanterns, a boombox, the snack table. */
  private yard(): Env {
    const s = this.scene;
    const env = backyard(s, { mood: 'night', w: 21, d: 9.6, clear: { w: 14.5, d: 5.4 }, lights: false, seed: 5 });
    env.sun.target.position.set(0, 0, 0);
    env.sun.intensity *= 1.25;
    const set = new THREE.Group();
    s.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = 1) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      if (scale !== 1) o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    // Fairy lights: a long string sagging between two tall posts, in front of the fence.
    const high = 4.9;
    for (const x of [-9.6, 9.6]) part(set, cyl(0.05, 0.07, high, 8), P.walnut, x, high / 2, -1.0, { tex: 'planks', outline: false });
    set.add(props.stringLights(new THREE.Vector3(-9.6, high, -1.0), new THREE.Vector3(9.6, high, -1.0), { sag: 0.55, count: 34, colors: BULBS, bulb: 0.06 }));
    // Paper lanterns hanging from it; three of them light the dancers.
    const lantern = (x: number, y: number, z: number, color: string, light: number) => {
      const g = new THREE.Group();
      part(g, sphere(0.3, 20), color, 0, -0.9, 0, { glow: light > 0 ? 0.5 : 0.8, sy: 1.12, outline: false, shadow: false });
      for (const a of [0, 1, 2, 3]) part(g, torus(0.3, 0.006), mix(color, P.ink, 0.35), 0, -0.9, 0, { ry: (a * Math.PI) / 4, sy: 1.12, outline: false, shadow: false });
      for (const dy of [-0.56, -1.24]) part(g, cyl(0.11, 0.11, 0.05, 12), P.charcoal, 0, dy, 0, { outline: false, shadow: false });
      part(g, cyl(0.006, 0.006, 0.56, 4), P.ink, 0, -0.28, 0, { outline: false, shadow: false });
      if (light > 0) {
        const l = new THREE.PointLight(color, light, 11, 1.5);
        l.position.set(0, -1.4, 0.3);
        g.add(l);
      }
      g.position.set(x, y, z);
      set.add(g);
      this.lanterns.push(g);
    };
    const warm = mix(P.ember, P.lamp, 0.55);
    lantern(-SIDE, 4.41, -1.0, warm, 13);
    lantern(SIDE, 4.41, -1.0, P.lamp, 13);
    lantern(0, 4.35, -1.0, P.moon, 0);
    lantern(-6.7, 4.62, -1.0, P.rose, 0);
    lantern(6.6, 4.62, -1.0, mix(P.mustard, P.lamp, 0.5), 0);
    // A lamp and a few candles on the lawn between the rugs, so faces catch warm light from the front.
    put(props.gardenLamp({ h: 0.9, light: 9 }), 0, 0, 1.7);
    put(props.candle({ h: 0.14 }), -0.3, 0, 1.95);
    put(props.candle({ h: 0.09 }), 0.28, 0, 2.05);


    // The boombox on an upturned crate.
    const b = this.boombox;
    put(props.crate({ s: 0.68 }), b.x, 0, b.z, 0.2);
    const box = new THREE.Group();
    part(box, rbox(1.12, 0.58, 0.34, 0.08), P.charcoal, 0, 0.29, 0, { tex: 'leather', texStrength: 0.4, outline: 0.02 });
    for (const sx of [-0.3, 0.3]) {
      part(box, cyl(0.19, 0.19, 0.03, 24), P.metal, sx, 0.25, 0.165, { rx: Math.PI / 2, gloss: 0.6, outline: false });
      this.woofers.push(part(box, cyl(0.15, 0.15, 0.04, 24), P.ink, sx, 0.25, 0.175, { rx: Math.PI / 2, outline: false }));
      part(box, sphere(0.05, 10), P.slate, sx, 0.25, 0.19, { sz: 0.5, gloss: 0.6, outline: false });
    }
    part(box, rbox(0.34, 0.09, 0.02, 0.01), P.screen, 0, 0.49, 0.165, { glow: 1.3, outline: false, shadow: false });
    for (const sx of [-0.42, -0.34, 0.34, 0.42]) part(box, cyl(0.022, 0.022, 0.03, 10), P.brass, sx, 0.5, 0.17, { rx: Math.PI / 2, gloss: 0.6, outline: false });
    for (const sx of [-0.4, 0.4]) part(box, cyl(0.015, 0.015, 0.14, 6), P.metal, sx, 0.64, 0, { outline: false });
    part(box, rbox(0.86, 0.04, 0.05, 0.015), P.metal, 0, 0.72, 0, { gloss: 0.6, outline: false });
    put(box, b.x, 0.68, b.z, 0.2);
    put(props.plant({ kind: 'fern', h: 0.55, pot: P.terracotta, seed: 3 }), b.x - 1.0, 0, b.z + 0.2);

    // The snack table: punch, crisps, a cake with one slice gone, bottles.
    const tx = 5.6;
    const tz = -2.2;
    const top = 0.8;
    put(props.table({ w: 1.9, d: 0.9, h: top, color: P.walnut, cloth: P.cream }), tx, 0, tz);
    const punch = new THREE.Group();
    part(punch, cyl(0.3, 0.2, 0.22, 24), P.moon, 0, 0.11, 0, { opacity: 0.55, gloss: 0.7 });
    part(punch, cyl(0.26, 0.26, 0.03, 24), P.rose, 0, 0.17, 0, { outline: false, gloss: 0.6 });
    part(punch, cyl(0.012, 0.012, 0.34, 6), P.brass, 0.12, 0.26, 0, { rz: -0.5, gloss: 0.6, outline: false });
    put(punch, tx - 0.55, top, tz);
    put(props.snackBowl({ fill: 'crisps', color: P.terracotta, r: 0.2 }), tx + 0.02, top, tz + 0.12);
    const cake = new THREE.Group();
    part(cake, cyl(0.3, 0.3, 0.02, 24), P.ceramic, 0, 0.01, 0, { gloss: 0.5, outline: 0.012 });
    part(cake, cyl(0.24, 0.24, 0.2, 24), P.cream, 0, 0.12, 0, { outline: 0.012 });
    part(cake, cyl(0.245, 0.245, 0.05, 24), P.rose, 0, 0.225, 0, { outline: false, gloss: 0.3 });
    for (let k = 0; k < 6; k++) part(cake, sphere(0.028, 8), P.brick, Math.cos(k * 1.05) * 0.17, 0.265, Math.sin(k * 1.05) * 0.17, { gloss: 0.5, outline: false });
    put(cake, tx + 0.6, top, tz - 0.08);
    put(props.drink({ kind: 'bottle', color: P.forest }), tx + 0.3, top, tz - 0.28);
    put(props.drink({ kind: 'bottle', color: P.walnut }), tx + 0.18, top, tz - 0.22);
    put(props.drink({ kind: 'can', color: P.teal }), tx - 0.2, top, tz + 0.3);
    put(props.stool({ h: 0.45, seat: P.mustard }), tx + 1.5, 0, tz + 0.5);

    // Things at the edges and close to the camera: somewhere to flop when the hoops have won.
    put(props.beanbag({ color: P.teal }), 3.5, 0, 3.2, -0.5, 1.3);
    put(props.pouf({ color: P.mustard }), 2.3, 0, 3.7, 0, 1.3);
    put(props.drink({ kind: 'can', color: P.rose }), 2.85, 0, 3.3);
    put(props.bush({ r: 0.9, flowers: P.rose, seed: 4 }), 7.4, 0, 2.6);
    put(props.blanket({ color: P.terracotta, tex: 'gingham', w: 1.9, d: 1.5 }), -4.6, 0, 3.3, 0.3);
    put(props.snackBowl({ fill: 'popcorn', color: P.ceramic, r: 0.19 }), -4.8, 0.03, 3.2);
    put(props.drink({ kind: 'bottle', color: P.forest }), -4.2, 0.03, 3.5);
    put(props.candle({ h: 0.1 }), -4.4, 0.03, 3.0);
    put(props.bush({ r: 0.85, flowers: P.cream, seed: 7 }), -7.2, 0, 2.6);
    put(props.logSeat({ len: 1.6 }), -8.2, 0, -2.6, 0.25);
    put(props.plant({ kind: 'palm', h: 1.5, pot: P.terracotta, seed: 6 }), 8.3, 0, -2.9, 0.4, 1.2);
    this.tick = props.tickProps(set);
    return env;
  }

  private drawBoard(b: Board, value: number): void {
    if (value === b.shown) return;
    b.shown = value;
    const ctx = b.canvas.getContext('2d');
    if (!ctx) return;
    drawBoard(ctx, b.canvas.width, b.canvas.height, value, b.color);
    b.texture.needsUpdate = true;
  }

  setTotal(team: number, total: number): void {
    const b = this.boards[team];
    if (b) this.drawBoard(b, Math.floor(total));
  }

  /** Words over a dancer's head. */
  say(p: number, text: string, color: string): void {
    const d = this.dancers[p];
    if (d) this.floaters.add(text, color, new THREE.Vector3(d.x, HEIGHT + 1.0, 0.3), 0.36, 1.1);
  }

  cheer(team: number, text: string): void {
    const b = this.boards[team];
    if (b) this.floaters.add(text, '#fff6a8', new THREE.Vector3(b.x, 2.8, -1.2), 0.55, 2.4);
  }

  /** Too dizzy: stars for a moment, and a hoop flies off and rolls away across the lawn (k: which one, or null). */
  dizzy(p: number, k: number | null): void {
    const d = this.dancers[p];
    if (!d) return;
    d.woozy = HOOP.dizzyFor;
    const src = k === null ? undefined : d.hoops[k];
    if (!src) return;
    const mesh = part(this.scene, torus(HOOP_R, 0.034), '#ffffff', d.x, WAIST, 0, { material: src.material as THREE.Material, outline: 0.018 });
    const out = d.x === 0 ? 1 : Math.sign(d.x);
    this.loose.push({ mesh, vx: out * (1.6 + Math.random() * 0.8), vy: 2.4, roll: 0, age: 0, flat: false });
  }

  setMood(p: number, mood: CompanionMood): void {
    const d = this.dancers[p];
    if (!d || d.mood === mood) return;
    d.mood = mood;
    d.companion.setBase(mood);
  }

  /** Puts a dancer's hoops (and hips) where the rules say. */
  sync(p: number, h: Hooper, dt: number): void {
    const d = this.dancers[p];
    if (!d) return;
    const down = h.down > 0;
    d.lift += (h.lift - d.lift) * (1 - Math.exp(-10 * dt));
    if (down) d.lift = 0;
    const spin = (0.5 + 2.4 * h.speed) * Math.PI * 2;
    const n = h.hoops;
    // A hoop just earned pops as it joins the others.
    if (n > d.shown && !down) d.pop = 1;
    d.shown = n;
    d.pop = Math.max(0, d.pop - dt * 3.5);
    // Picking up: they lie round the feet, then come back up in the last moment.
    const rise = down ? Math.max(0, Math.min(1, (0.45 - h.down) / 0.45)) : 1;
    const up = down ? rise * rise * (3 - 2 * rise) : Math.pow(Math.max(0, d.lift), 0.75);
    d.hoops.forEach((m, k) => {
      m.visible = k < n;
      if (!m.visible) return;
      const waist = WAIST + (k - (n - 1) / 2) * 0.075;
      const floor = 0.035 + k * 0.035;
      const a = (d.angles[k] ?? 0) + (down ? 0 : spin * (d.mul[k] ?? 1) * dt);
      d.angles[k] = a;
      const ecc = down ? 0.06 + (k % 3) * 0.04 : ECC + (1 - d.lift) * 0.06;
      const ca = down ? k * 2.1 : a;
      m.position.set(d.x + Math.cos(ca) * ecc, floor + (waist - floor) * up, Math.sin(ca) * ecc);
      const tilt = down ? (1 - up) * 0.04 : (d.tilt[k] ?? 0.08) * (1 + (1 - d.lift) * 1.8) + (h.dizzy > 0 ? 0.12 : 0);
      m.rotation.set(Math.PI / 2 + Math.sin(a) * tilt, Math.cos(a) * tilt, 0);
      m.scale.setScalar(k === n - 1 ? 1 + Math.sin(d.pop * Math.PI) * 0.24 : 1);
    });
    // Hips go round with the first hoop (and wobble when dizzy).
    const c = d.companion.root;
    const a0 = d.angles[0] ?? 0;
    const sway = down ? 0 : Math.min(1, h.speed * 2) * (0.6 + 0.4 * d.lift);
    d.sway += (sway - d.sway) * (1 - Math.exp(-6 * dt));
    d.wobble += dt;
    c.position.set(d.x - Math.cos(a0) * 0.05 * d.sway, 0, -Math.sin(a0) * 0.05 * d.sway);
    d.woozy = Math.max(0, d.woozy - dt);
    const seeing = h.dizzy > 0 || d.woozy > 0;
    c.rotation.set(0, Math.sin(a0) * 0.14 * d.sway, seeing ? Math.sin(d.wobble * 7) * 0.1 : Math.cos(a0) * 0.03 * d.sway);
    d.stars.visible = seeing;
    d.stars.rotation.y = this.time * 5;
    // The arc towards the next hoop.
    const k = n >= HOOP.max || down || h.dizzy > 0 ? 0 : Math.round((h.steady / HOOP.earnAfter) * ARC_STEPS);
    d.arc.visible = k > 0;
    if (k > 0) d.arc.geometry = torus(0.62, 0.05, (k / ARC_STEPS) * Math.PI * 2);
    // The badge: name and hoops.
    const state = down ? 'down' : h.dizzy > 0 ? 'dizzy' : 'ok';
    const key = `${n}|${state}`;
    if (key !== d.badgeKey) {
      d.badgeKey = key;
      const tex = d.badge.material.map as THREE.CanvasTexture | null;
      const ctx = (tex?.image as HTMLCanvasElement | undefined)?.getContext('2d');
      if (tex && ctx) {
        drawBadge(ctx, 512, 160, d.name, d.color, n, state);
        tex.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
    for (const d of this.dancers) {
      if (!d) continue;
      d.badge.material.map?.dispose();
      d.badge.material.dispose();
    }
    for (const o of this.owned) o.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.fit.update(() => this.marks);
    for (const c of this.companions) c.update(dt);
    this.floaters.update(dt);
    this.env.update(dt, time);
    this.tick(dt, time);
    // The set breathes: lanterns sway on their cords, the woofers thump with the beat.
    this.lanterns.forEach((l, i) => {
      l.rotation.z = Math.sin(time * 0.7 + i * 1.9) * 0.05;
      l.rotation.x = Math.sin(time * 0.53 + i) * 0.03;
    });
    const kick = Math.max(0, 1 - ((time / BEAT) % 2) * 2.5);
    for (const w of this.woofers) w.scale.set(1 + kick * 0.16, 1, 1 + kick * 0.16);
    this.loose = this.loose.filter((l) => {
      l.age += dt;
      const m = l.mesh;
      if (!l.flat) {
        // Flies off, lands upright and rolls away across the lawn, then wobbles over and lies flat.
        l.vy -= 9 * dt;
        m.position.x += l.vx * dt;
        m.position.y += l.vy * dt;
        if (m.position.y <= HOOP_R) {
          m.position.y = HOOP_R;
          l.vy = 0;
          l.vx *= Math.exp(-1.2 * dt);
        }
        l.roll += (l.vx / HOOP_R) * dt;
        const lean = Math.min(Math.PI / 2, Math.max(0, l.age - 1.1) * 2.2);
        m.rotation.set(lean, 0, -l.roll);
        if (lean > 0) m.position.y = Math.max(0.04, HOOP_R * Math.cos(lean));
        if (lean >= Math.PI / 2) {
          l.flat = true;
          l.age = 0;
          m.position.y = 0.04;
        }
        return true;
      }
      if (l.age < 1.2) return true;
      m.scale.setScalar(Math.max(0.01, 1 - (l.age - 1.2) * 2.5));
      if (l.age < 1.6) return true;
      m.removeFromParent();
      return false;
    });
  }

  /** Music notes drifting up from the boombox. */
  note(color: string): void {
    this.floaters.add('♪', color, new THREE.Vector3(this.boombox.x + (Math.random() - 0.5) * 0.6, 1.5, this.boombox.z + 0.3), 0.32, 1.8);
  }
}

// ------------------------------------------------------------------ the game

const TOASTS: Record<HoopEvent, { good: boolean; text: string } | null> = {
  hoop: null,
  sinking: { good: false, text: 'Faster! Your hoops are slipping.' },
  drop: { good: false, text: 'Dropped them! Picking them up…' },
  up: { good: true, text: 'Back up! Keep them going.' },
  warn: { good: false, text: 'Easy… your head’s starting to spin.' },
  dizzy: { good: false, text: 'Too dizzy! A hoop flew off.' },
  steady: { good: true, text: 'Steady again. Keep circling!' },
};

export const minigame: Minigame = {
  id: 'hulahoop',
  title: 'Hula Hoop Party',
  how: 'Circle your phone to keep your hula hoop spinning: a steady pace earns more hoops (up to five), too slow and they drop, too fast and you get dizzy. Your team scores every second for every hoop still going!',
  controller: 'spin',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const skill = seats.map((_, p) => (cpu(p) ? ctx.skill() : 0.5));
    const view = new Garden(seats, teams, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);

    const hoopers = seats.map(() => newHooper());
    const cpus: CpuHooper[] = seats.map((_, p) => newCpuHooper(skill[p] ?? 0.5, rng));
    const speed = seats.map(() => 0);
    hoopers.forEach((h, p) => view.sync(p, h, 0));
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const teamOf = new Map<number, number>();
    teams.forEach((t, k) => t.forEach((p) => teamOf.set(p, k)));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const partnerOf = (p: number) => teams[teamOf.get(p) ?? -1]?.find((q) => q !== p);
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });

    seats.forEach((s, p) => {
      const partner = partnerOf(p);
      const team = partner === undefined ? 'Your hoops count for your team.' : `You’re with ${nameOf(partner)}: your hoops add up.`;
      session.setLayout(s.index, { kind: 'spin', note: `${team} Circle steadily for more hoops. Too slow and they drop, too fast and you get dizzy!` });
    });
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'spin' || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p !== undefined) speed[p] = msg.speed;
    });

    ui.caption('Circle your phone steadily to keep your hoops up. Steady earns more!');
    let hudAt = -1;
    let beatN = -1;
    const toastAt = seats.map(() => -10);
    await everyFrame(clock, (dt, t) => {
      // The boombox keeps a slow beat; a note floats up now and then.
      const n = Math.floor(t / 0.68);
      if (n !== beatN) {
        beatN = n;
        beat(sfx, n);
        if (n % 4 === 0) view.note(['#ffd166', '#9be3ff', '#ffb3d9'][(n / 4) % 3] as string);
      }
      hoopers.forEach((h, p) => {
        const input = cpu(p) ? cpuHoop(cpus[p] as CpuHooper, h, skill[p] ?? 0.5, rng, Math.min(dt, 0.25)) : (speed[p] ?? 0);
        const before = h.hoops;
        for (const e of stepHooper(h, input, dt)) {
          if (e === 'hoop') {
            chime(sfx, h.hoops);
            view.say(p, `${h.hoops} hoops!`, seats[p]?.color ?? '#ffffff');
            view.dancers[p]?.companion.react('happy', 1);
            tell(p, true, h.hoops >= HOOP.max ? 'Five hoops! Now keep them all going.' : `Another hoop! That’s ${h.hoops}.`);
            buzz(p, [12]);
          } else if (e === 'drop') {
            clatter(sfx);
            view.dancers[p]?.companion.react('sad', 1.2);
            buzz(p, [80, 50, 80]);
          } else if (e === 'dizzy') {
            woozy(sfx);
            view.dizzy(p, h.down === 0 ? before - 1 : null);
            if (h.down > 0) clatter(sfx);
            view.say(p, 'Dizzy!', '#e0c8ff');
            buzz(p, [60, 40, 60]);
          }
          const toast = TOASTS[e];
          // Don't bury the phone in messages: the important ones always, the rest at most every 1.5 s.
          if (toast && (e === 'drop' || e === 'dizzy' || t - (toastAt[p] ?? -10) > 1.5)) {
            toastAt[p] = t;
            tell(p, toast.good, toast.text);
          }
        }
        view.setMood(p, h.down > 0 ? 'working' : h.dizzy > 0 ? 'sad' : h.lift < 0.75 ? 'thinking' : h.hoops >= 3 ? 'happy' : 'listening');
        view.sync(p, h, dt);
      });
      teams.forEach((members, k) => view.setTotal(k, teamHoopSeconds(hoopers, members)));
      if (t - hudAt >= 0.1) {
        hudAt = t;
        ui.timer(HOOP.duration - t);
        ui.live(
          teams.map((members) => {
            const lead = seats[members[0] ?? 0];
            const counts = members.map((p) => spinning(hoopers[p] ?? newHooper())).join(' + ');
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${Math.floor(teamHoopSeconds(hoopers, members))} · ${counts} hoops` };
          }),
        );
      }
      return t >= HOOP.duration;
    });
    off();
    ui.timer(null);
    ui.caption(null);

    // Time! The team with the most hoop-seconds cheers.
    const totals = teams.map((members) => teamHoopSeconds(hoopers, members));
    const best = Math.max(...totals);
    const tie = totals.length > 1 && totals.every((v) => v === best);
    sfx.good();
    teams.forEach((members, k) => {
      const won = totals[k] === best;
      for (const p of members) {
        view.setMood(p, tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) view.dancers[p]?.companion.react('happy', 3);
        tell(p, won, tie ? 'Time! Dead level on hoop-seconds.' : won ? 'Time! Your team kept the most hoops going!' : 'Time! Their hoops kept going longer.');
      }
      if (won && !tie) view.cheer(k, 'Hoop heroes!');
    });
    await clock.wait(1.6);

    return {
      scores: hoopScores(hoopers, teams),
      details: seats.map((_, p) => {
        const h = hoopers[p];
        const k = teamOf.get(p);
        return h && k !== undefined ? hoopDetail(h, totals[k] ?? 0) : '';
      }),
    };
  },
};
