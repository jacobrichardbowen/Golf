"""Fit an Auto-Rig Pro character for the game, and export it.

An Auto-Rig Pro (ARP) rig has hundreds of bones: controls, IK/FK helpers and
twist bones, with the deforming ones hung off controls rather than off each
other. The game wants a plain skeleton (hips > spine > ... > hand), so this
adds one:

  golfer_rig   a clean skeleton of the bones the game knows (hips, spine,
               chest, upper_chest, neck, head, and per side shoulder,
               upper_arm, forearm, hand, the fingers, thigh, shin, foot, toe),
               plus `club` (in the right hand, tools/blender/ANIMATIONS.md) and
               `grip.L`/`grip.R` (where each hand holds the club). Each bone
               follows its ARP deform bone through a constraint, so you keep
               animating with the ARP controls as before.
  cc_club      a bone in the ARP rig, in the right hand, for animating the
               club (ARP keeps bones named cc_* when the rig is regenerated).

and, if the mesh has a single material, paints it in regions with materials
named skin, shirt, pants, hair and shoe (the game colours these per golfer):
knickers and the waist are pants, the torso and the top of the sleeves shirt,
the socks and feet shoe, a cap of hair, and the rest skin. Repaint them in
Blender any time (assign the faces to another of those materials).

Exporting makes a copy of the mesh bound to golfer_rig (its ARP weights
merged into the game bones), bakes every Action through the constraints
onto golfer_rig (named as the Action), writes a .glb and throws the copy
away; the .blend itself is left as it was.

Run with Blender's Python (pip install bpy), or in Blender's Text Editor
(this script is stored in the fitted file as "export_golfer.py": Run Script
there exports <file name>.glb next to the .blend):

  python fit_golfer.py -- in.blend [--save fitted.blend] [--glb out.glb]
"""
import os
import sys

import bpy
from mathutils import Vector

GAME = 'golfer_rig'


