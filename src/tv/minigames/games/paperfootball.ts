// Paper Football on the TV: the same late-night coffee table as Coaster Hockey, two phones top to top and a folded
// paper triangle. The flicker swipes on their own phone; the triangle slides across both screens (mirrored on the
// TV in 3D), and hanging its tip over the far edge is a touchdown, followed by a field goal kick through the other
// player's finger posts.
import * as THREE from 'three';
import { PHONE_L, type MatchOutcome, type Side, fromPhone, toPhone } from '../../../game/minigames/coasterhockey';
import {
  CORNER,
  type Kick,
  PAPER,
  type PaperMatch,
  type Posts,
  type Slide,
  type TouchSample,
  corners,
  cpuFlick,
  cpuKick,
  kickAt,
  launchKick,
  launchSlide,
  makePosts,
  newPaperMatch,
  nextGo,
  paperWinner,
  readFlick,
  scoreKick,
  scoreSlide,
  slideAt,
  startY,
  whoseGo,
} from '../../../game/minigames/paperfootball';
import type { SceneItem } from '../../../shared/protocol';
import { PALETTE as P, box, mix, part, pill } from '../../render/toon';
import { noise, tone } from '../kit';
import { type Minigame, everyFrame } from '../types';
import { type Pair, S, SCREEN, TableGame, fieldCircle, onDark, overlayItems } from '../table-kit';

/** The pitch: a deep, mown green in two shades. */
const PITCH = '#1f4636';
const PITCH_BAND = '#27543f';
const CHALK = SCREEN.cream;
const PAPER_WHITE = '#f6efe0';
const PAPER_EDGE = '#a89c86';
const PAPER_FOLD = '#cfc4ae';
const FALL = 0.6; // seconds a triangle takes to drop off the table on the TV

type Phase = 'aim' | 'slide' | 'kickAim' | 'kick' | 'result' | 'done';

interface Match {
  pair: Pair;
  game: PaperMatch;
  phase: Phase;
  /** Seconds in this phase. */
  t: number;
  slide: Slide | null;
  kick: Kick | null;
  posts: Posts | null;
  /** The swipe being made (field points, real seconds). */
  stroke: TouchSample[] | null;
  /** A word over both phones while it lasts. */
  note: { text: string; color: string } | null;
  /** When a computer flicker flicks (phase time), or null. */
  cpuAt: number | null;
  /** After the result: a field goal kick next (true) or the next go. */
  kickNext: boolean;
  tri: THREE.Group;
  postsMesh: THREE.Group | null;
}

// ------------------------------------------------------------------ the pieces

let wedge: THREE.BufferGeometry | null = null;

/** The folded triangle in 3D: a soft wedge of paper with a fold down the middle, tip along +x. */
function triangle(): THREE.Group {
  const g = new THREE.Group();
  const r = CORNER * S;
  wedge ??= wedgeGeometry(r);
  part(g, wedge, PAPER_WHITE, 0, 0, 0, { outline: 0.012, exact: true });
  // The folds: one down the middle to the tip, and the tucked-in flap across the back.
  part(g, box(r * 1.3, 0.006, 0.012), PAPER_FOLD, r * 0.2, 0.062, 0, { outline: false, shadow: false });
  part(g, box(0.012, 0.006, r * 0.95), PAPER_FOLD, -r * 0.22, 0.062, 0, { outline: false, shadow: false });
  part(g, box(r * 0.5, 0.005, 0.01), mix(PAPER_FOLD, P.ink, 0.12), -r * 0.05, 0.0625, r * 0.24, { ry: 0.52, outline: false, shadow: false });
  return g;
}

