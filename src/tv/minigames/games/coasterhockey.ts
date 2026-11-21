// Coaster Hockey on the TV: a cosy living room late in the evening, a big coffee table, and the players' phones
// lying on it top to top. The phones are the air-hockey table (a drink coaster is the puck); the TV mirrors them,
// keeps the score and has the players' companions standing at the ends of the table, cheering.
import * as THREE from 'three';
import { HOCKEY, type HockeyCpu, type MatchOutcome, type Rink, type Side, aimMallet, cpuHockey, fromPhone, newHockeyCpu, newRink, stepRink } from '../../../game/minigames/coasterhockey';
import type { SceneItem } from '../../../shared/protocol';
import { PALETTE as P, cyl, mix, part, sphere, torus } from '../../render/toon';
import { tone } from '../kit';
import { type Pair, S, SCREEN, TableGame, fieldCircle, onDark, overlayItems } from '../table-kit';
import { type Minigame, everyFrame } from '../types';

// ------------------------------------------------------------------ coaster hockey: the pieces

/** The felt: a deep petrol, a shade lighter inside the rails. */
const FELT = '#12272f';
const FELT_IN = '#183640';
const LINE = SCREEN.cream;
const CORK = SCREEN.cork;
const CORK_DARK = SCREEN.corkDark;

/** The puck: a cork drinks coaster with a pressed ring and a worn edge. */
function coaster(): THREE.Group {
  const g = new THREE.Group();
  const r = HOCKEY.puckR * S;
  part(g, cyl(r, r, 0.05, 32), CORK, 0, 0.025, 0, { tex: 'sand', texStrength: 0.6, outline: 0.012 });
  part(g, cyl(r * 0.92, r * 0.92, 0.006, 32), mix(CORK, P.cream, 0.18), 0, 0.052, 0, { tex: 'sand', texStrength: 0.6, outline: false, shadow: false });
  part(g, torus(r * 0.68, 0.01), CORK_DARK, 0, 0.055, 0, { rx: Math.PI / 2, outline: false, shadow: false });
  part(g, torus(r * 0.3, 0.007), CORK_DARK, 0, 0.055, 0, { rx: Math.PI / 2, outline: false, shadow: false });
  return g;
}

/** A mallet: a glossy puck-pusher in the player's colour with a turned wooden grip. */
function mallet(color: string): THREE.Group {
  const g = new THREE.Group();
  const r = HOCKEY.malletR * S;
  part(g, cyl(r * 0.94, r, 0.07, 32), color, 0, 0.035, 0, { gloss: 0.5, outline: 0.012 });
  part(g, torus(r * 0.8, 0.012), mix(color, P.cream, 0.55), 0, 0.071, 0, { rx: Math.PI / 2, outline: false, shadow: false });
  part(g, cyl(r * 0.36, r * 0.5, 0.13, 20), P.walnut, 0, 0.135, 0, { tex: 'darkWood', gloss: 0.3, outline: 0.01 });
  part(g, sphere(r * 0.42, 18), mix(color, P.cream, 0.3), 0, 0.23, 0, { gloss: 0.6, outline: 0.01 });
  return g;
}

interface Match {
  pair: Pair;
  rink: Rink;
  /** Computer brains per side (null: a person's finger). */
  cpu: [HockeyCpu | null, HockeyCpu | null];
  done: boolean;
  overtime: boolean;
  /** A word over both phones until `until` (a goal, the end). */
  flash: { text: string; color: string; until: number } | null;
  puck: THREE.Group;
  mallets: [THREE.Group, THREE.Group];
}

