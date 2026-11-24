// Modes made of minigames played back to back or picked from a list: Sky Cup, Lo-Fi Session, Night Owl
// Marathon, Free Play, Coffee Table and Topsy-Turvy Challenges.
import { ranks } from '../../game/rules';
import { shuffle } from '../../game/rng';
import { type Host, TWISTS, type Twist } from '../host';
import { MINIGAMES, minigamesOfKind } from '../minigames';
import type { Minigame, MinigameKind } from '../minigames/types';
import type { MenuItem } from '../ui';
import { type BackdropTheme, showBackdrop } from './backdrop';

const PLACE_POINTS = [4, 3, 2, 1];

export const KIND_TAGS: Record<MinigameKind, string> = { ffa: 'Everyone', '1v3': '1 vs 3', '2v2': '2 vs 2', coop: 'Together', rhythm: 'Rhythm', table: 'On the table' };
export const CONTROLLER_ICONS: Record<string, string> = {
  tap: '👆',
  pump: '↕️',
  tilt: '✈️',
  secret: '🤫',
  still: '🧘',
  hold: '👇',
  stick: '🕹️',
  buttons: '🔘',
  rhythm: '🎵',
  swipe: '👉',
  aim: '🎯',
  spin: '🌀',
  slider: '🎚️',
  draw: '✏️',
  number: '🔢',
  table: '📱',
};

/** The categories that long lists of minigames are split into. */
const SHELVES: { kind: MinigameKind; title: string; sub: string; icon: string }[] = [
  { kind: 'ffa', title: 'Everyone for themselves', sub: 'Four players, one winner', icon: '🍿' },
  { kind: '1v3', title: 'One against three', sub: 'One player takes on the other three', icon: '🦸' },
  { kind: '2v2', title: 'Two against two', sub: 'Team up with a partner', icon: '🛋️' },
  { kind: 'coop', title: 'All together', sub: 'Everyone on the same side', icon: '🤝' },
  { kind: 'rhythm', title: 'Rhythm', sub: 'Move with the beat', icon: '🎧' },
  { kind: 'table', title: 'On the coffee table', sub: 'Phones flat on the table', icon: '📱' },
];

function prepare(host: Host): void {
  const { ui } = host.d;
  ui.hideHud();
  ui.meter(null);
  ui.prompts([
    { key: 'M', label: 'Mute' },
    { key: 'F', label: 'Full screen' },
  ]);
}

/** Between games: the mode's own calm backdrop behind the menu or the standings. */
function toMenu(host: Host, theme: BackdropTheme): void {
  showBackdrop(host, theme);
  host.d.ui.mode('board');
}

/**
 * A category, then a game in it. Resolves with the game, or null for "back". With one category there is no
 * category step. `tag` labels each category (e.g. progress).
 */
async function pickGame(host: Host, opts: { kicker: string; games: Minigame[]; item: (g: Minigame) => MenuItem; tag?: (kind: MinigameKind) => string | undefined; note?: string }): Promise<Minigame | null> {
  const shelves = SHELVES.filter((s) => opts.games.some((g) => g.kind === s.kind));
  for (;;) {
    let shelf = shelves[0];
    if (shelves.length > 1) {
      const si = await host.menu({
        kicker: opts.kicker,
        title: 'Pick a category',
        items: shelves.map((s) => ({ title: s.title, sub: `${s.sub} · ${opts.games.filter((g) => g.kind === s.kind).length} minigames`, icon: s.icon, tag: opts.tag?.(s.kind) })),
        ...(opts.note ? { note: opts.note } : {}),
        back: 'Back to the modes',
      });
      if (si < 0) return null;
      shelf = shelves[si];
    }
    if (!shelf) return null;
    const list = opts.games.filter((g) => g.kind === shelf.kind);
    const gi = await host.menu({ kicker: opts.kicker, title: shelf.title, items: list.map(opts.item), back: shelves.length > 1 ? 'Back to the categories' : 'Back to the modes' });
    if (gi >= 0) return list[gi] ?? null;
    if (shelves.length <= 1) return null;
  }
}

