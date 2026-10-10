# Pinehaven Golf

A 3D golf game that runs in any modern web browser. You play as a golfer on a
nine-hole, par-36 course: walk (or drive the cart) to your ball, address it,
swing with a classic three-press meter, then head after it. When you hole out,
follow the marker to the next tee.

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
| Aim / club | `A` `D` or mouse, `W` `S` (or `↑` `↓`) | ◀ ▶ and ‹ › |
| Swing | `Space` three times: start, set power, stop on the white line | **Swing** three times |
| Shot camera | `T`: behind, landing area, overhead | **View** |
| Step away from the ball | `E` or `Esc` | **Back** |
| Drive the cart | `E` next to it; `W` `S` drive, `A` `D` steer, `Space` brake, `E` to get out | **Drive** / **Get out** |
| Fast-forward the ball | hold `Space` while the camera follows it | hold the action button |
| Course map / scorecard / sound / help | `M` / `C` / `N` / `H` | buttons at the top right |

Early on the third press hooks the ball left; late slices it right. The yellow
ring shows where a full-power shot lands with no wind. On the green, arrows
show the slope. Moving takes you back from the ball camera to your golfer.

## Project layout

```
Golf.html             built game: double-click to play (generated, committed)
build.py              assembles src/ + vendor/ into Golf.html and dist/
src/index.html        HUD and screen markup
src/style.css         HUD styling
src/js/util.js        math, seeded noise, polyline helpers
src/js/data.js        clubs (carry, launch, spin) and surfaces (bounce, friction, lie)
src/js/physics.js     ball flight (drag + Magnus lift), bounce, roll, cup capture
src/js/course.js      the nine holes and where each sits on the property
src/js/terrain.js     builds the whole course: height, surfaces, water, trees, cart paths
src/js/world.js       three.js rendering: chunked terrain, trees, water, flags, clubhouse
src/js/character.js   the golfer model and its procedural animation
src/js/cart.js        the golf cart model and driving physics
src/js/ui.js          HUD, swing meter, markers, radar, course map, scorecard
src/js/audio.js       synthesised sound effects (WebAudio)
src/js/main.js        game flow, player and camera control, input
vendor/three.min.js   three.js r158 (MIT, see vendor/THREE-LICENSE)
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
node tests/smoke.js [outDir]          # plays hole 1 in headless Chromium: walk, swing, cart, hole out
node tests/mobile.js [outDir]         # touch layout screenshots, portrait and landscape
node tests/tour.js [outDir] [holes]   # address-view screenshots from each tee
```

`Golf.html?hq` keeps full resolution (otherwise it lowers resolution on slow
devices).
