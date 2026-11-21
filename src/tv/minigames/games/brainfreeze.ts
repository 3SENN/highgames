// Brain Freeze on the TV: golden hour on a boardwalk by the sea. Everyone stands by a giant slushie in their colour
// with a loopy crazy straw. Hold to slurp (watch your colour race up the straw), but mind the freeze meter.
import * as THREE from 'three';
import { FREEZE, type CpuPlan, type Slurper, cpuHolds, cpuPlan, freezeScores, newSlurper, stepSlurper } from '../../../game/minigames/brainfreeze';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { Sfx } from '../../audio';
import { type Env, beach } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, box, cyl, dome, gem, material, mix, part, popSprite, rbox, sphere, toonMat, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const SPACING = 3.6; // between players
const HEIGHT = 1.7; // companion height
const CUP_R = 0.68;
const CUP_H = 2.3;
const SLUSH_MAX = CUP_H - 0.25; // slush height in a full cup
const ICE = mix(P.neonCyan, '#ffffff', 0.4);
const RAIL_Z = -4.3;

// ------------------------------------------------------------------ sounds

function tone(sfx: Sfx, freq: number, dur: number, o: { type?: OscillatorType; slide?: number; at?: number; gain?: number } = {}): void {
  const a = sfx.audio;
  if (!a) return;
  const t0 = a.ctx.currentTime + (o.at ?? 0);
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.15, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** One looping, gurgly slurp for everybody: louder the more people slurp, higher as the cups empty. */
class SlurpLoop {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;

  constructor(private readonly sfx: Sfx) {
    const a = sfx.audio;
    if (!a) return;
    const ctx = a.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let env = 0;
    for (let i = 0; i < data.length; i++) {
      if (i % 700 === 0) env = Math.random();
      data[i] = (Math.random() * 2 - 1) * (0.25 + 0.75 * env);
    }
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 800;
    this.filter.Q.value = 2.2;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src.connect(this.filter).connect(this.gain).connect(a.out);
    this.src.start();
  }

  set(slurping: number, emptiness: number): void {
    const ctx = this.sfx.audio?.ctx;
    if (!ctx || !this.gain || !this.filter) return;
    this.gain.gain.setTargetAtTime(slurping ? 0.08 + 0.035 * slurping : 0, ctx.currentTime, 0.05);
    this.filter.frequency.setTargetAtTime(650 + emptiness * 1100, ctx.currentTime, 0.1);
  }

  stop(): void {
    try {
      this.src?.stop();
    } catch {
      // already stopped
    }
    this.gain?.disconnect();
  }
}

// ------------------------------------------------------------------ the boardwalk

interface Rig {
  companion: Companion;
  home: THREE.Vector3;
  slush: THREE.Mesh;
  heap: THREE.Mesh;
  curve: THREE.CatmullRomCurve3;
  blobs: THREE.Mesh[];
  meter: THREE.Group;
  fill: THREE.Mesh;
  ice: THREE.Mesh;
  flake: THREE.Mesh;
  /** 0 … 1 while the ice block pops in. */
  iceIn: number;
  flow: number;
}

interface Pop {
  sprite: THREE.Sprite;
  age: number;
  life: number;
}

/** The loop-the-loop path from the bottom of the cup to the companion's mouth. */
function strawCurve(cupX: number, mouth: THREE.Vector3): THREE.CatmullRomCurve3 {
  const pts = [new THREE.Vector3(cupX, 0.3, 0), new THREE.Vector3(cupX, CUP_H - 0.3, 0), new THREE.Vector3(cupX - 0.02, CUP_H + 0.35, 0.03)];
  const c = new THREE.Vector3(cupX - 0.5, CUP_H + 0.62, 0.15);
  const r = 0.34;
  for (let k = 0; k <= 9; k++) {
    // Once around, counter-clockwise from the right, drifting toward the camera so it never crosses itself.
    const a = -Math.PI / 5 + (k / 9) * Math.PI * 2;
    pts.push(new THREE.Vector3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z + k * 0.035));
  }
  pts.push(new THREE.Vector3((cupX - 0.5 + mouth.x) / 2 - 0.1, (CUP_H + mouth.y) / 2 + 0.25, (0.5 + mouth.z) / 2), mouth.clone());
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
}

