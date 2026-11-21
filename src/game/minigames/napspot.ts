// Nap Spot: musical beanbags in the living room, late at night. While the lo-fi plays everyone wanders about;
// when the record scratches and the music stops, dive onto a beanbag. There's one beanbag fewer than people,
// and whoever is left standing goes for a nap on the rug. Repeat until one is left.
//
// Everything happens on the floor, in its x/z plane: +z points at the TV audience, and a stick's y (up on the
// phone) runs away from the audience, toward -z.
//  - While the music plays the beanbags are just in the way: you can't sit yet.
//  - Standing still next to a beanbag for 2 s makes you "too comfy": you get nudged away. Keep wandering.
//  - After the music stops, touching a free beanbag dives onto it; a taken one bounces you off.
//  - Two dives at nearly the same moment go to the earlier one, with half each phone's round trip taken off.
import type { Rng } from '../rng.js';

export const NAP = {
  bounds: { x: 5.2, z: 3.0 }, // half-size of the floor people can wander on
  bodyR: 0.36,
  bagR: 0.62,
  touch: 0.12, // reach beyond merely touching a beanbag that still counts as diving on
  speed: 4.2, // units a second at full stick
  response: 10, // how quickly walking follows the stick
  deadzone: 0.15,
  ring: 2.0, // beanbags sit roughly on an ellipse this far out (wider than deep)
  music: [4.5, 8.5] as const, // seconds of music in a round
  firstExtra: 1.5, // the first song is longer (and longer still with fewer people)
  scramble: 5, // after the music stops: seconds before the last free beanbags go to whoever is closest
  claimWindow: 0.1, // seconds a dive waits for an earlier (lag-compensated) one on the same beanbag
  maxLag: 0.15, // the most round-trip compensation a phone gets, in seconds
  comfy: 2, // seconds standing still next to a beanbag before you're too comfy
  comfyNear: 1.0, // "next to": within this distance of a beanbag's edge
  roam: 0.7, // moving less than this far from where you stopped still counts as standing still
  nudge: 6.5, // speed a too-comfy nudge sends you off at
  bounce: 7, // speed a taken beanbag bounces you off at
  friction: 14, // how quickly a nudge or bounce slows down (units a second, a second)
  stun: 0.35, // seconds without control after a bounce or a nudge
} as const;

export interface Stick {
  x: number;
  y: number;
}

export const IDLE: Stick = { x: 0, y: 0 };

export interface Napper {
  x: number;
  z: number;
  /** Walking velocity. */
  vx: number;
  vz: number;
  /** Sliding velocity from a bounce or a nudge. */
  kx: number;
  kz: number;
  stun: number;
  /** Where they last stopped, and how long they've stayed around it next to a beanbag. */
  ax: number;
  az: number;
  still: number;
  /** The beanbag they're on this round. */
  bag: number | null;
  out: boolean;
  /** Heading in the x/z plane (0 faces +z, the audience). */
  face: number;
  nudges: number;
  bounces: number;
}

interface Claim {
  seat: number;
  /** When they touched it, with half the phone's round trip taken off. */
  at: number;
  /** When the dive is settled. */
  settle: number;
}

export interface Bag {
  x: number;
  z: number;
  by: number | null;
  claim: Claim | null;
}

export type Phase = 'music' | 'scramble' | 'done';

export interface Room {
  nappers: Napper[];
  bags: Bag[];
  round: number;
  phase: Phase;
  /** Seconds into the current phase. */
  time: number;
  /** How long the music plays this round. */
  musicFor: number;
  /** Seats in the order they went for a nap. */
  order: number[];
}

