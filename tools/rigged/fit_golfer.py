"""Fit an Auto-Rig Pro character for the game, and export it.

An Auto-Rig Pro (ARP) rig has hundreds of bones: controls, IK/FK helpers and
twist bones, with the deforming ones hung off controls rather than off each
other. The game wants a plain skeleton (hips > spine > ... > hand), so fitting
a file adds:

  golfer_rig   a clean skeleton of the bones the game knows (hips, spine,
               chest, upper_chest, neck, head, and per side shoulder,
               upper_arm, forearm, hand, the fingers the rig has, thigh,
               shin, foot, toe), plus `club` (in the right hand) and
               `grip.L`/`grip.R` (where each hand holds the club). Each bone
               follows its ARP deform bone through a constraint, so you keep
               animating with the ARP controls. It's rebuilt from the ARP rig
               every time you export, so changes to the rig carry over.
  cc_club      a bone in the ARP rig, in the right hand, for animating the
               club (ARP keeps bones named cc_* when the rig is regenerated).
  reference    a club model on cc_club and the ball at address, to animate
               against (not exported).
  READ ME      how the file works and how to make another golfer from it.
  game_body    a Scene custom property: the game body the export becomes
               (golfer-salt, golfer-cord, ...), and so its file name.

and, if the mesh has a single material, paints it in regions with materials
named skin, shirt, pants, hair and shoe (the game colours these per golfer):
knickers and the waist are pants, the torso and the top of the sleeves shirt,
the socks and feet shoe, a cap of hair, and the rest skin. Repaint them in
Blender any time (assign the faces to another of those materials).

Exporting rebuilds golfer_rig, makes a copy of the mesh bound to it (its ARP
weights merged into the game bones), bakes every Action through the
constraints onto golfer_rig (named as the Action), writes <game_body>.glb
next to the .blend and throws the copy away.

Run with Blender's Python (pip install bpy), or in Blender's Text Editor
(this script is stored in the fitted file as "export_golfer.py": Run Script
there exports):

  python fit_golfer.py -- in.blend [--body golfer-salt] [--save fitted.blend] [--glb out.glb]
"""
import os
import re
import sys

import bpy
from mathutils import Matrix, Vector

GAME = 'golfer_rig'
REFERENCE = 'reference (not exported)'
FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')
BODIES = ('golfer-salt', 'golfer-cord', 'golfer-surlaw', 'golfer-froth', 'golfer-beetor', 'golfer')


# ---------------------------------------------------------------------------
# The game skeleton, read off the ARP rig

def game_table(bones):
    """Game bone -> (parent, head (ARP bone, 'head'|'tail'), tail, ARP bone it
    follows, 'rotation'|'transforms'), for the bones this rig has."""
    has = lambda n: n in bones
    first = lambda *ns: next((n for n in ns if has(n)), None)
    t = {'hips': (None, ('root.x', 'head'), ('root.x', 'tail'), 'root.x', 'transforms')}
    top = 'hips'
    for arp, name in (('spine_01.x', 'spine'), ('spine_02.x', 'chest'), ('spine_03.x', 'upper_chest'), ('spine_04.x', 'upper_chest_2')):
        if has(arp):
            t[name] = (top, (arp, 'head'), (arp, 'tail'), arp, 'rotation')
            top = name
    if has('neck.x'):
        t['neck'] = (top, ('neck.x', 'head'), ('neck.x', 'tail'), 'neck.x', 'rotation')
    if has('head.x'):
        t['head'] = ('neck' if 'neck' in t else top, ('head.x', 'head'), ('head.x', 'tail'), 'head.x', 'rotation')
    for s, S in (('l', 'L'), ('r', 'R')):
        def add(name, parent, head, tail, follow):
            t[f'{name}.{S}'] = (parent, head, tail, follow, 'rotation')
        arm_parent = top
        if has(f'shoulder.{s}'):
            add('shoulder', top, (f'shoulder.{s}', 'head'), (f'shoulder.{s}', 'tail'), f'shoulder.{s}')
            arm_parent = f'shoulder.{S}'
        up0 = first(f'c_arm_twist_offset.{s}', f'arm_twist.{s}', f'arm_stretch.{s}')
        add('upper_arm', arm_parent, (up0, 'head'), (f'forearm_stretch.{s}', 'head'), f'arm_stretch.{s}')
        add('forearm', f'upper_arm.{S}', (f'forearm_stretch.{s}', 'head'), (f'hand.{s}', 'head'), f'forearm_stretch.{s}')
        add('hand', f'forearm.{S}', (f'hand.{s}', 'head'), (f'hand.{s}', 'tail'), f'hand.{s}')
        for f in FINGERS:
            chain = ([f'{f}1', f'c_{f}2', f'c_{f}3'] if f == 'thumb' else [f'c_{f}1_base', f'{f}1', f'c_{f}2', f'c_{f}3'])
            names = ['01', '02', '03'] if f == 'thumb' else ['00', '01', '02', '03']
            parent = f'hand.{S}'
            for arp, n in zip(chain, names):
                arp = f'{arp}.{s}'
                if has(arp):
                    add(f'{f}_{n}', parent, (arp, 'head'), (arp, 'tail'), arp)
                    parent = f'{f}_{n}.{S}'
        th0 = first(f'thigh_twist.{s}', f'thigh_stretch.{s}')
        add('thigh', 'hips', (th0, 'head'), (f'leg_stretch.{s}', 'head'), f'thigh_stretch.{s}')
        add('shin', f'thigh.{S}', (f'leg_stretch.{s}', 'head'), (f'foot.{s}', 'head'), f'leg_stretch.{s}')
        add('foot', f'shin.{S}', (f'foot.{s}', 'head'), (f'foot.{s}', 'tail'), f'foot.{s}')
        if has(f'toes_01.{s}'):
            add('toe', f'foot.{S}', (f'toes_01.{s}', 'head'), (f'toes_01.{s}', 'tail'), f'toes_01.{s}')
    return t


