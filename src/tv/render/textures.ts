// The CC0 texture library (public/textures, credits in public/textures/CREDITS.md) and its loader.
// Textures are fetched from our own server the first time a material asks for one, and are cached for good.
// Until a texture has loaded, a 1×1 placeholder in the texture's average colour stands in, so nothing pops.
//
// Most code never calls this module directly: `part(group, geo, colour, x, y, z, { tex: 'woodFloor' })` in
// toon.ts is the usual way in. The shader maps textures in object space (triplanar), so no UVs are needed and
// the grain is the same size on every shape: `metres` below is how much surface one tile covers.
import * as THREE from 'three';

export interface TextureInfo {
  /** Scene units one tile covers by default (override with `texScale` in part options). */
  metres: number;
  /** The albedo's average colour in linear RGB: tinted materials divide by it, so the tint decides the colour. */
  avg: [number, number, number];
  /** How strongly the normal map bends the light (0 = flat). */
  bump: number;
  /** What it is for (shown in the art-direction guide). */
  use: string;
}

/** Every texture set in public/textures/<name>/ (albedo.webp + normal.webp). */
export const TEXTURES = {
  woodFloor: { metres: 2.2, avg: [0.218, 0.118, 0.055], bump: 0.5, use: 'living-room floorboards' },
  parquet: { metres: 2.0, avg: [0.294, 0.164, 0.075], bump: 0.4, use: 'herringbone parquet, fancier floors' },
  wood: { metres: 1.3, avg: [0.359, 0.211, 0.098], bump: 0.35, use: 'furniture: tables, shelves, frames (fine oak grain)' },
  darkWood: { metres: 1.5, avg: [0.114, 0.025, 0.009], bump: 0.4, use: 'dark furniture, record players, instruments' },
  planks: { metres: 2.0, avg: [0.192, 0.1, 0.042], bump: 0.7, use: 'decks, fences, crates, sheds' },
  fabric: { metres: 0.9, avg: [0.286, 0.41, 0.615], bump: 0.6, use: 'upholstery: sofas, cushions, curtains (linen weave)' },
  velvet: { metres: 0.7, avg: [0.421, 0.027, 0.063], bump: 0.35, use: 'soft, rich seats and beanbags' },
  knit: { metres: 0.5, avg: [0.094, 0.075, 0.052], bump: 0.8, use: 'blankets, knitted throws, woolly rugs' },
  terry: { metres: 0.6, avg: [0.002, 0.066, 0.307], bump: 0.7, use: 'rugs, towels, carpets' },
  plaster: { metres: 2.6, avg: [0.407, 0.367, 0.351], bump: 0.35, use: 'painted interior walls and ceilings' },
  brick: { metres: 2.0, avg: [0.155, 0.1, 0.083], bump: 0.9, use: 'brick walls, chimneys, rooftops' },
  stoneTiles: { metres: 2.4, avg: [0.184, 0.187, 0.175], bump: 0.6, use: 'stone floor tiles, patios, pavements' },
  cobble: { metres: 2.2, avg: [0.281, 0.23, 0.151], bump: 0.9, use: 'garden paths, old streets' },
  kitchenTile: { metres: 1.2, avg: [0.623, 0.581, 0.488], bump: 0.6, use: 'kitchen and bathroom wall tiles' },
  terrazzo: { metres: 1.6, avg: [0.255, 0.158, 0.1], bump: 0.15, use: 'kitchen floors, counters, bar tops' },
  grass: { metres: 3.2, avg: [0.319, 0.236, 0.106], bump: 0.5, use: 'lawns and meadows' },
  sand: { metres: 3.2, avg: [0.382, 0.306, 0.162], bump: 0.6, use: 'beaches, sandpits' },
  concrete: { metres: 3.0, avg: [0.201, 0.169, 0.115], bump: 0.4, use: 'rooftops, pavements, garage floors' },
  metalPlate: { metres: 1.0, avg: [0.049, 0.034, 0.012], bump: 0.8, use: 'tread plate: conveyor frames, machines, vents' },
  leather: { metres: 0.8, avg: [0.083, 0.027, 0.006], bump: 0.5, use: 'armchairs, stools, cases' },
  bark: { metres: 1.4, avg: [0.128, 0.105, 0.063], bump: 0.9, use: 'tree trunks, logs' },
  roofTiles: { metres: 2.0, avg: [0.114, 0.037, 0.013], bump: 0.9, use: 'roofs' },
  gingham: { metres: 0.7, avg: [0.291, 0.346, 0.301], bump: 0.2, use: 'picnic blankets, tablecloths, tea towels' },
  rock: { metres: 3.0, avg: [0.121, 0.062, 0.032], bump: 0.9, use: 'rocks, cliffs, island undersides' },
  patio: { metres: 2.0, avg: [0.444, 0.223, 0.095], bump: 0.5, use: 'terracotta patio tiles' },
} satisfies Record<string, TextureInfo>;

export type TextureName = keyof typeof TEXTURES;

export interface TextureSet {
  name: TextureName;
  info: TextureInfo;
  /** Albedo (sRGB). A placeholder until `ready`. */
  map: THREE.Texture;
  /** Tangent-space normal map (OpenGL convention). A flat placeholder until `ready`. */
  normal: THREE.Texture;
  ready: Promise<void>;
}

/** Where the texture folders live: public/textures, copied into the app's folder. Relative to the page (Vite's base
 *  is './'), so they load from wherever Atelier serves the app. */
