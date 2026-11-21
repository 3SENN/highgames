// The landmark of each island, built from the house shapes: the Snack Shack in the middle, and round the ring a
// lighthouse, an orchard, a crystal spire, a windmill, an observatory and the balloon docks.
// Every builder returns a group whose front faces +z. Things that move are separate children marked `live`
// (they survive baking) and carry a `userData.tick(dt, time)`.
import * as THREE from 'three';
import * as props from '../render/props';
import { PALETTE as P, ball, box, cone, cyl, dome, gem, mix, part, rbox, seeded, sphere, torus } from '../render/toon';
import { bake, live } from './bake';

const roofs = new Map<number, THREE.BufferGeometry>();
/** A four-sided roof over a square of half-side 0.707 (scale it with sx and sz to fit the building). */
function pyramid(h: number): THREE.BufferGeometry {
  let g = roofs.get(h);
  if (!g) {
    g = new THREE.ConeGeometry(1, h, 4).rotateY(Math.PI / 4);
    roofs.set(h, g);
  }
  return g;
}

const NL = { outline: false } as const;
const QUIET = { outline: false, shadow: false } as const;
type Tick = (dt: number, time: number) => void;

function add(g: THREE.Object3D, o: THREE.Object3D, x: number, y: number, z: number, s = 1, ry = 0): THREE.Object3D {
  o.position.set(x, y, z);
  o.scale.multiplyScalar(s);
  o.rotation.y = ry;
  g.add(o);
  return o;
}

/** Bakes a moving piece into a few meshes and marks it to be left alone by the island's own bake. */
function moving(g: THREE.Group, tick: Tick): THREE.Group {
  const baked = live(bake(g));
  baked.userData.tick = tick;
  return baked;
}

/** A warm window: a dark frame with a glowing pane. `ry` turns it to face along x. */
function windowGlow(g: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, ry = 0, glow = 1.3): void {
  const side = Math.abs(Math.sin(ry)) > 0.5;
  part(g, rbox(side ? 0.1 : w + 0.14, h + 0.14, side ? w + 0.14 : 0.1, 0.03), P.walnut, x, y, z, NL);
  const out = 0.04;
  part(g, box(side ? 0.06 : w, h, side ? w : 0.06), P.lamp, x + (side ? Math.sign(Math.sin(ry)) * out : 0), y, z + (side ? 0 : out), { glow, ...QUIET });
}

/** A lantern on a wooden post: the warm dots of light that line the paths at dusk. */
export function lampPost(h = 2.1, color: string = P.lamp): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.06, 0.08, h, 8), P.walnut, 0, h / 2, 0, { tex: 'bark', outline: 0.03 });
  part(g, rbox(0.5, 0.07, 0.07, 0.02), P.walnut, 0.2, h - 0.08, 0, NL);
  part(g, cyl(0.012, 0.012, 0.16, 5), P.ink, 0.4, h - 0.2, 0, QUIET);
  part(g, cone(0.15, 0.1, 6), P.charcoal, 0.4, h - 0.26, 0, NL);
  part(g, cyl(0.1, 0.085, 0.22, 6), color, 0.4, h - 0.42, 0, { glow: 2.2, ...QUIET });
  part(g, cyl(0.1, 0.1, 0.03, 6), P.charcoal, 0.4, h - 0.545, 0, NL);
  return g;
}

/** A hot-air balloon: striped envelope, burner glow, wicker basket. Origin at the bottom of the basket. */
export function balloon(a: string, b: string, r = 1.5): THREE.Group {
  const g = new THREE.Group();
  const cy = r * 2.75;
  part(g, sphere(r * 0.992, 28), a, 0, cy, 0, { sy: 1.12, outline: 0.06, gloss: 0.12 });
  const gores = 12;
  for (let i = 0; i < gores; i += 2) {
    const gore = new THREE.SphereGeometry(r, 5, 18, (i / gores) * Math.PI * 2, (Math.PI * 2) / gores);
    part(g, gore, b, 0, cy, 0, { sy: 1.12, outline: false, gloss: 0.12 });
  }
  part(g, cone(r * 0.62, r * 0.75, 20), a, 0, cy - r * 1.2, 0, { rx: Math.PI, outline: 0.05 });
  part(g, torus(r * 0.36, 0.05), P.walnut, 0, cy - r * 1.56, 0, { rx: Math.PI / 2, ...NL });
  part(g, cyl(r * 0.1, r * 0.1, 0.05, 12), P.walnut, 0, cy + r * 1.12, 0, NL);
  part(g, sphere(r * 0.14, 10), P.ember, 0, cy - r * 1.62, 0, { glow: 2.4, ...QUIET });
  const bw = r * 0.62;
  part(g, rbox(bw, bw * 0.72, bw, 0.08), P.oak, 0, bw * 0.36, 0, { tex: 'planks', texScale: 0.6, outline: 0.05 });
  part(g, rbox(bw + 0.1, 0.1, bw + 0.1, 0.04), P.walnut, 0, bw * 0.72, 0, NL);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    part(g, cyl(0.016, 0.016, cy - r * 1.56 - bw * 0.7, 5), P.linen, x * bw * 0.44, (cy - r * 1.56 + bw * 0.7) / 2, z * bw * 0.44, { rz: -x * 0.07, rx: z * 0.07, ...QUIET });
    part(g, ball(0.1, 1), P.linen, x * bw * 0.56, bw * 0.4, z * bw * 0.3, NL);
  }
  return g;
}

// ------------------------------------------------------------------ Snack Shack

