// Donut Dash on the TV: paper gliders flying into the screen at dusk, above the clouds, through a trail of
// giant glazed donuts.
import * as THREE from 'three';
import { GLIDER, type Glider, type Ring, flyThrough, makeRings, newGlider, stepGlider } from '../../../game/minigames/glider';
import { type Companion, buildCompanion } from '../../../companion/kit';
import { PALETTE as P, SKIES, applySky, cloud, gem, material, mix, part, seeded, sphere, toonMat } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const FROSTING = [P.rose, P.walnut, P.cream, mix(P.teal, P.cream, 0.5)];
const SPRINKLES = [P.terracotta, P.mustard, P.cream, P.teal, P.mauve];
const DOUGH = mix(P.oak, P.mustard, 0.35);
/** Shifts the view right, so the flight corridor sits in the part of the screen the score list leaves free. */
const CAM_X = -1.5;
const FLOOR = 240; // cloud puffs below, recycled as the camera passes
const FLOOR_SPAN = 250;
const STREAKS = 26;

function paperGlider(color: string): THREE.Group {
  const g = new THREE.Group();
  // A folded paper plane: two wings and a keel, nose pointing -z.
  const tri = (v: number[], c: string) => {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    shape.computeVertexNormals();
    const m = new THREE.Mesh(shape, toonMat({ color: c, side: THREE.DoubleSide }));
    g.add(m);
  };
  tri([0, 0, -1.6, -1.3, 0.05, 0.9, 0, 0.1, 0.6, 0, 0, -1.6, 0, 0.1, 0.6, 1.3, 0.05, 0.9], color);
  tri([0, 0, -1.6, 0, -0.45, 0.7, 0, 0.1, 0.6], mix(color, P.ink, 0.3));
  // Paper-white trim along the back edges, and a darker fold line along the keel.
  tri([-1.3, 0.07, 0.9, 0, 0.12, 0.6, -0.1, 0.125, 0.4, -1.3, 0.07, 0.9, -0.1, 0.125, 0.4, -1.12, 0.08, 0.6], P.cream);
  tri([1.3, 0.07, 0.9, 0.1, 0.125, 0.4, 0, 0.12, 0.6, 1.3, 0.07, 0.9, 1.12, 0.08, 0.6, 0.1, 0.125, 0.4], P.cream);
  const fold = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.105, -1.6), new THREE.Vector3(0, 0.105, 0.6)]), new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) }));
  g.add(fold);
  // Soft trails off the wingtips.
  const trail = new THREE.MeshBasicMaterial({ color: mix(color, '#ffffff', 0.5), transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.05, 0, 0, 0.05, 0, 0, 0, 0, 3.4]), 3));
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(trailGeo, trail);
    t.position.set(sx * 1.22, 0.05, 0.9);
    g.add(t);
  }
  return g;
}

interface Spark {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  life: number;
}

