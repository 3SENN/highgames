// Blanket Tug on the TV: a chilly living room on a snowy night with one giant fuzzy blanket stretched across the
// floor. The solo player holds one rolled-up end, the three the other; a strip of tape marks the middle line and
// a star patch marks the blanket's middle. Seen from the sofa, a little from above.
import * as THREE from 'three';
import { TUG, type Puller, type Side, cpuHear, cpuPump, newPuller, newTug, pumpTug, sideOf, stepTug, tugScores } from '../../../game/minigames/blankettug';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cyl, gem, material, mix, part, pill, rbox, seeded, sphere, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.4;
const LENGTH = 3.8; // the blanket, along the tug
const DEPTH = 2.0; // and across
const SEGMENTS = 12; // the blanket is built in strips, so it can ripple
const HANDS = 0.68; // how high the rolled ends are held
const SOLO_AT = LENGTH / 2 + 1.15; // the solo player's distance from the blanket's middle
const TEAM_AT = LENGTH / 2 + 1.05; // the first of the three
const TEAM_GAP = 0.78;
const TEAM_Z = [0.3, -0.28, 0.3];
const WOOL = P.terracotta;
const STRIPE = P.cream;
const FLAKES = 36;
const ROOM = 1.3; // the room is built at life size and scaled up a little for the stubby companions
const BACK = -3.7; // the back wall
const WINDOW = { x: -3.51, y: 2.535, w: 1.75, h: 1.9 }; // the pane of the room's window, where the snow falls

interface Rig {
  c: Companion;
  side: Side;
  /** Where this player stands, from the blanket's middle. */
  offset: THREE.Vector3;
  yaw: number;
  lean: number;
  shiver: boolean;
}

/** The blanket: knitted strips with a cream check, a fringe of tassels, a star-and-moon patch in the middle. */
function blanket(strips: THREE.Group[]): THREE.Group {
  const g = new THREE.Group();
  const w = LENGTH / SEGMENTS;
  const knit = { tex: 'knit' as const, texScale: 0.7 };
  withOutline(0.02, () => {
    for (let i = 0; i < SEGMENTS; i++) {
      const s = new THREE.Group();
      s.position.x = -LENGTH / 2 + w * (i + 0.5);
      const end = i === 0 || i === SEGMENTS - 1;
      // Alternate strips are a shade deeper: a patchwork of knitted squares.
      part(s, rbox(w + 0.02, 0.1, DEPTH, 0.04), i % 2 ? WOOL : mix(WOOL, P.mahogany, 0.22), 0, 0.06, 0, { ...knit, outline: end ? 0.02 : false });
      for (const z of [-0.62, 0, 0.62]) part(s, box(w + 0.02, 0.014, 0.09), STRIPE, 0, 0.112, z, { ...knit, outline: false, shadow: false });
      if (i % 3 === 1) part(s, box(0.09, 0.014, DEPTH - 0.06), STRIPE, 0, 0.114, 0, { ...knit, outline: false, shadow: false });
      for (const z of [-DEPTH / 2 - 0.05, DEPTH / 2 + 0.05]) {
        part(s, ball(0.05, 1), mix(WOOL, P.cream, 0.45), -w * 0.22, 0.05, z, { outline: false });
        part(s, ball(0.05, 1), mix(WOOL, P.cream, 0.3), w * 0.22, 0.05, z, { outline: false });
      }
      g.add(s);
      strips.push(s);
    }
    // The middle: a night-blue patch with a moon and stars, glowing a little so it is easy to follow.
    const mid = strips[SEGMENTS / 2 - 1];
    if (mid) {
      const patch = new THREE.Group();
      patch.position.x = w / 2;
      part(patch, cyl(0.47, 0.47, 0.03, 36), P.brass, 0, 0.12, 0, { glow: 0.35, outline: false });
      part(patch, cyl(0.41, 0.41, 0.04, 36), P.midnight, 0, 0.13, 0, { glow: 0.1, outline: false });
      part(patch, cyl(0.16, 0.16, 0.02, 24), P.lamp, -0.08, 0.16, 0.02, { glow: 1.3, outline: false });
      part(patch, cyl(0.13, 0.13, 0.022, 24), P.midnight, -0.02, 0.17, -0.02, { glow: 0.1, outline: false });
      for (const [x, z] of [
        [0.18, -0.18],
        [0.22, 0.12],
        [-0.15, 0.24],
        [0.05, -0.28],
      ] as const) {
        part(patch, gem(0.035), P.lamp, x, 0.16, z, { glow: 1.6, sy: 0.4 });
      }
      mid.add(patch);
    }
  });
  return g;
}

