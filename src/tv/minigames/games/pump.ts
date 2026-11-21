// Balloon Pump on the TV: four hot-air balloons racing up out of a garden at dusk to the finish bunting.
import * as THREE from 'three';
import { PUMP, newBalloon, pumpBalloon, pumpScores, stepBalloon } from '../../../game/minigames/pump';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cone, cyl, mix, nameCard, part, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark } from '../kit';
import { type Minigame, everyFrame } from '../types';

const LIFT = 13; // world units from the ground to the ribbon
const SPACING = 3.8;

interface Scrap {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface Rig {
  group: THREE.Group;
  /** Scaled by the game with the air in the balloon. */
  envelope: THREE.Group;
  /** Inside the envelope: squashes a little with every pump. */
  skin: THREE.Group;
  flame: THREE.Mesh;
  courier: Companion;
  pulse: number;
  scraps: Scrap[];
}

/** A thin strut between two points (ropes, burner frame). */
function strut(group: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, color: string): void {
  const dir = b.clone().sub(a);
  const m = part(group, cyl(r, r, 1, 6), color, 0, 0, 0, { outline: false, shadow: false });
  m.scale.y = dir.length();
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

/** A small balloon far away, just drifting. */
function farBalloon(color: string): THREE.Group {
  const g = new THREE.Group();
  const o = { outline: false as const, shadow: false };
  part(g, sphere(1, 18), color, 0, 0, 0, { ...o, sy: 1.12 });
  part(g, torus(0.99, 0.07), P.cream, 0, 0, 0, { ...o, rx: Math.PI / 2 });
  part(g, cyl(0.5, 0.3, 0.5, 14), mix(color, P.ink, 0.2), 0, -1.2, 0, o);
  part(g, rbox(0.5, 0.36, 0.5, 0.05), P.walnut, 0, -2.1, 0, o);
  return g;
}

class PumpView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 240);
  readonly rigs: Rig[] = [];
  private readonly env: Env;
  private readonly fit = new CameraFit(this.camera, 0.05);
  private readonly tick: (dt: number, time: number) => void;
  private readonly floaters = new Floaters(this.scene);
  private readonly far: THREE.Group[] = [];
  private readonly half: number;