/** A rounded triangle (corner `r` from the middle), extruded thin and lying flat. Made once and shared. */
function wedgeGeometry(r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const pts = [0, 1, 2].map((k) => new THREE.Vector2(Math.cos((k * 2 * Math.PI) / 3) * r, Math.sin((k * 2 * Math.PI) / 3) * r));
  // Rounded corners: cut each corner with a short curve.
  const cut = 0.16;
  pts.forEach((p, k) => {
    const prev = pts[(k + 2) % 3] as THREE.Vector2;
    const next = pts[(k + 1) % 3] as THREE.Vector2;
    const a = p.clone().lerp(prev, cut);
    const b = p.clone().lerp(next, cut);
    if (k === 0) shape.moveTo(a.x, a.y);
    else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(p.x, p.y, b.x, b.y);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.012, 0);
  return geo;
}

/** The defender's finger posts: thumbs together for the crossbar, index fingers up. */
function fingerPosts(color: string, gap: number): THREE.Group {
  const g = new THREE.Group();
  const skin = mix(color, '#ffe0c8', 0.45);
  part(g, pill(0.08, gap * 2 * S - 0.1), skin, 0, 0.09, 0, { rz: Math.PI / 2 });
  for (const side of [-1, 1]) {
    part(g, pill(0.075, 0.55), skin, side * gap * S, 0.4, 0);
    part(g, pill(0.1, 0.2), mix(color, '#ffffff', 0.2), side * gap * S, 0.1, 0.12, { rx: Math.PI / 2 });
  }
  return g;
}

/**
 * The triangle as drawn on a phone. The phone draws lines but no filled polygons, so the paper is two fat strokes
 * round smaller copies of the triangle (they fill it), then a thin edge round the real corners and the fold.
 */
function paperItems(side: Side, x: number, y: number, heading: number, scale = 1, alpha = 1): SceneItem[] {
  const ring = (k: number) => {
    const pts = corners(x, y, heading).map(([vx, vy]) => toPhone(side, x + (vx - x) * k * scale, y + (vy - y) * k * scale));
    return [...pts, pts[0], pts[1]].flatMap((p) => [p?.x ?? 0, p?.y ?? 0]);
  };
  const along = (d: number) => toPhone(side, x + Math.cos(heading) * CORNER * d * scale, y + Math.sin(heading) * CORNER * d * scale);
  const tip = along(0.8);
  const back = along(-0.42);
  const r = CORNER * scale;
  return [
    { s: 'line', pts: ring(0.5), stroke: PAPER_WHITE, lw: r / 2, alpha },
    { s: 'line', pts: ring(0.85), stroke: PAPER_WHITE, lw: r * 0.15, alpha },
    { s: 'line', pts: ring(1), stroke: PAPER_EDGE, lw: 0.012, alpha },
    { s: 'line', pts: [tip.x, tip.y, back.x, back.y], stroke: PAPER_FOLD, lw: 0.01, alpha },
  ];
}

/** The pitch on one phone: yard lines, the edge they score over (this phone's bottom), the start spot. */
function pitchItems(g: TableGame, mt: Match, side: Side): SceneItem[] {
  const me = mt.pair[side];
  const other = mt.pair[side === 0 ? 1 : 0];
  const color = g.color(me);
  const items: SceneItem[] = [];
  // Mown bands, yard lines with hash marks down the sides, and the end zone they score over.
  for (const k of [1, 3]) items.push({ s: 'rect', x: 0.5, y: k * 0.2 + 0.1, w: 1, h: 0.2, fill: PITCH_BAND });
  for (let k = 1; k <= 4; k++) {
    items.push({ s: 'rect', x: 0.5, y: k * 0.2, w: 0.9, h: 0.003, fill: CHALK, alpha: 0.34 });
    for (const x of [0.3, 0.7]) items.push({ s: 'rect', x, y: k * 0.2 - 0.1, w: 0.04, h: 0.003, fill: CHALK, alpha: 0.26 });
  }
  items.push(
    { s: 'rect', x: 0.5, y: 0.955, w: 1, h: 0.09, fill: g.color(other), alpha: 0.2 },
    { s: 'rect', x: 0.5, y: 0.988, w: 1, h: 0.024, fill: g.color(other), alpha: 0.9 },
    { s: 'text', x: 0.5, y: 0.945, text: `${g.name(other)} scores over this edge`, size: 0.04, fill: CHALK, alpha: 0.8, bold: false },
    { s: 'rect', x: 0.5, y: 0.003, w: 1, h: 0.006, fill: CHALK, alpha: 0.55 },
    { s: 'circle', ...toPhone(side, 0.5, startY(side)), r: 0.07, stroke: onDark(color, 0.15), lw: 0.008, alpha: 0.7 },
    { s: 'text', x: 0.06, y: 0.04, text: `${g.name(me)} ${mt.game.points[side]}`, size: 0.05, fill: CHALK, align: 'left' },
    { s: 'text', x: 0.94, y: 0.04, text: goLabel(mt, side), size: 0.042, fill: CHALK, align: 'right', alpha: 0.8, bold: false },
  );
  return items;
}

function goLabel(mt: Match, side: Side): string {
  const mine = mt.game.order.filter((s) => s === side).length;
  const done = mt.game.order.slice(0, mt.game.turn + (mt.phase === 'done' ? 0 : 1)).filter((s) => s === side).length;
  return `Flick ${Math.min(mine, Math.max(1, done))} of ${mine}`;
}

/** What one phone shows: still parts (mirrored on the TV) and moving ones (3D on the TV). */
function phoneScene(g: TableGame, mt: Match, side: Side): { still: SceneItem[]; moving: SceneItem[] } {
  const still = pitchItems(g, mt, side);
  const moving: SceneItem[] = [];
  const flicker = whoseGo(mt.game);
  const mine = flicker === side;
  const other = mt.pair[side === 0 ? 1 : 0];
  if (mt.posts && (mt.phase === 'kickAim' || mt.phase === 'kick' || (mt.phase === 'result' && mt.kick))) {
    const p = mt.posts;
    const defender = mt.pair[flicker === 0 ? 1 : 0];
    const skin = mix(g.color(defender), '#ffe0c8', 0.45);
    const a = toPhone(side, p.x - p.gap, p.y);
    const b = toPhone(side, p.x + p.gap, p.y);
    still.push({ s: 'line', pts: [a.x, a.y, b.x, b.y], stroke: skin, lw: 0.05 }, { s: 'circle', x: a.x, y: a.y, r: 0.045, fill: skin, stroke: CHALK, lw: 0.01 }, { s: 'circle', x: b.x, y: b.y, r: 0.045, fill: skin, stroke: CHALK, lw: 0.01 });
  }
  if (mt.phase === 'aim' || mt.phase === 'kickAim') {
    if (flicker !== null) moving.push(...paperItems(side, 0.5, startY(flicker), flicker === 0 ? Math.PI / 2 : -Math.PI / 2));
    if (mine) {
      const kick = mt.phase === 'kickAim';
      still.push({ s: 'text', x: 0.5, y: 0.5, text: kick ? 'Field goal!' : 'Your flick!', size: 0.1, fill: CHALK }, { s: 'text', x: 0.5, y: 0.57, text: kick ? 'Flick it between the fingers' : `Swipe it towards ${g.name(other)}`, size: 0.048, fill: CHALK, alpha: 0.85, bold: false });
      const left = PAPER.turnTime - mt.t;
      if (left < 5.5 && !g.isCpu(mt.pair[side])) still.push({ s: 'text', x: 0.5, y: 0.66, text: String(Math.max(0, Math.ceil(left))), size: 0.07, fill: SCREEN.gold });
      if (mt.stroke && mt.stroke.length > 1) {
        const s0 = mt.stroke[0] as TouchSample;
        const s1 = mt.stroke[mt.stroke.length - 1] as TouchSample;
        const a = toPhone(side, s0.x, s0.y);
        const b = toPhone(side, s1.x, s1.y);
        moving.push({ s: 'line', pts: [a.x, a.y, b.x, b.y], stroke: onDark(g.color(mt.pair[side]), 0.2), lw: 0.026, alpha: 0.7 });
      }
    } else if (flicker !== null) {
      still.push({ s: 'text', x: 0.5, y: 0.5, text: mt.phase === 'kickAim' ? `${g.name(other)} kicks` : `${g.name(other)}'s flick`, size: 0.075, fill: CHALK, alpha: 0.9 });
      if (mt.phase === 'kickAim') still.push({ s: 'text', x: 0.5, y: 0.57, text: 'Your fingers are the posts', size: 0.045, fill: CHALK, alpha: 0.8, bold: false });
    }
  } else if (mt.slide && (mt.phase === 'slide' || (mt.phase === 'result' && !mt.kick))) {
    const sl = mt.slide;
    const at = slideAt(sl, mt.phase === 'slide' ? mt.t : sl.time);
    const gone = (sl.end === 'side' || sl.end === 'end') && (mt.phase === 'result' || mt.t > sl.time);
    if (!gone) moving.push(...paperItems(side, at.x, at.y, sl.heading));
  } else if (mt.kick && (mt.phase === 'kick' || mt.phase === 'result')) {
    const k = mt.kick;
    const u = mt.phase === 'kick' ? mt.t / PAPER.kickTime : 1;
    const at = kickAt(k, u);
    const landed = u >= 1;
    if (!landed || Math.abs(at.y) <= PHONE_L) {
      moving.push(fieldCircle(side, at.x + at.h * 0.12, at.y, CORNER * 0.5, { fill: SCREEN.night, alpha: 0.3 }));
      moving.push(...paperItems(side, at.x, at.y, k.side === 0 ? Math.PI / 2 : -Math.PI / 2, 1 + at.h * 0.9));
    }
  }
  if (mt.note) still.push(...overlayItems(mt.note.text, mt.note.color, 0.36, 0.11));
  return { still, moving };
}

// ------------------------------------------------------------------ a round

async function playRound(g: TableGame, pairs: readonly Pair[], round: 1 | 2, short: boolean, waiting: number | null): Promise<MatchOutcome[]> {
  const { clock, ui, sfx, rng } = g.ctx;
  const view = g.view;
  const turns = short ? PAPER.shortTurns : PAPER.turns;
  const matches: Match[] = pairs.map((pair, m) => {
    const tri = triangle();
    view.scene.add(tri);
    view.setScore(m, 0, 0);
    return {
      pair,
      game: newPaperMatch(rng() < 0.5 ? 0 : 1, turns),
      phase: 'aim',
      t: 0,
      slide: null,
      kick: null,
      posts: null,
      stroke: null,
      note: null,
      cpuAt: null,
      kickNext: false,
      tri,
      postsMesh: null,
    };
  });

  const v = new THREE.Vector3();
  /** The 3D triangle and posts follow the match. */
  const place = (mt: Match, m: number) => {
    const tri = mt.tri;
    const flicker = whoseGo(mt.game);
    let x = 0.5;
    let y = 0;
    let heading = Math.PI / 2;
    let lift = 0;
    let drop = 0;
    let spin = 0;
    if ((mt.phase === 'aim' || mt.phase === 'kickAim' || mt.phase === 'done') && flicker !== null) {
      y = startY(flicker);
      heading = flicker === 0 ? Math.PI / 2 : -Math.PI / 2;
    } else if (mt.slide && (mt.phase === 'slide' || (mt.phase === 'result' && !mt.kick))) {
      const sl = mt.slide;
      const tt = mt.phase === 'slide' ? mt.t : sl.time + mt.t;
      const at = slideAt(sl, tt);
      x = at.x;
      y = at.y;
      heading = sl.heading;
      if ((sl.end === 'side' || sl.end === 'end') && tt > sl.time) {
        const k = Math.min(1, (tt - sl.time) / FALL);
        x += sl.ux * 0.25 * k;
        y += sl.uy * 0.25 * k;
        drop = k * k;
        spin = k * 2.5;
      }
    } else if (mt.kick) {
      const k = mt.kick;
      const at = kickAt(k, mt.phase === 'kick' ? mt.t / PAPER.kickTime : 1);
      x = at.x;
      y = at.y;
      lift = at.h * S;
      heading = k.side === 0 ? Math.PI / 2 : -Math.PI / 2;
      spin = mt.phase === 'kick' ? mt.t * 9 : 0;
    }
    view.world(m, x, y, lift, v);
    v.y = v.y * (1 - drop) + 0.03 * drop;
    tri.position.copy(v);
    tri.rotation.set(spin * 0.4, heading - Math.PI / 2, spin);
    tri.visible = mt.phase !== 'done';
    if (mt.posts && !mt.postsMesh && (mt.phase === 'kickAim' || mt.phase === 'kick')) {
      const defender = mt.pair[whoseGo(mt.game) === 0 ? 1 : 0];
      mt.postsMesh = fingerPosts(g.color(defender), mt.posts.gap);
      mt.postsMesh.position.copy(view.world(m, mt.posts.x, mt.posts.y, 0, v));
      mt.postsMesh.rotation.y = whoseGo(mt.game) === 0 ? Math.PI / 2 : -Math.PI / 2;
      view.scene.add(mt.postsMesh);
    }
    if (mt.postsMesh && !mt.posts) {
      mt.postsMesh.removeFromParent();
      mt.postsMesh = null;
    }
  };

  const draw = (force = false) =>
    matches.forEach((mt, m) => {
      for (const side of [0, 1] as const) {
        const { still, moving } = phoneScene(g, mt, side);
        g.show(m, side, still, moving, PITCH, force);
      }
      view.setScore(m, mt.game.points[0], mt.game.points[1]);
      place(mt, m);
    });

  const enter = (mt: Match, phase: Phase) => {
    mt.phase = phase;
    mt.t = 0;
    mt.stroke = null;
    mt.cpuAt = null;
    const flicker = whoseGo(mt.game);
    mt.pair.forEach((p, side) => view.companion(p)?.setBase(flicker === side && (phase === 'aim' || phase === 'kickAim') ? 'working' : 'listening'));
    if ((phase === 'aim' || phase === 'kickAim') && flicker !== null) {
      const p = mt.pair[flicker];
      g.buzz(p, [25]);
      if (pairs.length === 1) ui.caption(phase === 'kickAim' ? `${g.name(p)} kicks for 1` : `${g.name(p)}'s flick`, g.color(p));
    }
  };

  const say = (mt: Match, text: string, color: string = CHALK) => (mt.note = { text, color });

  const launch = (mt: Match, dx: number, dy: number, speed: number) => {
    const side = whoseGo(mt.game);
    if (side === null) return;
    if (mt.phase === 'aim') {
      mt.slide = launchSlide(side, dx, dy, speed);
      mt.kick = null;
      enter(mt, 'slide');
      noise(sfx, { dur: Math.min(1.6, mt.slide.time), freq: 1400, to: 300, gain: 0.07, filter: 'bandpass' });
    } else if (mt.phase === 'kickAim' && mt.posts) {
      mt.kick = launchKick(side, dx, dy, speed, mt.posts);
      enter(mt, 'kick');
      noise(sfx, { dur: 0.25, freq: 2200, to: 700, gain: 0.08, filter: 'bandpass' });
    }
    tone(sfx, { freq: 880, to: 520, dur: 0.06, type: 'triangle', gain: 0.1 });
  };

  /** The slide stopped: score it and say what happened. */
  const settle = (mt: Match) => {
    const sl = mt.slide;
    const side = whoseGo(mt.game);
    if (!sl || side === null) return;
    const me = mt.pair[side];
    const other = mt.pair[side === 0 ? 1 : 0];
    scoreSlide(mt.game, side, sl);
    mt.kickNext = sl.end === 'touchdown';
    switch (sl.end) {
      case 'touchdown':
        say(mt, 'Touchdown!', SCREEN.gold);
        sfx.good();
        tone(sfx, { freq: 523, dur: 0.14, gain: 0.12, delay: 0.05 });
        tone(sfx, { freq: 659, dur: 0.14, gain: 0.12, delay: 0.18 });
        tone(sfx, { freq: 784, dur: 0.3, gain: 0.12, delay: 0.31 });
        view.floaters.add('Touchdown! +6', g.color(me), view.above(me), 0.5, 1.8);
        view.companion(me)?.react('happy', 2);
        view.companion(other)?.react('sad', 1.4);
        view.cheerWatchers('happy');
        g.buzz(me, [30, 40, 30]);
        g.tell(me, true, 'Touchdown! Now kick for one more.');
        break;
      case 'short': {
        const gap = PHONE_L - sl.progress - CORNER;
        say(mt, gap < 0.35 ? 'So close!' : 'Short!');
        tone(sfx, { freq: 330, to: 260, dur: 0.18, gain: 0.08 });
        if (gap < 0.35) view.cheerWatchers('thinking');
        break;
      }
      case 'own':
        say(mt, 'Not across!');
        tone(sfx, { freq: 300, to: 220, dur: 0.2, gain: 0.08 });
        view.companion(me)?.react('thinking', 1.2);
        break;
      case 'side':
        say(mt, 'Off the side!');
        noise(sfx, { dur: 0.3, freq: 400, to: 120, gain: 0.12, delay: 0.25 });
        view.companion(me)?.react('sad', 1);
        break;
      case 'end':
        say(mt, 'Off the end!');
        noise(sfx, { dur: 0.3, freq: 400, to: 120, gain: 0.12, delay: 0.25 });
        view.companion(me)?.react('sad', 1);
        break;
    }
    if (sl.end !== 'touchdown') g.tell(me, false, mt.note?.text ?? '');
    enter(mt, 'result');
  };

  const kicked = (mt: Match) => {
    const k = mt.kick;
    const side = whoseGo(mt.game);
    if (!k || side === null) return;
    const me = mt.pair[side];
    scoreKick(mt.game, side, k);
    if (k.result === 'good') {
      say(mt, "It's good! +1", SCREEN.gold);
      sfx.good();
      view.floaters.add('+1', g.color(me), view.above(me), 0.5, 1.4);
      view.companion(me)?.react('happy', 1.4);
      g.tell(me, true, "It's good!");
    } else {
      say(mt, k.result === 'wide' ? 'Wide!' : 'Short!');
      tone(sfx, { freq: 300, to: 200, dur: 0.22, gain: 0.08 });
      view.companion(me)?.react('thinking', 1.2);
      g.tell(me, false, k.result === 'wide' ? 'Wide of the posts.' : 'It fell short.');
    }
    mt.kickNext = false;
    enter(mt, 'result');
  };

  const next = (mt: Match) => {
    mt.note = null;
    mt.slide = null;
    if (mt.kickNext) {
      const side = whoseGo(mt.game);
      if (side !== null) {
        mt.posts = makePosts(side, rng);
        mt.kick = null;
        enter(mt, 'kickAim');
        return;
      }
    }
    mt.posts = null;
    mt.kick = null;
    nextGo(mt.game);
    if (whoseGo(mt.game) === null) {
      enter(mt, 'done');
      return;
    }
    enter(mt, 'aim');
  };

  matches.forEach((mt) => enter(mt, 'aim'));
  draw(true);
  ui.live(null);
  await g.countIn((o) => {
    matches.forEach((mt) => (mt.note = o ? { text: o, color: CHALK } : null));
    draw(true);
  });
  matches.forEach((mt) => enter(mt, 'aim'));

  g.onTouch((p, msg) => {
    matches.forEach((mt) => {
      const side = whoseGo(mt.game);
      if (side === null || mt.pair[side] !== p || (mt.phase !== 'aim' && mt.phase !== 'kickAim')) return;
      const f = fromPhone(side, msg.x, msg.y);
      const s: TouchSample = { x: f.x, y: f.y, t: performance.now() / 1000 };
      if (msg.phase === 'down' || !mt.stroke) mt.stroke = [s];
      else {
        mt.stroke.push(s);
        if (mt.stroke.length > 40) mt.stroke.shift();
      }
      if (msg.phase !== 'up') return;
      const flick = readFlick(mt.stroke, side);
      mt.stroke = null;
      if (flick.ok) launch(mt, flick.dx, flick.dy, flick.speed);
      else if (flick.why !== 'tap') g.tell(p, false, `Flick it towards ${g.name(mt.pair[side === 0 ? 1 : 0])}!`);
    });
  });
  if (pairs.length > 1) ui.caption('Hang the tip over the far edge for a touchdown');

  let hudAt = -1;
  await everyFrame(clock, (dt) => {
    matches.forEach((mt) => {
      mt.t += dt;
      const side = whoseGo(mt.game);
      const flicker = side === null ? null : mt.pair[side];
      switch (mt.phase) {
        case 'aim':
        case 'kickAim':
          if (side === null || flicker === null) break;
          if (g.isCpu(flicker)) {
            const skill = g.skills[flicker] ?? 0.5;
            mt.cpuAt ??= 0.8 + (1 - skill) * 0.8 + rng() * 0.6;
            if (mt.t >= mt.cpuAt) {
              const f = mt.phase === 'aim' ? cpuFlick(side, skill, rng) : cpuKick(side, mt.posts ?? makePosts(side, rng), skill, rng);
              launch(mt, f.dx, f.dy, f.speed);
            }
          } else if (mt.t >= PAPER.turnTime) {
            say(mt, 'Too slow!');
            g.tell(flicker, false, 'Too slow: the go passes.');
            mt.kickNext = false;
            if (mt.phase === 'aim') mt.slide = null;
            enter(mt, 'result');
          }
          break;
        case 'slide':
          if (mt.slide && mt.t >= mt.slide.time) settle(mt);
          break;
        case 'kick':
          if (mt.t >= PAPER.kickTime) kicked(mt);
          break;
        case 'result':
          if (mt.t >= (mt.kickNext ? 1.5 : 1.2)) next(mt);
          break;
        case 'done':
          break;
      }
    });
    draw();
    if (clock.time - hudAt >= 0.1) {
      hudAt = clock.time;
      g.live(pairs, (_p, m, side) => `${matches[m]?.game.points[side] ?? 0} pts`, waiting);
    }
    return matches.every((mt) => mt.phase === 'done');
  });
  g.onTouch(null);

  const outcomes = matches.map((mt): MatchOutcome => {
    const w = paperWinner(mt.game, rng);
    mt.note = { text: `${g.name(mt.pair[w])} wins!`, color: onDark(g.color(mt.pair[w]), 0.15) };
    return { players: [mt.pair[0], mt.pair[1]], points: [mt.game.points[0], mt.game.points[1]], winner: w, round };
  });
  draw(true);
  sfx.fanfare();
  g.celebrate(outcomes);
  for (const o of outcomes) o.players.forEach((p, side) => g.tell(p, o.winner === side, o.winner === side ? 'You win!' : 'Good game!'));
  await clock.wait(2.2);
  for (const mt of matches) {
    mt.tri.removeFromParent();
    mt.postsMesh?.removeFromParent();
  }
  return outcomes;
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'paperfootball',
  title: 'Paper Football',
  how: 'Lay your phones top to top and take turns flicking the paper triangle with a swipe. Stop it with its tip hanging over the far edge for a touchdown (6) and a kick at the posts (1); most points after four flicks wins!',
  controller: 'table',
  kind: 'table',

  async play(ctx) {
    const g = await TableGame.open(ctx);
    const { plan } = g;
    const outcomes: MatchOutcome[] = [];
    try {
      if (plan.first.length === 0) return { scores: ctx.seats.map(() => 0), details: ctx.seats.map(() => '') };
      const short = plan.waiting !== null;
      const watchers = [...plan.sofa, ...(plan.waiting !== null ? [plan.waiting] : [])];
      await g.arrange(plan.first, watchers, plan.waiting);
      outcomes.push(...(await playRound(g, plan.first, 1, short, plan.waiting)));
      if (plan.waiting !== null && outcomes[0]) {
        const through = g.advancer(outcomes[0]);
        const out = outcomes[0].players.find((p) => p !== through) as number;
        const final: Pair = [plan.waiting, through];
        await g.arrange([final], [...plan.sofa, out], null);
        outcomes.push(...(await playRound(g, [final], 2, short, null)));
      }
    } finally {
      g.close();
    }
    return g.result(outcomes, (o, side) => {
      const mine = o.points[side];
      const theirs = o.points[side === 0 ? 1 : 0];
      const them = g.name(o.players[side === 0 ? 1 : 0]);
      const word = o.winner === side ? 'Won' : 'Lost';
      return `${word} ${mine}–${theirs} vs ${them}${mine === theirs ? ' (longest flick)' : ''}`;
    });
  },
};
