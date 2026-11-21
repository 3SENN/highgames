// Cloud Spotter's clouds: three features that both the TV and the phones draw the same way.

export interface CloudFeatures {
  shape: number; // 0 puffy, 1 tall, 2 long
  color: number; // index into CLOUD_COLORS
  mark: number; // index into CLOUD_MARKS
}

export const CLOUD_SHAPES = ['puffy', 'tall', 'long'] as const;
export const CLOUD_COLORS = ['#FFFFFF', '#FFC6DA', '#BDF2D5', '#D7C8FF'] as const;
export const CLOUD_COLOR_NAMES = ['white', 'pink', 'mint', 'lilac'] as const;
export const CLOUD_MARKS = ['star', 'drop', 'bolt', 'sun', 'moon', 'heart'] as const;

export const CLOUD_VARIANTS = CLOUD_SHAPES.length * CLOUD_COLORS.length * CLOUD_MARKS.length;

export function cloudKey(f: CloudFeatures): number {
  return (f.shape * CLOUD_COLORS.length + f.color) * CLOUD_MARKS.length + f.mark;
}

export function cloudFromKey(key: number): CloudFeatures {
  const mark = key % CLOUD_MARKS.length;
  const rest = Math.floor(key / CLOUD_MARKS.length);
  return { shape: Math.floor(rest / CLOUD_COLORS.length), color: rest % CLOUD_COLORS.length, mark };
}

export function isCloudFeatures(v: unknown): v is CloudFeatures {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  const ok = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < max;
  return ok(f.shape, CLOUD_SHAPES.length) && ok(f.color, CLOUD_COLORS.length) && ok(f.mark, CLOUD_MARKS.length);
}

const BODIES = [
  // puffy
  'M22 70c-11 0-18-8-18-17s8-17 18-16c2-12 13-21 26-20 9 0 17 5 21 13 4-3 9-4 14-3 11 2 18 12 16 23 8 2 13 9 13 17 0 9-7 16-17 16H22z',
  // tall
  'M30 92c-12 0-20-8-20-18 0-8 5-14 12-17-2-4-3-8-2-13 1-12 12-21 24-20 3-12 14-20 26-18 13 2 21 15 18 28 9 3 15 12 13 22-1 9-7 15-15 16 4 4 6 9 5 14-2 4-6 6-11 6H30z',
  // long
  'M14 78c-8 0-13-6-13-13s6-13 13-12c1-9 9-15 18-14 4-8 13-12 22-10 6-5 15-6 22-2 6 3 10 8 11 14 8-1 15 4 17 12 1 2 1 4 1 6 6 2 10 8 9 14-1 6-6 10-12 10H14z',
];

const MARKS: Record<(typeof CLOUD_MARKS)[number], string> = {
  star: '<path d="M60 40l5.3 11 12.1 1.6-8.8 8.4 2.2 12L60 67.2 49.2 73l2.2-12-8.8-8.4 12.1-1.6z" fill="#F2B705"/>',
  drop: '<path d="M60 38c7 10 12 17 12 24a12 12 0 0 1-24 0c0-7 5-14 12-24z" fill="#3B82F6"/>',
  bolt: '<path d="M64 36 48 60h10l-5 18 17-26H60z" fill="#F59E0B" stroke="#7a4b00" stroke-width="1.5" stroke-linejoin="round"/>',
  sun: '<g fill="#FF9F1C"><circle cx="60" cy="57" r="9"/><g stroke="#FF9F1C" stroke-width="3" stroke-linecap="round"><path d="M60 41v5M60 68v5M44 57h5M71 57h5M48.7 45.7l3.5 3.5M67.8 64.8l3.5 3.5M48.7 68.3l3.5-3.5M67.8 49.2l3.5-3.5"/></g></g>',
  moon: '<path d="M66 41a17 17 0 1 0 0 32 14 14 0 0 1 0-32z" fill="#6D5BD0"/>',
  heart: '<path d="M60 74S45 64 45 53.5c0-5 3.8-8.5 8.3-8.5 3 0 5.3 1.6 6.7 4 1.4-2.4 3.7-4 6.7-4 4.5 0 8.3 3.5 8.3 8.5C75 64 60 74 60 74z" fill="#E5484D"/>',
};

/** SVG markup for a cloud (120x100 viewBox). All inputs are numbers from our own generator. */
export function cloudSvg(f: CloudFeatures, opts: { size?: number; label?: string } = {}): string {
  const size = opts.size ?? 120;
  const body = BODIES[f.shape] ?? BODIES[0];
  const color = CLOUD_COLORS[f.color] ?? CLOUD_COLORS[0];
  const mark = MARKS[CLOUD_MARKS[f.mark] ?? 'star'];
  const label = opts.label
    ? `<circle cx="104" cy="16" r="13" fill="#13203B"/><text x="104" y="21.5" text-anchor="middle" font-size="16" font-weight="800" font-family="system-ui,Segoe UI,sans-serif" fill="#fff">${escapeText(opts.label)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width="${size}" height="${Math.round(size * 0.83)}" role="img" aria-label="${describeCloud(f)}"><path d="${body}" fill="${color}" stroke="#4A5878" stroke-width="2.5" stroke-linejoin="round"/>${mark}${label}</svg>`;
}

export function describeCloud(f: CloudFeatures): string {
  return `${CLOUD_COLOR_NAMES[f.color]} ${CLOUD_SHAPES[f.shape]} cloud with a ${CLOUD_MARKS[f.mark]}`;
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
