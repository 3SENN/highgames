// Head Nod on the TV: the companions sink into a sofa in a lamp-lit living room and nod along to a mellow beat.
// Little records drop toward each head; nod your phone just as yours lands. Patterns start on the beat and slowly
// add the off-beats.
import * as THREE from 'three';
import { type Chart, type Note, type Track, SONGS, makeChart, summary } from '../../../game/minigames/rhythm';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cyl, mix, part, rbox, torus } from '../../render/toon';
import type { View } from '../../stage';
import { GROOVES, NoteLane, PhraseCaption, RhythmRound, beatPulse } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const SPACING = 2.6;
const SEAT_Y = 0.84; // a companion's feet, sunk into the cushion as if sitting
const SOFA_Z = -1.1;
const RING_Y = 2.8;
const LANE = 2.3;
const S = 1.4; // the props are built to the metre; the stubby companions want them this much bigger
const BACK = -3.3; // the back wall
const ROOM_W = 21;
const ROOM_H = 8;
const WALL = mix(P.duskWall, P.plum, 0.4);
const SOFA = mix(P.teal, P.aubergine, 0.3);

/** A little record for a note on the beat, a bead for one on the "and". */
function record(note: Note, color: string): THREE.Group {
  const g = new THREE.Group();
  const flat = { outline: false, shadow: false } as const;
  if (note.onBeat) {
    part(g, cyl(0.21, 0.21, 0.05, 28), '#1c1822', 0, 0, 0, { rx: Math.PI / 2, shadow: false, gloss: 0.5 });
    for (const r of [0.17, 0.135]) part(g, torus(r, 0.006), '#40384c', 0, 0, 0.027, flat);
    part(g, cyl(0.092, 0.092, 0.06, 20), color, 0, 0, 0, { rx: Math.PI / 2, glow: 0.45, ...flat });
    part(g, cyl(0.022, 0.022, 0.066, 10), P.cream, 0, 0, 0, { rx: Math.PI / 2, ...flat });
  } else {
    part(g, ball(0.1), color, 0, 0, 0, { glow: 0.4, shadow: false });
    part(g, ball(0.035, 1), mix(color, '#ffffff', 0.7), 0.035, 0.04, 0.075, { glow: 0.6, ...flat });
  }
  return g;
}

function place<T extends THREE.Object3D>(root: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  root.add(obj);
  return obj;
}

