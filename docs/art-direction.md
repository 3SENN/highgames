# Highgames art direction

The look in one line: **a cosy, late-night, lo-fi living room, built in code.** Stylised toon-leaning 3D, deep
warm colours, soft lamps, dusk and night skies, things that glow. Grown-up, not candy. No drug imagery.

Everything here lives in `src/tv/render/`. You build scenes with these modules; you don't edit them.

| Module | What it gives you |
|---|---|
| `toon.ts` | `part()`, shapes, `PALETTE`, `SKIES`, `applySky()`, labels (`nameCard`, `popSprite`), the toon material |
| `textures.ts` | The CC0 texture library (`{ tex: 'woodFloor' }` in part options) |
| `props.ts` | Furniture, lamps, plants, kitchen and garden things, water, clouds |
| `env.ts` | Lighting recipes (`lightRig`) and whole dressed spaces (`livingRoom`, `kitchen`, `backyard`…) |
| `post.ts` | Colour grades (`GRADES`), applied by the stage |

**See it before you build it:** open `/?env=livingRoom` on a running build (also `kitchen`, `bedroom`,
`backyard`, `beach`, `rooftop`, `props` for the props gallery, `textures` for the swatches). Add
`&mood=day|golden|evening|night|neon`, `&full=1`, `&cam=x,y,z&look=x,y,z`, `&fx=high|medium|low|off`.

## 1. Palette

Use `PALETTE` tokens (`import { PALETTE as P }`), not new hex codes. A scene needs **one dominant hue, one
supporting hue and one accent**; everything else is neutral wood, wall and shadow.

| Group | Tokens | Use |
|---|---|---|
| Backgrounds | `midnight` `aubergine` `plum` `espresso` | Night voids, far walls, anything behind the action |
| Surfaces | `cream` `linen` `clay` `sageWall` `duskWall` `slate` `charcoal` `wall` | Walls, floors, big quiet areas. Keep them low in saturation |
| Woods | `oak` `wood` `walnut` `woodDark` `mahogany` | Floors, furniture, frames. Light floor + dark furniture, or the reverse |
| Fabrics | `terracotta` `mustard` `rose` `mauve` `denim` `teal` `forest` `sage` (`FABRICS` in props.ts) | Sofas, rugs, curtains, cushions, books. Two or three per scene |
| Foliage | `fern` `moss` `olive` `pine` `leaf` `leafDark` `grass` `grassDark` | Plants, trees, lawns. Always mix two for variation |
| Accents | `brass` `copper` `ceramic` `brick` `sand` `accent` `metal` `stone` | Handles, pots, crockery, small highlights |
| Glows | `lamp` `ember` `moon` `neonPink` `neonCyan` `neonViolet` `screen` `glow` | Only with `glow` (they bloom). Warm lamp light is the default glow |
| Ink | `ink` | Text and the darkest details. Never pure black |

The old tokens (`grass`, `wood`, `roof`, `cloth`, `water`…) still exist, now calmer. `material()` also softens
any very saturated or near-white colour a scene passes in (`refine()`); pass `{ exact: true }` to opt out.

**Seat colours** (`#F5A524` amber, `#3B82F6` blue, `#E2437A` pink, `#22B573` green) are the brightest, most
saturated colours on screen, and that is their job: they say *who*. So:

- Keep the set itself out of those four hues at full strength. A terracotta rug is fine; an orange one fights seat 1.
- Use a seat colour on a small, clear marker: a cushion, a ring on the floor, a lamp, a trim, a name dot. Not on
  whole walls or floors.
- For a big seat-coloured surface (a lane, a team side), mix it down: `mix(seatColor, P.aubergine, 0.55)` for the
  surface and the full colour only on its edge or as a `glow` strip.
- At night, make seat markers glow (`glow: 1.2`) rather than raising the light on them.

## 2. Lighting recipes

Call `lightRig(scene, name, { shadowSize })` (env.ts) or `applySky(scene, SKIES.x, fog, shadowSize)` (toon.ts).
Both set the sky or backdrop, fog, hemisphere + key light with soft shadows, the rim light and the grade.

| Recipe | Key light | Fill and shade | Grade | Use for |
|---|---|---|---|---|
| `goldenHour` (`SKIES.afternoon`) | low warm sun, long shadows | cool blue-violet | `golden` | beaches, gardens, anything outdoors and happy |
| `dusk` (`SKIES.dusk`) | soft peach | violet | `dusk` | the default exterior; party gardens, balconies |
| `moonlit` (`SKIES.night`) | cool moon | deep blue, strong rim | `night` | night exteriors, rooftops, campfires |
| `lampInterior` | soft warm, from above and in front | plum | `cosy` | **the house default**: evening living rooms and kitchens |
| `nightInterior` | dim and cool | blue | `night` | lights-off games, TV glow, sneaking |
| `dayInterior` | pale daylight from one side | neutral | `neutral` | mornings after, daytime kitchens |
| `neon` | weak cool key + pink and cyan side lights | violet | `neon` | late-night, arcades, rhythm games |
| `midday` (`SKIES.midday`) | high white sun | sky blue | `day` | rarely; it is the least cosy |

