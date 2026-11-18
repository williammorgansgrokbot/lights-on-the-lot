# Lights on the Lot

Milestone 1 local build of a 3D isometric traveling-carnival sim, now with a painted-sprite art pass. Do not publish until Bill says "push".

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# then open http://127.0.0.1:8000/
```

iPhone Safari landscape first (844×390 and similar). Touch: on-screen wheel + D/R pedals, pinch zoom, drag pan. Desktop: WASD / arrows, mouse drag pan, wheel zoom, click the ring-toss booth to play.

## What's in this build

- One small parking lot, truck + trailer (manual backing, jackknife possible). Optional assist is off by default under Settings.
- Place a Ferris wheel and a food stand on marked pads; path-blocking check if a ride sits on the midway.
- Ring-toss booth mini game (drag back and release) with tickets.
- Crowds that walk, ride, and spend cash; ambient props (cars, cones, trash, balloons, crates, generator, ticket kiosk, string lights).
- Day-to-night cycle with golden-hour lighting, HDRI environment, ACES in the bloom composite, lamp glow, and asphalt light pools.
- Original waltz + mute toggle.
- Save in localStorage under `wm.lights-on-the-lot.v1`.

Vendored Three.js r160 is in `vendor/`. Art is PNG/JPEG in `assets/` (no WebP). Screenshots from Playwright are in `screenshots/`.

## Art credits

- Painted isometric sprites (truck, trailer, Ferris wheel, booths, people, props, skies) were generated for this game and keyed to PNG.
- HDRI lighting: [Venice Sunset](https://polyhaven.com/a/venice_sunset) and [Moonless Golf](https://polyhaven.com/a/moonless_golf) by Poly Haven, CC0 1.0.
- Three.js r160 (MIT). Fonts: Barlow, Cinzel, Michroma (OFL).
