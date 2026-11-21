// A player's Atelier companion in one of our three.js scenes, built by the Atelier kit's companion runtime
// (atelier-kit/character.js, served by Atelier) so it looks and moves exactly as in Atelier.
// Wraps the kit with what the game needs: a fixed height, feet on y = 0, blinking, and moods that pass.
import * as THREE from 'three';
import { character, type KitCharacter } from 'atelier-kit/character.js';
import type { CompanionLook, CompanionMood } from '../shared/look';

export interface Companion {
  /** Add this to the scene. Feet at y = 0, facing +z, `height` units tall. */
  readonly root: THREE.Group;
  readonly kit: KitCharacter;
  /** Scene units per kit unit. */
  readonly scale: number;
  update(dt: number): void;
  /** The mood it returns to after a passing one. */
  setBase(mood: CompanionMood): void;
  /** A mood for a moment (a cheer, a sulk), then back to the base mood. */
  react(mood: CompanionMood, seconds?: number): void;
  /** Walks or runs while the game moves `root`; speed in scene units a second. */
  move(motion: 'walk' | 'run' | null, speed?: number): void;
  dispose(): void;
}

export async function buildCompanion(look: CompanionLook, opts: { height?: number; mood?: CompanionMood; shadows?: boolean } = {}): Promise<Companion> {
  const base0: CompanionMood = opts.mood ?? 'idle';
  const kit = await character(look, { mood: base0 });
  const [, minY] = kit.bounds.min;
  const [, maxY] = kit.bounds.max;
  const scale = (opts.height ?? 1.7) / Math.max(0.1, maxY - minY);
  const root = new THREE.Group();
  root.name = 'companion';
  kit.object3d.scale.setScalar(scale);
  kit.object3d.position.y = -minY * scale;
  root.add(kit.object3d);
  if (opts.shadows !== false) {
    kit.object3d.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name !== 'outline') o.castShadow = true;
    });
  }

  let base = base0;
  let reactLeft = 0;
  let blinkIn = 1 + Math.random() * 3;
  return {
    root,
    kit,
    scale,
    update(dt) {
      if (reactLeft > 0) {
        reactLeft -= dt;
        if (reactLeft <= 0) kit.setMood(base, 0.3);
      }
      blinkIn -= dt;
      if (blinkIn <= 0) {
        kit.blink();
        blinkIn = 2.5 + Math.random() * 3;
      }
      kit.update(dt);
    },
    setBase(mood) {
      base = mood;
      if (reactLeft <= 0) kit.setMood(mood, 0.3);
    },
    react(mood, seconds = 1.8) {
      reactLeft = seconds;
      kit.setMood(mood, 0.2);
    },
    move(motion, speed) {
      kit.move(motion, speed === undefined ? undefined : speed / scale);
    },
    dispose() {
      root.removeFromParent();
      kit.dispose();
    },
  };
}
