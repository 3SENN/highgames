// Last Slice on the TV: a kitchen island in the middle of the night, one last slice of pizza on a plate, one
// guard and three snackers. Seen from above at an angle, like peeking in from the doorway.
import * as THREE from 'three';
import { SLICE, type Brain, type Kitchen, type Stick, cpuStick, isOver, newBrain, newKitchen, sliceScores, stepKitchen } from '../../../game/minigames/lastslice';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import { type Env, kitchen } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, box, cyl, gem, material, mix, nameCard, part, pill, popSprite, rbox, sphere, torus, withOutline } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const CAM_POS = new THREE.Vector3(0, 10.5, 9.8);
const CAM_LOOK = new THREE.Vector3(0, -0.2, 0.6);
const HEIGHT = 1.05; // companions are small next to the giant slice
const RING_STEPS = 24; // the grab ring fills in this many steps (each is a cached geometry)
const ROOM = 2.4; // the kitchen is built at life size and scaled up: the companions are small on the worktop
const LAMP = 3.0; // the lamp over the island
const FLOOR = -2.2; // the kitchen floor, below the island top (y = 0)

interface Rig {
  c: Companion;
  marker: THREE.Mesh;
  /** The grab ring over a snacker's head, and its faint backing. */
  progress: THREE.Mesh;
  backing: THREE.Mesh;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
  step: number;
}

/** The last slice: a cheesy wedge with a blistered crust, pepperoni, basil and a few olives, tip toward the audience. */
function pizzaSlice(): THREE.Group {
  const g = new THREE.Group();
  const crust = mix(P.oak, P.mustard, 0.35);
  const cheese = mix(P.mustard, P.cream, 0.45);
  withOutline(0.025, () => {
    part(g, cyl(0.82, 0.82, 0.1, 3), crust, 0, 0.06, 0, { sz: 1.3 });
    part(g, cyl(0.75, 0.75, 0.05, 3), mix(P.brick, P.terracotta, 0.4), 0, 0.115, 0.03, { sz: 1.3, outline: false });
    part(g, cyl(0.7, 0.7, 0.05, 3), cheese, 0, 0.13, 0.06, { sz: 1.3, outline: false, gloss: 0.35 });
    part(g, pill(0.13, 1.2), crust, 0, 0.15, -0.5, { rz: Math.PI / 2, gloss: 0.15 });
    for (const [x, r] of [
      [-0.42, 0.05],
      [-0.1, 0.04],
      [0.25, 0.055],
      [0.5, 0.04],
    ] as const) {
      part(g, sphere(r, 8), mix(crust, P.walnut, 0.45), x, 0.26, -0.47 + r, { sy: 0.4, outline: false });
    }
    for (const [x, z] of [
      [-0.25, -0.15],
      [0.22, -0.1],
      [0, 0.35],
    ] as const) {
      part(g, cyl(0.12, 0.125, 0.035, 16), P.brick, x, 0.165, z, { outline: false, gloss: 0.3 });
      part(g, cyl(0.085, 0.085, 0.037, 14), mix(P.brick, P.terracotta, 0.5), x, 0.166, z, { outline: false });
    }
    for (const [x, z, r] of [
      [0.02, 0.02, 0.4],
      [-0.12, 0.22, 2.0],
      [0.3, -0.3, 1.1],
    ] as const) {
      part(g, sphere(0.07, 8), P.fern, x, 0.165, z, { sy: 0.18, sx: 1.4, ry: r, outline: false });
    }
    for (const [x, z] of [
      [-0.05, -0.3],
      [0.12, 0.14],
      [0.05, 0.6],
    ] as const) {
      part(g, torus(0.035, 0.016), P.charcoal, x, 0.165, z, { rx: Math.PI / 2, outline: false });
    }
    // a string of cheese hanging off the tip
    part(g, pill(0.03, 0.12), cheese, 0.02, 0.07, 1.0, { outline: false, gloss: 0.35 });
  });
  return g;
}

