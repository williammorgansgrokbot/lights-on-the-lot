#!/usr/bin/env python3
"""Author a detailed Tilt-A-Whirl, balloon bouquet, and bunting stand (PBR, named parts)."""
from __future__ import annotations
import math
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_vehicles import GLB, box, cyl, sphere, torus_arc, merge, make_mats, wood_tex, paint_tex

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/models"
OUT.mkdir(parents=True, exist_ok=True)


def striped_deck(size=512):
    img = Image.new("RGB", (size, size), (200, 40, 48))
    px = img.load()
    rng = np.random.default_rng(9)
    for y in range(size):
        for x in range(size):
            # polar wedges
            dx = x / size - 0.5
            dy = y / size - 0.5
            a = math.atan2(dy, dx)
            r = math.hypot(dx, dy)
            wedge = int(((a + math.pi) / (math.pi / 6))) % 2
            n = float(rng.normal(0, 4))
            if r > 0.48:
                col = (40, 40, 45)
            elif wedge:
                col = (200 + n, 38, 42)
            else:
                col = (230 + n, 220, 195)
            # worn center
            if r < 0.08:
                col = (50, 50, 55)
            px[x, y] = tuple(int(max(0, min(255, c))) for c in col)
    return img


def build_tilt():
    g = GLB()
    wood_i = g.add_image(wood_tex(256))
    paint_i = g.add_image(paint_tex(256))
    deck_i = g.add_image(striped_deck(512))
    mats = make_mats(g, wood=wood_i, paint=paint_i)
    mats["deck"] = g.material("deck", (1, 1, 1), metal=0.05, rough=0.42, clearcoat=0.35, texture=deck_i)
    mats["teal"] = g.material("teal", (0.08, 0.32, 0.38), metal=0.25, rough=0.3, clearcoat=0.7)
    mats["yellow"] = g.material("yellow", (0.92, 0.72, 0.12), metal=0.2, rough=0.32, clearcoat=0.6)
    mats["blue"] = g.material("blue", (0.12, 0.28, 0.62), metal=0.2, rough=0.3, clearcoat=0.65)
    mats["creamP"] = g.material("creamP", (0.9, 0.84, 0.7), metal=0.05, rough=0.4, clearcoat=0.4)
    mats["bulbW"] = g.material("bulbW", (1, 0.95, 0.75), metal=0.0, rough=0.18, emissive=(1, 0.92, 0.65), emi=1)
    mats["bulbR"] = g.material("bulbR", (1, 0.25, 0.15), metal=0.0, rough=0.2, emissive=(1, 0.2, 0.08), emi=1)
    mats["bulbA"] = g.material("bulbA", (1, 0.7, 0.15), metal=0.0, rough=0.2, emissive=(1, 0.55, 0.08), emi=1)
    mats["seat"] = g.material("seat", (0.12, 0.1, 0.1), metal=0.0, rough=0.65)
    mats["pad"] = g.material("pad", (0.15, 0.15, 0.16), metal=0.0, rough=0.7)

    children = []
    # ground skirt / concrete ring
    skirt = merge([
        cyl(0, 0.08, 0, 2.95, 0.16, axis='y', seg=48),
        cyl(0, 0.18, 0, 2.82, 0.08, axis='y', seg=48, r_top=2.70),
    ])
    mid = g.add_prims("skirt", [(*skirt, mats["steelDark"])])
    children.append(g.node("skirt", mesh=mid, t=[0, 0, 0]))

    # spinning platform
    plat_prims = [
        (*cyl(0, 0.28, 0, 2.62, 0.16, axis='y', seg=48), mats["deck"]),
        (*cyl(0, 0.38, 0, 2.62, 0.06, axis='y', seg=48, r_top=2.55), mats["chrome"]),
        (*torus_arc(0, 0.34, 0, 2.58, 0.07, 0, math.tau, seg=48, tube=8, rx=math.pi/2), mats["chrome"]),
    ]
    # scalloped valance under rim
    valances = []
    for i in range(24):
        a = i * math.tau / 24
        x, z = math.cos(a) * 2.55, math.sin(a) * 2.55
        valances.append(box(x, 0.16, z, 0.22, 0.22, 0.08, ry=-a))
    plat_prims.append((*merge(valances), mats["yellow"]))
    plat_mesh = g.add_prims("platform_mesh", plat_prims)

    # center pylon
    pylon = merge([
        cyl(0, 0.7, 0, 0.42, 0.7, axis='y', seg=20),
        cyl(0, 1.15, 0, 0.48, 0.16, axis='y', seg=16),
        cyl(0, 1.55, 0, 0.22, 0.7, axis='y', seg=16),
        sphere(0, 2.05, 0, 0.28, seg=14, rings=10),
        cyl(0, 2.32, 0, 0.12, 0.22, axis='y', seg=10),
        sphere(0, 2.48, 0, 0.1, seg=10, rings=8),
    ])
    pylon_m = g.add_prims("pylon", [
        (*pylon, mats["chrome"]),
        (*merge([
            cyl(0, 1.15, 0, 0.50, 0.05, axis='y', seg=16),
            torus_arc(0, 1.55, 0, 0.28, 0.04, 0, math.tau, seg=20, tube=8, rx=math.pi/2),
        ]), mats["gold"]),
    ])
    pylon_n = g.node("pylon", mesh=pylon_m)

    # crown bulbs on pylon
    crown_bulbs = []
    for i in range(8):
        a = i * math.tau / 8
        x, z = math.cos(a) * 0.38, math.sin(a) * 0.38
        mesh = g.add_prims(f"crown_bulb_{i+1}", [(*sphere(0, 0, 0, 0.05, seg=8, rings=6), mats["bulbA" if i % 2 else "bulbW"])])
        crown_bulbs.append(g.node(f"bulb_crown_{i+1}", mesh=mesh, t=[x, 2.05, z]))

    # rim bulbs
    rim_bulbs = []
    for i in range(32):
        a = i * math.tau / 32
        x, z = math.cos(a) * 2.62, math.sin(a) * 2.62
        mat = [mats["bulbW"], mats["bulbR"], mats["bulbA"]][i % 3]
        mesh = g.add_prims(f"rim_bulb_{i+1}", [(*sphere(0, 0, 0, 0.045, seg=7, rings=5), mat)])
        rim_bulbs.append(g.node(f"bulb_{i+1}", mesh=mesh, t=[x, 0.46, z]))

    car_colors = ["paint", "teal", "yellow", "blue", "creamP", "paint", "teal"]
    car_nodes = []
    arms = []
    R = 1.85
    for i in range(7):
        a = i * math.tau / 7
        cx, cz = math.cos(a) * R, math.sin(a) * R
        # arm from center to car
        arm = merge([
            box(0, 0, 0, 0.16, 0.10, R * 0.72),
            cyl(0, 0, 0, 0.11, 0.16, axis='y', seg=10),
        ])
        arm_m = g.add_prims(f"arm_{i+1}", [(*arm, mats["steel"])])
        # arm local: extend along +Z, then rotate
        # We'll put arm as child of platform, rotated, car at end
        # Car geometry in local space: tub along Z forward
        cmat = mats[car_colors[i]]
        tub = merge([
            # floor
            cyl(0, 0.06, 0, 0.62, 0.08, axis='y', seg=16),
            # rounded wall (outer ring)
            torus_arc(0, 0.22, 0, 0.58, 0.08, 0, math.tau, seg=20, tube=8, rx=math.pi/2),
            cyl(0, 0.28, 0, 0.64, 0.28, axis='y', seg=18, cap=False),
            # inner wall lip
            cyl(0, 0.42, 0, 0.64, 0.06, axis='y', seg=18, r_top=0.58),
        ])
        bumper = torus_arc(0, 0.18, 0, 0.66, 0.09, 0, math.tau, seg=20, tube=10, rx=math.pi/2)
        seat = merge([
            box(0, 0.26, -0.08, 0.70, 0.10, 0.32),
            box(0, 0.42, -0.22, 0.70, 0.28, 0.08),  # back
        ])
        bar = merge([
            cyl(0, 0.52, 0.16, 0.025, 0.55, axis='x', seg=8),
            cyl(-0.26, 0.40, 0.16, 0.02, 0.26, axis='y', seg=6),
            cyl(0.26, 0.40, 0.16, 0.02, 0.26, axis='y', seg=6),
        ])
        floorpad = cyl(0, 0.11, 0.05, 0.42, 0.03, axis='y', seg=12)
        # headlights / lights on car
        lights = merge([
            sphere(-0.22, 0.30, 0.58, 0.04, seg=7, rings=5),
            sphere(0.22, 0.30, 0.58, 0.04, seg=7, rings=5),
        ])
        car_m = g.add_prims(f"car_{i+1}_mesh", [
            (*tub, cmat),
            (*bumper, mats["pad"]),
            (*seat, mats["seat"]),
            (*bar, mats["chrome"]),
            (*floorpad, mats["rubber"]),
            (*lights, mats["bulbA"]),
        ])
        car_n = g.node(f"car_{i+1}", mesh=car_m, t=[0, 0.34, R], extras={"role": "car"})
        # pivot housing at arm end
        house = g.add_prims(f"house_{i+1}", [(*cyl(0, 0.28, R, 0.16, 0.2, axis='y', seg=12), mats["steelDark"])])
        house_n = g.node(f"house_{i+1}", mesh=house)
        # arm mesh centered halfway
        arm_n = g.node(f"armmesh_{i+1}", mesh=arm_m, t=[0, 0.22, R * 0.36], r=None)
        # group rotated around Y
        # rotation quaternion around Y by angle a
        q = [0, math.sin(a / 2), 0, math.cos(a / 2)]
        grp = g.node(f"arm_{i+1}", children=[arm_n, house_n, car_n], r=q)
        car_nodes.append(car_n)
        arms.append(grp)

    plat = g.node("platform", mesh=plat_mesh, children=[pylon_n] + crown_bulbs + rim_bulbs + arms, extras={"role": "platform"})
    children.append(plat)
    g.save(OUT / "ride_tilt.glb", children)