class Boardwalk implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 220);
  readonly rigs: Rig[] = [];
  private pops: Pop[] = [];
  private time = 0;
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private readonly fit = new CameraFit(this.camera, 0.16);
  private readonly half: number;

  constructor(seats: MinigameSeat[], companions: Companion[]) {
    this.half = ((seats.length - 1) / 2) * SPACING;
    const deckW = this.half * 2 + 13;
    this.env = beach(this.scene, { mood: 'golden', shore: 9.5, clear: { w: deckW + 1, d: 14 }, seed: 5 });
    const set = new THREE.Group();
    const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, scale = 1, ry = 0): T => {
      o.position.set(x, y, z);
      o.scale.setScalar(scale);
      o.rotation.y = ry;
      set.add(o);
      return o;
    };
    // The boardwalk: a planked deck over the sand, its edge beams, and a railing with the sea beyond.
    part(set, box(deckW, 0.3, 15), P.oak, 0, -0.12, 2.6, { tex: 'planks', texScale: 2.2, outline: false });
    for (const side of [-1, 1]) part(set, box(0.3, 0.36, 15), P.walnut, side * (deckW / 2), -0.13, 2.6, { tex: 'planks', outline: false });
    part(set, box(deckW + 0.3, 0.36, 0.3), P.walnut, 0, -0.13, 2.6 - 7.5, { tex: 'planks', outline: false });
    const posts = Math.round(deckW / 2.2);
    for (let k = 0; k <= posts; k++) {
      const x = -deckW / 2 + (k / posts) * deckW;
      part(set, rbox(0.16, 1.15, 0.16, 0.03), P.linen, x, 0.6, RAIL_Z, { tex: 'planks', texScale: 0.8 });
      part(set, sphere(0.1, 10), P.linen, x, 1.24, RAIL_Z, { outline: false });
    }
    part(set, rbox(deckW, 0.1, 0.2, 0.04), P.linen, 0, 1.12, RAIL_Z, { tex: 'planks', texScale: 0.8 });
    part(set, rbox(deckW, 0.07, 0.08, 0.03), P.linen, 0, 0.6, RAIL_Z, { outline: false });
    // Two lamp posts with a string of lights between them (not lit yet: the sun is still up).
    const lampXs = [-this.half - 3.4, this.half + 3.4];
    for (const x of lampXs) {
      part(set, cyl(0.06, 0.08, 3.6, 10), P.charcoal, x, 1.8, RAIL_Z, { gloss: 0.3 });
      part(set, sphere(0.2, 14), P.ceramic, x, 3.72, RAIL_Z, { gloss: 0.5, outline: false });
    }
    set.add(props.stringLights(new THREE.Vector3(lampXs[0] as number, 3.5, RAIL_Z), new THREE.Vector3(lampXs[1] as number, 3.5, RAIL_Z), { sag: 0.45, count: 22, colors: [P.ceramic, P.mustard, P.rose], bulb: 0.06 }));
    // The slushie stand's corner: crates, a parasol, a bench, a plant.
    put(props.parasol({ colors: [P.teal, P.cream], h: 3.3, r: 1.9 }), -this.half - 4.3, 0, -1.8, 1, 0.3);
    put(props.crate({ s: 0.7 }), -this.half - 4.6, 0, -2.6, 1, 0.2);
    put(props.crate({ s: 0.55 }), -this.half - 3.8, 0, -2.9, 1, -0.3);
    put(props.plant({ kind: 'palm', h: 1.5, pot: P.terracotta, seed: 3 }), this.half + 3.2, 0, -3.1, 1.3);
    put(props.parasol({ colors: [P.terracotta, P.cream], h: 3.1, r: 1.7 }), this.half + 4.3, 0, -1.4, 1, -0.4);
    put(props.pouf({ color: P.mustard }), this.half + 3.1, 0, 2.7, 1.5);
    put(props.crate({ s: 0.6 }), this.half + 3.9, 0, 3.9, 1, 0.4);
    this.scene.add(set);
    this.tick = props.tickProps(set);

    const n = seats.length;
    seats.forEach((s, i) => {
      const x = (i - (n - 1) / 2) * SPACING;
      const px = x - 0.62;
      const cx = x + 0.68;
      const c = companions[i] as Companion;
      const home = new THREE.Vector3(px, 0, 0.3);
      c.root.position.copy(home);
      c.root.rotation.y = 0.3;
      this.scene.add(c.root);

      // The giant cup: clear plastic, white rims, slush in the player's colour, a dome lid.
      part(this.scene, cyl(CUP_R * 1.05, CUP_R * 1.05, 0.05, 28), P.walnut, cx, 0.03, 0, { tex: 'wood', outline: false });
      part(this.scene, cyl(CUP_R, CUP_R * 0.86, CUP_H, 32), P.screen, cx, CUP_H / 2, 0, { opacity: 0.26, shadow: false, gloss: 0.8 });
      part(this.scene, torus(CUP_R, 0.05), P.ceramic, cx, CUP_H, 0, { rx: Math.PI / 2, gloss: 0.6 });
      part(this.scene, torus(CUP_R * 0.86, 0.05), P.ceramic, cx, 0.08, 0, { rx: Math.PI / 2, gloss: 0.6 });
      part(this.scene, torus(CUP_R * 0.945, 0.035), s.color, cx, CUP_H * 0.62, 0, { rx: Math.PI / 2, outline: false, shadow: false });
      part(this.scene, dome(CUP_R), P.screen, cx, CUP_H, 0, { sy: 0.45, opacity: 0.22, shadow: false, gloss: 0.8 });
      const slush = part(this.scene, cyl(CUP_R * 0.9, CUP_R * 0.78, 1, 24), s.color, cx, 0.08 + SLUSH_MAX / 2, 0, { outline: false, gloss: 0.3 });
      slush.scale.y = SLUSH_MAX;
      const heap = part(this.scene, dome(CUP_R * 0.88), mix(s.color, '#ffffff', 0.35), cx, 0.08 + SLUSH_MAX, 0, { sy: 0.35, outline: false });

      // The crazy straw: clear tube, with the slush racing through it as blobs.
      const mouth = new THREE.Vector3(px + Math.sin(0.3) * 0.42, HEIGHT * 0.6, home.z + Math.cos(0.3) * 0.42);
      const curve = strawCurve(cx, mouth);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 120, 0.075, 10, false),
        toonMat({ color: mix(s.color, '#ffffff', 0.75), transparent: true, opacity: 0.6, depthWrite: false }, { gloss: 0.7 }),
      );
      this.scene.add(tube);
      const blobs: THREE.Mesh[] = [];
      for (let k = 0; k < 9; k++) {
        const b = part(this.scene, ball(0.055, 1), s.color, 0, 0, 0, { outline: false, shadow: false });
        b.visible = false;
        blobs.push(b);
      }

      // The freeze meter over the head (always facing the camera), and the ice block for when it's full.
      const meter = new THREE.Group();
      meter.position.set(px, HEIGHT + 0.42, home.z);
      part(meter, rbox(1.1, 0.2, 0.1, 0.09), P.ink, 0, 0, 0, { outline: false, shadow: false });
      const fillPivot = new THREE.Group();
      fillPivot.position.x = -0.49;
      const fill = part(fillPivot, rbox(0.98, 0.11, 0.12, 0.05), ICE, 0.49, 0, 0.01, { outline: false, glow: 0.6, shadow: false });
      fillPivot.scale.x = 0.001;
      meter.add(fillPivot);
      part(meter, gem(0.12), P.screen, -0.7, 0, 0, { glow: 1.2, outline: false, shadow: false });
      this.scene.add(meter);
      const ice = new THREE.Mesh(rbox(1.25, HEIGHT + 0.35, 1.05, 0.16), toonMat({ color: P.screen, transparent: true, opacity: 0.55, depthWrite: false, emissive: new THREE.Color(P.neonCyan), emissiveIntensity: 0.3 }, { gloss: 0.8 }));
      ice.position.set(px, 0, home.z);
      ice.visible = false;
      this.scene.add(ice);
      const flake = part(this.scene, gem(0.16), P.screen, px, HEIGHT + 0.85, home.z, { glow: 1.6, outline: false, shadow: false });
      flake.visible = false;
      this.rigs.push({ companion: c, home, slush, heap, curve, blobs, meter, fill, ice, flake, iceIn: 0, flow: 0 });
    });

    this.env.sun.target.position.set(0, 0, 0);
    this.frame();
  }

  /** Everyone, their cups and the words over their heads, clear of the HUD. */
  private frame(): void {
    this.fit.update(() => {
      const marks: Mark[] = [];
      for (const [x, y] of [[-this.half - 1.5, 0], [this.half + 1.55, 0], [-this.half - 1.5, HEIGHT + 1.9], [this.half + 1.55, HEIGHT + 1.9]] as [number, number][]) marks.push({ p: new THREE.Vector3(x, y, y ? 0.3 : 1.2) });
      return marks;
    });
    for (const r of this.rigs) r.meter.quaternion.copy(this.camera.quaternion);
  }

  /** Shows one player's state: cup level, freeze meter, slurping, shivering, frozen. */
  show(i: number, s: Slurper, slurping: boolean, dt: number): void {
    const r = this.rigs[i];
    if (!r) return;
    const h = Math.max(0.001, s.level * SLUSH_MAX);
    r.slush.scale.y = h;
    r.slush.position.y = 0.08 + h / 2;
    r.slush.visible = s.level > 0.005;
    r.heap.position.y = 0.08 + h;
    r.heap.scale.setScalar(Math.max(0.001, Math.min(1, s.level * 6)));
    r.heap.visible = r.slush.visible;
    (r.fill.parent as THREE.Object3D).scale.x = Math.max(0.001, s.freeze);
    const danger = s.freeze > FREEZE.danger && s.frozen <= 0;
    r.fill.material = material(danger && Math.sin(this.time * 18) > 0 ? P.cream : ICE, { glow: danger ? 1.2 : 0.6, outline: false });
    // Slush racing up the straw.
    r.flow = slurping ? Math.min(1, r.flow + dt * 4) : Math.max(0, r.flow - dt * 3);
    const shown = Math.round(r.flow * r.blobs.length);
    r.blobs.forEach((b, k) => {
      b.visible = k < shown;
      if (!b.visible) return;
      const u = (this.time * 0.9 + k / r.blobs.length) % 1;
      b.position.copy(r.curve.getPointAt(u));
    });
    // Shivers as the cold creeps in; an ice block at full freeze.
    const c = r.companion.root;
    const shiver = s.frozen > 0 ? 0 : Math.max(0, s.freeze - 0.55) * 0.06;
    c.position.x = r.home.x + Math.sin(this.time * 55) * shiver;
    c.rotation.z = Math.sin(this.time * 47) * shiver * 1.5;
    r.iceIn = s.frozen > 0 ? Math.min(1, r.iceIn + dt * 6) : Math.max(0, r.iceIn - dt * 4);
    r.ice.visible = r.iceIn > 0;
    r.ice.scale.set(r.iceIn, r.iceIn, r.iceIn);
    r.ice.position.y = ((HEIGHT + 0.35) / 2) * r.iceIn;
    r.flake.visible = s.freeze > 0.6 && s.finishedAt === null;
    r.flake.rotation.y = this.time * 3;
    r.flake.position.y = HEIGHT + 0.85 + Math.sin(this.time * 4) * 0.06;
  }

  pop(i: number, text: string, color: string, size = 0.8): void {
    const r = this.rigs[i];
    if (!r) return;
    const sprite = popSprite(text, color, size);
    sprite.position.set(r.home.x + 0.6, HEIGHT + 1.2, r.home.z + 0.4);
    this.scene.add(sprite);
    this.pops.push({ sprite, age: 0, life: 1.4 });
  }

  dispose(): void {
    for (const r of this.rigs) r.companion.dispose();
    for (const p of this.pops) {
      p.sprite.material.map?.dispose();
      p.sprite.material.dispose();
    }
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.frame();
    this.env.update(dt, time);
    this.tick(dt, time);
    for (const r of this.rigs) r.companion.update(dt);
    this.pops = this.pops.filter((p) => {
      p.age += dt;
      p.sprite.position.y += dt * 0.6;
      p.sprite.material.opacity = Math.min(1, 3 * (1 - p.age / p.life));
      if (p.age < p.life) return true;
      this.scene.remove(p.sprite);
      p.sprite.material.map?.dispose();
      p.sprite.material.dispose();
      return false;
    });
  }
}

