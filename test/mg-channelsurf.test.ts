import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  SURF,
  type Surf,
  boredTarget,
  canSwitch,
  cpuCouch,
  cpuRemote,
  isOver,
  isStatic,
  newCouchBrain,
  newRemoteBrain,
  newSurf,
  react,
  remoteWins,
  stepSurf,
  surfScores,
  switchChannel,
} from '../src/game/minigames/channelsurf';
import { createRng } from '../src/game/rng';

const DT = 1 / 120;

function wait(s: Surf, seconds: number) {
  const slow = [];
  for (let t = 0; t < seconds - 1e-9; t += DT) slow.push(...stepSurf(s, DT));
  return slow;
}

/** A fresh room of three that is ready for a switch, on channel 0. */
function ready(): Surf {
  const s = newSurf(3, createRng(1));
  s.channel = 0;
  wait(s, SURF.minGap + 0.01);
  return s;
}

function game(seed: number, remoteSkill: number, couchSkill: number[]): Surf {
  const rng = createRng(seed);
  const s = newSurf(couchSkill.length, rng);
  const remote = newRemoteBrain(remoteSkill, rng);
  const couch = couchSkill.map((k) => newCouchBrain(k));
  let steps = 0;
  while (!isOver(s) && steps++ < 10_000) {
    cpuRemote(s, remote, rng);
    couch.forEach((b, m) => {
      const c = cpuCouch(s, b, rng);
      if (c !== null) react(s, m, c);
    });
    stepSurf(s, 1 / 60);
  }
  return s;
}

