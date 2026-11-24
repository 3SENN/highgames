# Highgames

A laid-back party game for 1 to 4 players on floating sky islands, made as an **Atelier game**: an app in an Atelier pack
(`atelier-pack.json`). It runs in an Atelier tab on the computer connected to the TV, and every player uses their own phone
as the controller: scan the QR code and you're in. Empty seats are played by computer players: first your own Atelier
companions, then Atelier's preset companions.

The *high* in Highgames is sky-high: every game takes place on little islands floating above the clouds.

Everyone plays as their own **Atelier companion**, drawn by the Atelier kit exactly as in Atelier, and **the phone works
differently in every minigame**: sometimes it's a button, sometimes you pump it, tilt it, hold it perfectly still, nod
along to a beat or keep a secret on it.

Highgames is open source, and made to learn from and to add to: it's a whole Atelier game, with phones as
controllers, companions as players and a few dozen minigames, each one two small files. Read how it works, or
[add a minigame of your own](#adding-a-minigame). Atelier is early, and built in the open with the people who use it:
say hi on [Discord](https://discord.gg/sKUTVCYAZY) or in [Atelier's Discussions](https://github.com/3SENN/atelier/discussions).

## Play

You need Atelier 1.4 or newer.

1. Install Highgames: open `highgames-<version>.atelierapp` (double-click it, or drop it on Atelier) and choose **Add** on
   the review card. It asks for two things: to use your companions as characters (names and looks), and to run a small
   web server that phones on your Wi-Fi can open. To try a build from this repository instead, see *Develop*.
2. Open **Highgames** (the Packs page, Workspace › Apps, or the command bar). Press **F** for full screen.
3. Each player scans the QR code with a phone on the same Wi-Fi. The first time, the phone warns about Atelier's
   certificate: choose to go on. Then type a name and tap **Join** (on an iPhone this also asks for motion).
   The first time on a Mac, macOS asks whether Atelier may accept incoming connections: choose **Allow**.
4. Dress up your companion on your phone, in an editor laid out and styled like Atelier's look editor: the tools pill
   (undo, redo, the four shuffle styles, presets), the eight category bubbles, the option card with stills of your
   companion wearing each option, the colours card and the fine-tuning sliders, with a live 3D preview. Everyone's
   companion appears on the big screen as they change it, and your phone remembers it for next time.
5. The first phone is the **host**: it picks the number of rounds, starts, and chooses the mode.
   The big screen works with the keyboard too.

While phones can join, Atelier shows its own bar over the game ("Highgames is sharing on your Wi-Fi") with **Stop**.
Stopping, or a long quiet spell in the lobby, ends sharing; press **S** in the lobby to share again (stopping from
the bar gives a new address, so phones scan again).

Keys on the big screen: **Enter** starts or picks, **arrows** move around menus, **Esc** goes back,
**D** starts a CPU-only game to watch, **C** picks which of your companions fill the empty seats (Atelier's own picker),
**S** shares again after sharing stopped, **M** mutes, **F** goes full screen. Click once anywhere so sound can play.

## Modes

| Mode | What it is |
|---|---|
| **Snack Run** 🍕 | The board game. Grab orders at the Snack Shack in the middle and float them to the island on the order. Every delivery earns **smiles**; most smiles after the last round wins. A minigame after every round. |
| **Tag Team Takeout** 🛋️ | Snack Run in two teams of two, each team sharing one couch. One of you rolls, the other makes the calls (paths, the corner store, orders), and you swap every turn. Team minigames come up more often. |
| **Don't Kill the Vibe** 🌙 | Co-op. Everyone keeps one house party going from 10 PM until sunrise. Every hour something happens, the group votes which room to go to, and that room's co-op minigame lifts the vibe as much as you pull it off. Your best night is remembered. |
| **Lo-Fi Session** 🎧 | The rhythm games back to back: nod, tap and strum with the beat. |
| **Sky Cup** 🏆 | Five random minigames (free-for-all, 2 vs 2 and 1 vs 3), points for every place. |
| **Cushion Claim** 🟪 | A living-room floor of 5×5 cushions, everyone starting in a corner. After each minigame you claim cushions by place (3 for first, 2 for second, 1 for third) on your phone: a free cushion next to yours costs 1, a rival's costs 2, and a small pocket you surround is yours. Most cushions after six rounds wins. |
| **Night Owl Marathon** 🦉 | Five games in a row, points for every place, and a Hall of Fame on this TV: the best marathons ever played on this couch. |
| **Free Play** 🎲 | Pick a category, then any minigame, as often as you like. |
| **Coffee Table** 📱 | The table games: lay your phones flat on the table, their screens are the playfield and the TV keeps score. |
| **Topsy-Turvy Challenges** 🌀 | Every minigame with a twist: the screen upside down, mirrored, in slow motion, or against wide-awake computer players. Win it (on your own, with your partner, or 80% together in co-op) to clear it. Progress is kept per host name on this computer. |

### On the board (Snack Run and Tag Team Takeout)

| Space | What happens |
|---|---|
| Blue **+3** | Gain 3 coins |
| Purple **−3** | A bummer: lose 3 coins (a Hoodie shrugs it off) |
| Yellow **?** | Something happens: couch-cushion coins, a big tipper, a seagull, a gust of wind that swaps two players… |
| Pink bag | The corner store: Energy Drink (+3 to a roll), Double Shot (roll two dice), Hoodie |
| Teal wind | A breeze carries you 2 spaces onward |
| Orange envelope | The Snack Shack: pick up an order (rush orders cost 5 coins and pay 2 smiles) |
| Flagged box | An island's dock: orders for that island are delivered here |

Roll by **shaking your phone** (or tapping the die). At a fork your phone shows where each path goes.
After the last round, bonus smiles go to the Game Night MVP (most minigames won), the Wanderer (most
spaces) and Rough Night (most bummers).

## Minigames

Eighteen minigames, and in each one the phone is something else:

| Minigame | Kind | The phone is… |
|---|---|---|
| **Thunder Snap** | everyone | a button: watch the TV and tap the moment lightning strikes. Reaction times are corrected for each phone's Wi-Fi delay. |
| **Balloon Pump** | everyone | a pump: move it up and down to fill your balloon, and watch the gauge *on your phone*, because past the red line it bursts. |
| **Donut Dash** | everyone | a paper plane: hold it flat and tilt to fly through floating donuts. |
| **Cloud Spotting** | everyone | a secret: it shows the cloud you lost, find it among look-alikes on the TV and tap its letter. |
| **Giggle Fit** | everyone | a straight face: a very serious documentary keeps going silly, and if your phone wobbles you crack up. A composure bar on the phone warns you. |
| **Cloud Catch** | everyone | a joystick: slide your bowl under the falling snacks and dodge the broccoli. |
| **Brain Freeze** | everyone | a straw: hold to slurp your slushie, let go before the freeze meter tops out. |
| **Beanbag Breakout** | everyone | a pump again, but now you're wiggling out of a beanbag that keeps swallowing you back. Mashing doesn't help. |
| **Where Are My Keys?** | everyone | six spot buttons coloured like the labels on the TV: remember where your keys went while the room gets messier and the cat moves things. |
| **Last Slice** | 1 vs 3 | a joystick and a **Nope!** button: three snackers sneak up on the last slice, one guard bumps them away. |
| **Pillow Fort** | 2 vs 2 | one big Pillow! button you take turns on with your partner. Rushing makes the fort wobble. |
| **Snack Pass** | 2 vs 2 | a hold button with a gold zone: wind up, let go in the gold, then catch your partner's toss as it lands. |
| **Snack Sort** | co-op | a Grab! button and a secret: only your phone knows which snacks on the belt are yours. |
| **Order Up** | co-op | a few topping buttons: everyone has different ones, so call out who has what to follow the ticket. |
| **Couch Tower** | co-op | a level: everyone stands on one wobbly furniture tower, and any wobble tips it towards your side. |
| **Head Nod** | rhythm | your head: nod the phone as each record lands. |
| **Snack Stack** | rhythm | a drum: tap on the beat to stack snacks on your plate. |
| **Mellow Strum** | rhythm | a ukulele: strum as each pick reaches the sound hole, and rest where there is none. |

"Everyone" games come up after board rounds and in the Sky Cup; 1 vs 3 and 2 vs 2 games now and
then on the board (the leader is the one in 1 vs 3) and often in Tag Team Takeout; co-op games are
the rooms in Don't Kill the Vibe; rhythm games make up the Lo-Fi Session. All of them are in Free
Play. The playtest ids are the file names in `src/tv/minigames/games/` (`?game=beanbag`).

Phones without motion sensors get a touch fallback wherever motion is used (tap to pump, drag to
steer, tap to nod).

## Develop

You need [Node.js](https://nodejs.org) 20.11 or newer, and the Atelier kit: an installed Atelier (the kit inside it is
used), or the atelier repository next to this one with its kit built
(`node scripts/kit/build.mjs` there).

```bash
npm install
npm run dev        # builds pack/ and keeps building it, and runs it in the Atelier emulator (see below)
npm run build      # builds pack/ once and checks it with Atelier's own pack rules
npm start          # runs the built pack in the Atelier emulator: http://127.0.0.1:8443
npm run check      # typecheck + lint + unit tests
npm run build && npm run e2e   # plays a whole mode in Chrome or Edge, saves screenshots
npm run build && npm run e2e:atelier   # installs and plays it in Atelier itself (atelier's build)
npm run package -- --key <key.pem>   # the signed .atelierapp to share (make a key once: -- --new-key <key.pem>)
```

**In Atelier:** Packs › Add › **Load a folder…** › `pack/`. Atelier runs the pack straight from the folder (developer
mode, no signature needed) and reloads the game whenever `npm run dev` rebuilds it.

**The Atelier emulator** (`scripts/atelier/emulator.mjs`) runs the built pack in any browser the way Atelier serves it: the
app's files with Atelier's app CSP, the kit at `/__atelier/kit/1/` with its import map, `window.atelier` (server, status,
test.ready, cast, log), and atelier.server's web server for phones (https on the Wi-Fi, an unguessable token in every
address, `__atelier/client.js`, the same limits on peers, message sizes and rates). It uses Atelier's preset companions as
your cast. `--atelier-server` (or `ATELIER_SERVER=1`) serves phones with Atelier's own server code from atelier instead of
the emulator's. It is not Atelier: there's no sandbox, review or partition, so try a change in Atelier before you ship it.

**Checks:** `npm run build` runs Atelier's own `validatePack` on `pack/` when atelier is next to this repository
(`npm run validate` runs it alone); without it, the build checks the rules Highgames relies on.

Playtest options on the big screen's address: `?speed=4` (everything faster), `?demo=1` (start a CPU game of Snack Run
at once), `?rounds=2`, `?game=<id>` (the board game only plays that minigame), `?fx=high|medium|low|off` (pin the
effects quality; by default it steps down by itself when the frame rate drops). `?env=livingRoom` (also `kitchen`,
`bedroom`, `backyard`, `beach`, `rooftop`, `props`, `textures`, with `&mood=day|golden|evening|night|neon`) previews
the environment and prop library.

The browser test picks a mode with `E2E_MODE` (0 = Snack Run … 9 = Topsy-Turvy Challenges, in menu order) and a
minigame with `E2E_GAME=<id>`, for example `E2E_MODE=2 npm run e2e`. Screenshots land in `test-results/e2e/`
(`E2E_OUT` names the folder). More options:
- `E2E_GPU=1` renders on the graphics card (faster, and the real look); the default is software rendering.
- `E2E_SECONDS` raises the time limit for long modes.
- `ATELIER_SERVER=1` serves the phone with Atelier's own server code.
- `E2E_PORT` and `E2E_PACK` (a pack built into another folder) let several runs work side by side.
- Without Chrome or Edge it uses Playwright's Chromium (`npx playwright install chromium`), or `E2E_BROWSER`.

`npm run e2e:atelier` runs the pack in Atelier itself: atelier's build (next to this repository or `ATELIER_DIR`, after
`npm run build` there) with a throwaway profile, so your own Atelier and its data are never touched. It loads `pack/`
through Atelier's own review and install (as Load a folder… does), opens the game, joins it with a phone browser at
the address Atelier's server gives the lobby and plays into the first minigame. A window of Atelier opens while it runs.