const BASE = `${import.meta.env.BASE_URL}textures`;
let anisotropy = 4;
/** The stage sets this to what the GPU supports (capped), before any texture is used. */
export function setTextureAnisotropy(value: number): void {
  anisotropy = Math.max(1, value);
  for (const set of sets.values()) {
    set.map.anisotropy = anisotropy;
    set.normal.anisotropy = anisotropy;
  }
}

function placeholder(r: number, g: number, b: number, srgb: boolean): THREE.Texture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function tiling(srgb: boolean): THREE.Texture {
  const t = new THREE.Texture();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** Fetches an image as a bitmap whatever content type the server gives it. */
async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const blob = new Blob([await res.arrayBuffer()], { type: 'image/webp' });
  return createImageBitmap(blob, { colorSpaceConversion: 'none', imageOrientation: 'flipY' });
}

const toSrgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));

const sets = new Map<TextureName, TextureSet>();

/**
 * A texture set by name: loads it on first use and returns the same textures ever after. The returned textures
 * are usable at once (they show the average colour until the files arrive).
 */
export function textureSet(name: TextureName): TextureSet {
  let set = sets.get(name);
  if (set) return set;
  const info: TextureInfo = TEXTURES[name];
  const map = tiling(true);
  const normal = tiling(false);
  // Placeholders: three.js uploads `image` whenever needsUpdate is set, so a 1×1 canvas-free data image works.
  const flat = placeholder(toSrgb(info.avg[0]), toSrgb(info.avg[1]), toSrgb(info.avg[2]), true);
  const up = placeholder(128, 128, 255, false);
  map.image = flat.image;
  normal.image = up.image;
  (map as THREE.Texture & { isDataTexture?: boolean }).isDataTexture = true;
  (normal as THREE.Texture & { isDataTexture?: boolean }).isDataTexture = true;
  map.generateMipmaps = false;
  normal.generateMipmaps = false;
  map.minFilter = THREE.LinearFilter;
  normal.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  normal.needsUpdate = true;
  const swap = (t: THREE.Texture, bitmap: ImageBitmap) => {
    (t as THREE.Texture & { isDataTexture?: boolean }).isDataTexture = false;
    t.image = bitmap;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    // Changing the image's size and kind needs a fresh GPU texture.
    t.dispose();
    t.needsUpdate = true;
  };
  const ready =
    typeof fetch === 'function' && typeof createImageBitmap === 'function'
      ? Promise.all([loadBitmap(`${BASE}/${name}/albedo.webp`).then((b) => swap(map, b)), loadBitmap(`${BASE}/${name}/normal.webp`).then((b) => swap(normal, b))]).then(
          () => undefined,
          (err: unknown) => console.warn(`texture "${name}" did not load; using its flat colour`, err),
        )
      : Promise.resolve();
  set = { name, info, map, normal, ready };
  sets.set(name, set);
  return set;
}

/** Starts loading these textures now (e.g. while an intro card is up), and resolves when they are all in. */
export function preloadTextures(...names: TextureName[]): Promise<void> {
  return Promise.all(names.map((n) => textureSet(n).ready)).then(() => undefined);
}

/**
 * A plain three.js texture for UV-mapped use (sprites, custom shaders, `map` on your own material):
 * `texture('woodFloor', { repeat: 4 })`. Each call with the same arguments returns the same texture.
 */
const plain = new Map<string, THREE.Texture>();
export function texture(name: TextureName, o: { repeat?: number | [number, number]; normal?: boolean } = {}): THREE.Texture {
  const rep: [number, number] = Array.isArray(o.repeat) ? o.repeat : [o.repeat ?? 1, o.repeat ?? 1];
  const key = `${name}:${o.normal ? 'n' : 'a'}:${rep[0]}:${rep[1]}`;
  let t = plain.get(key);
  if (!t) {
    const set = textureSet(name);
    const source = o.normal ? set.normal : set.map;
    t = source.clone();
    t.repeat.set(rep[0], rep[1]);
    const mine = t;
    void set.ready.then(() => {
      mine.image = source.image;
      (mine as THREE.Texture & { isDataTexture?: boolean }).isDataTexture = false;
      mine.generateMipmaps = true;
      mine.minFilter = THREE.LinearMipmapLinearFilter;
      mine.dispose();
      mine.needsUpdate = true;
    });
    plain.set(key, t);
  }
  return t;
}

// ------------------------------------------------------------------ procedural grain

let grain: THREE.DataTexture | null = null;
/**
 * A small tiling noise texture (two octaves in R, finer speckle in G) that every lit material samples for a hint
 * of surface variation, so even untextured shapes don't look like flat plastic.
 */
export function grainTexture(): THREE.DataTexture {
  if (grain) return grain;
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const lattice = (cells: number) => {
    const v = new Float32Array(cells * cells);
    for (let i = 0; i < v.length; i++) v[i] = rnd();
    return (x: number, y: number) => {
      const fx = (x / N) * cells;
      const fy = (y / N) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (ix: number, iy: number) => v[(iy % cells) * cells + (ix % cells)] as number;
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  const a = lattice(4);
  const b = lattice(11);
  const c = lattice(29);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      data[i] = Math.round(255 * (a(x, y) * 0.5 + b(x, y) * 0.32 + c(x, y) * 0.18));
      data[i + 1] = Math.round(255 * (c(x, y) * 0.5 + rnd() * 0.5));
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  grain = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  grain.wrapS = THREE.RepeatWrapping;
  grain.wrapT = THREE.RepeatWrapping;
  grain.minFilter = THREE.LinearMipmapLinearFilter;
  grain.magFilter = THREE.LinearFilter;
  grain.generateMipmaps = true;
  grain.needsUpdate = true;
  return grain;
}
