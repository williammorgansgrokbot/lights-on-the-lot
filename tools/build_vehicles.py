#!/usr/bin/env python3
"""Build mid-poly PBR truck + carnival-trailer GLBs for Lights on the Lot.

Original models created for this game, styled after the painted Freightliner-style
hauler and the ornate Ferris-wheel equipment trailer. Faces +Z, Y-up, meters,
origin on the ground at the vehicle plan-center.
"""
from __future__ import annotations

import json
import math
import struct
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

OUT = Path("/workspace/lights-on-the-lot/assets/models")
OUT.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Mesh utilities
# ---------------------------------------------------------------------------

def _n(v):
    v = np.asarray(v, dtype=np.float32)
    l = np.linalg.norm(v)
    return v / l if l > 1e-8 else v


def box(cx, cy, cz, sx, sy, sz, rx=0, ry=0, rz=0):
    """Centered box. Returns positions (N,3), normals, uvs, indices."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    # 24 verts (unique normals per face)
    faces = [
        # +Z, -Z, +X, -X, +Y, -Y
        ([( -hx,-hy, hz),( hx,-hy, hz),( hx, hy, hz),( -hx, hy, hz)], (0, 0, 1)),
        ([( hx,-hy,-hz),(-hx,-hy,-hz),(-hx, hy,-hz),( hx, hy,-hz)], (0, 0,-1)),
        ([( hx,-hy, hz),( hx,-hy,-hz),( hx, hy,-hz),( hx, hy, hz)], (1, 0, 0)),
        ([(-hx,-hy,-hz),(-hx,-hy, hz),(-hx, hy, hz),(-hx, hy,-hz)], (-1, 0, 0)),
        ([(-hx, hy, hz),( hx, hy, hz),( hx, hy,-hz),(-hx, hy,-hz)], (0, 1, 0)),
        ([(-hx,-hy,-hz),( hx,-hy,-hz),( hx,-hy, hz),(-hx,-hy, hz)], (0,-1, 0)),
    ]
    pos, nrm, uv, idx = [], [], [], []
    for verts, n in faces:
        b = len(pos)
        for i, (x, y, z) in enumerate(verts):
            pos.append((x, y, z))
            nrm.append(n)
            uvs = [(0, 0), (1, 0), (1, 1), (0, 1)][i]
            # scale uvs a bit by face size
            uv.append(uvs)
        idx.extend([b, b + 1, b + 2, b, b + 2, b + 3])
    p = np.array(pos, np.float32)
    n = np.array(nrm, np.float32)
    u = np.array(uv, np.float32)
    p, n = _rotate(p, n, rx, ry, rz)
    p += np.array([cx, cy, cz], np.float32)
    return p, n, u, np.array(idx, np.uint32)


def _rotate(p, n, rx, ry, rz):
    def R(axis, a):
        c, s = math.cos(a), math.sin(a)
        if axis == 'x':
            m = np.array([[1, 0, 0], [0, c, -s], [0, s, c]], np.float32)
        elif axis == 'y':
            m = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], np.float32)
        else:
            m = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], np.float32)
        return m
    M = np.eye(3, dtype=np.float32)
    if rx: M = R('x', rx) @ M
    if ry: M = R('y', ry) @ M
    if rz: M = R('z', rz) @ M
    return p @ M.T, n @ M.T


def cyl(cx, cy, cz, radius, height, axis='y', seg=14, rx=0, ry=0, rz=0, cap=True, r_top=None):
    r_top = radius if r_top is None else r_top
    # build along Y then rotate so axis matches
    pos, nrm, uv, idx = [], [], [], []
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        c0, s0 = math.cos(a0), math.sin(a0)
        c1, s1 = math.cos(a1), math.sin(a1)
        y0, y1 = -height / 2, height / 2
        # side (two tris)
        b = len(pos)
        n0, n1 = _n((c0, 0, s0)), _n((c1, 0, s1))
        pos += [(c0 * radius, y0, s0 * radius), (c1 * radius, y0, s1 * radius),
                (c1 * r_top, y1, s1 * r_top), (c0 * r_top, y1, s0 * r_top)]
        nrm += [n0, n1, n1, n0]
        uv += [(i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, 1), (i / seg, 1)]
        idx += [b, b + 1, b + 2, b, b + 2, b + 3]
        if cap:
            # bottom
            b = len(pos)
            pos += [(0, y0, 0), (c1 * radius, y0, s1 * radius), (c0 * radius, y0, s0 * radius)]
            nrm += [(0, -1, 0)] * 3
            uv += [(0.5, 0.5), (0.5 + c1 * 0.5, 0.5 + s1 * 0.5), (0.5 + c0 * 0.5, 0.5 + s0 * 0.5)]
            idx += [b, b + 1, b + 2]
            # top
            b = len(pos)
            pos += [(0, y1, 0), (c0 * r_top, y1, s0 * r_top), (c1 * r_top, y1, s1 * r_top)]
            nrm += [(0, 1, 0)] * 3
            uv += [(0.5, 0.5), (0.5 + c0 * 0.5, 0.5 + s0 * 0.5), (0.5 + c1 * 0.5, 0.5 + s1 * 0.5)]
            idx += [b, b + 1, b + 2]
    p = np.array(pos, np.float32)
    n = np.array(nrm, np.float32)
    u = np.array(uv, np.float32)
    # default along Y; map to requested axis
    if axis == 'x':
        p, n = _rotate(p, n, 0, 0, -math.pi / 2)
    elif axis == 'z':
        p, n = _rotate(p, n, math.pi / 2, 0, 0)
    p, n = _rotate(p, n, rx, ry, rz)
    p += np.array([cx, cy, cz], np.float32)
    return p, n, u, np.array(idx, np.uint32)


def sphere(cx, cy, cz, r, seg=12, rings=8, hemi=False, scale=(1, 1, 1)):
    pos, nrm, uv, idx = [], [], [], []
    stacks = rings
    slices = seg
    vrows = []
    for i in range(stacks + 1):
        v = i / stacks
        phi = (v * (math.pi / 2 if hemi else math.pi)) - (0 if hemi else 0)
        if not hemi:
            phi = v * math.pi  # 0..pi from top
        else:
            phi = v * (math.pi / 2)  # 0..pi/2 from top? wait we want dome: 0 at top to pi/2 at equator
        y = r * math.cos(phi) if not hemi else r * math.cos(phi)
        rr = r * math.sin(phi)
        row = []
        for j in range(slices + 1):
            t = j / slices
            a = t * 2 * math.pi
            x, z = rr * math.cos(a), rr * math.sin(a)
            row.append((x, y if not hemi else y, z, t, v))
        vrows.append(row)
    for i in range(stacks):
        for j in range(slices):
            a = vrows[i][j]
            b = vrows[i][j + 1]
            c = vrows[i + 1][j + 1]
            d = vrows[i + 1][j]
            base = len(pos)
            for v in (a, b, c, d):
                x, y, z, uu, vv = v
                pos.append((x, y, z))
                nrm.append(_n((x / scale[0], y / scale[1], z / scale[2])))
                uv.append((uu, vv))
            idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    p = np.array(pos, np.float32) * np.array(scale, np.float32)
    n = np.array(nrm, np.float32)
    u = np.array(uv, np.float32)
    p += np.array([cx, cy, cz], np.float32)
    return p, n, u, np.array(idx, np.uint32)


def torus_arc(cx, cy, cz, R, r, a0, a1, seg=20, tube=8, rx=0, ry=0, rz=0):
    pos, nrm, uv, idx = [], [], [], []
    for i in range(seg):
        t0 = a0 + (a1 - a0) * i / seg
        t1 = a0 + (a1 - a0) * (i + 1) / seg
        for j in range(tube):
            u0 = 2 * math.pi * j / tube
            u1 = 2 * math.pi * (j + 1) / tube

            def pt(th, ph):
                cth, sth = math.cos(th), math.sin(th)
                cph, sph = math.cos(ph), math.sin(ph)
                # torus in XY (vertical arc) — we'll rotate
                x = (R + r * cph) * cth
                y = (R + r * cph) * sth
                z = r * sph
                nx, ny, nz = cph * cth, cph * sth, sph
                return x, y, z, nx, ny, nz

            p00 = pt(t0, u0); p10 = pt(t1, u0); p11 = pt(t1, u1); p01 = pt(t0, u1)
            b = len(pos)
            for p in (p00, p10, p11, p01):
                pos.append(p[:3]); nrm.append(p[3:]); uv.append((0, 0))
            idx += [b, b + 1, b + 2, b, b + 2, b + 3]
    p = np.array(pos, np.float32)
    n = np.array(nrm, np.float32)
    u = np.array(uv, np.float32)
    p, n = _rotate(p, n, rx, ry, rz)
    p += np.array([cx, cy, cz], np.float32)
    return p, n, u, np.array(idx, np.uint32)


def merge(meshes):
    ps, ns, us, ix = [], [], [], []
    base = 0
    for p, n, u, i in meshes:
        ps.append(p); ns.append(n); us.append(u)
        ix.append(i + base)
        base += len(p)
    return np.concatenate(ps), np.concatenate(ns), np.concatenate(us), np.concatenate(ix)


# ---------------------------------------------------------------------------
# GLB writer
# ---------------------------------------------------------------------------

class GLB:
    def __init__(self):
        self.materials = []
        self.mat_i = {}
        self.nodes = []
        self.meshes = []
        self.accessors = []
        self.views = []
        self.images = []
        self.textures = []
        self.bin = bytearray()
        self.extensions_used = set()

    def _pad(self, n=4):
        while len(self.bin) % n:
            self.bin.append(0)

    def _view(self, data: bytes, target=None):
        self._pad(4)
        off = len(self.bin)
        self.bin.extend(data)
        self._pad(4)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target is not None:
            v["target"] = target
        self.views.append(v)
        return len(self.views) - 1

    def _accessor(self, arr, typ, component, target=None, normalized=False):
        arr = np.ascontiguousarray(arr)
        view = self._view(arr.tobytes(), target)
        a = {
            "bufferView": view,
            "componentType": component,
            "count": int(arr.shape[0]),
            "type": typ,
        }
        if normalized:
            a["normalized"] = True
        if typ in ("VEC2", "VEC3", "VEC4") or typ == "SCALAR":
            flat = arr.reshape(arr.shape[0], -1)
            a["min"] = [float(x) for x in flat.min(axis=0)]
            a["max"] = [float(x) for x in flat.max(axis=0)]
        self.accessors.append(a)
        return len(self.accessors) - 1

    def add_image(self, img: Image.Image):
        import io
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
        view = self._view(data, None)
        self.images.append({"bufferView": view, "mimeType": "image/png"})
        self.textures.append({"source": len(self.images) - 1})
        return len(self.textures) - 1

    def material(self, name, color, metal=0.0, rough=0.5, emissive=(0, 0, 0),
                 emi=0.0, clearcoat=0.0, cc_rough=0.15, texture=None, double=False, alpha=1.0):
        key = (name, tuple(color), metal, rough, tuple(emissive), emi, clearcoat, texture, alpha)
        if key in self.mat_i:
            return self.mat_i[key]
        pbr = {
            "baseColorFactor": [float(color[0]), float(color[1]), float(color[2]), float(alpha)],
            "metallicFactor": float(metal),
            "roughnessFactor": float(rough),
        }
        if texture is not None:
            pbr["baseColorTexture"] = {"index": texture}
        mat = {"name": name, "pbrMetallicRoughness": pbr}
        if any(emissive) or emi:
            mat["emissiveFactor"] = [float(c) * (1 if emi == 0 else 1) for c in emissive]
            if emi:
                mat["emissiveFactor"] = [min(1.0, float(c)) for c in emissive]
                # keep a usable base emissive; intensity animated in-engine
        if clearcoat > 0:
            self.extensions_used.add("KHR_materials_clearcoat")
            mat["extensions"] = {"KHR_materials_clearcoat": {
                "clearcoatFactor": float(clearcoat),
                "clearcoatRoughnessFactor": float(cc_rough),
            }}
        if alpha < 1:
            mat["alphaMode"] = "BLEND"
        if double:
            mat["doubleSided"] = True
        self.mat_i[key] = len(self.materials)
        self.materials.append(mat)
        return self.mat_i[key]

    def add_prims(self, name, prims):
        """prims: list of (p,n,u,idx,mat_index)"""
        primitives = []
        for p, n, u, idx, mat in prims:
            primitives.append({
                "attributes": {
                    "POSITION": self._accessor(p.astype(np.float32), "VEC3", 5126, 34962),
                    "NORMAL": self._accessor(n.astype(np.float32), "VEC3", 5126, 34962),
                    "TEXCOORD_0": self._accessor(u.astype(np.float32), "VEC2", 5126, 34962),
                },
                "indices": self._accessor(idx.astype(np.uint32), "SCALAR", 5125, 34963),
                "material": int(mat),
            })
        self.meshes.append({"name": name, "primitives": primitives})
        return len(self.meshes) - 1

    def node(self, name, mesh=None, children=None, t=None, r=None, extras=None):
        n = {"name": name}
        if mesh is not None:
            n["mesh"] = mesh
        if children:
            n["children"] = children
        if t is not None:
            n["translation"] = [float(x) for x in t]
        if r is not None:
            n["rotation"] = [float(x) for x in r]  # xyzw
        if extras:
            n["extras"] = extras
        self.nodes.append(n)
        return len(self.nodes) - 1

    def save(self, path: Path, root_children):
        # scene root
        root = self.node("Root", children=root_children)
        doc = {
            "asset": {"version": "2.0", "generator": "lights-on-the-lot/build_vehicles.py"},
            "buffers": [{"byteLength": len(self.bin)}],
            "bufferViews": self.views,
            "accessors": self.accessors,
            "materials": self.materials,
            "meshes": self.meshes,
            "nodes": self.nodes,
            "scenes": [{"nodes": [root]}],
            "scene": 0,
        }
        if self.images:
            doc["images"] = self.images
            doc["textures"] = self.textures
        if self.extensions_used:
            doc["extensionsUsed"] = sorted(self.extensions_used)
        js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
        while len(js) % 4:
            js += b" "
        bin_data = bytes(self.bin)
        while len(bin_data) % 4:
            bin_data += b"\x00"
        length = 12 + 8 + len(js) + 8 + len(bin_data)
        out = bytearray()
        out += struct.pack("<I", 0x46546C67)  # glTF
        out += struct.pack("<I", 2)
        out += struct.pack("<I", length)
        out += struct.pack("<I", len(js))
        out += struct.pack("<I", 0x4E4F534A)  # JSON
        out += js
        out += struct.pack("<I", len(bin_data))
        out += struct.pack("<I", 0x004E4942)  # BIN
        out += bin_data
        path.write_bytes(out)
        # tris estimate
        tris = 0
        for m in self.meshes:
            for p in m["primitives"]:
                tris += self.accessors[p["indices"]]["count"] // 3
        print(f"wrote {path}  {path.stat().st_size/1024:.1f} KB  ~{tris} tris  {len(self.meshes)} meshes  {len(self.nodes)} nodes")


# ---------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------

def wood_tex(size=256):
    img = Image.new("RGB", (size, size))
    px = img.load()
    rng = np.random.default_rng(7)
    for y in range(size):
        for x in range(size):
            plank = (x // 32) % 2
            n = float(rng.normal(0, 7))
            grain = math.sin((y + n) * 0.35) * 8 + math.sin((y * 0.05) + x * 0.02) * 6
            r = 118 + grain * 0.6 + n + (-8 if plank else 0)
            g = 86 + grain * 0.4 + n * 0.7 + (-6 if plank else 0)
            b = 52 + grain * 0.2 + n * 0.4
            # thin plank gaps
            if x % 32 == 0:
                r, g, b = 40, 28, 18
            px[x, y] = (int(max(0, min(255, r))), int(max(0, min(255, g))), int(max(0, min(255, b))))
    return img


def paint_tex(size=256):
    img = Image.new("RGB", (size, size), (138, 22, 28))
    px = img.load()
    rng = np.random.default_rng(3)
    for y in range(size):
        for x in range(size):
            n = float(rng.normal(0, 4))
            # subtle orange-red flake
            r = 138 + n + 6 * math.sin(x * 0.2 + y * 0.13)
            g = 22 + n * 0.4
            b = 28 + n * 0.3
            px[x, y] = (int(max(20, min(200, r))), int(max(8, min(80, g))), int(max(10, min(90, b))))
    return img


# ---------------------------------------------------------------------------
# Shared parts
# ---------------------------------------------------------------------------

def wheel_meshes(g: GLB, mats, radius=0.52, width=0.32, hub=0.18):
    # axle along +X, center at origin
    tire = cyl(0, 0, 0, radius, width, axis='x', seg=16, cap=False)
    # inner wall + outer wall as thinner discs
    sidewall_l = cyl(-width * 0.42, 0, 0, radius * 0.98, width * 0.08, axis='x', seg=16, cap=True, r_top=radius * 0.72)
    sidewall_r = cyl( width * 0.42, 0, 0, radius * 0.98, width * 0.08, axis='x', seg=16, cap=True, r_top=radius * 0.72)
    rim = cyl(0, 0, 0, radius * 0.68, width * 0.55, axis='x', seg=14, cap=True)
    dish_l = cyl(-width * 0.22, 0, 0, radius * 0.55, 0.04, axis='x', seg=14, cap=True)
    dish_r = cyl( width * 0.22, 0, 0, radius * 0.55, 0.04, axis='x', seg=14, cap=True)
    hubc = cyl(0, 0, 0, hub, width * 0.7, axis='x', seg=10, cap=True)
    # 5 lug nuts
    lugs = []
    for i in range(5):
        a = i * 2 * math.pi / 5
        lugs.append(cyl(width * 0.28, math.cos(a) * 0.12, math.sin(a) * 0.12, 0.025, 0.04, axis='x', seg=6))
        lugs.append(cyl(-width * 0.28, math.cos(a) * 0.12, math.sin(a) * 0.12, 0.025, 0.04, axis='x', seg=6))
    tire_m = merge([tire, sidewall_l, sidewall_r])
    rim_m = merge([rim, dish_l, dish_r, hubc] + lugs)
    return [
        (*tire_m, mats["rubber"]),
        (*rim_m, mats["steel"]),
    ]


def make_mats(g: GLB, wood=None, paint=None):
    return {
        "paint": g.material("paint", (0.42, 0.055, 0.07), metal=0.18, rough=0.28, clearcoat=0.9, cc_rough=0.12, texture=paint),
        "paintDark": g.material("paintDark", (0.16, 0.03, 0.035), metal=0.2, rough=0.32, clearcoat=0.7),
        "black": g.material("black", (0.03, 0.03, 0.035), metal=0.15, rough=0.45),
        "chrome": g.material("chrome", (0.78, 0.80, 0.83), metal=1.0, rough=0.12),
        "steel": g.material("steel", (0.45, 0.46, 0.48), metal=0.9, rough=0.35),
        "steelDark": g.material("steelDark", (0.18, 0.18, 0.2), metal=0.85, rough=0.4),
        "rubber": g.material("rubber", (0.05, 0.05, 0.055), metal=0.0, rough=0.72),
        "glass": g.material("glass", (0.08, 0.12, 0.16), metal=0.2, rough=0.08, alpha=0.55, double=True),
        "wood": g.material("wood", (0.55, 0.4, 0.25), metal=0.0, rough=0.78, texture=wood),
        "gold": g.material("gold", (0.72, 0.52, 0.16), metal=1.0, rough=0.28),
        "goldBright": g.material("goldBright", (0.85, 0.65, 0.22), metal=1.0, rough=0.18),
        "canvas": g.material("canvas", (0.55, 0.12, 0.12), metal=0.0, rough=0.7),
        "cream": g.material("cream", (0.82, 0.74, 0.55), metal=0.0, rough=0.55),
        "head": g.material("head", (1, 0.96, 0.85), metal=0.0, rough=0.2, emissive=(1.0, 0.95, 0.8), emi=1),
        "tail": g.material("tail", (0.7, 0.05, 0.05), metal=0.1, rough=0.25, emissive=(0.8, 0.02, 0.02), emi=1),
        "rev": g.material("rev", (0.95, 0.95, 0.95), metal=0.0, rough=0.25, emissive=(1, 1, 1), emi=1),
        "amber": g.material("amber", (1.0, 0.6, 0.1), metal=0.0, rough=0.3, emissive=(1.0, 0.55, 0.08), emi=1),
        "marker": g.material("marker", (0.9, 0.15, 0.05), metal=0.0, rough=0.3, emissive=(0.9, 0.15, 0.05), emi=1),
    }


# ---------------------------------------------------------------------------
# Truck
# ---------------------------------------------------------------------------

def build_truck():
    g = GLB()
    paint_tex_i = g.add_image(paint_tex())
    mats = make_mats(g, paint=paint_tex_i)

    # Dimensions (meters)
    # Origin: ground, plan-center. Front = +Z.
    length, width = 5.7, 2.48
    wb = 3.35  # wheelbase
    wr = 0.52
    track = 1.92
    # Body parts (static), grouped by material
    buckets = defaultdict(list)
    def add(mat, *mesh):
        buckets[mat].append(mesh if len(mesh) == 4 else mesh[0])

    # --- chassis rails
    add(mats["steelDark"], *box(0, 0.52, 0.1, 0.16, 0.18, 5.2))
    add(mats["steelDark"], *box(0, 0.52, 0.1, 0.16, 0.18, 5.2))  # will shift
    # actually two rails
    buckets[mats["steelDark"]].pop()
    add(mats["steelDark"], *box(-0.42, 0.50, 0.05, 0.12, 0.20, 5.35))
    add(mats["steelDark"], *box( 0.42, 0.50, 0.05, 0.12, 0.20, 5.35))
    # crossmembers
    for z in (-2.2, -1.1, 0.0, 1.2, 2.2):
        add(mats["steelDark"], *box(0, 0.50, z, 0.95, 0.08, 0.10))

    # --- front bumper
    add(mats["chrome"], *box(0, 0.48, 2.78, 2.36, 0.28, 0.22))
    add(mats["chrome"], *box(-1.16, 0.52, 2.68, 0.10, 0.38, 0.28))
    add(mats["chrome"], *box( 1.16, 0.52, 2.68, 0.10, 0.38, 0.28))
    add(mats["black"], *box(0, 0.42, 2.90, 2.10, 0.08, 0.06))  # lower lip

    # --- grill
    add(mats["chrome"], *box(0, 1.15, 2.58, 1.12, 0.95, 0.10))  # surround
    add(mats["black"], *box(0, 1.15, 2.62, 0.96, 0.80, 0.08))
    for i in range(8):
        y = 0.82 + i * 0.085
        add(mats["chrome"], *box(0, y, 2.66, 0.92, 0.04, 0.04))

    # headlights
    add(mats["chrome"], *box(-0.82, 0.92, 2.62, 0.38, 0.22, 0.10))
    add(mats["chrome"], *box( 0.82, 0.92, 2.62, 0.38, 0.22, 0.10))
    # head light emitters as separate nodes later

    # --- hood (long, sloped via stacked boxes)
    add(mats["paint"], *box(0, 1.18, 1.95, 2.05, 0.16, 1.15))  # top
    add(mats["black"], *box(0, 1.27, 1.95, 0.70, 0.05, 1.10))  # hood stripe
    add(mats["paint"], *box(0, 0.95, 1.95, 2.10, 0.48, 1.15))  # body of hood
    add(mats["paint"], *box(0, 0.72, 2.35, 2.10, 0.22, 0.42))  # toward grill
    # hood sides / fenders
    add(mats["paint"], *box(-1.08, 0.95, 1.85, 0.22, 0.70, 1.35))
    add(mats["paint"], *box( 1.08, 0.95, 1.85, 0.22, 0.70, 1.35))
    # front fender arches (boxes over wheels)
    add(mats["paint"], *box(-1.10, 0.95, 1.55, 0.28, 0.55, 1.05))
    add(mats["paint"], *box( 1.10, 0.95, 1.55, 0.28, 0.55, 1.05))

    # --- cab
    add(mats["paint"], *box(0, 1.55, 0.62, 2.22, 1.55, 1.35))  # main cab
    add(mats["paintDark"], *box(0, 2.38, 0.62, 2.16, 0.12, 1.28))  # roof
    # windshield (slanted)
    p, n, u, i = box(0, 1.85, 1.28, 1.85, 0.85, 0.06, rx=-0.42)
    add(mats["glass"], p, n, u, i)
    # chrome windshield trim
    p, n, u, i = box(0, 2.22, 1.18, 1.92, 0.05, 0.06, rx=-0.42)
    add(mats["chrome"], p, n, u, i)
    # side windows
    add(mats["glass"], *box(-1.12, 1.85, 0.62, 0.05, 0.70, 0.95))
    add(mats["glass"], *box( 1.12, 1.85, 0.62, 0.05, 0.70, 0.95))
    # rear window
    add(mats["glass"], *box(0, 1.90, -0.04, 1.6, 0.62, 0.05))
    # door handles
    add(mats["chrome"], *box(-1.14, 1.25, 0.85, 0.06, 0.06, 0.16))
    add(mats["chrome"], *box( 1.14, 1.25, 0.85, 0.06, 0.06, 0.16))
    # cab steps
    add(mats["steelDark"], *box(-1.15, 0.42, 0.70, 0.28, 0.08, 0.70))
    add(mats["steelDark"], *box(-1.15, 0.62, 0.70, 0.22, 0.06, 0.60))
    add(mats["steelDark"], *box( 1.15, 0.42, 0.70, 0.28, 0.08, 0.70))
    add(mats["steelDark"], *box( 1.15, 0.62, 0.70, 0.22, 0.06, 0.60))
    # black grill surround under windshield (face)
    add(mats["black"], *box(0, 1.35, 1.30, 2.05, 0.18, 0.08))

    # west-coast mirrors
    for side in (-1, 1):
        add(mats["steelDark"], *box(side * 1.28, 1.70, 1.22, 0.08, 0.08, 0.28))
        add(mats["chrome"], *box(side * 1.42, 1.55, 1.18, 0.18, 0.42, 0.08))
        add(mats["chrome"], *box(side * 1.42, 1.22, 1.18, 0.14, 0.16, 0.06))

    # exhaust stack (left, behind cab)
    add(mats["steel"], *cyl(-0.95, 2.05, -0.18, 0.07, 2.2, axis='y', seg=10))
    for y in (1.3, 1.7, 2.1, 2.5, 2.9):
        add(mats["steel"], *cyl(-0.95, y, -0.18, 0.095, 0.05, axis='y', seg=10))
    add(mats["chrome"], *cyl(-0.95, 3.18, -0.18, 0.09, 0.12, axis='y', seg=10, r_top=0.11))

    # fuel tank (left)
    add(mats["chrome"], *cyl(-1.05, 0.72, -0.55, 0.28, 0.95, axis='z', seg=12))
    add(mats["steelDark"], *box(-1.05, 0.72, -0.55, 0.08, 0.08, 0.95))

    # --- short stake bed
    bed_z0, bed_z1 = -2.75, -0.15
    bed_len = bed_z1 - bed_z0
    bed_mid = (bed_z0 + bed_z1) / 2
    add(mats["wood"], *box(0, 1.02, bed_mid, 2.20, 0.07, bed_len - 0.05))
    # red sides
    add(mats["paint"], *box(-1.12, 1.28, bed_mid, 0.07, 0.48, bed_len))
    add(mats["paint"], *box( 1.12, 1.28, bed_mid, 0.07, 0.48, bed_len))
    add(mats["paint"], *box(0, 1.28, bed_z0 + 0.04, 2.20, 0.48, 0.07))
    # silver stake rails
    for side in (-1.12, 1.12):
        add(mats["chrome"], *box(side, 1.62, bed_mid, 0.04, 0.04, bed_len))
        for z in np.linspace(bed_z0 + 0.15, bed_z1 - 0.15, 5):
            add(mats["chrome"], *box(side, 1.42, z, 0.03, 0.42, 0.03))
        # mid rail
        add(mats["chrome"], *box(side, 1.28, bed_mid, 0.04, 0.03, bed_len))
    # rear rail
    add(mats["chrome"], *box(0, 1.62, bed_z0 + 0.04, 2.20, 0.04, 0.04))

    # rear bumper + mudflaps
    add(mats["chrome"], *box(0, 0.42, -2.88, 2.20, 0.18, 0.16))
    add(mats["black"], *box(-0.85, 0.28, -2.72, 0.40, 0.35, 0.04))
    add(mats["black"], *box( 0.85, 0.28, -2.72, 0.40, 0.35, 0.04))
    # tail housings
    add(mats["chrome"], *box(-0.85, 0.62, -2.92, 0.32, 0.16, 0.08))
    add(mats["chrome"], *box( 0.85, 0.62, -2.92, 0.32, 0.16, 0.08))
    # hitch plate
    add(mats["steelDark"], *box(0, 0.62, -2.95, 0.45, 0.18, 0.22))
    add(mats["steel"], *cyl(0, 0.55, -3.10, 0.05, 0.22, axis='z', seg=8))
    add(mats["steel"], *cyl(0, 0.55, -3.22, 0.07, 0.06, axis='z', seg=8))

    # rear fenders
    add(mats["paint"], *box(-1.12, 0.95, -1.55, 0.26, 0.50, 1.15))
    add(mats["paint"], *box( 1.12, 0.95, -1.55, 0.26, 0.50, 1.15))

    # body merged per material
    body_prims = []
    for mat, meshes in buckets.items():
        body_prims.append((*merge(meshes), mat))
    body_mesh = g.add_prims("body", body_prims)
    body_node = g.node("body", mesh=body_mesh)

    # lights as separate named meshes
    def light_node(name, mesh_data, mat):
        mid = g.add_prims(name, [(*mesh_data, mat)])
        return g.node(name, mesh=mid)

    head_L = light_node("light_head_L", box(-0.82, 0.92, 2.70, 0.30, 0.16, 0.06), mats["head"])
    head_R = light_node("light_head_R", box( 0.82, 0.92, 2.70, 0.30, 0.16, 0.06), mats["head"])
    tail_L = light_node("light_tail_L", box(-0.92, 0.62, -2.98, 0.16, 0.12, 0.05), mats["tail"])
    tail_R = light_node("light_tail_R", box( 0.92, 0.62, -2.98, 0.16, 0.12, 0.05), mats["tail"])
    # inner reverse lamps
    rev_L = light_node("light_rev_L", box(-0.74, 0.62, -2.98, 0.10, 0.10, 0.05), mats["rev"])
    rev_R = light_node("light_rev_R", box( 0.74, 0.62, -2.98, 0.10, 0.10, 0.05), mats["rev"])
    cab_nodes = []
    for i, x in enumerate((-0.56, -0.28, 0.0, 0.28, 0.56)):
        cab_nodes.append(light_node(f"light_cab_{i}", cyl(x, 2.50, 1.18, 0.055, 0.07, axis='y', seg=8), mats["amber"]))

    # wheels
    wprims = wheel_meshes(g, mats, radius=wr, width=0.30)
    wmesh = g.add_prims("wheel", wprims)
    z_f, z_r = wb / 2, -wb / 2
    x_l, x_r = -track / 2, track / 2

    def wheel_at(name, x, z, steer=False):
        # wheel mesh is centered; place at (x, wr, z). For left side, rotate 180 so cap faces out
        # Cylinder along +X: the "outside" of the left wheel should face -X, so rotate Y=pi
        rot = [0, 1, 0, 0] if x < 0 else None  # 180 deg around Y (xyzw 0,1,0,0)
        wn = g.node(name, mesh=wmesh, t=(0, 0, 0), r=rot, extras={"role": "wheel"})
        if steer:
            return g.node(name.replace("wheel_", "steer_"), children=[wn], t=(x, wr, z), extras={"role": "steer"})
        # non-steer: put the wheel node itself at position (recreate)
        # The above wn is at origin; wrap with a positioned parent
        return g.node(name + "_hub", children=[wn], t=(x, wr, z), extras={"role": "wheel_hub"})

    # Actually for named wheels used in-engine, the rotating node should be the one we roll (rotation.x).
    # Hierarchy: [steer or hub] at world position -> wheel mesh node
    fl = wheel_at("wheel_FL", x_l, z_f, steer=True)
    fr = wheel_at("wheel_FR", x_r, z_f, steer=True)
    # dual rears
    rl  = wheel_at("wheel_RL",  x_l, z_r)
    rl2 = wheel_at("wheel_RL2", x_l - 0.32, z_r)
    rr  = wheel_at("wheel_RR",  x_r, z_r)
    rr2 = wheel_at("wheel_RR2", x_r + 0.32, z_r)

    children = [body_node, head_L, head_R, tail_L, tail_R, rev_L, rev_R, *cab_nodes, fl, fr, rl, rl2, rr, rr2]
    g.save(OUT / "truck.glb", children)
    # print dimensions for game.js
    hitch_off = 3.22  # coupler z is -3.22, origin 0
    print(f"  truck hitchOff={hitch_off:.2f} length={length} width={width} wheelbase={wb} wheelR={wr}")


# ---------------------------------------------------------------------------
# Trailer chassis + cargo
# ---------------------------------------------------------------------------

def trailer_chassis(g, mats, deck_len=6.4, deck_w=2.35, tongue=1.65, wr=0.48):
    buckets = defaultdict(list)
    def add(mat, p, n, u, i):
        buckets[mat].append((p, n, u, i))

    # origin at deck center. Front of deck at +deck_len/2, tongue extends further +Z toward hitch.
    # Hitch tip at z = deck_len/2 + tongue
    z_front = deck_len / 2
    z_rear = -deck_len / 2
    deck_y = 1.05

    # main beams
    add(mats["steelDark"], *box(-0.55, 0.78, 0, 0.14, 0.22, deck_len + 0.1))
    add(mats["steelDark"], *box( 0.55, 0.78, 0, 0.14, 0.22, deck_len + 0.1))
    for z in np.linspace(z_rear + 0.3, z_front - 0.3, 8):
        add(mats["steelDark"], *box(0, 0.78, z, 1.3, 0.08, 0.10))

    # wooden deck — individual planks
    nplank = 18
    pw = deck_len / nplank
    for i in range(nplank):
        z = z_rear + pw * (i + 0.5)
        add(mats["wood"], *box(0, deck_y, z, deck_w, 0.07, pw * 0.92))

    # side angle iron
    add(mats["steel"], *box(-deck_w / 2, deck_y + 0.06, 0, 0.06, 0.08, deck_len))
    add(mats["steel"], *box( deck_w / 2, deck_y + 0.06, 0, 0.06, 0.08, deck_len))
    add(mats["steel"], *box(0, deck_y + 0.06, z_rear, deck_w, 0.08, 0.06))
    add(mats["steel"], *box(0, deck_y + 0.06, z_front, deck_w, 0.08, 0.06))

    # tongue A-frame
    # two beams from deck front to hitch
    hitch_z = z_front + tongue
    # approximate with long thin boxes rotated in Y
    ang = math.atan2(0.55, tongue)
    length_beam = math.hypot(0.55, tongue)
    # We'll place boxes along the beams with ry
    p, n, u, i = box(-0.28, 0.70, z_front + tongue * 0.5, 0.10, 0.14, length_beam, ry=ang)
    add(mats["steelDark"], p, n, u, i)
    p, n, u, i = box( 0.28, 0.70, z_front + tongue * 0.5, 0.10, 0.14, length_beam, ry=-ang)
    add(mats["steelDark"], p, n, u, i)
    # coupler
    add(mats["steel"], *box(0, 0.62, hitch_z - 0.12, 0.22, 0.16, 0.28))
    add(mats["steel"], *cyl(0, 0.55, hitch_z + 0.02, 0.06, 0.14, axis='y', seg=8))
    # jack
    add(mats["steel"], *cyl(0, 0.45, z_front + 0.35, 0.05, 0.7, axis='y', seg=8))
    add(mats["steelDark"], *box(0, 0.12, z_front + 0.35, 0.25, 0.06, 0.18))

    # toolboxes at front of deck
    add(mats["steelDark"], *box(-0.85, 0.85, z_front - 0.25, 0.55, 0.32, 0.45))
    add(mats["steelDark"], *box( 0.85, 0.85, z_front - 0.25, 0.55, 0.32, 0.45))
    add(mats["gold"], *box(-0.85, 0.92, z_front - 0.02, 0.12, 0.04, 0.04))
    add(mats["gold"], *box( 0.85, 0.92, z_front - 0.02, 0.12, 0.04, 0.04))

    # tandem axle frame near rear
    axle1, axle2 = z_rear + 1.15, z_rear + 1.85
    add(mats["steelDark"], *cyl(0, wr, axle1, 0.06, 2.1, axis='x', seg=8))
    add(mats["steelDark"], *cyl(0, wr, axle2, 0.06, 2.1, axis='x', seg=8))
    # fenders over tandems
    mid_ax = (axle1 + axle2) / 2
    add(mats["steelDark"], *box(-1.15, 1.05, mid_ax, 0.22, 0.18, 1.15))
    add(mats["steelDark"], *box( 1.15, 1.05, mid_ax, 0.22, 0.18, 1.15))

    hitch_off = hitch_z  # origin at 0, hitch at +hitch_z (front is +Z)
    axle_off = mid_ax    # axle z relative to origin (negative-ish toward rear)
    # Distance hitch to axle: hitch_z - mid_ax
    return buckets, hitch_off, (hitch_z - mid_ax), wr, (axle1, axle2), deck_y, deck_w, z_front, z_rear


def ferris_cargo(mats, deck_y, z_front, z_rear):
    parts = defaultdict(list)
    def add(mat, p, n, u, i):
        parts[mat].append((p, n, u, i))
    y0 = deck_y + 0.08
    # two ornate rim arcs lying on the deck, slightly upright
    # arc in XY, then rotate to sit along Z
    # First arc — nearly vertical, leaning
    p, n, u, i = torus_arc(0.15, y0 + 0.15, -0.6, R=1.55, r=0.11, a0=0.15, a1=math.pi - 0.15, seg=22, tube=8, rz=0.15)
    add(mats["paint"], p, n, u, i)
    p, n, u, i = torus_arc(0.15, y0 + 0.15, -0.6, R=1.55, r=0.16, a0=0.15, a1=math.pi - 0.15, seg=22, tube=6, rz=0.15)
    add(mats["gold"], p, n, u, i)
    # second arc, offset
    p, n, u, i = torus_arc(-0.2, y0 + 0.1, 0.5, R=1.35, r=0.10, a0=0.2, a1=math.pi - 0.2, seg=20, tube=8, rz=-0.2, ry=0.4)
    add(mats["paint"], p, n, u, i)
    p, n, u, i = torus_arc(-0.2, y0 + 0.1, 0.5, R=1.35, r=0.15, a0=0.2, a1=math.pi - 0.2, seg=20, tube=6, rz=-0.2, ry=0.4)
    add(mats["gold"], p, n, u, i)

    # A-frame truss (gold/red beams)
    for side, x in ((-1, -0.7), (1, 0.7)):
        p, n, u, i = box(x, y0 + 1.15, -0.4, 0.08, 2.2, 0.08, rx=0.55)
        add(mats["gold"], p, n, u, i)
        p, n, u, i = box(x, y0 + 1.15, 0.3, 0.08, 2.0, 0.08, rx=-0.45)
        add(mats["paint"], p, n, u, i)
    # cross beams
    add(mats["gold"], *box(0, y0 + 2.05, -0.15, 1.5, 0.08, 0.08))
    add(mats["gold"], *box(0, y0 + 1.35, 0.05, 1.5, 0.07, 0.07))
    add(mats["steelDark"], *box(0, y0 + 0.15, -0.2, 1.6, 0.08, 0.08))

    # gondolas — onion-domed cabins
    def gondola(x, y, z, scale=1.0):
        s = scale
        add(mats["paint"], *cyl(x, y + 0.28 * s, z, 0.28 * s, 0.42 * s, axis='y', seg=10))
        add(mats["gold"], *cyl(x, y + 0.08 * s, z, 0.30 * s, 0.06 * s, axis='y', seg=10))
        add(mats["gold"], *cyl(x, y + 0.48 * s, z, 0.30 * s, 0.05 * s, axis='y', seg=10))
        # dome
        p, n, u, i = sphere(x, y + 0.52 * s, z, 0.28 * s, seg=10, rings=6, hemi=True)
        add(mats["paint"], p, n, u, i)
        # gold finial
        add(mats["gold"], *cyl(x, y + 0.82 * s, z, 0.03 * s, 0.16 * s, axis='y', seg=6))
        add(mats["gold"], *sphere(x, y + 0.92 * s, z, 0.045 * s, seg=8, rings=6))
        # windows
        for a in (0, 1.57, 3.14, 4.71):
            add(mats["glass"], *box(x + math.cos(a) * 0.27 * s, y + 0.28 * s, z + math.sin(a) * 0.27 * s,
                                    0.06, 0.18 * s, 0.14 * s, ry=-a + math.pi / 2))
    gondola(-0.55, y0, 0.85, 0.95)
    gondola(0.55, y0, 0.15, 1.0)
    gondola(0.15, y0, 1.35, 0.85)
    gondola(-0.15, y0 + 0.85, -0.35, 0.9)  # one stacked a bit

    # straps / chains (dark thin boxes)
    for x, z, l, ry in ((-0.9, 0.4, 1.4, 0.3), (0.9, -0.5, 1.3, -0.25), (0.0, 1.2, 1.1, 0.0)):
        add(mats["steelDark"], *box(x, y0 + 0.55, z, 0.03, 0.03, l, ry=ry, rx=0.4))

    return parts


def food_cargo(mats, deck_y, z_front, z_rear):
    parts = defaultdict(list)
    def add(mat, p, n, u, i):
        parts[mat].append((p, n, u, i))
    y0 = deck_y + 0.08
    # packed food-stand body
    add(mats["cream"], *box(0, y0 + 0.55, 0.2, 1.8, 1.1, 2.6))
    add(mats["paint"], *box(0, y0 + 0.55, 0.2, 1.86, 0.12, 2.66))  # red band
    add(mats["paint"], *box(0, y0 + 1.15, 0.2, 1.86, 0.10, 2.66))
    # folded awning
    add(mats["canvas"], *box(0, y0 + 1.35, 0.2, 2.0, 0.18, 2.8))
    add(mats["gold"], *box(0, y0 + 1.48, 0.2, 2.05, 0.05, 2.85))
    # sign board packed on top
    add(mats["paint"], *box(0, y0 + 1.75, -0.2, 1.4, 0.55, 0.08))
    add(mats["cream"], *box(0, y0 + 1.75, -0.16, 1.2, 0.4, 0.04))
    # barrels / crates
    add(mats["steel"], *cyl(-0.7, y0 + 0.35, -1.5, 0.28, 0.7, axis='y', seg=10))
    add(mats["steel"], *cyl(0.7, y0 + 0.35, -1.5, 0.28, 0.7, axis='y', seg=10))
    add(mats["wood"], *box(0.0, y0 + 0.25, -1.55, 0.5, 0.5, 0.5))
    return parts


def booth_cargo(mats, deck_y, z_front, z_rear):
    parts = defaultdict(list)
    def add(mat, p, n, u, i):
        parts[mat].append((p, n, u, i))
    y0 = deck_y + 0.08
    # folded booth facade
    add(mats["paint"], *box(0, y0 + 0.7, 0.3, 2.1, 1.4, 0.16))
    add(mats["gold"], *box(0, y0 + 1.42, 0.3, 2.2, 0.08, 0.18))
    add(mats["gold"], *box(0, y0 + 0.08, 0.3, 2.2, 0.08, 0.18))
    # window opening frame
    add(mats["wood"], *box(0, y0 + 0.7, 0.22, 1.2, 0.7, 0.08))
    add(mats["cream"], *box(0, y0 + 0.7, 0.18, 1.05, 0.55, 0.04))
    # prize crates
    add(mats["wood"], *box(-0.7, y0 + 0.35, -1.0, 0.7, 0.7, 0.7))
    add(mats["wood"], *box(0.7, y0 + 0.35, -1.0, 0.7, 0.7, 0.7))
    add(mats["canvas"], *box(-0.7, y0 + 0.8, -1.0, 0.5, 0.2, 0.5))
    add(mats["canvas"], *box(0.7, y0 + 0.8, -1.0, 0.5, 0.2, 0.5))
    # sign
    add(mats["paint"], *box(0, y0 + 1.1, -0.5, 1.6, 0.5, 0.08))
    add(mats["gold"], *box(0, y0 + 1.1, -0.46, 1.4, 0.32, 0.04))
    return parts


def build_trailer(kind):
    g = GLB()
    wood_i = g.add_image(wood_tex())
    paint_i = g.add_image(paint_tex())
    mats = make_mats(g, wood=wood_i, paint=paint_i)

    if kind == "ferris":
        deck_len, tongue = 6.5, 1.7
    elif kind == "food":
        deck_len, tongue = 5.0, 1.45
    else:
        deck_len, tongue = 4.7, 1.4

    buckets, hitch_off, axle_dist, wr, axles, deck_y, deck_w, z_front, z_rear = trailer_chassis(
        g, mats, deck_len=deck_len, tongue=tongue, wr=0.48
    )

    if kind == "ferris":
        cargo = ferris_cargo(mats, deck_y, z_front, z_rear)
    elif kind == "food":
        cargo = food_cargo(mats, deck_y, z_front, z_rear)
    else:
        cargo = booth_cargo(mats, deck_y, z_front, z_rear)
    for mat, meshes in cargo.items():
        buckets[mat].extend(meshes)

    body_prims = [(*merge(ms), mat) for mat, ms in buckets.items() if ms]
    body_mesh = g.add_prims("body", body_prims)
    body_node = g.node("body", mesh=body_mesh)

    # marker / tail lights on trailer
    def lnode(name, mesh_data, mat):
        mid = g.add_prims(name, [(*mesh_data, mat)])
        return g.node(name, mesh=mid)

    tail_L = lnode("light_tail_L", box(-deck_w / 2 + 0.08, 0.85, z_rear - 0.04, 0.12, 0.10, 0.05), mats["tail"])
    tail_R = lnode("light_tail_R", box( deck_w / 2 - 0.08, 0.85, z_rear - 0.04, 0.12, 0.10, 0.05), mats["tail"])
    # amber side markers
    mk = []
    for i, z in enumerate((z_front - 0.4, 0.0, z_rear + 0.4)):
        mk.append(lnode(f"light_marker_L{i}", box(-deck_w / 2, 0.95, z, 0.05, 0.05, 0.08), mats["amber"]))
        mk.append(lnode(f"light_marker_R{i}", box( deck_w / 2, 0.95, z, 0.05, 0.05, 0.08), mats["amber"]))

    # 8 wheels (tandem dual)
    wprims = wheel_meshes(g, mats, radius=wr, width=0.28)
    wmesh = g.add_prims("wheel", wprims)
    track = 1.85
    axle1, axle2 = axles
    wheel_nodes = []
    idx = 0
    for z in (axle1, axle2):
        for x, name in ((-track / 2, "L"), (track / 2, "R"), (-track / 2 - 0.30, "L2"), (track / 2 + 0.30, "R2")):
            rot = [0, 1, 0, 0] if x < 0 else None
            wn = g.node(f"wheel_{name}_{idx}", mesh=wmesh, r=rot, extras={"role": "wheel"})
            wheel_nodes.append(g.node(f"wheel_{name}_{idx}_hub", children=[wn], t=(x, wr, z), extras={"role": "wheel_hub"}))
        idx += 1

    children = [body_node, tail_L, tail_R, *mk, *wheel_nodes]
    g.save(OUT / f"trailer_{kind}.glb", children)
    print(f"  trailer_{kind} hitchOff={hitch_off:.2f} axleL={axle_dist:.2f} wr={wr} deck={deck_len}")
    return hitch_off, axle_dist


if __name__ == "__main__":
    build_truck()
    for k in ("ferris", "food", "booth"):
        build_trailer(k)
