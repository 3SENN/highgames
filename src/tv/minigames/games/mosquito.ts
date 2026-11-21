// Mosquito on the TV: a dim bedroom at night, everyone sitting up in one big bed, and mosquitos whining about
// in the air above them. Each player's pointer (the phone, pointed at the TV) is a ring in their colour; a swat
// covers the ring. Every mosquito has its own soft buzz that pans with it across the room.
import * as THREE from 'three';
import {
  MOSQ,
  type Mosquito,
  type SwatCpu,
  type SwatResult,
  type Swatter,
  applySwat,
  canSwat,
  cpuSwat,
  flyingAt,
  fromPointer,
  mosquitoAt,
  mosquitoScores,
  newSwarm,
  newSwatCpu,
  newSwatter,
  stepSwarm,
  swat,
} from '../../../game/minigames/mosquito';
import { shuffle } from '../../../game/rng';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, lanes, noise, tone } from '../kit';
import { type Env, bedroom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, canvasTexture, cyl, gem, mix, nameCard, part, pill, rbox, seeded, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const MID_Y = 4.6; // the middle of the air the pointers cover
const BED_Y = 0.62;
const HEIGHT = 1.2;
const COMP_Z = 1.0;
const TILT = 0.1;
const STEP = 1 / 60;
const ROOM = 2.2; // the foundation's bedroom, scaled up to this scene's size
const WALL_Z = -2.9;

/** Scales a foundation prop or set, and the reach of the lamps inside it, to this scene's size. */
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

// ------------------------------------------------------------------ sounds

/** A mosquito's whine: a buzzy tone with a fast wobble, panned to where it flies. */
class Buzz {
  private readonly osc: OscillatorNode;
  private readonly lfo: OscillatorNode;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode | null;
  private readonly ctx: AudioContext;

  constructor(audio: { ctx: AudioContext; out: AudioNode }, gold: boolean) {
    const { ctx, out } = audio;
    this.ctx = ctx;
    const t0 = ctx.currentTime;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = gold ? 380 + Math.random() * 40 : 560 + Math.random() * 120;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 16 + Math.random() * 8;
    const depth = ctx.createGain();
    depth.gain.value = gold ? 10 : 18;
    this.lfo.connect(depth).connect(this.osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = gold ? 900 : 1400;
    filter.Q.value = 1.2;
    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0.0001, t0);
    this.gain.gain.exponentialRampToValueAtTime(gold ? 0.05 : 0.035, t0 + 0.4);
    this.pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    this.osc.connect(filter).connect(this.gain);
    if (this.pan) this.gain.connect(this.pan).connect(out);
    else this.gain.connect(out);
    this.osc.start(t0);
    this.lfo.start(t0);
  }

  /** x: -1 (left) .. 1 (right). */
  move(x: number): void {
    this.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, x)) * 0.85, this.ctx.currentTime, 0.05);
  }

  stop(): void {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0.0001, t, 0.03);
    this.osc.stop(t + 0.25);
    this.lfo.stop(t + 0.25);
  }
}

function slap(sfx: Sfx): void {
  noise(sfx, { dur: 0.09, filter: 'bandpass', freq: 1800, to: 900, gain: 0.45 });
}

function ow(sfx: Sfx): void {
  slap(sfx);
  tone(sfx, { freq: 520, to: 330, dur: 0.28, type: 'triangle', gain: 0.12, delay: 0.06 });
}

function whiff(sfx: Sfx): void {
  noise(sfx, { dur: 0.12, filter: 'highpass', freq: 1500, gain: 0.12 });
}

// ------------------------------------------------------------------ mosquitos

