// The dice: a real 3D die that is thrown from the player's companion, tumbles through the air, bounces twice,
// tips over one last edge and comes to rest showing the rolled value, then leaps up and becomes a big number
// above the player.
//
// The motion is planned backwards from the result, so it always lands on the right face without a physics
// engine: the die ends flat on its value; before that it tips over an edge (a pivot about that edge); before that
// each bounce is a free flight with a constant spin about a fixed axis (which is exactly how a cube spins in the
// air) and a parabola between the two contact heights. Contact heights come from the die's orientation at that
// moment, so a corner or an edge really touches the ground.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Clock, ease } from '../anim';
import { FONT, PALETTE as P, addOutline, canvasTexture, mix, toonMat } from '../render/toon';

const UP = new THREE.Vector3(0, 1, 0);

/** Which way each value's face points on the die (opposite faces add up to seven). */
const FACE: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(0, 0, 1),
  5: new THREE.Vector3(0, 0, -1),
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
};

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

let bodyGeo: THREE.BufferGeometry | null = null;
let pipGeo: THREE.BufferGeometry | null = null;

/** All 21 pips of a unit die as one geometry: little enamel domes set into the faces. */
function pipsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let value = 1; value <= 6; value++) {
    const n = FACE[value] as THREE.Vector3;
    q.setFromUnitVectors(UP, n);
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    for (const [a, b] of PIPS[value] as [number, number][]) {
      const r = value === 1 ? 0.125 : 0.088;
      const g = new THREE.SphereGeometry(r, 18, 10);
      const at = n.clone().multiplyScalar(0.492).addScaledVector(u, a * 0.245).addScaledVector(v, b * 0.245);
      m.compose(at, q, new THREE.Vector3(1, 0.32, 1));
      g.applyMatrix4(m);
      parts.push(g);
    }
  }
  return mergeGeometries(parts, false);
}

/** A die of the given edge length: a rounded cube in the player's colour with cream pips. */
export function createDie(color: string, size: number): THREE.Group {
  bodyGeo ??= new RoundedBoxGeometry(1, 1, 1, 6, 0.17);
  pipGeo ??= pipsGeometry();
  const g = new THREE.Group();
  g.name = 'die';
  const deep = mix(color, P.ink, 0.1);
  const body = new THREE.Mesh(bodyGeo, toonMat({ color: deep }, { gloss: 0.28, grain: 0.04 }));
  body.castShadow = true;
  addOutline(body, deep, 0.05 / size);
  const pips = new THREE.Mesh(pipGeo, toonMat({ color: '#fff6e6' }, { gloss: 0.15, grain: 0, rim: 0 }));
  pips.castShadow = false;
  g.add(body, pips);
  g.scale.setScalar(size);
  return g;
}

/** The orientation that shows `value` on top, with the die's sides square to the direction it rolled in. */
function restingQuaternion(value: number, dir: THREE.Vector3, quarterTurns: number): THREE.Quaternion {
  const up = new THREE.Quaternion().setFromUnitVectors(FACE[value] as THREE.Vector3, UP);
  if (value === 6) up.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const yaw = Math.atan2(dir.x, dir.z) + (quarterTurns * Math.PI) / 2;
  return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(up);
}

/** How high the centre of a unit die sits when its lowest corner touches the ground. */
function restHeight(q: THREE.Quaternion): number {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  return 0.5 * (Math.abs(m[1] as number) + Math.abs(m[5] as number) + Math.abs(m[9] as number));
}

interface Arc {
  t0: number;
  t1: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  atelier: number;
  axis: THREE.Vector3;
  spin: number;
  endQ: THREE.Quaternion;
}

export interface ThrowOptions {
  /** Where the die leaves the companion. */
  start: THREE.Vector3;
  /** The point on the ground where it first lands. */
  land: THREE.Vector3;
  /** Height of the ground it lands on. */
  ground: number;
  value: number;
  size: number;
  rand: () => number;
}

