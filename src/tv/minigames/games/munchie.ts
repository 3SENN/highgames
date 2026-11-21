// Munchie Catch on the TV: a lazy picnic in the garden at golden hour, where little clouds rain snacks. Everyone balances a bowl in
// their colour on their head and shuffles left and right in their own lane to catch them.
import * as THREE from 'three';
import {
  type Bowl,
  type CpuBowl,
  type Drop,
  MUNCHIE,
  type SnackKind,
  cpuStick,
  dropY,
  landsAt,
  makeDrops,
  munchieScores,
  newBowl,
  newCpuBowl,
  resolveDrop,
  stepBowl,
} from '../../../game/minigames/munchie';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cloud, cyl, dome, gem, mix, part, popSprite, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.5; // companion height: the bowl rests just above the head
const BOWL_R = 0.6;

// ------------------------------------------------------------------ sounds

/** A short crunchy burst (a chip being caught). */
function crunch(sfx: Sfx, bright: number): void {
  const a = sfx.audio;
  if (!a) return;
  const ctx = a.ctx;
  const dur = 0.07;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800 + bright * 1400;
  filter.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.value = 0.35;
  src.connect(filter).connect(g).connect(a.out);
  src.start();
}

// ------------------------------------------------------------------ snacks

const CHIP = mix(P.mustard, '#f6dc8c', 0.45);
const COOKIE = mix(P.oak, P.clay, 0.3);
const DOUGH = mix(P.oak, P.mustard, 0.35);
const PRETZEL = mix(P.mahogany, P.oak, 0.35);

function snackMesh(kind: SnackKind): THREE.Group {
  const g = new THREE.Group();
  const bit = { outline: false as const, shadow: false };
  switch (kind) {
    case 'chip':
      // A curled crisp with a few specks of seasoning.
      part(g, sphere(0.3, 16), CHIP, 0, 0, 0, { sx: 1, sy: 0.8, sz: 0.18, gloss: 0.2 });
      part(g, torus(0.2, 0.012), mix(CHIP, P.walnut, 0.3), 0, 0, 0.05, { sy: 0.8, ...bit });
      for (const [x, y] of [[0.08, 0.05], [-0.1, -0.06], [0.02, -0.13], [-0.05, 0.12]] as [number, number][]) part(g, ball(0.02, 0), P.brick, x, y, 0.055, bit);
      break;
    case 'cookie':
    case 'golden': {
      const gold = kind === 'golden';
      part(g, cyl(0.3, 0.28, 0.1, 22), gold ? P.lamp : COOKIE, 0, 0, 0, { rx: Math.PI / 2, ...(gold ? { glow: 0.9 } : { tex: 'sand', texScale: 0.5, texStrength: 0.5 }) });
      const chips: [number, number][] = [[-0.12, 0.08], [0.1, 0.12], [0.03, -0.1], [-0.1, -0.1], [0.15, -0.03], [0, 0.02]];
      for (const [x, y] of chips) part(g, ball(0.045, 1), gold ? P.brass : P.walnut, x, y, 0.055, { ...bit, gloss: 0.4 });
      if (gold) {
        part(g, torus(0.4, 0.018), P.lamp, 0, 0, 0, { glow: 2, ...bit });
        part(g, gem(0.11), P.cream, 0.3, 0.28, 0.1, { glow: 2, ...bit });
        part(g, gem(0.07), P.cream, -0.34, -0.2, 0.1, { glow: 2, ...bit });
      }
      break;
    }
    case 'donut':
      part(g, torus(0.2, 0.1), DOUGH, 0, 0, 0, { gloss: 0.15 });
      part(g, torus(0.2, 0.085), P.rose, 0, 0, 0.04, { outline: false, gloss: 0.6 });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        part(g, box(0.03, 0.08, 0.03), [P.cream, P.teal, P.mustard][k % 3] as string, Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.12, { rz: a * 2, ...bit });
      }
      break;
    case 'pretzel':
      part(g, torus(0.24, 0.05, Math.PI), PRETZEL, 0, 0.02, 0, { rz: Math.PI, gloss: 0.35 });
      part(g, torus(0.13, 0.05), PRETZEL, -0.11, 0.06, 0, { gloss: 0.35 });
      part(g, torus(0.13, 0.05), PRETZEL, 0.11, 0.06, 0, { gloss: 0.35 });
      for (const [x, y] of [[-0.18, 0.12], [0.16, 0.16], [0, -0.2], [0.2, -0.05], [-0.2, -0.04], [0.04, 0.18]] as [number, number][]) part(g, box(0.035, 0.035, 0.035), P.cream, x, y, 0.05, { rz: x * 9, ...bit });
      break;
    case 'broccoli':
      part(g, cyl(0.07, 0.1, 0.32, 10), mix(P.moss, P.cream, 0.4), 0, -0.16, 0);
      for (const [x, y, r] of [[0, 0.1, 0.17], [-0.15, 0.02, 0.13], [0.15, 0.02, 0.13], [-0.07, 0.2, 0.12], [0.08, 0.21, 0.12]] as [number, number, number][]) {
        part(g, ball(r), mix(x === 0 ? P.leaf : P.fern, P.cream, 0.22), x, y, 0, { tex: 'grass', texScale: 0.3, texStrength: 0.5 });
      }
      break;
  }
  return g;
}