class SkyCourse implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 300);
  readonly planes: THREE.Group[] = [];
  readonly ringMeshes: THREE.Mesh[] = [];
  private readonly donuts: THREE.Group[] = [];
  private readonly pulse: { ring: THREE.Group; t: number }[] = [];
  private readonly sparks: Spark[] = [];
  private nextSpark = 0;
  private readonly floor: THREE.InstancedMesh;
  private readonly puffs: { x: number; y: number; z: number; s: number }[] = [];
  private readonly drift: THREE.Group[] = [];
  private readonly streaks: THREE.InstancedMesh;
  private readonly streakAt: { x: number; y: number; z: number }[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly geos: THREE.BufferGeometry[] = [];
  distance = 0;

  constructor(seats: MinigameSeat[], rings: Ring[], readonly riders: Companion[]) {
    const sun = applySky(this.scene, SKIES.dusk, { near: 70, far: 240 }, 30);
    sun.castShadow = false; // nothing to cast on up here
    const rand = seeded(3);

    // A floor of cloud far below: one instanced mesh, its puffs moved ahead again once they are behind us.
    this.floor = new THREE.InstancedMesh(sphere(1, 14), material(mix('#e9b8b4', P.mauve, 0.25), { exact: true, outline: false, rim: 0.7 }), FLOOR);
    this.floor.frustumCulled = false;
    this.floor.castShadow = false;
    this.floor.receiveShadow = false;
    for (let i = 0; i < FLOOR; i++) {
      const puff = { x: (rand() - 0.5) * 150, y: -15 - rand() * 5 - Math.abs(rand() - 0.5) * 6, z: 20 - rand() * FLOOR_SPAN, s: 5 + rand() * 6 };
      this.puffs.push(puff);
      this.setPuff(i);
    }
    this.scene.add(this.floor);
    // Clouds drifting by at our height, kept out of the flight corridor.
    for (let i = 0; i < 16; i++) {
      const c = cloud(rand, 1.6 + rand() * 2.2, mix('#f0c8bc', P.mauve, rand() * 0.3));
      const side = i % 2 ? 1 : -1;
      c.position.set(side * (17 + rand() * 26), -6 + rand() * 24, 10 - (i / 16) * FLOOR_SPAN - rand() * 10);
      this.drift.push(c);
      this.scene.add(c);
    }
    // Streaks of wind for a sense of speed.
    this.streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.025, 0.025, 2.6), new THREE.MeshBasicMaterial({ color: '#fff2e2', transparent: true, opacity: 0.22, depthWrite: false }), STREAKS);
    this.streaks.frustumCulled = false;
    for (let i = 0; i < STREAKS; i++) {
      this.streakAt.push({ x: (rand() - 0.5) * 34, y: -3 + rand() * 17, z: 10 - rand() * 90 });
    }
    this.scene.add(this.streaks);

    // The donuts: dough, glossy frosting on the side the gliders come from, and sprinkles (one instanced mesh).
    const ringGeo = new Map<string, THREE.TorusGeometry>();
    const torusOf = (r: number, tube: number) => {
      const key = `${r}:${tube.toFixed(3)}`;
      let g = ringGeo.get(key);
      if (!g) {
        g = new THREE.TorusGeometry(r, tube, 14, 56);
        ringGeo.set(key, g);
        this.geos.push(g);
      }
      return g;
    };
    const perRing = 9;
    const sprinkleGeo = new THREE.CapsuleGeometry(0.035, 0.16, 2, 6);
    this.geos.push(sprinkleGeo);
    const sprinkles = new THREE.InstancedMesh(sprinkleGeo, toonMat({ color: '#ffffff' }), rings.length * perRing);
    sprinkles.castShadow = false;
    sprinkles.frustumCulled = false;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const tint = new THREE.Color();
    rings.forEach((r, index) => {
      const tube = r.gold ? 0.36 : 0.33;
      const donut = new THREE.Group();
      donut.position.set(r.x, r.y, -r.z);
      part(donut, torusOf(r.r, tube), r.gold ? mix(P.mustard, P.brass, 0.4) : DOUGH, 0, 0, 0, { outline: 0.03, gloss: 0.15, shadow: false });
      const icing = FROSTING[index % FROSTING.length] as string;
      this.ringMeshes.push(part(donut, torusOf(r.r, tube * 0.66), r.gold ? P.lamp : icing, 0, 0, tube * 0.56, { glow: r.gold ? 0.9 : 0.06, gloss: 0.5, outline: false, shadow: false }));
      if (r.gold) {
        // Golden ones twinkle.
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.6;
          part(donut, gem(0.13), P.lamp, Math.cos(a) * (r.r + 0.55), Math.sin(a) * (r.r + 0.55), 0, { glow: 2, outline: false, shadow: false });
        }
      }
      for (let k = 0; k < perRing; k++) {
        const a = (k / perRing) * Math.PI * 2 + r.z;
        pos.set(r.x + Math.cos(a) * r.r, r.y + Math.sin(a) * r.r, -r.z + tube * 1.2);
        e.set(0, 0, a * 2.3);
        this.m4.compose(pos, q.setFromEuler(e), one);
        sprinkles.setMatrixAt(index * perRing + k, this.m4);
        sprinkles.setColorAt(index * perRing + k, tint.set(r.gold ? P.cream : (SPRINKLES[(k + index) % SPRINKLES.length] as string)));
      }
      this.donuts.push(donut);
      this.scene.add(donut);
    });
    this.scene.add(sprinkles);

    // Sparkles that burst out of a donut when somebody flies through it.
    for (let k = 0; k < 16; k++) {
      const mesh = part(this.scene, gem(0.16), P.lamp, 0, 0, 0, { glow: 2.2, outline: false, shadow: false });
      mesh.visible = false;
      this.sparks.push({ mesh, v: new THREE.Vector3(), life: 0 });
    }

    seats.forEach((s, i) => {
      const p = paperGlider(s.color);
      const rider = riders[i];
      if (rider) {
        // Riding along, facing the way the glider flies (-z).
        rider.root.position.set(0, 0.1, 0.25);
        rider.root.rotation.y = Math.PI;
        rider.setBase('happy');
        p.add(rider.root);
      }
      this.planes.push(p);
      this.scene.add(p);
    });
    this.update(0, 0);
  }

  private setPuff(i: number): void {
    const p = this.puffs[i];
    if (!p) return;
    this.m4.makeScale(p.s * 1.5, p.s * 0.7, p.s);
    this.m4.setPosition(p.x, p.y, p.z);
    this.floor.setMatrixAt(i, this.m4);
  }

  /**
   * Colours a ring in the first flyer's colour (swaps the shared material rather than changing it); the donut
   * bounces and throws sparkles.
   */
  claim(index: number, color: string): void {
    const m = this.ringMeshes[index];
    if (m) m.material = material(color, { glow: 0.7 });
    const donut = this.donuts[index];
    if (!donut) return;
    this.pulse.push({ ring: donut, t: 0 });
    for (let k = 0; k < 8; k++) {
      const s = this.sparks[this.nextSpark++ % this.sparks.length] as Spark;
      const a = (k / 8) * Math.PI * 2 + index;
      s.mesh.visible = true;
      s.mesh.position.set(donut.position.x + Math.cos(a) * 1.6, donut.position.y + Math.sin(a) * 1.6, donut.position.z);
      s.v.set(Math.cos(a) * 5, Math.sin(a) * 5, -GLIDER.speed * 0.8);
      s.life = 0.6;
    }
  }

  dispose(): void {
    for (const r of this.riders) r.dispose();
    for (const g of this.geos) g.dispose();
    this.streaks.geometry.dispose();
    (this.streaks.material as THREE.Material).dispose();
  }

  update(dt: number, time: number): void {
    for (const r of this.riders) r.update(dt);
    const camZ = -this.distance + 15;
    this.camera.position.set(CAM_X, 7.5, camZ);
    this.camera.lookAt(CAM_X, 5, -this.distance - 20);
    // Recycle the cloud floor, the drifting clouds and the wind streaks.
    let moved = false;
    this.puffs.forEach((p, i) => {
      if (p.z < camZ + 12) return;
      p.z -= FLOOR_SPAN;
      this.setPuff(i);
      moved = true;
    });
    if (moved || time === 0) this.floor.instanceMatrix.needsUpdate = true;
    for (const c of this.drift) {
      c.position.x += dt * 0.5;
      if (c.position.z > camZ + 8) c.position.z -= FLOOR_SPAN;
    }
    this.streakAt.forEach((s, i) => {
      if (s.z > camZ + 4) s.z -= 90;
      this.m4.makeTranslation(s.x + CAM_X, s.y, s.z);
      this.streaks.setMatrixAt(i, this.m4);
    });
    this.streaks.instanceMatrix.needsUpdate = true;
    // A donut somebody flew through bounces (1 -> 1.16 -> 0.97 -> 1).
    for (let i = this.pulse.length - 1; i >= 0; i--) {
      const p = this.pulse[i] as { ring: THREE.Group; t: number };
      p.t += dt;
      const k = Math.min(1, p.t / 0.4);
      p.ring.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.16 * (1 - k * 0.5) - Math.sin(k * Math.PI * 2) * 0.03);
      if (k >= 1) {
        p.ring.scale.setScalar(1);
        this.pulse.splice(i, 1);
      }
    }
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.y += dt * 9;
      s.mesh.scale.setScalar(Math.max(0.01, s.life / 0.6));
      if (s.life <= 0) s.mesh.visible = false;
    }
    // Golden donuts turn slowly, so their twinkles catch the eye.
    this.donuts.forEach((d, i) => {
      if (d.children.length > 2) d.rotation.z = time * 0.5 + i;
    });
  }
}