/** The Snack Shack: a cosy food stall with a striped awning, a glowing counter, stools and a sign on the roof. */
export function snackShack(): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(4.7, 0.2, 3.5, 0.06), P.stone, 0, 0.1, 0.1, { tex: 'stoneTiles', outline: 0.05 });
  // walls with a timber skirt
  part(g, rbox(4.0, 2.2, 2.8, 0.08), P.cream, 0, 1.3, 0, { tex: 'plaster' });
  part(g, rbox(4.08, 0.72, 2.88, 0.06), P.walnut, 0, 0.56, 0, { tex: 'planks', outline: false });
  for (const x of [-2.0, 2.0]) part(g, rbox(0.16, 2.24, 0.16, 0.04), P.walnut, x, 1.3, 1.4, { tex: 'planks', ...NL });
  // the serving hatch: a warm glowing kitchen behind dark shelves
  part(g, rbox(2.9, 1.14, 0.12, 0.04), P.espresso, 0, 1.68, 1.37, NL);
  part(g, box(2.7, 0.96, 0.06), '#ffc27a', 0, 1.68, 1.42, { glow: 0.95, ...QUIET });
  part(g, box(2.7, 0.05, 0.1), P.espresso, 0, 1.86, 1.47, QUIET);
  const shelf = seeded(4);
  for (let i = 0; i < 9; i++) {
    const x = -1.15 + i * 0.29;
    const h = 0.16 + shelf() * 0.16;
    part(g, cyl(0.055, 0.065, h, 8), [P.espresso, P.mahogany, P.forest][i % 3] as string, x, 1.89 + h / 2, 1.48, QUIET);
  }
  // the counter with snacks on it
  part(g, rbox(3.2, 0.14, 0.75, 0.05), P.oak, 0, 1.12, 1.66, { tex: 'wood', gloss: 0.2 });
  for (const x of [-1.45, 1.45]) part(g, rbox(0.12, 0.5, 0.12, 0.03), P.walnut, x, 0.86, 1.86, NL);
  add(g, props.snackBowl({ fill: 'popcorn', color: P.teal }), -0.95, 1.19, 1.72, 1.9);
  add(g, props.snackBowl({ fill: 'fruit', color: P.mustard, seed: 5 }), 1.0, 1.19, 1.7, 1.7);
  add(g, props.drink({ kind: 'bottle', color: P.forest }), 0.2, 1.19, 1.8, 2.2);
  add(g, props.drink({ kind: 'can', color: P.terracotta }), -0.15, 1.19, 1.7, 2.2);
  add(g, props.pizzaBox({ open: false, size: 0.5 }), 0.52, 1.19, 1.62, 1.2, 0.3);
  // the awning: terracotta and cream stripes with a little valance
  const awn = new THREE.Group();
  awn.position.set(0, 2.62, 1.4);
  awn.rotation.x = 0.36;
  for (let i = 0; i < 8; i++) {
    const c = i % 2 ? P.cream : P.terracotta;
    const x = -1.61 + i * 0.46;
    part(awn, box(0.46, 0.06, 1.5), c, x, 0, 0.72, { tex: 'fabric', texStrength: 0.5, outline: i === 0 || i === 7 ? 0.04 : false });
    part(awn, rbox(0.46, 0.26, 0.05, 0.02), c, x, -0.13, 1.47, { tex: 'fabric', texStrength: 0.5, ...NL });
  }
  g.add(awn);
  for (const x of [-1.7, 1.7]) part(g, cyl(0.04, 0.04, 2.0, 8), P.walnut, x, 1.1, 2.72, NL);
  // roof, eaves, chimney
  part(g, rbox(4.5, 0.16, 3.3, 0.05), P.walnut, 0, 2.48, 0, { tex: 'planks' });
  const roof = mix(P.teal, P.slate, 0.35);
  part(g, pyramid(1.45), roof, 0, 3.28, 0, { sx: 3.3, sz: 2.45, tex: 'roofTiles', texScale: 1.3 });
  part(g, rbox(0.5, 1.2, 0.5, 0.04), P.brick, 1.25, 3.3, -0.55, { tex: 'brick', texScale: 1.2 });
  part(g, rbox(0.62, 0.12, 0.62, 0.03), P.stone, 1.25, 3.94, -0.55, NL);
  // the sign on the roof
  part(g, rbox(3.0, 0.86, 0.14, 0.05), P.espresso, 0, 3.22, 1.32, { rx: -0.14, tex: 'darkWood', texStrength: 0.5 });
  for (const x of [-1.2, 1.2]) part(g, cyl(0.04, 0.04, 0.7, 6), P.walnut, x, 2.9, 1.1, { rx: -0.5, ...NL });
  const sign = props.neonSign('Snack Shack', { color: '#ffae4a', h: 0.66 });
  sign.position.set(0, 3.23, 1.41);
  sign.rotation.x = -0.14;
  g.add(sign);
  // side windows, a back door
  windowGlow(g, -2.02, 1.7, -0.2, 0.9, 0.8, -Math.PI / 2);
  windowGlow(g, 2.02, 1.7, -0.2, 0.9, 0.8, Math.PI / 2);
  part(g, rbox(0.8, 1.5, 0.1, 0.04), P.mahogany, -0.9, 0.95, -1.42, { tex: 'planks', ...NL });
  // stools, a menu board, plants and stock round the back
  for (const x of [-1.05, 0, 1.05]) add(g, props.stool({ seat: x === 0 ? P.mustard : P.terracotta }), x, 0.2, 2.62, 1.75);
  const menu = new THREE.Group();
  part(menu, rbox(0.7, 1.0, 0.08, 0.03), P.walnut, 0, 0.5, 0.12, { rx: -0.2 });
  part(menu, box(0.56, 0.8, 0.02), P.charcoal, 0, 0.52, 0.175, { rx: -0.2, ...QUIET });
  for (let i = 0; i < 4; i++) part(menu, box(0.3 + (i % 2) * 0.1, 0.035, 0.01), P.cream, -0.05 + (i % 2) * 0.04, 0.78 - i * 0.14, 0.14 + i * 0.028, { rx: -0.2, ...QUIET });
  part(menu, rbox(0.7, 1.0, 0.06, 0.03), P.walnut, 0, 0.5, -0.14, { rx: 0.2, ...NL });
  add(g, menu, 2.0, 0.2, 2.75, 1, -0.35);
  add(g, props.plant({ kind: 'ficus', h: 1.3, pot: P.terracotta }), -2.05, 0.2, 2.2, 1.35);
  add(g, props.plant({ kind: 'monstera', h: 0.8, pot: P.ceramic }), 2.05, 0.2, 1.75, 1.5);
  add(g, props.crate({ s: 0.6 }), 0.5, 0.0, -1.95, 1.2, 0.2);
  add(g, props.crate({ s: 0.5 }), 1.25, 0.0, -1.9, 1.2, -0.3);
  add(g, props.crate({ s: 0.5, color: P.oak }), 0.55, 0.72, -1.95, 1.1, 0.5);
  part(g, cyl(0.36, 0.33, 0.9, 14), P.mahogany, -1.9, 0.45, -1.9, { tex: 'planks', texScale: 0.8 });
  for (const y of [0.2, 0.7]) part(g, torus(0.37, 0.025), P.charcoal, -1.9, y, -1.9, { rx: Math.PI / 2, ...NL });

  // smoke from the chimney: three puffs that rise, swell and fade
  const smoke = new THREE.Group();
  const puffs = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(sphere(0.2, 12), new THREE.MeshBasicMaterial({ color: '#d9c8d8', transparent: true, opacity: 0.4, depthWrite: false }));
    m.userData.phase = i / 3;
    smoke.add(m);
    return m;
  });
  smoke.position.set(1.25, 4.05, -0.55);
  smoke.userData.tick = ((_dt, time) => {
    for (const p of puffs) {
      const k = (time * 0.22 + (p.userData.phase as number)) % 1;
      p.position.set(Math.sin(k * 5 + (p.userData.phase as number) * 9) * 0.18 + k * 0.5, k * 2.0, 0);
      p.scale.setScalar(0.7 + k * 1.9);
      (p.material as THREE.MeshBasicMaterial).opacity = 0.42 * Math.sin(k * Math.PI);
    }
  }) satisfies Tick;
  g.add(live(smoke));

  // the one real lamp of the board: the light that spills out of the hatch
  const light = new THREE.PointLight('#ffb866', 16, 15, 1.5);
  light.position.set(0, 2.0, 3.0);
  g.add(light);
  return g;
}

