// The world the board game is played in: floating islands in a golden dusk sky. Each island is a slab of grass
// on layered rock with its own landmark and dressing; rope bridges and little wooden decks join them; a sea of
// clouds lies below and lanterns line the paths.
import * as THREE from 'three';
import type { Board, IslandShape, Space } from '../../game/board';
import { type IslandId, islandInfo } from '../../shared/islands';
import * as props from '../render/props';
import { PALETTE as P, type SkyLook, applySky, ball, box, cloud, cone, cyl, disc, mix, nameCard, part, rbox, seeded, sphere, withOutline } from '../render/toon';
import { bake, live } from './bake';
import * as marks from './landmarks';
import { ISLAND_TOP, TILE_R } from './tiles';

type Tick = (dt: number, time: number) => void;
const NL = { outline: false } as const;
const QUIET = { outline: false, shadow: false } as const;

/** Golden hour sliding into dusk, seen from above the clouds. */
const BOARD_SKY: SkyLook = {
  background: '#8d6f93',
  zenith: '#2f3f7c',
  horizon: '#f3ab7a',
  ground: '#4a3f72',
  hemiSky: '#e0cdea',
  hemiGround: '#6f5a78',
  hemi: 0.86,
  sun: '#ffc584',
  sunIntensity: 2.0,
  sunFrom: [0.62, 0.6, 0.5],
  sunGlow: 1,
  stars: 0.3,
  clouds: 0.5,
  cloudColor: '#f6b295',
  ambient: '#b7a6ff',
  ambientIntensity: 0.2,
  rim: '#ffcf9f',
  rimStrength: 0.34,
  outline: 0.8,
  grade: 'golden',
};

// ------------------------------------------------------------------ island shapes

interface Outline {
  /** Distance from the island's centre to its edge in direction `a` (island space: x along the path, +z outwards). */
  (a: number): number;
}

function outlineOf(L: number, wOut: number, wIn: number, seed: number): Outline {
  const rand = seeded(seed);
  const p1 = rand() * 6.28;
  const p2 = rand() * 6.28;
  const p3 = rand() * 6.28;
  const p = 3.2;
  return (a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const w = s >= 0 ? wOut : wIn;
    const base = (Math.abs(c / L) ** p + Math.abs(s / w) ** p) ** (-1 / p);
    return base * (1 + 0.045 * Math.sin(3 * a + p1) + 0.03 * Math.sin(5 * a + p2) + 0.018 * Math.sin(9 * a + p3));
  };
}

const SEG = 72;

