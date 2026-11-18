#!/usr/bin/env python3
import base64, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOT = ROOT / "screenshots"
SHOT.mkdir(exist_ok=True)
PORT = Path("/tmp/lot-port").read_text().strip()
URL = f"http://127.0.0.1:{PORT}/index.html"
errors, logs, bad = [], [], []

def cdp_shot(page, path):
    sess = page.context.new_cdp_session(page)
    data = sess.send("Page.captureScreenshot", {"format": "png", "fromSurface": True})
    Path(path).write_bytes(base64.b64decode(data["data"]))

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--ignore-gpu-blocklist"])
        context = browser.new_context(
            viewport={"width": 844, "height": 390},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = context.new_page()
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
        print("goto", URL, flush=True)
        page.goto(URL, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_function("() => window.LOT && window.LOT.ready", timeout=25000)
        print("READY", page.evaluate("() => LOT.G.mode"), flush=True)

        def shot(name, js=None, wait=700):
            if js:
                info = page.evaluate(js)
                print("  eval", name, info, flush=True)
            page.wait_for_timeout(wait)
            dest = SHOT / name
            cdp_shot(page, dest)
            print("wrote", dest.name, dest.stat().st_size, "errs", len(errors), flush=True)

        shot("00_title.png")
        shot("01_day_lot.png", """() => { LOT.poseDayLot(); LOT.hideUI(false); return {mode:LOT.G.mode, disp:getComputedStyle(document.getElementById('title')).display}; }""")
        shot("02_truck_backing.png", """() => { LOT.poseBacking(); LOT.hideUI(false); return {mode:LOT.G.mode, disp:getComputedStyle(document.getElementById('title')).display}; }""")
        shot("03_ferris_setup.png", """() => { LOT.poseFerris(); LOT.hideUI(false); return {mode:LOT.G.mode, disp:getComputedStyle(document.getElementById('title')).display}; }""")
        shot("04_night_lights.png", """() => { LOT.poseNight(); LOT.hideUI(false); return {mode:LOT.G.mode, disp:getComputedStyle(document.getElementById('title')).display}; }""", wait=1200)
        shot("05_ring_toss.png", """() => { LOT.poseNight(); LOT.openRingToss(); return {mode:LOT.G.mode}; }""", wait=800)

        browser.close()

    print("---- 4xx ----", flush=True)
    for L in bad: print(L, flush=True)
    print("---- console (errors/warnings) ----", flush=True)
    n = 0
    for L in logs:
        if L.startswith("error") or L.startswith("warning") or "Shader" in L:
            print(L, flush=True); n += 1
            if n > 12: print("...", flush=True); break
    print("---- page errors ----", flush=True)
    for e in errors: print("ERR", e, flush=True)
    if errors:
        sys.exit(2)
    print("OK", flush=True)

if __name__ == "__main__":
    main()
