#!/usr/bin/env python3
"""Paint signage and ground overlays (JPEG/PNG, no WebP)."""
from __future__ import annotations
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parents[1]
SIGN_DIR = ROOT / "assets/textures/signs"
TEX_DIR = ROOT / "assets/textures"
PH = TEX_DIR / "ph"
SIGN_DIR.mkdir(parents=True, exist_ok=True)

FONT_DIR = Path("/usr/share/fonts/truetype/sand-box/google")
BUNGEE = FONT_DIR / "Bungee/Bungee-Regular.ttf"
LILITA = FONT_DIR / "Lilita One/LilitaOne-Regular.ttf"
BANGERS = FONT_DIR / "Bangers/Bangers-Regular.ttf"
TITAN = FONT_DIR / "Titan One/TitanOne-Regular.ttf"
BEBAS = FONT_DIR / "Bebas Neue/BebasNeue-Regular.ttf"
CINZEL = FONT_DIR / "Cinzel Decorative/CinzelDecorative-Bold.ttf"
ALFA = FONT_DIR / "Alfa Slab One/AlfaSlabOne-Regular.ttf"
BARLOW = FONT_DIR / "Barlow Condensed/BarlowCondensed-Bold.ttf"


def font(path, size):
    try:
        return ImageFont.truetype(str(path), size)
    except Exception:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)


def chalk_board(size=(768, 1024), title="CORN DOGS", sub="$4", accent=(1.0, 0.85, 0.35), motif="dog"):
    w, h = size
    img = Image.new("RGB", (w, h), (18, 28, 22))
    px = img.load()
    rng = np.random.default_rng(abs(hash(title)) % (2**31))
    # slate noise
    for y in range(h):
        for x in range(w):
            n = float(rng.normal(0, 6))
            r = 22 + n + 4 * math.sin(x * 0.05 + y * 0.03)
            g = 34 + n + 3 * math.sin(y * 0.04)
            b = 28 + n * 0.7
            px[x, y] = (int(max(8, min(55, r))), int(max(14, min(70, g))), int(max(12, min(58, b))))
    # oak frame later is the 3D model; leave a thin cream margin as painted edge
    draw = ImageDraw.Draw(img)
    # decorative corners
    ac = tuple(int(255 * c) for c in accent)
    m = 36
    draw.rectangle([m, m, w - m, h - m], outline=ac, width=4)
    draw.rectangle([m + 10, m + 10, w - m - 10, h - m - 10], outline=(210, 200, 160), width=2)
    # title
    f = font(BUNGEE if len(title) < 14 else BARLOW, 92 if len(title) < 12 else 72)
    # wrap
    words = title.split()
    lines = []
    if len(title) > 11 and len(words) > 1:
        mid = (len(words) + 1) // 2
        lines = [" ".join(words[:mid]), " ".join(words[mid:])]
    else:
        lines = [title]
    y = 90
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=f)
        tw = bbox[2] - bbox[0]
        x = (w - tw) // 2
        # chalk shadow
        draw.text((x + 2, y + 2), line, font=f, fill=(8, 10, 8))
        draw.text((x, y), line, font=f, fill=(236, 230, 210))
        y += bbox[3] - bbox[1] + 8
    # divider
    draw.line([(w * 0.22, y + 10), (w * 0.78, y + 10)], fill=ac, width=4)
    # subtitle price
    f2 = font(LILITA, 70)
    bbox = draw.textbbox((0, 0), sub, font=f2)
    tw = bbox[2] - bbox[0]
    draw.text(((w - tw) // 2, y + 28), sub, font=f2, fill=ac)
    # motif scribble
    cy = h - 280
    if motif == "dog":
        draw.ellipse([w/2 - 90, cy, w/2 + 110, cy + 70], outline=(230, 200, 130), width=6)
        draw.ellipse([w/2 + 80, cy + 8, w/2 + 150, cy + 62], outline=(230, 200, 130), width=6)
        draw.rectangle([w/2 - 40, cy + 80, w/2 + 40, cy + 200], outline=(200, 80, 60), width=6)
    elif motif == "cake":
        draw.arc([w/2 - 120, cy, w/2 + 120, cy + 160], 200, 340, fill=(245, 220, 160), width=16)
        draw.ellipse([w/2 - 16, cy + 20, w/2 + 16, cy + 50], fill=(255, 120, 160))
    elif motif == "cotton":
        for i, off in enumerate([(-40, 20), (0, 0), (50, 18), (10, 40)]):
            draw.ellipse([w/2 + off[0] - 70, cy + off[1], w/2 + off[0] + 70, cy + off[1] + 110], outline=(255, 150, 200), width=5)
        draw.line([(w/2, cy + 110), (w/2, cy + 210)], fill=(230, 220, 200), width=6)
    elif motif == "lemon":
        draw.ellipse([w/2 - 90, cy, w/2 + 90, cy + 140], outline=(255, 220, 80), width=8)
        draw.arc([w/2 - 40, cy + 40, w/2 + 40, cy + 100], 200, 340, fill=(255, 220, 80), width=6)
    elif motif == "pop":
        draw.polygon([(w/2, cy), (w/2 + 90, cy + 200), (w/2 - 90, cy + 200)], outline=(255, 230, 150), width=7)
        for i in range(8):
            a = i * math.pi / 4
            draw.ellipse([w/2 + math.cos(a)*30 - 8, cy + 70 + math.sin(a)*24 - 8,
                          w/2 + math.cos(a)*30 + 8, cy + 70 + math.sin(a)*24 + 8], fill=(255, 240, 200))
    elif motif == "leg":
        draw.pieslice([w/2 - 40, cy, w/2 + 90, cy + 200], 200, 80, outline=(180, 90, 50), width=8)
        draw.ellipse([w/2 + 40, cy + 150, w/2 + 95, cy + 210], outline=(230, 210, 170), width=6)
    elif motif == "pizza":
        draw.polygon([(w/2, cy), (w/2 + 110, cy + 200), (w/2 - 110, cy + 200)], outline=(230, 180, 70), width=7)
        for p in [(0, 80), (-40, 130), (40, 140), (0, 160)]:
            draw.ellipse([w/2 + p[0] - 14, cy + p[1] - 14, w/2 + p[0] + 14, cy + p[1] + 14], fill=(180, 40, 40))
    elif motif == "ring":
        draw.ellipse([w/2 - 80, cy + 20, w/2 + 80, cy + 180], outline=(255, 210, 70), width=14)
        draw.ellipse([w/2 - 48, cy + 52, w/2 + 48, cy + 148], outline=(255, 210, 70), width=6)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.4))
    # chalk dust
    dust = Image.effect_noise((w, h), 12).convert("L")
    img = ImageChops.add(img, Image.merge("RGB", [dust, dust, dust]), scale=6.0, offset=0)
    return img


