// The kit the coffee-table games share (Coaster Hockey, Paper Football, Coffee Table Memory, Slap Dot): the phones
// lie flat on the coffee table and are the playfield; the TV shows the living room, the table and every phone with
// its screen mirrored.
//
// In here: the colours and shapes a table-game phone draws, a phone lying on the table, the room around the table,
// the "two phones top to top" flow (TableView and TableGame), and the pieces for games that lay the phones out
// their own way (a diagram card on the TV, laying the phones out, a count-in).
import * as THREE from 'three';
import { loadCompanionConfig } from '../../companion/config';
import { type Companion, buildCompanion } from '../../companion/kit';
import { type MatchOutcome, PHONE_L, type Side, type TablePlan, advancer, planTable, tableScores, toPhone } from '../../game/minigames/coasterhockey';
import { type CompanionLook, type CompanionMood, DEFAULT_LOOK, SEAT_COLORS } from '../../shared/look';
import type { PhoneMsg, SceneItem } from '../../shared/protocol';
import { type Env, livingRoom } from '../render/env';
import * as props from '../render/props';
import { FONT, PALETTE as P, canvasTexture, cyl, mix, nameCard, part, rbox, torus } from '../render/toon';
import type { View } from '../stage';
import { CameraFit, Floaters, type Mark, SAFE, SceneStream, lanes } from './kit';
import { type MinigameContext, type MinigameResult, everyFrame } from './types';

// ================================================================== sizes

/** World units per phone width, for the games that lay two phones top to top. */
export const S = 1.5;
/** The gap between two phones' screens where their tops touch (two thin bezels). */
const GAP = 0.05;
const TOP_BEZEL = GAP / 2;
const BOTTOM_BEZEL = 0.14;
const SIDE_BEZEL = 0.06;
/** The coffee table's top, and the phones' screens lying on it. */
export const TABLE_Y = 0.55;
export const SCREEN_Y = TABLE_Y + 0.075;
const BODY_H = 0.07;
const GLASS_Y = 0.0712; // the screen, in a phone's own group
const STRIP_Z = 1.3; // two matches: one strip of phones this far in front of the middle, one this far behind
const END_X = PHONE_L * S + GAP / 2 + BOTTOM_BEZEL + 1.05; // players stand this far left and right of the middle
const HEIGHT = 1.5; // companions
const TILT = 0.88; // the camera looks down this much (radians)
const TEX_W = 288; // phone screen textures on the TV
const TEX_H = 512;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ================================================================== what a phone shows

/**
 * The colours of a table-game phone screen (and its mirror on the TV): deep and warm, cream instead of white,
 * strong enough to read on a phone lying on a table in a dim room.
 */
export const SCREEN = {
  /** The darkest background, behind overlays and on "out" screens. */
  night: '#17131f',
  /** Panels and pills on a dark screen. */
  dusk: '#2a2236',
  /** Text and lines on dark. */
  cream: '#f3ead9',
  /** Quiet text on dark. */
  soft: '#b5aac2',
  /** Text on a light pill. */
  ink: '#1e1826',
  /** Highlights: overtime, a touchdown, the last seconds. */
  gold: '#ecc06a',
  good: '#57a57c',
  bad: '#e5735f',
  cork: '#c99a68',
  corkDark: '#8f6440',
  corkLight: '#ddb98c',
} as const;

/** A phone's background in a player's colour: deep, so the cream text and the bright pieces stand out. */
export const screenBg = (color: string, depth = 0.8): string => mix(color, SCREEN.night, depth);
/** A player's colour as text or a line on a dark screen. */
export const onDark = (color: string, lift = 0.28): string => mix(color, SCREEN.cream, lift);

/** Draws scene shapes the way a table-game phone does, on a canvas `w` × `h` (the whole canvas is the playfield). */
export function paintItems(g: CanvasRenderingContext2D, w: number, h: number, items: readonly SceneItem[], bg: string): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  for (const it of items) {
    g.globalAlpha = clamp(it.alpha ?? 1, 0, 1);
    switch (it.s) {
      case 'circle':
        g.beginPath();
        g.arc(it.x * w, it.y * h, Math.max(0, it.r * w), 0, Math.PI * 2);
        if (it.fill) {
          g.fillStyle = it.fill;
          g.fill();
        }
        if (it.stroke) {
          g.strokeStyle = it.stroke;
          g.lineWidth = (it.lw ?? 0.01) * w;
          g.stroke();
        }
        break;
      case 'rect': {
        const rw = it.w * w;
        const rh = it.h * h;
        g.save();
        g.translate(it.x * w, it.y * h);
        if (it.rot) g.rotate(it.rot);
        g.beginPath();
        g.roundRect(-rw / 2, -rh / 2, rw, rh, Math.min((it.radius ?? 0) * w, rw / 2, rh / 2));
        if (it.fill) {
          g.fillStyle = it.fill;
          g.fill();
        }
        if (it.stroke) {
          g.strokeStyle = it.stroke;
          g.lineWidth = (it.lw ?? 0.01) * w;
          g.stroke();
        }
        g.restore();
        break;
      }
      case 'text':
        g.fillStyle = it.fill ?? SCREEN.ink;
        g.font = `${it.bold === false ? 500 : 700} ${Math.max(6, it.size * w)}px ${FONT}`;
        g.textAlign = it.align ?? 'center';
        g.textBaseline = 'middle';
        g.fillText(it.text, it.x * w, it.y * h);
        break;
      case 'line':
        if (it.pts.length < 4) break;
        g.strokeStyle = it.stroke;
        g.lineWidth = it.lw * w;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo((it.pts[0] as number) * w, (it.pts[1] as number) * h);
        for (let i = 2; i + 1 < it.pts.length; i += 2) g.lineTo((it.pts[i] as number) * w, (it.pts[i + 1] as number) * h);
        g.stroke();
        break;
    }
  }
  g.globalAlpha = 1;
}

/** A circle at a field point, on `side`'s phone. */
export function fieldCircle(side: Side, x: number, y: number, r: number, style: Omit<Extract<SceneItem, { s: 'circle' }>, 's' | 'x' | 'y' | 'r'>): SceneItem {
  const p = toPhone(side, x, y);
  return { s: 'circle', x: p.x, y: p.y, r, ...style };
}

/** A big word in the middle of a phone, on a dark pill so it reads over anything. */
export function overlayItems(text: string, color: string = SCREEN.cream, y = 0.5, size = 0.15): SceneItem[] {
  const fit = Math.min(size, 0.84 / Math.max(1, text.length * 0.58));
  const w = Math.min(0.94, 0.12 + text.length * fit * 0.58);
  return [
    { s: 'rect', x: 0.5, y, w, h: fit * 0.85, fill: SCREEN.night, stroke: color, lw: 0.005, radius: 0.06, alpha: 0.88 },
    { s: 'text', x: 0.5, y, text, size: fit, fill: color },
  ];
}