// ------------------------------------------------------------------ Lighthouse Rock

export function lighthouse(): THREE.Group {
  const g = new THREE.Group();
  const rockC = mix(P.stone, P.slate, 0.35);
  part(g, ball(2.0, 1), rockC, 0, 0.05, 0, { sy: 0.36, tex: 'rock' });
  part(g, ball(1.1, 0), rockC, -1.7, 0.1, 0.7, { sy: 0.5, tex: 'rock', ry: 1 });
  part(g, ball(0.8, 0), mix(rockC, P.ink, 0.1), 1.9, 0.1, 1.0, { sy: 0.55, tex: 'rock', ry: 2 });
  // the tower: a stone foot, a cream shaft with two blue bands
  part(g, cyl(1.02, 1.2, 0.8, 24), P.stone, 0, 0.95, 0, { tex: 'cobble', texScale: 1.4 });
  const r = (y: number) => 0.98 - 0.34 * (y / 4.2);
  part(g, cyl(r(4.2), r(0), 4.2, 28), P.cream, 0, 3.45, 0, { tex: 'plaster' });
  for (const y of [1.25, 2.95]) part(g, cyl(r(y + 0.4) + 0.012, r(y - 0.4) + 0.012, 0.8, 28), P.denim, 0, 1.35 + y, 0, { outline: false, tex: 'plaster', texStrength: 0.5 });
  part(g, rbox(0.56, 0.95, 0.14, 0.05), P.mahogany, 0, 1.75, 1.0, { tex: 'planks' });
  part(g, rbox(0.9, 0.16, 0.5, 0.04), P.stone, 0, 1.3, 1.15, NL);
  part(g, rbox(1.2, 0.16, 0.5, 0.04), P.stone, 0, 1.14, 1.4, NL);
  for (const [y, a] of [[3.3, 0.5], [4.5, -0.6]] as const) {
    const rr = r(y - 1.35) + 0.01;
    part(g, sphere(0.14, 10), P.lamp, Math.sin(a) * rr, y, Math.cos(a) * rr, { sx: 1, sy: 1.5, sz: 0.4, ry: a, glow: 1.4, ...QUIET });
  }
  // gallery, lamp room, cap
  part(g, cyl(1.02, 0.8, 0.16, 24), P.slate, 0, 5.63, 0, {});
  part(g, torus(0.96, 0.03), P.charcoal, 0, 6.06, 0, { rx: Math.PI / 2, ...NL });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    part(g, cyl(0.022, 0.022, 0.38, 5), P.charcoal, Math.cos(a) * 0.96, 5.88, Math.sin(a) * 0.96, QUIET);
  }
  part(g, cyl(0.5, 0.5, 0.8, 16), P.lamp, 0, 6.1, 0, { glow: 1.9, ...QUIET });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    part(g, cyl(0.03, 0.03, 0.82, 5), P.charcoal, Math.cos(a) * 0.52, 6.1, Math.sin(a) * 0.52, QUIET);
  }
  part(g, cyl(0.62, 0.62, 0.08, 16), P.slate, 0, 6.54, 0, NL);
  part(g, cone(0.72, 0.8, 16), mix(P.denim, P.slate, 0.4), 0, 6.96, 0, { gloss: 0.25 });
  part(g, sphere(0.1, 10), P.brass, 0, 7.42, 0, { gloss: 0.6, ...NL });
  // the turning beam
  const pivot = new THREE.Group();
  pivot.position.y = 6.1;
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe9b0'), transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  for (const s of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 11, 20, 1, true), beamMat);
    beam.rotation.z = (s * Math.PI) / 2;
    beam.position.x = s * 5.7;
    beam.rotation.y = 0;
    beam.castShadow = false;
    pivot.add(beam);
  }
  pivot.rotation.z = 0.05;
  pivot.userData.tick = ((dt) => {
    pivot.rotation.y += dt * 0.55;
  }) satisfies Tick;
  g.add(live(pivot));
  // the keeper's cottage
  part(g, rbox(1.9, 1.15, 1.5, 0.06), P.cream, 2.05, 0.75, -0.3, { tex: 'plaster' });
  part(g, pyramid(0.85), P.roof, 2.05, 1.74, -0.3, { sx: 1.6, sz: 1.3, tex: 'roofTiles', texScale: 1.2 });
  windowGlow(g, 2.05, 0.82, 0.46, 0.55, 0.45);
  part(g, rbox(0.3, 0.6, 0.3, 0.03), P.brick, 2.6, 1.9, -0.6, { tex: 'brick' });
  // sea pines and boulders
  add(g, props.tree({ kind: 'pine', h: 3.4, seed: 2 }), -2.6, 0, -0.9);
  add(g, props.tree({ kind: 'pine', h: 2.6, seed: 5 }), -3.5, 0, 0.5);
  add(g, props.tree({ kind: 'pine', h: 3.0, seed: 8 }), 3.9, 0, 0.2);
  add(g, props.rock({ r: 0.55, seed: 3, color: rockC }), 3.2, 0, 1.4);
  add(g, props.rock({ r: 0.4, seed: 6, color: rockC }), -3.0, 0, 1.6);
  return g;
}

