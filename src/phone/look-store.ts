// The phone remembers its companion between games. A first-time player gets a random one to start from.
import { loadCompanionConfig } from '../companion/config';
import { shuffleLook } from '../companion/shuffle';
import { type CompanionLook, parseLook } from '../shared/look';

const KEY = 'skypost-look';

export function savedLook(): CompanionLook | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseLook(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLook(look: CompanionLook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // Private mode: the look lasts for this visit only.
  }
}

/** The look to join with: the saved one, or a fresh shuffle (saved straight away). */
export async function startingLook(): Promise<CompanionLook> {
  const saved = savedLook();
  if (saved) return saved;
  const look = shuffleLook(await loadCompanionConfig());
  saveLook(look);
  return look;
}
