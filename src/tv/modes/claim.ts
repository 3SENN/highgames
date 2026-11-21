// Cushion Claim: a living-room floor of 5×5 cushions, everyone starting in a corner. After each minigame the players
// claim cushions in order of their place (1st: 3 claims, 2nd: 2, 3rd: 1): a free cushion next to yours costs 1,
// a rival's costs 2, and small pockets you surround become yours. Most cushions after six rounds wins.
// Picking happens on the phone: its screen shows the floor as a grid (the table playfield), tap a glowing cushion.
import * as THREE from 'three';
import { type Companion, buildCompanion } from '../../companion/kit';
import { claim, claimCost, claimsFor, counts, cpuPick, createClaim, legalCells, type ClaimState } from '../../game/claim';
import { shuffle } from '../../game/rng';
import { ranks } from '../../game/rules';
import type { SceneItem } from '../../shared/protocol';
import type { Host } from '../host';
import { minigamesOfKind } from '../minigames';
import { CameraFit, Floaters, type Mark, SceneStream, tone } from '../minigames/kit';
import type { Minigame } from '../minigames/types';
import { type Env, livingRoom } from '../render/env';
import * as props from '../render/props';
import { PALETTE as P, material, mix, part, rbox, sphere, torus, withOutline } from '../render/toon';
import type { View } from '../stage';

const SIZE = 5;
const ROUNDS = 6;
const GAP = 1.95;
/** A cushion nobody has claimed yet: plain linen. */
const FREE = P.linen;
/** The room is built this much larger than life, so the cushions read as big floor cushions in it. */
const ROOM = 1.5;
const ROOM_W = 10.6;
const ROOM_D = 9.4;

const cushions = (n: number) => `${n} cushion${n === 1 ? '' : 's'}`;
const cellPos = (cell: number) => new THREE.Vector3(((cell % SIZE) - (SIZE - 1) / 2) * GAP, 0, (Math.floor(cell / SIZE) - (SIZE - 1) / 2) * GAP);