Rules that make light read:

- **One key, one colour of shade.** Warm key with cool shade or the reverse. Don't add white fill lights; if a scene
  is too dark, raise `sunIntensity` or add a lamp where a lamp would be.
- **Motivate every light.** A point light sits in a visible lamp, screen, fire or window. Three or four point lights
  per scene at most (`floorLamp({ light: true })`); the other lamps just glow.
- **Let things glow.** `glow: 1` and above blooms. Bulbs, screens, embers, neon, the moon: 1.5–2.5.
- **Aim the shadows.** `applySky` returns the sun: put `sun.target` on the action and size `shadowSize` to just
  cover the play area (smaller = sharper shadows).
- Grades: `view.grade = 'cosy'` or `{ base: 'cosy', bloom: 1 }` on the View, or `setGrade(scene, …)`. Presets:
  `neutral day golden dusk night cosy neon lofi board`. A grade is the last 10 %; fix the light first.

## 3. Materials

`part(group, geometry, colour, x, y, z, options)` is still how everything is built. New options:

| Option | Does |
|---|---|
| `tex: 'woodFloor'` | A library texture, mapped without UVs (same grain size on every shape). **The colour tints it**: the texture gives detail, the palette decides the colour |
| `texScale: 2` | Scene units per texture tile (each texture has a sensible default) |
| `texStrength: 0.6` | Less detail for calm areas (0..1) |
| `texNatural: true` | The texture's own colours (pass `'#ffffff'`) |
| `gloss: 0.4` | A soft highlight: ceramic 0.5, metal 0.6–0.7, leather and polished wood 0.2–0.3 |
| `rim: 0` | Rim light on this material (default 1) |
| `glow`, `basic`, `opacity`, `outline`, `shadow` | As before |

For meshes you make yourself: `texturedMaterial('brick', { color: P.brick, scale: 2 })`, or `toonMat(params,
{ tex, gloss })`. For UV-mapped use: `texture('gingham', { repeat: 4 })` from textures.ts.

| Texture | For | | Texture | For |
|---|---|---|---|---|
| `woodFloor` | floorboards | | `brick` | walls, chimneys, rooftops |
| `parquet` | fancier floors | | `stoneTiles` | patios, pavements |
| `wood` | furniture, shelves, frames | | `cobble` | garden paths |
| `darkWood` | dark furniture, instruments | | `kitchenTile` | splashbacks, bathrooms |
| `planks` | decks, fences, crates | | `terrazzo` | kitchen floors, worktops |
| `fabric` | sofas, cushions, curtains | | `grass` | lawns, hedges |
| `velvet` | armchairs, beanbags | | `sand` | beaches |
| `knit` | blankets, throws, woolly rugs | | `concrete` | rooftops, garages |
| `terry` | rugs, towels | | `metalPlate` | machines, vents |
| `plaster` | interior walls | | `leather` | stools, cases |
| `bark` | trunks, logs | | `roofTiles` | roofs |
| `gingham` | picnic blankets, tablecloths | | `rock`, `patio` | boulders, cliffs; terracotta tiles |

Every lit material also gets a faint grain, so nothing is flat plastic. Big surfaces (floors, walls, tables, sofas)
should always carry a texture; small props usually don't need one.

