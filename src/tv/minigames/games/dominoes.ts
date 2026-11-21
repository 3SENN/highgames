// Domino Run on the TV: a living room late at night, a rug and a long domino run that snakes across the floor in
// three legs (one per round, back to front). Each section is in its builder's colour; while you slide, its dominoes
// spread out or bunch up live, and a ghost domino keeps tipping over to show how far one reaches. Then a finger
// pokes the first domino and the run goes, section by section, with a marble rolling across each handover.
import * as THREE from 'three';
import {
  DOMINO,
  DOMINO_KINDS,
  type DominoCpu,
  type DominoGame,
  type DominoKind,
  type Section,
  type SectionResult,
  activeSection,
  buildTime,
  cpuDominoPlan,
  cpuDominoSlider,
  dominoCoop,
  layoutSection,
  lockRound,
  newDominoGame,
  sectionResult,
  seatQueue,
  seatTally,
  setSection,
  slide,
  toppled,
} from '../../../game/minigames/dominoes';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { type Env, livingRoom } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, canvasTexture, cone, cyl, mix, nameCard, part, pill, popSprite, rbox, torus } from '../../render/toon';
import type { Sfx } from '../../audio';
import type { View } from '../../stage';
import { Floaters, type Mark, frameMarks, noise, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const ROW_Z = [-3.3, 0, 3.3]; // one leg per round, back to front (builders only ever step over fallen legs)
const ROW_DIR = [1, -1, 1]; // which way each leg runs (the run snakes)
const CREW_BACK = 1.55; // the builders stand this far behind the leg
const MARBLE_R = 0.11;
const CREAM = P.cream;
const TAPE = P.linen; // masking tape
const QUIET = { outline: false as const };
const RUG = 0.024; // the top of the rug the run stands on
const ROOM = 2; // the room is built twice life size: the builders are small next to a sofa

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface Piece {
  pivot: THREE.Group;
  tip: THREE.Group;
  fallAt: number;
  dur: number;
  rest: number;
  wobbleAt: number;
}

interface Ghost {
  pivot: THREE.Group;
  tip: THREE.Group;
}

interface Roll {
  at: number;
  dur: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

interface Timed {
  at: number;
  fn: () => void;
}

/** Little bursts of soft glowing sparks (dust, glitter, embers). One draw call for all of them. */
class Sparks {
  private readonly max = 96;
  private readonly pos = new Float32Array(this.max * 3).fill(-999);
  private readonly col = new Float32Array(this.max * 3);
  private readonly vel = new Float32Array(this.max * 3);
  private readonly life = new Float32Array(this.max);
  private readonly tint: THREE.Color[] = Array.from({ length: this.max }, () => new THREE.Color());
  private readonly map = canvasTexture(64, 64, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  });
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private next = 0;

  constructor(scene: THREE.Scene, size = 0.16, private readonly gravity = 2.2) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: this.map, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** `n` sparks from `at`, flying outwards at about `speed` and upwards by `up` times that. */
  burst(at: THREE.Vector3, color: string, n = 10, speed = 1.4, up = 1): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const r = speed * (0.4 + Math.random() * 0.6);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([Math.cos(a) * r, (0.3 + Math.random()) * speed * up, Math.sin(a) * r], i * 3);
      this.life[i] = 0.6 + Math.random() * 0.5;
      (this.tint[i] as THREE.Color).set(color);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const l = this.life[i] as number;
      if (l <= 0) continue;
      const left = l - dt;
      this.life[i] = left;
      const j = i * 3;
      this.vel[j + 1] = (this.vel[j + 1] as number) - dt * this.gravity;
      for (let a = 0; a < 3; a++) this.pos[j + a] = (this.pos[j + a] as number) + (this.vel[j + a] as number) * dt;
      const t = this.tint[i] as THREE.Color;
      const f = Math.max(0, Math.min(1, left * 2.2));
      this.col.set([t.r * f, t.g * f, t.b * f], j);
      if (left <= 0) this.pos[j + 1] = -999;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.map.dispose();
  }
}

/** A gap between the end of one section and the start of the next: room for the marble that carries the run over. */
function linkFor(sections: readonly Section[]): number {
  return 0.45 * Math.max(...sections.map((s) => s.h)) + 0.45;
}

/** How long a leg is along the floor. */
function legLength(sections: readonly Section[]): number {
  return sections.length * DOMINO.length + (sections.length - 1) * linkFor(sections);
}

/** One leg of the run: its sections' dominoes, ghosts, tape and the marbles between them. */
class Leg {
  readonly root = new THREE.Group();
  readonly starts: number[];
  readonly length: number;
  readonly pieces: Piece[][] = [];
  readonly ghosts: Ghost[] = [];
  readonly marbles: THREE.Mesh[] = [];
  readonly rolls: (Roll | null)[] = [];
  readonly counts: number[] = [];
  readonly checks: THREE.Sprite[] = [];
  readonly dir: number;
  readonly z: number;
  readonly hMax: number;

