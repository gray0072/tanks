# 12. Project structure

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

```
tanks/
├─ index.html
├─ package.json · tsconfig.json · vite.config.ts
├─ SPEC.md · README.md · AGENTS.md
├─ specs/                   # the spec itself, one file per section (SPEC.md is the index)
├─ scripts/
│  ├─ checkMaps.ts          # `npm run maps:check` — validates every map outside the browser
│  └─ runTests.mjs          # `npm test` — globs and runs tests/*.test.ts under node:test
├─ tests/                   # headless suites: movement, controls, map format, bot nav, bot tactics
└─ src/
   ├─ main.tsx                 # bootstrap: React root, backdrop layer, ?room= deep link
   ├─ style.css                # the one stylesheet for every screen + HUD
   ├─ ui/                      # every screen, in React
   │  ├─ App.tsx               # the one active route; starts/stops the menu backdrop
   │  ├─ routes.ts             # the Route union — the whole navigation model
   │  ├─ screens/              # MainMenu, CreateRoom, JoinRoom, MapLibrary, Editor,
   │  │                        # RoomScreen, Match, Result, SettingsScreen, HowToPlay
   │  ├─ components/           # Hud (§6.2), Modal
   │  └─ hooks/                # useEnterKey (Enter = primary action), useModal (await a dialog)
   ├─ game/
   │  ├─ config.ts             # all tunables from this spec
   │  ├─ settings.ts           # persisted per-viewer settings (volume, quality, ...)
   │  ├─ touchControls.ts      # the mobile two-zone overlay (§5.3): floating stick + fire half
   │  └─ menuBackdrop.ts       # the live bot match behind the menus (§6.3)
   ├─ world/
   │  ├─ grid.ts               # terrain, destruction, queries
   │  ├─ maps/
   │  │  ├─ mapFormat.ts       # pure parseMap()/MapDef/validator (§3.5), no Vite imports
   │  │  ├─ mapChars.ts        # terrain glyph table
   │  │  ├─ classic.ts · crossroads.ts · swamp.ts  # one template constant each (§3.6)
   │  │  ├─ mapSources.ts      # id + name + template for the three above
   │  │  ├─ debugMap.ts        # the debug map's own id/template (§3.5 "Debug map")
   │  │  └─ loader.ts          # registry: listMaps()/getMap() over the above
   │  ├─ tank.ts · bullet.ts · bonus.ts · flag.ts
   │  ├─ sim.ts                # fixed-step tick, deterministic, snapshot()
   │  └─ rules.ts              # respawns, scoring, win conditions
   ├─ ai/
   │  ├─ bot.ts                # utility scoring + actions + fair perception
   │  ├─ pathfinder.ts         # A* over the cost grid
   │  └─ teamPlan.ts           # role assignment
   ├─ net/
   │  ├─ peer.ts               # PeerJS wrapper, star topology
   │  ├─ protocol.ts           # message shapes for §9.3 (JSON, not binary — see §9.3 note)
   │  ├─ room.ts               # RoomController interface shared by host.ts/client.ts
   │  ├─ host.ts               # authoritative sim loop + broadcast + bots
   │  ├─ client.ts             # mirrors host state, ships local input
   │  └─ roomCode.ts
   ├─ render/
   │  ├─ app.ts                # Pixi app, scaling
   │  ├─ atlas.ts              # procedural texture generation
   │  ├─ arena.ts              # layers, sprites, snapshot interpolation, fx
   │  └─ preview.ts            # room-screen map & tank preview (Canvas2D)
   ├─ audio/audio.ts
   └─ util/                    # math (incl. seeded RNG), input, storage,
                               # fullscreen (§5.4: prefixes + orientation lock, all failure-tolerant)
```

## Deployment — GitHub Pages

The build is a static site with no backend, published to `https://gray0072.github.io/tanks/`.

- `vite.config.ts` sets `base: "/tanks/"` — the repo subpath. Without it every asset URL 404s once
  deployed, and the dev server then also serves from `/tanks/`.
- `package.json` carries `predeploy: npm run build` and `deploy: gh-pages -d dist` for publishing
  by hand from a working copy.
- `.github/workflows/deploy.yml` is the normal path: every push to `main` runs `npm ci`,
  `npm run build` and `peaceiris/actions-gh-pages@v4` with `permissions: contents: write`,
  publishing `./dist` to the `gh-pages` branch.

Two deliberate deviations from the wording above, both explained where they matter: the network
protocol carries JSON, not packed binary (§9.3), and client-side prediction is simplified rather than
full replay/reconciliation (§9.3) — both correctness-over-optimization calls that can't be verified
without real multi-device testing.
