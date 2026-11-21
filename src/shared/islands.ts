// Island names, colours and emblems: shared by the TV (board, HUD) and the phones (parcel labels, choices).

export const ISLANDS = [
  { id: 'docks', name: 'Balloon Docks', color: '#FF8A5B', destination: false },
  { id: 'windmill', name: 'Windmill Isle', color: '#E9B949', destination: true },
  { id: 'orchard', name: 'Orchard Drift', color: '#E5484D', destination: true },
  { id: 'lighthouse', name: 'Lighthouse Rock', color: '#5B8DEF', destination: true },
  { id: 'crystal', name: 'Crystal Spire', color: '#A86CF0', destination: true },
  { id: 'observatory', name: 'Old Observatory', color: '#2E6F8E', destination: true },
  { id: 'hq', name: 'Snack Shack', color: '#F2C14E', destination: false },
] as const;

export type IslandId = (typeof ISLANDS)[number]['id'];
export type IslandInfo = (typeof ISLANDS)[number];

export const DESTINATIONS: readonly IslandId[] = ISLANDS.filter((i) => i.destination).map((i) => i.id);

export function islandInfo(id: IslandId): IslandInfo {
  const found = ISLANDS.find((i) => i.id === id);
  if (!found) throw new Error(`Unknown island ${id}`);
  return found;
}

export function isIslandId(value: unknown): value is IslandId {
  return typeof value === 'string' && ISLANDS.some((i) => i.id === value);
}

/** A small emblem for each island as SVG markup (24x24 viewBox). Generated from constants only. */
export function islandEmblem(id: IslandId, size = 24): string {
  const color = islandInfo(id).color;
  const body: Record<IslandId, string> = {
    docks: `<ellipse cx="12" cy="9" rx="6.5" ry="7.5" fill="${color}"/><path d="M9 16h6l-1 3h-4z" fill="#8a5a2b"/><path d="M8.5 14.5 10 16M15.5 14.5 14 16" stroke="#8a5a2b" stroke-width="1.2"/>`,
    windmill: `<path d="M11 13h2l1.5 9h-5z" fill="#c9a26b"/><g stroke="${color}" stroke-width="3.2" stroke-linecap="round"><path d="M12 12 5 5M12 12l7-7M12 12l-7 7M12 12l7 7"/></g><circle cx="12" cy="12" r="1.8" fill="#6b4a2b"/>`,
    orchard: `<circle cx="12" cy="14" r="7" fill="${color}"/><path d="M12 7c0-2 1-4 3-4" stroke="#6b4a2b" stroke-width="1.6" fill="none"/><path d="M13 6c2-2 5-1 5-1s-1 3-5 2z" fill="#3fa34d"/>`,
    lighthouse: `<path d="M9 21 10.5 6h3L15 21z" fill="#fff"/><path d="M9.6 15h4.8l.4 3H9.2zM10.2 9h3.6l.3 3h-4.2z" fill="${color}"/><path d="M9.5 6h5l-1-3h-3z" fill="#f2c14e"/>`,
    crystal: `<path d="M12 2 18 9l-6 13L6 9z" fill="${color}"/><path d="M12 2v20M6 9h12" stroke="#fff" stroke-opacity=".55" stroke-width="1"/>`,
    observatory: `<path d="M4 20h16v-6a8 8 0 0 0-16 0z" fill="${color}"/><path d="M12 6l1.2 2.6 2.8.3-2.1 1.9.6 2.8L12 12.2 9.5 13.6l.6-2.8L8 8.9l2.8-.3z" fill="#f2c14e"/>`,
    hq: `<rect x="4" y="7" width="16" height="11" rx="2" fill="${color}"/><path d="m4.5 8 7.5 6 7.5-6" stroke="#7a4b00" stroke-width="1.6" fill="none"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body[id]}</svg>`;
}
