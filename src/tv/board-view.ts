// The board in 3D: floating islands at dusk (board/world.ts), enamel tiles (board/tiles.ts), the dice
// (board/dice.ts) and the players' Atelier companions, which come from Atelier's own runtime (companion/kit.ts).
// This file is the view itself: the tokens and how they move, the camera, and what the game asks to be shown.
import * as THREE from 'three';
import { lookKey } from '../../vendor/atelier-look/companionLogic';
import { type Companion, buildCompanion } from '../companion/kit';
import type { Board, Space } from '../game/board';
import { islandInfo } from '../shared/islands';
import type { CompanionLook } from '../shared/look';
import { type Clock, ease } from './anim';
import { DiceRoller } from './board/dice';
import { ISLAND_TOP, TILE_TOP, type Tile, buildTile } from './board/tiles';
import { type World, buildWorld, freeSide } from './board/world';
import type { GradeInput } from './render/post';
import { PALETTE as P, RENDER_HINTS, canvasTexture, cyl, gem, mix, nameCard, part, popSprite, rbox, sphere, withOutline } from './render/toon';
import type { View } from './stage';

/** How tall companions stand on the board, in scene units (a tile is 2.4 across). */
const COMPANION_HEIGHT = 1.9;

/**
 * A player on the board: a holder that the game moves, with their companion built into it (asynchronously).
 * A team is one token with both companions riding a little flying couch.
 */
interface Token {
  seat: number;
  object: THREE.Group;
  /** Holds the companions (and couch); squashes and stretches as the token hops. */
  body: THREE.Group;
  space: number;
  companions: Companion[];
  couch: THREE.Group | null;
  key: string;
  color: string;
  card: THREE.Sprite | null;
  spot: THREE.Mesh | null;
  /** Where the token is turning to face (radians). */
  facing: number;
  airborne: boolean;
  /** Spinning through the air (a crosswind): the view leaves its heading alone. */
  spinning: boolean;
}

/** A little flying couch for a team to ride on, in the team's colour, with a glow underneath. */
function couchProp(color: string): THREE.Group {
  const g = new THREE.Group();
  const fab = { tex: 'fabric', texStrength: 0.8 } as const;
  const main = mix(color, P.aubergine, 0.3);
  const dark = mix(color, P.aubergine, 0.5);
  const light = mix(color, P.cream, 0.2);
  part(g, rbox(2.3, 0.34, 1.0, 0.14), dark, 0, 0.32, 0, fab);
  part(g, rbox(2.3, 0.74, 0.28, 0.13), main, 0, 0.72, -0.4, fab);
  for (const x of [-1, 1]) part(g, rbox(0.3, 0.56, 1.0, 0.12), main, x * 1.12, 0.52, 0, fab);
  for (const x of [-0.5, 0.5]) part(g, rbox(0.94, 0.16, 0.72, 0.07), light, x, 0.53, 0.08, { ...fab, outline: false });
  for (const x of [-1, 1]) part(g, rbox(0.34, 0.34, 0.14, 0.06), P.cream, x * 0.78, 0.82, -0.2, { tex: 'knit', rz: x * -0.25, rx: -0.2, outline: false });
  // piping in the full team colour, and the hover light
  part(g, rbox(2.34, 0.05, 1.04, 0.02), color, 0, 0.16, 0, { exact: true, outline: false });
  for (const x of [-0.75, 0.75]) part(g, sphere(0.16, 12), color, x, 0.08, 0, { sy: 0.45, glow: 1.8, outline: false, shadow: false });
  for (const [x, z] of [[-0.95, -0.36], [0.95, -0.36], [-0.95, 0.36], [0.95, 0.36]] as const) part(g, cyl(0.07, 0.05, 0.14, 8), P.walnut, x, 0.1, z, { outline: false });
  return g;
}

let ringTex: THREE.Texture | null = null;
/** A soft ring, for the markers on the ground under players. */
function ringTexture(): THREE.Texture {
  ringTex ??= canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 20, 64, 64, 63);
    grad.addColorStop(0, 'rgba(255,255,255,0.0)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.12)');
    grad.addColorStop(0.74, 'rgba(255,255,255,1)');
    grad.addColorStop(0.86, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  return ringTex;
}

