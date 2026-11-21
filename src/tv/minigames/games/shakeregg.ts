// Shaker Egg on the TV: a late kitchen jam. Everyone sits on a stool at the counter with a shaker egg in a cup,
// and little eggs roll down a groove in the counter toward each player's hoop. Shake your phone as one rolls
// through and it plays; the second half slips into double time, runs of eighth notes, so stay loose.
import * as THREE from 'three';
import { type Chart, type Grade, type Note, type Track, barAt, barLabel, makeChart } from '../../../game/minigames/rhythm';
import { EGG_SONG, doubleTimeBars, eggDetail } from '../../../game/minigames/shakeregg';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, kitchen } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, cyl, dome, mix, part, rbox, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import type { Ui } from '../../ui';
import { CameraFit, type Mark, noise } from '../kit';
import { type Groove, NoteLane, RhythmRound, beatPulse } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const SPACING = 2.6;
const TOP = 1.0; // the counter top
const BACK_Z = -0.75; // the counter's back edge, where the players sit
const FRONT_Z = 1.85;
const HOOP_Z = -0.25;
const LANE = 1.85;
const EGG_R = 0.1;
const CUP_X = 0.62; // each player's own shaker egg, in a cup right of the hoop
const STOOL_Y = 0.78;
const STOOL_Z = -1.35;
const ROOM_D = 7.6;
const ROOM_H = 4.7;

/**
 * A bossa in E dorian (Em9, A13, Dmaj9, Bm11): the surdo-ish kick on one and the "and" of two, a brushed snare on
 * the off-beats, keys comping on the bossa's syncopations and a little vibraphone tune.
 */
const GROOVE: Groove = {
  chords: [
    [55, 59, 62, 66],
    [55, 59, 61, 66],
    [57, 61, 64, 66],
    [57, 59, 62, 64],
  ],
  bass: [40, 45, 38, 47],
  kick: [0, 6, 8],
  snare: [3, 10],
  hats: [0, 2, 4, 6, 8, 10, 12, 14],
  keys: [0, 3, 6, 10, 13],
  bassSteps: [0, 6, 8, 14],
  swing: 0.04,
  cutoff: 2000,
  lead: [
    [
      [0, 71, 3],
      [3, 74, 3],
      [6, 78, 4],
      [12, 76, 4],
    ],
    [
      [2, 73, 4],
      [6, 71, 2],
      [8, 78, 6],
      [14, 76, 2],
    ],
    [
      [0, 76, 6],
      [6, 73, 2],
      [8, 69, 4],
      [12, 71, 4],
    ],
    [
      [2, 74, 4],
      [6, 76, 2],
      [8, 74, 2],
      [10, 71, 6],
    ],
  ],
};

/** A shaker egg: a crisp burst of beads, the second half of the shake a touch darker. */
function shake(sfx: Sfx, vel: number, n: number): void {
  const back = n % 2 === 1;
  noise(sfx, { dur: 0.075, filter: 'highpass', freq: back ? 4300 : 5600, gain: 0.16 * vel });
  noise(sfx, { dur: 0.05, filter: 'bandpass', freq: back ? 6500 : 8500, to: back ? 5000 : 7000, gain: 0.07 * vel, delay: 0.022 });
}

/** A little egg rolling to the hoop: in the seat's colour on the beat, a smaller cream one on the "and". */
function eggMarker(note: Note, color: string): THREE.Group {
  const g = new THREE.Group();
  const egg = new THREE.Group();
  const s = note.onBeat ? 1 : 0.78;
  egg.position.y = EGG_R * s;
  part(egg, ball(EGG_R), note.onBeat ? color : P.cream, 0, 0, 0, { sx: 1.3, glow: 0.2, gloss: 0.5, shadow: false });
  part(egg, torus(EGG_R * 0.98, 0.016), note.onBeat ? P.cream : color, 0, 0, 0, { ry: Math.PI / 2, outline: false, shadow: false });
  egg.scale.setScalar(s);
  g.add(egg);
  return g;
}

/**
 * Each phrase's pattern in the caption a beat before it starts, like the kit's PhraseCaption, and "Double time!"
 * when a run of eighths is coming.
 */
