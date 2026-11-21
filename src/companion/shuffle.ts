// Shuffling a companion the way Atelier's editor does: a random look from Atelier's own weights, with its palette
// re-picked leaning towards a style (soft, bright or bold colours).
import { hexToRgb, normalizeLook, randomizeLook, weightedPick, type Rng } from '../../vendor/atelier-look/companionLogic';
import { type CompanionLook, type RandomizationConfig, TINTS, type Tint } from '../shared/look';
import type { CompanionConfig } from './config';

export const SHUFFLE_STYLES = [
  { id: 'any', label: 'Any' },
  { id: 'soft', label: 'Soft' },
  { id: 'bright', label: 'Bright' },
  { id: 'bold', label: 'Bold' },
] as const;
export type ShuffleStyle = (typeof SHUFFLE_STYLES)[number]['id'];

function hsl(hex: string): { s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { s: 0, l };
  const d = max - min;
  return { s: l > 0.5 ? d / (2 - max - min) : d / (max + min), l };
}

/** How well a palette fits a style, 0 to 1. */
function paletteScore(colors: Record<Tint, string>, style: ShuffleStyle): number {
  if (style === 'any') return 1;
  const parts = TINTS.map((t) => hsl(colors[t]));
  const sat = parts.reduce((sum, c) => sum + c.s, 0) / parts.length;
  const light = parts.reduce((sum, c) => sum + c.l, 0) / parts.length;
  const spread = Math.max(...parts.map((c) => c.l)) - Math.min(...parts.map((c) => c.l));
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (style === 'soft') return clamp((1 - sat) * 0.45 + light * 0.55);
  if (style === 'bright') return clamp(sat * 0.7 + (1 - Math.abs(light - 0.55) * 2) * 0.3);
  return clamp(spread * 0.6 + sat * 0.2 + (1 - light) * 0.2);
}

function pickPalette(palettes: RandomizationConfig['palettes'], style: ShuffleStyle, rng: Rng) {
  const biased = style === 'any' ? palettes : palettes.map((p) => ({ ...p, weight: p.weight * (0.02 + paletteScore(p.colors, style) ** 3) }));
  return weightedPick(biased, rng);
}

export function shuffleLook(cfg: CompanionConfig, style: ShuffleStyle = 'any', rng: Rng = Math.random): CompanionLook {
  const look = randomizeLook(cfg.randomization, cfg.compatibility, rng);
  const palette = pickPalette(cfg.randomization.palettes, style, rng);
  return normalizeLook(palette ? { ...look, colors: { ...palette.colors } } : look, cfg.compatibility);
}
