import { describe, expect, it } from 'vitest';
import { NAP, type NapBrain, type Room, IDLE, cpuNap, isOver, napScores, newNapBrain, newRoom, nextRound, placeBags, startRound, stepRoom } from '../src/game/minigames/napspot';
import { createRng } from '../src/game/rng';

const DT = 1 / 120;

/** Runs the music out so the room is in its scramble. */
function stopMusic(room: Room): void {
  room.time = room.musicFor;
  stepRoom(room, [], DT);
}

/** Plays a whole game of computer players; returns the seats in the order they went for a nap and the room. */
function playGame(skills: number[], seed: number): { room: Room; rounds: number; seconds: number } {
  const rng = createRng(seed);
  const room = newRoom(skills.length, rng);
  const brains: NapBrain[] = skills.map((s) => newNapBrain(s));
  let rounds = 0;
  let seconds = 0;
  while (!isOver(room) && seconds < 200) {
    const sticks = skills.map((_, i) => cpuNap(room, i, brains[i] as NapBrain, rng, DT));
    const ev = stepRoom(room, sticks, DT);
    seconds += DT;
    if (ev.out !== null) {
      rounds++;
      nextRound(room, rng);
    }
  }
  return { room, rounds, seconds };
}

describe('nap spot', () => {
  it('puts out one beanbag fewer than people still awake, on the floor and apart', () => {
    for (let seed = 1; seed < 40; seed++) {
      for (let k = 1; k <= 3; k++) {
        const bags = placeBags(createRng(seed * 5 + k), k);
        expect(bags).toHaveLength(k);
        for (const b of bags) {
          expect(Math.abs(b.x)).toBeLessThan(NAP.bounds.x - NAP.bagR);
          expect(Math.abs(b.z)).toBeLessThan(NAP.bounds.z - NAP.bagR);
        }
        for (let i = 0; i < bags.length; i++) {
          for (let j = i + 1; j < bags.length; j++) {
            const a = bags[i];
            const b = bags[j];
            if (a && b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(NAP.bagR * 2 + NAP.bodyR * 2);
          }
        }
      }
    }
    expect(newRoom(4, createRng(1)).bags).toHaveLength(3);
    expect(newRoom(2, createRng(1)).bags).toHaveLength(1);
  });

  it('walks with the stick (up on the phone is away from the TV) and stays on the floor', () => {
    const room = newRoom(2, createRng(3));
    room.bags = [];
    const n = room.nappers[0];
    if (!n) throw new Error('no napper');
    n.x = 0;
    n.z = 0;
    for (let i = 0; i < 60; i++) stepRoom(room, [{ x: 0, y: 1 }], DT);
    expect(n.z).toBeLessThan(-0.5);
    for (let i = 0; i < 600; i++) stepRoom(room, [{ x: 1, y: 0 }], DT);
    expect(n.x).toBe(NAP.bounds.x);
  });

  it("doesn't let anyone sit while the music plays", () => {
    const room = newRoom(2, createRng(4));
    const n = room.nappers[0];
    const b = room.bags[0];
    if (!n || !b) throw new Error('setup');
    n.x = b.x - 1.5;
    n.z = b.z;
    for (let i = 0; i < 60; i++) stepRoom(room, [{ x: 1, y: 0 }], DT);
    expect(n.bag).toBeNull();
    expect(Math.hypot(n.x - b.x, n.z - b.z)).toBeGreaterThanOrEqual(NAP.bagR + NAP.bodyR - 1e-6);
  });

  it('dives onto a free beanbag once the music stops, and bounces off a taken one', () => {
    const room = newRoom(3, createRng(5));
    room.musicFor = 99;
    const [a, b] = room.nappers;
    const [bag0] = room.bags;
    if (!a || !b || !bag0) throw new Error('setup');
    a.x = bag0.x - 1.3;
    a.z = bag0.z;
    b.x = bag0.x + 1.3;
    b.z = bag0.z;
    room.nappers[2]!.x = 5;
    room.nappers[2]!.z = 3;
    stopMusic(room);
    let dived = false;
    for (let i = 0; i < 60 && !dived; i++) dived = stepRoom(room, [{ x: 1, y: 0 }, IDLE, IDLE], DT).dives.length > 0;
    expect(a.bag).toBe(0);
    expect(bag0.by).toBe(0);
    let bounced = false;
    for (let i = 0; i < 60 && !bounced; i++) bounced = stepRoom(room, [IDLE, { x: -1, y: 0 }, IDLE], DT).bounced.includes(1);
    expect(bounced).toBe(true);
    expect(b.bag).toBeNull();
    expect(b.kx).toBeGreaterThan(0);
  });

  it('gives a contested beanbag to the earlier dive once phone lag is taken off', () => {
    const room = newRoom(3, createRng(6));
    room.musicFor = 99;
    const [a, b] = room.nappers;
    const [bag0] = room.bags;
    if (!a || !b || !bag0) throw new Error('setup');
    a.x = bag0.x - (NAP.bagR + NAP.bodyR + 0.05);
    a.z = bag0.z;
    b.x = bag0.x + (NAP.bagR + NAP.bodyR + 0.12);
    b.z = bag0.z;
    room.nappers[2]!.x = 5;
    room.nappers[2]!.z = 3;
    stopMusic(room);
    // a touches first, but b's phone is slower: b really dived first.
    const lags = [0, 0.12, 0];
    for (let i = 0; i < 40; i++) stepRoom(room, [{ x: 1, y: 0 }, { x: -1, y: 0 }, IDLE], DT, lags);
    expect(bag0.by).toBe(1);
    expect(a.bag).toBeNull();
  });

  it('nudges away anyone standing still next to a beanbag for 2 s while the music plays', () => {
    const room = newRoom(2, createRng(7));
    room.musicFor = 99;
    const n = room.nappers[0];
    const bag = room.bags[0];
    if (!n || !bag) throw new Error('setup');
    n.x = bag.x + NAP.bagR + NAP.bodyR + 0.3;
    n.z = bag.z;
    n.ax = n.x;
    n.az = n.z;
    room.nappers[1]!.x = -5;
    let comfyAt = -1;
    let drowsy = false;
    for (let i = 0; i < 400 && comfyAt < 0; i++) {
      const ev = stepRoom(room, [IDLE, IDLE], DT);
      drowsy ||= ev.drowsy.includes(0);
      if (ev.comfy.includes(0)) comfyAt = i * DT;
    }
    expect(drowsy).toBe(true);
    expect(comfyAt).toBeGreaterThan(NAP.comfy - 0.05);
    expect(comfyAt).toBeLessThan(NAP.comfy + 0.05);
    expect(n.kx).toBeGreaterThan(0);
    expect(n.nudges).toBe(1);
  });

  it("doesn't mind someone standing still far from the beanbags", () => {
    const room = newRoom(2, createRng(8));
    room.musicFor = 99;
    const n = room.nappers[0];
    if (!n) throw new Error('setup');
    n.x = NAP.bounds.x;
    n.z = NAP.bounds.z;
    for (let i = 0; i < 600; i++) expect(stepRoom(room, [IDLE, IDLE], DT).comfy).toEqual([]);
  });

  it('sends exactly one person for a nap each round, even if nobody moves', () => {
    const room = newRoom(4, createRng(9));
    stopMusic(room);
    let out: number | null = null;
    for (let i = 0; i < (NAP.scramble + 1) / DT && out === null; i++) out = stepRoom(room, [], DT).out;
    expect(out).not.toBeNull();
    expect(room.bags.every((b) => b.by !== null)).toBe(true);
    expect(room.nappers.filter((n) => n.out)).toHaveLength(1);
    nextRound(room, createRng(10));
    expect(room.bags).toHaveLength(2);
    expect(room.phase).toBe('music');
  });

  it('ranks by when people went for a nap', () => {
    const room = newRoom(4, createRng(11));
    room.order = [2, 0, 3];
    for (const i of room.order) room.nappers[i]!.out = true;
    expect(napScores(room)).toEqual([1, 3, 0, 2]);
  });

  it('plays out whole games of computer players with 2 to 4 people', () => {
    for (let players = 2; players <= 4; players++) {
      for (let seed = 1; seed <= 12; seed++) {
        const { room, rounds, seconds } = playGame(Array.from({ length: players }, (_, i) => i / Math.max(1, players - 1)), seed * 31 + players);
        expect(isOver(room)).toBe(true);
        expect(rounds).toBe(players - 1);
        expect(new Set(room.order).size).toBe(players - 1);
        expect(new Set(napScores(room)).size).toBe(players);
        expect(seconds).toBeLessThan(45);
      }
    }
  });

  it('has sharp computer players outlast sleepy ones more often than not', () => {
    let sharpWins = 0;
    let sleepyWins = 0;
    let sharpPlace = 0;
    let sleepyPlace = 0;
    const games = 60;
    for (let seed = 1; seed <= games; seed++) {
      // Seats rotate so nobody gets the same start spot every time.
      const skills = [1, 0.5, 0.5, 0];
      const shift = seed % 4;
      const order = skills.map((_, i) => skills[(i + shift) % 4] as number);
      const { room } = playGame(order, seed * 7);
      const scores = napScores(room);
      const sharp = order.indexOf(1);
      const sleepy = order.indexOf(0);
      if (scores[sharp] === 3) sharpWins++;
      if (scores[sleepy] === 3) sleepyWins++;
      sharpPlace += scores[sharp] as number;
      sleepyPlace += scores[sleepy] as number;
    }
    expect(sharpWins).toBeGreaterThan(sleepyWins);
    expect(sharpPlace).toBeGreaterThan(sleepyPlace * 1.3);
    // ...but a sleepy one isn't hopeless.
    expect(sleepyPlace).toBeGreaterThan(games * 0.25);
  });

  it('keeps a round going when restarted with people sitting where new beanbags land', () => {
    const rng = createRng(12);
    const room = newRoom(3, rng);
    stopMusic(room);
    for (let i = 0; i < (NAP.scramble + 1) / DT && room.phase !== 'done'; i++) stepRoom(room, [], DT);
    nextRound(room, rng);
    for (const n of room.nappers) {
      if (n.out) continue;
      for (const b of room.bags) expect(Math.hypot(n.x - b.x, n.z - b.z)).toBeGreaterThanOrEqual(NAP.bagR + NAP.bodyR);
    }
    startRound(room, rng);
    expect(room.phase).toBe('music');
  });
});