SIGNS = {
    "corndog": ("CORN DOGS", "4 COINS", (1.0, 0.82, 0.25), "dog"),
    "funnelcake": ("FUNNEL CAKE", "5 COINS", (1.0, 0.75, 0.45), "cake"),
    "cotton": ("COTTON CANDY", "5 COINS", (1.0, 0.55, 0.75), "cotton"),
    "lemonade": ("LEMONADE", "3 COINS", (1.0, 0.9, 0.3), "lemon"),
    "popcorn": ("POPCORN", "4 COINS", (1.0, 0.85, 0.4), "pop"),
    "turkey": ("TURKEY LEGS", "7 COINS", (0.85, 0.45, 0.2), "leg"),
    "pizza": ("HOT PIZZA", "6 COINS", (0.95, 0.35, 0.2), "pizza"),
    "ringtoss": ("RING TOSS", "WIN A PRIZE", (0.3, 0.85, 1.0), "ring"),
    "tickets": ("TICKETS", "THIS WAY", (1.0, 0.85, 0.2), "ring"),
}


def make_signs():
    for key, (title, sub, ac, motif) in SIGNS.items():
        img = chalk_board(title=title, sub=sub, accent=ac, motif=motif)
        path = SIGN_DIR / f"{key}.jpg"
        img.save(path, "JPEG", quality=90, optimize=True)
        print("sign", path, path.stat().st_size)