def arp_table():
    """Game bone -> (parent, ARP vertex groups merged into it, head from,
    tail from, ARP bone it follows, how)."""
    t = {
        'hips': (None, ['root.x'], ('root.x', 'head'), ('root.x', 'tail'), 'root.x', 'transforms'),
        'spine': ('hips', ['spine_01.x'], ('spine_01.x', 'head'), ('spine_01.x', 'tail'), 'spine_01.x', 'rotation'),
        'chest': ('spine', ['spine_02.x'], ('spine_02.x', 'head'), ('spine_02.x', 'tail'), 'spine_02.x', 'rotation'),
        'upper_chest': ('chest', ['spine_03.x'], ('spine_03.x', 'head'), ('spine_03.x', 'tail'), 'spine_03.x', 'rotation'),
        'neck': ('upper_chest', ['neck.x'], ('neck.x', 'head'), ('neck.x', 'tail'), 'neck.x', 'rotation'),
        'head': ('neck', ['head.x'], ('head.x', 'head'), ('head.x', 'tail'), 'head.x', 'rotation'),
    }
    for s, S in (('l', 'L'), ('r', 'R')):
        def b(name, parent, groups, head, tail, follow):
            t[f'{name}.{S}'] = (parent and f'{parent}.{S}' if parent not in ('upper_chest', 'hips') else parent,
                                [g.format(s=s) for g in groups], (head[0].format(s=s), head[1]), (tail[0].format(s=s), tail[1]),
                                follow.format(s=s), 'rotation')
        b('shoulder', 'upper_chest', ['shoulder.{s}'], ('shoulder.{s}', 'head'), ('shoulder.{s}', 'tail'), 'shoulder.{s}')
        b('upper_arm', 'shoulder', ['c_arm_twist_offset.{s}', 'arm_stretch.{s}'], ('c_arm_twist_offset.{s}', 'head'),
          ('arm_stretch.{s}', 'tail'), 'arm_stretch.{s}')
        b('forearm', 'upper_arm', ['forearm_stretch.{s}', 'forearm_twist.{s}'], ('forearm_stretch.{s}', 'head'),
          ('forearm_twist.{s}', 'tail'), 'forearm_stretch.{s}')
        b('hand', 'forearm', ['hand.{s}'], ('hand.{s}', 'head'), ('hand.{s}', 'tail'), 'hand.{s}')
        b('index_00', 'hand', ['c_index1_base.{s}'], ('c_index1_base.{s}', 'head'), ('c_index1_base.{s}', 'tail'), 'c_index1_base.{s}')
        b('index_01', 'index_00', ['index1.{s}'], ('index1.{s}', 'head'), ('index1.{s}', 'tail'), 'index1.{s}')
        b('index_02', 'index_01', ['c_index2.{s}'], ('c_index2.{s}', 'head'), ('c_index2.{s}', 'tail'), 'c_index2.{s}')
        b('index_03', 'index_02', ['c_index3.{s}'], ('c_index3.{s}', 'head'), ('c_index3.{s}', 'tail'), 'c_index3.{s}')
        b('thumb_01', 'hand', ['thumb1.{s}'], ('thumb1.{s}', 'head'), ('thumb1.{s}', 'tail'), 'thumb1.{s}')
        b('thumb_02', 'thumb_01', ['c_thumb2.{s}'], ('c_thumb2.{s}', 'head'), ('c_thumb2.{s}', 'tail'), 'c_thumb2.{s}')
        b('thumb_03', 'thumb_02', ['c_thumb3.{s}'], ('c_thumb3.{s}', 'head'), ('c_thumb3.{s}', 'tail'), 'c_thumb3.{s}')
        b('thigh', 'hips', ['thigh_twist.{s}', 'thigh_stretch.{s}'], ('thigh_twist.{s}', 'head'), ('thigh_stretch.{s}', 'tail'),
          'thigh_stretch.{s}')
        b('shin', 'thigh', ['leg_stretch.{s}', 'leg_twist.{s}'], ('leg_stretch.{s}', 'head'), ('leg_twist.{s}', 'tail'), 'leg_stretch.{s}')
        b('foot', 'shin', ['foot.{s}'], ('foot.{s}', 'head'), ('foot.{s}', 'tail'), 'foot.{s}')
        b('toe', 'foot', ['toes_01.{s}'], ('toes_01.{s}', 'head'), ('toes_01.{s}', 'tail'), 'toes_01.{s}')
    return t


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


def find_rig_and_meshes():
    rigs = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name != GAME and 'root.x' in o.data.bones]
    if not rigs:
        raise SystemExit('No Auto-Rig Pro rig (an armature with a root.x bone) in this file.')
    rig = rigs[0]
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)]
    if not meshes:
        raise SystemExit(f'No mesh is bound to {rig.name}.')
    return rig, meshes


def edit_mode(obj):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')


def object_mode():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')


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
    """golfer_rig: the clean skeleton, following the ARP bones."""
    old = bpy.data.objects.get(GAME)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    table = arp_table()
    arm = bpy.data.armatures.new(GAME)
    obj = bpy.data.objects.new(GAME, arm)
    coll = bpy.data.collections.get('golfer_export') or bpy.data.collections.new('golfer_export')
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    coll.objects.link(obj)
    obj.matrix_world = rig.matrix_world.copy()
    obj.show_in_front = True
    arm.display_type = 'STICK'
    src = rig.data.bones
    edit_mode(obj)
    eb = arm.edit_bones
    for name, (parent, groups, head, tail, follow, how) in table.items():
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
    for name, (parent, groups, head, tail, follow, how) in list(table.items()) + [('club', (None, [], None, None, 'cc_club', 'transforms'))]:
        pb = obj.pose.bones[name]
        con = pb.constraints.new('COPY_TRANSFORMS' if how == 'transforms' else 'COPY_ROTATION')
        con.name = 'follow ARP'
        con.target, con.subtarget = rig, follow
        con.target_space = con.owner_space = 'WORLD'
    return obj