/** One planned throw. `sample(t)` places the die; `impacts` are the moments it touches the ground. */
export class DieThrow {
  readonly duration: number;
  /** Time and strength (1 = the first landing) of every touch-down. */
  readonly impacts: { t: number; strength: number; at: THREE.Vector3 }[] = [];
  readonly rest: THREE.Vector3;
  private arcs: Arc[] = [];
  private tipStart: number;
  private tipEnd: number;
  private edge: THREE.Vector3;
  private dir: THREE.Vector3;
  private rollAxis: THREE.Vector3;
  private restQ: THREE.Quaternion;
  private size: number;
  private ground: number;
  private static readonly TIP_FROM = (36 * Math.PI) / 180;

  constructor(o: ThrowOptions) {
    const s = o.size;
    this.size = s;
    this.ground = o.ground;
    const dir = o.land.clone().sub(o.start).setY(0).normalize();
    this.dir = dir;
    // Rolling forward along `dir` is a turn about this axis.
    const a = new THREE.Vector3().crossVectors(UP, dir).normalize();
    this.rollAxis = a;
    this.restQ = restingQuaternion(o.value, dir, Math.floor(o.rand() * 4));

    // Lengths and times of the three flights, then the tip over the last edge.
    const times = [0.78 + o.rand() * 0.06, 0.46 + o.rand() * 0.05, 0.27 + o.rand() * 0.03];
    const hops = [0, 0.5 + o.rand() * 0.2, 0.28 + o.rand() * 0.08];
    const atelier = [o.ground + 3.5 + o.rand() * 0.4, 1.05 + o.rand() * 0.2, 0.34 + o.rand() * 0.06];
    const spins = [13 + o.rand() * 4, 9 + o.rand() * 2.5, 6.5 + o.rand() * 1.5];
    const tip = 0.24;

    const p1 = o.land.clone().setY(o.ground);
    const p2 = p1.clone().addScaledVector(dir, hops[1] as number);
    const p3 = p2.clone().addScaledVector(dir, hops[2] as number);
    // The edge it tips over: the die's centre is a little behind it when it lands for the last time.
    const k = s / Math.SQRT2;
    const th0 = DieThrow.TIP_FROM;
    this.edge = p3.clone().addScaledVector(dir, k * Math.cos(Math.PI / 4 + th0));
    this.rest = this.edge.clone().addScaledVector(dir, s / 2).setY(o.ground + s / 2);

    // Orientations, backwards from the end.
    const tipQ = this.tipQuaternion(th0);
    const ends: THREE.Quaternion[] = [new THREE.Quaternion(), new THREE.Quaternion(), tipQ];
    const axes: THREE.Vector3[] = [];
    for (let i = 2; i >= 0; i--) {
      const wild = i === 2 ? 0.18 : i === 1 ? 0.5 : 0.9;
      const axis = a.clone().add(new THREE.Vector3((o.rand() - 0.5) * wild, (o.rand() - 0.5) * wild * 1.4, (o.rand() - 0.5) * wild)).normalize();
      axes[i] = axis;
      if (i > 0) {
        const back = new THREE.Quaternion().setFromAxisAngle(axis, -(spins[i] as number) * (times[i] as number));
        (ends[i - 1] as THREE.Quaternion).copy(back.multiply(ends[i] as THREE.Quaternion));
      }
    }
    const contact = (q: THREE.Quaternion) => o.ground + restHeight(q) * s;
    const points = [
      o.start.clone(),
      p1.clone().setY(contact(ends[0] as THREE.Quaternion)),
      p2.clone().setY(contact(ends[1] as THREE.Quaternion)),
      p3.clone().setY(o.ground + k * Math.sin(Math.PI / 4 + th0)),
    ];
    let t = 0;
    for (let i = 0; i < 3; i++) {
      const from = points[i] as THREE.Vector3;
      const to = points[i + 1] as THREE.Vector3;
      const top = i === 0 ? (atelier[0] as number) : Math.max(from.y, to.y) + (atelier[i] as number);
      this.arcs.push({ t0: t, t1: t + (times[i] as number), from, to, atelier: top, axis: axes[i] as THREE.Vector3, spin: spins[i] as number, endQ: ends[i] as THREE.Quaternion });
      t += times[i] as number;
      this.impacts.push({ t, strength: [1, 0.6, 0.35][i] as number, at: to.clone().setY(o.ground) });
    }
    this.tipStart = t;
    this.tipEnd = t + tip;
    this.impacts.push({ t: this.tipEnd, strength: 0.5, at: this.rest.clone().setY(o.ground) });
    this.duration = this.tipEnd + 0.16;
  }