/** The "tap when it's down" pill at the bottom of a phone while the phones are laid out. */
export function readyPill(y: number, ready: boolean, ask: string): SceneItem[] {
  return [
    { s: 'rect', x: 0.5, y, w: 0.74, h: 0.07, fill: ready ? SCREEN.good : SCREEN.cream, radius: 0.05, alpha: 0.96 },
    { s: 'text', x: 0.5, y, text: ready ? 'Ready' : ask, size: 0.052, fill: ready ? SCREEN.cream : SCREEN.ink },
  ];
}

// ================================================================== a phone on the table

function roundedRect(w: number, l: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -l / 2;
  const k = Math.min(r, w / 2, l / 2);
  s.moveTo(x + k, y);
  s.lineTo(x + w - k, y);
  s.quadraticCurveTo(x + w, y, x + w, y + k);
  s.lineTo(x + w, y + l - k);
  s.quadraticCurveTo(x + w, y + l, x + w - k, y + l);
  s.lineTo(x + k, y + l);
  s.quadraticCurveTo(x, y + l, x, y + l - k);
  s.lineTo(x, y + k);
  s.quadraticCurveTo(x, y, x + k, y);
  return s;
}

/** A flat rounded rectangle lying on y = 0, its texture's top towards -z. */
function flatRect(w: number, l: number, r: number): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(roundedRect(w, l, r), 6);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / l + 0.5);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

let sheenTexture: THREE.CanvasTexture | null = null;
let haloTexture: THREE.CanvasTexture | null = null;

