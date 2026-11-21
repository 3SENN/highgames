// Hammock Sway on the TV: a lazy sunset on the beach, one hammock each, strung between the palms. Seagull feathers
// drift down toward each hammock's swing point; tip your phone over to the other side as yours lands and the hammock
// swings that way. Mostly slow half-note sways, with a few quarter-note runs near the end.
import * as THREE from 'three';
import { HAMMOCK_GROOVE, HAMMOCK_SONG, type Side, swayDetail, swayTo, swingFor } from '../../../game/minigames/hammocksway';
import { type Chart, type Grade, type Note, type Track, makeChart } from '../../../game/minigames/rhythm';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, beach } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, cone, cyl, mix, part, rbox, seeded, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark, tone } from '../kit';
import { type Groove, NoteLane, PhraseCaption, RhythmRound } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const GROOVE: Groove = HAMMOCK_GROOVE;

const SPACING = 3.3; // palm to palm: one hammock's span
const ANCHOR_Y = 1.75; // where the ropes are tied round the trunks: the line the hammock swings about
const BAR_X = 1.0; // the spreader bars, either side of the middle
const BAR_DROP = 0.42; // how far under the ropes' knots the bars hang
const SAG = 0.36; // how much further the bed sags in the middle
const BED_W = 0.8;
const RING_Y = ANCHOR_Y + 0.42;
const RING_Z = 0.55;
const LANE = 2.2;
const SHORE_Z = -3.6;
const BARK = mix(P.wood, P.stone, 0.25);
const BARK_DARK = mix(P.woodDark, P.stone, 0.15);
const ROPE = P.linen;
const LEAF = P.moss;
const LEAF_DARK = P.pine;

/** How the bed hangs between the spreader bars (y under the ropes' knots, at x from the middle). */
const bedY = (x: number) => -BAR_DROP - SAG * (1 - (x / BAR_X) ** 4);

/** A thin rope from `a` to `b`. */
function rope(group: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r = 0.016): THREE.Mesh {
  const d = b.clone().sub(a);
  const m = part(group, cyl(r, r, d.length(), 6), ROPE, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, { outline: false, shadow: false });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/** A seagull feather, quill down: tinted in the seat's colour, bigger on the beat. The inner group flutters. */
function feather(note: Note | null, color: string): { obj: THREE.Group; inner: THREE.Group } {
  const obj = new THREE.Group();
  const inner = new THREE.Group();
  obj.add(inner);
  const s = note && !note.onBeat ? 0.8 : 1;
  part(inner, ball(0.15, 1), mix(color, P.cream, 0.5), 0, 0.06 * s, 0, { sx: 0.8 * s, sy: 2.0 * s, sz: 0.25, glow: 0.25, shadow: false });
  part(inner, ball(0.08, 1), P.slate, 0, 0.3 * s, 0, { sx: 0.9 * s, sy: 1.3 * s, sz: 0.3, shadow: false });
  part(inner, cyl(0.012, 0.018, 0.66 * s, 6), P.cream, 0, -0.02, 0.035, { outline: false, shadow: false });
  part(inner, ball(0.055, 1), color, 0, -0.33 * s, 0.02, { glow: 1.1, shadow: false });
  inner.rotation.z = 0.45;
  return { obj, inner };
}

function ringTarget(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, torus(0.27, 0.04), color, 0, 0, 0, { glow: 1.1, shadow: false });
  return g;
}

/** A beat with nothing to sway on: a soft dash. */
function restMark(): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(0.22, 0.05, 0.04, 0.02), P.cream, 0, 0, 0, { outline: false, shadow: false });
  return g;
}

