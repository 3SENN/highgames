// Couch Bongos on the TV: a late-night jam in the living room. Everyone sinks into an armchair with a bongo on each
// armrest; beats drop down two lanes onto the drums. Tap the Left or Right pad on your phone as a beat lands on that
// drum. The wrong drum is a miss for that beat, so watch your lanes.
import * as THREE from 'three';
import { type Chart, type Note, type Track, SONGS, makeChart, summary } from '../../../game/minigames/rhythm';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cone, cyl, mix, part, rbox, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark } from '../kit';
import { GROOVES, NoteLane, PhraseCaption, RhythmRound, beatPulse, laneTarget } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const SPACING = 2.9;
const ARM_X = 0.84; // from a chair's middle to each armrest (and its bongo)
const ARM_TOP = 0.92;
const SKIN_Y = ARM_TOP + 0.36;
const RING_Y = SKIN_Y + 0.34;
const LANE = 2.3;
const SEAT_Y = 0.62; // a companion's feet, sunk into the cushion
const LABEL_Y = 0.98;
const INK = '#2a2140';
const BACK = -2.9; // the back wall
const ROOM_H = 8;
const WALL = mix(P.plum, P.midnight, 0.4);
const PADS = ['Left', 'Right'];

/** The two drums' colours for a seat: the left in the seat's colour, the right a deeper shade of it. */
function drumColors(color: string): [string, string] {
  return [color, mix(color, INK, 0.32)];
}

/** A beat dropping onto a drum: a round tap mark, bigger on the beat than on the "and". */
function beatMark(note: Note, color: string): THREE.Group {
  const g = new THREE.Group();
  const r = note.onBeat ? 0.17 : 0.13;
  const flat = { rx: Math.PI / 2, shadow: false, outline: false } as const;
  part(g, cyl(r, r, 0.06, 22), mix(color, P.ink, 0.5), 0, 0, 0, { rx: Math.PI / 2, shadow: false });
  part(g, cyl(r * 0.82, r * 0.82, 0.07, 22), color, 0, 0, 0, { ...flat, glow: 0.45 });
  part(g, cyl(r * 0.36, r * 0.36, 0.08, 14), mix(color, '#ffffff', 0.65), 0, 0, 0, { ...flat, glow: 0.6 });
  return g;
}

interface Drum {
  root: THREE.Group;
  /** A ring that runs out across the skin when the drum is struck. */
  ripple: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

/** A bongo drum standing on y = 0: a polished wooden shell, a band in the seat's colour, brass lugs, a pale skin. */
function bongo(color: string, size: number): Drum {
  const g = new THREE.Group();
  const flat = { outline: false, shadow: false } as const;
  part(g, cyl(0.25, 0.2, 0.33, 24), P.oak, 0, 0.165, 0, { tex: 'wood', texScale: 0.6, gloss: 0.3 });
  part(g, torus(0.205, 0.016), P.walnut, 0, 0.02, 0, { rx: Math.PI / 2, ...flat });
  part(g, torus(0.243, 0.028), color, 0, 0.22, 0, { rx: Math.PI / 2, outline: false, gloss: 0.3 });
  part(g, cyl(0.235, 0.235, 0.03, 26), P.cream, 0, 0.345, 0, { tex: 'leather', texStrength: 0.25 });
  part(g, cyl(0.1, 0.1, 0.031, 20), mix(P.cream, P.sand, 0.5), 0, 0.346, 0, flat);
  part(g, torus(0.24, 0.022), P.brass, 0, 0.35, 0, { rx: Math.PI / 2, outline: false, gloss: 0.6 });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 5;
    part(g, rbox(0.035, 0.13, 0.035, 0.012), P.brass, Math.cos(a) * 0.238, 0.27, Math.sin(a) * 0.238, { outline: false, gloss: 0.6 });
  }
  const mat = new THREE.MeshBasicMaterial({ color: mix(color, '#ffffff', 0.6), transparent: true, opacity: 0, depthWrite: false });
  const ripple = new THREE.Mesh(torus(0.1, 0.012), mat);
  ripple.rotation.x = Math.PI / 2;
  ripple.position.y = 0.366;
  ripple.visible = false;
  g.add(ripple);
  g.scale.setScalar(size);
  return { root: g, ripple, mat };
}