/** A rolled-up end of the blanket, from the edge of the blanket up into the hands and along to `reach`. */
function rolledEnd(g: THREE.Group, dir: 1 | -1, reach: number): void {
  const x0 = (dir * LENGTH) / 2;
  const up = 0.9;
  const knit = { tex: 'knit' as const, texScale: 0.7 };
  // A capsule stands along +y: tip it over toward this end, up into the hands.
  part(g, pill(0.15, Math.hypot(up, HANDS - 0.1)), WOOL, x0 + (dir * up) / 2, (HANDS + 0.1) / 2, 0, { rz: -dir * Math.atan2(up, HANDS - 0.1), ...knit });
  if (reach > up) part(g, pill(0.14, reach - up), mix(WOOL, P.cream, 0.1), x0 + dir * (up + (reach - up) / 2), HANDS, 0, { rz: Math.PI / 2, ...knit });
  part(g, sphere(0.2, 16), mix(WOOL, P.mahogany, 0.22), x0 + dir * up, HANDS, 0, knit);
}

class LoungeView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly rigs: Rig[] = [];
  readonly floaters: Floaters;
  private readonly fit: CameraFit;
  private readonly marks: Mark[];
  private readonly cloth = new THREE.Group();
  private readonly strips: THREE.Group[] = [];
  private readonly halo: THREE.Mesh;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly flakes: THREE.Mesh[] = [];
  private env!: Env;
  private tick: (dt: number, time: number) => void = () => undefined;
  private sparks: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private readonly steam: THREE.Mesh[] = [];
  private puffs: { m: THREE.Mesh; age: number; dx: number }[] = [];
  private ripple = 0;
  private rippleFrom = 1;
  glow = 0;
  pos = 0;

  constructor(seats: MinigameSeat[], companions: Companion[], solo: number, team: readonly number[]) {
    this.floaters = new Floaters(this.scene);
    this.buildRoom(seats, solo, team);

    this.cloth.add(blanket(this.strips));
    rolledEnd(this.cloth, -1, SOLO_AT - LENGTH / 2);
    rolledEnd(this.cloth, 1, TEAM_AT - LENGTH / 2 + TEAM_GAP * (team.length - 1) + 0.25);
    this.scene.add(this.cloth);

    // The three's glow when they pull together: a warm halo on the floor round them.
    this.haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(1.3), transparent: true, opacity: 0, depthWrite: false });
    this.halo = new THREE.Mesh(cyl(1, 1, 0.01, 40), this.haloMat);
    this.halo.scale.set(TEAM_GAP * team.length * 0.75 + 0.6, 1, 1.05);
    this.scene.add(this.halo);

    seats.forEach((_, i) => {
      const c = companions[i] as Companion;
      const side: Side | null = i === solo ? 'solo' : team.includes(i) ? 'team' : null;
      if (!side) return;
      c.root.rotation.order = 'YXZ';
      const k = team.indexOf(i);
      const offset = side === 'solo' ? new THREE.Vector3(-SOLO_AT, 0, 0.12) : new THREE.Vector3(TEAM_AT + k * TEAM_GAP, 0, TEAM_Z[k % TEAM_Z.length] ?? 0);
      const yaw = side === 'solo' ? Math.PI / 2 - 0.4 : -Math.PI / 2 + 0.4;
      c.setBase('working');
      this.scene.add(c.root);
      this.rigs[i] = { c, side, offset, yaw, lean: 0, shiver: false };
    });

    // The whole tug, from one end of the room to the other, wherever the blanket goes.
    const far = TUG.win + 0.4;
    const right = far + TEAM_AT + TEAM_GAP * Math.max(0, team.length - 1) + 0.4;
    const left = -far - SOLO_AT - 0.4;
    this.marks = [
      ...[left, right].flatMap((x) => [
        { p: new THREE.Vector3(x, 0, 0.6), pad: 0.04 },
        { p: new THREE.Vector3(x, HEIGHT + 0.25, 0), pad: 0.06 },
      ]),
      { p: new THREE.Vector3(0, 0, 2.6), pad: 0.04 },
      { p: new THREE.Vector3(0, 0, -2.3), pad: 0.02 },
    ];
    this.fit = new CameraFit(this.camera, 0.5);
    this.setPos(0);
  }

  private buildRoom(seats: MinigameSeat[], solo: number, team: readonly number[]): void {
    const s = this.scene;
    const rand = seeded(7);
    // The living room late on a snowy night: lights low and blue, one warm lamp left on.
    this.env = livingRoom(s, { mood: 'night', w: 14.2, d: 5.7, h: 3.4, rug: false, accent: P.denim, wall: mix(P.duskWall, P.denim, 0.35), seed: 2 });
    this.env.root.scale.setScalar(ROOM);
    for (const l of this.env.lamps) {
      l.intensity *= 2.4;
      l.distance *= 1.7;
    }
    const set = new THREE.Group();
    s.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = ROOM) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    // A long woollen runner under the tug.
    put(props.rug({ w: 12.4, d: 4.9, color: mix(P.slate, P.denim, 0.45), border: mix(P.slate, P.cream, 0.35), tex: 'terry' }), 0.6, 0, 0.1, 0, 1);

    // The middle line in tape, and how far each side has to drag the middle: the solo's mark, the three's mark.
    const tape = { outline: false as const, shadow: false };
    const y = 0.035;
    part(s, box(0.1, 0.012, 4.5), P.cream, 0, y, 0.1, { ...tape, opacity: 0.85 });
    const soloColor = seats[solo]?.color ?? '#ffffff';
    for (const k of [-1, 1]) {
      part(s, box(0.1, 0.012, 4.5), mix(P.cream, P.aubergine, 0.35), k * TUG.win, y, 0.1, tape);
      for (let d = 0; d < 6; d++) part(s, box(0.1, 0.013, 0.36), P.cream, k * TUG.win, y, -1.9 + d * 0.8, tape);
    }
    part(s, cyl(0.17, 0.17, 0.03, 20), soloColor, -TUG.win, y + 0.01, 2.5, { glow: 1.1, outline: false, shadow: false });
    team.forEach((t, k) => part(s, cyl(0.12, 0.12, 0.03, 16), seats[t]?.color ?? '#ffffff', TUG.win + (k - (team.length - 1) / 2) * 0.3, y + 0.01, 2.5, { glow: 1.1, outline: false, shadow: false }));

    // Snow falling outside the window, frost in its corners; a radiator below it, stone cold.
    const flake = material(P.cream, { basic: true });
    for (let k = 0; k < FLAKES; k++) {
      this.flakes.push(part(s, sphere(0.022 + (k % 3) * 0.008, 6), P.cream, WINDOW.x + (rand() - 0.5) * WINDOW.w, WINDOW.y + (rand() - 0.5) * WINDOW.h, BACK + 0.05, { material: flake, shadow: false }));
    }
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) part(s, sphere(0.2, 10), P.moon, WINDOW.x + sx * (WINDOW.w / 2 - 0.02), WINDOW.y + sy * (WINDOW.h / 2 - 0.02), BACK + 0.04, { sz: 0.1, opacity: 0.4, outline: false, shadow: false });
    }
    const rad = mix(P.ceramic, P.slate, 0.15);
    part(s, rbox(2.2, 0.05, 0.26, 0.02), rad, WINDOW.x, 1.0, BACK + 0.24, { outline: false, gloss: 0.4 });
    for (let k = 0; k < 10; k++) part(s, rbox(0.14, 0.72, 0.2, 0.05), rad, WINDOW.x - 0.9 + k * 0.2, 0.6, BACK + 0.24, { outline: k === 0 || k === 9 ? 0.02 : false, gloss: 0.4 });
    part(s, cyl(0.03, 0.03, 0.5, 8), P.brass, WINDOW.x + 1.12, 0.35, BACK + 0.24, { outline: false, gloss: 0.6 });

    // A sofa under the pictures, a second lamp beside it, cocoa going cold on a little table.
    put(props.sofa({ seats: 3, color: P.denim, pillows: [P.mustard, P.cream, P.terracotta] }), 1.9, 0, BACK + 0.85, 0, 1.55);
    put(props.blanket({ w: 0.9, d: 0.6, color: P.mauve, tex: 'knit' }), 2.9, 0.95, BACK + 1.0, 0.3, 1.2);
    put(props.floorLamp({ h: 1.8, light: 16 }), 5.1, 0, BACK + 0.9, 0, 1.5);
    put(props.sideTable({ h: 0.55, r: 0.3 }), -6.0, 0, BACK + 1.2, 0, 1.4);
    [-6.14, -5.86].forEach((x, k) => {
      put(props.mug({ color: k ? P.teal : P.terracotta, r: 0.05 }), x, 0.55 * 1.4, BACK + 1.2, k * 2, 1.6);
      for (let j = 0; j < 2; j++) this.steam.push(part(s, sphere(0.05, 8), P.cream, x, 1.0 + j * 0.2, BACK + 1.2, { opacity: 0.3, outline: false, shadow: false }));
    });
    // Up front: a basket of spare (too small) blankets and a pair of slippers.
    const basket = new THREE.Group();
    part(basket, cyl(0.42, 0.34, 0.5, 20), P.oak, 0, 0.25, 0, { tex: 'planks', texScale: 0.5 });
    part(basket, sphere(0.36, 14), P.mustard, -0.05, 0.5, 0, { sy: 0.45, tex: 'knit' });
    part(basket, sphere(0.26, 14), P.teal, 0.14, 0.58, 0.08, { sy: 0.5, tex: 'knit' });
    put(basket, -7.4, 0, 3.0, 0.3, 1.2);
    for (const k of [0, 1]) part(set, sphere(0.14, 10), P.rose, 7.2 + k * 0.34, 0.07, 3.3 - k * 0.1, { sy: 0.5, sz: 1.7, ry: 0.3 + k * 0.25, tex: 'velvet' });
    // An armchair and a low table pushed out of the way, seen from behind.
    put(props.armchair({ color: P.sage, pillow: P.cream }), 6.3, 0, 3.75, Math.PI - 0.5, 1.5);
    put(props.coffeeTable({ w: 1.2, d: 0.6, h: 0.38 }), 2.6, 0, 4.0, 0.12, 1.4);
    put(props.books(0.3, 3, { h: 0.2 }), 2.2, 0.38 * 1.4, 4.0, 0.4, 1.4);
    put(props.candle({ h: 0.12 }), 3.0, 0.38 * 1.4, 3.95, 0, 1.8);
    put(props.pouf({ color: P.rose, r: 0.34 }), -3.4, 0, 3.9, 0, 1.4);
    this.tick = props.tickProps(set);
  }

  /** The blanket is won: a shower of warm sparks from its middle. */
  celebrate(): void {
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2 + Math.random();
      const m = part(this.scene, gem(0.05), P.lamp, this.pos, 0.4, 0, { glow: 2, outline: false, shadow: false });
      this.sparks.push({ m, v: new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 1.5), 2.4 + Math.random() * 1.6, Math.sin(a) * (0.6 + Math.random())), age: 0 });
    }
  }

  /** Moves the blanket (and everyone holding it) so its middle is at `pos`. */
  setPos(pos: number): void {
    this.pos = pos;
    this.cloth.position.x = pos;
    for (const r of this.rigs) {
      if (!r) continue;
      r.c.root.position.set(pos + r.offset.x, 0, r.offset.z);
    }
    const n = this.rigs.filter((r) => r?.side === 'team').length;
    this.halo.position.set(pos + TEAM_AT + (TEAM_GAP * Math.max(0, n - 1)) / 2, 0.05, 0);
  }

  /** A pump: that player leans back, the blanket ripples from their end, a puff of cold breath. */
  pull(seat: number, power: number): void {
    const r = this.rigs[seat];
    if (!r) return;
    r.lean = Math.min(0.45, r.lean + 0.18 + power * 0.18);
    this.ripple = Math.min(1, this.ripple + 0.25 + power * 0.2);
    this.rippleFrom = r.side === 'team' ? 1 : -1;
    const head = r.c.root.position;
    const puff = part(this.scene, sphere(0.07, 8), P.cream, head.x + (r.side === 'solo' ? 0.25 : -0.25), HEIGHT * 0.85, head.z + 0.15, { opacity: 0.45, outline: false, shadow: false });
    this.puffs.push({ m: puff, age: 0, dx: r.side === 'solo' ? 0.3 : -0.3 });
  }

  shiverAll(side: Side): void {
    for (const r of this.rigs) if (r && r.side === side) r.shiver = true;
  }

  dispose(): void {
    for (const r of this.rigs) r?.c.dispose();
    for (const p of this.puffs) p.m.removeFromParent();
    for (const k of this.sparks) k.m.removeFromParent();
    this.floaters.dispose();
    this.haloMat.dispose();
  }

  update(dt: number, time: number): void {
    this.fit.update(() => this.marks);
    this.env.update(dt, time);
    this.tick(dt, time);
    this.sparks = this.sparks.filter((k) => {
      k.age += dt;
      k.v.y -= dt * 6;
      k.m.position.addScaledVector(k.v, dt);
      k.m.rotation.y += dt * 6;
      k.m.scale.setScalar(Math.max(0.01, 1 - k.age / 1.0));
      if (k.age < 1.0 && k.m.position.y > 0.03) return true;
      k.m.removeFromParent();
      return false;
    });
    for (const r of this.rigs) {
      if (!r) continue;
      r.c.update(dt);
      r.lean *= Math.exp(-dt * 5);
      r.c.root.rotation.set(-r.lean - 0.06, r.yaw, r.shiver ? Math.sin(time * 45) * 0.05 : 0);
    }
    // A ripple runs along the blanket from the end that just pulled.
    this.ripple *= Math.exp(-dt * 2.5);
    this.strips.forEach((s, i) => {
      const x = (i / (SEGMENTS - 1)) * 2 - 1;
      s.position.y = Math.max(0, Math.sin(x * 4 * this.rippleFrom - time * 12)) * this.ripple * 0.12;
    });
    this.glow *= Math.exp(-dt * 2.2);
    this.haloMat.opacity = Math.min(0.55, this.glow * 0.55);
    this.halo.visible = this.glow > 0.02;
    this.puffs = this.puffs.filter((p) => {
      p.age += dt;
      p.m.position.y += dt * 0.5;
      p.m.position.x += p.dx * dt;
      p.m.scale.setScalar(1 + p.age * 2.5);
      if (p.age < 0.6) return true;
      p.m.removeFromParent();
      return false;
    });
    this.flakes.forEach((f, i) => {
      f.position.y -= dt * (0.3 + (i % 5) * 0.06);
      f.position.x += Math.sin(time * 1.3 + i) * dt * 0.08;
      if (f.position.y < WINDOW.y - WINDOW.h / 2) f.position.y = WINDOW.y + WINDOW.h / 2;
    });
    this.steam.forEach((m, i) => {
      const k = (time * 0.4 + i * 0.5) % 1;
      m.position.y = 0.95 + k * 0.45;
      m.scale.setScalar((0.6 + k * 0.9) * Math.sin(k * Math.PI));
    });
    this.floaters.update(dt);
  }
}

