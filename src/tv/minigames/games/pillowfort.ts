// Pillow Fort on the TV: a lazy afternoon in the living room. Two teams stack pillow towers side by side, each
// partner tossing on a pillow in turn. Pillows take the colour of whoever placed them, so a well-shared fort comes
// out striped.
import * as THREE from 'three';
import { PILLOW, cpuDoubles, cpuPillowGap, fortScore, newFort, pillowScores, pressPillow, stepFort, whoseTurn } from '../../../game/minigames/pillowfort';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, cone, cyl, material, mix, nameCard, part, popSprite, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameContext, type MinigameSeat, everyFrame } from '../types';

const SIDE = 4.3; // each team's tower stands this far left or right of the middle
const SPREAD = 1.7; // partners stand this far either side of their tower
const PW = 1.0; // a pillow: width, height, depth
const PH = 0.3;
const PD = 0.48;
const HEIGHT = 1.5; // companions
const HANDS = 1.0;
const FLY = 0.3; // seconds a tossed pillow is in the air
const LOOSE_MAX = 10; // tumbled pillows left lying around per team
const TILT = 0.27; // the camera looks down this much (radians)
const SAFE_Y = 0.8; // keep everything that matters inside this much of the frame (the HUD bars sit outside)
const SAFE_X = 0.94;
const ROOM = 2.2; // the room is this much bigger than life: a fort-builder's view of the living room
/** The live score list sits on the left of the screen: marks stay right of it (normalised screen units). */
const SAFE_LEFT = 0.56;

// ------------------------------------------------------------------ helpers

/** Each side's seat positions (indexes into ctx.seats), from ctx.teams or, without it, the seats split in two. */
function teamsOf(ctx: MinigameContext): number[][] {
  const pos = new Map(ctx.seats.map((s, i) => [s.index, i] as const));
  const given = (ctx.teams ?? []).map((t) => t.map((s) => pos.get(s)).filter((p): p is number => p !== undefined)).filter((t) => t.length > 0);
  if (given.length >= 2) return given.slice(0, 2);
  const all = ctx.seats.map((_, i) => i);
  const half = Math.ceil(all.length / 2);
  return [all.slice(0, half), all.slice(half)].filter((t) => t.length > 0);
}

interface Mark {
  p: THREE.Vector3;
  /** Extra room in normalised screen units (for labels that keep their size on screen). */
  pad?: number;
}

/** The closest camera, looking down by `tilt`, that keeps every mark in the safe middle of the frame. */
function frameMarks(probe: THREE.PerspectiveCamera, marks: readonly Mark[], tilt: number): { pos: THREE.Vector3; look: THREE.Vector3 } {
  const look = new THREE.Vector3();
  let low = Infinity;
  let high = -Infinity;
  for (const m of marks) {
    look.x += m.p.x / marks.length;
    look.z += m.p.z / marks.length;
    low = Math.min(low, m.p.y);
    high = Math.max(high, m.p.y);
  }
  const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
  const tan = Math.tan(THREE.MathUtils.degToRad(probe.fov / 2));
  const v = new THREE.Vector3();
  const place = (dist: number) => {
    probe.position.copy(look).addScaledVector(dir, dist);
    probe.lookAt(look);
    probe.updateMatrixWorld();
  };
  const extent = () => {
    let lo = Infinity;
    let hi = -Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (const m of marks) {
      v.copy(m.p).project(probe);
      lo = Math.min(lo, v.y - (m.pad ?? 0));
      hi = Math.max(hi, v.y + (m.pad ?? 0));
      left = Math.min(left, v.x);
      right = Math.max(right, v.x);
    }
    return { lo, hi, left, right };
  };
  // At a given distance, slide the camera until the marks sit in the middle of the free part of the frame
  // (vertically the middle, horizontally between the score list and the right edge).
  const midX = (SAFE_X - SAFE_LEFT) / 2;
  const settle = (dist: number) => {
    look.y = (low + high) / 2;
    for (let k = 0; k < 4; k++) {
      place(dist);
      const e = extent();
      look.y += ((e.hi + e.lo) / 2) * dist * tan;
      look.x += ((e.right + e.left) / 2 - midX) * dist * tan * probe.aspect;
    }
    place(dist);
    return extent();
  };
  let near = 3;
  let far = 90;
  for (let i = 0; i < 22; i++) {
    const mid = (near + far) / 2;
    const e = settle(mid);
    if (e.hi <= SAFE_Y && e.lo >= -SAFE_Y && e.left >= -SAFE_LEFT && e.right <= SAFE_X) far = mid;
    else near = mid;
  }
  settle(far);
  return { pos: probe.position.clone(), look: look.clone() };
}