Environment variables: `PORT` (the emulator's big screen, default 8443) and `PHONE_PORT` (its web server for phones,
default the next port), `ATELIER_DIR` (the atelier repository) and `ATELIER_KIT_DIR` (a kit folder to use).

## How it works

```
 Atelier tab: the big screen (pack/app)              Phones (pack/app/phone, served by Atelier)
 ┌───────────────────────────────┐                ┌─────────────────────────┐
 │ Director  ── lobby, modes      │◀─── input ─────│ sensors: shake, pump,   │
 │ Host      ── minigames, menus  │── layouts ────▶│ tilt, nod, strum, wobble│
 │ src/game  ── rules (pure)      │                │ one screen per layout   │
 │ three.js  ── board, minigames  │                │ + the companion editor  │
 └──────▲────────────────────────┘                └───────────▲─────────────┘
        │ window.atelier.server                     __atelier/client.js │
        └────────── Atelier: a web server for the app on the Wi-Fi ──┘
                    (https, a token in every address, peer and rate checks)
```

- **Highgames is an Atelier app.** `atelier-pack.json` declares one app, `kind: "game"` (full screen and pointer lock without
  asking), `build: "bundled"` (Vite's output) on `kit: 1`, with a `cast` and `permissions.server.lan`. The build
  writes the pack to `pack/`: `app/` is the app's root (the big screen), `app/phone/` the controller page.
- **The kit comes from Atelier.** Atelier adds an import map to the game's page that points `three`, kit 1's three.js
  add-ons and `atelier-kit/character.js` at the kit it serves (`/__atelier/kit/1/`), so the game, the companion runtime
  and the companions' art are the ones Atelier ships, and the pack carries only the game's own code and art.
  `vite.kit.ts` lists what the builds leave to the kit; add-ons the kit doesn't serve are bundled.
- **Phones join through Atelier.** The big screen asks Atelier for a web server (`atelier.server.start({ lan: true, root:
  'app/phone' })`, in `src/tv/net.ts`): Atelier serves the controller page and the kit over https on the Wi-Fi, puts an
  unguessable token in every address, lets in only private networks, caps message sizes (16 KB in, 64 KB out) and
  rates, and gives the lobby the address and its QR code. The phone keeps one socket to the big screen with
  `__atelier/client.js` (`src/phone/net.ts`), which reconnects by itself. Without a Wi-Fi (or in Atelier's playtests) the
  server runs on this computer only, and the lobby says why.
- **The TV is authoritative.** It runs the rules and tells each phone what to show (a *layout*: roll, choose a path,
  a menu, hold, stick, big buttons, a beat…). Phones only send input, so a new minigame usually needs no phone code.
- **Modes are small scripts on top of a `Host`** (`src/tv/host.ts`): play a minigame (intro with everyone's Ready,
  countdown, twists, results), menus the host phone or the keyboard drives, votes everyone takes part in, and the
  final ranking. `src/tv/modes/` has the board game, the co-op party and the minigame series; `src/tv/director.ts`
  runs the lobby and the mode menu.
- **Minigames register themselves**: every file in `src/tv/minigames/games/` exports a `minigame` and is picked up
  automatically. Each declares its controller and kind (free-for-all, 1 vs 3, 2 vs 2, co-op, rhythm or table), and
  the modes choose from those. Shared helpers live next to them: `kit.ts` (camera framing, teams, sounds, phone
  playfields), `rhythm-kit.ts` and `table-kit.ts`.
- **Every phone message is untrusted**: a socket without a proper token in its query is closed, and `parsePhoneMsg` in
  `src/shared/protocol.ts` checks and clamps every message before the game sees it; looks are checked against Atelier's
  catalogue (`src/shared/look.ts`). Names are shown with `textContent` only. Atelier serves the game with its app CSP
  (no inline code but the page's own, nothing from the network) in the pack's own sandbox.
- **Rules are pure TypeScript** in `src/game/` (board, rules, CPU decisions, every minigame's scoring) with a seeded
  random generator, so they are unit tested without a browser.
- **Phones can drop out.** A phone is matched to its seat by a token, so reconnecting gives it back; while it's away
  the CPU plays that seat. A new phone can take over a CPU seat mid-game. Atelier keeps the server's port and token while
  it runs, so after the game reloads the phones find it again by themselves.
- **Atelier sees what's going on**: the game's tab and sidebar row say where it is (`atelier.status`: "Lobby · 3 players",
  the mode), and `atelier.test.ready` reports the screen for Atelier's playtests (`src/tv/atelier.ts`). Saves (the Hall of
  Fame, the best night, Challenges progress) stay in the pack's own storage on this computer.
- **The look: a cosy, late-night, lo-fi world built in code**, described in
  [docs/art-direction.md](docs/art-direction.md) (palette, lighting recipes, materials, composition and a
  checklist for polishing a minigame). `src/tv/render/` holds:
  - the stylised toon shading with thin tinted outlines (`toon.ts`);
  - 25 CC0 textures from Poly Haven (`public/textures/`, credited in `public/textures/CREDITS.md`);
  - a library of about 55 props and dressed environments with lighting recipes (`props.ts`, `env.ts`);
  - a post-processing pass (`post.ts`): ambient occlusion, bloom, colour grades, vignette. It scales down by itself
    on slow or software-rendered screens.

  Sounds are Web Audio synthesis, and nothing is fetched from the internet, so the game works on a network without it.
- **The interface** is dark translucent glass with warm accents, shared by the TV and the phones:
  - on the TV: compact pills in the corners, a clock pill for the timer, and a podium at the end;
  - on the phones: controls that feel physical, with a 3D die to roll.

  Players appear as their companion's head and name, with no frame or background.

### Atelier companions

The companions are Atelier's: the kit's runtime (`atelier-kit/character.js`) builds them from the kit's art, so a companion
looks and moves exactly as it does in Atelier (`src/companion/`: building, head portraits, shuffling). On the big
screen the kit is served in the pack's own origin; on phones it's served by the game's web server, below its token
(`src/companion/kit-base.ts`). Kit 1's runtime loads its art from the site's root (`/__atelier/kit/1/companion/`),
which a token address doesn't serve, so the phone page routes those requests below the token
(`src/phone/kit-paths.ts`); it does nothing once the kit asks relative to its own address.

`node scripts/sync-atelier.mjs` copies Atelier's look contract (`src/shared/companion.ts` and `companionLogic.ts`) from the
atelier repository next to this one (or `ATELIER_DIR`, or a path argument) into `vendor/atelier-look/`, for checking
looks and the phone's editor, and checks kit 1 still serves the add-ons the build leaves to it. `vendor/ATELIER_VERSION`
records the Atelier commit; don't edit the copies. three.js is pinned to the version in the kit (0.186.1, checked when
the emulator starts): upgrade them together.

```
atelier-pack.json  the pack's manifest (the build adds package.json's version)
src/
  shared/     game protocol + validators, joining, companion looks, islands, items, clouds
  game/       board graph, rules, CPU, minigame logic (no DOM)
  companion/  Atelier companions in our scenes: config, the kit's address, building, portraits, shuffle
  tv/         the app page: atelier.ts (window.atelier), net.ts (atelier.server), director, host, modes/, session,
              board view, render/, UI, audio, minigames/ (types, registry, rhythm kit, games/)
  phone/      the controller page (index.html): join, connection, sensors, companion editor + 3D preview,
              controller screens, kit-paths.ts
  types/      window.atelier, atelierServer and the kit's modules
  assets/     the icon and Inter (its SIL Open Font License ships in public/licenses/)
vendor/       Atelier's look contract (synced, not edited)
public/       the textures and licences, copied into the app
scripts/      sync-atelier.mjs; atelier/: build, the emulator, validation, packaging, finding the kit
test/         unit tests (vitest) and e2e/smoke.mjs (browser test)
```

### Adding a minigame

1. Put its rules and scoring in `src/game/minigames/<id>.ts` and test them in `test/`.
2. Add `src/tv/minigames/games/<id>.ts` exporting `minigame: Minigame`: an id, title, how-to text,
   controller and kind, and `play(ctx)`, which builds a three.js `View`, runs the game and resolves
   with a score per seat (or, for co-op, how well the group did). It shows up in every mode that
   plays its kind, and in Free Play.
3. Only if the phone needs a new kind of controller: add a `Layout` variant in
   `src/shared/protocol.ts` and a screen for it in `src/phone/controllers.ts`.

## Licence

- **Code:** the [MIT License](LICENSE).
- **Copied from Atelier:** the files in `vendor/` stay under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/),
  as in [Atelier](https://github.com/3SENN/atelier).
- **Textures:** CC0, from Poly Haven ([public/textures/CREDITS.md](public/textures/CREDITS.md)). **Inter:** the SIL Open
  Font License (`public/licenses/`).
- **Companions:** the game draws them with the Atelier kit inside Atelier, under the
  [Atelier Companion Art License](https://github.com/3SENN/atelier/blob/main/ART-LICENSE.md). Atelier and its characters
  are trademarks; see [TRADEMARKS.md](https://github.com/3SENN/atelier/blob/main/TRADEMARKS.md).
