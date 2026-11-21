// Players are Atelier companions. Their look follows Atelier's own contract (vendor/atelier-look, synced from atelier),
// so a companion looks the same here as in Atelier. This module adds what a networked game needs on top:
// a strict check of looks that arrive from phones, and the seat colours.
import {
  DEFAULT_LOOK,
  FACE_IDS,
  FACE_LAYERS,
  PART_IDS,
  PART_SLOTS,
  RIGS,
  TINTS,
  type CompanionLook,
  type CompanionMood,
  type CompanionPreset,
  type CompatibilityConfig,
  type FaceLayer,
  type LookAdjust,
  type PartSlot,
  type RandomizationConfig,
  type RigId,
  type Tint,
} from '../../vendor/atelier-look/companion';
import { isHexColor, normalizeAdjust } from '../../vendor/atelier-look/companionLogic';

export { DEFAULT_LOOK, FACE_IDS, FACE_LAYERS, PART_IDS, PART_SLOTS, RIGS, TINTS };
export type { CompanionLook, CompanionMood, CompanionPreset, CompatibilityConfig, FaceLayer, LookAdjust, PartSlot, RandomizationConfig, RigId, Tint };

/** Each seat's colour, for rings, borders and the HUD (the companion keeps its own colours). */
export const SEAT_COLORS = ['#F5A524', '#3B82F6', '#E2437A', '#22B573'] as const;

export function seatColor(seat: number): string {
  return SEAT_COLORS[seat % SEAT_COLORS.length] as string;
}

const RIG_NAMES: Record<RigId, string> = { A: 'Bean', B: 'Sprout', C: 'Pebble' };
export function rigName(rig: RigId): string {
  return RIG_NAMES[rig];
}

/**
 * A look from the network, checked against Atelier's catalogue: known rig, parts, face pieces, colours and
 * adjustments only. Returns a clean copy (unknown fields dropped) or null. Compatibility between parts is
 * applied later by Atelier's own normalizeLook when the companion is built.
 */
export function parseLook(raw: unknown): CompanionLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  if (!(RIGS as readonly unknown[]).includes(l.rig)) return null;
  const partsIn = l.parts as Record<string, unknown> | undefined;
  const faceIn = l.face as Record<string, unknown> | undefined;
  const colorsIn = l.colors as Record<string, unknown> | undefined;
  if (!partsIn || typeof partsIn !== 'object' || !faceIn || typeof faceIn !== 'object' || !colorsIn || typeof colorsIn !== 'object') return null;

  const parts = {} as CompanionLook['parts'];
  for (const slot of PART_SLOTS) {
    const v = partsIn[slot] ?? null;
    if (v === null) {
      if (slot === 'head') return null;
      parts[slot] = null;
    } else if (typeof v === 'string' && (PART_IDS[slot] as readonly string[]).includes(v)) {
      parts[slot] = v;
    } else {
      return null;
    }
  }
  const face = {} as CompanionLook['face'];
  for (const layer of FACE_LAYERS) {
    const v = faceIn[layer];
    if (typeof v !== 'string' || !(FACE_IDS[layer] as readonly string[]).includes(v)) return null;
    face[layer] = v;
  }
  const colors = {} as CompanionLook['colors'];
  for (const tint of TINTS) {
    const v = colorsIn[tint];
    if (!isHexColor(v)) return null;
    colors[tint] = v.toLowerCase();
  }
  const look: CompanionLook = { rig: l.rig as RigId, parts, face, colors };
  const adjust = normalizeAdjust(l.adjust);
  if (adjust) look.adjust = adjust;
  return look;
}