export const minigame: Minigame = {
  id: 'glider',
  title: 'Donut Dash',
  how: 'Somebody left giant donuts floating in the sky. Hold your phone flat like a paper plane, tilt to steer, and fly through as many as you can: golden glazed ones are worth 3!',
  controller: 'tilt',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const rings = makeRings(rng);
    const gliders: Glider[] = seats.map((s) => newGlider(s.index, seats.length));
    const inputs = seats.map(() => ({ x: 0, y: 0 }));
    const skill = seats.map(() => ctx.skill());
    const view = new SkyCourse(seats, rings, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: 0.9, shadows: false }))));
    ctx.stage.setView(view);
    session.setLayoutAll(() => ({ kind: 'tilt', title: 'Donut Dash', note: 'Tilt to steer through the donuts. Nose down to dive.' }));
    const off = session.onInput((seat, msg) => {
      if (msg.t === 'tilt' && inputs[seat] && !session.isCpu(seat)) inputs[seat] = { x: msg.x, y: msg.y };
    });

    let nextRing = 0;
    let hudAt = 0;
    ui.caption('Tilt to steer through the rings!');
    await everyFrame(clock, (dt, t) => {
      const before = view.distance;
      view.distance = t * GLIDER.speed;
      gliders.forEach((g, i) => {
        if (session.isCpu(i)) {
          const target = rings.find((r) => r.z > view.distance + 2) ?? rings[rings.length - 1];
          if (target) {
            const s = skill[i] ?? 0.5;
            const wobble = Math.sin(t * (1.3 + i) + i) * (1.4 - s) * 1.6;
            inputs[i] = {
              x: Math.max(-1, Math.min(1, (target.x + wobble - g.x) * (0.25 + s * 0.3))),
              y: Math.max(-1, Math.min(1, (target.y - wobble * 0.5 - g.y) * (0.25 + s * 0.3))),
            };
          }
        }
        stepGlider(g, inputs[i] ?? { x: 0, y: 0 }, dt);
        const plane = view.planes[i];
        if (plane) {
          plane.position.set(g.x, g.y, -view.distance);
          plane.rotation.z = -g.vx * 0.06;
          plane.rotation.x = g.vy * 0.04;
        }
      });
      while (nextRing < rings.length && (rings[nextRing] as Ring).z <= view.distance) {
        const ring = rings[nextRing] as Ring;
        if (ring.z > before) {
          let hit = false;
          gliders.forEach((g, i) => {
            if (flyThrough(g, ring, i) > 0) {
              hit = true;
              if (!session.isCpu(i)) session.send(i, { t: 'buzz', pattern: [25] });
            }
          });
          if (hit) {
            sfx.ring(ring.gold);
            const first = seats[ring.taken[0] ?? 0];
            if (first) view.claim(nextRing, first.color);
          }
        }
        nextRing++;
      }
      if (t - hudAt > 0.2) {
        hudAt = t;
        ui.timer(GLIDER.duration - t);
        ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${gliders[i]?.rings ?? 0} pts` })));
      }
      return t >= GLIDER.duration;
    });
    off();
    ui.timer(null);
    ui.caption(null);
    return { scores: gliders.map((g) => g.rings), details: gliders.map((g) => `${g.rings} ring points`) };
  },
};
