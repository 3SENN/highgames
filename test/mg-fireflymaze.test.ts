import { describe, expect, it } from 'vitest';
import {
  CENTRE,
  CORNERS,
  type Garden,
  MAZE,
  type Seeker,
  cellAt,
  cellCentre,
  cellOf,
  cellX,
  cellY,
  cpuMaze,
  distances,
  flyPos,
  gardenOver,
  isOpen,
  makeMaze,
  mazeScores,
  newGarden,
  newSeeker,
  pathBetween,
  placeFlies,
  quarterOf,
  startCells,
  stepGarden,
} from '../src/game/minigames/fireflymaze';
import { createRng } from '../src/game/rng';

const DT = 1 / 120;
const S = MAZE.size;
const turn = (c: number) => cellOf(S - 1 - cellY(c), cellX(c));

/** A garden with no fireflies about, so tests can set up just what they need. */
function emptyGarden(players: number, seed = 1): Garden {
  const g = newGarden(createRng(seed), players);
  for (const f of g.flies) f.banked = true;
  return g;
}

describe('firefly maze', () => {
  it('builds mazes where every corner reaches every cell, and the middle in the same number of steps', () => {
    for (let seed = 1; seed < 80; seed++) {
      const m = makeMaze(createRng(seed));
      const steps = CORNERS.map((c) => {
        const d = distances(m, c);
        expect(d.every((v) => Number.isFinite(v))).toBe(true);
        return d[CENTRE] as number;
      });
      expect(new Set(steps).size).toBe(1);
      expect(steps[0]).toBeGreaterThanOrEqual(MAZE.minWayIn);
    }
  });

  it('has loops and short cuts into the next quarter, not just one way through', () => {
    for (let seed = 1; seed < 30; seed++) {
      const m = makeMaze(createRng(seed));
      let gaps = 0;
      for (let c = 0; c < S * S; c++) gaps += Number(m.right[c] === true) + Number(m.down[c] === true);
      expect(gaps).toBeGreaterThan(S * S - 1); // a tree has exactly cells - 1 gaps
      let across = 0;
      for (let c = 0; c < S * S; c++) {
        for (const n of [c + 1, c + S]) {
          if (n < S * S && isOpen(m, c, n) && quarterOf(c) >= 0 && quarterOf(n) >= 0 && quarterOf(c) !== quarterOf(n)) across++;
        }
      }
      expect(across).toBeGreaterThan(0);
    }
  });

  it('is the same after a quarter turn round the middle', () => {
    const m = makeMaze(createRng(3));
    for (let c = 0; c < S * S; c++) {
      for (const n of [c + 1, c + S]) {
        if (n >= S * S || (n === c + 1 && cellY(n) !== cellY(c))) continue;
        expect(isOpen(m, turn(c), turn(n))).toBe(isOpen(m, c, n));
      }
    }
  });

  it('gives each seed its own maze, and the same maze for the same seed', () => {
    const a = makeMaze(createRng(5));
    const b = makeMaze(createRng(5));
    const c = makeMaze(createRng(6));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('splits the grid into four quarters of the same size round the middle', () => {
    const counts = [0, 0, 0, 0];
    for (let c = 0; c < S * S; c++) {
      const q = quarterOf(c);
      if (c === CENTRE) expect(q).toBe(-1);
      else counts[q] = (counts[q] ?? 0) + 1;
    }
    expect(counts).toEqual([20, 20, 20, 20]);
    expect(new Set(CORNERS.map(quarterOf)).size).toBe(4);
  });

  it('spreads the fireflies evenly over the quarters, away from the corners, with more blinking in later', () => {
    const flies = placeFlies(createRng(7));
    const [from, to, every] = MAZE.spawn;
    const later = Math.floor((to - from) / every) + 1;
    expect(later % 4).toBe(0);
    expect(flies).toHaveLength(MAZE.perQuarter * 4 + later);
    expect(flies.filter((f) => f.at === 0)).toHaveLength(MAZE.perQuarter * 4);
    expect(Math.max(...flies.map((f) => f.at))).toBeLessThan(MAZE.duration - 5);
    const perQuarter = [0, 0, 0, 0];
    for (const f of flies) {
      perQuarter[quarterOf(f.cell)] = (perQuarter[quarterOf(f.cell)] ?? 0) + 1;
      expect(CORNERS as readonly number[]).not.toContain(f.cell);
      expect(cellAt(f.hx, f.hz)).toBe(f.cell);
    }
    const each = MAZE.perQuarter + later / 4;
    expect(perQuarter).toEqual([each, each, each, each]);
    expect(new Set(startCells(2)).size).toBe(2);
    expect(startCells(4)).toEqual([...CORNERS]);
  });

  it('walks with the stick and never through a hedge', () => {
    const g = emptyGarden(1);
    const w = g.walkers[0];
    if (!w) throw new Error('no walker');
    const start = cellAt(w.x, w.z);
    for (let i = 0; i < 6 / DT; i++) stepGarden(g, [{ x: Math.sin(i * 0.01), y: Math.cos(i * 0.013) }], DT);
    // Every move between cells went through a gap.
    const g2 = emptyGarden(1, 9);
    const w2 = g2.walkers[0] as Garden['walkers'][number];
    let cell = cellAt(w2.x, w2.z);
    for (let i = 0; i < 20 / DT; i++) {
      stepGarden(g2, [{ x: Math.cos(i * 0.004), y: Math.sin(i * 0.0071) }], DT);
      const now = cellAt(w2.x, w2.z);
      if (now !== cell) {
        expect(isOpen(g2.maze, cell, now)).toBe(true);
        cell = now;
      }
    }
    expect(Math.abs(w.x)).toBeLessThan((S / 2) * MAZE.cell);
    expect(start).toBe(CORNERS[0]);
  });

  it('collects fireflies you walk past, and banks them on the way out', () => {
    const g = emptyGarden(2);
    const w = g.walkers[0] as Garden['walkers'][number];
    const f = g.flies[0];
    if (!f) throw new Error('no fly');
    f.banked = false;
    f.cell = cellAt(w.x, w.z);
    f.hx = w.x;
    f.hz = w.z;
    const ev = stepGarden(g, [], DT);
    expect(ev.caught).toEqual([{ seat: 0, fly: 0 }]);
    expect(w.trail).toEqual([0]);
    // Walk the way out.
    const path = pathBetween(g.maze, cellAt(w.x, w.z), CENTRE);
    w.x = 0.2;
    w.z = 0;
    const out = stepGarden(g, [], DT);
    expect(path.length).toBeGreaterThan(1);
    expect(out.exited).toEqual([{ seat: 0, banked: 1, first: true }]);
    expect(f.banked).toBe(true);
    expect(mazeScores(g)).toEqual([1 + MAZE.firstBonus, 0]);
  });

  it("doesn't catch a firefly through a hedge", () => {
    const g = emptyGarden(1, 4);
    const w = g.walkers[0] as Garden['walkers'][number];
    const here = cellAt(w.x, w.z);
    const blocked = [here + 1, here + S].find((n) => !isOpen(g.maze, here, n));
    if (blocked === undefined) return; // the corner has both gaps open in this maze
    const f = g.flies[0] as Garden['flies'][number];
    f.banked = false;
    f.cell = blocked;
    const c = cellCentre(blocked);
    const h = cellCentre(here);
    f.hx = (c.x + h.x) / 2 + (c.x - h.x) * 0.12;
    f.hz = (c.z + h.z) / 2 + (c.z - h.z) * 0.12;
    w.x = (c.x + h.x) / 2 - (c.x - h.x) * 0.2;
    w.z = (c.z + h.z) / 2 - (c.z - h.z) * 0.2;
    f.phase = 0;
    const pos = flyPos(f, DT);
    if (Math.hypot(pos.x - w.x, pos.z - w.z) >= MAZE.catchR) return;
    expect(stepGarden(g, [], DT).caught).toEqual([]);
  });

  it('moves one firefly from whoever walks into someone over to them', () => {
    const g = emptyGarden(2);
    const [a, b] = g.walkers;
    if (!a || !b) throw new Error('walkers');
    // Both in the middle of an open stretch: the first quarter's root cell, next to the middle.
    const c = cellCentre(cellOf((S - 1) / 2, (S - 1) / 2 - 1));
    a.x = c.x;
    a.z = c.z - 0.9;
    b.x = c.x;
    b.z = c.z;
    a.trail = [3, 4];
    b.trail = [];
    g.flies[3]!.owner = 0;
    g.flies[4]!.owner = 0;
    let bump: ReturnType<typeof stepGarden>['bumps'][number] | undefined;
    for (let i = 0; i < 60 && !bump; i++) bump = stepGarden(g, [{ x: 0, y: -1 }, { x: 0, y: 0 }], DT).bumps[0];
    expect(bump).toEqual({ from: 0, to: 1, fly: 4 });
    expect(a.trail).toEqual([3]);
    expect(b.trail).toEqual([4]);
    expect(g.flies[4]!.owner).toBe(1);
    // Not again straight away.
    for (let i = 0; i < 20; i++) expect(stepGarden(g, [{ x: 0, y: -1 }, { x: 0, y: 0 }], DT).bumps).toEqual([]);
  });

  it('counts fireflies still following you at the end as half', () => {
    const g = emptyGarden(3);
    g.walkers[0]!.trail = [1, 2, 3];
    g.walkers[1]!.banked = 4;
    g.walkers[1]!.exitedAt = 20;
    g.time = MAZE.duration;
    expect(gardenOver(g)).toBe(true);
    expect(mazeScores(g)).toEqual([1.5, 4, 0]);
  });

  const playGarden = (skills: number[], seed: number) => {
    const rng = createRng(seed);
    const g = newGarden(rng, skills.length);
    const brains: Seeker[] = skills.map((s) => newSeeker(rng, s));
    let bumps = 0;
    while (!gardenOver(g)) {
      const ev = stepGarden(g, skills.map((_, i) => cpuMaze(g, i, brains[i] as Seeker, rng, DT)), DT);
      bumps += ev.bumps.length;
    }
    return { g, bumps };
  };

  it('has computer players collect fireflies and find the way out', () => {
    let exits = 0;
    let caught = 0;
    let bumps = 0;
    const games = 30;
    for (let seed = 1; seed <= games; seed++) {
      const r = playGarden([0.5, 0.5, 0.5, 0.5], seed);
      exits += r.g.walkers.filter((w) => w.exitedAt !== null).length;
      caught += r.g.flies.filter((f) => f.owner !== null || f.banked).length;
      bumps += r.bumps;
    }
    expect(exits / (games * 4)).toBeGreaterThan(0.6);
    expect(caught / games).toBeGreaterThan(MAZE.perQuarter * 4);
    expect(bumps).toBeGreaterThan(0);
  });

  it('has sharp computer players score more than sleepy ones', () => {
    let sharp = 0;
    let sleepy = 0;
    let sharpBest = 0;
    const games = 40;
    for (let seed = 1; seed <= games; seed++) {
      const skills = [1, 0, 0.5, 0.5];
      const shift = seed % 4;
      const order = skills.map((_, i) => skills[(i + shift) % 4] as number);
      const scores = mazeScores(playGarden(order, seed * 3).g);
      const s = scores[order.indexOf(1)] as number;
      const z = scores[order.indexOf(0)] as number;
      sharp += s;
      sleepy += z;
      if (s >= Math.max(...scores)) sharpBest++;
    }
    expect(sharp).toBeGreaterThan(sleepy * 1.25);
    expect(sharpBest).toBeGreaterThan(games * 0.3);
    expect(sharpBest).toBeLessThan(games);
  });
});
