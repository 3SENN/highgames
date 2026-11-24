// Beanbag Breakout on the TV: four giant beanbags in a cosy lounge at dusk. Everyone is sunk in up to the ears;
// pumping wiggles you up and out while the beanbag slowly swallows you back down.
import * as THREE from 'three';
import { COUCH, couchDetail, couchScores, isComfy, newSinker, stepSinker, wiggle } from '../../../game/minigames/beanbag';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, gem, mix, part, popSprite, rbox, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const CAM_POS = new THREE.Vector3(-0.9, 5.6, 12.6); // a little left of centre: the live score list covers the left edge
const CAM_LOOK = new THREE.Vector3(-0.9, 1.55, 0);
const HEIGHT = 1.35; // companion height
const SPACING = 3.3; // between beanbags
const SUNK_Y = 0.55; // rider height when buried (only the head pokes out)
const OUT_Y = 1.2; // rider height when nearly out
const STAND_Z = 1.75; // where riders land when they pop out
const ROOM = 1.8; // the furnished room's scale: these companions and beanbags are giants

interface Bag {
  group: THREE.Group;
  /** The squishy part, squashed and stretched by the wiggles. */
  body: THREE.Group;
  rider: Companion;
  zzz: THREE.Sprite;
  /** How far out, 0..1. */
  out: number;
  squash: number;
  squashV: number;
  lean: number;
  popped: boolean;
}

/** A soft lowpass thump: a beanbag being wiggled. */
function squish(sfx: Sfx, pitch: number): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  const t0 = ctx.currentTime;
  const len = Math.ceil(ctx.sampleRate * 0.16);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(300 + pitch * 500, t0);
  filter.frequency.exponentialRampToValueAtTime(120, t0 + 0.16);
  const g = ctx.createGain();
  g.gain.value = 0.35;
  src.connect(filter).connect(g).connect(out);
  src.start(t0);
}

/** Scales a furnished room up to the game's size (companions here are bigger than a metre), lamps included. */
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

interface Spark {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  age: number;
}

