// Mellow Strum on the TV: the companions sit on a porch bench at dusk with little ukuleles. Above them hangs a giant
// ukulele with one string per player; picks slide along each string toward the sound hole. Strum your phone as yours
// arrives, and where there's no pick, rest and let it ring.
import * as THREE from 'three';
import { type Chart, type Note, type Track, SONGS, makeChart, summary } from '../../../game/minigames/rhythm';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cyl, mix, part, rbox, seeded, torus } from '../../render/toon';
import type { View } from '../../stage';
import { GROOVES, NoteLane, PhraseCaption, RhythmRound, beatPulse, laneTarget } from '../rhythm-kit';
import type { Minigame, MinigameSeat } from '../types';

const SPACING = 3.1;
const BENCH_Y = 1.1; // a companion's feet on the bench
const BENCH_Z = -1.45;
const BOARD_Y = 3.9;
const BOARD_Z = -2.85;
const HOLE_X = -4.55; // the sound hole: where picks get strummed
const NUT_X = 6.35;
const STRING_GAP = 0.36;
const DECK_Y = 0.6;
const WALL_Z = -3.35;
const HOUSE_END = 8.6; // the house's corner, right: the garden shows beyond it
const SIDING = mix(P.linen, P.clay, 0.35);

/** A pick for a note: bigger on the beat, smaller and lighter on the "and". */
function pick(note: Note, color: string): THREE.Group {
  const g = new THREE.Group();
  const r = note.onBeat ? 0.17 : 0.12;
  const c = note.onBeat ? color : mix(color, '#ffffff', 0.3);
  part(g, cyl(r, r, 0.04, 3), mix(c, P.ink, 0.45), 0, 0, 0, { rx: Math.PI / 2, shadow: false });
  part(g, cyl(r * 0.78, r * 0.78, 0.05, 3), c, 0, 0, 0, { rx: Math.PI / 2, glow: 0.45, shadow: false, outline: false });
  part(g, cyl(r * 0.3, r * 0.3, 0.06, 3), mix(c, '#ffffff', 0.6), 0, 0, 0, { rx: Math.PI / 2, glow: 0.6, shadow: false, outline: false });
  return g;
}

function restMark(): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(0.24, 0.05, 0.04, 0.02), mix(P.cream, P.duskWall, 0.5), 0, 0, 0, { outline: false, shadow: false, opacity: 0.7 });
  return g;
}

/** A companion-sized ukulele in the player's colour, neck along +x. */
function miniUke(color: string): THREE.Group {
  const u = new THREE.Group();
  part(u, ball(0.2), color, 0, 0, 0, { sz: 0.4, gloss: 0.35 });
  part(u, ball(0.15), color, 0.24, 0, 0, { sz: 0.4, gloss: 0.35 });
  part(u, cyl(0.06, 0.06, 0.02, 16), '#2a1a14', 0.21, 0, 0.065, { rx: Math.PI / 2, outline: false });
  part(u, torus(0.068, 0.008), P.cream, 0.21, 0, 0.07, { outline: false, shadow: false });
  part(u, rbox(0.55, 0.07, 0.05, 0.02), P.walnut, 0.62, 0, 0);
  part(u, rbox(0.14, 0.11, 0.06, 0.03), P.oak, 0.95, 0, 0);
  return u;
}

function place<T extends THREE.Object3D>(root: THREE.Object3D, obj: T, x: number, y: number, z: number, ry = 0, s = 1): T {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  root.add(obj);
  return obj;
}

interface Floater {
  obj: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  t: number;
}

