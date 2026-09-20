# Agent notes — Tanks project

Working notes for picking this project back up quickly. Not a design doc (that's `SPEC.md`) and not
a user-facing doc (that's `README.md`) — this is context for *how to work on it* efficiently.

## What this is, current status

Browser team tank battle in the spirit of *Battle City* (team size comes from the loaded map — 5 a
side on the built-ins, 1v1 on the debug map) — destructible terrain, power-ups, a flag
each team defends. TypeScript + PixiJS (WebGL) + PeerJS (WebRTC, star topology) + Vite, no backend,
static hosting on GitHub Pages.

**`SPEC.md` is the authoritative design doc and must stay in sync with the code** — not a one-time
planning artifact. It already has explicit "As implemented" callout boxes wherever the real code
deviates from the original design (JSON wire protocol instead of binary, full snapshots instead of
deltas, simplified client-side interpolation instead of full prediction/reconciliation). Read those
before assuming the spec's prose is what's actually running.

**Status as of 2026-09-06:** rewrote the whole thing from an earlier 2–4 player Canvas2D prototype to
the current 5v5/PixiJS/team design; verified working end-to-end (menu → create room → claim slot →
set bot difficulty → local co-op seat → ready → start → live 5v5 match with bots, terrain, bonuses,
kills, HUD). Followed by a bug-fixing pass: tank hitbox shrunk below its 32px slot + auto-center
assist (tanks were snagging in same-width corridors), tank sprite redrawn with tracks + barrel,
wall-hit/destruction VFX added, ally-vs-enemy forest concealment, bot stuck-detection with randomized
escape. Multiplayer (PeerJS) and mobile touch controls are implemented and type-safe but not yet
tried across two real devices or on an actual phone — that's the natural next verification gap.
Don't trust this paragraph's specifics for long; read the current code and git log, this rots fast.

## How to work with this project

- **Full rewrites are welcome when the spec and code diverge — don't patch around a mismatch.**
  Already granted for this project: bring the code in line with SPEC.md, up to and including
  deleting and rewriting whole subsystems, rather than reconciling them. Don't ask again.
- **Verify by actually running it, not just `tsc`/build passing.** Type-checking proves the code
  compiles, not that the feature works — several reported bugs (stuck tanks, missing VFX, forest
  visibility) typed and built cleanly but were still wrong. See Testing below.
- **Requests tend to arrive as dense, multi-part messages, often in Russian, bundling several
  unrelated asks in one go, no numbering.** Parse into a checklist before starting and address every
  item — don't drop one because it seems minor next to the others. Docs/code/comments in this repo
  are English-only regardless of the language a request came in.
- Git commits: one-line subject only, no body, no Co-Authored-By trailer (global rule, applies here).

## Testing

`npm test` runs the committed headless suite (`tests/`, node:test via `tsx` — see
`scripts/runTests.mjs`, which exists because Node 20's `--test` won't glob or discover `.ts`):

- `tests/movement.test.ts` — tank movement: travel speed per direction and surface, collision
  against terrain/tanks/world bounds, ice sliding, and the turning/corner-assist rules. The
  headline invariant is that an **unobstructed turn never moves the tank's center on the cross
  axis** (see `Sim.cornerAssist`); regressing that makes the sprite visibly jump sideways.
- `tests/mapFormat.test.ts` — the map format's size/roster flexibility: a 2x2 map (the `MIN_MAP_W`/
  `MIN_MAP_H` floor) parses and plays, anything smaller or lopsided is rejected. Guards the claim in
  SPEC §3.5 that nothing in the engine is tied to the built-ins' 33x25 / 5-a-side shape.
- `tests/botNavigation.test.ts` — a full bot-vs-bot match on every production map, asserting no
  bot is wedged. The guard on movement changes that only show up under real pathing.
- `tests/bots.test.ts` — bot tactics per difficulty (SPEC §10): objective play, shooting through
  brick, bonus behaviour, fair perception, rate of fire, and an integration test that plays
  full bot-vs-bot matches and asserts **Hard > Medium > Easy**. That last one is the important
  one — every individual behaviour can look right while the profiles still rank backwards in a
  fight, which is exactly what was happening.

There's still no project `/run` skill, so anything the suite doesn't cover (rendering, netcode,
touch controls) is still verified ad hoc:

- **Dev server:** `npm run dev` (Vite, port 5173) — served at **`http://localhost:5173/tanks/`**, not
  the bare root, because `vite.config.ts` sets `base: "/tanks/"` for GitHub Pages. Poll
  `curl -sf http://localhost:5173/tanks/` until it responds — don't blind-sleep. `lsof -ti:5173 |
  xargs kill` does **not** work here: stale Vite servers survive it, Vite silently takes 5174, 5175,
  … and the old one on 5173 answers with `504 (Outdated Optimize Dep)` and a blank `#ui`. Find them
  with `netstat -ano | grep LISTENING | grep :517` and kill by PID with `taskkill //PID <pid> //F`,
  then `rm -rf node_modules/.vite` if the 504 persists.
- **Driving it:** `chromium-cli` is not available in this Windows/Git-Bash environment. Fall back to
  Playwright: `npx playwright install chromium` (binaries were already cached under
  `~/AppData/Local/ms-playwright` last time), then a small Node script using
  `import { chromium } from "playwright"`. The `playwright` npm package itself isn't a project
  dependency — install it inside the scratchpad directory, isolated from this repo's own
  `package.json`, not the project root.
- **Map validation outside the browser:** `npm run maps:check` runs `scripts/checkMaps.ts` via `tsx`,
  validating every built-in map (plus the debug map) with the same parser the game uses, no browser
  needed.
- **Headless behavioral tests:** everything under `world/` and `ai/` has zero
  Vite-specific imports (only `world/maps/loader.ts` does, an `import.meta.env.DEV` check — which is
  why `tests/` builds maps with `parseMap` directly; the maps themselves are plain `.ts`
  template-literal exports, not raw-text file imports, so `mapFormat.ts` and the map files run under
  plain Node fine), so any of it can be exercised from a plain Node script or a new
  `tests/*.test.ts` — useful for verifying collision/movement/AI behavior deterministically instead
  of trying to catch a transient effect in a screenshot. Watch out for self-inflicted bugs in the
  test scenario itself
  (e.g. overlapping spawn points, a killed test tank respawning next tick because `respawnT` wasn't
  set) — trace tick-by-tick before concluding the product is broken.
- Worth doing early next session if more verification is needed: run `/run-skill-generator` to turn
  the above into a proper committed project skill instead of rediscovering it each time.