// ------------------------------------------------------------------ Windmill Isle

export function windmill(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(1.08, 1.3, 1.4, 12), P.stone, 0, 0.7, 0, { tex: 'cobble', texScale: 1.5 });
  part(g, cyl(1.5, 1.5, 0.12, 12), P.walnut, 0, 1.45, 0, { tex: 'planks' });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    part(g, cyl(0.03, 0.03, 0.42, 5), P.walnut, Math.cos(a) * 1.42, 1.7, Math.sin(a) * 1.42, QUIET);
  }
  part(g, torus(1.42, 0.035), P.walnut, 0, 1.92, 0, { rx: Math.PI / 2, ...NL });
  part(g, cyl(0.74, 1.04, 2.7, 12), P.cream, 0, 2.86, 0, { tex: 'plaster' });
  part(g, torus(0.8, 0.07), P.walnut, 0, 4.12, 0, { rx: Math.PI / 2, ...NL });
  part(g, cone(0.98, 1.05, 12), P.roof, 0, 4.72, 0, { tex: 'roofTiles', texScale: 1.2 });
  part(g, sphere(0.09, 8), P.brass, 0, 5.28, 0, { gloss: 0.6, ...NL });
  part(g, rbox(0.62, 1.05, 0.14, 0.05), P.mahogany, 0, 0.55, 1.2, { tex: 'planks' });
  part(g, cyl(0.08, 0.07, 0.16, 6), P.lamp, 0.55, 1.05, 1.22, { glow: 2, ...QUIET });
  part(g, sphere(0.2, 12), P.lamp, 0, 2.55, 0.94, { sy: 1.4, sz: 0.3, glow: 1.4, ...QUIET });
  part(g, sphere(0.16, 12), P.lamp, 0.78, 3.3, 0.3, { sy: 1.4, sx: 0.3, glow: 1.2, ...QUIET });
  // the sails
  const sails = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    part(arm, rbox(0.1, 3.0, 0.08, 0.02), P.walnut, 0, 1.55, 0, {});
    part(arm, box(0.66, 2.15, 0.04), P.linen, 0.38, 1.85, 0.02, { tex: 'fabric', texStrength: 0.6, outline: 0.04 });
    for (let k = 0; k < 4; k++) part(arm, box(0.7, 0.045, 0.06), P.walnut, 0.38, 0.95 + k * 0.6, 0.03, QUIET);
    part(arm, box(0.045, 2.15, 0.06), P.walnut, 0.72, 1.85, 0.03, QUIET);
    sails.add(arm);
  }
  part(sails, sphere(0.22, 12), P.walnut, 0, 0, 0.06, {});
  part(sails, cyl(0.1, 0.1, 0.5, 8), P.walnut, 0, 0, -0.25, { rx: Math.PI / 2, ...NL });
  const turning = moving(sails, (dt) => {
    turning.rotation.z -= dt * 0.7;
  });
  turning.position.set(0, 3.75, 1.12);
  turning.rotation.x = -0.1;
  g.add(turning);
  // a wheat field, hay bales and sacks
  const rand = seeded(21);
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < 4; k++) {
      add(g, props.tuft({ color: i % 2 ? P.mustard : mix(P.mustard, P.olive, 0.35), s: 3.4, seed: i * 7 + k }), 2.3 + i * 0.62 + rand() * 0.15, 0, -1.2 + k * 0.62 + rand() * 0.15);
    }
  }
  for (const [x, z, ry] of [[-2.4, 0.9, 0.3], [-3.3, 0.2, 1.2], [-2.7, -0.8, -0.4]] as const) {
    part(g, cyl(0.5, 0.5, 0.75, 16), P.mustard, x, 0.5, z, { rx: Math.PI / 2, ry, tex: 'knit', texScale: 0.7, outline: 0.04 });
  }
  part(g, cyl(0.5, 0.5, 0.75, 16), mix(P.mustard, P.sand, 0.3), -2.8, 1.3, 0.1, { rx: Math.PI / 2, ry: 0.7, tex: 'knit', texScale: 0.7, outline: 0.04 });
  for (const [x, z] of [[1.6, 1.3], [1.95, 0.9]] as const) part(g, ball(0.34, 1), P.linen, x, 0.28, z, { sy: 0.85, tex: 'fabric' });
  add(g, props.fence({ w: 3.2, h: 0.9, color: P.oak }), 3.6, 0, -1.9, 1.1);
  add(g, props.tree({ kind: 'round', h: 3.4, seed: 4 }), -4.3, 0, -1.2);
  add(g, props.tree({ kind: 'birch', h: 3.2, seed: 9 }), 5.3, 0, 0.9);
  return g;
}

