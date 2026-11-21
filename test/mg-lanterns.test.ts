import { describe, expect, it } from 'vitest';
import {
  LANTERN,
  type LanternBrain,
  type Shore,
  type ShoreEvent,
  basketSize,
  cpuLantern,
  heatAt,
  heatNow,
  holdFor,
  lanternCoop,
  lanternGoal,
  letGo,
  newLanternBrain,
  newShore,
  press,
  shoreOver,
  skyCount,
  stepShore,
  togetherCount,
} from '../src/game/minigames/lanterns';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

function advance(s: Shore, seconds: number, seed = 1): ShoreEvent[] {
  const rng = createRng(seed);
  const events: ShoreEvent[] = [];
  const end = s.time + seconds;
  while (s.time < end - 1e-9) events.push(...stepShore(s, Math.min(DT, end - s.time), rng));
  return events;
}

/** Holds seat's lantern until it reaches warmth h (no delay), and lets go. */
function holdTo(s: Shore, seat: number, h: number): ShoreEvent | null {
  const l = s.holders[seat]?.lantern;
  if (!l) throw new Error('no lantern');
  press(s, seat);
  advance(s, holdFor(l, h) - (s.holders[seat]?.offset ?? 0));
  return letGo(s, seat);
}

function cpuGame(players: number, skill: number, seed: number): Shore {
  const rng = createRng(seed);
  const s = newShore(createRng(seed * 7 + 1), players);
  const brains: LanternBrain[] = Array.from({ length: players }, () => newLanternBrain(skill));
  while (!shoreOver(s)) {
    stepShore(s, DT, rng);
    brains.forEach((b, i) => {
      const act = cpuLantern(s, i, b, rng);
      if (act === 'press') press(s, i);
      else if (act === 'release') letGo(s, i);
    });
  }
  return s;
}

