// Post-processing for the big screen: the scene is drawn into a floating-point target (multisampled when the
// GPU can afford it), then ambient occlusion, bloom, tone mapping, a colour grade, a vignette and a breath of
// film grain are applied in one final pass (plus FXAA where multisampling is off).
//
// The passes are written for this game rather than chained from three's EffectComposer: one depth texture is
// shared instead of re-rendering the scene for normals, and AO, bloom and grading meet in a single full-screen
// pass, which is what keeps this affordable on a laptop's integrated GPU. The FXAA shader and the full-screen
// quad helper are three's own (local imports from three/examples).
//
// Views choose a grade by name (`view.grade = 'cosy'`, or `scene.userData.grade`, which `applySky` and the
// environment builders set) or pass their own partial Grade. See docs/art-direction.md.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

// ------------------------------------------------------------------ grades

export interface Grade {
  /** Brightness before tone mapping (1 = as lit). */
  exposure: number;
  /** 0 = flat, 1 = a full S-curve. Around 0.25 is the house look. */
  contrast: number;
  /** 1 = as rendered; below 1 is calmer. */
  saturation: number;
  /** Colour added to the darkest tones (lifted blacks; keep it very dark). */
  lift: string;
  /** Colour the brightest tones are multiplied by. */
  gain: string;
  /** Split toning: the tint of the shadows and of the highlights, and how much (0..1). */
  shadowTint: string;
  highlightTint: string;
  split: number;
  /** 0..1 darkening towards the corners, and its colour. */
  vignette: number;
  vignetteColor: string;
  /** Film grain (0.03 is subtle). */
  grain: number;
  /** Bloom strength, and the brightness above which things glow (1 = only emissive and very bright light). */
  bloom: number;
  bloomThreshold: number;
  /** Ambient occlusion: 0..1 strength, radius in scene units, and the colour of the darkening. */
  ao: number;
  aoRadius: number;
  aoColor: string;
}

const BASE: Grade = {
  exposure: 1,
  contrast: 0.22,
  saturation: 0.94,
  lift: '#04030a',
  gain: '#ffffff',
  shadowTint: '#6a6fa8',
  highlightTint: '#ffd9a8',
  split: 0.1,
  vignette: 0.28,
  vignetteColor: '#1a1226',
  grain: 0.022,
  bloom: 0.5,
  bloomThreshold: 0.92,
  ao: 0.75,
  aoRadius: 0.7,
  aoColor: '#2a1c33',
};

/**
 * The grading presets. Pick the one that matches the scene's light:
 *  - neutral: the house default: gentle contrast, warm highlights, cool shadows.
 *  - day: bright exteriors (morning, midday). Clean, a little airy.
 *  - golden: golden hour. Warm highlights, teal-blue shadows.
 *  - dusk: sunset and purple hour. Peach highlights, violet shadows, more glow.
 *  - night: moonlit exteriors. Blue shadows, lifted blacks so shapes stay readable.
 *  - cosy: night interiors with lamps. Amber highlights, plum shadows, strong vignette.
 *  - neon: late-night neon and screens. Deep contrast, magenta/cyan split, big bloom.
 *  - lofi: faded and soft, for the rhythm sessions.
 *  - board: the board game's wide view: clear and saturated enough to read spaces from afar.
 */