def group_target(group, table, rig):
    """The game bone an ARP vertex group's weights go to."""
    m = re.match(r'^(.*)\.([lrx])$', group)
    base, side = (m.group(1), m.group(2)) if m else (group, 'x')
    S = {'l': '.L', 'r': '.R'}.get(side, '')
    for name, (_p, head, _t, follow, _h) in table.items():
        if group in (head[0], follow):
            return name
    rules = [
        (r'^(c_)?arm_(twist|stretch)|^c_arm_twist_offset', 'upper_arm'),
        (r'^(c_)?forearm_(twist|stretch)', 'forearm'),
        (r'^(c_)?thigh_(twist|stretch)', 'thigh'),
        (r'^(c_)?leg_(twist|stretch)', 'shin'),
        (r'^(c_)?toes', 'toe'),
        (r'^(c_)?shoulder', 'shoulder'),
        (r'^(c_)?(hand|wrist)', 'hand'),
        (r'^(c_)?foot', 'foot'),
        (r'^(c_)?bot', 'thigh'),
    ]
    fm = re.match(r'^(c_)?(thumb|index|middle|ring|pinky)(\d)(_base)?', base)
    if fm:
        f, n = fm.group(2), int(fm.group(3))
        name = f'{f}_00{S}' if fm.group(4) else f'{f}_0{n}{S}'
        if name in table:
            return name
        return f'hand{S}'
    for pat, name in rules:
        if re.search(pat, base) and name + S in table:
            return name + S
    if re.search(r'neck', base) and 'neck' in table:
        return 'neck'
    if re.search(r'head|jaw|eye|lip|tong|teeth|ear|nose|cheek|chin|brow', base) and 'head' in table:
        return 'head'
    if re.search(r'breast|chest', base):
        return 'chest' if 'chest' in table else 'spine'
    # Anything else: whatever its nearest deforming ancestor goes to.
    b = rig.data.bones.get(group)
    p = b and b.parent
    while p:
        if p.use_deform and p.name != group:
            return group_target(p.name, table, rig)
        p = p.parent
    return None


# ---------------------------------------------------------------------------

def find_rig_and_meshes():
    rigs = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name != GAME and 'root.x' in o.data.bones]
    if not rigs:
        raise SystemExit('No Auto-Rig Pro rig (an armature with a root.x bone) in this file.')
    rig = rigs[0]
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)]
    if not meshes:
        raise SystemExit(f'No mesh is bound to {rig.name}.')
    return rig, meshes


def object_mode():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')


def edit_mode(obj):
    object_mode()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.hide_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')


def collection(name, hide=False):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(c)
    return c


def grip_point(rig, s):
    """Where a hand holds the club: between the base of the index finger and
    the middle of the thumb (armature space)."""
    bones = rig.data.bones
    a, b = bones.get(f'index1.{s}'), bones.get(f'c_thumb2.{s}')
    if a and b:
        return (a.head_local + b.head_local) / 2
    h = bones[f'hand.{s}']
    return h.head_local.lerp(h.tail_local, 0.5)


