// Kettle Choir on the TV: a midnight cuppa. A row of kettles sits on the stove, one per player, and each one sings
// its part of a sleepy tune. Long notes of steam slide down to each kettle: press when yours reaches the ring, hold
// while it whistles and let go as the note ends. A clean stop earns a little extra; letting go far too soon breaks it.
import * as THREE from 'three';
import { kettleDetail } from '../../../game/minigames/kettlechoir';
import { type Chart, type Track, SONGS, makeChart } from '../../../game/minigames/rhythm';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cyl, dome, mix, part, rbox, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark, noise } from '../kit';
import { GROOVES, NoteLane, PhraseCaption, RhythmRound, type Voice, beatPulse, laneTarget } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const SPACING = 2.7;
const TOP = 0.95; // the stovetop
const KETTLE_X = 0.35; // a kettle sits right of its slot's middle, its owner stands behind on the left
const OWNER_X = -0.72;
const OWNER_Y = 0.5; // the owners stand on a step behind the stove, so their faces show over it
const OWNER_Z = -1.2;
const RING_Y = 2.3;
const LANE = 2.3;
const BACK = -2.9; // the back wall
const ROOM_H = 8;
const WALL = mix(P.teal, P.slate, 0.55);
const CABINET = mix(P.forest, P.ink, 0.1);

function steamHead(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, ball(0.15), mix(color, '#ffffff', 0.2), 0, 0, 0, { glow: 0.4, shadow: false });
  part(g, ball(0.08), '#ffffff', 0.07, 0.06, 0.08, { glow: 0.6, shadow: false, outline: false });
  return g;
}

function steamTail(color: string): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.085, 0.085, 1, 14), mix(color, '#ffffff', 0.5), 0, 0.5, 0, { glow: 0.35, shadow: false });
  part(g, cyl(0.032, 0.032, 1.002, 8), '#ffffff', 0, 0.5, 0.07, { glow: 0.7, shadow: false, outline: false });
  return g;
}

interface Kettle {
  root: THREE.Group;
  lid: THREE.Group;
  flame: THREE.Group;
  /** Where the steam leaves the spout, in the scene. */
  tip: THREE.Vector3;
}

/** An enamel kettle in the seat's colour, standing on y = 0, the spout to the right. */
function buildKettle(color: string): Kettle {
  const root = new THREE.Group();
  const flat = { outline: false, shadow: false } as const;
  part(root, cyl(0.3, 0.32, 0.06, 24), P.charcoal, 0, 0.03, 0, { gloss: 0.4 });
  part(root, ball(0.4, 3), color, 0, 0.34, 0, { sy: 0.82, gloss: 0.55 });
  part(root, torus(0.37, 0.03), mix(color, '#ffffff', 0.45), 0, 0.2, 0, { rx: Math.PI / 2, outline: false, gloss: 0.5 });
  part(root, torus(0.2, 0.016), mix(color, P.ink, 0.3), 0, 0.6, 0, { rx: Math.PI / 2, ...flat });
  const lid = new THREE.Group();
  lid.position.set(0, 0.6, 0);
  part(lid, dome(0.19), mix(color, '#ffffff', 0.25), 0, 0, 0, { gloss: 0.55 });
  part(lid, ball(0.065), P.walnut, 0, 0.22, 0, { gloss: 0.3 });
  root.add(lid);
  // The handle: a steel hoop with a wooden grip.
  part(root, torus(0.27, 0.03, Math.PI), P.metal, 0, 0.6, 0, { gloss: 0.6 });
  part(root, cyl(0.045, 0.045, 0.24, 12), P.walnut, 0, 0.87, 0, { rz: Math.PI / 2, tex: 'wood', texScale: 0.4 });
  const spout = -0.9;
  part(root, cyl(0.055, 0.1, 0.44, 16), color, 0.43, 0.42, 0, { rz: spout, gloss: 0.55 });
  const tipX = 0.43 + Math.sin(-spout) * 0.25;
  const tipY = 0.42 + Math.cos(-spout) * 0.25;
  part(root, cyl(0.07, 0.07, 0.1, 14), P.brass, tipX, tipY, 0, { rz: spout, gloss: 0.7 });
  const flame = new THREE.Group();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    part(flame, ball(0.04, 1), '#8fb8ff', Math.cos(a) * 0.27, 0, Math.sin(a) * 0.27, { glow: 1.8, shadow: false, sy: 1.5 });
  }
  flame.position.y = -0.005;
  root.add(flame);
  return { root, lid, flame, tip: new THREE.Vector3(tipX + 0.05, tipY + 0.05, 0) };
}

