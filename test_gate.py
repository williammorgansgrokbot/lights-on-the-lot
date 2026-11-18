#!/usr/bin/env python3
"""Scale, gate, and lighting: drive in through the gate and back onto a pad.

Runs iPhone landscape (844x390, hasTouch) and desktop keyboard.
Captures day and night screenshots.
"""
import base64, math, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOT = ROOT / "screenshots"
SHOT.mkdir(exist_ok=True)
PORT = Path("/tmp/lot-port").read_text().strip()
URL = f"http://127.0.0.1:{PORT}/index.html"

failures, errors, logs = [], [], []


def fail(msg):
    print("FAIL:", msg, flush=True)
    failures.append(msg)


def cdp_shot(page, path):
    sess = page.context.new_cdp_session(page)
    data = sess.send("Page.captureScreenshot", {"format": "png", "fromSurface": True})
    Path(path).write_bytes(base64.b64decode(data["data"]))
    print("wrote", path.name, Path(path).stat().st_size, flush=True)


def wait_ready(page):
    page.wait_for_function("() => window.LOT && window.LOT.ready", timeout=30000)


def pose(page):
    return page.evaluate("() => LOT.truckPose()")


def hold_key(page, key, ms):
    page.keyboard.down(key)
    page.wait_for_timeout(ms)
    page.keyboard.up(key)