function place<T extends THREE.Object3D>(root: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  root.add(obj);
  return obj;
}

class JamView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  /** Per seat, a lane per drum: [left, right]. */
  readonly lanes: NoteLane[][] = [];
  private readonly drums: Drum[][] = [];
  private readonly hits: number[][] = [];
  private readonly leans: number[];
  private readonly xs: number[];
  private readonly blobs: THREE.Mesh[] = [];
  private readonly strips: THREE.Mesh[] = [];
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
    this.xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    this.leans = seats.map(() => 0);
    const W = n * SPACING;
    const FW = Math.max(24, W + 13);
    const right = W / 2 + 1.9;
    const left = -W / 2 - 1.7;
    const wall = BACK + 0.02;

    // The room: dark boards, a deep plum wall with a darker dado.
    part(set, box(FW + 0.4, 0.2, 24), P.wood, 0, -0.1, BACK + 12, { ...flat, tex: 'woodFloor', texScale: 3 });
    part(set, box(FW + 0.4, ROOM_H, 0.2), WALL, 0, ROOM_H / 2, BACK - 0.1, plaster);
    for (const s of [-1, 1]) part(set, box(0.2, ROOM_H, 24), mix(WALL, P.ink, 0.12), s * (FW / 2 + 0.1), ROOM_H / 2, BACK + 12, plaster);
    part(set, box(FW, 1.2, 0.04), mix(WALL, P.ink, 0.3), 0, 0.6, wall, plaster);
    part(set, box(FW, 0.06, 0.08), mix(WALL, P.cream, 0.3), 0, 1.23, BACK + 0.05, { outline: false });
    part(set, box(FW, 0.18, 0.06), mix(WALL, P.cream, 0.3), 0, 0.09, BACK + 0.04, { outline: false });

    // A neon sign over the jam, with its light on the wall.
    place(set, props.neonSign('late jam', { color: P.neonPink, h: 1.0 }), 0, 5.15, wall + 0.02);
    const neon = new THREE.PointLight(P.neonPink, 5, 9, 1.6);
    neon.position.set(0, 5.0, BACK + 1.0);
    scene.add(neon);

    // Right: a window onto the sleeping city, a floor lamp, a shelf of records and books.
    const wx = right + 2.5;
    place(set, props.windowFrame({ w: 1.7, h: 1.5, time: 'night', seed: 11 }), wx, 3.4, wall, 0, 1.6);
    place(set, props.curtains({ w: 1.7, h: 1.5, color: mix(P.teal, P.ink, 0.15), open: 0.85 }), wx, 3.4, wall, 0, 1.6);
    place(set, props.floorLamp({ h: 1.8, shade: P.clay }), right + 0.6, 0, -1.3, 0, 1.5);
    // Two brass pendants either side of the sign light the chairs.
    for (const side of [-1, 1]) place(set, props.pendantLamp({ drop: 1.45, light: 13, shade: P.brass }), side * Math.min(4.7, W / 2 - 1), 7.6, -1.5, 0, 1.6);
    place(set, props.pictureFrame({ w: 0.8, h: 0.6, art: 'hills', frame: P.walnut, seed: 5 }), right - 0.6, 4.4, wall, 0, 1.5);
    place(set, props.bookshelf({ w: 1.3, h: 1.2, shelves: 2, seed: 3, color: P.walnut }), wx + 0.2, 0, BACK + 0.3, 0, 1.5);
    place(set, props.plant({ kind: 'snake', h: 0.9, pot: P.charcoal }), right + 4.6, 0, -1.7, 0, 1.5);

    // Left: a lava lamp glowing on a side table, a big plant in the corner, a speaker.
    place(set, props.sideTable({ h: 0.5, r: 0.34, color: P.walnut }), left, 0, -0.8, 0, 1.4);
    const ly = 0.7;
    part(set, cone(0.22, 0.25, 18), P.brass, left, ly + 0.16, -0.8, { gloss: 0.6 });
    part(set, cyl(0.12, 0.2, 0.75, 20), P.neonPink, left, ly + 0.65, -0.8, { opacity: 0.5, shadow: false, glow: 0.35 });
    part(set, cone(0.13, 0.16, 18), P.brass, left, ly + 1.1, -0.8, { gloss: 0.6 });
    for (let k = 0; k < 3; k++) this.blobs.push(part(set, ball(0.075 - k * 0.012), P.lamp, left, ly + 0.5, -0.8, { glow: 1.6, shadow: false }));
    const lava = new THREE.PointLight(P.neonPink, 3.5, 6, 1.6);
    lava.position.set(left, 1.5, -0.3);
    scene.add(lava);
    place(set, props.plant({ kind: 'ficus', h: 2.1, pot: P.terracotta, seed: 8 }), left - 1.7, 0, -1.9, 0, 1.4);
    place(set, props.speaker({ h: 1.0 }), left - 3.2, 0, BACK + 0.55, 0.3, 1.5);
    place(set, props.pictureFrame({ w: 0.9, h: 0.7, art: 'moon', frame: P.charcoal, seed: 6 }), left - 1.2, 4.3, wall, 0, 1.5);
    place(set, props.pictureFrame({ w: 0.5, h: 0.6, art: 'shapes', frame: P.brass, seed: 2 }), left - 2.8, 4.0, wall, 0, 1.5);

    // A rug and a low table with an open pizza box, mugs and a candle.
    place(set, props.rug({ w: Math.max(8, W - 1.5), d: 3.4, color: mix(P.denim, P.aubergine, 0.3), border: P.mustard }), 0.2, 0, 2.45);
    const ty = 0.42 * 1.3;
    place(set, props.coffeeTable({ w: 2.6, d: 0.85, color: P.walnut }), 0.3, 0, 2.7, 0, 1.3);
    place(set, props.pizzaBox({ open: true, slices: 5 }), -0.35, ty, 2.7, 0.15, 1.9);
    place(set, props.mug({ color: P.rose }), 0.95, ty, 2.6, 0.8, 1.9);
    place(set, props.mug({ color: P.teal }), 1.35, ty, 2.85, 2.2, 1.9);
    place(set, props.drink({ kind: 'bottle', color: P.forest }), 1.7, ty, 2.5, 0, 1.7);
    place(set, props.candle({ h: 0.1 }), -1.25, ty, 2.5, 0, 1.9);

    // The foreground corners.
    place(set, props.pouf({ color: P.terracotta, r: 0.4 }), left - 1.5, 0, 3.0, 0, 1.6);
    place(set, props.beanbag({ color: P.mustard }), right + 2.2, 0, 2.6, -0.5, 1.5);
    place(set, props.motes({ n: 20, area: [FW * 0.7, 3.4, 5], size: 0.05 }), 0, 0.8, 0.5);

    // The armchairs: velvet in a deep shade of each player's colour, a bongo on each armrest and a strip of light
    // under the seat.
    seats.forEach((s, i) => {
      const x = this.xs[i] as number;
      const [lc, rc] = drumColors(s.color);
      const chair = mix(s.color, P.aubergine, 0.62);
      const vel = { tex: 'velvet', texStrength: 0.85 } as const;
      part(set, rbox(2.05, 0.42, 1.35, 0.14), mix(chair, P.ink, 0.2), x, 0.3, 0, vel);
      for (const dx of [-0.85, 0.85]) for (const dz of [-0.5, 0.5]) part(set, cyl(0.06, 0.045, 0.12, 10), P.walnut, x + dx, 0.05, dz, { outline: false });
      part(set, rbox(1.32, 0.22, 1.15, 0.1), mix(chair, s.color, 0.22), x, 0.6, 0.06, vel);
      part(set, rbox(2.05, 1.2, 0.38, 0.16), chair, x, 1.0, -0.56, vel);
      part(set, rbox(1.3, 0.72, 0.2, 0.1), mix(chair, s.color, 0.22), x, 1.08, -0.34, vel);
      this.strips.push(part(set, rbox(1.5, 0.035, 0.035, 0.012), s.color, x, 0.12, 0.69, { glow: 1.3, ...flat }));
      const pair: Drum[] = [];
      for (const side of [-1, 1]) {
        part(set, rbox(0.38, 0.52, 1.35, 0.14), chair, x + side * ARM_X, 0.66, 0, vel);
        const drum = bongo(side < 0 ? lc : rc, side < 0 ? 1.06 : 0.95);
        drum.root.position.set(x + side * ARM_X, ARM_TOP, 0.05);
        set.add(drum.root);
        pair.push(drum);
      }
      this.drums.push(pair);
      this.hits.push([0, 0]);
    });
    this.tick = props.tickProps(set);

    seats.forEach((s, i) => {
      const x = this.xs[i] as number;
      const c = companions[i];
      if (c) {
        c.root.position.set(x, SEAT_Y, 0.02);
        c.setBase('listening');
        scene.add(c.root);
      }
      const colors = drumColors(s.color);
      const pair = [0, 1].map((p) => {
        const color = colors[p] as string;
        const lane = new NoteLane(chart, {
          color,
          dir: new THREE.Vector3(0, 1, 0),
          length: LANE,
          ahead: chart.beat * 2.75,
          only: (note) => note.pad === p,
          marker: (note) => beatMark(note, color),
          target: laneTarget(color, 0.25),
          flash: 0.3,
          ticks: 0.42,
          past: 0.35,
          labelAt: new THREE.Vector3(p === 0 ? ARM_X : -ARM_X, LABEL_Y - RING_Y, 0.95),
          labelSize: 0.34,
        });
        lane.group.position.set(x + (p === 0 ? -ARM_X : ARM_X), RING_Y, 0.05);
        scene.add(lane.group);
        return lane;
      });
      this.lanes.push(pair);
      for (const side of [-1, 1]) {
        this.marks.push({ p: new THREE.Vector3(x + side * (ARM_X + 0.3), RING_Y + LANE + 0.2, 0.05) }, { p: new THREE.Vector3(x + side * 1.05, 0, 0.7) });
      }
      this.marks.push({ p: new THREE.Vector3(x, LABEL_Y, 1.0), pad: 0.05 });
    });

    this.fit = new CameraFit(this.camera, 0.2);
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  /** A drum is struck: it squashes, and the player leans toward it. */
  strike(seat: number, pad: number): void {
    const h = this.hits[seat];
    if (h) h[pad] = 1;
    this.leans[seat] = pad === 0 ? 1 : -1;
  }

  /** Shows the word for a judgement over the seat, from the drum's lane (one word per seat at a time). */
  judge(seat: number, pad: number, grade: 'perfect' | 'good' | 'miss', combo?: number): void {
    const pair = this.lanes[seat];
    pair?.[1 - pad]?.clearLabel();
    pair?.[pad]?.hit(grade, combo);
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    const t = this.songTime();
    const playing = t >= 0 && t < this.chart.end;
    const bob = playing ? beatPulse(t, this.chart.beat) : 0;
    this.companions.forEach((c, i) => {
      c.update(dt);
      const lean = this.leans[i] ?? 0;
      this.leans[i] = lean * Math.exp(-dt * 9);
      c.root.rotation.z = lean * 0.11;
      c.root.position.y = SEAT_Y - bob * 0.035;
    });
    this.drums.forEach((pair, i) => {
      pair.forEach((drum, p) => {
        const h = this.hits[i] as number[];
        const k = Math.max(0, (h[p] ?? 0) - dt * 6);
        h[p] = k;
        const base = p === 0 ? 1.06 : 0.95;
        // Squash on the slap, then a small overshoot as the skin springs back.
        const q = k > 0 ? k * k - Math.sin((1 - k) * Math.PI) * 0.25 * k : 0;
        drum.root.scale.set(base * (1 + 0.07 * q), base * (1 - 0.16 * q), base * (1 + 0.07 * q));
        drum.ripple.visible = k > 0;
        drum.ripple.scale.setScalar(0.6 + (1 - k) * 1.6);
        drum.mat.opacity = k * 0.85;
      });
    });
    this.lanes.forEach((pair, i) => {
      for (const lane of pair) lane.update(t, this.tracks[i]?.judged ?? [], dt);
    });
    // The light under each chair pulses on the beat; the lava drifts.
    this.strips.forEach((s) => s.scale.set(1, 1 + bob * 0.8, 1 + bob * 0.8));
    this.blobs.forEach((b, k) => {
      b.position.y = 1.35 + Math.sin(time * (0.5 + k * 0.17) + k * 2.1) * 0.27;
    });
    this.tick(dt, time);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const pair of this.lanes) for (const l of pair) l.dispose();
    for (const pair of this.drums) for (const d of pair) d.mat.dispose();
  }
}

