# blend-paths-report-script
"""
List every file and folder path the open .blend file uses.

HOW TO RUN (inside Blender)
  1. Open the .blend file you want to check.
  2. Go to the Scripting workspace (or any Text Editor), click New, paste this
     script in and press Run Script (Alt+P).
  3. The report opens in that Text Editor as "Blend Paths Report". It is also
     printed to the system console (Window > Toggle System Console on Windows).

Or, without opening the Blender UI (prints the report to the terminal):
  blender --background "C:\\path\\to\\file.blend" --python list_blend_paths.py

WHAT IT FINDS
  Every path is resolved to a full absolute path (so a texture stored as
  "//textures\\bark.png" is shown as "C:\\...\\textures\\bark.png") and checked
  on disk: OK, MISSING, PACKED (embedded in the .blend; the path is where it
  originally came from) or OUTPUT (somewhere Blender writes to).

  - Linked libraries (.blend files), both direct and indirect (libraries that
    your libraries link from), and everything linked in from them. Paths
    inside a library are resolved relative to that library, not your file.
  - Images (every UDIM tile, image sequences), movie clips, sounds, fonts,
    Alembic/USD cache files, OpenVDB volumes, text blocks saved as files,
    IES lights, OSL script nodes, brush icons, file path sockets in node
    trees and Geometry Nodes modifiers.
  - Simulation and modifier caches: point caches (including the automatic
    "blendcache_<name>" folder), fluid, ocean, mesh cache, multires external
    displacement, Geometry Nodes bakes.
  - Video sequencer strips (image sequences, movies, proxies).
  - Output locations: render output, bake output, File Output nodes,
    collection exporters, Dynamic Paint image sequences.
  - "Weak references" to asset library files that data was appended from.
  - Anything else Blender's own path scanner knows about (cross-checked with
    bpy.utils.blend_paths, so nothing it reports is left out).
  - Optionally, strings that merely look like paths in custom properties,
    add-on settings and text blocks (listed separately as guesses).

Tested on Blender 4.2 LTS and 5.2 LTS (should also run on 3.x).
It only reads the file. The one change it makes is adding the "Blend Paths
Report" text block; delete that before saving if you don't want to keep it.
"""

import json
import os
import re

import bpy

# ---- options ------------------------------------------------------------------
SHOW_REPORT_IN_BLENDER = True   # write the report to a text block and open it
SAVE_REPORT_TO = ""             # also save it to this .txt file ("" = don't)
INCLUDE_GUESSES = True          # list path-like strings in custom props/text blocks
INCLUDE_UI = False              # also scan screens/workspaces (file browser folders)
# -------------------------------------------------------------------------------

REPORT_NAME = "Blend Paths Report"
SELF_MARKER = "blend-paths-" + "report-script"   # first line of this script
MAX_DEPTH = 40

PATH_SUBTYPES = {"FILE_PATH", "DIR_PATH", "FILE_NAME"}
# (type, property) pairs RNA doesn't flag as paths but are, ones that aren't
# paths, and ones that only repeat another property.
EXTRA_PATH_PROPS = {("Text", "filepath")}
NOT_PATH_PROPS = {("LibraryWeakReference", "id_name")}
DUPLICATE_PROPS = {("Image", "filepath_raw")}
PROP_NOTES = {
    ("LibraryWeakReference", "filepath"):
        "asset file this was appended from (a weak reference: not loaded, used to reuse the data on re-append)",
    ("PointCache", "filepath"): "external point cache folder",
}
# Defaults every file has, which say nothing about this one.
IGNORE_VALUES = {("BakeSettings", "filepath"): ("", "//")}
# Places Blender writes to rather than reads from.
OUTPUT_PROPS = {
    ("RenderSettings", "filepath"),
    ("BakeSettings", "filepath"),
    ("CollectionExport", "filepath"),
    ("DynamicPaintSurface", "image_output_path"),
}
UI_DATA = {"window_managers", "screens", "workspaces"}
SKIP_PROPS = {"rna_type", "depsgraph", "original", "bl_rna"}
# Never read: packed file bytes (can be huge), text lines (scanned as a whole),
# the dependency graph (built on demand).
SKIP_TYPES = {"PackedFile", "TextLine", "Depsgraph"}

