// Channel Surf on the TV: a living room late at night, lit mostly by an old telly on a wooden cabinet. One player
// sinks into the armchair with the remote; the others are sunk into the couch, reacting to whatever comes on.
// The picture on the telly is drawn in code on a canvas: four little shows and a fuzz of static.
import * as THREE from 'three';
import {
  CHANNELS,
  SURF,
  type Surf,
  type SwitchResult,
  canSwitch,
  cpuCouch,
  cpuRemote,
  isOver,
  isStatic,
  newCouchBrain,
  newRemoteBrain,
  newSurf,
  react,
  remoteWins,
  stepSurf,
  surfScores,
  switchChannel,
} from '../../../game/minigames/channelsurf';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { FONT, PALETTE as P, box, canvasTexture, cyl, dome, material, mix, nameCard, part, rbox, sphere } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, lanes, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.25; // companion height
const SUNK = HEIGHT * 0.34; // how far everyone sinks into the cushions
const STEP = 1 / 60;
const TILT = 0.42; // how far the camera looks down

// Where things stand. Everything cheats out toward the audience a little, like a stage set.
const TV_AT = new THREE.Vector3(-3.6, 0, -1.6);
const TV_TURN = 0.5;
const TV_SCALE = 1.4; // the telly is the star: a big old set
const COUCH_AT = new THREE.Vector3(2.5, 0, -0.5);
const COUCH_TURN = -0.95;
const CHAIR_AT = new THREE.Vector3(0.1, 0, -3.3);
const CHAIR_TURN = -0.6;
const SEAT_TOP = 0.9;
const ROOM = 1.9; // the room is this much bigger than life (everyone is small on a big couch)

const SW = 512; // the telly's picture, in canvas pixels
const SH = 384;
const DIM = '#c9c1de';

// ------------------------------------------------------------------ the picture on the telly

const darks = new Map<string, string>();
const dark = (c: string) => {
  let d = darks.get(c);
  if (!d) {
    d = mix(c, '#1d1630', 0.4);
    darks.set(c, d);
  }
  return d;
};

/** Fills the current path with a soft outline in its own colour, darkened (the toon look, flat). */
function ink(g: CanvasRenderingContext2D, fill: string, lw = 6): void {
  g.fillStyle = fill;
  g.fill();
  if (lw > 0) {
    g.lineWidth = lw;
    g.strokeStyle = dark(fill);
    g.stroke();
  }
}

function oval(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, lw = 6): void {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  ink(g, fill, lw);
}

function slab(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, lw = 6): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  ink(g, fill, lw);
}

function limb(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width: number): void {
  g.lineCap = 'round';
  g.strokeStyle = dark(color);
  g.lineWidth = width + 8;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}

/** Cooking: a frying pan on the hob, two eggs sizzling, steam curling up. */
function cooking(g: CanvasRenderingContext2D, t: number): void {
  g.fillStyle = '#f7cb93';
  g.fillRect(0, 0, SW, SH);
  g.strokeStyle = '#ecb578';
  g.lineWidth = 3;
  for (let x = 32; x < SW; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 250);
    g.stroke();
  }
  for (let y = 40; y < 250; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(SW, y);
    g.stroke();
  }
  slab(g, -10, 250, SW + 20, 150, 0, '#8d6650', 0);
  g.globalAlpha = 0.45 + Math.sin(t * 5) * 0.1;
  oval(g, 240, 300, 150, 34, '#ff6a4a', 0);
  g.globalAlpha = 1;
  slab(g, 370, 248, 130, 26, 13, '#3d3b48');
  oval(g, 240, 272, 152, 54, '#4a4858');
  oval(g, 240, 264, 128, 40, '#625f74', 0);
  [-60, 52].forEach((dx, i) => {
    const j = Math.sin(t * 34 + i * 2) * 1.6;
    oval(g, 240 + dx, 262 + j, 48, 21, '#fffaf0', 5);
    oval(g, 244 + dx, 256 + j, 15, 12, '#ffc53a', 4);
  });
  for (let i = 0; i < 7; i++) {
    if (Math.sin(t * 23 + i * 7.3) < 0.35) continue;
    const a = i * 0.9 + t;
    const x = 240 + Math.cos(a) * 140;
    const y = 262 + Math.sin(a) * 36 - 18;
    limb(g, x, y, x + Math.cos(a) * 12, y - 12, '#fff3b0', 3);
  }
  for (let i = 0; i < 4; i++) {
    const p = (t * 0.45 + i / 4) % 1;
    g.globalAlpha = (1 - p) * 0.75;
    oval(g, 200 + i * 28 + Math.sin(p * 6 + i) * 14, 225 - p * 180, 14 + p * 24, 12 + p * 20, '#ffffff', 0);
  }
  g.globalAlpha = 1;
}

