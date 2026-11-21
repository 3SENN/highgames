// Thunder Snap on the TV: four couriers on a city rooftop at night, watching a storm roll in over the skyline.
// Watch for the flash, then tap.
import * as THREE from 'three';
import { THUNDER, type StrikeResult, reactionMs, strikePoints, thunderScores } from '../../../game/minigames/thunder';
import { randInt } from '../../../game/rng';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { type Env, rooftop } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, canvasTexture, cloud, cyl, mix, part, popSprite, seeded, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, type Mark } from '../kit';
import { type Minigame, type MinigameContext, everyFrame } from '../types';

const SPACING = 2.7; // between couriers
const STAND_Z = 0.5;
const LABEL_Y = 3.3;
const RAIN = 420;
const RAIN_BOX = { x: 26, y: 13, z: 20 };

interface Label {
  sprite: THREE.Sprite;
  age: number;
  w: number;
  h: number;
}

class StormView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 260);
  readonly couriers: Companion[];
  private readonly env: Env;
  private readonly fit = new CameraFit(this.camera, 0.05);
  private readonly xs: number[];
  private flashLight = new THREE.AmbientLight('#dfe6ff', 0);
  /** Sheet lightning: a soft glow behind the storm clouds and the nearer towers. */
  private sheet: THREE.Mesh;
  private sheetMat: THREE.MeshBasicMaterial;
  private boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 2.7, 2.2), transparent: true, fog: false });
  private haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.3, 2.0), transparent: true, opacity: 0.3, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
  private segGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  private bolt: THREE.Group | null = null;
  private boltAge = 0;
  private labels: Label[] = [];
  private storm: THREE.Group[] = [];
  private rings: THREE.Mesh[] = [];
  private rain: THREE.InstancedMesh;
  private drops: Float32Array;
  private m4 = new THREE.Matrix4();
  flash = 0;
  flicker = 0;

  constructor(seats: MinigameContext['seats'], companions: Companion[]) {
    this.couriers = companions;
    const n = seats.length;
    this.env = rooftop(this.scene, { mood: 'night', w: 16, d: 10, sign: 'storm watch', seed: 2 });
    this.scene.add(this.flashLight);
    const rand = seeded(5);

    // Heavy clouds hanging low over the skyline. They catch the flash.
    for (let i = 0; i < 11; i++) {
      const c = cloud(rand, 2.4 + rand() * 1.6, mix(P.slate, P.midnight, 0.35));
      c.position.set(-30 + i * 6 + rand() * 3, 7.6 + rand() * 3.2, -11 - rand() * 12);
      this.storm.push(c);
      this.scene.add(c);
    }
    const glow = canvasTexture(128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });
    this.sheetMat = new THREE.MeshBasicMaterial({ map: glow, color: new THREE.Color(1.5, 1.6, 2.4), transparent: true, opacity: 0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(110, 60), this.sheetMat);
    this.sheet.position.set(0, 9, -46);
    this.scene.add(this.sheet);

    // Rain: thin slanted streaks, one instanced mesh.
    this.rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.55, 0.014), new THREE.MeshBasicMaterial({ color: '#aebbe8', transparent: true, opacity: 0.28, depthWrite: false }), RAIN);
    this.rain.frustumCulled = false;
    this.drops = new Float32Array(RAIN * 3);
    for (let i = 0; i < RAIN; i++) {
      this.drops[i * 3] = (rand() - 0.5) * RAIN_BOX.x;
      this.drops[i * 3 + 1] = rand() * RAIN_BOX.y;
      this.drops[i * 3 + 2] = (rand() - 0.5) * RAIN_BOX.z + 2;
    }
    this.m4.makeRotationZ(-0.13);
    this.scene.add(this.rain);

    // Two storm lanterns in front light the couriers' faces.
    for (const side of [-1, 1]) {
      const lamp = props.gardenLamp({ h: 0.6, light: 7 });
      lamp.position.set(side * ((n * SPACING) / 2 + 0.9), 0, STAND_Z + 1.5);
      this.scene.add(lamp);
    }
    // A crate with a flask on it: somebody planned to stay a while.
    const crate = props.crate({ s: 0.55 });
    crate.position.set((n * SPACING) / 2 + 1.7, 0, -1.2);
    crate.rotation.y = 0.4;
    this.scene.add(crate);
    const flask = props.drink({ kind: 'bottle', color: P.copper });
    flask.position.set((n * SPACING) / 2 + 1.7, 0.55, -1.2);
    this.scene.add(flask);

    this.xs = seats.map((_, i) => (i - (n - 1) / 2) * SPACING);
    seats.forEach((s, i) => {
      const x = this.xs[i] as number;
      // A doormat to stand on, with a glowing ring in the player's colour.
      part(this.scene, cyl(0.95, 0.95, 0.04, 36), mix(s.color, P.aubergine, 0.6), x, 0.02, STAND_Z, { tex: 'terry', outline: false, shadow: false });
      this.rings.push(part(this.scene, torus(0.95, 0.035), s.color, x, 0.05, STAND_Z, { rx: Math.PI / 2, glow: 1.3, shadow: false }));
      const c = companions[i];
      if (c) {
        c.root.position.set(x, 0.04, STAND_Z);
        c.setBase('listening');
        this.scene.add(c.root);
      }
    });
    this.env.sun.target.position.set(0, 0, STAND_Z);
    this.frame();
  }

  /** Keeps the couriers, their mats and the words over their heads clear of the HUD. */
  private frame(): void {
    this.fit.update(() => {
      const marks: Mark[] = [];
      for (const x of this.xs) {
        for (const dx of [-1, 1]) {
          marks.push({ p: new THREE.Vector3(x + dx, 0, STAND_Z + 0.9) }, { p: new THREE.Vector3(x + dx, LABEL_Y + 1.2, STAND_Z) });
        }
      }
      return marks;
    });
  }

  private segment(group: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, width: number): void {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [mat, w] of [
      [this.boltMat, width],
      [this.haloMat, width * 3.4],
    ] as const) {
      const seg = new THREE.Mesh(this.segGeo, mat);
      seg.scale.set(w, len * 1.04, w);
      seg.position.copy(from).add(to).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      group.add(seg);
    }
  }

  /** A jagged, forked bolt out of the clouds, down between the towers. */
  strike(): void {
    this.flash = 1;
    if (this.bolt) this.scene.remove(this.bolt);
    const bolt = new THREE.Group();
    const z = -19;
    let x = this.camera.position.x + (Math.random() - 0.5) * 9;
    this.sheet.position.x = x;
    let prev = new THREE.Vector3(x, 12.5, z);
    const forks: THREE.Vector3[] = [];
    for (let y = 11.2; y > -6; y -= 1.3) {
      x += (Math.random() - 0.5) * 1.9;
      const next = new THREE.Vector3(x, y, z);
      this.segment(bolt, prev, next, 0.11);
      if (y < 9.5 && y > 2 && Math.random() < 0.3) forks.push(next.clone());
      prev = next;
    }
    for (const start of forks.slice(0, 3)) {
      let p = start;
      const lean = Math.random() < 0.5 ? -1 : 1;
      for (let k = 0; k < 3; k++) {
        const next = new THREE.Vector3(p.x + lean * (0.7 + Math.random() * 0.8), p.y - 0.7 - Math.random() * 0.7, z);
        this.segment(bolt, p, next, 0.055 - k * 0.012);
        p = next;
      }
    }
    this.bolt = bolt;
    this.boltAge = 0;
    this.scene.add(bolt);
  }

  /** Floating words over a courier; `row` 1 sits above row 0 (the reaction time, then the points). */
  label(seat: number, text: string, color: string, row = 0): void {
    const c = this.couriers[seat];
    if (!c) return;
    const s = popSprite(text, color, 0.72);
    s.position.set(c.root.position.x, LABEL_Y + row * 0.8, STAND_Z);
    this.labels.push({ sprite: s, age: 0, w: s.scale.x, h: s.scale.y });
    s.scale.set(0.01, 0.01, 1);
    this.scene.add(s);
  }

  private dropLabel(l: Label): void {
    this.scene.remove(l.sprite);
    l.sprite.material.map?.dispose();
    l.sprite.material.dispose();
  }

  clearLabels(): void {
    for (const l of this.labels) this.dropLabel(l);
    this.labels = [];
    if (this.bolt) this.scene.remove(this.bolt);
    this.bolt = null;
  }

  dispose(): void {
    for (const c of this.couriers) c.dispose();
    for (const l of this.labels) this.dropLabel(l);
    this.boltMat.dispose();
    this.haloMat.dispose();
    this.segGeo.dispose();
    this.sheetMat.map?.dispose();
    this.sheetMat.dispose();
    this.sheet.geometry.dispose();
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
  }

  update(dt: number, time: number): void {
    this.frame();
    this.env.update(dt, time);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.flicker = Math.max(0, this.flicker - dt * 4);
    // The flash: a hard white burst that decays fast, with a stutter in it.
    const stutter = this.flash > 0 ? 0.75 + 0.25 * Math.sin(time * 70) : 1;
    this.flashLight.intensity = this.flash * 4.5 * stutter + this.flicker * 0.9;
    this.sheetMat.opacity = Math.min(1, this.flash * 1.1 * stutter + this.flicker * 0.4);
    if (this.bolt) {
      this.boltAge += dt;
      // Burns bright, then leaves a thin afterglow that fades.
      const k = Math.max(0, 1 - this.boltAge / 0.9);
      this.boltMat.opacity = k * k * (this.boltAge < 0.25 ? stutter : 1);
      this.haloMat.opacity = 0.3 * k;
      this.bolt.visible = k > 0;
    }
    this.couriers.forEach((c) => c.update(dt));
    this.storm.forEach((c, i) => (c.position.x += (0.25 + (i % 3) * 0.08) * dt));
    this.rings.forEach((r, i) => r.scale.setScalar(1 + Math.sin(time * 2.2 + i) * 0.015));
    // Labels pop in with a little overshoot.
    for (const l of this.labels) {
      l.age += dt;
      const t = Math.min(1, l.age / 0.22);
      const s = 1 + 0.18 * Math.sin(t * Math.PI) - (1 - t) * (1 - t) * 0.7;
      l.sprite.scale.set(l.w * s, l.h * s, 1);
    }
    // Rain falls on a slant and wraps around.
    const d = this.drops;
    const m = this.m4;
    for (let i = 0; i < RAIN; i++) {
      const k = i * 3;
      let y = (d[k + 1] as number) - dt * (15 + (i % 5));
      let x = (d[k] as number) - dt * 2;
      if (y < 0) {
        y += RAIN_BOX.y;
        x += (RAIN_BOX.y / 15) * 2;
      }
      d[k] = x;
      d[k + 1] = y;
      m.setPosition(x, y, d[k + 2] as number);
      this.rain.setMatrixAt(i, m);
    }
    this.rain.instanceMatrix.needsUpdate = true;
  }
}