SECTION_TITLES = {
    "libraries": "Linked libraries (.blend files)",
    "images": "Images",
    "movieclips": "Movie clips",
    "sounds": "Sounds",
    "fonts": "Fonts",
    "cache_files": "Cache files (Alembic / USD)",
    "volumes": "Volumes (OpenVDB)",
    "texts": "Text blocks saved as files",
    "objects": "Objects (modifiers, simulation caches)",
    "scenes": "Scenes (video sequencer, caches)",
    "materials": "Materials (shader nodes)",
    "node_groups": "Node groups",
    "particles": "Particle settings",
}
SECTION_ORDER = ["libraries", "images", "movieclips", "sounds", "fonts",
                 "cache_files", "volumes", "texts"]
OUTPUT_SECTION = "~output"
SCANNER_SECTION = "~scanner"
GUESS_SECTION = "~guess"


# ---- paths --------------------------------------------------------------------

def norm_key(path):
    return os.path.normcase(os.path.normpath(path))


def blend_of(owner):
    """The .blend file an ID's relative paths are relative to: its library, or
    the open file. (Blender stores every library path relative to the open
    file, indirect ones included.)"""
    lib = getattr(owner, "library", None)
    if lib is None:
        return bpy.data.filepath
    return resolve(lib.filepath, None)


def resolve(raw, owner):
    """Absolute path for a stored path, or None if it can't be resolved
    (a "//" relative path in a file that was never saved)."""
    if raw.startswith("//"):
        base = blend_of(owner) if owner is not None else bpy.data.filepath
        if not base:
            return None
        raw = os.path.join(os.path.dirname(base), raw[2:])
    return os.path.normpath(raw)


def looks_like_path(s):
    if not s or len(s) > 1024 or "\n" in s or "\r" in s:
        return False
    if re.match(r"[A-Za-z]:[\\/]", s) or re.match(r"\\\\[^\\/\s]+[\\/]", s):
        return True
    if s.startswith("//"):
        return len(s) > 2 and s[2] not in "/ "
    if s.startswith("/") or s.startswith("~/"):
        # POSIX path: needs at least two parts, and isn't a URL.
        return s.count("/") >= 2 and "://" not in s
    return False


def expand_udim(path, number):
    u, v = (number - 1001) % 10 + 1, (number - 1001) // 10 + 1
    return path.replace("<UDIM>", str(number)).replace("<UVTILE>", "u%d_v%d" % (u, v))


# ---- RNA helpers ----------------------------------------------------------------
# The walk only reads properties that can lead to a path, decided from Blender's
# type definitions before anything is read. That keeps it fast, and away from
# getters that crash some Blender versions (4.2 crashes reading
# scene.tool_settings.uv_sculpt.palette, for one); none of those lead to paths.

EMBEDDED_ID_TYPES = {"NodeTree", "Collection"}   # datablocks that can live inside another
ALWAYS_FOLLOW = {"NodesModifierProperties"}       # holds types Blender makes at runtime

_TYPES = {}       # identifier -> RNA struct, for every type in bpy.types
_CHILDREN = {}    # identifier -> identifiers of its direct subclasses
_FAMILY = {}
_REACH = set()    # types that hold, or lead to, a path property
_ID_TYPES = {}
_TYPE_INFO = {}
_PROP_NAMES = {}


def string_kind(type_ident, p):
    """A string property's path subtype, None for plain text, "skip" to ignore it."""
    ident = p.identifier
    if p.subtype == "BYTE_STRING" or (type_ident, ident) in DUPLICATE_PROPS:
        return "skip"
    if (type_ident, ident) in NOT_PATH_PROPS:
        return None
    if (type_ident, ident) in EXTRA_PATH_PROPS:
        return "FILE_PATH"
    return p.subtype if p.subtype in PATH_SUBTYPES else None


def ancestors(rna):
    while rna is not None:
        yield rna.identifier
        rna = rna.base


def is_id_type(rna):
    key = rna.identifier
    if key not in _ID_TYPES:
        _ID_TYPES[key] = "ID" in ancestors(rna)
    return _ID_TYPES[key]


def family(ident):
    """A type and all its subclasses (a Modifier pointer may hold an OceanModifier)."""
    fam = _FAMILY.get(ident)
    if fam is None:
        fam, stack = set(), [ident]
        while stack:
            t = stack.pop()
            if t not in fam:
                fam.add(t)
                stack.extend(_CHILDREN.get(t, ()))
        _FAMILY[ident] = fam
    return fam