/** A palm on y = 0: straight up past the hammock ropes, then curving over (`leanX` sideways, always a bit back). */
function palm(rand: () => number, leanX: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  const lean = new THREE.Vector3(leanX, 0, -0.75).normalize();
  const segs = 8;
  const len = height / segs;
  const p = new THREE.Vector3();
  for (let k = 0; k < segs; k++) {
    const bend = Math.max(0, (k - 3) / (segs - 3)) * 0.6;
    const dir = up.clone().multiplyScalar(Math.cos(bend)).addScaledVector(lean, Math.sin(bend)).normalize();
    const next = p.clone().addScaledVector(dir, len);
    const r = 0.2 - (k / segs) * 0.08;
    const m = part(g, cyl(r - 0.012, r, len * 1.08, 12), k % 2 ? BARK : BARK_DARK, (p.x + next.x) / 2, (p.y + next.y) / 2, (p.z + next.z) / 2, { tex: 'bark', outline: 0.02 });
    m.quaternion.setFromUnitVectors(up, dir);
    p.copy(next);
  }
  const crown = new THREE.Group();
  crown.position.copy(p);
  g.add(crown);
  part(crown, ball(0.17), LEAF_DARK, 0, 0.02, 0);
  const fronds = 8;
  for (let k = 0; k < fronds; k++) {
    const f = new THREE.Group();
    f.rotation.y = (k / fronds) * Math.PI * 2 + rand() * 0.4;
    crown.add(f);
    const d1 = 0.22 + rand() * 0.25;
    const d2 = d1 + 0.55;
    const c = k % 2 ? LEAF : LEAF_DARK;
    // Two leaves end to end: the inner one nearly flat, the outer one drooping.
    const h1 = 0.3 * 2.0;
    const h2 = 0.24 * 1.9;
    const tipX = 0.05 + 2 * h1 * Math.cos(d1);
    const tipY = 0.03 - 2 * h1 * Math.sin(d1);
    part(f, ball(0.3, 1), c, 0.05 + h1 * Math.cos(d1), 0.03 - h1 * Math.sin(d1), 0, { sx: 2.0, sy: 0.16, sz: 0.62, rz: -d1 });
    part(f, ball(0.24, 1), c, tipX + h2 * Math.cos(d2) - 0.04, tipY - h2 * Math.sin(d2), 0, { sx: 1.9, sy: 0.14, sz: 0.5, rz: -d2 });
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    part(crown, ball(0.11), P.walnut, Math.cos(a) * 0.17, -0.17, Math.sin(a) * 0.17);
  }
  return g;
}

/** A hammock hanging from its two knots (x = ±halfSpan at y = 0), striped in the seat's colour. */
function hammock(color: string, halfSpan: number): THREE.Group {
  const g = new THREE.Group();
  const slats = 12;
  for (let k = 0; k < slats; k++) {
    const x0 = -BAR_X + (2 * BAR_X * k) / slats;
    const x1 = x0 + (2 * BAR_X) / slats;
    const y0 = bedY(x0);
    const y1 = bedY(x1);
    part(g, rbox(Math.hypot(x1 - x0, y1 - y0) + 0.02, 0.045, BED_W, 0.018), k % 2 ? P.cream : mix(color, P.aubergine, 0.12), (x0 + x1) / 2, (y0 + y1) / 2, 0, {
      rz: Math.atan2(y1 - y0, x1 - x0),
      tex: 'fabric',
      texStrength: 0.6,
      outline: 0.015,
    });
  }
  // A pillow at the head end.
  part(g, rbox(0.34, 0.12, 0.5, 0.06), P.cream, -0.68, bedY(-0.68) + 0.07, 0, { rz: -0.12 });
  for (const s of [-1, 1]) {
    part(g, rbox(0.07, 0.07, BED_W + 0.18, 0.025), P.walnut, s * BAR_X, -BAR_DROP, 0, { tex: 'wood' });
    const knot = new THREE.Vector3(s * (halfSpan - 0.17), 0, 0);
    for (const dz of [-(BED_W / 2 + 0.05), 0, BED_W / 2 + 0.05]) rope(g, knot, new THREE.Vector3(s * BAR_X, -BAR_DROP, dz));
  }
  return g;
}