// ------------------------------------------------------------------ Orchard Drift

function appleTree(seed: number, h = 3.2): THREE.Group {
  const g = new THREE.Group();
  const rand = seeded(seed);
  part(g, cyl(h * 0.045, h * 0.07, h * 0.42, 8), P.soilDark, 0, h * 0.21, 0, { tex: 'bark' });
  part(g, cyl(h * 0.025, h * 0.035, h * 0.3, 6), P.soilDark, h * 0.08, h * 0.45, 0, { rz: -0.7, tex: 'bark', ...NL });
  const blobs: [number, number, number, number][] = [[0, h * 0.7, 0, h * 0.3]];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rand();
    blobs.push([Math.cos(a) * h * 0.2, h * (0.55 + rand() * 0.14), Math.sin(a) * h * 0.2, h * (0.19 + rand() * 0.05)]);
  }
  blobs.forEach(([x, y, z, r], i) => part(g, ball(r, 2), mix(P.leaf, i % 2 ? P.leafDark : P.moss, 0.2 + rand() * 0.3), x, y, z, { outline: 0.05 }));
  for (let i = 0; i < 11; i++) {
    const [x, y, z, r] = blobs[i % blobs.length] as [number, number, number, number];
    const a = rand() * Math.PI * 2;
    const up = (rand() - 0.35) * 1.1;
    const c = Math.cos(up);
    part(g, sphere(h * 0.04, 8), i % 4 === 0 ? '#d9a441' : '#c8413a', x + Math.cos(a) * c * r, y + Math.sin(up) * r, z + Math.sin(a) * c * r, { gloss: 0.4, exact: true, ...NL });
  }
  return g;
}

export function orchard(): THREE.Group {
  const g = new THREE.Group();
  const spots: [number, number, number][] = [
    [-5.4, 0.2, 3.3],
    [-2.9, -0.9, 3.0],
    [-0.4, 0.1, 3.5],
    [2.3, -0.8, 3.1],
    [5.0, 0.3, 3.4],
    [-4.2, -2.3, 2.7],
    [1.0, -2.5, 2.9],
    [3.9, -2.4, 2.6],
  ];
  spots.forEach(([x, z, h], i) => add(g, appleTree(30 + i, h), x, 0, z, 1, i * 1.3));
  // an apple cart
  const cart = new THREE.Group();
  part(cart, rbox(1.5, 0.5, 0.95, 0.05), P.oak, 0, 0.75, 0, { tex: 'planks', texScale: 0.8 });
  for (const z of [-0.52, 0.52]) {
    part(cart, torus(0.4, 0.06), P.walnut, 0.1, 0.42, z, {});
    for (let k = 0; k < 4; k++) part(cart, box(0.74, 0.04, 0.04), P.walnut, 0.1, 0.42, z, { rz: (k * Math.PI) / 4, ...QUIET });
  }
  for (const z of [-0.36, 0.36]) part(cart, rbox(1.1, 0.06, 0.07, 0.02), P.walnut, -1.15, 0.72, z, { rz: 0.16, ...NL });
  part(cart, cyl(0.04, 0.04, 0.5, 6), P.walnut, -0.6, 0.25, 0, NL);
  const pile = seeded(8);
  for (let i = 0; i < 22; i++) part(cart, sphere(0.13, 8), i % 5 === 0 ? '#d9a441' : '#c8413a', (pile() - 0.5) * 1.2, 1.0 + pile() * 0.18, (pile() - 0.5) * 0.7, { gloss: 0.4, exact: true, ...NL });
  add(g, cart, 1.3, 0, 1.2, 1, 0.5);
  // crates of apples, a ladder, baskets
  for (const [x, z, ry] of [[-1.5, 1.4, 0.2], [-2.3, 1.0, -0.4]] as const) {
    const c = props.crate({ s: 0.6 });
    for (let i = 0; i < 7; i++) part(c, sphere(0.1, 8), '#c8413a', (pile() - 0.5) * 0.4, 0.62 + pile() * 0.05, (pile() - 0.5) * 0.4, { gloss: 0.4, exact: true, ...NL });
    add(g, c, x, 0, z, 1.15, ry);
  }
  const ladder = new THREE.Group();
  for (const x of [-0.22, 0.22]) part(ladder, rbox(0.06, 2.5, 0.06, 0.02), P.oak, x, 1.25, 0, NL);
  for (let i = 0; i < 6; i++) part(ladder, rbox(0.5, 0.05, 0.05, 0.02), P.oak, 0, 0.3 + i * 0.4, 0, QUIET);
  ladder.rotation.x = -0.32;
  add(g, ladder, -0.4, 0, 1.0);
  for (let i = 0; i < 9; i++) part(g, sphere(0.11, 8), '#c8413a', -5 + pile() * 10, 0.1, -1.5 + pile() * 2.6, { gloss: 0.4, exact: true, ...QUIET });
  add(g, props.fence({ w: 4, h: 0.85, color: P.cream }), -3.4, 0, -3.3, 1.1, 0.12);
  add(g, props.fence({ w: 4, h: 0.85, color: P.cream }), 2.6, 0, -3.4, 1.1, -0.1);
  return g;
}

