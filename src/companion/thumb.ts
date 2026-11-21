// Portraits of companions for the HUD, the lobby list, results and the phones' header: a companion built with
// Atelier's runtime, photographed once from the front and kept as an image. One small renderer serves all of them.
import * as THREE from 'three';
import { lookKey } from '../../vendor/atelier-look/companionLogic';
import type { CompanionLook } from '../shared/look';
import { buildCompanion } from './kit';

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

function stage(size: number): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
  }
  renderer.setSize(size, size, false);
  return renderer;
}

/** How much of the companion a picture shows: just the head, head and shoulders, or the whole figure. */
export type Framing = 'head' | 'bust' | 'full';

/** A portrait as a PNG data URL. Cached per look, size and framing. */
export function companionThumb(look: CompanionLook, size = 192, framing: Framing = 'bust'): Promise<string> {
  const key = `${lookKey(look)}:${size}:${framing}`;
  let p = cache.get(key);
  if (!p) {
    // One portrait at a time: they share the renderer.
    p = queue.then(() => shoot(look, size, framing));
    queue = p.catch(() => undefined);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

async function shoot(look: CompanionLook, size: number, framing: Framing): Promise<string> {
  const companion = await buildCompanion(look, { height: 2, mood: 'happy', shadows: false });
  try {
    companion.update(0.016);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#eef8ff', '#9fd182', 1.25));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(-2, 3, 4);
    scene.add(key, companion.root);
    const box = new THREE.Box3().setFromObject(companion.root);
    const top = box.max.y;
    const height = top - box.min.y;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    if (framing === 'head') {
      // Just the head, with everything on it (hair, hat, ears, glasses): the rig's head node carries all of
      // those, so its box is exactly what to fit, whatever the head shape or how tall the hat or ears are.
      const headNode = companion.root.getObjectByName('head-pivot');
      const head = headNode ? new THREE.Box3().setFromObject(headNode) : new THREE.Box3(new THREE.Vector3(box.min.x, top - height * 0.55, box.min.z), box.max.clone());
      const center = head.getCenter(new THREE.Vector3());
      const size = head.getSize(new THREE.Vector3());
      const fit = (Math.max(size.x, size.y) * 1.1) / 2 / Math.tan(THREE.MathUtils.degToRad(15));
      camera.position.set(center.x, center.y, head.max.z + fit);
      camera.lookAt(center);
    } else if (framing === 'full') {
      // The whole figure, props included.
      const width = Math.max(box.max.x - box.min.x, height);
      const middle = box.min.y + height / 2;
      camera.position.set(0, middle + 0.1, width * 2.15);
      camera.lookAt(0, middle, 0);
    } else {
      // Head and shoulders: the top part of the companion.
      const headCenter = top - height * 0.3;
      camera.position.set(0, headCenter + 0.05, 4.2);
      camera.lookAt(0, headCenter - 0.05, 0);
    }
    const r = stage(size);
    r.render(scene, camera);
    return r.domElement.toDataURL('image/png');
  } finally {
    companion.dispose();
  }
}