/** Nature: a hedgehog asleep on a hill, breathing slowly, leaves drifting past. */
function nature(g: CanvasRenderingContext2D, t: number): void {
  const sky = g.createLinearGradient(0, 0, 0, SH);
  sky.addColorStop(0, '#b6e2f6');
  sky.addColorStop(1, '#ecf8df');
  g.fillStyle = sky;
  g.fillRect(0, 0, SW, SH);
  oval(g, 420, 70, 36, 36, '#fff2bf', 0);
  oval(g, 110, 400, 300, 150, '#8fd16a', 0);
  oval(g, 430, 420, 280, 170, '#6cbf55', 0);
  const breathe = 1 + Math.sin(t * 1.8) * 0.05;
  const cx = 250;
  const cy = 282;
  // Spikes round the top of the body, then the body and a little face.
  g.beginPath();
  const n = 15;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    const r = i % 2 === 0 ? 92 : 118;
    const x = cx + Math.cos(a) * r * 1.05;
    const y = cy + Math.sin(a) * r * 0.62 * breathe;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  ink(g, '#8a5d3f');
  oval(g, cx, cy, 98, 56 * breathe, '#a87652');
  oval(g, cx + 78, cy + 8, 38, 28, '#e8c9a0');
  oval(g, cx + 112, cy + 6, 9, 8, '#e57a8a', 3);
  g.lineWidth = 4;
  g.strokeStyle = '#4a3326';
  g.beginPath();
  g.arc(cx + 80, cy, 9, 0.2, Math.PI - 0.2);
  g.stroke();
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.35 + i / 3) % 1;
    g.globalAlpha = 1 - p;
    g.fillStyle = '#6b6aa8';
    g.font = `900 ${Math.round(22 + p * 18)}px ${FONT}`;
    g.fillText('z', cx + 110 + p * 60, cy - 70 - p * 90);
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 6; i++) {
    const p = (t * 0.12 + i / 6) % 1;
    const x = (i * 97 + 40 + Math.sin(t * 1.3 + i) * 30) % SW;
    g.save();
    g.translate(x, p * (SH + 40) - 20);
    g.rotate(t * 1.5 + i);
    oval(g, 0, 0, 12, 6, i % 2 ? '#f0a040' : '#7fbf50', 3);
    g.restore();
  }
}

/** Workout: someone doing star jumps on a mat, very keen about it. */
function workout(g: CanvasRenderingContext2D, t: number): void {
  g.fillStyle = '#a9cdf2';
  g.fillRect(0, 0, SW, SH);
  g.fillStyle = '#98c1ef';
  for (let x = -SH; x < SW; x += 70) {
    g.beginPath();
    g.moveTo(x, SH);
    g.lineTo(x + 35, SH);
    g.lineTo(x + 35 + SH, 0);
    g.lineTo(x + SH, 0);
    g.fill();
  }
  slab(g, -10, 300, SW + 20, 100, 0, '#5c7fb4', 0);
  slab(g, 140, 296, 232, 16, 8, '#ef6f5f', 4);
  const ph = (t * 2.1) % 1;
  const up = Math.sin(ph * Math.PI);
  const cx = 256;
  const by = 298 - up * 38;
  const skin = '#f2c6a0';
  limb(g, cx - 10, by - 70, cx - 16 - up * 40, by, '#3d3d63', 16);
  limb(g, cx + 10, by - 70, cx + 16 + up * 40, by, '#3d3d63', 16);
  const arm = (side: number) => {
    // Hanging down and a little out at rest, swung up over the head at the top of the jump.
    const a = Math.PI / 2 - side * (0.35 + up * 2.4);
    limb(g, cx + side * 22, by - 128, cx + side * 22 + Math.cos(a) * 62, by - 128 + Math.sin(a) * 62, skin, 13);
  };
  arm(-1);
  arm(1);
  slab(g, cx - 28, by - 142, 56, 80, 24, '#ffb347');
  oval(g, cx, by - 166, 26, 26, skin);
  slab(g, cx - 27, by - 182, 54, 11, 5, '#e8504a', 3);
  if (up > 0.6) {
    g.globalAlpha = (up - 0.6) * 2.5;
    limb(g, cx - 110, by - 150, cx - 90, by - 130, '#ffffff', 5);
    limb(g, cx + 110, by - 150, cx + 90, by - 130, '#ffffff', 5);
    g.globalAlpha = 1;
  }
  slab(g, 400, 300, 60, 10, 5, '#6d6d7a', 3);
  oval(g, 402, 305, 10, 16, '#4a4a58', 3);
  oval(g, 458, 305, 10, 16, '#4a4a58', 3);
}

/** Cartoons: a bouncy blob with big eyes, squashing on every landing, stars going round. */
function cartoons(g: CanvasRenderingContext2D, t: number): void {
  g.fillStyle = '#ffd3ea';
  g.fillRect(0, 0, SW, SH);
  g.save();
  g.translate(256, 200);
  g.rotate(t * 0.3);
  g.fillStyle = '#ffc0de';
  for (let i = 0; i < 12; i += 2) {
    const a0 = (i / 12) * Math.PI * 2;
    const a1 = ((i + 1) / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a0) * 420, Math.sin(a0) * 420);
    g.lineTo(Math.cos(a1) * 420, Math.sin(a1) * 420);
    g.fill();
  }
  g.restore();
  const bounce = Math.abs(Math.sin(t * 3.4));
  const land = (1 - bounce) ** 4;
  const sx = 1 + land * 0.35;
  const sy = 1 / sx;
  const y = 300 - bounce * 100;
  oval(g, 256, 312, 66 * (1 - bounce * 0.45), 10, '#eaa2c6', 0);
  oval(g, 256, y - 58 * sy, 74 * sx, 62 * sy, '#7fd4f2');
  for (const dx of [-24, 24]) {
    oval(g, 256 + dx * sx, y - 78 * sy, 17, 19 * sy, '#ffffff', 4);
    oval(g, 259 + dx * sx, y - 74 * sy, 7, 8 * sy, '#2a2140', 0);
  }
  g.lineWidth = 5;
  g.strokeStyle = '#2a2140';
  g.beginPath();
  g.arc(256, y - 50 * sy, 18, 0.25, Math.PI - 0.25);
  g.stroke();
  for (let i = 0; i < 3; i++) {
    const a = t * 2 + (i / 3) * Math.PI * 2;
    const x = 256 + Math.cos(a) * 150;
    const yy = 170 + Math.sin(a) * 50;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 18 : 8;
      const b = (k / 10) * Math.PI * 2 + t * 3;
      g.lineTo(x + Math.cos(b) * r, yy + Math.sin(b) * r);
    }
    g.closePath();
    ink(g, '#ffd166', 4);
  }
}

