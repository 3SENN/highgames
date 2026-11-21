// The phone's live 3D preview of its companion, built by Atelier's runtime like everywhere else.
// Drag to turn it; a newer look replaces the one being built.
import * as THREE from 'three';
import { type Companion, buildCompanion } from '../companion/kit';
import type { CompanionLook } from '../shared/look';

export class Preview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private readonly turntable = new THREE.Group();
  private companion: Companion | null = null;
  private building = 0;
  private raf = 0;
  private last = performance.now();
  private yaw = 0.35;
  private spin = 0;
  private dragging = false;
  private resizeObserver: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight('#eef8ff', '#9fd182', 1.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.7);
    sun.position.set(-2, 4, 4);
    this.scene.add(sun, this.turntable);
    this.turntable.add(shadowDisc());
    this.camera.position.set(0, 1.25, 6.2);
    this.camera.lookAt(0, 0.98, 0);

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.spin = e.movementX * 0.012;
      this.yaw += this.spin;
    });
    const release = () => (this.dragging = false);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.loop();
  }

  async show(look: CompanionLook): Promise<void> {
    const ticket = ++this.building;
    const next = await buildCompanion(look, { height: 2, mood: 'happy', shadows: false });
    if (ticket !== this.building) {
      next.dispose();
      return;
    }
    this.companion?.dispose();
    this.companion = next;
    this.turntable.add(next.root);
    next.react('approval', 1);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.companion?.dispose();
    this.renderer.dispose();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.dragging) {
      this.yaw += this.spin;
      this.spin *= 0.92;
    }
    this.turntable.rotation.y = this.yaw;
    this.companion?.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };
}

/** A soft round shadow under the feet. */
function shadowDisc(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(19,32,59,0.32)');
  grad.addColorStop(1, 'rgba(19,32,59,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  return mesh;
}