export const GRADES = {
  neutral: BASE,
  day: { ...BASE, exposure: 1.02, contrast: 0.2, saturation: 1, shadowTint: '#6f86b8', highlightTint: '#fff0d0', split: 0.08, vignette: 0.2, bloom: 0.38, bloomThreshold: 1.0, aoColor: '#28304a' },
  golden: { ...BASE, exposure: 1.07, contrast: 0.26, saturation: 0.96, shadowTint: '#5a79a6', highlightTint: '#ffc98a', split: 0.16, vignette: 0.28, vignetteColor: '#2a1420', bloom: 0.55, bloomThreshold: 0.9, aoColor: '#3a2030' },
  dusk: { ...BASE, exposure: 1.05, contrast: 0.26, saturation: 0.98, lift: '#080512', shadowTint: '#6f5fc0', highlightTint: '#ffc09a', split: 0.18, vignette: 0.34, vignetteColor: '#170f2a', bloom: 0.65, bloomThreshold: 0.86, aoColor: '#2a1a40' },
  night: { ...BASE, exposure: 1.1, contrast: 0.25, saturation: 0.86, lift: '#03040c', shadowTint: '#5563b6', highlightTint: '#e6e9ff', split: 0.13, vignette: 0.38, vignetteColor: '#060818', bloom: 0.8, bloomThreshold: 0.8, aoColor: '#141a3c' },
  cosy: { ...BASE, exposure: 1.06, contrast: 0.28, saturation: 0.98, lift: '#0a0610', shadowTint: '#6a4aa0', highlightTint: '#ffc278', split: 0.2, vignette: 0.42, vignetteColor: '#140a18', bloom: 0.75, bloomThreshold: 0.82, aoColor: '#2a1626' },
  neon: { ...BASE, exposure: 1.05, contrast: 0.34, saturation: 1.08, lift: '#0a0418', shadowTint: '#5a3ce0', highlightTint: '#ff9ad8', split: 0.2, vignette: 0.45, vignetteColor: '#0a0418', bloom: 1.1, bloomThreshold: 0.72, aoColor: '#1a0c38' },
  lofi: { ...BASE, exposure: 1.04, contrast: 0.14, saturation: 0.86, lift: '#120c16', shadowTint: '#7a5a9a', highlightTint: '#ffd2a0', split: 0.2, vignette: 0.4, grain: 0.04, bloom: 0.7, bloomThreshold: 0.8 },
  board: { ...BASE, exposure: 1.03, contrast: 0.22, saturation: 1.02, split: 0.1, vignette: 0.24, bloom: 0.45, bloomThreshold: 0.95, ao: 0.7, aoRadius: 1.4 },
} satisfies Record<string, Grade>;

export type GradeName = keyof typeof GRADES;
/** A preset name, or a preset with changes: `{ base: 'cosy', bloom: 1 }`. */
export type GradeInput = GradeName | (Partial<Grade> & { base?: GradeName });

export function resolveGrade(input: GradeInput | string | undefined): Grade {
  if (!input) return GRADES.neutral;
  if (typeof input === 'string') return (GRADES as Record<string, Grade>)[input] ?? GRADES.neutral;
  const { base, ...rest } = input;
  return { ...GRADES[base ?? 'neutral'], ...rest };
}

/** Sets the grade a scene is shown with (same as `view.grade`, for code that only has the scene). */
export function setGrade(scene: THREE.Scene, grade: GradeInput): void {
  scene.userData.grade = grade;
}

// ------------------------------------------------------------------ quality tiers

export type Tier = 'high' | 'medium' | 'low' | 'off';

export interface TierSettings {
  /** Cap on the device pixel ratio, and on the number of pixels drawn (scaled down beyond it). */
  pixelRatio: number;
  maxPixels: number;
  samples: number;
  ao: boolean;
  aoSamples: number;
  /** Bloom mip levels (0 = no bloom). */
  bloomLevels: number;
  fxaa: boolean;
}

export const TIERS: Record<Tier, TierSettings> = {
  high: { pixelRatio: 2, maxPixels: 2560 * 1440, samples: 4, ao: true, aoSamples: 10, bloomLevels: 5, fxaa: false },
  medium: { pixelRatio: 1.5, maxPixels: 1920 * 1080, samples: 4, ao: false, aoSamples: 0, bloomLevels: 5, fxaa: false },
  low: { pixelRatio: 1, maxPixels: 1600 * 900, samples: 0, ao: false, aoSamples: 0, bloomLevels: 3, fxaa: true },
  off: { pixelRatio: 1, maxPixels: 1600 * 900, samples: 0, ao: false, aoSamples: 0, bloomLevels: 0, fxaa: false },
};