const swish = (sfx: Sfx, solo: boolean) => noise(sfx, { dur: 0.13, filter: 'bandpass', freq: solo ? 800 : 1400, to: solo ? 380 : 650, gain: solo ? 0.14 : 0.08 });

export const minigame: Minigame = {
  id: 'blankettug',
  title: 'Blanket Tug',
  how: 'A cold night and one giant fuzzy blanket. Pump your phone to pull: the one on their own pulls three times as hard, the three get a little extra for pumping together. Drag the blanket’s middle 2 m past the line to win it, or be ahead when time runs out.',
  controller: 'pump',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const [soloSide, three] = teamsOf(ctx);
    const solo = soloSide?.[0] ?? 0;
    const team = three?.length ? three : seats.map((_, i) => i).filter((i) => i !== solo);
    const idx = seats.map((s) => s.index);
    const posOf = new Map(idx.map((s, i) => [s, i] as const));
    const tug = newTug(seats.length, solo, team);
    const view = new LoungeView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), solo, team);
    ctx.stage.setView(view);
    const isCpu = (i: number) => session.isCpu(idx[i] ?? i);
    const send = (i: number, msg: Parameters<typeof session.send>[1]) => {
      if (!isCpu(i)) session.send(idx[i] ?? i, msg);
    };
    const brains = new Map<number, Puller>();
    for (const i of [solo, ...team]) if (isCpu(i)) brains.set(i, newPuller(ctx.skill(), rng, i !== solo));
    // A phone that drops out mid-game: the computer takes over its seat.
    const brainOf = (i: number): Puller => {
      let b = brains.get(i);
      if (!b) brains.set(i, (b = newPuller(0.5, rng, i !== solo)));
      return b;
    };
    const soloName = seats[solo]?.name ?? 'The one on their own';

    session.setLayoutAll((seat) => {
      const i = posOf.get(seat.index) ?? -1;
      return i === solo ? { kind: 'pump', label: 'On your own · 3× pull', redline: false } : { kind: 'pump', label: 'Team of three · pull together', redline: false };
    });
    send(solo, { t: 'feedback', good: true, text: 'You hold one end on your own: every pump pulls three times as hard!' });
    for (const i of team) send(i, { t: 'feedback', good: true, text: `You pull with your team against ${soloName}. Pump together for a little extra!` });

    let lastSound = 0;
    let lastCheer = -9;
    const lastNote = seats.map(() => -9);
    const pump = (i: number, power: number, at: number) => {
      const side = sideOf(tug, i);
      if (!side || tug.winner !== null) return;
      const res = pumpTug(tug, i, power, at);
      if (res.pull <= 0) return;
      view.pull(i, power);
      if (clock.time - lastSound > 0.05) {
        lastSound = clock.time;
        swish(sfx, side === 'solo');
      }
      if (side === 'team') {
        // Computer teammates fall in with whoever pumps.
        for (const m of team) if (m !== i && isCpu(m)) cpuHear(tug, brainOf(m), at, rng);
        if (res.sync > 0) {
          const was = view.glow;
          view.glow = Math.min(1, view.glow + 0.22 * res.sync);
          if (was < 0.5 && view.glow >= 0.5 && clock.time - lastCheer > 2.5) {
            lastCheer = clock.time;
            view.floaters.add('In sync!', P.lamp, new THREE.Vector3(view.pos + TEAM_AT + TEAM_GAP, HEIGHT + 0.7, 0), 0.5);
            tone(sfx, { freq: 784, to: 1046, dur: 0.18, gain: 0.06 });
            for (const m of team) {
              if (clock.time - (lastNote[m] ?? -9) < 3) continue;
              lastNote[m] = clock.time;
              send(m, { t: 'feedback', good: true, text: 'In sync! A little extra pull.' });
            }
          }
        }
      }
    };
    const off = session.onInput((seat, msg) => {
      const i = posOf.get(seat);
      if (i === undefined || msg.t !== 'pump' || session.isCpu(seat)) return;
      // Judge the pump when it was made: half the phone's round trip ago.
      const lag = (Math.min(200, session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed;
      pump(i, msg.power, tug.time - lag);
    });

    ui.caption(`${soloName} against the three for the only blanket. Pump to pull!`, seats[solo]?.color);
    let hudAt = 0;
    await everyFrame(clock, (dt) => {
      for (const i of [solo, ...team]) {
        if (!isCpu(i)) continue;
        const power = cpuPump(tug, brainOf(i), rng);
        if (power !== null) pump(i, power, tug.time);
      }
      stepTug(tug, dt);
      view.setPos(tug.pos);
      if (clock.time - hudAt > 0.1) {
        hudAt = clock.time;
        ui.timer(TUG.duration - tug.time);
        for (const i of [solo, ...team]) {
          const ahead = (i === solo ? -tug.pos : tug.pos) / TUG.win;
          send(i, { t: 'meter', value: Math.max(0, Math.min(1, 0.5 + ahead / 2)), danger: false });
        }
        ui.live(
          seats.map((s, i) => {
            const n = tug.pumps[i] ?? 0;
            const value = i === solo ? `On their own · ${n} pulls` : `${n} pulls`;
            return { name: s.name, color: s.color, thumb: s.thumb, value };
          }),
        );
      }
      return tug.winner !== null;
    });
    off();
    ui.timer(null);

    // The end: the winners pull the blanket over to themselves and get cosy; the others shiver.
    const winner = tug.winner;
    const winners = winner === 'solo' ? [solo] : winner === 'team' ? team : [];
    const losers = winner === 'solo' ? team : winner === 'team' ? [solo] : [];
    for (const i of winners) view.rigs[i]?.c.setBase('happy');
    for (const i of losers) view.rigs[i]?.c.setBase('sad');
    if (winner === 'solo' || winner === 'team') view.shiverAll(winner === 'solo' ? 'team' : 'solo');
    if (winner === 'solo' || winner === 'team') view.celebrate();
    if (winner === 'solo') {
      sfx.fanfare();
      ui.caption(`${soloName} wins the blanket. Toasty!`, seats[solo]?.color);
    } else if (winner === 'team') {
      sfx.win();
      ui.caption('The three win the blanket. Room for everyone… almost.');
    } else {
      sfx.good();
      ui.caption('Dead even. Fine, everyone shares.');
    }
    for (const i of seats.keys()) send(i, { t: 'buzz', pattern: [40, 30, 120] });
    const from = tug.pos;
    const to = winner === 'solo' ? from - 1.2 : winner === 'team' ? from + 1.2 : from;
    await clock.tween(0.9, (k) => view.setPos(from + (to - from) * k));
    for (const i of winners) view.rigs[i]?.c.setBase('sleeping');
    await clock.wait(1.2);
    ui.caption(null);

    const how = winner === 'draw' ? 'Dead even' : tug.time < TUG.duration - 0.01 ? `in ${tug.time.toFixed(1)} s` : `by ${Math.abs(from).toFixed(2)} m`;
    return {
      scores: tugScores(tug, seats.length),
      details: seats.map((_, i) => {
        const side = sideOf(tug, i);
        if (!side) return '';
        const n = tug.pumps[i] ?? 0;
        if (winner === 'draw') return `${how} · ${n} pulls`;
        return winner === side ? `Won the blanket ${how} · ${n} pulls` : `Lost the blanket · ${n} pulls`;
      }),
    };
  },
};