  constructor(
    readonly round: number,
    readonly sections: Section[],
    seats: MinigameSeat[],
  ) {
    this.dir = ROW_DIR[round] ?? 1;
    this.z = ROW_Z[round] ?? 0;
    this.hMax = Math.max(...sections.map((s) => s.h));
    const link = linkFor(sections);
    this.starts = sections.map((_, k) => k * (DOMINO.length + link));
    this.length = legLength(sections);
    const wMax = Math.max(...sections.map((s) => s.w));

    sections.forEach((s, k) => {
      const color = seats[s.seat]?.color ?? '#ffffff';
      // The builder's tape on the floor, under the whole section.
      const mid = this.at(this.starts[k] as number, DOMINO.length / 2);
      part(this.root, rbox(DOMINO.length + 0.1, 0.014, wMax + 0.42, 0.006), mix(color, P.aubergine, 0.7), mid.x, 0.03, mid.z, { outline: false, shadow: false });
      for (const e of [-1, 1]) part(this.root, rbox(DOMINO.length + 0.1, 0.016, 0.05, 0.006), color, mid.x, 0.031, mid.z + e * (wMax / 2 + 0.21), { outline: false, shadow: false });
      // A pool of dominoes; arrange() shows as many as the spacing fits.
      const list: Piece[] = [];
      const pip = Math.min(0.035, s.t * 0.26);
      for (let i = 0; i < DOMINO.maxCount; i++) {
        const pivot = new THREE.Group();
        pivot.rotation.y = this.dir > 0 ? 0 : Math.PI;
        const tip = new THREE.Group();
        pivot.add(tip);
        part(tip, rbox(s.t, s.h, s.w, Math.min(0.04, s.t * 0.3)), i % 2 ? mix(color, P.cream, 0.2) : color, -s.t / 2, s.h / 2, 0, { gloss: 0.4 });
        // the groove across the middle, on both faces
        part(tip, rbox(s.t + 0.006, Math.max(0.012, s.h * 0.025), s.w * 0.82, 0.004), mix(color, P.ink, 0.45), -s.t / 2, s.h / 2, 0, { outline: false, shadow: false });
        for (const y of [0.28, 0.72]) part(tip, ball(pip, 1), CREAM, -s.t / 2, s.h * y, (s.w / 2 + 0.004) * this.dir, { outline: false, shadow: false });
        pivot.visible = false;
        this.root.add(pivot);
        list.push({ pivot, tip, fallAt: Infinity, dur: 0.3, rest: 0, wobbleAt: Infinity });
      }
      this.pieces.push(list);
      this.counts.push(0);
      // The ghost: a see-through domino that keeps tipping over, the arc its top travels and where it lands.
      const gp = new THREE.Group();
      gp.rotation.y = this.dir > 0 ? 0 : Math.PI;
      const gt = new THREE.Group();
      gp.add(gt);
      part(gt, rbox(s.t, s.h, s.w, Math.min(0.04, s.t * 0.3)), P.cream, -s.t / 2, s.h / 2, 0, { opacity: 0.42, shadow: false });
      part(gp, torus(s.h, 0.014, Math.PI / 2), P.cream, 0, 0, 0, { opacity: 0.75, outline: false, shadow: false });
      part(gp, cyl(0.075, 0.075, 0.014, 16), P.lamp, s.h, 0.036, 0, { glow: 1.6, outline: false, shadow: false });
      gp.visible = false;
      this.root.add(gp);
      this.ghosts.push({ pivot: gp, tip: gt });
      const check = popSprite('✔', color, 0.42);
      check.visible = false;
      check.position.copy(mid).setY(this.hMax + 0.55);
      this.root.add(check);
      this.checks.push(check);
      if (k < sections.length - 1) {
        const m = part(this.root, ball(MARBLE_R, 2), [P.screen, P.rose, P.sage][k % 3] as string, 0, MARBLE_R, this.z, { glow: 0.3, gloss: 0.7 });
        this.marbles.push(m);
        this.rolls.push(null);
        // A little coaster keeps it from rolling off early.
        const c = this.at(this.starts[k] as number, DOMINO.length + link / 2);
        part(this.root, torus(0.13, 0.025), P.brass, c.x, 0.045, c.z, { rx: Math.PI / 2, gloss: 0.6, outline: false, shadow: false });
      }
      this.arrange(k);
    });
    // Little end caps of tape where the leg starts and ends.
    for (const s of [-0.35, this.length + 0.35]) {
      const p = this.at(s, 0);
      part(this.root, rbox(0.12, 0.014, wMax + 0.42, 0.006), TAPE, p.x, 0.03, p.z, { outline: false, shadow: false });
    }
  }

  /** A point on the leg: `s` along it (from the first section's start) plus `extra`. */
  at(s: number, extra: number): THREE.Vector3 {
    return new THREE.Vector3(this.dir * (s + extra - this.length / 2), 0, this.z);
  }

  centre(k: number): THREE.Vector3 {
    return this.at(this.starts[k] as number, DOMINO.length / 2);
  }

