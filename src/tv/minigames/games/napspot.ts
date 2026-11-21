// Nap Spot on the TV: a living room late at night, a record spinning lo-fi on the sideboard and a few beanbags on
// the rug. Everyone wanders about; when the record scratches, dive onto a beanbag. Whoever is left standing puts
// on a sleep mask and lies down on the fluffy rug at the back.
import * as THREE from 'three';
import { NAP, type NapBrain, type Room, type Stick, IDLE, cpuNap, isOver, napScores, newNapBrain, newRoom, nextRound, stepRoom } from '../../../game/minigames/napspot';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import { type Clock, ease } from '../../anim';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import type { TextureName } from '../../render/textures';
import { PALETTE, ball, cyl, gem, material, mix, part, rbox, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.2;
const STEP = 1 / 120;
const P = PALETTE;
const BAG_COLORS = [P.mauve, P.mustard, P.sage, P.terracotta] as const;
const RUG = mix(P.denim, P.aubergine, 0.3);
/** Where the people who went for a nap lie down: feet toward the room, heads on the pillows. */
const NAP_SPOTS = [1.3, 2.5, 3.7].map((x) => new THREE.Vector3(x, 0, -3.75));

// ------------------------------------------------------------------ sounds

/**
 * A lazy lo-fi loop made of little synth notes: four jazzy chords, a soft kick and snare, hats with a bit of swing,
 * a few melody notes and some vinyl crackle. Steps are eighth notes on the game clock.
 */
class LoFi {
  private static readonly CHORDS: readonly (readonly number[])[] = [
    [87.31, 220.0, 261.63, 329.63], // Fmaj7
    [82.41, 196.0, 246.94, 293.66], // Em7
    [73.42, 174.61, 220.0, 261.63], // Dm7
    [65.41, 164.81, 196.0, 246.94], // Cmaj7
  ];
  private static readonly MELODY = [523.25, 587.33, 659.25, 783.99, 880.0];
  private readonly gap = 60 / 78 / 2;
  private step = 0;
  private next = 0;
  playing = false;

  constructor(
    private readonly sfx: Sfx,
    private readonly rand: () => number,
  ) {}

  start(t: number): void {
    this.playing = true;
    this.next = t;
  }

  stop(): void {
    this.playing = false;
  }

  /** Plays the steps that are due. Returns true on the first step of each beat (for things that bounce along). */
  update(t: number): boolean {
    if (!this.playing) return false;
    if (t - this.next > 0.3) this.next = t; // a long frame: skip ahead rather than play a pile of notes at once
    let beat = false;
    while (t >= this.next) {
      beat ||= this.step % 2 === 0;
      this.play(this.step++);
      this.next += this.gap;
    }
    return beat;
  }

  private play(step: number): void {
    const sfx = this.sfx;
    const s = step % 8;
    const chord = LoFi.CHORDS[Math.floor(step / 8) % LoFi.CHORDS.length] as readonly number[];
    const root = chord[0] as number;
    const swing = s % 2 === 1 ? 0.05 : 0;
    if (s === 0) {
      tone(sfx, { freq: 120, to: 45, dur: 0.2, gain: 0.2 });
      tone(sfx, { freq: root, dur: 0.6, type: 'triangle', gain: 0.11 });
      for (const f of chord.slice(1)) tone(sfx, { freq: f, dur: 0.55, type: 'triangle', gain: 0.03 });
    }
    if (s === 3) for (const f of chord.slice(1)) tone(sfx, { freq: f, dur: 0.3, type: 'triangle', gain: 0.018, delay: swing });
    if (s === 4) {
      noise(sfx, { dur: 0.14, filter: 'bandpass', freq: 1500, gain: 0.1 });
      tone(sfx, { freq: root * 1.5, dur: 0.4, type: 'triangle', gain: 0.08 });
    }
    if (s === 6 && this.rand() < 0.5) tone(sfx, { freq: 110, to: 45, dur: 0.16, gain: 0.1 });
    if (s !== 0 && s !== 4) noise(sfx, { dur: 0.03, filter: 'highpass', freq: 6500, gain: 0.04, delay: swing });
    if ((s === 7 || s === 5) && this.rand() < 0.45) {
      const f = LoFi.MELODY[Math.floor(this.rand() * LoFi.MELODY.length)] as number;
      tone(sfx, { freq: f, dur: 0.35, gain: 0.03, delay: swing });
    }
    if (this.rand() < 0.5) noise(sfx, { dur: 0.015, filter: 'highpass', freq: 2500, gain: 0.04, delay: this.rand() * this.gap });
  }
}

function scratch(sfx: Sfx): void {
  noise(sfx, { dur: 0.12, filter: 'bandpass', freq: 700, to: 2600, gain: 0.35 });
  noise(sfx, { dur: 0.16, filter: 'bandpass', freq: 2600, to: 500, gain: 0.3, delay: 0.11 });
  tone(sfx, { freq: 260, to: 50, dur: 0.45, type: 'sawtooth', gain: 0.05 });
}

const flump = (sfx: Sfx) => {
  noise(sfx, { dur: 0.3, filter: 'lowpass', freq: 500, to: 90, gain: 0.45 });
  tone(sfx, { freq: 160, to: 70, dur: 0.18, gain: 0.12 });
};
const boing = (sfx: Sfx) => {
  tone(sfx, { freq: 260, to: 520, dur: 0.14, gain: 0.12 });
  tone(sfx, { freq: 520, to: 300, dur: 0.16, gain: 0.08, delay: 0.12 });
};
const hmm = (sfx: Sfx) => tone(sfx, { freq: 520, to: 390, dur: 0.25, gain: 0.08 });
const yawn = (sfx: Sfx) => {
  tone(sfx, { freq: 440, to: 330, dur: 0.35, type: 'triangle', gain: 0.06 });
  tone(sfx, { freq: 330, to: 220, dur: 0.5, type: 'triangle', gain: 0.05, delay: 0.3 });
};

// ------------------------------------------------------------------ the room

/** Puts a prop into the set at `k` times its size. */
function put<T extends THREE.Object3D>(root: THREE.Object3D, o: T, x: number, y: number, z: number, ry = 0, k = 1): T {
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.scale.setScalar(k);
  root.add(o);
  return o;
}

interface Spark {
  m: THREE.Mesh;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

/** Little glowing sparkles that fly out, fall a bit and fade: for votes, right answers and winners. */
class Sparkles {
  private list: Spark[] = [];
  constructor(private readonly scene: THREE.Scene) {}

  burst(at: THREE.Vector3, color: string, n = 8, speed = 1.4): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const up = Math.random() * 0.8 + 0.5;
      const m = part(this.scene, gem(0.06), i % 2 ? color : P.lamp, at.x, at.y, at.z, { glow: 1.8, outline: false, shadow: false });
      this.list.push({ m, v: new THREE.Vector3(Math.cos(a) * speed * (0.5 + Math.random() * 0.5), up * speed, Math.sin(a) * speed * 0.4), age: 0, life: 0.6 + Math.random() * 0.4, size: 0.6 + Math.random() * 0.7 });
    }
  }

  update(dt: number): void {
    this.list = this.list.filter((sp) => {
      sp.age += dt;
      sp.v.y -= dt * 3.2;
      sp.m.position.addScaledVector(sp.v, dt);
      sp.m.rotation.y += dt * 7;
      sp.m.scale.setScalar(Math.max(0.001, sp.size * (1 - sp.age / sp.life)));
      if (sp.age < sp.life) return true;
      this.scene.remove(sp.m);
      return false;
    });
  }

  dispose(): void {
    for (const sp of this.list) this.scene.remove(sp.m);
    this.list = [];
  }
}

