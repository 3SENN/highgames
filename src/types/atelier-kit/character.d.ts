// Types for the Atelier kit's companion runtime, `atelier-kit/character.js` (docs/apps.md › The kit; the source is
// atelier/src/kit/character.ts). The game imports it by bare name and Atelier's import map serves kit 1's copy,
// so companions look and move exactly as they do in Atelier. tsconfig's `paths` points the name here.
import type * as THREE from 'three';
import type { CompanionLook, CompanionMood } from '../../../vendor/atelier-look/companion';

export interface KitCharacter {
  /** Add this to the scene; +Y is up and 1 unit is about the height of rig A's body. */
  object3d: THREE.Group;
  /** Rest-pose bounds: min and max as [x, y, z]. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  setMood(mood: CompanionMood, fade?: number): void;
  /** Walks or runs while the app moves object3d, or with null stands again. speed is scene units a second. */
  move(motion: 'walk' | 'run' | null, speed?: number): void;
  update(dt: number): void;
  blink(): void;
  dispose(): void;
}

export declare const clips: readonly string[];
export declare function character(look: CompanionLook, options?: { mood?: CompanionMood }): Promise<KitCharacter>;
