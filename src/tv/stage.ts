// The WebGL renderer and the render loop. One View (board or minigame) is shown at a time.
//
// Every frame goes through the post-processing pipeline in render/post.ts (anti-aliasing, ambient occlusion,
// bloom, tone mapping, colour grade, vignette, grain). Quality is automatic: software renderers start on the
// lightest tier, and a frame rate that stays low steps the effects down (AO first, then resolution and bloom).
// `?fx=high|medium|low|off` on the page address pins a tier, for testing.
//
// A view picks its colour grade with `grade` (a name from GRADES, or a partial Grade); without one, the grade
// that `applySky` or an environment builder put in `scene.userData.grade` is used.
import * as THREE from 'three';
import type { Clock } from './anim';
import { type GradeInput, PostFX, TIERS, type Tier, resolveGrade } from './render/post';
import { setTextureAnisotropy } from './render/textures';
import { RENDER_HINTS, applyLook, tickSky } from './render/toon';

export interface View {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(dt: number, time: number): void;
  dispose?(): void;
  /** The colour grade while this view shows: 'cosy', 'night', 'neon'… or `{ base: 'cosy', bloom: 1 }`. */
  grade?: GradeInput;
}

const ORDER: Tier[] = ['high', 'medium', 'low'];
/** Below this many frames a second (for a few seconds in a row), effects step down a tier. */
const MIN_FPS = 42;

function softwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|basic render|softpipe/i.test(name);
  } catch {
    return false;
  }
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  /** True when the browser draws without a GPU (the e2e test, some remote desktops). */
  readonly software: boolean;
  private view: View | null = null;
  private last = performance.now();
  private post: PostFX | null = null;
  private tierName: Tier = 'high';
  private readonly pinned: boolean;
  // frame-rate watch
  private frames = 0;
  private slowTime = 0;
  private windowStart = 0;
  private strikes = 0;
  private settleUntil = 0;
  private wall = performance.now();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly clock: Clock,
  ) {
    // Anti-aliasing happens in the post pipeline (multisampled target or FXAA), not on the canvas.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Only used when post-processing is off: with it on, tone mapping happens in the final pass.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const gl = this.renderer.getContext();
    this.software = softwareRenderer(gl);
    RENDER_HINTS.normalMaps = !this.software;
    setTextureAnisotropy(this.software ? 1 : Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    const asked = new URLSearchParams(window.location.search).get('fx');
    this.pinned = asked === 'high' || asked === 'medium' || asked === 'low' || asked === 'off';
    this.tierName = this.pinned ? (asked as Tier) : this.software ? 'low' : 'high';
    const floatTargets = this.renderer.capabilities.isWebGL2 && !!this.renderer.extensions.get('EXT_color_buffer_float');
    if (!floatTargets && !this.renderer.extensions.get('EXT_color_buffer_half_float')) this.tierName = 'off';
    if (this.tierName !== 'off') this.post = new PostFX(this.renderer);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.maybeShowcase();
  }

  /** The current quality tier ('high', 'medium', 'low' or 'off'). */
  get tier(): Tier {
    return this.tierName;
  }

  /** The view on screen now (null before the first). */
  get current(): View | null {
    return this.view;
  }

  setView(view: View): void {
    if (this.showcase) return; // the environment preview keeps the stage (see maybeShowcase)
    this.show(view);
  }

  private show(view: View): void {
    if (this.view && this.view !== view) this.view.dispose?.();
    this.view = view;
    // New scenes compile shaders and upload textures: don't count those frames against the frame rate.
    this.settleUntil = performance.now() + 2500;
    this.resize();
  }

  start(): void {
    const frame = (now: number) => {
      const dt = this.clock.tick((now - this.last) / 1000);
      this.last = now;
      const view = this.view;
      if (view) {
        view.update(dt, this.clock.time);
        applyLook(view.scene);
        tickSky(now / 1000);
        if (this.post) {
          this.post.setGrade(resolveGrade(view.grade ?? (view.scene.userData.grade as GradeInput | undefined)));
          try {
            this.post.render(view.scene, view.camera, Math.min(0.1, (now - this.wall) / 1000), now / 1000);
          } catch (err) {
            // A driver that can't do it: fall back to plain rendering rather than a black screen.
            console.warn('post-processing failed; turning it off', err);
            this.setTier('off');
          }
        } else {
          this.renderer.render(view.scene, view.camera);
        }
        this.watch(now);
      }
      this.wall = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Steps the effects down when the frame rate stays low. Never steps back up (no flip-flopping). */
  private watch(now: number): void {
    if (this.pinned || this.tierName === 'low' || this.tierName === 'off') return;
    const ms = now - this.wall;
    if (now < this.settleUntil || ms > 400 || document.hidden) {
      this.frames = 0;
      this.slowTime = 0;
      this.windowStart = now;
      return;
    }
    this.frames++;
    this.slowTime += ms;
    if (now - this.windowStart < 2000) return;
    const fps = (this.frames * 1000) / this.slowTime;
    this.frames = 0;
    this.slowTime = 0;
    this.windowStart = now;
    this.strikes = fps < MIN_FPS ? this.strikes + 1 : 0;
    if (this.strikes >= 2) {
      this.strikes = 0;
      const next = ORDER[ORDER.indexOf(this.tierName) + 1];
      if (next) {
        console.info(`frame rate ${fps.toFixed(0)} fps: effects ${this.tierName} → ${next}`);
        this.setTier(next);
        this.settleUntil = now + 2500;
      }
    }
  }

  private setTier(tier: Tier): void {
    this.tierName = tier;
    if (tier === 'off') {
      this.post?.dispose();
      this.post = null;
    }
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // A software renderer is a test or a screenshot, not a living room: keep the light tier, but with ambient
    // occlusion on, so what is seen there looks like the real thing.
    const settings = this.software && !this.pinned && this.tierName === 'low' ? { ...TIERS.low, ao: true, aoSamples: 6 } : TIERS[this.tierName];
    let ratio = Math.min(window.devicePixelRatio || 1, settings.pixelRatio);
    const pixels = w * h * ratio * ratio;
    if (pixels > settings.maxPixels) ratio *= Math.sqrt(settings.maxPixels / pixels);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.post?.configure(settings, w * ratio, h * ratio);
    if (this.view) {
      this.view.camera.aspect = w / h;
      this.view.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ environment preview (a development tool)

  private showcase = false;
  /**
   * `?env=livingRoom` (or kitchen, backyard, beach, rooftop, props…) on the page address shows that environment
   * from render/env.ts on its own, without the game's interface: for building and checking scenes.
   */
  private maybeShowcase(): void {
    const name = new URLSearchParams(window.location.search).get('env');
    if (!name) return;
    this.showcase = true;
    const style = document.createElement('style');
    style.textContent = '#ui{display:none !important}';
    document.head.append(style);
    void import('./render/showcase').then(({ showcaseView }) => this.show(showcaseView(name)));
  }
}