  /** Stands section k's dominoes at its slider value. */
  arrange(k: number): void {
    const s = this.sections[k];
    const list = this.pieces[k];
    if (!s || !list) return;
    const lay = layoutSection(s, s.value);
    this.counts[k] = lay.count;
    const start = this.starts[k] as number;
    list.forEach((p, i) => {
      p.pivot.visible = i < lay.count;
      if (i < lay.count) p.pivot.position.copy(this.at(start, i * lay.pitch + s.t)).setY(RUG);
    });
    const g = this.ghosts[k];
    if (g) g.pivot.position.copy(this.at(start, s.t)).setY(0.026);
    const m = this.marbles[k];
    if (m) {
      const last = (lay.count - 1) * lay.pitch + s.t;
      const spot = Math.min(last + 0.55 * s.h + MARBLE_R, DOMINO.length + linkFor(this.sections) - MARBLE_R * 2.2);
      m.position.copy(this.at(start, spot)).setY(MARBLE_R + RUG);
    }
  }

  /** Where a finger pokes section k's first domino. */
  pokePoint(k: number): THREE.Vector3 {
    const s = this.sections[k];
    const start = this.starts[k] as number;
    return this.at(start, -0.02).setY((s?.h ?? 0.5) * 0.92);
  }

  /**
   * Plans the topple from `now`: every domino's fall, the marbles and the pokes. `on` gets section results as they
   * happen. Returns the timed events and when the run is over.
   */
  plan(now: number, sfx: Sfx, poke: (at: number, p: THREE.Vector3, dir: number) => void, on: (k: number, r: SectionResult) => void): { events: Timed[]; end: number } {
    const events: Timed[] = [];
    let t = now + 0.6;
    poke(t, this.pokePoint(0), this.dir);
    this.sections.forEach((s, k) => {
      const list = this.pieces[k] ?? [];
      const lay = layoutSection(s, s.value);
      const res = sectionResult(s);
      const hop = 0.05 + 0.065 * s.h;
      const n = toppled(res, lay.count);
      const lean = Math.acos(clamp01(s.t / lay.pitch));
      const touch = Math.asin(Math.min(0.99, lay.gap / s.h));
      for (let i = 0; i < n; i++) {
        const p = list[i];
        if (!p) continue;
        p.fallAt = t + i * hop;
        p.dur = hop * 2.2;
        if (res === 'ok') p.rest = i < lay.count - 1 ? lean : Math.PI / 2 - 0.04;
        else if (res === 'close') p.rest = i < n - 1 ? lean : touch + 0.04;
        else p.rest = lay.gap < s.h ? touch : Math.PI / 2 - 0.04;
        const pitch = 1500 + k * 140 + (i % 3) * 90;
        events.push({ at: p.fallAt, fn: () => tone(sfx, { freq: pitch, dur: 0.035, type: 'triangle', gain: 0.045 }) });
      }
      const stuck = res === 'ok' ? null : list[res === 'close' ? n : 1];
      if (stuck && (res === 'close' || lay.gap < s.h)) {
        stuck.wobbleAt = t + n * hop + hop * 0.2;
        events.push({ at: stuck.wobbleAt, fn: () => tone(sfx, { freq: res === 'close' ? 170 : 420, to: res === 'close' ? 95 : 300, dur: 0.14, type: 'triangle', gain: 0.12 }) });
      }
      const end = t + (n - 1) * hop + hop * 2.4;
      events.push({ at: end, fn: () => on(k, res) });
      if (k === this.sections.length - 1) {
        t = end;
        return;
      }
      if (res === 'ok') {
        // The last domino knocks the marble across to the next section's first domino.
        const m = this.marbles[k];
        const at = t + (lay.count - 1) * hop + hop * 1.6;
        const next = this.starts[k + 1] as number;
        const to = this.at(next, -MARBLE_R * 1.05).setY(MARBLE_R + RUG);
        const dist = m ? m.position.distanceTo(to) : 0.5;
        const dur = 0.15 + dist * 0.26;
        if (m) this.rolls[k] = { at, dur, from: m.position.clone(), to };
        events.push({ at, fn: () => noise(sfx, { dur: dur + 0.1, filter: 'bandpass', freq: 900, to: 500, gain: 0.07 }) });
        t = at + dur;
      } else {
        // Nothing gets there: a sigh, and a finger gets the next section going.
        events.push({ at: end + 0.25, fn: () => sigh(sfx) });
        t = end + 1.1;
        poke(t, this.pokePoint(k + 1), this.dir);
      }
    });
    return { events, end: t + 0.5 };
  }

  update(time: number): void {
    this.pieces.forEach((list) =>
      list.forEach((p) => {
        if (!p.pivot.visible) return;
        let a = 0;
        if (time >= p.fallAt) {
          const u = clamp01((time - p.fallAt) / p.dur);
          a = p.rest * u * u;
        } else if (time >= p.wobbleAt) {
          const u = clamp01((time - p.wobbleAt) / 0.9);
          a = 0.11 * Math.sin(u * Math.PI * 4) * (1 - u);
        }
        p.tip.rotation.z = -a;
      }),
    );
    this.rolls.forEach((r, k) => {
      const m = this.marbles[k];
      if (!r || !m || time < r.at) return;
      const u = clamp01((time - r.at) / r.dur);
      const e = 1 - (1 - u) ** 2;
      m.position.lerpVectors(r.from, r.to, e);
      m.rotation.z = -this.dir * ((r.from.distanceTo(r.to) * e) / MARBLE_R);
    });
  }

