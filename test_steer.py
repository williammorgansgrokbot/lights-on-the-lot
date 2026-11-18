#!/usr/bin/env python3
"""Steering direction vs driver-left and screen-left, not a raw heading sign flip."""
import math, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = Path("/tmp/lot-port").read_text().strip()
URL = f"http://127.0.0.1:{PORT}/index.html"
failures, errors = [], []

def fail(msg):
    print("FAIL:", msg, flush=True)
    failures.append(msg)

def wait_ready(page):
    page.wait_for_function("() => window.LOT && window.LOT.ready", timeout=30000)

def dbg(page):
    return page.evaluate("() => LOT.steerDebug()")

def dot(a, b):
    return a["x"] * b["x"] + a["z"] * b["z"]


def run_case(page, label, heading, touch, direction, reverse=False):
    """direction: 'left' or 'right'. Forward unless reverse=True."""
    page.evaluate(
        """({ heading }) => {
          LOT.newGame();
          LOT.setMuted(true);
          const t = LOT.vehicle.truck;
          t.x = 0; t.z = 20.5; t.heading = heading; t.speed = 0; t.steer = 0;
          LOT.G.hooked = false;
          if (LOT.vehicle.trailer && LOT.vehicle.trailer.group) LOT.vehicle.trailer.group.visible = false;
          LOT.G.follow = false;
          LOT.G.zoom = 14;
          LOT.G.pan.set(t.x, 0, t.z);
          LOT.applyCamera();
          LOT.hideUI(false);
        }""",
        {"heading": heading},
    )
    page.wait_for_timeout(80)
    before = dbg(page)
    left_key = "KeyA" if direction == "left" else "KeyD"
    drive_key = "KeyS" if reverse else "KeyW"
    if touch:
        # Left of the on-screen wheel is driver-left / CCW
        steer_x = 0.12 if direction == "left" else 0.88
        pedal = "#pRev" if reverse else "#pDrive"
        page.evaluate(
            """({ steer_x, pedal }) => {
              const pad = document.getElementById('wheelPad');
              const r = pad.getBoundingClientRect();
              const ev = {
                bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch',
                isPrimary: false, buttons: 1, button: 0,
                clientX: r.left + r.width * steer_x, clientY: r.top + r.height / 2
              };
              pad.dispatchEvent(new PointerEvent('pointerdown', ev));
              pad.dispatchEvent(new PointerEvent('pointermove', ev));
              const el = document.querySelector(pedal);
              el.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
                isPrimary: true, buttons: 1, button: 0
              }));
              el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
            }""",
            {"steer_x": steer_x, "pedal": pedal},
        )
        # Confirm HUD wheel mapping immediately
        mid = page.evaluate(
            """() => {
              const pad = document.getElementById('wheelPad');
              const r = pad.getBoundingClientRect();
              const tr = document.getElementById('wheel').style.transform || '';
              const m = /rotate\\((-?[\\d.]+)deg\\)/.exec(tr);
              return { steer: LOT.input.steer, deg: m ? parseFloat(m[1]) : 0, mid: r.left + r.width/2 };
            }"""
        )
        if direction == "left":
            if mid["steer"] >= -0.15:
                fail(f"{label}: left side of wheel should set input.steer < 0 (got {mid['steer']})")
            if mid["deg"] >= -5:
                fail(f"{label}: HUD wheel should rotate CCW (negative deg) when dragged left (got {mid['deg']})")
        else:
            if mid["steer"] <= 0.15:
                fail(f"{label}: right side of wheel should set input.steer > 0 (got {mid['steer']})")
            if mid["deg"] <= 5:
                fail(f"{label}: HUD wheel should rotate CW (positive deg) when dragged right (got {mid['deg']})")
        page.wait_for_timeout(900)
        page.evaluate(
            """() => {
              document.getElementById('pDrive').dispatchEvent(new PointerEvent('pointerup', {bubbles:true,pointerId:1}));
              document.getElementById('pRev').dispatchEvent(new PointerEvent('pointerup', {bubbles:true,pointerId:1}));
              document.getElementById('wheelPad').dispatchEvent(new PointerEvent('pointerup', {bubbles:true,pointerId:2}));
              LOT.input.drive = 0; LOT.input.reverse = 0; LOT.input.steer = 0;
            }"""
        )
    else:
        page.evaluate(
            """({ left_key, drive_key }) => {
              LOT.input.keys[drive_key] = true;
              LOT.input.keys[left_key] = true;
            }""",
            {"left_key": left_key, "drive_key": drive_key},
        )
        page.wait_for_timeout(900)
        page.evaluate(
            """({ left_key, drive_key }) => {
              LOT.input.keys[drive_key] = false;
              LOT.input.keys[left_key] = false;
            }""",
            {"left_key": left_key, "drive_key": drive_key},
        )
    after = dbg(page)
    toward_left = dot(after["fwd"], before["left"])
    screen = page.evaluate("(h) => LOT.screenSwing(h)", before["heading"])
    wheels = after["wheelY"]
    avg_wheel = sum(wheels) / len(wheels) if wheels else 0
    # Wheels are sampled after we released input, so they may have started
    # centering. Sample wheel sign while held instead — re-do a short hold
    # and read mid-hold. We already have after; also record mid via a dedicated hold.
    print(
        f"  {label} toward_driver_left={toward_left:.3f} screen={screen:.1f} "
        f"dHead={after['heading']-before['heading']:.3f} wheelY={wheels} steer={after['steer']:.3f}",
        flush=True,
    )
    if reverse:
        # Left steer in reverse: nose swings toward driver-RIGHT (natural)
        if direction == "left":
            if toward_left > -0.04:
                fail(f"{label}: reverse+left should swing the nose toward driver-right (dot={toward_left:.3f})")
            if screen > -20:
                fail(f"{label}: reverse+left nose should move away from screen driver-left (screen={screen:.1f})")
        else:
            if toward_left < 0.04:
                fail(f"{label}: reverse+right should swing the nose toward driver-left (dot={toward_left:.3f})")
    else:
        if direction == "left":
            if toward_left < 0.04:
                fail(f"{label}: forward+left should turn the nose toward driver-left (dot={toward_left:.3f})")
            if screen < 20:
                fail(f"{label}: forward+left nose should move toward screen driver-left (screen={screen:.1f})")
        else:
            if toward_left > -0.04:
                fail(f"{label}: forward+right should turn the nose toward driver-right (dot={toward_left:.3f})")
            if screen > -20:
                fail(f"{label}: forward+right nose should move away from screen driver-left (screen={screen:.1f})")
    return before, after