class EggCaption {
  private shown = Number.NaN;

  constructor(
    private readonly ui: Ui,
    private readonly chart: Chart,
    private readonly fast: ReadonlySet<number>,
  ) {}

  update(time: number): void {
    const bar = barAt(this.chart, time + this.chart.beat);
    if (bar < 0) return;
    const p = Math.floor(bar / EGG_SONG.phrase);
    if (p === this.shown) return;
    this.shown = p;
    const first = p * EGG_SONG.phrase;
    const bars = this.chart.bars.slice(first, first + EGG_SONG.phrase);
    if (bars.length === 0) {
      this.ui.caption('Last shake…');
      return;
    }
    const fast = bars.some((_, k) => this.fast.has(first + k));
    const parts = bars.filter((b, i) => i === 0 || b !== bars[i - 1]).map((b) => barLabel(b));
    this.ui.caption(`${fast ? 'Double time!' : 'Shake'}   ${parts.join('   |   ')}`, fast ? P.mustard : undefined);
  }
}

interface Rig {
  /** The player's own shaker egg, in its cup. */
  egg: THREE.Group;
  shake: number;
  /** Per note: the rolling egg inside each marker. */
  rollers: (THREE.Object3D | null)[];
  bulb: THREE.Object3D;
}

class KitchenView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: NoteLane[] = [];
  private readonly rigs: Rig[] = [];
  private readonly marks: Mark[] = [];
  private readonly fit: CameraFit;
  private readonly radio = new THREE.Group();
  private readonly env: Env;
  private songTime: () => number = () => -1;
  private tracks: readonly Track[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly companions: Companion[],
    private readonly chart: Chart,
    private readonly fast: ReadonlySet<number>,
  ) {
    const scene = this.scene;
    const n = seats.length;
    const xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    const W = n * SPACING + 1.3;

    // The kitchen late in the evening: cabinets, cooker and shelves along the back wall, the lamps over the island
    // doing the lighting (they are ours, one per seat, so the room's own pendants and lights stay out).
    this.env = kitchen(scene, { mood: 'evening', w: Math.max(10, W + 5), d: ROOM_D, h: ROOM_H, lights: false, cabinets: P.forest, seed: 4 });
    for (const o of [...this.env.root.children]) if (o.name === 'pendantLamp') o.removeFromParent();
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, sc = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc);
      scene.add(o);
      return o;
    };

    // Warm string lights and a picture on the tall wall over the cabinets.
    const roomW = Math.max(10, W + 5);
    for (let k = 0; k < 3; k++) {
      const x0 = -roomW / 2 + 0.3 + (k * (roomW - 0.6)) / 3;
      scene.add(props.stringLights(new THREE.Vector3(x0, 3.95, -ROOM_D / 2 + 0.08), new THREE.Vector3(x0 + (roomW - 0.6) / 3, 3.95, -ROOM_D / 2 + 0.08), { sag: 0.2, count: 9 }));
    }
    put(props.pictureFrame({ w: 1.1, h: 0.8, art: 'hills', frame: P.walnut, seed: 2 }), -roomW * 0.32, 3.0, -ROOM_D / 2 + 0.01);
    put(props.pictureFrame({ w: 0.6, h: 0.8, art: 'leaf', frame: P.brass, seed: 5 }), roomW * 0.36, 2.9, -ROOM_D / 2 + 0.01);

    const mid = (FRONT_Z + BACK_Z) / 2;
    const depth = FRONT_Z - BACK_Z;
    const cab = mix(P.forest, P.ink, 0.15);
    const stone = mix(P.linen, P.clay, 0.2);
    withOutline(0.03, () => {
      // The island: painted cupboards with brass handles, a pale terrazzo top with a groove per player.
      part(scene, rbox(W, TOP - 0.06, depth - 0.2, 0.05), cab, 0, (TOP - 0.06) / 2, mid - 0.05, { tex: 'wood', texStrength: 0.35 });
      part(scene, rbox(W + 0.2, 0.08, depth, 0.035), stone, 0, TOP - 0.04, mid, { tex: 'terrazzo', gloss: 0.3 });
      part(scene, rbox(W + 0.02, 0.1, 0.22, 0.03), mix(cab, P.ink, 0.35), 0, 0.05, FRONT_Z - 0.2, { outline: false });
      seats.forEach((s, i) => {
        const x = xs[i] as number;
        part(scene, rbox(SPACING - 0.3, TOP - 0.3, 0.05, 0.03), mix(cab, P.cream, 0.1), x, TOP / 2 - 0.05, FRONT_Z - 0.08, { tex: 'wood', texStrength: 0.3, outline: 0.015 });
        part(scene, rbox(SPACING - 0.6, TOP - 0.6, 0.02, 0.01), mix(cab, P.cream, 0.04), x, TOP / 2 - 0.05, FRONT_Z - 0.05, { outline: false });
        part(scene, rbox(0.4, 0.04, 0.05, 0.018), P.brass, x, TOP - 0.22, FRONT_Z - 0.03, { gloss: 0.7, outline: false });
        // The groove: an inset channel with a lip each side, in the player's colour.
        part(scene, rbox(0.34, 0.012, LANE + 0.45, 0.005), mix(stone, P.ink, 0.28), x, TOP + 0.002, HOOP_Z + LANE / 2 + 0.05, { outline: false, shadow: false });
        for (const side of [-1, 1]) part(scene, rbox(0.04, 0.035, LANE + 0.45, 0.012), mix(s.color, stone, 0.35), x + side * 0.19, TOP + 0.017, HOOP_Z + LANE / 2 + 0.05, { gloss: 0.4, outline: false });
        // The stool behind, its leather seat in the player's colour.
        put(props.stool({ h: STOOL_Y / 1.8, seat: mix(s.color, P.aubergine, 0.3) }), x, 0, STOOL_Z, i * 1.1, 1.8);
      });

      // At the ends of the island: a bowl of fruit, a jug of something cold, a mug, and the radio playing along.
      put(props.snackBowl({ fill: 'fruit', color: P.denim, r: 0.3, seed: 5 }), -W / 2 + 0.5, TOP, 0.95);
      put(props.mug({ color: P.terracotta }), -W / 2 + 0.42, TOP, 0.15, 2.2, 2.6);
      const jx = W / 2 - 0.45;
      part(scene, cyl(0.15, 0.17, 0.45, 20), '#cfe3e6', jx, TOP + 0.225, 1.0, { opacity: 0.55, gloss: 0.8, outline: 0.012 });
      part(scene, cyl(0.13, 0.15, 0.3, 20), P.terracotta, jx, TOP + 0.15, 1.0, { opacity: 0.85, outline: false });
      part(scene, torus(0.1, 0.022, Math.PI), '#cfe3e6', jx + 0.17, TOP + 0.25, 1.0, { rz: -Math.PI / 2, outline: false, gloss: 0.8 });
      this.radio.position.set(W / 2 - 0.5, TOP, 0.1);
      this.radio.rotation.y = -0.35;
      part(this.radio, rbox(0.7, 0.4, 0.28, 0.08), P.terracotta, 0, 0.2, 0, { tex: 'leather', texStrength: 0.5 });
      part(this.radio, cyl(0.13, 0.13, 0.03, 20), P.cream, -0.15, 0.2, 0.14, { rx: Math.PI / 2, outline: false });
      part(this.radio, cyl(0.1, 0.1, 0.035, 20), P.charcoal, -0.15, 0.2, 0.142, { rx: Math.PI / 2, outline: false });
      part(this.radio, rbox(0.2, 0.07, 0.03, 0.02), P.lamp, 0.18, 0.27, 0.14, { glow: 1.6, outline: false });
      for (const dx of [0.12, 0.24]) part(this.radio, cyl(0.028, 0.028, 0.03, 12), P.brass, dx, 0.13, 0.145, { rx: Math.PI / 2, gloss: 0.7, outline: false });
      part(this.radio, cyl(0.008, 0.008, 0.5, 4), P.stone, 0.25, 0.6, 0, { rz: -0.4, outline: false });
      scene.add(this.radio);
      // A guitar leaning on the end of the island, and a plant by it.
      put(props.guitar(), -W / 2 - 0.42, 0, 0.9, -Math.PI / 2 + 0.25, 1.45);
      put(props.plant({ kind: 'monstera', h: 1.1, pot: P.terracotta, seed: 3 }), W / 2 + 1.0, 0, 1.3, 0, 1.3);
    });

    seats.forEach((s, i) => {
      const x = xs[i] as number;
      const c = companions[i];
      if (c) {
        c.root.position.set(x, STOOL_Y, STOOL_Z);
        c.setBase('listening');
        scene.add(c.root);
      }

      // A pendant lamp over each seat.
      let bulb!: THREE.Object3D;
      withOutline(0.04, () => {
        // An enamel shade, dark outside, with a trim in the player's colour.
        part(scene, cyl(0.01, 0.01, ROOM_H - 3.8, 4), P.ink, x, (ROOM_H + 3.8) / 2, HOOP_Z - 0.1, { outline: false });
        part(scene, cyl(0.05, 0.07, 0.1, 12), P.brass, x, 3.86, HOOP_Z - 0.1, { gloss: 0.7, outline: false });
        part(scene, dome(0.34), P.charcoal, x, 3.55, HOOP_Z - 0.1, { gloss: 0.5 });
        part(scene, torus(0.335, 0.022), s.color, x, 3.555, HOOP_Z - 0.1, { rx: Math.PI / 2, glow: 0.9, outline: false, shadow: false });
        bulb = part(scene, sphere(0.12, 16), P.lamp, x, 3.5, HOOP_Z - 0.1, { glow: 2.2, shadow: false });
      });
      // The lamps light the island (every seat with a few players, every other one with a crowd).
      if (n <= 4 || i % 2 === 0) {
        const glow = new THREE.PointLight(P.lamp, n <= 4 ? 4.2 : 5.5, 6.5, 1.5);
        glow.position.set(x, 3.3, HOOP_Z);
        scene.add(glow);
      }

      // The player's own shaker egg, standing in a cup.
      const egg = new THREE.Group();
      withOutline(0.035, () => {
        part(scene, cyl(0.13, 0.09, 0.14, 20), P.ceramic, x + CUP_X, TOP + 0.07, HOOP_Z + 0.05, { gloss: 0.5 });
        part(egg, sphere(0.15, 20), s.color, 0, 0.17, 0, { sy: 1.3, gloss: 0.5 });
        for (const y of [0.1, 0.24]) part(egg, torus(0.135, 0.018), mix(s.color, P.cream, 0.6), 0, y, 0, { rx: Math.PI / 2, outline: false });
      });
      egg.position.set(x + CUP_X, TOP + 0.08, HOOP_Z + 0.05);
      scene.add(egg);

      const rollers: (THREE.Object3D | null)[] = chart.notes.map(() => null);
      const target = new THREE.Group();
      part(target, torus(0.22, 0.035), s.color, 0, 0.12, 0, { glow: 1.1, shadow: false });
      const lane = new NoteLane(chart, {
        color: s.color,
        dir: new THREE.Vector3(0, 0, 1),
        across: new THREE.Vector3(1, 0, 0),
        length: LANE,
        ahead: chart.beat * 2.75,
        rail: false,
        ticks: 0.4,
        target,
        flash: 0.3,
        marker: (note, k) => {
          const m = eggMarker(note, s.color);
          rollers[k] = m.children[0] ?? null;
          return m;
        },
        past: 0.45,
        labelAt: new THREE.Vector3(-0.85, 0.5, 0.15),
        labelSize: 0.32,
      });
      lane.group.position.set(x, TOP + 0.02, HOOP_Z);
      scene.add(lane.group);
      this.lanes.push(lane);
      this.rigs.push({ egg, shake: 0, rollers, bulb });

      this.marks.push(
        { p: new THREE.Vector3(x - 0.3, TOP, HOOP_Z + LANE + 0.1) },
        { p: new THREE.Vector3(x + 0.3, TOP, HOOP_Z + LANE + 0.1) },
        { p: new THREE.Vector3(x - 0.85, TOP + 0.52, HOOP_Z + 0.15), pad: 0.06 },
        { p: new THREE.Vector3(x + CUP_X + 0.2, TOP + 0.5, HOOP_Z) },
        { p: new THREE.Vector3(x, STOOL_Y + 1.45, STOOL_Z) },
        { p: new THREE.Vector3(x, 3.75, HOOP_Z - 0.1) },
      );
    });

    this.fit = new CameraFit(this.camera, 0.6);
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  shake(seat: number): void {
    const rig = this.rigs[seat];
    if (rig) rig.shake = 1;
  }

  judge(seat: number, grade: Grade): void {
    this.lanes[seat]?.hit(grade);
  }

  update(dt: number, time = 0): void {
    this.fit.update(() => this.marks);
    this.env.update(dt, time);
    const t = this.songTime();
    const chart = this.chart;
    const playing = t >= 0 && t < chart.end;
    const bar = barAt(chart, t);
    const fast = playing && this.fast.has(bar);
    // In double time the lamps and the players bounce on every eighth.
    const bob = playing ? beatPulse(t, fast ? chart.beat / 2 : chart.beat) : 0;

    this.companions.forEach((c, i) => {
      c.update(dt);
      c.root.position.y = STOOL_Y - bob * 0.035;
      c.root.rotation.z = playing ? Math.sin((t / chart.beat) * Math.PI + i) * 0.035 : 0;
    });

    this.rigs.forEach((rig, i) => {
      rig.shake = Math.max(0, rig.shake - dt * 5);
      const k = rig.shake;
      rig.egg.rotation.z = k > 0 ? Math.sin((1 - k) * Math.PI * 4) * 0.4 * k : 0;
      rig.egg.position.y = TOP + 0.08 + Math.sin((1 - k) * Math.PI) * 0.08 * (k > 0 ? 1 : 0);
      rig.bulb.scale.setScalar(1 + bob * (fast ? 0.3 : 0.18));
      const lane = this.lanes[i];
      lane?.update(t, this.tracks[i]?.judged ?? [], dt);
      // The little eggs roll as they come.
      rig.rollers.forEach((egg) => {
        if (egg?.parent?.visible) egg.rotation.x = egg.parent.position.z / EGG_R;
      });
    });

    this.radio.scale.set(1 + bob * 0.04, 1 - bob * 0.05, 1);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const l of this.lanes) l.dispose();
  }
}

