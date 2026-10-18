# Pinehaven Golf

A 3D golf game that runs in any modern web browser. Pick one of six golfers
and play one of two nine-hole, par-36 courses: walk (or drive the cart) to
your ball, address it, hold to wind up and let go to swing, then head after
it. Your caddy follows you with the bag; walk up to it to change clubs. When
you hole out, follow the marker to the next tee. Play alone, or online with up
to five friends, all on the course at once.

This is build **v008** (shown in the corner of the title screen).

## Play

**Double-click `Golf.html`.** It opens in your default browser and works
offline (three.js is bundled inside the file). An internet connection only
adds the nicer fonts.

The latest build, including every model committed from the Workshop, is
always at
[releases/download/build/Golf.html](https://github.com/jacobrichardbowen/Golf/releases/download/build/Golf.html).

**Two courses.** Pick one on the title screen (the game reloads into it):

- **Pinehaven**: parkland and pines, a castle by the first, ponds and creeks.
- **Golden Plains**: a windswept, hilly plain of golden grass dotted with
  rocky, grass-topped mesas. Tee off from a lookout high on a mesa, play mesa
  to mesa over a creek and walk (or drive) across on a rope suspension bridge,
  thread a ball through a great arch in the rock (or go round it), finish one
  hole on top of a table mesa, and dodge the hoodoos. Steep ground is a slow
  scramble on foot; ramps and bridges are quicker, and carts need them.

### Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Walk / run | `W` `A` `S` `D` (hold `Shift` to run) | stick on the left (push all the way to run) |
| Look around | mouse (click the course to capture it; `Esc` releases) | drag on the right side |
| First / third person | `V` | **1st** |
| Play your shot | walk up to the ball, press `E` | **Play shot** |
| Change clubs | walk up to the bag, press `E`, click a club (or `1`–`5`) | **Clubs**, then tap a club |
| Aim | `A` `D` or mouse | ◀ ▶ |
| Swing | hold `Space` to wind up, let go to hit | hold **Swing**, let go |
| Look at the club | `Q`; then `A` `D` turn the face, `W` `S` push the club out or pull it in | **Setup**; ◀ ▶ and ▲ ▼ |
| Shot camera | `T`: behind, landing area, overhead | **View** |
| Step away from the ball | `E` or `Esc` | **Back** |
| Drive the cart | `E` next to it; `W` `S` drive, `A` `D` steer, `Space` brake, `E` to get out | **Drive** / **Get out** |
| Send the caddy for the cart | `G` | **Fetch cart** (shows when it's far away) |
| Fast-forward the ball | hold `Space` while the camera follows it | hold the action button |
| Course map / scorecard / sound / help | `M` / `C` / `N` / `H` | buttons at the top right |

**Swinging by feel.** Hold to wind up: how far back your golfer gets is how
hard he hits, and he waits at the top for as long as you hold. Hang there too
long and he tenses up, and the strike starts to wander. Giving it absolutely
everything sprays it a little too: a smooth nine-tenths swing is straighter.
No line shows where the ball will go. When you step up to the ball you're
lined up roughly, never exactly: often a few degrees off for a full shot, a
degree or two on the green, so look down the line and adjust.

**Shaping the shot.** The close-up (`Q`) looks down through your golfer's own
eyes at the club behind the ball, the target off to the left, with an
alignment stick pointing where you're aimed and a faint line showing where
the face points. An open face starts the ball right and curves
it right; a closed face the other way. Pushing the club out puts the ball on
the heel, which fades it; pulling it in puts it on the toe, which draws it.
Off-centre strikes lose a little distance. To hook one round a corner, aim
right of it and close the face.

**Reading the wind.** There's no wind dial, and the wind matters: a 10 mph
crosswind moves a drive about 25 yards. Faint streaks drift through the
air with it (more and faster the stronger it blows); two flags frame every
tee, pennants stand around each hole, flags fly from the castle and tower,
your caddy carries one on his back (in your colours), and the flag in the
hole streams out straight in a gale and hangs limp in a calm.

**Fetching the cart.** Left the cart a long way back? Press `G` (or **Fetch
cart**): your caddy sets the bag down beside you and runs off for it. If it
was more than 120 yards away it takes him about half a minute; nearer, less.
He comes back driving it in from wherever you aren't looking and pulls up
beside you. On the green, read the slope
from the ground. Moving takes you back from the ball camera to your golfer.

### Playing with friends

Up to six golfers can play a round together, each on their own computer or
phone, all out on the course at the same time. (Six is also the most the
free connection services comfortably carry: every message goes through the
host's browser.)

1. Everyone opens the game and picks **Play with friends** on the title
   screen, types a name and chooses a golfer. Each golfer can be played by
   one person only; taken ones are greyed out with the player's name.
2. The host picks the course on the title screen first, then **Host a game**
   and gets a four-letter code. The others type the code and press **Join**
   (if they're on the other course, the game switches over and joins again
   by itself).
3. When everyone's listed, the host presses **Tee off**.

Each of you plays your own ball in your golfer's colour, with your own caddy
and cart in your colours, from your own spot on each tee (three abreast and a
row behind; anyone standing in your line of sight steps out of the picture
while you address the ball). You see the
others walking, driving and swinging, with their names over their heads, on
the radar and in the list under the hole plate, and you hear their shots.
Everyone feels the same wind on the same hole. When you hole out the
scorecard shows all of you; it waits until the others have holed out
too (press **Watch** to close it and look on, or **Go on ahead** if someone's
dawdling). **Leave game** on the scorecard heads back to the clubhouse.

Online play needs an internet connection. The game uses the free public
[PeerJS](https://peerjs.com/) server only to introduce your browsers to each
other; after that they talk directly. If the host leaves, the others can
still finish their rounds alone. Some strict networks (office or school
firewalls, a few mobile carriers) block direct connections between browsers;
if joining hangs, try another network. It works from `Golf.html` and the
released download; inside the claude.ai Artifact it may be blocked by the
page's sandbox. Online rounds aren't saved for resuming.

### Golfers, clubs and the caddy

| Golfer | Height | Build | Colours | Ball |
| --- | --- | --- | --- | --- |
| G. Surlaw | 6′0″ | human: tall and broad-shouldered, walrus moustache; stands like a hero, chest out, feet wide | cyan-blue and gray | cyan-blue |
| F. Froth | 5′0″ | dwarf: stocky, broad, bearded | green and gold | gold |
| W. McBeaty | 4′0″ | his own model | white and red | red |
| A. Salt | 5′10″ | human: sporty, reddish quiff and sideburns | black and red | black |
| B. B. Beetor | 6′5″ | human: lanky and long-limbed, hunched on bent knees; balding, pencil moustache | brown and dark gray | brown |
| R. Cord | 5′8″ | elf: slender, long pointed ears, long fair hair | orange and blue | orange |

Your golfer's colours are on your cart and on the flag your caddy carries;
your ball is your golfer's ball colour.

| Club | Full carry | Its niche |
| --- | --- | --- |
| Driver | 235 yds | longest, low flight and lots of roll; quickest backswing and curves the ball most; loses 14% off the fairway and much more from rough or sand |
| 4 iron | 185 yds | long approaches; struggles from sand and deep rough |
| 8 iron | 140 yds | high, spinning approach that stops on the green |
| Chipping wedge | 95 yds | slow, forgiving backswing; best out of bunkers and rough, keeps its spin |
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
- **Reset to built-in** goes back to the original. **Use project version**
  drops your change and uses the file already built into the game.
- **Commit to project** puts your changes into this repository (see below),
  so every new build includes them.
- **Export my assets** / **Import pack…** move your replacements between
  browsers as one `.json` file.

### Sharing your changes with everyone

**Commit to project** writes each replaced asset to `assets/<asset-id>.<ext>`
(and deletes the file of any asset you reset to built-in) as one commit on the
repository's default branch. The **Rebuild game** GitHub Action
(`.github/workflows/build.yml`) then runs `build.py`, commits the new
`Golf.html`, and uploads it to the download link above, usually within a
minute or two. The list badges show which changes are still **not
committed**.

One-time setup: create a
[fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
with access to this repository only and the permission **Contents: Read and
write**, then paste it under **GitHub connection** in the commit dialog. It is
kept in that browser's local storage, so use it only on your own computer, and
revoke it on GitHub if that computer is lost. A `Golf.html` opened from disk
shares local storage with other local HTML files in some browsers, which is
one more reason to keep the token scoped to this one repository.

Committing works from `Golf.html` opened locally. The claude.ai Artifact
viewer restricts which sites a page can reach, so there use **Export my
assets** and hand the pack to Claude to commit.

Models are glTF binary in meters, +Y up, front facing +Z (Blender's glTF
exporter does this by default). Notes for particular assets:

- Trees are scaled to the course's tree heights, so model them any size.
  Materials named `leaves`/`foliage` get each tree's colour variation.
  The course has thousands of trees, so only those within about 120 yards
  use your model; farther ones are flat cards with pictures of it, taken when
  the game loads.
- G. Surlaw and A. Salt are rigged, skinned characters (see below):
  KayKit's Barbarian for Surlaw for now, and the game's own base mesh for
  Salt, in `assets/golfer-surlaw.glb` and `assets/golfer-salt.glb`.
  **Reset to built-in** in the Workshop brings back the old bodies.
- Each body type is its own rig: G. Surlaw's (human, `golfer-surlaw`),
  F. Froth's (dwarf, `golfer-froth`), and one W. McBeaty and the caddy share
  (`golfer`). Each has its own proportions; keep the named joint empties
  (`hips`, `thigh.L`, `knee.L`, …, `arm.R`, `elbow.R`) and parent meshes to
  them. Materials named `skin`, `shirt`, `pants`, `hair`, `shoe` and `eye`
  are recoloured per golfer.
- The cart's wheels roll and steer if they're named `wheel.FL` … `wheel.RR`
  (origin at the hub) with a child whose name starts with `spin`.
- Clubs hang from the grip at the origin with the head pointing down (−Y).

You can also add files to `assets/` by hand, named by asset id
(`assets/tree-pine.glb`, `assets/tex-grass.png`, …), and run
`python3 build.py`. Ids are shown in each download's file name.

## Project layout

```
Golf.html             built game: double-click to play (generated, committed)
build.py              assembles src/ + vendor/ into Golf.html and dist/
src/index.html        HUD and screen markup
src/style.css         HUD styling
src/js/util.js        math, seeded noise, polyline helpers
src/js/data.js        clubs, surfaces (bounce, friction, lie) and the golfers
src/js/physics.js     ball flight (drag + Magnus lift), bounce, roll, cup capture
src/js/course.js      Pinehaven's nine holes and where each sits on the property
src/js/plains.js      Golden Plains' nine holes, mesas, bridges and tunnel; the list of courses
src/js/terrain.js     builds the whole course: height, mesas, surfaces, water, trees, cart paths, bridges, tunnels
src/js/maphole.js     turns painted hole images into height, surfaces, trees and water
src/maps/             the images painted holes are built from
src/js/assets.js      asset registry: built-in models/textures, custom replacements, glTF in/out
src/js/publish.js     commits Workshop changes to the GitHub repository
src/js/atmosphere.js  haze, cloud shadows, dust motes; bloom, sun shafts and colour grading
src/js/wind.js        wind you can see: waving flags and streaks in the air
src/js/world.js       three.js rendering: chunked terrain, trees, water, flags, clubhouse
src/js/scenery.js     castle, tower, houses, bridge, fences and boulders for painted holes
src/js/equipment.js   club and bag models, the bag close-up
src/js/character.js   the golfer bodies (rigs), their procedural animation, and skinned bodies
src/js/cart.js        the golf cart model and driving physics
src/js/workshop.js    the Workshop screen
src/js/net.js         online play: hosting, joining and passing messages (PeerJS)
src/js/remote.js      the other players in an online round: golfer, caddy, cart, bag, ball, name tag
src/js/ui.js          HUD, shot hints, markers, radar, course map, scorecard
src/js/audio.js       synthesised sound effects (WebAudio)
src/js/main.js        game flow, player and camera control, input
vendor/three.min.js   three.js r158 (MIT, see vendor/THREE-LICENSE)
vendor/three-addons/  three.js glTF loader/exporter and SkeletonUtils modules, converted to plain scripts by build.py
vendor/peerjs.min.js  PeerJS 1.5.5, browser-to-browser connections (MIT, see vendor/PEERJS-LICENSE)
assets/               models/textures that replace the built-in ones (written by the Workshop)
tools/                paint_to_map.py (illustration -> painted hole images), blender/ (course starter,
                      rigged-golfer clip list, characters/), rigged/ (fits an Auto-Rig Pro character or a
                      KayKit one for the game)
.github/workflows/    rebuilds Golf.html when sources or assets change, publishes the download
tests/                headless checks (see below)
```

After editing anything in `src/`, rebuild:

```
python3 build.py
```

### Changing the course

Pinehaven's holes live in `src/js/course.js`, Golden Plains' in
`src/js/plains.js`. Each hole is designed in its own frame (a centre line from
tee to the middle of the green, plus ellipses for bunkers and water, all in
yards with play heading towards −Z) and then placed on the property with
`at: [x, z, heading]`. Golden Plains adds:

- `mesas`: steep-sided plateaus `{ x, z, rx, rz, rot, h, cliff }` with a ledge
  part way down their sandstone cliffs and scree at the foot, and `ramps:
  [{ a: foot, b: top, w }]` up them. Tees and greens can sit on top.
- `bridges`: rope suspension bridges `{ a, b, w }` between the ground at each
  end. People, carts and balls can be on the deck or pass beneath it.
- `tunnels`: arches straight through the rock `{ a, b, w, h }`. The ground
  inside the arch is cut away; the floor runs between the ground at each end.

Run `node tests/course-check.js out/` to check both courses (holes don't
overlap, a ball rolls through each tunnel and lands on each bridge) and to
render maps of the layouts. Tune club distances in `src/js/data.js`; full
power always gives the full carry.

### Painted holes

A hole can also be built from pictures instead of ellipses. Hole 1, Castle
Falls, is made from the illustration and height map in
`tools/maps/castle-falls-source.png`. A painted hole uses three images of the
same area, kept in `src/maps/`:

- **surface** (`<name>-surface.png`): one flat colour per kind of ground,
  from the table below. The fringe around greens is added automatically.
- **height** (`<name>-height.png`): greyscale, light = high, any resolution.
  Trees and buildings drawn into it are recognised and taken out of the
  ground shape; a tree is planted at each one, sized by its crown.
- **ground** (`<name>-ground.jpg`, optional): a painting drawn onto the ground
  as its colour.

| Colour (RGB)    | Ground                              |
|-----------------|-------------------------------------|
| 110, 200, 60    | fairway                             |
| 180, 255, 150   | green                               |
| 255, 255, 80    | tee                                 |
| 60, 130, 40     | rough                               |
| 20, 70, 30      | forest: deep rough, filled with trees |
| 130, 140, 40    | long grass: deep rough, no trees    |
| 240, 210, 150   | bunker                              |
| 30, 90, 220     | water                               |
| 160, 90, 40     | path                                |
| 128, 128, 128   | rocks: deep rough with boulders     |
| 0, 0, 0         | out of bounds                       |

The game keeps the ground playable whatever the height map says: greens are
fitted to a plane no steeper than 2%, tees are flattened, bunkers are dished
below their surroundings, water lies level at the height of its banks, and a
bridge's deck is raised to meet both ends. The hole blends into the land
around it over its outer 14 yards.

The hole's `map` entry in `course.js` gives the image ids and how to read
them, all in pixels of the surface map: `scale` (yards per pixel), `tee` (the
pixel placed at `at`), `pin`, `heights` (yards for black and white), `line`
(the line of play, used for the yardage and the aim), `props` (buildings and
bridges: centre pixel, footprint in yards, turn in degrees, and `flags`:
spots across the footprint where a flag flies from the roof) and `fences`.
`fallback` is a plain hole played if the images can't be loaded.

To make one from an illustration, paint a top-down view and a matching height
map, write a hints file like `tools/maps/castle-falls.json` (where the tee and
green are, the flag and markers to paint out, paths and buildings), and run

```
python3 tools/paint_to_map.py tools/maps/castle-falls.json src/maps
```

(needs numpy and Pillow). Or skip the tool and paint the surface map
yourself. The three images, and the castle, tower, house, bridge, fence and
boulder models, can be replaced in the Workshop (groups **Course maps** and
**Scenery**) and committed like any other asset.

### Building a course in Blender

`tools/blender/course-starter.blend` is an example par 4 set up the way the
game reads a course: a terrain mesh whose faces carry surface materials
(`green`, `fairway`, `tee`, `rough`, `deep rough`, `forest`, `sand`, `water`,
`path`, `out of bounds`), empties named `tee` and `pin`, a `line` curve for
the line of play, a `water` plane, trees named `pine…`/`oak…`, and other
objects as scenery. The "READ ME" text inside the file has the details.
`tools/blender/make_starter.py` regenerates it (needs `pip install bpy`).

For a rigged, skinned golfer (one mesh bent by an armature, instead of
separate parts), `tools/blender/ANIMATIONS.md` lists the animation clips the
game needs, how it plays them, and how to export.

### Rigged characters

Any golfer's body can be a skinned model: load a `.glb` with a mesh bound to
an armature in the Workshop (or drop it in `assets/` named after the body,
e.g. `golfer-surlaw.glb`). The game finds the bones by name (`hips`, `spine`,
`head`, and per side the upper arm, forearm, hand, thigh, shin and foot, in
most naming styles: `upper_arm.L`, `upperarm.l`, `LeftArm`, …), sizes the
golfer's skeleton from them, and then:

- plays the file's `idle`, `walk` and `run` clips (and `wave` on the select
  screen) when he stands about or moves, matching the walk to his speed by
  measuring how fast the planted foot travels;
- for everything else (address, the swing, putting, the cart) works the pose
  out itself, as for the other golfers, and turns each bone to match. That
  keeps his hands on the grip and the club on the ball whatever his
  proportions. Clips for these come later (`tools/blender/ANIMATIONS.md`).
  A bone named `grip…` in each hand marks where it holds the club, and
  finger bones (`index`, `thumb`, … but not the knuckles, `_00`) close round
  the grip.

G. Surlaw is the first one: the Barbarian from Kay Lousberg's
[KayKit Adventurers Character Pack](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)
(CC0, www.kaylousberg.com), without his weapons and cape.
`tools/rigged/prepare-kaykit.mjs` made `assets/golfer-surlaw.glb` from the
pack's `Barbarian.glb`: it drops the props, keeps the Idle, Walking_A and
Running_A clips as `idle`, `walk` and `run`, and trims animation tracks that
move nothing (289 KB in all).

A. Salt is the base mesh made for the game's humans and elves
(`tools/blender/characters/TestGolferBaseMesh_v002.blend`, rigged with
Auto-Rig Pro). `tools/rigged/fit_golfer.py` fitted it for the game and
exported `assets/golfer-salt.glb` (88 KB):

- **golfer_rig**: a clean skeleton of the bones the game knows (`hips`,
  `spine`, `chest`, `upper_chest`, `neck`, `head`, and per side `shoulder`,
  `upper_arm`, `forearm`, `hand`, `index_00`–`03`, `thumb_01`–`03`, `thigh`,
  `shin`, `foot`, `toe`), plus `club` and `grip.L`/`grip.R`. Each bone follows
  its Auto-Rig Pro deform bone through a constraint, so you keep animating
  with the Auto-Rig Pro controls. `cc_club` in the Auto-Rig Pro rig moves the
  club.
- **Colour regions**: the single material is split into `skin`, `shirt`,
  `pants`, `hair`, `shoe` and `shoe.socks`, which the game colours per
  golfer. Reassign faces between them in Blender to repaint.
- **Exporting**: the script is saved in the file as `export_golfer.py`.
  Open it in Blender's Text Editor and press Run Script: it writes
  `<file name>.glb` next to the `.blend`, with each Action baked onto
  golfer_rig as a clip of the same name. Load that in the Workshop
  (**A. Salt body → Replace…**). Or, here:
  `python tools/rigged/fit_golfer.py -- file.blend --save fitted.blend --glb out.glb`
  (needs `pip install bpy`; a file that hasn't been fitted yet is fitted
  first).

### Checks

```
node tests/course-check.js [outDir]   # validates the layout; optional top-down map
node tests/calibrate.js               # carry, apex and rollout for every club
node tests/smoke.js [outDir]          # plays hole 1 in headless Chromium: select, walk, swing, bag, cart, hole out
node tests/plains.js [outDir]         # Golden Plains: across a bridge, through the tunnel, the caddy fetching the cart
node tests/rigged.js [outDir]         # the skinned Surlaw and Salt: clips, no foot sliding, hands on the grip, the cart
node tests/workshop.js [outDir]       # Workshop: download, replace, reload, export/import, reset
node tests/publish.js [outDir]        # Workshop "Commit to project" against a mock of GitHub's API
node tests/mobile.js [outDir]         # touch layout screenshots, portrait and landscape
node tests/tour.js [outDir] [holes]   # address-view screenshots from each tee
node tests/net.js                     # online play's messages: join, the 6-golfer limit, one of each golfer, relays, leaving (needs `npx peer --port 9000`)
node tests/online.js [outDir]         # three browsers play a hole together (same server; slow)
```

`Golf.html?peer=host:port` uses your own PeerJS server instead of the public
one (the online test does this).

`Golf.html?hq` keeps full resolution and every effect (otherwise slow devices
first lower the resolution, then switch off bloom and the sun shafts).
