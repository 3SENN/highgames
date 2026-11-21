// Snack Pass on the TV: evening in the living room, two sofas, two coffee tables and a lot of chips. Partners toss
// a little bowl back and forth in front of their sofa; every good pass tops up the team's big bowl on the table.
import * as THREE from 'three';
import {
  type Bowl,
  type Catch,
  SNACK,
  type Toss,
  applyPass,
  bowlScore,
  catchWindow,
  cpuCatchOffset,
  cpuTossValue,
  flightTime,
  judgeCatch,
  judgeToss,
  meterAt,
  newBowl,
  snackScores,
  sweepSpeed,
} from '../../../game/minigames/snackpass';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cyl, lathe, material, mix, nameCard, part, popSprite, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameContext, type MinigameSeat, everyFrame } from '../types';

const SIDE = 4.7; // each team's coffee table stands this far left or right of the middle
const GAP = 1.9; // partners stand this far either side of their table
const HEIGHT = 1.5; // companions
const HANDS = 0.95;
const TABLE_Z = -0.85;
const BOWL_Y = 0.86; // the inside of the big bowl
const GAUGE = { bottom: 0.35, height: 1.5 };
const CHIPS_MAX = 110;
const CHIP_COLORS = ['#e9b955', '#dca43f', '#f0c96a', '#d99a3a'];
const ROOM = 2.0; // the room is this much bigger than life
const BITS_MAX = 60;
const TILT = 0.3; // the camera looks down this much (radians)
const SAFE_Y = 0.8; // keep everything that matters inside this much of the frame (the HUD bars sit outside)
const SAFE_X = 0.94;
/** The live score list sits on the left of the screen: marks stay right of it (normalised screen units). */
const SAFE_LEFT = 0.56;

// ------------------------------------------------------------------ helpers

/** Each side's seat positions (indexes into ctx.seats), from ctx.teams or, without it, the seats split in two. */
function teamsOf(ctx: MinigameContext): number[][] {
  const pos = new Map(ctx.seats.map((s, i) => [s.index, i] as const));
  const given = (ctx.teams ?? []).map((t) => t.map((s) => pos.get(s)).filter((p): p is number => p !== undefined)).filter((t) => t.length > 0);
  if (given.length >= 2) return given.slice(0, 2);
  const all = ctx.seats.map((_, i) => i);
  const half = Math.ceil(all.length / 2);
  return [all.slice(0, half), all.slice(half)].filter((t) => t.length > 0);
}

interface Mark {
  p: THREE.Vector3;
  /** Extra room in normalised screen units (for labels that keep their size on screen). */
  pad?: number;
}

/** The closest camera, looking down by `tilt`, that keeps every mark in the safe middle of the frame. */
function frameMarks(probe: THREE.PerspectiveCamera, marks: readonly Mark[], tilt: number): { pos: THREE.Vector3; look: THREE.Vector3 } {
  const look = new THREE.Vector3();
  let low = Infinity;
  let high = -Infinity;
  for (const m of marks) {
    look.x += m.p.x / marks.length;
    look.z += m.p.z / marks.length;
    low = Math.min(low, m.p.y);
    high = Math.max(high, m.p.y);
  }
  const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
  const tan = Math.tan(THREE.MathUtils.degToRad(probe.fov / 2));
  const v = new THREE.Vector3();
  const place = (dist: number) => {
    probe.position.copy(look).addScaledVector(dir, dist);
    probe.lookAt(look);
    probe.updateMatrixWorld();
  };
  const extent = () => {
    let lo = Infinity;
    let hi = -Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (const m of marks) {
      v.copy(m.p).project(probe);
      lo = Math.min(lo, v.y - (m.pad ?? 0));
      hi = Math.max(hi, v.y + (m.pad ?? 0));
      left = Math.min(left, v.x);
      right = Math.max(right, v.x);
    }
    return { lo, hi, left, right };
  };
  // At a given distance, slide the camera until the marks sit in the middle of the free part of the frame
  // (vertically the middle, horizontally between the score list and the right edge).
  const midX = (SAFE_X - SAFE_LEFT) / 2;
  const settle = (dist: number) => {
    look.y = (low + high) / 2;
    for (let k = 0; k < 4; k++) {
      place(dist);
      const e = extent();
      look.y += ((e.hi + e.lo) / 2) * dist * tan;
      look.x += ((e.right + e.left) / 2 - midX) * dist * tan * probe.aspect;
    }
    place(dist);
    return extent();
  };
  let near = 3;
  let far = 90;
  for (let i = 0; i < 22; i++) {
    const mid = (near + far) / 2;
    const e = settle(mid);
    if (e.hi <= SAFE_Y && e.lo >= -SAFE_Y && e.left >= -SAFE_LEFT && e.right <= SAFE_X) far = mid;
    else near = mid;
  }
  settle(far);
  return { pos: probe.position.clone(), look: look.clone() };
}

/** Floating words ("+6", "Clean catch!") that drift up and fade. */
class Floaters {
  private list: { s: THREE.Sprite; age: number; life: number }[] = [];
  constructor(private readonly scene: THREE.Scene) {}

  add(text: string, color: string, at: THREE.Vector3, height = 0.45, life = 1.1): void {
    const s = popSprite(text, color, height);
    s.position.copy(at);
    this.scene.add(s);
    this.list.push({ s, age: 0, life });
  }