describe('sky lanterns', () => {
  it('needs 6 lanterns for one or two players and 8 for more, with a lantern in every hand to start', () => {
    expect([1, 2, 3, 4].map(lanternGoal)).toEqual([6, 6, 8, 8]);
    for (let players = 1; players <= 4; players++) {
      expect(basketSize(players)).toBeGreaterThanOrEqual(lanternGoal(players));
      const s = newShore(createRng(players), players);
      expect(s.goal).toBe(lanternGoal(players));
      expect(s.basket).toBe(basketSize(players) - players);
      expect(s.holders.every((h) => h.state === 'ready' && h.lantern)).toBe(true);
    }
    // Solo there is nobody to release together with, so a couple of spares.
    expect(basketSize(1)).toBeGreaterThan(lanternGoal(1));
  });

  it('warms up steadily from cold to scorching, a little faster as the air heats', () => {
    const s = newShore(createRng(2), 1);
    const l = s.holders[0]?.lantern;
    if (!l) throw new Error('no lantern');
    expect(heatAt(l, 0)).toBe(0);
    let prev = 0;
    for (let t = 0.05; t < l.full * 1.3; t += 0.05) {
      const h = heatAt(l, t);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
    expect(prev).toBe(1);
    // The second half of the warm-up gains more than the first.
    expect(heatAt(l, l.full) - heatAt(l, l.full / 2)).toBeGreaterThan(heatAt(l, l.full / 2));
    for (const h of [0.2, LANTERN.zone, 0.95]) expect(heatAt(l, holdFor(l, h))).toBeCloseTo(h, 3);
  });

  it('sends a golden lantern up and hands over a new one from the basket', () => {
    const s = newShore(createRng(3), 3);
    const basket = s.basket;
    const e = holdTo(s, 0, (LANTERN.zone + 1) / 2);
    expect(e).toMatchObject({ kind: 'launch', seat: 0, size: 1 });
    expect(s.launches).toHaveLength(1);
    expect(s.holders[0]?.state).toBe('launched');
    const later = advance(s, LANTERN.reload + 0.05);
    expect(later).toContainEqual({ kind: 'unfold', seat: 0 });
    expect(s.basket).toBe(basket - 1);
    expect(s.holders[0]?.state).toBe('ready');
  });

  it('lets a too-early lantern sink back into your hands, keeping some warmth', () => {
    const s = newShore(createRng(4), 2);
    const basket = s.basket;
    const e = holdTo(s, 1, 0.5);
    expect(e?.kind).toBe('early');
    expect(s.holders[1]?.state).toBe('sinking');
    expect(s.holders[1]?.early).toBe(1);
    advance(s, LANTERN.sink + 0.05);
    expect(s.holders[1]?.state).toBe('ready');
    expect(s.basket).toBe(basket);
    expect(heatNow(s, 1)).toBeCloseTo(0.5 * LANTERN.keep, 2);
    // Pressing again carries on from there.
    expect(holdTo(s, 1, (LANTERN.zone + 1) / 2)?.kind).toBe('launch');
  });

  it('scorches a lantern held too long: lost, and a new one comes out of the basket', () => {
    const s = newShore(createRng(5), 2);
    const l = s.holders[0]?.lantern;
    if (!l) throw new Error('no lantern');
    press(s, 0);
    const events = advance(s, l.full * 1.5);
    expect(events.filter((e) => e.kind === 'scorch')).toEqual([{ kind: 'scorch', seat: 0 }]);
    expect(events).toContainEqual({ kind: 'unfold', seat: 0 });
    expect(s.holders[0]?.scorched).toBe(1);
    expect(s.launches).toHaveLength(0);
    // Letting go now (still holding through the pause) does nothing; the new lantern needs a fresh press.
    expect(letGo(s, 0)).toBeNull();
    expect(s.holders[0]?.state).toBe('ready');
  });

  it('judges on what the screen showed: the phone’s delay is taken off both ways', () => {
    const lag = 0.1;
    // A release that reaches the TV just after the lantern turned gold was let go before it did.
    const a = newShore(createRng(6), 2);
    const la = a.holders[0]?.lantern;
    if (!la) throw new Error('no lantern');
    press(a, 0, lag);
    advance(a, holdFor(la, LANTERN.zone) + lag / 2);
    expect(letGo(a, 0)?.kind).toBe('early');
    // And a lantern that is past full on the TV is not scorched until it was on the phone's screen too.
    const b = newShore(createRng(6), 2);
    const lb = b.holders[0]?.lantern;
    if (!lb) throw new Error('no lantern');
    press(b, 0, lag);
    const events = advance(b, holdFor(lb, 1) + lag / 2);
    expect(events.some((e) => e.kind === 'scorch')).toBe(false);
    expect(letGo(b, 0)?.kind).toBe('launch');
  });

  it('counts golden lanterns let go within a second of each other as a group release, with a bonus', () => {
    const s = newShore(createRng(7), 4);
    const golden = (LANTERN.zone + 1) / 2;
    const ls = s.holders.map((h) => h.lantern);
    if (ls.some((l) => !l)) throw new Error('no lanterns');
    // Everyone presses together; each lets go when theirs is golden.
    for (let i = 0; i < 4; i++) press(s, i);
    const at = ls.map((l) => holdFor(l as NonNullable<typeof l>, golden));
    const order = [0, 1, 2, 3].sort((x, y) => (at[x] as number) - (at[y] as number));
    const events: ShoreEvent[] = [];
    for (const i of order) {
      advance(s, Math.max(0, (at[i] as number) - s.time));
      const e = letGo(s, i);
      if (e) events.push(e);
    }
    const spread = (at[order[3] as number] as number) - (at[order[0] as number] as number);
    expect(spread).toBeGreaterThan(0);
    const launches = events.filter((e) => e.kind === 'launch');
    expect(launches).toHaveLength(4);
    // Consecutive releases less than a second apart chain into one group.
    const groups = new Set(launches.map((e) => (e.kind === 'launch' ? e.group : -1)));
    let expected = 1;
    for (let k = 1; k < 4; k++) if ((at[order[k] as number] as number) - (at[order[k - 1] as number] as number) > LANTERN.group) expected += 1;
    expect(groups.size).toBe(expected);
    expect(togetherCount(s)).toBeGreaterThanOrEqual(expected === 4 ? 0 : 2);
    expect(skyCount(s)).toBeCloseTo(4 + togetherCount(s) * LANTERN.bonus);
  });

  it('starts a new group after a gap of more than a second', () => {
    const s = newShore(createRng(8), 3);
    const golden = (LANTERN.zone + 1) / 2;
    expect(holdTo(s, 0, golden)).toMatchObject({ kind: 'launch', size: 1 });
    // Seat 1 was nearly warm already and lets go half a second later: together.
    const h1 = s.holders[1];
    const l1 = h1?.lantern;
    if (!h1 || !l1) throw new Error('no lantern');
    h1.offset = holdFor(l1, golden) - 0.5;
    press(s, 1);
    advance(s, 0.5);
    expect(letGo(s, 1)).toMatchObject({ kind: 'launch', size: 2 });
    expect(s.holders[0]?.together).toBe(1);
    expect(s.holders[1]?.together).toBe(1);
    // Seat 2 lets go two seconds after that: on its own.
    const h2 = s.holders[2];
    const l2 = h2?.lantern;
    if (!h2 || !l2) throw new Error('no lantern');
    h2.offset = holdFor(l2, golden) - 2;
    press(s, 2);
    advance(s, 2);
    expect(letGo(s, 2)).toMatchObject({ kind: 'launch', size: 1 });
    expect(togetherCount(s)).toBe(2);
  });

  it('scores lanterns up over the goal, with the group bonus able to make up for one that scorched', () => {
    const s = newShore(createRng(9), 4);
    expect(lanternCoop(s)).toBe(0);
    s.launches = Array.from({ length: 7 }, (_, i) => ({ seat: i % 4, at: i, group: i < 4 ? 0 : 1 }));
    s.groups = [
      [0, 1, 2, 3],
      [0, 1, 2],
    ];
    expect(7 / s.goal).toBeLessThan(1);
    expect(lanternCoop(s)).toBe(1);
    s.groups = [[0], [1], [2], [3], [0], [1], [2]];
    expect(lanternCoop(s)).toBeCloseTo(7 / 8);
  });

  it('ends when time is up, the sky is full, or the lanterns run out', () => {
    const s = newShore(createRng(10), 2);
    expect(shoreOver(s)).toBe(false);
    s.basket = 0;
    for (const h of s.holders) {
      h.state = 'empty';
      h.lantern = null;
    }
    expect(shoreOver(s)).toBe(true);
    const t = newShore(createRng(10), 2);
    advance(t, LANTERN.duration + 0.01);
    expect(shoreOver(t)).toBe(true);
    expect(press(t, 0)).toBe(false);
  });

  it('gets sharp computer groups to the goal and average ones most of the way, for any group size', () => {
    const avg = (players: number, skill: number) => {
      let sum = 0;
      const N = 40;
      for (let seed = 1; seed <= N; seed++) sum += lanternCoop(cpuGame(players, skill, seed));
      return sum / N;
    };
    for (let players = 1; players <= 4; players++) {
      const sharp = avg(players, 1);
      const mid = avg(players, 0.55);
      const sleepy = avg(players, 0.15);
      expect(sharp).toBeGreaterThan(0.95);
      expect(mid).toBeGreaterThan(0.6);
      expect(mid).toBeLessThan(0.92);
      expect(sleepy).toBeLessThan(mid);
    }
  });
});