/** Floating words ("+1", "Tallest fort!") that drift up and fade. */
class Floaters {
  private list: { s: THREE.Sprite; age: number; life: number }[] = [];
  constructor(private readonly scene: THREE.Scene) {}

  add(text: string, color: string, at: THREE.Vector3, height = 0.5, life = 1.1): void {
    const s = popSprite(text, color, height);
    s.position.copy(at);
    this.scene.add(s);
    this.list.push({ s, age: 0, life });
  }

  update(dt: number): void {
    this.list = this.list.filter((f) => {
      f.age += dt;
      const k = f.age / f.life;
      f.s.position.y += dt * 0.7 * (1 - k);
      f.s.material.opacity = Math.min(1, 3 * (1 - k));
      if (k < 1) return true;
      this.drop(f.s);
      return false;
    });
  }

  dispose(): void {
    for (const f of this.list) this.drop(f.s);
    this.list = [];
  }

  private drop(s: THREE.Sprite): void {
    this.scene.remove(s);
    s.material.map?.dispose();
    s.material.dispose();
  }
}

/** A soft thump: a pillow landing. Higher up the tower, a slightly higher pitch. */
function thump(sfx: Sfx, pitch = 1): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(190 * pitch, t0);
  osc.frequency.exponentialRampToValueAtTime(70 * pitch, t0 + 0.14);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.22);
}

/** A wibbly-wobbly warble: the fort sways. */
function warble(sfx: Sfx): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(300, t0);
  osc.frequency.exponentialRampToValueAtTime(200, t0 + 0.4);
  lfo.frequency.value = 9;
  depth.gain.value = 28;
  lfo.connect(depth).connect(osc.frequency);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
  osc.connect(g).connect(out);
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + 0.45);
  lfo.stop(t0 + 0.45);
}

// ------------------------------------------------------------------ the scene

function pillow(color: string, knit: boolean): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(PW, PH, PD, 0.13), color, 0, 0, 0, { tex: knit ? 'knit' : 'fabric', texScale: 0.6 });
  // Piping round the seam, and a button in the middle of each face.
  part(g, rbox(PW + 0.02, 0.04, PD + 0.02, 0.02), mix(color, P.cream, 0.55), 0, 0, 0, { outline: false, shadow: false });
  for (const side of [-1, 1]) part(g, sphere(0.035, 8), mix(color, P.ink, 0.3), 0, side * (PH / 2 - 0.005), 0, { outline: false, shadow: false, sy: 0.5 });
  return g;
}

interface Stacked {
  mesh: THREE.Group;
  age: number;
  from: THREE.Vector3;
}

interface Loose {
  mesh: THREE.Group;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
}

interface Tower {
  x: number;
  color: string;
  phase: number;
  pillows: Stacked[];
  loose: Loose[];
  flag: THREE.Group;
  label: THREE.Sprite | null;
  shown: number;
  wobble: number;
  goal: number;
  jolt: number;
  top: number;
  sway: number;
  /** Seat positions of the partners, in member order. */
  members: number[];
  due: number | null;
}

interface Member {
  companion: Companion;
  x: number;
  /** Towards the tower: +1 or -1. */
  dir: number;
  color: string;
  ring: THREE.Mesh;
  arrow: THREE.Mesh;
}