function mosquitoMesh(gold: boolean, haloMap: THREE.Texture): { group: THREE.Group; body: THREE.Group; wings: THREE.Mesh[]; halo: THREE.Mesh } {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const shell = gold ? P.mustard : '#4a3f3a';
  const o = gold ? { glow: 0.55, gloss: 0.5 } : { gloss: 0.35 };
  withOutline(0.012, () => {
    part(body, pill(0.06, 0.26), gold ? P.brass : P.espresso, -0.2, -0.04, 0, { rz: 1.25, ...o });
    for (const x of [-0.13, -0.2, -0.27]) part(body, torus(0.062, 0.012), gold ? P.copper : P.stone, x, -0.02 - (x + 0.13) * 0.4, 0, { ry: Math.PI / 2, rz: 1.25, outline: false });
    part(body, ball(0.085, 1), shell, 0, 0.02, 0, o);
    part(body, ball(0.055, 1), shell, 0.1, 0.03, 0, o);
    part(body, ball(0.022, 1), P.ember, 0.13, 0.05, 0.03, { glow: 1.2, outline: false, shadow: false });
    part(body, cyl(0.008, 0.004, 0.2, 4), P.ink, 0.2, -0.04, 0, { rz: 1.9, outline: false });
    for (let k = 0; k < 6; k++) {
      const x = -0.05 + (k % 3) * 0.05;
      part(body, cyl(0.006, 0.006, 0.26, 4), P.ink, x, -0.12, k < 3 ? 0.04 : -0.04, { rz: 0.25 - (k % 3) * 0.2, rx: k < 3 ? 0.2 : -0.2, outline: false });
    }
  });
  const wingMat = new THREE.MeshBasicMaterial({ color: gold ? P.glow : P.moon, transparent: true, opacity: 0.5, depthWrite: false });
  // Seen from the side: two long, see-through wings swept back over the body.
  const wings = [-1, 1].map((s) => {
    const w = new THREE.Mesh(ball(0.15, 1), wingMat);
    w.scale.set(1.1, 0.3, 0.06);
    w.position.set(-0.12, 0.11, s * 0.03);
    body.add(w);
    return w;
  });
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: haloMap, color: gold ? P.lamp : P.moon, transparent: true, opacity: gold ? 0.6 : 0.34, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  halo.position.z = -0.15;
  halo.scale.setScalar(gold ? 1.5 : 1.0);
  group.add(halo, body);
  group.scale.setScalar(gold ? 2.3 : 1.7);
  return { group, body, wings, halo };
}

interface Bug {
  m: Mosquito;
  group: THREE.Group;
  body: THREE.Group;
  wings: THREE.Mesh[];
  halo: THREE.Mesh;
  buzz: Buzz | null;
  /** Seconds since it was swatted, or -1. */
  splat: number;
  /** The halo's resting size (it bursts when the mosquito is swatted). */
  glow: number;
  vy: number;
  lastX: number;
}

interface Hand {
  group: THREE.Group;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  swatter: THREE.Group;
  ringMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  color: THREE.Color;
  swing: number;
  /** 1 just after a hit, easing to 0: the ring pops. */
  pop: number;
}

// ------------------------------------------------------------------ the bedroom

