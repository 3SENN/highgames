// Where the Atelier kit is served on this page (docs/apps.md › The kit). The big screen is an app page in its
// pack's own origin, where Atelier serves kit 1 at /__atelier/kit/1/. A phone's page comes from the game's own web
// server (atelier.server), whose addresses all sit under an unguessable token; the kit is served there too, below
// the server's base. Computed on first use, so pure modules can import this without a page.

/** The kit major the game is built against (atelier-pack.json's "kit"). */
export const KIT_MAJOR = 1;

let base: string | null = null;

/** The kit's address on this page, ending in a slash. */
export function kitBase(): string {
  if (base === null) {
    const server = typeof window === 'undefined' ? undefined : window.atelierServer?.base;
    base = server ? new URL(`__atelier/kit/${KIT_MAJOR}/`, server).href : new URL(`/__atelier/kit/${KIT_MAJOR}/`, location.href).href;
  }
  return base;
}

/** Where the companions' art is: their manifest, configuration, parts and face drawings. */
export function companionBase(): string {
  return `${kitBase()}companion/`;
}