/** Plays games one after another, points by place, standings in between. Returns everyone's total. */
async function playSeries(host: Host, games: Minigame[], theme: BackdropTheme): Promise<number[]> {
  const { session, ui } = host.d;
  prepare(host);
  const totals = session.seats.map(() => 0);
  for (let i = 0; i < games.length; i++) {
    const game = games[i] as Minigame;
    ui.round(i + 1, games.length);
    const { result, places } = await host.playMinigame(game);
    places.forEach((p, seat) => (totals[seat] = (totals[seat] ?? 0) + (PLACE_POINTS[p - 1] ?? 0)));
    await host.showResults(game, result, places, places.map((p) => PLACE_POINTS[p - 1] ?? 0));
    if (i < games.length - 1) {
      toMenu(host, theme);
      await ui.banner(`After ${i + 1} of ${games.length}`, session.seats.map((s) => `${s.name} ${totals[s.index]}`).join(' · '), 2.6);
    }
  }
  ui.round(null);
  return totals;
}

async function finishSeries(host: Host, kicker: string, totals: number[]): Promise<void> {
  const { session } = host.d;
  const places = ranks(totals);
  host.d.sfx.win();
  await host.finish({
    kicker,
    title: `${session.seats.filter((s) => places[s.index] === 1).map((s) => s.name).join(' & ')} ${places.filter((p) => p === 1).length > 1 ? 'win' : 'wins'}!`,
    rows: session.seats
      .map((s) => ({ ...host.who(s.index), seat: s.index, place: places[s.index] ?? 4, value: `${totals[s.index]} points` }))
      .sort((a, b) => a.place - b.place),
  });
}

export async function runCup(host: Host): Promise<void> {
  const pool = minigamesOfKind('ffa', '2v2', '1v3');
  const games = shuffle(host.rng, pool.length ? pool : [...MINIGAMES]).slice(0, 5);
  showBackdrop(host, 'kitchen');
  await finishSeries(host, 'Sky Cup', await playSeries(host, games, 'kitchen'));
}

export async function runLofi(host: Host): Promise<void> {
  const rhythm = minigamesOfKind('rhythm');
  if (rhythm.length === 0) {
    await host.d.ui.banner('The band is still warming up', 'No rhythm games are installed yet.', 3);
    return;
  }
  showBackdrop(host, 'lofi');
  await host.d.ui.banner('Lo-Fi Session', 'Grab a seat, find the beat. Every song is a round; the best groove wins.', 3);
  const songs = shuffle(host.rng, rhythm).slice(0, 5);
  await finishSeries(host, 'Lo-Fi Session', await playSeries(host, songs, 'lofi'));
}

// ------------------------------------------------------------------ Night Owl Marathon

interface FameEntry {
  name: string;
  points: number;
  date: string;
}

const FAME_KEY = 'highgames-marathon';
const FAME_SIZE = 10;

function loadFame(): FameEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAME_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((e): e is FameEntry => !!e && typeof e === 'object' && typeof (e as FameEntry).name === 'string' && typeof (e as FameEntry).points === 'number').slice(0, FAME_SIZE)
      : [];
  } catch {
    return [];
  }
}

function saveFame(list: FameEntry[]): void {
  try {
    localStorage.setItem(FAME_KEY, JSON.stringify(list.slice(0, FAME_SIZE)));
  } catch {
    // Storage blocked: the hall of fame lasts for this visit only.
  }
}

/**
 * Five random minigames (everyone for themselves, and rhythm), points by place, and a hall of fame kept on this TV:
 * the best marathons ever played on this couch, by name.
 */