  /** The die while it pivots over its last edge; `theta` runs from 0 (flat, before the edge) to 90° (at rest). */
  private tipQuaternion(theta: number): THREE.Quaternion {
    return new THREE.Quaternion().setFromAxisAngle(this.rollAxis, -(Math.PI / 2 - theta)).multiply(this.restQ);
  }

  sample(t: number, die: THREE.Object3D): void {
    const s = this.size;
    if (t >= this.tipStart) {
      const u = Math.min(1, (t - this.tipStart) / (this.tipEnd - this.tipStart));
      // It arrives with some spin left, hangs on the edge for a moment, then drops.
      const e = 0.55 * u + 0.45 * u * u * u;
      const theta = DieThrow.TIP_FROM + (Math.PI / 2 - DieThrow.TIP_FROM) * e;
      const k = s / Math.SQRT2;
      die.position.copy(this.edge).addScaledVector(this.dir, -k * Math.cos(Math.PI / 4 + theta));
      die.position.y = this.ground + k * Math.sin(Math.PI / 4 + theta);
      die.quaternion.copy(this.tipQuaternion(theta));
      // The thunk as it comes to rest: a tiny squash that springs back.
      const after = Math.max(0, t - this.tipEnd) / (this.duration - this.tipEnd);
      const squash = t > this.tipEnd ? Math.sin(Math.min(1, after) * Math.PI) * 0.07 * (1 - after) : 0;
      die.scale.set(s * (1 + squash), s * (1 - squash * 1.4), s * (1 + squash));
      die.position.y -= squash * 0.7 * s;
      return;
    }
    const arc = this.arcs.find((x) => t < x.t1) ?? (this.arcs[2] as Arc);
    const dur = arc.t1 - arc.t0;
    const u = Math.min(1, Math.max(0, (t - arc.t0) / dur));
    // A parabola through the two contact heights with its top at `atelier`: the gravity follows from the time.
    const up = Math.sqrt(Math.max(0, 2 * (arc.atelier - arc.from.y)));
    const down = Math.sqrt(Math.max(0, 2 * (arc.atelier - arc.to.y)));
    const g = ((up + down) / dur) ** 2;
    const tt = u * dur;
    const v0 = up * Math.sqrt(g);
    die.position.lerpVectors(arc.from, arc.to, u);
    die.position.y = arc.from.y + v0 * tt - 0.5 * g * tt * tt;
    die.quaternion.setFromAxisAngle(arc.axis, -arc.spin * (arc.t1 - t)).multiply(arc.endQ);
    die.position.y = Math.max(die.position.y, this.ground + restHeight(die.quaternion) * s);
    // It grows out of the companion's hands in the first instant.
    const grow = arc === this.arcs[0] ? Math.min(1, 0.35 + (t / 0.14) * 0.65) : 1;
    die.scale.setScalar(s * grow);
  }
}

// ------------------------------------------------------------------ sprites

