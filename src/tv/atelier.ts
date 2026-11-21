// The big screen inside Atelier. Highgames is an Atelier app (atelier-pack.json): Atelier hosts this page in the pack's own
// sandbox and gives it window.atelier. The game uses a little of it, and keeps working without the rest:
//   - atelier.server: the web server phones join through (net.ts);
//   - atelier.status: a short line on the game's tab and sidebar row ("Lobby · 3 players");
//   - atelier.test.ready: the game's state for Atelier's playtests;
//   - atelier.cast: the person's own companions, who fill the seats nobody's phone takes.
import { type CompanionLook, parseLook } from '../shared/look';
import type { AtelierBridge } from '../types/atelier';

/** window.atelier, or null on a page Atelier doesn't host. */
export function atelier(): AtelierBridge | null {
  return typeof window !== 'undefined' && window.atelier?.server ? window.atelier : null;
}

const STATUS_MAX = 40;
let lastStatus = '';

/** The line on the game's tab and sidebar row. Unchanged lines aren't sent again. */
export function setStatus(text: string | null): void {
  const line = text ? (text.length > STATUS_MAX ? `${text.slice(0, STATUS_MAX - 1)}…` : text) : '';
  if (line === lastStatus) return;
  lastStatus = line;
  const bridge = atelier();
  if (!bridge) return;
  void (line ? bridge.status.set({ text: line }) : bridge.status.clear()).catch(() => undefined);
}

/** What the game is doing, for Atelier's playtests (test_pack). Atelier sends it only when it changes. */
export function reportState(state: Record<string, unknown>): void {
  atelier()?.test.ready(state);
}

/** One of the person's companions, ready to sit in a seat: a name and a checked look. */
export interface CastSeat {
  name: string;
  look: CompanionLook;
}

function seats(members: unknown): CastSeat[] {
  if (!Array.isArray(members)) return [];
  const out: CastSeat[] = [];
  for (const m of members as Array<{ name?: unknown; look?: unknown }>) {
    const look = parseLook(m?.look);
    if (look && typeof m.name === 'string' && m.name.trim()) out.push({ name: m.name.trim().slice(0, 14), look });
  }
  return out;
}

/** The companions the person picked for Highgames (their active one until they pick). Empty outside Atelier. */
export async function castSeats(): Promise<CastSeat[]> {
  const bridge = atelier();
  if (!bridge) return [];
  try {
    return seats(await bridge.cast.members());
  } catch {
    return [];
  }
}

/** Atelier's character picker, over the game: which of the person's companions join as computer players. */
export async function pickCast(max: number): Promise<CastSeat[] | null> {
  const bridge = atelier();
  if (!bridge) return null;
  try {
    return seats(await bridge.cast.pick({ max, title: 'Who fills the empty seats?' }));
  } catch {
    return null;
  }
}
