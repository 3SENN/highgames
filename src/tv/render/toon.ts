// The house style, in code: soft toon shading (a two-step ramp with a rim light and a hint of surface grain),
// thin dark tinted outlines, a grown-up palette, gradient skies and tidy labels. Everything in the game is built
// from these: `part` adds one shape to a group; geometries and materials are shared.
//
// Art direction and recipes: docs/art-direction.md. Textures: ./textures.ts (use `{ tex: 'woodFloor' }` in part
// options). Ready-made furniture and whole rooms: ./props.ts and ./env.ts. Post-processing: ./post.ts.
//
// Every export that existed before the redesign still works the same way, so older scenes simply look better.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TEXTURES, type TextureName, grainTexture, textureSet } from './textures';

export interface PartOptions {
  rx?: number;
  ry?: number;
  rz?: number;
  s?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Emissive strength; 1 and above also drops the outline (and blooms). */
  glow?: number;
  /** Flat, unlit colour (no outline). */
  basic?: boolean;
  shadow?: boolean;
  material?: THREE.Material;
  opacity?: number;
  /** false = no outline; a number = this outline width instead of the current one. */
  outline?: false | number;
  /** A texture from the library (./textures.ts), mapped without UVs. The colour tints it. */
  tex?: TextureName;
  /** Scene units one texture tile covers (default: the texture's own `metres`). */
  texScale?: number;
  /** 0..1: how much of the texture's detail shows (default 1). */
  texStrength?: number;
  /** Show the texture's own colours, multiplied by the colour (pass '#ffffff' for the texture as it is). */
  texNatural?: boolean;
  /** 0..1: a soft highlight from the key light, for glazed, polished or wet things (ceramic, metal, leather). */
  gloss?: number;
  /** Multiplies the rim light on this material (0 = none, default 1). */
  rim?: number;
  /** Use the colour exactly as given (skip the gentle softening of very saturated or very bright colours). */
  exact?: boolean;
}

// ------------------------------------------------------------------ the look shared by all materials

/**
 * Uniforms every toon material reads. The stage sets them each frame from the shown scene's `userData.look`
 * (which `applySky` and the environment builders fill in), so the rim light always matches the scene's light.
 */
export const LOOK_UNIFORMS = {
  hgRimColor: { value: new THREE.Color('#ffe9d0') },
  hgRimStrength: { value: 0.3 },
  /** Direction towards the key light, in world space. */
  hgKeyDir: { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() },
  hgKeyColor: { value: new THREE.Color('#fff2dc') },
  /** Outlines are unlit, so dark scenes turn them down (or they would glow against shaded surfaces). */
  hgOutline: { value: 1 },
};

/** What a scene can say about its light, in `scene.userData.look` (see `setLook`). */
export interface SceneLook {
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number;
  keyDir?: [number, number, number];
  keyColor?: THREE.ColorRepresentation;
  /** 0..1: how bright outlines are drawn (1 by day, about 0.5 at night). */
  outline?: number;
}

/** Sets the rim and highlight light for a scene (the stage applies it while the scene is shown). */
export function setLook(scene: THREE.Scene, look: SceneLook): void {
  scene.userData.look = { ...(scene.userData.look as SceneLook | undefined), ...look };
}

const DEFAULT_LOOK: Required<SceneLook> = { rimColor: '#ffe9d0', rimStrength: 0.3, keyDir: [0.4, 0.8, 0.45], keyColor: '#fff2dc', outline: 1 };
/** Called by the stage before rendering a scene. */
export function applyLook(scene: THREE.Scene): void {
  const look = { ...DEFAULT_LOOK, ...(scene.userData.look as SceneLook | undefined) };
  LOOK_UNIFORMS.hgRimColor.value.set(look.rimColor);
  LOOK_UNIFORMS.hgRimStrength.value = look.rimStrength;
  LOOK_UNIFORMS.hgKeyDir.value.set(look.keyDir[0], look.keyDir[1], look.keyDir[2]).normalize();
  LOOK_UNIFORMS.hgKeyColor.value.set(look.keyColor);
  LOOK_UNIFORMS.hgOutline.value = look.outline;
}

/** Software renderers skip the normal maps (three extra texture reads per pixel). The stage sets this. */
export const RENDER_HINTS = { normalMaps: true };

// ------------------------------------------------------------------ materials

let gradient: THREE.DataTexture | null = null;
/**
 * The light ramp: a soft two-step toon curve (shade, a broad midtone, then light), smooth at the steps so
 * round shapes read as round without the hard cel bands.
 */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    const N = 128;
    const data = new Uint8Array(N);
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    for (let i = 0; i < N; i++) {
      const d = (i / (N - 1)) * 2 - 1; // dot(normal, light)
      const v = 0.3 + 0.44 * smooth(-0.12, 0.22, d) + 0.08 * smooth(0.2, 0.55, d) + 0.18 * smooth(0.5, 0.78, d);
      data[i] = Math.round(255 * v);
    }
    gradient = new THREE.DataTexture(data, N, 1, THREE.RedFormat);
    gradient.minFilter = THREE.LinearFilter;
    gradient.magFilter = THREE.LinearFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

