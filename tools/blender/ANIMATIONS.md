# Animation clips for a rigged golfer

What a rigged, skinned golfer (starting with G. Surlaw) needs in his .blend so
the game can play him. Each clip is one Blender **Action**, named exactly as
below. The game picks the clip for what he's doing, blends between them, and
for the golf swing decides the timing itself.

## What the game does today

Skinned golfers already work. G. Surlaw is KayKit's Barbarian for now, a
free (CC0) low-poly character, and A. Salt is the base mesh
(`characters/TestGolferBaseMesh_v003.blend`); see "Rigged characters" in the
README. The game plays the file's `idle`, `walk`, `run` and `wave` clips.
Everything else (address, the swing, putting, the cart), and any of those
clips a file doesn't have, it poses itself, as it does the other golfers,
and turns the bones to match. As the clips below arrive, each one takes
over from the game's own pose. Clip names are matched without regard to
case.

## With Auto-Rig Pro

The base mesh is rigged with Auto-Rig Pro, and fitted for the game
(`tools/rigged/fit_golfer.py`): a plain skeleton, `golfer_rig`, follows the
Auto-Rig Pro bones, and that's what the game gets. So:

- Animate with the Auto-Rig Pro controls as usual, one Action per clip,
  named as below, with Fake User on. Keys on the controls are fine: they're
  baked onto golfer_rig when you export.
- The club is `cc_club`, in the right hand (it follows the hand; key it to
  turn the club in the fingers, or leave it). `club (reference)` shows it,
  and the `ball` Empty is already in place.
- Export: Text Editor → `export_golfer.py` → Run Script. It writes
  `<game_body>.glb` next to the `.blend` (`golfer-salt.glb`), with every
  Action as a clip. You don't need the export settings under "Exporting"
  below.
- Facing: the base mesh faces −Y with its left on +X, as the rules below
  ask.

## Rules for every clip