/** The grass slab: a flat top, a soft lip and an overhang with a wavy hem. */
function grassGeometry(r: Outline, seed: number): THREE.BufferGeometry {
  const rand = seeded(seed);
  const hem = Array.from({ length: SEG }, () => rand());
  const rings: [number, (i: number) => number][] = [
    [0.5, () => 0],
    [0.93, () => 0],
    [0.99, () => -0.04],
    [1.025, () => -0.16],
    [1.03, () => -0.34],
    [1.0, (i) => -0.5 - ((hem[i] as number) * 0.5 + (hem[(i + 1) % SEG] as number) * 0.5) * 0.42],
    [0.9, () => -0.45],
  ];
  const pos: number[] = [0, 0, 0];
  for (const [k, y] of rings) {
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const rr = r(a) * k;
      pos.push(Math.cos(a) * rr, y(i), Math.sin(a) * rr);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) idx.push(0, 1 + ((i + 1) % SEG), 1 + i);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < SEG; i++) {
      const a = 1 + k * SEG + i;
      const b = 1 + k * SEG + ((i + 1) % SEG);
      const c = a + SEG;
      const d = b + SEG;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The rock under an island: stepped strata that taper to a point, faceted. */
function rockGeometry(r: Outline, seed: number, depth = 1): THREE.BufferGeometry {
  const rand = seeded(seed);
  const strata: [number, number, number][] = [
    [0.97, -0.25, 0],
    [1.0, -0.95, 0.03],
    [0.9, -1.1, 0.04],
    [0.93, -1.95, 0.05],
    [0.76, -2.15, 0.06],
    [0.79, -3.2, 0.07],
    [0.56, -3.5, 0.08],
    [0.52, -4.7, 0.09],
    [0.31, -5.0, 0.1],
    [0.24, -6.3, 0.12],
    [0.07, -6.9, 0.12],
  ];
  const seg = 40;
  const pos: number[] = [];
  const lean = { x: (rand() - 0.5) * 1.6, z: (rand() - 0.5) * 1.2 };
  for (const [k, y, j] of strata) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rr = r(a) * k * (1 + (rand() - 0.5) * 2 * j);
      const t = -y / 7;
      pos.push(Math.cos(a) * rr + lean.x * t, (y + (rand() - 0.5) * j * 2.2) * depth, Math.sin(a) * rr + lean.z * t);
    }
  }
  pos.push(lean.x, -7.7 * depth, lean.z);
  const tip = strata.length * seg;
  const idx: number[] = [];
  for (let k = 0; k < strata.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i;
      const b = k * seg + ((i + 1) % seg);
      idx.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  const last = (strata.length - 1) * seg;
  for (let i = 0; i < seg; i++) idx.push(last + i, last + ((i + 1) % seg), tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

interface IslandPlan {
  id: IslandId;
  shape: IslandShape;
  /** Turns island space (x along the path, +z outwards) into the world. */
  frame: THREE.Group;
  outline: Outline;
  grass: string;
}

const SHAPES: Record<IslandId, { L: number; out: number; in: number }> = {
  docks: { L: 10.5, out: 6.9, in: 5.4 },
  windmill: { L: 10.5, out: 5.9, in: 8.3 },
  orchard: { L: 10.5, out: 7.9, in: 5.4 },
  lighthouse: { L: 10.5, out: 7.5, in: 5.4 },
  crystal: { L: 10.5, out: 7.5, in: 5.4 },
  observatory: { L: 10.5, out: 5.9, in: 8.3 },
  hq: { L: 9.6, out: 10.3, in: 8.3 },
};

function planIsland(shape: IslandShape, i: number): IslandPlan {
  const frame = new THREE.Group();
  frame.position.set(shape.x, 0, shape.z);
  if (shape.id === 'hq') {
    frame.rotation.y = 0;
  } else {
    // Island space: x along the path; z across it, turned so +z points away from the middle of the board.
    const zx = -Math.sin(shape.angle);
    const zz = Math.cos(shape.angle);
    frame.rotation.y = -shape.angle + (zx * shape.x + zz * shape.z < 0 ? Math.PI : 0);
  }
  frame.updateMatrixWorld(true);
  const s = SHAPES[shape.id];
  const lawn = mix(P.grass, '#b4c96e', 0.3);
  const tint = shape.id === 'crystal' ? mix(lawn, '#7f8fb0', 0.3) : shape.id === 'orchard' ? mix(lawn, P.moss, 0.25) : shape.id === 'windmill' ? mix(lawn, P.olive, 0.25) : lawn;
  return { id: shape.id, shape, frame, outline: outlineOf(s.L, s.out, s.in, 40 + i * 7), grass: tint };
}

function toLocal(plan: IslandPlan, x: number, z: number): THREE.Vector3 {
  return plan.frame.worldToLocal(new THREE.Vector3(x, 0, z));
}

function onIsland(plan: IslandPlan, x: number, z: number, margin = 0.93): boolean {
  const l = toLocal(plan, x, z);
  return Math.hypot(l.x, l.z) < plan.outline(Math.atan2(l.z, l.x)) * margin;
}

// ------------------------------------------------------------------ where the die lands

/**
 * The free side of a space: the unit direction (on the ground) in which a die is thrown from it. Across the path,
 * towards the camera where that is clear, otherwise towards the middle of the board.
 */
export function freeSide(board: Board, s: Space): THREE.Vector3 {
  const next = board.spaces[s.next[0] as number] as Space;
  const t = new THREE.Vector3(next.x - s.x, 0, next.z - s.z).normalize();
  const n = new THREE.Vector3(-t.z, 0, t.x);
  if (Math.abs(n.z) < 0.35) {
    if (n.x * s.x > 0) n.negate();
  } else if (n.z < 0) n.negate();
  return n;
}

/** Bridge spaces stand on a wooden deck, longer on the free side so the die has somewhere to land. */
export const DECK = { along: 1.5, back: 1.55, front: 3.8 };

function deckFrame(board: Board, s: Space): THREE.Group {
  const n = freeSide(board, s);
  const g = new THREE.Group();
  g.position.set(s.x, 0, s.z);
  // local +z = the free side
  g.rotation.y = Math.atan2(n.x, n.z);
  g.updateMatrixWorld(true);
  return g;
}

// ------------------------------------------------------------------ the world

export interface World {
  update(dt: number, time: number): void;
  sun: THREE.DirectionalLight;
  /** Where the lobby lineup stands: centre of the stage and the height of its floor. */
  stage: { x: number; y: number; z: number };
}

export function buildWorld(scene: THREE.Scene, board: Board): World {
  const sun = applySky(scene, BOARD_SKY, { near: 70, far: 300 }, 47);
  sun.target.position.set(0, 0, 0);
  sun.shadow.camera.far = 220;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 3;
  const ticks: Tick[] = [];
  const plans = board.islands.map(planIsland);
  const planOf = (id: IslandId) => plans.find((p) => p.id === id) as IslandPlan;

  // ---- islands
  withOutline(0.07, () => {
    plans.forEach((plan, i) => {
      const g = new THREE.Group();
      const deep = plan.id === 'hq' ? 1.25 : 1;
      const rockC = plan.id === 'crystal' ? mix(P.slate, P.plum, 0.4) : mix(P.soil, P.stone, 0.35);
      part(g, rockGeometry(plan.outline, 90 + i, deep), rockC, 0, ISLAND_TOP, 0, { tex: 'rock', texScale: 5, outline: 0.09 });
      part(g, grassGeometry(plan.outline, 70 + i), plan.grass, 0, ISLAND_TOP, 0, { tex: 'grass', texScale: 6, texStrength: 0.65, outline: 0.06 });
      dressIsland(g, plan, board, i);
      g.position.copy(plan.frame.position);
      g.rotation.copy(plan.frame.rotation);
      const baked = bake(g);
      scene.add(baked);
      // A few boulders hang in the air under each island and bob slowly.
      const rand = seeded(300 + i);
      for (let k = 0; k < 3; k++) {
        const a = rand() * Math.PI * 2;
        const rr = plan.outline(a) * (0.55 + rand() * 0.5);
        const stone = new THREE.Group();
        part(stone, ball(0.5 + rand() * 0.7, 0), mix(rockC, P.ink, rand() * 0.15), 0, 0, 0, { tex: 'rock', texScale: 3, sy: 0.8, ry: rand() * 3, outline: 0.07 });
        const at = plan.frame.localToWorld(new THREE.Vector3(Math.cos(a) * rr, -3.2 - rand() * 4.5, Math.sin(a) * rr));
        stone.position.copy(at);
        const ph = rand() * 6;
        ticks.push((_dt, time) => {
          stone.position.y = at.y + Math.sin(time * 0.5 + ph) * 0.35;
        });
        scene.add(stone);
      }
      // name label
      const info = islandInfo(plan.id);
      const card = nameCard(info.name, info.color, 0.95);
      card.position.copy(plan.frame.localToWorld(LABELS[plan.id].clone()));
      scene.add(card);
    });
  });

  // ---- paths, bridges and decks (in world space)
  const ways = new THREE.Group();
  withOutline(0.05, () => buildWays(ways, board, plans));
  scene.add(bake(ways));

  // ---- the sky around: a sea of clouds, drifting puffs, far balloons, motes
  scene.add(cloudSea(ticks));
  const rand = seeded(7);
  for (let i = 0; i < 30; i++) {
    const low = i < 22;
    const depth = rand();
    const c = bake(cloud(rand, low ? 2.4 + rand() * 3.4 : 1.6 + rand() * 1.8, mix('#fbd8bc', '#b490b6', low ? 0.2 + depth * 0.6 : 0.12)));
    const a = rand() * Math.PI * 2;
    const r = low ? 16 + rand() * 80 : 58 + rand() * 45;
    c.position.set(Math.cos(a) * r, low ? -10 - depth * 13 : -3 + rand() * 7, Math.sin(a) * r * 0.8 - (low ? 0 : 12));
    const drift = 0.25 + rand() * 0.6;
    ticks.push((dt) => {
      c.position.x += dt * drift;
      if (c.position.x > 115) c.position.x = -115;
    });
    scene.add(c);
  }
  for (const [a, b, r, x, y, z, ph] of [
    [P.mustard, P.cream, 2.2, -58, 3, -44, 0],
    [P.rose, P.cream, 1.8, 62, 7, -36, 2],
    [P.teal, P.sand, 1.5, -70, -2, 8, 4],
  ] as const) {
    const far = bake(marks.balloon(a, b, r));
    far.position.set(x, y, z);
    ticks.push((_dt, time) => {
      far.position.x = x + Math.sin(time * 0.05 + ph) * 9;
      far.position.y = y + Math.sin(time * 0.31 + ph) * 0.8;
    });
    scene.add(far);
  }
  const fireflies = props.motes({ n: 150, area: [86, 6, 64], color: P.lamp, size: 0.26, seed: 5 });
  fireflies.position.y = ISLAND_TOP + 0.4;
  scene.add(fireflies);

  scene.traverse((o) => {
    const t = o.userData.tick as Tick | undefined;
    if (t) ticks.push(t);
  });

  const hq = planOf('hq');
  return {
    sun,
    stage: { x: hq.shape.x, y: ISLAND_TOP + STAGE.h, z: hq.shape.z + STAGE.z },
    update(dt, time) {
      for (const t of ticks) t(dt, time);
    },
  };
}

/** Where each island's name hangs, in island space. */
const LABELS: Record<IslandId, THREE.Vector3> = {
  docks: new THREE.Vector3(0, 8.4, -4.4),
  windmill: new THREE.Vector3(0, 7.2, -5.6),
  orchard: new THREE.Vector3(0, 5.4, 5.2),
  lighthouse: new THREE.Vector3(0, 9.0, 4.7),
  crystal: new THREE.Vector3(0, 7.4, 4.7),
  observatory: new THREE.Vector3(0, 6.2, -5.6),
  hq: new THREE.Vector3(0, 6.2, -0.5),
};

/** The terrace in front of the Snack Shack: the stage the companions line up on in the lobby. */
const STAGE = { z: 7.95, w: 10.8, d: 3.5, h: 0.14 };

// ------------------------------------------------------------------ dressing

function dressIsland(g: THREE.Group, plan: IslandPlan, board: Board, index: number): void {
  const rand = seeded(500 + index * 13);
  const y = ISLAND_TOP;
  const tiles = board.spaces.filter((s) => s.island === plan.id).map((s) => toLocal(plan, s.x, s.z));
  const ring = plan.id !== 'hq';
  // The side of the path the dice are thrown to (in island space) must stay clear further out.
  const first = board.spaces.find((s) => s.island === plan.id) as Space;
  const dieSide = freeSide(board, first).applyQuaternion(plan.frame.quaternion.clone().invert()).z > 0 ? 1 : -1;
  /** Landmarks and other big things already placed: [x, z, radius]. */
  const taken: [number, number, number][] = [];
  const free = (x: number, z: number, pad: number): boolean => {
    if (Math.hypot(x, z) > plan.outline(Math.atan2(z, x)) * 0.9 - pad) return false;
    if (ring && Math.abs(x) < 10.6 && z * dieSide > -2.5 - pad && z * dieSide < 3.9 + pad) return false;
    for (const t of tiles) if (Math.hypot(x - t.x, z - t.z) < 3.3 + pad) return false;
    for (const [tx, tz, tr] of taken) if (Math.hypot(x - tx, z - tz) < tr + pad) return false;
    return true;
  };
  const place = (o: THREE.Object3D, x: number, z: number, s = 1, ry = rand() * 6.28): void => {
    o.position.set(x, y, z);
    o.scale.multiplyScalar(s);
    o.rotation.y = ry;
    g.add(o);
  };
  const scatter = (n: number, pad: number, make: (i: number) => THREE.Object3D | null, s = 1, reserve = 0, where: 'any' | 'behind' | 'low' = 'any'): void => {
    let made = 0;
    for (let tries = 0; tries < n * 30 && made < n; tries++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * plan.outline(a);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (!free(x, z, pad)) continue;
      // Tall things stand behind the path (seen from the camera); in front of it only low things, well away.
      if (ring && where === 'behind' && z * dieSide > 0) continue;
      if (ring && where === 'low' && z * dieSide > 0 && z * dieSide < 5.0) continue;
      const o = make(made);
      if (o) place(o, x, z, s);
      if (reserve) taken.push([x, z, reserve]);
      made++;
    }
  };

  // Keep the ways on and off the island clear too.
  for (const a of board.spaces) {
    for (const id of a.next) {
      const b = board.spaces[id] as Space;
      if ((a.island === plan.id) === (b.island === plan.id)) continue;
      const pa = toLocal(plan, a.x, a.z);
      const pb = toLocal(plan, b.x, b.z);
      for (let k = 0; k <= 5; k++) taken.push([pa.x + (pb.x - pa.x) * (k / 5), pa.z + (pb.z - pa.z) * (k / 5), 1.7]);
    }
  }

  // -- the landmark and the island's own things
  // Landmarks stand on the far side of the path from the camera (the side the dice are not thrown to) and face
  // the path, so they never hide the players.
  const back = -dieSide;
  const front = dieSide > 0 ? 0 : Math.PI;
  switch (plan.id) {
    case 'hq':
      dressHq(g, taken);
      break;
    case 'lighthouse':
      place(marks.lighthouse(), 0, back * 4.7, 1, front);
      taken.push([0, back * 4.7, 4.6]);
      break;
    case 'windmill':
      place(marks.windmill(), 0.4, back * 5.6, 1, front);
      taken.push([0, back * 5.6, 6]);
      break;
    case 'orchard':
      place(marks.orchard(), 0, back * 5.2, 1, front);
      taken.push([0, back * 5.4, 6.4], [-4.5, back * 5.5, 3], [4.5, back * 5.5, 3]);
      break;
    case 'crystal':
      place(marks.crystal(), 0, back * 4.7, 1, front);
      taken.push([0, back * 4.7, 4.6]);
      break;
    case 'observatory':
      place(marks.observatory(), -0.2, back * 5.6, 1, front);
      taken.push([0, back * 5.6, 5]);
      break;
    case 'docks': {
      // The big balloon is moored on the side towards the Snack Shack, where it hides nothing; a smaller one
      // floats off the pier at the front.
      part(g, cyl(1.25, 1.35, 0.16, 20), P.stone, 0, y + 0.08, -4.2, { tex: 'stoneTiles' });
      part(g, cyl(0.1, 0.12, 0.7, 8), P.walnut, 0.9, y + 0.4, -4.2, {});
      part(g, torus8(0.16), P.charcoal, 0.9, y + 0.78, -4.2, NL);
      const big = marks.mooredBalloon(P.terracotta, P.cream, 1.55, 0);
      big.position.set(0, y + 0.95, -4.25);
      big.userData.baseY = big.position.y;
      g.add(big);
      part(g, cyl(0.016, 0.016, 1.3, 5), P.linen, 0.45, y + 1.05, -4.22, { rz: 0.75, ...QUIET });
      taken.push([0, -4.2, 1.8]);
      const pier = marks.docksPier();
      place(pier, 5.4, 4.8, 1, 0);
      taken.push([5.4, 5.2, 2.4]);
      const small = marks.mooredBalloon(P.denim, P.mustard, 1.15, 2.2);
      small.position.set(5.4, y - 0.4, 8.8);
      small.userData.baseY = small.position.y;
      g.add(small);
      place(marks.ticketBooth(), -5.3, 5.1, 1, 0);
      taken.push([-5.3, 5.1, 1.6]);
      place(marks.windsock(), 0.1, 5.2, 1, 0);
      place(marks.signpost([islandInfo('windmill').color, islandInfo('lighthouse').color, islandInfo('hq').color]), -2.9, -3.6, 1, 0.4);
      taken.push([0.1, 5.2, 0.7], [-2.9, -3.6, 0.7]);
      place(props.tree({ kind: 'birch', h: 3.2, seed: 3 }), 3.6, -3.9, 1);
      taken.push([3.6, -3.9, 1.4]);
      break;
    }
  }

  // -- lanterns along the path, on the side the dice are not thrown to
  if (ring) {
    const side = -dieSide;
    for (const x of [-5.5, 0, 5.5]) {
      const lamp = marks.lampPost(2.1);
      place(lamp, x, side * 1.95, 1, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }

  // -- patches of darker and lighter grass
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * plan.outline(a) * 0.74;
    const r = 1.1 + rand() * 1.5;
    part(g, disc(1, 20), mix(plan.grass, i % 2 ? P.grassDark : P.olive, 0.3 + rand() * 0.25), Math.cos(a) * rr, y + 0.015 + i * 0.001, Math.sin(a) * rr, { sx: r, sz: r * (0.6 + rand() * 0.3), ry: rand() * 3, tex: 'grass', texScale: 6, texStrength: 0.8, ...QUIET });
  }

  // -- trees, bushes, rocks, tufts and flowers
  const crystalIsle = plan.id === 'crystal';
  const flowers = [P.cream, P.mustard, P.rose, mix(islandInfo(plan.id).color, P.cream, 0.3)];
  const treeKinds: props.TreeKind[] = plan.id === 'lighthouse' || crystalIsle || plan.id === 'observatory' ? ['pine', 'pine', 'birch'] : ['round', 'birch', 'round'];
  const trees = plan.id === 'orchard' ? 0 : plan.id === 'hq' ? 5 : plan.id === 'docks' ? 1 : 3;
  scatter(trees, 1.0, (i) => props.tree({ kind: treeKinds[i % 3] as props.TreeKind, h: 2.8 + rand() * 1.2, seed: index * 9 + i, ...(crystalIsle ? { color: mix(P.pine, P.plum, 0.25) } : {}) }), 1, 1.5, 'behind');
  scatter(6, 0.5, (i) => props.bush({ r: 0.55 + rand() * 0.3, seed: index * 5 + i, ...(i % 2 && !crystalIsle ? { flowers: flowers[i % 4] as string } : {}), ...(crystalIsle ? { color: mix(P.fern, P.plum, 0.3) } : {}) }), 1.25, 0.9, 'low');
  scatter(4, 0.4, (i) => props.rock({ r: 0.35 + rand() * 0.3, seed: index * 3 + i, color: crystalIsle ? mix(P.slate, P.plum, 0.3) : mix(P.stone, P.soil, 0.2) }), 1.2, 0.8, 'low');
  if (crystalIsle) {
    scatter(12, 0.3, (i) => {
      const c = new THREE.Group();
      marks.shard(c, 0, 0, 0.5 + rand() * 0.7, 0.16 + rand() * 0.1, ['#8f63e6', '#c7a8ff', '#86d9ea'][i % 3] as string, i % 4 === 0 ? 1.6 : 0.7, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6);
      return c;
    });
  }
  scatter(26, 0.15, (i) => props.tuft({ seed: index * 31 + i, s: 2.6 + rand() * 1.4, ...(i % 3 === 0 && !crystalIsle ? { flowers: flowers[i % 4] as string } : {}), color: mix(plan.grass, P.grassDark, 0.5) }));
  // a few tufts right along the path, where nothing else may stand
  for (let i = 0; i < 10 && ring; i++) {
    const x = -9.5 + rand() * 19;
    const z = (rand() < 0.5 ? -1 : 1) * (1.0 + rand() * 1.6);
    if (tiles.some((t) => Math.hypot(x - t.x, z - t.z) < TILE_R + 0.5)) continue;
    place(props.tuft({ seed: index * 17 + i, s: 2.2, color: mix(plan.grass, P.grassDark, 0.5) }), x, z);
  }
}

const torus8 = (r: number) => new THREE.TorusGeometry(r, 0.035, 6, 14);

function dressHq(g: THREE.Group, taken: [number, number, number][]): void {
  const y = ISLAND_TOP;
  const put = (o: THREE.Object3D, x: number, z: number, s = 1, ry = 0, dy = 0): void => {
    o.position.set(x, y + dy, z);
    o.scale.multiplyScalar(s);
    o.rotation.y = ry;
    g.add(o);
  };
  put(marks.snackShack(), 0, -0.5);
  put(marks.scooter(), -0.7, -2.95, 1.2, 0.3);
  taken.push([0, 0, 4.4], [0, 3.5, 3], [0, -3.5, 3]);

  // the terrace: a wooden stage with a rug, lanterns on tall posts and strings of lights
  const st = STAGE;
  part(g, rbox(st.w, st.h + 0.1, st.d, 0.5), P.oak, 0, y + st.h / 2 - 0.05, st.z, { tex: 'planks', texScale: 1.6, outline: 0.06 });
  part(g, rbox(st.w + 0.3, 0.12, st.d + 0.3, 0.6), P.walnut, 0, y - 0.02, st.z, { tex: 'planks', outline: false });
  const rug = props.rug({ w: 7.6, d: 2.3, color: mix(P.terracotta, P.aubergine, 0.3), border: P.sand });
  put(rug, 0, st.z + 0.1, 1, 0, st.h);
  const top = 4.3;
  const posts: [number, number][] = [
    [-5.3, st.z - 1.6],
    [5.3, st.z - 1.6],
  ];
  for (const [x, z] of posts) {
    part(g, cyl(0.07, 0.1, top, 8), P.walnut, x, y + top / 2, z, { tex: 'bark', outline: 0.04 });
    part(g, sphere(0.13, 10), P.lamp, x, y + top + 0.1, z, { glow: 2.2, ...QUIET });
  }
  const at = (i: number) => new THREE.Vector3((posts[i] as [number, number])[0], y + top - 0.1, (posts[i] as [number, number])[1]);
  const lights = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => g.add(props.stringLights(a, b, { sag, bulb: 0.085, count: Math.round(a.distanceTo(b) / 0.62) }));
  lights(at(0), at(1), 0.5);
  // low bollards with a glow at the front corners
  for (const x of [-5.2, 5.2]) {
    part(g, cyl(0.09, 0.11, 0.55, 8), P.walnut, x, y + st.h + 0.27, st.z + 1.5, { tex: 'bark', outline: 0.03 });
    part(g, sphere(0.11, 10), P.lamp, x, y + st.h + 0.62, st.z + 1.5, { glow: 2.2, ...QUIET });
  }
  // and from the terrace back to the shack's eaves
  lights(at(0), new THREE.Vector3(-2.2, y + 2.7, 1.2), 0.5);
  lights(at(1), new THREE.Vector3(2.2, y + 2.7, 1.2), 0.5);
  put(props.plant({ kind: 'palm', h: 1.7, pot: P.terracotta }), -6.1, st.z - 0.9, 1.5);
  put(props.plant({ kind: 'monstera', h: 0.9, pot: P.ceramic }), 6.0, st.z - 1.2, 1.7);
  put(props.beanbag({ color: P.mustard }), 6.3, st.z + 0.5, 1.5);
  put(props.crate({ s: 0.6 }), -6.2, st.z + 0.7, 1.2, 0.4);
  taken.push([0, st.z, 6.6], [-6.1, st.z, 1.2], [6.1, st.z, 1.4]);

  // a couch corner on the grass: the living room, outdoors
  put(props.rug({ w: 3.0, d: 2.2, color: P.teal, border: P.sand, tex: 'knit' }), -6.6, 1.2, 1, 0.5);
  put(props.sofa({ seats: 2, color: P.mauve, pillows: [P.mustard, P.teal] }), -7.2, 0.5, 1.5, 0.5 + Math.PI / 2 - 0.6);
  put(props.coffeeTable({ w: 0.9, d: 0.55, round: true }), -6.1, 1.5, 1.4, 0.5);
  put(props.floorLamp({ shade: P.cream }), -7.6, 2.3, 1.5);
  taken.push([-6.8, 1.2, 2.6]);
  // lanterns beside the two lanes
  for (const [x, z, ry] of [[-5.3, -2.2, 0], [5.3, 1.6, Math.PI], [5.3, -2.8, Math.PI]] as const) put(marks.lampPost(2.2), x, z, 1, ry);
  taken.push([5.3, 1.6, 0.8], [5.3, -2.8, 0.8], [-5.3, -2.2, 0.8]);
}

// ------------------------------------------------------------------ paths, decks and rope bridges

function buildWays(g: THREE.Group, board: Board, plans: IslandPlan[]): void {
  const planOf = (id: IslandId | null) => (id ? plans.find((p) => p.id === id) : undefined);
  const decks = new Map<number, THREE.Group>();
  for (const s of board.spaces) {
    if (s.island) continue;
    const frame = deckFrame(board, s);
    decks.set(s.id, frame);
    const next = board.spaces[s.next[0] as number] as Space;
    const nearShack = next.island === 'hq' || board.spaces.some((o) => o.island === 'hq' && o.next.includes(s.id));
    buildDeck(g, frame, s.id, !(nearShack && s.z > 0));
  }
  const grounded = (s: Space, x: number, z: number): boolean => {
    const plan = planOf(s.island);
    if (plan) return onIsland(plan, x, z, 0.97);
    const l = (decks.get(s.id) as THREE.Group).worldToLocal(new THREE.Vector3(x, 0, z));
    return Math.abs(l.x) < DECK.along && l.z > -DECK.back && l.z < DECK.front;
  };
  for (const a of board.spaces) {
    for (const id of a.next) {
      const b = board.spaces[id] as Space;
      const from = new THREE.Vector3(a.x, 0, a.z);
      const to = new THREE.Vector3(b.x, 0, b.z);
      const dist = from.distanceTo(to);
      const dir = to.clone().sub(from).normalize();
      const heading = Math.atan2(dir.x, dir.z);
      if (a.island && a.island === b.island) {
        pathStrip(g, from, to, heading, TILE_R - 0.1, dist - TILE_R + 0.1);
        continue;
      }
      // Walk from a to b: the bridge spans the gap between the two grounds.
      let leave = 0;
      let arrive = dist;
      for (let t = 0; t <= dist; t += 0.05) {
        const p = from.clone().addScaledVector(dir, t);
        if (grounded(a, p.x, p.z)) leave = t;
        else break;
      }
      for (let t = dist; t >= 0; t -= 0.05) {
        const p = from.clone().addScaledVector(dir, t);
        if (grounded(b, p.x, p.z)) arrive = t;
        else break;
      }
      if (a.island) pathStrip(g, from, to, heading, TILE_R - 0.1, leave - 0.15);
      if (b.island) pathStrip(g, from, to, heading, arrive + 0.15, dist - TILE_R + 0.1);
      // The lanes through the Snack Shack are plain boardwalks (nothing in front of the terrace in the lobby).
      const rails = a.island !== 'hq' && b.island !== 'hq';
      if (arrive - leave > 0.3) ropeBridge(g, from.clone().addScaledVector(dir, leave - 0.3), from.clone().addScaledVector(dir, arrive + 0.3), heading, rails);
    }
  }
}

/** A strip of cobbles on an island between two points along a way. */
function pathStrip(g: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, heading: number, t0: number, t1: number): void {
  if (t1 - t0 < 0.2) return;
  const dir = to.clone().sub(from).normalize();
  const mid = from.clone().addScaledVector(dir, (t0 + t1) / 2);
  part(g, rbox(1.25, 0.07, t1 - t0, 0.03), mix(P.sand, P.stone, 0.45), mid.x, ISLAND_TOP + 0.02, mid.z, { ry: heading, tex: 'cobble', texScale: 1.5, ...QUIET });
}

function buildDeck(g: THREE.Group, frame: THREE.Group, seed: number, lantern = true): void {
  const d = new THREE.Group();
  d.position.copy(frame.position);
  d.rotation.copy(frame.rotation);
  const rand = seeded(700 + seed);
  const w = DECK.along * 2;
  const depth = DECK.back + DECK.front;
  const cz = (DECK.front - DECK.back) / 2;
  part(d, rbox(w + 0.25, 0.2, depth + 0.25, 0.45), P.walnut, 0, ISLAND_TOP - 0.22, cz, { tex: 'planks', texScale: 1.6 });
  part(d, rbox(w, 0.16, depth, 0.4), P.oak, 0, ISLAND_TOP - 0.08, cz, { tex: 'planks', texScale: 1.3, outline: false });
  // the lump of rock that carries it
  const rockC = mix(P.soil, P.stone, 0.35);
  part(d, cone(1, 1, 7), rockC, 0, ISLAND_TOP - 0.32 - 1.35, cz, { rx: Math.PI, sx: w * 0.5, sy: 2.7, sz: depth * 0.48, ry: rand() * 3, tex: 'rock', texScale: 3, outline: 0.07 });
  part(d, ball(0.5, 0), mix(rockC, P.ink, 0.1), (rand() - 0.5) * 1.6, ISLAND_TOP - 2.6 - rand(), cz + (rand() - 0.5) * 2, { tex: 'rock', sy: 0.8, outline: 0.06 });
  // a lantern at a back corner, a crate or a coil of rope at the other
  if (lantern) {
    const lamp = marks.lampPost(1.9);
    lamp.position.set(-DECK.along + 0.25, ISLAND_TOP, -DECK.back + 0.3);
    lamp.rotation.y = -Math.PI / 4;
    d.add(lamp);
  }
  // low bollards at the front corners, joined by a rope
  for (const x of [-1, 1]) {
    part(d, cyl(0.09, 0.11, 0.5, 8), P.walnut, x * (DECK.along - 0.2), ISLAND_TOP + 0.25, DECK.front - 0.22, { tex: 'bark', outline: 0.03 });
    part(d, sphere(0.11, 8), P.walnut, x * (DECK.along - 0.2), ISLAND_TOP + 0.52, DECK.front - 0.22, NL);
  }
  part(d, cyl(0.025, 0.025, (DECK.along - 0.2) * 2, 5), P.sand, 0, ISLAND_TOP + 0.36, DECK.front - 0.22, { rz: Math.PI / 2, ...QUIET });
  if (!lantern) {
    // nothing tall on the decks in front of the terrace
  } else if (seed % 2) {
    const c = props.crate({ s: 0.5 });
    c.position.set(DECK.along - 0.4, ISLAND_TOP, -DECK.back + 0.4);
    c.rotation.y = rand();
    d.add(c);
  } else {
    part(d, cyl(0.26, 0.24, 0.5, 12), P.mahogany, DECK.along - 0.4, ISLAND_TOP + 0.25, -DECK.back + 0.4, { tex: 'planks', texScale: 0.8 });
  }
  g.add(d);
}

/** A rope bridge between two points at island height: sagging planks, two hand ropes, posts at each end. */
function ropeBridge(g: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, heading: number, rails = true): void {
  const len = from.distanceTo(to);
  const b = new THREE.Group();
  b.position.copy(from).lerp(to, 0.5);
  b.rotation.y = heading;
  const sag = 0.1 + len * 0.045;
  const n = Math.max(3, Math.round(len / 0.44));
  const drop = (u: number) => Math.sin(u * Math.PI) * sag;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const z = -len / 2 + u * len;
    const slope = Math.cos(u * Math.PI) * sag * Math.PI / len;
    part(b, box(1.5, 0.09, len / n - 0.07), i % 2 ? P.oak : mix(P.oak, P.walnut, 0.5), 0, ISLAND_TOP - 0.03 - drop(u), z, { rx: slope, tex: 'planks', texScale: 1.1, outline: i % 3 === 0 ? 0.04 : false });
  }
  for (const x of rails ? [-0.78, 0.78] : []) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      pts.push(new THREE.Vector3(x, ISLAND_TOP + 0.95 - drop(u) * 1.5, -len / 2 + u * len));
    }
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.035, 5), marks_rope());
    rope.castShadow = true;
    b.add(rope);
    const under = pts.map((p) => new THREE.Vector3(p.x * 0.96, ISLAND_TOP - 0.08 - drop((p.z + len / 2) / len), p.z));
    const low = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(under), 14, 0.03, 5), marks_rope());
    b.add(low);
    for (let i = 1; i < n; i += 2) {
      const u = i / n;
      const top = ISLAND_TOP + 0.95 - drop(u) * 1.5;
      const bottom = ISLAND_TOP - 0.05 - drop(u);
      part(b, cyl(0.016, 0.016, top - bottom, 4), P.sand, x, (top + bottom) / 2, -len / 2 + u * len, QUIET);
    }
    for (const z of [-len / 2, len / 2]) {
      part(b, cyl(0.085, 0.11, 1.35, 8), P.walnut, x, ISLAND_TOP + 0.5, z, { tex: 'bark', outline: 0.04 });
      part(b, sphere(0.12, 8), P.walnut, x, ISLAND_TOP + 1.2, z, NL);
    }
  }
  g.add(b);
}

