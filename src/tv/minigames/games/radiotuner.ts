// Late Night Radio on the TV: a windowsill at night, city lights outside, and an old radio for everyone with their
// companion beside it. The room hisses with soft static. Each radio shows its own dial and needle, a row of signal
// lamps and a speaker grille that crackles less the closer you get; tuned in, the grille bobs to the music.
import * as THREE from 'three';
import {
  RADIO,
  type Station,
  type Tuner,
  checkLock,
  clarity,
  freqOf,
  inBand,
  lockPoints,
  lockProgress,
  moveTuner,
  newCpuTuner,
  newTuner,
  planStations,
  radioScores,
  stepCpuTuner,
} from '../../../game/minigames/radiotuner';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, lanes, noise, tone } from '../kit';
import { LIGHTING } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ROUNDED_FONT, SKIES, applySky, ball, box, canvasTexture, cyl, gem, material, mix, nameCard, part, plane, rbox, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SPACING = 2.85;
const W = 2.2; // radio body
const H = 1.35;
const D = 0.8;
const FACE = D / 2;
const COMP_H = 2.0; // stands behind the radio, peeking over it
const COMP_Z = -0.85;
const TILT = 0.28;
const DIAL = { x: 0.54, y: 1.0, w: 0.92, h: 0.4 };
const SPK = { x: -0.55, y: 0.66, w: 0.92, h: 0.96 }; // the speaker grille
/** Where 88 and 108 sit on the dial texture (fractions of its width). */
const DIAL_PAD = 24 / 512;
const BODY_COLORS = [P.linen, P.sage, P.clay, P.duskWall] as const;
const OFF = P.slate; // a signal lamp that is out
const DRESS = 5; // the foundation's props, scaled up: a radio is as wide as a companion is tall

/** Scales a foundation prop, and the reach of the lamp inside it, to this scene's size. */
function sized<T extends THREE.Object3D>(o: T, s: number): T {
  o.scale.multiplyScalar(s);
  o.traverse((c) => {
    const l = c as THREE.PointLight;
    if (!l.isPointLight) return;
    l.distance *= s;
    l.intensity *= s ** l.decay;
  });
  return o;
}
const LAMP_AT = [0.05, 0.2, 0.36, 0.52, 0.66] as const; // clarity for each green lamp
const GREEN = '#7fd68a';
const GOLD = P.lamp;
const STEP = 0.34; // seconds per eighth note
const slatY = (k: number) => SPK.y - SPK.h / 2 + 0.16 + k * ((SPK.h - 0.32) / 4);

// ------------------------------------------------------------------ sound

/** Soft looping hiss for the whole room; quieter as someone gets close. */
class Hiss {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  constructor(private readonly sfx: Sfx) {
    const a = sfx.audio;
    if (!a) return;
    const ctx = a.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let crackle = 0;
    for (let i = 0; i < data.length; i++) {
      if (Math.random() < 0.0004) crackle = 1;
      crackle *= 0.995;
      data[i] = (Math.random() * 2 - 1) * (0.55 + crackle * 0.8);
    }
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 0.5;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src.connect(filter).connect(this.gain).connect(a.out);
    this.src.start();
  }

  set(level: number): void {
    const ctx = this.sfx.audio?.ctx;
    if (!ctx || !this.gain) return;
    this.gain.gain.setTargetAtTime(0.055 * level, ctx.currentTime, 0.08);
  }

  stop(): void {
    try {
      this.src?.stop();
    } catch {
      // already stopped
    }
    this.gain?.disconnect();
  }
}

/** Four little lo-fi tunes: eight steps each, semitones above the root (null: a rest). */
const TUNES: readonly (readonly (number | null)[])[] = [
  [7, null, 10, 12, null, 10, 7, 3],
  [0, 3, 7, null, 5, 3, null, 0],
  [12, 10, null, 7, 10, null, 5, 7],
  [3, null, 5, 7, 10, 7, null, 5],
];
const ROOTS = [220, 196, 246.94, 174.61] as const;