def read_wheels_while_steering(page, direction):
    """Hold left/right steer without needing motion, read visible wheel angles."""
    page.evaluate(
        """({ dir }) => {
          LOT.newGame(); LOT.setMuted(true);
          const t = LOT.vehicle.truck;
          t.x = 0; t.z = 20.5; t.heading = 0; t.speed = 0; t.steer = 0;
          LOT.G.hooked = false;
          if (LOT.vehicle.trailer && LOT.vehicle.trailer.group) LOT.vehicle.trailer.group.visible = false;
          LOT.input.steer = dir === 'left' ? -1 : 1;
        }""",
        {"dir": direction},
    )
    # Let a few frames apply Ackermann from input.steer
    page.wait_for_timeout(200)
    info = page.evaluate(
        """() => {
          const d = LOT.steerDebug();
          const t = LOT.vehicle.truck;
          const s = Math.sin(t.heading), c = Math.cos(t.heading);
          const left = { x: c, z: -s };
          const st = t.parts.steers[0];
          st.updateWorldMatrix(true, false);
          const e = st.matrixWorld.elements;
          // World position and local +Z axis (column 3 / column 2 of matrixWorld)
          const mid = { x: e[12], z: e[14] };
          const fwd = { x: e[8], z: e[10] };
          const alongLeft = fwd.x * left.x + fwd.z * left.z;
          return { wheelY: d.wheelY, steer: t.steer, alongLeft, inputSteer: LOT.input.steer, fwd, left };
        }"""
    )
    print(f"  wheels {direction}: {info}", flush=True)
    avg = sum(info["wheelY"]) / len(info["wheelY"])
    # Left steer: wheels must point toward driver-left (alongLeft > 0, wheelY > 0 in this model)
    if direction == "left":
        if info["inputSteer"] >= 0:
            fail(f"wheels left: input.steer should be negative (got {info['inputSteer']})")
        if info["alongLeft"] <= 0.05:
            fail(f"wheels left: front wheels do not point toward driver-left (alongLeft={info['alongLeft']:.3f})")
        if avg <= 0.05:
            fail(f"wheels left: expected positive rotation.y (got {info['wheelY']})")
    else:
        if info["inputSteer"] <= 0:
            fail(f"wheels right: input.steer should be positive (got {info['inputSteer']})")
        if info["alongLeft"] >= -0.05:
            fail(f"wheels right: front wheels do not point toward driver-right (alongLeft={info['alongLeft']:.3f})")
        if avg >= -0.05:
            fail(f"wheels right: expected negative rotation.y (got {info['wheelY']})")
    page.evaluate("() => { LOT.input.steer = 0; }")

def open_ctx(p, kind):
    browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--ignore-gpu-blocklist"])
    if kind == "iphone":
        ctx = browser.new_context(viewport={"width": 844, "height": 390}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1280, "height": 720}, is_mobile=False, has_touch=False)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded", timeout=20000)
    wait_ready(page)
    return browser, ctx, page

def main():
    headings = [0.0, -math.pi / 2, 0.8]  # south, spawn/west, a diagonal
    with sync_playwright() as p:
        print("=== iPhone touch ===", flush=True)
        browser, ctx, page = open_ctx(p, "iphone")
        if not page.evaluate("() => document.body.classList.contains('touch')"):
            fail("iPhone: body.touch not set")
        read_wheels_while_steering(page, "left")
        read_wheels_while_steering(page, "right")
        for h in headings:
            run_case(page, f"iPhone fwd-left h={h:.2f}", h, touch=True, direction="left")
            run_case(page, f"iPhone fwd-right h={h:.2f}", h, touch=True, direction="right")
        run_case(page, "iPhone rev-left h=0", 0.0, touch=True, direction="left", reverse=True)
        run_case(page, "iPhone rev-right h=0", 0.0, touch=True, direction="right", reverse=True)
        ctx.close(); browser.close()

        print("=== Desktop keys ===", flush=True)
        browser, ctx, page = open_ctx(p, "desktop")
        read_wheels_while_steering(page, "left")
        read_wheels_while_steering(page, "right")
        for h in headings:
            run_case(page, f"Desktop fwd-left h={h:.2f}", h, touch=False, direction="left")
            run_case(page, f"Desktop fwd-right h={h:.2f}", h, touch=False, direction="right")
        run_case(page, "Desktop rev-left h=0", 0.0, touch=False, direction="left", reverse=True)
        run_case(page, "Desktop rev-right h=0", 0.0, touch=False, direction="right", reverse=True)
        ctx.close(); browser.close()

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