// ------------------------------------------------------------------ Crystal Spire

const AMETHYST = '#8f63e6';
const LILAC = '#c7a8ff';
const ICE = '#86d9ea';

/** One crystal shard, `h` tall, leaning by (`rx`, `rz`). */
export function shard(g: THREE.Object3D, x: number, z: number, h: number, r: number, color: string, glow: number, rx = 0, rz = 0): void {
  const holder = new THREE.Group();
  holder.position.set(x, 0, z);
  holder.rotation.set(rx, x * 2.1 + z, rz);
  part(holder, gem(r), color, 0, h * 0.42, 0, { sy: h / (2 * r), glow, gloss: 0.7, exact: true, outline: glow < 1 ? 0.045 : false, shadow: glow < 1 });
  g.add(holder);
}

export function crystal(): THREE.Group {
  const g = new THREE.Group();
  const rockC = mix(P.slate, P.plum, 0.35);
  part(g, ball(2.3, 1), rockC, 0, 0, 0, { sy: 0.34, tex: 'rock' });
  part(g, ball(1.2, 0), mix(rockC, P.ink, 0.12), -1.9, 0.1, 0.8, { sy: 0.5, tex: 'rock', ry: 1.3 });
  part(g, ball(1.0, 0), rockC, 2.0, 0.1, 0.5, { sy: 0.5, tex: 'rock', ry: 0.4 });
  shard(g, 0, -0.1, 5.6, 0.95, AMETHYST, 0.5);
  shard(g, 1.2, 0.3, 3.5, 0.62, LILAC, 0.75, 0.1, -0.42);
  shard(g, -1.15, 0.2, 3.9, 0.66, AMETHYST, 0.55, 0.05, 0.4);
  shard(g, 0.45, -1.0, 3.0, 0.55, ICE, 0.7, -0.4, -0.1);
  shard(g, -0.5, 0.95, 2.2, 0.5, LILAC, 0.9, 0.5, 0.15);
  shard(g, 0.75, 0.95, 1.7, 0.42, AMETHYST, 0.6, 0.45, -0.3);
  shard(g, -2.0, 0.75, 1.5, 0.34, ICE, 0.8, 0.2, 0.55);
  shard(g, 2.1, 0.55, 1.3, 0.3, LILAC, 1.5, 0.15, -0.6);
  shard(g, -0.1, 1.5, 0.9, 0.24, '#e6d6ff', 1.8, 0.6, 0);
  shard(g, 1.5, 1.35, 0.7, 0.2, '#e6d6ff', 1.8, 0.5, -0.4);
  shard(g, -1.5, 1.4, 0.8, 0.22, ICE, 1.6, 0.5, 0.4);
  // shards that hang in the air above the spire, turning slowly
  const rand = seeded(13);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Group();
    part(s, gem(0.2 + rand() * 0.14), i % 2 ? LILAC : ICE, 0, 0, 0, { sy: 1.9, glow: 1.3, exact: true, ...QUIET });
    const a = (i / 5) * Math.PI * 2;
    const base = new THREE.Vector3(Math.cos(a) * (1.5 + rand() * 0.8), 3.4 + rand() * 2.2, Math.sin(a) * (1.1 + rand() * 0.5));
    s.position.copy(base);
    s.userData.tick = ((dt, time) => {
      s.position.y = base.y + Math.sin(time * 0.7 + i * 1.7) * 0.25;
      s.rotation.y += dt * (0.4 + i * 0.1);
    }) satisfies Tick;
    g.add(live(s));
  }
  add(g, props.tree({ kind: 'pine', h: 2.8, seed: 3, color: mix(P.pine, P.plum, 0.25) }), -3.6, 0, -0.6);
  add(g, props.tree({ kind: 'pine', h: 3.3, seed: 7, color: mix(P.pine, P.plum, 0.25) }), 3.7, 0, -0.8);
  const light = new THREE.PointLight('#a987ff', 20, 12, 1.5);
  light.position.set(0, 1.6, 2.2);
  g.add(light);
  return g;
}

// ------------------------------------------------------------------ Old Observatory