const SHOWS = [cooking, nature, workout, cartoons];

/** The telly's picture: a canvas the scene repaints every frame. */
class Picture {
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;
  private readonly fuzz: HTMLCanvasElement;
  private readonly fuzzG: CanvasRenderingContext2D;
  private readonly fuzzData: ImageData;
  private readonly vignette: CanvasGradient;
  mode: 'channel' | 'static' | 'off' = 'channel';
  channel = 0;
  /** When the channel last changed (for the flash and the channel number). */
  since = -9;
  offAt = 0;

  constructor() {
    this.texture = canvasTexture(SW, SH, () => {});
    this.g = (this.texture.image as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
    this.fuzz = document.createElement('canvas');
    this.fuzz.width = 128;
    this.fuzz.height = 96;
    this.fuzzG = this.fuzz.getContext('2d') as CanvasRenderingContext2D;
    this.fuzzData = this.fuzzG.createImageData(128, 96);
    this.vignette = this.g.createRadialGradient(SW / 2, SH / 2, SH * 0.35, SW / 2, SH / 2, SW * 0.68);
    this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
    this.vignette.addColorStop(1, 'rgba(10,6,24,0.55)');
  }

  paint(t: number): void {
    const g = this.g;
    if (this.mode === 'off') this.paintOff(t);
    else if (this.mode === 'static') this.paintStatic(t);
    else {
      (SHOWS[this.channel] ?? cooking)(g, t);
      const since = t - this.since;
      if (since < 1.4) {
        g.font = `900 40px ${FONT}`;
        g.textAlign = 'right';
        g.lineWidth = 8;
        g.strokeStyle = 'rgba(10,30,10,0.7)';
        g.strokeText(`CH ${this.channel + 1}`, SW - 26, 56);
        g.fillStyle = '#7dff8f';
        g.fillText(`CH ${this.channel + 1}`, SW - 26, 56);
        g.textAlign = 'left';
      }
      if (since < 0.16) {
        g.fillStyle = `rgba(255,255,255,${0.85 * (1 - since / 0.16)})`;
        g.fillRect(0, 0, SW, SH);
      }
    }
    if (this.mode !== 'off') {
      g.fillStyle = 'rgba(20,10,40,0.07)';
      for (let y = 0; y < SH; y += 4) g.fillRect(0, y, SW, 2);
    }
    g.fillStyle = this.vignette;
    g.fillRect(0, 0, SW, SH);
    this.texture.needsUpdate = true;
  }

  private paintStatic(t: number): void {
    const px = new Uint32Array(this.fuzzData.data.buffer);
    for (let i = 0; i < px.length; i++) {
      const v = (Math.random() * 200 + 40) | 0;
      px[i] = 0xff000000 | (v << 16) | (v << 8) | v;
    }
    this.fuzzG.putImageData(this.fuzzData, 0, 0);
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.fuzz, 0, 0, SW, SH);
    g.imageSmoothingEnabled = true;
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fillRect(0, (t * 160) % SH, SW, 34);
  }

