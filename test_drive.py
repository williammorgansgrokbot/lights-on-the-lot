#!/usr/bin/env python3
"""Drive / unstuck regression tests for Lights on the Lot.

Emulates iPhone landscape (844x390, hasTouch, isMobile) and a desktop
keyboard, for a fresh load and a v1 save with the Ferris already placed
and the truck sitting on its pad.
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
PORT = Path("/tmp/lot-port").read_text().strip()
URL = f"http://127.0.0.1:{PORT}/index.html"

# Old live save key + a truck planted on the Ferris pad.
LEGACY_KEY = "wm.lights-on-the-lot.v1"
NEW_KEY = "wm.lights-on-the-lot.v3"
FERRIS = {"x": -11.2, "z": -3.0}

failures = []
errors = []
logs = []


def fail(msg):
    print("FAIL:", msg, flush=True)
    failures.append(msg)


def wait_ready(page, timeout=25000):
    page.wait_for_function("() => window.LOT && window.LOT.ready", timeout=timeout)


def pose(page):
    return page.evaluate("() => LOT.truckPose()")


def hold_control(page, selector, ms, also_wheel=False, steer_x=None):
    """Hold a pedal (and optionally drag the wheel) using pointer + touch events."""
    box = page.locator(selector).bounding_box()
    if not box:
        fail(f"{selector} has no bounding box (touch HUD hidden?)")
        return
    cx = box["x"] + box["width"] / 2
    cy = box["y"] + box["height"] / 2
    page.evaluate(
        """({sel, x, y}) => {
          const el = document.querySelector(sel);
          const ev = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
                       isPrimary: true, buttons: 1, clientX: x, clientY: y, button: 0 };
          el.dispatchEvent(new PointerEvent('pointerdown', ev));
          el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
        }""",
        {"sel": selector, "x": cx, "y": cy},
    )
    if also_wheel:
        pad = page.locator("#wheelPad").bounding_box()
        if pad:
            wx = pad["x"] + pad["width"] * (0.85 if steer_x is None else steer_x)
            wy = pad["y"] + pad["height"] / 2
            page.evaluate(
                """({x, y}) => {
                  const el = document.getElementById('wheelPad');
                  const ev = { bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch',
                               isPrimary: false, buttons: 1, clientX: x, clientY: y, button: 0 };
                  el.dispatchEvent(new PointerEvent('pointerdown', ev));
                  el.dispatchEvent(new PointerEvent('pointermove', ev));
                }""",
                {"x": wx, "y": wy},
            )
    page.wait_for_timeout(ms)
    page.evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1 }));
          el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
          const pad = document.getElementById('wheelPad');
          pad.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 2 }));
        }""",
        selector,
    )


def dist(a, b):
    return ((a["x"] - b["x"]) ** 2 + (a["z"] - b["z"]) ** 2) ** 0.5


def assert_clear_of_ferris(p, label):
    d = ((p["x"] - FERRIS["x"]) ** 2 + (p["z"] - FERRIS["z"]) ** 2) ** 0.5
    if p["stuck"]:
        fail(f"{label}: truck still reports stuck at ({p['x']:.2f},{p['z']:.2f})")
    if d < 7.5:
        fail(f"{label}: truck is still under/near Ferris (d={d:.2f} at {p['x']:.2f},{p['z']:.2f})")
    else:
        print(f"  {label}: clear of Ferris (d={d:.2f}) at ({p['x']:.2f},{p['z']:.2f})", flush=True)