interface Finish {
  tex?: TextureName;
  texScale?: number;
  texStrength?: number;
  texNatural?: boolean;
  gloss?: number;
  rim?: number;
  grain?: number;
}

const VERTEX_PARS = /* glsl */ `
#if defined( HG_TEX ) || defined( HG_GRAIN )
  varying vec3 vHgPos;
  varying vec3 vHgN;
#endif
`;
const VERTEX_MAIN = /* glsl */ `
#if defined( HG_TEX ) || defined( HG_GRAIN )
  // Object space, scaled by the node's size: textures keep one size on every shape and move with the object.
  vHgPos = position * vec3( length( modelMatrix[0].xyz ), length( modelMatrix[1].xyz ), length( modelMatrix[2].xyz ) );
  vHgN = normal;
#endif
`;
const FRAGMENT_PARS = /* glsl */ `
uniform vec3 hgRimColor;
uniform float hgRimStrength;
uniform vec3 hgKeyDir;
uniform vec3 hgKeyColor;
uniform float hgRimMul;
uniform float hgGloss;
#if defined( HG_TEX ) || defined( HG_GRAIN )
  varying vec3 vHgPos;
  varying vec3 vHgN;
  vec3 hgWeights() {
    vec3 w = abs( normalize( vHgN ) );
    w = w * w * w * w;
    return w / ( w.x + w.y + w.z );
  }
#endif
#ifdef HG_TEX
  uniform sampler2D hgMap;
  uniform vec3 hgAvg;
  uniform float hgTexScale;
  uniform float hgTexStrength;
#endif
#ifdef HG_TEXNORMAL
  uniform sampler2D hgNormalMap;
  uniform float hgBump;
  uniform mat3 normalMatrix;
#endif
#ifdef HG_GRAIN
  uniform sampler2D hgGrainMap;
  uniform float hgGrain;
#endif
`;
const FRAGMENT_MAP = /* glsl */ `
#ifdef HG_TEX
  {
    vec3 w = hgWeights();
    vec3 p = vHgPos * hgTexScale;
    vec3 t = texture2D( hgMap, p.zy ).rgb * w.x + texture2D( hgMap, p.xz ).rgb * w.y + texture2D( hgMap, p.xy ).rgb * w.z;
    #ifdef HG_TEXNATURAL
      diffuseColor.rgb *= mix( vec3( 1.0 ), t, hgTexStrength );
    #else
      // mostly the texture's light and dark, with a little of its own colour variation
      const vec3 hgLuma = vec3( 0.2126, 0.7152, 0.0722 );
      vec3 detail = mix( vec3( dot( t, hgLuma ) / dot( hgAvg, hgLuma ) ), clamp( t / hgAvg, 0.5, 1.6 ), 0.2 );
      diffuseColor.rgb *= mix( vec3( 1.0 ), clamp( detail, 0.0, 2.0 ), hgTexStrength );
    #endif
  }
#endif
#ifdef HG_GRAIN
  {
    vec3 w = hgWeights();
    vec3 p = vHgPos * 0.31;
    float g = texture2D( hgGrainMap, p.zy ).r * w.x + texture2D( hgGrainMap, p.xz ).r * w.y + texture2D( hgGrainMap, p.xy ).r * w.z;
    diffuseColor.rgb *= 1.0 + ( g - 0.5 ) * hgGrain;
  }
#endif
`;
const FRAGMENT_NORMAL = /* glsl */ `
#ifdef HG_TEXNORMAL
  {
    vec3 w = hgWeights();
    vec3 p = vHgPos * hgTexScale;
    vec2 tx = texture2D( hgNormalMap, p.zy ).xy * 2.0 - 1.0;
    vec2 ty = texture2D( hgNormalMap, p.xz ).xy * 2.0 - 1.0;
    vec2 tz = texture2D( hgNormalMap, p.xy ).xy * 2.0 - 1.0;
    vec3 bend = vec3( 0.0, tx.y, tx.x ) * w.x + vec3( ty.x, 0.0, ty.y ) * w.y + vec3( tz.x, tz.y, 0.0 ) * w.z;
    normal = normalize( normal + normalMatrix * bend * hgBump );
  }
#endif
`;
const FRAGMENT_RIM = /* glsl */ `
  {
    vec3 hgV = normalize( vViewPosition );
    float hgF = 1.0 - saturate( dot( normal, hgV ) );
    vec3 hgUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
    float hgSky = saturate( dot( normal, hgUp ) * 0.5 + 0.7 );
    outgoingLight += hgRimColor * ( hgF * hgF * hgF * hgF * hgSky * hgRimStrength * hgRimMul ) * ( 0.3 + 0.7 * diffuseColor.rgb );
    #ifdef HG_GLOSS
      vec3 hgL = normalize( ( viewMatrix * vec4( hgKeyDir, 0.0 ) ).xyz );
      float hgS = pow( saturate( dot( normal, normalize( hgL + hgV ) ) ), 60.0 );
      outgoingLight += hgKeyColor * ( smoothstep( 0.25, 0.7, hgS ) * hgGloss );
    #endif
  }
`;

/**
 * The game's toon material: three.js's MeshToonMaterial with the soft ramp, a rim light, optional library
 * texture, gloss and grain. Cloning keeps all of it.
 */