  /** The ghost of the section being built tips over and over. */
  showGhost(k: number, on: boolean): void {
    const g = this.ghosts[k];
    if (g) g.pivot.visible = on;
  }

  tickGhosts(time: number): void {
    for (const g of this.ghosts) {
      if (!g.pivot.visible) continue;
      const u = (time % 1.7) / 1.7;
      const k = clamp01(u / 0.55);
      g.tip.rotation.z = -(Math.PI / 2) * k * k;
      g.tip.visible = u < 0.85;
    }
  }
}

/** A cartoon hand that pokes a domino. Its fingertip is the group's origin. */
function handModel(): THREE.Group {
  const g = new THREE.Group();
  const skin = P.clay;
  part(g, pill(0.05, 0.24), skin, 0, 0.17, 0, { exact: true });
  part(g, ball(0.19, 2), skin, 0, 0.44, 0.02, { sx: 1.05, sy: 0.85, sz: 0.75, exact: true });
  for (const [x, y] of [
    [0.1, 0.33],
    [0.03, 0.31],
    [-0.05, 0.33],
  ] as const)
    part(g, ball(0.06, 1), skin, x, y, 0.1, { exact: true });
  part(g, pill(0.045, 0.1), skin, -0.15, 0.4, 0.06, { rz: 0.7, exact: true });
  part(g, cyl(0.17, 0.17, 0.75, 16), P.mauve, 0, 0.92, 0.02, { tex: 'knit', texScale: 0.3 });
  part(g, torus(0.17, 0.045), P.cream, 0, 0.6, 0.02, { rx: Math.PI / 2, tex: 'knit', texScale: 0.3 });
  return g;
}

function sigh(sfx: Sfx): void {
  tone(sfx, { freq: 330, to: 190, dur: 0.7, type: 'triangle', gain: 0.07 });
  noise(sfx, { dur: 0.6, filter: 'lowpass', freq: 700, to: 160, gain: 0.06 });
}

function chime(sfx: Sfx, up: number): void {
  tone(sfx, { freq: 660 * up, to: 990 * up, dur: 0.16, gain: 0.07 });
  tone(sfx, { freq: 990 * up, dur: 0.2, gain: 0.05, delay: 0.09 });
}

interface Poke {
  at: number;
  p: THREE.Vector3;
  dir: number;
}