- **One Action per clip**, with **Fake User** on (the shield icon next to the
  Action's name). Without it Blender throws away Actions that aren't in use
  when you save.
- **In place.** He stays at the origin facing −Y (towards you in Front view);
  the game moves and turns him. The hips can shift, bob and turn within the
  stance, but no walking off.
- **Feet on the ground**, and planted (not sliding) in every golf clip. The
  game stands him by the ball, so his feet should stay where they are.
- **Keys on the deforming bones only.** If you animate with IK or a control
  rig, that's fine: the export bakes it down (see Exporting).
- **Any frame rate** (30 fps is a good default). The golf clips are re-timed by
  the game, so only the poses along the way matter, not how long the clip is.
- **Right-handed.** At address the ball is on the ground in front of him and
  the target is off to **his left** (+X in Blender).

## The club

- A bone named **`club`**, parented to the right hand. Its head sits at the
  top of the grip and it points down the shaft, with its tail at the sole of
  the club head. Make it **1.00 m** long: the game's 8-iron.
- Both hands on the grip in every golf clip, the left hand above the right.
- The game hides its club model outside the golf clips, so in the other clips
  it doesn't matter where the `club` bone is.
- Optionally, an **Empty named `ball`** on the ground where the ball sits at
  address. It isn't exported to the game; it's there so you (and I) can check
  that the club face meets the ball at address and at impact.
- The swing clips are animated with this 8-iron. For the longer and shorter
  clubs (driver about 1.14 m, wedge 0.97 m) the game tilts his arms and spine
  slightly so the club head still meets the ball. The putter (0.92 m) has its
  own clips; make the `club` bone 0.92 m long while you animate those (or tell
  me the length you used).

## The clips

### Standing about and moving

| Clip | Loops | When the game plays it |
| --- | --- | --- |
| `idle` | yes | Standing still: on the course, at the clubhouse. 2–4 seconds of breathing and a small weight shift. His stance lives here: for Surlaw, chest out, shoulders back, feet planted wide. |
| `walk` | yes | Walking. Exactly one full stride (left foot and right foot), in place. Animate a natural pace: the game measures his stride from the feet and plays the clip faster or slower to match his speed, so his feet don't slide. |
| `run` | yes | Running (Shift, or the stick pushed all the way). Same rules as `walk`. The game blends between `idle`, `walk` and `run` by speed. |
| `wave` | yes | On the golfer select screen when he's picked. About 1.5 seconds. |
| `sit_drive` | yes | Driving the cart: sitting, hands on the steering wheel (forward of his chest and a little below it). Keep his pelvis where it is in the rest pose; the game lowers him onto the seat. |

### The full swing

| Clip | Loops | When the game plays it |
| --- | --- | --- |
| `address` | yes | Standing over the ball with the 8-iron, the club sole flat on the ground just behind the ball. A slight breath or waggle is fine. **Frame 0 is the pose the game measures** to stand him at the ball. |
| `swing_back` | no | From address to the top of the backswing. **The game scrubs it**: while you hold the button it shows the frame that matches how far you've wound up (none = the first frame, full power = the last), and holds the last frame (adding a tremble if you hang there). So spread the motion evenly across the frames, with no slow start. The first frame must match `address` frame 0. |
| `swing_down` | no | From the top to impact. The game plays it in about a quarter of a second. Its last frame is impact: the club face back at the ball. For a part swing the game starts it part way in. *Optional*: without it the game plays `swing_back` backwards (it looks more mechanical). |
| `swing_follow` | no | From impact to the finish. The game plays it in about half a second and holds the last frame until you move off. On chips and part swings it stops part way, for a shorter follow-through. Its first frame must match the last frame of `swing_down`. |

### Putting

| Clip | Loops | When the game plays it |
| --- | --- | --- |
| `putt_address` | yes | Standing over the ball with the putter. **Frame 0 is the pose the game measures.** |
| `putt_back` | no | From address back to the top of the longest backstroke. Scrubbed like `swing_back`: short putts only use the start of it. The downstroke is this clip played backwards, so the stroke stays a pendulum. |
| `putt_through` | no | From the ball through to the end of the follow-through (the longest putt's). The game plays a share of it in proportion to the putt. Its first frame must match `putt_address` frame 0. |

### Optional extras

The game doesn't need these, but if they're in the file I'll hook them up:

| Clip | Loops | Would play |
| --- | --- | --- |
| `cheer` | no | After holing out under par. |
| `dismay` | no | When the ball goes in the water or out of bounds. |
| `pick_club` | no | Pulling a club out of the bag. |
| `sit_ride` | yes | Riding as a passenger (hands on the knees). Only caddies do this today. |

## How the game times the swing

For reference, so you can judge how it will look:

- **Backswing**: about 1.3 s from address to the top at full power (a little
  quicker with the driver, slower with the wedge). Up to about 2 s for the
  longest putt.
- **Downswing**: 0.24 s (putts 0.3 s).
- **Follow-through**: 0.5 s (putts 0.4 s), then held.

## Exporting

I'll add a one-click export script to your .blend. Until then, export by hand:
**File → Export → glTF 2.0**, with these settings:

- Format: **glTF Binary (.glb)**.
- Include: the armature and his mesh (Selected Objects, if anything else is in
  the file).
- Transform: **+Y Up** (the default).
- Mesh: Apply Modifiers is fine; the Armature modifier is handled separately.
- Animation: **Animation on**, Mode **Actions** (exports every Action), and
  **Always Sample Animations on** (this bakes IK and constraints onto the
  bones).
- Skinning: on, with **4 bone influences** per vertex.

Then, in the game: **Workshop → G. Surlaw body (human) → Replace…** and pick
the .glb.

## Checklist for the first file

- One armature, with his mesh bound to it (Armature modifier) and weight
  painted.
- Real size in metres (about 1.83 m for 6′0″), scale and rotation applied.
- Feet at the origin, facing −Y, rest pose a T-pose or A-pose.
- Bones named clearly, with `.L` / `.R` for sides. For example: `hips`,
  `spine`, `chest`, `neck`, `head`, `shoulder.L`, `upper_arm.L`, `forearm.L`,
  `hand.L`, `thigh.L`, `shin.L`, `foot.L`, `toe.L`, plus the `club` bone. Tell
  me what any extra bones are for (moustache, belly, fingers).
- Materials named `skin`, `shirt`, `pants`, `hair`, `shoe` and `eye`, so the
  golfer's colours still apply. Anything else keeps its own colour.
- Image textures packed in (File → External Data → Pack Resources).
- Any of the clips above you've already made. I can write a first version of
  any that are missing, as Actions in the file, for you to change.