export async function runMarathon(host: Host): Promise<void> {
  const { session, ui, sfx } = host.d;
  const before = loadFame();
  showBackdrop(host, 'rooftop');
  await ui.banner('Night Owl Marathon', before[0] ? `Five games in a row. The couch record: ${before[0].points} points by ${before[0].name}.` : 'Five games in a row. Set the first couch record!', 3);
  const pool = minigamesOfKind('ffa', 'rhythm');
  const games = shuffle(host.rng, pool.length ? pool : [...MINIGAMES]).slice(0, 5);
  const totals = await playSeries(host, games, 'rooftop');

  // Into the hall of fame: real players only (computer players don't get to brag).
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const fame = [...before];
  const news: string[] = [];
  for (const s of session.seats) {
    if (session.isCpu(s.index)) continue;
    const points = totals[s.index] ?? 0;
    const best = fame.filter((e) => e.name === s.name).reduce((m, e) => Math.max(m, e.points), -1);
    fame.push({ name: s.name, points, date });
    if (before.length === 0 || points > (before[0]?.points ?? -1)) news.push(`${s.name} set a new couch record!`);
    else if (best >= 0 && points > best) news.push(`A new personal best for ${s.name}.`);
  }
  fame.sort((a, b) => b.points - a.points);
  const top = fame.slice(0, FAME_SIZE);
  saveFame(top);
  if (news.length) {
    sfx.win();
    await ui.banner('Hall of Fame', news.join(' '), 3);
  }
  toMenu(host, 'rooftop');
  await host.menu({
    kicker: 'Night Owl Marathon',
    title: 'Hall of Fame',
    items: top.length
      ? top.map((e, i) => ({ title: `${i + 1}. ${e.name}`, sub: `${e.points} points · ${e.date}`, icon: i === 0 ? '🏆' : '🌙' }))
      : [{ title: 'Nobody yet', sub: 'Play with a phone to get on the list', icon: '🌙' }],
    note: 'The best marathons on this TV. Pick any line to continue.',
  });
  await finishSeries(host, 'Night Owl Marathon', totals);
}

// ------------------------------------------------------------------ Free Play and Coffee Table

/** Pick any minigame; back to the list after each one. */
export async function runFreePlay(host: Host): Promise<void> {
  const { ui } = host.d;
  prepare(host);
  for (;;) {
    toMenu(host, 'lounge');
    const game = await pickGame(host, {
      kicker: 'Free Play',
      games: [...MINIGAMES],
      item: (m) => ({ title: m.title, sub: m.how, tag: KIND_TAGS[m.kind], icon: CONTROLLER_ICONS[m.controller] }),
    });
    if (!game) return;
    const { result, places } = await host.playMinigame(game);
    if (game.kind === 'coop' && result.coop !== undefined) {
      await ui.banner('Together', `${Math.round(result.coop * 100)}% as a group`, 2.6);
    }
    await host.showResults(game, result, places);
  }
}

/** The table games: phones flat on the coffee table are the playfield, the TV keeps score. */
export async function runCoffeeTable(host: Host): Promise<void> {
  const { ui } = host.d;
  prepare(host);
  const games = minigamesOfKind('table');
  if (games.length === 0) {
    await ui.banner('Coffee Table', 'No table games are installed yet.', 3);
    return;
  }
  showBackdrop(host, 'table');
  await ui.banner('Coffee Table', 'Clear a spot on the table. Your phones are the playfield; the big screen keeps score.', 3);
  for (;;) {
    toMenu(host, 'table');
    const game = await pickGame(host, {
      kicker: 'Coffee Table',
      games,
      item: (m) => ({ title: m.title, sub: m.how, icon: CONTROLLER_ICONS[m.controller] }),
    });
    if (!game) return;
    const { result, places } = await host.playMinigame(game);
    await host.showResults(game, result, places);
  }
}

// ------------------------------------------------------------------ Topsy-Turvy Challenges

interface Challenge {
  game: Minigame;
  twist: Twist;
}

const PROGRESS_KEY = 'highgames-challenges';

function loadProgress(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, string[]>;
  } catch {
    return {};
  }
}

function saveProgress(p: Record<string, string[]>): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: progress lasts for this visit only.
  }
}

/** Twists that make sense per kind: slow motion would put a rhythm game off the beat; sharp CPUs help a co-op team. */
const TWISTS_FOR: Record<MinigameKind, Twist[]> = {
  ffa: ['sharp', 'slowmo', 'flipped', 'mirror'],
  '1v3': ['sharp', 'slowmo', 'flipped', 'mirror'],
  '2v2': ['sharp', 'slowmo', 'flipped', 'mirror'],
  coop: ['slowmo', 'flipped', 'mirror'],
  rhythm: ['sharp', 'flipped', 'mirror'],
  table: [],
};

