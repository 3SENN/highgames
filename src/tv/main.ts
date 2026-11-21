// The big screen: an Atelier app page (atelier-pack.json). Runs the whole game; phones only send input.
// URL options for playtesting: ?speed=3 (faster), ?demo=1 (CPU game), ?rounds=2, ?game=pump (one minigame).
import { loadCompanionConfig } from '../companion/config';
import { createBoard } from '../game/board';
import { Clock } from './anim';
import { reportState } from './atelier';
import { Sfx } from './audio';
import { BoardView } from './board-view';
import { Director } from './director';
import { TEXTURES, type TextureName, preloadTextures } from './render/textures';
import { TvNet } from './net';
import { Inputs, Session } from './session';
import { Stage } from './stage';
import { Ui } from './ui';

const params = new URLSearchParams(location.search);
const speed = Math.min(8, Math.max(0.25, Number(params.get('speed')) || 1));
const roundsParam = Number(params.get('rounds'));
const gameParam = params.get('game');
const only = gameParam && /^[a-z0-9-]{1,32}$/.test(gameParam) ? gameParam : null;

const clock = new Clock(speed);
const stage = new Stage(document.getElementById('stage') as HTMLCanvasElement, clock);
const board = createBoard();
const boardView = new BoardView(board, clock);
const ui = new Ui(clock);
// The interface's glass blurs the scene behind it: not on a software renderer or once the effects have stepped down.
const lite = () => document.documentElement.classList.toggle('lite', stage.software || stage.tier === 'low' || stage.tier === 'off');
lite();
setInterval(lite, 3000);
// ?uidebug=1 hands the interface to the console, to try its screens by hand.
if (params.get('uidebug') === '1') (window as unknown as { ui: Ui }).ui = ui;
const sfx = new Sfx();

// Phones join through Atelier's web server for this app. The handlers only run after net.start(), by which time
// `session` exists.
const net = new TvNet({
  sharing() {
    session.changed();
  },
  phoneJoin(id, name, token) {
    sfx.join();
    session.onPhoneJoin(id, name, token);
  },
  phoneLeave(id) {
    session.onPhoneLeave(id);
  },
  message(id, raw) {
    session.onMessage(id, raw);
  },
});
const session = new Session(net);
const inputs = new Inputs(session, speed);

// Sound needs one click or key press on the page; the bottom bar says so until then.
const unlock = () => {
  sfx.unlock();
  ui.soundOn();
};
addEventListener('pointerdown', unlock, { once: true });
addEventListener('keydown', (e) => {
  unlock();
  if (e.repeat) return;
  if (e.key === 'm' || e.key === 'M') ui.toast(sfx.toggleMute() ? 'Sound off' : 'Sound on');
  // Atelier lets a game go full screen without asking; Esc comes back.
  if (e.key === 'f' || e.key === 'F') void document.documentElement.requestFullscreen?.().catch(() => {});
});

stage.setView(boardView);
stage.start();
void net.start();

// The players are Atelier companions, drawn by the Atelier kit; Atelier's presets dress the computer players.
// Textures load in the background from the start (about 5 MB of the game's own files), so no scene shows untextured.
void preloadTextures(...(Object.keys(TEXTURES) as TextureName[])).catch(() => {});

loadCompanionConfig()
  .then((config) => {
    const director = new Director({
      session,
      inputs,
      stage,
      boardView,
      board,
      ui,
      sfx,
      clock,
      net,
      options: {
        demo: params.get('demo') === '1',
        rounds: Number.isInteger(roundsParam) && roundsParam > 0 ? Math.min(20, roundsParam) : null,
        only,
      },
      presets: config.presets,
    });
    void director.run();
  })
  .catch((err: unknown) => {
    console.error(err);
    reportState({ screen: 'error', error: 'kit' });
    void ui.banner('Companions missing', 'The Atelier kit didn’t load. Open Highgames from Atelier (kit 1), or run it with `npm run dev`.', 600);
  });