**Outlines** are now thin, dark and tinted (the shape's own colour taken towards ink). Keep them on silhouettes of
things that matter (players' things, pickups, furniture). Drop them (`outline: false`) on floors, walls, rugs, tiny
details, anything glowing, and background dressing. Don't raise the width to make something pop; use light or a
seat-colour trim instead.
Outlines are unlit, so each sky and lighting recipe dims them to suit (night about 0.45). If you light a scene by
hand and its outlines look pale against dark surfaces, set `setLook(scene, { outline: 0.5 })`; the same call takes
`rimColor`, `rimStrength`, `keyDir` and `keyColor` for the rim light and gloss highlight.

## 4. Composition

- **Fill the frame.** No empty void behind the action: a wall with things on it, a fence and trees, a skyline, a
  sea. The environment builders do this for you; the camera should not see where the set ends.
- **Three layers.** Foreground (something big and soft at a bottom corner: a plant, a pouf, a lamp), midground (the
  game), background (dressed wall or horizon). Slight overlap between layers is what gives depth.
- **Density at the edges, calm in the middle.** Props cluster in corners and along walls; the play area stays
  simple so players and pickups read instantly. Group props in threes of different heights.
- **Depth cues:** a rug or patio under the action, shadows on the floor, a warm lamp behind and to one side, fog
  that just touches the far wall, darker corners (the vignette helps).
- **Value before colour.** Squint: the players and what they must look at should be the brightest, most
  contrasted things. Push the set a step darker and less saturated than feels natural.
- **Stay inside the HUD safe area** (`SAFE` / `CameraFit` in `minigames/kit.ts`). Dressing may run under the HUD;
  gameplay may not.
- Camera: 35–45° field of view, looking 20–35° down, from +z towards -z.

## 5. Props and environments

```ts
import { livingRoom } from '../../render/env';
import * as props from '../../render/props';

const env = livingRoom(this.scene, { mood: 'evening', w: 10, d: 7 }); // floor, walls, window, lamps, plants…
const couch = props.sofa({ seats: 4, color: P.mauve, pillows: [P.mustard, P.teal] });
couch.scale.setScalar(1.3);            // companions are stubby: seats for them want 1.2–1.4×
couch.position.set(0, 0, -1);
this.scene.add(couch);
// in update(dt, time):
env.update(dt, time);                  // water, flames, turntables, clouds
```

**Environments** (`env.ts`) set up a complete, lit, graded space and leave the middle free. All take
`mood: 'day' | 'golden' | 'evening' | 'night' | 'neon'`, `clear: { w, d }`, `dress: 0..1`, `seed`, `lights`.
They return `{ root, sun, lamps, update(dt, time), bounds }`. Don't call `applySky` as well.

| Builder | Extra options | What you get |
|---|---|---|
| `livingRoom` | `w d h wall floor accent furniture: 'edges' \| 'full' rug` | wooden floor, painted walls, window + curtains, pictures, bookshelf, sideboard with record player, lamps, plants, string lights |
| `bedroom` | `w d h wall bedding bed` | bed, bedside lamps, window, rug, shelves, string lights |
| `kitchen` | `w d h wall cabinets floor island` | cabinets with sink and cooker, fridge, tiled splashback, shelves of crockery, pendant lamps, window |
| `backyard` | `w d patio house grass` | lawn, fences, hedges, trees beyond, bushes, flowers, garden lamps, string lights, fireflies |
| `beach` | `shore campfire bare` | sand, animated sea with foam edge, palms, rocks, parasols, towels, islands |
| `rooftop` | `w d sign lounge` | concrete deck, brick parapet, stair house, water tank, vents, planters, string lights, city skyline |

`lightRig(scene, recipe, { fog, shadowSize, sunFrom })` lights a scene you build yourself.

**Props** (`props.ts`): each returns a `THREE.Group`, origin on the floor at its centre (wall things: on the wall
facing +z; hanging things: at the ceiling), 1 unit = 1 m, all options optional.

- Seating: `sofa` `armchair` `beanbag` `pouf` `stool` `bed` `logSeat` `crate`
- Tables and storage: `coffeeTable` `sideTable` `table` `sideboard` `bookshelf` `books` `wallShelf` `rug`
- Lamps: `floorLamp` `tableLamp` `pendantLamp` `gardenLamp` `candle` `stringLights(from, to)` `neonSign(text)`
  (`lit`, `light: true | strength` for a real light)
- Plants: `plant({ kind: 'monstera' | 'fern' | 'snake' | 'ficus' | 'cactus' | 'trailing' | 'palm' })` `vase`
- Walls: `windowFrame({ time: 'day' | 'dusk' | 'night' })` `curtains` `pictureFrame({ art })` `wallClock`
- Kitchen: `kitchenCounter({ sink })` `fridge` `stove({ lit })` `pot` `pan` `mug` `plates` `jar`
- Snacks and bits: `snackBowl({ fill })` `pizzaBox({ open, slices })` `drink` `remote`
- Sound and screens: `speaker` `recordPlayer` `tvSet` + `setScreen(tv, texture)` `guitar`
- Outdoors: `tree({ kind: 'round' | 'pine' | 'palm' | 'birch' })` `bush` `hedge` `fence({ kind })` `rock` `tuft`
  `campfire` `parasol` `blanket` `skyline`
- Living things: `water({ w, d, shoreZ })` (animated shader), `cloudBank`, `motes` (dust, fireflies)

Animated props carry `userData.tick`; if you add them outside an environment, do
`const tick = props.tickProps(root)` once and call `tick(dt, time)` each frame.

New shape helpers in toon.ts: `sphere(r)`, `disc(r)`, `lathe(profile)` (vases, bowls, shades).

## 6. Motion

- **Ease everything.** Nothing starts or stops dead: ease-out for arrivals, ease-in-out for moves.
- **Squash and settle.** Things that land overshoot a little and settle in 150–300 ms (scale 1.12 → 0.96 → 1).
  Pickups pop (scale up 1.2×, fade); hits flash a `glow` for a few frames.
- **The set breathes, slowly.** Lamps flicker by a few percent, plants sway a degree or two, fireflies drift, the
  record turns, water moves. Slow enough that you only notice when it stops.
- **Anticipation for anything a player must react to:** a wind-up, a glow that builds, a wobble before the fall.
- **The camera is calm.** Gentle drift or a slow push-in; shake only on big moments, small and under 300 ms.
- Words (`popSprite`, `Floaters`) rise and fade in about a second. One at a time per player.

## 7. Do and don't

| Do | Don't |
|---|---|
| `livingRoom(scene, { mood: 'evening' })`, then add the game's couch | A flat coloured plane as floor and nothing behind it |
| `part(g, rbox(3, 0.2, 2), P.terracotta, 0, 0, 0, { tex: 'terry', outline: false })` for a rug | `part(g, cyl(3, 3, 0.02), '#ff8a00', …)`: raw saturated hex, untextured, outlined |
| A lamp prop with `light: true` and a warm glow where the scene is dark | An extra white `DirectionalLight` to "brighten things up" |
| Seat colour on a cushion, ring or trim; the lane itself mixed down | Four full-strength seat-coloured walls |
| `glow: 2` on a small bulb, screen or ember | `glow` on big surfaces (the bloom washes the frame out) |
| Dark, desaturated back wall; bright, clear players | Background brighter or more saturated than the players |
| `FONT` (Inter) for canvas text, sentence case, short | Chunky rounded lettering, ALL CAPS shouting, emoji as art |

## 8. Checklist for a minigame polish pass

1. Run it first (`E2E_GAME=<id>`), look at the screenshots, and name what is flat, empty or loud.
2. **Set:** replace the hand-made floor, walls and backdrop with an environment builder (or `lightRig` + your own
   set) that fits the game's fiction. Pick the mood; evening or night unless the game says otherwise.
3. **Fill the frame:** no void in any corner at 16:9; add a foreground piece; cluster props at the edges.
4. **Materials:** textures on every large surface; palette tokens instead of raw hex; `gloss` on ceramic and metal;
   outlines off on floors, walls and dressing.
5. **Light:** one key, coloured shade, at most four point lights, each in a visible lamp. Shadows cover the play
   area. Things that should glow, glow.
6. **Readability:** players and targets are the brightest, clearest things; seat colours only on markers; everything
   important inside `SAFE`. Check it in the e2e screenshots at 1600×900.
7. **Motion:** landings squash and settle, pickups pop, the set breathes. `env.update(dt, time)` is called.
8. **Grade:** leave the recipe's grade unless the game has a reason (`view.grade`).
9. **Clean up:** `dispose()` still removes what you added; no new files in `render/`; typecheck, eslint and
   `vitest` are green; e2e passes on the software renderer.

## 9. Rendering notes

- The stage renders through `post.ts`: multisampled HDR target → ambient occlusion → bloom → tone mapping
  (Khronos Neutral: colours below about 0.8 stay as authored) → grade → vignette → grain (+ FXAA on the low tier).
- Quality is automatic. Tiers: **high** (4× MSAA, AO, bloom), **medium** (no AO, lower pixel ratio), **low**
  (no MSAA, FXAA, lighter bloom, 1× pixels), **off**. A frame rate under 42 fps for a few seconds steps down one
  tier. `?fx=high|medium|low|off` pins a tier.
- Software renderers (the e2e test's SwiftShader) run the low tier **with ambient occlusion kept on**, so e2e
  screenshots show the real look: grade, bloom, AO, textures. Only the normal maps and 4× MSAA are missing there.
  It is slow (a dressed room draws at about 5 fps in SwiftShader); that is expected and the game logic doesn't mind.
- `MeshBasicMaterial` and sprites now pass through tone mapping and the grade like everything else. Values above
  1 (`new THREE.Color(1.5, 1.5, 1.5)` on a basic material, or `glow`) bloom.
- Textures are served from `public/textures/` (credits in `CREDITS.md`, all CC0 from Poly Haven) and load on first
  use; `preloadTextures('woodFloor', 'plaster')` warms them during an intro.