export interface NapEvents {
  /** The music stopped this step. */
  stopped: boolean;
  dives: { seat: number; bag: number }[];
  bounced: number[];
  /** Halfway to too comfy (a warning). */
  drowsy: number[];
  /** Too comfy: nudged away from a beanbag. */
  comfy: number[];
  /** Left standing: out this round. */
  out: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function napper(x: number, z: number): Napper {
  return { x, z, vx: 0, vz: 0, kx: 0, kz: 0, stun: 0, ax: x, az: z, still: 0, bag: null, out: false, face: 0, nudges: 0, bounces: 0 };
}

export function aliveSeats(room: Room): number[] {
  return room.nappers.map((n, i) => (n.out ? -1 : i)).filter((i) => i >= 0);
}

export function isOver(room: Room): boolean {
  return aliveSeats(room).length <= 1;
}

/** Seconds of music for a round: a little random, the first song longer (longer still in small groups). */
export function musicLength(rng: Rng, round: number, players: number): number {
  const base = NAP.music[0] + rng() * (NAP.music[1] - NAP.music[0]);
  return round === 0 ? base + NAP.firstExtra + Math.max(0, 4 - players) * 1.5 : base;
}

/** `count` beanbags loosely on an ellipse round the middle of the floor (a single one near the middle). */
export function placeBags(rng: Rng, count: number): Bag[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: (rng() - 0.5) * 1.6, z: (rng() - 0.5) * 0.8, by: null, claim: null }];
  const a0 = rng() * Math.PI * 2;
  const bags: Bag[] = [];
  for (let j = 0; j < count; j++) {
    const a = a0 + (j / count) * Math.PI * 2 + (rng() - 0.5) * (1.2 / count);
    const r = NAP.ring * (0.85 + rng() * 0.3);
    bags.push({ x: Math.cos(a) * r * 1.55, z: Math.sin(a) * r * 0.85, by: null, claim: null });
  }
  return bags;
}

export function newRoom(players: number, rng: Rng): Room {
  const nappers = Array.from({ length: players }, (_, i) => {
    const a = (i / players) * Math.PI * 2 + Math.PI / 4;
    return napper(Math.cos(a) * 3.8, Math.sin(a) * 2.2);
  });
  const room: Room = { nappers, bags: [], round: 0, phase: 'done', time: 0, musicFor: 0, order: [] };
  startRound(room, rng);
  return room;
}

/** Sets up a round: fresh beanbags (one fewer than people still awake), everyone up and the music on. */
export function startRound(room: Room, rng: Rng): void {
  const alive = aliveSeats(room);
  room.bags = placeBags(rng, alive.length - 1);
  room.phase = 'music';
  room.time = 0;
  room.musicFor = musicLength(rng, room.round, room.nappers.length);
  for (const i of alive) {
    const n = room.nappers[i] as Napper;
    n.bag = null;
    n.vx = n.vz = n.kx = n.kz = 0;
    n.stun = 0;
    n.still = 0;
    // Step off wherever the new beanbags landed.
    for (const b of room.bags) {
      const dx = n.x - b.x;
      const dz = n.z - b.z;
      const d = Math.hypot(dx, dz);
      const min = NAP.bagR + NAP.bodyR + 0.05;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 0;
      const nz = d > 1e-6 ? dz / d : 1;
      n.x = clamp(b.x + nx * min, -NAP.bounds.x, NAP.bounds.x);
      n.z = clamp(b.z + nz * min, -NAP.bounds.z, NAP.bounds.z);
    }
    n.ax = n.x;
    n.az = n.z;
  }
}

/** After someone went for a nap: the next round, if there are still two or more awake. */
export function nextRound(room: Room, rng: Rng): void {
  if (isOver(room)) return;
  room.round += 1;
  startRound(room, rng);
}

function claimOf(room: Room, seat: number): number {
  return room.bags.findIndex((b) => b.claim?.seat === seat);
}

/** Pushes a napper out of a beanbag to its edge. */
function pushOut(n: Napper, b: Bag, extra = 0): { nx: number; nz: number } {
  const dx = n.x - b.x;
  const dz = n.z - b.z;
  const d = Math.hypot(dx, dz);
  const nx = d > 1e-6 ? dx / d : 0;
  const nz = d > 1e-6 ? dz / d : 1;
  const min = NAP.bagR + NAP.bodyR + extra;
  if (d < min) {
    n.x = b.x + nx * min;
    n.z = b.z + nz * min;
  }
  return { nx, nz };
}

function knock(n: Napper, nx: number, nz: number, speed: number): void {
  n.kx = nx * speed;
  n.kz = nz * speed;
  n.vx = n.vz = 0;
  n.stun = NAP.stun;
}

function bounceOff(n: Napper, b: Bag): void {
  const { nx, nz } = pushOut(n, b, 0.02);
  knock(n, nx, nz, NAP.bounce);
  n.bounces += 1;
}

