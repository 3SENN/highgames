// Copied from atelier/src/shared/companionLogic.ts (1e5fbc7 2026-11-12) by scripts/sync-atelier.mjs. Don't edit: change it in Atelier and sync again.
// Licensed under the Mozilla Public License 2.0, as all of Atelier's code: https://mozilla.org/MPL/2.0/
// Pure companion logic shared by the renderer runtime, the editor and main:
// compatibility, look normalization, weighted randomization, animation event
// scheduling and mood → face resolution. No DOM, no three.js.

import {
  COMPANION_MOODS,
  DEFAULT_LOOK,
  FACE_IDS,
  FACE_LAYERS,
  LOOK_ADJUST_KEYS,
  LOOK_ADJUST_LIMIT,
  LOOK_ADJUST_STEP,
  MOOD_FACE,
  PART_IDS,
  PART_SLOTS,
  RIGS,
  TINTS,
  type CompanionLook,
  type CompanionMood,
  type CompatibilityConfig,
  type EyeVariant,
  type FaceLayer,
  type FacePartDef,
  type FaceState,
  type LookAdjust,
  type LookAdjustKey,
  type MouthVariant,
  type PartSlot,
  type RandomizationConfig,
  type RigId,
  type Tint,
} from './companion'

export type Rng = () => number

// ---- compatibility and normalization ----

export function isPartId(slot: PartSlot, id: string): boolean {
  return (PART_IDS[slot] as readonly string[]).includes(id)
}

export function isFaceId(layer: FaceLayer, id: string): boolean {
  return (FACE_IDS[layer] as readonly string[]).includes(id)
}

/**
 * Whether `partId` may sit in `slot` on `headId`. An empty slot is always
 * allowed (except the head itself), ids must belong to the slot, props fit
 * every head, and a head without rules accepts everything.
 */
export function isPartAllowed(compat: CompatibilityConfig, headId: string, slot: PartSlot, partId: string | null): boolean {
  if (partId === null) return slot !== 'head'
  if (!isPartId(slot, partId)) return false
  if (slot === 'head' || slot === 'prop') return true
  const rule = compat[headId]?.[slot]
  if (rule === undefined || rule === 'all') return true
  return rule.includes(partId)
}

/**
 * Whether a part can be worn with `hatId`. Entries keyed by a hat id in the
 * compatibility file list, per slot, what a look wearing that hat accepts:
 * tall hair and some ears would poke through it or vanish inside it.
 */
export function fitsWithHat(compat: CompatibilityConfig, hatId: string | null, slot: PartSlot, partId: string | null): boolean {
  if (hatId === null || partId === null || slot === 'head' || slot === 'hat' || slot === 'prop') return true
  const rule = compat[hatId]?.[slot]
  return rule === undefined || rule === 'all' || rule.includes(partId)
}

const HEX = /^#[0-9a-f]{6}$/i
const DEFAULT_HEAD: string = DEFAULT_LOOK.parts.head ?? PART_IDS.head[0]

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/** Loosely shaped input: profiles arrive from disk and IPC. */
export interface LookInput {
  rig?: unknown
  parts?: Partial<Record<PartSlot, unknown>> | null
  face?: Partial<Record<FaceLayer, unknown>> | null
  colors?: Partial<Record<Tint, unknown>> | null
  adjust?: unknown
}

/**
 * RP-120: clamps each known adjustment to ±LOOK_ADJUST_LIMIT on the slider's
 * step and drops unknown keys, non-numbers and zeros. Null when nothing is
 * left, so a look without adjustments stays exactly as it was.
 */
export function normalizeAdjust(raw: unknown): LookAdjust | null {
  if (!raw || typeof raw !== 'object') return null
  const out: LookAdjust = {}
  for (const key of LOOK_ADJUST_KEYS) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const clamped = Math.max(-LOOK_ADJUST_LIMIT, Math.min(LOOK_ADJUST_LIMIT, value))
    const stepped = Math.round(clamped / LOOK_ADJUST_STEP) * LOOK_ADJUST_STEP
    const rounded = Math.round(stepped * 100) / 100
    if (rounded !== 0) out[key] = rounded
  }
  return Object.keys(out).length > 0 ? out : null
}