/** The still part of a hockey phone: the felt, rails, the middle circle, the goal slot, names and score. */
function hockeyStill(g: TableGame, match: Match, side: Side, overlay: { text: string; color: string } | null): SceneItem[] {
  const me = match.pair[side];
  const them = match.pair[side === 0 ? 1 : 0];
  const color = g.color(me);
  const mine = match.rink.score[side];
  const theirs = match.rink.score[side === 0 ? 1 : 0];
  const gh = HOCKEY.goalHalf;
  const items: SceneItem[] = [
    { s: 'rect', x: 0.5, y: 0.49, w: 0.95, h: 1.02, fill: FELT_IN, radius: 0.03 },
    { s: 'text', x: 0.5, y: 0.5, text: `${mine}–${theirs}`, size: 0.3, fill: LINE, alpha: 0.07 },
    { s: 'circle', x: 0.5, y: 0, r: 0.26, stroke: LINE, lw: 0.008, alpha: 0.4 },
    { s: 'circle', x: 0.5, y: 0, r: 0.035, fill: LINE, alpha: 0.4 },
    { s: 'rect', x: 0.5, y: 0.003, w: 0.95, h: 0.006, fill: onDark(g.color(them), 0.1), alpha: 0.85 },
    { s: 'circle', x: 0.5, y: 1, r: gh + 0.1, fill: color, alpha: 0.1 },
    { s: 'circle', x: 0.5, y: 1, r: gh + 0.1, stroke: onDark(color, 0.15), lw: 0.008, alpha: 0.7 },
    { s: 'rect', x: 0.5, y: 0.993, w: gh * 2, h: 0.03, fill: SCREEN.night, stroke: color, lw: 0.01, radius: 0.012 },
    { s: 'rect', x: 0.025, y: 0.5, w: 0.006, h: 1, fill: LINE, alpha: 0.3 },
    { s: 'rect', x: 0.975, y: 0.5, w: 0.006, h: 1, fill: LINE, alpha: 0.3 },
    { s: 'text', x: 0.07, y: 0.955, text: g.name(me), size: 0.045, fill: onDark(color), align: 'left' },
    { s: 'text', x: 0.93, y: 0.955, text: `${mine}–${theirs}`, size: 0.05, fill: LINE, align: 'right' },
  ];
  if (match.overtime && !match.done) items.push({ s: 'text', x: 0.5, y: 0.08, text: 'Next goal wins', size: 0.055, fill: SCREEN.gold });
  if (overlay) items.push(...overlayItems(overlay.text, overlay.color, 0.42));
  return items;
}

/** The moving part: the coaster (with a faint trail) and this side's mallet. */
function hockeyMoving(g: TableGame, match: Match, side: Side): SceneItem[] {
  const r = match.rink;
  const p = r.puck;
  const items: SceneItem[] = [];
  if (r.live) {
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 0.8) {
      for (const k of [2, 1]) items.push(fieldCircle(side, p.x - p.vx * 0.022 * k, p.y - p.vy * 0.022 * k, HOCKEY.puckR * (1 - 0.12 * k), { fill: CORK, alpha: 0.14 * (3 - k) }));
    }
    items.push(fieldCircle(side, p.x, p.y, HOCKEY.puckR, { fill: CORK, stroke: CORK_DARK, lw: 0.01 }));
    items.push(fieldCircle(side, p.x, p.y, HOCKEY.puckR * 0.68, { stroke: CORK_DARK, lw: 0.006, alpha: 0.75 }));
    items.push(fieldCircle(side, p.x, p.y, HOCKEY.puckR * 0.3, { stroke: SCREEN.corkLight, lw: 0.006, alpha: 0.8 }));
  }
  const m = r.mallets[side];
  const color = g.color(match.pair[side]);
  items.push(fieldCircle(side, m.x, m.y, HOCKEY.malletR * 1.18, { fill: color, alpha: 0.18 }));
  items.push(fieldCircle(side, m.x, m.y, HOCKEY.malletR, { fill: color, stroke: SCREEN.cream, lw: 0.012 }));
  items.push(fieldCircle(side, m.x, m.y, HOCKEY.malletR * 0.45, { fill: mix(color, SCREEN.cream, 0.5), stroke: mix(color, SCREEN.night, 0.25), lw: 0.006 }));
  return items;
}