class CouchView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: NoteLane[] = [];
  private readonly xs: number[];
  private readonly nods: number[];
  /** Each seat's cushion on the sofa back: it gets a little squeeze on a good nod. */
  private readonly pillows: THREE.Mesh[] = [];
  private readonly tick: (dt: number, time: number) => void;
  private readonly lamp: THREE.PointLight | null;
  private songTime: () => number = () => -1;
  private tracks: readonly Track[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly companions: Companion[],
    private readonly chart: Chart,
  ) {
    const scene = this.scene;
    lightRig(scene, 'lampInterior', { shadowSize: 11 });
    const set = new THREE.Group();
    scene.add(set);
    const flat = { outline: false, shadow: false } as const;
    const plaster = { outline: false, tex: 'plaster', texStrength: 0.9 } as const;

    // The room: floorboards, a dusky wall with a darker dado, side walls running on past the camera.
    part(set, box(ROOM_W + 0.4, 0.2, 24), P.oak, 0, -0.1, BACK + 12, { ...flat, tex: 'woodFloor', texScale: 3 });
    part(set, box(ROOM_W + 0.4, ROOM_H, 0.2), WALL, 0, ROOM_H / 2, BACK - 0.1, plaster);
    for (const s of [-1, 1]) part(set, box(0.2, ROOM_H, 24), mix(WALL, P.ink, 0.1), s * (ROOM_W / 2 + 0.1), ROOM_H / 2, BACK + 12, plaster);
    part(set, box(ROOM_W, 1.35, 0.04), mix(WALL, P.ink, 0.25), 0, 0.675, BACK + 0.02, plaster);
    part(set, box(ROOM_W, 0.07, 0.08), mix(P.cream, WALL, 0.35), 0, 1.38, BACK + 0.05, { outline: false });
    part(set, box(ROOM_W, 0.2, 0.06), mix(P.cream, WALL, 0.35), 0, 0.1, BACK + 0.04, { outline: false });

    const n = seats.length;
    this.xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    this.nods = seats.map(() => 0);
    const half = (n * SPACING) / 2;
    const wall = BACK + 0.02;

    // Left of the sofa: a window onto the dusk, a floor lamp, a sideboard with the record player.
    const lx = -half - 2.2;
    place(set, props.windowFrame({ w: 1.5, h: 1.7, time: 'dusk', seed: 7 }), lx, 3.7, wall, 0, 1.5);
    place(set, props.curtains({ w: 1.5, h: 1.7, color: mix(P.mustard, P.cream, 0.2) }), lx, 3.7, wall, 0, 1.5);
    const lamp = place(set, props.floorLamp({ light: 16, h: 1.9 }), lx - 1.9, 0, -2.2, 0, 1.5);
    this.lamp = (lamp.userData.light as THREE.PointLight | undefined) ?? null;
    place(set, props.sideboard({ w: 2.3 }), lx + 0.2, 0, BACK + 0.5, 0, S);
    place(set, props.recordPlayer({ playing: true }), lx - 0.3, 0.42 * S, BACK + 0.5, 0, S);
    place(set, props.plant({ kind: 'trailing', h: 0.34, pot: P.ceramic }), lx + 1.2, 0.42 * S, BACK + 0.5, 0, S);
    place(set, props.books(0.5, 4), lx + 0.35, 0.42 * S, BACK + 0.45, 0, S);
    place(set, props.speaker({ h: 1.0 }), lx - 3.2, 0, BACK + 0.5, 0.25, 1.5);

    // Right: a bookshelf, pictures over it, a ficus in the corner, a guitar against the wall.
    const rx = half + 1.9;
    place(set, props.bookshelf({ w: 1.5, h: 2.2, seed: 5 }), rx, 0, BACK + 0.32, 0, 1.5);
    place(set, props.pictureFrame({ w: 0.8, h: 1.0, art: 'sunset', seed: 3 }), rx - 0.35, 4.85, wall, 0, 1.5);
    place(set, props.pictureFrame({ w: 0.5, h: 0.6, art: 'leaf', frame: P.brass, seed: 9 }), rx + 0.95, 5.15, wall, 0, 1.5);
    place(set, props.pictureFrame({ w: 0.5, h: 0.42, art: 'moon', frame: P.charcoal, seed: 4 }), rx + 0.95, 4.35, wall, 0, 1.5);
    place(set, props.plant({ kind: 'ficus', h: 2.0, pot: P.ceramic, seed: 4 }), rx + 2.0, 0, -2.3, 0, S);
    place(set, props.guitar({ color: P.oak }), rx - 1.6, 0, BACK + 0.4, 0, 1.5);
    place(set, props.floorLamp({ h: 1.6, shade: P.clay, light: 10 }), rx + 2.6, 0, -0.4, 0, 1.5);

    // Little lights along the top of the wall.
    const swags = 4;
    for (let k = 0; k < swags; k++) {
      const x0 = -ROOM_W / 2 + 0.3 + (k * (ROOM_W - 0.6)) / swags;
      set.add(props.stringLights(new THREE.Vector3(x0, 6.55, wall + 0.08), new THREE.Vector3(x0 + (ROOM_W - 0.6) / swags, 6.55, wall + 0.08), { sag: 0.24, count: 9, bulb: 0.06 }));
    }

    // A rug and the coffee table, with the evening's munchies.
    place(set, props.rug({ w: Math.max(9, n * SPACING + 1.2), d: 3.8, color: P.terracotta }), 0, 0, 1.55);
    const tableY = 0.42 * S;
    place(set, props.coffeeTable({ w: 2.9, d: 0.95, color: P.walnut }), 0, 0, 1.75, 0, S);
    place(set, props.snackBowl({ fill: 'popcorn', color: P.teal }), -1.05, tableY, 1.7, 0, 1.9);
    place(set, props.snackBowl({ fill: 'crisps', color: P.terracotta, seed: 5 }), 0.95, tableY, 1.85, 0, 1.7);
    place(set, props.mug({ color: P.ceramic }), -0.1, tableY, 2.05, 0.7, 1.8);
    place(set, props.drink({ color: P.denim }), 0.25, tableY, 1.55, 0, 1.8);
    place(set, props.remote(), 1.6, tableY, 1.5, 0.5, 1.8);
    place(set, props.candle({ h: 0.1 }), -1.7, tableY, 1.55, 0, 1.8);

    // The foreground: a pouf and a beanbag at the bottom corners, a big plant leaning in.
    place(set, props.pouf({ color: P.mustard, r: 0.4 }), -half - 0.3, 0, 2.5, 0, 1.6);
    place(set, props.beanbag({ color: P.mauve }), half + 2.9, 0, 0.9, -0.5, 1.6);
    place(set, props.plant({ kind: 'monstera', h: 1.15, seed: 6 }), half + 1.3, 0, 2.7, 0, 1.7);
    place(set, props.motes({ n: 22, area: [ROOM_W * 0.8, 3.6, 5], size: 0.05 }), 0, 0.8, 0);

    // The sofa: deep velvet, and a knitted cushion in each player's colour.
    place(set, props.sofa({ seats: n, seatW: SPACING / S, color: SOFA, tex: 'velvet', legs: P.walnut }), 0, 0, SOFA_Z, 0, S);
    seats.forEach((s, i) => {
      const x = this.xs[i] as number;
      this.pillows.push(part(set, rbox(0.56, 0.46, 0.24, 0.11), mix(s.color, P.ink, 0.08), x + 0.84, 1.36, SOFA_Z - 0.16, { tex: 'knit', texScale: 0.35, rz: -0.22, rx: -0.3, ry: -0.25 }));
    });
    this.tick = props.tickProps(set);

    this.camera.position.set(1.1, 4.9, 11.6);
    this.camera.lookAt(0.35, 2.75, -0.8);

    seats.forEach((s, i) => {
      const x = this.xs[i] as number;
      const c = companions[i];
      if (c) {
        c.root.position.set(x, SEAT_Y, SOFA_Z + 0.1);
        c.root.rotation.y = Math.atan2(this.camera.position.x - x, this.camera.position.z - c.root.position.z) * 0.7;
        c.setBase('listening');
        scene.add(c.root);
      }
      const lane = new NoteLane(chart, {
        color: s.color,
        dir: new THREE.Vector3(0, 1, 0),
        length: LANE,
        ahead: chart.beat * 3,
        marker: (note) => record(note, s.color),
        ticks: 0.5,
        past: 0.45,
        labelAt: new THREE.Vector3(0.95, -0.05, 0.3),
        labelSize: 0.36,
      });
      lane.group.position.set(x, RING_Y, -0.7);
      scene.add(lane.group);
      this.lanes.push(lane);
    });
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  nod(seat: number): void {
    this.nods[seat] = 1;
  }

  update(dt: number, time: number): void {
    const t = this.songTime();
    const playing = t >= 0 && t < this.chart.end;
    const bob = playing ? beatPulse(t, this.chart.beat) : 0;
    this.companions.forEach((c, i) => {
      c.update(dt);
      const k = Math.max(0, (this.nods[i] ?? 0) - dt * 4);
      this.nods[i] = k;
      c.root.rotation.x = Math.sin(Math.PI * (1 - k)) * (k > 0 ? 0.3 : 0);
      c.root.position.y = SEAT_Y - bob * 0.04;
      // The cushion beside them gets a squeeze on the nod and settles.
      const squeeze = k > 0 ? Math.sin(Math.PI * (1 - k)) * k : 0;
      this.pillows[i]?.scale.set(1 + squeeze * 0.12, 1 - squeeze * 0.14, 1);
    });
    this.lanes.forEach((lane, i) => lane.update(t, this.tracks[i]?.judged ?? [], dt));
    this.tick(dt, time);
    // The lamp breathes a little with the beat; the camera drifts, slowly.
    if (this.lamp) this.lamp.intensity = 16 * (1 + bob * 0.05 + Math.sin(time * 2.3) * 0.015);
    this.camera.position.set(1.1 + Math.sin(time * 0.13) * 0.14, 4.9 + Math.sin(time * 0.09) * 0.05, 11.6);
    this.camera.lookAt(0.35, 2.75, -0.8);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const l of this.lanes) l.dispose();
  }
}