/** A seagull, beak along +x; its wings are the second and third children (pivots) for flapping. */
function gull(): { root: THREE.Group; wings: THREE.Group[] } {
  const root = new THREE.Group();
  part(root, ball(0.15, 1), P.cream, 0, 0, 0, { sx: 1.7, sy: 0.8, sz: 0.85 });
  part(root, ball(0.1, 1), P.cream, 0.25, 0.07, 0);
  part(root, cone(0.03, 0.12, 8), P.mustard, 0.37, 0.06, 0, { rz: -Math.PI / 2, outline: false });
  part(root, cone(0.08, 0.16, 4), P.linen, -0.3, 0.01, 0, { rz: Math.PI / 2, outline: false });
  const wings = [-1, 1].map((s) => {
    const w = new THREE.Group();
    w.position.set(0.02, 0.05, s * 0.08);
    part(w, rbox(0.2, 0.025, 0.55, 0.012), P.linen, 0, 0, s * 0.3, { outline: false });
    part(w, rbox(0.14, 0.026, 0.12, 0.012), P.slate, -0.02, 0, s * 0.53, { outline: false });
    root.add(w);
    return w;
  });
  return { root, wings };
}

interface Swing {
  group: THREE.Group;
  angle: number;
  vel: number;
  side: Side;
  amp: number;
}

interface Flutter {
  inner: THREE.Group;
  time: number;
  phase: number;
}

interface Drift {
  obj: THREE.Group;
  inner: THREE.Group;
  t: number;
  v: THREE.Vector3;
}

interface Gull {
  root: THREE.Group;
  wings: THREE.Group[];
  c: THREE.Vector3;
  r: [number, number];
  w: number;
  p: number;
}

