// How a phone joins the big screen. Atelier runs a small web server for the game (atelier.server): a phone opens the
// controller page from it and keeps one socket to the big screen, with its name and token in the socket's query.
// Atelier checks who may connect and how much they send; the TV checks what they say, starting here.

export const MAX_NAME = 14;
/** A phone's own random token: it keeps the phone's seat when it reconnects. */
export const TOKEN = /^[A-Za-z0-9_-]{8,40}$/;

export interface Join {
  name: string;
  token: string;
}

export function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // Drop control characters and collapse whitespace; names are shown with textContent, never as HTML.
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || fallback;
}

/** The phone's join from its socket's query, or null when it isn't one of our controller pages. */
export function parseJoin(query: Readonly<Record<string, unknown>> | null | undefined, fallbackName: string): Join | null {
  if (!query || typeof query !== 'object') return null;
  const token = query.token;
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  return { name: cleanName(query.name, fallbackName), token };
}