def add_club_control(rig):
    """cc_club in the ARP rig: in the right hand, down the shaft, 1 m (the 8-iron)."""
    if 'cc_club' in rig.data.bones:
        return
    edit_mode(rig)
    eb = rig.data.edit_bones
    hand = eb['hand.r']
    g = grip_point(rig, 'r')
    club = eb.new('cc_club')
    club.head = g
    club.tail = g + (hand.tail - hand.head).normalized() * 1.0
    club.parent = hand
    club.use_deform = False
    object_mode()


def build_game_rig(rig):
    """golfer_rig: the clean skeleton, following the ARP bones (rebuilt from
    scratch each time)."""
    old = bpy.data.objects.get(GAME)
    if old:
        arm = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        bpy.data.armatures.remove(arm)
    src = rig.data.bones
    table = game_table(src)
    arm = bpy.data.armatures.new(GAME)
    obj = bpy.data.objects.new(GAME, arm)
    collection('golfer_export').objects.link(obj)
    obj.matrix_world = rig.matrix_world.copy()
    obj.show_in_front = True
    arm.display_type = 'STICK'
    edit_mode(obj)
    eb = arm.edit_bones
    for name, (parent, head, tail, follow, how) in table.items():
        b = eb.new(name)
        b.head = getattr(src[head[0]], head[1] + '_local')
        b.tail = getattr(src[tail[0]], tail[1] + '_local')
        b.align_roll(src[follow].matrix_local.col[2].xyz)
        b.use_deform = True
    for name, (parent, *_rest) in table.items():
        if parent:
            eb[name].parent = eb[parent]
    for s, S in (('l', 'L'), ('r', 'R')):
        g = eb.new(f'grip.{S}')
        hand = eb[f'hand.{S}']
        g.head = grip_point(rig, s)
        g.tail = g.head + (hand.tail - hand.head).normalized() * 0.04
        g.parent = hand
        g.use_deform = False
    club = eb.new('club')
    c = src['cc_club']
    club.head, club.tail = c.head_local, c.tail_local
    club.align_roll(c.matrix_local.col[2].xyz)
    club.parent = eb['hand.R']
    club.use_deform = False
    object_mode()
    for name, (parent, head, tail, follow, how) in list(table.items()) + [('club', (None, None, None, 'cc_club', 'transforms'))]:
        pb = obj.pose.bones[name]
        con = pb.constraints.new('COPY_TRANSFORMS' if how == 'transforms' else 'COPY_ROTATION')
        con.name = 'follow ARP'
        con.target, con.subtarget = rig, follow
        con.target_space = con.owner_space = 'WORLD'
    obj.hide_set(True)  # it's for the game: animate with the ARP controls
    return obj, table


# ---------------------------------------------------------------------------
# Colour regions

# Colours for the painted regions as they look in Blender (A. Salt's); the
# game recolours them for whoever wears the body.
REGION_COLOURS = {
    'skin': (0xe6, 0xb4, 0x8e), 'shirt': (0x1d, 0x1d, 0x21), 'pants': (0xb3, 0x20, 0x2a),
    'hair': (0xa8, 0x43, 0x2a), 'shoe': (0x1d, 0x1d, 0x21), 'shoe.socks': (0x2a, 0x2a, 0x30),
}


def srgb(c):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (lin(c[0]), lin(c[1]), lin(c[2]), 1.0)


def material(name, col):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = srgb(col)
    m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Base Color'].default_value = srgb(col)
        bsdf.inputs['Roughness'].default_value = 0.8
    return m


