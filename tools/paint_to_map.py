#!/usr/bin/env python3
"""Turn a painted hole (an illustration plus a greyscale height map) into the
three images the game builds a hole from:

    <name>-ground.jpg   the painting, used as the colour of the ground
    <name>-height.png   greyscale height (light = high), half resolution
    <name>-surface.png  colour-coded surfaces (see PALETTE and README)

    python3 tools/paint_to_map.py tools/maps/castle-falls.json src/maps

The hints file names the source image and gives what can't be read reliably
from the colours alone: where the tee and green are, the flag and tee markers
to paint out, the dirt paths, and buildings (out of bounds). Everything else
(fairway, rough, forest, sand, water, rock) is classified from the painting
and the height map. Needs numpy and Pillow.
"""
import colorsys
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# Must match MAP_PALETTE in src/js/maphole.js.
PALETTE = {
    "fairway": (110, 200, 60),
    "green": (180, 255, 150),
    "tee": (255, 255, 80),
    "rough": (60, 130, 40),
    "forest": (20, 70, 30),
    "long": (130, 140, 40),
    "sand": (240, 210, 150),
    "water": (30, 90, 220),
    "path": (160, 90, 40),
    "rock": (128, 128, 128),
    "oob": (0, 0, 0),
}


def box_mean(a, r):
    """Mean over a (2r+1)^2 window, edges clamped."""
    p = np.pad(a.astype(np.float64), r + 1, mode="edge")
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s[: a.shape[0], : a.shape[1]] / (k * k)


def dilate(mask, r):
    return box_mean(mask.astype(np.float64), r) > 1e-9


def erode(mask, r):
    return box_mean(mask.astype(np.float64), r) > 1 - 1e-9


def closing(mask, r):
    return erode(dilate(mask, r), r)


def opening(mask, r):
    return dilate(erode(mask, r), r)


def remove_small(mask, min_area):
    """Drop connected patches (8-neighbour) smaller than min_area pixels."""
    H, W = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    keep = np.zeros_like(mask, dtype=bool)
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        stack, comp = [(y0, x0)], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop()
            comp.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if len(comp) >= min_area:
            ys, xs = zip(*comp)
            keep[list(ys), list(xs)] = True
    return keep


def split_source(img):
    """The source is the painting and the height map side by side, split by a white band."""
    a = np.asarray(img.convert("RGB")).astype(int)
    white = (a.min(axis=2) > 235).mean(axis=0) > 0.97
    cols = np.where(white)[0]
    if len(cols) == 0:
        raise SystemExit("Couldn't find the white band between the painting and the height map.")
    left = img.crop((0, 0, int(cols.min()), img.height))
    right = img.crop((int(cols.max()) + 1, 0, img.width, img.height))
    return left.convert("RGB"), right.convert("L").resize(left.size, Image.BICUBIC)


def hls(rgb):
    f = rgb / 255.0
    h = np.zeros(f.shape[:2]); l = np.zeros_like(h); s = np.zeros_like(h)
    mx = f.max(axis=2); mn = f.min(axis=2); d = mx - mn
    l = (mx + mn) / 2
    with np.errstate(invalid="ignore", divide="ignore"):
        s = np.where(d == 0, 0, d / np.where(l < 0.5, mx + mn, 2 - mx - mn + 1e-9))
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    hr = np.where(mx == r, ((g - b) / (d + 1e-9)) % 6, 0)
    hg = np.where(mx == g, (b - r) / (d + 1e-9) + 2, 0)
    hb = np.where(mx == b, (r - g) / (d + 1e-9) + 4, 0)
    h = np.where(mx == r, hr, np.where(mx == g, hg, hb)) * 60
    h = np.where(d == 0, 0, h)
    return h, l, s


def polygon_mask(size, polys):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon([tuple(q) for q in p], fill=255)
    return np.asarray(m) > 0


def path_mask(size, paths):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for p in paths:
        pts = [tuple(q) for q in p["points"]]
        w = int(p["width"])
        d.line(pts, fill=255, width=w, joint="curve")
        for (x, y) in pts:
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=255)
    return np.asarray(m) > 0


def inpaint(img, boxes):
    """Replace small boxes (flag, tee markers) with the colours around them."""
    a = np.asarray(img).astype(np.float64).copy()
    for b in boxes:
        x0, y0, x1, y1 = b["box"]
        ring = np.concatenate([
            a[max(0, y0 - 4):y0, x0:x1].reshape(-1, 3), a[y1:y1 + 4, x0:x1].reshape(-1, 3),
            a[y0:y1, max(0, x0 - 4):x0].reshape(-1, 3), a[y0:y1, x1:x1 + 4].reshape(-1, 3)])
        med = np.median(ring, axis=0)
        rng = np.random.default_rng(x0 * 7 + y0)
        patch = med + rng.normal(0, ring.std(axis=0).mean() * 0.35, size=(y1 - y0, x1 - x0, 3))
        a[y0:y1, x0:x1] = patch
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    # Soften the patch edges.
    blurred = out.filter(ImageFilter.GaussianBlur(1.2))
    m = Image.new("L", out.size, 0)
    d = ImageDraw.Draw(m)
    for b in boxes:
        x0, y0, x1, y1 = b["box"]
        d.rectangle([x0 - 1, y0 - 1, x1 + 1, y1 + 1], fill=255)
    return Image.composite(blurred, out, m.filter(ImageFilter.GaussianBlur(1.5)))