/** An adjustment's value, 0 when missing. */
export function adjustOf(look: Pick<CompanionLook, 'adjust'>, key: LookAdjustKey): number {
  return look.adjust?.[key] ?? 0
}

/**
 * Returns a valid look: unknown rigs, heads, face ids and colours fall back to
 * `DEFAULT_LOOK`, and parts the head does not accept (or unknown ids) are
 * dropped, as are parts that do not go with the hat (the hat wins).
 * Deterministic and idempotent.
 */
export function normalizeLook(look: LookInput | null | undefined, compat: CompatibilityConfig): CompanionLook {
  const rig: RigId = (RIGS as readonly unknown[]).includes(look?.rig) ? (look?.rig as RigId) : DEFAULT_LOOK.rig
  // No parts at all means the default outfit; a missing slot in a given set means empty.
  const source: Partial<Record<PartSlot, unknown>> = look?.parts && typeof look.parts === 'object' ? look.parts : DEFAULT_LOOK.parts
  const parts = { ...DEFAULT_LOOK.parts }
  const rawHead = source.head
  const head = typeof rawHead === 'string' && isPartId('head', rawHead) ? rawHead : DEFAULT_HEAD
  parts.head = head
  for (const slot of PART_SLOTS) {
    if (slot === 'head') continue
    const raw = source[slot]
    const id = typeof raw === 'string' ? raw : null
    parts[slot] = id !== null && isPartAllowed(compat, head, slot, id) ? id : null
  }
  for (const slot of PART_SLOTS) if (!fitsWithHat(compat, parts.hat, slot, parts[slot])) parts[slot] = null
  const face = { ...DEFAULT_LOOK.face }
  for (const layer of FACE_LAYERS) {
    const raw = look?.face?.[layer]
    face[layer] = typeof raw === 'string' && isFaceId(layer, raw) ? raw : DEFAULT_LOOK.face[layer]
  }
  const colors = { ...DEFAULT_LOOK.colors }
  for (const tint of TINTS) {
    const raw = look?.colors?.[tint]
    colors[tint] = isHexColor(raw) ? raw.toLowerCase() : DEFAULT_LOOK.colors[tint]
  }
  const adjust = normalizeAdjust(look?.adjust)
  return adjust ? { rig, parts, face, colors, adjust } : { rig, parts, face, colors }
}

export function sameLook(a: CompanionLook, b: CompanionLook): boolean {
  return lookKey(a) === lookKey(b)
}

/** A stable string for a look (fixed key order), for caching and change detection. */
export function lookKey(look: CompanionLook): string {
  return [
    look.rig,
    ...PART_SLOTS.map((s) => look.parts[s] ?? '-'),
    ...FACE_LAYERS.map((l) => look.face[l]),
    ...TINTS.map((t) => look.colors[t]),
    // Only adjusted looks gain a segment, so older keys (and caches) stay the same.
    ...(look.adjust ? LOOK_ADJUST_KEYS.filter((k) => look.adjust?.[k]).map((k) => `${k}=${look.adjust?.[k]}`) : []),
  ].join('|')
}

/** The rig adjustments (RP-120) that change the 3D model; face ones only redraw the face texture. */
const RIG_ADJUST_KEYS: readonly LookAdjustKey[] = ['headSize', 'earHeight', 'accessorySize', 'accessoryHeight']

/** The part of the key that needs a new 3D model: rig, parts and the rig adjustments. */
export function modelKey(look: CompanionLook): string {
  const rigAdjust = RIG_ADJUST_KEYS.filter((k) => look.adjust?.[k]).map((k) => `${k}=${look.adjust?.[k]}`)
  return [look.rig, ...PART_SLOTS.map((s) => look.parts[s] ?? '-'), ...rigAdjust].join('|')
}

// ---- randomization ----

