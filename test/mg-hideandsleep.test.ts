import { describe, expect, it } from 'vitest';
import {
  HIDE,
  SPOTS,
  cpuPick,
  cpuSeek,
  cpuSneak,
  hiddenCount,
  hideScores,
  hiderOf,
  isOver,
  litSpot,
  newHideBrain,
  newHouse,
  newSeekBrain,
  pickSpot,
  pointTo,
  press,
  rustleColumn,
  sneak,
  startSeek,
  stepHouse,
} from '../src/game/minigames/hideandsleep';
import { createRng } from '../src/game/rng';

const DT = 1 / 60;

function house() {
  const h = newHouse(0, [1, 2, 3], createRng(1));
  pickSpot(h, 1, 0);
  pickSpot(h, 2, 1);
  pickSpot(h, 3, 5);
  startSeek(h);
  return h;
}

/** Points the torch at a spot and lets it settle there. */
function shine(h: ReturnType<typeof house>, spot: number) {
  const s = SPOTS[spot];
  pointTo(h, s?.x ?? 0, s?.y ?? 0);
  for (let i = 0; i < 30; i++) stepHouse(h, DT);
}

function play(seed: number, seekerSkill: number, hiderSkill: number) {
  const rng = createRng(seed);
  const h = newHouse(0, [1, 2, 3], rng);
  const seeker = newSeekBrain(h, seekerSkill);
  const hiders = [1, 2, 3].map(() => newHideBrain(hiderSkill));
  [1, 2, 3].forEach((s, k) => pickSpot(h, s, cpuPick(h, s, hiders[k] as ReturnType<typeof newHideBrain>, rng)));
  startSeek(h);
  let steps = 0;
  while (!isOver(h) && steps++ < 10_000) {
    const a = cpuSeek(h, seeker, rng, DT);
    pointTo(h, a.x, a.y);
    if (a.fire) press(h);
    [1, 2, 3].forEach((s, k) => {
      const to = cpuSneak(h, s, hiders[k] as ReturnType<typeof newHideBrain>, rng);
      if (to !== null) sneak(h, s, to);
    });
    stepHouse(h, DT);
  }
  return h;
}

describe('hide and sleep', () => {
  it('has six spots in two rows of three, far enough apart that the torch is only ever on one', () => {
    expect(SPOTS.map((s) => s.label)).toEqual(['Under the bed', 'In the wardrobe', 'Behind the curtain', 'In the laundry basket', 'Under the blankets', 'Behind the couch']);
    for (const a of SPOTS) for (const b of SPOTS) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(HIDE.onR * 2);
  });

  it('lets hiders change their mind while the seeker counts, and not after', () => {
    const h = newHouse(0, [1, 2, 3], createRng(3));
    expect(pickSpot(h, 1, 4)).toBe(true);
    expect(pickSpot(h, 1, 2)).toBe(true);
    expect(pickSpot(h, 0, 2)).toBe(false); // the seeker doesn't hide
    startSeek(h);
    expect(pickSpot(h, 1, 3)).toBe(false);
    expect(hiderOf(h, 1)?.spot).toBe(2);
  });

  it('searches the spot under the torch: the torch stays there a moment, then whoever hides there is found', () => {
    const h = house();
    pointTo(h, 0.05, 0.05); // between spots
    for (let i = 0; i < 30; i++) stepHouse(h, DT);
    expect(press(h)).toBe(-1);
    shine(h, 1);
    expect(litSpot(h)).toBe(1);
    expect(press(h)).toBe(1);
    expect(press(h)).toBeNull(); // busy searching
    pointTo(h, 0.6, -0.42); // the torch stays put while searching
    let found: number[] = [];
    for (let i = 0; i < HIDE.search * 60 + 2; i++) found = stepHouse(h, DT).searched?.found ?? found;
    expect(found).toEqual([2]);
    expect(hiderOf(h, 2)?.caught).toBe(true);
    expect(press(h)).toBeNull(); // catching their breath
    for (let i = 0; i < HIDE.recover * 60 + 2; i++) stepHouse(h, DT);
    expect(litSpot(h)).toBe(5);
    expect(press(h)).toBe(5);
  });

  it('lets each hider sneak once, never while the torch is on them, and the rustle gives away the side', () => {
    const h = house();
    shine(h, 0);
    expect(sneak(h, 1, 2)).toBe('lit');
    // The torch only just got there: a press already on its way from the phone still counts.
    shine(h, 4);
    pointTo(h, SPOTS[0]?.x ?? 0, SPOTS[0]?.y ?? 0);
    for (let i = 0; i < 20 && litSpot(h) !== 0; i++) stepHouse(h, DT);
    expect(litSpot(h)).toBe(0);
    expect(sneak(h, 1, 2, 0.1)).toBe('ok');
    expect(hiderOf(h, 1)?.spot).toBe(2);
    expect(h.log.at(-1)).toMatchObject({ kind: 'rustle', spot: 0 });
    expect(rustleColumn(0)).toBe(rustleColumn(1));
    expect(sneak(h, 1, 3)).toBe('used');
    expect(sneak(h, 3, 5)).toBe('same');
    expect(sneak(h, 3, 3)).toBe('ok');
  });

  it('ends early when everyone is found (the seeker wins), otherwise the hiders win at the whistle', () => {
    const h = house();
    for (const spot of [0, 1, 5]) {
      shine(h, spot);
      for (let i = 0; i < 60 && press(h) === null; i++) stepHouse(h, DT);
      for (let i = 0; i < HIDE.search * 60 + 2; i++) stepHouse(h, DT);
    }
    expect(hiddenCount(h)).toBe(0);
    expect(isOver(h)).toBe(true);
    expect(h.time).toBeLessThan(HIDE.seekTime);
    expect(hideScores(h, 4)).toEqual([1, 0, 0, 0]);

    const g = house();
    for (let i = 0; i < HIDE.seekTime * 60 + 5; i++) stepHouse(g, DT);
    expect(isOver(g)).toBe(true);
    expect(hideScores(g, 4)).toEqual([0, 1, 1, 1]);
  });

  it('plays out with computer players: a contest at equal skill, and a sharp seeker finds more', () => {
    const N = 120;
    const seekerRate = (s: number, hd: number) => {
      let wins = 0;
      for (let seed = 1; seed <= N; seed++) {
        const h = play(seed, s, hd);
        expect(isOver(h)).toBe(true);
        if (hiddenCount(h) === 0) wins++;
      }
      return wins / N;
    };
    const even = seekerRate(0.575, 0.575);
    expect(even).toBeGreaterThan(0.25);
    expect(even).toBeLessThan(0.8);
    expect(seekerRate(0.8, 0.5)).toBeGreaterThan(seekerRate(0.35, 0.5) + 0.1);
    expect(seekerRate(0, 1)).toBeLessThan(seekerRate(1, 0) - 0.3);
  });
});