def link_target(p):
    """The struct type a pointer/collection property leads to, or None if the
    walk never follows it."""
    ft = p.fixed_type
    if ft is None or p.identifier in SKIP_PROPS or ft.identifier in SKIP_TYPES:
        return None
    if is_id_type(ft):
        # Other datablocks are scanned from bpy.data on their own; only follow
        # the kinds that can be embedded (a material's node tree).
        if p.type == "COLLECTION" or EMBEDDED_ID_TYPES.isdisjoint(ancestors(ft)):
            return None
    return ft.identifier


def build_reach():
    if _TYPES:
        return
    for name in dir(bpy.types):
        try:
            rna = getattr(bpy.types, name).bl_rna
        except Exception:
            continue
        if getattr(rna, "rna_type", None) is not None and rna.rna_type.identifier == "Struct":
            _TYPES.setdefault(rna.identifier, rna)
    for ident, rna in _TYPES.items():
        if rna.base is not None:
            _CHILDREN.setdefault(rna.base.identifier, []).append(ident)
    edges = {}
    for ident, rna in _TYPES.items():
        targets = set()
        for p in rna.properties:
            if p.type == "STRING":
                if string_kind(ident, p) not in (None, "skip"):
                    _REACH.add(ident)
            elif p.type in ("POINTER", "COLLECTION"):
                t = link_target(p)
                if t is not None:
                    targets |= family(t)
        edges[ident] = targets
    changed = True
    while changed:
        changed = False
        for ident, targets in edges.items():
            if ident not in _REACH and not targets.isdisjoint(_REACH):
                _REACH.add(ident)
                changed = True


def followable(ident):
    if ident in ALWAYS_FOLLOW or ident not in _TYPES:
        return True    # made at runtime (Geometry Nodes modifier inputs)
    return not family(ident).isdisjoint(_REACH)


def type_info(rna):
    """Per struct type: (string props, pointer props, collection props) worth reading.
    String props come as (name, kind), kind being a path subtype or None."""
    key = (rna.identifier, rna.as_pointer())   # runtime-made types share names
    info = _TYPE_INFO.get(key)
    if info is not None:
        return info
    strings, pointers, colls = [], [], []
    for p in rna.properties:
        if p.identifier in SKIP_PROPS:
            continue
        if p.type == "STRING":
            kind = string_kind(rna.identifier, p)
            if kind != "skip":
                strings.append((p.identifier, kind))
        elif p.type in ("POINTER", "COLLECTION"):
            t = link_target(p)
            if t is None or not followable(t):
                continue
            if p.type == "POINTER":
                pointers.append((p.identifier, is_id_type(p.fixed_type)))
            else:
                colls.append((p.identifier, t))
    # Path properties first, so a strip's directory is known before its frames.
    strings.sort(key=lambda s: s[1] is None)
    info = _TYPE_INFO[key] = (strings, pointers, colls)
    return info


def rna_prop_names(rna):
    key = (rna.identifier, rna.as_pointer())
    if key not in _PROP_NAMES:
        _PROP_NAMES[key] = {p.identifier for p in rna.properties}
    return _PROP_NAMES[key]


def item_key(item, index):
    name = getattr(item, "name", None)
    if isinstance(name, str) and name:
        return "[%s]" % json.dumps(name)
    return "[%d]" % index


def id_accessor(collection, idb):
    if idb.library is not None:
        return "bpy.data.%s[%s, %s]" % (collection, json.dumps(idb.name),
                                         json.dumps(idb.library.filepath))
    return "bpy.data.%s[%s]" % (collection, json.dumps(idb.name))


def is_packed(idb):
    if getattr(idb, "packed_file", None) is not None:
        return True
    try:
        return len(getattr(idb, "packed_files", ())) > 0
    except Exception:
        return False


# ---- collecting ------------------------------------------------------------------

class Entry:
    __slots__ = ("section", "raw", "abs", "is_dir", "output", "packed", "wheres", "notes")

    def __init__(self, section, raw, abs_path, is_dir, output, packed):
        self.section = section
        self.raw = raw
        self.abs = abs_path
        self.is_dir = is_dir
        self.output = output
        self.packed = packed
        self.wheres = []    # (data path, owning datablock)
        self.notes = []


