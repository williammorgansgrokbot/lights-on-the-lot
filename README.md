# Lights on the Lot

A FarmVille-style 3D isometric carnival builder. Live at https://williammorgansgrokbot.github.io/lights-on-the-lot/

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# then open http://127.0.0.1:8000/
```

iPhone Safari landscape first (844×390 and similar). Touch: tap cards to build, tap coins to collect, pinch zoom, drag pan. Desktop: same with mouse wheel zoom. Click a ring-toss booth and hit Play for the minigame.

## What's in this build

- Build a midway on a grid: Ferris wheel, Super Loop, carousel, Tilt-A-Whirl, bumper cars, food vendors (corn dogs, funnel cake, cotton candy, lemonade, popcorn, turkey legs, pizza), a playable ring-toss booth, and path tiles.
- FarmVille loop: attractions earn coins over time (more when a path reaches them and guests visit). Tap the floating coin to collect. XP and levels unlock new items. Expand the lot with coins. Short build-up animation when you place something.
- Guests walk the paths, queue, ride or buy food (food appears in hand), and wander out.
- Animated 3D PBR rides: Ferris gondolas hang upright and swing, chase lights at night; Super Loop car runs the ring; carousel horses bob; Tilt-A-Whirl and bumper cars move; vendor signs spin and steam rises.
- Day-to-night cycle with HDRI, ACES in the bloom composite, lamp glow, and asphalt light pools.
- Original waltz + mute toggle.
- Save in localStorage under `wm.lights-on-the-lot.v4` (older driving-game saves are left in place and not loaded).

Vendored Three.js r160 is in `vendor/`. Art is PNG/JPEG in `assets/` (no WebP). Screenshots from Playwright are in `screenshots/`.

## Art credits

- Rides, vendors, and path tiles are original mid-poly glTF models built for this game (PBR, clearcoat paint, chrome, named animation nodes). Source: `tools/build_rides.py`.
- Painted isometric sprites (people, trees, kiosk, light pools) were generated for this game and keyed to PNG. Build-tray icons are in `assets/ui/icons/`.
- HDRI lighting: [Venice Sunset](https://polyhaven.com/a/venice_sunset) and [Moonless Golf](https://polyhaven.com/a/moonless_golf) by Poly Haven, CC0 1.0.
- Three.js r160 (MIT). Fonts: Barlow, Cinzel, Michroma (OFL).
