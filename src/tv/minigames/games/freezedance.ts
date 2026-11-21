// Freeze Dance on the TV: the living room turned dance floor in the small hours. The DJ stands behind a record
// player at the back; three dancers bop on the round rug while coloured lights swirl. On Freeze! the lights go
// icy and the room holds its breath; whoever is still moving is caught. Out dancers sit down by the snack table.
import * as THREE from 'three';
import {
  FREEZE,
  type DjBrain,
  type Mover,
  type Party,
  cpuDj,
  cpuWobble,
  dancerOf,
  djFreeze,
  djMusic,
  djWins,
  freezeIn,
  isOver,
  newDjBrain,
  newMover,
  newParty,
  partyScores,
  stepParty,
} from '../../../game/minigames/freezedance';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, lanes, noise, teamsOf, tone } from '../kit';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cyl, gem, material, mix, nameCard, part, popSprite, rbox, seeded, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.3;
const DANCE_Z = 1.0;
const SPACING = 2.3;
const DJ_SPOT = new THREE.Vector3(0, 0.28, -2.95);
const SNACKS = new THREE.Vector3(5.9, 0, 0.6);
const SEATS_AT: readonly [number, number][] = [
  [4.9, 1.9],
  [6.0, 2.3],
  [7.0, 1.7],
];
const SPOT_COLORS = [P.neonPink, P.lamp, P.neonCyan, P.neonViolet, P.ember];
const ICE = P.screen;
const ROOM = 1.3; // the room is built at life size and scaled up a little for the stubby companions
const WARM = mix(P.neonPink, P.lamp, 0.55); // the party light while the music plays
const BACK = -4.0; // the back wall
const PARTY = 20; // the party light's strength

// ------------------------------------------------------------------ a little lo-fi loop

const BPM = 92;
const STEP = 60 / BPM / 2; // eighth notes
const CHORDS = [
  [174.6, 220.0, 261.6, 329.6],
  [164.8, 196.0, 246.9, 293.7],
  [146.8, 174.6, 220.0, 261.6],
  [130.8, 164.8, 196.0, 246.9],
];
const BASS = [87.3, 82.4, 73.4, 65.4];

/** One eighth note of the loop: a soft kick and snare, hats, a bass note and a chord at the top of each bar. */
function playStep(sfx: Sfx, n: number): void {
  const bar = Math.floor(n / 8) % CHORDS.length;
  const s = n % 8;
  if (s === 0 || s === 4) tone(sfx, { freq: 120, to: 45, dur: 0.22, gain: 0.2 });
  if (s === 2 || s === 6) noise(sfx, { dur: 0.12, filter: 'bandpass', freq: 1800, to: 1100, gain: 0.07 });
  noise(sfx, { dur: 0.035, filter: 'highpass', freq: 7000, gain: s % 2 ? 0.025 : 0.04 });
  if (s === 0 || s === 3) tone(sfx, { freq: BASS[bar] ?? 87.3, dur: 0.38, type: 'sine', gain: 0.11 });
  if (s === 0) for (const f of CHORDS[bar] ?? []) tone(sfx, { freq: f, dur: 1.2, type: 'triangle', gain: 0.022 });
}

// ------------------------------------------------------------------ the room

