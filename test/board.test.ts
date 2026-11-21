import { describe, expect, it } from 'vitest';
import { createBoard, distance, space } from '../src/game/board';
import { DESTINATIONS } from '../src/shared/islands';

const board = createBoard();

describe('board', () => {
  it('has a ring of 30 spaces plus two lanes through HQ', () => {
    expect(board.spaces).toHaveLength(38);
    expect(board.posts).toHaveLength(2);
  });

  it('only links to spaces that exist', () => {
    for (const s of board.spaces) {
      expect(s.next.length).toBeGreaterThan(0);
      for (const n of s.next) expect(board.spaces[n]).toBeDefined();
    }
  });

  it('has exactly two forks: the ends of Balloon Docks and Lighthouse Rock', () => {
    const forks = board.spaces.filter((s) => s.next.length > 1);
    expect(forks.map((s) => s.island)).toEqual(['docks', 'lighthouse']);
  });

  it('can reach every space from the start', () => {
    for (const s of board.spaces) expect(distance(board, board.start, new Set([s.id]))).toBeLessThan(Infinity);
  });

  it('gives every destination island a dock on that island', () => {
    for (const d of DESTINATIONS) {
      const id = board.docks[d];
      expect(id).toBeDefined();
      expect(space(board, id as number)).toMatchObject({ type: 'dock', island: d });
    }
  });

  it('makes the HQ lanes a shortcut', () => {
    const lighthouseStart = new Set([15]);
    const viaLane = distance(board, 30, lighthouseStart) + 1; // from the fork at space 3
    const viaRing = distance(board, 4, lighthouseStart) + 1;
    expect(viaLane).toBeLessThan(viaRing);
  });

  it('keeps spaces apart so tokens never overlap', () => {
    for (const a of board.spaces) {
      for (const b of board.spaces) {
        if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(3);
      }
    }
  });
});