export class HgToonMaterial extends THREE.MeshToonMaterial {
  private hg: Record<string, THREE.IUniform>;

  constructor(params: THREE.MeshToonMaterialParameters = {}, finish: Finish = {}) {
    super({ gradientMap: toonGradient(), ...params });
    this.hg = { hgRimMul: { value: 1 }, hgGloss: { value: 0 } };
    this.defines = { ...(this.defines ?? {}) };
    this.setFinish(finish);
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, LOOK_UNIFORMS, this.hg);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAGMENT_MAP}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`)
        .replace('#include <opaque_fragment>', `${FRAGMENT_RIM}\n#include <opaque_fragment>`);
    };
  }

  /** Changes the texture, gloss, rim or grain. (Call before the material is first drawn, or set needsUpdate.) */
  setFinish(f: Finish): this {
    const d = this.defines as Record<string, string>;
    const u = this.hg;
    if (f.rim !== undefined) (u.hgRimMul as THREE.IUniform<number>).value = f.rim;
    if (f.gloss !== undefined) {
      (u.hgGloss as THREE.IUniform<number>).value = f.gloss;
      if (f.gloss > 0) d.HG_GLOSS = '';
      else delete d.HG_GLOSS;
    }
    const grain = f.grain ?? (u.hgGrain ? (u.hgGrain.value as number) : 0.07);
    if (grain > 0) {
      d.HG_GRAIN = '';
      u.hgGrainMap = { value: grainTexture() };
      u.hgGrain = { value: grain };
    } else delete d.HG_GRAIN;
    if (f.tex) {
      const set = textureSet(f.tex);
      const info = TEXTURES[f.tex];
      d.HG_TEX = '';
      u.hgMap = { value: set.map };
      u.hgAvg = { value: new THREE.Vector3(...info.avg) };
      u.hgTexScale = { value: 1 / (f.texScale ?? info.metres) };
      u.hgTexStrength = { value: f.texStrength ?? 1 };
      if (f.texNatural) d.HG_TEXNATURAL = '';
      if (RENDER_HINTS.normalMaps && info.bump > 0) {
        d.HG_TEXNORMAL = '';
        u.hgNormalMap = { value: set.normal };
        u.hgBump = { value: info.bump * (f.texStrength ?? 1) };
      }
    }
    this.needsUpdate = true;
    return this;
  }

  override copy(source: THREE.MeshToonMaterial): this {
    super.copy(source);
    const from = (source as HgToonMaterial).hg;
    if (from) {
      // Own values, shared textures.
      this.hg = {};
      for (const [k, v] of Object.entries(from)) {
        const val: unknown = v.value;
        this.hg[k] = { value: val instanceof THREE.Vector3 ? val.clone() : val };
      }
    }
    return this;
  }
}

/** A toon material in the house style. Takes the same parameters as THREE.MeshToonMaterial. */
export function toonMat(params: THREE.MeshToonMaterialParameters = {}, finish: Finish = {}): HgToonMaterial {
  return new HgToonMaterial(params, finish);
}

/**
 * A lit material with a library texture, for meshes you build yourself:
 * `new THREE.Mesh(geo, texturedMaterial('brick', { color: PALETTE.brick, scale: 2 }))`.
 */
export function texturedMaterial(tex: TextureName, o: { color?: string; scale?: number; strength?: number; natural?: boolean; gloss?: number; side?: THREE.Side } = {}): HgToonMaterial {
  return toonMat(
    { color: o.color ?? '#ffffff', ...(o.side !== undefined ? { side: o.side } : {}) },
    { tex, ...(o.scale !== undefined ? { texScale: o.scale } : {}), ...(o.strength !== undefined ? { texStrength: o.strength } : {}), texNatural: o.natural ?? o.color === undefined, ...(o.gloss ? { gloss: o.gloss } : {}) },
  );
}

const refined = new Map<string, string>();
/**
 * Softens colours that would shout: very saturated ones lose a little saturation and near-whites come down a
 * touch, so old candy colours sit in the new palette. Hue never changes. `part(..., { exact: true })` skips it.
 */
export function refine(color: string): string {
  let out = refined.get(color);
  if (!out) {
    const c = new THREE.Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl, THREE.SRGBColorSpace);
    let { s, l } = hsl;
    if (s > 0.6) s = 0.6 + (s - 0.6) * 0.6;
    if (l > 0.84) l = 0.84 + (l - 0.84) * 0.55;
    c.setHSL(hsl.h, s, l, THREE.SRGBColorSpace);
    out = `#${c.getHexString()}`;
    refined.set(color, out);
  }
  return out;
}