/** A soft streak of reflected lamp light across a phone's glass. */
function sheen(): THREE.CanvasTexture {
  sheenTexture ??= canvasTexture(64, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0)');
    grad.addColorStop(0.42, 'rgba(255,244,224,0.55)');
    grad.addColorStop(0.5, 'rgba(255,244,224,0.08)');
    grad.addColorStop(0.62, 'rgba(255,244,224,0.3)');
    grad.addColorStop(0.72, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  return sheenTexture;
}

/** The glow a lit screen throws on the table around it. */
function halo(): THREE.CanvasTexture {
  haloTexture ??= canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  return haloTexture;
}

export interface PhoneShape {
  /** The screen's length (default 16:9 of its width). */
  length?: number;
  /** The body's edge beside, above and below the screen. */
  side?: number;
  top?: number;
  bottom?: number;
}

/**
 * A phone lying screen up on the coffee table: a graphite body with a metal band, side buttons and a glass face,
 * and a screen that mirrors the shapes a table-game phone draws (and glows a little onto the table). In its group,
 * x runs across the screen and the screen's top points to -z; turn the group to point it elsewhere.
 */
export class PhoneOnTable {
  readonly group = new THREE.Group();
  /** The screen's length (its width is `width`). */
  readonly length: number;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly sheenMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly owned: THREE.BufferGeometry[] = [];
  private shown = '';

  constructor(
    readonly width: number,
    shape: PhoneShape = {},
  ) {
    const side = shape.side ?? 0.07;
    const top = shape.top ?? 0.15;
    const bottom = shape.bottom ?? 0.15;
    const len = shape.length ?? (width * 16) / 9;
    this.length = len;
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    this.g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });

    const bw = width + side * 2;
    const bl = len + top + bottom;
    const cz = (bottom - top) / 2; // the body's middle, from the screen's
    const corner = width * 0.1;
    const own = <T extends THREE.BufferGeometry>(geo: T): T => {
      this.owned.push(geo);
      return geo;
    };
    // The body: a rounded slab with a bevelled edge.
    const bevel = 0.012;
    const body = own(
      new THREE.ExtrudeGeometry(roundedRect(bw - bevel * 2, bl - bevel * 2, corner + Math.min(side, 0.05)), {
        depth: BODY_H - bevel * 2,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 6,
      }),
    );
    body.rotateX(-Math.PI / 2);
    body.translate(0, bevel, 0);
    part(this.group, body, P.charcoal, 0, 0, cz, { gloss: 0.45, outline: 0.016 });
    // A brushed metal band round its middle, and two buttons on the right edge.
    const band = own(new THREE.ExtrudeGeometry(roundedRect(bw + 0.006, bl + 0.006, corner + Math.min(side, 0.05) + 0.003), { depth: 0.022, bevelEnabled: false, curveSegments: 6 }));
    band.rotateX(-Math.PI / 2);
    part(this.group, band, mix(P.metal, P.cream, 0.25), 0, 0.024, cz, { gloss: 0.7, outline: false, shadow: false });
    for (const [z, l] of [
      [-len * 0.2, len * 0.09],
      [-len * 0.06, len * 0.14],
    ] as const) {
      part(this.group, rbox(0.022, 0.024, l, 0.008), mix(P.metal, P.cream, 0.35), bw / 2 + 0.006, 0.036, z, { gloss: 0.7, outline: false, shadow: false });
    }
    // The glass face, the screen set into it, and the earpiece (when the top edge has room for one).
    part(this.group, own(flatRect(bw - 0.03, bl - 0.03, corner + 0.03)), '#0d0b12', 0, GLASS_Y - 0.0012, cz, { gloss: 0.8, outline: false, shadow: false, exact: true });
    if (top >= 0.1) part(this.group, rbox(width * 0.16, 0.004, 0.022, 0.002), P.slate, 0, GLASS_Y - 0.001, -len / 2 - top * 0.5, { outline: false, shadow: false });
    const screenGeo = own(flatRect(width, len, corner));
    const screen = new THREE.Mesh(screenGeo, this.material);
    screen.position.y = GLASS_Y;
    this.group.add(screen);
    this.sheenMat = new THREE.MeshBasicMaterial({ map: sheen(), transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const gloss = new THREE.Mesh(screenGeo, this.sheenMat);
    gloss.position.y = GLASS_Y + 0.0006;
    gloss.renderOrder = 2;
    this.group.add(gloss);
    // The screen's light on the table.
    this.haloMat = new THREE.MeshBasicMaterial({ map: halo(), color: '#000000', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const glow = new THREE.Mesh(own(new THREE.PlaneGeometry(bw + 1.1, bl + 1.1)), this.haloMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, 0.0015, cz);
    glow.renderOrder = 1;
    this.group.add(glow);
  }

  /** Lies it on the table with its screen's middle at (x, z), turned `turn` radians (0: top away from the TV). */
  place(x: number, z: number, turn = 0): void {
    this.group.position.set(x, SCREEN_Y - GLASS_Y, z);
    this.group.rotation.y = turn;
    this.group.updateMatrixWorld();
  }

  /** Shows these shapes (redrawn only when they change). */
  paint(items: readonly SceneItem[], bg: string): void {
    const key = `${bg}|${JSON.stringify(items)}`;
    if (key === this.shown) return;
    this.shown = key;
    paintItems(this.g, TEX_W, TEX_H, items, bg);
    this.texture.needsUpdate = true;
    // The glow takes the screen's colour, lifted a little so even a dark screen lights the wood round it.
    this.haloMat.color.set(bg).lerp(new THREE.Color(P.screen), 0.18).multiplyScalar(0.8);
  }

  /** A point on the screen (0..1 of its width and height), `lift` above it, in the world. */
  at(sx: number, sy: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    out.set((sx - 0.5) * this.width, GLASS_Y + lift, (sy - 0.5) * this.length);
    return this.group.localToWorld(out);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geo of this.owned) geo.dispose();
    this.texture.dispose();
    this.material.dispose();
    this.sheenMat.dispose();
    this.haloMat.dispose();
  }
}

// ================================================================== the room

/** Things that stand on the coffee table, sized for it (the phones are the big things here). */
export type TableTreat = 'bowl' | 'mug' | 'candle' | 'coasters' | 'remote' | 'can' | 'plant';

/** A snack, a drink or a candle for the table: stands on y = 0, so put it at TABLE_Y. */
export function tableTreat(kind: TableTreat, seed = 1): THREE.Group {
  const g = new THREE.Group();
  const add = (o: THREE.Object3D, s: number, x = 0, z = 0) => {
    o.scale.setScalar(s);
    o.position.set(x, 0, z);
    g.add(o);
  };
  /** A cork coaster, lying flat. */
  const coaster = (y: number, turn: number, x = 0, z = 0) => {
    const m = part(g, cyl(0.2, 0.2, 0.03, 24), SCREEN.cork, x, y + 0.015, z, { tex: 'sand', texStrength: 0.5, outline: 0.01, ry: turn });
    part(m, torus(0.15, 0.006), SCREEN.corkDark, 0, 0.016, 0, { rx: Math.PI / 2, outline: false, shadow: false });
  };
  switch (kind) {
    case 'bowl':
      add(props.snackBowl({ fill: seed % 2 ? 'crisps' : 'popcorn', color: seed % 2 ? P.ceramic : P.teal, seed: 11 + seed }), 2.6);
      break;
    case 'mug':
      coaster(0, 0.4);
      add(props.mug({ color: [P.terracotta, P.ceramic, P.sage, P.mustard][seed % 4] as string }), 3.4);
      (g.children[g.children.length - 1] as THREE.Object3D).position.y = 0.03;
      (g.children[g.children.length - 1] as THREE.Object3D).rotation.y = seed * 1.3;
      break;
    case 'candle':
      part(g, cyl(0.17, 0.19, 0.03, 20), P.brass, 0, 0.015, 0, { gloss: 0.6, outline: 0.01 });
      add(props.candle({ h: 0.09, color: P.cream }), 3.2);
      (g.children[g.children.length - 1] as THREE.Object3D).position.y = 0.03;
      break;
    case 'coasters':
      for (let k = 0; k < 3; k++) coaster(k * 0.032, k * 0.5, Math.sin(k * 2.1) * 0.02, Math.cos(k * 1.7) * 0.02);
      break;
    case 'remote':
      add(props.remote(), 3.2);
      break;
    case 'can':
      add(props.drink({ kind: 'can', color: [P.teal, P.terracotta, P.mauve][seed % 3] as string }), 3.2);
      break;
    case 'plant':
      add(props.plant({ kind: 'cactus', h: 0.24, pot: P.terracotta, seed }), 2.2);
      break;
  }
  return g;
}

export interface Room {
  /** The table's width and depth (its top is at TABLE_Y, its middle at the origin). */
  w: number;
  d: number;
  env: Env;
  /** Things on the table go in here (cleared with `clearTable`). */
  onTable: THREE.Group;
  /** Stands a treat on the table at (x, z). */
  treat(kind: TableTreat, x: number, z: number, turn?: number, seed?: number): void;
  clearTable(): void;
  /** Call every frame: the candles flicker, the record turns, the dust drifts. */
  update(dt: number, time: number): void;
}

/**
 * The living room late in the evening, seen from above the coffee table: floorboards, a deep rug, the sofa behind
 * with its cushions, a lamp by the sofa, plants, poufs and a pizza box on the floor, and the coffee table itself
 * (long, or round), its top at TABLE_Y and its middle at the origin.
 */
export function furnishRoom(scene: THREE.Scene, table: { w: number; d: number } | { r: number }): Room {
  const round = 'r' in table;
  const tw = round ? table.r * 2 : table.w;
  const td = round ? table.r * 2 : table.d;
  const roomW = tw + 9;
  const roomD = td + 7.2;
  const env = livingRoom(scene, { mood: 'evening', w: roomW, d: roomD, rug: false, accent: P.mauve, seed: 3 });
  const back = -roomD / 2;
  const root = new THREE.Group();
  root.name = 'tableRoom';
  scene.add(root);
  const put = <T extends THREE.Object3D>(o: T, x: number, z: number, ry = 0, s = 1, y = 0): T => {
    o.position.set(x, y, z);
    o.rotation.y = ry;
    if (s !== 1) o.scale.setScalar(s);
    root.add(o);
    return o;
  };

  // The rug: deep and quiet, so the table and the phones' glow sit on something dark.
  const rugColor = mix(P.teal, P.aubergine, 0.6);
  const rugBorder = mix(P.sand, P.aubergine, 0.3);
  if (round) put(props.rug({ round: true, w: tw + 3.4, color: rugColor, border: rugBorder }), 0, 0);
  else put(props.rug({ w: tw + 3.4, d: td + 2.8, color: rugColor, border: rugBorder }), 0, 0.15);

  // The coffee table: an oiled wooden top with a thin brass inlay, on a darker frame.
  const wood = { tex: 'wood' as const, texScale: 2.6, gloss: 0.22 };
  const frame = mix(P.walnut, P.ink, 0.15);
  const top = mix(P.wood, P.oak, 0.35);
  if (round) {
    const r = table.r;
    part(root, cyl(r, r, 0.12, 72), top, 0, TABLE_Y - 0.06, 0, { ...wood, outline: 0.02 });
    part(root, cyl(r - 0.05, r - 0.12, 0.08, 72), frame, 0, TABLE_Y - 0.16, 0, { tex: 'darkWood', outline: false });
    part(root, torus(r - 0.16, 0.012, Math.PI * 2), P.brass, 0, TABLE_Y + 0.001, 0, { rx: Math.PI / 2, gloss: 0.7, outline: false, shadow: false });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      part(root, cyl(0.13, 0.09, TABLE_Y - 0.14, 14), frame, Math.cos(a) * r * 0.72, (TABLE_Y - 0.14) / 2, Math.sin(a) * r * 0.72, { tex: 'darkWood', outline: false });
    }
  } else {
    part(root, rbox(tw, 0.12, td, 0.05), top, 0, TABLE_Y - 0.06, 0, { ...wood, outline: 0.02 });
    part(root, rbox(tw - 0.3, 0.1, td - 0.3, 0.03), frame, 0, TABLE_Y - 0.17, 0, { tex: 'darkWood', outline: false });
    const ix = tw / 2 - 0.13;
    const iz = td / 2 - 0.13;
    for (const s of [-1, 1]) {
      part(root, rbox(ix * 2, 0.006, 0.02, 0.003), P.brass, 0, TABLE_Y + 0.001, s * iz, { gloss: 0.7, outline: false, shadow: false });
      part(root, rbox(0.02, 0.006, iz * 2, 0.003), P.brass, s * ix, TABLE_Y + 0.001, 0, { gloss: 0.7, outline: false, shadow: false });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(root, cyl(0.14, 0.09, TABLE_Y - 0.14, 14), frame, sx * (tw / 2 - 0.4), (TABLE_Y - 0.14) / 2, sz * (td / 2 - 0.4), { tex: 'darkWood', outline: false });
  }

  // Behind the table: the sofa against the wall, a lamp at one end, a side table with a plant at the other.
  const seats = clamp(Math.round((tw * 0.85) / 0.97), 3, 7);
  const sofaW = (seats * 0.72 + 0.5) * 1.35;
  put(props.sofa({ seats, color: P.mauve, pillows: [P.mustard, P.teal, P.terracotta, P.cream] }), 0, back + 0.78, 0, 1.35);
  put(props.blanket({ w: 0.9, d: 1.3, color: P.mustard, tex: 'knit' }), sofaW / 2 - 1.3, back + 0.95, 0.2, 1, 0.83);
  put(props.floorLamp({ lit: true, light: 16, shade: P.cream, h: 1.75 }), sofaW / 2 + 0.75, back + 0.85, 0, 1.45);
  const side = put(props.sideTable({ h: 0.55, r: 0.3 }), -sofaW / 2 - 0.75, back + 0.75, 0, 1.35);
  side.add(put(props.plant({ kind: 'fern', h: 0.5, pot: P.ceramic, seed: 5 }), 0, 0, 0, 1, 0.55));
  put(props.tableLamp({ lit: true, shade: P.clay }), -sofaW / 2 - 0.5, back + 1.05, 0, 1.2, 0.55 * 1.35);

  // Round the table, on the floor: poufs and a beanbag to sit on, a plant, last night's pizza, a few records.
  const fx = tw / 2 + 1.9;
  const fz = td / 2;
  put(props.pouf({ color: P.mustard }), fx, fz + 0.7, 0, 1.7);
  put(props.pouf({ color: P.terracotta, r: 0.3, h: 0.26 }), fx + 0.95, fz - 0.35, 0, 1.6);
  put(props.beanbag({ color: mix(P.denim, P.ink, 0.1) }), -fx - 0.7, fz + 0.2, 0.5, 1.5);
  put(props.plant({ kind: 'monstera', h: 1.3, pot: P.terracotta, seed: 8 }), fx + 1.2, -fz + 0.2, 0, 1.3);
  put(props.plant({ kind: 'palm', h: 1.7, pot: P.charcoal, seed: 3 }), -fx - 1.5, -fz - 0.6, 0, 1.3);
  put(props.pizzaBox({ open: true, slices: 3 }), -fx + 0.1, fz + 1.5, 0.35, 2.3);
  put(props.books(0.7, 4), -fx - 1.0, fz + 1.7, 1.2, 1.5);
  put(props.crate({ s: 0.5 }), fx + 1.6, fz + 1.5, -0.3, 1.5);
  put(props.speaker({ h: 0.8 }), fx + 2.6, fz - 1.6, -Math.PI / 2 + 0.3, 1.3);

  const onTable = new THREE.Group();
  onTable.position.y = TABLE_Y;
  root.add(onTable);
  let tick = props.tickProps(root);
  return {
    w: tw,
    d: td,
    env,
    onTable,
    treat(kind, x, z, turn = 0, seed = 1) {
      const t = tableTreat(kind, seed);
      t.position.set(x, 0, z);
      t.rotation.y = turn;
      onTable.add(t);
      tick = props.tickProps(root);
    },
    clearTable() {
      onTable.clear();
      tick = props.tickProps(root);
    },
    update(dt, time) {
      env.update(dt, time);
      tick(dt, time);
    },
  };
}

// ================================================================== two phones, top to top

type TouchMsg = Extract<PhoneMsg, { t: 'touch' }>;
/** Player positions on side 0 and side 1 of a pair of phones. */
export type Pair = [number, number];

export interface TablePlayer {
  /** Position in ctx.seats, or just past the end for a made-up computer opponent. */
  pos: number;
  /** The session seat, or null for the made-up opponent. */
  seat: number | null;
  name: string;
  color: string;
  thumb: string | null;
  look: CompanionLook;
}

/** The score between a pair: side 0's goals on the left (where side 0 stands), side 1's on the right. */
function scoreSprite(a: number, b: number, ca: string, cb: string): THREE.Sprite {
  const texture = canvasTexture(512, 128, (g) => {
    g.fillStyle = 'rgba(23, 19, 31, 0.9)';
    g.beginPath();
    g.roundRect(120, 16, 272, 96, 48);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(243, 234, 217, 0.28)';
    g.stroke();
    g.font = `800 70px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = onDark(ca, 0.12);
    g.fillText(String(a), 196, 68);
    g.fillStyle = SCREEN.soft;
    g.fillText('–', 256, 62);
    g.fillStyle = onDark(cb, 0.12);
    g.fillText(String(b), 316, 68);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(0.2, 0.05, 1);
  sprite.renderOrder = 6;
  return sprite;
}

function dropSprite(s: THREE.Sprite | null): void {
  if (!s) return;
  s.removeFromParent();
  s.material.map?.dispose();
  s.material.dispose();
}

interface Strip {
  pair: Pair;
  z: number;
  phones: [PhoneOnTable, PhoneOnTable];
  score: THREE.Sprite | null;
  shownScore: string;
  /** Seconds since the score last changed (it pops). */
  scoreAge: number;
}

/** The living room with the coffee table; the phones, players and scores of the current round. */
export class TableView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly floaters: Floaters;
  strips: Strip[] = [];
  private readonly room: Room;
  private readonly fit = new CameraFit(this.camera, TILT);
  private readonly cards: (THREE.Sprite | null)[];
  private readonly rings: THREE.Mesh[];
  private watchers: number[] = [];
  private version = 0;

  constructor(
    private readonly players: readonly TablePlayer[],
    readonly companions: readonly Companion[],
  ) {
    this.floaters = new Floaters(this.scene);
    const tw = 2 * (PHONE_L * S + GAP / 2 + BOTTOM_BEZEL) + 1.0;
    const td = 2 * STRIP_Z + S + 1.3;
    this.room = furnishRoom(this.scene, { w: tw, d: td });
    this.cards = players.map((p) => {
      const card = nameCard(p.name, p.color, 1.05);
      card.visible = false;
      this.scene.add(card);
      return card;
    });
    // A thin ring of each player's colour on the floor where they stand at the table.
    this.rings = players.map((p) => {
      const ring = part(this.scene, torus(0.52, 0.035), p.color, 0, 0.05, 0, { rx: Math.PI / 2, glow: 1.2, shadow: false, outline: false });
      ring.visible = false;
      return ring;
    });
    for (const c of companions) {
      c.root.visible = false;
      c.setBase('listening');
      this.scene.add(c.root);
    }
    this.camera.position.set(0, 9, 9);
    this.camera.lookAt(0, 0.5, 0);
  }

  /** Snacks and drinks on the table, wherever the phones leave room. */
  private dress(pairs: number): void {
    const { room } = this;
    room.clearTable();
    const x = room.w / 2;
    const z = room.d / 2;
    if (pairs > 1) {
      // Two strips of phones: only the corners are free.
      room.treat('candle', -x + 0.3, -z + 0.32);
      room.treat('candle', x - 0.3, z - 0.32);
      return;
    }
    room.treat('bowl', -x + 0.95, -z + 0.95, 0, 2);
    room.treat('mug', -x + 2.0, -z + 0.7, 0, 1);
    room.treat('candle', -0.2, -z + 0.65);
    room.treat('coasters', 0.75, -z + 0.75);
    room.treat('mug', x - 0.9, -z + 0.8, 0, 3);
    room.treat('remote', x - 1.9, -z + 0.9, 0.5);
    room.treat('bowl', x - 0.95, z - 0.9, 0, 1);
    room.treat('can', x - 2.0, z - 0.75, 0, 1);
    room.treat('candle', -x + 0.6, z - 0.6);
    room.treat('plant', -x + 1.5, z - 0.7, 0, 2);
  }

  /** Lays out a round: a strip of two phones per pair, the players at its ends, everyone else by the sofa. */
  setRound(pairs: readonly Pair[], watchers: readonly number[]): void {
    for (const st of this.strips) {
      st.phones.forEach((p) => p.dispose());
      dropSprite(st.score);
    }
    for (const c of this.companions) c.root.visible = false;
    for (const card of this.cards) if (card) card.visible = false;
    for (const ring of this.rings) ring.visible = false;
    this.dress(pairs.length);
    const zs = pairs.length > 1 ? [STRIP_Z, -STRIP_Z] : [0];
    const shape: PhoneShape = { length: PHONE_L * S, side: SIDE_BEZEL, top: TOP_BEZEL, bottom: BOTTOM_BEZEL };
    this.strips = pairs.map((pair, m) => {
      const z = zs[m] ?? 0;
      const half = (PHONE_L * S) / 2 + GAP / 2;
      const phones: [PhoneOnTable, PhoneOnTable] = [new PhoneOnTable(S, shape), new PhoneOnTable(S, shape)];
      phones[0].place(-half, z, -Math.PI / 2);
      phones[1].place(half, z, Math.PI / 2);
      for (const ph of phones) this.scene.add(ph.group);
      pair.forEach((p, side) => {
        const x = side === 0 ? -END_X : END_X;
        this.place(p, x, z, side === 0 ? Math.PI / 2 - 0.55 : -Math.PI / 2 + 0.55, 0.55);
        const ring = this.rings[p];
        if (ring) {
          ring.visible = true;
          ring.position.set(x, 0.05, z);
        }
      });
      return { pair: [pair[0], pair[1]], z, phones, score: null, shownScore: '', scoreAge: 9 };
    });
    this.watchers = [...watchers];
    lanes(watchers.length, 1.5).forEach((x, i) => this.place(watchers[i] as number, x, -STRIP_Z - S / 2 - 1.75, 0, 0.7));
    for (const pair of pairs) for (const p of pair) this.companions[p]?.setBase('listening');
    for (const p of watchers) this.companions[p]?.setBase('idle');
    this.version += 1;
  }

  private place(p: number, x: number, z: number, ry: number, cardZ: number): void {
    const c = this.companions[p];
    if (c) {
      c.root.visible = true;
      c.root.position.set(x, 0, z);
      c.root.rotation.y = ry;
    }
    const card = this.cards[p];
    if (card) {
      card.visible = true;
      card.position.set(x, 0.12, z + cardZ);
    }
  }

  /** A field point on match `m`'s table, in the world (`lift` above the screens). */
  world(m: number, x: number, y: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const z = this.strips[m]?.z ?? 0;
    return out.set(y * S + Math.sign(y) * (GAP / 2), SCREEN_Y + lift, z + (x - 0.5) * S);
  }

  /** What match `m`'s phone on `side` shows (the parts that don't move; moving things are 3D on the TV). */
  paint(m: number, side: Side, items: readonly SceneItem[], bg: string): void {
    this.strips[m]?.phones[side].paint(items, bg);
  }

  setScore(m: number, a: number, b: number): void {
    const st = this.strips[m];
    if (!st) return;
    const key = `${a}:${b}`;
    if (key === st.shownScore) return;
    if (st.shownScore !== '') st.scoreAge = 0;
    st.shownScore = key;
    dropSprite(st.score);
    st.score = scoreSprite(a, b, this.players[st.pair[0]]?.color ?? SCREEN.cream, this.players[st.pair[1]]?.color ?? SCREEN.cream);
    st.score.position.set(0, SCREEN_Y + 0.05, st.z + S / 2 + 0.42);
    this.scene.add(st.score);
  }

  companion(p: number): Companion | undefined {
    return this.companions[p];
  }

  /** Where player `p` stands, a little above their head. */
  above(p: number): THREE.Vector3 {
    const c = this.companions[p];
    return c ? c.root.position.clone().add(new THREE.Vector3(0, HEIGHT + 0.5, 0)) : new THREE.Vector3(0, 2, 0);
  }

  /** Everyone watching cheers a moment. */
  cheerWatchers(mood: CompanionMood = 'approval'): void {
    for (const p of this.watchers) this.companions[p]?.react(mood, 1.4);
  }

  update(dt: number, time = 0): void {
    for (const c of this.companions) c.update(dt);
    this.room.update(dt, time);
    this.floaters.update(dt);
    for (const st of this.strips) {
      // A new score pops and settles.
      st.scoreAge += dt;
      const k = Math.min(1, st.scoreAge / 0.3);
      const pop = 1 + 0.22 * Math.sin(k * Math.PI) * (1 - k * 0.4);
      st.score?.scale.set(0.2 * pop, 0.05 * pop, 1);
    }
    this.rings.forEach((r, i) => r.scale.setScalar(1 + Math.sin(time * 2.2 + i * 1.7) * 0.03));
    this.fit.update(() => this.marks(), String(this.version));
  }

  private marks(): Mark[] {
    const marks: Mark[] = [];
    const reach = PHONE_L * S + GAP / 2 + BOTTOM_BEZEL;
    for (const st of this.strips) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) marks.push({ p: new THREE.Vector3(sx * reach, SCREEN_Y, st.z + (sz * S) / 2) });
        marks.push({ p: new THREE.Vector3(sx * END_X, 0, st.z + 0.55), pad: 0.05 }, { p: new THREE.Vector3(sx * END_X, HEIGHT + 0.2, st.z) });
      }
      marks.push({ p: new THREE.Vector3(0, SCREEN_Y, st.z + S / 2 + 0.42), pad: 0.05 });
    }
    lanes(this.watchers.length, 1.5).forEach((x) => {
      marks.push({ p: new THREE.Vector3(x, HEIGHT + 0.1, -STRIP_Z - S / 2 - 1.75) });
    });
    return marks;
  }

  dispose(): void {
    for (const st of this.strips) {
      st.phones.forEach((p) => p.dispose());
      dropSprite(st.score);
    }
    this.strips = [];
    for (const card of this.cards) dropSprite(card);
    for (const c of this.companions) c.dispose();
    this.floaters.dispose();
  }
}

/** The arrangement on a phone (and its mirror on the TV): where the other phone goes, whose phone this is. */
function arrangeItems(me: TablePlayer, other: TablePlayer, otherOnTv: boolean, ready: boolean): SceneItem[] {
  const items: SceneItem[] = [];
  const theirs = onDark(other.color);
  if (otherOnTv) {
    items.push({ s: 'text', x: 0.5, y: 0.2, text: `${other.name} plays`, size: 0.065, fill: theirs }, { s: 'text', x: 0.5, y: 0.27, text: 'on the big screen', size: 0.052, fill: SCREEN.soft, bold: false });
  } else {
    items.push(
      { s: 'rect', x: 0.5, y: 0.012, w: 0.9, h: 0.024, fill: other.color, radius: 0.012 },
      { s: 'line', pts: [0.5, 0.29, 0.5, 0.08], stroke: theirs, lw: 0.03 },
      { s: 'line', pts: [0.39, 0.17, 0.5, 0.075, 0.61, 0.17], stroke: theirs, lw: 0.03 },
      { s: 'text', x: 0.5, y: 0.36, text: `Top to top with ${other.name}`, size: 0.056, fill: theirs },
    );
  }
  items.push({ s: 'text', x: 0.5, y: 0.53, text: me.name, size: 0.12, fill: onDark(me.color, 0.2) }, { s: 'rect', x: 0.5, y: 0.6, w: 0.16, h: 0.008, fill: me.color, radius: 0.004 }, ...readyPill(0.72, ready, 'Tap when it’s in place'));
  return items;
}

const SNACK_DUTY = [
  (n: string) => `${n} is on snack duty and plays the winner.`,
  (n: string) => `${n} calls next and guards the crisps.`,
  (n: string) => `${n} warms up the sofa, then plays the winner.`,
];

/** The flow the top-to-top games share: players and companions, who plays whom, phones, the TV and the scores. */
export class TableGame {
  readonly stream: SceneStream;
  readonly skills: number[];
  private handler: ((p: number, m: TouchMsg) => void) | null = null;
  private readonly off: () => void;
  private readonly posOfSeat: Map<number, number>;

  private constructor(
    readonly ctx: MinigameContext,
    readonly players: TablePlayer[],
    readonly plan: TablePlan,
    readonly view: TableView,
  ) {
    this.stream = new SceneStream(ctx.session);
    this.posOfSeat = new Map(players.filter((p) => p.seat !== null).map((p) => [p.seat as number, p.pos]));
    this.skills = players.map((p) => (this.isCpu(p.pos) ? ctx.skill() : 0.5));
    this.off = ctx.session.onInput((seat, msg) => {
      if (msg.t !== 'touch') return;
      const p = this.posOfSeat.get(seat);
      if (p !== undefined && this.handler && !this.isCpu(p)) this.handler(p, msg);
    });
  }

  static async open(ctx: MinigameContext): Promise<TableGame> {
    const { seats, session, rng } = ctx;
    const humans = seats.flatMap((s, i) => (session.isCpu(s.index) ? [] : [i]));
    const cpus = seats.flatMap((s, i) => (session.isCpu(s.index) ? [i] : []));
    const plan = planTable(humans, cpus, rng);
    const players: TablePlayer[] = seats.map((s, i) => ({ pos: i, seat: s.index, name: s.name, color: s.color, thumb: s.thumb, look: s.look }));
    if (plan.phantom !== null) players.push(await phantom(players, plan.phantom));
    const companions = await Promise.all(players.map((p) => buildCompanion(p.look, { height: HEIGHT })));
    const view = new TableView(players, companions);
    ctx.stage.setView(view);
    return new TableGame(ctx, players, plan, view);
  }

  isCpu(p: number): boolean {
    const seat = this.players[p]?.seat;
    return seat === null || seat === undefined || this.ctx.session.isCpu(seat);
  }

  name(p: number): string {
    return this.players[p]?.name ?? '?';
  }

  color(p: number): string {
    return this.players[p]?.color ?? '#ffffff';
  }

  /** Touches from the people at the table go here (null: ignored). */
  onTouch(fn: ((p: number, m: TouchMsg) => void) | null): void {
    this.handler = fn;
  }

  /** Shows a pair's phone: `still` on the TV's mirror and the phone, `moving` only on the phone (3D on the TV). */
  show(m: number, side: Side, still: SceneItem[], moving: SceneItem[], bg: string, force = false): void {
    const st = this.view.strips[m];
    if (!st) return;
    this.view.paint(m, side, still, bg);
    const seat = this.players[st.pair[side]]?.seat;
    if (seat !== null && seat !== undefined) this.stream.send(seat, [...still, ...moving], bg, force);
  }

  tell(p: number, good: boolean, text: string): void {
    const seat = this.players[p]?.seat;
    if (seat !== null && seat !== undefined) this.ctx.session.send(seat, { t: 'feedback', good, text });
  }

  buzz(p: number, pattern: number[]): void {
    const seat = this.players[p]?.seat;
    if (seat !== null && seat !== undefined) this.ctx.session.send(seat, { t: 'buzz', pattern });
  }

  /** The score list: everyone at the table, with a value each. */
  live(pairs: readonly Pair[], value: (p: number, m: number, side: Side) => string, waiting: number | null = null): void {
    const rows = pairs.flatMap((pair, m) =>
      pair.map((p, side) => ({ name: this.name(p), color: this.color(p), thumb: this.players[p]?.thumb ?? null, value: value(p, m, side as Side) })),
    );
    if (waiting !== null) rows.push({ name: this.name(waiting), color: this.color(waiting), thumb: this.players[waiting]?.thumb ?? null, value: 'Next' });
    this.ctx.ui.live(rows);
  }

  /**
   * Tells everyone how to lay the phones (on the TV, with the phones on the table as a diagram, and on each phone)
   * and waits until every person at the table has tapped their phone (or a little while).
   */
  async arrange(pairs: readonly Pair[], watchers: readonly number[], waiting: number | null): Promise<void> {
    const { session, ui, sfx, clock } = this.ctx;
    this.view.setRound(pairs, watchers);
    const ready = new Set<number>();
    const people: number[] = [];
    const paintAll = (force = false) =>
      pairs.forEach((pair, m) =>
        pair.forEach((p, side) => {
          const other = pair[side === 0 ? 1 : 0];
          const me = this.players[p];
          const them = this.players[other];
          if (!me || !them) return;
          const items = arrangeItems(me, them, this.isCpu(other), this.isCpu(p) || ready.has(p));
          const bg = screenBg(me.color);
          this.view.paint(m, side as Side, items, bg);
          const seat = me.seat;
          if (seat !== null && ready.has(p)) this.stream.send(seat, items, bg, force);
        }),
      );
    for (const pair of pairs) {
      pair.forEach((p, side) => {
        const seat = this.players[p]?.seat;
        if (this.isCpu(p) || seat === null || seat === undefined) return;
        people.push(p);
        const other = pair[side === 0 ? 1 : 0];
        const hint = this.isCpu(other)
          ? `Lay your phone flat on the table, screen up. ${this.name(other)} plays on the big screen. Tap your screen when you're set.`
          : `Lay your phone flat on the table, top to top with ${this.name(other)}'s phone (the tops touching). Then tap your screen.`;
        session.setLayout(seat, { kind: 'table', hint });
      });
    }
    const duty = waiting !== null ? (SNACK_DUTY[Math.floor(this.ctx.rng() * SNACK_DUTY.length)] as (n: string) => string)(this.name(waiting)) : '';
    for (const p of watchers) {
      const seat = this.players[p]?.seat;
      if (this.isCpu(p) || seat === null || seat === undefined) continue;
      session.setLayout(seat, {
        kind: 'wait',
        title: p === waiting ? 'You play the winner' : 'Sofa time',
        text: p === waiting ? 'Snack duty for now. Get your phone ready for the next match.' : 'Watch the big screen and cheer them on.',
      });
    }
    paintAll();
    pairs.forEach((_, m) => this.view.floaters.add('Tops together', SCREEN.cream, this.view.world(m, 0.5, 0, 0.7), 0.34, 4.5));
    const lines = pairs.map(([a, b]) => {
      if (!this.isCpu(a) && !this.isCpu(b)) return `${this.name(a)}'s and ${this.name(b)}'s phones top to top.`;
      const h = !this.isCpu(a) ? a : !this.isCpu(b) ? b : null;
      if (h === null) return `${this.name(a)} and ${this.name(b)} play on the big screen.`;
      return `${this.name(h)}, lay your phone flat: ${this.name(h === a ? b : a)} plays on the big screen.`;
    });
    ui.caption(people.length ? 'Lay the phones flat on the table, then tap them' : lines[0] ?? null);
    void ui.banner('Phones on the table', [...lines, duty].filter(Boolean).join(' '), 3.4);
    this.onTouch((p, msg) => {
      if (msg.phase !== 'down' || !people.includes(p) || ready.has(p)) return;
      ready.add(p);
      sfx.tick();
      this.view.companion(p)?.react('approval', 1.2);
      paintAll(true);
    });
    await everyFrame(clock, (_dt, t) => (people.every((p) => ready.has(p) || this.isCpu(p)) && t > 3.6) || t > (people.length ? 25 : 3.6));
    this.onTouch(null);
  }

  /** 3, 2, 1, go: `draw` shows the overlay text on every phone (null: none). */
  async countIn(draw: (overlay: string | null) => void): Promise<void> {
    await countIn(this.ctx, draw);
  }

  /** Who goes through to the final with three players. */
  advancer(o: MatchOutcome): number {
    return advancer(o, this.ctx.rng);
  }

  /** Scores and a line per seat. `line` describes one match from one side ("Won 5–3 vs Sage"). */
  result(outcomes: readonly MatchOutcome[], line: (o: MatchOutcome, side: Side) => string): MinigameResult {
    const n = this.ctx.seats.length;
    const details = this.ctx.seats.map((_, p) => {
      const mine = outcomes.filter((o) => o.players.includes(p));
      const last = mine[mine.length - 1];
      if (!last) return 'Watched from the sofa';
      const side: Side = last.players[0] === p ? 0 : 1;
      return `${last.round === 2 ? 'Final: ' : ''}${line(last, side)}`;
    });
    return { scores: tableScores(n, outcomes), details };
  }

  /** The end: winners cheer, everyone else sighs a little. */
  celebrate(outcomes: readonly MatchOutcome[]): void {
    const last = new Map<number, MatchOutcome>();
    for (const o of outcomes) for (const p of o.players) last.set(p, o);
    for (const [p, o] of last) {
      const side = o.players[0] === p ? 0 : 1;
      const mood: CompanionMood = o.winner === null ? 'approval' : o.winner === side ? 'happy' : 'sad';
      this.view.companion(p)?.setBase(mood);
      if (mood === 'happy') this.view.companion(p)?.react('happy', 3);
    }
  }

  close(): void {
    this.off();
    this.handler = null;
    this.ctx.ui.timer(null);
    this.ctx.ui.caption(null);
  }
}