def composite_asphalt():
    src = PH / "aerial_asphalt_01_diff_1k.jpg"
    if not src.exists():
        print("missing", src)
        return
    base = Image.open(src).convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
    # tile 2x2 already 1k -> 2k
    # paint faded white stall lines and a yellow mid stripe in a subtle grid
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    w, h = base.size
    # soft worn white bay lines every 256 px
    for x in range(64, w, 256):
        d.rectangle([x, 0, x + 7, h], fill=(230, 225, 210, 70))
    for y in range(64, h, 256):
        d.rectangle([0, y, w, y + 7], fill=(230, 225, 210, 55))
    # yellow midway stripe
    for y in (h // 2 - 10, h // 2 + 6):
        d.rectangle([0, y, w, y + 6], fill=(230, 190, 40, 90))
    # scuffs
    rng = np.random.default_rng(11)
    for _ in range(40):
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        ww, hh = int(rng.integers(20, 80)), int(rng.integers(3, 8))
        d.rectangle([x, y, x + ww, y + hh], fill=(20, 18, 16, int(rng.integers(20, 50))))
    overlay = overlay.filter(ImageFilter.GaussianBlur(1.2))
    out = base.convert("RGBA")
    out = Image.alpha_composite(out, overlay).convert("RGB")
    out = ImageEnhance.Contrast(out).enhance(1.08)
    out = ImageEnhance.Color(out).enhance(0.92)
    dest = TEX_DIR / "asphalt_lines.jpg"
    out.save(dest, "JPEG", quality=90, optimize=True)
    print("asphalt", dest, dest.stat().st_size)
    # copy matching normal/rough if present
    for kind, name in [("n", "aerial_asphalt_01_nor_gl_1k.jpg"), ("r", "aerial_asphalt_01_rough_1k.jpg")]:
        p = PH / name
        if p.exists():
            im = Image.open(p).convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
            im.save(TEX_DIR / f"asphalt_lines_{kind}.jpg", "JPEG", quality=90, optimize=True)


def composite_midway():
    mud = Image.open(PH / "brown_mud_03_diff_1k.jpg").convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
    wood = Image.open(PH / "wood_floor_diff_1k.jpg").convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
    # blend toward sawdust: warm wood over dirt
    mix = Image.blend(mud, wood, 0.55)
    mix = ImageEnhance.Color(mix).enhance(1.15)
    mix = ImageEnhance.Brightness(mix).enhance(1.08)
    # scattered sawdust flecks
    arr = np.array(mix)
    rng = np.random.default_rng(4)
    speck = rng.random((2048, 2048))
    mask = speck > 0.97
    arr[mask] = np.clip(arr[mask] + rng.integers(-8, 18, size=arr[mask].shape), 0, 255)
    Image.fromarray(arr).save(TEX_DIR / "midway.jpg", "JPEG", quality=90, optimize=True)
    print("midway", TEX_DIR / "midway.jpg")
    # normals: prefer wood
    n = Image.open(PH / "wood_floor_nor_gl_1k.jpg").convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
    n.save(TEX_DIR / "midway_n.jpg", "JPEG", quality=90, optimize=True)
    r = Image.open(PH / "wood_floor_rough_1k.jpg").convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
    r.save(TEX_DIR / "midway_r.jpg", "JPEG", quality=90, optimize=True)


def bunting_texture():
    w, h = 1024, 256
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    colors = [(200, 30, 40, 255), (240, 230, 210, 255), (30, 70, 160, 255),
              (230, 180, 30, 255), (20, 120, 70, 255), (200, 30, 40, 255)]
    n = 8
    gap = w / n
    for i in range(n):
        x0 = i * gap + 4
        x1 = (i + 1) * gap - 4
        xm = (x0 + x1) / 2
        col = colors[i % len(colors)]
        d.polygon([(x0, 8), (x1, 8), (xm, h - 12)], fill=col, outline=(20, 12, 10, 255))
    # rope
    d.rectangle([0, 0, w, 10], fill=(50, 35, 22, 255))
    dest = TEX_DIR / "bunting.png"
    img.save(dest, "PNG", optimize=True)
    print("bunting", dest)


if __name__ == "__main__":
    make_signs()
    composite_asphalt()
    composite_midway()
    bunting_texture()