  private paintOff(t: number): void {
    const g = this.g;
    g.fillStyle = '#0d0b16';
    g.fillRect(0, 0, SW, SH);
    const k = (t - this.offAt) / 0.45;
    g.fillStyle = '#f4f0ff';
    if (k < 0.5) {
      const h = (1 - k * 2) * SH * 0.35 + 4;
      g.fillRect(0, SH / 2 - h / 2, SW, h);
    } else if (k < 1.6) {
      g.globalAlpha = Math.max(0, 1 - (k - 0.5) / 1.1);
      g.beginPath();
      g.arc(SW / 2, SH / 2, 10, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}

// ------------------------------------------------------------------ the bored meter

function paintBored(g: CanvasRenderingContext2D, w: number, h: number, bored: number, target: number): void {
  g.clearRect(0, 0, w, h);
  const pip = Math.min(44, 300 / Math.max(1, target));
  const width = 170 + target * pip + 30;
  const left = (w - width) / 2;
  g.fillStyle = 'rgba(30,24,38,0.88)';
  g.beginPath();
  g.roundRect(left, 18, width, 92, 46);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(241,231,214,0.22)';
  g.stroke();
  g.font = `700 44px ${FONT}`;
  g.fillStyle = P.cream;
  g.textBaseline = 'middle';
  g.fillText('Bored', left + 34, 66);
  for (let i = 0; i < target; i++) {
    const x = left + 184 + i * pip + pip / 2;
    g.beginPath();
    g.arc(x, 64, pip * 0.34, 0, Math.PI * 2);
    if (i < bored) {
      g.fillStyle = P.lamp;
      g.fill();
    } else {
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(241,231,214,0.35)';
      g.stroke();
    }
  }
}

// ------------------------------------------------------------------ the room

interface Rig {
  c: Companion;
  /** Above the head, in world space: where words pop up. */
  head: THREE.Vector3;
}

class LoungeView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly picture = new Picture();
  readonly rigs: (Rig | null)[] = [];
  readonly floaters: Floaters;
  private readonly fitter = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly tv = new THREE.Group();
  private readonly glow: THREE.PointLight;
  private readonly led: THREE.Mesh;
  private readonly zapper = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly boredTex: THREE.CanvasTexture;
  private readonly boredSprite: THREE.Sprite;
  private readonly cards: THREE.Sprite[] = [];
  private readonly target: number;
  private zap = 9;
  private thunk = 9;
  private readonly env: Env;
  private tick: (dt: number, time: number) => void = () => {};
  /** Seconds since a new bored pip (the meter pops), and the last count shown. */
  private boredPop = 9;
  private boredShown = 0;

  constructor(seats: MinigameSeat[], companions: Companion[], remote: number, couch: readonly number[], target: number) {
    this.target = target;
    // The lounge late at night: the lights low, one lamp left on, and the telly lighting the room.
    this.env = livingRoom(this.scene, { mood: 'night', w: 10, d: 6, h: 4.2, rug: false, seed: 3 });
    // Everything in here is big (the telly is the star), and the room is turned round so the window is over the couch.
    this.env.root.scale.set(-ROOM, ROOM, ROOM);
    for (const l of this.env.lamps) {
      l.intensity *= 3.2;
      l.distance *= ROOM;
    }
    this.env.sun.target.position.set(0, 0, -1);
    this.glow = new THREE.PointLight('#ffffff', 24, 16, 1.5);
    this.scene.add(this.glow);
    this.floaters = new Floaters(this.scene);

    this.buildRoom();
    this.led = this.buildTelly();
    const couchGroup = this.buildCouch(COUCH_AT, COUCH_TURN, Math.max(1, couch.length));
    const chair = this.buildCouch(CHAIR_AT, CHAIR_TURN, 1, P.terracotta);

    // The remote control, held out toward the telly.
    part(this.zapper, rbox(0.16, 0.07, 0.42, 0.03), P.charcoal, 0, 0, 0, { gloss: 0.4 });
    part(this.zapper, sphere(0.035, 10), P.accent, 0, 0.045, 0.12, { outline: false });
    for (let i = 0; i < 6; i++) part(this.zapper, sphere(0.02, 8), P.stone, ((i % 3) - 1) * 0.045, 0.042, -0.02 - Math.floor(i / 3) * 0.08, { outline: false });
    this.beam = part(this.zapper, sphere(0.07, 12), P.ember, 0, 0, 0.24, { glow: 2.4, outline: false, shadow: false });
    this.beam.visible = false;
    this.zapper.position.set(0.3, SEAT_TOP + 0.36, 0.46);
    this.zapper.rotation.set(-0.25, -0.5, 0);
    chair.add(this.zapper);

    const xs = lanes(Math.max(1, couch.length), 1.3);
    seats.forEach((s, p) => {
      const c = companions[p] as Companion;
      const m = couch.indexOf(p);
      if (p === remote) {
        c.root.position.set(0, SEAT_TOP - SUNK, 0.05);
        chair.add(c.root);
        c.setBase('idle');
      } else if (m >= 0) {
        c.root.position.set(xs[m] ?? 0, SEAT_TOP - SUNK, 0.14);
        couchGroup.add(c.root);
        c.setBase('listening');
      } else {
        c.root.position.set(5.5, 0, 1.5);
        this.scene.add(c.root);
      }
      this.scene.updateMatrixWorld(true);
      const head = c.root.localToWorld(new THREE.Vector3(0, HEIGHT + 0.05, 0));
      this.rigs.push({ c, head });
      const card = nameCard(s.name, s.color, 0.72);
      card.position.copy(head).add(new THREE.Vector3(0, 0.34, 0));
      this.scene.add(card);
      this.cards.push(card);
      this.marks.push({ p: head.clone().add(new THREE.Vector3(0, 0.34, 0)), pad: 0.06 }, { p: head.clone().add(new THREE.Vector3(0, 0.9, 0)), pad: 0.05 });
    });

    // The bored meter floats over the couch.
    this.boredTex = canvasTexture(512, 128, (g, w, h) => paintBored(g, w, h, 0, target));
    this.boredSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.boredTex, depthWrite: false, transparent: true, sizeAttenuation: false }));
    this.boredSprite.scale.set(0.24, 0.06, 1);
    this.boredSprite.renderOrder = 6;
    this.boredSprite.position.copy(couchGroup.localToWorld(new THREE.Vector3(0, 3.05, -0.3)));
    this.scene.add(this.boredSprite);
    this.marks.push({ p: this.boredSprite.position.clone(), pad: 0.08 });