class Collector:
    def __init__(self):
        self.entries = {}
        self.seen = set()        # every path reported, for the cross-check
        self.visited = set()
        self.section_of = {}     # ID pointer -> bpy.data collection name
        self.lib_users = {}      # library pointer -> datablocks linked from it
        self.id_count = 0
        self.linked_count = 0

    def add(self, owner, raw, where, is_dir=False, output=False, guess=False,
            packed=False, note=None, absolute=False):
        """Record one path. owner is the top-level datablock it belongs to."""
        if not isinstance(raw, str):
            return
        raw = raw.strip("\0")
        if not raw.strip() or raw == "<builtin>":
            return
        if isinstance(owner, bpy.types.Image) and not absolute:
            if "<UDIM>" in raw or "<UVTILE>" in raw:
                template = resolve(raw, owner)
                if template:
                    self.seen.add(norm_key(template))
                for tile in owner.tiles:
                    self.add(owner, expand_udim(raw, tile.number), where, is_dir, output,
                             guess, packed, "UDIM tile %d" % tile.number)
                return
            if owner.source == "SEQUENCE" and not guess:
                note = note or "image sequence (this is one of its frames)"
        abs_path = os.path.normpath(raw) if absolute else resolve(raw, owner)
        if output:
            section = OUTPUT_SECTION
        elif guess:
            section = GUESS_SECTION
        else:
            section = self.section_of.get(owner.as_pointer(), "other")
        key = (section, norm_key(abs_path) if abs_path else raw, packed)
        entry = self.entries.get(key)
        if entry is None:
            entry = self.entries[key] = Entry(section, raw, abs_path, is_dir, output, packed)
        if abs_path:
            self.seen.add(norm_key(abs_path))
        if all(w != where for w, _ in entry.wheres):
            entry.wheres.append((where, owner))
        if note and note not in entry.notes:
            entry.notes.append(note)

    def scan_data(self):
        build_reach()
        names = []
        for prop in bpy.data.bl_rna.properties:
            if prop.type != "COLLECTION" or prop.fixed_type is None:
                continue
            if not is_id_type(prop.fixed_type) or prop.identifier == "all_ids":
                continue
            if prop.identifier in UI_DATA and not INCLUDE_UI:
                continue
            names.append(prop.identifier)
        # Index every datablock first, so sections and library use counts are known.
        for name in names:
            for idb in getattr(bpy.data, name):
                self.section_of[idb.as_pointer()] = name
                self.id_count += 1
                if idb.library is not None:
                    self.linked_count += 1
                    ptr = idb.library.as_pointer()
                    self.lib_users[ptr] = self.lib_users.get(ptr, 0) + 1
        for name in names:
            for idb in getattr(bpy.data, name):
                self.crawl(idb, idb, id_accessor(name, idb), 0)
                if name == "texts" and INCLUDE_GUESSES:
                    self.scan_text(idb)

    def crawl(self, struct, owner, where, depth):
        """Walk a datablock's RNA properties, reporting every path-typed string."""
        rna = struct.bl_rna
        tname = rna.identifier
        if tname in SKIP_TYPES or depth > MAX_DEPTH:
            return
        try:
            ptr = struct.as_pointer()
        except Exception:
            ptr = 0
        if ptr:
            if (ptr, tname) in self.visited:
                return
            self.visited.add((ptr, tname))
        strings, pointers, colls = type_info(rna)
        skip_colls = ()
        handled_idprops = set()

        if tname == "CompositorNodeOutputFile":
            self.file_output_node(struct, owner, where)
            strings = [s for s in strings if s[1] is None]
            skip_colls = ("file_slots", "layer_slots")
        elif tname == "PointCache":
            self.point_cache(struct, owner, where)
        elif tname == "NodesModifier":
            handled_idprops = self.nodes_modifier_inputs(struct, owner, where)

        packed = (depth == 0 and is_packed(struct)) or tname == "ImagePackedFile"
        directory = None
        for ident, kind in strings:
            if kind == "FILE_NAME" or (kind is None and not INCLUDE_GUESSES):
                continue   # bare file names: handled with their folder below
            try:
                val = getattr(struct, ident)
            except Exception:
                continue
            if not isinstance(val, str) or not val:
                continue
            if val in IGNORE_VALUES.get((tname, ident), ()):
                continue
            w = "%s.%s" % (where, ident)
            if kind is None:
                if looks_like_path(val):
                    self.add(owner, val, w, guess=True)
                continue
            is_dir = kind == "DIR_PATH"
            if is_dir and ident == "directory":
                directory = val
            self.add(owner, val, w, is_dir=is_dir, output=(tname, ident) in OUTPUT_PROPS,
                     packed=packed and ident == "filepath", note=PROP_NOTES.get((tname, ident)))

        if INCLUDE_GUESSES:
            self.scan_idprops(struct, owner, where, rna, handled_idprops)

        for ident, to_id in pointers:
            try:
                val = getattr(struct, ident)
            except Exception:
                continue
            if val is None or not hasattr(val, "bl_rna"):
                continue
            if to_id or isinstance(val, bpy.types.ID):
                # Only follow datablocks owned by this one (a material's node
                # tree); the rest are scanned from bpy.data on their own.
                if not getattr(val, "is_embedded_data", False):
                    continue
            self.crawl(val, owner, "%s.%s" % (where, ident), depth + 1)

        for ident, elem_type in colls:
            if ident in skip_colls:
                continue
            try:
                coll = getattr(struct, ident)
                n = len(coll)
            except Exception:
                continue
            if n == 0:
                continue
            if elem_type in ("StripElement", "SequenceElement"):
                if directory:
                    self.strip_frames(coll, n, directory, owner, "%s.%s" % (where, ident))
                continue
            for i, item in enumerate(coll):
                if item is None or not hasattr(item, "bl_rna") or isinstance(item, bpy.types.ID):
                    continue
                self.crawl(item, owner, "%s.%s%s" % (where, ident, item_key(item, i)), depth + 1)

    # -- special cases ----------------------------------------------------------------

    def strip_frames(self, elements, n, directory, owner, where):
        # Image sequence strip: one folder plus one file name per frame. List the
        # first and last frame; the rest only count as seen for the cross-check.
        ends = {0, n - 1}
        for i, elem in enumerate(elements):
            path = os.path.join(directory, getattr(elem, "filename", ""))
            if i in ends:
                self.add(owner, path, "%s[%d].filename" % (where, i),
                         note="image sequence strip, %d frames (first and last listed)" % n
                         if n > 1 else None)
            else:
                abs_path = resolve(path, owner)
                if abs_path:
                    self.seen.add(norm_key(abs_path))

    def file_output_node(self, node, owner, where):
        # Blender 5.0+: directory + file name. Older: base path + one sub-path per input.
        if hasattr(node, "directory"):
            path = os.path.join(node.directory or "", getattr(node, "file_name", "") or "")
            names = [it.name for it in getattr(node, "file_output_items", ())]
            note = "File Output node" + ("; inputs: " + ", ".join(names) if names else "")
            self.add(owner, path, where + ".directory + .file_name", output=True, note=note)
            return
        base = getattr(node, "base_path", "") or ""
        fmt = getattr(getattr(node, "format", None), "file_format", "")
        if fmt == "OPEN_EXR_MULTILAYER" or not len(getattr(node, "file_slots", ())):
            self.add(owner, base, where + ".base_path", output=True,
                     note="File Output node (multilayer EXR)" if fmt == "OPEN_EXR_MULTILAYER" else None)
            return
        for i, slot in enumerate(node.file_slots):
            self.add(owner, os.path.join(base, slot.path), "%s.file_slots[%d].path" % (where, i),
                     output=True, note="File Output node (frame number and extension are added when rendering)")

    def point_cache(self, cache, owner, where):
        # A disk cache with no custom folder goes to //blendcache_<file name>/
        if not getattr(cache, "use_disk_cache", False) or getattr(cache, "use_external", False):
            return
        blend = blend_of(owner)
        if not blend:
            return
        folder = os.path.join(os.path.dirname(blend),
                              "blendcache_" + os.path.splitext(os.path.basename(blend))[0])
        self.add(owner, folder, where + " (disk cache)", is_dir=True, absolute=True,
                 note="point cache folder Blender picks automatically")

    def nodes_modifier_inputs(self, mod, owner, where):
        """Blender 4.x keeps Geometry Nodes modifier inputs as custom properties:
        report the file path ones. (5.x exposes them as RNA, which the generic
        walk already covers.) Returns the property names it handled."""
        ng = getattr(mod, "node_group", None)
        try:
            keys = set(mod.keys())
        except Exception:
            return set()
        if ng is None:
            return set()
        iface = getattr(ng, "interface", None)
        if iface is not None:
            sockets = [s for s in iface.items_tree
                       if getattr(s, "item_type", "") == "SOCKET" and getattr(s, "in_out", "") == "INPUT"]
        else:
            sockets = list(getattr(ng, "inputs", ()))
        handled = set()
        for s in sockets:
            ident = getattr(s, "identifier", "")
            is_path = (getattr(s, "subtype", "") in PATH_SUBTYPES
                       or "FilePath" in getattr(s, "bl_socket_idname", ""))
            if ident in keys and is_path and isinstance(mod[ident], str):
                self.add(owner, mod[ident], "%s[%s]" % (where, json.dumps(ident)),
                         note='Geometry Nodes input "%s"' % s.name)
                handled.add(ident)
        return handled

    # -- guesses ------------------------------------------------------------------------

    def scan_idprops(self, struct, owner, where, rna, handled):
        try:
            items = list(struct.items())
        except Exception:
            return    # this type can't have custom properties
        registered = rna_prop_names(rna)
        for k, v in items:
            if k in registered or k in handled or k == "_RNA_UI":
                continue
            self.scan_idprop_value(v, owner, "%s[%s]" % (where, json.dumps(k)), 0)

    def scan_idprop_value(self, v, owner, where, depth):
        if depth > 8:
            return
        if isinstance(v, str):
            if looks_like_path(v):
                self.add(owner, v, where, guess=True, note="custom property")
        elif hasattr(v, "items") and hasattr(v, "keys"):
            for k, sub in v.items():
                self.scan_idprop_value(sub, owner, "%s[%s]" % (where, json.dumps(k)), depth + 1)
        elif isinstance(v, (list, tuple)):
            for i, sub in enumerate(v):
                if isinstance(sub, (str, list, tuple)) or hasattr(sub, "items"):
                    self.scan_idprop_value(sub, owner, "%s[%d]" % (where, i), depth + 1)

    def scan_text(self, text):
        if text.name == REPORT_NAME:
            return
        try:
            body = text.as_string()
        except Exception:
            return
        if SELF_MARKER in body:
            return
        quoted = re.compile(r"""([rRbBuUfF]{0,2})(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)')""")
        bare = re.compile(r"""(?<![\w"'\\/])[A-Za-z]:[\\/][^\s"'<>|*?]+""")
        accessor = id_accessor("texts", text)
        for n, line in enumerate(body.splitlines(), 1):
            found = []
            for m in quoted.finditer(line):
                s = m.group(2) if m.group(2) is not None else m.group(3)
                if "r" not in m.group(1).lower():
                    s = s.replace("\\\\", "\\")
                found.append(s)
            found += [m.group(0).rstrip(".,;:)]}") for m in bare.finditer(line)]
            for s in found:
                if looks_like_path(s):
                    self.add(text, s, "%s, line %d" % (accessor, n), guess=True,
                             note="mentioned in a text block")

    # -- cross-check with Blender's own path scanner -------------------------------------

    def scanner_cross_check(self):
        try:
            paths = bpy.utils.blend_paths(absolute=True, packed=True, local=False)
        except Exception:
            return
        for p in paths:
            # (In a never-saved file it returns "//" paths with the "//" cut off.)
            if not p or not os.path.isabs(p) or norm_key(p) in self.seen:
                continue
            key = (SCANNER_SECTION, norm_key(p), False)
            if key not in self.entries:
                e = self.entries[key] = Entry(SCANNER_SECTION, p, os.path.normpath(p),
                                              os.path.isdir(p), False, False)
                e.wheres.append(("bpy.utils.blend_paths()", None))