interface Rig {
  c: Companion;
  marker: THREE.Mesh;
  frost: THREE.Mesh;
  dots: THREE.Mesh[];
  home: THREE.Vector3;
  mood: CompanionMood | null;
  out: boolean;
  /** Walking to the snack table: 0..1, or -1 not yet. */
  walk: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

class PartyView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly rigs: Rig[] = [];
  readonly dj: Companion;
  readonly floaters: Floaters;
  private readonly fit: CameraFit;
  private readonly marks: Mark[];
  private readonly spots: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; color: THREE.Color; r: number; speed: number; phase: number }[] = [];
  private readonly ice = new THREE.Color(ICE);
  private readonly partyLight: THREE.PointLight;
  private readonly record: THREE.Group;
  private readonly speakers: THREE.Group[] = [];
  private env!: Env;
  private tick: (dt: number, time: number) => void = () => undefined;
  private readonly sideLights: { light: THREE.DirectionalLight; color: THREE.Color }[] = [];
  private readonly ball = new THREE.Group();
  private readonly leds: THREE.Mesh[] = [];
  private shards: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private readonly freezeWord: THREE.Sprite;
  private readonly djCard: THREE.Sprite;
  private freezeAge = 9;
  private pulse = 0;
  private spin = 0;
  frozen = false;

  constructor(seats: MinigameSeat[], companions: Companion[], dj: number, dancers: readonly number[]) {
    this.partyLight = new THREE.PointLight(WARM, PARTY, 18, 1.5);
    this.partyLight.position.set(0, 4.0, 1.2);
    this.scene.add(this.partyLight);
    this.floaters = new Floaters(this.scene);
    this.record = new THREE.Group();
    this.buildRoom();
    // The room's coloured side lights go icy on Freeze!, like everything else.
    for (const o of this.scene.children) {
      const light = o as THREE.DirectionalLight;
      if (!light.isDirectionalLight || light === this.env.sun) continue;
      light.intensity *= 0.6;
      this.sideLights.push({ light, color: light.color.clone() });
    }

    this.dj = companions[dj] as Companion;
    this.dj.root.position.copy(DJ_SPOT);
    this.dj.setBase('talking');
    this.scene.add(this.dj.root);
    this.djCard = nameCard('DJ', seats[dj]?.color ?? '#ffffff', 0.7);
    this.djCard.position.set(DJ_SPOT.x, DJ_SPOT.y + HEIGHT + 0.3, DJ_SPOT.z);
    this.scene.add(this.djCard);

    const xs = lanes(dancers.length, SPACING);
    dancers.forEach((i, k) => {
      const c = companions[i] as Companion;
      const color = seats[i]?.color ?? '#ffffff';
      const home = new THREE.Vector3(xs[k] ?? 0, 0, DANCE_Z + (k % 2) * 0.25);
      c.root.position.copy(home);
      c.setBase('happy');
      this.scene.add(c.root);
      const marker = part(this.scene, torus(0.5, 0.045), color, home.x, 0.075, home.z, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
      const frost = part(this.scene, torus(0.66, 0.04), ICE, home.x, 0.08, home.z, { rx: Math.PI / 2, glow: 1.8, outline: false, shadow: false });
      frost.visible = false;
      const dots = Array.from({ length: FREEZE.strikes }, (_, n) => part(this.scene, sphere(0.075, 12), P.cream, home.x + (n - (FREEZE.strikes - 1) / 2) * 0.24, HEIGHT + 0.3, home.z, { outline: 0.02, gloss: 0.5 }));
      this.rigs[i] = { c, marker, frost, dots, home, mood: null, out: false, walk: -1, from: new THREE.Vector3(), to: new THREE.Vector3() };
    });

    this.freezeWord = popSprite('Freeze!', P.screen, 0.95);
    this.freezeWord.position.set(0, HEIGHT + 1.15, DANCE_Z);
    this.freezeWord.visible = false;
    this.scene.add(this.freezeWord);

    // The dance floor with its strike dots, the DJ and the record player, and the snack corner.
    const half = (SPACING * Math.max(1, dancers.length - 1)) / 2 + 0.8;
    this.marks = [
      ...[-half, half].flatMap((x) => [
        { p: new THREE.Vector3(x, 0, DANCE_Z + 0.9), pad: 0.04 },
        { p: new THREE.Vector3(x, HEIGHT + 0.45, DANCE_Z), pad: 0.06 },
      ]),
      { p: new THREE.Vector3(0, DJ_SPOT.y + HEIGHT + 0.35, DJ_SPOT.z), pad: 0.1 },
      { p: new THREE.Vector3(-2.2, 1.9, -3), pad: 0.02 },
      { p: new THREE.Vector3(SNACKS.x + 1.6, 0, 2.6), pad: 0.03 },
      { p: new THREE.Vector3(SNACKS.x + 1.3, 1.4, SNACKS.z), pad: 0.04 },
    ];
    this.fit = new CameraFit(this.camera, 0.5);
  }

  private buildRoom(): void {
    const s = this.scene;
    const rand = seeded(5);
    // The living room in the small hours, furniture pushed back to the walls, neon on.
    this.env = livingRoom(s, { mood: 'neon', w: 14.4, d: 6.16, h: 3.5, rug: false, accent: P.plum, seed: 3 });
    this.env.root.scale.setScalar(ROOM);
    const set = new THREE.Group();
    s.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = ROOM) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    // The dance floor: a big oval rug.
    const rug = props.rug({ round: true, w: 8.6, color: mix(P.teal, P.midnight, 0.5), border: mix(P.mustard, P.cream, 0.2), tex: 'terry' });
    rug.position.set(0, 0, DANCE_Z);
    rug.scale.set(1, 1, 0.56);
    set.add(rug);

    // Swirling coloured light spots on the floor (they freeze, icy blue, when the music stops).
    SPOT_COLORS.forEach((c, k) => {
      const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(cyl(0.55, 0.55, 0.01, 28), mat);
      m.position.y = 0.06;
      s.add(m);
      this.spots.push({ m, mat, color: new THREE.Color(c), r: 1.2 + rand() * 2.2, speed: (0.5 + rand() * 0.6) * (k % 2 ? 1 : -1), phase: rand() * 6.3 });
    });
    // A mirror ball hanging by the decks.
    part(this.ball, cyl(0.01, 0.01, 1.2, 5), P.ink, 0, 0.75, 0, { outline: false, shadow: false });
    part(this.ball, new THREE.IcosahedronGeometry(0.3, 1), P.slate, 0, 0, 0, { gloss: 0.9, outline: false, shadow: false });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      part(this.ball, gem(0.035), k % 2 ? P.neonPink : P.neonCyan, Math.cos(a) * 0.3, Math.sin(k * 2.1) * 0.14, Math.sin(a) * 0.3, { glow: 2, outline: false, shadow: false });
    }
    this.ball.position.set(3.5, 3.5, -0.4);
    s.add(this.ball);

    // The DJ corner: a low stage, a desk with the deck and a mixer, two speakers.
    const dark = { tex: 'darkWood' as const, texScale: 1.4 };
    part(s, rbox(3.6, 0.28, 1.6, 0.04), mix(P.aubergine, P.plum, 0.4), 0, 0.14, -3.05, { ...dark, outline: 0.025 });
    part(s, box(3.6, 0.03, 0.04), P.neonPink, 0, 0.2, -2.24, { glow: 1.8, outline: false, shadow: false });
    withOutline(0.03, () => {
      part(s, rbox(2.6, 0.85, 0.9, 0.05), P.walnut, 0, 0.5, -2.25, dark);
      part(s, rbox(2.3, 0.5, 0.03, 0.02), mix(P.walnut, P.ink, 0.3), 0, 0.5, -1.79, { outline: false });
      part(s, rbox(1.3, 0.16, 0.8, 0.04), P.charcoal, -0.2, 1.0, -2.25, { gloss: 0.4 });
      part(s, cyl(0.035, 0.035, 0.5, 8), P.brass, 0.32, 1.12, -2.1, { rz: Math.PI / 2, ry: 0.5, gloss: 0.7, outline: false });
      part(s, cyl(0.06, 0.06, 0.1, 10), P.brass, 0.38, 1.1, -2.52, { gloss: 0.7, outline: false });
      part(s, rbox(0.5, 0.26, 0.56, 0.04), P.slate, 0.84, 1.01, -2.25, { gloss: 0.4 });
    });
    [P.neonPink, P.neonCyan, P.lamp, P.neonViolet].forEach((c, k) => {
      this.leds.push(part(s, sphere(0.032, 8), c, 0.68 + (k % 2) * 0.3, 1.15, -2.08 - (k >> 1) * 0.22, { glow: 2, outline: false, shadow: false }));
      part(s, cyl(0.035, 0.035, 0.05, 10), P.cream, 0.7 + (k % 2) * 0.28, 1.16, -2.38 + (k >> 1) * 0.02, { outline: false });
    });
    part(this.record, cyl(0.34, 0.34, 0.03, 36), P.ink, 0, 0, 0, { gloss: 0.6, outline: 0.02 });
    part(this.record, torus(0.24, 0.008), P.slate, 0, 0.016, 0, { rx: Math.PI / 2, outline: false });
    part(this.record, torus(0.17, 0.006), P.slate, 0, 0.016, 0, { rx: Math.PI / 2, outline: false });
    part(this.record, cyl(0.11, 0.11, 0.035, 20), P.terracotta, 0, 0.005, 0, { outline: false });
    part(this.record, box(0.04, 0.036, 0.16), P.cream, 0, 0.006, 0.2, { outline: false });
    this.record.position.set(-0.2, 1.1, -2.25);
    s.add(this.record);
    for (const x of [-2.2, 2.2]) {
      const g = new THREE.Group();
      const sp = props.speaker({ h: 0.95, color: P.espresso });
      sp.scale.setScalar(1.6);
      g.add(sp);
      part(g, torus(0.15, 0.012), P.neonCyan, 0, 0.547, 0.275, { glow: 1.6, outline: false, shadow: false });
      g.position.set(x, 0, -2.6);
      s.add(g);
      this.speakers.push(g);
    }
    put(props.neonSign('freeze', { color: P.neonCyan, h: 0.5 }), -6.3, 3.6, BACK + 0.03);

    // The snack table, and floor cushions round it for anyone who's out.
    put(props.table({ w: 1.5, d: 0.85, h: 0.5, color: P.walnut }), SNACKS.x, 0, SNACKS.z, 0, 1.45);
    const top = 0.5 * 1.45;
    put(props.snackBowl({ fill: 'popcorn', r: 0.17, color: P.teal }), SNACKS.x - 0.55, top, SNACKS.z, 0, 1.7);
    put(props.pizzaBox({ open: true, slices: 3 }), SNACKS.x + 0.4, top, SNACKS.z - 0.1, 0.2, 1.7);
    put(props.drink({ kind: 'can', color: P.terracotta }), SNACKS.x + 0.1, top, SNACKS.z + 0.4, 0, 2.2);
    put(props.drink({ kind: 'bottle', color: P.forest }), SNACKS.x + 0.8, top, SNACKS.z + 0.38, 0, 1.9);
    put(props.drink({ kind: 'can', color: P.denim }), SNACKS.x - 0.2, top, SNACKS.z + 0.42, 0, 2.2);
    const cushions = [P.mustard, P.terracotta, P.rose];
    SEATS_AT.forEach(([x, z], k) => put(props.pouf({ color: cushions[k % cushions.length] as string, r: 0.4, h: 0.22 }), x, 0, z, k, 1.4));
    this.tick = props.tickProps(set);
  }

  /** The DJ called it: lights go icy, the record stops, a big word. */
  setFrozen(on: boolean): void {
    this.frozen = on;
    this.freezeWord.visible = on;
    this.freezeAge = 0;
    this.partyLight.color.set(on ? ICE : WARM);
    for (const l of this.sideLights) l.light.color.copy(on ? this.ice : l.color);
    if (on) {
      // A puff of ice crystals off the mirror ball.
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const m = part(this.scene, gem(0.05), ICE, this.ball.position.x, this.ball.position.y, this.ball.position.z, { glow: 2, outline: false, shadow: false });
        this.shards.push({ m, v: new THREE.Vector3(Math.cos(a) * (1.5 + Math.random()), 0.6 + Math.random(), Math.sin(a) * (1.5 + Math.random())), age: 0 });
      }
    }
    this.dj.react(on ? 'approval' : 'talking', on ? 1.2 : 0.2);
  }

  strike(seat: number, n: number, why: 'stiff' | 'caught'): void {
    const r = this.rigs[seat];
    if (!r) return;
    const dot = r.dots[n - 1];
    if (dot) {
      dot.material = material(P.neonPink, { glow: 1.6 });
      dot.scale.setScalar(1.8);
    }
    const at = r.c.root.position.clone().setY(HEIGHT + 0.85);
    this.floaters.add(why === 'stiff' ? 'Too stiff!' : 'Caught!', why === 'stiff' ? P.moon : P.cream, at, 0.48);
    r.c.react(why === 'stiff' ? 'sleeping' : 'sad', why === 'stiff' ? 1.3 : 1.1);
  }

  /** Two strikes: off to sit by the snack table. */
  sitOut(seat: number, order: number): void {
    const r = this.rigs[seat];
    if (!r || r.out) return;
    r.out = true;
    r.walk = 0;
    r.from.copy(r.c.root.position).setY(0);
    const [x, z] = SEATS_AT[order % SEATS_AT.length] ?? [6, 2];
    r.to.set(x, 0, z);
    r.marker.visible = false;
    r.frost.visible = false;
    for (const d of r.dots) d.visible = false;
    r.c.setBase('sad');
    r.c.move('walk', 2);
  }

  /** Dancing to the beat, frozen like a statue, or caught wobbling: each dancer from their wobble. */
  sync(p: Party, wobble: readonly number[], beat: number, time: number): void {
    for (const d of p.dancers) {
      const r = this.rigs[d.seat];
      if (!r || r.out) continue;
      const w = wobble[d.seat] ?? 0;
      const root = r.c.root;
      if (p.phase === 'music') {
        const amp = Math.min(1, Math.max(0, (w - 0.1) / 0.45));
        const b = Math.sin(Math.PI * beat);
        root.position.set(r.home.x, Math.abs(b) * 0.16 * amp, r.home.z);
        root.rotation.set(0, Math.sin(Math.PI * beat * 0.5) * 0.45 * amp, b * 0.14 * amp);
        r.frost.visible = false;
        const mood: CompanionMood = d.stiff > 0.6 ? 'sleeping' : amp > 0.25 ? 'happy' : 'idle';
        if (mood !== r.mood) {
          r.mood = mood;
          r.c.setBase(mood);
        }
      } else {
        const still = w <= FREEZE.still;
        r.frost.visible = still && !d.struck;
        if (!still) root.rotation.z = Math.sin(time * 34) * 0.05 * Math.min(1, w * 3);
      }
      for (const dot of r.dots) {
        dot.position.y = root.position.y + HEIGHT + 0.3;
        dot.scale.setScalar(1 + (dot.scale.x - 1) * 0.9);
      }
    }
  }

  dispose(): void {
    this.dj.dispose();
    for (const r of this.rigs) r?.c.dispose();
    for (const s of this.spots) s.mat.dispose();
    for (const k of this.shards) k.m.removeFromParent();
    this.floaters.dispose();
    for (const sp of [this.freezeWord, this.djCard]) {
      sp.material.map?.dispose();
      sp.material.dispose();
    }
  }

  /** A kick drum: the speakers thump. */
  thump(): void {
    this.pulse = 1;
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    this.dj.update(dt);
    for (const r of this.rigs) {
      if (!r) continue;
      // A frozen dancer holding still is a statue: their pose stops right where it was.
      const statue = this.frozen && !r.out && r.frost.visible;
      if (!statue) r.c.update(dt);
      if (r.out && r.walk >= 0 && r.walk < 1) {
        r.walk = Math.min(1, r.walk + dt / 1.3);
        r.c.root.position.lerpVectors(r.from, r.to, r.walk);
        r.c.root.rotation.set(0, Math.atan2(r.to.x - r.from.x, r.to.z - r.from.z), 0);
        if (r.walk >= 1) {
          r.c.move(null);
          // Sunk into a floor cushion, facing the room, with a snack.
          r.c.root.position.y = -0.22;
          r.c.root.rotation.set(0, -0.5, 0);
          r.c.setBase('idle');
        }
      }
    }
    this.env.update(dt, time);
    this.tick(dt, time);
    this.shards = this.shards.filter((k) => {
      k.age += dt;
      k.v.y -= dt * 2.5;
      k.m.position.addScaledVector(k.v, dt);
      k.m.rotation.y += dt * 5;
      k.m.scale.setScalar(Math.max(0.01, 1 - k.age / 0.9));
      if (k.age < 0.9) return true;
      k.m.removeFromParent();
      return false;
    });
    if (!this.frozen) this.ball.rotation.y += dt * 0.7;
    this.partyLight.intensity = PARTY * (this.frozen ? 0.8 : 0.85 + this.pulse * 0.3);
    this.leds.forEach((m, i) => m.scale.setScalar(this.frozen ? 0.6 : 0.7 + this.pulse * (i % 2 ? 0.9 : 0.5)));
    for (const sp of this.spots) sp.m.scale.setScalar(this.frozen ? 1 : 1 + this.pulse * 0.18);
    if (!this.frozen) {
      this.spin += dt * 3.5;
      this.record.rotation.y = this.spin;
      this.spots.forEach((s, k) => {
        const a = time * s.speed + s.phase;
        s.m.position.set(Math.cos(a) * s.r, 0.06 + k * 0.002, DANCE_Z + Math.sin(a) * s.r * 0.5);
        s.mat.color.copy(s.color);
      });
    } else {
      for (const s of this.spots) s.mat.color.copy(this.ice);
    }
    this.pulse *= Math.exp(-dt * 9);
    for (const g of this.speakers) g.scale.set(1 + this.pulse * 0.05, 1 + this.pulse * 0.07, 1 + this.pulse * 0.05);
    this.freezeAge += dt;
    if (this.freezeWord.visible) this.freezeWord.scale.set((1024 / 112) * 0.95 * Math.min(1, 0.6 + this.freezeAge * 3), 0.95 * Math.min(1, 0.6 + this.freezeAge * 3), 1);
    this.floaters.update(dt);
  }
}