// ------------------------------------------------------------------ shaders

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const AO_FRAGMENT = /* glsl */ `
#include <packing>
varying vec2 vUv;
uniform sampler2D tDepth;
uniform vec2 invProj;   // 1 / projection[0][0], 1 / projection[1][1]
uniform vec2 texel;
uniform float near;
uniform float far;
uniform float radius;
uniform float aspect;
float viewZ( vec2 uv ) { return perspectiveDepthToViewZ( textureLod( tDepth, uv, 0.0 ).x, near, far ); }
vec3 posAt( vec2 uv ) { float z = viewZ( uv ); return vec3( ( uv * 2.0 - 1.0 ) * invProj * -z, z ); }
void main() {
  float depth = texture2D( tDepth, vUv ).x;
  if ( depth >= 0.99999 ) { gl_FragColor = vec4( 1.0 ); return; }
  vec3 p = posAt( vUv );
  vec3 pr = posAt( vUv + vec2( texel.x, 0.0 ) );
  vec3 pl = posAt( vUv - vec2( texel.x, 0.0 ) );
  vec3 pu = posAt( vUv + vec2( 0.0, texel.y ) );
  vec3 pd = posAt( vUv - vec2( 0.0, texel.y ) );
  vec3 dx = abs( pr.z - p.z ) < abs( p.z - pl.z ) ? pr - p : p - pl;
  vec3 dy = abs( pu.z - p.z ) < abs( p.z - pd.z ) ? pu - p : p - pd;
  vec3 n = normalize( cross( dx, dy ) );
  // radius on screen (in uv), kept sane for things right in front of the camera and far away
  float rad = clamp( radius * 0.5 / ( invProj.y * -p.z ), 0.004, 0.09 );
  float noise = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  float occ = 0.0;
  for ( int i = 0; i < AO_SAMPLES; i ++ ) {
    float fi = float( i );
    float a = ( fi + noise ) * 2.39996323;
    float r = sqrt( ( fi + 0.5 ) / float( AO_SAMPLES ) ) * rad;
    vec2 o = vec2( cos( a ), sin( a ) ) * r * vec2( 1.0 / aspect, 1.0 );
    vec3 v = posAt( vUv + o ) - p;
    float vv = dot( v, v );
    float vn = dot( v, n ) / sqrt( vv + 1e-6 );
    occ += max( vn - 0.12, 0.0 ) * smoothstep( radius * radius * 1.6, 0.0, vv );
  }
  float ao = clamp( 1.0 - occ * 2.2 / float( AO_SAMPLES ), 0.0, 1.0 );
  // fade out in the distance, where the fog takes over
  ao = mix( ao, 1.0, smoothstep( far * 0.25, far * 0.6, -p.z ) );
  gl_FragColor = vec4( ao, ao, ao, 1.0 );
}
`;

const AO_BLUR_FRAGMENT = /* glsl */ `
#include <packing>
varying vec2 vUv;
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 dir;
uniform float near;
uniform float far;
float viewZ( vec2 uv ) { return perspectiveDepthToViewZ( textureLod( tDepth, uv, 0.0 ).x, near, far ); }
void main() {
  float z0 = viewZ( vUv );
  float sum = texture2D( tAO, vUv ).r * 0.3;
  float wsum = 0.3;
  for ( int i = 1; i <= 3; i ++ ) {
    float w0 = i == 1 ? 0.22 : ( i == 2 ? 0.1 : 0.03 );
    for ( int s = -1; s <= 1; s += 2 ) {
      vec2 uv = vUv + dir * float( i * s ) * 1.4;
      float w = w0 * max( 0.0, 1.0 - abs( viewZ( uv ) - z0 ) / ( 0.06 * abs( z0 ) + 0.02 ) );
      sum += textureLod( tAO, uv, 0.0 ).r * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4( vec3( sum / wsum ), 1.0 );
}
`;

const BLOOM_PREFILTER = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 texel;
uniform float threshold;
vec3 pick( vec2 uv ) {
  vec3 c = min( texture2D( tDiffuse, uv ).rgb, vec3( 6.0 ) );
  float br = max( c.r, max( c.g, c.b ) );
  float knee = threshold * 0.35 + 1e-4;
  float soft = clamp( br - threshold + knee, 0.0, 2.0 * knee );
  soft = soft * soft / ( 4.0 * knee );
  return c * max( soft, br - threshold ) / max( br, 1e-4 );
}
void main() {
  vec3 c = pick( vUv + texel * vec2( -1.0, -1.0 ) ) + pick( vUv + texel * vec2( 1.0, -1.0 ) ) + pick( vUv + texel * vec2( -1.0, 1.0 ) ) + pick( vUv + texel * vec2( 1.0, 1.0 ) );
  gl_FragColor = vec4( c * 0.25, 1.0 );
}
`;

const BLOOM_DOWN = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 texel;
void main() {
  vec3 c = texture2D( tDiffuse, vUv ).rgb * 4.0;
  c += texture2D( tDiffuse, vUv + texel * vec2( -1.0, -1.0 ) ).rgb;
  c += texture2D( tDiffuse, vUv + texel * vec2( 1.0, -1.0 ) ).rgb;
  c += texture2D( tDiffuse, vUv + texel * vec2( -1.0, 1.0 ) ).rgb;
  c += texture2D( tDiffuse, vUv + texel * vec2( 1.0, 1.0 ) ).rgb;
  gl_FragColor = vec4( c / 8.0, 1.0 );
}
`;