def paint_regions(mesh_obj):
    """skin / shirt / pants / hair / shoe regions, from which bone moves each
    face and where it is."""
    me = mesh_obj.data
    if len(me.materials) > 1 or any(m and m.name.split('.')[0].lower() in REGION_COLOURS for m in me.materials):
        return False
    mats = {name: material(name, col) for name, col in REGION_COLOURS.items()}
    me.materials.clear()
    order = list(mats)
    for m in mats.values():
        me.materials.append(m)
    names = [g.name for g in mesh_obj.vertex_groups]
    arm = mesh_obj.parent.data if mesh_obj.parent and mesh_obj.parent.type == 'ARMATURE' else None
    head = arm and arm.bones.get('head.x')
    hz, hy = (head.head_local.z, head.head_local.y) if head else (1.59, 0.03)
    # The hem: the bottom of the downward-facing ring of faces around the knee.
    knee = arm and arm.bones.get('leg_stretch.l')
    kz = knee.head_local.z if knee else 0.47
    under = [p.center.z for p in me.polygons if abs(p.center.z - kz) < 0.12 and p.normal.z < -0.5 and abs(p.center.x) > 0.03]
    hem = (min(under) - 0.01) if under else kz + 0.02

    def dominant(p):
        w = {}
        for vi in p.vertices:
            for g in me.vertices[vi].groups:
                w[names[g.group]] = w.get(names[g.group], 0) + g.weight
        return max(w, key=w.get) if w else ''

    for p in me.polygons:
        d, c = dominant(p), p.center
        base = d.split('.')[0]
        if base in ('head', 'neck'):
            # A cap of hair: the crown, and round the back and sides down to the ears.
            top = c.z - hz
            region = 'hair' if top > 0.155 or (c.y > hy - 0.04 and top > 0.03) or (c.y > hy + 0.01 and top > -0.02) else 'skin'
        elif base in ('spine_01', 'spine_02', 'spine_03', 'shoulder', 'c_arm_twist_offset'):
            region = 'shirt'
        elif base == 'root':
            region = 'shirt' if c.z > 1.0 else 'pants'
        elif base in ('thigh_twist', 'thigh_stretch', 'leg_stretch', 'leg_twist'):
            # The knickers end in a hem just below the knee: the underside of
            # their flare is the lowest of the knickers.
            region = 'pants' if c.z > hem else 'shoe.socks'
        elif base in ('foot', 'toes_01'):
            region = 'shoe'
        else:
            region = 'skin'  # arms below the sleeve, hands, fingers
        p.material_index = order.index(region)
    return True


def weigh_strays(mesh_obj):
    """Vertices with no weights don't move with the body: give each the
    weights of the nearest vertex that has some."""
    me = mesh_obj.data
    stray = [v for v in me.vertices if sum(g.weight for g in v.groups) <= 0]
    if not stray:
        return 0
    from mathutils import kdtree
    held = [v for v in me.vertices if sum(g.weight for g in v.groups) > 0]
    kd = kdtree.KDTree(len(held))
    for i, v in enumerate(held):
        kd.insert(v.co, i)
    kd.balance()
    for v in stray:
        _co, i, _d = kd.find(v.co)
        for g in held[i].groups:
            mesh_obj.vertex_groups[g.group].add([v.index], g.weight, 'REPLACE')
    return len(stray)


# ---------------------------------------------------------------------------
# Things to animate against

def add_reference(rig):
    """A club model on cc_club (the 8-iron: 1 m, grip at the top, the head at
    the sole) and the ball where it sits at address; neither is exported."""
    coll = collection(REFERENCE)
    if not bpy.data.objects.get('club (reference)'):
        import bmesh
        me = bpy.data.meshes.new('club (reference)')
        bm = bmesh.new()
        # Built along +Y in cc_club's frame: from the grip end (0) to the sole (1).
        def tube(r0, r1, y0, y1, seg=8):
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=y1 - y0,
                                        matrix=Matrix.Translation((0, (y0 + y1) / 2, 0)) @ Matrix.Rotation(-1.5708, 4, 'X'))
            return res
        tube(0.0135, 0.0115, 0.0, 0.27)       # the grip
        tube(0.0065, 0.0050, 0.27, 0.975)     # the shaft
        head = bmesh.ops.create_cube(bm, size=1.0)['verts']
        bmesh.ops.scale(bm, vec=(0.075, 0.045, 0.022), verts=head)
        bmesh.ops.translate(bm, vec=(0.03, 0.985, 0.0), verts=head)  # toe out along +X
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material('club (reference)', (0x9a, 0xa4, 0xab)))
        obj = bpy.data.objects.new('club (reference)', me)
        coll.objects.link(obj)
        obj.parent, obj.parent_type, obj.parent_bone = rig, 'BONE', 'cc_club'
        bone = rig.data.bones['cc_club']
        # Bone parenting hangs the child off the bone's tail: undo that.
        obj.matrix_parent_inverse = Matrix.Translation((0, -bone.length, 0))
        obj.hide_select = False
    if not bpy.data.objects.get('ball'):
        ball = bpy.data.objects.new('ball', None)
        ball.empty_display_type = 'SPHERE'
        ball.empty_display_size = 0.0214
        ball.location = (0.0, -0.62, 0.0214)  # in front of him, at the middle of the stance
        coll.objects.link(ball)