def run_touch_drive(page, label):
    before = pose(page)
    print(f"  {label} start", before, flush=True)
    if before["stuck"]:
        fail(f"{label}: truck already stuck at start {before}")
    hold_control(page, "#pDrive", 900)
    after = pose(page)
    moved = dist(before, after)
    print(f"  {label} after D", after, "moved", round(moved, 3), flush=True)
    if moved < 0.6:
        fail(f"{label}: D pedal did not move the truck (delta={moved:.3f})")
    mid = pose(page)
    hold_control(page, "#pRev", 900)
    back = pose(page)
    rev = dist(mid, back)
    print(f"  {label} after R", back, "moved", round(rev, 3), flush=True)
    if rev < 0.4:
        fail(f"{label}: R pedal did not move the truck (delta={rev:.3f})")
    heading0 = pose(page)["heading"]
    hold_control(page, "#pDrive", 1000, also_wheel=True, steer_x=0.9)
    heading1 = pose(page)["heading"]
    dhead = abs(((heading1 - heading0 + 3.14159) % 6.28318) - 3.14159)
    print(f"  {label} steer {heading0:.3f} -> {heading1:.3f} d={dhead:.3f}", flush=True)
    if dhead < 0.12:
        fail(f"{label}: steering wheel did not change heading (d={dhead:.3f})")
    if pose(page)["stuck"]:
        fail(f"{label}: truck ended stuck after driving")


def run_keyboard_drive(page, label):
    before = pose(page)
    page.keyboard.down("KeyW")
    page.wait_for_timeout(900)
    page.keyboard.up("KeyW")
    after = pose(page)
    moved = dist(before, after)
    print(f"  {label} WASD D", after, "moved", round(moved, 3), flush=True)
    if moved < 0.6:
        fail(f"{label}: KeyW did not move the truck (delta={moved:.3f})")
    mid = pose(page)
    page.keyboard.down("KeyS")
    page.wait_for_timeout(900)
    page.keyboard.up("KeyS")
    back = pose(page)
    rev = dist(mid, back)
    print(f"  {label} WASD R", back, "moved", round(rev, 3), flush=True)
    if rev < 0.4:
        fail(f"{label}: KeyS did not move the truck (delta={rev:.3f})")
    h0 = pose(page)["heading"]
    page.keyboard.down("KeyW")
    page.keyboard.down("KeyD")
    page.wait_for_timeout(1000)
    page.keyboard.up("KeyD")
    page.keyboard.up("KeyW")
    h1 = pose(page)["heading"]
    dhead = abs(((h1 - h0 + 3.14159) % 6.28318) - 3.14159)
    print(f"  {label} steer {h0:.3f} -> {h1:.3f} d={dhead:.3f}", flush=True)
    if dhead < 0.12:
        fail(f"{label}: A/D did not change heading (d={dhead:.3f})")


def plant_legacy_ferris_save(page):
    page.evaluate(
        """({key, ferris}) => {
          const s = {
            hour: 16.2, day: 1, cash: 10, tickets: 2, assist: false,
            currentJob: 'food', hooked: false, open: false,
            truck: { x: ferris.x, z: ferris.z, heading: 0 },
            trailer: { kind: 'food', x: 10, z: 21.5, heading: -Math.PI / 2 },
            footprints: { ferris: { x: ferris.x, z: ferris.z, rot: Math.PI / 2 } }
          };
          localStorage.removeItem('wm.lights-on-the-lot.v3');
          localStorage.removeItem('wm.lights-on-the-lot.v2');
          localStorage.setItem(key, JSON.stringify(s));
        }""",
        {"key": LEGACY_KEY, "ferris": FERRIS},
    )