/** Hand-picked twists for the first games; the rest follow from the id, so adding games never moves the others'. */
const PICKED: Record<string, Twist> = {
  thunder: 'slowmo',
  pump: 'sharp',
  glider: 'mirror',
  spotter: 'flipped',
  giggle: 'sharp',
  cloudcatch: 'mirror',
  brainfreeze: 'slowmo',
  beanbag: 'sharp',
  keys: 'flipped',
  laundryfold: 'sharp', // mirror world would flip its fold arrows
};

function twistOf(game: Minigame): Twist {
  const allowed = TWISTS_FOR[game.kind];
  const picked = PICKED[game.id];
  if (picked && allowed.includes(picked)) return picked;
  return allowed[[...game.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % allowed.length] as Twist;
}

const CLEAR_HOW: Record<MinigameKind, string> = {
  ffa: 'Finish first',
  '1v3': 'Win on your own against three',
  '2v2': 'Win with your partner',
  coop: 'Score 80% or more together',
  rhythm: 'Finish first',
  table: '',
};

/** The host takes on every minigame with a twist. Progress is kept per name on this TV. */
export async function runChallenges(host: Host): Promise<void> {
  const { session, ui } = host.d;
  prepare(host);
  const challenges: Challenge[] = MINIGAMES.filter((g) => g.kind !== 'table').map((game) => ({ game, twist: twistOf(game) }));
  const keyOf = (c: Challenge) => `${c.game.id}:${c.twist}`;
  for (;;) {
    toMenu(host, 'lounge');
    const name = session.host()?.name ?? 'Guest';
    const progress = loadProgress();
    const cleared = new Set(progress[name] ?? []);
    const byGame = new Map(challenges.map((c) => [c.game, c] as const));
    const game = await pickGame(host, {
      kicker: `Topsy-Turvy Challenges · ${name}: ${challenges.filter((c) => cleared.has(keyOf(c))).length} of ${challenges.length} cleared`,
      games: challenges.map((c) => c.game),
      item: (g) => {
        const c = byGame.get(g) as Challenge;
        return { title: g.title, sub: `${TWISTS[c.twist].label}: ${TWISTS[c.twist].text} ${CLEAR_HOW[g.kind]} to clear it.`, tag: cleared.has(keyOf(c)) ? 'Cleared ✓' : undefined, icon: CONTROLLER_ICONS[g.controller] };
      },
      tag: (kind) => {
        const of = challenges.filter((c) => c.game.kind === kind);
        return `${of.filter((c) => cleared.has(keyOf(c))).length}/${of.length}`;
      },
      note: 'Every minigame with a twist. Clear them all.',
    });
    if (!game) return;
    const c = byGame.get(game) as Challenge;
    const seat = session.host()?.index ?? 0;
    const others = host.seats().filter((s) => s !== seat);
    // Team games: the host is the one against three, or teams up with the next seat.
    const teams = game.kind === '1v3' ? [[seat], others] : game.kind === '2v2' ? [[seat, others[0] as number], others.slice(1)] : undefined;
    // Wide-awake computer players make a challenge harder, except in co-op, where they're your teammates.
    const { result, places } = await host.playMinigame(game, { twist: c.twist, skillBoost: game.kind === 'coop' ? 0 : 0.3, ...(teams ? { teams } : {}) });
    await host.showResults(game, result, places);
    const won = game.kind === 'coop' ? (result.coop ?? 0) >= 0.8 : places[seat] === 1;
    if (won) {
      cleared.add(keyOf(c));
      progress[name] = [...cleared];
      saveProgress(progress);
      host.d.sfx.win();
      await ui.banner('Challenge cleared!', `${game.title} · ${TWISTS[c.twist].label}`, 2.6);
    } else {
      await ui.banner('Not this time', 'Shake it off and try again.', 2.2);
    }
  }
}