# ---- report ---------------------------------------------------------------------------

def status_of(e):
    if e.abs is None:
        return "UNSAVED"     # relative path, but the .blend was never saved
    if e.output:
        return "OUTPUT"
    if e.packed:
        return "PACKED"
    exists = os.path.isdir(e.abs) if e.is_dir else os.path.exists(e.abs)
    return "OK" if exists else "MISSING"


def section_title(sec):
    if sec == OUTPUT_SECTION:
        return "Output locations (where renders, bakes and exports are written)"
    if sec == SCANNER_SECTION:
        return "Other paths (found only by Blender's internal path scanner)"
    if sec == GUESS_SECTION:
        return "Possible paths (strings that look like paths in custom properties, add-on settings, text blocks)"
    return SECTION_TITLES.get(sec, sec.replace("_", " ").capitalize())


def section_rank(sec):
    if sec in SECTION_ORDER:
        return (0, SECTION_ORDER.index(sec), "")
    tail = {OUTPUT_SECTION: 2, SCANNER_SECTION: 3, GUESS_SECTION: 4}
    return (tail.get(sec, 1), 0, section_title(sec))


def library_note(c, lib):
    n = c.lib_users.get(lib.as_pointer(), 0)
    how = ('indirect: linked by "%s"' % lib.parent.name) if lib.parent else "linked directly"
    return "%s, %d datablock%s used from it" % (how, n, "" if n == 1 else "s")