class Bedroom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  readonly hands: Hand[] = [];
  private readonly bugs = new Map<number, Bug>();
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly haloMap = canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  private readonly cards: THREE.Sprite[] = [];
  private readonly made: { dispose(): void }[] = [];
  private readonly lava: THREE.Mesh[] = [];
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private readonly dressing = new THREE.Group();
  private readonly grey = new THREE.Color(P.duskWall);

  constructor(
    readonly seats: MinigameSeat[],
    readonly people: Companion[],
    private readonly sfx: Sfx,
  ) {
    // The foundation's bedroom at night, scaled up so the wall behind the bed is tall enough for the swarm; the
    // room sits a little left of the bed, as the camera does (the score list covers the left of the screen).
    this.env = bedroom(this.scene, { mood: 'night', bed: false, w: 10.4, d: 5.4, h: 4.5, wall: '#5d6280', lights: false });
    sized(this.env.root, ROOM);
    this.env.root.position.set(-1.7, 0, WALL_Z + (5.4 / 2) * ROOM);
    this.env.sun.intensity = 0.85;
    const cam = this.env.sun.shadow.camera;
    cam.left = cam.bottom = -13;
    cam.right = cam.top = 13;
    cam.updateProjectionMatrix();
    withOutline(0.03, () => this.buildRoom());
    this.scene.add(this.dressing);
    this.tick = props.tickProps(this.dressing);

    const xs = lanes(seats.length, 2.7);
    seats.forEach((s, i) => {
      const x = xs[i] ?? 0;
      const c = people[i];
      if (c) {
        c.root.position.set(x, BED_Y, COMP_Z);
        c.setBase('sleeping');
        this.scene.add(c.root);
      }
      const card = nameCard(s.name, s.color, 0.8);
      card.position.set(x, 0.35, 2.7);
      this.cards.push(card);
      this.scene.add(card);

      // The hand: a ring as big as a swat, a faint fill, and a fly swatter that slaps on a swat.
      const group = new THREE.Group();
      const color = new THREE.Color(s.color);
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
      const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false });
      const ring = new THREE.Mesh(torus(MOSQ.swat, 0.045), ringMat);
      const fill = new THREE.Mesh(cyl(MOSQ.swat, MOSQ.swat, 0.01, 32), fillMat);
      fill.rotation.x = Math.PI / 2;
      ring.renderOrder = 4;
      fill.renderOrder = 4;
      const swatter = new THREE.Group();
      withOutline(0.025, () => {
        part(swatter, rbox(1.2, 1.2, 0.05, 0.16), s.color, 0, 0, 0, { shadow: false, gloss: 0.3 });
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) part(swatter, rbox(0.18, 0.18, 0.06, 0.04), mix(s.color, P.ink, 0.4), a * 0.32, b * 0.32, 0, { outline: false, shadow: false });
        part(swatter, cyl(0.05, 0.05, 1.3, 8), P.linen, 0.55, -1.15, 0, { rz: 0.45, shadow: false });
      });
      swatter.visible = false;
      group.add(fill, ring, swatter);
      group.position.set(x, MID_Y - MOSQ.halfH * 0.6, 0.45);
      this.scene.add(group);
      this.made.push(ringMat, fillMat);
      this.hands.push({ group, ring, fill, swatter, ringMat, fillMat, color, swing: 1, pop: 0 });
    });
  }

  /** The big shared bed, the bedside tables and the things on them. The room itself is the foundation's. */
  private buildRoom(): void {
    const s = this.dressing;
    const rand = seeded(31);
    const w = 13.6;
    // Headboard, frame, mattress, a pillow each, and one long knitted duvet with its top folded back.
    part(s, rbox(w + 0.6, 2.0, 0.3, 0.12), P.walnut, 0, 1.0, -0.55, { tex: 'wood' });
    part(s, rbox(w + 0.9, 0.14, 0.4, 0.05), mix(P.walnut, P.ink, 0.25), 0, 2.04, -0.55, { tex: 'wood', outline: false });
    part(s, rbox(w + 0.4, 0.35, 3.6, 0.1), P.walnut, 0, 0.12, 1.05, { tex: 'wood' });
    part(s, rbox(w, 0.55, 3.4, 0.14), P.cream, 0, 0.32, 1.05, { tex: 'fabric', texStrength: 0.5 });
    const n = Math.max(4, this.seats.length);
    for (let k = 0; k < n; k++) part(s, rbox(2.5, 0.55, 0.8, 0.25), P.ceramic, (k - (n - 1) / 2) * (w / n), 0.9, -0.05, { rx: -0.35, tex: 'fabric', texStrength: 0.4 });
    part(s, rbox(w + 0.2, 0.5, 2.0, 0.22), P.denim, 0, 0.92, 1.85, { tex: 'knit' });
    part(s, rbox(w + 0.3, 0.45, 0.5, 0.2), mix(P.denim, P.cream, 0.55), 0, 0.98, 0.95, { tex: 'fabric', outline: false });
    for (let k = 0; k < 14; k++) part(s, gem(0.07), mix(P.denim, P.moon, 0.55), -6.3 + rand() * 12.6, 1.18, 1.25 + rand() * 0.8, { sy: 0.3, outline: false, shadow: false });
    // Bedside tables: a lamp turned down low on the left, a lava lamp and a book on the right.
    for (const side of [-1, 1]) {
      const table = sized(props.sideTable({ h: 0.5, r: 0.28 }), ROOM);
      table.position.set(side * 7.75, 0, 0.5);
      s.add(table);
    }
    const lamp = sized(props.tableLamp({ lit: true, light: 7, stand: P.brass, shade: P.linen }), ROOM);
    lamp.position.set(-7.75, 0.5 * ROOM, 0.5);
    s.add(lamp);
    const lx = 7.6;
    const ly = 0.5 * ROOM;
    part(s, cyl(0.2, 0.3, 0.34, 14), P.charcoal, lx, ly + 0.17, 0.45, { gloss: 0.4 });
    part(s, pill(0.2, 0.55), P.neonViolet, lx, ly + 0.8, 0.45, { opacity: 0.4, shadow: false });
    for (let k = 0; k < 3; k++) this.lava.push(part(s, sphere(0.08 + k * 0.018, 12), P.neonPink, lx, ly + 0.5 + k * 0.2, 0.45, { glow: 1.6, shadow: false }));
    part(s, cyl(0.13, 0.2, 0.17, 14), P.charcoal, lx, ly + 1.34, 0.45, { gloss: 0.4 });
    const book = sized(props.books(0.3, 4, { h: 0.2 }), ROOM);
    book.position.set(8.05, ly, 0.8);
    book.rotation.set(0, 0.5, 0);
    s.add(book);
    // Pictures on the quiet end of the wall.
    const arts = [
      { art: 'hills', w: 0.75, h: 0.55, x: -7.3, y: 5.5, frame: P.walnut },
      { art: 'leaf', w: 0.42, h: 0.55, x: -5.2, y: 5.9, frame: P.brass },
      { art: 'shapes', w: 0.42, h: 0.36, x: -5.2, y: 4.6, frame: P.charcoal },
    ] as const;
    arts.forEach((a, k) => {
      const f = sized(props.pictureFrame({ w: a.w, h: a.h, art: a.art, frame: a.frame, seed: 3 + k }), ROOM);
      f.position.set(a.x, a.y, WALL_Z + 0.02);
      s.add(f);
    });
    // Dust drifting in the moonlight where the mosquitos fly.
    const motes = props.motes({ n: 12, area: [15, 5.5, 2.5], color: P.moon, size: 0.06, seed: 7 });
    motes.position.set(0, 1.8, 0.4);
    s.add(motes);
  }

  /** A mosquito flies in. */
  add(m: Mosquito): void {
    const { group, body, wings, halo } = mosquitoMesh(m.gold, this.haloMap);
    this.scene.add(group);
    const a = this.sfx.audio;
    this.bugs.set(m.id, { m, group, body, wings, halo, buzz: a ? new Buzz(a, m.gold) : null, splat: -1, glow: halo.scale.x, vy: 0, lastX: 0 });
  }

  swatted(m: Mosquito): void {
    const b = this.bugs.get(m.id);
    if (!b || b.splat >= 0) return;
    b.splat = 0;
    b.vy = 1.6;
    (b.halo.material as THREE.MeshBasicMaterial).opacity = 0.95;
    b.buzz?.stop();
    b.buzz = null;
  }

  /** The hand at a wall position; `ready` false while stunned. */
  setHand(i: number, x: number, y: number, ready: boolean, time: number): void {
    const h = this.hands[i];
    if (!h) return;
    h.group.position.set(x, MID_Y + y, 0.45);
    h.ringMat.color.copy(ready ? h.color : this.grey);
    h.ringMat.opacity = ready ? 0.95 : 0.5;
    h.fillMat.opacity = ready ? 0.14 : 0.05;
    h.ring.rotation.z = ready ? 0 : Math.sin(time * 14) * 0.2;
  }

  swing(i: number): void {
    const h = this.hands[i];
    if (h) h.swing = 0;
  }

  /** The ring pops when its swat lands. */
  pop(i: number): void {
    const h = this.hands[i];
    if (h) h.pop = 1;
  }

  word(text: string, color: string, x: number, y: number, size = 0.55): void {
    this.floaters.add(text, color, new THREE.Vector3(x, MID_Y + y + 0.5, 0.6), size, 1.1);
  }

  overHead(i: number, text: string, color: string): void {
    const c = this.people[i];
    if (c) this.floaters.add(text, color, new THREE.Vector3(c.root.position.x, BED_Y + HEIGHT + 0.5, COMP_Z + 0.4), 0.5, 1.2);
  }

  /** Places every mosquito at time t (game seconds). */
  fly(t: number, dt: number, time: number): void {
    for (const [id, b] of this.bugs) {
      if (b.splat >= 0) {
        b.splat += dt;
        b.vy -= 9 * dt;
        b.group.position.y += b.vy * dt;
        b.group.rotation.z += dt * 6;
        b.body.scale.set(1.2, Math.max(0.35, 1 - b.splat * 4), 1);
        // The glow bursts outward as it goes.
        const mat = b.halo.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, mat.opacity - dt * 2.6);
        b.halo.scale.setScalar(b.glow * (1 + (1 - Math.exp(-b.splat * 14)) * 1.5));
        if (b.splat > 0.9) this.drop(id, b);
        continue;
      }
      if (!flyingAt(b.m, t) && t > b.m.at) {
        this.drop(id, b);
        continue;
      }
      const p = mosquitoAt(b.m, t);
      const vx = p.x - b.lastX;
      b.lastX = p.x;
      b.group.position.set(p.x, MID_Y + p.y, 0);
      if (Math.abs(vx) > 1e-4) b.body.scale.x = vx > 0 ? 1 : -1;
      b.body.rotation.z = Math.sin(time * 7 + b.m.id) * 0.12;
      for (const [k, w] of b.wings.entries()) w.rotation.z = 0.35 + Math.sin(time * 70 + k * 1.3) * 0.3;
      b.buzz?.move(p.x / MOSQ.halfW);
    }
  }

  private drop(id: number, b: Bug): void {
    b.buzz?.stop();
    this.scene.remove(b.group);
    (b.halo.material as THREE.Material).dispose();
    b.halo.geometry.dispose();
    for (const w of b.wings.slice(0, 1)) (w.material as THREE.Material).dispose();
    this.bugs.delete(id);
  }

  /** Quiet: every buzz stops. */
  hush(): void {
    for (const b of this.bugs.values()) {
      b.buzz?.stop();
      b.buzz = null;
    }
  }

  dispose(): void {
    this.hush();
    for (const [id, b] of [...this.bugs]) this.drop(id, b);
    for (const c of this.people) c.dispose();
    this.floaters.dispose();
    for (const card of this.cards) {
      card.material.map?.dispose();
      card.material.dispose();
    }
    for (const m of this.made) m.dispose();
    this.haloMap.dispose();
  }

  private marks(): Mark[] {
    const m: Mark[] = [];
    for (const x of [-MOSQ.halfW, MOSQ.halfW]) for (const y of [-MOSQ.halfH, MOSQ.halfH]) m.push({ p: new THREE.Vector3(x, MID_Y + y, 0), pad: 0.03 });
    for (const card of this.cards) m.push({ p: card.position.clone(), pad: 0.05 });
    for (const c of this.people) m.push({ p: new THREE.Vector3(c.root.position.x, BED_Y + HEIGHT, COMP_Z), pad: 0.03 });
    return m;
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks());
    this.floaters.update(dt);
    this.people.forEach((c) => c.update(dt));
    this.env.update(dt, time);
    this.tick(dt, time);
    this.lava.forEach((l, k) => (l.position.y = 0.5 * ROOM + 0.5 + (Math.sin(time * 0.6 + k * 2.1) * 0.5 + 0.5) * 0.55));
    for (const h of this.hands) {
      h.swing = Math.min(1, h.swing + dt * 4.5);
      h.pop = Math.max(0, h.pop - dt * 4);
      const pop = 1 + Math.sin(h.pop * Math.PI) * 0.16;
      h.ring.scale.setScalar(pop);
      h.fill.scale.set(pop, 1, pop);
      h.swatter.visible = h.swing < 1;
      const k = h.swing;
      h.swatter.scale.setScalar(1.25 - k * 0.3);
      h.swatter.position.z = 0.5 - Math.sin(k * Math.PI) * 0.5;
      h.swatter.rotation.x = (1 - k) * -0.5;
    }
  }
}