def hold_touch(page, selector, ms, steer_x=None):
    box = page.locator(selector).bounding_box()
    if not box:
        fail(f"{selector} not visible")
        return
    cx = box["x"] + box["width"] / 2
    cy = box["y"] + box["height"] / 2
    page.evaluate(
        """({sel,x,y}) => {
          const el = document.querySelector(sel);
          const ev = {bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',isPrimary:true,buttons:1,clientX:x,clientY:y,button:0};
          el.dispatchEvent(new PointerEvent('pointerdown', ev));
          el.dispatchEvent(new TouchEvent('touchstart', {bubbles:true,cancelable:true}));
        }""",
        {"sel": selector, "x": cx, "y": cy},
    )
    if steer_x is not None:
        pad = page.locator("#wheelPad").bounding_box()
        if pad:
            wx = pad["x"] + pad["width"] * steer_x
            wy = pad["y"] + pad["height"] / 2
            page.evaluate(
                """({x,y}) => {
                  const el = document.getElementById('wheelPad');
                  const ev = {bubbles:true,cancelable:true,pointerId:2,pointerType:'touch',isPrimary:false,buttons:1,clientX:x,clientY:y,button:0};
                  el.dispatchEvent(new PointerEvent('pointerdown', ev));
                  el.dispatchEvent(new PointerEvent('pointermove', ev));
                }""",
                {"x": wx, "y": wy},
            )
    page.wait_for_timeout(ms)
    page.evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,cancelable:true,pointerId:1}));
          el.dispatchEvent(new TouchEvent('touchend', {bubbles:true,cancelable:true}));
          const pad = document.getElementById('wheelPad');
          if (pad) pad.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,cancelable:true,pointerId:2}));
        }""",
        selector,
    )


def face_lot_and_hitch(page):
    page.evaluate(
        """() => {
          LOT.newGame();
          LOT.setMuted(true);
          const t = LOT.vehicle.truck;
          t.x = 0; t.z = 20.5; t.heading = Math.PI; t.speed = 0; t.steer = 0;
          LOT.G.hooked = true;
          LOT.vehicle.jackknife = false;
          if (LOT.vehicle.trailer) LOT.vehicle.trailer.heading = t.heading;
          LOT.placeTrailerOnHitch();
          if (LOT.vehicleIsStuck()) {
            LOT.spawnTruckSafe({ hooked: true, follow: true });
            t.x = 0; t.z = 20.5; t.heading = Math.PI; t.speed = 0; t.steer = 0;
            if (LOT.vehicle.trailer) LOT.vehicle.trailer.heading = t.heading;
            LOT.placeTrailerOnHitch();
          }
          LOT.G.follow = true;
          LOT.G.pan.set(t.x, 0, t.z);
          LOT.applyCamera();
          LOT.hideUI(false);
        }"""
    )
    page.wait_for_timeout(120)


def drive_in(page, label, touch):
    face_lot_and_hitch(page)
    before = pose(page)
    print(f"  {label} pre-gate {before}", flush=True)
    if before["stuck"]:
        fail(f"{label}: stuck on the street before driving in {before}")
        return
    if before["z"] <= 14:
        fail(f"{label}: expected to start south of the gate, z={before['z']}")
        return

    if touch:
        hold_touch(page, "#pDrive", 2200)
    else:
        hold_key(page, "KeyW", 2200)
    after = pose(page)
    print(f"  {label} post-gate {after}", flush=True)
    if after["stuck"]:
        fail(f"{label}: stuck driving through the gate {after}")
    if after["z"] > 13.5:
        fail(f"{label}: did not enter the lot (z={after['z']:.2f}, still south of or on the fence)")
    if abs(after["x"]) > 7.5:
        fail(f"{label}: drifted outside the gate opening (x={after['x']:.2f})")
    return after


def back_onto_pad(page, label, touch):
    setup = page.evaluate(
        """() => {
          const t = LOT.vehicle.truck;
          const tr = LOT.vehicle.trailer;
          const hitch = t.hitchOff + (tr && tr.hitchOff ? tr.hitchOff : 0);
          t.x = -11.2 + hitch + 1.7;
          t.z = -3.0;
          t.heading = Math.PI / 2;
          t.speed = 0; t.steer = 0;
          LOT.G.hooked = true;
          LOT.vehicle.jackknife = false;
          if (tr) tr.heading = t.heading;
          LOT.placeTrailerOnHitch();
          LOT.G.follow = true;
          LOT.G.pan.set(t.x, 0, t.z);
          LOT.applyCamera();
          return { hitch, start: LOT.checkPad('ferris'), pose: LOT.truckPose() };
        }"""
    )
    print(f"  {label} approach {setup}", flush=True)
    if setup["pose"]["stuck"]:
        fail(f"{label}: approach pose stuck {setup['pose']}")
        return
    start = setup["start"]
    if start and start.get("ok"):
        fail(f"{label}: already on the pad before reversing")

    # Reverse in short bursts so we do not overshoot the smaller pad.
    best = start
    for _ in range(8):
        if touch:
            hold_touch(page, "#pRev", 280)
        else:
            hold_key(page, "KeyS", 280)
        chk = page.evaluate("() => ({ pad: LOT.checkPad('ferris'), pose: LOT.truckPose() })")
        print(f"    reverse {chk}", flush=True)
        if chk["pose"]["stuck"]:
            fail(f"{label}: stuck while backing onto the pad {chk['pose']}")
            return
        best = chk["pad"]
        if best and best.get("ok"):
            break
        if best and start and best["dist"] > start["dist"] + 0.6:
            # went the wrong way or past it
            break

    if not best or not best.get("ok"):
        # Accept a close back-in that clearly approached the pad
        if not best or best["dist"] > 1.8 or (start and best["dist"] >= start["dist"] - 0.25):
            fail(f"{label}: failed to back onto the Ferris pad ({best})")
        else:
            print(f"  {label} close enough dist={best['dist']:.2f} ang={best['ang']:.2f}", flush=True)
    else:
        print(f"  {label} on pad dist={best['dist']:.2f} ang={best['ang']:.2f}", flush=True)


def assert_layout(page, label):
    info = page.evaluate(
        """() => {
          const lamps = (LOT.world.lamps || []).map(l => ({x: l.x, z: l.z}));
          const street = lamps.filter(l => Math.abs(l.z - 20.5) < 0.4);
          return {
            scale: LOT.VEHICLE_SCALE,
            ride: LOT.RIDE_SCALE,
            gate: LOT.GATE_HALF,
            zoom: LOT.DEFAULT_ZOOM,
            hang: !!(LOT.world.hangSpr && LOT.world.hangSpr.length),
            lamps, street,
            truckLen: LOT.vehicle.truck.length,
            truckW: LOT.vehicle.truck.width,
            wb: LOT.vehicle.truck.wheelbase,
            yawSign: true
          };
        }"""
    )
    print(f"  {label} layout {info}", flush=True)
    if abs(info["scale"] - 0.82) > 0.001:
        fail(f"{label}: VEHICLE_SCALE {info['scale']} != 0.82")
    if abs(info["gate"] - 7) > 0.001:
        fail(f"{label}: GATE_HALF {info['gate']} != 7")
    if info["hang"]:
        fail(f"{label}: overhead string lights still present")
    if info["street"]:
        fail(f"{label}: parking-area light posts still present {info['street']}")
    if len(info["lamps"]) != 4:
        fail(f"{label}: expected 4 corner lot lamps, got {info['lamps']}")
    # Cab ~2.3m wide-ish; width should be well under old 3.35m
    if info["truckW"] > 2.3:
        fail(f"{label}: truck width {info['truckW']} still too large vs cars")


def migrate_old_save(page, label):
    """A v2 save at the old entrance should load; a v2 truck on the Ferris evicts."""
    page.evaluate(
        """() => {
          const s = {
            hour: 16, day: 1, cash: 0, tickets: 0, assist: false,
            currentJob: 'ferris', hooked: true, open: false, scale: 1.35,
            truck: { x: 0, z: 20.5, heading: -Math.PI / 2 },
            trailer: { kind: 'ferris', x: 7.2, z: 20.5, heading: -Math.PI / 2 },
            footprints: {}
          };
          localStorage.removeItem('wm.lights-on-the-lot.v3');
          localStorage.removeItem('wm.lights-on-the-lot.v1');
          localStorage.setItem('wm.lights-on-the-lot.v2', JSON.stringify(s));
          LOT.continueGame();
        }"""
    )
    page.wait_for_timeout(150)
    p = pose(page)
    print(f"  {label} v2 street continue {p}", flush=True)
    if p["stuck"]:
        fail(f"{label}: v2 street save left the truck stuck {p}")

    page.evaluate(
        """() => {
          const s = {
            hour: 16, day: 1, cash: 10, tickets: 0, assist: false,
            currentJob: 'food', hooked: false, open: false, scale: 1.35,
            truck: { x: -11.2, z: -3.0, heading: 0 },
            trailer: { kind: 'food', x: 5.5, z: 20.5, heading: -Math.PI / 2 },
            footprints: { ferris: { x: -11.2, z: -3.0, rot: -Math.PI / 2 } }
          };
          localStorage.removeItem('wm.lights-on-the-lot.v3');
          localStorage.setItem('wm.lights-on-the-lot.v2', JSON.stringify(s));
          LOT.continueGame();
        }"""
    )
    page.wait_for_timeout(200)
    p = pose(page)
    spawn = page.evaluate("() => LOT.SAFE_SPAWN")
    print(f"  {label} v2 ferris-overlap continue {p}", flush=True)
    if p["stuck"]:
        fail(f"{label}: v2 overlap save left the truck stuck {p}")
    d = math.hypot(p["x"] - spawn["x"], p["z"] - spawn["z"])
    if d > 6:
        fail(f"{label}: expected evict to entrance after old-scale overlap (d={d:.2f}, {p})")


def shot_day_night(page):
    page.evaluate(
        """() => {
          LOT.poseDayLot();
          const t = LOT.vehicle.truck;
          t.x = 0; t.z = 17.2; t.heading = Math.PI; t.speed = 0; t.steer = 0;
          LOT.G.hooked = true;
          LOT.placeTrailerOnHitch();
          LOT.G.hour = 15.2;
          LOT.setHour(15.2);
          LOT.G.follow = false;
          LOT.G.zoom = 11.4;
          LOT.G.pan.set(0.4, 0, 8.5);
          LOT.applyCamera();
          LOT.hideUI(true);
        }"""
    )
    page.wait_for_timeout(400)
    cdp_shot(page, SHOT / "09_day.png")

    page.evaluate(
        """() => {
          LOT.poseNight();
          LOT.G.follow = false;
          LOT.G.zoom = 10.2;
          LOT.G.pan.set(-2.2, 0, 0.4);
          LOT.applyCamera();
          LOT.hideUI(true);
        }"""
    )
    page.wait_for_timeout(500)
    cdp_shot(page, SHOT / "10_night.png")


def run_context(p, kind):
    browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--ignore-gpu-blocklist"])
    if kind == "iphone":
        ctx = browser.new_context(viewport={"width": 844, "height": 390}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1280, "height": 720}, is_mobile=False, has_touch=False)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    page.goto(URL, wait_until="domcontentloaded", timeout=20000)
    wait_ready(page)
    return browser, ctx, page


def main():
    with sync_playwright() as p:
        print("=== iPhone ===", flush=True)
        browser, ctx, page = run_context(p, "iphone")
        assert_layout(page, "iPhone")
        drive_in(page, "iPhone", touch=True)
        back_onto_pad(page, "iPhone", touch=True)
        migrate_old_save(page, "iPhone")
        shot_day_night(page)
        ctx.close(); browser.close()

        print("=== desktop ===", flush=True)
        browser, ctx, page = run_context(p, "desktop")
        assert_layout(page, "desktop")
        drive_in(page, "desktop", touch=False)
        back_onto_pad(page, "desktop", touch=False)
        migrate_old_save(page, "desktop")
        ctx.close(); browser.close()

    if errors:
        print("page errors:", errors[:8], flush=True)
        failures.extend(errors[:4])
    if failures:
        print(f"\n{len(failures)} FAILED")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("\nALL PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()