/** The living room floor: 5×5 cushions on a big rug, in a dressed room on a lamp-lit evening. */
class ClaimView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
  readonly floaters = new Floaters(this.scene);
  private readonly env: Env;
  private readonly cells: THREE.Group[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private readonly fit = new CameraFit(this.camera, 0.8);
  private readonly hops: { c: Companion; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
  private readonly lands: { c: Companion; t: number }[] = [];
  private bumps = new Map<number, number>();
  /** Captured cushions waiting their turn to flip, so a pocket sweeps over from the claimed cushion outwards. */
  private readonly sweep: { cell: number; wait: number; color: string }[] = [];
  private readonly pulses: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }[] = [];

  constructor(
    private readonly state: ClaimState,
    private readonly colors: string[],
    private readonly companions: (Companion | null)[],
  ) {
    const env = livingRoom(this.scene, { mood: 'evening', w: ROOM_W, d: ROOM_D, rug: false, seed: 3 });
    this.env = env;
    env.root.scale.setScalar(ROOM);
    for (const l of env.lamps) {
      l.distance *= ROOM;
      l.intensity *= ROOM * ROOM;
    }
    const shade = env.sun.shadow.camera;
    shade.left = shade.bottom = -11;
    shade.right = shade.top = 11;
    shade.updateProjectionMatrix();
    const back = -(ROOM_D / 2) * ROOM;
    const side = (ROOM_W / 2) * ROOM;
    const put = <T extends THREE.Object3D>(obj: T, x: number, z: number, ry = 0, s = ROOM): T => {
      obj.position.set(x, 0, z);
      obj.rotation.y = ry;
      obj.scale.setScalar(s);
      this.scene.add(obj);
      return obj;
    };
    // The rug the cushions lie on, a sofa behind it, and a second lamp so the right side isn't left in the dark.
    put(props.rug({ w: SIZE * GAP + 1.5, d: SIZE * GAP + 1.5, color: mix(P.plum, P.aubergine, 0.35), border: mix(P.mauve, P.aubergine, 0.3) }), 0, 0, 0, 1);
    put(props.sofa({ seats: 3, color: P.mauve, pillows: [P.mustard, P.teal, P.terracotta] }), -0.3, back + 1.2, 0, ROOM * 1.25);
    put(props.floorLamp({ light: 16 }), side - 1.4, back + 2.6, 0, ROOM * 1.1);
    put(props.armchair({ color: P.terracotta, pillow: P.cream }), side - 1.5, 4.6, -Math.PI / 2 - 0.5, ROOM * 1.15);
    const tray = put(props.sideTable({ h: 0.45 }), -side + 1.5, 6.2);
    tray.add(props.snackBowl({ fill: 'popcorn' }).translateY(0.45));

    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      const g = new THREE.Group();
      g.position.copy(cellPos(cell));
      this.scene.add(g);
      this.cells.push(g);
      const ring = part(this.scene, torus(0.95, 0.06), '#ffffff', g.position.x, 0.1, g.position.z, { rx: Math.PI / 2, glow: 1.4, shadow: false, outline: false });
      ring.visible = false;
      this.rings.push(ring);
      this.paint(cell);
    }
    this.companions.forEach((c, seat) => {
      const home = this.state.homes[seat];
      if (!c || home === undefined) return;
      c.root.position.copy(cellPos(home)).setY(0.4);
      c.setBase('happy');
      this.scene.add(c.root);
    });
  }

  /**
   * Rebuilds a cushion: plain linen while it is free, its owner's colour in velvet with a bright piping once
   * claimed. Home corners are puffier and carry a glowing ring.
   */
  paint(cell: number): void {
    const g = this.cells[cell];
    if (!g) return;
    g.clear();
    const owner = this.state.owner[cell] ?? null;
    const home = owner !== null && this.state.homes[owner] === cell;
    const h = home ? 0.42 : 0.34;
    withOutline(0.04, () => {
      if (owner === null) {
        const tone = (cell + Math.floor(cell / SIZE)) % 2 ? FREE : mix(FREE, P.clay, 0.28);
        part(g, rbox(1.62, h, 1.62, 0.15), tone, 0, h / 2, 0, { tex: 'fabric', texStrength: 0.9 });
        part(g, rbox(1.66, 0.04, 1.66, 0.018), mix(tone, P.walnut, 0.35), 0, h / 2, 0, { outline: false });
        part(g, sphere(0.1, 12), mix(tone, P.walnut, 0.4), 0, h, 0, { sy: 0.35, outline: false });
        return;
      }
      const seat = this.colors[owner] ?? FREE;
      part(g, rbox(1.62, h, 1.62, 0.15), mix(seat, P.aubergine, 0.14), 0, h / 2, 0, { tex: 'velvet', texStrength: 0.8 });
      part(g, rbox(1.66, 0.045, 1.66, 0.02), seat, 0, h / 2, 0, { glow: 0.55, outline: false, shadow: false });
      if (home) {
        part(g, torus(0.5, 0.035), seat, 0, h + 0.012, 0, { rx: Math.PI / 2, glow: 1.3, outline: false, shadow: false });
        part(g, sphere(0.13, 12), P.cream, 0, h, 0, { sy: 0.4, outline: false });
      } else {
        part(g, sphere(0.1, 12), mix(seat, P.cream, 0.5), 0, h, 0, { sy: 0.35, outline: false });
      }
    });
  }

  highlight(cells: number[], color: string): void {
    this.rings.forEach((r, i) => {
      r.visible = cells.includes(i);
      r.material = material(color, { glow: 1.4 });
    });
  }

  /** A cushion changes hands: it flips colour, pops and sends out a ring of its new colour. */
  private flip(cell: number, color: string): void {
    this.paint(cell);
    this.bumps.set(cell, 0);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(torus(0.95, 0.05), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(cellPos(cell)).setY(0.2);
    this.scene.add(mesh);
    this.pulses.push({ mesh, mat, t: 0 });
  }

  claimed(cell: number, seat: number, captured: number[]): void {
    const color = this.colors[seat] ?? '#ffffff';
    this.flip(cell, color);
    // A captured pocket sweeps over, nearest cushion first.
    const at = cellPos(cell);
    [...captured]
      .sort((a, b) => cellPos(a).distanceTo(at) - cellPos(b).distanceTo(at))
      .forEach((c, i) => this.sweep.push({ cell: c, wait: 0.12 * (i + 1), color }));
    const comp = this.companions[seat];
    if (comp) {
      this.hops.push({ c: comp, from: comp.root.position.clone(), to: at.clone().setY(0.4), t: 0 });
      comp.react('happy', 1.2);
    }
    this.floaters.add(captured.length ? `+${1 + captured.length}!` : '+1', color, cellPos(cell).setY(1.9), 0.6);
  }

  update(dt: number, time = 0): void {
    this.fit.update(() => {
      const half = ((SIZE - 1) / 2) * GAP + 0.9;
      const marks: Mark[] = [
        { p: new THREE.Vector3(-half, 0, -half), pad: 0.05 },
        { p: new THREE.Vector3(half, 0, -half), pad: 0.05 },
        { p: new THREE.Vector3(-half, 0, half), pad: 0.05 },
        { p: new THREE.Vector3(half, 0, half), pad: 0.05 },
        { p: new THREE.Vector3(0, 2.4, -half), pad: 0.05 },
      ];
      return marks;
    });
    this.env.update(dt, time);
    for (const c of this.companions) c?.update(dt);
    for (let i = this.hops.length - 1; i >= 0; i--) {
      const h = this.hops[i] as (typeof this.hops)[number];
      h.t = Math.min(1, h.t + dt / 0.5);
      h.c.root.position.lerpVectors(h.from, h.to, h.t * h.t * (3 - 2 * h.t));
      h.c.root.position.y += Math.sin(h.t * Math.PI) * 1.2;
      if (h.t >= 1) {
        this.hops.splice(i, 1);
        this.lands.push({ c: h.c, t: 0 });
      }
    }
    // Landing: a squash that settles.
    for (let i = this.lands.length - 1; i >= 0; i--) {
      const l = this.lands[i] as (typeof this.lands)[number];
      l.t += dt / 0.3;
      const s = l.t >= 1 ? 0 : Math.sin(l.t * Math.PI) * (1 - l.t);
      l.c.root.scale.set(1 + s * 0.14, 1 - s * 0.22, 1 + s * 0.14);
      if (l.t >= 1) this.lands.splice(i, 1);
    }
    for (let i = this.sweep.length - 1; i >= 0; i--) {
      const s = this.sweep[i] as (typeof this.sweep)[number];
      s.wait -= dt;
      if (s.wait <= 0) {
        this.sweep.splice(i, 1);
        this.flip(s.cell, s.color);
      }
    }
    for (const [cell, t] of this.bumps) {
      const nt = t + dt;
      const g = this.cells[cell];
      const u = Math.min(1, nt / 0.5);
      // Up and over the size it should be, then a small dip, then still.
      const wobble = u >= 1 ? 0 : Math.exp(-4 * u) * Math.sin(u * 9);
      if (g) {
        g.scale.setScalar(1 + wobble * 0.26);
        g.position.y = Math.max(0, wobble) * 0.3;
      }
      if (u >= 1) this.bumps.delete(cell);
      else this.bumps.set(cell, nt);
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i] as (typeof this.pulses)[number];
      p.t += dt / 0.55;
      p.mesh.scale.setScalar(1 + p.t * 0.55);
      p.mat.opacity = Math.max(0, 1 - p.t);
      if (p.t >= 1) {
        p.mesh.removeFromParent();
        p.mat.dispose();
        this.pulses.splice(i, 1);
      }
    }
    const pulse = 1 + Math.sin(performance.now() / 160) * 0.06;
    for (const r of this.rings) if (r.visible) r.scale.setScalar(pulse);
    this.floaters.update(dt);
  }

  /**
   * Not `dispose`: the stage disposes a view when a minigame replaces it, but this board comes back after every
   * minigame. The mode calls destroy() when it ends.
   */
  destroy(): void {
    this.floaters.dispose();
    for (const p of this.pulses) p.mat.dispose();
    for (const c of this.companions) c?.dispose();
  }
}

