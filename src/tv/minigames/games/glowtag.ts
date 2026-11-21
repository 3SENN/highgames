// Glow Tag on the TV: a back garden after dark, seen from above at an angle. Everyone carries a glow stick in their
// team's colour, and it lights them up (a little point light each); a few garden lamps glow along the fence. The
// team that's "it" has a ring at their feet and a marker over their heads; a tagged runner's glow stick goes dim.
import * as THREE from 'three';
import {
  OBSTACLES,
  TAG,
  type CpuTagger,
  type Stick,
  type Yard,
  cpuTag,
  isChaser,
  newCpuTagger,
  newYard,
  pressTag,
  roundOver,
  startRound,
  stepYard,
  tagDetail,
  tagScores,
} from '../../../game/minigames/glowtag';
import { type Companion, buildCompanion } from '../../../companion/kit';
import type { CompanionMood } from '../../../shared/look';
import type { Sfx } from '../../audio';
import { type Env, backyard } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, ball, canvasTexture, cone, cyl, dome, gem, material, mix, nameCard, part, plane, rbox, seeded, sphere, torus } from '../../render/toon';
import type { View } from '../../stage';
import { CameraFit, Floaters, type Mark, noise, teamsOf, tone } from '../kit';
import { type Minigame, type MinigameSeat, everyFrame } from '../types';

const HEIGHT = 1.15; // companions
const TILT = 0.95; // the camera looks down this much (radians)
const PAUSE = 1.6; // seconds between rounds
const LAWN = '#5f8a52'; // the garden's grass after dark (the environment's own)
const IDLE: Stick = { x: 0, y: 0 };

// ------------------------------------------------------------------ sounds

const zap = (sfx: Sfx) => {
  tone(sfx, { freq: 880, to: 1320, dur: 0.1, type: 'triangle', gain: 0.1 });
  tone(sfx, { freq: 660, to: 330, dur: 0.22, gain: 0.07, delay: 0.08 });
};
const swish = (sfx: Sfx) => noise(sfx, { dur: 0.1, filter: 'bandpass', freq: 1500, to: 700, gain: 0.07 });
const relight = (sfx: Sfx) => tone(sfx, { freq: 520, to: 780, dur: 0.14, gain: 0.04 });
const cricket = (sfx: Sfx) => {
  const f = 4100 + Math.random() * 500;
  for (let k = 0; k < 3; k++) tone(sfx, { freq: f, dur: 0.025, gain: 0.01, delay: k * 0.06 });
};

// ------------------------------------------------------------------ the view