const CRUMB: Record<SnackKind, string> = { chip: CHIP, cookie: COOKIE, donut: P.rose, pretzel: PRETZEL, golden: P.lamp, broccoli: P.fern };

interface Falling {
  drop: Drop;
  lane: number;
  mesh: THREE.Group;
  state: 'falling' | 'dropped' | 'tossed';
  /** Seconds in the current state (dropped / tossed). */
  t: number;
  vx: number;
  vy: number;
}

interface Lane {
  x: number;
  companion: Companion;
  bowl: THREE.Group;
  pile: THREE.Group;
  cloud: THREE.Group;
  jiggle: number;
  /** 1 … 0 after a catch: the bowl squashes and settles. */
  squash: number;
  turn: number;
  walking: boolean;
}

interface Pop {
  sprite: THREE.Sprite;
  age: number;
}

interface Spark {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  life: number;
}

class Picnic implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly lanes: Lane[] = [];
  private falling: Falling[] = [];
  private pops: Pop[] = [];
  private words = new Map<string, THREE.Sprite>();
  private sparks: Spark[] = [];
  private nextSpark = 0;
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private readonly fit = new CameraFit(this.camera, 0.03);
  private readonly half: number;
  /** Seconds since the minigame started (drop times count from there, not from the game clock). */
  now = 0;

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    const n = seats.length;
    this.half = (n * MUNCHIE.lane) / 2;
    this.env = backyard(this.scene, { mood: 'golden', w: n * MUNCHIE.lane + 10, d: 11, clear: { w: n * MUNCHIE.lane + 1.5, d: 4.5 }, seed: 4 });
    const rand = seeded(17);
    const set = new THREE.Group();
    // Lazy clouds far behind, catching the low sun.
    const clouds = props.cloudBank({ n: 9, area: [90, 8, 12], scale: 2.4, color: '#f6dcc4', speed: 0.3, seed: 8 });
    clouds.position.set(0, 8.5, -46);
    set.add(clouds);

    seats.forEach((s, i) => {
      const x = (i - (n - 1) / 2) * MUNCHIE.lane;
      // A gingham picnic blanket marks the lane: the player's colour mixed down, with a trim in the full colour.
      const rugC = mix(s.color, P.cream, 0.4);
      part(set, rbox(MUNCHIE.lane - 0.3, 0.04, 2.5, 0.015), rugC, x, 0.02, 0.05, { tex: 'gingham', texScale: 1.1, outline: false, shadow: false });
      for (const dz of [-1.2, 1.3]) part(set, box(MUNCHIE.lane - 0.3, 0.045, 0.09), s.color, x, 0.022, dz, { outline: false, shadow: false });
      const c = companions[i] as Companion;
      c.root.position.set(x, 0.04, 0);
      c.setBase('happy');
      this.scene.add(c.root);
      // The bowl, rim at catch height, resting on the head: glazed, in the player's colour.
      const bowl = new THREE.Group();
      bowl.position.set(x, MUNCHIE.catchY, 0);
      part(bowl, dome(BOWL_R), s.color, 0, 0, 0, { rx: Math.PI, sy: 0.55, gloss: 0.5 });
      part(bowl, torus(BOWL_R, 0.06), P.ceramic, 0, 0, 0, { rx: Math.PI / 2, gloss: 0.5 });
      part(bowl, torus(BOWL_R * 0.78, 0.022), mix(s.color, P.ink, 0.3), 0, -0.16, 0, { rx: Math.PI / 2, outline: false, shadow: false });
      part(bowl, cyl(0.2, 0.16, 0.06, 16), P.ceramic, 0, -0.34, 0, { outline: false, gloss: 0.5 });
      const pile = new THREE.Group();
      bowl.add(pile);
      this.scene.add(bowl);
      // A little snack cloud over the lane, with a hint of the player's colour.
      const sc = cloud(rand, 0.55, mix(P.cream, s.color, 0.14));
      sc.position.set(x, MUNCHIE.top + 0.35, -0.3);
      this.scene.add(sc);
      this.lanes.push({ x, companion: c, bowl, pile, cloud: sc, jiggle: 0, squash: 0, turn: 0, walking: false });
    });
    // Low wooden posts between the lanes and at both ends, with a rope slung between them.
    for (let k = 0; k <= n; k++) {
      const px = (k - n / 2) * MUNCHIE.lane;
      part(set, rbox(0.16, 0.9, 0.16, 0.04), P.oak, px, 0.45, -1.35, { tex: 'planks', texScale: 0.8 });
      part(set, rbox(0.22, 0.08, 0.22, 0.03), P.walnut, px, 0.93, -1.35, { outline: false });
      if (k < n) set.add(props.stringLights(new THREE.Vector3(px, 0.86, -1.35), new THREE.Vector3(px + MUNCHIE.lane, 0.86, -1.35), { sag: 0.14, count: 5, colors: [P.ceramic], bulb: 0.035 }));
    }
    // A wicker picnic basket, a blanket with drinks and fruit, and a parasol for the mood.
    const bx = this.half + 1.5;
    part(set, rbox(1.1, 0.6, 0.8, 0.1), P.oak, bx, 0.3, -0.7, { tex: 'knit', texScale: 0.4 });
    part(set, torus(0.45, 0.05, Math.PI), P.walnut, bx, 0.6, -0.7, { tex: 'leather' });
    part(set, rbox(1.14, 0.12, 0.84, 0.05), P.terracotta, bx, 0.56, -0.7, { tex: 'gingham', texScale: 0.5, outline: false });
    const put = (o: THREE.Object3D, x: number, y: number, z: number, scale = 1, ry = 0) => {
      o.position.set(x, y, z);
      o.scale.setScalar(scale);
      o.rotation.y = ry;
      set.add(o);
    };
    put(props.blanket({ w: 1.9, d: 1.9, color: P.teal, stripes: P.cream }), bx + 0.4, 0, 1.2, 1, 0.3);
    put(props.snackBowl({ fill: 'fruit', color: P.ceramic }), bx + 0.2, 0.03, 1.2, 1.8);
    put(props.drink({ kind: 'bottle', color: P.forest }), bx + 0.9, 0.03, 0.9, 1.6);
    put(props.parasol({ colors: [P.terracotta, P.cream], h: 2.8, r: 1.5 }), bx + 1.3, 0, -0.4, 1, 0.5);
    put(props.pouf({ color: P.mustard }), -this.half - 1.5, 0, 0.9, 1.3);
    put(props.crate({ s: 0.6 }), -this.half - 1.7, 0, -0.8, 1, 0.3);
    put(props.plant({ kind: 'fern', h: 0.7, pot: P.terracotta }), -this.half - 1.7, 0.6, -0.8);
    this.scene.add(set);
    this.tick = props.tickProps(set);

    // Sparkles for golden cookies.
    for (let k = 0; k < 12; k++) {
      const mesh = part(this.scene, gem(0.11), P.lamp, 0, 0, 0, { glow: 2.2, outline: false, shadow: false });
      mesh.visible = false;
      this.sparks.push({ mesh, v: new THREE.Vector3(), life: 0 });
    }
    this.env.sun.target.position.set(0, 2, 0);
    this.frame();
  }

  /** The lanes from the grass up to the snack clouds, clear of the HUD. */
  private frame(): void {
    this.fit.update(() => {
      const marks: Mark[] = [];
      for (const side of [-1, 1]) {
        marks.push({ p: new THREE.Vector3(side * this.half, 0, 1.3) }, { p: new THREE.Vector3(side * this.half, MUNCHIE.top + 1.1, 0) });
      }
      return marks;
    });
  }

  /** A snack starts falling out of a lane's cloud. */
  spawn(drop: Drop, lane: number): void {
    const l = this.lanes[lane];
    if (!l) return;
    const mesh = snackMesh(drop.kind);
    mesh.position.set(l.x + drop.x, MUNCHIE.top, 0);
    mesh.rotation.z = Math.random() * Math.PI;
    this.scene.add(mesh);
    this.falling.push({ drop, lane, mesh, state: 'falling', t: 0, vx: 0, vy: 0 });
  }

  /** A drop reached a lane's bowl: into the pile, bounced out (broccoli), or on to the grass. */
  land(drop: Drop, lane: number, points: number): void {
    const f = this.falling.find((x) => x.drop === drop && x.lane === lane && x.state === 'falling');
    const l = this.lanes[lane];
    if (!f || !l) return;
    if (points === 0) {
      f.state = 'dropped';
      return;
    }
    l.jiggle = 1;
    l.squash = 1;
    if (drop.kind === 'golden') this.sparkle(l.bowl.position);
    if (drop.kind === 'broccoli') {
      f.state = 'tossed';
      f.vx = (Math.random() < 0.5 ? -1 : 1) * 2.5;
      f.vy = 5;
      return;
    }
    this.scene.remove(f.mesh);
    this.falling = this.falling.filter((x) => x !== f);
    // A crumb in the bowl to show the haul (only so many fit).
    if (l.pile.children.length < 9) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.32;
      part(l.pile, ball(0.13, 1), CRUMB[drop.kind], Math.cos(a) * r, -0.12 + l.pile.children.length * 0.012, Math.sin(a) * r * 0.6, { outline: false, ...(drop.kind === 'golden' ? { glow: 0.8 } : {}) });
    }
  }

  /** A ring of sparkles flying out of a bowl. */
  private sparkle(at: THREE.Vector3): void {
    for (let k = 0; k < 6; k++) {
      const s = this.sparks[this.nextSpark++ % this.sparks.length] as Spark;
      const a = (k / 6) * Math.PI + 0.26;
      s.mesh.visible = true;
      s.mesh.position.set(at.x, at.y + 0.1, at.z + 0.3);
      s.v.set(Math.cos(a) * 2.6, 2 + Math.sin(a) * 2.4, 0);
      s.life = 0.6;
    }
  }

  /** Floating points over a bowl. The words are drawn once and shared; each pop gets its own fading material. */
  pop(lane: number, text: string, color: string): void {
    const l = this.lanes[lane];
    if (!l) return;
    const key = `${text}|${color}`;
    let base = this.words.get(key);
    if (!base) {
      base = popSprite(text, color, 0.75);
      this.words.set(key, base);
    }
    const sprite = new THREE.Sprite(base.material.clone());
    sprite.scale.copy(base.scale);
    sprite.renderOrder = base.renderOrder;
    sprite.position.set(l.bowl.position.x, MUNCHIE.catchY + 0.9, 0.4);
    this.scene.add(sprite);
    this.pops.push({ sprite, age: 0 });
  }

  /** Moves a lane's companion and bowl to the bowl's position; `vx` drives the shuffle. */
  place(lane: number, b: Bowl, t: number): void {
    const l = this.lanes[lane];
    if (!l) return;
    const x = l.x + b.x;
    l.companion.root.position.x = x;
    const walking = Math.abs(b.vx) > 0.4;
    if (walking !== l.walking) {
      l.walking = walking;
      l.companion.move(walking ? 'walk' : null, Math.abs(b.vx));
    }
    l.turn += (THREE.MathUtils.clamp(b.vx * 0.09, -0.45, 0.45) - l.turn) * 0.2;
    l.companion.root.rotation.y = l.turn;
    const bob = walking ? Math.abs(Math.sin(t * 10)) * 0.05 : 0;
    l.bowl.position.set(x, MUNCHIE.catchY + bob + Math.sin(l.jiggle * 18) * l.jiggle * 0.06, 0);
    l.bowl.rotation.z = -b.vx * 0.03 + Math.sin(l.jiggle * 20) * l.jiggle * 0.15;
    const q = Math.sin(l.squash * Math.PI) * 0.12;
    l.bowl.scale.set(1 + q, 1 - q, 1 + q);
  }

  /** Nudges each lane's cloud toward where its next snack will fall. */
  aimClouds(nextX: number | null, dt: number): void {
    for (const l of this.lanes) {
      const target = l.x + (nextX ?? 0) * 0.6;
      l.cloud.position.x += (target - l.cloud.position.x) * Math.min(1, dt * 3);
    }
  }

  dispose(): void {
    for (const l of this.lanes) l.companion.dispose();
    for (const p of this.pops) p.sprite.material.dispose();
    for (const w of this.words.values()) {
      w.material.map?.dispose();
      w.material.dispose();
    }
  }

  update(dt: number, time: number): void {
    this.frame();
    this.env.update(dt, time);
    this.tick(dt, time);
    this.lanes.forEach((l, i) => {
      l.companion.update(dt);
      l.jiggle = Math.max(0, l.jiggle - dt * 2.5);
      l.squash = Math.max(0, l.squash - dt * 4);
      l.cloud.position.y = MUNCHIE.top + 0.35 + Math.sin(time * 1.3 + i * 1.9) * 0.07;
    });
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.v.y -= 6 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.y += dt * 10;
      s.mesh.scale.setScalar(Math.max(0.01, s.life / 0.6));
      if (s.life <= 0) s.mesh.visible = false;
    }
    this.falling = this.falling.filter((f) => {
      if (f.state === 'falling') {
        f.mesh.position.y = dropY(f.drop, this.now);
        f.mesh.rotation.z += dt * (f.drop.kind === 'broccoli' ? 4 : 1.5);
        f.mesh.rotation.y = Math.sin(time * 2 + f.drop.at) * 0.5;
        return true;
      }
      f.t += dt;
      if (f.state === 'tossed') {
        f.vy -= 14 * dt;
        f.mesh.position.x += f.vx * dt;
        f.mesh.position.y += f.vy * dt;
        f.mesh.rotation.z += dt * 10;
      } else {
        // Keeps falling, then plops on the grass and fades away.
        f.mesh.position.y = Math.max(0.25, f.mesh.position.y - f.drop.speed * dt);
      }
      const gone = f.state === 'tossed' ? f.mesh.position.y < -1 : f.t > 1.2;
      if (gone) this.scene.remove(f.mesh);
      else if (f.state === 'dropped' && f.mesh.position.y <= 0.25) f.mesh.scale.setScalar(Math.max(0.01, 1 - (f.t - 0.6) * 1.7));
      return !gone;
    });
    this.pops = this.pops.filter((p) => {
      p.age += dt;
      p.sprite.position.y += dt * 0.9;
      p.sprite.material.opacity = Math.min(1, 3 * (1 - p.age / 0.9));
      if (p.age < 0.9) return true;
      this.scene.remove(p.sprite);
      p.sprite.material.dispose();
      return false;
    });
  }
}

