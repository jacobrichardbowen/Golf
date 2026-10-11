# Custom assets

Files in this folder replace the game's built-in models and textures when you
run `python3 build.py`. Name each file after the asset it replaces:

| File | Replaces |
| --- | --- |
| `tree-pine.glb`, `tree-oak.glb` | the two tree types (any size; rescaled per tree) |
| `tee-marker.glb` | the tee box markers |
| `clubhouse.glb` | the clubhouse |
| `club-driver.glb`, `club-4-iron.glb`, `club-8-iron.glb`, `club-wedge.glb`, `club-putter.glb` | the clubs |
| `golf-bag.glb` | the bag |
| `golf-cart.glb` | the cart |
| `golfer.glb` | the body shared by every golfer and the caddy |
| `tex-grass.png`, `tex-water.png`, `tex-flag.png`, `tex-cloud.png` | textures |

The easiest way is the in-game **Workshop**: download the asset you want to
change (the file name is already right), edit it in Blender, load it back
with **Replace…**, then press **Commit to project**. That writes the file
here, and the Rebuild game GitHub Action builds it into `Golf.html` for
everyone. You can also drop files in here by hand and run `python3 build.py`.

Models are glTF binary in meters, +Y up, front facing +Z. See the Workshop
section of the main README for the notes on trees, the golfer rig and the
cart.