class PorchView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: NoteLane[] = [];
  private readonly ukes: THREE.Group[] = [];
  private readonly strums: number[];
  /** The giant ukulele's strings, one per seat, and where each rests: a strummed string shivers. */
  private readonly strings: { mesh: THREE.Mesh; y: number }[] = [];
  private readonly notes: Floater[][] = [];
  private readonly tick: (dt: number, time: number) => void;
  private songTime: () => number = () => -1;
  private tracks: readonly Track[] = [];

  constructor(
    seats: MinigameSeat[],
    readonly companions: Companion[],
    private readonly chart: Chart,
  ) {
    const scene = this.scene;
    lightRig(scene, 'dusk', { fog: { near: 30, far: 95 }, shadowSize: 13, sunFrom: [0.5, 0.55, 0.6] });
    const set = new THREE.Group();
    scene.add(set);
    const rand = seeded(23);
    const flat = { outline: false, shadow: false } as const;

    const n = seats.length;
    const xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    this.strums = seats.map(() => 0);
    const W = n * SPACING + 1.0;
    const left = -16;
    const houseW = HOUSE_END - left;
    const houseX = (HOUSE_END + left) / 2;

    // The garden: a lawn running off into the dusk, a fence and trees beyond the house's corner.
    part(set, cyl(70, 70, 0.2, 48), mix(P.grassDark, P.ink, 0.15), 0, -0.14, 0, { ...flat, tex: 'grass', texScale: 6 });
    place(set, props.fence({ w: 16, kind: 'panel', h: 2.2 }), HOUSE_END + 8, 0, WALL_Z - 1.5);
    [
      ['round', 6.5, 2.5, -4],
      ['birch', 7.5, 6.0, -6],
      ['pine', 8.5, 10, -5],
      ['round', 6, 14, -7],
    ].forEach(([kind, h, dx, dz], k) => place(set, props.tree({ kind: kind as props.TreeKind, h: h as number, seed: k + 3 }), HOUSE_END + (dx as number), 0, WALL_Z + (dz as number)));
    place(set, props.bush({ r: 0.9, flowers: P.rose, seed: 2 }), HOUSE_END + 1.6, 0, -1.6);
    place(set, props.bush({ r: 0.7, flowers: P.cream, seed: 5 }), HOUSE_END + 3.2, 0, 0.2);
    for (let k = 0; k < 26; k++) {
      const tx = -13 + rand() * 26;
      const tz = 2.4 + rand() * 3.2;
      if (Math.abs(tx) < 2 && tz < 4) continue;
      place(set, props.tuft({ seed: k + 1, s: 1.2 + rand() * 0.8, ...(rand() < 0.35 ? { flowers: [P.rose, P.mustard, P.cream][k % 3] as string } : {}) }), tx, 0, tz, rand() * 6);
    }
    for (let k = 0; k < 4; k++) part(set, cyl(0.5, 0.55, 0.08, 12), P.stone, (k % 2 ? 0.25 : -0.3) + rand() * 0.2, 0.03, 3.6 + k * 0.85, { tex: 'stoneTiles', outline: false, ry: rand() * 3 });
    place(set, props.motes({ n: 26, area: [22, 2.6, 6], color: '#d8ff9a', size: 0.09, seed: 9 }), 0, 0.7, 1.5);

    // The porch: a plank deck with steps down to the lawn.
    part(set, box(houseW + 1.4, DECK_Y, 5.0), P.wood, houseX + 0.7, DECK_Y / 2, -1.0, { tex: 'planks', texScale: 2.6, outline: false });
    part(set, box(houseW + 1.5, 0.12, 0.14), mix(P.wood, P.ink, 0.3), houseX + 0.7, DECK_Y - 0.06, 1.52, { tex: 'planks', outline: false });
    [0.45, 0.3, 0.15].forEach((y, k) => part(set, rbox(3.2, 0.2, 0.5, 0.04), mix(P.wood, P.ink, 0.08 * k), 0, y - 0.1, 1.75 + k * 0.5, { tex: 'planks' }));
    place(set, props.rug({ w: 2.6, d: 1.0, color: P.terracotta, border: P.sand }), 0, DECK_Y, 0.95);

    // The house wall: clapboards, a lit window, a white corner board and a post holding the porch roof.
    for (let k = 0; k < 17; k++) part(set, rbox(houseW, 0.5, 0.25, 0.04), k % 2 ? SIDING : mix(SIDING, P.ink, 0.06), houseX, DECK_Y + 0.25 + k * 0.46, WALL_Z, { outline: false, tex: 'planks', texStrength: 0.35 });
    part(set, box(0.3, 9, 0.4), P.cream, HOUSE_END, 4.5, WALL_Z + 0.05, { outline: false });
    part(set, rbox(0.34, 8.2, 0.34, 0.05), P.cream, HOUSE_END + 0.9, 4.1, 1.25);
    part(set, box(houseW + 3, 0.3, 0.4), P.cream, houseX + 1, 8.25, 1.3, { outline: false });
    part(set, box(houseW + 3.4, 0.2, 5.6), mix(P.walnut, P.ink, 0.25), houseX + 1, 8.5, -1.1, { ...flat, tex: 'planks' });
    // Under the roof: a porch lamp over the ukulele and two hanging baskets.
    place(set, props.pendantLamp({ drop: 0.75, light: 12, shade: P.brass, r: 0.3 }), 0.9, 8.4, -1.6, 0, 1.7);
    for (const hx of [-5.6, 6.4]) {
      part(set, cyl(0.012, 0.012, 1.5, 4), P.ink, hx, 7.65, -2.2, flat);
      place(set, props.plant({ kind: 'trailing', h: 0.34, pot: P.terracotta, seed: hx > 0 ? 3 : 7 }), hx, 6.4, -2.2, 0, 2.2);
    }
    const wx = 7.2;
    part(set, rbox(1.75, 1.45, 0.12, 0.04), P.cream, wx, 2.1, WALL_Z + 0.17);
    part(set, rbox(1.5, 1.2, 0.13, 0.03), P.lamp, wx, 2.1, WALL_Z + 0.18, { glow: 1.25, ...flat });
    part(set, rbox(0.07, 1.2, 0.14, 0.01), P.cream, wx, 2.1, WALL_Z + 0.2, { outline: false });
    part(set, rbox(1.5, 0.07, 0.14, 0.01), P.cream, wx, 2.25, WALL_Z + 0.2, { outline: false });
    part(set, rbox(1.95, 0.08, 0.3, 0.03), P.cream, wx, 1.36, WALL_Z + 0.25);
    place(set, props.plant({ kind: 'trailing', h: 0.3, pot: P.terracotta }), wx - 0.5, 1.4, WALL_Z + 0.28, 0, 1.6);
    // Little lights under the porch roof.
    for (let k = 0; k < 4; k++) {
      const x0 = -12 + k * 5.25;
      set.add(props.stringLights(new THREE.Vector3(x0, 7.75, 1.2), new THREE.Vector3(x0 + 5.25, 7.75, 1.2), { sag: 0.3, count: 9, bulb: 0.065 }));
    }

    // The bench along the wall.
    const wood = { tex: 'wood', texScale: 1.6 } as const;
    part(set, rbox(W, 0.14, 0.85, 0.05), P.oak, 0, BENCH_Y - 0.07, BENCH_Z - 0.05, wood);
    for (const x of [-W / 2 + 0.3, 0, W / 2 - 0.3]) part(set, rbox(0.12, 0.45, 0.7, 0.03), P.walnut, x, 0.8, BENCH_Z - 0.05, wood);
    for (const y of [1.55, 1.9]) part(set, rbox(W, 0.14, 0.08, 0.03), P.oak, 0, y, BENCH_Z - 0.5, wood);
    for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) part(set, rbox(0.12, 0.95, 0.1, 0.03), P.walnut, x, 1.5, BENCH_Z - 0.52, wood);

    // On the deck: a lantern and a plant on the left; lemonade and a bowl of crisps on a crate on the right.
    place(set, props.gardenLamp({ h: 0.5, light: 9 }), -W / 2 - 0.7, DECK_Y, 0.9, 0, 1.8);
    place(set, props.plant({ kind: 'fern', h: 0.9, pot: P.ceramic }), -W / 2 - 1.8, DECK_Y, -0.2, 0, 1.6);
    place(set, props.crate({ s: 0.5 }), W / 2 + 0.2, DECK_Y, 0.8, 0.2, 1.5);
    place(set, props.snackBowl({ fill: 'crisps', color: P.denim }), W / 2 + 0.1, DECK_Y + 0.75, 0.85, 0, 1.7);
    place(set, props.drink({ kind: 'bottle', color: P.mustard }), W / 2 + 0.45, DECK_Y + 0.75, 0.6, 0, 1.8);
    place(set, props.plant({ kind: 'palm', h: 1.7, pot: P.terracotta, seed: 2 }), HOUSE_END - 0.4, DECK_Y, 0.4, 0, 1.4);
    place(set, props.gardenLamp({ h: 0.8, light: 7 }), HOUSE_END + 2.3, 0, 1.9, 0, 1.6);

    // The giant ukulele: body with the sound hole on the left, the neck and headstock to the right.
    const board = new THREE.Group();
    board.position.set(0, BOARD_Y, BOARD_Z);
    scene.add(board);
    const top = { tex: 'wood', texScale: 2.2, gloss: 0.3 } as const;
    part(board, ball(1.45, 3), P.oak, -6.0, 0, -0.06, { sz: 0.16, ...top });
    part(board, ball(1.15, 3), P.oak, HOLE_X, 0, -0.06, { sz: 0.16, ...top });
    part(board, cyl(0.6, 0.6, 0.04, 32), '#24160f', HOLE_X, 0, 0.13, { rx: Math.PI / 2, outline: false });
    part(board, torus(0.64, 0.04), P.cream, HOLE_X, 0, 0.13, flat);
    part(board, torus(0.72, 0.014), P.brass, HOLE_X, 0, 0.125, flat);
    part(board, rbox(0.28, 1.3, 0.1, 0.04), P.walnut, -6.35, 0, 0.17, { tex: 'darkWood' });
    part(board, rbox(10.4, 1.55, 0.18, 0.06), P.walnut, 1.1, 0, 0, { tex: 'darkWood', texScale: 2.4, gloss: 0.2 });
    for (const sy of [-1, 1]) part(board, rbox(10.4, 0.04, 0.2, 0.015), P.cream, 1.1, sy * 0.76, 0.005, flat);
    for (const fx of [-1.9, 0.4, 2.4, 4.1, 5.4]) part(board, cyl(0.05, 0.05, 0.02, 14), mix(P.walnut, P.cream, 0.3), fx, 0, 0.09, { rx: Math.PI / 2, ...flat });
    part(board, rbox(0.12, 1.6, 0.24, 0.03), P.cream, NUT_X, 0, 0.02, { gloss: 0.4 });
    part(board, rbox(1.25, 1.5, 0.16, 0.2), P.mahogany, 7.0, 0, -0.01, { tex: 'darkWood', gloss: 0.25 });
    for (let s = 0; s < 4; s++) {
      const px = 6.75 + (s % 2) * 0.5;
      const sy = s < 2 ? 1 : -1;
      part(board, cyl(0.05, 0.05, 0.25, 10), P.brass, px, sy * 0.85, 0, { gloss: 0.6 });
      part(board, ball(0.11), seats[s]?.color ?? P.cream, px, sy * 1.02, 0, { gloss: 0.4 });
    }
    part(board, rbox(0.05, n * STRING_GAP + 0.2, 0.04, 0.02), P.lamp, HOLE_X, 0, 0.24, { glow: 1.2, shadow: false });

    seats.forEach((s, i) => {
      const y = ((n - 1) / 2 - i) * STRING_GAP;
      const mesh = part(board, cyl(0.022, 0.022, NUT_X + 6.35, 6), mix(s.color, '#ffffff', 0.3), 0, y, 0.2, { rz: Math.PI / 2, glow: 0.5, outline: false, shadow: false });
      this.strings.push({ mesh, y });
      const lane = new NoteLane(chart, {
        color: s.color,
        dir: new THREE.Vector3(1, 0, 0),
        length: NUT_X - HOLE_X,
        ahead: chart.beat * 3,
        rail: false,
        ticks: 0.3,
        target: laneTarget(s.color, 0.16),
        flash: 0.2,
        marker: (note) => pick(note, s.color),
        rest: restMark,
        past: 0.8,
        labelAt: new THREE.Vector3(-1.2, 0, 0.05),
        labelSize: 0.3,
      });
      lane.group.position.set(HOLE_X, y, 0.24);
      board.add(lane.group);
      this.lanes.push(lane);
    });
    this.tick = props.tickProps(set);

    this.camera.position.set(0.2, 4.7, 13.6);
    this.camera.lookAt(-0.55, 3.0, -1.5);

    seats.forEach((s, i) => {
      const x = xs[i] as number;
      const c = companions[i];
      if (c) {
        c.root.position.set(x, BENCH_Y, BENCH_Z);
        c.root.rotation.y = Math.atan2(this.camera.position.x - x, this.camera.position.z - BENCH_Z) * 0.7;
        c.setBase('idle');
        scene.add(c.root);
      }
      const uke = miniUke(s.color);
      uke.position.set(x + 0.06, BENCH_Y + 0.52, BENCH_Z + 0.43);
      uke.rotation.z = 0.55;
      scene.add(uke);
      this.ukes.push(uke);
      // Little floating notes for a good strum.
      const pool: Floater[] = [];
      for (let k = 0; k < 4; k++) {
        const mat = new THREE.MeshBasicMaterial({ color: mix(s.color, '#ffffff', 0.25), transparent: true, opacity: 0, depthWrite: false });
        const obj = new THREE.Group();
        obj.add(new THREE.Mesh(ball(0.07, 1), mat));
        const stem = new THREE.Mesh(rbox(0.02, 0.2, 0.02, 0.005), mat);
        stem.position.set(0.06, 0.1, 0);
        obj.add(stem);
        obj.visible = false;
        scene.add(obj);
        pool.push({ obj, mat, t: 1 });
      }
      this.notes.push(pool);
    });
  }

  attach(round: RhythmRound): void {
    this.songTime = () => round.now();
    this.tracks = round.tracks;
  }

  strum(seat: number): void {
    this.strums[seat] = 1;
    const pool = this.notes[seat];
    const uke = this.ukes[seat];
    const free = pool?.find((f) => f.t >= 1);
    if (!free || !uke) return;
    free.t = 0;
    free.obj.position.set(uke.position.x + 0.2, uke.position.y + 0.3, uke.position.z + 0.15);
    free.obj.visible = true;
  }

  update(dt: number, time: number): void {
    const t = this.songTime();
    const bob = t >= 0 && t < this.chart.end ? beatPulse(t, this.chart.beat) : 0;
    this.companions.forEach((c, i) => {
      c.update(dt);
      c.root.position.y = BENCH_Y - bob * 0.035;
      const k = Math.max(0, (this.strums[i] ?? 0) - dt * 4);
      this.strums[i] = k;
      const uke = this.ukes[i];
      if (uke) uke.rotation.z = 0.55 + Math.sin(Math.PI * (1 - k)) * (k > 0 ? 0.18 : 0);
      // The seat's string on the big ukulele shivers and settles.
      const string = this.strings[i];
      if (string) string.mesh.position.y = string.y + Math.sin(time * 75) * 0.022 * k * k;
    });
    this.lanes.forEach((lane, i) => lane.update(t, this.tracks[i]?.judged ?? [], dt));
    for (const pool of this.notes) {
      for (const f of pool) {
        if (f.t >= 1) continue;
        f.t = Math.min(1, f.t + dt / 1.1);
        f.obj.position.y += dt * 0.9;
        f.obj.position.x += Math.sin(f.t * 9) * dt * 0.3;
        f.obj.scale.setScalar(0.7 + 0.5 * Math.min(1, f.t / 0.2));
        f.mat.opacity = f.t < 0.15 ? f.t / 0.15 : 1 - (f.t - 0.15) / 0.85;
        if (f.t >= 1) f.obj.visible = false;
      }
    }
    this.tick(dt, time);
    this.camera.position.set(0.2 + Math.sin(time * 0.11) * 0.15, 4.7, 13.6);
    this.camera.lookAt(-0.55, 3.0, -1.5);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const l of this.lanes) l.dispose();
    for (const pool of this.notes) for (const f of pool) f.mat.dispose();
  }
}