README = """GOLFER TEMPLATE  (A. Salt, for Pinehaven Golf)

This file is a golfer for the game: an Auto-Rig Pro character fitted with
what the game needs. The export turns it into a .glb the game loads.

WHAT'S IN IT
- rig: the Auto-Rig Pro rig. Animate with its controls, as usual.
- BaseMeshBKP__0: the body, bound to rig.
- golfer_rig (collection golfer_export, hidden): the plain skeleton the game
  gets. It follows rig's deform bones, and the export rebuilds it every time,
  so leave it alone.
- cc_club (a bone in rig, in the right hand): the club, 1 m long (the
  8-iron), grip at its head, sole at its tail. "club (reference)" shows it.
- ball (reference): where the ball sits at address.
- Materials skin, shirt, pants, hair, shoe and shoe.socks: the game colours
  these per golfer (anything starting "shoe" takes the shoe colour). Any
  other material keeps its own colour. The colours here are Salt's.
- export_golfer.py: the export (Text Editor > Run Script).
- Scene Properties > Custom Properties > game_body: which golfer this is.

MAKING ANOTHER GOLFER FROM THIS FILE
1. File > Save As, under a new name.
2. Set game_body (Scene Properties > Custom Properties) to the body it
   becomes: golfer-salt, golfer-cord (the elf), golfer-surlaw,
   golfer-froth, golfer-beetor, or golfer (McBeaty and the caddy).
3. Model: change the mesh, add hair, ears, clothes. New parts need
   weights (Auto-Rig Pro > Bind, or weight paint them). Use the materials
   above for anything that should take the golfer's colours.
4. Proportions: Auto-Rig Pro > Edit Reference Bones, move them, Match to
   Rig, then bind again. golfer_rig follows on the next export.
5. Animate: one Action per clip, named as in tools/blender/ANIMATIONS.md
   (idle, walk, run, wave, address, swing_back, swing_down, swing_follow,
   putt_address, putt_back, putt_through), with Fake User on. Any clip
   that's missing, the game poses itself.
6. Export: open export_golfer.py in the Text Editor and Run Script. It
   writes <game_body>.glb next to this file (and says what went in).
7. In the game: Workshop > the golfer's body > Replace... and pick the
   .glb; Commit to project to share it. Or send the .blend to Claude.

RULES
- Real size, in metres: the game scales the body to the golfer's height
  (this one is 1.80 m; Salt is 5'10").
- He faces -Y, his left on +X, in an A-pose or T-pose.
- Auto-Rig Pro's own deform bone names (root.x, spine_01.x, arm_stretch.l,
  index1.l, ...): the export reads those. Extra fingers (middle, ring,
  pinky), twist bones and spine bones are fine.
"""


def add_readme():
    t = bpy.data.texts.get('READ ME') or bpy.data.texts.new('READ ME')
    t.from_string(README)


def store_script():
    """Keep this script in the file, to export from Blender's Text Editor."""
    here = os.path.abspath(__file__) if '__file__' in globals() else None
    if not here or not os.path.exists(here):
        return
    t = bpy.data.texts.get('export_golfer.py') or bpy.data.texts.new('export_golfer.py')
    t.from_string(open(here).read())


def show_text_in_editor(name):
    """Show a text in the file's Text Editors (the Scripting workspace)."""
    t = bpy.data.texts.get(name)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'TEXT_EDITOR':
                for sp in area.spaces:
                    if sp.type == 'TEXT_EDITOR':
                        sp.text = t


# ---------------------------------------------------------------------------
# Export