/** Picks an item with probability proportional to its weight; ignores non-positive weights. */
export function weightedPick<T extends { weight: number }>(items: readonly T[], rng: Rng): T | undefined {
  let total = 0
  for (const item of items) if (item.weight > 0 && Number.isFinite(item.weight)) total += item.weight
  if (total <= 0) return undefined
  let r = unitRandom(rng) * total
  let last: T | undefined
  for (const item of items) {
    if (!(item.weight > 0) || !Number.isFinite(item.weight)) continue
    last = item
    if (r < item.weight) return item
    r -= item.weight
  }
  return last
}

/**
 * A random look: weighted picks for rig, head, every other slot (only among
 * parts the chosen head accepts that also go with the hat), each
 * face layer and a palette. Consumes `rng` in a fixed order, so a seeded rng
 * gives a reproducible look.
 */
export function randomizeLook(randomization: RandomizationConfig, compat: CompatibilityConfig, rng: Rng): CompanionLook {
  const rig = weightedPick(randomization.rig.filter((r) => (RIGS as readonly string[]).includes(r.id)), rng)?.id ?? DEFAULT_LOOK.rig
  const heads = (randomization.slots.head ?? []).filter((h) => h.id !== null && isPartId('head', h.id))
  const head = weightedPick(heads, rng)?.id ?? DEFAULT_HEAD
  const parts = { ...DEFAULT_LOOK.parts, head }
  for (const slot of PART_SLOTS) {
    if (slot === 'head') continue
    // Slots before the hat narrow the hats on offer; slots after it must go with the hat.
    const withHat = (id: string | null): boolean =>
      slot === 'hat' ? PART_SLOTS.every((other) => fitsWithHat(compat, id, other, parts[other])) : fitsWithHat(compat, parts.hat, slot, id)
    const options = (randomization.slots[slot] ?? []).filter((o) => isPartAllowed(compat, head, slot, o.id) && withHat(o.id))
    parts[slot] = weightedPick(options, rng)?.id ?? null
  }
  const face = { ...DEFAULT_LOOK.face }
  for (const layer of FACE_LAYERS) {
    const options = (randomization.face[layer] ?? []).filter((o) => isFaceId(layer, o.id))
    face[layer] = weightedPick(options, rng)?.id ?? DEFAULT_LOOK.face[layer]
  }
  const colors = weightedPick(randomization.palettes ?? [], rng)?.colors ?? DEFAULT_LOOK.colors
  return normalizeLook({ rig, parts, face, colors }, compat)
}

/** A small seeded generator (mulberry32) for reproducible shuffles and tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- animation events ----

/**
 * Events whose time lies in (prevTime, time], in the order they occur. When
 * `time < prevTime` the clip looped, so the window is (prevTime, duration]
 * followed by [0, time]. Pass a negative `prevTime` on a clip's first frame
 * so cues at t = 0 fire.
 */
export function dueEvents<E extends { t: number }>(events: readonly E[], prevTime: number, time: number, duration: number): E[] {
  if (!(duration > 0) || events.length === 0) return []
  const byTime = (a: E, b: E): number => a.t - b.t
  if (time >= prevTime) return events.filter((e) => e.t > prevTime && e.t <= time).sort(byTime)
  const tail = events.filter((e) => e.t > prevTime && e.t <= duration).sort(byTime)
  const head = events.filter((e) => e.t >= 0 && e.t <= time).sort(byTime)
  return [...tail, ...head]
}

// ---- face and gaze ----

/** Talk energy jumps to 1 on each streamed chunk and fades out in under half a second. */
export function decayTalk(energy: number, dt: number): number {
  return Math.max(0, energy - dt * 2.2)
}

/** Mouth while talking: alternates small and wide with energy; null when quiet. */
export function talkMouth(energy: number, time: number): MouthVariant | null {
  if (!(energy > 0.08)) return null
  const open = Math.min(1, energy) * (0.35 + 0.65 * Math.abs(Math.sin(time * 12)))
  return open > 0.62 ? 'talk-wide' : 'talk-small'
}

/** Seconds until the next random blink: 2.5–5 s. */
export function nextBlinkDelay(rng: Rng): number {
  return 2.5 + unitRandom(rng) * 2.5
}