/** The big number the die turns into: heavy cream type on a soft glow in the player's colour. */
export function numberSprite(text: string, color: string, height = 2.1): THREE.Sprite {
  const texture = canvasTexture(384, 320, (g) => {
    const halo = g.createRadialGradient(192, 160, 10, 192, 160, 158);
    const c = new THREE.Color(color);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    halo.addColorStop(0, `rgba(${rgb},0.75)`);
    halo.addColorStop(0.45, `rgba(${rgb},0.32)`);
    halo.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = halo;
    g.fillRect(0, 0, 384, 320);
    g.font = `800 ${text.length > 1 ? 200 : 230}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.shadowColor = 'rgba(10,8,18,0.5)';
    g.shadowBlur = 14;
    g.shadowOffsetY = 8;
    g.lineWidth = 22;
    g.strokeStyle = '#1e1826';
    g.strokeText(text, 192, 172);
    g.shadowColor = 'transparent';
    g.lineWidth = 9;
    g.strokeStyle = mix(color, '#1e1826', 0.25);
    g.strokeText(text, 192, 172);
    const fill = g.createLinearGradient(0, 70, 0, 270);
    fill.addColorStop(0, '#fffaf0');
    fill.addColorStop(1, mix('#fff1d6', color, 0.28));
    g.fillStyle = fill;
    g.fillText(text, 192, 172);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, fog: false }));
  sprite.scale.set((384 / 320) * height, height, 1);
  sprite.userData.aspect = 384 / 320;
  sprite.userData.height = height;
  sprite.renderOrder = 12;
  return sprite;
}

/** A bonus chip ("+3" from an Energy Drink): a dark pill with a bolt and mint lettering. */
export function bonusSprite(text: string, height = 0.95): THREE.Sprite {
  const mint = '#7ef0c8';
  const texture = canvasTexture(384, 192, (g) => {
    g.shadowColor = 'rgba(126,240,200,0.55)';
    g.shadowBlur = 22;
    g.fillStyle = 'rgba(24,20,32,0.94)';
    g.beginPath();
    g.roundRect(34, 36, 316, 120, 60);
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = mint;
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(36.5, 38.5, 311, 115, 57);
    g.stroke();
    // the bolt
    g.fillStyle = '#ffd86b';
    g.beginPath();
    g.moveTo(112, 58);
    g.lineTo(78, 104);
    g.lineTo(100, 104);
    g.lineTo(88, 136);
    g.lineTo(126, 88);
    g.lineTo(104, 88);
    g.closePath();
    g.fill();
    g.font = `800 84px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = mint;
    g.fillText(text, 228, 100);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, fog: false }));
  sprite.scale.set(2 * height, height, 1);
  sprite.userData.aspect = 2;
  sprite.userData.height = height;
  sprite.renderOrder = 13;
  return sprite;
}

let ringTexture: THREE.Texture | null = null;
function softRing(): THREE.Texture {
  ringTexture ??= canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 30, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.62, 'rgba(255,255,255,0)');
    grad.addColorStop(0.8, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  return ringTexture;
}

let sparkTexture: THREE.Texture | null = null;
function spark(): THREE.Texture {
  sparkTexture ??= canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  return sparkTexture;
}

// ------------------------------------------------------------------ the whole roll

export interface RollOptions {
  /** The companion's feet. */
  origin: THREE.Vector3;
  /** Unit vector on the ground: the way the die is thrown. */
  dir: THREE.Vector3;
  /** The middle of the space the companion stands on (the dice land `reach` from here). */
  centre: THREE.Vector3;
  /** Height of the ground the die lands on. */
  ground: number;
  /** How far from the companion the die first lands. */
  reach: number;
  values: number[];
  bonus: number;
  color: string;
  /** Where the big number hangs: above the companion's head. */
  head: THREE.Vector3;
  /** Sounds, in step with the picture. */
  onThrow?: () => void;
  onBounce?: (strength: number) => void;
  onReveal?: () => void;
  onBonus?: () => void;
  /** Called when the dice have come to rest (the camera can ease back). */
  onRest?: () => void;
}

const DIE_SIZE = 0.92;

