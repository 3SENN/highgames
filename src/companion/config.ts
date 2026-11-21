// Atelier's companion configuration, from the Atelier kit's companion art (kit-base.ts): the presets, the colour
// palettes and randomisation weights, which parts fit which heads, and every part's label.
// Loaded once per page, by the TV and by the phones.
import type { CompanionPreset, CompatibilityConfig, FaceLayer, PartSlot, RandomizationConfig, RigId, Tint } from '../shared/look';
import { companionBase } from './kit-base';

export interface CompanionManifest {
  rigs: Record<RigId, { label: string; file: string }>;
  parts: Record<string, { slot: PartSlot; label: string; file: string; tints: Tint[] }>;
  face: Record<FaceLayer, Record<string, { label: string; variants: Record<string, string> }>>;
  config: { compatibility: string; randomization: string; presets: string };
}

export interface CompanionConfig {
  manifest: CompanionManifest;
  presets: CompanionPreset[];
  randomization: RandomizationConfig;
  compatibility: CompatibilityConfig;
}

let loading: Promise<CompanionConfig> | null = null;

async function json<T>(path: string): Promise<T> {
  const url = companionBase() + path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return (await res.json()) as T;
}

export function loadCompanionConfig(): Promise<CompanionConfig> {
  loading ??= (async () => {
    const manifest = await json<CompanionManifest>('manifest.json');
    const [presets, randomization, compatibility] = await Promise.all([
      json<CompanionPreset[]>(manifest.config.presets),
      json<RandomizationConfig>(manifest.config.randomization),
      json<CompatibilityConfig>(manifest.config.compatibility),
    ]);
    return { manifest, presets, randomization, compatibility };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** A part's name as Atelier shows it ("Beanie"), or the id when unknown. */
export function partLabel(cfg: CompanionConfig, id: string): string {
  return cfg.manifest.parts[id]?.label ?? id;
}

export function faceLabel(cfg: CompanionConfig, layer: FaceLayer, id: string): string {
  return cfg.manifest.face[layer]?.[id]?.label ?? id;
}

/** The address of a face piece's neutral drawing (an SVG layer of the 512×256 face). */
export function faceImage(cfg: CompanionConfig, layer: FaceLayer, id: string): string | null {
  const v = cfg.manifest.face[layer]?.[id]?.variants;
  const file = v?.neutral ?? (v ? Object.values(v)[0] : undefined);
  return file ? companionBase() + file : null;
}