export const BLINK_SECONDS = 0.13

/** Closed or squinted eyes do not blink. */
export function canBlink(eyes: EyeVariant): boolean {
  return eyes !== 'blink' && eyes !== 'happy' && eyes !== 'sleepy'
}

export interface FaceInput {
  mood: CompanionMood
  /** An active expression cue (animation event or reaction). */
  expression?: Partial<FaceState> | null
  /** Talk energy, 0..1. */
  talk?: number
  /** Seconds, drives the talk mouth's rhythm. */
  time?: number
  blinking?: boolean
}

/** Layers the face: mood rest face, then an expression cue, then the talk mouth, then a blink. */
export function resolveFace(input: FaceInput): FaceState {
  const face: FaceState = { ...MOOD_FACE[input.mood] }
  const expression = input.expression
  if (expression) {
    if (expression.eyes) face.eyes = expression.eyes
    if (expression.brows) face.brows = expression.brows
    if (expression.mouth) face.mouth = expression.mouth
  }
  if (input.mood === 'talking') {
    const mouth = talkMouth(input.talk ?? 0, input.time ?? 0)
    if (mouth) face.mouth = mouth
  }
  if (input.blinking && canBlink(face.eyes)) face.eyes = 'blink'
  return face
}

const DEFAULT_PUPIL_VARIANTS: readonly EyeVariant[] = ['neutral', 'focused', 'wide', 'sad']

/** Whether this eyes part shows its pupil layer in `variant`. */
export function showsPupils(def: FacePartDef | undefined, variant: EyeVariant): boolean {
  if (!def?.pupils) return false
  return (def.pupilVariants ?? DEFAULT_PUPIL_VARIANTS).includes(variant)
}

export interface Gaze {
  /** -1 (left) .. 1 (right), as seen by the viewer. */
  x: number
  /** -1 (down) .. 1 (up). */
  y: number
}

/** Where the companion looks: the pointer in attentive moods, a fixed direction otherwise. */
export function moodGaze(mood: CompanionMood, pointer: Gaze): Gaze {
  const px = clamp(pointer.x, -1, 1)
  const py = clamp(pointer.y, -1, 1)
  switch (mood) {
    case 'thinking':
      return { x: -0.5, y: 0.55 }
    case 'working':
      return { x: px * 0.25, y: -0.45 }
    case 'sad':
      return { x: 0, y: -0.5 }
    case 'sleeping':
      return { x: 0, y: -0.2 }
    case 'talking':
      return { x: px * 0.6, y: py * 0.6 }
    default:
      return { x: px, y: py }
  }
}

export function isMood(value: unknown): value is CompanionMood {
  return (COMPANION_MOODS as readonly unknown[]).includes(value)
}

// ---- colour helpers ----

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(isHexColor(hex) ? hex.slice(1) : '000000', 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const part = (v: number): string => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const k = clamp(t, 0, 1)
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k])
}

/** Scales HSL lightness by `factor` (0..1) and nudges saturation up, for ink-like outlines. */
export function darkenHex(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  const nl = l * clamp(factor, 0, 1)
  const ns = Math.min(1, s * 1.1)
  if (ns === 0) return rgbToHex([nl * 255, nl * 255, nl * 255])
  const q = nl < 0.5 ? nl * (1 + ns) : nl + ns - nl * ns
  const p = 2 * nl - q
  const hue = (t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (u < 1 / 6) return p + (q - p) * 6 * u
    if (u < 1 / 2) return q
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6
    return p
  }
  return rgbToHex([hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255])
}

/** Ink outline in a darkened skin tone. */
export function outlineColor(skin: string): string {
  return darkenHex(skin, 0.32)
}

/** Soft blush that suits the skin tone. */
export function cheekColor(skin: string): string {
  return mixHex(skin, '#ff7fa6', 0.65)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0))
}

/** rng() kept inside [0, 1) even for a misbehaving generator. */
function unitRandom(rng: Rng): number {
  const v = rng()
  return Number.isFinite(v) ? Math.min(1 - Number.EPSILON, Math.max(0, v)) : 0
}