const BLOOM_UP = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 texel;
uniform float weight;
void main() {
  vec3 c = texture2D( tDiffuse, vUv + texel * vec2( -1.0, 0.0 ) ).rgb + texture2D( tDiffuse, vUv + texel * vec2( 1.0, 0.0 ) ).rgb;
  c += texture2D( tDiffuse, vUv + texel * vec2( 0.0, -1.0 ) ).rgb + texture2D( tDiffuse, vUv + texel * vec2( 0.0, 1.0 ) ).rgb;
  c *= 2.0;
  c += texture2D( tDiffuse, vUv + texel * vec2( -1.0, -1.0 ) ).rgb + texture2D( tDiffuse, vUv + texel * vec2( 1.0, -1.0 ) ).rgb;
  c += texture2D( tDiffuse, vUv + texel * vec2( -1.0, 1.0 ) ).rgb + texture2D( tDiffuse, vUv + texel * vec2( 1.0, 1.0 ) ).rgb;
  gl_FragColor = vec4( c / 12.0 * weight, 1.0 );
}
`;

const FINAL_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform float aoStrength;
uniform vec3 aoColor;
uniform float bloom;
uniform float exposure;
uniform float contrast;
uniform float saturation;
uniform vec3 lift;
uniform vec3 gain;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float split;
uniform float vignette;
uniform vec3 vignetteColor;
uniform float grain;
uniform float time;
uniform float aspect;

// Khronos PBR Neutral: colours below about 0.8 pass through as authored; only highlights are compressed.
vec3 neutral( vec3 color ) {
  const float start = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min( color.r, min( color.g, color.b ) );
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < start ) return color;
  float d = 1.0 - start;
  float newPeak = 1.0 - d * d / ( peak + d - start );
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / ( desaturation * ( peak - newPeak ) + 1.0 );
  return mix( color, vec3( newPeak ), g );
}
float hash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }

void main() {
  vec3 c = texture2D( tScene, vUv ).rgb;
  #ifdef USE_AO
    float ao = texture2D( tAO, vUv ).r;
    // occlusion darkens towards a colour rather than black, and bright (emissive) pixels shrug it off
    float keep = 1.0 - ( 1.0 - ao ) * aoStrength * ( 1.0 - smoothstep( 0.9, 1.6, max( c.r, max( c.g, c.b ) ) ) );
    c *= mix( aoColor, vec3( 1.0 ), keep );
  #endif
  #ifdef USE_BLOOM
    c += texture2D( tBloom, vUv ).rgb * bloom;
  #endif
  c = neutral( max( c * exposure, 0.0 ) );
  c = sRGBTransferOETF( vec4( c, 1.0 ) ).rgb;

  // the grade works on display values
  c = mix( c, c * c * ( 3.0 - 2.0 * c ), contrast );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  // very saturated colours are reined in a little more than the rest, so nothing shouts
  float top = max( c.r, max( c.g, c.b ) );
  float purity = ( top - min( c.r, min( c.g, c.b ) ) ) / max( top, 0.02 );
  c = mix( vec3( l ), c, saturation * ( 1.0 - 0.3 * smoothstep( 0.5, 1.0, purity ) ) );
  float sh = ( 1.0 - l ) * ( 1.0 - l );
  float hi = l * l;
  c *= mix( vec3( 1.0 ), shadowTint / max( dot( shadowTint, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.05 ), sh * split );
  c *= mix( vec3( 1.0 ), highlightTint / max( dot( highlightTint, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.05 ), hi * split );
  c = c * mix( vec3( 1.0 ), gain, hi ) + lift * ( 1.0 - l );

  vec2 q = ( vUv - 0.5 ) * vec2( min( aspect, 1.9 ) / 1.9 * 1.15, 1.0 );
  float v = smoothstep( 0.32, 0.92, length( q ) * 1.25 );
  c = mix( c, c * vignetteColor, v * vignette );

  float n = hash( gl_FragCoord.xy + fract( time ) * 97.0 ) - 0.5;
  c += n * ( grain * ( 1.0 - 0.6 * l ) + 0.004 );
  gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
}
`;

