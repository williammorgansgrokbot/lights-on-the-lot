#!/usr/bin/env python3
"""3D truck / articulated-trailer tests: drive, full-lock turn, reverse swing, jackknife, pad backing."""
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

def ang_diff(a, b):
    d = (a - b + math.pi) % (2 * math.pi) - math.pi
    return d

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
          document.getElementById('wheelPad').dispatchEvent(new PointerEvent('pointerup', {bubbles:true,cancelable:true,pointerId:2}));
        }""",
        selector,
    )

def start_play(page):
    page.evaluate("""() => { LOT.newGame(); LOT.setMuted(true); }""")
    page.wait_for_timeout(150)
    p = pose(page)
    if p["stuck"]:
        fail(f"spawn stuck {p}")
    return p

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

def test_drive_and_turn(page, label, touch):
    start_play(page)
    before = pose(page)
    if touch:
        hold_touch(page, "#pDrive", 900)
    else:
        hold_key(page, "KeyW", 900)
    after = pose(page)
    moved = math.hypot(after["x"] - before["x"], after["z"] - before["z"])
    print(f"  {label} forward moved {moved:.2f}", after, flush=True)
    if moved < 0.8:
        fail(f"{label}: forward did not move (d={moved:.3f})")

    # full-lock turn — collect unique headings to prove continuous (not 4-bin) rotation
    page.evaluate("() => { LOT.vehicle.truck.speed = 0; }")
    headings = []
    if touch:
        # hold D + wheel hard right, sample heading every 80ms
        hold_touch(page, "#pDrive", 80, steer_x=0.92)
        # longer hold with sampling via JS
        samples = page.evaluate("""() => new Promise((res) => {
          const el = document.getElementById('pDrive');
          const pad = document.getElementById('wheelPad');
          const r = pad.getBoundingClientRect();
          const ev = {bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',isPrimary:true,buttons:1,clientX:r.left+r.width*0.9,clientY:r.top+r.height/2,button:0};
          el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,cancelable:true,pointerId:7,pointerType:'touch',isPrimary:true,buttons:1,button:0}));
          pad.dispatchEvent(new PointerEvent('pointerdown', ev));
          pad.dispatchEvent(new PointerEvent('pointermove', ev));
          LOT.input.drive = 1; LOT.input.steer = 1;
          const hs = [];
          let n = 0;
          const id = setInterval(() => {
            hs.push(LOT.vehicle.truck.heading);
            n++;
            if (n >= 16) {
              clearInterval(id);
              el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,pointerId:7}));
              pad.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,pointerId:1}));
              LOT.input.drive = 0; LOT.input.steer = 0;
              res({hs, rot: LOT.vehicle.truck.group.rotation.y, steerY: LOT.vehicle.truck.parts.steers[0].rotation.y});
            }
          }, 80);
        })""")
    else:
        samples = page.evaluate("""() => new Promise((res) => {
          LOT.input.drive = 0;
          const hs = [];
          // keyboard
          const down = new KeyboardEvent('keydown', {code:'KeyW', key:'w', bubbles:true});
          const downD = new KeyboardEvent('keydown', {code:'KeyD', key:'d', bubbles:true});
          window.dispatchEvent(down); window.dispatchEvent(downD);
          LOT.input.keys.KeyW = true; LOT.input.keys.KeyD = true;
          let n = 0;
          const id = setInterval(() => {
            hs.push(LOT.vehicle.truck.heading);
            n++;
            if (n >= 16) {
              clearInterval(id);
              LOT.input.keys.KeyW = false; LOT.input.keys.KeyD = false;
              window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyW', bubbles:true}));
              window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyD', bubbles:true}));
              res({hs, rot: LOT.vehicle.truck.group.rotation.y, steerY: LOT.vehicle.truck.parts.steers[0].rotation.y});
            }
          }, 80);
        })""")
    hs = samples["hs"]
    unique = len(set(round(h, 4) for h in hs))
    total = abs(ang_diff(hs[-1], hs[0]))
    print(f"  {label} turn unique_headings={unique} delta={total:.3f} meshY={samples['rot']:.3f} steerY={samples['steerY']:.3f}", flush=True)
    if unique < 8:
        fail(f"{label}: heading not continuous (only {unique} unique samples) — still snapped?")
    if total < 0.25:
        fail(f"{label}: full-lock turn too small (d={total:.3f})")
    if abs(samples["rot"] - hs[-1]) > 0.05:
        fail(f"{label}: mesh rotation.y {samples['rot']} != heading {hs[-1]}")
    if abs(samples["steerY"]) < 0.12:
        fail(f"{label}: front wheels did not visibly steer (steerY={samples['steerY']:.3f})")

def test_reverse_swing(page, label, touch):
    start_play(page)
    page.evaluate("""() => {
      const t = LOT.vehicle.truck, tr = LOT.vehicle.trailer;
      t.x = 0; t.z = 4; t.heading = 0; t.speed = 0; t.steer = 0;
      LOT.G.hooked = true;
      tr.heading = 0;
      LOT.placeTrailerOnHitch();
      LOT.G.follow = true;
    }""")
    page.wait_for_timeout(80)
    before = page.evaluate("() => ({th: LOT.vehicle.truck.heading, trh: LOT.vehicle.trailer.heading})")
    # reverse with right steer so the trailer should swing the opposite way
    if touch:
        page.evaluate("() => { LOT.input.reverse = 1; LOT.input.steer = 1; }")
        page.wait_for_timeout(1400)
        page.evaluate("() => { LOT.input.reverse = 0; LOT.input.steer = 0; }")
    else:
        page.evaluate("() => { LOT.input.keys.KeyS = true; LOT.input.keys.KeyD = true; }")
        page.wait_for_timeout(1400)
        page.evaluate("() => { LOT.input.keys.KeyS = false; LOT.input.keys.KeyD = false; }")
    after = page.evaluate("() => ({th: LOT.vehicle.truck.heading, trh: LOT.vehicle.trailer.heading, jk: !!LOT.vehicle.jackknife})")
    # In reverse, truck heading changes with steer; trailer should lag and the hitch angle should grow
    hitch_ang = abs(ang_diff(after["trh"], after["th"]))
    swing = abs(ang_diff(after["trh"], before["trh"]))
    print(f"  {label} reverse-swing hitch_ang={hitch_ang:.3f} trailer_d={swing:.3f} jk={after['jk']}", before, after, flush=True)
    if swing < 0.15:
        fail(f"{label}: trailer did not swing when backing (d={swing:.3f})")
    # Opposite-to-truck: the hitch angle should be non-trivial (trailer not staying locked to truck heading)
    if hitch_ang < 0.12:
        fail(f"{label}: trailer stayed locked to truck heading while backing (psi={hitch_ang:.3f})")

def test_jackknife(page, label):
    start_play(page)
    info = page.evaluate("""() => {
      const t = LOT.vehicle.truck, tr = LOT.vehicle.trailer;
      t.x = 0; t.z = 2; t.heading = 0; t.speed = -3; t.steer = 0.62;
      LOT.G.hooked = true; LOT.G.mode = 'play';
      tr.heading = 1.15; // already folded ~66 deg, then keep backing
      LOT.placeTrailerOnHitch();
      LOT.vehicle.jackknife = false;
      return true;
    }""")
    page.evaluate("() => { LOT.input.reverse = 1; LOT.input.steer = 1; }")
    page.wait_for_timeout(1600)
    page.evaluate("() => { LOT.input.reverse = 0; LOT.input.steer = 0; }")
    after = page.evaluate("""() => ({
      jk: !!LOT.vehicle.jackknife,
      psi: Math.abs(((LOT.vehicle.trailer.heading - LOT.vehicle.truck.heading + Math.PI) % (Math.PI*2)) - Math.PI),
      speed: LOT.vehicle.truck.speed,
      warn: !document.getElementById('jackknife').classList.contains('hidden')
    })""")
    print(f"  {label} jackknife {after}", flush=True)
    if not after["jk"]:
        fail(f"{label}: expected jackknife after hard reverse")
    if not after["warn"]:
        fail(f"{label}: jackknife banner not shown")
    if after["speed"] < -0.4:
        fail(f"{label}: reverse was not clamped after jackknife (speed={after['speed']:.2f})")

def test_back_to_pad(page, label):
    start_play(page)
    info = page.evaluate("""() => {
      const pad = /* pads */ null;
      // use debug: put trailer on the ferris pad, nearly aligned, slow
      const t = LOT.vehicle.truck;
      // ferris pad is west; place truck in the aisle heading roughly toward +X or as needed
      // world.pads is not on LOT; approximate from earlier: ferris at (-11.2, -3)
      const px = -11.2, pz = -3.0;
      // trailer should sit on the pad, truck in front of it (south or east)
      const tr = LOT.vehicle.trailer;
      tr.heading = 0;
      tr.x = px; tr.z = pz;
      // truck in front of hitch
      const hitch = { x: tr.x + Math.sin(tr.heading)*tr.hitchOff, z: tr.z + Math.cos(tr.heading)*tr.hitchOff };
      t.heading = 0;
      t.x = hitch.x + Math.sin(t.heading)*t.hitchOff;
      t.z = hitch.z + Math.cos(t.heading)*t.hitchOff;
      t.speed = 0; t.steer = 0;
      LOT.G.hooked = true;
      LOT.placeTrailerOnHitch();
      // now slowly back toward pad if not already on it
      return { tx: t.x, tz: t.z, trx: LOT.vehicle.trailer.x, trz: LOT.vehicle.trailer.z,
               hitchOff: tr.hitchOff };
    }""")
    print(f"  {label} pre-pad {info}", flush=True)
    # nudge reverse a little then check distance of trailer to pad
    page.evaluate("() => { LOT.input.reverse = 1; }")
    page.wait_for_timeout(600)
    page.evaluate("() => { LOT.input.reverse = 0; }")
    after = page.evaluate("""() => {
      const tr = LOT.vehicle.trailer;
      const d = Math.hypot(tr.x - (-11.2), tr.z - (-3.0));
      return { d, trx: tr.x, trz: tr.z, stuck: LOT.truckPose().stuck, hooked: LOT.G.hooked };
    }""")
    print(f"  {label} back-to-pad {after}", flush=True)
    if after["stuck"]:
        fail(f"{label}: stuck while backing to pad")
    # Trailer should remain controllable near the pad (not teleported away)
    if after["d"] > 14:
        fail(f"{label}: trailer far from ferris pad after backing (d={after['d']:.2f})")

def shoot_turn(page):
    page.evaluate("""() => {
      LOT.newGame(); LOT.setMuted(true); LOT.setHour(15.3);
      const t = LOT.vehicle.truck, tr = LOT.vehicle.trailer;
      t.x = -3.2; t.z = -1.2; t.heading = 0.55; t.steer = 0.5; t.speed = 2;
      LOT.G.hooked = true;
      tr.heading = t.heading - 0.5;
      LOT.placeTrailerOnHitch();
      if (t.parts) t.parts.steers.forEach((n) => { n.rotation.y = (n.position.x < 0 ? -1 : 1) * -0.45; });
      LOT.G.follow = false; LOT.G.zoom = 7.2; LOT.G.pan.set(t.x - 1.2, 0, t.z - 1.0);
      LOT.applyCamera();
      LOT.hideUI(false);
    }""")
    page.wait_for_timeout(400)
    cdp_shot(page, SHOT / "07_turn.png")

def shoot_night_reverse(page):
    page.evaluate("""() => {
      LOT.newGame(); LOT.setMuted(true); LOT.setHour(20.5);
      const t = LOT.vehicle.truck, tr = LOT.vehicle.trailer;
      t.x = -2.0; t.z = 2.0; t.heading = 0.35; t.steer = -0.35; t.speed = -3.2;
      LOT.input.reverse = 1;
      LOT.G.hooked = true;
      tr.heading = t.heading + 0.45;
      LOT.placeTrailerOnHitch();
      if (t.parts) t.parts.steers.forEach((n) => { n.rotation.y = (n.position.x < 0 ? 1 : -1) * 0.35; });
      LOT.G.follow = false; LOT.G.zoom = 7.0; LOT.G.pan.set(t.x - 0.6, 0, t.z + 0.4);
      LOT.applyCamera();
      LOT.hideUI(false);
    }""")
    page.wait_for_timeout(500)
    cdp_shot(page, SHOT / "08_reverse_night.png")
    page.evaluate("() => { LOT.input.reverse = 0; }")

def main():
    with sync_playwright() as p:
        print("=== iPhone 844x390 touch ===", flush=True)
        browser, ctx, page = run_context(p, "iphone")
        if not page.evaluate("() => document.body.classList.contains('touch')"):
            fail("iPhone: body.touch not set")
        test_drive_and_turn(page, "iPhone", touch=True)
        test_reverse_swing(page, "iPhone", touch=True)
        test_jackknife(page, "iPhone")
        test_back_to_pad(page, "iPhone")
        shoot_turn(page)
        shoot_night_reverse(page)
        ctx.close(); browser.close()

        print("=== Desktop keyboard ===", flush=True)
        browser, ctx, page = run_context(p, "desktop")
        test_drive_and_turn(page, "Desktop", touch=False)
        test_reverse_swing(page, "Desktop", touch=False)
        test_jackknife(page, "Desktop")
        test_back_to_pad(page, "Desktop")
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