export const minigame: Minigame = {
  id: 'freezedance',
  title: 'Freeze Dance',
  how: 'Dancers: keep your phone moving while the music plays, and hold it perfectly still when the DJ calls Freeze! Two strikes and you sit out. DJ: catch them all before the 40-second song ends.',
  controller: 'still',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const [soloSide, three] = teamsOf(ctx);
    const dj = soloSide?.[0] ?? 0;
    const dancers = three?.length ? three : seats.map((_, i) => i).filter((i) => i !== dj);
    const idx = seats.map((s) => s.index);
    const posOf = new Map(idx.map((s, i) => [s, i] as const));
    const party = newParty(dj, dancers);
    const view = new PartyView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), dj, dancers);
    ctx.stage.setView(view);
    const isCpu = (i: number) => session.isCpu(idx[i] ?? i);
    const send = (i: number, msg: Parameters<typeof session.send>[1]) => {
      if (!isCpu(i)) session.send(idx[i] ?? i, msg);
    };
    const djName = seats[dj]?.name ?? 'The DJ';
    // Computer players; a phone that drops out mid-game gets one too.
    let djBrain: DjBrain | null = isCpu(dj) ? newDjBrain(ctx.skill()) : null;
    const movers = new Map<number, Mover>();
    for (const i of dancers) if (isCpu(i)) movers.set(i, newMover(ctx.skill()));
    const moverOf = (i: number): Mover => {
      let m = movers.get(i);
      if (!m) movers.set(i, (m = newMover(0.5)));
      return m;
    };

    session.setLayoutAll((seat) => {
      const i = posOf.get(seat.index) ?? -1;
      return i === dj
        ? {
            kind: 'buttons',
            title: 'You’re the DJ',
            buttons: [
              { label: 'Music on', color: '#22B573' },
              { label: 'Freeze!', color: '#3B82F6' },
            ],
            note: 'Call Freeze! and catch anyone still moving, then put the music back on. Catch all three!',
          }
        : { kind: 'still', title: 'Dance, then freeze', note: `You’re a dancer! Keep your phone moving while the music plays; hold it still when ${djName} calls Freeze!` };
    });

    const wobble = seats.map(() => 0.5);
    let pressed: 'music' | 'freeze' | null = null;
    const off = session.onInput((seat, msg) => {
      const i = posOf.get(seat);
      if (i === undefined || session.isCpu(seat)) return;
      if (i === dj && msg.t === 'press') pressed = msg.index === 1 ? 'freeze' : 'music';
      else if (i !== dj && msg.t === 'still') wobble[i] = msg.wobble;
    });

    let musicTime = 0;
    let nextStep = 0;
    let readyTold = false;
    let sat = 0;
    const phaseChanged = (phase: 'music' | 'freeze', auto = false) => {
      view.setFrozen(phase === 'freeze');
      readyTold = false;
      if (phase === 'freeze') {
        noise(sfx, { dur: 0.32, filter: 'bandpass', freq: 2600, to: 280, gain: 0.12 });
        ui.caption('Freeze!', ICE);
        // No buzz for dancers here: a buzzing phone would wobble.
        for (const d of party.dancers) if (d.outAt === null) send(d.seat, { t: 'feedback', good: false, text: 'Freeze! Hold still (or keep your thumb on the circle).' });
      } else {
        tone(sfx, { freq: 330, to: 660, dur: 0.14, gain: 0.08 });
        ui.caption(auto ? 'The record skips back on. Dance!' : 'Music’s back on. Dance!', seats[dj]?.color);
        for (const d of party.dancers) {
          if (d.outAt !== null) continue;
          send(d.seat, { t: 'feedback', good: true, text: 'Music’s on: dance! Keep your phone moving (or lift your thumb off).' });
          send(d.seat, { t: 'buzz', pattern: [30] });
        }
      }
    };

    ui.caption(`${djName} is on the decks. Dance!`, seats[dj]?.color);
    let hudAt = 0;
    await everyFrame(clock, (dt) => {
      // The DJ's buttons.
      if (isCpu(dj)) djBrain ??= newDjBrain(0.5);
      const press = djBrain && isCpu(dj) ? cpuDj(party, djBrain, rng) : pressed;
      pressed = null;
      if (press === 'freeze') {
        const res = djFreeze(party);
        if (res === 'freeze') phaseChanged('freeze');
        else if (res === 'soon') send(dj, { t: 'feedback', good: false, text: 'Let them dance a moment first…' });
        else send(dj, { t: 'feedback', good: false, text: 'They’re already frozen. Music on?' });
      } else if (press === 'music') {
        if (djMusic(party) === 'music') phaseChanged('music');
        else send(dj, { t: 'feedback', good: false, text: 'The music is already playing.' });
      }
      if (!readyTold && party.phase === 'music' && freezeIn(party) <= 0) {
        readyTold = true;
        send(dj, { t: 'feedback', good: true, text: 'Freeze! is ready whenever you are…' });
      }

      for (const i of dancers) if (isCpu(i)) wobble[i] = cpuWobble(party, moverOf(i), rng, dt);
      const lag = seats.map((_, i) => (isCpu(i) ? 0 : (Math.min(200, session.seats[idx[i] ?? i]?.rtt ?? 0) / 2000) * clock.speed));
      const ev = stepParty(party, wobble, dt, lag);
      if (ev.resumed) phaseChanged('music', true);
      for (const s of ev.strikes) {
        const d = dancerOf(party, s.seat);
        if (!d) continue;
        view.strike(s.seat, d.strikes, s.why);
        if (s.why === 'caught') {
          sfx.bad();
          view.dj.react('happy', 0.8);
          send(dj, { t: 'feedback', good: true, text: `Caught ${seats[s.seat]?.name ?? 'one'}!` });
          send(dj, { t: 'buzz', pattern: [25] });
        } else {
          tone(sfx, { freq: 300, to: 200, dur: 0.5, type: 'triangle', gain: 0.07 });
        }
        if (d.outAt === null) {
          send(s.seat, { t: 'feedback', good: false, text: s.why === 'stiff' ? 'Too stiff! Keep dancing. One strike.' : 'Caught moving! One strike.' });
          send(s.seat, { t: 'buzz', pattern: [80, 50, 80] });
        }
      }
      for (const i of ev.out) {
        view.sitOut(i, sat++);
        session.setLayout(idx[i] ?? i, { kind: 'wait', title: 'Snack break', text: 'Two strikes: you’re out. Grab a snack and cheer the others on!' });
        const left = party.dancers.filter((d) => d.outAt === null).length;
        if (left > 0) ui.caption(`${seats[i]?.name ?? 'Someone'} sits out by the snacks. ${left} still dancing!`, seats[i]?.color);
      }

      // The music plays on while it's on; the dancers bob to it.
      if (party.phase === 'music' && !isOver(party)) {
        musicTime += dt;
        while (nextStep * STEP <= musicTime) {
          playStep(sfx, nextStep);
          if (nextStep % 4 === 0) view.thump();
          nextStep++;
        }
      }
      view.sync(party, wobble, musicTime / (STEP * 2), clock.time);

      if (clock.time - hudAt > 0.1) {
        hudAt = clock.time;
        ui.timer(FREEZE.duration - party.time);
        for (const d of party.dancers) {
          if (d.outAt !== null) continue;
          const w = wobble[d.seat] ?? 0;
          const meter = party.phase === 'music' ? { value: d.stiff / FREEZE.stiff, danger: d.stiff > FREEZE.stiff * 0.5 } : { value: Math.min(1, w / (FREEZE.still * 2)), danger: w > FREEZE.still };
          send(d.seat, { t: 'meter', ...meter });
        }
        ui.live(
          seats.map((s, i) => {
            const d = dancerOf(party, i);
            let value = `DJ · ${party.dancers.reduce((n, x) => n + x.catches, 0)} caught`;
            if (d) value = d.outAt !== null ? 'Snack break' : d.strikes ? `${d.strikes} strike` : 'Dancing';
            return { name: s.name, color: s.color, thumb: s.thumb, value };
          }),
        );
      }
      return isOver(party);
    });
    off();
    ui.timer(null);

    // The end of the song.
    const won = djWins(party);
    view.setFrozen(false);
    for (const d of party.dancers) {
      const r = view.rigs[d.seat];
      if (!r || r.out) continue;
      r.c.root.rotation.set(0, 0, 0);
      r.c.root.position.y = 0;
      r.c.setBase('happy');
    }
    view.dj.setBase(won ? 'happy' : 'sad');
    if (won) {
      sfx.fanfare();
      ui.caption(`${djName} cleared the dance floor. Snacks all round.`, seats[dj]?.color);
    } else {
      sfx.win();
      const left = party.dancers.filter((d) => d.outAt === null).length;
      ui.caption(`${left === 1 ? 'One dancer' : `${left} dancers`} lasted the whole song!`);
    }
    for (const i of seats.keys()) send(i, { t: 'buzz', pattern: [40, 30, 120] });
    await clock.wait(2);
    ui.caption(null);

    const caught = party.dancers.reduce((n, d) => n + d.catches, 0);
    const yawns = party.dancers.reduce((n, d) => n + d.stiffs, 0);
    return {
      scores: partyScores(party, seats.length),
      details: seats.map((_, i) => {
        if (i === dj) return won ? `Cleared the floor in ${(party.doneAt ?? party.time).toFixed(1)} s` : `${caught} caught, ${yawns} too stiff · ${party.freezes} freezes`;
        const d = dancerOf(party, i);
        if (!d) return '';
        if (d.outAt !== null) return `Sat out at ${d.outAt.toFixed(1)} s`;
        return d.strikes ? `Danced to the end · ${d.strikes} strike` : 'Danced to the end, no strikes';
      }),
    };
  },
};