  update(dt: number): void {
    this.list = this.list.filter((f) => {
      f.age += dt;
      const k = f.age / f.life;
      f.s.position.y += dt * 0.7 * (1 - k);
      f.s.material.opacity = Math.min(1, 3 * (1 - k));
      if (k < 1) return true;
      this.drop(f.s);
      return false;
    });
  }

  dispose(): void {
    for (const f of this.list) this.drop(f.s);
    this.list = [];
  }

  private drop(s: THREE.Sprite): void {
    this.scene.remove(s);
    s.material.map?.dispose();
    s.material.dispose();
  }
}

/** A crunchy little crackle: chips. */
function crunch(sfx: Sfx, gain = 0.35): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  const len = Math.ceil(ctx.sampleRate * 0.22);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const phase = (i / ctx.sampleRate) % 0.055;
    data[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - phase / 0.03) * (1 - i / len);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2600;
  filter.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(out);
  src.start(ctx.currentTime);
}

/** A soft swish for a toss (quieter than the shared whoosh, as two teams toss at once). */
function swish(sfx: Sfx): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(420, t0);
  osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.16);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.24);
}

// ------------------------------------------------------------------ the scene

function chip(group: THREE.Object3D, rand: () => number, x: number, y: number, z: number): THREE.Mesh {
  return part(group, ball(0.075, 1), CHIP_COLORS[Math.floor(rand() * CHIP_COLORS.length)] as string, x, y, z, {
    sx: 1,
    sy: 0.3,
    sz: 0.8,
    rx: (rand() - 0.5) * 1.2,
    ry: rand() * Math.PI,
    rz: (rand() - 0.5) * 1.2,
    outline: false,
    shadow: false,
  });
}

/** A sofa, facing the room: the team's colour mixed well down, with a cushion in each partner's colour. */
function sofa(scene: THREE.Scene, x: number, z: number, color: string, pillows: string[]): void {
  const fabric = mix(color, P.aubergine, 0.62);
  const light = mix(fabric, P.cream, 0.1);
  const fab = { tex: 'fabric' as const, texScale: 1.2, texStrength: 0.85 };
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  part(g, rbox(4.2, 0.55, 1.2, 0.12), mix(fabric, P.ink, 0.15), 0, 0.38, 0, fab);
  for (const sx of [-1, 1]) {
    part(g, rbox(1.95, 0.22, 1.0, 0.1), light, sx * 1.0, 0.75, 0.08, fab);
    part(g, rbox(1.9, 0.6, 0.24, 0.1), light, sx * 1.0, 1.12, -0.26, { rx: -0.12, ...fab });
    part(g, rbox(0.38, 0.85, 1.2, 0.14), fabric, sx * 2.1, 0.62, 0, fab);
    for (const sz of [-1, 1]) part(g, cyl(0.06, 0.05, 0.12, 8), P.walnut, sx * 1.9, 0.06, sz * 0.45, { outline: false });
  }
  part(g, rbox(4.2, 1.0, 0.35, 0.14), fabric, 0, 1.05, -0.45, fab);
  pillows.forEach((c, i) => part(g, rbox(0.62, 0.52, 0.18, 0.12), mix(c, P.cream, 0.12), (i === 0 ? -1 : 1) * 1.45, 1.1, -0.06, { rz: (i === 0 ? 1 : -1) * 0.18, rx: -0.2, tex: 'knit', texScale: 0.5 }));
  scene.add(g);
}