/** A sleep mask: a soft band with two little closed eyes stitched on. */
function sleepMask(h: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const w = Math.max(0.3, width * 0.9);
  part(g, rbox(w, h * 0.12, 0.07, 0.03), PALETTE.plum, 0, 0, 0, { tex: 'velvet', texScale: 0.4 });
  for (const x of [-w * 0.22, w * 0.22]) part(g, torus(w * 0.09, 0.012, Math.PI), PALETTE.cream, x, -0.005, 0.045, { rz: Math.PI, outline: false });
  return g;
}

/** Where a companion's face is, in its root's space at rest: from its head's bounds (a guess if there's no head). */
function faceSpot(c: Companion): { anchor: THREE.Object3D; y: number; z: number; w: number } {
  c.root.updateMatrixWorld(true);
  // The kit hangs the head on "anchor:head" (or "head-pivot"); glTF node names lose their colon on loading.
  const find = (...names: string[]) => {
    let found: THREE.Object3D | null = null;
    c.root.traverse((o) => {
      if (!found && names.includes(o.name)) found = o;
    });
    return found as THREE.Object3D | null;
  };
  const anchor = find('anchor:head', THREE.PropertyBinding.sanitizeNodeName('anchor:head')) ?? find('head-pivot');
  const box = new THREE.Box3();
  if (anchor) box.setFromObject(anchor);
  if (!anchor || box.isEmpty()) return { anchor: c.root, y: HEIGHT * 0.68, z: HEIGHT * 0.22, w: HEIGHT * 0.4 };
  return { anchor, y: box.min.y + (box.max.y - box.min.y) * 0.48, z: box.max.z, w: box.max.x - box.min.x };
}