class LoungeView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly bags: Bag[] = [];
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private pops: { sprite: THREE.Sprite; age: number }[] = [];
  private hops: ((dt: number) => boolean)[] = [];
  private sparks: Spark[] = [];

  constructor(seats: MinigameSeat[], riders: Companion[]) {
    // An evening lounge: lamps on, dusk in the window. The room is built at 1 m scale and blown up to suit
    // the giant beanbags.
    this.env = livingRoom(this.scene, { mood: 'evening', w: 11, d: 5.6, h: 3.9, rug: false, dress: 0.5, accent: P.mauve, seed: 3 });
    scaleRoom(this.env, ROOM, 11);
    const dressing = new THREE.Group();
    this.buildRoom(dressing);
    this.scene.add(dressing);
    this.tick = props.tickProps(dressing);

    seats.forEach((s, i) => {
      const group = new THREE.Group();
      group.position.set((i - (seats.length - 1) / 2) * SPACING, 0, 0);
      const body = new THREE.Group();
      // The fabric is the seat colour taken down a step; the piping and the tag carry it at full strength.
      const fabric = mix(s.color, P.aubergine, 0.36);
      const light = mix(fabric, P.cream, 0.14);
      const velvet = { tex: 'velvet' as const, texStrength: 0.85, texScale: 1.6 };
      withOutline(0.04, () => {
        // A big squashed blob with a slumped back rest and a seam round its middle.
        part(body, sphere(1.25, 32), fabric, 0, 0.62, 0, { ...velvet, sx: 1.18, sy: 0.6, sz: 1.08 });
        part(body, sphere(0.95, 28), light, 0, 1.12, -0.55, { ...velvet, sx: 1.25, sy: 0.95, sz: 0.62 });
      });
      part(body, torus(1.3, 0.04), s.color, 0, 0.62, 0, { rx: Math.PI / 2, sz: 0.9, sx: 1.12, outline: false, exact: true });
      part(body, sphere(0.1, 12), mix(fabric, P.ink, 0.3), 0, 1.98, -0.6, { sy: 0.5, outline: false });
      part(body, rbox(0.3, 0.2, 0.04, 0.03), P.cream, 0.62, 0.55, 1.18, { ry: 0.45, rz: -0.12, outline: false });
      // A soft ring of light on the rug in the seat's colour.
      part(group, torus(1.75, 0.035), s.color, 0, 0.06, 0.05, { rx: Math.PI / 2, sz: 0.9, glow: 1.2, outline: false, shadow: false });
      group.add(body);
      const rider = riders[i] as Companion;
      rider.root.position.set(0, SUNK_Y, 0.2);
      rider.setBase('working');
      group.add(rider.root);
      const zzz = popSprite('z z z', P.moon, 0.42);
      zzz.position.set(0.7, 2.3, 0.3);
      zzz.visible = false;
      group.add(zzz);
      this.scene.add(group);
      this.bags.push({ group, body, rider, zzz, out: 0, squash: 0, squashV: 0, lean: 0, popped: false });
    });

    this.fit();
  }

  /** The game's own dressing, on top of the furnished room: the rug, snacks within reach, things in the corners. */
  private buildRoom(s: THREE.Group): void {
    const put = (o: THREE.Object3D, x: number, z: number, ry = 0, k = ROOM, y = 0): THREE.Object3D => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.multiplyScalar(k);
      s.add(o);
      return o;
    };
    // A big oval rug under the beanbags.
    const rug = props.rug({ w: 17.4, round: true, color: P.terracotta, border: P.sand });
    rug.scale.set(1, 1, 0.47);
    put(rug, 0, 0.5, 0, 1);

    // Left: pizza boxes and a bowl of crisps on the floor.
    put(props.pizzaBox(), -7.7, 1.4, 0.2, 2.2);
    put(props.pizzaBox({ open: true, slices: 3 }), -7.6, 1.45, -0.1, 2.2, 0.11);
    put(props.snackBowl({ fill: 'crisps', color: P.teal }), -6.5, 3.1, 0, 2.4);
    put(props.drink({ color: P.mustard }), -5.5, 3.6, 0, 3.6);

    // Right: a side table with a lamp, a mug going cold, cans, the remote nobody can find.
    put(props.sideTable({ color: P.walnut }), 8.0, -1.9);
    put(props.tableLamp({ light: 9, stand: P.brass }), 8.0, -1.9, 0, ROOM, 0.5 * ROOM);
    put(props.mug({ color: P.rose }), 8.35, -1.6, 0.8, ROOM, 0.5 * ROOM);
    put(props.drink({ color: P.terracotta }), 4.1, 3.5, 0, 3.6);
    put(props.drink({ color: P.sage }), 4.65, 3.2, 0, 3.6);
    put(props.remote(), 2.7, 3.5, 0.6, 2.4);
    put(props.snackBowl({ fill: 'popcorn', color: P.ceramic }), -2.3, 3.4, 0, 2.2);

    // Foreground: a big plant leaning into the bottom right corner.
    put(props.plant({ kind: 'monstera', h: 1.1, pot: P.terracotta, seed: 8 }), 5.6, 4.0, 0.5, ROOM);
    // Dust in the lamp light.
    put(props.motes({ n: 26, area: [16, 4, 7], size: 0.07 }), 0, -0.5, 0, 1, 1);
  }

  /** The rider's position for a progress of 0..1 (only while still in the beanbag). */
  setOut(i: number, k: number): void {
    const b = this.bags[i];
    if (!b || b.popped) return;
    b.out = k;
    b.rider.root.position.y = SUNK_Y + (OUT_Y - SUNK_Y) * k;
  }

  kick(i: number, power: number): void {
    const b = this.bags[i];
    if (!b) return;
    b.squashV += 0.8 + power * 0.7;
    b.lean = b.lean > 0 ? -0.16 : 0.16;
  }

  setComfy(i: number, comfy: boolean): void {
    const b = this.bags[i];
    if (b) b.zzz.visible = comfy && !b.popped;
  }

  /** Hops the rider out of the beanbag onto the rug. */
  popOut(i: number, color: string): void {
    const b = this.bags[i];
    if (!b || b.popped) return;
    b.popped = true;
    b.zzz.visible = false;
    b.squashV += 2;
    b.rider.setBase('happy');
    const from = b.rider.root.position.clone();
    let t = 0;
    const hop = (dt: number) => {
      t = Math.min(1, t + dt / 0.55);
      b.rider.root.position.set(0, from.y * (1 - t) + Math.sin(t * Math.PI) * 1.6, from.z + (STAND_Z - from.z) * t);
      return t >= 1;
    };
    this.hops.push(hop);
    const s = popSprite('Up!', color, 0.8);
    s.position.set(b.group.position.x, 3.4, STAND_Z);
    this.scene.add(s);
    this.pops.push({ sprite: s, age: 0 });
    // A puff of sparkles in the seat's colour.
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const mesh = part(this.scene, gem(0.09), k % 2 ? color : P.lamp, b.group.position.x, 1.5, 0.4, { glow: 1.6, shadow: false });
      this.sparks.push({ mesh, v: new THREE.Vector3(Math.cos(a) * 2.6, 3.2 + (k % 3) * 0.8, Math.sin(a) * 1.4 + 0.8), age: 0 });
    }
  }

  dispose(): void {
    for (const b of this.bags) b.rider.dispose();
  }

  private fittedFor = 0;
  /** Pulls the camera back on screens narrower than 16:9, so every beanbag stays in the picture. */
  private fit(): void {
    if (this.camera.aspect === this.fittedFor) return;
    this.fittedFor = this.camera.aspect;
    const back = Math.max(1, 16 / 9 / this.camera.aspect);
    this.camera.position.copy(CAM_LOOK).addScaledVector(CAM_POS.clone().sub(CAM_LOOK), back);
    this.camera.lookAt(CAM_LOOK);
  }

  update(dt: number, time: number): void {
    this.fit();
    this.hops = this.hops.filter((h) => !h(dt));
    for (const b of this.bags) {
      b.rider.update(dt);
      // A damped spring: wiggles squash the beanbag down, it wobbles back. It puffs up as it lets go.
      // Stepped at 120 Hz: the spring is stiff, and one big step (a slow frame, a fast playtest) would blow it up.
      for (let left = dt; left > 0; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        b.squashV += (-b.squash * 120 - b.squashV * 10) * h;
        b.squash += b.squashV * h;
      }
      b.body.scale.set(1 + b.squash * 0.6, (b.popped ? 1.02 : 0.92 + b.out * 0.1) - b.squash, 1 + b.squash * 0.6);
      b.lean *= Math.exp(-dt * 5);
      b.rider.root.rotation.z = b.popped ? 0 : b.lean;
      if (b.zzz.visible) b.zzz.position.y = 2.3 + Math.sin(time * 2 + b.group.position.x) * 0.12;
    }
    this.env.update(dt, time);
    this.tick(dt, time);
    // Lamps breathe a few percent.
    this.env.lamps.forEach((l, i) => {
      l.userData.base ??= l.intensity;
      l.intensity = (l.userData.base as number) * (1 + Math.sin(time * 1.7 + i * 2.1) * 0.03);
    });
    this.sparks = this.sparks.filter((p) => {
      p.age += dt;
      p.v.y -= dt * 7;
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.rotation.y += dt * 6;
      p.mesh.scale.setScalar(Math.max(0.001, 1 - p.age / 0.8));
      if (p.age < 0.8) return true;
      this.scene.remove(p.mesh);
      return false;
    });
    for (const p of this.pops) {
      p.age += dt;
      p.sprite.position.y += dt * 0.6;
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - Math.max(0, p.age - 1) / 0.6);
    }
  }
}