const materials = new Map<string, THREE.Material>();
/** The shared material for a colour and options (the same ones `part` takes). */
export function material(color: string, o: PartOptions = {}): THREE.Material {
  const key = `${color}:${o.glow ?? ''}:${o.basic ? 'b' : ''}:${o.opacity ?? ''}:${o.tex ?? ''}:${o.texScale ?? ''}:${o.texStrength ?? ''}:${o.texNatural ? 'n' : ''}:${o.gloss ?? ''}:${o.rim ?? ''}:${o.exact ? 'x' : ''}`;
  let m = materials.get(key);
  if (!m) {
    const transparent = o.opacity !== undefined && o.opacity < 1;
    if (o.basic) {
      m = new THREE.MeshBasicMaterial({ color, transparent, opacity: o.opacity ?? 1, toneMapped: false });
    } else {
      const glowing = (o.glow ?? 0) > 0;
      const shown = o.exact || glowing ? color : refine(color);
      m = toonMat(
        {
          color: shown,
          transparent,
          opacity: o.opacity ?? 1,
          depthWrite: !transparent,
          ...(o.glow ? { emissive: new THREE.Color(color), emissiveIntensity: o.glow } : {}),
        },
        {
          ...(o.tex ? { tex: o.tex } : {}),
          ...(o.texScale !== undefined ? { texScale: o.texScale } : {}),
          ...(o.texStrength !== undefined ? { texStrength: o.texStrength } : {}),
          ...(o.texNatural ? { texNatural: true } : {}),
          ...(o.gloss !== undefined ? { gloss: o.gloss } : {}),
          ...(o.rim !== undefined ? { rim: o.rim } : {}),
          grain: transparent || glowing ? 0 : 0.07,
        },
      );
    }
    materials.set(key, m);
  }
  return m;
}

// ------------------------------------------------------------------ outlines

/** Outlines are drawn at this share of the width a scene asks for: the house style is now a thin, dark line. */
const OUTLINE_SCALE = 0.5;
/** Outlines lean towards this ink rather than plain black, so they stay warm. */
const OUTLINE_INK = new THREE.Color('#1c1524');

// The hull is pushed out along world-space normals, so its width is in world units whatever the node's scale.
const OUTLINE_VERTEX = /* glsl */ `
uniform float thickness;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  world.xyz += n * thickness;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const OUTLINE_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float hgOutline;
#include <common>
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(color * hgOutline, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const outlines = new Map<string, THREE.ShaderMaterial>();
/** The outline material for a colour: the colour taken well down towards a warm ink. */
export function outlineMaterial(color: THREE.ColorRepresentation, thickness: number): THREE.ShaderMaterial {
  const dark = new THREE.Color(color).multiplyScalar(0.38).lerp(OUTLINE_INK, 0.42);
  const key = `${dark.getHexString()}:${thickness}`;
  let m = outlines.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      name: 'outline',
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), color: { value: dark }, thickness: { value: thickness * OUTLINE_SCALE }, hgOutline: LOOK_UNIFORMS.hgOutline },
      vertexShader: OUTLINE_VERTEX,
      fragmentShader: OUTLINE_FRAGMENT,
      side: THREE.BackSide,
      fog: true,
    });
    outlines.set(key, m);
  }
  return m;
}

/** Hull geometry with welded corners and smooth normals, so boxes and cylinders get an unbroken outline. */
const hulls = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function hullOf(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let h = hulls.get(g);
  if (!h) {
    const bare = new THREE.BufferGeometry();
    bare.setAttribute('position', g.getAttribute('position'));
    if (g.index) bare.setIndex(g.index);
    h = mergeVertices(bare, 1e-4);
    h.computeVertexNormals();
    hulls.set(g, h);
  }
  return h;
}

let outlineWidth = 0.03;
/** Builds with a different outline width: thicker for the big board pieces seen from far away. */
export function withOutline<T>(width: number, f: () => T): T {
  const prev = outlineWidth;
  outlineWidth = width;
  try {
    return f();
  } finally {
    outlineWidth = prev;
  }
}

export function addOutline(mesh: THREE.Mesh, color: THREE.ColorRepresentation, width = outlineWidth): void {
  if (width <= 0) return;
  const g = mesh.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const scale = Math.max(Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z));
  if ((g.boundingSphere?.radius ?? 1) * scale < width * 1.6) return;
  const hull = new THREE.Mesh(hullOf(g), outlineMaterial(color, width));
  hull.name = 'outline';
  hull.raycast = () => {};
  hull.castShadow = false;
  hull.receiveShadow = false;
  mesh.add(hull);
}

// ------------------------------------------------------------------ shared geometry

const geometries = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geometries.get(key) as T | undefined;
  if (!g) {
    g = make();
    geometries.set(key, g);
  }
  return g;
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const box = (w: number, h: number, d: number) => geo(`box:${r3(w)}:${r3(h)}:${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
export const rbox = (w: number, h: number, d: number, r = 0.06) => geo(`rbox:${r3(w)}:${r3(h)}:${r3(d)}:${r}`, () => roundedBox(w, h, d, r));
export const cyl = (top: number, bottom: number, h: number, seg = 18) =>
  geo(`cyl:${r3(top)}:${r3(bottom)}:${r3(h)}:${seg}`, () => new THREE.CylinderGeometry(top, bottom, h, seg));
export const ball = (r: number, detail = 2) => geo(`ball:${r3(r)}:${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
export const cone = (r: number, h: number, seg = 18) => geo(`cone:${r3(r)}:${r3(h)}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));
export const pill = (r: number, len: number) => geo(`pill:${r3(r)}:${r3(len)}`, () => new THREE.CapsuleGeometry(r, len, 4, 14));
export const torus = (r: number, tube: number, arc = Math.PI * 2) =>
  geo(`torus:${r3(r)}:${r3(tube)}:${r3(arc)}`, () => new THREE.TorusGeometry(r, tube, 10, 28, arc));