/** One step of the station's tune at loudness `g` (0..1). */
function playStep(sfx: Sfx, tune: number, step: number, g: number): void {
  if (g < 0.04) return;
  const notes = TUNES[tune % TUNES.length] as readonly (number | null)[];
  const root = ROOTS[tune % ROOTS.length] as number;
  const s = step % notes.length;
  const n = notes[s];
  if (n !== null && n !== undefined) tone(sfx, { freq: root * 2 ** (n / 12), dur: 0.32, type: 'triangle', gain: 0.1 * g });
  if (s === 0) tone(sfx, { freq: root / 2, dur: 0.62, type: 'sine', gain: 0.13 * g });
  if (s === 4) tone(sfx, { freq: (root * 2 ** (5 / 12)) / 2, dur: 0.62, type: 'sine', gain: 0.12 * g });
  if (s % 2 === 1) noise(sfx, { dur: 0.04, filter: 'highpass', freq: 6500, gain: 0.05 * g });
}

function chime(sfx: Sfx): void {
  tone(sfx, { freq: 784, dur: 0.16, gain: 0.12 });
  tone(sfx, { freq: 1175, dur: 0.3, gain: 0.1, delay: 0.09 });
}

// ------------------------------------------------------------------ the radios

function dialTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 220, (ctx, w, h) => {
    ctx.fillStyle = P.cream;
    ctx.fillRect(0, 0, w, h);
    const left = DIAL_PAD * w;
    const right = w - left;
    ctx.strokeStyle = P.espresso;
    ctx.fillStyle = P.espresso;
    for (let k = 0; k <= 40; k++) {
      const x = left + (k / 40) * (right - left);
      const major = k % 8 === 0;
      ctx.lineWidth = major ? 5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(x, h * 0.6);
      ctx.lineTo(x, h * (major ? 0.3 : k % 2 === 0 ? 0.42 : 0.5));
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 38px ${ROUNDED_FONT}`;
    for (let k = 0; k <= 5; k++) ctx.fillText(String(88 + k * 4), left + (k / 5) * (right - left), h * 0.8);
    ctx.font = `600 26px ${ROUNDED_FONT}`;
    ctx.fillText('FM', w / 2, h * 0.14);
  });
}

interface Rig {
  seat: MinigameSeat;
  companion: Companion;
  root: THREE.Group;
  needle: THREE.Mesh;
  knob: THREE.Group;
  lamps: THREE.Mesh[];
  lockFill: THREE.Group;
  slats: THREE.Mesh[];
  specks: THREE.Mesh[];
  tip: THREE.Mesh;
  dial: THREE.MeshBasicMaterial;
  marker: THREE.Mesh;
  /** The needle as shown (eased). */
  shown: number;
  clear: number;
  locked: boolean;
  /** 1 at the moment of locking in, easing to 0: the radio gives a happy little jump. */
  pulse: number;
}

class Windowsill implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 220);
  readonly rigs: Rig[] = [];
  readonly floaters: Floaters;
  private readonly fit: CameraFit;
  private readonly marks: Mark[] = [];
  private readonly dialTex = dialTexture();
  private readonly dialMats: THREE.MeshBasicMaterial[] = [];
  private beat = 0;
  private staticAt = 0;
  private readonly tick: (dt: number, time: number) => void;
  private readonly dressing = new THREE.Group();

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    // The night sky outside, the room's warm lamplight inside: the key light comes from the room, behind the camera.
    applySky(this.scene, { ...SKIES.night, ...LIGHTING.lampInterior, sunFrom: [-0.35, 0.8, 0.75], sunIntensity: 1.05, sunGlow: 0 }, { near: 40, far: 210 }, 12);
    this.floaters = new Floaters(this.scene);
    this.fit = new CameraFit(this.camera, TILT);
    const n = seats.length;
    const xs = lanes(n, SPACING);
    const width = n * SPACING + 3;
    this.buildRoom(width);
    this.scene.add(this.dressing);
    this.tick = props.tickProps(this.dressing);

    seats.forEach((seat, i) => {
      const x = xs[i] ?? 0;
      const rx = x;
      const c = companions[i] as Companion;
      c.root.position.set(x + 0.25, 0, COMP_Z);
      c.setBase('listening');
      this.scene.add(c.root);
      const rig = this.buildRadio(seat, i, c, rx);
      this.rigs.push(rig);
      const card = nameCard(seat.name, seat.color, 0.9);
      card.position.set(x, 0.16, 1.25);
      this.scene.add(card);
      this.marks.push(
        { p: new THREE.Vector3(rx - W / 2 - 0.25, 0, FACE) },
        { p: new THREE.Vector3(rx + W / 2, 0, FACE) },
        { p: new THREE.Vector3(rx - W / 2 - 0.25, H + 1.25, -0.2) },
        { p: new THREE.Vector3(x + 0.25, COMP_H + 0.15, COMP_Z) },
        { p: new THREE.Vector3(x, 0.16, 1.25), pad: 0.06 },
      );
    });
  }

  /** The windowsill, the window and its curtains, the wall and radiator under it, and the city outside. */
  private buildRoom(width: number): void {
    const s = this.dressing;
    const wall = '#6d6480';
    const paint = P.linen;
    const flat = { outline: false as const };
    // The sill and the wall under it, with a radiator and plants growing up past the sill.
    part(s, rbox(width + 9, 0.26, 2.9, 0.08), paint, -1.5, -0.13, 0.1, { tex: 'wood', texStrength: 0.45 });
    part(s, box(width + 40, 9, 0.3), wall, 0, -4.7, 1.3, { tex: 'plaster', outline: false, shadow: false });
    part(s, box(width + 40, 0.3, 0.12), mix(wall, P.ink, 0.3), 0, -0.42, 1.48, flat);
    const iron = mix(P.ceramic, wall, 0.4);
    const ribs = Math.round(width / 0.62);
    for (let k = 0; k < ribs; k++) part(s, rbox(0.34, 2.3, 0.3, 0.12), iron, (k - (ribs - 1) / 2) * 0.46 + 0.6, -2.3, 1.75, { outline: false, gloss: 0.35 });
    for (const y of [-1.25, -3.35]) part(s, rbox(ribs * 0.46 + 0.1, 0.16, 0.2, 0.06), iron, 0.6, y, 1.75, { outline: false, gloss: 0.35 });
    part(s, cyl(0.07, 0.07, 1.4, 8), P.brass, 0.6 - (ribs * 0.46) / 2 - 0.2, -3.9, 1.75, { outline: false, gloss: 0.6 });
    // The window frame around the night, a wall to either side and above.
    for (const sx of [-1, 1]) part(s, rbox(0.4, 7, 0.4, 0.08), paint, sx * (width / 2 + 0.6), 3.4, -1.2, { tex: 'wood', texStrength: 0.3 });
    part(s, rbox(width + 1.6, 0.4, 0.4, 0.08), paint, 0, 6.8, -1.2, { tex: 'wood', texStrength: 0.3 });
    part(s, rbox(0.18, 6.6, 0.2, 0.05), paint, 0, 3.4, -1.25, flat);
    part(s, rbox(width + 1.2, 0.16, 0.2, 0.05), paint, 0, 3.6, -1.25, flat);
    part(s, box(width + 40, 8, 0.3), wall, 0, 11, -1.4, { tex: 'plaster', outline: false, shadow: false });
    for (const sx of [-1, 1]) part(s, box(14, 16, 0.3), wall, sx * (width / 2 + 7.8), 3, -1.4, { tex: 'plaster', outline: false, shadow: false });
    const curtains = sized(props.curtains({ w: (width + 1.4) / 4, h: 6.5 / 4, color: mix(P.mauve, P.plum, 0.55), open: 0.86, rail: P.brass }), 4);
    curtains.position.set(0, 3.45, -1.35);
    s.add(curtains);
    s.add(props.stringLights(new THREE.Vector3(-width / 2 - 0.4, 6.45, -0.95), new THREE.Vector3(width / 2 + 0.4, 6.45, -0.95), { sag: 0.3, count: Math.round(width * 1.3), bulb: 0.07 }));
    // Outside: a sleepy city under the moon.
    s.add(props.skyline({ radius: 125, seed: 17, base: '#161a3c', windows: '#d9a868', y: -36, height: 62 }));
    s.add(props.skyline({ radius: 85, seed: 6, base: '#0e1228', windows: '#a07848', y: -34, height: 44 }));
    part(s, sphere(2.2, 20), P.moon, width * 0.3, 15, -75, { glow: 1.5, outline: false, shadow: false });
    // On the sill: a lamp, a plant, a mug, a few books, a candle.
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, k = 1) => {
      sized(o, DRESS * k);
      o.position.set(x, 0, z);
      o.rotation.y = ry;
      s.add(o);
    };
    const left = -width / 2;
    put(props.tableLamp({ lit: true, light: 1.1, stand: P.terracotta, shade: P.cream }), left - 1.3, 0.2, 0, 1.1);
    put(props.plant({ kind: 'snake', h: 0.5, pot: P.terracotta, seed: 2 }), left - 3.0, -0.2);
    put(props.books(0.34, 5, { h: 0.2 }), left - 4.6, 0.3, 0.4);
    put(props.mug({ color: P.teal }), left - 0.2, 0.75, 0.8);
    put(props.candle({ h: 0.1 }), width / 2 + 0.25, 0.5, 0, 0.8);
    put(props.mug({ color: P.ceramic }), width / 2 + 1.2, 0.1, -0.5);
    // Leaves coming up from the room below the sill, in the front corners.
    for (const [x, kind, seed] of [
      [left - 2.2, 'monstera', 4],
      [width / 2 + 1.4, 'ficus', 7],
    ] as const) {
      const plant = sized(props.plant({ kind, h: 1.1, pot: P.charcoal, seed }), 3.6);
      plant.position.set(x, -4.6, 3.1);
      s.add(plant);
    }
  }

  private buildRadio(seat: MinigameSeat, i: number, companion: Companion, x: number): Rig {
    const root = new THREE.Group();
    root.position.set(x, 0.06, 0);
    this.scene.add(root);
    const body = BODY_COLORS[i % BODY_COLORS.length] as string;
    for (const fx of [-0.8, 0.8]) part(root, cyl(0.08, 0.1, 0.08, 10), P.ink, fx, -0.02, 0);
    part(root, rbox(W, H, D, 0.16), body, 0, H / 2, 0, { gloss: 0.3 });
    part(root, rbox(W + 0.02, 0.14, D + 0.02, 0.05), seat.color, 0, 0.12, 0, { gloss: 0.3 });
    // a leather carrying handle on top
    part(root, torus(0.42, 0.035, Math.PI), P.walnut, 0.3, H - 0.02, 0, { tex: 'leather', outline: 0.014 });
    for (const hx of [-0.12, 0.72]) part(root, cyl(0.06, 0.06, 0.05, 10), P.brass, hx, H + 0.01, 0, { outline: false, gloss: 0.6 });
    // The antenna, with a tip that lights up once you're tuned in.
    part(root, cyl(0.02, 0.02, 1.2, 6), P.stone, -0.9 - 0.206, H + 0.563, -0.2, { rz: 0.35, gloss: 0.7 });
    const tip = part(root, ball(0.065, 1), P.stone, -0.9 - 0.411, H + 1.127, -0.2);

    // The speaker: a dark panel, slats, and the specks of static.
    part(root, rbox(SPK.w, SPK.h, 0.06, 0.08), P.espresso, SPK.x, SPK.y, FACE, { tex: 'fabric' });
    const slats: THREE.Mesh[] = [];
    for (let k = 0; k < 5; k++) slats.push(part(root, rbox(SPK.w - 0.16, 0.08, 0.05, 0.03), mix(body, P.cream, 0.4), SPK.x, slatY(k), FACE + 0.04, { outline: 0.012 }));
    const specks: THREE.Mesh[] = [];
    for (let k = 0; k < 14; k++) {
      const m = part(root, ball(0.036, 0), P.cream, SPK.x, SPK.y, FACE + 0.08, { basic: true, shadow: false });
      m.visible = false;
      specks.push(m);
    }

    // The dial and its needle.
    part(root, rbox(DIAL.w + 0.1, DIAL.h + 0.1, 0.05, 0.04), P.brass, DIAL.x, DIAL.y, FACE, { gloss: 0.6 });
    const dial = new THREE.MeshBasicMaterial({ map: this.dialTex, toneMapped: false });
    this.dialMats.push(dial);
    const face = new THREE.Mesh(plane(DIAL.w, DIAL.h), dial);
    face.position.set(DIAL.x, DIAL.y, FACE + 0.03);
    root.add(face);
    const needle = part(root, rbox(0.03, DIAL.h * 0.86, 0.02, 0.01), P.accent, DIAL.x, DIAL.y, FACE + 0.05, { outline: false, shadow: false });
    const marker = part(root, gem(0.06), GOLD, DIAL.x, DIAL.y + DIAL.h / 2 + 0.02, FACE + 0.08, { glow: 1, shadow: false });
    marker.visible = false;

    // Signal lamps, the hold bar, the tuning knob.
    const lamps: THREE.Mesh[] = [];
    for (let k = 0; k < 6; k++) lamps.push(part(root, ball(0.052, 1), OFF, 0.15 + k * 0.11, 0.66, FACE + 0.02, { outline: false }));
    part(root, rbox(0.56, 0.08, 0.03, 0.03), P.ink, 0.4, 0.42, FACE + 0.01, { outline: false });
    const lockFill = new THREE.Group();
    lockFill.position.set(0.14, 0.42, FACE + 0.03);
    part(lockFill, rbox(0.52, 0.055, 0.03, 0.02), GOLD, 0.26, 0, 0, { glow: 0.8, outline: false, shadow: false });
    lockFill.scale.x = 0.001;
    root.add(lockFill);
    const knob = new THREE.Group();
    knob.position.set(0.88, 0.42, FACE + 0.04);
    part(knob, cyl(0.14, 0.14, 0.1, 16), P.walnut, 0, 0, 0, { rx: Math.PI / 2, gloss: 0.3 });
    part(knob, cyl(0.09, 0.09, 0.02, 16), P.brass, 0, 0, 0.055, { rx: Math.PI / 2, outline: false, gloss: 0.6 });
    part(knob, rbox(0.03, 0.1, 0.02, 0.01), P.cream, 0, 0.06, 0.07, { outline: false });
    root.add(knob);

    return { seat, companion, root, needle, knob, lamps, lockFill, slats, specks, tip, dial, marker, shown: 0.5, clear: 0, locked: false, pulse: 0 };
  }

  /** Shows a seat's radio: needle, lamps, the hold and how much static there is. */
  show(i: number, t: Tuner, station: number, now: number, dt: number): void {
    const r = this.rigs[i];
    if (!r) return;
    const locked = t.lockedAt !== null;
    if (locked && !r.locked) r.pulse = 1;
    r.locked = locked;
    r.shown += (t.value - r.shown) * (1 - Math.exp(-dt * 18));
    r.clear = locked ? 1 : clarity(r.shown, station);
    r.needle.position.x = DIAL.x - DIAL.w / 2 + DIAL.w * (DIAL_PAD + r.shown * (1 - 2 * DIAL_PAD));
    r.knob.rotation.z = -r.shown * 6;
    const band = locked || inBand(t.value, station);
    r.lamps.forEach((l, k) => {
      const lit = k < 5 ? r.clear >= (LAMP_AT[k] ?? 1) : band;
      l.material = lit ? material(locked ? GOLD : k < 5 ? GREEN : GOLD, { glow: 1.3 }) : material(OFF);
    });
    r.lockFill.scale.x = Math.max(0.001, lockProgress(t, now));
    r.tip.material = material(locked ? GOLD : P.stone, locked ? { glow: 2 } : {});
    r.dial.color.set(locked ? P.glow : '#ffffff');
  }

  /** The station's spot on every dial, after the round. */
  reveal(station: number | null): void {
    for (const r of this.rigs) {
      r.marker.visible = station !== null;
      if (station !== null) r.marker.position.x = DIAL.x - DIAL.w / 2 + DIAL.w * (DIAL_PAD + station * (1 - 2 * DIAL_PAD));
    }
  }

  /** A beat of the tune: grilles of radios that are coming through bob, and some puff out a note. */
  onBeat(note: boolean): void {
    this.beat = 1;
    if (!note) return;
    for (const r of this.rigs) {
      if (r.clear > 0.55 && Math.random() < r.clear) {
        const at = r.root.position.clone().add(new THREE.Vector3(SPK.x + (Math.random() - 0.5) * 0.5, SPK.y + SPK.h / 2 + 0.1, FACE + 0.25));
        this.floaters.add(Math.random() < 0.5 ? '♪' : '♫', mix(r.seat.color, P.cream, 0.35), at, 0.32, 1.3);
      }
    }
  }

  above(i: number): THREE.Vector3 {
    const r = this.rigs[i];
    return r ? r.root.position.clone().add(new THREE.Vector3(0.25, COMP_H + 0.4, COMP_Z + 0.3)) : new THREE.Vector3();
  }

  dispose(): void {
    for (const r of this.rigs) r.companion.dispose();
    for (const m of this.dialMats) m.dispose();
    this.dialTex.dispose();
    this.floaters.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    this.tick(dt, time);
    this.floaters.update(dt);
    this.beat = Math.max(0, this.beat - dt * 4);
    const refresh = time - this.staticAt > 0.05;
    if (refresh) this.staticAt = time;
    for (const r of this.rigs) {
      r.companion.update(dt);
      const fuzz = 1 - r.clear;
      const bob = this.beat * r.clear;
      r.pulse = Math.max(0, r.pulse - dt * 3);
      const jump = Math.sin(r.pulse * Math.PI) * 0.07;
      r.root.scale.set(1 + bob * 0.012 + jump * 0.6, 1 + bob * 0.03 + jump, 1 + jump * 0.6);
      if (refresh) {
        r.slats.forEach((s, k) => {
          s.position.y = slatY(k) + (Math.random() - 0.5) * 0.03 * fuzz;
          s.position.x = SPK.x + (Math.random() - 0.5) * 0.025 * fuzz;
        });
        for (const sp of r.specks) {
          sp.visible = Math.random() < fuzz * 0.85;
          if (sp.visible) sp.position.set(SPK.x + (Math.random() - 0.5) * (SPK.w - 0.1), SPK.y + (Math.random() - 0.5) * (SPK.h - 0.1), FACE + 0.08);
        }
      }
      r.slats.forEach((s) => (s.scale.z = 1 + bob * 1.5));
    }
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'radiotuner',
  title: 'Late Night Radio',
  how: 'A little station is playing somewhere on the dial. Slide to tune YOUR radio on the TV: the clearer it gets, the closer you are. Hold steady on the station to lock in. First to lock in scores most.',
  controller: 'slider',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const skill = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : 0.5));
    const stations = planStations(rng);
    const view = new Windowsill(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: COMP_H }))));
    ctx.stage.setView(view);
    const hiss = new Hiss(sfx);
    const points = seats.map(() => 0);
    const totalTime = seats.map(() => 0);
    const tunedIn = seats.map(() => 0);
    let tuners: Tuner[] = seats.map(() => newTuner(0.5));
    const live = () =>
      ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${points[i]} pts${tuners[i]?.lockedAt !== null ? ' ✓' : ''}` })));
    live();

    let station: Station = stations[0] as Station;
    let tuning = false;
    let roundStart = clock.time;
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'slider' || seat >= n || session.isCpu(seat) || !tuning) return;
      const t = tuners[seat];
      if (!t) return;
      // Judged from when the phone moved: half its round trip earlier than the message got here.
      const lag = ((session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed;
      moveTuner(t, msg.value, clock.time - roundStart - lag, station.at);
    });

    for (let round = 0; round < stations.length; round++) {
      station = stations[round] as Station;
      tuners = seats.map(() => newTuner(station.start));
      view.rigs.forEach((r) => {
        r.shown = station.start;
        r.companion.setBase('listening');
      });
      view.reveal(null);
      const cpus = seats.map((_, i) => (session.isCpu(i) ? newCpuTuner(rng, station.start, skill[i] ?? 0.5) : null));
      session.setLayoutAll(() => ({
        kind: 'slider',
        note: `Station ${round + 1} of ${stations.length}: watch YOUR radio on the TV. Find it, then hold still.`,
        low: '88',
        high: '108',
        done: null,
        value: station.start,
      }));
      ui.caption(`Station ${round + 1} of ${stations.length}: tune in and hold still`);
      live();
      roundStart = clock.time;
      tuning = true;
      let step = 0;
      let nextStep = 0;
      let doneAt: number | null = null;
      await everyFrame(clock, (dt, t) => {
        let loudest = 0;
        tuners.forEach((tu, i) => {
          const cpu = cpus[i];
          if (cpu && session.isCpu(i)) moveTuner(tu, stepCpuTuner(cpu, rng, station.at, dt), t, station.at);
          if (checkLock(tu, t)) {
            chime(sfx);
            const seat = seats[i] as MinigameSeat;
            const c = view.rigs[i]?.companion;
            c?.setBase('happy');
            c?.react('happy', 1.6);
            view.floaters.add('Tuned in!', seat.color, view.above(i), 0.5, 1.4);
            if (!session.isCpu(i)) {
              session.send(i, { t: 'buzz', pattern: [40, 40, 80] });
              session.setLayout(i, { kind: 'wait', title: 'Tuned in!', text: `${station.name} on ${freqOf(station.at)}. Lovely.` });
            }
            live();
          }
          view.show(i, tu, station.at, t, dt);
          loudest = Math.max(loudest, tu.lockedAt !== null ? 1 : clarity(tu.value, station.at));
        });
        hiss.set(0.25 + 0.75 * (1 - loudest));
        if (t >= nextStep) {
          const notes = TUNES[station.tune % TUNES.length] as readonly (number | null)[];
          const hasNote = notes[step % notes.length] !== null;
          playStep(sfx, station.tune, step, loudest ** 1.5);
          view.onBeat(hasNote && step % 2 === 0);
          step++;
          nextStep = Math.max(nextStep + STEP, t);
        }
        ui.timer(RADIO.roundTime - t);
        const locked = tuners.filter((x) => x.lockedAt !== null).length;
        if (doneAt === null && locked >= Math.min(n, RADIO.scorers)) doneAt = t + 0.7;
        return t >= RADIO.roundTime || (doneAt !== null && t >= doneAt);
      });
      tuning = false;
      ui.timer(null);

      // Round over: the station's spot shows on every dial, points for the first three.
      const pts = lockPoints(tuners.map((x) => x.lockedAt));
      view.reveal(station.at);
      pts.forEach((p, i) => {
        const tu = tuners[i] as Tuner;
        points[i] = (points[i] ?? 0) + p;
        totalTime[i] = (totalTime[i] ?? 0) + (tu.lockedAt ?? RADIO.roundTime + 2);
        if (tu.lockedAt !== null) tunedIn[i] = (tunedIn[i] ?? 0) + 1;
        if (p > 0) view.floaters.add(`+${p}`, seats[i]?.color ?? '#fff', view.above(i).add(new THREE.Vector3(0, 0.5, 0)), 0.55, 1.5);
        else view.rigs[i]?.companion.react('sad', 1.4);
        session.setLayout(i, {
          kind: 'wait',
          title: p > 0 ? `+${p} point${p > 1 ? 's' : ''}` : tu.lockedAt !== null ? 'Tuned in, but a bit late' : 'Lost in the static',
          text: `It was ${station.name} on ${freqOf(station.at)}.`,
        });
      });
      if (pts.some((p) => p > 0)) sfx.good();
      ui.caption(`That was ${station.name} on ${freqOf(station.at)}`, GOLD);
      live();
      await everyFrame(clock, (dt, t) => {
        tuners.forEach((tu, i) => view.show(i, tu, station.at, clock.time - roundStart, dt));
        hiss.set(0.4);
        return t >= 1.8;
      });
    }
    off();
    hiss.stop();
    ui.timer(null);
    ui.caption(null);
    seats.forEach((_, i) => view.rigs[i]?.companion.setBase('idle'));
    return {
      scores: radioScores(points, totalTime),
      details: points.map((p, i) => `${p} pts · tuned in to ${tunedIn[i]} of ${stations.length}`),
    };
  },
};