class BeachView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 260);
  readonly lanes: NoteLane[] = [];
  private readonly swings: Swing[] = [];
  private readonly flutters: Flutter[] = [];
  private readonly drifts: Drift[][] = [];
  private readonly gulls: Gull[] = [];
  private readonly env: Env;
  private readonly crab = new THREE.Group();
  private readonly marks: Mark[] = [];
  private readonly fit: CameraFit;
  private readonly width: number;
  private songTime: () => number = () => -1;
  private tracks: readonly Track[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly companions: Companion[],
    private readonly chart: Chart,
  ) {
    const scene = this.scene;
    const rand = seeded(61);

    const n = seats.length;
    const xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    const W = n * SPACING;
    this.width = W;
    const ahead = chart.beat * 2.6;

    // The beach at golden hour: the sea and its foam behind, the low sun over the water, palms and rocks at the sides.
    this.env = beach(scene, { mood: 'golden', shore: -SHORE_Z, clear: { w: W + 2.4, d: 6 }, seed: 6 });
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, sc = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc);
      scene.add(o);
      return o;
    };

    withOutline(0.03, () => {
      // The palms (one more than there are hammocks), a rope wound round each where the hammocks are tied.
      for (let j = 0; j <= n; j++) {
        const px = -W / 2 + j * SPACING;
        const p = palm(rand, n === 0 ? 0 : ((j - n / 2) / Math.max(1, n / 2)) * 0.6, 3.9 + rand() * 0.45);
        p.position.set(px, 0, 0);
        scene.add(p);
        part(scene, torus(0.18, 0.035), ROPE, px, ANCHOR_Y, 0, { rx: Math.PI / 2, outline: false });
        part(scene, cyl(0.42, 0.55, 0.07, 18), mix(P.sand, P.walnut, 0.18), px, 0.02, 0, { tex: 'sand', outline: false, shadow: false });
        if (j % 2 === 0) put(props.tuft({ color: P.olive, seed: j + 3, s: 1.3 }), px + 0.35, 0, -0.25, j);
      }

      // On the right: a sandcastle with a flag, a cool box, and a lantern on a post as the light goes.
      const rx = W / 2 + 1.7;
      const sand = mix(P.sand, P.clay, 0.25);
      part(scene, rbox(1.0, 0.25, 0.8, 0.06), sand, rx, 0.12, 1.4, { tex: 'sand' });
      for (const [dx, h] of [
        [-0.35, 0.5],
        [0.35, 0.42],
        [0, 0.68],
      ] as const) {
        part(scene, cyl(0.16, 0.19, h, 12), sand, rx + dx, 0.25 + h / 2, 1.4, { tex: 'sand' });
        part(scene, cone(0.19, 0.22, 12), mix(sand, P.walnut, 0.15), rx + dx, 0.36 + h, 1.4, { tex: 'sand' });
      }
      part(scene, cyl(0.01, 0.01, 0.35, 4), P.cream, rx, 1.3, 1.4, { outline: false });
      part(scene, rbox(0.16, 0.1, 0.01, 0.005), P.terracotta, rx + 0.08, 1.42, 1.4, { outline: false });
      part(scene, rbox(0.75, 0.42, 0.48, 0.06), P.teal, rx - 0.2, 0.21, 2.4, { gloss: 0.3 });
      part(scene, rbox(0.8, 0.1, 0.52, 0.04), P.cream, rx - 0.2, 0.46, 2.4, { gloss: 0.3 });
      part(scene, cyl(0.05, 0.05, 2.3, 8), P.walnut, rx + 0.6, 1.15, -0.6, { tex: 'planks' });
      part(scene, rbox(0.3, 0.38, 0.3, 0.06), P.lamp, rx + 0.6, 2.45, -0.6, { glow: 2 });
      part(scene, cone(0.26, 0.18, 4), P.charcoal, rx + 0.6, 2.72, -0.6, { ry: Math.PI / 4 });
      // On the left, by the first palm: a surfboard stuck in the sand and a beach bag.
      const lx = -W / 2 - 1.1;
      part(scene, ball(0.3, 2), P.rose, lx, 1.0, -0.5, { sx: 0.95, sy: 3.4, sz: 0.16, rz: 0.12, gloss: 0.5 });
      part(scene, rbox(0.05, 1.9, 0.02, 0.008), P.cream, lx - 0.01, 1.02, -0.445, { rz: 0.12, outline: false });
      part(scene, rbox(0.5, 0.36, 0.26, 0.08), P.mustard, lx + 0.7, 0.18, 0.9, { tex: 'fabric', ry: 0.4 });
    });
    const lantern = new THREE.PointLight(P.lamp, 6, 9, 1.5);
    lantern.position.set(W / 2 + 2.3, 2.4, -0.2);
    scene.add(lantern);

    // A crab out for a slow walk along the front.
    withOutline(0.03, () => {
      part(this.crab, ball(0.14, 1), P.terracotta, 0, 0.09, 0, { sx: 1.4, sy: 0.6, gloss: 0.4 });
      for (const s of [-1, 1]) {
        part(this.crab, cyl(0.012, 0.012, 0.1, 4), P.terracotta, s * 0.06, 0.2, 0.06, { outline: false });
        part(this.crab, ball(0.03, 1), P.cream, s * 0.06, 0.26, 0.07);
        part(this.crab, ball(0.06, 1), P.terracotta, s * 0.24, 0.1, 0.1, { sx: 1.2 });
      }
    });
    scene.add(this.crab);

    for (let k = 0; k < 3; k++) {
      const g = gull();
      g.root.rotation.order = 'YXZ'; // heading first, then a gentle bank about the gull's own length
      g.root.scale.setScalar(0.9 + rand() * 0.3);
      scene.add(g.root);
      this.gulls.push({ ...g, c: new THREE.Vector3((k - 1) * (W / 2 + 2), 5.2 + k * 0.6, -4 - k * 2), r: [4 + rand() * 3, 1.5 + rand()], w: 0.16 + rand() * 0.08, p: rand() * 6 });
    }

    // Each player's hammock, a coconut to sip and flip-flops kicked off underneath.
    seats.forEach((s, i) => {
      const x = xs[i] as number;
      const group = new THREE.Group();
      group.position.set(x, ANCHOR_Y, 0);
      withOutline(0.035, () => group.add(hammock(s.color, SPACING / 2)));
      scene.add(group);
      this.swings.push({ group, angle: 0, vel: 0, side: i % 2 ? 1 : -1, amp: 0.12 });

      withOutline(0.035, () => {
        const dx = x + 0.95;
        part(scene, ball(0.2, 2), P.walnut, dx, 0.17, 1.15, { sy: 0.85, tex: 'bark', texStrength: 0.5 });
        part(scene, cyl(0.15, 0.15, 0.03, 16), P.cream, dx, 0.33, 1.15, { outline: false });
        part(scene, cyl(0.014, 0.014, 0.42, 6), s.color, dx + 0.06, 0.48, 1.15, { rz: -0.35, outline: false });
        part(scene, cyl(0.008, 0.008, 0.3, 4), P.cream, dx - 0.07, 0.47, 1.13, { rz: 0.25, outline: false });
        part(scene, cone(0.13, 0.07, 10), s.color, dx - 0.11, 0.63, 1.13, { rz: 0.25 });
        for (const k of [0, 1]) part(scene, rbox(0.12, 0.025, 0.3, 0.012), s.color, x - 0.5 + k * 0.2, 0.015, 0.95 + k * 0.08, { ry: 0.3 - k * 0.5 });
      });

      const c = companions[i];
      if (c) {
        // Lying back in the hammock, head on the pillow, face turned up toward us.
        const h = (c.kit.bounds.max[1] - c.kit.bounds.min[1]) * c.scale;
        // The side it lies on and (tipped back a little) its back: how far it sits up off the bed.
        const under = Math.max(0.15, Math.hypot(0.92 * -c.kit.bounds.min[0], 0.39 * -c.kit.bounds.min[2]) * c.scale);
        c.root.rotation.set(-0.4, 0, Math.PI / 2);
        c.root.position.set(h - 0.68, bedY(0) + 0.03 + under * 0.85, -0.02);
        c.setBase('listening');
        group.add(c.root);
      }

      const lane = new NoteLane(chart, {
        color: s.color,
        dir: new THREE.Vector3(0, 1, 0),
        length: LANE,
        ahead,
        marker: (note, k) => {
          const f = feather(note, s.color);
          this.flutters.push({ inner: f.inner, time: note.time, phase: k * 1.7 + i });
          return f.obj;
        },
        target: ringTarget(s.color),
        rest: restMark,
        flash: 0.32,
        ticks: 0.4,
        past: 0.35,
        labelAt: new THREE.Vector3(0.95, 0.05, 0.25),
        labelSize: 0.36,
      });
      lane.group.position.set(x, RING_Y, RING_Z);
      scene.add(lane.group);
      this.lanes.push(lane);

      const pool: Drift[] = [];
      for (let k = 0; k < 3; k++) {
        const f = feather(null, s.color);
        f.obj.visible = false;
        scene.add(f.obj);
        pool.push({ ...f, t: 1, v: new THREE.Vector3() });
      }
      this.drifts.push(pool);

      this.marks.push(
        { p: new THREE.Vector3(x - 0.4, RING_Y + LANE + 0.25, RING_Z) },
        { p: new THREE.Vector3(x + 0.4, RING_Y + LANE + 0.25, RING_Z) },
        { p: new THREE.Vector3(x - SPACING / 2, 0, 1.5) },
        { p: new THREE.Vector3(x + SPACING / 2, 0, 1.5) },
        { p: new THREE.Vector3(x, ANCHOR_Y - 1.0, 0.7) },
        { p: new THREE.Vector3(x + 1.3, RING_Y, RING_Z + 0.25), pad: 0.05 },
      );
    });
    this.marks.push({ p: new THREE.Vector3(-W / 2, 3.2, 0) }, { p: new THREE.Vector3(W / 2, 3.2, 0) });

    this.fit = new CameraFit(this.camera, 0.17);
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  /** A sway: the hammock swings over to the other side (a clean sway further), the feather tumbles off. */
  sway(seat: number, grade: Grade): void {
    const s = this.swings[seat];
    if (!s) return;
    s.side = swayTo(s.side);
    s.amp = swingFor(grade);
    if (grade === 'miss') return;
    const free = this.drifts[seat]?.find((d) => d.t >= 1);
    if (!free) return;
    free.t = 0;
    free.obj.visible = true;
    free.obj.scale.setScalar(0.9);
    free.obj.position.set(s.group.position.x, RING_Y, RING_Z);
    free.v.set(-s.side * (0.5 + Math.random() * 0.3), 0.5, 0.15);
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    const t = this.songTime();

    // The hammocks: each one a damped swing toward its side, stepped finely so a long frame stays smooth.
    let left = Math.min(dt, 0.5);
    while (left > 1e-6) {
      const h = Math.min(1 / 120, left);
      left -= h;
      this.swings.forEach((s, i) => {
        const target = s.side * s.amp + Math.sin(time * 0.9 + i * 1.3) * 0.03;
        s.vel += (18 * (target - s.angle) - 3.2 * s.vel) * h;
        s.angle += s.vel * h;
      });
    }
    for (const s of this.swings) s.group.rotation.x = s.angle;
    for (const c of this.companions) c.update(dt);

    this.lanes.forEach((lane, i) => lane.update(t, this.tracks[i]?.judged ?? [], dt));
    // Feathers flutter side to side on the way down and settle as they reach the ring.
    const ahead = this.chart.beat * 2.6;
    for (const f of this.flutters) {
      const k = Math.min(1, Math.max(0, (f.time - t) / ahead));
      f.inner.position.x = Math.sin(time * 2.3 + f.phase) * 0.24 * k;
      f.inner.rotation.z = 0.45 + Math.sin(time * 2.3 + f.phase + 1.1) * 0.4 * k;
    }
    for (const pool of this.drifts) {
      for (const d of pool) {
        if (d.t >= 1) continue;
        d.t = Math.min(1, d.t + dt / 1.6);
        d.v.y = Math.max(-0.45, d.v.y - dt * 1.4);
        d.v.x *= Math.exp(-dt * 1.2);
        d.obj.position.addScaledVector(d.v, dt);
        d.inner.rotation.z = 0.45 + Math.sin(d.t * 14) * 0.7;
        d.obj.scale.setScalar(0.9 * (1 - d.t * 0.6));
        if (d.t >= 1) d.obj.visible = false;
      }
    }

    // The beach: the sea rolling in and out, gulls drifting about, the crab on its walk.
    this.env.update(dt, time);
    for (const g of this.gulls) {
      const a = time * g.w + g.p;
      g.root.position.set(g.c.x + Math.cos(a) * g.r[0], g.c.y + Math.sin(a * 2) * 0.25, g.c.z + Math.sin(a) * g.r[1]);
      g.root.rotation.y = Math.atan2(-Math.cos(a) * g.r[1], -Math.sin(a) * g.r[0]);
      g.root.rotation.x = -0.15;
      const flap = Math.max(0, Math.sin(time * 0.6 + g.p * 3)) > 0.7 ? Math.sin(time * 9 + g.p) * 0.55 : 0.12;
      g.wings.forEach((w, k) => (w.rotation.x = (k === 0 ? -1 : 1) * flap));
    }
    const span = this.width / 2 + 1;
    this.crab.position.set(Math.sin(time * 0.11) * span, 0, 1.9);
    this.crab.rotation.z = Math.sin(time * 9) * 0.06;
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const l of this.lanes) l.dispose();
  }
}