// ------------------------------------------------------------------ the pipeline

const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
  new THREE.ShaderMaterial({ vertexShader: QUAD_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });

const COLOR_KEYS = ['lift', 'gain', 'shadowTint', 'highlightTint', 'vignetteColor', 'aoColor'] as const;
const NUMBER_KEYS = ['exposure', 'contrast', 'saturation', 'split', 'vignette', 'grain', 'bloom', 'bloomThreshold', 'ao', 'aoRadius'] as const;

export class PostFX {
  private settings: TierSettings = TIERS.high;
  private width = 1;
  private height = 1;
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private ldrTarget: THREE.WebGLRenderTarget | null = null;
  private aoTargets: THREE.WebGLRenderTarget[] = [];
  private bloomTargets: THREE.WebGLRenderTarget[] = [];
  private readonly quad = new FullScreenQuad();
  private readonly white: THREE.DataTexture;

  private readonly aoMat: THREE.ShaderMaterial;
  private readonly aoBlurMat: THREE.ShaderMaterial;
  private readonly prefilterMat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly finalMat: THREE.ShaderMaterial;
  private readonly fxaaMat: THREE.ShaderMaterial;

  /** The grade on screen right now (eases towards the target). */
  private current: Grade = { ...GRADES.neutral };
  private target: Grade = GRADES.neutral;
  private readonly colorA = new THREE.Color();
  private readonly colorB = new THREE.Color();
  private first = true;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    const v2 = () => ({ value: new THREE.Vector2() });
    this.aoMat = pass(AO_FRAGMENT, { tDepth: { value: null }, invProj: v2(), texel: v2(), near: { value: 0.1 }, far: { value: 100 }, radius: { value: 0.7 }, aspect: { value: 1 } }, { defines: { AO_SAMPLES: 10 } });
    this.aoBlurMat = pass(AO_BLUR_FRAGMENT, { tAO: { value: null }, tDepth: { value: null }, dir: v2(), near: { value: 0.1 }, far: { value: 100 } });
    this.prefilterMat = pass(BLOOM_PREFILTER, { tDiffuse: { value: null }, texel: v2(), threshold: { value: 1 } });
    this.downMat = pass(BLOOM_DOWN, { tDiffuse: { value: null }, texel: v2() });
    this.upMat = pass(BLOOM_UP, { tDiffuse: { value: null }, texel: v2(), weight: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
    const col = () => ({ value: new THREE.Color() });
    this.finalMat = pass(FINAL_FRAGMENT, {
      tScene: { value: null },
      tAO: { value: this.white },
      tBloom: { value: this.white },
      aoStrength: { value: 0 },
      aoColor: col(),
      bloom: { value: 0 },
      exposure: { value: 1 },
      contrast: { value: 0 },
      saturation: { value: 1 },
      lift: col(),
      gain: col(),
      shadowTint: col(),
      highlightTint: col(),
      split: { value: 0 },
      vignette: { value: 0 },
      vignetteColor: col(),
      grain: { value: 0 },
      time: { value: 0 },
      aspect: { value: 1 },
    });
    this.fxaaMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2() } },
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: FXAAShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  /** Sets the quality tier and the drawing size in real pixels. Rebuilds the render targets. */
  configure(settings: TierSettings, width: number, height: number): void {
    this.settings = settings;
    this.width = Math.max(2, Math.floor(width));
    this.height = Math.max(2, Math.floor(height));
    this.disposeTargets();
    const w = this.width;
    const h = this.height;
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: settings.samples,
      depthTexture,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.sceneTarget.texture.name = 'scene';
    if (settings.fxaa) {
      this.ldrTarget = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    }
    if (settings.ao) {
      const aw = Math.max(2, Math.round(w / 2));
      const ah = Math.max(2, Math.round(h / 2));
      this.aoTargets = [0, 1].map(() => new THREE.WebGLRenderTarget(aw, ah, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }));
      this.aoMat.defines.AO_SAMPLES = settings.aoSamples;
      this.aoMat.needsUpdate = true;
    }
    let bw = Math.max(2, Math.round(w / 2));
    let bh = Math.max(2, Math.round(h / 2));
    for (let i = 0; i < settings.bloomLevels; i++) {
      this.bloomTargets.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }));
      bw = Math.max(2, Math.round(bw / 2));
      bh = Math.max(2, Math.round(bh / 2));
    }
    const d = this.finalMat.defines as Record<string, string>;
    if (settings.ao) d.USE_AO = '';
    else delete d.USE_AO;
    if (settings.bloomLevels > 0) d.USE_BLOOM = '';
    else delete d.USE_BLOOM;
    this.finalMat.needsUpdate = true;
  }

  /** The grade to ease towards. */
  setGrade(grade: Grade): void {
    this.target = grade;
  }

  private easeGrade(dt: number): void {
    const k = this.first ? 1 : 1 - Math.exp(-dt * 5);
    this.first = false;
    const cur = this.current as unknown as Record<string, number | string>;
    const tgt = this.target as unknown as Record<string, number | string>;
    for (const key of NUMBER_KEYS) cur[key] = (cur[key] as number) + ((tgt[key] as number) - (cur[key] as number)) * k;
    for (const key of COLOR_KEYS) {
      if (cur[key] === tgt[key]) continue;
      this.colorA.set(cur[key] as string).lerp(this.colorB.set(tgt[key] as string), k);
      cur[key] = k > 0.999 || this.colorA.equals(this.colorB) ? (tgt[key] as string) : `#${this.colorA.getHexString()}`;
    }
    const u = this.finalMat.uniforms as Record<string, THREE.IUniform>;
    const g = this.current;
    (u.exposure as THREE.IUniform<number>).value = g.exposure;
    (u.contrast as THREE.IUniform<number>).value = g.contrast;
    (u.saturation as THREE.IUniform<number>).value = g.saturation;
    (u.split as THREE.IUniform<number>).value = g.split;
    (u.vignette as THREE.IUniform<number>).value = g.vignette;
    (u.grain as THREE.IUniform<number>).value = g.grain;
    (u.bloom as THREE.IUniform<number>).value = g.bloom;
    (u.aoStrength as THREE.IUniform<number>).value = g.ao;
    // The grade's colours are picked as display colours and used on display values, so no conversion.
    const setRaw = (name: string, hex: string) => (u[name] as THREE.IUniform<THREE.Color>).value.setStyle(hex, THREE.LinearSRGBColorSpace);
    setRaw('lift', g.lift);
    setRaw('gain', g.gain);
    setRaw('shadowTint', g.shadowTint);
    setRaw('highlightTint', g.highlightTint);
    setRaw('vignetteColor', g.vignetteColor);
    // AO multiplies linear light.
    (u.aoColor as THREE.IUniform<THREE.Color>).value.set(g.aoColor);
  }

  private draw(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(this.renderer);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number, time: number): void {
    const renderer = this.renderer;
    const sceneTarget = this.sceneTarget;
    if (!sceneTarget) return;
    this.easeGrade(dt);
    const g = this.current;
    const s = this.settings;
    const autoClear = renderer.autoClear;

    renderer.autoClear = true;
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);
    renderer.autoClear = false;

    const fu = this.finalMat.uniforms as Record<string, THREE.IUniform>;
    (fu.tScene as THREE.IUniform).value = sceneTarget.texture;
    (fu.time as THREE.IUniform<number>).value = time;
    (fu.aspect as THREE.IUniform<number>).value = this.width / this.height;

    if (s.ao && this.aoTargets.length === 2 && g.ao > 0.01) {
      const [a, b] = this.aoTargets as [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
      const au = this.aoMat.uniforms as Record<string, THREE.IUniform>;
      const pe = camera.projectionMatrix.elements;
      (au.tDepth as THREE.IUniform).value = sceneTarget.depthTexture;
      (au.invProj as THREE.IUniform<THREE.Vector2>).value.set(1 / (pe[0] as number), 1 / (pe[5] as number));
      (au.texel as THREE.IUniform<THREE.Vector2>).value.set(1 / a.width, 1 / a.height);
      (au.near as THREE.IUniform<number>).value = camera.near;
      (au.far as THREE.IUniform<number>).value = camera.far;
      (au.radius as THREE.IUniform<number>).value = g.aoRadius;
      (au.aspect as THREE.IUniform<number>).value = this.width / this.height;
      this.draw(this.aoMat, a);
      const bu = this.aoBlurMat.uniforms as Record<string, THREE.IUniform>;
      (bu.tDepth as THREE.IUniform).value = sceneTarget.depthTexture;
      (bu.near as THREE.IUniform<number>).value = camera.near;
      (bu.far as THREE.IUniform<number>).value = camera.far;
      (bu.tAO as THREE.IUniform).value = a.texture;
      (bu.dir as THREE.IUniform<THREE.Vector2>).value.set(1 / a.width, 0);
      this.draw(this.aoBlurMat, b);
      (bu.tAO as THREE.IUniform).value = b.texture;
      (bu.dir as THREE.IUniform<THREE.Vector2>).value.set(0, 1 / a.height);
      this.draw(this.aoBlurMat, a);
      (fu.tAO as THREE.IUniform).value = a.texture;
    } else {
      (fu.tAO as THREE.IUniform).value = this.white;
    }

    const mips = this.bloomTargets;
    if (mips.length > 0) {
      const first = mips[0] as THREE.WebGLRenderTarget;
      const pu = this.prefilterMat.uniforms as Record<string, THREE.IUniform>;
      (pu.tDiffuse as THREE.IUniform).value = sceneTarget.texture;
      (pu.texel as THREE.IUniform<THREE.Vector2>).value.set(0.5 / first.width, 0.5 / first.height);
      (pu.threshold as THREE.IUniform<number>).value = g.bloomThreshold;
      this.draw(this.prefilterMat, first);
      const du = this.downMat.uniforms as Record<string, THREE.IUniform>;
      for (let i = 1; i < mips.length; i++) {
        const src = mips[i - 1] as THREE.WebGLRenderTarget;
        (du.tDiffuse as THREE.IUniform).value = src.texture;
        (du.texel as THREE.IUniform<THREE.Vector2>).value.set(1 / src.width, 1 / src.height);
        this.draw(this.downMat, mips[i] as THREE.WebGLRenderTarget);
      }
      const uu = this.upMat.uniforms as Record<string, THREE.IUniform>;
      for (let i = mips.length - 1; i > 0; i--) {
        const src = mips[i] as THREE.WebGLRenderTarget;
        (uu.tDiffuse as THREE.IUniform).value = src.texture;
        (uu.texel as THREE.IUniform<THREE.Vector2>).value.set(1 / src.width, 1 / src.height);
        this.draw(this.upMat, mips[i - 1] as THREE.WebGLRenderTarget);
      }
      (fu.tBloom as THREE.IUniform).value = first.texture;
      // each level adds light on the way up: keep the total steady whatever the number of levels
      (fu.bloom as THREE.IUniform<number>).value = (g.bloom * 1.6) / mips.length;
    }

    if (s.fxaa && this.ldrTarget) {
      this.draw(this.finalMat, this.ldrTarget);
      const xu = this.fxaaMat.uniforms as Record<string, THREE.IUniform>;
      (xu.tDiffuse as THREE.IUniform).value = this.ldrTarget.texture;
      (xu.resolution as THREE.IUniform<THREE.Vector2>).value.set(1 / this.width, 1 / this.height);
      this.draw(this.fxaaMat, null);
    } else {
      this.draw(this.finalMat, null);
    }
    renderer.setRenderTarget(null);
    renderer.autoClear = autoClear;
  }

  private disposeTargets(): void {
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget?.dispose();
    this.ldrTarget?.dispose();
    for (const t of this.aoTargets) t.dispose();
    for (const t of this.bloomTargets) t.dispose();
    this.sceneTarget = null;
    this.ldrTarget = null;
    this.aoTargets = [];
    this.bloomTargets = [];
  }

  dispose(): void {
    this.disposeTargets();
    this.quad.dispose();
    this.white.dispose();
    for (const m of [this.aoMat, this.aoBlurMat, this.prefilterMat, this.downMat, this.upMat, this.finalMat, this.fxaaMat]) m.dispose();
  }
}