class KitchenView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  readonly rigs: Rig[] = [];
  readonly slice = pizzaSlice();
  private readonly colors: string[];
  private rim: THREE.Mesh;
  private guardCard: THREE.Sprite;
  private wave: THREE.Mesh;
  private waveMat: THREE.MeshBasicMaterial;
  private waveAge = 9;
  private nopeWord = popSprite('Nope!', '#ffffff', 0.75);
  private nopeAge = 9;
  private readonly env: Env;
  private readonly tick: (dt: number, time: number) => void;
  private readonly pendant: THREE.SpotLight;
  private readonly steam: THREE.Mesh[] = [];
  private sparks: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private liftAge = 9;

  constructor(seats: MinigameSeat[], companions: Companion[], guard: number) {
    this.colors = seats.map((s) => s.color);
    // The kitchen in the middle of the night: moonlight through the window, and the pendant lamps left on
    // over the island.
    this.env = kitchen(this.scene, { mood: 'night', w: 10.6, d: 7.4, lights: false, cabinets: P.forest, seed: 3 });
    this.env.root.scale.setScalar(ROOM);
    this.env.root.position.set(0, FLOOR, -0.6);
    this.env.sun.intensity *= 1.7;
    this.scene.traverse((o) => {
      if ((o as THREE.HemisphereLight).isHemisphereLight) (o as THREE.HemisphereLight).intensity *= 1.5;
    });
    const cam = this.env.sun.shadow.camera;
    cam.left = cam.bottom = -9;
    cam.right = cam.top = 9;
    cam.updateProjectionMatrix();
    this.env.root.traverse((o) => {
      if (o.name === 'pendantLamp') o.visible = false;
    });
    // The lamp over the island (just above the picture): a warm pool of light on the worktop, dark all round.
    this.pendant = new THREE.SpotLight(P.lamp, LAMP, 0, 0.78, 0.6, 0);
    this.pendant.position.set(0, 9.5, 0.8);
    this.pendant.target.position.set(0, 0, 0.1);
    this.pendant.castShadow = true;
    this.pendant.shadow.mapSize.set(1024, 1024);
    this.pendant.shadow.bias = -0.002;
    this.pendant.shadow.radius = 4;
    this.scene.add(this.pendant, this.pendant.target);
    this.tick = this.buildKitchen();

    // The plate and the slice, in the middle of the island.
    part(this.scene, cyl(SLICE.plateR, SLICE.plateR * 0.86, 0.07, 40), P.ceramic, 0, 0.035, 0, { gloss: 0.55, outline: 0.03 });
    part(this.scene, cyl(SLICE.plateR * 0.7, SLICE.plateR * 0.7, 0.01, 36), mix(P.ceramic, P.slate, 0.12), 0, 0.072, 0, { outline: false, shadow: false, gloss: 0.5 });
    this.rim = part(this.scene, torus(SLICE.plateR * 0.93, 0.04), P.denim, 0, 0.08, 0, { rx: Math.PI / 2, outline: false });
    for (let k = 0; k < 3; k++) {
      const wisp = part(this.scene, sphere(0.09, 8), P.cream, (k - 1) * 0.22, 0.5, 0.1, { opacity: 0.16, outline: false, shadow: false });
      this.steam.push(wisp);
    }
    this.slice.position.set(0, 0.06, 0);
    this.slice.rotation.y = 0.25;
    this.scene.add(this.slice);

    seats.forEach((s, i) => {
      const c = companions[i] as Companion;
      this.scene.add(c.root);
      const isGuard = i === guard;
      const marker = part(this.scene, torus(isGuard ? 0.6 : 0.48, isGuard ? 0.06 : 0.045), s.color, 0, 0.03, 0, { rx: Math.PI / 2, glow: 1.1, outline: false, shadow: false });
      if (isGuard) part(marker, torus(0.44, 0.03), s.color, 0, 0, 0, { glow: 1.1, outline: false, shadow: false });
      const backing = part(this.scene, torus(0.26, 0.05), P.ink, 0, 0, 0, { opacity: 0.45, shadow: false });
      const progress = part(this.scene, torus(0.26, 0.06, 0.01), s.color, 0, 0, 0, { glow: 1.2, outline: false, shadow: false });
      backing.visible = progress.visible = false;
      c.setBase(isGuard ? 'listening' : 'thinking');
      this.rigs.push({ c, marker, progress, backing, motion: null, mood: null, step: -1 });
    });
    this.guardCard = nameCard('Guard', seats[guard]?.color ?? '#fff', 0.75);
    this.scene.add(this.guardCard);
    this.waveMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(seats[guard]?.color ?? '#fff').multiplyScalar(1.4), transparent: true, opacity: 0, depthWrite: false });
    this.wave = new THREE.Mesh(torus(1, 0.05), this.waveMat);
    this.wave.rotation.x = Math.PI / 2;
    this.wave.visible = false;
    this.nopeWord.visible = false;
    this.scene.add(this.wave, this.nopeWord);

    this.fit();
  }

  private buildKitchen(): (dt: number, time: number) => void {
    const s = this.scene;
    const set = new THREE.Group();
    s.add(set);
    const w = SLICE.bounds.x * 2;
    const d = SLICE.bounds.z * 2;
    // The island: a butcher-block worktop with a rounded edge on deep green cabinets with brass handles.
    part(set, rbox(w + 1.3, 0.34, d + 1.3, 0.1), mix(P.oak, P.walnut, 0.45), 0, -0.17, 0, { tex: 'wood', texScale: 3.4, gloss: 0.25, outline: 0.03 });
    // an inlaid border, and a dusting of flour and crumbs round the plate
    const inlay = { outline: false as const, shadow: false, tex: 'darkWood' as const, texScale: 2 };
    for (const k of [-1, 1]) {
      part(set, box(w + 0.7, 0.012, 0.09), P.walnut, 0, 0.002, k * (d / 2 + 0.42), inlay);
      part(set, box(0.09, 0.012, d + 0.93), P.walnut, k * (w / 2 + 0.42), 0.002, 0, inlay);
    }
    for (let k = 0; k < 16; k++) {
      const a = k * 2.4;
      const r = SLICE.plateR + 0.25 + ((k * 7) % 5) * 0.16;
      part(set, sphere(0.03 + (k % 3) * 0.012, 6), k % 4 ? P.cream : P.oak, Math.cos(a) * r, 0.008, Math.sin(a) * r, { sy: 0.3, outline: false, shadow: false });
    }
    const cab = mix(P.forest, P.ink, 0.12);
    part(set, box(w + 0.7, 1.75, d + 0.7), cab, 0, -1.2, 0, { tex: 'wood', texStrength: 0.4, texScale: 2.5, outline: false });
    part(set, box(w + 0.5, 0.26, d + 0.5), P.charcoal, 0, FLOOR + 0.13, 0, { outline: false });
    for (let i = 0; i < 5; i++) {
      const x = -4.8 + i * 2.4;
      const z = SLICE.bounds.z + 0.36;
      part(set, rbox(2.16, 1.5, 0.08, 0.03), mix(P.forest, P.cream, 0.06), x, -1.2, z, { tex: 'wood', texStrength: 0.4, texScale: 2.5, outline: 0.02 });
      part(set, rbox(1.76, 1.1, 0.04, 0.02), cab, x, -1.2, z + 0.04, { outline: false, shadow: false });
      part(set, pill(0.035, 0.36), P.brass, x + 0.82, -0.7, z + 0.09, { outline: false, gloss: 0.7 });
    }
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = ROOM) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    // Bar stools along the front.
    [-4.4, -1.5, 1.6, 4.5].forEach((x, k) => put(props.stool({ h: 0.66, seat: k % 2 ? P.terracotta : P.mustard }), x, FLOOR, SLICE.bounds.z + 1.9 + (k % 2) * 0.3, k));
    // Small things in the island's corners, out of everyone's way.
    put(props.mug({ color: P.teal }), -SLICE.bounds.x - 0.2, 0, -SLICE.bounds.z - 0.25, 0.8, 1.7);
    put(props.candle({ h: 0.14 }), SLICE.bounds.x + 0.25, 0, -SLICE.bounds.z - 0.25, 0, 2);
    put(props.drink({ kind: 'can', color: P.terracotta }), SLICE.bounds.x + 0.3, 0, SLICE.bounds.z + 0.3, 0, 1.6);
    // A runner by the stools, a plant in the corner.
    put(props.rug({ w: 3.6, d: 1.3, color: P.terracotta, tex: 'terry' }), 0, FLOOR, SLICE.bounds.z + 3.4);
    put(props.plant({ kind: 'monstera', h: 1.1, pot: P.ceramic, seed: 5 }), -9.6, FLOOR, 5.2, 0.6);
    return props.tickProps(set);
  }

  /** A burst of warm crumbs and sparks (the slice is taken). */
  private burst(x: number, y: number, z: number, color: string, n: number): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random();
      const m = part(this.scene, gem(0.06), color, x, y, z, { glow: 2, outline: false, shadow: false });
      this.sparks.push({ m, v: new THREE.Vector3(Math.cos(a) * (1 + Math.random()), 2.2 + Math.random() * 1.5, Math.sin(a) * (1 + Math.random())), age: 0 });
    }
  }

  /** The guard's bump: a ring rushing out and a word over their head. */
  nope(x: number, z: number): void {
    this.wave.position.set(x, 0.06, z);
    this.wave.visible = true;
    this.waveAge = 0;
    this.nopeWord.position.set(x, HEIGHT + 1.1, z);
    this.nopeWord.visible = true;
    this.nopeAge = 0;
  }

  /** The slice goes up over someone's head. */
  lift(seat: number): void {
    const rig = this.rigs[seat];
    if (!rig) return;
    rig.c.root.add(this.slice);
    this.slice.position.set(0, HEIGHT + 0.45, 0);
    this.slice.rotation.set(0.5, 0, 0);
    this.slice.scale.setScalar(0.55);
    this.liftAge = 0;
    for (const m of this.steam) m.visible = false;
    const at = rig.c.root.position;
    this.burst(at.x, HEIGHT + 0.5, at.z, this.colors[seat] ?? P.lamp, 14);
    for (const r of this.rigs) r.backing.visible = r.progress.visible = false;
  }

  /** Puts everyone where the rules say they are. */
  sync(k: Kitchen, dt: number): void {
    const follow = 1 - Math.exp(-dt * 12);
    let leader = -1;
    let most = 0;
    for (let seat = 0; seat < k.runners.length; seat++) {
      const r = k.runners[seat] as Kitchen['runners'][number];
      const rig = this.rigs[seat];
      if (!rig) continue;
      const root = rig.c.root;
      root.position.set(r.x, 0, r.z);
      rig.marker.position.set(r.x, 0.03, r.z);
      const speed = Math.hypot(r.vx, r.vz);
      const sliding = Math.hypot(r.kx, r.kz) > 0.5;
      const target = speed > 0.4 && !sliding ? r.face : 0;
      root.rotation.y += Math.atan2(Math.sin(target - root.rotation.y), Math.cos(target - root.rotation.y)) * follow;
      root.rotation.z = r.stun > 0 ? Math.sin(r.stun * 30) * 0.25 : 0;
      const motion = r.stun > 0 || speed < 0.4 ? null : speed > 2.6 ? 'run' : 'walk';
      if (motion !== rig.motion) {
        rig.motion = motion;
        rig.c.move(motion, speed);
      }
      if (seat === k.guard) continue;
      const mood: CompanionMood = r.stun > 0 ? 'sad' : r.grab > 0 ? 'working' : 'thinking';
      if (mood !== rig.mood) {
        rig.mood = mood;
        rig.c.setBase(mood);
      }
      const step = Math.min(RING_STEPS, Math.ceil((r.grab / SLICE.grab) * RING_STEPS));
      rig.progress.visible = rig.backing.visible = step > 0;
      if (step > 0) {
        if (step !== rig.step) rig.progress.geometry = torus(0.26, 0.06, (step / RING_STEPS) * Math.PI * 2);
        rig.progress.position.set(r.x, HEIGHT + 0.5, r.z);
        rig.backing.position.copy(rig.progress.position);
        if (r.grab > most) {
          most = r.grab;
          leader = seat;
        }
      }
      rig.step = step;
    }
    // The plate's rim lights up in the colour of whoever is closest to grabbing.
    const color = this.colors[leader];
    this.rim.material = material(color ?? P.denim, color ? { glow: 1.2 } : {});
    const g = k.runners[k.guard];
    if (g) this.guardCard.position.set(g.x, HEIGHT + 1.0, g.z);
  }

  dispose(): void {
    for (const r of this.rigs) r.c.dispose();
    for (const k of this.sparks) k.m.removeFromParent();
    this.waveMat.dispose();
    this.pendant.dispose();
  }

  private fittedFor = 0;
  /** Pulls the camera back on screens narrower than 16:9, so the whole island stays in the picture. */
  private fit(): void {
    if (this.camera.aspect === this.fittedFor) return;
    this.fittedFor = this.camera.aspect;
    const back = Math.max(1, 16 / 9 / this.camera.aspect);
    this.camera.position.copy(CAM_LOOK).addScaledVector(CAM_POS.clone().sub(CAM_LOOK), back);
    this.camera.lookAt(CAM_LOOK);
  }

  update(dt: number, time: number): void {
    this.fit();
    for (const r of this.rigs) {
      r.c.update(dt);
      // Grab rings always face the audience, filling round from the top.
      r.progress.quaternion.copy(this.camera.quaternion);
      r.progress.rotateZ(Math.PI / 2);
      r.backing.quaternion.copy(this.camera.quaternion);
    }
    this.env.update(dt, time);
    this.tick(dt, time);
    // The lamp flickers by a hair; the slice is still warm.
    this.pendant.intensity = LAMP * (1 + Math.sin(time * 7.3) * 0.012 + Math.sin(time * 2.1) * 0.015);
    if (this.slice.parent === this.scene) this.slice.position.y = 0.06 + Math.sin(time * 2) * 0.015;
    this.steam.forEach((m, i) => {
      const k = (time * 0.35 + i * 0.37) % 1;
      m.position.set((i - 1) * 0.22 + Math.sin(time * 1.3 + i * 2) * 0.08, 0.35 + k * 0.9, 0.1);
      m.scale.setScalar((0.6 + k * 1.2) * Math.sin(k * Math.PI));
    });
    // Lifted: the slice pops up over the winner's head and settles.
    this.liftAge += dt;
    if (this.slice.parent !== this.scene) {
      const k = Math.min(1, this.liftAge / 0.35);
      const pop = 1 + Math.sin(k * Math.PI) * 0.35;
      this.slice.scale.setScalar(0.55 * pop);
      this.slice.rotation.y = this.liftAge * 1.2;
    }
    this.sparks = this.sparks.filter((p) => {
      p.age += dt;
      p.v.y -= dt * 6;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.y += dt * 6;
      p.m.scale.setScalar(Math.max(0.01, 1 - p.age / 0.9));
      if (p.age < 0.9) return true;
      p.m.removeFromParent();
      return false;
    });
    this.waveAge += dt;
    if (this.wave.visible) {
      const k = Math.min(1, this.waveAge / 0.3);
      this.wave.scale.setScalar(0.3 + k * (SLICE.nopeRadius - 0.3));
      this.waveMat.opacity = 0.9 * (1 - k);
      if (k >= 1) this.wave.visible = false;
    }
    this.nopeAge += dt;
    if (this.nopeWord.visible) {
      this.nopeWord.position.y += dt * 0.8;
      (this.nopeWord.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - Math.max(0, this.nopeAge - 0.35) / 0.3);
      if (this.nopeAge > 0.7) this.nopeWord.visible = false;
    }
  }
}