    // The frame: the telly from its feet to the tips of its ears, the couch and the armchair.
    this.scene.updateMatrixWorld(true);
    const at = (o: THREE.Object3D, x: number, y: number, z: number) => o.localToWorld(new THREE.Vector3(x, y, z));
    for (const sx of [-1, 1]) {
      this.marks.push({ p: at(this.tv, sx * 1.55, 0, 0.8) }, { p: at(this.tv, sx * 1.4, 3.15, -0.3) }, { p: at(this.tv, sx * 0.55, 3.9, -0.3) });
      this.marks.push({ p: at(couchGroup, sx * (couchGroup.userData.half as number), 0, 0.8) }, { p: at(couchGroup, sx * (couchGroup.userData.half as number), 1.7, -0.7) });
      this.marks.push({ p: at(chair, sx * 0.95, 0, 0.8) });
    }
  }

  private buildRoom(): void {
    const s = new THREE.Group();
    this.scene.add(s);
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, k = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(k);
      s.add(o);
      return o;
    };
    // A big woolly rug under it all.
    put(props.rug({ w: 9.6, d: 6.2, color: mix(P.aubergine, P.mauve, 0.5), border: mix(P.mauve, P.cream, 0.3), tex: 'knit' }), 0, 0, -0.7);
    // The coffee table with a bowl of popcorn, two mugs and a pizza box.
    put(props.coffeeTable({ w: 1.45, d: 0.74, color: P.walnut }), 0.6, 0, 0.9, 0, 1.5);
    put(props.snackBowl({ fill: 'popcorn', color: P.terracotta }), 0.3, 0.63, 0.9, 0, 2.3);
    put(props.mug({ color: P.teal }), 1.2, 0.63, 0.72, 0.6, 2.6);
    put(props.mug({ color: P.mustard }), 1.42, 0.63, 1.14, 2.2, 2.6);
    put(props.pizzaBox({}), 0.85, 0.63 * 0.36 + 0.03, 0.9, 0.3, 1.6);
    // A side table with a drink by the couch, and cushions on the floor in front.
    put(props.sideTable({ h: 0.55 }), 5.6, 0, 1.4, 0, 1.7);
    put(props.drink({ kind: 'can', color: P.rose }), 5.5, 0.55 * 1.7, 1.35, 0, 2.4);
    put(props.plant({ kind: 'snake', h: 0.9, pot: P.ceramic }), -6.6, 0, -3.6, 0, 1.8);
    put(props.pouf({ color: P.mustard, r: 0.4 }), 3.6, 0, 3.4, 0, 1.7);
    put(props.speaker({ h: 0.95 }), -6.4, 0, 0.6, 0.9, 1.8);
    this.tick = props.tickProps(s);
  }

  /** Builds the telly; returns its little ready light. */
  private buildTelly(): THREE.Mesh {
    const tv = this.tv;
    tv.position.copy(TV_AT);
    tv.rotation.y = TV_TURN;
    tv.scale.setScalar(TV_SCALE);
    const dark = { tex: 'darkWood' as const, texScale: 1.4 };
    const wood = { tex: 'wood' as const, texScale: 1.4 };
    // The stand, on stubby legs.
    part(tv, rbox(3.1, 0.8, 1.6, 0.08), P.walnut, 0, 0.4, -0.1, dark);
    part(tv, rbox(2.9, 0.06, 1.5, 0.03), mix(P.walnut, P.oak, 0.3), 0, 0.82, -0.1, { ...wood, outline: false });
    for (const x of [-0.72, 0.72]) {
      part(tv, rbox(1.3, 0.56, 0.03, 0.02), mix(P.walnut, P.ink, 0.15), x, 0.42, 0.705, { ...dark, outline: false, shadow: false });
      part(tv, sphere(0.04, 10), P.brass, x - Math.sign(x) * 0.5, 0.46, 0.74, { outline: false, gloss: 0.7 });
    }
    for (const x of [-1.3, 1.3]) part(tv, cyl(0.08, 0.06, 0.2, 10), mix(P.walnut, P.ink, 0.3), x, -0.0, 0.5);
    // The set itself: a wooden cabinet, a dark bezel round the glass, knobs and a speaker grille.
    part(tv, rbox(3.0, 2.25, 1.9, 0.24), P.mahogany, 0, 0.85 + 1.13, -0.15, wood);
    part(tv, rbox(2.35, 1.86, 0.12, 0.1), P.charcoal, -0.27, 1.98, 0.8, { gloss: 0.4 });
    part(tv, rbox(2.5, 2.0, 0.05, 0.1), mix(P.brass, P.walnut, 0.45), -0.27, 1.98, 0.775, { gloss: 0.6, outline: false, shadow: false });
    for (const y of [2.45, 2.0]) {
      part(tv, cyl(0.12, 0.12, 0.14, 20), P.cream, 1.05, y, 0.82, { rx: Math.PI / 2, gloss: 0.5 });
      part(tv, box(0.03, 0.16, 0.03), P.charcoal, 1.05, y, 0.9, { rz: y > 2.2 ? 0.5 : -0.9, outline: false, shadow: false });
    }
    for (let i = 0; i < 5; i++) part(tv, rbox(0.42, 0.035, 0.04, 0.015), mix(P.mahogany, P.ink, 0.45), 1.05, 1.5 - i * 0.085, 0.81, { outline: false, shadow: false });
    // Bunny-ear aerial.
    part(tv, dome(0.3), P.charcoal, 0, 3.1, -0.3, { gloss: 0.4 });
    for (const side of [-1, 1]) {
      part(tv, cyl(0.022, 0.022, 0.8, 6), P.stone, side * 0.19, 3.45, -0.3, { rz: -side * 0.5, gloss: 0.7, outline: false });
      part(tv, sphere(0.06, 10), P.stone, side * 0.38, 3.8, -0.3, { gloss: 0.7 });
    }
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.08, 1.56), new THREE.MeshBasicMaterial({ map: this.picture.texture, toneMapped: false }));
    screen.position.set(-0.27, 1.98, 0.87);
    tv.add(screen);
    const led = part(tv, sphere(0.05, 10), '#ff6a5a', 1.05, 1.66, 0.84, { glow: 2, outline: false, shadow: false });
    this.glow.position.copy(TV_AT).add(new THREE.Vector3(Math.sin(TV_TURN) * 2.6, 2.6, Math.cos(TV_TURN) * 2.6));
    this.scene.add(tv);
    return led;
  }

  /** A couch (or, with one seat, an armchair) facing `turn`, with room for `seats`. */
  private buildCouch(at: THREE.Vector3, turn: number, seats: number, color: string = P.teal): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    g.rotation.y = turn;
    const width = seats * 1.3 + 0.2;
    const fab = { tex: (seats > 1 ? 'fabric' : 'velvet') as 'fabric' | 'velvet', texScale: 1.2, texStrength: 0.85 };
    const base = mix(color, P.ink, 0.18);
    const light = mix(color, P.cream, 0.1);
    part(g, rbox(width + 0.9, 0.55, 1.5, 0.12), base, 0, 0.38, 0, fab);
    part(g, rbox(width + 0.9, 1.2, 0.42, 0.16), color, 0, 1.0, -0.56, fab);
    for (const sx of [-1, 1]) part(g, rbox(0.46, 0.92, 1.5, 0.18), color, sx * (width / 2 + 0.22), 0.6, 0, fab);
    for (let i = 0; i < seats; i++) {
      const x = (i - (seats - 1) / 2) * 1.3;
      part(g, rbox(1.26, 0.3, 1.18, 0.13), light, x, SEAT_TOP - 0.15, 0.1, fab);
      part(g, rbox(1.2, 0.78, 0.3, 0.14), light, x, 1.32, -0.34, { rx: -0.14, ...fab });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, cyl(0.07, 0.05, 0.14, 8), P.walnut, sx * (width / 2 + 0.3), 0.04, sz * 0.55, { outline: false });
    // A throw blanket over one arm of the couch.
    if (seats > 1) {
      part(g, rbox(0.56, 0.06, 1.3, 0.03), P.mustard, width / 2 + 0.22, 1.08, 0.05, { rz: 0.1, tex: 'knit', texScale: 0.6 });
      part(g, rbox(0.06, 0.5, 1.3, 0.03), P.mustard, width / 2 + 0.47, 0.84, 0.05, { tex: 'knit', texScale: 0.6 });
    }
    g.userData.half = width / 2 + 0.45;
    this.scene.add(g);
    return g;
  }

  /** The remote goes click and the picture changes. */
  tune(t: number): void {
    this.picture.since = t;
    this.zap = 0;
    this.thunk = 0;
  }

  /** The remote goes click and the picture fuzzes over. */
  fizz(): void {
    this.zap = 0;
    this.floaters.add('Bzzt!', '#e6e2f0', this.tv.localToWorld(new THREE.Vector3(-0.27, 3.3, 0.9)), 0.5, 1.0);
  }

  switchOff(t: number): void {
    this.picture.mode = 'off';
    this.picture.offAt = t;
  }

  say(p: number, text: string, color: string): void {
    const r = this.rigs[p];
    if (r) this.floaters.add(text, color, r.head.clone().add(new THREE.Vector3(0, 0.62, 0)), 0.42, 1.2);
  }

  mood(p: number, mood: CompanionMood, seconds?: number): void {
    this.rigs[p]?.c.react(mood, seconds);
  }

  base(p: number, mood: CompanionMood): void {
    this.rigs[p]?.c.setBase(mood);
  }

  setBored(bored: number): void {
    const canvas = this.boredTex.image as HTMLCanvasElement;
    paintBored(canvas.getContext('2d') as CanvasRenderingContext2D, canvas.width, canvas.height, Math.min(bored, this.target), this.target);
    this.boredTex.needsUpdate = true;
    if (bored > this.boredShown) this.boredPop = 0;
    this.boredShown = bored;
  }

  /** Mirrors the room's state: the picture, the little ready light. */
  sync(s: Surf): void {
    if (this.picture.mode !== 'off') {
      this.picture.mode = isStatic(s) ? 'static' : 'channel';
      this.picture.channel = s.channel;
    }
    const light = isStatic(s) ? '#ffc04a' : canSwitch(s) ? '#6dff8a' : '#ff6a5a';
    this.led.material = material(light, { glow: 2 });
  }

  update(dt: number, time: number): void {
    this.fitter.update(() => this.marks);
    this.env.update(dt, time);
    this.tick(dt, time);
    // The bored meter pops when it fills a pip.
    this.boredPop += dt;
    const pop = 1 + Math.max(0, 1 - this.boredPop / 0.3) * 0.16;
    this.boredSprite.scale.set(0.24 * pop, 0.06 * pop, 1);
    for (const r of this.rigs) r?.c.update(dt);
    this.floaters.update(dt);
    this.picture.paint(time);
    // The room glows in the colour of what's on.
    const pic = this.picture;
    const flicker = 1 + Math.sin(time * 17) * 0.04 + Math.sin(time * 5.3) * 0.05;
    if (pic.mode === 'off') this.glow.intensity = Math.max(0, this.glow.intensity - dt * 30);
    else {
      this.glow.color.set(pic.mode === 'static' ? '#d8d8e8' : mix(CHANNELS[pic.channel]?.color ?? '#ffffff', '#ffffff', 0.35));
      this.glow.intensity = 24 * flicker;
    }
    // The remote flicks up on a press, with a little red blink at its tip.
    this.zap += dt;
    const k = Math.max(0, 1 - this.zap / 0.25);
    this.zapper.rotation.x = -0.25 - k * 0.5;
    this.beam.visible = this.zap < 0.14;
    // The old set gives a little shudder when the channel changes.
    this.thunk += dt;
    const j = Math.max(0, 1 - this.thunk / 0.3);
    this.tv.scale.set(TV_SCALE * (1 + j * 0.02), TV_SCALE * (1 - j * 0.03), TV_SCALE);
  }

  dispose(): void {
    for (const r of this.rigs) r?.c.dispose();
    this.floaters.dispose();
    this.picture.dispose();
    for (const c of this.cards) {
      c.material.map?.dispose();
      c.material.dispose();
    }
    this.boredTex.dispose();
    this.boredSprite.material.dispose();
  }
}