function place<T extends THREE.Object3D>(root: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  root.add(obj);
  return obj;
}

interface Puff {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  v: THREE.Vector3;
}

class StoveView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: NoteLane[] = [];
  private readonly kettles: Kettle[] = [];
  private readonly puffs: Puff[][] = [];
  private readonly puffIn: number[];
  private readonly singing: boolean[];
  /** Per kettle: a little hop when its note ends cleanly. */
  private readonly hops: number[];
  private readonly marks: Mark[] = [];
  private readonly fit: CameraFit;
  private readonly tick: (dt: number, time: number) => void;
  private songTime: () => number = () => -1;
  private tracks: readonly Track[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly companions: Companion[],
    private readonly chart: Chart,
  ) {
    const scene = this.scene;
    lightRig(scene, 'lampInterior', { shadowSize: 10 });
    const set = new THREE.Group();
    scene.add(set);
    const flat = { outline: false, shadow: false } as const;
    const plaster = { outline: false, tex: 'plaster', texStrength: 0.9 } as const;

    const n = seats.length;
    const xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    this.puffIn = seats.map(() => 0);
    this.singing = seats.map(() => false);
    this.hops = seats.map(() => 0);
    const W = n * SPACING + 1.2;
    const FW = Math.max(26, W + 14);
    const wall = BACK + 0.02;

    // The kitchen: a terrazzo floor, a sage wall and a band of tiles behind the stove.
    part(set, box(FW + 0.4, 0.2, 24), mix(P.clay, P.cream, 0.35), 0, -0.1, BACK + 12, { ...flat, tex: 'terrazzo', texScale: 2.4 });
    part(set, box(FW + 0.4, ROOM_H, 0.2), WALL, 0, ROOM_H / 2, BACK - 0.1, plaster);
    for (const s of [-1, 1]) part(set, box(0.2, ROOM_H, 24), mix(WALL, P.ink, 0.1), s * (FW / 2 + 0.1), ROOM_H / 2, BACK + 12, plaster);
    part(set, box(FW, 0.2, 0.06), mix(P.cream, WALL, 0.3), 0, 0.1, BACK + 0.04, { outline: false });
    part(set, box(W + 2.6, 2.0, 0.05), P.ceramic, 0, 1.75, wall, { outline: false, tex: 'kitchenTile', texScale: 1.7, gloss: 0.25 });
    part(set, box(W + 2.7, 0.07, 0.09), P.oak, 0, 2.78, BACK + 0.05, { outline: false, tex: 'wood' });

    // Over the tiles: shelves of crockery between the kettles' lanes, and little lights along the top.
    for (let i = 0; i < n - 1; i++) place(set, props.wallShelf({ w: 1.2, items: 'kitchen', seed: 3 + i * 4 }), (xs[i] as number) + KETTLE_X + SPACING / 2, 3.55, wall, 0, 1.3);
    for (let k = 0; k < 3; k++) {
      const x0 = -W / 2 - 1 + (k * (W + 2)) / 3;
      set.add(props.stringLights(new THREE.Vector3(x0, 5.3, wall + 0.08), new THREE.Vector3(x0 + (W + 2) / 3, 5.3, wall + 0.08), { sag: 0.2, count: 8, bulb: 0.055 }));
    }

    // Right of the stove: a window onto the night, a counter with the washing-up, a pendant lamp.
    const rx = W / 2 + 3.4;
    place(set, props.windowFrame({ w: 1.5, h: 1.3, time: 'night', seed: 8 }), rx, 3.75, wall, 0, 1.6);
    place(set, props.kitchenCounter({ w: 2.6, color: CABINET, sink: 0.3 }), rx, 0, BACK, 0, 1.5);
    place(set, props.plates({ n: 5 }), rx - 1.2, 1.4, BACK + 0.5, 0, 1.6);
    place(set, props.plant({ kind: 'trailing', h: 0.32, pot: P.terracotta }), rx + 1.4, 1.4, BACK + 0.4, 0, 1.6);
    place(set, props.jar({ color: P.mustard }), rx - 0.65, 1.4, BACK + 0.32, 0, 1.6);
    place(set, props.pendantLamp({ drop: 2.2, light: 14, shade: P.brass }), W / 2 + 1.25, 7.4, -0.3, 0, 1.6);

    // Left: a fridge, shelves of crockery, a wall clock that says it is very late, another pendant.
    const lx = -W / 2 - 3.3;
    place(set, props.fridge({ color: P.sage }), lx - 1.0, 0, BACK, 0, 1.6);
    place(set, props.wallShelf({ w: 1.4, items: 'kitchen', seed: 2 }), lx + 1.1, 3.3, wall, 0, 1.6);
    place(set, props.wallShelf({ w: 1.4, items: 'kitchen', seed: 6 }), lx + 1.1, 4.2, wall, 0, 1.6);
    place(set, props.wallClock({ r: 0.2, color: P.brass }), lx + 1.1, 5.3, wall, 0, 2.2);
    place(set, props.pendantLamp({ drop: 2.2, shade: P.brass }), -W / 2 - 1.25, 7.4, -0.3, 0, 1.6);
    place(set, props.crate({ s: 0.5 }), lx + 1.0, 0, BACK + 0.5, 0.2, 1.5);
    place(set, props.plant({ kind: 'fern', h: 0.7 }), lx + 1.0, 0.75, BACK + 0.5, 0, 1.5);

    // In front: a runner on the floor, a stool and a plant at the corners.
    place(set, props.rug({ w: W + 0.6, d: 1.7, color: P.terracotta, border: P.sand }), 0, 0, 2.2);
    place(set, props.stool({ h: 0.55, seat: P.mustard }), -W / 2 - 0.9, 0, 2.3, 0, 1.5);
    place(set, props.plant({ kind: 'ficus', h: 1.6, pot: P.ceramic, seed: 3 }), W / 2 + 1.6, 0, 1.9, 0, 1.4);

    // The range: deep green cabinets, an oven per kettle with a knob in its player's colour, a dark hob.
    part(set, rbox(W + 1.6, TOP - 0.03, 1.5, 0.05), CABINET, 0, (TOP - 0.03) / 2, 0);
    part(set, box(W + 1.5, 0.12, 1.4), P.charcoal, 0, 0.06, 0, flat);
    part(set, rbox(W + 1.7, 0.06, 1.6, 0.025), P.cream, 0, TOP - 0.03, 0, { tex: 'terrazzo', gloss: 0.3 });
    part(set, rbox(W + 0.6, 0.05, 1.3, 0.02), P.charcoal, 0, TOP - 0.005, 0, { gloss: 0.5, outline: false });
    part(set, rbox(W + 0.6, 0.1, 0.05, 0.02), mix(CABINET, P.ink, 0.2), 0, 0.82, 0.76, { outline: false });
    seats.forEach((s, i) => {
      const x = xs[i] as number;
      part(set, rbox(SPACING - 0.4, 0.5, 0.05, 0.025), mix(CABINET, '#ffffff', 0.07), x, 0.38, 0.76, { outline: 0.015 });
      part(set, rbox(SPACING - 1.0, 0.24, 0.06, 0.03), '#17131c', x, 0.42, 0.78, { outline: false, gloss: 0.6 });
      part(set, cyl(0.022, 0.022, SPACING - 0.9, 8), P.brass, x, 0.7, 0.84, { rz: Math.PI / 2, outline: false, gloss: 0.7 });
      part(set, cyl(0.07, 0.07, 0.06, 16), P.brass, x + KETTLE_X, 0.84, 0.79, { rx: Math.PI / 2, outline: false, gloss: 0.6 });
      part(set, cyl(0.045, 0.045, 0.08, 14), s.color, x + KETTLE_X, 0.84, 0.8, { rx: Math.PI / 2, outline: false, glow: 0.6 });
      for (const r of [0.33, 0.2]) part(set, torus(r, 0.03), '#17131c', x + KETTLE_X, TOP + 0.025, 0, { rx: Math.PI / 2, ...flat });
    });

    // At the ends of the worktop: a teapot and a tea tin, a plate of biscuits and two mugs.
    const tx = -W / 2 - 0.45;
    part(set, ball(0.28, 3), P.teal, tx, TOP + 0.24, -0.2, { sy: 0.8, gloss: 0.55 });
    part(set, ball(0.07), P.walnut, tx, TOP + 0.49, -0.2);
    part(set, cyl(0.04, 0.06, 0.25, 10), P.teal, tx + 0.3, TOP + 0.3, -0.2, { rz: -0.8, gloss: 0.55 });
    part(set, cyl(0.16, 0.16, 0.36, 18), P.brick, tx + 0.1, TOP + 0.18, 0.4, { gloss: 0.4 });
    part(set, cyl(0.165, 0.165, 0.05, 18), P.brass, tx + 0.1, TOP + 0.38, 0.4, { outline: false, gloss: 0.6 });
    const bx = W / 2 + 0.4;
    place(set, props.plates({ n: 1, r: 0.2 }), bx, TOP, 0.1, 0, 1.6);
    for (let k = 0; k < 5; k++) part(set, cyl(0.09, 0.09, 0.03, 14), P.sand, bx + Math.cos(k * 2.4) * 0.12, TOP + 0.06 + k * 0.03, 0.1 + Math.sin(k * 2.4) * 0.1, { outline: false });
    place(set, props.mug({ color: P.rose }), bx - 0.1, TOP, -0.4, 0.6, 2);
    place(set, props.mug({ color: P.mustard }), bx + 0.3, TOP, -0.25, 2.4, 2);

    seats.forEach((s) => {
      const k = buildKettle(s.color);
      set.add(k.root);
      this.kettles.push(k);
    });
    this.tick = props.tickProps(set);

    seats.forEach((s, i) => {
      const x = xs[i] as number;
      const kx = x + KETTLE_X;
      const kettle = this.kettles[i] as Kettle;
      kettle.root.position.set(kx, TOP, 0);
      kettle.tip.add(kettle.root.position);
      const c = companions[i];
      if (c) {
        c.root.position.set(x + OWNER_X, OWNER_Y, OWNER_Z);
        c.setBase('listening');
        scene.add(c.root);
      }
      const lane = new NoteLane(chart, {
        color: s.color,
        dir: new THREE.Vector3(0, 1, 0),
        length: LANE,
        ahead: chart.beat * 3.5,
        marker: () => steamHead(s.color),
        tail: () => steamTail(s.color),
        target: laneTarget(s.color, 0.24),
        flash: 0.3,
        ticks: 0.42,
        past: 0.3,
        labelAt: new THREE.Vector3(0.95, 0, 0.3),
        labelSize: 0.34,
      });
      lane.group.position.set(kx, RING_Y, 0);
      scene.add(lane.group);
      this.lanes.push(lane);

      const pool: Puff[] = [];
      for (let k = 0; k < 14; k++) {
        const mat = new THREE.MeshBasicMaterial({ color: mix(s.color, '#ffffff', 0.8), transparent: true, opacity: 0, depthWrite: false });
        const mesh = new THREE.Mesh(ball(0.1, 1), mat);
        mesh.visible = false;
        scene.add(mesh);
        pool.push({ mesh, t: 1, life: 1, v: new THREE.Vector3() });
      }
      this.puffs.push(pool);

      this.marks.push(
        { p: new THREE.Vector3(kx - 0.35, RING_Y + LANE + 0.2, 0) },
        { p: new THREE.Vector3(kx + 0.35, RING_Y + LANE + 0.2, 0) },
        { p: new THREE.Vector3(x - SPACING / 2 + 0.2, 0, 0.8) },
        { p: new THREE.Vector3(x + SPACING / 2 - 0.2, 0, 0.8) },
        { p: new THREE.Vector3(kx + 0.95, RING_Y, 0.3), pad: 0.05 },
        { p: new THREE.Vector3(x + OWNER_X, OWNER_Y + 1.75, OWNER_Z) },
      );
    });

    this.fit = new CameraFit(this.camera, 0.2);
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  /** A puff of steam from a kettle's spout (a bigger one for a clean stop, and the kettle hops). */
  puff(seat: number, size = 1): void {
    const pool = this.puffs[seat];
    const kettle = this.kettles[seat];
    if (size > 1) this.hops[seat] = 1;
    const p = pool?.find((q) => q.t >= q.life);
    if (!p || !kettle) return;
    p.t = 0;
    p.life = 0.8 + Math.random() * 0.4;
    p.mesh.position.copy(kettle.tip);
    p.mesh.scale.setScalar(0.6 * size);
    p.v.set(0.35 + Math.random() * 0.25, 0.75 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2);
    p.mesh.visible = true;
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    const t = this.songTime();
    const playing = t >= 0 && t < this.chart.end;
    const bob = playing ? beatPulse(t, this.chart.beat) : 0;
    this.companions.forEach((c, i) => {
      c.update(dt);
      c.root.position.y = OWNER_Y - bob * 0.03;
      const singing = (this.tracks[i]?.holding ?? -1) >= 0;
      if (singing !== this.singing[i]) {
        this.singing[i] = singing;
        c.setBase(singing ? 'talking' : 'listening');
      }
    });
    this.lanes.forEach((lane, i) => {
      const track = this.tracks[i];
      lane.update(t, track?.judged ?? [], dt, track);
    });
    this.kettles.forEach((k, i) => {
      const singing = this.singing[i] ?? false;
      k.root.rotation.z = singing ? Math.sin(time * 38 + i) * 0.018 : 0;
      k.lid.position.y = 0.6 + (singing ? Math.max(0, Math.sin(time * 31 + i * 2)) * 0.035 : 0);
      // A clean stop: the kettle squashes, hops and settles.
      const h = Math.max(0, (this.hops[i] ?? 0) - dt * 3.5);
      this.hops[i] = h;
      const q = h > 0 ? Math.sin((1 - h) * Math.PI * 2) * h : 0;
      k.root.scale.set(1 - q * 0.08, 1 + q * 0.12, 1 - q * 0.08);
      k.root.position.y = TOP + (h > 0 ? Math.sin((1 - h) * Math.PI) * 0.1 * h : 0);
      const want = singing ? 1.25 : 0.8 + bob * 0.1;
      const s = k.flame.scale.x + (want - k.flame.scale.x) * Math.min(1, dt * 10);
      k.flame.scale.set(s, s, s);
      if (singing) {
        this.puffIn[i] = (this.puffIn[i] ?? 0) - dt;
        if ((this.puffIn[i] ?? 0) <= 0) {
          this.puffIn[i] = 0.07;
          this.puff(i);
        }
      }
    });
    for (const pool of this.puffs) {
      for (const p of pool) {
        if (p.t >= p.life) continue;
        p.t += dt;
        const k = Math.min(1, p.t / p.life);
        p.mesh.position.addScaledVector(p.v, dt);
        p.v.y *= Math.exp(-dt * 0.8);
        p.mesh.scale.setScalar(p.mesh.scale.x + dt * 0.9);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
        if (k >= 1) p.mesh.visible = false;
      }
    }
    this.tick(dt, time);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const l of this.lanes) l.dispose();
    for (const pool of this.puffs) for (const p of pool) (p.mesh.material as THREE.Material).dispose();
  }
}