function seat(room: Room, i: number, bagIndex: number): void {
  const n = room.nappers[i] as Napper;
  const b = room.bags[bagIndex] as Bag;
  b.by = i;
  b.claim = null;
  n.bag = bagIndex;
  n.x = b.x;
  n.z = b.z;
  n.vx = n.vz = n.kx = n.kz = 0;
}

/** Advances the room by dt. `lags`: each seat's phone delay in seconds (half its round trip). */
export function stepRoom(room: Room, sticks: readonly Stick[], dt: number, lags: readonly number[] = []): NapEvents {
  const ev: NapEvents = { stopped: false, dives: [], bounced: [], drowsy: [], comfy: [], out: null };
  if (room.phase === 'done') return ev;
  if (isOver(room)) {
    room.phase = 'done';
    return ev;
  }
  room.time += dt;
  if (room.phase === 'music' && room.time >= room.musicFor) {
    room.phase = 'scramble';
    room.time = 0;
    ev.stopped = true;
  }
  const music = room.phase === 'music';
  const standing = aliveSeats(room).filter((i) => (room.nappers[i] as Napper).bag === null);

  // Walking (or sliding).
  for (const i of standing) {
    const n = room.nappers[i] as Napper;
    n.stun = Math.max(0, n.stun - dt);
    const s = sticks[i] ?? IDLE;
    const mag = Math.hypot(s.x, s.y);
    const k = mag < NAP.deadzone || n.stun > 0 ? 0 : Math.min(1, mag) / mag;
    const holding = claimOf(room, i) >= 0;
    const wantX = holding ? 0 : s.x * k * NAP.speed;
    const wantZ = holding ? 0 : -s.y * k * NAP.speed;
    const follow = 1 - Math.exp(-NAP.response * dt);
    n.vx += (wantX - n.vx) * follow;
    n.vz += (wantZ - n.vz) * follow;
    const kl = Math.hypot(n.kx, n.kz);
    if (kl > 0) {
      const left = Math.max(0, kl - NAP.friction * dt);
      n.kx *= left / kl;
      n.kz *= left / kl;
    }
    n.x += (n.vx + n.kx) * dt;
    n.z += (n.vz + n.kz) * dt;
    if (Math.abs(n.x) > NAP.bounds.x) {
      n.x = clamp(n.x, -NAP.bounds.x, NAP.bounds.x);
      n.kx = 0;
    }
    if (Math.abs(n.z) > NAP.bounds.z) {
      n.z = clamp(n.z, -NAP.bounds.z, NAP.bounds.z);
      n.kz = 0;
    }
    if (Math.hypot(n.vx, n.vz) > 0.3) n.face = Math.atan2(n.vx, n.vz);
  }

  // Beanbags: in the way while the music plays; something to dive on once it stops.
  room.bags.forEach((b, bi) => {
    for (const i of standing) {
      const n = room.nappers[i] as Napper;
      const d = Math.hypot(n.x - b.x, n.z - b.z);
      const contact = NAP.bagR + NAP.bodyR;
      if (d >= contact + (music ? 0 : NAP.touch)) continue;
      if (music) {
        pushOut(n, b);
        continue;
      }
      const mine = claimOf(room, i);
      if (b.by !== null) {
        bounceOff(n, b);
        ev.bounced.push(i);
      } else if (mine >= 0 && mine !== bi) {
        pushOut(n, b); // already diving onto another one
      } else if (b.claim === null) {
        b.claim = { seat: i, at: room.time - clamp(lags[i] ?? 0, 0, NAP.maxLag), settle: room.time + NAP.claimWindow };
        pushOut(n, b);
      } else if (b.claim.seat !== i) {
        const at = room.time - clamp(lags[i] ?? 0, 0, NAP.maxLag);
        if (at < b.claim.at) {
          // They really got there first: the earlier dive wins, the other bounces off.
          const loser = room.nappers[b.claim.seat] as Napper;
          b.claim = { seat: i, at, settle: b.claim.settle };
          bounceOff(loser, b);
          ev.bounced.push(room.nappers.indexOf(loser));
          pushOut(n, b);
        } else {
          bounceOff(n, b);
          ev.bounced.push(i);
        }
      } else {
        pushOut(n, b);
      }
    }
  });

  // Dives that waited out the claim window land.
  room.bags.forEach((b, bi) => {
    if (b.claim && room.time >= b.claim.settle) {
      const who = b.claim.seat;
      seat(room, who, bi);
      ev.dives.push({ seat: who, bag: bi });
    }
  });

  // People standing about don't walk through each other (someone mid-dive doesn't budge).
  const up = aliveSeats(room).filter((i) => (room.nappers[i] as Napper).bag === null);
  for (let a = 0; a < up.length; a++) {
    for (let c = a + 1; c < up.length; c++) {
      const p = room.nappers[up[a] as number] as Napper;
      const q = room.nappers[up[c] as number] as Napper;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = NAP.bodyR * 2;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const pFixed = claimOf(room, up[a] as number) >= 0;
      const qFixed = claimOf(room, up[c] as number) >= 0;
      if (pFixed && qFixed) continue;
      const share = pFixed ? 1 : qFixed ? 0 : 0.5;
      const overlap = min - d;
      p.x -= nx * overlap * (1 - share);
      p.z -= nz * overlap * (1 - share);
      q.x += nx * overlap * share;
      q.z += nz * overlap * share;
    }
  }

  // Too comfy: hanging about next to a beanbag while the music plays.
  if (music) {
    for (const i of up) {
      const n = room.nappers[i] as Napper;
      if (Math.hypot(n.x - n.ax, n.z - n.az) > NAP.roam) {
        n.ax = n.x;
        n.az = n.z;
        n.still = 0;
        continue;
      }
      let nearest: Bag | null = null;
      let gap = Infinity;
      for (const b of room.bags) {
        const g = Math.hypot(n.x - b.x, n.z - b.z) - NAP.bagR - NAP.bodyR;
        if (g < gap) {
          gap = g;
          nearest = b;
        }
      }
      if (!nearest || gap > NAP.comfyNear) {
        n.still = 0;
        continue;
      }
      const before = n.still;
      n.still += dt;
      if (before < NAP.comfy / 2 && n.still >= NAP.comfy / 2) ev.drowsy.push(i);
      if (n.still >= NAP.comfy) {
        const { nx, nz } = pushOut(n, nearest);
        knock(n, nx, nz, NAP.nudge);
        n.still = 0;
        n.nudges += 1;
        ev.comfy.push(i);
      }
    }
  }

  // The round ends when every beanbag is taken (or, after a while, the closest people flop onto the last ones).
  if (room.phase === 'scramble') {
    let free = room.bags.map((b, bi) => (b.by === null ? bi : -1)).filter((bi) => bi >= 0);
    if (free.length > 0 && room.time >= NAP.scramble) {
      for (const bi of free) {
        const c = (room.bags[bi] as Bag).claim;
        if (c) {
          seat(room, c.seat, bi);
          ev.dives.push({ seat: c.seat, bag: bi });
        }
      }
      free = free.filter((bi) => (room.bags[bi] as Bag).by === null);
      let left = aliveSeats(room).filter((i) => (room.nappers[i] as Napper).bag === null);
      while (free.length > 0 && left.length > 1) {
        let best: [number, number] = [left[0] as number, free[0] as number];
        let bestD = Infinity;
        for (const i of left) {
          for (const bi of free) {
            const n = room.nappers[i] as Napper;
            const b = room.bags[bi] as Bag;
            const d = Math.hypot(n.x - b.x, n.z - b.z);
            if (d < bestD) {
              bestD = d;
              best = [i, bi];
            }
          }
        }
        seat(room, best[0], best[1]);
        ev.dives.push({ seat: best[0], bag: best[1] });
        free = free.filter((bi) => bi !== best[1]);
        left = left.filter((i) => i !== best[0]);
      }
      free = [];
    }
    const left = aliveSeats(room).filter((i) => (room.nappers[i] as Napper).bag === null);
    if (free.length === 0 && left.length <= 1) {
      const loser = left[0];
      if (loser !== undefined) {
        const n = room.nappers[loser] as Napper;
        n.out = true;
        n.vx = n.vz = n.kx = n.kz = 0;
        room.order.push(loser);
        ev.out = loser;
      }
      room.phase = 'done';
    }
  }
  return ev;
}