def action_paths(a):
    """The data paths an Action animates (layered Actions, Blender 4.4 on, or older ones)."""
    for layer in getattr(a, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    yield fc.data_path
    for fc in getattr(a, 'fcurves', None) or []:
        yield fc.data_path


def tell(msg):
    print(msg, flush=True)
    try:
        if not bpy.app.background and bpy.context.window:
            bpy.context.window_manager.popup_menu(lambda self, ctx: [self.layout.label(text=line) for line in msg.split('\n')],
                                                  title='Golfer export', icon='INFO')
    except Exception:
        pass


def export_glb(path=None):
    object_mode()
    rig, meshes = find_rig_and_meshes()
    add_club_control(rig)
    game, table = build_game_rig(rig)
    body = bpy.context.scene.get('game_body') or bpy.path.display_name_from_filepath(bpy.data.filepath) or 'golfer'
    path = path or bpy.path.abspath('//') + body + '.glb'
    game.hide_set(False)
    copies, lost, unweighted = [], set(), 0
    for src in meshes:
        o = src.copy()
        o.data = src.data.copy()
        o.name = src.name + '_game'
        bpy.context.scene.collection.objects.link(o)
        # Merge each ARP group into its game bone's group.
        target = {g.index: group_target(g.name, table, rig) for g in src.vertex_groups}
        weights = {}
        for v in o.data.vertices:
            total = 0
            for g in v.groups:
                dst = target.get(g.group)
                if g.weight <= 0:
                    continue
                if not dst:
                    lost.add(src.vertex_groups[g.group].name)
                    continue
                weights.setdefault(dst, {}).setdefault(v.index, 0)
                weights[dst][v.index] += g.weight
                total += g.weight
            unweighted += total <= 0
        o.vertex_groups.clear()
        for dst, vs in weights.items():
            vg = o.vertex_groups.new(name=dst)
            for vi, w in vs.items():
                vg.add([vi], min(1.0, w), 'REPLACE')
        for m in o.modifiers:
            if m.type == 'ARMATURE':
                m.object = game
        o.parent = game
        o.matrix_parent_inverse = game.matrix_world.inverted()
        copies.append(o)
    # Each Action (meant for the ARP rig), baked onto golfer_rig.
    baked = []
    rig.animation_data_create()
    game.animation_data_create()
    saved = rig.animation_data.action
    for act in [a for a in bpy.data.actions if not a.name.startswith('game.') and any('pose.bones' in p for p in action_paths(a))]:
        rig.animation_data.action = act
        f0, f1 = (int(v) for v in act.frame_range)
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        bpy.context.view_layer.objects.active = game
        game.select_set(True)
        bpy.ops.object.mode_set(mode='POSE')
        bpy.ops.pose.select_all(action='SELECT')
        bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=True, visual_keying=True, clear_constraints=False,
                         use_current_action=False, bake_types={'POSE'})
        object_mode()
        out = game.animation_data.action
        out.name = 'game.' + act.name
        out.use_fake_user = True
        track = game.animation_data.nla_tracks.new()
        track.name = act.name
        strip = track.strips.new(act.name, f0, out)
        strip.name = act.name
        game.animation_data.action = None
        baked.append(out)
    rig.animation_data.action = saved
    # The baked clips drive golfer_rig now, not the constraints.
    for pb in game.pose.bones:
        for c in pb.constraints:
            c.mute = True
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    game.select_set(True)
    for o in copies:
        o.select_set(True)
    bpy.context.view_layer.objects.active = game
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_skins=True, export_influence_nb=4, export_def_bones=False, export_rest_position_armature=True,
        export_animations=bool(baked), export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_materials='EXPORT', export_extras=False, export_cameras=False, export_lights=False)
    clips = [a.name[5:] for a in baked]
    for o in copies:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in baked:
        bpy.data.actions.remove(a)
    # Back to following the ARP rig, out of the way.
    game.animation_data_clear()
    for pb in game.pose.bones:
        for c in pb.constraints:
            c.mute = False
    game.hide_set(True)
    msg = f'Wrote {os.path.basename(path)}: {len(game.data.bones)} bones, {len(clips)} clip(s){": " + ", ".join(clips) if clips else ""}.'
    if lost:
        msg += f'\nNo game bone for these vertex groups (their weights are left out): {", ".join(sorted(lost))}.'
    if unweighted:
        msg += f'\n{unweighted} vertices have no weights: they won\'t move.'
    tell(msg)
    return path


def fit(body):
    rig, meshes = find_rig_and_meshes()
    add_club_control(rig)
    build_game_rig(rig)
    painted = [m.name for m in meshes if paint_regions(m)]
    strays = sum(weigh_strays(m) for m in meshes)
    add_reference(rig)
    add_readme()
    store_script()
    show_text_in_editor('READ ME')
    if body or 'game_body' not in bpy.context.scene:
        bpy.context.scene['game_body'] = body or 'golfer-salt'
    print(f'fitted: {GAME} built from {rig.name}; painted regions on {", ".join(painted) or "nothing (already has materials)"}; '
          f'game_body {bpy.context.scene["game_body"]}; {strays} vertices with no weights given their neighbours\'', flush=True)


def main(argv):
    if not argv:  # in Blender, from the Text Editor
        export_glb()
        return
    path = argv[0]
    opt = lambda k: argv[argv.index(k) + 1] if k in argv else None
    bpy.ops.wm.open_mainfile(filepath=path, load_ui=True, use_scripts=False)
    fit(opt('--body'))
    if opt('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=opt('--save'), compress=True)
    if opt('--glb'):
        export_glb(opt('--glb'))


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