def classify(paint, height, hints):
    W, H = paint.size
    rgb = np.asarray(paint).astype(np.float64)
    hue, light, sat = hls(rgb)
    lum = rgb.mean(axis=2)
    local_sd = np.sqrt(np.maximum(box_mean(lum * lum, 3) - box_mean(lum, 3) ** 2, 0))
    hgt = np.asarray(height).astype(np.float64)

    yy, xx = np.mgrid[0:H, 0:W]
    tc, tr = hints["tee"]["center"], hints["tee"]["radius"]
    tee = ((xx - tc[0]) / tr[0]) ** 2 + ((yy - tc[1]) / tr[1]) ** 2 < 1
    gc, gr = hints["green"]["center"], hints["green"]["radius"]
    green = (xx - gc[0]) ** 2 + (yy - gc[1]) ** 2 < gr * gr

    water = (hue > 175) & (hue < 230) & (sat > 0.3)
    water = remove_small(opening(closing(water, 5), 2), 2500)
    sand = (hue > 32) & (hue < 54) & (light > 0.55) & (sat > 0.42)
    sand = remove_small(opening(closing(sand, 2), 2), 150)
    short = (hue > 64) & (hue < 84) & (sat > 0.66) & (light > 0.29) & (light < 0.42) & (local_sd < 9)
    short = opening(closing(short, 4), 6) & ~water & ~sand
    near_water = dilate(water, 40)
    rock = near_water & ~water & (((hue > 18) & (hue < 58) & (sat < 0.45) & (light > 0.34) & (light < 0.7))
                                  | ((sat < 0.14) & (light > 0.18) & (light < 0.6)))
    rock = remove_small(opening(closing(rock, 3), 2), 40)
    oob = polygon_mask(paint.size, [o["polygon"] for o in hints.get("outOfBounds", [])])
    path = path_mask(paint.size, hints.get("paths", []))

    # Trees stand out of the height map: what's left after removing everything
    # narrower than a few yards.
    hi = Image.fromarray(hgt.astype(np.uint8))
    opened = hi.filter(ImageFilter.MinFilter(21)).filter(ImageFilter.MaxFilter(21))
    resid = hgt - np.asarray(opened).astype(np.float64)
    treey = box_mean((resid > 22).astype(np.float64), 5) > 0.25
    dark = (light < 0.24) | ((hue > 88) & (hue < 170))
    forest = (treey | dark)
    forest = box_mean(forest.astype(np.float64), 6) > 0.45

    cls = np.full((H, W), "forest", dtype=object)
    cls[~forest] = "rough"
    # A band of first cut around the short grass, and a ring round green and tee.
    near_short = dilate(short | green | tee, 14)
    cls[near_short] = "rough"
    cls[rock] = "rock"
    cls[short] = "fairway"
    cls[green & (short | ~forest | near_short)] = "green"
    cls[tee] = "tee"
    cls[sand] = "sand"
    cls[water] = "water"
    cls[path & ~water] = "path"
    cls[oob] = "oob"
    return cls


def main():
    hints_file = pathlib.Path(sys.argv[1])
    out_dir = pathlib.Path(sys.argv[2])
    name = hints_file.stem
    hints = json.loads(hints_file.read_text())
    src = Image.open(hints_file.parent / hints["source"])
    paint, height = split_source(src)
    print(f"painting {paint.size}, height map {height.size}")

    cls = classify(paint, height, hints)
    out = np.zeros(cls.shape + (3,), dtype=np.uint8)
    for k, c in PALETTE.items():
        out[cls == k] = c
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out).save(out_dir / f"{name}-surface.png", optimize=True)

    ground = inpaint(paint, hints.get("inpaint", []))
    ground.save(out_dir / f"{name}-ground.jpg", quality=88, optimize=True, progressive=True)

    half = height.resize((paint.width // 2, paint.height // 2), Image.LANCZOS)
    half.save(out_dir / f"{name}-height.png", optimize=True)

    counts = {k: int((cls == k).sum()) for k in PALETTE}
    total = cls.size
    print("surfaces:", ", ".join(f"{k} {v * 100 / total:.1f}%" for k, v in counts.items() if v))
    for f in sorted(out_dir.glob(f"{name}-*")):
        print(f"wrote {f} ({f.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
