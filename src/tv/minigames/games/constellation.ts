// Ceiling Stars on the TV: lights off, everyone tucked into sleeping bags on the bedroom floor, looking up at the
// glow-in-the-dark stars on the ceiling. A constellation lights up star by star with dotted lines, the lines
// fade, and everyone traces it on their phone; each trace glows on the ceiling in its player's colour.
import * as THREE from 'three';
import { type CpuTrace, type Pt, STARS, cpuTrace, decorStars, looksFinished, makeConstellation, roundPoints, scoreTrace } from '../../../game/minigames/constellation';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { ease } from '../../anim';
import type { Sfx } from '../../audio';
import { CameraFit, Floaters, type Mark, tone } from '../kit';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, canvasTexture, cyl, gem, lathe, material, mix, part, pill, rbox, seeded, torus } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SIZE = 6.2; // the ceiling patch that maps onto the phone pad
const CY = 1.0; // its centre
const CEILING = mix(P.midnight, P.denim, 0.42);
const GLOW = '#d8ff9c'; // glow-in-the-dark sticker green
const LIT = '#fff7c2';
const DUVET = mix(P.plum, P.mauve, 0.35);
const HEIGHT = 1.45; // companions
const ROW_Y = CY - SIZE / 2 - 2.25; // where the companions lie (their feet)
const ROW_Z = 2.6;
const TRACE_PX = 1024;
const MAX_POINTS = 2500; // per trace

/** Pad (0..1, y down) to the ceiling. */
function toWorld(p: Pt, z = 0.1): THREE.Vector3 {
  return new THREE.Vector3(-SIZE / 2 + p.x * SIZE, CY + SIZE / 2 - p.y * SIZE, z);
}

let starGeometry: THREE.ExtrudeGeometry | null = null;
/** A soft five-pointed sticker star, radius 1, facing the camera. */
function starShape(): THREE.ExtrudeGeometry {
  if (!starGeometry) {
    const shape = new THREE.Shape();
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 0.46 : 1;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    starGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 2 });
    starGeometry.center();
  }
  return starGeometry;
}

/** A twinkly note per star as the constellation lights up. */
function twinkle(sfx: Sfx, k: number): void {
  const scale = [523, 587, 659, 784, 880, 1047, 1175];
  const f = scale[k % scale.length] as number;
  tone(sfx, { freq: f, dur: 0.7, type: 'sine', gain: 0.07 });
  tone(sfx, { freq: f * 2, dur: 0.35, type: 'triangle', gain: 0.025, delay: 0.02 });
}

interface Star {
  mesh: THREE.Mesh;
  size: number;
  litAt: number;
}

