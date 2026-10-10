# Pinehaven Golf

A 3D golf game that runs in any modern web browser. Nine holes, par 36, with
wind, slopes, bunkers, water, trees and a classic three-press swing meter.

## Play

**Double-click `Golf.html`.** It opens in your default browser and works
offline (three.js is bundled inside the file). An internet connection only
adds the nicer fonts.

### Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Aim | `←` `→` (hold `Shift` for fine aim), or drag across the course | ◀ ▶ buttons, or drag |
| Change club | `↑` `↓` | ‹ › on the club panel |
| Swing | `Space` three times: start, set power, stop on the white line | Tap **Swing** three times |
| Camera | `V` cycles behind-ball, landing area, overhead; mouse wheel zooms | **View** |
| Fast-forward the ball | hold `Space` | hold **Faster** |
| Scorecard / sound / help | `C` / `M` / `H` | buttons at the top right |

Early on the third press hooks the ball left; late slices it right. The yellow
ring shows where a full-power shot lands with no wind. On the green, arrows
show the slope.

## Project layout

```
Golf.html            built game: double-click to play (generated, committed)
build.py             assembles src/ + vendor/ into Golf.html and dist/
src/index.html       HUD and screen markup
src/style.css        HUD styling
src/js/util.js       math, seeded noise, polyline helpers
src/js/data.js       clubs (carry, launch, spin) and surfaces (bounce, friction, lie)
src/js/physics.js    ball flight (drag + Magnus lift), bounce, roll, cup capture
src/js/course.js     the nine holes: centre line, fairway, green, bunkers, water
src/js/terrain.js    turns a hole into height/surface functions and trees
src/js/world.js      three.js rendering: terrain, trees, water, sky, flag, ball
src/js/ui.js         HUD, swing meter, minimap, scorecard
src/js/audio.js      synthesised sound effects (WebAudio)
src/js/main.js       game flow, camera, input
vendor/three.min.js  three.js r158 (MIT, see vendor/THREE-LICENSE)
tests/               headless checks (see below)
```

After editing anything in `src/`, rebuild:

```
python3 build.py
```

### Changing the course

Holes live in `src/js/course.js`. Each hole is a centre line from tee to the
middle of the green plus ellipses for bunkers and water, all in yards with play
heading towards −Z. Tune club distances in `src/js/data.js`; the swing meter
recalibrates automatically, so 100% power always means the listed carry.

### Checks

```
node tests/course-check.js [outDir]   # validates every hole; optional top-down PNGs
node tests/calibrate.js               # carry, apex and rollout for every club
node tests/smoke.js [outDir]          # plays hole 1 in headless Chromium, saves screenshots
node tests/tour.js [outDir] [holes]   # tee-view screenshots for each hole
```
