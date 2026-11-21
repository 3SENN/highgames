import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeLook } from '../vendor/atelier-look/companionLogic';
import { findKit } from '../scripts/atelier/kit.mjs';
import { shuffleLook } from '../src/companion/shuffle';
import type { CompanionConfig, CompanionManifest } from '../src/companion/config';
import { type CompanionPreset, DEFAULT_LOOK, PART_IDS, parseLook, seatColor } from '../src/shared/look';

// The companion art is Atelier's: the kit serves it to the game. These tests read the same files (from the installed
// Atelier, or atelier's build; see scripts/atelier/kit.mjs) and skip, saying so, on a computer with neither.
const kit = (() => {
  try {
    return findKit();
  } catch (err) {
    console.warn(`Skipping the companion art checks: ${(err as Error).message}`);
    return null;
  }
})();
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(kit as string, 'companion', file), 'utf8')) as T;
const manifest = kit ? read<CompanionManifest>('manifest.json') : null;
const presets = manifest ? read<CompanionPreset[]>(manifest.config.presets) : [];
const config = manifest
  ? ({
      manifest,
      presets,
      randomization: read(manifest.config.randomization),
      compatibility: read(manifest.config.compatibility),
    } as CompanionConfig)
  : (null as unknown as CompanionConfig);

describe.skipIf(!kit)('Atelier companion looks', () => {
  it('accepts Atelier’s default look and every preset', () => {
    expect(parseLook(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
    expect(presets.length).toBeGreaterThan(0);
    for (const p of presets) expect(parseLook(p.look)).not.toBeNull();
  });

  it('knows every part the art ships with', () => {
    const files = new Set(Object.keys((config.manifest as { parts: Record<string, unknown> }).parts));
    for (const ids of Object.values(PART_IDS)) for (const id of ids) expect(files.has(id)).toBe(true);
  });

  it('rejects looks that are not Atelier looks', () => {
    const bad: unknown[] = [
      null,
      'look',
      { ...DEFAULT_LOOK, rig: 'Z' },
      { ...DEFAULT_LOOK, parts: { ...DEFAULT_LOOK.parts, head: null } },
      { ...DEFAULT_LOOK, parts: { ...DEFAULT_LOOK.parts, hat: 'hat-unknown' } },
      { ...DEFAULT_LOOK, face: { ...DEFAULT_LOOK.face, eyes: 'eyes-laser' } },
      { ...DEFAULT_LOOK, colors: { ...DEFAULT_LOOK.colors, skin: 'red' } },
      { ...DEFAULT_LOOK, colors: { ...DEFAULT_LOOK.colors, skin: '#12345' } },
    ];
    for (const b of bad) expect(parseLook(b)).toBeNull();
  });

  it('drops unknown fields and keeps adjustments in range', () => {
    const look = parseLook({ ...DEFAULT_LOOK, evil: '<script>', adjust: { headSize: 9, nope: 1 } });
    expect(look).not.toHaveProperty('evil');
    expect(look?.adjust?.headSize).toBeLessThanOrEqual(1);
    expect(look?.adjust).not.toHaveProperty('nope');
  });

  it('shuffles into looks that pass Atelier’s own rules', () => {
    for (const style of ['any', 'soft', 'bright', 'bold'] as const) {
      for (let i = 0; i < 25; i++) {
        const look = shuffleLook(config, style);
        expect(parseLook(look)).not.toBeNull();
        expect(normalizeLook(look, config.compatibility)).toEqual(look);
      }
    }
  });

  it('gives every seat its own colour', () => {
    expect(new Set([0, 1, 2, 3].map(seatColor)).size).toBe(4);
  });
});