type RigState = 'free' | 'hop' | 'seated' | 'leaving' | 'asleep';

/** The shortest turn from one heading to another. */
const turnTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

interface Rig {
  c: Companion;
  ring: THREE.Mesh;
  mask: THREE.Group;
  state: RigState;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
  hopFrom: THREE.Vector3;
  hopTo: THREE.Vector3;
  hopT: number;
  /** How far to lift a lying companion so its back rests on the rug. */
  lie: number;
  snoreIn: number;
}

interface BagView {
  group: THREE.Group;
  ring: THREE.Mesh;
  squash: number;
  gone: boolean;
  grow: number;
}

class Lounge implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly rigs: Rig[] = [];
  readonly words: Floaters;
  private bags: BagView[] = [];
  private readonly fit = new CameraFit(this.camera, 0.88);
  private readonly marks: Mark[];
  private record = new THREE.Group();
  private speakers: THREE.Object3D[] = [];
  private readonly env: Env;
  private readonly sparkles = new Sparkles(this.scene);
  private tick: (dt: number, time: number) => void = () => {};
  private spin = 0;
  private thump = 0;
  private readonly colors: string[];

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    this.colors = seats.map((s) => s.color);
    // The living room late in the evening: lamps on, the night in the window. The game brings its own rug, record
    // player and beanbags, so the room's are taken out.
    this.env = livingRoom(this.scene, { mood: 'evening', w: 14.6, d: 11.8, h: 4.2, wall: mix(P.duskWall, P.aubergine, 0.3), rug: false, seed: 3 });
    for (const child of [...this.env.root.children]) if (['recordPlayer', 'beanbag', 'pouf', 'guitar'].includes(child.name)) this.env.root.remove(child);
    this.env.sun.target.position.set(0, 0, -1);
    this.words = new Floaters(this.scene);
    this.buildRoom();

    seats.forEach((s, i) => {
      const c = companions[i] as Companion;
      const face = faceSpot(c);
      const mask = sleepMask(HEIGHT, face.w);
      mask.position.set(0, face.y, face.z + 0.02);
      c.root.add(mask);
      mask.updateMatrixWorld(true);
      face.anchor.attach(mask);
      mask.visible = false;
      const back = Math.max(0, -c.kit.bounds.min[2]) * c.scale;
      this.scene.add(c.root);
      const ring = part(this.scene, torus(0.46, 0.045), s.color, 0, 0.05, 0, { rx: Math.PI / 2, glow: 1.1, outline: false, shadow: false });
      c.setBase('idle');
      this.rigs.push({ c, ring, mask, state: 'free', motion: null, mood: null, hopFrom: new THREE.Vector3(), hopTo: new THREE.Vector3(), hopT: 0, lie: back + 0.06, snoreIn: 0 });
    });

    const { x, z } = NAP.bounds;
    this.marks = [];
    for (const px of [-x - 0.4, x + 0.4]) {
      for (const pz of [-z - 0.4, z + 0.5]) {
        this.marks.push({ p: new THREE.Vector3(px, 0, pz) }, { p: new THREE.Vector3(px, HEIGHT + 0.2, pz), pad: 0.03 });
      }
    }
    for (const p of NAP_SPOTS) this.marks.push({ p: new THREE.Vector3(p.x, 0.3, p.z - HEIGHT - 0.1) });
  }

  private buildRoom(): void {
    const s = this.scene;
    const root = new THREE.Group();
    s.add(root);
    // The big oval rug everyone wanders on.
    const terry = { tex: 'terry' as TextureName, texScale: 1.2, outline: false as const, shadow: false };
    part(root, cyl(4.2, 4.2, 0.04, 64), mix(RUG, P.cream, 0.45), 0, 0.02, 0, { sx: 1.45, sz: 0.88, ...terry });
    part(root, cyl(4.05, 4.05, 0.045, 64), RUG, 0, 0.023, 0, { sx: 1.45, sz: 0.88, ...terry });
    part(root, torus(3.3, 0.04), mix(RUG, P.cream, 0.35), 0, 0.045, 0, { rx: Math.PI / 2, sx: 1.45, sy: 0.88, outline: false, shadow: false });
    part(root, cyl(2.2, 2.2, 0.05, 48), mix(RUG, P.ink, 0.14), 0, 0.024, 0, { sx: 1.45, sz: 0.88, ...terry });

    // The sideboard with the record player and two little speakers.
    put(root, props.sideboard({ w: 2.3, h: 0.74, d: 0.68 }), -3.6, 0, -4.95, 0, 1.3);
    withOutline(0.03, () => {
      part(root, rbox(1.3, 0.16, 0.95, 0.05), P.walnut, -3.6, 1.04, -4.9, { tex: 'darkWood' });
      part(root, cyl(0.42, 0.42, 0.04, 32), P.charcoal, -3.75, 1.13, -4.9, { outline: false, gloss: 0.4 });
    });
    for (const dx of [-1.15, 1.15]) {
      const spk = new THREE.Group();
      spk.position.set(-3.6 + dx, 0.965, -4.95);
      put(spk, props.speaker({ h: 0.6 }), 0, 0, 0, 0, 1.25);
      this.speakers.push(spk);
      root.add(spk);
    }
    this.record.position.set(-3.75, 1.16, -4.9);
    part(this.record, cyl(0.38, 0.38, 0.02, 40), '#17131c', 0, 0, 0, { outline: false, gloss: 0.6 });
    for (const r of [0.2, 0.27, 0.33]) part(this.record, torus(r, 0.004), '#2c2733', 0, 0.011, 0, { rx: Math.PI / 2, outline: false, shadow: false });
    part(this.record, cyl(0.12, 0.12, 0.025, 20), P.terracotta, 0, 0.002, 0, { outline: false });
    part(this.record, ball(0.03, 1), P.cream, 0.06, 0.02, 0, { outline: false });
    s.add(this.record);
    part(root, cyl(0.05, 0.05, 0.12, 10), P.brass, -3.18, 1.18, -5.2, { outline: false, gloss: 0.6 });
    part(root, rbox(0.04, 0.03, 0.62, 0.01), P.brass, -3.32, 1.24, -4.95, { ry: 0.35, outline: false, gloss: 0.6 });
    put(root, props.crate({ s: 0.5 }), -1.5, 0, -5.2, 0.15, 1.2);

    // The floor lamp by the nap rug: it stays on all night.
    put(root, props.floorLamp({ light: 12, h: 1.9 }), 5.6, 0, -4.9, 0, 1.4);

    // The nap rug: fluffy, with pillows along the back.
    part(root, rbox(3.9, 0.07, 1.9, 0.03), mix(P.cream, P.mauve, 0.18), 2.5, 0.035, -4.45, { tex: 'knit', texScale: 0.8, outline: false, shadow: false });
    for (let k = 0; k < 9; k++) part(root, ball(0.1, 1), P.cream, 0.7 + k * 0.45, 0.06, -3.5, { sy: 0.5, outline: false, shadow: false });
    withOutline(0.03, () => {
      NAP_SPOTS.forEach((p, k) => part(root, rbox(0.85, 0.22, 0.42, 0.1), k % 2 ? P.ceramic : mix(P.mauve, P.cream, 0.6), p.x, 0.14, -5.12, { tex: 'fabric', texStrength: 0.5 }));
    });
    // In front, out of the way: the coffee table pushed aside, with what's left of the snacks.
    const table = put(root, props.coffeeTable({ w: 1.5, color: P.walnut }), 4.9, 0, 4.9, -0.2, 1.3);
    put(table, props.snackBowl({ fill: 'popcorn', color: P.ceramic }), -0.35, 0.42, 0);
    put(table, props.mug({ color: P.teal }), 0.2, 0.42, 0.12, 0.6);
    put(table, props.pizzaBox({ open: true, slices: 2 }), 0.42, 0.42, -0.08, 0.4);
    put(root, props.plant({ kind: 'monstera', h: 1.0, pot: P.terracotta, seed: 8 }), -5.4, 0, 4.9, 0, 1.3);
    this.tick = props.tickProps(root);
  }

  /** New beanbags for a round: the old ones sink away, the new ones puff up. */
  setBags(room: Room): void {
    for (const b of this.bags) b.gone = true;
    room.bags.forEach((b, k) => {
      const group = new THREE.Group();
      group.position.set(b.x, 0, b.z);
      const color = BAG_COLORS[(k + room.round) % BAG_COLORS.length] as string;
      withOutline(0.035, () => {
        const velvet = { tex: 'velvet' as TextureName, texScale: 0.9, texStrength: 0.8 };
        part(group, ball(NAP.bagR, 3), color, 0, 0.36, 0, { sy: 0.62, ...velvet });
        part(group, ball(NAP.bagR * 0.7, 3), mix(color, '#ffffff', 0.12), 0, 0.5, 0.05, { sy: 0.5, outline: false, ...velvet });
        part(group, torus(NAP.bagR * 0.97, 0.018), mix(color, PALETTE.ink, 0.3), 0, 0.36, 0, { rx: Math.PI / 2, outline: false, shadow: false });
        part(group, ball(0.06, 1), mix(color, PALETTE.ink, 0.3), 0, 0.74, 0.05, { sy: 0.5, outline: false });
      });
      const ring = part(group, torus(NAP.bagR + 0.08, 0.05), '#ffffff', 0, 0.06, 0, { rx: Math.PI / 2, glow: 0.7, outline: false, shadow: false });
      ring.visible = false;
      group.scale.setScalar(0.01);
      this.scene.add(group);
      this.bags.push({ group, ring, squash: 0, gone: false, grow: 0 });
    });
  }

  /** Someone landed on a beanbag: it squashes and shows their colour. */
  plonk(bag: number, seat: number): void {
    const b = this.bags.filter((x) => !x.gone)[bag];
    if (!b) return;
    b.squash = 1;
    b.ring.material = material(this.colors[seat] ?? '#ffffff', { glow: 1.2 });
    b.ring.visible = true;
    this.sparkles.burst(new THREE.Vector3(b.group.position.x, 0.7, b.group.position.z), this.colors[seat] ?? PALETTE.lamp, 8, 1.3);
  }

  head(seat: number): THREE.Vector3 {
    const r = this.rigs[seat];
    const p = r ? r.c.root.position.clone() : new THREE.Vector3();
    p.y += HEIGHT + 0.35;
    return p;
  }

  /** Puts everyone where the rules say they are. */
  sync(room: Room, dt: number): void {
    const follow = 1 - Math.exp(-dt * 14);
    room.nappers.forEach((n, i) => {
      const rig = this.rigs[i];
      if (!rig || n.out) return;
      const root = rig.c.root;
      if (n.bag !== null && rig.state === 'free') {
        rig.state = 'hop';
        rig.hopT = 0;
        rig.hopFrom.copy(root.position);
        const b = room.bags[n.bag];
        rig.hopTo.set(b?.x ?? n.x, 0.42, b?.z ?? n.z);
        this.setMotion(rig, null, 0);
        this.setMood(rig, 'happy');
      }
      if (n.bag === null && (rig.state === 'seated' || rig.state === 'hop')) {
        rig.state = 'free';
        root.position.y = 0;
        this.setMood(rig, 'idle');
      }
      if (rig.state !== 'free') return;
      root.position.x += (n.x - root.position.x) * follow;
      root.position.z += (n.z - root.position.z) * follow;
      root.position.y = 0;
      rig.ring.position.set(root.position.x, 0.03, root.position.z);
      const speed = Math.hypot(n.vx, n.vz);
      const sliding = Math.hypot(n.kx, n.kz) > 0.5;
      const target = speed > 0.4 && !sliding ? n.face : root.rotation.y;
      root.rotation.y += turnTo(root.rotation.y, target) * Math.min(1, dt * 10);
      root.rotation.z = n.stun > 0 ? Math.sin(n.stun * 28) * 0.18 : 0;
      this.setMotion(rig, n.stun > 0 || speed < 0.35 ? null : speed > 2.8 ? 'run' : 'walk', speed);
      this.setMood(rig, n.still > NAP.comfy / 2 ? 'sleeping' : room.phase === 'scramble' ? 'listening' : 'idle');
    });
  }

  private setMotion(rig: Rig, motion: 'walk' | 'run' | null, speed: number): void {
    if (motion === rig.motion) return;
    rig.motion = motion;
    rig.c.move(motion, speed);
  }

  private setMood(rig: Rig, mood: CompanionMood): void {
    if (mood === rig.mood) return;
    rig.mood = mood;
    rig.c.setBase(mood);
  }

  /** Off to the nap rug: walk over, lie down, mask on. Resolves when they're lying down. */
  async goNap(seat: number, slot: number, clock: Clock): Promise<void> {
    const rig = this.rigs[seat];
    const spot = NAP_SPOTS[slot % NAP_SPOTS.length];
    if (!rig || !spot) return;
    rig.state = 'leaving';
    rig.ring.visible = false;
    const root = rig.c.root;
    const from = root.position.clone();
    from.y = 0;
    root.rotation.z = 0;
    root.rotation.y = Math.atan2(spot.x - from.x, spot.z - from.z);
    const dist = from.distanceTo(spot);
    this.setMood(rig, 'sad');
    this.setMotion(rig, 'walk', 3);
    await clock.tween(Math.max(0.5, dist / 3.2), (k) => root.position.lerpVectors(from, spot, k), ease.linear);
    this.setMotion(rig, null, 0);
    rig.mask.visible = true;
    this.setMood(rig, 'sleeping');
    const turnFrom = root.rotation.y;
    const turn = turnTo(turnFrom, 0);
    await clock.tween(0.5, (k) => {
      root.rotation.y = turnFrom + turn * k;
      root.rotation.x = (-Math.PI / 2) * k;
      root.position.y = rig.lie * k;
    });
    rig.state = 'asleep';
    rig.snoreIn = 0.4;
  }

  /** The winner gets up on their beanbag for a little cheer. */
  cheer(seat: number): void {
    const rig = this.rigs[seat];
    if (!rig) return;
    this.setMood(rig, 'happy');
    rig.c.react('happy', 3);
  }

  dispose(): void {
    for (const r of this.rigs) r.c.dispose();
    this.words.dispose();
    this.sparkles.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    this.words.update(dt);
    this.sparkles.update(dt);
    this.env.update(dt, time);
    this.tick(dt, time);
    for (const r of this.rigs) {
      r.c.update(dt);
      if (r.state === 'hop') {
        r.hopT = Math.min(1, r.hopT + dt / 0.28);
        const root = r.c.root;
        root.position.lerpVectors(r.hopFrom, r.hopTo, r.hopT);
        root.position.y += Math.sin(r.hopT * Math.PI) * 0.6;
        root.rotation.y += turnTo(root.rotation.y, 0) * Math.min(1, dt * 10);
        r.ring.visible = false;
        if (r.hopT >= 1) r.state = 'seated';
      } else if (r.state === 'free') {
        r.ring.visible = true;
      }
      if (r.state === 'asleep') {
        r.snoreIn -= dt;
        if (r.snoreIn <= 0) {
          r.snoreIn = 1.6;
          const p = r.c.root.position.clone();
          this.words.add('z', PALETTE.moon, new THREE.Vector3(p.x + 0.2, 0.7, p.z - HEIGHT * 0.8), 0.32, 1.5);
        }
      }
    }
    for (const b of this.bags) {
      b.grow = Math.min(1, b.grow + dt * 3);
      b.squash = Math.max(0, b.squash - dt * 2.5);
      const s = b.gone ? Math.max(0.01, b.group.scale.x - dt * 4) : 0.01 + 0.99 * ease.outBack(b.grow);
      const wob = Math.sin(b.squash * 16) * b.squash * 0.25;
      b.group.scale.set(s * (1 + wob * 0.5), s * (1 - wob), s * (1 + wob * 0.5));
      if (b.gone && s <= 0.01) b.group.removeFromParent();
    }
    this.bags = this.bags.filter((b) => b.group.parent);
    // The record spins while the music plays and stops dead on the scratch.
    this.record.rotation.y += dt * this.spin * 3.6;
    this.thump = Math.max(0, this.thump - dt * 5);
    for (const sp of this.speakers) sp.scale.set(1 + this.thump * 0.05, 1 + this.thump * 0.07, 1 + this.thump * 0.05);
  }

  setSpin(on: boolean): void {
    this.spin = on ? 1 : 0;
  }

  beat(): void {
    this.thump = 1;
  }
}