/** A made-up computer opponent for a lone player without computer seats: one of Atelier's companions. */
async function phantom(players: readonly TablePlayer[], pos: number): Promise<TablePlayer> {
  const taken = new Set(players.map((p) => p.name.toLowerCase()));
  const color = SEAT_COLORS.find((c) => !players.some((p) => p.color === c)) ?? SEAT_COLORS[1];
  let name = 'Pip';
  let look: CompanionLook = DEFAULT_LOOK;
  try {
    const preset = (await loadCompanionConfig()).presets.find((p) => !taken.has(p.name.toLowerCase()));
    if (preset) {
      name = preset.name;
      look = preset.look;
    }
  } catch {
    // No presets to hand: Pip it is.
  }
  return { pos, seat: null, name, color, thumb: null, look };
}

// ================================================================== the diagram card

/** The colours of the diagram card on the TV. */
export const CARD = {
  ink: SCREEN.cream,
  soft: '#bfb4cc',
  accent: SCREEN.gold,
  wood: '#8f6748',
  woodEdge: '#c9a35b',
} as const;

/**
 * A card drawn in 2D that sits in front of the camera, in the middle of the free part of the screen (how to lay
 * the phones). Call update(dt) from the view.
 */
export class Overlay {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private shown = 0;
  private target = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    readonly w = 1200,
    readonly h = 860,
  ) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 50;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(camera);
    camera.add(this.mesh);
  }

  draw(fn: (g: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.g.clearRect(0, 0, this.w, this.h);
    fn(this.g, this.w, this.h);
    this.texture.needsUpdate = true;
  }

  show(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  update(dt: number): void {
    this.shown += Math.sign(this.target - this.shown) * Math.min(Math.abs(this.target - this.shown), dt * 4);
    this.material.opacity = this.shown;
    this.mesh.visible = this.shown > 0.01;
    if (!this.mesh.visible) return;
    const dist = 1;
    const hh = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
    const hw = hh * this.camera.aspect;
    let hn = 1.36;
    let wn = (hn * hh * (this.w / this.h)) / hw;
    const maxW = (SAFE.right - SAFE.left) * 0.96;
    if (wn > maxW) {
      hn *= maxW / wn;
      wn = maxW;
    }
    // It eases in with a small rise.
    const k = 1 - (1 - this.shown) ** 3;
    const pop = 0.94 + 0.06 * k;
    this.mesh.scale.set(wn * hw * pop, hn * hh * pop, 1);
    this.mesh.position.set(((SAFE.left + SAFE.right) / 2) * hw, ((SAFE.top + SAFE.bottom) / 2 - 0.03 * (1 - k)) * hh, -dist);
  }

  dispose(): void {
    this.camera.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.texture.dispose();
    this.material.dispose();
  }
}

/** One run of coloured words, centred on cx (names in their colours). */
export function colourLine(g: CanvasRenderingContext2D, cx: number, y: number, parts: readonly { text: string; color: string }[], size = 34): void {
  g.font = `600 ${size}px ${FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const widths = parts.map((p) => g.measureText(p.text).width);
  let x = cx - widths.reduce((a, b) => a + b, 0) / 2;
  parts.forEach((p, i) => {
    g.fillStyle = p.color;
    g.fillText(p.text, x, y);
    x += widths[i] ?? 0;
  });
}

/** The diagram card's frame: a dark glass panel, the title and the TV at the top (so everyone knows which way is which). */
export function diagramFrame(g: CanvasRenderingContext2D, w: number, h: number, title: string): void {
  const panel = g.createLinearGradient(0, 0, 0, h);
  panel.addColorStop(0, 'rgba(46, 37, 60, 0.95)');
  panel.addColorStop(1, 'rgba(26, 21, 35, 0.95)');
  g.fillStyle = panel;
  g.beginPath();
  g.roundRect(6, 6, w - 12, h - 12, 44);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(243, 234, 217, 0.22)';
  g.stroke();
  g.fillStyle = CARD.ink;
  g.font = `700 54px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(title, w / 2, 76);
  // The TV: a thin glowing bar with its name under it.
  g.fillStyle = '#0f0c16';
  g.beginPath();
  g.roundRect(w / 2 - 150, 124, 300, 42, 10);
  g.fill();
  g.strokeStyle = 'rgba(191, 230, 255, 0.55)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = P.screen;
  g.font = `600 24px ${FONT}`;
  g.fillText('The big screen', w / 2, 146);
}

/** A table top on the diagram card (a rounded board, or a disc with `round`). */
export function diagramTable(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, round = false): void {
  const grad = g.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  grad.addColorStop(0, '#9c7250');
  grad.addColorStop(1, '#7c5840');
  g.fillStyle = grad;
  g.beginPath();
  if (round) g.arc(cx, cy, w / 2, 0, Math.PI * 2);
  else g.roundRect(cx - w / 2, cy - h / 2, w, h, 34);
  g.fill();
  g.strokeStyle = 'rgba(201, 163, 91, 0.7)';
  g.lineWidth = 3;
  g.stroke();
}

/** A phone seen from above on the diagram: a dark body and a screen in the player's colour, a tick once it's down. */
export function diagramPhone(g: CanvasRenderingContext2D, x: number, y: number, pw: number, color: string, turn: number, state: 'cpu' | 'waiting' | 'ready'): void {
  const ph = (pw * 16) / 9;
  g.save();
  g.translate(x, y);
  g.rotate(turn);
  g.globalAlpha = state === 'cpu' ? 0.55 : 1;
  g.fillStyle = '#14111b';
  g.beginPath();
  g.roundRect(-pw / 2 - 7, -ph / 2 - 12, pw + 14, ph + 24, 18);
  g.fill();
  g.strokeStyle = 'rgba(243, 234, 217, 0.35)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = state === 'ready' ? mix(color, SCREEN.night, 0.35) : mix(color, SCREEN.night, 0.62);
  g.beginPath();
  g.roundRect(-pw / 2, -ph / 2, pw, ph, 10);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.stroke();
  // The top edge, so it's clear which way it points.
  g.fillStyle = 'rgba(243, 234, 217, 0.6)';
  g.fillRect(-pw * 0.16, -ph / 2 - 8, pw * 0.32, 3);
  g.globalAlpha = 1;
  if (state === 'ready') {
    g.fillStyle = SCREEN.good;
    g.beginPath();
    g.arc(0, 0, pw * 0.28, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = SCREEN.cream;
    g.lineWidth = pw * 0.065;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-pw * 0.12, 0);
    g.lineTo(-pw * 0.03, pw * 0.09);
    g.lineTo(pw * 0.14, -pw * 0.09);
    g.stroke();
  }
  g.restore();
}

/** "Sam", "Sam and Jo", "Sam, Jo and Pip" with each name in its colour. */
export function nameList(players: readonly { name: string; color: string }[], ink: string): { text: string; color: string }[] {
  const out: { text: string; color: string }[] = [];
  players.forEach((p, i) => {
    if (i > 0) out.push({ text: i === players.length - 1 ? ' and ' : ', ', color: ink });
    out.push({ text: p.name, color: onDark(p.color, 0.15) });
  });
  return out;
}

// ================================================================== laying the phones out, counting in

export interface ArrangeOptions {
  /** Positions (in ctx.seats) of the people whose phones go on the table. */
  people: readonly number[];
  /** The line on p's phone until it's down. */
  hint(p: number): string;
  /** What p's phone shows once it's down (tapped). */
  scene(p: number, ready: ReadonlySet<number>): { items: SceneItem[]; bg: string };
  /** Redraws the TV side (the diagram and the phones on the table). */
  paint(ready: ReadonlySet<number>): void;
  caption: string;
  onReady?(p: number): void;
}

/**
 * Tells everyone how to lay the phones (the hint on each phone, the diagram and the phones on the TV) and waits
 * until every person has tapped their phone where it lies (or a while).
 */
export async function arrangePhones(ctx: MinigameContext, stream: SceneStream, o: ArrangeOptions): Promise<void> {
  const { session, seats, clock, ui, sfx } = ctx;
  const ready = new Set<number>();
  for (const p of o.people) {
    const seat = seats[p]?.index;
    if (seat !== undefined) session.setLayout(seat, { kind: 'table', hint: o.hint(p) });
  }
  o.paint(ready);
  ui.caption(o.caption);
  const off = session.onInput((seat, msg) => {
    if (msg.t !== 'touch' || msg.phase !== 'down') return;
    const p = seats.findIndex((s) => s.index === seat);
    if (p < 0 || !o.people.includes(p) || ready.has(p)) return;
    ready.add(p);
    sfx.tick();
    o.onReady?.(p);
    o.paint(ready);
    for (const q of ready) {
      const s = o.scene(q, ready);
      const qs = seats[q]?.index;
      if (qs !== undefined) stream.send(qs, s.items, s.bg, true);
    }
  });
  await everyFrame(clock, (_dt, t) => (o.people.every((p) => ready.has(p)) && t > 3.5) || t > (o.people.length ? 25 : 4.5));
  off();
}

/** 3, 2, 1, then go: `draw` puts the word on every phone (null: none). */
export async function countIn(ctx: MinigameContext, draw: (word: string | null) => void): Promise<void> {
  const { ui, sfx, clock } = ctx;
  for (const n of ['3', '2', '1']) {
    draw(n);
    ui.caption(n);
    sfx.tick();
    await clock.wait(0.6);
  }
  draw(null);
  ui.caption(null);
  sfx.go();
}