def build_report(c):
    by_section = {}
    for e in c.entries.values():
        by_section.setdefault(e.section, []).append(e)

    counts = {}
    rows = []
    for sec in sorted(by_section, key=section_rank):
        items = sorted(by_section[sec], key=lambda e: (e.abs or e.raw).lower())
        rows += ["", "%s  [%d]" % (section_title(sec), len(items)), "-" * 78]
        for e in items:
            st = status_of(e)
            if sec != GUESS_SECTION:
                counts[st] = counts.get(st, 0) + 1
            notes = list(e.notes)
            for _, owner in e.wheres:
                if isinstance(owner, bpy.types.Library):
                    notes.append(library_note(c, owner))
                    if st == "MISSING":
                        notes.append("missing, so nothing it links in can be listed")
            shown = e.abs or e.raw
            if e.abs and (e.is_dir or e.raw.endswith(("/", "\\"))) and not shown.endswith(os.sep):
                shown += os.sep
            rows.append("[%s]%s %s" % (st, " " * (8 - len(st)), shown))
            if e.abs is not None and os.path.normpath(e.raw) != e.abs:
                rows.append("           stored as: %s" % e.raw)
            for where, owner in e.wheres[:6]:
                lib = getattr(owner, "library", None)
                origin = "   (linked from %s)" % os.path.basename(lib.filepath) if lib else ""
                rows.append("           used by:   %s%s" % (where, origin))
            if len(e.wheres) > 6:
                rows.append("           ... and %d more places" % (len(e.wheres) - 6))
            for note in notes:
                rows.append("           note:      %s" % note)

    total = sum(counts.values())
    summary = ", ".join("%d %s" % (counts[k], k) for k in
                        ("OK", "MISSING", "PACKED", "OUTPUT", "UNSAVED") if counts.get(k))
    nlib = len(bpy.data.libraries)
    head = [
        "PATHS USED BY THIS .BLEND FILE",
        "=" * 78,
        "File:     %s" % (bpy.data.filepath or "(never saved: '//' relative paths can't be resolved)"),
        "Blender:  %s" % bpy.app.version_string,
        "Scanned:  %d datablocks%s" % (c.id_count, ", %d of them linked from %d librar%s" % (
            c.linked_count, nlib, "y" if nlib == 1 else "ies") if nlib else ""),
        "Found:    %d path%s%s" % (total, "" if total == 1 else "s", ": " + summary if summary else ""),
    ]
    guesses = len(by_section.get(GUESS_SECTION, ()))
    if guesses:
        head.append("          + %d possible path%s (guesses, listed last)" % (
            guesses, "" if guesses == 1 else "s"))
    head += [
        "",
        "Status:   OK = exists on disk   MISSING = not found   OUTPUT = Blender writes here",
        "          PACKED = embedded in the .blend (the path is where it came from)",
    ]
    flat = sorted({e.abs or e.raw for e in c.entries.values()}, key=str.lower)
    tail = ["", "ALL PATHS, ONE PER LINE", "-" * 78] + flat
    return "\n".join(head + rows + tail) + "\n"


def show_report(report):
    text = bpy.data.texts.get(REPORT_NAME) or bpy.data.texts.new(REPORT_NAME)
    text.clear()
    text.write(report)
    try:
        text.cursor_set(0)
    except Exception:
        pass
    if bpy.app.background:
        return
    space = getattr(bpy.context, "space_data", None)
    if space is None or space.type != "TEXT_EDITOR":
        space = next((area.spaces.active
                      for window in bpy.context.window_manager.windows
                      for area in window.screen.areas if area.type == "TEXT_EDITOR"), None)
    if space is not None:
        space.text = text
        space.top = 0


def main():
    c = Collector()
    c.scan_data()
    c.scanner_cross_check()
    report = build_report(c)
    print(report)
    if SAVE_REPORT_TO:
        out = bpy.path.abspath(SAVE_REPORT_TO)
        with open(out, "w", encoding="utf-8") as f:
            f.write(report)
        print("Report saved to", out)
    if SHOW_REPORT_IN_BLENDER:
        show_report(report)
    return report


if __name__ == "__main__":
    main()
