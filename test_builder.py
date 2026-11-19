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

def cell_screen(page, cx, cz):
    return page.evaluate(
        """([cx, cz]) => {
          const w = LOT.cellWorld(cx, cz);
          return LOT.worldToScreen(w.x, 0.05, w.z);
        }""",
        [cx, cz],
    )

def path_paint_flow(page, label):
    page.evaluate("() => { localStorage.clear(); LOT.newGame(); LOT.setMuted(true); LOT.grant(2000, 0); }")
    page.wait_for_timeout(200)
    # Real UI: PATHS tab auto-selects the path tool
    page.locator('.tab[data-tab="paths"]').click()
    page.wait_for_timeout(150)
    kind = page.evaluate("() => LOT.G.buildKind")
    if kind != "path":
        fail(f"{label}: PATHS tab should auto-select path tool, got {kind}")
        page.locator('.card[data-kind="path"]').click()
        page.wait_for_timeout(100)
    before = page.evaluate("() => LOT.buildings.filter(b => b.kind==='path').length")
    # Click-drag a run from the end of the starter path (0,2) toward (3,2) then (3,-1)
    a = cell_screen(page, 1, 2)
    b = cell_screen(page, 3, 2)
    c = cell_screen(page, 3, -1)
    print(f"  {label} screen a={a} b={b} c={c}", flush=True)
    page.mouse.move(a["x"], a["y"])
    page.mouse.down()
    page.mouse.move(b["x"], b["y"], steps=12)
    page.mouse.move(c["x"], c["y"], steps=14)
    page.mouse.up()
    page.wait_for_timeout(200)
    after = page.evaluate(
        """() => {
          const paths = LOT.buildings.filter(b => b.kind==='path').map(b => ({cx:b.cx, cz:b.cz}));
          return { n: paths.length, paths, cash: LOT.G.cash, kind: LOT.G.buildKind };
        }"""
    )
    print(f"  {label} paint {before} -> {after}", flush=True)
    if after["n"] < before + 4:
        fail(f"{label}: click-drag should paint a path run, {before} -> {after['n']} {after['paths']}")
    # erase one tile with Shift+click
    target = after["paths"][-1]
    sc = cell_screen(page, target["cx"], target["cz"])
    page.keyboard.down("Shift")
    page.mouse.click(sc["x"], sc["y"])
    page.keyboard.up("Shift")
    page.wait_for_timeout(150)
    erased = page.evaluate("() => LOT.buildings.filter(b => b.kind==='path').length")
    print(f"  {label} after erase {erased}", flush=True)
    if erased >= after["n"]:
        fail(f"{label}: Shift-click should erase a path tile ({after['n']} -> {erased})")
    # guests should treat new paths as walkable
    linked = page.evaluate(
        """() => {
          LOT.placeAt('corndog', 4, -1);
          const food = LOT.buildings.find(b => b.kind==='corndog');
          return food ? LOT.isConnected(food) : false;
        }"""
    )
    print(f"  {label} food connected via painted path {linked}", flush=True)
    if not linked:
        fail(f"{label}: guests/paths should connect a stand reached by the painted run")

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
    page.evaluate("() => { LOT.poseBusyDay(); LOT.setMuted(true); }")
    avg, last = measure_perf(page, "busy-day")
    cdp_shot(page, SHOT / "15_busy_day_wide.png")
    # Painted path run, starting from a clean game
    page.evaluate("() => { localStorage.clear(); LOT.newGame(); LOT.setMuted(true); LOT.hideTray(false); LOT.grant(3000,0); LOT.G.hour = 15; LOT.setHour(15); }")
    page.wait_for_timeout(200)
    page.locator('.tab[data-tab="paths"]').click()
    page.wait_for_timeout(120)
    a = cell_screen(page, 1, 2)
    b = cell_screen(page, 4, 2)
    c = cell_screen(page, 4, -2)
    page.mouse.move(a["x"], a["y"])
    page.mouse.down()
    page.mouse.move(b["x"], b["y"], steps=16)
    page.mouse.move(c["x"], c["y"], steps=16)
    page.mouse.up()
    page.keyboard.press("Escape")
    page.evaluate("() => { LOT.placeAt('corndog', 5, -2); LOT.G.zoom = 15; LOT.G.pan.set(2,0,1); LOT.applyCamera(); }")
    page.wait_for_timeout(500)
    cdp_shot(page, SHOT / "18_painted_path.png")
    page.evaluate("() => { LOT.poseNightShow(); LOT.setMuted(true); }")
    navg, nlast = measure_perf(page, "night")
    cdp_shot(page, SHOT / "17_night_lit.png")
    Path("/tmp/lot-perf.json").write_text(json.dumps({"day": last, "day_avg": avg, "night": nlast, "night_avg": navg}, indent=2))

def main():
    with sync_playwright() as p:
        print("=== Mac 1440x900 ===", flush=True)
        browser, ctx, page = run_context(p, "mac")
        play_flow(page, "1440x900")
        path_paint_flow(page, "1440x900-paths")
        shots(page)
        ctx.close(); browser.close()

        print("=== Mac 2560x1440 ===", flush=True)
        browser, ctx, page = run_context(p, "wide")
        play_flow(page, "2560x1440")
        path_paint_flow(page, "2560x1440-paths")
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