/** The sea: soft swells of filtered noise, rolling in and out. Starts once the TV has sound. */
class Surf {
  private nodes: { src: AudioBufferSourceNode; lfo: OscillatorNode; level: GainNode } | null = null;
  private stopped = false;

  constructor(private readonly sfx: Sfx) {}

  pump(): void {
    if (this.nodes || this.stopped) return;
    const a = this.sfx.audio;
    if (!a) return;
    const ac = a.ctx;
    const buffer = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
    const data = buffer.getChannelData(0);
    let b = 0;
    for (let i = 0; i < data.length; i++) {
      b = b * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[i] = b * 7;
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    // Noise -> swell (rolling in and out) -> level (fades in and out) -> out.
    const swell = ac.createGain();
    swell.gain.value = 0.03;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.09;
    const depth = ac.createGain();
    depth.gain.value = 0.02;
    lfo.connect(depth).connect(swell.gain);
    const level = ac.createGain();
    const now = ac.currentTime;
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(1, now + 2);
    src.connect(filter).connect(swell).connect(level).connect(a.out);
    src.start(now, Math.random() * 3);
    lfo.start(now);
    this.nodes = { src, lfo, level };
  }

  stop(): void {
    this.stopped = true;
    const n = this.nodes;
    const ac = this.sfx.audio?.ctx;
    if (!n || !ac) return;
    const now = ac.currentTime;
    n.level.gain.cancelScheduledValues(now);
    n.level.gain.setValueAtTime(n.level.gain.value, now);
    n.level.gain.linearRampToValueAtTime(0, now + 1.8);
    n.src.stop(now + 2);
    n.lfo.stop(now + 2);
    this.nodes = null;
  }
}

/** A gull somewhere along the beach, far off and soft. */
function gullCry(sfx: Sfx, delay = 0): void {
  for (let k = 0; k < 3; k++) tone(sfx, { freq: 1500 - k * 60, to: 1050, dur: 0.2, type: 'triangle', gain: 0.011, delay: delay + k * 0.24 });
}

export const minigame: Minigame = {
  id: 'hammocksway',
  title: 'Hammock Sway',
  how: 'A lazy sunset, a hammock each. Tip your phone over to the other side just as a feather lands on your hammock, and it swings that way. No feather? Lie still.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui, sfx } = ctx;
    const chart = makeChart(HAMMOCK_SONG, ctx.rng);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.15, mood: 'listening' })));
    const view = new BeachView(seats, companions, chart);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const missRun = seats.map(() => 0);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'sway',
      groove: GROOVE,
      note: 'Tip to the other side as a feather lands',
      onJudge: (seat, j) => {
        view.lanes[seat]?.hit(j.grade);
        const c = view.companions[seat];
        // A sway (not a feather drifting past unplayed): the hammock goes over, cleanly or with a lurch.
        const moved = j.offset !== null || j.note === null;
        if (moved) view.sway(seat, j.grade);
        const human = !session.isCpu(seat);
        if (j.grade !== 'miss') {
          if ((missRun[seat] ?? 0) >= 3) c?.setBase('listening');
          missRun[seat] = 0;
          if (human) {
            round.music?.chime(j.combo % 2 ? 2 : 1, j.grade === 'perfect' ? 0.55 : 0.35);
            tone(sfx, { freq: 200, to: 150, dur: 0.4, type: 'triangle', gain: 0.022 });
          }
          if (j.combo > 0 && j.combo % 6 === 0) c?.react('happy', 1.4);
          return;
        }
        if (moved && human) tone(sfx, { freq: 170, to: 120, dur: 0.3, type: 'triangle', gain: 0.02 });
        missRun[seat] = (missRun[seat] ?? 0) + 1;
        // Three misses in a row and they doze off, until the next good sway.
        if (missRun[seat] === 3) c?.setBase('sleeping');
        else if (now - (lastSad[seat] ?? -9) > 1.5 && (missRun[seat] ?? 0) < 3) {
          lastSad[seat] = now;
          c?.react('sad', 0.9);
        }
      },
    });
    view.attach(round);

    const surf = new Surf(sfx);
    const caption = new PhraseCaption(ui, chart, HAMMOCK_SONG.phrase, 'Sway', 'Let it rock…');
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${round.tracks[i]?.score ?? 0} pts` })));
    ui.caption('Tip your phone to the other side as each feather lands');
    let liveAt = -1;
    let cries = 0;
    try {
      await round.play((_, t) => {
        now = t;
        surf.pump();
        if (cries === 0 && t > 0.4 && sfx.audio) {
          cries = 1;
          gullCry(sfx);
        } else if (cries === 1 && t > chart.end - 3) {
          cries = 2;
          gullCry(sfx, 0.3);
        }
        caption.update(t);
        if (t - liveAt > 0.2) {
          liveAt = t;
          live();
        }
      });
    } finally {
      surf.stop();
    }
    live();

    const scores = round.tracks.map((t) => t.score);
    const top = Math.max(...scores);
    view.companions.forEach((c, i) => c.setBase(scores[i] === top ? 'happy' : 'sleeping'));
    ui.caption(null);
    await ctx.clock.wait(1.2);
    return { scores, details: round.tracks.map((t) => swayDetail(t, chart)) };
  },
};
