#!/usr/bin/env python3
"""Prepare JPEG/PNG game assets from generated raw art. No WebP."""
from pathlib import Path
from PIL import Image, ImageFilter, ImageChops, ImageDraw, ImageOps
import numpy as np

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
TEX = ROOT / "assets" / "textures"
SPR = ROOT / "assets" / "sprites"
UI = ROOT / "assets" / "ui"
for p in (TEX, SPR, UI):
    p.mkdir(parents=True, exist_ok=True)

def load(name):
    return Image.open(RAW / name).convert("RGB")

def make_seamless(im, blend=48):
    """Offset wrap + edge blend to reduce tiling seams."""
    im = im.convert("RGB")
    w, h = im.size
    off = ImageChops.offset(im, w // 2, h // 2)
    # blend a cross through the center (where the original edges now sit)
    arr = np.array(off, dtype=np.float32)
    orig = np.array(ImageChops.offset(im, 0, 0), dtype=np.float32)
    # actually blend off with a second offset of orig's wrap already in off
    mask = np.ones((h, w, 1), dtype=np.float32)
    bw = min(blend, w // 4, h // 4)
    for i in range(bw):
        a = (i + 1) / bw
        # soften the mid seams of the offset image by mixing a slightly blurred copy
    blur = np.array(off.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    # After offset, seams are at center lines
    dc = np.minimum(np.abs(xx - w // 2), np.abs(yy - h // 2))
    m = np.clip(dc / bw, 0, 1)[..., None]
    out = off  # start with offset
    arr = arr * m + blur * (1 - m)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

def crop_border(im, frac=0.06):
    w, h = im.size
    x, y = int(w * frac), int(h * frac)
    return im.crop((x, y, w - x, h - y))

def to_jpeg(im, dest, size=1024, quality=90):
    im = im.convert("RGB")
    if size and max(im.size) > size:
        im = ImageOps.fit(im, (size, size) if im.size[0] == im.size[1] else (
            size, int(size * im.size[1] / im.size[0])
        ), Image.Resampling.LANCZOS)
    # even sizes
    w, h = im.size
    im = im.resize((w - w % 2, h - h % 2), Image.Resampling.LANCZOS)
    im.save(dest, "JPEG", quality=quality, optimize=True, subsampling=0)

def normal_and_rough(im, dest_n, dest_r, size=1024, strength=1.6):
    im = im.convert("RGB")
    if size:
        im = ImageOps.fit(im, (size, size) if im.size[0] == im.size[1] else (size, int(size * im.size[1] / im.size[0])), Image.Resampling.LANCZOS)
    g = np.array(im.convert("L"), dtype=np.float32) / 255.0
    # Sobel
    kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float32)
    ky = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=np.float32)
    from scipy.ndimage import convolve
    try:
        dx = convolve(g, kx)
        dy = convolve(g, ky)
    except Exception:
        dx = np.gradient(g, axis=1)
        dy = np.gradient(g, axis=0)
    nz = np.ones_like(g) / max(0.15, strength)
    n = np.stack([0.5 - dx * strength * 0.5, 0.5 + dy * strength * 0.5, np.clip(nz * 2, 0.5, 1)], axis=2)
    n = n / (np.linalg.norm(np.stack([(n[...,0]-0.5)*2, (n[...,1]-0.5)*2, n[...,2]], axis=2), axis=2, keepdims=True) + 1e-8)
    nmap = np.stack([n[...,0]*0.5+0.5, n[...,1]*0.5+0.5, np.clip(n[...,2], 0, 1)], axis=2)
    Image.fromarray((np.clip(nmap, 0, 1) * 255).astype(np.uint8), "RGB").save(dest_n, "JPEG", quality=88, optimize=True)
    # roughness: mid-luma -> mid roughness, with a bit of noise
    rough = 0.35 + (1.0 - g) * 0.45
    Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8), "L").save(dest_r, "JPEG", quality=88, optimize=True)

def chroma_key(im, crop=True, fringe=1.6):
    """Key near-pure green. Returns RGBA."""
    im = im.convert("RGB")
    arr = np.array(im, dtype=np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    # Green screen: high G, G distinctly above R and B
    greeness = g - np.maximum(r, b)
    # also consider chroma distance from #00FF00
    dist = np.sqrt((r - 0) ** 2 + (g - 255) ** 2 + (b - 0) ** 2)
    # tight key
    alpha = np.ones(g.shape, dtype=np.float32)
    # full transparent if very green
    alpha = np.where((greeness > 40) & (g > 80) & (dist < 180), 0.0, alpha)
    # soft fringe
    soft = (greeness > 18) & (g > 60)
    t = np.clip((greeness - 18) / (40 * fringe), 0, 1)
    alpha = np.where(soft, np.minimum(alpha, 1.0 - t), alpha)
    # despill
    spill = np.clip((g - np.maximum(r, b)) / 80.0, 0, 1)
    g2 = g - spill * (g - (r + b) * 0.5)
    arr[..., 1] = np.clip(g2, 0, 255)
    rgba = np.dstack([arr, np.clip(alpha, 0, 1) * 255]).astype(np.uint8)
    out = Image.fromarray(rgba, "RGBA")
    if crop:
        bbox = out.split()[-1].point(lambda p: 255 if p > 8 else 0).getbbox()
        if bbox:
            pad = 4
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
        im = im.resize((int(w * s) // 2 * 2, int(h * s) // 2 * 2), Image.Resampling.LANCZOS)
    im.save(dest, "PNG", optimize=True)

# ---- textures ----
jobs = [
    ("asphalt_albedo.jpg", "asphalt.jpg", 1024, 0.0, 2.2),
    ("grass_albedo.jpg", "grass.jpg", 1024, 0.0, 1.8),
    ("concrete_albedo.jpg", "concrete.jpg", 1024, 0.0, 1.4),
    ("awning_stripe.jpg", "awning.jpg", 1024, 0.0, 1.0),
    ("wood_planks.jpg", "wood.jpg", 1024, 0.0, 1.6),
    ("brushed_metal.jpg", "metal.jpg", 1024, 0.0, 0.8),
    ("tire_rubber.jpg", "tire.jpg", 1024, 0.0, 2.0),
    ("booth_back.jpg", "booth_back.jpg", 1024, 0.0, 1.0),
]

# crimson metal: crop the darkened studio frame
crimson = crop_border(load("painted_metal_crimson.jpg"), 0.08)
crimson = make_seamless(crimson, 36)
to_jpeg(crimson, TEX / "paint_red.jpg", 1024, 92)
normal_and_rough(crimson, TEX / "paint_red_n.jpg", TEX / "paint_red_r.jpg", 1024, 0.7)

for src, dst, sz, _, strn in jobs:
    im = load(src)
    if src in ("asphalt_albedo.jpg", "grass_albedo.jpg", "concrete_albedo.jpg", "awning_stripe.jpg", "wood_planks.jpg"):
        im = make_seamless(im, 40)
    to_jpeg(im, TEX / dst, sz, 90)
    stem = Path(dst).stem
    normal_and_rough(im, TEX / f"{stem}_n.jpg", TEX / f"{stem}_r.jpg", sz, strn)

# skies, keep aspect, no square-fit
for src, dst, w in (("sky_day.jpg", "sky_day.jpg", 1536), ("sky_night.jpg", "sky_night.jpg", 1536)):
    im = load(src)
    h = int(w * im.size[1] / im.size[0])
    im = im.resize((w, h - h % 2), Image.Resampling.LANCZOS)
    im.save(TEX / dst, "JPEG", quality=90, optimize=True)

# ---- sprites ----
# logo: careful key (preserve dark green inside ornament)
logo = chroma_key(load("logo.jpg"), crop=True, fringe=1.3)
save_png(logo, UI / "logo.png", 1400)

tree = chroma_key(load("tree_oak.jpg"), crop=True, fringe=1.8)
save_png(tree, SPR / "tree.png", 1024)

gondola = chroma_key(load("gondola.jpg"), crop=True, fringe=1.4)
save_png(gondola, SPR / "gondola.png", 768)

food = chroma_key(load("food_sign.jpg"), crop=True, fringe=1.3)
save_png(food, SPR / "food_sign.png", 1200)

line = chroma_key(load("paint_line.jpg"), crop=True, fringe=1.5)
save_png(line, SPR / "paint_line.png", 1024)

# people
for name in ("person_a", "person_b", "person_c", "person_d"):
    im = load(f"{name}.jpg")
    # cover a possible sneaker logo on person_b (right shoe white swoosh)
    if name == "person_b":
        d = ImageDraw.Draw(im)
        # lower portion of frame, white sneakers — soft white paint over tiny marks
        w, h = im.size
        # we'll leave it and do a more targeted deswoosh after key if needed
        pass
    spr = chroma_key(im, crop=True, fringe=1.5)
    if name == "person_b":
        # paint over any leftover dark swoosh on white sneakers: find dark marks in lower 25%
        a = np.array(spr)
        h, w = a.shape[:2]
        region = a[int(h * 0.72):, :, :]
        # white-ish pixels with a dark contrast streak — just slightly blur the shoe area
        shoe = spr.crop((0, int(h * 0.72), w, h)).filter(ImageFilter.GaussianBlur(0.6))
        # more: raise dark blue marks on near-white toward white
        sa = np.array(shoe)
        lum = sa[..., :3].mean(axis=2)
        whiteish = (sa[..., 0] > 170) & (sa[..., 1] > 170) & (sa[..., 2] > 170)
        # push mid-dark logos on white toward neighbor
        sa[..., 0] = np.where(whiteish, np.maximum(sa[..., 0], 210), sa[..., 0])
        sa[..., 1] = np.where(whiteish, np.maximum(sa[..., 1], 210), sa[..., 1])
        sa[..., 2] = np.where(whiteish, np.maximum(sa[..., 2], 210), sa[..., 2])
        shoe = Image.fromarray(sa)
        spr.paste(shoe, (0, int(h * 0.72)))
    save_png(spr, SPR / f"{name}.png", 900)

print("done")
for p in sorted(list(TEX.glob("*")) + list(SPR.glob("*")) + list(UI.glob("*"))):
    print(f"  {p.relative_to(ROOT)}  {p.stat().st_size//1024}kb  {Image.open(p).size}")