  constructor(colors: string[], characters: Companion[]) {
    const n = colors.length;
    this.half = ((n - 1) / 2) * SPACING;
    const span = this.half * 2 + 6.6; // between the finish poles
    this.env = backyard(this.scene, { mood: 'evening', w: 34, d: 12, patio: { w: this.half * 2 + 4.4, d: 4.4 }, clear: { w: this.half * 2 + 6, d: 5.5 }, seed: 6 });
    const rand = seeded(9);

    // The sky: slow clouds catching the last light, and a few balloons already far away.
    const sky = new THREE.Group();
    const clouds = props.cloudBank({ n: 11, area: [90, 11, 16], scale: 2.5, color: '#e7b9b4', speed: 0.45, seed: 4 });
    clouds.position.set(0, 12, -34);
    sky.add(clouds);
    const farSpots: [number, number, number, string][] = [
      [-19, 9.5, -36, P.terracotta],
      [15, 14, -46, P.teal],
      [25, 6.5, -40, P.mauve],
    ];
    for (const [x, y, z, c] of farSpots) {
      const b = farBalloon(c);
      b.position.set(x, y, z);
      b.scale.setScalar(1.5);
      this.far.push(b);
      sky.add(b);
    }
    this.scene.add(sky);
    this.tick = props.tickProps(sky);

    // The finish: two tall poles, a glowing ribbon and bunting between them.
    const fy = LIFT + 1.4;
    for (const side of [-1, 1]) {
      const x = (side * span) / 2;
      part(this.scene, cyl(0.11, 0.16, fy + 0.9, 12), P.walnut, x, (fy + 0.9) / 2 - 0.2, -1, { tex: 'planks', texScale: 1.2 });
      part(this.scene, rbox(0.7, 0.3, 0.7, 0.05), P.stone, x, 0.15, -1, { tex: 'stoneTiles', outline: false });
      part(this.scene, sphere(0.24, 16), P.brass, x, fy + 0.85, -1, { gloss: 0.7 });
      part(this.scene, sphere(0.1, 10), P.lamp, x, fy + 1.2, -1, { glow: 2.2, outline: false, shadow: false });
    }
    part(this.scene, rbox(span, 0.14, 0.07, 0.03), P.mustard, 0, fy, -1, { glow: 0.5, outline: false, shadow: false });
    const flags = Math.round(span / 0.62);
    const flagGeo = new THREE.ConeGeometry(0.2, 0.38, 3);
    flagGeo.scale(1, 1, 0.12);
    for (let k = 0; k < flags; k++) {
      const x = -span / 2 + ((k + 0.5) / flags) * span;
      part(this.scene, flagGeo, props.FABRICS[(k * 3) % props.FABRICS.length] as string, x, fy - 0.27, -1, { rx: Math.PI, rz: (rand() - 0.5) * 0.2, outline: false, shadow: false });
    }
    const finish = nameCard('Finish', P.mustard, 1.4);
    finish.position.set(0, fy + 1.1, -1);
    this.scene.add(finish);

    colors.forEach((color, i) => {
      const group = new THREE.Group();
      group.position.set((i - (n - 1) / 2) * SPACING, 0, 0);
      // The basket: wicker, a leather rim, a band in the player's colour, sandbags.
      part(group, rbox(1.5, 0.9, 1.5, 0.12), P.oak, 0, 0.45, 0, { tex: 'knit', texScale: 0.5 });
      part(group, rbox(1.62, 0.14, 1.62, 0.06), P.walnut, 0, 0.92, 0, { tex: 'leather', gloss: 0.2 });
      part(group, rbox(1.53, 0.16, 1.53, 0.05), color, 0, 0.3, 0, { outline: false });
      for (const sx of [-1, 1]) {
        part(group, sphere(0.16, 10), P.sand, sx * 0.84, 0.5, 0.3, { sy: 1.2, tex: 'fabric', outline: false });
        strut(group, new THREE.Vector3(sx * 0.84, 0.66, 0.3), new THREE.Vector3(sx * 0.8, 0.9, 0.3), 0.012, P.walnut);
      }
      const courier = characters[i] as Companion;
      courier.root.position.y = 0.5;
      courier.setBase('working');
      group.add(courier.root);
      // Ropes up to the burner ring, the burner and its flame.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) strut(group, new THREE.Vector3(sx * 0.7, 0.95, sz * 0.7), new THREE.Vector3(sx * 0.27, 2.12, sz * 0.27), 0.016, P.walnut);
      part(group, torus(0.38, 0.03), P.metal, 0, 2.12, 0, { rx: Math.PI / 2, outline: false, gloss: 0.5 });
      part(group, cyl(0.08, 0.11, 0.18, 10), P.brass, 0, 2.08, 0, { outline: false, gloss: 0.7 });
      const flame = part(group, cone(0.1, 0.34, 10), P.ember, 0, 2.34, 0, { glow: 2.4, outline: false, shadow: false });

      const envelope = new THREE.Group();
      const skin = new THREE.Group();
      envelope.add(skin);
      part(skin, sphere(1, 28), color, 0, 0, 0, { sy: 1.12, gloss: 0.2 });
      const rib = mix(color, P.ink, 0.32);
      for (let k = 0; k < 4; k++) part(skin, torus(1.0, 0.022), rib, 0, 0, 0, { ry: (k * Math.PI) / 4, sy: 1.12, outline: false, shadow: false });
      part(skin, torus(0.985, 0.075), P.cream, 0, 0, 0, { rx: Math.PI / 2, outline: false, shadow: false });
      part(skin, cyl(0.52, 0.3, 0.5, 20), mix(color, P.ink, 0.2), 0, -1.2, 0);
      part(skin, torus(0.3, 0.03), P.cream, 0, -1.45, 0, { rx: Math.PI / 2, outline: false, shadow: false });
      part(skin, sphere(0.15, 12), P.cream, 0, 1.13, 0, { outline: false });
      envelope.position.y = 3.2;
      group.add(envelope);

      // Scraps for when it bursts (and confetti for the finish).
      const scraps: Scrap[] = [];
      for (let k = 0; k < 12; k++) {
        const mesh = part(this.scene, box(0.24, 0.02, 0.17), k % 3 === 2 ? P.cream : color, 0, 0, 0, { outline: false, shadow: false });
        mesh.visible = false;
        scraps.push({ mesh, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
      }
      this.scene.add(group);
      this.rigs.push({ group, envelope, skin, flame, courier, pulse: 0, scraps });
    });
    this.env.sun.target.position.set(0, LIFT / 2, 0);
    this.frame();
  }

  /** The whole climb, from the baskets on the grass to the finish sign, clear of the HUD. */
  private frame(): void {
    this.fit.update(() => {
      const marks: Mark[] = [];
      for (const side of [-1, 1]) {
        marks.push({ p: new THREE.Vector3(side * (this.half + 1.7), 0, 1.4) }, { p: new THREE.Vector3(side * (this.half + 1.7), LIFT + 3, -1) });
      }
      return marks;
    });
  }

  /** A pump went in: the burner flares and the balloon swells for a moment. */
  pumped(seat: number): void {
    const r = this.rigs[seat];
    if (r) r.pulse = 1;
  }

  private scatter(r: Rig, speed: number): void {
    const at = r.envelope.getWorldPosition(new THREE.Vector3());
    for (const s of r.scraps) {
      s.mesh.visible = true;
      s.mesh.position.copy(at);
      s.mesh.scale.setScalar(1);
      const a = Math.random() * Math.PI * 2;
      s.v.set(Math.cos(a) * speed * (0.5 + Math.random()), speed * (0.3 + Math.random() * 0.9), Math.sin(a) * speed * 0.5);
      s.spin.set(Math.random() * 9, Math.random() * 9, Math.random() * 9);
      s.life = 0.9 + Math.random() * 0.4;
    }
  }

  /** The balloon burst: scraps fly. */
  burst(seat: number): void {
    const r = this.rigs[seat];
    if (!r) return;
    this.scatter(r, 4.5);
    this.floaters.add('Pop!', P.cream, r.envelope.getWorldPosition(new THREE.Vector3()), 0.8, 1);
  }

  /** Through the ribbon: confetti. */
  finished(seat: number): void {
    const r = this.rigs[seat];
    if (r) this.scatter(r, 3.2);
  }

  dispose(): void {
    for (const r of this.rigs) r.courier.dispose();
    this.floaters.dispose();
  }

  update(dt: number, time: number): void {
    this.frame();
    this.env.update(dt, time);
    this.tick(dt, time);
    this.floaters.update(dt);
    this.far.forEach((b, i) => {
      b.position.y += Math.sin(time * 0.4 + i * 2) * dt * 0.12;
      b.rotation.y = time * 0.05 + i;
    });
    this.rigs.forEach((r, i) => {
      r.courier.update(dt);
      r.pulse = Math.max(0, r.pulse - dt * 5);
      // Squash and settle with each pump; a slow sway in the air.
      const p = Math.sin(r.pulse * Math.PI) * 0.07;
      r.skin.scale.set(1 + p, 1 - p * 0.8, 1 + p);
      const flicker = 0.85 + Math.sin(time * 23 + i * 1.7) * 0.1 + Math.sin(time * 37 + i) * 0.05;
      r.flame.scale.set(flicker * (1 + r.pulse * 0.6), flicker * (1 + r.pulse * 1.5), flicker * (1 + r.pulse * 0.6));
      const air = Math.min(1, r.group.position.y / 1.5);
      r.group.rotation.z = Math.sin(time * 0.9 + i * 1.3) * 0.025 * air;
      r.group.position.x = (i - (this.rigs.length - 1) / 2) * SPACING + Math.sin(time * 0.6 + i * 2.1) * 0.12 * air;
      for (const s of r.scraps) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.v.y -= 7 * dt;
        s.v.multiplyScalar(1 - dt * 1.2);
        s.mesh.position.addScaledVector(s.v, dt);
        s.mesh.rotation.x += s.spin.x * dt;
        s.mesh.rotation.y += s.spin.y * dt;
        s.mesh.rotation.z += s.spin.z * dt;
        s.mesh.scale.setScalar(Math.min(1, s.life * 3));
        if (s.life <= 0) s.mesh.visible = false;
      }
    });
  }
}

export const minigame: Minigame = {
  id: 'pump',
  title: 'Balloon Pump',
  how: 'Pump your phone up and down to fill your balloon and float to the finish. Watch the gauge on your phone: past the red line, it bursts!',
  controller: 'pump',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const balloons = seats.map(() => newBalloon());
    const view = new PumpView(
      seats.map((s) => s.color),
      await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 1.25 }))),
    );
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'pump' }));
    const skill = seats.map(() => ctx.skill());
    const cpuNext = seats.map(() => 0);
    const cpuTarget = seats.map((_, i) => 62 + (skill[i] ?? 0.5) * 30);
    const lastPumpSound = seats.map(() => 0);

    const doPump = (seat: number, power: number, time: number) => {
      const b = balloons[seat];
      if (!b) return;
      const r = pumpBalloon(b, power);
      if (r === 'burst') {
        sfx.pop();
        session.send(seat, { t: 'buzz', pattern: [200] });
        session.send(seat, { t: 'feedback', good: false, text: 'Pop! Your balloon burst.' });
        view.burst(seat);
        view.rigs[seat]?.envelope.scale.setScalar(0.01);
        view.rigs[seat]?.courier.react('sad', 1.6);
      } else if (r === 'ok') {
        view.pumped(seat);
        if (time - (lastPumpSound[seat] ?? 0) <= 0.08) return;
        lastPumpSound[seat] = time;
        sfx.pump();
      }
    };
    let now = 0;
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'pump' && !session.isCpu(seat)) doPump(seat, msg.power, now);
    });

    let meterAt = 0;
    ui.caption('Pump! Keep your balloon out of the red.');
    await everyFrame(clock, (dt, t) => {
      now = t;
      balloons.forEach((b, i) => {
        if (session.isCpu(i) && t >= (cpuNext[i] ?? 0) && b.finishedAt === null) {
          const greedy = rng() < 0.04 * (1.2 - (skill[i] ?? 0.5));
          if (b.air < (cpuTarget[i] ?? 75) || greedy) doPump(i, 0.75 + rng() * 0.25, t);
          cpuNext[i] = t + 0.16 + rng() * 0.22 * (1.3 - (skill[i] ?? 0.5));
        }
        const wasDone = b.finishedAt !== null;
        stepBalloon(b, dt, t);
        if (!wasDone && b.finishedAt !== null) {
          view.rigs[i]?.courier.setBase('happy');
          view.finished(i);
        }
        const rig = view.rigs[i];
        if (rig) {
          rig.group.position.y = (b.height / PUMP.goal) * LIFT;
          if (b.stun <= 0) rig.envelope.scale.setScalar(0.45 + (b.air / PUMP.burstAt) * 1.0);
          rig.envelope.position.y = 2.6 + rig.envelope.scale.y * 0.95;
        }
      });
      if (t - meterAt > 0.1) {
        meterAt = t;
        balloons.forEach((b, i) => {
          if (!session.isCpu(i)) session.send(i, { t: 'meter', value: b.air / PUMP.burstAt, danger: b.air / PUMP.burstAt > PUMP.danger });
        });
        ui.timer(PUMP.duration - t);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: balloons[i]?.finishedAt != null ? 'Finished!' : `${Math.round(balloons[i]?.height ?? 0)} m` })));
      }
      return t >= PUMP.duration || balloons.every((b) => b.finishedAt !== null);
    });
    off();
    ui.timer(null);
    ui.caption(null);
    return {
      scores: pumpScores(balloons),
      details: balloons.map((b) => (b.finishedAt !== null ? `Finished in ${b.finishedAt.toFixed(1)} s` : `Reached ${Math.round(b.height)} m`) + (b.bursts ? ` · ${b.bursts} pop${b.bursts > 1 ? 's' : ''}` : '')),
    };
  },
};