class DominoView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly crew: Companion[];
  readonly floaters: Floaters;
  private readonly probe = new THREE.PerspectiveCamera();
  private readonly legs: Leg[] = [];
  private leg: Leg | null = null;
  private events: Timed[] = [];
  private pokes: Poke[] = [];
  private readonly hand: THREE.Group;
  private readonly cards: THREE.Sprite[] = [];
  private growing: Leg | null = null;
  private growT = 0;
  private readonly walks: ({ from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null)[] = [];
  private readonly env: Env;
  private readonly sparks: Sparks;
  private readonly tail: THREE.Mesh;
  private fitKey = '';
  private framing = 0;
  private marks: Mark[] = [];
  private readonly camPos = new THREE.Vector3(0, 9, 16);
  private readonly camLook = new THREE.Vector3(0, 0, 0);
  private readonly look = new THREE.Vector3(0, 0, 0);
  private snap = true;

  constructor(
    private readonly seats: MinigameSeat[],
    companions: Companion[],
    game: DominoGame,
    private readonly sfx: Sfx,
  ) {
    this.crew = companions;
    this.floaters = new Floaters(this.scene);
    this.sparks = new Sparks(this.scene, 0.16, 1.4);
    const s = this.scene;
    // The living room late in the evening, built twice life size around the run: lamps on, a record turning.
    this.env = livingRoom(s, { mood: 'evening', w: 14.5, d: 8.6, h: 4.8, rug: false, seed: 3, accent: P.teal });
    this.env.root.scale.setScalar(ROOM);
    for (const l of this.env.lamps) {
      l.distance *= ROOM * 1.4;
      l.intensity *= ROOM * 2.2;
    }
    // the key light covers the whole run, not just the middle of the room
    const sc = this.env.sun.shadow.camera;
    sc.left = sc.bottom = -15;
    sc.right = sc.top = 15;
    sc.updateProjectionMatrix();
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, sc2 = 1): T => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(sc2);
      s.add(o);
      return o;
    };
    // The big rug the run is built on: deep and plain, so every builder's colour stands out on it.
    put(props.rug({ w: 21.5, d: 10.6, color: mix(P.plum, P.slate, 0.3), border: mix(P.mauve, P.cream, 0.25) }), 0, 0, 0);
    // The sofa against the back wall, with a throw, cushions and a sleepy cat on it.
    const v = { tex: 'velvet' as const, texScale: 1.6 };
    const sofa = P.teal;
    part(s, rbox(6.2, 0.8, 1.9, 0.18), sofa, -3.2, 0.6, -7.2, v);
    part(s, rbox(6.2, 1.3, 0.5, 0.18), sofa, -3.2, 1.35, -7.95, v);
    for (const x of [-6.1, -0.3]) part(s, rbox(0.5, 1.1, 1.9, 0.18), mix(sofa, P.ink, 0.12), x, 0.95, -7.2, v);
    for (const x of [-4.65, -1.75]) part(s, rbox(2.75, 0.3, 1.6, 0.14), mix(sofa, P.cream, 0.18), x, 1.12, -7.05, v);
    for (const x of [-5.9, -0.5]) for (const z of [-6.45, -7.95]) part(s, cyl(0.09, 0.06, 0.2, 8), P.walnut, x, 0.1, z, QUIET);
    part(s, rbox(0.9, 0.8, 0.3, 0.14), P.mustard, -5.2, 1.6, -7.5, { rz: 0.15, tex: 'knit' });
    part(s, rbox(0.8, 0.7, 0.28, 0.12), P.cream, -4.2, 1.55, -7.55, { rz: -0.1, tex: 'fabric' });
    part(s, rbox(0.6, 1.0, 1.95, 0.1), P.terracotta, -0.3, 1.02, -7.2, { tex: 'knit' });
    const fur = mix(P.copper, P.mustard, 0.35);
    part(s, ball(0.32, 2), fur, -1.6, 1.5, -7.0, { sx: 1.5, sy: 0.75 });
    part(s, ball(0.2, 1), fur, -2.05, 1.58, -6.85);
    for (const x of [-2.15, -1.95]) part(s, cone(0.06, 0.12, 8), fur, x, 1.75, -6.85);
    this.tail = part(s, pill(0.05, 0.4), mix(fur, P.walnut, 0.4), -1.05, 1.45, -6.95, { rz: 1.2 });
    // A side table by the sofa with a lamp and a mug; a coffee table pushed out of the way with the game's boxes.
    put(props.sideTable({ h: 0.6 }), 1.0, 0, -7.4, 0, ROOM);
    put(props.tableLamp({ lit: true, light: 14, stand: P.brass }), 1.0, 1.2, -7.4, 0, ROOM);
    put(props.mug({ color: P.terracotta }), 0.75, 1.2, -7.0, 0.4, ROOM);
    put(props.coffeeTable({ w: 1.5, color: P.walnut }), 11.2, 0, 4.4, Math.PI / 2 + 0.15, ROOM);
    [P.terracotta, P.denim, P.mustard].forEach((c, i) => {
      part(s, rbox(0.9, 0.22, 0.5, 0.03), c, 11.2, 0.95 + i * 0.22, 4.6, { ry: i * 0.25 });
      part(s, rbox(0.5, 0.224, 0.2, 0.01), P.cream, 11.2, 0.95 + i * 0.22, 4.6, { ry: i * 0.25, ...QUIET });
    });
    put(props.snackBowl({ fill: 'popcorn', color: P.ceramic }), 11.1, 0.84, 3.2, 0, ROOM);
    // A few dominoes that didn't make it into the run, and the marbles' bag, by the edge of the rug.
    [P.cream, P.linen, P.cream, P.clay].forEach((c, i) => part(s, rbox(0.5, 0.1, 0.26, 0.03), c, -11.6 + (i % 2) * 0.3, 0.05 + Math.floor(i / 2) * 0.1, 5.4 + i * 0.22, { ry: 0.3 + i * 0.5, gloss: 0.4 }));
    part(s, ball(0.3, 1), P.mauve, -11.9, 0.22, 4.4, { sy: 0.75, tex: 'knit', texScale: 0.3 });
    // The planned route in masking tape: three legs joined by U-turns at the ends, so the run snakes.
    const lengths = game.sections.map(legLength);
    const turnX = Math.max(...lengths) / 2 + 0.7;
    for (let r = 0; r < game.sections.length - 1; r++) {
      const side = (ROW_DIR[r] ?? 1) > 0 ? 1 : -1;
      const zA = ROW_Z[r] ?? 0;
      const zB = ROW_Z[r + 1] ?? 0;
      part(this.scene, torus(Math.abs(zA - zB) / 2, 0.05, Math.PI), TAPE, side * turnX, 0.035, (zA + zB) / 2, { rx: Math.PI / 2, rz: side > 0 ? -Math.PI / 2 : Math.PI / 2, outline: false, shadow: false });
      for (const [z, len] of [
        [zA, lengths[r] ?? 0],
        [zB, lengths[r + 1] ?? 0],
      ] as const) {
        const from = len / 2 + 0.35;
        if (turnX - from > 0.05) part(this.scene, rbox(turnX - from, 0.014, 0.1, 0.005), TAPE, (side * (turnX + from)) / 2, 0.035, z, { outline: false, shadow: false });
      }
    }

    // The finger that starts the run (and nudges it on when it stops).
    this.hand = handModel();
    this.hand.visible = false;
    this.scene.add(this.hand);

    seats.forEach((s, i) => {
      const c = companions[i];
      if (c) {
        c.setBase('idle');
        c.root.position.set((i - (seats.length - 1) / 2) * 3, 0, ROW_Z[0] - CREW_BACK);
        this.scene.add(c.root);
      }
      const card = nameCard(s.name, s.color, 0.8);
      this.scene.add(card);
      this.cards.push(card);
      this.walks.push(null);
    });
  }

  /** Lays out the next leg and turns the camera to it. */
  startRound(round: number, sections: Section[]): Leg {
    const leg = new Leg(round, sections, this.seats);
    this.scene.add(leg.root);
    leg.root.scale.setScalar(0.01);
    this.legs.push(leg);
    this.leg = leg;
    this.growing = leg;
    this.growT = 0;
    this.frame(round);
    return leg;
  }

  /** Points the camera at a leg (or, with null, at the whole run). */
  frame(round: number | null): void {
    const legs = round === null ? this.legs : this.legs.filter((l) => l.round === round);
    const marks: Mark[] = [];
    for (const l of legs) {
      for (const s of [-0.4, l.length + 0.4]) {
        const p = l.at(s, 0);
        marks.push({ p: p.clone().setZ(p.z + 0.6) }, { p: p.clone().setY(l.hMax + 0.4) });
      }
      if (round !== null) for (const x of [-l.length / 2, l.length / 2]) marks.push({ p: new THREE.Vector3(x, 2.0, l.z - CREW_BACK), pad: 0.07 });
    }
    this.marks = marks;
    this.framing += 1;
  }

  /** Where builder `seat` stands: behind the section it is working on. */
  stand(seat: number, k: number, walk: boolean): void {
    const c = this.crew[seat];
    const leg = this.leg;
    if (!c || !leg) return;
    const to = leg.centre(k).setZ(leg.z - CREW_BACK);
    if (walk && c.root.position.distanceTo(to) > 0.2) {
      this.walks[seat] = { from: c.root.position.clone(), to, t: 0, dur: Math.min(1.4, 0.3 + c.root.position.distanceTo(to) * 0.12) };
      c.move('walk', 2.2);
    } else {
      c.root.position.copy(to);
      this.walks[seat] = null;
    }
  }

  arrange(s: Section): void {
    this.legOf(s)?.arrange(s.index);
  }

  /** Every section the given seats are working on shows its ghost; set ones show a tick. */
  marksFor(active: (Section | null)[]): void {
    const leg = this.leg;
    if (!leg) return;
    leg.sections.forEach((x, k) => {
      leg.showGhost(k, !x.set && active.includes(x));
      const check = leg.checks[k];
      if (check) check.visible = x.set;
    });
  }

  /** Runs the current leg; resolves when it is over. */
  topple(now: number, on: (k: number, r: SectionResult) => void): number {
    const leg = this.leg;
    if (!leg) return now;
    leg.sections.forEach((_, k) => {
      leg.showGhost(k, false);
      const check = leg.checks[k];
      if (check) check.visible = false;
    });
    const { events, end } = leg.plan(now, this.sfx, (at, p, dir) => this.pokes.push({ at, p, dir }), on);
    this.events.push(...events);
    return end;
  }

  private legOf(s: Section): Leg | undefined {
    return this.legs.find((l) => l.round === s.round);
  }

  /** A section went all the way: a little shower of sparks over it, in its builder's colour. */
  cheer(s: Section, color: string): void {
    const leg = this.legOf(s);
    if (!leg) return;
    const c = leg.centre(s.index);
    for (const dx of [-1.2, 0, 1.2]) this.sparks.burst(new THREE.Vector3(c.x + dx, leg.hMax + 0.3, c.z), dx ? color : P.lamp, 8, 1.3, 1.5);
  }

  /** Above the middle of a section (for words that float up). */
  spotAbove(s: Section): THREE.Vector3 {
    const leg = this.legOf(s);
    return leg ? leg.centre(s.index).setY(leg.hMax + 0.75) : new THREE.Vector3();
  }

  dispose(): void {
    for (const c of this.crew) c.dispose();
    this.floaters.dispose();
    this.sparks.dispose();
    for (const card of this.cards) {
      card.material.map?.dispose();
      card.material.dispose();
    }
    for (const l of this.legs)
      for (const s of l.checks) {
        s.material.map?.dispose();
        s.material.dispose();
      }
  }

  update(dt: number, time: number): void {
    for (const c of this.crew) c.update(dt);
    this.floaters.update(dt);
    this.sparks.update(dt);
    this.env.update(dt, time);
    // A new leg pops up out of the rug.
    if (this.growing) {
      this.growT = Math.min(1, this.growT + dt / 0.6);
      const k = this.growT;
      this.growing.root.scale.set(1, Math.max(0.01, 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2), 1);
      if (k >= 1) this.growing = null;
    }
    for (const l of this.legs) {
      l.update(time);
      l.tickGhosts(time);
    }
    this.events = this.events.filter((e) => {
      if (time < e.at) return true;
      e.fn();
      return false;
    });
    this.updateHand(time);
    // Builders walking to their next section.
    this.walks.forEach((w, i) => {
      const c = this.crew[i];
      if (!w || !c) return;
      w.t += dt;
      const k = clamp01(w.t / w.dur);
      c.root.position.lerpVectors(w.from, w.to, k);
      if (k >= 1) {
        c.move(null);
        this.walks[i] = null;
      }
    });
    this.crew.forEach((c, i) => {
      c.root.rotation.y = Math.atan2(this.camera.position.x - c.root.position.x, this.camera.position.z - c.root.position.z);
      const card = this.cards[i];
      if (card) card.position.copy(c.root.position).setY(2.0);
    });
    this.tail.rotation.z = 1.2 + Math.sin(time * 1.1) * 0.25;
    this.updateCamera(dt);
  }

  private updateHand(time: number): void {
    const p = this.pokes.find((k) => time >= k.at - 0.55 && time <= k.at + 0.6);
    this.hand.visible = Boolean(p);
    if (!p) return;
    const u = time - p.at;
    const back = new THREE.Vector3(-p.dir * 0.12, 0, 0);
    let y = 0;
    let push = 0;
    if (u < -0.08) y = ((-0.08 - u) / 0.47) ** 2 * 2.6;
    else if (u < 0.12) push = clamp01((u + 0.08) / 0.2) * 0.12;
    else {
      push = 0.12;
      y = ((u - 0.12) / 0.48) ** 2 * 2.6;
    }
    this.hand.position.copy(p.p).add(back).add(new THREE.Vector3(p.dir * push, y, 0));
    this.hand.rotation.set(0.3, 0, p.dir * 0.35);
  }

  private updateCamera(dt: number): void {
    const key = `${this.camera.aspect.toFixed(3)}|${this.framing}`;
    if (key !== this.fitKey && this.marks.length) {
      this.fitKey = key;
      this.probe.fov = this.camera.fov;
      this.probe.aspect = this.camera.aspect;
      this.probe.updateProjectionMatrix();
      const { pos, look } = frameMarks(this.probe, this.marks, 0.62);
      this.camPos.copy(pos);
      this.camLook.copy(look);
    }
    const k = this.snap ? 1 : 1 - Math.exp(-dt * 2.6);
    this.snap = false;
    this.camera.position.lerp(this.camPos, k);
    this.look.lerp(this.camLook, k);
    this.camera.lookAt(this.look);
  }
}

