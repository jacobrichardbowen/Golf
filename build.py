#!/usr/bin/env python3
"""Assemble the game into self-contained HTML files.

    python3 build.py

Outputs:
  Golf.html                 - double-click to play; three.js is inlined, works offline
  dist/golf-artifact.html   - page body for publishing as a claude.ai Artifact
                              (loads three.js from the jsDelivr CDN)
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"
JS_ORDER = [
    "util.js", "data.js", "physics.js", "course.js", "terrain.js",
    "audio.js", "world.js", "ui.js", "main.js",
]
THREE_VERSION = "0.158.0"
THREE_CDN = f"https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}/build/three.min.js"


def safe_script(code: str) -> str:
    # Never let embedded code close the surrounding <script> tag early.
    return re.sub(r"</(script)", r"<\\/\1", code, flags=re.IGNORECASE)


def game_js() -> str:
    parts = []
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


def page(three_tag: str) -> tuple[str, str]:
    template = (SRC / "index.html").read_text()
    css = (SRC / "style.css").read_text()
    template = template.replace("/*STYLE*/", css)
    template = template.replace("<!--THREE-->", three_tag)
    template = template.replace("/*GAME*/", game_js())
    head, body = template.split("<!--BODY-->", 1)
    return head.strip(), body.strip()


def main():
    three = (ROOT / "vendor" / "three.min.js").read_text()
    # Drop the "build/three.min.js is deprecated" console warning (keep it an expression).
    three = re.sub(r"^console\.warn\([^)]*\),", "0,", three, count=1)
    head, body = page("<script>\n" + safe_script(three) + "\n</script>")
    full = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        f"{head}\n</head>\n<body>\n{body}\n</body>\n</html>\n"
    )
    (ROOT / "Golf.html").write_text(full)

    head, body = page(f'<script src="{THREE_CDN}"></script>')
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "golf-artifact.html").write_text(head + "\n" + body + "\n")

    for f in ["Golf.html", "dist/golf-artifact.html"]:
        size = (ROOT / f).stat().st_size
        print(f"wrote {f} ({size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