export const minigame: Minigame = {
  id: 'napspot',
  title: 'Nap Spot',
  how: 'Wander while the music plays (dawdle by a beanbag and you get too comfy). When the record scratches, dive onto a beanbag! Whoever is left standing goes for a nap. Last one up wins.',
  controller: 'stick',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const pos = new Map(seats.map((s, i) => [s.index, i] as const));
    const room = newRoom(n, rng);
    const view = new Lounge(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    const brains: NapBrain[] = seats.map(() => newNapBrain(ctx.skill()));
    const sticks: Stick[] = seats.map(() => IDLE);
    const music = new LoFi(sfx, Math.random);
    const cpu = (i: number) => session.isCpu(seats[i]?.index ?? i);
    const send = (i: number, msg: Parameters<typeof session.send>[1]) => session.send(seats[i]?.index ?? i, msg);
    const off = session.onInput((seat, msg) => {
      const i = pos.get(seat);
      if (i === undefined || msg.t !== 'stick' || cpu(i)) return;
      sticks[i] = { x: msg.x, y: msg.y };
    });
    const status = (i: number): string => {
      const p = room.nappers[i];
      if (!p) return '';
      if (p.out) return 'Napping';
      if (p.bag !== null) return 'Comfy';
      return room.phase === 'scramble' ? 'Looking…' : 'Wandering';
    };
    let hudKey = '';
    const hud = () => {
      const key = seats.map((_, i) => status(i)).join('|');
      if (key === hudKey) return;
      hudKey = key;
      ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: status(i) })));
    };
    const layouts = () =>
      seats.forEach((s, i) => {
        const p = room.nappers[i];
        session.setLayout(
          s.index,
          p?.out
            ? { kind: 'wait', title: 'Nap time', text: 'Sleep mask on. Watch who gets the last beanbag!' }
            : { kind: 'stick', button: null, note: `Round ${room.round + 1}: keep wandering. When the music stops, dive onto a beanbag!` },
        );
      });

    ui.timer(null);
    let napped = 0;
    while (!isOver(room)) {
      view.setBags(room);
      layouts();
      hud();
      ui.caption(`Round ${room.round + 1}: wander about while the music plays…`);
      music.start(clock.time);
      view.setSpin(true);

      let out: number | null = null;
      await everyFrame(clock, (dt) => {
        if (music.update(clock.time)) view.beat();
        const lags = seats.map((s) => Math.max(0, session.seats[s.index]?.rtt ?? 0) / 2000);
        const steps = Math.max(1, Math.ceil(dt / STEP));
        for (let k = 0; k < steps && room.phase !== 'done'; k++) {
          const input = seats.map((_, i) => (cpu(i) ? cpuNap(room, i, brains[i] as NapBrain, rng, dt / steps) : (sticks[i] ?? IDLE)));
          const ev = stepRoom(room, input, dt / steps, lags);
          if (ev.stopped) {
            music.stop();
            view.setSpin(false);
            scratch(sfx);
            ui.caption('The music stopped! Dive onto a beanbag!', '#ffd166');
            seats.forEach((_, i) => {
              if (!room.nappers[i]?.out) send(i, { t: 'buzz', pattern: [60] });
            });
          }
          for (const d of ev.dives) {
            view.plonk(d.bag, d.seat);
            flump(sfx);
            send(d.seat, { t: 'feedback', good: true, text: 'Comfy!' });
            send(d.seat, { t: 'buzz', pattern: [25] });
          }
          for (const b of ev.bounced) {
            view.words.add('Taken!', '#ffffff', view.head(b), 0.4);
            boing(sfx);
            send(b, { t: 'feedback', good: false, text: 'That one’s taken!' });
            send(b, { t: 'buzz', pattern: [50, 40, 50] });
          }
          for (const d of ev.drowsy) {
            view.words.add('zz…', '#cfd8ff', view.head(d), 0.35, 1.2);
            send(d, { t: 'feedback', good: false, text: 'Getting comfy… keep moving!' });
          }
          for (const c of ev.comfy) {
            view.words.add('Too comfy!', seats[c]?.color ?? '#ffffff', view.head(c), 0.42);
            hmm(sfx);
            send(c, { t: 'feedback', good: false, text: 'Too comfy! Keep wandering.' });
            send(c, { t: 'buzz', pattern: [90] });
          }
          if (ev.out !== null) out = ev.out;
        }
        view.sync(room, dt);
        hud();
        return room.phase === 'done';
      });
      music.stop();

      if (out !== null) {
        const who = seats[out];
        ui.caption(`${who?.name ?? 'Someone'} is left standing. Nap time!`, who?.color);
        session.setLayout(who?.index ?? out, { kind: 'wait', title: 'Nap time', text: 'Sleep mask on. Watch who gets the last beanbag!' });
        send(out, { t: 'buzz', pattern: [40, 30, 120] });
        yawn(sfx);
        hud();
        await view.goNap(out, napped++, clock);
      }
      await clock.wait(0.9);
      nextRound(room, rng);
    }

    off();
    const winner = room.nappers.findIndex((p) => !p.out);
    if (winner >= 0) {
      view.cheer(winner);
      sfx.win();
      ui.caption(`${seats[winner]?.name ?? 'Someone'} gets the comfiest spot!`, seats[winner]?.color);
      send(winner, { t: 'buzz', pattern: [30, 40, 30, 40, 120] });
    }
    hud();
    await clock.wait(2);
    ui.caption(null);
    ui.timer(null);

    const place = (i: number) => {
      const k = room.order.indexOf(i);
      return k < 0 ? 'Last one awake' : `Napping from round ${k + 1}`;
    };
    return {
      scores: napScores(room),
      details: seats.map((_, i) => {
        const p = room.nappers[i];
        const extra = (p?.nudges ?? 0) > 0 ? ` · too comfy ×${p?.nudges}` : '';
        return `${place(i)}${extra}`;
      }),
    };
  },
};
