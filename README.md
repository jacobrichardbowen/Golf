# Pinehaven Golf

A 3D golf game that runs in any modern web browser. Pick one of three golfers
and play a nine-hole, par-36 course: walk (or drive the cart) to your ball,
address it, swing with a classic three-press meter, then head after it. Your
caddy follows you with the bag; walk up to it to change clubs. When you hole
out, follow the marker to the next tee.

## Play

**Double-click `Golf.html`.** It opens in your default browser and works
offline (three.js is bundled inside the file). An internet connection only
adds the nicer fonts.

### Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Walk / run | `W` `A` `S` `D` (hold `Shift` to run) | stick on the left (push all the way to run) |
| Look around | mouse (click the course to capture it; `Esc` releases) | drag on the right side |
| First / third person | `V` | **1st** |
| Play your shot | walk up to the ball, press `E` | **Play shot** |
| Change clubs | walk up to the bag, press `E`, click a club (or `1`–`5`) | **Clubs**, then tap a club |
| Aim | `A` `D` or mouse | ◀ ▶ |
| Swing | `Space` three times: start, set power, stop on the white line | **Swing** three times |
| Shot camera | `T`: behind, landing area, overhead | **View** |
| Step away from the ball | `E` or `Esc` | **Back** |
| Drive the cart | `E` next to it; `W` `S` drive, `A` `D` steer, `Space` brake, `E` to get out | **Drive** / **Get out** |
| Fast-forward the ball | hold `Space` while the camera follows it | hold the action button |
| Course map / scorecard / sound / help | `M` / `C` / `N` / `H` | buttons at the top right |

Early on the third press hooks the ball left; late slices it right. The yellow
ring shows where a full-power shot lands with no wind. On the green, arrows
show the slope. Moving takes you back from the ball camera to your golfer.

### Golfers, clubs and the caddy

| Golfer | Height | Look |
| --- | --- | --- |
| G. Surlaw | 6′0″ | white hair, gray shirt, cyan-blue pants |
| F. Froth | 5′0″ | brown hair, forest green shirt, gold pants |
| W. McBeaty | 4′0″ | orange hair, red shirt, white pants |

| Club | Full carry | Its niche |
| --- | --- | --- |
| Driver | 235 yds | longest, low flight and lots of roll; fast meter that curves the ball most; loses 14% off the fairway and much more from rough or sand |
| 4 iron | 185 yds | long approaches; struggles from sand and deep rough |
| 8 iron | 140 yds | high, spinning approach that stops on the green |
| Chipping wedge | 95 yds | slow, forgiving meter; best out of bunkers and rough, keeps its spin |
| Putter | up to 165 ft | rolls along the ground |

The caddy (McBeaty's build, all in white) walks a few yards behind you and
sets the bag down whenever he stops. When you reach your ball he suggests a
club. Near the cart you can leave the bag strapped to it instead (and hand it
back later) from the bag screen.

## Workshop: replace models and textures

**Workshop** on the title screen lists every model and texture in the game:
trees, tee markers, the clubhouse, each club, the bag, the cart, the golfer
rig, and the grass, water, cloud and flag textures. Select one to see it on a
turntable, then:

- **Download** saves the current version (`.glb` models, `.png` textures).
  Inside a claude.ai Artifact, models arrive inside a `.zip` because the
  viewer only allows certain file types to be saved.
- **Replace…** loads your own file. It's stored in this browser (IndexedDB)
  and used the next time the game loads.
- **Reset to built-in** goes back to the original.
- **Export my assets** / **Import pack…** move your replacements between
  browsers as one `.json` file.

Models are glTF binary in meters, +Y up, front facing +Z (Blender's glTF
exporter does this by default). Notes for particular assets:

- Trees are scaled to the course's tree heights, so model them any size.
  Materials named `leaves`/`foliage` get each tree's colour variation.
- The golfer rig is one model shared by all three golfers and the caddy. Keep
  the named joint empties (`hips`, `thigh.L`, `knee.L`, …, `arm.R`, `elbow.R`)
  and parent meshes to them; materials named `skin`, `shirt`, `pants`, `hair`,
  `shoe` and `eye` are recoloured per golfer.
- The cart's wheels roll and steer if they're named `wheel.FL` … `wheel.RR`
  (origin at the hub) with a child whose name starts with `spin`.
- Clubs hang from the grip at the origin with the head pointing down (−Y).

To build replacements into `Golf.html` itself, put the files in an `assets/`
folder named by asset id (`assets/tree-pine.glb`, `assets/tex-grass.png`, …)
and run `python3 build.py`. Ids are shown in each download's file name.

## Project layout

```
Golf.html             built game: double-click to play (generated, committed)
build.py              assembles src/ + vendor/ into Golf.html and dist/
src/index.html        HUD and screen markup
src/style.css         HUD styling
src/js/util.js        math, seeded noise, polyline helpers
src/js/data.js        clubs, surfaces (bounce, friction, lie) and the golfers
src/js/physics.js     ball flight (drag + Magnus lift), bounce, roll, cup capture
src/js/course.js      the nine holes and where each sits on the property
src/js/terrain.js     builds the whole course: height, surfaces, water, trees, cart paths
src/js/assets.js      asset registry: built-in models/textures, custom replacements, glTF in/out
src/js/world.js       three.js rendering: chunked terrain, trees, water, flags, clubhouse
src/js/equipment.js   club and bag models, the bag close-up
src/js/character.js   the golfer rig and its procedural animation
src/js/cart.js        the golf cart model and driving physics
src/js/workshop.js    the Workshop screen
src/js/ui.js          HUD, swing meter, markers, radar, course map, scorecard
src/js/audio.js       synthesised sound effects (WebAudio)
src/js/main.js        game flow, player and camera control, input
vendor/three.min.js   three.js r158 (MIT, see vendor/THREE-LICENSE)
vendor/three-addons/  three.js glTF loader/exporter modules, converted to plain scripts by build.py
assets/               optional: your own models/textures to build in (see Workshop)
tests/                headless checks (see below)
```

After editing anything in `src/`, rebuild:

```
python3 build.py
```

### Changing the course

Holes live in `src/js/course.js`. Each hole is designed in its own frame (a
centre line from tee to the middle of the green, plus ellipses for bunkers and
water, all in yards with play heading towards −Z) and then placed on the
property with `at: [x, z, heading]`. Run `node tests/course-check.js out/` to
check that holes don't overlap and to render a map of the layout. Tune club
distances in `src/js/data.js`; the swing meter recalibrates automatically.

### Checks

```
node tests/course-check.js [outDir]   # validates the layout; optional top-down map
node tests/calibrate.js               # carry, apex and rollout for every club
node tests/smoke.js [outDir]          # plays hole 1 in headless Chromium: select, walk, swing, bag, cart, hole out
node tests/workshop.js [outDir]       # Workshop: download, replace, reload, export/import, reset
node tests/mobile.js [outDir]         # touch layout screenshots, portrait and landscape
node tests/tour.js [outDir] [holes]   # address-view screenshots from each tee
```

`Golf.html?hq` keeps full resolution (otherwise it lowers resolution on slow
devices).