/** A soft click: the coaster against a mallet or a rail. */
function clack(g: TableGame, speed: number, rail: boolean): void {
  const k = Math.min(1, speed / HOCKEY.puckMax);
  tone(g.ctx.sfx, { freq: rail ? 260 + 120 * k : 520 + 260 * k, to: rail ? 180 : 360, dur: 0.05, type: 'triangle', gain: 0.05 + 0.1 * k });
}

// ------------------------------------------------------------------ coaster hockey: a round

async function playRound(g: TableGame, pairs: readonly Pair[], round: 1 | 2, short: boolean, waiting: number | null): Promise<MatchOutcome[]> {
  const { clock, ui, sfx, rng } = g.ctx;
  const duration = short ? HOCKEY.shortDuration : HOCKEY.duration;
  const target = short ? HOCKEY.shortTarget : HOCKEY.target;
  const view = g.view;
  const matches: Match[] = pairs.map((pair, m) => {
    const rink = newRink(rng() < 0.5 ? 0 : 1);
    const puck = coaster();
    const mallets: [THREE.Group, THREE.Group] = [mallet(g.color(pair[0])), mallet(g.color(pair[1]))];
    view.scene.add(puck, ...mallets);
    view.setScore(m, 0, 0);
    return {
      pair,
      rink,
      cpu: [g.isCpu(pair[0]) ? newHockeyCpu(g.skills[pair[0]] ?? 0.5) : null, g.isCpu(pair[1]) ? newHockeyCpu(g.skills[pair[1]] ?? 0.5) : null],
      done: false,
      overtime: false,
      flash: null,
      puck,
      mallets,
    };
  });
  let now = 0;
  const v = new THREE.Vector3();
  const place = () =>
    matches.forEach((mt, m) => {
      const r = mt.rink;
      mt.puck.visible = r.live;
      mt.puck.position.copy(view.world(m, r.puck.x, r.puck.y, 0, v));
      mt.mallets.forEach((ml, side) => ml.position.copy(view.world(m, r.mallets[side].x, r.mallets[side].y, 0, v)));
    });
  const draw = (overlay: string | null = null, force = false) =>
    matches.forEach((mt, m) => {
      for (const side of [0, 1] as const) {
        const word = overlay !== null ? { text: overlay, color: SCREEN.cream } : mt.flash && now < mt.flash.until ? mt.flash : null;
        g.show(m, side, hockeyStill(g, mt, side, word), hockeyMoving(g, mt, side), FELT, force);
      }
    });
  place();
  draw(null, true);
  ui.live(null);
  await g.countIn((o) => draw(o, true));

  g.onTouch((p, msg) => {
    if (msg.phase === 'up') return;
    matches.forEach((mt) => {
      const side = mt.pair.indexOf(p);
      if (side < 0 || mt.done) return;
      const f = fromPhone(side as Side, msg.x, msg.y);
      aimMallet(mt.rink, side as Side, f.x, f.y);
    });
  });
  ui.caption(`First to ${target}: drag your mallet on your own phone`);

  const goal = (mt: Match, m: number, scorer: Side) => {
    const who = mt.pair[scorer];
    const other = mt.pair[scorer === 0 ? 1 : 0];
    const [a, b] = mt.rink.score;
    view.setScore(m, a, b);
    sfx.good();
    tone(sfx, { freq: 660, to: 990, dur: 0.22, type: 'sine', gain: 0.12, delay: 0.08 });
    view.companion(who)?.react('happy', 1.8);
    view.companion(other)?.react('sad', 1.3);
    view.cheerWatchers();
    view.floaters.add('Goal!', g.color(who), view.above(who), 0.55, 1.4);
    mt.flash = { text: `${g.name(who)} scores!`, color: onDark(g.color(who), 0.15), until: now + 1.2 };
    g.buzz(who, [30]);
    g.buzz(other, [70, 40, 70]);
    const decided = Math.max(a, b) >= target || mt.overtime;
    if (decided) {
      mt.done = true;
      mt.flash = { text: `${g.name(who)} wins!`, color: onDark(g.color(who), 0.15), until: Infinity };
      ui.caption(`${g.name(who)} wins ${Math.max(a, b)}–${Math.min(a, b)}!`, g.color(who));
    }
  };

  let acc = 0;
  let hudAt = -1;
  let lastClack = -1;
  await everyFrame(clock, (dt) => {
    now += dt;
    acc += dt;
    while (acc >= HOCKEY.step) {
      acc -= HOCKEY.step;
      matches.forEach((mt, m) => {
        if (mt.done) return;
        mt.pair.forEach((p, side) => {
          if (!g.isCpu(p)) return;
          mt.cpu[side] ??= newHockeyCpu(g.skills[p] ?? 0.5);
          cpuHockey(mt.rink, side as Side, mt.cpu[side] as HockeyCpu, HOCKEY.step, rng);
        });
        for (const e of stepRink(mt.rink, HOCKEY.step)) {
          if ((e.t === 'hit' && e.speed > 0.3) || e.t === 'wall') {
            if (now - lastClack > 0.07) clack(g, e.speed, e.t === 'wall');
            lastClack = now;
          } else if (e.t === 'goal') goal(mt, m, e.side);
          else if (e.t === 'serve' && !mt.done) mt.flash = null;
        }
      });
    }
    // Time: a draw goes to "next goal wins", then stays a draw.
    for (const mt of matches) {
      if (mt.done) continue;
      const [a, b] = mt.rink.score;
      if (now >= duration && !mt.overtime) {
        if (a !== b) {
          mt.done = true;
          const w = mt.pair[a > b ? 0 : 1];
          mt.flash = { text: `${g.name(w)} wins!`, color: onDark(g.color(w), 0.15), until: Infinity };
        } else {
          mt.overtime = true;
          mt.flash = { text: 'Next goal wins!', color: SCREEN.gold, until: now + 1.5 };
          ui.caption('Level! Next goal wins', SCREEN.gold);
          sfx.tick();
        }
      } else if (mt.overtime && now >= duration + HOCKEY.overtime) {
        mt.done = true;
        mt.flash = { text: 'A draw!', color: SCREEN.cream, until: Infinity };
      }
    }
    place();
    draw();
    if (now - hudAt >= 0.1) {
      hudAt = now;
      const overtime = matches.some((mt) => mt.overtime && !mt.done);
      ui.timer(Math.max(0, (overtime ? duration + HOCKEY.overtime : duration) - now));
      g.live(
        pairs,
        (_p, m, side) => {
          const sc = matches[m]?.rink.score ?? [0, 0];
          return `${sc[side]} : ${sc[side === 0 ? 1 : 0]}`;
        },
        waiting,
      );
    }
    return matches.every((mt) => mt.done);
  });
  g.onTouch(null);
  ui.timer(null);
  draw(null, true);
  sfx.fanfare();
  const outcomes = matches.map((mt): MatchOutcome => {
    const [a, b] = mt.rink.score;
    return { players: [mt.pair[0], mt.pair[1]], points: [a, b], winner: a === b ? null : a > b ? 0 : 1, round };
  });
  g.celebrate(outcomes);
  for (const o of outcomes) {
    o.players.forEach((p, side) => {
      const won = o.winner === side;
      g.tell(p, won, o.winner === null ? 'A draw!' : won ? 'You win!' : 'Good game!');
    });
  }
  await clock.wait(2.2);
  for (const mt of matches) {
    mt.puck.removeFromParent();
    mt.mallets.forEach((ml) => ml.removeFromParent());
  }
  return outcomes;
}

// ------------------------------------------------------------------ the game

export const minigame: Minigame = {
  id: 'coasterhockey',
  title: 'Coaster Hockey',
  how: 'Lay your phones top to top: they make one air-hockey table, with a coaster for a puck. Drag your mallet on your own phone and knock the coaster into the far slot; first to 5 wins!',
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
      const word = o.winner === null ? 'Drew' : o.winner === side ? 'Won' : 'Lost';
      return `${word} ${mine}–${theirs} vs ${them}`;
    });
  },
};
