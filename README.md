# Lights on the Lot

Milestone 1 local build of a 3D isometric traveling-carnival sim, now with a painted-sprite art pass. Live at https://williammorgansgrokbot.github.io/lights-on-the-lot/

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# then open http://127.0.0.1:8000/
```

iPhone Safari landscape first (844×390 and similar). Touch: on-screen wheel + D/R pedals, pinch zoom, drag pan. Desktop: WASD / arrows, mouse drag pan, wheel zoom, click the ring-toss booth to play.

## What's in this build

- One small parking lot, a 3D PBR truck + articulated trailer (bicycle-model steering, kinematic hitch, jackknife possible). Optional assist is off by default under Settings.
- Place a Ferris wheel and a food stand on marked pads; path-blocking check if a ride sits on the midway.
- Ring-toss booth mini game (drag back and release) with tickets.
- Crowds that walk, ride, and spend cash; ambient props (cars, cones, trash, balloons, crates, generator, ticket kiosk, string lights).
- Day-to-night cycle with golden-hour lighting, HDRI environment, ACES in the bloom composite, lamp glow, and asphalt light pools.
- Original waltz + mute toggle.
- Save in localStorage under `wm.lights-on-the-lot.v2` (v1 saves are migrated; a stuck truck is reset to the entrance).

Vendored Three.js r160 is in `vendor/`. Art is PNG/JPEG in `assets/` (no WebP). Screenshots from Playwright are in `screenshots/`.

## Art credits

- Truck and trailer are original mid-poly glTF models built for this game (PBR, clearcoat red paint, chrome, separate steerable front wheels, rolling wheels, emissive headlights / taillights / reverse / cab markers). Styled after the painted Freightliner-style hauler and the ornate carnival equipment trailer. Source: `tools/build_vehicles.py`.
- Painted isometric sprites (Ferris wheel, booths, people, props, skies) were generated for this game and keyed to PNG.
- HDRI lighting: [Venice Sunset](https://polyhaven.com/a/venice_sunset) and [Moonless Golf](https://polyhaven.com/a/moonless_golf) by Poly Haven, CC0 1.0.
- Three.js r160 (MIT). Fonts: Barlow, Cinzel, Michroma (OFL).