// ------------------------------------------------------------------ the game

interface Press {
  seat: number;
  at: number;
}

export const minigame: Minigame = {
  id: 'mosquito',
  title: 'Mosquito',
  how: 'Mosquitos keep everyone up! Point your phone at the screen and press Swat when one is inside your ring. The golden big one is worth 3. Miss and you slap yourself: ow, and a second to recover.',
  controller: 'aim',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const view = new Bedroom(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), sfx);
    ctx.stage.setView(view);
    const skills: (number | undefined)[] = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : undefined));
    const skillOf = (i: number) => (skills[i] ??= ctx.skill());
    const sw = newSwarm();
    const players: Swatter[] = seats.map(() => newSwatter());
    const cpus: SwatCpu[] = seats.map((_, i) => newSwatCpu(view.hands[i]?.group.position.x ?? 0, -MOSQ.halfH * 0.6));
    const raw = seats.map(() => ({ x: 0, y: 0, fire: false }));
    const pos = seats.map((_, i) => ({ x: cpus[i]?.x ?? 0, y: cpus[i]?.y ?? 0 }));
    const presses: Press[] = [];
    let t = 0;
    let roundStart = clock.time;
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'aim' || seat >= n || session.isCpu(seat)) return;
      const r = raw[seat];
      if (!r) return;
      if (msg.fire && !r.fire) presses.push({ seat, at: clock.time - roundStart - Math.min(MOSQ.maxLag, (session.seats[seat]?.rtt ?? 0) / 2000) });
      r.x = msg.x;
      r.y = msg.y;
      r.fire = msg.fire;
    });
    seats.forEach((_, i) => view.people[i]?.setBase('thinking'));
    session.setLayoutAll(() => ({ kind: 'aim', note: 'Get a mosquito inside your ring, then swat!', button: 'Swat!' }));
    ui.caption('Swat the mosquitos! Golden ones are worth 3. Miss and you slap yourself.');

    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${players[i]?.points ?? 0} pts` })));
    live();

    const doSwat = (i: number, judged: number) => {
      const p = players[i];
      const at = pos[i];
      if (!p || !at || !canSwat(p, t)) return;
      const r: SwatResult = swat(sw, at.x, at.y, judged, t, i);
      applySwat(p, r, t);
      view.swing(i);
      const color = seats[i]?.color ?? '#ffffff';
      const cpu = session.isCpu(i);
      if (r.kind === 'hit') {
        slap(sfx);
        view.pop(i);
        for (const m of r.hits) {
          view.swatted(m);
          const where = mosquitoAt(m, Math.max(judged, t - MOSQ.maxLag));
          view.word(m.gold ? '+3' : '+1', m.gold ? P.lamp : color, where.x, where.y, m.gold ? 0.75 : 0.55);
        }
        if (r.hits.some((m) => m.gold)) sfx.ring(true);
        view.people[i]?.react(r.hits.some((m) => m.gold) ? 'happy' : 'approval', 0.9);
        if (!cpu) session.send(i, { t: 'buzz', pattern: r.hits.some((m) => m.gold) ? [20, 40, 20] : [15] });
      } else if (r.kind === 'late') {
        whiff(sfx);
        if (!cpu) session.send(i, { t: 'feedback', good: false, text: 'Too slow, someone got it!' });
      } else {
        ow(sfx);
        view.overHead(i, 'Ow!', color);
        view.people[i]?.react('sad', MOSQ.stun);
        if (!cpu) {
          session.send(i, { t: 'feedback', good: false, text: 'Ow! You swatted yourself.' });
          session.send(i, { t: 'buzz', pattern: [120] });
        }
      }
      live();
    };

    let acc = 0;
    let hudAt = -1;
    roundStart = clock.time;
    sfx.go();
    await everyFrame(clock, (dt) => {
      // Humans' hands follow their phones, smoothed a little.
      const k = 1 - Math.exp(-dt * 22);
      seats.forEach((_, i) => {
        const p = pos[i];
        const r = raw[i];
        if (!p || !r || session.isCpu(i)) return;
        const f = fromPointer(r.x, r.y);
        p.x += (f.x - p.x) * k;
        p.y += (f.y - p.y) * k;
        const c = cpus[i];
        if (c) {
          c.x = p.x;
          c.y = p.y;
        }
      });
      for (const pr of presses.splice(0)) doSwat(pr.seat, Math.max(t - MOSQ.maxLag, Math.min(t, pr.at)));
      acc += dt;
      while (acc >= STEP && t < MOSQ.duration) {
        acc -= STEP;
        t += STEP;
        for (const m of stepSwarm(sw, rng, t)) view.add(m);
        for (const i of shuffle(
          rng,
          seats.map((_, s) => s),
        )) {
          if (!session.isCpu(i)) continue;
          const p = players[i] as Swatter;
          const out = cpuSwat(cpus[i] as SwatCpu, sw, t, STEP, skillOf(i), rng, canSwat(p, t));
          const at = pos[i] as { x: number; y: number };
          at.x = out.x;
          at.y = out.y;
          if (out.swat) doSwat(i, t);
        }
      }
      view.fly(t, dt, clock.time);
      seats.forEach((_, i) => {
        const p = pos[i];
        const pl = players[i];
        if (p && pl) view.setHand(i, p.x, p.y, t >= pl.stunUntil, clock.time);
      });
      if (t - hudAt > 0.25) {
        hudAt = t;
        ui.timer(MOSQ.duration - t);
      }
      return t >= MOSQ.duration;
    });
    off();
    view.hush();
    ui.timer(null);
    ui.caption(null);
    session.setLayoutAll(() => ({ kind: 'wait', title: 'Peace and quiet at last', text: 'Counting the swats…' }));
    const best = Math.max(...players.map((p) => p.points));
    seats.forEach((_, i) => {
      view.people[i]?.setBase(players[i]?.points === best && best > 0 ? 'happy' : 'sleeping');
    });
    live();
    return {
      scores: mosquitoScores(players),
      details: players.map((p) => [`${p.points} pts`, `${p.hits} swatted`, ...(p.golds ? [`${p.golds} golden`] : []), `${p.misses} ow${p.misses === 1 ? '' : 's'}`].join(' · ')),
    };
  },
};