def open_context(p, kind):
    if kind == "iphone":
        return p.chromium.launch(headless=True, args=["--use-gl=angle", "--ignore-gpu-blocklist"]).new_context(
            viewport={"width": 844, "height": 390},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
    browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--ignore-gpu-blocklist"])
    return browser.new_context(
        viewport={"width": 1280, "height": 720},
        is_mobile=False,
        has_touch=False,
    )


def attach(page):
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    page.on("pageerror", lambda e: errors.append(str(e)))


def main():
    with sync_playwright() as p:
        # ---- iPhone, fresh load ----
        print("=== iPhone fresh ===", flush=True)
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--ignore-gpu-blocklist"])
        ctx = browser.new_context(
            viewport={"width": 844, "height": 390},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()
        attach(page)
        page.goto(URL, wait_until="domcontentloaded", timeout=20000)
        wait_ready(page)
        print("  ready", page.evaluate("() => ({mode: LOT.G.mode, touch: document.body.classList.contains('touch')})"), flush=True)
        if not page.evaluate("() => document.body.classList.contains('touch')"):
            fail("iPhone: body.touch class not set; D/R HUD may be hidden")
        page.evaluate("() => { localStorage.clear(); LOT.newGame(); }")
        page.wait_for_timeout(200)
        p0 = pose(page)
        assert_clear_of_ferris(p0, "iPhone fresh spawn")
        spawn = page.evaluate("() => LOT.SAFE_SPAWN")
        if dist(p0, spawn) > 5:
            fail(f"iPhone fresh: spawn not near SAFE_SPAWN ({p0} vs {spawn})")
        if not page.locator("#pDrive").is_visible():
            fail("iPhone: #pDrive not visible")
        if not page.locator("#btnUnstuck").is_visible():
            fail("iPhone: #btnUnstuck not visible")
        run_touch_drive(page, "iPhone fresh")

        # ---- iPhone, v1 Ferris save ----
        print("=== iPhone Ferris save ===", flush=True)
        plant_legacy_ferris_save(page)
        page.reload(wait_until="domcontentloaded", timeout=20000)
        wait_ready(page)
        page.evaluate("() => LOT.continueGame()")
        page.wait_for_timeout(200)
        p1 = pose(page)
        assert_clear_of_ferris(p1, "iPhone continue Ferris save")
        run_touch_drive(page, "iPhone Ferris save")

        # Plant truck under Ferris in a live play session and press Unstuck
        print("=== iPhone unstuck button ===", flush=True)
        page.evaluate(
            """() => {
              LOT.placeAll();
              const t = LOT.vehicle.truck;
              t.x = -11.2; t.z = -3; t.heading = 0; t.speed = 0;
            }"""
        )
        page.wait_for_timeout(50)
        planted = pose(page)
        print("  planted under Ferris", planted, flush=True)
        if not planted["stuck"]:
            # even if the pose is under the wheel, evict or collideAt should flag it
            print("  note: stuck flag was false right after plant (may evict next tick)", flush=True)
        page.locator("#btnUnstuck").click()
        page.wait_for_timeout(150)
        after_btn = pose(page)
        assert_clear_of_ferris(after_btn, "iPhone unstuck button")

        # Also confirm auto-evict if we leave it overlapping for >0.6s without driving
        page.evaluate(
            """() => {
              const t = LOT.vehicle.truck;
              t.x = -11.2; t.z = -3; t.heading = 0; t.speed = 0;
              LOT.vehicle.stuckT = 0;
            }"""
        )
        page.wait_for_timeout(900)
        auto = pose(page)
        assert_clear_of_ferris(auto, "iPhone auto-evict")

        ctx.close()
        browser.close()

        # ---- Desktop, fresh + Ferris save ----
        print("=== Desktop fresh ===", flush=True)
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--ignore-gpu-blocklist"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720}, is_mobile=False, has_touch=False)
        page = ctx.new_page()
        attach(page)
        page.goto(URL, wait_until="domcontentloaded", timeout=20000)
        wait_ready(page)
        page.evaluate("() => { localStorage.clear(); LOT.newGame(); }")
        page.wait_for_timeout(200)
        assert_clear_of_ferris(pose(page), "Desktop fresh spawn")
        run_keyboard_drive(page, "Desktop fresh")

        print("=== Desktop Ferris save ===", flush=True)
        plant_legacy_ferris_save(page)
        page.reload(wait_until="domcontentloaded", timeout=20000)
        wait_ready(page)
        page.evaluate("() => LOT.continueGame()")
        page.wait_for_timeout(200)
        assert_clear_of_ferris(pose(page), "Desktop continue Ferris save")
        run_keyboard_drive(page, "Desktop Ferris save")

        ctx.close()
        browser.close()

    print("---- page errors ----", flush=True)
    for e in errors:
        print("ERR", e, flush=True)
        fail(f"pageerror: {e}")
    if failures:
        print(f"\n{len(failures)} FAILURES", flush=True)
        for f in failures:
            print(" -", f, flush=True)
        sys.exit(1)
    print("OK", flush=True)


if __name__ == "__main__":
    main()