/** Ranking by when people went for a nap: the first out scores 0, the last one awake scores most. */
export function napScores(room: Room): number[] {
  const n = room.nappers.length;
  return room.nappers.map((p, i) => (p.out ? room.order.indexOf(i) : n - 1));
}

// ------------------------------------------------------------------ computer players

export interface NapBrain {
  skill: number;
  /** Where it's strolling to while the music plays. */
  wx: number;
  wz: number;
  /** Seconds left standing about (sleepy ones dawdle). */
  dawdle: number;
  /** When it notices the music stopped (seconds into the scramble). */
  reactAt: number | null;
  target: number | null;
}

export function newNapBrain(skill: number): NapBrain {
  return { skill, wx: NaN, wz: NaN, dawdle: 0, reactAt: null, target: null };
}

function toward(n: Napper, x: number, z: number, power: number): Stick {
  const dx = x - n.x;
  const dz = z - n.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return IDLE;
  const p = power * Math.min(1, d / 0.4);
  return { x: (dx / d) * p, y: (-dz / d) * p };
}

/** A computer player's stick: strolls about during the music, then heads for a free beanbag once it notices. */
export function cpuNap(room: Room, seatIndex: number, brain: NapBrain, rng: Rng, dt: number): Stick {
  const n = room.nappers[seatIndex];
  if (!n || n.out || n.bag !== null || room.phase === 'done') return IDLE;
  const sk = brain.skill;
  if (room.phase === 'music') {
    brain.reactAt = null;
    brain.target = null;
  }
  const noticed = room.phase === 'scramble' && brain.reactAt !== null && room.time >= brain.reactAt;
  if (room.phase === 'scramble' && brain.reactAt === null) brain.reactAt = 0.12 + (1 - sk) * 0.45 + rng() * 0.2;

  if (!noticed) {
    if (brain.dawdle > 0) {
      brain.dawdle -= dt;
      return IDLE;
    }
    if (!Number.isFinite(brain.wx) || Math.hypot(brain.wx - n.x, brain.wz - n.z) < 0.4) {
      // Sharper ones stroll close round the beanbags; sleepy ones drift anywhere and sometimes just stop.
      const bag = room.bags.length ? room.bags[Math.floor(rng() * room.bags.length)] : undefined;
      if (bag && rng() < 0.35 + 0.55 * sk) {
        const a = rng() * Math.PI * 2;
        const r = NAP.bagR + NAP.bodyR + 0.45 + rng() * 0.7;
        brain.wx = clamp(bag.x + Math.cos(a) * r, -NAP.bounds.x * 0.9, NAP.bounds.x * 0.9);
        brain.wz = clamp(bag.z + Math.sin(a) * r, -NAP.bounds.z * 0.9, NAP.bounds.z * 0.9);
      } else {
        brain.wx = (rng() * 2 - 1) * NAP.bounds.x * 0.85;
        brain.wz = (rng() * 2 - 1) * NAP.bounds.z * 0.85;
      }
      if (rng() < (1 - sk) * 0.3) brain.dawdle = 0.8 + rng() * 1.8;
    }
    return toward(n, brain.wx, brain.wz, 0.5 + 0.25 * sk);
  }

  if (n.stun > 0) brain.target = null;
  const usable = (bi: number) => {
    const b = room.bags[bi];
    return !!b && b.by === null && (b.claim === null || b.claim.seat === seatIndex);
  };
  if (brain.target === null || !usable(brain.target)) {
    const free = room.bags.map((_, bi) => bi).filter(usable);
    if (free.length === 0) return IDLE;
    const others = aliveSeats(room).filter((i) => i !== seatIndex && (room.nappers[i] as Napper).bag === null);
    const cost = (bi: number) => {
      const b = room.bags[bi] as Bag;
      const mine = Math.hypot(b.x - n.x, b.z - n.z);
      // A sharp player skips a beanbag someone else is clearly closer to.
      const beaten = others.some((o) => {
        const p = room.nappers[o] as Napper;
        return Math.hypot(b.x - p.x, b.z - p.z) < mine - 0.3;
      });
      return mine + (beaten ? 2.2 * sk : 0);
    };
    brain.target = rng() < 0.2 * (1 - sk) ? (free[Math.floor(rng() * free.length)] as number) : free.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  }
  const b = room.bags[brain.target] as Bag;
  return toward(n, b.x, b.z, 0.82 + 0.18 * sk);
}