export const minigame: Minigame = {
  id: 'strum',
  title: 'Mellow Strum',
  how: 'Hold your phone like a ukulele and strum it when a pick reaches the sound hole on your string. Where there is no pick, rest and let it ring: strumming through a rest costs you.',
  controller: 'rhythm',
  kind: 'rhythm',

  async play(ctx) {
    const { seats, session, ui } = ctx;
    const chart = makeChart(SONGS.strum, ctx.rng);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.4 })));
    const view = new PorchView(seats, companions, chart);
    ctx.stage.setView(view);

    let now = 0;
    const lastSad = seats.map(() => -9);
    const round: RhythmRound = new RhythmRound(ctx, {
      chart,
      motion: 'strum',
      groove: GROOVES.porch,
      note: 'Strum when a pick reaches the sound hole. No pick? Rest.',
      onJudge: (seat, j) => {
        view.lanes[seat]?.hit(j.grade, round.tracks[seat]?.combo);
        const c = view.companions[seat];
        if (j.grade !== 'miss') {
          view.strum(seat);
          round.music?.strum((j.grade === 'perfect' ? 1 : 0.7) * (session.isCpu(seat) ? 0.6 : 1));
          if (j.combo > 0 && j.combo % 6 === 0) c?.react('happy', 1.4);
        } else if (now - (lastSad[seat] ?? -9) > 1.5) {
          lastSad[seat] = now;
          c?.react('sad', 0.9);
        }
      },
    });
    view.attach(round);

    const caption = new PhraseCaption(ui, chart, SONGS.strum.phrase, 'Strum');
    const live = () => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${round.tracks[i]?.score ?? 0} pts` })));
    ui.caption('Strum as each pick reaches the sound hole. No pick? Rest.');
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