export const minigame: Minigame = {
  id: 'headnod',
  title: 'Head Nod',
  how: 'Sink into the sofa and nod your phone to the beat. Little records drop toward your head: nod just as each one lands. Perfect nods in a row build your combo.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui } = ctx;
    const chart = makeChart(SONGS.headnod, ctx.rng);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.5, mood: 'listening' })));
    const view = new CouchView(seats, companions, chart);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'nod',
      groove: GROOVES.couch,
      note: 'Nod as a record lands on your head',
      onJudge: (seat, j) => {
        view.lanes[seat]?.hit(j.grade, round.tracks[seat]?.combo);
        const c = view.companions[seat];
        if (j.grade !== 'miss') {
          view.nod(seat);
          if (!session.isCpu(seat)) round.music?.tock(j.grade === 'perfect' ? 1 : 0.6);
          if (j.combo > 0 && j.combo % 8 === 0) c?.react('happy', 1.4);
        } else if (now - (lastSad[seat] ?? -9) > 1.5) {
          lastSad[seat] = now;
          c?.react('sad', 0.9);
        }
      },
    });
    view.attach(round);

    const caption = new PhraseCaption(ui, chart, SONGS.headnod.phrase, 'Nod');
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${round.tracks[i]?.score ?? 0} pts` })));
    ui.caption('Nod your phone as each record lands on your head');
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
