// The modes on the main menu, in order.
import type { Host } from '../host';
import { BoardGame } from './board-game';
import { runClaim } from './claim';
import { runChallenges, runCoffeeTable, runCup, runFreePlay, runLofi, runMarathon } from './series';
import { runVibe } from './vibe';

export interface ModeDef {
  id: string;
  title: string;
  sub: string;
  tag: string;
  icon: string;
  run(host: Host, rounds: number): Promise<void>;
}

export const MODES: readonly ModeDef[] = [
  {
    id: 'snackrun',
    title: 'Snack Run',
    sub: 'Grab orders at the Snack Shack and float them across the islands. Most smiles wins.',
    tag: '1–4 players',
    icon: '🍕',
    run: (host, rounds) =>
      new BoardGame(host, { teams: false, rounds, title: 'Snack Run', intro: 'Grab snack orders at the Snack Shack and float them to the islands. Most smiles wins!' }).run(),
  },
  {
    id: 'tagteam',
    title: 'Tag Team Takeout',
    sub: 'Two teams of two on one couch each: one rolls, the other makes the calls.',
    tag: '2 vs 2',
    icon: '🛋️',
    run: (host, rounds) =>
      new BoardGame(host, {
        teams: true,
        rounds,
        title: 'Tag Team Takeout',
        intro: 'Two teams, two couches. One of you rolls, the other picks the way. Share everything. Most smiles wins!',
      }).run(),
  },
  {
    id: 'vibe',
    title: "Don't Kill the Vibe",
    sub: 'Everyone together: keep the party going until sunrise.',
    tag: 'Co-op',
    icon: '🌙',
    run: (host) => runVibe(host),
  },
  {
    id: 'lofi',
    title: 'Lo-Fi Session',
    sub: 'Rhythm games back to back. Nod, tap and strum with the beat.',
    tag: 'Rhythm',
    icon: '🎧',
    run: (host) => runLofi(host),
  },
  {
    id: 'cup',
    title: 'Munchie Cup',
    sub: 'Five random minigames, points for every place.',
    tag: 'Minigames',
    icon: '🏆',
    run: (host) => runCup(host),
  },
  {
    id: 'claim',
    title: 'Cushion Claim',
    sub: 'Win minigames, claim cushions, take over the living room floor.',
    tag: 'Territory',
    icon: '🟪',
    run: (host) => runClaim(host),
  },
  {
    id: 'marathon',
    title: 'Night Owl Marathon',
    sub: 'Five games in a row. Beat the couch record in the Hall of Fame.',
    tag: 'Records',
    icon: '🦉',
    run: (host) => runMarathon(host),
  },
  {
    id: 'freeplay',
    title: 'Free Play',
    sub: 'Pick any minigame and play it as often as you like.',
    tag: 'Minigames',
    icon: '🎲',
    run: (host) => runFreePlay(host),
  },
  {
    id: 'coffeetable',
    title: 'Coffee Table',
    sub: 'Lay your phones on the table: the screens are the playfield.',
    tag: 'Table games',
    icon: '📱',
    run: (host) => runCoffeeTable(host),
  },
  {
    id: 'challenges',
    title: 'Spaced-Out Challenges',
    sub: 'Every minigame with a twist. Clear them all and keep your record.',
    tag: 'Solo',
    icon: '🌀',
    run: (host) => runChallenges(host),
  },
];