export const minigame: Minigame = {
  id: 'bongocouch',
  title: 'Couch Bongos',
  how: 'A late-night jam with a bongo on each armrest. Tap the Left or Right pad on your phone as a beat lands on that drum. The wrong drum counts as a miss, so keep an eye on both lanes.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui } = ctx;
    const chart = makeChart(SONGS.bongocouch, ctx.rng);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.35, mood: 'listening' })));
    const view = new JamView(seats, companions, chart);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'pads',
      groove: GROOVES.jam,
      note: 'Tap the drum the beat lands on',
      padLabels: PADS,
      padColors: (seat) => drumColors(seats[seat]?.color ?? '#888888'),
      onJudge: (seat, j) => {
        const pad = j.note === null ? 0 : (chart.notes[j.note]?.pad ?? 0);
        view.judge(seat, pad, j.grade, round.tracks[seat]?.combo);
        const c = view.companions[seat];
        if (j.grade !== 'miss') {
          view.strike(seat, pad);
          round.music?.drum(pad, (j.grade === 'perfect' ? 1 : 0.7) * (session.isCpu(seat) ? 0.4 : 1));
          if (j.combo > 0 && j.combo % 8 === 0) c?.react('happy', 1.3);
        } else {
          // The other drum got the slap.
          if (j.wrong) view.strike(seat, 1 - pad);
          if (now - (lastSad[seat] ?? -9) > 1.5) {
            lastSad[seat] = now;
            c?.react('sad', 0.9);
          }
        }
      },
    });
    view.attach(round);

    const caption = new PhraseCaption(ui, chart, SONGS.bongocouch.phrase, 'Tap', 'Last taps…', ['L', 'R']);
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${round.tracks[i]?.score ?? 0} pts` })));
    ui.caption('Tap Left or Right as a beat lands on that bongo');
    let liveAt = -1;
    await round.play((_, t) => {
      now = t;
      caption.update(t);
      if (t - liveAt > 0.2) {
        liveAt = t;
        live();
      }
    });
    live();

    const scores = round.tracks.map((t) => t.score);
    const top = Math.max(...scores);
    view.companions.forEach((c, i) => c.setBase(scores[i] === top ? 'happy' : 'idle'));
    ui.caption(null);
    await ctx.clock.wait(1.2);
    return { scores, details: round.tracks.map(summary) };
  },
};
