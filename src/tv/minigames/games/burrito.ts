// Blanket Burrito on the TV: a bedroom at night, lamp on, a giant fluffy blanket across the floor in everyone's
// stripes. Each player lies at the far edge of their part and rolls towards the camera as they circle their
// phone; every layer wraps one stripe round them, so the burrito gets fatter and stripier. Spin too fast for too
// long and the burrito wobbles, loosens a layer and rolls back a little.
import * as THREE from 'three';
import {
  BURRITO,
  type CpuSpinner,
  type Roller,
  burritoDetail,
  burritoScores,
  cpuSpin,
  newCpuSpinner,
  newRoller,
  stepRoller,
  wholeLayers,
} from '../../../game/minigames/burrito';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import type { CompanionMood } from '../../../shared/look';
import { type Env, bedroom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, type PartOptions, cone, cyl, gem, material, mix, nameCard, part, pill, rbox, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, lanes, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.5; // companion height
const LANE = 3.3; // width of each player's part of the blanket
const BANDS = 16; // stripes per lane: one per layer
const STEP = 0.42; // how far a burrito rolls per layer
const Z0 = -3.1; // where the burritos start (the blanket's far edge)
const Z_END = Z0 + BANDS * STEP; // the blanket's near edge
const R0 = 0.26; // burrito radius before the first layer
const T = 0.052; // extra radius per layer
const LEN = HEIGHT * 0.55; // burrito length: feet to neck, the head pokes out
const BLANKET_Y = 0.1; // the blanket's thickness
const ROOM = 2.1; // the furnished room's scale: the blanket and everyone on it are giants
const KNIT: PartOptions = { tex: 'knit', texScale: 1.3 };

/**
 * The colour of stripe `b` in a lane: the player's colour (a step down: it is a lot of wool) and cream, in turn.
 * The full seat colour is on the lane's trim, its pom-poms and the name card.
 */
const bandColor = (color: string, b: number) => (b % 2 === 0 ? mix(color, P.aubergine, 0.32) : P.cream);
const bandMat = (color: string, b: number) => material(bandColor(color, b), KNIT);

/** Scales a furnished room up to the game's size, lamps and shadows included. */
function scaleRoom(env: Env, k: number, shadow: number): void {
  env.root.scale.setScalar(k);
  for (const l of env.lamps) {
    l.intensity *= k ** 1.6;
    l.distance *= k;
  }
  const c = env.sun.shadow.camera;
  c.left = c.bottom = -shadow;
  c.right = c.top = shadow;
  c.updateProjectionMatrix();
}

// ------------------------------------------------------------------ sounds

function fwump(sfx: Sfx, layers: number): void {
  noise(sfx, { dur: 0.2, freq: 320, to: 110, gain: 0.3 });
  tone(sfx, { freq: 300 + Math.min(16, layers) * 28, dur: 0.12, gain: 0.06 });
}

function woozy(sfx: Sfx): void {
  tone(sfx, { freq: 720, to: 260, dur: 0.55, gain: 0.1 });
  tone(sfx, { freq: 660, to: 240, dur: 0.55, gain: 0.08, delay: 0.14, type: 'triangle' });
}

// ------------------------------------------------------------------ the view

interface Lane {
  x: number;
  color: string;
  bands: THREE.Mesh[];
  burrito: THREE.Group;
  roll: THREE.Group;
  rings: THREE.Group;
  shell: THREE.Mesh;
  shellBands: THREE.Mesh[];
  stars: THREE.Group;
  companion: Companion;
  card: THREE.Sprite;
  /** Where the burrito is shown (eases after the layers). */
  shown: number;
  built: number;
  squash: number;
  angle: number;
  wobble: number;
  idle: number;
  mood: CompanionMood;
}

class BedroomView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: Lane[] = [];
  readonly floaters: Floaters;
  private readonly fit = new CameraFit(this.camera, 0.9);
  private readonly marks: Mark[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly env: Env;
  private cat: THREE.Object3D | null = null;
  private readonly tick: (dt: number, time: number) => void;
  private sparks: { mesh: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private time = 0;

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    this.floaters = new Floaters(this.scene);
    // A bedroom in the evening, lamps on: built at 1 m scale and blown up round the giant blanket.
    const wide = seats.length * LANE + 15;
    this.env = bedroom(this.scene, { mood: 'evening', w: wide / ROOM, d: (2 * (3.2 - Z0)) / ROOM, h: 3.4, bed: false, wall: P.duskWall });
    scaleRoom(this.env, ROOM, 12);
    const dressing = new THREE.Group();
    this.buildRoom(dressing, seats.length);
    this.scene.add(dressing);
    this.tick = props.tickProps(dressing);

    const xs = lanes(seats.length, LANE);
    seats.forEach((s, i) => {
      const x = xs[i] ?? 0;
      const bands: THREE.Mesh[] = [];
      for (let b = 0; b < BANDS; b++) {
        bands.push(part(this.scene, rbox(LANE - 0.04, BLANKET_Y, STEP, 0.04), bandColor(s.color, b), x, BLANKET_Y / 2, Z0 + (b + 0.5) * STEP, { ...KNIT, outline: false }));
      }
      // A fluffy pillow at the head end; a trim and pom-poms in the seat's colour along the near edge.
      withOutline(0.035, () => part(this.scene, rbox(1.3, 0.34, 0.75, 0.16), mix(s.color, P.cream, 0.62), x + 0.55, 0.2, Z0 - 0.75, { rz: -0.06, tex: 'fabric', texStrength: 0.6 }));
      part(this.scene, rbox(LANE - 0.04, BLANKET_Y + 0.02, 0.09, 0.03), s.color, x, BLANKET_Y / 2 + 0.01, Z_END + 0.03, { outline: false, exact: true });
      for (let k = 0; k < 6; k++) part(this.scene, sphere(0.09, 10), k % 2 ? P.cream : s.color, x - LANE / 2 + (k + 0.5) * (LANE / 6), 0.08, Z_END + 0.13, { ...KNIT, outline: false });

      const burrito = new THREE.Group();
      const roll = new THREE.Group();
      const rings = new THREE.Group();
      roll.add(rings);
      const shell = part(roll, cyl(1, 1, 1, 26), bandColor(s.color, 0), 0, 0, 0, { ...KNIT, rz: Math.PI / 2, sx: R0, sy: LEN, sz: R0 });
      const shellBands = [-1, 1].map((side) => part(roll, cyl(1, 1, 1, 26), P.cream, side * LEN * 0.3, 0, 0, { ...KNIT, rz: Math.PI / 2, sx: R0 + 0.01, sy: 0.07, sz: R0 + 0.01, outline: false }));
      burrito.add(roll);
      const c = companions[i] as Companion;
      // Lying on its back along the burrito, head out of the right-hand end, face tipped up to the camera.
      c.root.position.set(-LEN / 2 - 0.08, 0, 0);
      c.root.rotation.set(-0.7, 0, -Math.PI / 2);
      c.setBase('happy');
      burrito.add(c.root);
      const stars = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        part(stars, gem(0.09), P.lamp, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, { glow: 2, shadow: false });
      }
      stars.visible = false;
      stars.position.set(LEN / 2 + 0.35, 0.75, 0);
      burrito.add(stars);
      this.scene.add(burrito);
      const card = nameCard(s.name, s.color, 0.85);
      this.scene.add(card);
      this.owned.push(card.material.map as THREE.Texture, card.material);
      const lane: Lane = { x, color: s.color, bands, burrito, roll, rings, shell, shellBands, stars, companion: c, card, shown: 0, built: -1, squash: 0, angle: 0, wobble: 0, idle: 0, mood: 'happy' };
      this.lanes.push(lane);
      this.show(i, 0, false, 0);
    });

    // What the camera keeps in view: the whole blanket with its pillows, and the tallest burrito's name card
    // anywhere it might roll to.
    const half = (seats.length * LANE) / 2 + 0.2;
    const top = 2 * (R0 + 14 * T) + BLANKET_Y + 0.6;
    for (const x of [-half, half]) {
      this.marks.push({ p: new THREE.Vector3(x, 0, Z0 - 1.2) }, { p: new THREE.Vector3(x, 0, Z_END + 0.2) });
      this.marks.push({ p: new THREE.Vector3(x * 0.85, top, Z0), pad: 0.05 }, { p: new THREE.Vector3(x * 0.85, top, Z0 + 13 * STEP), pad: 0.05 });
    }
  }

  /** The game's own dressing on top of the furnished room: the bed, the bedside lamp, things left on the floor. */
  private buildRoom(s: THREE.Group, n: number): void {
    const put = <T extends THREE.Object3D>(o: T, x: number, z: number, ry = 0, k = ROOM, y = 0): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.multiplyScalar(k);
      s.add(o);
      return o;
    };
    const edge = (n * LANE) / 2;

    // The bed on the left, a cat curled up asleep on it.
    const bx = -edge - 3.3;
    const bk = 2.3;
    put(props.bed({ color: P.denim, blanket: P.mustard }), bx, Z0 + 0.5, 0, bk);
    const cat = new THREE.Group();
    const fur = mix(P.mustard, P.terracotta, 0.45);
    part(cat, sphere(0.42, 16), fur, 0, 0.22, 0, { sy: 0.55 });
    part(cat, sphere(0.2, 14), fur, 0.36, 0.3, -0.2);
    for (const ex of [0.26, 0.46]) part(cat, cone(0.07, 0.14, 4), fur, ex, 0.5, -0.24);
    part(cat, torus(0.32, 0.065, Math.PI * 1.2), P.copper, -0.05, 0.1, 0.22, { rx: Math.PI / 2 });
    this.cat = put(cat, bx + 0.5, Z0 + 2.3, 0.3, 1, 0.62 * bk);

    // A bedside table with the lamp that lights the room, a mug and a book.
    const tx = bx + 2.9;
    put(props.sideTable({ h: 0.5, color: P.walnut }), tx, Z0 - 1.9, 0, bk);
    put(props.tableLamp({ light: 13, stand: P.brass }), tx - 0.15, Z0 - 2.0, 0, bk, 0.5 * bk);
    put(props.mug({ color: P.terracotta }), tx + 0.35, Z0 - 1.6, 1, bk * 1.3, 0.5 * bk);

    // Right: a reading corner. A floor lamp, a beanbag, a stack of books, slippers by the blanket.
    put(props.floorLamp({ light: 11 }), edge + 1.3, Z0 - 2.5);
    put(props.beanbag({ color: P.teal }), edge + 2.4, Z0 - 0.6, -0.5, 2.4);
    put(props.plant({ kind: 'fern', h: 0.7, pot: P.terracotta, seed: 4 }), edge + 3.2, Z0 - 2.4, 0, 2.4);
    const stack = put(new THREE.Group(), edge + 1.1, Z0 + 1.6, 0.3, 1);
    [P.forest, P.mustard, P.rose, P.denim].forEach((c, k) => part(stack, rbox(1.0 - k * 0.06, 0.16, 0.74, 0.03), c, (k % 2) * 0.06, 0.08 + k * 0.165, 0, { ry: (k - 1.5) * 0.14 }));
    put(props.mug({ color: P.cream }), edge + 1.15, Z0 + 1.6, 2, bk * 1.2, 0.68);
    for (const dx of [0, 0.46]) part(s, pill(0.16, 0.36), P.rose, edge + 0.7 + dx, 0.13, Z0 + 3.4, { rx: Math.PI / 2, ry: 0.2 - dx * 0.5, tex: 'terry' });
    put(props.snackBowl({ fill: 'popcorn', color: P.denim }), edge + 1.0, Z0 + 4.8, 0, 2.6);

    // Foreground: floor cushions in the bottom corners.
    put(props.pouf({ color: P.mauve }), -edge - 2.2, Z_END + 1.6, 0, 2.6);
    put(props.pouf({ color: P.mustard, r: 0.3 }), -edge - 0.9, Z_END + 2.4, 0, 2.6);
    put(props.pouf({ color: P.forest }), edge - 0.4, Z_END + 2.1, 0, 2.6);
    // Dust in the lamp light.
    put(props.motes({ n: 22, area: [n * LANE + 8, 3, 9], size: 0.07 }), 0, 0, 0, 1, 1);
  }

  /** Shows lane i at `layers` (the burrito's size and place, and the blanket still flat in front of it). */
  show(i: number, layers: number, dizzy: boolean, dt: number): void {
    const l = this.lanes[i];
    if (!l) return;
    const before = l.shown;
    l.shown += (layers - l.shown) * (dt > 0 ? 1 - Math.exp(-6 * dt) : 1);
    const whole = Math.floor(layers + 1e-9);
    if (whole !== l.built) this.rebuild(l, whole);
    const r = R0 + l.shown * T;
    const z = Z0 + l.shown * STEP;
    // The blanket: stripes behind the burrito are rolled up, the one under it is half gone.
    l.bands.forEach((m, b) => {
      const from = Z0 + b * STEP;
      const left = Math.min(STEP, Math.max(0, from + STEP - z));
      m.visible = left > 0.01;
      if (!m.visible) return;
      m.scale.z = left / STEP;
      m.position.z = from + STEP - left / 2;
    });
    l.shell.scale.set(r, LEN, r);
    for (const sb of l.shellBands) sb.scale.set(r + 0.012, 0.07, r + 0.012);
    l.angle += (l.shown - before) * (STEP / r);
    l.roll.rotation.x = l.angle;
    const squash = Math.sin(l.squash * 14) * l.squash * 0.07;
    l.burrito.position.set(l.x, BLANKET_Y * 0.5 + r * (1 - squash), z);
    l.burrito.scale.set(1 + squash, 1 - squash, 1 + squash);
    l.wobble = dizzy ? l.wobble + dt : 0;
    l.burrito.rotation.z = dizzy ? Math.sin(l.wobble * 7) * 0.12 : 0;
    l.burrito.rotation.y = dizzy ? Math.sin(l.wobble * 5.3) * 0.1 : 0;
    l.companion.root.position.y = 0;
    l.companion.root.rotation.x = -0.7 + (dizzy ? Math.sin(l.wobble * 9) * 0.35 : 0);
    l.stars.visible = dizzy;
    l.stars.position.y = r + 0.55;
    l.stars.rotation.y = this.time * 5;
    l.card.position.set(l.x, BLANKET_Y + 2 * r + 0.55, z);
  }

  /**
   * Layers wrapped so far: rings of stripes that peek out of the feet end like a rolled-up rug, the inner ones a
   * little longer. The outside shows the stripe being wrapped now.
   */
  private rebuild(l: Lane, whole: number): void {
    const grew = whole > l.built && l.built >= 0;
    l.built = whole;
    for (const m of [...l.rings.children]) l.rings.remove(m);
    for (let k = 1; k <= whole; k++) {
      const r = R0 + k * T - 0.004;
      const extra = (whole - k + 1) * 0.022;
      part(l.rings, cyl(1, 1, 1, 26), bandColor(l.color, k - 1), -extra / 2, 0, 0, { ...KNIT, rz: Math.PI / 2, sx: r, sy: LEN + extra, sz: r, outline: false });
    }
    l.shell.material = bandMat(l.color, whole);
    for (const sb of l.shellBands) sb.material = bandMat(l.color, whole + 1);
    // A new layer: a happy little squash and a few bits of fluff.
    if (grew) {
      l.squash = 1;
      for (let k = 0; k < 5; k++) {
        const mesh = part(this.scene, sphere(0.05, 6), k % 2 ? P.cream : l.color, l.x + (k - 2) * 0.3, l.burrito.position.y, l.burrito.position.z + 0.2, { glow: 0.6, outline: false, shadow: false });
        this.sparks.push({ mesh, v: new THREE.Vector3((k - 2) * 0.5, 1.6 + (k % 2) * 0.5, 0.6), age: 0 });
      }
    }
  }

  /** Sets a lane's companion's mood (only when it changes). */
  mood(i: number, mood: CompanionMood): void {
    const l = this.lanes[i];
    if (!l || l.mood === mood) return;
    l.mood = mood;
    l.companion.setBase(mood);
  }

  /** Floating words over lane i's burrito. */
  say(i: number, text: string, color: string): void {
    const l = this.lanes[i];
    if (!l) return;
    this.floaters.add(text, color, l.card.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0.55, 1.3);
  }

  dispose(): void {
    for (const l of this.lanes) l.companion.dispose();
    this.floaters.dispose();
    for (const o of this.owned) o.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.fit.update(() => this.marks);
    this.floaters.update(dt);
    for (const l of this.lanes) {
      l.companion.update(dt);
      l.squash = Math.max(0, l.squash - dt * 2.2);
    }
    this.env.update(dt, time);
    this.tick(dt, time);
    // The cat breathes in its sleep.
    if (this.cat) this.cat.scale.y = 1 + Math.sin(time * 1.6) * 0.04;
    this.sparks = this.sparks.filter((p) => {
      p.age += dt;
      p.v.y -= dt * 4;
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.scale.setScalar(Math.max(0.001, 1 - p.age / 0.6));
      if (p.age < 0.6) return true;
      this.scene.remove(p.mesh);
      return false;
    });
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'burrito',
  title: 'Blanket Burrito',
  how: 'Roll yourself up in the giant blanket by moving your phone round in circles. Faster wraps quicker, but spin too fast for too long and you get dizzy and lose a layer. Most layers wins!',
  controller: 'spin',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const rollers = seats.map(() => newRoller());
    const skill = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : 0.5));
    const cpus: CpuSpinner[] = seats.map((_, i) => newCpuSpinner(skill[i] ?? 0.5, rng));
    const speed = seats.map(() => 0);
    const view = new BedroomView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'spin', note: 'Circle your phone to roll up. Too fast for too long makes you dizzy!' }));
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'spin' && seat < n && !session.isCpu(seat)) speed[seat] = msg.speed;
    });

    let hudAt = -1;
    let fwumpAt = -1;
    ui.caption('Circle your phone to roll up in the blanket. Not too fast!');
    await everyFrame(clock, (dt, t) => {
      rollers.forEach((r, i) => {
        const s = session.isCpu(i) ? cpuSpin(cpus[i] as CpuSpinner, r, skill[i] ?? 0.5, rng, Math.min(dt, 0.5)) : (speed[i] ?? 0);
        const lane = view.lanes[i];
        // Lie still for a while and you doze off; start rolling again and you perk up.
        if (lane) {
          lane.idle = s < 0.1 ? lane.idle + dt : 0;
          if (r.dizzy === 0) view.mood(i, lane.idle > 2 ? 'sleeping' : 'happy');
        }
        for (let left = Math.min(dt, 0.6); left > 1e-9; left -= 0.05) {
          for (const e of stepRoller(r, s, Math.min(0.05, left))) {
            if (e === 'layer') {
              if (t - fwumpAt > 0.12) {
                fwumpAt = t;
                fwump(sfx, wholeLayers(r));
              }
              if (!session.isCpu(i)) session.send(i, { t: 'buzz', pattern: [10] });
            } else if (e === 'warn') {
              if (!session.isCpu(i)) session.send(i, { t: 'feedback', good: false, text: 'Easy… your head’s starting to spin' });
            } else if (e === 'dizzy') {
              woozy(sfx);
              view.say(i, 'Too dizzy!', '#ffe066');
              view.mood(i, 'sad');
              if (!session.isCpu(i)) {
                session.send(i, { t: 'feedback', good: false, text: 'Too dizzy! Your burrito came loose.' });
                session.send(i, { t: 'buzz', pattern: [80, 50, 80] });
              }
            } else {
              view.mood(i, 'happy');
              if (!session.isCpu(i)) session.send(i, { t: 'feedback', good: true, text: 'Steady again. Keep rolling!' });
            }
          }
        }
        view.show(i, r.layers, r.dizzy > 0, dt);
      });
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(BURRITO.duration - t);
        ui.live(
          seats.map((s, i) => {
            const r = rollers[i] as Roller;
            const w = wholeLayers(r);
            return { name: s.name, color: s.color, thumb: s.thumb, value: r.dizzy > 0 ? 'Dizzy!' : `${w} layer${w === 1 ? '' : 's'}` };
          }),
        );
      }
      return t >= BURRITO.duration;
    });
    off();
    ui.timer(null);
    const scores = burritoScores(rollers);
    const best = Math.max(...scores);
    rollers.forEach((r, i) => {
      view.show(i, r.layers, false, 1);
      view.mood(i, scores[i] === best ? 'happy' : 'sleeping');
    });
    const winners = seats.filter((_, i) => scores[i] === best);
    ui.caption(winners.length === 1 ? `${winners[0]?.name} is the snuggest burrito!` : 'Snug as anything, all of you.', winners.length === 1 ? winners[0]?.color : undefined);
    await clock.wait(1.6);
    ui.caption(null);
    return { scores, details: rollers.map(burritoDetail) };
  },
};