describe('channel surf', () => {
  it('has a reaction for each of the four channels', () => {
    expect(CHANNELS.map((c) => c.name)).toEqual(['Cooking', 'Nature', 'Workout', 'Cartoons']);
    expect(CHANNELS.map((c) => c.reaction)).toEqual(['Yum!', 'Aww', 'Stretch!', 'Ha!']);
  });

  it('fuzzes into static when the remote is pressed too soon, and ignores it until the picture is back', () => {
    const s = newSurf(3, createRng(2));
    const before = s.channel;
    wait(s, 0.5);
    expect(canSwitch(s)).toBe(false);
    expect(switchChannel(s, (before + 1) % 4)).toBe('static');
    expect(isStatic(s)).toBe(true);
    expect(s.channel).toBe(before);
    wait(s, 0.6);
    expect(switchChannel(s, (before + 2) % 4)).toBe('ignored');
    wait(s, SURF.static);
    expect(isStatic(s)).toBe(false);
    expect(canSwitch(s)).toBe(true);
    expect(switchChannel(s, (before + 1) % 4)).toBe('switched');
    expect(s.channel).toBe((before + 1) % 4);
    expect(s.statics).toBe(1);
  });

  it('does nothing when the remote picks the channel that is already on', () => {
    const s = ready();
    expect(switchChannel(s, 0)).toBe('same');
    expect(s.switches).toBe(0);
    expect(switchChannel(s, 2)).toBe('switched');
  });

  it('judges the first reaction to a new channel, right or wrong', () => {
    const s = ready();
    expect(react(s, 0, 0)).toBeNull(); // nothing new on yet
    switchChannel(s, 1);
    wait(s, 0.5);
    expect(react(s, 0, 1)).toEqual({ verdict: 'right', channel: 1 });
    expect(react(s, 0, 2)).toBeNull(); // already reacted
    expect(react(s, 1, 3)).toEqual({ verdict: 'wrong', channel: 1 });
    expect(s.bored).toBe(1);
    expect(s.boredBy).toEqual([0, 1, 0]);
    expect(s.right).toEqual([1, 0, 0]);
  });

  it('calls anyone who has not reacted after 1.5 s slow, waiting a moment for presses still on their way', () => {
    const s = ready();
    switchChannel(s, 3);
    react(s, 0, 3);
    expect(wait(s, SURF.window + 0.05)).toEqual([]);
    // Pressed just in time on the phone, arriving a little after the window shut.
    expect(react(s, 1, 3, s.time - 0.1)).toEqual({ verdict: 'right', channel: 3 });
    const slow = wait(s, SURF.grace + 0.05);
    expect(slow).toEqual([{ member: 2, channel: 3 }]);
    expect(s.bored).toBe(1);
    expect(react(s, 2, 3)).toBeNull();
  });

  it('lets slow ones off when the channel changes again early, but a late reaction to the old one is wrong', () => {
    const s = ready();
    switchChannel(s, 1);
    react(s, 0, 1);
    wait(s, SURF.minGap + 0.01);
    expect(switchChannel(s, 2)).toBe('switched');
    // A press made before the switch, arriving after it, still counts for the old channel.
    expect(react(s, 1, 1, s.time - 0.05)).toEqual({ verdict: 'right', channel: 1 });
    wait(s, 0.3);
    expect(react(s, 2, 1)).toEqual({ verdict: 'wrong', channel: 2 });
    const slow = wait(s, SURF.window + SURF.grace);
    // Member 2 already reacted to channel 2 (wrongly); 0 and 1 never did, so they're slow on channel 2 only.
    expect(slow.map((e) => e.member).sort()).toEqual([0, 1]);
    expect(s.bored).toBe(3);
  });

  it('lets everyone off when static interrupts a window', () => {
    const s = ready();
    switchChannel(s, 1);
    wait(s, 0.4);
    expect(switchChannel(s, 2)).toBe('static');
    wait(s, 0.1);
    expect(react(s, 0, 1)).toBeNull();
    expect(wait(s, 3)).toEqual([]);
    expect(s.bored).toBe(0);
  });

  it('gives the remote the win at six bored points', () => {
    const s = ready();
    for (let round = 0; round < 2; round++) {
      switchChannel(s, round % 2 === 0 ? 1 : 2);
      wait(s, SURF.window + SURF.grace + 0.02);
    }
    expect(s.bored).toBe(6);
    expect(remoteWins(s)).toBe(true);
    expect(isOver(s)).toBe(true);
    expect(switchChannel(s, 3)).toBe('ignored');
    expect(surfScores(s, 4, 2, [0, 1, 3])).toEqual([0, 0, 1, 0]);
  });

  it('gives the couch the win when they keep up until the time runs out', () => {
    const s = ready();
    let ch = 0;
    while (!isOver(s)) {
      if (canSwitch(s)) {
        ch = (ch + 1) % 4;
        switchChannel(s, ch);
        for (let m = 0; m < 3; m++) react(s, m, ch);
      }
      stepSurf(s, DT);
    }
    expect(s.time).toBe(SURF.duration);
    expect(s.bored).toBe(0);
    expect(s.switches).toBeGreaterThan(20);
    expect(remoteWins(s)).toBe(false);
    expect(surfScores(s, 4, 0, [1, 2, 3])).toEqual([0, 1, 1, 1]);
  });

  it('lets everyone off a window still running at the final whistle', () => {
    const s = ready();
    wait(s, SURF.duration - s.time - 0.5);
    switchChannel(s, 2);
    expect(wait(s, 1)).toEqual([]);
    expect(isOver(s)).toBe(true);
    expect(s.bored).toBe(0);
  });

  it('needs fewer bored points against a smaller couch', () => {
    expect(boredTarget(3)).toBe(6);
    expect(boredTarget(2)).toBe(4);
    expect(boredTarget(1)).toBe(2);
    const s = newSurf(1, createRng(3));
    s.channel = 0;
    wait(s, SURF.minGap);
    switchChannel(s, 1);
    expect(react(s, 0, 2)?.verdict).toBe('wrong');
    wait(s, SURF.minGap);
    switchChannel(s, 3);
    wait(s, SURF.window + SURF.grace + 0.02);
    expect(remoteWins(s)).toBe(true);
    expect(surfScores(s, 2, 1, [0])).toEqual([0, 1]);
  });

  it('plays out between computer players, close at average skill, and sharpness matters on both sides', () => {
    const N = 200;
    const rate = (remote: number, couch: number) => {
      let wins = 0;
      for (let seed = 1; seed <= N; seed++) {
        const s = game(seed * 7919, remote, [couch, couch, couch]);
        expect(isOver(s)).toBe(true);
        if (remoteWins(s)) wins++;
      }
      return wins / N;
    };
    const even = rate(0.575, 0.575);
    expect(even).toBeGreaterThan(0.3);
    expect(even).toBeLessThan(0.7);
    expect(rate(0.8, 0.575)).toBeGreaterThan(rate(0.35, 0.575) + 0.08);
    expect(rate(0.575, 0.35)).toBeGreaterThan(rate(0.575, 0.8) + 0.3);
    // Wide awake against sleepy, either way round, is a clear win.
    expect(rate(1, 0)).toBeGreaterThan(0.9);
    expect(rate(0, 1)).toBeLessThan(0.1);
  });

  it('has sleepy remotes hit static now and then, and sharp ones hardly ever', () => {
    let sleepy = 0;
    let sharp = 0;
    for (let seed = 1; seed <= 60; seed++) {
      sleepy += game(seed, 0.1, [1, 1, 1]).statics;
      sharp += game(seed, 1, [1, 1, 1]).statics;
    }
    expect(sleepy).toBeGreaterThan(20);
    expect(sharp).toBe(0);
  });
});