class Bedroom implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  private readonly fit = new CameraFit(this.camera, 0);
  private readonly marks: Mark[] = [];
  private readonly decor: { mesh: THREE.Mesh; phase: number; size: number }[] = [];
  private stars: Star[] = [];
  /** 0 … 1 while the constellation's stars grow in or shrink away. */
  private grow = 0;
  private dots: THREE.Mesh[][] = [];
  private readonly dotMat = new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  private readonly traceCanvas: CanvasRenderingContext2D | null;
  private readonly traceTexture: THREE.CanvasTexture;
  private readonly traceMat: THREE.MeshBasicMaterial;
  private traceDirty = false;
  private time = 0;
  private tick: (dt: number, time: number) => void = () => {};
  private readonly sparks: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private readonly nightLight = new THREE.PointLight(P.lamp, 16, 14, 1.4);

  constructor(
    readonly seats: MinigameSeat[],
    readonly people: Companion[],
    decor: readonly Pt[],
  ) {
    // Lights off: cool moonlight from the window side, and one small night light by the bed.
    const rig = lightRig(this.scene, 'nightInterior', { shadowSize: 10, sunFrom: [-0.3, 0.2, 0.93], fog: { near: 40, far: 120 } });
    rig.sun.target.position.set(0, CY - 2, 0);
    rig.sun.intensity = 1.25;
    const rand = seeded(77);
    this.buildCeiling(rand, decor);
    this.buildFloor();

    // The live traces: one canvas over the patch, redrawn when a trace grows.
    this.traceTexture = canvasTexture(TRACE_PX, TRACE_PX, () => {});
    this.traceCanvas = (this.traceTexture.image as HTMLCanvasElement).getContext('2d');
    this.traceMat = new THREE.MeshBasicMaterial({ map: this.traceTexture, transparent: true, depthWrite: false, toneMapped: false });
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), this.traceMat);
    overlay.position.set(0, CY, 0.16);
    overlay.renderOrder = 3;
    this.scene.add(overlay);

    for (const sx of [-1, 1]) for (const sy of [-1, 1]) this.marks.push({ p: new THREE.Vector3((sx * SIZE) / 2, CY + (sy * SIZE) / 2, 0), pad: 0.02 });
    this.fit.update(() => this.marks);
  }

  private buildCeiling(rand: () => number, decor: readonly Pt[]): void {
    const s = this.scene;
    const flat = { outline: false as const, shadow: false };
    part(s, box(40, 28, 0.3), CEILING, 0, CY, -0.15, { tex: 'plaster', texScale: 5, texStrength: 0.8, outline: false });
    // Old beams along the edges of the room, and a picture rail of fairy lights that somebody forgot to unplug.
    for (const x of [-10.6, 10.9]) part(s, box(0.7, 28, 0.5), P.walnut, x, CY, 0.2, { tex: 'darkWood', texScale: 3, outline: false });
    part(s, box(40, 0.6, 0.45), P.walnut, 0, CY + SIZE / 2 + 1.35, 0.18, { tex: 'darkWood', texScale: 3, outline: false });
    const dim = [mix(P.lamp, CEILING, 0.25), mix(P.rose, CEILING, 0.2), mix(P.moon, CEILING, 0.2)];
    for (const [x0, x1] of [
      [-10.2, -5.2],
      [-5.2, -0.2],
      [-0.2, 5.0],
      [5.0, 10.5],
    ] as const) {
      const y = CY + SIZE / 2 + 1.0;
      s.add(props.stringLights(new THREE.Vector3(x0, y, 0.45), new THREE.Vector3(x1, y, 0.45), { sag: 0.2, count: 9, colors: dim, bulb: 0.05 }));
    }
    // The patch the phone pad maps to: a touch lighter, with soft corner marks.
    part(s, rbox(SIZE + 0.4, SIZE + 0.4, 0.04, 0.03), mix(CEILING, P.moon, 0.07), 0, CY, 0.02, { tex: 'plaster', texScale: 5, texStrength: 0.5, ...flat });
    const mark = mix(P.moon, CEILING, 0.45);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = (sx * (SIZE + 0.2)) / 2;
        const y = CY + (sy * (SIZE + 0.2)) / 2;
        part(s, rbox(0.55, 0.045, 0.02, 0.01), mark, x - sx * 0.25, y, 0.05, { glow: 0.5, ...flat });
        part(s, rbox(0.045, 0.55, 0.02, 0.01), mark, x, y - sy * 0.25, 0.05, { glow: 0.5, ...flat });
      }
    }
    // Moonlight from the window, falling across one side in four panes.
    const pane = new THREE.Group();
    pane.position.set(-SIZE / 2 - 3.1, CY - 0.9, 0.03);
    pane.rotation.z = 0.35;
    for (const px of [-1, 1]) for (const py of [-1, 1]) part(pane, rbox(2.05, 1.3, 0.01, 0.004), P.moon, px * 1.12, py * 0.72, 0, { basic: true, opacity: 0.085, ...flat });
    s.add(pane);
    // The light fitting (off): a ceiling rose and a glass shade, seen from below.
    const lamp = new THREE.Group();
    lamp.position.set(SIZE / 2 + 2.6, CY + 2.0, 0);
    part(lamp, cyl(0.62, 0.7, 0.1, 28), mix(P.linen, CEILING, 0.5), 0, 0, 0.05, { rx: Math.PI / 2 });
    part(lamp, lathe([[0, 0], [0.5, 0.02], [0.56, 0.2], [0.34, 0.42], [0, 0.48]], 28), mix(P.ceramic, CEILING, 0.2), 0, 0, 0.1, { rx: Math.PI / 2, gloss: 0.5 });
    part(lamp, torus(0.57, 0.035), P.brass, 0, 0, 0.12, { gloss: 0.6, outline: false });
    s.add(lamp);
    // Glow stickers that aren't stars: a crescent moon, a ringed planet, a comet.
    const sticker = { glow: 0.55, ...flat };
    part(s, ball(0.7, 2), GLOW, -SIZE / 2 - 1.8, CY + 2.3, 0.05, { ...sticker, sz: 0.06 });
    part(s, ball(0.62, 2), CEILING, -SIZE / 2 - 1.5, CY + 2.45, 0.1, { sz: 0.06, ...flat });
    const planet = new THREE.Group();
    planet.position.set(SIZE / 2 + 4.6, CY - 1.3, 0.06);
    planet.rotation.z = -0.4;
    part(planet, ball(0.42, 2), GLOW, 0, 0, 0, { ...sticker, sz: 0.08 });
    part(planet, torus(0.68, 0.035), GLOW, 0, 0, 0.02, { ...sticker, sy: 0.32 });
    s.add(planet);
    const comet = new THREE.Group();
    comet.position.set(-SIZE / 2 - 5.4, CY + 0.9, 0.06);
    comet.rotation.z = 0.5;
    part(comet, starShape(), GLOW, 0, 0, 0, { ...sticker, s: 0.2 });
    for (let k = 1; k <= 4; k++) part(comet, rbox(0.3, 0.05, 0.02, 0.02), GLOW, -0.3 - k * 0.33, (k % 2 ? 1 : -1) * 0.07, 0, { glow: 0.55 - k * 0.09, opacity: 1 - k * 0.18, ...flat });
    s.add(comet);
    // Glow stars all over: a few small ones on the patch, more around it.
    const add = (p: THREE.Vector3, size: number) => {
      const mesh = part(s, starShape(), GLOW, p.x, p.y, 0.08, { s: size, glow: 0.5, rz: rand() * 1.2, ...flat });
      this.decor.push({ mesh, phase: rand() * 6.3, size });
    };
    for (const d of decor) add(toWorld(d), 0.1 + rand() * 0.06);
    for (let k = 0; k < 44; k++) {
      const x = (rand() - 0.5) * 21;
      const y = CY + (rand() - 0.5) * 15;
      if (Math.abs(x) < SIZE / 2 + 0.6 && Math.abs(y - CY) < SIZE / 2 + 0.6) continue;
      if (y > CY + SIZE / 2 + 0.5) continue;
      add(new THREE.Vector3(x, y, 0), 0.11 + rand() * 0.13);
    }
    const dust = props.motes({ n: 16, area: [14, 6, 1.5], color: P.moon, size: 0.05 });
    dust.position.set(0, CY - 3, 1.2);
    s.add(dust);
  }

  /** Everyone in a sleeping bag with their colour on the collar, heads on pillows, leaning back to look up. */
  private buildFloor(): void {
    const n = this.seats.length;
    const s = this.scene;
    this.seats.forEach((seat, i) => {
      const x = (i - (n - 1) / 2) * 1.85;
      const g = new THREE.Group();
      g.position.set(x, ROW_Y, ROW_Z);
      g.rotation.x = -0.32;
      part(g, rbox(1.25, 0.7, 0.45, 0.2), P.ceramic, 0, HEIGHT * 0.86, -0.42, { tex: 'fabric', texStrength: 0.5 });
      const c = this.people[i];
      if (c) {
        c.setBase('listening');
        g.add(c.root);
      }
      const bag = mix(seat.color, P.midnight, 0.42);
      part(g, pill(0.52, 0.25), bag, 0, 0.25, 0.04, { sz: 0.8, tex: 'fabric', texScale: 0.7 });
      // quilting lines, and the collar in the player's colour
      for (const y of [0.08, 0.33]) part(g, torus(0.5, 0.018), mix(bag, P.ink, 0.35), 0, y, 0.04, { rx: Math.PI / 2, sy: 0.8, outline: false, shadow: false });
      part(g, pill(0.17, 0.75), seat.color, 0, 0.78, 0.12, { rz: Math.PI / 2, sz: 0.8, glow: 0.22 });
      s.add(g);
      this.marks.push({ p: new THREE.Vector3(x, ROW_Y - 0.1, ROW_Z) }, { p: new THREE.Vector3(x, ROW_Y + HEIGHT + 0.1, ROW_Z - 0.4), pad: 0.05 });
    });
    // The duvet everybody's lying on, running off both sides of the screen, with a folded blanket and cushions.
    part(s, rbox(34, 0.7, 1.6, 0.3), DUVET, 0, ROW_Y - 0.3, ROW_Z + 0.25, { tex: 'knit', texScale: 1.1, outline: false });
    part(s, rbox(34, 0.5, 1.2, 0.22), mix(DUVET, P.ink, 0.25), 0, ROW_Y - 0.1, ROW_Z - 0.75, { tex: 'fabric', outline: false });
    const side = n * 0.925 + 1.4;
    part(s, rbox(1.5, 0.75, 0.5, 0.2), P.mustard, -side + 0.1, ROW_Y + 0.45, ROW_Z - 0.2, { tex: 'knit', rz: 0.3 });
    part(s, rbox(1.2, 0.7, 0.5, 0.2), P.teal, -side - 1.4, ROW_Y + 0.35, ROW_Z - 0.3, { tex: 'fabric', rz: -0.2 });
    part(s, rbox(1.9, 0.26, 0.9, 0.1), P.terracotta, side + 1.7, ROW_Y + 0.15, ROW_Z + 0.3, { tex: 'knit', rz: 0.04 });
    part(s, rbox(1.8, 0.24, 0.85, 0.1), P.sage, side + 1.75, ROW_Y + 0.38, ROW_Z + 0.3, { tex: 'knit', rz: -0.03 });
    // A night light on the right: the one warm thing in the room.
    const night = new THREE.Group();
    night.position.set(side - 0.1, ROW_Y + 0.05, ROW_Z + 0.35);
    part(night, cyl(0.3, 0.36, 0.2, 20), P.walnut, 0, 0.1, 0, { tex: 'wood' });
    part(night, ball(0.34, 3), P.lamp, 0, 0.5, 0, { glow: 1.5, outline: false, shadow: false });
    s.add(night);
    this.nightLight.position.set(side - 1.2, ROW_Y + 1.3, ROW_Z + 1.6);
    s.add(this.nightLight);
    this.tick = props.tickProps(s);
  }

  /** Where a companion's head is, for floating words. */
  overHead(i: number): THREE.Vector3 {
    const n = this.seats.length;
    return new THREE.Vector3((i - (n - 1) / 2) * 1.85, ROW_Y + HEIGHT + 0.55, ROW_Z);
  }

  /** Puts up a new constellation, hidden (call showStar to light each one). */
  setConstellation(stars: readonly Pt[]): void {
    this.clearConstellation();
    this.stars = stars.map((p) => {
      const w = toWorld(p, 0.12);
      const mesh = part(this.scene, starShape(), GLOW, w.x, w.y, w.z, { s: 0.001, glow: 0.9, shadow: false, outline: false });
      return { mesh, size: 0.3, litAt: -9 };
    });
    this.dots = stars.slice(1).map((b, k) => {
      const a = toWorld(stars[k] as Pt, 0.14);
      const e = toWorld(b, 0.14);
      const len = a.distanceTo(e);
      const count = Math.max(1, Math.floor((len - 0.7) / 0.26));
      return Array.from({ length: count }, (_, j) => {
        const u = (0.35 + (j + 0.5) * ((len - 0.7) / count)) / len;
        const p = a.clone().lerp(e, u);
        const dot = part(this.scene, ball(0.055, 1), '#fff3b0', p.x, p.y, p.z, { material: this.dotMat, outline: false, shadow: false });
        dot.visible = false;
        return dot;
      });
    });
    this.dotMat.opacity = 0.95;
  }

  /** Lights star k, and draws the dotted line to it from the star before over `seconds`. */
  showStar(k: number, clockTween: (s: number, f: (e: number) => void) => Promise<void>, seconds: number): void {
    const star = this.stars[k];
    if (star) {
      star.litAt = this.time;
      this.sparkle(star.mesh.position, LIT, 7);
    }
    const line = this.dots[k - 1];
    if (line) void clockTween(seconds, (e) => line.forEach((d, j) => (d.visible = j / line.length < e)));
  }

  setLines(opacity: number): void {
    this.dotMat.opacity = opacity;
    if (opacity > 0) for (const line of this.dots) for (const d of line) d.visible = true;
  }

  /** Stars grow in (k = 1) or shrink away (k = 0). */
  setStarScale(k: number): void {
    this.grow = k;
  }

  clearConstellation(): void {
    for (const s of this.stars) this.scene.remove(s.mesh);
    for (const line of this.dots) for (const d of line) this.scene.remove(d);
    this.stars = [];
    this.dots = [];
  }

  /** Redraws every trace on the ceiling (each in its player's colour, glowing). */
  drawTraces(traces: readonly (readonly (readonly number[])[])[]): void {
    const g = this.traceCanvas;
    if (!g) return;
    g.clearRect(0, 0, TRACE_PX, TRACE_PX);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    traces.forEach((strokes, i) => {
      const color = this.seats[i]?.color ?? '#ffffff';
      g.strokeStyle = mix(color, '#ffffff', 0.2);
      g.fillStyle = g.strokeStyle;
      g.shadowColor = color;
      g.shadowBlur = 18;
      g.lineWidth = 10;
      for (const s of strokes) {
        if (s.length < 2) continue;
        g.beginPath();
        g.moveTo((s[0] as number) * TRACE_PX, (s[1] as number) * TRACE_PX);
        if (s.length === 2) g.arc((s[0] as number) * TRACE_PX, (s[1] as number) * TRACE_PX, 5, 0, Math.PI * 2);
        for (let k = 2; k + 1 < s.length; k += 2) g.lineTo((s[k] as number) * TRACE_PX, (s[k + 1] as number) * TRACE_PX);
        g.stroke();
      }
    });
    g.shadowBlur = 0;
    this.traceDirty = true;
  }

  /** A few sparkles flying off a point on the ceiling. */
  sparkle(at: THREE.Vector3, color: string, n = 6): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const m = part(this.scene, gem(0.06), color, at.x, at.y, at.z + 0.1, { glow: 1.8, outline: false, shadow: false });
      const v = 0.8 + Math.random() * 0.9;
      this.sparks.push({ m, v: new THREE.Vector3(Math.cos(a) * v, Math.sin(a) * v, 0), age: 0 });
    }
  }

  dispose(): void {
    for (const sp of this.sparks) this.scene.remove(sp.m);
    for (const c of this.people) c.dispose();
    this.floaters.dispose();
    this.traceTexture.dispose();
    this.traceMat.dispose();
    this.dotMat.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.fit.update(() => this.marks);
    for (const c of this.people) c.update(dt);
    for (const d of this.decor) d.mesh.scale.setScalar(d.size * (1 + Math.sin(time * 1.3 + d.phase) * 0.08));
    for (const s of this.stars) {
      const age = time - s.litAt;
      const lit = age >= 0 && age < 0.9;
      s.mesh.material = material(lit ? LIT : GLOW, { glow: lit ? 2 : 0.9 });
      const pulse = lit ? 1 + 0.45 * Math.exp(-age * 4) : 1 + Math.sin(time * 2 + s.mesh.position.x) * 0.04;
      s.mesh.scale.setScalar(Math.max(0.001, s.size * this.grow * pulse));
      s.mesh.rotation.z = Math.sin(time * 0.6 + s.mesh.position.y) * 0.08;
    }
    if (this.traceDirty) {
      this.traceTexture.needsUpdate = true;
      this.traceDirty = false;
    }
    this.tick(dt, time);
    this.nightLight.intensity = 16 * (1 + Math.sin(time * 1.7) * 0.03);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i] as (typeof this.sparks)[number];
      sp.age += dt;
      sp.m.position.addScaledVector(sp.v, dt * (1 - sp.age / 0.7));
      sp.m.rotation.z += dt * 6;
      sp.m.scale.setScalar(Math.max(0.001, 1 - sp.age / 0.7));
      if (sp.age >= 0.7) {
        this.scene.remove(sp.m);
        this.sparks.splice(i, 1);
      }
    }
    this.floaters.update(dt);
  }
}