export function observatory(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(1.85, 1.95, 0.3, 28), P.stone, 0, 0.15, 0, { tex: 'stoneTiles' });
  part(g, cyl(1.5, 1.56, 1.8, 28), P.cream, 0, 1.2, 0, { tex: 'plaster' });
  part(g, cyl(1.58, 1.6, 0.5, 28), P.stone, 0, 0.55, 0, { tex: 'cobble', texScale: 1.3, ...NL });
  part(g, torus(1.54, 0.08), P.brass, 0, 2.1, 0, { rx: Math.PI / 2, gloss: 0.6, ...NL });
  const domeC = '#3f7f86';
  part(g, dome(1.52), domeC, 0, 2.1, 0, { gloss: 0.4 });
  for (let i = 0; i < 6; i++) part(g, torus(1.53, 0.022, Math.PI), mix(domeC, P.ink, 0.3), 0, 2.1, 0, { ry: (i / 6) * Math.PI, ...QUIET });
  // the slit and the telescope looking out of it
  const slit = new THREE.Group();
  slit.position.y = 2.1;
  slit.rotation.x = 0.75;
  part(slit, rbox(0.62, 1.3, 0.2, 0.04), P.midnight, 0, 1.44, 0, { ...QUIET });
  part(slit, cyl(0.22, 0.28, 1.9, 16), P.brass, 0, 1.75, 0, { gloss: 0.65 });
  part(slit, cyl(0.3, 0.3, 0.14, 16), mix(P.brass, P.ink, 0.2), 0, 2.72, 0, { gloss: 0.65, ...NL });
  part(slit, sphere(0.2, 12), P.screen, 0, 2.78, 0, { sy: 0.3, glow: 1.1, ...QUIET });
  g.add(slit);
  part(g, rbox(0.66, 1.1, 0.14, 0.05), P.mahogany, 0, 0.85, 1.52, { tex: 'planks' });
  part(g, rbox(1.1, 0.15, 0.5, 0.04), P.stone, 0, 0.22, 1.75, NL);
  part(g, cyl(0.07, 0.06, 0.15, 6), P.lamp, 0.55, 1.35, 1.5, { glow: 2, ...QUIET });
  for (const a of [-1.05, 1.05, 2.3]) part(g, sphere(0.2, 12), P.lamp, Math.sin(a) * 1.52, 1.45, Math.cos(a) * 1.52, { sy: 1.5, sz: 0.3, ry: a, glow: 1.3, ...QUIET });
  // a flat-roofed annex with a dish
  part(g, rbox(1.5, 1.2, 1.4, 0.06), P.cream, -2.2, 0.6, -0.3, { tex: 'plaster' });
  part(g, rbox(1.66, 0.14, 1.56, 0.04), P.stone, -2.2, 1.26, -0.3, NL);
  windowGlow(g, -2.2, 0.72, 0.42, 0.6, 0.45);
  part(g, cyl(0.03, 0.03, 0.7, 6), P.metal, -2.4, 1.65, -0.5, NL);
  part(g, cone(0.42, 0.22, 16), P.ceramic, -2.4, 2.02, -0.42, { rx: -2.3, gloss: 0.3 });
  // the orrery: brass rings turning round a little sun
  part(g, cyl(0.3, 0.42, 0.7, 12), P.stone, 2.6, 0.35, 0.7, { tex: 'cobble', texScale: 1 });
  const orrery = new THREE.Group();
  orrery.position.set(2.6, 1.75, 0.7);
  part(orrery, sphere(0.22, 14), P.lamp, 0, 0, 0, { glow: 2.2, ...QUIET });
  const rings = [0.5, 0.72, 0.95].map((rr, i) => {
    const ring = new THREE.Group();
    part(ring, torus(rr, 0.028), P.brass, 0, 0, 0, { gloss: 0.65, ...NL });
    part(ring, sphere(0.085 + i * 0.015, 10), [P.terracotta, P.screen, P.mauve][i] as string, rr, 0, 0, { gloss: 0.4, glow: 0.3, ...NL });
    ring.rotation.x = 1.2 + i * 0.5;
    orrery.add(ring);
    return ring;
  });
  orrery.userData.tick = ((dt) => {
    rings.forEach((ring, i) => {
      ring.rotation.z += dt * (0.9 - i * 0.25);
      ring.rotation.x += dt * 0.12 * (i + 1);
    });
  }) satisfies Tick;
  g.add(live(orrery));
  part(g, cyl(0.03, 0.03, 0.75, 6), P.brass, 2.6, 1.05, 0.7, NL);
  add(g, props.tree({ kind: 'pine', h: 3.4, seed: 6 }), 3.9, 0, -0.9);
  add(g, props.tree({ kind: 'pine', h: 2.7, seed: 2 }), -4.0, 0, 0.4);
  add(g, props.rock({ r: 0.5, seed: 4 }), 3.6, 0, 1.3);
  return g;
}

// ------------------------------------------------------------------ Balloon Docks

/** A balloon that bobs on its mooring. */
export function mooredBalloon(a: string, b: string, r: number, phase: number): THREE.Group {
  const m = moving(balloon(a, b, r), (_dt, time) => {
    m.position.y = (m.userData.baseY as number) + Math.sin(time * 0.7 + phase) * 0.22;
    m.rotation.y = Math.sin(time * 0.23 + phase) * 0.35;
    m.rotation.z = Math.sin(time * 0.5 + phase) * 0.025;
  });
  return m;
}

