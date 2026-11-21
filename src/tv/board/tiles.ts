// The spaces of the board: round enamel medallions on a dark stone base with a brass rim, a crisp icon for each
// kind of space, and a soft ring of light that marks the way ahead.
import * as THREE from 'three';
import type { SpaceType } from '../../game/board';
import { FONT, PALETTE as P, canvasTexture, cyl, mix, part, torus } from '../render/toon';

export const ISLAND_TOP = 0.6;
export const TILE_H = 0.26;
/** The top of a tile, where companions stand. */
export const TILE_TOP = ISLAND_TOP + TILE_H;
export const TILE_R = 1.2;

/** Enamel colours: deep and a little muted, so the seat colours stay the brightest things on the board. */
export const TILE_COLORS: Record<SpaceType, string> = {
  start: '#efe3cc',
  breeze: '#3f6fae',
  squall: '#a8485c',
  event: '#d9a441',
  market: '#2f8580',
  gust: '#7d6bb8',
  post: '#d2703c',
  dock: '#efe3cc',
};

const CREAM = '#fff6e4';
const INK = '#2a2136';

const icons = new Map<string, THREE.Texture>();

/** The face of a tile: enamel with a fine inner line and the icon, drawn once per kind (and dock colour). */
export function tileFace(type: SpaceType, dockColor?: string): THREE.Texture {
  const key = `${type}:${dockColor ?? ''}`;
  let tex = icons.get(key);
  if (tex) return tex;
  tex = canvasTexture(256, 256, (g) => {
    const base = TILE_COLORS[type];
    const light = type === 'start' || type === 'dock' || type === 'event';
    const ink = light ? INK : CREAM;
    // enamel: a soft pool of light towards the top
    const fill = g.createRadialGradient(128, 96, 20, 128, 128, 132);
    fill.addColorStop(0, mix(base, '#ffffff', 0.14));
    fill.addColorStop(1, mix(base, INK, 0.1));
    g.fillStyle = fill;
    g.beginPath();
    g.arc(128, 128, 127, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = dockColor ?? mix(base, light ? INK : '#ffffff', light ? 0.28 : 0.3);
    g.lineWidth = dockColor ? 12 : 4;
    g.beginPath();
    g.arc(128, 128, dockColor ? 112 : 110, 0, Math.PI * 2);
    g.stroke();

    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.shadowColor = light ? 'rgba(255,255,255,0.35)' : 'rgba(20,14,30,0.3)';
    g.shadowOffsetY = light ? 2 : 4;
    g.shadowBlur = 0;
    const text = (s: string, size: number, y = 134) => {
      g.font = `800 ${size}px ${FONT}`;
      g.fillText(s, 128, y);
    };
    switch (type) {
      case 'start':
        text('GO', 92);
        break;
      case 'breeze':
        text('+3', 108);
        break;
      case 'squall':
        text('−3', 108);
        break;
      case 'event':
        text('?', 136, 136);
        break;
      case 'market': {
        // a shopping bag
        g.lineWidth = 13;
        g.beginPath();
        g.arc(128, 100, 27, Math.PI, 0);
        g.stroke();
        g.beginPath();
        g.roundRect(74, 100, 108, 84, 14);
        g.fill();
        g.shadowColor = 'transparent';
        g.fillStyle = base;
        for (const x of [106, 150]) {
          g.beginPath();
          g.arc(x, 122, 6.5, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'gust': {
        // three lines of wind, the outer two curling at their ends
        g.lineWidth = 13;
        g.beginPath();
        g.moveTo(62, 104);
        g.lineTo(150, 104);
        g.arc(150, 86, 18, Math.PI / 2, -Math.PI * 0.85, true);
        g.stroke();
        g.beginPath();
        g.moveTo(52, 136);
        g.lineTo(200, 136);
        g.stroke();
        g.beginPath();
        g.moveTo(78, 168);
        g.lineTo(152, 168);
        g.arc(152, 186, 18, -Math.PI / 2, Math.PI * 0.85, false);
        g.stroke();
        break;
      }
      case 'post': {
        // a takeaway bag with a smile
        g.beginPath();
        g.moveTo(80, 96);
        g.lineTo(176, 96);
        g.lineTo(186, 190);
        g.lineTo(70, 190);
        g.closePath();
        g.fill();
        g.beginPath();
        g.moveTo(86, 96);
        g.lineTo(98, 66);
        g.lineTo(158, 66);
        g.lineTo(170, 96);
        g.closePath();
        g.fill();
        g.shadowColor = 'transparent';
        g.strokeStyle = base;
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(84, 97);
        g.lineTo(172, 97);
        g.stroke();
        g.lineWidth = 9;
        g.beginPath();
        g.arc(128, 136, 24, Math.PI * 0.15, Math.PI * 0.85);
        g.stroke();
        break;
      }
      case 'dock': {
        // a map pin in the island's colour: orders are dropped here
        const c = dockColor ?? P.denim;
        g.fillStyle = c;
        g.beginPath();
        g.arc(128, 108, 44, Math.PI * 0.83, Math.PI * 0.17);
        g.lineTo(128, 196);
        g.closePath();
        g.fill();
        g.shadowColor = 'transparent';
        g.fillStyle = CREAM;
        g.beginPath();
        g.arc(128, 108, 17, 0, Math.PI * 2);
        g.fill();
        break;
      }
    }
  });
  icons.set(key, tex);
  return tex;
}

let glowTexture: THREE.Texture | null = null;
function glowRing(): THREE.Texture {
  glowTexture ??= canvasTexture(256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 60, 128, 128, 127);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0)');
    grad.addColorStop(0.66, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.76, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  });
  return glowTexture;
}

export interface Tile {
  group: THREE.Group;
  /** The ring of light round the tile (hidden until the tile is on the way ahead). */
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** 0..1, eased towards `glowGoal` every frame. */
  glowNow: number;
  glowGoal: number;
  /** Where along the lit path this tile is (for the travelling pulse). */
  order: number;
}

const faceGeo = new THREE.CircleGeometry(1.03, 48).rotateX(-Math.PI / 2);
const glowGeo = new THREE.PlaneGeometry(3.9, 3.9).rotateX(-Math.PI / 2);
const BASE = '#4b4553';

/** One space of the board, centred on the origin of its group. */
export function buildTile(type: SpaceType, dockColor?: string): Tile {
  const group = new THREE.Group();
  part(group, cyl(TILE_R, TILE_R + 0.07, 0.2, 44), BASE, 0, ISLAND_TOP + 0.1, 0, { outline: 0.05, tex: 'stoneTiles', texStrength: 0.5, texScale: 1.6 });
  part(group, torus(1.085, 0.055), P.brass, 0, ISLAND_TOP + 0.2, 0, { rx: Math.PI / 2, gloss: 0.6, outline: false, shadow: false });
  part(group, cyl(1.03, 1.05, 0.08, 44), mix(TILE_COLORS[type], '#1e1826', 0.25), 0, TILE_TOP - 0.042, 0, { outline: false, shadow: false });
  const face = new THREE.Mesh(faceGeo, new THREE.MeshToonMaterial({ map: tileFace(type, dockColor) }));
  face.position.y = TILE_TOP;
  face.receiveShadow = true;
  group.add(face);
  const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: glowRing(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
  glow.position.y = ISLAND_TOP + 0.05;
  glow.renderOrder = 2;
  glow.visible = false;
  group.add(glow);
  return { group, glow, glowNow: 0, glowGoal: 0, order: 0 };
}