export const minigame: Minigame = {
  id: 'kettlechoir',
  title: 'Kettle Choir',
  how: 'A midnight cuppa, and every kettle sings. Press and hold your phone as your steam reaches its ring, then let go just as the note ends. A clean stop earns a bit extra; letting go far too soon breaks the note.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui, sfx } = ctx;
    const chart = makeChart(SONGS.kettlechoir, ctx.rng);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.6, mood: 'listening' })));
    const view = new StoveView(seats, companions, chart);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const voices: (Voice | null)[] = seats.map(() => null);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'hold',
      groove: GROOVES.kettle,
      note: 'Hold as the steam reaches your ring, let go as it ends',
      onJudge: (seat, j) => {
        view.lanes[seat]?.hit(j.grade, round.tracks[seat]?.combo);
        const c = view.companions[seat];
        if (j.release) {
          if (j.grade !== 'miss') {
            view.puff(seat, 1.8);
            round.music?.chime(seat + 1, session.isCpu(seat) ? 0.35 : 0.8);
          } else if (j.broken) {
            noise(sfx, { dur: 0.25, filter: 'highpass', freq: 2500, to: 900, gain: 0.05 });
            c?.react('sad', 0.9);
          }
          return;
        }
        if (j.grade === 'miss' && now - (lastSad[seat] ?? -9) > 1.5) {
          lastSad[seat] = now;
          c?.react('sad', 0.9);
        }
        if (j.combo > 0 && j.combo % 6 === 0) c?.react('happy', 1.2);
      },
    });
    view.attach(round);

    const caption = new PhraseCaption(ui, chart, SONGS.kettlechoir.phrase, 'Whistle', 'Let it simmer…');
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${round.tracks[i]?.score ?? 0} pts` })));
    ui.caption('Hold as the steam reaches your kettle, let go as it ends');
    let liveAt = -1;
    await round.play((_, t) => {
      now = t;
      caption.update(t);
      // Each kettle whistles while its note is held: its own tone of the chord, the computer ones softer.
      round.tracks.forEach((track, i) => {
        const v = voices[i] ?? null;
        if (track.holding >= 0 && !v && round.music) voices[i] = round.music.whistle(i, session.isCpu(i) ? 0.45 : 1);
        else if (track.holding < 0 && v) {
          v.stop();
          voices[i] = null;
        }
      });
      if (t - liveAt > 0.2) {
        liveAt = t;
        live();
      }
    });
    for (const v of voices) v?.stop();
    live();

    const scores = round.tracks.map((t) => t.score);
    const top = Math.max(...scores);
    view.companions.forEach((c, i) => c.setBase(scores[i] === top ? 'happy' : 'idle'));
    ui.caption(null);
    await ctx.clock.wait(1.2);
    return { scores, details: round.tracks.map((t) => kettleDetail(t, chart)) };
  },
};