def paint_regions(mesh_obj):
    """skin / shirt / pants / hair / shoe regions, from which bone moves each
    face and where it is."""
    me = mesh_obj.data
    if len(me.materials) > 1 or any(m and m.name.split('.')[0].lower() in REGION_COLOURS for m in me.materials):
        return False
    mats = {}
    for name, col in REGION_COLOURS.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.diffuse_color = srgb(col)
        m.use_nodes = True
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            bsdf.inputs['Base Color'].default_value = srgb(col)
            bsdf.inputs['Roughness'].default_value = 0.8
        mats[name] = m
    me.materials.clear()
    order = list(mats)
    for m in mats.values():
        me.materials.append(m)
    names = [g.name for g in mesh_obj.vertex_groups]
    head = mesh_obj.parent.data.bones.get('head.x') if mesh_obj.parent and mesh_obj.parent.type == 'ARMATURE' else None
    hz, hy = (head.head_local.z, head.head_local.y) if head else (1.59, 0.03)

    # The hem: the bottom of the downward-facing ring of faces around the knee.
    knee = mesh_obj.parent.data.bones.get('leg_stretch.l') if mesh_obj.parent and mesh_obj.parent.type == 'ARMATURE' else None
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


def store_script():
    """Keep this script in the file, to export from Blender's Text Editor."""
    here = os.path.abspath(__file__) if '__file__' in globals() else None
    if not here or not os.path.exists(here):
        return
    t = bpy.data.texts.get('export_golfer.py') or bpy.data.texts.new('export_golfer.py')
    t.from_string(open(here).read())


def action_paths(a):
    """The data paths an Action animates (layered Actions, Blender 4.4 on, or older ones)."""
    for layer in getattr(a, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    yield fc.data_path
    for fc in getattr(a, 'fcurves', None) or []:
        yield fc.data_path


def export_glb(path):
    rig, meshes = find_rig_and_meshes()
    game = bpy.data.objects.get(GAME)
    if not game:
        raise SystemExit('Fit the file first (no golfer_rig).')
    table = arp_table()
    to_game = {g: name for name, (_p, groups, *_r) in table.items() for g in groups}
    object_mode()
    copies = []
    for src in meshes:
        o = src.copy()
        o.data = src.data.copy()
        o.name = src.name + '_game'
        bpy.context.scene.collection.objects.link(o)
        # Merge each ARP group into its game bone's group.
        weights = {}
        for v in o.data.vertices:
            for g in v.groups:
                gname = o.vertex_groups[g.group].name
                dst = to_game.get(gname)
                if dst and g.weight > 0:
                    weights.setdefault(dst, {}).setdefault(v.index, 0)
                    weights[dst][v.index] += g.weight
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
    muted = [c for pb in game.pose.bones for c in pb.constraints if not c.mute]
    for c in muted:
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
    for c in muted:
        c.mute = False
    clips = [a.name[5:] for a in baked]
    for o in copies:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in baked:
        bpy.data.actions.remove(a)
    game.animation_data_clear()
    print(f'exported {path}: {len(meshes)} mesh(es), {len(clips)} clip(s): {", ".join(clips) or "none"}')


def fit():
    rig, meshes = find_rig_and_meshes()
    add_club_control(rig)
    build_game_rig(rig)
    painted = [m.name for m in meshes if paint_regions(m)]
    store_script()
    print(f'fitted: {GAME} built from {rig.name}; painted regions on {", ".join(painted) or "nothing (already has materials)"}')


def main(argv):
    if not argv:  # in Blender, from the Text Editor
        export_glb(bpy.path.abspath('//') + bpy.path.display_name_from_filepath(bpy.data.filepath) + '.glb')
        return
    path = argv[0]
    save = argv[argv.index('--save') + 1] if '--save' in argv else None
    glb = argv[argv.index('--glb') + 1] if '--glb' in argv else None
    bpy.ops.wm.open_mainfile(filepath=path, load_ui=False, use_scripts=False)
    if not bpy.data.objects.get(GAME):
        fit()
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=save, compress=True)
    if glb:
        export_glb(glb)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
