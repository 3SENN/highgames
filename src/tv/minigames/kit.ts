// Shared helpers for minigames, so each game file holds only what makes it different:
//  - who plays with whom (teamsOf), lanes for side-by-side layouts,
//  - a camera that keeps what matters on screen and clear of the HUD (fitCamera),
//  - floating words, small synthesised sounds,
//  - streaming a playfield to phones lying on the table (SceneStream).
import * as THREE from 'three';
import type { SceneItem } from '../../shared/protocol';
import type { Sfx } from '../audio';
import { popSprite } from '../render/toon';
import type { Session } from '../session';
import type { MinigameContext } from './types';

// ------------------------------------------------------------------ the screen's safe area

/**
 * Normalised screen coordinates (-1..1) that stay readable: the live score list covers the left of the screen
 * (up to about -0.62), the status bar the top and the hint bar the bottom.
 */
export const SAFE = { left: -0.56, right: 0.94, top: 0.8, bottom: -0.8 } as const;

// ------------------------------------------------------------------ teams and lanes

/**
 * Each side's members as positions in ctx.seats: from ctx.teams (1v3: [solo, three]; 2v2: two pairs), or,
 * without teams, the seats split in two. Use it for 1v3 and 2v2 games.
 */
export function teamsOf(ctx: MinigameContext): number[][] {
  const pos = new Map(ctx.seats.map((s, i) => [s.index, i] as const));
  const given = (ctx.teams ?? []).map((t) => t.map((s) => pos.get(s)).filter((p): p is number => p !== undefined)).filter((t) => t.length > 0);
  if (given.length >= 2) return given.slice(0, 2);
  const all = ctx.seats.map((_, i) => i);
  const half = Math.ceil(all.length / 2);
  return [all.slice(0, half), all.slice(half)].filter((t) => t.length > 0);
}

/** x positions for `n` lanes `spacing` apart, centred on 0. */
export function lanes(n: number, spacing: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);
}

// ------------------------------------------------------------------ camera

export interface Mark {
  p: THREE.Vector3;
  /** Extra room in normalised screen units (labels and sprites that keep their size on screen). */
  pad?: number;
}

/**
 * The closest camera looking down by `tilt` (radians) that keeps every mark inside SAFE, centred in the free
 * part of the screen. `probe` must have the real camera's fov and aspect (and an updated projection matrix).
 */
export function frameMarks(probe: THREE.PerspectiveCamera, marks: readonly Mark[], tilt: number): { pos: THREE.Vector3; look: THREE.Vector3 } {
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
      const pad = m.pad ?? 0;
      lo = Math.min(lo, v.y - pad);
      hi = Math.max(hi, v.y + pad);
      left = Math.min(left, v.x - pad / probe.aspect);
      right = Math.max(right, v.x + pad / probe.aspect);
    }
    return { lo, hi, left, right };
  };
  const midX = (SAFE.right + SAFE.left) / 2;
  const midY = (SAFE.top + SAFE.bottom) / 2;
  const settle = (dist: number) => {
    look.y = (low + high) / 2;
    for (let k = 0; k < 10; k++) {
      place(dist);
      const e = extent();
      look.y += ((e.hi + e.lo) / 2 - midY) * dist * tan;
      look.x += ((e.right + e.left) / 2 - midX) * dist * tan * probe.aspect;
    }
    place(dist);
    return extent();
  };
  let near = 1;
  let far = 200;
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    const e = settle(mid);
    if (e.hi <= SAFE.top && e.lo >= SAFE.bottom && e.left >= SAFE.left && e.right <= SAFE.right) far = mid;
    else near = mid;
  }
  settle(far);
  return { pos: probe.position.clone(), look: look.clone() };
}

/**
 * Points `camera` so every mark is on screen and clear of the HUD. Call it from the view's update(): it only
 * recomputes when the aspect or the `key` changes (pass a key that changes when the marks move, e.g. a height).
 */
export class CameraFit {
  private readonly probe = new THREE.PerspectiveCamera();
  private fitted = '';

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly tilt: number,
  ) {}

  update(marks: () => readonly Mark[], key = ''): void {
    const k = `${this.camera.aspect.toFixed(3)}|${key}`;
    if (k === this.fitted) return;
    this.fitted = k;
    this.probe.fov = this.camera.fov;
    this.probe.aspect = this.camera.aspect;
    this.probe.updateProjectionMatrix();
    const { pos, look } = frameMarks(this.probe, marks(), this.tilt);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
  }
}

// ------------------------------------------------------------------ floating words

/** Floating words ("+1", "Nope!") that drift up and fade, in a seat's colour. Call update(dt) every frame. */
export class Floaters {
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

// ------------------------------------------------------------------ small sounds

/** A short synth note: `freq` Hz (gliding to `to`), `dur` seconds. Silent until sound is unlocked. */
export function tone(sfx: Sfx, o: { freq: number; to?: number; dur?: number; type?: OscillatorType; gain?: number; delay?: number }): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const dur = o.dur ?? 0.15;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.18, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A burst of filtered noise (whoosh, thump, crunch, splash): `freq` is the filter's centre, gliding to `to`. */
export function noise(sfx: Sfx, o: { dur?: number; filter?: BiquadFilterType; freq?: number; to?: number; gain?: number; delay?: number }): void {
  const a = sfx.audio;
  if (!a) return;
  const { ctx, out } = a;
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const dur = o.dur ?? 0.15;
  const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter ?? 'lowpass';
  filter.frequency.setValueAtTime(o.freq ?? 600, t0);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
  const g = ctx.createGain();
  g.gain.value = o.gain ?? 0.3;
  src.connect(filter).connect(g).connect(out);
  src.start(t0);
}

// ------------------------------------------------------------------ table games: the phone as the playfield

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function compact(item: SceneItem): SceneItem {
  switch (item.s) {
    case 'circle':
      return { ...item, x: r3(item.x), y: r3(item.y), r: r3(item.r) };
    case 'rect':
      return { ...item, x: r3(item.x), y: r3(item.y), w: r3(item.w), h: r3(item.h), ...(item.rot !== undefined ? { rot: r3(item.rot) } : {}) };
    case 'text':
      return { ...item, x: r3(item.x), y: r3(item.y), size: r3(item.size) };
    case 'line':
      return { ...item, pts: item.pts.map(r3), lw: r3(item.lw) };
  }
}

/**
 * Sends each phone its playfield (a 9:16 portrait canvas; x and sizes as fractions of its width, y of its height)
 * at most 20 times a second, and only when it changed. Lay out at most MAX_SCENE_ITEMS (160) shapes per phone.
 */
export class SceneStream {
  private last = new Map<number, { at: number; json: string }>();

  constructor(
    private readonly session: Session,
    private readonly minGapMs = 50,
  ) {}

  send(seat: number, items: SceneItem[], bg?: string, force = false): void {
    if (this.session.isCpu(seat)) return;
    const msg = { t: 'scene' as const, items: items.slice(0, 160).map(compact), ...(bg ? { bg } : {}) };
    const json = JSON.stringify(msg);
    const now = performance.now();
    const prev = this.last.get(seat);
    if (!force && prev && (prev.json === json || now - prev.at < this.minGapMs)) return;
    this.last.set(seat, { at: now, json });
    this.session.send(seat, msg);
  }
}