/** Runs dice rolls in a scene. One at a time. */
export class DiceRoller {
  private seed = 1;
  private leftovers = new Set<THREE.Object3D>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly clock: Clock,
  ) {}

  private rand = (): number => {
    // Cosmetic only (the result is decided by the game), so a tiny generator of its own will do.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  /** A flat ring on the ground that spreads and fades where the die lands. */
  private puff(at: THREE.Vector3, strength: number): void {
    const mat = new THREE.MeshBasicMaterial({ map: softRing(), color: new THREE.Color('#fff1d6'), transparent: true, depthWrite: false, opacity: 0.7 });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(at).setY(at.y + 0.03);
    ring.renderOrder = 3;
    this.scene.add(ring);
    this.leftovers.add(ring);
    void this.clock
      .tween(0.34, (k) => {
        ring.scale.setScalar(0.5 + k * (1.1 + strength * 1.3));
        mat.opacity = 0.55 * strength * (1 - k) + 0.08 * (1 - k);
      }, ease.outCubic)
      .then(() => this.drop(ring));
  }

  /** A burst of sparks in the player's colour, for the moment the number appears. */
  private burst(at: THREE.Vector3, color: string, n = 10, reach = 1.5): void {
    const group = new THREE.Group();
    group.position.copy(at);
    const mats: THREE.SpriteMaterial[] = [];
    const dirs: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color(i % 3 === 0 ? '#fff4de' : color).multiplyScalar(1.5);
      const m = new THREE.SpriteMaterial({ map: spark(), color: c, transparent: true, depthTest: false, blending: THREE.AdditiveBlending, fog: false });
      const s = new THREE.Sprite(m);
      const a = (i / n) * Math.PI * 2 + this.rand();
      dirs.push(new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.9 + 0.15, 0).multiplyScalar(reach * (0.6 + this.rand() * 0.6)));
      s.scale.setScalar(0.34 + this.rand() * 0.2);
      s.renderOrder = 11;
      mats.push(m);
      group.add(s);
    }
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: softRing(), color: new THREE.Color(color).multiplyScalar(1.3), transparent: true, depthTest: false, fog: false }));
    ring.renderOrder = 11;
    group.add(ring);
    this.scene.add(group);
    this.leftovers.add(group);
    void this.clock
      .tween(0.55, (k) => {
        group.children.forEach((s, i) => {
          if (s === ring) return;
          s.position.copy(dirs[i] as THREE.Vector3).multiplyScalar(k);
          s.position.y -= k * k * 0.5;
          (mats[i] as THREE.SpriteMaterial).opacity = 1 - k * k;
        });
        ring.scale.setScalar(0.8 + k * reach * 2.4);
        ring.material.opacity = 0.75 * (1 - k);
      }, ease.outCubic)
      .then(() => this.drop(group));
  }

  private drop(o: THREE.Object3D): void {
    this.scene.remove(o);
    this.leftovers.delete(o);
    o.traverse((x) => {
      const m = (x as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !Array.isArray(m) && x.name !== 'outline') {
        const map = (m as THREE.SpriteMaterial).map;
        if (map && map !== ringTexture && map !== sparkTexture) map.dispose();
        m.dispose();
      }
    });
  }

  /** Removes anything still on screen (when the board is left mid-roll). */
  clear(): void {
    for (const o of [...this.leftovers]) this.drop(o);
  }

  private pop(sprite: THREE.Sprite, k: number): void {
    const h = sprite.userData.height as number;
    sprite.scale.set((sprite.userData.aspect as number) * h * k, h * k, 1);
  }

  /**
   * The whole roll: throw, tumble, bounce, rest, then the dice leap up and become the number (plus the bonus).
   * Resolves when the number has been shown; it fades by itself afterwards.
   */
  async roll(o: RollOptions): Promise<void> {
    const { clock, scene } = this;
    const side = new THREE.Vector3().crossVectors(UP, o.dir).normalize();
    const n = o.values.length;
    const dice = o.values.map((value, i) => {
      const spread = n > 1 ? (i - (n - 1) / 2) * 1.3 : 0;
      const die = createDie(o.color, DIE_SIZE);
      const start = o.origin.clone().addScaledVector(o.dir, 0.42).addScaledVector(side, spread * 0.3);
      start.y += 1.15;
      const land = o.centre.clone().addScaledVector(o.dir, o.reach + (n > 1 ? (i ? 0.1 : -0.1) : 0)).addScaledVector(side, spread + (this.rand() - 0.5) * 0.24);
      const plan = new DieThrow({ start, land, ground: o.ground, value, size: DIE_SIZE, rand: this.rand });
      die.visible = false;
      scene.add(die);
      this.leftovers.add(die);
      return { die, plan, delay: i * 0.085, value };
    });

    // Throw and tumble.
    o.onThrow?.();
    const total = Math.max(...dice.map((d) => d.plan.duration + d.delay));
    const fired = new Set<string>();
    let rested = false;
    await clock.tween(total, (k) => {
      const t = k * total;
      dice.forEach((d, i) => {
        const local = t - d.delay;
        if (local < 0) return;
        d.die.visible = true;
        d.plan.sample(Math.min(local, d.plan.duration), d.die);
        d.plan.impacts.forEach((hit, j) => {
          const key = `${i}:${j}`;
          if (local >= hit.t && !fired.has(key)) {
            fired.add(key);
            this.puff(hit.at, hit.strength);
            o.onBounce?.(hit.strength);
          }
        });
      });
      if (!rested && k >= 1) {
        rested = true;
        o.onRest?.();
      }
    }, ease.linear);

    // A beat to read the faces.
    await clock.wait(0.42);

    // The dice leap up to the player's head, spinning and shrinking into the number.
    const from = dice.map((d) => ({ p: d.die.position.clone(), q: d.die.quaternion.clone() }));
    const spinAxis = new THREE.Vector3(0.3, 1, 0.2).normalize();
    const turn = new THREE.Quaternion();
    await clock.tween(0.34, (k) => {
      dice.forEach((d, i) => {
        const f = from[i] as { p: THREE.Vector3; q: THREE.Quaternion };
        d.die.position.lerpVectors(f.p, o.head, k);
        d.die.position.y += Math.sin(k * Math.PI) * 0.9;
        d.die.quaternion.copy(turn.setFromAxisAngle(spinAxis, k * Math.PI * 3).multiply(f.q));
        d.die.scale.setScalar(DIE_SIZE * (1 - k * 0.7));
      });
    }, (t) => t * t * (3 - 2 * t));
    for (const d of dice) this.drop(d.die);

    const sum = o.values.reduce((a, b) => a + b, 0);
    let number = numberSprite(String(sum), o.color);
    number.position.copy(o.head);
    scene.add(number);
    this.leftovers.add(number);
    this.burst(o.head, o.color);
    o.onReveal?.();
    await clock.tween(0.3, (k) => this.pop(number, k), ease.outBack);

    if (o.bonus) {
      // The Energy Drink: a "+3" chip pops up beside the number, hangs for a beat, then slams into it.
      await clock.wait(0.22);
      const chip = bonusSprite(`+${o.bonus}`);
      const beside = o.head.clone().add(new THREE.Vector3(1.75, 0.55, 0));
      chip.position.copy(beside);
      scene.add(chip);
      this.leftovers.add(chip);
      o.onBonus?.();
      await clock.tween(0.26, (k) => this.pop(chip, k), ease.outBack);
      await clock.wait(0.4);
      await clock.tween(0.2, (k) => {
        chip.position.lerpVectors(beside, o.head, k * k);
        this.pop(chip, 1 - k * 0.6);
      }, ease.linear);
      this.drop(chip);
      this.drop(number);
      number = numberSprite(String(sum + o.bonus), o.color);
      number.position.copy(o.head);
      scene.add(number);
      this.leftovers.add(number);
      this.burst(o.head, '#7ef0c8', 12, 1.8);
      o.onReveal?.();
      await clock.tween(0.3, (k) => this.pop(number, 1.35 - 0.35 * k), ease.outBack);
    }
    await clock.wait(0.5);

    // The number lifts away by itself while the companion sets off.
    const shown = number;
    const base = shown.position.clone();
    void clock
      .tween(0.4, (k) => {
        shown.position.copy(base).setY(base.y + k * 0.9);
        shown.material.opacity = 1 - k;
        this.pop(shown, 1 - k * 0.25);
      }, ease.outCubic)
      .then(() => this.drop(shown));
  }
}