export const minigame: Minigame = {
  id: 'lastslice',
  title: 'Last Slice',
  how: 'Snackers: sneak up on the last slice of pizza and keep touching its plate for a moment to grab it. Guard: run round it and hit Nope! to bump them away until the time runs out.',
  controller: 'stick',
  kind: '1v3',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const guard = ctx.teams?.[0]?.[0] ?? 0;
    const side = ctx.teams?.[1];
    const snackers = side && side.length ? [...side] : seats.map((_, i) => i).filter((i) => i !== guard);
    const k = newKitchen(seats.length, guard, snackers);
    const view = new KitchenView(seats, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), guard);
    ctx.stage.setView(view);
    const brains: Brain[] = seats.map((_, i) => newBrain(k, i, ctx.skill()));
    const inputs: Stick[] = seats.map(() => ({ x: 0, y: 0, a: false }));
    const latch = seats.map(() => false);

    session.setLayoutAll((seat) =>
      seat.index === guard
        ? { kind: 'stick', button: 'Nope!', note: 'You guard the slice! Run round the plate and hit Nope! to bump snackers away.' }
        : { kind: 'stick', button: null, note: 'Sneak up and keep touching the plate to grab the last slice!' },
    );
    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'stick' || session.isCpu(seat) || !inputs[seat]) return;
      // A quick tap can go down and up between two frames: remember it.
      if (msg.a && !(inputs[seat] as Stick).a) latch[seat] = true;
      inputs[seat] = { x: msg.x, y: msg.y, a: msg.a };
    });

    const guardName = seats[guard]?.name ?? 'The guard';
    ui.caption(`${guardName} guards the last slice. Snackers: go get it!`, seats[guard]?.color);
    let hudAt = 0;
    await everyFrame(clock, (dt) => {
      const sticks = seats.map((_, i) => {
        if (session.isCpu(i)) return cpuStick(k, i, brains[i] as Brain, rng);
        const s = inputs[i] as Stick;
        const a = s.a || (latch[i] ?? false);
        latch[i] = false;
        return { x: s.x, y: s.y, a };
      });
      // Small steps so bumps and shoves stay solid even on a slow frame.
      const n = Math.max(1, Math.ceil(dt / (1 / 60)));
      for (let i = 0; i < n && !isOver(k); i++) {
        // The same sticks for every small step: a press counts once, on the step it first goes down.
        const ev = stepKitchen(k, sticks, dt / n);
        if (ev.nope) {
          const g = k.runners[guard];
          view.nope(g?.x ?? 0, g?.z ?? 0);
          sfx.whoosh();
          if (ev.nope.length) {
            sfx.pop();
            session.send(guard, { t: 'buzz', pattern: [25] });
          }
          for (const s of ev.nope) {
            session.send(s, { t: 'buzz', pattern: [70, 40, 70] });
            view.rigs[s]?.c.react('sad', SLICE.stun + 0.4);
          }
        }
      }
      view.sync(k, dt);
      if (clock.time - hudAt > 0.1) {
        hudAt = clock.time;
        ui.timer(SLICE.duration - k.time);
        ui.live(
          seats.map((s, i) => {
            const r = k.runners[i];
            let value = 'Sneaking';
            if (i === guard) value = `Guard · ${r?.nopes ?? 0} nopes`;
            else if ((r?.stun ?? 0) > 0) value = 'Nope’d!';
            else if ((r?.grab ?? 0) > 0) value = `${Math.round(((r?.grab ?? 0) / SLICE.grab) * 100)}%`;
            return { name: s.name, color: s.color, thumb: s.thumb, value };
          }),
        );
      }
      return isOver(k);
    });
    off();
    ui.timer(null);

    // The end: everyone turns to the audience and someone holds the slice up high.
    for (const r of view.rigs) {
      r.c.move(null);
      r.motion = null;
      r.c.root.rotation.set(0, 0, 0);
    }
    const winner = k.grabbedBy ?? guard;
    view.lift(winner);
    if (k.grabbedBy !== null) {
      sfx.fanfare();
      ui.caption(`${seats[winner]?.name ?? 'A snacker'} grabbed the last slice!`, seats[winner]?.color);
      snackers.forEach((s) => view.rigs[s]?.c.setBase('happy'));
      view.rigs[guard]?.c.setBase('sad');
    } else {
      sfx.win();
      ui.caption(`The slice is safe! ${guardName} gets the last bite.`, seats[guard]?.color);
      snackers.forEach((s) => view.rigs[s]?.c.setBase('sad'));
      view.rigs[guard]?.c.setBase('happy');
    }
    for (const i of seats.keys()) session.send(i, { t: 'buzz', pattern: [40, 30, 120] });
    await clock.wait(2);
    ui.caption(null);

    const guardWon = k.grabbedBy === null;
    return {
      scores: sliceScores(k, seats.length),
      details: seats.map((_, i) => {
        const r = k.runners[i];
        if (i === guard) return guardWon ? `Kept the slice safe · ${r?.nopes ?? 0} nopes` : `Lost the slice at ${k.time.toFixed(1)} s · ${r?.nopes ?? 0} nopes`;
        if (i === k.grabbedBy) return 'Grabbed the last slice!';
        const n = r?.nopes ?? 0;
        return `${guardWon ? 'No slice' : 'Team snack'} · nope’d ${n} time${n === 1 ? '' : 's'}`;
      }),
    };
  },
};
