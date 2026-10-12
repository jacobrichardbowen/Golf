"""Build the starter course file for modelling a hole in Blender.

    python make_starter.py course-starter.blend

Needs Blender's Python module (pip install bpy) or run inside Blender:
    blender --background --python make_starter.py -- course-starter.blend

The file holds an example par 4 laid out the way the game reads a course:
a terrain mesh whose faces carry surface materials, empties for the tee and
the pin, a curve for the line of play, a water plane, example trees and a
shed. See the "READ ME" text inside the file (Scripting workspace) and
"Building a course in Blender" in the README.
"""
import math
import sys

import bpy

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else (sys.argv[1] if len(sys.argv) > 1 else "course-starter.blend")

# ---- layout (metres; +Y is the direction of play, Z is up) -------------------
W, L, STEP = 220, 340, 1.0          # terrain size and grid spacing
X0, Y0 = -W / 2, -170               # south-west corner
TEE = (0.0, -150.0)
GREEN = (20.0, 140.0)
PIN = (23.0, 143.0)


def fairway_x(y):
    """Centre of the fairway: a gentle dogleg right."""
    return 18 * math.sin((y + 150) / 300 * math.pi) * (0.3 + 0.7 * max(0.0, (y + 60) / 200))


def ellipse(x, y, cx, cy, rx, ry, rot=0.0):
    c, s = math.cos(rot), math.sin(rot)
    dx, dy = x - cx, y - cy
    u, v = dx * c + dy * s, -dx * s + dy * c
    return (u / rx) ** 2 + (v / ry) ** 2   # < 1 inside


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


BUNKERS = [(38.0, 128.0, 7.0, 4.5, 0.5), (-15.0, 42.0, 9.0, 4.5, -0.3), (2.0, 158.0, 8.0, 3.5, 0.1)]
POND = (-34.0, -40.0, 22.0, 13.0, 0.35)
WATER_LEVEL = -0.45


def surface(x, y):
    """The surface the example is painted with (the game reads the material names)."""
    if ellipse(x, y, *POND) < 0.9:
        return "water"
    for b in BUNKERS:
        if ellipse(x, y, *b) < 1:
            return "sand"
    if ellipse(x, y, GREEN[0], GREEN[1], 16, 13, 0.3) < 1:
        return "green"
    if abs(x - TEE[0]) < 6 and abs(y - TEE[1]) < 10:
        return "tee"
    if y > 168:
        return "out of bounds"
    cx = fairway_x(y)
    if abs(x - (cx + 38)) < 1.3 and -150 < y < 150:
        return "path"
    d = abs(x - cx)
    # Rounded ends: the fairway narrows to nothing at y = -95 and y = 125.
    ends = min(1.0, math.sqrt(max(0.0, (y + 95) / 14)), math.sqrt(max(0.0, (125 - y) / 16)))
    if d < (15 + 3 * math.sin(y / 23)) * ends:
        return "fairway"
    if d > 62 + 6 * math.sin(y / 31):
        return "forest"
    if d > 44:
        return "deep rough"
    return "rough"


def base(x, y):
    """Gentle rolling ground, calmer along the playing corridor."""
    h = 1.6 * math.sin(x / 37) * math.cos(y / 53) + 0.9 * math.sin((x + y) / 23) + 0.004 * y
    return h * (0.45 + 0.55 * smooth(10, 45, abs(x - fairway_x(y))))


def height(x, y):
    """Ground height: the rolling base with the features cut in or raised."""
    h = base(x, y)
    # Tee: a flat pad 0.6 m up.
    t = max(abs(x - TEE[0]) - 6, abs(y - TEE[1]) - 10)
    h += (base(*TEE) + 0.6 - h) * (1 - smooth(0, 3, t))
    # Green: raised 0.5 m, tilted about 1.5 % back towards the fairway.
    g = ellipse(x, y, GREEN[0], GREEN[1], 16, 13, 0.3)
    green_h = base(*GREEN) + 0.5 + 0.015 * (y - GREEN[1]) + 0.006 * (x - GREEN[0])
    w = 1 - smooth(0.9, 1.8, g)
    h += (green_h - h) * w
    # Bunkers: dished up to 0.8 m deep, with a small lip.
    for b in BUNKERS:
        e = ellipse(x, y, *b)
        if e < 1:
            h -= 0.8 * (1 - smooth(0.3, 1.0, e))
        elif e < 1.4:
            h += 0.15 * math.sin(math.pi * (e - 1) / 0.4)
    # Pond: a bowl below the water plane, sloping up to a low bank.
    e = ellipse(x, y, *POND)
    if e < 1:
        h = WATER_LEVEL + 0.25 - 1.6 * (1 - e) ** 0.7
    elif e < 1.6:
        k = smooth(1.0, 1.6, e)
        h = (WATER_LEVEL + 0.25) * (1 - k) + h * k
    return h


