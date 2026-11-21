// Every minigame, found in ./games/ at build time. Each file there exports `minigame`.
import type { Minigame, MinigameKind } from './types';

const modules = import.meta.glob<{ minigame: Minigame }>('./games/*.ts', { eager: true });

export const MINIGAMES: readonly Minigame[] = Object.values(modules)
  .map((m) => m.minigame)
  .filter((m): m is Minigame => Boolean(m))
  .sort((a, b) => a.title.localeCompare(b.title));

export function minigameById(id: string): Minigame | undefined {
  return MINIGAMES.find((m) => m.id === id);
}

export function minigamesOfKind(...kinds: MinigameKind[]): Minigame[] {
  return MINIGAMES.filter((m) => kinds.includes(m.kind));
}

/** Games a group can play together: real co-op games, and competitive ones with a co-op target. */
export function coopMinigames(): Minigame[] {
  return MINIGAMES.filter((m) => m.kind === 'coop' || m.coopTarget !== undefined);
}