/** The little bowl that gets tossed. */
function passBowl(color: string, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  part(g, lathe([[0, -0.1], [0.17, -0.1], [0.3, 0.1], [0.27, 0.1], [0.15, -0.06], [0, -0.06]], 22), P.ceramic, 0, 0, 0, { gloss: 0.5 });
  part(g, torus(0.285, 0.028), color, 0, 0.095, 0, { rx: Math.PI / 2, outline: false, glow: 0.35 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    chip(g, rand, Math.cos(a) * 0.14, 0.13 + rand() * 0.04, Math.sin(a) * 0.14);
  }
  chip(g, rand, 0, 0.18, 0);
  return g;
}

interface Bit {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  resting: boolean;
  /** Set for chips arcing into the big bowl: they vanish when they arrive. */
  to?: THREE.Vector3;
  from?: THREE.Vector3;
  age: number;
}

interface Thrower {
  companion: Companion;
  team: number;
  x: number;
  /** Towards the partner: +1 or -1. */
  dir: number;
  color: string;
  gauge: THREE.Group;
  marker: THREE.Object3D;
}

interface Side {
  x: number;
  color: string;
  bowl: THREE.Group;
  chips: THREE.Mesh[];
  pop: number[];
  shown: number;
  ring: THREE.Mesh;
  target: THREE.Mesh;
  // The flight of the little bowl.
  holder: number | null;
  from: THREE.Vector3;
  to: THREE.Vector3;
  age: number;
  duration: number;
  flying: boolean;
  sloppy: boolean;
  spilled: boolean;
  dropped: boolean;
  dropAge: number;
  dropFrom: THREE.Vector3;
  dropTo: THREE.Vector3;
  wind: number;
  appear: number;
}

class LivingRoom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly sides: Side[] = [];
  /** By seat position. */
  readonly players: (Thrower | undefined)[] = [];
  private readonly companions: Companion[];
  private readonly floaters: Floaters;
  private readonly probe = new THREE.PerspectiveCamera();
  private readonly marks: Mark[] = [];
  private aspect = 0;
  private bits: Bit[] = [];
  private rand = seeded(31);
  private time = 0;
  private readonly env: Env;
  private tick: (dt: number, time: number) => void = () => {};
  /** The big bowls jump a little when chips land in them (by team). */
  private readonly bowls: { g: THREE.Group; pop: number }[] = [];

  constructor(seats: MinigameSeat[], teams: number[][], companions: Companion[]) {
    this.companions = companions;
    this.floaters = new Floaters(this.scene);
    // Evening in the living room, lamps on. Everything is big, like the sofas.
    this.env = livingRoom(this.scene, { mood: 'evening', w: 14.6, d: 4.6, h: 4.6, rug: false, accent: P.mustard, seed: 4 });
    this.env.root.scale.setScalar(ROOM);
    this.env.root.position.z = 0.4;
    for (const l of this.env.lamps) {
      l.intensity *= 2;
      l.distance *= ROOM;
    }
    const sc = this.env.sun.shadow.camera;
    sc.left = sc.bottom = -11;
    sc.right = sc.top = 11;
    sc.updateProjectionMatrix();
    this.room();

    teams.forEach((members, team) => {
      const x = (team === 0 ? -1 : 1) * (teams.length > 1 ? SIDE : 0);
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      // The team's rug (their colour mixed down, with a bright edge), sofa, coffee table and big bowl.
      const flat = { outline: false as const, shadow: false };
      part(this.scene, cyl(1, 1, 0.04, 48), mix(color, P.aubergine, 0.7), x, 0.02, -0.4, { sx: 3.0, sz: 1.8, tex: 'terry', ...flat });
      part(this.scene, cyl(1, 1, 0.04, 48), mix(color, P.aubergine, 0.6), x, 0.026, -0.4, { sx: 2.5, sz: 1.42, tex: 'terry', ...flat });
      part(this.scene, torus(1, 0.016), color, x, 0.045, -0.4, { rx: Math.PI / 2, sx: 2.98, sy: 1.78, glow: 0.5, ...flat });
      part(this.scene, rbox(1.8, 0.12, 1.0, 0.05), P.walnut, x, 0.5, TABLE_Z, { tex: 'wood' });
      part(this.scene, rbox(1.5, 0.05, 0.8, 0.02), mix(P.walnut, P.ink, 0.25), x, 0.2, TABLE_Z, { tex: 'wood', outline: false });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(this.scene, rbox(0.1, 0.44, 0.1, 0.03), mix(P.walnut, P.ink, 0.25), x + sx * 0.75, 0.22, TABLE_Z + sz * 0.38, { tex: 'wood', outline: false });
      // The big bowl: glazed cream, the team's colour on the rim.
      const big = new THREE.Group();
      big.position.set(x, 0, TABLE_Z);
      part(big, cyl(0.62, 0.4, 0.34, 30), P.ceramic, 0, 0.73, 0, { gloss: 0.55 });
      part(big, cyl(0.42, 0.44, 0.04, 30), mix(P.ceramic, P.ink, 0.2), 0, 0.575, 0, { outline: false });
      part(big, cyl(0.56, 0.56, 0.02, 30), mix(P.walnut, P.ink, 0.35), 0, BOWL_Y, 0, flat);
      part(big, torus(0.6, 0.035), color, 0, 0.9, 0, { rx: Math.PI / 2, outline: false, glow: 0.45 });
      this.scene.add(big);
      this.bowls.push({ g: big, pop: 1 });
      sofa(this.scene, x, -2.5, color, members.map((p) => seats[p]?.color ?? color));
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.25);
      card.position.set(x, 0.3, 2.2);
      this.scene.add(card);

      // A heap of chips that grows as passes land.
      const rand = seeded(100 + team);
      const chips: THREE.Mesh[] = [];
      for (let i = 0; i < CHIPS_MAX; i++) {
        const f = i / CHIPS_MAX;
        const reach = 0.5 * (1 - 0.8 * f);
        const r = reach * Math.sqrt(rand());
        const a = rand() * Math.PI * 2;
        const c = chip(this.scene, rand, x + Math.cos(a) * r, BOWL_Y + 0.03 + f * 0.55 + (1 - r / 0.5) * 0.03, TABLE_Z + Math.sin(a) * r);
        c.visible = false;
        chips.push(c);
      }

      const bowl = passBowl(color, rand);
      this.scene.add(bowl);
      // The catch cue: a ring that closes in on the catcher's hands as the bowl comes down.
      const ring = part(this.scene, torus(1, 0.035), '#ffffff', 0, 0, 0, { glow: 1.6, outline: false, shadow: false });
      const target = part(this.scene, torus(0.32, 0.03), '#ffffff', 0, 0, 0, { basic: true, opacity: 0.7, shadow: false });
      ring.visible = target.visible = false;
      this.sides.push({
        x,
        color,
        bowl,
        chips,
        pop: chips.map(() => 1),
        shown: 0,
        ring,
        target,
        holder: null,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        age: 0,
        duration: 1,
        flying: false,
        sloppy: false,
        spilled: false,
        dropped: false,
        dropAge: 0,
        dropFrom: new THREE.Vector3(),
        dropTo: new THREE.Vector3(),
        wind: 0,
        appear: 1,
      });

      members.forEach((p, m) => {
        const seat = seats[p];
        const c = companions[p];
        if (!seat || !c) return;
        const side = members.length > 1 ? (m === 0 ? -1 : 1) : -1;
        const px = x + side * GAP;
        c.root.position.set(px, 0, 0.3);
        c.root.rotation.y = -side * 0.45; // half turned towards the partner, still facing the room
        c.setBase('listening');
        this.scene.add(c.root);
        part(this.scene, torus(0.6, 0.045), seat.color, px, 0.07, 0.3, { rx: Math.PI / 2, glow: 1.0, outline: false, shadow: false });
        // The toss meter beside the thrower: gold is the sweet spot, red is too hard.
        const gauge = new THREE.Group();
        gauge.position.set(px + side * 0.85, 0, 0.35);
        const { bottom, height } = GAUGE;
        const at = (v: number) => bottom + v * height;
        part(gauge, rbox(0.38, height + 0.16, 0.1, 0.05), P.ink, 0, at(0.5), 0);
        part(gauge, box(0.24, height, 0.04), P.cream, 0, at(0.5), 0.05, { basic: true });
        part(gauge, box(0.24, 2 * SNACK.good * height, 0.04), P.mustard, 0, at(SNACK.sweet), 0.06, { basic: true, exact: true });
        part(gauge, box(0.24, 2 * SNACK.perfect * height, 0.04), P.lamp, 0, at(SNACK.sweet), 0.07, { glow: 1.6, shadow: false });
        const red = 1 - SNACK.sweet - SNACK.good;
        part(gauge, box(0.24, red * height, 0.04), '#d9564f', 0, at(1 - red / 2), 0.06, { basic: true, exact: true });
        const marker = new THREE.Group();
        part(marker, rbox(0.5, 0.08, 0.12, 0.03), P.cream, 0, 0, 0.1);
        part(marker, sphere(0.07, 10), seat.color, -side * 0.3, 0, 0.1, { glow: 1.2 });
        gauge.add(marker);
        gauge.visible = false;
        this.scene.add(gauge);
        this.players[p] = { companion: c, team, x: px, dir: -side, color: seat.color, gauge, marker };
        for (const y of [0, HEIGHT + 0.5]) this.marks.push({ p: new THREE.Vector3(px + side * 1.1, y, 0.3) });
      });
      // The highest lob, the words over the heads, and the team's name card on the floor.
      this.marks.push({ p: new THREE.Vector3(x, HANDS + 2.6, 0.55) }, { p: new THREE.Vector3(x - 1.3, 0.3, 2.2), pad: 0.07 }, { p: new THREE.Vector3(x + 1.3, 0.3, 2.2), pad: 0.07 });
    });
  }

  /** What the game adds to the living room: a lamp between the sofas, things in the foreground. */
  private room(): void {
    const s = new THREE.Group();
    this.scene.add(s);
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, k = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(k);
      s.add(o);
      return o;
    };
    // A lamp and a plant between the sofas.
    put(props.floorLamp({ lit: true, light: 9, h: 1.75 }), 0.5, 0, -2.9, 0, 1.6);
    put(props.plant({ kind: 'monstera', h: 1.0, pot: P.ceramic }), -0.7, 0, -3.1, 0, 1.6);
    // In front: floor cushions, a pizza box, cans.
    put(props.rug({ w: 9.5, d: 3.8, color: mix(P.terracotta, P.mahogany, 0.35), tex: 'knit' }), 0.4, 0, 5.4);
    put(props.pouf({ color: P.mustard, r: 0.4 }), 0.3, 0, 4.7, 0, 1.6);
    put(props.pizzaBox({ open: true, slices: 3 }), -1.3, 0.03, 5.2, 0.4, 1.8);
    put(props.drink({ kind: 'can', color: P.teal }), 1.5, 0.03, 5.1, 0, 2.2);
    put(props.drink({ kind: 'can', color: P.rose }), 1.8, 0.03, 5.4, 0, 2.2);
    put(props.beanbag({ color: P.teal }), 6.6, 0, 6.2, -0.5, 1.9);
    put(props.plant({ kind: 'ficus', h: 1.6, pot: P.charcoal }), -7.6, 0, 6.3, 0, 1.9);
    put(props.crate({ s: 0.5 }), -5.9, 0, 6.8, 0.3, 1.7);
    put(props.snackBowl({ fill: 'popcorn', color: P.terracotta }), -5.9, 0.85, 6.8, 0, 2.0);
    put(props.motes({ n: 22, area: [20, 5, 5], size: 0.08 }), 0, 0.8, 0.5);
    this.tick = props.tickProps(s);
  }

  private hands(p: number, out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.players[p];
    return out.set((t?.x ?? 0) + (t?.dir ?? 0) * 0.42, HANDS, 0.6);
  }

  /** The bowl pops into the thrower's hands and their meter appears. */
  aim(team: number, thrower: number): void {
    const s = this.sides[team];
    if (!s) return;
    if (s.holder !== thrower || s.dropped) s.appear = 0;
    s.holder = thrower;
    s.flying = false;
    s.dropped = false;
    s.wind = 0;
    s.bowl.rotation.set(0, 0, 0);
    this.gauge(team, thrower);
  }

  /** The thrower's meter, while they wind up. */
  meter(team: number, value: number): void {
    const s = this.sides[team];
    const t = s?.holder != null ? this.players[s.holder] : undefined;
    if (!s || !t) return;
    s.wind = value;
    t.marker.position.y = GAUGE.bottom + value * GAUGE.height;
  }

  toss(team: number, from: number, to: number, toss: Toss, duration: number): void {
    const s = this.sides[team];
    if (!s) return;
    this.gauge(team, null);
    this.hands(from, s.from);
    this.hands(to, s.to);
    s.holder = to;
    s.flying = true;
    s.sloppy = toss === 'sloppy';
    s.spilled = false;
    s.age = 0;
    s.duration = duration;
    s.ring.material = material(this.players[to]?.color ?? '#ffffff', { glow: 1.2 });
    s.ring.visible = s.target.visible = true;
  }

  /** The pass is over: caught (chips arc into the big bowl) or dropped (chips on the floor). */
  land(team: number, caught: Catch, delta: number, chips: number): void {
    const s = this.sides[team];
    if (!s) return;
    s.flying = false;
    s.ring.visible = s.target.visible = false;
    const at = new THREE.Vector3(s.x, BOWL_Y + 0.9, TABLE_Z);
    if (caught === 'miss') {
      s.dropped = true;
      s.dropAge = 0;
      s.dropFrom.copy(s.bowl.position);
      s.dropTo.set(s.to.x + Math.sign(s.to.x - s.from.x) * 0.5, 0.1, 0.95);
      for (let i = 0; i < 7; i++) this.spill(s.dropTo.clone().setY(0.3), 1.6);
    } else {
      for (let i = 0; i < Math.min(5, Math.max(1, delta)); i++) this.arc(s.bowl.position, new THREE.Vector3(s.x + (this.rand() - 0.5) * 0.4, BOWL_Y + 0.3, TABLE_Z), i * 0.06);
    }
    if (delta < 0) {
      for (let i = 0; i < Math.min(6, -delta); i++) this.spill(new THREE.Vector3(s.x, BOWL_Y + 0.4, TABLE_Z), 2.2);
    }
    if (delta !== 0) this.floaters.add(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}`, delta > 0 ? '#fff6a8' : '#ffb3c0', at, 0.55, 1.3);
    const big = this.bowls[team];
    if (big && delta > 0) big.pop = -0.25; // the chips are still in the air for a moment
    this.setChips(s, chips);
  }

  /** Words over a companion's head. */
  say(p: number, text: string, color: string): void {
    const t = this.players[p];
    if (t) this.floaters.add(text, color, new THREE.Vector3(t.x, HEIGHT + 0.65, 0.4), 0.38, 1.0);
  }

  cheer(team: number, text: string): void {
    const s = this.sides[team];
    if (s) this.floaters.add(text, '#fff6a8', new THREE.Vector3(s.x, 2.6, 0), 0.6, 2.4);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
  }

  /** Time's up: the meters go away. */
  gaugeOff(team: number): void {
    this.gauge(team, null);
    const s = this.sides[team];
    if (s) s.wind = 0;
  }

  /** Shows only the thrower's meter on this team's side. */
  private gauge(team: number, thrower: number | null): void {
    this.players.forEach((t, p) => {
      if (!t || t.team !== team) return;
      t.gauge.visible = p === thrower;
      t.marker.position.y = GAUGE.bottom;
    });
  }

  private setChips(s: Side, chips: number): void {
    const n = Math.min(CHIPS_MAX, Math.max(0, chips));
    s.chips.forEach((c, i) => {
      const was = c.visible;
      c.visible = i < n;
      if (c.visible && !was) s.pop[i] = -0.05 * (i - s.shown);
    });
    s.shown = n;
  }

  /** A chip flying off and landing on the floor. */
  private spill(from: THREE.Vector3, speed: number): void {
    const mesh = chip(this.scene, this.rand, from.x, from.y, from.z);
    const a = this.rand() * Math.PI * 2;
    this.bits.push({ mesh, v: new THREE.Vector3(Math.cos(a) * speed * (0.4 + this.rand() * 0.6), 1.5 + this.rand() * 2, Math.abs(Math.sin(a)) * speed * 0.6 + 0.2), resting: false, age: 0 });
    this.trim();
  }

  /** A chip arcing from the little bowl into the big one. */
  private arc(from: THREE.Vector3, to: THREE.Vector3, delay: number): void {
    const mesh = chip(this.scene, this.rand, from.x, from.y, from.z);
    mesh.visible = false;
    this.bits.push({ mesh, v: new THREE.Vector3(), resting: false, from: from.clone(), to, age: -delay });
    this.trim();
  }

  private trim(): void {
    while (this.bits.length > BITS_MAX) {
      const old = this.bits.shift();
      if (old) this.scene.remove(old.mesh);
    }
  }

  update(dt: number, time: number): void {
    this.time += dt;
    this.env.update(dt, time);
    this.tick(dt, time);
    // The big bowl squashes and settles as chips land in it.
    for (const b of this.bowls) {
      b.pop = Math.min(1, b.pop + dt * 3.2);
      const k = Math.max(0, b.pop);
      const w = k < 1 ? Math.sin(k * Math.PI * 2.5) * (1 - k) * 0.09 : 0;
      b.g.scale.set(1 + w, 1 - w, 1 + w);
    }
    for (const c of this.companions) c.update(dt);
    for (const s of this.sides) this.animate(s, dt);
    this.bits = this.bits.filter((b) => {
      b.age += dt;
      if (b.to && b.from) {
        if (b.age < 0) return true;
        const k = Math.min(1, b.age / 0.45);
        b.mesh.visible = true;
        b.mesh.position.lerpVectors(b.from, b.to, k);
        b.mesh.position.y += Math.sin(Math.PI * k) * 0.8;
        b.mesh.rotation.x += dt * 9;
        if (k < 1) return true;
        this.scene.remove(b.mesh);
        return false;
      }
      if (b.resting) return true;
      b.v.y -= 12 * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      b.mesh.rotation.x += dt * 7;
      b.mesh.rotation.z += dt * 5;
      if (b.mesh.position.y <= 0.03) {
        b.mesh.position.y = 0.03;
        b.mesh.rotation.set(0, b.mesh.rotation.y, 0);
        b.resting = true;
      }
      return true;
    });
    this.floaters.update(dt);
    if (this.camera.aspect !== this.aspect) {
      this.aspect = this.camera.aspect;
      this.probe.fov = this.camera.fov;
      this.probe.aspect = this.camera.aspect;
      this.probe.updateProjectionMatrix();
      const { pos, look } = frameMarks(this.probe, this.marks, TILT);
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
    }
  }

  private animate(s: Side, dt: number): void {
    // New chips in the big bowl pop in.
    for (let i = 0; i < s.chips.length; i++) {
      const c = s.chips[i] as THREE.Mesh;
      const k = s.pop[i] ?? 1;
      if (k >= 1 || !c.visible) continue;
      s.pop[i] = k + dt * 4;
      const e = Math.max(0, Math.min(1, s.pop[i] ?? 1));
      c.scale.set(e, 0.3 * e, 0.8 * e);
    }
    const b = s.bowl;
    s.appear = Math.min(1, s.appear + dt * 5);
    if (s.dropped) {
      s.dropAge += dt;
      const k = Math.min(1, s.dropAge / 0.3);
      b.position.lerpVectors(s.dropFrom, s.dropTo, k);
      b.position.y += Math.sin(Math.PI * k) * 0.25;
      b.rotation.set(0, 0, Math.sign(s.to.x - s.from.x || 1) * -2.2 * k);
      return;
    }
    if (s.flying) {
      s.age += dt;
      const k = s.age / s.duration;
      const atelier = 1.5 + (s.duration - 0.9) * 2;
      b.position.lerpVectors(s.from, s.to, k);
      b.position.y += 4 * atelier * k * (1 - k);
      if (s.sloppy) {
        b.rotation.set(Math.sin(s.age * 9) * 0.6, s.age * 4, Math.sin(s.age * 13) * 0.7);
        if (!s.spilled && k > 0.4) {
          s.spilled = true;
          for (let i = 0; i < 3; i++) this.spill(b.position, 1.2);
        }
      } else {
        b.rotation.set(0, s.age * 2.5, Math.sin(s.age * 6) * 0.12);
      }
      const r = 0.32 + 1.3 * Math.max(0, 1 - k);
      s.ring.position.set(s.to.x, s.to.y + 0.12, s.to.z + 0.3);
      s.ring.scale.set(r, r, 1);
      s.target.position.set(s.to.x, s.to.y + 0.12, s.to.z + 0.3);
      return;
    }
    // Held: bobbing in the hands, pulled back while the thrower winds up.
    if (s.holder === null) {
      b.position.set(s.x, -5, 0);
      return;
    }
    const t = this.players[s.holder];
    this.hands(s.holder, b.position);
    b.position.x -= (t?.dir ?? 0) * s.wind * 0.25;
    b.position.y += Math.sin(this.time * 3 + s.x) * 0.03 - s.wind * 0.12;
    b.rotation.set(0, 0, (t?.dir ?? 0) * s.wind * 0.3);
    b.scale.setScalar(0.4 + 0.6 * s.appear);
  }
}

// ------------------------------------------------------------------ the game

interface Lane {
  members: number[];
  bowl: Bowl;
  /** Member index of the thrower; the other member catches. */
  thrower: number;
  phase: 'pause' | 'aim' | 'flight';
  phaseAt: number;
  downAt: number | null;
  toss: Toss;
  tossAt: number;
  landAt: number;
  caught: { q: Catch; at: number } | null;
  cpuPressAt: number | null;
  cpuHold: number;
  cpuCatchAt: number | null;
}

const TOSS_WORDS: Record<Toss, { phone: string; tv: string; color: string }> = {
  perfect: { phone: 'Perfect toss!', tv: 'Perfect!', color: '#ffd166' },
  good: { phone: 'Nice toss!', tv: 'Nice toss', color: '#ffffff' },
  sloppy: { phone: 'Sloppy toss… chips everywhere!', tv: 'Sloppy…', color: '#ffb3c0' },
};
const CATCH_WORDS: Record<Catch, { tv: string; color: string }> = {
  clean: { tv: 'Clean catch!', color: '#ffd166' },
  good: { tv: 'Caught it', color: '#ffffff' },
  miss: { tv: 'Dropped!', color: '#ffb3c0' },
};

export const minigame: Minigame = {
  id: 'snackpass',
  title: 'Snack Pass',
  how: 'Toss the chips back and forth with your partner: hold the button, let go in the gold, then press again just as the bowl lands to catch it. Good passes fill your team’s bowl, sloppy ones spill!',
  controller: 'hold',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const skill = seats.map(() => ctx.skill());
    const view = new LivingRoom(seats, teams, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);

    const lanes: Lane[] = teams.map((members) => ({
      members,
      bowl: newBowl(),
      thrower: 0,
      phase: 'pause',
      phaseAt: 0,
      downAt: null,
      toss: 'good',
      tossAt: 0,
      landAt: 0,
      caught: null,
      cpuPressAt: null,
      cpuHold: 0,
      cpuCatchAt: null,
    }));
    const slotOf = new Map<number, number>();
    teams.forEach((t, team) => t.forEach((p) => slotOf.set(p, team)));
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const meterTo = (p: number, value: number, danger = false) => session.send(seatOf(p), { t: 'meter', value, danger });
    const throwerOf = (l: Lane) => l.members[l.thrower] ?? l.members[0] ?? 0;
    const catcherOf = (l: Lane) => l.members[l.members.length > 1 ? 1 - l.thrower : 0] ?? throwerOf(l);
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');

    session.setLayoutAll(() => ({ kind: 'hold', label: 'Chips!', note: 'Hold to wind up, let go in the gold. Press again as the bowl lands!', zone: [SNACK.sweet - SNACK.good, Math.min(1, SNACK.sweet + SNACK.good)] }));

    let now = 0;
    let frameAt = performance.now();
    let over = false;
    /** Whose button is down right now (by seat position). */
    const held = seats.map(() => false);

    const startAim = (l: Lane, team: number, t: number) => {
      const thrower = throwerOf(l);
      const catcher = catcherOf(l);
      l.phase = 'aim';
      l.phaseAt = t;
      // Still holding from the catch? Then the wind-up starts right away.
      l.downAt = !cpu(thrower) && held[thrower] ? t : null;
      l.cpuPressAt = null;
      view.aim(team, thrower);
      view.players[thrower]?.companion.setBase('thinking');
      tell(thrower, true, 'Your toss! Hold… let go in the gold.');
      if (catcher !== thrower) tell(catcher, true, `Get ready: ${nameOf(thrower)} is tossing…`);
    };

    const release = (l: Lane, team: number, value: number) => {
      if (l.phase !== 'aim') return;
      const thrower = throwerOf(l);
      const catcher = catcherOf(l);
      l.toss = judgeToss(value);
      l.tossAt = now;
      l.landAt = now + flightTime(value);
      l.phase = 'flight';
      l.caught = null;
      l.cpuCatchAt = null;
      view.toss(team, thrower, catcher, l.toss, l.landAt - l.tossAt);
      view.players[thrower]?.companion.setBase('listening');
      view.players[thrower]?.companion.react(l.toss === 'sloppy' ? 'thinking' : 'approval', 0.8);
      const words = TOSS_WORDS[l.toss];
      view.say(thrower, words.tv, words.color);
      swish(sfx);
      if (l.toss === 'sloppy') crunch(sfx, 0.2);
      meterTo(thrower, 0);
      tell(thrower, l.toss !== 'sloppy', words.phone);
      tell(catcher, true, 'Incoming! Press as it lands.');
      session.send(seatOf(catcher), { t: 'buzz', pattern: [20] });
    };

    /** A catch press at `t` (already corrected for the phone's delay). The first press counts. */
    const grab = (l: Lane, t: number) => {
      if (l.phase !== 'flight' || l.caught) return;
      l.caught = { q: judgeCatch(t - l.landAt, l.toss), at: t };
    };

    const resolve = (l: Lane, team: number, q: Catch, t: number) => {
      const thrower = throwerOf(l);
      const catcher = catcherOf(l);
      const early = q === 'miss' && l.caught !== null;
      const delta = applyPass(l.bowl, l.toss, q);
      view.land(team, q, delta, l.bowl.chips);
      const words = CATCH_WORDS[q];
      view.say(catcher, words.tv, words.color);
      const c = view.players[catcher]?.companion;
      c?.setBase('listening');
      meterTo(catcher, 0);
      if (q === 'miss') {
        sfx.bad();
        crunch(sfx, 0.45);
        c?.react('sad', 1.4);
        view.players[thrower]?.companion.react('sad', 1);
        const spilled = delta < 0 ? ` ${-delta} chips on the floor.` : '';
        tell(catcher, false, early ? `Too soon! Wait for it to land.${spilled}` : `Dropped it!${spilled}`);
        session.send(seatOf(catcher), { t: 'buzz', pattern: [90, 50, 90] });
      } else {
        crunch(sfx, 0.3);
        if (q === 'clean') sfx.coin(true);
        else sfx.tick();
        c?.react('happy', 1.1);
        tell(catcher, true, `${q === 'clean' ? 'Clean catch!' : 'Caught it!'} ${delta >= 0 ? '+' : '−'}${Math.abs(delta)} chips`);
      }
      // The catcher has the bowl now: their toss next.
      if (l.members.length > 1) l.thrower = 1 - l.thrower;
      l.phase = 'pause';
      l.phaseAt = t;
    };

    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'hold' || over || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      const team = p === undefined ? undefined : slotOf.get(p);
      const l = team === undefined ? undefined : lanes[team];
      if (p === undefined || team === undefined || !l) return;
      held[p] = msg.down;
      // When it happened on this frame's clock, and how long the phone's message took to get here.
      const raw = now + Math.max(0, (performance.now() - frameAt) / 1000) * clock.speed;
      const lag = Math.min(0.15, (session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed;
      if (msg.down) {
        // The meter starts when the press arrives, as that is when it starts moving on the screen.
        if (l.phase === 'aim' && throwerOf(l) === p && l.downAt === null) l.downAt = raw;
        else if (l.phase === 'flight' && catcherOf(l) === p) grab(l, raw - lag);
      } else if (l.phase === 'aim' && throwerOf(l) === p && l.downAt !== null) {
        // Let go on what the screen showed: the release took `lag` to arrive.
        release(l, team, meterAt(raw - lag - l.downAt, l.bowl.streak));
      }
    });

    ui.caption('Hold to wind up and let go in the gold. Press again as it lands!');
    let hudAt = -1;
    let meterSentAt = -1;
    await everyFrame(clock, (_, t) => {
      now = t;
      frameAt = performance.now();
      lanes.forEach((l, team) => {
        const thrower = throwerOf(l);
        const catcher = catcherOf(l);
        if (l.phase === 'pause') {
          if (t - l.phaseAt >= (l.bowl.passes + l.bowl.drops === 0 ? 0.3 : SNACK.pause)) startAim(l, team, t);
        } else if (l.phase === 'aim') {
          const streak = l.bowl.streak;
          if (cpu(thrower)) {
            if (l.cpuPressAt === null) {
              const s = skill[thrower] ?? 0.5;
              l.cpuPressAt = t + 0.25 + rng() * 0.35 + (1 - s) * 0.35;
              l.cpuHold = cpuTossValue(rng, s) / sweepSpeed(streak);
            }
            if (l.downAt === null && t >= l.cpuPressAt) l.downAt = l.cpuPressAt;
            if (l.downAt !== null && t >= l.downAt + l.cpuHold) {
              release(l, team, meterAt(l.cpuHold, streak));
              return;
            }
          }
          if (l.downAt === null && t - l.phaseAt >= SNACK.autoToss) release(l, team, SNACK.lob);
          else if (l.downAt !== null && t - l.downAt >= SNACK.maxHold) release(l, team, meterAt(SNACK.maxHold, streak));
          else view.meter(team, l.downAt === null ? 0 : meterAt(t - l.downAt, streak));
        } else {
          if (cpu(catcher) && !l.caught) {
            if (l.cpuCatchAt === null) l.cpuCatchAt = l.landAt + cpuCatchOffset(rng, skill[catcher] ?? 0.5, l.toss);
            if (t >= l.cpuCatchAt) grab(l, l.cpuCatchAt);
          }
          if (l.caught && t >= l.landAt) resolve(l, team, l.caught.q, t);
          else if (!l.caught && t >= l.landAt + catchWindow(l.toss)) resolve(l, team, 'miss', t);
        }
      });
      // The phones: the thrower's ring fills with the meter, the catcher's with the bowl's flight.
      if (t - meterSentAt >= 0.066) {
        meterSentAt = t;
        for (const l of lanes) {
          const thrower = throwerOf(l);
          const catcher = catcherOf(l);
          if (l.phase === 'aim' && !cpu(thrower)) {
            const v = l.downAt === null ? 0 : meterAt(t - l.downAt, l.bowl.streak);
            meterTo(thrower, v, v > SNACK.sweet + SNACK.good);
          } else if (l.phase === 'flight' && !cpu(catcher)) {
            meterTo(catcher, Math.min(1, (t - l.tossAt) / Math.max(0.1, l.landAt - l.tossAt)));
          }
        }
      }
      if (t - hudAt >= 0.1) {
        hudAt = t;
        ui.timer(SNACK.duration - t);
        ui.live(
          lanes.map((l) => {
            const lead = seats[l.members[0] ?? 0];
            return { name: teamName(l.members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${l.bowl.chips} chip${l.bowl.chips === 1 ? '' : 's'}` };
          }),
        );
      }
      return t >= SNACK.duration;
    });
    over = true;
    off();
    ui.timer(null);
    ui.caption(null);

    // Time! The fuller bowl cheers.
    const best = Math.max(...lanes.map((l) => bowlScore(l.bowl)));
    const tie = lanes.length > 1 && lanes.every((l) => bowlScore(l.bowl) === best);
    sfx.good();
    lanes.forEach((l, team) => {
      const won = bowlScore(l.bowl) === best;
      view.gaugeOff(team);
      for (const p of l.members) {
        meterTo(p, 0);
        view.players[p]?.companion.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) view.players[p]?.companion.react('happy', 3);
        tell(p, won, tie ? 'Time! Exactly as many chips each.' : won ? 'Time! Your bowl is the fullest!' : 'Time! Their bowl was fuller.');
      }
      if (won && !tie) view.cheer(team, 'Snack champs!');
    });
    await clock.wait(1.6);

    return {
      scores: snackScores(
        lanes.map((l) => l.bowl),
        teams,
        seats.length,
      ),
      details: seats.map((_, p) => {
        const team = slotOf.get(p);
        const b = team === undefined ? undefined : lanes[team]?.bowl;
        if (!b) return '';
        return `${b.chips} chip${b.chips === 1 ? '' : 's'} · ${b.passes} pass${b.passes === 1 ? '' : 'es'}${b.drops ? ` · ${b.drops} dropped` : ''}`;
      }),
    };
  },
};