export const minigame: Minigame = {
  id: 'thunder',
  title: 'Thunder Snap',
  how: 'Keep your eyes on the big screen. The moment lightning strikes, tap your phone! Tap too early and you sit out that strike.',
  controller: 'tap',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const view = new StormView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.7 }))));
    ctx.stage.setView(view);
    const strikes: StrikeResult[][] = [];
    const skill = seats.map(() => ctx.skill());
    const totals = seats.map(() => 0);

    for (let n = 0; n < THUNDER.strikes; n++) {
      view.clearLabels();
      const result: StrikeResult[] = seats.map(() => null);
      let flashAt = Infinity; // performance.now() of the flash
      const tapped = new Set<number>();
      session.setLayoutAll(() => ({ kind: 'tap', locked: false, note: 'Watch the big screen…' }));
      ui.caption(`Strike ${n + 1} of ${THUNDER.strikes}: wait for the flash…`);

      const onTap = (seat: number) => {
        if (tapped.has(seat) || seat >= seats.length) return;
        tapped.add(seat);
        const s = session.seats[seat];
        const rt = reactionMs(performance.now(), flashAt, s?.rtt ?? 0);
        if (performance.now() - (s?.rtt ?? 0) / 2 < flashAt) {
          result[seat] = 'early';
          session.setLayout(seat, { kind: 'tap', locked: true, note: 'Too early! Wait for the next strike.' });
          session.send(seat, { t: 'buzz', pattern: [80, 60, 80] });
          view.label(seat, 'Too early', '#FF8FA3');
          view.couriers[seat]?.react('sad', 1.6);
          sfx.bad();
        } else {
          result[seat] = rt;
          session.setLayout(seat, { kind: 'tap', locked: true, note: `${rt} ms` });
          view.label(seat, `${rt} ms`, '#FFF6A8');
          view.couriers[seat]?.react('approval', 1.2);
          sfx.tick();
        }
      };
      const off = session.onInput((seat, msg) => {
        if (msg.t === 'tap' && !session.isCpu(seat)) onTap(seat);
      });

      // Rumble, a fake flicker or two, then the real strike.
      const wait = THUNDER.minWait + rng() * (THUNDER.maxWait - THUNDER.minWait);
      const fakeAt = rng() < 0.6 ? wait * (0.3 + rng() * 0.4) : Infinity;
      let faked = false;
      sfx.rumble();
      // A CPU occasionally jumps the gun.
      seats.forEach((_, i) => {
        if (session.isCpu(i) && rng() < 0.07) void clock.wait(wait * rng()).then(() => onTap(i));
      });
      await everyFrame(clock, (_, t) => {
        if (!faked && t >= fakeAt) {
          faked = true;
          view.flicker = 1;
          sfx.rumble();
        }
        return t >= wait;
      });
      flashAt = performance.now();
      view.strike();
      sfx.thunder();
      for (const i of seats.keys()) session.send(i, { t: 'buzz', pattern: [30] });
      seats.forEach((_, i) => {
        if (!session.isCpu(i) || tapped.has(i)) return;
        const rt = randInt(rng, 230, 330) + (1 - (skill[i] ?? 0.5)) * 380;
        void clock.wait(rt / 1000).then(() => onTap(i));
      });
      await clock.wait(THUNDER.window);
      off();
      strikes.push(result);
      const points = strikePoints(result);
      points.forEach((p, i) => {
        totals[i] = (totals[i] ?? 0) + p;
        if (p > 0) view.label(i, `+${p}`, seats[i]?.color ?? '#fff', 1);
        if (p === 3) view.couriers[i]?.react('happy', 1.6);
      });
      ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${totals[i]} pts` })));
      await clock.wait(1.4);
    }
    ui.caption(null);
    view.clearLabels();
    return {
      scores: thunderScores(strikes, seats.length),
      details: seats.map((_, i) => {
        const best = Math.min(...strikes.map((s) => (typeof s[i] === 'number' ? (s[i] as number) : Infinity)));
        return `${totals[i]} pts${Number.isFinite(best) ? ` · best ${best} ms` : ''}`;
      }),
    };
  },
};
