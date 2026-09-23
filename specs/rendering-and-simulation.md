# Rendering and simulation

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

## 7. Rendering (PixiJS)

- **PixiJS v8**, `WebGL` preferred with automatic Canvas fallback, `autoDensity` on with
  `resolution = min(devicePixelRatio, 2)`.
- One `Application` and a world container **sized to the loaded map** (`map.width`/`height * CELL`,
  §3.1 — no fixed constant, `Sim.worldW`/`worldH` and `createPixiApp`'s params both derive it the
  same way), scaled by `min(vw/worldW, vh/worldH)` on **both axes** and centered in the mount —
  proportions preserved, with a letterbox margin on whichever axis the viewport's aspect ratio
  leaves over. All gameplay coordinates are logical px — resolution independence for free, identical
  simulation on every device.
- **Layers** are separate `Container`s in the order of §3.3, so z-order is structural, not sorted
  per frame.
- **Terrain** uses `@pixi/tilemap` (a single draw call per terrain layer). Only the changed cells are
  re-uploaded when brick is destroyed — no full-map rebuilds.
- **Textures** are generated procedurally at boot into a single `RenderTexture` atlas (brick, steel,
  forest, water frames, ice, sand, tank bodies per team and per upgrade level, bullets, bonuses,
  flags). No art assets to ship; the atlas can be swapped for real art later without touching
  gameplay code.
- **Effects** (explosions, spawn sparkles, muzzle flashes, mine blasts) are pooled sprites with
  short frame animations, capped at a budget so a `GRENADE` detonating 5 tanks stays smooth.
- **Quality tiers:** `high` = full effects + water animation; `low` = static water, halved particle
  budget, resolution clamped to 1. Auto-selected from a 2-second FPS probe at match start, and
  overridable in settings.

**Performance targets:** 60 fps on a 2020-era mid-range phone with 10 tanks, ~20 bullets and active
effects; ≤ 400 draw calls per frame; first interactive under 2 s on a cold cache.

---

## 8. Simulation

- **Fixed timestep, 30 Hz** (33.33 ms). Rendering runs at display rate and interpolates between the
  last two simulation states.
- **Deterministic given the same inputs**: no `Math.random` in the simulation — a seeded xorshift
  RNG, its seed distributed with the match start message. Bonus spawns, spawn point choice, and bot
  jitter all draw from it.
- **Collision** is grid-based: tanks test the 1 × 1 (up to 2 × 2 when straddling a cell boundary —
  the 24 px hitbox is smaller than the 32 px cell) cells they overlap, resolved per axis
  independently — moving diagonally into a wall that only blocks one axis keeps the tank moving on
  the other (a strafe/slide, not a hard stop). Bullets sweep every grid cell their leading edge
  crosses this tick, in travel order (a 2D walk, not just an axis-aligned one, since a bullet can be
  diagonal too) and hit the first solid cell or tank hitbox. No general physics engine.
- **Tick order:** inputs → tank movement & collisions → firing → bullet stepping & hits → terrain
  damage → bonus pickup & timers → deaths, the respawn pool, respawn timers → win conditions.
