// Giggle Fit on the TV: everyone sunk into one long couch, watching a very serious nature documentary about a
// pebble on a big old TV set. Silly things keep happening on and around that TV. Hold still or crack up.
import * as THREE from 'three';
import {
  type CpuSitter,
  GIGGLE,
  type Silly,
  composure,
  cpuWobble,
  giggleScores,
  newCpuSitter,
  newSitter,
  sillyAt,
  sillySchedule,
  stepSitter,
} from '../../../game/minigames/giggle';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ROUNDED_FONT, ball, box, canvasTexture, cone, cyl, dome, mix, part, pill, plane, popSprite, rbox, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SEAT_W = 1.75; // couch width per player
const COUCH_X = -0.7; // the couch's centre
const SEAT_TOP = 0.98; // top of the seat cushions
const SINK = 0.4; // how far everyone sinks into the cushions
const HEIGHT = 1.55; // companion height
const COUCH = P.mauve;
const CUSHION = mix(P.mauve, P.cream, 0.14);
const ROOM = 1.7; // the room is built at life size and scaled up to the couch
const TV_POS = new THREE.Vector3(5.0, 0, 2.3);
const TV_TURN = -0.62;
const SCREEN = { w: 1.75, h: 1.3, x: -0.25, z: 0.86 }; // on the TV body
const ANTENNA = 0.35; // how far the rabbit ears lean
const MUG_X = 1.02; // the mug on top of the TV, right by the cat's paw

const NARRATION = [
  'Here, the pebble waits.',
  'It has waited for nine thousand years.',
  'It does not hurry. It does not worry.',
  'Tomorrow, it will wait again.',
  'Truly, a master of sitting still.',
  'Some call it the calmest pebble alive.',
];

// ------------------------------------------------------------------ sounds (Web Audio, no files)

