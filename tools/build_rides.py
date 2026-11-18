#!/usr/bin/env python3
"""Build mid-poly PBR carnival ride, vendor, and path GLBs for Lights on the Lot.

Original models for this game. Y-up, meters, origin on the ground at the
footprint center. Named nodes (wheel, gondola_*, car, sign, steam, horse_*,
platform, canopy) are animated in-engine.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_vehicles import (
    GLB, box, cyl, merge, sphere, torus_arc, make_mats, paint_tex, wood_tex,
)

OUT = Path("/workspace/lights-on-the-lot/assets/models")
ICON = Path("/workspace/lights-on-the-lot/assets/ui/icons")
OUT.mkdir(parents=True, exist_ok=True)
ICON.mkdir(parents=True, exist_ok=True)


def quat_x(a):
    s, c = math.sin(a / 2), math.cos(a / 2)
    return (s, 0, 0, c)


def quat_y(a):
    s, c = math.sin(a / 2), math.cos(a / 2)
    return (0, s, 0, c)


def quat_z(a):
    s, c = math.sin(a / 2), math.cos(a / 2)
    return (0, 0, s, c)


def stripe_tex(c1, c2, size=256, bands=10, vertical=True):
    img = Image.new("RGB", (size, size))
    px = img.load()
    rng = np.random.default_rng(11)
    for y in range(size):
        for x in range(size):
            t = x if vertical else y
            band = (t * bands) // size
            n = float(rng.normal(0, 4))
            src = c1 if band % 2 == 0 else c2
            px[x, y] = tuple(int(max(0, min(255, v + n))) for v in src)
    return img


def sign_tex(title, subtitle, bg=(40, 18, 22), fg=(255, 220, 150), size=256):
    img = Image.new("RGB", (size, size), bg)
    d = ImageDraw.Draw(img)
    # ornate frame
    gold = (210, 170, 70)
    d.rectangle([8, 8, size - 9, size - 9], outline=gold, width=6)
    d.rectangle([16, 16, size - 17, size - 17], outline=(120, 80, 30), width=2)
    # fill panel
    for y in range(22, size - 22):
        shade = int(8 * math.sin(y * 0.08))
        d.line([(22, y), (size - 23, y)], fill=(bg[0] + 10 + shade, bg[1] + 6, bg[2] + 4))
    # typography — default font, stacked
    def fit(text, y, fill, max_w=200):
        # try to center with default bitmap font
        w = d.textlength(text) if hasattr(d, "textlength") else len(text) * 6
        scale = 1
        d.text(((size - w) / 2, y), text, fill=fill)
    fit(title.upper(), 90, fg)
    if subtitle:
        fit(subtitle, 140, (230, 200, 140))
    return img


def carnival_mats(g: GLB):
    wood = g.add_image(wood_tex())
    paint = g.add_image(paint_tex())
    awn_red = g.add_image(stripe_tex((160, 28, 32), (245, 230, 210), bands=8))
    awn_blue = g.add_image(stripe_tex((32, 64, 140), (245, 230, 210), bands=8))
    awn_pink = g.add_image(stripe_tex((200, 70, 130), (255, 230, 240), bands=8))
    awn_yellow = g.add_image(stripe_tex((200, 150, 30), (40, 24, 16), bands=8))
    awn_green = g.add_image(stripe_tex((30, 110, 60), (245, 230, 200), bands=8))
    awn_teal = g.add_image(stripe_tex((20, 110, 120), (245, 230, 200), bands=8))
    awn_orange = g.add_image(stripe_tex((200, 80, 20), (245, 230, 200), bands=8))
    m = make_mats(g, wood=wood, paint=paint)
    m.update({
        "awnRed": g.material("awnRed", (1, 1, 1), metal=0, rough=0.7, texture=awn_red),
        "awnBlue": g.material("awnBlue", (1, 1, 1), metal=0, rough=0.7, texture=awn_blue),
        "awnPink": g.material("awnPink", (1, 1, 1), metal=0, rough=0.7, texture=awn_pink),
        "awnYellow": g.material("awnYellow", (1, 1, 1), metal=0, rough=0.7, texture=awn_yellow),
        "awnGreen": g.material("awnGreen", (1, 1, 1), metal=0, rough=0.7, texture=awn_green),
        "awnTeal": g.material("awnTeal", (1, 1, 1), metal=0, rough=0.7, texture=awn_teal),
        "awnOrange": g.material("awnOrange", (1, 1, 1), metal=0, rough=0.7, texture=awn_orange),
        "pink": g.material("pink", (0.95, 0.45, 0.7), metal=0.05, rough=0.4, clearcoat=0.4),
        "bluePaint": g.material("bluePaint", (0.12, 0.28, 0.62), metal=0.15, rough=0.3, clearcoat=0.8),
        "yellowPaint": g.material("yellowPaint", (0.85, 0.7, 0.12), metal=0.1, rough=0.35, clearcoat=0.6),
        "greenPaint": g.material("greenPaint", (0.12, 0.45, 0.22), metal=0.1, rough=0.35, clearcoat=0.5),
        "whitePaint": g.material("whitePaint", (0.92, 0.9, 0.85), metal=0.08, rough=0.35, clearcoat=0.5),
        "orangePaint": g.material("orangePaint", (0.85, 0.32, 0.08), metal=0.12, rough=0.32, clearcoat=0.6),
        "tealPaint": g.material("tealPaint", (0.08, 0.45, 0.48), metal=0.12, rough=0.32, clearcoat=0.5),
        "bulbAmber": g.material("bulbAmber", (1, 0.85, 0.4), metal=0, rough=0.25, emissive=(1.0, 0.7, 0.15), emi=1),
        "bulbRuby": g.material("bulbRuby", (1, 0.2, 0.12), metal=0, rough=0.25, emissive=(1.0, 0.15, 0.05), emi=1),
        "bulbWhite": g.material("bulbWhite", (1, 0.96, 0.9), metal=0, rough=0.2, emissive=(1, 0.95, 0.85), emi=1),
        "bulbBlue": g.material("bulbBlue", (0.4, 0.7, 1), metal=0, rough=0.25, emissive=(0.3, 0.55, 1), emi=1),
        "bulbLime": g.material("bulbLime", (0.5, 1, 0.3), metal=0, rough=0.25, emissive=(0.4, 1, 0.2), emi=1),
        "cotton": g.material("cotton", (1, 0.7, 0.85), metal=0, rough=0.85),
        "bread": g.material("bread", (0.62, 0.4, 0.16), metal=0, rough=0.8),
        "lemon": g.material("lemon", (0.95, 0.85, 0.2), metal=0, rough=0.5),
        "popcorn": g.material("popcorn", (0.95, 0.88, 0.65), metal=0, rough=0.7),
        "meat": g.material("meat", (0.45, 0.2, 0.1), metal=0, rough=0.65),
        "cheese": g.material("cheese", (0.9, 0.7, 0.2), metal=0, rough=0.6),
        "sauce": g.material("sauce", (0.7, 0.12, 0.08), metal=0, rough=0.4),
        "steam": g.material("steam", (0.9, 0.92, 0.95), metal=0, rough=1, alpha=0.25, double=True),
    })
    return m


def prims(items):
    """items: list of (mesh_tuple, mat)"""
    return [(p, n, u, i, mat) for (p, n, u, i), mat in items]


# ---------------------------------------------------------------------------
# Ferris wheel
# ---------------------------------------------------------------------------

def build_ferris():
    g = GLB()
    m = carnival_mats(g)
    R = 2.35
    # platform / base
    deck = box(0, 0.08, 0, 5.4, 0.16, 5.4)
    curb = box(0, 0.14, 0, 5.6, 0.08, 5.6)
    # A-frame supports in YZ? Wheel is in YZ (axis X), supports along X
    # two A-frames at x=±0.55
    legs = []
    for x, side in ((-0.62, 1), (0.62, -1)):
        # front/back legs
        for zsgn in (-1, 1):
            # lean toward center in z
            legs.append(cyl(x, 1.15, zsgn * 1.35, 0.08, 2.6, axis='y', seg=8, rz=0, rx=zsgn * -0.48))
        # cross beam
        legs.append(cyl(x, 2.15, 0, 0.07, 2.2, axis='z', seg=8))
        legs.append(box(x, 2.45, 0, 0.16, 0.18, 0.18))
    # axle housing
    axle = cyl(0, 2.45, 0, 0.13, 1.5, axis='x', seg=12)
    hub = cyl(0, 2.45, 0, 0.28, 0.35, axis='x', seg=14)
    # ticket kiosk at the front-left
    kiosk = [
        box(-1.9, 0.7, 2.15, 1.1, 1.3, 0.9),
        box(-1.9, 1.42, 2.15, 1.2, 0.08, 1.0),
    ]
    base_prims = prims([
        (deck, m["concrete"] if "concrete" in m else m["steelDark"]),
        (curb, m["steelDark"]),
        *[(leg, m["steel"]) for leg in legs],
        (axle, m["chrome"]),
        (hub, m["gold"]),
        (kiosk[0], m["wood"]),
        (kiosk[1], m["paint"]),
        (box(-1.9, 1.05, 2.55, 0.9, 0.55, 0.06), m["gold"]),
    ])
    # concrete isn't in make_mats — I used a fallback. Add a cream pad instead already have deck as steelDark...
    # Use cream for deck
    base_prims[0] = (*base_prims[0][:4], m["cream"])
    base_mesh = g.add_prims("ferris_base", base_prims)
    base_n = g.node("base", mesh=base_mesh)

    # Wheel parts at origin; node placed at axle (0, 2.45, 0)
    # Rim: two tori + spokes
    rim_o = torus_arc(0, 0, 0, R, 0.07, 0, math.tau, seg=36, tube=7, rx=0, ry=math.pi / 2)
    # ry=pi/2 should put torus in YZ plane (axis along X)
    rim_i = torus_arc(0, 0, 0, R - 0.22, 0.045, 0, math.tau, seg=28, tube=6, rx=0, ry=math.pi / 2)
    spokes = []
    for i in range(12):
        a = i / 12 * math.tau
        # spoke along YZ from hub to rim, axis is in YZ
        # cyl along Y then rotate around X
        spokes.append(cyl(0, 0, 0, 0.03, R - 0.1, axis='y', seg=6, rx=a))
    # decorative plates
    plates = []
    for i in range(12):
        a = i / 12 * math.tau
        y, z = math.cos(a) * (R - 0.11), math.sin(a) * (R - 0.11)
        plates.append(sphere(0, y, z, 0.08, seg=8, rings=6))

    wheel_body = prims([
        (rim_o, m["paint"]),
        (rim_i, m["gold"]),
        *[(s, m["steel"]) for s in spokes],
        *[(p, m["goldBright"]) for p in plates],
        (cyl(0, 0, 0, 0.22, 0.22, axis='x', seg=14), m["chrome"]),
    ])
    wheel_mesh = g.add_prims("ferris_wheel", wheel_body)
    wheel_node = g.node("wheel", mesh=wheel_mesh, extras={"role": "wheel"})

    # chase-light bulbs around the outer rim (named for animation)
    bulb_mesh_a = g.add_prims("bulb_amber", prims([(sphere(0, 0, 0, 0.055, seg=7, rings=5), m["bulbAmber"])]))
    bulb_mesh_r = g.add_prims("bulb_ruby", prims([(sphere(0, 0, 0, 0.055, seg=7, rings=5), m["bulbRuby"])]))
    bulb_mesh_w = g.add_prims("bulb_white", prims([(sphere(0, 0, 0, 0.055, seg=7, rings=5), m["bulbWhite"])]))
    bulb_meshes = [bulb_mesh_a, bulb_mesh_r, bulb_mesh_w]
    bulb_nodes = []
    N_BULB = 24
    for i in range(N_BULB):
        a = i / N_BULB * math.tau
        y, z = math.cos(a) * R, math.sin(a) * R
        bn = g.node(f"bulb_{i:02d}", mesh=bulb_meshes[i % 3], t=(0, y, z), extras={"role": "bulb", "index": i})
        bulb_nodes.append(bn)
    # attach bulbs as children of wheel — we'll reparent in JS after load if they're siblings
    # Actually put them as children: wheel node needs children list. Recreate wheel as parent.

    # Gondolas — 12, hang from rim, stay upright via counter-rotation in JS
    # cabin: onion seat
    cabin = merge([
        box(0, -0.18, 0, 0.42, 0.22, 0.32),
        box(0, -0.02, 0, 0.38, 0.12, 0.28),
        # hanger bar
        cyl(0, 0.16, 0, 0.018, 0.28, axis='y', seg=6),
        box(0, 0.30, 0, 0.16, 0.04, 0.16),
    ])
    gond_mesh = g.add_prims("gondola", prims([
        (cabin, m["paint"]),
        (box(0, -0.18, 0.14, 0.36, 0.16, 0.02), m["gold"]),
        (sphere(0, 0.32, 0, 0.05, seg=6, rings=4), m["goldBright"]),
    ]))
    gond_nodes = []
    N_G = 12
    for i in range(N_G):
        a = i / N_G * math.tau
        y, z = math.cos(a) * (R - 0.02), math.sin(a) * (R - 0.02)
        gn = g.node(f"gondola_{i:02d}", mesh=gond_mesh, t=(0, y, z), extras={"role": "gondola", "index": i})
        gond_nodes.append(gn)

    # Wheel group at axle
    wheel_grp = g.node("wheel", children=[wheel_node, *bulb_nodes, *gond_nodes],
                       t=(0, 2.45, 0), extras={"role": "wheel"})
    # Oh I created two nodes named "wheel". The first wheel_node is the mesh, the group is also "wheel".
    # Rename the mesh node.
    g.nodes[wheel_node]["name"] = "wheel_mesh"

    g.save(OUT / "ride_ferris.glb", [base_n, wheel_grp])


# ---------------------------------------------------------------------------
# Super Loop
# ---------------------------------------------------------------------------

def build_superloop():
    g = GLB()
    m = carnival_mats(g)
    R = 2.15
    # platform
    deck = box(0, 0.07, 0, 5.5, 0.14, 5.5)
    # fence ring low
    fence = []
    for i in range(16):
        a = i / 16 * math.tau
        x, z = math.cos(a) * 2.65, math.sin(a) * 2.65
        fence.append(cyl(x, 0.45, z, 0.035, 0.7, axis='y', seg=6))
    rail = torus_arc(0, 0.75, 0, 2.65, 0.03, 0, math.tau, seg=24, tube=6)
    # support towers either side of loop (along X)
    towers = [
        box(-1.15, 1.6, 0, 0.22, 3.2, 0.22),
        box(1.15, 1.6, 0, 0.22, 3.2, 0.22),
        box(0, 3.15, 0, 2.5, 0.16, 0.16),
        box(-1.15, 0.3, 0, 0.5, 0.2, 0.5),
        box(1.15, 0.3, 0, 0.5, 0.2, 0.5),
    ]
    # track: torus in YZ, center at (0, R, 0)
    # torus_arc default is in XY (axis Z). We want axis X, so ry=pi/2.
    track = torus_arc(0, R, 0, R, 0.09, 0, math.tau, seg=40, tube=10, ry=math.pi / 2)
    # inner rail
    track2 = torus_arc(0, R, 0, R, 0.045, 0, math.tau, seg=32, tube=8, ry=math.pi / 2)
    # ties / crossties around the loop
    ties = []
    for i in range(18):
        a = i / 18 * math.tau
        y = R - R * math.cos(a)
        z = R * math.sin(a)
        ties.append(box(0, y, z, 0.55, 0.05, 0.07, rx=a))

    # chase bulbs on the track
    bulb_m = g.add_prims("sl_bulb", prims([(sphere(0, 0, 0, 0.06, seg=7, rings=5), m["bulbLime"])]))
    bulb_b = g.add_prims("sl_bulb_b", prims([(sphere(0, 0, 0, 0.06, seg=7, rings=5), m["bulbBlue"])]))
    bulb_nodes = []
    for i in range(20):
        a = i / 20 * math.tau
        y = R - R * math.cos(a)
        z = R * math.sin(a)
        mesh_i = bulb_m if i % 2 == 0 else bulb_b
        # offset slightly outward on X
        bulb_nodes.append(g.node(f"bulb_{i:02d}", mesh=mesh_i, t=(0.16, y, z), extras={"role": "bulb", "index": i}))

    static = prims([
        (deck, m["cream"]),
        *[(f, m["steelDark"]) for f in fence],
        (rail, m["steel"]),
        *[(t, m["bluePaint"] if i < 2 else m["steel"]) for i, t in enumerate(towers)],
        (track, m["yellowPaint"]),
        (track2, m["steel"]),
        *[(t, m["steelDark"]) for t in ties],
        (box(0, 0.2, 0, 1.4, 0.12, 0.8), m["steelDark"]),  # load platform
    ])
    static_mesh = g.add_prims("loop_static", static)
    static_n = g.node("base", mesh=static_mesh)

    # Car — a short coaster car, will be parented to arm at loop center
    car_body = merge([
        box(0, 0.12, 0, 0.42, 0.18, 0.7),
        box(0, 0.26, -0.05, 0.38, 0.14, 0.5),
        # nose
        box(0, 0.14, 0.32, 0.36, 0.14, 0.18),
    ])
    car_mesh = g.add_prims("loop_car", prims([
        (car_body, m["paint"]),
        (box(0, 0.22, 0.36, 0.3, 0.08, 0.04), m["chrome"]),
        (cyl(-0.18, 0.05, 0.2, 0.08, 0.08, axis='x', seg=10), m["rubber"]),
        (cyl(0.18, 0.05, 0.2, 0.08, 0.08, axis='x', seg=10), m["rubber"]),
        (cyl(-0.18, 0.05, -0.22, 0.08, 0.08, axis='x', seg=10), m["rubber"]),
        (cyl(0.18, 0.05, -0.22, 0.08, 0.08, axis='x', seg=10), m["rubber"]),
        (sphere(-0.12, 0.22, 0.38, 0.04, seg=6, rings=4), m["bulbAmber"]),
        (sphere(0.12, 0.22, 0.38, 0.04, seg=6, rings=4), m["bulbAmber"]),
    ]))
    # Arm at loop center (0, R, 0). Car offset to the bottom of the loop (0, -R, 0) in arm space.
    # When arm.rotation.x = 0, car is at world (0, 0, 0) — but bottom of track is y≈0.09 (tube).
    # Put car at (0, -R + 0.18, 0) so wheels sit on the rail.
    car_n = g.node("car", mesh=car_mesh, t=(0, -R + 0.22, 0), extras={"role": "car"})
    arm = g.node("arm", children=[car_n], t=(0, R, 0), extras={"role": "arm"})

    g.save(OUT / "ride_superloop.glb", [static_n, arm, *bulb_nodes])


# ---------------------------------------------------------------------------
# Carousel
# ---------------------------------------------------------------------------

def build_carousel():
    g = GLB()
    m = carnival_mats(g)
    R = 1.85
    deck = box(0, 0.07, 0, 4.8, 0.14, 4.8)
    floor = cyl(0, 0.16, 0, R + 0.15, 0.1, axis='y', seg=24, cap=True)
    pole = cyl(0, 1.5, 0, 0.12, 2.8, axis='y', seg=14)
    # canopy — cone + scallop ring
    canopy = cyl(0, 2.85, 0, 0.2, 0.15, axis='y', seg=10, cap=True, r_top=0.02)
    roof = cyl(0, 2.55, 0, R + 0.25, 0.16, axis='y', seg=20, cap=True, r_top=0.35)
    finial = sphere(0, 3.05, 0, 0.12, seg=8, rings=6)
    # decorative skirt
    skirt = cyl(0, 2.42, 0, R + 0.28, 0.12, axis='y', seg=20, cap=False)
    static = prims([
        (deck, m["cream"]),
        (floor, m["wood"]),
        (pole, m["gold"]),
        (box(0, 0.4, 0, 0.35, 0.5, 0.35), m["goldBright"]),
    ])
    static_n = g.node("base", mesh=g.add_prims("car_base", static))

    canopy_mesh = g.add_prims("canopy", prims([
        (canopy, m["gold"]),
        (roof, m["paint"]),
        (finial, m["goldBright"]),
        (skirt, m["awnRed"]),
    ]))
    canopy_n = g.node("canopy", mesh=canopy_mesh, extras={"role": "canopy"})

    # rotating platform with horses
    plat_mesh = g.add_prims("platform", prims([
        (cyl(0, 0.22, 0, R + 0.12, 0.08, axis='y', seg=20, cap=True), m["paint"]),
        (cyl(0, 0.26, 0, R - 0.05, 0.04, axis='y', seg=16, cap=True), m["gold"]),
    ]))
    plat_root_parts = [g.node("platform_mesh", mesh=plat_mesh)]

    # horse: simple stylized body
    horse = merge([
        box(0, 0.28, 0, 0.16, 0.22, 0.42),  # body
        box(0, 0.42, 0.18, 0.12, 0.2, 0.16),  # neck
        box(0, 0.52, 0.28, 0.12, 0.12, 0.14),  # head
        box(0, 0.08, 0.12, 0.08, 0.16, 0.08),
        box(0, 0.08, -0.14, 0.08, 0.16, 0.08),
    ])
    # two color variants
    h_red = g.add_prims("horse_red", prims([(horse, m["paint"]), (box(0, 0.36, 0, 0.18, 0.04, 0.2), m["gold"])]))
    h_wht = g.add_prims("horse_wht", prims([(horse, m["whitePaint"]), (box(0, 0.36, 0, 0.18, 0.04, 0.2), m["gold"])]))
    horses = []
    for i in range(8):
        a = i / 8 * math.tau
        x, z = math.cos(a) * (R - 0.45), math.sin(a) * (R - 0.45)
        pole_i = cyl(0, 0.9, 0, 0.025, 1.8, axis='y', seg=6)
        pm = g.add_prims(f"hpole_{i}", prims([(pole_i, m["chrome"])]))
        hn = g.node(f"horse_{i:02d}", mesh=(h_red if i % 2 == 0 else h_wht), t=(0, 0.15, 0),
                    r=quat_y(-a + math.pi / 2), extras={"role": "horse", "index": i})
        group = g.node(f"horse_rig_{i:02d}", children=[g.node(f"hpole_n_{i}", mesh=pm), hn],
                       t=(x, 0, z), extras={"role": "horse_rig", "index": i})
        horses.append(group)

    platform = g.node("platform", children=plat_root_parts + horses, extras={"role": "platform"})
    g.save(OUT / "ride_carousel.glb", [static_n, canopy_n, platform])


# ---------------------------------------------------------------------------
# Tilt-A-Whirl
# ---------------------------------------------------------------------------

def build_tilt():
    g = GLB()
    m = carnival_mats(g)
    deck = box(0, 0.07, 0, 5.2, 0.14, 5.2)
    bowl = cyl(0, 0.2, 0, 2.2, 0.16, axis='y', seg=20, cap=True)
    rim = torus_arc(0, 0.32, 0, 2.2, 0.06, 0, math.tau, seg=24, tube=6)
    center = cyl(0, 0.45, 0, 0.2, 0.5, axis='y', seg=12)
    static_n = g.node("base", mesh=g.add_prims("tilt_base", prims([
        (deck, m["cream"]), (bowl, m["tealPaint"]), (rim, m["chrome"]), (center, m["gold"]),
    ])))
    platform = g.node("platform", extras={"role": "platform"})
    # wait, platform needs children cars — we'll add after creating cars, so create cars first then platform
    car_mesh = g.add_prims("tilt_car", prims([
        (cyl(0, 0.2, 0, 0.42, 0.18, axis='y', seg=12, cap=True), m["paint"]),
        (cyl(0, 0.32, 0, 0.38, 0.12, axis='y', seg=12, cap=False), m["paintDark"]),
        (box(0, 0.28, 0.3, 0.3, 0.2, 0.08), m["cream"]),
        (cyl(0, 0.12, 0, 0.12, 0.1, axis='y', seg=8), m["chrome"]),
    ]))
    cars = []
    for i in range(5):
        a = i / 5 * math.tau
        x, z = math.cos(a) * 1.35, math.sin(a) * 1.35
        # arm from center
        arm_m = g.add_prims(f"tilt_arm_{i}", prims([(box(0.67, 0.16, 0, 1.35, 0.08, 0.14), m["steel"])]))
        arm_n = g.node(f"arm_{i}", mesh=arm_m, r=quat_y(-a))
        car = g.node(f"car_{i:02d}", mesh=car_mesh, t=(x, 0.22, z), extras={"role": "car", "index": i})
        cars.extend([arm_n, car])
    # rebuild platform with children — we already created empty platform node. Just set children.
    plat_idx = g.node("platform", children=cars, extras={"role": "platform"})
    # Oh we have a leftover empty platform from earlier? I didn't actually create it yet in this version.
    g.save(OUT / "ride_tilt.glb", [static_n, plat_idx])


# ---------------------------------------------------------------------------
# Bumper cars
# ---------------------------------------------------------------------------

def build_bumper():
    g = GLB()
    m = carnival_mats(g)
    deck = box(0, 0.06, 0, 5.6, 0.12, 5.6)
    floor = box(0, 0.1, 0, 5.0, 0.08, 5.0)
    # walls
    walls = [
        box(0, 0.45, 2.55, 5.2, 0.7, 0.16),
        box(0, 0.45, -2.55, 5.2, 0.7, 0.16),
        box(2.55, 0.45, 0, 0.16, 0.7, 5.2),
        box(-2.55, 0.45, 0, 0.16, 0.7, 5.2),
    ]
    rail = [
        box(0, 0.85, 2.55, 5.2, 0.08, 0.12),
        box(0, 0.85, -2.55, 5.2, 0.08, 0.12),
        box(2.55, 0.85, 0, 0.12, 0.08, 5.2),
        box(-2.55, 0.85, 0, 0.12, 0.08, 5.2),
    ]
    static_n = g.node("base", mesh=g.add_prims("bump_base", prims([
        (deck, m["steelDark"]), (floor, m["awnBlue"]),
        *[(w, m["bluePaint"]) for w in walls],
        *[(r, m["chrome"]) for r in rail],
    ])))
    colors = ["paint", "yellowPaint", "greenPaint", "orangePaint", "whitePaint"]
    car_nodes = []
    body = merge([
        cyl(0, 0.16, 0, 0.42, 0.18, axis='y', seg=12, cap=True),
        box(0, 0.28, 0, 0.4, 0.16, 0.55),
    ])
    starts = [(-1.2, 0.8), (1.1, -0.9), (0.2, 1.3), (-1.0, -1.2), (1.3, 0.4)]
    for i, ((x, z), col) in enumerate(zip(starts, colors)):
        cm = g.add_prims(f"bcar_{i}", prims([
            (body, m[col]),
            (torus_arc(0, 0.2, 0, 0.46, 0.07, 0, math.tau, seg=14, tube=6), m["rubber"]),
            (box(0, 0.4, -0.05, 0.28, 0.1, 0.2), m["chrome"]),
        ]))
        car_nodes.append(g.node(f"car_{i:02d}", mesh=cm, t=(x, 0, z), extras={"role": "car", "index": i}))
    g.save(OUT / "ride_bumper.glb", [static_n, *car_nodes])


# ---------------------------------------------------------------------------
# Vendors
# ---------------------------------------------------------------------------

VENDORS = {
    "corndog": dict(title="CORN", sub="DOGS", awn="awnRed", acc="yellowPaint",
                    prop="dog"),
    "funnelcake": dict(title="FUNNEL", sub="CAKE", awn="awnYellow", acc="cream",
                       prop="cake"),
    "cotton": dict(title="COTTON", sub="CANDY", awn="awnPink", acc="pink",
                   prop="cotton"),
    "lemonade": dict(title="COLD", sub="LEMONADE", awn="awnYellow", acc="lemon",
                     prop="lemon"),
    "popcorn": dict(title="POP", sub="CORN", awn="awnRed", acc="popcorn",
                    prop="pop"),
    "turkey": dict(title="TURKEY", sub="LEGS", awn="awnOrange", acc="meat",
                   prop="leg"),
    "pizza": dict(title="HOT", sub="PIZZA", awn="awnRed", acc="cheese",
                  prop="pizza"),
}


def _vendor_prop(kind, m):
    if kind == "dog":
        return [((cyl(0, 0, 0, 0.04, 0.32, axis='z', seg=8), m["bread"])),
                ((cyl(0, 0, 0, 0.028, 0.28, axis='z', seg=8), m["meat"]))]
    if kind == "cake":
        return [((cyl(0, 0.02, 0, 0.14, 0.04, axis='y', seg=10, cap=True), m["cream"])),
                ((sphere(0, 0.05, 0, 0.05, seg=6, rings=4, scale=(1.4, 0.4, 1.4)), m["sugar"] if "sugar" in m else m["whitePaint"]))]
    if kind == "cotton":
        return [((cyl(0, -0.08, 0, 0.012, 0.22, axis='y', seg=6), m["wood"])),
                ((sphere(0, 0.08, 0, 0.13, seg=8, rings=6), m["cotton"]))]
    if kind == "lemon":
        return [((cyl(0, 0.08, 0, 0.1, 0.22, axis='y', seg=10, cap=True), m["glass"])),
                ((cyl(0, 0.2, 0, 0.11, 0.04, axis='y', seg=10, cap=True), m["lemon"]))]
    if kind == "pop":
        return [((cyl(0, 0.1, 0, 0.12, 0.22, axis='y', seg=10, cap=True, r_top=0.16), m["paint"])),
                ((sphere(0, 0.28, 0, 0.08, seg=7, rings=5), m["popcorn"]))]
    if kind == "leg":
        return [((cyl(0, 0.05, 0, 0.045, 0.28, axis='y', seg=8, r_top=0.03), m["meat"])),
                ((sphere(0, -0.1, 0, 0.05, seg=6, rings=4), m["cream"]))]
    if kind == "pizza":
        return [((cyl(0, 0.02, 0, 0.16, 0.03, axis='y', seg=10, cap=True), m["bread"])),
                ((cyl(0, 0.04, 0, 0.14, 0.02, axis='y', seg=10, cap=True), m["sauce"])),
                ((cyl(0, 0.055, 0, 0.12, 0.02, axis='y', seg=10, cap=True), m["cheese"]))]
    return []


def build_vendor(key, cfg):
    g = GLB()
    m = carnival_mats(g)
    sign_i = g.add_image(sign_tex(cfg["title"], cfg["sub"]))
    sign_mat = g.material(f"sign_{key}", (1, 1, 1), metal=0, rough=0.55, texture=sign_i)

    # booth 2x2 m-ish, faces +Z (front)
    counter = box(0, 0.55, 0.45, 1.9, 1.1, 0.7)
    body = box(0, 0.85, -0.15, 1.9, 1.7, 1.2)
    shelf = box(0, 0.95, 0.55, 1.8, 0.08, 0.5)
    awning = box(0, 1.85, 0.35, 2.1, 0.08, 1.6)
    awn_front = box(0, 1.7, 1.05, 2.1, 0.28, 0.08)
    posts = [
        cyl(-0.9, 1.2, 0.9, 0.04, 1.4, axis='y', seg=6),
        cyl(0.9, 1.2, 0.9, 0.04, 1.4, axis='y', seg=6),
    ]
    floor = box(0, 0.05, 0, 2.2, 0.1, 2.2)
    # warming tray / pot (steam emitter sits above)
    pot = cyl(0.45, 1.15, 0.55, 0.16, 0.18, axis='y', seg=10, cap=True)
    steam_anchor = sphere(0.45, 1.35, 0.55, 0.04, seg=5, rings=3)

    static = prims([
        (floor, m["wood"]),
        (body, m["wood"]),
        (counter, m["wood"]),
        (shelf, m["cream"]),
        (awning, m[cfg["awn"]]),
        (awn_front, m[cfg["awn"]]),
        *[(p, m["steel"]) for p in posts],
        (pot, m["steel"]),
        (box(0, 1.15, -0.15, 1.7, 0.7, 0.08), m["cream"]),  # back menu board
    ])
    base_n = g.node("base", mesh=g.add_prims(f"vend_{key}", static))

    # sign — spinning
    sign_board = box(0, 0, 0, 0.85, 0.7, 0.06)
    sign_mesh = g.add_prims(f"sign_{key}", prims([(sign_board, sign_mat),
                                                 (box(0, 0, 0, 0.92, 0.76, 0.04), m["gold"])]))
    pole = g.add_prims(f"spole_{key}", prims([(cyl(0, -0.45, 0, 0.03, 0.5, axis='y', seg=6), m["chrome"])]))
    sign_n = g.node("sign", mesh=sign_mesh, extras={"role": "sign"})
    sign_rig = g.node("sign_rig", children=[g.node("sign_pole", mesh=pole), sign_n], t=(0, 2.35, 0.2))

    steam_n = g.node("steam", extras={"role": "steam"}, t=(0.45, 1.38, 0.55))

    # display prop on the counter
    prop_items = _vendor_prop(cfg["prop"], m)
    if prop_items:
        # _vendor_prop returns list of ((mesh), mat) — I double-wrapped. Fix:
        cleaned = []
        for item in prop_items:
            if isinstance(item, tuple) and len(item) == 2:
                mesh, mat = item
                if isinstance(mesh, tuple) and len(mesh) == 4:
                    cleaned.append((mesh, mat))
                elif isinstance(mesh, tuple) and len(mesh) == 1:
                    cleaned.append((mesh[0], mat))
                else:
                    # item is ((mesh,), mat) from extra parens
                    cleaned.append(item if len(item[0]) == 4 else (item[0], item[1]))
        # The comprehension used ((cyl...), m) which is (mesh_tuple, mat). Good.
        props = []
        for i, (msh, mat) in enumerate(prop_items):
            # msh might be the mesh tuple already
            if isinstance(msh, tuple) and len(msh) == 4 and hasattr(msh[0], "shape"):
                props.append((msh, mat))
            else:
                props.append((msh, mat))
        try:
            pm = g.add_prims(f"prop_{key}", prims(props))
            prop_n = g.node("prop", mesh=pm, t=(-0.35, 1.12, 0.55))
        except Exception as e:
            print("prop fail", key, e, prop_items[0] if prop_items else None)
            prop_n = None
    else:
        prop_n = None

    kids = [base_n, sign_rig, steam_n]
    if prop_n is not None:
        kids.append(prop_n)
    g.save(OUT / f"vendor_{key}.glb", kids)


# ---------------------------------------------------------------------------
# Ring booth
# ---------------------------------------------------------------------------

def build_booth():
    g = GLB()
    m = carnival_mats(g)
    sign_i = g.add_image(sign_tex("RING", "TOSS", bg=(70, 22, 28)))
    sign_mat = g.material("sign_ring", (1, 1, 1), metal=0, rough=0.55, texture=sign_i)
    floor = box(0, 0.05, 0, 2.4, 0.1, 2.4)
    body = box(0, 0.9, -0.2, 2.2, 1.8, 1.4)
    counter = box(0, 0.55, 0.7, 2.2, 1.1, 0.55)
    awning = box(0, 1.9, 0.4, 2.4, 0.1, 1.8)
    # prize wall — bottles
    bottles = []
    for i in range(5):
        x = -0.7 + i * 0.35
        bottles.append(cyl(x, 1.35, -0.7, 0.06, 0.28, axis='y', seg=8, cap=True, r_top=0.04))
        bottles.append(sphere(x, 1.52, -0.7, 0.04, seg=6, rings=4))
    static = prims([
        (floor, m["wood"]), (body, m["wood"]), (counter, m["wood"]),
        (awning, m["awnRed"]),
        (box(0, 1.15, 0.95, 2.0, 0.7, 0.06), m["cream"]),
        *[(b, m["gold"] if i % 2 else m["paint"]) for i, b in enumerate(bottles)],
    ])
    base = g.node("base", mesh=g.add_prims("booth", static))
    sign_mesh = g.add_prims("rsign", prims([(box(0, 0, 0, 0.9, 0.7, 0.06), sign_mat)]))
    sign = g.node("sign", mesh=sign_mesh, t=(0, 2.4, 0.2), extras={"role": "sign"})
    g.save(OUT / "booth_ring.glb", [base, sign])


# ---------------------------------------------------------------------------
# Path tile
# ---------------------------------------------------------------------------

def path_tex(size=256):
    img = Image.new("RGB", (size, size), (62, 58, 54))
    px = img.load()
    rng = np.random.default_rng(21)
    for y in range(size):
        for x in range(size):
            n = float(rng.normal(0, 6))
            # worn center
            cx, cy = x - size / 2, y - size / 2
            d = math.sqrt(cx * cx + cy * cy) / (size * 0.5)
            wear = max(0, 1 - d) * 22
            r = 62 + n + wear
            g = 58 + n * 0.8 + wear * 0.7
            b = 54 + n * 0.6 + wear * 0.4
            # faint edge
            if min(x, y, size - 1 - x, size - 1 - y) < 6:
                r, g, b = r * 0.7, g * 0.7, b * 0.7
            px[x, y] = (int(max(0, min(255, r))), int(max(0, min(255, g))), int(max(0, min(255, b))))
    return img


def build_path():
    g = GLB()
    tex = g.add_image(path_tex())
    mat = g.material("path", (1, 1, 1), metal=0, rough=0.92, texture=tex)
    edge = g.material("pathEdge", (0.25, 0.2, 0.16), metal=0, rough=0.8)
    tile = box(0, 0.04, 0, 1.98, 0.08, 1.98)
    curb = box(0, 0.015, 0, 2.0, 0.03, 2.0)
    n = g.node("tile", mesh=g.add_prims("path", prims([(curb, edge), (tile, mat)])))
    g.save(OUT / "path_tile.glb", [n])


# ---------------------------------------------------------------------------
# Painted icons for the build tray
# ---------------------------------------------------------------------------

def _grad(d, box, c0, c1):
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0)
        col = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
        d.line([(x0, y), (x1, y)], fill=col)


def paint_icon(name, painter, bg=(36, 20, 24)):
    s = 256
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # rounded card bg
    d.rounded_rectangle([8, 8, s - 8, s - 8], 28, fill=bg)
    _grad(d, (16, 16, s - 16, 110), (bg[0] + 30, bg[1] + 12, bg[2] + 8), bg)
    painter(d, s)
    # vignette
    img = img.filter(ImageFilter.SMOOTH_MORE)
    img.save(ICON / f"{name}.png")
    print("icon", name)


def icons():
    gold, cream, red, teal = (220, 180, 80), (240, 220, 180), (180, 40, 40), (30, 90, 100)

    def ferris(d, s):
        cx, cy, R = s // 2, 148, 78
        d.ellipse([cx - R, cy - R - 10, cx + R, cy + R - 10], outline=red, width=10)
        d.ellipse([cx - 16, cy - 16 - 10, cx + 16, cy + 16 - 10], fill=gold)
        for i in range(8):
            a = i / 8 * math.tau
            d.line([cx, cy - 10, cx + math.cos(a) * R, cy - 10 + math.sin(a) * R], fill=gold, width=3)
            gx = cx + math.cos(a) * (R - 4)
            gy = cy - 10 + math.sin(a) * (R - 4)
            d.rounded_rectangle([gx - 10, gy, gx + 10, gy + 16], 4, fill=red)
        d.polygon([(cx - 8, cy + R - 10), (cx + 8, cy + R - 10), (cx + 28, s - 24), (cx - 28, s - 24)], fill=(80, 70, 60))

    def loop(d, s):
        cx, cy, R = s // 2, 130, 80
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(240, 200, 50), width=12)
        d.ellipse([cx - R + 16, cy - R + 16, cx + R - 16, cy + R - 16], outline=(50, 80, 160), width=4)
        # car at lower right
        a = 0.4
        x, y = cx + math.cos(a) * R, cy + math.sin(a) * R
        d.rounded_rectangle([x - 16, y - 10, x + 16, y + 10], 4, fill=red)
        d.rectangle([cx - 70, s - 40, cx + 70, s - 22], fill=(50, 50, 60))

    def carousel(d, s):
        cx = s // 2
        d.polygon([(cx, 36), (40, 110), (s - 40, 110)], fill=red)
        d.polygon([(cx, 44), (70, 110), (s - 70, 110)], fill=(200, 60, 60))
        d.ellipse([60, 100, s - 60, 160], fill=gold)
        for x in (80, 128, 176):
            d.rectangle([x - 3, 120, x + 3, 200], fill=(200, 180, 80))
            d.ellipse([x - 16, 175, x + 16, 215], fill=(240, 240, 230))
        d.ellipse([50, 200, s - 50, 236], fill=(140, 40, 40))

    def tilt(d, s):
        d.ellipse([40, 80, s - 40, 220], fill=teal)
        d.ellipse([70, 110, s - 70, 190], fill=(20, 70, 80))
        for i, (x, y) in enumerate([(90, 130), (160, 120), (170, 175), (80, 175)]):
            d.ellipse([x, y, x + 36, y + 28], fill=red if i % 2 == 0 else gold)

    def bumper(d, s):
        d.rounded_rectangle([36, 70, s - 36, 220], 20, outline=(40, 80, 160), width=10, fill=(30, 50, 90))
        d.ellipse([70, 110, 130, 165], fill=red)
        d.ellipse([140, 130, 200, 185], fill=gold)
        d.ellipse([90, 160, 150, 210], fill=(40, 140, 80))

    def booth(title, color, accent, extra=None):
        def p(d, s):
            d.rectangle([50, 120, s - 50, 210], fill=(90, 60, 40))
            d.polygon([(40, 120), (s - 40, 120), (s - 28, 70), (28, 70)], fill=color)
            d.rectangle([70, 140, s - 70, 190], fill=accent)
            if extra:
                extra(d, s)
        return p

    def rings(d, s):
        booth("RING", red, cream)(d, s)
        for i, x in enumerate((90, 128, 166)):
            d.ellipse([x, 145, x + 28, 173], outline=gold, width=4)

    def path(d, s):
        d.rounded_rectangle([48, 48, s - 48, s - 48], 12, fill=(70, 66, 62))
        d.rectangle([110, 48, 146, s - 48], fill=(90, 84, 78))
        d.rectangle([48, 110, s - 48, 146], fill=(90, 84, 78))

    def food_extra(kind):
        def ex(d, s):
            if kind == "dog":
                d.rounded_rectangle([110, 148, 150, 200], 6, fill=(180, 120, 50))
            elif kind == "cake":
                d.ellipse([100, 150, 156, 195], fill=cream)
            elif kind == "cotton":
                d.ellipse([100, 140, 156, 196], fill=(255, 160, 200))
                d.rectangle([124, 190, 132, 210], fill=(180, 140, 80))
            elif kind == "lemon":
                d.ellipse([108, 150, 148, 200], fill=(80, 180, 220))
                d.ellipse([112, 148, 152, 175], fill=(240, 210, 60))
            elif kind == "pop":
                d.polygon([(100, 200), (156, 200), (148, 150), (108, 150)], fill=red)
                d.ellipse([110, 130, 146, 166], fill=cream)
            elif kind == "leg":
                d.polygon([(120, 200), (140, 200),  (150, 150), (110, 150)], fill=(140, 70, 40))
            elif kind == "pizza":
                d.pieslice([96, 145, 160, 210], 200, 340, fill=(220, 170, 70))
        return ex

    paint_icon("ferris", ferris, (48, 18, 22))
    paint_icon("superloop", loop, (20, 24, 48))
    paint_icon("carousel", carousel, (48, 22, 28))
    paint_icon("tilt", tilt, (16, 36, 40))
    paint_icon("bumper", bumper, (16, 24, 48))
    paint_icon("ringtoss", rings, (48, 18, 22))
    paint_icon("path", path, (32, 28, 26))
    paint_icon("corndog", booth("CORN", red, cream, food_extra("dog")), (48, 24, 16))
    paint_icon("funnelcake", booth("CAKE", (200, 160, 40), cream, food_extra("cake")), (48, 32, 16))
    paint_icon("cotton", booth("CANDY", (200, 80, 130), (255, 200, 220), food_extra("cotton")), (48, 20, 32))
    paint_icon("lemonade", booth("LEMON", (220, 190, 50), (180, 230, 240), food_extra("lemon")), (40, 36, 16))
    paint_icon("popcorn", booth("POP", red, cream, food_extra("pop")), (48, 20, 18))
    paint_icon("turkey", booth("TURKEY", (200, 90, 30), (160, 80, 40), food_extra("leg")), (48, 24, 16))
    paint_icon("pizza", booth("PIZZA", red, (220, 80, 40), food_extra("pizza")), (48, 20, 16))

    # coin bubble
    s = 128
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([8, 8, s - 8, s - 8], fill=(230, 180, 50), outline=(255, 230, 140), width=6)
    d.ellipse([28, 22, 70, 60], fill=(255, 230, 150))
    d.text((s // 2 - 10, s // 2 - 16), "$", fill=(120, 70, 10))
    img.save(ICON / "coin.png")
    print("icon coin")


def main():
    print("Building rides…")
    build_ferris()
    build_superloop()
    build_carousel()
    build_tilt()
    build_bumper()
    build_booth()
    build_path()
    for k, cfg in VENDORS.items():
        build_vendor(k, cfg)
    icons()
    print("done")


if __name__ == "__main__":
    main()