/** A chunk of a phone stroke into a trace (`start` begins a new stroke); keeps at most MAX_POINTS points. */
function addPoints(strokes: number[][], pts: readonly number[], start: boolean): boolean {
  const have = strokes.reduce((a, s) => a + s.length / 2, 0);
  const take = Math.min(pts.length / 2, MAX_POINTS - have);
  if (take <= 0) return false;
  if (start || !strokes.length) strokes.push([]);
  (strokes[strokes.length - 1] as number[]).push(...pts.slice(0, take * 2));
  return true;
}

interface Tracer {
  strokes: number[][];
  /** Seconds into the trace of the latest point (half the round trip taken off). */
  lastAt: number | null;
  /** When the latest chunk arrived. */
  chunkAt: number;
  finished: boolean;
  plan: CpuTrace | null;
  sent: number;
}

export const minigame: Minigame = {
  id: 'constellation',
  title: 'Ceiling Stars',
  how: 'Watch a constellation light up on the ceiling, then trace it on your phone, star to star in the same order. Your phone is the ceiling: the closer (and quicker) your trace, the more points.',
  controller: 'draw',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const decor = decorStars(rng, 12);
    const view = new Bedroom(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), decor);
    ctx.stage.setView(view);
    const skill = seats.map((_, i) => (session.isCpu(i) ? ctx.skill() : 0.6));
    const totals = seats.map(() => 0);
    const accuracies: number[][] = seats.map(() => []);
    const rounds = STARS.sizes.length;
    let tracers: Tracer[] = [];
    let tracing = false;
    let now = 0;
    const live = (value: (i: number) => string) => ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: value(i) })));
    const redraw = () => view.drawTraces(tracers.map((t) => t.strokes));
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'draw' || !tracing || seat >= n || session.isCpu(seat)) return;
      const tr = tracers[seat];
      if (!tr || tr.finished) return;
      if (!addPoints(tr.strokes, msg.pts, msg.start)) return;
      tr.lastAt = Math.max(0, now - (session.seats[seat]?.rtt ?? 0) / 2000);
      tr.chunkAt = now;
      redraw();
    });
    live(() => '0 pts');

    for (let round = 0; round < rounds; round++) {
      const size = STARS.sizes[round] as number;
      const limit = STARS.traceTime[round] as number;
      const stars = makeConstellation(rng, size, decor);

      // 1. Look up: the constellation lights up, star by star.
      session.setLayoutAll(() => ({ kind: 'wait', title: 'Look up!', text: `Constellation ${round + 1} of ${rounds}: remember the order the stars light up in.` }));
      ui.caption(`Constellation ${round + 1} of ${rounds}: watch the order…`);
      view.people.forEach((c) => c.setBase('listening'));
      view.setConstellation(stars);
      await clock.tween(0.5, (k) => view.setStarScale(k), ease.outBack);
      await clock.wait(0.3);
      for (let k = 0; k < stars.length; k++) {
        view.showStar(k, (s, f) => clock.tween(s, f, ease.linear), 0.3);
        twinkle(sfx, k);
        await clock.wait(0.4);
      }
      await clock.wait(STARS.showFor);
      sfx.whoosh();
      await clock.tween(0.6, (k) => view.setLines(0.95 * (1 - k)));

      // 2. Trace.
      tracers = seats.map((_, i) => ({ strokes: [], lastAt: null, chunkAt: 0, finished: false, plan: session.isCpu(i) ? cpuTrace(rng, stars, skill[i] ?? 0.5) : null, sent: 0 }));
      redraw();
      session.setLayoutAll((s) => ({ kind: 'draw', note: `Constellation ${round + 1} of ${rounds}: trace it in order, from the first star.`, done: null, ink: seats[s.index]?.color ?? s.color }));
      ui.caption('Trace it on your phone, in the same order!');
      view.people.forEach((c) => c.setBase('thinking'));
      sfx.go();
      tracing = true;
      now = 0;
      let hudAt = -1;
      await everyFrame(clock, (_, t) => {
        now = t;
        tracers.forEach((tr, i) => {
          if (tr.finished) return;
          if (tr.plan) {
            // A computer player draws its line as time goes on.
            const { pts, times } = tr.plan;
            const before = tr.sent;
            while (tr.sent < times.length && (times[tr.sent] as number) <= t) tr.sent++;
            if (tr.sent > before) {
              addPoints(tr.strokes, pts.slice(before * 2, tr.sent * 2), before === 0);
              tr.lastAt = times[tr.sent - 1] as number;
              redraw();
            }
            if (tr.sent >= times.length) tr.finished = true;
          } else if (session.isCpu(i)) {
            tr.finished = true; // their phone went away
          } else if (tr.strokes.length && t - tr.chunkAt > 0.45 && looksFinished(tr.strokes, stars)) {
            tr.finished = true;
            session.setLayout(i, { kind: 'wait', title: 'Traced!', text: 'Lovely. Waiting for the others…' });
          }
          if (tr.finished) view.people[i]?.react('approval', 1);
        });
        if (t - hudAt > 0.25) {
          hudAt = t;
          ui.timer(limit - t);
          live((i) => (tracers[i]?.finished ? 'Done' : 'Tracing…'));
        }
        return t >= limit || tracers.every((tr) => tr.finished);
      });
      tracing = false;
      ui.timer(null);

      // 3. The lines come back, and everyone sees how close they got.
      session.setLayoutAll(() => ({ kind: 'wait', title: 'How close?', text: 'Look at the ceiling.' }));
      void clock.tween(0.35, (k) => view.setLines(0.75 * k));
      tone(sfx, { freq: 660, to: 990, dur: 0.4, type: 'sine', gain: 0.07 });
      tracers.forEach((tr, i) => {
        const res = scoreTrace(tr.strokes, stars);
        const pts = roundPoints(res.accuracy, tr.lastAt ?? limit, limit);
        totals[i] = (totals[i] ?? 0) + pts;
        accuracies[i]?.push(res.accuracy);
        const seat = seats[i] as MinigameSeat;
        view.floaters.add(`+${pts}`, seat.color, view.overHead(i), 0.5, 2.0);
        if (res.accuracy >= 0.75) view.sparkle(view.overHead(i), seat.color, 8);
        const c = view.people[i];
        c?.setBase('idle');
        c?.react(res.accuracy >= 0.75 ? 'happy' : res.accuracy >= 0.45 ? 'approval' : 'sad', 1.8);
      });
      ui.caption(round + 1 < rounds ? 'Next one has another star…' : 'That was the last one.');
      live((i) => `${totals[i]} pts`);
      await clock.wait(1.8);
      await clock.tween(0.4, (k) => {
        view.setLines(0.75 * (1 - k));
        view.setStarScale(1 - k);
      });
      tracers = [];
      redraw();
      view.clearConstellation();
    }
    off();
    ui.caption(null);
    return {
      scores: totals,
      details: totals.map((p, i) => {
        const acc = accuracies[i] ?? [];
        const avg = acc.length ? acc.reduce((a, b) => a + b, 0) / acc.length : 0;
        return `${p} pts · ${Math.round(avg * 100)}% on target`;
      }),
    };
  },
};