export const plane = (w: number, h: number) => geo(`plane:${r3(w)}:${r3(h)}`, () => new THREE.PlaneGeometry(w, h));
export const dome = (r: number) => geo(`dome:${r3(r)}`, () => new THREE.SphereGeometry(r, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2));
export const gem = (r: number) => geo(`gem:${r3(r)}`, () => new THREE.OctahedronGeometry(r, 0));
/** A smooth sphere (rounder than `ball`), for lamps, fruit and anything seen up close. */
export const sphere = (r: number, seg = 24) => geo(`sphere:${r3(r)}:${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.66))));
/** A flat disc lying on the ground (facing up). */
export const disc = (r: number, seg = 40) =>
  geo(`disc:${r3(r)}:${seg}`, () => {
    const g = new THREE.CircleGeometry(r, seg);
    g.rotateX(-Math.PI / 2);
    return g;
  });
/** A solid of revolution from a profile of [radius, height] points (vases, lampshades, bowls, mugs). */
export const lathe = (profile: readonly (readonly [number, number])[], seg = 24) =>
  geo(`lathe:${profile.map((p) => `${r3(p[0])},${r3(p[1])}`).join(';')}:${seg}`, () => {
    const g = new THREE.LatheGeometry(
      profile.map((p) => new THREE.Vector2(Math.max(0.0001, p[0]), p[1])),
      seg,
    );
    g.computeVertexNormals();
    return g;
  });

/** A box with bevelled edges (an extruded rounded rectangle), for the soft look. */
function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 0.001, d / 2 - 0.001, h / 2 - 0.001);
  const shape = new THREE.Shape();
  const x = -w / 2 + rr;
  const z = -d / 2 + rr;
  const W = w - 2 * rr;
  const D = d - 2 * rr;
  shape.moveTo(x, z);
  shape.lineTo(x + W, z);
  shape.quadraticCurveTo(x + W + rr, z, x + W + rr, z + rr);
  shape.lineTo(x + W + rr, z + D);
  shape.quadraticCurveTo(x + W + rr, z + D + rr, x + W, z + D + rr);
  shape.lineTo(x, z + D + rr);
  shape.quadraticCurveTo(x - rr, z + D + rr, x - rr, z + D);
  shape.lineTo(x - rr, z + rr);
  shape.quadraticCurveTo(x - rr, z, x, z);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h - 2 * rr, bevelEnabled: true, bevelThickness: rr, bevelSize: 0, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(Math.PI / 2);
  g.translate(0, h / 2 - rr, 0);
  g.computeVertexNormals();
  return g;
}

/** Adds one shape to a group. Solid shapes get a thin outline in their own colour, darkened. */
export function part(group: THREE.Object3D, geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, o: PartOptions = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, o.material ?? material(color, o));
  mesh.position.set(x, y, z);
  mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  if (o.s) mesh.scale.setScalar(o.s);
  if (o.sx || o.sy || o.sz) mesh.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  mesh.castShadow = o.shadow !== false;
  mesh.receiveShadow = true;
  const transparentMat = o.material ? (o.material as THREE.Material).transparent : false;
  const solid = !o.basic && !(o.opacity !== undefined && o.opacity < 1) && (o.glow ?? 0) < 1 && !transparentMat;
  if (o.outline !== false && solid) {
    const c = o.material && 'color' in o.material ? (o.material as THREE.MeshToonMaterial).color : color;
    addOutline(mesh, c, typeof o.outline === 'number' ? o.outline : outlineWidth);
  }
  group.add(mesh);
  return mesh;
}

// ------------------------------------------------------------------ textures, labels, helpers

/** The game's typeface for anything drawn on a canvas (Inter, served from public/fonts by the page's CSS). */
export const FONT = '"Inter Variable", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif';
/** The old name for FONT, kept so existing scenes pick up the new typeface. */
export const ROUNDED_FONT = FONT;

// Canvas text is drawn once, so the typeface is fetched straight away; labels drawn before it arrives are redrawn.
let fontReady = false;
const lateDraws: (() => void)[] = [];
if (typeof document !== 'undefined' && document.fonts) {
  void Promise.all([500, 650, 800].map((weight) => document.fonts.load(`${weight} 32px "Inter Variable"`)))
    .catch(() => undefined)
    .then(() => {
      fontReady = true;
      for (const redraw of lateDraws.splice(0)) redraw();
    });
} else fontReady = true;

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  draw(ctx, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  if (!fontReady) {
    // Drawn before the typeface arrived (the board's labels at page load): draw once more when it is in.
    lateDraws.push(() => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.restore();
      draw(ctx, w, h);
      texture.needsUpdate = true;
    });
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * A name on a compact dark pill with a dot in the player's colour; the same size on screen however far away
 * (map-label style).
 */
export function nameCard(text: string, accent: string, size = 1): THREE.Sprite {
  const texture = canvasTexture(512, 128, (ctx) => {
    ctx.font = `650 46px ${FONT}`;
    ctx.letterSpacing = '0.5px';
    const width = Math.min(496, ctx.measureText(text).width + 86);
    const left = (512 - width) / 2;
    ctx.shadowColor = 'rgba(8,6,14,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = 'rgba(24,20,32,0.86)';
    ctx.beginPath();
    ctx.roundRect(left, 26, width, 76, 38);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(left + 1, 27, width - 2, 74, 37);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(left + 36, 64, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6f1ea';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 58, 66, width - 84);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }));
  sprite.scale.set(0.15 * size, 0.0375 * size, 1);
  sprite.renderOrder = 5;
  return sprite;
}

/** Big floating words (coins gained, "Too early"): clean heavy type with a fine dark edge, always on top. */
export function popSprite(text: string, color = '#FFFFFF', height = 1.2): THREE.Sprite {
  const size = 70;
  const texture = canvasTexture(1024, 112, (ctx) => {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.letterSpacing = '-1px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(10,8,18,0.45)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(22,18,30,0.92)';
    ctx.strokeText(text, 512, 58, 1000);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = color;
    ctx.fillText(text, 512, 58, 1000);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, fog: false }));
  sprite.scale.set((1024 / 112) * height, height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

/** Deterministic pseudo-random numbers from a seed (cosmetic variation that stays the same every game). */
export function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------------ skies and palette

export interface SkyLook {
  /** The haze colour: the fog, and what shows behind everything when there is no sky dome. */
  background: string;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  sun: string;
  sunIntensity: number;
  sunFrom: [number, number, number];
  /** Sky dome colours. Without `zenith` a soft gradient is made from `background`. */
  zenith?: string;
  horizon?: string;
  /** The colour far below the horizon (what a camera looking down sees). */
  ground?: string;
  /** 0..1: the sun or moon's disc and halo in the sky. */
  sunGlow?: number;
  /** A moon instead of a sun. */
  moon?: boolean;
  /** 0..1: stars. */
  stars?: number;
  /** 0..1: soft drifting clouds. */
  clouds?: number;
  cloudColor?: string;
  /** Flat fill light that keeps shadows from going dead (colour and strength). */
  ambient?: string;
  ambientIntensity?: number;
  /** Rim light colour and strength for this sky. */
  rim?: string;
  rimStrength?: number;
  /** 0..1: how bright outlines are drawn under this sky (unlit lines must dim with the light). */
  outline?: number;
  /** The colour grade the stage uses while this scene shows (a name from GRADES in post.ts). */
  grade?: string;
}

/**
 * The sky presets: sky dome, fog, lights, rim light and colour grade together. The names are the times of day;
 * indoors, pick by mood (`afternoon` = golden hour, `dusk` = warm lamps and purple shade, `night` = moonlit).
 */
export const SKIES = {
  morning: {
    background: '#e6d6c9',
    zenith: '#7fa9d2',
    horizon: '#f2dcc6',
    ground: '#d3c2bb',
    hemiSky: '#dcebfa',
    hemiGround: '#a89a86',
    hemi: 0.8,
    sun: '#ffe1b4',
    sunIntensity: 2.0,
    sunFrom: [-0.8, 0.75, 0.5],
    sunGlow: 0.8,
    clouds: 0.55,
    cloudColor: '#fff4e6',
    ambient: '#cdd8ff',
    ambientIntensity: 0.14,
    rim: '#fff0da',
    rimStrength: 0.3,
    grade: 'day',
  },
  midday: {
    background: '#c2d9e8',
    zenith: '#4a8ccc',
    horizon: '#d2e6ef',
    ground: '#b1cbd9',
    hemiSky: '#e2efff',
    hemiGround: '#9fae88',
    hemi: 0.85,
    sun: '#fff5e2',
    sunIntensity: 2.2,
    sunFrom: [0.3, 1, 0.45],
    sunGlow: 0.6,
    clouds: 0.6,
    cloudColor: '#ffffff',
    ambient: '#d6e2ff',
    ambientIntensity: 0.14,
    rim: '#ffffff',
    rimStrength: 0.28,
    grade: 'day',
  },
  afternoon: {
    background: '#eac49b',
    zenith: '#6a90ba',
    horizon: '#f7cd97',
    ground: '#d6aa87',
    hemiSky: '#f1e6e8',
    hemiGround: '#a08c7c',
    hemi: 0.92,
    sun: '#ffcb94',
    sunIntensity: 2.0,
    sunFrom: [0.85, 0.55, 0.3],
    sunGlow: 1,
    clouds: 0.5,
    cloudColor: '#ffe3c2',
    ambient: '#c9c4ff',
    ambientIntensity: 0.18,
    rim: '#ffd6a2',
    rimStrength: 0.36,
    outline: 0.9,
    grade: 'golden',
  },
  dusk: {
    background: '#6b5077',
    zenith: '#272858',
    horizon: '#e28c70',
    ground: '#4c3b66',
    hemiSky: '#cdbbe2',
    hemiGround: '#5a4c68',
    hemi: 0.84,
    sun: '#ffc09a',
    sunIntensity: 1.35,
    sunFrom: [0.9, 0.3, -0.2],
    sunGlow: 1,
    stars: 0.35,
    clouds: 0.45,
    cloudColor: '#f2a08a',
    ambient: '#b9a6ff',
    ambientIntensity: 0.16,
    rim: '#ffb690',
    rimStrength: 0.36,
    outline: 0.7,
    grade: 'dusk',
  },
  night: {
    background: '#141938',
    zenith: '#080b22',
    horizon: '#242f58',
    ground: '#101430',
    hemiSky: '#646b9c',
    hemiGround: '#1d2236',
    hemi: 0.6,
    sun: '#b8ccff',
    sunIntensity: 0.7,
    sunFrom: [-0.4, 0.9, -0.3],
    sunGlow: 0.9,
    moon: true,
    stars: 1,
    clouds: 0.3,
    cloudColor: '#3a4a86',
    ambient: '#8d96c6',
    ambientIntensity: 0.16,
    rim: '#a3b8ff',
    rimStrength: 0.42,
    outline: 0.45,
    grade: 'night',
  },
} satisfies Record<string, SkyLook>;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = p.xyww;
}
`;
const SKY_FRAGMENT = /* glsl */ `
varying vec3 vDir;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 cloudColor;
uniform float sunGlow;
uniform float moon;
uniform float stars;
uniform float clouds;
uniform float time;
uniform float show;
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float fbm( vec2 p ) { return vnoise( p ) * 0.5 + vnoise( p * 2.1 + 7.3 ) * 0.3 + vnoise( p * 4.3 + 1.7 ) * 0.2; }
void main() {
  if ( show < 0.5 ) discard;
  vec3 d = normalize( vDir );
  float h = d.y;
  vec3 col = mix( horizon, zenith, 1.0 - exp( -max( h, 0.0 ) * 3.2 ) );
  col = mix( col, ground, smoothstep( 0.0, -0.45, h ) );
  // a band of warm haze hugging the horizon
  col = mix( col, horizon, exp( -abs( h ) * 9.0 ) * 0.6 );
  float sd = max( dot( d, sunDir ), 0.0 );
  float up = smoothstep( -0.08, 0.05, h );
  if ( stars > 0.0 && h > 0.0 ) {
    vec2 uv = d.xz / ( h + 0.4 ) * 26.0;
    vec2 cell = floor( uv );
    float r = hash( cell );
    vec2 at = fract( uv ) - 0.5 - ( vec2( hash( cell + 3.1 ), hash( cell + 7.7 ) ) - 0.5 ) * 0.6;
    float s = smoothstep( 0.09, 0.0, length( at ) ) * step( 0.82, r );
    s *= 0.55 + 0.45 * sin( time * ( 0.6 + r * 1.8 ) + r * 40.0 );
    col += vec3( 0.9, 0.93, 1.0 ) * s * stars * smoothstep( 0.02, 0.3, h );
  }
  if ( clouds > 0.0 && h > -0.02 ) {
    vec2 uv = d.xz / ( h + 0.22 ) * 0.9 + vec2( time * 0.006, 0.0 );
    float c = smoothstep( 0.48, 0.78, fbm( uv ) ) * smoothstep( 0.0, 0.16, h ) * clouds;
    vec3 lit = mix( cloudColor, cloudColor + sunColor * 0.35, pow( sd, 4.0 ) );
    col = mix( col, lit, c * 0.85 );
  }
  if ( sunGlow > 0.0 ) {
    col += sunColor * ( pow( sd, 6.0 ) * 0.16 + pow( sd, 40.0 ) * 0.3 ) * sunGlow * up;
    float disc = smoothstep( 0.9990, 0.9994, sd );
    vec3 face = mix( sunColor * 1.9 + 0.25, vec3( 0.93, 0.95, 1.0 ) * 1.25, moon );
    col = mix( col, face, disc * up * sunGlow );
  }
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

let skyGeometry: THREE.BufferGeometry | null = null;
const skyClock = { value: 0 };
/** The stage advances this so stars twinkle and clouds drift. */
export function tickSky(time: number): void {
  skyClock.value = time;
}

/** A sky dome that follows the camera. It hides itself if the scene later swaps to another background colour. */
function skyDome(scene: THREE.Scene, sky: SkyLook): THREE.Mesh {
  skyGeometry ??= new THREE.SphereGeometry(1, 32, 20);
  const bg = new THREE.Color(sky.background);
  const zenith = sky.zenith ? new THREE.Color(sky.zenith) : bg.clone().multiply(new THREE.Color(0.7, 0.74, 0.86));
  const horizon = sky.horizon ? new THREE.Color(sky.horizon) : bg.clone().lerp(new THREE.Color('#ffffff'), 0.06);
  const ground = sky.ground ? new THREE.Color(sky.ground) : bg.clone().multiplyScalar(0.86);
  const sunDir = new THREE.Vector3(...sky.sunFrom).normalize();
  const uniforms = {
    zenith: { value: zenith },
    horizon: { value: horizon },
    ground: { value: ground },
    sunDir: { value: sunDir },
    sunColor: { value: new THREE.Color(sky.sun) },
    cloudColor: { value: new THREE.Color(sky.cloudColor ?? '#ffffff') },
    sunGlow: { value: sky.zenith ? (sky.sunGlow ?? 0) : 0 },
    moon: { value: sky.moon ? 1 : 0 },
    stars: { value: sky.zenith ? (sky.stars ?? 0) : 0 },
    clouds: { value: sky.zenith ? (sky.clouds ?? 0) : 0 },
    time: skyClock,
    show: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ name: 'sky', uniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(skyGeometry, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  const want = bg.getHex();
  mesh.onBeforeRender = () => {
    const now = scene.background;
    uniforms.show.value = now instanceof THREE.Color && now.getHex() === want ? 1 : 0;
  };
  return mesh;
}

/**
 * Sets a scene's sky dome, fog, lights, rim light and colour grade from a sky. Returns the sun so the view can
 * aim its shadows.
 */
export function applySky(scene: THREE.Scene, sky: SkyLook, fog: { near: number; far: number }, shadowSize = 40): THREE.DirectionalLight {
  scene.background = new THREE.Color(sky.background);
  scene.fog = new THREE.Fog(sky.background, fog.near, fog.far);
  scene.add(skyDome(scene, sky));
  scene.add(new THREE.HemisphereLight(sky.hemiSky, sky.hemiGround, sky.hemi));
  scene.add(new THREE.AmbientLight(sky.ambient ?? '#ffe9cf', sky.ambientIntensity ?? 0.2));
  const sun = new THREE.DirectionalLight(sky.sun, sky.sunIntensity);
  sun.position.set(sky.sunFrom[0] * 60, sky.sunFrom[1] * 60, sky.sunFrom[2] * 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -shadowSize;
  c.right = shadowSize;
  c.top = shadowSize;
  c.bottom = -shadowSize;
  c.near = 1;
  c.far = 200;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  // Skies made by hand (no `outline`) get a level from how bright their light is.
  const level = sky.outline ?? Math.min(1, Math.max(0.4, (sky.hemi + sky.sunIntensity * 0.5) / 1.7));
  setLook(scene, { rimColor: sky.rim ?? sky.hemiSky, rimStrength: sky.rimStrength ?? 0.3, keyDir: sky.sunFrom, keyColor: sky.sun, outline: level });
  if (sky.grade && scene.userData.grade === undefined) scene.userData.grade = sky.grade;
  return sun;
}

/**
 * The palette. The first block keeps the old names (now deeper and calmer); the rest are the new tokens:
 * see docs/art-direction.md for how to combine them.
 */
export const PALETTE = {
  grass: '#7da556',
  grassDark: '#5c8747',
  path: '#d8c29b',
  soil: '#8b684d',
  soilDark: '#6d4f3b',
  stone: '#a49f9a',
  wood: '#9d6c46',
  woodDark: '#6e4a31',
  leaf: '#5e9856',
  leafDark: '#3b6f47',
  roof: '#c5604a',
  wall: '#eee3d1',
  metal: '#565c68',
  accent: '#e7794f',
  cloth: '#e6b65b',
  water: '#4ea7c2',
  glow: '#ffe2a6',
  cloud: '#f6efe6',
  ink: '#1e1826',

  // backgrounds (deep, for night scenes and voids)
  midnight: '#12162f',
  aubergine: '#2a2136',
  plum: '#48345a',
  espresso: '#2b211d',
  // surfaces (walls, floors, large quiet areas)
  cream: '#f1e7d6',
  linen: '#d9ccb9',
  clay: '#c9a58a',
  sageWall: '#aab59b',
  duskWall: '#8a8094',
  slate: '#4f5563',
  charcoal: '#2c2b34',
  // woods
  oak: '#b28b5f',
  walnut: '#5d3f2d',
  mahogany: '#7a4030',
  // fabrics (furniture, rugs, curtains)
  terracotta: '#c26a4b',
  mustard: '#d6a243',
  rose: '#c87a8a',
  mauve: '#9a7b9f',
  denim: '#4b6384',
  teal: '#2f7d7a',
  forest: '#2f5b46',
  sage: '#8ea489',
  // foliage
  fern: '#4f8a54',
  moss: '#6c8c4a',
  olive: '#8a9150',
  pine: '#2e5a4a',
  // accents and metals
  brass: '#c9a35b',
  copper: '#b8734f',
  ceramic: '#e9e2d6',
  brick: '#a85a44',
  sand: '#dcc59a',
  // glows (use with `glow`, they bloom)
  lamp: '#ffcf87',
  ember: '#ff8a3c',
  moon: '#cdd9ff',
  neonPink: '#ff5fa2',
  neonCyan: '#4fe3e0',
  neonViolet: '#9a7bff',
  screen: '#bfe6ff',
} as const;

/** A soft cloud made of a few toon puffs (no outline, so it stays light). */
export function cloud(rand: () => number, scale = 1, color: string = PALETTE.cloud, opacity = 1): THREE.Group {
  const g = new THREE.Group();
  const puffs = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < puffs; i++) {
    const r = (0.7 + rand() * 0.6) * scale;
    const x = (i - (puffs - 1) / 2) * 0.95 * scale;
    const y = (1 - Math.abs(i - (puffs - 1) / 2) / puffs) * 0.55 * scale + rand() * 0.2 * scale;
    // Clouds neither cast nor catch shadows: a shadowed cloud just looks dirty.
    part(g, ball(r, 3), color, x, y, (rand() - 0.5) * 0.6 * scale, { outline: false, shadow: false, exact: true, rim: 0.5, ...(opacity < 1 ? { opacity } : {}) }).receiveShadow = false;
  }
  return g;
}
