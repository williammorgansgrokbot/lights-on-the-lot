# Lights on the Lot

A FarmVille-style 3D isometric carnival builder. Live at https://williammorgansgrokbot.github.io/lights-on-the-lot/

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# then open http://127.0.0.1:8000/
```

Built for desktop Mac browsers (Safari and Chrome, Retina). Left-click to place or select, right-click or Esc to cancel, R to rotate, Delete to sell, scroll-wheel to zoom, middle/right-drag or WASD to pan. Hover highlights a building. Tray shortcuts: 1–4 tabs, [ ] cycle, Enter to build. Touch remains as a fallback. Click a ring-toss booth and hit Play for the minigame. Aimed at 60 fps on Apple Silicon with merged static meshes, instanced decor, 2048–4096 shadow maps, and full-resolution bloom.

## What's in this build

- Build a midway on a grid: Ferris wheel, Super Loop, carousel, Tilt-A-Whirl, bumper cars, food vendors (corn dogs, funnel cake, cotton candy, lemonade, popcorn, turkey legs, pizza), a playable ring-toss booth, and path tiles.
- FarmVille loop: attractions earn coins over time (more when a path reaches them and guests visit). Click the floating coin to collect. XP and levels unlock new items. Expand the lot with coins. Short build-up animation when you place something.
- Guests are rigged 3D characters with walk / idle / look-around animations. They walk the paths, queue, sit on rides (Ferris gondolas, Super Loop car, carousel seats, Tilt-A-Whirl and bumper cars), buy food, and wander out.
- Professional CC0 glTF rides and stalls, plus an authored Tilt-A-Whirl. Ferris gondolas hang upright and swing; the Super Loop car runs a vertical loop; carousel seats bob; bumper cars bump; vendor steam and painted menu boards.
- Day-to-night cycle with HDRI, ACES in the bloom composite, emissive chase bulbs, lamp glow, and asphalt light pools. The lot has painted asphalt, a sawdust midway on paths, flags, bunting on stands (not strung over the lot), balloons, benches, bins, planters, and trees.
- Original waltz + mute toggle.
- Save in localStorage under `wm.lights-on-the-lot.v4` (older driving-game saves are left in place and not loaded). Cache-bust `v=8`.

Vendored Three.js r160 is in `vendor/`. Art is PNG/JPEG in `assets/` (no WebP). Screenshots from Playwright are in `screenshots/`.

## Art credits

All third-party models below are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) from [tevy](https://tevy.dev/models), used as shipped (pinned versions, various LODs) and assembled in-engine with painted menu boards:

- Ferris Wheel v2 LOD0 — https://tevy.dev/models/ferris-wheel
- Carousel v2 LOD0 — https://tevy.dev/models/carousel
- Bumper Car Pavilion v2 LOD1 — https://tevy.dev/models/bumper-cars
- Coaster Track Vertical Loop v1 LOD0 and Roller Coaster Train v1 LOD1 — https://tevy.dev/models/coaster-track-vertical-loop / https://tevy.dev/models/coaster-train
- Street Food Cart, Street Food Stall Cart, Baker's Awning Stall, newsstand kiosk, cloth merchant's stall, chalkboard sign, pizza oven, pepperoni pizza, cooler box, soda crate, donuts, paper lantern, food-stall stool, pizza peel, wooden barrel
- Park bench, festoon string lights, street lamp, waste bin, crowd-control barrier, concrete planter, geranium, picnic table, corner flag, hanging banner, bollard, clipped hedge, ginkgo tree, young spruce, brass rope barrier, potted pine
- Casual Walker, Dog Walker, and Road Worker (rigged, with idle / walk / wave / look_around) — https://tevy.dev/models/casual-walker and companions

Authored for this game (PBR, named animation nodes):

- Tilt-A-Whirl, balloon bouquet, and bunting-on-stands — `tools/build_tilt_props.py`
- Painted menu boards, asphalt lane overlay, and sawdust midway composite — `tools/paint_carnival_art.py`

Textures (CC0, Poly Haven):

- [Venice Sunset](https://polyhaven.com/a/venice_sunset) and [Moonless Golf](https://polyhaven.com/a/moonless_golf) HDRIs
- [Aerial Asphalt 01](https://polyhaven.com/a/aerial_asphalt_01), [Brown Mud 03](https://polyhaven.com/a/brown_mud_03), and [Wood Floor](https://polyhaven.com/a/wood_floor) (1K JPEG), composited into lot and midway materials

Three.js r160 (MIT), including SkeletonUtils. Fonts: Barlow, Cinzel, Michroma (OFL); sign lettering uses Bungee, Lilita One, and Barlow Condensed (OFL).