// ------------------------------------------------------------------ the phone's grid

// The same colours as the room on the TV: the dark rug, linen cushions, cream lettering.
const GRID_BG = '#241b30';
const GRID_TEXT = P.cream;
const GRID_SUB = '#b3a6c2';
const GRID_W = 0.9;
const CELL_W = GRID_W / SIZE;
const CELL_H = CELL_W * (9 / 16); // the playfield is 9:16, so a square cell is shorter as a fraction of height
const GRID_TOP = 0.5 - (CELL_H * SIZE) / 2;

function gridScene(state: ClaimState, colors: string[], legal: number[], color: string, budget: number): SceneItem[] {
  const items: SceneItem[] = [
    { s: 'text', x: 0.5, y: 0.12, text: 'Claim a cushion', size: 0.075, fill: GRID_TEXT },
    { s: 'text', x: 0.5, y: 0.18, text: `${budget} claim${budget === 1 ? '' : 's'} left · rivals cost 2`, size: 0.045, fill: GRID_SUB, bold: false },
  ];
  for (let cell = 0; cell < SIZE * SIZE; cell++) {
    const owner = state.owner[cell] ?? null;
    const x = 0.05 + ((cell % SIZE) + 0.5) * CELL_W;
    const y = GRID_TOP + (Math.floor(cell / SIZE) + 0.5) * CELL_H;
    const ok = legal.includes(cell);
    items.push({ s: 'rect', x, y, w: CELL_W * 0.9, h: CELL_H * 0.9, radius: 0.025, fill: owner === null ? FREE : (colors[owner] ?? FREE), ...(ok ? { stroke: color, lw: 0.014 } : {}), alpha: ok ? 1 : owner !== null ? 0.9 : 0.4 });
    if (ok) items.push({ s: 'text', x, y, text: owner === null ? '+' : '2', size: 0.06, fill: owner === null ? GRID_BG : '#ffffff' });
  }
  items.push({ s: 'text', x: 0.5, y: GRID_TOP + CELL_H * SIZE + 0.07, text: 'Tap a glowing cushion', size: 0.05, fill: GRID_TEXT });
  return items;
}

