import { describe, expect, it } from 'vitest';
import { createBoard } from '../src/game/board';
import { chooseFork } from '../src/game/cpu';
import { createRng } from '../src/game/rng';
import {
  BREEZE_COINS,
  PRIORITY_COST,
  SQUALL_COINS,
  START_COINS,
  applyEvent,
  awardBonuses,
  awardMinigame,
  buyItem,
  createGame,
  enterSpace,
  land,
  parcelOffer,
  placeAt,
  player,
  ranks,
  rollDice,
  standings,
  takeParcel,
  useItem,
} from '../src/game/rules';

const board = createBoard();

function newGame(n = 4, seed = 1) {
  return createGame({
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}` })),
    rounds: 5,
    board,
    rng: createRng(seed),
  });
}

describe('setup', () => {
  it('starts everyone on the start space with coins and a shuffled order', () => {
    const g = newGame();
    expect(g.players.every((p) => p.space === board.start && p.coins === START_COINS)).toBe(true);
    expect([...g.order].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('dice and items', () => {
  it('rolls 1-6, or two dice with Twin Dice, plus Tailwind', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const one = rollDice(rng);
      expect(one.total).toBeGreaterThanOrEqual(1);
      expect(one.total).toBeLessThanOrEqual(6);
      const two = rollDice(rng, { dice: 2, bonus: 3 });
      expect(two.values).toHaveLength(2);
      expect(two.total).toBeGreaterThanOrEqual(5);
      expect(two.total).toBeLessThanOrEqual(15);
    }
  });

  it('uses an item once and only items you have', () => {
    const g = newGame();
    expect(useItem(g, 0, 'twin')).toBeNull();
    player(g, 0).items.push('twin');
    expect(useItem(g, 0, 'twin')).toEqual({ dice: 2, bonus: 0 });
    expect(player(g, 0).items).toEqual([]);
  });

  it('buys items while there is room and money', () => {
    const g = newGame();
    expect(buyItem(g, 0, 'tailwind')).toBe(true);
    expect(player(g, 0).coins).toBe(START_COINS - 4);
    expect(buyItem(g, 0, 'twin')).toBe(false); // 6 coins left, costs 8
    expect(buyItem(g, 0, 'umbrella')).toBe(true);
    expect(buyItem(g, 0, 'umbrella')).toBe(false); // bag full
  });
});

describe('moving, parcels and deliveries', () => {
  it('only steps along the board', () => {
    const g = newGame();
    expect(() => enterSpace(g, board, 0, 10)).toThrow();
    enterSpace(g, board, 0, 1);
    expect(player(g, 0).space).toBe(1);
    expect(player(g, 0).stats.moved).toBe(1);
  });

  it('offers a parcel at the Post Office and delivers it at the right dock', () => {
    const g = newGame();
    placeAt(g, board, 0, 30);
    const at = enterSpace(g, board, 0, 31);
    expect(at.canPickUp).toBe(true);
    expect(takeParcel(g, 0, 'lighthouse', false)).toBe(true);
    placeAt(g, board, 0, 16);
    const delivered = enterSpace(g, board, 0, 17);
    expect(delivered.deliveries).toHaveLength(1);
    expect(player(g, 0).stamps).toBe(1);
    expect(player(g, 0).parcels).toEqual([]);
  });

  it('makes priority parcels cost coins and pay two stamps', () => {
    const g = newGame();
    expect(takeParcel(g, 0, 'crystal', true)).toBe(true);
    expect(player(g, 0).coins).toBe(START_COINS - PRIORITY_COST);
    placeAt(g, board, 0, 21);
    expect(player(g, 0).stamps).toBe(2);
  });

  it('carries at most two parcels and refuses priority without coins', () => {
    const g = newGame();
    player(g, 0).coins = 2;
    expect(takeParcel(g, 0, 'crystal', true)).toBe(false);
    expect(takeParcel(g, 0, 'crystal', false)).toBe(true);
    expect(takeParcel(g, 0, 'orchard', false)).toBe(true);
    expect(takeParcel(g, 0, 'windmill', false)).toBe(false);
    placeAt(g, board, 0, 30);
    expect(enterSpace(g, board, 0, 31).canPickUp).toBe(false);
  });

  it('offers two different destinations', () => {
    const g = newGame();
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      const offer = parcelOffer(g, 0, rng);
      expect(offer.standard).not.toBe(offer.priority);
    }
  });
});

describe('landing', () => {
  it('pays on breezes and takes on squalls, never below zero', () => {
    const g = newGame();
    const rng = createRng(1);
    placeAt(g, board, 0, 2);
    expect(land(g, board, 0, rng)).toEqual({ kind: 'coins', amount: BREEZE_COINS });
    placeAt(g, board, 0, 6);
    expect(land(g, board, 0, rng)).toEqual({ kind: 'coins', amount: -SQUALL_COINS });
    player(g, 0).coins = 1;
    expect(land(g, board, 0, rng)).toEqual({ kind: 'coins', amount: -1 });
    expect(player(g, 0).coins).toBe(0);
  });

  it('lets an umbrella block one squall', () => {
    const g = newGame();
    player(g, 0).items.push('umbrella');
    placeAt(g, board, 0, 6);
    expect(land(g, board, 0, createRng(1))).toEqual({ kind: 'umbrella' });
    expect(player(g, 0).items).toEqual([]);
    expect(player(g, 0).coins).toBe(START_COINS);
  });

  it('applies every sky event without breaking the state', () => {
    for (const event of ['shower', 'gift', 'swap', 'magpie', 'tailwind'] as const) {
      const g = newGame();
      player(g, 1).stamps = 3;
      placeAt(g, board, 0, 3);
      const before = g.players.map((p) => p.space);
      const out = applyEvent(g, board, 0, event, createRng(2));
      expect(out.title.length).toBeGreaterThan(0);
      expect(g.players.every((p) => p.coins >= 0)).toBe(true);
      if (event === 'swap') {
        expect(out.swapWith).toBeDefined();
        expect(player(g, 0).space).toBe(before[out.swapWith as number]);
      }
    }
  });
});

describe('scoring', () => {
  it('ranks with shared places', () => {
    expect(ranks([5, 9, 9, 1])).toEqual([3, 1, 1, 4]);
  });

  it('pays minigame coins by place and counts wins', () => {
    const g = newGame();
    const { places, coins } = awardMinigame(g, [3, 7, 7, 0]);
    expect(places).toEqual([3, 1, 1, 4]);
    expect(coins).toEqual([3, 10, 10, 0]);
    expect(player(g, 1).stats.wins).toBe(1);
  });

  it('orders standings by stamps, then coins', () => {
    const g = newGame();
    player(g, 2).stamps = 2;
    player(g, 3).stamps = 2;
    player(g, 3).coins = 30;
    expect(standings(g).map((s) => s.seat)).toEqual([3, 2, 0, 1]);
  });

  it('gives bonus stamps to every tied leader', () => {
    const g = newGame();
    player(g, 0).stats.wins = 2;
    player(g, 1).stats.wins = 2;
    const bonuses = awardBonuses(g);
    expect(bonuses.find((b) => b.id === 'wins')?.seats).toEqual([0, 1]);
    expect(bonuses.find((b) => b.id === 'moved')).toBeUndefined();
    expect(player(g, 0).stamps).toBe(1);
  });
});

describe('cpu', () => {
  it('heads for the Post Office with nothing to deliver', () => {
    const g = newGame();
    placeAt(g, board, 0, 3);
    expect(chooseFork(g, board, 0, [4, 30], createRng(1))).toBe(1);
  });

  it('stays on the ring to deliver to Windmill Isle', () => {
    const g = newGame();
    takeParcel(g, 0, 'windmill', false);
    takeParcel(g, 0, 'orchard', false);
    expect(chooseFork(g, board, 0, [4, 30], createRng(1))).toBe(0);
  });
});
