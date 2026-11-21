// The Atelier kit's companion runtime loads its art from /__atelier/kit/1/companion/: an address from the root of the
// site. That is right on the big screen, where Atelier serves the kit in the pack's own origin. A phone's page comes
// from the game's web server instead, where every address sits under the server's unguessable token, so the root
// address isn't served there. This sends those requests to the same files below the server's base, so companions
// draw on phones too. It only touches same-site /__atelier/ addresses, and does nothing when the server has no token.
// (Kit 1 builds the address with fetch() for its configuration and models and with an <img> for face layers.)

/** The address a kit file is really served at, below the server's base; other addresses come back unchanged. */
export function kitAddress(url: string, base: string, page: string): string {
  const root = new URL(base);
  if (root.pathname === '/') return url;
  let at: URL;
  try {
    at = new URL(url, page);
  } catch {
    return url;
  }
  if (at.origin !== root.origin || !at.pathname.startsWith('/__atelier/')) return url;
  return new URL(at.pathname.slice(1) + at.search + at.hash, root).href;
}

let installed = false;

/** Routes the kit runtime's root addresses below the server's base, for this page. */
export function routeKitRequests(base: string): void {
  if (installed || new URL(base).pathname === '/') return;
  installed = true;
  const fix = (url: string) => kitAddress(url, base, document.baseURI);

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' || input instanceof URL) return fetchOriginal(fix(String(input)), init);
    const fixed = fix(input.url);
    return fetchOriginal(fixed === input.url ? input : new Request(fixed, input), init);
  };

  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (src?.set && src.get) {
    const { get, set } = src;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: src.enumerable ?? true,
      get,
      set(this: HTMLImageElement, value: string) {
        set.call(this, fix(String(value)));
      },
    });
  }
}