function cellAt(x: number, y: number): number | null {
  const col = Math.floor((x - 0.05) / CELL_W);
  const row = Math.floor((y - GRID_TOP) / CELL_H);
  return col >= 0 && col < SIZE && row >= 0 && row < SIZE ? row * SIZE + col : null;
}

// ------------------------------------------------------------------ the mode

export async function runClaim(host: Host): Promise<void> {
  const { session, stage, ui, sfx, clock } = host.d;
  ui.hideHud();
  ui.meter(null);
  ui.prompts([
    { key: 'M', label: 'Mute' },
    { key: 'F', label: 'Full screen' },
  ]);
  const seats = session.seats.map((s) => s.index);
  const colors = session.seats.map((s) => s.color);
  const state = createClaim(seats.length, SIZE);
  const companions = await Promise.all(session.seats.map((s) => buildCompanion(s.look, { height: 1.3 }).catch(() => null)));
  const view = new ClaimView(state, colors, companions);
  const stream = new SceneStream(session);
  const showBoard = () => {
    stage.setView(view);
    ui.mode('board');
    const n = counts(state, seats.length);
    ui.live(session.seats.map((s) => ({ ...host.who(s.index), value: cushions(n[s.index] ?? 0) })));
  };
  showBoard();
  host.waitAll('Cushion Claim', 'Win minigames to claim cushions. Watch the big screen.');
  await ui.banner('Cushion Claim', 'Win minigames to claim cushions: 3 for first place, 2 for second, 1 for third. Most cushions after six rounds wins.', 4);

  /** Asks `seat` for a cushion: a tap on their phone, or a computer player's choice. */
  const pickCell = async (seat: number, budget: number, legal: number[]): Promise<number> => {
    const color = colors[seat] ?? '#ffffff';
    view.highlight(legal, color);
    ui.caption(`${session.seats[seat]?.name ?? '?'} claims a cushion (${budget} left)`, color);
    const fallback = () => cpuPick(state, seat, budget, host.rng, 0.6) ?? (legal[0] as number);
    if (session.isCpu(seat)) {
      await clock.wait(0.8);
      return fallback();
    }
    for (const s of seats) if (s !== seat) session.setLayout(s, { kind: 'wait', title: `${session.seats[seat]?.name ?? '?'} is claiming`, text: 'Watch the big screen.' });
    session.setLayout(seat, { kind: 'table', hint: `Claim a cushion (${budget} left)` });
    stream.send(seat, gridScene(state, colors, legal, color, budget), GRID_BG, true);
    return new Promise<number>((resolve) => {
      let done = false;
      const finish = (cell: number) => {
        if (done) return;
        done = true;
        off();
        resolve(cell);
      };
      const off = session.onInput((s, msg) => {
        if (s !== seat || msg.t !== 'touch' || msg.phase !== 'down') return;
        const cell = cellAt(msg.x, msg.y);
        if (cell !== null && legal.includes(cell)) finish(cell);
        else session.send(seat, { t: 'buzz', pattern: [30] });
      });
      // A phone that has gone quiet doesn't hold up the game.
      void clock.wait(20).then(() => finish(fallback()));
    });
  };

  const bag: Minigame[] = [];
  const draw = (): Minigame => {
    if (!bag.length) bag.push(...shuffle(host.rng, minigamesOfKind('ffa')));
    return bag.pop() as Minigame;
  };

  for (let round = 1; round <= ROUNDS; round++) {
    ui.round(round, ROUNDS);
    const game = draw();
    const { result, places } = await host.playMinigame(game);
    await host.showResults(game, result, places);
    showBoard();
    const order = [...seats].sort((a, b) => (places[a] ?? 4) - (places[b] ?? 4) || a - b);
    for (const seat of order) {
      let budget = claimsFor(places[seat] ?? 4);
      while (budget > 0) {
        const legal = legalCells(state, seat, budget);
        if (!legal.length) break;
        const cell = await pickCell(seat, budget, legal);
        const cost = claimCost(state, seat, cell) ?? 1;
        const stolen = state.owner[cell] !== null;
        const captured = claim(state, seat, cell);
        budget -= cost;
        view.claimed(cell, seat, captured);
        if (stolen) sfx.whoosh();
        tone(sfx, { freq: 520 + captured.length * 120, to: 780, dur: 0.18, type: 'triangle' });
        showBoard();
        await clock.wait(0.45);
      }
    }
    view.highlight([], '#ffffff');
    ui.caption(null);
    host.waitAll('Cushion Claim', 'Watch the big screen.');
    if (state.owner.every((o) => o !== null)) break;
    if (round < ROUNDS) await ui.banner(`Round ${round + 1} of ${ROUNDS}`, 'Next minigame coming up.', 1.8);
  }

  ui.round(null);
  ui.live(null);
  const totals = counts(state, seats.length);
  const places = ranks(totals);
  sfx.win();
  await host.finish({
    kicker: 'Cushion Claim',
    title: `${session.seats.filter((s) => places[s.index] === 1).map((s) => s.name).join(' & ')} ${places.filter((p) => p === 1).length > 1 ? 'win' : 'wins'}!`,
    rows: session.seats.map((s) => ({ ...host.who(s.index), seat: s.index, place: places[s.index] ?? 4, value: cushions(totals[s.index] ?? 0) })).sort((a, b) => a.place - b.place),
  });
  view.destroy();
}