function groundRing(color: string, size: number): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const mat = new THREE.MeshBasicMaterial({ map: ringTexture(), color: new THREE.Color(color).multiplyScalar(1.25), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);
  mesh.renderOrder = 3;
  return mesh;
}

/** Sounds the dice make; the game passes its sound effects in so they stay in step with the picture. */
export interface DiceSounds {
  throw?: () => void;
  bounce?: (strength: number) => void;
  reveal?: () => void;
  bonus?: () => void;
}

const BOARD_PITCH = Math.atan2(0.74, 0.68);
const OVERVIEW = { distance: 78, target: new THREE.Vector3(0, 0, 1.2) };

function turnTowards(from: number, to: number, k: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * k;
}

export class BoardView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 600);
  grade: GradeInput = { base: 'golden', vignette: 0.3 };
  private world: World;
  private dice: DiceRoller;
  private tokens = new Map<number, Token>();
  private tiles = new Map<number, Tile>();
  private flags: THREE.Object3D[] = [];
  private arrows: { object: THREE.Group; baseY: number; space: number }[] = [];
  private popups: { sprite: THREE.Sprite; age: number; height: number }[] = [];
  private pathColor = new THREE.Color('#fff1d6');
  private activeRing = groundRing('#ffffff', 3.3);
  private activeSeat: number | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private tunedForSoftware = false;
  // camera: where it looks, from how far, and how steeply; each eased towards its goal
  private camTarget = OVERVIEW.target.clone();
  private camGoal = OVERVIEW.target.clone();
  private camDistance = OVERVIEW.distance;
  private camDistanceGoal = OVERVIEW.distance;
  private camPitch = BOARD_PITCH;
  private camPitchGoal = BOARD_PITCH;
  private followSeat: number | null = null;
  private followLift = 0.9;
  /** How quickly the camera eases to its goal (faster while the dice are thrown). */
  private camRate = 2.6;
  private debugCam: number[] | null = null;

  constructor(
    private readonly board: Board,
    private readonly clock: Clock,
  ) {
    this.world = buildWorld(this.scene, board);
    withOutline(0.05, () => this.buildTiles());
    this.dice = new DiceRoller(this.scene, clock);
    this.activeRing.visible = false;
    this.scene.add(this.activeRing);
    // `?bcam=x,y,z,tx,ty,tz` pins the camera, for looking closely at one corner of the board.
    const pin = new URLSearchParams(window.location.search).get('bcam');
    if (pin) {
      const v = pin.split(',').map(Number);
      if (v.length === 6 && v.every((n) => Number.isFinite(n))) this.debugCam = v;
    }
  }

  private buildTiles(): void {
    for (const s of this.board.spaces) {
      const dockColor = s.type === 'dock' && s.island ? islandInfo(s.island).color : undefined;
      const tile = buildTile(s.type, dockColor);
      tile.group.position.set(s.x, 0, s.z);
      if (dockColor) {
        // A pennant in the island's colour marks where orders are handed over, on the side the dice don't go.
        const side = freeSide(this.board, s).multiplyScalar(-1.75);
        part(tile.group, cyl(0.05, 0.065, 2.5, 8), P.ceramic, side.x, ISLAND_TOP + 1.25, side.z, { outline: 0.03 });
        part(tile.group, sphere(0.09, 8), P.brass, side.x, ISLAND_TOP + 2.54, side.z, { gloss: 0.6, outline: false });
        const flag = new THREE.Group();
        flag.position.set(side.x, ISLAND_TOP + 2.12, side.z);
        part(flag, rbox(0.95, 0.55, 0.04, 0.02), dockColor, 0.5, 0, 0, { outline: 0.03 });
        part(flag, rbox(0.3, 0.3, 0.05, 0.02), P.cream, 0.42, 0, 0, { outline: false });
        tile.group.add(flag);
        this.flags.push(flag);
      }
      this.scene.add(tile.group);
      this.tiles.set(s.id, tile);
    }
  }

  // ------------------------------------------------------------ companions

  /**
   * Makes the board's companions match the players: new seats get a holder at once and their companion as soon as
   * Atelier's runtime has built it; a changed look is rebuilt; seats that left are removed. Resolves when all are built.
   */
  async setPlayers(players: { seat: number; looks: CompanionLook[]; space: number; color?: string }[]): Promise<void> {
    const wanted = new Set(players.map((p) => p.seat));
    for (const t of [...this.tokens.values()]) {
      if (wanted.has(t.seat)) continue;
      for (const c of t.companions) c.dispose();
      this.scene.remove(t.object);
      this.tokens.delete(t.seat);
    }
    if (players.length === 0) {
      this.dice.clear();
      this.clearPath();
      this.hideForkArrows();
      this.activeSeat = null;
    }
    const builds: Promise<void>[] = [];
    for (const p of players) {
      let t = this.tokens.get(p.seat);
      if (!t) {
        const object = new THREE.Group();
        const body = new THREE.Group();
        object.add(body);
        t = { seat: p.seat, object, body, space: p.space, companions: [], couch: null, key: '', color: p.color ?? '#fff1d6', card: null, spot: null, facing: 0, airborne: false, spinning: false };
        this.scene.add(t.object);
        this.tokens.set(p.seat, t);
      }
      t.space = p.space;
      if (p.color) t.color = p.color;
      const key = p.looks.map(lookKey).join('|');
      if (key === t.key) continue;
      t.key = key;
      const token = t;
      const team = p.looks.length > 1;
      const height = team ? COMPANION_HEIGHT * 0.82 : COMPANION_HEIGHT;
      builds.push(
        Promise.all(p.looks.map((look) => buildCompanion(look, { height })))
          .then((built) => {
            // A newer look (or a removed seat) may have arrived while these were being built.
            if (token.key !== key || this.tokens.get(token.seat) !== token) return built.forEach((c) => c.dispose());
            for (const c of token.companions) c.dispose();
            token.couch?.removeFromParent();
            token.couch = team ? couchProp(p.color ?? '#c87a8a') : null;
            if (token.couch) token.body.add(token.couch);
            built.forEach((c, i) => {
              if (team) c.root.position.set((i - (built.length - 1) / 2) * 0.95, 0.44, 0.06);
              c.setBase(team ? 'happy' : 'idle');
              token.body.add(c.root);
            });
            token.companions = built;
          })
          .catch((err: unknown) => console.error('Could not build a companion', err)),
      );
    }
    this.layoutTokens();
    await Promise.all(builds);
  }

  /** The lobby: everyone's companion in a row on the terrace of the Snack Shack, facing the room, name above. */
  lineup(players: { seat: number; look: CompanionLook; name: string; color: string; ready: boolean }[]): void {
    void this.setPlayers(players.map((p) => ({ seat: p.seat, looks: [p.look], space: this.board.start, color: p.color })));
    const st = this.world.stage;
    players.forEach((p, i) => {
      const t = this.tokens.get(p.seat);
      if (!t) return;
      t.object.position.set(st.x + (i - 1.5) * 2.15, st.y, st.z);
      t.object.rotation.y = 0;
      t.facing = 0;
      if (t.card) t.object.remove(t.card);
      t.card = nameCard(p.ready ? `${p.name} ✓` : p.name, p.color, 0.95);
      t.card.position.y = COMPANION_HEIGHT + 0.55;
      t.object.add(t.card);
      // each player's spot on the stage: a ring of light in their colour
      if (!t.spot) {
        t.spot = groundRing(p.color, 2.5);
        t.spot.position.y = 0.05;
        t.object.add(t.spot);
      }
      (t.spot.material as THREE.MeshBasicMaterial).opacity = p.ready ? 0.95 : 0.5;
      for (const c of t.companions) c.setBase(p.ready ? 'happy' : 'idle');
    });
    this.followSeat = null;
    this.activeSeat = null;
    // The camera sits low, near eye height, and a little to the left so the lineup clears the lobby panel.
    this.lineupView = true;
    this.camGoal.set(st.x - 4.15, st.y + 1.6, st.z);
    this.camDistanceGoal = 13.2;
    this.camPitchGoal = 0.3;
  }

  private lineupView = false;

  /** Leaves the lobby: name cards go, everyone stands on the start. */
  endLineup(): void {
    this.lineupView = false;
    for (const t of this.tokens.values()) {
      if (t.card) t.object.remove(t.card);
      t.card = null;
      if (t.spot) t.object.remove(t.spot);
      t.spot = null;
      for (const c of t.companions) c.setBase(t.couch ? 'happy' : 'idle');
    }
    this.layoutTokens();
    this.overview();
  }

  private slotPosition(seat: number, spaceId: number): THREE.Vector3 {
    const s = this.board.spaces[spaceId] as Space;
    const here = [...this.tokens.values()].filter((t) => t.space === spaceId).map((t) => t.seat).sort();
    const pos = new THREE.Vector3(s.x, TILE_TOP, s.z);
    if (here.length > 1) {
      const i = here.indexOf(seat);
      const a = (i / here.length) * Math.PI * 2 + Math.PI / 4;
      pos.x += Math.cos(a) * 0.62;
      pos.z += Math.sin(a) * 0.62;
    }
    return pos;
  }

  private layoutTokens(): void {
    if (this.lineupView) return;
    for (const t of this.tokens.values()) if (!t.airborne) t.object.position.copy(this.slotPosition(t.seat, t.space));
  }

  /** Squash (k < 1) or stretch (k > 1) a token, keeping its volume roughly the same. */
  private squash(t: Token, k: number): void {
    const wide = 1 / Math.sqrt(k);
    t.body.scale.set(wide, k, wide);
  }

  /** The little bounce as a token touches down: squash, overshoot, settle. */
  private settle(t: Token, depth = 0.16): void {
    void this.clock.tween(0.24, (k) => {
      if (t.airborne) return;
      // 1 - depth at the start, a small overshoot, then 1
      const s = k < 0.35 ? 1 - depth * (1 - k / 0.35) : 1 + depth * 0.3 * Math.sin(((k - 0.35) / 0.65) * Math.PI);
      this.squash(t, s);
    }, ease.linear);
  }

  /** One step along the board: the companion gathers itself, leaps to the next tile in an arc and lands softly. */
  async hop(seat: number, to: number, duration = 0.46): Promise<void> {
    const t = this.tokens.get(seat);
    if (!t) return;
    const from = t.object.position.clone();
    t.space = to;
    const end = this.slotPosition(seat, to);
    const dist = from.distanceTo(end);
    t.facing = Math.atan2(end.x - from.x, end.z - from.z);
    const height = Math.min(1.5, 0.55 + dist * 0.09) * (duration < 0.3 ? 0.7 : 1);
    if (!t.couch) for (const c of t.companions) c.move('run', dist / duration);
    t.airborne = true;
    const tile = this.tiles.get(to);
    await this.clock.tween(duration, (k) => {
      // a short crouch, then the leap: quick off the ground, floating over the top, quick down
      const lift = Math.max(0, (k - 0.1) / 0.9);
      const e = lift * lift * (3 - 2 * lift);
      t.object.position.lerpVectors(from, end, e);
      const arc = Math.sin(lift * Math.PI);
      t.object.position.y += arc * height;
      this.squash(t, k < 0.1 ? 1 - 0.14 * (k / 0.1) : 0.86 + 0.14 * Math.min(1, (k - 0.1) / 0.12) + arc * 0.1);
      if (t.couch) t.body.rotation.x = Math.sin(lift * Math.PI * 2) * 0.1;
    }, ease.linear);
    t.airborne = false;
    t.body.rotation.x = 0;
    for (const c of t.companions) c.move(null);
    this.layoutTokens();
    this.settle(t);
    this.pulse(to);
    if (tile) tile.glowGoal = 0;
  }

  /** Moves a companion straight to a space through the air (crosswinds), spinning. */
  async fly(seat: number, to: number): Promise<void> {
    const t = this.tokens.get(seat);
    if (!t) return;
    const from = t.object.position.clone();
    t.space = to;
    const end = this.slotPosition(seat, to);
    for (const c of t.companions) c.react('approval', 1.4);
    t.airborne = true;
    t.spinning = true;
    const start = t.object.rotation.y;
    await this.clock.tween(1.15, (k) => {
      t.object.position.lerpVectors(from, end, k);
      t.object.position.y += Math.sin(k * Math.PI) * 6.5;
      t.object.rotation.y = start + k * Math.PI * 4;
      this.squash(t, 1 + Math.sin(k * Math.PI) * 0.12);
    });
    t.airborne = false;
    t.spinning = false;
    t.object.rotation.y = start;
    this.layoutTokens();
    this.settle(t, 0.22);
    this.pulse(to);
  }

  /** A cheer (deliveries, wins) or a sulk. */
  excite(seat: number, seconds = 1.6, mood: 'happy' | 'sad' | 'approval' = 'happy'): void {
    const t = this.tokens.get(seat);
    if (!t) return;
    for (const c of t.companions) c.react(mood, seconds);
    if (mood !== 'sad' && !t.airborne && !this.reducedMotion) {
      // a little jump for joy
      void this.clock.tween(0.42, (k) => {
        if (t.airborne) return;
        t.body.position.y = Math.sin(k * Math.PI) * 0.45;
        this.squash(t, 1 + Math.sin(k * Math.PI * 2) * 0.08);
      }, ease.linear).then(() => {
        t.body.position.y = 0;
      });
    }
  }

  /** Turns everyone to the camera (the end of the game). */
  faceCamera(): void {
    for (const t of this.tokens.values()) t.facing = 0;
  }

  popText(seat: number, text: string, color = '#FFFFFF'): void {
    const t = this.tokens.get(seat);
    if (!t) return;
    const height = 1.25;
    const sprite = popSprite(text, color, height);
    sprite.position.copy(t.object.position).add(new THREE.Vector3(0, COMPANION_HEIGHT + 1.0, 0));
    this.scene.add(sprite);
    this.popups.push({ sprite, age: 0, height });
  }

  private pulse(spaceId: number): void {
    const tile = this.tiles.get(spaceId);
    if (!tile) return;
    void this.clock.tween(0.3, (k) => {
      const s = Math.sin(k * Math.PI);
      tile.group.scale.set(1 + s * 0.06, 1 - s * 0.12, 1 + s * 0.06);
    }, ease.linear);
  }

  // ------------------------------------------------------------ the dice

  /**
   * Rolls the dice for a player: the companion throws them, the camera moves in, they tumble and settle on
   * `values`, then leap up and turn into the total above the player (with the bonus added on).
   */
  async rollDice(seat: number, values: number[], bonus: number, sounds: DiceSounds = {}): Promise<void> {
    const t = this.tokens.get(seat);
    if (!t) return;
    const s = this.board.spaces[t.space] as Space;
    const dir = freeSide(this.board, s);
    const centre = new THREE.Vector3(s.x, ISLAND_TOP, s.z);
    // Move in on the player and the spot where the dice will land.
    const follow = this.followSeat;
    this.followSeat = null;
    const back = { distance: this.camDistanceGoal, pitch: this.camPitchGoal };
    this.camGoal.copy(centre).addScaledVector(dir, 1.5).setY(ISLAND_TOP + 1.25);
    this.camDistanceGoal = values.length > 1 ? 15.5 : 14;
    this.camPitchGoal = 0.62;
    this.camRate = 5;
    // The companion turns to the throw and winds up...
    t.facing = Math.atan2(dir.x * 0.75, dir.z * 0.75 + 0.55);
    await this.clock.tween(0.26, (k) => this.squash(t, 1 - 0.2 * k), ease.outCubic);
    // ...and lets go.
    for (const c of t.companions) c.react('approval', 2.2);
    void this.clock.tween(0.3, (k) => this.squash(t, 0.8 + 0.2 * k + Math.sin(k * Math.PI) * 0.22), ease.outCubic);
    await this.dice.roll({
      origin: t.object.position.clone(),
      centre,
      dir,
      ground: ISLAND_TOP,
      reach: 1.45,
      values,
      bonus,
      color: t.color,
      head: t.object.position.clone().add(new THREE.Vector3(0, COMPANION_HEIGHT + 1.45, 0)),
      ...(sounds.throw ? { onThrow: sounds.throw } : {}),
      ...(sounds.bounce ? { onBounce: sounds.bounce } : {}),
      ...(sounds.bonus ? { onBonus: sounds.bonus } : {}),
      onReveal: () => {
        sounds.reveal?.();
        for (const c of t.companions) c.react('happy', 1.6);
      },
      onRest: () => {
        // ease back out a little while the faces are read
        this.camDistanceGoal += 1.5;
      },
    });
    this.camDistanceGoal = back.distance;
    this.camPitchGoal = back.pitch;
    this.camRate = 2.6;
    this.followSeat = follow;
  }

  // ------------------------------------------------------------ the way ahead

  /** Lights the tiles a player is about to cross, in order, in their colour. */
  showPath(spaces: number[], color = '#fff1d6'): void {
    this.clearPath();
    this.pathColor.set(mix(color, '#fff1d6', 0.45));
    spaces.forEach((id, i) => {
      const tile = this.tiles.get(id);
      if (!tile) return;
      tile.glowGoal = 1;
      tile.order = i;
    });
  }

  clearPath(): void {
    for (const tile of this.tiles.values()) tile.glowGoal = 0;
  }

  showForkArrows(options: number[], labels: string[]): void {
    this.hideForkArrows();
    options.forEach((id, i) => {
      const s = this.board.spaces[id] as Space;
      const arrow = new THREE.Group();
      // a slowly turning marker with the choice written above it
      const marker = new THREE.Group();
      withOutline(0.05, () => {
        part(marker, gem(0.72), P.mustard, 0, 0, 0, { sy: 1.45, glow: 0.85, gloss: 0.6, exact: true });
      });
      marker.name = 'marker';
      arrow.add(marker);
      const card = nameCard(labels[i] ?? '', P.mustard, 1);
      card.position.y = 1.9;
      arrow.add(card);
      const baseY = TILE_TOP + 2.9;
      arrow.position.set(s.x, baseY, s.z);
      this.arrows.push({ object: arrow, baseY, space: id });
      this.scene.add(arrow);
      const tile = this.tiles.get(id);
      if (tile) {
        tile.glowGoal = 1;
        tile.order = 0;
      }
    });
    this.pathColor.set(P.lamp);
  }

  hideForkArrows(): void {
    for (const a of this.arrows) {
      this.scene.remove(a.object);
      const tile = this.tiles.get(a.space);
      if (tile) tile.glowGoal = 0;
    }
    this.arrows = [];
  }

  // ------------------------------------------------------------ camera

  focusSeat(seat: number, distance = 26): void {
    const t = this.tokens.get(seat);
    if (!t) return;
    this.lineupView = false;
    this.camGoal.copy(t.object.position).setY(TILE_TOP + this.followLift);
    this.camDistanceGoal = distance;
    this.camPitchGoal = BOARD_PITCH;
    this.followSeat = seat;
    this.activeSeat = seat;
    (this.activeRing.material as THREE.MeshBasicMaterial).color.set(t.color).multiplyScalar(1.2);
  }

  overview(): void {
    this.lineupView = false;
    this.followSeat = null;
    this.activeSeat = null;
    this.camGoal.copy(OVERVIEW.target);
    this.camDistanceGoal = OVERVIEW.distance;
    this.camPitchGoal = BOARD_PITCH;
  }

  // ------------------------------------------------------------ per frame

  update(dt: number, time: number): void {
    if (!this.tunedForSoftware && !RENDER_HINTS.normalMaps) {
      // A software renderer: a smaller shadow map is plenty.
      this.tunedForSoftware = true;
      this.world.sun.shadow.mapSize.set(2048, 2048);
      this.world.sun.shadow.map?.dispose();
      this.world.sun.shadow.map = null;
    }
    this.world.update(dt, time);

    // camera
    if (this.followSeat !== null) {
      const t = this.tokens.get(this.followSeat);
      if (t) {
        // follow on the ground: the camera doesn't bob with every hop
        const s = this.board.spaces[t.space] as Space;
        this.camGoal.set(t.object.position.x, TILE_TOP + this.followLift, t.object.position.z);
        if (!t.airborne) this.camGoal.set(s.x, TILE_TOP + this.followLift, s.z);
      }
    }
    const k = 1 - Math.exp(-dt * this.camRate);
    this.camTarget.lerp(this.camGoal, k);
    this.camDistance += (this.camDistanceGoal - this.camDistance) * k;
    this.camPitch += (this.camPitchGoal - this.camPitch) * k;
    const sway = this.reducedMotion ? 0 : Math.sin(time * 0.15) * 0.035;
    const flat = Math.cos(this.camPitch) * this.camDistance;
    this.camera.position.set(this.camTarget.x + Math.sin(sway) * flat, this.camTarget.y + Math.sin(this.camPitch) * this.camDistance, this.camTarget.z + Math.cos(sway) * flat);
    this.camera.lookAt(this.camTarget);
    if (this.debugCam) {
      const [x, y, z, tx, ty, tz] = this.debugCam as [number, number, number, number, number, number];
      this.camera.position.set(x, y, z);
      this.camera.lookAt(tx, ty, tz);
    }

    // tokens
    const turn = 1 - Math.exp(-dt * 12);
    for (const t of this.tokens.values()) {
      for (const c of t.companions) c.update(dt);
      if (!t.spinning) t.object.rotation.y = turnTowards(t.object.rotation.y, t.facing, turn);
      // A team's couch floats and sways gently.
      if (t.couch) {
        t.couch.position.y = 0.2 + Math.sin(time * 2 + t.seat) * 0.07;
        t.couch.rotation.z = Math.sin(time * 1.3 + t.seat) * 0.035;
      }
    }
    // the ring under whoever's turn it is
    const active = this.activeSeat === null ? undefined : this.tokens.get(this.activeSeat);
    const ringMat = this.activeRing.material as THREE.MeshBasicMaterial;
    const want = active && !this.lineupView ? (active.airborne ? 0.2 : 0.7 + Math.sin(time * 3) * 0.12) : 0;
    ringMat.opacity += (want - ringMat.opacity) * (1 - Math.exp(-dt * 8));
    this.activeRing.visible = ringMat.opacity > 0.01;
    if (active) {
      const s = this.board.spaces[active.space] as Space;
      this.activeRing.position.set(active.airborne ? active.object.position.x : s.x, TILE_TOP + 0.03, active.airborne ? active.object.position.z : s.z);
      this.activeRing.scale.setScalar(active.couch ? 1.15 : 1);
    }

    // tiles on the way ahead: a soft ring of light with a pulse that travels along the path
    const ease8 = 1 - Math.exp(-dt * 7);
    for (const tile of this.tiles.values()) {
      if (tile.glowGoal === 0 && tile.glowNow < 0.005) {
        tile.glow.visible = false;
        tile.glowNow = 0;
        continue;
      }
      tile.glowNow += (tile.glowGoal - tile.glowNow) * ease8;
      tile.glow.visible = true;
      tile.glow.material.color.copy(this.pathColor);
      tile.glow.material.opacity = tile.glowNow * (0.5 + 0.3 * Math.sin(time * 4.5 - tile.order * 1.1));
    }

    for (const f of this.flags) f.rotation.y = Math.sin(time * 2.6 + f.id) * 0.3 + 0.2;
    for (const a of this.arrows) {
      a.object.position.y = a.baseY + Math.sin(time * 3.2) * 0.25;
      const marker = a.object.getObjectByName('marker');
      if (marker) marker.rotation.y = time * 1.6;
    }
    for (const p of [...this.popups]) {
      p.age += dt;
      // pop in with a little overshoot, drift up, fade
      const grow = Math.min(1, p.age / 0.16);
      const scale = grow < 1 ? ease.outBack(grow) : 1;
      p.sprite.scale.set((1024 / 112) * p.height * scale, p.height * scale, 1);
      p.sprite.position.y += dt * (p.age < 0.3 ? 2.4 : 1.1);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - Math.max(0, p.age - 0.9) / 0.55);
      if (p.age > 1.45) {
        this.scene.remove(p.sprite);
        p.sprite.material.map?.dispose();
        p.sprite.material.dispose();
        this.popups.splice(this.popups.indexOf(p), 1);
      }
    }
  }
}