export const minigame: Minigame = {
  id: 'shakeregg',
  title: 'Shaker Egg',
  how: 'A kitchen jam at the counter. Little eggs roll down the groove to your hoop: shake your phone as each one rolls through. Later it slips into double time, so keep your wrist loose.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui, sfx } = ctx;
    const chart = makeChart(EGG_SONG, ctx.rng);
    const fast = new Set(doubleTimeBars(chart));
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.4, mood: 'listening' })));
    const view = new KitchenView(seats, companions, chart, fast);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const shakes = seats.map(() => 0);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'shake',
      groove: GROOVE,
      note: 'Shake as an egg rolls through your hoop',
      onJudge: (seat, j) => {
        view.judge(seat, j.grade);
        const c = view.companions[seat];
        if (j.grade !== 'miss') {
          view.shake(seat);
          shake(sfx, (j.grade === 'perfect' ? 1 : 0.7) * (session.isCpu(seat) ? 0.35 : 1), shakes[seat] ?? 0);
          shakes[seat] = (shakes[seat] ?? 0) + 1;
          if (j.combo > 0 && j.combo % 8 === 0) c?.react('happy', 1.3);
        } else if (now - (lastSad[seat] ?? -9) > 1.5) {
          lastSad[seat] = now;
          c?.react('sad', 0.9);
        }
      },
    });
    view.attach(round);

    const caption = new EggCaption(ui, chart, fast);
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${round.tracks[i]?.score ?? 0} pts` })));
    ui.caption('Shake your phone as an egg rolls through your hoop');
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
    return { scores, details: round.tracks.map(eggDetail) };
  },
};
