#!/usr/bin/env python3
"""Assemble the game into self-contained HTML files.

    python3 build.py

Outputs:
  Golf.html                 - double-click to play; three.js and PeerJS are inlined, works
                              offline (online play needs the internet, of course)
  dist/golf-artifact.html   - page body for publishing as a claude.ai Artifact
                              (loads three.js and PeerJS from the jsDelivr CDN)
"""
import base64
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"
JS_ORDER = [
    "util.js", "data.js", "physics.js", "course.js", "plains.js", "terrain.js", "maphole.js", "audio.js",
    "assets.js", "publish.js", "atmosphere.js", "wind.js", "world.js", "scenery.js", "equipment.js", "character.js", "cart.js", "ui.js",
    "workshop.js", "net.js", "remote.js", "main.js",
]
# three.js example modules (r158) used to read and write .glb (and to copy
# rigged, skinned models). They are ES modules; esm_to_script() turns them
# into plain scripts.
ADDONS = ["BufferGeometryUtils.js", "TextureUtils.js", "GLTFLoader.js", "GLTFExporter.js", "SkeletonUtils.js"]
# Custom assets built into the game: assets/<asset-id>.glb|.png|.jpg
ASSET_TYPES = {".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".png": "image/png",
               ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
# The GitHub repository the Workshop commits to (owner/name); it can be changed in the Workshop.
REPO = "jacobrichardbowen/Golf"
THREE_VERSION = "0.158.0"
THREE_CDN = f"https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}/build/three.min.js"
# PeerJS (MIT, see vendor/PEERJS-LICENSE) introduces players to each other for online rounds.
PEERJS_VERSION = "1.5.5"
PEERJS_CDN = f"https://cdn.jsdelivr.net/npm/peerjs@{PEERJS_VERSION}/dist/peerjs.min.js"


def safe_script(code: str) -> str:
    # Never let embedded code close the surrounding <script> tag early.
    return re.sub(r"</(script)", r"<\\/\1", code, flags=re.IGNORECASE)


def names(spec: str) -> str:
    # "A, B as C" -> "A, B: C" (object destructuring)
    out = []
    for n in spec.replace("\n", " ").split(","):
        n = n.strip()
        if not n:
            continue
        m = re.fullmatch(r"(\w+)\s+as\s+(\w+)", n)
        out.append(f"{m.group(1)}: {m.group(2)}" if m else n)
    return ", ".join(out)


def esm_to_script(code: str) -> str:
    """Convert one three.js example module into code that reads its imports
    from THREE / __addons and writes its exports to __addons."""
    code = re.sub(r"import\s*\{([^}]*)\}\s*from\s*'three';",
                  lambda m: f"const {{ {names(m.group(1))} }} = THREE;", code)
    code = re.sub(r"import\s*\{([^}]*)\}\s*from\s*'[^']+';",
                  lambda m: f"const {{ {names(m.group(1))} }} = __addons;", code)
    exported = []

    def export_list(m):
        for n in names(m.group(1)).split(", "):
            local, _, public = n.partition(": ")
            exported.append(f"{public}: {local}" if public else local)
        return ""
    code = re.sub(r"^export\s*\{([^}]*)\};?", export_list, code, flags=re.MULTILINE)

    def export_decl(m):
        exported.append(m.group(2))
        return m.group(1)
    code = re.sub(r"^export\s+((?:async\s+)?(?:function|class|const|let)\s+(\w+))", export_decl,
                  code, flags=re.MULTILINE)
    assert not re.search(r"^(import|export)\b", code, flags=re.MULTILINE), "unconverted import/export"
    return "(function () {\n" + code + f"\nObject.assign(__addons, {{ {', '.join(exported)} }});\n}})();\n"


def addons_js() -> str:
    parts = ["const __addons = {};"]
    for name in ADDONS:
        parts.append(f"// ===== three/examples/jsm {name} =====\n" +
                     esm_to_script((ROOT / "vendor" / "three-addons" / name).read_text()))
    parts.append("window.GLTFKit = { GLTFLoader: __addons.GLTFLoader, GLTFExporter: __addons.GLTFExporter, "
                 "cloneSkinned: __addons.clone };")
    return "\n".join(parts)


def assets_js() -> str:
    """Files dropped in assets/ become the game's own versions of those assets."""
    folder = ROOT / "assets"
    embedded = {}
    if folder.is_dir():
        for f in sorted(folder.iterdir()):
            ext = f.suffix.lower()
            if ext in ASSET_TYPES:
                embedded[f.stem] = {"name": f.name, "type": ASSET_TYPES[ext],
                                    "b64": base64.b64encode(f.read_bytes()).decode("ascii")}
                print(f"embedding assets/{f.name} as '{f.stem}'")
    # The built-in maps painted holes are made from (src/maps/<name>.png|jpg).
    maps = {}
    for f in sorted((SRC / "maps").glob("*")):
        ext = f.suffix.lower()
        if ext in ASSET_TYPES:
            maps[f.stem] = {"name": f.name, "type": ASSET_TYPES[ext],
                            "b64": base64.b64encode(f.read_bytes()).decode("ascii")}
    return (f"window.__PINEHAVEN_ASSETS = {json.dumps(embedded)};\n"
            f"window.__PINEHAVEN_MAPS = {json.dumps(maps)};\n"
            f"window.__PINEHAVEN_REPO = {json.dumps(REPO)};\n")


def game_js() -> str:
    parts = [assets_js(), addons_js()]
    for name in JS_ORDER:
        parts.append(f"// ===== {name} =====\n" + (SRC / "js" / name).read_text())
    body = "\n".join(parts)
    guard = (
        "if (typeof THREE === 'undefined') {\n"
        "  document.addEventListener('DOMContentLoaded', function () {\n"
        "    var t = document.getElementById('title'); if (t) t.hidden = true;\n"
        "    var e = document.getElementById('glError'); if (e) e.hidden = false;\n"
        "  });\n"
        "} else {\n"
    )
    return safe_script("(function () {\n'use strict';\n" + guard + body + "\n}\n})();\n")


def page(three_tag: str, peer_tag: str) -> tuple[str, str]:
    template = (SRC / "index.html").read_text()
    css = (SRC / "style.css").read_text()
    template = template.replace("/*STYLE*/", css)
    template = template.replace("<!--THREE-->", three_tag + "\n" + peer_tag)
    template = template.replace("/*GAME*/", game_js())
    head, body = template.split("<!--BODY-->", 1)
    return head.strip(), body.strip()


def main():
    three = (ROOT / "vendor" / "three.min.js").read_text()
    # Drop the "build/three.min.js is deprecated" console warning (keep it an expression).
    three = re.sub(r"^console\.warn\([^)]*\),", "0,", three, count=1)
    peer = (ROOT / "vendor" / "peerjs.min.js").read_text()
    peer = re.sub(r"\n?//# sourceMappingURL=\S+\s*$", "", peer)
    head, body = page("<script>\n" + safe_script(three) + "\n</script>",
                      "<script>\n" + safe_script(peer) + "\n</script>")
    full = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        f"{head}\n</head>\n<body>\n{body}\n</body>\n</html>\n"
    )
    (ROOT / "Golf.html").write_text(full)

    head, body = page(f'<script src="{THREE_CDN}"></script>', f'<script src="{PEERJS_CDN}"></script>')
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "golf-artifact.html").write_text(head + "\n" + body + "\n")

    for f in ["Golf.html", "dist/golf-artifact.html"]:
        size = (ROOT / f).stat().st_size
        print(f"wrote {f} ({size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