class FortView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly towers: Tower[] = [];
  /** By seat position. */
  readonly members: (Member | undefined)[] = [];
  private readonly companions: Companion[];
  private readonly floaters: Floaters;
  private readonly probe = new THREE.PerspectiveCamera();
  private readonly target = new THREE.Vector3();
  private fitKey = '';
  private goal = { pos: new THREE.Vector3(0, 6, 14), look: new THREE.Vector3(0, 2, 0) };
  private look = new THREE.Vector3();
  private placed = false;
  private time = 0;
  private rand = seeded(23);
  private readonly env: Env;
  private tick: (dt: number, time: number) => void = () => {};

  constructor(seats: MinigameSeat[], teams: number[][], companions: Companion[]) {
    this.companions = companions;
    this.floaters = new Floaters(this.scene);
    // The living room in the evening, lamps on. Everything is big: this is a fort-builder's view of it.
    this.env = livingRoom(this.scene, { mood: 'evening', w: 13.8, d: 5.8, h: 6.8, rug: false, accent: P.rose, seed: 2 });
    this.env.root.scale.setScalar(ROOM);
    this.env.root.position.z = 1.4;
    for (const l of this.env.lamps) {
      l.intensity *= 4.5;
      l.distance *= ROOM;
    }
    const sc = this.env.sun.shadow.camera;
    sc.left = sc.bottom = -12;
    sc.right = sc.top = 12;
    sc.updateProjectionMatrix();
    this.room();

    teams.forEach((members, team) => {
      const x = (team === 0 ? -1 : 1) * (teams.length > 1 ? SIDE : 0);
      const lead = seats[members[0] ?? 0];
      const color = lead?.color ?? '#ffd166';
      const tower: Tower = {
        x,
        color,
        phase: team * 1.7,
        pillows: [],
        loose: [],
        flag: new THREE.Group(),
        label: null,
        shown: -1,
        wobble: 0,
        goal: 0,
        jolt: 0,
        top: 0,
        sway: 0,
        members,
        due: null,
      };
      // The team's rug (their colour, mixed down, with a bright edge), and a pennant that rides on top of the fort.
      part(this.scene, cyl(2.85, 2.85, 0.04, 48), mix(color, P.aubergine, 0.66), x, 0.02, 0.05, { tex: 'terry', outline: false, shadow: false });
      part(this.scene, cyl(2.3, 2.3, 0.04, 48), mix(color, P.aubergine, 0.56), x, 0.026, 0.05, { tex: 'terry', outline: false, shadow: false });
      part(this.scene, torus(2.82, 0.045), color, x, 0.045, 0.05, { rx: Math.PI / 2, outline: false, shadow: false, glow: 0.5 });
      part(tower.flag, cyl(0.025, 0.025, 0.85, 8), P.walnut, 0, 0.42, 0, { outline: false });
      part(tower.flag, cone(0.2, 0.42, 3), color, 0.21, 0.72, 0, { rz: -Math.PI / 2, sz: 0.35 });
      part(tower.flag, sphere(0.05, 10), P.brass, 0, 0.87, 0, { gloss: 0.7, outline: false });
      this.scene.add(tower.flag);
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.25);
      card.position.set(x, 0.3, 2.4);
      this.scene.add(card);
      this.towers.push(tower);

      members.forEach((p, m) => {
        const seat = seats[p];
        const c = companions[p];
        if (!seat || !c) return;
        const side = members.length > 1 ? (m === 0 ? -1 : 1) : -1;
        const mx = x + side * SPREAD;
        c.root.position.set(mx, 0, 0.25);
        c.root.rotation.y = -side * 0.4; // half turned towards the fort, still facing the room
        c.setBase('listening');
        this.scene.add(c.root);
        const ring = part(this.scene, torus(0.62, 0.05), seat.color, mx, 0.07, 0.25, { rx: Math.PI / 2, outline: false, shadow: false });
        const arrow = part(this.scene, cone(0.16, 0.3, 14), seat.color, mx, HEIGHT + 0.5, 0.25, { rx: Math.PI, glow: 1.1, shadow: false });
        this.members[p] = { companion: c, x: mx, dir: -side, color: seat.color, ring, arrow };
      });
    });
    this.camera.position.copy(this.goal.pos);
    this.camera.lookAt(this.goal.look);
  }

  /** What the game adds to the living room: a pouf with popcorn between the forts, spare pillows, more lights. */
  private room(): void {
    const s = new THREE.Group();
    this.scene.add(s);
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, k = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(k);
      s.add(o);
      return o;
    };
    // A pouf in the middle with a bowl of popcorn: fort-building is hungry work.
    put(props.pouf({ color: P.mauve, r: 0.66, h: 0.5 }), 0, 0, 1.3);
    put(props.snackBowl({ fill: 'popcorn', color: P.terracotta }), 0, 0.48, 1.3, 0, 2.3);
    // The sofa the pillows came off, against the wall, and a heap of spare ones.
    put(props.sofa({ seats: 3, color: P.teal }), 0, 0, -3.7, 0, 2.0);
    const spare = [P.mustard, P.rose, P.sage, P.cream, P.terracotta];
    spare.forEach((c, i) => {
      const p = pillow(c, i % 2 === 0);
      p.position.set(-1.5 + i * 0.7 + (i % 2) * 0.2, 0.6 * 2.0 + 0.2 + (i % 2) * 0.12, -3.4 + (i % 3) * 0.12);
      p.rotation.set(-0.5 + (i % 2) * 0.25, (i - 2) * 0.3, (i - 2) * 0.12);
      s.add(p);
    });
    // In front: a blanket with more pillows waiting, a beanbag, a plant.
    put(props.rug({ w: 7.5, d: 3.2, color: mix(P.clay, P.walnut, 0.45), border: mix(P.cream, P.clay, 0.4), tex: 'knit' }), 0.6, 0, 6.0);
    [P.sage, P.mustard, P.rose, P.cream].forEach((c, i) => {
      const p = pillow(c, i % 2 === 1);
      p.position.set(-1.6 + i * 1.25, PH / 2 + 0.03 + (i === 2 ? PH * 0.8 : 0), 5.7 + (i % 2) * 0.5 - (i === 2 ? 0.45 : 0));
      p.rotation.set(0, 0.5 - i * 0.7, i === 2 ? 0.25 : 0);
      s.add(p);
    });
    put(props.mug({ color: P.terracotta }), 3.3, 0.03, 5.9, 0.7, 2.6);
    put(props.beanbag({ color: P.mustard }), 7.6, 0, 6.6, -0.5, 2.0);
    put(props.plant({ kind: 'monstera', h: 1.1, pot: P.ceramic }), -7.4, 0, 6.6, 0, 2.2);
    // A second string of lights lower on the wall, and dust in the lamplight.
    const back = -(5.8 / 2) * ROOM + 1.4;
    for (let i = 0; i < 4; i++) {
      const x0 = -14.5 + i * 7.25;
      s.add(props.stringLights(new THREE.Vector3(x0, 9.2, back + 0.2), new THREE.Vector3(x0 + 7.25, 9.2, back + 0.2), { sag: 0.5, count: 10, bulb: 0.1 }));
    }
    put(props.motes({ n: 26, area: [22, 7, 6], size: 0.09 }), 0, 0.8, 0.5);
    this.tick = props.tickProps(s);
  }

  /** A pillow from `seat`'s hands onto the team's tower. */
  stack(team: number, seat: number): void {
    const tw = this.towers[team];
    const m = this.members[seat];
    if (!tw) return;
    const color = mix(m?.color ?? tw.color, P.cream, 0.22 + this.rand() * 0.22);
    const mesh = pillow(color, tw.pillows.length % 2 === 0);
    const from = new THREE.Vector3((m?.x ?? tw.x) + (m?.dir ?? 0) * 0.35, HANDS, 0.6);
    mesh.position.copy(from);
    this.scene.add(mesh);
    tw.pillows.push({ mesh, age: 0, from });
  }

  /** The top pillow slides off and lands on the floor beside the fort. */
  tumble(team: number): void {
    const tw = this.towers[team];
    const top = tw?.pillows.pop();
    if (!tw || !top) return;
    const out = tw.x === 0 ? 1 : Math.sign(tw.x);
    tw.loose.push({
      mesh: top.mesh,
      v: new THREE.Vector3(out * (1.4 + this.rand() * 1.0), 2.6 + this.rand(), -(0.6 + this.rand() * 0.8)),
      spin: new THREE.Vector3((this.rand() - 0.5) * 8, (this.rand() - 0.5) * 4, out * -(3 + this.rand() * 3)),
      resting: false,
    });
    while (tw.loose.length > LOOSE_MAX) {
      const old = tw.loose.shift();
      if (old) this.scene.remove(old.mesh);
    }
    tw.jolt = 1;
  }

  jolt(team: number): void {
    const tw = this.towers[team];
    if (tw) tw.jolt = 1;
  }

  /** The fort's wobble (0 to 1) and whose go it is (a member index, or null for either). */
  setFort(team: number, wobble: number, due: number | null): void {
    const tw = this.towers[team];
    if (!tw) return;
    tw.goal = Math.min(1, wobble);
    tw.due = due;
  }

  cheer(team: number, text: string): void {
    const tw = this.towers[team];
    if (tw) this.floaters.add(text, '#fff6a8', new THREE.Vector3(tw.x, tw.top + 0.6, 0.4), 0.6, 2.4);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
    for (const tw of this.towers) {
      tw.label?.material.map?.dispose();
      tw.label?.material.dispose();
    }
  }

  update(dt: number, time: number): void {
    this.time += dt;
    this.env.update(dt, time);
    this.tick(dt, time);
    for (const c of this.companions) c.update(dt);
    for (const tw of this.towers) {
      tw.wobble += (tw.goal - tw.wobble) * (1 - Math.exp(-6 * dt));
      tw.jolt = Math.max(0, tw.jolt - dt * 2.5);
      this.layout(tw, dt);
      this.drift(tw, dt);
      this.turn(tw);
    }
    this.floaters.update(dt);
    this.frame(dt);
  }

  /** Places every pillow: two to a layer, crossing like a woven fort, lower layers squashed a little. */
  private layout(tw: Tower, dt: number): void {
    const n = tw.pillows.length;
    const layers = Math.ceil(n / 2);
    const height = Math.max(1.5, layers * PH * 0.9);
    let y = 0;
    let sway = 0;
    for (let k = 0; k < layers; k++) {
      const h = PH * (1 - 0.18 * Math.min(1, (layers - 1 - k) / 18));
      const lean = ((y + h / 2) / height) ** 1.5;
      sway = lean * (Math.sin(this.time * 8 + tw.phase) * (tw.wobble * 0.45 + tw.jolt * 0.25) + Math.sin(this.time * 1.4 + tw.phase) * 0.005 * layers);
      const across = k % 2 === 0;
      for (let slot = 0; slot < 2; slot++) {
        const p = tw.pillows[k * 2 + slot];
        if (!p) break;
        const off = slot === 0 ? -0.25 : 0.25;
        this.target.set(tw.x + sway + (across ? 0 : off), y + h / 2, across ? off : 0);
        const ry = across ? 0 : Math.PI / 2;
        p.age += dt;
        if (p.age < FLY) {
          const f = p.age / FLY;
          p.mesh.position.lerpVectors(p.from, this.target, f);
          p.mesh.position.y += Math.sin(Math.PI * f) * 0.9;
          p.mesh.rotation.set((1 - f) * 2.5, ry, 0);
          p.mesh.scale.set(1, 1, 1);
        } else {
          const settle = Math.min(1, (p.age - FLY) / 0.22);
          p.mesh.position.copy(this.target);
          p.mesh.rotation.set(0, ry, -sway * 0.3);
          const squash = (1 - settle) * 0.3;
          p.mesh.scale.set(1 + squash * 0.4, (h / PH) * (1 - squash), 1 + squash * 0.4);
        }
      }
      y += h;
    }
    tw.top = y;
    tw.sway = sway;
    tw.flag.position.set(tw.x + sway, y, 0);
    tw.flag.rotation.z = -sway * 0.3;
    if (n !== tw.shown) {
      tw.shown = n;
      if (tw.label) {
        this.scene.remove(tw.label);
        tw.label.material.map?.dispose();
        tw.label.material.dispose();
      }
      tw.label = popSprite(String(n), tw.color, 0.6);
      this.scene.add(tw.label);
    }
    tw.label?.position.set(tw.x + sway, y + 1.25, 0);
  }

  /** Tumbled pillows fly, bounce once and lie where they land. */
  private drift(tw: Tower, dt: number): void {
    for (const l of tw.loose) {
      if (l.resting) continue;
      l.v.y -= 15 * dt;
      l.mesh.position.addScaledVector(l.v, dt);
      l.mesh.rotation.x += l.spin.x * dt;
      l.mesh.rotation.y += l.spin.y * dt;
      l.mesh.rotation.z += l.spin.z * dt;
      if (l.mesh.position.y <= PH / 2 && l.v.y < 0) {
        if (l.v.y < -3) {
          l.v.set(l.v.x * 0.5, -l.v.y * 0.3, l.v.z * 0.5);
          l.spin.multiplyScalar(0.4);
          l.mesh.position.y = PH / 2;
        } else {
          l.resting = true;
          l.mesh.position.y = PH / 2;
          l.mesh.rotation.set(0, l.mesh.rotation.y, 0);
        }
      }
    }
  }

  /** The partner whose go it is gets a glowing ring and a bobbing arrow. */
  private turn(tw: Tower): void {
    tw.members.forEach((p, i) => {
      const m = this.members[p];
      if (!m) return;
      const due = tw.due === null || tw.due === i;
      m.ring.material = material(m.color, due ? { glow: 1.3 } : { glow: 0.3 });
      m.ring.scale.setScalar(due ? 1 + Math.sin(this.time * 6) * 0.06 : 0.85);
      m.arrow.visible = due;
      m.arrow.position.y = HEIGHT + 0.5 + Math.sin(this.time * 5 + i) * 0.08;
    });
  }

  /** Eases the camera to frame both teams and the taller fort, clear of the HUD bars. */
  private frame(dt: number): void {
    const top = Math.max(2.2, ...this.towers.map((t) => t.top));
    const key = `${Math.ceil(top * 4)}:${this.camera.aspect.toFixed(3)}`;
    if (key !== this.fitKey) {
      this.fitKey = key;
      this.probe.fov = this.camera.fov;
      this.probe.aspect = this.camera.aspect;
      this.probe.updateProjectionMatrix();
      const marks: Mark[] = [];
      const reach = Math.ceil(top * 4) / 4 + 1.6; // the height label above the pennant
      for (const tw of this.towers) {
        for (const side of [-1, 1]) {
          const x = tw.x + side * (SPREAD + 0.55);
          marks.push({ p: new THREE.Vector3(x, 0, 0.25) }, { p: new THREE.Vector3(x, HEIGHT + 0.75, 0.25) });
          marks.push({ p: new THREE.Vector3(tw.x + side * 1.3, 0.3, 2.4), pad: 0.07 });
          marks.push({ p: new THREE.Vector3(tw.x + side * 0.9, reach, 0) });
        }
      }
      this.goal = frameMarks(this.probe, marks, TILT);
    }
    const k = this.placed ? 1 - Math.exp(-2.2 * dt) : 1;
    this.placed = true;
    this.camera.position.lerp(this.goal.pos, k);
    this.look.lerp(this.goal.look, k);
    this.camera.lookAt(this.look);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'pillowfort',
  title: 'Pillow Fort',
  how: 'Build the tallest pillow fort with your partner by taking turns on the Pillow! button, one press each. Going twice in a row or rushing makes the fort wobble, and the top pillow tumbles off!',
  controller: 'buttons',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const forts = teams.map(() => newFort());
    const solo = teams.map((t) => t.length < 2);
    const skill = seats.map(() => ctx.skill());
    const view = new FortView(seats, teams, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);

    const slotOf = new Map<number, { team: number; member: number }>();
    teams.forEach((t, team) => t.forEach((p, member) => slotOf.set(p, { team, member })));
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const partnerOf = (p: number): number | undefined => {
      const w = slotOf.get(p);
      return w && !solo[w.team] ? teams[w.team]?.[1 - w.member] : undefined;
    };
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');

    seats.forEach((s, p) => {
      const partner = partnerOf(p);
      session.setLayout(s.index, {
        kind: 'buttons',
        title: 'Pillow Fort',
        buttons: [{ label: 'Pillow!', color: s.color }],
        note: partner === undefined ? 'Stack pillows, but don’t rush!' : `Take turns with ${nameOf(partner)}: one pillow each!`,
      });
    });

    // Computer players: when each one presses next, and whether that press is an absent-minded second go.
    const cpuNext = seats.map(() => Infinity);
    const cpuDouble = seats.map(() => false);
    let now = 0;
    let over = false;

    const press = (p: number, t: number) => {
      const w = slotOf.get(p);
      const fort = w ? forts[w.team] : undefined;
      if (!w || !fort || over) return;
      const partner = partnerOf(p);
      const me = view.members[p]?.companion;
      const result = pressPillow(fort, w.member, t, solo[w.team]);
      switch (result) {
        case 'stacked':
          view.stack(w.team, p);
          thump(sfx, 0.85 + Math.min(0.8, fort.pillows / 60));
          me?.react('approval', 0.5);
          if (partner !== undefined) {
            tell(p, true, `Nice! Now it's ${nameOf(partner)}'s go.`);
            tell(partner, true, 'Your go!');
            session.send(seatOf(partner), { t: 'buzz', pattern: [18] });
          }
          if (cpu(p) && partner !== undefined && cpuDoubles(rng, skill[p] ?? 0.5)) {
            cpuDouble[p] = true;
            cpuNext[p] = t + 0.25 + rng() * 0.25;
          }
          break;
        case 'same':
        case 'fast':
          view.jolt(w.team);
          warble(sfx);
          me?.react('thinking', 0.8);
          tell(p, false, result === 'same' ? 'Let your partner go!' : 'Too fast! Let it settle.');
          session.send(seatOf(p), { t: 'buzz', pattern: [60, 40, 60] });
          if (cpu(p) && result === 'fast') cpuNext[p] = fort.lastAt + PILLOW.minGap + 0.05 + rng() * 0.12;
          break;
        case 'tumble':
          view.tumble(w.team);
          warble(sfx);
          sfx.whoosh();
          me?.react('sad', 1.4);
          if (partner !== undefined) view.members[partner]?.companion.react('thinking', 1.2);
          tell(p, false, 'Whoops! The top pillow tumbled off.');
          session.send(seatOf(p), { t: 'buzz', pattern: [120, 60, 120] });
          break;
        case 'ignored':
          if (cpu(p)) cpuNext[p] = t + fort.fluff + 0.1;
          break;
      }
    };

    const cpuTurns = (t: number) => {
      teams.forEach((members, team) => {
        const fort = forts[team];
        if (!fort) return;
        const due = whoseTurn(fort, solo[team]);
        members.forEach((p, member) => {
          if (!cpu(p)) return;
          const other = members[1 - member];
          // Either partner may start: a computer leads unless its partner is a person, who gets a moment first.
          const mine = due === member || (due === null && (solo[team] || member === 0 || (other !== undefined && !cpu(other) && t > 1.6)));
          if (cpuNext[p] === Infinity) {
            if (mine) cpuNext[p] = Math.max(t + 0.05 + fort.fluff, Math.max(0, fort.lastAt) + cpuPillowGap(rng, skill[p] ?? 0.5));
            return;
          }
          if (t < (cpuNext[p] ?? Infinity)) return;
          const double = cpuDouble[p];
          cpuNext[p] = Infinity;
          cpuDouble[p] = false;
          if (mine || double) press(p, t);
        });
      });
    };

    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'press' || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p !== undefined) press(p, now);
    });

    ui.caption('Take turns with your partner: one pillow each!');
    let hudAt = -1;
    await everyFrame(clock, (dt, t) => {
      now = t;
      cpuTurns(t);
      forts.forEach((f, team) => {
        stepFort(f, dt);
        view.setFort(team, f.wobble, whoseTurn(f, solo[team]));
      });
      if (t - hudAt >= 0.1) {
        hudAt = t;
        ui.timer(PILLOW.duration - t);
        ui.live(
          teams.map((members, team) => {
            const lead = seats[members[0] ?? 0];
            const n = forts[team]?.pillows ?? 0;
            return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} pillow${n === 1 ? '' : 's'}` };
          }),
        );
      }
      return t >= PILLOW.duration;
    });
    over = true;
    off();
    ui.timer(null);
    ui.caption(null);

    // Time! The taller fort cheers.
    const best = Math.max(...forts.map(fortScore));
    const tie = forts.length > 1 && forts.every((f) => fortScore(f) === best);
    sfx.good();
    teams.forEach((members, team) => {
      const won = fortScore(forts[team] ?? newFort()) === best;
      for (const p of members) {
        view.members[p]?.companion.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) view.members[p]?.companion.react('happy', 3);
        tell(p, won, tie ? 'Time! Two forts, exactly as tall.' : won ? 'Time! Your fort is the tallest!' : 'Time! Their fort was taller.');
      }
      if (won && !tie) view.cheer(team, 'Tallest fort!');
    });
    await clock.wait(1.6);

    return {
      scores: pillowScores(forts, teams, seats.length),
      details: seats.map((_, p) => {
        const w = slotOf.get(p);
        const f = w ? forts[w.team] : undefined;
        if (!f) return '';
        return `Fort of ${f.pillows} pillow${f.pillows === 1 ? '' : 's'}${f.tumbles ? ` · ${f.tumbles} tumble${f.tumbles === 1 ? '' : 's'}` : ''}`;
      }),
    };
  },
};