def build_balloons():
    g = GLB()
    colors = [
        ((0.86, 0.12, 0.16), (0.9, 0.1, 0.1)),
        ((0.95, 0.82, 0.12), (0.9, 0.7, 0.05)),
        ((0.12, 0.28, 0.75), (0.1, 0.2, 0.8)),
        ((0.95, 0.45, 0.7), (0.9, 0.3, 0.6)),
        ((0.15, 0.6, 0.28), (0.1, 0.5, 0.2)),
        ((0.95, 0.95, 0.95), (0.8, 0.8, 0.85)),
        ((0.85, 0.45, 0.1), (0.8, 0.35, 0.05)),
        ((0.55, 0.2, 0.7), (0.5, 0.1, 0.65)),
    ]
    mats = []
    for i, (col, em) in enumerate(colors):
        mats.append(g.material(f"balloon_{i}", col, metal=0.05, rough=0.22, clearcoat=0.95, cc_rough=0.08,
                               emissive=(em[0]*0.15, em[1]*0.15, em[2]*0.15), emi=1))
    string_m = g.material("string", (0.85, 0.85, 0.82), metal=0.0, rough=0.5)
    weight_m = g.material("weight", (0.15, 0.12, 0.1), metal=0.0, rough=0.7)
    gold = g.material("goldTie", (0.8, 0.65, 0.2), metal=1.0, rough=0.3)

    # weight bag
    bag = merge([
        box(0, 0.12, 0, 0.22, 0.24, 0.16),
        cyl(0, 0.26, 0, 0.06, 0.06, axis='y', seg=8),
    ])
    bag_n = g.node("weight", mesh=g.add_prims("weight", [(*bag, weight_m), (*cyl(0, 0.30, 0, 0.04, 0.04, axis='y', seg=8), gold)]))

    # balloon positions around a bunch
    rng = np.random.default_rng(2)
    nodes = [bag_n]
    for i, mat in enumerate(mats):
        ang = i * math.tau / len(mats) + 0.15
        rad = 0.18 + (i % 3) * 0.06
        x = math.cos(ang) * rad
        z = math.sin(ang) * rad * 0.85
        y = 1.05 + 0.18 * (i % 4) + float(rng.normal(0, 0.03))
        # teardrop balloon
        ball = merge([
            sphere(0, 0.18, 0, 0.20, seg=14, rings=10, scale=(1.0, 1.15, 1.0)),
            sphere(0, 0.02, 0, 0.05, seg=8, rings=6, scale=(0.7, 1.0, 0.7)),  # nipple
        ])
        tie = cyl(0, -0.02, 0, 0.015, 0.04, axis='y', seg=6)
        # string from weight (0,0.3,0) to balloon base — approximate with long thin cyl in balloon local space later
        # we'll put a long cyl from local (0,-y+0.3,0) up to nipple
        length = y - 0.30
        string = cyl(0, -length / 2 - 0.02, 0, 0.004, length, axis='y', seg=5)
        mesh = g.add_prims(f"balloon_{i+1}", [(*ball, mat), (*tie, gold), (*string, string_m)])
        nodes.append(g.node(f"balloon_{i+1}", mesh=mesh, t=[x, y, z]))
    g.save(OUT / "prop_balloons.glb", nodes)