export const minigame: Minigame = {
  id: 'munchie',
  title: 'Munchie Catch',
  how: 'Snacks are raining down: slide left and right to catch them in your bowl, golden cookies are worth 3. Dodge the broccoli (it costs 2), and the most points wins!',
  controller: 'stick',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const drops = makeDrops(rng);
    const bowls = seats.map(() => newBowl());
    const cpus = seats.map(() => newCpuBowl());
    const skill = seats.map(() => ctx.skill());
    const stick = seats.map(() => 0);
    const view = new Picnic(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'stick', button: null, note: 'Slide left and right to catch snacks. Dodge the broccoli!' }));
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'stick' && seat < n && !session.isCpu(seat)) stick[seat] = msg.x;
    });

    let spawned = 0;
    let landed = 0;
    let hudAt = -1;
    ui.caption('Slide to catch the snacks. Dodge the broccoli!');
    await everyFrame(clock, (dt, t) => {
      view.now = t;
      while (spawned < drops.length && (drops[spawned] as Drop).at <= t) {
        for (let i = 0; i < n; i++) view.spawn(drops[spawned] as Drop, i);
        spawned++;
      }
      const upcoming = drops[spawned];
      view.aimClouds(upcoming && upcoming.at - t < 0.6 ? upcoming.x : null, dt);
      bowls.forEach((b, i) => {
        const s = session.isCpu(i) ? cpuStick(cpus[i] as CpuBowl, b, drops, t, dt, skill[i] ?? 0.5, rng) : (stick[i] ?? 0);
        stepBowl(b, s, dt);
        view.place(i, b, t);
      });
      while (landed < drops.length && landsAt(drops[landed] as Drop) <= t) {
        const d = drops[landed] as Drop;
        let anyCatch = false;
        let anyGreen = false;
        bowls.forEach((b, i) => {
          const points = resolveDrop(b, d);
          view.land(d, i, points);
          if (points === 0) return;
          const seat = seats[i] as MinigameSeat;
          const c = view.lanes[i]?.companion;
          if (d.kind === 'broccoli') {
            anyGreen = true;
            view.pop(i, `${points}`, P.rose);
            c?.react('sad', 1.4);
            session.send(i, { t: 'buzz', pattern: [120] });
          } else {
            anyCatch = true;
            view.pop(i, `+${points}`, d.kind === 'golden' ? P.lamp : seat.color);
            c?.react(d.kind === 'golden' ? 'happy' : 'approval', d.kind === 'golden' ? 1.4 : 0.6);
            session.send(i, { t: 'buzz', pattern: d.kind === 'golden' ? [20, 40, 20] : [12] });
          }
        });
        if (anyGreen) sfx.bad();
        else if (anyCatch && d.kind === 'golden') sfx.ring(true);
        else if (anyCatch) crunch(sfx, Math.random());
        landed++;
      }
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(MUNCHIE.duration - t);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${bowls[i]?.score ?? 0} pts` })));
      }
      return t >= MUNCHIE.duration;
    });
    off();
    ui.timer(null);
    ui.caption(null);
    const best = Math.max(...bowls.map((b) => b.score));
    bowls.forEach((b, i) => {
      view.lanes[i]?.companion.move(null);
      if (b.score === best) view.lanes[i]?.companion.react('happy', 3);
    });
    return {
      scores: munchieScores(bowls),
      details: bowls.map((b) => [`${b.score} pts`, `${b.snacks} snack${b.snacks === 1 ? '' : 's'}`, ...(b.goldens ? [`${b.goldens} golden`] : []), ...(b.greens ? [`${b.greens} broccoli`] : [])].join(' · ')),
    };
  },
};