/** The pier, ticket booth and windsock of the docks (the balloons are placed by the world). */
export function docksPier(): THREE.Group {
  const g = new THREE.Group();
  // the jetty that sticks out over the edge
  part(g, rbox(2.4, 0.16, 3.6, 0.04), P.oak, 0, 0.1, 1.2, { tex: 'planks', texScale: 1.2, outline: 0.05 });
  for (const [x, z] of [[-1.1, 2.8], [1.1, 2.8], [-1.1, 0.9], [1.1, 0.9]] as const) part(g, cyl(0.1, 0.1, 2.0, 8), P.walnut, x, -0.75, z, { tex: 'bark', outline: 0.03 });
  for (const x of [-1.1, 1.1]) {
    part(g, cyl(0.08, 0.09, 0.9, 8), P.walnut, x, 0.6, 2.85, NL);
    part(g, sphere(0.11, 8), P.walnut, x, 1.08, 2.85, NL);
  }
  part(g, cyl(0.02, 0.02, 2.2, 5), P.linen, 0, 0.85, 2.85, { rz: Math.PI / 2, ...QUIET });
  add(g, props.crate({ s: 0.6 }), -0.7, 0.18, 0.4, 1.1, 0.3);
  add(g, props.crate({ s: 0.5, color: P.oak }), -0.65, 0.84, 0.4, 1.05, -0.2);
  part(g, cyl(0.32, 0.3, 0.8, 14), P.mahogany, 0.75, 0.58, 0.2, { tex: 'planks', texScale: 0.8 });
  add(g, lampPost(2.2), -1.05, 0.18, 2.0, 1, Math.PI / 2);
  return g;
}

export function ticketBooth(): THREE.Group {
  const g = new THREE.Group();
  part(g, rbox(1.5, 1.7, 1.2, 0.06), P.cream, 0, 0.85, 0, { tex: 'plaster' });
  part(g, rbox(1.56, 0.6, 1.26, 0.05), P.denim, 0, 0.3, 0, { tex: 'planks', ...NL });
  part(g, box(1.0, 0.55, 0.06), P.lamp, 0, 1.2, 0.6, { glow: 1.2, ...QUIET });
  part(g, rbox(1.2, 0.08, 0.3, 0.02), P.oak, 0, 0.88, 0.7, NL);
  for (let i = 0; i < 4; i++) part(g, box(0.42, 0.06, 0.8), i % 2 ? P.cream : P.terracotta, -0.63 + i * 0.42, 1.82, 0.5, { rx: 0.3, tex: 'fabric', texStrength: 0.5, outline: i === 0 || i === 3 ? 0.04 : false });
  part(g, pyramid(0.6), mix(P.teal, P.slate, 0.35), 0, 2.02, -0.05, { sx: 1.25, sz: 1.05, tex: 'roofTiles', texScale: 1.2 });
  return g;
}

/** A striped windsock on a pole, swinging in the breeze. */
export function windsock(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.05, 0.07, 2.9, 8), P.ceramic, 0, 1.45, 0, { outline: 0.03 });
  const sock = new THREE.Group();
  for (let i = 0; i < 4; i++) part(sock, cyl(0.2 - i * 0.035, 0.2 - (i + 1) * 0.035, 0.34, 12), i % 2 ? P.cream : P.terracotta, 0.2 + i * 0.34, 0, 0, { rz: Math.PI / 2, ...NL });
  const swing = moving(sock, (_dt, time) => {
    swing.rotation.y = Math.sin(time * 0.9) * 0.35 + Math.sin(time * 2.3) * 0.08;
    swing.rotation.z = -0.18 + Math.sin(time * 1.7) * 0.07;
  });
  swing.position.set(0, 2.75, 0);
  g.add(swing);
  return g;
}

/** A signpost with a few arrows pointing to the islands. */
export function signpost(colors: string[]): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl(0.06, 0.08, 2.0, 8), P.walnut, 0, 1.0, 0, { tex: 'bark', outline: 0.03 });
  colors.forEach((c, i) => {
    const arrow = new THREE.Group();
    part(arrow, rbox(0.8, 0.22, 0.06, 0.02), mix(c, P.cream, 0.25), 0.3, 0, 0, NL);
    part(arrow, cone(0.16, 0.2, 3), mix(c, P.cream, 0.25), 0.78, 0, 0, { rz: -Math.PI / 2, sz: 0.25, ...NL });
    arrow.position.y = 1.85 - i * 0.3;
    arrow.rotation.y = i * 2.1 + 0.4;
    g.add(arrow);
  });
  return g;
}

// ------------------------------------------------------------------ small things

/** A little delivery scooter parked behind the shack. */
export function scooter(color: string = P.terracotta): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-0.55, 0.55]) {
    part(g, torus(0.2, 0.08), P.charcoal, x, 0.28, 0, {});
    part(g, cyl(0.1, 0.1, 0.1, 10), P.metal, x, 0.28, 0, { rx: Math.PI / 2, ...NL });
  }
  part(g, rbox(0.9, 0.12, 0.34, 0.05), color, 0, 0.36, 0, { gloss: 0.4 });
  part(g, rbox(0.5, 0.4, 0.36, 0.1), color, -0.35, 0.62, 0, { gloss: 0.4 });
  part(g, rbox(0.46, 0.1, 0.32, 0.04), P.espresso, -0.3, 0.86, 0, { tex: 'leather', ...NL });
  part(g, rbox(0.14, 0.75, 0.3, 0.05), color, 0.5, 0.7, 0, { rz: -0.25, gloss: 0.4 });
  part(g, cyl(0.025, 0.025, 0.5, 6), P.metal, 0.62, 1.08, 0, { rx: Math.PI / 2, ...NL });
  part(g, sphere(0.08, 8), P.lamp, 0.66, 0.92, 0, { glow: 1.6, ...QUIET });
  part(g, rbox(0.44, 0.4, 0.4, 0.05), P.cream, -0.72, 1.0, 0, { outline: 0.03 });
  return g;
}