export const minigame: Minigame = {
  id: 'beanbag',
  title: 'Beanbag Breakout',
  how: 'You sank way too deep into a giant beanbag. Pump your phone to wiggle up and out while it slowly swallows you back: first one standing wins!',
  controller: 'pump',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const sinkers = seats.map(() => newSinker());
    const view = new LoungeView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'pump', label: 'Wiggle out', redline: false }));
    const skill = seats.map(() => ctx.skill());
    const cpuNext = seats.map(() => 0.2 + rng() * 0.4);
    const cpuNapUntil = seats.map(() => 0);
    const comfy = seats.map(() => false);
    let lastSquish = 0;
    let now = 0;

    const doWiggle = (seat: number, power: number) => {
      const s = sinkers[seat];
      if (!s || s.finishedAt !== null || now <= 0) return;
      const gain = wiggle(s, power, now);
      view.kick(seat, power);
      if (now - lastSquish > 0.07) {
        lastSquish = now;
        squish(sfx, gain / COUCH.perPump);
      }
      if (s.finishedAt !== null) {
        view.popOut(seat, seats[seat]?.color ?? '#fff');
        sfx.good();
        session.send(seat, { t: 'buzz', pattern: [60, 40, 140] });
        session.send(seat, { t: 'feedback', good: true, text: 'You’re up! Stretch it out.' });
      }
    };
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'pump' && !session.isCpu(seat)) doWiggle(seat, msg.power);
    });

    let hudAt = 0;
    let firstOut = false;
    ui.caption('Pump to wiggle out of your beanbag!');
    await everyFrame(clock, (dt, t) => {
      now = t;
      sinkers.forEach((s, i) => {
        const sk = skill[i] ?? 0.5;
        if (session.isCpu(i) && s.finishedAt === null && t >= (cpuNext[i] ?? 0)) {
          if (t < (cpuNapUntil[i] ?? 0)) {
            cpuNext[i] = cpuNapUntil[i] ?? t;
          } else if (rng() < (1 - sk) * 0.035) {
            // Lost in thought for a moment. It happens.
            cpuNapUntil[i] = t + 1.2 + rng() * 1.6;
          } else {
            doWiggle(i, 0.55 + sk * 0.3 + rng() * 0.1);
            cpuNext[i] = t + 1 / (2.4 + sk * 1.4) + (rng() - 0.5) * 0.08;
          }
        }
        stepSinker(s, dt, t);
        view.setOut(i, s.out / COUCH.goal);
        const c = isComfy(s, t);
        if (c !== comfy[i]) {
          comfy[i] = c;
          view.setComfy(i, c);
          const rider = view.bags[i]?.rider;
          if (s.finishedAt === null) rider?.setBase(c ? 'sleeping' : 'working');
          if (!session.isCpu(i) && s.finishedAt === null && t > 1) {
            session.send(i, c ? { t: 'feedback', good: false, text: 'Too comfy! Wiggle!' } : { t: 'feedback', good: true, text: 'Wiggle wiggle…' });
          }
        }
        if (!firstOut && s.finishedAt !== null) {
          firstOut = true;
          ui.caption(`${seats[i]?.name ?? 'Someone'} is up! Keep wiggling, everyone else…`, seats[i]?.color);
        }
      });
      if (t - hudAt > 0.1) {
        hudAt = t;
        sinkers.forEach((s, i) => {
          if (!session.isCpu(i)) session.send(i, { t: 'meter', value: s.out / COUCH.goal, danger: false });
        });
        ui.timer(COUCH.duration - t);
        ui.live(
          seats.map((s, i) => {
            const k = sinkers[i];
            return { name: s.name, color: s.color, thumb: s.thumb, value: k?.finishedAt != null ? 'Up!' : `${Math.round(((k?.out ?? 0) / COUCH.goal) * 100)}%` };
          }),
        );
      }
      return t >= COUCH.duration || sinkers.every((s) => s.finishedAt !== null);
    });
    off();
    ui.timer(null);
    sinkers.forEach((s, i) => {
      view.setComfy(i, false);
      if (s.finishedAt === null) view.bags[i]?.rider.react('sad', 2.5);
    });
    ui.caption(firstOut ? 'Up and about!' : 'Nobody made it out. Five more minutes…');
    await clock.wait(1.4);
    ui.caption(null);
    return { scores: couchScores(sinkers), details: sinkers.map(couchDetail) };
  },
};
