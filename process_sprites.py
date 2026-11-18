#!/usr/bin/env python3
"""Chroma-key and slice painted isometric sprites. PNG only, no WebP."""
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps, ImageDraw
import numpy as np

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
SPR = ROOT / "assets" / "sprites"
TEX = ROOT / "assets" / "textures"
SPR.mkdir(parents=True, exist_ok=True)
TEX.mkdir(parents=True, exist_ok=True)

def load(name):
    return Image.open(RAW / name).convert("RGB")

def key_magenta(im, crop=True, pad=6):
    im = im.convert("RGB")
    arr = np.array(im, dtype=np.float32)
    h, w = arr.shape[:2]
    def corner(x0, y0, x1, y1):
        return arr[y0:y1, x0:x1].reshape(-1, 3)
    bw = max(6, min(w, h) // 40)
    corners = np.concatenate([
        corner(0, 0, bw, bw),
        corner(w - bw, 0, w, bw),
        corner(0, h - bw, bw, h),
        corner(w - bw, h - bw, w, h),
    ])
    bg = np.median(corners, axis=0)
    dist = np.linalg.norm(arr - bg, axis=2)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    # bright magenta/hot-pink bg
    magish = (r > 180) & (b > 140) & (g < 90) & ((np.minimum(r, b) - g) > 70)
    alpha = np.ones((h, w), dtype=np.float32)
    alpha = np.where(dist < 28, 0.0, alpha)
    soft = np.clip((dist - 22) / 48.0, 0, 1)
    alpha = np.where(magish, np.minimum(alpha, soft), alpha)
    # despill magenta fringe toward neighbor luma
    spill = np.clip((np.minimum(r, b) - g - 40) / 120.0, 0, 1) * (alpha < 0.95)
    arr[..., 0] = np.clip(arr[..., 0] - spill * 35, 0, 255)
    arr[..., 2] = np.clip(arr[..., 2] - spill * 35, 0, 255)
    rgba = np.dstack([arr, np.clip(alpha, 0, 1) * 255]).astype(np.uint8)
    out = Image.fromarray(rgba, "RGBA")
    if crop:
        bbox = out.split()[-1].point(lambda p: 255 if p > 10 else 0).getbbox()
        if bbox:
            x0, y0, x1, y1 = bbox
            x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
            x1 = min(out.width, x1 + pad); y1 = min(out.height, y1 + pad)
            out = out.crop((x0, y0, x1, y1))
    return out

def save_png(im, dest, max_side=1024):
    im = im.convert("RGBA")
    w, h = im.size
    if max(w, h) > max_side:
        s = max_side / max(w, h)
        nw, nh = max(2, int(w * s) // 2 * 2), max(2, int(h * s) // 2 * 2)
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    else:
        w2, h2 = w - w % 2, h - h % 2
        if (w2, h2) != (w, h):
            im = im.resize((max(2, w2), max(2, h2)), Image.Resampling.LANCZOS)
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", optimize=True)
    return im

def flip_h(im):
    return ImageOps.mirror(im)

def components(im, min_area=400):
    a = np.array(im.split()[-1])
    mask = a > 12
    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    out = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or visited[y, x]:
                continue
            stack = [(x, y)]
            visited[y, x] = True
            cells = []
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((nx, ny))
            if len(cells) < min_area:
                continue
            xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            pad = 4
            x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
            x1 = min(w, x1 + pad + 1); y1 = min(h, y1 + pad + 1)
            out.append((x0, y0, x1, y1, len(cells)))
    out.sort(key=lambda t: (t[1] // 80, t[0]))  # row-ish then x
    return out

def slice_row(im, expected=8, min_gap=8):
    """Split a horizontal sprite sheet by alpha gaps."""
    a = np.array(im.split()[-1])
    col = (a > 12).any(axis=0)
    stretches = []
    i = 0
    n = len(col)
    while i < n:
        if not col[i]:
            i += 1
            continue
        j = i
        while j < n and col[j]:
            j += 1
        if j - i > 8:
            stretches.append((i, j))
        i = j
    # if we got too many tiny pieces, merge close ones
    if expected and len(stretches) > expected * 2:
        # keep the `expected` widest
        stretches = sorted(sorted(stretches, key=lambda s: s[1] - s[0], reverse=True)[:expected], key=lambda s: s[0])
    frames = []
    for x0, x1 in stretches:
        pad = 2
        xx0 = max(0, x0 - pad); xx1 = min(im.width, x1 + pad)
        # tight y crop per frame
        sub = im.crop((xx0, 0, xx1, im.height))
        bbox = sub.split()[-1].point(lambda p: 255 if p > 10 else 0).getbbox()
        if not bbox:
            continue
        frames.append(sub.crop(bbox))
    return frames

def make_light_pool(path, color=(255, 180, 80), size=512, inner=0.18):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    arr = np.zeros((size, size, 4), dtype=np.float32)
    cy = cx = (size - 1) / 2
    yy, xx = np.mgrid[0:size, 0:size]
    # ellipse flatter in z (iso light pool)
    rx, ry = size * 0.48, size * 0.28
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    fall = np.clip(1.0 - d, 0, 1)
    fall = fall ** 1.35
    core = np.clip(1.0 - d / inner, 0, 1) ** 2
    arr[..., 0] = color[0]
    arr[..., 1] = color[1]
    arr[..., 2] = color[2]
    arr[..., 3] = np.clip(fall * 200 + core * 55, 0, 255)
    Image.fromarray(arr.astype(np.uint8), "RGBA").save(path, "PNG", optimize=True)

def make_glow(path, color=(255, 210, 120), size=256):
    arr = np.zeros((size, size, 4), dtype=np.float32)
    cy = cx = (size - 1) / 2
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.sqrt(((xx - cx) / (size * 0.48)) ** 2 + ((yy - cy) / (size * 0.48)) ** 2)
    fall = np.clip(1.0 - d, 0, 1) ** 2
    arr[..., 0] = color[0]
    arr[..., 1] = color[1]
    arr[..., 2] = color[2]
    arr[..., 3] = fall * 255
    Image.fromarray(arr.astype(np.uint8), "RGBA").save(path, "PNG", optimize=True)

# ---------- skies ----------
for src, dst, w in (
    ("sky_day_golden.jpg", "sky_day.jpg", 2048),
    ("sky_night_carnival.jpg", "sky_night.jpg", 2048),
):
    im = load(src)
    h = int(w * im.size[1] / im.size[0])
    im = im.resize((w, h - h % 2), Image.Resampling.LANCZOS)
    im.save(TEX / dst, "JPEG", quality=92, optimize=True, subsampling=0)
    print("sky", dst, im.size)

# ---------- hero sprites ----------
heroes = {
    "truck_se.jpg": ("truck_se.png", 1024),
    "truck_sw.jpg": ("truck_sw.png", 1024),
    "truck_e.jpg": ("truck_e.png", 1024),
    "truck_ne_rear.jpg": ("truck_ne.png", 1024),
    "trailer_ferris_se.jpg": ("trailer_se.png", 1400),
    "trailer_ferris_e.jpg": ("trailer_e.png", 1400),
    "trailer_ferris_n.jpg": ("trailer_n.png", 1400),
    "ferris_00.jpg": ("ferris_00.png", 1400),
    "ferris_02.jpg": ("ferris_01.png", 1400),
    "ferris_night.jpg": ("ferris_night.png", 1400),
    "food_stand.jpg": ("food_stand.png", 1200),
    "food_stand_night.jpg": ("food_stand_night.png", 1200),
    "ring_booth.jpg": ("ring_booth.png", 1200),
    "ring_booth_night.jpg": ("ring_booth_night.png", 1200),
    "booth_close.jpg": ("booth_close.png", 1400),
}
for src, (dst, side) in heroes.items():
    p = RAW / src
    if not p.exists():
        print("missing", src)
        continue
    im = save_png(key_magenta(load(src)), SPR / dst, side)
    print("hero", dst, im.size)

# flips
pairs = [
    ("truck_se.png", "truck_nw.png"),  # will overwrite if needed; se flip is roughly sw, we already have sw
    ("truck_sw.png", "truck_ne_alt.png"),
    ("truck_ne.png", "truck_nw.png"),
    ("trailer_se.png", "trailer_sw.png"),
    ("trailer_n.png", "trailer_nw.png"),
    ("trailer_e.png", "trailer_w.png"),
]
# more careful mapping:
# se flip -> sw already exists; still write truck_se_flip as truck_es? Skip se->nw
# ne (rear 3/4 cab right) flip -> nw rear
if (SPR / "truck_se.png").exists() and not (SPR / "truck_sw.png").exists():
    save_png(flip_h(Image.open(SPR / "truck_se.png")), SPR / "truck_sw.png", 1024)
if (SPR / "truck_ne.png").exists():
    save_png(flip_h(Image.open(SPR / "truck_ne.png")), SPR / "truck_nw.png", 1024)
    print("flip truck_nw", Image.open(SPR / "truck_nw.png").size)
if (SPR / "trailer_se.png").exists():
    save_png(flip_h(Image.open(SPR / "trailer_se.png")), SPR / "trailer_sw.png", 1400)
    print("flip trailer_sw")
if (SPR / "trailer_n.png").exists():
    save_png(flip_h(Image.open(SPR / "trailer_n.png")), SPR / "trailer_ne.png", 1400)
    print("flip trailer_ne")
if (SPR / "trailer_e.png").exists():
    save_png(flip_h(Image.open(SPR / "trailer_e.png")), SPR / "trailer_w.png", 1400)
    print("flip trailer_w")

# ---------- people sheets ----------
for letter, src in (("a", "person_a_sheet.jpg"), ("b", "person_b_sheet.jpg"), ("c", "person_c_sheet.jpg")):
    keyed = key_magenta(load(src), crop=True, pad=2)
    frames = slice_row(keyed, expected=8)
    print(f"person_{letter} frames", len(frames), [f.size for f in frames])
    # normalize height
    if not frames:
        continue
    mh = max(f.size[1] for f in frames)
    for i, f in enumerate(frames):
        # pad to same height, feet at bottom
        canv = Image.new("RGBA", (f.size[0] + 4, mh + 4), (0, 0, 0, 0))
        canv.paste(f, (2, mh - f.size[1] + 2), f)
        save_png(canv, SPR / f"person_{letter}_{i}.png", 420)
        save_png(flip_h(canv), SPR / f"person_{letter}_{i}f.png", 420)

# ---------- props / cars packs ----------
def explode(src, prefix, min_area=800, max_side=900):
    keyed = key_magenta(load(src), crop=False, pad=0)
    boxes = components(keyed, min_area=min_area)
    print(prefix, "components", len(boxes), boxes)
    names = []
    for i, (x0, y0, x1, y1, area) in enumerate(boxes):
        piece = keyed.crop((x0, y0, x1, y1))
        # drop tiny leftover
        if piece.size[0] < 20 or piece.size[1] < 20:
            continue
        name = f"{prefix}_{i}.png"
        save_png(piece, SPR / name, max_side)
        names.append((name, piece.size, area))
        print("  ", name, piece.size, "area", area)
    return names

explode("props_pack.jpg", "prop", 600, 700)
explode("cars_and_lights.jpg", "set", 900, 1200)

# light decals
make_light_pool(SPR / "pool_warm.png", (255, 190, 90), 512)
make_light_pool(SPR / "pool_amber.png", (255, 140, 40), 512)
make_light_pool(SPR / "pool_ruby.png", (255, 60, 80), 512)
make_light_pool(SPR / "pool_head.png", (255, 230, 180), 384, inner=0.28)
make_glow(SPR / "glow_warm.png", (255, 210, 130), 256)
make_glow(SPR / "glow_ruby.png", (255, 80, 90), 256)
print("decals ok")

print("==== all sprites ====")
for p in sorted(SPR.glob("*.png")):
    im = Image.open(p)
    print(f"  {p.name:28s} {im.size[0]:4d}x{im.size[1]:<4d} {p.stat().st_size//1024:4d}kb")