let ropeMat: THREE.Material | null = null;
function marks_rope(): THREE.Material {
  if (!ropeMat) {
    const probe = new THREE.Group();
    ropeMat = part(probe, box(1, 1, 1), P.sand, 0, 0, 0, QUIET).material as THREE.Material;
  }
  return ropeMat;
}

// ------------------------------------------------------------------ the sea of clouds

const SEA_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SEA_FRAGMENT = /* glsl */ `
varying vec3 vWorld;
uniform float time;
uniform vec3 deep;
uniform vec3 mid;
uniform vec3 lit;
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float fbm( vec2 p ) { return vnoise( p ) * 0.5 + vnoise( p * 2.03 + 7.3 ) * 0.27 + vnoise( p * 4.1 + 1.7 ) * 0.15 + vnoise( p * 8.3 + 4.1 ) * 0.08; }
void main() {
  vec2 p = vWorld.xz * 0.018 + vec2( time * 0.006, time * 0.002 );
  float n = fbm( p );
  float n2 = fbm( p * 1.9 + vec2( 3.1, -time * 0.004 ) );
  vec3 col = mix( deep, mid, smoothstep( 0.32, 0.62, n ) );
  // the tops of the cloud banks catch the low sun
  col = mix( col, lit, smoothstep( 0.52, 0.8, n * 0.6 + n2 * 0.5 ) * 0.85 );
  float r = length( vWorld.xz );
  float alpha = 1.0 - smoothstep( 150.0, 330.0, r );
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function cloudSea(ticks: Tick[]): THREE.Mesh {
  const uniforms = {
    time: { value: 0 },
    deep: { value: new THREE.Color('#3e3b72') },
    mid: { value: new THREE.Color('#8f6f9d') },
    lit: { value: new THREE.Color('#f6b98f') },
  };
  const mat = new THREE.ShaderMaterial({ name: 'cloudSea', uniforms, vertexShader: SEA_VERTEX, fragmentShader: SEA_FRAGMENT, transparent: true, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), mat);
  mesh.position.y = -34;
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  live(mesh);
  ticks.push((_dt, time) => {
    uniforms.time.value = time;
  });
  // `?bstats=1`: how many draw calls a frame of the board takes (read `window.__boardCalls` in the console).
  if (new URLSearchParams(window.location.search).has('bstats')) {
    mesh.onAfterRender = (renderer) => {
      (window as unknown as { __boardCalls: number }).__boardCalls = renderer.info.render.calls;
    };
  }
  return mesh;
}