const KIND_WORD: Record<DominoKind, string> = { tall: 'tall', short: 'short', chunky: 'chunky' };

export const minigame: Minigame = {
  id: 'dominoes',
  title: 'Domino Run',
  how: 'Everyone builds a section of one long domino run. Slide to space your dominoes and press Set: about two-thirds of their height apart is just right (the ghost domino on the TV shows how far one reaches). Too close jams, too far stops the run!',
  controller: 'slider',
  kind: 'coop',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const game: DominoGame = newDominoGame(rng, n);
    const skill = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : 0.5));
    const view = new DominoView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.3 }))), game, sfx);
    ctx.stage.setView(view);

    let round = 0;
    let building = false;
    const plans = new Map<Section, DominoCpu>();
    /** Sections whose run the TV has shown already. */
    const shown = new Set<Section>();
    const active = () => seats.map((_, i) => activeSection(game, round, i));
    const hud = () =>
      ui.live(
        seats.map((s, i) => {
          const mine = [...shown].filter((x) => x.seat === i);
          const ok = mine.filter((x) => sectionResult(x) === 'ok').length;
          const state = building ? (activeSection(game, round, i) ? 'Building…' : 'Set ✔') : '';
          const tally = mine.length ? `${ok}/${mine.length} clean` : '';
          return { name: s.name, color: s.color, thumb: s.thumb, value: [tally, state].filter(Boolean).join(' · ') || '…' };
        }),
      );

    /** Hands a seat its next section (or the wait screen once its sections are set). */
    const next = (seat: number, walk: boolean) => {
      const s = activeSection(game, round, seat);
      view.marksFor(active());
      hud();
      if (!s) {
        if (!session.isCpu(seat)) session.setLayout(seat, { kind: 'wait', title: 'All set!', text: 'Watch the big screen' });
        return;
      }
      const queue = seatQueue(game, round, seat);
      const j = queue.indexOf(s);
      view.stand(seat, s.index, walk);
      view.crew[seat]?.setBase('thinking');
      if (session.isCpu(seat)) return;
      const which = queue.length > 1 ? ` · section ${j + 1} of ${queue.length}` : '';
      session.setLayout(seat, {
        kind: 'slider',
        note: `Round ${round + 1}: ${KIND_WORD[s.kind]} dominoes${which}. Space them about two-thirds of the ghost's reach.`,
        low: 'Close',
        high: 'Far',
        done: 'Set!',
        value: s.start,
      });
    };

    const press = (seat: number, s: Section, value: number) => {
      setSection(s, value);
      view.arrange(s);
      view.crew[seat]?.react('approval', 0.9);
      tone(sfx, { freq: 520, to: 780, dur: 0.1, type: 'triangle', gain: 0.08 });
      next(seat, true);
    };

    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'slider' || seat >= n || session.isCpu(seat) || !building) return;
      const s = activeSection(game, round, seat);
      if (!s) return;
      slide(s, msg.value);
      view.arrange(s);
      if (msg.done) press(seat, s, msg.value);
    });

    let clean = 0;
    for (round = 0; round < DOMINO.rounds; round++) {
      const sections = game.sections[round] ?? [];
      const kind = game.kinds[round] ?? 'tall';
      view.startRound(round, sections);
      ui.caption(`Round ${round + 1} of ${DOMINO.rounds}: ${DOMINO_KINDS[kind].name.toLowerCase()} dominoes!`);
      seats.forEach((_, i) => {
        const s = activeSection(game, round, i);
        if (s) view.stand(i, s.index, round > 0);
      });
      session.setLayoutAll(() => ({ kind: 'wait', title: `Round ${round + 1}: ${KIND_WORD[kind]} dominoes`, text: 'Look at the big screen' }));
      await clock.wait(1.0);

      // Build: everyone slides their spacing and presses Set.
      building = true;
      seats.forEach((_, i) => next(i, true));
      ui.caption('Slide to space your dominoes, then press Set!');
      const limit = buildTime(n);
      const t0 = clock.time;
      let tick = 4;
      await everyFrame(clock, () => {
        const now = clock.time;
        seats.forEach((_, i) => {
          if (!session.isCpu(i)) return;
          const s = activeSection(game, round, i);
          if (!s) return;
          let plan = plans.get(s);
          if (!plan) {
            plan = cpuDominoPlan(s, skill[i] ?? 0.5, rng, now);
            plans.set(s, plan);
          }
          const v = cpuDominoSlider(plan, now);
          slide(s, v.value);
          view.arrange(s);
          if (v.done) press(i, s, v.value);
        });
        const left = limit - (now - t0);
        ui.timer(Math.max(0, left));
        const whole = Math.ceil(left);
        if (whole <= 3 && whole > 0 && whole < tick) {
          tick = whole;
          sfx.tick();
        }
        return left <= 0 || active().every((s) => s === null);
      });
      building = false;
      ui.timer(null);
      lockRound(game, round);
      for (const s of sections) view.arrange(s);
      view.marksFor([]);
      session.setLayoutAll(() => ({ kind: 'wait', title: 'Here goes…', text: 'Watch the run on the big screen' }));
      for (const c of view.crew) c.setBase('listening');
      ui.caption('Here goes…');

      // The run: section by section.
      let ok = 0;
      const end = view.topple(clock.time, (k, res) => {
        const s = sections[k];
        if (!s) return;
        shown.add(s);
        const seat = seats[s.seat];
        const at = view.spotAbove(s);
        if (res === 'ok') {
          ok += 1;
          chime(sfx, 1 + k * 0.06);
          view.floaters.add('✔', seat?.color ?? '#ffffff', at, 0.5);
          view.cheer(s, seat?.color ?? '#ffffff');
          view.crew[s.seat]?.react('happy', 1.6);
        } else {
          sfx.bad();
          view.floaters.add(res === 'close' ? 'Jammed!' : 'Too far!', '#ffb0bd', at, 0.42, 1.5);
          view.crew[s.seat]?.react('sad', 1.8);
          if (!session.isCpu(s.seat)) session.send(s.seat, { t: 'buzz', pattern: [120] });
        }
        ui.caption(res === 'ok' ? `${seat?.name ?? 'Someone'}'s section went over!` : res === 'close' ? `Jammed in ${seat?.name ?? 'someone'}'s section: a bit too close.` : `Stopped in ${seat?.name ?? 'someone'}'s section: a bit too far.`);
        hud();
      });
      await clock.wait(Math.max(0.5, end - clock.time));
      clean += ok;
      for (const c of view.crew) c.setBase('idle');
      ui.caption(ok === sections.length ? 'The whole leg went over. Lovely.' : `${ok} of ${sections.length} sections went over.`);
      if (ok === sections.length) sfx.good();
      hud();
      await clock.wait(1.1);
    }
    off();

    // One last look at the whole run.
    view.frame(null);
    const coop = dominoCoop(game);
    const total = game.sections.flat().length;
    hud();
    for (const c of view.crew) c.setBase(coop >= 0.6 ? 'happy' : 'sad');
    ui.caption(coop >= 1 ? 'A perfect run, start to finish!' : `${clean} of ${total} sections toppled cleanly.`);
    if (coop >= 0.6) sfx.good();
    session.setLayoutAll(() => ({ kind: 'wait', title: 'That’s the run!', text: 'Watch the big screen' }));
    await clock.wait(2);
    ui.caption(null);
    ui.timer(null);
    const score = Math.round(coop * 1000);
    return {
      scores: seats.map(() => score),
      details: seats.map((_, i) => {
        const t = seatTally(game, i);
        const bits = [t.close ? `${t.close} jammed` : '', t.far ? `${t.far} too far` : ''].filter(Boolean).join(', ');
        return `${t.ok}/${t.total} sections clean${bits ? ` (${bits})` : ''}`;
      }),
      coop,
    };
  },
};
