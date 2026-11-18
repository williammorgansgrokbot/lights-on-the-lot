#!/usr/bin/env python3
"""Builder sim tests for desktop Mac viewports: 1440x900 and 2560x1440."""
import base64, json, sys, time
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
    page.wait_for_function("() => window.LOT && window.LOT.ready", timeout=120000)

def snap(page):
    return page.evaluate("() => LOT.snapshot()")

def run_context(p, kind):
    browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--ignore-gpu-blocklist"])
    if kind == "wide":
        ctx = browser.new_context(viewport={"width": 2560, "height": 1440}, device_scale_factor=1, is_mobile=False, has_touch=False)
    else:
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2, is_mobile=False, has_touch=False)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    page.goto(URL, wait_until="domcontentloaded", timeout=20000)
    wait_ready(page)
    return browser, ctx, page

def play_flow(page, label):
    page.evaluate("() => { localStorage.clear(); LOT.newGame(); LOT.setMuted(true); }")
    page.wait_for_timeout(200)
    s0 = snap(page)
    print(f"  {label} newGame {s0}", flush=True)
    if s0["mode"] != "play":
        fail(f"{label}: mode is {s0['mode']}")
    if s0["cash"] < 400:
        fail(f"{label}: starting cash {s0['cash']}")
    if page.locator("#pDrive").count():
        fail(f"{label}: drive pedal still in the DOM")
    if not page.locator(".card").count():
        fail(f"{label}: build tray has no cards")
    if page.locator("#trayKeys").count() == 0:
        fail(f"{label}: desktop tray shortcuts missing")

    placed = page.evaluate(
        """() => {
          LOT.grant(2000, 0);
          const p1 = LOT.placeAt('path', -1, 2);
          const p2 = LOT.placeAt('path', -2, 2);
          const f = LOT.placeAt('ferris', -2, 0);
          const food = LOT.placeAt('corndog', 2, 3);
          const p3 = LOT.placeAt('path', 1, 2);
          const p4 = LOT.placeAt('path', 2, 2);
          return { p1, p2, f, food, p3, p4, snap: LOT.snapshot() };
        }"""
    )
    print(f"  {label} placed {placed}", flush=True)
    if not placed["f"] or not placed["food"]:
        fail(f"{label}: failed to place ferris or food {placed}")
    kinds = placed["snap"]["kinds"]
    if "ferris" not in kinds or "corndog" not in kinds:
        fail(f"{label}: kinds missing rides {kinds}")

    # desktop keys: Esc cancels, 2 switches to food
    page.evaluate("() => LOT.pick('ferris')")
    page.keyboard.press("Escape")
    cancelled = page.evaluate("() => !LOT.G.buildKind")
    if not cancelled:
        fail(f"{label}: Esc did not cancel build")
    page.keyboard.press("2")
    tab = page.evaluate("() => LOT.G.tab")
    if tab != "food":
        fail(f"{label}: key 2 should switch to food, got {tab}")
    page.keyboard.press("1")

    page.evaluate(
        """() => {
          for (let i = 0; i < 80; i++) LOT.tickIncome(0.25);
        }"""
    )
    page.wait_for_timeout(100)
    before = snap(page)
    collected = page.evaluate("() => LOT.collectAll()")
    after = snap(page)
    print(f"  {label} collect {collected} cash {before['cash']} -> {after['cash']}", flush=True)
    if collected < 6:
        fail(f"{label}: expected to collect coins, got {collected} (stored={before['stored']})")
    if after["cash"] < before["cash"]:
        fail(f"{label}: cash did not increase after collect")

    page.evaluate("() => LOT.grant(0, 90)")
    s2 = snap(page)
    print(f"  {label} after XP {s2}", flush=True)
    if s2["level"] < 2:
        fail(f"{label}: expected level 2 after granting XP, got {s2['level']} xp={s2['xp']}")
    unlocked = page.evaluate(
        """() => {
          LOT.G.tab = 'rides'; LOT.populateTray();
          const cards = [...document.querySelectorAll('.card')];
          const car = cards.find(c => c.dataset.kind === 'carousel');
          return car ? { locked: car.classList.contains('locked'), kind: car.dataset.kind } : null;
        }"""
    )
    print(f"  {label} carousel card {unlocked}", flush=True)
    if not unlocked or unlocked["locked"]:
        fail(f"{label}: carousel should be unlocked at level 2 {unlocked}")

    page.evaluate("() => LOT.save()")
    page.reload(wait_until="domcontentloaded", timeout=20000)
    wait_ready(page)
    page.evaluate("() => { LOT.continueGame(); LOT.setMuted(true); }")
    page.wait_for_timeout(250)
    s3 = snap(page)
    print(f"  {label} reloaded {s3}", flush=True)
    if "ferris" not in s3["kinds"] or "corndog" not in s3["kinds"]:
        fail(f"{label}: save/reload lost buildings {s3['kinds']}")
    if s3["level"] < 2:
        fail(f"{label}: save/reload lost level {s3}")
    if s3["cash"] < after["cash"] - 1:
        fail(f"{label}: save/reload lost cash {s3['cash']} vs {after['cash']}")

def measure_perf(page, label):
    page.wait_for_timeout(1800)
    samples = []
    for _ in range(6):
        page.wait_for_timeout(400)
        samples.append(page.evaluate("() => LOT.perf()"))
    fps = [s["fps"] for s in samples if s and s.get("fps")]
    last = samples[-1] if samples else {}
    avg = sum(fps) / len(fps) if fps else 0
    print(f"  {label} perf avg_fps={avg:.1f} samples={fps} last={last}", flush=True)
    return avg, last

def shots(page):
    page.evaluate("() => { LOT.poseBuildMenu(); LOT.setMuted(true); }")
    page.wait_for_timeout(700)
    cdp_shot(page, SHOT / "14_build_menu.png")
    page.evaluate("() => { LOT.poseBusyDay(); LOT.setMuted(true); }")
    avg, last = measure_perf(page, "busy-day")
    cdp_shot(page, SHOT / "15_busy_day_wide.png")
    page.evaluate("() => { LOT.poseCloseRides(); LOT.setMuted(true); }")
    page.wait_for_timeout(900)
    cdp_shot(page, SHOT / "16_ferris_loop_close.png")
    page.evaluate("() => { LOT.poseNightShow(); LOT.setMuted(true); }")
    navg, nlast = measure_perf(page, "night")
    cdp_shot(page, SHOT / "17_night_lit.png")
    Path("/tmp/lot-perf.json").write_text(json.dumps({"day": last, "day_avg": avg, "night": nlast, "night_avg": navg}, indent=2))

def main():
    with sync_playwright() as p:
        print("=== Mac 1440x900 ===", flush=True)
        browser, ctx, page = run_context(p, "mac")
        play_flow(page, "1440x900")
        shots(page)
        ctx.close(); browser.close()

        print("=== Mac 2560x1440 ===", flush=True)
        browser, ctx, page = run_context(p, "wide")
        play_flow(page, "2560x1440")
        # smoke a packed lot at the wide size for renderer.info
        page.evaluate("() => { LOT.poseBusyDay(); LOT.setMuted(true); }")
        measure_perf(page, "2560-busy-day")
        ctx.close(); browser.close()

    if errors:
        print("page errors:", errors[:8], flush=True)
        real = [e for e in errors if "Failed to load" not in e]
        if real:
            failures.extend(real[:4])
    if failures:
        print(f"\n{len(failures)} FAILED")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("\nALL PASSED")
    sys.exit(0)

if __name__ == "__main__":
    main()