export const minigame: Minigame = {
  id: 'brainfreeze',
  title: 'Brain Freeze',
  how: 'Hold the button to slurp your giant slushie, and let go to thaw before the brain freeze hits or you freeze solid. First to empty the cup wins!',
  controller: 'hold',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const n = seats.length;
    const slurpers = seats.map(() => newSlurper());
    const skill = seats.map(() => ctx.skill());
    const plans: CpuPlan[] = skill.map((k) => cpuPlan(rng, k));
    const holding = seats.map(() => false);
    const view = new Boardwalk(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))));
    ctx.stage.setView(view);
    const moods = seats.map(() => '');
    const setMood = (i: number, mood: 'idle' | 'working' | 'sad' | 'happy') => {
      if (moods[i] === mood) return;
      moods[i] = mood;
      view.rigs[i]?.companion.setBase(mood);
    };
    session.setLayoutAll(() => ({ kind: 'hold', label: 'SLURP', note: 'Hold to slurp. Let go before the brain freeze!' }));
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'hold' && seat < n && !session.isCpu(seat)) holding[seat] = msg.down;
    });
    const slurp = new SlurpLoop(sfx);

    let endAt: number = FREEZE.duration;
    let firstDone = false;
    let hudAt = -1;
    let meterAt = -1;
    ui.caption('Hold to slurp. Let go before the brain freeze!');
    await everyFrame(clock, (dt, t) => {
      let slurping = 0;
      let emptiness = 0;
      slurpers.forEach((s, i) => {
        if (session.isCpu(i)) {
          const next = cpuHolds(s, holding[i] ?? false, plans[i] as CpuPlan);
          if (next && !holding[i]) plans[i] = cpuPlan(rng, skill[i] ?? 0.5);
          holding[i] = next;
        }
        const held = holding[i] ?? false;
        const event = stepSlurper(s, held, dt, t);
        const active = held && s.frozen <= 0 && s.finishedAt === null;
        if (active) {
          slurping += 1;
          emptiness += 1 - s.level;
        }
        view.show(i, s, active, dt);
        const seat = seats[i] as MinigameSeat;
        const c = view.rigs[i]?.companion;
        if (event === 'froze') {
          setMood(i, 'sad');
          c?.react('sad', FREEZE.frozenFor);
          view.pop(i, 'Brr!', ICE);
          tone(sfx, 2100, 0.35, { slide: 900, gain: 0.1 });
          tone(sfx, 1500, 0.4, { type: 'triangle', slide: 700, at: 0.05, gain: 0.08 });
          session.send(i, { t: 'buzz', pattern: [200, 80, 200] });
          session.send(i, { t: 'feedback', good: false, text: 'Brain freeze! Hang on…' });
        } else if (event === 'thawed') {
          sfx.whoosh();
          session.send(i, { t: 'feedback', good: true, text: 'Thawed! Keep slurping.' });
        } else if (event === 'finished') {
          setMood(i, 'happy');
          c?.react('happy', 3);
          view.pop(i, 'Empty!', seat.color, 0.95);
          tone(sfx, 300, 0.25, { type: 'sawtooth', slide: 120, gain: 0.08 });
          sfx.good();
          session.send(i, { t: 'buzz', pattern: [60, 40, 60, 40, 160] });
          session.setLayout(i, { kind: 'wait', title: 'Cup empty!', text: `Done in ${t.toFixed(1)} s. Ahh, refreshing.` });
          if (!firstDone) {
            firstDone = true;
            endAt = Math.min(endAt, t + FREEZE.lastSips);
            ui.caption(`${seat.name} emptied their cup! Last sips…`, seat.color);
          }
        }
        if (s.finishedAt === null && s.frozen <= 0) setMood(i, active ? 'working' : 'idle');
      });
      slurp.set(slurping, slurping ? emptiness / slurping : 0);
      if (t - meterAt > 0.1) {
        meterAt = t;
        slurpers.forEach((s, i) => {
          if (!session.isCpu(i) && s.finishedAt === null) session.send(i, { t: 'meter', value: s.freeze, danger: s.freeze > FREEZE.danger });
        });
      }
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(endAt - t);
        ui.live(
          seats.map((s, i) => {
            const sl = slurpers[i] as Slurper;
            const value = sl.finishedAt !== null ? `Empty! ${sl.finishedAt.toFixed(1)} s` : sl.frozen > 0 ? 'Frozen!' : `${Math.ceil(sl.level * 100)}% left`;
            return { name: s.name, color: s.color, thumb: s.thumb, value };
          }),
        );
      }
      return t >= endAt || slurpers.every((s) => s.finishedAt !== null);
    });
    off();
    slurp.stop();
    ui.timer(null);
    ui.caption(null);
    slurpers.forEach((s, i) => view.show(i, s, false, 1));
    return {
      scores: freezeScores(slurpers),
      details: slurpers.map((s) => {
        const main = s.finishedAt !== null ? `Emptied in ${s.finishedAt.toFixed(1)} s` : `Drank ${Math.round((1 - s.level) * 100)}%`;
        return s.freezes ? `${main} · ${s.freezes} brain freeze${s.freezes > 1 ? 's' : ''}` : main;
      }),
    };
  },
};