function radial(color: string): THREE.CanvasTexture {
  const c = new THREE.Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, `rgba(${rgb},0.9)`);
    g.addColorStop(0.45, `rgba(${rgb},0.35)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

interface Runner {
  c: Companion;
  team: number;
  color: string;
  teamColor: string;
  light: THREE.PointLight;
  stick: THREE.Mesh;
  pool: THREE.Mesh;
  poolMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  itRing: THREE.Mesh;
  marker: THREE.Mesh;
  flash: THREE.Mesh;
  flashMat: THREE.MeshBasicMaterial;
  flashAge: number;
  card: THREE.Sprite;
  motion: 'walk' | 'run' | null;
  mood: CompanionMood | null;
  glow: number;
}

interface Spark {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  age: number;
}

class NightGarden implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  /** By seat position. */
  readonly rigs: (Runner | undefined)[] = [];
  readonly floaters: Floaters;
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly marks: Mark[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private sparks: Spark[] = [];
  private time = 0;
  private cricketIn = 1;
  private readonly env: Env;
  private tick: (dt: number, time: number) => void = () => {};
  private readonly embers: THREE.Mesh[] = [];

  constructor(
    seats: MinigameSeat[],
    teams: number[][],
    private readonly companions: Companion[],
    private readonly sfx: Sfx,
  ) {
    this.floaters = new Floaters(this.scene);
    this.env = this.garden();
    // Tag in the dark: the moon only hints at the garden, so the glow sticks do the lighting.
    this.env.sun.intensity *= 0.6;
    this.scene.traverse((o) => {
      if ((o as THREE.HemisphereLight).isHemisphereLight) (o as THREE.HemisphereLight).intensity *= 0.7;
      if ((o as THREE.AmbientLight).isAmbientLight) (o as THREE.AmbientLight).intensity *= 0.5;
    });

    const textures = new Map<string, THREE.CanvasTexture>();
    teams.forEach((members, team) => {
      const teamColor = seats[members[0] ?? 0]?.color ?? '#ffd166';
      let tex = textures.get(teamColor);
      if (!tex) {
        tex = radial(teamColor);
        textures.set(teamColor, tex);
        this.owned.push(tex);
      }
      for (const p of members) {
        const seat = seats[p];
        const c = companions[p];
        if (!seat || !c) continue;
        c.setBase('listening');
        this.scene.add(c.root);
        // The glow stick in hand, and its light.
        const stick = part(c.root, cyl(0.035, 0.035, 0.34, 10), teamColor, 0.3, HEIGHT * 0.42, 0.14, { glow: 2.2, rz: -0.5, rx: 0.3, shadow: false });
        const light = new THREE.PointLight(teamColor, 3.2, 5, 1.4);
        light.castShadow = false;
        light.position.set(0.3, HEIGHT * 0.55, 0.2);
        c.root.add(light);
        const poolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.55 });
        const pool = new THREE.Mesh(plane(3.6, 3.6), poolMat);
        pool.rotation.x = -Math.PI / 2;
        pool.renderOrder = 2;
        this.scene.add(pool);
        const ring = part(this.scene, torus(0.34, 0.035), seat.color, 0, 0.03, 0, { rx: Math.PI / 2, glow: 0.8, outline: false, shadow: false });
        const itRing = part(this.scene, torus(0.55, 0.05), teamColor, 0, 0.04, 0, { rx: Math.PI / 2, glow: 1.2, outline: false, shadow: false });
        const marker = part(this.scene, cone(0.13, 0.26, 14), teamColor, 0, 0, 0, { rx: Math.PI, glow: 1.2, outline: false, shadow: false });
        const flashMat = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
        const flash = new THREE.Mesh(torus(TAG.reach, 0.03), flashMat);
        flash.rotation.x = Math.PI / 2;
        this.scene.add(flash);
        const card = nameCard(seat.name, seat.color, 0.72);
        this.scene.add(card);
        this.owned.push(poolMat, flashMat, card.material.map as THREE.Texture, card.material);
        this.rigs[p] = { c, team, color: seat.color, teamColor, light, stick, pool, poolMat, ring, itRing, marker, flash, flashMat, flashAge: 9, card, motion: null, mood: null, glow: 1 };
      }
    });

    // The whole garden stays on screen, with room for the name cards over heads at the back.
    for (const x of [-TAG.halfW, TAG.halfW]) {
      for (const z of [-TAG.halfD, TAG.halfD]) this.marks.push({ p: new THREE.Vector3(x, 0, z) });
      this.marks.push({ p: new THREE.Vector3(x * 0.95, HEIGHT + 0.5, -TAG.halfD + 0.3), pad: 0.04 });
    }
  }

  /** The garden after dark: the lawn inside its low fence, flower beds, the table, bushes, an apple tree, the barbecue, lamps. */
  private garden(): Env {
    const s = this.scene;
    const W = TAG.halfW;
    const D = TAG.halfD;
    const rand = seeded(23);
    const env = backyard(s, { mood: 'night', w: 21, d: 13.6, clear: { w: 2 * W + 2.4, d: 2 * D + 2.6 }, lights: false, seed: 11 });
    env.sun.target.position.set(0, 0, 0);
    const set = new THREE.Group();
    s.add(set);
    const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, scale = 1) => {
      o.position.set(x, y, z);
      o.rotation.y = ry;
      if (scale !== 1) o.scale.setScalar(scale);
      set.add(o);
      return o;
    };
    /** A soft pool of light on the grass (no real light needed). */
    const pool = (color: string, x: number, z: number, size: number, opacity: number) => {
      const tex = radial(color);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity });
      const m = new THREE.Mesh(plane(size, size), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.022, z);
      m.renderOrder = 1;
      set.add(m);
      this.owned.push(tex, mat);
    };
    // The lawn, mown in stripes.
    for (let k = 0; k < 8; k++) {
      if (k % 2) continue;
      const w = (2 * W) / 8;
      part(set, rbox(w, 0.02, 2 * D, 0.005), mix(LAWN, P.ink, 0.14), -W + w * (k + 0.5), -0.004, 0, { tex: 'grass', outline: false, shadow: false });
    }
    // Its edges: a flower bed and a low hedge at the back, low fences along the sides, a stone kerb in front.
    part(set, rbox(2 * W + 0.9, 0.12, 0.55, 0.04), P.soilDark, 0, 0.03, -D - 0.42, { outline: false, shadow: false });
    put(props.hedge({ w: 2 * W + 1.0, h: 0.75, d: 0.5, seed: 4 }), 0, 0, -D - 0.98);
    const flowers = [P.rose, P.mustard, P.mauve, P.moon, P.cream];
    for (let k = 0; k < 34; k++) {
      const x = -W + 0.2 + rand() * (2 * W - 0.4);
      const z = -D - 0.42 + (rand() - 0.5) * 0.3;
      part(set, cyl(0.008, 0.008, 0.16, 4), P.fern, x, 0.14, z, { outline: false, shadow: false });
      part(set, sphere(0.055, 8), flowers[k % flowers.length] as string, x, 0.24, z, { outline: false, shadow: false });
    }
    for (const sx of [-1, 1]) put(props.fence({ w: 2 * D + 1.3, kind: 'panel', h: 0.6, color: P.walnut }), sx * (W + 0.42), 0, -0.1, (sx * Math.PI) / 2);
    part(set, rbox(2 * W + 0.9, 0.14, 0.26, 0.05), P.stone, 0, 0.04, D + 0.42, { tex: 'cobble', texScale: 0.8, outline: false });
    for (const sx of [-1, 1]) put(props.rock({ r: 0.22, seed: sx + 5 }), sx * (W + 0.4), 0, D + 0.45);

    const [table, bushA, bushB, tree, bbq] = OBSTACLES;
    // The round garden table: stools tucked in, a candle and a bowl of crisps on top.
    part(set, cyl(table.r, table.r, 0.06, 32), P.linen, table.x, 0.72, table.z, { tex: 'wood', texStrength: 0.6, outline: 0.02 });
    part(set, cyl(table.r * 0.96, table.r * 0.96, 0.03, 32), mix(P.linen, P.ink, 0.3), table.x, 0.68, table.z, { outline: false });
    part(set, cyl(0.06, 0.1, 0.68, 12), P.metal, table.x, 0.34, table.z, { gloss: 0.5, outline: false });
    part(set, cyl(0.3, 0.34, 0.04, 16), P.metal, table.x, 0.02, table.z, { gloss: 0.5, outline: false });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      put(props.stool({ h: 0.42, seat: [P.terracotta, P.mustard, P.teal][k] as string }), table.x + Math.cos(a) * (table.r - 0.12), 0, table.z + Math.sin(a) * (table.r - 0.12), -a);
    }
    put(props.candle({ h: 0.12 }), table.x - 0.1, 0.75, table.z + 0.05);
    put(props.snackBowl({ fill: 'crisps', color: P.terracotta, r: 0.16 }), table.x + 0.22, 0.75, table.z - 0.14);
    put(props.drink({ kind: 'bottle', color: P.forest }), table.x - 0.3, 0.75, table.z - 0.22);
    pool(P.lamp, table.x, table.z, 2.6, 0.22);
    // Bushes.
    put(props.bush({ r: bushA.r, flowers: P.rose, seed: 3 }), bushA.x, 0, bushA.z);
    put(props.bush({ r: bushB.r, flowers: P.cream, seed: 8 }), bushB.x, 0, bushB.z);
    // A young apple tree.
    part(set, cyl(tree.r * 0.42, tree.r * 0.6, 1.7, 10), P.woodDark, tree.x, 0.85, tree.z, { tex: 'bark', outline: 0.02 });
    const crown = [mix(P.leafDark, P.pine, 0.4), P.leafDark, mix(P.leafDark, P.fern, 0.5)];
    part(set, ball(0.72, 2), crown[0] as string, tree.x, 1.95, tree.z, { sy: 0.8, outline: 0.02 });
    part(set, ball(0.45, 1), crown[1] as string, tree.x + 0.38, 2.2, tree.z + 0.2, { outline: false });
    part(set, ball(0.4, 1), crown[2] as string, tree.x - 0.36, 2.15, tree.z - 0.15, { outline: false });
    for (let k = 0; k < 6; k++) part(set, sphere(0.07, 8), P.brick, tree.x + (rand() - 0.5) * 1.1, 1.8 + rand() * 0.4, tree.z + (rand() - 0.5) * 1.1, { gloss: 0.5, outline: false });
    // The barbecue, still warm.
    part(set, dome(bbq.r * 0.9), P.charcoal, bbq.x, 0.62, bbq.z, { rx: Math.PI, gloss: 0.5, outline: 0.02 });
    part(set, cyl(bbq.r * 0.9, bbq.r * 0.9, 0.04, 22), P.metal, bbq.x, 0.63, bbq.z, { gloss: 0.6, outline: false });
    part(set, torus(bbq.r * 0.9, 0.018), P.slate, bbq.x, 0.65, bbq.z, { rx: Math.PI / 2, gloss: 0.6, outline: false });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      part(set, cyl(0.025, 0.025, 0.6, 6), P.charcoal, bbq.x + Math.cos(a) * 0.22, 0.3, bbq.z + Math.sin(a) * 0.22, { rz: Math.cos(a) * 0.2, rx: -Math.sin(a) * 0.2, outline: false });
    }
    for (let k = 0; k < 7; k++) this.embers.push(part(set, ball(0.045, 0), P.ember, bbq.x + (rand() - 0.5) * 0.42, 0.665, bbq.z + (rand() - 0.5) * 0.42, { glow: 2.2, outline: false, shadow: false }));
    pool(P.ember, bbq.x, bbq.z, 2.2, 0.3);
    // Garden lamps along the flower bed, each with its pool of light.
    for (const x of [-W + 0.4, 0, W - 0.4]) {
      put(props.gardenLamp({ h: 1.0 }), x, 0, -D - 0.3);
      pool(P.lamp, x, -D + 0.5, 4.2, 0.36);
    }

    // Beyond the fence on the left: the patio corner, with somewhere to sit out a round.
    part(set, rbox(2.6, 0.05, 4.4, 0.02), P.stone, -W - 2.1, 0.005, 0.2, { tex: 'stoneTiles', outline: false, shadow: false });
    put(props.armchair({ color: P.denim, pillow: P.mustard }), -W - 2.4, 0, -0.9, Math.PI / 2 - 0.3, 1.15);
    put(props.sideTable({ h: 0.5, r: 0.3 }), -W - 2.3, 0, 0.4);
    put(props.candle({ h: 0.14 }), -W - 2.3, 0.5, 0.4);
    put(props.pouf({ color: P.terracotta }), -W - 1.5, 0, 1.3, 0, 1.3);
    put(props.plant({ kind: 'monstera', h: 0.9, pot: P.ceramic, seed: 3 }), -W - 2.9, 0, 1.9);
    put(props.gardenLamp({ h: 0.7 }), -W - 1.2, 0, -1.9);
    pool(P.lamp, -W - 1.6, -1.6, 3.4, 0.3);
    pool(P.lamp, -W - 2.3, 0.5, 2.2, 0.22);
    // And little things past the other edges.
    put(props.plant({ kind: 'fern', h: 0.6, pot: P.terracotta, seed: 4 }), W + 0.9, 0, 2.6);
    put(props.crate({ s: 0.5 }), W + 1.0, 0, -1.2, 0.3);
    put(props.bush({ r: 0.6, flowers: P.mustard, seed: 9 }), -3.8, 0, D + 1.5);
    put(props.bush({ r: 0.5, flowers: P.rose, seed: 12 }), 4.6, 0, D + 1.7);
    this.tick = props.tickProps(set);
    return env;
  }

  head(p: number): THREE.Vector3 {
    const r = this.rigs[p];
    const v = r ? r.c.root.position.clone() : new THREE.Vector3();
    v.y = HEIGHT + 0.65;
    return v;
  }

  setMood(p: number, mood: CompanionMood): void {
    const r = this.rigs[p];
    if (!r || r.mood === mood) return;
    r.mood = mood;
    r.c.setBase(mood);
  }

  /** A chaser swings: the reach ring flashes at their feet. */
  swing(p: number): void {
    const r = this.rigs[p];
    if (r) r.flashAge = 0;
  }

  /** A runner is tagged: a burst of sparks in the chasers' colour. */
  tagged(runner: number, color: string): void {
    const at = this.head(runner);
    at.y = HEIGHT * 0.5;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const mesh = part(this.scene, gem(0.06), color, at.x, at.y, at.z, { glow: 1.4, shadow: false });
      this.sparks.push({ mesh, v: new THREE.Vector3(Math.cos(a) * 2.2, 1.6 + Math.random(), Math.sin(a) * 2.2), age: 0 });
    }
  }

  /** Puts everyone where the garden says. `snap`: no easing (a new round). */
  sync(y: Yard, dt: number, snap = false): void {
    const follow = snap ? 1 : 1 - Math.exp(-dt * 18);
    y.players.forEach((pl, p) => {
      const r = this.rigs[p];
      if (!r || pl.team < 0) return;
      const root = r.c.root;
      root.position.x += (pl.x - root.position.x) * follow;
      root.position.z += (pl.z - root.position.z) * follow;
      const speed = Math.hypot(pl.vx, pl.vz);
      const turn = Math.atan2(Math.sin(pl.face - root.rotation.y), Math.cos(pl.face - root.rotation.y));
      root.rotation.y += snap ? turn : turn * Math.min(1, dt * 12);
      const motion = speed < 0.3 ? null : speed > 2.2 ? 'run' : 'walk';
      if (motion !== r.motion) {
        r.motion = motion;
        r.c.move(motion, speed);
      }
      const chaser = pl.team === y.chasing;
      // The glow stick: full while lit, dim for a few seconds after a tag.
      const lit = pl.dim > 0 ? 0.15 : 1;
      r.glow += (lit - r.glow) * (1 - Math.exp(-dt * 8));
      r.light.intensity = 3.2 * r.glow;
      r.poolMat.opacity = 0.15 + 0.45 * r.glow;
      r.stick.material = pl.dim > 0 ? material(mix(r.teamColor, '#202030', 0.65), { glow: 0.3 }) : material(r.teamColor, { glow: 1.6 });
      const x = root.position.x;
      const z = root.position.z;
      r.pool.position.set(x, 0.02, z);
      r.ring.position.set(x, 0.03, z);
      r.itRing.visible = chaser;
      r.marker.visible = chaser;
      if (chaser) {
        const ready = pl.cool === 0;
        r.itRing.position.set(x, 0.04, z);
        r.itRing.scale.setScalar(ready ? 1 + Math.sin(this.time * 6) * 0.06 : 0.75);
        r.marker.position.set(x, HEIGHT + 0.95 + Math.sin(this.time * 4 + p) * 0.06, z);
      }
      r.card.position.set(x, HEIGHT + 0.55, z);
      r.flash.position.set(x, 0.05, z);
    });
  }

  dispose(): void {
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
    for (const o of this.owned) o.dispose();
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.fit.update(() => this.marks);
    this.env.update(dt, time);
    this.tick(dt, time);
    // The set breathes: the barbecue's embers pulse.
    this.embers.forEach((e, i) => e.scale.setScalar(0.8 + 0.35 * Math.abs(Math.sin(time * 1.7 + i * 1.3))));
    for (const c of this.companions) c.update(dt);
    this.floaters.update(dt);
    for (const r of this.rigs) {
      if (!r) continue;
      r.flashAge += dt;
      const k = Math.min(1, r.flashAge / 0.3);
      r.flashMat.opacity = (1 - k) * 0.8;
      r.flash.scale.setScalar(0.55 + 0.45 * k);
      r.flash.visible = k < 1;
    }
    this.sparks = this.sparks.filter((sp) => {
      sp.age += dt;
      sp.v.y -= 6 * dt;
      sp.mesh.position.addScaledVector(sp.v, dt);
      sp.mesh.rotation.y += dt * 8;
      sp.mesh.scale.setScalar(Math.max(0.01, 1 - sp.age / 0.6));
      if (sp.age < 0.6) return true;
      sp.mesh.removeFromParent();
      return false;
    });
    this.cricketIn -= dt;
    if (this.cricketIn <= 0) {
      this.cricketIn = 1 + Math.random() * 2;
      cricket(this.sfx);
    }
  }
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'glowtag',
  title: 'Glow Tag',
  how: 'Tag in the dark! When your team is it, get close to a runner and press Tag; a tagged runner’s glow stick dims for a few seconds. Teams swap every round, two rounds each, and the most tags wins.',
  controller: 'stick',
  kind: '2v2',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    const teams = teamsOf(ctx);
    const seatOf = (p: number) => seats[p]?.index ?? p;
    const cpu = (p: number) => session.isCpu(seatOf(p));
    const yard = newYard(teams, seats.length, rng() < 0.5 ? 0 : 1);
    const view = new NightGarden(seats, teams, await Promise.all(seats.map((s) => buildCompanion(s.look, { height: HEIGHT }))), sfx);
    ctx.stage.setView(view);

    const posOf = new Map(seats.map((s, i) => [s.index, i] as const));
    const nameOf = (p: number) => seats[p]?.name ?? 'someone';
    const teamName = (members: number[]) => members.map(nameOf).join(' & ');
    const partnerOf = (p: number) => teams[yard.players[p]?.team ?? -1]?.find((q) => q !== p);
    const tell = (p: number, good: boolean, text: string) => session.send(seatOf(p), { t: 'feedback', good, text });
    const buzz = (p: number, pattern: number[]) => session.send(seatOf(p), { t: 'buzz', pattern });
    const brains: (CpuTagger | null)[] = seats.map((_, p) => (cpu(p) ? newCpuTagger(ctx.skill(), rng) : null));
    const sticks: Stick[] = seats.map(() => ({ ...IDLE }));
    const held = seats.map(() => false);
    /** Presses waiting for the next frame, with how long they took to arrive. */
    let presses: { p: number; lag: number }[] = [];
    let live = false;

    const off = session.onInput((seat, msg) => {
      if (msg.t !== 'stick' || session.isCpu(seat)) return;
      const p = posOf.get(seat);
      if (p === undefined) return;
      sticks[p] = { x: msg.x, y: msg.y };
      if (msg.a && !held[p] && live) presses.push({ p, lag: Math.min(TAG.lagMax, Math.max(0, session.seats[seat]?.rtt ?? 0) / 2000) * clock.speed });
      held[p] = msg.a;
    });

    const hud = () =>
      ui.live(
        teams.map((members, k) => {
          const lead = seats[members[0] ?? 0];
          const n = yard.score[k === 0 ? 0 : 1];
          return { name: teamName(members), color: lead?.color ?? '#fff', thumb: lead?.thumb ?? null, value: `${n} tag${n === 1 ? '' : 's'}${yard.chasing === k ? ' · it' : ''}` };
        }),
      );

    for (let round = 0; round < TAG.rounds; round++) {
      startRound(yard, round);
      presses = [];
      for (let p = 0; p < sticks.length; p++) sticks[p] = { ...IDLE };
      const it = teams[yard.chasing] ?? [];
      const itName = teamName(it);
      const itColor = seats[it[0] ?? 0]?.color ?? '#ffffff';
      seats.forEach((s, p) => {
        const partner = partnerOf(p);
        const head = `Round ${round + 1} of ${TAG.rounds} · `;
        const chasing = isChaser(yard, p);
        const note = chasing
          ? `${head}${partner === undefined ? 'You’re it!' : `You and ${nameOf(partner)} are it!`} Get close to a runner and press Tag.`
          : `${head}Run! ${itName} ${it.length > 1 ? 'are' : 'is'} it.${partner === undefined ? '' : ` Keep away together with ${nameOf(partner)}.`}`;
        session.setLayout(s.index, { kind: 'stick', button: chasing ? 'Tag' : null, note });
      });
      view.sync(yard, 0, true);
      for (const [p, pl] of yard.players.entries()) view.setMood(p, pl.team === yard.chasing ? 'thinking' : 'listening');
      ui.caption(`Round ${round + 1} of ${TAG.rounds}: ${itName} ${it.length > 1 ? 'are' : 'is'} it!`, itColor);
      ui.timer(TAG.round);
      hud();
      view.floaters.add('Ready…', itColor, new THREE.Vector3(0, 2.2, 0), 0.6, PAUSE - 0.2);
      await clock.wait(PAUSE);
      sfx.go();
      view.floaters.add('Go!', itColor, new THREE.Vector3(0, 2.2, 0), 0.7, 0.9);
      live = true;

      let hudAt = -1;
      await everyFrame(clock, (dt) => {
        // Presses first, judged where each phone saw the garden.
        const cpuInputs = seats.map((_, p) => {
          const b = brains[p];
          return b ? cpuTag(b, yard, p, rng, Math.min(dt, 0.25)) : null;
        });
        cpuInputs.forEach((c, p) => {
          if (c?.a) presses.push({ p, lag: 0 });
        });
        for (const { p, lag } of presses) {
          const res = pressTag(yard, p, lag);
          if (res.kind === 'tag') {
            const runner = res.runner;
            view.swing(p);
            view.tagged(runner, itColor);
            zap(sfx);
            view.floaters.add('Tagged!', itColor, view.head(runner), 0.42, 1.1);
            view.rigs[p]?.c.react('happy', 0.9);
            view.rigs[runner]?.c.react('sad', 1.4);
            tell(p, true, `Tagged ${nameOf(runner)}! +1`);
            tell(runner, false, `${nameOf(p)} tagged you! Your glow comes back in ${TAG.dim} s.`);
            buzz(p, [20]);
            buzz(runner, [80, 40, 80]);
          } else if (res.kind === 'whiff') {
            view.swing(p);
            swish(sfx);
          }
        }
        presses = [];
        const inputs = seats.map((_, p) => {
          const c = cpuInputs[p];
          return c ? { x: c.x, y: c.y } : (sticks[p] ?? IDLE);
        });
        for (const p of stepYard(yard, inputs, dt)) {
          relight(sfx);
          tell(p, true, 'Your glow is back. Run!');
        }
        view.sync(yard, dt);
        if (yard.clock - hudAt >= 0.1) {
          hudAt = yard.clock;
          ui.timer(TAG.round - yard.clock);
          hud();
        }
        return roundOver(yard);
      });
      live = false;
      for (const r of view.rigs) r?.c.move(null);
      for (const r of view.rigs) if (r) r.motion = null;
      if (round < TAG.rounds - 1) {
        sfx.whoosh();
        ui.caption('Swap! The runners are it next.');
        for (let p = 0; p < sticks.length; p++) sticks[p] = { ...IDLE };
        await clock.wait(0.9);
      }
    }
    off();
    ui.timer(null);
    ui.caption(null);

    // Done: the team with the most tags cheers.
    const [a, b] = yard.score;
    const tie = teams.length > 1 && a === b;
    sfx.good();
    teams.forEach((members, k) => {
      const mine = yard.score[k === 0 ? 0 : 1];
      const won = mine === Math.max(a, b);
      for (const p of members) {
        view.setMood(p, tie ? 'approval' : won ? 'happy' : 'sad');
        if (won && !tie) view.rigs[p]?.c.react('happy', 3);
        tell(p, won, tie ? 'Time! Exactly as many tags each.' : won ? 'Time! Your team made the most tags!' : 'Time! They made more tags.');
      }
      if (won && !tie && members[0] !== undefined) view.floaters.add('Brightest team!', '#fff6a8', view.head(members[0]), 0.55, 2.4);
    });
    hud();
    await clock.wait(1.6);

    return {
      scores: tagScores(yard),
      details: seats.map((_, p) => tagDetail(yard, p)),
    };
  },
};