function tone(sfx: Sfx, freq: number, dur: number, o: { type?: OscillatorType; slide?: number; at?: number; gain?: number } = {}): void {
  const a = sfx.audio;
  if (!a) return;
  const t0 = a.ctx.currentTime + (o.at ?? 0);
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.15, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** A burst of "hehehe": quick bouncing chirps, pitched per seat. */
function giggleSound(sfx: Sfx, seat: number): void {
  const base = 520 + seat * 70;
  for (let i = 0; i < 6; i++) tone(sfx, base * (1 + (i % 2) * 0.18), 0.09, { type: 'triangle', at: i * 0.11, gain: 0.13, slide: base * 0.85 });
}

const SOUNDS: Record<Silly, (sfx: Sfx) => void> = {
  duck: (sfx) => {
    tone(sfx, 420, 0.16, { type: 'sawtooth', slide: 260, gain: 0.08, at: 1.2 });
    tone(sfx, 400, 0.18, { type: 'sawtooth', slide: 240, gain: 0.08, at: 1.42 });
  },
  puppet: (sfx) => {
    sfx.hop();
    tone(sfx, 300, 0.25, { slide: 700, at: 0.5, gain: 0.12 });
  },
  cat: (sfx) => {
    tone(sfx, 900, 0.2, { type: 'triangle', slide: 300, at: 1.4, gain: 0.1 });
    tone(sfx, 1400, 0.06, { type: 'square', at: 2.05, gain: 0.08 });
    tone(sfx, 1700, 0.08, { type: 'square', at: 2.1, gain: 0.06 });
  },
  googly: (sfx) => {
    tone(sfx, 180, 0.3, { slide: 520, gain: 0.14 });
    tone(sfx, 260, 0.3, { slide: 640, at: 0.12, gain: 0.1 });
  },
  antenna: (sfx) => {
    for (let i = 0; i < 8; i++) tone(sfx, 300 + (i % 2) * 260, 0.12, { type: 'square', at: i * 0.13, gain: 0.05 });
  },
  vacuum: (sfx) => {
    tone(sfx, 1320, 0.08, { type: 'square', gain: 0.06 });
    tone(sfx, 1760, 0.12, { type: 'square', at: 0.12, gain: 0.06 });
  },
};

// ------------------------------------------------------------------ the documentary on the screen

type ScreenMode = 'doc' | 'bars' | 'googly';

function drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number, mode: ScreenMode, line: string): void {
  if (mode === 'bars') {
    const bars = ['#e9e2d6', '#d6b84a', '#4fb9c4', '#5fb07a', '#b96fb0', '#c85a55', '#4b63a8'];
    bars.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect((i * w) / bars.length, 0, w / bars.length + 1, h);
    });
    ctx.fillStyle = 'rgba(20,18,30,0.85)';
    ctx.fillRect(w * 0.14, h * 0.4, w * 0.72, h * 0.2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 30px ${ROUNDED_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('We’ll be right back', w / 2, h / 2);
    return;
  }
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#4b5b70');
  sky.addColorStop(1, '#232b38');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#39465a';
  ctx.beginPath();
  ctx.ellipse(w * 0.2, h * 0.68, w * 0.35, h * 0.2, 0, 0, Math.PI * 2);
  ctx.ellipse(w * 0.8, h * 0.7, w * 0.4, h * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6f6a5a';
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
  // The star of the show.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.75, w * 0.2, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8d8f96';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.62, w * 0.19, h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a9abb2';
  ctx.beginPath();
  ctx.ellipse(w * 0.45, h * 0.57, w * 0.08, h * 0.05, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = `700 20px ${ROUNDED_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Nature Hour · Ep. 9: The Patient Pebble', 18, 14);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h - 58, w, 58);
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${mode === 'googly' ? 22 : 25}px ${ROUNDED_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(mode === 'googly' ? '(The pebble has never looked back before.)' : line, w / 2, h - 29, w - 30);
  // Old-TV scanlines.
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
}

// ------------------------------------------------------------------ props

function buildDuck(): { root: THREE.Group; head: THREE.Group } {
  const root = new THREE.Group();
  const rubber = mix(P.mustard, '#ffe07a', 0.5);
  const beak = P.accent;
  part(root, sphere(0.38, 18), rubber, 0, 0.42, 0, { sy: 0.85, sz: 1.25, gloss: 0.4 });
  part(root, cone(0.12, 0.3, 10), rubber, 0, 0.62, -0.48, { rx: -2.2, gloss: 0.4 });
  for (const sx of [-1, 1]) part(root, sphere(0.2, 12), mix(rubber, P.ink, 0.08), sx * 0.36, 0.45, -0.05, { sx: 0.35, sy: 0.7, sz: 1.1, gloss: 0.4 });
  for (const sx of [-0.15, 0.15]) part(root, rbox(0.16, 0.05, 0.24, 0.02), beak, sx, 0.03, 0.1);
  const head = new THREE.Group();
  head.position.set(0, 0.86, 0.26);
  root.add(head);
  part(head, sphere(0.25, 16), rubber, 0, 0, 0, { gloss: 0.4 });
  part(head, rbox(0.26, 0.07, 0.24, 0.03), beak, 0, -0.05, 0.27, { gloss: 0.3 });
  // Very cool sunglasses.
  part(head, rbox(0.17, 0.12, 0.04, 0.03), P.ink, -0.11, 0.06, 0.23, { ry: -0.25, gloss: 0.7 });
  part(head, rbox(0.17, 0.12, 0.04, 0.03), P.ink, 0.11, 0.06, 0.23, { ry: 0.25, gloss: 0.7 });
  part(head, box(0.1, 0.025, 0.02), P.ink, 0, 0.09, 0.25, { outline: false });
  part(head, box(0.05, 0.02, 0.01), P.cream, -0.14, 0.09, 0.255, { basic: true, rz: 0.5 });
  return { root, head };
}

function buildPuppet(): { root: THREE.Group; mouth: THREE.Mesh } {
  const root = new THREE.Group();
  const sock = P.cream;
  part(root, pill(0.24, 0.9), sock, 0, 0, 0, { tex: 'knit', texScale: 0.5 });
  for (const y of [-0.3, -0.05]) part(root, torus(0.245, 0.05), P.brick, 0, y, 0, { rx: Math.PI / 2, outline: false });
  const head = new THREE.Group();
  head.position.y = 0.62;
  root.add(head);
  part(head, sphere(0.3, 16), sock, 0, 0, 0.06, { sz: 1.15, tex: 'knit', texScale: 0.5 });
  for (const sx of [-0.11, 0.11]) {
    part(head, cyl(0.065, 0.065, 0.03, 12), P.plum, sx, 0.1, 0.36, { rx: Math.PI / 2, gloss: 0.6 });
    part(head, sphere(0.018, 6), P.cream, sx + 0.02, 0.12, 0.38, { basic: true });
  }
  part(head, sphere(0.1, 10), P.brick, 0, 0.3, 0, { tex: 'knit', texScale: 0.3 });
  const mouth = part(head, rbox(0.3, 0.1, 0.06, 0.03), mix(P.brick, P.ink, 0.35), 0, -0.1, 0.34);
  return { root, mouth };
}

function buildCat(): { root: THREE.Group; head: THREE.Group; eyes: THREE.Mesh[]; paw: THREE.Mesh; tail: THREE.Mesh } {
  const root = new THREE.Group();
  const fur = mix(P.copper, P.mustard, 0.4);
  const pale = mix(fur, P.cream, 0.55);
  part(root, sphere(0.36, 18), fur, 0, 0.24, 0, { sx: 1.35, sy: 0.75, sz: 0.95 });
  // tabby stripes over the back
  for (const x of [-0.22, -0.04, 0.14]) part(root, torus(0.26, 0.022, Math.PI), mix(fur, P.walnut, 0.45), x, 0.25, 0, { ry: Math.PI / 2, outline: false, shadow: false });
  const tail = part(root, pill(0.06, 0.5), fur, -0.55, 0.15, 0.05, { rz: 1.3 });
  const paw = part(root, sphere(0.09, 10), pale, 0.35, 0.07, 0.26);
  const head = new THREE.Group();
  head.position.set(0.4, 0.44, 0.1);
  root.add(head);
  part(head, sphere(0.25, 16), fur, 0, 0, 0);
  part(head, sphere(0.12, 10), pale, 0, -0.07, 0.17, { sx: 1.2, sy: 0.7, outline: false });
  for (const sx of [-1, 1]) {
    part(head, cone(0.085, 0.17, 8), fur, sx * 0.13, 0.21, 0, { rz: -sx * 0.3 });
    part(head, cone(0.045, 0.1, 6), P.rose, sx * 0.13, 0.2, 0.035, { rz: -sx * 0.3, outline: false });
  }
  const eyes = [-0.09, 0.09].map((sx) => part(head, rbox(0.08, 0.02, 0.02, 0.01), P.ink, sx, 0.03, 0.23, { outline: false }));
  part(head, ball(0.03, 1), P.rose, 0, -0.04, 0.27, { outline: false });
  return { root, head, eyes, paw, tail };
}

function buildMug(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.15, 0.13, 0.3, 18), P.teal, 0, 0.15, 0, { gloss: 0.5 });
  part(g, cyl(0.13, 0.13, 0.02, 18), P.walnut, 0, 0.29, 0, { outline: false, gloss: 0.4 });
  part(g, torus(0.08, 0.025), P.teal, 0.16, 0.15, 0, { outline: false, gloss: 0.5 });
  return g;
}

function buildVacuum(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.45, 0.45, 0.16, 28), P.charcoal, 0, 0.1, 0, { gloss: 0.35 });
  part(g, cyl(0.3, 0.3, 0.04, 24), P.slate, 0, 0.2, 0, { outline: false, gloss: 0.5 });
  part(g, torus(0.38, 0.025), P.neonCyan, 0, 0.19, 0, { rx: Math.PI / 2, glow: 1.6 });
  part(g, rbox(0.22, 0.05, 0.08, 0.02), P.ink, 0, 0.12, 0.42, { outline: false });
  // A party hat, obviously.
  part(g, cone(0.17, 0.45, 14), P.rose, 0, 0.44, 0, { tex: 'fabric', texScale: 0.3 });
  part(g, torus(0.15, 0.03), P.mustard, 0, 0.3, 0, { rx: Math.PI / 2, outline: false });
  part(g, sphere(0.07, 8), P.mustard, 0, 0.68, 0);
  return g;
}

// ------------------------------------------------------------------ the living room

interface Seat {
  companion: Companion;
  baseY: number;
  /** Faces the camera; its `body` shakes when the player is close to cracking. */
  meter: THREE.Group;
  body: THREE.Group;
  fill: THREE.Group;
  laughing: number;
}

interface Floater {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  rise: number;
}

class LivingRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 200);
  readonly seats: Seat[] = [];
  private floaters: Floater[] = [];
  private screenTex: THREE.CanvasTexture;
  private screenMode: ScreenMode = 'doc';
  private line = 0;
  private lineAt = -1;
  private tv = new THREE.Group();
  private tvBody = new THREE.Group();
  private antenna: THREE.Group[] = [];
  private duck = buildDuck();
  private puppet = buildPuppet();
  private cat = buildCat();
  private mug = buildMug();
  private vacuum = buildVacuum();
  private eyes = new THREE.Group();
  private pupils: THREE.Mesh[] = [];
  private tvGlow = new THREE.PointLight(P.screen, 6, 10);
  private env: Env;
  private tick: (dt: number, time: number) => void = () => {};
  private act: { kind: Silly; t: number } | null = null;
  private time = 0;

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    // An evening living room, scaled up to the big couch and shifted so its back wall sits right behind it.
    this.env = livingRoom(this.scene, { mood: 'evening', w: 11.6, d: 6.4, h: 4.3, rug: false, accent: P.teal, wall: mix(P.duskWall, P.plum, 0.35), seed: 3 });
    this.env.root.scale.setScalar(ROOM);
    this.env.root.position.set(1.4, 0, 4.1);
    this.env.sun.target.position.set(1, 0, 1);
    this.buildRoom();

    const n = seats.length;
    const width = n * SEAT_W;
    // The couch: base, arms, back, and a cushion and a back cushion per player.
    const fab = { tex: 'fabric' as const, texScale: 1.6, texStrength: 0.85 };
    part(this.scene, rbox(width + 1.1, 0.55, 1.75, 0.14), mix(COUCH, P.ink, 0.18), COUCH_X, 0.42, 0, fab);
    part(this.scene, rbox(width + 1.1, 1.45, 0.5, 0.2), COUCH, COUCH_X, 1.2, -0.68, fab);
    for (const side of [-1, 1]) {
      part(this.scene, rbox(0.55, 0.95, 1.75, 0.18), COUCH, COUCH_X + side * (width / 2 + 0.28), 0.86, 0, fab);
      for (const dz of [-0.65, 0.65]) part(this.scene, cyl(0.06, 0.05, 0.16, 8), P.walnut, COUCH_X + side * (width / 2 + 0.3), 0.08, dz, { outline: false });
    }
    seats.forEach((s, i) => {
      const x = COUCH_X + (i - (n - 1) / 2) * SEAT_W;
      part(this.scene, rbox(SEAT_W - 0.06, 0.32, 1.4, 0.14), CUSHION, x, SEAT_TOP - 0.16, 0.12, fab);
      part(this.scene, rbox(SEAT_W - 0.14, 0.95, 0.36, 0.16), CUSHION, x, 1.42, -0.4, { rx: -0.12, ...fab });
      // A throw pillow in the player's colour.
      part(this.scene, rbox(0.45, 0.45, 0.18, 0.08), s.color, x + 0.6, SEAT_TOP + 0.22, -0.12, { rz: 0.25, ry: -0.2, tex: 'knit', texScale: 0.5 });
      const c = companions[i] as Companion;
      const baseY = SEAT_TOP - SINK;
      c.root.position.set(x - 0.08, baseY, 0.05);
      c.root.rotation.y = 0.28;
      c.setBase('listening');
      this.scene.add(c.root);
      // Composure meter over the head.
      const meter = new THREE.Group();
      meter.position.set(x - 0.08, baseY + HEIGHT + 0.42, 0.05);
      const body = new THREE.Group();
      meter.add(body);
      part(body, rbox(1.12, 0.2, 0.1, 0.09), P.ink, 0, 0, 0, { outline: false, shadow: false });
      const fill = new THREE.Group();
      fill.position.x = -0.5;
      part(fill, rbox(1.0, 0.11, 0.12, 0.05), s.color, 0.5, 0, 0.01, { outline: false, glow: 0.6, shadow: false });
      body.add(fill);
      this.scene.add(meter);
      this.seats.push({ companion: c, baseY, meter, body, fill, laughing: 0 });
    });

    // The TV set: an old wooden box on a cabinet, screen, knobs and rabbit-ear antenna.
    this.tv.position.copy(TV_POS);
    this.tv.rotation.y = TV_TURN;
    this.scene.add(this.tv);
    part(this.tv, rbox(2.9, 0.75, 1.5, 0.08), P.walnut, 0, 0.47, 0, { tex: 'wood', texScale: 1.6 });
    for (const sx of [-0.7, 0.7]) part(this.tv, rbox(1.25, 0.5, 0.04, 0.02), mix(P.walnut, P.cream, 0.08), sx, 0.47, 0.75, { tex: 'wood', texScale: 1.6, outline: 0.015 });
    for (const sx of [-0.12, 0.12]) part(this.tv, sphere(0.04, 8), P.brass, sx, 0.5, 0.79, { outline: false, gloss: 0.7 });
    for (const sx of [-1.25, 1.25]) for (const sz of [-0.55, 0.55]) part(this.tv, cyl(0.06, 0.05, 0.12, 8), P.ink, sx, 0.06, sz);
    this.tvBody.position.y = 0.85;
    this.tv.add(this.tvBody);
    const tb = this.tvBody;
    part(tb, rbox(2.7, 2.0, 1.6, 0.22), P.mahogany, 0, 1.0, 0, { tex: 'darkWood', texScale: 1.4, gloss: 0.25 });
    part(tb, rbox(1.9, 1.5, 0.8, 0.3), mix(P.mahogany, P.ink, 0.3), 0, 1.0, -0.95, { tex: 'darkWood', texScale: 1.4 });
    part(tb, rbox(2.05, 1.58, 0.1, 0.18), P.charcoal, SCREEN.x, 1.0, 0.8, { gloss: 0.5 });
    this.screenTex = canvasTexture(512, 384, (ctx, w, h) => drawScreen(ctx, w, h, 'doc', NARRATION[0] as string));
    const screen = new THREE.Mesh(plane(SCREEN.w, SCREEN.h), new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(1.25, 1.25, 1.25) }));
    screen.position.set(SCREEN.x, 1.0, SCREEN.z);
    tb.add(screen);
    for (const y of [1.35, 0.95]) part(tb, cyl(0.12, 0.12, 0.1, 18), P.ceramic, 1.0, y, 0.82, { rx: Math.PI / 2, gloss: 0.5 });
    for (let k = 0; k < 4; k++) part(tb, rbox(0.42, 0.04, 0.04, 0.015), P.espresso, 1.0, 0.55 - k * 0.09, 0.81, { outline: false });
    part(tb, dome(0.25), P.charcoal, 0, 2.0, -0.35, { gloss: 0.5 });
    for (const side of [-1, 1]) {
      const rod = new THREE.Group();
      rod.position.set(0, 2.1, -0.35);
      rod.rotation.z = side * ANTENNA;
      part(rod, cyl(0.025, 0.025, 1.3, 6), P.stone, 0, 0.65, 0, { outline: false, gloss: 0.7 });
      part(rod, sphere(0.06, 8), P.stone, 0, 1.3, 0, { gloss: 0.7 });
      tb.add(rod);
      this.antenna.push(rod);
    }
    this.tvGlow.position.set(SCREEN.x, 1.0, 1.8);
    tb.add(this.tvGlow);

    // Googly eyes for the pebble on screen (hidden until the moment comes).
    this.eyes.position.set(SCREEN.x, 1.0 + SCREEN.h * (0.5 - 0.6), SCREEN.z + 0.02);
    for (const sx of [-0.13, 0.13]) {
      part(this.eyes, sphere(0.11, 14), P.cream, sx, 0, 0, { sz: 0.35, gloss: 0.5 });
      this.pupils.push(part(this.eyes, sphere(0.05, 10), P.ink, sx, 0, 0.04, { sz: 0.4, outline: false }));
    }
    this.eyes.scale.setScalar(0.001);
    tb.add(this.eyes);

    // The cat naps on top of the TV next to somebody's mug.
    this.cat.root.position.set(0.42, 2.0, 0.2);
    tb.add(this.cat.root);
    this.resetMug();
    tb.add(this.mug);

    // The puppet hides behind the TV; the duck and the robot vacuum wait off screen.
    this.puppet.root.position.set(-0.85, 0.6, -1.1);
    this.puppet.root.visible = false;
    tb.add(this.puppet.root);
    this.duck.root.visible = false;
    this.scene.add(this.duck.root);
    this.vacuum.visible = false;
    this.scene.add(this.vacuum);

    this.camera.position.set(1.3, 4.8, 14.4);
    this.camera.lookAt(1.2, 1.55, 0.6);
    for (const s of this.seats) s.meter.quaternion.copy(this.camera.quaternion);
  }

  /** What the environment does not bring: the rug, the coffee table with snacks, a lamp by the couch. */
  private buildRoom(): void {
    const s = this.scene;
    const set = new THREE.Group();
    const put = (o: THREE.Object3D, x: number, y: number, z: number, scale = 1, ry = 0) => {
      o.position.set(x, y, z);
      o.scale.setScalar(scale);
      o.rotation.y = ry;
      set.add(o);
      return o;
    };
    put(props.rug({ w: 9.6, d: 5.2, color: P.terracotta, border: P.cream }), COUCH_X + 0.6, 0, 2.5);
    // The coffee table: snacks, a drink, the remote, last night's pizza box.
    part(set, rbox(3.4, 0.14, 1.2, 0.06), P.walnut, COUCH_X, 0.55, 2.35, { tex: 'wood', texScale: 1.4, gloss: 0.2 });
    part(set, rbox(3.0, 0.06, 0.9, 0.03), mix(P.walnut, P.ink, 0.2), COUCH_X, 0.2, 2.35, { tex: 'wood', texScale: 1.4, outline: false });
    for (const sx of [-1.5, 1.5]) for (const sz of [-0.45, 0.45]) part(set, cyl(0.07, 0.05, 0.5, 8), mix(P.walnut, P.ink, 0.25), COUCH_X + sx, 0.25, 2.35 + sz, { outline: false });
    put(props.snackBowl({ fill: 'popcorn', color: P.teal }), COUCH_X - 0.6, 0.62, 2.35, 2.7);
    put(props.mug({ color: P.mustard }), COUCH_X + 0.5, 0.62, 2.15, 2.2, 0.6);
    put(props.remote(), COUCH_X + 1.15, 0.62, 2.5, 2.2, 0.4);
    put(props.books(0.5, 4), COUCH_X - 0.2, 0.23, 2.35, 1.8, Math.PI / 2);
    // A floor lamp by the couch and a plant behind the TV.
    put(props.floorLamp({ light: 26, shade: P.cream }), COUCH_X - 5.5, 0, -0.3, 1.9);
    put(props.plant({ kind: 'monstera', h: 1.1, pot: P.terracotta, seed: 5 }), 7.6, 0, 0.3, 1.9);
    s.add(set);
    this.tick = props.tickProps(set);
  }

  /** The mug back on top of the TV, upright. */
  private resetMug(): void {
    this.mug.position.set(MUG_X, 2.0, 0.4);
    this.mug.rotation.set(0, 0, 0);
  }

  private setScreen(mode: ScreenMode): void {
    if (mode === this.screenMode) return;
    this.screenMode = mode;
    this.redraw();
  }

  private redraw(): void {
    const canvas = this.screenTex.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawScreen(ctx, canvas.width, canvas.height, this.screenMode, NARRATION[this.line % NARRATION.length] as string);
    this.screenTex.needsUpdate = true;
  }

  /** Starts a silly moment. */
  silly(kind: Silly): void {
    this.act = { kind, t: 0 };
    if (kind === 'cat') this.resetMug();
    if (kind === 'puppet') this.puppet.root.visible = true;
    if (kind === 'duck') this.duck.root.visible = true;
    if (kind === 'vacuum') this.vacuum.visible = true;
  }

  /** Floating words over a player (a "Pfft!", a "ha"). */
  float(seat: number, text: string, color: string, size: number, life: number): void {
    const s = this.seats[seat];
    if (!s) return;
    const sprite = popSprite(text, color, size);
    sprite.position.copy(s.meter.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.15, 0.3));
    this.scene.add(sprite);
    this.floaters.push({ sprite, age: 0, life, rise: 0.7 });
  }

  crackUp(seat: number): void {
    const s = this.seats[seat];
    if (!s) return;
    s.laughing = 3.2;
    s.companion.setBase('happy');
    s.companion.react('happy', 4);
  }

  showComposure(seat: number, value: number, nervous: number): void {
    const s = this.seats[seat];
    if (!s) return;
    s.fill.scale.x = Math.max(0.001, value);
    s.body.rotation.z = value > 0 && nervous > 0.3 ? Math.sin(this.time * 40) * 0.05 * nervous : 0;
  }

  dispose(): void {
    for (const s of this.seats) s.companion.dispose();
    for (const f of this.floaters) {
      f.sprite.material.map?.dispose();
      f.sprite.material.dispose();
    }
    this.screenTex.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.env.update(dt, time);
    this.tick(dt, time);
    for (const s of this.seats) {
      s.companion.update(dt);
      if (s.laughing > 0) {
        s.laughing -= dt;
        const k = Math.min(1, s.laughing / 1.5);
        s.companion.root.position.y = s.baseY + Math.abs(Math.sin(time * 15)) * 0.07 * (0.3 + k);
        s.companion.root.rotation.z = Math.sin(time * 9) * 0.09 * (0.3 + k);
      } else if (s.companion.root.rotation.z !== 0) {
        // Still chuckling now and then.
        s.companion.root.position.y = s.baseY + Math.max(0, Math.sin(time * 12)) * 0.02;
        s.companion.root.rotation.z = Math.sin(time * 5) * 0.03;
      }
    }
    this.floaters = this.floaters.filter((f) => {
      f.age += dt;
      f.sprite.position.y += f.rise * dt;
      f.sprite.material.opacity = Math.min(1, 3 * (1 - f.age / f.life));
      if (f.age < f.life) return true;
      this.scene.remove(f.sprite);
      f.sprite.material.map?.dispose();
      f.sprite.material.dispose();
      return false;
    });
    // The narrator moves on every few seconds.
    if (this.lineAt < 0) this.lineAt = time;
    if (time - this.lineAt > 6) {
      this.lineAt = time;
      this.line += 1;
      if (this.screenMode === 'doc') this.redraw();
    }
    this.tvGlow.intensity = 6 + Math.sin(time * 7) * 0.5 + Math.sin(time * 13) * 0.35;
    this.cat.tail.rotation.z = 1.3 + Math.sin(time * 1.6) * 0.2;
    this.animateAct(dt);
  }

  private animateAct(dt: number): void {
    const act = this.act;
    if (!act) return;
    act.t += dt;
    const t = act.t;
    const done = (len: number) => {
      if (t < len) return false;
      this.act = null;
      return true;
    };
    switch (act.kind) {
      case 'duck': {
        // Waddles in, stops to look at everyone over its sunglasses, then hurries off.
        const d = this.duck.root;
        const z = 4.2; // clear of the TV cabinet
        let x: number;
        if (t < 1.1) x = 8.5 - (t / 1.1) * 6.5;
        else if (t < 2.0) x = 2;
        else x = 2 - ((t - 2) / 1.3) * 10.5;
        const walking = t < 1.1 || t >= 2.0;
        d.position.set(x, walking ? Math.abs(Math.sin(t * 14)) * 0.08 : 0, z);
        d.rotation.y = walking ? -Math.PI / 2 : THREE.MathUtils.lerp(-Math.PI / 2, 0.15, Math.min(1, (t - 1.1) * 5));
        d.rotation.z = walking ? Math.sin(t * 14) * 0.16 : 0;
        this.duck.head.rotation.x = !walking && t > 1.35 && t < 1.75 ? -0.25 : 0;
        if (done(3.4)) d.visible = false;
        break;
      }
      case 'puppet': {
        // Pops up from behind the TV and waves, chattering.
        const p = this.puppet.root;
        const up = t < 0.4 ? t / 0.4 : t > 2.6 ? Math.max(0, 1 - (t - 2.6) / 0.4) : 1;
        p.position.y = 0.6 + up * 1.85;
        p.rotation.z = Math.sin(t * 6) * 0.3 * up;
        this.puppet.mouth.scale.y = 1 + Math.max(0, Math.sin(t * 18)) * 1.6;
        if (done(3)) p.visible = false;
        break;
      }
      case 'cat': {
        // Opens one eye, looks at the mug, and pushes it off the TV. Then looks at you.
        const cat = this.cat;
        const look = t < 0.5 ? t / 0.5 : 1;
        cat.head.rotation.y = t < 2.2 ? look * 0.7 : -0.5;
        for (const e of cat.eyes) e.scale.y = t < 0.4 ? 1 : 4;
        const push = t < 0.6 ? 0 : Math.min(1, (t - 0.6) / 0.7);
        cat.paw.position.x = 0.35 + (t < 2.4 ? push * 0.36 : Math.max(0, 1 - (t - 2.4) * 3) * 0.36);
        if (t < 1.3) this.mug.position.x = MUG_X + push * 0.36;
        else {
          // Over the edge, tumbling down to the floor (0.85 below the TV body).
          const f = Math.min(t - 1.3, 0.85);
          this.mug.position.x = MUG_X + 0.36 + f * 0.55;
          this.mug.position.y = Math.max(-0.7, 2.0 - 4.5 * f * f);
          this.mug.rotation.z = -Math.min(Math.PI / 2, f * 4);
        }
        if (done(3.2)) for (const e of cat.eyes) e.scale.y = 1;
        break;
      }
      case 'googly': {
        // The pebble on screen grows googly eyes and looks around.
        const s = t < 0.3 ? t / 0.3 : t > 2.7 ? Math.max(0.001, 1 - (t - 2.7) / 0.3) : 1;
        this.eyes.scale.setScalar(Math.max(0.001, s * (1 + Math.sin(t * 10) * 0.05)));
        this.setScreen(t < 2.9 ? 'googly' : 'doc');
        this.pupils.forEach((p, i) => {
          const a = t * 9 + i * 1.7;
          p.position.x = (i ? 0.13 : -0.13) + Math.cos(a) * 0.045;
          p.position.y = Math.sin(a) * 0.045;
        });
        if (done(3)) {
          this.eyes.scale.setScalar(0.001);
          this.setScreen('doc');
        }
        break;
      }
      case 'antenna': {
        // The rabbit ears dance and the picture gives up.
        this.antenna.forEach((rod, i) => (rod.rotation.z = (i ? ANTENNA : -ANTENNA) + Math.sin(t * (18 + i * 3) + i) * 0.55));
        this.tvBody.scale.y = 1 + Math.sin(t * 24) * 0.025;
        this.setScreen(t > 0.3 && t < 2.8 ? 'bars' : 'doc');
        if (done(3)) {
          this.antenna.forEach((rod, i) => (rod.rotation.z = i ? ANTENNA : -ANTENNA));
          this.tvBody.scale.y = 1;
          this.setScreen('doc');
        }
        break;
      }
      case 'vacuum': {
        // A robot vacuum in a party hat spins across the rug.
        const v = this.vacuum;
        v.position.set(-8.5 + (t / 3.4) * 17, 0, 4.7 + Math.sin(t * 2.2) * 0.15);
        v.rotation.y += dt * 9;
        if (done(3.4)) v.visible = false;
        break;
      }
    }
  }
}

const CRACKS = ['Pfft!', 'Hahaha!', 'Snrk!', 'Hehe!', 'Bwahaha!'];

export const minigame: Minigame = {
  id: 'giggle',
  title: 'Giggle Fit',
  how: 'A very serious documentary is on, and silly things keep happening. Hold your phone still to keep a straight face: wobble and you crack up, last one composed wins!',
  controller: 'still',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const view = new LivingRoom(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    const sitters = seats.map(() => newSitter());
    const cpus = seats.map(() => newCpuSitter());
    const skill = seats.map(() => ctx.skill());
    const wobble = seats.map(() => 0);
    const warnedAt = seats.map(() => -10);
    const plan = sillySchedule(rng);
    let nextSilly = 0;
    session.setLayoutAll(() => ({ kind: 'still', note: 'Keep a straight face: hold your phone still!' }));
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'still' && seat < n && !session.isCpu(seat)) wobble[seat] = msg.wobble;
    });

    let endAt: number = GIGGLE.duration;
    let lastCalled = false;
    let hudAt = -1;
    let end = 0;
    ui.caption('Keep a straight face: hold your phone still!');
    await everyFrame(clock, (dt, t) => {
      end = Math.min(t, GIGGLE.duration);
      while (nextSilly < plan.length && t >= (plan[nextSilly] as { at: number }).at) {
        const kind = (plan[nextSilly] as { kind: Silly }).kind;
        view.silly(kind);
        SOUNDS[kind](sfx);
        nextSilly++;
      }
      const silly = sillyAt(plan, t) !== null;
      sitters.forEach((s, i) => {
        if (s.crackedAt !== null) return;
        if (session.isCpu(i)) wobble[i] = cpuWobble(cpus[i] as CpuSitter, rng, skill[i] ?? 0.5, dt, t, silly);
        const before = s.giggle;
        if (stepSitter(s, wobble[i] ?? 0, dt, t, silly)) {
          const seat = seats[i] as MinigameSeat;
          view.crackUp(i);
          view.float(i, CRACKS[Math.floor(rng() * CRACKS.length)] as string, seat.color, 0.75, 1.6);
          for (let k = 1; k <= 4; k++) void clock.wait(k * 0.45).then(() => view.float(i, 'ha', '#ffffff', 0.4, 1.1));
          giggleSound(sfx, i);
          session.send(i, { t: 'buzz', pattern: [60, 40, 60, 40, 140] });
          session.setLayout(i, { kind: 'wait', title: 'You cracked up!', text: `You kept a straight face for ${t.toFixed(1)} s. Now try to make the others laugh…` });
        } else if (before < GIGGLE.warn && s.giggle >= GIGGLE.warn && t - (warnedAt[i] ?? 0) > 0.8) {
          warnedAt[i] = t;
          session.send(i, { t: 'buzz', pattern: [25] });
          view.seats[i]?.companion.react('thinking', 0.6);
        }
        view.showComposure(i, composure(s), s.giggle);
      });
      // Phones show their composure too (a few times a second is plenty).
      if (t - hudAt > 0.2) {
        sitters.forEach((s, i) => {
          if (s.crackedAt === null && !session.isCpu(i)) session.send(i, { t: 'meter', value: Math.min(1, s.giggle), danger: s.giggle >= GIGGLE.warn });
        });
      }

      const composed = sitters.filter((s) => s.crackedAt === null).length;
      if (n > 1 && composed === 1 && !lastCalled) {
        lastCalled = true;
        endAt = Math.min(endAt, t + GIGGLE.lastOne);
        const last = seats[sitters.findIndex((s) => s.crackedAt === null)];
        if (last) ui.caption(`${last.name} is the last straight face! Hold it…`, last.color);
      }
      if (composed === 0) endAt = Math.min(endAt, t + 1.2);

      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(endAt - t);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: sitters[i]?.crackedAt != null ? `Cracked at ${(sitters[i]?.crackedAt as number).toFixed(1)} s` : 'Composed' })));
      }
      return t >= endAt;
    });
    off();
    ui.timer(null);
    ui.caption(null);
    sitters.forEach((s, i) => {
      if (s.crackedAt === null) view.seats[i]?.companion.react('approval', 2);
    });
    const scores = giggleScores(sitters, end);
    return {
      scores: scores.map((v, i) => (sitters[i]?.crackedAt === null ? v + 0.05 : v)),
      details: sitters.map((s, i) => (s.crackedAt === null ? `Never cracked! ${(scores[i] ?? 0).toFixed(1)} s` : `Straight face for ${(scores[i] ?? 0).toFixed(1)} s`)),
    };
  },
};
