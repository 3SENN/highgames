// The Skypost board: six islands in a ring around Skypost HQ, joined by rope bridges.
// Movement runs clockwise. Two lanes cut through HQ (where parcels are picked up) as shortcuts.
import type { IslandId } from '../shared/islands.js';

export type SpaceType = 'start' | 'breeze' | 'squall' | 'event' | 'market' | 'gust' | 'post' | 'dock';

export interface Space {
  id: number;
  island: IslandId | null; // null on bridges
  type: SpaceType;
  x: number;
  z: number;
  next: number[]; // more than one = a fork where the player chooses
}

export interface IslandShape {
  id: IslandId;
  x: number;
  z: number;
  /** Half-length along the path and half-width across it. */
  rx: number;
  rz: number;
  /** Rotation around the vertical axis, radians. */
  angle: number;
}

export interface Board {
  spaces: Space[];
  islands: IslandShape[];
  start: number;
  /** The space on each destination island where parcels are handed over. */
  docks: Partial<Record<IslandId, number>>;
  posts: number[];
}

const RING: { island: IslandId; types: SpaceType[]; bridge: SpaceType }[] = [
  { island: 'docks', types: ['start', 'market', 'breeze', 'event'], bridge: 'breeze' },
  { island: 'windmill', types: ['breeze', 'squall', 'dock', 'event'], bridge: 'squall' },
  { island: 'orchard', types: ['breeze', 'dock', 'market', 'squall'], bridge: 'gust' },
  { island: 'lighthouse', types: ['event', 'breeze', 'dock', 'squall'], bridge: 'breeze' },
  { island: 'crystal', types: ['squall', 'dock', 'breeze', 'gust'], bridge: 'squall' },
  { island: 'observatory', types: ['breeze', 'event', 'dock', 'market'], bridge: 'event' },
];
const LANE_A: SpaceType[] = ['breeze', 'post', 'event', 'breeze'];
const LANE_B: SpaceType[] = ['squall', 'post', 'breeze', 'breeze'];

const RX = 31; // ellipse of the ring
const RZ = 21;

/** Points along the ellipse, evenly spaced by distance, starting at the bottom and going clockwise on screen. */
function ellipseSampler() {
  const N = 4096;
  const pts: { x: number; z: number; s: number }[] = [];
  let s = 0;
  let prev = { x: 0, z: RZ };
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const p = { x: -RX * Math.sin(t), z: RZ * Math.cos(t) };
    s += Math.hypot(p.x - prev.x, p.z - prev.z);
    pts.push({ ...p, s });
    prev = p;
  }
  const perimeter = s;
  const at = (dist: number) => {
    const d = ((dist % perimeter) + perimeter) % perimeter;
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((pts[mid] as { s: number }).s < d) lo = mid + 1;
      else hi = mid;
    }
    const p = pts[lo] as { x: number; z: number };
    const q = pts[Math.min(lo + 1, pts.length - 1)] as { x: number; z: number };
    return { x: p.x, z: p.z, angle: Math.atan2(q.z - p.z, q.x - p.x) };
  };
  return { perimeter, at };
}

export function createBoard(): Board {
  const { perimeter, at } = ellipseSampler();
  const ringCount = RING.length * 5;
  const step = perimeter / ringCount;
  const spaces: Space[] = [];
  const islands: IslandShape[] = [];
  const docks: Partial<Record<IslandId, number>> = {};

  RING.forEach((seg, k) => {
    for (let j = 0; j < 5; j++) {
      const id = k * 5 + j;
      const p = at((id - 1.5) * step);
      const isBridge = j === 4;
      const type = isBridge ? seg.bridge : (seg.types[j] as SpaceType);
      spaces.push({ id, island: isBridge ? null : seg.island, type, x: round(p.x), z: round(p.z), next: [(id + 1) % ringCount] });
      if (type === 'dock') docks[seg.island] = id;
    }
    const c = at(k * 5 * step);
    islands.push({ id: seg.island, x: round(c.x), z: round(c.z), rx: round(1.5 * step + 3.4), rz: 6.2, angle: c.angle });
  });

  // Lane A: from the end of Balloon Docks, through HQ, to the start of Lighthouse Rock.
  const laneA = [
    [-4.2, 13.2],
    [-3.6, 4.4],
    [-3.6, -4.4],
    [-4.2, -13.2],
  ];
  // Lane B: from the end of Lighthouse Rock, through HQ, back to the start of Balloon Docks.
  const laneB = [
    [4.2, -13.2],
    [3.6, -4.4],
    [3.6, 4.4],
    [4.2, 13.2],
  ];
  const addLane = (coords: number[][], types: SpaceType[], exit: number) => {
    const first = spaces.length;
    coords.forEach(([x, z], j) => {
      const id = first + j;
      const onHq = j === 1 || j === 2;
      spaces.push({ id, island: onHq ? 'hq' : null, type: types[j] as SpaceType, x: x as number, z: z as number, next: [j === 3 ? exit : id + 1] });
    });
    return first;
  };
  const docksEnd = 3;
  const lighthouseStart = 15;
  const lighthouseEnd = 18;
  const a = addLane(laneA, LANE_A, lighthouseStart);
  const b = addLane(laneB, LANE_B, 0);
  (spaces[docksEnd] as Space).next.push(a);
  (spaces[lighthouseEnd] as Space).next.push(b);
  islands.push({ id: 'hq', x: 0, z: 0, rx: 8, rz: 9.5, angle: Math.PI / 2 });

  return { spaces, islands, start: 0, docks, posts: spaces.filter((s) => s.type === 'post').map((s) => s.id) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function space(board: Board, id: number): Space {
  const s = board.spaces[id];
  if (!s) throw new Error(`No space ${id}`);
  return s;
}

/** Fewest steps from `from` to any space in `targets` (0 if already there), or Infinity. */
export function distance(board: Board, from: number, targets: ReadonlySet<number>): number {
  if (targets.has(from)) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; frontier.length > 0 && d <= board.spaces.length; d++) {
    const nextFrontier: number[] = [];
    for (const id of frontier) {
      for (const n of space(board, id).next) {
        if (targets.has(n)) return d;
        if (!seen.has(n)) {
          seen.add(n);
          nextFrontier.push(n);
        }
      }
    }
    frontier = nextFrontier;
  }
  return Infinity;
}