// ------------------------------------------------------------------ sounds

function click(sfx: Sfx): void {
  tone(sfx, { freq: 1800, dur: 0.03, type: 'square', gain: 0.05 });
  tone(sfx, { freq: 140, to: 90, dur: 0.12, type: 'sine', gain: 0.14, delay: 0.03 });
  noise(sfx, { dur: 0.1, filter: 'highpass', freq: 3000, gain: 0.08, delay: 0.03 });
}

function fuzzSound(sfx: Sfx): void {
  noise(sfx, { dur: SURF.static, filter: 'bandpass', freq: 2600, to: 1800, gain: 0.12 });
}

function yawn(sfx: Sfx): void {
  tone(sfx, { freq: 330, to: 190, dur: 0.45, type: 'triangle', gain: 0.07 });
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'channelsurf',
  title: 'Channel Surf',
  how: 'Couch: hit the reaction that fits each new channel (Yum!, Aww, Stretch!, Ha!) within 1.5 s. Remote: switch channels to catch them out six times, but not too quickly or the old telly goes fuzzy!',
  controller: 'buttons',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const remote = teams[0]?.[0] ?? 0;
    const couch = (teams[1] ?? []).filter((p) => p !== remote);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const memberOf = new Map(couch.map((p, m) => [p, m] as const));
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });

    // Late presses are waited for a little longer at ?speed, where a phone's lag is worth more game time.
    const s = newSurf(couch.length, rng, (SURF.grace + 1 / 30) * clock.speed);
    const remoteBrain = newRemoteBrain(cpu(remote) ? ctx.skill() : 0.5, rng);
    const brains = couch.map((p) => newCouchBrain(cpu(p) ? ctx.skill() : 0.5));

    const view = new LoungeView(seats, await Promise.all(seats.map((x) => buildCompanion(x.look, { height: HEIGHT }))), remote, couch, s.target);
    ctx.stage.setView(view);
    view.tune(clock.time);
    view.sync(s);

    const remoteName = seats[remote]?.name ?? 'Someone';
    seats.forEach((x, p) => {
      if (p === remote) {
        session.setLayout(x.index, {
          kind: 'buttons',
          title: 'Channel Surf',
          buttons: CHANNELS.map((c) => ({ label: c.name, color: c.color })),
          note: `You've got the remote! Switch channels to catch the couch out: ${s.target} bored points wins. Too quick and it goes fuzzy.`,
        });
      } else if (memberOf.has(p)) {
        session.setLayout(x.index, {
          kind: 'buttons',
          title: 'Channel Surf',
          buttons: CHANNELS.map((c) => ({ label: c.reaction, color: c.color })),
          note: `You're on the couch! React to each new channel within 1.5 s. ${remoteName} has the remote.`,
        });
      } else {
        session.setLayout(x.index, { kind: 'wait', title: 'Channel Surf', text: 'Watch the big screen.' });
      }
    });

    let boredShown = 0;
    const onSwitch = (result: SwitchResult, ch: number) => {
      const name = CHANNELS[ch]?.name ?? 'that';
      if (result === 'switched') {
        view.tune(clock.time);
        click(sfx);
        view.mood(remote, 'talking', 0.5);
      } else if (result === 'static') {
        view.fizz();
        click(sfx);
        fuzzSound(sfx);
        view.mood(remote, 'thinking', 1.2);
        tell(remote, false, 'Too quick! It’s all fuzzy for a moment.');
        buzz(remote, [60, 40, 60]);
      } else if (result === 'same') {
        tell(remote, false, `It’s already on ${name}.`);
      } else if (!isOver(s)) {
        tell(remote, false, 'Wait for the picture to come back…');
      }
    };
    const onVerdict = (m: number, verdict: 'right' | 'wrong' | 'slow', ch: number) => {
      const p = couch[m];
      const c = CHANNELS[ch];
      if (p === undefined || !c) return;
      if (verdict === 'right') {
        view.say(p, c.reaction, c.color);
        view.mood(p, 'happy', 0.9);
        tone(sfx, { freq: 520 + m * 130, to: 700 + m * 130, dur: 0.12, gain: 0.07 });
        tell(p, true, `${c.reaction} Spot on.`);
        return;
      }
      view.say(p, verdict === 'slow' ? 'Zzz…' : 'Huh?', DIM);
      view.mood(p, verdict === 'slow' ? 'sleeping' : 'thinking', 1.4);
      yawn(sfx);
      tell(p, false, verdict === 'slow' ? 'Too slow… a bit bored now.' : `That was ${c.name}!`);
      buzz(p, [90]);
    };

    let over = false;
    let frameAt = performance.now();
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'press' || over || session.isCpu(seat) || msg.index >= CHANNELS.length) return;
      const p = posOf.get(seat);
      if (p === undefined) return;
      // When it was pressed: this frame's clock, plus the time since the frame, minus half the round trip.
      const late = Math.min(1 / 30, Math.max(0, (performance.now() - frameAt) / 1000)) * clock.speed;
      const lag = Math.min(SURF.grace, Math.max(0, session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed;
      const at = Math.max(0, s.time + late - lag);
      if (p === remote) {
        onSwitch(switchChannel(s, msg.index, at), msg.index);
        return;
      }
      const m = memberOf.get(p);
      if (m === undefined) return;
      const r = react(s, m, msg.index, at);
      if (r) onVerdict(m, r.verdict, r.channel);
      else if (!isOver(s)) tell(p, true, 'Wait for a new channel…');
    });

    ui.caption(`${remoteName} has the remote. Couch: react to every new channel!`, seats[remote]?.color);
    let hudAt = -1;
    await everyFrame(clock, (dt) => {
      frameAt = performance.now();
      const n = Math.max(1, Math.ceil(dt / STEP));
      for (let i = 0; i < n && !isOver(s); i++) {
        if (cpu(remote)) {
          const r = cpuRemote(s, remoteBrain, rng);
          if (r) onSwitch(r.result, r.channel);
        }
        couch.forEach((p, m) => {
          const b = brains[m];
          if (!b || !cpu(p)) return;
          const choice = cpuCouch(s, b, rng);
          if (choice === null) return;
          const r = react(s, m, choice);
          if (r) onVerdict(m, r.verdict, r.channel);
        });
        for (const e of stepSurf(s, dt / n)) onVerdict(e.member, 'slow', e.channel);
      }
      view.sync(s);
      if (s.bored !== boredShown) {
        boredShown = s.bored;
        view.setBored(s.bored);
        view.mood(remote, 'happy', 0.9);
        const left = s.target - s.bored;
        tell(remote, true, left > 0 ? `Bored! ${s.bored} of ${s.target}.` : 'Bored stiff!');
        if (left === 1) ui.caption('One more slip and the remote wins…', seats[remote]?.color);
      }
      if (clock.time - hudAt > 0.1) {
        hudAt = clock.time;
        ui.timer(SURF.duration - s.time);
        ui.live(
          seats.map((x, p) => {
            const m = memberOf.get(p);
            let value = '';
            if (p === remote) value = `Remote · ${Math.min(s.bored, s.target)}/${s.target} bored`;
            else if (m !== undefined) value = `Couch · ${s.boredBy[m] ?? 0} bored`;
            return { name: x.name, color: x.color, thumb: x.thumb, value };
          }),
        );
      }
      return isOver(s);
    });
    over = true;
    off();
    ui.timer(null);

    const won = remoteWins(s);
    if (won) {
      // The couch nods off, and the remote switches the telly off on them.
      view.switchOff(clock.time);
      click(sfx);
      sfx.fanfare();
      ui.caption(`The couch is bored stiff. ${remoteName} wins!`, seats[remote]?.color);
      couch.forEach((p) => view.base(p, 'sleeping'));
      view.base(remote, 'happy');
    } else {
      sfx.win();
      ui.caption('Still entertained! The couch wins.', seats[couch[0] ?? remote]?.color);
      couch.forEach((p) => view.base(p, 'happy'));
      view.base(remote, 'sad');
    }
    for (const p of seats.keys()) buzz(p, [40, 30, 120]);
    await clock.wait(2.2);
    ui.caption(null);

    return {
      scores: surfScores(s, seats.length, remote, couch),
      details: seats.map((_, p) => {
        if (p === remote) {
          const fuzz = s.statics ? ` · ${s.statics} fuzzy` : '';
          return `Remote · ${Math.min(s.bored, s.target)} bored · ${s.switches} switches${fuzz}`;
        }
        const m = memberOf.get(p);
        if (m === undefined) return 'Watched';
        return `Couch · ${s.right[m] ?? 0} right, ${s.boredBy[m] ?? 0} bored`;
      }),
    };
  },
};