def build_bunting():
    """Two poles, 3.2 m apart, with a cloth pennant string between them (on stands, not spanning the lot)."""
    g = GLB()
    wood_i = g.add_image(wood_tex(128))
    # bunting texture
    bun_path = ROOT / "assets/textures/bunting.png"
    bun_i = g.add_image(Image.open(bun_path).convert("RGBA")) if bun_path.exists() else None
    mats = {
        "wood": g.material("wood", (0.45, 0.28, 0.14), metal=0.0, rough=0.75, texture=wood_i),
        "steel": g.material("steel", (0.5, 0.5, 0.52), metal=0.85, rough=0.35),
        "rope": g.material("rope", (0.35, 0.25, 0.15), metal=0.0, rough=0.8),
        "flags": g.material("flags", (1, 1, 1), metal=0.0, rough=0.55, texture=bun_i, double=True, alpha=1.0),
    }
    span = 3.2
    pole_h = 2.6
    poles = []
    for side, x in (("L", -span / 2), ("R", span / 2)):
        pole = merge([
            cyl(0, pole_h / 2, 0, 0.045, pole_h, axis='y', seg=10),
            cyl(0, 0.04, 0, 0.16, 0.08, axis='y', seg=10),
            sphere(0, pole_h, 0, 0.06, seg=8, rings=6),
        ])
        mid = g.add_prims(f"pole_{side}", [(*pole, mats["wood"]), (*cyl(0, 0.04, 0, 0.16, 0.08, axis='y', seg=10), mats["steel"])])
        poles.append(g.node(f"pole_{side}", mesh=mid, t=[x, 0, 0]))
    # slightly sagging flag plane
    # a thin box / two-sided plane 3.1 x 0.7
    flag = box(0, 0, 0, span - 0.15, 0.62, 0.02)
    flag_m = g.add_prims("flags", [(*flag, mats["flags"])])
    flag_n = g.node("flags", mesh=flag_m, t=[0, pole_h - 0.45, 0])
    rope = cyl(0, 0, 0, 0.012, span, axis='x', seg=6)
    rope_n = g.node("rope", mesh=g.add_prims("rope", [(*rope, mats["rope"])]), t=[0, pole_h - 0.08, 0])
    g.save(OUT / "prop_bunting.glb", poles + [flag_n, rope_n])


if __name__ == "__main__":
    build_tilt()
    build_balloons()
    build_bunting()