# ---- materials -------------------------------------------------------------
SURFACES = {
    "green": (0.30, 0.62, 0.18), "fairway": (0.22, 0.48, 0.10), "tee": (0.26, 0.55, 0.14),
    "rough": (0.13, 0.30, 0.06), "deep rough": (0.09, 0.20, 0.04), "forest": (0.05, 0.13, 0.03),
    "sand": (0.82, 0.70, 0.46), "water": (0.05, 0.18, 0.40), "path": (0.35, 0.22, 0.12),
    "out of bounds": (0.25, 0.25, 0.25),
}


def material(name, rgb, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, alpha)
    if not m.node_tree:   # Blender before 5.0 only uses nodes when asked
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9 if name != "water" else 0.05
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
    return m


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def main():
    # Start empty.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"

    mats = {k: material(k, v) for k, v in SURFACES.items()}
    order = list(SURFACES)
    course, markers, trees, props = (collection(n) for n in ("Course", "Markers", "Trees", "Props"))

    # Terrain: a grid, one material per face.
    nx, ny = int(W / STEP), int(L / STEP)
    verts = [(X0 + i * STEP, Y0 + j * STEP, height(X0 + i * STEP, Y0 + j * STEP)) for j in range(ny + 1) for i in range(nx + 1)]
    faces = []
    mat_idx = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
            mat_idx.append(order.index(surface(X0 + (i + 0.5) * STEP, Y0 + (j + 0.5) * STEP)))
    me = bpy.data.meshes.new("terrain")
    me.from_pydata(verts, [], faces)
    for m in order:
        me.materials.append(mats[m])
    me.polygons.foreach_set("material_index", mat_idx)
    me.polygons.foreach_set("use_smooth", [True] * len(faces))
    # UVs in metres / 4, so a tiled texture on any material repeats every 4 m.
    uv = me.uv_layers.new(name="tiling")
    uvs = []
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = verts[me.loops[li].vertex_index]
            uvs += [co[0] / 4, co[1] / 4]
    uv.data.foreach_set("uv", uvs)
    me.update()
    terrain = bpy.data.objects.new("terrain", me)
    course.objects.link(terrain)

    # Water: a flat sheet at the pond's level, just covering the bowl.
    cx, cy, rx, ry, rot = POND
    n = 48
    ring = [(rx * 1.02 * math.cos(a), ry * 1.02 * math.sin(a)) for a in (k / n * math.tau for k in range(n))]
    c, sn = math.cos(rot), math.sin(rot)
    wme = bpy.data.meshes.new("water")
    wme.from_pydata([(cx + u * c - v * sn, cy + u * sn + v * c, WATER_LEVEL) for u, v in ring], [], [tuple(range(n))])
    wme.materials.append(material("water surface", (0.08, 0.30, 0.55), 0.7))
    water = bpy.data.objects.new("water", wme)
    course.objects.link(water)

    # Tee and pin: empties on the ground.
    for name, (x, y), shape in (("tee", TEE, "PLAIN_AXES"), ("pin", PIN, "SINGLE_ARROW")):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = shape
        e.empty_display_size = 2 if name == "tee" else 3
        e.location = (x, y, height(x, y))
        markers.objects.link(e)

    # Line of play: tee -> landing area -> green.
    cu = bpy.data.curves.new("line", "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    pts = [TEE, (fairway_x(-10), -10), (fairway_x(80), 80), GREEN]
    sp.points.add(len(pts) - 1)
    for p, (x, y) in zip(sp.points, pts):
        p.co = (x, y, height(x, y) + 0.3, 1)
    line = bpy.data.objects.new("line", cu)
    markers.objects.link(line)

    # Example trees: linked duplicates of two simple models, sized by scale (1 = 10 m tall).
    bark = material("bark", (0.22, 0.14, 0.08))
    leaves = material("leaves", (0.08, 0.25, 0.07))
    pine_me = tree_mesh("pine", bark, leaves, cone=True)
    oak_me = tree_mesh("oak", bark, leaves, cone=False)
    import random
    rnd = random.Random(7)
    placed = 0
    for k in range(400):
        y = rnd.uniform(-150, 150)
        side = rnd.choice((-1, 1))
        x = fairway_x(y) + side * rnd.uniform(36, 60)
        if surface(x, y) not in ("rough", "deep rough") or placed >= 40:
            continue
        pine = rnd.random() < 0.55
        o = bpy.data.objects.new(f"{'pine' if pine else 'oak'}.{placed:03d}", pine_me if pine else oak_me)
        o.location = (x, y, height(x, y) - 0.1)
        s = rnd.uniform(0.9, 1.5)
        o.scale = (s, s, s)
        o.rotation_euler = (0, 0, rnd.uniform(0, math.tau))
        trees.objects.link(o)
        placed += 1

    # A prop: anything that isn't terrain, water, a marker or a tree becomes scenery.
    wood = material("wood", (0.40, 0.26, 0.14))
    roof = material("roof", (0.20, 0.25, 0.45))
    bpy.ops.mesh.primitive_cube_add(size=1)
    shed = bpy.context.object
    shed.name = "shed"
    shed.data.name = "shed"
    shed.scale = (4, 3, 2.6)
    shed.location = (16, -158, height(16, -158) + 1.3)
    shed.data.materials.append(wood)
    for c in shed.users_collection:
        c.objects.unlink(shed)
    props.objects.link(shed)

    # Instructions, readable in the Text Editor.
    txt = bpy.data.texts.new("READ ME")
    txt.write(README)

    # Look at it from above in the default view.
    cam_data = bpy.data.cameras.new("overview")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 360
    cam = bpy.data.objects.new("overview", cam_data)
    cam.location = (0, 0, 300)
    scene.collection.objects.link(cam)
    scene.camera = cam

    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    print("wrote", OUT, len(faces), "terrain faces,", placed, "trees")


def tree_mesh(name, bark, leaves, cone):
    """A 10 m tall placeholder tree (the game uses its own tree models)."""
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.35, radius2=0.25, depth=4,
                          matrix=__import__("mathutils").Matrix.Translation((0, 0, 2)))
    n_trunk = len(bm.faces)
    if cone:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=2.6, radius2=0, depth=7.5,
                              matrix=__import__("mathutils").Matrix.Translation((0, 0, 6.2)))
    else:
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=3.6,
                                   matrix=__import__("mathutils").Matrix.Translation((0, 0, 6.6)))
    for i, f in enumerate(bm.faces):
        f.material_index = 0 if i < n_trunk else 1
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bark)
    me.materials.append(leaves)
    return me


