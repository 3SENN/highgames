// Mirror Mirror on the TV: a dressing-up evening in the bedroom, a lava lamp blooping away between two tall mirrors.
// In each team the leader (in the spotlight) strikes the secret poses from their phone; their partner watches and
// copies them. The dots over each mirror fill in gold for every right copy.
import * as THREE from 'three';
import {
  MIRROR,
  type Mirror,
  POSES,
  copyPose,
  cpuCopyDelay,
  cpuLeadGap,
  cpuSlips,
  isCopied,
  leadPose,
  leaderOf,
  makeRun,
  mirrorScores,
  newMirror,
  otherPose,
  rightCopies,
  roundTime,
} from '../../../game/minigames/mirrormoves';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { type Env, bedroom } from '../../render/env';
import * as props from '../../render/props';
import { preloadTextures } from '../../render/textures';
import { PALETTE as P, box, cone, cyl, gem, material, mix, nameCard, part, rbox, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SIDE = 3.9; // each team's mirror stands this far left or right of the middle
const SPREAD = 1.4; // partners stand this far either side of their mirror
const HEIGHT = 1.55; // companions
const MIRROR_Z = -0.55;
const PIP_Y = 2.6;
const TILT = 0.27;
const BACK = -3.8; // the back wall
const SHIFT = -1.5; // the room sits a little left of the middle: the camera sees further that way, behind the scores

/** Each pose's colour (the button on the phone, the flash on the floor) and the companion's mood while posing. */
const POSE_LOOK: readonly { color: string; mood: CompanionMood }[] = [
  { color: '#ffd166', mood: 'happy' },
  { color: '#ff9fb2', mood: 'talking' },
  { color: '#8fd3ff', mood: 'approval' },
  { color: '#9be39b', mood: 'working' },
];
const BUTTONS = POSES.map((label, i) => ({ label, color: POSE_LOOK[i]?.color ?? '#ffffff' }));
const PIP = { waiting: P.slate, shown: P.cream, right: P.lamp, wrong: P.rose } as const;
const PIP_GLOW = { waiting: 0, shown: 0.9, right: 1.8, wrong: 0.5 } as const;
type PipState = keyof typeof PIP;

// ------------------------------------------------------------------ sounds

/** A soft pop for a pose on the TV, pitched by the pose. */
function posePop(sfx: Sfx, pose: number): void {
  const f = [523, 587, 659, 440][pose] ?? 523;
  tone(sfx, { freq: f, to: f * 1.25, dur: 0.12, gain: 0.08 });
}

function rightCopy(sfx: Sfx): void {
  tone(sfx, { freq: 784, dur: 0.1, gain: 0.08 });
  tone(sfx, { freq: 1046, dur: 0.16, gain: 0.07, delay: 0.07 });
}

function wrongCopy(sfx: Sfx): void {
  tone(sfx, { freq: 311, to: 233, dur: 0.22, type: 'triangle', gain: 0.09 });
}

// ------------------------------------------------------------------ the scene

interface Actor {
  companion: Companion;
  x: number;
  z: number;
  baseY: number;
  flash: THREE.Mesh;
  flashMat: THREE.MeshBasicMaterial;
  flashAge: number;
  queue: { pose: number; at: number }[];
  posing: { pose: number; age: number } | null;
}

interface Spot {
  cone: THREE.Mesh;
  disc: THREE.Mesh;
  star: THREE.Mesh;
  pos: THREE.Vector3;
  goal: THREE.Vector3;
}

class MirrorView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  /** Seat positions first, then each team's reflection (for a team of one) at seats + team. */
  readonly actors: (Actor | undefined)[] = [];
  private readonly companions: Companion[];
  private readonly floaters: Floaters;
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly pips: THREE.Mesh[][] = [];
  private readonly spots: Spot[] = [];
  private readonly blobs: THREE.Mesh[] = [];
  private readonly pipState: PipState[][] = [];
  private readonly pipPop: number[][] = [];
  private readonly sparks: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private env: Env | null = null;
  private lava: THREE.PointLight | null = null;
  private readonly flashMats: THREE.MeshBasicMaterial[] = [];
  /** Each team's mirror, along x. */
  private readonly xs: number[] = [];
  private time = 0;

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    companions: Companion[],
    reflections: (Companion | null)[],
  ) {
    this.companions = [...companions, ...reflections.filter((c): c is Companion => c !== null)];
    this.floaters = new Floaters(this.scene);
    this.room();

    teams.forEach((members, team) => {
      const x = (team === 0 ? -1 : 1) * (teams.length > 1 ? SIDE : 0);
      const color = seats[members[0] ?? 0]?.color ?? '#ffd166';
      this.xs.push(x);
      // The team's rug: a woolly oval in a deep shade of its colour, the full colour only on a thin glowing trim.
      const wool = { tex: 'knit' as const, outline: false as const, shadow: false };
      part(this.scene, cyl(1, 1, 0.03, 48), mix(color, P.cream, 0.45), x, 0.015, 0.1, { ...wool, sx: 2.6, sz: 1.7 });
      part(this.scene, cyl(1, 1, 0.03, 48), mix(color, P.aubergine, 0.55), x, 0.022, 0.1, { ...wool, sx: 2.45, sz: 1.55 });
      part(this.scene, cyl(1, 1, 0.03, 48), mix(color, P.aubergine, 0.68), x, 0.028, 0.1, { ...wool, sx: 1.5, sz: 0.9 });
      part(this.scene, torus(1, 0.018), color, x, 0.05, 0.1, { rx: Math.PI / 2, sx: 2.3, sy: 1.42, glow: 1.1, outline: false, shadow: false });
      this.mirror(x, color);
      const card = nameCard(members.map((p) => seats[p]?.name ?? '').join(' & '), color, 1.25);
      card.position.set(x, 0.3, 2.1);
      this.scene.add(card);

      // The dots over the mirror: one per pose of the run.
      // They sit on a little dark marquee board with a brass edge, like the bulbs round a dressing-room mirror.
      part(this.scene, rbox(1.95, 0.4, 0.06, 0.05), P.brass, x, PIP_Y, MIRROR_Z + 0.0, { gloss: 0.6, outline: false });
      part(this.scene, rbox(1.85, 0.3, 0.06, 0.04), P.charcoal, x, PIP_Y, MIRROR_Z + 0.02, { outline: false });
      const row: THREE.Mesh[] = [];
      for (let i = 0; i < 5; i++) {
        const pip = part(this.scene, sphere(0.09, 14), PIP.waiting, x, PIP_Y, MIRROR_Z + 0.1, { outline: false, shadow: false });
        pip.visible = false;
        row.push(pip);
      }
      this.pips.push(row);
      this.pipState.push(row.map(() => 'waiting'));
      this.pipPop.push(row.map(() => 0));

      // The leader's spotlight, and a little star over their head.
      const cone0 = part(this.scene, cone(0.85, 3.6, 28), P.lamp, x, 1.8, 0.25, { basic: true, opacity: 0.1, shadow: false });
      const disc = part(this.scene, cyl(0.8, 0.8, 0.02, 40), P.lamp, x, 0.058, 0.25, { glow: 0.55, opacity: 0.5, outline: false, shadow: false });
      const star = part(this.scene, gem(0.14), P.lamp, x, HEIGHT + 0.5, 0.25, { glow: 1.6, sy: 1.3, outline: false, shadow: false });
      cone0.visible = disc.visible = star.visible = false;
      this.spots.push({ cone: cone0, disc, star, pos: new THREE.Vector3(x, 0, 0.25), goal: new THREE.Vector3(x, 0, 0.25) });

      const place = (c: Companion, side: number, ringColor: string): Actor => {
        const ax = x + side * SPREAD;
        const baseY = -side * 0.35; // half turned towards the mirror, still facing the room
        c.root.position.set(ax, 0, 0.25);
        c.root.rotation.y = baseY;
        c.setBase('listening');
        this.scene.add(c.root);
        part(this.scene, torus(0.6, 0.04), ringColor, ax, 0.075, 0.25, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
        const flashMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
        this.flashMats.push(flashMat);
        const flash = part(this.scene, torus(0.7, 0.07), '#ffffff', ax, 0.09, 0.25, { rx: Math.PI / 2, material: flashMat, outline: false, shadow: false });
        return { companion: c, x: ax, z: 0.25, baseY, flash, flashMat, flashAge: 1, queue: [], posing: null };
      };
      members.forEach((p, m) => {
        const seat = seats[p];
        const c = companions[p];
        if (!seat || !c) return;
        this.actors[p] = place(c, members.length > 1 ? (m === 0 ? -1 : 1) : 1, seat.color);
      });
      const reflection = reflections[team];
      if (reflection) this.actors[seats.length + team] = place(reflection, -1, P.moon);

      for (const side of [-1, 1]) {
        const ex = x + side * (SPREAD + 0.6);
        this.marks.push({ p: new THREE.Vector3(ex, 0, 0.25) }, { p: new THREE.Vector3(ex, HEIGHT + 0.85, 0.25) });
        this.marks.push({ p: new THREE.Vector3(x + side * 1.3, 0.3, 2.1), pad: 0.07 });
      }
      this.marks.push({ p: new THREE.Vector3(x, PIP_Y + 0.25, MIRROR_Z) });
    });
  }

  /**
   * A bedroom on a dressing-up evening: the bed against the back wall, a dusky window, a rail of costumes, a trunk
   * of hats, and a lava lamp blooping away on a stool between the mirrors.
   */
  private room(): void {
    const s = this.scene;
    const env = bedroom(s, { mood: 'evening', w: 20, d: -BACK * 2, h: 5, bed: false, wall: P.duskWall });
    env.root.position.x = SHIFT;
    this.env = env;
    // The room's own rug goes under the lava lamp, between the two teams.
    const rug = env.root.getObjectByName('rug');
    if (rug) rug.position.set(-SHIFT, 0, -0.9);
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, scale = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      s.add(o);
      return o;
    };

    // The bed behind the left mirror, a lamp on each side of it.
    put(props.bed({ color: P.mauve, blanket: P.mustard }), -3.9, 0, BACK + 1.25, 0, 1.2);
    for (const side of [-1, 1]) {
      put(props.sideTable({ h: 0.5 }), -3.9 + side * 1.35, 0, BACK + 0.45);
      put(props.tableLamp({ lit: true, light: side < 0 ? 6 : false, stand: P.brass }), -3.9 + side * 1.35, 0.5, BACK + 0.45);
    }
    put(props.pictureFrame({ w: 1.1, h: 0.8, art: 'hills', frame: P.walnut, seed: 4 }), -3.9, 2.55, BACK + 0.01);
    put(props.pictureFrame({ w: 0.5, h: 0.65, art: 'leaf', frame: P.brass, seed: 8 }), -2.75, 2.7, BACK + 0.01);
    put(props.pictureFrame({ w: 0.6, h: 0.45, art: 'shapes', frame: P.charcoal, seed: 6 }), 0.9, 2.2, BACK + 0.01);
    put(props.wallShelf({ w: 1.3, seed: 3 }), 1.6, 3.15, BACK + 0.01);
    put(props.wallClock({ r: 0.24 }), 6.9, 3.1, BACK + 0.01);

    // A rail of costumes at the back on the left, a trunk and hat boxes beside it.
    const rail = new THREE.Group();
    for (const side of [-1, 1]) {
      part(rail, cyl(0.025, 0.025, 1.75, 8), P.charcoal, side * 0.95, 0.875, 0, { gloss: 0.5, outline: false });
      part(rail, rbox(0.08, 0.05, 0.6, 0.02), P.charcoal, side * 0.95, 0.03, 0, { outline: false });
    }
    part(rail, cyl(0.02, 0.02, 1.95, 8), P.brass, 0, 1.75, 0, { rz: Math.PI / 2, gloss: 0.6, outline: false });
    [P.teal, P.terracotta, P.cream, P.mustard, P.denim, P.rose].forEach((c, i) => {
      const gx = -0.7 + i * 0.28;
      const len = 0.75 + ((i * 7) % 4) * 0.12;
      part(rail, rbox(0.08, len, 0.46, 0.035), c, gx, 1.68 - len / 2, 0, { tex: i % 2 ? 'fabric' : 'velvet', outline: 0.012 });
    });
    put(rail, -7.6, 0, BACK + 1.0, 0.12);
    put(props.crate({ s: 0.6, color: P.walnut }), -6.25, 0, BACK + 0.6, 0.2);
    const boxes = new THREE.Group();
    part(boxes, cyl(0.26, 0.26, 0.22, 24), P.rose, 0, 0.11, 0, { tex: 'fabric', texStrength: 0.4 });
    part(boxes, cyl(0.275, 0.275, 0.06, 24), P.cream, 0, 0.23, 0, { outline: false });
    part(boxes, cyl(0.19, 0.19, 0.18, 24), P.teal, 0.03, 0.35, 0.02, { tex: 'fabric', texStrength: 0.4 });
    part(boxes, cyl(0.2, 0.2, 0.05, 24), P.cream, 0.03, 0.45, 0.02, { outline: false });
    put(boxes, -6.2, 0.6, BACK + 0.6);
    put(props.plant({ kind: 'ficus', h: 2.0, pot: P.ceramic, seed: 3 }), -9.4, 0, BACK + 0.7);
    put(props.floorLamp({ lit: true }), 1.9, 0, BACK + 0.5);
    put(props.armchair({ color: P.teal, pillow: P.mustard }), 7.1, 0, BACK + 1.1, -0.5, 1.2);
    put(props.plant({ kind: 'monstera', h: 1.1, seed: 5 }), 2.9, 0, BACK + 0.6);

    // The foreground: something big and soft at each bottom corner.
    put(props.beanbag({ color: P.terracotta }), -6.2, 0, 4.3, 0.5, 1.3);
    put(props.plant({ kind: 'palm', h: 1.7, pot: P.charcoal, seed: 9 }), -7.5, 0, 2.9);
    put(props.pouf({ color: P.mustard }), 3.9, 0, 4.4, 0, 1.3);
    put(props.plant({ kind: 'snake', h: 0.95, pot: P.ceramic, seed: 2 }), 5.0, 0, 3.5, 0, 1.2);
    // A trunk of hats left open in the middle of the floor.
    put(props.crate({ s: 0.55, color: P.walnut }), -1.3, 0, 3.9, 0.35);
    put(props.pouf({ color: P.rose, r: 0.26, h: 0.2 }), -0.6, 0, 4.2);

    // The stool and the lava lamp.
    put(props.stool({ h: 0.43, color: P.walnut, seat: P.walnut }), 0, 0, -1.6, 0, 1.6);
    part(s, cyl(0.2, 0.26, 0.22, 24), P.brass, 0, 0.79, -1.6, { gloss: 0.7 });
    part(s, cyl(0.1, 0.2, 0.15, 24), P.brass, 0, 1.68, -1.6, { gloss: 0.7 });
    part(s, cyl(0.12, 0.2, 0.75, 24), P.rose, 0, 1.27, -1.6, { opacity: 0.5, glow: 0.7, outline: false, shadow: false });
    for (let i = 0; i < 4; i++) this.blobs.push(part(s, sphere(0.06 + i * 0.012, 12), P.neonPink, 0, 1.1 + i * 0.2, -1.6, { glow: 1.8, outline: false, shadow: false }));
    this.lava = new THREE.PointLight(P.neonPink, 5, 7, 1.8);
    this.lava.position.set(0, 1.45, -1.15);
    s.add(this.lava);
  }

  /** A tall cheval mirror in a dark wooden frame with brass fittings, and the team's colour on its finials. */
  private mirror(x: number, color: string): void {
    const s = this.scene;
    const wood = { tex: 'darkWood' as const, gloss: 0.25 };
    part(s, torus(0.5, 0.075), P.walnut, x, 1.3, MIRROR_Z, { ...wood, sy: 1.55 });
    part(s, torus(0.44, 0.018), P.brass, x, 1.3, MIRROR_Z + 0.05, { sy: 1.6, gloss: 0.7, outline: false, shadow: false });
    for (const side of [-1, 1]) {
      part(s, cyl(0.04, 0.05, 1.9, 10), P.walnut, x + side * 0.6, 0.95, MIRROR_Z - 0.05, wood);
      part(s, rbox(0.14, 0.07, 0.44, 0.03), P.walnut, x + side * 0.6, 0.035, MIRROR_Z - 0.05, wood);
      part(s, cyl(0.03, 0.03, 0.14, 10), P.brass, x + side * 0.56, 1.3, MIRROR_Z - 0.03, { rz: Math.PI / 2, gloss: 0.7, outline: false });
      part(s, sphere(0.065, 12), color, x + side * 0.6, 1.94, MIRROR_Z - 0.05, { glow: 1.1, outline: false, shadow: false });
    }
    // The glass: cool and a little bright, with two soft streaks of light across it.
    part(s, cyl(0.47, 0.47, 0.03, 40), mix(P.moon, P.duskWall, 0.35), x, 1.3, MIRROR_Z, { rx: Math.PI / 2, sz: 1.57, glow: 0.22, gloss: 0.8, outline: false, shadow: false });
    part(s, box(0.08, 0.7, 0.01), P.cream, x - 0.15, 1.45, MIRROR_Z + 0.03, { rz: -0.5, basic: true, opacity: 0.4, shadow: false });
    part(s, box(0.04, 0.4, 0.01), P.cream, x + 0.02, 1.55, MIRROR_Z + 0.03, { rz: -0.5, basic: true, opacity: 0.32, shadow: false });
  }

  /** The leader (an actor) stands in the spotlight. */
  setLeader(team: number, actor: number): void {
    const spot = this.spots[team];
    const a = this.actors[actor];
    if (!spot || !a) return;
    spot.goal.set(a.x, 0, a.z);
    if (!spot.cone.visible) spot.pos.copy(spot.goal);
    spot.cone.visible = spot.disc.visible = spot.star.visible = true;
  }

  hideSpots(): void {
    for (const s of this.spots) s.cone.visible = s.disc.visible = s.star.visible = false;
  }

  /** `actor` strikes `pose` in `delay` seconds (right away when 0). */
  strike(actor: number, pose: number, delay = 0): void {
    const a = this.actors[actor];
    if (a) a.queue.push({ pose, at: this.time + Math.max(0, delay) });
  }

  /** The dots over a team's mirror (null: none): waiting, shown, copied right or wrong. */
  setPips(team: number, m: Mirror | null, now: number): void {
    const row = this.pips[team];
    const x = this.xs[team] ?? 0;
    if (!row) return;
    row.forEach((pip, i) => {
      pip.visible = m !== null && i < m.run.length;
      if (!m || !pip.visible) return;
      pip.position.x = x + (i - (m.run.length - 1) / 2) * 0.32;
      const copied = m.copies[i];
      const shown = m.shownAt[i];
      const state = copied === true ? 'right' : copied === false ? 'wrong' : shown !== undefined && shown <= now ? 'shown' : 'waiting';
      pip.material = material(PIP[state], { glow: PIP_GLOW[state], outline: false });
      const states = this.pipState[team];
      const pops = this.pipPop[team];
      if (states && pops && states[i] !== state) {
        // A pip that just changed pops; a right copy also throws a few sparks.
        if (state !== 'waiting') pops[i] = 1;
        if (state === 'right') this.sparkle(pip.position);
        states[i] = state;
      }
    });
  }

  /** A few warm sparks flying off a spot. */
  private sparkle(at: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + this.time * 3;
      const m = part(this.scene, gem(0.045), P.lamp, at.x, at.y, at.z + 0.05, { glow: 2, outline: false, shadow: false });
      this.sparks.push({ m, v: new THREE.Vector3(Math.cos(a) * 0.9, Math.sin(a) * 0.9 + 0.5, 0.2), age: 0 });
    }
  }

  say(actor: number, text: string, color: string): void {
    const a = this.actors[actor];
    if (a) this.floaters.add(text, color, new THREE.Vector3(a.x, HEIGHT + 0.75, a.z + 0.3), 0.42, 1.1);
  }

  cheer(team: number, text: string): void {
    this.floaters.add(text, '#fff6a8', new THREE.Vector3(this.xs[team] ?? 0, PIP_Y + 0.5, 0), 0.6, 2.4);
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    for (const m of this.flashMats) m.dispose();
    this.floaters.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.fit.update(() => this.marks);
    this.env?.update(dt, this.time);
    for (const c of this.companions) c.update(dt);
    for (const a of this.actors) if (a) this.pose(a, dt);
    this.pips.forEach((row, team) =>
      row.forEach((pip, i) => {
        const pops = this.pipPop[team];
        const k = Math.max(0, (pops?.[i] ?? 0) - dt * 3.2);
        if (pops) pops[i] = k;
        pip.scale.setScalar(1 + Math.sin(Math.PI * k) * 0.55);
      }),
    );
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i] as (typeof this.sparks)[number];
      sp.age += dt;
      sp.v.y -= 2.4 * dt;
      sp.m.position.addScaledVector(sp.v, dt);
      sp.m.rotation.y += dt * 8;
      sp.m.scale.setScalar(Math.max(0.01, 1 - sp.age / 0.55));
      if (sp.age < 0.55) continue;
      sp.m.removeFromParent();
      this.sparks.splice(i, 1);
    }
    if (this.lava) this.lava.intensity = 5 + Math.sin(this.time * 1.1) * 0.5 + Math.sin(this.time * 2.7) * 0.25;
    for (const s of this.spots) {
      s.pos.lerp(s.goal, 1 - Math.exp(-6 * dt));
      s.cone.position.set(s.pos.x, 1.8, s.pos.z);
      s.disc.position.set(s.pos.x, 0.05, s.pos.z);
      s.star.position.set(s.pos.x, HEIGHT + 0.55 + Math.sin(this.time * 3) * 0.06, s.pos.z);
      s.star.rotation.y += dt * 2;
    }
    this.blobs.forEach((b, i) => {
      b.position.y = 1.0 + (Math.sin(this.time * (0.5 + i * 0.17) + i * 2) * 0.5 + 0.5) * 0.55;
      b.scale.set(1, 1 + Math.sin(this.time * 1.3 + i) * 0.25, 1);
    });
    this.floaters.update(dt);
  }

  /** Runs an actor's queued poses, one at a time. */
  private pose(a: Actor, dt: number): void {
    // A leader's poses are queued a pose apart; a follower's start straight away, cutting the last one short.
    const next = a.queue[0];
    if (next && this.time >= next.at) {
      a.queue.shift();
      a.posing = { pose: next.pose, age: 0 };
      const look = POSE_LOOK[next.pose];
      a.companion.react(look?.mood ?? 'happy', MIRROR.pose);
      a.flashMat.color.set(look?.color ?? '#ffffff');
      a.flashAge = 0;
    }
    const root = a.companion.root;
    root.position.y = 0;
    root.rotation.set(0, a.baseY, 0);
    root.scale.set(1, 1, 1);
    if (a.posing) {
      a.posing.age += dt;
      const k = Math.min(1, a.posing.age / MIRROR.pose);
      const e = Math.sin(Math.PI * k);
      switch (a.posing.pose) {
        case 0: // Arms up: stretch tall with a little hop.
          root.scale.set(1 - 0.05 * e, 1 + 0.16 * e, 1 - 0.05 * e);
          root.position.y = 0.22 * e;
          break;
        case 1: // Wave: rock from side to side.
          root.rotation.z = Math.sin(k * Math.PI * 4) * 0.3 * e;
          break;
        case 2: // Spin: once round.
          root.rotation.y = a.baseY + Math.PI * 2 * ease.inOutSine(k);
          break;
        default: // Squat: down low.
          root.scale.set(1 + 0.14 * e, 1 - 0.3 * e, 1 + 0.14 * e);
      }
      if (k >= 1) a.posing = null;
    }
    a.flashAge = Math.min(1, a.flashAge + dt / 0.6);
    a.flash.scale.setScalar(0.55 + 0.75 * ease.outCubic(a.flashAge));
    a.flashMat.opacity = 0.9 * (1 - a.flashAge);
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'mirrormoves',
  title: 'Mirror Mirror',
  how: 'Take turns to lead: the leader’s phone shows a secret run of poses to strike on the TV, and their partner copies them on their own phone. Every right copy scores, quick ones a bit more!',
  controller: 'buttons',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const skill = seats.map((_, p) => (cpu(p) ? ctx.skill() : 0.5));
    // Have the set's textures in before it first shows (but never wait long for them).
    const warm = Promise.race([preloadTextures('woodFloor', 'plaster', 'knit', 'darkWood', 'wood', 'fabric', 'velvet'), new Promise<void>((done) => setTimeout(done, 2000))]);
    const companions = await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT })));
    await warm;
    // A team of one copies its own reflection, which leads every round.
    const reflections = await Promise.all(
      teams.map((members) => {
        const look = seats[members[0] ?? 0]?.look;
        return members.length < 2 && look ? buildCompanion(look, { height: HEIGHT }) : Promise.resolve(null);
      }),
    );
    const view = new MirrorView(seats, teams, companions, reflections);
    ctx.stage.setView(view);

    const teamOf = new Map<number, number>();
    teams.forEach((t, team) => t.forEach((p) => teamOf.set(p, team)));
    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'your partner';
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const reflectionOf = (team: number) => seats.length + team;

    const totals = teams.map(() => 0);
    const rights = teams.map(() => 0);
    let poses = 0;
    let now = 0;
    let frameAt = performance.now();
    let over = false;
    const live = () =>
      ui.live(
        teams.map((members, team) => {
          const lead = seats[members[0] ?? 0];
          return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${totals[team] ?? 0} pts` };
        }),
      );
    live();

    for (let round = 0; round < MIRROR.rounds; round++) {
      const len = MIRROR.lengths[round] ?? 4;
      const mirrors = teams.map(() => newMirror(makeRun(rng, len)));
      // Seat positions of each team's leader (null: the reflection leads) and follower.
      const leaders = teams.map((members) => {
        const l = leaderOf(round, members.length);
        return l === null ? null : (members[l] ?? null);
      });
      const followers = teams.map((members) => {
        const l = leaderOf(round, members.length);
        return members[l === null ? 0 : 1 - l] ?? 0;
      });
      const leadActor = (team: number) => leaders[team] ?? reflectionOf(team);
      const leaderName = (team: number) => {
        const l = leaders[team];
        return l === null || l === undefined ? 'your reflection' : nameOf(l);
      };
      const tag = `Round ${round + 1} of ${MIRROR.rounds}`;

      teams.forEach((_, team) => {
        const m = mirrors[team];
        const leader = leaders[team];
        const follower = followers[team] ?? 0;
        if (!m) return;
        view.setLeader(team, leadActor(team));
        view.setPips(team, m, 0);
        if (leader !== null && leader !== undefined) {
          session.setLayout(seatOf(leader), {
            kind: 'buttons',
            title: 'You lead',
            buttons: BUTTONS,
            secret: `Show ${nameOf(follower)}: ${m.run.map((i) => POSES[i]).join(' → ')}`,
            note: `${tag} · press the poses in order`,
          });
          buzz(leader, [30]);
        }
        session.setLayout(seatOf(follower), {
          kind: 'buttons',
          title: 'You copy',
          buttons: BUTTONS,
          note: `${tag} · watch ${leaderName(team)} on the TV and copy!`,
        });
      });
      ui.caption(`${tag}: leaders strike the poses, partners copy them!`);
      sfx.go();

      const lead = (team: number, pose: number) => {
        const m = mirrors[team];
        const leader = leaders[team];
        if (!m) return;
        const result = leadPose(m, pose, now);
        if (result === 'done') return;
        if (result === 'wrong') {
          const want = m.run[m.shownAt.length] ?? 0;
          if (leader !== null && leader !== undefined) tell(leader, false, `Not that one: next is ${POSES[want]}`);
          return;
        }
        const k = m.shownAt.length - 1;
        const at = m.shownAt[k] ?? now;
        view.strike(leadActor(team), pose, at - now);
        if (at <= now) posePop(sfx, pose);
        else void clock.wait(at - now).then(() => !over && posePop(sfx, pose));
        if (leader === null || leader === undefined) return;
        const next = m.run[k + 1];
        tell(leader, true, next === undefined ? `All shown! Now ${nameOf(followers[team] ?? 0)} copies.` : `Next: ${POSES[next]}`);
      };

      const copy = (team: number, pose: number, at: number) => {
        const m = mirrors[team];
        const follower = followers[team] ?? 0;
        if (!m) return;
        const want = m.run[m.copies.length] ?? 0;
        const { result, points } = copyPose(m, pose, at);
        if (result === 'done') return;
        if (result === 'early') {
          tell(follower, false, `Watch ${leaderName(team)} first!`);
          return;
        }
        view.strike(follower, pose);
        if (result === 'right') {
          totals[team] = (totals[team] ?? 0) + points;
          view.say(follower, `+${points}`, '#fff6a8');
          rightCopy(sfx);
          tell(follower, true, `Nice copy! +${points}`);
        } else {
          view.say(follower, 'Oops', '#ffb3c0');
          wrongCopy(sfx);
          tell(follower, false, `Oops, that was ${POSES[want]}`);
          buzz(follower, [60, 40, 60]);
        }
        if (isCopied(m)) {
          const n = rightCopies(m);
          const text = `All copied: ${n} of ${m.run.length} right`;
          tell(follower, n === m.run.length, text);
          const leader = leaders[team];
          if (leader !== null && leader !== undefined) tell(leader, n === m.run.length, text);
          if (n === m.run.length) for (const p of teams[team] ?? []) view.actors[p]?.companion.react('happy', 1.4);
        }
        live();
      };

      const off = session.onInput((seat, msg) => {
        if (msg.t !== 'press' || over || session.isCpu(seat) || msg.index >= POSES.length) return;
        const p = posOf.get(seat);
        const team = p === undefined ? undefined : teamOf.get(p);
        if (p === undefined || team === undefined) return;
        if (p === leaders[team]) lead(team, msg.index);
        else if (p === followers[team]) {
          // When the finger moved, on the game clock: the press took about half the round trip to arrive.
          const raw = now + Math.max(0, (performance.now() - frameAt) / 1000) * clock.speed;
          const lag = Math.min(0.15, (session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed;
          copy(team, msg.index, raw - lag);
        }
      });

      // Computer leaders (and reflections) press the run at their pace; computer followers copy what they saw.
      const leadAt = teams.map((_, team) => {
        const l = leaders[team];
        const auto = l === null || l === undefined || cpu(l);
        return auto ? cpuLeadGap(rng, l === null || l === undefined ? 0.6 : (skill[l] ?? 0.5), true) : Infinity;
      });
      const copyAt: (number | null)[] = teams.map(() => null);
      const lastCopy = teams.map(() => -1);
      const limit = roundTime(len);
      let hudAt = -1;
      await everyFrame(clock, (_, t) => {
        now = t;
        frameAt = performance.now();
        teams.forEach((_, team) => {
          const m = mirrors[team];
          if (!m) return;
          const l = leaders[team];
          const f = followers[team] ?? 0;
          if (t >= (leadAt[team] ?? Infinity) && m.shownAt.length < m.run.length) {
            const s = l === null || l === undefined ? 0.6 : (skill[l] ?? 0.5);
            lead(team, m.run[m.shownAt.length] ?? 0);
            leadAt[team] = t + cpuLeadGap(rng, s, false);
          }
          if (cpu(f) && !isCopied(m)) {
            const k = m.copies.length;
            const shown = m.shownAt[k];
            const s = skill[f] ?? 0.5;
            if (shown !== undefined && copyAt[team] === null) copyAt[team] = Math.max(shown + cpuCopyDelay(rng, s), (lastCopy[team] ?? -1) + 0.25);
            const at = copyAt[team];
            if (at !== null && at !== undefined && t >= at) {
              const want = m.run[k] ?? 0;
              copyAt[team] = null;
              lastCopy[team] = at;
              copy(team, cpuSlips(rng, s, k) ? otherPose(rng, want) : want, at);
            }
          }
          view.setPips(team, m, t);
        });
        if (t - hudAt >= 0.1) {
          hudAt = t;
          ui.timer(limit - t);
        }
        return t >= limit || mirrors.every(isCopied);
      });
      off();
      ui.timer(null);

      // The round's tally, then swap.
      mirrors.forEach((m, team) => {
        const n = rightCopies(m);
        rights[team] = (rights[team] ?? 0) + n;
        view.setPips(team, m, Infinity);
        view.cheer(team, `${n} of ${m.run.length}`);
        if (!isCopied(m)) {
          const f = followers[team] ?? 0;
          tell(f, n > 0, `Time! ${n} of ${m.run.length} copied.`);
          const leader = leaders[team];
          if (leader !== null && leader !== undefined) tell(leader, n > 0, `Time! ${n} of ${m.run.length} copied.`);
        }
      });
      poses += len;
      live();
      if (round < MIRROR.rounds - 1) {
        await clock.wait(0.8);
        teams.forEach((members, team) => {
          for (const p of members) {
            const leadsNext = leaderOf(round + 1, members.length) !== null && members[leaderOf(round + 1, members.length) ?? 0] === p;
            session.setLayout(seatOf(p), { kind: 'wait', title: 'Swap!', text: leadsNext ? `Round ${round + 2}: you lead.` : `Round ${round + 2}: you copy.` });
          }
          view.setPips(team, null, 0);
        });
        ui.caption('Swap: the partners change places!');
        await clock.wait(MIRROR.gap - 0.8);
      }
    }
    over = true;
    ui.caption(null);
    view.hideSpots();

    // The best mirror work cheers.
    const best = Math.max(...totals);
    const tie = totals.length > 1 && totals.every((v) => v === best);
    sfx.good();
    teams.forEach((members, team) => {
      const won = totals[team] === best;
      for (const p of members) {
        view.actors[p]?.companion.setBase(tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) view.actors[p]?.companion.react('happy', 3);
        tell(p, won, tie ? 'Done! Exactly as in sync as each other.' : won ? 'Done! Your team was the most in sync!' : 'Done! They were a little more in sync.');
      }
      if (won && !tie) view.cheer(team, 'Perfect mirror!');
    });
    await clock.wait(1.6);

    return {
      scores: mirrorScores(totals, teams, seats.length),
      details: seats.map((_, p) => {
        const team = teamOf.get(p);
        if (team === undefined) return '';
        return `${rights[team] ?? 0} of ${poses} copied · ${totals[team] ?? 0} pts`;
      }),
    };
  },
};