README = """PINEHAVEN GOLF - COURSE STARTER

Model in metres (Blender's default). +Y is the general direction of play
in this example, but any direction works: the tee and pin decide it.

THE GROUND
  "terrain" is the surface the golfers walk on and the ball rolls on.
  Sculpt it, extend it or replace it. Bunkers, mounds and green
  contours should be shaped into it. Keep greens smooth and gentle
  (under about 3% slope) or putts will run away.

SURFACES - by material name on the terrain's faces
  green, fairway, tee, rough, deep rough, forest, sand, water, path,
  out of bounds
  Assign them in Edit Mode (select faces, pick the material, Assign).
  Names may have suffixes ("green.001"). Unmarked faces are rough.
  Forest is deep rough that the game fills with trees.
  Fringe around greens is added automatically.
  Each material can have its own tiled texture: add an Image Texture
  node to its Base Color. The terrain's UVs are in metres / 4, so an
  image repeats every 4 m; scale the UVs to change that.

WATER
  Mark the pond's bed "water" and keep the plane named "water" at the
  surface level (one plane per pond or one big plane is fine).

TEE, PIN, LINE OF PLAY
  Empties named "tee" and "pin" (for more holes: "tee 2", "pin 2", ...).
  The curve "line" is the line of play used for yardages and aiming;
  delete it and one is worked out from tee to pin.

TREES
  Objects whose names start with "pine" or "oak" become the game's
  trees at that spot, as tall as yours (the examples are 10 m at scale 1).
  Any other name starting "tree" becomes an oak.

EVERYTHING ELSE
  Other objects (like "shed") become scenery the golfers can't walk
  through. They keep their own models and materials.

Send the .blend (or a .glb export) and say which hole it is.
"""

if __name__ == "__main__":
    main()
